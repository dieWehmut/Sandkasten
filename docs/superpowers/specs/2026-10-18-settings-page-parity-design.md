# Settings page parity, theme toggle, and tree text roles

This follows the VS Code UI fidelity work. Three requests sharpen the result:

1. **One page language.** The settings screen and the get-started screen must
   read as the same page, not as two designs that happen to share tokens.
2. **A theme toggle in the left lane.** The activity bar's footer gains a theme
   toggle directly above settings.
3. **Uniform tree labels.** The explorer's labels must all read at the strongest
   text role; a folder must not be grey next to white files.

The fidelity document's measured geometry still governs the workbench chrome.
The settings frame below intentionally replaces the settings-editor frame that
document recorded, because the request asks for the get-started page's language
rather than the settings editor's.

## Settings page

The page keeps the welcome page's frame and roles instead of inventing a second
one, so the two screens differ only in what they contain:

| Part | Settings | Get-started (reference for the role) |
| --- | --- | --- |
| Page type | 13 px on a 16 px line box | the same |
| Frame | `max-width: 1200px`, centred, 24 px inline padding, two columns (`minmax(180px, 3fr)` rail, `minmax(0, 8fr)` content) with a 48 px gutter | `max-width: 1200px` centred grid with `12px 24px` and 1fr gutters |
| Header | the brand mark, the page title at 2.7em/400, a 1.35em subtitle, then the search field and the back action on the trailing edge | the mark, the product title at 2.7em/400 and the 1.35em subtitle |
| Section title | 1.5em at weight 400 | `h2` sections at 1.5em/400 |
| Rows and rail | one tile per control: 1 px border, 6 px corners, the raised surface, the accent on the link icon, a hover `--surface-subtle` | the same tile for each action |
| Section gap | 32 px between cards | `margin-bottom: 32px` between sections |

What the settings editor still contributes is the anatomy the page alone needs,
and it stays measured: the search field sits in the header over the content, the
theme previews keep their thumbnails, a setting the user changed from its
default keeps the two-pixel accent bar (now inset inside the tile's leading
edge), the rail's selected entry keeps its bold label, and the controls keep
their 26 px box.

The rail turns into a horizontally scrolling row of the same tiles below 900 px,
the header wraps and stacks its actions, and the row padding tightens at 600 px.
The whole page scrolls as one document, the way the get-started page does, and
the rail sticks while the content is longer than the viewport.

No test hook moved: `data-testid="settings-view"`, every `data-section`,
`data-theme-choice`, `data-color`, `data-testid="settings-color-scheme"`, the
`settings-back` action, and the search field keep their names, so the component
tests, the app tests, and the browser smoke flow drive the same contract.

## Theme toggle

The activity bar's footer already held settings. The toggle joins it directly
above, so the two app-wide leaves sit together at the bottom of the lane:

- the button is a 48 px activity item like the others, marked with the footer
  class so the pair is pushed to the bottom;
- the icon names the theme the click moves to — a sun while the page is dark, a
  moon while it is light — and the label is the existing
  `header.theme.useDark` / `header.theme.useLight` string, so assistive
  technology and the palette name the action the same way;
- it emits `toggleTheme` through the shell to `useTheme.toggleTheme`, so the
  change persists through the same `sandkasten-theme` key the settings picker
  and the OS-default rule already use.

The toggle is an action, not a state, so it carries no `aria-pressed`; the
settings screen keeps the three-way system/light/dark picker.

## Tree text roles

The explorer drew file labels in `--text` and folder labels in `--text-muted`,
so a folder read as disabled next to its own files. Every label now takes
`--text`; a folder separates itself by its 600 weight, which is how the
reference distinguishes the two without a second colour. Icons keep their file
type hues and the chevrons keep the faint decorative tone, because neither is
label text.

## Verification

- `tests/styles.test.ts` pins the new page roles (13 px page type, the 1200 px
  two-column frame, 2.7em/400 and 1.5em/400 titles, the tile row, the inset
  modified bar, the bold rail selection) and the uniform tree label role.
- `tests/ide.test.ts` mounts the app and drives the activity bar's toggle: the
  footer order is theme toggle then settings, the label names the theme the
  click moves to, and the click flips `data-theme` and persists it.
- The existing settings suites (`SettingsView.test.ts`, `settingsApp.test.ts`,
  `appearance.test.ts`) still pass unchanged, which is the evidence that only
  the presentation moved.
- `scripts/webui-browser-smoke.mjs` passes at 1440×900, 1024×768 and 390×844:
  no horizontal overflow, no intersecting controls, the settings sections and
  the scheme picker still drive the document, and the light/dark screenshots
  still differ.
- Screenshots of the get-started page, the settings screen in both themes, the
  explorer at 3× and the activity footer at 5× were read directly to confirm the
  two pages share a language and the tree labels are uniform.
