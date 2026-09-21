const socket = io();

let myId = null;
let myUsername = null;
let currentMode = 'general';

// --- SESSION KEY: постоянный ID браузера для сохранения ника ---
// Генерируется один раз, живёт в localStorage, переживает перезагрузку страницы.
function getOrCreateSessionKey() {
    const STORAGE_KEY = 'skuf_session_key';
    let key = localStorage.getItem(STORAGE_KEY);
    if (!key) {
        // crypto.randomUUID() поддерживается во всех современных браузерах
        key = (crypto.randomUUID && crypto.randomUUID()) ||
              ('skuf_' + Date.now() + '_' + Math.random().toString(36).slice(2));
        localStorage.setItem(STORAGE_KEY, key);
        console.log('🆕 Создан новый sessionKey:', key);
    } else {
        console.log('♻️ Найден сохранённый sessionKey:', key);
    }
    return key;
}

const sessionKey = getOrCreateSessionKey();

// --- ADMIN-РЕЖИМ: статистика видна только по ?admin=СЕКРЕТ ---
// Секрет задан здесь. Ты один раз открываешь ?admin=СЕКРЕТ,
// он сохраняется в localStorage — потом просто заходишь как обычно.
const ADMIN_SECRET = 'skuf-admin-2026'; // ← поменяй на свой секрет

function checkAdminMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlAdmin = urlParams.get('admin');

    // Если в URL есть правильный секрет — сохраняем и чистим URL
    if (urlAdmin === 'skuf-admin-2026') {
        localStorage.setItem('skuf_admin', '1');
        // Убираем ?admin=... из адресной строки, чтобы не светить секрет
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        console.log('👑 Admin-режим активирован');
    }

    // Проверяем, включён ли админ-режим (по URL или по сохранённому флагу)
    return localStorage.getItem('skuf_admin') === '1';
}

const isAdmin = checkAdminMode();

// --- ТЕМА ПО УМОЛЧАНИЮ: КУРИЛКА ---
// При загрузке мы сразу в общей флудилке, значит на generalMessagesBox — тема курилки

// --- ЗВУКОВОЙ ДВИЖОК ---
const soundOutgoing = new Audio('/click.mp3');
const soundIncoming = new Audio('/beer.mp3');
soundOutgoing.volume = 0.1;
soundIncoming.volume = 0.1;

// --- ФОНОВЫЙ ЗВУК ГАРАЖА (ambient.mp3) ---
// По умолчанию ВЫКЛЮЧЕН. Пользователь сам решает — кнопкой 🔊/🔇 в шапке.
// Выбор хранится в localStorage ('skuf_ambient': 'on' | 'off').
const ambientSound = new Audio('/ambient.mp3');
ambientSound.loop = true;
ambientSound.volume = 0.08; // тихий фон, не «звук»

// Восстановить настройку из localStorage (по умолчанию — off)
let ambientEnabled = localStorage.getItem('skuf_ambient') === 'on';

// Элементы интерфейса
const btnGeneral = document.getElementById('btnGeneral');
const btnPrivate = document.getElementById('btnPrivate');
const chatTitle = document.getElementById('chatTitle');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
// --- ЭМОДЗИ-ПАНЕЛЬ (v1.12.0) ---
const emojiBtn = document.getElementById('emojiBtn');
const emojiPanel = document.getElementById('emojiPanel');

// Скуфский набор — 36 смайлов, сетка 6×6
const SKUF_EMOJIS = [
    // 🍺 Быт (12)
    '🍺', '🍻', '🍢', '🎣', '📺', '🛋️',
    '🔧', '🥟', '🍖', '🧦', '🧖', '🏡',
    // 🥃 Напитки (3)
    '🥃', '🍷', '🍸',
    // 😎 Реакции (10)
    '😎', '🤙', '🖕', '💪', '🤷', '🥴',
    '😴', '💀', '🔥', '😂',
    // 🎭 Классика ICQ (8)
    '🙂', '☹️', '😉', '😄', '😛', '😢',
    '😱', '😡',
    // 👀 Особое (3)
    '👀', '🍑', '🤘'
];
const myUsernameDisplay = document.getElementById('myUsername');
const btnDonate = document.getElementById('btnDonate');

// --- REPLY (ответ на сообщение) ---
// Текущий ответ: null или { messageId, username, preview }
let currentReply = null;

