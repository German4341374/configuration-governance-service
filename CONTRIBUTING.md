# Contributing

Use Node.js 24 or newer and create changes on a feature branch. Never commit `.env`, configuration
exports, production hostnames, credentials, or unredacted reports.

Install and validate:

```bash
npm run setup
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Use Conventional Commits, for example `feat(policy): add an environment-scoped rule` or
`fix(audit): serialize empty-chain initialization`. Add tests for policy, cryptographic envelope,
permission, concurrency, and migration changes. Document changes that affect approvals, promotions,
rollback, secrets, or audit guarantees.
