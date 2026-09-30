// ========================================================
// games/battleship.js — логика Морского боя
// ========================================================
// Модуль для game-server.js. Экспортирует объект-контракт,
// который роутер использует для игр этого типа.
//
// Этап 2: перенесены все утилиты (поле, корабли, выстрелы).
// Обработчики (handleAction) — заглушка, заполнятся в Этапе 3.
// ========================================================

// ========================================================
// КОНСТАНТЫ
// ========================================================
const BOARD_SIZE = 10;
// Классический набор: 1×4, 2×3, 3×2, 4×1
const SHIPS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

// ========================================================
// УТИЛИТЫ (чистые функции, не зависят от роутера)
// ========================================================

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
            shipId: null, // проставим ниже
        };
        cells.push({ x: cx, y: cy });
    }
    // Общий shipId по координатам первой клетки
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
            return generateRandomBoard(); // редко — начинаем заново
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

    for (let cy = 0; cy < BOARD_SIZE; cy++) {
        for (let cx = 0; cx < BOARD_SIZE; cx++) {
            if (board[cy][cx] && board[cy][cx].shipId === shipId) {
                shipCells.push({ x: cx, y: cy, hit: board[cy][cx].hit });
            }
        }
    }

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
function serializeMyBoard(board) {
    return board.map((row) =>
        row.map((cell) => {
            if (cell === null) return null;
            if (cell.miss) return { miss: true };
            if (cell.ship) return { ship: true, hit: cell.hit };
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
            return null;
        })
    );
}

