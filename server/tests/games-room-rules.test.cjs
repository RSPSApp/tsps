const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../plugins/minigames/gamesroom/Rules.GamesRoom');

function position(game, pieces, extra = {}) {
  const state = rules.create(game);
  state.board.fill(0);
  for (const [slot, piece] of Object.entries(pieces)) state.board[slot] = piece;
  return Object.assign(state, extra);
}

test('Draughts opens with twelve men each and seven forward moves', () => {
  const state = rules.create('draughts');
  assert.equal(state.board.filter(x => x === 1).length, 12);
  assert.equal(state.board.filter(x => x === -1).length, 12);
  assert.equal(rules.legalMoves(state).length, 7);
  assert.equal(rules.play(state, 0, { from: 40, to: 33 }), true);
  assert.equal(state.turn, 1);
});

test('wrong turn, forged coordinates, occupied targets and backward men never mutate', () => {
  const state = rules.create('draughts');
  for (const [side, move] of [[1, { from: 17, to: 24 }], [0, {from:40,to:49}],
    [0,{from:40,to:42}], [0,{from:-1,to:33}], [0,{from:40.5,to:33}], [0,null]]) {
    const before = structuredClone(state);
    assert.equal(rules.play(state, side, move), false);
    assert.deepEqual(state, before);
  }
});

test('any capture forbids an otherwise legal quiet move', () => {
  const state = position('draughts', {40:1,44:1,33:-1,7:-1});
  assert.deepEqual(rules.legalMoves(state), [{from:40,to:26}]);
  assert.equal(rules.play(state,0,{from:44,to:35}),false);
  assert.equal(rules.play(state,0,{from:40,to:26}),true);
  assert.equal(state.board[33],0);
});

test('chained captures retain turn and require the same piece until complete', () => {
  const state = position('draughts', {56:1,49:-1,35:-1,7:-1});
  assert.equal(rules.play(state,0,{from:56,to:42}),true);
  assert.equal(state.turn,0);
  assert.equal(state.forced,42);
  assert.deepEqual(rules.legalMoves(state), [{from:42,to:28}]);
  assert.equal(rules.play(state,0,{from:42,to:28}),true);
  assert.equal(state.turn,1);
  assert.equal(state.forced,null);
  assert.equal(state.quietMoves,0);
});

test('promotion crowns and ends the turn even when the new king could jump back', () => {
  const state = position('draughts', {17:1,10:-1,12:-1,63:-1});
  assert.equal(rules.play(state,0,{from:17,to:3}),true);
  assert.equal(state.board[3],2);
  assert.equal(state.turn,1);
  assert.equal(state.forced,null);
});

test('kings move and capture backward while men cannot', () => {
  const state = position('draughts',{26:2,35:-1,7:-1});
  assert.deepEqual(rules.legalMoves(state),[{from:26,to:44}]);
  assert.equal(rules.play(state,0,{from:26,to:44}),true);
  const man = position('draughts',{26:1,35:-1,7:-1});
  assert.equal(rules.play(man,0,{from:26,to:44}),false);
});

test('side one moves toward row seven and crowns there', () => {
  const state = position('draughts',{45:-1,54:1,0:1},{turn:1});
  assert.equal(rules.play(state,1,{from:45,to:63}),true);
  assert.equal(state.board[63],-2);
});

test('edge wrapping never becomes a diagonal move', () => {
  const state = position('draughts',{32:2,7:-1});
  assert.equal(rules.play(state,0,{from:32,to:23}),false);
  assert.equal(rules.play(state,0,{from:32,to:14}),false);
});

test('taking the last piece wins and terminal games reject further moves', () => {
  const state = position('draughts',{40:1,33:-1});
  assert.equal(rules.play(state,0,{from:40,to:26}),true);
  assert.equal(state.result.winner,0);
  assert.deepEqual(rules.legalMoves(state),[]);
  const before=structuredClone(state);
  assert.equal(rules.play(state,0,{from:26,to:19}),false);
  assert.deepEqual(state,before);
});

