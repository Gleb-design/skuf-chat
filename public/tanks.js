// ========================================================
// public/tanks.js — клиентская логика «Танчиков 1-на-1»
// ========================================================
// Загружается ПОСЛЕ client.js. Использует глобальный socket.
// Задачи:
//   — поймать game_started для tanks → открыть оверлей, отрисовать
//   — ловить game_tick → перерисовывать Canvas
//   — слушать клавиатуру WASD + Space и слать game_action { action: 'input' }
//   — кнопка выхода → game_leave

(function () {
    'use strict';

    // ---------- DOM ----------
    const overlay = document.getElementById('tanksOverlay');
    if (!overlay) {
        console.warn('⚠️ Танчики: оверлей не найден');
        return;
    }

    const exitBtn = document.getElementById('tanksExitBtn');
    const opponentEl = document.getElementById('tanksOpponent');
    const livesEl = document.getElementById('tanksLives');
    const tickEl = document.getElementById('tanksTick');
    const canvas = document.getElementById('tanksCanvas');
    const ctx = canvas.getContext('2d');

    // ---------- Состояние ----------
    const state = {
        active: false,
        gameId: null,
        myKey: null,        // 'player1' | 'player2'
        map: null,          // 13×13
        myTank: null,
        opponentTank: null,
        myBase: null,
        opponentBase: null,
        bullets: [],
        tick: 0,
    };

    // ---------- Зеркалирование для Player2 (v1.27.0) ----------
    // Player1 видит карту как есть. Player2 видит отражённую на 180°,
    // чтобы СВОЙ танк всегда был в левом нижнем углу.

    // Преобразовать игровые координаты в экранные
    function toScreenX(x) {
        return (state.myKey === 'player2') ? (MAP_SIZE - 1 - x) : x;
    }
    function toScreenY(y) {
        return (state.myKey === 'player2') ? (MAP_SIZE - 1 - y) : y;
    }

    // Развернуть направление (для ствола танка)
    function flipDir(dir) {
        if (state.myKey !== 'player2') return dir;
        switch (dir) {
            case 'up': return 'down';
            case 'down': return 'up';
            case 'left': return 'right';
            case 'right': return 'left';
            default: return dir;
        }
    }

    // ---------- Ввод ----------
    // Храним текущее зажатое состояние клавиш.
    const input = { up: false, down: false, left: false, right: false, shoot: false };
    let inputDirty = false;    // нужно ли отправить на сервер
    let inputTimer = null;     // таймер throttle

    // ---------- Константы рендера ----------
    const MAP_SIZE = 13;
    const CANVAS_SIZE = canvas.width;           // 650
    const CELL = Math.floor(CANVAS_SIZE / MAP_SIZE);   // 50
    const TILE_EMPTY = 0, TILE_BRICK = 1, TILE_STEEL = 2,
          TILE_WATER = 3, TILE_BUSH = 4,
          TILE_CRATE = 5, TILE_BARREL = 6, TILE_SANDBAG = 7, TILE_TIRE = 8,
          TILE_FOG = 9;

    const TILE_COLORS = {
        0: '#2a2a35',     // пустая дорога
        1: '#8b3a1c',     // кирпич
        2: '#777',        // бетон
        3: '#1e4c8b',     // вода
        4: '#2a5a2a',     // кусты
        5: '#a06a30',     // 📦 ящик
        6: '#5a3a1e',     // 🛢️ бочка
        7: '#8a7a5a',     // 🧱 мешки
        8: '#1a1a1a',     // ⚫ покрышка
        9: '#0a0a0a',     // туман
    };

    // ========================================================
    // SOCKET
    // ========================================================
    socket.on('game_started', (payload) => {
        if (!payload || !payload.state) return;
        // v1.26.2: фильтр по типу игры — иначе чужие оверлеи открываются.
        if (payload.gameType && payload.gameType !== 'tanks') return;

        // v1.26.2: скрываем чужие плашки приглашения/ожидания.
        const inviteBar = document.getElementById('gameInviteBar');
        const waitingBar = document.getElementById('gameWaitingBar');
        if (inviteBar) inviteBar.classList.add('hidden');
        if (waitingBar) waitingBar.classList.add('hidden');

        console.log('🛡️ Танчики: игра началась', payload);

        state.active = true;
        state.gameId = payload.gameId;
        // myKey определим по совпадению — на сервере player1 это initiator.
        // Точного признака нет, поэтому пока считаем что 'player1',
        // и корректируем по первому game_tick (там myTank != opponentTank).
        state.myKey = payload.state.youAre || null;

        // Скрываем блок результата (если был от прошлой игры).
        const resultBox = document.getElementById('tanksResultBox');
        const rematchBtn = document.getElementById('tanksRematchBtn');
        if (resultBox) resultBox.classList.add('hidden');
        if (rematchBtn) rematchBtn.classList.add('hidden');

        applyState(payload.state);
        showOverlay();
        startInputLoop();
        redraw();
    });

    socket.on('game_tick', (payload) => {
        if (!state.active) return;
        if (!payload || !payload.state) return;
        applyState(payload.state);
        redraw();
    });

    socket.on('game_finished', (payload) => {
        if (!state.active) return;
        if (payload && payload.gameId && payload.gameId !== state.gameId) return;

        // v1.26.3: это событие от принудительного завершения — не показываем результат.
        if (payload && payload.reason === 'rematch') return;
        state.active = false;
        stopInputLoop();
        input.up = input.down = input.left = input.right = input.shoot = false;
        inputDirty = false;

        // Показываем результат + кнопку «Ещё раз».
        const win = payload.winner === 'you';
        const resultBox = document.getElementById('tanksResultBox');
        const resultMsg = document.getElementById('tanksResultMsg');
        const rematchBtn = document.getElementById('tanksRematchBtn');

        if (resultMsg) {
            resultMsg.textContent = win ? '🏆 Победа!' : '💀 Поражение...';
        }
        if (resultBox) resultBox.classList.remove('hidden');
        if (rematchBtn) rematchBtn.classList.remove('hidden');
    });

    // Кнопка «🔄 Ещё раз» — отправить приглашение тому же сопернику.
    // (обработчик вешаем один раз при загрузке модуля)
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'tanksRematchBtn') {
            const rematchBtn = e.target;
            rematchBtn.classList.add('hidden');
            // v1.26.6: оверлей НЕ закрываем — плашка появится поверх него.
            // gameType по умолчанию в сервере — battleship, поэтому
            // нужно явно указать tanks.
            socket.emit('game_invite', { gameType: 'tanks' });
        }
    });

    socket.on('game_opponent_disconnected', () => {
        if (!state.active) return;
        console.log('⚠️ Соперник отключился, ждём...');
    });

    socket.on('game_opponent_reconnected', () => {
        if (!state.active) return;
        console.log('✅ Соперник вернулся');
    });

    socket.on('game_declined', ({ byUsername }) => {
        // v1.26.6: инициатор отменил приглашение — скрываем плашку.
        const inviteBar = document.getElementById('gameInviteBar');
        if (inviteBar) inviteBar.classList.add('hidden');
        console.log('🚫 Инициатор отменил приглашение:', byUsername);
    });

    // ========================================================
    // Применить состояние с сервера
    // ========================================================
    function applyState(s) {
        state.map = s.map;
        state.myTank = s.myTank;
        state.opponentTank = s.opponentTank;
        state.bullets = s.bullets || [];
        state.tick = s.tick || 0;

        // Обновляем UI инфо
        if (livesEl) livesEl.textContent = '❤️ ' + (state.myTank ? state.myTank.lives : 0);
        if (tickEl) tickEl.textContent = '⏱ ' + state.tick;
    }

    // ========================================================
    // Canvas-рендер
    // ========================================================
    function redraw() {
        if (!state.map) return;

        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // v1.29.2: рисуем карту в 2 прохода.
        // 1) Всё, КРОМЕ кустов.
        // 2) Танки.
        // 3) Кусты (поверх танков — прячут).
        // 4) Снаряды.

        // Проход 1: карта без кустов
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const t = state.map[y][x];
                if (t === TILE_BUSH) continue;   // пропускаем кусты
                drawTile(x, y, t);
            }
        }

        // Проход 2: танки
        if (state.opponentTank && state.opponentTank.alive) {
            drawTank(state.opponentTank, '#c0392b');
        }
        if (state.myTank && state.myTank.alive) {
            drawTank(state.myTank, '#27ae60');
        }

        // Проход 3: кусты (поверх танков — прячут того, кто под ними)
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const t = state.map[y][x];
                if (t !== TILE_BUSH) continue;
                drawTile(x, y, t);
            }
        }

        // Проход 3.5: v1.29.3 — свой танк под кустом рисуем полупрозрачным
        // силуэтом, чтобы игрок видел себя (соперник — нет).
        if (state.myTank && state.myTank.alive) {
            const mx = state.myTank.x;
            const my = state.myTank.y;
            if (state.map[my] && state.map[my][mx] === TILE_BUSH) {
                const sx = toScreenX(mx);
                const sy = toScreenY(my);
                const px = sx * CELL;
                const py = sy * CELL;
                ctx.fillStyle = 'rgba(39, 174, 96, 0.45)';   // зелёный, полупрозрачный
                ctx.fillRect(px + 6, py + 6, CELL - 12, CELL - 12);
                // Тонкий контур
                ctx.strokeStyle = 'rgba(39, 174, 96, 0.9)';
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 6, py + 6, CELL - 12, CELL - 12);
            }
        }

        // Проход 4: снаряды (поверх всего — чтобы не терялись)
        for (const b of state.bullets) {
            drawBullet(b);
        }
    }

    function drawTile(x, y, t) {
        const sx = toScreenX(x);
        const sy = toScreenY(y);
        const px = sx * CELL;
        const py = sy * CELL;

        // v1.29.1: туман — используем TILE_FOG (9), а не [6]
        if (t === TILE_FOG) {
            ctx.fillStyle = TILE_COLORS[9];   // ← фикс
            ctx.fillRect(px, py, CELL, CELL);

            // Диагональные полоски
            ctx.strokeStyle = 'rgba(120, 120, 150, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = -CELL; i < CELL; i += 8) {
                ctx.moveTo(px + i, py);
                ctx.lineTo(px + i + CELL, py + CELL);
            }
            ctx.stroke();
            return;
        }

        if (t === TILE_EMPTY) {
            // v1.28.2: пустая дорога — явно видимая (чуть светлее фона)
            ctx.fillStyle = TILE_COLORS[0];
            ctx.fillRect(px, py, CELL, CELL);
            return;
        }

        // v1.29.0: базы убраны. Декор — рисуем простым цветом + эмодзи.
        const color = TILE_COLORS[t] || '#000';
        ctx.fillStyle = color;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);

        // v1.29.0: эмодзи для декора (v1.29.1 — фикс: цвет сбрасывается на белый)
        if (t === TILE_CRATE || t === TILE_BARREL || t === TILE_SANDBAG || t === TILE_TIRE) {
            const emoji = {
                5: '📦',   // ящик
                6: '🛢️',  // бочка
                7: '🧱',   // мешки
                8: '⚫',   // покрышка
            }[t];

            if (emoji) {
                ctx.font = 'bold 22px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#fff';           // ← ЯВНО белый (не цвет клетки!)
                ctx.fillText(emoji, px + CELL / 2, py + CELL / 2);
            }
        }

        // Кирпич — рисуем «швы»
        if (t === TILE_BRICK) {
            ctx.strokeStyle = '#5a1e08';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, py + CELL / 2);
            ctx.lineTo(px + CELL, py + CELL / 2);
            ctx.moveTo(px + CELL / 2, py);
            ctx.lineTo(px + CELL / 2, py + CELL / 2);
            ctx.moveTo(px + CELL / 4, py + CELL / 2);
            ctx.lineTo(px + CELL / 4, py + CELL);
            ctx.moveTo(px + CELL * 3 / 4, py + CELL / 2);
            ctx.lineTo(px + CELL * 3 / 4, py + CELL);
            ctx.stroke();
        }

        // Вода — волнистый символ
        if (t === TILE_WATER) {
            ctx.fillStyle = '#3a7bd5';
            ctx.fillRect(px + CELL / 4, py + CELL / 2, CELL / 2, 2);
        }

        // Кусты — точки
        if (t === TILE_BUSH) {
            // v1.29.2: плотная заливка, чтобы точно скрыть танк
            ctx.fillStyle = '#2a5a2a';
            ctx.fillRect(px, py, CELL, CELL);   // ← заливка на всю клетку

            // Точки для текстуры
            ctx.fillStyle = '#4a8a4a';
            for (let i = 0; i < 5; i++) {
                const rx = px + 8 + Math.random() * (CELL - 16);
                const ry = py + 8 + Math.random() * (CELL - 16);
                ctx.beginPath();
                ctx.arc(rx, ry, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawTank(tank, color) {
        // Зеркалим координаты и направление
        const sx = toScreenX(tank.x);
        const sy = toScreenY(tank.y);
        const dir = flipDir(tank.dir);

        const px = sx * CELL;
        const py = sy * CELL;
        const pad = 4;

        // Основа
        ctx.fillStyle = color;
        ctx.fillRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2);

        // Контур
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2);

        // Ствол (в развёрнутую сторону)
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.beginPath();
        const cx = px + CELL / 2;
        const cy = py + CELL / 2;
        const len = CELL / 2;
        if (dir === 'up') { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - len); }
        if (dir === 'down') { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + len); }
        if (dir === 'left') { ctx.moveTo(cx, cy); ctx.lineTo(cx - len, cy); }
        if (dir === 'right') { ctx.moveTo(cx, cy); ctx.lineTo(cx + len, cy); }
        ctx.stroke();
    }

    function drawBullet(b) {
        // Зеркалим координаты снаряда
        const sx = toScreenX(b.x);
        const sy = toScreenY(b.y);
        const cx = sx * CELL + CELL / 2;
        const cy = sy * CELL + CELL / 2;
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawDestroyedBase(x, y) {
        // Зеркалим координаты уничтоженной базы
        const sx = toScreenX(x);
        const sy = toScreenY(y);
        const px = sx * CELL;
        const py = sy * CELL;
        ctx.strokeStyle = '#ff2222';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px + 6, py + 6);
        ctx.lineTo(px + CELL - 6, py + CELL - 6);
        ctx.moveTo(px + CELL - 6, py + 6);
        ctx.lineTo(px + 6, py + CELL - 6);
        ctx.stroke();
    }

    // ========================================================
    // Ввод (клавиатура)
    // ========================================================
    function onKeyDown(e) {
        if (!state.active) return;
        if (handleKey(e.code, true)) {
            e.preventDefault();
            inputDirty = true;
        }
    }

    function onKeyUp(e) {
        if (!state.active) return;
        if (handleKey(e.code, false)) {
            e.preventDefault();
            inputDirty = true;
        }
    }

    function handleKey(code, pressed) {
        switch (code) {
            case 'KeyW': case 'ArrowUp': input.up = pressed; return true;
            case 'KeyS': case 'ArrowDown': input.down = pressed; return true;
            case 'KeyA': case 'ArrowLeft': input.left = pressed; return true;
            case 'KeyD': case 'ArrowRight': input.right = pressed; return true;
            case 'Space': input.shoot = pressed; return true;
        }
        return false;
    }

    // Отправляем input на сервер 20 раз в секунду (только если был изменён).
    function startInputLoop() {
        if (inputTimer) return;
        inputTimer = setInterval(() => {
            if (!state.active || !state.gameId) return;
            if (!inputDirty) return;
            inputDirty = false;

            // v1.27.0: для Player2 input разворачивается, потому что он
            // видит зеркальную карту. W (вверх на экране) = down в игровых
            // координатах. То же для остальных направлений.
            let dataToSend = { ...input };
            if (state.myKey === 'player2') {
                dataToSend = {
                    up: input.down,
                    down: input.up,
                    left: input.right,
                    right: input.left,
                    shoot: input.shoot,   // стрельба не реверсируется
                };
            }

            socket.emit('game_action', {
                gameId: state.gameId,
                action: 'input',
                data: dataToSend,
            });
        }, 50);
    }

    function stopInputLoop() {
        if (inputTimer) {
            clearInterval(inputTimer);
            inputTimer = null;
        }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // ========================================================
    // Оверлей
    // ========================================================
    function showOverlay() {
        overlay.classList.remove('hidden');
    }

    function closeOverlay() {
        state.active = false;
        state.gameId = null;
        stopInputLoop();
        overlay.classList.add('hidden');
        // Сбросить зажатые клавиши (чтобы при следующем открытии не висели)
        input.up = input.down = input.left = input.right = input.shoot = false;
        inputDirty = false;
    }

    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            if (state.gameId) {
                socket.emit('game_leave', { gameId: state.gameId });
            }
            closeOverlay();
        });
    }

    console.log('🛡️ Танчики: клиентский модуль загружен');
})();