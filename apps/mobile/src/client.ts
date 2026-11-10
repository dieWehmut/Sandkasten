import { Capacitor, CapacitorHttp } from '@capacitor/core'

// The runtime catalog uses protobuf's snake_case fields; jobs use the HTTP
// API's camelCase DTO. Keep those contracts separate from mobile UI labels.
export interface RuntimeLimits {
  compile_timeout_ms?: number
  run_timeout_ms?: number
  memory_limit_bytes?: number
  cpu_millis?: number
  output_bytes?: number
  archive_bytes?: number
  stdin_bytes?: number
  args?: number
  arg_bytes?: number
}
export interface Runtime {
  language: string
  version?: string
  image?: string
  status?: string
  aliases?: string[]
  default_entrypoint?: string
  requires_vendor?: boolean
  compile_phase?: { command?: string[]; enabled?: boolean }
  run_phase?: { command?: string[]; enabled?: boolean }
  default_limits?: RuntimeLimits
  max_limits?: RuntimeLimits
}
export interface Job {
  jobId: string
  status: string
  outputReady?: boolean
  language?: string
  runtime?: string
  stdout?: string
  stderr?: string
  compileStdout?: string
  compileStderr?: string
  stdoutEncoding?: string
  stderrEncoding?: string
  compileStdoutEncoding?: string
  compileStderrEncoding?: string
  exitCode?: number
  signal?: number
  durationMs?: number
  errorMessage?: string
  truncated?: { stdout?: boolean; stderr?: boolean }
  diagnostics?: {
    memoryPeakBytes?: number
    memoryOomKillCount?: number
    cpuUsageUsec?: number
    cpuThrottledUsec?: number
    pidsPeak?: number
  }
}
export interface RunRequest {
  language: string
  source: string
  entrypoint?: string
  stdin?: string
  args?: string[]
  files?: { name: string; content: string; encoding?: 'utf8' | 'base64' }[]
  compileTimeoutMs?: number
  runTimeoutMs?: number
  memoryLimitBytes?: number
  cpuMillis?: number
  maxOutputBytes?: number
}

export function normalizeAddress(input: string): string {
  const value = input.trim()
  if (!value || /\s/.test(value)) throw new Error('请输入电脑 IP 或 HTTP(S) 地址')
  const explicitScheme = value.includes('://')
  let url: URL
  try { url = new URL(explicitScheme ? value : `http://${value}`) }
  catch { throw new Error('电脑地址无效，请检查 IP、主机名和端口') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTP(S) 地址，不要包含账号、查询参数或片段')
  }
  const authority = value.split('/')[0] ?? ''
  // URL.port removes an explicit :80. Inspect the supplied authority so that
  // :80 is not silently replaced by Sandkasten's default HTTP API port.
  const explicitPort = /^(?:\[[^\]]+\]|[^:]+):\d+$/.test(authority)
  if (!explicitScheme && !explicitPort && !url.port) url.port = '8080'
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export class RemoteError extends Error {
  constructor(readonly status: number, message: string, readonly code = '') {
    super(message)
    this.name = 'RemoteError'
  }
}

function object(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`电脑返回了无法识别的${description}，请检查地址和服务端口`)
  }
  return value as Record<string, unknown>
}
function job(value: unknown): Job {
  const result = object(value, '任务响应')
  if (typeof result.jobId !== 'string' || !result.jobId.trim() || typeof result.status !== 'string' || !result.status.trim()) {
    throw new Error('任务响应缺少任务 ID 或状态')
  }
  if (result.outputReady !== undefined && typeof result.outputReady !== 'boolean') throw new Error('任务输出就绪标志格式无效')
  return result as unknown as Job
}

export class RemoteClient {
  readonly address: string
  constructor(address: string, private readonly token = '') {
    this.address = normalizeAddress(address)
  }
  private async request(path: string, method = 'GET', data?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (data !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    const url = `${this.address}${path}`
    let status: number, body: unknown
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url, method, headers, data, responseType: 'json',
        connectTimeout: 10000, readTimeout: 20000, disableRedirects: true,
      })
      status = response.status
      body = response.data
    } else {
      const response = await fetch(url, {
        method, headers,
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: AbortSignal.timeout(20000), redirect: 'error', credentials: 'omit',
      })
      status = response.status
      body = await response.text()
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body) }
      catch { /* Preserve plain-text error status and reject HTML successes below. */ }
    }
    if (status < 200 || status >= 300) {
      const detail = body && typeof body === 'object' ? body as Record<string, unknown> : {}
      const code = typeof detail.error === 'string' ? detail.error : ''
      let message = typeof detail.message === 'string' ? detail.message : `请求失败 (${status})，请检查电脑服务`
      if (status === 401) message = '访问令牌无效或已更改，请更新电脑的访问令牌'
      else if (status === 404 && path.startsWith('/v1/jobs/')) message = '电脑上已找不到该任务，请检查设备或任务 ID'
      throw new RemoteError(status, message, code)
    }
    return body
  }
  async runtimes(): Promise<Runtime[]> {
    const response = object(await this.request('/v1/runtimes'), '运行时响应')
    // encoding/json omits an empty repeated protobuf field.
    const runtimes = response.runtimes ?? []
    if (!Array.isArray(runtimes)) throw new Error('运行时响应缺少运行时列表')
    return runtimes.map((item) => {
      const runtime = object(item, '运行时')
      if (typeof runtime.language !== 'string' || !runtime.language.trim()) throw new Error('运行时缺少语言名称')
      if (runtime.aliases !== undefined && (!Array.isArray(runtime.aliases) || runtime.aliases.some(alias => typeof alias !== 'string'))) {
        throw new Error('运行时别名格式无效')
      }
      return runtime as unknown as Runtime
    })
  }
  async submit(request: RunRequest): Promise<Job> {
    if (!request.language.trim()) throw new Error('请选择运行时')
    if (!request.source.trim()) throw new Error('请输入源代码')
    return job(await this.request('/v1/run', 'POST', { ...request, wait: false }))
  }
  async job(id: string): Promise<Job> {
    if (!id.trim()) throw new Error('请输入任务 ID')
    return job(await this.request(`/v1/jobs/${encodeURIComponent(id)}`))
  }
  async cancel(id: string): Promise<Job> {
    if (!id.trim()) throw new Error('请输入任务 ID')
    return job(await this.request(`/v1/jobs/${encodeURIComponent(id)}/cancel`, 'POST'))
  }
}

export interface DecodedOutput { text: string; raw: string; warning?: string; undecodable: boolean }
export function decodeOutput(value?: string | null, encoding?: string | null): DecodedOutput {
  const raw = value ?? ''
  if (!encoding || ['utf8', 'utf-8', 'text', 'auto'].includes(encoding.toLowerCase())) return { text: raw, raw, undecodable: false }
  if (encoding.toLowerCase() !== 'base64') return { text: raw, raw, warning: `未知输出编码：${encoding}`, undecodable: true }
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error('Invalid base64')
    const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0))
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), raw, undecodable: false }
  } catch {
    return { text: raw, raw, warning: '输出是二进制或无法解码的内容，以下保留 Base64 原文', undecodable: true }
  }
}
