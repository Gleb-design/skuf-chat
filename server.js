require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const initGame = require('./game-server');

app.use(express.static('public'));

app.use(express.json()); // нужно для POST /admin/add-code с JSON-телом

// --- АДМИН-ЭНДПОИНТЫ ДЛЯ ДОНАТ-КОДОВ ---
// Секрет тот же, что в client.js (ADMIN_SECRET).
// Задаётся переменной окружения ADMIN_SECRET или берётся дефолт.
// --- АДМИН-ЭНДПОИНТЫ ДЛЯ ДОНАТ-КОДОВ ---
// Секрет для серверных админ-эндпоинтов. НЕ путать с client.js ADMIN_SECRET
// (тот — только для показа статистики, не опасен).
// Задаётся переменной окружения ADMIN_API_SECRET.
// На проде — Render → Environment. Локально — в файле .env.
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET;

if (!ADMIN_API_SECRET) {
    console.warn('⚠️ ADMIN_API_SECRET не задан — /admin/* эндпоинты отключены');
}

function checkAdmin(req) {
    if (!ADMIN_API_SECRET) return false; // секрет не задан → всё закрыто
    const fromQuery = req.query.secret;
    const fromHeader = req.get('x-admin-secret');
    return (fromQuery === ADMIN_API_SECRET) || (fromHeader === ADMIN_API_SECRET);
}

// Добавить один код (или сразу несколько через массив codes)
// Пример: POST /admin/add-code?secret=skuf-admin-2026  { "code": "SKUF-A1B2" }
// Или:    POST /admin/add-code?secret=...  { "count": 5 }  → сгенерит 5 случайных
app.post('/admin/add-code', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).json({ error: 'forbidden' });

    const { code, count } = req.body || {};

    // Вариант 1: явный код
    if (code) {
        const result = await addDonateCode(code);
        return res.json(result);
    }

    // Вариант 2: сгенерировать N случайных
    if (count && Number.isInteger(count) && count > 0 && count <= 50) {
        const generated = [];
        for (let i = 0; i < count; i++) {
            let attempts = 0;
            while (attempts < 20) {
                const c = generateDonateCode();
                const r = await addDonateCode(c);
                if (r.ok) { generated.push(c); break; }
                attempts++;
            }
        }
        return res.json({ ok: true, generated });
    }

    return res.status(400).json({ error: 'need_code_or_count' });
});

// Список всех кодов
// GET /admin/list-codes?secret=skuf-admin-2026
app.get('/admin/list-codes', async (req, res) => {
    if (!checkAdmin(req)) return res.status(403).json({ error: 'forbidden' });
    const codes = await listDonateCodes();
    res.json({ count: codes.length, codes });
});


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

function containsAds(text) {
    return BAN_PATTERNS.some((re) => re.test(text));
}

// Генерирует уникальный ID для сообщения.
// Формат: msg_<timestamp>_<случайные 6 символов>
// Пример: msg_1758451234567_a3f9k2
function generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

// --- ХРАНИЛИЩЕ СЕССИЙ: sessionKey → socket ---
// Нужно для приглашений в приват из общей флудилки: чтобы найти сокет по sessionKey.
// Заполняется в init_session, чистится в disconnect.
const sessionsByKey = new Map();

// --- АНТИСПАМ ПРИГЛАШЕНИЙ ---
// Не чаще 1 приглашения от одного юзера в 10 секунд.
const INVITE_COOLDOWN_MS = 10 * 1000;
// Карта: socket.id → timestamp последнего приглашения
const inviteCooldowns = new Map();

// Находит активный socket по sessionKey.
// Возвращает socket или null, если юзер не в сети.
function findSocketBySessionKey(sessionKey) {
    if (!sessionKey) return null;
    return sessionsByKey.get(sessionKey) || null;
}

// Проверяет и обновляет cooldown приглашений.
// Возвращает true, если сейчас можно отправить приглашение, false — если рано.
function checkInviteCooldown(socket) {
    const now = Date.now();
    const last = inviteCooldowns.get(socket.id) || 0;
    if (now - last < INVITE_COOLDOWN_MS) return false;
    inviteCooldowns.set(socket.id, now);
    return true;
}

// --- БОТ-СКУФ: системный персонаж, который отвечает на команды и приветствует ---
// Это не отдельный клиент, а серверная функция, которая шлёт сообщения
// от имени бота в общий чат или лично пользователю.

const BOT_NAME = '🍺 Бот-Скуф';
const BOT_ID = 'bot_skuf';