// Элементы плашки «Ответ на: …»
const replyTargetBar = document.getElementById('replyTargetBar');
const replyTargetText = document.getElementById('replyTargetText');
const replyTargetCancel = document.getElementById('replyTargetCancel');

const generalMessagesBox = document.getElementById('generalMessagesBox');
const privateMessagesBox = document.getElementById('privateMessagesBox');
const chatArea = document.querySelector('.chat-area');
const messagesWrapper = document.querySelector('.messages-wrapper');
// СРАЗУ навешиваем курилку на .messages-wrapper, ДО вставки декораций,
// чтобы при загрузке ничего не мигнуло
if (messagesWrapper) messagesWrapper.classList.add('theme-general');

// --- ВРЕМЯ СУТОК: определяем фазу и вешаем класс ---
// Фазы: утро (6-12), день (12-18), вечер (18-23), ночь (23-6)
function getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'day';
    if (hour >= 18 && hour < 23) return 'evening';
    return 'night';
}

function applyTimeOfDay() {
    const phase = getTimeOfDay();
    const timeClass = `time-${phase}`;

    // Снимаем все возможные time-* классы (на случай смены)
    const allPhases = ['time-morning', 'time-day', 'time-evening', 'time-night'];
    allPhases.forEach((c) => {
        chatArea.classList.remove(c);
        if (messagesWrapper) messagesWrapper.classList.remove(c);
    });

    // Вешаем актуальный
    chatArea.classList.add(timeClass);
    if (messagesWrapper) messagesWrapper.classList.add(timeClass);

    console.log(`🕐 Время суток: ${phase}`);
}

// Применяем сразу при загрузке
applyTimeOfDay();

// И обновляем раз в 5 минут — на случай, если пользователь долго сидит
setInterval(applyTimeOfDay, 5 * 60 * 1000);

// --- ТЕМЫ И ДЕКОРАЦИИ ---
// Тема вешается на .chat-area, потому что декорации (плакат, ящик, дым, стол)
// живут там же и позиционируются относительно всей области чата, а не скролла.
chatArea.classList.add('theme-general');

// --- ДЕКОРАЦИИ: курилка + приват, оба набора сразу ---
// Видимость управляется CSS-классами theme-general / theme-private
function addAllDecor() {
    if (!messagesWrapper) return;
    if (messagesWrapper.querySelector('.skuf-decor')) return;

    // Курилочные декорации (2 дыма + телевизор + свечение от него)
        // Курилочные декорации (2 дыма + 2 пепельницы + телевизор + свечение от него)
    const generalDecor = ['lamp1', 'lamp2', 'lamp3', 'smoke', 'smoke2', 'ashtray1', 'ashtray2', 'glass-g1', 'glass-g2', 'glass-g3', 'glass-g4', 'shelf', 'table', 'tv-antenna', 'tv', 'tv-glow'];
    generalDecor.forEach((name) => {
        const el = document.createElement('div');
        el.className = `skuf-decor ${name}`;
        messagesWrapper.appendChild(el);
    });

    // Приватные декорации (2 дыма)
        // Приватные декорации (2 дыма + полка с бутылками)
    // Приватные декорации (2 дыма + полка с бутылками + 2 стакана)
    const privateDecor = ['bar-counter', 'bottle1', 'bottle2', 'glass', 'glass2', 'cat', 'shelf-private', 'ashtray-p1', 'smoke-p1'];
    privateDecor.forEach((name) => {
        const el = document.createElement('div');
        el.className = `skuf-decor ${name}`;
        messagesWrapper.appendChild(el);
    });
    // Кот: вставляем SVG-силуэт в контейнер .skuf-decor.cat
// Кот: вставляем готовый SVG-файл через <img>
const catEl = messagesWrapper.querySelector('.skuf-decor.cat');
if (catEl) {
    const img = document.createElement('img');
    img.src = '/cat.svg';
    img.alt = 'Спящий кот';
    img.className = 'cat-svg';
    catEl.appendChild(img);
}
}

addAllDecor();

// --- ЗАПОЛНЯЕМ ПАНЕЛЬ СМАЙЛАМИ ---
function renderEmojiPanel() {
    if (!emojiPanel) return;
    emojiPanel.innerHTML = ''; // на случай перерисовки
    SKUF_EMOJIS.forEach((emoji) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-item';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            insertEmoji(emoji);
        });
        emojiPanel.appendChild(btn);
    });
}

renderEmojiPanel();


