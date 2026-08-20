export const TERMINAL_STATUS_META = {
  JOB_STATUS_SUCCEEDED: { label: 'Succeeded', category: 'success' },
  JOB_STATUS_COMPILE_FAILED: { label: 'Compile failed', category: 'danger' },
  JOB_STATUS_RUNTIME_FAILED: { label: 'Runtime failed', category: 'danger' },
  JOB_STATUS_TIME_LIMIT_EXCEEDED: { label: 'Time limit exceeded', category: 'warning' },
  JOB_STATUS_MEMORY_LIMIT_EXCEEDED: { label: 'Memory limit exceeded', category: 'warning' },
  JOB_STATUS_OUTPUT_LIMIT_EXCEEDED: { label: 'Output limit exceeded', category: 'warning' },
  JOB_STATUS_CANCELED: { label: 'Canceled', category: 'neutral' },
  JOB_STATUS_SYSTEM_ERROR: { label: 'System error', category: 'danger' },
} as const;

export type TerminalStatus = keyof typeof TERMINAL_STATUS_META;
export type StatusCategory = typeof TERMINAL_STATUS_META[TerminalStatus]['category'];

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(Object.keys(TERMINAL_STATUS_META));

export function isTerminalStatus(status: string | undefined): status is TerminalStatus {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status);
}

export function statusLabel(status: string | undefined): string {
  if (!status) return 'Unknown';
  return isTerminalStatus(status) ? TERMINAL_STATUS_META[status].label : status.replace(/^JOB_STATUS_/, '').replaceAll('_', ' ').toLowerCase();
}

export function statusCategory(status: string | undefined): StatusCategory | 'info' {
  return isTerminalStatus(status) ? TERMINAL_STATUS_META[status].category : 'info';
}
