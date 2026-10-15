// Recent activity widget filter — regression for the "filter change reloads
// the whole page" bug.
//
// The activity query is keyed by the selected kind filter, so changing the
// filter mints a new query key with no cached data. The page-level loading
// gate used to be `queries.some(q => q.isLoading)`, so that one re-keyed
// query flipped the ENTIRE dashboard to its "Loading…" screen mid-interaction
// — a full-page blank that read as a reload. The fix latches a `ready` flag
// after the first load so later refetches update widgets in place.
//
// This walks the real path (open Home → change the kind filter) and asserts
// the full-page loader never appears and the dashboard never unmounts.
import { expect, test } from '@playwright/test';
import { setup } from '../../helpers/setup';
setup();

test('home: changing the activity filter updates in place, no full-page reload', async ({ page }) => {
  // Dashboard fully loaded.
  await expect(page.locator('.stat-activity .activity-list-compact')).toBeVisible();
  const grid = page.locator('.home-personal-grid');
  await expect(grid).toBeVisible();

  // Flag if the full-page "Loading…" screen ever appears (grid removed +
  // the loading subtitle shown) — the exact signature of the regression.
  await page.evaluate(() => {
    (window as Window & typeof globalThis & { __sawLoadingScreen?: boolean }).__sawLoadingScreen = false;
    const obs = new MutationObserver(() => {
      const loading = Array.from(document.querySelectorAll('.page-subtle')).some(
        (e) => /^Loading/i.test((e.textContent || '').trim()),
      );
      if (loading && !document.querySelector('.home-personal-grid')) {
        (window as Window & typeof globalThis & { __sawLoadingScreen?: boolean }).__sawLoadingScreen = true;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    (window as Window & typeof globalThis & { __loadingObs?: MutationObserver }).__loadingObs = obs;
  });

  // Change the kind filter and wait for its refetch to land. The observer is
  // torn down + read in a finally so it's always disconnected even if an
  // assertion in the try throws.
  let sawLoadingScreen: boolean | undefined;
  try {
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/activity') && r.url().includes('kinds=ingest'),
      ),
      page.locator('.stat-activity select').selectOption('ingest'),
    ]);
    await expect(page.locator('.stat-activity select')).toHaveValue('ingest');
  } finally {
    sawLoadingScreen = await page.evaluate(() => {
      const w = window as Window & typeof globalThis & {
        __loadingObs?: MutationObserver;
        __sawLoadingScreen?: boolean;
      };
      w.__loadingObs?.disconnect();
      return w.__sawLoadingScreen;
    });
  }

  // The dashboard never dropped to the loading screen…
  expect(sawLoadingScreen).toBe(false);
  // …and the grid + activity card stayed mounted (the card renders either
  // the filtered list or an empty state — both keep .stat-activity present).
  await expect(grid).toBeVisible();
  await expect(page.locator('.stat-activity')).toBeVisible();
});
