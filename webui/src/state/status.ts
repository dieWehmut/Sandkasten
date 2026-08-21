import { createTranslator, type Translator } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';

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

const TERMINAL_STATUS_KEYS: Readonly<Record<TerminalStatus, MessageKey>> = {
  JOB_STATUS_SUCCEEDED: 'status.succeeded',
  JOB_STATUS_COMPILE_FAILED: 'status.compileFailed',
  JOB_STATUS_RUNTIME_FAILED: 'status.runtimeFailed',
  JOB_STATUS_TIME_LIMIT_EXCEEDED: 'status.timeLimitExceeded',
  JOB_STATUS_MEMORY_LIMIT_EXCEEDED: 'status.memoryLimitExceeded',
  JOB_STATUS_OUTPUT_LIMIT_EXCEEDED: 'status.outputLimitExceeded',
  JOB_STATUS_CANCELED: 'status.canceled',
  JOB_STATUS_SYSTEM_ERROR: 'status.systemError',
};

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(Object.keys(TERMINAL_STATUS_META));

export function isTerminalStatus(status: string | undefined): status is TerminalStatus {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status);
}

export function statusLabel(status: string | undefined, t: Translator = createTranslator('en')): string {
  if (!status) return t('status.unknown');
  return isTerminalStatus(status) ? t(TERMINAL_STATUS_KEYS[status]) : status.replace(/^JOB_STATUS_/, '').replaceAll('_', ' ').toLowerCase();
}

export function statusCategory(status: string | undefined): StatusCategory | 'info' {
  return isTerminalStatus(status) ? TERMINAL_STATUS_META[status].category : 'info';
}
