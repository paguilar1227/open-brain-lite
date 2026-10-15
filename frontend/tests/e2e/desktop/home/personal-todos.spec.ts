// Personal todos column on Home. These tests used to target the Inbox
// route; the route is gone now, so the same flows run against the
// Home Personal column. Capture creates a todo via the quick-add input,
// toggle flips status via the row checkbox.
import { expect, test } from '@playwright/test';
import { createTodo, deleteTodo, listTodos, updateTodo } from '../../helpers/api';
import { stamp } from '../../helpers/setup';
import { waitForAppReady } from '../../helpers/utils';

const TODOS_COL = '.home-personal-grid .pcol:has(h3:text-is("Todos"))';

test('home personal todos: capture via Enter creates a project-less todo and shows it in the column', async ({ page }) => {
  const content = stamp() + ' Inbox capture';
  const before = (await listTodos({ project_id: 'null' })).length;

  await page.locator(`${TODOS_COL} .pcol-add input`).fill(content);
  await page.locator(`${TODOS_COL} .pcol-add input`).press('Enter');

  await expect(page.locator(`${TODOS_COL} .prow .ti`, { hasText: content })).toBeVisible();
  const after = await listTodos({ project_id: 'null' });
  expect(after.length).toBe(before + 1);
});

test('home personal todos: toggling the row checkbox marks the todo done in the backend', async ({ page }) => {
  const content = stamp() + ' Toggle';
  await createTodo(content, null);
  // React Query staleTime keeps the cached list — reload to surface the
  // row we just created via REST.
  await page.reload();
  await waitForAppReady(page);

  const row = page.locator(`${TODOS_COL} .prow`, { hasText: content });
  await expect(row).toBeVisible();
  await row.locator('.checkbox').click();

  // The Home column doesn't render a status pill, so confirm via REST.
  await expect.poll(async () => {
    const todos = await listTodos({ project_id: 'null' });
    return todos.find((t) => t.content === content)?.status;
  }).toBe('done');
});

test('home personal todos: status is editable from the detail drawer', async ({ page }) => {
  const content = stamp() + ' Status edit';
  const created = await createTodo(content, null); // defaults to not_started
  try {
    await page.reload();
    await waitForAppReady(page);

    const row = page.locator(`${TODOS_COL} .prow`, { hasText: content });
    await expect(row).toBeVisible();
    await row.click();

    const drawer = page.locator('.drawer');
    await expect(drawer).toBeVisible({ timeout: 15000 });

    // The status chip group lets you change state beyond the row checkbox.
    const chip = (label: string) => drawer.locator('.filter-chip', { hasText: label });
    await expect(chip('Not started')).toHaveClass(/\bactive\b/);

    await chip('In progress').click();
    await expect(chip('In progress')).toHaveClass(/\bactive\b/);
    await expect(chip('Not started')).not.toHaveClass(/\bactive\b/);

    // Change persists to the backend.
    await expect.poll(async () => {
      const todos = await listTodos({ project_id: 'null' });
      return todos.find((t) => t.content === content)?.status;
    }).toBe('in_progress');
  } finally {
    await deleteTodo(created.id).catch(() => {});
  }
});

test('home personal todos: an in_progress / paused row shows a status pill', async ({ page }) => {
  const content = stamp() + ' Status pill';
  const created = await createTodo(content, null);
  try {
    await updateTodo(created.id, { status: 'in_progress' });
    await page.reload();
    await waitForAppReady(page);

    const row = () => page.locator(`${TODOS_COL} .prow`, { hasText: content });
    await expect(row()).toBeVisible();
    await expect(row().locator('.prow-status')).toHaveText('In progress');

    // not_started is the implicit default — no pill (the checkbox says it all).
    await updateTodo(created.id, { status: 'not_started' });
    await page.reload();
    await waitForAppReady(page);
    await expect(row()).toBeVisible();
    await expect(row().locator('.prow-status')).toHaveCount(0);
  } finally {
    await deleteTodo(created.id).catch(() => {});
  }
});

