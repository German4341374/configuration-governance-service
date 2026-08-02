import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';

try {
  await access('.env', constants.F_OK);
  console.log('.env already exists; no changes made');
} catch {
  const password = randomBytes(18).toString('hex');
  const encryptionKey = randomBytes(32).toString('base64');
  const signingKey = randomBytes(32).toString('hex');
  const content = [
    'NODE_ENV=development',
    'PORT=8080',
    'POSTGRES_PORT=5432',
    'LOG_LEVEL=info',
    'AUTH_MODE=demo',
    'POSTGRES_DB=governance',
    'POSTGRES_USER=governance',
    `POSTGRES_PASSWORD=${password}`,
    `DATABASE_URL=postgresql://governance:${password}@127.0.0.1:5432/governance`,
    `CONFIG_ENCRYPTION_KEY=${encryptionKey}`,
    `SIGNING_KEY=${signingKey}`,
    'MAX_UPLOAD_BYTES=262144',
    ''
  ].join('\n');
  await writeFile('.env', content, { encoding: 'utf8', mode: 0o600 });
  console.log('Created .env with random local-only credentials');
}
