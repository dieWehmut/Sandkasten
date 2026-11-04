// `.gitignore` parsing for the workspace tree.
//
// The reference marks git-ignored entries rather than hiding them: the Explorer
// setting is `"explorer.excludeGitIgnore": { type: "boolean", default: false }`,
// so by default ignored files stay visible and are tinted with
// `gitDecoration.ignoredResourceForeground` (#8C8C8C in the dark default theme,
// #8E8E90 in the light one). Only when that setting is turned on does the
// Explorer "parse and exclude" them (nls 19644).
//
// So this module answers "is this path ignored?", and the caller decides whether
// to hide it or to mark it. Only the subset of the format the Explorer needs is
// implemented: comments, negation, directory-only and anchored patterns, `**`,
// and character classes. Patterns are matched the way git matches them — against
// the path relative to the .gitignore's own directory.

const GLOBSTAR = '\u0000';

/** Turns one gitignore glob into a regular expression source. */
function globToRegExpSource(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` matches zero or more directories; `/**` matches everything below.
        if (pattern[index + 2] === '/') {
          source += `(?:.*/)?`;
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '[') {
      const end = pattern.indexOf(']', index + 1);
      if (end === -1) {
        source += '\\[';
      } else {
        const body = pattern.slice(index + 1, end);
        // A leading `!` inside the class negates it; git uses the same syntax.
        const negated = body.startsWith('!') || body.startsWith('^');
        const content = negated ? body.slice(1) : body;
        source += `[${negated ? '^' : ''}${content.replaceAll('\\', '\\\\')}]`;
        index = end;
      }
    } else if ('.+^$(){}|\\/'.includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }
  return source;
}

/**
 * Parses one `.gitignore` file into ordered rules.
 *
 * Each rule keeps the gitignore semantics that matter for an Explorer:
 * a trailing `/` restricts it to directories, a leading `!` re-includes, and a
 * pattern containing no internal `/` matches a name at any depth while an
 * anchored one matches from the file's own directory down.
 */
export function parseGitignore(text) {
  if (typeof text !== 'string') return [];
  const rules = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    // Trailing spaces are ignored unless escaped, and a `#` starts a comment.
    const line = rawLine.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) continue;

    let pattern = line;
    const negated = pattern.startsWith('!');
    if (negated) pattern = pattern.slice(1);
    if (pattern === '') continue;

    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);
    // An escaped `!` or `#` is a literal character, not syntax.
    pattern = pattern.replaceAll('\\!', '!').replaceAll('\\#', '#');
    if (pattern === '') continue;

    // A pattern with no `/` (after trimming a trailing one) matches at any depth;
    // otherwise it is anchored to the .gitignore's directory. `**/` counts as a
    // separator, so `docs/**/*.tmp` stays anchored.
    const anchored = pattern.includes('/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);

    rules.push({
      negated,
      directoryOnly,
      anchored,
      source: globToRegExpSource(pattern),
    });
  }
  return rules;
}

function ruleMatches(rule, relativePath, isDirectory) {
  if (rule.directoryOnly && !isDirectory) return false;
  const subject = rule.anchored ? relativePath : relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const pattern = rule.directoryOnly
    // A directory pattern covers the directory and everything under it.
    ? new RegExp(`^${rule.source}(?:/.*)?$`)
    : new RegExp(`^${rule.source}$`);
  return pattern.test(subject);
}

/**
 * Whether a path is covered by an ignored ancestor directory.
 *
 * Git does not re-include anything inside an ignored directory — "it is not
 * possible to re-include a file if a parent directory of that file is excluded" —
 * so a path is ignored when any directory above it matched a directory rule.
 * Without this, `dist/` would hide the folder but keep `dist/a.js` listed once
 * the walk reached inside it.
 */
function isInsideIgnoredDirectory(rules, relativePath) {
  const segments = relativePath.split('/');
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestor = segments.slice(0, depth).join('/');
    if (matchedByDirectoryRule(rules, ancestor)) return true;
  }
  return false;
}

function matchedByDirectoryRule(rules, relativePath) {
  let ignored = false;
  for (const rule of rules) {
    if (!rule.directoryOnly) continue;
    // Only the directory itself matters here; the `(?:/.*)?` suffix would make
    // every descendant look like a match and is applied by the caller instead.
    const subject = rule.anchored ? relativePath : relativePath.slice(relativePath.lastIndexOf('/') + 1);
    const pattern = new RegExp(`^${rule.source}$`);
    if (pattern.test(subject)) ignored = !rule.negated;
  }
  return ignored;
}

/**
 * Builds a predicate over workspace-relative paths.
 *
 * `ignoreFiles` is a list of `{ directory, rules }`, where `directory` is the
 * workspace-relative directory the file governs (`''` for the root). Later rules
 * win, and a deeper .gitignore wins over a shallower one, which is how git layers
 * them. A rule set that ends in a negation can re-include a path an earlier file
 * ignored.
 */
export function createIgnoreMatcher(ignoreFiles) {
  const files = (ignoreFiles ?? [])
    .filter((file) => Array.isArray(file?.rules) && file.rules.length)
    .map((file) => ({ prefix: file.directory ? `${file.directory}/` : '', rules: file.rules }))
    // Shallower first, so a deeper file's rules are applied last.
    .sort((left, right) => left.prefix.length - right.prefix.length);

  return function isIgnored(relativePath, isDirectory = false) {
    if (typeof relativePath !== 'string' || relativePath === '') return false;
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
    let ignored = false;
    for (const file of files) {
      if (file.prefix && !normalized.startsWith(file.prefix)) continue;
      const scoped = normalized.slice(file.prefix.length);
      if (scoped === '') continue;
      // A rule for `dist/` also covers everything inside `dist`, so a file whose
      // ancestor directory matched stays ignored even though no rule names it.
      if (isInsideIgnoredDirectory(file.rules, scoped)) {
        ignored = true;
        continue;
      }
      for (const rule of file.rules) {
        // A directory rule also matches the directory itself, so `build/` marks
        // `src/build`; descendants were already handled above.
        if (rule.directoryOnly && !isDirectory) continue;
        if (!ruleMatches(rule, scoped, isDirectory)) continue;
        ignored = !rule.negated;
      }
    }
    return ignored;
  };
}

/**
 * Reads every `.gitignore` in the tree that the walk has already visited.
 *
 * Directories are taken from the tree rather than by rescanning the disk, so a
 * single pass over what the Explorer is about to show is enough. Nested files are
 * supported because a repository commonly ignores `build/` at the root and then
 * re-includes something inside it.
 */
export function collectGitignoreFiles(tree, readSync) {
  const files = [];
  function walk(nodes, directory) {
    for (const node of nodes ?? []) {
      if (node.type === 'file' && node.name === '.gitignore') {
        const text = readSync(node.path);
        if (typeof text === 'string' && text !== '') {
          files.push({ directory, rules: parseGitignore(text) });
        }
        continue;
      }
      if (node.type === 'directory') walk(node.children, node.path);
    }
  }
  walk(tree, '');
  return files;
}
