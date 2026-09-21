// The renderer never runs git itself: the desktop bridge owns the repository
// state, and the browser build says what is missing instead of inventing it.
import { desktopBridge } from './desktopBridge';
import type { WorkspaceRepositoryStatus } from './desktopBridge';

export const SOURCE_CONTROL_NEEDS_DESKTOP = 'Source control needs the desktop app: it reads the folder you opened.';

function bridge() {
  const desktop = desktopBridge();
  if (!desktop) throw new Error(SOURCE_CONTROL_NEEDS_DESKTOP);
  return desktop.workspace;
}

export async function readRepositoryStatus(): Promise<WorkspaceRepositoryStatus> {
  return bridge().status();
}

export async function stageRepositoryChanges(paths: string[]): Promise<WorkspaceRepositoryStatus> {
  return bridge().stage({ paths });
}

export async function commitRepositoryChanges(message: string): Promise<WorkspaceRepositoryStatus> {
  return bridge().commit({ message });
}
