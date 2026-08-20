#!/usr/bin/env node
import { performance } from 'node:perf_hooks'

const apiUrl = (process.env.SANDKASTEN_HTTP_URL ||
  `http://${process.env.SANDKASTEN_HTTP_ADDR || '127.0.0.1:8080'}`).replace(/\/+$/, '')
const token = process.env.SANDKASTEN_API_TOKEN || process.env.VITE_CODE_RUNNER_API_TOKEN || ''
const jobCount = positiveInt(process.env.SANDKASTEN_CONCURRENCY_JOBS, 4)
const sleepSeconds = positiveNumber(process.env.SANDKASTEN_CONCURRENCY_SLEEP_SECONDS, 3)
const timeoutMs = positiveInt(process.env.SANDKASTEN_CONCURRENCY_TIMEOUT_MS, 30000)
const submitConcurrency = positiveInt(process.env.SANDKASTEN_CONCURRENCY_SUBMIT_CONCURRENCY, jobCount)

const activeStatuses = new Set([
  'JOB_STATUS_VALIDATING',
  'JOB_STATUS_COMPILING',
  'JOB_STATUS_RUNNING',
])
const terminalStatuses = new Set([
  'JOB_STATUS_SUCCEEDED',
  'JOB_STATUS_COMPILE_FAILED',
  'JOB_STATUS_RUNTIME_FAILED',
  'JOB_STATUS_TIME_LIMIT_EXCEEDED',
  'JOB_STATUS_MEMORY_LIMIT_EXCEEDED',
  'JOB_STATUS_OUTPUT_LIMIT_EXCEEDED',
  'JOB_STATUS_CANCELED',
  'JOB_STATUS_SYSTEM_ERROR',
])

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value || ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function headers() {
  const result = {
    'content-type': 'application/json',
  }
  if (token) result.authorization = `Bearer ${token}`
  return result
}

function sourceFor(index) {
  return [
    'set -eu',
    `printf 'start ${index}\\n'`,
    `sleep ${sleepSeconds}`,
    `printf 'done ${index}\\n'`,
    '',
  ].join('\n')
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
  }
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  return body
}

async function submitJob(index) {
  const body = {
    source: sourceFor(index),
    wait: false,
    runTimeoutMs: Math.ceil((sleepSeconds + 8) * 1000),
    maxOutputBytes: 65536,
  }
  const result = await requestJson('/v1/bash/run', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result.jobId) throw new Error(`submit ${index} did not return jobId: ${JSON.stringify(result)}`)
  return {
    index,
    jobId: result.jobId,
    status: result.status || 'JOB_STATUS_QUEUED',
    activeSeen: false,
    terminalSeen: false,
    stdout: '',
    errorMessage: '',
  }
}

async function submitAll() {
  const jobs = []
  let next = 1
  const workers = Array.from({ length: Math.min(submitConcurrency, jobCount) }, async () => {
    while (next <= jobCount) {
      const index = next
      next += 1
      jobs.push(await submitJob(index))
    }
  })
  await Promise.all(workers)
  return jobs.sort((a, b) => a.index - b.index)
}

async function pollJob(job) {
  const result = await requestJson(`/v1/jobs/${job.jobId}`)
  job.status = result.status || job.status
  job.stdout = result.stdout || ''
  job.errorMessage = result.errorMessage || ''
  if (activeStatuses.has(job.status)) job.activeSeen = true
  if (terminalStatuses.has(job.status)) job.terminalSeen = true
  return job
}

function assertSucceeded(jobs) {
  const failed = jobs.filter((job) => job.status !== 'JOB_STATUS_SUCCEEDED')
  if (failed.length) {
    const detail = failed.map((job) => `${job.index}:${job.status}:${job.errorMessage}`).join(', ')
    throw new Error(`jobs did not all succeed: ${detail}`)
  }

  for (const job of jobs) {
    if (!job.stdout.includes(`done ${job.index}`)) {
      throw new Error(`job ${job.index} stdout missing completion marker: ${JSON.stringify(job.stdout)}`)
    }
  }
}

const wallStart = performance.now()
const jobs = await submitAll()
const submittedMs = Math.round(performance.now() - wallStart)
let maxActiveObserved = 0
let polls = 0

while (true) {
  polls += 1
  await Promise.all(jobs.map(pollJob))
  const active = jobs.filter((job) => activeStatuses.has(job.status)).length
  maxActiveObserved = Math.max(maxActiveObserved, active)
  if (jobs.every((job) => terminalStatuses.has(job.status))) break

  const elapsedMs = performance.now() - wallStart
  if (elapsedMs > timeoutMs) {
    throw new Error(`timeout after ${Math.round(elapsedMs)} ms; statuses: ${jobs.map((job) => `${job.index}:${job.status}`).join(', ')}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 120))
}

const wallMs = performance.now() - wallStart
assertSucceeded(jobs)

const sequentialLowerBoundMs = sleepSeconds * 1000 * jobCount
const concurrencyThresholdMs = sequentialLowerBoundMs * 0.8
if (jobCount > 1 && wallMs >= concurrencyThresholdMs) {
  throw new Error(`jobs look serialized: wall ${Math.round(wallMs)} ms, sequential lower bound ${Math.round(sequentialLowerBoundMs)} ms`)
}
if (jobCount > 1 && maxActiveObserved < 2) {
  throw new Error(`did not observe overlapping active jobs; max active observed ${maxActiveObserved}`)
}

console.log(JSON.stringify({
  ok: true,
  jobs: jobs.length,
  submittedMs,
  wallMs: Math.round(wallMs),
  sequentialLowerBoundMs: Math.round(sequentialLowerBoundMs),
  maxActiveObserved,
  polls,
}))
