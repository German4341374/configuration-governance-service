# Operations runbook

## API is not ready

1. Check `docker compose ps` and `docker compose logs app postgres`.
2. Confirm PostgreSQL health with `docker compose exec postgres pg_isready`.
3. Validate `DATABASE_URL` host, database, and user without printing its password.
4. Check that migrations completed; startup exits instead of serving against a partial schema.
5. Restore PostgreSQL connectivity, then restart only the app with `docker compose restart app`.

## Encryption key error

Do not generate a replacement if historical data exists. A different key makes every stored revision
undecryptable for promotion. Restore the correct key from the secret manager. For a disposable local
environment, run `docker compose down --volumes`, remove `.env`, and run `npm run setup:env`.

## Optimistic conflict

HTTP 409 `VERSION_CONFLICT` is expected concurrent behavior. Read `/api/environments`, inspect the
new active revision, compare it with the intended revision, then retry using the new `lockVersion`
only after a human or pipeline policy decides the change is still safe.

## Audit verification fails

Stop governance writes, preserve a database snapshot and application logs, compare the latest hash
with the independent checkpoint, and investigate database access. Do not repair or delete audit rows
before evidence collection. Rebuild service trust from the last verified checkpoint.

## Backup and restore

Back up PostgreSQL with standard tested `pg_dump`/`pg_restore` procedures and back up the encryption
key separately. A database-only restore without the matching key is incomplete. After restore, call
`/api/audit/verify`, compare the external audit checkpoint, inspect each environment pointer, and run
a read-only diff before allowing new promotions.
