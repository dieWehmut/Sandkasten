// Runtime API endpoint for the WebUI. The bundled `config.js` supplies the
// deployment default (Pages/proxy), the desktop app falls back to the API on
// this machine, and the user can override both from the interface. The override
// is stored per browser profile, never in the repository.
export const API_ENDPOINT_STORAGE_KEY = 'sandkasten-api-base-url';

// The Go API listens on 127.0.0.1:8080 by default (SANDKASTEN_API_HTTP_ADDR).
export const LOCAL_API_BASE_URL = 'http://127.0.0.1:8080';

export interface ApiEndpointStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EffectiveApiBaseUrlOptions {
  configured?: string;
  bundled?: string;
  desktop?: boolean;
}

function browserStorage(): ApiEndpointStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// A base URL is an http(s) origin plus an optional path prefix. Nothing else is
// accepted: the value is interpolated into request URLs, so schemes such as
// `javascript:` must never survive normalization.
export function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new Error('the API base URL must not contain newline characters');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('the API base URL must be an absolute http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('the API base URL must use http or https');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname}`;
}

export function readConfiguredApiBaseUrl(storage: ApiEndpointStorage | undefined = browserStorage()): string {
  try {
    return normalizeApiBaseUrl(storage?.getItem(API_ENDPOINT_STORAGE_KEY) ?? '');
  } catch {
    // A malformed stored value must not break startup; it is simply ignored.
    return '';
  }
}

export function saveConfiguredApiBaseUrl(
  storage: ApiEndpointStorage | undefined,
  value: string | undefined,
): string {
  const normalized = normalizeApiBaseUrl(value ?? '');
  try {
    if (normalized === '') storage?.removeItem(API_ENDPOINT_STORAGE_KEY);
    else storage?.setItem(API_ENDPOINT_STORAGE_KEY, normalized);
  } catch {
    // Storage can be blocked; the in-memory value still applies for this session.
  }
  return normalized;
}

// Precedence: the user's explicit choice, then the deployment default compiled
// into `config.js`, then the local API when running inside the desktop app, and
// finally same-origin relative requests.
export function effectiveApiBaseUrl(options: EffectiveApiBaseUrlOptions = {}): string {
  const configured = tryNormalize(options.configured);
  if (configured) return configured;
  const bundled = tryNormalize(options.bundled);
  if (bundled) return bundled;
  return options.desktop ? LOCAL_API_BASE_URL : '';
}

function tryNormalize(value: unknown): string {
  try {
    return normalizeApiBaseUrl(value ?? '');
  } catch {
    return '';
  }
}
