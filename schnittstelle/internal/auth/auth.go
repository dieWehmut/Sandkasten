package auth

import (
	"context"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func UnaryInterceptor(token string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if err := authorize(ctx, token); err != nil {
			return nil, err
		}
		return handler(ctx, req)
	}
}

func StreamInterceptor(token string) grpc.StreamServerInterceptor {
	return func(srv interface{}, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if err := authorize(stream.Context(), token); err != nil {
			return err
		}
		return handler(srv, stream)
	}
}

func authorize(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "missing metadata")
	}
	for _, value := range md.Get("authorization") {
		if strings.TrimSpace(value) == "Bearer "+token {
			return nil
		}
	}
	for _, value := range md.Get("x-sandkasten-token") {
		if value == token {
			return nil
		}
	}
	return status.Error(codes.Unauthenticated, "invalid credentials")
}
