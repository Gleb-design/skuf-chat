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
        TILE_WATER = 3, TILE_BUSH = 4, TILE_BASE = 5;

    // ---------- Цвета тайлов ----------
    const TILE_COLORS = {
        0: '#222',        // empty
        1: '#8b3a1c',     // brick
        2: '#777',        // steel
        3: '#1e4c8b',     // water
        4: '#2a5a2a',     // bush
        5: '#d4a017',     // base (жёлтая)
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
        state.myBase = s.myBase;
        state.opponentBase = s.opponentBase;
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

        // 1. Очистка
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // 2. Карта
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const t = state.map[y][x];
                drawTile(x, y, t);
            }
        }

        // 3. Базы (поверх — они уже внутри карты как TILE_BASE, но
        //    если база уничтожена — рисуем крест)
        if (state.myBase && !state.myBase.alive) {
            drawDestroyedBase(state.myBase.x, state.myBase.y);
        }
        if (state.opponentBase && !state.opponentBase.alive) {
            drawDestroyedBase(state.opponentBase.x, state.opponentBase.y);
        }

        // 4. Танки
        if (state.opponentTank && state.opponentTank.alive) {
            drawTank(state.opponentTank, '#c0392b'); // враг — красный
        }
        if (state.myTank && state.myTank.alive) {
            drawTank(state.myTank, '#27ae60');       // я — зелёный
        }

        // 5. Снаряды (пока пусто, но код готов)
        for (const b of state.bullets) {
            drawBullet(b);
        }
    }

    function drawTile(x, y, t) {
        const px = x * CELL;
        const py = y * CELL;

        if (t === TILE_EMPTY) return; // фон уже чёрный

        ctx.fillStyle = TILE_COLORS[t] || '#000';
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);

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
        const px = tank.x * CELL;
        const py = tank.y * CELL;
        const pad = 4;

        // Основа
        ctx.fillStyle = color;
        ctx.fillRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2);

        // Контур
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2);

        // Ствол (в сторону dir)
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.beginPath();
        const cx = px + CELL / 2;
        const cy = py + CELL / 2;
        const len = CELL / 2;
        if (tank.dir === 'up') { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - len); }
        if (tank.dir === 'down') { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + len); }
        if (tank.dir === 'left') { ctx.moveTo(cx, cy); ctx.lineTo(cx - len, cy); }
        if (tank.dir === 'right') { ctx.moveTo(cx, cy); ctx.lineTo(cx + len, cy); }
        ctx.stroke();
    }

    function drawBullet(b) {
        const cx = b.x * CELL + CELL / 2;
        const cy = b.y * CELL + CELL / 2;
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawDestroyedBase(x, y) {
        const px = x * CELL;
        const py = y * CELL;
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
            socket.emit('game_action', {
                gameId: state.gameId,
                action: 'input',
                data: { ...input },
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