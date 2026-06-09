package jobs

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

var (
	ErrInvalidArgument = errors.New("invalid argument")
	ErrNotFound        = errors.New("not found")
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
	repo           Repository
	defaultRuntime *pb.Runtime
	runtimes       map[string]*pb.Runtime
}

func NewService(repo Repository, defaultRuntime *pb.Runtime) *Service {
	return NewServiceWithRuntimes(repo, defaultRuntime, []*pb.Runtime{defaultRuntime})
}

func NewServiceWithRuntimes(repo Repository, defaultRuntime *pb.Runtime, runtimes []*pb.Runtime) *Service {
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
	return &Service{repo: repo, defaultRuntime: cloneRuntime(defaultRuntime), runtimes: byLanguage}
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
	return s.repo.GetJob(ctx, req.JobId)
}

func (s *Service) CancelJob(ctx context.Context, req *pb.CancelJobRequest) (*pb.CancelJobResponse, error) {
	if req == nil || req.JobId == "" {
		return nil, ErrInvalidArgument
	}
	return s.repo.CancelJob(ctx, req.JobId)
}

func (s *Service) ListRuntimes(ctx context.Context, req *pb.ListRuntimesRequest) (*pb.ListRuntimesResponse, error) {
	if len(s.runtimes) == 0 {
		runtimes, err := s.repo.ListRuntimes(ctx)
		if err != nil {
			return nil, err
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
		runtimes = append(runtimes, cloneRuntime(s.runtimes[language]))
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
	entrypoint := req.Entrypoint
	if entrypoint == "" {
		entrypoint = "."
	}
	compileTimeout := req.CompileTimeoutMs
	if compileTimeout == 0 {
		compileTimeout = uint32((30 * time.Second).Milliseconds())
	}
	runTimeout := req.RunTimeoutMs
	if runTimeout == 0 {
		runTimeout = uint32((5 * time.Second).Milliseconds())
	}
	memoryLimit := req.MemoryLimitBytes
	if memoryLimit == 0 {
		memoryLimit = 256 * 1024 * 1024
	}
	cpuMillis := req.CpuMillis
	if cpuMillis == 0 {
		cpuMillis = 1000
	}
	maxOutput := req.MaxOutputBytes
	if maxOutput == 0 {
		maxOutput = 1024 * 1024
	}
	return CreateJob{
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
	}, nil
}

func (s *Service) runtimeFor(language string) *pb.Runtime {
	if language == "" {
		return cloneRuntime(s.defaultRuntime)
	}
	runtime := s.runtimes[language]
	if runtime == nil {
		return nil
	}
	return cloneRuntime(runtime)
}

func normalizeLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	switch language {
	case "golang":
		return "go"
	case "c++":
		return "cpp"
	case "cs", "c#":
		return "csharp"
	case "js", "node":
		return "javascript"
	case "py", "python3":
		return "python"
	case "rs":
		return "rust"
	case "ts":
		return "typescript"
	default:
		return language
	}
}

func cloneRuntime(runtime *pb.Runtime) *pb.Runtime {
	if runtime == nil {
		return nil
	}
	return &pb.Runtime{
		Language:       runtime.Language,
		Version:        runtime.Version,
		Image:          runtime.Image,
		RequiresVendor: runtime.RequiresVendor,
	}
}
