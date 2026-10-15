// Subtasks management from the TodoDetailDrawer:
//   - Quick-add: typing a subtask + Enter creates it under the open
//     todo and surfaces in the drawer's Subtasks list.
//   - Toggle: ticking a subtask checkbox marks it done in the backend
//     and renders the row struck through.
//   - Navigate: clicking a subtask row navigates to its detail (the
//     drawer reopens with the child todo). Verifies the parent → ...
//     → subtask handoff works without nesting drawers.
//
// We seed the parent + an existing subtask via REST so the test only
// needs to drive the UI for the actual flows (add / toggle / click).

import { expect, test } from '@playwright/test';
import { createTodo, listTodos } from '../../helpers/api';
import { stamp } from '../../helpers/setup';
import { waitForAppReady } from '../../helpers/utils';

const TODOS_COL = '.home-personal-grid .pcol:has(h3:text-is("Todos"))';

test('todo detail: add a subtask via the drawer', async ({ page }) => {
  const parentContent = stamp() + ' Parent for add';
  const parent = await createTodo(parentContent, null);
  await page.reload();
  await waitForAppReady(page);

  // Open detail via the drawer (works regardless of column slice).
  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const listDrawer = page.locator('.drawer');
  await expect(listDrawer).toBeVisible({ timeout: 15000 });
  await listDrawer.locator('.prow', { hasText: parentContent }).click();
  // List drawer closes; detail drawer opens with the parent.
  const detail = page.locator('.drawer');
  await expect(detail.locator('.drawer-head .ti', { hasText: parentContent })).toBeVisible();
  await expect(detail.locator('.field-label', { hasText: /Subtasks · 0/ })).toBeVisible();

  // Add a subtask via the inline input.
  const subContent = stamp() + ' Added subtask';
  const subInput = detail.getByPlaceholder('Add a subtask…');
  await subInput.fill(subContent);
  await subInput.press('Enter');

  // Subtask row appears + counter increments. The label is followed by
  // a count (`Subtasks · 1`) and the row itself shows the content.
  await expect(detail.locator('.field-label', { hasText: /Subtasks · 1/ })).toBeVisible();
  await expect(detail.locator('.todo-subtask-row', { hasText: subContent })).toBeVisible();

  // Backend reflects the parent_id link.
  const todos = await listTodos();
  const created = todos.find((t) => t.content === subContent);
  expect(created?.parent_id).toBe(parent.id);
});

test('todo detail: toggle a subtask done via its checkbox', async ({ page }) => {
  const parentContent = stamp() + ' Parent for toggle';
  const subContent = stamp() + ' Toggle me';
  const parent = await createTodo(parentContent, null);
  await createTodo(subContent, null, { parent_id: parent.id });
  await page.reload();
  await waitForAppReady(page);

  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const listDrawer = page.locator('.drawer');
  await expect(listDrawer).toBeVisible({ timeout: 15000 });
  await listDrawer.locator('.prow', { hasText: parentContent }).click();

  const detail = page.locator('.drawer');
  const subRow = detail.locator('.todo-subtask-row', { hasText: subContent });
  await expect(subRow).toBeVisible();

  // Tick the subtask's checkbox.
  await subRow.locator('.checkbox').click();

  // UI reflects strikethrough; backend reflects done. Use a poll
  // because the mutation + invalidate has an async window.
  await expect(subRow).toHaveClass(/\bdone\b/);
  await expect.poll(async () => {
    const todos = await listTodos();
    return todos.find((t) => t.content === subContent)?.status;
  }).toBe('done');
});

