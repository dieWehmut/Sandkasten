import type { RunnerPhase } from './useRunner';

// The shell renders one execution surface for two backends: the remote
// Sandkasten API runner (`useRunner`) and the desktop local runner
// (`useLocalRunner`). Both are projected onto this phase union.
export type ExecutionPhase = RunnerPhase | 'running' | 'unavailable';
// `isolated` runs the same workspace file through the desktop app's WSL2
// namespace sandbox; `local` is the plain unsandboxed toolchain run; `api`
// submits to the remote Sandkasten service. The shell treats all three as one
// execution surface.
export type ExecutionBackend = 'local' | 'isolated' | 'api';

export function isExecutionBusy(phase: ExecutionPhase): boolean {
  return phase === 'submitting' || phase === 'polling' || phase === 'running';
}

export function isExecutionRunnable(phase: ExecutionPhase): boolean {
  return !isExecutionBusy(phase) && phase !== 'booting' && phase !== 'unavailable';
}