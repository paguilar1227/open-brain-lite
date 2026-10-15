// Notes view (Folders browser) — Bear-style 3-column view reached from the
// sidebar. A note's folder is a first-class `folder` field (a single path like
// "cooking/italian"); the tree, the filtered list, and the editable folder-path
// chip are all derived from the folders of the notes in scope.
//
// Pinned against the deterministic seed (scripts/seed-local.ts FOLDER_MAP):
//   cooking → coffee(3) + recipes(2) = 5; travel(4); health(2); etc.

import { expect, test, type Page } from '@playwright/test';
import { setup, stamp } from '../../helpers/setup';
setup();

async function openNotes(page: Page) {
  await page.locator('.sidebar .sb-item', { has: page.locator('.label:text-is("Notes")') }).click();
  await expect(page.locator('.notes-view')).toBeVisible({ timeout: 10000 });
}

const treeRow = (page: Page, name: string) =>
  page.locator('.notes-tree-row', { has: page.locator(`.lbl:text-is("${name}")`) });

const listRows = (page: Page) => page.locator('.notes-list-rows .prow-note');

test.describe('Notes view: Folders browser', () => {
  test('sidebar opens the 3-column folder browser', async ({ page }) => {
    await openNotes(page);
    await expect(page.locator('.notes-tree')).toBeVisible();
    await expect(page.locator('.notes-list')).toBeVisible();
    await expect(page.locator('.notes-detail')).toBeVisible();
    await expect(page.locator('.notes-tree-row', { hasText: 'All notes' })).toBeVisible();
  });

  test('tag filter (reused HomeTagFilter) narrows the list to matching notes', async ({ page }) => {
    await openNotes(page);
    // The reused tag bar lives above the columns on desktop.
    const tagBar = page.locator('.notes-view .home-tag-filter');
    await expect(tagBar).toBeVisible();
    const unfiltered = await listRows(page).count();
    expect(unfiltered).toBeGreaterThan(2);

    // Filter by #reading → only reading-tagged notes remain. Scope to the
    // visible chip row (the hidden measure layer also carries .home-filter-chip).
    await tagBar.locator('.home-tag-filter-chips .home-filter-chip', { hasText: 'reading' }).click();
    await expect(listRows(page)).toHaveCount(2);
    await expect(listRows(page).filter({ hasText: 'Reading list' }).first()).toBeVisible();
    await expect(listRows(page).filter({ hasText: 'Recipe — weeknight ramen' })).toHaveCount(0);

    // Clear restores the full list.
    await tagBar.locator('.home-tag-filter-clear').click();
    await expect(listRows(page)).toHaveCount(unfiltered);
  });

  test('folder tree shows the seeded hierarchy with counts', async ({ page }) => {
    await openNotes(page);
    const cooking = treeRow(page, 'cooking');
    await expect(cooking).toBeVisible();
    await expect(cooking.locator('.ct')).toHaveText('5');
    await expect(treeRow(page, 'travel')).toBeVisible();
    // Expand cooking → coffee + recipes children appear.
    await cooking.locator('.notes-tree-chev').click();
    await expect(treeRow(page, 'coffee')).toBeVisible();
    await expect(treeRow(page, 'recipes')).toBeVisible();
  });

  test('clicking a folder reveals its children + filters the list (incl. descendants)', async ({ page }) => {
    await openNotes(page);
    // Clicking the row both selects AND reveals children (no chevron needed).
    await treeRow(page, 'cooking').click();
    await expect(listRows(page)).toHaveCount(5); // coffee(3) + recipes(2)
    await expect(treeRow(page, 'coffee')).toBeVisible();
    await expect(treeRow(page, 'recipes')).toBeVisible();
    await treeRow(page, 'coffee').click();
    await expect(listRows(page)).toHaveCount(3);
    await expect(page.locator('.notes-list-rows')).toContainText('Pour-over recipe — Hario V60');
  });

  test('selecting a note shows its content + a single click-to-edit folder chip', async ({ page }) => {
    await openNotes(page);
    await treeRow(page, 'cooking').click();
    await listRows(page).first().click();
    await expect(page.locator('.notes-detail-body')).toBeVisible();
    // ONE folder chip (a note belongs to one folder); no remove × and no
    // "+ Folder" button while a folder exists.
    await expect(page.locator('.folder-field-chip')).toContainText('cooking/');
    await expect(page.locator('.folder-field-add')).toHaveCount(0);
    await expect(page.locator('.notes-folder-bar .tag .x')).toHaveCount(0);
  });

  test('detail pane: Open is disabled for a text note (no Azure blob)', async ({ page }) => {
    await openNotes(page);
    await treeRow(page, 'cooking').click();
    await listRows(page).first().click();
    await expect(page.locator('.notes-detail-body')).toBeVisible();

    // A text note has no uploaded file (blob_url is null), so "Open" — which
    // launches the raw Azure blob — has nothing to open and renders disabled.
    // Download (a synthesized .md export) stays available.
    const open = page.locator('.notes-detail-body button', { hasText: 'Open' });
    await expect(open).toBeVisible();
    await expect(open).toBeDisabled();
    await expect(page.locator('.notes-detail-body a', { hasText: 'Download' })).toBeVisible();
  });

  test('list shows a pin glyph on a pinned note', async ({ page }) => {
    await openNotes(page);
    await treeRow(page, 'cooking').click();
    const row = listRows(page).filter({ hasText: 'Recipe — weeknight ramen' });
    await row.click();
    const detail = page.locator('.notes-detail-body');
    await expect(detail).toBeVisible();

    // The Pin/Unpin toggle is the only detail-pane action button containing
    // "Pin". Normalize to pinned (a prior run may have left it pinned).
    const pinToggle = detail.locator('button', { hasText: 'Pin' });
    if ((await pinToggle.innerText()).trim() === 'Pin') await pinToggle.click();
    await expect(pinToggle).toHaveText('Unpin');

    // The list row now carries the pin glyph; an unpinned sibling does not.
    await expect(row.locator('.prow-pin')).toBeVisible();
    await expect(
      listRows(page).filter({ hasText: 'Pour-over recipe — Hario V60' }).locator('.prow-pin'),
    ).toHaveCount(0);

    // Cleanup: unpin so the shared dev DB is left as we found it.
    await pinToggle.click();
    await expect(pinToggle).toHaveText('Pin');
    await expect(row.locator('.prow-pin')).toHaveCount(0);
  });

  test('pinned notes sort to the top — unpinning the recent one floats the other up', async ({ page }) => {
    await openNotes(page);
    await treeRow(page, 'cooking').click();
    const detail = page.locator('.notes-detail-body');
    const pinToggle = () => detail.locator('button', { hasText: 'Pin' });
    // Drive the detail-pane Pin/Unpin toggle to a desired state for a note.
    const set = async (title: string, want: 'pin' | 'unpin') => {
      await listRows(page).filter({ hasText: title }).click();
      await expect(detail).toBeVisible();
      const pinned = (await pinToggle().innerText()).trim() === 'Unpin';
      if ((want === 'pin') !== pinned) await pinToggle().click();
      await expect(pinToggle()).toHaveText(want === 'pin' ? 'Unpin' : 'Pin');
    };

    const A = 'Pour-over recipe — Hario V60';
    const B = 'Espresso recipe — Onyx Monarch';
    // Pin A, then B (B is now the most-recently pinned), then unpin B.
    await set(A, 'pin');
    await set(B, 'pin');
    await set(B, 'unpin');

    // Regression: the still-pinned A must sort ABOVE the just-unpinned B.
    // (Before the fix, B's fresh updated_at kept it on top.)
    const titles = await listRows(page).locator('.ti').allInnerTexts();
    const idxA = titles.findIndex((t) => t.includes(A));
    const idxB = titles.findIndex((t) => t.includes(B));
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
    await expect(listRows(page).filter({ hasText: A }).locator('.prow-pin')).toBeVisible();

    // Cleanup: leave the shared DB as we found it.
    await set(A, 'unpin');
  });

  test('Cmd/Ctrl+1 toggles the folder tree column', async ({ page }) => {
    await openNotes(page);
    await expect(page.locator('.notes-cols[data-tree="true"]')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+1');
    await expect(page.locator('.notes-cols[data-tree="false"]')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+1');
    await expect(page.locator('.notes-cols[data-tree="true"]')).toBeVisible();
  });

  // Regression: removing a folder segment down to a SINGLE top-level segment
  // (travel/japan → travel) used to drop the note out of the tree entirely,
  // because folders were slash-tags and a slash-less path read as a flat tag.
  // With a first-class `folder` field, a single segment is a real folder, so
  // the note must remain — filed directly under the parent. Mutates + restores
  // the seed so the shared DB is left untouched for other specs.
  test('removing a folder segment files the note under the parent folder', async ({ page }) => {
    await openNotes(page);
    await treeRow(page, 'travel').click();
    await treeRow(page, 'japan').click();
    await listRows(page).first().click();
    await expect(page.locator('.folder-field-chip')).toHaveText('travel/japan');

    // Move up a level: travel/japan → travel (a single-segment top-level folder).
    await page.locator('.folder-field-chip').click();
    await page.locator('.folder-field-input').fill('travel');
    await page.locator('.folder-field-input').press('Enter');

    // The note keeps a (single-segment) folder and shows under "travel" —
    // it does NOT vanish, and the chip is NOT replaced by "+ Folder".
    await expect(page.locator('.folder-field-chip')).toHaveText('travel');
    await expect(page.locator('.folder-field-add')).toHaveCount(0);
    await treeRow(page, 'travel').click();
    await expect(page.locator('.notes-list-rows')).toContainText('Travel — Tokyo bucket list');

    // Restore the seed: move it back to travel/japan.
    await page.locator('.folder-field-chip').click();
    await page.locator('.folder-field-input').fill('travel/japan');
    await page.locator('.folder-field-input').press('Enter');
    await expect(page.locator('.folder-field-chip')).toHaveText('travel/japan');
  });

  // The middle-column "New note" button opens the editor and files the note
  // into the folder currently selected in the tree — so it shows up in the
  // list you're looking at, not silently at root. The e2e:-prefixed title is
  // swept by the shared afterEach hook.
  test('New note button files a new note into the selected folder', async ({ page }) => {
    await openNotes(page);
    await treeRow(page, 'travel').click();
    await expect(treeRow(page, 'travel').locator('.ct')).toHaveText('4');

    const title = stamp();
    await page.locator('.notes-new-note').click();
    const titleInput = page.locator('.note-title-input');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(title);
    await page.locator('.modal').getByRole('button', { name: 'Save' }).click();

    // It lands under "travel": shows in the list and bumps the folder count 4→5.
    await expect(page.locator('.notes-list-rows')).toContainText(title);
    await expect(treeRow(page, 'travel').locator('.ct')).toHaveText('5');
  });

  // The reusable FolderPathField also lives inside the note editor modal, so a
  // note's folder can be set there (not just in the Notes view bottom bar).
  // Starting from "All notes" the new note is unfiled until set via the field.
  test('note editor modal sets the folder via the reusable FolderPathField', async ({ page }) => {
    await openNotes(page); // "All notes" selected by default → unfiled new note
    const title = stamp();
    await page.locator('.notes-new-note').click();
    await page.locator('.note-title-input').fill(title);

    // Same component as the Notes view — "+ Folder" → type a path → commit.
    await page.locator('.modal .folder-field-add').click();
    await page.locator('.modal .folder-field-input').fill('e2efolder/sub');
    await page.locator('.modal .folder-field-input').press('Enter');
    await expect(page.locator('.modal .folder-field-chip')).toHaveText('e2efolder/sub');

    await page.locator('.modal').getByRole('button', { name: 'Save' }).click();

    // The folder it created shows in the tree and the note is filed under it.
    await expect(treeRow(page, 'e2efolder')).toBeVisible();
    await treeRow(page, 'e2efolder').click();
    await expect(page.locator('.notes-list-rows')).toContainText(title);
  });
});
