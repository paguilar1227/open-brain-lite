// Dedicated settings page through the mobile More menu.
import { expect, test } from '@playwright/test';
import { setup } from '../../helpers/setup';
setup();

test('settings mobile: More → Models & preferences opens the settings page', async ({ page }) => {
  // The mobile tabbar swaps in below 820px (see useIsMobile). Wait for it
  // to render before driving the More button.
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();

  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Models & preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  // The More sheet should have closed itself when we opened the modal —
  // otherwise the user gets a stacked-overlay mess on a small screen.
  await expect(page.locator('.m-sheet')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('settings mobile: theme toggle on the page flips the document data-theme', async ({ page }) => {
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Models & preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  const target: 'light' | 'dark' = initial === 'dark' ? 'light' : 'dark';
  await page.locator(`.settings-page .thm-toggle button[aria-label="${target === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  await page.locator(`.settings-page .thm-toggle button[aria-label="${initial === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(initial);
});

test('settings mobile: local workspace opens without credentials and has no lock step', async ({ page }) => {
  await expect(page.getByLabel('Workspace API key')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ob.api_key'))).toBeNull();
  await page.locator('.mobile-tabbar .mtab', { hasText: 'More' }).click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Models & preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock workspace' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.app')).toBeVisible();
});

test('settings mobile: tapping Notifications opens browser reminder settings', async ({ page }) => {
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Notifications' }).click();
  await expect(page.locator('.settings-page').getByRole('heading', { name: 'Browser notifications' })).toBeVisible();
  await expect(page.locator('.settings-page').getByRole('button', { name: 'Enable reminders' })).toBeVisible();
});

test.fixme('settings mobile: tapping Help & shortcuts routes to the Help view', async ({ page }) => {
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Help & shortcuts' }).click();
  await expect(page.locator('main h1', { hasText: /Help|Shortcuts/ })).toBeVisible();
});
