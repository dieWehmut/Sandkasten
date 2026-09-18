// Window title for the desktop shell: the reference names the open file and its
// workspace in the title bar, which is how a window is told apart from another
// copy of the same app. Kept as a pure function so the format is testable
// without a window.
export interface TitleParts {
  appName: string;
  workspace?: string;
  file?: string;
  dirty?: boolean;
}

/**
 * Compose the title as `<file><dirty> — <workspace> — <app>` and fall back to
 * just the app name before any workspace is open, so the title never starts
 * with a separator or shows an empty slot.
 */
export function windowTitle({ appName, workspace, file, dirty = false }: TitleParts): string {
  const fileName = String(file ?? '').trim();
  const workspaceName = String(workspace ?? '').trim();
  const parts: string[] = [];
  if (fileName) parts.push(`${fileName}${dirty ? ' •' : ''}`);
  if (workspaceName) parts.push(workspaceName);
  parts.push(appName);
  return parts.join(' \u2014 ');
}