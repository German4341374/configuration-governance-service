import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTH_MODE: z.enum(['demo', 'trusted_headers']).default('demo'),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  CONFIG_ENCRYPTION_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key'),
  SIGNING_KEY: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(262_144)
});

export type RuntimeConfig = z.infer<typeof schema>;

export function loadRuntimeConfig(input: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = schema.parse(input);
  if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'demo') {
    throw new Error('AUTH_MODE=demo is forbidden when NODE_ENV=production');
  }
  return config;
}
