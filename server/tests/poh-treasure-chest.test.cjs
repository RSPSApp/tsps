// Run after `yarn build`: node --test tests/poh-treasure-chest.test.cjs
// A guest who beats a POH dungeon in challenge mode opens the treasure chest. Only what the inventory can hold
// comes out; the rest stays in the chest (it was zeroed first, so a full inventory lost it all). Real engine:
// every plugin loaded, a real Player and inventory; the house is a stand-in from House.houseFor.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, House, Dungeon;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  House = require("../plugins/skills/construction/House.Construction");
  Dungeon = require("../plugins/skills/construction/Dungeon.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9730;
function guest(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pohguest" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  return p;
}

function houseWithTreasure(t, player, coins) {
  const house = {
    owner: null,
    save: { treasure: { coins, addedAt: 0 } },
    getFurnitureAt: () => ({ buildableKey: "MAGIC_CHEST" }),
    getRoomPositionAt: () => ({ x: 0, y: 0, plane: 0 }),
    furnitureEntries: () => [],
  };
  t.mock.method(House, "houseFor", (who) => (who === player ? house : null));
  t.mock.method(House, "saveHouse", () => {});
  Dungeon.setChallengeMode(house, true);
  return house;
}

const open = (player) => Dungeon.openChest({ player, location: new core.Location(0, 0, 0), objectId: 1, object: null });

test("a full inventory takes nothing from the treasure chest, and the treasure stays", (t) => {
  const player = guest(t);
  const house = houseWithTreasure(t, player, 100000);
  for (let slot = 0; slot < 28; slot++) player.getInventory().setItem(slot, new core.Item(I.BRONZE_SWORD, 1));
  assert.equal(open(player), true);
  assert.equal(house.save.treasure.coins, 100000, "the treasure is still in the chest");
  assert.equal(player.getInventory().getAmount(I.COINS), 0);
});

test("a coin stack near the cap takes only what fits; the rest stays in the chest", (t) => {
  const player = guest(t);
  const house = houseWithTreasure(t, player, 100000);
  player.getInventory().setItem(0, new core.Item(I.COINS, 2147483647 - 40000));
  open(player);
  assert.equal(player.getInventory().getAmount(I.COINS), 2147483647);
  assert.equal(house.save.treasure.coins, 60000);
});

test("room for it all empties the chest", (t) => {
  const player = guest(t);
  const house = houseWithTreasure(t, player, 75000);
  open(player);
  assert.equal(player.getInventory().getAmount(I.COINS), 75000);
  assert.equal(house.save.treasure.coins, 0);
});
