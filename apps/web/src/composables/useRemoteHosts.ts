// The renderer never parses the SSH config itself: the desktop bridge owns the
// host list and the remembered directories, and the browser build says what is
// missing instead of inventing hosts.
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { RemoteBridge, RemoteHost, RemoteHostList, RemoteSession } from '../services/desktopBridge';

export type RemoteExplorerState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface RemoteHostsController {
  state: Ref<RemoteExplorerState>;
  hosts: Ref<RemoteHost[]>;
  available: Ref<boolean>;
  configPath: Ref<string>;
  error: Ref<string | undefined>;
  hostCount: ComputedRef<number>;
  directoryCount: ComputedRef<number>;
  load(): Promise<void>;
  remember(host: string, directory: string): Promise<void>;
  forget(host: string, directory: string): Promise<void>;
  open(host: string, directory?: string, profileId?: string): Promise<RemoteSession>;
}

export const REMOTE_NEEDS_DESKTOP = 'Remote hosts need the desktop app: it reads your SSH config.';

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRemoteHosts(bridge: RemoteBridge | undefined): RemoteHostsController {
  const state = ref<RemoteExplorerState>('idle');
  const hosts = ref<RemoteHost[]>([]);
  const available = ref(false);
  const configPath = ref('');
  const error = ref<string>();

  const hostCount = computed(() => hosts.value.length);
  const directoryCount = computed(() => hosts.value.reduce((total, host) => total + host.directories.length, 0));

  function apply(list: RemoteHostList): void {
    hosts.value = list.hosts;
    available.value = list.available;
    configPath.value = list.configPath;
    state.value = list.hosts.length ? 'ready' : 'empty';
  }

  async function load(): Promise<void> {
    if (!bridge) {
      hosts.value = [];
      available.value = false;
      error.value = REMOTE_NEEDS_DESKTOP;
      state.value = 'error';
      return;
    }
    state.value = 'loading';
    error.value = undefined;
    try {
      apply(await bridge.list());
    } catch (cause) {
      hosts.value = [];
      available.value = false;
      error.value = messageFrom(cause);
      state.value = 'error';
    }
  }

  async function remember(host: string, directory: string): Promise<void> {
    if (!bridge) throw new Error(REMOTE_NEEDS_DESKTOP);
    error.value = undefined;
    try {
      apply(await bridge.remember({ host, directory }));
    } catch (cause) {
      error.value = messageFrom(cause);
      state.value = 'error';
      throw cause;
    }
  }

  async function forget(host: string, directory: string): Promise<void> {
    if (!bridge) throw new Error(REMOTE_NEEDS_DESKTOP);
    error.value = undefined;
    apply(await bridge.forget({ host, directory }));
  }

  async function open(host: string, directory?: string, profileId?: string): Promise<RemoteSession> {
    if (!bridge) throw new Error(REMOTE_NEEDS_DESKTOP);
    return bridge.open({ host, directory, profileId });
  }

  return { state, hosts, available, configPath, error, hostCount, directoryCount, load, remember, forget, open };
}
