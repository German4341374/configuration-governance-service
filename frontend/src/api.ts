export type EnvironmentName = 'development' | 'staging' | 'production';
export type Role = 'viewer' | 'editor' | 'approver' | 'deployer' | 'admin';

export interface EnvironmentState {
  environment: EnvironmentName;
  currentRevisionId: string | null;
  lockVersion: number;
  updatedAt: string;
}

export interface Revision {
  id: string;
  environment: EnvironmentName;
  revisionNumber: number;
  format: 'json' | 'yaml' | 'env';
  redactedContent: Record<string, unknown>;
  contentHash: string;
  policyIssues: { code: string; path: string; message: string; severity: string }[];
  createdBy: string;
  createdAt: string;
  decision: 'pending' | 'approved' | 'rejected';
}

export interface AuditEntry {
  id: string;
  sequence: number;
  action: string;
  actor: string;
  resourceId: string;
  entryHash: string;
  createdAt: string;
}

export class ApiClient {
  constructor(
    private readonly actor: string,
    private readonly role: Role
  ) {}

  environments() {
    return this.request<{ environments: EnvironmentState[] }>('/api/environments');
  }

  revisions() {
    return this.request<{ revisions: Revision[] }>('/api/revisions?limit=100');
  }

  audit() {
    return this.request<{ entries: AuditEntry[] }>('/api/audit?limit=20');
  }

  verifyAudit() {
    return this.request<{ valid: boolean; entries: number; brokenAt: number | null }>(
      '/api/audit/verify'
    );
  }

  upload(body: { environment: EnvironmentName; format: Revision['format']; content: string }) {
    return this.request<{ revision: Revision }>('/api/revisions', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  decide(id: string, decision: 'approved' | 'rejected', comment: string) {
    return this.request<{ revision: Revision }>(`/api/revisions/${id}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment })
    });
  }

  activate(environment: EnvironmentName, revisionId: string, expectedVersion: number) {
    return this.request(`/api/environments/${environment}/activate`, {
      method: 'POST',
      body: JSON.stringify({ revisionId, expectedVersion })
    });
  }

  rollback(environment: EnvironmentName, revisionId: string, expectedVersion: number) {
    return this.request(`/api/environments/${environment}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ revisionId, expectedVersion })
    });
  }

  promote(environment: EnvironmentName, sourceRevisionId: string, expectedVersion: number) {
    return this.request(`/api/environments/${environment}/promotions`, {
      method: 'POST',
      body: JSON.stringify({ sourceRevisionId, expectedVersion })
    });
  }

  diff(from: string, to: string) {
    return this.request<{ entries: { path: string; kind: string }[] }>(
      `/api/diff?from=${from}&to=${to}`
    );
  }

  async report(id: string): Promise<string> {
    const response = await fetch(`/api/revisions/${id}/report.md`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Report request failed with ${response.status}`);
    return response.text();
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = this.headers(init.headers);
    const response = await fetch(path, {
      ...init,
      headers
    });
    const result = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok)
      throw new Error(result.error?.message ?? `Request failed with ${response.status}`);
    return result;
  }

  private headers(initial?: HeadersInit): Headers {
    const headers = new Headers(initial);
    headers.set('content-type', 'application/json');
    headers.set('x-actor', this.actor);
    headers.set('x-role', this.role);
    return headers;
  }
}
