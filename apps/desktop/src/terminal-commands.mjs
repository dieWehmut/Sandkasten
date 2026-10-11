// The commands a shell can actually run are the executables on the session
// PATH, with the profile's own command directories first. Only names leave the
// main process: the directories stay here, and the renderer can never ask for a
// path or an executable of its own choosing.
import { accessSync, constants } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const TERMINAL_COMMAND_LIMITS = Object.freeze({
  directories: 48,
  commands: 300,
  cacheMs: 5 * 60 * 1000,
});

const WINDOWS_DEFAULT_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

function pathKey(environment) {
  return Object.keys(environment).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
}

function onPath(file, platform) {
  try {
    accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
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
} = {}) {
  const windows = platform === 'win32';
  const extensions = windows ? windowsExtensions(environment) : undefined;
  const names = new Map();
  const ceiling = TERMINAL_COMMAND_LIMITS.commands * 2;
  for (const directory of shellSearchPath(profile, environment, platform)) {
    let entries;
    try {
      entries = await listDirectory(directory, { withFileTypes: true });
    } catch {
      // An unreadable PATH entry simply contributes nothing.
      continue;
    }
    for (const entry of entries) {
      const fileName = typeof entry === 'string' ? entry : entry?.name;
      const isFile = typeof entry === 'string' ? true : entry?.isFile?.() === true;
      if (typeof fileName !== 'string' || !fileName || !isFile) continue;
      const name = windows ? commandName(fileName, extensions) : fileName;
      if (!name) continue;
      if (!windows && !isExecutable(path.posix.join(directory, fileName))) continue;
      const identity = windows ? name.toLowerCase() : name;
      if (!names.has(identity)) names.set(identity, name);
      if (names.size >= ceiling) break;
    }
  }
  return [...names.values()]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, TERMINAL_COMMAND_LIMITS.commands);
}

/**
 * A per-profile cache in front of the discovery: opening several sessions of
 * the same shell must not rescan the PATH every time.
 */
export function createCommandCatalog({
  discover = discoverTerminalCommands, now = () => Date.now(), cacheMs = TERMINAL_COMMAND_LIMITS.cacheMs,
} = {}) {
  const cache = new Map();
  return {
    async commands(profile, options) {
      const key = profile?.id ?? '';
      const cached = cache.get(key);
      if (cached && now() - cached.at < cacheMs) return cached.commands;
      const commands = await discover(profile, options);
      cache.set(key, { at: now(), commands });
      return commands;
    },
    clear: () => cache.clear(),
  };
}