test('a side with pieces but no legal move loses', () => {
  const state = position('draughts',{40:1,56:-1});
  assert.equal(rules.play(state,0,{from:40,to:33}),true);
  assert.equal(state.result.winner,0);
});

test('fortieth completed turn without capture or promotion is a draw', () => {
  const state=position('draughts',{40:2,7:-2},{quietMoves:39});
  assert.equal(rules.play(state,0,{from:40,to:33}),true);
  assert.equal(state.quietMoves,40);
  assert.equal(state.result.winner,null);
});

test('capture and promotion reset the forty-move count', () => {
  for(const state of [position('draughts',{40:1,33:-1,7:-1},{quietMoves:39}),
    position('draughts',{8:1,63:-2},{quietMoves:39})]) {
    const move=rules.legalMoves(state)[0];
    assert.equal(rules.play(state,0,move),true);
    assert.equal(state.quietMoves,0);
    assert.equal(state.result,null);
  }
});

test('RuneLink fills from the bottom, alternates and rejects full columns', () => {
  const state=rules.create('runelink');
  for(let i=0;i<6;i++) assert.equal(rules.play(state,i%2,{column:0}),true);
  assert.deepEqual([0,7,14,21,28,35].map(x=>state.board[x]),[-1,1,-1,1,-1,1]);
  const before=structuredClone(state);
  assert.equal(rules.play(state,0,{column:0}),false);
  assert.deepEqual(state,before);
  assert.equal(rules.legalMoves(state).length,6);
});

test('RuneLink validates column, side and terminal state without mutation', () => {
  const state=rules.create('runelink');
  for(const [side,move] of [[0,{column:-1}],[0,{column:7}],[0,{column:1.5}],[1,{column:2}],[0,null]]) {
    const before=structuredClone(state);
    assert.equal(rules.play(state,side,move),false);
    assert.deepEqual(state,before);
  }
});

for(const [name, slots, column, supports] of [
  ['horizontal',[35,36,37],3,{}], ['vertical',[35,28,21],0,{}],
  ['downward diagonal',[14,22,30],3,{}],
  ['upward diagonal',[35,29,23],3,{24:-1,31:-1,38:-1}],
]) test(`RuneLink wins ${name}`,()=>{
  const state=position('runelink',Object.assign({},supports,Object.fromEntries(slots.map(x=>[x,1]))));
  assert.equal(rules.play(state,0,{column}),true);
  assert.equal(state.result?.winner,0);
});

test('RuneLink lines cannot wrap across a board edge',()=>{
  const state=position('runelink',{33:1,34:1,35:1});
  assert.equal(rules.play(state,0,{column:1}),true);
  assert.equal(state.result,null);
});

test('a full RuneLink board without four in a row draws',()=>{
  const rows=['++--++-','--++--+','++--++-','--++--+','++--++-','--++--+'];
  const state=rules.create('runelink');
  state.board=rows.join('').split('').map(x=>x==='+'?1:-1);
  state.board[0]=0;
  assert.equal(rules.play(state,0,{column:0}),true);
  assert.equal(state.result?.winner,null);
  assert.equal(state.result?.reason,'board-full');
});

test('automatic moves choose only legal actions and empty terminal games yield none',()=>{
  for(const game of ['draughts','runelink']) {
    const state=rules.create(game), legal=rules.legalMoves(state);
    assert.deepEqual(rules.chooseAutoMove(state,()=>0),legal[0]);
    assert.deepEqual(rules.chooseAutoMove(state,()=>0.999),legal.at(-1));
    state.result={winner:null,reason:'draw'};
    assert.equal(rules.chooseAutoMove(state),null);
  }
});

test('rank calculation matches Wiki examples and clamps extreme differences',()=>{
  for(const [winner,loser,delta] of [[1000,1000,50],[1200,800,25],[800,1200,75],
    [1500,500,1],[643,1,9],[1,60000,100],[60000,1,1]]) {
    assert.equal(rules.rankChange(winner,loser),delta);
  }
});