const privateControls = document.getElementById('privateControls');
const btnNextSkuf = document.getElementById('btnNextSkuf');
const btnCancelSearch = document.getElementById('btnCancelSearch');
const onlineCounter = document.getElementById('onlineCounter');
const typingIndicator = document.getElementById('typingIndicator');

// При подключении — сообщаем серверу наш постоянный sessionKey.
// Сервер по нему посмотрит, есть ли сохранённый ник, и применит его.
socket.on('server_ready', () => {
    console.log('✅ Сервер готов, отправляем sessionKey');
    socket.emit('init_session', { sessionKey });
    // Первый запрос статистики — сразу после готовности сервера
    requestStats();
});

socket.on('init_user', (data) => {
    myId = data.id;
    myUsername = data.username;
    myUsernameDisplay.textContent = myUsername;
});


// Сервер сообщил, что ник сменился — обновляем в шапке
socket.on('nick_changed', (data) => {
    myUsername = data.username;
    myUsernameDisplay.textContent = myUsername;
});

// Счётчик онлайн — обновляем число в шапке
socket.on('online_count', (count) => {
    if (onlineCounter) {
        onlineCounter.innerHTML = `🍺 Сейчас в гараже: <strong>${count}</strong>`;
    }
});

// --- СТАТИСТИКА ЗА СЕГОДНЯ ---
// Блок создаётся ДИНАМИЧЕСКИ и ТОЛЬКО для админа,
// чтобы Googlebot не видел "0 сообщений" в исходном HTML.

let statsMessages = null;
let statsUsers = null;
let statsPeak = null;

if (isAdmin) {
    const statsCounterEl = document.createElement('div');
    statsCounterEl.id = 'statsCounter';
    statsCounterEl.className = 'stats-counter';
    statsCounterEl.innerHTML = `
        📊 Сегодня: <span id="statsMessages">0 сообщений</span> ·
        <span id="statsUsers">0 скуфов</span> ·
        пик <span id="statsPeak">0</span>
    `;

    // Вставляем в шапку — после счётчика онлайна
    const header = document.querySelector('.chat-header');
    const onlineCounterEl = document.getElementById('onlineCounter');
    if (header && onlineCounterEl) {
        onlineCounterEl.insertAdjacentElement('afterend', statsCounterEl);
    } else if (header) {
        header.appendChild(statsCounterEl);
    }

    // Теперь находим уже созданные элементы
    statsMessages = document.getElementById('statsMessages');
    statsUsers = document.getElementById('statsUsers');
    statsPeak = document.getElementById('statsPeak');
}

// Обновляем DOM-числа, когда сервер присылает свежие данные
// --- СКЛОНЕНИЕ РУССКИХ СЛОВ ---
// plural(1, 'сообщение', 'сообщения', 'сообщений') → 'сообщение'
// plural(2, ...) → 'сообщения'
// plural(5, ...) → 'сообщений'
function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

socket.on('stats_update', (data) => {
    if (!data) return;

    const m = data.messages ?? 0;
    const u = data.uniqueUsers ?? 0;

    if (statsMessages) {
        statsMessages.textContent = `${m} ${plural(m, 'сообщение', 'сообщения', 'сообщений')}`;
    }
    if (statsUsers) {
        statsUsers.textContent = `${u} ${plural(u, 'скуф', 'скуфа', 'скуфов')}`;
    }
    if (statsPeak) {
        statsPeak.textContent = data.peakOnline ?? 0;
    }
});

// Запрашиваем статистику раз в минуту
// (плюс первый запрос — сразу, как сервер скажет, что готов)
function requestStats() {
    if (!isAdmin) return;  // обычные юзеры статистику не запрашивают
    socket.emit('get_stats');
}

if (isAdmin) {
    setInterval(requestStats, 60 * 1000);
}

// КЛИК: Переключение на ОБЩУЮ ФЛУДИЛКУ (БЕЗ БЛОКИРОВОК!)
    btnGeneral.addEventListener('click', () => {
    currentMode = 'general';
    switchToGeneralModeUI();
    chatTitle.textContent = "📢 Общая флудилка (Скуф-Курилка)";
    socket.emit('leave_private');
});

// Переключает UI на приватный режим (вкладки, тему, кнопки).
// Не трогает currentMode и не эмитит ничего на сервер — только визуал.
function switchToPrivateModeUI() {
    btnGeneral.classList.remove('active');
    btnPrivate.classList.add('active');

    generalMessagesBox.classList.add('hidden');
    privateMessagesBox.classList.remove('hidden');
    privateMessagesBox.style.display = 'flex';

    chatArea.classList.add('theme-private');
    chatArea.classList.remove('theme-general');
    messagesWrapper.classList.add('theme-private');
    messagesWrapper.classList.remove('theme-general');

    showPrivateControls();
}

