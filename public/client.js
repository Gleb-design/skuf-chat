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
// --- ТЕМА ПО УМОЛЧАНИЮ: КУРИЛКА ---
// При загрузке мы сразу в общей флудилке, значит на generalMessagesBox — тема курилки

// --- ЗВУКОВОЙ ДВИЖОК ---
const soundOutgoing = new Audio('/click.mp3');
const soundIncoming = new Audio('/beer.mp3');
soundOutgoing.volume = 0.3;
soundIncoming.volume = 0.5;

// Элементы интерфейса
const btnGeneral = document.getElementById('btnGeneral');
const btnPrivate = document.getElementById('btnPrivate');
const chatTitle = document.getElementById('chatTitle');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const myUsernameDisplay = document.getElementById('myUsername');
const btnDonate = document.getElementById('btnDonate');

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

// --- ДЕКОРАЦИИ КУРИЛКИ ---
// Вставляем один раз при загрузке. Живут поверх фона, под сообщениями.
// Ссылка на обёртку — нужна для декораций


// --- ДЕКОРАЦИИ: курилка + приват, оба набора сразу ---
// Видимость управляется CSS-классами theme-general / theme-private
function addAllDecor() {
    if (!messagesWrapper) return;
    if (messagesWrapper.querySelector('.skuf-decor')) return;

    // Курилочные декорации (2 дыма + телевизор + свечение от него)
    const generalDecor = ['lamp1', 'lamp2', 'lamp3', 'smoke', 'smoke2', 'table', 'tv-antenna', 'tv', 'tv-glow'];
    generalDecor.forEach((name) => {
        const el = document.createElement('div');
        el.className = `skuf-decor ${name}`;
        messagesWrapper.appendChild(el);
    });

    // Приватные декорации (2 дыма)
    const privateDecor = ['bar-counter', 'bottle1', 'bottle2', 'glass', 'cat', 'smoke-p1', 'smoke-p2'];
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
const statsMessages = document.getElementById('statsMessages');
const statsUsers = document.getElementById('statsUsers');
const statsPeak = document.getElementById('statsPeak');

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
    socket.emit('get_stats');
}

setInterval(requestStats, 60 * 1000);

// КЛИК: Переключение на ОБЩУЮ ФЛУДИЛКУ (БЕЗ БЛОКИРОВОК!)
    btnGeneral.addEventListener('click', () => {
    // Меняем режим на общий
    currentMode = 'general';
    
    // Переключаем визуальный фокус на кнопках
    btnPrivate.classList.remove('active');
    btnGeneral.classList.add('active');
    chatTitle.textContent = "📢 Общая флудилка (Скуф-Курилка)";
    
    // Показываем коробку флудилки, скрываем приват
    generalMessagesBox.classList.remove('hidden');
    privateMessagesBox.classList.add('hidden');

    // Переключаем тему: курилка (на .chat-area и .messages-wrapper)
    chatArea.classList.add('theme-general');
    chatArea.classList.remove('theme-private');
    messagesWrapper.classList.add('theme-general');
    messagesWrapper.classList.remove('theme-private');
    
    // Даем команду серверу вернуть нас в общую комнату
    hidePrivateControls();
    socket.emit('leave_private');
});

// КЛИК: Переключение на ПОИСК СКУФА
    btnPrivate.addEventListener('click', () => {
    if (currentMode !== 'general') return;
    
    currentMode = 'searching';
    btnGeneral.classList.remove('active');
    btnPrivate.classList.add('active');
    chatTitle.textContent = "🔍 Ищем свободного мужика для беседы...";
    
    generalMessagesBox.classList.add('hidden');
    privateMessagesBox.classList.remove('hidden');
    privateMessagesBox.style.display = 'flex';

    // Переключаем тему: ламповый угол (на .chat-area и .messages-wrapper)
    chatArea.classList.add('theme-private');
    chatArea.classList.remove('theme-general');
    messagesWrapper.classList.add('theme-private');
    messagesWrapper.classList.remove('theme-general');
    
    privateMessagesBox.innerHTML = '<div class="system-msg">Поиск собеседника... Налейте пока квасу.</div>';

    showPrivateControls();
    socket.emit('search_private');
});

// Отправка сообщений
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    // --- КОМАНДА /nick ---
    if (text.startsWith('/nick ')) {
        const newNick = text.slice(6).trim(); // отрезаем "/nick "
        if (newNick.length === 0) {
            showSystemMsg('🍺 Напиши ник после /nick, например: /nick Вася');
            messageInput.value = '';
            return;
        }
        socket.emit('change_nick', newNick);
        messageInput.value = '';
        return;
    }

    if (currentMode === 'general') {
        socket.emit('send_global_msg', text);
    } else if (currentMode === 'private') {
        socket.emit('send_private_msg', text);
    }
    messageInput.value = '';
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

// --- ОТПРАВКА "СКУФ ПЕЧАТАЕТ..." ПРИ ВВОДЕ ---
let lastTypingSent = 0;
const TYPING_THROTTLE_MS = 1500; // не чаще, чем раз в 1.5 секунды

messageInput.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTypingSent < TYPING_THROTTLE_MS) return;
    lastTypingSent = now;
    socket.emit('typing');
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

// --- ДОНАТ-КНОПКА 🍺 (пока заглушка) ---
if (btnDonate) {
    btnDonate.addEventListener('click', () => {
        alert('🍺 Донат скоро! Готовим ссылку — заходи позже.');
    });
}

// ПРИЕМ СООБЩЕНИЙ
socket.on('receive_msg', (data) => {
    // --- СИСТЕМНОЕ СООБЩЕНИЕ (смена ника и т.п.) ---
    if (data.isSystem) {
        showSystemMsg(data.text);
        return;
    }

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    
    const isMe = data.senderId === myId;
    
    if (isMe) {
        msgDiv.classList.add('outgoing');
        msgDiv.innerHTML = `<div class="msg-body"><p>${data.text}</p></div>`;
        
        soundOutgoing.currentTime = 0;
        soundOutgoing.play().catch(err => console.log(err));
    } else {
        msgDiv.classList.add('incoming');
        msgDiv.innerHTML = `
            <div class="msg-body">
                <span class="username">${data.username}</span>
                <p>${data.text}</p>
            </div>
        `;
        
        soundIncoming.currentTime = 0;
        soundIncoming.play().catch(err => console.log(err));
    }
    
    if (data.isPrivate) {
        privateMessagesBox.appendChild(msgDiv);
        privateMessagesBox.scrollTop = privateMessagesBox.scrollHeight;
    } else {
        generalMessagesBox.appendChild(msgDiv);
        generalMessagesBox.scrollTop = generalMessagesBox.scrollHeight;
    }
});

socket.on('private_found', (data) => {
    currentMode = 'private';
    chatTitle.textContent = `🎯 Разговор по душам с: ${data.opponent}`;
    privateMessagesBox.innerHTML = '<div class="system-msg">Собеседник найден! Можно перетирать за жизнь.</div>';
    showPrivateControls(); // панель остаётся видимой и в активном приватном чате
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
        bad_type: '🍺 Что-то не так с ником. Попробуй ещё раз.'
    };
    showSystemMsg(reasons[data.reason] || '🚫 Ник не подошёл.');
});

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
