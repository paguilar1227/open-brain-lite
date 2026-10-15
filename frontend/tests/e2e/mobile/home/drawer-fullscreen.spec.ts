// On mobile the right-rail drawer leaves a sliver of background on the
// right edge — half-completed-modal feel. This pins the fullscreen
// behavior: the drawer covers the entire viewport, and the desktop-only
// expand toggle is hidden so the header isn't cluttered.
//
// We open a todo specifically because notes route through NoteEditorModal
// (.modal, not .drawer). The /activity page exposes entity_kind in the
// row meta so we can pick a known-todo row deterministically.
import { expect, test } from '@playwright/test';
import { setup, MORE_SHEET, openMoreSheet } from '../../helpers/setup';
setup();

test('drawer: covers the full viewport on mobile and hides the expand toggle', async ({ page }) => {
  await openMoreSheet(page);
  await page.locator(`${MORE_SHEET} .m-sheet-row`, { hasText: 'Activity' }).click();
  await expect(page.locator('main h1', { hasText: /^Activity$/ })).toBeVisible();
  const todoRow = page
    .locator('.activity-row')
    .filter({ has: page.locator('.activity-row-meta', { hasText: /^\s*·\s*todo\s/ }) })
    .first();
  await todoRow.click();
  const drawer = page.locator('.drawer');
  // Click triggers an async fetch for the full entity — give CI's
  // slower runner room to finish before asserting.
  await expect(drawer).toBeVisible({ timeout: 15000 });

  // Mobile drawer slides up from translateY(16px). Wait for the
  // animation to settle so the rect reads its final position.
  await expect
    .poll(async () => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBe(0);

  // Drawer should fill the viewport — no offset on any side.
  const dims = await drawer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      rightGap: window.innerWidth - r.right,
      bottomGap: window.innerHeight - r.bottom,
      width: Math.round(r.width),
      vw: window.innerWidth,
    };
  });
  expect(dims.top).toBe(0);
  expect(dims.left).toBe(0);
  expect(dims.rightGap).toBe(0);
  expect(dims.bottomGap).toBe(0);
  expect(dims.width).toBe(dims.vw);

  // The expand toggle is desktop-only — show it on mobile and the
  // drawer-head gets too cluttered for the available space.
  await expect(page.locator('.drawer-expand')).toBeHidden();
});
