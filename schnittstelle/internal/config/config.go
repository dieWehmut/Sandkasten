package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
)

type Config struct {
	GRPCListenAddr          string
	HTTPListenAddr          string
	HTTPCORSOrigins         []string
	DatabaseURL             string
	AuthToken               string
	DBMaxOpenConns          int
	DBMaxIdleConns          int
	DBConnMaxLifetime       time.Duration
	EventPollInterval       time.Duration
	MaxQueuedJobs           int
	MaxActiveJobs           int
	DefaultRuntime          *pb.Runtime
	SupportedRuntimes       []*pb.Runtime
	SubmissionLimits        jobs.SubmissionLimits
	ResourceDefaults        jobs.ResourceDefaults
	RuntimeSubmissionLimits map[string]jobs.SubmissionLimits
	RuntimeResourceDefaults map[string]jobs.ResourceDefaults
}

func Load() Config {
	defaultRuntime := &pb.Runtime{
		Language:       envString("SANDKASTEN_RUNTIME_LANGUAGE", "go"),
		Version:        envString("SANDKASTEN_RUNTIME_VERSION", "1.26"),
		Image:          envString("SANDKASTEN_RUNTIME_IMAGE", "sandkasten/go:1.26"),
		RequiresVendor: envBool("SANDKASTEN_RUNTIME_REQUIRES_VENDOR", true),
	}
	supported := supportedRuntimes(defaultRuntime)
	limits := submissionLimits()
	resourceDefaults := submissionResourceDefaults()
	return Config{
		GRPCListenAddr: envString("SANDKASTEN_API_GRPC_ADDR", ":50051"),
		HTTPListenAddr: envString("SANDKASTEN_API_HTTP_ADDR", "127.0.0.1:8080"),
		HTTPCORSOrigins: envList("SANDKASTEN_API_CORS_ORIGINS", []string{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"http://localhost:4173",
			"http://127.0.0.1:4173",
			"http://localhost:4174",
			"http://127.0.0.1:4174",
		}),
		DatabaseURL:             envString("DATABASE_URL", "postgres://sandkasten:sandkasten@localhost:5432/sandkasten?sslmode=disable"),
		AuthToken:               os.Getenv("SANDKASTEN_API_TOKEN"),
		DBMaxOpenConns:          envInt("SANDKASTEN_DB_MAX_OPEN_CONNS", 10),
		DBMaxIdleConns:          envInt("SANDKASTEN_DB_MAX_IDLE_CONNS", 5),
		DBConnMaxLifetime:       envDuration("SANDKASTEN_DB_CONN_MAX_LIFETIME", 30*time.Minute),
		EventPollInterval:       envDuration("SANDKASTEN_EVENT_POLL_INTERVAL", time.Second),
		MaxQueuedJobs:           envInt("SANDKASTEN_MAX_QUEUED_JOBS", 0),
		MaxActiveJobs:           envInt("SANDKASTEN_MAX_ACTIVE_JOBS", 0),
		DefaultRuntime:          defaultRuntime,
		SupportedRuntimes:       supported,
		SubmissionLimits:        limits,
		ResourceDefaults:        resourceDefaults,
		RuntimeSubmissionLimits: runtimeSubmissionLimits(supported),
		RuntimeResourceDefaults: runtimeResourceDefaults(supported),
	}
}

func submissionLimits() jobs.SubmissionLimits {
	defaults := jobs.DefaultSubmissionLimits()
	return jobs.SubmissionLimits{
		MaxArchiveBytes:     envUint64("SANDKASTEN_MAX_ARCHIVE_BYTES", defaults.MaxArchiveBytes),
		MaxStdinBytes:       envUint64("SANDKASTEN_MAX_STDIN_BYTES", defaults.MaxStdinBytes),
		MaxArgs:             envInt("SANDKASTEN_MAX_ARGS", defaults.MaxArgs),
		MaxArgBytes:         envUint64("SANDKASTEN_MAX_ARG_BYTES", defaults.MaxArgBytes),
		MaxCompileTimeoutMS: envUint32("SANDKASTEN_MAX_COMPILE_TIMEOUT_MS", defaults.MaxCompileTimeoutMS),
		MaxRunTimeoutMS:     envUint32("SANDKASTEN_MAX_RUN_TIMEOUT_MS", defaults.MaxRunTimeoutMS),
		MaxMemoryLimitBytes: envUint64("SANDKASTEN_MAX_MEMORY_LIMIT_BYTES", defaults.MaxMemoryLimitBytes),
		MaxCPUMillis:        envUint32("SANDKASTEN_MAX_CPU_MILLIS", defaults.MaxCPUMillis),
		MaxOutputBytes:      envUint64("SANDKASTEN_MAX_OUTPUT_BYTES", defaults.MaxOutputBytes),
	}
}

