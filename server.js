require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));


// --- БАЗА ИСТИННО СКУФСКИХ КЛИЧЕК И АВАТАРОК ---
const skufNames = [
    'Михалыч', 'Петрович', 'Иваныч', 'Саня', 'Толян', 'Серёга', 'Лёха', 'Юрич', 'Валера', 'Димон', 
    'Кабан', 'Седой', 'Шмель', 'Косой', 'Борзый', 'Ворчун', 'Лысый', 'Батя', 'Дюша', 'Шуруп', 
    'Череп', 'Трактор', 'Сиплый', 'Шашлык', 'Полторашка', 'Глушак', 'Кардан', 'Кирпич', 'Майонез', 
    'Котлета', 'Вентилятор', 'Чекушка'
];

const skufStatus = [
    'с завода', 'из гаража', 'на расслабоне', 'Танкист', 'Рыбак', 'с пивком', 'Дальнобой', 'Эксперт', 
    'у телевизора', 'из 3-го подъезда', 'со службы', 'с подработки', 'из шиномонтажки', 'отжавший дрель', 
    'потерявший пульт', 'купивший незамерзайку', 'ищущий заначку', 'эксперт по диванам', 'ветеран дачи', 
    'гроза карасей', 'на больничном', 'после бани', 'смотрящий футбол', 'забывший пароль', 'сварщик 5 разряда', 
    'главный по шашлыкам', 'в шлёпанцах'
];

const skufEmojis = [
    '🍺', '🛋️', '🚜', '🎣', '🍢', '🎮', '🧢', '🥟', '🔧', '📺', '🍖', '🥚', '🥫', '🧦', '🛠️', '🚗', '📻', '📦'
];

// --- СТОП-ЛИСТ РЕКЛАМЫ (мат НЕ фильтруем — это часть атмосферы) ---
const BAN_PATTERNS = [
    /t\.me\//i,
    /telegram\.me\//i,
    /\bказино\b/i,
    /\bставки\b/i,
    /\bбукмекер/i,
    /\bзаработ(ок|ать|ай)\b/i,
    /\bкрипт(а|у|ы|ой|овалют)/i,
    /\bbitcoin\b/i,
    /\bбеттинг\b/i,
    /1xbet/i,
    /mostbet/i,
    /\bинвест(ируй|иции)\b/i,
    /\bпассивный доход\b/i,
];

function containsAds(text) {
    return BAN_PATTERNS.some((re) => re.test(text));
}

// --- ВАЛИДАЦИЯ КАСТОМНОГО НИКА ---
const NICK_MIN_LEN = 2;
const NICK_MAX_LEN = 20;
// Разрешаем буквы (рус/лат), цифры, пробел, дефис, подчёркивание
const NICK_ALLOWED = /^[A-Za-zА-Яа-яЁё0-9 _-]+$/;

function validateNick(rawNick) {
    if (typeof rawNick !== 'string') return { ok: false, reason: 'bad_type' };
    const nick = rawNick.trim();
    if (nick.length < NICK_MIN_LEN) return { ok: false, reason: 'too_short' };
    if (nick.length > NICK_MAX_LEN) return { ok: false, reason: 'too_long' };
    if (!NICK_ALLOWED.test(nick)) return { ok: false, reason: 'bad_chars' };
    if (containsAds(nick)) return { ok: false, reason: 'ads' };
    return { ok: true, nick };
}

// --- АНТИФЛУД ПОВТОРОВ: 3 одинаковых сообщения за 30 секунд ---
const REPEAT_WINDOW_MS = 30 * 1000;
const REPEAT_MAX = 3;

function isRepeated(socket, text) {
    const now = Date.now();
    if (!socket.recentMessages) socket.recentMessages = [];
    // чистим старые
    socket.recentMessages = socket.recentMessages.filter(
        (m) => (now - m.timestamp) < REPEAT_WINDOW_MS
    );
    // считаем сколько раз это же самое уже было
    const sameCount = socket.recentMessages.filter((m) => m.text === text).length;
    if (sameCount >= REPEAT_MAX) return true;
    // записываем
    socket.recentMessages.push({ text, timestamp: now });
    return false;
}

let waitingSkuf = null;


// --- СЧЁТЧИК ОНЛАЙН ---
let onlineCount = 0;

// Рассылает всем актуальное число скуфов онлайн
function broadcastOnlineCount() {
    io.emit('online_count', onlineCount);
}


// --- RATE LIMIT (защита от спама) ---
const RATE_LIMIT_MAX = 5;            // максимум сообщений
const RATE_LIMIT_WINDOW_MS = 3000;   // за это окно (в миллисекундах)

