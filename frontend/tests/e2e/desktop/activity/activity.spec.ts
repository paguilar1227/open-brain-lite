import { expect, test } from '@playwright/test';
import { setup, navTo } from '../../helpers/setup';
setup();

test('activity: feed renders entries from the seed', async ({ page }) => {
  await navTo(page, 'Activity');
  await expect(page.locator('h1', { hasText: 'Activity' })).toBeVisible();
  await expect(page.locator('.activity-row').first()).toBeVisible();
});

test('activity: clicking a row opens the underlying entity modal', async ({ page }) => {
  await navTo(page, 'Activity');
  const firstRow = page.locator('.activity-row').first();
  await expect(firstRow).toBeVisible();

  const title = (await firstRow.locator('.text b').innerText()).trim();
  expect(title.length).toBeGreaterThan(0);

  await firstRow.click();

  // Click triggers an async fetch for the full entity. CI's runner is
  // slower than local — 5s is tight, 15s is generous.
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog).toContainText(title);
});
