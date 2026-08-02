import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { contentHash as hashValue } from '../configuration/canonical.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type {
  Actor,
  AuditEntry,
  ConfigFormat,
  ConfigObject,
  EnvironmentName,
  EnvironmentState,
  PolicyIssue,
  Revision
} from '../types.js';

export interface PrivateRevision extends Revision {
  encryptedContent: string;
}

export interface RevisionInput {
  environment: EnvironmentName;
  format: ConfigFormat;
  encryptedContent: string;
  redactedContent: ConfigObject;
  contentHash: string;
  manifestSignature: string | null;
  policyIssues: PolicyIssue[];
  createdBy: string;
  sourceRevisionId: string | null;
}

interface RevisionRow {
  id: string;
  environment: EnvironmentName;
  revision_number: number;
  format: ConfigFormat;
  encrypted_content: string;
  redacted_content: ConfigObject;
  content_hash: string;
  manifest_signature: string | null;
  policy_issues: PolicyIssue[];
  created_by: string;
  created_at: Date;
  source_revision_id: string | null;
  decision: Revision['decision'];
}

interface EnvironmentRow {
  environment: EnvironmentName;
  current_revision_id: string | null;
  lock_version: number;
  updated_at: Date;
}

interface AuditRow {
  id: string;
  sequence: string;
  action: string;
  actor: string;
  resource_type: string;
  resource_id: string;
  details: ConfigObject;
  previous_hash: string;
  entry_hash: string;
  created_at: Date;
}

const revisionSelect = `
  SELECT r.*,
    COALESCE((
      SELECT a.decision FROM approvals a
      WHERE a.revision_id = r.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1
    ), 'pending') AS decision
  FROM config_revisions r`;

