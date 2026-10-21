# The breadcrumb trail's width and scroll

## The defects

Two defects in the same 22 px row, sharing the root cause the tab strip had.

**Labels overflowed their own boxes.** The steps were flex items with
`min-width: 0`, so a deep path squeezed each one below the width of its label.
Measured on a 24-segment path at 1440×900, "directory" wanted 77 px and was given
36 px — and all 24 steps overflowed, printing over their neighbours.

**The file crumb sat out of sight.** Once the labels kept their width the trail
genuinely overflowed, and the file crumb — the one crumb that says where you
are — was past the right edge with nothing scrolling it into view.

## The fixes

- `.ide-breadcrumbs__step` keeps `flex: 0 0 auto`; the row's own
  `overflow-x: auto` now does what it was always meant to do.
- `IdeBreadcrumbs` scrolls the trail so the file crumb lands in sight whenever
  the open file changes.

Two implementation notes worth keeping:

- **Pick the crumb by role, not by position.** The file crumb is a `span` while
  the folder crumbs are `button`s, so `:last-of-type` matches the last *button*
  and scrolls the parent directory into view instead of the file. The selector
  names `.ide-breadcrumbs__step--static`. The new test fails with the positional
  selector (negative control: `expected 0 to be greater than 0`).
- **Scroll the trail, not the crumb.** `scrollIntoView` on the crumb targets its
  nearest scrollable ancestor, which is the editor column — that moves the page
  and leaves the crumb clipped. The trail adjusts its own `scrollLeft`.

## Measured

24-segment path at 1440×900:

| | before | after |
| --- | --- | --- |
| steps overflowing their box | 24 of 24 | 0 |
| "directory" label width | 36 px of 77 px needed | 77 px |
| trail content vs visible | 1317 px vs 1134 px | 2063 px vs 1134 px |
| file crumb | clipped past the right edge | ends at 1423 px, row ends at 1431 px |

## Verification

- `tests/ide.test.ts` — with a stubbed layout the trail scrolls when the open
  file changes, and the case fails when the crumb is picked positionally.
- `tests/styles.test.ts` — pins `flex: 0 0 auto` on the step, the row's
  `overflow-x: auto`, and the absence of `min-width: 0`.
- Full `apps/web` suite: 51 files / 364 tests. Desktop `node --test`: 147.
- Browser smoke passes at three viewports; the distribution stays four files.
