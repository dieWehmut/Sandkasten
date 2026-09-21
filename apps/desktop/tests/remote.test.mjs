import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listRemoteHosts,
  openRemoteSession,
  parseSshConfig,
  readKnownDirectories,
  rememberRemoteDirectory,
} from '../src/remote.mjs';

async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

const CONFIG = [
  '# The personal tunnels.',
  '',
  'Host sandkasten',
  '  HostName 192.168.50.11',
  '  User root',
  '  Port 2222',
  '',
  'Host agent',
  '  HostName 192.168.210.2',
  '  User seiii',
  '  HostName ignored-because-first-wins.example',
  '',
  'Include ~/.ssh/other.conf',
  'Host *',
  '  User nobody',
  '  HostName 0.0.0.0',
  '',
  'Host desktop',
  '  HostName 100.114.185.4',
  '  User han',
  '',
  'Host edu ai',
  '  User shared',
  '',
  'Host bare',
  '',
].join('\n');

test('parses the SSH config strictly: comments, blanks, Include, and first-wins keys', () => {
  const hosts = parseSshConfig(CONFIG);
  assert.deepEqual(hosts.map((host) => host.alias), ['sandkasten', 'agent', 'desktop', 'edu', 'ai', 'bare']);
  assert.deepEqual(hosts[0], { alias: 'sandkasten', hostName: '192.168.50.11', user: 'root', port: '2222' });
  // A second HostName never replaces the first one for the same host block.
  assert.equal(hosts[1].hostName, '192.168.210.2');
  assert.equal(hosts[1].user, 'seiii');
  assert.equal(hosts[1].port, '');
  // A wildcard block applies to every host, so it is a pattern, not a host.
  assert.equal(hosts.some((host) => host.alias === '*'), false);
  assert.equal(hosts.some((host) => host.user === 'nobody'), false);
  // A block that names several aliases lists each one against the same values.
  assert.deepEqual(hosts[3], { alias: 'edu', hostName: 'edu', user: 'shared', port: '' });
  assert.deepEqual(hosts[4], { alias: 'ai', hostName: 'ai', user: 'shared', port: '' });
  // A block without HostName falls back to its alias.
  assert.deepEqual(hosts[5], { alias: 'bare', hostName: 'bare', user: '', port: '' });
});

test('reads the host list from the SSH config on disk and the directories known for each one', async (t) => {
  const root = await temporaryDirectory('sandkasten-ssh-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config');
  await writeFile(configPath, CONFIG);

  const result = await listRemoteHosts({ configPath });
  assert.equal(result.available, true);
  assert.equal(result.hosts.length, 6);
  assert.deepEqual(result.hosts[0], {
    alias: 'sandkasten', hostName: '192.168.50.11', user: 'root', port: '2222', directories: [],
  });
});

test('reports a missing SSH config instead of inventing hosts', async (t) => {
  const root = await temporaryDirectory('sandkasten-ssh-missing-');
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await listRemoteHosts({ configPath: path.join(root, 'config') });
  assert.equal(result.available, false);
  assert.deepEqual(result.hosts, []);
});

test('remembers directories per host without touching the SSH config', async (t) => {
  const root = await temporaryDirectory('sandkasten-ssh-store-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config');
  const storePath = path.join(root, 'remote-hosts.json');
  await writeFile(configPath, CONFIG);

  await rememberRemoteDirectory(storePath, { host: 'sandkasten', directory: '/root/sandkasten' });
  await rememberRemoteDirectory(storePath, { host: 'sandkasten', directory: '/root/sandkasten' });
  await rememberRemoteDirectory(storePath, { host: 'agent', directory: '/home/seiii/agent' });

  // The most recently remembered directory is listed first.
  const stored = await readKnownDirectories(storePath);
  assert.deepEqual(stored, [
    { host: 'agent', directory: '/home/seiii/agent' },
    { host: 'sandkasten', directory: '/root/sandkasten' },
  ]);

  const result = await listRemoteHosts({ configPath, storePath });
  assert.deepEqual(result.hosts[0].directories, ['/root/sandkasten']);
  assert.deepEqual(result.hosts[1].directories, ['/home/seiii/agent']);
  assert.deepEqual(result.hosts[2].directories, []);
  // The SSH config is the user's file and is never rewritten by this feature.
  assert.match(await (await import('node:fs/promises')).readFile(configPath, 'utf8'), /Host sandkasten/);
});

test('refuses a directory that is not a plain absolute path and an empty host', async (t) => {
  const root = await temporaryDirectory('sandkasten-ssh-invalid-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'remote-hosts.json');

  await assert.rejects(() => rememberRemoteDirectory(storePath, { host: 'sandkasten', directory: 'relative/dir' }), /path/);
  await assert.rejects(() => rememberRemoteDirectory(storePath, { host: 'sandkasten', directory: '/root/$(whoami)' }), /path/);
  await assert.rejects(() => rememberRemoteDirectory(storePath, { host: 'sandkasten', directory: '/root/x; rm -rf /' }), /path/);
  await assert.rejects(() => rememberRemoteDirectory(storePath, { host: '', directory: '/root' }), /host/);
});

test('opens the ssh command for a host and for a remembered directory', async (t) => {
  const root = await temporaryDirectory('sandkasten-ssh-open-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config');
  await writeFile(configPath, CONFIG);
  const hosts = parseSshConfig(CONFIG);

  const plain = await openRemoteSession({ hosts, host: 'sandkasten' });
  assert.deepEqual(plain, { host: 'sandkasten', command: 'ssh -p 2222 root@192.168.50.11', directory: '' });

  const directory = await openRemoteSession({ hosts, host: 'agent', directory: '/home/seiii/agent' });
  assert.equal(directory.command, "ssh -t seiii@192.168.210.2 'cd /home/seiii/agent && exec $SHELL -l'");
  assert.equal(directory.directory, '/home/seiii/agent');

  await assert.rejects(() => openRemoteSession({ hosts, host: 'nowhere' }), /unknown remote host/);
  await assert.rejects(() => openRemoteSession({ hosts, host: 'agent', directory: '/home/seiii/agent;rm -rf /' }), /path/);
});
