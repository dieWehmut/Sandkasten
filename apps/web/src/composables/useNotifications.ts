// Background feedback. The workbench keeps feedback inline where the user is
// looking, and raises a toast only when work finishes somewhere the user is not:
// VS Code's own rule for its bottom-right stack. The store keeps that stack small,
// dismisses each entry after a while, and lets the component close one early.

import { readonly, ref, type DeepReadonly, type Ref } from 'vue';

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: NotificationKind;
  message: string;
  /** Secondary line, e.g. the runtime and the run duration. */
  source?: string;
}

export interface NotificationCenter {
  toasts: DeepReadonly<Ref<Toast[]>>;
  push(toast: Omit<Toast, 'id'> & { id?: string }): string;
  dismiss(id: string): void;
  dispose(): void;
}

export interface NotificationOptions {
  /** How many toasts may stack before the oldest is dropped. */
  limit?: number;
  /** How long a toast stays before it dismisses itself. */
  timeoutMs?: number;
  setTimer?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function useNotifications(options: NotificationOptions = {}): NotificationCenter {
  const limit = Math.max(1, options.limit ?? 3);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 6000);
  const setTimer = options.setTimer ?? ((handler, timeout) => setTimeout(handler, timeout));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

  const toasts = ref<Toast[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let sequence = 0;

  function dismiss(id: string): void {
    const handle = timers.get(id);
    if (handle !== undefined) {
      clearTimer(handle);
      timers.delete(id);
    }
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function push(toast: Omit<Toast, 'id'> & { id?: string }): string {
    const id = toast.id ?? `toast-${(sequence += 1)}`;
    // A repeated id replaces the entry rather than stacking a duplicate.
    dismiss(id);
    toasts.value = [...toasts.value, { id, kind: toast.kind, message: toast.message, source: toast.source }].slice(-limit);
    if (timeoutMs > 0) timers.set(id, setTimer(() => dismiss(id), timeoutMs));
    return id;
  }

  return {
    toasts: readonly(toasts),
    push,
    dismiss,
    dispose() {
      for (const handle of timers.values()) clearTimer(handle);
      timers.clear();
      toasts.value = [];
    },
  };
}