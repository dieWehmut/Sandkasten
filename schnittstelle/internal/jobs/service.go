package jobs

import (
	"context"
	"errors"
	"time"

	pb "github.com/sandkasten/sandkasten/schnittstelle/gen/sandkasten/v1"
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
	ArchiveTargz      []byte
	Entrypoint        string
	Stdin             []byte
	Args              []string
	CompileTimeoutMS  uint32
	RunTimeoutMS      uint32
	MemoryLimitBytes  uint64
	CPUMillis         uint32
	MaxOutputBytes    uint64
	Runtime           *pb.Runtime
}

type Service struct {
	repo           Repository
	defaultRuntime *pb.Runtime
}

func NewService(repo Repository, defaultRuntime *pb.Runtime) *Service {
	return &Service{repo: repo, defaultRuntime: defaultRuntime}
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
	runtimes, err := s.repo.ListRuntimes(ctx)
	if err != nil {
		return nil, err
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
		ArchiveTargz:      req.ArchiveTargz,
		Entrypoint:        entrypoint,
		Stdin:             req.Stdin,
		Args:              append([]string(nil), req.Args...),
		CompileTimeoutMS:  compileTimeout,
		RunTimeoutMS:      runTimeout,
		MemoryLimitBytes:  memoryLimit,
		CPUMillis:         cpuMillis,
		MaxOutputBytes:    maxOutput,
		Runtime:           s.defaultRuntime,
	}, nil
}

