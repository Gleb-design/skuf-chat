const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// База данных для генерации истинно скуфских ников
const skufNames = ['Иваныч', 'Михалыч', 'Петрович', 'Саня', 'Толян', 'Серёга', 'Лёха', 'Юрич', 'Валера', 'Димон'];
const skufStatus = ['с завода', 'из гаража', 'на расслабоне', 'Танкист', 'Рыбак', 'с пивком', 'Дальнобой', 'Эксперт', 'у телевизора'];
const skufEmojis = ['🍺', '🛋️', '🚜', '🎣', '🍢', '🎮', '🧢', '🥟', '🔧', '📺'];

let waitingSkuf = null;

io.on('connection', (socket) => {
    // Выбираем случайные элементы из массивов
    const name = skufNames[Math.floor(Math.random() * skufNames.length)];
    const status = skufStatus[Math.floor(Math.random() * skufStatus.length)];
    const emoji = skufEmojis[Math.floor(Math.random() * skufEmojis.length)];
    
    // Собираем всё в один сочный никнейм с эмодзи
    socket.username = `${emoji} ${name} (${status})`;
    
    // Отправляем клиенту его данные
    socket.emit('init_user', { id: socket.id, username: socket.username });
    
    socket.join('general');

    // --- ОСТАЛЬНОЙ КОД НИЖЕ ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ ---
    socket.on('send_global_msg', (text) => {
        io.to('general').emit('receive_msg', {
            senderId: socket.id,
            username: socket.username,
            text: text
        });
    });

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

    socket.on('send_private_msg', (text) => {
        if (socket.privateRoom) {
            io.to(socket.privateRoom).emit('receive_msg', {
                senderId: socket.id,
                username: socket.username,
                text: text
            });
        }
    });

    socket.on('disconnect', () => {
        if (waitingSkuf === socket) waitingSkuf = null;
        if (socket.privateRoom) {
            socket.to(socket.privateRoom).emit('partner_disconnected');
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Гараж открыт! Сервер запущен на http://localhost:${PORT}`);
});
