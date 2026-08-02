# Repository guidance

- Keep source code, tests, documentation, commit messages, and configuration in English.
- Preserve immutable revision semantics and append-only workflow history.
- Never log, return, fixture, or commit unmasked secret values.
- Keep TypeScript strict and use parameterized PostgreSQL queries.
- Add a migration for schema changes; never edit a migration already used by a release.
- Run formatting, lint, typecheck, tests, build, and relevant Compose checks before publishing.
- Use Conventional Commits and update security/architecture documentation when trust boundaries change.
