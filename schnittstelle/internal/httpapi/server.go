package httpapi

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
)

const (
	defaultHTTPPollInterval = 200 * time.Millisecond
	defaultHTTPWaitTimeout  = 20 * time.Second
)

type jobService interface {
	SubmitGoProject(context.Context, *pb.SubmitGoProjectRequest) (*pb.SubmitGoProjectResponse, error)
	GetJob(context.Context, *pb.GetJobRequest) (*pb.Job, error)
	ListRuntimes(context.Context, *pb.ListRuntimesRequest) (*pb.ListRuntimesResponse, error)
}

type Server struct {
	service        jobService
	authToken      string
	allowedOrigins map[string]struct{}
	allowAnyOrigin bool
}

func New(service jobService, authToken string, allowedOrigins []string) *Server {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	allowAny := false
	for _, origin := range allowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		if origin == "*" {
			allowAny = true
			continue
		}
		allowed[origin] = struct{}{}
	}
	return &Server{
		service:        service,
		authToken:      authToken,
		allowedOrigins: allowed,
		allowAnyOrigin: allowAny,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /v1/runtimes", s.handleRuntimes)
	mux.HandleFunc("POST /v1/go/run", s.handleRunGo)
	mux.HandleFunc("GET /v1/jobs/{job_id}", s.handleGetJob)
	return s.withCORS(mux)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleRuntimes(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	resp, err := s.service.ListRuntimes(r.Context(), &pb.ListRuntimesRequest{})
	if err != nil {
		s.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRunGo(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	var req runGoRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeHTTPError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}

	submit, err := req.toProto()
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	resp, err := s.service.SubmitGoProject(r.Context(), submit)
	if err != nil {
		s.writeError(w, err)
		return
	}

	wait := req.Wait
	if req.WaitTimeoutMs > 0 {
		wait = true
	}
	if !wait {
		writeJSON(w, http.StatusAccepted, submitGoResponse{JobID: resp.JobId, Status: resp.Status.String()})
		return
	}

	timeout := defaultHTTPWaitTimeout
	if req.WaitTimeoutMs > 0 {
		timeout = time.Duration(req.WaitTimeoutMs) * time.Millisecond
	}
	job, err := s.waitForJob(r.Context(), resp.JobId, timeout)
	if err != nil {
		s.writeError(w, err)
		return
	}
	writeJSON(w, statusForJob(job), jobResponseFromProto(job))
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	jobID := r.PathValue("job_id")
	if jobID == "" {
		writeHTTPError(w, http.StatusBadRequest, "invalid_request", "job id is required")
		return
	}
	job, err := s.service.GetJob(r.Context(), &pb.GetJobRequest{JobId: jobID})
	if err != nil {
		s.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, jobResponseFromProto(job))
}

func (s *Server) waitForJob(ctx context.Context, jobID string, timeout time.Duration) (*pb.Job, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	ticker := time.NewTicker(defaultHTTPPollInterval)
	defer ticker.Stop()

	for {
		job, err := s.service.GetJob(ctx, &pb.GetJobRequest{JobId: jobID})
		if err != nil {
			return nil, err
		}
		if isTerminal(job.Status) {
			return job, nil
		}

		select {
		case <-ctx.Done():
			return job, nil
		case <-ticker.C:
		}
	}
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	if s.authToken == "" {
		return true
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) == "Bearer "+s.authToken {
		return true
	}
	if r.Header.Get("X-Sandkasten-Token") == s.authToken {
		return true
	}
	writeHTTPError(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
	return false
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if s.isOriginAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "authorization, content-type, x-sandkasten-token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) isOriginAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	if s.allowAnyOrigin {
		return true
	}
	_, ok := s.allowedOrigins[origin]
	return ok
}

func (s *Server) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, jobs.ErrInvalidArgument):
		writeHTTPError(w, http.StatusBadRequest, "invalid_request", err.Error())
	case errors.Is(err, jobs.ErrNotFound):
		writeHTTPError(w, http.StatusNotFound, "not_found", err.Error())
	default:
		writeHTTPError(w, http.StatusInternalServerError, "internal_error", err.Error())
	}
}

type runGoRequest struct {
	Source           string   `json:"source"`
	ArchiveTargz     string   `json:"archiveTargz"`
	Entrypoint       string   `json:"entrypoint"`
	Stdin            string   `json:"stdin"`
	Args             []string `json:"args"`
	CompileTimeoutMs uint32   `json:"compileTimeoutMs"`
	RunTimeoutMs     uint32   `json:"runTimeoutMs"`
	MemoryLimitBytes uint64   `json:"memoryLimitBytes"`
	CPUMillis        uint32   `json:"cpuMillis"`
	MaxOutputBytes   uint64   `json:"maxOutputBytes"`
	Wait             bool     `json:"wait"`
	WaitTimeoutMs    uint32   `json:"waitTimeoutMs"`
}

