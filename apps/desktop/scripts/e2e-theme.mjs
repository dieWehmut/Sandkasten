// The reduced title row removed the header theme button. A user now either
// clicks the activity bar's theme toggle (light <-> dark) or, when a specific
// choice such as the system default is needed, opens the settings screen from
// the activity bar and clicks the appearance preview. The scripts use the
// settings route because it covers every preference value, then return to the
// editor.
export async function selectTheme(page, theme) {
  if ((await page.getAttribute('html', 'data-theme')) === theme) return;
  await page.click('[data-action="open-settings"]');
  await page.waitForSelector('[data-testid="settings-view"]');
  await page.click(`[data-theme-choice="${theme}"]`);
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme, { timeout: 5_000 });
  await page.click('[data-action="settings-back"]');
  await page.waitForSelector('[data-testid="settings-view"]', { state: 'detached', timeout: 5_000 });
}
