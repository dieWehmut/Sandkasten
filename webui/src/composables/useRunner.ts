import { readonly, ref, type DeepReadonly } from 'vue';
import {
  loadRuntimes as loadRuntimesRequest,
  pollJob as pollJobRequest,
  submitJob as submitJobRequest,
  type JobResponse,
  type Runtime,
} from '../services/sandkastenApi';
import { isTerminalStatus } from '../state/status';
import { useRunHistory, type RunHistoryItem } from './useRunHistory';

export type RunnerPhase = 'booting' | 'ready' | 'submitting' | 'polling' | 'stopped' | 'completed' | 'error';
export type OutputTab = 'output' | 'errors' | 'compile' | 'diagnostics';
export type ConnectionState = 'connecting' | 'connected' | 'unavailable';

type LoadRuntimes = typeof loadRuntimesRequest;
type SubmitJob = typeof submitJobRequest;
type PollJob = typeof pollJobRequest;

export interface RunnerDependencies {
  loadRuntimes?: LoadRuntimes;
  submitJob?: SubmitJob;
  pollJob?: PollJob;
}

interface ActiveRun {
  generation: number;
  language: string;
  source: string;
  jobId?: string;
  startedAt: string;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

export function useRunner(dependencies: RunnerDependencies = {}) {
  const loadRuntimes = dependencies.loadRuntimes ?? loadRuntimesRequest;
  const submitJob = dependencies.submitJob ?? submitJobRequest;
  const pollJob = dependencies.pollJob ?? pollJobRequest;
  const runHistory = useRunHistory(20);

  const phase = ref<RunnerPhase>('booting');
  const runtimes = ref<Runtime[]>([]);
  const selectedLanguage = ref('');
  const source = ref('');
  const currentJob = ref<JobResponse>();
  const result = ref<JobResponse>();
  const error = ref<string>();
  const pollingStopped = ref(false);
  const activeOutputTab = ref<OutputTab>('output');
  const connectionState = ref<ConnectionState>('connecting');

  let generation = 0;
  let activeRun: ActiveRun | undefined;
  let pollingController: AbortController | undefined;
  let lastTerminalResult: JobResponse | undefined;
  let selectedHistoryJobId: string | undefined;

  function isCurrent(owner: ActiveRun): boolean {
    return owner.generation === generation && activeRun === owner;
  }

  function isLiveView(owner: ActiveRun): boolean {
    return !selectedHistoryJobId || selectedHistoryJobId === owner.jobId;
  }

  function recordCompletion(owner: ActiveRun, completed: JobResponse) {
    runHistory.add({
      source: owner.source,
      language: owner.language,
      jobId: completed.jobId,
      startedAt: owner.startedAt,
      completedAt: new Date().toISOString(),
      status: completed.status,
      result: completed,
    });
  }

  function finish(owner: ActiveRun, completed: JobResponse) {
    if (!isCurrent(owner)) return;
    currentJob.value = completed;
    if (isLiveView(owner)) result.value = completed;
    lastTerminalResult = completed;
    phase.value = 'completed';
    pollingStopped.value = false;
    error.value = undefined;
    recordCompletion(owner, completed);
  }

  async function monitor(owner: ActiveRun): Promise<void> {
    if (!owner.jobId || !isCurrent(owner)) return;
    pollingController?.abort();
    const controller = new AbortController();
    pollingController = controller;
    pollingStopped.value = false;
    phase.value = 'polling';
    try {
      const completed = await pollJob(owner.jobId, {
        signal: controller.signal,
        onUpdate(job) {
          if (!isCurrent(owner) || pollingController !== controller) return;
          currentJob.value = job;
          if (isLiveView(owner)) result.value = job;
        },
      });
      if (pollingController !== controller) return;
      finish(owner, completed);
    } catch (cause) {
      // A Stop/Resume pair can overlap briefly: an old aborted poll must not
      // write an error into the state owned by the newer controller.
      if (!isCurrent(owner) || pollingController !== controller) return;
      if (isAbortError(cause) && pollingStopped.value) {
        phase.value = 'stopped';
        return;
      }
      if (isLiveView(owner)) result.value = lastTerminalResult ?? result.value;
      error.value = messageFrom(cause);
      phase.value = 'error';
    } finally {
      if (isCurrent(owner) && pollingController === controller) pollingController = undefined;
    }
  }

  async function load(): Promise<void> {
    const loadGeneration = ++generation;
    pollingController?.abort();
    activeRun = undefined;
    selectedHistoryJobId = undefined;
    phase.value = 'booting';
    connectionState.value = 'connecting';
    error.value = undefined;
    try {
      const loaded = await loadRuntimes();
      if (loadGeneration !== generation) return;
      runtimes.value = loaded;
      if (!selectedLanguage.value || !loaded.some((runtime) => runtime.language === selectedLanguage.value)) {
        selectedLanguage.value = loaded[0]?.language ?? '';
      }
      connectionState.value = 'connected';
      phase.value = 'ready';
    } catch (cause) {
      if (loadGeneration !== generation) return;
      connectionState.value = 'unavailable';
      error.value = messageFrom(cause);
      phase.value = 'error';
    }
  }

  async function submit(): Promise<void> {
    const owner: ActiveRun = {
      generation: ++generation,
      language: selectedLanguage.value,
      source: source.value,
      startedAt: new Date().toISOString(),
    };
    pollingController?.abort();
    pollingController = undefined;
    activeRun = owner;
    selectedHistoryJobId = undefined;
    currentJob.value = undefined;
    result.value = undefined;
    error.value = undefined;
    pollingStopped.value = false;
    phase.value = 'submitting';
    try {
      const submitted = await submitJob(owner.language, owner.source);
      if (!isCurrent(owner)) return;
      owner.jobId = submitted.jobId;
      currentJob.value = submitted;
      if (isLiveView(owner)) result.value = submitted;
      if (isTerminalStatus(submitted.status)) finish(owner, submitted);
      else await monitor(owner);
    } catch (cause) {
      if (!isCurrent(owner)) return;
      if (isLiveView(owner)) result.value = lastTerminalResult;
      error.value = messageFrom(cause);
      phase.value = 'error';
    }
  }

  function stopPolling(): void {
    if (phase.value !== 'polling' || !activeRun?.jobId) return;
    pollingStopped.value = true;
    phase.value = 'stopped';
    pollingController?.abort();
  }

  async function resumePolling(): Promise<void> {
    if (!activeRun?.jobId || (phase.value !== 'stopped' && phase.value !== 'error')) return;
    selectedHistoryJobId = undefined;
    result.value = currentJob.value ?? lastTerminalResult;
    error.value = undefined;
    await monitor(activeRun);
  }

  function reset(): void {
    generation += 1;
    pollingController?.abort();
    pollingController = undefined;
    activeRun = undefined;
    selectedHistoryJobId = undefined;
    currentJob.value = undefined;
    result.value = undefined;
    error.value = undefined;
    pollingStopped.value = false;
    phase.value = runtimes.value.length ? 'ready' : 'booting';
  }

  function selectHistoryItem(item: DeepReadonly<RunHistoryItem>): void {
    if (activeRun?.jobId && item.jobId === activeRun.jobId) {
      selectedHistoryJobId = undefined;
      result.value = currentJob.value ?? item.result;
      source.value = item.source;
      selectedLanguage.value = item.language;
      activeOutputTab.value = 'output';
      return;
    }
    selectedHistoryJobId = item.jobId;
    source.value = item.source;
    selectedLanguage.value = item.language;
    result.value = item.result;
    activeOutputTab.value = 'output';
  }

  function setLanguage(language: string): void {
    selectedLanguage.value = language;
  }

  function setSource(value: string): void {
    source.value = value;
  }

  function setActiveOutputTab(tab: OutputTab): void {
    activeOutputTab.value = tab;
  }

  return {
    phase: readonly(phase),
    runtimes: readonly(runtimes),
    selectedLanguage: readonly(selectedLanguage),
    source: readonly(source),
    currentJob: readonly(currentJob),
    result: readonly(result),
    error: readonly(error),
    pollingStopped: readonly(pollingStopped),
    activeOutputTab: readonly(activeOutputTab),
    connectionState: readonly(connectionState),
    requestError: readonly(error),
    history: runHistory.history,
    load,
    submit,
    stopPolling,
    resumePolling,
    reset,
    selectHistoryItem,
    setLanguage,
    setSource,
    setActiveOutputTab,
  };
}
