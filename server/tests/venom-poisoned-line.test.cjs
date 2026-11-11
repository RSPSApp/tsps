// Run after `yarn build`: node --test tests/venom-poisoned-line.test.cjs
// Live names venom when it starts from nothing: "You have been poisoned by venom!" (275 recorded, e.g.
// rsprox_transcripts/237/01087.txt line 30368); a poison turned to venom says nothing more.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { CombatPoisonEffect } = require('../dist/game/task/impl/CombatPoisonEffect');
before(async () => require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd()));

function player(t) {
  const p = new Player(null); const lines = [];
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', m => lines.push(m));
  t.after(() => { p.setRegistered(false); CombatPoisonEffect.suspend(p); TaskManager.cancelTasks(p); });
  return { p, lines };
}

test('venom from nothing says "You have been poisoned by venom!" once', t => {
  const { p, lines } = player(t);
  CombatFactory.poisonEntity(p, 6, 2);
  assert.equal(p.isVenomed(), true);
  CombatFactory.poisonEntity(p, 6, 2);
  assert.deepEqual(lines, ['You have been poisoned by venom!']);
});

test('poison keeps its line, and turning it to venom adds none', t => {
  const { p, lines } = player(t);
  CombatFactory.poisonEntity(p, 30);
  CombatFactory.poisonEntity(p, 6, 2);
  assert.equal(p.isVenomed(), true);
  assert.deepEqual(lines, ['You have been poisoned!']);
});
