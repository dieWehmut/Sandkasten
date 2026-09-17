import type { RunnerPhase } from './useRunner';

// The shell renders one execution surface for two backends: the remote
// Sandkasten API runner (`useRunner`) and the desktop local runner
// (`useLocalRunner`). Both are projected onto this phase union.
export type ExecutionPhase = RunnerPhase | 'running' | 'unavailable';
export type ExecutionBackend = 'local' | 'api';

export function isExecutionBusy(phase: ExecutionPhase): boolean {
  return phase === 'submitting' || phase === 'polling' || phase === 'running';
}

export function isExecutionRunnable(phase: ExecutionPhase): boolean {
  return !isExecutionBusy(phase) && phase !== 'booting' && phase !== 'unavailable';
}