// ========================================================
// game.js — клиентская логика Морского боя (v1.22.0)
// ========================================================
// Загружается ПОСЛЕ client.js, использует глобальный socket.

(function () {
    'use strict';

    // ========================================================
    // ЗВУКИ ИГРЫ
    // ========================================================
    // Все звуки — короткие mp3 в public/. Громкости подобраны так,
    // чтобы не перекрывать друг друга.
    //   shot  — выстрел (частый, тише)
    //   hit   — попадание (важное)
    //   miss  — промах (тихий)
    //   sunk  — потопление (драматичное, громче)
    //   win   — победа (длиннее, радостное)
    //   lose  — поражение (длиннее, грустное)

    const SOUNDS = {
        shot: { file: '/shot.mp3', volume: 0.3 },
        hit: { file: '/hit.mp3', volume: 0.5 },
        miss: { file: '/miss.mp3', volume: 0.5 },
        sunk: { file: '/sunk.mp3', volume: 0.6 },
        win: { file: '/win.mp3', volume: 0.5 },
        lose: { file: '/lose.mp3', volume: 0.5 },
    };

    // Создаём Audio() один раз (ленивая инициализация)
    const audioPool = {};

    function getAudio(name) {
        if (!SOUNDS[name]) return null;
        if (!audioPool[name]) {
            const a = new Audio(SOUNDS[name].file);
            a.volume = SOUNDS[name].volume;
            a.preload = 'auto';
            audioPool[name] = a;
        }
        return audioPool[name];
    }

    // Проигрывает звук. Безопасно — если ошибка (файл не найден,
    // автоплей заблокирован), тихо игнорируем.
    function playSound(name) {
        const a = getAudio(name);
        if (!a) return;
        try {
            a.currentTime = 0;
            a.play().catch(() => { });   // не спамим консоль
        } catch (err) {
            // no-op
        }
    }

    // ========================================================
    // ЭЛЕМЕНТЫ UI
    // ========================================================
    const overlay = document.getElementById('gameOverlay');
    const exitBtn = document.getElementById('gameExitBtn');
    const myBoardEl = document.getElementById('myBoard');
    const enemyBoardEl = document.getElementById('enemyBoard');
    const opponentNameEl = document.getElementById('gameOpponentName');
    const turnIndicatorEl = document.getElementById('gameTurnIndicator');
    const timerEl = document.getElementById('gameTimer');
    const randomBtn = document.getElementById('gameRandomBtn');
    const readyBtn = document.getElementById('gameReadyBtn');
    const rematchBtn = document.getElementById('gameRematchBtn');
    const statusMsgEl = document.getElementById('gameStatusMsg');
    // btnGame удалён из HTML (заменён на btnPlayGame + меню)

    if (!overlay) {
        console.warn('⚠️ Морской бой: оверлей не найден, модуль не запущен');
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

        // Звук выстрела
        playSound('shot');

        // Отправляем выстрел
        socket.emit('game_shot', { gameId: state.gameId, x, y });
        statusMsgEl.textContent = '💥 Стреляем...';
    }

    // ========================================================
    // ОТКРЫТИЕ / ЗАКРЫТИЕ ОВЕРЛЕЯ
    // ========================================================
    function openOverlay() {
        overlay.classList.remove('hidden');
        renderEmptyBoard(myBoardEl, null);
        renderEmptyBoard(enemyBoardEl, null);
        statusMsgEl.textContent = 'Ожидание приглашения...';
        resetBoardTabs();

        // Скрываем кнопку «Ещё раз» при новой игре
        if (rematchBtn) rematchBtn.classList.add('hidden');

        // Очищаем чат при новой игре
        if (gameChatLog) gameChatLog.innerHTML = '';
    }

    function closeOverlay() {
        // Останавливаем таймер
        stopTurnTimer();
        overlay.classList.add('hidden');
        // Сбрасываем состояние
        state.gameId = null;
        state.phase = null;
        state.myBoard = [];
        state.enemyBoard = [];
        resetBoardTabs();  // ← сброс при закрытии
    }

    // ========================================================
    // ТАЙМЕР ХОДА
    // ========================================================
    // IDLE_TIMEOUT_MS должен совпадать с game-server.js (60 сек).
    // Но мы не полагаемся на это жёстко — таймер сбрасывается при
    // каждом game_shot_result / game_opponent_shot (когда ход меняется).

    const IDLE_TIMEOUT_SEC = 60;

    let timerIntervalId = null;
    let timerSecondsLeft = IDLE_TIMEOUT_SEC;

    // Запускает/перезапускает таймер хода
    function startTurnTimer() {
        // Сбрасываем
        if (timerIntervalId) {
            clearInterval(timerIntervalId);
            timerIntervalId = null;
        }
        timerSecondsLeft = IDLE_TIMEOUT_SEC;

        // Скрываем, если оверлей не в фазе боя
        if (!timerEl) return;
        timerEl.classList.remove('hidden', 'warning');
        updateTimerDisplay();

        // Тик каждую секунду
        timerIntervalId = setInterval(() => {
            timerSecondsLeft--;
            if (timerSecondsLeft <= 0) {
                timerSecondsLeft = 0;
                stopTurnTimer();  // сервер сам завершит игру
                updateTimerDisplay();
                return;
            }
            updateTimerDisplay();
        }, 1000);
    }

    // Останавливает и прячет таймер
    function stopTurnTimer() {
        if (timerIntervalId) {
            clearInterval(timerIntervalId);
            timerIntervalId = null;
        }
        if (timerEl) {
            timerEl.classList.add('hidden');
            timerEl.classList.remove('warning');
        }
    }

    // Обновляет текст таймера (0:60 → 0:59 → 0:58...)
    function updateTimerDisplay() {
        if (!timerEl) return;
        const m = Math.floor(timerSecondsLeft / 60);
        const s = timerSecondsLeft % 60;
        timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;

        // Последние 10 секунд — красным с пульсацией
        if (timerSecondsLeft <= 10) {
            timerEl.classList.add('warning');
        } else {
            timerEl.classList.remove('warning');
        }
    }

    // ========================================================
    // ТАБЫ ПЕРЕКЛЮЧЕНИЯ ПОЛЕЙ (мобилка)
    // ========================================================

    const gameBoardTabs = document.querySelectorAll('.game-board-tab');
    const gameBoards = document.querySelector('.game-boards');

    gameBoardTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.board; // 'my' | 'enemy'

            // Активный таб
            gameBoardTabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            // Переключаем видимость поля
            if (target === 'enemy') {
                gameBoards.classList.add('show-enemy');
            } else {
                gameBoards.classList.remove('show-enemy');
            }
        });
    });

    // При открытии оверлея — сбросить на «Моё поле»
    function resetBoardTabs() {
        if (!gameBoardTabs.length || !gameBoards) return;
        gameBoardTabs.forEach((t) => t.classList.remove('active'));
        const myTab = document.querySelector('.game-board-tab[data-board="my"]');
        if (myTab) myTab.classList.add('active');
        gameBoards.classList.remove('show-enemy');
    }

    // ========================================================
    // МИНИ-ЧАТ
    // ========================================================

    const gameChatLog = document.getElementById('gameChatLog');
    const gameChatInput = document.getElementById('gameChatInput');
    const gameChatSendBtn = document.getElementById('gameChatSendBtn');

    // Мой playerKey в игре ('player1' | 'player2' | null)
    // Узнаём из game_battle — сервер должен прислать youAre
    // (пока может быть null, но это не критично для отображения)

    // Отправка сообщения
    function sendGameChat() {
        if (!gameChatInput || !state.gameId) return;
        const text = gameChatInput.value.trim();
        if (!text) return;

        socket.emit('game_chat', {
            gameId: state.gameId,
            text: text,
        });

        gameChatInput.value = '';
        gameChatInput.focus();
    }

    if (gameChatSendBtn) {
        gameChatSendBtn.addEventListener('click', sendGameChat);
    }
    if (gameChatInput) {
        gameChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendGameChat();
        });
    }

    // Приём сообщений
    socket.on('game_chat_msg', ({ from, fromUsername, text }) => {
        if (!gameChatLog) return;

        // Определяем «моё» это сообщение или соперника
        // state.myPlayerKey приходит с сервера (см. ниже)
        const isMe = state.myPlayerKey && from === state.myPlayerKey;

        const msg = document.createElement('div');
        msg.className = `game-chat-msg ${isMe ? 'me' : 'opponent'}`;
        msg.innerHTML = `<strong>${fromUsername}:</strong> ${escapeHtml(text)}`;
        gameChatLog.appendChild(msg);
        gameChatLog.scrollTop = gameChatLog.scrollHeight;
    });

    // Простая защита от XSS — экранируем HTML в тексте
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ========================================================
    // КНОПКИ
    // ========================================================

    // «🚢 Морской бой» в .private-controls — отправляет приглашение

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
        // Закрываем оверлей (если открыт) и показываем плашку в привате
        closeOverlay();
        showGameWaitingBar(toUsername);
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
    const gameWaitingBar = document.getElementById('gameWaitingBar');
    const gameWaitingText = document.getElementById('gameWaitingText');
    const gameWaitingCancelBtn = document.getElementById('gameWaitingCancelBtn');

    // Показывает плашку «Игрок X зовёт в Морской бой»
    function showGameInviteBar(fromUsername, gameId) {
        hideGameInviteBar(); // на случай повторных вызовов

        if (!gameInviteBar || !gameInviteText) return;

        gameInviteText.textContent = `${fromUsername} зовёт в игру`;
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

    // Показывает плашку «Ждём ответа на приглашение в игру»
    function showGameWaitingBar(toUsername) {
        if (!gameWaitingBar) return;
        if (gameWaitingText) {
            gameWaitingText.textContent = `Ждём ответа от ${toUsername}...`;
        }
        gameWaitingBar.classList.remove('hidden');
    }

    function hideGameWaitingBar() {
        if (gameWaitingBar) gameWaitingBar.classList.add('hidden');
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

    // Кнопка ✕ на плашке ожидания — отменить
    if (gameWaitingCancelBtn) {
        gameWaitingCancelBtn.addEventListener('click', () => {
            hideGameWaitingBar();
            // Не отправляем game_decline — соперник ещё не принял.
            // Просто скрываем плашку (игра останется в pending состоянии)
        });
    }

    // ========================================================
    // SOCKET-СОБЫТИЯ ПРИГЛАШЕНИЯ
    // ========================================================

    // Пришло приглашение от другого игрока
        socket.on('game_invited', ({ gameId, fromUsername }) => {
        // Закрываем оверлей (если открыт) — чтобы игрок увидел плашку приглашения
        // внизу. Это важно для реванша: у игрока остался экран с результатом.
        if (!overlay.classList.contains('hidden')) {
            closeOverlay();
        }
        showGameInviteBar(fromUsername, gameId);
    });

    // Отправителю: получатель принял → начинается расстановка
    // (сервер шлёт game_placing обоим после accept)

    // Получили сигнал о начале расстановки
    socket.on('game_placing', ({ gameId }) => {
        state.gameId = gameId;
        state.phase = 'placing';

        // Скрываем плашку ожидания — соперник принял
        hideGameWaitingBar();     // ← НОВАЯ СТРОКА

        // Очищаем чат при новой игре
        if (gameChatLog) gameChatLog.innerHTML = '';


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
        if (rematchBtn) rematchBtn.classList.add('hidden');
    });

    // Получателю: отправитель отклонил? — уже обрабатывается на сервере
    // Отправителю: получатель отклонил приглашение
    socket.on('game_declined', ({ byUsername }) => {
        statusMsgEl.textContent = `🚫 ${byUsername} отказался от игры.`;
        hideGameWaitingBar();     // ← НОВАЯ СТРОКА
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

    // Кнопка «🔄 Ещё раз» — отправить новое приглашение тому же сопернику
    if (rematchBtn) {
        rematchBtn.addEventListener('click', () => {
            // Прячем кнопки результата
            if (rematchBtn) rematchBtn.classList.add('hidden');

            // Закрываем оверлей
            closeOverlay();

            // Отправляем новое приглашение
            socket.emit('game_invite');
        });
    }

    // Фаза боя началась (оба готовы)
    socket.on('game_battle', ({ gameId, turn, youAre, myBoard, enemyBoard, opponentName }) => {
        state.myPlayerKey = youAre || null;  // ← НОВОЕ
        state.gameId = gameId;
        state.phase = 'battle';

        state.turn = turn;
        state.myBoard = myBoard;
        state.enemyBoard = enemyBoard;
        state.opponentName = opponentName || 'Соперник';

        // Скрываем кнопки расстановки
        if (randomBtn) randomBtn.classList.add('hidden');
        if (readyBtn) readyBtn.classList.add('hidden');
        if (rematchBtn) rematchBtn.classList.add('hidden');

        // Обновляем UI
        opponentNameEl.textContent = `Соперник: ${state.opponentName}`;
        renderMyBoard(myBoardEl, myBoard);
        renderEnemyBoard(enemyBoardEl, enemyBoard);  // ← новая функция с кликами

        // Показываем чей ход + пульс
        if (turn === 'you') {
            turnIndicatorEl.textContent = '🎯 Твой ход!';
            turnIndicatorEl.classList.add('turn-you');   // ← НОВАЯ СТРОКА
            statusMsgEl.textContent = 'Стреляй по полю врага.';
        } else {
            turnIndicatorEl.textContent = '⌛ Ход соперника';
            turnIndicatorEl.classList.remove('turn-you');
            statusMsgEl.textContent = 'Ждём хода соперника...';
        }
        // Запускаем таймер хода
        startTurnTimer();
    });

    // ========================================================
    // ВЫСТРЕЛЫ
    // ========================================================

    // Наш выстрел — результат
    socket.on('game_shot_result', ({ x, y, result, turn }) => {
        // Рисуем на поле врага
        renderShotResult(enemyBoardEl, x, y, result);

        // Звук результата
        if (result === 'miss') playSound('miss');
        else if (result === 'hit') playSound('hit');
        else if (result === 'sunk') playSound('sunk');

        // Обновляем ход
        if (turn) {
            state.turn = turn;
            if (turn === 'you') {
                turnIndicatorEl.textContent = '🎯 Твой ход!';
                turnIndicatorEl.classList.add('turn-you');
                if (result === 'hit' || result === 'sunk') {
                    statusMsgEl.textContent = result === 'sunk' ? '☠️ Потопил! Стреляй ещё.' : '🔥 Попал! Стреляй ещё.';
                } else {
                    statusMsgEl.textContent = '💧 Мимо.';
                }
            } else {
                turnIndicatorEl.textContent = '⌛ Ход соперника';
                turnIndicatorEl.classList.remove('turn-you');
                statusMsgEl.textContent = 'Ждём хода соперника...';
            }
        }
        // Перезапускаем таймер — ход может остаться у нас или перейти
        if (state.phase === 'battle') {
            startTurnTimer();
        }
    });

    // Соперник стрелял — результат на нашем поле
    socket.on('game_opponent_shot', ({ x, y, result, turn }) => {
        // Рисуем на своём поле
        renderShotResult(myBoardEl, x, y, result);

        // Звук результата (соперник стрелял по нам)
        if (result === 'miss') playSound('miss');
        else if (result === 'hit') playSound('hit');
        else if (result === 'sunk') playSound('sunk');

        // Обновляем ход
        if (turn) {
            state.turn = turn;
            if (turn === 'you') {
                turnIndicatorEl.textContent = '🎯 Твой ход!';
                turnIndicatorEl.classList.add('turn-you');
                statusMsgEl.textContent = 'Твой ход! Стреляй.';
            } else {
                turnIndicatorEl.textContent = '⌛ Ход соперника';
                turnIndicatorEl.classList.remove('turn-you');
            }
        }
        // Перезапускаем таймер — соперник сходил, теперь наш ход или его
        if (state.phase === 'battle') {
            startTurnTimer();
        }
    });

    socket.on('game_finished', (payload) => {
        // Только наша игра — иначе чужие оверлеи будут открываться.
        if (!state.gameId) return;
        if (payload && payload.gameId && payload.gameId !== state.gameId) return;
        const { winner, reason } = payload;
        if (randomBtn) randomBtn.classList.add('hidden');
        if (readyBtn) readyBtn.classList.add('hidden');
        if (turnIndicatorEl) turnIndicatorEl.classList.remove('turn-you');

        if (winner === 'you') {
            statusMsgEl.textContent = '🏆 Победа! Скуф-адмирал!';
            playSound('win');
        } else {
            statusMsgEl.textContent = '💀 Поражение... В следующий раз повезёт.';
            playSound('lose');
        }

        // Показываем кнопку «Ещё раз»
        if (rematchBtn) rematchBtn.classList.remove('hidden');

        // НЕ закрываем оверлей автоматически — игрок сам решит
    });

    // Второй игрок принял — отправитель закрывает любые плашки
    socket.on('game_accepted', ({ gameId }) => {
        hideGameInviteBar();
    });

    // ========================================================
    // RECONNECT (MVP) — обрыв интернета
    // ========================================================

    socket.on('game_opponent_disconnected', ({ graceMs }) => {
        // Соперник отвалился — показываем плашку «ждём»
        statusMsgEl.textContent = `⚠️ Соперник отвалился. Ждём ${Math.round(graceMs / 1000)} сек...`;
    });

    socket.on('game_opponent_reconnected', () => {
        // Соперник вернулся — убираем плашку
        statusMsgEl.textContent = '✅ Соперник вернулся!';
        setTimeout(() => {
            // Восстанавливаем статус по ходу
            if (state.turn === 'you') {
                statusMsgEl.textContent = 'Стреляй по полю врага.';
            } else {
                statusMsgEl.textContent = 'Ждём хода соперника...';
            }
        }, 1500);
    });

    socket.on('game_reconnected', () => {
        // Мы вернулись в игру (но клиент может ещё не знать о ней)
        console.log('✅ Мы вернулись в игру');
        // ⚠️ MVP: оверлей не восстанавливаем — просто игнорируем
    });

    console.log('🚢 Морской бой: клиентский модуль загружен');
})();

