import 'dotenv/config';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url);
try {
  await migrate(pool);
  console.log('Database migrations completed');
} finally {
  await pool.end();
}
