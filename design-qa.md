# Reference UI verification — 2026-11-06

**Result: passed for the changed workbench and explorer surfaces.** Independent inspection of the final Electron captures and recorded interaction assertions found no remaining P0, P1, or P2 issue in this scope. This is visual and interaction verification, not a claim of pixel identity or Windows installer validation.

## Reference and method

The supplied VS Code image is 2546 × 1435 pixels. `comparison-accepted.png` puts its 50% rendering beside the actual 1273 × 753 Electron window with the 35px title bar cropped for comparison. Source content differs; layout, palette, boundaries, and readability were compared. Full-window captures were also reviewed to check the title row.

Evidence directory: `/home/han/.cache/sandkasten-ui-20261106/`.

## Requirements and observed evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| Match dark editor, sidebar, active-line and status tones | `comparison-accepted.png`, `accepted-dark.png`, `accepted-metrics.json`: editor #121314; sidebar/status #191a1b; active line #242526 | Pass |
| Remove heavy editor frame | Metrics report zero editor border/outline and no shadow; final dark/deep-create images have no bottom full-width gray scrollbar on short code | Pass |
| Readable tree hierarchy and filename creation | `accepted-deep-create.png`: normal 13px text, 22px rows, visible hierarchy, 142px filename input with readable content | Pass |
| Keep narrow sidebar usable | `accepted-narrow.png`: 170px sidebar, 81px input shows main.py; tree has 156px visible width and 235px scrollable width | Pass |
| Reach narrow-sidebar actions | `accepted-narrow-actions.png` and `capture.mjs`: Tab brings focused create button fully inside tree bounds; Enter creates readable.py at `.sandkasten/language-matrix/workspaces/assembly/readable.py`, confirmed by resulting tree locator | Pass |
| Preserve legitimate horizontal code scrolling | `accepted-extra.json`: horizontalScroll=true after inserting a 300-character line; capture script asserts scrollLeft changes | Pass |
| Stable, readable light theme | `accepted-light.png`: capture waits for command-center background rgb(242,242,242); labels are readable and the prior transition-frame gray fill is gone | Pass |
| Top-left avatar absent | Full-window accepted captures show history arrows and menus without the removed avatar | Pass |
| No captured renderer errors | `accepted-metrics.json`, `accepted-extra.json`, `accepted.log`: errors=[] | Pass |

## Resolved findings

The first review found a redundant outer editor scrollbar and a light-theme screenshot captured during color transition. The final accepted images remove the redundant bar and capture the settled light controls. Narrow creation actions, previously offscreen, are now supported by an explicit focus-and-scroll assertion and screenshot.

## Intentional differences and scope

Sandkasten retains its runtime/execution toolbar, execution status, recent-runs area, and application-specific activity entries. The safe test workspace has different files and code from the reference. These account for content and vertical-layout differences in the combined image. The reference only supplies a dark theme; light-theme review checks readability and consistency, not exact reference matching. This record does not verify every application screen, all operating systems, or the Windows installer; those checks are separate.

## Installed Windows verification

The final Windows x64/ARM64 NSIS package passed the native payload verifier
(296 entries in each payload, zero problems). Source and Web distribution hashes
match the working tree; installed x64 files then matched the built payload.
Original workspace and local-storage files were unchanged after installation.

The installed `Sandkasten.exe` passed the same dark/light, deep-tree, new-file,
double-click, keyboard-action and long-line scrolling checks using an isolated
profile. `windows-runtime.log`, `windows-extra.json`, `windows-metrics.json`, and
`windows-*.png` in the evidence directory record this run. On Windows the 10ch
input measures 68px; its 56px content area fits `main.py` (45.07px in Segoe UI).
This checks actual rendered text instead of requiring a Linux font's pixel width.
No renderer errors were captured.

final result: passed
