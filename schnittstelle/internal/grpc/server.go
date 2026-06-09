package grpc

import (
	"context"
	"errors"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type jobService interface {
	SubmitGoProject(context.Context, *pb.SubmitGoProjectRequest) (*pb.SubmitGoProjectResponse, error)
	GetJob(context.Context, *pb.GetJobRequest) (*pb.Job, error)
	CancelJob(context.Context, *pb.CancelJobRequest) (*pb.CancelJobResponse, error)
	ListRuntimes(context.Context, *pb.ListRuntimesRequest) (*pb.ListRuntimesResponse, error)
	StreamJobEvents(context.Context, *pb.StreamJobEventsRequest) (<-chan *pb.JobEvent, <-chan error, error)
}

type server struct {
	service jobService
}

func Register(registrar *grpc.Server, service jobService) {
	srv := &server{service: service}
	pb.RegisterJobServiceServer(registrar, srv)
	pb.RegisterRuntimeServiceServer(registrar, srv)
}

func (s *server) SubmitGoProject(ctx context.Context, req *pb.SubmitGoProjectRequest) (*pb.SubmitGoProjectResponse, error) {
	resp, err := s.service.SubmitGoProject(ctx, req)
	return resp, grpcError(err)
}

func (s *server) GetJob(ctx context.Context, req *pb.GetJobRequest) (*pb.Job, error) {
	resp, err := s.service.GetJob(ctx, req)
	return resp, grpcError(err)
}

func (s *server) CancelJob(ctx context.Context, req *pb.CancelJobRequest) (*pb.CancelJobResponse, error) {
	resp, err := s.service.CancelJob(ctx, req)
	return resp, grpcError(err)
}

func (s *server) ListRuntimes(ctx context.Context, req *pb.ListRuntimesRequest) (*pb.ListRuntimesResponse, error) {
	resp, err := s.service.ListRuntimes(ctx, req)
	return resp, grpcError(err)
}

func (s *server) StreamJobEvents(req *pb.StreamJobEventsRequest, stream pb.JobService_StreamJobEventsServer) error {
	events, errs, err := s.service.StreamJobEvents(stream.Context(), req)
	if err != nil {
		return grpcError(err)
	}
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case err, ok := <-errs:
			if !ok {
				errs = nil
				if events == nil {
					return nil
				}
				continue
			}
			return grpcError(err)
		case event, ok := <-events:
			if !ok {
				events = nil
				if errs == nil {
					return nil
				}
				continue
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}
}

func grpcError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, jobs.ErrInvalidArgument):
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, jobs.ErrNotFound):
		return status.Error(codes.NotFound, err.Error())
	default:
		return status.Error(codes.Internal, err.Error())
	}
}
