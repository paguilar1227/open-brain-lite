// Each spec calls setup() to attach hooks to its own suite. Import side
// effects run only once when the worker caches this module across files.
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
import { randomUUID } from 'node:crypto';
import {
  installationKey,
  deleteContent,
  deleteProject,
  deleteTodo,
  listContent,
  listProjects,
  listTodos,
} from './api';
import { waitForAppReady } from './utils';

// Each worker owns its fixtures; cleanup must not touch another run's records.
export const E2E_PREFIX = `e2e:${randomUUID()}:`;
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

export function setup() {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ob.sidebarMode', 'expanded');
    });
    await page.goto('/');
    await page.locator('.app, .login-card').first().waitFor({ state: 'visible' });
    if (await page.getByLabel('Workspace API key').isVisible()) {
      await page.getByLabel('Workspace API key').fill(installationKey());
      await page.getByRole('button', { name: 'Open my brain' }).click();
    }
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    for (const p of await listProjects()) {
      if (p.name.includes(E2E_PREFIX)) {
        try { await deleteProject(p.id); } catch { /* ignore */ }
      }
    }
    for (const t of await listTodos()) {
      if (t.content.includes(E2E_PREFIX)) {
        try { await deleteTodo(t.id); } catch { /* ignore */ }
      }
    }
    for (const c of await listContent()) {
      if (c.title.includes(E2E_PREFIX)) {
        try { await deleteContent(c.id); } catch { /* ignore */ }
      }
    }
  });
}
