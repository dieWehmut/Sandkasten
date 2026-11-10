package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/httpapi"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Opt in with a development Postgres URL. Tables and types are created in a
// unique test schema; this test never drops or truncates existing application
// tables and never relies on the runner being active.
func TestRepositoryOutputReadinessWithPostgres(t *testing.T) {
	url := os.Getenv("SANDKASTEN_POSTGRES_TEST_URL")
	if url == "" {
		t.Skip("set SANDKASTEN_POSTGRES_TEST_URL to run the real Postgres output-readiness test")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Keep the search_path on one session throughout repository operations.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	schema := fmt.Sprintf("output_readiness_%d", time.Now().UnixNano())
	if _, err := db.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := db.ExecContext(context.Background(), `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Errorf("remove isolated test schema: %v", err)
		}
	}()
	if _, err := db.ExecContext(ctx, `SET search_path TO `+schema+`, public`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "speicher", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	runtime := &pb.Runtime{Language: "python", Version: "system"}
	repo := NewRepository(db, time.Millisecond, runtime)
	handler := httpapi.New(jobs.NewService(repo, runtime), "", nil).Handler()
	insert := func(status string, started bool) string {
		t.Helper()
		var id string
		err := db.QueryRowContext(ctx, `
			INSERT INTO jobs (status, language, runtime_version, archive_targz,
				compile_timeout_ms, run_timeout_ms, memory_limit_bytes, cpu_millis,
				max_output_bytes, started_at)
			VALUES ($1::job_status, 'python', 'system', '\x01'::bytea,
				1000, 1000, 1048576, 1000, 4096, CASE WHEN $2 THEN now() ELSE NULL END)
			RETURNING job_id::text`, status, started).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	read := func(id string, ready bool, stdout string) {
		t.Helper()
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/jobs/"+id, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GetJob status = %d, body = %s", rec.Code, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["outputReady"] != ready || body["stdout"] != stdout {
			t.Fatalf("GetJob outputReady = %v, stdout = %q; want %t, %q", body["outputReady"], body["stdout"], ready, stdout)
		}
	}
	queued := insert("QUEUED", false)
	read(queued, false, "")
	if _, err := repo.CancelJob(ctx, queued); err != nil {
		t.Fatal(err)
	}
	read(queued, true, "")

	running := insert("RUNNING", true)
	read(running, false, "")
	if _, err := repo.CancelJob(ctx, running); err != nil {
		t.Fatal(err)
	}
	// A terminal cancellation can be observed repeatedly before any artifact.
	read(running, false, "")
	read(running, false, "")
	if _, err := db.ExecContext(ctx, `INSERT INTO job_artifacts (job_id, stdout) VALUES ($1::uuid, $2)`, running, []byte("before stop\n")); err != nil {
		t.Fatal(err)
	}
	read(running, true, "before stop\n")

	empty := insert("CANCELED", true)
	read(empty, false, "")
	if _, err := db.ExecContext(ctx, `INSERT INTO job_artifacts (job_id) VALUES ($1::uuid)`, empty); err != nil {
		t.Fatal(err)
	}
	read(empty, true, "") // An existing empty artifact is complete output.
	read(insert("SYSTEM_ERROR", true), true, "")
}
