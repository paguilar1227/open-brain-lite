// Todos view — a dedicated sectioned list reached from the sidebar. Top-level
// todos bucket by their `section` field; completed ones collapse into a Done
// group at the very bottom. Sections are added inline and todos are dragged
// between them (dnd-kit → todo.section + manual_order).
//
// Mutating tests create e2e:-prefixed todos so the shared afterEach sweep
// (helpers/setup) hard-deletes them — the seed is never corrupted.

import { expect, test, type Page } from '@playwright/test';
import { stamp } from '../../helpers/setup';
import { createTodo } from '../../helpers/api';

async function openTodos(page: Page) {
  await page.locator('.sidebar .sb-item', { has: page.locator('.label:text-is("Todos")') }).click();
  await expect(page.locator('.todos-view')).toBeVisible({ timeout: 10000 });
}

const rowByTitle = (page: Page, title: string) =>
  page.locator('.prow-todo', { has: page.locator('.ti', { hasText: title }) });

const sectionBody = (page: Page, name: string) =>
  page.locator('.todos-section', { has: page.locator('.todos-section-name', { hasText: name }) })
    .locator('.todos-section-body');

test.describe('Todos view', () => {
  test('sidebar opens a sectioned list with a Done group + filters', async ({ page }) => {
    await openTodos(page);
    await expect(page.locator('h1', { hasText: 'Todos' })).toBeVisible();
    await expect(page.locator('.todos-section').first()).toBeVisible();
    await expect(page.locator('.todos-done')).toBeVisible();
    await expect(page.locator('.todos-filters .filter-chip', { hasText: 'P1' })).toBeVisible();
  });

  test('tag filter (reused HomeTagFilter) narrows the list to matching todos', async ({ page }) => {
    await openTodos(page);
    const tagBar = page.locator('.todos-view .home-tag-filter');
    await expect(tagBar).toBeVisible();

    // Filter by #reading → only the reading todo remains in the open sections.
    // Scope to the visible chip row (the hidden measure layer also carries
    // .home-filter-chip).
    await tagBar.locator('.home-tag-filter-chips .home-filter-chip', { hasText: 'reading' }).click();
    const openRows = page.locator('.todos-body .todos-section .prow-todo');
    await expect(openRows.filter({ hasText: "Read 'On the Measure of Intelligence'" })).toHaveCount(1);
    // "Reply to Sebastian…" is a non-reading OPEN todo (not_started in the
    // seed) — it drops out under the #reading filter and returns on clear.
    // Must be an OPEN todo: the Done section is collapsed by default, so a
    // done todo reads as 0 rows regardless of the filter and can't prove
    // anything was narrowed/restored.
    await expect(openRows.filter({ hasText: 'Reply to Sebastian' })).toHaveCount(0);

    // Clear restores the full list (the non-reading todo is back).
    await tagBar.locator('.home-tag-filter-clear').click();
    await expect(openRows.filter({ hasText: 'Reply to Sebastian' })).toHaveCount(1);
  });

  test('tag editor offers an autocomplete of existing tags (shared TagInput)', async ({ page }) => {
    const title = stamp() + ' tag-autocomplete';
    await createTodo(title, null);
    await openTodos(page);
    await rowByTitle(page, title).click();
    const drawer = page.locator('.drawer');
    await expect(drawer).toBeVisible({ timeout: 10000 });

    // Open the tag input and type a prefix — the dropdown should surface the
    // existing #reading tag (the whole point: reuse, not retype/misspell).
    await drawer.locator('button.btn-ghost.btn-sm', { hasText: 'Add' }).click();
    await drawer.locator('.input-tag').fill('read');
    const suggestion = drawer.locator('.typeahead-popover .typeahead-row', { hasText: 'reading' });
    await expect(suggestion).toBeVisible();

    // Selecting it commits the existing tag (no manual full-typing).
    await suggestion.click();
    await expect(drawer.locator('.tag', { hasText: 'reading' }).first()).toBeVisible();
  });

  test('Add section reveals an inline input that creates an empty section', async ({ page }) => {
    await openTodos(page);
    await page.locator('.todos-toolbar button', { hasText: 'Add section' }).click();
    await page.locator('.todos-section-input').fill('QA-empty');
    await page.locator('.todos-section-input').press('Enter');
    const sec = page.locator('.todos-section', { has: page.locator('.todos-section-name', { hasText: 'QA-empty' }) });
    await expect(sec).toBeVisible();
    await expect(sec.locator('.todos-section-empty')).toBeVisible(); // "Drop a todo here"
  });

  test('completing a todo moves it to the Done group, struck through', async ({ page }) => {
    const title = stamp(); // e2e:… → swept
    await createTodo(title, null);
    await openTodos(page);
    const row = rowByTitle(page, title);
    await expect(row).toBeVisible();
    await row.locator('.checkbox').click(); // the checkbox
    // It leaves the open sections and appears in the Done group.
    await page.locator('.todos-done-head').click(); // expand Done
    const doneRow = page.locator('.todos-done .prow-todo', { has: page.locator('.ti', { hasText: title }) });
    await expect(doneRow).toBeVisible();
    await expect(doneRow).toHaveClass(/prow-done/);
  });

  test('dragging a todo into a section files it there (cross-section move)', async ({ page }) => {
    const title = stamp();
    await createTodo(title, null);
    await openTodos(page);

    // Add a target section.
    await page.locator('.todos-toolbar button', { hasText: 'Add section' }).click();
    await page.locator('.todos-section-input').fill('QA-target');
    await page.locator('.todos-section-input').press('Enter');

    // Drag the todo's grip into the QA-target section body. dnd-kit's
    // PointerSensor needs a >6px initial move then a stepped move to the drop.
    const grip = rowByTitle(page, title).locator('.prow-grip');
    const target = sectionBody(page, 'QA-target');
    const g = await grip.boundingBox();
    const t = await target.boundingBox();
    if (!g || !t) throw new Error('missing drag boxes');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 12, g.y + g.height / 2 + 12); // cross threshold
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    await page.mouse.up();

    // The todo now lives under QA-target.
    const inTarget = page.locator(
      '.todos-section:has(.todos-section-name:text-is("QA-target")) .prow-todo',
      { has: page.locator('.ti', { hasText: title }) },
    );
    await expect(inTarget).toBeVisible();
  });
});
