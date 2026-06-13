package jobs

import (
	"context"
	"strings"
	"testing"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
)

type fakeRepo struct {
	created CreateJob
	job     *pb.Job
}

func (f *fakeRepo) CreateJob(ctx context.Context, job CreateJob) (*pb.SubmitGoProjectResponse, error) {
	f.created = job
	return &pb.SubmitGoProjectResponse{JobId: "job-1", Status: pb.JobStatus_JOB_STATUS_QUEUED}, nil
}
func (f *fakeRepo) GetJob(ctx context.Context, jobID string) (*pb.Job, error) { return f.job, nil }
func (f *fakeRepo) CancelJob(ctx context.Context, jobID string) (*pb.CancelJobResponse, error) {
	return nil, nil
}
func (f *fakeRepo) ListRuntimes(ctx context.Context) ([]*pb.Runtime, error) { return nil, nil }
func (f *fakeRepo) StreamEvents(ctx context.Context, jobID string, afterSequence uint64) (<-chan *pb.JobEvent, <-chan error) {
	return nil, nil
}

func TestSubmitGoProjectAppliesDefaults(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo, &pb.Runtime{Language: "go", Version: "1.26"})

	resp, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz")})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}
	if resp.JobId != "job-1" {
		t.Fatalf("JobId = %q", resp.JobId)
	}
	if repo.created.Entrypoint != "." {
		t.Fatalf("Entrypoint = %q", repo.created.Entrypoint)
	}
	if repo.created.CompileTimeoutMS == 0 || repo.created.RunTimeoutMS == 0 || repo.created.MemoryLimitBytes == 0 || repo.created.CPUMillis == 0 || repo.created.MaxOutputBytes == 0 {
		t.Fatalf("expected resource defaults, got %+v", repo.created)
	}
	if repo.created.Stdin == nil {
		t.Fatal("Stdin = nil, want empty byte slice")
	}
	if repo.created.Args == nil {
		t.Fatal("Args = nil, want empty string slice")
	}
}

func TestSubmitProjectAppliesLanguageRuntimeAndEntrypoint(t *testing.T) {
	repo := &fakeRepo{}
	service := NewServiceWithRuntimes(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11"},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "py",
		ArchiveTargz: []byte("tgz"),
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}

	if repo.created.Runtime.GetLanguage() != "python" {
		t.Fatalf("Runtime.Language = %q", repo.created.Runtime.GetLanguage())
	}
	if repo.created.Entrypoint != "main.py" {
		t.Fatalf("Entrypoint = %q", repo.created.Entrypoint)
	}
	if repo.created.Runtime.GetDefaultEntrypoint() != "main.py" {
		t.Fatalf("Runtime.DefaultEntrypoint = %q", repo.created.Runtime.GetDefaultEntrypoint())
	}
	if repo.created.Runtime.GetStatus() != "active" {
		t.Fatalf("Runtime.Status = %q", repo.created.Runtime.GetStatus())
	}
	if !containsString(repo.created.Runtime.GetAliases(), "py") {
		t.Fatalf("Runtime.Aliases = %v, want py", repo.created.Runtime.GetAliases())
	}
	if !repo.created.Runtime.GetCompilePhase().GetEnabled() {
		t.Fatalf("Runtime.CompilePhase = %+v, want enabled", repo.created.Runtime.GetCompilePhase())
	}
}

func TestSubmitProjectAppliesRRuntimeManifest(t *testing.T) {
	repo := &fakeRepo{}
	service := NewServiceWithRuntimes(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "r", Version: "system"},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "rscript",
		ArchiveTargz: []byte("tgz"),
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}

	if repo.created.Runtime.GetLanguage() != "r" {
		t.Fatalf("Runtime.Language = %q", repo.created.Runtime.GetLanguage())
	}
	if repo.created.Entrypoint != "main.R" {
		t.Fatalf("Entrypoint = %q", repo.created.Entrypoint)
	}
	if !containsString(repo.created.Runtime.GetAliases(), "rscript") {
		t.Fatalf("Runtime.Aliases = %v, want rscript", repo.created.Runtime.GetAliases())
	}
	if got := repo.created.Runtime.GetRunPhase().GetCommand(); len(got) != 3 || got[0] != "Rscript" || got[1] != "--vanilla" || got[2] != "main.R" {
		t.Fatalf("Runtime.RunPhase.Command = %v", got)
	}
}

