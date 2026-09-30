// ========================================================
// public/domino.js — клиентская логика Домино (v1.24.1)
// ========================================================
// Загружается ПОСЛЕ client.js. Использует глобальный socket.

(function() {
    'use strict';

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

    if (!overlay) {
        console.warn('⚠️ Домино: оверлей не найден');
        return;
    }

    const state = {
        gameId: null,
        myHand: [],
        opponentHandCount: 0,
        bazaarCount: 0,
        board: { tiles: [], leftEnd: null, rightEnd: null },
        turn: null,
    };

    // Просто логируем, что модуль загрузился. Всё остальное — в 2.2+.
    console.log('🎲 Домино: клиентский модуль загружен (каркас)');
})();