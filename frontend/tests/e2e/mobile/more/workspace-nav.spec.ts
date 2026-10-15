// Mobile More sheet — Workspace section nav rows. Each row routes to a
// page that has a corresponding hero h1. Walking them all in one test
// keeps the suite tight (one More-open per row would re-open the sheet
// after every tap, since `go` closes it on selection).
import { expect, test } from '@playwright/test';
import { MORE_SHEET, openMoreSheet } from '../../helpers/setup';
import '../../helpers/setup';

test('mobile more: every Workspace row routes to the right page', async ({ page }) => {
  const rows: Array<[string, RegExp]> = [
    ['Notes', /^Notes$/],
    ['Activity', /^Activity$/],
    ['Tags', /^Tags$/],
    ['Archived', /^Archived$/],
  ];
  for (const [label, hero] of rows) {
    await openMoreSheet(page);
    await page.locator(`${MORE_SHEET} .m-sheet-row`, { hasText: label }).click();
    // The sheet auto-closes when a row is tapped (`go()` flips moreOpen).
    await expect(page.locator(MORE_SHEET)).toHaveCount(0);
    await expect(page.locator('main h1', { hasText: hero })).toBeVisible();
  }
});
