import { describe, expect, test } from 'vitest';
import { hostPowerShell, quoteForShell, shellFamily, terminalInterpreter, terminalRunnable, terminalRunCommand } from '../src/terminal/terminalCommand';
import { languageForPath, languageModeLabel } from '../src/editor/language';
import { LOCAL_RUNTIMES } from '../../desktop/src/local-runner.mjs';

describe('shell-aware terminal commands', () => {
  test('names the family the profile reports and falls back to a POSIX shell', () => {
    expect(shellFamily('powershell')).toBe('powershell');
    expect(shellFamily('cmd')).toBe('cmd');
    expect(shellFamily('bash')).toBe('bash');
    expect(shellFamily('wsl')).toBe('wsl');
    expect(shellFamily('nu')).toBe('nu');
    expect(shellFamily('something-else')).toBe('posix');
    expect(shellFamily(undefined)).toBe('posix');
  });

  test('quotes one argument the way each shell expects', () => {
    expect(quoteForShell('powershell', 'hello world.py')).toBe("'hello world.py'");
    expect(quoteForShell('powershell', "it's.py")).toBe("'it''s.py'");
    expect(quoteForShell('cmd', 'hello world.py')).toBe('"hello world.py"');
    expect(quoteForShell('bash', "it's.py")).toBe("'it'\\''s.py'");
    expect(quoteForShell('wsl', 'hello world.py')).toBe("'hello world.py'");
    expect(quoteForShell(undefined, 'hello world.py')).toBe("'hello world.py'");
  });

  test('builds one interpreter command per shell family', () => {
    expect(terminalRunCommand('python', 'main.py', 'powershell')).toBe("python 'main.py'");
    expect(terminalRunCommand('python', 'scripts/hello world.py', 'bash')).toBe("python 'scripts/hello world.py'");
    expect(terminalRunCommand('javascript', 'main.js', 'cmd')).toBe('node "main.js"');
    expect(terminalRunCommand('go', 'main.go', 'posix')).toBe("go run 'main.go'");
    expect(terminalRunCommand('java', 'Main.java', 'wsl')).toBe("java 'Main.java'");
  });

  test('offers nothing for a compiled language, an empty path, or an unrunnable shell argument', () => {
    expect(terminalInterpreter('rust')).toBe('');
    expect(terminalRunCommand('rust', 'main.rs', 'bash')).toBe('');
    expect(terminalRunCommand('python', '', 'bash')).toBe('');
    expect(terminalRunCommand('', 'main.py', 'bash')).toBe('');
    // cmd cannot carry a double quote through, and Win32 file names forbid one.
    expect(terminalRunCommand('python', 'od"d.py', 'cmd')).toBe('');
  });

  test('maps the languages the desktop runner shares with the shell', () => {
    expect(terminalInterpreter('TypeScript')).toBe('node');
    expect(terminalInterpreter('bash')).toBe('bash');
    expect(terminalInterpreter('perl')).toBe('perl');
    expect(terminalInterpreter('c')).toBe('');
    expect(terminalInterpreter(undefined)).toBe('');
  });

  test('runs a PowerShell script through the shell that is in front of the user', () => {
    // In a PowerShell session the file is the command; the call operator keeps a
    // relative path from being read as a bare string.
    expect(terminalRunCommand('powershell', 'main.ps1', 'powershell')).toBe("& 'main.ps1'");
    expect(terminalRunCommand('powershell', "it's.ps1", 'powershell')).toBe("& 'it''s.ps1'");
    // Anywhere else the host PowerShell is asked for the file, with the same
    // policy bypass the local runner uses.
    expect(terminalRunCommand('powershell', 'scripts/main.ps1', 'cmd')).toBe('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/main.ps1"');
    expect(terminalRunCommand('powershell', 'main.ps1', 'bash')).toBe("powershell -NoProfile -ExecutionPolicy Bypass -File 'main.ps1'");
    expect(terminalRunCommand('powershell', 'main.ps1', 'bash', 'linux')).toBe("pwsh -NoProfile -ExecutionPolicy Bypass -File 'main.ps1'");
    // A .ps1 file is offered by the palette, even though no interpreter names it.
    expect(terminalRunnable('powershell')).toBe(true);
    expect(terminalInterpreter('powershell')).toBe('');
    expect(terminalRunnable('rust')).toBe(false);
    expect(terminalRunCommand('powershell', '', 'powershell')).toBe('');
  });

  test('keeps the terminal languages in step with the local runtimes', () => {
    // The binary the terminal types has to be the one the local runner would
    // spawn, or the two backends would disagree about the same file. PowerShell
    // is the one deliberate difference: the runner resolves `pwsh` or
    // `powershell`, while the terminal asks the host PowerShell it knows.
    const hostPowerShellBinary: Record<string, string> = { powershell: hostPowerShell('win32') };
    for (const [language, runtime] of Object.entries(LOCAL_RUNTIMES) as Array<[string, { command?: string; compile?: { command: string } }]>) {
      if (!terminalRunnable(language)) continue;
      const binary = terminalRunCommand(language, 'file', 'posix', 'win32').split(/\s+/)[0];
      const runnerBinary = runtime.command ?? runtime.compile?.command;
      expect({ language, binary }).toEqual({ language, binary: hostPowerShellBinary[language] ?? runnerBinary });
    }
    // The editor opens a .ps1 file as the runtime the runner registers for it.
    expect(languageForPath('main.ps1')).toBe('powershell');
    expect(languageModeLabel('powershell')).toBe('PowerShell');
    expect([...(LOCAL_RUNTIMES.powershell.extensions ?? [])]).toContain('.ps1');
  });
});