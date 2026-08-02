import { describe, expect, it } from 'vitest';
import { actorFromRequest, requirePermission } from '../../src/auth.js';
import { loadRuntimeConfig } from '../../src/env.js';
import type { FastifyRequest } from 'fastify';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64')
};

describe('runtime configuration', () => {
  it('loads defaults and validates encryption key length', () => {
    const config = loadRuntimeConfig(validEnvironment);
    expect(config.PORT).toBe(8080);
    expect(config.MAX_UPLOAD_BYTES).toBe(262144);
  });

  it('rejects an invalid encryption key', () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, CONFIG_ENCRYPTION_KEY: 'short' })
    ).toThrow();
  });

  it('forbids demo auth in production', () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnvironment, NODE_ENV: 'production', AUTH_MODE: 'demo' })
    ).toThrow('AUTH_MODE=demo');
  });
});

describe('permission model', () => {
  it('provides an admin identity in demo mode', () => {
    const request = { headers: {} } as FastifyRequest;
    expect(actorFromRequest(request, 'demo')).toEqual({ name: 'demo-admin', role: 'admin' });
  });

  it('reads trusted identity headers', () => {
    const request = {
      headers: { 'x-actor': 'reviewer', 'x-role': 'approver' }
    } as unknown as FastifyRequest;
    expect(actorFromRequest(request, 'trusted_headers')).toEqual({
      name: 'reviewer',
      role: 'approver'
    });
  });

  it('rejects missing trusted identity headers', () => {
    expect(() => actorFromRequest({ headers: {} } as FastifyRequest, 'trusted_headers')).toThrow(
      'X-Actor'
    );
  });

  it('enforces least privilege', () => {
    expect(() => requirePermission({ name: 'reader', role: 'viewer' }, 'deploy')).toThrow(
      "cannot perform 'deploy'"
    );
    expect(() => requirePermission({ name: 'release', role: 'deployer' }, 'deploy')).not.toThrow();
  });
});
