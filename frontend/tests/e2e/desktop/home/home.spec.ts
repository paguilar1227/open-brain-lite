// Home — the merged-Inbox landing page. Asserts the structure renders:
// hero greeting, search row, Personal top row (Todos + Notes), lower row
// (Documents + Recent activity), and the Pinned chip strip.
// Behavior tests for personal todo flows live in personal-todos.spec.ts.
import { expect, test } from '@playwright/test';
import '../../helpers/setup';

test('home: structure renders — hero, search, top row, personal columns, pinned strip', async ({ page }) => {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();

  // Search row + scope toggle (default Personal).
  await expect(page.locator('.home-search-box input')).toBeVisible();
  const personalTab = page.locator('.home-scope-toggle button', { hasText: 'Personal' });
  const allTab = page.locator('.home-scope-toggle button', { hasText: 'All projects' });
  await expect(personalTab).toHaveClass(/active/);
  await expect(allTab).not.toHaveClass(/active/);

  // Personal section: top row is two columns (Todos + Notes), each with a
  // quick-add input.
  await expect(page.locator('.home-personal-h h2', { hasText: 'Personal' })).toBeVisible();
  const todosCol = page.locator('.home-personal-grid .pcol').filter({ has: page.locator('h3:text-is("Todos")') });
  const notesCol = page.locator('.home-personal-grid .pcol').filter({ has: page.locator('h3:text-is("Notes")') });
  await expect(todosCol).toBeVisible();
  await expect(notesCol).toBeVisible();
  await expect(todosCol.locator('.pcol-add input')).toBeVisible();
  await expect(notesCol.locator('.pcol-add input')).toBeVisible();

  // Lower row: the Documents widget sits beside the Recent activity card.
  // (The Overview card was removed — Top Tags lives in the filter bar,
  // Active Projects in the Projects nav.)
  const docsCol = page.locator('.home-top-row .pcol').filter({ has: page.locator('h3:text-is("Documents")') });
  await expect(docsCol).toBeVisible();
  await expect(page.locator('.home-top-row .stat-activity')).toBeVisible();

  // Seed has 2 pinned projects → strip exists with at least one chip.
  await expect(page.locator('.home-pinned-strip .pin-chip').first()).toBeVisible();
});

test('home: scope toggle flips active state', async ({ page }) => {
  const personalTab = page.locator('.home-scope-toggle button', { hasText: 'Personal' });
  const allTab = page.locator('.home-scope-toggle button', { hasText: 'All projects' });

  await allTab.click();
  await expect(allTab).toHaveClass(/active/);
  await expect(personalTab).not.toHaveClass(/active/);

  await personalTab.click();
  await expect(personalTab).toHaveClass(/active/);
  await expect(allTab).not.toHaveClass(/active/);
});

test('home: pinned chip routes to the project page', async ({ page }) => {
  // Click the first pinned chip and confirm the project hero renders.
  const firstChip = page.locator('.home-pinned-strip .pin-chip').first();
  const name = (await firstChip.innerText()).trim();
  await firstChip.click();
  await expect(page.locator('.proj-hero h1', { hasText: name })).toBeVisible();
});
