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
        // ⚠️ ВАЖНО: роутер передаёт сюда ОБЪЕКТЫ игроков { socketId, username },
        //    а не строки 'player1'/'player2'. Использовать их как ключи нельзя —
        //    получится [object Object]. Поэтому жёстко используем строки.
        const map = generateMap();

        return {
            map,
            tanks: {
                player1: createTank(P1_SPAWN),
                player2: createTank(P2_SPAWN),
            },
            bases: {
                player1: { ...P1_BASE, alive: true },
                player2: { ...P2_BASE, alive: true },
            },
            inputs: {
                player1: emptyInput(),
                player2: emptyInput(),
            },
            bullets: [],
            nextBulletId: 1,        // v1.26.1: счётчик для id снарядов
            tick: 0,
            winner: null,
            finishReason: null,
            phase: 'battle',
            startedAt: Date.now(),
            seed: Date.now(),
        };
    },

    handleAction(game, playerKey, action, payload) {
        const state = game.state || game;
        if (action === 'input') {
            // payload = { up, down, left, right, shoot }
            state.inputs[playerKey] = {
                up: !!payload.up,
                down: !!payload.down,
                left: !!payload.left,
                right: !!payload.right,
                shoot: !!payload.shoot,
            };
            return { ok: true, events: [], finished: false };
        }

        return { ok: false, events: [], finished: false };
    },

    isFinished(state) {
        // Проверка условий победы:
        // 1. База уничтожена → победа соперника.
        // 2. У соперника 0 жизней → победа игрока.
        const s = state.state || state;   // терпимо к обёртке

        // Базы
        if (!s.bases.player1.alive && s.bases.player2.alive) {
            return { finished: true, winner: 'player2', reason: 'base_destroyed' };
        }
        if (!s.bases.player2.alive && s.bases.player1.alive) {
            return { finished: true, winner: 'player1', reason: 'base_destroyed' };
        }
        if (!s.bases.player1.alive && !s.bases.player2.alive) {
            // Одновременно обе — ничья (редкий случай).
            return { finished: true, winner: null, reason: 'both_bases_destroyed' };
        }

        // Жизни танков
        const p1 = s.tanks.player1;
        const p2 = s.tanks.player2;
        const p1dead = p1.lives <= 0;
        const p2dead = p2.lives <= 0;

        if (p1dead && !p2dead) {
            return { finished: true, winner: 'player2', reason: 'tank_destroyed' };
        }
        if (p2dead && !p1dead) {
            return { finished: true, winner: 'player1', reason: 'tank_destroyed' };
        }
        if (p1dead && p2dead) {
            return { finished: true, winner: null, reason: 'both_tanks_destroyed' };
        }

        return { finished: false, winner: null, reason: null };
    },

    serializeFor(game, playerKey) {
        const state = game.state || game;
        return {
            map: state.map,
            myTank: state.tanks[playerKey],
            opponentTank: state.tanks[getOpponentKey(state, playerKey)],
            myBase: state.bases[playerKey],
            opponentBase: state.bases[getOpponentKey(state, playerKey)],
            bullets: state.bullets,
            tick: state.tick,
        };
    },

    // Продвинуть игру на 1 тик. Вызывается роутером каждые 50 мс.
    tickGame(game) {
        tickGame(game);
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
        shootCooldown: 0,   // v1.26.1: тиков до следующего возможного выстрела
    };
}

function getOpponentKey(game, playerKey) {
    const keys = Object.keys(game.tanks);
    return keys.find((k) => k !== playerKey);
}

// ============ Игровой цикл ============

function emptyInput() {
    return { up: false, down: false, left: false, right: false, shoot: false };
}

/**
 * Один тик игры (50 мс).
 * — обновляет повороты и движение танков,
 * — обрабатывает респавны.
 * (Стрельба и коллизии снарядов — Этап 5.)
 */
function tickGame(game) {
    game.tick += 1;

    // Уменьшаем кулдаун выстрелов у живых танков
    for (const key of Object.keys(game.tanks)) {
        const tank = game.tanks[key];
        if (tank.alive && tank.shootCooldown > 0) {
            tank.shootCooldown -= 1;
        }
    }

    // Обновляем танки (поворот, движение, стрельба)
    for (const key of Object.keys(game.tanks)) {
        updateTank(game, key);
    }

    // Двигаем снаряды и обрабатываем столкновения
    updateBullets(game);

    respawnTanks(game);
}

/**
 * Обновить танк: поворот, движение, респавн.
 */
