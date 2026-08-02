import { beforeAll, describe, expect, it } from 'vitest';
import { loadPolicy, validatePolicy, type PolicyDefinition } from '../../src/policy/engine.js';

let policy: PolicyDefinition;
beforeAll(async () => {
  policy = await loadPolicy('policies/default.yaml');
});

const valid = {
  app: { name: 'api', debug: false, mode: 'safe' },
  server: { timeoutMs: 5000 },
  transport: { tls: { enabled: true } },
  database: { host: 'database.internal' }
};

describe('policy engine', () => {
  it('accepts a valid production configuration', () => {
    expect(validatePolicy(valid, 'production', policy)).toEqual([]);
  });

  it('reports required values', () => {
    expect(validatePolicy({}, 'development', policy).map((item) => item.code)).toContain(
      'REQUIRED_PARAMETER'
    );
  });

  it('reports type mismatches', () => {
    expect(
      validatePolicy({ ...valid, server: { timeoutMs: 'slow' } }, 'staging', policy).map(
        (item) => item.code
      )
    ).toContain('TYPE_MISMATCH');
  });

  it('reports forbidden values', () => {
    expect(
      validatePolicy({ ...valid, app: { ...valid.app, mode: 'unsafe' } }, 'development', policy)[0]
        ?.code
    ).toBe('FORBIDDEN_VALUE');
  });

  it('requires TLS in production', () => {
    expect(
      validatePolicy(
        { ...valid, transport: { tls: { enabled: false } } },
        'production',
        policy
      ).map((item) => item.code)
    ).toContain('TLS_REQUIRED');
  });

  it('limits production timeout', () => {
    expect(
      validatePolicy({ ...valid, server: { timeoutMs: 30001 } }, 'production', policy).map(
        (item) => item.code
      )
    ).toContain('TIMEOUT_EXCEEDED');
  });

  it('forbids production debug flags', () => {
    expect(
      validatePolicy({ ...valid, app: { ...valid.app, debug: true } }, 'production', policy).map(
        (item) => item.code
      )
    ).toContain('DEBUG_FORBIDDEN');
  });

  it('forbids local production database hosts', () => {
    expect(
      validatePolicy({ ...valid, database: { host: 'localhost' } }, 'production', policy).map(
        (item) => item.code
      )
    ).toContain('PRODUCTION_HOST_FORBIDDEN');
  });

  it('checks nested key naming', () => {
    expect(
      validatePolicy({ ...valid, 'invalid-key': true }, 'development', policy).map(
        (item) => item.code
      )
    ).toContain('INVALID_NAME');
  });
});
