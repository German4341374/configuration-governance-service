import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFromRequest, requirePermission } from './auth.js';
import type { Repository } from './db/repository.js';
import { AppError } from './errors.js';
import type { RuntimeConfig } from './env.js';
import type { GovernanceService } from './service.js';

const environmentSchema = z.enum(['development', 'staging', 'production']);
const idSchema = z.uuid();

export async function buildApp(input: {
  repository: Repository;
  service: GovernanceService;
  config: RuntimeConfig;
  publicDirectory?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: input.config.LOG_LEVEL },
    bodyLimit: input.config.MAX_UPLOAD_BYTES,
    requestIdHeader: 'x-request-id'
  });

  app.addHook('onSend', async (_request, reply) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header(
      'content-security-policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'"
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const appError =
      error instanceof AppError
        ? error
        : error instanceof z.ZodError
          ? new AppError(
              400,
              'VALIDATION_ERROR',
              'Request validation failed',
              error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
            )
          : null;
    const statusCode = appError?.statusCode ?? 500;
    if (!appError) request.log.error({ err: error }, 'unhandled request error');
    void reply.status(statusCode).send({
      error: {
        code: appError?.code ?? 'INTERNAL_ERROR',
        message: appError?.message ?? 'Internal server error',
        requestId: request.id,
        ...(appError?.details === undefined ? {} : { details: appError.details })
      }
    });
  });

  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await input.repository.ping();
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not-ready' });
    }
  });

  app.get('/api/environments', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    return { environments: await input.repository.environmentStates() };
  });

  app.get('/api/revisions', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    const query = z
      .object({
        environment: environmentSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50)
      })
      .parse(request.query);
    return { revisions: await input.repository.listRevisions(query.environment, query.limit) };
  });

  app.post('/api/revisions', async (request, reply) => {
    const actor = authorize(request, input.config.AUTH_MODE, 'upload');
    const body = z
      .object({
        environment: environmentSchema,
        format: z.enum(['json', 'yaml', 'env']),
        content: z.string().min(1),
        signature: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
      })
      .parse(request.body);
    const revision = await input.service.upload({
      environment: body.environment,
      format: body.format,
      content: body.content,
      actor,
      ...(body.signature ? { signature: body.signature } : {})
    });
    return reply.status(201).send({ revision });
  });

  app.get('/api/revisions/:id', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    const params = z.object({ id: idSchema }).parse(request.params);
    return { revision: await input.repository.getRevision(params.id) };
  });

  app.post('/api/revisions/:id/decisions', async (request) => {
    const actor = authorize(request, input.config.AUTH_MODE, 'approve');
    const params = z.object({ id: idSchema }).parse(request.params);
    const body = z
      .object({
        decision: z.enum(['approved', 'rejected']),
        comment: z.string().max(500).default('')
      })
      .parse(request.body);
    return {
      revision: await input.service.decision(params.id, body.decision, actor, body.comment)
    };
  });

  app.get('/api/diff', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    const query = z.object({ from: idSchema, to: idSchema }).parse(request.query);
    return input.service.compare(query.from, query.to);
  });

  app.get('/api/revisions/:id/report.md', async (request, reply) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    const params = z.object({ id: idSchema }).parse(request.params);
    const query = z.object({ compareTo: idSchema.optional() }).parse(request.query);
    return reply
      .type('text/markdown; charset=utf-8')
      .send(await input.service.report(params.id, query.compareTo));
  });

  app.get('/api/revisions/:id/manifest', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    const params = z.object({ id: idSchema }).parse(request.params);
    return input.service.manifest(params.id);
  });

  app.post('/api/environments/:environment/activate', async (request) => {
    const actor = authorize(request, input.config.AUTH_MODE, 'deploy');
    const params = z.object({ environment: environmentSchema }).parse(request.params);
    const body = z
      .object({ revisionId: idSchema, expectedVersion: z.number().int().min(0) })
      .parse(request.body);
    return {
      state: await input.service.activate(
        params.environment,
        body.revisionId,
        body.expectedVersion,
        actor
      )
    };
  });

  app.post('/api/environments/:environment/rollback', async (request) => {
    const actor = authorize(request, input.config.AUTH_MODE, 'deploy');
    const params = z.object({ environment: environmentSchema }).parse(request.params);
    const body = z
      .object({ revisionId: idSchema, expectedVersion: z.number().int().min(0) })
      .parse(request.body);
    return {
      state: await input.service.rollback(
        params.environment,
        body.revisionId,
        body.expectedVersion,
        actor
      )
    };
  });

  app.post('/api/environments/:environment/promotions', async (request) => {
    const actor = authorize(request, input.config.AUTH_MODE, 'deploy');
    const params = z.object({ environment: environmentSchema }).parse(request.params);
    const body = z
      .object({ sourceRevisionId: idSchema, expectedVersion: z.number().int().min(0) })
      .parse(request.body);
    return input.service.promote({
      sourceRevisionId: body.sourceRevisionId,
      targetEnvironment: params.environment,
      expectedVersion: body.expectedVersion,
      actor
    });
  });

  app.get('/api/audit', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    return { entries: await input.repository.auditEntries(query.limit) };
  });

  app.get('/api/audit/verify', async (request) => {
    authorize(request, input.config.AUTH_MODE, 'read');
    return input.repository.verifyAuditChain();
  });

  const publicDirectory = resolve(input.publicDirectory ?? 'public');
  if (existsSync(publicDirectory)) {
    await app.register(fastifyStatic, { root: publicDirectory, wildcard: false });
    app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
  }

  return app;
}

function authorize(
  request: FastifyRequest,
  authMode: 'demo' | 'trusted_headers',
  permission: 'read' | 'upload' | 'approve' | 'deploy'
) {
  const actor = actorFromRequest(request, authMode);
  requirePermission(actor, permission);
  return actor;
}
