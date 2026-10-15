// Mobile More sheet — open/close affordances. The sheet has two
// dismissal paths: the X button in the sheet header, and tapping the
// dimming overlay outside the sheet (the visual is a slide-down).
// Drag-to-dismiss isn't wired yet; if/when it is, add a test here.
import { expect, test } from '@playwright/test';
import { setup, MORE_SHEET, openMoreSheet } from '../../helpers/setup';
setup();

test('mobile more: clicking the X button in the sheet header dismisses it', async ({ page }) => {
  await openMoreSheet(page);
  await page.locator(`${MORE_SHEET} .m-sheet-h button`).click();
  await expect(page.locator(MORE_SHEET)).toHaveCount(0);
});

test('mobile more: tapping the overlay outside the sheet dismisses it', async ({ page }) => {
  await openMoreSheet(page);
  // The overlay covers the full viewport but the sheet is layered on top
  // of it, so a generic `.click()` lands on the sheet. Click at the very
  // top of the viewport — that area is overlay-only above the sheet.
  await page.locator('.m-sheet-overlay').click({ position: { x: 10, y: 10 } });
  await expect(page.locator(MORE_SHEET)).toHaveCount(0);
});
