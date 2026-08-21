import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import JobTimeline from '../src/components/JobTimeline.vue';
import OutputTabs from '../src/components/OutputTabs.vue';

describe('output inspection', () => {
  test('provides four accessible tabs with arrow, Home, and End navigation', async () => {
    const wrapper = mount(OutputTabs, { props: { result: { jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED' } } });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(wrapper.find('[role="tablist"]').attributes('aria-label')).toBe('Job output');
    expect(tabs.map((tab) => tab.text())).toEqual(['Output', 'Errors', 'Compile', 'Diagnostics']);
    expect(tabs[0].attributes('aria-selected')).toBe('true');
    expect(wrapper.find('[role="tabpanel"]').attributes('aria-labelledby')).toBe(tabs[0].attributes('id'));

    await tabs[0].trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true');
    await wrapper.findAll('[role="tab"]')[1].trigger('keydown', { key: 'End' });
    expect(wrapper.findAll('[role="tab"]')[3].attributes('aria-selected')).toBe('true');
    await wrapper.findAll('[role="tab"]')[3].trigger('keydown', { key: 'Home' });
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true');
    await wrapper.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.findAll('[role="tab"]')[3].attributes('aria-selected')).toBe('true');
  });

  test('decodes channels, preserves undecodable raw text, and shows only real truncation flags', async () => {
    const wrapper = mount(OutputTabs, {
      props: {
        result: {
          jobId: 'job-1',
          status: 'JOB_STATUS_COMPILE_FAILED',
          stdout: 'aGVsbG8=',
          stdoutEncoding: 'base64',
          stderr: '/w==',
          stderrEncoding: 'base64',
          compileStdout: 'compiler notes',
          compileStderr: 'bad token',
          compileStderrEncoding: 'utf8',
          truncated: { stdout: true },
          errorMessage: '<server error>',
          diagnostics: { line: 7, message: '<unsafe>' },
        },
      },
    });

    expect(wrapper.find('[role="tabpanel"]').text()).toContain('hello');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Truncated');
    await wrapper.findAll('[role="tab"]')[1].trigger('click');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('/w==');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('could not be decoded');
    expect(wrapper.find('[role="tabpanel"]').text()).not.toContain('Truncated');

    await wrapper.findAll('[role="tab"]')[2].trigger('click');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Compile stdout');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('compiler notes');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Compile stderr');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('bad token');
    expect(wrapper.find('[role="tabpanel"]').text()).not.toContain('Truncated');

    await wrapper.findAll('[role="tab"]')[3].trigger('click');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('<server error>');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('<unsafe>');
    expect(wrapper.html()).not.toContain('<server error></server>');
  });

  test('renders request errors in Diagnostics and keeps a truncated empty channel visible', async () => {
    const wrapper = mount(OutputTabs, {
      props: {
        result: { jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED', truncated: { stdout: true } },
        error: 'request failed',
      },
    });
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Truncated');
    await wrapper.findAll('[role="tab"]')[3].trigger('click');
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('request failed');

    const unavailable = mount(OutputTabs, { props: { error: 'runtime request failed', modelValue: 'diagnostics' } });
    expect(unavailable.get('.output-channel .badge').text()).toBe('utf8');
  });

  test('marks every tab whose corresponding channel contains visible content', () => {
    const wrapper = mount(OutputTabs, {
      props: {
        result: {
          jobId: 'job-1',
          status: 'JOB_STATUS_COMPILE_FAILED',
          stdout: 'out',
          stderr: 'err',
          compileStderr: 'compile err',
          errorMessage: 'failed',
        },
      },
    });
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.find('.tab-indicator').exists())).toEqual([true, true, true, true]);
  });

  test('labels each visible diagnostics channel as utf8 while rendering payloads as text', async () => {
    const wrapper = mount(OutputTabs, {
      props: {
        result: {
          jobId: 'job-1',
          status: 'JOB_STATUS_SYSTEM_ERROR',
          errorMessage: '<request failed>',
          diagnostics: { message: '<unsafe>' },
        },
        error: '<network error>',
        modelValue: 'diagnostics',
      },
    });
    expect(wrapper.findAll('.output-channel')).toHaveLength(3);
    expect(wrapper.findAll('.output-channel').map((channel) => channel.find('.badge').text())).toEqual(['utf8', 'utf8', 'utf8']);
    expect(wrapper.findAll('request').length).toBe(0);
    expect(wrapper.text()).toContain('<unsafe>');
  });

  test('uses one empty diagnostics view instead of three empty channel blocks', () => {
    const wrapper = mount(OutputTabs, {
      props: { result: { jobId: 'job-clean', status: 'JOB_STATUS_SUCCEEDED' }, modelValue: 'diagnostics' },
    });
    expect(wrapper.findAll('.output-channel')).toHaveLength(1);
    expect(wrapper.get('.output-channel .badge').text()).toBe('utf8');
    expect(wrapper.get('.output-channel .empty-state').text()).toBe('No diagnostics');
  });

  test('offers empty states and copies visible output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = mount(OutputTabs, { props: { result: { jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED', stdout: 'copy me' } } });
    const copyButton = wrapper.get('button[aria-label="Copy Output"]');
    expect(copyButton.attributes('title')).toBe('Copy Output');
    expect(copyButton.find('svg').exists()).toBe(true);
    await copyButton.trigger('click');
    expect(writeText).toHaveBeenCalledWith('copy me');
    expect(copyButton.find('.lucide-check').exists()).toBe(true);

    await wrapper.setProps({ result: { jobId: 'job-2', status: 'JOB_STATUS_SUCCEEDED' } });
    expect(copyButton.find('.lucide-check').exists()).toBe(false);
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('No output');
  });

  test('keeps an encoding label visible for an empty output channel', () => {
    const wrapper = mount(OutputTabs, {
      props: { result: { jobId: 'job-empty', status: 'JOB_STATUS_SUCCEEDED', stdoutEncoding: 'base64' } },
    });
    expect(wrapper.get('.output-channel .badge').text()).toBe('base64');
    expect(wrapper.get('.output-channel .empty-state').text()).toBe('No output');
  });

  test('reports clipboard failures without an unhandled rejection', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const wrapper = mount(OutputTabs, {
      props: { result: { jobId: 'job-copy-fail', status: 'JOB_STATUS_SUCCEEDED', stdout: 'copy me' } },
    });
    await wrapper.get('button[aria-label="Copy Output"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toBe('Copy failed');
  });

  test('states that stopping monitoring does not cancel the backend job and exposes errors', () => {
    const wrapper = mount(JobTimeline, {
      props: { phase: 'stopped', pollingStopped: true, error: 'connection failed' },
    });
    expect(wrapper.text()).toContain('Monitoring stopped. The job may still be running.');
    expect(wrapper.text().toLowerCase()).not.toContain('job was canceled');
    expect(wrapper.get('[role="alert"]').text()).toBe('connection failed');
  });
});
