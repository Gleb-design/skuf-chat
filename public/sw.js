const CACHE_NAME = 'skuf-chat-v1';
const assets = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/icon.png'
];

// Установка сервис-воркера и кэширование интерфейса
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});

// Запуск приложения из кэша для максимальной скорости
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});
