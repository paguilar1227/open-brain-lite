// Mobile More sheet — Pinned Projects section. The "Pinned" header has a
// counter (`.m-sheet-section .ct`) that mirrors the count of pinned active
// projects, and the section lists each one as a row. State changes via
// REST + reload (React Query staleTime would otherwise mask them).
import { expect, test } from '@playwright/test';
import { createProject, pinProject, unpinProject } from '../../helpers/api';
import { MORE_SHEET, openMoreSheet, stamp } from '../../helpers/setup';
import { waitForAppReady } from '../../helpers/utils';
import '../../helpers/setup';

const PIN_COUNTER = `${MORE_SHEET} .m-sheet-section:has-text("Pinned") .ct`;

test('mobile more: Pinned counter tracks pin and unpin', async ({ page }) => {
  await openMoreSheet(page);
  const before = parseInt((await page.locator(PIN_COUNTER).innerText()).trim(), 10);
  await page.locator('.m-sheet-overlay').click({ position: { x: 10, y: 10 } });

  const created = await createProject(stamp() + ' Pin Counter');
  await pinProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  await openMoreSheet(page);
  await expect.poll(async () => parseInt((await page.locator(PIN_COUNTER).innerText()).trim(), 10)).toBe(before + 1);
  await page.locator('.m-sheet-overlay').click({ position: { x: 10, y: 10 } });

  await unpinProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  await openMoreSheet(page);
  await expect.poll(async () => parseInt((await page.locator(PIN_COUNTER).innerText()).trim(), 10)).toBe(before);
});

test('mobile more: pinning shows a project in the Pinned section, unpinning removes it', async ({ page }) => {
  // Created unpinned — should NOT appear in the Pinned list rows.
  const created = await createProject(stamp() + ' Pin Visibility');
  const pinnedRow = page.locator(`${MORE_SHEET} .m-sheet-row`, { hasText: created.name });
  await openMoreSheet(page);
  await expect(pinnedRow).toHaveCount(0);
  await page.locator('.m-sheet-overlay').click({ position: { x: 10, y: 10 } });

  await pinProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  await openMoreSheet(page);
  await expect(pinnedRow).toBeVisible();
  await page.locator('.m-sheet-overlay').click({ position: { x: 10, y: 10 } });

  await unpinProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  await openMoreSheet(page);
  await expect(pinnedRow).toHaveCount(0);
});
