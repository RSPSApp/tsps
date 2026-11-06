// Run after `yarn build`: node --test tests/coin-pouch-full-inventory.test.cjs
// Opening coin pouches pays their coins; with a full inventory and a pouch left in its stack, the coins have no
// room, so nothing is opened rather than the pouch being used up for nothing. Real engine: every plugin loaded,
// a real Player and Inventory, and Open as the native inventory_action packet through ClientConnection.dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let I;
let next = 9860;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pouch" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const c = new ClientConnection(channel);
  c.player = p;
  return { p, c, inv: p.getInventory(), messages };
}
const POUCH = 22521; // Coin pouch (men and women)

async function open(f, option = "Open") {
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId: POUCH, widgetId: 3214, option }]);
  f.c.processTurnPackets();
}

function fill(f, from) {
  for (let slot = from; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
}

test("a full inventory with pouches left in the stack opens nothing", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(POUCH, 5));
  fill(f, 1);
  await open(f);
  assert.equal(f.inv.getAmount(POUCH), 5, "no pouch used up");
  assert.equal(f.inv.getAmount(I.COINS), 0);
  assert.equal(f.messages.at(-1), "You don't have enough inventory space.");
});

test("Open-all frees the pouches' slot, so it still pays in a full inventory", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(POUCH, 5));
  fill(f, 1);
  await open(f, "Open-all");
  assert.equal(f.inv.getAmount(POUCH), 0);
  assert.ok(f.inv.getAmount(I.COINS) > 0);
});

test("with a coin stack held, one pouch opens into it as before", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(POUCH, 5));
  f.inv.setItem(1, new core.Item(I.COINS, 10));
  fill(f, 2);
  await open(f);
  assert.equal(f.inv.getAmount(POUCH), 4);
  assert.ok(f.inv.getAmount(I.COINS) > 10);
});
