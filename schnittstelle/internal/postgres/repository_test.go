package postgres

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

func TestStatusFromDB(t *testing.T) {
	tests := map[string]pb.JobStatus{
		"QUEUED":                pb.JobStatus_JOB_STATUS_QUEUED,
		"VALIDATING":            pb.JobStatus_JOB_STATUS_VALIDATING,
		"COMPILING":             pb.JobStatus_JOB_STATUS_COMPILING,
		"RUNNING":               pb.JobStatus_JOB_STATUS_RUNNING,
		"SUCCEEDED":             pb.JobStatus_JOB_STATUS_SUCCEEDED,
		"COMPILE_FAILED":        pb.JobStatus_JOB_STATUS_COMPILE_FAILED,
		"RUNTIME_FAILED":        pb.JobStatus_JOB_STATUS_RUNTIME_FAILED,
		"TIME_LIMIT_EXCEEDED":   pb.JobStatus_JOB_STATUS_TIME_LIMIT_EXCEEDED,
		"MEMORY_LIMIT_EXCEEDED": pb.JobStatus_JOB_STATUS_MEMORY_LIMIT_EXCEEDED,
		"OUTPUT_LIMIT_EXCEEDED": pb.JobStatus_JOB_STATUS_OUTPUT_LIMIT_EXCEEDED,
		"CANCELED":              pb.JobStatus_JOB_STATUS_CANCELED,
		"SYSTEM_ERROR":          pb.JobStatus_JOB_STATUS_SYSTEM_ERROR,
		"unknown":               pb.JobStatus_JOB_STATUS_UNSPECIFIED,
	}
	for input, want := range tests {
		if got := statusFromDB(input); got != want {
			t.Fatalf("statusFromDB(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestCloneRuntimeDefaults(t *testing.T) {
	got := cloneRuntime(nil)
	if got.Language != "go" || got.Version == "" || !got.RequiresVendor {
		t.Fatalf("cloneRuntime(nil) = %+v", got)
	}
}

func TestCloneRuntimeCopiesManifestFields(t *testing.T) {
	source := &pb.Runtime{
		Language:          "python",
		Version:           "3.11",
		Image:             "sandkasten/python:3.11",
		Aliases:           []string{"py"},
		Status:            "active",
		DefaultEntrypoint: "main.py",
		CompilePhase:      &pb.RuntimePhase{Command: []string{"python3", "-m", "py_compile"}, Enabled: true},
		RunPhase:          &pb.RuntimePhase{Command: []string{"python3", "main.py"}, Enabled: true},
		DefaultLimits:     &pb.RuntimeLimits{RunTimeoutMs: 1000},
		MaxLimits:         &pb.RuntimeLimits{RunTimeoutMs: 2000, Args: 4},
	}

	got := cloneRuntime(source)
	source.Aliases[0] = "changed"
	source.CompilePhase.Command[0] = "changed"
	source.DefaultLimits.RunTimeoutMs = 9999

	if got.GetAliases()[0] != "py" {
		t.Fatalf("Aliases = %v", got.GetAliases())
	}
	if got.GetCompilePhase().GetCommand()[0] != "python3" {
		t.Fatalf("CompilePhase.Command = %v", got.GetCompilePhase().GetCommand())
	}
	if got.GetDefaultLimits().GetRunTimeoutMs() != 1000 {
		t.Fatalf("DefaultLimits.RunTimeoutMs = %d", got.GetDefaultLimits().GetRunTimeoutMs())
	}
	if got.GetMaxLimits().GetArgs() != 4 {
		t.Fatalf("MaxLimits.Args = %d", got.GetMaxLimits().GetArgs())
	}
}

func TestRepositoryOptionsClampNegativeBackpressureLimits(t *testing.T) {
	repo := NewRepositoryWithOptions(
		&sql.DB{},
		time.Second,
		nil,
		RepositoryOptions{MaxQueuedJobs: -1, MaxActiveJobs: -2},
	)
	if repo.maxQueuedJobs != 0 || repo.maxActiveJobs != 0 {
		t.Fatalf("repo limits = queued %d active %d, want both zero", repo.maxQueuedJobs, repo.maxActiveJobs)
	}
}

func TestNotifyChannelsAreStable(t *testing.T) {
	if jobEventsChannel != "sandkasten_job_events" {
		t.Fatalf("jobEventsChannel = %q", jobEventsChannel)
	}
	if jobQueueChannel != "sandkasten_job_queue" {
		t.Fatalf("jobQueueChannel = %q", jobQueueChannel)
	}
}

func TestScanJobMapsResultDiagnostics(t *testing.T) {
	job, err := scanJob(fakeScanner{
		"11111111-1111-1111-1111-111111111111",
		"SUCCEEDED",
		"python",
		"3.11",
		"main.py",
		`["--fast"]`,
		uint32(1000),
		uint32(2000),
		int64(64 * 1024 * 1024),
		uint32(250),
		int64(4096),
		"",
		"2026-06-09T00:00:00Z",
		"2026-06-09T00:00:01Z",
		"2026-06-09T00:00:02Z",
		[]byte("out"),
		[]byte("err"),
		[]byte("compile out"),
		[]byte("compile err"),
		sql.NullInt32{Int32: 0, Valid: true},
		sql.NullInt32{Int32: 0, Valid: true},
		int64(42),
		int64(8192),
		true,
		false,
		int64(7000),
		int64(300),
		int64(8),
		int64(1),
	}, &pb.Runtime{Language: "python", Version: "3.11"})
	if err != nil {
		t.Fatalf("scanJob() error = %v", err)
	}

	result := job.GetResult()
	if result.GetMemoryPeakBytes() != 8192 ||
		result.GetCpuUsageUsec() != 7000 ||
		result.GetCpuThrottledUsec() != 300 ||
		result.GetPidsPeak() != 8 ||
		result.GetMemoryOomKillCount() != 1 {
		t.Fatalf("result diagnostics = %+v", result)
	}
	if !result.GetStdoutTruncated() || result.GetStderrTruncated() {
		t.Fatalf("truncation = stdout %v stderr %v", result.GetStdoutTruncated(), result.GetStderrTruncated())
	}
}

type fakeScanner []any

func (s fakeScanner) Scan(dest ...interface{}) error {
	if len(dest) != len(s) {
		return fmt.Errorf("Scan dest count = %d, want %d", len(dest), len(s))
	}
	for i, value := range s {
		switch target := dest[i].(type) {
		case *string:
			*target = value.(string)
		case *uint32:
			*target = value.(uint32)
		case *int64:
			*target = value.(int64)
		case *[]byte:
			*target = append([]byte(nil), value.([]byte)...)
		case *sql.NullInt32:
			*target = value.(sql.NullInt32)
		case *bool:
			*target = value.(bool)
		default:
			return fmt.Errorf("unsupported scan target %T at index %d", target, i)
		}
	}
	return nil
}
