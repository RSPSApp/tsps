// Run after `yarn build`: node --test tests/bird-nest-wyson.test.cjs
// Searching Wyson's seed nest (bird_nest_decentseeds_jan2019) rolls its own Wiki seed table, with
// quantities, and reads as rsprox capture local 1000323 ticks 13646-13648.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Woodcutting = require('../plugins/skills/Woodcutting.plugin.js')._test;
let core, next = 9960;
const bots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function searcher(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('wysonnest' + next); p.setRegistered(true); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); });
  const spam = [];
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (_type, m) => { spam.push(m); });
  return { p, spam };
}

/** Math.random so rollWeighted lands on the table row with this id. */
function landOn(t, table, id) {
  const total = table.reduce((sum, row) => sum + row.weight, 0);
  let before = 0;
  for (const row of table) { if (row.id === id) break; before += row.weight; }
  t.mock.method(Math, 'random', () => (before + 0.5) / total);
}

test('the Wyson nest table is the Wiki\'s 684 slots', () => {
  const table = Woodcutting.WYSON_NEST_SEEDS;
  assert.equal(table.reduce((sum, row) => sum + row.weight, 0), 684);
  assert.equal(table.length, 26);
  assert.ok(table.every((row) => Number.isInteger(row.id) && row.id > 0 && row.amount >= 1), 'cache ids');
});

for (const [name, seed, amount, line] of [
  ['six sweetcorn seeds', 'SWEETCORN_SEED', 6, "You take 6 sweetcorn seeds out of the bird's nest."],
  ['a cadantine seed', 'CADANTINE_SEED', 1, "You take a cadantine seed out of the bird's nest."],
  ['a Spirit Tree seed', 'SPIRIT_SEED', 1, "You take a Spirit Tree seed out of the bird's nest."],
  ['a Magic Tree seed', 'MAGIC_SEED', 1, "You take a Magic Tree seed out of the bird's nest."],
]) {
  test(`searching a Wyson nest can give ${name}`, (t) => {
    const { p, spam } = searcher(t);
    const ids = core.ItemIdentifiers;
    p.getInventory().add(new core.Item(ids.BIRD_NEST_12, 1), true);
    landOn(t, Woodcutting.WYSON_NEST_SEEDS, ids[seed]);
    assert.equal(Woodcutting.searchBirdNest(p, ids.BIRD_NEST_12), true);
    assert.equal(p.getInventory().getAmount(ids[seed]), amount);
    assert.equal(p.getInventory().getAmount(ids.BIRD_NEST_12), 0);
    assert.equal(p.getInventory().getAmount(ids.BIRD_NEST_6), 1, 'an empty nest is left');
    assert.deepEqual(spam, [line]);
  });
}

test('a regular seed nest names the magic seed as live does', (t) => {
  const { p, spam } = searcher(t);
  const ids = core.ItemIdentifiers;
  p.getInventory().add(new core.Item(ids.BIRD_NEST_10, 1), true);
  t.mock.method(Math, 'random', () => (214 + 170 + 135 + 108 + 85 + 68 + 54 + 42 + 34 + 27 + 22 + 17 + 11 + 6 + 0.5) / 1011);
  assert.equal(Woodcutting.searchBirdNest(p, ids.BIRD_NEST_10), true);
  assert.equal(p.getInventory().getAmount(ids.MAGIC_SEED), 1);
  assert.deepEqual(spam, ["You take a Magic Tree seed out of the bird's nest."]);
});
