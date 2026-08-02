import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { Repository } from '../../src/db/repository.js';
import { loadRuntimeConfig } from '../../src/env.js';
import { loadPolicy } from '../../src/policy/engine.js';
import { GovernanceService } from '../../src/service.js';
import type { FastifyInstance } from 'fastify';

const databaseUrl = process.env['TEST_DATABASE_URL'];

describe.skipIf(!databaseUrl)('PostgreSQL API workflow', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await migrate(pool);
    const repository = new Repository(pool);
    const config = loadRuntimeConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      AUTH_MODE: 'demo',
      DATABASE_URL: databaseUrl,
      CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      SIGNING_KEY: 'integration-signing-key'
    });
    const service = new GovernanceService(
      repository,
      await loadPolicy('policies/default.yaml'),
      config.CONFIG_ENCRYPTION_KEY,
      config.SIGNING_KEY
    );
    app = await buildApp({ repository, service, config, publicDirectory: 'not-present' });
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE approvals, promotions, audit_log, environment_state, config_revisions RESTART IDENTITY CASCADE'
    );
    await pool.query(
      "INSERT INTO environment_state (environment) VALUES ('development'), ('staging'), ('production')"
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('reports liveness and database readiness', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
  });

  it('returns a stable JSON validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/revisions',
      headers: identity('author', 'editor'),
      payload: { environment: 'unknown', format: 'toml', content: '' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string; requestId: string } }>().error).toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('creates, approves, activates, diffs and rolls back immutable revisions', async () => {
    const first = await upload(
      'development',
      configuration('support-api', 5000),
      'author',
      'editor'
    );
    expect(first.statusCode).toBe(201);
    const firstRevision = first.json<{
      revision: { id: string; redactedContent: { database: { password: string } } };
    }>().revision;
    expect(firstRevision.redactedContent.database.password).toBe('***REDACTED***');

    const duplicate = await upload(
      'development',
      configuration('support-api', 5000),
      'author',
      'editor'
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe('DUPLICATE_REVISION');

    const selfApproval = await decide(firstRevision.id, 'author', 'approver');
    expect(selfApproval.statusCode).toBe(409);
    expect((await decide(firstRevision.id, 'reviewer', 'approver')).statusCode).toBe(200);

    const activateFirst = await app.inject({
      method: 'POST',
      url: '/api/environments/development/activate',
      headers: identity('release', 'deployer'),
      payload: { revisionId: firstRevision.id, expectedVersion: 0 }
    });
    expect(activateFirst.json<{ state: { lockVersion: number } }>().state.lockVersion).toBe(1);

    const second = await upload(
      'development',
      configuration('support-api-v2', 6000),
      'author',
      'editor'
    );
    const secondId = second.json<{ revision: { id: string } }>().revision.id;
    expect((await decide(secondId, 'reviewer', 'approver')).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/environments/development/activate',
          headers: identity('release', 'deployer'),
          payload: { revisionId: secondId, expectedVersion: 0 }
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/environments/development/activate',
          headers: identity('release', 'deployer'),
          payload: { revisionId: secondId, expectedVersion: 1 }
        })
      ).statusCode
    ).toBe(200);

    const diff = await app.inject({
      method: 'GET',
      url: `/api/diff?from=${firstRevision.id}&to=${secondId}`,
      headers: identity('reader', 'viewer')
    });
    expect(diff.json<{ entries: { path: string }[] }>().entries.map((entry) => entry.path)).toEqual(
      ['app.name', 'server.timeoutMs']
    );

    const rollback = await app.inject({
      method: 'POST',
      url: '/api/environments/development/rollback',
      headers: identity('release', 'deployer'),
      payload: { revisionId: firstRevision.id, expectedVersion: 2 }
    });
    expect(
      rollback.json<{ state: { currentRevisionId: string; lockVersion: number } }>().state
    ).toMatchObject({
      currentRevisionId: firstRevision.id,
      lockVersion: 3
    });

    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit/verify',
      headers: identity('reader', 'viewer')
    });
    expect(audit.json()).toMatchObject({ valid: true, brokenAt: null });
  });

  it('promotes an approved revision through staging to production', async () => {
    const uploaded = await upload(
      'development',
      configuration('governed-api', 5000),
      'author',
      'editor'
    );
    const developmentId = uploaded.json<{ revision: { id: string } }>().revision.id;
    await decide(developmentId, 'reviewer', 'approver');

    const staging = await app.inject({
      method: 'POST',
      url: '/api/environments/staging/promotions',
      headers: identity('release', 'deployer'),
      payload: { sourceRevisionId: developmentId, expectedVersion: 0 }
    });
    expect(staging.statusCode).toBe(200);
    const stagingId = staging.json<{
      revision: { id: string; sourceRevisionId: string };
      state: { lockVersion: number };
    }>();
    expect(stagingId.revision.sourceRevisionId).toBe(developmentId);
    expect(stagingId.state.lockVersion).toBe(1);

    const production = await app.inject({
      method: 'POST',
      url: '/api/environments/production/promotions',
      headers: identity('release', 'deployer'),
      payload: { sourceRevisionId: stagingId.revision.id, expectedVersion: 0 }
    });
    expect(production.statusCode).toBe(200);
    expect(production.json<{ state: { lockVersion: number } }>().state.lockVersion).toBe(1);
  });

  it('blocks approval when production policy validation fails', async () => {
    const uploaded = await upload(
      'production',
      configuration('unsafe-api', 40000, true, false),
      'author',
      'editor'
    );
    const body = uploaded.json<{
      revision: { id: string; policyIssues: { code: string }[] };
    }>();
    expect(body.revision.policyIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['TLS_REQUIRED', 'TIMEOUT_EXCEEDED', 'DEBUG_FORBIDDEN'])
    );
    const approval = await decide(body.revision.id, 'reviewer', 'approver');
    expect(approval.statusCode).toBe(409);
    expect(approval.json<{ error: { code: string } }>().error.code).toBe('POLICY_FAILURE');
  });

  function upload(environment: string, content: string, actor: string, role: string) {
    return app.inject({
      method: 'POST',
      url: '/api/revisions',
      headers: identity(actor, role),
      payload: { environment, format: 'json', content }
    });
  }

  function decide(id: string, actor: string, role: string) {
    return app.inject({
      method: 'POST',
      url: `/api/revisions/${id}/decisions`,
      headers: identity(actor, role),
      payload: { decision: 'approved', comment: 'Reviewed in integration test' }
    });
  }
});

function identity(actor: string, role: string) {
  return { 'x-actor': actor, 'x-role': role };
}

function configuration(name: string, timeoutMs: number, debug = false, tls = true): string {
  return JSON.stringify({
    app: { name, debug, mode: 'safe' },
    server: { timeoutMs },
    transport: { tls: { enabled: tls } },
    database: { host: 'database.internal', password: 'integration-placeholder' }
  });
}
