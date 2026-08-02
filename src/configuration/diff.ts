import type { ConfigValue, DiffEntry } from '../types.js';

export function diffValues(before: ConfigValue, after: ConfigValue, path = ''): DiffEntry[] {
  if (Object.is(before, after)) return [];
  const beforeType = valueType(before);
  const afterType = valueType(after);
  if (beforeType !== afterType) return [{ path: path || '$', kind: 'type-changed', before, after }];

  if (beforeType === 'object') {
    const left = before as Record<string, ConfigValue>;
    const right = after as Record<string, ConfigValue>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in left))
        return [{ path: childPath, kind: 'added' as const, after: right[key] as ConfigValue }];
      if (!(key in right))
        return [{ path: childPath, kind: 'removed' as const, before: left[key] as ConfigValue }];
      return diffValues(left[key] as ConfigValue, right[key] as ConfigValue, childPath);
    });
  }

  if (beforeType === 'array') {
    const left = before as ConfigValue[];
    const right = after as ConfigValue[];
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) => index).flatMap((index) => {
      const childPath = `${path}[${index}]`;
      if (index >= left.length)
        return [{ path: childPath, kind: 'added' as const, after: right[index] as ConfigValue }];
      if (index >= right.length)
        return [{ path: childPath, kind: 'removed' as const, before: left[index] as ConfigValue }];
      return diffValues(left[index] as ConfigValue, right[index] as ConfigValue, childPath);
    });
  }

  return [{ path: path || '$', kind: 'changed', before, after }];
}

function valueType(value: ConfigValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
