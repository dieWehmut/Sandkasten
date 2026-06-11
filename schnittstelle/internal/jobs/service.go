package jobs

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

var (
	ErrInvalidArgument   = errors.New("invalid argument")
	ErrNotFound          = errors.New("not found")
	ErrResourceExhausted = errors.New("resource exhausted")
)

type Repository interface {
	CreateJob(ctx context.Context, job CreateJob) (*pb.SubmitGoProjectResponse, error)
	GetJob(ctx context.Context, jobID string) (*pb.Job, error)
	CancelJob(ctx context.Context, jobID string) (*pb.CancelJobResponse, error)
	ListRuntimes(ctx context.Context) ([]*pb.Runtime, error)
	StreamEvents(ctx context.Context, jobID string, afterSequence uint64) (<-chan *pb.JobEvent, <-chan error)
}

type CreateJob struct {
	ArchiveTargz     []byte
	Entrypoint       string
	Stdin            []byte
	Args             []string
	CompileTimeoutMS uint32
	RunTimeoutMS     uint32
	MemoryLimitBytes uint64
	CPUMillis        uint32
	MaxOutputBytes   uint64
	Runtime          *pb.Runtime
}

type Service struct {
	repo                    Repository
	defaultRuntime          *pb.Runtime
	runtimes                map[string]*pb.Runtime
	limits                  SubmissionLimits
	defaultResources        ResourceDefaults
	runtimeLimits           map[string]SubmissionLimits
	runtimeResourceDefaults map[string]ResourceDefaults
}

func NewService(repo Repository, defaultRuntime *pb.Runtime) *Service {
	return NewServiceWithRuntimes(repo, defaultRuntime, []*pb.Runtime{defaultRuntime})
}

func NewServiceWithRuntimes(repo Repository, defaultRuntime *pb.Runtime, runtimes []*pb.Runtime) *Service {
	return NewServiceWithOptions(repo, defaultRuntime, runtimes, ServiceOptions{})
}

type ServiceOptions struct {
	Limits                  SubmissionLimits
	DefaultResources        ResourceDefaults
	RuntimeLimits           map[string]SubmissionLimits
	RuntimeResourceDefaults map[string]ResourceDefaults
}

type SubmissionLimits struct {
	MaxArchiveBytes     uint64
	MaxStdinBytes       uint64
	MaxArgs             int
	MaxArgBytes         uint64
	MaxCompileTimeoutMS uint32
	MaxRunTimeoutMS     uint32
	MaxMemoryLimitBytes uint64
	MaxCPUMillis        uint32
	MaxOutputBytes      uint64
}

type ResourceDefaults struct {
	CompileTimeoutMS uint32
	RunTimeoutMS     uint32
	MemoryLimitBytes uint64
	CPUMillis        uint32
	MaxOutputBytes   uint64
}

func DefaultSubmissionLimits() SubmissionLimits {
	return SubmissionLimits{
		MaxArchiveBytes:     64 * 1024 * 1024,
		MaxStdinBytes:       1024 * 1024,
		MaxArgs:             64,
		MaxArgBytes:         8 * 1024,
		MaxCompileTimeoutMS: uint32((120 * time.Second).Milliseconds()),
		MaxRunTimeoutMS:     uint32((30 * time.Second).Milliseconds()),
		MaxMemoryLimitBytes: 1024 * 1024 * 1024,
		MaxCPUMillis:        4000,
		MaxOutputBytes:      4 * 1024 * 1024,
	}
}

func DefaultResourceDefaults() ResourceDefaults {
	return ResourceDefaults{
		CompileTimeoutMS: uint32((30 * time.Second).Milliseconds()),
		RunTimeoutMS:     uint32((5 * time.Second).Milliseconds()),
		MemoryLimitBytes: 256 * 1024 * 1024,
		CPUMillis:        1000,
		MaxOutputBytes:   1024 * 1024,
	}
}

