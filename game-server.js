// ========================================================
// game-server.js — универсальный роутер игр
// ========================================================
// Вызывается из server.js через initGame(io, deps).
// Сам подписывается на io.on('connection') и регистрирует
// игровые события (с префиксом game_).
//
// Архитектура:
//   - Роутер знает ПРО ВСЕ игры (GAMES), но не знает ИХ ПРАВИЛ.
//   - Каждая игра — модуль (games/*.js) с контрактом:
//     id, name, minPlayers, maxPlayers, createInitialState,
//     handleAction, isFinished, serializeFor.
//   - Модуль возвращает события — роутер их рассылает.
//
// deps:
//   - sessionsByKey: Map<sessionKey, socket> — есть в server.js
//   - findSocketBySessionKey(sessionKey): socket | null — есть в server.js
//
// Все игры хранятся в RAM (Map). Улетают при рестарте Render.
// ========================================================

// ========================================================
// ИМПОРТ МОДУЛЕЙ ИГР
// ========================================================
// Пока одна игра (battleship). Меню выбора — в будущем.
const GAMES = {
    battleship: require('./games/battleship'),
    domino: require('./games/domino'),
};

module.exports = function initGame(io, deps) {
    const { sessionsByKey, findSocketBySessionKey } = deps;

    // ========================================================
    // КОНСТАНТЫ
    // ========================================================
    const IDLE_TIMEOUT_MS = 60 * 1000;      // 60 сек на ход
    const RECONNECT_GRACE_MS = 20 * 1000;   // 20 сек на возврат после отвала

    // ========================================================
    // ХРАНИЛИЩЕ
    // ========================================================
    // Map<gameId, GameState>
    const games = new Map();

    // Map<socketId, gameId> — быстрый поиск игры по сокету
    const socketToGame = new Map();

    // Map<sessionKey, { game, leaverKey, timer }> — кто ждёт reconnect
    const pendingReconnects = new Map();

    // ========================================================
    // УТИЛИТЫ РОУТЕРА
    // ========================================================

    // Генерирует уникальный gameId
    function generateGameId() {
        return `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    // Находит партнёра игрока в его комнате привата
    function findPartnerSocket(socket) {
        if (!socket.privateRoom) return null;
        const roomSockets = io.sockets.adapter.rooms.get(socket.privateRoom);
        if (!roomSockets) return null;

        for (const otherId of roomSockets) {
            if (otherId !== socket.id) {
                return io.sockets.sockets.get(otherId) || null;
            }
        }
        return null;
    }

    // Рассылает события от модуля игры
    // events: [{ to: 'self' | 'opponent' | 'both' | 'player1' | 'player2', event, data }]
    function dispatchEvents(game, actingPlayerKey, events) {
        if (!events || !events.length) return;
        const opponentKey = actingPlayerKey === 'player1' ? 'player2' : 'player1';

        for (const ev of events) {
            if (!ev || !ev.event) continue;

            if (ev.to === 'both') {
                io.to(game.player1.socketId).emit(ev.event, ev.data);
                io.to(game.player2.socketId).emit(ev.event, ev.data);
                continue;
            }

            let targetKey = null;
            if (ev.to === 'self') targetKey = actingPlayerKey;
            else if (ev.to === 'opponent') targetKey = opponentKey;
            else if (ev.to === 'player1') targetKey = 'player1';
            else if (ev.to === 'player2') targetKey = 'player2';

            if (targetKey && game[targetKey]) {
                io.to(game[targetKey].socketId).emit(ev.event, ev.data);
            }
        }
    }

    // Завершает игру
    function endGame(game, winnerKey, reason) {
        if (game.phase === 'finished') return;
        game.phase = 'finished';
        game.winner = winnerKey;

        if (game.idleTimer) {
            clearTimeout(game.idleTimer);
            game.idleTimer = null;
        }

        const players = [game.player1, game.player2];
        for (const p of players) {
            const winnerSocket = winnerKey === 'player1' ? game.player1 : game.player2;
            const isWinner = winnerSocket.socketId === p.socketId;

            io.to(p.socketId).emit('game_finished', {
                gameId: game.id,
                winner: isWinner ? 'you' : 'opponent',
                reason: reason, // 'win' | 'idle' | 'disconnect' | 'leave'
            });

            socketToGame.delete(p.socketId);
        }

        setTimeout(() => games.delete(game.id), 60 * 1000);
    }

    // Сбрасывает таймер бездействия (60 сек на ход)
    function resetIdleTimer(game) {
        if (game.idleTimer) clearTimeout(game.idleTimer);

        game.idleTimer = setTimeout(() => {
            // Определяем, чей ход НЕ был сделан
            // ⚠️ Для этого нужен доступ к состоянию игры — берём из game.state.turn
            const state = game.state;
            let loserKey = state.turn;   // 'player1' | 'player2'
            if (!loserKey) {
                // fallback: если state.turn не установлен — считаем player1
                loserKey = 'player1';
            }
            const winnerKey = loserKey === 'player1' ? 'player2' : 'player1';
            endGame(game, winnerKey, 'idle');
        }, IDLE_TIMEOUT_MS);
    }

    // ========================================================
    // SOCKET-СОБЫТИЯ
    // ========================================================
    io.on('connection', (socket) => {

        // --- ПРИГЛАШЕНИЕ В ИГРУ (из привата 1-на-1) ---
        socket.on('game_invite', () => {
            if (!socket.privateRoom) {
                socket.emit('game_error', { reason: 'not_in_private' });
                return;
            }
            if (socketToGame.has(socket.id)) {
                socket.emit('game_error', { reason: 'already_in_game' });
                return;
            }

            const partner = findPartnerSocket(socket);
            if (!partner) {
                socket.emit('game_error', { reason: 'no_partner' });
                return;
            }
            if (socketToGame.has(partner.id)) {
                socket.emit('game_error', { reason: 'partner_busy' });
                return;
            }

            // ⚠️ ХАРДКОД: пока игра всегда battleship.
            // Меню выбора игр — в будущем (клиент пришлёт gameType).
            const gameModule = GAMES.battleship;
            if (!gameModule) {
                socket.emit('game_error', { reason: 'unknown_game' });
                return;
            }

            const gameId = generateGameId();

            const player1 = {
                socketId: socket.id,
                username: socket.username,
                sessionKey: socket.sessionKey || null,
            };
            const player2 = {
                socketId: partner.id,
                username: partner.username,
                sessionKey: partner.sessionKey || null,
            };

            const game = {
                id: gameId,
                type: gameModule.id,          // 'battleship'
                module: gameModule,           // ссылка на модуль
                player1,
                player2,
                state: gameModule.createInitialState(player1, player2),  // состояние от модуля
                phase: 'waiting',             // waiting | placing | battle | finished
                winner: null,
                idleTimer: null,
                createdAt: Date.now(),
            };

            games.set(gameId, game);
            socketToGame.set(socket.id, gameId);
            socketToGame.set(partner.id, gameId);

            // Отправляем приглашение партнёру
            partner.emit('game_invited', {
                gameId,
                fromUsername: socket.username,
            });

            // Подтверждение отправителю
            socket.emit('game_invite_sent', {
                gameId,
                toUsername: partner.username,
            });
        });

        // --- ВОЗВРАТ ИГРОКА В ИГРУ ПОСЛЕ ОБРЫВА ---
        socket.on('init_session', ({ sessionKey }) => {
            if (!sessionKey) return;
            if (!pendingReconnects.has(sessionKey)) return;

            const { game, leaverKey, timer } = pendingReconnects.get(sessionKey);
            clearTimeout(timer);
            pendingReconnects.delete(sessionKey);

            // Обновляем socketId в игре
            game[leaverKey].socketId = socket.id;
            socketToGame.set(socket.id, game.id);

            // Переподключаем к комнате
            const otherKey = leaverKey === 'player1' ? 'player2' : 'player1';
            const roomId = `room_${game.player1.socketId}_${game.player2.socketId}`;
            socket.join(roomId);

            console.log(`✅ Игрок ${leaverKey} вернулся в игру ${game.id}`);

            io.to(game[otherKey].socketId).emit('game_opponent_reconnected');
            socket.emit('game_reconnected');
        });

        // --- ПРИНЯТЬ ПРИГЛАШЕНИЕ ---
        socket.on('game_accept', ({ gameId } = {}) => {
            const game = games.get(gameId);
            if (!game) {
                socket.emit('game_error', { reason: 'game_not_found' });
                return;
            }
            if (game.player1.socketId !== socket.id && game.player2.socketId !== socket.id) {
                socket.emit('game_error', { reason: 'not_a_player' });
                return;
            }
            if (game.phase !== 'waiting') {
                socket.emit('game_error', { reason: 'wrong_phase' });
                return;
            }

            game.phase = 'placing';

            io.to(game.player1.socketId).emit('game_placing', { gameId });
            io.to(game.player2.socketId).emit('game_placing', { gameId });
        });

        // --- ОТКЛОНИТЬ ПРИГЛАШЕНИЕ ---
        socket.on('game_decline', ({ gameId } = {}) => {
            const game = games.get(gameId);
            if (!game) return;

            const otherKey = game.player1.socketId === socket.id ? 'player2' : 'player1';
            const otherSocketId = game[otherKey].socketId;

            io.to(otherSocketId).emit('game_declined', {
                byUsername: socket.username,
            });

            socketToGame.delete(game.player1.socketId);
            socketToGame.delete(game.player2.socketId);
            games.delete(gameId);
        });

        // --- РАССТАНОВКА КОРАБЛЕЙ (универсальный обработчик действий) ---
        socket.on('game_place_ships', ({ gameId, board, random } = {}) => {
            const game = games.get(gameId);
            if (!game) {
                socket.emit('game_error', { reason: 'game_not_found' });
                return;
            }

            const playerKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            if (!playerKey) {
                socket.emit('game_error', { reason: 'not_a_player' });
                return;
            }

            // Вызываем модуль
            const result = game.module.handleAction(game, playerKey, 'place_ships', { board, random });
            if (!result.ok) {
                socket.emit('game_error', { reason: result.error });
                return;
            }

            // Рассылаем события
            dispatchEvents(game, playerKey, result.events);

            // Синхронизируем phase роутера с phase модуля
            game.phase = game.state.phase;

            // Если игра началась — сбросить idle timer
            if (game.phase === 'battle') {
                resetIdleTimer(game);
            }
        });

        // --- ВЫСТРЕЛ (универсальный обработчик действий) ---
        socket.on('game_shot', ({ gameId, x, y } = {}) => {
            const game = games.get(gameId);
            if (!game) {
                socket.emit('game_error', { reason: 'game_not_found' });
                return;
            }

            const playerKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            if (!playerKey) {
                socket.emit('game_error', { reason: 'not_a_player' });
                return;
            }

            // Вызываем модуль
            const result = game.module.handleAction(game, playerKey, 'shot', { x, y });
            if (!result.ok) {
                socket.emit('game_error', { reason: result.error });
                return;
            }

            // Рассылаем события
            dispatchEvents(game, playerKey, result.events);

            // Если игра закончилась
            if (result.finished) {
                endGame(game, result.winner, result.reason);
                return;
            }

            // Иначе — сбросить idle timer
            resetIdleTimer(game);
        });

        // --- МИНИ-ЧАТ ВО ВРЕМЯ ИГРЫ ---
        socket.on('game_chat', ({ gameId, text } = {}) => {
            const game = games.get(gameId);
            if (!game) return;

            const playerKey = game.player1.socketId === socket.id ? 'player1'
                            : game.player2.socketId === socket.id ? 'player2'
                            : null;
            if (!playerKey) return;

            if (game.phase === 'finished') return;

            const trimmed = String(text || '').trim().slice(0, 200);
            if (!trimmed) return;

            const payload = {
                gameId,
                from: playerKey,
                fromUsername: socket.username,
                text: trimmed,
                timestamp: Date.now(),
            };

            io.to(game.player1.socketId).emit('game_chat_msg', payload);
            io.to(game.player2.socketId).emit('game_chat_msg', payload);
        });

        // --- ПОКИНУТЬ ИГРУ ---
        socket.on('game_leave', ({ gameId } = {}) => {
            const game = games.get(gameId);
            if (!game) return;

            const leaverKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            const winnerKey = leaverKey === 'player1' ? 'player2' : 'player1';

            endGame(game, winnerKey, 'leave');
        });

        // --- DISCONNECT во время игры ---
        socket.on('disconnect', () => {
            const gameId = socketToGame.get(socket.id);
            if (!gameId) return;

            const game = games.get(gameId);
            if (!game || game.phase === 'finished') {
                socketToGame.delete(socket.id);
                return;
            }

            const leaverKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            const winnerKey = leaverKey === 'player1' ? 'player2' : 'player1';
            const leaverSessionKey = game[leaverKey].sessionKey;

            console.log(`⚠️ Игрок ${leaverKey} отвалился. Ждём ${RECONNECT_GRACE_MS / 1000} сек...`);

            io.to(game[winnerKey].socketId).emit('game_opponent_disconnected', {
                graceMs: RECONNECT_GRACE_MS,
            });

            const timer = setTimeout(() => {
                if (pendingReconnects.has(leaverSessionKey)) {
                    pendingReconnects.delete(leaverSessionKey);
                    endGame(game, winnerKey, 'disconnect');
                    console.log(`❌ Игрок ${leaverKey} не вернулся. Техпоражение.`);
                }
            }, RECONNECT_GRACE_MS);

            if (leaverSessionKey) {
                pendingReconnects.set(leaverSessionKey, { game, leaverKey, timer });
            }
        });
    });

    console.log('🚢 Морской бой: модуль загружен (роутер)');
};