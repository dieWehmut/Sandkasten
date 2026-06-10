package httpapi

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
)

type fakeService struct {
	submitted *pb.SubmitGoProjectRequest
	job       *pb.Job
	submitErr error
}

func (f *fakeService) SubmitGoProject(ctx context.Context, req *pb.SubmitGoProjectRequest) (*pb.SubmitGoProjectResponse, error) {
	if f.submitErr != nil {
		return nil, f.submitErr
	}
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
	var response submitResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.JobID != "job-1" || response.Status != "JOB_STATUS_QUEUED" {
		t.Fatalf("response = %+v", response)
	}
}

func TestRunGoFromSourcePreservesSourceBytes(t *testing.T) {
	service := &fakeService{}
	server := New(service, "", nil).Handler()
	source := "package main\n\nimport \"fmt\"\n\nfunc main(){\n\tfmt.Println(\"# kept\") // keep trailing comment\n}\n"
	body, err := json.Marshal(map[string]any{
		"source": source,
		"wait":   false,
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/go/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	files := readArchiveFiles(t, service.submitted.GetArchiveTargz())
	if got := string(files["main.go"]); got != source {
		t.Fatalf("main.go = %q, want exact source %q", got, source)
	}
}

func TestRunLanguageFromSourceSubmitsLanguage(t *testing.T) {
	service := &fakeService{}
	server := New(service, "", nil).Handler()
	req := httptest.NewRequest(http.MethodPost, "/v1/python/run", strings.NewReader(`{"source":"print('ok')","wait":false}`))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if service.submitted == nil {
		t.Fatal("request was not submitted")
	}
	if service.submitted.Language != "python" || service.submitted.Entrypoint != "main.py" {
		t.Fatalf("submitted = %+v", service.submitted)
	}
}

func TestRunRFromSourceSubmitsMainR(t *testing.T) {
	service := &fakeService{}
	server := New(service, "", nil).Handler()
	req := httptest.NewRequest(http.MethodPost, "/v1/r/run", strings.NewReader(`{"source":"cat('ok\n')","wait":false}`))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if service.submitted == nil {
		t.Fatal("request was not submitted")
	}
	if service.submitted.Language != "r" || service.submitted.Entrypoint != "main.R" {
		t.Fatalf("submitted = %+v", service.submitted)
	}
}

func readArchiveFiles(t *testing.T, archive []byte) map[string][]byte {
	t.Helper()
	gzipReader, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		t.Fatal(err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	files := map[string][]byte{}
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(tarReader)
		if err != nil {
			t.Fatal(err)
		}
		files[header.Name] = body
	}
	return files
}

func TestRunReturnsServiceUnavailableOnResourceExhaustion(t *testing.T) {
	service := &fakeService{submitErr: jobs.ErrResourceExhausted}
	server := New(service, "", nil).Handler()
	req := httptest.NewRequest(http.MethodPost, "/v1/python/run", strings.NewReader(`{"source":"print('ok')"}`))
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Error != "resource_exhausted" {
		t.Fatalf("response = %+v", response)
	}
}

func TestGetJobReturnsAutoEncodedArtifacts(t *testing.T) {
	service := &fakeService{
		job: &pb.Job{
			JobId:    "job-1",
			Status:   pb.JobStatus_JOB_STATUS_SUCCEEDED,
			Language: "go",
			Runtime:  &pb.Runtime{Version: "1.26"},
			Result: &pb.JobResult{
				Stdout:             []byte("hello\n"),
				Stderr:             []byte{0xff, 0x00},
				WallTimeMs:         42,
				MemoryPeakBytes:    1024,
				ExitCode:           0,
				CpuUsageUsec:       7000,
				CpuThrottledUsec:   300,
				PidsPeak:           8,
				MemoryOomKillCount: 1,
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
	if response.StdoutEnc != "utf8" || response.Stderr != "/wA=" || response.StderrEnc != "base64" {
		t.Fatalf("response = %+v", response)
	}
	if response.Diagnostics.MemoryPeakBytes != 1024 ||
		response.Diagnostics.CPUUsageUsec != 7000 ||
		response.Diagnostics.CPUThrottledUsec != 300 ||
		response.Diagnostics.PidsPeak != 8 ||
		response.Diagnostics.MemoryOOMKillCount != 1 {
		t.Fatalf("diagnostics = %+v", response.Diagnostics)
	}
}

func TestGetJobCanForceBase64Artifacts(t *testing.T) {
	service := &fakeService{
		job: &pb.Job{
			JobId:    "job-1",
			Status:   pb.JobStatus_JOB_STATUS_SUCCEEDED,
			Language: "go",
			Result:   &pb.JobResult{Stdout: []byte("hello\n")},
		},
	}
	server := New(service, "", nil).Handler()
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/jobs/job-1?outputEncoding=base64", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response jobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Stdout != "aGVsbG8K" || response.StdoutEnc != "base64" {
		t.Fatalf("response = %+v", response)
	}
}

func TestGetJobRejectsInvalidOutputEncoding(t *testing.T) {
	service := &fakeService{
		job: &pb.Job{JobId: "job-1", Status: pb.JobStatus_JOB_STATUS_SUCCEEDED, Result: &pb.JobResult{}},
	}
	server := New(service, "", nil).Handler()
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/jobs/job-1?outputEncoding=hex", nil))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
