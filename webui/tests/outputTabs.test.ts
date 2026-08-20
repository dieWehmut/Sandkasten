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

  test('offers empty states and copies visible output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = mount(OutputTabs, { props: { result: { jobId: 'job-1', status: 'JOB_STATUS_SUCCEEDED', stdout: 'copy me' } } });
    await wrapper.get('button[aria-label="Copy Output"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('copy me');

    await wrapper.setProps({ result: { jobId: 'job-2', status: 'JOB_STATUS_SUCCEEDED' } });
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('No output');
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
