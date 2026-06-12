package httpapi

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
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
	return &pb.ListRuntimesResponse{Runtimes: []*pb.Runtime{{
		Language:          "go",
		Version:           "1.26",
		Status:            "active",
		DefaultEntrypoint: ".",
		CompilePhase:      &pb.RuntimePhase{Command: []string{"go", "build", "-o", ".laeufer-bin/main", "."}, Enabled: true},
		RunPhase:          &pb.RuntimePhase{Command: []string{".laeufer-bin/main"}, Enabled: true},
		DefaultLimits:     &pb.RuntimeLimits{CompileTimeoutMs: 10000, RunTimeoutMs: 3000, MemoryLimitBytes: 256 * 1024 * 1024, CpuMillis: 3000, OutputBytes: 1 * 1024 * 1024},
	}}}, nil
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

func TestRunGoFromSourceIncludesFiles(t *testing.T) {
	service := &fakeService{}
	server := New(service, "", nil).Handler()
	source := "package main\n\nimport \"os\"\n\nfunc main(){\n\t_, _ = os.ReadFile(\"test.txt\")\n}\n"
	body, err := json.Marshal(map[string]any{
		"source": source,
		"files": []map[string]string{
			{"name": "test.txt", "content": "a,b,cc\n"},
		},
		"wait": false,
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
	if got := string(files["test.txt"]); got != "a,b,cc\n" {
		t.Fatalf("test.txt = %q", got)
	}
}

func TestRunRejectsUnsafeFileName(t *testing.T) {
	service := &fakeService{}
	server := New(service, "", nil).Handler()
	body := strings.NewReader(`{"source":"package main\nfunc main(){}","files":[{"name":"../test.txt","content":"bad"}],"wait":false}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/go/run", body)
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if service.submitted != nil {
		t.Fatal("unsafe request was submitted")
	}
	var response errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Error != "invalid_request" || !strings.Contains(response.Message, "relative path") {
		t.Fatalf("response = %+v", response)
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

func TestRunNewLanguagesFromSourceSubmitDefaultEntrypoints(t *testing.T) {
	tests := []struct {
		path       string
		language   string
		entrypoint string
		source     string
	}{
		{path: "/v1/shell/run", language: "bash", entrypoint: "main.sh", source: `printf '%s\n' ok`},
		{path: "/v1/cj/run", language: "cangjie", entrypoint: "main.cj", source: "main() {\n    println(\"ok\")\n}"},
		{path: "/v1/clj/run", language: "clojure", entrypoint: "main.clj", source: `(println "ok")`},
		{path: "/v1/coqc/run", language: "coq", entrypoint: "main.v", source: `Goal True. Proof. exact I. Qed.`},
		{path: "/v1/dart/run", language: "dart", entrypoint: "main.dart", source: `void main(){ print("ok"); }`},
		{path: "/v1/exs/run", language: "elixir", entrypoint: "main.exs", source: `IO.puts("ok")`},
		{path: "/v1/f%23/run", language: "fsharp", entrypoint: "main.fs", source: "printfn \"ok\"\n"},
		{path: "/v1/julia/run", language: "julia", entrypoint: "main.jl", source: `println("ok")`},
		{path: "/v1/kt/run", language: "kotlin", entrypoint: "Main.kt", source: `fun main(){ println("ok") }`},
		{path: "/v1/lean/run", language: "lean4", entrypoint: "Main.lean", source: `def main : IO Unit := IO.println "ok"`},
		{path: "/v1/lua5.4/run", language: "lua", entrypoint: "main.lua", source: `print("ok")`},
		{path: "/v1/nf/run", language: "nextflow", entrypoint: "main.nf", source: "workflow {\n  println \"ok\"\n}\n"},
		{path: "/v1/nimrod/run", language: "nim", entrypoint: "main.nim", source: `echo "ok"`},
		{path: "/v1/perl5/run", language: "perl", entrypoint: "main.pl", source: `print "ok\n";`},
		{path: "/v1/php8.2/run", language: "php", entrypoint: "main.php", source: `<?php echo "ok\n";`},
		{path: "/v1/swipl/run", language: "prolog", entrypoint: "main.pl", source: `main :- writeln(ok).`},
		{path: "/v1/rkt/run", language: "racket", entrypoint: "main.rkt", source: "#lang racket/base\n(displayln \"ok\")"},
		{path: "/v1/rb/run", language: "ruby", entrypoint: "main.rb", source: `puts "ok"`},
		{path: "/v1/sc/run", language: "scala", entrypoint: "Main.scala", source: `object Main extends App { println("ok") }`},
		{path: "/v1/sqlite3/run", language: "sql", entrypoint: "main.sql", source: `select 'ok';`},
		{path: "/v1/swift/run", language: "swift", entrypoint: "main.swift", source: `print("ok")`},
		{path: "/v1/workflow-description-language/run", language: "wdl", entrypoint: "main.wdl", source: "version 1.0\nworkflow hello { output { String message = \"ok\" } }\n"},
		{path: "/v1/zig/run", language: "zig", entrypoint: "main.zig", source: "extern fn write(fd: i32, buf: [*]const u8, count: usize) isize;\npub fn main() void { const msg = \"ok\\n\"; _ = write(1, msg.ptr, msg.len); }"},
	}

	for _, tt := range tests {
		t.Run(tt.language, func(t *testing.T) {
			service := &fakeService{}
			server := New(service, "", nil).Handler()
			body, err := json.Marshal(map[string]any{"source": tt.source, "wait": false})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, tt.path, bytes.NewReader(body))
			rec := httptest.NewRecorder()

			server.ServeHTTP(rec, req)

			if rec.Code != http.StatusAccepted {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if service.submitted == nil {
				t.Fatal("request was not submitted")
			}
			if service.submitted.Language != tt.language || service.submitted.Entrypoint != tt.entrypoint {
				t.Fatalf("submitted = %+v", service.submitted)
			}
			files := readArchiveFiles(t, service.submitted.GetArchiveTargz())
			if got := string(files[tt.entrypoint]); got != tt.source {
				t.Fatalf("%s = %q, want %q", tt.entrypoint, got, tt.source)
			}
		})
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

func TestRootRedirectsToRuntimes(t *testing.T) {
	server := New(&fakeService{}, "", nil).Handler()
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/v1/runtimes" {
		t.Fatalf("status = %d, location = %q", rec.Code, rec.Header().Get("Location"))
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("headers = %+v", rec.Header())
	}
}

func TestUnknownGETDoesNotUseRootRedirect(t *testing.T) {
	server := New(&fakeService{}, "", nil).Handler()
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/missing", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, location = %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestRuntimesReturnJSONByDefault(t *testing.T) {
	server := New(&fakeService{}, "", nil).Handler()
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/runtimes", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("content-type = %q", rec.Header().Get("Content-Type"))
	}
	var response pb.ListRuntimesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.GetRuntimes()) != 1 || response.GetRuntimes()[0].GetLanguage() != "go" {
		t.Fatalf("response = %+v", response.GetRuntimes())
	}
}

func TestRuntimesReturnJSONWhenJSONAcceptWins(t *testing.T) {
	server := New(&fakeService{}, "", nil).Handler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runtimes", nil)
	req.Header.Set("Accept", "application/json, text/html")
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("content-type = %q", rec.Header().Get("Content-Type"))
	}
}

func TestRuntimesReturnHTMLForBrowsers(t *testing.T) {
	server := New(&fakeService{}, "", nil).Handler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runtimes", nil)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	rec := httptest.NewRecorder()

	server.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("content-type = %q", rec.Header().Get("Content-Type"))
	}
	body := rec.Body.String()
	for _, want := range []string{"Sandkasten Runtimes", "<h2>go</h2>", "1.26", "active"} {
		if !strings.Contains(body, want) {
			t.Fatalf("HTML body missing %q: %s", want, body)
		}
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
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("security headers = %v", rec.Header())
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

func TestGetJobRedactsRunnerPaths(t *testing.T) {
	const backendPath = "/var/lib/sandkasten/laeufer/3c349dbd-ad6a-4d2b-9314-899f04fa4a9d/src/.laeufer-bin/main"
	service := &fakeService{
		job: &pb.Job{
			JobId:        "job-1",
			Status:       pb.JobStatus_JOB_STATUS_RUNTIME_FAILED,
			Language:     "go",
			ErrorMessage: "failed in " + backendPath,
			Result: &pb.JobResult{
				Stdout:        []byte(backendPath + "\n"),
				Stderr:        []byte("open /var/lib/sandkasten/laeufer/3c349dbd-ad6a-4d2b-9314-899f04fa4a9d/src/user_info.txt: permission denied\n"),
				CompileStderr: []byte("# example.com/demo\n" + backendPath + ": error\n"),
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
	body := rec.Body.String()
	if strings.Contains(body, "/var/lib/sandkasten/laeufer") || strings.Contains(body, "3c349dbd-ad6a-4d2b-9314-899f04fa4a9d") {
		t.Fatalf("response leaked runner path: %s", body)
	}
	if response.Stdout != "./main\n" {
		t.Fatalf("stdout = %q", response.Stdout)
	}
	if !strings.Contains(response.Stderr, "/workspace/user_info.txt") {
		t.Fatalf("stderr = %q", response.Stderr)
	}
	if !strings.Contains(response.CompileErr, "./main: error") {
		t.Fatalf("compile stderr = %q", response.CompileErr)
	}
	if !strings.Contains(response.ErrorMessage, "failed in ./main") {
		t.Fatalf("error message = %q", response.ErrorMessage)
	}
}

func TestGetJobRedactsTextBeforeBase64Encoding(t *testing.T) {
	const backendPath = "/var/lib/sandkasten/laeufer/3c349dbd-ad6a-4d2b-9314-899f04fa4a9d/src/.laeufer-bin/main"
	service := &fakeService{
		job: &pb.Job{
			JobId:  "job-1",
			Status: pb.JobStatus_JOB_STATUS_SUCCEEDED,
			Result: &pb.JobResult{
				Stdout: []byte(backendPath + "\n"),
			},
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
	if response.Stdout != base64.StdEncoding.EncodeToString([]byte("./main\n")) || response.StdoutEnc != "base64" {
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
