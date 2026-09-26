import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import IdeStatusBar from '../src/components/ide/IdeStatusBar.vue';
import type { JobResponse } from '../src/services/sandkastenApi';

function mountStrip(overrides: Record<string, unknown> = {}) {
  return mount(IdeStatusBar, {
    props: {
      backend: 'api',
      language: 'python',
      filePath: 'src/main.py',
      phase: 'ready',
      statusText: 'Ready',
      cursor: { line: 281, column: 1 },
      source: 'def main():\n    print("hi")\n',
      workspaceLabel: 'ws',
      apiHost: 'run.example.com',
      connectionState: 'connected',
      historyCount: 3,
      terminalAvailable: true,
      ...overrides,
    },
  });
}

describe('ide status bar', () => {
  test('reads the live workbench the way the VS Code strip does', () => {
    const wrapper = mountStrip();

    // Two groups: the execution facts lead, the editor facts trail.
    expect(wrapper.find('.ide-status__group--start').exists()).toBe(true);
    expect(wrapper.find('.ide-status__group--end').exists()).toBe(true);
    expect(wrapper.get('[data-testid="ide-status-bar"]').attributes('data-phase')).toBe('ready');

    expect(wrapper.get('.ide-status__badge').text()).toBe('Sandbox API');
    expect(wrapper.get('.ide-status__badge').attributes('data-connection')).toBe('connected');
    // The remote indicator names the origin the sandbox backend talks to.
    expect(wrapper.get('[data-action="ide-status-connection"]').text()).toContain('run.example.com');
    expect(wrapper.get('[data-action="ide-status-connection"]').attributes('title')).toContain('Connected');
    expect(wrapper.get('.ide-status__item--workspace').text()).toContain('ws');
    expect(wrapper.get('.ide-status__item--file').text()).toBe('main.py');

    const text = wrapper.text();
    expect(wrapper.get('[data-action="ide-status-errors"]').text()).toContain('0');
    expect(wrapper.get('[data-action="ide-status-warnings"]').text()).toContain('0');
    expect(wrapper.get('[data-testid="ide-status-phase"]').text()).toBe('Ready');
    expect(text).toContain('Ln 281, Col 1');
    expect(text).toContain('Spaces: 4');
    expect(text).toContain('UTF-8');
    expect(text).toContain('LF');
    expect(wrapper.get('[data-testid="ide-status-language"]').text()).toBe('Python');
  });

  test('reads indentation and line endings from the open buffer', () => {
    const wrapper = mountStrip({ source: 'if (a) {\r\n\treturn;\r\n}\r\n' });

    expect(wrapper.text()).toContain('Tab Size: 4');
    expect(wrapper.text()).toContain('CRLF');
  });

  test('names the backend and spins while a run is in flight', () => {
    const isolated = mountStrip({ backend: 'isolated', phase: 'polling', statusText: 'Polling' });
    expect(isolated.get('.ide-status__badge').text()).toBe('Isolated run');
    expect(isolated.find('.ide-status__badge .ide-status__spinner').exists()).toBe(true);
    expect(isolated.get('[data-testid="ide-status-bar"]').attributes('data-backend')).toBe('isolated');

    const local = mountStrip({ backend: 'local', phase: 'ready' });
    expect(local.get('.ide-status__badge').text()).toBe('Local run');
    expect(local.find('.ide-status__spinner').exists()).toBe(false);
    // A desktop backend runs on this machine, so the item reports the session
    // state rather than the API origin the sandbox backend would use.
    expect(local.get('[data-action="ide-status-connection"]').text()).toContain('Connected');
  });

  test('summarizes the last run as problems instead of a language server', () => {
    const failed: JobResponse = {
      jobId: 'job-1',
      status: 'JOB_STATUS_RUNTIME_FAILED',
      stderr: 'Traceback\nmain.py:3: warning: unused name\n',
    };
    const wrapper = mountStrip({ job: failed, statusText: 'Runtime failed', phase: 'completed' });

    expect(wrapper.get('[data-action="ide-status-errors"]').text()).toContain('1');
    expect(wrapper.get('[data-action="ide-status-warnings"]').text()).toContain('1');
    expect(wrapper.get('[data-action="ide-status-run"]').attributes('data-state')).toBe('error');

    const succeeded = mountStrip({ job: { jobId: 'job-2', status: 'JOB_STATUS_SUCCEEDED' }, statusText: 'Succeeded' });
    expect(succeeded.get('[data-action="ide-status-run"]').attributes('data-state')).toBe('success');
  });

  test('marks an unsaved buffer and offers to save it', async () => {
    const wrapper = mountStrip({ dirty: true });

    const unsaved = wrapper.get('.ide-status__item--dirty');
    expect(unsaved.text()).toBe('Unsaved');
    await unsaved.trigger('click');
    expect(wrapper.emitted('saveFile')).toHaveLength(1);
  });

  test('emits the action each item stands for', async () => {
    const wrapper = mountStrip();

    await wrapper.get('.ide-status__badge').trigger('click');
    await wrapper.get('[data-action="ide-status-connection"]').trigger('click');
    await wrapper.get('[data-action="ide-status-settings"]').trigger('click');
    expect(wrapper.emitted('openSettings')).toHaveLength(3);

    await wrapper.get('[data-action="ide-status-errors"]').trigger('click');
    await wrapper.get('[data-action="ide-status-warnings"]').trigger('click');
    await wrapper.get('[data-action="ide-status-run"]').trigger('click');
    expect(wrapper.emitted('showPanel')).toHaveLength(3);

    await wrapper.get('[data-action="ide-status-runs"]').trigger('click');
    expect(wrapper.emitted('selectRuns')).toHaveLength(1);
    await wrapper.get('[data-action="ide-status-setup"]').trigger('click');
    expect(wrapper.emitted('openSetup')).toHaveLength(1);
    await wrapper.get('[data-action="ide-status-terminal"]').trigger('click');
    expect(wrapper.emitted('toggleTerminal')).toHaveLength(1);
  });

  test('keeps the terminal item only where a desktop terminal exists', () => {
    expect(mountStrip({ terminalAvailable: false }).find('[data-action="ide-status-terminal"]').exists()).toBe(false);
    expect(mountStrip().find('[data-action="ide-status-terminal"]').exists()).toBe(true);
  });
});