import { describe, expect, test } from 'vitest';
import { quoteForShell, shellFamily, terminalInterpreter, terminalRunCommand } from '../src/terminal/terminalCommand';

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
});