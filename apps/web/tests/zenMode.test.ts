import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ZEN_SETTINGS,
  ZEN_MARGIN_RATIO,
  ZEN_TARGET_WIDTH,
  zenGeometry,
  useZenMode,
} from '../src/composables/useZenMode';

// Every number here comes from the reference workbench, not from taste:
//
//   { targetWidth: 900, leftMarginRatio: .1909, rightMarginRatio: .1909 }
//
// read from the centred-layout implementation, and the `zenMode.*` defaults read from
// the settings registry. The ratios are the reason this geometry needs tests at all:
// a fixed inset looks right at one window size and wrong at every other.

describe('zen mode geometry', () => {
  test('centres a 900 px column with equal margins on a wide window', () => {
    // 1440 px has 540 px spare, so 270 px a side; that is less than the ratio's
    // 274 px, so the spare-space bound is what decides here and the column lands
    // exactly on the measured 900 px target.
    const { width, margin } = zenGeometry(1440);
    expect(margin).toBe(270);
    expect(width).toBe(900);
  });

  test('keeps the column proportional instead of pinning a fixed inset', () => {
    // The failure this guards against: a hard-coded 270 px margin would leave a
    // 900 px column on a 1440 px window and squeeze a 560 px column on an 1100 px
    // one. The margin shrinks with the window instead, and the column stays at the
    // 900 px target as long as the spare space can supply it.
    const wide = zenGeometry(1440);
    const narrow = zenGeometry(1100);
    expect(narrow.margin).toBeLessThan(wide.margin);
    expect(narrow.margin).toBe(100);
    expect(narrow.width).toBe(900);
  });

  test('never lets the margin exceed the space that is actually spare', () => {
    // At 950 px there are only 50 px spare, so a 181 px ratio margin would overhang.
    // The reference clips to what is left, which leaves 25 px a side.
    const { width, margin } = zenGeometry(950);
    expect(margin).toBe(25);
    expect(width).toBe(900);
  });

  test('fills the width when the window cannot hold the target column', () => {
    // Below the target there is no spare space, so the ratio contributes nothing and
    // the column takes the whole width rather than overflowing.
    expect(zenGeometry(800)).toEqual({ width: 800, margin: 0 });
    expect(zenGeometry(600)).toEqual({ width: 600, margin: 0 });
  });

  test('treats an unmeasured container as zero rather than producing a negative box', () => {
    expect(zenGeometry(0)).toEqual({ width: 0, margin: 0 });
    expect(zenGeometry(Number.NaN)).toEqual({ width: 0, margin: 0 });
    expect(zenGeometry(-100)).toEqual({ width: 0, margin: 0 });
  });
});

describe('the zen mode controller', () => {
  test('starts off, with the reference defaults ready', () => {
    const zen = useZenMode();
    expect(zen.active.value).toBe(false);
    // Every hide switch defaults to true in the reference registry; `showTabs` is an
    // enum left at `multiple`.
    expect(DEFAULT_ZEN_SETTINGS).toEqual({
      centerLayout: true,
      hideStatusBar: true,
      hideActivityBar: true,
      hideLineNumbers: true,
      showTabs: 'multiple',
    });
    expect(zen.settings.value).toEqual(DEFAULT_ZEN_SETTINGS);
  });

  test('hides the chrome only while it is active', () => {
    const zen = useZenMode();
    // Off: everything the ordinary shell paints stays painted.
    expect(zen.showActivityBar.value).toBe(true);
    expect(zen.showStatusBar.value).toBe(true);
    expect(zen.showTabs.value).toBe(true);
    expect(zen.hideLineNumbers.value).toBe(false);
    expect(zen.centeredWidth.value).toBeNull();

    zen.toggle();
    expect(zen.showActivityBar.value).toBe(false);
    expect(zen.showStatusBar.value).toBe(false);
    // Tabs stay because `showTabs` defaults to `multiple`, which is the subtle part:
    // Zen mode hides the activity bar and status bar but not the tab strip.
    expect(zen.showTabs.value).toBe(true);
    expect(zen.hideLineNumbers.value).toBe(true);
  });

  test('honours showTabs as an enum with three states', () => {
    const zen = useZenMode({ showTabs: 'none' });
    zen.toggle();
    expect(zen.showTabs.value).toBe(false);
    expect(zen.singleTab.value).toBe(false);

    zen.setSetting('showTabs', 'single');
    expect(zen.showTabs.value).toBe(true);
    expect(zen.singleTab.value).toBe(true);

    zen.setSetting('showTabs', 'multiple');
    expect(zen.showTabs.value).toBe(true);
    expect(zen.singleTab.value).toBe(false);
  });

  test('lets each hide switch be turned off independently', () => {
    const zen = useZenMode({ hideActivityBar: false, hideStatusBar: false });
    zen.toggle();
    expect(zen.showActivityBar.value).toBe(true);
    expect(zen.showStatusBar.value).toBe(true);
    // The one still on keeps working, so the switches are not coupled.
    expect(zen.hideLineNumbers.value).toBe(true);
  });

  test('drops centring without leaving zen mode', () => {
    const zen = useZenMode();
    zen.toggle();
    zen.setContainerWidth(1440);
    expect(zen.centeredWidth.value).toBe(900);
    expect(zen.centeredMargin.value).toBe(270);

    zen.setSetting('centerLayout', false);
    expect(zen.centeredWidth.value).toBeNull();
    expect(zen.centeredMargin.value).toBe(0);
    // Still in zen mode: the activity bar is still hidden.
    expect(zen.active.value).toBe(true);
    expect(zen.showActivityBar.value).toBe(false);
  });

  test('exits cleanly and restores the chrome', () => {
    const zen = useZenMode();
    zen.toggle();
    zen.exit();
    expect(zen.active.value).toBe(false);
    expect(zen.showActivityBar.value).toBe(true);
    expect(zen.hideLineNumbers.value).toBe(false);
  });
});