func NewServiceWithOptions(repo Repository, defaultRuntime *pb.Runtime, runtimes []*pb.Runtime, options ServiceOptions) *Service {
	byLanguage := make(map[string]*pb.Runtime, len(runtimes))
	for _, runtime := range runtimes {
		if runtime == nil || strings.TrimSpace(runtime.Language) == "" {
			continue
		}
		byLanguage[normalizeLanguage(runtime.Language)] = cloneRuntime(runtime)
	}
	if defaultRuntime != nil && defaultRuntime.Language != "" {
		byLanguage[normalizeLanguage(defaultRuntime.Language)] = cloneRuntime(defaultRuntime)
	}
	limits := options.Limits.withDefaults()
	defaultResources := options.DefaultResources.withDefaults()
	return &Service{
		repo:                    repo,
		defaultRuntime:          cloneRuntime(defaultRuntime),
		runtimes:                byLanguage,
		limits:                  limits,
		defaultResources:        defaultResources,
		runtimeLimits:           normalizeRuntimeLimits(options.RuntimeLimits, limits),
		runtimeResourceDefaults: normalizeRuntimeResourceDefaults(options.RuntimeResourceDefaults, defaultResources),
	}
}

func (s *Service) SubmitGoProject(ctx context.Context, req *pb.SubmitGoProjectRequest) (*pb.SubmitGoProjectResponse, error) {
	job, err := s.normalize(req)
	if err != nil {
		return nil, err
	}
	return s.repo.CreateJob(ctx, job)
}

func (s *Service) GetJob(ctx context.Context, req *pb.GetJobRequest) (*pb.Job, error) {
	if req == nil || req.JobId == "" {
		return nil, ErrInvalidArgument
	}
	job, err := s.repo.GetJob(ctx, req.JobId)
	if err != nil {
		return nil, err
	}
	s.enrichJobRuntime(job)
	return job, nil
}

func (s *Service) CancelJob(ctx context.Context, req *pb.CancelJobRequest) (*pb.CancelJobResponse, error) {
	if req == nil || req.JobId == "" {
		return nil, ErrInvalidArgument
	}
	return s.repo.CancelJob(ctx, req.JobId)
}

func (s *Service) ListRuntimes(ctx context.Context, req *pb.ListRuntimesRequest) (*pb.ListRuntimesResponse, error) {
	if len(s.runtimes) == 0 {
		storedRuntimes, err := s.repo.ListRuntimes(ctx)
		if err != nil {
			return nil, err
		}
		runtimes := make([]*pb.Runtime, 0, len(storedRuntimes))
		for _, runtime := range storedRuntimes {
			runtimes = append(runtimes, s.runtimeManifest(runtime))
		}
		return &pb.ListRuntimesResponse{Runtimes: runtimes}, nil
	}
	languages := make([]string, 0, len(s.runtimes))
	for language := range s.runtimes {
		languages = append(languages, language)
	}
	sort.Strings(languages)
	runtimes := make([]*pb.Runtime, 0, len(languages))
	for _, language := range languages {
		runtimes = append(runtimes, s.runtimeManifest(s.runtimes[language]))
	}
	return &pb.ListRuntimesResponse{Runtimes: runtimes}, nil
}

func (s *Service) StreamJobEvents(ctx context.Context, req *pb.StreamJobEventsRequest) (<-chan *pb.JobEvent, <-chan error, error) {
	if req == nil || req.JobId == "" {
		return nil, nil, ErrInvalidArgument
	}
	events, errs := s.repo.StreamEvents(ctx, req.JobId, req.AfterSequence)
	return events, errs, nil
}

