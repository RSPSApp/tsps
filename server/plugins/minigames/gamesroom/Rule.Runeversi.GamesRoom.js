'use strict';

// The Wiki identifies Runeversi as Othello. The archived Jagex Games Room
// knowledge base describes vacant-square placement and all bracketed rays.
// Mandatory passes and termination with empty squares follow WOF Othello rules;
// no local current-OSRS gameplay capture establishes pass text or timing.
// https://oldschool.runescape.wiki/w/Burthorpe_Games_Room
// https://2011.rs/kb/games_room
// https://www.worldothello.org/about/about-othello/othello-rules/official-rules/english
const DIRECTIONS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function create() {
  const board = Array(64).fill(0);
  board[27] = board[36] = -1;
  board[28] = board[35] = 1;
  return { game: 'runeversi', board, turn: 0, forced: null, passed: null, result: null };
}

function flips(state, side, to) {
  if (!Number.isInteger(to) || to < 0 || to >= 64 || state.board[to]) return [];
  const own = side === 0 ? 1 : -1, result = [];
  for (const [dr, dc] of DIRECTIONS) {
    let row = Math.floor(to / 8) + dr, col = to % 8 + dc;
    const ray = [];
    while (row >= 0 && row < 8 && col >= 0 && col < 8 && state.board[row * 8 + col] === -own) {
      ray.push(row * 8 + col); row += dr; col += dc;
    }
    if (ray.length && row >= 0 && row < 8 && col >= 0 && col < 8 && state.board[row * 8 + col] === own) {
      result.push(...ray);
    }
  }
  return result;
}

function placements(state, side) {
  return state.board.flatMap((_, to) => flips(state, side, to).length ? [{ to }] : []);
}

function legalMoves(state) { return state.result ? [] : placements(state, state.turn); }

function play(state, side, move) {
  if (state.result || side !== state.turn || !move || typeof move !== 'object') return false;
  const captured = flips(state, side, move.to);
  if (!captured.length) return false;
  const own = side === 0 ? 1 : -1;
  state.board[move.to] = own;
  for (const to of captured) state.board[to] = own;
  state.passed = null;
  state.turn = 1 - side;
  if (!placements(state, state.turn).length) {
    if (placements(state, side).length) {
      state.passed = state.turn;
      state.turn = side;
    } else {
      const balance = state.board.reduce((sum, piece) => sum + piece, 0);
      state.result = { winner: balance === 0 ? null : balance > 0 ? 0 : 1,
        reason: state.board.every(Boolean) ? 'board-full' : 'no-legal-moves' };
    }
  }
  return true;
}

module.exports = { create, legalMoves, play };
