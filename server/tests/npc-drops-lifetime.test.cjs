// Run after `yarn build`: node --test tests/npc-drops-lifetime.test.cjs
// Wiki (Drops): "Tradeable drops will remain on the ground for 200 game ticks"; untradeable drops last 300.
// The recordings add tradeable monster drops with despawn=200 (rsprox_transcripts/224/01463.txt tick 3491) and a
// player's own drops with despawn=300 (232/00428.txt), so only monster drops change.
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { World } = require("../dist/game/World");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

const BONES = 526;            // tradeable
const ECUMENICAL_KEY = 11942; // untradeable
const listeners = new Map();
const TILE = new Location(3229, 3297, 0);

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const noop = () => undefined;
  NpcDrops.register(new Proxy({
    core: {},
    getItemOnGroundManager: () => ItemOnGroundManager,
    onCustomEvent: (name, handler) => { listeners.set(name, handler); },
  }, { get: (target, key) => (key in target ? target[key] : noop) }));
});

afterEach(() => {
  for (const item of [...World.getItems()]) ItemOnGroundManager.deregister(item);
});

function killer(name) {
  const player = new Player(null);
  player.setUsername(name);
  return player;
}

const place = (player, drops) => listeners.get("npc-drops:place")({ player, drops, location: TILE.clone() });
const floor = (id) => World.getItems().filter((item) => item.getItem().getId() === id && !item.isPendingRemoval());

test("a tradeable monster drop lasts 200 ticks; an untradeable one keeps 300", () => {
  const player = killer("drop-lifetime");
  place(player, [{ itemId: BONES, amount: 1 }, { itemId: ECUMENICAL_KEY, amount: 1 }]);
  const [bones] = floor(BONES);
  const [key] = floor(ECUMENICAL_KEY);
  assert.equal(bones.getDespawnDelay(), 200);
  assert.equal(key.getDespawnDelay(), 300, "untradeable: the Wiki's 3 minutes");
  for (let tick = 0; tick < 199; tick++) bones.process();
  assert.equal(bones.isPendingRemoval(), false);
  bones.process();
  assert.equal(bones.isPendingRemoval(), true, "gone at 200");
});

test("a drop's own lifetime and an instance's floor lifetime are kept; a player's own drop keeps 300", () => {
  const player = killer("drop-lifetime-2");
  place(player, [{ itemId: BONES, amount: 1, ground: { despawnDelay: 18000 } }]);
  assert.equal(floor(BONES)[0].getDespawnDelay(), 18000);
  ItemOnGroundManager.deregister(floor(BONES)[0]);

  const room = { groundItemDespawnDelay: () => 3000, getPlayers: () => [], isDestroyed: () => false };
  player.getPrivateArea = () => room;
  place(player, [{ itemId: BONES, amount: 1 }]);
  assert.equal(floor(BONES)[0].getDespawnDelay(), 3000);
  ItemOnGroundManager.deregister(floor(BONES)[0]);

  player.getPrivateArea = () => null;
  const own = ItemOnGroundManager.registerLocation(player, new Item(BONES, 1), TILE.clone());
  assert.equal(own.getDespawnDelay(), 300, "the shared default is unchanged");
});
