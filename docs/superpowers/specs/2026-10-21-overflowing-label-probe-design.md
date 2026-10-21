# The overflowing-label probe

## Why it exists

Two defects in consecutive passes had the same cause: a flex item squeezed below
the width of its text.

| Surface | Symptom | Measured |
| --- | --- | --- |
| Tab strip | forty tabs became forty bare icons | 28 px per tab, names 0 px wide |
| Breadcrumb trail | every step printed over its neighbour | all 24 steps overflowed; "directory" wanted 77 px, got 36 px |

Neither was visible in the stylesheet. `min-width: 0` is a perfectly ordinary
line; it only misbehaves once the row holds more content than it has room for.
Both were found by rendering the built distribution and reading the pixels, so
the next one of this family will be found the same way.

## What it checks

The probe walks every element that owns text — a direct child text node — and
reports the ones where:

- the text is wider than the element's own box (`scrollWidth > clientWidth`), and
- the box does not clip (`overflow-x` is not `hidden`, `clip`, `auto`, or
  `scroll`).

A clipped box is fine: ellipsis and scrolling are deliberate. An unclipped box
with wider text is the failure — the label is painted outside its bounds, which
on screen reads as text printed over its neighbour.

## What makes the run meaningful

Two details, both learned the hard way this pass:

- **A deep file has to be open.** The sideways-scrolling strips only overflow
  once their content is long enough, so a run that opens one short file can never
  see the defect. The probe opens a many-segment path first.
- **The canary runs first, every time.** An earlier revision of this probe
  reported zero findings while being structurally unable to report anything at
  all — it was passed through `eval` in a way that never invoked the walker. A
  clean result now proves it could have seen a defect.

## Verified against a real defect

Reverting the breadcrumb trail's `flex: 0 0 auto` to `min-width: 0` and
rebuilding:

```
views with findings: 7
1440x900/explorer => [{"tag":"button","cls":"ide-breadcrumbs__step","text":"very",
  "scrollWidth":50,"clientWidth":33}, …]
exit=1
```

Restoring the fix returns it to `no overflowing labels across 4 viewports`,
exit 0. The probe bites on the defect it was written for, which is the only thing
that makes a clean run worth trusting.

## Coverage

Four viewports (1440×900, 1024×768, 820×640, 390×844) × eight views (explorer,
search, source control, runs, context, remote, the palette, settings), in the
default dark theme, with the deep file open. The compact layouts hide the
activity bar, so the sidebar views are skipped there rather than clicked.

The report is written to `tmp/ui-audit/overflow-report.json` so a failure can be
inspected after the run.

## Run it

```
node scripts/webui-overflow-audit.mjs
```

It needs a Chrome or Edge binary (the same discovery the smoke test uses) and a
built `apps/web/dist`.
