CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE job_status AS ENUM (
  'QUEUED',
  'VALIDATING',
  'COMPILING',
  'RUNNING',
  'SUCCEEDED',
  'COMPILE_FAILED',
  'RUNTIME_FAILED',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'OUTPUT_LIMIT_EXCEEDED',
  'CANCELED',
  'SYSTEM_ERROR'
);

CREATE TABLE jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status job_status NOT NULL DEFAULT 'QUEUED',
  language TEXT NOT NULL DEFAULT 'go',
  runtime_version TEXT NOT NULL DEFAULT '1.26',
  entrypoint TEXT NOT NULL DEFAULT '.',
  args JSONB NOT NULL DEFAULT '[]'::jsonb,
  stdin BYTEA NOT NULL DEFAULT ''::bytea,
  archive_targz BYTEA NOT NULL,
  compile_timeout_ms INTEGER NOT NULL,
  run_timeout_ms INTEGER NOT NULL,
  memory_limit_bytes BIGINT NOT NULL,
  cpu_millis INTEGER NOT NULL,
  max_output_bytes BIGINT NOT NULL,
  runner_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX jobs_status_created_at_idx ON jobs (status, created_at);
CREATE INDEX jobs_runner_lease_idx ON jobs (runner_id, lease_expires_at);

CREATE TABLE job_artifacts (
  job_id UUID PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  stdout BYTEA NOT NULL DEFAULT ''::bytea,
  stderr BYTEA NOT NULL DEFAULT ''::bytea,
  compile_stdout BYTEA NOT NULL DEFAULT ''::bytea,
  compile_stderr BYTEA NOT NULL DEFAULT ''::bytea,
  exit_code INTEGER,
  signal INTEGER,
  wall_time_ms BIGINT NOT NULL DEFAULT 0,
  memory_peak_bytes BIGINT NOT NULL DEFAULT 0,
  stdout_truncated BOOLEAN NOT NULL DEFAULT false,
  stderr_truncated BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_events (
  job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  sequence BIGSERIAL PRIMARY KEY,
  status job_status NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX job_events_job_id_sequence_idx ON job_events (job_id, sequence);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_set_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER job_artifacts_set_updated_at
BEFORE UPDATE ON job_artifacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
