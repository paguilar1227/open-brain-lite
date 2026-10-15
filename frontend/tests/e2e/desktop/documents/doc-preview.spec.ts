// Doc reader drawer renders an inline preview for each kind of document
// source — PDF embed, image with click-to-enlarge, audio player. The text
// extracted by the ingest pipeline is still rendered below as a separate
// "Extracted text" panel; this spec asserts the source-media surface, not
// the extracted text. Backend SAS-signing is verified implicitly: if the
// blob URL weren't signed, Azurite would 403 and the <img> would never
// hit naturalWidth > 0.
//
// Action row contracts the drawer exposes (verified here so regressions
// surface immediately):
//   - Download chip → href is a SAS-signed URL with the `rscd=` SAS param
//     (Content-Disposition: attachment override). The HTML `download`
//     attribute alone is ignored cross-origin, so the rscd param is what
//     actually makes the browser save the file. Asserted as a substring.
//   - Open chip → target=_blank, points at the read-only blob_url.
//   - Project chip in the metadata grid → resolves to the project's human
//     name, not the truncated UUID; clicking it closes the drawer and
//     navigates to the project view.
//   - PDF preview → an Expand chip opens a fullscreen lightbox.
import { expect, test } from '@playwright/test';
import { setup, navTo } from '../../helpers/setup';
setup();

async function openDocFromActivity(page: import('@playwright/test').Page, title: string) {
  await navTo(page, 'Activity');
  const row = page
    .locator('.activity-row')
    .filter({ hasText: `Ingested ${title}` })
    .first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const drawer = page.locator('[role="dialog"]');
  await expect(drawer).toBeVisible({ timeout: 15000 });
  return drawer;
}

// Walks recent Ingested activity rows, opens each one, and returns the
// drawer for the first match on `mime`. Originally filtered by an
// "Ingested (no text content)" placeholder, but stub-OCR fixtures now
// give image/audio docs real extracted titles, so the placeholder no
// longer appears. The mime check inside the drawer is the authoritative
// signal — title text can be anything the OCR fixture supplies.
async function openDocByMime(page: import('@playwright/test').Page, mime: string) {
  await navTo(page, 'Activity');
  await expect(page.locator('h1', { hasText: 'Activity' })).toBeVisible();
  await expect(page.locator('.activity-row').first()).toBeVisible({ timeout: 15000 });
  const rows = page.locator('.activity-row').filter({ hasText: /^Ingested / });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  const drawer = page.locator('[role="dialog"]');
  for (let i = 0; i < count; i++) {
    await rows.nth(i).scrollIntoViewIfNeeded();
    await rows.nth(i).click();
    await expect(drawer).toBeVisible({ timeout: 15000 });
    const mimeEl = drawer.locator('.doc-mime');
    if (await mimeEl.count() > 0) {
      const actual = (await mimeEl.innerText()).trim();
      if (actual === mime) return drawer;
    }
    // Target the drawer-header X specifically — some drawers (e.g.
    // TodoDetailDrawer when an ingested-note row gets surfaced) also
    // have a "Close" button in their footer, which would make a
    // role-based lookup ambiguous.
    await drawer.locator('.drawer-head button[aria-label="Close"]').click();
    await expect(drawer).toHaveCount(0);
  }
  throw new Error(`No ingested doc found with mime ${mime}`);
}

