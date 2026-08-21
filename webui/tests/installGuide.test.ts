import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import InstallStepList from '../src/components/InstallStepList.vue';
import {
  INSTALL_BOOTSTRAP_COMMAND,
  INSTALL_STEPS,
  buildInstallCommand,
  type InstallMode,
  type RuntimePreset,
} from '../src/setup/installGuide';

describe('installation guide data', () => {
  test('keeps the supported deployment steps in operational order', () => {
    expect(INSTALL_STEPS.map((step) => step.id)).toEqual([
      'host',
      'mode',
      'install',
      'services',
      'webui',
      'verify',
      'maintain',
    ]);
    expect(INSTALL_STEPS[0].description).toContain('Debian');
  });

  test.each([
    ['cli', 'core'],
    ['webui', 'web'],
    ['webui', 'all'],
  ] as Array<[InstallMode, RuntimePreset]>)('builds a real command for %s/%s', (mode, preset) => {
    const command = buildInstallCommand(mode, preset);
    expect(command).toContain('werkzeug/install.sh');
    expect(command).toContain(`--mode ${mode}`);
    expect(command).toContain(`--languages ${preset}`);
    expect(command).toContain('--non-interactive');
  });

  test('keeps the bootstrap command public and secret-free', () => {
    expect(INSTALL_BOOTSTRAP_COMMAND).toContain('cdn.jsdelivr.net');
    expect(INSTALL_BOOTSTRAP_COMMAND).toContain('sudo');
    expect(INSTALL_BOOTSTRAP_COMMAND).not.toMatch(/password|token|secret|Bearer/i);
  });

  test('shows the WebUI-only proxy step only for WebUI mode', () => {
    const cli = mount(InstallStepList, { props: { steps: INSTALL_STEPS, mode: 'cli' } });
    const webui = mount(InstallStepList, { props: { steps: INSTALL_STEPS, mode: 'webui' } });

    expect(cli.findAll('[data-testid="install-step"]')).toHaveLength(6);
    expect(cli.text()).not.toContain('Nginx');
    expect(webui.findAll('[data-testid="install-step"]')).toHaveLength(7);
    expect(webui.text()).toContain('Nginx');
  });
});
