// Settings modal — mobile entry path is More tabbar → Account &
// preferences. Viewport is set by the chromium-mobile project (390x844
// is below the 820 mobile breakpoint that swaps the sidebar for the
// tabbar). Same modal, same backend, different reach.
import { expect, test } from '@playwright/test';
import '../../helpers/setup';

test('settings mobile: More → Account & preferences opens the modal and X dismisses it', async ({ page }) => {
  // The mobile tabbar swaps in below 820px (see useIsMobile). Wait for it
  // to render before driving the More button.
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();

  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Account & preferences' }).click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();
  // The More sheet should have closed itself when we opened the modal —
  // otherwise the user gets a stacked-overlay mess on a small screen.
  await expect(page.locator('.m-sheet')).toHaveCount(0);

  await page.locator('.modal-head button[aria-label="Close"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('settings mobile: theme toggle inside the modal flips the document data-theme', async ({ page }) => {
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Account & preferences' }).click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();

  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  const target: 'light' | 'dark' = initial === 'dark' ? 'light' : 'dark';
  await page.locator(`.modal .thm-toggle button[aria-label="${target === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(target);

  await page.locator(`.modal .thm-toggle button[aria-label="${initial === 'dark' ? 'Dark' : 'Light'} theme"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(initial);
});

test('settings mobile: clicking Log out clears the cached token and redirects', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('ob.api_key', 'sentinel-to-clear'));

  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Account & preferences' }).click();
  await expect(page.locator('.modal-head h3', { hasText: 'Settings' })).toBeVisible();
  await page.locator('.modal').getByRole('button', { name: 'Log out' }).click();

  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('ob.api_key'));
  expect(stored).toBeNull();
});

// The next two tests pin TODO features. `test.fail` flips the test green
// when the feature actually lands — until then, the suite tracks them as
// expected-failures and they're visible in every report rather than
// silently skipped. Replace `test.fail` with `test` once wired.
test.fail('settings mobile: tapping Notifications routes to the Notifications view', async ({ page }) => {
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Notifications' }).click();
  await expect(page.locator('main h1', { hasText: /Notifications/ })).toBeVisible();
});

test.fail('settings mobile: tapping Help & shortcuts routes to the Help view', async ({ page }) => {
  const more = page.locator('.mobile-tabbar .mtab', { hasText: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('.m-sheet .m-sheet-row', { hasText: 'Help & shortcuts' }).click();
  await expect(page.locator('main h1', { hasText: /Help|Shortcuts/ })).toBeVisible();
});