func TestNewLanguageRuntimeManifests(t *testing.T) {
	service := NewServiceWithRuntimes(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "bash", Version: "system"},
			{Language: "cangjie", Version: "system"},
			{Language: "clojure", Version: "system"},
			{Language: "css", Version: "system"},
			{Language: "coq", Version: "system"},
			{Language: "crystal", Version: "system"},
			{Language: "dart", Version: "system"},
			{Language: "elixir", Version: "system"},
			{Language: "erlang", Version: "system"},
			{Language: "fsharp", Version: "system"},
			{Language: "fortran", Version: "system"},
			{Language: "gdscript", Version: "system"},
			{Language: "gleam", Version: "system"},
			{Language: "graphviz", Version: "system"},
			{Language: "haskell", Version: "system"},
			{Language: "html", Version: "system"},
			{Language: "julia", Version: "system"},
			{Language: "kotlin", Version: "system"},
			{Language: "lean4", Version: "system"},
			{Language: "latex", Version: "system"},
			{Language: "lua", Version: "system"},
			{Language: "markdown", Version: "system"},
			{Language: "mdx", Version: "system"},
			{Language: "mojo", Version: "system"},
			{Language: "nextjs", Version: "system"},
			{Language: "nextflow", Version: "system"},
			{Language: "nim", Version: "system"},
			{Language: "octave", Version: "system"},
			{Language: "ocaml", Version: "system"},
			{Language: "pascal", Version: "system"},
			{Language: "assembly", Version: "system"},
			{Language: "perl", Version: "system"},
			{Language: "php", Version: "system"},
			{Language: "prolog", Version: "system"},
			{Language: "qml", Version: "system"},
			{Language: "racket", Version: "system"},
			{Language: "ruby", Version: "system"},
			{Language: "scala", Version: "system"},
			{Language: "scss", Version: "system"},
			{Language: "sql", Version: "system"},
			{Language: "swift", Version: "system"},
			{Language: "tailwindcss", Version: "system"},
			{Language: "tsx", Version: "system"},
			{Language: "typst", Version: "system"},
			{Language: "vlang", Version: "system"},
			{Language: "vue3", Version: "system"},
			{Language: "wdl", Version: "system"},
			{Language: "zig", Version: "system"},
		},
	)

	tests := []struct {
		language      string
		alias         string
		entrypoint    string
		compilePrefix []string
		runPrefix     []string
	}{
		{
			language:      "bash",
			alias:         "shell",
			entrypoint:    "main.sh",
			compilePrefix: []string{"bash", "-n"},
			runPrefix:     []string{"bash", "--noprofile", "--norc"},
		},
		{
			language:      "cangjie",
			alias:         "cj",
			entrypoint:    "main.cj",
			compilePrefix: []string{"cjc", "-O", "--jobs", "1"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "clojure",
			alias:         "clj",
			entrypoint:    "main.clj",
			compilePrefix: []string{"clojure", "-e"},
			runPrefix:     []string{"clojure", "main.clj"},
		},
		{
			language:      "css",
			alias:         "",
			entrypoint:    "main.css",
			compilePrefix: []string{"node", "-e"},
			runPrefix:     []string{"cat", "main.css"},
		},
		{
			language:      "coq",
			alias:         "coqc",
			entrypoint:    "main.v",
			compilePrefix: []string{"coqc", "-q"},
			runPrefix:     []string{"test", "-f"},
		},
		{
			language:      "crystal",
			alias:         "cr",
			entrypoint:    "main.cr",
			compilePrefix: []string{"crystal", "build", "--release", "--no-debug"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "dart",
			alias:         "",
			entrypoint:    "main.dart",
			compilePrefix: []string{"dart", "--disable-analytics", "compile", "exe"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "elixir",
			alias:         "exs",
			entrypoint:    "main.exs",
			compilePrefix: []string{"elixir", "--erl", "+S 1"},
			runPrefix:     []string{"elixir", "--erl", "+S 1"},
		},
		{
			language:      "erlang",
			alias:         "erl",
			entrypoint:    "main.erl",
			compilePrefix: []string{"erlc", "+debug_info"},
			runPrefix:     []string{"erl", "-noshell", "-pa"},
		},
		{
			language:      "fsharp",
			alias:         "f#",
			entrypoint:    "main.fs",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"dotnet", ".laeufer-bin/fsharp-project.dll"},
		},
		{
			language:      "fortran",
			alias:         "f90",
			entrypoint:    "main.f90",
			compilePrefix: []string{"gfortran", "-O2", "-pipe", "-o", ".laeufer-bin/main", "main.f90"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "gdscript",
			alias:         "godot",
			entrypoint:    "main.gd",
			compilePrefix: []string{"godot3-server", "--no-window", "--disable-crash-handler"},
			runPrefix:     []string{"bash", "--noprofile", "--norc", "-c"},
		},
		{
			language:      "gleam",
			alias:         "gleamlang",
			entrypoint:    "src/main.gleam",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"bash", "--noprofile", "--norc", "-c"},
		},
		{
			language:      "graphviz",
			alias:         "dot",
			entrypoint:    "main.dot",
			compilePrefix: []string{"dot", "-Tsvg", "-o", ".laeufer-bin/main.svg", "main.dot"},
			runPrefix:     []string{"cat", ".laeufer-bin/main.svg"},
		},
		{
			language:      "haskell",
			alias:         "hs",
			entrypoint:    "Main.hs",
			compilePrefix: []string{"ghc", "-O2", "-threaded"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "html",
			alias:         "htm",
			entrypoint:    "index.html",
			compilePrefix: []string{"node", "-e"},
			runPrefix:     []string{"cat", "index.html"},
		},
		{
			language:      "julia",
			alias:         "jl",
			entrypoint:    "main.jl",
			compilePrefix: []string{"julia", "--startup-file=no"},
			runPrefix:     []string{"julia", "--startup-file=no"},
		},
		{
			language:      "kotlin",
			alias:         "kt",
			entrypoint:    "Main.kt",
			compilePrefix: []string{"kotlinc", "-J-XX:ActiveProcessorCount=1"},
			runPrefix:     []string{"java", "-XX:ActiveProcessorCount=1"},
		},
		{
			language:      "lean4",
			alias:         "lean",
			entrypoint:    "Main.lean",
			compilePrefix: []string{"lean", "-o"},
			runPrefix:     []string{"lean", "--run"},
		},
		{
			language:      "latex",
			alias:         "tex",
			entrypoint:    "main.tex",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"printf", "latex compiled\n"},
		},
		{
			language:      "lua",
			alias:         "lua5.4",
			entrypoint:    "main.lua",
			compilePrefix: []string{"luac", "-p"},
			runPrefix:     []string{"lua", "main.lua"},
		},
		{
			language:      "markdown",
			alias:         "md",
			entrypoint:    "main.md",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"cat", ".laeufer-bin/main.html"},
		},
		{
			language:      "mdx",
			alias:         "",
			entrypoint:    "main.mdx",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"cat", ".laeufer-bin/main.html"},
		},
		{
			language:      "mojo",
			alias:         "mojolang",
			entrypoint:    "main.mojo",
			compilePrefix: []string{"mojo", "build"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "nextjs",
			alias:         "next",
			entrypoint:    "app/page.tsx",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"node", ".laeufer-bin/next.cjs"},
		},
		{
			language:      "ruby",
			alias:         "rb",
			entrypoint:    "main.rb",
			compilePrefix: []string{"ruby", "-c"},
			runPrefix:     []string{"ruby", "--disable=gems"},
		},
		{
			language:      "nim",
			alias:         "nimrod",
			entrypoint:    "main.nim",
			compilePrefix: []string{"nim", "c", "--hints:off"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "octave",
			alias:         "gnu-octave",
			entrypoint:    "main.m",
			compilePrefix: []string{"octave-cli", "--no-gui", "--no-history", "--norc", "--silent"},
			runPrefix:     []string{"octave-cli", "--no-gui", "--no-history", "--norc", "--silent"},
		},
		{
			language:      "ocaml",
			alias:         "ml",
			entrypoint:    "main.ml",
			compilePrefix: []string{"ocamlopt", "-o", ".laeufer-bin/main", "main.ml"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "pascal",
			alias:         "fpc",
			entrypoint:    "main.pas",
			compilePrefix: []string{"fpc", "-O2", "-FE.laeufer-bin", "-omain", "main.pas"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "assembly",
			alias:         "asm",
			entrypoint:    "main.s",
			compilePrefix: []string{"gcc", "-x", "assembler", "-no-pie", "-Wl,-z,noexecstack", "-o", ".laeufer-bin/main", "main.s"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "nextflow",
			alias:         "nf",
			entrypoint:    "main.nf",
			compilePrefix: []string{"nextflow", "lint"},
			runPrefix:     []string{"bash", "--noprofile", "--norc", "-c"},
		},
		{
			language:      "perl",
			alias:         "perl5",
			entrypoint:    "main.pl",
			compilePrefix: []string{"perl", "-c"},
			runPrefix:     []string{"perl", "main.pl"},
		},
		{
			language:      "php",
			alias:         "php8.2",
			entrypoint:    "main.php",
			compilePrefix: []string{"php", "-d", "variables_order=EGPCS"},
			runPrefix:     []string{"php", "-d", "variables_order=EGPCS"},
		},
		{
			language:      "prolog",
			alias:         "swipl",
			entrypoint:    "main.pl",
			compilePrefix: []string{"swipl", "--no-packs", "-q"},
			runPrefix:     []string{"swipl", "--no-packs", "-q"},
		},
		{
			language:      "qml",
			alias:         "qtqml",
			entrypoint:    "main.qml",
			compilePrefix: []string{"/usr/lib/qt6/bin/qmllint", "--ignore-settings"},
			runPrefix:     []string{"bash", "--noprofile", "--norc", "-c"},
		},
		{
			language:      "racket",
			alias:         "rkt",
			entrypoint:    "main.rkt",
			compilePrefix: []string{"raco", "make"},
			runPrefix:     []string{"racket", "-t"},
		},
		{
			language:      "scala",
			alias:         "sc",
			entrypoint:    "Main.scala",
			compilePrefix: []string{"scalac", "-J-XX:ActiveProcessorCount=1"},
			runPrefix:     []string{"scala", "-J-XX:ActiveProcessorCount=1"},
		},
		{
			language:      "scss",
			alias:         "sass",
			entrypoint:    "main.scss",
			compilePrefix: []string{"sass", "--no-source-map"},
			runPrefix:     []string{"cat", ".laeufer-bin/main.css"},
		},
		{
			language:      "sql",
			alias:         "sqlite3",
			entrypoint:    "main.sql",
			compilePrefix: []string{"bash", "--noprofile", "--norc"},
			runPrefix:     []string{"bash", "--noprofile", "--norc"},
		},
		{
			language:      "swift",
			alias:         "",
			entrypoint:    "main.swift",
			compilePrefix: []string{"swiftc", "-O"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "tailwindcss",
			alias:         "tailwind",
			entrypoint:    "main.css",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"cat", ".laeufer-bin/main.css"},
		},
		{
			language:      "tsx",
			alias:         "react",
			entrypoint:    "main.tsx",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"node", ".laeufer-bin/main.cjs"},
		},
		{
			language:      "typst",
			alias:         "typ",
			entrypoint:    "main.typ",
			compilePrefix: []string{"typst", "compile", "--root", ".", "main.typ", ".laeufer-bin/main.svg"},
			runPrefix:     []string{"cat", ".laeufer-bin/main.svg"},
		},
		{
			language:      "vlang",
			alias:         "v",
			entrypoint:    "main.vv",
			compilePrefix: []string{"v", "-prod", "-o", ".laeufer-bin/main", "main.vv"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "vue3",
			alias:         "vue",
			entrypoint:    "main.vue",
			compilePrefix: []string{"bash", "--noprofile", "--norc", "-c"},
			runPrefix:     []string{"node", ".laeufer-bin/vue.cjs"},
		},
		{
			language:      "zig",
			alias:         "",
			entrypoint:    "main.zig",
			compilePrefix: []string{"zig", "build-exe"},
			runPrefix:     []string{".laeufer-bin/main"},
		},
		{
			language:      "wdl",
			alias:         "workflow-description-language",
			entrypoint:    "main.wdl",
			compilePrefix: []string{"miniwdl", "check", "--no-outside-imports"},
			runPrefix:     []string{"bash", "--noprofile", "--norc", "-c"},
		},
	}

	resp, err := service.ListRuntimes(context.Background(), &pb.ListRuntimesRequest{})
	if err != nil {
		t.Fatalf("ListRuntimes() error = %v", err)
	}
	for _, tt := range tests {
		t.Run(tt.language, func(t *testing.T) {
			runtime := findRuntime(resp, tt.language)
			if runtime == nil {
				t.Fatalf("runtime %q missing from %+v", tt.language, resp.GetRuntimes())
			}
			if runtime.GetDefaultEntrypoint() != tt.entrypoint {
				t.Fatalf("DefaultEntrypoint = %q", runtime.GetDefaultEntrypoint())
			}
			if tt.alias != "" && !containsString(runtime.GetAliases(), tt.alias) {
				t.Fatalf("Aliases = %v, want %s", runtime.GetAliases(), tt.alias)
			}
			if tt.language == "assembly" && containsString(runtime.GetAliases(), "nasm") {
				t.Fatalf("Aliases = %v, nasm syntax is not supported by the GAS planner", runtime.GetAliases())
			}
			if !hasPrefix(runtime.GetCompilePhase().GetCommand(), tt.compilePrefix) {
				t.Fatalf("CompilePhase.Command = %v", runtime.GetCompilePhase().GetCommand())
			}
			if !hasPrefix(runtime.GetRunPhase().GetCommand(), tt.runPrefix) {
				t.Fatalf("RunPhase.Command = %v", runtime.GetRunPhase().GetCommand())
			}
			if tt.language == "markdown" {
				if !commandContains(runtime.GetCompilePhase().GetCommand(), "mermaid.initialize") || !commandContains(runtime.GetCompilePhase().GetCommand(), "securityLevel: 'strict'") {
					t.Fatalf("CompilePhase.Command = %v, want strict Mermaid rendering", runtime.GetCompilePhase().GetCommand())
				}
				if !commandContains(runtime.GetCompilePhase().GetCommand(), "sandkasten-mermaid-' + diagram.id") {
					t.Fatalf("CompilePhase.Command = %v, want stable Mermaid ids independent from placeholders", runtime.GetCompilePhase().GetCommand())
				}
				if !commandContains(runtime.GetCompilePhase().GetCommand(), "JSDOM") || !commandContains(runtime.GetCompilePhase().GetCommand(), "DOMPurify") {
					t.Fatalf("CompilePhase.Command = %v, want in-process Mermaid DOM renderer", runtime.GetCompilePhase().GetCommand())
				}
			}
			if tt.language == "mdx" {
				if !commandContains(runtime.GetCompilePhase().GetCommand(), "createRequire") || !commandContains(runtime.GetCompilePhase().GetCommand(), "pathToFileURL") || !commandContains(runtime.GetCompilePhase().GetCommand(), "requireFromNodePath('react/jsx-runtime')") {
					t.Fatalf("CompilePhase.Command = %v, want MDX resolved from NODE_PATH before dynamic import", runtime.GetCompilePhase().GetCommand())
				}
			}
			if tt.language == "octave" && commandContains(runtime.GetCompilePhase().GetCommand(), "parse(") {
				t.Fatalf("CompilePhase.Command = %v, Octave parse() is unavailable", runtime.GetCompilePhase().GetCommand())
			}
			if tt.language == "latex" && !commandContains(runtime.GetCompilePhase().GetCommand(), "--only-cached") {
				t.Fatalf("CompilePhase.Command = %v, want Tectonic only-cached mode", runtime.GetCompilePhase().GetCommand())
			}
			if tt.language == "gleam" {
				if !commandContains(runtime.GetCompilePhase().GetCommand(), "gleam_stdlib") {
					t.Fatalf("CompilePhase.Command = %v, want pinned Gleam stdlib", runtime.GetCompilePhase().GetCommand())
				}
				if !commandContains(runtime.GetCompilePhase().GetCommand(), "cd \"$project\"") || commandContains(runtime.GetCompilePhase().GetCommand(), "--root \"$project\"") {
					t.Fatalf("CompilePhase.Command = %v, want Gleam build from project directory without --root", runtime.GetCompilePhase().GetCommand())
				}
				if !commandContains(runtime.GetRunPhase().GetCommand(), "ebin_args") || !commandContains(runtime.GetRunPhase().GetCommand(), "exec erl -noshell") {
					t.Fatalf("RunPhase.Command = %v, want expanded Gleam ebin paths", runtime.GetRunPhase().GetCommand())
				}
			}
		})
	}
}

func TestListRuntimesIncludesManifest(t *testing.T) {
	service := NewServiceWithOptions(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11", Image: "sandkasten/python:3.11"},
		},
		ServiceOptions{
			Limits: SubmissionLimits{
				MaxArchiveBytes:     64,
				MaxStdinBytes:       32,
				MaxArgs:             4,
				MaxArgBytes:         16,
				MaxCompileTimeoutMS: 2000,
				MaxRunTimeoutMS:     3000,
				MaxMemoryLimitBytes: 1024,
				MaxCPUMillis:        500,
				MaxOutputBytes:      256,
			},
			DefaultResources: ResourceDefaults{
				CompileTimeoutMS: 1000,
				RunTimeoutMS:     1500,
				MemoryLimitBytes: 512,
				CPUMillis:        250,
				MaxOutputBytes:   128,
			},
			RuntimeLimits: map[string]SubmissionLimits{
				"py": {MaxRunTimeoutMS: 2200, MaxArgs: 2},
			},
			RuntimeResourceDefaults: map[string]ResourceDefaults{
				"python": {RunTimeoutMS: 1200},
			},
		},
	)

	resp, err := service.ListRuntimes(context.Background(), &pb.ListRuntimesRequest{})
	if err != nil {
		t.Fatalf("ListRuntimes() error = %v", err)
	}
	runtime := findRuntime(resp, "python")
	if runtime == nil {
		t.Fatalf("ListRuntimes() = %+v, want python runtime", resp.Runtimes)
	}
	if runtime.GetVersion() != "3.11" || runtime.GetImage() != "sandkasten/python:3.11" {
		t.Fatalf("Runtime version/image = %q/%q", runtime.GetVersion(), runtime.GetImage())
	}
	if runtime.GetStatus() != "active" {
		t.Fatalf("Runtime.Status = %q", runtime.GetStatus())
	}
	if runtime.GetDefaultEntrypoint() != "main.py" {
		t.Fatalf("Runtime.DefaultEntrypoint = %q", runtime.GetDefaultEntrypoint())
	}
	if !containsString(runtime.GetAliases(), "python3") {
		t.Fatalf("Runtime.Aliases = %v, want python3", runtime.GetAliases())
	}
	if got := runtime.GetCompilePhase().GetCommand(); len(got) < 3 || got[0] != "python3" || got[1] != "-c" || got[len(got)-1] != "main.py" {
		t.Fatalf("Runtime.CompilePhase.Command = %v", got)
	}
	if got := runtime.GetRunPhase().GetCommand(); len(got) != 3 || got[0] != "python3" || got[1] != "-B" || got[2] != "main.py" {
		t.Fatalf("Runtime.RunPhase.Command = %v", got)
	}
	if runtime.GetDefaultLimits().GetCompileTimeoutMs() != 1000 {
		t.Fatalf("DefaultLimits.CompileTimeoutMs = %d", runtime.GetDefaultLimits().GetCompileTimeoutMs())
	}
	if runtime.GetDefaultLimits().GetRunTimeoutMs() != 1200 {
		t.Fatalf("DefaultLimits.RunTimeoutMs = %d", runtime.GetDefaultLimits().GetRunTimeoutMs())
	}
	if runtime.GetMaxLimits().GetRunTimeoutMs() != 2200 {
		t.Fatalf("MaxLimits.RunTimeoutMs = %d", runtime.GetMaxLimits().GetRunTimeoutMs())
	}
	if runtime.GetMaxLimits().GetArgs() != 2 {
		t.Fatalf("MaxLimits.Args = %d", runtime.GetMaxLimits().GetArgs())
	}
	if runtime.GetMaxLimits().GetArchiveBytes() != 64 {
		t.Fatalf("MaxLimits.ArchiveBytes = %d", runtime.GetMaxLimits().GetArchiveBytes())
	}
}

func TestGetJobEnrichesRuntimeManifest(t *testing.T) {
	repo := &fakeRepo{
		job: &pb.Job{
			JobId:    "job-1",
			Language: "python",
			Runtime:  &pb.Runtime{Language: "python", Version: "3.12"},
		},
	}
	service := NewServiceWithRuntimes(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11", Image: "sandkasten/python:3.11"},
		},
	)

	job, err := service.GetJob(context.Background(), &pb.GetJobRequest{JobId: "job-1"})
	if err != nil {
		t.Fatalf("GetJob() error = %v", err)
	}
	if job.GetRuntime().GetVersion() != "3.12" {
		t.Fatalf("Runtime.Version = %q", job.GetRuntime().GetVersion())
	}
	if job.GetRuntime().GetImage() != "sandkasten/python:3.11" {
		t.Fatalf("Runtime.Image = %q", job.GetRuntime().GetImage())
	}
	if job.GetRuntime().GetDefaultEntrypoint() != "main.py" {
		t.Fatalf("Runtime.DefaultEntrypoint = %q", job.GetRuntime().GetDefaultEntrypoint())
	}
	if !containsString(job.GetRuntime().GetAliases(), "py") {
		t.Fatalf("Runtime.Aliases = %v, want py", job.GetRuntime().GetAliases())
	}
}

func TestSubmitProjectAppliesRuntimeResourceDefaults(t *testing.T) {
	repo := &fakeRepo{}
	service := NewServiceWithOptions(
		repo,
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11"},
		},
		ServiceOptions{
			DefaultResources: ResourceDefaults{
				CompileTimeoutMS: 2000,
				RunTimeoutMS:     1000,
				MemoryLimitBytes: 64 * 1024 * 1024,
				CPUMillis:        250,
				MaxOutputBytes:   128 * 1024,
			},
			RuntimeResourceDefaults: map[string]ResourceDefaults{
				"py": {
					RunTimeoutMS:     7000,
					MemoryLimitBytes: 128 * 1024 * 1024,
				},
			},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "python",
		ArchiveTargz: []byte("tgz"),
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() error = %v", err)
	}
	if repo.created.CompileTimeoutMS != 2000 {
		t.Fatalf("CompileTimeoutMS = %d", repo.created.CompileTimeoutMS)
	}
	if repo.created.RunTimeoutMS != 7000 {
		t.Fatalf("RunTimeoutMS = %d", repo.created.RunTimeoutMS)
	}
	if repo.created.MemoryLimitBytes != 128*1024*1024 {
		t.Fatalf("MemoryLimitBytes = %d", repo.created.MemoryLimitBytes)
	}
	if repo.created.CPUMillis != 250 {
		t.Fatalf("CPUMillis = %d", repo.created.CPUMillis)
	}
	if repo.created.MaxOutputBytes != 128*1024 {
		t.Fatalf("MaxOutputBytes = %d", repo.created.MaxOutputBytes)
	}
}

func TestSubmitProjectAppliesRuntimeLimitOverrides(t *testing.T) {
	service := NewServiceWithOptions(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{
			{Language: "go", Version: "1.26"},
			{Language: "python", Version: "3.11"},
		},
		ServiceOptions{
			Limits: SubmissionLimits{MaxRunTimeoutMS: 10000},
			RuntimeLimits: map[string]SubmissionLimits{
				"py": {MaxRunTimeoutMS: 1000},
			},
		},
	)

	_, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "python",
		ArchiveTargz: []byte("tgz"),
		RunTimeoutMs: 1500,
	})
	if err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
	if !strings.Contains(err.Error(), "run_timeout_ms") {
		t.Fatalf("SubmitGoProject() error = %q, want run_timeout_ms", err.Error())
	}

	_, err = service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "go",
		ArchiveTargz: []byte("tgz"),
		RunTimeoutMs: 1500,
	})
	if err != nil {
		t.Fatalf("SubmitGoProject() go error = %v", err)
	}
}

