import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import RemoteExplorer from '../src/components/ide/RemoteExplorer.vue';
import { useRemoteHosts, REMOTE_NEEDS_DESKTOP } from '../src/composables/useRemoteHosts';
import type { RemoteBridge, RemoteHostList } from '../src/services/desktopBridge';

const sample = (): RemoteHostList => ({
  available: true,
  configPath: 'C:\\Users\\me\\.ssh\\config',
  hosts: [
    { alias: 'sandkasten', hostName: '192.168.50.11', user: 'root', port: '2222', directories: ['/root/sandkasten'] },
    { alias: 'agent', hostName: '192.168.210.2', user: 'seiii', port: '', directories: [] },
  ],
});

function fakeBridge(overrides: Partial<RemoteBridge> = {}) {
  const opened: Array<{ host: string; directory?: string; profileId?: string }> = [];
  const remembered: Array<{ host: string; directory: string }> = [];
  const bridge: RemoteBridge = {
    list: vi.fn(async () => sample()),
    remember: vi.fn(async ({ host, directory }) => {
      remembered.push({ host, directory });
      return sample();
    }),
    forget: vi.fn(async () => sample()),
    open: vi.fn(async (request) => {
      opened.push(request);
      return { host: request.host, command: `ssh ${request.host}`, directory: request.directory ?? '' };
    }),
    ...overrides,
  };
  return { bridge, opened, remembered };
}

describe('remote hosts controller', () => {
  test('loads the parsed hosts and reports a chosen entry as a terminal hand-off', async () => {
    const host = fakeBridge();
    const controller = useRemoteHosts(host.bridge);

    await controller.load();
    expect(controller.state.value).toBe('ready');
    expect(controller.hosts.value.map((entry) => entry.alias)).toEqual(['sandkasten', 'agent']);
    expect(controller.hosts.value[0].directories).toEqual(['/root/sandkasten']);

    const session = await controller.open('sandkasten', '/root/sandkasten', 'powershell');
    expect(host.opened).toEqual([{ host: 'sandkasten', directory: '/root/sandkasten', profileId: 'powershell' }]);
    expect(session.command).toBe('ssh sandkasten');
  });

  test('remembers and forgets a directory through the bridge', async () => {
    const host = fakeBridge();
    const controller = useRemoteHosts(host.bridge);

    await controller.remember('agent', '/home/seiii/agent');
    expect(host.remembered).toEqual([{ host: 'agent', directory: '/home/seiii/agent' }]);
    await controller.load();
    await controller.forget('agent', '/home/seiii/agent');
    expect(host.bridge.forget).toHaveBeenCalledWith({ host: 'agent', directory: '/home/seiii/agent' });
  });

  test('reports the missing-bridge case instead of faking hosts', async () => {
    const controller = useRemoteHosts(undefined);
    await controller.load();
    expect(controller.state.value).toBe('error');
    expect(controller.error.value).toBe(REMOTE_NEEDS_DESKTOP);
    expect(controller.hosts.value).toEqual([]);
  });

  test('surfaces a failure and keeps the last hosts out of the ready state', async () => {
    const host = fakeBridge({ list: vi.fn(async () => { throw new Error('ssh config unreadable'); }) });
    const controller = useRemoteHosts(host.bridge);
    await controller.load();
    expect(controller.state.value).toBe('error');
    expect(controller.error.value).toMatch(/unreadable/);
  });
});

describe('remote explorer view', () => {
  const baseProps = {
    state: 'ready' as const,
    available: true,
    hosts: sample().hosts,
    configPath: 'C:\\Users\\me\\.ssh\\config',
    desktop: true,
  };

  test('renders the ssh tree with a host and its directories', () => {
    const wrapper = mount(RemoteExplorer, { props: baseProps });
    const host = wrapper.get('[data-host="sandkasten"]');
    expect(host.text()).toContain('192.168.50.11');
    expect(host.text()).toContain('root');
    expect(wrapper.get('[data-directory="/root/sandkasten"]').text()).toContain('/root/sandkasten');
    expect(wrapper.get('[data-host="agent"]').text()).toContain('seiii');
  });

  test('emits the hand-off for a host and for a directory entry', async () => {
    const wrapper = mount(RemoteExplorer, { props: baseProps });
    await wrapper.get('[data-open="sandkasten"]').trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual([{ host: 'sandkasten', directory: '' }]);

    await wrapper.get('[data-directory="/root/sandkasten"] .ide-remote__directory').trigger('click');
    expect(wrapper.emitted('open')?.[1]).toEqual([{ host: 'sandkasten', directory: '/root/sandkasten' }]);

    await wrapper.get('[data-forget="/root/sandkasten"]').trigger('click');
    expect(wrapper.emitted('forget')?.[0]).toEqual([{ host: 'sandkasten', directory: '/root/sandkasten' }]);
  });

  test('explains the empty state and the missing SSH config', () => {
    const empty = mount(RemoteExplorer, { props: { ...baseProps, state: 'empty', hosts: [] } });
    expect(empty.get('[data-testid="remote-empty"]').text()).toMatch(/no ssh hosts/i);

    const missing = mount(RemoteExplorer, { props: { ...baseProps, available: false, hosts: [] } });
    expect(missing.get('[data-testid="remote-unavailable"]').text()).toContain('.ssh');
  });

  test('explains that the remote explorer needs the desktop app in the browser build', () => {
    const wrapper = mount(RemoteExplorer, { props: { ...baseProps, desktop: false, hosts: [] } });
    expect(wrapper.get('[data-testid="remote-desktop-only"]').text()).toMatch(/desktop/i);
    expect(wrapper.find('[data-open="sandkasten"]').exists()).toBe(false);
  });

  test('adds a directory for a host through the form', async () => {
    const wrapper = mount(RemoteExplorer, { props: baseProps });
    await wrapper.get('[data-add="sandkasten"]').trigger('click');
    await wrapper.get('[data-testid="remote-directory-input"]').setValue('/srv/app');
    await wrapper.get('[data-testid="remote-directory-form-sandkasten"]').trigger('submit');
    expect(wrapper.emitted('remember')?.[0]).toEqual([{ host: 'sandkasten', directory: '/srv/app' }]);
  });
});
