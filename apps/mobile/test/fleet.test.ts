import { createRenderer, nextTick } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRemoteFleet } from '../src/composables/use-remote-fleet';
import { credentials } from '../src/credentials';
import type { Job } from '../src/client';
import { credentialKey } from '../src/composables/use-remote-control';
type RenderNode = { parent?: RenderNode };
const renderer = createRenderer<RenderNode, RenderNode>({ insert: (node, parent) => { node.parent = parent; }, remove: node => { delete node.parent; }, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: node => node.parent ?? null, nextSibling: () => null, patchProp: () => {} });
let storage: Map<string, string>, tokens: Map<string, string>, requests: { address: string; path: string; body: Record<string, unknown> }[], mounted: { unmount: () => void }[];
let running: Map<string, Job>, online: boolean, sequence: number;
function mountFleet() {
  let fleet!: ReturnType<typeof useRemoteFleet>;
  const app = renderer.createApp({ setup() { fleet = useRemoteFleet(); return () => null; } });
  app.mount({}); const instance = { fleet, unmount: () => app.unmount() }; mounted.push(instance); return instance;
}
beforeEach(() => {
  vi.useFakeTimers(); storage = new Map(); tokens = new Map(); requests = []; mounted = []; running = new Map(); online = true; sequence = 0;
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  vi.spyOn(credentials, 'get').mockImplementation(async ({ key }) => ({ value: tokens.get(key) ?? null }));
  vi.spyOn(credentials, 'set').mockImplementation(async ({ key, value }) => { tokens.set(key, value); });
  vi.spyOn(credentials, 'remove').mockImplementation(async ({ key }) => { tokens.delete(key); });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input), body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ address: url.origin, path: url.pathname, body });
    if (!online) throw new Error('offline');
    if ((init.headers as Record<string, string>).Authorization !== `Bearer ${url.hostname}-token`) return new Response(JSON.stringify({ message: 'bad token' }), { status: 401 });
    if (url.pathname === '/v1/runtimes') return Response.json({ runtimes: [{ language: 'go', status: 'active', default_entrypoint: 'main.go' }, { language: 'python', status: 'active' }, { language: 'new-runtime', status: 'active' }] });
    if (url.pathname === '/v1/run') { const job = { jobId: `${url.hostname}-${++sequence}`, status: 'JOB_STATUS_RUNNING', language: body.language }; running.set(job.jobId, job); return Response.json(job, { status: 202 }); }
    const id = url.pathname.split('/')[3]; const job = running.get(id);
    if (!job) return Response.json({ message: 'not found' }, { status: 404 });
    if (url.pathname.endsWith('/cancel')) { running.set(id, { ...job, status: 'JOB_STATUS_CANCELED', stdout: 'stopped' }); return Response.json({ jobId: id, status: 'JOB_STATUS_CANCELED' }); }
    return Response.json(job);
  }));
});
afterEach(() => { for (const app of mounted) app.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const connect = (fleet: ReturnType<typeof useRemoteFleet>, computer: string) => fleet.connectDevice({ address: computer, name: computer, token: `${computer}-token` });
it('keeps multi-device code drafts, submissions, output and stopping independent', async () => {
  const { fleet } = mountFleet(); const first = (await connect(fleet, 'first'))!, second = (await connect(fleet, 'second'))!;
  const project = fleet.projects.value[0];
  const left = fleet.openPanel(first, project)!, right = fleet.openPanel(second, project)!;
  left.project.source = 'left source'; right.project.source = 'right source';
  const job1 = (await first.control.submit(left.project))!, job2 = (await second.control.submit(right.project))!;
  left.selectedJobId.value = job1.jobId; right.selectedJobId.value = job2.jobId;
  await first.control.cancel(job1.jobId);
  expect(first.control.jobs.value[0].status).toBe('JOB_STATUS_CANCELED'); expect(second.control.jobs.value[0].status).toBe('JOB_STATUS_RUNNING');
  expect(requests.filter(r => r.path === '/v1/run').map(r => [r.address, r.body.source])).toEqual([['http://first:8080', 'left source'], ['http://second:8080', 'right source']]);
  expect(project.source).not.toBe('left source'); expect(right.project.source).toBe('right source');
  expect(JSON.stringify([...storage.values()])).not.toContain('first-token');
});
it('closing a workbench does not cancel its remote job', async () => {
  const { fleet } = mountFleet(); const host = (await connect(fleet, 'first'))!;
  const panel = fleet.openPanel(host, fleet.projects.value[0])!;
  const job = (await host.control.submit(panel.project))!;
  fleet.closePanel(panel); await vi.advanceTimersByTimeAsync(1000);
  expect(fleet.panels.value).toHaveLength(0); expect(running.get(job.jobId)?.status).toBe('JOB_STATUS_RUNNING');
  expect(requests.some(r => r.path.endsWith('/cancel'))).toBe(false);
});
it('saves source projects explicitly and restores devices, panels, selected jobs and final output after restart', async () => {
  const first = mountFleet(); const host = (await connect(first.fleet, 'first'))!;
  const panel = first.fleet.openPanel(host, first.fleet.projects.value[0])!;
  panel.project.source = 'saved code'; first.fleet.saveProject(panel.project);
  const job = (await host.control.submit(panel.project))!; panel.selectedJobId.value = job.jobId; await nextTick();
  first.unmount(); running.set(job.jobId, { ...job, status: 'JOB_STATUS_SUCCEEDED', stdout: 'completed while closed' });
  const second = mountFleet(); await second.fleet.connectSaved({ address: host.address, name: host.name });
  expect(second.fleet.hosts.value).toHaveLength(1); expect(second.fleet.panels.value).toHaveLength(1);
  expect(second.fleet.panels.value[0].project.source).toBe('saved code'); expect(second.fleet.panels.value[0].selectedJobId.value).toBe(job.jobId);
  expect(second.fleet.hosts.value[0].control.jobs.value[0].stdout).toBe('completed while closed');
});
it('keeps offline workbench preferences available during reconnect', async () => {
  const first = mountFleet(); const host = (await connect(first.fleet, 'first'))!;
  first.fleet.openPanel(host, first.fleet.projects.value[0]); first.unmount(); online = false;
  const second = mountFleet(); await second.fleet.connectSaved({ address: host.address, name: host.name });
  expect(second.fleet.panels.value).toHaveLength(1); expect(second.fleet.hosts.value[0].control.connectionStatus.value).toBe('disconnected');
  online = true; await second.fleet.connectSaved({ address: host.address, name: host.name });
  expect(second.fleet.panels.value).toHaveLength(1); expect(second.fleet.hosts.value[0].control.connectionStatus.value).toBe('connected');
});
it('forgets one device credentials and panel metadata without touching another', async () => {
  const { fleet } = mountFleet(); const first = (await connect(fleet, 'first'))!, second = (await connect(fleet, 'second'))!;
  fleet.openPanel(first, fleet.projects.value[0]); fleet.openPanel(second, fleet.projects.value[0]);
  await fleet.forgetHost(first);
  expect(fleet.hosts.value.map(h => h.name)).toEqual(['second']); expect(fleet.panels.value).toHaveLength(1);
  expect(tokens.has(credentialKey(first.address))).toBe(false); expect(tokens.has(credentialKey(second.address))).toBe(true);
  expect(storage.get('sandkasten.panels')).not.toContain(first.address);
});
it('offers the runtime catalog provided by the computer without a fixed language list', async () => {
  const { fleet } = mountFleet(); const host = (await connect(fleet, 'first'))!;
  expect(host.control.runtimes.value.map(r => r.language)).toContain('new-runtime');
  const project = fleet.addProject('new-runtime'); project.source = 'runtime source';
  expect(await host.control.submit(project)).toMatchObject({ language: 'new-runtime' });
});
it('does not resurrect a device after it is forgotten during a held connection response', async () => {
  const { fleet } = mountFleet(); let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const connection = connect(fleet, 'first'); const host = fleet.hosts.value[0];
  await fleet.forgetHost(host); finish(Response.json({ runtimes: [{ language: 'go' }] })); await connection;
  expect(fleet.hosts.value).toEqual([]); expect(tokens.has(credentialKey(host.address))).toBe(false);
});
it('does not let a closed workbench late submission replace a reopened workbench selection', async () => {
  const { fleet } = mountFleet(); const host = (await connect(fleet, 'first'))!;
  const project = fleet.projects.value[0], old = fleet.openPanel(host, project)!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const submission = host.control.submit(old.project).then(job => { if (job) old.selectedJobId.value = job.jobId; });
  fleet.closePanel(old); const reopened = fleet.openPanel(host, project)!;
  finish(Response.json({ jobId: 'late-old-job', status: 'JOB_STATUS_SUCCEEDED' }, { status: 202 })); await submission; await nextTick();
  expect(reopened.selectedJobId.value).toBe('');
  expect(JSON.parse(storage.get('sandkasten.panels')!)[0].selectedJobId).toBe('');
});
