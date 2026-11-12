'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Rules = require('../plugins/minigames/gamesroom/Rules.GamesRoom');
function empty() { const s = Rules.create('runeversi'); s.board.fill(0); return s; }

test('Runeversi starts with four opposing centre runes and four legal first placements', () => {
  const s = Rules.create('runeversi');
  assert.equal(s.board.length, 64);
  assert.deepEqual([s.board[27], s.board[28], s.board[35], s.board[36]], [-1, 1, 1, -1]);
  assert.deepEqual(Rules.legalMoves(s), [19, 26, 37, 44].map(to => ({ to })));
  assert.equal(Rules.play(s, 0, { to: 19 }), true);
  assert.equal(s.board[27], 1); assert.equal(s.turn, 1);
});

test('illegal, occupied, malformed and out-of-turn placements preserve board and turn', () => {
  const s = Rules.create('runeversi'), snapshot = structuredClone(s);
  for (const to of [-1, 64, 19.5, NaN, '19', 0, 27]) assert.equal(Rules.play(s, 0, { to }), false);
  assert.equal(Rules.play(s, 1, { to: 19 }), false);
  assert.equal(Rules.play(s, 0, null), false);
  assert.deepEqual(s, snapshot);
});

test('placement flips every bracketed ray in all eight directions', () => {
  const s = empty(), origin = 27;
  for (const delta of [-9, -8, -7, -1, 1, 7, 8, 9]) { s.board[origin + delta] = -1; s.board[origin + 2 * delta] = 1; }
  assert.equal(Rules.play(s, 0, { to: origin }), true);
  for (const delta of [-9, -8, -7, -1, 1, 7, 8, 9]) assert.equal(s.board[origin + delta], 1);
});

test('rays cannot wrap rows, cross empty squares, skip friendly runes or cascade from flips', () => {
  for (const [target, enemies, friends] of [[7,[8],[9]], [0,[2],[3]], [0,[1,3],[2,4]], [0,[1,10],[2,18]]]) {
    const s = empty(); for (const i of enemies) s.board[i] = -1; for (const i of friends) s.board[i] = 1;
    const ok = Rules.play(s, 0, { to: target });
    if (target === 7 || enemies[0] === 2) assert.equal(ok, false);
    else { assert.equal(ok, true); assert.equal(s.board[enemies[1]], -1); }
  }
});

test('a side without a legal placement passes and the other side continues', () => {
  const s = empty(); s.board.fill(1); s.board[0] = 0; s.board[1] = -1; s.board[56] = 0; s.board[57] = -1;
  assert.equal(Rules.play(s, 0, { to: 0 }), true);
  assert.equal(s.turn, 0); assert.equal(s.passed, 1); assert.equal(s.result, null);
  assert.deepEqual(Rules.legalMoves(s), [{ to: 56 }]);
});

test('neither side can play ends with actual piece scoring even with vacant squares', () => {
  const s = empty(); s.board[0] = 1; s.board[1] = -1;
  assert.equal(Rules.play(s, 0, { to: 2 }), true);
  assert.deepEqual(s.result, { winner: 0, reason: 'no-legal-moves' });
  assert.equal(s.board.filter(Boolean).length, 3);
  assert.deepEqual(Rules.legalMoves(s), []);
  assert.equal(Rules.play(s, s.turn, { to: 3 }), false);
});

test('full board can score an exact tie or a win for the second side', () => {
  for (const [positiveBefore, winner] of [[33,null], [31,1]]) {
    const s = empty(); s.turn = 1; s.board.fill(-1);
    s.board[0] = 0; s.board[1] = 1;
    for (let i = 32; i < 32 + positiveBefore - 1; i++) s.board[i] = 1;
    assert.equal(Rules.play(s, 1, { to: 0 }), true);
    assert.equal(s.result.winner, winner);
    assert.equal(s.result.reason, 'board-full');
  }
});

test('automatic choice always belongs to the legal placement set and games terminate', () => {
  for (const random of [() => 0, () => 0.999999]) {
    const s = Rules.create('runeversi'); let placements = 0;
    while (!s.result && placements < 61) {
      const move = Rules.chooseAutoMove(s, random);
      assert.ok(Rules.legalMoves(s).some(m => m.to === move.to));
      assert.equal(Rules.play(s, s.turn, move), true); placements++;
    }
    assert.ok(s.result); assert.ok(placements <= 60); assert.equal(Rules.chooseAutoMove(s), null);
  }
});
