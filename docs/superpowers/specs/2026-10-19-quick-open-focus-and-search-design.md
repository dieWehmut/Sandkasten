# Quick-open icons, heading focus, and search option toggles

A pass over the surfaces the earlier fidelity work had not re-read: the quick
open list, the first-run guide, and the sidebar search view. Each defect below
was found by rendering the built distribution and reading the pixels, not by
reading the stylesheet, which is why all three survived the previous audit.

## Quick-open file icons

The palette bound `FileIcon` to the entry's name:

```vue
<FileIcon v-if="item.kind === 'file'" :name="item.id" />
```

The resolver in `editor/fileIcon.ts` reads `path` and strips the directory
itself, so every row fell through to the neutral document glyph while the
explorer, the tabs, the breadcrumbs, the status strip, and the search results
all showed the real file-type icon. Passing the path restores the reference's
behaviour: one file type, one glyph, everywhere.

The palette had no icon coverage at all, so the regression was invisible to the
suite. `tests/commandCenterApp.test.ts` now drives the real palette and asserts
a suffix match (`main.py`), a compound name (`app.ts`), and a name-table match
(`LICENSE`).

## Heading focus rings

The setup guide and the settings page both move focus to their `h1` on mount so
a screen reader reads the page title first. The heading is a reading position,
not a control, but the global `:focus-visible` rule painted the control ring
around it — a 2 px accent outline plus a 4 px halo.

Settings had patched this locally; the first-run guide never had, so the ring
was visible on the screen a new user sees first. The rule now lives once in
`base.css` and covers every heading that is only reachable programmatically:

```css
h1[tabindex="-1"]:focus-visible,
h2[tabindex="-1"]:focus-visible,
h3[tabindex="-1"]:focus-visible {
  outline: none;
  box-shadow: none;
}
```

A heading a keyboard user actually tabs to still shows the ring, because it is
not a `tabindex="-1"` heading.

## Sidebar search options

The search view printed "Match Case" as a native checkbox beside its icon while
the editor's find widget used 22 px icon buttons that stay pressed. The same
idea had two control languages in one workbench.

The option is now the find widget's button: a 22 px box in the muted role, lit
with the `--accent-soft` input-option fill while pressed, labelled through
`aria-label` and `title` instead of a printed inline label. It reports
`aria-pressed` and asks for the next value rather than carrying `checked`
state, so both search surfaces describe the option identically.

## Contrast audit

A probe walked every text node in ten theme × scheme combinations across nine
views (editor, five sidebar sections, four settings sections, the palette) and
computed the rendered foreground against the composited background, with the
WCAG large-text thresholds applied. It reported no violations; a deliberately
unreadable canary node was reported as expected, so the probe is known to bite.
The probe is kept in `tmp/` rather than the suite because it needs a real
browser, and the existing token-level contrast tests already cover the palette
itself.

## Verification

- `tests/commandCenterApp.test.ts` — the palette shows python, typescript, and
  name-matched icons; reverting the binding fails the case.
- `tests/styles.test.ts` — the shared heading rule and the shared toggle
  treatment are pinned, so a page cannot reintroduce either by dropping a local
  override.
- `tests/workspaceSearch.test.ts`, `tests/ide.test.ts` — the option is driven
  as a pressed button end to end.
- Full `apps/web` suite: 51 files / 358 tests. Desktop `node --test`: 147.
- `scripts/webui-browser-smoke.mjs` passes at three viewports; the tracked
  distribution is still exactly four files and is rebuilt from these sources.
