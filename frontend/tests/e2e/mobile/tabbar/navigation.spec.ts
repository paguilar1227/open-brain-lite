// Mobile bottom-tabbar — primary nav. After the Inbox merge, the tabbar
// has two route entries (Home, Projects) plus More. This test walks both
// route entries, assertingt the hero h1 each time.
import { expect, test } from '@playwright/test';
import { TABBAR } from '../../helpers/setup';
import '../../helpers/setup';

test('mobile tabbar: Home and Projects each route to their own page', async ({ page }) => {
  const tab = (label: string) => page.locator(`${TABBAR} .mtab`, { hasText: label });
  const hero = (text: RegExp | string) => page.locator('main h1', { hasText: text });

  await expect(hero(/Welcome back/)).toBeVisible();

  await tab('Projects').click();
  await expect(hero(/^Projects$/)).toBeVisible();

  await tab('Home').click();
  await expect(hero(/Welcome back/)).toBeVisible();
});
