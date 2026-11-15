/*
 * Push handling for the staff app, imported into the generated service worker (vite.config.ts
 * passes this file to Workbox's `importScripts`).
 *
 * It lives outside the generated SW on purpose: the precache route is Workbox's business, and a
 * hand-written handler is easier to read than the generateSW incantation that would replace it.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = { title: 'Shiftora', body: 'You have an update.' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Same tag for the same subject: a newer rota replaces the tray entry instead of stacking.
      tag: payload.tag ?? 'shiftora',
      renotify: true,
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse a tab that is already open on this app rather than piling up new ones.
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
