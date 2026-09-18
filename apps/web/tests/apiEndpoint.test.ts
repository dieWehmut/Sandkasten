import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  API_ENDPOINT_STORAGE_KEY,
  LOCAL_API_BASE_URL,
  effectiveApiBaseUrl,
  normalizeApiBaseUrl,
  readConfiguredApiBaseUrl,
  saveConfiguredApiBaseUrl,
} from '../src/services/apiEndpoint';
import { apiBaseUrlFor, resolveApiUrl } from '../src/services/sandkastenApi';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('API endpoint configuration', () => {
  test('keeps a stable storage key and the local default', () => {
    expect(API_ENDPOINT_STORAGE_KEY).toBe('sandkasten-api-base-url');
    expect(LOCAL_API_BASE_URL).toBe('http://127.0.0.1:8080');
  });

  test('normalizes user input into a bare origin with a path prefix', () => {
    expect(normalizeApiBaseUrl('  https://run.example.com/  ')).toBe('https://run.example.com');
    expect(normalizeApiBaseUrl('http://127.0.0.1:8080///')).toBe('http://127.0.0.1:8080');
    expect(normalizeApiBaseUrl('https://example.com/api')).toBe('https://example.com/api');
    expect(normalizeApiBaseUrl('')).toBe('');
    expect(normalizeApiBaseUrl('   ')).toBe('');
  });

  test('rejects values that cannot be a base URL', () => {
    expect(() => normalizeApiBaseUrl('ftp://example.com')).toThrow(/http/i);
    expect(() => normalizeApiBaseUrl('javascript:alert(1)')).toThrow(/http/i);
    expect(() => normalizeApiBaseUrl('https://example.com\n/api')).toThrow(/newline/i);
    expect(() => normalizeApiBaseUrl('not a url')).toThrow(/http/i);
  });

  test('reads a stored override and ignores malformed or unknown values', () => {
    expect(readConfiguredApiBaseUrl(memoryStorage({ [API_ENDPOINT_STORAGE_KEY]: 'https://run.example.com/' })))
      .toBe('https://run.example.com');
    expect(readConfiguredApiBaseUrl(memoryStorage({ [API_ENDPOINT_STORAGE_KEY]: 'garbage' }))).toBe('');
    expect(readConfiguredApiBaseUrl(memoryStorage())).toBe('');
    expect(readConfiguredApiBaseUrl(undefined)).toBe('');
  });

  test('persists an override and clears it back to the default', () => {
    const storage = memoryStorage();
    saveConfiguredApiBaseUrl(storage, ' https://run.example.com/ ');
    expect(storage.data.get(API_ENDPOINT_STORAGE_KEY)).toBe('https://run.example.com');

    saveConfiguredApiBaseUrl(storage, '');
    expect(storage.data.has(API_ENDPOINT_STORAGE_KEY)).toBe(false);
  });

  test('surfaces storage failures instead of throwing into the caller', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    };
    expect(readConfiguredApiBaseUrl(storage)).toBe('');
    expect(() => saveConfiguredApiBaseUrl(storage, 'https://run.example.com')).not.toThrow();
  });

  test('prefers an explicit user override over the bundled config default', () => {
    expect(effectiveApiBaseUrl({ configured: 'https://user.example.com' })).toBe('https://user.example.com');
  });

  test('falls back to the bundled config value when the user has not chosen one', () => {
    expect(effectiveApiBaseUrl({ bundled: 'https://pages.example.com' })).toBe('https://pages.example.com');
    expect(effectiveApiBaseUrl({ bundled: 'https://pages.example.com/' })).toBe('https://pages.example.com');
  });

  test('offers the local API by default in the desktop app', () => {
    expect(effectiveApiBaseUrl({ desktop: true })).toBe(LOCAL_API_BASE_URL);
  });

  test('keeps same-origin browser behaviour when nothing is configured', () => {
    expect(effectiveApiBaseUrl({})).toBe('');
  });

  test('lets an explicit override win over the desktop local default', () => {
    expect(effectiveApiBaseUrl({ desktop: true, configured: 'https://team.example.com' })).toBe('https://team.example.com');
    expect(effectiveApiBaseUrl({ desktop: true, bundled: 'https://pages.example.com' })).toBe('https://pages.example.com');
  });

  test('routes API requests through the stored override', () => {
    window.localStorage.setItem(API_ENDPOINT_STORAGE_KEY, 'https://run.example.com/');
    expect(apiBaseUrlFor(undefined)).toBe('https://run.example.com');
    expect(resolveApiUrl('/v1/runtimes')).toBe('https://run.example.com/v1/runtimes');
  });

  test('ignores a malformed stored override and keeps the bundled default', () => {
    window.localStorage.setItem(API_ENDPOINT_STORAGE_KEY, 'not-a-url');
    expect(apiBaseUrlFor({ apiBaseUrl: 'https://pages.example.com' })).toBe('https://pages.example.com');
    expect(resolveApiUrl('/v1/runtimes', { apiBaseUrl: 'https://pages.example.com' })).toBe('https://pages.example.com/v1/runtimes');
  });
});