func (s *Service) normalize(req *pb.SubmitGoProjectRequest) (CreateJob, error) {
	if req == nil || len(req.ArchiveTargz) == 0 {
		return CreateJob{}, ErrInvalidArgument
	}
	language := normalizeLanguage(req.Language)
	if language == "" && s.defaultRuntime != nil {
		language = normalizeLanguage(s.defaultRuntime.Language)
	}
	runtime := s.runtimeFor(language)
	if runtime == nil {
		return CreateJob{}, ErrInvalidArgument
	}
	resourceDefaults := s.resourceDefaultsFor(language)
	entrypoint := req.Entrypoint
	if entrypoint == "" {
		entrypoint = defaultEntrypoint(language)
	}
	compileTimeout := req.CompileTimeoutMs
	if compileTimeout == 0 {
		compileTimeout = resourceDefaults.CompileTimeoutMS
	}
	runTimeout := req.RunTimeoutMs
	if runTimeout == 0 {
		runTimeout = resourceDefaults.RunTimeoutMS
	}
	memoryLimit := req.MemoryLimitBytes
	if memoryLimit == 0 {
		memoryLimit = resourceDefaults.MemoryLimitBytes
	}
	cpuMillis := req.CpuMillis
	if cpuMillis == 0 {
		cpuMillis = resourceDefaults.CPUMillis
	}
	maxOutput := req.MaxOutputBytes
	if maxOutput == 0 {
		maxOutput = resourceDefaults.MaxOutputBytes
	}
	job := CreateJob{
		ArchiveTargz:     append([]byte(nil), req.ArchiveTargz...),
		Entrypoint:       entrypoint,
		Stdin:            append([]byte{}, req.Stdin...),
		Args:             append([]string{}, req.Args...),
		CompileTimeoutMS: compileTimeout,
		RunTimeoutMS:     runTimeout,
		MemoryLimitBytes: memoryLimit,
		CPUMillis:        cpuMillis,
		MaxOutputBytes:   maxOutput,
		Runtime:          runtime,
	}
	if err := s.validate(job); err != nil {
		return CreateJob{}, err
	}
	return job, nil
}

func (l SubmissionLimits) withDefaults() SubmissionLimits {
	return l.withFallback(DefaultSubmissionLimits())
}

func (l SubmissionLimits) withFallback(fallback SubmissionLimits) SubmissionLimits {
	if l.MaxArchiveBytes == 0 {
		l.MaxArchiveBytes = fallback.MaxArchiveBytes
	}
	if l.MaxStdinBytes == 0 {
		l.MaxStdinBytes = fallback.MaxStdinBytes
	}
	if l.MaxArgs == 0 {
		l.MaxArgs = fallback.MaxArgs
	}
	if l.MaxArgBytes == 0 {
		l.MaxArgBytes = fallback.MaxArgBytes
	}
	if l.MaxCompileTimeoutMS == 0 {
		l.MaxCompileTimeoutMS = fallback.MaxCompileTimeoutMS
	}
	if l.MaxRunTimeoutMS == 0 {
		l.MaxRunTimeoutMS = fallback.MaxRunTimeoutMS
	}
	if l.MaxMemoryLimitBytes == 0 {
		l.MaxMemoryLimitBytes = fallback.MaxMemoryLimitBytes
	}
	if l.MaxCPUMillis == 0 {
		l.MaxCPUMillis = fallback.MaxCPUMillis
	}
	if l.MaxOutputBytes == 0 {
		l.MaxOutputBytes = fallback.MaxOutputBytes
	}
	return l
}

func (d ResourceDefaults) withDefaults() ResourceDefaults {
	return d.withFallback(DefaultResourceDefaults())
}

func (d ResourceDefaults) withFallback(fallback ResourceDefaults) ResourceDefaults {
	if d.CompileTimeoutMS == 0 {
		d.CompileTimeoutMS = fallback.CompileTimeoutMS
	}
	if d.RunTimeoutMS == 0 {
		d.RunTimeoutMS = fallback.RunTimeoutMS
	}
	if d.MemoryLimitBytes == 0 {
		d.MemoryLimitBytes = fallback.MemoryLimitBytes
	}
	if d.CPUMillis == 0 {
		d.CPUMillis = fallback.CPUMillis
	}
	if d.MaxOutputBytes == 0 {
		d.MaxOutputBytes = fallback.MaxOutputBytes
	}
	return d
}

