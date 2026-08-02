import type { ConfigObject, ConfigValue } from '../types.js';

const secretKey =
  /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|connection[_-]?string)/i;
export const redactedValue = '***REDACTED***';

export function isSecretPath(path: string): boolean {
  return path.split('.').some((part) => secretKey.test(part));
}

export function maskSecrets(value: ConfigObject): ConfigObject {
  return maskValue(value, '') as ConfigObject;
}

function maskValue(value: ConfigValue, path: string): ConfigValue {
  if (path && isSecretPath(path)) return redactedValue;
  if (Array.isArray(value))
    return value.map((entry, index) => maskValue(entry, `${path}[${index}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        maskValue(entry, path ? `${path}.${key}` : key)
      ])
    );
  }
  return value;
}
