package config

import (
	"testing"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

func TestLoadAppliesRuntimeLimitEnv(t *testing.T) {
	t.Setenv("SANDKASTEN_RUNTIME_LANGUAGES", "go,py")
	t.Setenv("SANDKASTEN_PYTHON_DEFAULT_RUN_TIMEOUT_MS", "7000")
	t.Setenv("SANDKASTEN_PYTHON_MAX_RUN_TIMEOUT_MS", "9000")
	t.Setenv("SANDKASTEN_PYTHON_MAX_MEMORY_LIMIT_BYTES", "268435456")

	cfg := Load()

	defaults, ok := cfg.RuntimeResourceDefaults["python"]
	if !ok {
		t.Fatal("RuntimeResourceDefaults[python] missing")
	}
	if defaults.RunTimeoutMS != 7000 {
		t.Fatalf("RunTimeoutMS = %d", defaults.RunTimeoutMS)
	}

	limits, ok := cfg.RuntimeSubmissionLimits["python"]
	if !ok {
		t.Fatal("RuntimeSubmissionLimits[python] missing")
	}
	if limits.MaxRunTimeoutMS != 9000 {
		t.Fatalf("MaxRunTimeoutMS = %d", limits.MaxRunTimeoutMS)
	}
	if limits.MaxMemoryLimitBytes != 268435456 {
		t.Fatalf("MaxMemoryLimitBytes = %d", limits.MaxMemoryLimitBytes)
	}
}

func TestLoadAppliesBuiltInRuntimeResourceDefaults(t *testing.T) {
	t.Setenv("SANDKASTEN_RUNTIME_LANGUAGES", "go,typescript,nim,v")

	cfg := Load()

	defaults, ok := cfg.RuntimeResourceDefaults["typescript"]
	if !ok {
		t.Fatal("RuntimeResourceDefaults[typescript] missing")
	}
	if defaults.CompileTimeoutMS != 120000 {
		t.Fatalf("CompileTimeoutMS = %d", defaults.CompileTimeoutMS)
	}
	if defaults.RunTimeoutMS != 30000 {
		t.Fatalf("RunTimeoutMS = %d", defaults.RunTimeoutMS)
	}
	if defaults.MemoryLimitBytes != 1024*1024*1024 {
		t.Fatalf("MemoryLimitBytes = %d", defaults.MemoryLimitBytes)
	}
	if defaults.CPUMillis != 4000 {
		t.Fatalf("CPUMillis = %d", defaults.CPUMillis)
	}
	for _, language := range []string{"nim", "vlang"} {
		defaults, ok := cfg.RuntimeResourceDefaults[language]
		if !ok {
			t.Fatalf("RuntimeResourceDefaults[%s] missing", language)
		}
		if defaults.CompileTimeoutMS != 120000 || defaults.MemoryLimitBytes != 1024*1024*1024 {
			t.Fatalf("RuntimeResourceDefaults[%s] = %+v", language, defaults)
		}
	}
}

func TestLoadRuntimeEnvOverridesBuiltInResourceDefaults(t *testing.T) {
	t.Setenv("SANDKASTEN_RUNTIME_LANGUAGES", "go,typescript")
	t.Setenv("SANDKASTEN_TYPESCRIPT_DEFAULT_CPU_MILLIS", "2000")

	cfg := Load()

	defaults := cfg.RuntimeResourceDefaults["typescript"]
	if defaults.CPUMillis != 2000 {
		t.Fatalf("CPUMillis = %d", defaults.CPUMillis)
	}
	if defaults.MemoryLimitBytes != 1024*1024*1024 {
		t.Fatalf("MemoryLimitBytes = %d", defaults.MemoryLimitBytes)
	}
}

func TestLoadIgnoresRuntimeLimitEnvForDisabledLanguage(t *testing.T) {
	t.Setenv("SANDKASTEN_RUNTIME_LANGUAGES", "go")
	t.Setenv("SANDKASTEN_PYTHON_MAX_RUN_TIMEOUT_MS", "9000")

	cfg := Load()

	if _, ok := cfg.RuntimeSubmissionLimits["python"]; ok {
		t.Fatal("RuntimeSubmissionLimits[python] present for disabled runtime")
	}
}

func TestLoadIncludesExpectedRuntimesByDefault(t *testing.T) {
	t.Setenv("SANDKASTEN_RUNTIME_LANGUAGES", "")

	cfg := Load()

	want := map[string]bool{
		"assembly":    false,
		"bash":        false,
		"cangjie":     false,
		"clojure":     false,
		"coq":         false,
		"css":         false,
		"crystal":     false,
		"dart":        false,
		"elixir":      false,
		"erlang":      false,
		"fortran":     false,
		"fsharp":      false,
		"gdscript":    false,
		"gleam":       false,
		"graphviz":    false,
		"haskell":     false,
		"html":        false,
		"julia":       false,
		"kotlin":      false,
		"lean4":       false,
		"latex":       false,
		"lua":         false,
		"markdown":    false,
		"mdx":         false,
		"mojo":        false,
		"nextjs":      false,
		"nextflow":    false,
		"nim":         false,
		"octave":      false,
		"ocaml":       false,
		"pascal":      false,
		"perl":        false,
		"php":         false,
		"prolog":      false,
		"qml":         false,
		"r":           false,
		"racket":      false,
		"ruby":        false,
		"scala":       false,
		"scss":        false,
		"sql":         false,
		"swift":       false,
		"tailwindcss": false,
		"tsx":         false,
		"typst":       false,
		"vlang":       false,
		"vue3":        false,
		"wdl":         false,
		"zig":         false,
	}
	for _, runtime := range cfg.SupportedRuntimes {
		if _, ok := want[runtime.GetLanguage()]; ok {
			want[runtime.GetLanguage()] = true
		}
	}
	for language, found := range want {
		if !found {
			t.Fatalf("SupportedRuntimes = %v, want %s", cfg.SupportedRuntimes, language)
		}
	}
}

func TestCloneRuntimeCopiesManifestFields(t *testing.T) {
	source := &pb.Runtime{
		Language:          "python",
		Version:           "3.11",
		Image:             "sandkasten/python:3.11",
		Aliases:           []string{"py"},
		Status:            "active",
		DefaultEntrypoint: "main.py",
		CompilePhase:      &pb.RuntimePhase{Command: []string{"python3", "-m", "py_compile"}, Enabled: true},
		RunPhase:          &pb.RuntimePhase{Command: []string{"python3", "main.py"}, Enabled: true},
		DefaultLimits:     &pb.RuntimeLimits{RunTimeoutMs: 1000},
		MaxLimits:         &pb.RuntimeLimits{RunTimeoutMs: 2000, Args: 4},
	}

	got := cloneRuntime(source)
	source.Aliases[0] = "changed"
	source.CompilePhase.Command[0] = "changed"
	source.DefaultLimits.RunTimeoutMs = 9999

	if got.GetAliases()[0] != "py" {
		t.Fatalf("Aliases = %v", got.GetAliases())
	}
	if got.GetCompilePhase().GetCommand()[0] != "python3" {
		t.Fatalf("CompilePhase.Command = %v", got.GetCompilePhase().GetCommand())
	}
	if got.GetDefaultLimits().GetRunTimeoutMs() != 1000 {
		t.Fatalf("DefaultLimits.RunTimeoutMs = %d", got.GetDefaultLimits().GetRunTimeoutMs())
	}
	if got.GetMaxLimits().GetArgs() != 4 {
		t.Fatalf("MaxLimits.Args = %d", got.GetMaxLimits().GetArgs())
	}
}
