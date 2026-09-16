import { mount } from '@vue/test-utils';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import InstallStepList from '../src/components/InstallStepList.vue';
import {
  INSTALL_BOOTSTRAP_COMMAND,
  INSTALL_STEPS,
  buildInstallCommand,
  buildOperationalCommands,
  type InstallMode,
  type RuntimePreset,
} from '../src/setup/installGuide';

describe('installation guide data', () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
    expect(command).not.toContain('--non-interactive');
  });

  test('generated commands are accepted by the real installer dry-run parser', () => {
    const entrypoint = resolve(repositoryRoot, 'werkzeug', 'installer', 'entrypoint.sh');
    const entrypointForShell = relative(process.cwd(), entrypoint).replaceAll('\\', '/');
    for (const [mode, preset] of [['cli', 'core'], ['webui', 'web'], ['webui', 'all']] as Array<[InstallMode, RuntimePreset]>) {
      const match = buildInstallCommand(mode, preset).match(/sudo \.\/sandkasten-install\.sh (.+)$/);
      expect(match).not.toBeNull();
      const args = match?.[1].split(/\s+/) ?? [];
      const output = execFileSync('bash', [entrypointForShell, '--dry-run', ...args, 'install'], { encoding: 'utf8', timeout: 30000 });
      expect(output).toContain(`mode=${mode}`);
      expect(output).toMatch(/^languages=.+$/m);
      expect(output).toContain('command=install');
    }
  }, 30000);

  test('filters operational commands by deployment mode', () => {
    const cli = buildOperationalCommands('cli', 'core');
    expect(cli.map((operation) => operation.id)).toEqual([
      'repository', 'verify', 'status', 'restart', 'languages', 'reconfigure', 'uninstall',
    ]);
    expect(cli.find((operation) => operation.id === 'verify')?.command).toContain('127.0.0.1:8080/healthz');
    const webui = buildOperationalCommands('webui', 'web');
    expect(webui.map((operation) => operation.id)).toContain('domain');
    expect(webui.find((operation) => operation.id === 'verify')?.command).toContain('127.0.0.1/healthz');
  });

  test('retains localized step descriptions for the shared list component', () => {
    const guideSource = readFileSync(resolve(repositoryRoot, 'webui', 'src', 'components', 'SetupGuide.vue'), 'utf8');
    expect(guideSource).not.toContain("description: ''");
    expect(readFileSync(resolve(repositoryRoot, 'webui', 'src', 'components', 'InstallStepList.vue'), 'utf8')).toContain('setup-step-number');
  });

  test('defines localized operational command sections for each mode', () => {
    const guideSource = readFileSync(resolve(repositoryRoot, 'webui', 'src', 'components', 'SetupGuide.vue'), 'utf8');
    expect(guideSource).toContain('InstallStepList');
    expect(guideSource).toContain('operational-commands');
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
