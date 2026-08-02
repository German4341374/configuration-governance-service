# Secret handling and audit guarantees

## Secret lifecycle

1. Input is accepted only up to the configured body limit.
2. It is parsed in memory and normalized.
3. Secret paths are detected recursively from key names.
4. A redacted copy is created for API responses, UI, diff, and reports.
5. Canonical plaintext is encrypted with AES-256-GCM using a random 96-bit nonce.
6. Only the authenticated ciphertext envelope and redacted copy are stored.

`CONFIG_ENCRYPTION_KEY` must decode to exactly 32 bytes. It must come from an external secret manager
in production. Rotation is not automatic in this version; retain old keys until all historical
revisions are re-encrypted in a controlled migration. Database backups contain ciphertext but still
require normal access controls because metadata can be sensitive.

Masking is key-name based. Operators must not use neutral keys for confidential values and should
avoid placing secrets in free-form strings. Request bodies are never written to application logs.

## Signed manifests

When `SIGNING_KEY` is configured, the service publishes an HMAC-SHA256 signature over
`environment:contentHash`. Uploads may include a signature for verification. HMAC is suitable for a
shared-secret integrity demonstration; it does not provide public verification or signer identity.
A production extension should use asymmetric signing backed by KMS/HSM and include key ID, creation
time, policy version, and signer subject.

## Audit guarantees

Each audit entry hashes its predecessor plus action, actor, resource, safe details, and timestamp.
An advisory lock serializes the append. `/api/audit/verify` recomputes the chain and detects modified,
deleted, inserted, or reordered rows from the first mismatch onward.

The chain is tamper-evident, not physically immutable. A database administrator who can rewrite the
entire table can produce a new internally valid chain. Export the latest `entryHash` periodically to
write-once storage or an independent log system to create an external checkpoint. Database roles
should deny application `UPDATE` and `DELETE` on audit data in a hardened deployment; the local demo
uses one database role for simplicity.

## Threat boundaries

- YAML and configuration files are untrusted input; alias expansion is limited and unsupported value
  types are rejected.
- Actor headers are trusted only behind the production authentication boundary described in
  `permissions.md`.
- PostgreSQL, encryption keys, CI artifacts, and the host filesystem are privileged components.
- The React interface never receives plaintext configuration content.
