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

    // Контракт (заглушки)
    createInitialState: (player1, player2) => ({}),
    handleAction: (game, playerKey, action, payload) => ({ ok: false, error: 'not_implemented' }),
    isFinished: (game) => ({ finished: false, winner: null, reason: null }),
    serializeFor: (game, playerKey) => ({}),
};