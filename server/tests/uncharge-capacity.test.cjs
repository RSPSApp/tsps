// Run after `yarn build`: node --test tests/uncharge-capacity.test.cjs
//
// A refund the inventory can't take leaves the item charged, instead of emptying it and losing the
// refund. Room means what add() will take: a stack with other metadata isn't one to merge into, and a
// stack near the limit has only so much room.
//
// Clicks go through ClientConnection.dispatch as decoded packets. Charges are set on the item under
// each plugin's own key, and preset stacks come from applyPreset with a custom preset. Whether a
// preset rune should pay for anything is not decided here: these tests only ask that nothing is lost.
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
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Blowpipe = require("../plugins/items/ToxicBlowpipe.plugin");
const Quiver = require("../plugins/items/DizanasQuiver.plugin");
const Trident = require("../plugins/items/Trident.plugin");
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");

const HOME = [3222, 3218];
const MAX = 2147483647;
const YES = 1;
const QUIVER_SLOT = (387 << 16) | 28;
const WORN_HEAD_CHILD = 15;

let core;
let I;
let next = 5900;

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

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("refundqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), eq: p.getEquipment() };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function widgetOpFor(itemId, option) {
  for (const op of [2, 3, 4, 6, 7]) {
    const resolved = ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op);
    if (resolved?.option?.toLowerCase() === option.toLowerCase()) return op;
  }
  assert.fail(`the cache gives item ${itemId} no ${option} op`);
}

async function heldOp(f, slot, option) {
  const itemId = f.inv.getItems()[slot].getId();
  await send(f, { type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: widgetOpFor(itemId, option), slot, itemId });
}

const answerYes = (f) => send(f, { type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: YES });

const item = (id, amount = 1) => new core.Item(id, amount);

function put(f, value, slot) {
  f.inv.setItem(slot, value);
  return f.inv.getItems()[slot];
}

function charged(id, key, charges) {
  const held = item(id);
  held.setMetaValue(key, charges);
  return held;
}

const chargesOf = (held, key) => Number(held.getMetaValue(key)) || 0;

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), 0);
}

const plainOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && !held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);
const presetOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);

