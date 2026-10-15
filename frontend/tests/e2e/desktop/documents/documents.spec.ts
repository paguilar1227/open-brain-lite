import { expect, test } from '@playwright/test';
import { projectTo } from '../../helpers/setup';

test('document flow: open Add modal, queue a URL, see it stay in the queue', async ({ page }) => {
  await projectTo(page, 'ClaudePit');
  await page.locator('.proj-hero .btn-primary', { hasText: 'Add' }).click();
  await expect(page.locator('.modal-head h3', { hasText: /Add to/ })).toBeVisible();

  await page.locator('.modal input[placeholder*="https"]').fill('https://example.com/article');
  await page.locator('.modal .btn', { hasText: 'Queue' }).click();
  await expect(page.locator('.modal').getByText('https://example.com/article')).toBeVisible();
});

test('upload modal: default-tags editor autocompletes existing project tags (shared TagInput)', async ({ page }) => {
  await projectTo(page, 'ClaudePit');
  await page.locator('.proj-hero .btn-primary', { hasText: 'Add' }).click();
  const modal = page.locator('.modal');
  await expect(modal.locator('.modal-head h3', { hasText: /Add to/ })).toBeVisible();

  // Default tags is now a chip editor with the same autocomplete as search:
  // open it, type a prefix, and the existing #auth tag is offered.
  await modal.locator('button.btn-ghost.btn-sm', { hasText: 'Add' }).click();
  await modal.locator('.input-tag').fill('au');
  const suggestion = modal.locator('.typeahead-popover .typeahead-row', { hasText: 'auth' });
  await expect(suggestion).toBeVisible();

  await suggestion.click();
  await expect(modal.locator('.tag', { hasText: 'auth' }).first()).toBeVisible();
});

test('document card ⋯ menu: opens the per-document actions (used to be a dead button)', async ({ page }) => {
  // Regression: the doc card's ⋯ had no handler — it rendered but did nothing.
  // On mobile the inline actions are hidden, so this menu is the ONLY way to
  // reach pin/reprocess/archive. Walk the real path and assert the shared
  // <OverflowMenu> opens with those actions reachable.
  await projectTo(page, 'ClaudePit');
  await page.getByRole('tab', { name: /Documents/ }).click();

  const row = page.locator('.doc-row').first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Document actions' }).click();
  const menu = row.locator('.overflow-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Pin|Unpin/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Reprocess/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Archive/ })).toBeVisible();
});