// Переключает UI обратно на общую флудилку.
function switchToGeneralModeUI() {
    btnPrivate.classList.remove('active');
    btnGeneral.classList.add('active');

    generalMessagesBox.classList.remove('hidden');
    privateMessagesBox.classList.add('hidden');

    chatArea.classList.add('theme-general');
    chatArea.classList.remove('theme-private');
    messagesWrapper.classList.add('theme-general');
    messagesWrapper.classList.remove('theme-private');

    hidePrivateControls();
}

// КЛИК: Переключение на ПОИСК СКУФА
btnPrivate.addEventListener('click', () => {
    if (currentMode !== 'general') return;
    
    currentMode = 'searching';
    switchToPrivateModeUI();
    chatTitle.textContent = "🔍 Ищем свободного мужика для беседы...";
    privateMessagesBox.innerHTML = '<div class="system-msg">Поиск собеседника... Налейте пока квасу.</div>';
    socket.emit('search_private');
});

// Отправка сообщений
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    // --- КОМАНДА /nick ---
    // Формат 1 (бесплатно):  /nick Вася
    // Формат 2 (по коду):    /nick SKUF-A1B2 Вася
    if (text.startsWith('/nick ')) {
        const rest = text.slice(6).trim(); // всё после "/nick "
        if (rest.length === 0) {
            showSystemMsg('🍺 Напиши ник после /nick. Например: /nick Вася');
            messageInput.value = '';
            return;
        }

        const parts = rest.split(/\s+/);
        // Если первое слово выглядит как код (SKUF-XXXX) — это формат с кодом
        const firstLooksLikeCode = /^SKUF-[A-Z0-9]{4}$/i.test(parts[0]);

        if (firstLooksLikeCode) {
            if (parts.length < 2) {
                showSystemMsg('🍺 После кода напиши ник. Например: /nick SKUF-A1B2 Вася');
                messageInput.value = '';
                return;
            }
            const code = parts[0].toUpperCase();
            const newNick = parts.slice(1).join(' ');
            socket.emit('change_nick', { nick: newNick, code });
        } else {
            // Бесплатный режим
            socket.emit('change_nick', { nick: rest });
        }
        messageInput.value = '';
        return;
    }

    if (currentMode === 'general') {
        // Отправляем объект с text и replyTo (если сейчас отвечаем)
        socket.emit('send_global_msg', {
            text: text,
            replyTo: currentReply ? {
                messageId: currentReply.messageId,
                username: currentReply.username,
                preview: currentReply.preview
            } : null
        });
    } else if (currentMode === 'private') {
        // Приват пока без reply — просто текст
        socket.emit('send_private_msg', text);
    }
    messageInput.value = '';
    // После отправки сбрасываем плашку ответа
    clearReplyTarget();
}

// --- ВСТАВКА ЭМОДЗИ В ПОЛЕ ВВОДА ---
function insertEmoji(emoji) {
    if (!messageInput) return;
    // Вставляем эмодзи в позицию курсора (или в конец)
    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? messageInput.value.length;
    const before = messageInput.value.slice(0, start);
    const after = messageInput.value.slice(end);
    messageInput.value = before + emoji + after;
    // Ставим курсор после эмодзи
    const newPos = start + emoji.length;
    messageInput.setSelectionRange(newPos, newPos);
    // Возвращаем фокус в поле — чтобы можно было сразу продолжать печатать
    messageInput.focus();
}

