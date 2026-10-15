import { liteRequest } from './api';

let activeCheck: Promise<void> | undefined;
function notificationsEnabled() {
  return localStorage.getItem('obl-notifications') === 'enabled' && 'Notification' in window && Notification.permission === 'granted';
}
export async function enableNotifications(): Promise<NotificationPermission> {
  if (!('Notification' in window) || !window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('Browser notifications need HTTPS or a loopback address and a browser that supports them.');
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    await navigator.serviceWorker.register('/sw.js');
    localStorage.setItem('obl-notifications', 'enabled');
    await checkNotifications();
  }
  return permission;
}
export function checkNotifications(): Promise<void> {
  if (!notificationsEnabled()) return Promise.resolve();
  // Timer and focus events can overlap while the request is in flight.
  activeCheck ??= deliverNotifications().finally(() => { activeCheck = undefined; });
  return activeCheck;
}
async function deliverNotifications() {
  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const { notifications } = await liteRequest<{ notifications: Array<{ id: string; title: string; body: string; project_id: string | null }> }>('/notifications');
  for (const notice of notifications) {
    if (!notificationsEnabled()) return;
    const key = `obl-notified:${notice.id}`;
    if (localStorage.getItem(key)) continue;
    await registration.showNotification(notice.title, { body: notice.body, tag: notice.id, data: { path: '/' } });
    localStorage.setItem(key, '1');
  }
}
export function startNotifications() {
  const check = () => { checkNotifications().catch(error => console.warn('Notification check failed', error)); };
  check();
  const timer = window.setInterval(check, 60_000); // Due dates are checked once per minute while the application is open.
  window.addEventListener('focus', check);
  return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
}
