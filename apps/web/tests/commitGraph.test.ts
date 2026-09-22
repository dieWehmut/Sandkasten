import { describe, expect, test } from 'vitest';
import { buildCommitGraph, formatCommitAge } from '../src/editor/commitGraph';
import type { WorkspaceCommit } from '../src/services/desktopBridge';

function commit(partial: Partial<WorkspaceCommit> & { full: string }): WorkspaceCommit {
  return {
    short: partial.full.slice(0, 7),
    subject: 'subject ' + partial.full,
    author: 'Sandkasten',
    date: '2026-09-22T00:00:00+08:00',
    refs: [],
    parents: [],
    committedAt: 0,
    ...partial,
  };
}

describe('commit graph layout', () => {
  test('draws a linear history as a single lane', () => {
    const layout = buildCommitGraph([
      commit({ full: 'c', parents: ['b'] }),
      commit({ full: 'b', parents: ['a'] }),
      commit({ full: 'a' }),
    ]);

    expect(layout.columns).toBe(1);
    expect(layout.rows.map((row) => row.column)).toEqual([0, 0, 0]);
    // The rail is continuous: every row between the ends keeps its lane open.
    expect(layout.rows[0].lanes[0].passThrough).toBe(true);
    expect(layout.rows[2].lanes[0].branchOut).toBe(false);
  });

  test('gives a side branch its own lane and rejoins at the fork point', () => {
    // main: b -> a, topic: t -> a, newest first as git prints them.
    const layout = buildCommitGraph([
      commit({ full: 't', parents: ['a'], refs: ['topic'] }),
      commit({ full: 'b', parents: ['a'], refs: ['main'] }),
      commit({ full: 'a' }),
    ]);

    // The first commit takes the left lane; the second is a different line, so
    // it gets a lane of its own.
    expect(layout.rows[0].column).toBe(0);
    expect(layout.rows[1].column).toBe(1);
    expect(layout.columns).toBe(2);
    // Both branches converge on a, which is drawn back on the left lane.
    expect(layout.rows[2].column).toBe(0);
    // The right lane must reach the fork row so the line is not cut.
    expect(layout.rows[1].lanes.some((lane) => lane.column === 1 && lane.passThrough)).toBe(true);
  });

  test('keeps a merge parent in its own lane without duplicating one', () => {
    const layout = buildCommitGraph([
      commit({ full: 'm', parents: ['b', 't'] }),
      commit({ full: 'b', parents: ['a'] }),
      commit({ full: 't', parents: ['a'] }),
      commit({ full: 'a' }),
    ]);

    expect(layout.rows[0].column).toBe(0);
    // The merge's two parents open two lanes, and neither is repeated.
    const second = layout.rows[1];
    expect(second.column).not.toBe(layout.rows[2].column);
    // Reusing a lane instead of opening a third keeps the rail narrow.
    expect(layout.columns).toBe(2);
  });

  test('reports the age of each commit and formats it compactly', () => {
    const now = 1_000_000_000;
    const layout = buildCommitGraph([
      commit({ full: 'a', committedAt: now - 3 * 24 * 60 * 60 * 1000 }),
      commit({ full: 'b', committedAt: now - 90 * 60 * 1000 }),
    ], now);

    expect(layout.rows[0].age).toBe(3 * 24 * 60 * 60 * 1000);
    expect(formatCommitAge(layout.rows[0].age)).toBe('3d');
    expect(formatCommitAge(layout.rows[1].age)).toBe('1h');
    expect(formatCommitAge(0)).toBe('now');
    expect(formatCommitAge(-5)).toBe('now');
  });
});