// Показывает системное сообщение в текущем активном окне
function showSystemMsg(text) {
    const warn = document.createElement('div');
    warn.className = 'system-msg';
    warn.textContent = text;

    if (currentMode === 'private' || currentMode === 'searching') {
        privateMessagesBox.appendChild(warn);
        privateMessagesBox.scrollTop = privateMessagesBox.scrollHeight;
    } else {
        generalMessagesBox.appendChild(warn);
        generalMessagesBox.scrollTop = generalMessagesBox.scrollHeight;
    }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// --- REPLY: управление плашкой «Ответ на: …» ---
// Устанавливает текущий ответ и показывает плашку над полем ввода.
function setReplyTarget(messageId, username, preview) {
    currentReply = {
        messageId,
        username,
        preview: String(preview || '').slice(0, 80)
    };

    if (replyTargetText) {
        replyTargetText.textContent = `${username}: ${currentReply.preview}`;
    }
    if (replyTargetBar) {
        replyTargetBar.classList.remove('hidden');
    }
    // Фокус в поле ввода — юзер сразу печатает
    if (messageInput) messageInput.focus();
}

// Сбрасывает текущий ответ и скрывает плашку.
function clearReplyTarget() {
    currentReply = null;
    if (replyTargetBar) replyTargetBar.classList.add('hidden');
    if (replyTargetText) replyTargetText.textContent = '';
}

// Кнопка ✕ на плашке — отменяет ответ
if (replyTargetCancel) {
    replyTargetCancel.addEventListener('click', () => {
        clearReplyTarget();
    });
}

// --- ОТПРАВКА "СКУФ ПЕЧАТАЕТ..." ПРИ ВВОДЕ ---
let lastTypingSent = 0;
const TYPING_THROTTLE_MS = 1500; // не чаще, чем раз в 1.5 секунды

messageInput.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTypingSent < TYPING_THROTTLE_MS) return;
    lastTypingSent = now;
    socket.emit('typing');
});

// --- ОТКРЫТИЕ/ЗАКРЫТИЕ ПАНЕЛИ СМАЙЛОВ ---
function toggleEmojiPanel() {
    if (!emojiPanel) return;
    const isHidden = emojiPanel.classList.contains('hidden');
    if (isHidden) {
        emojiPanel.classList.remove('hidden');
        emojiBtn?.classList.add('active');
    } else {
        emojiPanel.classList.add('hidden');
        emojiBtn?.classList.remove('active');
    }
}

if (emojiBtn) {
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEmojiPanel();
    });
}

// Клик вне панели — закрыть
document.addEventListener('click', (e) => {
    if (!emojiPanel || emojiPanel.classList.contains('hidden')) return;
    if (emojiPanel.contains(e.target)) return;       // внутри панели — не закрываем
    if (emojiBtn && emojiBtn.contains(e.target)) return; // по самой кнопке — не закрываем
    emojiPanel.classList.add('hidden');
    emojiBtn?.classList.remove('active');
});

// --- ПОКАЗ/СКРЫТИЕ КНОПОК ПРИВАТНОГО ЧАТА ---
function showPrivateControls() {
    privateControls.classList.remove('hidden');
}
function hidePrivateControls() {
    privateControls.classList.add('hidden');
}

// --- КНОПКА "СЛЕДУЮЩИЙ СКУФ" ---
btnNextSkuf.addEventListener('click', () => {
    // Сообщаем серверу: отпустить текущего собеседника и встать в очередь заново
    socket.emit('next_skuf');

    // Переводим UI в режим поиска
    currentMode = 'searching';
    chatTitle.textContent = "🔍 Ищем свободного мужика для беседы...";
    privateMessagesBox.innerHTML = '<div class="system-msg">Меняем скуфа... Налейте пока квасу.</div>';

    // Панель кнопок остаётся видимой (мы всё ещё в рулетке)
    showPrivateControls();
});

// --- КНОПКА "ВЫЙТИ ВО ФЛУДИЛКУ" ---
btnCancelSearch.addEventListener('click', () => {
    if (currentMode === 'private' || currentMode === 'searching') {
        btnGeneral.click(); // просто эмулируем клик по кнопке общей флудилки
    }
});

// --- ДОНАТ-КНОПКА 🍺 ---
const DONATE_URL = 'https://www.donationalerts.com/r/glem_design';

if (btnDonate) {
    btnDonate.addEventListener('click', () => {
        window.open(DONATE_URL, '_blank', 'noopener');
    });
}

// --- КНОПКА ФОНОВОГО ЗВУКА 🔊/🔇 ---
const btnSound = document.getElementById('btnSound');

// Обновить иконку и класс кнопки по текущему состоянию
function updateSoundButton() {
    if (!btnSound) return;
    if (ambientEnabled) {
        btnSound.textContent = '🔊';
        btnSound.classList.add('active');
        btnSound.title = 'Выключить фоновый звук';
    } else {
        btnSound.textContent = '🔇';
        btnSound.classList.remove('active');
        btnSound.title = 'Включить фоновый звук гаража';
    }
}

// Попытка запустить/остановить плеер
function applyAmbient() {
    if (ambientEnabled) {
        // play() возвращает Promise — ловим ошибку автозапуска
        ambientSound.play().catch((err) => {
            console.log('🔇 Автозапуск фонового звука заблокирован:', err.message);
        });
    } else {
        ambientSound.pause();
    }
}

