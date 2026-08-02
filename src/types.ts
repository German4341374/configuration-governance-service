export const environments = ['development', 'staging', 'production'] as const;
export type EnvironmentName = (typeof environments)[number];

export const formats = ['json', 'yaml', 'env'] as const;
export type ConfigFormat = (typeof formats)[number];

export type Scalar = string | number | boolean | null;
export type ConfigValue = Scalar | ConfigValue[] | { [key: string]: ConfigValue };
export type ConfigObject = Record<string, ConfigValue>;

export type Role = 'viewer' | 'editor' | 'approver' | 'deployer' | 'admin';

export interface Actor {
  name: string;
  role: Role;
}

export interface PolicyIssue {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface Revision {
  id: string;
  environment: EnvironmentName;
  revisionNumber: number;
  format: ConfigFormat;
  redactedContent: ConfigObject;
  contentHash: string;
  manifestSignature: string | null;
  policyIssues: PolicyIssue[];
  createdBy: string;
  createdAt: string;
  sourceRevisionId: string | null;
  decision: 'pending' | 'approved' | 'rejected';
}

export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed' | 'type-changed';
  before?: ConfigValue;
  after?: ConfigValue;
}

export interface EnvironmentState {
  environment: EnvironmentName;
  currentRevisionId: string | null;
  lockVersion: number;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  sequence: number;
  action: string;
  actor: string;
  resourceType: string;
  resourceId: string;
  details: ConfigObject;
  previousHash: string;
  entryHash: string;
  createdAt: string;
}
