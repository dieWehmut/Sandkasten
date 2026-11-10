<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRemoteFleet, type RemoteHost, type SavedDevice } from './composables/use-remote-fleet';
import { useAppearance } from './composables/use-appearance';
import type { JobRecord } from './composables/use-remote-control';
import type { Project } from './projects';
import { isTerminal } from './presentation';
import AppIcon from './components/AppIcon.vue';
import AppearancePage from './components/AppearancePage.vue';
import RunWorkbench from './components/RunWorkbench.vue';
import RunList from './components/RunList.vue';
import RunOutput from './components/RunOutput.vue';
import ProjectEditor from './components/ProjectEditor.vue';
import DevicePage from './views/DevicePage.vue';
import BottomPicker, { type PickerOption } from './components/BottomPicker.vue';
import brandIcon from './assets/brand-icon.png';
const fleet = useRemoteFleet();
const { hosts, panels, projects, error } = fleet;
const { theme, themes, setTheme } = useAppearance();
type Tab = 'dashboard' | 'tasks' | 'projects' | 'settings';
type Screen = Tab | 'devices' | 'appearance' | 'about' | 'editor' | 'output';
const tab = ref<Tab>('dashboard'), screen = ref<Screen>('dashboard'), heading = ref<HTMLElement>();
const navigation: { id: Tab; name: string; icon: string }[] = [
  { id: 'dashboard', name: '控制台', icon: 'dashboard' }, { id: 'tasks', name: '任务', icon: 'agent' }, { id: 'projects', name: '项目', icon: 'folder' }, { id: 'settings', name: '设置', icon: 'settings' },
];
const titles: Record<Screen, string> = { dashboard: '控制台', tasks: '任务', projects: '项目', settings: '设置', devices: '电脑设备', appearance: '主题', about: '关于', editor: '编辑项目', output: '任务详情' };
const statuses: Record<string, string> = { disconnected: '未连接', connecting: '正在连接', connected: '已连接', reconnecting: '正在重连', needs_token: '需要访问令牌' };
const address = ref(''), token = ref(''), name = ref('我的电脑'), connecting = ref(false), hostFilter = ref('all'), runHost = ref('');
const editor = ref<Project | null>(null), outputHost = shallowRef<RemoteHost | null>(null), outputJobId = ref('');
const outputJob = computed(() => outputHost.value?.control.jobs.value.find(j => j.jobId === outputJobId.value));
const shownHosts = computed(() => hostFilter.value === 'all' ? hosts.value : hosts.value.filter(h => h.address === hostFilter.value));
const runtimeCatalog = computed(() => {
  const catalog = new Map(hosts.value.flatMap(h => h.control.runtimes.value.map(r => [r.language, r] as const)));
  return [...catalog.values()].sort((a, b) => a.language.localeCompare(b.language));
});
const columns = ref<1 | 2>(readColumns());
function readColumns(): 1 | 2 { try { return localStorage.getItem('sandkasten.panel-columns') === '1' ? 1 : 2; } catch { return 2; } }
function setColumns(value: 1 | 2) { columns.value = value; try { localStorage.setItem('sandkasten.panel-columns', String(value)); } catch {} }
function secondary() { return !navigation.some(item => item.id === screen.value); }
function navigate(next: Tab) {
  if (secondary()) history.back();
  tab.value = next; screen.value = next;
}
function show(next: Screen) {
  if (secondary()) history.replaceState({ sandkasten: next }, '');
  else history.pushState({ sandkasten: next }, '');
  screen.value = next;
}
function back() { if (secondary()) history.back(); }
function popstate(event: PopStateEvent) {
  const saved = event.state?.sandkasten;
  screen.value = ['devices', 'appearance', 'about', 'editor', 'output'].includes(saved) ? saved : tab.value;
}
onMounted(() => { history.replaceState({ sandkasten: 'home' }, ''); window.addEventListener('popstate', popstate); });
onBeforeUnmount(() => window.removeEventListener('popstate', popstate));
watch(screen, async () => { await nextTick(); window.scrollTo(0, 0); heading.value?.focus(); });
watch(hosts, () => { if (!hosts.value.some(h => h.address === runHost.value)) runHost.value = hosts.value[0]?.address ?? ''; if (hostFilter.value !== 'all' && !hosts.value.some(h => h.address === hostFilter.value)) hostFilter.value = 'all'; });
const hostOptions = computed<PickerOption[]>(() => hosts.value.map(host => ({ value: host.address, label: host.name, description: host.address, status: statuses[host.control.connectionStatus.value], tone: usable(host) ? 'secondary' : 'primary' })));
const filterOptions = computed<PickerOption[]>(() => [{ value: 'all', label: '全部设备', description: `${hosts.value.length} 台电脑` }, ...hostOptions.value]);
function usable(host: RemoteHost) { return ['connected', 'reconnecting'].includes(host.control.connectionStatus.value); }
async function connect(device?: SavedDevice) {
  connecting.value = true;
  try {
    const host = device ? await fleet.connectSaved(device) : await fleet.connectDevice({ address: address.value, token: token.value, name: name.value });
    if (host && host.control.connectionStatus.value === 'connected') { token.value = ''; navigate('dashboard'); }
  } finally { connecting.value = false; }
}
function editDevice(device: SavedDevice) { address.value = device.address; name.value = device.name; token.value = ''; }
async function forget(device: SavedDevice) { const host = hosts.value.find(h => h.address === device.address); if (host) await fleet.forgetHost(host); }
function editProject(project?: Project) { editor.value = project ?? fleet.addProject(runtimeCatalog.value[0]?.language ?? 'go'); show('editor'); }
function openPanel(project: Project, address = runHost.value) {
  const host = hosts.value.find(h => h.address === address);
  if (!host) { error.value = '先连接一台电脑，再打开运行工作栏'; show('devices'); return; }
  if (fleet.openPanel(host, project)) navigate('tasks');
}
function openJob(host: RemoteHost, job: JobRecord) { outputHost.value = host; outputJobId.value = job.jobId; show('output'); void host.control.refresh(); }
</script>
<template>
  <div class="app-shell" :class="{ 'wide-shell': screen === 'tasks' && columns === 2 }">
    <main class="page-content">
      <header class="page-header">
        <button v-if="secondary()" class="back-button" aria-label="返回" @click="back"><AppIcon name="back" /></button>
        <h1 ref="heading" tabindex="-1">{{ titles[screen] }}</h1>
        <button v-if="screen === 'dashboard' || screen === 'tasks'" class="text-button header-action" aria-label="刷新所有设备" @click="fleet.refreshHosts"><AppIcon name="refresh" /></button>
      </header>
      <div v-if="error" class="error-banner" role="alert"><p>{{ error }}</p><button class="text-button" aria-label="关闭提示" @click="error = ''">×</button></div>
      <template v-if="screen === 'dashboard'">
        <p class="page-intro">你的电脑与运行任务</p>
        <div v-if="!hosts.length" class="panel empty-state"><AppIcon name="computer" /><p>连接电脑后，在这里查看运行时与远程任务。</p></div>
        <article v-for="host in hosts" :key="host.address" class="panel device-dashboard">
          <div class="section-line"><span class="icon-disc secondary"><AppIcon name="computer" /></span><div class="row-copy"><h2>{{ host.name }}</h2><small>{{ host.address }}</small></div><span class="connection-badge" :data-status="host.control.connectionStatus.value"><i />{{ statuses[host.control.connectionStatus.value] }}</span></div>
          <p v-if="host.control.error.value" class="hint error-message" role="alert">{{ host.control.error.value }}</p>
          <div class="device-stats"><span><strong>{{ host.control.runtimes.value.length }}</strong>运行时</span><span><strong>{{ host.control.jobs.value.filter(j => !isTerminal(j.status)).length }}</strong>运行中</span><span><strong>{{ host.control.jobs.value.length }}</strong>任务</span></div>
          <div class="output-actions"><button class="tonal-button" @click="runHost = host.address; navigate('projects')"><AppIcon name="folder" />项目</button><button class="tonal-button" @click="hostFilter = host.address; navigate('tasks')">任务</button><button v-if="!usable(host)" class="tonal-button" @click="host.control.connectionStatus.value === 'needs_token' ? (editDevice(host), show('devices')) : fleet.connectSaved(host)">{{ host.control.connectionStatus.value === 'needs_token' ? '更新令牌' : '重连' }}</button></div>
          <details v-if="host.control.runtimes.value.length"><summary>可用运行时</summary><div class="filter-chips runtime-catalog"><span v-for="runtime in host.control.runtimes.value" :key="runtime.language" class="agent-label">{{ runtime.language }} {{ runtime.version }}</span></div></details>
        </article>
        <button class="primary-button full-button" @click="show('devices')"><AppIcon name="computer" />连接电脑</button>
      </template>
      <template v-else-if="screen === 'tasks'">
        <div class="section-line"><h2>运行工作栏</h2><div class="filter-chips"><button :aria-pressed="columns === 1" @click="setColumns(1)">单栏</button><button :aria-pressed="columns === 2" @click="setColumns(2)">双栏</button></div></div>
        <p class="hint">每栏独立编辑项目，在对应电脑编译和运行。</p>
        <div v-if="panels.length" class="workbench-grid" :data-columns="columns"><RunWorkbench v-for="panel in panels" :key="panel.id" :panel="panel" :host="hosts.find(h => h.address === panel.hostAddress)!" @close="fleet.closePanel(panel)" @save="fleet.saveProject(panel.project)" /></div>
        <div v-else class="panel empty-state"><AppIcon name="agent" /><p>从项目页打开运行工作栏。</p><button class="primary-button" @click="navigate('projects')">选择项目</button></div>
        <h2 class="subheading">各设备的任务</h2>
        <BottomPicker v-if="hosts.length" v-model="hostFilter" class="device-filter" label="设备" title="选择电脑设备" description="按设备查看本机提交的任务" :options="filterOptions" inline />
        <section v-for="host in shownHosts" :key="host.address"><h2 class="subheading">{{ host.name }}</h2><p class="hint project-path">{{ host.address }}</p><p v-if="host.control.error.value" class="error-banner" role="alert">{{ host.control.error.value }}</p><RunList v-if="host.control.jobs.value.length" :jobs="host.control.jobs.value" @open="openJob(host, $event)" /><p v-else class="panel hint">这台电脑还没有从本机提交的任务。</p></section>
      </template>
      <template v-else-if="screen === 'projects'">
        <p class="page-intro">保存代码，选择电脑远程运行</p>
        <BottomPicker v-if="hosts.length" v-model="runHost" class="device-filter" label="运行设备" title="选择运行设备" description="项目代码会提交给所选电脑" :options="hostOptions" inline />
        <div class="project-grid"><article v-for="project in projects" :key="project.id" class="panel"><AppIcon name="folder" /><h2>{{ project.name }}</h2><p class="project-path">{{ project.language }} · {{ project.entrypoint || '默认入口' }}</p><div class="output-actions"><button class="primary-button full-button" @click="openPanel(project)">打开运行栏</button><button class="tonal-button" @click="editProject(project)">编辑项目</button></div></article></div>
        <button class="primary-button full-button" @click="editProject()"><AppIcon name="file" />新建项目</button>
      </template>
      <template v-else-if="screen === 'settings'">
        <p class="page-intro">按你的方式使用 Sandkasten</p>
        <div class="list-panel"><button class="list-row" @click="show('devices')"><span class="icon-disc secondary"><AppIcon name="computer" /></span><span class="row-copy"><strong>电脑设备</strong><small>连接与管理电脑</small></span><AppIcon name="chevron" /></button><button class="list-row" @click="show('appearance')"><span class="icon-disc"><AppIcon name="palette" /></span><span class="row-copy"><strong>主题</strong><small>选择你的配色</small></span><AppIcon name="chevron" /></button></div>
        <section class="panel"><h2>工作栏布局</h2><p class="hint">任务页同时显示多个设备和项目</p><div class="filter-chips"><button :aria-pressed="columns === 1" @click="setColumns(1)">单栏</button><button :aria-pressed="columns === 2" @click="setColumns(2)">双栏</button></div></section>
        <div class="list-panel"><button class="list-row" @click="show('about')"><span class="icon-disc"><AppIcon name="info" /></span><span class="row-copy"><strong>关于 Sandkasten</strong><small>远程代码运行工作台</small></span><AppIcon name="chevron" /></button></div>
      </template>
      <DevicePage v-else-if="screen === 'devices'" v-model:address="address" v-model:token="token" v-model:name="name" :devices="hosts" :busy="connecting" :native="Capacitor.isNativePlatform()" @connect="connect" @forget="forget" @edit="editDevice" />
      <AppearancePage v-else-if="screen === 'appearance'" :theme="theme" :themes="themes" @select="setTheme" />
      <template v-else-if="screen === 'editor' && editor"><section class="panel"><ProjectEditor :project="editor" :runtimes="runtimeCatalog" /><div class="output-actions"><button class="primary-button" @click="fleet.saveProject(editor); navigate('projects')">保存项目</button><button class="tonal-button" @click="fleet.removeProject(editor); navigate('projects')">删除项目</button></div></section><p class="hint">项目源码和输入保存在本机；电脑只接收你提交的运行请求。</p></template>
      <template v-else-if="screen === 'output' && outputHost"><p class="page-intro">{{ outputHost.name }}</p><p v-if="outputHost.control.error.value" class="error-banner" role="alert">{{ outputHost.control.error.value }}</p><RunOutput v-if="outputJob" :job="outputJob" :busy="outputHost.control.busy.value" :disabled="!usable(outputHost)" @cancel="outputHost.control.cancel(outputJob.jobId)" @remove="outputHost.control.remove(outputJob.jobId); back()" @refresh="outputHost.control.refresh()" /><p v-else class="panel hint">此任务的本机记录已删除。</p></template>
      <section v-else-if="screen === 'about'" class="panel"><div class="about-brand"><img :src="brandIcon" alt="Sandkasten" width="70" height="70" /><h2>Sandkasten</h2></div><p class="hint">连接自己的电脑，从手机编辑项目，选择电脑提供的运行时，在隔离环境中编译和执行。支持多个设备、独立工作栏、运行输出与停止任务。</p></section>
    </main>
    <nav class="bottom-navigation" aria-label="主导航"><button v-for="item in navigation" :key="item.id" :aria-current="tab === item.id ? 'page' : false" @click="navigate(item.id)"><span class="nav-indicator"><AppIcon :name="item.icon" /></span><span>{{ item.name }}</span></button></nav>
  </div>
</template>
