import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { AppError } from '../errors.js';

export function encryptContent(content: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64')
  ].join('.');
}

export function decryptContent(envelope: string, base64Key: string): string {
  const [version, ivValue, tagValue, dataValue] = envelope.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !dataValue) {
    throw new AppError(500, 'INVALID_CIPHERTEXT', 'Stored configuration envelope is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(base64Key, 'base64'),
    Buffer.from(ivValue, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataValue, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function signManifest(
  environment: string,
  hash: string,
  signingKey?: string
): string | null {
  if (!signingKey) return null;
  return createHmac('sha256', signingKey).update(`${environment}:${hash}`).digest('hex');
}

export function verifyManifest(
  environment: string,
  hash: string,
  signature: string,
  signingKey?: string
): boolean {
  const expected = signManifest(environment, hash, signingKey);
  if (expected?.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
