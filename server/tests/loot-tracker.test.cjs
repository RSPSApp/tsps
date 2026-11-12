// Run after `yarn build`: node --test tests/loot-tracker.test.cjs
// The client's loot tracker (LootTracker.plugin.js): an entry is cache script 7197 (loottracker_sourceadd),
// then 7198 (loottracker_lootadd) per item, under the player's next key (rsprox: main-game rooftop laps).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const plugin = require("../plugins/interface/LootTracker.plugin");

const GRACE = 11849;

function fixture() {
  const hooks = { persisted: {} };
  plugin.register({
    persistAttribute: (key, value) => { hooks.persisted[key] = value; },
    onCustomEvent: (name, fn) => { hooks[name] = fn; },
  });
  const attributes = new Map();
  const scripts = [];
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendClientScript: (id, ...args) => scripts.push([id, ...args]) }),
  };
  return { hooks, player, scripts, attributes };
}

test("an entry sends 7197 with the source, a new key and its category, then 7198 for each item under that key", () => {
  const { hooks, player, scripts } = fixture();
  hooks["loot-tracker:add"]({ player, source: 27, category: 5, items: [[GRACE, 1]] });
  assert.deepEqual(scripts, [[7197, 27, 1, 5, -1], [7198, 27, 1, GRACE, 1]]);
});

test("a source with nothing found is still added; keys count up whichever source they're for", () => {
  const { hooks, player, scripts } = fixture();
  hooks["loot-tracker:add"]({ player, source: 22, category: 5, items: [] });
  hooks["loot-tracker:add"]({ player, source: 32, category: 11, items: [[1965, 3]] });
  hooks["loot-tracker:add"]({ player, source: 22, category: 5 });
  assert.deepEqual(scripts, [[7197, 22, 1, 5, -1], [7197, 32, 2, 11, -1], [7198, 32, 2, 1965, 3], [7197, 22, 3, 5, -1]]);
});

test("the next key is kept with the player from 1, so it carries on across sessions as live's does", () => {
  const { hooks, player, scripts, attributes } = fixture();
  assert.equal(hooks.persisted["loot-tracker:next-key"], 1);
  attributes.set("loot-tracker:next-key", 48404);
  hooks["loot-tracker:add"]({ player, source: 27, category: 5 });
  assert.deepEqual(scripts, [[7197, 27, 48404, 5, -1]]);
  assert.equal(attributes.get("loot-tracker:next-key"), 48405);
});

test("an entry without a player, source or category sends nothing", () => {
  const { hooks, player, scripts } = fixture();
  hooks["loot-tracker:add"]({ player, category: 5 });
  hooks["loot-tracker:add"]({ player, source: 27 });
  hooks["loot-tracker:add"]({ source: 27, category: 5 });
  assert.deepEqual(scripts, []);
});
