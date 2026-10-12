// The commands a shell can actually run: the executables on the session PATH
// (the profile's own command directories first) plus the commands the shell
// itself reports, because a PowerShell cmdlet or a bash builtin is not a file on
// the PATH. Only names leave the main process: the directories stay here, and
// the renderer can never ask for a path or an executable of its own choosing.
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export const TERMINAL_COMMAND_LIMITS = Object.freeze({
  directories: 48,
  // A PowerShell host reports well over a thousand cmdlets and functions next to
  // the PATH executables, so the list is bounded well above one shell's worth.
  commands: 2_000,
  cacheMs: 5 * 60 * 1000,
  // How long a persisted list may answer before it has to be re-read: a runtime
  // installed an hour ago shows up on the next scan.
  persistedMs: 60 * 60 * 1000,
  // A WSL session may have to cold-start a distro before it can answer.
  distroTimeoutMs: 30_000,
  // A shell that reports its own commands (PowerShell, bash) gets the same kind
  // of budget: a cold host start is seconds, not milliseconds.
  reportTimeoutMs: 20_000,
});

const WINDOWS_DEFAULT_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

// A distro's PATH belongs to the distro, so its commands are listed from inside
// it. The loop is POSIX sh on purpose: `find -printf` and `compgen` are not
// available in every distribution, and `[ -x ]` is the executable test the
// session itself would apply.
const DISTRO_LIST_COMMANDS = 'IFS=:; for d in $PATH; do [ -d "$d" ] || continue; for f in "$d"/*; do [ -f "$f" ] && [ -x "$f" ] && printf "%s\\n" "${f##*/}"; done; done';

// What a shell can list about itself. `compgen -b` is a bash builtin and answers
// in milliseconds, unlike `compgen -c`, which scans the PATH and never returns
// under MSYS when stdio is piped. cmd has no comparable listing.
const SHELL_COMMAND_REPORTS = Object.freeze({
  powershell: 'Get-Command -CommandType Cmdlet,Function -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name',
  bash: 'compgen -b',
  posix: 'compgen -b',
});

function pathKey(environment) {
  return Object.keys(environment).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
}

