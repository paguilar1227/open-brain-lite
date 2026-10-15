// Sidebar navigation: collapse/expand toggle, every Workspace nav row,
// and clicking a pinned project from the sidebar.
import { expect, test } from '@playwright/test';
import { SIDEBAR, navTo, projectTo } from '../../helpers/setup';

test('sidebar: clicking a pinned project navigates to its detail page', async ({ page }) => {
  await projectTo(page, 'ClaudePit');
  await expect(page.locator('.proj-hero h1', { hasText: 'ClaudePit' })).toBeVisible();
  await expect(page.locator('[role="tab"]', { hasText: 'Todos' })).toBeVisible();
});

test('sidebar: collapse button toggles the sidebar mode and persists to localStorage', async ({ page }) => {
  // beforeEach forces 'expanded' before nav. Verify the starting state
  // matches what the user sees, then toggle twice.
  await expect(page.locator('.app[data-sb="expanded"]')).toBeVisible();

  const collapseBtn = page.locator(`${SIDEBAR} .sb-collapse`);
  await collapseBtn.click();
  await expect(page.locator('.app[data-sb="collapsed"]')).toBeVisible();
  // Labels are hidden via CSS in collapsed mode — visual sanity that the
  // mode transition actually changed what the user sees.
  await expect(page.locator(`${SIDEBAR} .sb-item .label`).first()).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('ob.sidebarMode'))).toBe('collapsed');

  await collapseBtn.click();
  await expect(page.locator('.app[data-sb="expanded"]')).toBeVisible();
  await expect(page.locator(`${SIDEBAR} .sb-item .label`).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ob.sidebarMode'))).toBe('expanded');
});

test('sidebar: every Workspace nav row routes to the right page', async ({ page }) => {
  // Hero h1 is the canonical "you are here" signal. Walking each nav row
  // and matching the h1 covers the routing wire-up end to end.
  const routes: Array<[string, RegExp]> = [
    ['Home', /Welcome back/],
    ['Projects', /^Projects$/],
    ['Activity', /^Activity$/],
    ['Tags', /^Tags$/],
    ['Archived', /^Archived$/],
  ];
  for (const [label, hero] of routes) {
    await navTo(page, label);
    await expect(page.locator('main h1', { hasText: hero })).toBeVisible();
  }
});
