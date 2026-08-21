import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import App from '../src/App.vue';
import ConnectionStatus from '../src/components/ConnectionStatus.vue';
import InspectorPanel from '../src/components/InspectorPanel.vue';
import RunControls from '../src/components/RunControls.vue';
import RuntimeSelect from '../src/components/RuntimeSelect.vue';
import SourceEditor from '../src/components/SourceEditor.vue';
import type { JobResponse, Runtime } from '../src/services/sandkastenApi';

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
    api.loadRuntimes.mockReset().mockResolvedValue(runtimes);
    api.submitJob.mockReset();
    api.pollJob.mockReset();
  });

  test('selects an exact backend runtime value and exposes live connection text', async () => {
    const select = mount(RuntimeSelect, { props: { modelValue: 'python', runtimes } });
    await select.get('select').setValue('go');
    expect(select.emitted('update:modelValue')).toEqual([['go']]);
    expect(select.text()).toContain('python 3.13');

    expect(mount(ConnectionStatus, { props: { state: 'connecting' } }).text()).toContain('Connecting');
    expect(mount(ConnectionStatus, { props: { state: 'connected' } }).get('[aria-live="polite"]').text()).toContain('Connected');
    expect(mount(ConnectionStatus, { props: { state: 'unavailable' } }).text()).toContain('Unavailable');
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
  });

  test('shows runtime, job, encoding, truncation, limits, and diagnostic metadata', () => {
    const wrapper = mount(InspectorPanel, {
      props: { runtime: runtimes[0], job: completed('job-inspect', 'done') },
    });
    const text = wrapper.text();
    for (const expected of [
      'python', '3.13', 'main.py', 'python:3.13', 'job-inspect', 'Succeeded', '1.23 s',
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
    expect(wrapper.text()).toContain('Connected');
    wrapper.get('[data-testid="workbench-shell"]');

    await wrapper.get('[aria-label="Runtime"]').setValue('python');
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
    expect(wrapper.find('img').exists()).toBe(false);

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
});
