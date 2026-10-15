// Mobile Todos view — the todo row reflows so the title-content takes the full
// first row and the priority / timestamp meta drops to a strip BELOW it. On
// desktop title + priority share one row; on mobile the priority is on a lower
// row. Pins the reflow that stopped titles truncating + chips wrapping.
import { expect, test } from '@playwright/test';
import { MORE_SHEET, openMoreSheet } from '../../helpers/setup';
import '../../helpers/setup';

test('mobile todos: priority sits on a row below the title (reflow)', async ({ page }) => {
  await openMoreSheet(page);
  await page.locator(`${MORE_SHEET} .m-sheet-row`, { hasText: 'Todos' }).click();
  await expect(page.locator('main h1', { hasText: /^Todos$/ })).toBeVisible();

  const row = page.locator('.prow-todo').first();
  await expect(row).toBeVisible();
  const titleBox = await row.locator('.ti').boundingBox();
  const prioBox = await row.locator('.priority').first().boundingBox();
  expect(titleBox).not.toBeNull();
  expect(prioBox).not.toBeNull();
  // Mobile: priority drops to a row beneath the title (desktop = same row).
  expect(prioBox!.y).toBeGreaterThan(titleBox!.y + 10);
});
