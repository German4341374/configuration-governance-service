import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ApiClient,
  type AuditEntry,
  type EnvironmentName,
  type EnvironmentState,
  type Revision,
  type Role
} from './api';
import './styles.css';

const sample = `app:
  name: payments-api
  debug: false
  mode: safe
server:
  timeoutMs: 5000
transport:
  tls:
    enabled: true
database:
  host: postgres.internal
  password: demo-placeholder`;

function App() {
  const [actor, setActor] = useState('demo-admin');
  const [role, setRole] = useState<Role>('admin');
  const [states, setStates] = useState<EnvironmentState[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [compareTo, setCompareTo] = useState<string>('');
  const [diff, setDiff] = useState<{ path: string; kind: string }[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentName>('development');
  const [format, setFormat] = useState<Revision['format']>('yaml');
  const [content, setContent] = useState(sample);
  const [message, setMessage] = useState('Ready');
  const client = useMemo(() => new ApiClient(actor, role), [actor, role]);

  const refresh = useCallback(async () => {
    try {
      const [environmentData, revisionData, auditData] = await Promise.all([
        client.environments(),
        client.revisions(),
        client.audit()
      ]);
      setStates(environmentData.environments);
      setRevisions(revisionData.revisions);
      setAudit(auditData.entries);
      setMessage('Data refreshed');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refresh failed');
    }
  }, [client]);

  useEffect(() => void refresh(), [refresh]);
  const revision = revisions.find((item) => item.id === selected);
  const state = states.find((item) => item.environment === revision?.environment);

  async function run(label: string, operation: () => Promise<unknown>) {
    try {
      setMessage(`${label}...`);
      await operation();
      await refresh();
      setMessage(`${label} completed`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed`);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setContent(await file.text());
    if (file.name.endsWith('.json')) setFormat('json');
    else if (file.name.endsWith('.env')) setFormat('env');
    else setFormat('yaml');
  }

  async function downloadReport(id: string) {
    const markdown = await client.report(id);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `revision-${id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const nextEnvironment =
    revision?.environment === 'development'
      ? 'staging'
      : revision?.environment === 'staging'
        ? 'production'
        : null;
  const nextState = states.find((item) => item.environment === nextEnvironment);

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Configuration control plane</p>
          <h1>Governance without mutable config</h1>
          <p className="subtitle">
            Validate, approve, promote and roll back with an attributable audit trail.
          </p>
        </div>
        <div className="identity">
          <label>
            Actor
            <input value={actor} onChange={(event) => setActor(event.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {['viewer', 'editor', 'approver', 'deployer', 'admin'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="environment-grid">
        {states.map((item) => (
          <article className="environment" key={item.environment}>
            <span>{item.environment}</span>
            <strong>v{item.lockVersion}</strong>
            <small>
              {item.currentRevisionId ? item.currentRevisionId.slice(0, 8) : 'No active revision'}
            </small>
          </article>
        ))}
      </section>

      <section className="workspace">
        <article className="panel upload">
          <div className="panel-title">
            <div>
              <p className="eyebrow">New revision</p>
              <h2>Upload configuration</h2>
            </div>
          </div>
          <div className="row">
            <label>
              Environment
              <select
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as EnvironmentName)}
              >
                {['development', 'staging', 'production'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Format
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as Revision['format'])}
              >
                <option value="yaml">YAML</option>
                <option value="json">JSON</option>
                <option value="env">.env</option>
              </select>
            </label>
            <label className="file">
              Load file
              <input
                type="file"
                accept=".json,.yaml,.yml,.env"
                onChange={(event) => void loadFile(event.target.files?.[0])}
              />
            </label>
          </div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
          />
          <button
            onClick={() =>
              void run('Upload', () => client.upload({ environment, format, content }))
            }
          >
            Create immutable revision
          </button>
        </article>

        <article className="panel revisions">
          <div className="panel-title">
            <div>
              <p className="eyebrow">History</p>
              <h2>Revisions</h2>
            </div>
            <button className="secondary" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          <div className="revision-list">
            {revisions.map((item) => (
              <button
                className={selected === item.id ? 'revision active' : 'revision'}
                key={item.id}
                onClick={() => setSelected(item.id)}
              >
                <span>
                  <strong>
                    {item.environment} #{item.revisionNumber}
                  </strong>
                  <small>{item.createdBy}</small>
                </span>
                <span className={`badge ${item.decision}`}>{item.decision}</span>
              </button>
            ))}
          </div>
        </article>
      </section>

      {revision && (
        <section className="panel detail">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Selected revision</p>
              <h2>
                {revision.environment} #{revision.revisionNumber}
              </h2>
            </div>
            <code>{revision.contentHash.slice(0, 16)}…</code>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                void run('Approval', () =>
                  client.decide(revision.id, 'approved', 'Reviewed in web interface')
                )
              }
            >
              Approve
            </button>
            <button
              className="danger"
              onClick={() =>
                void run('Rejection', () =>
                  client.decide(revision.id, 'rejected', 'Rejected in web interface')
                )
              }
            >
              Reject
            </button>
            <button
              className="secondary"
              disabled={!state}
              onClick={() =>
                state &&
                void run('Activation', () =>
                  client.activate(revision.environment, revision.id, state.lockVersion)
                )
              }
            >
              Activate
            </button>
            <button
              className="secondary"
              disabled={!state}
              onClick={() =>
                state &&
                void run('Rollback', () =>
                  client.rollback(revision.environment, revision.id, state.lockVersion)
                )
              }
            >
              Rollback
            </button>
            <button
              className="secondary"
              disabled={!nextEnvironment || !nextState}
              onClick={() =>
                nextEnvironment &&
                nextState &&
                void run('Promotion', () =>
                  client.promote(nextEnvironment, revision.id, nextState.lockVersion)
                )
              }
            >
              Promote
            </button>
            <button
              className="secondary"
              onClick={() => void run('Report export', () => downloadReport(revision.id))}
            >
              Markdown report
            </button>
          </div>
          {revision.policyIssues.length > 0 && (
            <div className="issues">
              {revision.policyIssues.map((item) => (
                <p key={`${item.code}-${item.path}`}>
                  <strong>{item.code}</strong> {item.path}: {item.message}
                </p>
              ))}
            </div>
          )}
          <pre>{JSON.stringify(revision.redactedContent, null, 2)}</pre>
          <div className="compare">
            <label>
              Compare with
              <select value={compareTo} onChange={(event) => setCompareTo(event.target.value)}>
                <option value="">Select revision</option>
                {revisions
                  .filter((item) => item.id !== revision.id)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.environment} #{item.revisionNumber}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={!compareTo}
              onClick={() =>
                void run('Diff', async () =>
                  setDiff((await client.diff(compareTo, revision.id)).entries)
                )
              }
            >
              Compare
            </button>
          </div>
          {diff.length > 0 && (
            <ul className="diff">
              {diff.map((item) => (
                <li key={`${item.path}-${item.kind}`}>
                  <code>{item.path}</code>
                  <span>{item.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="panel audit">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Tamper-evident trail</p>
            <h2>Audit log</h2>
          </div>
          <button
            className="secondary"
            onClick={() =>
              void run('Audit verification', async () => {
                const result = await client.verifyAudit();
                setMessage(
                  `Audit chain: ${result.valid ? 'valid' : 'broken'} (${result.entries} entries)`
                );
              })
            }
          >
            Verify chain
          </button>
        </div>
        {audit.map((entry) => (
          <div className="audit-row" key={entry.id}>
            <span>#{entry.sequence}</span>
            <strong>{entry.action}</strong>
            <span>{entry.actor}</span>
            <code>{entry.entryHash.slice(0, 12)}</code>
          </div>
        ))}
      </section>
      <div className="toast" role="status">
        {message}
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
