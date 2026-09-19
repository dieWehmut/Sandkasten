import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

export const TERMINAL_LIMITS = Object.freeze({
  sessionsPerOwner: 8,
  totalSessions: 32,
  inputBytes: 64 * 1024,
  pendingCharacters: 256 * 1024,
  chunkCharacters: 64 * 1024,
});

function requestObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid terminal request.');
  return value;
}

function dimensions(request) {
  requestObject(request);
  if (!Number.isInteger(request.cols) || request.cols < 2 || request.cols > 500
      || !Number.isInteger(request.rows) || request.rows < 1 || request.rows > 200) {
    throw new Error('Invalid terminal dimensions (2–500 columns, 1–200 rows).');
  }
}

// Main-process ownership is independent of the visible panel: hiding a terminal
// must never tear down its shell. Only explicit close, renderer reload, or quit do.
export function createTerminalHost({ spawn, profiles, getCwd, homeDirectory = homedir(), onData, onExit }) {
  const sessions = new Map();
  let disposed = false;
  const publicProfiles = () => profiles.map(({ id, label, isDefault }) => ({ id, label, isDefault: !!isDefault }));
  function owned(owner, id) {
    const terminal = typeof id === 'string' && sessions.get(id);
    if (!terminal || terminal.owner !== owner) throw new Error('Unknown terminal session.');
    return terminal;
  }
  function remove(terminal, kill = false) {
    sessions.delete(terminal.id);
    clearTimeout(terminal.timer);
    terminal.listeners.forEach((listener) => listener.dispose());
    if (kill && terminal.exitCode === undefined) {
      try { terminal.pty.kill(); } catch { /* The process may already have exited. */ }
    }
  }
  function flush(terminal) {
    clearTimeout(terminal.timer);
    terminal.timer = undefined;
    if (!terminal.attached || !sessions.has(terminal.id)) return;
    const data = terminal.pending;
    terminal.pending = '';
    for (let offset = 0; offset < data.length; offset += TERMINAL_LIMITS.chunkCharacters) {
      onData(terminal.owner, { id: terminal.id, data: data.slice(offset, offset + TERMINAL_LIMITS.chunkCharacters) });
    }
    if (terminal.exitCode !== undefined) {
      onExit(terminal.owner, { id: terminal.id, exitCode: terminal.exitCode });
      remove(terminal);
    }
  }
  return {
    profiles: publicProfiles,
    create(owner, request) {
      dimensions(request);
      if (disposed) throw new Error('The terminal host has shut down.');
      const profile = request.profileId === undefined
        ? profiles.find((item) => item.isDefault) ?? profiles[0]
        : profiles.find((item) => item.id === request.profileId);
      if (!profile) throw new Error('Unknown or unavailable terminal profile.');
      if (sessions.size >= TERMINAL_LIMITS.totalSessions
          || [...sessions.values()].filter((item) => item.owner === owner).length >= TERMINAL_LIMITS.sessionsPerOwner) {
        throw new Error(`Terminal session limit reached (${TERMINAL_LIMITS.sessionsPerOwner} per window).`);
      }
      const cwd = getCwd() || homeDirectory;
      const pty = spawn(profile.executable, profile.args, {
        name: 'xterm-256color', cols: request.cols, rows: request.rows, cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      const terminal = { id: randomUUID(), owner, pty, pending: '', attached: false, listeners: [] };
      sessions.set(terminal.id, terminal);
      terminal.listeners.push(pty.onData((data) => {
        terminal.pending = (terminal.pending + data).slice(-TERMINAL_LIMITS.pendingCharacters);
        if (terminal.attached && !terminal.timer) {
          terminal.timer = setTimeout(() => flush(terminal), 16);
          terminal.timer.unref?.();
        }
      }));
      terminal.listeners.push(pty.onExit(({ exitCode }) => {
        terminal.exitCode = exitCode;
        flush(terminal);
      }));
      return { id: terminal.id, profileId: profile.id, title: profile.label, cwd };
    },
    attach(owner, id) {
      const terminal = owned(owner, id);
      terminal.attached = true;
      flush(terminal);
    },
    write(owner, request) {
      requestObject(request);
      const terminal = owned(owner, request.id);
      if (typeof request.data !== 'string' || Buffer.byteLength(request.data, 'utf8') > TERMINAL_LIMITS.inputBytes) {
        throw new Error('Invalid terminal input (maximum 64 KiB).');
      }
      if (terminal.exitCode !== undefined) throw new Error('The terminal process has exited.');
      terminal.pty.write(request.data);
    },
    resize(owner, request) {
      dimensions(request);
      const terminal = owned(owner, request.id);
      if (terminal.exitCode !== undefined) throw new Error('The terminal process has exited.');
      terminal.pty.resize(request.cols, request.rows);
    },
    close(owner, id) { remove(owned(owner, id), true); },
    disposeOwner(owner) {
      for (const terminal of sessions.values()) if (terminal.owner === owner) remove(terminal, true);
    },
    dispose() {
      disposed = true;
      for (const terminal of sessions.values()) remove(terminal, true);
    },
  };
}
