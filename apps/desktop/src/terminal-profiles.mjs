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

// A profile carries three things beyond its executable: `family` tells callers
// how to ask that shell for a one-shot command, `args` opens the interactive
// session, and `pathPrepend` names the directories that hold the shell's own
// command set. Prepending those directories is what makes a Git Bash session
// find `git`, `ls`, `sed` and `ssh`, and a PowerShell session find its modules,
// while the renderer only ever sees an opaque profile id.
export async function discoverTerminalProfiles({
  platform = process.platform, env = process.env, isExecutable = executable, listWsl = wslDistributions,
} = {}) {
  const windows = platform === 'win32';
  const normalize = windows ? (file) => path.win32.normalize(file) : (file) => path.posix.normalize(file);
  const dirname = windows ? path.win32.dirname : path.posix.dirname;
  const profiles = [];
  const seen = new Set();
  const identity = (file) => windows ? file.toLowerCase() : file;
  const add = (id, label, family, candidates, args, commandDirs = () => []) => {
    const file = candidates.filter(Boolean).map(normalize).find((candidate) => !seen.has(identity(candidate)) && isExecutable(candidate));
    if (!file) return undefined;
    seen.add(identity(file));
    const pathPrepend = [...new Set(commandDirs(file).filter(Boolean).map(normalize))];
    profiles.push({ id, label, family, executable: file, args, pathPrepend });
    return file;
  };
  // `…/usr/bin/bash.exe` is MSYS2/Cygwin layout; `…/bin/bash.exe` is Git for
  // Windows. Both keep their coreutils beside the shell instead of on PATH.
  const bashDirectories = (file) => {
    const bin = dirname(file);
    const home = /[\\/]usr[\\/]bin$/.test(bin) ? path.win32.resolve(bin, '..', '..') : path.win32.resolve(bin, '..');
    return [bin, path.win32.join(home, 'usr', 'bin'), path.win32.join(home, 'mingw64', 'bin'), path.win32.join(home, 'clang64', 'bin')];
  };

  if (windows) {
    const envValue = (key) => env[Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())];
    const join = (...parts) => parts.every(Boolean) ? path.win32.join(...parts) : undefined;
    const system = envValue('SystemRoot') || 'C:\\Windows';
    const programFiles = envValue('ProgramFiles');
    const programFilesX86 = envValue('ProgramFiles(x86)');
    const systemDrive = envValue('SystemDrive') || 'C:';
    const localPrograms = join(envValue('LOCALAPPDATA'), 'Programs');
    const searchPath = (name) => (envValue('PATH') || '').split(';').filter(Boolean).map((directory) => join(directory.replace(/^"|"$/g, ''), name));
    // A PATH entry only wins a candidate slot when it is the layout it claims:
    // system32\bash.exe is the WSL launcher, not MSYS2 or Cygwin.
    const pathShells = (pattern) => searchPath('bash.exe').filter((file) => pattern.test(file));
    const gitRoots = [
      join(programFiles, 'Git'), join(programFilesX86, 'Git'), join(localPrograms, 'Git'),
      ...searchPath('git.exe').map((file) => join(dirname(file), '..')),
    ];

    add('powershell', 'PowerShell', 'powershell', [
      ...searchPath('pwsh.exe'), join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'),
      join(envValue('LOCALAPPDATA'), 'Microsoft', 'WindowsApps', 'pwsh.exe'),
      join(systemDrive, 'ProgramData', 'chocolatey', 'bin', 'pwsh.exe'),
    ], ['-NoLogo'], (file) => [dirname(file)]);
    add('windows-powershell', 'Windows PowerShell', 'powershell', [
      ...searchPath('powershell.exe'),
      join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ], ['-NoLogo'], (file) => [dirname(file)]);
    add('cmd', 'Command Prompt', 'cmd', [join(system, 'System32', 'cmd.exe')], ['/d']);
    add('git-bash', 'Git Bash', 'bash', [
      ...gitRoots.flatMap((root) => [join(root, 'bin', 'bash.exe'), join(root, 'usr', 'bin', 'bash.exe')]),
    ], ['--login', '-i'], bashDirectories);
    const msysRoots = [
      join(programFiles, 'msys64'), join(programFilesX86, 'msys64'), join(systemDrive, 'msys64'),
      ...pathShells(/[\\/]msys2?[\\/]/i).map((file) => path.win32.resolve(dirname(file), '..', '..')),
    ];
    add('msys2', 'MSYS2', 'bash', [
      ...msysRoots.flatMap((root) => [join(root, 'usr', 'bin', 'bash.exe'), join(root, 'bin', 'bash.exe')]),
      ...pathShells(/[\\/]msys2?[\\/]/i),
    ], ['--login', '-i'], bashDirectories);
    const cygwinRoots = [join(systemDrive, 'cygwin64'), join(systemDrive, 'cygwin'), join(programFiles, 'Cygwin')];
    add('cygwin', 'Cygwin', 'bash', [
      ...cygwinRoots.flatMap((root) => [join(root, 'bin', 'bash.exe')]),
      ...pathShells(/[\\/]cygwin/i),
    ], ['--login', '-i'], (file) => [dirname(file)]);
    add('nu', 'NuShell', 'nu', [
      ...searchPath('nu.exe'), join(programFiles, 'Nu', 'bin', 'nu.exe'),
      join(envValue('USERPROFILE'), '.cargo', 'bin', 'nu.exe'),
      join(envValue('LOCALAPPDATA'), 'Programs', 'nu', 'bin', 'nu.exe'),
      join(systemDrive, 'ProgramData', 'chocolatey', 'bin', 'nu.exe'),
      join(systemDrive, 'ProgramData', 'scoop', 'shims', 'nu.exe'),
    ], [], (file) => [dirname(file)]);
    const wsl = join(system, 'System32', 'wsl.exe');
    if (isExecutable(wsl) && (await listWsl(wsl)).length) add('wsl', 'WSL', 'wsl', [wsl], [], (file) => [dirname(file)]);
  } else {
    const shellFamily = (name) => name === 'bash' ? 'bash' : name === 'nu' ? 'nu' : 'posix';
    const login = env.SHELL;
    if (login) add(path.posix.basename(login), path.posix.basename(login), shellFamily(path.posix.basename(login)), [login], ['-l']);
    for (const name of ['zsh', 'bash', 'sh', 'fish', 'nu', 'ksh', 'dash', 'tcsh']) {
      add(name, name, shellFamily(name), [`/bin/${name}`, `/usr/bin/${name}`, `/usr/local/bin/${name}`], ['-l']);
    }
  }
  return profiles.map((profile, index) => ({ ...profile, isDefault: index === 0 }));
}