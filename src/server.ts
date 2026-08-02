import 'dotenv/config';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { Repository } from './db/repository.js';
import { loadRuntimeConfig } from './env.js';
import { loadPolicy } from './policy/engine.js';
import { GovernanceService } from './service.js';

const config = loadRuntimeConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool);
const repository = new Repository(pool);
const policy = await loadPolicy('policies/default.yaml');
const service = new GovernanceService(
  repository,
  policy,
  config.CONFIG_ENCRYPTION_KEY,
  config.SIGNING_KEY
);
const app = await buildApp({ repository, service, config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown started');
  await app.close();
  await pool.end();
  process.exitCode = 0;
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: '0.0.0.0', port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'server startup failed');
  await pool.end();
  process.exitCode = 1;
}
