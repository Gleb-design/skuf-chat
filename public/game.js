// ========================================================
// game.js — клиентская логика Морского боя (v1.22.0)
// ========================================================
// Загружается ПОСЛЕ client.js, использует глобальный socket.

(function() {
    'use strict';

    // ========================================================
    // ЭЛЕМЕНТЫ UI
    // ========================================================
    const overlay = document.getElementById('gameOverlay');
    const exitBtn = document.getElementById('gameExitBtn');
    const myBoardEl = document.getElementById('myBoard');
    const enemyBoardEl = document.getElementById('enemyBoard');
    const opponentNameEl = document.getElementById('gameOpponentName');
    const turnIndicatorEl = document.getElementById('gameTurnIndicator');
    const randomBtn = document.getElementById('gameRandomBtn');
    const readyBtn = document.getElementById('gameReadyBtn');
    const statusMsgEl = document.getElementById('gameStatusMsg');
    const btnGame = document.getElementById('btnGame');

    if (!overlay || !btnGame) {
        console.warn('⚠️ Морской бой: UI-элементы не найдены, модуль не запущен');
        return;
    }

    // ========================================================
    // СОСТОЯНИЕ
    // ========================================================
    const state = {
        gameId: null,
        phase: null,          // 'waiting' | 'placing' | 'battle' | 'finished'
        turn: null,           // 'you' | 'opponent'
        myBoard: [],          // 10×10
        enemyBoard: [],       // 10×10
        opponentName: '',
    };

    const BOARD_SIZE = 10;

    // ========================================================
    // ОТРИСОВКА
    // ========================================================

    // Создаёт пустое поле 10×10 в виде сетки div-ов
    function renderEmptyBoard(boardEl, onClickCell) {
        boardEl.innerHTML = '';
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                const cell = document.createElement('div');
                cell.className = 'game-cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                if (onClickCell) {
                    cell.addEventListener('click', () => onClickCell(x, y));
                }
                boardEl.appendChild(cell);
            }
        }
    }

    // Отрисовывает поле с кораблями (пришло с сервера после расстановки)
// board — 2D массив, где клетка либо null, либо { ship: true, hit: false }, либо { miss: true }
function renderMyBoard(boardEl, board) {
    boardEl.innerHTML = '';
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const cell = document.createElement('div');
            cell.className = 'game-cell';
            cell.dataset.x = x;
            cell.dataset.y = y;

            const data = board[y] && board[y][x] ? board[y][x] : null;

            if (data && data.ship) {
                cell.classList.add('ship');
                if (data.hit) cell.classList.add('hit');
            } else if (data && data.miss) {
                cell.classList.add('miss');
            }

            boardEl.appendChild(cell);
        }
    }
}

// Отрисовывает результат выстрела на конкретной клетке
// targetEl — boardEl (myBoardEl или enemyBoardEl)
// x, y — координаты
// result — 'miss' | 'hit' | 'sunk'
function renderShotResult(boardEl, x, y, result) {
    const cell = boardEl.querySelector(`.game-cell[data-x="${x}"][data-y="${y}"]`);
    if (!cell) return;

    // Убираем предыдущие классы результата
    cell.classList.remove('ship', 'hit', 'miss', 'sunk');

    if (result === 'miss') {
        cell.classList.add('miss');
    } else if (result === 'hit') {
        cell.classList.add('hit');
    } else if (result === 'sunk') {
        cell.classList.add('sunk');  // для потопленного — особый стиль
    }
}

// Отрисовывает поле врага (только попадания/промахи + обработчики кликов)
function renderEnemyBoard(boardEl, board) {
    boardEl.innerHTML = '';
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const cell = document.createElement('div');
            cell.className = 'game-cell';
            cell.dataset.x = x;
            cell.dataset.y = y;

            const data = board[y] && board[y][x] ? board[y][x] : null;

            if (data && data.hit) {
                cell.classList.add('hit');
            } else if (data && data.miss) {
                cell.classList.add('miss');
            }

            // Клик по клетке — выстрел
            cell.addEventListener('click', () => handleEnemyCellClick(x, y));

            boardEl.appendChild(cell);
        }
    }
}