function updateTank(game, key) {
    const tank = game.tanks[key];
    const input = game.inputs[key];

    // Мёртвый танк — ничего не делаем, ждём респавна.
    if (!tank.alive) return;

    // v1.26.1: стрельба (независимо от движения).
        // v1.26.1: стрельба (независимо от движения).
    if (input.shoot && tank.shootCooldown === 0) {
        spawnBullet(game, key);
        tank.shootCooldown = 15; // 0.75 сек при 20 Гц (кулдаун всегда)
    }

    const wantDir = pickDirection(input);
    if (!wantDir) {
        // Игрок ничего не нажал — стоим.
        return;
    }

    // Если хотим ехать в новую сторону — поворачиваемся и стоим этот тик.
    if (wantDir !== tank.dir) {
        tank.dir = wantDir;
        return;
    }

    // Едем только каждые TANK_SPEED_TICKS тиков.
    if (game.tick % TANK_SPEED_TICKS !== 0) return;

    const { dx, dy } = dirToDelta(tank.dir);
    const nx = tank.x + dx;
    const ny = tank.y + dy;

    if (canMoveTo(game, key, nx, ny)) {
        tank.x = nx;
        tank.y = ny;
    }
}

/**
 * Определить желаемое направление по вводу.
 * Приоритет: сначала «новая» сторона относительно текущего направления —
 * но у нас нет текущего здесь, поэтому берём в порядке:
 * up → down → left → right.
 * Для простоты — последняя нажатая клавиша побеждает.
 * Мы не знаем порядок нажатий, поэтому фиксированный приоритет.
 */
function pickDirection(input) {
    if (input.up) return 'up';
    if (input.down) return 'down';
    if (input.left) return 'left';
    if (input.right) return 'right';
    return null;
}

function dirToDelta(dir) {
    switch (dir) {
        case 'up': return { dx: 0, dy: -1 };
        case 'down': return { dx: 0, dy: 1 };
        case 'left': return { dx: -1, dy: 0 };
        case 'right': return { dx: 1, dy: 0 };
        default: return { dx: 0, dy: 0 };
    }
}

/**
 * Можно ли танку `key` встать в клетку (nx, ny)?
 * Проходимы: пусто, кусты.
 * Непроходимы: кирпич, бетон, вода, база, другой танк.
 */
function canMoveTo(game, key, nx, ny) {
    if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) return false;

    const tile = game.map[ny][nx];
    if (tile === TILE_BRICK) return false;
    if (tile === TILE_STEEL) return false;
    if (tile === TILE_WATER) return false;
    if (tile === TILE_BASE) return false;

    // Другой танк?
    const opponentKey = getOpponentKey(game, key);
    const opp = game.tanks[opponentKey];
    if (opp && opp.alive && opp.x === nx && opp.y === ny) return false;

    return true;
}

/**
 * Возродить танки, у которых наступило время респавна.
 * (Пока без стрельбы — просто ставим на стартовую позицию.)
 */
function respawnTanks(game) {
    const spawns = { p1: null, p2: null }; // заполним по ходу
    // Нам неизвестно, какой ключ — player1 или player2.
    // Используем порядок ключей в game.tanks.
    const keys = Object.keys(game.tanks);

    // Спавны жёстко зашиты по позициям: первый игрок — P1_SPAWN, второй — P2_SPAWN.
    // Так как порядок ключей сохраняется с момента создания, это работает.
    const spawnList = [P1_SPAWN, P2_SPAWN];

    keys.forEach((key, idx) => {
        const tank = game.tanks[key];
        if (tank.alive) return;
        if (game.tick < tank.respawnAt) return;

        const spawn = spawnList[idx];
        tank.x = spawn.x;
        tank.y = spawn.y;
        tank.dir = spawn.dir;
        tank.alive = true;
        tank.cooldown = 0;
    });
}

// ============ СТРЕЛЬБА (v1.26.1) ============

/**
 * Создать снаряд перед стволом танка.
 * У каждого танка — только 1 активный снаряд.
 * Возвращает снаряд или null, если выстрелить нельзя.
 */
function spawnBullet(game, key) {
    // Уже есть снаряд от этого игрока — нельзя.
    const existing = game.bullets.find((b) => b.owner === key);
    if (existing) return null;

    const tank = game.tanks[key];
    const { dx, dy } = dirToDelta(tank.dir);

    // Клетка прямо перед стволом.
    const nx = tank.x + dx;
    const ny = tank.y + dy;

    // Границы поля — стрелять нельзя.
    if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) return null;


        // v1.26.2 fix: если в клетке перед стволом — чужой танк, бьём в упор.
    const target = findTankAt(game, nx, ny);
    if (target && target.key !== key) {
        hitTank(game, target.key);
        return null;   // снаряд не создаём, кулдаун срабатывает
    }
    const tile = game.map[ny][nx];

    // v1.26.1 fix: выстрел в упор.
    // Если прямо перед стволом кирпич — ломаем его, снаряд не создаём.
    if (tile === TILE_BRICK) {
        game.map[ny][nx] = TILE_EMPTY;
        return null;   // пусть кулдаун сработает (танк «выстрелил в стену»)
    }

    // Бетон — не пробить, снаряд не создаём, кулдаун срабатывает.
    if (tile === TILE_STEEL) {
        return null;
    }

    // Всё остальное (пусто, кусты, вода, база) — снаряд создаётся
    // и полетит дальше. Попадание в базу обработает updateBullets.
    const bullet = {
        id: 'b_' + game.nextBulletId++,
        x: nx,
        y: ny,
        dir: tank.dir,
        owner: key,
    };

    game.bullets.push(bullet);
    return bullet;
}

