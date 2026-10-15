// Home personal-todos column behaviors:
//   - Sort: overdue > pinned > active > done; subtasks emit under
//     parent regardless of band (recursive depth).
//   - Default-collapsed subtasks: parents render a chevron + (N)
//     subtask count; clicking the chevron expands the subtree.
//     Expansion state persists per-parent in localStorage.
//   - Widget caps at depth=1 — descendants beyond cap roll up into
//     "+N deeper" italic hint on the deepest visible row.
//   - "View N more" footer opens a drawer with the full tree.
//   - Done todos render with strikethrough; comment count badges
//     surface on parents AND subtasks.
//
// The seed deliberately exercises every case so these assertions can
// run against the same fixture used by humans clicking around.

import { expect, test } from '@playwright/test';
import '../../helpers/setup';

const todosCol = (page: import('@playwright/test').Page) =>
  page.locator('.home-personal-grid .pcol').filter({ has: page.locator('h3:text-is("Todos")') });

test.beforeEach(async ({ page }) => {
  // Default-collapsed semantics need a clean localStorage so prior
  // tests in the run don't leak expanded state into this one. The
  // helpers/setup beforeEach has already navigated; clear + reload
  // forces the SPA to remount with no expanded parents.
  await page.evaluate(() => {
    try { window.localStorage.removeItem('obv2.todos.expanded'); } catch {}
  });
  await page.reload();
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
});

test('home personal todos: "View N more" footer opens the drawer with the full list', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const more = todosCol(page).locator('.pcol-more');
  await expect(more).toBeVisible();
  await more.click();

  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible({ timeout: 15000 });
  await expect(drawer).toContainText(/Personal todos · \d+/);
  // Drawer pulls its data via useInfiniteQuery against a cache key
  // distinct from the column's, so opening it forces a fresh fetch.
  // Wait for the first row to render before counting; otherwise the
  // count fires during the loading-skeleton window and reads zero.
  await expect(drawer.locator('.prow-todo').first()).toBeVisible({ timeout: 10000 });

  const colRows = await todosCol(page).locator('.prow-todo').count();
  const drawerRows = await drawer.locator('.prow-todo').count();
  expect(drawerRows).toBeGreaterThanOrEqual(colRows);

  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);
});

test('home personal todos: overdue leads + subtasks default collapsed', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const rows = todosCol(page).locator('.prow-todo');
  await expect(rows.first()).toBeVisible();

  // Band ordering: an overdue, top-level todo leads (bands: overdue >
  // pinned > active > done — bandRank wins before any within-band key).
  // Assert the invariant, NOT a specific title: within the overdue band the
  // order is manual_order-first (see compareSmart), so which overdue todo is
  // row 0 depends on drag state — and sibling reorder tests mutate that in
  // the shared dev DB. A row is overdue iff it renders the .due-overdue chip.
  await expect(rows.nth(0)).toHaveAttribute('data-depth', '0');
  await expect(rows.nth(0).locator('.due-overdue')).toBeVisible();

  // Pinned parent shows but its subtasks are hidden by default.
  // Subtask count badge "(3)" appears next to the title.
  const planRow = rows.filter({ hasText: 'Plan home office overhaul' });
  await expect(planRow).toHaveCount(1);
  await expect(planRow.locator('.ti-childcount')).toContainText('(3)');

  // No subtask should be visible while the parent is collapsed.
  await expect(rows.filter({ hasText: 'Order monitor arm' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Pick a standing desk' })).toHaveCount(0);
});

test('home personal todos: chevron expands parent → subtasks visible + done strikethrough', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const planRow = todosCol(page).locator('.prow-todo').filter({ hasText: 'Plan home office overhaul' });
  await planRow.locator('.prow-chev').click();

  const rows = todosCol(page).locator('.prow-todo');
  // Direct children become visible.
  await expect(rows.filter({ hasText: 'Order monitor arm' })).toHaveCount(1);
  // Done subtask: strikethrough.
  const done = rows.filter({ hasText: 'Order monitor arm' });
  await expect(done).toHaveClass(/prow-done/);
  const td = await done.locator('.ti').evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(td).toBe('line-through');

  // 'Pick a standing desk' has a grandchild which is BEYOND the
  // widget's depth cap — surface "+1 deeper" hint on it.
  const pick = rows.filter({ hasText: 'Pick a standing desk' });
  await expect(pick.locator('.ti-deeper')).toContainText('+1 deeper');
  // Grandchild itself does not render in the column.
  await expect(rows.filter({ hasText: 'Measure wall outlet height' })).toHaveCount(0);
});

test('home personal todos: comment count badge renders on parent and on subtask', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const planRow = todosCol(page).locator('.prow-todo').filter({ hasText: 'Plan home office overhaul' });
  await expect(planRow.locator('.prow-comments')).toContainText('2');

  // Expand to reveal the subtask, then assert its comment badge.
  await planRow.locator('.prow-chev').click();
  const pickRow = todosCol(page).locator('.prow-todo').filter({ hasText: 'Pick a standing desk' });
  await expect(pickRow.locator('.prow-comments')).toContainText('1');

  // 'Renew domain' has no comments — no badge.
  const renew = todosCol(page).locator('.prow-todo').filter({ hasText: 'Renew domain' });
  await expect(renew.locator('.prow-comments')).toHaveCount(0);
});

test('home personal todos drawer: full tree expands grandchildren under their parent', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  await todosCol(page).locator('.pcol-more').click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible({ timeout: 15000 });

  // Default collapsed in the drawer too — grandchild starts hidden.
  const drawerRows = drawer.locator('.prow-todo');
  await expect(drawerRows.filter({ hasText: 'Measure wall outlet height' })).toHaveCount(0);

  // Expand parent → subtask 'Pick a standing desk' visible. Expand
  // that subtask → grandchild appears.
  await drawerRows.filter({ hasText: 'Plan home office overhaul' }).locator('.prow-chev').click();
  await drawerRows.filter({ hasText: 'Pick a standing desk' }).locator('.prow-chev').click();
  await expect(drawerRows.filter({ hasText: 'Measure wall outlet height' })).toHaveCount(1);

  // Grandchild is at depth=2 in the drawer (not capped).
  const gc = drawerRows.filter({ hasText: 'Measure wall outlet height' });
  await expect(gc).toHaveAttribute('data-depth', '2');

  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);
});

test('home personal todos: expansion state persists across reload (localStorage)', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const rows = todosCol(page).locator('.prow-todo');
  const planRow = rows.filter({ hasText: 'Plan home office overhaul' });
  await planRow.locator('.prow-chev').click();
  await expect(rows.filter({ hasText: 'Order monitor arm' })).toHaveCount(1);

  // localStorage should now record at least one expanded parent id.
  const stored = await page.evaluate(() => window.localStorage.getItem('obv2.todos.expanded'));
  expect(stored).toBeTruthy();
  const ids = JSON.parse(stored!) as string[];
  expect(Array.isArray(ids)).toBe(true);
  expect(ids.length).toBeGreaterThan(0);

  // Reload — state must survive.
  await page.reload();
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const rowsAfter = todosCol(page).locator('.prow-todo');
  await expect(rowsAfter.filter({ hasText: 'Order monitor arm' })).toHaveCount(1);
});