export class Repository {
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async createRevision(input: RevisionInput): Promise<Revision> {
    return this.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `revision:${input.environment}`
      ]);
      const numberResult = await client.query<{ next: number }>(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM config_revisions WHERE environment = $1',
        [input.environment]
      );
      const duplicate = await client.query(
        'SELECT 1 FROM config_revisions WHERE environment = $1 AND content_hash = $2',
        [input.environment, input.contentHash]
      );
      if (duplicate.rowCount) {
        throw new ConflictError(
          'DUPLICATE_REVISION',
          'This configuration content already exists in the environment'
        );
      }
      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO config_revisions (
            id, environment, revision_number, format, encrypted_content, redacted_content,
            content_hash, manifest_signature, policy_issues, created_by, source_revision_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            input.environment,
            numberResult.rows[0]?.next ?? 1,
            input.format,
            input.encryptedContent,
            JSON.stringify(input.redactedContent),
            input.contentHash,
            input.manifestSignature,
            JSON.stringify(input.policyIssues),
            input.createdBy,
            input.sourceRevisionId
          ]
        );
      } catch (error) {
        if (postgresCode(error) === '23505') {
          throw new ConflictError(
            'DUPLICATE_REVISION',
            'This configuration content already exists in the environment'
          );
        }
        throw error;
      }
      await appendAudit(client, {
        action: 'revision.created',
        actor: input.createdBy,
        resourceType: 'revision',
        resourceId: id,
        details: { environment: input.environment, contentHash: input.contentHash }
      });
      return this.getRevisionWithClient(client, id);
    });
  }

  async listRevisions(environment?: EnvironmentName, limit = 50, offset = 0): Promise<Revision[]> {
    const values: unknown[] = [];
    const where = environment ? ' WHERE r.environment = $1' : '';
    if (environment) values.push(environment);
    values.push(limit, offset);
    const limitPosition = values.length - 1;
    const result = await this.pool.query<RevisionRow>(
      `${revisionSelect}${where} ORDER BY r.created_at DESC LIMIT $${limitPosition} OFFSET $${limitPosition + 1}`,
      values
    );
    return result.rows.map(toRevision);
  }

  async getRevision(id: string): Promise<Revision> {
    const result = await this.pool.query<RevisionRow>(`${revisionSelect} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Revision');
    return toRevision(row);
  }

  async getPrivateRevision(id: string): Promise<PrivateRevision> {
    const result = await this.pool.query<RevisionRow>(`${revisionSelect} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Revision');
    return { ...toRevision(row), encryptedContent: row.encrypted_content };
  }

  async recordDecision(
    revisionId: string,
    decision: 'approved' | 'rejected',
    actor: Actor,
    comment: string
  ): Promise<Revision> {
    return this.transaction(async (client) => {
      const revision = await this.getRevisionWithClient(client, revisionId);
      if (revision.createdBy === actor.name) {
        throw new ConflictError(
          'SEPARATION_OF_DUTIES',
          'A revision author cannot approve or reject their own revision'
        );
      }
      try {
        await client.query(
          'INSERT INTO approvals (id, revision_id, decision, actor, comment) VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(), revisionId, decision, actor.name, comment]
        );
      } catch (error) {
        if (postgresCode(error) === '23505') {
          throw new ConflictError(
            'DECISION_ALREADY_RECORDED',
            'This actor has already reviewed the revision'
          );
        }
        throw error;
      }
      await appendAudit(client, {
        action: `revision.${decision}`,
        actor: actor.name,
        resourceType: 'revision',
        resourceId: revisionId,
        details: { decision, commentProvided: comment.length > 0 }
      });
      return this.getRevisionWithClient(client, revisionId);
    });
  }

  async environmentStates(): Promise<EnvironmentState[]> {
    const result = await this.pool.query<EnvironmentRow>(
      'SELECT * FROM environment_state ORDER BY environment'
    );
    return result.rows.map(toEnvironmentState);
  }

  async activate(
    environment: EnvironmentName,
    revisionId: string,
    expectedVersion: number,
    actor: Actor,
    action: 'activate' | 'rollback'
  ): Promise<EnvironmentState> {
    return this.transaction(async (client) => {
      const revision = await this.getRevisionWithClient(client, revisionId);
      if (revision.environment !== environment) {
        throw new ConflictError(
          'ENVIRONMENT_MISMATCH',
          'Revision belongs to a different environment'
        );
      }
      if (revision.decision !== 'approved') {
        throw new ConflictError('APPROVAL_REQUIRED', 'Only approved revisions can be activated');
      }
      if (action === 'rollback') {
        const historical = await client.query(
          'SELECT 1 FROM promotions WHERE environment = $1 AND to_revision_id = $2 LIMIT 1',
          [environment, revisionId]
        );
        if (!historical.rowCount) {
          throw new ConflictError(
            'ROLLBACK_TARGET_INVALID',
            'Rollback target was never active in this environment'
          );
        }
      }
      const state = await this.updateEnvironment(
        client,
        environment,
        revisionId,
        expectedVersion,
        actor,
        action
      );
      await appendAudit(client, {
        action: `environment.${action}`,
        actor: actor.name,
        resourceType: 'environment',
        resourceId: environment,
        details: { revisionId, lockVersion: state.lockVersion }
      });
      return state;
    });
  }

  async promote(
    input: RevisionInput,
    expectedVersion: number,
    actor: Actor
  ): Promise<{ revision: Revision; state: EnvironmentState }> {
    return this.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `revision:${input.environment}`
      ]);
      const numberResult = await client.query<{ next: number }>(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM config_revisions WHERE environment = $1',
        [input.environment]
      );
      const duplicate = await client.query(
        'SELECT 1 FROM config_revisions WHERE environment = $1 AND content_hash = $2',
        [input.environment, input.contentHash]
      );
      if (duplicate.rowCount) {
        throw new ConflictError(
          'DUPLICATE_PROMOTION',
          'Equivalent configuration already exists in the target environment'
        );
      }
      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO config_revisions (
            id, environment, revision_number, format, encrypted_content, redacted_content,
            content_hash, manifest_signature, policy_issues, created_by, source_revision_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            input.environment,
            numberResult.rows[0]?.next ?? 1,
            input.format,
            input.encryptedContent,
            JSON.stringify(input.redactedContent),
            input.contentHash,
            input.manifestSignature,
            JSON.stringify(input.policyIssues),
            input.createdBy,
            input.sourceRevisionId
          ]
        );
      } catch (error) {
        if (postgresCode(error) === '23505') {
          throw new ConflictError(
            'DUPLICATE_PROMOTION',
            'Equivalent configuration already exists in the target environment'
          );
        }
        throw error;
      }
      await client.query(
        'INSERT INTO approvals (id, revision_id, decision, actor, comment) VALUES ($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          id,
          'approved',
          `promotion:${actor.name}`,
          'Inherited from approved source revision'
        ]
      );
      const state = await this.updateEnvironment(
        client,
        input.environment,
        id,
        expectedVersion,
        actor,
        'promote'
      );
      await appendAudit(client, {
        action: 'environment.promote',
        actor: actor.name,
        resourceType: 'environment',
        resourceId: input.environment,
        details: {
          sourceRevisionId: input.sourceRevisionId,
          revisionId: id,
          lockVersion: state.lockVersion
        }
      });
      return { revision: await this.getRevisionWithClient(client, id), state };
    });
  }

  async auditEntries(limit = 100): Promise<AuditEntry[]> {
    const result = await this.pool.query<AuditRow>(
      'SELECT * FROM audit_log ORDER BY sequence DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(toAuditEntry);
  }

  async verifyAuditChain(): Promise<{ valid: boolean; entries: number; brokenAt: number | null }> {
    const result = await this.pool.query<AuditRow>('SELECT * FROM audit_log ORDER BY sequence');
    let previousHash = 'GENESIS';
    for (const row of result.rows) {
      const expected = auditHash(previousHash, {
        action: row.action,
        actor: row.actor,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: row.details,
        createdAt: row.created_at.toISOString()
      });
      if (row.previous_hash !== previousHash || row.entry_hash !== expected) {
        return { valid: false, entries: result.rows.length, brokenAt: Number(row.sequence) };
      }
      previousHash = row.entry_hash;
    }
    return { valid: true, entries: result.rows.length, brokenAt: null };
  }

  private async updateEnvironment(
    client: PoolClient,
    environment: EnvironmentName,
    revisionId: string,
    expectedVersion: number,
    actor: Actor,
    action: 'activate' | 'promote' | 'rollback'
  ): Promise<EnvironmentState> {
    const currentResult = await client.query<EnvironmentRow>(
      'SELECT * FROM environment_state WHERE environment = $1 FOR UPDATE',
      [environment]
    );
    const current = currentResult.rows[0];
    if (!current) throw new NotFoundError('Environment');
    if (current.lock_version !== expectedVersion) {
      throw new ConflictError('VERSION_CONFLICT', 'Environment was changed by another request', {
        expectedVersion,
        currentVersion: current.lock_version
      });
    }
    if (current.current_revision_id === revisionId) {
      throw new ConflictError('ALREADY_ACTIVE', 'Revision is already active');
    }
    const updatedResult = await client.query<EnvironmentRow>(
      `UPDATE environment_state SET current_revision_id = $1, lock_version = lock_version + 1, updated_at = now()
       WHERE environment = $2 AND lock_version = $3 RETURNING *`,
      [revisionId, environment, expectedVersion]
    );
    const updated = updatedResult.rows[0];
    if (!updated)
      throw new ConflictError('VERSION_CONFLICT', 'Environment was changed by another request');
    await client.query(
      `INSERT INTO promotions (id, environment, from_revision_id, to_revision_id, action, actor)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), environment, current.current_revision_id, revisionId, action, actor.name]
    );
    return toEnvironmentState(updated);
  }

  private async getRevisionWithClient(client: PoolClient, id: string): Promise<Revision> {
    const result = await client.query<RevisionRow>(`${revisionSelect} WHERE r.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Revision');
    return toRevision(row);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function appendAudit(
  client: PoolClient,
  input: {
    action: string;
    actor: string;
    resourceType: string;
    resourceId: string;
    details: ConfigObject;
  }
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('configuration-governance-audit'))`);
  const previousResult = await client.query<{ entry_hash: string }>(
    'SELECT entry_hash FROM audit_log ORDER BY sequence DESC LIMIT 1'
  );
  const previousHash = previousResult.rows[0]?.entry_hash ?? 'GENESIS';
  const createdAt = new Date().toISOString();
  const entryHash = auditHash(previousHash, { ...input, createdAt });
  await client.query(
    `INSERT INTO audit_log (
      id, action, actor, resource_type, resource_id, details, previous_hash, entry_hash, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      input.action,
      input.actor,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.details),
      previousHash,
      entryHash,
      createdAt
    ]
  );
}

function auditHash(
  previousHash: string,
  input: {
    action: string;
    actor: string;
    resourceType: string;
    resourceId: string;
    details: ConfigObject;
    createdAt: string;
  }
): string {
  return hashValue({
    previousHash,
    action: input.action,
    actor: input.actor,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    details: input.details,
    createdAt: input.createdAt
  });
}

function toRevision(row: RevisionRow): Revision {
  return {
    id: row.id,
    environment: row.environment,
    revisionNumber: row.revision_number,
    format: row.format,
    redactedContent: row.redacted_content,
    contentHash: row.content_hash,
    manifestSignature: row.manifest_signature,
    policyIssues: row.policy_issues,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    sourceRevisionId: row.source_revision_id,
    decision: row.decision
  };
}

function toEnvironmentState(row: EnvironmentRow): EnvironmentState {
  return {
    environment: row.environment,
    currentRevisionId: row.current_revision_id,
    lockVersion: row.lock_version,
    updatedAt: row.updated_at.toISOString()
  };
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    action: row.action,
    actor: row.actor,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    previousHash: row.previous_hash,
    entryHash: row.entry_hash,
    createdAt: row.created_at.toISOString()
  };
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