func (s *Service) validate(job CreateJob) error {
	limits := s.limitsFor(job.Runtime.GetLanguage())
	if uint64(len(job.ArchiveTargz)) > limits.MaxArchiveBytes {
		return fmt.Errorf("%w: archive_targz exceeds %d bytes", ErrInvalidArgument, limits.MaxArchiveBytes)
	}
	if uint64(len(job.Stdin)) > limits.MaxStdinBytes {
		return fmt.Errorf("%w: stdin exceeds %d bytes", ErrInvalidArgument, limits.MaxStdinBytes)
	}
	if len(job.Args) > limits.MaxArgs {
		return fmt.Errorf("%w: args exceeds %d entries", ErrInvalidArgument, limits.MaxArgs)
	}
	var argBytes uint64
	for _, arg := range job.Args {
		argBytes += uint64(len(arg))
		if argBytes > limits.MaxArgBytes {
			return fmt.Errorf("%w: args exceed %d bytes", ErrInvalidArgument, limits.MaxArgBytes)
		}
	}
	if job.CompileTimeoutMS > limits.MaxCompileTimeoutMS {
		return fmt.Errorf("%w: compile_timeout_ms exceeds %d", ErrInvalidArgument, limits.MaxCompileTimeoutMS)
	}
	if job.RunTimeoutMS > limits.MaxRunTimeoutMS {
		return fmt.Errorf("%w: run_timeout_ms exceeds %d", ErrInvalidArgument, limits.MaxRunTimeoutMS)
	}
	if job.MemoryLimitBytes > limits.MaxMemoryLimitBytes {
		return fmt.Errorf("%w: memory_limit_bytes exceeds %d", ErrInvalidArgument, limits.MaxMemoryLimitBytes)
	}
	if job.CPUMillis > limits.MaxCPUMillis {
		return fmt.Errorf("%w: cpu_millis exceeds %d", ErrInvalidArgument, limits.MaxCPUMillis)
	}
	if job.MaxOutputBytes > limits.MaxOutputBytes {
		return fmt.Errorf("%w: max_output_bytes exceeds %d", ErrInvalidArgument, limits.MaxOutputBytes)
	}
	return nil
}

func (s *Service) limitsFor(language string) SubmissionLimits {
	if limits, ok := s.runtimeLimits[normalizeLanguage(language)]; ok {
		return limits
	}
	return s.limits
}

func (s *Service) resourceDefaultsFor(language string) ResourceDefaults {
	if defaults, ok := s.runtimeResourceDefaults[normalizeLanguage(language)]; ok {
		return defaults
	}
	return s.defaultResources
}

func (s *Service) runtimeFor(language string) *pb.Runtime {
	language = normalizeLanguage(language)
	if language == "" {
		return s.runtimeManifest(s.defaultRuntime)
	}
	runtime := s.runtimes[language]
	if runtime == nil {
		return nil
	}
	return s.runtimeManifest(runtime)
}

func (s *Service) enrichJobRuntime(job *pb.Job) {
	if job == nil {
		return
	}
	language := normalizeLanguage(job.Language)
	if language == "" && job.Runtime != nil {
		language = normalizeLanguage(job.Runtime.Language)
	}
	runtime := s.runtimeFor(language)
	if runtime == nil {
		return
	}
	if job.Runtime != nil && job.Runtime.Version != "" {
		runtime.Version = job.Runtime.Version
	}
	job.Runtime = runtime
}

func (s *Service) runtimeManifest(runtime *pb.Runtime) *pb.Runtime {
	runtime = cloneRuntime(runtime)
	if runtime == nil {
		return nil
	}
	language := normalizeLanguage(runtime.Language)
	if language == "" {
		return runtime
	}
	runtime.Language = language
	if len(runtime.Aliases) == 0 {
		runtime.Aliases = runtimeAliases(language)
	}
	if runtime.Status == "" {
		runtime.Status = "active"
	}
	if runtime.DefaultEntrypoint == "" {
		runtime.DefaultEntrypoint = defaultEntrypoint(language)
	}
	if runtime.CompilePhase == nil {
		runtime.CompilePhase = runtimeCompilePhase(language)
	}
	if runtime.RunPhase == nil {
		runtime.RunPhase = runtimeRunPhase(language)
	}
	if runtime.DefaultLimits == nil {
		runtime.DefaultLimits = runtimeDefaultLimits(s.resourceDefaultsFor(language))
	}
	if runtime.MaxLimits == nil {
		runtime.MaxLimits = runtimeMaxLimits(s.limitsFor(language))
	}
	return runtime
}

func normalizeLanguage(language string) string {
	return NormalizeLanguage(language)
}

func NormalizeLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	switch language {
	case "golang":
		return "go"
	case "shell", "sh":
		return "bash"
	case "c++":
		return "cpp"
	case "cs", "c#":
		return "csharp"
	case "coqtop", "coqc":
		return "coq"
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
	case "php8", "php8.2":
		return "php"
	case "pl", "swi-prolog", "swipl":
		return "prolog"
	case "py", "python3":
		return "python"
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
	case "ts":
		return "typescript"
	case "zig":
		return "zig"
	default:
		return language
	}
}

func normalizeRuntimeLimits(runtimeLimits map[string]SubmissionLimits, fallback SubmissionLimits) map[string]SubmissionLimits {
	normalized := make(map[string]SubmissionLimits, len(runtimeLimits))
	for language, limits := range runtimeLimits {
		language = normalizeLanguage(language)
		if language == "" {
			continue
		}
		normalized[language] = limits.withFallback(fallback)
	}
	return normalized
}

func normalizeRuntimeResourceDefaults(runtimeDefaults map[string]ResourceDefaults, fallback ResourceDefaults) map[string]ResourceDefaults {
	normalized := make(map[string]ResourceDefaults, len(runtimeDefaults))
	for language, defaults := range runtimeDefaults {
		language = normalizeLanguage(language)
		if language == "" {
			continue
		}
		normalized[language] = defaults.withFallback(fallback)
	}
	return normalized
}

func defaultEntrypoint(language string) string {
	switch normalizeLanguage(language) {
	case "bash":
		return "main.sh"
	case "c":
		return "main.c"
	case "cpp":
		return "main.cpp"
	case "csharp":
		return "Program.cs"
	case "coq":
		return "main.v"
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
	case "php":
		return "main.php"
	case "prolog":
		return "main.pl"
	case "python":
		return "main.py"
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
	case "typescript":
		return "main.ts"
	case "zig":
		return "main.zig"
	default:
		return "."
	}
}

func runtimeAliases(language string) []string {
	switch normalizeLanguage(language) {
	case "bash":
		return []string{"shell", "sh"}
	case "go":
		return []string{"golang"}
	case "cpp":
		return []string{"c++"}
	case "csharp":
		return []string{"cs", "c#"}
	case "coq":
		return []string{"coqtop", "coqc"}
	case "javascript":
		return []string{"js", "node"}
	case "julia":
		return []string{"jl"}
	case "kotlin":
		return []string{"kt"}
	case "lean4":
		return []string{"lean"}
	case "lua":
		return []string{"lua5.4"}
	case "php":
		return []string{"php8", "php8.2"}
	case "prolog":
		return []string{"pl", "swi-prolog", "swipl"}
	case "python":
		return []string{"py", "python3"}
	case "r":
		return []string{"rscript"}
	case "racket":
		return []string{"rkt"}
	case "ruby":
		return []string{"rb"}
	case "rust":
		return []string{"rs"}
	case "scala":
		return []string{"sc"}
	case "sql":
		return []string{"sqlite", "sqlite3"}
	case "typescript":
		return []string{"ts"}
	case "zig":
		return nil
	default:
		return nil
	}
}

