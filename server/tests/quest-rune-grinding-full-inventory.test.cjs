// Run after `yarn build`: node --test tests/quest-rune-grinding-full-inventory.test.cjs
// Dream Mentor's hammer on an astral rune and Eyes of Glouphrie's pestle on a mud rune took one rune from a stack and
// added the product; with a full inventory the stack frees no slot, so the rune was lost and nothing came back. Real
// engine: every plugin loaded, a real Player with a real full Inventory, the quests' own item-on-item handlers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9500;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function packed(t, tool, rune) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("grinder" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => p.setRegistered(false));
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(tool, 1));
  inv.setItem(1, new core.Item(rune, 5));
  for (let slot = 2; slot < 28; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1));
  return { p, inv, messages };
}

function use(f, a, b) {
  const items = f.inv.getItems();
  const slot = (id) => items.findIndex((item) => item?.getId() === id);
  PM.emitItemOnItem({ player: f.p, usedItem: items[slot(a)], usedItemId: a, usedItemSlot: slot(a),
    usedWithItem: items[slot(b)], usedWithItemId: b, usedWithItemSlot: slot(b), handled: false });
}

test("a full inventory keeps the astral rune rather than hammering it into nothing", (t) => {
  const f = packed(t, I.HAMMER, I.ASTRAL_RUNE);
  use(f, I.HAMMER, I.ASTRAL_RUNE);
  assert.equal(f.inv.getAmount(I.ASTRAL_RUNE), 5);
  assert.equal(f.inv.getAmount(I.ASTRAL_RUNE_SHARDS), 0);
  f.inv.setItem(27, new core.Item(-1, 0));
  use(f, I.HAMMER, I.ASTRAL_RUNE);
  assert.deepEqual([f.inv.getAmount(I.ASTRAL_RUNE), f.inv.getAmount(I.ASTRAL_RUNE_SHARDS)], [4, 1], "with room the shards are made");
});

test("a full inventory keeps the mud rune rather than grinding it into nothing", (t) => {
  const f = packed(t, I.PESTLE_AND_MORTAR, I.MUD_RUNE);
  use(f, I.PESTLE_AND_MORTAR, I.MUD_RUNE);
  assert.equal(f.inv.getAmount(I.MUD_RUNE), 5);
  assert.equal(f.inv.getAmount(I.GROUND_MUD_RUNES), 0);
  f.inv.setItem(27, new core.Item(-1, 0));
  use(f, I.PESTLE_AND_MORTAR, I.MUD_RUNE);
  assert.deepEqual([f.inv.getAmount(I.MUD_RUNE), f.inv.getAmount(I.GROUND_MUD_RUNES)], [4, 1]);
});
