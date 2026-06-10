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
  attempt_count INTEGER NOT NULL DEFAULT 0,
  runner_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jobs_args_array_check CHECK (jsonb_typeof(args) = 'array'),
  CONSTRAINT jobs_archive_nonempty_check CHECK (octet_length(archive_targz) > 0),
  CONSTRAINT jobs_compile_timeout_positive_check CHECK (compile_timeout_ms > 0),
  CONSTRAINT jobs_run_timeout_positive_check CHECK (run_timeout_ms > 0),
  CONSTRAINT jobs_memory_limit_positive_check CHECK (memory_limit_bytes > 0),
  CONSTRAINT jobs_cpu_millis_nonnegative_check CHECK (cpu_millis >= 0),
  CONSTRAINT jobs_max_output_positive_check CHECK (max_output_bytes > 0),
  CONSTRAINT jobs_attempt_count_nonnegative_check CHECK (attempt_count >= 0)
);

CREATE INDEX jobs_status_created_at_idx ON jobs (status, created_at);
CREATE INDEX jobs_runner_lease_idx ON jobs (runner_id, lease_expires_at);

CREATE TABLE job_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  runner_id TEXT NOT NULL,
  status job_status NOT NULL DEFAULT 'VALIDATING',
  phase TEXT NOT NULL DEFAULT 'LEASED',
  leased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error_message TEXT NOT NULL DEFAULT '',
  terminal_reason TEXT NOT NULL DEFAULT '',
  cgroup_path TEXT NOT NULL DEFAULT '',
  child_pid INTEGER,
  exit_code INTEGER,
  signal INTEGER,
  wall_time_ms BIGINT NOT NULL DEFAULT 0,
  memory_peak_bytes BIGINT NOT NULL DEFAULT 0,
  stdout_truncated BOOLEAN NOT NULL DEFAULT false,
  stderr_truncated BOOLEAN NOT NULL DEFAULT false,
  cpu_usage_usec BIGINT NOT NULL DEFAULT 0,
  cpu_throttled_usec BIGINT NOT NULL DEFAULT 0,
  pids_peak BIGINT NOT NULL DEFAULT 0,
  memory_oom_kill_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_attempts_attempt_number_positive_check CHECK (attempt_number > 0),
  CONSTRAINT job_attempts_phase_nonempty_check CHECK (length(phase) > 0),
  CONSTRAINT job_attempts_child_pid_positive_check CHECK (child_pid IS NULL OR child_pid > 0),
  CONSTRAINT job_attempts_wall_time_nonnegative_check CHECK (wall_time_ms >= 0),
  CONSTRAINT job_attempts_memory_peak_nonnegative_check CHECK (memory_peak_bytes >= 0),
  CONSTRAINT job_attempts_cpu_usage_nonnegative_check CHECK (cpu_usage_usec >= 0),
  CONSTRAINT job_attempts_cpu_throttled_nonnegative_check CHECK (cpu_throttled_usec >= 0),
  CONSTRAINT job_attempts_pids_peak_nonnegative_check CHECK (pids_peak >= 0),
  CONSTRAINT job_attempts_memory_oom_kill_nonnegative_check CHECK (memory_oom_kill_count >= 0),
  CONSTRAINT job_attempts_job_attempt_number_unique UNIQUE (job_id, attempt_number)
);

CREATE INDEX job_attempts_job_id_attempt_number_idx ON job_attempts (job_id, attempt_number);
CREATE INDEX job_attempts_runner_updated_at_idx ON job_attempts (runner_id, updated_at);

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
  cpu_usage_usec BIGINT NOT NULL DEFAULT 0,
  cpu_throttled_usec BIGINT NOT NULL DEFAULT 0,
  pids_peak BIGINT NOT NULL DEFAULT 0,
  memory_oom_kill_count BIGINT NOT NULL DEFAULT 0,
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

CREATE TRIGGER job_attempts_set_updated_at
BEFORE UPDATE ON job_attempts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION notify_job_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('sandkasten_job_events', NEW.job_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_events_notify
AFTER INSERT ON job_events
FOR EACH ROW EXECUTE FUNCTION notify_job_event();

CREATE OR REPLACE FUNCTION notify_job_queue()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'QUEUED'::job_status THEN
    PERFORM pg_notify('sandkasten_job_queue', NEW.job_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_notify_queue
AFTER INSERT OR UPDATE OF status ON jobs
FOR EACH ROW EXECUTE FUNCTION notify_job_queue();