// Отправить сообщение в общий чат от имени бота
function botSay(text) {
    io.to('general').emit('receive_msg', {
        senderId: BOT_ID,
        username: BOT_NAME,
        text,
        isPrivate: false,
        isSystem: true
    });
}

// Отправить личное сообщение конкретному сокету (в текущий его режим — general или private)
function botSayToUser(socket, text) {
    // Отправляем как системное сообщение — клиент покажет его в текущем окне
    socket.emit('receive_msg', {
        senderId: BOT_ID,
        username: BOT_NAME,
        text,
        isPrivate: !!socket.privateRoom,
        isSystem: true
    });
}


// --- СЧЁТЧИК ОНЛАЙН ---
let onlineCount = 0;

// Рассылает всем актуальное число скуфов онлайн
function broadcastOnlineCount() {
    io.emit('online_count', onlineCount);
    // Обновляем пик онлайна за сегодня (не await — не блокируем рассылку)
    recordPeakOnline(onlineCount).catch(() => {});
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

// Флаги:
let redis = null;
let redisEnabled = !!process.env.REDIS_URL;
let useRedis = false;

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

// --- ДОНАТ-КОДЫ ДЛЯ СМЕНЫ НИКА ---
// Хранилище: Redis Hash skuf:donate_codes
//   field = код (например 'SKUF-A1B2')
//   value = JSON { used: false, usedBy: null, usedAt: null }
// Fallback в RAM, если Redis недоступен.
const REDIS_DONATE_CODES_KEY = 'skuf:donate_codes';
const DONATE_CODE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 дней

// RAM-фолбэк для кодов
const ramDonateCodes = new Map();

// Нормализуем код: верхний регистр, обрезаем пробелы
function normalizeCode(raw) {
    if (typeof raw !== 'string') return null;
    const c = raw.trim().toUpperCase();
    if (!/^SKUF-[A-Z0-9]{4}$/.test(c)) return null;
    return c;
}

// Добавляет новый код. Возвращает true/false.
async function addDonateCode(rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) return { ok: false, reason: 'bad_format' };

    const value = JSON.stringify({ used: false, usedBy: null, usedAt: null });

    if (redisEnabled && redis) {
        try {
            if (!useRedis) { await redis.ping(); useRedis = true; }
            // HSETNX — установит только если поля ещё нет
            const added = await redis.hsetnx(REDIS_DONATE_CODES_KEY, code, value);
            await redis.expire(REDIS_DONATE_CODES_KEY, DONATE_CODE_TTL_SECONDS);
            return { ok: added === 1, reason: added === 1 ? null : 'already_exists' };
        } catch (err) {
            console.warn('⚠️ Ошибка addDonateCode в Redis, падаем в RAM:', err.message);
        }
    }
    // RAM-фолбэк
    if (ramDonateCodes.has(code)) return { ok: false, reason: 'already_exists' };
    ramDonateCodes.set(code, { used: false, usedBy: null, usedAt: null });
    return { ok: true, reason: null };
}

// Проверяет и «сжигает» код. Возвращает { ok: true } или { ok: false, reason }.
async function checkAndBurnDonateCode(rawCode, sessionKey) {
    const code = normalizeCode(rawCode);
    if (!code) return { ok: false, reason: 'bad_format' };

    const usedValue = JSON.stringify({
        used: true,
        usedBy: sessionKey || null,
        usedAt: Date.now()
    });

    if (redisEnabled && redis) {
        try {
            if (!useRedis) { await redis.ping(); useRedis = true; }
            const raw = await redis.hget(REDIS_DONATE_CODES_KEY, code);
            if (!raw) return { ok: false, reason: 'not_found' };

            const info = JSON.parse(raw);
            if (info.used) return { ok: false, reason: 'already_used' };

            await redis.hset(REDIS_DONATE_CODES_KEY, code, usedValue);
            return { ok: true };
        } catch (err) {
            console.warn('⚠️ Ошибка checkAndBurnDonateCode в Redis, падаем в RAM:', err.message);
        }
    }
    // RAM-фолбэк
    const info = ramDonateCodes.get(code);
    if (!info) return { ok: false, reason: 'not_found' };
    if (info.used) return { ok: false, reason: 'already_used' };
    ramDonateCodes.set(code, { used: true, usedBy: sessionKey || null, usedAt: Date.now() });
    return { ok: true };
}

