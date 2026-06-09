package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

type Config struct {
	GRPCListenAddr    string
	HTTPListenAddr    string
	HTTPCORSOrigins   []string
	DatabaseURL       string
	AuthToken         string
	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration
	EventPollInterval time.Duration
	DefaultRuntime    *pb.Runtime
}

func Load() Config {
	return Config{
		GRPCListenAddr:    envString("SANDKASTEN_API_GRPC_ADDR", ":50051"),
		HTTPListenAddr:    envString("SANDKASTEN_API_HTTP_ADDR", "127.0.0.1:8080"),
		HTTPCORSOrigins:   envList("SANDKASTEN_API_CORS_ORIGINS", []string{"http://localhost:5173", "http://127.0.0.1:5173"}),
		DatabaseURL:       envString("DATABASE_URL", "postgres://sandkasten:sandkasten@localhost:5432/sandkasten?sslmode=disable"),
		AuthToken:         os.Getenv("SANDKASTEN_API_TOKEN"),
		DBMaxOpenConns:    envInt("SANDKASTEN_DB_MAX_OPEN_CONNS", 10),
		DBMaxIdleConns:    envInt("SANDKASTEN_DB_MAX_IDLE_CONNS", 5),
		DBConnMaxLifetime: envDuration("SANDKASTEN_DB_CONN_MAX_LIFETIME", 30*time.Minute),
		EventPollInterval: envDuration("SANDKASTEN_EVENT_POLL_INTERVAL", time.Second),
		DefaultRuntime: &pb.Runtime{
			Language:       envString("SANDKASTEN_RUNTIME_LANGUAGE", "go"),
			Version:        envString("SANDKASTEN_RUNTIME_VERSION", "1.23"),
			Image:          envString("SANDKASTEN_RUNTIME_IMAGE", "sandkasten/go:1.23"),
			RequiresVendor: envBool("SANDKASTEN_RUNTIME_REQUIRES_VENDOR", true),
		},
	}
}

func envList(name string, fallback []string) []string {
	value := os.Getenv(name)
	if value == "" {
		return append([]string(nil), fallback...)
	}
	var output []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			output = append(output, item)
		}
	}
	if len(output) == 0 {
		return append([]string(nil), fallback...)
	}
	return output
}

func envString(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(name string, fallback bool) bool {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err == nil {
		return parsed
	}
	millis, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return time.Duration(millis) * time.Millisecond
}
