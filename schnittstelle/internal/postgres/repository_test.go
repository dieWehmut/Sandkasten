package postgres

import (
	"testing"

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
