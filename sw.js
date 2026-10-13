const CACHE_NAME = 'family-planner-v8';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icons/leaf.svg', './icons/apple-touch-icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || 'У тебя есть напоминание' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Наш планер 🌿', {
    body: data.body || 'Пора заглянуть в планер',
    tag: data.tag || 'family-planner-reminder',
    icon: './icons/apple-touch-icon.svg',
    badge: './icons/leaf.svg',
    data: data.data || { url: './' },
    renotify: false
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});
