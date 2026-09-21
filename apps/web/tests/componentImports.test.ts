// A template tag that no import provides still builds: the bundler only fails
// on a missing *imported* export, so a stale tag name would ship as a blank
// spot in the UI. The renamed TerminalSquare glyph did exactly that, so every
// PascalCase component tag is now checked against what its file imports.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const intrinsic = new Set(['Teleport', 'Transition', 'TransitionGroup', 'KeepAlive', 'Suspense', 'Component']);

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return vueFiles(full);
    return entry.name.endsWith('.vue') ? [full] : [];
  });
}

// The script block is where an import can name a symbol; the template is where
// it is used as a tag.
function blocks(source: string): { script: string; template: string } {
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '';
  const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? '';
  return { script, template };
}

describe('component imports', () => {
  test('every PascalCase tag in a template is imported or declared by its file', () => {
    const files = vueFiles(sourceDirectory);
    expect(files.length).toBeGreaterThan(20);
    const problems: string[] = [];

    for (const file of files) {
      const { script, template } = blocks(readFileSync(file, 'utf8'));
      if (!template) continue;
      const tags = new Set(Array.from(template.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g), (match) => match[1]));
      for (const tag of tags) {
        if (intrinsic.has(tag)) continue;
        // An import, a local declaration, or a `components` option all count.
        const patterns = [
          new RegExp(`import\\s+${tag}\\s+from`),
          new RegExp(`import\\s+\\{[^}]*\\b${tag}\\b[^}]*\\}\\s+from`),
          new RegExp(`(?:const|let|var|function)\\s+${tag}\\b`),
        ];
        if (!patterns.some((pattern) => pattern.test(script))) {
          problems.push(`${file.slice(sourceDirectory.length + 1)}: <${tag}> is never imported or declared`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
