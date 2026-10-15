import { expect, test } from '@playwright/test';
import { findProjectByName } from '../../helpers/api';
import { setup, SIDEBAR, projectTo, stamp } from '../../helpers/setup';
setup();

test('project flow: create new project from modal, see it in sidebar', async ({ page }) => {
  const name = stamp() + ' Project';
  await page.locator('.proj-hero .btn-primary', { hasText: 'New project' }).click();
  await expect(page.locator('.modal-head h3')).toHaveText('New project');

  await page.locator('.modal input.input').first().fill(name);
  await page.locator('.modal-foot .btn-primary', { hasText: 'Create' }).click();

  await expect(page.locator(`${SIDEBAR} .sb-projects .sb-item .label`, { hasText: name })).toBeVisible();
  expect(await findProjectByName(name)).toBeDefined();
});

test('pin: toggling pin on a project header round-trips through the backend', async ({ page }) => {
  // Use Homelab — seeded as active but NOT pinned.
  await projectTo(page, 'Homelab');
  await expect(page.locator('.proj-hero h1', { hasText: 'Homelab' })).toBeVisible();

  const before = await findProjectByName('Homelab');
  expect(before?.pinned_at).toBeFalsy();

  // The button renders <Icons.Pin /> Pin so its accessible name is "Pin"
  // (whitespace-tolerant) — getByRole avoids regex anchor pitfalls.
  await page.locator('.proj-hero').getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('.proj-hero').getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
  const after = await findProjectByName('Homelab');
  expect(after?.pinned_at).toBeTruthy();

  // Restore.
  await page.locator('.proj-hero').getByRole('button', { name: 'Unpin', exact: true }).click();
  await expect(page.locator('.proj-hero').getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
});
