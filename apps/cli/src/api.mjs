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

export class ApiError extends Error {}

export function resolveApiUrl(pathname, { apiBaseUrl } = {}) {
  const path = `/${String(pathname).replace(/^\/+/, '')}`;
  const base = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim().replace(/\/+$/, '') : '';
  return `${base}${path}`;
}

export function buildHeaders({ token, headers } = {}) {
  const result = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(headers ?? {}),
  };
  if (typeof token === 'string' && token.trim()) result.Authorization = `Bearer ${token}`;
  return result;
}

function asObject(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(`${context} returned an invalid JSON object`);
  }
  return value;
}

async function requestJson(pathname, { body, fetchImpl, signal, ...options } = {}) {
  const url = resolveApiUrl(pathname, { apiBaseUrl: options.apiBaseUrl });
  let response;
  try {
    response = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST',
      signal,
      headers: buildHeaders(options),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(`cannot reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response || typeof response.ok !== 'boolean') throw new ApiError(`API returned an invalid response from ${url}`);
  if (!response.ok) {
    let detail = '';
    try {
      const payload = asObject(await response.json(), 'API error');
      if (typeof payload.message === 'string' && payload.message.trim()) detail = payload.message;
      else if (typeof payload.error === 'string' && payload.error.trim()) detail = payload.error;
    } catch {
      detail = '';
    }
    throw new ApiError(`${url} failed (${response.status}${detail ? `: ${detail}` : ''})`);
  }
  try {
    return asObject(await response.json(), 'API');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`${url} returned invalid JSON`);
  }
}

export async function fetchRuntimes({ fetchImpl = fetch, ...options } = {}) {
  const payload = await requestJson('/v1/runtimes', { fetchImpl, ...options });
  const runtimes = Array.isArray(payload.runtimes) ? payload.runtimes : payload;
  if (!Array.isArray(runtimes)) throw new ApiError('runtime response has no runtimes list');
  return runtimes;
}

export async function submitJob({ language, source, entrypoint, stdinBase64, fetchImpl = fetch, ...options } = {}) {
  if (typeof language !== 'string' || !language.trim()) throw new ApiError('choose a runtime with --language');
  if (typeof source !== 'string' || !source.trim()) throw new ApiError('source is required');
  const body = { source, wait: false };
  if (entrypoint) body.entrypoint = entrypoint;
  if (stdinBase64) body.stdinBase64 = stdinBase64;
  return requestJson(`/v1/${encodeURIComponent(language)}/run`, { body, fetchImpl, ...options });
}

export async function getJob({ jobId, fetchImpl = fetch, ...options } = {}) {
  if (typeof jobId !== 'string' || !jobId.trim()) throw new ApiError('a job id is required');
  return requestJson(`/v1/jobs/${encodeURIComponent(jobId)}`, { fetchImpl, ...options });
}

export function delay(milliseconds, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new ApiError('polling aborted'));
    };
    if (signal?.aborted) {
      reject(new ApiError('polling aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

export async function pollJob({ jobId, intervalMs = 1000, onUpdate, fetchImpl = fetch, ...options } = {}) {
  for (;;) {
    const job = await getJob({ jobId, fetchImpl, ...options });
    onUpdate?.(job);
    if (TERMINAL_STATUSES.has(job.status)) return job;
    await delay(intervalMs, options);
  }
}
