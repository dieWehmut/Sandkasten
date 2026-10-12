import { computed, readonly, ref, type ComputedRef, type DeepReadonly, type Ref } from 'vue';
import type { JobResponse } from '../services/sandkastenApi';
import { desktopBridge, type DesktopBridge, type IsolationStatus, type LocalRuntimeInfo } from '../services/desktopBridge';
import { useRunHistory, type RunHistory } from './useRunHistory';

// Local execution runs the active workspace file with the toolchains installed
// on this machine. It is only reachable from the Electron desktop build, which
// owns the workspace folder, and it is deliberately unsandboxed: the UI labels
// it as a local run.
export type LocalRunnerPhase = 'unavailable' | 'ready' | 'running' | 'completed' | 'error';

export interface LocalRunRequest {
  path: string;
  language: string;
  source: string;
  timeoutMs?: number;
}

export interface LocalRunnerDependencies {
  bridge?: DesktopBridge;
  history?: RunHistory;
}

export interface LocalRunnerController {
  available: ComputedRef<boolean>;
  phase: DeepReadonly<Ref<LocalRunnerPhase>>;
  runtimes: DeepReadonly<Ref<LocalRuntimeInfo[]>>;
  result: DeepReadonly<Ref<JobResponse | undefined>>;
  error: DeepReadonly<Ref<string | undefined>>;
  activeJobId: DeepReadonly<Ref<string | undefined>>;
  isolation: DeepReadonly<Ref<IsolationStatus>>;
  load(): Promise<void>;
  run(request: LocalRunRequest): Promise<void>;
  runIsolated(request: LocalRunRequest): Promise<void>;
  stop(): Promise<void>;
  supports(language: string): boolean;
  supportsIsolated(language: string): boolean;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newJobId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useLocalRunner(dependencies: LocalRunnerDependencies = {}): LocalRunnerController {
  const bridge = dependencies.bridge ?? desktopBridge();
  const history = dependencies.history ?? useRunHistory(20);
  const phase = ref<LocalRunnerPhase>(bridge ? 'ready' : 'unavailable');
  const runtimes = ref<LocalRuntimeInfo[]>([]);
  const result = ref<JobResponse>();
  const error = ref<string>();
  const activeJobId = ref<string>();
  // Which bridge the active job belongs to, so `stop` cancels the same one.
  let activeBackend: 'local' | 'isolated' = 'local';
  const available = computed(() => bridge !== undefined);
  const isolation = ref<IsolationStatus>({ available: false, distro: '', pidIsolated: false, networkBlocked: false, languages: {} });

  let generation = 0;

  function supports(language: string): boolean {
    if (!language) return false;
    return runtimes.value.some((runtime) => runtime.language === language && runtime.available);
  }

  // An isolated run needs the namespace sandbox to be usable *and* every binary
  // that language needs to exist inside the distro, which the detection reports
  // per language.
  function supportsIsolated(language: string): boolean {
    if (!language || !isolation.value.available) return false;
    return isolation.value.languages?.[language] === true;
  }

  async function load(): Promise<void> {
    if (!bridge) {
      phase.value = 'unavailable';
      return;
    }
    phase.value = 'ready';
    try {
      runtimes.value = await bridge.runner.detect();
    } catch (cause) {
      error.value = messageFrom(cause);
      phase.value = 'error';
    }
    try {
      isolation.value = bridge.isolated
        ? await bridge.isolated.detect()
        : { available: false, distro: '', pidIsolated: false, networkBlocked: false, languages: {} };
    } catch {
      isolation.value = { available: false, distro: '', pidIsolated: false, networkBlocked: false, languages: {} };
    }
  }

  async function run(request: LocalRunRequest): Promise<void> {
    if (!bridge) {
      error.value = 'Local execution is available in the desktop app.';
      phase.value = 'unavailable';
      return;
    }
    const owner = ++generation;
    const startedAt = new Date().toISOString();
    const jobId = newJobId();
    activeBackend = 'local';
    activeJobId.value = jobId;
    result.value = undefined;
    error.value = undefined;
    phase.value = 'running';
    try {
      const output = await bridge.runner.run({
        jobId,
        path: request.path,
        language: request.language,
        timeoutMs: request.timeoutMs,
      });
      if (owner !== generation) return;
      const completed = output as unknown as JobResponse;
      result.value = completed;
      activeJobId.value = undefined;
      phase.value = completed.status === 'JOB_STATUS_SUCCEEDED' ? 'completed' : 'error';
      if (completed.errorMessage) error.value = completed.errorMessage;
      history.add({
        source: request.source,
        language: completed.language || request.language,
        jobId: completed.jobId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: completed.status,
        result: completed,
      });
    } catch (cause) {
      if (owner !== generation) return;
      activeJobId.value = undefined;
      error.value = messageFrom(cause);
      phase.value = 'error';
    }
  }

  // The isolated backend reuses this controller's phase, history, and result
  // bookkeeping so the shell renders it exactly like a local run, while the
  // payload itself executes inside the WSL2 namespaces.
  async function runIsolated(request: LocalRunRequest): Promise<void> {
    if (!bridge?.isolated) {
      error.value = 'Isolated execution is available in the desktop app.';
      phase.value = 'unavailable';
      return;
    }
    if (!isolation.value.available) {
      error.value = 'Isolated execution needs WSL2 with a distro that ships unshare.';
      phase.value = 'error';
      return;
    }
    if (!supportsIsolated(request.language)) {
      error.value = `This distro cannot run ${request.language || 'that runtime'} in isolation.`;
      phase.value = 'error';
      return;
    }
    const owner = ++generation;
    const startedAt = new Date().toISOString();
    const jobId = newJobId();
    activeBackend = 'isolated';
    activeJobId.value = jobId;
    result.value = undefined;
    error.value = undefined;
    phase.value = 'running';
    try {
      const output = await bridge.isolated.run({
        jobId,
        path: request.path,
        language: request.language,
        timeoutMs: request.timeoutMs,
      });
      if (owner !== generation) return;
      const completed = output as unknown as JobResponse;
      result.value = completed;
      activeJobId.value = undefined;
      phase.value = completed.status === 'JOB_STATUS_SUCCEEDED' ? 'completed' : 'error';
      if (completed.errorMessage) error.value = completed.errorMessage;
      history.add({
        source: request.source,
        language: completed.language || request.language,
        jobId: completed.jobId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: completed.status,
        result: completed,
      });
    } catch (cause) {
      if (owner !== generation) return;
      activeJobId.value = undefined;
      error.value = messageFrom(cause);
      phase.value = 'error';
    }
  }

  async function stop(): Promise<void> {
    const jobId = activeJobId.value;
    if (!bridge || !jobId) return;
    try {
      if (activeBackend === 'isolated') await bridge.isolated?.stop(jobId);
      else await bridge.runner.stop(jobId);
    } catch (cause) {
      error.value = messageFrom(cause);
    }
  }

  return {
    available,
    phase: readonly(phase),
    runtimes: readonly(runtimes),
    result: readonly(result),
    error: readonly(error),
    activeJobId: readonly(activeJobId),
    isolation: readonly(isolation),
    load,
    run,
    runIsolated,
    stop,
    supports,
    supportsIsolated,
  };
}
