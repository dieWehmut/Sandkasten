// Lane layout for the source control history graph.
//
// The view draws the reference's rail: one dot per commit on its own lane, a
// vertical line through the lanes that are still open, and an elbow where a
// commit joins a parent that sits in another lane. Working out where every
// dot, line, and elbow goes is pure arithmetic over the commit list, so it
// lives here instead of in the component and can be tested without a browser.
import type { WorkspaceCommit } from '../services/desktopBridge';

/** One lane occupied at a given row. */
export interface CommitGraphLane {
  /** Column index, left to right from 0. */
  column: number;
  /** True when this lane's dot belongs to the row's own commit. */
  node: boolean;
  /** True when this lane carries a line entering from the row above. */
  above: boolean;
  /** True when this lane carries a line leaving into the row below. */
  below: boolean;
}

/** A curve from a row's dot into the lane one of its parents lives in. */
export interface CommitGraphElbow {
  /** The lane the curve reaches. */
  column: number;
}

export interface CommitGraphRow {
  commit: WorkspaceCommit;
  /** Index of the commit's own dot. */
  column: number;
  lanes: CommitGraphLane[];
  /** Curves from this commit's dot into the lanes its parents live in. */
  elbows: CommitGraphElbow[];
  /** Relative age in milliseconds, for the row's meta text. */
  age: number;
}

export interface CommitGraphLayout {
  rows: CommitGraphRow[];
  /** Lanes the widest row needs, so the rail can size itself. */
  columns: number;
}

// Commits arrive newest first in topo order, so a lane is opened by the first
// commit that needs it and closed once every child has been drawn.
export function buildCommitGraph(commits: readonly WorkspaceCommit[], now = Date.now()): CommitGraphLayout {
  const rows: CommitGraphRow[] = [];
  // Each lane holds the commit hash it is currently waiting to draw.
  const lanes: (string | null)[] = [];
  let columns = 0;

  for (const commit of commits) {
    // Every lane waiting for this commit belongs to this row. The leftmost one
    // is the commit's own lane -- which keeps a merge's first-parent line on
    // the left -- and any other lane closes into it, because that is a branch
    // that was drawn in its own column and forks back here.
    const waiting: number[] = [];
    for (let lane = 0; lane < lanes.length; lane += 1) {
      if (lanes[lane] === commit.full) waiting.push(lane);
    }
    // The leftmost lane expecting the commit is its own; the others are lines
    // that were drawn beside it and converge here, so they close at this row.
    const column = waiting.length > 0 ? waiting[0] : firstFreeLane(lanes);
    const openBefore = lanes.map((value) => value !== null);
    for (const lane of waiting) lanes[lane] = null;

    const elbows: CommitGraphElbow[] = [];

    // A caller that predates the graph fields still renders: an absent parent
    // list reads as a root commit instead of crashing the rail.
    const parents = (commit.parents ?? []).filter(Boolean);
    // The first parent keeps the commit's own lane, so a normal commit draws
    // one straight line through it. When the parent is already waited for in
    // another lane the own lane closes and the line elbows across instead of
    // opening a second lane for the same commit.
    if (parents[0] && lanes.indexOf(parents[0]) !== column) {
      const existing = lanes.indexOf(parents[0]);
      if (existing === -1) lanes[column] = parents[0];
      // The parent is already expected in another lane, so the line curves
      // across to it instead of opening a second lane for the same commit.
      else elbows.push({ column: existing });
    }
    // A merge opens a lane per extra parent, to the right of every open lane,
    // and reuses a lane that is already waiting for that parent.
    for (let extra = 1; extra < parents.length; extra += 1) {
      const parent = parents[extra];
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        elbows.push({ column: existing });
        continue;
      }
      const target = firstFreeLane(lanes);
      lanes[target] = parent;
      elbows.push({ column: target });
    }
    // A commit that no longer has a parent closes its lane, and trailing empty
    // lanes are trimmed so the rail never draws a line to nowhere.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    const width = Math.max(openBefore.length, lanes.length, column + 1);
    const rowLanes: CommitGraphLane[] = [];
    for (let lane = 0; lane < width; lane += 1) {
      rowLanes.push({
        column: lane,
        node: lane === column,
        above: lane < openBefore.length && openBefore[lane],
        below: lane < lanes.length && lanes[lane] !== null,
      });
    }
    const row: CommitGraphRow = {
      commit,
      column,
      age: commit.committedAt ? Math.max(0, now - commit.committedAt) : 0,
      lanes: rowLanes,
      elbows,
    };
    columns = Math.max(columns, row.lanes.length);
    rows.push(row);
  }

  return { rows, columns };
}

function firstFreeLane(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
}

/** Compact age text for the row: "3d", "2h", "just now". */
export function formatCommitAge(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'now';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo';
  return Math.floor(months / 12) + 'y';
}
