const socket = io();

// Переменные для хранения данных текущего пользователя
let myId = null;
let myUsername = null;
let currentMode = 'general'; 

// Элементы интерфейса
const btnGeneral = document.getElementById('btnGeneral');
const btnPrivate = document.getElementById('btnPrivate');
const chatTitle = document.getElementById('chatTitle');
const messagesBox = document.getElementById('messagesBox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const myUsernameDisplay = document.getElementById('myUsername');

// Новое: получаем личные данные от сервера при старте
socket.on('init_user', (data) => {
    myId = data.id;
    myUsername = data.username;
    myUsernameDisplay.textContent = myUsername;
});

// Клик по кнопке "Общая флудилка"
btnGeneral.addEventListener('click', () => {
    if (currentMode === 'general') return;
    location.reload(); 
});

// Клик по кнопке "Поиск скуфа"
btnPrivate.addEventListener('click', () => {
    if (currentMode !== 'general') return;
    
    currentMode = 'searching';
    btnGeneral.classList.remove('active');
    btnPrivate.classList.add('active');
    chatTitle.textContent = "🔍 Ищем свободного мужика для беседы...";
    messagesBox.innerHTML = '<div class="system-msg">Поиск собеседника... Налейте пока квасу.</div>';
    
    socket.emit('search_private');
});

// Обработка отправки сообщения
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

// Прием сообщений от сервера (Исправлено!)
socket.on('receive_msg', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    
    // Проверяем: если senderId совпадает с моим myId, то это наше сообщение
    const isMe = data.senderId === myId;
    
    if (isMe) {
        msgDiv.classList.add('outgoing'); // Синее сообщение справа
        msgDiv.innerHTML = `
            <div class="msg-body">
                <p>${data.text}</p>
            </div>
        `;
    } else {
        msgDiv.classList.add('incoming'); // Серое сообщение слева с именем автора
        msgDiv.innerHTML = `
            <div class="msg-body">
                <span class="username">${data.username}</span>
                <p>${data.text}</p>
            </div>
        `;
    }
    
    messagesBox.appendChild(msgDiv);
    messagesBox.scrollTop = messagesBox.scrollHeight; 
});

// Собеседник в рулетке нашелся
socket.on('private_found', (data) => {
    currentMode = 'private';
    chatTitle.textContent = `🎯 Разговор по душам с: ${data.opponent}`;
    messagesBox.innerHTML = '<div class="system-msg">Собеседник найден! Можно перетирать за жизнь.</div>';
});

// Ожидание в очереди
socket.on('waiting', () => {
    chatTitle.textContent = "🔍 В очереди в гараж...";
});

// Собеседник отключился
socket.on('partner_disconnected', () => {
    messagesBox.innerHTML += '<div class="system-msg">Собеседник ушел смотреть футбол. Чат завершен.</div>';
    currentMode = 'general';
});
