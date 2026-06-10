package postgres

import (
	"os"
	"strings"
	"testing"
)

func TestSchemaDefinesJobResourceChecks(t *testing.T) {
	body, err := os.ReadFile("../../../speicher/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := string(body)
	for _, want := range []string{
		"jobs_args_array_check",
		"jobs_archive_nonempty_check",
		"jobs_compile_timeout_positive_check",
		"jobs_run_timeout_positive_check",
		"jobs_memory_limit_positive_check",
		"jobs_cpu_millis_nonnegative_check",
		"jobs_max_output_positive_check",
		"attempt_count INTEGER NOT NULL DEFAULT 0",
		"jobs_attempt_count_nonnegative_check",
	} {
		if !strings.Contains(schema, want) {
			t.Fatalf("schema is missing %s", want)
		}
	}
}

func TestSchemaDefinesNotifyTriggers(t *testing.T) {
	body, err := os.ReadFile("../../../speicher/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := string(body)
	for _, want := range []string{
		"CREATE OR REPLACE FUNCTION notify_job_event()",
		"CREATE TRIGGER job_events_notify",
		"pg_notify('sandkasten_job_events'",
		"CREATE OR REPLACE FUNCTION notify_job_queue()",
		"CREATE TRIGGER jobs_notify_queue",
		"pg_notify('sandkasten_job_queue'",
	} {
		if !strings.Contains(schema, want) {
			t.Fatalf("schema is missing %s", want)
		}
	}
}

func TestSchemaDefinesJobArtifactDiagnostics(t *testing.T) {
	body, err := os.ReadFile("../../../speicher/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := string(body)
	for _, want := range []string{
		"memory_peak_bytes BIGINT NOT NULL DEFAULT 0",
		"cpu_usage_usec BIGINT NOT NULL DEFAULT 0",
		"cpu_throttled_usec BIGINT NOT NULL DEFAULT 0",
		"pids_peak BIGINT NOT NULL DEFAULT 0",
		"memory_oom_kill_count BIGINT NOT NULL DEFAULT 0",
	} {
		if !strings.Contains(schema, want) {
			t.Fatalf("schema is missing %s", want)
		}
	}
}

func TestSchemaDefinesJobAttempts(t *testing.T) {
	body, err := os.ReadFile("../../../speicher/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := string(body)
	for _, want := range []string{
		"CREATE TABLE job_attempts",
		"attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid()",
		"attempt_number INTEGER NOT NULL",
		"runner_id TEXT NOT NULL",
		"phase TEXT NOT NULL DEFAULT 'LEASED'",
		"terminal_reason TEXT NOT NULL DEFAULT ''",
		"cgroup_path TEXT NOT NULL DEFAULT ''",
		"child_pid INTEGER",
		"exit_code INTEGER",
		"signal INTEGER",
		"wall_time_ms BIGINT NOT NULL DEFAULT 0",
		"memory_peak_bytes BIGINT NOT NULL DEFAULT 0",
		"stdout_truncated BOOLEAN NOT NULL DEFAULT false",
		"stderr_truncated BOOLEAN NOT NULL DEFAULT false",
		"cpu_usage_usec BIGINT NOT NULL DEFAULT 0",
		"cpu_throttled_usec BIGINT NOT NULL DEFAULT 0",
		"pids_peak BIGINT NOT NULL DEFAULT 0",
		"memory_oom_kill_count BIGINT NOT NULL DEFAULT 0",
		"job_attempts_attempt_number_positive_check",
		"job_attempts_phase_nonempty_check",
		"job_attempts_child_pid_positive_check",
		"job_attempts_wall_time_nonnegative_check",
		"job_attempts_memory_oom_kill_nonnegative_check",
		"job_attempts_job_attempt_number_unique",
		"CREATE INDEX job_attempts_job_id_attempt_number_idx",
		"CREATE INDEX job_attempts_runner_updated_at_idx",
		"CREATE TRIGGER job_attempts_set_updated_at",
	} {
		if !strings.Contains(schema, want) {
			t.Fatalf("schema is missing %s", want)
		}
	}
}
