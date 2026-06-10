package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	pb "github.com/dieWehmut/sandkasten/schnittstelle/gen/sandkasten/v1"
	"github.com/dieWehmut/sandkasten/schnittstelle/internal/jobs"
)

const (
	jobEventsChannel = "sandkasten_job_events"
	jobQueueChannel  = "sandkasten_job_queue"
)

type Repository struct {
	db                *sql.DB
	eventPollInterval time.Duration
	defaultRuntime    *pb.Runtime
	maxQueuedJobs     int
	maxActiveJobs     int
}

func NewRepository(db *sql.DB, eventPollInterval time.Duration, defaultRuntime *pb.Runtime) *Repository {
	return NewRepositoryWithOptions(db, eventPollInterval, defaultRuntime, RepositoryOptions{})
}

type RepositoryOptions struct {
	MaxQueuedJobs int
	MaxActiveJobs int
}

func NewRepositoryWithOptions(db *sql.DB, eventPollInterval time.Duration, defaultRuntime *pb.Runtime, options RepositoryOptions) *Repository {
	return &Repository{
		db:                db,
		eventPollInterval: eventPollInterval,
		defaultRuntime:    defaultRuntime,
		maxQueuedJobs:     nonnegative(options.MaxQueuedJobs),
		maxActiveJobs:     nonnegative(options.MaxActiveJobs),
	}
}

