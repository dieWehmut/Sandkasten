import { describe, expect, test, vi } from 'vitest';
import {
  TERMINAL_STATUSES,
  decodeOutput,
  getJob,
  loadRuntimes,
  pollJob,
  resolveApiUrl,
  submitJob,
} from '../src/services/sandkastenApi';

const response = (body: unknown, init: Partial<Response> = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  ...init,
}) as Response;

describe('sandkasten API client', () => {
  test('joins configured API base and path without duplicate slashes', () => {
    expect(resolveApiUrl('/v1/runtimes', { apiBaseUrl: 'https://api.example/v1/' })).toBe('https://api.example/v1/v1/runtimes');
    expect(resolveApiUrl('v1/runtimes', { apiBaseUrl: '' })).toBe('/v1/runtimes');
  });

  test('loads and validates runtime records while retaining backend field names', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ runtimes: [{ language: 'go', version: '1.26', image: 'go:1.26', requires_vendor: true, aliases: ['golang'], status: 'ready', default_entrypoint: 'main.go', phases: {}, limits: {} }] }));
    const runtimes = await loadRuntimes(fetchImpl);
    expect(runtimes[0]).toMatchObject({ language: 'go', requires_vendor: true, default_entrypoint: 'main.go' });
    await expect(loadRuntimes(vi.fn().mockResolvedValue(response({ runtimes: [{}] })))).rejects.toThrow(/invalid runtime/i);
  });

  test('submits exact asynchronous request and validates job id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ jobId: 'job-1', status: 'queued' }));
    await expect(submitJob('TypeScript', 'console.log(1)', fetchImpl)).resolves.toMatchObject({ jobId: 'job-1' });
    expect(fetchImpl).toHaveBeenCalledWith('/v1/TypeScript/run', expect.objectContaining({ method: 'POST', body: '{"source":"console.log(1)","wait":false}', headers: expect.objectContaining({ Accept: 'application/json', 'Content-Type': 'application/json' }) }));
  });

  test('prefers HTTP JSON message over error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: 'fallback', message: 'specific failure' }, { ok: false, status: 422 }));
    await expect(getJob('job-1', fetchImpl)).rejects.toThrow('specific failure');
  });

  test('polls unknown non-empty statuses and stops at all terminal statuses', async () => {
    expect(TERMINAL_STATUSES).toEqual(new Set(['JOB_STATUS_SUCCEEDED', 'JOB_STATUS_COMPILE_FAILED', 'JOB_STATUS_RUNTIME_FAILED', 'JOB_STATUS_TIME_LIMIT_EXCEEDED', 'JOB_STATUS_MEMORY_LIMIT_EXCEEDED', 'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED', 'JOB_STATUS_CANCELED', 'JOB_STATUS_SYSTEM_ERROR']));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ jobId: 'job-1', status: 'future_status' }))
      .mockResolvedValueOnce(response({ jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED' }));
    await expect(pollJob('job-1', { fetchImpl, intervalMs: 0 })).resolves.toMatchObject({ status: 'JOB_STATUS_SUCCEEDED' });
    await expect(pollJob('job-1', { fetchImpl: vi.fn().mockResolvedValue(response({ jobId: 'job-1' })), intervalMs: 0 })).rejects.toThrow(/no status/i);
  });

  test('decodes valid base64 UTF-8 and preserves raw undecodable values', () => {
    expect(decodeOutput('5L2g5aW9', 'base64')).toMatchObject({ text: '你好', undecodable: false });
    expect(decodeOutput('!!!', 'base64')).toMatchObject({ raw: '!!!', undecodable: true });
    expect(decodeOutput('/w==', 'base64')).toMatchObject({ raw: '/w==', text: '/w==', undecodable: true });
    expect(decodeOutput('hello', 'unsupported')).toMatchObject({ raw: 'hello', text: 'hello', undecodable: true });
  });

  test('rejects malformed base64 when the Node compatibility path is used', () => {
    vi.stubGlobal('atob', undefined);
    try {
      expect(decodeOutput('!!!', 'base64')).toMatchObject({ raw: '!!!', text: '!!!', undecodable: true });
      expect(decodeOutput('5L2g5aW9', 'base64')).toMatchObject({ text: '你好', undecodable: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('cleans the polling timer abort listener after the wait settles', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ jobId: 'job-1', status: 'queued' }))
      .mockResolvedValueOnce(response({ jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED' }));
    await pollJob('job-1', { fetchImpl, intervalMs: 0, signal: controller.signal });
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
