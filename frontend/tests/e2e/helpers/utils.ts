import type { Page, ConsoleMessage } from '@playwright/test';

/**
 * Attaches a console listener to the page and returns a getter for collected
 * non-info messages. Use to assert "no console errors during navigation".
 */
export function captureConsoleErrors(page: Page) {
  const messages: ConsoleMessage[] = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push(m);
  });
  page.on('pageerror', err => {
    messages.push({
      type: () => 'error',
      text: () => `pageerror: ${err.message}`,
    } as unknown as ConsoleMessage);
  });
  return {
    get errors() {
      return messages.filter(m => m.type() === 'error');
    },
    get warnings() {
      return messages.filter(m => m.type() === 'warning');
    },
    get all() {
      return messages;
    },
  };
}

/**
 * Set localStorage values BEFORE the app boots. Call after `goto` of `about:blank`,
 * or set via initScript in the page context.
 */
export async function seedLocalStorage(
  page: Page,
  baseURL: string,
  values: Record<string, string>,
) {
  await page.goto(baseURL);
  await page.evaluate(vals => {
    Object.entries(vals).forEach(([k, v]) => localStorage.setItem(k, v));
  }, values);
}

/**
 * Reload and wait for the app to mount. Returns once `.app` is visible.
 */
export async function reloadAndWait(page: Page) {
  await page.reload();
  await page.locator('.app').waitFor({ state: 'visible' });
}

/** Wait for the app shell. Individual tests wait for their own data; a new
 *  installation with no projects is a valid workspace, too. */
export async function waitForAppReady(page: Page) {
  await page.locator('.app').waitFor({ state: 'visible' });
  await page
    .locator('aside.sidebar, nav.mobile-tabbar')
    .first()
    .waitFor({ state: 'visible' });
}

/** True when the current viewport is below the mobile breakpoint used by the app (820). */
export function isMobileViewport(page: Page) {
  const v = page.viewportSize();
  return !!v && v.width < 820;
}
