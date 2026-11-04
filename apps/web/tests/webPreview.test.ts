import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  test('lays out its toolbar like the reference browser pane', () => {
    // The toolbar styles live in the component's own scoped block rather than in
    // `styles/*.css`, so the usual stylesheet assertions cannot see them. Measured
    // from `.browser-root` in the reference: the navbar is
    // `padding: 6px 8px 3px`, its type is the URL display's 13 px, and its action
    // clusters space children by `gap: 4px` (`.actions-container`). All three were
    // previously 8 px apart at 12 px in a symmetric 4/8 box.
    // `import.meta.url` is not a `file:` URL under this environment's transform, so
    // the component is read relative to the test runner's working directory, which is
    // the `apps/web` package root.
    const source = readFileSync(resolve(process.cwd(), 'src/components/WebPreview.vue'), 'utf8');
    expect(source).toMatch(/\.web-preview__toolbar \{[^}]*gap: 4px;[^}]*padding: 6px 8px 3px;[^}]*font-size: 13px;/s);
    // The width selector stands in for `.browser-url-container`, a 6 px corner.
    expect(source).toMatch(/\.web-preview__toolbar select \{[^}]*border-radius: 6px;/s);
  });
});
