// ========================================================
// games/tanks.js — Танчики 1-на-1 (v1.25.0)
// ========================================================
// Вид сверху, поле 13×13, классика Battle City.
// Контракт модуля — как у battleship.js и domino.js.
//
// Этап 3: генератор карты.

'use strict';

// ---------- Константы ----------
const MAP_SIZE = 13;              // поле 13×13
const TILE_EMPTY = 0;
const TILE_BRICK = 1;
const TILE_STEEL = 2;
const TILE_WATER = 3;
const TILE_BUSH = 4;
const TILE_BASE = 5;

const TANK_LIVES = 3;
const TANK_SPEED_TICKS = 5;       // 1 клетка за 5 тиков
const BULLET_SPEED_TICKS = 1;     // 1 клетка за 1 тик
const RESPAWN_TICKS = 40;         // 2 сек при 20 Гц
const BATTLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут

// Стартовые позиции танков (у своих баз, на 1 клетку выше).
// Базы — в самых нижних углах, рядом с бетонной рамкой.
const P1_SPAWN = { x: 1, y: MAP_SIZE - 3, dir: 'up' };   // x=1, y=10
const P2_SPAWN = { x: MAP_SIZE - 2, y: MAP_SIZE - 3, dir: 'up' }; // x=11, y=10

// Позиции баз (в нижних углах).
const P1_BASE = { x: 1, y: MAP_SIZE - 2 };               // x=1, y=11
const P2_BASE = { x: MAP_SIZE - 2, y: MAP_SIZE - 2 };    // x=11, y=11

// ---------- Контракт модуля ----------
module.exports = {
    id: 'tanks',
    name: '🛡️ Танчики',
    minPlayers: 2,
    maxPlayers: 2,

    createInitialState(player1, player2) {
        const map = generateMap();

        return {
            map,
            tanks: {
                [player1]: createTank(P1_SPAWN),
                [player2]: createTank(P2_SPAWN),
            },
            bases: {
                [player1]: { ...P1_BASE, alive: true },
                [player2]: { ...P2_BASE, alive: true },
            },
            bullets: [],
            tick: 0,
            winner: null,
            finishReason: null,
            startedAt: Date.now(),
            seed: Date.now(), // для отладки, чтобы понимать, какая карта выпала
        };
    },

    handleAction(game, playerKey, action, payload) {
        return { ok: true, events: [], finished: false };
    },

    isFinished(game) {
        return { finished: false, winner: null, reason: null };
    },

    serializeFor(game, playerKey) {
        return {
            map: game.map,
            myTank: game.tanks[playerKey],
            opponentTank: game.tanks[getOpponentKey(game, playerKey)],
            myBase: game.bases[playerKey],
            opponentBase: game.bases[getOpponentKey(game, playerKey)],
            bullets: game.bullets,
            tick: game.tick,
        };
    },
};

// ---------- Генератор карты ----------

/**
 * Генерирует карту 13×13 для дуэли.
 * — Рамка по периметру из бетона.
 * — Базы в нижних углах, защищены кирпичом.
 * — Препятствия в центре, симметричные относительно центра поля.
 * — Коридор перед базами и стартовые позиции танков — всегда пустые.
 */