/**
 * Продвинуть все снаряды на 1 клетку, обработать столкновения.
 */
function updateBullets(game) {
    const remaining = [];

    for (const bullet of game.bullets) {
        const { dx, dy } = dirToDelta(bullet.dir);
        const nx = bullet.x + dx;
        const ny = bullet.y + dy;

        // Вылет за пределы поля — удаляем.
        if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) {
            continue;
        }

        // Проверка попадания: стена / танк / база.
        const hit = checkBulletHit(game, bullet, nx, ny);
        if (hit === 'continue') {
            // Пусто — снаряд летит дальше.
            bullet.x = nx;
            bullet.y = ny;
            remaining.push(bullet);
            continue;
        }

        // Что-то произошло (стена сломалась, танк убит, база уничтожена).
        // В любом случае снаряд исчезает, если не 'continue'.
        // (hit === 'destroy' или 'bounce' — в любом случае удаляем).
    }

    game.bullets = remaining;
}

/**
 * Проверить попадание снаряда в клетку (nx, ny).
 * Возвращает:
 *   'continue' — снаряд летит дальше (пусто, кусты, вода),
 *   'destroy'  — снаряд уничтожается (кирпич, бетон, танк, база).
 * Побочные эффекты:
 *   — кирпич исчезает (TILE_BRICK → TILE_EMPTY),
 *   — чужой танк теряет жизнь,
 *   — база становится dead,
 *   — свой танк игнорируется (пролетает).
 */
function checkBulletHit(game, bullet, nx, ny) {
    const tile = game.map[ny][nx];

    // Кирпич — ломается, снаряд исчезает.
    if (tile === TILE_BRICK) {
        game.map[ny][nx] = TILE_EMPTY;
        return 'destroy';
    }

    // Бетон — не ломается, снаряд исчезает.
    if (tile === TILE_STEEL) {
        return 'destroy';
    }

    // Вода — снаряд пролетает.
    if (tile === TILE_WATER) {
        return 'continue';
    }

    // Кусты — снаряд пролетает.
    if (tile === TILE_BUSH) {
        return 'continue';
    }

    // База — уничтожается, снаряд исчезает.
    if (tile === TILE_BASE) {
        // Определяем, чья база.
        if (game.bases.player1.x === nx && game.bases.player1.y === ny) {
            game.bases.player1.alive = false;
        }
        if (game.bases.player2.x === nx && game.bases.player2.y === ny) {
            game.bases.player2.alive = false;
        }
        return 'destroy';
    }

    // Танк — попадание.
    const tank = findTankAt(game, nx, ny);
    if (tank) {
        if (tank.key === bullet.owner) {
            // Свой танк — снаряд пролетает (не бьёт своего).
            return 'continue';
        }
        // Чужой танк — теряет жизнь.
        hitTank(game, tank.key);
        return 'destroy';
    }

    // Пусто — летим дальше.
    return 'continue';
}

/**
 * Найти живой танк на клетке (nx, ny).
 * Возвращает { key, tank } или null.
 */
function findTankAt(game, nx, ny) {
    for (const key of Object.keys(game.tanks)) {
        const t = game.tanks[key];
        if (t.alive && t.x === nx && t.y === ny) {
            return { key, tank: t };
        }
    }
    return null;
}

/**
 * Танк получает урон: lives −1, если > 0 — респавн через RESPAWN_TICKS.
 * Если lives = 0 — танк остаётся мёртвым навсегда (для победы).
 */
function hitTank(game, key) {
    const tank = game.tanks[key];
    if (!tank.alive) return;

    tank.lives -= 1;

    if (tank.lives <= 0) {
        // Всё, танк мёртв окончательно. Оставим alive: false без respawnAt.
        tank.alive = false;
        tank.respawnAt = Infinity;  // никогда не респавнится
    } else {
        // Ждём респавна.
        tank.alive = false;
        tank.respawnAt = game.tick + RESPAWN_TICKS;
    }
}