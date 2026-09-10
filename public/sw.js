const CACHE_NAME = 'skuf-chat-v2';
const assets = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/icon.png',
  '/click.mp3',
  '/beer.mp3'
];

// Установка сервис-воркера и кэширование интерфейса
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
  self.skipWaiting(); // активируем новый SW сразу, не ждём закрытия вкладок
});

// Активация: удаляем старые кэши (skuf-chat-v1 и любые другие)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim(); // берём под контроль открытые вкладки
});

// Запуск приложения из кэша для максимальной скорости
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});