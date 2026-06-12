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
	"html/template"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
)

const (
	defaultHTTPPollInterval = 200 * time.Millisecond
	defaultHTTPWaitTimeout  = 20 * time.Second
	outputEncodingAuto      = "auto"
	outputEncodingUTF8      = "utf8"
	outputEncodingBase64    = "base64"
	maxRunFiles             = 32
	maxRunFileBytes         = 128 * 1024
)

var (
	runnerExecutablePathPattern = regexp.MustCompile(`/(?:var/lib/sandkasten/laeufer|tmp/sandkasten-laeufer[^/\s"']*)/[0-9a-fA-F-]{36}/src/\.laeufer-bin/main(?:\.exe)?`)
	runnerSourcePathPattern     = regexp.MustCompile(`/(?:var/lib/sandkasten/laeufer|tmp/sandkasten-laeufer[^/\s"']*)/[0-9a-fA-F-]{36}/src`)
	runtimesPageTemplate        = template.Must(template.New("runtimes").Parse(runtimesPageHTML))
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
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /v1/runtimes", s.handleRuntimes)
	mux.HandleFunc("POST /v1/go/run", s.handleRunGo)
	mux.HandleFunc("POST /v1/{language}/run", s.handleRunLanguage)
	mux.HandleFunc("POST /v1/run", s.handleRun)
	mux.HandleFunc("GET /v1/jobs/{job_id}", s.handleGetJob)
	return s.withCORS(mux)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, "/v1/runtimes", http.StatusFound)
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
	if acceptsHTML(r) {
		writeRuntimesHTML(w, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRunGo(w http.ResponseWriter, r *http.Request) {
	s.handleRunWithLanguage(w, r, "go")
}

func (s *Server) handleRunLanguage(w http.ResponseWriter, r *http.Request) {
	s.handleRunWithLanguage(w, r, r.PathValue("language"))
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	s.handleRunWithLanguage(w, r, "")
}

func (s *Server) handleRunWithLanguage(w http.ResponseWriter, r *http.Request, pathLanguage string) {
	if !s.authorize(w, r) {
		return
	}
	var req runRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeHTTPError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}

	if req.Language == "" {
		req.Language = pathLanguage
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
		writeJSON(w, http.StatusAccepted, submitResponse{JobID: resp.JobId, Status: resp.Status.String()})
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
	response, err := jobResponseFromProto(job, req.OutputEncoding)
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	writeJSON(w, statusForJob(job), response)
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
	response, err := jobResponseFromProto(job, r.URL.Query().Get("outputEncoding"))
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response)
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
	case errors.Is(err, jobs.ErrResourceExhausted):
		writeHTTPError(w, http.StatusServiceUnavailable, "resource_exhausted", err.Error())
	default:
		writeHTTPError(w, http.StatusInternalServerError, "internal_error", err.Error())
	}
}

type runRequest struct {
	Language         string    `json:"language"`
	Source           string    `json:"source"`
	ArchiveTargz     string    `json:"archiveTargz"`
	Files            []runFile `json:"files"`
	Entrypoint       string    `json:"entrypoint"`
	Stdin            string    `json:"stdin"`
	Args             []string  `json:"args"`
	CompileTimeoutMs uint32    `json:"compileTimeoutMs"`
	RunTimeoutMs     uint32    `json:"runTimeoutMs"`
	MemoryLimitBytes uint64    `json:"memoryLimitBytes"`
	CPUMillis        uint32    `json:"cpuMillis"`
	MaxOutputBytes   uint64    `json:"maxOutputBytes"`
	OutputEncoding   string    `json:"outputEncoding"`
	Wait             bool      `json:"wait"`
	WaitTimeoutMs    uint32    `json:"waitTimeoutMs"`
}

