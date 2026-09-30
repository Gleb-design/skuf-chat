// ========================================================
// games/domino.js — логика Домино («Козёл»)
// ========================================================
// Модуль для game-server.js (универсальный роутер игр).
//
// Правила (вариант «Козёл»):
//   - 28 костей (0-0 … 6-6)
//   - 7 каждому, 14 в базаре
//   - Первый ход — дубль 6-6 или наибольшая кость
//   - Цель: выложить все свои кости
//   - Базар: если нечего ходить — берём оттуда
//   - Рыба: оба не могут ходить + базар пуст → подсчёт очков
//
// Контракт (см. раздел 21 report.txt):
//   id, name, minPlayers, maxPlayers,
//   createInitialState, handleAction, isFinished, serializeFor.
// ========================================================

// ========================================================
// КОНСТАНТЫ
// ========================================================
const MAX_PIP = 6;              // максимальное число точек на кости
const TILES_COUNT = 28;         // всего костей ((6+1)*(6+2)/2)
const HAND_SIZE = 7;            // костей в руке у каждого
const BAZAAR_SIZE = 14;         // костей в базаре (28 - 7 - 7)

// ========================================================
// УТИЛИТЫ
// ========================================================

// Создаёт полный набор костей (28 штук)
// Кость: { a: 0-6, b: 0-6, isDouble: bool, id: 'a-b' }
function createTileSet() {
    const tiles = [];
    for (let a = 0; a <= MAX_PIP; a++) {
        for (let b = a; b <= MAX_PIP; b++) {
            tiles.push({
                a,
                b,
                isDouble: a === b,
                id: `${a}-${b}`,
            });
        }
    }
    return tiles;
}

// Перемешивает массив (Fisher-Yates)
function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ========================================================
// ЭКСПОРТ (каркас — заполним в следующих подшагах)
// ========================================================
// ========================================================
// ИГРОВАЯ ЛОГИКА
// ========================================================

// Находит игрока, у которого есть дубль 6-6 (или наибольший дубль).
// Если дублей нет — ищет наибольшую кость по сумме очков.
// Возвращает: { playerKey: 'player1'|'player2', tile: obj } или null.
function determineFirstMove(hand1, hand2) {
    // 1. Ищем старший дубль (6-6, 5-5, ...)
    for (let pip = MAX_PIP; pip >= 0; pip--) {
        const id = `${pip}-${pip}`;
        const inHand1 = hand1.find((t) => t.id === id);
        const inHand2 = hand2.find((t) => t.id === id);

        if (inHand1) return { playerKey: 'player1', tile: inHand1 };
        if (inHand2) return { playerKey: 'player2', tile: inHand2 };
    }

    // 2. Дублей нет — ищем наибольшую по сумме
    function maxSum(hand) {
        return hand.reduce((best, t) => {
            const sum = t.a + t.b;
            return (!best || sum > best.a + best.b) ? t : best;
        }, null);
    }

    const best1 = maxSum(hand1);
    const best2 = maxSum(hand2);

    if (!best1 && !best2) return null; // не должно случиться
    if (!best1) return { playerKey: 'player2', tile: best2 };
    if (!best2) return { playerKey: 'player1', tile: best1 };

    const sum1 = best1.a + best1.b;
    const sum2 = best2.a + best2.b;

    if (sum1 >= sum2) return { playerKey: 'player1', tile: best1 };
    return { playerKey: 'player2', tile: best2 };
}

// Возвращает левое и правое число змейки (концы)
// board: [{ tile, orientation: 'left'|'right'|'start', ... }, ...]
// Пока пустая — концы = null.
function getEnds(board) {
    if (!board || board.length === 0) {
        return { left: null, right: null };
    }
    const first = board[0];
    const last = board[board.length - 1];
    // У первой кости — её "левое" число (a для start, b если orientation === 'right')
    // ⚠️ Упрощённо: у нас будет структура board = { left, right, tiles: [...] }
    // на подшаге 1.3. Пока — заглушка.
    return { left: null, right: null };
}

// Можно ли выложить кость на один из концов?
// ends: { left, right }
function canPlayTile(tile, ends) {
    if (ends.left === null && ends.right === null) return true; // первая кость
    return tile.a === ends.left || tile.b === ends.left
        || tile.a === ends.right || tile.b === ends.right;
}

// Есть ли в руке хотя бы одна подходящая кость?
function canPlayAny(hand, ends) {
    if (!hand || hand.length === 0) return false;
    if (ends.left === null && ends.right === null) return true;
    return hand.some((tile) => canPlayTile(tile, ends));
}

// ========================================================
// КОНТРАКТ ДЛЯ РОУТЕРА
// ========================================================
module.exports = {
    id: 'domino',
    name: '🎲 Домино',
    minPlayers: 2,
    maxPlayers: 2,

    // Константы
    MAX_PIP,
    TILES_COUNT,
    HAND_SIZE,
    BAZAAR_SIZE,

    // Утилиты
    createTileSet,
    shuffle,
    determineFirstMove,
    getEnds,
    canPlayTile,
    canPlayAny,

    // ========================================================
    // createInitialState
    // ========================================================
    createInitialState: (player1, player2) => {
        // 1. Создаём и мешаем 28 костей
        const allTiles = shuffle(createTileSet());

        // 2. Раздаём: 7 + 7, остальное в базар (14)
        const hand1 = allTiles.slice(0, HAND_SIZE);
        const hand2 = allTiles.slice(HAND_SIZE, HAND_SIZE * 2);
        const bazaar = allTiles.slice(HAND_SIZE * 2);

        // 3. Определяем первый ход
        const firstMove = determineFirstMove(hand1, hand2);
        const firstPlayer = firstMove ? firstMove.playerKey : 'player1';

        return {
            phase: 'battle',                 // 'battle' | 'finished'
            hand1,                           // кости player1
            hand2,                           // кости player2
            bazaar,                          // кости в базаре
            board: {
                tiles: [],                   // выложенные кости в змейку
                leftEnd: null,               // открытое число слева
                rightEnd: null,              // открытое число справа
            },
            turn: firstPlayer,               // чей ход
            winner: null,                    // 'player1' | 'player2' | null
            passCount: 0,                    // счётчик последовательных пасов (для «рыбы»)
        };
    },

    // ========================================================
    // handleAction — заглушка (заполним в 1.3)
    // ========================================================
    handleAction: (game, playerKey, action, payload) => {
        return { ok: false, error: 'not_implemented_yet' };
    },

    // ========================================================
    // isFinished — заглушка (заполним в 1.3)
    // ========================================================
    isFinished: (game) => {
        const state = game.state;
        if (state.phase === 'finished') {
            return { finished: true, winner: state.winner, reason: 'win' };
        }
        return { finished: false, winner: null, reason: null };
    },

    // ========================================================
    // serializeFor — заглушка (заполним в 1.3)
    // ========================================================
    serializeFor: (game, playerKey) => {
        const state = game.state;
        const hand = playerKey === 'player1' ? state.hand1 : state.hand2;
        const opponentHand = playerKey === 'player1' ? state.hand2 : state.hand1;

        return {
            phase: state.phase,
            myHand: hand,
            opponentHandCount: opponentHand.length,
            bazaarCount: state.bazaar.length,
            board: state.board,
            turn: state.turn === playerKey ? 'you' : 'opponent',
        };
    },
};