// Toggle по клику
if (btnSound) {
    btnSound.addEventListener('click', () => {
        ambientEnabled = !ambientEnabled;
        localStorage.setItem('skuf_ambient', ambientEnabled ? 'on' : 'off');
        updateSoundButton();
        applyAmbient();
    });
}

// Инициализация при загрузке: показать правильную иконку
updateSoundButton();

// Пробуем включить, только если пользователь ранее включал.
// Браузер может заблокировать автозапуск — тогда звук включится
// при первом клике где угодно по странице (жест пользователя).
if (ambientEnabled) {
    applyAmbient();

    // Fallback: ждём первого клика пользователя и запускаем
    const kickstart = () => {
        applyAmbient();
        document.removeEventListener('click', kickstart);
    };
    document.addEventListener('click', kickstart, { once: true });
}

// Пауза, когда вкладка неактивна. Возврат — играем, если включено.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        ambientSound.pause();
    } else if (ambientEnabled) {
        applyAmbient();
    }
});

// ПРИЕМ СООБЩЕНИЙ
socket.on('receive_msg', (data) => {
    // --- СИСТЕМНОЕ СООБЩЕНИЕ (смена ника и т.п.) ---
    if (data.isSystem) {
        showSystemMsg(data.text);
        return;
    }

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');

    // Присваиваем ID — по нему будем скроллить при клике на цитату
    if (data.messageId) {
        msgDiv.dataset.messageId = data.messageId;
    }

    const isMe = data.senderId === myId;

    if (isMe) {
        msgDiv.classList.add('outgoing');
    } else {
        msgDiv.classList.add('incoming');
    }

    // --- ЦИТАТА (если это ответ) ---
    let replyHtml = '';
    if (data.replyTo && data.replyTo.messageId) {
        const quotePreview = String(data.replyTo.preview || '').slice(0, 80);
        const quoteUsername = data.replyTo.username || 'Кто-то';
        replyHtml = `
            <div class="msg-reply-quote" data-target-id="${data.replyTo.messageId}">
                <span class="reply-quote-username">↩️ ${quoteUsername}</span>
                <span class="reply-quote-text">${quotePreview}</span>
            </div>
        `;
    }

    // --- ТЕЛО СООБЩЕНИЯ ---
    let bodyHtml = '';
const actionsHtml = (!isMe && !data.isPrivate && data.messageId)
    ? `<div class="msg-actions">
           <button class="msg-action-btn msg-reply-btn" type="button" title="Ответить">↩️</button>
           ${data.senderSessionKey ? `<button class="msg-action-btn msg-invite-btn" type="button" title="Позвать в приват">🎯</button>` : ''}
       </div>`
    : '';

if (isMe) {
    bodyHtml = `<div class="msg-body">${actionsHtml}<p>${data.text}</p></div>`;
} else {
    bodyHtml = `
        <div class="msg-body">
            ${actionsHtml}
            <span class="username">${data.username}</span>
            <p>${data.text}</p>
        </div>
    `;
}

msgDiv.innerHTML = replyHtml + bodyHtml;

    // --- ОБРАБОТЧИК КЛИКА ПО КНОПКЕ REPLY ---
    const replyBtn = msgDiv.querySelector('.msg-reply-btn');
    if (replyBtn) {
        replyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setReplyTarget(
                data.messageId,
                data.username,
                data.text
            );
        });
    }

    // --- ОБРАБОТЧИК КЛИКА ПО КНОПКЕ "ПОЗВАТЬ В ПРИВАТ" ---