// Обработчик клика по клетке врага
function handleEnemyCellClick(x, y) {
    // Проверки
    if (state.phase !== 'battle') return;
    if (!state.gameId) return;
    if (state.turn !== 'you') {
        statusMsgEl.textContent = '⌛ Не твой ход. Ждём соперника.';
        return;
    }

    // Проверяем, что клетка не обстреляна
    const cell = enemyBoardEl.querySelector(`.game-cell[data-x="${x}"][data-y="${y}"]`);
    if (cell && (cell.classList.contains('hit') || cell.classList.contains('miss'))) {
        return; // уже стреляли
    }

    // Отправляем выстрел
    socket.emit('game_shot', { gameId: state.gameId, x, y });
    statusMsgEl.textContent = '💥 Стреляем...';
}

    // ========================================================
    // ОТКРЫТИЕ / ЗАКРЫТИЕ ОВЕРЛЕЯ
    // ========================================================
    function openOverlay() {
        overlay.classList.remove('hidden');
        // Рисуем пустые поля (пока без данных)
        renderEmptyBoard(myBoardEl, null);
        renderEmptyBoard(enemyBoardEl, null);
        statusMsgEl.textContent = 'Ожидание приглашения...';
    }

    function closeOverlay() {
        overlay.classList.add('hidden');
        // Сбрасываем состояние
        state.gameId = null;
        state.phase = null;
        state.myBoard = [];
        state.enemyBoard = [];
    }

    // ========================================================
    // КНОПКИ
    // ========================================================

    // «🚢 Морской бой» в .private-controls — отправляет приглашение
    btnGame.addEventListener('click', () => {
        socket.emit('game_invite');
        openOverlay();
        statusMsgEl.textContent = 'Приглашение отправлено...';
    });

    // Выход из оверлея
    exitBtn.addEventListener('click', () => {
        if (state.gameId) {
            socket.emit('game_leave', { gameId: state.gameId });
        }
        closeOverlay();
    });

    // ========================================================
    // SOCKET-СОБЫТИЯ (пока только базовые)
    // ========================================================

    socket.on('game_invite_sent', ({ toUsername }) => {
        statusMsgEl.textContent = `🎯 Приглашение отправлено: ${toUsername}`;
    });

    socket.on('game_error', ({ reason }) => {
        const messages = {
            not_in_private: 'Игра доступна только в привате 1-на-1.',
            already_in_game: 'Ты уже в игре.',
            no_partner: 'Собеседник не найден.',
            partner_busy: 'Собеседник уже занят игрой.',
            game_not_found: 'Игра не найдена.',
            not_a_player: 'Ты не участник этой игры.',
            wrong_phase: 'Не та фаза игры.',
            bad_coords: 'Неверные координаты.',
            not_your_turn: 'Сейчас не твой ход.',
            already_shot: 'Сюда уже стреляли.',
        };
        statusMsgEl.textContent = '⚠️ ' + (messages[reason] || reason);
        console.warn('⚠️ game_error:', reason);
    });

        // ========================================================
    // ПРИЁМ ПРИГЛАШЕНИЯ
    // ========================================================

    // Элементы плашки приглашения
    const gameInviteBar = document.getElementById('gameInviteBar');
    const gameInviteText = document.getElementById('gameInviteText');
    const gameInviteAcceptBtn = document.getElementById('gameInviteAcceptBtn');
    const gameInviteDeclineBtn = document.getElementById('gameInviteDeclineBtn');

    // Показывает плашку «Игрок X зовёт в Морской бой»
    function showGameInviteBar(fromUsername, gameId) {
        hideGameInviteBar(); // на случай повторных вызовов

        if (!gameInviteBar || !gameInviteText) return;

        gameInviteText.textContent = `${fromUsername} зовёт в Морской бой`;
        gameInviteBar.dataset.gameId = gameId; // запоминаем gameId
        gameInviteBar.classList.remove('hidden');

        // Авто-скрытие через 30 секунд
        if (window.__gameInviteTimeoutId) {
            clearTimeout(window.__gameInviteTimeoutId);
        }
        window.__gameInviteTimeoutId = setTimeout(() => {
            if (!gameInviteBar.classList.contains('hidden')) {
                socket.emit('game_decline', { gameId });
                hideGameInviteBar();
            }
        }, 30000);
    }

    function hideGameInviteBar() {
        if (gameInviteBar) {
            gameInviteBar.classList.add('hidden');
            gameInviteBar.dataset.gameId = '';
        }
        if (window.__gameInviteTimeoutId) {
            clearTimeout(window.__gameInviteTimeoutId);
            window.__gameInviteTimeoutId = null;
        }
    }

    // Кнопка «Принять»
    if (gameInviteAcceptBtn) {
        gameInviteAcceptBtn.addEventListener('click', () => {
            const gameId = gameInviteBar?.dataset.gameId;
            if (!gameId) return;
            socket.emit('game_accept', { gameId });
            hideGameInviteBar();
        });
    }

    // Кнопка «Отклонить»
    if (gameInviteDeclineBtn) {
        gameInviteDeclineBtn.addEventListener('click', () => {
            const gameId = gameInviteBar?.dataset.gameId;
            if (!gameId) return;
            socket.emit('game_decline', { gameId });
            hideGameInviteBar();
        });
    }

    // ========================================================
    // SOCKET-СОБЫТИЯ ПРИГЛАШЕНИЯ
    // ========================================================

    // Пришло приглашение от другого игрока
    socket.on('game_invited', ({ gameId, fromUsername }) => {
        showGameInviteBar(fromUsername, gameId);
    });

    // Отправителю: получатель принял → начинается расстановка
    // (сервер шлёт game_placing обоим после accept)

    // Получили сигнал о начале расстановки
    socket.on('game_placing', ({ gameId }) => {
        state.gameId = gameId;
        state.phase = 'placing';

        // Открываем оверлей, если ещё не открыт
        if (overlay.classList.contains('hidden')) {
            overlay.classList.remove('hidden');
            renderEmptyBoard(myBoardEl, null);
            renderEmptyBoard(enemyBoardEl, null);
        }

        statusMsgEl.textContent = '⚙️ Расстановка кораблей...';
        opponentNameEl.textContent = 'Соперник: найден';

        // Показываем кнопки расстановки (пока заглушки — этап 1.2.2.2)
        if (randomBtn) randomBtn.classList.remove('hidden');
        if (readyBtn) readyBtn.classList.remove('hidden');
    });

    // Получателю: отправитель отклонил? — уже обрабатывается на сервере
    // Отправителю: получатель отклонил приглашение
    socket.on('game_declined', ({ byUsername }) => {
        statusMsgEl.textContent = `🚫 ${byUsername} отказался от игры.`;
        // Закрываем оверлей через 2 секунды
        setTimeout(() => {
            closeOverlay();
        }, 2000);
    });

        // ========================================================
    // РАССТАНОВКА И СТАРТ БОЯ
    // ========================================================

    // Кнопка «🎲 Расставить случайно»
    if (randomBtn) {
        randomBtn.addEventListener('click', () => {
            if (!state.gameId) {
                statusMsgEl.textContent = '⚠️ Игра не найдена.';
                return;
            }
            socket.emit('game_place_ships', {
                gameId: state.gameId,
                random: true,
            });
            statusMsgEl.textContent = '🎲 Расставляем случайно...';
        });
    }

    // Кнопка «✅ Готов»
    if (readyBtn) {
        readyBtn.addEventListener('click', () => {
            if (!state.gameId) {
                statusMsgEl.textContent = '⚠️ Игра не найдена.';
                return;
            }
            // Пока — то же самое, что «Расставить случайно»
            // TODO: в 1.2.2.3 отправлять реальный board
            socket.emit('game_place_ships', {
                gameId: state.gameId,
                random: true,
            });
            statusMsgEl.textContent = '✅ Готов. Ждём соперника...';
            readyBtn.classList.add('hidden');  // скрыть кнопку «Готов» после нажатия
        });
    }

    // Сервер прислал подтверждение расстановки
    socket.on('game_board_accepted', ({ gameId, board }) => {
        state.myBoard = board;
        renderMyBoard(myBoardEl, board);
        statusMsgEl.textContent = 'Корабли расставлены. Жми «✅ Готов», когда готов.';
    });

    // Фаза боя началась (оба готовы)
    socket.on('game_battle', ({ gameId, turn, myBoard, enemyBoard, opponentName }) => {
        state.gameId = gameId;
        state.phase = 'battle';
        state.turn = turn;
        state.myBoard = myBoard;
        state.enemyBoard = enemyBoard;
        state.opponentName = opponentName || 'Соперник';

        // Скрываем кнопки расстановки
        if (randomBtn) randomBtn.classList.add('hidden');
        if (readyBtn) readyBtn.classList.add('hidden');

        // Обновляем UI
        opponentNameEl.textContent = `Соперник: ${state.opponentName}`;
        renderMyBoard(myBoardEl, myBoard);
        renderEnemyBoard(enemyBoardEl, enemyBoard);  // ← новая функция с кликами

        // Показываем чей ход
        if (turn === 'you') {
            turnIndicatorEl.textContent = '🎯 Твой ход!';
            statusMsgEl.textContent = 'Стреляй по полю врага.';
        } else {
            turnIndicatorEl.textContent = '⌛ Ход соперника';
            statusMsgEl.textContent = 'Ждём хода соперника...';
        }
    });

    // ========================================================
    // ВЫСТРЕЛЫ
    // ========================================================

    // Наш выстрел — результат
    socket.on('game_shot_result', ({ x, y, result, turn }) => {
        // Рисуем на поле врага
        renderShotResult(enemyBoardEl, x, y, result);

        // Обновляем ход
        if (turn) {
            state.turn = turn;
            if (turn === 'you') {
                turnIndicatorEl.textContent = '🎯 Твой ход!';
                if (result === 'hit' || result === 'sunk') {
                    statusMsgEl.textContent = result === 'sunk' ? '☠️ Потопил! Стреляй ещё.' : '🔥 Попал! Стреляй ещё.';
                } else {
                    statusMsgEl.textContent = '💧 Мимо.';
                }
            } else {
                turnIndicatorEl.textContent = '⌛ Ход соперника';
                statusMsgEl.textContent = 'Ждём хода соперника...';
            }
        }
    });

    // Соперник стрелял — результат на нашем поле
    socket.on('game_opponent_shot', ({ x, y, result, turn }) => {
        // Рисуем на своём поле
        renderShotResult(myBoardEl, x, y, result);

        // Обновляем ход
        if (turn) {
            state.turn = turn;
            if (turn === 'you') {
                turnIndicatorEl.textContent = '🎯 Твой ход!';
                statusMsgEl.textContent = 'Твой ход! Стреляй.';
            } else {
                turnIndicatorEl.textContent = '⌛ Ход соперника';
            }
        }
    });

    // Игра завершена
    socket.on('game_finished', ({ winner, reason }) => {
        if (randomBtn) randomBtn.classList.add('hidden');
        if (readyBtn) readyBtn.classList.add('hidden');

        if (winner === 'you') {
            statusMsgEl.textContent = '🏆 Победа! Скуф-адмирал!';
        } else {
            statusMsgEl.textContent = '💀 Поражение... В следующий раз повезёт.';
        }

        // Через 5 секунд закрываем оверлей
        setTimeout(() => {
            closeOverlay();
        }, 5000);
    });

    // Второй игрок принял — отправитель закрывает любые плашки
    socket.on('game_accepted', ({ gameId }) => {
        hideGameInviteBar();
    });

    console.log('🚢 Морской бой: клиентский модуль загружен');
})();

