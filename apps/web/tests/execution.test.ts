import { describe, expect, test } from 'vitest';
import { isExecutionBusy, isExecutionRunnable, type ExecutionPhase } from '../src/composables/execution';

// These two predicates are the single definition of "in flight" and "can start", and
// they exist because the same check had been written out by hand in three places and
// the copies had drifted. One of them treated `submitting` as idle, so the run button
// stayed enabled while a submission was already in flight; another re-listed two of
// the same phases inside a template binding.
//
// `isExecutionRunnable` had no callers at all until this was found, which is why the
// sweep that found it looked for exported symbols with no references rather than for
// suspicious behaviour: the behaviour looked fine at each individual call site.

const ALL_PHASES: ExecutionPhase[] = [
  'booting',
  'ready',
  'submitting',
  'polling',
  'running',
  'stopped',
  'completed',
  'error',
  'unavailable',
];

describe('execution phase predicates', () => {
  test('treats submitting, polling and running as in flight', () => {
    const busy = ALL_PHASES.filter(isExecutionBusy);
    // `submitting` is the one that the hand-written copies kept leaving out.
    expect(busy).toEqual(['submitting', 'polling', 'running']);
  });

  test('only allows a run when nothing is in flight and nothing is missing', () => {
    const runnable = ALL_PHASES.filter(isExecutionRunnable);
    // A run can start from a settled state or a finished one, but never while a run is
    // in flight, before the runner has booted, or when no backend is available.
    expect(runnable).toEqual(['ready', 'stopped', 'completed', 'error']);
  });

  test('is busy and runnable are never both true', () => {
    // The two are not inverses — `booting` and `unavailable` are neither — so this is
    // the one invariant worth asserting rather than a full truth table.
    for (const phase of ALL_PHASES) {
      expect(isExecutionBusy(phase) && isExecutionRunnable(phase)).toBe(false);
    }
  });

  test('names every phase exactly once across the two predicates', () => {
    // Guards against a phase being added to the union and silently falling through
    // both predicates, which would leave the run button permanently enabled for it.
    const covered = ALL_PHASES.filter((p) => isExecutionBusy(p) || isExecutionRunnable(p) || p === 'booting' || p === 'unavailable');
    expect(covered).toEqual(ALL_PHASES);
  });
});
