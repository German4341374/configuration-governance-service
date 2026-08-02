import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';
import type { ConfigObject, ConfigValue, EnvironmentName, PolicyIssue } from '../types.js';

const environmentList = z.array(z.enum(['development', 'staging', 'production']));
const policySchema = z.object({
  required: z.array(z.object({ path: z.string(), environments: environmentList })).default([]),
  types: z
    .array(
      z.object({
        path: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'object', 'array'])
      })
    )
    .default([]),
  forbiddenValues: z
    .array(
      z.object({ path: z.string(), values: z.array(z.unknown()), environments: environmentList })
    )
    .default([]),
  naming: z.object({ keyPattern: z.string() }),
  production: z.object({
    tls: z.object({ path: z.string(), requiredValue: z.boolean() }),
    maximumTimeout: z.object({ path: z.string(), value: z.number().positive() }),
    debugFlags: z.array(z.string()),
    forbiddenHosts: z.object({ path: z.string(), values: z.array(z.string()) })
  })
});

export type PolicyDefinition = z.infer<typeof policySchema>;

export async function loadPolicy(path: string): Promise<PolicyDefinition> {
  const content = await readFile(path, 'utf8');
  return policySchema.parse(YAML.parse(content));
}

export function validatePolicy(
  configuration: ConfigObject,
  environment: EnvironmentName,
  policy: PolicyDefinition
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];

  for (const rule of policy.required) {
    if (
      rule.environments.includes(environment) &&
      getPath(configuration, rule.path) === undefined
    ) {
      issues.push(issue('REQUIRED_PARAMETER', rule.path, 'Required parameter is missing'));
    }
  }

  for (const rule of policy.types) {
    const value = getPath(configuration, rule.path);
    if (value !== undefined && valueType(value) !== rule.type) {
      issues.push(
        issue('TYPE_MISMATCH', rule.path, `Expected ${rule.type}, received ${valueType(value)}`)
      );
    }
  }

  for (const rule of policy.forbiddenValues) {
    const value = getPath(configuration, rule.path);
    if (
      rule.environments.includes(environment) &&
      rule.values.some((forbidden) => deepEqual(value, forbidden))
    ) {
      issues.push(issue('FORBIDDEN_VALUE', rule.path, 'Value is forbidden by policy'));
    }
  }

  const keyPattern = new RegExp(policy.naming.keyPattern);
  walkKeys(configuration, '', (path, key) => {
    if (!keyPattern.test(key))
      issues.push(issue('INVALID_NAME', path, `Key '${key}' violates naming convention`));
  });

  if (environment === 'production') {
    const production = policy.production;
    if (getPath(configuration, production.tls.path) !== production.tls.requiredValue) {
      issues.push(issue('TLS_REQUIRED', production.tls.path, 'TLS must be enabled in production'));
    }
    const timeout = getPath(configuration, production.maximumTimeout.path);
    if (typeof timeout === 'number' && timeout > production.maximumTimeout.value) {
      issues.push(
        issue(
          'TIMEOUT_EXCEEDED',
          production.maximumTimeout.path,
          `Maximum production timeout is ${production.maximumTimeout.value} ms`
        )
      );
    }
    for (const path of production.debugFlags) {
      if (isEnabled(getPath(configuration, path))) {
        issues.push(issue('DEBUG_FORBIDDEN', path, 'Debug flags are forbidden in production'));
      }
    }
    const host = getPath(configuration, production.forbiddenHosts.path);
    if (typeof host === 'string' && production.forbiddenHosts.values.includes(host)) {
      issues.push(
        issue(
          'PRODUCTION_HOST_FORBIDDEN',
          production.forbiddenHosts.path,
          'Local host is forbidden in production'
        )
      );
    }
  }

  return issues;
}

function getPath(root: ConfigObject, path: string): ConfigValue | undefined {
  let current: ConfigValue = root;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    const objectValue: ConfigObject = current;
    const next: ConfigValue | undefined = objectValue[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function valueType(value: ConfigValue): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function issue(code: string, path: string, message: string): PolicyIssue {
  return { code, path, message, severity: 'error' };
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEnabled(value: ConfigValue | undefined): boolean {
  return (
    value === true ||
    (typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.toLowerCase()))
  );
}

function walkKeys(
  value: ConfigValue,
  path: string,
  visitor: (path: string, key: string) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkKeys(entry, `${path}[${index}]`, visitor));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    visitor(childPath, key);
    walkKeys(entry, childPath, visitor);
  }
}
