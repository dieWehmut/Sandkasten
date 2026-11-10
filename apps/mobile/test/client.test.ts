import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { decodeOutput, normalizeAddress, RemoteClient, RemoteError } from '../src/client'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  CapacitorHttp: { request: vi.fn() },
}))
beforeEach(() => { vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('computer address', () => {
  it.each([
    ['192.168.1.20', 'http://192.168.1.20:8080'],
    ['localhost:80', 'http://localhost'],
    ['[::1]', 'http://[::1]:8080'],
    ['[::1]:80', 'http://[::1]'],
    ['https://host.example/', 'https://host.example'],
    ['http://host.example:9000/sandbox/', 'http://host.example:9000/sandbox'],
  ])('normalizes %s', (input, expected) => expect(normalizeAddress(input)).toBe(expected))
  it.each(['', 'file:///tmp', 'https://user:secret@host', 'http://host#token', 'http://host?token=x', 'http://host\n/path', 'host name', 'http://host:99999'])('rejects unsafe address %s', input => expect(() => normalizeAddress(input)).toThrow())
})

describe('Sandkasten HTTP protocol', () => {
  it('reads catalog, submits without waiting, polls all output fields, and cancels using real API routes', async () => {
    const runtime = { language: 'python', status: 'active', default_entrypoint: 'main.py', aliases: ['py'], version: '3.14' }
    const complete = { jobId: 'job /1', status: 'JOB_STATUS_SUCCEEDED', stdout: '你好\n', compileStderr: '', stdoutEncoding: 'utf8', durationMs: 8 }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ runtimes: [runtime] }))
      .mockResolvedValueOnce(json({ jobId: 'job /1', status: 'JOB_STATUS_QUEUED' }, 202))
      .mockResolvedValueOnce(json(complete))
      .mockResolvedValueOnce(json({ jobId: 'job /1', status: 'JOB_STATUS_CANCELED' }))
    vi.stubGlobal('fetch', fetcher)
    const client = new RemoteClient('https://computer/sandbox', 'secret')
    expect(await client.runtimes()).toEqual([runtime])
    const request = { language: 'python', source: 'print("你好")', stdin: 'test', args: ['a b'], files: [{ name: 'data.txt', content: 'data' }], runTimeoutMs: 12000 }
    expect(await client.submit(request)).toMatchObject({ jobId: 'job /1' })
    expect(await client.job('job /1')).toEqual(complete)
    expect(await client.cancel('job /1')).toMatchObject({ status: 'JOB_STATUS_CANCELED' })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://computer/sandbox/v1/runtimes', 'https://computer/sandbox/v1/run',
      'https://computer/sandbox/v1/jobs/job%20%2F1', 'https://computer/sandbox/v1/jobs/job%20%2F1/cancel',
    ])
    const options = fetcher.mock.calls[1]![1]
    expect(options.headers).toMatchObject({ Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer secret' })
    expect(JSON.parse(options.body)).toEqual({ ...request, wait: false })
    expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' })
    expect(fetcher.mock.calls[3]![1].method).toBe('POST')
    expect(fetcher.mock.calls.map(call => call[0]).join()).not.toContain('secret')
  })
  it('uses the native HTTP bridge with bounded timeouts and no redirect for bearer credentials', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 202, data: { jobId: 'native', status: 'JOB_STATUS_QUEUED' }, headers: {}, url: 'http://host:8080/v1/run' })
    expect(await new RemoteClient('host', 'native-secret').submit({ language: 'go', source: 'package main' })).toMatchObject({ jobId: 'native' })
    expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://host:8080/v1/run', method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer native-secret' }),
      data: { language: 'go', source: 'package main', wait: false }, connectTimeout: 10000, readTimeout: 20000, disableRedirects: true,
    }))
  })
  it('accepts an empty protobuf catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({})))
    expect(await new RemoteClient('host').runtimes()).toEqual([])
  })
  it('retains HTTP status and API error code even for authentication and plain text failures', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: 'unauthorized', message: 'invalid credentials' }, 401)).mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const client = new RemoteClient('host')
    await expect(client.runtimes()).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    await expect(client.runtimes()).rejects.toBeInstanceOf(RemoteError)
  })
  it('rejects unexpected HTML and malformed catalog entries', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('<html>proxy</html>')).mockResolvedValueOnce(json({ runtimes: [{}] })).mockResolvedValueOnce(json({ runtimes: [{ language: 'go', aliases: 'golang' }] }))
    vi.stubGlobal('fetch', fetcher)
    const client = new RemoteClient('host')
    await expect(client.runtimes()).rejects.toThrow('无法识别')
    await expect(client.runtimes()).rejects.toThrow('语言名称')
    await expect(client.runtimes()).rejects.toThrow('别名')
  })
  it('rejects missing job IDs and empty submissions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 'JOB_STATUS_QUEUED' })))
    const client = new RemoteClient('host')
    await expect(client.submit({ language: 'go', source: 'package main' })).rejects.toThrow('任务 ID')
    await expect(client.submit({ language: '', source: 'code' })).rejects.toThrow('运行时')
    await expect(client.submit({ language: 'go', source: ' ' })).rejects.toThrow('源代码')
    await expect(client.job('')).rejects.toThrow('任务 ID')
    await expect(client.cancel('')).rejects.toThrow('任务 ID')
  })
})

describe('encoded output', () => {
  it('decodes Unicode UTF-8 base64 while keeping raw output', () => {
    const raw = '5L2g5aW9Cg=='
    expect(decodeOutput(raw, 'base64')).toEqual({ text: '你好\n', raw, undecodable: false })
    expect(decodeOutput('hello', 'utf8').text).toBe('hello')
  })
  it.each(['/w==', 'broken-base64'])('retains undecodable content %s with a visible warning', raw => expect(decodeOutput(raw, 'base64')).toMatchObject({ text: raw, raw, undecodable: true, warning: expect.any(String) }))
  it('labels unknown encodings instead of treating them as text', () => expect(decodeOutput('raw', 'gzip')).toMatchObject({ undecodable: true, warning: expect.stringContaining('gzip') }))
})
