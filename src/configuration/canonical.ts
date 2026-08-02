import { createHash } from 'node:crypto';
import type { ConfigValue } from '../types.js';

export function canonicalJson(value: ConfigValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(',')}}`;
}

export function contentHash(value: ConfigValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
