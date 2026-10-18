// Dedicated settings page: sidebar entry, URL, preferences and return path.
import { expect, test } from '@playwright/test';
import { setup } from '../../helpers/setup';
setup();

test('settings desktop: sidebar opens a dedicated page and Back restores the workspace', async ({ page }) => {
  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await expect(page.locator('main h1', { hasText: /Welcome back/ })).toBeVisible();
});

test('settings desktop: theme toggle on the page flips the document data-theme', async ({ page }) => {
  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  const target: 'light' | 'dark' = initial === 'dark' ? 'light' : 'dark';
  await page.locator(`.settings-page .thm-toggle button[aria-label="${target === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  // Restore the initial theme so the next test starts clean.
  await page.locator(`.settings-page .thm-toggle button[aria-label="${initial === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(initial);
});

test('settings desktop: local workspace opens without credentials and has no lock step', async ({ page }) => {
  await expect(page.getByLabel('Workspace API key')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ob.api_key'))).toBeNull();
  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock workspace' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.app')).toBeVisible();
});


test('Mono Drafting keeps active navigation badges and branding legible in both themes', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const theme of ['Dark', 'Light']) {
    await page.getByRole('button', { name: `${theme} theme` }).click();
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    const pairs = await page.evaluate(() => {
      const badge = document.querySelector('.sb-item.active .count')!;
      const active = document.querySelector('.sb-item.active')!;
      const logo = document.querySelector('.sb-brand .logo')!;
      const svg = logo.querySelector('svg')!;
      return [
        [getComputedStyle(badge).color, getComputedStyle(active).backgroundColor],
        [getComputedStyle(svg).stroke, getComputedStyle(logo).backgroundColor],
      ];
    });
    // WCAG relative luminance; catches the inherited light-on-light logo
    // and dark-on-dark active badge introduced by palette inversion.
    const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(x => {
      const v = x / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const [fg, bg] of pairs) {
      const values = [luminance(fg), luminance(bg)].sort((a,b) => b-a);
      expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
