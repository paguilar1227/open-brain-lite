// Settings modal — desktop entry path is the sidebar footer (avatar +
// name + email + cog all part of one click target). The modal overlays
// the current page so dismissing it returns the user to where they were
// rather than replacing the route.
import { expect, test } from '@playwright/test';
import '../../helpers/setup';

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

test('settings desktop: clicking Log out clears the cached token and redirects', async ({ page }) => {
  // Plant a sentinel token so we can prove the logout call cleared it. In
  // local dev /.auth/logout doesn't exist; the dev branch of logout()
  // assigns '/' and bootAuth re-hydrates from the env-var fallback.
  await page.evaluate(() => localStorage.setItem('ob.api_key', 'sentinel-to-clear'));

  await page.locator('aside.sidebar .sb-footer').click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();
  await page.locator('.modal').getByRole('button', { name: 'Log out' }).click();

  // Wait for the post-logout reload + bootAuth to settle on the home view.
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('ob.api_key'));
  expect(stored).toBeNull();
});
