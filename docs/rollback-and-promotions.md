# Promotion and rollback semantics

## Promotion

Promotion is deliberately linear: development may promote to staging, and staging may promote to
production. Skipping staging is rejected. The source revision must be approved. The service decrypts
its canonical content, reruns target policies, creates a target-environment revision with a source
link, records inherited approval, and activates it under an optimistic version check.

Promotion copies content instead of sharing one row because environment-specific policy evidence,
revision numbering, hash uniqueness, and optional signatures belong to the target environment.

## Optimistic concurrency

Every environment exposes `lockVersion`. An activation request supplies the version it observed. The
database update succeeds only if that version is still current; otherwise HTTP 409
`VERSION_CONFLICT` returns the latest version. Clients must refresh, review the new state, and decide
again. Blind automatic retries are unsafe because another deployment may have become active.

## Rollback

Rollback does not delete the failed revision and does not edit old content. It atomically points the
environment at an approved revision that appears in its prior activation history. A new promotion
history row and audit record explain the pointer change, while `lockVersion` increases normally.

Consequences:

- Historical hashes and approvals remain stable.
- The failed revision remains available for investigation and comparison.
- A rollback can itself conflict with a concurrent deployment and must use the latest version.
- Database schema or external state is outside this service; operators must assess compatibility
  before rolling application configuration backward.
