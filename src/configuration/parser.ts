import YAML from 'yaml';
import { AppError } from '../errors.js';
import type { ConfigFormat, ConfigObject, ConfigValue } from '../types.js';

export function parseConfiguration(content: string, format: ConfigFormat): ConfigObject {
  try {
    const parsed = format === 'env' ? parseEnv(content) : parseStructured(content, format);
    if (!isObject(parsed)) {
      throw new AppError(400, 'INVALID_ROOT', 'Configuration root must be an object');
    }
    return normalizeObject(parsed);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown parse failure';
    throw new AppError(400, 'INVALID_CONFIGURATION', `Unable to parse ${format}: ${message}`);
  }
}

function parseStructured(content: string, format: Exclude<ConfigFormat, 'env'>): unknown {
  return format === 'json' ? JSON.parse(content) : YAML.parse(content, { maxAliasCount: 20 });
}

function parseEnv(content: string): ConfigObject {
  const result: ConfigObject = {};
  for (const [index, rawLine] of content.replaceAll('\r\n', '\n').split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = assignment.indexOf('=');
    if (separator < 1) {
      throw new AppError(400, 'INVALID_ENV_LINE', `Invalid .env assignment on line ${index + 1}`);
    }
    const key = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new AppError(400, 'INVALID_ENV_KEY', `Invalid .env key on line ${index + 1}`);
    }
    let value = assignment.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value.replaceAll('\\n', '\n');
  }
  return result;
}

function normalizeObject(value: Record<string, unknown>): ConfigObject {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeValue(entry)])
  );
}

function normalizeValue(value: unknown): ConfigValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new AppError(400, 'INVALID_NUMBER', 'NaN and Infinity are not supported');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (isObject(value)) return normalizeObject(value);
  throw new AppError(400, 'INVALID_VALUE', `Unsupported value type: ${typeof value}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
