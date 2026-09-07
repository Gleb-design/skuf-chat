const socket = io();

let myId = null;
let myUsername = null;
let currentMode = 'general'; 

const btnGeneral = document.getElementById('btnGeneral');
const btnPrivate = document.getElementById('btnPrivate');
const chatTitle = document.getElementById('chatTitle');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const myUsernameDisplay = document.getElementById('myUsername');

const generalMessagesBox = document.getElementById('generalMessagesBox');
const privateMessagesBox = document.getElementById('privateMessagesBox');

socket.on('init_user', (data) => {
    myId = data.id;
    myUsername = data.username;
    myUsernameDisplay.textContent = myUsername;
});

// КЛИК: Переключение на ОБЩУЮ ФЛУДИЛКУ
btnGeneral.addEventListener('click', () => {
    if (currentMode === 'general') return;
    
    currentMode = 'general';
    btnPrivate.classList.remove('active');
    btnGeneral.classList.add('active');
    chatTitle.textContent = "📢 Общая флудилка (Скуф-Курилка)";
    
    generalMessagesBox.classList.remove('hidden');
    privateMessagesBox.classList.add('hidden');
    
    // Сообщаем серверу, что ушли из приватных дел во флудилку
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

// ПРИЕМ СООБЩЕНИЙ (Теперь работает железно!)
socket.on('receive_msg', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    
    const isMe = data.senderId === myId;
    
    if (isMe) {
        msgDiv.classList.add('outgoing');
        msgDiv.innerHTML = `
            <div class="msg-body">
                <p>${data.text}</p>
            </div>
        `;
    } else {
        msgDiv.classList.add('incoming');
        msgDiv.innerHTML = `
            <div class="msg-body">
                <span class="username">${data.username}</span>
                <p>${data.text}</p>
            </div>
        `;
    }
    
    // Смотрим на метку от сервера: куда положить сообщение?
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
});

socket.on('waiting', () => {
    chatTitle.textContent = "🔍 В очереди в гараж...";
});

socket.on('partner_disconnected', () => {
    privateMessagesBox.innerHTML += '<div class="system-msg">Собеседник ушел смотреть футбол. Чат завершен.</div>';
    currentMode = 'general';
    
    setTimeout(() => {
        if (currentMode === 'general') {
            btnGeneral.click();
        }
    }, 3000);
});
