import { effectScope, markRaw, onMounted, onScopeDispose, ref, shallowRef, watch, type Ref, type EffectScope, type WatchStopHandle } from 'vue';
import { useRemoteControl, readDevices, saveDevices, type SavedDevice } from './use-remote-control';
import { normalizeAddress } from '../client';
import { newProject, readProjects, type Project } from '../projects';
export type { SavedDevice } from './use-remote-control';
export type RemoteHost = SavedDevice & { control: ReturnType<typeof useRemoteControl>; scope: EffectScope };
export interface RunPanel { id: string; hostAddress: string; project: Project; selectedJobId: Ref<string> }
interface PanelMetadata { hostAddress: string; projectId: string; selectedJobId: string }
export function useRemoteFleet() {
  const hosts = shallowRef<RemoteHost[]>([]), panels = shallowRef<RunPanel[]>([]), projects = ref<Project[]>(readProjects()), error = ref('');
  let disposed = false;
  const panelWatchers = new Map<RunPanel, WatchStopHandle>();
  const connecting = new Map<string, Promise<RemoteHost | null>>();
  function spawn(device: SavedDevice): RemoteHost {
    const scope = effectScope(true);
    const control = scope.run(() => useRemoteControl(device))!;
    return markRaw({ ...device, scope, control });
  }
  function persistDevices() {
    try { saveDevices(hosts.value.map(({ address, name }) => ({ address, name }))); } catch { error.value = '无法保存电脑设备'; }
  }
  function panelMetadata(): PanelMetadata[] {
    try {
      const data: unknown = JSON.parse(localStorage.getItem('sandkasten.panels') ?? '[]');
      return Array.isArray(data) ? data.filter((p) => typeof p?.hostAddress === 'string' && typeof p?.projectId === 'string').slice(0, 12) : [];
    } catch { return []; }
  }
  let remembered = panelMetadata();
  function persistPanels() {
    try { localStorage.setItem('sandkasten.panels', JSON.stringify(remembered)); } catch { error.value = '无法保存工作栏'; }
  }
  async function connectSaved(device: SavedDevice): Promise<RemoteHost | null> {
    let address: string;
    try { address = normalizeAddress(device.address); } catch (cause) { error.value = String(cause); return null; }
    if (disposed) return null;
    if (connecting.has(address)) return connecting.get(address)!;
    const task = (async () => {
      let host = hosts.value.find((h) => h.address === address);
      if (!host) { host = spawn({ ...device, address }); hosts.value = [...hosts.value, host]; }
      await host.control.connect();
      if (disposed || !hosts.value.includes(host)) return null;
      restore(host);
      return host;
    })().finally(() => connecting.delete(address));
    connecting.set(address, task);
    return task;
  }
  async function connectDevice(form: { address: string; name: string; token: string }) {
    error.value = '';
    let address: string;
    try { address = normalizeAddress(form.address); } catch (cause) { error.value = String(cause); return null; }
    let host = hosts.value.find((h) => h.address === address);
    if (!host) { host = spawn({ address, name: form.name.trim() || address }); hosts.value = [...hosts.value, host]; }
    const success = await host.control.connect(form.token.trim());
    if (disposed || !hosts.value.includes(host)) return null;
    if (!success) { error.value = host.control.error.value; return null; }
    host.name = form.name.trim() || address;
    hosts.value = [...hosts.value]; persistDevices(); restore(host);
    return host;
  }
  function restore(host: RemoteHost) {
    for (const saved of remembered.filter((p) => p.hostAddress === host.address)) {
      const project = projects.value.find((p) => p.id === saved.projectId);
      if (project) { const panel = openPanel(host, project); if (panel) panel.selectedJobId.value = saved.selectedJobId || ''; }
    }
  }
  function openPanel(host: RemoteHost, project: Project) {
    if (disposed || !hosts.value.includes(host)) return null;
    const id = JSON.stringify([host.address, project.id]);
    const old = panels.value.find((p) => p.id === id);
    if (old) return old;
    if (panels.value.length >= 12) { error.value = '最多打开 12 个工作栏，请先关闭一个'; return null; }
    const panel: RunPanel = markRaw({ id, hostAddress: host.address, project: refClone(project), selectedJobId: ref('') });
    panels.value = [...panels.value, panel];
    panelWatchers.set(panel, watch(panel.selectedJobId, () => remember(panel)));
    remembered = [...remembered.filter((p) => !(p.hostAddress === host.address && p.projectId === project.id)), { hostAddress: host.address, projectId: project.id, selectedJobId: '' }];
    persistPanels(); return panel;
  }
  function refClone(project: Project) {
    // Drafts belong to a particular device/project panel. Saving is explicit.
    return ref(JSON.parse(JSON.stringify(project)) as Project).value;
  }
  function remember(panel: RunPanel) {
    if (!panels.value.includes(panel)) return;
    remembered = remembered.map((p) => p.hostAddress === panel.hostAddress && p.projectId === panel.project.id ? { ...p, selectedJobId: panel.selectedJobId.value } : p);
    persistPanels();
  }
  function closePanel(panel: RunPanel) {
    panelWatchers.get(panel)?.(); panelWatchers.delete(panel);
    panels.value = panels.value.filter((p) => p !== panel);
    remembered = remembered.filter((p) => !(p.hostAddress === panel.hostAddress && p.projectId === panel.project.id));
    persistPanels();
  }
  async function forgetHost(host: RemoteHost) {
    for (const panel of [...panels.value].filter((p) => p.hostAddress === host.address)) closePanel(panel);
    remembered = remembered.filter((p) => p.hostAddress !== host.address); persistPanels();
    hosts.value = hosts.value.filter((h) => h !== host); persistDevices();
    await host.control.forget(); host.scope.stop();
  }
  async function refreshHosts() { await Promise.all(hosts.value.map((h) => h.control.connectionStatus.value === 'connected' || h.control.connectionStatus.value === 'reconnecting' ? h.control.refresh() : h.control.connect())); }
  function saveProject(project: Project) {
    const clone = JSON.parse(JSON.stringify(project)) as Project;
    const index = projects.value.findIndex((p) => p.id === clone.id);
    if (index >= 0) projects.value[index] = clone; else projects.value.push(clone);
  }
  function addProject(language = 'go') { const project = newProject(language); projects.value.push(project); return project; }
  function removeProject(project: Project) {
    projects.value = projects.value.filter((p) => p.id !== project.id);
    for (const panel of [...panels.value].filter((p) => p.project.id === project.id)) closePanel(panel);
  }
  watch(projects, () => { try { localStorage.setItem('sandkasten.projects', JSON.stringify(projects.value)); } catch { error.value = '项目保存失败，请检查手机存储空间'; } }, { deep: true, immediate: true });
  onMounted(() => { for (const device of readDevices()) void connectSaved(device); });
  onScopeDispose(() => { disposed = true; for (const stop of panelWatchers.values()) stop(); panelWatchers.clear(); for (const host of hosts.value) host.scope.stop(); });
  return { hosts, panels, projects, error, connectSaved, connectDevice, openPanel, closePanel, forgetHost, refreshHosts, saveProject, addProject, removeProject };
}
