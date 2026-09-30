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
module.exports = {
    id: 'battleship',
    name: '🚢 Морской бой',
    minPlayers: 2,
    maxPlayers: 2,

    // Константы (для других модулей или роутера)
    BOARD_SIZE,
    SHIPS,

    // Утилиты (экспортируются для тестов и других частей)
    canPlaceShip,
    placeShip,
    generateRandomBoard,
    checkShipSunk,
    isAllSunk,
    markAroundSunk,
    serializeMyBoard,
    serializeEnemyBoard,

    // Контракт (заполним в следующих этапах)
    createInitialState: (p1, p2) => ({}),
    handleAction: (game, playerKey, action, payload) => ({ ok: false, error: 'not_implemented' }),
    isFinished: (game) => ({ finished: false, winner: null, reason: null }),
    serializeFor: (game, playerKey) => ({}),
};