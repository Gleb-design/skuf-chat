const CACHE_NAME = 'skuf-chat-v16';
const assets = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/icon.png',
  '/manifest.json',
  '/og-image.png',
  '/cat.svg',
  '/click.mp3',
  '/beer.mp3',
  '/ambient.mp3',
  '/game.css',
  '/game.js',
  '/shot.mp3',
  '/hit.mp3',
  '/miss.mp3',
  '/sunk.mp3',
  '/win.mp3',
  '/lose.mp3',
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
    // Игнорируем запросы, которые не подходят для кэша:
    //  - не GET (POST, PUT и т.п.)
    //  - чужой origin (внешние CDN, analytics и т.д.)
    //  - socket.io (WebSocket / polling — их нельзя кэшировать)
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/socket.io/')) return;

    e.respondWith(
        caches.match(e.request)
            .then((cachedResponse) => cachedResponse || fetch(e.request))
            .catch(() => {
                // Не смогли достать из сети — ничего не делаем,
                // браузер покажет свою ошибку. Это лучше, чем
                // спамить Uncaught TypeError в консоли.
                return new Response('', { status: 408, statusText: 'Offline' });
            })
    );
});