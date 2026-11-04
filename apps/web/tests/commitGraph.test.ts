import { describe, expect, test } from 'vitest';
import {
  GRAPH_LANE_PITCH,
  GRAPH_PALETTE,
  GRAPH_ROW_HEIGHT,
  buildCommitGraph,
  formatCommitAge,
} from '../src/editor/commitGraph';
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

// The reference's own constants: a 22 px row on an 11 px lane pitch.
describe('commit graph geometry matches the reference', () => {
  test('the row is 22 px tall on an 11 px lane pitch', () => {
    expect(GRAPH_ROW_HEIGHT).toBe(22);
    expect(GRAPH_LANE_PITCH).toBe(11);
    // `scmGraph.foreground1..5`
    expect([...GRAPH_PALETTE]).toEqual(['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF']);
  });

  test('a lane centre sits one pitch in from the left edge', () => {
    // `dv * (s + 1)`: column 0 is at 11 px, column 1 at 22 px, and so on.
    const layout = buildCommitGraph([
      commit({ full: 'a', parents: ['b'] }),
      commit({ full: 'b' }),
    ]);
    expect(layout.rows[0].column).toBe(0);
    // One lane needs room for its centre plus one pitch.
    expect(layout.rows[0].width).toBe(GRAPH_LANE_PITCH * 2);
  });

  test('draws a linear history as one continuous lane', () => {
    const layout = buildCommitGraph([
      commit({ full: 'c', parents: ['b'] }),
      commit({ full: 'b', parents: ['a'] }),
      commit({ full: 'a' }),
    ]);

    expect(layout.columns).toBe(1);
    expect(layout.rows.map((row) => row.column)).toEqual([0, 0, 0]);
    // The run above a commit's dot always starts at the row's top edge and the
    // run below it always ends at the bottom, so consecutive rows join into one
    // unbroken line down the rail.
    for (const row of layout.rows) {
      const runs = row.strokes.filter((stroke) => stroke.column === 0);
      expect(runs.every((stroke) => stroke.from === 0 || stroke.from === GRAPH_ROW_HEIGHT / 2)).toBe(true);
      expect(runs.every((stroke) => stroke.to === GRAPH_ROW_HEIGHT || stroke.to === GRAPH_ROW_HEIGHT / 2)).toBe(true);
    }
    // The tip has nothing above it, so its only run hangs from the dot.
    const tip = layout.rows[0].strokes.filter((stroke) => stroke.column === 0);
    expect(tip).toHaveLength(1);
    expect(tip[0]).toMatchObject({ from: GRAPH_ROW_HEIGHT / 2, to: GRAPH_ROW_HEIGHT, active: true });
    // The root has no parent, so no run continues below its dot.
    expect(layout.rows[2].strokes.some((stroke) => stroke.from === GRAPH_ROW_HEIGHT / 2)).toBe(false);
    // A single line needs no curves.
    expect(layout.rows.flatMap((row) => row.curves)).toEqual([]);
  });

  test('gives a side branch its own lane and curves it back at the join', () => {
    // Newest first, as `git log --all --topo-order` prints them.
    const layout = buildCommitGraph([
      commit({ full: 't', parents: ['a'], refs: ['topic'] }),
      commit({ full: 'b', parents: ['a'], refs: ['main'] }),
      commit({ full: 'a' }),
    ]);

    expect(layout.rows[0].column).toBe(0);
    // The second line opens a lane of its own.
    expect(layout.rows[1].column).toBe(1);
    expect(layout.columns).toBe(2);
    // Both join on the shared commit, drawn back on the left lane.
    expect(layout.rows[2].column).toBe(0);
    // Each lane keeps its own palette colour.
    expect(layout.rows[0].dot.color).toBe(GRAPH_PALETTE[0]);
    expect(layout.rows[1].dot.color).toBe(GRAPH_PALETTE[1]);
  });

  test('opens one lane per merge parent rather than repeating a lane', () => {
    const layout = buildCommitGraph([
      commit({ full: 'm', parents: ['b', 't'] }),
      commit({ full: 'b', parents: ['a'], refs: ['main'] }),
      commit({ full: 't', parents: ['a'], refs: ['topic'] }),
      commit({ full: 'a' }),
    ]);

    expect(layout.rows[0].column).toBe(0);
    // The merge's second parent gets a lane to the right, joined by a curve.
    expect(layout.rows[0].curves).toHaveLength(1);
    expect(layout.columns).toBe(2);
    // Reusing the lane keeps the rail narrow instead of opening a third.
    expect(layout.rows[2].column).toBe(1);
    // A merge draws the wider ring around its dot.
    expect(layout.rows[0].dot.kind).toBe('merge');
    expect(layout.rows[0].dot.radius).toBe(5);
  });

  test('keeps a linear history on a single lane however long it is', () => {
    // `git log --pretty=%P` prints a parent's *full* hash, so every commit in a
    // linear history matches the lane the previous row opened. A mismatch here
    // would walk the rail one column to the right per commit.
    const commits = Array.from({ length: 40 }, (_value, index) => commit({
      full: `c${index}`.padEnd(8, '0'),
      parents: index < 39 ? [`c${index + 1}`.padEnd(8, '0')] : [],
    }));
    const layout = buildCommitGraph(commits);

    expect(layout.columns).toBe(1);
    expect(layout.rows.every((row) => row.column === 0)).toBe(true);
    // Every row's rail is one lane wide: the centre plus one pitch.
    expect(new Set(layout.rows.map((row) => row.width))).toEqual(new Set([GRAPH_LANE_PITCH * 2]));
  });

  test('never widens the rail beyond the lanes that are actually open', () => {
    const layout = buildCommitGraph([
      commit({ full: 'm', parents: ['b', 't'] }),
      commit({ full: 'b', parents: ['a'] }),
      commit({ full: 't', parents: ['a'] }),
      commit({ full: 'a' }),
    ]);
    // Two lines means two lanes, never more.
    expect(layout.columns).toBe(2);
    for (const row of layout.rows) {
      expect(row.width).toBeLessThanOrEqual(GRAPH_LANE_PITCH * (layout.columns + 1));
    }
  });

  test('marks the checked-out commit as HEAD', () => {
    const layout = buildCommitGraph([
      commit({ full: 'b', parents: ['a'], isHead: true }),
      commit({ full: 'a' }),
    ]);
    expect(layout.rows[0].head).toBe(true);
    expect(layout.rows[0].dot.kind).toBe('head');
    expect(layout.rows[1].head).toBe(false);
    expect(layout.rows[1].dot.kind).toBe('normal');
  });

  test('leaves no lane open below a branch that has been joined back', () => {
    const layout = buildCommitGraph([
      commit({ full: 't', parents: ['a'] }),
      commit({ full: 'b', parents: ['a'] }),
      commit({ full: 'a' }),
    ]);
    // The root is a single lane and nothing continues past it: the joined lane
    // has closed, so no stroke ends at the bottom edge of the rail.
    const root = layout.rows[2];
    expect(root.strokes.every((stroke) => stroke.to === GRAPH_ROW_HEIGHT / 2)).toBe(true);
    expect(root.strokes.some((stroke) => stroke.from === GRAPH_ROW_HEIGHT / 2)).toBe(false);
  });
});

describe('commit age', () => {
  test('formats each age compactly', () => {
    expect(formatCommitAge(3 * 24 * 60 * 60 * 1000)).toBe('3d');
    expect(formatCommitAge(90 * 60 * 1000)).toBe('1h');
    expect(formatCommitAge(0)).toBe('now');
    expect(formatCommitAge(-5)).toBe('now');
  });
});