func submissionResourceDefaults() jobs.ResourceDefaults {
	defaults := jobs.DefaultResourceDefaults()
	return jobs.ResourceDefaults{
		CompileTimeoutMS: envUint32("SANDKASTEN_DEFAULT_COMPILE_TIMEOUT_MS", defaults.CompileTimeoutMS),
		RunTimeoutMS:     envUint32("SANDKASTEN_DEFAULT_RUN_TIMEOUT_MS", defaults.RunTimeoutMS),
		MemoryLimitBytes: envUint64("SANDKASTEN_DEFAULT_MEMORY_LIMIT_BYTES", defaults.MemoryLimitBytes),
		CPUMillis:        envUint32("SANDKASTEN_DEFAULT_CPU_MILLIS", defaults.CPUMillis),
		MaxOutputBytes:   envUint64("SANDKASTEN_DEFAULT_OUTPUT_BYTES", defaults.MaxOutputBytes),
	}
}

func runtimeSubmissionLimits(runtimes []*pb.Runtime) map[string]jobs.SubmissionLimits {
	limits := make(map[string]jobs.SubmissionLimits)
	for _, runtime := range runtimes {
		language := jobs.NormalizeLanguage(runtime.GetLanguage())
		prefix := runtimeEnvPrefix(language)
		if prefix == "" {
			continue
		}
		var current jobs.SubmissionLimits
		configured := false
		if value, ok := lookupEnvUint64(prefix + "_MAX_ARCHIVE_BYTES"); ok {
			current.MaxArchiveBytes = value
			configured = true
		}
		if value, ok := lookupEnvUint64(prefix + "_MAX_STDIN_BYTES"); ok {
			current.MaxStdinBytes = value
			configured = true
		}
		if value, ok := lookupEnvInt(prefix + "_MAX_ARGS"); ok {
			current.MaxArgs = value
			configured = true
		}
		if value, ok := lookupEnvUint64(prefix + "_MAX_ARG_BYTES"); ok {
			current.MaxArgBytes = value
			configured = true
		}
		if value, ok := lookupEnvUint32(prefix + "_MAX_COMPILE_TIMEOUT_MS"); ok {
			current.MaxCompileTimeoutMS = value
			configured = true
		}
		if value, ok := lookupEnvUint32(prefix + "_MAX_RUN_TIMEOUT_MS"); ok {
			current.MaxRunTimeoutMS = value
			configured = true
		}
		if value, ok := lookupEnvUint64(prefix + "_MAX_MEMORY_LIMIT_BYTES"); ok {
			current.MaxMemoryLimitBytes = value
			configured = true
		}
		if value, ok := lookupEnvUint32(prefix + "_MAX_CPU_MILLIS"); ok {
			current.MaxCPUMillis = value
			configured = true
		}
		if value, ok := lookupEnvUint64(prefix + "_MAX_OUTPUT_BYTES"); ok {
			current.MaxOutputBytes = value
			configured = true
		}
		if configured {
			limits[language] = current
		}
	}
	return limits
}

func runtimeResourceDefaults(runtimes []*pb.Runtime) map[string]jobs.ResourceDefaults {
	defaults := make(map[string]jobs.ResourceDefaults)
	for _, runtime := range runtimes {
		language := jobs.NormalizeLanguage(runtime.GetLanguage())
		prefix := runtimeEnvPrefix(language)
		if prefix == "" {
			continue
		}
		current, configured := builtInRuntimeResourceDefault(language)
		if value, ok := lookupEnvUint32(prefix + "_DEFAULT_COMPILE_TIMEOUT_MS"); ok {
			current.CompileTimeoutMS = value
			configured = true
		}
		if value, ok := lookupEnvUint32(prefix + "_DEFAULT_RUN_TIMEOUT_MS"); ok {
			current.RunTimeoutMS = value
			configured = true
		}
		if value, ok := lookupEnvUint64(prefix + "_DEFAULT_MEMORY_LIMIT_BYTES"); ok {
			current.MemoryLimitBytes = value
			configured = true
		}
		if value, ok := lookupEnvUint32(prefix + "_DEFAULT_CPU_MILLIS"); ok {
			current.CPUMillis = value
			configured = true
		}
		if value, ok := lookupEnvUint64(prefix + "_DEFAULT_OUTPUT_BYTES"); ok {
			current.MaxOutputBytes = value
			configured = true
		}
		if configured {
			defaults[language] = current
		}
	}
	return defaults
}