func runtimeCompilePhase(language string) *pb.RuntimePhase {
	switch normalizeLanguage(language) {
	case "go":
		return phase("go", "build", "-mod=vendor", "-trimpath", "-o", ".laeufer-bin/main", ".")
	case "bash":
		return phase("bash", "-n", "main.sh")
	case "c":
		return phase("gcc", "-O2", "-pipe", "-o", ".laeufer-bin/main", "main.c")
	case "cpp":
		return phase("g++", "-std=c++20", "-O2", "-pipe", "-o", ".laeufer-bin/main", "main.cpp")
	case "csharp":
		return phase("mcs", "-nologo", "-out:.laeufer-bin/main.exe", "Program.cs")
	case "coq":
		return phase("coqc", "-q", "-R", ".", "Sandbox", "main.v")
	case "java":
		return phase("javac", "-encoding", "UTF-8", "-d", ".laeufer-bin", "Main.java")
	case "javascript":
		return phase("node", "--check", "main.js")
	case "julia":
		return phase("julia", "--startup-file=no", "--history-file=no", "--compile=min", "--optimize=0", "-e", "function has_parse_error(x); x isa Expr && (x.head in (:error, :incomplete) || any(has_parse_error, x.args)); end; ex = Meta.parseall(read(ARGS[1], String)); has_parse_error(ex) && (println(stderr, \"Julia syntax error\"); exit(1))", "main.jl")
	case "kotlin":
		return phase("kotlinc", "-J-XX:ActiveProcessorCount=1", "-J-Djava.io.tmpdir=.laeufer-tmp", "Main.kt", "-include-runtime", "-d", ".laeufer-bin/main.jar")
	case "lean4":
		return phase("lean", "-o", ".laeufer-bin/main.olean", "Main.lean")
	case "lua":
		return phase("luac", "-p", "main.lua")
	case "php":
		return phase("php", "-d", "variables_order=EGPCS", "-d", "opcache.enable_cli=0", "-l", "main.php")
	case "prolog":
		return phase("swipl", "--no-packs", "-q", "-f", "none", "-g", "current_prolog_flag(argv, [Path|_]), setup_call_cleanup(open(Path, read, S, [encoding(utf8)]), (repeat, read_term(S, Term, [syntax_errors(error)]), (Term == end_of_file -> ! ; fail)), close(S)), halt.", "--", "main.pl")
	case "python":
		return phase("python3", "-c", "import ast, pathlib, sys; path=sys.argv[1]; ast.parse(pathlib.Path(path).read_text(encoding='utf-8'), filename=path)", "main.py")
	case "r":
		return phase("Rscript", "--vanilla", "-e", "args <- commandArgs(trailingOnly = TRUE); parse(file = args[[1]])", "main.R")
	case "racket":
		return phase("raco", "make", "main.rkt")
	case "ruby":
		return phase("ruby", "-c", "main.rb")
	case "rust":
		return phase("rustc", "--edition=2021", "-O", "-o", ".laeufer-bin/main", "main.rs")
	case "scala":
		return phase("scalac", "-J-XX:ActiveProcessorCount=1", "-J-Djava.io.tmpdir=.laeufer-tmp", "-d", ".laeufer-bin", "Main.scala")
	case "sql":
		return phase("bash", "--noprofile", "--norc", "-c", "test -r \"$1\"", "_", "main.sql")
	case "typescript":
		return phase("tsc", "--target", "ES2022", "--module", "commonjs", "--outDir", ".laeufer-bin", "main.ts")
	case "zig":
		return phase("zig", "build-exe", "-O", "ReleaseSafe", "-lc", "--cache-dir", ".laeufer-cache/zig-cache", "--global-cache-dir", ".laeufer-cache/zig-global-cache", "-femit-bin=.laeufer-bin/main", "main.zig")
	default:
		return &pb.RuntimePhase{}
	}
}

func runtimeRunPhase(language string) *pb.RuntimePhase {
	switch normalizeLanguage(language) {
	case "go", "c", "cpp", "rust":
		return phase(".laeufer-bin/main")
	case "bash":
		return phase("bash", "--noprofile", "--norc", "main.sh")
	case "csharp":
		return phase("mono", ".laeufer-bin/main.exe")
	case "coq":
		return phase("test", "-f", "main.vo")
	case "java":
		return phase("java", "-cp", ".laeufer-bin", "Main")
	case "javascript":
		return phase("node", "main.js")
	case "julia":
		return phase("julia", "--startup-file=no", "--history-file=no", "--compile=min", "--optimize=0", "main.jl")
	case "kotlin":
		return phase("java", "-XX:ActiveProcessorCount=1", "-Djava.io.tmpdir=.laeufer-tmp", "-jar", ".laeufer-bin/main.jar")
	case "lean4":
		return phase("lean", "--run", "Main.lean")
	case "lua":
		return phase("lua", "main.lua")
	case "php":
		return phase("php", "-d", "variables_order=EGPCS", "-d", "opcache.enable_cli=0", "main.php")
	case "prolog":
		return phase("swipl", "--no-packs", "-q", "-f", "none", "-s", "main.pl", "-g", "main", "-t", "halt")
	case "python":
		return phase("python3", "-B", "main.py")
	case "r":
		return phase("Rscript", "--vanilla", "main.R")
	case "racket":
		return phase("racket", "-t", "main.rkt")
	case "ruby":
		return phase("ruby", "--disable=gems", "main.rb")
	case "scala":
		return phase("scala", "-J-XX:ActiveProcessorCount=1", "-Dscala.usejavacp=true", "-cp", ".laeufer-bin", "Main")
	case "sql":
		return phase("bash", "--noprofile", "--norc", "-c", "exec sqlite3 -batch -bail -safe :memory: < \"$1\"", "_", "main.sql")
	case "typescript":
		return phase("node", ".laeufer-bin/main.js")
	case "zig":
		return phase(".laeufer-bin/main")
	default:
		return &pb.RuntimePhase{}
	}
}

