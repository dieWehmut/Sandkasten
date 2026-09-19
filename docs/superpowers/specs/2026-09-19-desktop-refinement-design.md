# Desktop welcome, setup scrolling, and terminal

This continues session `01a0b832-0f3f-7330-bb5b-f72e4efd72fb` and its latest
user request. The four supplied screenshots show a quiet empty editor, an
unwanted connection-error banner, and VS Code's interactive terminal with shell
profiles and session controls. The earlier title row, palette, tray, workspace,
local execution, browser, and distribution contracts remain in scope.

## Requested behavior

1. Tray settings contain Setup Guide and API Endpoint; no theme toggle.
2. The setup guide scrolls with the wheel at desktop and compact sizes, on
   first launch and when reopened. Its bottom actions remain reachable.
3. With no open file, the editor shows the Sandkasten mark and a small set of
   working, localized actions with accurate shortcuts, following the reference
   image's quiet centered arrangement. No editor toolbar or empty breadcrumbs
   occupy that state.
4. A failed runtime connection does not produce the standalone red
   `Failed to fetch` strip. The existing connection indicator and endpoint
   dialog remain available; explicit run failures still appear in run output.
5. Desktop users have a real interactive terminal in the bottom panel:
   installed shell profiles, new sessions, switching, split panes, close,
   keyboard input, command output, resize, and interrupt. Closing/hiding the
   panel retains sessions. Quitting the app disposes its processes.

## Terminal architecture

The main process owns `node-pty` sessions. A dedicated IPC module accepts only
the trusted bundled top-level renderer, validates all requests, and keeps each
session owned by its creating webContents. The renderer can select discovered
profile IDs, never arbitrary executable paths. Sessions start in the opened
workspace, or the user's home directory when no workspace is open. They are
ordinary local shells with the user's permissions, separate from sandboxed runs.

The shared Vue UI uses xterm.js and its fit addon. Only desktop exposes the
terminal capability; Pages and local browser UI continue to work without it.
Theme colors follow existing tokens. Each session retains its own xterm buffer
and process while switching output tabs, hiding the panel, or visiting setup.
Output arriving during session creation is retained until the renderer attaches.

Bridge contract:

```ts
type TerminalProfile = { id: string; label: string; isDefault?: boolean };
type TerminalSession = { id: string; profileId: string; title: string; cwd: string };
interface TerminalBridge {
  profiles(): Promise<TerminalProfile[]>;
  create(request: { profileId?: string; cols: number; rows: number }): Promise<TerminalSession>;
  write(request: { id: string; data: string }): Promise<void>;
  resize(request: { id: string; cols: number; rows: number }): Promise<void>;
  close(id: string): Promise<void>;
  onData(handler: (event: { id: string; data: string }) => void): () => void;
  onExit(handler: (event: { id: string; exitCode: number }) => void): () => void;
}
```

The implementation may add a bounded attach/replay handshake to prevent initial
output loss. Native PTY binaries must work in both unpacked development and the
packaged Windows application. Installed PowerShell, cmd, Git Bash, and WSL
profiles are discovered rather than listing unavailable shells.

## Verification and delivery

Each task has focused behavioral tests and its own commits. Real Electron
checks exercise setup wheel scrolling, welcome actions, failure-banner removal,
interactive terminal state/input/output/interrupt/resize/split/close, and existing
IDE behaviors. Browser responsive smoke checks preserve the shared UI. The
versioned web distribution remains exactly four files. Build and smoke the
Windows package with its native terminal dependency, review the integrated
changes, then push the completed branches and main to origin.
