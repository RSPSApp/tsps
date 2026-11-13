// Run after `yarn build`: node --test tests/toxic-blowpipe-item.test.cjs
// The toxic blowpipe as an item: the loading reply, Check, Dismantle and picking ammunition up
// into it. Real engine: every plugin loaded, a real Player, the native packets through
// ClientConnection.dispatch.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const ToxicBlowpipe = require("../plugins/items/ToxicBlowpipe.plugin");

const LUMBRIDGE = [3222, 3218];
const { BlowpipeState } = ToxicBlowpipe._test;

let core;
let I;
let next = 9850;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { ammoPicking = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pipeitem" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...LUMBRIDGE, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  PM.emitCustomEvent("settings:set", { player: p, settingId: 305, value: ammoPicking ? 1 : 0 });
  return { p, c, inv: p.getInventory(), messages };
}

function pipe(scales, dartId = -1, dartAmount = 0) {
  const item = new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1);
  BlowpipeState.write(item, { scales, dartId, dartAmount });
  return item;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}
const useOn = (f, slot, target) => send(f, { type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(), target: { kind: "inventory", slot: target, id: f.inv.getItems()[target].getId() } });
const option = (f, slot, name) => send(f, { type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option: name });

function pile(t, f, itemId, amount) {
  const ground = core.ItemOnGroundManager.registers(f.p, new core.Item(itemId, amount));
  t.after(() => { if (!ground.isPendingRemoval()) core.ItemOnGroundManager.deregister(ground); });
  return ground;
}

async function take(f, itemId) {
  const at = f.p.getLocation();
  await f.c.dispatch([{ type: "ground_item_action", itemId, x: at.getX(), y: at.getY(), option: "Take" }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 4; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

// ------------------------------------------------------------------ loading and Check

test("scales on the empty pipe answer with the Check line, darts None (rsprox 4122)", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  f.inv.setItem(1, new core.Item(I.ZULRAHS_SCALES, 4899));
  await useOn(f, 1, 0);
  assert.equal(f.inv.getItems()[0].getId(), I.TOXIC_BLOWPIPE);
  assert.deepEqual(f.messages, ["Darts: <col=007f00>None</col>. Scales: <col=007f00>4,899 (29.9%)</col>."]);
});

test("darts on the pipe answer with the Check line and the new totals (rsprox 4121)", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, pipe(4899));
  f.inv.setItem(1, new core.Item(I.IRON_DART, 8));
  await useOn(f, 1, 0);
  assert.deepEqual(f.messages, ["Darts: <col=007f00>Iron dart x 8</col>. Scales: <col=007f00>4,899 (29.9%)</col>."]);
  assert.equal(f.inv.getAmount(I.IRON_DART), 0);
});

test("Check on a pipe with scales and no darts prints Darts: None first", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, pipe(4899));
  await option(f, 0, "Check");
  assert.deepEqual(f.messages, ["Darts: <col=007f00>None</col>. Scales: <col=007f00>4,899 (29.9%)</col>."]);
});

// ------------------------------------------------------------------ Dismantle

test("Dismantle turns the empty pipe into 20,000 Zulrah's scales in its own slot", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.COINS, 5));
  f.inv.setItem(3, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  await option(f, 3, "Dismantle");
  assert.equal(f.inv.getItems()[3]?.getId(), I.ZULRAHS_SCALES);
  assert.equal(f.inv.getItems()[3]?.getAmount(), 20000);
  assert.equal(f.inv.getAmount(I.TOXIC_BLOWPIPE_EMPTY_), 0);
});

test("Dismantle adds the scales to a stack already carried", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.ZULRAHS_SCALES, 500));
  f.inv.setItem(1, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  await option(f, 1, "Dismantle");
  assert.equal(f.inv.getAmount(I.ZULRAHS_SCALES), 20500);
  assert.equal(f.inv.getItems()[1]?.getId() ?? -1, -1, "the pipe's slot is free");
});