func phase(command ...string) *pb.RuntimePhase {
	return &pb.RuntimePhase{Command: command, Enabled: len(command) > 0}
}

func runtimeDefaultLimits(defaults ResourceDefaults) *pb.RuntimeLimits {
	return &pb.RuntimeLimits{
		CompileTimeoutMs: defaults.CompileTimeoutMS,
		RunTimeoutMs:     defaults.RunTimeoutMS,
		MemoryLimitBytes: defaults.MemoryLimitBytes,
		CpuMillis:        defaults.CPUMillis,
		OutputBytes:      defaults.MaxOutputBytes,
	}
}

func runtimeMaxLimits(limits SubmissionLimits) *pb.RuntimeLimits {
	maxArgs := limits.MaxArgs
	if maxArgs < 0 {
		maxArgs = 0
	}
	return &pb.RuntimeLimits{
		CompileTimeoutMs: limits.MaxCompileTimeoutMS,
		RunTimeoutMs:     limits.MaxRunTimeoutMS,
		MemoryLimitBytes: limits.MaxMemoryLimitBytes,
		CpuMillis:        limits.MaxCPUMillis,
		OutputBytes:      limits.MaxOutputBytes,
		ArchiveBytes:     limits.MaxArchiveBytes,
		StdinBytes:       limits.MaxStdinBytes,
		Args:             uint32(maxArgs),
		ArgBytes:         limits.MaxArgBytes,
	}
}

func cloneRuntime(runtime *pb.Runtime) *pb.Runtime {
	if runtime == nil {
		return nil
	}
	return &pb.Runtime{
		Language:          runtime.Language,
		Version:           runtime.Version,
		Image:             runtime.Image,
		RequiresVendor:    runtime.RequiresVendor,
		Aliases:           append([]string(nil), runtime.Aliases...),
		Status:            runtime.Status,
		DefaultEntrypoint: runtime.DefaultEntrypoint,
		CompilePhase:      cloneRuntimePhase(runtime.CompilePhase),
		RunPhase:          cloneRuntimePhase(runtime.RunPhase),
		DefaultLimits:     cloneRuntimeLimits(runtime.DefaultLimits),
		MaxLimits:         cloneRuntimeLimits(runtime.MaxLimits),
	}
}

func cloneRuntimePhase(phase *pb.RuntimePhase) *pb.RuntimePhase {
	if phase == nil {
		return nil
	}
	return &pb.RuntimePhase{
		Command: append([]string(nil), phase.Command...),
		Enabled: phase.Enabled,
	}
}

func cloneRuntimeLimits(limits *pb.RuntimeLimits) *pb.RuntimeLimits {
	if limits == nil {
		return nil
	}
	return &pb.RuntimeLimits{
		CompileTimeoutMs: limits.CompileTimeoutMs,
		RunTimeoutMs:     limits.RunTimeoutMs,
		MemoryLimitBytes: limits.MemoryLimitBytes,
		CpuMillis:        limits.CpuMillis,
		OutputBytes:      limits.OutputBytes,
		ArchiveBytes:     limits.ArchiveBytes,
		StdinBytes:       limits.StdinBytes,
		Args:             limits.Args,
		ArgBytes:         limits.ArgBytes,
	}
}
