self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = event.notification.data?.path || '/';
  event.waitUntil(clients.openWindow(new URL(path, self.location.origin).href));
});
