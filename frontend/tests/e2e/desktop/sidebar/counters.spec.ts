// Sidebar live counters: "Home" (project-less todo count, was the Inbox
// counter pre-merge) and "Projects" display counts read from React Query
// caches. Each test creates an entity via REST, reloads to defeat the 30s
// staleTime, and asserts the displayed delta — then deletes and confirms
// the counter restores. Delta-based so we don't hard-code seed counts.
import { expect, test } from '@playwright/test';
import { createProject, createTodo, deleteProject, deleteTodo } from '../../helpers/api';
import { SIDEBAR, stamp } from '../../helpers/setup';
import { waitForAppReady } from '../../helpers/utils';

const SB_ITEM = (label: string) =>
  `${SIDEBAR} .sb-item:has(.label:text-is("${label}"))`;

test('sidebar: Projects counter tracks creates and deletes', async ({ page }) => {
  const counter = page.locator(`${SB_ITEM('Projects')} .count`);
  const before = parseInt((await counter.innerText()).trim(), 10);

  const created = await createProject(stamp() + ' Counter Project');
  await page.reload();
  await waitForAppReady(page);
  await expect.poll(async () => parseInt((await counter.innerText()).trim(), 10)).toBe(before + 1);

  await deleteProject(created.id);
  await page.reload();
  await waitForAppReady(page);
  await expect.poll(async () => parseInt((await counter.innerText()).trim(), 10)).toBe(before);
});

test('sidebar: Home counter tracks general (project-less) todo creates and deletes', async ({ page }) => {
  // The personal-todo count moved from the Inbox row to the Home row when
  // Inbox was merged into Home. Same source data (project_id IS NULL),
  // same React Query key, just a different sb-item.
  const counter = page.locator(`${SB_ITEM('Home')} .count`);
  const before = parseInt((await counter.innerText()).trim(), 10);

  const created = await createTodo(stamp() + ' Home Counter', null);
  await page.reload();
  await waitForAppReady(page);
  await expect.poll(async () => parseInt((await counter.innerText()).trim(), 10)).toBe(before + 1);

  await deleteTodo(created.id);
  await page.reload();
  await waitForAppReady(page);
  await expect.poll(async () => parseInt((await counter.innerText()).trim(), 10)).toBe(before);
});
