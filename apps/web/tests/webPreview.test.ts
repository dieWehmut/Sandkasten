import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { isolatedPreviewHtml, webPreviewDocument } from '../src/editor/preview';
import OutputTabs from '../src/components/OutputTabs.vue';

describe('web development preview', () => {
  test('updates HTML and CSS from the active buffer before running a job', async () => {
    const wrapper = mount(OutputTabs, { props: { language: 'html', source: '<h1>Live</h1>' } });
    await wrapper.get('[data-action="select-output-preview"]').trigger('click');
    const frame = wrapper.get('iframe');
    expect(frame.attributes('srcdoc')).toContain('<h1>Live</h1>');
    expect(frame.attributes('sandbox')).toBe('allow-scripts');
    await wrapper.setProps({ source: '<h1>Changed</h1>' });
    expect(frame.attributes('srcdoc')).toContain('<h1>Changed</h1>');
    await wrapper.setProps({ language: 'css', source: 'h1 { color: red; }' });
    expect(frame.attributes('srcdoc')).toContain('h1 { color: red; }');
    await wrapper.setProps({ language: 'python' });
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.get('[data-action="select-output-output"]').attributes('aria-selected')).toBe('true');
    wrapper.unmount();
  });

  test('only renders complete successful builds for the same web language', () => {
    const result = { jobId: 'build', language: 'vue3', status: 'JOB_STATUS_SUCCEEDED', stdout: '<h1>Built</h1>' };
    expect(webPreviewDocument('vue', '', result)).toEqual({ mode: 'compiled', html: '<h1>Built</h1>' });
    expect(webPreviewDocument('markdown', '', result)).toBeUndefined();
    expect(webPreviewDocument('vue3', '', { ...result, status: 'JOB_STATUS_COMPILE_FAILED' })).toBeUndefined();
    expect(webPreviewDocument('vue3', '', { ...result, truncated: { stdout: true } })).toBeUndefined();
    expect(webPreviewDocument('vue3', '', { ...result, stdoutEncoding: 'base64', stdout: '/w==' })).toBeUndefined();
    expect(webPreviewDocument('scss', '', { ...result, language: 'sass', stdout: 'h1{color:red}' })?.html).toContain('<style>h1{color:red}</style>');
  });

  test('isolates network, parent navigation, and CSS closing tags', () => {
    expect(isolatedPreviewHtml('<script>test()</script>')).toContain("connect-src 'none'");
    expect(isolatedPreviewHtml('<h1>Test</h1>')).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
    expect(webPreviewDocument('css', '</style><script>test()</script>')?.html).toContain('<\\/style><script>');
  });
});
