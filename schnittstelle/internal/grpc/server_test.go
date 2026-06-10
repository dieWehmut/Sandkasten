package grpc

import (
	"testing"

	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGrpcErrorMapsResourceExhausted(t *testing.T) {
	if got := status.Code(grpcError(jobs.ErrResourceExhausted)); got != codes.ResourceExhausted {
		t.Fatalf("grpcError(ErrResourceExhausted) code = %v, want %v", got, codes.ResourceExhausted)
	}
}
