// Project header "⋯" (More project actions) menu — Edit / Archive·Restore /
// Delete. The button used to be dead (no handler); this walks the whole menu
// on a throwaway project so it never touches the seed.
import { expect, test } from '@playwright/test';
import { createProject, findProjectByName } from '../../helpers/api';
import { projectTo, stamp } from '../../helpers/setup';

test('project ⋯ menu: edit, archive/restore, delete', async ({ page }) => {
  const name = stamp() + ' MenuTest';
  const created = await createProject(name, 'throwaway for the ⋯ menu spec');
  await page.reload(); // sidebar refetches and shows the new project
  await projectTo(page, name);
  await expect(page.locator('.proj-hero h1', { hasText: name })).toBeVisible();

  const hero = page.locator('.proj-hero');
  const more = hero.getByRole('button', { name: 'More project actions' });
  const menu = page.locator('.overflow-menu');

  // --- Menu opens with the three actions ---
  await more.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Edit project/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Archive/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Delete project/ })).toBeVisible();

  // --- Edit: modal pre-filled, rename persists to the backend ---
  await menu.getByRole('menuitem', { name: /Edit project/ }).click();
  await expect(page.locator('.modal-head h3')).toHaveText('Edit project');
  const nameInput = page.locator('.modal input.input').first();
  await expect(nameInput).toHaveValue(name); // pre-filled from the project
  const renamed = name + ' R';
  await nameInput.fill(renamed);
  await page.locator('.modal-foot .btn-primary', { hasText: 'Save' }).click();
  await expect(hero.locator('h1', { hasText: renamed })).toBeVisible();
  expect((await findProjectByName(renamed))?.id).toBe(created.id);

  // --- Archive → the header reflects it and the menu offers Restore ---
  await more.click();
  await menu.getByRole('menuitem', { name: /Archive/ }).click();
  await expect(hero.getByText(/Archived project/i)).toBeVisible();
  await more.click();
  await menu.getByRole('menuitem', { name: /Restore/ }).click();
  await expect(hero.getByText(/Active project/i)).toBeVisible();

  // --- Delete: confirm gated on typing the name, then the project is gone ---
  await more.click();
  await menu.getByRole('menuitem', { name: /Delete project/ }).click();
  const del = page.locator('.modal-foot .btn-danger', { hasText: 'Delete forever' });
  await expect(del).toBeDisabled(); // requireType gate
  await page.locator('.modal input.input').first().fill(renamed);
  await expect(del).toBeEnabled();
  await del.click();

  // Navigated away (project page gone) and the project no longer exists.
  await expect(hero.locator('h1', { hasText: renamed })).toHaveCount(0);
  await expect.poll(async () => await findProjectByName(renamed)).toBeUndefined();
});
