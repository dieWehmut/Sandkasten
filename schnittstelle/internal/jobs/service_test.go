package jobs

import (
	"context"
	"strings"
	"testing"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

type fakeRepo struct {
	created CreateJob
	job     *pb.Job
}

func (f *fakeRepo) CreateJob(ctx context.Context, job CreateJob) (*pb.SubmitGoProjectResponse, error) {
	f.created = job
	return &pb.SubmitGoProjectResponse{JobId: "job-1", Status: pb.JobStatus_JOB_STATUS_QUEUED}, nil
}
func (f *fakeRepo) GetJob(ctx context.Context, jobID string) (*pb.Job, error) { return f.job, nil }
func (f *fakeRepo) CancelJob(ctx context.Context, jobID string) (*pb.CancelJobResponse, error) {
	return nil, nil
}
func (f *fakeRepo) ListRuntimes(ctx context.Context) ([]*pb.Runtime, error) { return nil, nil }
func (f *fakeRepo) StreamEvents(ctx context.Context, jobID string, afterSequence uint64) (<-chan *pb.JobEvent, <-chan error) {
	return nil, nil
}

func TestSubmitGoProjectAppliesDefaults(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo, &pb.Runtime{Language: "go", Version: "1.26"})

	resp, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz")})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}
	if resp.JobId != "job-1" {
		t.Fatalf("JobId = %q", resp.JobId)
	}
	if repo.created.Entrypoint != "." {
		t.Fatalf("Entrypoint = %q", repo.created.Entrypoint)
	}
	if repo.created.CompileTimeoutMS == 0 || repo.created.RunTimeoutMS == 0 || repo.created.MemoryLimitBytes == 0 || repo.created.CPUMillis == 0 || repo.created.MaxOutputBytes == 0 {
		t.Fatalf("expected resource defaults, got %+v", repo.created)
	}
	if repo.created.Stdin == nil {
		t.Fatal("Stdin = nil, want empty byte slice")
	}
	if repo.created.Args == nil {
		t.Fatal("Args = nil, want empty string slice")
	}
}

func TestSubmitProjectAppliesLanguageRuntimeAndEntrypoint(t *testing.T) {
	repo := &fakeRepo{}
	service := NewServiceWithRuntimes(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11"},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "py",
		ArchiveTargz: []byte("tgz"),
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}

	if repo.created.Runtime.GetLanguage() != "python" {
		t.Fatalf("Runtime.Language = %q", repo.created.Runtime.GetLanguage())
	}
	if repo.created.Entrypoint != "main.py" {
		t.Fatalf("Entrypoint = %q", repo.created.Entrypoint)
	}
	if repo.created.Runtime.GetDefaultEntrypoint() != "main.py" {
		t.Fatalf("Runtime.DefaultEntrypoint = %q", repo.created.Runtime.GetDefaultEntrypoint())
	}
	if repo.created.Runtime.GetStatus() != "active" {
		t.Fatalf("Runtime.Status = %q", repo.created.Runtime.GetStatus())
	}
	if !containsString(repo.created.Runtime.GetAliases(), "py") {
		t.Fatalf("Runtime.Aliases = %v, want py", repo.created.Runtime.GetAliases())
	}
	if !repo.created.Runtime.GetCompilePhase().GetEnabled() {
		t.Fatalf("Runtime.CompilePhase = %+v, want enabled", repo.created.Runtime.GetCompilePhase())
	}
}

