import { computed, readonly, ref, type Ref } from 'vue';
import type { Translator } from '../i18n/locale';

export interface PaletteCommand {
  id: string;
  label: string;
  accelerator?: string;
  enabled?: boolean;
  execute(): void | Promise<unknown>;
}

export interface PaletteItem {
  id: string;
  label: string;
  kind: 'file' | 'command' | 'mode';
  detail?: string;
  accelerator?: string;
  recent?: boolean;
}

export function useCommandCenter(options: {
  paths: Readonly<Ref<readonly string[]>>;
  recentPaths: Readonly<Ref<readonly string[]>>;
  commands: Readonly<Ref<readonly PaletteCommand[]>>;
  t: Translator;
  platform?: string;
}) {
  const open = ref(false);
  const query = ref('');
  const availableCommands = computed(() => options.commands.value.filter((command) => command.enabled !== false));
  const items = computed<PaletteItem[]>(() => {
    const value = query.value.trim().toLocaleLowerCase();
    if (value.startsWith('>')) {
      const words = value.slice(1).trim().split(/\s+/);
      return availableCommands.value.filter((command) => words.every((word) =>
        `${command.label} ${command.id}`.toLocaleLowerCase().includes(word),
      )).map((command) => ({ ...command, kind: 'command' }));
    }
    const all = new Set(options.paths.value);
    const recent = options.recentPaths.value.filter((path) => all.has(path));
    const ordered = [...new Set([...recent, ...[...all].sort((a, b) => a.localeCompare(b))])];
    const files: PaletteItem[] = ordered.filter((path) => path.toLocaleLowerCase().includes(value))
      .map((path) => ({
        id: path, label: path.split(/[\\/]/).at(-1) ?? path, kind: 'file',
        detail: path.includes('/') || path.includes('\\') ? path : undefined,
        recent: recent.includes(path),
      }));
    if (value) return files;
    return [{ id: 'palette.commands', label: options.t('palette.commands'), kind: 'mode',
      accelerator: options.platform === 'darwin' ? '⌘⇧P' : 'Ctrl+Shift+P' }, ...files];
  });

  function openPalette(mode: 'files' | 'commands' = 'files'): void {
    query.value = mode === 'commands' ? '>' : '';
    open.value = true;
  }

  return { open: readonly(open), query, items, availableCommands, openPalette, close: () => { open.value = false; } };
}
