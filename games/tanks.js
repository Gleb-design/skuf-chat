// ========================================================
// games/tanks.js — Танчики 1-на-1 (v1.25.0)
// ========================================================
// Вид сверху, поле 13×13, классика Battle City.
// Контракт модуля — как у battleship.js и domino.js.
//
// Этап 3: генератор карты.

'use strict';

// ---------- Константы ----------
// ---------- Константы ----------
const MAP_SIZE = 13;              // поле 13×13
const TILE_EMPTY = 0;
const TILE_BRICK = 1;
const TILE_STEEL = 2;
const TILE_WATER = 3;
const TILE_BUSH = 4;
// v1.29.0: базы убраны, вместо TILE_BASE (5) — декор.
const TILE_CRATE   = 5;   // 📦 ящик (дерево, ломается выстрелом)
const TILE_BARREL  = 6;   // 🛢️ бочка (металл, не ломается)
const TILE_SANDBAG = 7;   // 🧱 мешки (непроходимы, не ломаются)
const TILE_TIRE    = 8;   // ⚫ покрышка (проходима, только декор)

// v1.28.0: туман войны
const TILE_FOG = 9;                  // клетка вне радиуса видимости
const VISIBILITY_RADIUS = 3;         // манхэттенское расстояние (ромб)

const TANK_LIVES = 5;   // v1.27.0: 5 попаданий = смерть (без респавна)
const TANK_SPEED_TICKS = 5;       // 1 клетка за 5 тиков
const BULLET_SPEED_TICKS = 1;     // 1 клетка за 1 тик
// const RESPAWN_TICKS = 40;         // 2 сек при 20 Гц
const BATTLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут

// v1.27.0: танки в противоположных углах, базы — в углах,
// противоположных своему спавну по вертикали.
//
// Карта (физические координаты):
//   (1,1) — база P1               (11,1) — спавн P2 (смотрит вниз)
//   (1,11) — спавн P1 (смотрит вверх)   (11,11) — база P2
//
// После зеркалирования (для Player2) карта отражается на 180°:
// Player2 видит СВОЙ спавн в (1,11), свою базу в (1,1),
// спавн соперника в (11,1), базу соперника в (11,11).
// Симметрично — оба игрока видят одинаковую картину.

// v1.29.0: базы убраны. Победа — только по убийству (5 попаданий).
const P1_SPAWN = { x: 1, y: MAP_SIZE - 2, dir: 'up' };   // x=1, y=11 (нижний левый)
const P2_SPAWN = { x: MAP_SIZE - 2, y: 1, dir: 'down' }; // x=11, y=1  (верхний правый)

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
            inputs: {
                player1: emptyInput(),
                player2: emptyInput(),
            },
            bullets: [],
            nextBulletId: 1,
            tick: 0,
            winner: null,
            finishReason: null,
            phase: 'battle',
            startedAt: Date.now(),
            seed: Date.now(),

            // v1.28.0: последние выстрелы игроков (для тумана — вспышка)
            lastShots: {
                player1: null,   // { x, y, tick }
                player2: null,
            },
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
        // v1.29.0: базы убраны. Победа — только по убийству (5 попаданий).
        const s = state.state || state;

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
        const opponentKey = getOpponentKey(state, playerKey);
        const myTank = state.tanks[playerKey];
        const oppTank = state.tanks[opponentKey];

        // Видимость: манхэттенское расстояние от моего танка ≤ RADIUS
        function isVisible(x, y) {
            if (!myTank || !myTank.alive) return false;
            return Math.abs(x - myTank.x) + Math.abs(y - myTank.y) <= VISIBILITY_RADIUS;
        }

        // v1.28.1: ВОЗВРАТ к простому туману. Вне радиуса — TILE_FOG (тёмный).
        const foggedMap = [];
        for (let y = 0; y < MAP_SIZE; y++) {
            const row = [];
            for (let x = 0; x < MAP_SIZE; x++) {
                if (isVisible(x, y)) {
                    row.push(state.map[y][x]);
                } else {
                    row.push(TILE_FOG);
                }
            }
            foggedMap.push(row);
        }

        // Соперник
        const oppVisible = oppTank && oppTank.alive && isVisible(oppTank.x, oppTank.y);
        const visibleOppTank = oppVisible ? oppTank : null;

        // Снаряды
        const visibleBullets = state.bullets.filter((b) => {
            if (b.owner === playerKey) return true;
            return isVisible(b.x, b.y);
        });

        // Вспышка от выстрела соперника вне радиуса
        const lastShot = state.lastShots ? state.lastShots[opponentKey] : null;
        if (lastShot && (state.tick - lastShot.tick) <= 10) {
            if (!isVisible(lastShot.x, lastShot.y)) {
                visibleBullets.push({
                    id: 'flash_' + lastShot.tick,
                    x: lastShot.x,
                    y: lastShot.y,
                    dir: 'up',
                    owner: opponentKey,
                    isFlash: true,
                });
            }
        }

        return {
            map: foggedMap,
            youAre: playerKey,
            myTank,
            opponentTank: visibleOppTank,
            bullets: visibleBullets,
            tick: state.tick,
        };
    },

    // Продвинуть игру на 1 тик. Вызывается роутером каждые 50 мс.
    tickGame(game) {
        tickGame(game);
    },
};