test('todo detail: subtask input is gated at the depth cap (max 4 levels)', async ({ page }) => {
  // Build a 4-level chain: root → child → grand → great-grand. Drilling
  // into the great-grandchild's detail should hide the "Add subtask"
  // input and show a notice instead. Pushing past the cap via REST also
  // fails. The cap is 4 total including the root (MAX_TODO_DEPTH=3).
  const rootContent = stamp() + ' Root';
  const childContent = stamp() + ' Child';
  const grandContent = stamp() + ' Grand';
  const greatContent = stamp() + ' Great';
  const root = await createTodo(rootContent, null);
  const child = await createTodo(childContent, null, { parent_id: root.id });
  const grand = await createTodo(grandContent, null, { parent_id: child.id });
  const great = await createTodo(greatContent, null, { parent_id: grand.id });

  await page.reload();
  await waitForAppReady(page);

  // Open the great-grandchild detail directly via the parent chain.
  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const listDrawer = page.locator('.drawer');
  await expect(listDrawer).toBeVisible({ timeout: 15000 });
  // Open root → click child → click grand → click great.
  await listDrawer.locator('.prow', { hasText: rootContent }).click();
  const detail = page.locator('.drawer');
  await detail.locator('.todo-subtask-row', { hasText: childContent }).click();
  await expect(detail.locator('.drawer-head .ti', { hasText: childContent })).toBeVisible({ timeout: 5000 });
  await detail.locator('.todo-subtask-row', { hasText: grandContent }).click();
  await expect(detail.locator('.drawer-head .ti', { hasText: grandContent })).toBeVisible({ timeout: 5000 });
  await detail.locator('.todo-subtask-row', { hasText: greatContent }).click();
  await expect(detail.locator('.drawer-head .ti', { hasText: greatContent })).toBeVisible({ timeout: 5000 });

  // Subtask input is gone; the cap notice replaces it.
  await expect(detail.getByPlaceholder('Add a subtask…')).toHaveCount(0);
  await expect(detail.locator('.todo-subtask-cap-notice')).toContainText(/Max nesting reached/);

  // Direct REST attempt to push past the cap also fails. Use the
  // helper's createTodo wrapper and assert it throws ApiError(400).
  await expect(
    createTodo('too-deep', null, { parent_id: great.id }),
  ).rejects.toThrow(/Subtask nesting too deep/);
});

test('todo detail: clicking the parent meta link navigates UP to the parent', async ({ page }) => {
  // Open a subtask's detail directly, then click its `parent` chip
  // and verify the drawer flips to the parent's detail. Closes the
  // navigation loop with the existing subtask-click test below.
  const parentContent = stamp() + ' Parent up-nav';
  const subContent = stamp() + ' Sub up-nav';
  const parent = await createTodo(parentContent, null);
  await createTodo(subContent, null, { parent_id: parent.id });
  await page.reload();
  await waitForAppReady(page);

  // Open the drawer + drill to subtask via parent → subtask click.
  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const listDrawer = page.locator('.drawer');
  await expect(listDrawer).toBeVisible({ timeout: 15000 });
  await listDrawer.locator('.prow', { hasText: parentContent }).click();
  const detail = page.locator('.drawer');
  await expect(detail.locator('.drawer-head .ti', { hasText: parentContent })).toBeVisible();
  await detail.locator('.todo-subtask-row', { hasText: subContent }).click();
  await expect(detail.locator('.drawer-head .ti', { hasText: subContent })).toBeVisible({ timeout: 5000 });

  // Click the parent meta link — the drawer should flip back UP.
  await detail.locator('.entity-link-button', { hasText: parentContent }).click();
  await expect(detail.locator('.drawer-head .ti', { hasText: parentContent })).toBeVisible({ timeout: 5000 });
});

test('todo detail: clicking a subtask navigates to its detail drawer', async ({ page }) => {
  const parentContent = stamp() + ' Parent for nav';
  const subContent = stamp() + ' Sub for nav';
  const parent = await createTodo(parentContent, null);
  await createTodo(subContent, null, { parent_id: parent.id });
  await page.reload();
  await waitForAppReady(page);

  await page.locator(`${TODOS_COL} .pcol-more`).click();
  const listDrawer = page.locator('.drawer');
  await expect(listDrawer).toBeVisible({ timeout: 15000 });
  await listDrawer.locator('.prow', { hasText: parentContent }).click();

  const detail = page.locator('.drawer');
  await expect(detail.locator('.drawer-head .ti', { hasText: parentContent })).toBeVisible();

  // Click the subtask row to navigate.
  await detail.locator('.todo-subtask-row', { hasText: subContent }).click();

  // The drawer's title flips to the subtask. Parent meta now shows
  // a link back to the original parent.
  const subDetail = page.locator('.drawer');
  await expect(subDetail.locator('.drawer-head .ti', { hasText: subContent })).toBeVisible({ timeout: 5000 });
  await expect(subDetail.locator('.meta-grid', { hasText: 'parent' })).toContainText(parentContent);
});
