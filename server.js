const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

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

// --- НОВОЕ: ХРАНИЛИЩЕ ИСТОРИИ ФЛУДИЛКИ ---
let globalMessagesHistory = []; 

// Функция для очистки сообщений старше 24 часов
function cleanOldMessages() {
    const now = Date.now();
    const oneDayInMs = 24 * 60 * 60 * 1000;
    // Оставляем только те сообщения, которые были отправлены меньше суток назад
    globalMessagesHistory = globalMessagesHistory.filter(msg => (now - msg.timestamp) < oneDayInMs);
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

    // НОВОЕ: Как только скуф вошел, отправляем ему всю сохраненную историю за сутки
    // Перед отправкой на всякий случай чистим массив от просроченных сообщений
    cleanOldMessages();
    globalMessagesHistory.forEach((msg) => {
        socket.emit('receive_msg', {
            senderId: msg.senderId,
            username: msg.username,
            text: msg.text,
            isPrivate: false
        });
    });

    // 1. Логика общей флудилки (Обновлено!)
        socket.on('send_global_msg', (text) => {
        // Проверяем rate limit
        if (isRateLimited(socket)) {
            socket.emit('rate_limited');
            return;
        }

        const messageData = {
            senderId: socket.id,
            username: socket.username,
            text: text,
            isPrivate: false,
            timestamp: Date.now() // Запоминаем точное время отправки
        };

        // Сохраняем сообщение в историю сервера
        globalMessagesHistory.push(messageData);

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