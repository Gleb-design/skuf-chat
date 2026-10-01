// ========================================================
// games/tanks.js — Танчики 1-на-1 (v1.25.0)
// ========================================================
// Вид сверху, поле 13×13, классика Battle City.
// Контракт модуля — как у battleship.js и domino.js.
//
// ⚠️ ПОКА ЭТО КАРКАС. Реальная логика появится на этапах 3+.
// Сейчас цель: убедиться, что game-server.js подхватывает модуль.

'use strict';

// ---------- Константы ----------
const MAP_SIZE = 13;              // поле 13×13
const TILE_EMPTY   = 0;
const TILE_BRICK   = 1;
const TILE_STEEL   = 2;
const TILE_WATER   = 3;
const TILE_BUSH    = 4;
const TILE_BASE    = 5;

const TANK_LIVES = 3;
const TANK_SPEED_TICKS = 5;       // 1 клетка за 5 тиков
const BULLET_SPEED_TICKS = 1;     // 1 клетка за 1 тик
const RESPAWN_TICKS = 40;         // 2 сек при 20 Гц
const BATTLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут

// ---------- Контракт модуля ----------
module.exports = {
    id: 'tanks',
    name: '🛡️ Танчики',
    minPlayers: 2,
    maxPlayers: 2,

    // Создать начальное состояние (карта + два танка + базы).
    // Реальная генерация карты — на Этапе 3.
    createInitialState(player1, player2) {
        return {
            // Заглушка: пустое поле с рамкой из бетона.
            // Настоящая карта появится на Этапе 3.
            map: createEmptyMap(),
            tanks: {
                [player1]: createTankStub(1, MAP_SIZE - 2, 'up'),
                [player2]: createTankStub(MAP_SIZE - 2, MAP_SIZE - 2, 'up'),
            },
            bases: {
                [player1]: { x: 1, y: MAP_SIZE - 1, alive: true },
                [player2]: { x: MAP_SIZE - 2, y: MAP_SIZE - 1, alive: true },
            },
            bullets: [],
            tick: 0,
            winner: null,
            finishReason: null,
            startedAt: Date.now(),
        };
    },

    // Обработать действие игрока. Пока — заглушка.
    // Настоящая логика — Этапы 4-5.
    handleAction(game, playerKey, action, payload) {
        // Заглушка: ничего не делаем, просто отвечаем ok.
        return {
            ok: true,
            events: [],
            finished: false,
        };
    },

    // Проверка окончания игры. Пока — всегда false.
    isFinished(game) {
        return { finished: false, winner: null, reason: null };
    },

    // Сериализация состояния для конкретного игрока.
    // Пока — отдаём всё как есть (для отладки).
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

// ---------- Вспомогательные (заглушки) ----------

function createEmptyMap() {
    const map = [];
    for (let y = 0; y < MAP_SIZE; y++) {
        const row = [];
        for (let x = 0; x < MAP_SIZE; x++) {
            const isBorder = (x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1);
            row.push(isBorder ? TILE_STEEL : TILE_EMPTY);
        }
        map.push(row);
    }
    return map;
}

function createTankStub(x, y, dir) {
    return {
        x, y, dir,
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