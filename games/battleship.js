// ========================================================
// games/battleship.js — логика Морского боя
// ========================================================
// Модуль для game-server.js. Экспортирует объект-контракт,
// который роутер использует для игр этого типа.
//
// Контракт:
//   id: уникальный ID игры
//   name: отображаемое имя
//   minPlayers / maxPlayers
//   createInitialState(p1, p2) → начальное состояние
//   handleAction(game, playerKey, action, payload) → { ok, events?, error? }
//   isFinished(game) → { finished, winner?, reason? }
//   serializeFor(game, playerKey) → объект для клиента
//
// ⚠️ Всё пока — каркас. Реальная логика — в следующих этапах.
// ========================================================

module.exports = {
    id: 'battleship',
    name: '🚢 Морской бой',
    minPlayers: 2,
    maxPlayers: 2,

    // Заглушка
    createInitialState: (p1, p2) => ({
        // позже: доска 10×10, ready-флаги и т.д.
    }),

    // Заглушка
    handleAction: (game, playerKey, action, payload) => ({
        ok: false,
        error: 'not_implemented',
    }),

    // Заглушка
    isFinished: (game) => ({ finished: false, winner: null, reason: null }),

    // Заглушка
    serializeFor: (game, playerKey) => ({}),
};