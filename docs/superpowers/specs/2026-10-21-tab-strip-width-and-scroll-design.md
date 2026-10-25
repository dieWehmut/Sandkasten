# The tab strip's width and scroll

## The defect

Forty open files turned the tab strip into forty bare icons. The tabs were flex
items with `min-width: 0`, so they shrank to 28 px each and every name measured
**0 px** — no label, no overflow, and nothing to tell one tab from another.

The strip also had no scrolling behaviour of its own. It declared
`overflow-x: auto`, but nothing ever scrolled it, so an active tab opened from
the explorer, quick open, or a breadcrumb could sit off-screen behind the tabs
already there.

## The reference behaviour

VS Code keeps tabs at a readable width and scrolls the strip when they run out,
and it reveals the active tab. Both halves are needed: scrolling without a
minimum width never happens (the tabs just squeeze), and a minimum width without
scrolling puts the active tab out of reach.

- `.ide-tab` keeps `flex: 0 0 auto`.
- `.ide-tab__select` has `min-width: 92px` and `max-width: 220px`, so a name is
  readable before it ellipsises and a few tabs still fit.
- `EditorTabs` watches the active path and scrolls the active tab into view with
  `inline: 'nearest'`, which is a no-op when it is already visible.

## Measured

Forty files with long names at 1440×900:

| | before | after |
| --- | --- | --- |
| tab width | 28 px | 247 px |
| name width | 0 px | 184 px |
| strip content | 1134 px (no overflow) | 9896 px vs 1134 px visible |
| active tab in view | yes, but nameless | yes, scrolled to `scrollLeft: 8754` |

## Verification

- `tests/ide.test.ts` — changing the active tab records a scroll of that tab;
  disabling the watcher fails the case (negative control run: `expected
  undefined to be 'mod-5.py'`).
- `tests/styles.test.ts` — pins the three rules, so a later layout change cannot
  quietly reintroduce the squeeze.
- Full `apps/web` suite: 51 files / 362 tests. Desktop `node --test`: 147.
- Browser smoke passes at three viewports; the distribution stays four files.
