#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { contentHash } from './configuration/canonical.js';
import { parseConfiguration } from './configuration/parser.js';
import { markdownReport } from './configuration/report.js';
import { loadPolicy, validatePolicy } from './policy/engine.js';
import { environments, formats, type ConfigFormat, type EnvironmentName } from './types.js';

const [command, ...arguments_] = process.argv.slice(2);
if (command !== 'validate') {
  console.error(
    'Usage: npm run cli -- validate --file <path> --environment <name> [--format auto] [--report report.md]'
  );
  process.exitCode = 3;
} else {
  try {
    const { values } = parseArgs({
      args: arguments_,
      options: {
        file: { type: 'string' },
        environment: { type: 'string' },
        format: { type: 'string', default: 'auto' },
        policy: { type: 'string', default: 'policies/default.yaml' },
        report: { type: 'string' }
      }
    });
    if (
      !values.file ||
      !values.environment ||
      !environments.includes(values.environment as EnvironmentName)
    ) {
      throw new Error('--file and a valid --environment are required');
    }
    const format = detectFormat(values.file, values.format);
    const configuration = parseConfiguration(await readFile(values.file, 'utf8'), format);
    const issues = validatePolicy(
      configuration,
      values.environment as EnvironmentName,
      await loadPolicy(values.policy)
    );
    const report = markdownReport({
      title: `CI configuration validation: ${values.file}`,
      environment: values.environment as EnvironmentName,
      hash: contentHash(configuration),
      issues
    });
    if (values.report) await writeFile(values.report, report, 'utf8');
    console.log(report);
    process.exitCode = issues.some((issue) => issue.severity === 'error') ? 2 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 3;
  }
}

function detectFormat(file: string, requested: string): ConfigFormat {
  if (formats.includes(requested as ConfigFormat)) return requested as ConfigFormat;
  if (requested !== 'auto') throw new Error(`Unsupported format: ${requested}`);
  const extension = extname(file).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.yaml' || extension === '.yml') return 'yaml';
  if (extension === '.env') return 'env';
  throw new Error('Unable to detect format; pass --format json|yaml|env');
}