// ========================================================
// ЭКСПОРТ
// ========================================================
// ========================================================
// КОНТРАКТ ДЛЯ РОУТЕРА
// ========================================================
module.exports = {
    id: 'battleship',
    name: '🚢 Морской бой',
    minPlayers: 2,
    maxPlayers: 2,

    // Константы
    BOARD_SIZE,
    SHIPS,

    // ========================================================
    // createInitialState — начальное состояние игры
    // ========================================================
    // Роутер передаёт player1/player2 (объекты с socketId/username/sessionKey).
    // Модуль создаёт своё состояние.
    createInitialState: (player1, player2) => ({
        phase: 'placing',        // placing | battle | finished
        board1: null,            // поле player1 (2D)
        board2: null,            // поле player2 (2D)
        ready1: false,           // готовность player1
        ready2: false,           // готовность player2
        turn: null,              // 'player1' | 'player2' — чей ход (в battle)
        winner: null,            // 'player1' | 'player2' | null
    }),

    // ========================================================
    // handleAction — обработать действие игрока
    // ========================================================
    // Возвращает:
    //   { ok: true, events: [{ to, event, data }, ...] }
    //   { ok: false, error: 'reason' }
    //
    // to: 'self' | 'opponent' | 'both'
    handleAction: (game, playerKey, action, payload) => {
        const state = game.state;

        // ------------------------------------------------
        // РАССТАНОВКА КОРАБЛЕЙ
        // ------------------------------------------------
        if (action === 'place_ships') {
            if (state.phase !== 'placing') {
                return { ok: false, error: 'wrong_phase' };
            }

            const playerNum = playerKey === 'player1' ? 1 : 2;
            if (state[`ready${playerNum}`]) {
                return { ok: false, error: 'already_ready' };
            }

            // Генерируем случайное поле (или валидируем board — пока TODO)
            const board = generateRandomBoard();
            state[`board${playerNum}`] = board;
            state[`ready${playerNum}`] = true;

            const events = [
                // Тому, кто расставлял — подтверждение
                {
                    to: 'self',
                    event: 'game_board_accepted',
                    data: { board: serializeMyBoard(board) },
                },
            ];

            // Если оба готовы — начинаем бой
            if (state.ready1 && state.ready2) {
                state.phase = 'battle';
                state.turn = 'player1';

                const payload1 = {
                    gameId: game.id,
                    turn: 'you',
                    youAre: 'player1',
                    myBoard: serializeMyBoard(state.board1),
                    enemyBoard: serializeEnemyBoard(state.board2),
                    opponentName: game.player2.username,
                };
                const payload2 = {
                    gameId: game.id,
                    turn: 'opponent',
                    youAre: 'player2',
                    myBoard: serializeMyBoard(state.board2),
                    enemyBoard: serializeEnemyBoard(state.board1),
                    opponentName: game.player1.username,
                };

                events.push(
                    { to: 'player1', event: 'game_battle', data: payload1 },
                    { to: 'player2', event: 'game_battle', data: payload2 },
                );
            }

            return { ok: true, events };
        }

        // ------------------------------------------------
        // ВЫСТРЕЛ
        // ------------------------------------------------
        if (action === 'shot') {
            if (state.phase !== 'battle') {
                return { ok: false, error: 'wrong_phase' };
            }

            const { x, y } = payload;
            if (state.turn !== playerKey) {
                return { ok: false, error: 'not_your_turn' };
            }

            const shooterNum = playerKey === 'player1' ? 1 : 2;
            const opponentKey = playerKey === 'player1' ? 'player2' : 'player1';
            const opponentNum = shooterNum === 1 ? 2 : 1;

            const opponentBoard = state[`board${opponentNum}`];

            // Проверка координат
            if (!Number.isInteger(x) || !Number.isInteger(y) ||
                x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
                return { ok: false, error: 'bad_coords' };
            }

            const targetCell = opponentBoard[y][x];

            // Уже стреляли?
            if (targetCell !== null && !targetCell.ship) {
                return { ok: false, error: 'already_shot' };
            }
            if (targetCell && targetCell.ship && targetCell.hit) {
                return { ok: false, error: 'already_shot' };
            }

            // --- ОБРАБОТКА ВЫСТРЕЛА ---
            let result = 'miss';

            if (targetCell && targetCell.ship) {
                targetCell.hit = true;
                const { sunk } = checkShipSunk(opponentBoard, x, y);

                if (sunk) {
                    result = 'sunk';
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
                opponentBoard[y][x] = { miss: true };
            }

            // Проверка победы
            if (isAllSunk(opponentBoard)) {
                state.phase = 'finished';
                state.winner = playerKey;

                return {
                    ok: true,
                    events: [
                        { to: 'self', event: 'game_shot_result', data: { x, y, result } },
                        { to: 'opponent', event: 'game_opponent_shot', data: { x, y, result } },
                    ],
                    finished: true,
                    winner: playerKey,
                    reason: 'win',
                };
            }

            // Передача хода
            if (result === 'miss') {
                state.turn = opponentKey;
            }

            return {
                ok: true,
                events: [
                    {
                        to: 'self',
                        event: 'game_shot_result',
                        data: { x, y, result, turn: state.turn === playerKey ? 'you' : 'opponent' },
                    },
                    {
                        to: 'opponent',
                        event: 'game_opponent_shot',
                        data: { x, y, result, turn: state.turn === opponentKey ? 'you' : 'opponent' },
                    },
                ],
            };
        }

        // ------------------------------------------------
        // НЕИЗВЕСТНОЕ ДЕЙСТВИЕ
        // ------------------------------------------------
        return { ok: false, error: 'unknown_action' };
    },

    // ========================================================
    // isFinished — игра закончилась?
    // ========================================================
    isFinished: (game) => {
        const state = game.state;
        if (state.phase === 'finished') {
            return { finished: true, winner: state.winner, reason: 'win' };
        }
        return { finished: false, winner: null, reason: null };
    },

    // ========================================================
    // serializeFor — что видит игрок
    // ========================================================
    serializeFor: (game, playerKey) => {
        const state = game.state;
        const playerNum = playerKey === 'player1' ? 1 : 2;
        const opponentNum = playerNum === 1 ? 2 : 1;

        return {
            phase: state.phase,
            myBoard: state[`board${playerNum}`] ? serializeMyBoard(state[`board${playerNum}`]) : null,
            enemyBoard: state[`board${opponentNum}`] ? serializeEnemyBoard(state[`board${opponentNum}`]) : null,
            turn: state.turn === playerKey ? 'you' : 'opponent',
            ready: state[`ready${playerNum}`],
        };
    },
};