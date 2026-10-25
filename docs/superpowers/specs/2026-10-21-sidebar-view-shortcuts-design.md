# Sidebar view shortcuts

## The gap

Ctrl+B, Ctrl+J, Ctrl+, and the palette shortcuts were bound, so the chrome felt
keyboard-complete. The six sidebar views were not bound at all: a keyboard user
could collapse the sidebar but could not switch which view it showed. The only
way into search, source control, runs, remote, or the context view was the
activity bar.

Measured on the built distribution before the fix — pressing each key and reading
the activity bar's pressed entry:

| Key | Before | After |
| --- | --- | --- |
| Ctrl+Shift+F | explorer (no change) | search |
| Ctrl+Shift+E | explorer (no change) | explorer |
| Ctrl+Shift+G | explorer (no change) | source control |

## The bindings

The reference's own accelerators, one per view:

| View | Key |
| --- | --- |
| Explorer | Ctrl+Shift+E |
| Search | Ctrl+Shift+F |
| Source control | Ctrl+Shift+G |
| Runs | Ctrl+Shift+U |
| Remote | Ctrl+Shift+M |
| Context | Ctrl+Shift+I |

Each is also a palette command carrying the same accelerator, so the palette and
the keyboard advertise the same thing. That was already the rule for Ctrl+, —
"the palette advertises this accelerator, so it has to be bound too" — and it
applies in the other direction as well.

## Ordering

The bindings carry Shift, so they are resolved before the plain-letter handlers
below them. Without that, Ctrl+Shift+E would match the Ctrl+E branch first and
open the file palette instead of selecting the explorer. The regression test
pins this specific case, because it is the one that reads as correct in a
stylesheet review and only misbehaves once both handlers exist.

## Verification

- Browser: each key changes the activity bar's pressed entry.
- Unit: two tests, one walking all four views, one pinning the Ctrl+Shift+E
  precedence. Removing the handler makes the first fail with
  `expected 'Explorer' to be 'Search'`.