/** Holds 300 preset copies of `id` in slot 0, from the real load. */
function presetStack(f, id) {
  const preset = new Presetable("qa", [item(id, 300)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, preset);
  assert.equal(presetOf(f, id), 300, "marked copies from the real load");
}

// ------------------------------------------------------------------ one refund, no prompt

const SINGLE = () => [
  { name: "Sanguinesti staff", id: I.SANGUINESTI_STAFF, key: "sanguinesti-staff-charges", refund: I.BLOOD_RUNE, owed: 200, preset: true },
  { name: "Toxic staff of the dead", id: I.TOXIC_STAFF_OF_THE_DEAD, key: "toxic-staff-charges", refund: I.ZULRAHS_SCALES, owed: 100 },
  { name: "Dizana's quiver", id: Quiver._test.idFor("charged", false), key: Quiver.CHARGE_META, refund: I.SUNFIRE_SPLINTERS, owed: 100 },
  { name: "Accursed sceptre", id: I.ACCURSED_SCEPTRE_A_, key: "accursed-sceptre-charges", refund: I.REVENANT_ETHER, owed: 1100 },
  { name: "Venator bow", id: I.VENATOR_BOW, key: "venator-bow:charges", refund: I.ANCIENT_ESSENCE, owed: 100 },
  { name: "Bone staff", id: I.BONE_STAFF, key: "bone-staff-charges", refund: I.CHAOS_RUNE, owed: 100, preset: true },
];

test("Uncharge onto a stack: paid when it fits exactly, refused one past it", async (t) => {
  for (const c of SINGLE()) {
    const run = async (held) => {
      const f = actor(t);
      put(f, item(c.refund, held), 0);
      const staff = put(f, charged(c.id, c.key, 100), 1);
      await heldOp(f, 1, "Uncharge");
      return [f.inv.getAmount(c.refund), chargesOf(staff, c.key)];
    };
    assert.deepEqual(await run(1000), [1000 + c.owed, 0], `${c.name}: control, room to spare`);
    assert.deepEqual(await run(MAX - c.owed), [MAX, 0], `${c.name}: control, exact fit`);
    assert.deepEqual(await run(MAX - c.owed + 1), [MAX - c.owed + 1, 100], `${c.name}: refused, charges kept`);
  }
});

test("Uncharge on a full inventory joins a plain stack, and is refused beside only a preset one", async (t) => {
  for (const c of SINGLE().filter((entry) => entry.preset)) {
    const run = async (preset) => {
      const f = actor(t);
      if (preset) presetStack(f, c.refund);
      else put(f, item(c.refund, 10), 0);
      const slot = f.inv.getEmptySlot();
      const staff = put(f, charged(c.id, c.key, 100), slot);
      fill(f);
      await heldOp(f, slot, "Uncharge");
      return [plainOf(f, c.refund), chargesOf(staff, c.key)];
    };
    assert.deepEqual(await run(false), [10 + c.owed, 0], `${c.name}: control, plain stack`);
    assert.deepEqual(await run(true), [0, 100], `${c.name}: refused, charges kept`);
  }
});

// ------------------------------------------------------------------ more than one refund

test("Trident Uncharge pays every rune or none", async (t) => {
  const recipe = Trident._test.RECIPES.find((entry) => entry.primaryName === "coins");
  const run = async (setup) => {
    const f = actor(t);
    setup(f);
    f.inv.add(item(I.CHAOS_RUNE, 7), false);
    f.inv.add(item(I.FIRE_RUNE, 7), false);
    const slot = f.inv.getEmptySlot();
    const staff = put(f, item(recipe.chargedId), slot);
    Trident._test.setCharges(staff, 100);
    return { f, slot, staff };
  };
  const control = await run((f) => f.inv.add(item(I.DEATH_RUNE, 10), false));
  fill(control.f);
  await heldOp(control.f, control.slot, "Uncharge");
  assert.equal(Trident._test.getCharges(control.staff), 0, "control: emptied");
  assert.equal(plainOf(control.f, I.DEATH_RUNE), 110, "control: death runes paid");
  assert.equal(plainOf(control.f, I.CHAOS_RUNE), 107, "control: chaos runes paid");

  for (const [name, setup] of [
    ["only a preset stack", (f) => presetStack(f, I.DEATH_RUNE)],
    ["no room on the stack", (f) => f.inv.add(item(I.DEATH_RUNE, MAX - 50), false)],
  ]) {
    const { f, slot, staff } = await run(setup);
    const before = plainOf(f, I.DEATH_RUNE);
    fill(f);
    await heldOp(f, slot, "Uncharge");
    assert.equal(Trident._test.getCharges(staff), 100, `${name}: charges kept`);
    assert.equal(plainOf(f, I.DEATH_RUNE), before, `${name}: no death runes paid`);
    assert.equal(plainOf(f, I.CHAOS_RUNE), 7, `${name}: and no chaos runes`);
  }
});

test("Eye of Ayak Uncharge pays every rune or none", async (t) => {
  const key = "eye-of-ayak-charges";
  const run = async (setup) => {
    const f = actor(t);
    setup(f);
    f.inv.add(item(I.CHAOS_RUNE, 7), false);
    const slot = f.inv.getEmptySlot();
    const eye = put(f, charged(I.EYE_OF_AYAK, key, 100), slot);
    eye.setMetaValue("eye-of-ayak-charge-material", "runes");
    fill(f);
    await heldOp(f, slot, "Uncharge");
    await answerYes(f);
    return [chargesOf(eye, key), plainOf(f, I.DEATH_RUNE), plainOf(f, I.CHAOS_RUNE)];
  };
  assert.deepEqual(await run((f) => f.inv.add(item(I.DEATH_RUNE, 10), false)), [0, 210, 107], "control");
  assert.deepEqual(await run((f) => presetStack(f, I.DEATH_RUNE)), [100, 0, 7], "only a preset stack");
  assert.deepEqual(await run((f) => f.inv.add(item(I.DEATH_RUNE, MAX - 50), false)), [100, MAX - 50, 7], "no room on the stack");
});

test("Warped sceptre Uncharge pays every rune or none", async (t) => {
  const key = "warped-sceptre";
  const run = async (setup) => {
    const f = actor(t);
    setup(f);
    f.inv.add(item(I.EARTH_RUNE, 7), false);
    const slot = f.inv.getEmptySlot();
    const sceptre = put(f, charged(I.WARPED_SCEPTRE, key, 100), slot);
    fill(f);
    await heldOp(f, slot, "Uncharge");
    await answerYes(f);
    return [chargesOf(sceptre, key), plainOf(f, I.CHAOS_RUNE), plainOf(f, I.EARTH_RUNE)];
  };
  assert.deepEqual(await run((f) => f.inv.add(item(I.CHAOS_RUNE, 10), false)), [0, 210, 507], "control");
  assert.deepEqual(await run((f) => presetStack(f, I.CHAOS_RUNE)), [100, 0, 7], "only a preset stack");
  assert.deepEqual(await run((f) => f.inv.add(item(I.CHAOS_RUNE, MAX - 50), false)), [100, MAX - 50, 7], "no room on the stack");
});

// ------------------------------------------------------------------ asked first, checked at Yes

test("Circlet of water Uncharge checks room when asked and again at Yes", async (t) => {
  const key = "circlet-of-water:charges";
  const setup = (held) => {
    const f = actor(t);
    if (held) put(f, item(I.WATER_RUNE, held), 0);
    const circlet = put(f, charged(I.CIRCLET_OF_WATER, key, 100), 1);
    return { f, circlet };
  };
  const control = setup(10);
  fill(control.f);
  await heldOp(control.f, 1, "Uncharge");
  await answerYes(control.f);
  assert.deepEqual([control.f.inv.getAmount(I.WATER_RUNE), chargesOf(control.circlet, key)], [510, 0], "control: joins the stack");

  const near = setup(MAX - 50);
  await heldOp(near.f, 1, "Uncharge");
  await answerYes(near.f);
  assert.deepEqual([near.f.inv.getAmount(I.WATER_RUNE), chargesOf(near.circlet, key)], [MAX - 50, 100], "no room on the stack");

  // One free slot when asked, gone by Yes: taking off a worn helm doesn't close the prompt.
  const late = setup(0);
  late.f.eq.setItem(core.Equipment.HEAD_SLOT, item(I.BRONZE_FULL_HELM));
  while (late.f.inv.getFreeSlots() > 1) late.f.inv.add(item(I.RAKE), false);
  await heldOp(late.f, 1, "Uncharge");
  const childId = WORN_HEAD_CHILD;
  await send(late.f, { type: "widget_action", widgetId: (387 << 16) | childId, groupId: 387, childId, buttonNum: 1 });
  assert.equal(late.f.inv.getFreeSlots(), 0, "the helm took the last slot");
  await answerYes(late.f);
  assert.deepEqual([late.f.inv.getAmount(I.WATER_RUNE), chargesOf(late.circlet, key)], [0, 100], "filled before Yes");
});

test("Eye of Ayak Dismantle gives the tears, or keeps the eye when they don't fit", async (t) => {
  const run = async (held) => {
    const f = actor(t);
    if (held) put(f, item(I.DEMON_TEAR, held), 0);
    put(f, item(I.EYE_OF_AYAK_UNCHARGED_), 1);
    await heldOp(f, 1, "Dismantle");
    await answerYes(f);
    return [f.inv.getAmount(I.DEMON_TEAR), f.inv.getAmount(I.EYE_OF_AYAK_UNCHARGED_)];
  };
  assert.deepEqual(await run(0), [10000, 0], "control: no stack held");
  assert.deepEqual(await run(5), [10005, 0], "control: joins a stack");
  assert.deepEqual(await run(MAX - 5), [MAX - 5, 1], "no room on the stack");
});

// ------------------------------------------------------------------ Dizana's quiver ammo

test("Quiver Remove leaves in the quiver what the inventory can't take", async (t) => {
  const run = async (setup, full = true) => {
    const f = actor(t);
    setup(f);
    const before = plainOf(f, I.DRAGON_ARROW);
    f.p.setAttribute(Quiver.ATTRIBUTE, { id: I.DRAGON_ARROW, amount: 100 });
    if (full) fill(f);
    await send(f, { type: "widget_action", widgetId: QUIVER_SLOT, groupId: 387, childId: 28, buttonNum: 1 });
    return [plainOf(f, I.DRAGON_ARROW) - before, Quiver.stored(f.p)?.amount ?? 0];
  };
  assert.deepEqual(await run((f) => put(f, item(I.DRAGON_ARROW, 10), 0)), [100, 0], "control: joins a plain stack");
  assert.deepEqual(await run(() => {}, false), [100, 0], "control: a free slot");
  assert.deepEqual(await run((f) => presetStack(f, I.DRAGON_ARROW)), [0, 100], "only a preset stack");
  assert.deepEqual(await run((f) => put(f, item(I.DRAGON_ARROW, MAX - 40), 0)), [40, 60], "as far as the stack goes");
});

// ------------------------------------------------------------------ the blowpipe's darts

test("Blowpipe: swapping darts keeps the old ones loaded when they can't come out", async (t) => {
  const state = Blowpipe._test.BlowpipeState;
  const run = async (setup) => {
    const f = actor(t);
    setup(f);
    const before = plainOf(f, I.BRONZE_DART);
    const slot = f.inv.getEmptySlot();
    const pipe = put(f, state.write(item(I.TOXIC_BLOWPIPE), { scales: 100, dartId: I.BRONZE_DART, dartAmount: 100 }), slot);
    const dartSlot = f.inv.getEmptySlot();
    put(f, item(I.RUNE_DART, 50), dartSlot);
    fill(f);
    await send(f, {
      type: "inventory_use_on", slot: dartSlot, itemId: I.RUNE_DART,
      target: { kind: "inventory", slot, itemId: I.TOXIC_BLOWPIPE },
    });
    const loaded = state.read(pipe);
    return [loaded.dartId, loaded.dartAmount, plainOf(f, I.BRONZE_DART) - before, f.inv.getAmount(I.RUNE_DART)];
  };
  assert.deepEqual(await run((f) => put(f, item(I.BRONZE_DART, 10), 0)), [I.RUNE_DART, 50, 100, 0], "control: old darts join a plain stack");
  assert.deepEqual(await run((f) => presetStack(f, I.BRONZE_DART)), [I.BRONZE_DART, 100, 0, 50], "only a preset stack");
  assert.deepEqual(await run((f) => put(f, item(I.BRONZE_DART, MAX - 10), 0)), [I.BRONZE_DART, 100, 0, 50], "no room on the stack");
});

// ------------------------------------------------------------------ the rune pouch

test("Rune pouch Empty keeps what the inventory can't take", async (t) => {
  const run = async (setup) => {
    const f = actor(t);
    setup(f);
    const before = plainOf(f, I.BLOOD_RUNE);
    const slot = f.inv.getEmptySlot();
    put(f, item(I.RUNE_POUCH), slot);
    assert.equal(Pouch.store(f.p, I.BLOOD_RUNE, 200), 200, "stored");
    fill(f);
    await heldOp(f, slot, "Empty");
    return [plainOf(f, I.BLOOD_RUNE) - before, Pouch.amountOf(f.p, I.BLOOD_RUNE)];
  };
  assert.deepEqual(await run((f) => put(f, item(I.BLOOD_RUNE, 10), 0)), [200, 0], "control: joins a plain stack");
  assert.deepEqual(await run((f) => presetStack(f, I.BLOOD_RUNE)), [0, 200], "only a preset stack");
  assert.deepEqual(await run((f) => put(f, item(I.BLOOD_RUNE, MAX - 50), 0)), [0, 200], "no room on the stack");
});

// ------------------------------------------------------------------ the bonecrusher

test("Bonecrusher Uncharge keeps its charges when the tokens don't fit", async (t) => {
  const attribute = "bonecrusher:charges";
  const run = async (held) => {
    const f = actor(t);
    put(f, item(I.ECTO_TOKEN, held), 0);
    put(f, item(I.BONECRUSHER), 1);
    f.p.setAttribute(attribute, 2500);
    await heldOp(f, 1, "Uncharge");
    return [f.inv.getAmount(I.ECTO_TOKEN), f.p.getAttribute(attribute)];
  };
  assert.deepEqual(await run(10), [110, 0], "control");
  assert.deepEqual(await run(MAX - 50), [MAX - 50, 2500], "no room on the stack");
});