// ---------- Генератор карты (v1.29.0 — умный рандом) ----------

/**
 * Генерирует карту 13×13 для дуэли.
 * — Без рамки (край карты = граница, дальше нельзя).
 * — Умный рандом: без одиночных стен, с коридорами вокруг спавнов.
 * — BFS-проверка: путь от P1 к P2 существует.
 * — Декор: ящики, бочки, мешки, покрышки.
 */
function generateMap() {
    // Пытаемся до 20 раз. Обычно хватает 1-3 попыток.
    for (let attempt = 0; attempt < 50; attempt++) {
        const map = buildRandomMap();
        if (isMapPlayable(map)) return map;
    }
    // Fallback — пустая карта с парой стен, чтобы игра не падала.
    return buildFallbackMap();
}

function buildRandomMap() {
    const map = [];
    for (let y = 0; y < MAP_SIZE; y++) {
        const row = [];
        for (let x = 0; x < MAP_SIZE; x++) {
            row.push(TILE_EMPTY);
        }
        map.push(row);
    }

    // 1. Основные стены/вода/кусты/декор — по всей карте, кроме зон спавнов
    for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            // Зона 3×3 вокруг спавнов — принудительно пусто
            if (isNearSpawn(x, y)) continue;

            map[y][x] = randomTile();
        }
    }

    // 2. Чистим одиночные стены (окружённые пустотой со всех 4 сторон)
    removeIsolatedWalls(map);

    // 3. Гарантированный коридор шириной 2 в центре по вертикали и горизонтали
    //    (чтобы не было «глухой стены» поперёк карты)
    for (let y = 0; y < MAP_SIZE; y++) {
        map[y][6] = map[y][6] === TILE_STEEL ? TILE_EMPTY : map[y][6];
        map[y][7] = map[y][7] === TILE_STEEL ? TILE_EMPTY : map[y][7];
    }
    for (let x = 0; x < MAP_SIZE; x++) {
        map[6][x] = map[6][x] === TILE_STEEL ? TILE_EMPTY : map[6][x];
        map[7][x] = map[7][x] === TILE_STEEL ? TILE_EMPTY : map[7][x];
    }

    return map;
}

/**
 * Проверить: спавн-зона? (3×3 вокруг каждого спавна)
 */
function isNearSpawn(x, y) {
    // v1.29.1: радиус 1 (зона 3×3 вокруг спавна), было 2 (5×5)
    if (Math.abs(x - P1_SPAWN.x) <= 1 && Math.abs(y - P1_SPAWN.y) <= 1) return true;
    if (Math.abs(x - P2_SPAWN.x) <= 1 && Math.abs(y - P2_SPAWN.y) <= 1) return true;
    return false;
}

/**
 * Случайный тайл. Веса:
 * — 50% пусто
 * — 20% кирпич
 * — 3% бетон
 * — 7% кусты
 * — 5% вода
 * — 15% декор (ящики, бочки, мешки, покрышки)
 */
function randomTile() {
    const r = Math.random();
    if (r < 0.35) return TILE_EMPTY;      // 35% пусто (было 50)
    if (r < 0.60) return TILE_BRICK;      // 25% кирпич (было 20)
    if (r < 0.66) return TILE_STEEL;      // 6% бетон (было 3)
    if (r < 0.76) return TILE_BUSH;       // 10% кусты (было 7)
    if (r < 0.83) return TILE_WATER;      // 7% вода (было 5)

    // Декор 17%
    const d = Math.random();
    if (d < 0.35) return TILE_CRATE;
    if (d < 0.60) return TILE_BARREL;
    if (d < 0.80) return TILE_SANDBAG;
    return TILE_TIRE;
}

/**
 * Убрать одиночные стены (окружённые пустотой со всех 4 сторон).
 */
function removeIsolatedWalls(map) {
    for (let y = 1; y < MAP_SIZE - 1; y++) {
        for (let x = 1; x < MAP_SIZE - 1; x++) {
            const t = map[y][x];
            if (t === TILE_EMPTY || t === TILE_TIRE || t === TILE_BUSH) continue;
            if (t === TILE_WATER) continue;

            const up = map[y - 1][x];
            const down = map[y + 1][x];
            const left = map[y][x - 1];
            const right = map[y][x + 1];

            const isWall = (v) => v !== TILE_EMPTY && v !== TILE_TIRE && v !== TILE_BUSH && v !== TILE_WATER;
            const neighbors = [up, down, left, right].filter(isWall).length;

            // Одиночная стена — если ни один сосед не стена
            if (neighbors === 0) {
                map[y][x] = TILE_EMPTY;
            }
        }
    }
}

