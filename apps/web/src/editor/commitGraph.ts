// Lane layout for the source control history graph.
//
// The geometry is copied from the reference (measured, not guessed): in
// `workbench.desktop.main.js` the graph constants are
//
//   var ZW = 22,   // row height
//       dv = 11,   // half a row: every vertical position and the lane pitch
//       l_e = 5,   // curve radius used by the tight S-bend
//       _ee = 4,   // dot radius
//       que = 2;   // dot stroke width
//
// and every element sits at `dv * (column + 1)`, so column 0's centre is 11 px
// from the left edge and each further lane adds another 11 px. A row's SVG is
// `dv * (lanes + 1)` wide and 22 px tall, which is also the reference's
// `history-item` height. The lane palette cycles through five colours:
// `scmGraph.foreground1..5` = #FFB000, #DC267F, #994F00, #40B0A6, #B66DFF.
//
// Working this out is pure arithmetic over the commit list, so it lives here
// instead of in the component and can be tested without a browser.
import type { WorkspaceCommit } from '../services/desktopBridge';

/** Row height of the reference's graph, in pixels. */
export const GRAPH_ROW_HEIGHT = 22;
/** Half the row height, which is also the lane pitch. */
export const GRAPH_LANE_PITCH = 11;
/** Dot radius. */
export const GRAPH_DOT_RADIUS = 4;
/** Dot stroke width. */
export const GRAPH_DOT_STROKE = 2;
/** Radius of the curve where a line changes lane. */
export const GRAPH_CURVE_RADIUS = 5;

/**
 * The reference's lane palette, in cycle order: `scmGraph.foreground1..5`.
 * A lane keeps the colour it was opened with, so a branch stays one hue all the
 * way down the rail.
 */
export const GRAPH_PALETTE = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF'] as const;

/** A vertical run of one lane's line through a row. */
export interface CommitGraphStroke {
  column: number;
  /** Palette colour of the lane this line belongs to. */
  color: string;
  /** Pixel the line starts at on the row's 0–22 vertical scale. */
  from: number;
  /** Pixel the line ends at. */
  to: number;
  /** True for the lane the row's own commit sits on. */
  active: boolean;
}

/** A curve where a line moves sideways between two lanes. */
export interface CommitGraphCurve {
  /** SVG path data, already in the row's pixel space. */
  path: string;
  color: string;
}

export interface CommitGraphDot {
  column: number;
  color: string;
  radius: number;
  /** Outline width; the filled outer ring of a merge is stroke-only. */
  strokeWidth: number;
  kind: 'normal' | 'head' | 'merge';
}

export interface CommitGraphRow {
  commit: WorkspaceCommit;
  /** Index of the commit's own dot. */
  column: number;
  strokes: CommitGraphStroke[];
  curves: CommitGraphCurve[];
  dot: CommitGraphDot;
  /** Width the row's rail needs, in pixels. */
  width: number;
  /** True when HEAD points at this commit, which draws the highlighted ring. */
  head: boolean;
}

export interface CommitGraphLayout {
  rows: CommitGraphRow[];
  /** Lanes the widest row needs, so the rail can size itself. */
  columns: number;
}

interface Lane {
  /** Commit hash the lane is waiting to draw. */
  id: string;
  color: string;
  /** Palette index it was opened with, so a reopened lane keeps its hue. */
  slot: number;
}

/** Shared edge between two rows, derived from the lanes each one holds. */
function nextColor(slot: number): string {
  return GRAPH_PALETTE[slot % GRAPH_PALETTE.length];
}

/**
 * Builds the rail for a commit list in the order the reference draws it.
 *
 * The model mirrors the reference's `inputSwimlanes`/`outputSwimlanes` pair: the
 * lanes entering a row from above and the lanes leaving it below. A commit takes
 * the leftmost lane already waiting for it; its first parent inherits that lane,
 * extra parents open or reuse lanes to the right, and a lane closes once nothing
 * is waiting for it.
 */
