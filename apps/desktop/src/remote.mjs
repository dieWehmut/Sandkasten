// Remote hosts for the machine the app runs on. The SSH config is parsed with a
// strict reader, so the renderer never supplies a path, a flag, or a shell
// string: it names a host alias that came out of that parse and, optionally, a
// directory from the remembered list. `~/.ssh/config` itself is never written.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_REMOTE_HOSTS = 200;
export const MAX_REMOTE_DIRECTORIES = 24;
// A remembered directory is also typed into a shell command line by the
// terminal hand-off, so its alphabet stays narrow: no quoting, no separators,
// no whitespace. Only those paths can ever reach a shell.
const DIRECTORY_PATTERN = /^\/[A-Za-z0-9._~/-]*$/;
const HOST_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;
export const SSH_CONFIG_ENV = 'SANDKASTEN_SSH_CONFIG';

export function sshConfigPath(environment = process.env) {
  const override = environment?.[SSH_CONFIG_ENV];
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override.trim());
  return path.join(os.homedir(), '.ssh', 'config');
}

function assertAlias(value, label = 'host') {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`a remote ${label} is required`);
  const alias = value.trim();
  if (alias === '*' || !HOST_ALIAS_PATTERN.test(alias)) throw new Error(`invalid remote ${label}: ${value}`);
  return alias;
}

function assertDirectory(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('a remote directory path is required');
  const directory = value.trim();
  if (!DIRECTORY_PATTERN.test(directory)) throw new Error(`invalid remote directory path: ${value}`);
  return directory;
}

// The part of the SSH config grammar that matters here: a `Host` line opens a
// block, every following keyword belongs to it, and the first value of a
// keyword wins, exactly as OpenSSH resolves it. Comments and blank lines are
// ignored, `Include` is skipped rather than followed, and a wildcard or
// multi-alias block is a pattern rather than a connectable host.
export function parseSshConfig(source) {
  if (typeof source !== 'string') return [];
  const hosts = [];
  const values = { hostName: '', user: '', port: '' };
  let aliases = [];

  const flush = () => {
    for (const alias of aliases) {
      hosts.push({ alias, hostName: values.hostName || alias, user: values.user, port: values.port });
    }
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*)\s*(?:=|\s)\s*(.*)$/.exec(line);
    if (!match) continue;
    const keyword = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"(.*)"$/, '$1');
    if (keyword === 'host') {
      flush();
      const patterns = value.split(/\s+/).filter(Boolean);
      // A pattern (anything with `*`, `?`, or `!`) never names one host, so it
      // is dropped; several plain aliases share the block's values.
      aliases = patterns.filter((alias) => HOST_ALIAS_PATTERN.test(alias));
      values.hostName = ''; values.user = ''; values.port = '';
      continue;
    }
    if (!aliases.length) continue;
    if (keyword === 'include') continue;
    if (keyword === 'hostname' && !values.hostName) values.hostName = value;
    if (keyword === 'user' && !values.user) values.user = value;
    if (keyword === 'port' && !values.port && /^\d{1,5}$/.test(value)) values.port = value;
  }
  flush();

  // A late wildcard block must not become a host of its own; the filter above
  // already guarantees that, and the cap keeps a huge config bounded.
  return hosts.slice(0, MAX_REMOTE_HOSTS);
}

export async function readKnownDirectories(storePath) {
  if (!storePath) return [];
  const raw = await readFile(storePath, 'utf8').catch(() => '');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.directories)) return [];
    return parsed.directories
      .map((entry) => ({ host: String(entry?.host ?? ''), directory: String(entry?.directory ?? '') }))
      .filter((entry) => entry.host && DIRECTORY_PATTERN.test(entry.directory))
      .slice(0, MAX_REMOTE_DIRECTORIES);
  } catch {
    return [];
  }
}

export async function rememberRemoteDirectory(storePath, request) {
  const host = assertAlias(request?.host);
  const directory = assertDirectory(request?.directory);
  const entries = await readKnownDirectories(storePath);
  const next = [{ host, directory }, ...entries.filter((entry) => !(entry.host === host && entry.directory === directory))]
    .slice(0, MAX_REMOTE_DIRECTORIES);
  if (storePath) {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify({ directories: next }, null, 2)}\n`, 'utf8');
  }
  return next;
}

export async function forgetRemoteDirectory(storePath, request) {
  const host = assertAlias(request?.host);
  const directory = assertDirectory(request?.directory);
  const entries = await readKnownDirectories(storePath);
  const next = entries.filter((entry) => !(entry.host === host && entry.directory === directory));
  if (storePath) {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, `${JSON.stringify({ directories: next }, null, 2)}\n`, 'utf8');
  }
  return next;
}

export async function listRemoteHosts({ configPath, storePath } = {}) {
  const source = configPath ? await readFile(configPath, 'utf8').catch(() => '') : '';
  const available = source.trim() !== '';
  const remembered = await readKnownDirectories(storePath);
  const hosts = parseSshConfig(source).map((host) => ({
    ...host,
    directories: remembered.filter((entry) => entry.host === host.alias).map((entry) => entry.directory),
  }));
  return { available, configPath: configPath ?? '', hosts };
}

// The terminal hand-off. The renderer names a host and, optionally, one of the
// directories that is known for it; the command line is composed here so a
// renderer string can never become shell syntax.
export async function openRemoteSession({ hosts, host, directory } = {}) {
  const alias = assertAlias(host);
  const target = Array.isArray(hosts) ? hosts.find((entry) => entry?.alias === alias) : undefined;
  if (!target) throw new Error(`unknown remote host: ${host}`);
  const user = typeof target.user === 'string' && target.user.trim() !== '' ? `${target.user.trim()}@` : '';
  const port = /^\d{1,5}$/.test(String(target.port ?? '')) ? ` -p ${target.port}` : '';
  const destination = `${user}${target.hostName}`;
  if (directory === undefined || directory === null || directory === '') {
    return { host: alias, command: `ssh${port} ${destination}`, directory: '' };
  }
  const remembered = assertDirectory(directory);
  return {
    host: alias,
    command: `ssh${port} -t ${destination} 'cd ${remembered} && exec $SHELL -l'`,
    directory: remembered,
  };
}
