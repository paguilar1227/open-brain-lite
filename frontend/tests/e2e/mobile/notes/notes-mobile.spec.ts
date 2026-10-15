// Notes view on mobile — a Bear-style drill-down. The desktop three-column
// layout collapses to one full-width panel at a time (folders → list → note)
// with a back arrow between them. Reached from the More sheet (Notes row).
//
// Pinned against the deterministic seed: travel(4); cooking → coffee(3).
import { expect, test, type Page } from '@playwright/test';
import { setup, MORE_SHEET, openMoreSheet } from '../../helpers/setup';
setup();

async function openNotesMobile(page: Page) {
  await openMoreSheet(page);
  await page.locator(`${MORE_SHEET} .m-sheet-row`, { hasText: 'Notes' }).click();
  await expect(page.locator('.notes-mobile')).toBeVisible();
}

const treeRow = (page: Page, name: string) =>
  page.locator('.notes-tree-row', { has: page.locator(`.lbl:text-is("${name}")`) });

test.describe('Notes mobile: drill-down navigation', () => {
  test('folders → list → note, then back arrows walk up the stack', async ({ page }) => {
    await openNotesMobile(page);

    // Folder view: one panel, the tree — NOT the desktop three-column grid.
    await expect(page.locator('.notes-mobile[data-view="folders"]')).toBeVisible();
    await expect(page.locator('.notes-cols')).toHaveCount(0);
    await expect(treeRow(page, 'travel')).toBeVisible();

    // Tap a folder → notes list, with a back-to-Folders arrow + folder title.
    await treeRow(page, 'travel').click();
    await expect(page.locator('.notes-mobile[data-view="list"]')).toBeVisible();
    await expect(page.locator('.notes-mobile-title')).toHaveText('travel');
    await expect(page.locator('.notes-list-rows .prow-note').first()).toBeVisible();

    // Tap a note → note view, with a back-to-Notes arrow + the note body.
    await page.locator('.notes-list-rows .prow-note').first().click();
    await expect(page.locator('.notes-mobile[data-view="note"]')).toBeVisible();
    await expect(page.locator('.notes-detail-body')).toBeVisible();

    // Back: note → list → folders.
    await page.locator('.notes-mobile-back').click();
    await expect(page.locator('.notes-mobile[data-view="list"]')).toBeVisible();
    await page.locator('.notes-mobile-back').click();
    await expect(page.locator('.notes-mobile[data-view="folders"]')).toBeVisible();
  });

  test('nested folders: chevron expands in place, tapping the label drills in', async ({ page }) => {
    await openNotesMobile(page);

    // The chevron toggles the subtree WITHOUT navigating away from folders.
    await treeRow(page, 'cooking').locator('.notes-tree-chev').click();
    await expect(page.locator('.notes-mobile[data-view="folders"]')).toBeVisible();
    await expect(treeRow(page, 'coffee')).toBeVisible();

    // Tapping the subfolder label drills into its filtered list.
    await treeRow(page, 'coffee').click();
    await expect(page.locator('.notes-mobile[data-view="list"]')).toBeVisible();
    await expect(page.locator('.notes-mobile-title')).toHaveText('cooking/coffee');
    await expect(page.locator('.notes-list-rows .prow-note')).toHaveCount(3);
  });
});
