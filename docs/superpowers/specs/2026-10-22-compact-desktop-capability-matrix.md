# Compact and desktop capability matrix

The shell renders two different templates. `WorkbenchShell` switches on
`layoutMode === 'desktop'`: the desktop branch is the VS Code-shaped shell
(activity bar, sidebar, tab strip, breadcrumb, status bar), and everything else
renders `SourceWorkbench`, a single-file workbench with an edge-sheet drawer.

That split is deliberate, but it means a feature added to one branch silently
does not exist in the other. Three defects in a row came from exactly this:

| Defect | Symptom |
| --- | --- |
| `Ctrl+N` | Set `creatingFile`, but the inline form lives in the desktop sidebar, so nothing rendered. |
| `Ctrl+J` | `SourceWorkbench` received a hard-coded `panel-visible: true`, so the shortcut toggled an unread value. |
| `view.togglePanel` | Registered as desktop-only, while the compact shell has a panel and the shortcut worked. |

## What each layout provides

| Capability | Desktop | Compact | Notes |
| --- | --- | --- | --- |
| Activity bar / sidebar | yes | no | Compact uses edge sheets instead. |
| File tree | yes | no | Compact opens files through Quick Open. |
| Tab strip | yes | no | One file at a time. |
| Output panel | yes | yes | Both must honour `panelVisible`. |
| New file | inline form | created directly | Compact has nowhere to render the form. |
| Workspace search | yes | **no** | Not implemented; adding it is a feature, not a fix. |
| Recent runs / inspector | sidebar | edge sheet | Both layouts reach them. |
| Settings | yes | yes | Same view, responsive. |

## Rules for changes

1. A new shortcut or palette command must be checked in both layouts. Gate it on
   `ideMode` only when the thing it controls genuinely does not exist there.
2. A prop that controls visibility must not be hard-coded in either template.
3. When a compact branch needs different behaviour, branch on `ideMode` inside
   the handler rather than hiding the entry point.

## How the matrix is checked

- `apps/web/tests/accessibility.test.ts` mounts `App` with a compact
  `matchMedia` stub and asserts the shortcuts that must work there.
- `apps/web/tests/commandCenterApp.test.ts` asserts the palette lists the panel
  command in both layouts and omits the sidebar command in the compact one.
- `scripts/webui-browser-smoke.mjs` exercises all three viewports against the
  built distribution.