// Проверяет, не превышен ли лимит. Возвращает true, если сообщение НАДО ОТКЛОНИТЬ.
function isRateLimited(socket) {
    const now = Date.now();
    // Инициализируем массив, если его ещё нет
    if (!socket.messageTimestamps) socket.messageTimestamps = [];
    // Выкидываем из массива всё, что старше окна
    socket.messageTimestamps = socket.messageTimestamps.filter(
        (t) => (now - t) < RATE_LIMIT_WINDOW_MS
    );
    // Если уже набралось максимум — блокируем
    if (socket.messageTimestamps.length >= RATE_LIMIT_MAX) {
        return true;
    }
    // Иначе запоминаем текущее сообщение и пропускаем
    socket.messageTimestamps.push(now);
    return false;
}

// --- ХРАНИЛИЩЕ ИСТОРИИ ФЛУДИЛКИ: Redis + fallback в RAM ---
// Ключ, под которым в Redis лежит история (Sorted Set: score=timestamp, value=JSON)
const REDIS_HISTORY_KEY = 'skuf:history';

// Ключ-префикс для хранения кастомных ников.
// Итоговый ключ: skuf:nick:<sessionKey>
const REDIS_NICK_PREFIX = 'skuf:nick:';

// Читает сохранённый ник по sessionKey. Возвращает строку или null.
async function getSavedNick(sessionKey) {
    if (!redisEnabled || !redis || !sessionKey) return null;
    try {
        if (!useRedis && redis) {
            await redis.ping();
            useRedis = true;
        }
        const value = await redis.get(REDIS_NICK_PREFIX + sessionKey);
        return value || null;
    } catch (err) {
        console.warn('⚠️ Ошибка чтения ника из Redis:', err.message);
        return null;
    }
}

// Сохраняет ник по sessionKey. Возвращает true/false.
async function saveNick(sessionKey, nick) {
    if (!redisEnabled || !redis || !sessionKey) return false;
    try {
        if (!useRedis && redis) {
            await redis.ping();
            useRedis = true;
        }
        await redis.set(REDIS_NICK_PREFIX + sessionKey, nick);
        return true;
    } catch (err) {
        console.warn('⚠️ Ошибка сохранения ника в Redis:', err.message);
        return false;
    }
}

// Флаги:
// - redisEnabled: мы вообще пытаемся использовать Redis (REDIS_URL задан)?
// - useRedis:     Redis подключён и готов принимать команды?
let redis = null;
let redisEnabled = !!process.env.REDIS_URL;
let useRedis = false;

// Подключаемся к Redis, если задана переменная окружения REDIS_URL
if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);

    const redisOptions = {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        // TLS нужен ТОЛЬКО для внешних подключений (rediss://).
        // Для внутреннего (redis://) — TLS не используется.
        tls: process.env.REDIS_URL.startsWith('rediss://') ? {
            servername: url.hostname,
        } : undefined,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => Math.min(times * 500, 5000),
        lazyConnect: false,
    };


    redis = new Redis(redisOptions);

    redis.on('connect', () => {
    });

    redis.on('ready', () => {
        if (!useRedis) {
            useRedis = true;
            console.log('✅ Redis подключён, история флудилки — в Redis');        }
    });

    redis.on('error', (err) => {
        useRedis = false;
    });

    redis.on('close', () => {
    });

    redis.on('reconnecting', () => {
    });

} else {
    console.log('ℹ️ REDIS_URL не задан — работаем с историей в RAM');
}

// RAM-фолбэк (используется, если Redis недоступен)
let globalMessagesHistory = [];

// --- Функция очистки старых сообщений (24 часа) ---
async function cleanOldMessages() {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    if (useRedis && redis) {
        try {
            // Удаляем всё, что старше 24 часов: score < oneDayAgo
            await redis.zremrangebyscore(REDIS_HISTORY_KEY, '-inf', oneDayAgo);
        } catch (err) {
            console.warn('⚠️ Ошибка очистки Redis:', err.message);
        }
    } else {
        // Fallback: чистим RAM-массив
        globalMessagesHistory = globalMessagesHistory.filter(
            (msg) => (now - msg.timestamp) < 24 * 60 * 60 * 1000
        );
    }
}

// --- Функция сохранения сообщения в историю ---
async function saveMessage(messageData) {

    // Если Redis вообще не настроен — сразу в RAM
    if (!redisEnabled) {
        globalMessagesHistory.push(messageData);
        return;
    }

    // Redis настроен — ждём готовности
    try {
        if (!useRedis && redis) {
            await redis.ping(); // дождёмся, пока Redis ответит
            useRedis = true;
        }
        const result = await redis.zadd(REDIS_HISTORY_KEY, messageData.timestamp, JSON.stringify(messageData));

    } catch (err) {
        console.warn('⚠️ Ошибка записи в Redis, падаем в RAM:', err.message);
        globalMessagesHistory.push(messageData);
    }
}

