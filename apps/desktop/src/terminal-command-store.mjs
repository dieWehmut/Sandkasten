// The command list a shell reports is expensive to build (a cold WSL scan takes
// seconds) and barely changes, so the catalog keeps a copy next to the other
// application state. Reads are forgiving: a missing, unreadable or malformed
// file is simply a cold start.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const COMMAND_STORE_VERSION = 1;

export function createCommandStore(file) {
  return {
    async read() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || parsed.version !== COMMAND_STORE_VERSION) return {};
        const profiles = parsed.profiles;
        return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
      } catch {
        return {};
      }
    },
    async write(profiles) {
      // Write beside the target and rename, so a crash cannot leave a half
      // written cache for the next start to parse.
      const temporary = path.join(path.dirname(file), `${path.basename(file)}.${process.pid}.tmp`);
      await writeFile(temporary, `${JSON.stringify({ version: COMMAND_STORE_VERSION, profiles }, null, 2)}\n`, 'utf8');
      await rename(temporary, file);
    },
  };
}