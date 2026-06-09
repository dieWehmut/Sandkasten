package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

type fakeService struct {
	submitted *pb.SubmitGoProjectRequest
	job       *pb.Job
}

func (f *fakeService) SubmitGoProject(ctx context.Context, req *pb.SubmitGoProjectRequest) (*pb.SubmitGoProjectResponse, error) {
	f.submitted = req
	return &pb.SubmitGoProjectResponse{JobId: "job-1", Status: pb.JobStatus_JOB_STATUS_QUEUED}, nil
}

func (f *fakeService) GetJob(ctx context.Context, req *pb.GetJobRequest) (*pb.Job, error) {
	if f.job != nil {
		return f.job, nil
	}
	return &pb.Job{JobId: req.JobId, Status: pb.JobStatus_JOB_STATUS_QUEUED}, nil
}

func (f *fakeService) ListRuntimes(ctx context.Context, req *pb.ListRuntimesRequest) (*pb.ListRuntimesResponse, error) {
	return &pb.ListRuntimesResponse{Runtimes: []*pb.Runtime{{Language: "go", Version: "1.26"}}}, nil
}

func TestRunGoFromSourceSubmitsArchive(t *testing.T) {
	service := &fakeService{}
	server := New(service, "dev-token", []string{"https://diewehmut.github.io"}).Handler()
	body := strings.NewReader(`{"source":"package main\nimport \"fmt\"\nfunc main(){fmt.Println(\"ok\")}","wait":false}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/go/run", body)
	req.Header.Set("Authorization", "Bearer dev-token")
	req.Header.Set("Origin", "https://diewehmut.github.io")
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://diewehmut.github.io" {
		t.Fatalf("CORS origin = %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
	if service.submitted == nil || len(service.submitted.ArchiveTargz) == 0 {
		t.Fatal("archive was not submitted")
	}
	var response submitGoResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.JobID != "job-1" || response.Status != "JOB_STATUS_QUEUED" {
		t.Fatalf("response = %+v", response)
	}
}

func TestGetJobReturnsPlainTextArtifacts(t *testing.T) {
	service := &fakeService{
		job: &pb.Job{
			JobId:    "job-1",
			Status:   pb.JobStatus_JOB_STATUS_SUCCEEDED,
			Language: "go",
			Runtime:  &pb.Runtime{Version: "1.26"},
			Result: &pb.JobResult{
				Stdout:     []byte("hello\n"),
				WallTimeMs: 42,
				ExitCode:   0,
			},
		},
	}
	server := New(service, "", nil).Handler()
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/jobs/job-1", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response jobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Status != "JOB_STATUS_SUCCEEDED" || response.Stdout != "hello\n" || response.DurationMs != 42 {
		t.Fatalf("response = %+v", response)
	}
}
