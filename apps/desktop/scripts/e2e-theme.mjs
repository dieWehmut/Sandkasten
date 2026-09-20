// The reduced title row removed the header theme button, so the desktop E2E
// scripts choose a theme the way a user now does: open the settings screen from
// the activity bar and click the appearance preview, then return to the editor.
export async function selectTheme(page, theme) {
  if ((await page.getAttribute('html', 'data-theme')) === theme) return;
  await page.click('[data-action="open-settings"]');
  await page.waitForSelector('[data-testid="settings-view"]');
  await page.click(`[data-theme-choice="${theme}"]`);
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme, { timeout: 5_000 });
  await page.click('[data-action="settings-back"]');
  await page.waitForSelector('[data-testid="settings-view"]', { state: 'detached', timeout: 5_000 });
}
