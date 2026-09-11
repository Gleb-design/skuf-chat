const socket = io();

let myId = null;
let myUsername = null;
let currentMode = 'general'; 
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

const generalMessagesBox = document.getElementById('generalMessagesBox');
const privateMessagesBox = document.getElementById('privateMessagesBox');
const chatArea = document.querySelector('.chat-area');
const messagesWrapper = document.querySelector('.messages-wrapper');
// СРАЗУ навешиваем курилку на .messages-wrapper, ДО вставки декораций,
// чтобы при загрузке ничего не мигнуло
if (messagesWrapper) messagesWrapper.classList.add('theme-general');

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

    // Курилочные декорации (2 дыма)
    const generalDecor = ['lamp1', 'lamp2', 'lamp3', 'smoke', 'smoke2', 'table'];
    generalDecor.forEach((name) => {
        const el = document.createElement('div');
        el.className = `skuf-decor ${name}`;
        messagesWrapper.appendChild(el);
    });

    // Приватные декорации (2 дыма)
    const privateDecor = ['bar-counter', 'bottle1', 'bottle2', 'glass', 'smoke-p1', 'smoke-p2'];
    privateDecor.forEach((name) => {
        const el = document.createElement('div');
        el.className = `skuf-decor ${name}`;
        messagesWrapper.appendChild(el);
    });
}
addAllDecor();


const privateControls = document.getElementById('privateControls');
const btnNextSkuf = document.getElementById('btnNextSkuf');
const btnCancelSearch = document.getElementById('btnCancelSearch');
const onlineCounter = document.getElementById('onlineCounter');
const typingIndicator = document.getElementById('typingIndicator');

socket.on('init_user', (data) => {
    myId = data.id;
    myUsername = data.username;
    myUsernameDisplay.textContent = myUsername;
});

// Счётчик онлайн — обновляем число в шапке
socket.on('online_count', (count) => {
    if (onlineCounter) {
        onlineCounter.innerHTML = `🍺 Сейчас в гараже: <strong>${count}</strong>`;
    }
});

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

    if (currentMode === 'general') {
        socket.emit('send_global_msg', text);
    } else if (currentMode === 'private') {
        socket.emit('send_private_msg', text);
    }
    messageInput.value = '';
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

// ПРИЕМ СООБЩЕНИЙ
socket.on('receive_msg', (data) => {
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
