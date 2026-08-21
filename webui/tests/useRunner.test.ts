import { nextTick } from 'vue';
import { describe, expect, test, vi } from 'vitest';
import type { JobResponse, Runtime } from '../src/services/sandkastenApi';
import { useRunner } from '../src/composables/useRunner';
import { TERMINAL_STATUS_META } from '../src/state/status';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const runtimes: Runtime[] = [{ language: 'python', version: '3.13' }];
const succeeded = (jobId = 'job-1'): JobResponse => ({
  jobId,
  status: 'JOB_STATUS_SUCCEEDED',
  stdout: 'done',
});

describe('useRunner', () => {
  test('centralizes the exact eight terminal statuses with labels and categories', () => {
    expect(Object.keys(TERMINAL_STATUS_META)).toEqual([
      'JOB_STATUS_SUCCEEDED',
      'JOB_STATUS_COMPILE_FAILED',
      'JOB_STATUS_RUNTIME_FAILED',
      'JOB_STATUS_TIME_LIMIT_EXCEEDED',
      'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
      'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
      'JOB_STATUS_CANCELED',
      'JOB_STATUS_SYSTEM_ERROR',
    ]);
    expect(TERMINAL_STATUS_META.JOB_STATUS_SUCCEEDED).toEqual({ label: 'Succeeded', category: 'success' });
  });

  test('loads runtimes from booting and can retry after a load failure', async () => {
    const loadRuntimes = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(runtimes);
    const runner = useRunner({ loadRuntimes });

    expect(runner.phase.value).toBe('booting');
    await runner.load();
    expect(runner.phase.value).toBe('error');
    expect(runner.connectionState.value).toBe('unavailable');
    expect(runner.error.value).toBe('offline');

    await runner.load();
    expect(runner.phase.value).toBe('ready');
    expect(runner.connectionState.value).toBe('connected');
    expect(runner.selectedLanguage.value).toBe('python');
  });

  test('submits, publishes polling updates, and completes a terminal job', async () => {
    const queued: JobResponse = { jobId: 'job-1', status: 'JOB_STATUS_QUEUED' };
    const running: JobResponse = { jobId: 'job-1', status: 'JOB_STATUS_RUNNING', stdout: 'partial' };
    const submitJob = vi.fn().mockResolvedValue(queued);
    const pollJob = vi.fn(async (_jobId, options) => {
      options?.onUpdate?.(running);
      return succeeded();
    });
    const runner = useRunner({ loadRuntimes: vi.fn().mockResolvedValue(runtimes), submitJob, pollJob });
    await runner.load();
    runner.setSource('print("ok")');

    await runner.submit();

    expect(submitJob).toHaveBeenCalledWith('python', 'print("ok")');
    expect(pollJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(runner.phase.value).toBe('completed');
    expect(runner.result.value).toEqual(succeeded());
    expect(runner.history.value).toHaveLength(1);
    expect(runner.history.value[0]).toMatchObject({ language: 'python', source: 'print("ok")', jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED' });
  });

  test('stops only browser polling and resumes the same backend job', async () => {
    let firstSignal: AbortSignal | undefined;
    const firstPoll = deferred<JobResponse>();
    const pollJob = vi.fn()
      .mockImplementationOnce((_jobId, options) => {
        firstSignal = options.signal;
        options.signal.addEventListener('abort', () => firstPoll.reject(new DOMException('stopped', 'AbortError')), { once: true });
        return firstPoll.promise;
      })
      .mockResolvedValueOnce(succeeded('job-stop'));
    const runner = useRunner({
      loadRuntimes: vi.fn().mockResolvedValue(runtimes),
      submitJob: vi.fn().mockResolvedValue({ jobId: 'job-stop', status: 'JOB_STATUS_QUEUED' }),
      pollJob,
    });
    await runner.load();
    runner.setSource('work()');
    const submitting = runner.submit();
    await nextTick();

    runner.stopPolling();
    await submitting;
    expect(firstSignal?.aborted).toBe(true);
    expect(runner.phase.value).toBe('stopped');
    expect(runner.pollingStopped.value).toBe(true);

    await runner.resumePolling();
    expect(pollJob.mock.calls[1][0]).toBe('job-stop');
    expect(runner.phase.value).toBe('completed');
  });

  test('keeps the last terminal output visible when a later run errors', async () => {
    const submitJob = vi.fn()
      .mockResolvedValueOnce({ jobId: 'old', status: 'JOB_STATUS_QUEUED' })
      .mockResolvedValueOnce({ jobId: 'new', status: 'JOB_STATUS_QUEUED' });
    const pollJob = vi.fn()
      .mockResolvedValueOnce(succeeded('old'))
      .mockRejectedValueOnce(new Error('network lost'));
    const runner = useRunner({ loadRuntimes: vi.fn().mockResolvedValue(runtimes), submitJob, pollJob });
    await runner.load();
    runner.setSource('first');
    await runner.submit();
    runner.setSource('second');

    const pending = runner.submit();
    expect(runner.result.value).toBeUndefined();
    await pending;

    expect(runner.phase.value).toBe('error');
    expect(runner.error.value).toBe('network lost');
    expect(runner.result.value).toEqual(succeeded('old'));
  });

  test('ignores stale callbacks and stale finally work from an older generation', async () => {
    const firstSubmit = deferred<JobResponse>();
    const submitJob = vi.fn()
      .mockImplementationOnce(() => firstSubmit.promise)
      .mockResolvedValueOnce({ jobId: 'new', status: 'JOB_STATUS_QUEUED' });
    const pollJob = vi.fn().mockResolvedValue(succeeded('new'));
    const runner = useRunner({ loadRuntimes: vi.fn().mockResolvedValue(runtimes), submitJob, pollJob });
    await runner.load();
    runner.setSource('old source');
    const oldRun = runner.submit();
    runner.setSource('new source');
    await runner.submit();
    firstSubmit.resolve({ jobId: 'old', status: 'JOB_STATUS_QUEUED' });
    await oldRun;

    expect(runner.phase.value).toBe('completed');
    expect(runner.currentJob.value?.jobId).toBe('new');
    expect(runner.result.value?.jobId).toBe('new');
    expect(pollJob).toHaveBeenCalledTimes(1);
  });

  test('restores a capped in-memory history item without making API calls', async () => {
    let sequence = 0;
    const submitJob = vi.fn(async () => ({ jobId: `job-${++sequence}`, status: 'JOB_STATUS_SUCCEEDED' }));
    const pollJob = vi.fn();
    const runner = useRunner({ loadRuntimes: vi.fn().mockResolvedValue(runtimes), submitJob, pollJob });
    await runner.load();

    for (let index = 0; index < 21; index += 1) {
      runner.setSource(`source-${index}`);
      await runner.submit();
    }
    expect(runner.history.value).toHaveLength(20);
    expect(runner.history.value.at(-1)?.source).toBe('source-1');

    const calls = submitJob.mock.calls.length;
    runner.selectHistoryItem(runner.history.value.at(-1)!);
    expect(runner.source.value).toBe('source-1');
    expect(runner.result.value?.jobId).toBe('job-2');
    expect(submitJob).toHaveBeenCalledTimes(calls);
    expect(pollJob).not.toHaveBeenCalled();
  });

  test('selects history without aborting or replacing the active polling owner', async () => {
    const livePoll = deferred<JobResponse>();
    let liveSignal: AbortSignal | undefined;
    const submitJob = vi.fn()
      .mockResolvedValueOnce({ jobId: 'history-job', status: 'JOB_STATUS_SUCCEEDED' })
      .mockResolvedValueOnce({ jobId: 'live-job', status: 'JOB_STATUS_QUEUED' });
    const pollJob = vi.fn((_jobId, options) => {
      liveSignal = options.signal;
      return livePoll.promise;
    });
    const runner = useRunner({ loadRuntimes: vi.fn().mockResolvedValue(runtimes), submitJob, pollJob });
    await runner.load();
    runner.setSource('history source');
    await runner.submit();
    runner.setSource('live source');
    const liveRun = runner.submit();
    await nextTick();

    runner.selectHistoryItem(runner.history.value[0]);

    expect(liveSignal?.aborted).toBe(false);
    expect(runner.currentJob.value?.jobId).toBe('live-job');
    expect(runner.source.value).toBe('history source');
    expect(runner.result.value?.jobId).toBe('history-job');
    livePoll.resolve(succeeded('live-job'));
    await liveRun;
  });

  test('keeps a history result selected while live updates and completion continue in the background', async () => {
    const livePoll = deferred<JobResponse>();
    let onUpdate!: (job: JobResponse) => void;
    const submitJob = vi.fn()
      .mockResolvedValueOnce({ jobId: 'history-job', status: 'JOB_STATUS_SUCCEEDED', stdout: 'history' })
      .mockResolvedValueOnce({ jobId: 'live-job', status: 'JOB_STATUS_QUEUED' });
    const pollJob = vi.fn((_jobId, options) => {
      onUpdate = options.onUpdate;
      return livePoll.promise;
    });
    const runner = useRunner({ loadRuntimes: vi.fn().mockResolvedValue(runtimes), submitJob, pollJob });
    await runner.load();
    runner.setSource('history source');
    await runner.submit();
    runner.setSource('live source');
    const liveRun = runner.submit();
    await nextTick();
    runner.selectHistoryItem(runner.history.value[0]);

    onUpdate({ jobId: 'live-job', status: 'JOB_STATUS_RUNNING', stdout: 'live update' });
    expect(runner.result.value?.jobId).toBe('history-job');
    livePoll.resolve(succeeded('live-job'));
    await liveRun;
    expect(runner.result.value?.jobId).toBe('history-job');

    runner.selectHistoryItem(runner.history.value[0]);
    expect(runner.result.value?.jobId).toBe('live-job');
  });

  test('keeps a history result selected while a pending submission resolves', async () => {
    const pendingSubmit = deferred<JobResponse>();
    const submitJob = vi.fn()
      .mockResolvedValueOnce({ jobId: 'history-job', status: 'JOB_STATUS_SUCCEEDED', stdout: 'history' })
      .mockImplementationOnce(() => pendingSubmit.promise);
    const runner = useRunner({
      loadRuntimes: vi.fn().mockResolvedValue(runtimes),
      submitJob,
      pollJob: vi.fn(),
    });
    await runner.load();
    runner.setSource('history source');
    await runner.submit();
    const historyItem = runner.history.value[0];

    runner.setSource('pending source');
    const pendingRun = runner.submit();
    runner.selectHistoryItem(historyItem);
    pendingSubmit.resolve({ jobId: 'new-job', status: 'JOB_STATUS_SUCCEEDED', stdout: 'new output' });
    await pendingRun;

    expect(runner.result.value?.jobId).toBe('history-job');
    expect(runner.source.value).toBe('history source');
    expect(runner.currentJob.value?.jobId).toBe('new-job');
  });

  test('keeps a history result selected when a pending submission fails', async () => {
    const pendingSubmit = deferred<JobResponse>();
    const submitJob = vi.fn()
      .mockResolvedValueOnce({ jobId: 'history-job', status: 'JOB_STATUS_SUCCEEDED', stdout: 'history' })
      .mockImplementationOnce(() => pendingSubmit.promise);
    const runner = useRunner({
      loadRuntimes: vi.fn().mockResolvedValue(runtimes),
      submitJob,
      pollJob: vi.fn(),
    });
    await runner.load();
    runner.setSource('history source');
    await runner.submit();
    const historyItem = runner.history.value[0];

    runner.setSource('pending source');
    const pendingRun = runner.submit();
    runner.selectHistoryItem(historyItem);
    pendingSubmit.reject(new Error('submit failed'));
    await pendingRun;

    expect(runner.result.value?.jobId).toBe('history-job');
    expect(runner.source.value).toBe('history source');
    expect(runner.requestError.value).toBe('submit failed');
  });

  test('ignores an old poll abort when polling is resumed immediately', async () => {
    const firstPoll = deferred<JobResponse>();
    const resumedPoll = deferred<JobResponse>();
    const pollJob = vi.fn()
      .mockImplementationOnce((_jobId, options) => {
        options.signal.addEventListener('abort', () => firstPoll.reject(new DOMException('stopped', 'AbortError')), { once: true });
        return firstPoll.promise;
      })
      .mockImplementationOnce(() => resumedPoll.promise);
    const runner = useRunner({
      loadRuntimes: vi.fn().mockResolvedValue(runtimes),
      submitJob: vi.fn().mockResolvedValue({ jobId: 'job-resume', status: 'JOB_STATUS_QUEUED' }),
      pollJob,
    });
    await runner.load();
    runner.setSource('work()');
    const submitting = runner.submit();
    await nextTick();

    runner.stopPolling();
    const resuming = runner.resumePolling();
    await nextTick();

    expect(runner.phase.value).toBe('polling');
    expect(runner.requestError.value).toBeUndefined();
    resumedPoll.resolve(succeeded('job-resume'));
    await Promise.all([submitting, resuming]);
    expect(runner.phase.value).toBe('completed');
  });

  test('exposes submission errors for Diagnostics while retaining the last result', async () => {
    const submitJob = vi.fn()
      .mockResolvedValueOnce(succeeded('old'))
      .mockRejectedValueOnce(new Error('submit unavailable'));
    const runner = useRunner({
      loadRuntimes: vi.fn().mockResolvedValue(runtimes),
      submitJob,
      pollJob: vi.fn(),
    });
    await runner.load();
    runner.setSource('old');
    await runner.submit();
    runner.setSource('new');
    await runner.submit();

    expect(runner.error.value).toBe('submit unavailable');
    expect(runner.requestError.value).toBe('submit unavailable');
    expect(runner.result.value?.jobId).toBe('old');
  });
});
