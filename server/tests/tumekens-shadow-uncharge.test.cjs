// Run after `yarn build`: node --test tests/tumekens-shadow-uncharge.test.cjs
//
// Uncharge asks first, and the answer must still act on what was asked about. Everything goes
// through ClientConnection.dispatch into the real plugins and real items: a native fixture, which
// shows the server's behaviour for these packets, not that a client sends them in this order.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Shadow = require("../plugins/items/TumekensShadow.plugin");

const HOME = [3222, 3218];
const STATS_BUTTON = (387 << 16) | 1;
const STATS_INTERFACE = 84;
const WORN_HEAD = 15;
const WORN_BODY = 19;
const YES = 1;
const CHARGES = 10;
const SOULS = CHARGES * 2;
const CHAOS = CHARGES * 5;
const NEAR_CAP = () => MAX_STACK_AMOUNT - 1;
const TOO_FULL = "Your inventory is too full to hold the runes.";

let core;
let I;
let next = 4200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function shadow() {
  const staff = new core.Item(I.TUMEKENS_SHADOW, 1);
  staff.setMetaValue(Shadow.CHARGES_KEY, CHARGES);
  return staff;
}

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("shadowqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const name of ["ATTACK", "DEFENCE", "MAGIC"]) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const f = { p, c, inv: p.getInventory(), messages };
  f.inv.setItem(0, shadow());
  return f;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

/** An inventory op as IF_BUTTON on group 149, the op number from the real resolver. */
async function ifButton(f, slot, option) {
  const itemId = f.inv.getItems()[slot].getId();
  const op = [2, 3, 4, 6, 7].find((candidate) =>
    ItemActionPacketListener.resolveInventoryWidgetAction(itemId, candidate)?.option === option);
  assert.ok(op, `the cache gives item ${itemId} a ${option} op`);
  await send(f, { type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: op, slot, itemId });
}

/** The packet the client sends for a listed inventory op such as Wield. */
async function inventoryAction(f, slot, option) {
  await send(f, { type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option });
}

const widget = (uid) => ({ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum: 1 });
const takeOff = (f, child) => send(f, widget((387 << 16) | child));
const answerYes = (f) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: YES,
});
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);

function assertAsked(f) {
  assert.ok(pending(f), "the prompt is open");
}

const worn = (f) => f.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];

function floor(f, id) {
  const found = ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), f.p.getPrivateArea?.());
  return found ? found.getItem().getAmount() : 0;
}

const owned = (f, id) => f.inv.getAmount(id) + floor(f, id);

