// The renderer never walks the filesystem itself: the desktop bridge owns the
// search, and the browser build says so instead of inventing results.
import { desktopBridge } from './desktopBridge';

export interface WorkspaceSearchMatch {
  line: number;
  text: string;
}

export interface WorkspaceSearchFile {
  path: string;
  name: string;
  matches: WorkspaceSearchMatch[];
}

export interface WorkspaceSearchResult {
  query: string;
  caseSensitive: boolean;
  files: WorkspaceSearchFile[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
}

export const SEARCH_NEEDS_DESKTOP = 'Search needs the desktop app: it reads the folder you opened.';

export async function searchWorkspace(query: string, caseSensitive = false): Promise<WorkspaceSearchResult> {
  const bridge = desktopBridge();
  if (!bridge) throw new Error(SEARCH_NEEDS_DESKTOP);
  return bridge.workspace.search({ query, caseSensitive });
}