func (r runGoRequest) toProto() (*pb.SubmitGoProjectRequest, error) {
	var archive []byte
	var entrypoint = r.Entrypoint
	switch {
	case r.ArchiveTargz != "":
		decoded, err := base64.StdEncoding.DecodeString(r.ArchiveTargz)
		if err != nil {
			return nil, fmt.Errorf("archiveTargz must be base64: %w", err)
		}
		archive = decoded
	case strings.TrimSpace(r.Source) != "":
		generated, err := goSourceArchive(r.Source)
		if err != nil {
			return nil, err
		}
		archive = generated
		if entrypoint == "" {
			entrypoint = "."
		}
	default:
		return nil, errors.New("source or archiveTargz is required")
	}

	return &pb.SubmitGoProjectRequest{
		ArchiveTargz:     archive,
		Entrypoint:       entrypoint,
		Stdin:            []byte(r.Stdin),
		Args:             append([]string{}, r.Args...),
		CompileTimeoutMs: r.CompileTimeoutMs,
		RunTimeoutMs:     r.RunTimeoutMs,
		MemoryLimitBytes: r.MemoryLimitBytes,
		CpuMillis:        r.CPUMillis,
		MaxOutputBytes:   r.MaxOutputBytes,
	}, nil
}

func goSourceArchive(source string) ([]byte, error) {
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)

	files := []struct {
		name string
		body []byte
	}{
		{name: "go.mod", body: []byte("module example.com/sandkasten/http-run\n\ngo 1.22\n")},
		{name: "main.go", body: []byte(source)},
		{name: "vendor/modules.txt", body: []byte("# no external module dependencies\n")},
	}

	for _, file := range files {
		header := &tar.Header{
			Name:    file.name,
			Mode:    0o644,
			Size:    int64(len(file.body)),
			ModTime: time.Unix(0, 0),
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return nil, err
		}
		if _, err := tarWriter.Write(file.body); err != nil {
			return nil, err
		}
	}
	if err := tarWriter.Close(); err != nil {
		return nil, err
	}
	if err := gzipWriter.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

type submitGoResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type jobResponse struct {
	JobID        string     `json:"jobId"`
	Status       string     `json:"status"`
	Language     string     `json:"language"`
	Runtime      string     `json:"runtime"`
	Stdout       string     `json:"stdout"`
	Stderr       string     `json:"stderr"`
	CompileOut   string     `json:"compileStdout"`
	CompileErr   string     `json:"compileStderr"`
	ExitCode     int32      `json:"exitCode,omitempty"`
	Signal       int32      `json:"signal,omitempty"`
	DurationMs   uint64     `json:"durationMs"`
	ErrorMessage string     `json:"errorMessage"`
	Truncated    truncation `json:"truncated"`
}

type truncation struct {
	Stdout bool `json:"stdout"`
	Stderr bool `json:"stderr"`
}

func jobResponseFromProto(job *pb.Job) jobResponse {
	result := job.GetResult()
	runtimeVersion := ""
	if job.GetRuntime() != nil {
		runtimeVersion = job.GetRuntime().GetVersion()
	}
	return jobResponse{
		JobID:        job.GetJobId(),
		Status:       job.GetStatus().String(),
		Language:     job.GetLanguage(),
		Runtime:      runtimeVersion,
		Stdout:       string(result.GetStdout()),
		Stderr:       string(result.GetStderr()),
		CompileOut:   string(result.GetCompileStdout()),
		CompileErr:   string(result.GetCompileStderr()),
		ExitCode:     result.GetExitCode(),
		Signal:       result.GetSignal(),
		DurationMs:   result.GetWallTimeMs(),
		ErrorMessage: job.GetErrorMessage(),
		Truncated: truncation{
			Stdout: result.GetStdoutTruncated(),
			Stderr: result.GetStderrTruncated(),
		},
	}
}

func statusForJob(job *pb.Job) int {
	if isTerminal(job.Status) {
		return http.StatusOK
	}
	return http.StatusAccepted
}

func isTerminal(status pb.JobStatus) bool {
	switch status {
	case pb.JobStatus_JOB_STATUS_SUCCEEDED,
		pb.JobStatus_JOB_STATUS_COMPILE_FAILED,
		pb.JobStatus_JOB_STATUS_RUNTIME_FAILED,
		pb.JobStatus_JOB_STATUS_TIME_LIMIT_EXCEEDED,
		pb.JobStatus_JOB_STATUS_MEMORY_LIMIT_EXCEEDED,
		pb.JobStatus_JOB_STATUS_OUTPUT_LIMIT_EXCEEDED,
		pb.JobStatus_JOB_STATUS_CANCELED,
		pb.JobStatus_JOB_STATUS_SYSTEM_ERROR:
		return true
	default:
		return false
	}
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeHTTPError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: code, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
