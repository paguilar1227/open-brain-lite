// Sidebar projects list: Pinned section, All Projects section, and the
// New project entry. The pinned/unpinned split is driven by the
// projects.pinned_at timestamp; these tests round-trip pin → unpin via
// REST and assert DOM order in the .sb-projects parent.
import { expect, test } from '@playwright/test';
import { createProject, listProjects, pinProject, unpinProject } from '../../helpers/api';
import { SIDEBAR, stamp } from '../../helpers/setup';
import { waitForAppReady } from '../../helpers/utils';

test('sidebar: pinning a project moves it into the Pinned section, unpinning removes it', async ({ page }) => {
  // Use a fresh e2e project so we don't disturb the seed's pinned set.
  const created = await createProject(stamp() + ' Pin Test');
  const pinnedRow = page.locator(`${SIDEBAR} .sb-projects .sb-item:has(.label:text-is("${created.name}"))`);

  // Created unpinned — should NOT be in the pinned slice (anything before
  // the "All Projects" section header).
  await page.reload();
  await waitForAppReady(page);
  const allProjectsHeader = page.locator(`${SIDEBAR} .sb-section`, { hasText: 'All Projects' });
  // Pin via REST and reload; the row must now precede the All Projects
  // section header in DOM order.
  await pinProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  await expect(pinnedRow).toBeVisible();
  // Order check: the pinned row's index is less than the All Projects
  // header's index in the .sb-projects parent.
  const pinIndex = await pinnedRow.evaluate((el) => {
    const parent = el.closest('.sb-projects')!;
    return Array.from(parent.children).indexOf(el);
  });
  const headerIndex = await allProjectsHeader.evaluate((el) => {
    const parent = el.closest('.sb-projects')!;
    return Array.from(parent.children).indexOf(el);
  });
  expect(pinIndex).toBeLessThan(headerIndex);

  // Unpin — row should now appear AFTER the All Projects header.
  await unpinProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  const newPinIndex = await pinnedRow.evaluate((el) => {
    const parent = el.closest('.sb-projects')!;
    return Array.from(parent.children).indexOf(el);
  });
  const newHeaderIndex = await allProjectsHeader.evaluate((el) => {
    const parent = el.closest('.sb-projects')!;
    return Array.from(parent.children).indexOf(el);
  });
  expect(newPinIndex).toBeGreaterThan(newHeaderIndex);
});

test('sidebar: every active project from the API renders in the sidebar list', async ({ page }) => {
  // The sidebar shows pinned + unpinned active projects. The set of names
  // visible there should equal the set of active project names from the
  // API. Order isn't asserted (pin status drives that and is covered above).
  const apiActive = (await listProjects()).filter((p) => p.status === 'active').map((p) => p.name).sort();
  const uiNames = await page
    .locator(`${SIDEBAR} .sb-projects .sb-item:not(.dim) .label`)
    .allInnerTexts();
  expect(uiNames.map((s) => s.trim()).sort()).toEqual(apiActive);
});

test('sidebar: clicking the New project row opens the modal', async ({ page }) => {
  // The New project entry sits in the sidebar's pinned/projects column
  // with class .sb-item.dim — clicking it routes to the projects index
  // with action: 'new', which immediately opens the modal.
  await page.locator(`${SIDEBAR} .sb-projects .sb-item.dim`, { hasText: 'New project' }).click();
  await expect(page.locator('.modal-head h3', { hasText: 'New project' })).toBeVisible();
  await page.locator('.modal-head button[aria-label="Close"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
});