test('doc preview: PDF doc renders an inline embed, Download (rscd), Open, and Expand-to-lightbox', async ({ page }) => {
  const drawer = await openDocFromActivity(page, 'Sample document for E2E tests');

  await expect(drawer.locator('.doc-mime')).toHaveText('application/pdf');

  const panel = drawer.locator('.doc-preview-pdf');
  await expect(panel).toBeVisible();
  // Headless Chromium can't render PDFs (no PDF plugin), so the <object>
  // falls back to its embedded children and the panel collapses to a
  // few pixels regardless of CSS aspect-ratio. We assert structure (the
  // <object> exists with the right data attr) instead of height — the
  // actual visual render is a browser-engine concern.
  const objectEl = panel.locator('object');
  await expect(objectEl).toHaveCount(1);
  await expect(objectEl).toHaveAttribute('type', 'application/pdf');

  // Download chip — href must be the SAS-signed download URL with rscd=,
  // because the HTML `download` attribute is ignored cross-origin and the
  // server-side Content-Disposition override is what makes the browser save.
  const downloadChip = drawer.getByRole('link', { name: /^Download$/ });
  await expect(downloadChip).toBeVisible();
  const downloadHref = await downloadChip.getAttribute('href');
  expect(downloadHref, 'Download chip should point at a SAS-signed URL').toBeTruthy();
  expect(downloadHref!).toContain('sig=');
  expect(downloadHref!).toContain('rscd=');

  // Open chip — opens the same blob in a new tab. The chip is the *outer*
  // Open in the action row (not the fallback "Open PDF" inside the embed),
  // so we narrow by checking target=_blank exists.
  const openChip = drawer.getByRole('link', { name: /^Open$/ });
  await expect(openChip).toBeVisible();
  await expect(openChip).toHaveAttribute('target', '_blank');
  const openHref = await openChip.getAttribute('href');
  expect(openHref!).toContain('sig=');
  expect(openHref!).not.toContain('rscd=');

  // Project chip — must show the resolved project name ("RAG Research"
  // from seed), not the UUID prefix. Asserts the new useQuery(['projects'])
  // wire-up actually fires and resolves before the user reads the drawer.
  // Checked here before the lightbox interaction because (a) it doesn't
  // depend on lightbox state and (b) the Esc inside the lightbox test must
  // not bubble to the drawer's Esc-to-close handler — verifying ordering
  // here means a regression in the propagation guard surfaces below as a
  // failed lightbox assertion rather than as a vanished drawer.
  const projectChip = drawer.locator('.meta-projects .tag-link').first();
  await expect(projectChip).toBeVisible();
  await expect(projectChip).toHaveText('RAG Research');

  // Expand → PDF lightbox opens, Esc closes the lightbox only (drawer
  // stays open — the capture-phase Esc handler in the drawer prevents
  // bubble to the drawer-level Esc-to-close).
  const expandBtn = panel.getByRole('button', { name: /Expand PDF preview/ });
  await expect(expandBtn).toBeVisible();
  await expandBtn.click();
  const lightbox = page.locator('.doc-preview-lightbox-pdf');
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator('object')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(drawer).toBeVisible();
});

test('doc preview: image doc renders an inline image with click-to-enlarge', async ({ page }) => {
  const drawer = await openDocByMime(page, 'image/png');

  const trigger = drawer.locator('.doc-preview-image');
  await expect(trigger).toBeVisible();

  const img = trigger.locator('img');
  await expect.poll(
    async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth),
    { timeout: 5000 },
  ).toBeGreaterThan(0);

  await trigger.click();
  const lightbox = page.locator('.doc-preview-lightbox');
  await expect(lightbox).toBeVisible();
  // Esc closes the image lightbox too (parallel keyboard handler to PDF).
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
});

test('doc preview: audio doc renders a native player', async ({ page }) => {
  const drawer = await openDocByMime(page, 'audio/wav');

  const audio = drawer.locator('.doc-preview-audio audio');
  await expect(audio).toHaveCount(1);
  await expect.poll(
    async () => audio.evaluate((el: HTMLAudioElement) => el.duration),
    { timeout: 5000 },
  ).toBeGreaterThan(0);
});

test('doc preview: clicking the project chip navigates to that project view', async ({ page }) => {
  const drawer = await openDocFromActivity(page, 'Sample document for E2E tests');
  const projectChip = drawer.locator('.meta-projects .tag-link').first();
  await expect(projectChip).toHaveText('RAG Research');
  await projectChip.click();
  // Drawer should close and the page should land on the project view.
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('h1', { hasText: 'RAG Research' })).toBeVisible({ timeout: 5000 });
});