func TestListRuntimesIncludesManifest(t *testing.T) {
	service := NewServiceWithOptions(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11", Image: "sandkasten/python:3.11"},
		},
		ServiceOptions{
			Limits: SubmissionLimits{
				MaxArchiveBytes:     64,
				MaxStdinBytes:       32,
				MaxArgs:             4,
				MaxArgBytes:         16,
				MaxCompileTimeoutMS: 2000,
				MaxRunTimeoutMS:     3000,
				MaxMemoryLimitBytes: 1024,
				MaxCPUMillis:        500,
				MaxOutputBytes:      256,
			},
			DefaultResources: ResourceDefaults{
				CompileTimeoutMS: 1000,
				RunTimeoutMS:     1500,
				MemoryLimitBytes: 512,
				CPUMillis:        250,
				MaxOutputBytes:   128,
			},
			RuntimeLimits: map[string]SubmissionLimits{
				"py": {MaxRunTimeoutMS: 2200, MaxArgs: 2},
			},
			RuntimeResourceDefaults: map[string]ResourceDefaults{
				"python": {RunTimeoutMS: 1200},
			},
		},
	)

	resp, err := service.ListRuntimes(context.Background(), &pb.ListRuntimesRequest{})
	if err != nil {
		t.Fatalf("ListRuntimes() error = %v", err)
	}
	runtime := findRuntime(resp, "python")
	if runtime == nil {
		t.Fatalf("ListRuntimes() = %+v, want python runtime", resp.Runtimes)
	}
	if runtime.GetVersion() != "3.11" || runtime.GetImage() != "sandkasten/python:3.11" {
		t.Fatalf("Runtime version/image = %q/%q", runtime.GetVersion(), runtime.GetImage())
	}
	if runtime.GetStatus() != "active" {
		t.Fatalf("Runtime.Status = %q", runtime.GetStatus())
	}
	if runtime.GetDefaultEntrypoint() != "main.py" {
		t.Fatalf("Runtime.DefaultEntrypoint = %q", runtime.GetDefaultEntrypoint())
	}
	if !containsString(runtime.GetAliases(), "python3") {
		t.Fatalf("Runtime.Aliases = %v, want python3", runtime.GetAliases())
	}
	if got := runtime.GetCompilePhase().GetCommand(); len(got) < 3 || got[0] != "python3" || got[1] != "-c" || got[len(got)-1] != "main.py" {
		t.Fatalf("Runtime.CompilePhase.Command = %v", got)
	}
	if got := runtime.GetRunPhase().GetCommand(); len(got) != 3 || got[0] != "python3" || got[1] != "-B" || got[2] != "main.py" {
		t.Fatalf("Runtime.RunPhase.Command = %v", got)
	}
	if runtime.GetDefaultLimits().GetCompileTimeoutMs() != 1000 {
		t.Fatalf("DefaultLimits.CompileTimeoutMs = %d", runtime.GetDefaultLimits().GetCompileTimeoutMs())
	}
	if runtime.GetDefaultLimits().GetRunTimeoutMs() != 1200 {
		t.Fatalf("DefaultLimits.RunTimeoutMs = %d", runtime.GetDefaultLimits().GetRunTimeoutMs())
	}
	if runtime.GetMaxLimits().GetRunTimeoutMs() != 2200 {
		t.Fatalf("MaxLimits.RunTimeoutMs = %d", runtime.GetMaxLimits().GetRunTimeoutMs())
	}
	if runtime.GetMaxLimits().GetArgs() != 2 {
		t.Fatalf("MaxLimits.Args = %d", runtime.GetMaxLimits().GetArgs())
	}
	if runtime.GetMaxLimits().GetArchiveBytes() != 64 {
		t.Fatalf("MaxLimits.ArchiveBytes = %d", runtime.GetMaxLimits().GetArchiveBytes())
	}
}

func TestGetJobEnrichesRuntimeManifest(t *testing.T) {
	repo := &fakeRepo{
		job: &pb.Job{
			JobId:    "job-1",
			Language: "python",
			Runtime:  &pb.Runtime{Language: "python", Version: "3.12"},
		},
	}
	service := NewServiceWithRuntimes(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11", Image: "sandkasten/python:3.11"},
		},
	)

	job, err := service.GetJob(context.Background(), &pb.GetJobRequest{JobId: "job-1"})
	if err != nil {
		t.Fatalf("GetJob() error = %v", err)
	}
	if job.GetRuntime().GetVersion() != "3.12" {
		t.Fatalf("Runtime.Version = %q", job.GetRuntime().GetVersion())
	}
	if job.GetRuntime().GetImage() != "sandkasten/python:3.11" {
		t.Fatalf("Runtime.Image = %q", job.GetRuntime().GetImage())
	}
	if job.GetRuntime().GetDefaultEntrypoint() != "main.py" {
		t.Fatalf("Runtime.DefaultEntrypoint = %q", job.GetRuntime().GetDefaultEntrypoint())
	}
	if !containsString(job.GetRuntime().GetAliases(), "py") {
		t.Fatalf("Runtime.Aliases = %v, want py", job.GetRuntime().GetAliases())
	}
}

func TestSubmitProjectAppliesRuntimeResourceDefaults(t *testing.T) {
	repo := &fakeRepo{}
	service := NewServiceWithOptions(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11"},
		},
		ServiceOptions{
			DefaultResources: ResourceDefaults{
				CompileTimeoutMS: 2000,
				RunTimeoutMS:     1000,
				MemoryLimitBytes: 64 * 1024 * 1024,
				CPUMillis:        250,
				MaxOutputBytes:   128 * 1024,
			},
			RuntimeResourceDefaults: map[string]ResourceDefaults{
				"py": {
					RunTimeoutMS:     7000,
					MemoryLimitBytes: 128 * 1024 * 1024,
				},
			},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "python",
		ArchiveTargz: []byte("tgz"),
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}
	if repo.created.CompileTimeoutMS != 2000 {
		t.Fatalf("CompileTimeoutMS = %d", repo.created.CompileTimeoutMS)
	}
	if repo.created.RunTimeoutMS != 7000 {
		t.Fatalf("RunTimeoutMS = %d", repo.created.RunTimeoutMS)
	}
	if repo.created.MemoryLimitBytes != 128*1024*1024 {
		t.Fatalf("MemoryLimitBytes = %d", repo.created.MemoryLimitBytes)
	}
	if repo.created.CPUMillis != 250 {
		t.Fatalf("CPUMillis = %d", repo.created.CPUMillis)
	}
	if repo.created.MaxOutputBytes != 128*1024 {
		t.Fatalf("MaxOutputBytes = %d", repo.created.MaxOutputBytes)
	}
}

