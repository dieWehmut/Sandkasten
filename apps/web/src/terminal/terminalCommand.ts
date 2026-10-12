// Shell-aware command construction for the desktop terminal. The family comes
// from the discovered profile: quoting that works in PowerShell is wrong in a
// POSIX shell, so the builder never guesses beyond a safe default.

export type ShellFamily = 'powershell' | 'cmd' | 'bash' | 'posix' | 'wsl' | 'nu';

// One command that runs a workspace file directly in a shell. Compiled
// languages are absent on purpose: they need a build step, which is what the
// run backend is for. PowerShell is handled separately below, because a script
// file is not an argument to an interpreter.
const TERMINAL_INTERPRETERS: Readonly<Record<string, string>> = {
  python: 'python',
  javascript: 'node',
  typescript: 'node',
  go: 'go run',
  java: 'java',
  ruby: 'ruby',
  php: 'php',
  bash: 'bash',
  lua: 'lua',
  perl: 'perl',
};

/** The host PowerShell: Windows ships Windows PowerShell, elsewhere it is pwsh. */
export function hostPowerShell(platform: string | undefined | null): string {
  return String(platform ?? '').toLowerCase() === 'win32' ? 'powershell' : 'pwsh';
}

export function shellFamily(family: string | undefined | null): ShellFamily {
  switch (String(family ?? '').toLowerCase()) {
    case 'powershell': return 'powershell';
    case 'cmd': return 'cmd';
    case 'bash': return 'bash';
    case 'wsl': return 'wsl';
    case 'nu': return 'nu';
    default: return 'posix';
  }
}

export function terminalInterpreter(language: string | undefined | null): string {
  return TERMINAL_INTERPRETERS[String(language ?? '').toLowerCase()] ?? '';
}

/** Whether one shell command can run this language's files at all. */
export function terminalRunnable(language: string | undefined | null): boolean {
  const name = String(language ?? '').toLowerCase();
  return name === 'powershell' || Boolean(TERMINAL_INTERPRETERS[name]);
}

/** Quote one argument the way the target shell expects. */
export function quoteForShell(family: string | undefined | null, value: string): string {
  const text = String(value);
  switch (shellFamily(family)) {
    // PowerShell: a literal quote is doubled inside a single-quoted string.
    case 'powershell': return `'${text.replaceAll("'", "''")}'`;
    // cmd has no escape inside double quotes; Win32 file names cannot contain a
    // double quote either, so callers reject those paths instead.
    case 'cmd': return `"${text.replaceAll('"', '""')}"`;
    // POSIX shells, WSL and NuShell: close, escape, reopen.
    default: return `'${text.replaceAll("'", "'\\''")}'`;
  }
}

/**
 * The command that runs `filePath` in the given shell, or '' when the language
 * has no single-command interpreter or the path cannot be represented safely.
 */
export function terminalRunCommand(
  language: string | undefined | null,
  filePath: string | undefined | null,
  family: string | undefined | null,
  platform: string | undefined | null = 'win32',
): string {
  const name = String(language ?? '').toLowerCase();
  const interpreter = terminalInterpreter(name);
  const path = String(filePath ?? '').trim();
  if (!path) return '';
  if ((!interpreter && name !== 'powershell') || path.includes('"') && shellFamily(family) === 'cmd') return '';

  // A PowerShell session runs its own script files, and the call operator is
  // what keeps a relative path from being read as a bare string. Anywhere else
  // the host PowerShell is asked for the file, with the same policy bypass the
  // local runner uses: a default Windows client policy blocks script files.
  if (name === 'powershell') {
    const quoted = quoteForShell(family, path);
    return shellFamily(family) === 'powershell'
      ? `& ${quoted}`
      : `${hostPowerShell(platform)} -NoProfile -ExecutionPolicy Bypass -File ${quoted}`;
  }
  return `${interpreter} ${quoteForShell(family, path)}`;
}