function onPath(file, platform) {
  try {
    accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

/** The argv that runs one command in this shell, for a bounded one-shot call. */
export function shellArguments(profile, command) {
  switch (profile?.family) {
    case 'powershell': return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
    case 'cmd': return ['/d', '/c', command];
    case 'wsl': return ['-e', 'sh', '-c', command];
    default: return ['-c', command];
  }
}

// The default one-shot runner: a command whose output is a list of names. A
// shell that never answers contributes nothing.
async function runShellDefault(profile, command, { timeoutMs = TERMINAL_COMMAND_LIMITS.reportTimeoutMs } = {}) {
  if (!profile?.executable) return '';
  try {
    const { stdout } = await execute(profile.executable, shellArguments(profile, command), {
      windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
    });
    return stdout;
  } catch {
    return '';
  }
}

function uniqueNames(lines, limit, windows) {
  const seen = new Set();
  const commands = [];
  for (const line of lines) {
    const name = line.trim();
    if (!name) continue;
    const identity = windows ? name.toLowerCase() : name;
    if (seen.has(identity)) continue;
    seen.add(identity);
    commands.push(name);
    if (commands.length >= limit) break;
  }
  return commands;
}

function windowsExtensions(environment) {
  const declared = String(environment[Object.keys(environment).find((name) => name.toUpperCase() === 'PATHEXT') ?? 'PATHEXT'] ?? '');
  const extensions = declared.split(';').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.startsWith('.'));
  return new Set(extensions.length ? extensions : WINDOWS_DEFAULT_EXTENSIONS);
}

/** The directories a session of this profile searches, in order, without duplicates. */
export function shellSearchPath(profile, environment = process.env, platform = process.platform) {
  const windows = platform === 'win32';
  const normalize = windows ? (value) => path.win32.normalize(value) : (value) => path.posix.normalize(value);
  const separator = windows ? ';' : ':';
  const seen = new Set();
  const directories = [];
  const entries = [...(profile?.pathPrepend ?? []), ...String(environment[pathKey(environment)] ?? '').split(separator)];
  for (const entry of entries) {
    const directory = String(entry ?? '').trim().replace(/^"|"$/g, '');
    if (!directory) continue;
    const key = windows ? directory.toLowerCase() : directory;
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(normalize(directory));
    if (directories.length >= TERMINAL_COMMAND_LIMITS.directories) break;
  }
  return directories;
}

function commandName(fileName, extensions) {
  const extension = path.win32.extname(fileName).toLowerCase();
  if (!extensions.has(extension)) return '';
  return fileName.slice(0, -extension.length);
}

export async function discoverTerminalCommands(profile, {
  platform = process.platform,
  environment = process.env,
  listDirectory = readdir,
  isExecutable = (file) => onPath(file, platform),
  runShell = runShellDefault,
  distroTimeoutMs = TERMINAL_COMMAND_LIMITS.distroTimeoutMs,
  reportTimeoutMs = TERMINAL_COMMAND_LIMITS.reportTimeoutMs,
} = {}) {
  const limit = TERMINAL_COMMAND_LIMITS.commands;
  // A WSL session's PATH belongs to the distro, so the Windows directories
  // cannot describe what it can run; the distro is asked directly instead.
  if (profile?.family === 'wsl') {
    const listing = await runShell(profile, DISTRO_LIST_COMMANDS, { timeoutMs: distroTimeoutMs });
    return uniqueNames(String(listing ?? '').split(/\r?\n/), limit, false);
  }
  const windows = platform === 'win32';
  const extensions = windows ? windowsExtensions(environment) : undefined;
  const seen = new Set();
  const commands = [];
  // Directories are visited in the order the shell itself searches them, and
  // each directory is listed alphabetically. Sorting the whole result instead
  // would drop the tail of the alphabet once the cap is reached, which would
  // hide exactly the tools the user is looking for.
  for (const directory of shellSearchPath(profile, environment, platform)) {
    if (commands.length >= limit) break;
    let entries;
    try {
      entries = await listDirectory(directory, { withFileTypes: true });
    } catch {
      // An unreadable PATH entry simply contributes nothing.
      continue;
    }
    const found = [];
    for (const entry of entries) {
      const fileName = typeof entry === 'string' ? entry : entry?.name;
      const isFile = typeof entry === 'string' ? true : entry?.isFile?.() === true;
      if (typeof fileName !== 'string' || !fileName || !isFile) continue;
      const name = windows ? commandName(fileName, extensions) : fileName;
      if (!name) continue;
      if (!windows && !isExecutable(path.posix.join(directory, fileName))) continue;
      found.push(name);
    }
    found.sort((left, right) => left.localeCompare(right));
    for (const name of found) {
      const identity = windows ? name.toLowerCase() : name;
      if (seen.has(identity)) continue;
      seen.add(identity);
      commands.push(name);
      if (commands.length >= limit) break;
    }
  }
  // A cmdlet or a builtin is a command the shell runs without a file behind it,
  // so the shell is asked for its own list and that joins the PATH names.
  const report = SHELL_COMMAND_REPORTS[profile?.family];
  if (report) {
    const reported = await runShell(profile, report, { timeoutMs: reportTimeoutMs });
    const names = uniqueNames(String(reported ?? '').split(/\r?\n/), limit, windows);
    for (const name of names) {
      const identity = windows ? name.toLowerCase() : name;
      if (seen.has(identity)) continue;
      seen.add(identity);
      commands.push(name);
      if (commands.length >= limit) break;
    }
  }
  return commands;
}

/**
 * A per-profile cache in front of the discovery: opening several sessions of the
 * same shell must not rescan the PATH every time, and a list written to the
 * store survives a restart. A cold WSL scan costs seconds, so a persisted list
 * answers immediately while a background refresh replaces it.
 */
export function createCommandCatalog({
  discover = discoverTerminalCommands, now = () => Date.now(),
  cacheMs = TERMINAL_COMMAND_LIMITS.cacheMs,
  persistedMs = TERMINAL_COMMAND_LIMITS.persistedMs,
  store,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  let hydrated;

  async function hydrate() {
    if (hydrated) return hydrated;
    hydrated = (async () => {
      try {
        const record = await store?.read?.();
        for (const [key, entry] of Object.entries(record ?? {})) {
          if (entry && Number.isFinite(entry.at) && Array.isArray(entry.commands)) cache.set(key, { at: entry.at, commands: entry.commands });
        }
      } catch {
        // A missing or unreadable cache is simply a cold start.
      }
      return cache;
    })();
    return hydrated;
  }

  // Caching is best effort: a store that cannot be written must not fail a
  // palette that already has its answer.
  async function persist() {
    if (!store?.write) return;
    try { await store.write(Object.fromEntries(cache)); } catch { /* best effort */ }
  }

  function refresh(profile, options) {
    const key = profile?.id ?? '';
    const running = pending.get(key);
    if (running) return running;
    const task = (async () => {
      try {
        const commands = await discover(profile, options);
        // Only a real list is remembered. An empty result is what a cold or
        // unreachable shell answers with, and caching it would hide the commands
        // even after the shell could report them.
        if (commands.length) {
          cache.set(key, { at: now(), commands });
          await persist();
        } else cache.delete(key);
        return commands;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, task);
    return task;
  }

  return {
    async commands(profile, options) {
      const key = profile?.id ?? '';
      await hydrate();
      const cached = cache.get(key);
      if (cached) {
        const age = now() - cached.at;
        if (age < cacheMs) return cached.commands;
        // Still fresh enough to answer with: hand back what we have and refresh
        // in the background, so the caller never waits for a cold shell again.
        if (age < persistedMs) {
          void refresh(profile, options);
          return cached.commands;
        }
      }
      return refresh(profile, options);
    },
    clear: () => cache.clear(),
  };
}