# Explorer compact folders

## The defect

The tree indented each level by a fixed 12 px:

```vue
:style="{ paddingLeft: `${8 + row.depth * 12}px` }"
```

A path such as `a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p` therefore consumed the whole
248 px sidebar. Past roughly sixteen levels a directory row rendered as a twisty
and nothing else — the name had no width left to occupy — so the tree became
unreadable exactly where a user most needs it to orient them.

## The reference behaviour

VS Code ships `explorer.compactFolders` on by default: a chain of folders that
each contain exactly one folder collapses into a single row labelled with the
joined path. The tree now does the same.

A chain ends where the reference ends it — at the first folder that holds
anything other than a single folder. A folder of files is its own row, so a leaf
folder never disappears into a chain.

## Details worth recording

Two behaviours the first cut got wrong, both now covered by tests:

- **The label survives folding.** The joined name is computed whether the row is
  open or closed. Computing it only for open rows made a folded chain snap back
  to its head folder's name, which read as if the chain had collapsed into
  something else.
- **Opening opens the whole chain.** Only the head carries the collapsed flag, so
  clearing that flag alone would reveal nothing — the chain's own folders would
  stay folded behind it. The row records every folder it stands for and opens
  them together.

The row also carries `data-chain` and puts the joined path in the name's
`title`, so the full path stays reachable when the sidebar is too narrow to
print it (long names ellipsise, as before).

## Interaction with the rest of the tree

- The creation row inserts after the row that stands for the chain containing
  the target, not after a head folder that may no longer own the children.
- Collapse-folders still folds every directory, chain or not.
- Selection, indent guides, and the folder glyph keep working off the head node,
  which is the row the user actually clicks.

## Verification

- `tests/ide.test.ts` — a three-level chain renders as one row with the joined
  label and title, its children hang one level beneath it, folding leaves one
  row, reopening restores all three, and the header-actions case expects the
  compacted count.
- Deep-tree probe at 248 px: 52 rows before, 39 after, no horizontal overflow,
  widest row 240 px of 248.
- Full `apps/web` suite: 51 files / 360 tests. Desktop `node --test`: 147.
- Browser smoke passes at three viewports; the distribution stays four files.