const inviteBtn = msgDiv.querySelector('.msg-invite-btn');
if (inviteBtn && data.senderSessionKey) {
    inviteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('invite_private', { targetSessionKey: data.senderSessionKey });
    });
}

    // --- ОБРАБОТЧИК КЛИКА ПО ЦИТАТЕ (скролл к оригиналу) ---
    const quoteEl = msgDiv.querySelector('.msg-reply-quote');
    if (quoteEl) {
        quoteEl.addEventListener('click', () => {
            const targetId = quoteEl.dataset.targetId;
            if (!targetId) return;
            const targetMsg = document.querySelector(`[data-message-id="${targetId}"]`);
            if (!targetMsg) return; // оригинала нет в DOM — тихо выходим

            targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetMsg.classList.add('highlight-msg');
            setTimeout(() => {
                targetMsg.classList.remove('highlight-msg');
            }, 1200);
        });
    }

    // --- ЗВУКИ ---
    if (isMe) {
        soundOutgoing.currentTime = 0;
        soundOutgoing.play().catch(err => console.log(err));
    } else {
        soundIncoming.currentTime = 0;
        soundIncoming.play().catch(err => console.log(err));
    }

    // --- ВСТАВКА В НУЖНОЕ ОКНО ---
    if (data.isPrivate) {
        privateMessagesBox.appendChild(msgDiv);
        privateMessagesBox.scrollTop = privateMessagesBox.scrollHeight;
    } else {
        generalMessagesBox.appendChild(msgDiv);
        generalMessagesBox.scrollTop = generalMessagesBox.scrollHeight;
    }
});

socket.on('private_found', (data) => {
    // Если мы уже в привате — оставляем. Иначе переключаем UI.
    if (currentMode !== 'private') {
        switchToPrivateModeUI();
    }
    currentMode = 'private';
    chatTitle.textContent = `🎯 Разговор по душам с: ${data.opponent}`;
    privateMessagesBox.innerHTML = '<div class="system-msg">Собеседник найден! Можно перетирать за жизнь.</div>';
    showPrivateControls();
});

socket.on('waiting', () => {
    chatTitle.textContent = "🔍 В очереди в гараж...";
});

// --- ПРИЁМ "СКУФ ПЕЧАТАЕТ..." ---
let typingHideTimer = null;

socket.on('partner_typing', (data) => {
    if (!typingIndicator) return;

    // Показываем индикатор с ником
    typingIndicator.textContent = `✍️ ${data.username} печатает...`;
    typingIndicator.classList.add('visible');

    // Сбрасываем таймер скрытия и запускаем заново
    if (typingHideTimer) clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(() => {
        typingIndicator.classList.remove('visible');
        typingIndicator.textContent = '';
    }, 2000);
});

// СЕРВЕР ПРИТОРМОЗИЛ СООБЩЕНИЕ ИЗ-ЗА СПАМА
socket.on('rate_limited', () => {
    const warn = document.createElement('div');
    warn.className = 'system-msg';
    warn.textContent = '🍺 Э, тормози, скуф! Дай другим написать.';
    
    // Куда добавлять — в зависимости от текущего режима
    if (currentMode === 'private') {
        privateMessagesBox.appendChild(warn);
        privateMessagesBox.scrollTop = privateMessagesBox.scrollHeight;
    } else {
        generalMessagesBox.appendChild(warn);
        generalMessagesBox.scrollTop = generalMessagesBox.scrollHeight;
    }
});

// СЕРВЕР ЗАБЛОКИРОВАЛ СООБЩЕНИЕ (реклама или повторы)
socket.on('msg_blocked', (data) => {
    const warn = document.createElement('div');
    warn.className = 'system-msg';

    if (data.reason === 'ads') {
        warn.textContent = '🚫 Реклама тут не в почёте, скуф. Без ссылок и казино.';
    } else if (data.reason === 'repeat') {
        warn.textContent = '🍺 Хватит повторять одно и то же, скуф!';
    } else {
        warn.textContent = '🚫 Сообщение заблокировано.';
    }

    // Куда добавлять — в зависимости от текущего режима
    if (currentMode === 'private') {
        privateMessagesBox.appendChild(warn);
        privateMessagesBox.scrollTop = privateMessagesBox.scrollHeight;
    } else {
        generalMessagesBox.appendChild(warn);
        generalMessagesBox.scrollTop = generalMessagesBox.scrollHeight;
    }
});

// СЕРВЕР ОТКЛОНИЛ СМЕНУ НИКА
socket.on('nick_error', (data) => {
    const reasons = {
        too_short: '🍺 Ник слишком короткий — минимум 2 символа.',
        too_long: '🍺 Ник слишком длинный — максимум 20 символов.',
        bad_chars: '🍺 В нике можно только буквы, цифры, пробел, дефис и _.',
        ads: '🚫 Реклама в нике не пройдёт, скуф.',
        bad_type: '🍺 Что-то не так с ником. Попробуй ещё раз.',
        // Ошибки донат-кодов
        code_bad_format: '🍺 Код должен быть в формате SKUF-XXXX (4 символа).',
        code_not_found: '🚫 Такого кода нет. Проверь, не опечатался ли.',
        code_already_used: '🚫 Этот код уже использован. Один код — одна смена ника.'
    };
    showSystemMsg(reasons[data.reason] || '🚫 Ник не подошёл.');
});