/**
 * Проверка играбельности: путь от P1 до P2 через BFS.
 */
function isMapPlayable(map) {
    const visited = [];
    for (let y = 0; y < MAP_SIZE; y++) {
        visited.push(new Array(MAP_SIZE).fill(false));
    }

    const queue = [{ x: P1_SPAWN.x, y: P1_SPAWN.y }];
    visited[P1_SPAWN.y][P1_SPAWN.x] = true;

    while (queue.length > 0) {
        const { x, y } = queue.shift();

        if (x === P2_SPAWN.x && y === P2_SPAWN.y) return true;

        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
            if (visited[ny][nx]) continue;

            if (!isPassable(map[ny][nx])) continue;

            visited[ny][nx] = true;
            queue.push({ x: nx, y: ny });
        }
    }

    return false;
}

/**
 * Проходим ли тайл для танка? (BFS-логика)
 */
function isPassable(tile) {
    return tile === TILE_EMPTY ||
           tile === TILE_BUSH ||
           tile === TILE_TIRE;
           // ВАЖНО: ящик непроходим, пока не сломан. Убираем из проходимых.
}

/**
 * Fallback-карта: простой крест в центре, всё остальное — пусто.
 */
function buildFallbackMap() {
    const map = [];
    for (let y = 0; y < MAP_SIZE; y++) {
        const row = [];
        for (let x = 0; x < MAP_SIZE; x++) {
            row.push(TILE_EMPTY);
        }
        map.push(row);
    }
    for (let i = 2; i < MAP_SIZE - 2; i++) {
        map[6][i] = TILE_BRICK;
        map[i][6] = TILE_BRICK;
    }
    return map;
}

/**
 * Очистить прямоугольник (сделать все тайлы EMPTY).
 */
function clearArea(map, x, y, w, h) {
    for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < MAP_SIZE && nx >= 0 && nx < MAP_SIZE) {
                map[ny][nx] = TILE_EMPTY;
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

    // Непроходимые
    if (tile === TILE_BRICK) return false;
    if (tile === TILE_STEEL) return false;
    if (tile === TILE_WATER) return false;
    if (tile === TILE_CRATE) return false;     // 📦 ящик — стена
    if (tile === TILE_BARREL) return false;    // 🛢️ бочка — стена
    if (tile === TILE_SANDBAG) return false;   // 🧱 мешки — стена

    // Проходимые: EMPTY, BUSH, TIRE

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
/**
 * v1.27.0: респавн отключён — 5 попаданий = смерть навсегда.
 * Функция оставлена пустой (для совместимости с tickGame).
 */
function respawnTanks(game) {
    // Ничего не делаем. Раньше танки возрождались через RESPAWN_TICKS,
    // теперь — конец партии при потере всех жизней.
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

        // v1.28.0: запоминаем выстрел для тумана (вспышка у соперника)
    game.lastShots[key] = { x: tank.x, y: tank.y, tick: game.tick };

    // v1.29.0: выстрел в упор — обработка разных тайлов
    if (tile === TILE_BRICK) {
        game.map[ny][nx] = TILE_EMPTY;
        return null;
    }
    if (tile === TILE_CRATE) {   // 📦 ящик ломается как кирпич
        game.map[ny][nx] = TILE_EMPTY;
        return null;
    }
    if (tile === TILE_STEEL) return null;   // бетон — не пробить
    if (tile === TILE_BARREL) return null;  // 🛢️ бочка — не пробить
    if (tile === TILE_SANDBAG) return null; // 🧱 мешки — не пробить


    // Всё остальное (пусто, кусты, вода) — снаряд создаётся
    // и полетит дальше. Попадание в базу обработает updateBullets
    // (для случая, когда снаряд долетел до неё).
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

    // 📦 Ящик — ломается как кирпич.
    if (tile === TILE_CRATE) {
        game.map[ny][nx] = TILE_EMPTY;
        return 'destroy';
    }

    // Бетон — не ломается, снаряд исчезает.
    if (tile === TILE_STEEL) return 'destroy';

    // 🛢️ Бочка — не ломается.
    if (tile === TILE_BARREL) return 'destroy';

    // 🧱 Мешки — не ломаются.
    if (tile === TILE_SANDBAG) return 'destroy';

    // Вода — снаряд пролетает.
    if (tile === TILE_WATER) return 'continue';

    // Кусты — снаряд пролетает.
    if (tile === TILE_BUSH) return 'continue';

    // ⚫ Покрышка — снаряд пролетает.
    if (tile === TILE_TIRE) return 'continue';

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
        // v1.27.0: 5 попаданий — танк мёртв навсегда. Конец партии.
        tank.alive = false;
        tank.respawnAt = Infinity;
    }
    // Если lives > 0 — танк продолжает жить, респавн не нужен.
}