# VS Code shell parity: icons, title row, command center, settings

This continues session `01a0b994-227a-73c1-b31f-d76b5b6acd3a` and the five
supplied reference images. It covers the icon set, the title row, the compact
header controls that must go, and the settings screen that replaces them.

## Requested behavior

1. Files, folders, and tabs use the real glyphs from the VS Code
   `vscode-icons` extension instead of the current shape-plus-hue stand-ins.
2. The title row starts with the brand mark alone: no `Sandkasten` wordmark
   beside it. The `Run` menu is gone from the native menu bar.
3. Back and forward arrows sit to the right of the brand mark, driving a real
   editor history.
4. A search control is centered in the title row. It opens the VS Code Quick
   Open/command palette: file search over the workspace, the real commands with
   their accelerators, and recently opened files.
5. These header controls are removed: connection status, setup guide, locale
   switcher, show history, show inspector, and the theme button.
6. The bottom of the activity bar offers a settings button instead of the setup
   guide. It opens a new settings screen modelled on the reference images:
   a sidebar of sections with search, a theme picker with system/light/dark
   previews, and appearance controls for accent color, background, and
   foreground.
7. Everything that the removed header controls used to reach stays reachable
   from the settings screen or the menus that already exist.

## Constraints

- `apps/{web,cli,desktop}` stay in place, and `apps/web/dist` stays exactly four
  files. Every icon therefore has to be inlined into the bundle rather than
  shipped as a sibling asset.
- Browser builds keep working; Pages and the local WebUI gain the same icons,
  title row, and settings screen as the desktop shell.
- `data-theme`, `data-color-scheme`, the stored preferences, and the contrast
  tokens remain the single source of truth for color.
- The native menu keeps its accelerator contract: removing the `Run` menu still
  leaves run and stop reachable (F5/Shift+F5 and the palette).

## Icon strategy

Use the upstream `vscode-icons` SVGs, fetched from the extension repository at a
pinned commit, and inline them as a data URI through the same Vite mechanism the
brand mark already uses. Two maps are generated from the upstream
`supportedExtensions`/`supportedFolders` manifests:

- extension, file name, and folder name to icon id
- icon id to the inlined SVG

An icon id resolves through a small, explicit table rather than mirroring the
whole upstream catalogue, so the bundle only carries glyphs that can be reached.
Unmatched files keep a neutral default glyph.

## Verification and delivery

Each task gets focused tests before the implementation and its own commits on
its own branch; the integration branch assembles them and proves the combined
behavior. Browser smoke and the desktop E2E cover the new title row, the palette,
the settings screen, and the removed controls. The versioned distribution is
rebuilt last, and everything is pushed to origin only once the full set passes.