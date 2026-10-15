// Regression: the personal Notes/Docs/Todos drawers + project tabs now search
// via the shared SearchInput + useEntitySearch (lexical+vector+graph hybrid)
// with a `#tag` typeahead — previously a substring filter with no typeahead.
//
// Pins, against the deterministic seed (scripts/seed-local.ts):
//   - `#` opens the tag typeahead inside a drawer (the missing affordance)
//   - free-text runs hybrid search → result rows, with NO search error
//     (also guards the similarity-nullable schema fix: a lexical/graph hit
//     with null similarity must not crash SearchResponseSchema.parse)
//   - todo hits render as full TodoRows (the hit carries the whole todo)
//   - clearing returns to the browse list
//   - project tabs mode-switch: cards/hierarchy → flat rows while searching
//
// Each test walks a real click-path against running services (stub LLM).

import { expect, test, type Page, type Locator } from '@playwright/test';
import { setup } from '../../helpers/setup';
setup();

// Seed contract — personal items reachable from the home column drawers, and
// a project that has notes. Update if the seed changes; don't fudge.
const NOTE_HIT = 'Travel — Lisbon trip ideas';   // personal note, lexical-strong for "travel"
const DOC_HIT = 'SF coffee shortlist';            // personal document, lexical-strong for "coffee"
const TODO_HIT = 'Buy new mechanical keyboard';   // personal todo, lexical-strong for "keyboard"
const PROJECT = 'Homelab';
const PROJECT_NOTE_HIT = 'Tailscale exit nodes — caveats';

// Any column widget on Home by title — Todos/Notes live in the top grid,
// Documents in the lower row beside Activity, so match `.pcol` page-wide
// rather than scoping to one container.
const col = (page: Page, title: string) =>
  page.locator('.pcol').filter({ has: page.locator(`h3:text-is("${title}")`) });

async function openDrawer(page: Page, columnTitle: string): Promise<Locator> {
  await expect(page.locator('h1', { hasText: /Welcome back/ })).toBeVisible();
  const more = col(page, columnTitle).locator('.pcol-more');
  await expect(more).toBeVisible();
  await more.click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible({ timeout: 15000 });
  return drawer;
}

const searchInput = (scope: Locator | Page) =>
  scope.locator('.todo-list-drawer-toolbar .search-input-wrapper input, .filter-bar .search-box .search-input-wrapper input');

/** Type into a (drawer or tab) SearchInput and wait for the hybrid /search
 *  round-trip that THIS keystroke triggers. */
async function searchAndSettle(page: Page, scope: Locator | Page, value: string) {
  const fetchPromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/search') && r.request().method() === 'POST',
    { timeout: 6000 },
  );
  await searchInput(scope).fill(value);
  await fetchPromise;
}

