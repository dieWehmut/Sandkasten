import { effectScope } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRemoteControl, credentialKey } from '../src/composables/use-remote-control';
import { RemoteClient, RemoteError, type Job } from '../src/client';
import { credentials } from '../src/credentials';
import { newProject } from '../src/projects';
import { isTerminal } from '../src/presentation';
let scope: ReturnType<typeof effectScope>, control: ReturnType<typeof useRemoteControl>;
let stored: Map<string, string>;
const device = { address: 'http://localhost:8080', name: '电脑' };
beforeEach(() => {
  vi.useFakeTimers(); stored = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) });
  vi.spyOn(credentials, 'get').mockResolvedValue({ value: 'token' });
  vi.spyOn(credentials, 'set').mockResolvedValue(); vi.spyOn(credentials, 'remove').mockResolvedValue();
  vi.spyOn(RemoteClient.prototype, 'runtimes').mockResolvedValue([{ language: 'go', status: 'active', default_entrypoint: 'main.go' }, { language: 'python', status: 'active' }]);
  scope = effectScope(); control = scope.run(() => useRemoteControl(device))!;
});
afterEach(() => { scope.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('forwards code, entrypoint, input, parameters and files and receives authoritative final output', async () => {
  await control.connect();
  const submit = vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'one', status: 'JOB_STATUS_QUEUED' });
  const job = vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValue({ jobId: 'one', status: 'JOB_STATUS_SUCCEEDED', stdout: 'Hello\n', exitCode: 0 });
  const project = { ...newProject(), stdin: 'input', args: '["first", "two words"]', files: [{ name: 'hello.txt', content: 'hello' }] };
  await control.submit(project); await vi.advanceTimersByTimeAsync(1000);
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ language: 'go', source: project.source, entrypoint: 'main.go', stdin: 'input', args: ['first', 'two words'], files: project.files }));
  expect(control.jobs.value[0]).toMatchObject({ status: 'JOB_STATUS_SUCCEEDED', stdout: 'Hello\n', projectId: project.id });
  expect(job).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  expect(stored.get(`sandkasten.jobs:${device.address}`)).not.toContain('Hello');
});
it('retries interrupted polling and keeps the job ID', async () => {
  await control.connect();
  vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'offline', status: 'JOB_STATUS_RUNNING' });
  const job = vi.spyOn(RemoteClient.prototype, 'job').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ jobId: 'offline', status: 'JOB_STATUS_SUCCEEDED', stdout: 'recovered' });
  await control.submit(newProject()); await vi.advanceTimersByTimeAsync(1000);
  expect(control.connectionStatus.value).toBe('reconnecting');
  await vi.advanceTimersByTimeAsync(1000);
  expect(job.mock.calls).toEqual([['offline'], ['offline']]);
  expect(control.jobs.value[0].stdout).toBe('recovered'); expect(control.error.value).toBe('');
});
it('stops 401 polling and allows replacement token without reading a broken old credential', async () => {
  await control.connect();
  vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'expired', status: 'JOB_STATUS_RUNNING' });
  vi.spyOn(RemoteClient.prototype, 'job').mockRejectedValue(new RemoteError(401, 'bad token'));
  await control.submit(newProject()); await vi.advanceTimersByTimeAsync(1000);
  expect(control.connectionStatus.value).toBe('needs_token'); expect(vi.getTimerCount()).toBe(0);
  vi.mocked(credentials.get).mockRejectedValue(new Error('keystore damaged'));
  vi.mocked(RemoteClient.prototype.job).mockResolvedValue({ jobId: 'expired', status: 'JOB_STATUS_CANCELED' });
  await control.connect('new-token');
  expect(credentials.set).toHaveBeenCalledWith({ key: credentialKey(device.address), value: 'new-token' });
  expect(control.connectionStatus.value).toBe('connected');
});
it('cancel fetches terminal output and ignores a poll response captured before cancellation', async () => {
  await control.connect();
  vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'stop', status: 'JOB_STATUS_RUNNING' });
  let finish!: (value: Job) => void;
  vi.spyOn(RemoteClient.prototype, 'job').mockImplementationOnce(() => new Promise(resolve => finish = resolve)).mockResolvedValue({ jobId: 'stop', status: 'JOB_STATUS_CANCELED', stdout: 'before stop' });
  vi.spyOn(RemoteClient.prototype, 'cancel').mockResolvedValue({ jobId: 'stop', status: 'JOB_STATUS_CANCELED' });
  await control.submit(newProject()); const poll = control.refresh();
  await control.cancel('stop'); finish({ jobId: 'stop', status: 'JOB_STATUS_RUNNING' }); await poll;
  expect(control.jobs.value[0]).toMatchObject({ status: 'JOB_STATUS_CANCELED', stdout: 'before stop' });
  expect(vi.getTimerCount()).toBe(0);
});
it('restores known job IDs and reloads output from the computer', async () => {
  scope.stop();
  stored.set(`sandkasten.jobs:${device.address}`, JSON.stringify([{ jobId: 'restored', status: 'JOB_STATUS_RUNNING', projectId: 'p', projectName: 'saved', submittedAt: 1 }]));
  vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValue({ jobId: 'restored', status: 'JOB_STATUS_SUCCEEDED', stdout: 'complete after restart' });
  scope = effectScope(); control = scope.run(() => useRemoteControl(device))!;
  await control.connect(); expect(control.jobs.value[0].stdout).toBe('complete after restart');
});
it('marks a missing restored job unavailable so it can be removed locally', async () => {
  await control.connect();
  vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'gone', status: 'JOB_STATUS_QUEUED' });
  vi.spyOn(RemoteClient.prototype, 'job').mockRejectedValue(new RemoteError(404, 'job not found'));
  await control.submit(newProject()); await vi.advanceTimersByTimeAsync(1000);
  expect(isTerminal(control.jobs.value[0].status)).toBe(true); control.remove('gone'); expect(control.jobs.value).toEqual([]);
});
it('does not publish submission responses after controller disposal', async () => {
  await control.connect(); let finish!: (value: Job) => void;
  vi.spyOn(RemoteClient.prototype, 'submit').mockImplementation(() => new Promise(resolve => finish = resolve));
  const submission = control.submit(newProject()); scope.stop();
  finish({ jobId: 'late', status: 'JOB_STATUS_QUEUED' }); await submission;
  expect(control.jobs.value).toEqual([]); expect(vi.getTimerCount()).toBe(0);
});
it('rejects invalid arguments and unavailable runtimes without submitting', async () => {
  await control.connect(); const submit = vi.spyOn(RemoteClient.prototype, 'submit');
  await control.submit({ ...newProject(), args: '{"bad":true}' }); expect(control.error.value).toContain('JSON');
  await control.submit(newProject('unknown')); expect(control.error.value).toContain('运行时'); expect(submit).not.toHaveBeenCalled();
});
it.each(['JOB_STATUS_SUCCEEDED', 'JOB_STATUS_COMPILE_FAILED', 'JOB_STATUS_RUNTIME_FAILED', 'JOB_STATUS_TIME_LIMIT_EXCEEDED', 'JOB_STATUS_MEMORY_LIMIT_EXCEEDED', 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED', 'JOB_STATUS_CANCELED', 'JOB_STATUS_SYSTEM_ERROR'])('stops polling for %s once artifacts are ready', async status => {
  await control.connect(); vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'terminal', status, outputReady: true });
  await control.submit(newProject()); expect(vi.getTimerCount()).toBe(0);
});
it('keeps the submitted project snapshot when code is edited before the response arrives', async () => {
  await control.connect(); const project = newProject(); let finish!: (value: Job) => void;
  const submit = vi.spyOn(RemoteClient.prototype, 'submit').mockImplementation(() => new Promise(resolve => finish = resolve));
  const submission = control.submit(project); project.language = 'python'; project.name = 'edited'; project.source = 'changed';
  finish({ jobId: 'snapshot', status: 'JOB_STATUS_SUCCEEDED' }); await submission;
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ language: 'go' }));
  expect(control.jobs.value[0]).toMatchObject({ language: 'go', projectName: 'go 项目' });
});
it('ignores an old submission error after a newer connection succeeds', async () => {
  await control.connect(); let fail!: (reason: Error) => void;
  vi.spyOn(RemoteClient.prototype, 'submit').mockImplementation(() => new Promise((_, reject) => fail = reject));
  const submission = control.submit(newProject()); await control.connect('replacement');
  fail(new RemoteError(401, 'old token')); await submission;
  expect(control.connectionStatus.value).toBe('connected'); expect(control.error.value).toBe('');
});
it('deletes credentials after a pending save when the device is forgotten', async () => {
  let finish!: () => void;
  const operations: string[] = [];
  vi.mocked(credentials.set).mockImplementation(() => { operations.push('set'); return new Promise(resolve => finish = resolve); });
  vi.mocked(credentials.remove).mockImplementation(async () => { operations.push('remove'); });
  const connection = control.connect('saving');
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
  const forget = control.forget(); expect(operations).toEqual(['set']);
  finish(); await connection; await forget;
  expect(operations).toEqual(['set', 'remove']);
});
it('collects cancellation output committed after the initial canceled acknowledgement', async () => {
  await control.connect(); vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'settling', status: 'JOB_STATUS_RUNNING' });
  vi.spyOn(RemoteClient.prototype, 'cancel').mockResolvedValue({ jobId: 'settling', status: 'JOB_STATUS_CANCELED' });
  const job = vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValueOnce({ jobId: 'settling', status: 'JOB_STATUS_CANCELED', stdout: '', durationMs: 0 }).mockResolvedValueOnce({ jobId: 'settling', status: 'JOB_STATUS_CANCELED', stdout: '', durationMs: 0 }).mockResolvedValue({ jobId: 'settling', status: 'JOB_STATUS_CANCELED', stdout: 'before-stop\n', durationMs: 1500, signal: 15 });
  await control.submit(newProject()); await control.cancel('settling');
  expect(control.jobs.value[0].status).toBe('JOB_STATUS_CANCELED'); expect(control.jobs.value[0].stdout).toBe('');
  await vi.advanceTimersByTimeAsync(2000);
  expect(job).toHaveBeenCalledTimes(3); expect(control.jobs.value[0].stdout).toBe('before-stop\n'); expect(vi.getTimerCount()).toBe(0);
});
it('retries a lost cancellation output read after network recovery', async () => {
  await control.connect(); vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'retry-stop', status: 'JOB_STATUS_RUNNING' });
  vi.spyOn(RemoteClient.prototype, 'cancel').mockResolvedValue({ jobId: 'retry-stop', status: 'JOB_STATUS_CANCELED' });
  vi.spyOn(RemoteClient.prototype, 'job').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ jobId: 'retry-stop', status: 'JOB_STATUS_CANCELED', stdout: 'saved final output' });
  await control.submit(newProject()); await control.cancel('retry-stop'); await vi.advanceTimersByTimeAsync(1000);
  expect(control.jobs.value[0].stdout).toBe('saved final output'); expect(control.error.value).toBe(''); expect(vi.getTimerCount()).toBe(0);
});
it('bounds successful empty output reads for a queued cancellation', async () => {
  await control.connect(); vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'queued-stop', status: 'JOB_STATUS_QUEUED' });
  vi.spyOn(RemoteClient.prototype, 'cancel').mockResolvedValue({ jobId: 'queued-stop', status: 'JOB_STATUS_CANCELED' });
  const job = vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValue({ jobId: 'queued-stop', status: 'JOB_STATUS_CANCELED', durationMs: 0, stdout: '' });
  await control.submit(newProject()); await control.cancel('queued-stop'); await vi.runAllTimersAsync();
  expect(job).toHaveBeenCalledTimes(6); expect(vi.getTimerCount()).toBe(0);
});
it('retains an accepted job ID after the same computer reconnects before the response arrives', async () => {
  await control.connect(); let finish!: (value: Job) => void;
  vi.spyOn(RemoteClient.prototype, 'submit').mockImplementation(() => new Promise(resolve => finish = resolve));
  vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValue({ jobId: 'accepted-before-reconnect', status: 'JOB_STATUS_SUCCEEDED', stdout: 'tracked' });
  const submission = control.submit(newProject()); await control.connect('new-token');
  finish({ jobId: 'accepted-before-reconnect', status: 'JOB_STATUS_RUNNING' }); await submission; await vi.advanceTimersByTimeAsync(1000);
  expect(control.jobs.value[0]).toMatchObject({ jobId: 'accepted-before-reconnect', stdout: 'tracked' });
});
it('keeps polling a canceled result until the server explicitly marks artifacts ready', async () => {
  await control.connect(); vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'explicit-ready', status: 'JOB_STATUS_RUNNING' });
  vi.spyOn(RemoteClient.prototype, 'cancel').mockResolvedValue({ jobId: 'explicit-ready', status: 'JOB_STATUS_CANCELED' });
  let ready = false;
  const job = vi.spyOn(RemoteClient.prototype, 'job').mockImplementation(async () => ({ jobId: 'explicit-ready', status: 'JOB_STATUS_CANCELED', outputReady: ready, stdout: ready ? 'late final output' : '' }));
  await control.submit(newProject()); await control.cancel('explicit-ready'); await vi.advanceTimersByTimeAsync(8000);
  expect(job).toHaveBeenCalledTimes(9); expect(vi.getTimerCount()).toBe(1);
  ready = true; await vi.advanceTimersByTimeAsync(1000);
  expect(control.jobs.value[0]).toMatchObject({ stdout: 'late final output', outputReady: true }); expect(vi.getTimerCount()).toBe(0);
});
it('stops immediately for an explicitly ready empty canceled result', async () => {
  await control.connect(); vi.spyOn(RemoteClient.prototype, 'submit').mockResolvedValue({ jobId: 'empty-ready', status: 'JOB_STATUS_QUEUED' });
  vi.spyOn(RemoteClient.prototype, 'cancel').mockResolvedValue({ jobId: 'empty-ready', status: 'JOB_STATUS_CANCELED' });
  vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValue({ jobId: 'empty-ready', status: 'JOB_STATUS_CANCELED', stdout: '', outputReady: true });
  await control.submit(newProject()); await control.cancel('empty-ready'); expect(vi.getTimerCount()).toBe(0);
});
it('restores a terminal history record and waits for server readiness after restart', async () => {
  scope.stop(); stored.set(`sandkasten.jobs:${device.address}`, JSON.stringify([{ jobId: 'restored-settle', status: 'JOB_STATUS_CANCELED', projectId: 'p', projectName: 'saved', submittedAt: 1 }]));
  vi.spyOn(RemoteClient.prototype, 'job').mockResolvedValueOnce({ jobId: 'restored-settle', status: 'JOB_STATUS_CANCELED', outputReady: false }).mockResolvedValue({ jobId: 'restored-settle', status: 'JOB_STATUS_CANCELED', outputReady: true, stdout: 'after restart' });
  scope = effectScope(); control = scope.run(() => useRemoteControl(device))!; await control.connect(); await vi.advanceTimersByTimeAsync(1000);
  expect(control.jobs.value[0]).toMatchObject({ outputReady: true, stdout: 'after restart' }); expect(vi.getTimerCount()).toBe(0);
});
