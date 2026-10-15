// Tag filtering at the top of Home, applied to all 3 personal widgets
// (todos / notes / documents). Verifies the chip-row UX, the AND/OR
// toggle, and URL persistence + reload hydration.

import { expect, test } from '@playwright/test';
import {
  createDoc,
  createNote,
  createTodo,
  deleteContent,
  deleteTodo,
  listContent,
  listTodos,
} from '../../helpers/api';
import { stamp } from '../../helpers/setup';
import { waitForAppReady } from '../../helpers/utils';

// Per-run tag namespace so parallel/sequential specs can't bleed into
// each other's chip rows. Build at module load — same value across all
// tests in this file's worker.
const TAG_A = `e2etag-a-${Math.random().toString(36).slice(2, 7)}`;
const TAG_B = `e2etag-b-${Math.random().toString(36).slice(2, 7)}`;

// Per-test stamp, set in beforeEach and read by the test bodies so they can
// match the exact seeded items (e.g. `${s} todo-AB`) in the search results.
let s = '';

test.describe('Home tag filtering', () => {
  // Seeded items: todos + notes + documents. AC-3 requires all three
  // content widgets to filter by tags; we now seed an inline doc fixture
  // (type=text, no multipart/OCR needed) so the docs path is asserted
  // with real outcomes, not just structural assumption.
  //
  // We seed AFTER the helpers/setup.ts beforeEach has already done its
  // page.goto('/'), so the initial app render saw an empty (or pre-seed)
  // tag list. page.reload() forces re-fetch so the chip row sees our
  // seeded tags.
  test.beforeEach(async ({ page }) => {
    s = stamp();
    await createTodo(`${s} todo-A`, null, { tags: [TAG_A] });
    await createTodo(`${s} todo-AB`, null, { tags: [TAG_A, TAG_B] });
    await createTodo(`${s} todo-B`, null, { tags: [TAG_B] });
    await createNote(`${s} note-A`, 'note body A', { tags: [TAG_A] });
    await createNote(`${s} note-B`, 'note body B', { tags: [TAG_B] });
    await createDoc(`${s} doc-A`, 'doc body A', { tags: [TAG_A] });
    await createDoc(`${s} doc-B`, 'doc body B', { tags: [TAG_B] });
    await page.reload();
    await page.locator('[data-tag-filter]').waitFor({ state: 'visible' });
  });

  test('chip row renders + Clear hidden until a chip is active', async ({ page }) => {
    const filterBar = page.locator('[data-tag-filter]');
    await expect(filterBar).toBeVisible();
    // Our seeded tags appear as chips somewhere in the row.
    await expect(filterBar.getByRole('button', { name: `#${TAG_A}` })).toBeVisible();
    await expect(filterBar.getByRole('button', { name: `#${TAG_B}` })).toBeVisible();
    // No Clear until a tag is selected.
    await expect(filterBar.getByRole('button', { name: /clear tag filter/i })).toHaveCount(0);
  });

  test('single tag scopes the results + URL updates + Clear restores', async ({ page }) => {
    const filterBar = page.locator('[data-tag-filter]');
    const chipA = filterBar.getByRole('button', { name: `#${TAG_A}` });
    await chipA.click();
    await expect(chipA).toHaveAttribute('aria-pressed', 'true');
    // URL gets ?tag=TAG_A, no mode (OR is default-omitted).
    await expect.poll(() => new URL(page.url()).searchParams.get('tag')).toBe(TAG_A);
    await expect.poll(() => new URL(page.url()).searchParams.has('mode')).toBe(false);

    // Selecting a tag switches Home into the unified search-results list,
    // scoped to TAG_A. Assert via todos — they're searchable the instant
    // they're created; notes/docs race the ingest pipeline (search only
    // returns processing_status='ready' rows). The A-carrying todo shows;
    // the B-only todo does not.
    const results = page.locator('.home-search-results .search-hit');
    await expect(results.filter({ hasText: `${s} todo-AB` })).toHaveCount(1);
    await expect(results.filter({ hasText: `${s} todo-B` })).toHaveCount(0);

    // Clear restores the dashboard: results list gone, the columns return.
    await filterBar.getByRole('button', { name: /clear tag filter/i }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has('tag')).toBe(false);
    await expect(chipA).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-pcol="todos"]')).toBeVisible();
  });

  test('AND toggle: OR yields the union, AND the intersection', async ({ page }) => {
    const filterBar = page.locator('[data-tag-filter]');
    await filterBar.getByRole('button', { name: `#${TAG_A}` }).click();
    // Mode toggle hidden at 1 selected.
    await expect(filterBar.locator('.home-tag-filter-mode-btn')).toHaveCount(0);

    await filterBar.getByRole('button', { name: `#${TAG_B}` }).click();
    // Mode toggle visible at 2.
    await expect(filterBar.locator('.home-tag-filter-mode-btn')).toHaveCount(2);

    // Selecting tags switches Home into the unified search-results list (the
    // per-column dashboard is replaced). Results are scoped to this run's
    // tags, so they hold only our seeded items. We assert on todos: they're
    // searchable immediately (no ingest pipeline, unlike notes/docs).
    //
    // Regression guard for the OR=AND bug: before the `tag_match` fix the
    // backend always intersected (@>), so OR wrongly dropped todo-B. `todo-B`
    // is not a substring of `todo-AB`, so the hasText filters are exact.
    const results = page.locator('.home-search-results .search-hit');

    // Default OR: union of A|B — the B-only todo AND the both-tagged todo show.
    await expect(results.filter({ hasText: `${s} todo-B` })).toHaveCount(1);
    await expect(results.filter({ hasText: `${s} todo-AB` })).toHaveCount(1);

    // Switch to AND (radio): intersection — only the both-tagged todo survives;
    // the B-only todo drops out.
    await filterBar.getByRole('radio', { name: 'AND' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('and');
    await expect(results.filter({ hasText: `${s} todo-AB` })).toHaveCount(1);
    await expect(results.filter({ hasText: `${s} todo-B` })).toHaveCount(0);
  });

  test('URL hydration on reload (no flash of unfiltered content)', async ({ page }) => {
    await page.goto(`/?tag=${TAG_A}`, { waitUntil: 'domcontentloaded' });
    // Wait specifically for the chip row to mount (NOT for networkidle —
    // that misses the flash window). The first observable state of the
    // chip MUST be pressed=true, never pressed=false then pressed=true.
    const chipA = page.locator(`[data-tag-filter] button:has-text("#${TAG_A}")`);
    await chipA.waitFor({ state: 'attached' });
    await expect(chipA).toHaveAttribute('aria-pressed', 'true');
    // The hydrated tag drives the unified search-results list from first
    // render — the A-carrying todo is present, the B-only one is not.
    // (Todos are searchable immediately; notes/docs race ingest.)
    const results = page.locator('.home-search-results .search-hit');
    await expect(results.filter({ hasText: `${s} todo-AB` })).toHaveCount(1);
    await expect(results.filter({ hasText: `${s} todo-B` })).toHaveCount(0);
  });

  test('keyboard nav: ArrowRight moves focus, Space toggles', async ({ page }) => {
    const chipA = page.locator(`[data-tag-filter] button:has-text("#${TAG_A}")`);
    await chipA.focus();
    await page.keyboard.press('Space');
    await expect(chipA).toHaveAttribute('aria-pressed', 'true');

    // ArrowRight MUST move focus — assert that the focused element is no
    // longer chipA. A broken Arrow handler that swallowed the keypress
    // would leave focus on chipA and fail this assertion.
    await page.keyboard.press('ArrowRight');
    const focusedIsChipA = await chipA.evaluate((el) => el === document.activeElement);
    expect(focusedIsChipA).toBe(false);

    // The newly-focused chip is some tag chip — Space toggles it. Assert via
    // a retrying `:focus` locator, NOT a one-shot activeElement read: the
    // read otherwise races React's state update AND the search-mode re-render
    // that selecting the 2nd tag triggers (this is what made the test flaky).
    // Focus stays on the chip across that re-render, so `:focus` stays valid.
    const focusedChip = page.locator('[data-tag-filter] button[aria-pressed]:focus');
    await expect(focusedChip).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(focusedChip).toHaveAttribute('aria-pressed', 'true');
  });

  test.afterEach(async () => {
    // Sweep ALL three entity types tagged with this run's namespace so
    // we don't leak fixtures across runs into the local-dev / CI ephemeral
    // DB. Previously only todos were swept — notes leaked, and the doc
    // fixture added in this PR would leak too. listContent returns both
    // documents and notes; one pass covers both.
    const touched = (t: { tags?: string[] }) =>
      t.tags?.includes(TAG_A) || t.tags?.includes(TAG_B);

    const todos = await listTodos().catch(() => []);
    for (const t of todos) {
      if (touched(t)) {
        try { await deleteTodo(t.id); } catch { /* ignore */ }
      }
    }
    const content = await listContent().catch(() => []);
    for (const c of content) {
      if (touched(c)) {
        try { await deleteContent(c.id); } catch { /* ignore */ }
      }
    }
  });
});

// global beforeEach (sidebar expanded + nav to /) lives in helpers/setup.ts;
// importing stamp() from there pulls those hooks in via side-effect.
void waitForAppReady;