func (r *Repository) CreateJob(ctx context.Context, job jobs.CreateJob) (*pb.SubmitGoProjectResponse, error) {
	args, err := json.Marshal(job.Args)
	if err != nil {
		return nil, err
	}
	runtime := job.Runtime
	if runtime == nil {
		runtime = r.defaultRuntime
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := r.checkBackpressure(ctx, tx); err != nil {
		return nil, err
	}

	var jobID string
	var statusText string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO jobs (
			language,
			runtime_version,
			entrypoint,
			args,
			stdin,
			archive_targz,
			compile_timeout_ms,
			run_timeout_ms,
			memory_limit_bytes,
			cpu_millis,
			max_output_bytes
		)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
		RETURNING job_id::text, status::text
	`,
		runtimeLanguage(runtime),
		runtimeVersion(runtime),
		job.Entrypoint,
		string(args),
		job.Stdin,
		job.ArchiveTargz,
		int64(job.CompileTimeoutMS),
		int64(job.RunTimeoutMS),
		uint64ToInt64(job.MemoryLimitBytes),
		int64(job.CPUMillis),
		uint64ToInt64(job.MaxOutputBytes),
	).Scan(&jobID, &statusText)
	if err != nil {
		return nil, err
	}

	statusValue := statusFromDB(statusText)
	if err := r.insertEventTx(ctx, tx, jobID, statusText, "job queued"); err != nil {
		return nil, err
	}
	if err := notifyTx(ctx, tx, jobQueueChannel, jobID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &pb.SubmitGoProjectResponse{JobId: jobID, Status: statusValue}, nil
}

func (r *Repository) checkBackpressure(ctx context.Context, tx *sql.Tx) error {
	if r.maxQueuedJobs == 0 && r.maxActiveJobs == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `LOCK TABLE jobs IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	if r.maxQueuedJobs > 0 {
		var queued int
		if err := tx.QueryRowContext(ctx, `
			SELECT count(*)
			FROM jobs
			WHERE status = 'QUEUED'::job_status
		`).Scan(&queued); err != nil {
			return err
		}
		if queued >= r.maxQueuedJobs {
			return fmt.Errorf("%w: queued job limit reached", jobs.ErrResourceExhausted)
		}
	}
	if r.maxActiveJobs > 0 {
		var active int
		if err := tx.QueryRowContext(ctx, `
			SELECT count(*)
			FROM jobs
			WHERE status IN (
				'QUEUED'::job_status,
				'VALIDATING'::job_status,
				'COMPILING'::job_status,
				'RUNNING'::job_status
			)
		`).Scan(&active); err != nil {
			return err
		}
		if active >= r.maxActiveJobs {
			return fmt.Errorf("%w: active job limit reached", jobs.ErrResourceExhausted)
		}
	}
	return nil
}

func (r *Repository) GetJob(ctx context.Context, jobID string) (*pb.Job, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			j.job_id::text,
			j.status::text,
			j.language,
			j.runtime_version,
			j.entrypoint,
			j.args::text,
			j.compile_timeout_ms,
			j.run_timeout_ms,
			j.memory_limit_bytes,
			j.cpu_millis,
			j.max_output_bytes,
			j.error_message,
			COALESCE(to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
			COALESCE(to_char(j.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
			COALESCE(to_char(j.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
			COALESCE(a.stdout, ''::bytea),
			COALESCE(a.stderr, ''::bytea),
			COALESCE(a.compile_stdout, ''::bytea),
			COALESCE(a.compile_stderr, ''::bytea),
			a.exit_code,
			a.signal,
			COALESCE(a.wall_time_ms, 0),
			COALESCE(a.memory_peak_bytes, 0),
			COALESCE(a.stdout_truncated, false),
			COALESCE(a.stderr_truncated, false),
			COALESCE(a.cpu_usage_usec, 0),
			COALESCE(a.cpu_throttled_usec, 0),
			COALESCE(a.pids_peak, 0),
			COALESCE(a.memory_oom_kill_count, 0)
		FROM jobs j
		LEFT JOIN job_artifacts a ON a.job_id = j.job_id
		WHERE j.job_id = $1::uuid
	`, jobID)

	job, err := scanJob(row, r.defaultRuntime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, jobs.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return job, nil
}

func (r *Repository) CancelJob(ctx context.Context, jobID string) (*pb.CancelJobResponse, error) {
	var statusText string
	err := r.db.QueryRowContext(ctx, `
		UPDATE jobs
		SET status = 'CANCELED'::job_status,
			error_message = CASE WHEN error_message = '' THEN 'canceled by client' ELSE error_message END,
			finished_at = COALESCE(finished_at, now()),
			lease_expires_at = NULL
		WHERE job_id = $1::uuid
			AND status NOT IN (
				'SUCCEEDED'::job_status,
				'COMPILE_FAILED'::job_status,
				'RUNTIME_FAILED'::job_status,
				'TIME_LIMIT_EXCEEDED'::job_status,
				'MEMORY_LIMIT_EXCEEDED'::job_status,
				'OUTPUT_LIMIT_EXCEEDED'::job_status,
				'CANCELED'::job_status,
				'SYSTEM_ERROR'::job_status
			)
		RETURNING status::text
	`, jobID).Scan(&statusText)
	if errors.Is(err, sql.ErrNoRows) {
		existing, getErr := r.GetJob(ctx, jobID)
		if errors.Is(getErr, jobs.ErrNotFound) {
			return nil, jobs.ErrNotFound
		}
		if getErr != nil {
			return nil, getErr
		}
		if existing != nil {
			return &pb.CancelJobResponse{JobId: jobID, Status: existing.Status}, nil
		}
		return &pb.CancelJobResponse{JobId: jobID, Status: pb.JobStatus_JOB_STATUS_CANCELED}, nil
	}
	if err != nil {
		return nil, err
	}
	if err := r.insertEvent(ctx, jobID, statusText, "job canceled by client"); err != nil {
		return nil, err
	}
	return &pb.CancelJobResponse{JobId: jobID, Status: statusFromDB(statusText)}, nil
}

func (r *Repository) ListRuntimes(ctx context.Context) ([]*pb.Runtime, error) {
	return []*pb.Runtime{cloneRuntime(r.defaultRuntime)}, nil
}

func (r *Repository) StreamEvents(ctx context.Context, jobID string, afterSequence uint64) (<-chan *pb.JobEvent, <-chan error) {
	events := make(chan *pb.JobEvent)
	errs := make(chan error, 1)

	go func() {
		defer close(events)
		defer close(errs)

		sequence := afterSequence
		ticker := time.NewTicker(r.eventPollInterval)
		defer ticker.Stop()
		notifications, stopNotifications := r.listenJobEvents(ctx, jobID)
		defer stopNotifications()

		for {
			found, err := r.emitEvents(ctx, jobID, sequence, events)
			if err != nil {
				errs <- err
				return
			}
			if found > sequence {
				sequence = found
			}

			select {
			case <-ctx.Done():
				return
			case _, ok := <-notifications:
				if !ok {
					notifications = nil
				}
			case <-ticker.C:
			}
		}
	}()

	return events, errs
}

func (r *Repository) emitEvents(ctx context.Context, jobID string, afterSequence uint64, events chan<- *pb.JobEvent) (uint64, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT job_id::text, sequence, status::text, message, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM job_events
		WHERE job_id = $1::uuid AND sequence > $2
		ORDER BY sequence
	`, jobID, int64(afterSequence))
	if err != nil {
		return afterSequence, err
	}
	defer rows.Close()

	latest := afterSequence
	for rows.Next() {
		event := &pb.JobEvent{}
		var sequence int64
		var statusText string
		if err := rows.Scan(&event.JobId, &sequence, &statusText, &event.Message, &event.CreatedAt); err != nil {
			return latest, err
		}
		event.Sequence = uint64(sequence)
		event.Status = statusFromDB(statusText)
		latest = event.Sequence
		select {
		case <-ctx.Done():
			return latest, nil
		case events <- event:
		}
	}
	return latest, rows.Err()
}

func (r *Repository) insertEvent(ctx context.Context, jobID, statusText, message string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := r.insertEventTx(ctx, tx, jobID, statusText, message); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) insertEventTx(ctx context.Context, tx *sql.Tx, jobID, statusText, message string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO job_events (job_id, status, message)
		VALUES ($1::uuid, $2::job_status, $3)
	`, jobID, statusText, message)
	if err != nil {
		return err
	}
	return notifyTx(ctx, tx, jobEventsChannel, jobID)
}

func notifyTx(ctx context.Context, tx *sql.Tx, channel, payload string) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_notify($1, $2)`, channel, payload)
	return err
}

func (r *Repository) listenJobEvents(ctx context.Context, jobID string) (<-chan struct{}, func()) {
	notifications := make(chan struct{}, 1)
	listenCtx, stop := context.WithCancel(ctx)
	go func() {
		defer close(notifications)
		conn, err := r.db.Conn(listenCtx)
		if err != nil {
			return
		}
		defer conn.Close()

		err = conn.Raw(func(driverConn any) error {
			pgxConn, ok := driverConn.(*stdlib.Conn)
			if !ok {
				return nil
			}
			return listenPgxNotifications(listenCtx, pgxConn.Conn(), jobID, notifications)
		})
		if err != nil {
			return
		}
	}()
	return notifications, stop
}

func listenPgxNotifications(ctx context.Context, conn *pgx.Conn, jobID string, notifications chan<- struct{}) error {
	if _, err := conn.Exec(ctx, `LISTEN `+pgx.Identifier{jobEventsChannel}.Sanitize()); err != nil {
		return err
	}
	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if notification.Payload != jobID {
			continue
		}
		select {
		case notifications <- struct{}{}:
		default:
		}
	}
}

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanJob(row scanner, runtime *pb.Runtime) (*pb.Job, error) {
	var job pb.Job
	var statusText string
	var argsJSON string
	var runtimeVersion string
	var memoryLimit int64
	var maxOutput int64
	var exitCode sql.NullInt32
	var signal sql.NullInt32
	var wallTime int64
	var memoryPeak int64
	var cpuUsageUsec int64
	var cpuThrottledUsec int64
	var pidsPeak int64
	var memoryOomKillCount int64

	result := &pb.JobResult{}
	err := row.Scan(
		&job.JobId,
		&statusText,
		&job.Language,
		&runtimeVersion,
		&job.Entrypoint,
		&argsJSON,
		&job.CompileTimeoutMs,
		&job.RunTimeoutMs,
		&memoryLimit,
		&job.CpuMillis,
		&maxOutput,
		&job.ErrorMessage,
		&job.CreatedAt,
		&job.StartedAt,
		&job.FinishedAt,
		&result.Stdout,
		&result.Stderr,
		&result.CompileStdout,
		&result.CompileStderr,
		&exitCode,
		&signal,
		&wallTime,
		&memoryPeak,
		&result.StdoutTruncated,
		&result.StderrTruncated,
		&cpuUsageUsec,
		&cpuThrottledUsec,
		&pidsPeak,
		&memoryOomKillCount,
	)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(argsJSON), &job.Args); err != nil {
		return nil, fmt.Errorf("decode job args: %w", err)
	}
	if exitCode.Valid {
		result.ExitCode = exitCode.Int32
	}
	if signal.Valid {
		result.Signal = signal.Int32
	}
	job.Status = statusFromDB(statusText)
	job.MemoryLimitBytes = int64ToUint64(memoryLimit)
	job.MaxOutputBytes = int64ToUint64(maxOutput)
	result.WallTimeMs = int64ToUint64(wallTime)
	result.MemoryPeakBytes = int64ToUint64(memoryPeak)
	result.CpuUsageUsec = int64ToUint64(cpuUsageUsec)
	result.CpuThrottledUsec = int64ToUint64(cpuThrottledUsec)
	result.PidsPeak = int64ToUint64(pidsPeak)
	result.MemoryOomKillCount = int64ToUint64(memoryOomKillCount)
	job.Result = result
	job.Runtime = cloneRuntime(runtime)
	job.Runtime.Language = job.Language
	job.Runtime.Version = runtimeVersion
	return &job, nil
}

func statusFromDB(value string) pb.JobStatus {
	switch value {
	case "QUEUED":
		return pb.JobStatus_JOB_STATUS_QUEUED
	case "VALIDATING":
		return pb.JobStatus_JOB_STATUS_VALIDATING
	case "COMPILING":
		return pb.JobStatus_JOB_STATUS_COMPILING
	case "RUNNING":
		return pb.JobStatus_JOB_STATUS_RUNNING
	case "SUCCEEDED":
		return pb.JobStatus_JOB_STATUS_SUCCEEDED
	case "COMPILE_FAILED":
		return pb.JobStatus_JOB_STATUS_COMPILE_FAILED
	case "RUNTIME_FAILED":
		return pb.JobStatus_JOB_STATUS_RUNTIME_FAILED
	case "TIME_LIMIT_EXCEEDED":
		return pb.JobStatus_JOB_STATUS_TIME_LIMIT_EXCEEDED
	case "MEMORY_LIMIT_EXCEEDED":
		return pb.JobStatus_JOB_STATUS_MEMORY_LIMIT_EXCEEDED
	case "OUTPUT_LIMIT_EXCEEDED":
		return pb.JobStatus_JOB_STATUS_OUTPUT_LIMIT_EXCEEDED
	case "CANCELED":
		return pb.JobStatus_JOB_STATUS_CANCELED
	case "SYSTEM_ERROR":
		return pb.JobStatus_JOB_STATUS_SYSTEM_ERROR
	default:
		return pb.JobStatus_JOB_STATUS_UNSPECIFIED
	}
}

func runtimeVersion(runtime *pb.Runtime) string {
	if runtime == nil || runtime.Version == "" {
		return "1.26"
	}
	return runtime.Version
}

func runtimeLanguage(runtime *pb.Runtime) string {
	if runtime == nil || runtime.Language == "" {
		return "go"
	}
	return runtime.Language
}

func cloneRuntime(runtime *pb.Runtime) *pb.Runtime {
	if runtime == nil {
		return &pb.Runtime{Language: "go", Version: "1.26", Image: "sandkasten/go:1.26", RequiresVendor: true}
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

func uint64ToInt64(value uint64) int64 {
	if value > uint64(^uint64(0)>>1) {
		return int64(^uint64(0) >> 1)
	}
	return int64(value)
}

func int64ToUint64(value int64) uint64 {
	if value < 0 {
		return 0
	}
	return uint64(value)
}

func nonnegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}
