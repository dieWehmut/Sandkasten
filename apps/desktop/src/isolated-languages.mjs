// Which languages the isolated backend can drive, and how. The map lives in the
// main process on purpose: the renderer picks a language, never a command, the
// same rule the terminal profiles follow.
//
// `tools` is what the distro has to provide for that language; detection asks
// the distro about every tool and reports the languages it can actually run.
// Compiled languages need both a compiler and a shell to build and then run the
// artifact: `gcc main.c` alone only writes a.out and exits successfully.
const buildAndRun = (compiler) => [
  'd=$(mktemp -d) || exit 1',
  `${compiler} "$1" -o "$d/payload" || { rm -rf "$d"; exit 1; }`,
  '"$d/payload"',
  'status=$?',
  'rm -rf "$d"',
  'exit $status',
].join('; ');

export const ISOLATED_LANGUAGES = Object.freeze({
  python: { command: 'python3', args: ['{file}'], tools: ['python3'] },
  javascript: { command: 'node', args: ['{file}'], tools: ['node'] },
  c: { command: 'sh', args: ['-c', buildAndRun('gcc'), 'sandkasten', '{file}'], tools: ['sh', 'gcc'] },
  cpp: { command: 'sh', args: ['-c', buildAndRun('g++'), 'sandkasten', '{file}'], tools: ['sh', 'g++'] },
  java: { command: 'java', args: ['{file}'], tools: ['java'] },
  bash: { command: 'bash', args: ['{file}'], tools: ['bash'] },
  perl: { command: 'perl', args: ['{file}'], tools: ['perl'] },
});

export function isolatedLanguageIds() {
  return Object.keys(ISOLATED_LANGUAGES);
}

/** Every distro binary the isolated languages need, without duplicates. */
export function isolatedTools(languages = ISOLATED_LANGUAGES) {
  return [...new Set(Object.values(languages).flatMap((entry) => entry.tools))];
}

/** The command plan for a language, or undefined when isolation cannot run it. */
export function isolatedRunPlan(language) {
  const key = String(language ?? '').trim().toLowerCase();
  const entry = ISOLATED_LANGUAGES[key];
  if (!entry) return undefined;
  return { language: key, command: entry.command, args: [...entry.args] };
}

/** Which languages every required tool is present for. */
export function isolatedLanguagesFrom(tools, languages = ISOLATED_LANGUAGES) {
  const available = new Set(tools);
  return Object.fromEntries(
    Object.entries(languages).map(([language, entry]) => [language, entry.tools.every((tool) => available.has(tool))]),
  );
}