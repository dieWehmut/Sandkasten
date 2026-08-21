export type InstallMode = 'cli' | 'webui';
export type RuntimePreset = 'core' | 'web' | 'all';

export interface InstallStep {
  id: 'host' | 'mode' | 'install' | 'services' | 'webui' | 'verify' | 'maintain';
  title: string;
  description: string;
  modes: readonly InstallMode[];
}

const INSTALL_SCRIPT_URL = 'https://cdn.jsdelivr.net/gh/dieWehmut/Sandkasten@main/werkzeug/install.sh';
const DOWNLOAD_INSTALLER = `curl -fsSL ${INSTALL_SCRIPT_URL} -o sandkasten-install.sh && chmod +x sandkasten-install.sh`;

export const INSTALL_BOOTSTRAP_COMMAND = `${DOWNLOAD_INSTALLER} && sudo ./sandkasten-install.sh`;

export const INSTALL_STEPS: readonly InstallStep[] = [
  {
    id: 'host',
    title: 'Check the host',
    description: 'Use a Debian or Ubuntu x86_64 server with sudo, apt, systemd, PostgreSQL, cgroup v2, and network access.',
    modes: ['cli', 'webui'],
  },
  {
    id: 'mode',
    title: 'Choose a deployment mode',
    description: 'CLI installs the API and runner. WebUI adds the prebuilt browser client and a same-origin reverse proxy.',
    modes: ['cli', 'webui'],
  },
  {
    id: 'install',
    title: 'Run the installer',
    description: 'Copy the generated command into the supported host terminal. The browser cannot run sudo or install packages.',
    modes: ['cli', 'webui'],
  },
  {
    id: 'services',
    title: 'Provision services',
    description: 'The installer provisions dependencies, selected toolchains, PostgreSQL, binaries, environment files, and systemd units.',
    modes: ['cli', 'webui'],
  },
  {
    id: 'webui',
    title: 'Publish the WebUI',
    description: 'WebUI mode installs the four prebuilt files, configures Nginx, and proxies /v1/ and /healthz to the API.',
    modes: ['webui'],
  },
  {
    id: 'verify',
    title: 'Verify the installation',
    description: 'Check both systemd services, then request /healthz and /v1/runtimes before exposing the host publicly.',
    modes: ['cli', 'webui'],
  },
  {
    id: 'maintain',
    title: 'Maintain safely',
    description: 'Use status, restart, languages, reconfigure, and domain commands. Preview removal with uninstall --dry-run before purging.',
    modes: ['cli', 'webui'],
  },
] as const;

export function buildInstallCommand(mode: InstallMode, preset: RuntimePreset): string {
  return `${DOWNLOAD_INSTALLER} && sudo ./sandkasten-install.sh --mode ${mode} --languages ${preset} --non-interactive`;
}
