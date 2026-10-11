// Shell-aware command construction for the desktop terminal. The family comes
// from the discovered profile: quoting that works in PowerShell is wrong in a
// POSIX shell, so the builder never guesses beyond a safe default.

export type ShellFamily = 'powershell' | 'cmd' | 'bash' | 'posix' | 'wsl' | 'nu';

// One command that runs a workspace file directly in a shell. Compiled
// languages are absent on purpose: they need a build step, which is what the
// run backend is for.
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
export function terminalRunCommand(language: string | undefined | null, filePath: string | undefined | null, family: string | undefined | null): string {
  const interpreter = terminalInterpreter(language);
  const path = String(filePath ?? '').trim();
  if (!interpreter || !path) return '';
  if (shellFamily(family) === 'cmd' && path.includes('"')) return '';
  return `${interpreter} ${quoteForShell(family, path)}`;
}