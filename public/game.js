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

    // Второй игрок принял — отправитель закрывает любые плашки
    socket.on('game_accepted', ({ gameId }) => {
        hideGameInviteBar();
    });

    console.log('🚢 Морской бой: клиентский модуль загружен');
})();

