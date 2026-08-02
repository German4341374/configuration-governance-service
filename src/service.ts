import { canonicalJson, contentHash } from './configuration/canonical.js';
import {
  decryptContent,
  encryptContent,
  signManifest,
  verifyManifest
} from './configuration/crypto.js';
import { diffValues } from './configuration/diff.js';
import { parseConfiguration } from './configuration/parser.js';
import { markdownReport } from './configuration/report.js';
import { maskSecrets } from './configuration/secrets.js';
import type { Repository } from './db/repository.js';
import { AppError, ConflictError } from './errors.js';
import { validatePolicy, type PolicyDefinition } from './policy/engine.js';
import type { Actor, ConfigFormat, EnvironmentName } from './types.js';

export class GovernanceService {
  constructor(
    private readonly repository: Repository,
    private readonly policy: PolicyDefinition,
    private readonly encryptionKey: string,
    private readonly signingKey?: string
  ) {}

  async upload(input: {
    environment: EnvironmentName;
    format: ConfigFormat;
    content: string;
    actor: Actor;
    signature?: string;
  }) {
    const configuration = parseConfiguration(input.content, input.format);
    const hash = contentHash(configuration);
    if (
      input.signature &&
      !verifyManifest(input.environment, hash, input.signature, this.signingKey)
    ) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Client manifest signature is invalid');
    }
    const policyIssues = validatePolicy(configuration, input.environment, this.policy);
    return this.repository.createRevision({
      environment: input.environment,
      format: input.format,
      encryptedContent: encryptContent(canonicalJson(configuration), this.encryptionKey),
      redactedContent: maskSecrets(configuration),
      contentHash: hash,
      manifestSignature: signManifest(input.environment, hash, this.signingKey),
      policyIssues,
      createdBy: input.actor.name,
      sourceRevisionId: null
    });
  }

  async decision(
    revisionId: string,
    decision: 'approved' | 'rejected',
    actor: Actor,
    comment: string
  ) {
    const revision = await this.repository.getRevision(revisionId);
    if (
      decision === 'approved' &&
      revision.policyIssues.some((issue) => issue.severity === 'error')
    ) {
      throw new ConflictError(
        'POLICY_FAILURE',
        'Revision with policy errors cannot be approved',
        revision.policyIssues
      );
    }
    return this.repository.recordDecision(revisionId, decision, actor, comment);
  }

  async compare(fromId: string, toId: string) {
    const [from, to] = await Promise.all([
      this.repository.getRevision(fromId),
      this.repository.getRevision(toId)
    ]);
    return {
      from: from.id,
      to: to.id,
      entries: diffValues(from.redactedContent, to.redactedContent)
    };
  }

  async report(revisionId: string, compareTo?: string): Promise<string> {
    const revision = await this.repository.getRevision(revisionId);
    const diff = compareTo ? (await this.compare(compareTo, revisionId)).entries : undefined;
    return markdownReport({
      title: `Configuration revision ${revision.environment} #${revision.revisionNumber}`,
      environment: revision.environment,
      hash: revision.contentHash,
      issues: revision.policyIssues,
      ...(diff ? { diff } : {})
    });
  }

  async manifest(revisionId: string) {
    const revision = await this.repository.getRevision(revisionId);
    return {
      revisionId: revision.id,
      environment: revision.environment,
      contentHash: revision.contentHash,
      algorithm: revision.manifestSignature ? 'HMAC-SHA256' : null,
      signature: revision.manifestSignature
    };
  }

  async promote(input: {
    sourceRevisionId: string;
    targetEnvironment: EnvironmentName;
    expectedVersion: number;
    actor: Actor;
  }) {
    const source = await this.repository.getPrivateRevision(input.sourceRevisionId);
    if (source.decision !== 'approved') {
      throw new ConflictError(
        'APPROVAL_REQUIRED',
        'Source revision must be approved before promotion'
      );
    }
    if (!isNextEnvironment(source.environment, input.targetEnvironment)) {
      throw new ConflictError(
        'INVALID_PROMOTION_PATH',
        'Promotion must follow development -> staging -> production'
      );
    }
    const configuration = JSON.parse(
      decryptContent(source.encryptedContent, this.encryptionKey)
    ) as Record<string, never>;
    const policyIssues = validatePolicy(configuration, input.targetEnvironment, this.policy);
    if (policyIssues.some((issue) => issue.severity === 'error')) {
      throw new ConflictError(
        'TARGET_POLICY_FAILURE',
        'Configuration violates target environment policies',
        policyIssues
      );
    }
    const hash = contentHash(configuration);
    return this.repository.promote(
      {
        environment: input.targetEnvironment,
        format: source.format,
        encryptedContent: encryptContent(canonicalJson(configuration), this.encryptionKey),
        redactedContent: maskSecrets(configuration),
        contentHash: hash,
        manifestSignature: signManifest(input.targetEnvironment, hash, this.signingKey),
        policyIssues,
        createdBy: input.actor.name,
        sourceRevisionId: source.id
      },
      input.expectedVersion,
      input.actor
    );
  }

  async activate(
    environment: EnvironmentName,
    revisionId: string,
    expectedVersion: number,
    actor: Actor
  ) {
    return this.repository.activate(environment, revisionId, expectedVersion, actor, 'activate');
  }

  async rollback(
    environment: EnvironmentName,
    revisionId: string,
    expectedVersion: number,
    actor: Actor
  ) {
    return this.repository.activate(environment, revisionId, expectedVersion, actor, 'rollback');
  }
}

function isNextEnvironment(source: EnvironmentName, target: EnvironmentName): boolean {
  return (
    (source === 'development' && target === 'staging') ||
    (source === 'staging' && target === 'production')
  );
}
