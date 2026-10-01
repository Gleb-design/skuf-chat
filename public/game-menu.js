// ========================================================
// public/game-menu.js — меню выбора игры (v1.24.2)
// ========================================================
// Загружается ПОСЛЕ client.js. Использует глобальный socket.
// Открывается по кнопке #btnPlayGame в привате.

(function() {
    'use strict';

    const btnPlayGame = document.getElementById('btnPlayGame');
    const modal = document.getElementById('gameMenuModal');
    const closeBtn = document.getElementById('gameMenuCloseBtn');
    const menuItems = document.querySelectorAll('.game-menu-item');

    if (!btnPlayGame || !modal) {
        console.warn('⚠️ Меню игр: элементы не найдены');
        return;
    }

    // Открыть меню
    function openMenu() {
        const privateControls = document.getElementById('privateControls');
        const isPrivateMode = privateControls && !privateControls.classList.contains('hidden');

        if (!isPrivateMode) {
            console.warn('🎮 Меню игр: доступно только в привате 1-на-1');
            return;
        }

        modal.classList.remove('hidden');
    }

    // Закрыть меню
    function closeMenu() {
        modal.classList.add('hidden');
    }

    // Клик по кнопке «🎮 Играть»
    btnPlayGame.addEventListener('click', openMenu);

    // Клик по ✖
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMenu);
    }

    // Клик по фону (вне контента)
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeMenu();
        }
    });

    // Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeMenu();
        }
    });

    // Клик по игре
    menuItems.forEach((item) => {
        item.addEventListener('click', () => {
            const gameType = item.dataset.game;
            if (!gameType) return;

            // Отправляем приглашение с выбранным типом
            socket.emit('game_invite', { gameType });

            closeMenu();
            console.log('🎮 Приглашение в игру:', gameType);
        });
    });

    console.log('🎮 Меню игр: модуль загружен');
})();