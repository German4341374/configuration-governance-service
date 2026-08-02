import type { DiffEntry, EnvironmentName, PolicyIssue } from '../types.js';

export function markdownReport(input: {
  title: string;
  environment: EnvironmentName;
  hash: string;
  issues: PolicyIssue[];
  diff?: DiffEntry[];
}): string {
  const lines = [
    `# ${input.title}`,
    '',
    `- Environment: \`${input.environment}\``,
    `- SHA-256: \`${input.hash}\``,
    `- Policy result: **${input.issues.some((issue) => issue.severity === 'error') ? 'FAIL' : 'PASS'}**`,
    '',
    '## Policy findings',
    ''
  ];
  if (input.issues.length === 0) lines.push('No policy findings.');
  for (const issue of input.issues) {
    lines.push(
      `- **${issue.severity.toUpperCase()} ${issue.code}** at \`${issue.path}\`: ${issue.message}`
    );
  }
  if (input.diff) {
    lines.push('', '## Revision diff', '');
    if (input.diff.length === 0) lines.push('No differences.');
    for (const entry of input.diff) lines.push(`- \`${entry.path}\`: ${entry.kind}`);
  }
  lines.push('');
  return lines.join('\n');
}