func TestSubmitProjectAppliesRuntimeLimitOverrides(t *testing.T) {
	service := NewServiceWithOptions(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11"},
		},
		ServiceOptions{
			Limits: SubmissionLimits{MaxRunTimeoutMS: 10000},
			RuntimeLimits: map[string]SubmissionLimits{
				"py": {MaxRunTimeoutMS: 1000},
			},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "python",
		ArchiveTargz: []byte("tgz"),
		RunTimeoutMs: 1500,
	})
	if err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
	if !strings.Contains(err.Error(), "run_timeout_ms") {
		t.Fatalf("SubmitGoProject() error = %q, want run_timeout_ms", err.Error())
	}

	_, err = service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "go",
		ArchiveTargz: []byte("tgz"),
		RunTimeoutMs: 1500,
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() go error = %v", err)
	}
}

func TestSubmitProjectRejectsUnsupportedLanguage(t *testing.T) {
	service := NewServiceWithRuntimes(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{{Language: "go", Version: "1.26"}},
	)

	if _, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "ruby",
		ArchiveTargz: []byte("tgz"),
	}); err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
}

func TestSubmitGoProjectRequiresArchive(t *testing.T) {
	service := NewService(&fakeRepo{}, &pb.Runtime{Language: "go", Version: "1.26"})
	if _, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{}); err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
}

func TestSubmitProjectRejectsResourceLimitsAboveServiceCaps(t *testing.T) {
	tests := []struct {
		name     string
		req      *pb.SubmitGoProjectRequest
		limits   SubmissionLimits
		wantText string
	}{
		{
			name:     "archive",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("too-large")},
			limits:   SubmissionLimits{MaxArchiveBytes: 4},
			wantText: "archive_targz",
		},
		{
			name:     "stdin",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), Stdin: []byte("too-large")},
			limits:   SubmissionLimits{MaxStdinBytes: 4},
			wantText: "stdin",
		},
		{
			name:     "args count",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), Args: []string{"a", "b"}},
			limits:   SubmissionLimits{MaxArgs: 1},
			wantText: "args exceeds",
		},
		{
			name:     "args bytes",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), Args: []string{"toolarge"}},
			limits:   SubmissionLimits{MaxArgBytes: 4},
			wantText: "args exceed",
		},
		{
			name:     "compile timeout",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), CompileTimeoutMs: 121000},
			limits:   SubmissionLimits{MaxCompileTimeoutMS: 120000},
			wantText: "compile_timeout_ms",
		},
		{
			name:     "run timeout",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), RunTimeoutMs: 31000},
			limits:   SubmissionLimits{MaxRunTimeoutMS: 30000},
			wantText: "run_timeout_ms",
		},
		{
			name:     "memory",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), MemoryLimitBytes: 1025},
			limits:   SubmissionLimits{MaxMemoryLimitBytes: 1024},
			wantText: "memory_limit_bytes",
		},
		{
			name:     "cpu",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), CpuMillis: 501},
			limits:   SubmissionLimits{MaxCPUMillis: 500},
			wantText: "cpu_millis",
		},
		{
			name:     "output",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), MaxOutputBytes: 129},
			limits:   SubmissionLimits{MaxOutputBytes: 128},
			wantText: "max_output_bytes",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := NewServiceWithOptions(
				&fakeRepo{},
				&pb.Runtime{Language: "go", Version: "1.26"},
				[]*pb.Runtime{{Language: "go", Version: "1.26"}},
				ServiceOptions{Limits: tt.limits},
			)
			_, err := service.SubmitGoProject(context.Background(), tt.req)
			if err == nil {
				t.Fatal("SubmitGoProject() error = nil")
			}
			if !strings.Contains(err.Error(), tt.wantText) {
				t.Fatalf("SubmitGoProject() error = %q, want %q", err.Error(), tt.wantText)
			}
		})
	}
}

func findRuntime(resp *pb.ListRuntimesResponse, language string) *pb.Runtime {
	for _, runtime := range resp.GetRuntimes() {
		if runtime.GetLanguage() == language {
			return runtime
		}
	}
	return nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
