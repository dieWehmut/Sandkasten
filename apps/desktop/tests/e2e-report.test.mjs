import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = new URL('../scripts/e2e-ide.mjs', import.meta.url);
const TERMINAL_SOURCE = new URL('../scripts/e2e-terminal.mjs', import.meta.url);
const REFINEMENT_SOURCE = new URL('../scripts/e2e-refinement.mjs', import.meta.url);

/**
 * Fields the run records as evidence for a person rather than a contract: raw
 * theme values, the sidebar preview, screenshot paths and byte counts, the menu
 * shape, informational lists, and the localized phase and badge labels (the
 * locale-independent `data-backend` attribute is what is asserted instead).
 */
const REPORT_ONLY = new Set([
  'activityButtons', 'backend', 'bodyPreview', 'darkScreenshot', 'darkStatusBackground',
  'darkSyntaxColors', 'darkTheme', 'defaultAccentByTheme', 'isolatedRunBackendBadge',
  'lightScreenshot', 'lightSyntaxColors', 'lightTheme', 'localRunBackendBadge', 'localRunPhase',
  'localRuntimes', 'longEditor', 'menu', 'openTabs', 'savedFile', 'setupGuideDismissed', 'theme',
]);

function fields(source) {
  const assigned = new Set();
  for (const match of source.matchAll(/\bchecks\.([A-Za-z_$][\w$]*)\s*=/g)) assigned.add(match[1]);
  const asserted = new Set();
  for (const line of source.split('\n')) {
    if (!/\bassert\./.test(line)) continue;
    for (const match of line.matchAll(/\bchecks\.([A-Za-z_$][\w$]*)/g)) asserted.add(match[1]);
  }
  return { assigned: [...assigned].sort(), asserted };
}

test('every field the IDE run records is asserted or deliberately report-only', () => {
  // A field that is captured and never checked looks like coverage without being
  // any: the isolated run's output sat unasserted until this rule was written.
  const { assigned, asserted } = fields(readFileSync(SOURCE, 'utf8'));
  assert.ok(assigned.length > 40, `expected the run to record its checks, saw ${assigned.length}`);
  const unexplained = assigned.filter((name) => !asserted.has(name) && !REPORT_ONLY.has(name));
  assert.deepEqual(unexplained, [], 'a recorded check needs an assertion, or a place in the report-only list');
});

test('the report-only list does not name fields the run stopped recording', () => {
  const { assigned } = fields(readFileSync(SOURCE, 'utf8'));
  const stale = [...REPORT_ONLY].filter((name) => !assigned.includes(name));
  assert.deepEqual(stale, [], 'a report-only entry for a field nobody records is stale');
});

/** The keys of the object literal a `return { … };` produces, nesting aside. */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if ('{(['.includes(character)) { depth += 1; continue; }
    if ('})]'.includes(character)) { depth -= 1; continue; }
    if (depth !== 1) continue;
    const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(index));
    if (!match) continue;
    keys.push(match[1]);
    index += match[1].length - 1;
  }
  return keys;
}

/** The object literal of the last `return { … }` in a script, braces balanced. */
function returnObject(source) {
  const start = source.lastIndexOf('return {');
  if (start < 0) return '';
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 'return '.length, index + 1);
    }
  }
  return '';
}

test('every flag the terminal run reports is asserted by the refinement run', () => {
  // The flags say which of the terminal steps ran; a step that quietly stopped
  // running would otherwise only show up as a false in a printed report.
  const flags = topLevelKeys(returnObject(readFileSync(TERMINAL_SOURCE, 'utf8')));
  assert.ok(flags.length >= 10, `expected the terminal run to report its flags, saw ${flags.length}`);

  const refinement = readFileSync(REFINEMENT_SOURCE, 'utf8');
  // A flag is asserted either by name in the list the run walks, or directly.
  const unasserted = flags.filter((flag) => !refinement.includes(`'${flag}'`) && !refinement.includes(`terminal.${flag}`));
  assert.deepEqual(unasserted, [], 'a reported flag has to be asserted where the run is driven');
});