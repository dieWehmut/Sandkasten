import { computed, onScopeDispose, ref } from 'vue';
import { credentials } from '../credentials';
import { RemoteClient, RemoteError, normalizeAddress, type Runtime, type Job } from '../client';
import { isTerminal } from '../presentation';
import type { Project } from '../projects';

export interface SavedDevice { address: string; name: string }
export interface JobRecord extends Job { projectId: string; projectName: string; submittedAt: number }
export const credentialKey = (address: string) => `sandkasten.token:${address}`;
// Serialize credential reads/writes for an address across replacement controllers.
// A late save must finish before a forget deletes it, and a new connection must
// read after that deletion rather than resurrecting the old token.
const credentialOperations = new Map<string, Promise<unknown>>();
function credentialOperation<T>(address: string, work: () => Promise<T>): Promise<T> {
  const previous = credentialOperations.get(address) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(work);
  credentialOperations.set(address, operation);
  void operation.finally(() => { if (credentialOperations.get(address) === operation) credentialOperations.delete(address); }).catch(() => {});
  return operation;
}
export function readDevices(): SavedDevice[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('sandkasten.devices') ?? '[]');
    if (Array.isArray(data)) return data.flatMap((d) => {
      if (!d || typeof d.address !== 'string' || typeof d.name !== 'string') return [];
      try { return [{ address: normalizeAddress(d.address), name: d.name }]; } catch { return []; }
    });
  } catch {}
  return [];
}
export function saveDevices(devices: SavedDevice[]) {
  localStorage.setItem('sandkasten.devices', JSON.stringify(devices));
}
export function useRemoteControl(device: SavedDevice) {
  const connectionStatus = ref<'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'needs_token'>('disconnected');
  const runtimes = ref<Runtime[]>([]), jobs = ref<JobRecord[]>([]), actionError = ref(''), pollError = ref('');
  const pending = ref(0), busy = computed(() => pending.value > 0), error = computed(() => actionError.value || pollError.value);
  let client: RemoteClient | null = null, timer: ReturnType<typeof setTimeout> | undefined, generation = 0, pollingGeneration: number | null = null, disposed = false;
  const jobVersions = new Map<string, number>();
  const settlingReads = new Map<string, number>(), settlingStarted = new Set<string>();
  // A terminal history record still needs its first authoritative output read.
  // Keep interrupted reads separate from artifact readiness and retry each ID.
  const retryReads = new Set<string>();
  const historyKey = `sandkasten.jobs:${device.address}`;
  try {
    const data: unknown = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
    if (Array.isArray(data)) jobs.value = data.filter((j) => typeof j?.jobId === 'string' && typeof j?.status === 'string' && typeof j?.projectId === 'string');
  } catch {}
  // Keep only IDs and display metadata; output is fetched again from the computer.
  function persist() {
    try { localStorage.setItem(historyKey, JSON.stringify(jobs.value.map(({ jobId, status, projectId, projectName, language, submittedAt }) => ({ jobId, status, projectId, projectName, language, submittedAt })))); } catch { actionError.value = '手机无法保存任务记录，请检查存储空间'; }
  }
  function apply(job: Job) {
    const old = jobs.value.find((j) => j.jobId === job.jobId);
    if (old) jobs.value = jobs.value.map((j) => j.jobId === job.jobId ? { ...j, ...job } : j);
  }
  // New servers explicitly report artifact readiness. Older servers acknowledge
  // cancellation before saving artifacts; allow six successful empty reads there.
  // Network errors do not spend reads, so an outage can still recover output.
  function settle(job: Job, successfulRead = false) {
    if (!isTerminal(job.status)) { settlingReads.delete(job.jobId); return; }
    if (job.outputReady === true) { settlingReads.delete(job.jobId); settlingStarted.add(job.jobId); return; }
    if (job.outputReady === false) { settlingReads.set(job.jobId, Infinity); settlingStarted.add(job.jobId); return; }
    if (job.status !== 'JOB_STATUS_CANCELED') { settlingReads.delete(job.jobId); return; }
    if (job.durationMs || job.signal || job.stdout || job.stderr || job.compileStdout || job.compileStderr) {
      settlingReads.delete(job.jobId); settlingStarted.add(job.jobId); return;
    }
    if (!settlingStarted.has(job.jobId) || settlingReads.get(job.jobId) === Infinity) { settlingStarted.add(job.jobId); settlingReads.set(job.jobId, 6); }
    if (successfulRead && settlingReads.has(job.jobId)) {
      const remaining = settlingReads.get(job.jobId)! - 1;
      if (remaining > 0) settlingReads.set(job.jobId, remaining); else settlingReads.delete(job.jobId);
    }
  }
  function failure(cause: unknown, target = actionError) {
    target.value = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof RemoteError && cause.status === 401) { connectionStatus.value = 'needs_token'; clearTimeout(timer); }
  }
  async function action<T>(work: () => Promise<T>): Promise<T | undefined> {
    const version = generation;
    pending.value++; actionError.value = '';
    try { return await work(); } catch (cause) { if (!disposed && version === generation) failure(cause); return undefined; } finally { pending.value--; }
  }
  function schedule() {
    clearTimeout(timer);
    if (!disposed && client && connectionStatus.value !== 'needs_token' && jobs.value.some((j) => !isTerminal(j.status) || settlingReads.has(j.jobId) || retryReads.has(j.jobId))) timer = setTimeout(() => void refresh(false), 1000);
  }
  async function refresh(all = true) {
    const current = client, version = generation;
    if (!current || pollingGeneration === version || disposed || connectionStatus.value === 'needs_token') return;
    pollingGeneration = version;
    let failed = false;
    try {
      for (const job of jobs.value.filter((j) => all || !isTerminal(j.status) || settlingReads.has(j.jobId) || retryReads.has(j.jobId))) {
        const jobVersion = jobVersions.get(job.jobId) ?? 0;
        try {
          const updated = await current.job(job.jobId);
          if (disposed || version !== generation) return;
          if (jobVersion === (jobVersions.get(job.jobId) ?? 0)) { retryReads.delete(job.jobId); apply(updated); settle(updated, true); }
        } catch (cause) {
          if (disposed || version !== generation) return;
          if (jobVersion !== (jobVersions.get(job.jobId) ?? 0)) continue;
          if (cause instanceof RemoteError && cause.status === 404) { retryReads.delete(job.jobId); settlingReads.delete(job.jobId); apply({ jobId: job.jobId, status: 'JOB_STATUS_SYSTEM_ERROR', errorMessage: cause.message }); }
          else { retryReads.add(job.jobId); failed = true; failure(cause, pollError); }
        }
      }
      if (!failed) { pollError.value = ''; connectionStatus.value = 'connected'; }
      else if (String(connectionStatus.value) !== 'needs_token') connectionStatus.value = 'reconnecting';
      persist();
    } finally { if (pollingGeneration === version) pollingGeneration = null; if (version === generation) schedule(); }
  }
  async function connect(token?: string) {
    const version = ++generation;
    clearTimeout(timer); client = null; actionError.value = ''; pollError.value = ''; connectionStatus.value = 'connecting';
    pending.value++;
    try {
      const saved = token ?? (await credentialOperation(device.address, () => credentials.get({ key: credentialKey(device.address) }))).value ?? '';
      if (disposed || version !== generation) return false;
      const next = new RemoteClient(device.address, saved);
      const catalog = await next.runtimes();
      if (disposed || version !== generation) return false;
      if (token !== undefined) {
        await credentialOperation(device.address, async () => {
          if (disposed || version !== generation) return;
          if (token) await credentials.set({ key: credentialKey(device.address), value: token });
          else await credentials.remove({ key: credentialKey(device.address) });
        });
        if (disposed || version !== generation) return false;
      }
      client = next; runtimes.value = catalog; connectionStatus.value = 'connected';
      await refresh();
      return !disposed && version === generation;
    } catch (cause) {
      if (!disposed && version === generation) { failure(cause); if (String(connectionStatus.value) !== 'needs_token') connectionStatus.value = 'disconnected'; }
      return false;
    } finally { pending.value--; }
  }
  async function submit(project: Project) {
    return action(async () => {
      const submitted: Project = JSON.parse(JSON.stringify(project));
      const current = client;
      if (!current || !['connected', 'reconnecting'].includes(connectionStatus.value)) throw new Error('请先连接电脑');
      const runtime = runtimes.value.find((r) => r.language === submitted.language);
      if (!runtime || (runtime.status && !['ready', 'active'].includes(runtime.status))) throw new Error('电脑没有可用的所选运行时');
      if (!submitted.source.trim()) throw new Error('请输入源代码');
      const args: unknown = JSON.parse(submitted.args || '[]');
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('运行参数必须是 JSON 字符串数组');
      const job = await current.submit({ language: submitted.language, source: submitted.source, entrypoint: submitted.entrypoint || runtime.default_entrypoint || undefined, stdin: submitted.stdin, args, files: submitted.files, runTimeoutMs: submitted.runTimeoutMs || undefined });
      // The address is immutable: a successful response still belongs to this
      // computer after re-authentication. Keep its ID so it remains stoppable.
      if (disposed) return undefined;
      const record: JobRecord = { ...job, projectId: submitted.id, projectName: submitted.name, language: submitted.language, submittedAt: Date.now() };
      jobs.value = [record, ...jobs.value]; settle(record); persist(); schedule();
      return record;
    });
  }
  async function cancel(jobId: string) {
    return action(async () => {
      const current = client, version = generation;
      if (!current) throw new Error('请先连接电脑');
      jobVersions.set(jobId, (jobVersions.get(jobId) ?? 0) + 1);
      const result = await current.cancel(jobId);
      if (disposed || version !== generation) return;
      jobVersions.set(jobId, (jobVersions.get(jobId) ?? 0) + 1);
      apply(result); settle(result); persist();
      try {
        const final = await current.job(jobId);
        if (disposed || version !== generation) return;
        retryReads.delete(jobId); apply(final); settle(final, true); pollError.value = ''; persist();
      } catch (cause) {
        if (disposed || version !== generation) return;
        if (cause instanceof RemoteError && cause.status === 404) { retryReads.delete(jobId); settlingReads.delete(jobId); apply({ jobId, status: 'JOB_STATUS_SYSTEM_ERROR', errorMessage: cause.message }); persist(); }
        else { retryReads.add(jobId); failure(cause, pollError); }
      } finally { if (!disposed && version === generation) schedule(); }
    });
  }
  function remove(jobId: string) {
    const job = jobs.value.find((j) => j.jobId === jobId);
    if (job && isTerminal(job.status)) { retryReads.delete(jobId); settlingReads.delete(jobId); jobs.value = jobs.value.filter((j) => j.jobId !== jobId); persist(); }
  }
  async function forget() {
    dispose();
    await credentialOperation(device.address, () => credentials.remove({ key: credentialKey(device.address) }));
    localStorage.removeItem(historyKey);
  }
  function dispose() { disposed = true; generation++; clearTimeout(timer); retryReads.clear(); client = null; }
  onScopeDispose(dispose);
  return { connectionStatus, runtimes, jobs, busy, error, actionError, connect, refresh, submit, cancel, remove, forget };
}
