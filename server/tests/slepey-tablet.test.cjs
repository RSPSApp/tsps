// Run after `yarn build`: node --test tests/slepey-tablet.test.cjs
// The Slepey tablet (Wiki: Slepey tablet): Phosani's 1/25 roll comes from her drop table; on top of it the tablet is
// guaranteed on the 25th kill, and on any later kill for a player with no tablet who hasn't used one on Drakan's
// medallion. A second tablet picked up while one is held crumbles to dust.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Common = require("../plugins/bosses/nightmare/Common.Nightmare");
const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
const Medallion = require("../plugins/items/DrakansMedallion.plugin");

const SLEPEY_TABLET = 25837;
let core = null;
let api = null;
let placed = [];
let tableDrops = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("SlepeyTabletTest");
  Medallion.register(api);
  Common.init({
    core,
    emitCustomEvent(name, payload) {
      if (name === "npc-drops:roll-table") payload.drops.push(...tableDrops.map((drop) => ({ ...drop })));
    },
    getItemOnGroundManager: () => ({ registerLocation(player, item) { placed.push([player, item.getId()]); } }),
  });
});

function actor() {
  const player = new Player(null, new core.Location(3870, 9950, 3));
  player.setUsername("slepey-tablet-test");
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  return player;
}

/** Phosani's kill with `kills` already counted; returns the tablets placed for the player. */
function killPhosani(player, kills) {
  player.setAttribute(Common.PHOSANI_KILLS_ATTRIBUTE, kills);
  placed = [];
  const fight = { phosani: true, boss: null, dream: { tile: () => new core.Location(3870, 9950, 3), area: null },
    contribution: new Map([[player, { shield: 1, totems: 1 }]]) };
  Loot.reward(fight, [player]);
  return placed.filter(([who, id]) => who === player && id === SLEPEY_TABLET).length;
}

test("the 25th Phosani's kill always gives the tablet, even to a player who has one", () => {
  tableDrops = [{ itemId: core.ItemIdentifiers.BIG_BONES, amount: 1 }];
  const player = actor();
  assert.equal(killPhosani(player, 23), 0, "the 24th kill: only her table's roll");
  player.getInventory().adds(SLEPEY_TABLET, 1);
  assert.equal(killPhosani(player, 24), 1, "the 25th kill");
});

test("past 25 kills, a player with no tablet and Slepe locked gets one on the next kill", () => {
  tableDrops = [{ itemId: core.ItemIdentifiers.BIG_BONES, amount: 1 }];
  const player = actor();
  assert.equal(killPhosani(player, 40), 1, "no tablet, Slepe locked");
  player.getBank(0).add(new core.Item(SLEPEY_TABLET, 1));
  assert.equal(killPhosani(player, 41), 0, "a banked tablet counts");
  const fresh = actor();
  fresh.setAttribute("drakans-medallion:slepe-unlocked", true);
  assert.equal(killPhosani(fresh, 41), 0, "already used on the medallion");
  const held = actor();
  held.getInventory().adds(SLEPEY_TABLET, 1);
  assert.equal(killPhosani(held, 41), 0, "already holding one");
});

test("a table roll that already holds the tablet isn't doubled", () => {
  tableDrops = [{ itemId: SLEPEY_TABLET, amount: 1 }];
  assert.equal(killPhosani(actor(), 24), 1);
});

test("a second tablet picked up while one is held crumbles to dust; the first is picked up as usual", (t) => {
  const removed = [];
  t.mock.method(api, "getItemOnGroundManager", () => ({ deregister: (item) => removed.push(item) }));
  const player = actor();
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  const groundItem = { getItem: () => new core.Item(SLEPEY_TABLET, 1) };
  const first = { player, groundItem, handled: false };
  Medallion._test.crumbleSpareTablet(first);
  assert.equal(first.handled, false, "no tablet held: the normal pickup goes ahead");
  player.getInventory().adds(SLEPEY_TABLET, 1);
  const second = { player, groundItem, handled: false };
  Medallion._test.crumbleSpareTablet(second);
  assert.equal(second.handled, true);
  assert.deepEqual(removed, [groundItem]);
  assert.deepEqual(messages, ["The tablet crumbles to dust as you touch it."]);
  assert.equal(player.getInventory().getAmount(SLEPEY_TABLET), 1);
});
