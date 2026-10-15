// Settings modal — desktop entry path is the sidebar footer (avatar +
// name + email + cog all part of one click target). The modal overlays
// the current page so dismissing it returns the user to where they were
// rather than replacing the route.
import { expect, test } from '@playwright/test';
import { setup } from '../../helpers/setup';
setup();

test('settings desktop: clicking sidebar footer opens the modal and X dismisses it', async ({ page }) => {
  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();
  // The home page must still be mounted underneath — closing the modal
  // should drop the user back where they were, not on a fresh route.
  await expect(page.locator('main h1', { hasText: /Welcome back/ })).toBeVisible();
  await page.locator('.modal-head button[aria-label="Close"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('settings desktop: theme toggle inside the modal flips the document data-theme', async ({ page }) => {
  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();

  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  const target: 'light' | 'dark' = initial === 'dark' ? 'light' : 'dark';
  await page.locator(`.modal .thm-toggle button[aria-label="${target === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  // Restore the initial theme so the next test starts clean.
  await page.locator(`.modal .thm-toggle button[aria-label="${initial === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(initial);
});

test('settings desktop: locking the workspace clears the key and returns to local sign-in', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('ob.api_key', 'sentinel-to-clear'));

  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();
  await page.locator('.modal').getByRole('button', { name: 'Lock workspace' }).click();

  await expect(page.getByLabel('Installation API key')).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('ob.api_key'));
  expect(stored).toBeNull();
});
