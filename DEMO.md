# Five-minute demonstration

## 0:00-1:00 - Start and explain the boundary

```bash
npm run setup
docker compose up --build -d --wait
```

Open <http://127.0.0.1:8080>. Explain that the browser receives only redacted configuration and that
canonical plaintext is encrypted in PostgreSQL.

## 1:00-2:00 - Create a revision

Keep the sample YAML, select development, and click **Create immutable revision**. Point out the
revision number, SHA-256 hash, author, policy findings, and masked database password. Upload the same
content again to demonstrate duplicate hash protection.

## 2:00-3:00 - Approval and concurrency

Change the identity to `reviewer / approver` and approve the revision. Explain that an author cannot
approve their own work. Change to `release / deployer`, activate it, and point out that environment
`lockVersion` increased. The expected version prevents lost updates from concurrent deployments.

## 3:00-4:00 - Diff, promotion, and rollback

Create a second revision with a different `app.name` and `server.timeoutMs`, approve and activate it,
then compare it with the first revision. Show the field-level nested diff. Select the first revision
and click rollback; the old content is not edited or copied, only the active pointer changes and the
version increases.

For linear promotion, approve a development revision and click **Promote** to staging, then select the
new staging revision and promote it to production. Target policies are rerun before each promotion.

## 4:00-5:00 - Evidence and automation

Click **Verify chain**, export a Markdown report, and show the audit rows. Then show CI mode:

```bash
npm run cli -- validate --file examples/production.yaml --environment production --report report.md
npm run cli -- validate --file examples/invalid-production.yaml --environment production
```

The first command returns 0; the second returns 2. Finish by showing the GitHub Actions jobs for strict
typechecking, linting, unit coverage, real PostgreSQL integration tests, Docker build, and the full
container smoke workflow.

The automated equivalent is:

```bash
bash scripts/demo.sh
```
