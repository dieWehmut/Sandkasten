import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import InspectorPanel from '../src/components/InspectorPanel.vue';
import OutputTabs from '../src/components/OutputTabs.vue';
import RunControls from '../src/components/RunControls.vue';
import RuntimeSelect from '../src/components/RuntimeSelect.vue';
import { createTranslator } from '../src/i18n/locale';
import { TRANSLATOR_KEY } from '../src/i18n/useTranslation';
import { statusLabel } from '../src/state/status';

const t = createTranslator('zh-CN');
const global = { provide: { [TRANSLATOR_KEY as symbol]: t } };

describe('Chinese workbench labels', () => {
  test('localizes runtime and run controls while preserving runtime values', async () => {
    const select = mount(RuntimeSelect, {
      props: { modelValue: 'python', runtimes: [{ language: 'python', version: '3.13' }] },
      global,
    });
    expect(select.get('select').attributes('aria-label')).toBe('运行时');
    expect(select.text()).toContain('python 3.13');

    const controls = mount(RunControls, { props: { phase: 'ready' }, global });
    expect(controls.get('button').attributes('aria-label')).toBe('运行源代码');
    expect(controls.text()).toContain('运行');
  });

  test('localizes output navigation and inspector metadata', () => {
    const tabs = mount(OutputTabs, {
      props: { result: { jobId: 'job-zh', status: 'JOB_STATUS_SUCCEEDED' } },
      global,
    });
    expect(tabs.get('[role="tablist"]').attributes('aria-label')).toBe('任务输出');
    expect(tabs.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['输出', '错误', '编译', '诊断']);

    const inspector = mount(InspectorPanel, {
      props: {
        runtime: { language: 'python', version: '3.13', requires_vendor: false },
        job: { jobId: 'job-zh', status: 'JOB_STATUS_SUCCEEDED', exitCode: 0, signal: 0 },
      },
      global,
    });
    expect(inspector.text()).toContain('检查器');
    expect(inspector.text()).toContain('成功');
    expect(inspector.text()).toContain('退出码');
    expect(inspector.text()).toContain('否');
  });

  test('translates known statuses and leaves unknown backend statuses readable', () => {
    expect(statusLabel('JOB_STATUS_SUCCEEDED', t)).toBe('成功');
    expect(statusLabel('JOB_STATUS_CUSTOM_PENDING', t)).toBe('custom pending');
  });
});
