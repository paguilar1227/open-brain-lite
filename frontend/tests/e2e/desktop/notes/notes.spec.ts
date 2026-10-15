// Notes are the user-authored markdown surface inside a project. The
// editor is CodeMirror 6 — a contenteditable, not a textarea — which
// drives the unusual selectors here (.cm-content, theme wrapper class).
import { expect, test } from '@playwright/test';
import { findProjectByName, listContent } from '../../helpers/api';
import { projectTo, stamp } from '../../helpers/setup';

test('note flow: create a new note in a project via the editor modal', async ({ page }) => {
  const project = await findProjectByName('ClaudePit');
  expect(project).toBeDefined();

  await projectTo(page, 'ClaudePit');
  await page.locator('[role="tab"]', { hasText: 'Notes' }).click();

  const title = stamp() + ' Note';
  await page.locator('button', { hasText: 'New note' }).first().click();
  await expect(page.locator('.modal-head h3', { hasText: 'New note' })).toBeVisible();

  await page.locator('.modal input.input').first().fill(title);
  // Body input is a CodeMirror 6 editor (contenteditable), not a plain
  // textarea — focus via click on .cm-content, then type. Selecting all
  // first wipes the seeded "# New note\n\nStart writing…" placeholder.
  const cm = page.locator('.modal .cm-content');
  await cm.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('# E2E body\n\nHello from a workflow test.');
  await page.locator('.modal-foot .btn-primary', { hasText: 'Save' }).click();

  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.note-card', { hasText: title })).toBeVisible();

  const items = await listContent({ project_id: project!.id, type: 'note' });
  expect(items.some((i) => i.title === title)).toBe(true);
});

test('note editor: cm-editor surface stays transparent (regression for the cm-theme-light white-bg bug)', async ({ page }) => {
  // The Bear-style markdown editor depends on @uiw/react-codemirror NOT
  // applying its built-in light theme — that theme paints .cm-editor
  // white, which makes our bright text look ghostly faded against it.
  // We pass `theme="none"` on the component; if a future refactor drops
  // that prop, this test fails before the regression ships.
  await projectTo(page, 'ClaudePit');
  await page.locator('[role="tab"]', { hasText: 'Notes' }).click();
  await page.locator('.note-card').first().click();
  await expect(page.locator('.modal .cm-editor')).toBeVisible();

  // 1) The active theme wrapper must NOT be cm-theme-light.
  const themeWrapper = page.locator('.modal').locator('[class^="cm-theme-"]').first();
  await expect(themeWrapper).toHaveClass(/cm-theme-none/);
  await expect(themeWrapper).not.toHaveClass(/cm-theme-light/);

  // 2) .cm-editor background must be transparent so the parent surface
  //    color is what shows through.
  const editorBg = await page
    .locator('.modal .cm-editor')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(editorBg).toMatch(/^rgba\(0, 0, 0, 0\)|^transparent$/);
});

test('note editor: tag input is hidden behind + Add and commits with Enter without leaving edit mode', async ({ page }) => {
  // Two-fix regression:
  //   1) Committed .tag pills must read as --fg brightness (oklch L≥0.9) so
  //      they don't blur into the muted input affordance next to them.
  //   2) The "add tag" input is hidden until the user clicks + Add. Enter
  //      commits + clears + stays focused (fast multi-add); empty Enter
  //      collapses back to the + Add button.
  await projectTo(page, 'ClaudePit');
  await page.locator('[role="tab"]', { hasText: 'Notes' }).click();
  await page.locator('button', { hasText: 'New note' }).first().click();
  await expect(page.locator('.modal-head h3', { hasText: 'New note' })).toBeVisible();

  // Initial state: no input pill, only the + Add button.
  await expect(page.locator('.modal .input-tag-wrap')).toHaveCount(0);
  const addBtn = page.locator('.modal button.btn-ghost.btn-sm', { hasText: 'Add' });
  await expect(addBtn).toBeVisible();

  // Click + Add → input pill appears and is autofocused.
  await addBtn.click();
  const inputPill = page.locator('.modal .input-tag-wrap');
  const tagInput = page.locator('.modal .input-tag');
  await expect(inputPill).toBeVisible();
  await expect(tagInput).toBeFocused();
  await expect(addBtn).toHaveCount(0);

  // Type + Enter commits the tag and keeps the input open + focused.
  const tagName = `e2e-${Date.now().toString(36)}`;
  await tagInput.fill(tagName);
  await tagInput.press('Enter');
  await expect(page.locator('.modal .tag', { hasText: tagName })).toBeVisible();
  await expect(tagInput).toHaveValue('');
  await expect(tagInput).toBeFocused();

  // Tag pill text reads as --fg brightness (oklch lightness ≥ 0.9). The
  // earlier --fg-muted color produced ~0.74 and made committed pills blur
  // into the muted placeholder.
  const lightness = await page.locator('.modal .tag', { hasText: tagName }).first().evaluate((el) => {
    const c = getComputedStyle(el).color;
    const m = c.match(/oklch\(([0-9.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
  expect(lightness).not.toBeNull();
  expect(lightness!).toBeGreaterThanOrEqual(0.9);

  // Empty Enter collapses back to the + Add button.
  await tagInput.press('Enter');
  await expect(page.locator('.modal .input-tag-wrap')).toHaveCount(0);
  await expect(page.locator('.modal button.btn-ghost.btn-sm', { hasText: 'Add' })).toBeVisible();
});