type runFile struct {
	Name     string `json:"name"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

func (r runRequest) toProto() (*pb.SubmitGoProjectRequest, error) {
	var archive []byte
	var entrypoint = r.Entrypoint
	language := normalizeLanguage(r.Language)
	switch {
	case r.ArchiveTargz != "":
		if len(r.Files) > 0 {
			return nil, errors.New("files can only be used with source")
		}
		decoded, err := base64.StdEncoding.DecodeString(r.ArchiveTargz)
		if err != nil {
			return nil, fmt.Errorf("archiveTargz must be base64: %w", err)
		}
		archive = decoded
	case strings.TrimSpace(r.Source) != "":
		generated, err := sourceArchive(language, r.Source, r.Files)
		if err != nil {
			return nil, err
		}
		archive = generated
		if entrypoint == "" {
			entrypoint = defaultEntrypoint(language)
		}
	default:
		return nil, errors.New("source or archiveTargz is required")
	}

	return &pb.SubmitGoProjectRequest{
		Language:         language,
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

func normalizeLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	switch language {
	case "", "golang":
		return "go"
	case "shell", "sh":
		return "bash"
	case "cj", "cjc", "仓颉":
		return "cangjie"
	case "clj":
		return "clojure"
	case "c++":
		return "cpp"
	case "cs", "c#":
		return "csharp"
	case "coqtop", "coqc":
		return "coq"
	case "cr":
		return "crystal"
	case "dart":
		return "dart"
	case "ex", "exs":
		return "elixir"
	case "erl", "erts":
		return "erlang"
	case "f#", "fs", "f-sharp", "f_sharp":
		return "fsharp"
	case "gd", "godot", "godot3":
		return "gdscript"
	case "hs", "ghc":
		return "haskell"
	case "js", "node":
		return "javascript"
	case "jl":
		return "julia"
	case "kt":
		return "kotlin"
	case "lean":
		return "lean4"
	case "lua5.4":
		return "lua"
	case "mojolang":
		return "mojo"
	case "nf":
		return "nextflow"
	case "nimrod":
		return "nim"
	case "perl5":
		return "perl"
	case "php8", "php8.2":
		return "php"
	case "pl", "swi-prolog", "swipl":
		return "prolog"
	case "py", "python3":
		return "python"
	case "qtqml", "qml5", "qml6":
		return "qml"
	case "rscript":
		return "r"
	case "rkt":
		return "racket"
	case "rb":
		return "ruby"
	case "rs":
		return "rust"
	case "sc":
		return "scala"
	case "sqlite", "sqlite3":
		return "sql"
	case "swift":
		return "swift"
	case "ts":
		return "typescript"
	case "workflow-description-language":
		return "wdl"
	case "zig":
		return "zig"
	default:
		return language
	}
}

func defaultEntrypoint(language string) string {
	switch language {
	case "go":
		return "."
	case "bash":
		return "main.sh"
	case "c":
		return "main.c"
	case "cangjie":
		return "main.cj"
	case "clojure":
		return "main.clj"
	case "cpp":
		return "main.cpp"
	case "csharp":
		return "Program.cs"
	case "coq":
		return "main.v"
	case "crystal":
		return "main.cr"
	case "dart":
		return "main.dart"
	case "elixir":
		return "main.exs"
	case "erlang":
		return "main.erl"
	case "fsharp":
		return "main.fs"
	case "gdscript":
		return "main.gd"
	case "haskell":
		return "Main.hs"
	case "java":
		return "Main.java"
	case "javascript":
		return "main.js"
	case "julia":
		return "main.jl"
	case "kotlin":
		return "Main.kt"
	case "lean4":
		return "Main.lean"
	case "lua":
		return "main.lua"
	case "mojo":
		return "main.mojo"
	case "nextflow":
		return "main.nf"
	case "nim":
		return "main.nim"
	case "perl":
		return "main.pl"
	case "php":
		return "main.php"
	case "prolog":
		return "main.pl"
	case "python":
		return "main.py"
	case "qml":
		return "main.qml"
	case "r":
		return "main.R"
	case "racket":
		return "main.rkt"
	case "ruby":
		return "main.rb"
	case "rust":
		return "main.rs"
	case "scala":
		return "Main.scala"
	case "sql":
		return "main.sql"
	case "swift":
		return "main.swift"
	case "typescript":
		return "main.ts"
	case "wdl":
		return "main.wdl"
	case "zig":
		return "main.zig"
	default:
		return "main"
	}
}

func sourceArchive(language, source string, files []runFile) ([]byte, error) {
	switch language {
	case "go":
		return goSourceArchive(source, files)
	case "bash", "c", "cangjie", "clojure", "cpp", "csharp", "coq", "crystal", "dart", "elixir", "erlang", "fsharp", "gdscript", "haskell", "java", "javascript", "julia", "kotlin", "lean4", "lua", "mojo", "nextflow", "nim", "perl", "php", "prolog", "python", "qml", "r", "racket", "ruby", "rust", "scala", "sql", "swift", "typescript", "wdl", "zig":
		return singleFileArchive(defaultEntrypoint(language), []byte(source), files)
	default:
		return nil, fmt.Errorf("unsupported language %q", language)
	}
}

func goSourceArchive(source string, files []runFile) ([]byte, error) {
	return archiveWithRequestFiles([]archiveFile{
		{name: "go.mod", body: []byte("module example.com/sandkasten/http-run\n\ngo 1.22\n")},
		{name: "main.go", body: []byte(source)},
		{name: "vendor/modules.txt", body: []byte("# no external module dependencies\n")},
	}, files)
}

func singleFileArchive(name string, body []byte, files []runFile) ([]byte, error) {
	return archiveWithRequestFiles([]archiveFile{{name: name, body: body}}, files)
}

type archiveFile struct {
	name string
	body []byte
}

func archiveWithRequestFiles(generated []archiveFile, requestFiles []runFile) ([]byte, error) {
	files, err := mergeRequestFiles(generated, requestFiles)
	if err != nil {
		return nil, err
	}
	return archiveWithFiles(files)
}

func mergeRequestFiles(generated []archiveFile, requestFiles []runFile) ([]archiveFile, error) {
	if len(requestFiles) > maxRunFiles {
		return nil, fmt.Errorf("files contains too many entries; limit is %d", maxRunFiles)
	}

	used := make(map[string]struct{}, len(generated)+len(requestFiles))
	files := make([]archiveFile, 0, len(generated)+len(requestFiles))
	for _, file := range generated {
		name, err := normalizeRunFileName(file.name)
		if err != nil {
			return nil, err
		}
		used[name] = struct{}{}
		files = append(files, archiveFile{name: name, body: file.body})
	}

	for _, requestFile := range requestFiles {
		file, err := requestFile.archiveFile()
		if err != nil {
			return nil, err
		}
		if _, exists := used[file.name]; exists {
			return nil, fmt.Errorf("file %q conflicts with a generated source file", file.name)
		}
		used[file.name] = struct{}{}
		files = append(files, file)
	}

	return files, nil
}

func (f runFile) archiveFile() (archiveFile, error) {
	name, err := normalizeRunFileName(f.Name)
	if err != nil {
		return archiveFile{}, err
	}
	body, err := decodeRunFileContent(f)
	if err != nil {
		return archiveFile{}, err
	}
	if len(body) > maxRunFileBytes {
		return archiveFile{}, fmt.Errorf("file %q is too large; limit is %d bytes", name, maxRunFileBytes)
	}
	return archiveFile{name: name, body: body}, nil
}

func normalizeRunFileName(name string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if normalized == "" {
		return "", errors.New("file name is required")
	}
	if strings.ContainsRune(normalized, 0) {
		return "", fmt.Errorf("file name %q contains a null byte", name)
	}

	clean := path.Clean(normalized)
	if clean == "." || clean == ".." || path.IsAbs(clean) || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("file name %q must be a relative path inside the source directory", name)
	}
	for _, part := range strings.Split(clean, "/") {
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("file name %q must be a relative path inside the source directory", name)
		}
		if strings.HasPrefix(part, ".laeufer-") {
			return "", fmt.Errorf("file name %q is reserved for runner output", name)
		}
	}
	return clean, nil
}

func decodeRunFileContent(file runFile) ([]byte, error) {
	switch strings.ToLower(strings.TrimSpace(file.Encoding)) {
	case "", outputEncodingUTF8, "text":
		return []byte(file.Content), nil
	case outputEncodingBase64:
		body, err := base64.StdEncoding.DecodeString(file.Content)
		if err != nil {
			return nil, fmt.Errorf("file %q content must be base64: %w", file.Name, err)
		}
		return body, nil
	default:
		return nil, fmt.Errorf("file %q encoding must be one of %q or %q", file.Name, outputEncodingUTF8, outputEncodingBase64)
	}
}

func archiveWithFiles(files []archiveFile) ([]byte, error) {
	var buffer bytes.Buffer
	gzipWriter, err := gzip.NewWriterLevel(&buffer, gzip.BestSpeed)
	if err != nil {
		return nil, err
	}
	tarWriter := tar.NewWriter(gzipWriter)

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

type submitResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type jobResponse struct {
	JobID         string      `json:"jobId"`
	Status        string      `json:"status"`
	Language      string      `json:"language"`
	Runtime       string      `json:"runtime"`
	Stdout        string      `json:"stdout"`
	Stderr        string      `json:"stderr"`
	CompileOut    string      `json:"compileStdout"`
	CompileErr    string      `json:"compileStderr"`
	StdoutEnc     string      `json:"stdoutEncoding"`
	StderrEnc     string      `json:"stderrEncoding"`
	CompileOutEnc string      `json:"compileStdoutEncoding"`
	CompileErrEnc string      `json:"compileStderrEncoding"`
	ExitCode      int32       `json:"exitCode,omitempty"`
	Signal        int32       `json:"signal,omitempty"`
	DurationMs    uint64      `json:"durationMs"`
	ErrorMessage  string      `json:"errorMessage"`
	Truncated     truncation  `json:"truncated"`
	Diagnostics   diagnostics `json:"diagnostics"`
}

type truncation struct {
	Stdout bool `json:"stdout"`
	Stderr bool `json:"stderr"`
}

type diagnostics struct {
	MemoryPeakBytes    uint64 `json:"memoryPeakBytes"`
	MemoryOOMKillCount uint64 `json:"memoryOomKillCount"`
	CPUUsageUsec       uint64 `json:"cpuUsageUsec"`
	CPUThrottledUsec   uint64 `json:"cpuThrottledUsec"`
	PidsPeak           uint64 `json:"pidsPeak"`
}

type runtimesPageData struct {
	GeneratedAt string
	ActiveCount int
	TotalCount  int
	Runtimes    []runtimePageRuntime
}

type runtimePageRuntime struct {
	Language          string
	LanguageClass     string
	Badge             string
	Version           string
	Status            string
	DefaultEntrypoint string
	Aliases           string
	CompileCommand    string
	RunCommand        string
	CompileTimeout    string
	RunTimeout        string
	MemoryLimit       string
	CPUMillis         string
	OutputLimit       string
	Active            bool
}

func acceptsHTML(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	htmlQuality := acceptQuality(accept, "text/html")
	jsonQuality := acceptQuality(accept, "application/json")
	return htmlQuality > 0 && htmlQuality > jsonQuality
}

func acceptQuality(accept, target string) float64 {
	var best float64
	target = strings.ToLower(target)
	for _, item := range strings.Split(accept, ",") {
		mediaRange, quality := parseAcceptItem(item)
		if quality <= best {
			continue
		}
		if mediaRange == target || mediaRange == targetTypeWildcard(target) {
			best = quality
		}
	}
	return best
}

func parseAcceptItem(item string) (string, float64) {
	parts := strings.Split(item, ";")
	mediaRange := strings.ToLower(strings.TrimSpace(parts[0]))
	if mediaRange == "" {
		return "", 0
	}
	quality := 1.0
	for _, param := range parts[1:] {
		name, value, ok := strings.Cut(strings.TrimSpace(param), "=")
		if !ok || !strings.EqualFold(strings.TrimSpace(name), "q") {
			continue
		}
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil || parsed < 0 {
			return mediaRange, 0
		}
		if parsed > 1 {
			parsed = 1
		}
		quality = parsed
	}
	return mediaRange, quality
}

func targetTypeWildcard(target string) string {
	mediaType, _, ok := strings.Cut(target, "/")
	if !ok {
		return ""
	}
	return mediaType + "/*"
}

func writeRuntimesHTML(w http.ResponseWriter, resp *pb.ListRuntimesResponse) {
	var buffer bytes.Buffer
	if err := runtimesPageTemplate.Execute(&buffer, runtimesPageDataFromProto(resp)); err != nil {
		writeHTTPError(w, http.StatusInternalServerError, "render_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buffer.Bytes())
}

func runtimesPageDataFromProto(resp *pb.ListRuntimesResponse) runtimesPageData {
	runtimes := append([]*pb.Runtime(nil), resp.GetRuntimes()...)
	sort.Slice(runtimes, func(i, j int) bool {
		return runtimes[i].GetLanguage() < runtimes[j].GetLanguage()
	})

	data := runtimesPageData{
		GeneratedAt: time.Now().UTC().Format("2006-01-02 15:04:05 UTC"),
		TotalCount:  len(runtimes),
		Runtimes:    make([]runtimePageRuntime, 0, len(runtimes)),
	}
	for _, runtime := range runtimes {
		status := runtime.GetStatus()
		active := status == "active"
		if active {
			data.ActiveCount++
		}
		limits := runtime.GetDefaultLimits()
		language := runtime.GetLanguage()
		data.Runtimes = append(data.Runtimes, runtimePageRuntime{
			Language:          language,
			LanguageClass:     runtimeLanguageClass(language),
			Badge:             runtimeBadge(language),
			Version:           fallback(runtime.GetVersion(), "system"),
			Status:            fallback(status, "unknown"),
			DefaultEntrypoint: fallback(runtime.GetDefaultEntrypoint(), "-"),
			Aliases:           joinOrDash(runtime.GetAliases()),
			CompileCommand:    runtimeCommand(runtime.GetCompilePhase()),
			RunCommand:        runtimeCommand(runtime.GetRunPhase()),
			CompileTimeout:    formatRuntimeMillis(limits.GetCompileTimeoutMs()),
			RunTimeout:        formatRuntimeMillis(limits.GetRunTimeoutMs()),
			MemoryLimit:       formatRuntimeBytes(limits.GetMemoryLimitBytes()),
			CPUMillis:         formatRuntimeMillis(limits.GetCpuMillis()),
			OutputLimit:       formatRuntimeBytes(limits.GetOutputBytes()),
			Active:            active,
		})
	}
	return data
}

func runtimeBadge(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "bash":
		return "SH"
	case "c":
		return "C"
	case "cangjie":
		return "CJ"
	case "cpp":
		return "C++"
	case "csharp":
		return "CS"
	case "coq":
		return "COQ"
	case "go":
		return "GO"
	case "java":
		return "JV"
	case "javascript":
		return "JS"
	case "julia":
		return "JL"
	case "kotlin":
		return "KT"
	case "lean4":
		return "LN4"
	case "lua":
		return "LUA"
	case "php":
		return "PHP"
	case "prolog":
		return "PL"
	case "python":
		return "PY"
	case "r":
		return "R"
	case "racket":
		return "RKT"
	case "ruby":
		return "RB"
	case "rust":
		return "RS"
	case "scala":
		return "SC"
	case "sql":
		return "SQL"
	case "swift":
		return "SW"
	case "typescript":
		return "TS"
	case "zig":
		return "ZIG"
	default:
		value := strings.ToUpper(strings.TrimSpace(language))
		runes := []rune(value)
		if len(runes) <= 3 {
			return fallback(value, "?")
		}
		return string(runes[:3])
	}
}

func runtimeLanguageClass(language string) string {
	var builder strings.Builder
	for _, char := range strings.ToLower(language) {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
		case char == '-' || char == '_':
			builder.WriteByte('-')
		}
	}
	if builder.Len() == 0 {
		return "runtime"
	}
	return builder.String()
}

func runtimeCommand(phase *pb.RuntimePhase) string {
	if phase == nil || !phase.GetEnabled() || len(phase.GetCommand()) == 0 {
		return "-"
	}
	return strings.Join(phase.GetCommand(), " ")
}

func joinOrDash(values []string) string {
	if len(values) == 0 {
		return "-"
	}
	return strings.Join(values, ", ")
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func formatRuntimeMillis(value uint32) string {
	if value == 0 {
		return "-"
	}
	if value >= 1000 && value%1000 == 0 {
		return fmt.Sprintf("%ds", value/1000)
	}
	return fmt.Sprintf("%d ms", value)
}

func formatRuntimeBytes(value uint64) string {
	if value == 0 {
		return "-"
	}
	const mib = 1024 * 1024
	if value >= mib && value%mib == 0 {
		return fmt.Sprintf("%d MiB", value/mib)
	}
	return fmt.Sprintf("%d B", value)
}

func jobResponseFromProto(job *pb.Job, requestedEncoding string) (jobResponse, error) {
	encoding, err := normalizeOutputEncoding(requestedEncoding)
	if err != nil {
		return jobResponse{}, err
	}
	result := job.GetResult()
	runtimeVersion := ""
	if job.GetRuntime() != nil {
		runtimeVersion = job.GetRuntime().GetVersion()
	}
	stdout, stdoutEncoding := encodeArtifact(redactArtifact(result.GetStdout()), encoding)
	stderr, stderrEncoding := encodeArtifact(redactArtifact(result.GetStderr()), encoding)
	compileOut, compileOutEncoding := encodeArtifact(redactArtifact(result.GetCompileStdout()), encoding)
	compileErr, compileErrEncoding := encodeArtifact(redactArtifact(result.GetCompileStderr()), encoding)

	return jobResponse{
		JobID:         job.GetJobId(),
		Status:        job.GetStatus().String(),
		Language:      job.GetLanguage(),
		Runtime:       runtimeVersion,
		Stdout:        stdout,
		Stderr:        stderr,
		CompileOut:    compileOut,
		CompileErr:    compileErr,
		StdoutEnc:     stdoutEncoding,
		StderrEnc:     stderrEncoding,
		CompileOutEnc: compileOutEncoding,
		CompileErrEnc: compileErrEncoding,
		ExitCode:      result.GetExitCode(),
		Signal:        result.GetSignal(),
		DurationMs:    result.GetWallTimeMs(),
		ErrorMessage:  redactRunnerPaths(job.GetErrorMessage()),
		Truncated: truncation{
			Stdout: result.GetStdoutTruncated(),
			Stderr: result.GetStderrTruncated(),
		},
		Diagnostics: diagnostics{
			MemoryPeakBytes:    result.GetMemoryPeakBytes(),
			MemoryOOMKillCount: result.GetMemoryOomKillCount(),
			CPUUsageUsec:       result.GetCpuUsageUsec(),
			CPUThrottledUsec:   result.GetCpuThrottledUsec(),
			PidsPeak:           result.GetPidsPeak(),
		},
	}, nil
}

func redactArtifact(body []byte) []byte {
	if len(body) == 0 || !utf8.Valid(body) {
		return body
	}
	redacted := redactRunnerPaths(string(body))
	if redacted == string(body) {
		return body
	}
	return []byte(redacted)
}

func redactRunnerPaths(value string) string {
	if value == "" {
		return value
	}
	value = runnerExecutablePathPattern.ReplaceAllString(value, "./main")
	return runnerSourcePathPattern.ReplaceAllString(value, "/workspace")
}

func normalizeOutputEncoding(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", outputEncodingAuto:
		return outputEncodingAuto, nil
	case outputEncodingUTF8:
		return outputEncodingUTF8, nil
	case outputEncodingBase64:
		return outputEncodingBase64, nil
	default:
		return "", fmt.Errorf("outputEncoding must be one of %q, %q, or %q", outputEncodingAuto, outputEncodingUTF8, outputEncodingBase64)
	}
}

func encodeArtifact(body []byte, encoding string) (string, string) {
	switch encoding {
	case outputEncodingBase64:
		return base64.StdEncoding.EncodeToString(body), outputEncodingBase64
	case outputEncodingUTF8:
		return string(body), outputEncodingUTF8
	default:
		if utf8.Valid(body) {
			return string(body), outputEncodingUTF8
		}
		return base64.StdEncoding.EncodeToString(body), outputEncodingBase64
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

const runtimesPageHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sandkasten Runtimes</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0d10;
      --surface: #15181e;
      --surface-strong: #1b1f27;
      --line: #313640;
      --line-soft: rgba(255, 255, 255, 0.08);
      --text: #f2f0e8;
      --muted: #a8afba;
      --dim: #747d8b;
      --green: #57d68d;
      --cyan: #64c7e8;
      --amber: #f0ba63;
      --rose: #ee7390;
      --code: #0f1116;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
        var(--bg);
      background-size: 36px 36px;
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1220px, calc(100vw - 36px));
      margin: 0 auto;
      padding: 36px 0 52px;
    }
    .page-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 28px;
      min-height: 178px;
      padding: 30px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(87, 214, 141, 0.18), transparent 28%),
        linear-gradient(90deg, rgba(100, 199, 232, 0.12), transparent 42%),
        var(--surface-strong);
      box-shadow: 0 22px 80px rgba(0, 0, 0, 0.28);
    }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--green);
      font-size: 12px;
      font-weight: 850;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      max-width: 780px;
      font-size: clamp(34px, 5vw, 64px);
      line-height: 0.95;
      letter-spacing: 0;
    }
    .subtitle {
      max-width: 650px;
      margin: 14px 0 0;
      color: var(--muted);
      font-size: 15px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(116px, 1fr));
      gap: 10px;
      width: min(100%, 330px);
      flex: 0 0 auto;
    }
    .stat {
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: rgba(11, 13, 16, 0.38);
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 830;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .stat strong {
      display: block;
      margin-top: 6px;
      color: var(--text);
      font-size: 30px;
      line-height: 1;
    }
    .stat-wide {
      grid-column: 1 / -1;
    }
    .stat-wide strong {
      color: var(--muted);
      font-size: 13px;
      font-weight: 720;
      line-height: 1.35;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: 28px 0 14px;
      color: var(--muted);
    }
    .toolbar-title {
      margin: 0;
      color: var(--text);
      font-size: 18px;
      line-height: 1.1;
    }
    .toolbar-note {
      color: var(--dim);
      font-size: 12px;
      text-align: right;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(305px, 1fr));
      gap: 14px;
    }
    article {
      min-width: 0;
      position: relative;
      overflow: hidden;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(21, 24, 30, 0.94);
      box-shadow: 0 14px 45px rgba(0, 0, 0, 0.22);
    }
    article::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 3px;
      background: var(--accent, var(--green));
    }
    .runtime-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .runtime-id {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 12px;
    }
    .runtime-id > div { min-width: 0; }
    .runtime-mark {
      display: inline-grid;
      width: 46px;
      height: 46px;
      flex: 0 0 auto;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: color-mix(in srgb, var(--accent, var(--green)) 18%, #11141a);
      color: var(--text);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.02em;
    }
    h2 {
      margin: 0;
      overflow: hidden;
      font-size: 25px;
      line-height: 1.1;
      letter-spacing: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .version {
      margin-top: 5px;
      color: var(--muted);
      font-size: 13px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex: 0 0 auto;
      min-height: 28px;
      padding: 0 9px;
      border-radius: 999px;
      color: var(--amber);
      background: rgba(240, 186, 99, 0.11);
      font-size: 12px;
      font-weight: 820;
    }
    .is-active .status {
      color: #bff6d4;
      background: rgba(87, 214, 141, 0.13);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: currentColor;
      box-shadow: 0 0 18px currentColor;
    }
    dl {
      display: grid;
      gap: 10px;
      margin: 0;
    }
    .runtime-meta {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: 12px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.025);
    }
    .runtime-limits {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 16px;
    }
    dt, .command-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 820;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    dd {
      min-width: 0;
      margin: 4px 0 0;
      overflow: hidden;
      color: var(--text);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .command {
      display: grid;
      gap: 6px;
      margin-top: 14px;
    }
    code {
      display: block;
      min-height: 38px;
      overflow-wrap: anywhere;
      padding: 9px 10px;
      border: 1px solid var(--line-soft);
      border-radius: 6px;
      background: var(--code);
      color: var(--text);
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
    }
    .lang-c { --accent: #64c7e8; }
    .lang-cpp { --accent: #6f9cff; }
    .lang-csharp { --accent: #b984ff; }
    .lang-go { --accent: #57d6c7; }
    .lang-java { --accent: #f0ba63; }
    .lang-javascript { --accent: #f4d35e; }
    .lang-python { --accent: #7ab8ff; }
    .lang-r { --accent: #78a7ff; }
    .lang-rust { --accent: #ee8f73; }
    .lang-typescript { --accent: #69a7ff; }
    .lang-csharp .runtime-mark,
    .lang-javascript .runtime-mark,
    .lang-rust .runtime-mark {
      color: #fff8ea;
    }
    footer {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }
    @media (max-width: 700px) {
      main { width: min(100vw - 20px, 1220px); padding: 18px 0 34px; }
      .page-head { align-items: flex-start; flex-direction: column; min-height: 0; padding: 20px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
      .toolbar { align-items: flex-start; flex-direction: column; gap: 5px; }
      .toolbar-note { text-align: left; }
      .grid { grid-template-columns: 1fr; }
      .runtime-head { align-items: flex-start; }
      .runtime-limits { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main>
    <header class="page-head">
      <div>
        <p class="eyebrow">run.diesw.tech</p>
        <h1>Sandkasten Runtimes</h1>
        <p class="subtitle">Live language runtimes, entry files, command phases, and default execution limits.</p>
      </div>
      <section class="stats" aria-label="Runtime summary">
        <div class="stat"><span>active</span><strong>{{.ActiveCount}}</strong></div>
        <div class="stat"><span>total</span><strong>{{.TotalCount}}</strong></div>
        <div class="stat stat-wide"><span>generated</span><strong>{{.GeneratedAt}}</strong></div>
      </section>
    </header>
    <div class="toolbar">
      <h2 class="toolbar-title">Available runtimes</h2>
      <div class="toolbar-note">Default limits shown per job phase</div>
    </div>
    <section class="grid" aria-label="Runtime languages">
      {{range .Runtimes}}
      <article class="lang-{{.LanguageClass}} {{if .Active}}is-active{{end}}">
        <div class="runtime-head">
          <div class="runtime-id">
            <span class="runtime-mark">{{.Badge}}</span>
            <div>
              <h2>{{.Language}}</h2>
              <div class="version">{{.Version}}</div>
            </div>
          </div>
          <span class="status"><span class="status-dot"></span>{{.Status}}</span>
        </div>
        <dl class="runtime-meta">
          <div><dt>entry</dt><dd>{{.DefaultEntrypoint}}</dd></div>
          <div><dt>aliases</dt><dd>{{.Aliases}}</dd></div>
        </dl>
        <div class="command">
          <span class="command-label">compile</span>
          <code>{{.CompileCommand}}</code>
        </div>
        <div class="command">
          <span class="command-label">run</span>
          <code>{{.RunCommand}}</code>
        </div>
        <dl class="runtime-limits">
          <div><dt>compile</dt><dd>{{.CompileTimeout}}</dd></div>
          <div><dt>run</dt><dd>{{.RunTimeout}}</dd></div>
          <div><dt>memory</dt><dd>{{.MemoryLimit}}</dd></div>
          <div><dt>cpu</dt><dd>{{.CPUMillis}}</dd></div>
          <div><dt>output</dt><dd>{{.OutputLimit}}</dd></div>
        </dl>
      </article>
      {{end}}
    </section>
    <footer>generated {{.GeneratedAt}}</footer>
  </main>
</body>
</html>`

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeHTTPError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: code, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
