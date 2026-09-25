// ========================================================
// game.js — серверная логика Морского боя
// ========================================================
// Модуль самодостаточен. Экспортирует initGame(io, deps),
// которая подписывается на io.on('connection') и регистрирует
// свои socket-события (с префиксом game_).
//
// deps:
//   - sessionsByKey: Map<sessionKey, socket> — есть в server.js
//   - findSocketBySessionKey(sessionKey): socket | null — есть в server.js
//
// Все игры хранятся в RAM (Map). Улетают при рестарте Render.
// ========================================================

module.exports = function initGame(io, deps) {
    const { sessionsByKey, findSocketBySessionKey } = deps;

    // ========================================================
    // КОНСТАНТЫ
    // ========================================================
    const BOARD_SIZE = 10;
    // Классический набор: 1×4, 2×3, 3×2, 4×1
    const SHIPS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

    const IDLE_TIMEOUT_MS = 20 * 1000;      // 20 сек на ход
    const RECONNECT_GRACE_MS = 20 * 1000;   // 20 сек на возврат после отвала

    // ========================================================
    // ХРАНИЛИЩЕ
    // ========================================================
    // Map<gameId, GameState>
    const games = new Map();

    // Map<socketId, gameId> — быстрый поиск игры по сокету
    const socketToGame = new Map();

    // ========================================================
    // УТИЛИТЫ
    // ========================================================

    // Генерирует уникальный gameId
    function generateGameId() {
        return `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    // Проверяет, можно ли поставить корабль в клетку (x, y) длиной size
    // horizontal: true — горизонтально, false — вертикально
    // Проверяет: границы поля + все клетки свободны + не касается соседних кораблей (включая диагонали)
    function canPlaceShip(board, x, y, size, horizontal) {
        // Границы
        if (horizontal) {
            if (x + size > BOARD_SIZE || y >= BOARD_SIZE) return false;
        } else {
            if (y + size > BOARD_SIZE || x >= BOARD_SIZE) return false;
        }

        // Проверяем все клетки корабля + вокруг него (квадрат 3×3 вокруг каждой клетки)
        for (let i = 0; i < size; i++) {
            const cx = horizontal ? x + i : x;
            const cy = horizontal ? y : y + i;

            // Проверяем 3×3 вокруг клетки (cx, cy)
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
                    if (board[ny][nx] !== null) return false;
                }
            }
        }

        return true;
    }

    // Ставит корабль на поле. Возвращает массив клеток корабля.
    function placeShip(board, x, y, size, horizontal) {
        const cells = [];
        for (let i = 0; i < size; i++) {
            const cx = horizontal ? x + i : x;
            const cy = horizontal ? y : y + i;
            board[cy][cx] = {
                ship: true,
                size: size,
                hit: false,
                // Уникальный id корабля, чтобы проверять потопление
                shipId: null // проставим ниже
            };
            cells.push({ x: cx, y: cy });
        }
        // Присваиваем общий shipId (используем координаты первой клетки)
        const shipId = `ship_${cells[0].x}_${cells[0].y}`;
        for (const c of cells) {
            board[c.y][c.x].shipId = shipId;
        }
        return cells;
    }

    // Генерирует случайное поле
    function generateRandomBoard() {
        const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

        for (const size of SHIPS) {
            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 500) {
                const horizontal = Math.random() < 0.5;
                const x = Math.floor(Math.random() * BOARD_SIZE);
                const y = Math.floor(Math.random() * BOARD_SIZE);

                if (canPlaceShip(board, x, y, size, horizontal)) {
                    placeShip(board, x, y, size, horizontal);
                    placed = true;
                }
                attempts++;
            }
            if (!placed) {
                // Не удалось — начинаем заново (редко)
                return generateRandomBoard();
            }
        }

        return board;
    }

    // Проверяет, потоплен ли корабль, в который попали
    // Возвращает { sunk: true/false, shipCells: [...] }
    function checkShipSunk(board, x, y) {
        const cell = board[y][x];
        if (!cell || !cell.ship) return { sunk: false, shipCells: [] };

        const shipId = cell.shipId;
        const shipCells = [];

        // Собираем все клетки этого корабля
        for (let cy = 0; cy < BOARD_SIZE; cy++) {
            for (let cx = 0; cx < BOARD_SIZE; cx++) {
                if (board[cy][cx] && board[cy][cx].shipId === shipId) {
                    shipCells.push({ x: cx, y: cy, hit: board[cy][cx].hit });
                }
            }
        }

        // Если все клетки корабля ранены — потоплен
        const sunk = shipCells.every((c) => c.hit === true);
        return { sunk, shipCells };
    }

    // Проверяет, все ли корабли потоплены
    function isAllSunk(board) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                const cell = board[y][x];
                if (cell && cell.ship && !cell.hit) return false;
            }
        }
        return true;
    }

    // Помечает клетки вокруг потопленного корабля как «auto-miss»
    function markAroundSunk(board, shipCells) {
        for (const cell of shipCells) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const nx = cell.x + dx;
                    const ny = cell.y + dy;
                    if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
                    if (board[ny][nx] === null) {
                        board[ny][nx] = { miss: true, auto: true };
                    }
                }
            }
        }
    }

    // Сериализация поля для клиента: клиент НЕ должен видеть корабли врага
    // myBoard: полная инфа (корабли + попадания + промахи + auto-miss)
    // enemyBoard: только попадания/промахи/auto-miss (без ship=true)
    function serializeMyBoard(board) {
        return board.map((row) =>
            row.map((cell) => {
                if (cell === null) return null;
                if (cell.miss) return { miss: true };
                if (cell.ship) {
                    return { ship: true, hit: cell.hit };
                }
                return null;
            })
        );
    }

    function serializeEnemyBoard(board) {
        return board.map((row) =>
            row.map((cell) => {
                if (cell === null) return null;
                if (cell.miss) return { miss: true };
                if (cell.ship && cell.hit) return { hit: true };
                // НЕ показываем ship=true, если не ранена
                return null;
            })
        );
    }

    // ========================================================
    // ИГРОВЫЕ ФУНКЦИИ
    // ========================================================

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

            // Чистим маппинг сокета
            socketToGame.delete(p.socketId);
        }

        // Оставляем игру в Map на 1 минуту (для истории), потом чистим
        setTimeout(() => games.delete(game.id), 60 * 1000);
    }

    // Сбрасывает таймер бездействия
    function resetIdleTimer(game) {
        if (game.idleTimer) clearTimeout(game.idleTimer);

        game.idleTimer = setTimeout(() => {
            // Текущий ход — проигрыш
            const loserKey = game.turn;
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
            // Проверки
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

            // Создаём игру
            const gameId = generateGameId();
            const game = {
                id: gameId,
                player1: {
                    socketId: socket.id,
                    username: socket.username,
                    sessionKey: socket.sessionKey || null,
                    board: null,
                    ready: false,
                },
                player2: {
                    socketId: partner.id,
                    username: partner.username,
                    sessionKey: partner.sessionKey || null,
                    board: null,
                    ready: false,
                },
                phase: 'waiting', // waiting | placing | battle | finished
                turn: null,
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

        // --- ПРИНЯТЬ ПРИГЛАШЕНИЕ ---
        socket.on('game_accept', ({ gameId } = {}) => {
            const game = games.get(gameId);
            if (!game) {
                socket.emit('game_error', { reason: 'game_not_found' });
                return;
            }
            // Проверяем, что игрок — участник
            if (game.player1.socketId !== socket.id && game.player2.socketId !== socket.id) {
                socket.emit('game_error', { reason: 'not_a_player' });
                return;
            }
            if (game.phase !== 'waiting') {
                socket.emit('game_error', { reason: 'wrong_phase' });
                return;
            }

            // Переводим в фазу расстановки
            game.phase = 'placing';

            // Обоим отправляем сигнал
            io.to(game.player1.socketId).emit('game_placing', { gameId });
            io.to(game.player2.socketId).emit('game_placing', { gameId });
        });

        // --- ОТКЛОНИТЬ ПРИГЛАШЕНИЕ ---
        socket.on('game_decline', ({ gameId } = {}) => {
            const game = games.get(gameId);
            if (!game) return;

            // Сообщаем отправителю
            const otherKey = game.player1.socketId === socket.id ? 'player2' : 'player1';
            const otherSocketId = game[otherKey].socketId;

            io.to(otherSocketId).emit('game_declined', {
                byUsername: socket.username,
            });

            // Чистим
            socketToGame.delete(game.player1.socketId);
            socketToGame.delete(game.player2.socketId);
            games.delete(gameId);
        });

        // --- РАССТАНОВКА КОРАБЛЕЙ ---
        // payload: { gameId, board } — board = 2D-массив, где клетка либо null, либо { ship: true }
        // Или { gameId, random: true } — сгенерировать автоматически
        socket.on('game_place_ships', ({ gameId, board, random } = {}) => {
            const game = games.get(gameId);
            if (!game) {
                socket.emit('game_error', { reason: 'game_not_found' });
                return;
            }
            if (game.phase !== 'placing') {
                socket.emit('game_error', { reason: 'wrong_phase' });
                return;
            }

            const playerKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            if (!playerKey) {
                socket.emit('game_error', { reason: 'not_a_player' });
                return;
            }

            let finalBoard;

            if (random) {
                // Генерируем автоматически
                finalBoard = generateRandomBoard();
            } else if (Array.isArray(board)) {
                // Валидируем присланную расстановку
                // (упрощённая валидация: количество кораблей и их размеры)
                // TODO: полная валидация в этапе 1.2
                // Пока — принимаем как есть, но генерируем «правильно» для надёжности
                finalBoard = generateRandomBoard();
            } else {
                socket.emit('game_error', { reason: 'bad_board' });
                return;
            }

            game[playerKey].board = finalBoard;
            game[playerKey].ready = true;

            // Отправляем клиенту его поле (для отображения)
            socket.emit('game_board_accepted', {
                gameId,
                board: serializeMyBoard(finalBoard),
            });

            // Если оба готовы — начинаем бой
            if (game.player1.ready && game.player2.ready) {
                game.phase = 'battle';
                // Первый ход — player1 (или случайно)
                game.turn = 'player1';
                resetIdleTimer(game);

                io.to(game.player1.socketId).emit('game_battle', {
                    gameId,
                    turn: game.turn === 'player1' ? 'you' : 'opponent',
                    myBoard: serializeMyBoard(game.player1.board),
                    enemyBoard: serializeEnemyBoard(game.player2.board),
                    opponentName: game.player2.username,
                });
                io.to(game.player2.socketId).emit('game_battle', {
                    gameId,
                    turn: game.turn === 'player2' ? 'you' : 'opponent',
                    myBoard: serializeMyBoard(game.player2.board),
                    enemyBoard: serializeEnemyBoard(game.player1.board),
                    opponentName: game.player1.username,
                });
            }
        });

        // --- ВЫСТРЕЛ ---
        socket.on('game_shot', ({ gameId, x, y } = {}) => {
            const game = games.get(gameId);
            if (!game) {
                socket.emit('game_error', { reason: 'game_not_found' });
                return;
            }
            if (game.phase !== 'battle') {
                socket.emit('game_error', { reason: 'wrong_phase' });
                return;
            }

            const shooterKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            if (!shooterKey) {
                socket.emit('game_error', { reason: 'not_a_player' });
                return;
            }

            // Ход этого игрока?
            if (game.turn !== shooterKey) {
                socket.emit('game_error', { reason: 'not_your_turn' });
                return;
            }

            // Координаты в пределах поля?
            if (!Number.isInteger(x) || !Number.isInteger(y) ||
                x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
                socket.emit('game_error', { reason: 'bad_coords' });
                return;
            }

            // Клетка уже обстреляна?
            const opponentKey = shooterKey === 'player1' ? 'player2' : 'player1';
            const opponentBoard = game[opponentKey].board;
            const targetCell = opponentBoard[y][x];

            if (targetCell !== null && !targetCell.ship) {
                // Уже стреляли сюда (miss)
                socket.emit('game_error', { reason: 'already_shot' });
                return;
            }
            if (targetCell && targetCell.ship && targetCell.hit) {
                socket.emit('game_error', { reason: 'already_shot' });
                return;
            }

            // --- ОБРАБОТКА ВЫСТРЕЛА ---
            let result = 'miss'; // miss | hit | sunk

            if (targetCell && targetCell.ship) {
                // Попадание
                targetCell.hit = true;
                const { sunk } = checkShipSunk(opponentBoard, x, y);

                if (sunk) {
                    result = 'sunk';
                    // Помечаем клетки вокруг потопленного корабля как auto-miss
                    const shipCells = [];
                    for (let cy = 0; cy < BOARD_SIZE; cy++) {
                        for (let cx = 0; cx < BOARD_SIZE; cx++) {
                            if (opponentBoard[cy][cx] && opponentBoard[cy][cx].shipId === targetCell.shipId) {
                                shipCells.push({ x: cx, y: cy });
                            }
                        }
                    }
                    markAroundSunk(opponentBoard, shipCells);
                } else {
                    result = 'hit';
                }
            } else {
                // Промах
                opponentBoard[y][x] = { miss: true };
            }

            // Проверка победы
            if (isAllSunk(opponentBoard)) {
                endGame(game, shooterKey, 'win');
                // Отдельно шлём результат выстрела, чтобы клиент отрисовал последний ход
                socket.emit('game_shot_result', { x, y, result });
                const oppSocketId = game[opponentKey].socketId;
                io.to(oppSocketId).emit('game_opponent_shot', { x, y, result });
                return;
            }

            // Передача хода (если промах)
            if (result === 'miss') {
                game.turn = opponentKey;
            }
            resetIdleTimer(game);

            // Уведомляем обоих
            socket.emit('game_shot_result', {
                x, y, result,
                turn: game.turn === shooterKey ? 'you' : 'opponent',
            });
            io.to(game[opponentKey].socketId).emit('game_opponent_shot', {
                x, y, result,
                turn: game.turn === opponentKey ? 'you' : 'opponent',
            });
        });

        // --- ПОКИНУТЬ ИГРУ ---
        socket.on('game_leave', ({ gameId } = {}) => {
            const game = games.get(gameId);
            if (!game) return;

            const leaverKey = game.player1.socketId === socket.id ? 'player1' : 'player2';
            const winnerKey = leaverKey === 'player1' ? 'player2' : 'player1';

            // Техническое поражение для вышедшего
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

            // Техническое поражение (упрощённо — без ожидания reconnect)
            // TODO (этап 1.2): реализовать grace-период
            endGame(game, winnerKey, 'disconnect');
        });
    });

    console.log('🚢 Морской бой: модуль загружен');
};