/** What the player has, wherever it is: the staff's charges and the runes they could have become. */
function state(f) {
  const staves = [worn(f), ...f.inv.getItems()].filter((item) =>
    item?.getId() === I.TUMEKENS_SHADOW || item?.getId() === I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(staves.length, 1, "exactly one staff");
  return {
    charges: Number(staves[0].getMetaValue(Shadow.CHARGES_KEY)) || 0,
    souls: owned(f, I.SOUL_RUNE),
    chaos: owned(f, I.CHAOS_RUNE),
  };
}

const REFUNDED = () => ({ charges: 0, souls: SOULS, chaos: CHAOS });
const KEPT = () => ({ charges: CHARGES, souls: 0, chaos: 0 });

function wearTwoPieces(f) {
  f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.RUNE_FULL_HELM, 1));
  f.p.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(I.RUNE_PLATEBODY, 1));
}

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(new core.Item(I.RAKE, 1), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

test("control: Yes with nothing changed refunds every charge, and a moved staff is still the one asked about", async (t) => {
  const f = actor(t);
  await ifButton(f, 0, "Uncharge");
  assertAsked(f);
  await answerYes(f);
  assert.deepEqual(state(f), REFUNDED());
  assert.equal(f.inv.getItems()[0].getId(), I.TUMEKENS_SHADOW_UNCHARGED_);

  const moved = actor(t);
  await ifButton(moved, 0, "Uncharge");
  await send(moved, { type: "inventory_move", from: 0, to: 5, widgetId: 3214 });
  assert.equal(moved.inv.getItems()[5].getId(), I.TUMEKENS_SHADOW, "the staff moved");
  await answerYes(moved);
  assert.deepEqual(state(moved), REFUNDED());
});

test("stats screen: Wield beside it leaves the prompt open, and Yes pays nothing for the charges the staff keeps", async (t) => {
  const f = actor(t);
  await ifButton(f, 0, "Uncharge");
  assertAsked(f);
  await send(f, widget(STATS_BUTTON));
  assert.equal(f.p.getInterfaceId(), STATS_INTERFACE, "the stats screen opened");
  assertAsked(f);
  await inventoryAction(f, 0, "Wield");
  assert.equal(worn(f)?.getId(), I.TUMEKENS_SHADOW, "the staff was wielded");
  assertAsked(f);
  await answerYes(f);
  assert.deepEqual(state(f), KEPT());
});

test("IF_BUTTON Wield: the same stale answer by a hand-made packet pays nothing either", async (t) => {
  const f = actor(t);
  await ifButton(f, 0, "Uncharge");
  await ifButton(f, 0, "Wield");
  assert.equal(worn(f)?.getId(), I.TUMEKENS_SHADOW, "the staff was wielded");
  assertAsked(f);
  await answerYes(f);
  assert.deepEqual(state(f), KEPT());
});

test("Wield with no stats screen closes the prompt first, so Yes has nothing to answer", async (t) => {
  const f = actor(t);
  await ifButton(f, 0, "Uncharge");
  await inventoryAction(f, 0, "Wield");
  assert.equal(pending(f), null, "the prompt closed");
  await answerYes(f);
  assert.deepEqual(state(f), KEPT());
});

test("a staff removed before Yes pays nothing, though the removed object still holds its charges", async (t) => {
  const f = actor(t);
  await ifButton(f, 0, "Uncharge");
  f.inv.deleteAtSlot(0, 1);
  assert.equal(f.inv.getAmount(I.TUMEKENS_SHADOW), 0, "the staff is gone");
  await answerYes(f);
  assert.equal(owned(f, I.SOUL_RUNE), 0);
  assert.equal(owned(f, I.CHAOS_RUNE), 0);
});

test("filling the inventory before Yes keeps every charge and pays nothing", async (t) => {
  const control = actor(t);
  wearTwoPieces(control);
  fillTo(control, 2);
  await ifButton(control, 0, "Uncharge");
  assertAsked(control);
  await answerYes(control);
  assert.deepEqual(state(control), REFUNDED(), "control: exactly enough room");

  const f = actor(t);
  wearTwoPieces(f);
  fillTo(f, 2);
  await ifButton(f, 0, "Uncharge");
  assertAsked(f);
  await takeOff(f, WORN_HEAD);
  await takeOff(f, WORN_BODY);
  assert.equal(f.inv.getFreeSlots(), 0, "taking off two pieces filled the inventory");
  assertAsked(f);
  await answerYes(f);
  assert.deepEqual(state(f), KEPT());
  assert.equal(f.messages.at(-1), TOO_FULL);
});

test("one free slot at Yes can't take two new stacks: neither rune arrives and no charge goes", async (t) => {
  const f = actor(t);
  wearTwoPieces(f);
  fillTo(f, 2);
  await ifButton(f, 0, "Uncharge");
  assertAsked(f);
  await takeOff(f, WORN_HEAD);
  assert.equal(f.inv.getFreeSlots(), 1);
  await answerYes(f);
  assert.deepEqual(state(f), KEPT());
  assert.equal(f.messages.at(-1), TOO_FULL);
});

test("one free slot is enough when one rune already has a stack", async (t) => {
  const f = actor(t);
  f.inv.setItem(1, new core.Item(I.SOUL_RUNE, 7));
  fillTo(f, 1);
  await ifButton(f, 0, "Uncharge");
  assertAsked(f);
  await answerYes(f);
  assert.deepEqual(state(f), { charges: 0, souls: SOULS + 7, chaos: CHAOS });
});

test("a stack too near the cap to take its share refuses the whole refund", async (t) => {
  const nearCap = NEAR_CAP();
  const f = actor(t);
  f.inv.setItem(1, new core.Item(I.SOUL_RUNE, nearCap));
  await ifButton(f, 0, "Uncharge");
  if (pending(f)) await answerYes(f);
  assert.deepEqual(state(f), { charges: CHARGES, souls: nearCap, chaos: 0 });
  assert.equal(f.messages.at(-1), TOO_FULL);
});

test("preset rune stacks don't take the refund, so they don't count as room", async (t) => {
  const pool = Presets.getGlobalPresetPool();
  const spawned = (id) => {
    const item = Presets._test.spawnPresetItem(new core.Item(id, 100), pool[0]);
    assert.equal(item.isPresetItem(), true, "the real producer marked the stack");
    return item;
  };
  const f = actor(t);
  f.inv.setItem(1, spawned(I.SOUL_RUNE));
  f.inv.setItem(2, spawned(I.CHAOS_RUNE));
  fillTo(f, 1);
  await ifButton(f, 0, "Uncharge");
  if (pending(f)) await answerYes(f);
  assert.deepEqual(state(f), { charges: CHARGES, souls: 100, chaos: 100 });
  assert.equal(f.messages.at(-1), TOO_FULL);
});
