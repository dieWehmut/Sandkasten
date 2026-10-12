// The desktop shell is JavaScript, so TypeScript has no declarations for it. The
// WebUI's terminal tests read its runtime table to check the two agree, and this
// declares what they read rather than leaving them with an untyped import. The
// table is keyed by language and every entry needs at least a label.
export interface LocalRuntimeEntry {
  readonly label: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly probe?: readonly string[];
  readonly extensions?: readonly string[];
  readonly compile?: { readonly command: string; readonly args: readonly string[] };
  readonly run?: { readonly command: string; readonly args: readonly string[] };
  readonly native?: boolean;
  readonly timeoutMs?: number;
}

export const LOCAL_RUNTIMES: Readonly<Record<string, LocalRuntimeEntry>>;