test("Dismantle refuses a preset pipe, which would give free scales", async (t) => {
  const f = actor(t);
  const item = new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1);
  item.setMetaValue(core.Item.PRESET_META, true);
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  f.inv.setItem(0, item);
  await option(f, 0, "Dismantle");
  assert.equal(f.inv.getItems()[0], item);
  assert.equal(f.inv.getAmount(I.ZULRAHS_SCALES), 0);
});

test("the Blazing pipe's Dismantle still takes the kit off", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.BLAZING_BLOWPIPE_EMPTY_, 1));
  await option(f, 0, "Dismantle");
  assert.equal(f.inv.getAmount(I.TOXIC_BLOWPIPE_EMPTY_), 1);
  assert.equal(f.inv.getAmount(I.ZULRAHS_SCALES), 0);
});

// ------------------------------------------------------------------ pickup

test("Ammo-picking on: picked-up darts go into the worn pipe loaded with them", async (t) => {
  const f = actor(t);
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe(1000, I.IRON_DART, 100));
  pile(t, f, I.IRON_DART, 8);
  await take(f, I.IRON_DART);
  assert.equal(f.inv.getAmount(I.IRON_DART), 0);
  assert.equal(BlowpipeState.read(f.p.getEquipment().get(core.Equipment.WEAPON_SLOT)).dartAmount, 108);
});

test("Ammo-picking on: picked-up darts go into a pipe in the inventory too", async (t) => {
  const f = actor(t);
  const held = pipe(1000, I.IRON_DART, 100);
  f.inv.setItem(0, held);
  pile(t, f, I.IRON_DART, 8);
  await take(f, I.IRON_DART);
  assert.equal(f.inv.getAmount(I.IRON_DART), 0);
  assert.equal(BlowpipeState.read(held).dartAmount, 108);
});

test("picked-up darts of another kind, or with the setting off, go to the inventory", async (t) => {
  const other = actor(t);
  const loaded = pipe(1000, I.IRON_DART, 100);
  other.inv.setItem(0, loaded);
  pile(t, other, I.MITHRIL_DART, 8);
  await take(other, I.MITHRIL_DART);
  assert.equal(other.inv.getAmount(I.MITHRIL_DART), 8);
  assert.equal(BlowpipeState.read(loaded).dartAmount, 100);

  const off = actor(t, { ammoPicking: false });
  const kept = pipe(1000, I.IRON_DART, 100);
  off.inv.setItem(0, kept);
  pile(t, off, I.IRON_DART, 8);
  await take(off, I.IRON_DART);
  assert.equal(off.inv.getAmount(I.IRON_DART), 8);
  assert.equal(BlowpipeState.read(kept).dartAmount, 100);
});

test("picked-up darts that would overfill the pipe go to the inventory whole", async (t) => {
  const f = actor(t);
  const held = pipe(1000, I.IRON_DART, 16380);
  f.inv.setItem(0, held);
  pile(t, f, I.IRON_DART, 8);
  await take(f, I.IRON_DART);
  assert.equal(f.inv.getAmount(I.IRON_DART), 8);
  assert.equal(BlowpipeState.read(held).dartAmount, 16380);
});

test("picked-up scales go into the pipe when it is the only scale-using item carried", async (t) => {
  const f = actor(t, { ammoPicking: false });
  f.inv.setItem(0, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  pile(t, f, I.ZULRAHS_SCALES, 250);
  await take(f, I.ZULRAHS_SCALES);
  assert.equal(f.inv.getAmount(I.ZULRAHS_SCALES), 0);
  assert.equal(f.inv.getItems()[0].getId(), I.TOXIC_BLOWPIPE);
  assert.equal(BlowpipeState.read(f.inv.getItems()[0]).scales, 250);
});

test("picked-up scales stay in the inventory beside another scale-using item", async (t) => {
  const f = actor(t);
  const held = pipe(1000);
  f.inv.setItem(0, held);
  f.inv.setItem(1, new core.Item(I.SERPENTINE_HELM_UNCHARGED_, 1));
  pile(t, f, I.ZULRAHS_SCALES, 250);
  await take(f, I.ZULRAHS_SCALES);
  assert.equal(f.inv.getAmount(I.ZULRAHS_SCALES), 250);
  assert.equal(BlowpipeState.read(held).scales, 1000);
});
