CREATE TABLE IF NOT EXISTS environment_state (
    environment text PRIMARY KEY CHECK (environment IN ('development', 'staging', 'production')),
    current_revision_id uuid,
    lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_revisions (
    id uuid PRIMARY KEY,
    environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
    revision_number integer NOT NULL CHECK (revision_number > 0),
    format text NOT NULL CHECK (format IN ('json', 'yaml', 'env')),
    encrypted_content text NOT NULL,
    redacted_content jsonb NOT NULL,
    content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    manifest_signature text,
    policy_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_revision_id uuid REFERENCES config_revisions(id),
    UNIQUE (environment, revision_number),
    UNIQUE (environment, content_hash)
);

ALTER TABLE environment_state
    DROP CONSTRAINT IF EXISTS environment_state_current_revision_fk;
ALTER TABLE environment_state
    ADD CONSTRAINT environment_state_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES config_revisions(id);

CREATE TABLE IF NOT EXISTS approvals (
    id uuid PRIMARY KEY,
    revision_id uuid NOT NULL REFERENCES config_revisions(id),
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    actor text NOT NULL,
    comment text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (revision_id, actor)
);

CREATE TABLE IF NOT EXISTS promotions (
    id uuid PRIMARY KEY,
    environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
    from_revision_id uuid REFERENCES config_revisions(id),
    to_revision_id uuid NOT NULL REFERENCES config_revisions(id),
    action text NOT NULL CHECK (action IN ('activate', 'promote', 'rollback')),
    actor text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    sequence bigserial PRIMARY KEY,
    id uuid NOT NULL UNIQUE,
    action text NOT NULL,
    actor text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    details jsonb NOT NULL,
    previous_hash text NOT NULL,
    entry_hash text NOT NULL UNIQUE CHECK (entry_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS config_revisions_environment_created_idx
    ON config_revisions (environment, created_at DESC);
CREATE INDEX IF NOT EXISTS approvals_revision_created_idx
    ON approvals (revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promotions_environment_created_idx
    ON promotions (environment, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx
    ON audit_log (resource_type, resource_id, sequence DESC);

INSERT INTO environment_state (environment)
VALUES ('development'), ('staging'), ('production')
ON CONFLICT (environment) DO NOTHING;
