import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import NotificationToasts from '../src/components/NotificationToasts.vue';
import { useNotifications, type NotificationOptions } from '../src/composables/useNotifications';

function store(options: NotificationOptions = {}) {
  const timers = new Map<() => void, number>();
  let nextHandle = 0;
  const controller = useNotifications({
    setTimer: (handler) => {
      const id = (nextHandle += 1);
      timers.set(handler, id);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      for (const [handler, id] of timers) if (id === (handle as unknown as number)) timers.delete(handler);
    },
    ...options,
  });
  const runTimers = () => {
    const pending = [...timers.keys()];
    timers.clear();
    for (const handler of pending) handler();
  };
  return { controller, runTimers, timers };
}

describe('notification store', () => {
  test('stacks toasts, replaces a repeated id and dismisses early', () => {
    const { controller } = store({ limit: 3, timeoutMs: 6000 });
    controller.push({ id: 'a', kind: 'info', message: 'first' });
    controller.push({ kind: 'success', message: 'second', source: 'python · 0.42 s' });
    expect(controller.toasts.value.map((toast) => toast.message)).toEqual(['first', 'second']);
    expect(controller.toasts.value[0].id).toBe('a');

    // A repeated id updates in place rather than stacking a duplicate.
    controller.push({ id: 'a', kind: 'error', message: 'changed' });
    expect(controller.toasts.value.map((toast) => toast.message)).toEqual(['second', 'changed']);
    expect(controller.toasts.value.at(-1)?.kind).toBe('error');

    controller.dismiss('a');
    expect(controller.toasts.value.map((toast) => toast.message)).toEqual(['second']);

    controller.push({ kind: 'info', message: 'third' });
    controller.push({ kind: 'info', message: 'fourth' });
    expect(controller.toasts.value).toHaveLength(3);
    expect(controller.toasts.value.map((toast) => toast.message)).toEqual(['second', 'third', 'fourth']);
  });

  test('dismisses itself after the timeout and clears on dispose', () => {
    const { controller, runTimers, timers } = store({ timeoutMs: 6000 });
    controller.push({ kind: 'success', message: 'done' });
    expect(timers.size).toBe(1);
    runTimers();
    expect(controller.toasts.value).toHaveLength(0);

    controller.push({ kind: 'success', message: 'again' });
    controller.dispose();
    expect(controller.toasts.value).toHaveLength(0);
    expect(timers.size).toBe(0);
  });
});

describe('notification toasts', () => {
  test('renders the stack with the message, the source and a dismiss action', async () => {
    const wrapper = mount(NotificationToasts, {
      props: {
        toasts: [
          { id: 'run-1', kind: 'success', message: 'Succeeded', source: 'python · 0.42 s' },
          { id: 'run-2', kind: 'error', message: 'Runtime failed' },
        ],
      },
    });

    const region = wrapper.get('[data-testid="notification-toasts"]');
    expect(region.attributes('aria-label')).toBe('Notifications');
    const toasts = wrapper.findAll('[data-testid="notification-toast"]');
    expect(toasts.map((toast) => toast.attributes('data-kind'))).toEqual(['success', 'error']);
    expect(toasts[0].get('.ide-toast__message').text()).toBe('Succeeded');
    expect(toasts[0].get('.ide-toast__source').text()).toBe('python · 0.42 s');
    expect(toasts[1].find('.ide-toast__source').exists()).toBe(false);
    // The live region announces the newest entry.
    expect(region.get('.ide-toast__sr').text()).toBe('Runtime failed');

    await toasts[1].get('[data-action="dismiss-notification"]').trigger('click');
    expect(wrapper.emitted('dismiss')).toEqual([['run-2']]);
  });

  test('keeps the dismiss action out of the way until the entry is reached', () => {
    const wrapper = mount(NotificationToasts, {
      props: { toasts: [{ id: 'a', kind: 'info', message: 'Copied' }] },
    });
    const close = wrapper.get('.ide-toast__close');
    expect(close.attributes('aria-label')).toBe('Dismiss notification');
    expect(wrapper.get('.ide-toast').classes()).toContain('ide-toast');
    expect(close.attributes('title')).toBe('Dismiss notification');
  });
});