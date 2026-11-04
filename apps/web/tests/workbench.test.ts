import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import App from '../src/App.vue';
import InspectorPanel from '../src/components/InspectorPanel.vue';
import RunControls from '../src/components/RunControls.vue';
import RuntimeSelect from '../src/components/RuntimeSelect.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import type { JobResponse, Runtime } from '../src/services/sandkastenApi';
import { SETUP_WELCOME_STORAGE_KEY } from '../src/composables/useSetupWelcome';
import { chooseDropdown } from './dropdownHelpers';

const api = vi.hoisted(() => ({
  loadRuntimes: vi.fn(),
  submitJob: vi.fn(),
  pollJob: vi.fn(),
}));

vi.mock('../src/services/sandkastenApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/services/sandkastenApi')>(),
  loadRuntimes: api.loadRuntimes,
  submitJob: api.submitJob,
  pollJob: api.pollJob,
}));

const runtimes: Runtime[] = [
  {
    language: 'python',
    version: '3.13',
    image: 'python:3.13',
    status: 'active',
    default_entrypoint: 'main.py',
    requires_vendor: false,
    aliases: ['py', 'python3'],
    compile_phase: { enabled: false, command: ['python', '-m', 'compileall'] },
    run_phase: { enabled: true, command: ['python', 'main.py'] },
    default_limits: { run_timeout_ms: 5000, memory_limit_bytes: 268435456, output_bytes: 1048576 },
    max_limits: { run_timeout_ms: 30000, memory_limit_bytes: 1073741824, output_bytes: 4194304 },
  },
  { language: 'go', version: '1.26', default_entrypoint: '.', requires_vendor: true },
];

afterEach(() => window.localStorage.clear());

function completed(jobId: string, stdout: string): JobResponse {
  return {
    jobId,
    status: 'JOB_STATUS_SUCCEEDED',
    language: 'python',
    runtime: 'python:3.13',
    stdout,
    stdoutEncoding: 'utf8',
    stderrEncoding: 'base64',
    compileStdoutEncoding: 'utf8',
    compileStderrEncoding: 'utf8',
    durationMs: 1234,
    exitCode: 0,
    signal: 0,
    truncated: { stdout: true, stderr: false },
    diagnostics: { memoryPeakBytes: 4096 },
  };
}

