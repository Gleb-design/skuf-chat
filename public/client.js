const socket = io();

let myId = null;
let myUsername = null;
let currentMode = 'general'; 

// --- ЗВУКОВОЙ ДВИЖОК ---
const soundOutgoing = new Audio('https://soundjay.com'); 
const soundIncoming = new Audio('https://soundjay.com'); 
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

const privateControls = document.getElementById('privateControls');
const btnNextSkuf = document.getElementById('btnNextSkuf');
const btnCancelSearch = document.getElementById('btnCancelSearch');

socket.on('init_user', (data) => {
    myId = data.id;
    myUsername = data.username;
    myUsernameDisplay.textContent = myUsername;
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

// --- ПОКАЗ/СКРЫТИЕ КНОПОК ПРИВАТНОГО ЧАТА ---
function showPrivateControls() {
    privateControls.classList.remove('hidden');
}
function hidePrivateControls() {
    privateControls.classList.add('hidden');
}

// --- КНОПКА "СЛЕДУЮЩИЙ СКУФ" ---
btnNextSkuf.addEventListener('click', () => {
    // Сообщаем серверу: отпустить текущего собеседника
    socket.emit('leave_private');

    // Переводим UI в режим поиска
    currentMode = 'searching';
    chatTitle.textContent = "🔍 Ищем свободного мужика для беседы...";
    privateMessagesBox.innerHTML = '<div class="system-msg">Меняем скуфа... Налейте пока квасу.</div>';

    // Встаём в очередь заново
    socket.emit('search_private');
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
