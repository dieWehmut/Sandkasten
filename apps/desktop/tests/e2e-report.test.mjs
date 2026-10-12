import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = new URL('../scripts/e2e-ide.mjs', import.meta.url);

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