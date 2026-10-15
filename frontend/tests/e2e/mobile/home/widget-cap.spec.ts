// Home dashboard columns are previews, not full lists — each caps at 6
// rendered rows with a "View N more" footer to the drawer.
//
// This used to be measurement-driven (useFitCount sized the preview to a
// viewport band), which misbehaved — notably on mobile where the band is
// absent: tall rows (notes) climbed until every item rendered, short rows
// (docs) collapsed to a min floor. ColumnWidget now caps at a flat
// MAX_ROWS=6 regardless of viewport. The seed has >6 personal notes and >6
// personal docs, so both exercise the cap.
import { expect, test } from '@playwright/test';
import { setup } from '../../helpers/setup';
setup();

const CAP = 6;

const col = (page: import('@playwright/test').Page, pcol: string) =>
  page.locator(`[data-pcol="${pcol}"]`);

test('home columns cap at 6 rows on mobile (notes climb / docs collapse both fixed)', async ({ page }) => {
  await page.goto('/?key=local-dev-key-not-secret');
  await expect(col(page, 'notes').locator('.prow-note').first()).toBeVisible();

  // Notes: 31 personal notes seeded; tall rows used to climb to all 31.
  // Capped, with the full count still on the header chip + the remainder
  // behind the footer.
  await expect(col(page, 'notes').locator('.prow-note')).toHaveCount(CAP);
  await expect(col(page, 'notes').locator('.pcol-more')).toContainText('more');

  // Documents: 9 personal docs seeded; short rows used to collapse to the
  // min floor (3). Capped/filled to CAP now.
  await expect(col(page, 'documents').locator('.prow-doc')).toHaveCount(CAP);
  await expect(col(page, 'documents').locator('.pcol-more')).toContainText('more');

  // The header count chip reflects the TRUE total, not the capped preview
  // — so the column reads "Notes 31" over CAP visible rows.
  const headerCount = Number(
    (await col(page, 'notes').locator('.pcol-h .ct').innerText()).trim(),
  );
  expect(headerCount).toBeGreaterThan(CAP);
});