func builtInRuntimeResourceDefault(language string) (jobs.ResourceDefaults, bool) {
	const oneGiB = 1024 * 1024 * 1024

	switch language {
	case "cangjie", "crystal", "dart", "fsharp", "fortran", "gdscript", "gleam", "haskell",
		"kotlin", "latex", "markdown", "mdx", "mojo", "nextflow", "nim", "qml", "racket",
		"scala", "swift", "typescript", "typst", "vlang", "wdl", "zig":
		return jobs.ResourceDefaults{
			CompileTimeoutMS: uint32((120 * time.Second).Milliseconds()),
			RunTimeoutMS:     uint32((30 * time.Second).Milliseconds()),
			MemoryLimitBytes: oneGiB,
			CPUMillis:        4000,
			MaxOutputBytes:   1024 * 1024,
		}, true
	case "nextjs", "tsx", "vue3":
		return jobs.ResourceDefaults{
			CompileTimeoutMS: uint32((60 * time.Second).Milliseconds()),
			RunTimeoutMS:     uint32((15 * time.Second).Milliseconds()),
			MemoryLimitBytes: oneGiB,
			CPUMillis:        4000,
			MaxOutputBytes:   1024 * 1024,
		}, true
	default:
		return jobs.ResourceDefaults{}, false
	}
}

func supportedRuntimes(defaultRuntime *pb.Runtime) []*pb.Runtime {
	languages := envList("SANDKASTEN_RUNTIME_LANGUAGES", []string{
		"go",
		"assembly",
		"bash",
		"c",
		"cangjie",
		"clojure",
		"css",
		"cpp",
		"csharp",
		"coq",
		"crystal",
		"dart",
		"elixir",
		"erlang",
		"fsharp",
		"fortran",
		"gdscript",
		"gleam",
		"graphviz",
		"haskell",
		"html",
		"java",
		"javascript",
		"julia",
		"kotlin",
		"lean4",
		"latex",
		"lua",
		"markdown",
		"mdx",
		"mojo",
		"nextjs",
		"nextflow",
		"nim",
		"octave",
		"ocaml",
		"pascal",
		"perl",
		"php",
		"prolog",
		"python",
		"qml",
		"r",
		"racket",
		"ruby",
		"rust",
		"scala",
		"scss",
		"sql",
		"swift",
		"tailwindcss",
		"typescript",
		"tsx",
		"typst",
		"vlang",
		"vue3",
		"wdl",
		"zig",
	})
	runtimes := make([]*pb.Runtime, 0, len(languages))
	for _, language := range languages {
		language = jobs.NormalizeLanguage(language)
		if language == "" {
			continue
		}
		if defaultRuntime != nil && language == jobs.NormalizeLanguage(defaultRuntime.Language) {
			runtimes = append(runtimes, cloneRuntime(defaultRuntime))
			continue
		}
		versionName := "SANDKASTEN_RUNTIME_" + envSegment(language) + "_VERSION"
		imageName := "SANDKASTEN_RUNTIME_" + envSegment(language) + "_IMAGE"
		runtimes = append(runtimes, &pb.Runtime{
			Language:       language,
			Version:        envString(versionName, "system"),
			Image:          envString(imageName, "sandkasten/"+language+":system"),
			RequiresVendor: language == "go",
		})
	}
	return runtimes
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

func runtimeEnvPrefix(language string) string {
	segment := envSegment(jobs.NormalizeLanguage(language))
	if segment == "" {
		return ""
	}
	return "SANDKASTEN_" + segment
}

func envSegment(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, char := range value {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(builder.String(), "_")
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

func envUint32(name string, fallback uint32) uint32 {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return fallback
	}
	return uint32(parsed)
}

func envUint64(name string, fallback uint64) uint64 {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
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

func lookupEnvInt(name string) (int, bool) {
	value := os.Getenv(name)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func lookupEnvUint32(name string) (uint32, bool) {
	value := os.Getenv(name)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		return 0, false
	}
	return uint32(parsed), true
}

func lookupEnvUint64(name string) (uint64, bool) {
	value := os.Getenv(name)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}
