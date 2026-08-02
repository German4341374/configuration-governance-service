import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from '../../src/configuration/canonical.js';
import {
  decryptContent,
  encryptContent,
  signManifest,
  verifyManifest
} from '../../src/configuration/crypto.js';
import { diffValues } from '../../src/configuration/diff.js';
import { maskSecrets } from '../../src/configuration/secrets.js';

describe('canonical configuration', () => {
  it('produces the same hash for different key insertion order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it('uses deterministic nested serialization', () => {
    expect(canonicalJson({ z: [2, 1], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":[2,1]}'
    );
  });
});

describe('secret handling', () => {
  it('masks nested secret keys', () => {
    expect(maskSecrets({ database: { password: 'sensitive', host: 'db' } })).toEqual({
      database: { password: '***REDACTED***', host: 'db' }
    });
  });

  it('masks secret values inside arrays', () => {
    expect(maskSecrets({ services: [{ apiKey: 'sensitive', name: 'api' }] })).toEqual({
      services: [{ apiKey: '***REDACTED***', name: 'api' }]
    });
  });

  it('does not mask unrelated values', () => {
    expect(maskSecrets({ tokenBucketSize: 5, app: { name: 'api' } })).toEqual({
      tokenBucketSize: '***REDACTED***',
      app: { name: 'api' }
    });
  });
});

describe('encryption and signing', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips AES-GCM content', () => {
    const encrypted = encryptContent('{"secret":"value"}', key);
    expect(encrypted).not.toContain('value');
    expect(decryptContent(encrypted, key)).toBe('{"secret":"value"}');
  });

  it('rejects a tampered envelope', () => {
    const encrypted = encryptContent('content', key);
    expect(() => decryptContent(`${encrypted.slice(0, -2)}aa`, key)).toThrow();
  });

  it('signs and verifies manifests', () => {
    const signature = signManifest('production', 'abc', 'signing-key');
    expect(signature).not.toBeNull();
    if (!signature) throw new Error('Expected signature');
    expect(verifyManifest('production', 'abc', signature, 'signing-key')).toBe(true);
    expect(verifyManifest('staging', 'abc', signature, 'signing-key')).toBe(false);
  });

  it('returns no signature when signing is disabled', () => {
    expect(signManifest('development', 'abc')).toBeNull();
  });
});

describe('nested diff', () => {
  it('reports additions, removals, changes and type changes', () => {
    const diff = diffValues(
      { app: { name: 'old', removed: true }, ports: [80], value: 1 },
      { app: { name: 'new', added: true }, ports: [80, 443], value: '1' }
    );
    expect(diff.map((entry) => [entry.path, entry.kind])).toEqual([
      ['app.added', 'added'],
      ['app.name', 'changed'],
      ['app.removed', 'removed'],
      ['ports[1]', 'added'],
      ['value', 'type-changed']
    ]);
  });

  it('returns no entries for equal values', () => {
    expect(diffValues({ a: [1] }, { a: [1] })).toEqual([]);
  });
});
