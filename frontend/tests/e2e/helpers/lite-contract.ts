import { expect, test, type Page } from '@playwright/test';
import { api, createProject, createTodo } from './api';
import { setup, stamp } from './setup';
import { isMobileViewport, waitForAppReady } from './utils';

async function openProject(page: Page, name: string) {
  if (isMobileViewport(page)) {
    await page.locator('.mobile-tabbar .mtab', { hasText: 'Projects' }).click();
  } else {
    await page.locator('aside.sidebar .sb-item').filter({ has: page.locator('.label:text-is("Projects")') }).click();
  }
  await page.locator('.proj-card', { hasText: name }).click();
  await expect(page.locator('.proj-hero h1')).toHaveText(name);
}

async function openSettings(page: Page) {
  if (isMobileViewport(page)) {
    await page.locator('.mobile-tabbar .mtab', { hasText: 'More' }).click();
    await page.getByRole('button', { name: 'Account & preferences' }).click();
  } else {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await expect(page.locator('.modal-head h3')).toHaveText('Settings');
}

export function liteContract() {
  setup();
  test('project memory: session handoff and consolidation survive a fresh page', async ({ page }) => {
    // Real cold-model preparation measured 84s; consolidation plus indexing can
    // exceed the standard UI deadline. Use Playwright's slow-workload deadline.
    test.slow();
    const runtime = await api<{ provider: string }>('GET', '/api/v1/runtime');
    expect(['stub', 'ollama', 'llama.cpp']).toContain(runtime.provider);
    const name = `${stamp()} Durable project`;
    const project = await createProject(name, 'Project memory across separate AI sessions.');
    const session = {
      session_key: stamp(), summary: 'Implemented local document storage.',
      decisions: ['Preserve source files alongside searchable text.'],
      next_steps: ['Verify the documents after a restart.'],
    };
    await api('POST', `/api/v1/projects/${project.id}/sessions`, session);
    await page.reload();
    await waitForAppReady(page);
    await openProject(page, name);
    await page.getByRole('tab', { name: 'Memory', exact: true }).click();
    const panel = page.locator('.memory-panel');
    await expect(panel).toContainText(session.summary);
    await expect(panel).toContainText(session.decisions[0]);
    await expect(panel).toContainText(session.next_steps[0]);

    if (isMobileViewport(page)) {
      const title = await page.locator('.proj-hero h1').boundingBox();
      const header = await page.locator('.proj-hero').boundingBox();
      expect(Math.round(title!.width)).toBe(Math.round(header!.width));
    }

    const response = page.waitForResponse(r => r.url().endsWith(`/projects/${project.id}/consolidate`) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Consolidate memory', exact: true }).click();
    const completed = await response;
    expect(completed.ok()).toBe(true);
    const memory = await completed.json();
    expect(memory.summary).toBeTruthy();
    const renderedMemory = panel.getByRole('region', { name: 'Consolidated project memory' });
    await expect(renderedMemory).toHaveAttribute('data-memory-id', memory.id);
    expect((await renderedMemory.innerText()).trim()).not.toBe('');
    await expect(panel).toContainText(session.summary);

    await page.reload();
    await waitForAppReady(page);
    await openProject(page, name);
    await page.getByRole('tab', { name: 'Memory', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Consolidated project memory' })).toHaveAttribute('data-memory-id', memory.id);
    const restored = await api<{ memory: { id: string; summary: string } }>('GET', `/api/v1/projects/${project.id}/context`);
    expect(restored.memory).toMatchObject({ id: memory.id, summary: memory.summary });
    await expect(page.locator('.memory-panel')).toContainText(session.summary);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('notifications: opt-in delivers a due todo through the real service worker', async ({ page, context }) => {
    await context.grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
    await page.reload();
    await waitForAppReady(page);
    expect(await page.evaluate(() => Notification.permission)).toBe('granted');
    const body = `${stamp()} Due reminder`;
    await createTodo(body, null, { due_date: new Date().toISOString() });
    await openSettings(page);
    await page.getByRole('button', { name: 'Enable reminders', exact: true }).click();
    await expect(page.locator('.modal')).toContainText('Enabled for this browser.');
    await expect.poll(() => page.evaluate(async title => {
      const registration = await navigator.serviceWorker.ready;
      const notices = await registration.getNotifications();
      return notices.filter(notice => notice.body === title).map(notice => notice.title);
    }, body)).toEqual(['Todo due']);
    await page.getByRole('button', { name: 'Disable reminders', exact: true }).click();
    await expect(page.locator('.modal')).toContainText('Reminders disabled for this browser.');
    expect(await page.evaluate(() => localStorage.getItem('obl-notifications'))).toBeNull();
  });
}
