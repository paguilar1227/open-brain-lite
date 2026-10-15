// Drawer expand/collapse — the right-rail drawer (todo detail, doc reader)
// has an expand toggle in its header that pulls it into the center of the
// viewport for more breathing room. Walks: open a todo from /activity →
// drawer is right-rail → click Expand → drawer is centered & wider →
// click Collapse → drawer is back to right-rail.
//
// We open a todo specifically because notes go through NoteEditorModal
// (a .modal, not a .drawer). The dedicated /activity page exposes
// entity_kind in the row meta so we can filter to a row we know will
// open a drawer.
import { expect, test } from '@playwright/test';
import { setup, navTo } from '../../helpers/setup';
setup();

test('drawer: expand toggle moves the right-rail drawer to centered/wider and back', async ({ page }) => {
  await navTo(page, 'Activity');
  await expect(page.locator('h1', { hasText: 'Activity' })).toBeVisible();
  // Pick the first row that points at a todo — its activity-row-meta
  // text starts with "todo · …" so we can target it directly.
  const todoRow = page
    .locator('.activity-row')
    .filter({ has: page.locator('.activity-row-meta', { hasText: /^\s*·\s*todo\s/ }) })
    .first();
  await todoRow.click();
  const drawer = page.locator('.drawer');
  // Click triggers an async fetch for the full entity — give CI's
  // slower runner room to finish before asserting.
  await expect(drawer).toBeVisible({ timeout: 15000 });
  await expect(drawer).not.toHaveClass(/drawer-expanded/);

  // The drawer slides in from the right (transform: translateX(20px)).
  // Wait for the animation to settle before measuring — otherwise the
  // right gap reads as negative mid-flight.
  await expect
    .poll(async () =>
      drawer.evaluate((el) => Math.round(window.innerWidth - el.getBoundingClientRect().right))
    )
    .toBe(12);

  // Default: ~480px wide, anchored 12px from the right edge.
  const before = await drawer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), rightGap: Math.round(window.innerWidth - r.right) };
  });
  expect(before.width).toBeLessThan(560);
  expect(before.rightGap).toBe(12);

  await page.locator('.drawer-expand').click();
  await expect(drawer).toHaveClass(/drawer-expanded/);
  // Both width and transform: translateX animate over 220ms. Width
  // can settle a few ms before the transform does, so polling on
  // width alone catches the drawer mid-flight. Poll on the centering
  // invariant directly.
  await expect
    .poll(async () =>
      drawer.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return Math.abs(Math.round(r.left) - Math.round(window.innerWidth - r.right));
      })
    )
    .toBeLessThanOrEqual(2);

  // Expanded: visibly wider, and the left/right gaps are roughly equal
  // (centered).
  const after = await drawer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      width: Math.round(r.width),
      leftGap: Math.round(r.left),
      rightGap: Math.round(window.innerWidth - r.right),
    };
  });
  expect(after.width).toBeGreaterThan(before.width);
  expect(Math.abs(after.leftGap - after.rightGap)).toBeLessThanOrEqual(2);

  // Collapse goes back to the original right-rail layout.
  await page.locator('.drawer-expand').click();
  await expect(drawer).not.toHaveClass(/drawer-expanded/);
  await expect
    .poll(async () => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
    .toBe(before.width);
  const restored = await drawer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), rightGap: Math.round(window.innerWidth - r.right) };
  });
  expect(restored.width).toBe(before.width);
  expect(restored.rightGap).toBe(before.rightGap);
});