test('home personal todos: reopening a done parent cascades back to descendants', async ({ page }) => {
  // Symmetric to the cascade-done test. Build a parent + 2 children +
  // 1 grandchild, mark the whole subtree done via cascade, then untick
  // the parent — descendants should flip out of done.
  const parentContent = stamp() + ' Reopen parent';
  const c1 = stamp() + ' Reopen c1';
  const c2 = stamp() + ' Reopen c2';
  const gcContent = stamp() + ' Reopen gc';

  const parent = await createTodo(parentContent, null);
  const child1 = await createTodo(c1, null, { parent_id: parent.id });
  const child2 = await createTodo(c2, null, { parent_id: parent.id });
  const gc = await createTodo(gcContent, null, { parent_id: child1.id });

  // Cascade-done: completing the parent flips everyone done.
  await updateTodo(parent.id, { status: 'done' });
  await expect.poll(async () => {
    const todos = await listTodos({ project_id: 'null' });
    const byId = new Map(todos.map((t) => [t.id, t]));
    return [byId.get(parent.id)?.status, byId.get(child1.id)?.status,
            byId.get(child2.id)?.status, byId.get(gc.id)?.status];
  }).toEqual(['done', 'done', 'done', 'done']);

  // Now untick via the UI. Done todos sit at the bottom of the column,
  // so we use the drawer (full list) to reach the parent row reliably.
  await page.reload();
  await waitForAppReady(page);
  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible({ timeout: 15000 });
  const parentRow = drawer.locator('.prow', { hasText: parentContent });
  await expect(parentRow).toBeVisible();
  await parentRow.locator('.checkbox').first().click();

  // Cascade-undone: parent moves to not_started; descendants follow.
  await expect.poll(async () => {
    const todos = await listTodos({ project_id: 'null' });
    const byId = new Map(todos.map((t) => [t.id, t]));
    return {
      parent: byId.get(parent.id)?.status,
      child1: byId.get(child1.id)?.status,
      child2: byId.get(child2.id)?.status,
      grandchild: byId.get(gc.id)?.status,
    };
  }, { timeout: 10000 }).toEqual({
    parent: 'not_started',
    child1: 'not_started',
    child2: 'not_started',
    grandchild: 'not_started',
  });
});

test('home personal todos: completing a parent cascades to non-done descendants', async ({ page }) => {
  // Build a 3-level tree with a mix of statuses so we exercise both
  // the cascade (touches in_progress + not_started) and the skip
  // path (already-done child stays put — no redundant write).
  const parentContent = stamp() + ' Parent';
  const inProgressChild = stamp() + ' InProgress child';
  const doneChild = stamp() + ' Already-done child';
  const grandchild = stamp() + ' Grandchild';

  const parent = await createTodo(parentContent, null);
  const child1 = await createTodo(inProgressChild, null, { parent_id: parent.id });
  const child2 = await createTodo(doneChild, null, { parent_id: parent.id });
  const gc = await createTodo(grandchild, null, { parent_id: child1.id });

  // Set the in_progress + already-done states via REST so the seed is
  // deterministic regardless of default status.
  await updateTodo(child1.id, { status: 'in_progress' });
  await updateTodo(child2.id, { status: 'done' });

  await page.reload();
  await waitForAppReady(page);

  // Expand the parent so its checkbox is reachable in the column.
  const parentRow = page.locator(`${TODOS_COL} .prow`, { hasText: parentContent });
  await expect(parentRow).toBeVisible();
  await parentRow.locator('.prow-chev').click();

  // Tick the parent's checkbox.
  await parentRow.locator('.checkbox').first().click();

  // All non-done descendants should flip to done. Child2 was already
  // done — assert it stayed done (no spurious write would still be
  // 'done', but the bug we'd care about is regression to non-done).
  await expect.poll(async () => {
    const todos = await listTodos({ project_id: 'null' });
    const byId = new Map(todos.map((t) => [t.id, t]));
    return {
      parent: byId.get(parent.id)?.status,
      child1: byId.get(child1.id)?.status,
      child2: byId.get(child2.id)?.status,
      grandchild: byId.get(gc.id)?.status,
    };
  }, { timeout: 10000 }).toEqual({
    parent: 'done',
    child1: 'done',
    child2: 'done',
    grandchild: 'done',
  });
});