func TestSubmitProjectRejectsUnsupportedLanguage(t *testing.T) {
	service := NewServiceWithRuntimes(
		&fakeRepo{},
		&pb.Runtime{Language: "go", Version: "1.26"},
		[]*pb.Runtime{{Language: "go", Version: "1.26"}},
	)

	if _, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{
		Language:     "ruby",
		ArchiveTargz: []byte("tgz"),
	}); err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
}

func TestSubmitGoProjectRequiresArchive(t *testing.T) {
	service := NewService(&fakeRepo{}, &pb.Runtime{Language: "go", Version: "1.26"})
	if _, err := service.SubmitGoProject(context.Background(), &pb.SubmitGoProjectRequest{}); err == nil {
		t.Fatal("SubmitGoProject() error = nil")
	}
}

func TestSubmitProjectRejectsResourceLimitsAboveServiceCaps(t *testing.T) {
	tests := []struct {
		name     string
		req      *pb.SubmitGoProjectRequest
		limits   SubmissionLimits
		wantText string
	}{
		{
			name:     "archive",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("too-large")},
			limits:   SubmissionLimits{MaxArchiveBytes: 4},
			wantText: "archive_targz",
		},
		{
			name:     "stdin",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), Stdin: []byte("too-large")},
			limits:   SubmissionLimits{MaxStdinBytes: 4},
			wantText: "stdin",
		},
		{
			name:     "args count",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), Args: []string{"a", "b"}},
			limits:   SubmissionLimits{MaxArgs: 1},
			wantText: "args exceeds",
		},
		{
			name:     "args bytes",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), Args: []string{"toolarge"}},
			limits:   SubmissionLimits{MaxArgBytes: 4},
			wantText: "args exceed",
		},
		{
			name:     "compile timeout",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), CompileTimeoutMs: 121000},
			limits:   SubmissionLimits{MaxCompileTimeoutMS: 120000},
			wantText: "compile_timeout_ms",
		},
		{
			name:     "run timeout",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), RunTimeoutMs: 31000},
			limits:   SubmissionLimits{MaxRunTimeoutMS: 30000},
			wantText: "run_timeout_ms",
		},
		{
			name:     "memory",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), MemoryLimitBytes: 1025},
			limits:   SubmissionLimits{MaxMemoryLimitBytes: 1024},
			wantText: "memory_limit_bytes",
		},
		{
			name:     "cpu",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), CpuMillis: 501},
			limits:   SubmissionLimits{MaxCPUMillis: 500},
			wantText: "cpu_millis",
		},
		{
			name:     "output",
			req:      &pb.SubmitGoProjectRequest{ArchiveTargz: []byte("tgz"), MaxOutputBytes: 129},
			limits:   SubmissionLimits{MaxOutputBytes: 128},
			wantText: "max_output_bytes",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := NewServiceWithOptions(
				&fakeRepo{},
				&pb.Runtime{Language: "go", Version: "1.26"},
				[]*pb.Runtime{{Language: "go", Version: "1.26"}},
				ServiceOptions{Limits: tt.limits},
			)
			_, err := service.SubmitGoProject(context.Background(), tt.req)
			if err == nil {
				t.Fatal("SubmitGoProject() error = nil")
			}
			if !strings.Contains(err.Error(), tt.wantText) {
				t.Fatalf("SubmitGoProject() error = %q, want %q", err.Error(), tt.wantText)
			}
		})
	}
}

func findRuntime(resp *pb.ListRuntimesResponse, language string) *pb.Runtime {
	for _, runtime := range resp.GetRuntimes() {
		if runtime.GetLanguage() == language {
			return runtime
		}
	}
	return nil
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func commandContains(values []string, want string) bool {
	for _, value := range values {
		if strings.Contains(value, want) {
			return true
		}
	}
	return false
}

func hasPrefix(values []string, prefix []string) bool {
	if len(values) < len(prefix) {
		return false
	}
	for i, value := range prefix {
		if values[i] != value {
			return false
		}
	}
	return true
}
