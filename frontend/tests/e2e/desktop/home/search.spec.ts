// Universal search bar — end-to-end coverage of every documented use case.
//
// Pins behavior against the deterministic seed in scripts/seed-local.ts.
// Counts referenced in assertions are derived from grepping that seed file;
// if the seed changes, update the constants at the top of this spec
// rather than fudging assertions.
//
// Layered against the parser features (`#tag`, `-#tag`, `in:type`, `@name`,
// `project:name`, exclusions, combinations), the UI features (live debounce,
// inline mode-switch, scope chips, predicate chips with X, bidirectional
// sync, URL persistence, click-to-open with selection guard), and the
// cross-page navigation (ProjectPage → home, CommandPalette → home).
//
// Each test exercises a real user click-path against running services
// (Postgres + Azurite + LLM_PROVIDER=stub) — no mocked plumbing.

import { expect, test, type Page } from '@playwright/test';
import '../../helpers/setup';

// ---- Seed-data contract (kept in sync with scripts/seed-local.ts) ---------
// Update these constants when the seed changes; do NOT inline counts.
const CHORE_COUNT = 4;               // 2 notes + 2 todos tagged 'chore'
const TAX_NOTE_TITLE = 'Tax docs checklist';
const KEYBOARD_TODO_TITLE = 'Buy new mechanical keyboard';
const CLAUDEPIT_PROJECT = 'ClaudePit';
// A reference-tagged note that ranks reliably in the top-30 for a narrow
// query — used by the -#tag exclusion test for before/after symmetry.
const REFERENCE_NOTE = 'macOS keyboard shortcuts I keep forgetting';

// ---- Helpers --------------------------------------------------------------

const input = (page: Page) => page.locator('.home-search-box input');
const hits = (page: Page) => page.locator('.search-hit');
const dashboard = (page: Page) => page.locator('.home-personal-h');

/** Type into the search input and wait for the resulting /search fetch to
 *  complete. Without this, back-to-back typeAndSettle() calls race on stale
 *  data: the first query's results still satisfy "search-hit visible" while
 *  the second query is still in flight. We pin the wait to the actual
 *  network round-trip that corresponds to THIS fill(). */
async function typeAndSettle(page: Page, value: string) {
  const fetchPromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/search') && r.request().method() === 'POST',
    { timeout: 5000 },
  );
  await input(page).fill(value);
  await fetchPromise;
  // Belt-and-braces: ensure the "Searching…" spinner has fully resolved
  // before the test reads from the DOM.
  await expect(page.locator('.home-search-results')).not.toContainText('Searching', { timeout: 2000 });
}

// ---------------------------------------------------------------------------
// Parser-level use cases (#1–#10)
// ---------------------------------------------------------------------------