// Список всех кодов с их статусом (для админ-эндпоинта)
async function listDonateCodes() {
    if (redisEnabled && redis) {
        try {
            if (!useRedis) { await redis.ping(); useRedis = true; }
            const hash = await redis.hgetall(REDIS_DONATE_CODES_KEY);
            return Object.entries(hash).map(([code, raw]) => {
                try { return { code, ...JSON.parse(raw) }; }
                catch { return { code, raw }; }
            });
        } catch (err) {
            console.warn('⚠️ Ошибка listDonateCodes в Redis, падаем в RAM:', err.message);
        }
    }
    return Array.from(ramDonateCodes.entries()).map(([code, info]) => ({ code, ...info }));
}

// Генерирует новый случайный код формата SKUF-XXXX
function generateDonateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O/1/I
    let suffix = '';
    for (let i = 0; i < 4; i++) {
        suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `SKUF-${suffix}`;
}

// --- СТАТИСТИКА: Redis + RAM-fallback ---
// Ключи:
//   skuf:stats:<YYYY-MM-DD>        — Hash { messages, peakOnline }
//   skuf:stats:users:<YYYY-MM-DD>  — Set из sessionKey (для уникальных)
const STATS_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 дней

// RAM-фолбэк: если Redis нет, держим статистику в памяти процесса
let ramStats = {
    date: null,        // 'YYYY-MM-DD'
    messages: 0,
    peakOnline: 0,
    users: new Set()   // sessionKey-и
};

function todayKey() {
    // UTC-дата в формате YYYY-MM-DD
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Проверяет, сменились ли сутки — если да, сбрасывает RAM-статистику
function ensureRamStatsFresh() {
    const today = todayKey();
    if (ramStats.date !== today) {
        ramStats = { date: today, messages: 0, peakOnline: 0, users: new Set() };
    }
}

// +1 к счётчику сообщений (общая + приват)
async function recordMessage() {
    const today = todayKey();
    if (useRedis && redis) {
        try {
            const key = `skuf:stats:${today}`;
            await redis.hincrby(key, 'messages', 1);
            await redis.expire(key, STATS_TTL_SECONDS);
            return;
        } catch (err) {
            console.warn('⚠️ Ошибка recordMessage в Redis, падаем в RAM:', err.message);
        }
    }
    ensureRamStatsFresh();
    ramStats.messages++;
}

// Запоминает уникального пользователя (по sessionKey)
async function recordUniqueUser(sessionKey) {
    if (!sessionKey) return;
    const today = todayKey();
    if (useRedis && redis) {
        try {
            const key = `skuf:stats:users:${today}`;
            await redis.sadd(key, sessionKey);
            await redis.expire(key, STATS_TTL_SECONDS);
            return;
        } catch (err) {
            console.warn('⚠️ Ошибка recordUniqueUser в Redis, падаем в RAM:', err.message);
        }
    }
    ensureRamStatsFresh();
    ramStats.users.add(sessionKey);
}

// Обновляет пик онлайна (вызывается при каждом изменении onlineCount)
async function recordPeakOnline(count) {
    const today = todayKey();
    if (useRedis && redis) {
        try {
            const key = `skuf:stats:${today}`;
            const current = parseInt(await redis.hget(key, 'peakOnline') || '0', 10);
            if (count > current) {
                await redis.hset(key, 'peakOnline', count);
            }
            await redis.expire(key, STATS_TTL_SECONDS);
            return;
        } catch (err) {
            console.warn('⚠️ Ошибка recordPeakOnline в Redis, падаем в RAM:', err.message);
        }
    }
    ensureRamStatsFresh();
    if (count > ramStats.peakOnline) ramStats.peakOnline = count;
}

// Читает текущую статистику за сегодня
async function getStats() {
    const today = todayKey();

    if (useRedis && redis) {
        try {
            const statsKey = `skuf:stats:${today}`;
            const usersKey = `skuf:stats:users:${today}`;
            const [hash, uniqueUsers] = await Promise.all([
                redis.hgetall(statsKey),
                redis.scard(usersKey)
            ]);
            return {
                messages: parseInt(hash.messages || '0', 10),
                peakOnline: parseInt(hash.peakOnline || '0', 10),
                uniqueUsers: uniqueUsers || 0
            };
        } catch (err) {
            console.warn('⚠️ Ошибка getStats в Redis, падаем в RAM:', err.message);
        }
    }

    // RAM-фолбэк
    ensureRamStatsFresh();
    return {
        messages: ramStats.messages,
        peakOnline: ramStats.peakOnline,
        uniqueUsers: ramStats.users.size
    };
}


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
    // payload: { nick: string, code?: string }
    // Если code передан — проверяем и «сжигаем». Если нет — бесплатный режим (пока).
    socket.on('change_nick', async (payload) => {
        let rawNick, rawCode;
        if (typeof payload === 'string') {
            // Старый формат: просто строка (для совместимости)
            rawNick = payload;
        } else if (payload && typeof payload === 'object') {
            rawNick = payload.nick;
            rawCode = payload.code;
        } else {
            socket.emit('nick_error', { reason: 'bad_type' });
            return;
        }

        // Валидация ника
        const result = validateNick(rawNick);
        if (!result.ok) {
            socket.emit('nick_error', { reason: result.reason });
            return;
        }

        // Если код передан — проверяем и сжигаем ДО смены ника
        if (rawCode) {
            const codeCheck = await checkAndBurnDonateCode(rawCode, socket.sessionKey);
            if (!codeCheck.ok) {
                socket.emit('nick_error', { reason: `code_${codeCheck.reason}` });
                return;
            }
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

        // Регистрируем сокет в хранилище сессий (для приглашений в приват)
    sessionsByKey.set(sessionKey, socket);

    // Считаем уникального скуфа за сегодня
    await recordUniqueUser(sessionKey);

    const savedNick = await getSavedNick(sessionKey);
    if (savedNick) {
        socket.username = `🍺 ${savedNick}`;
        socket.emit('nick_changed', { username: socket.username });
        console.log(`♻️ Восстановлен ник для ${sessionKey}: ${socket.username}`);
    } else {
        console.log(`🆕 Новый sessionKey: ${sessionKey}, ник по умолчанию`);
    }
        // Приветствие от бота — лично пользователю, коротко
    botSayToUser(socket,
        'Здорово, скуф! 🍺 Хочешь свой ник? Введи: /nick ТвойНик'
    );
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
                    messageId: msg.messageId || null,
                    senderId: msg.senderId,
                    senderSessionKey: msg.senderSessionKey || null,
                    username: msg.username,
                    text: msg.text,
                    isPrivate: false,
                    timestamp: msg.timestamp || null,
                    replyTo: msg.replyTo || null
                });
            });
        } catch (err) {
            console.warn('⚠️ Ошибка отправки истории новому клиенту:', err.message);
        }
    })();


    // 1. Логика общей флудилки (Обновлено!)
