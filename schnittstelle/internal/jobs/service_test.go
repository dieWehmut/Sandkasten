package jobs

import (
	"context"
	"testing"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

type fakeRepo struct {
	created CreateJob
}

func (f *fakeRepo) CreateJob(ctx context.Context, job CreateJob) (*pb.SubmitGoProjectResponse, error) {
	f.created = job
	return &pb.SubmitGoProjectResponse{JobId: "job-1", Status: pb.JobStatus_JOB_STATUS_QUEUED}, nil
}
func (f *fakeRepo) GetJob(ctx context.Context, jobID string) (*pb.Job, error) { return nil, nil }
func (f *fakeRepo) CancelJob(ctx context.Context, jobID string) (*pb.CancelJobResponse, error) {
	return nil, nil
}
func (f *fakeRepo) ListRuntimes(ctx context.Context) ([]*pb.Runtime, error) { return nil, nil }
func (f *fakeRepo) StreamEvents(ctx context.Context, jobID string, afterSequence uint64) (<-chan *pb.JobEvent, <-chan error) {
	return nil, nil
}

func TestSubmitGoProjectAppliesDefaults(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo, &pb.Runtime{Language: "go", Version: "1.23"})

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
}

func TestSubmitGoProjectRequiresArchive(t *testing.T) {
	service := NewService(&fakeRepo{}, &pb.Runtime{Language: "go", Version: "1.23"})
	if _, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{}); err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
}
