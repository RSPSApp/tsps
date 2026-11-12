'use strict';

// Wiki: completing a square claims it and gives another turn; most squares wins.
// https://oldschool.runescape.wiki/w/Burthorpe_Games_Room#Games
// Rev241 boardgames_runesquares has 8x8 cells and a fixed outer border.
// Interior h0..55 are seven rows of eight; v0..55 are eight rows of seven.
function create() {
  return { game: 'runesquares', board: Array(64).fill(0), h: Array(56).fill(false),
    v: Array(56).fill(false), scores: [0, 0], turn: 0, forced: null, result: null };
}

function legalMoves(state) {
  if (state.result) return [];
  return ['h', 'v'].flatMap(axis => state[axis].flatMap((used, edge) => used ? [] : [{ axis, edge }]));
}

function closed(state, row, column) {
  return (row === 0 || state.h[(row - 1) * 8 + column]) &&
    (row === 7 || state.h[row * 8 + column]) &&
    (column === 0 || state.v[row * 7 + column - 1]) &&
    (column === 7 || state.v[row * 7 + column]);
}

function play(state, side, move) {
  if (state.result || side !== state.turn || !move || !['h', 'v'].includes(move.axis) ||
      !Number.isInteger(move.edge) || move.edge < 0 || move.edge >= 56 || state[move.axis][move.edge]) return false;
  const { axis, edge } = move;
  state[axis][edge] = true;
  const row = Math.floor(edge / (axis === 'h' ? 8 : 7)), column = edge % (axis === 'h' ? 8 : 7);
  const adjacent = axis === 'h' ? [[row, column], [row + 1, column]] : [[row, column], [row, column + 1]];
  let claimed = 0;
  for (const [r, c] of adjacent) {
    const square = r * 8 + c;
    if (!state.board[square] && closed(state, r, c)) {
      state.board[square] = side === 0 ? 1 : -1;
      state.scores[side]++;
      claimed++;
    }
  }
  if (!claimed) state.turn = 1 - side;
  if (state.scores[0] + state.scores[1] === 64) {
    const [a, b] = state.scores;
    state.result = { winner: a === b ? null : a > b ? 0 : 1, reason: 'board-full' };
  }
  return true;
}

module.exports = { create, legalMoves, play };
