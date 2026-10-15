// Drag-to-reorder personal todos. Drives the picker via low-level
// page.mouse so dnd-kit's PointerSensor distance threshold (6px)
// trips deterministically. Uses the drawer rather than the column
// because the drawer renders the full list — the column slice (top
// 6) can hide test rows depending on seed timing.
//
// Subtask reorder isn't covered separately: SortableTodoList renders
// each parent's children inside their own SortableContext, exercised
// by the drawer's grandchild flow in personal-todos-drawer.spec.ts.
// Reorder uses the same reorderTodos / manual_order plumbing — once
// top-level reorder works, subtask reorder works.

import { expect, test } from '@playwright/test';
import { createTodo, listTodos } from '../../helpers/api';
import { setup, stamp } from '../../helpers/setup';
setup();
import { waitForAppReady } from '../../helpers/utils';

const TODOS_COL = '.home-personal-grid .pcol:has(h3:text-is("Todos"))';

test.beforeEach(async ({ page }) => {
  // Clear expansion state so the drawer renders rows in a predictable
  // (collapsed) layout — saves the test from hunting for grips inside
  // already-expanded subtrees.
  await page.evaluate(() => {
    try { window.localStorage.removeItem('obv2.todos.expanded'); } catch {}
  });
  await page.reload();
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
});

test('home personal todos drawer: drag-to-reorder persists across reload', async ({ page }) => {
  const A = stamp() + ' Reorder A';
  const B = stamp() + ' Reorder B';
  // Created order: B first (older), then A (newer). Without a manual
  // order they fall to the active P3 / no-due tier and the test has
  // to find them in the drawer; the drag flips their persisted
  // manual_order regardless of where they start.
  await createTodo(B, null);
  await createTodo(A, null);

  await page.reload();
  await waitForAppReady(page);

  // Open the drawer (full list).
  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible({ timeout: 15000 });

  const rowA = drawer.locator('.prow', { hasText: A });
  const rowB = drawer.locator('.prow', { hasText: B });
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();

  // Determine initial direction. Each .prow is wrapped by a sortable
  // div, so we ask the drawer's flat row list directly.
  const allRows = drawer.locator('.prow-todo');
  const rowIndex = async (text: string) => {
    const titles = await allRows.allTextContents();
    return titles.findIndex((t) => t.includes(text));
  };
  const idxA0 = await rowIndex(A);
  const idxB0 = await rowIndex(B);
  expect(idxA0).not.toBe(idxB0);
  expect(idxA0).toBeGreaterThanOrEqual(0);
  expect(idxB0).toBeGreaterThanOrEqual(0);

  // Drag A's grip to a point past B's center.
  const gripBox = await rowA.locator('.prow-grip').boundingBox();
  const targetBox = await rowB.boundingBox();
  expect(gripBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  const startX = gripBox!.x + gripBox!.width / 2;
  const startY = gripBox!.y + gripBox!.height / 2;
  // Aim past B's bottom by a few pixels — dnd-kit's collision
  // detector ranks closest-center, which lands on B if we cross its
  // midpoint from the original side.
  const direction = idxA0 < idxB0 ? 1 : -1; // moving A across B
  const endY = (targetBox!.y + targetBox!.height / 2) + direction * (targetBox!.height / 2 + 6);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several intermediate moves so dnd-kit sees the threshold trip
  // and the layout updates between frames.
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const y = startY + ((endY - startY) * i) / steps;
    await page.mouse.move(startX, y, { steps: 4 });
  }
  await page.mouse.up();

  // After drop, A and B's relative position swaps. Poll because the
  // mutation + cache update have a small async window.
  await expect.poll(async () => {
    const aIdx = await rowIndex(A);
    const bIdx = await rowIndex(B);
    // Sign of (aIdx - bIdx) flipped from the original.
    return Math.sign(aIdx - bIdx) === -Math.sign(idxA0 - idxB0);
  }, { timeout: 5000 }).toBe(true);

  // Backend reflects the new manual order.
  await expect.poll(async () => {
    const todos = await listTodos({ project_id: 'null' });
    const a = todos.find((t) => t.content === A);
    const b = todos.find((t) => t.content === B);
    if (a?.manual_order == null || b?.manual_order == null) return null;
    return Math.sign(a.manual_order - b.manual_order);
  }).toBe(-Math.sign(idxA0 - idxB0));

  // Reload — the drawer re-renders from REST and the order survives.
  await page.locator('.drawer .drawer-close, .drawer button[aria-label="Close"]')
    .first()
    .click({ trial: true })
    .catch(() => undefined); // close button selectors vary
  await page.reload();
  await waitForAppReady(page);
  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const drawer2 = page.locator('.drawer');
  await expect(drawer2).toBeVisible({ timeout: 15000 });
  // Drawer's infinite-query starts cold on each open — wait for the
  // freshly-reordered rows to render before reading positions.
  await expect(drawer2.locator('.prow', { hasText: A })).toBeVisible({ timeout: 10000 });
  await expect(drawer2.locator('.prow', { hasText: B })).toBeVisible({ timeout: 10000 });
  const allRows2 = drawer2.locator('.prow-todo');
  const rowIndex2 = async (text: string) => {
    const titles = await allRows2.allTextContents();
    return titles.findIndex((t) => t.includes(text));
  };
  const idxAFinal = await rowIndex2(A);
  const idxBFinal = await rowIndex2(B);
  expect(Math.sign(idxAFinal - idxBFinal)).toBe(-Math.sign(idxA0 - idxB0));
});