test.describe('search: parser-level features', () => {
  test('#1 free text returns vector hits', async ({ page }) => {
    await typeAndSettle(page, 'pgvector');
    await expect(hits(page).first()).toBeVisible();
    // At least one hit should show 'vector' provenance for a clean text query.
    const paths = await page.locator('.search-hit-path').allTextContents();
    expect(paths).toContain('vector');
  });

  test('#2 #tag filter returns exactly the tagged set (filter-only path)', async ({ page }) => {
    await typeAndSettle(page, '#chore');
    await expect(hits(page)).toHaveCount(CHORE_COUNT);
    // Filter-only path: every result was reached by the lexical arm.
    const paths = await page.locator('.search-hit-path').allTextContents();
    expect(paths.every((p) => p === 'lexical')).toBe(true);
    // Results count chip mirrors the hit count.
    await expect(page.locator('.results-count')).toContainText(`${CHORE_COUNT} results`);
  });

  test('#3 -#tag excludes that tag (before/after symmetry)', async ({ page }) => {
    // Baseline: the narrow query "macOS" reliably surfaces a known
    // reference-tagged note in the top-30 limit. Then add -#reference and
    // confirm the note is filtered out. Same query, only difference is
    // the exclusion predicate — clean symmetry.
    await typeAndSettle(page, 'macOS');
    let titles = await page.locator('.search-hit-title').allTextContents();
    expect(titles).toContain(REFERENCE_NOTE);
    await typeAndSettle(page, 'macOS -#reference');
    titles = await page.locator('.search-hit-title').allTextContents();
    expect(titles).not.toContain(REFERENCE_NOTE);
  });

  test('#4 in:todo restricts entity kind to todos', async ({ page }) => {
    await typeAndSettle(page, 'in:todo');
    await expect(hits(page).first()).toBeVisible();
    // Every hit's entity-kind chip should read 'todo'. The chip lives in
    // .search-hit-head; the retrieval-path chips live in .search-hit-paths
    // and share the .tag class, so scope to the head subtree.
    const kinds = await page.locator('.search-hit-head .tag').allTextContents();
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k.trim() === 'todo')).toBe(true);
  });

  test('#5 -in:document excludes document hits', async ({ page }) => {
    await typeAndSettle(page, 'sample -in:document');
    const kinds = await page.locator('.search-hit-head .tag').allTextContents();
    for (const k of kinds) expect(k.trim()).not.toBe('document');
  });

  test('#6 @"Tax docs checklist" filters to that exact item', async ({ page }) => {
    await typeAndSettle(page, '@"Tax docs checklist"');
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first().locator('.search-hit-title')).toHaveText(TAX_NOTE_TITLE);
  });

  test('#7 project:ClaudePit scopes to that project (each hit shows ClaudePit label)', async ({ page }) => {
    await typeAndSettle(page, `project:${CLAUDEPIT_PROJECT}`);
    await expect(hits(page).first()).toBeVisible();
    const projectLabels = await page.locator('.search-hit-project').allTextContents();
    expect(projectLabels.length).toBeGreaterThan(0);
    expect(projectLabels.every((p) => p.trim() === CLAUDEPIT_PROJECT)).toBe(true);
  });

  test('#8 free text + tag combo narrows to the intersection', async ({ page }) => {
    await typeAndSettle(page, 'tax #chore');
    // "Tax docs checklist" is the only chore-tagged item matching "tax".
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first().locator('.search-hit-title')).toHaveText(TAX_NOTE_TITLE);
  });

  test('#9 -project:Homelab is parsed (chip renders) — server enforcement is a known gap', async ({ page }) => {
    // Documents the parser side. The predicate chip should render; the
    // backend exclusion is on the followup list (excludedProjects[] not
    // wired through SQL yet). When that ships, tighten this test.
    await typeAndSettle(page, 'tailscale -project:Homelab');
    await expect(page.locator('.home-search-predicates')).toContainText('Homelab');
  });

  test('#10 free text + multiple predicates AND-merges correctly', async ({ page }) => {
    await typeAndSettle(page, 'tax #chore in:note');
    // Same single hit as #8, narrower entity-kind filter.
    await expect(hits(page)).toHaveCount(1);
    await expect(hits(page).first().locator('.search-hit-title')).toHaveText(TAX_NOTE_TITLE);
    const kind = await hits(page).first().locator('.search-hit-head .tag').textContent();
    expect(kind?.trim()).toBe('note');
  });
});

// ---------------------------------------------------------------------------
// UI-level use cases (#11–#17)
// ---------------------------------------------------------------------------