// ============================================================
// ПРИГЛАШЕНИЕ В ПРИВАТ (v1.20.0)
// ============================================================

// --- ВХОДЯЩЕЕ ПРИГЛАШЕНИЕ ---
socket.on('private_invite', ({ fromUsername }) => {
    showPrivateInviteBar(fromUsername);
});

// --- ПРИГЛАШЕНИЕ ОТПРАВЛЕНО (подтверждение отправителю) ---
socket.on('invite_sent', ({ toUsername }) => {
    showSystemMsg(`🎯 Приглашение отправлено скуфу: ${toUsername}`);
});

// --- ТЕБЕ ОТКАЗАЛИ ---
socket.on('private_invite_declined', ({ byUsername }) => {
    showSystemMsg(`🚫 ${byUsername} отказался от разговора.`);
});

// --- ОШИБКА ПРИГЛАШЕНИЯ ---
socket.on('invite_error', ({ reason }) => {
    const reasons = {
        offline: '🚫 Скуф уже ушёл. Попробуй позже.',
        busy: '🚫 Скуф занят — уже в привате с кем-то.',
        too_often: '🍺 Э, не части! Подожди немного.',
        self: '🍺 Себе приглашение не отправишь, скуф.',
        bad_request: '🚫 Что-то не так с приглашением.'
    };
    showSystemMsg(reasons[reason] || '🚫 Приглашение не ушло.');
});

// --- ПРИНЯТИЕ ПРИГЛАШЕНИЯ (после согласия собеседника) ---
// Когда оба согласны — сервер шлёт private_found обоим.
// Этот обработчик уже есть выше (в логике рулетки) — ничего дополнительно не надо.

// --- UI: плашка приглашения внизу ---
function showPrivateInviteBar(fromUsername) {
    // Если плашка уже открыта — сначала убираем старую
    hidePrivateInviteBar();

    const bar = document.getElementById('privateInviteBar');
    const text = document.getElementById('privateInviteText');
    if (!bar || !text) return;

    text.textContent = `${fromUsername} зовёт перетереть в привате`;

    // Кнопки
    const acceptBtn = document.getElementById('inviteAcceptBtn');
    const declineBtn = document.getElementById('inviteDeclineBtn');

    // Обработчики (сначала снимаем старые, потом вешаем новые — на случай повторных приглашений)
    const onAccept = () => {
        socket.emit('private_invite_response', { accepted: true });
        hidePrivateInviteBar();
    };
    const onDecline = () => {
        socket.emit('private_invite_response', { accepted: false });
        hidePrivateInviteBar();
    };

    // Заменяем кнопки-клоны, чтобы не накапливались обработчики
    if (acceptBtn) {
        const fresh = acceptBtn.cloneNode(true);
        acceptBtn.replaceWith(fresh);
        fresh.addEventListener('click', onAccept);
    }
    if (declineBtn) {
        const fresh = declineBtn.cloneNode(true);
        declineBtn.replaceWith(fresh);
        fresh.addEventListener('click', onDecline);
    }

    bar.classList.remove('hidden');

    // Автоскрытие через 30 секунд (если юзер не ответил)
    if (window.__inviteTimeoutId) clearTimeout(window.__inviteTimeoutId);
    window.__inviteTimeoutId = setTimeout(() => {
        if (!bar.classList.contains('hidden')) {
            // Автоматически отклоняем
            socket.emit('private_invite_response', { accepted: false });
            hidePrivateInviteBar();
        }
    }, 30000);
}

function hidePrivateInviteBar() {
    const bar = document.getElementById('privateInviteBar');
    if (bar) bar.classList.add('hidden');
    if (window.__inviteTimeoutId) {
        clearTimeout(window.__inviteTimeoutId);
        window.__inviteTimeoutId = null;
    }
}

// Собеседник отключился — ТЕПЕРЬ ВСЁ СРАБОТАЕТ ЧЁТКО!
socket.on('partner_disconnected', () => {
    privateMessagesBox.innerHTML += '<div class="system-msg">Собеседник ушел смотреть футбол. Чат завершен.</div>';
    
    // Мягко эмулируем клик по работающей кнопке флудилки через 3 секунды
    setTimeout(() => {
        if (currentMode === 'private') {
            btnGeneral.click(); 
        }
    }, 3000);
});
