'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Rules = require('../plugins/minigames/gamesroom/Rule.RuneSquares.GamesRoom');

function draw(state, axis, edge) { assert.equal(Rules.play(state, state.turn, { axis, edge }), true); }

test('native board has 64 squares, a fixed perimeter and 112 unique internal edges', () => {
  const s = Rules.create();
  assert.equal(s.board.length, 64);
  assert.equal(Rules.legalMoves(s).length, 112);
  draw(s, 'h', 0); // top-left: bottom edge
  assert.equal(s.turn, 1);
  draw(s, 'v', 0); // top-left: right edge, outer top and left already closed
  assert.equal(s.board[0], -1);
  assert.equal(s.turn, 1, 'completing a square grants another move');
  assert.deepEqual(s.scores, [0, 1]);
  assert.equal(Rules.legalMoves(s).length, 110);
});

test('one shared interior edge claims both adjacent squares exactly once', () => {
  const s = Rules.create();
  // Boxes (row3,col3) and (row3,col4), sharing v24.
  for (const edge of [19, 20, 27, 28]) draw(s, 'h', edge);
  for (const edge of [23, 25]) draw(s, 'v', edge);
  const side = s.turn;
  draw(s, 'v', 24);
  assert.equal(s.board[27], side === 0 ? 1 : -1);
  assert.equal(s.board[28], side === 0 ? 1 : -1);
  assert.equal(s.scores[side], 2);
  assert.equal(s.turn, side);
  const before = JSON.stringify(s);
  assert.equal(Rules.play(s, side, { axis: 'v', edge: 24 }), false);
  assert.equal(JSON.stringify(s), before);
});

test('bottom/right edge mapping closes the last corner without row wrapping', () => {
  const s = Rules.create();
  draw(s, 'v', 55);
  assert.equal(s.board[63], 0);
  draw(s, 'h', 55);
  assert.equal(s.board[63], -1);
  assert.equal(s.scores[1], 1);
  assert.equal(s.board[55], 0);
});

test('wrong turns, forged axes, fractional/out-of-range edges cannot mutate state', () => {
  const s = Rules.create(), before = JSON.stringify(s);
  for (const move of [null, {}, { axis: 'x', edge: 0 }, { axis: 'h', edge: -1 },
    { axis: 'v', edge: 56 }, { axis: 'h', edge: 0.5 }, { axis: 'v', edge: '0' }]) {
    assert.equal(Rules.play(s, 0, move), false);
  }
  assert.equal(Rules.play(s, 1, { axis: 'h', edge: 0 }), false);
  assert.equal(JSON.stringify(s), before);
});

test('all legal edge permutations terminate with 64 claims and a score-based result', () => {
  for (const reverse of [false, true]) {
    const s = Rules.create();
    let moves = Rules.legalMoves(s);
    if (reverse) moves.reverse();
    for (const move of moves) assert.equal(Rules.play(s, s.turn, move), true);
    assert.ok(s.board.every(Boolean));
    assert.equal(s.scores[0] + s.scores[1], 64);
    const [a, b] = s.scores;
    assert.deepEqual(s.result, { winner: a === b ? null : a > b ? 0 : 1, reason: 'board-full' });
    assert.deepEqual(Rules.legalMoves(s), []);
    assert.equal(Rules.play(s, s.turn, moves[0]), false);
  }
});

test('a complete 32 to 32 game ends in a draw', () => {
  const s = Rules.create(), moves = Rules.legalMoves(s);
  let seed = 37;
  for (let i = moves.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  for (const move of moves) assert.equal(Rules.play(s, s.turn, move), true);
  assert.deepEqual(s.scores, [32, 32]);
  assert.deepEqual(s.result, { winner: null, reason: 'board-full' });
});