export function buildCommitGraph(commits: readonly WorkspaceCommit[]): CommitGraphLayout {
  const rows: CommitGraphRow[] = [];
  // Lanes carried into the next row; a `null` marks a column that has closed but
  // is still needed so the lanes to its right keep their columns.
  let incoming: (Lane | null)[] = [];
  let columns = 0;
  // Palette slot handed to the next lane that has to be opened. It only moves
  // forward, so lanes opened later keep their own hue.
  let slot = -1;

  for (const commit of commits) {
    const parents = (commit.parents ?? []).filter(Boolean);
    // A commit's own lane is the leftmost one already waiting for it; otherwise
    // it opens a new lane at the first free column. Lanes are positional arrays
    // so a column keeps its index for as long as the lane lives.
    let own = incoming.findIndex((lane) => lane?.id === commit.full);
    const opened = own === -1;
    if (opened) {
      // A new line takes a lane nothing else occupies. Reusing a closed column
      // keeps a linear history on a single lane instead of walking rightwards.
      slot += 1;
      own = incoming.findIndex((lane) => lane === null);
      if (own === -1) own = incoming.length;
      incoming = [...incoming];
      incoming[own] = { id: commit.full, color: nextColor(slot), slot };
    }
    const ownLane = incoming[own] as Lane;

    // Lanes leaving the row: the commit's own lane continues into its first
    // parent, extra parents open their own lanes, and every other lane passes
    // straight through untouched.
    const outgoing: (Lane | null)[] = incoming.map((lane) => (lane ? { ...lane } : null));
    // Every other lane that was also waiting for this commit closes here: the
    // branches have joined, so leaving one open would draw a line into rows that
    // have nothing on it.
    for (let column = 0; column < outgoing.length; column += 1) {
      if (column !== own && outgoing[column]?.id === commit.full) outgoing[column] = null;
    }
    outgoing[own] = parents[0] ? { id: parents[0], color: ownLane.color, slot: ownLane.slot } : null;

    const curves: CommitGraphCurve[] = [];
    for (let index = 1; index < parents.length; index += 1) {
      const parent = parents[index];
      let target = outgoing.findIndex((lane) => lane?.id === parent);
      if (target === -1) {
        target = outgoing.findIndex((lane) => lane === null);
        if (target === -1) target = outgoing.length;
        slot += 1;
        outgoing[target] = { id: parent, color: nextColor(slot), slot };
      }
      // The extra parent's lane is joined by a curve that leaves the row's dot,
      // drops to the mid line, runs across, and continues down.
      const from = GRAPH_LANE_PITCH * (own + 1);
      const to = GRAPH_LANE_PITCH * (target + 1);
      const radius = GRAPH_CURVE_RADIUS;
      const mid = GRAPH_ROW_HEIGHT / 2;
      curves.push({
        path: from === to
          ? `M ${from} 0 V ${GRAPH_ROW_HEIGHT}`
          : `M ${from} 0 V ${mid - radius} A ${radius} ${radius} 0 0 0 ${from - radius} ${mid} `
            + `H ${to + radius} A ${radius} ${radius} 0 0 1 ${to} ${mid + radius} V ${GRAPH_ROW_HEIGHT}`,
        color: (outgoing[target] as Lane).color,
      });
    }

    // Trailing closed lanes are trimmed so the rail never reserves space for a
    // line that no longer exists; the empty positions inside are kept so a
    // surviving lane does not slide sideways.
    while (outgoing.length && !outgoing[outgoing.length - 1]) outgoing.pop();
    // The row is as wide as its widest live lane, not as wide as the tree once
    // was: a row that has closed a branch stops drawing room for it.
    const width = Math.max(
      own + 1,
      incoming.reduce((last, lane, column) => (lane ? column + 1 : last), 0),
      outgoing.reduce((last, lane, column) => (lane ? column + 1 : last), 0),
    );
    columns = Math.max(columns, width);

    const strokes: CommitGraphStroke[] = [];
    for (let column = 0; column < width; column += 1) {
      const above = incoming[column];
      const below = outgoing[column];
      if (column !== own) {
        if (below) {
          // A lane that stays open runs straight through the row: one line, edge
          // to edge, drawn once even though both halves of the row know about it.
          strokes.push({ column, color: below.color, from: 0, to: GRAPH_ROW_HEIGHT, active: false });
        } else if (above) {
          // A lane that closes into this commit stops at the mid line and runs
          // across to the dot, which is how a joined branch reads: it arrives
          // rather than continuing past.
          strokes.push({ column, color: above.color, from: 0, to: GRAPH_ROW_HEIGHT / 2, active: false });
          const mid = GRAPH_ROW_HEIGHT / 2;
          if (column !== own) {
            curves.push({
              path: `M ${GRAPH_LANE_PITCH * (column + 1)} ${mid} H ${GRAPH_LANE_PITCH * (own + 1)}`,
              color: above.color,
            });
          }
        }
        continue;
      }
      // The row's own lane: a lane that was already open draws down to the dot,
      // and the lane continues below it into the first parent.
      if (above && !opened) {
        strokes.push({ column, color: above.color, from: 0, to: GRAPH_ROW_HEIGHT / 2, active: true });
      }
      if (below) {
        strokes.push({ column, color: below.color, from: GRAPH_ROW_HEIGHT / 2, to: GRAPH_ROW_HEIGHT, active: true });
      }
    }

    const isHead = commit.isHead === true;
    const isMerge = parents.length > 1;
    rows.push({
      commit,
      column: own,
      strokes,
      curves,
      dot: {
        column: own,
        color: ownLane.color,
        // A merge draws the same dot inside a ring one pixel wider; HEAD draws
        // the ring as well and stays hollow, the way the reference marks it.
        radius: isMerge || isHead ? GRAPH_DOT_RADIUS + 1 : GRAPH_DOT_RADIUS,
        strokeWidth: isMerge ? GRAPH_DOT_STROKE + 1 : GRAPH_DOT_STROKE,
        kind: isHead ? 'head' : isMerge ? 'merge' : 'normal',
      },
      width: GRAPH_LANE_PITCH * (width + 1),
      head: isHead,
    });

    incoming = outgoing;
  }

  return { rows, columns };
}

/** Compact age text for the row: "3d", "2h", "now". */
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
