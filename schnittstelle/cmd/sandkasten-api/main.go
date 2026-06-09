package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dieWehmut/sandkasten/schnittstelle/internal/auth"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/config"
	api "github.com/dieWehmut/sandkasten/schnittstelle/internal/grpc"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/httpapi"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/postgres"
	_ "github.com/jackc/pgx/v5/stdlib"
	"google.golang.org/grpc"
)

func main() {
	if err := run(); err != nil {
		log.Printf("sandkasten-api stopped: %v", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.Load()

	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(cfg.DBMaxOpenConns)
	db.SetMaxIdleConns(cfg.DBMaxIdleConns)
	db.SetConnMaxLifetime(cfg.DBConnMaxLifetime)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		return err
	}

	repo := postgres.NewRepository(db, cfg.EventPollInterval, cfg.DefaultRuntime)
	service := jobs.NewService(repo, cfg.DefaultRuntime)

	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(auth.UnaryInterceptor(cfg.AuthToken)),
		grpc.StreamInterceptor(auth.StreamInterceptor(cfg.AuthToken)),
	)
	api.Register(grpcServer, service)

	lis, err := net.Listen("tcp", cfg.GRPCListenAddr)
	if err != nil {
		return err
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("sandkasten-api listening on %s", cfg.GRPCListenAddr)
		errCh <- grpcServer.Serve(lis)
	}()

	httpServer := &http.Server{
		Addr:              cfg.HTTPListenAddr,
		Handler:           httpapi.New(service, cfg.AuthToken, cfg.HTTPCORSOrigins).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		log.Printf("sandkasten-api http listening on %s", cfg.HTTPListenAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
		grpcServer.GracefulStop()
		return nil
	case err := <-errCh:
		if errors.Is(err, grpc.ErrServerStopped) {
			return nil
		}
		return err
	}
}
