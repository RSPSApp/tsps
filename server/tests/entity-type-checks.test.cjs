// Run after `yarn build`: node --test tests/entity-type-checks.test.cjs
// Hot checks such as Mobile.isNpc() broke an import cycle with a lazy require() on every call. Node
// only caches a relative require for the caller that first loaded the module, so each call did a
// full resolve (package.json stat included): ~30% of tick CPU with the default bots.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Mobile } = require('../dist/game/entity/impl/Mobile');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Item } = require('../dist/game/model/Item');
const { TickStopwatch } = require('../dist/util/TickStopwatch');
const { lazyRequire } = require('../dist/util/LazyRequire');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');

// No cache in this test; Item#getDefinition still goes through its lazy ItemDefinition require.
ItemDefinition.forId = (id) => ({ id });

const player = Object.create(Player.prototype);
const npc = Object.create(NPC.prototype);
const mobile = Object.create(Mobile.prototype);

function countModuleLoads(run) {
  const original = Module._load;
  let loads = 0;
  Module._load = function countedLoad(...args) {
    loads++;
    return original.apply(this, args);
  };
  try {
    run();
  } finally {
    Module._load = original;
  }
  return loads;
}

test('players and npcs answer their own type checks', () => {
  assert.equal(player.isPlayer(), true);
  assert.equal(player.isNpc(), false);
  assert.equal(npc.isNpc(), true);
  assert.equal(npc.isPlayer(), false);
  assert.equal(mobile.isPlayer(), false, 'a bare Mobile is neither');
  assert.equal(mobile.isNpc(), false, 'a bare Mobile is neither');
});

test('the base Mobile checks still tell players and npcs apart', () => {
  assert.equal(Mobile.prototype.isPlayer.call(player), true);
  assert.equal(Mobile.prototype.isNpc.call(player), false);
  assert.equal(Mobile.prototype.isNpc.call(npc), true);
  assert.equal(Mobile.prototype.isPlayer.call(npc), false);
});

test('repeated type checks, item definitions and tick stopwatches do not require modules', () => {
  const item = new Item(995, 1);
  const stopwatch = new TickStopwatch().reset(1);
  const run = () => {
    player.isNpc();
    npc.isPlayer();
    Mobile.prototype.isNpc.call(player);
    Mobile.prototype.isPlayer.call(npc);
    Mobile.prototype.isNpc.call(mobile);
    item.getDefinition();
    stopwatch.elapsed();
  };
  run(); // the first call may load and cache
  assert.equal(countModuleLoads(() => { for (let i = 0; i < 1000; i++) run(); }), 0);
});

test('lazyRequire retries while the module is mid-load, then caches', () => {
  let calls = 0;
  let value;
  const get = lazyRequire(() => { calls++; return value; });
  assert.equal(get(), undefined, 'a mid-cycle require can return undefined');
  assert.equal(get(), undefined);
  assert.equal(calls, 2, 'undefined is not cached');
  value = { ready: true };
  assert.equal(get(), value);
  value = { replaced: true };
  assert.deepEqual(get(), { ready: true }, 'the first defined value is cached');
  assert.equal(calls, 3);
});
