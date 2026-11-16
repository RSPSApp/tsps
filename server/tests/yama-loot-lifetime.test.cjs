// Run after `yarn build`: node --test tests/yama-loot-lifetime.test.cjs
// Yama's loot lands on his loot tile from Fight.dropLoot, not through NpcDrops' placeDrops, so it asks NpcDrops for the
// monster-drop ground options ("npc-drops:ground-options"): Wiki (Drops), tradeable drops last 200 ticks, untradeable 300.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { World } = require("../dist/game/World");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
const Common = require("../plugins/bosses/yama/Common.Yama");
const Fight = require("../plugins/bosses/yama/Fight.Yama");

const SHARK = 385;            // tradeable, not stackable
const COINS = 995;            // tradeable, stackable
const ECUMENICAL_KEY = 11942; // untradeable
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const listeners = new Map();
  const api = new Proxy({
    core,
    getItemOnGroundManager: () => ItemOnGroundManager,
    onCustomEvent: (name, handler) => { listeners.set(name, handler); },
    emitCustomEvent: (name, payload) => listeners.get(name)?.(payload),
  }, { get: (target, key) => (key in target ? target[key] : () => undefined) });
  NpcDrops.register(api);
  Common.init(api);
});

afterEach(() => {
  for (const item of [...World.getItems()]) ItemOnGroundManager.deregister(item);
});

test("Yama's loot tile: tradeable loot lasts 200 ticks, an untradeable drop 300", (t) => {
  t.mock.method(core.TaskManager, "submit", () => {});
  const player = new Player(null);
  player.setUsername("yama-loot");
  player.getPacketSender = () => new Proxy({}, { get: () => () => undefined });
  const tile = new core.Location(1504, 10080, 0);
  const session = { player, area: null, tile: () => tile.clone() };
  Fight.challenge(session);
  const fight = session.fight;
  assert.ok(fight, "the fight is started");
  fight.loot = [
    { itemId: SHARK, amount: 2 },
    { itemId: COINS, amount: 1000 },
    { itemId: ECUMENICAL_KEY, amount: 1 },
  ];
  fight.dropLoot();
  const on = (id) => World.getItems().filter((item) => item.getItem().getId() === id);
  assert.equal(on(SHARK).length, 2);
  assert.deepEqual(on(SHARK).map((item) => item.getDespawnDelay()), [200, 200]);
  assert.equal(on(COINS)[0].getDespawnDelay(), 200);
  assert.equal(on(ECUMENICAL_KEY)[0].getDespawnDelay(), 300, "untradeable: the Wiki's 3 minutes");
});