// --- Функция получения истории (последние 24 часа) ---
async function getHistory() {

    // Если Redis вообще не настроен — сразу из RAM
    if (!redisEnabled) {
        return globalMessagesHistory;
    }

    // Redis настроен — ждём готовности и читаем
    try {
        if (!useRedis && redis) {
            await redis.ping(); // дождёмся, пока Redis ответит
            useRedis = true;
        }
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const raw = await redis.zrangebyscore(REDIS_HISTORY_KEY, oneDayAgo, '+inf');
    
        return raw.map((s) => JSON.parse(s));
    } catch (err) {
        console.warn('⚠️ Ошибка чтения из Redis, падаем в RAM:', err.message);
        return globalMessagesHistory;
    }
}

// Запускаем автоматическую уборку старых сообщений каждые 30 минут
setInterval(cleanOldMessages, 30 * 60 * 1000);

io.on('connection', (socket) => {
    const name = skufNames[Math.floor(Math.random() * skufNames.length)];
    const status = skufStatus[Math.floor(Math.random() * skufStatus.length)];
    const emoji = skufEmojis[Math.floor(Math.random() * skufEmojis.length)];
    
    socket.username = `${emoji} ${name} (${status})`;
    socket.messageTimestamps = []; // для rate limit
        // Счётчик онлайн: +1
    onlineCount++;
    broadcastOnlineCount();
    socket.emit('init_user', { id: socket.id, username: socket.username });
    
    socket.join('general');

    // --- РЕГИСТРИРУЕМ ОБРАБОТЧИКИ СРАЗУ, ДО СИГНАЛА ГОТОВНОСТИ ---
    // Иначе клиентский init_session может прийти раньше, чем мы его слушаем.

    // --- СМЕНА НИКА ---
    socket.on('change_nick', async (rawNick) => {
        const result = validateNick(rawNick);
        if (!result.ok) {
            socket.emit('nick_error', { reason: result.reason });
            return;
        }

        const oldNick = socket.username;
        socket.username = `🍺 ${result.nick}`;

        // Сохраняем в Redis, если есть sessionKey
        if (socket.sessionKey) {
            await saveNick(socket.sessionKey, result.nick);
        }

        // Сообщаем самому пользователю, что ник обновился
        socket.emit('nick_changed', { username: socket.username });

        // Системное сообщение в общую флудилку
        io.to('general').emit('receive_msg', {
            senderId: 'system',
            username: 'Система',
            text: `${oldNick} теперь зовётся ${socket.username}`,
            isPrivate: false,
            isSystem: true
        });
    });

    // --- ИНИЦИАЛИЗАЦИЯ СЕССИИ: подтягиваем сохранённый ник ---
    socket.on('init_session', async ({ sessionKey }) => {
        if (!sessionKey) return;
        socket.sessionKey = sessionKey;

        const savedNick = await getSavedNick(sessionKey);
        if (savedNick) {
            socket.username = `🍺 ${savedNick}`;
            socket.emit('nick_changed', { username: socket.username });
            console.log(`♻️ Восстановлен ник для ${sessionKey}: ${socket.username}`);
        } else {
            console.log(`🆕 Новый sessionKey: ${sessionKey}, ник по умолчанию`);
        }
    });

    // --- СИГНАЛ КЛИЕНТУ: "СЕРВЕР ГОТОВ ПРИНИМАТЬ init_session" ---
    // Отправляем после того, как все обработчики зарегистрированы
    socket.emit('server_ready');



       // Как только скуф вошел, отправляем ему всю сохранённую историю за сутки.
    // cleanOldMessages + getHistory — асинхронные, поэтому оборачиваем в async-функцию.
    (async () => {
        try {
            await cleanOldMessages();
            const history = await getHistory();
            history.forEach((msg) => {
                socket.emit('receive_msg', {
                    senderId: msg.senderId,
                    username: msg.username,
                    text: msg.text,
                    isPrivate: false
                });
            });
        } catch (err) {
            console.warn('⚠️ Ошибка отправки истории новому клиенту:', err.message);
        }
    })();


    // 1. Логика общей флудилки (Обновлено!)
        socket.on('send_global_msg', (text) => {
        // Проверяем rate limit
        if (isRateLimited(socket)) {
            socket.emit('rate_limited');
            return;
        }

        // Проверка на рекламу
        if (containsAds(text)) {
            socket.emit('msg_blocked', { reason: 'ads' });
            return;
        }

        // Проверка на повторы
        if (isRepeated(socket, text)) {
            socket.emit('msg_blocked', { reason: 'repeat' });
            return;
        }

        const messageData = {
            senderId: socket.id,
            username: socket.username,
            text: text,
            isPrivate: false,
            timestamp: Date.now() // Запоминаем точное время отправки
        };

        // Сохраняем сообщение в историю (Redis или RAM — решает saveMessage)
        saveMessage(messageData);

        // Отправляем его всем в общую флудилку
        io.to('general').emit('receive_msg', {
            senderId: messageData.senderId,
            username: messageData.username,
            text: messageData.text,
            isPrivate: messageData.isPrivate
        });
    });

    // 2. Логика поиска 1 на 1
    socket.on('search_private', () => {
        socket.leave('general');

        if (waitingSkuf && waitingSkuf.id !== socket.id) {
            const roomId = `room_${waitingSkuf.id}_${socket.id}`;
            
            socket.join(roomId);
            waitingSkuf.join(roomId);

            socket.privateRoom = roomId;
            waitingSkuf.privateRoom = roomId;

            socket.emit('private_found', { opponent: waitingSkuf.username });
            waitingSkuf.emit('private_found', { opponent: socket.username });

            waitingSkuf = null;
        } else {
            waitingSkuf = socket;
            socket.emit('waiting');
        }
    });

    // 3. Отправка приватного сообщения
        socket.on('send_private_msg', (text) => {
        // Проверяем rate limit
        if (isRateLimited(socket)) {
            socket.emit('rate_limited');
            return;
        }

        // Проверка на рекламу
        if (containsAds(text)) {
            socket.emit('msg_blocked', { reason: 'ads' });
            return;
        }

        // Проверка на повторы
        if (isRepeated(socket, text)) {
            socket.emit('msg_blocked', { reason: 'repeat' });
            return;
        }

        if (socket.privateRoom) {

            io.to(socket.privateRoom).emit('receive_msg', {
                senderId: socket.id,
                username: socket.username,
                text: text,
                isPrivate: true
            });
        }
    });

    socket.on('leave_private', () => {
        if (waitingSkuf === socket) waitingSkuf = null;
        
        if (socket.privateRoom) {
            socket.to(socket.privateRoom).emit('partner_disconnected');
            socket.leave(socket.privateRoom);
            socket.privateRoom = null;
        }
        socket.join('general');
    });

    // --- "СЛЕДУЮЩИЙ СКУФ" — сбросить собеседника и искать нового ---
    socket.on('next_skuf', () => {
        // Если мы были в очереди — выходим из неё
        if (waitingSkuf === socket) waitingSkuf = null;

        // Прощаемся с текущим собеседником (если он есть)
        if (socket.privateRoom) {
            socket.to(socket.privateRoom).emit('partner_disconnected');
            socket.leave(socket.privateRoom);
            socket.privateRoom = null;
        }

        // Покидаем general — мы уходим в рулетку
        socket.leave('general');

        // Теперь — логика как в search_private: если кто-то уже ждёт, соединяемся
        if (waitingSkuf && waitingSkuf.id !== socket.id) {
            const roomId = `room_${waitingSkuf.id}_${socket.id}`;

            socket.join(roomId);
            waitingSkuf.join(roomId);

            socket.privateRoom = roomId;
            waitingSkuf.privateRoom = roomId;

            socket.emit('private_found', { opponent: waitingSkuf.username });
            waitingSkuf.emit('private_found', { opponent: socket.username });

            waitingSkuf = null;
        } else {
            // Никого нет — встаём в очередь
            waitingSkuf = socket;
            socket.emit('waiting');
        }
    });

        // --- ИНДИКАТОР "СКУФ ПЕЧАТАЕТ..." ---
    socket.on('typing', () => {
        // В приватном чате — только собеседнику
        if (socket.privateRoom) {
            socket.to(socket.privateRoom).emit('partner_typing', {
                username: socket.username
            });
        } else {
            // В общей флудилке — всем, кроме себя
            socket.to('general').emit('partner_typing', {
                username: socket.username
            });
        }
    });

        socket.on('disconnect', () => {
        if (waitingSkuf === socket) waitingSkuf = null;
        if (socket.privateRoom) {
            socket.to(socket.privateRoom).emit('partner_disconnected');
        }
        // Счётчик онлайн: -1
        onlineCount--;
        broadcastOnlineCount();
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Гараж открыт на ${PORT}`);
});