// Lane layout for the source control history graph.
//
// The view draws the reference's rail: one dot per commit on its own lane, a
// vertical line through the lanes that are still open, and curved elbows where
// a commit joins its parents. Working out where every dot, line, and elbow goes
// is pure arithmetic over the commit list, so it lives here instead of in the
// component and can be tested without a browser.
import type { WorkspaceCommit } from '../services/desktopBridge';

/** One lane occupied at a given row. */
export interface CommitGraphLane {
  /** Column index, left to right from 0. */
  column: number;
  /** True when this lane's dot belongs to the row's own commit. */
  node?: boolean;
  /** True when the line above the dot continues into this row. */
  passThrough: boolean;
  /** True when the commit's parents reach into this lane below the dot. */
  branchOut: boolean;
}

export interface CommitGraphRow {
  commit: WorkspaceCommit;
  /** Index of the commit's own dot. */
  column: number;
  lanes: CommitGraphLane[];
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

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    // A lane already waiting for this commit is the commit's own lane; the
    // leftmost one wins so a merge keeps its first-parent line on the left.
    let column = lanes.indexOf(commit.full);
    const continuing = column !== -1;
    if (!continuing) column = firstFreeLane(lanes);

    const row: CommitGraphRow = {
      commit,
      column,
      age: commit.committedAt ? Math.max(0, now - commit.committedAt) : 0,
      lanes: [],
    };

    // Every lane left of the commit's own that is still open passes through the
    // row, which is what keeps the rail continuous.
    const before = lanes.slice();
    // A caller that predates the graph fields still renders: an absent parent
    // list reads as a root commit instead of crashing the rail.
    const parents = (commit.parents ?? []).filter(Boolean);
    // The commit takes its own lane; its first parent keeps that lane so the
    // line continues straight down for a normal commit.
    lanes[column] = parents[0] ?? null;
    // A merge opens a lane per extra parent, to the right of every open lane.
    for (let extra = 1; extra < parents.length; extra += 1) {
      const parent = parents[extra];
      // A parent that already has a lane is reused instead of duplicated.
      if (lanes.includes(parent)) continue;
      lanes[firstFreeLane(lanes)] = parent;
    }
    // A commit that no longer has a parent closes its lane, and trailing empty
    // lanes are trimmed so the rail never draws a line to nowhere.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    const width = Math.max(before.length, lanes.length, column + 1);
    for (let lane = 0; lane < width; lane += 1) {
      const openBefore = lane < before.length && before[lane] !== null;
      const openAfter = lane < lanes.length && lanes[lane] !== null;
      row.lanes.push({
        column: lane,
        node: lane === column,
        passThrough: openBefore || openAfter || lane < column,
        branchOut: openAfter && lane !== column,
      });
    }
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
