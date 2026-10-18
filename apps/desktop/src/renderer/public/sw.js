// Lonca on a phone: shows the pushes the PC sends (job approvals, join requests, messages) and opens the app on a tap.
self.addEventListener('push', (event) => {
  let data = { title: 'Lonca', body: '' };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    // a push without readable JSON still shows as Lonca
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Lonca', { body: data.body || '', tag: data.tag }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window' })
      .then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))),
  );
});
