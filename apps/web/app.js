const TERMINAL_STATUSES = new Set([
  'JOB_STATUS_SUCCEEDED',
  'JOB_STATUS_COMPILE_FAILED',
  'JOB_STATUS_RUNTIME_FAILED',
  'JOB_STATUS_TIME_LIMIT_EXCEEDED',
  'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
  'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
  'JOB_STATUS_CANCELED',
  'JOB_STATUS_SYSTEM_ERROR',
]);

const defaultFetch = (...args) => fetch(...args);

export function resolveApiUrl(pathname, config = globalThis.SANDKASTEN_CONFIG) {
  const path = `/${String(pathname).replace(/^\/+/, '')}`;
  const base = typeof config?.apiBaseUrl === 'string' ? config.apiBaseUrl.trim().replace(/\/+$/, '') : '';
  return `${base}${path}`;
}

function asObject(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} returned an invalid JSON object`);
  }
  return value;
}

async function requestJson(url, options = {}, fetchImpl = defaultFetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  if (!response || typeof response.ok !== 'boolean') {
    throw new Error('API returned an invalid response');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      if (payload && typeof payload.message === 'string') detail = `: ${payload.message}`;
      else if (payload && typeof payload.error === 'string') detail = `: ${payload.error}`;
    } catch {
      // The status text is enough when an error body is not JSON.
    }
    throw new Error(`API request failed (${response.status}${detail})`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('API returned invalid JSON');
  }
  return asObject(payload, 'API');
}

export async function loadRuntimes(fetchImpl = defaultFetch) {
  const payload = await requestJson(resolveApiUrl('/v1/runtimes'), {}, fetchImpl);
  const runtimes = Array.isArray(payload.runtimes) ? payload.runtimes : payload;
  if (!Array.isArray(runtimes)) throw new Error('Runtime response has no runtimes list');
  return runtimes.map((runtime) => {
    if (!runtime || typeof runtime !== 'object' || typeof runtime.language !== 'string' || !runtime.language.trim()) {
      throw new Error('Runtime response contains an invalid runtime');
    }
    return runtime;
  });
}

export async function submitJob(language, source, fetchImpl = defaultFetch) {
  if (typeof language !== 'string' || !language.trim()) throw new Error('Choose a runtime');
  if (typeof source !== 'string' || !source.trim()) throw new Error('Source is required');
  const payload = await requestJson(resolveApiUrl(`/v1/${encodeURIComponent(language)}/run`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, wait: false }),
  }, fetchImpl);
  const jobId = typeof payload.jobId === 'string' ? payload.jobId : payload.job_id;
  if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Run response did not include a job ID');
  return { ...payload, jobId };
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Polling aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Polling aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function pollJob(jobId, {
  fetchImpl = defaultFetch,
  signal,
  intervalMs = 1000,
  onUpdate,
} = {}) {
  if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('A job ID is required');
  for (;;) {
    const payload = await requestJson(resolveApiUrl(`/v1/jobs/${encodeURIComponent(jobId)}`), { signal }, fetchImpl);
    if (typeof payload.status !== 'string' || !payload.status.trim()) throw new Error('Job response has no status');
    onUpdate?.(payload);
    if (TERMINAL_STATUSES.has(payload.status)) return payload;
    await wait(intervalMs, signal);
  }
}

function textValue(value) {
  return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function renderResult(result, elements) {
  elements.status.textContent = result.status || 'Unknown';
  elements.stdout.textContent = textValue(result.stdout);
  elements.stderr.textContent = textValue(result.stderr);
  elements.diagnostics.textContent = [
    result.compileStderr,
    result.errorMessage || result.error,
    result.diagnostics && Object.keys(result.diagnostics).length ? textValue(result.diagnostics) : '',
  ].filter(Boolean).join('\n\n');
}

function init() {
  const form = document.querySelector('#run-form');
  if (!form) return;
  const elements = {
    runtime: document.querySelector('#runtime-select'),
    source: document.querySelector('#source'),
    submit: document.querySelector('#submit-button'),
    cancel: document.querySelector('#cancel-button'),
    status: document.querySelector('#status'),
    error: document.querySelector('#error'),
    stdout: document.querySelector('#stdout code'),
    stderr: document.querySelector('#stderr code'),
    diagnostics: document.querySelector('#diagnostics code'),
  };
  let pollController;

  const showError = (error) => {
    elements.error.textContent = error instanceof Error ? error.message : String(error);
    elements.error.hidden = false;
  };

  loadRuntimes().then((runtimes) => {
    elements.runtime.replaceChildren(...runtimes.map((runtime) => {
      const option = document.createElement('option');
      option.value = runtime.language;
      option.textContent = runtime.label || runtime.language;
      return option;
    }));
    elements.runtime.disabled = false;
    elements.submit.disabled = false;
    elements.status.textContent = 'Ready';
  }).catch(showError);

  elements.cancel.addEventListener('click', () => pollController?.abort());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.error.hidden = true;
    elements.submit.disabled = true;
    elements.cancel.hidden = false;
    pollController?.abort();
    pollController = new AbortController();
    try {
      elements.status.textContent = 'Submitting...';
      const job = await submitJob(elements.runtime.value, elements.source.value);
      elements.status.textContent = `Queued (${job.jobId})`;
      await pollJob(job.jobId, { signal: pollController.signal, onUpdate: (result) => renderResult(result, elements) });
    } catch (error) {
      if (error?.name === 'AbortError') elements.status.textContent = 'Polling stopped';
      else showError(error);
    } finally {
      elements.submit.disabled = false;
      elements.cancel.hidden = true;
    }
  });
}

if (typeof document !== 'undefined') init();