test.describe('search: UI behavior', () => {
  test('#11a clicking a note hit opens the note editor', async ({ page }) => {
    await typeAndSettle(page, '@"Tax docs checklist"');
    await hits(page).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Edit note' })).toBeVisible();
  });

  test('#11b clicking a todo hit opens the todo detail drawer', async ({ page }) => {
    await typeAndSettle(page, '#chore in:todo');
    await hits(page).first().click();
    // Todo detail surfaces as a dialog with the priority/status controls.
    await expect(page.getByRole('dialog')).toBeVisible();
    // Priority pill row is unique to the todo detail view.
    await expect(page.getByRole('dialog').getByRole('button', { name: /^P1$/ })).toBeVisible();
  });

  test('#11c clicking a document hit opens the doc reader', async ({ page }) => {
    await typeAndSettle(page, 'in:document');
    await hits(page).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('#12 click with active text selection does NOT open a modal (drag-to-copy preserved)', async ({ page }) => {
    await typeAndSettle(page, '#chore');
    // Programmatically create a selection across the first hit's excerpt,
    // then click. The handler should bail because window.getSelection()
    // reports a non-empty selection.
    const result = await page.evaluate(() => {
      const card = document.querySelector('.search-hit');
      const excerpt = card?.querySelector('.search-hit-excerpt');
      if (!excerpt || !card) return { ok: false, reason: 'no excerpt' };
      const range = document.createRange();
      range.selectNodeContents(excerpt);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const selLen = sel?.toString().length ?? 0;
      (card as HTMLElement).click();
      return { ok: true, selLen };
    });
    expect(result.ok).toBe(true);
    expect((result as { selLen: number }).selLen).toBeGreaterThan(0);
    // Modal should NOT appear.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('#13 scope=Personal restricts hits to Inbox-owned items', async ({ page }) => {
    // Personal is the default scope. Use a tag that exists across both
    // personal and project content so we can verify the scope strips
    // project-scoped hits.
    await page.locator('.home-search-row .home-scope-toggle button', { hasText: 'Personal' }).click();
    await typeAndSettle(page, '#chore');
    await expect(hits(page).first()).toBeVisible();
    const projectLabels = await page.locator('.search-hit-project').allTextContents();
    expect(projectLabels.every((p) => p.trim() === 'Inbox')).toBe(true);
  });

  test('#14 predicate chip click removes it from the input and re-runs the search', async ({ page }) => {
    await typeAndSettle(page, 'tax #chore');
    await expect(hits(page)).toHaveCount(1);
    // The whole predicate chip is the remove-button (X icon inside is just
    // visual). Clicking it strips the predicate from the input.
    const choreChip = page.locator('.home-search-predicates .search-predicate-chip', { hasText: '#chore' });
    await expect(choreChip).toBeVisible();
    await choreChip.click();
    // Input should now hold just "tax" (possibly with trailing space).
    await expect(input(page)).toHaveValue(/^tax\s*$/);
    await page.waitForTimeout(250);
    // With #chore removed, query is broader — more hits, but our anchor
    // (Tax docs checklist) is still present.
    const titles = await page.locator('.search-hit-title').allTextContents();
    expect(titles).toContain(TAX_NOTE_TITLE);
  });

  test('#15 deep-link ?q=%23chore&scope=all hydrates search mode on mount', async ({ page }) => {
    await page.goto('/?q=%23chore&scope=all');
    // Search should be active immediately — no typing needed.
    await expect(input(page)).toHaveValue('#chore');
    await expect(hits(page)).toHaveCount(CHORE_COUNT, { timeout: 5000 });
  });

  test('#16 ProjectPage search submit navigates to home with scope=<projectId>', async ({ page }) => {
    // Click into ClaudePit from the sidebar, type in its search bar, submit
    // with Enter. We should land on home (?q=... + ?scope=<uuid>).
    await page.locator('aside.sidebar .sb-projects .sb-item', { hasText: CLAUDEPIT_PROJECT }).click();
    await expect(page.locator('h1', { hasText: CLAUDEPIT_PROJECT })).toBeVisible();
    const projInput = page.locator('.proj-search-row .home-search-box input');
    await projInput.fill('streaming');
    await projInput.press('Enter');
    // URL becomes ?q=streaming&scope=<projectUuid>; we assert on the shape.
    await page.waitForURL(/\?q=streaming.*scope=[0-9a-f-]{36}/);
    // And the home page renders with that query already in the input.
    await expect(input(page)).toHaveValue('streaming');
  });

  test('#17 CommandPalette "Search…" action routes to home with empty input focused', async ({ page }) => {
    // CommandPalette's Search action calls onRoute({ route: 'home' }) — it
    // does NOT carry a query, so it just sends the user to home where they
    // can type. The legacy `kind: 'search'` modal is gone (commented in
    // types.ts for grep-discoverability).
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('.cmdk');
    await expect(palette).toBeVisible({ timeout: 3000 });
    // Type to filter actions down to "Search…".
    await palette.locator('.cmdk-input input').fill('Search');
    // Click the Search action row.
    await palette.locator('.cmdk-row', { hasText: /^Search…/ }).first().click();
    // Palette dismissed and we're on home (no query in URL).
    await expect(palette).toHaveCount(0);
    await expect(dashboard(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Mode switch + dashboard restoration (covers use case for empty input)
// ---------------------------------------------------------------------------

test.describe('search: mode switch', () => {
  test('empty input renders the dashboard, not search results', async ({ page }) => {
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator('.home-search-results')).toHaveCount(0);
  });

  test('typing flips to search mode; clearing flips back to dashboard', async ({ page }) => {
    await typeAndSettle(page, '#chore');
    await expect(page.locator('.home-search-results')).toBeVisible();
    await expect(dashboard(page)).toHaveCount(0);
    // Clear and confirm dashboard returns.
    await input(page).fill('');
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator('.home-search-results')).toHaveCount(0);
  });

  test('dashboard scope toggle updates section heading, tag chip row, and widget data (regression)', async ({ page }) => {
    // Repro: the scope toggle was wired to search-mode only; the dashboard
    // (heading + tag chip strip + column widgets) ignored it because their
    // queries were hard-keyed to ['tags', 'home', 'personal'] etc. Toggle
    // now propagates everywhere — verify each surface.
    await expect(page.locator('.home-personal-h h2')).toHaveText('Personal');
    const personalTags = await page.locator('.home-tag-filter .filter-chip, .home-tag-filter button').allTextContents();
    expect(personalTags.length).toBeGreaterThan(0);

    // Click "All projects" in the small dashboard scope toggle.
    await page.locator('.home-scope-toggle button', { hasText: 'All projects' }).click();

    // Heading flips.
    await expect(page.locator('.home-personal-h h2')).toHaveText('All projects');
    // Tag chip row refetched: different set OR different counts.
    await page.waitForFunction(
      (prev) => {
        const cur = Array.from(document.querySelectorAll('.home-tag-filter .filter-chip, .home-tag-filter button')).map((el) => el.textContent);
        return JSON.stringify(cur) !== JSON.stringify(prev);
      },
      personalTags,
      { timeout: 3000 },
    );

    // Flip back to Personal — heading reverts.
    await page.locator('.home-scope-toggle button', { hasText: 'Personal' }).click();
    await expect(page.locator('.home-personal-h h2')).toHaveText('Personal');
  });

  test('clicking sidebar Home from a search-active state resets URL + state (regression)', async ({ page }) => {
    // Repro: a search and a legacy tag-filter are both active in the URL,
    // user clicks the sidebar Home item expecting a fresh dashboard. Before
    // the fix, HomePage's internal query state hung on because its useState
    // initializers only run on mount — clicking Home re-rendered the same
    // instance with the same state, and URL params lingered.
    await page.goto('/?q=%23chore&tag=reference');
    await expect(input(page)).toHaveValue('#chore');
    await expect(hits(page).first()).toBeVisible({ timeout: 5000 });
    // Click the sidebar Home item.
    await page.locator('aside.sidebar .sb-item:has(.label:text-is("Home"))').click();
    // URL stripped clean.
    await expect(page).toHaveURL(/\/$/);
    // Input cleared, dashboard visible, results gone.
    await expect(input(page)).toHaveValue('');
    await expect(dashboard(page)).toBeVisible();
    await expect(page.locator('.home-search-results')).toHaveCount(0);
  });
});