function generateMap() {
    const map = [];
    for (let y = 0; y < MAP_SIZE; y++) {
        const row = [];
        for (let x = 0; x < MAP_SIZE; x++) {
            row.push(TILE_EMPTY);
        }
        map.push(row);
    }

    // 1. Бетонная рамка по периметру
    for (let x = 0; x < MAP_SIZE; x++) {
        map[0][x] = TILE_STEEL;
        map[MAP_SIZE - 1][x] = TILE_STEEL;
    }
    for (let y = 0; y < MAP_SIZE; y++) {
        map[y][0] = TILE_STEEL;
        map[y][MAP_SIZE - 1] = TILE_STEEL;
    }

    // 2. Препятствия в центре. Идём по верхней половине (y от 1 до 5),
    //    и зеркалим на нижнюю (y' = MAP_SIZE - 1 - y).
    //    Внутри y=6 (центральная линия) — тоже заполняем, но пополам
    //    (левая часть зеркалится в правую).
    for (let y = 1; y <= 5; y++) {
        for (let x = 1; x <= 5; x++) {
            // Клетка (x, y) — верхняя левая четверть. Кидаем тайл.
            const tile = randomTile();
            map[y][x] = tile;
            // Зеркалим на верхнюю правую: (MAP_SIZE-1-x, y)
            map[y][MAP_SIZE - 1 - x] = tile;
            // Зеркалим на нижнюю левую: (x, MAP_SIZE-1-y)
            map[MAP_SIZE - 1 - y][x] = tile;
            // Зеркалим на нижнюю правую: (MAP_SIZE-1-x, MAP_SIZE-1-y)
            map[MAP_SIZE - 1 - y][MAP_SIZE - 1 - x] = tile;
        }
    }

    // Центральная колонка x=6 верхней половины — симметрично по вертикали.
    for (let y = 1; y <= 5; y++) {
        const tile = randomTile();
        map[y][6] = tile;
        map[MAP_SIZE - 1 - y][6] = tile;
    }

    // Центральная строка y=6 — симметрично по горизонтали.
    for (let x = 1; x <= 5; x++) {
        const tile = randomTile();
        map[6][x] = tile;
        map[6][MAP_SIZE - 1 - x] = tile;
    }
    // Самая центральная клетка (6, 6) — пустая (для манёвра).
    map[6][6] = TILE_EMPTY;

    // 3. Базы (TILE_BASE) и защита из кирпича вокруг них.
    placeBase(map, P1_BASE.x, P1_BASE.y);
    placeBase(map, P2_BASE.x, P2_BASE.y);

    // 4. Коридор перед базами — принудительно пустой
    //    (затирает лишний кирпич над базами, где стоят танки).
    clearArea(map, 1, MAP_SIZE - 4, 3, 2);
    clearArea(map, MAP_SIZE - 4, MAP_SIZE - 4, 3, 2);

    return map;
}

function randomTile() {
    // Веса: 30% пусто, 30% кирпич, 10% бетон, 15% вода, 15% кусты.
    const r = Math.random();
    if (r < 0.30) return TILE_EMPTY;
    if (r < 0.60) return TILE_BRICK;
    if (r < 0.70) return TILE_STEEL;
    if (r < 0.85) return TILE_WATER;
    return TILE_BUSH;
}

/**
 * Очистить прямоугольник (сделать все тайлы EMPTY).
 * x, y — левый верхний угол. w, h — ширина и высота.
 */
function clearArea(map, x, y, w, h) {
    for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny > 0 && ny < MAP_SIZE - 1 && nx > 0 && nx < MAP_SIZE - 1) {
                map[ny][nx] = TILE_EMPTY;
            }
        }
    }
}

/**
 * Поставить базу и обнести её кирпичом с трёх сторон.
 * База ставится на (x, y), кирпич — слева, справа и сверху.
 */
function placeBase(map, x, y) {
    // Сама база
    map[y][x] = TILE_BASE;

    // Кирпич вокруг (слева, справа, сверху).
    // Проверяем границы, чтобы не вылезти за рамку бетона.
    const around = [
        { dx: -1, dy: 0 }, // слева
        { dx: 1, dy: 0 }, // справа
        { dx: 0, dy: -1 }, // сверху
    ];
    for (const { dx, dy } of around) {
        const nx = x + dx;
        const ny = y + dy;
        if (ny > 0 && ny < MAP_SIZE - 1 && nx > 0 && nx < MAP_SIZE - 1) {
            // Не затираем чужую базу (на всякий случай).
            if (map[ny][nx] !== TILE_BASE) {
                map[ny][nx] = TILE_BRICK;
            }
        }
    }
}

function createTank(spawn) {
    return {
        x: spawn.x,
        y: spawn.y,
        dir: spawn.dir,
        lives: TANK_LIVES,
        alive: true,
        respawnAt: 0,
        cooldown: 0,
    };
}

function getOpponentKey(game, playerKey) {
    const keys = Object.keys(game.tanks);
    return keys.find((k) => k !== playerKey);
}