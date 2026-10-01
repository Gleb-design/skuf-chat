// ========================================================
// public/domino.js — клиентская логика Домино (v1.24.1)
// ========================================================
// Загружается ПОСЛЕ client.js. Использует глобальный socket.

(function() {
    'use strict';

    // ========================================================
    // ЭЛЕМЕНТЫ UI
    // ========================================================
    const overlay = document.getElementById('dominoOverlay');
    const exitBtn = document.getElementById('dominoExitBtn');
    const boardEl = document.getElementById('dominoBoard');
    const handEl = document.getElementById('dominoHand');
    const opponentEl = document.getElementById('dominoOpponent');
    const opponentCountEl = document.getElementById('dominoOpponentCount');
    const bazaarCountEl = document.getElementById('dominoBazaarCount');
    const drawBtn = document.getElementById('dominoDrawBtn');
    const passBtn = document.getElementById('dominoPassBtn');
    const statusMsgEl = document.getElementById('dominoStatusMsg');

    // Чат
    const chatLog = document.getElementById('dominoChatLog');
    const chatInput = document.getElementById('dominoChatInput');
    const chatSendBtn = document.getElementById('dominoChatSendBtn');

    if (!overlay) {
        console.warn('⚠️ Домино: оверлей не найден');
        return;
    }

    // ========================================================
    // СОСТОЯНИЕ
    // ========================================================
    const state = {
        gameId: null,
        myHand: [],
        opponentHandCount: 0,
        bazaarCount: 0,
        board: { tiles: [], leftEnd: null, rightEnd: null },
        turn: null,                 // 'you' | 'opponent'
        myPlayerKey: null,          // 'player1' | 'player2' (получим из game_started)
        phase: null,                // 'battle' | 'finished'
    };

    // ========================================================
    // ОТКРЫТИЕ / ЗАКРЫТИЕ ОВЕРЛЕЯ
    // ========================================================
    function openOverlay() {
        overlay.classList.remove('hidden');
        statusMsgEl.textContent = '';
        if (chatLog) chatLog.innerHTML = '';
    }

    function closeOverlay() {
        overlay.classList.add('hidden');
        state.gameId = null;
        state.myHand = [];
        state.opponentHandCount = 0;
        state.bazaarCount = 0;
        state.board = { tiles: [], leftEnd: null, rightEnd: null };
        state.turn = null;
        state.phase = null;
    }

    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            if (state.gameId) {
                socket.emit('game_leave', { gameId: state.gameId });
            }
            closeOverlay();
        });
    }

    // ========================================================
    // ОТРИСОВКА
    // ========================================================

    // Создаёт DOM-элемент кости
    function createTileEl(tile, opts = {}) {
        const el = document.createElement('div');
        el.className = 'domino-tile';
        if (tile.isDouble) el.classList.add('double');
        if (opts.disabled) el.classList.add('disabled');

        // ⚠️ Учитываем orientation при отображении:
        //   normal:  a-b
        //   flipped: b-a
        //   без orientation (в руке): a-b (порядок как есть)
        let displayA, displayB;

        if (opts.respectOrientation && tile.orientation === 'flipped') {
            displayA = tile.b;
            displayB = tile.a;
        } else if (opts.respectOrientation && tile.orientation === 'normal') {
            displayA = tile.a;
            displayB = tile.b;
        } else {
            // По умолчанию (в руке) — без сортировки, как есть
            displayA = tile.a;
            displayB = tile.b;
        }

        el.textContent = `${displayA}-${displayB}`;
        el.dataset.tileId = tile.id;
        return el;
    }

    // Рука игрока
    function renderHand() {
        if (!handEl) return;
        handEl.innerHTML = '';

        if (!state.myHand || state.myHand.length === 0) return;

        for (const tile of state.myHand) {
            // Определяем, можно ли выложить
            const canPlay = canPlayTileClient(tile, state.board);
            const el = createTileEl(tile, { disabled: !canPlay && state.board.tiles.length > 0 });

            el.addEventListener('click', () => {
                if (state.turn !== 'you') {
                    statusMsgEl.textContent = '⌛ Не твой ход.';
                    return;
                }
                if (!canPlay && state.board.tiles.length > 0) {
                    statusMsgEl.textContent = '❌ Эту кость нельзя выложить.';
                    return;
                }
                socket.emit('game_action', {
                    gameId: state.gameId,
                    action: 'play_tile',
                    data: { tileId: tile.id },
                });
                statusMsgEl.textContent = '💥 Ходим...';
            });

            handEl.appendChild(el);
        }
    }

    // Проверка: можно ли выложить кость (упрощённая, для UI)
    function canPlayTileClient(tile, board) {
        if (!board.tiles || board.tiles.length === 0) return true;
        const left = board.leftEnd;
        const right = board.rightEnd;
        return tile.a === left || tile.b === left
            || tile.a === right || tile.b === right;
    }

    // Доска (змейка)
    function renderBoard() {
        if (!boardEl) return;
        boardEl.innerHTML = '';

        if (!state.board.tiles || state.board.tiles.length === 0) return;

        for (const tile of state.board.tiles) {
            const el = createTileEl(tile, { respectOrientation: true });
            boardEl.appendChild(el);
        }
    }

    // Инфа: соперник, базар
    function renderInfo() {
        if (opponentCountEl) {
            opponentCountEl.textContent = `🀄 ${state.opponentHandCount}`;
        }
        if (bazaarCountEl) {
            bazaarCountEl.textContent = `🃏 ${state.bazaarCount}`;
        }
    }

    // Кнопки управления
    function renderControls() {
        if (!drawBtn || !passBtn) return;

        const isMyTurn = state.turn === 'you';
        const canPlayAny = canPlayAnyClient();

        // Кнопка «Взять из базара» — только если не могу играть И базар не пуст
        if (isMyTurn && !canPlayAny && state.bazaarCount > 0) {
            drawBtn.classList.remove('hidden');
        } else {
            drawBtn.classList.add('hidden');
        }

        // Кнопка «Пас» — только если не могу играть И базар пуст
        if (isMyTurn && !canPlayAny && state.bazaarCount === 0) {
            passBtn.classList.remove('hidden');
        } else {
            passBtn.classList.add('hidden');
        }
    }

    // Проверка: есть ли хоть одна подходящая кость
    function canPlayAnyClient() {
        if (!state.myHand || state.myHand.length === 0) return false;
        if (!state.board.tiles || state.board.tiles.length === 0) return true;
        return state.myHand.some((tile) => canPlayTileClient(tile, state.board));
    }

    // Полная перерисовка
    function renderAll() {
        renderHand();
        renderBoard();
        renderInfo();
        renderControls();
    }

    // ========================================================
    // КНОПКИ ДЕЙСТВИЙ
    // ========================================================
    if (drawBtn) {
        drawBtn.addEventListener('click', () => {
            if (!state.gameId) return;
            socket.emit('game_action', {
                gameId: state.gameId,
                action: 'draw_from_bazaar',
                data: {},
            });
            statusMsgEl.textContent = '🃏 Берём из базара...';
        });
    }

    if (passBtn) {
        passBtn.addEventListener('click', () => {
            if (!state.gameId) return;
            socket.emit('game_action', {
                gameId: state.gameId,
                action: 'pass',
                data: {},
            });
            statusMsgEl.textContent = '⏭ Пас...';
        });
    }

    // ========================================================
    // SOCKET-СОБЫТИЯ
    // ========================================================

    // Игра началась (после accept)
    socket.on('game_started', ({ gameId, state: moduleState }) => {
        state.gameId = gameId;

        // Определяем наш playerKey
        // ⚠️ В serializeFor мы уже отдаём myHand / opponentHandCount / turn —
        // значит, знаем только «you/opponent». playerKey из другого источника.
        // Для MVP: myPlayerKey не нужен на клиенте, всё приходит в moduleState.

        state.myHand = moduleState.myHand || [];
        state.opponentHandCount = moduleState.opponentHandCount || 0;
        state.bazaarCount = moduleState.bazaarCount || 0;
        state.board = moduleState.board || { tiles: [], leftEnd: null, rightEnd: null };
        state.turn = moduleState.turn || null;
        state.phase = moduleState.phase || 'battle';

        openOverlay();
        renderAll();

        if (state.turn === 'you') {
            statusMsgEl.textContent = '🎯 Твой ход!';
        } else {
            statusMsgEl.textContent = '⌛ Ход соперника';
        }

        console.log('🎲 Домино: игра началась', { gameId });
    });

    // Обновление доски / состояния после хода
    // Обновление доски / состояния после хода
    socket.on('game_board_update', (data) => {
        if (!state.gameId) return;

        // Обновляем доску
        if (data.board) state.board = data.board;

        // Обновляем СВОЮ руку (сервер шлёт персонально)
        if (Array.isArray(data.myHand)) {
            state.myHand = data.myHand;
        }

        // Обновляем счётчик костей соперника
        if (typeof data.opponentHandCount === 'number') {
            state.opponentHandCount = data.opponentHandCount;
        }

        // Обновляем базар
        if (typeof data.bazaarCount === 'number') {
            state.bazaarCount = data.bazaarCount;
        }

        // Обновляем ход
        if (data.turn === 'you' || data.turn === 'opponent') {
            state.turn = data.turn;
        } else if (data.turn === null) {
            state.turn = null;
        }

        renderAll();

        // Обновляем статус (кроме финала — там свой обработчик)
        if (state.phase !== 'finished') {
            if (state.turn === 'you') {
                statusMsgEl.textContent = '🎯 Твой ход!';
            } else if (state.turn === 'opponent') {
                statusMsgEl.textContent = '⌛ Ход соперника';
            }
        }
    });

    // Пришла кость из базара (только нам)
    socket.on('game_drew_tile', ({ tile }) => {
        if (!tile) return;
        state.myHand.push(tile);
        state.bazaarCount = Math.max(0, state.bazaarCount - 1);
        renderAll();
        statusMsgEl.textContent = `🃏 Взяли: ${tile.a}-${tile.b}`;
    });

    // Игра закончилась
    socket.on('game_finished', ({ winner, reason, fishPoints }) => {
        state.phase = 'finished';

        if (winner === 'you') {
            statusMsgEl.textContent = '🏆 Победа! Скуф-доминошник!';
        } else if (winner === 'draw') {
            statusMsgEl.textContent = '🤝 Ничья по рыбе!';
        } else {
            statusMsgEl.textContent = '💀 Поражение... В следующий раз повезёт.';
        }

        if (fishPoints) {
            statusMsgEl.textContent += ` (${fishPoints.player1} vs ${fishPoints.player2})`;
        }

        renderControls();
        // Кнопки «Взять» / «Пас» — спрячутся (state.turn не 'you')
    });

    // ---- Мини-чат (переиспользуем game_chat) ----
    function sendChat() {
        if (!chatInput || !state.gameId) return;
        const text = chatInput.value.trim();
        if (!text) return;

        socket.emit('game_chat', { gameId: state.gameId, text });
        chatInput.value = '';
        chatInput.focus();
    }

    if (chatSendBtn) chatSendBtn.addEventListener('click', sendChat);
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChat();
        });
    }

    socket.on('game_chat_msg', ({ from, fromUsername, text }) => {
        if (!chatLog) return;

        const isMe = from === 'player1' ? false : false; // TODO: определить
        const msg = document.createElement('div');
        msg.className = `game-chat-msg ${isMe ? 'me' : 'opponent'}`;
        msg.innerHTML = `<strong>${escapeHtmlDomino(fromUsername)}:</strong> ${escapeHtmlDomino(text)}`;
        chatLog.appendChild(msg);
        chatLog.scrollTop = chatLog.scrollHeight;
    });

    function escapeHtmlDomino(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ========================================================
    // ЗАГРУЗКА
    // ========================================================

        // ========================================================
    // КНОПКА «🎲 ДОМИНО» В ПРИВАТЕ
    // ========================================================
    const btnDomino = document.getElementById('btnDomino');

    if (btnDomino) {
        btnDomino.addEventListener('click', () => {
            // Проверяем, что мы в привате
            const privateControls = document.getElementById('privateControls');
            const isPrivateMode = privateControls && !privateControls.classList.contains('hidden');

            if (!isPrivateMode) {
                console.warn('🎲 Домино: доступно только в привате 1-на-1');
                return;
            }

            // Отправляем приглашение с типом игры
            socket.emit('game_invite', { gameType: 'domino' });
            // Оверлей откроется, когда соперник примет (game_started)
        });
    }
    console.log('🎲 Домино: клиентский модуль загружен');
})();