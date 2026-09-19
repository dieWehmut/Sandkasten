import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
function executable(file) {
  try {
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch { return false; }
}

async function wslDistributions(file) {
  try {
    const { stdout } = await execute(file, ['--list', '--quiet'], {
      windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024, encoding: 'utf16le',
    });
    return stdout.replaceAll('\0', '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch { return []; }
}

// Paths are resolved in the main process; renderer requests select an ID only.
export async function discoverTerminalProfiles({
  platform = process.platform, env = process.env, isExecutable = executable, listWsl = wslDistributions,
} = {}) {
  const profiles = [];
  const add = (id, label, candidates, args) => {
    const file = candidates.filter(Boolean).find(isExecutable);
    if (file && !profiles.some((item) => item.executable === file)) profiles.push({ id, label, executable: file, args });
    return file;
  };
  if (platform === 'win32') {
    const envValue = (key) => env[Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())];
    const join = (...parts) => parts.every(Boolean) ? path.win32.join(...parts) : undefined;
    const system = envValue('SystemRoot') || 'C:\\Windows';
    const programFiles = envValue('ProgramFiles');
    const localPrograms = join(envValue('LOCALAPPDATA'), 'Programs');
    const searchPath = (name) => (envValue('PATH') || '').split(';').filter(Boolean).map((directory) => join(directory.replace(/^"|"$/g, ''), name));
    add('powershell', 'PowerShell', [
      ...searchPath('pwsh.exe'), join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'),
    ], ['-NoLogo']);
    add('windows-powershell', 'Windows PowerShell', [join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')], ['-NoLogo']);
    add('cmd', 'Command Prompt', [join(system, 'System32', 'cmd.exe')], ['/d']);
    const gitPaths = searchPath('git.exe').filter(isExecutable).map((file) => join(path.win32.dirname(file), '..', 'bin', 'bash.exe'));
    add('git-bash', 'Git Bash', [
      join(programFiles, 'Git', 'bin', 'bash.exe'), join(envValue('ProgramFiles(x86)'), 'Git', 'bin', 'bash.exe'),
      join(localPrograms, 'Git', 'bin', 'bash.exe'), ...gitPaths,
    ], ['--login', '-i']);
    const wsl = join(system, 'System32', 'wsl.exe');
    if (isExecutable(wsl) && (await listWsl(wsl)).length) add('wsl', 'WSL', [wsl], []);
  } else {
    const candidates = [env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);
    for (const file of candidates) add(path.posix.basename(file), path.posix.basename(file), [file], ['-l']);
  }
  return profiles.map((profile, index) => ({ ...profile, isDefault: index === 0 }));
}