socket.on('send_global_msg', (payload) => {
    // Поддерживаем два формата:
    //   1) строка (старый клиент или команды вроде /help)
    //   2) объект { text, replyTo } (новый клиент)
    const text = (typeof payload === 'string')
        ? payload
        : (payload && typeof payload === 'object' ? String(payload.text || '') : '');
    const replyTo = (payload && typeof payload === 'object' && payload.replyTo)
        ? payload.replyTo
        : null;

    // --- КОМАНДЫ БОТА (перехватываем до rate limit) ---
    const trimmed = (text || '').trim();

        if (trimmed === '/help') {
    botSayToUser(socket,
        '🍺 Чтобы сменить ник — просто введи в чат:\n' +
        '/nick ТвойНовыйНик\n' +
        'Например: /nick Кабан\n\n' +
        'Ник сохранится и переживёт перезагрузку страницы.'
    );
    return;
}

        if (trimmed === '/mykey') {
            const key = socket.sessionKey || '(ещё не инициализирован — подожди пару секунд)';
            botSayToUser(socket, `🍺 Твой sessionKey: ${key}`);
            return;
        }

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
            messageId: generateMessageId(),
            senderId: socket.id,
            senderSessionKey: socket.sessionKey || null,
            username: socket.username,
            text: text,
            isPrivate: false,
            timestamp: Date.now(),
            replyTo: replyTo ? {
                messageId: replyTo.messageId,
                username: replyTo.username,
                preview: String(replyTo.preview || '').slice(0, 120)
            } : null
        };

        // Сохраняем сообщение в историю (Redis или RAM — решает saveMessage)
        saveMessage(messageData);
        // Статистика: +1 к сообщениям за сегодня
        recordMessage().catch(() => {});

        // Отправляем его всем в общую флудилку
        io.to('general').emit('receive_msg', {
            messageId: messageData.messageId,
            senderId: messageData.senderId,
            senderSessionKey: messageData.senderSessionKey,
            username: messageData.username,
            text: messageData.text,
            isPrivate: messageData.isPrivate,
            timestamp: messageData.timestamp,
            replyTo: messageData.replyTo
        });
    });

        // --- ПРИГЛАШЕНИЕ В ПРИВАТ ИЗ ОБЩЕЙ ФЛУДИЛКИ ---
    // A шлёт { targetSessionKey }, сервер ищет сокет B и посылает ему private_invite.
    socket.on('invite_private', ({ targetSessionKey } = {}) => {
        // 1. Базовая валидация
        if (!targetSessionKey || typeof targetSessionKey !== 'string') {
            socket.emit('invite_error', { reason: 'bad_request' });
            return;
        }

        // Нельзя пригласить самого себя
        if (targetSessionKey === socket.sessionKey) {
            socket.emit('invite_error', { reason: 'self' });
            return;
        }

        // 2. Антиспам
        if (!checkInviteCooldown(socket)) {
            socket.emit('invite_error', { reason: 'too_often' });
            return;
        }

        // 3. Ищем сокет получателя
        const targetSocket = findSocketBySessionKey(targetSessionKey);
        if (!targetSocket) {
            socket.emit('invite_error', { reason: 'offline' });
            return;
        }

        // 4. Получатель сейчас в привате?
        if (targetSocket.privateRoom) {
            socket.emit('invite_error', { reason: 'busy' });
            return;
        }

        // 5. Получатель сам сейчас ищет собеседника (в очереди рулетки)?
        if (waitingSkuf === targetSocket) {
            // Не отказываем — просто вытаскиваем его из очереди и соединяем
            waitingSkuf = null;
        }

        // 6. Запоминаем на сокете получателя, кто его приглашает
        targetSocket.pendingInvite = {
            fromSessionKey: socket.sessionKey,
            fromSocketId: socket.id,
            fromUsername: socket.username,
            at: Date.now()
        };

        // 7. Шлём получателю приглашение
        targetSocket.emit('private_invite', {
            fromUsername: socket.username
        });

        // 8. Подтверждаем отправителю, что приглашение ушло
        socket.emit('invite_sent', {
            toUsername: targetSocket.username
        });
    });

    // --- ОТВЕТ НА ПРИГЛАШЕНИЕ (принять / отклонить) ---
    socket.on('private_invite_response', ({ accepted } = {}) => {
        const invite = socket.pendingInvite;
        socket.pendingInvite = null; // сбрасываем в любом случае

        if (!invite) {
            // Приглашения уже нет (истекло, отменено) — тихо игнорируем
            return;
        }

        // Ищем отправителя по sessionKey
        const fromSocket = findSocketBySessionKey(invite.fromSessionKey);

        if (!accepted) {
            // Отказ — если отправитель ещё в сети, сообщаем
            if (fromSocket) {
                fromSocket.emit('private_invite_declined', {
                    byUsername: socket.username
                });
            }
            return;
        }

        // Согласие — но отправитель мог уже уйти / занять себя
        if (!fromSocket) {
            socket.emit('invite_error', { reason: 'offline' });
            return;
        }
        if (fromSocket.privateRoom) {
            socket.emit('invite_error', { reason: 'busy' });
            return;
        }

        // Создаём приватную комнату — та же логика, что в search_private
        const roomId = `room_${fromSocket.id}_${socket.id}`;

        fromSocket.join(roomId);
        socket.join(roomId);

        fromSocket.privateRoom = roomId;
        socket.privateRoom = roomId;

        // Оба покидают general
        fromSocket.leave('general');
        socket.leave('general');

        fromSocket.emit('private_found', { opponent: socket.username });
        socket.emit('private_found', { opponent: fromSocket.username });
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

            // Статистика: +1 к сообщениям за сегодня
            recordMessage().catch(() => {});
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

        // --- СТАТИСТИКА: по запросу клиента ---
        socket.on('get_stats', async () => {
            try {
                const stats = await getStats();
                socket.emit('stats_update', stats);
            } catch (err) {
                console.warn('⚠️ Ошибка get_stats:', err.message);
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

    // Чистим хранилище сессий (только если эта сессия всё ещё указывает на этот сокет)
    if (socket.sessionKey && sessionsByKey.get(socket.sessionKey) === socket) {
        sessionsByKey.delete(socket.sessionKey);
    }
    inviteCooldowns.delete(socket.id);

    if (socket.privateRoom) {
        socket.to(socket.privateRoom).emit('partner_disconnected');
    }
    // Счётчик онлайн: -1
    onlineCount--;
    broadcastOnlineCount();
});
});


// --- ИНИЦИАЛИЗАЦИЯ МОРСКОГО БОЯ ---
// Модуль сам подписывается на io.on('connection') и регистрирует свои события.
initGame(io, {
    sessionsByKey,
    findSocketBySessionKey,
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Гараж открыт на ${PORT}`);
});