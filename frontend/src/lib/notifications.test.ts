import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ liteRequest: vi.fn() }));
import { liteRequest } from './api';
import { checkNotifications, enableNotifications } from './notifications';
const showNotification = vi.fn().mockResolvedValue(undefined);
const register = vi.fn().mockResolvedValue({ showNotification });
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register, ready: Promise.resolve({ showNotification }) } });
  vi.mocked(liteRequest).mockResolvedValue({ notifications: [{ id: 'todo:due', title: 'Todo due', body: 'Ship the project', project_id: null }] });
});
afterEach(() => vi.unstubAllGlobals());
describe('browser reminders', () => {
  it('does not ask permission or fetch reminders until the user opts in', async () => {
    await checkNotifications();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(liteRequest).not.toHaveBeenCalled();
  });
  it('delivers a due reminder once across repeated page checks', async () => {
    await enableNotifications();
    await checkNotifications();
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith('Todo due', expect.objectContaining({ body: 'Ship the project', tag: 'todo:due' }));
  });
  it('does not enable denied notifications', async () => {
    vi.mocked(Notification.requestPermission).mockResolvedValue('denied');
    await expect(enableNotifications()).resolves.toBe('denied');
    expect(localStorage.getItem('obl-notifications')).toBeNull();
    expect(showNotification).not.toHaveBeenCalled();
  });
  it('explains insecure browser origins', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(enableNotifications()).rejects.toThrow('HTTPS');
  });
  it('does not deliver an in-flight reminder after reminders are disabled', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(liteRequest).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    localStorage.setItem('obl-notifications', 'enabled');
    const checking = checkNotifications();
    await vi.waitFor(() => expect(liteRequest).toHaveBeenCalledTimes(1));
    localStorage.removeItem('obl-notifications');
    complete({ notifications: [{ id: 'pending', title: 'Todo due', body: 'Disabled reminder', project_id: null }] });
    await checking;
    expect(showNotification).not.toHaveBeenCalled();
  });
  it('delivers once when timer and focus checks overlap', async () => {
    localStorage.setItem('obl-notifications', 'enabled');
    await Promise.all([checkNotifications(), checkNotifications()]);
    expect(liteRequest).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledTimes(1);
  });
});