describe('workbench controls', () => {
  beforeEach(() => {
    window.localStorage.setItem(SETUP_WELCOME_STORAGE_KEY, 'true');
    api.loadRuntimes.mockReset().mockResolvedValue(runtimes);
    api.submitJob.mockReset();
    api.pollJob.mockReset();
  });

  test('selects an exact backend runtime value', async () => {
    const select = mount(RuntimeSelect, { props: { modelValue: 'python', runtimes } });
    // The control is a themed listbox rather than a native select, so the value is
    // chosen by opening the list and clicking the row — the same route a user takes.
    await select.get('[data-dropdown-trigger]').trigger('click');
    const rows = select.findAll('[role="option"]');
    await rows.find((row) => row.attributes('data-value') === 'go')!.trigger('click');
    expect(select.emitted('update:modelValue')).toEqual([['go']]);
    expect(select.text()).toContain('python 3.13');
  });

  test('offers Run, Stop polling, and Resume polling for the matching phases', async () => {
    const ready = mount(RunControls, { props: { phase: 'ready', canRun: true } });
    await ready.get('button[aria-label="Run source"]').trigger('click');
    expect(ready.emitted('run')).toHaveLength(1);

    const polling = mount(RunControls, { props: { phase: 'polling', canRun: true } });
    await polling.get('button[aria-label="Stop polling"]').trigger('click');
    expect(polling.emitted('stop')).toHaveLength(1);

    const stopped = mount(RunControls, { props: { phase: 'stopped', canRun: true } });
    await stopped.get('button[aria-label="Resume polling"]').trigger('click');
    expect(stopped.emitted('resume')).toHaveLength(1);

    await stopped.get('button[aria-label="Run new source"]').trigger('click');
    expect(stopped.emitted('run')).toHaveLength(1);
  });

  test('shows runtime, job, encoding, truncation, limits, and diagnostic metadata', () => {
    const wrapper = mount(InspectorPanel, {
      props: { runtime: runtimes[0], job: completed('job-inspect', 'done') },
    });
    const text = wrapper.text();
    for (const expected of [
      'python', '3.13', 'main.py', 'Runtime version', 'python:3.13', 'job-inspect', 'Succeeded', '1.23 s',
      'Exit code', '0', 'Signal', 'stdout', 'utf8', 'base64', 'Truncated', '5 s', '256 MiB', 'memoryPeakBytes',
      'Compile phase enabled', 'No', 'Run phase enabled', 'Yes', 'python -m compileall', 'python main.py',
    ]) expect(text).toContain(expected);
  });

  test('shows explicit placeholders when zero-valued exit metadata is omitted', () => {
    const wrapper = mount(InspectorPanel, {
      props: { runtime: runtimes[0], job: { jobId: 'job-omitted-zeroes', status: 'JOB_STATUS_SUCCEEDED' } },
    });
    expect(wrapper.text()).toContain('Exit code');
    expect(wrapper.text()).toContain('Signal');
    expect(wrapper.findAll('dd').filter((node) => node.text() === 'Not reported')).toHaveLength(2);
  });

  test('treats an omitted phase enabled flag as disabled', () => {
    const wrapper = mount(InspectorPanel, {
      props: {
        runtime: { language: 'compiled', compile_phase: {}, run_phase: { enabled: true } },
      },
    });
    expect(wrapper.text()).toContain('Compile phase enabledNo');
    expect(wrapper.text()).toContain('Run phase enabledYes');
  });

  test('wires runtime, editing, running, text-only output, and history restoration through App', async () => {
    api.submitJob
      .mockResolvedValueOnce(completed('job-one', '<img src=x onerror=alert(1)>'))
      .mockResolvedValueOnce(completed('job-two', 'second result'));
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get('[data-testid="app-shell"]').classes()).toContain('workbench-app');
    // The reduced title row dropped the status line, so the run bar's badge
    // carries the connection state instead.
    expect(wrapper.get('.ide-status__badge').attributes('data-connection')).toBe('connected');
    wrapper.get('[data-testid="workbench-shell"]');

    await chooseDropdown(wrapper, '.runtime-select', 'python');
    const editor = wrapper.getComponent(SourceEditor);
    const editorView = () => (editor.vm as unknown as { editorView: EditorView }).editorView;
    editorView().dispatch({
      changes: { from: 0, to: editorView().state.doc.length, insert: 'print("first")' },
    });
    await nextTick();
    await wrapper.get('button[aria-label="Run source"]').trigger('click');
    await flushPromises();

    expect(api.submitJob).toHaveBeenCalledWith('python', 'print("first")');
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    // Backend output stays text even though the shell renders real file glyphs.
    expect(wrapper.findAll('.output-viewer img')).toHaveLength(0);

    editorView().dispatch({
      changes: { from: 0, to: editorView().state.doc.length, insert: 'print("second")' },
    });
    await nextTick();
    await wrapper.get('button[aria-label="Run source"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-testid="history-item"]')).toHaveLength(2);

    await wrapper.findAll('[data-testid="history-item"]')[1].trigger('click');
    await nextTick();
    expect(editorView().state.doc.toString()).toBe('print("first")');
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
  }, 10000);

  test('puts the shell into zen mode and takes it out again', async () => {
    // The controller's own arithmetic is covered in `zenMode.test.ts`; this checks the
    // wiring, which is where the feature can silently do nothing. It did exactly that
    // once: the centred column reported the right width but nothing ever measured the
    // editor group, so `zenGeometry` only ever saw zero and the column never narrowed.
    api.loadRuntimes.mockResolvedValue(runtimes);
    // jsdom has no layout, so `scrollIntoView` is missing and the palette's selection
    // watcher throws when the list re-renders. Without this stub the palette cannot be
    // driven at all, and the failure looks like an empty result list.
    const proto = window.HTMLElement.prototype as HTMLElement & { scrollIntoView?: () => void };
    if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
    const wrapper = mount(App);
    await flushPromises();
    await nextTick();

    const shell = () => wrapper.get('[data-testid="workbench-shell"]');
    expect(shell().classes()).not.toContain('zen-active');

    // The command is reachable from the palette, which is the only entry point the web
    // shell offers for a chord binding like the reference's Ctrl+K Z.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    await flushPromises();
    await nextTick();
    const input = wrapper.get('.command-palette__input');
    // Command mode is selected by the leading `>`, which `openPalette('commands')`
    // writes when the palette opens. Overwriting the whole value drops the prefix and
    // silently falls back to file mode, where no command is ever listed.
    await input.setValue('>zen');
    await flushPromises();
    await nextTick();
    const items = wrapper.findAll('.command-palette__item');
    expect(items.length).toBeGreaterThan(0);

    await items[0].trigger('click');
    await flushPromises();
    await nextTick();

    // Zen mode removes the activity bar and the status bar track, and asks for a
    // centred column. The tab strip stays, because `showTabs` defaults to `multiple`.
    expect(shell().classes()).toContain('zen-active');
    expect(shell().classes()).toContain('zen-without-activity-bar');
    expect(shell().classes()).toContain('zen-without-status-bar');
    expect(wrapper.find('.ide-activity__button').exists()).toBe(false);

    // Escape is the only way back once the chrome is gone, so it has to work.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    await nextTick();
    expect(shell().classes()).not.toContain('zen-active');
    expect(wrapper.find('.ide-activity__button').exists()).toBe(true);
  }, 10000);
});
