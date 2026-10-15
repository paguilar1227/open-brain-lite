// Shared boilerplate for every spec file. Importing this module attaches
// the standard beforeEach/afterEach hooks to the importing test file —
// the side effect is intentional, so each spec only needs to import what
// it uses (stamp, navTo, etc.) and the hooks come along for free.
//
// beforeEach:
//   1. Force the sidebar to 'expanded' before the SPA mounts. Default is
//      'collapsed', which hides .label spans via CSS and breaks every
//      text-based selector that targets sidebar items.
//   2. Navigate to '/' and wait for the SPA to be interactive.
//
// afterEach:
//   Sweep anything created during the test that's prefixed with `e2e:`.
//   Hard-deletes (?hard=true) so the next test starts clean — soft-delete
//   would leave archived rows that interfere with counter/list assertions.

import { test, type Page } from '@playwright/test';
import {
  deleteContent,
  deleteProject,
  deleteTodo,
  listContent,
  listProjects,
  listTodos,
} from './api';
import { waitForAppReady } from './utils';

export const E2E_PREFIX = 'e2e:';
export const stamp = (): string =>
  `${E2E_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const SIDEBAR = 'aside.sidebar';
export const TABBAR = 'nav.mobile-tabbar';
export const MORE_SHEET = '.m-sheet';

export const navTo = (page: Page, label: string) =>
  page.locator(`${SIDEBAR} .sb-item:has(.label:text-is("${label}"))`).click();

export const projectTo = (page: Page, name: string) =>
  page.locator(`${SIDEBAR} .sb-projects .sb-item:has(.label:text-is("${name}"))`).click();

/** Mobile: open the More bottom-sheet from the tabbar. Specs that act on
 *  rows inside the sheet use this so the tap-More dance isn't repeated. */
export const openMoreSheet = async (page: Page) => {
  await page.locator(`${TABBAR} .mtab`, { hasText: 'More' }).click();
  await page.locator(MORE_SHEET).waitFor({ state: 'visible' });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('ob.sidebarMode', 'expanded');
  });
  await page.goto('/');
  await waitForAppReady(page);
});

test.afterEach(async () => {
  for (const p of await listProjects()) {
    if (p.name.startsWith(E2E_PREFIX)) {
      try { await deleteProject(p.id); } catch { /* ignore */ }
    }
  }
  for (const t of await listTodos()) {
    if (t.content.startsWith(E2E_PREFIX)) {
      try { await deleteTodo(t.id); } catch { /* ignore */ }
    }
  }
  for (const c of await listContent()) {
    if (c.title.startsWith(E2E_PREFIX)) {
      try { await deleteContent(c.id); } catch { /* ignore */ }
    }
  }
});
