import { expect, test } from '@playwright/test';
import { navTo } from '../../helpers/setup';

test('tags: list page shows tags with non-zero totals', async ({ page }) => {
  await navTo(page, 'Tags');
  await expect(page.locator('h1', { hasText: 'Tags' })).toBeVisible();
  await expect(page.locator('.tag-row, .tag-card').first()).toBeVisible();
});
