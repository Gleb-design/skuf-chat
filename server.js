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
    const name = skufNames[Math.floor(Math.random() * skufNames.length)];
    const status = skufStatus[Math.floor(Math.random() * skufStatus.length)];
    const emoji = skufEmojis[Math.floor(Math.random() * skufEmojis.length)];
    
    socket.username = `${emoji} ${name} (${status})`;
    socket.emit('init_user', { id: socket.id, username: socket.username });
    
    // При подключении — сразу во флудилку
    socket.join('general');

    // 1. Логика общей флудилки
    socket.on('send_global_msg', (text) => {
        io.to('general').emit('receive_msg', {
            senderId: socket.id,
            username: socket.username,
            text: text,
            isPrivate: false // Важная пометка для клиента!
        });
    });

    // 2. Логика поиска 1 на 1
    socket.on('search_private', () => {
        socket.leave('general'); // Уходим из флудилки

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
        if (socket.privateRoom) {
            io.to(socket.privateRoom).emit('receive_msg', {
                senderId: socket.id,
                username: socket.username,
                text: text,
                isPrivate: true // Важная пометка для клиента!
            });
        }
    });

    // Новое: Выход из привата обратно во флудилку
    socket.on('leave_private', () => {
        if (waitingSkuf === socket) waitingSkuf = null;
        
        if (socket.privateRoom) {
            socket.to(socket.privateRoom).emit('partner_disconnected');
            socket.leave(socket.privateRoom);
            socket.privateRoom = null;
        }
        socket.join('general'); // Возвращаем в общий гараж
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
