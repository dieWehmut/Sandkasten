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
    // The rail is continuous: the lane leaves the tip, passes through the
    // middle, and arrives at the root, which closes it.
    expect(layout.rows[0].lanes[0]).toMatchObject({ above: false, below: true });
    expect(layout.rows[1].lanes[0]).toMatchObject({ above: true, below: true });
    expect(layout.rows[2].lanes[0]).toMatchObject({ above: true, below: false });
    // A single line needs no curves.
    expect(layout.rows.flatMap((row) => row.elbows)).toEqual([]);
  });

  test('gives a side branch its own lane and curves it back at the fork', () => {
    // Newest first, as `git log --all --topo-order` prints them: the topic
    // tip, then main, then the commit they share.
    const layout = buildCommitGraph([
      commit({ full: 't', parents: ['a'], refs: ['topic'] }),
      commit({ full: 'b', parents: ['a'], refs: ['main'] }),
      commit({ full: 'a' }),
    ]);

    // The first commit takes the left lane; the second is a different line,
    // so it opens a lane of its own.
    expect(layout.rows[0].column).toBe(0);
    expect(layout.rows[1].column).toBe(1);
    expect(layout.columns).toBe(2);
    // The fork lands on the shared commit, which is drawn back on the left
    // lane: the topic lane carries the line down to it, and main's own lane
    // curves across instead of opening a second lane for the same commit.
    expect(layout.rows[2].column).toBe(0);
    expect(layout.rows[1].elbows).toEqual([{ column: 0 }]);
    // The left lane must stay open through the fork row so the line the
    // topic tip started is not cut, and nothing is open below the join.
    expect(layout.rows[1].lanes[0]).toMatchObject({ above: true, below: true });
    expect(layout.rows[2].lanes[0]).toMatchObject({ above: true, below: false });
  });

  test('opens one lane per merge parent and reuses a lane rather than repeating it', () => {
    const layout = buildCommitGraph([
      commit({ full: 'm', parents: ['b', 't'] }),
      commit({ full: 'b', parents: ['a'], refs: ['main'] }),
      commit({ full: 't', parents: ['a'], refs: ['topic'] }),
      commit({ full: 'a' }),
    ]);

    // The merge is the tip on the left lane and curves out to its second
    // parent's lane; both parents then sit on their own lanes.
    expect(layout.rows[0].column).toBe(0);
    expect(layout.rows[0].elbows).toEqual([{ column: 1 }]);
    expect(layout.rows[1].column).toBe(0);
    expect(layout.rows[2].column).toBe(1);
    // Reusing a lane instead of opening a third keeps the rail narrow.
    expect(layout.columns).toBe(2);
    // Both parents are drawn, and the topic lane has curved into the root
    // lane by the time the root is reached, so only one lane enters it.
    const root = layout.rows[3];
    expect(root.column).toBe(0);
    expect(root.lanes.length).toBe(1);
    expect(root.lanes.filter((lane) => lane.above).length).toBe(1);
  });

  test('leaves no lane open below a branch that has been joined back', () => {
    // The failure this guards: a lane that stays open past its fork keeps
    // drawing a line into rows that have nothing on it.
    const layout = buildCommitGraph([
      commit({ full: 't', parents: ['a'] }),
      commit({ full: 'b', parents: ['a'] }),
      commit({ full: 'a' }),
    ]);

    const last = layout.rows[2];
    expect(last.lanes.length).toBe(1);
    expect(last.lanes.every((lane) => lane.column === 0)).toBe(true);
    // Exactly one lane is still entering the root and none leaves it.
    expect(last.lanes.filter((lane) => lane.above).length).toBe(1);
    expect(last.lanes.filter((lane) => lane.below).length).toBe(0);
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