test.describe('drawer + tab search: unified SearchInput + hybrid search', () => {
  test('notes drawer: # opens the tag typeahead AND the search does not crash', async ({ page }) => {
    const drawer = await openDrawer(page, 'Notes');
    // The bare '#' query returns lexical/graph hits whose similarity AND
    // retrieval_path[].score are null — these must parse, not error out the
    // search (regression: behind the typeahead, the body was a ZodError wall).
    const fetchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/search') && r.request().method() === 'POST',
      { timeout: 6000 },
    );
    await searchInput(drawer).fill('#');
    await expect(page.locator('.typeahead-popover')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.typeahead-popover')).toContainText('#');
    await fetchPromise;
    await expect(drawer.locator('.search-drawer-error')).toHaveCount(0);
  });

  test('notes drawer: tag typeahead is scoped to personal notes (no project-only tags)', async ({ page }) => {
    const drawer = await openDrawer(page, 'Notes');
    await searchInput(drawer).fill('#');
    const popover = page.locator('.typeahead-popover');
    await expect(popover).toBeVisible({ timeout: 3000 });
    // #rag lives only on project items (RAG Research) → suggesting it here
    // would promise hits the personal-notes search returns 0 of. It must be
    // scoped out; #chore (on personal notes) must remain.
    await expect(popover).not.toContainText('rag');
    await expect(popover).toContainText('chore');
    // And a suggested tag yields actual results — count matches the search.
    await searchAndSettle(page, drawer, '#chore');
    await expect(drawer.locator('.prow-note').first()).toBeVisible({ timeout: 5000 });
  });

  test('notes drawer: rows show tag chips so #tag filter completeness is visible', async ({ page }) => {
    const drawer = await openDrawer(page, 'Notes');
    await searchAndSettle(page, drawer, '#chore');
    const firstRow = drawer.locator('.todo-list-drawer-rows .prow-note').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    // Each #chore result visibly carries the #chore chip — the user can see
    // the filter caught the right notes.
    await expect(firstRow.locator('.prow-tags .tag').filter({ hasText: 'chore' })).toHaveCount(1);
  });

  test('notes drawer: browse rows show a distinct folder chip (not a tag)', async ({ page }) => {
    const drawer = await openDrawer(page, 'Notes');
    // Browse mode (no query): seeded personal notes carry folder paths.
    await expect(drawer.locator('.todo-list-drawer-rows .prow-note').first()).toBeVisible({ timeout: 5000 });
    // The folder renders as its own chip (.prow-folder), separate from the
    // tag chips, and shows a hierarchical path.
    const folderChip = drawer.locator('.prow-folder', { hasText: '/' }).first();
    await expect(folderChip).toBeVisible();
    // It is NOT a tag chip — distinct element.
    await expect(folderChip).not.toHaveClass(/\btag\b/);
  });

  test('notes drawer: free-text runs hybrid search → rows, no schema crash', async ({ page }) => {
    const drawer = await openDrawer(page, 'Notes');
    await searchAndSettle(page, drawer, 'travel');
    await expect(drawer.locator('.search-drawer-error')).toHaveCount(0); // null-similarity fix
    await expect(drawer.locator('.prow-note').first()).toBeVisible({ timeout: 5000 });
    await expect(drawer).toContainText(NOTE_HIT);
  });

  test('documents drawer: free-text runs hybrid search → doc rows', async ({ page }) => {
    const drawer = await openDrawer(page, 'Documents');
    await searchAndSettle(page, drawer, 'coffee');
    await expect(drawer.locator('.search-drawer-error')).toHaveCount(0);
    await expect(drawer.locator('.prow-doc').first()).toBeVisible({ timeout: 5000 });
    await expect(drawer).toContainText(DOC_HIT);
  });

  test('todos drawer: search renders full TodoRows (hit carries the whole todo)', async ({ page }) => {
    const drawer = await openDrawer(page, 'Todos');
    await searchAndSettle(page, drawer, 'keyboard');
    await expect(drawer.locator('.search-drawer-error')).toHaveCount(0);
    await expect(drawer.locator('.prow-todo').first()).toBeVisible({ timeout: 5000 });
    await expect(drawer).toContainText(TODO_HIT);
  });

  test('notes drawer: clearing the query returns to the browse list', async ({ page }) => {
    const drawer = await openDrawer(page, 'Notes');
    await searchAndSettle(page, drawer, 'travel');
    await expect(drawer.locator('.prow-note').first()).toBeVisible();
    await searchInput(drawer).fill('');
    await expect(drawer).toContainText(/Personal notes · \d+/, { timeout: 5000 });
  });

  test('project notes tab: searching switches from card grid to flat rows', async ({ page }) => {
    await page.locator('aside.sidebar .sb-projects .sb-item', { hasText: PROJECT }).click();
    await expect(page.locator('h1', { hasText: PROJECT })).toBeVisible();
    await page.locator('[role="tab"]', { hasText: 'Notes' }).click();
    await expect(page.locator('.note-grid')).toBeVisible({ timeout: 5000 });

    await searchAndSettle(page, page, 'tailscale');
    await expect(page.locator('.note-grid')).toHaveCount(0);           // cards hidden
    await expect(page.locator('.todo-list-drawer-rows .prow-note').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.todo-list-drawer-rows')).toContainText(PROJECT_NOTE_HIT);
  });
});
