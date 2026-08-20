export interface Runtime {
  language: string;
  version?: string;
  image?: string;
  requires_vendor?: boolean;
  aliases?: string[];
  status?: string;
  default_entrypoint?: string;
  compile_phase?: RuntimePhase;
  run_phase?: RuntimePhase;
  default_limits?: RuntimeLimits;
  max_limits?: RuntimeLimits;
  phases?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RuntimePhase {
  command?: string[];
  enabled?: boolean;
  [key: string]: unknown;
}

export interface RuntimeLimits {
  compile_timeout_ms?: number;
  run_timeout_ms?: number;
  memory_limit_bytes?: number;
  cpu_millis?: number;
  output_bytes?: number;
  archive_bytes?: number;
  stdin_bytes?: number;
  args?: number;
  arg_bytes?: number;
  [key: string]: unknown;
}

export interface JobResponse {
  jobId: string;
  status: string;
  language?: string;
  runtime?: string;
  stdout?: string;
  stderr?: string;
  compileStdout?: string;
  compileStderr?: string;
  stdoutEncoding?: string;
  stderrEncoding?: string;
  compileStdoutEncoding?: string;
  compileStderrEncoding?: string;
  exitCode?: number;
  signal?: number;
  durationMs?: number;
  errorMessage?: string;
  truncated?: { stdout?: boolean; stderr?: boolean; [key: string]: unknown };
  diagnostics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApiConfig {
  apiBaseUrl?: string;
}

export interface DecodedOutput {
  text: string;
  raw: string;
  undecodable: boolean;
  warning?: string;
}

export const TERMINAL_STATUSES = new Set([
  'JOB_STATUS_SUCCEEDED',
  'JOB_STATUS_COMPILE_FAILED',
  'JOB_STATUS_RUNTIME_FAILED',
  'JOB_STATUS_TIME_LIMIT_EXCEEDED',
  'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
  'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
  'JOB_STATUS_CANCELED',
  'JOB_STATUS_SYSTEM_ERROR',
]);

type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (...args) => fetch(...args);

export function resolveApiUrl(pathname: string, config: ApiConfig | undefined = globalThis.SANDKASTEN_CONFIG): string {
  const path = `/${String(pathname).replace(/^\/+/, '')}`;
  const base = typeof config?.apiBaseUrl === 'string' ? config.apiBaseUrl.trim().replace(/\/+$/, '') : '';
  return `${base}${path}`;
}

function asObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} returned an invalid JSON object`);
  }
  return value as Record<string, unknown>;
}

async function requestJson(url: string, options: RequestInit = {}, fetchImpl: FetchLike = defaultFetch): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (!response || typeof response.ok !== 'boolean') throw new Error('API returned an invalid response');
  if (!response.ok) {
    let detail = '';
    try {
      const payload = asObject(await response.json(), 'API error');
      if (typeof payload.message === 'string' && payload.message.trim()) detail = payload.message;
      else if (typeof payload.error === 'string' && payload.error.trim()) detail = payload.error;
    } catch {
      // Status is retained when an error body is not JSON.
    }
    throw new Error(`API request failed (${response.status}${detail ? `: ${detail}` : ''})`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('API returned invalid JSON');
  }
  return asObject(payload, 'API');
}

function toRuntime(value: unknown): Runtime {
  const runtime = asObject(value, 'Runtime response');
  if (typeof runtime.language !== 'string' || !runtime.language.trim()) throw new Error('Runtime response contains an invalid runtime');
  if ('aliases' in runtime && runtime.aliases !== undefined && !Array.isArray(runtime.aliases)) throw new Error('Runtime response contains an invalid runtime aliases field');
  return runtime as Runtime;
}

function toJob(value: unknown): JobResponse {
  const job = asObject(value, 'Job response');
  if (typeof job.jobId !== 'string' || !job.jobId.trim()) throw new Error('Job response did not include a job ID');
  if (typeof job.status !== 'string' || !job.status.trim()) throw new Error('Job response has no status');
  return job as JobResponse;
}

export async function loadRuntimes(fetchImpl: FetchLike = defaultFetch): Promise<Runtime[]> {
  const payload = await requestJson(resolveApiUrl('/v1/runtimes'), {}, fetchImpl);
  const runtimes = Array.isArray(payload.runtimes) ? payload.runtimes : payload;
  if (!Array.isArray(runtimes)) throw new Error('Runtime response has no runtimes list');
  return runtimes.map(toRuntime);
}

export async function submitJob(language: string, source: string, fetchImpl: FetchLike = defaultFetch, signal?: AbortSignal): Promise<JobResponse> {
  if (typeof language !== 'string' || !language.trim()) throw new Error('Choose a runtime');
  if (typeof source !== 'string' || !source.trim()) throw new Error('Source is required');
  const payload = await requestJson(resolveApiUrl(`/v1/${encodeURIComponent(language)}/run`), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, wait: false }),
  }, fetchImpl);
  return toJob(payload);
}

export async function getJob(jobId: string, fetchImpl: FetchLike = defaultFetch, signal?: AbortSignal): Promise<JobResponse> {
  if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('A job ID is required');
  return toJob(await requestJson(resolveApiUrl(`/v1/jobs/${encodeURIComponent(jobId)}`), { signal }, fetchImpl));
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const rejectAborted = () => reject(typeof DOMException === 'undefined' ? Object.assign(new Error('Polling aborted'), { name: 'AbortError' }) : new DOMException('Polling aborted', 'AbortError'));
    if (signal?.aborted) {
      rejectAborted();
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      rejectAborted();
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollJob(jobId: string, options: { fetchImpl?: FetchLike; signal?: AbortSignal; intervalMs?: number; onUpdate?: (job: JobResponse) => void } = {}): Promise<JobResponse> {
  const { fetchImpl = defaultFetch, signal, intervalMs = 1000, onUpdate } = options;
  for (;;) {
    const job = await getJob(jobId, fetchImpl, signal);
    onUpdate?.(job);
    if (TERMINAL_STATUSES.has(job.status)) return job;
    await wait(intervalMs, signal);
  }
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid base64 output');
  }
  const atobImpl = typeof globalThis.atob === 'function' ? globalThis.atob.bind(globalThis) : undefined;
  if (atobImpl) {
    const binary = atobImpl(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  const bufferCtor = (globalThis as typeof globalThis & { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer;
  if (bufferCtor) return new Uint8Array(bufferCtor.from(value, 'base64'));
  throw new Error('Base64 decoding is unavailable in this environment');
}

export function decodeOutput(value: string | undefined | null, encoding: string | undefined | null): DecodedOutput {
  const raw = value == null ? '' : String(value);
  const normalized = String(encoding ?? 'utf8').toLowerCase();
  if (normalized === 'utf8' || normalized === 'utf-8' || normalized === 'text' || normalized === 'auto' || normalized === '') {
    return { text: raw, raw, undecodable: false };
  }
  if (normalized !== 'base64') return { text: raw, raw, undecodable: true, warning: `Unsupported output encoding: ${encoding}` };
  try {
    const bytes = decodeBase64(raw);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, raw, undecodable: false };
  } catch {
    return { text: raw, raw, undecodable: true, warning: 'Output could not be decoded as UTF-8 base64' };
  }
}
