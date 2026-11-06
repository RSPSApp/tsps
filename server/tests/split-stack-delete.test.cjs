// Run after `yarn build`: node --test tests/split-stack-delete.test.cjs
//
// A delete by id takes the whole amount when the id sits in more than one stack, and Wield doesn't
// split a worn stack from a held one.
//
// Wield goes in as the frame the browser client sends, through the real decoder and
// ClientConnection.dispatch; item-on-item is the decoded inventory_use_on. Preset copies come from
// applyPreset with a custom preset. Two plain stacks of one id are placed directly: the Wield route
// that made them is what this change closes, and saves made before it can still hold them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Blowpipe = require("../plugins/items/ToxicBlowpipe.plugin");
const Sang = require("../plugins/items/SanguinestiStaff.plugin");
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");

const HOME = [3222, 3218];
// ClientPacketId.INVENTORY_USE: a const enum, so it has no object at runtime. The decoder checks it.
const INVENTORY_USE_OPCODE = 240;
const MAX = 2147483647;
const SKILLS = ["ATTACK", "DEFENCE", "STRENGTH", "RANGED", "PRAYER", "MAGIC"];

let core;
let I;
let next = 5100;

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
  p.setUsername("splitqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const name of SKILLS) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
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

/** The frame ClientBinaryEncoder.encodeInventoryUse builds, through the server's real decoder. */
async function click(f, slot) {
  const held = f.inv.getItems()[slot];
  const option = core.CacheDefinitions.getItem(held.getId()).inventoryActions.find((name) => /^(Wield|Wear)$/.test(name ?? ""));
  assert.ok(option, `item ${held.getId()} has a wear option`);
  const body = Buffer.alloc(8 + option.length + 1);
  body.writeUInt16BE(slot, 0);
  body.writeUInt16BE(held.getId(), 2);
  body.writeInt32BE(held.getAmount(), 4);
  body.write(option, 8, "latin1");
  const packets = decodeClientPackets(Buffer.concat([Buffer.from([INVENTORY_USE_OPCODE, body.length]), body]));
  assert.equal(packets[0].type, "inventory_action");
  await f.c.dispatch(packets);
  f.c.processTurnPackets();
}

async function useOn(f, slot, targetSlot) {
  await send(f, {
    type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
    target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
  });
}

const item = (id, amount = 1) => new core.Item(id, amount);

function put(f, value, slot) {
  f.inv.setItem(slot, value);
  return f.inv.getItems()[slot];
}

const wear = (f, slot, value) => f.eq.setItem(slot, value);
const worn = (f, slot) => f.eq.getItems()[slot];
const stacksOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && held.getAmount() > 0).map((held) => held.getAmount());

function loadCustom(f, inventory) {
  const preset = new Presetable("qa", inventory, [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, preset);
  for (const entry of inventory) {
    assert.ok(f.inv.getItems().some((held) => held.getId() === entry.getId() && held.isPresetItem()), `marked copies of ${entry.getId()}`);
  }
}

/** A preset stack of `id` and a plain one of `plain`, with either in the lower slot. */
async function bothStacks(f, id, plain, plainFirst) {
  loadCustom(f, [item(id, 300)]);
  assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the preset stack loads first");
  put(f, item(id, plain), 5);
  if (plainFirst) await send(f, { type: "inventory_move", from: 0, to: 10, widgetId: 3214 });
  const slots = f.inv.getItems().map((held, slot) => (held.getId() === id ? slot : -1)).filter((slot) => slot >= 0);
  assert.equal(slots.length, 2, "two stacks");
  assert.equal(f.inv.getItems()[slots[0]].isPresetItem(), !plainFirst, "in the order asked for");
  return slots;
}

// ------------------------------------------------------------------ Wield doesn't split a stack

test("wielding a two-hander puts worn darts on a matching held stack", async (t) => {
  const setup = (held) => {
    const f = actor(t);
    assert.equal(item(I.BRONZE_2H_SWORD).getDefinition().isDoubleHanded(), true);
    assert.equal(item(I.BRONZE_DART).getDefinition().isStackable(), true);
    wear(f, core.Equipment.WEAPON_SLOT, item(I.BRONZE_DART, 100));
    put(f, item(I.BRONZE_2H_SWORD), 0);
    if (held) put(f, item(I.BRONZE_DART, 30), 1);
    return f;
  };
  const control = setup(false);
  await click(control, 0);
  assert.equal(worn(control, core.Equipment.WEAPON_SLOT).getId(), I.BRONZE_2H_SWORD, "control: wielded");
  assert.deepEqual(stacksOf(control, I.BRONZE_DART), [100], "control: the darts take the clicked slot");
  assert.equal(control.inv.getItems()[0].getId(), I.BRONZE_DART, "control: in that slot");

  const f = setup(true);
  await click(f, 0);
  assert.equal(worn(f, core.Equipment.WEAPON_SLOT).getId(), I.BRONZE_2H_SWORD, "wielded");
  assert.deepEqual(stacksOf(f, I.BRONZE_DART), [130], "one stack");
  assert.equal(f.inv.getItems()[0].getId(), -1, "the clicked slot empties");
});

test("wielding a two-hander with darts and a shield worn keeps everything", async (t) => {
  const setup = (held) => {
    const f = actor(t);
    wear(f, core.Equipment.WEAPON_SLOT, item(I.BRONZE_DART, 100));
    wear(f, core.Equipment.SHIELD_SLOT, item(I.WOODEN_SHIELD));
    put(f, item(I.BRONZE_2H_SWORD), 0);
    if (held) put(f, item(I.BRONZE_DART, 30), 1);
    return f;
  };
  const control = setup(false);
  await click(control, 0);
  assert.deepEqual([stacksOf(control, I.BRONZE_DART), control.inv.getAmount(I.WOODEN_SHIELD)], [[100], 1], "control");

  const f = setup(true);
  await click(f, 0);
  assert.deepEqual([stacksOf(f, I.BRONZE_DART), f.inv.getAmount(I.WOODEN_SHIELD)], [[130], 1]);
  assert.equal(worn(f, core.Equipment.SHIELD_SLOT).getId(), -1, "the shield came off");
});

test("wielding a two-hander with no room on the held stack changes nothing", async (t) => {
  const run = async (held) => {
    const f = actor(t);
    wear(f, core.Equipment.WEAPON_SLOT, item(I.BRONZE_DART, 100));
    put(f, item(I.BRONZE_2H_SWORD), 0);
    put(f, item(I.BRONZE_DART, held), 1);
    await click(f, 0);
    return [worn(f, core.Equipment.WEAPON_SLOT).getId(), f.inv.getAmount(I.BRONZE_DART), f.inv.getAmount(I.BRONZE_2H_SWORD)];
  };
  assert.deepEqual(await run(MAX - 100), [I.BRONZE_2H_SWORD, MAX, 0], "control: exactly fits");
  assert.deepEqual(await run(MAX - 99), [I.BRONZE_DART, MAX - 99, 1]);
});

test("a preset stack worn stays separate from a plain stack when a two-hander goes on", async (t) => {
  const f = actor(t);
  loadCustom(f, [item(I.BRONZE_DART, 100)]);
  await click(f, 0);
  assert.equal(worn(f, core.Equipment.WEAPON_SLOT).isPresetItem(), true, "wearing the preset darts");
  put(f, item(I.BRONZE_2H_SWORD), 0);
  put(f, item(I.BRONZE_DART, 30), 1);
  await click(f, 0);
  const darts = f.inv.getItems().filter((held) => held.getId() === I.BRONZE_DART).map((held) => [held.getAmount(), held.isPresetItem()]);
  assert.deepEqual(darts.sort((a, b) => a[0] - b[0]), [[30, false], [100, true]]);
});

// ------------------------------------------------------------------ the blowpipe dart route

test("loading the later of two dart stacks into a blowpipe conserves darts", async (t) => {
  const state = Blowpipe._test.BlowpipeState;
  const control = actor(t);
  put(control, item(I.BRONZE_DART, 100), 0);
  const pipeC = put(control, item(I.TOXIC_BLOWPIPE_EMPTY_), 1);
  await useOn(control, 0, 1);
  assert.deepEqual([state.read(pipeC).dartAmount, control.inv.getAmount(I.BRONZE_DART)], [100, 0], "control");

  const f = actor(t);
  put(f, item(I.BRONZE_DART, 30), 0);
  put(f, item(I.BRONZE_DART, 100), 1);
  const pipe = put(f, item(I.TOXIC_BLOWPIPE_EMPTY_), 2);
  await useOn(f, 1, 2);
  assert.equal(state.read(pipe).dartAmount, 100, "the pipe took the stack it was given");
  assert.equal(f.inv.getAmount(I.BRONZE_DART), 30, "the rest stays held");
});

// ------------------------------------------------------------------ the rune routes

const PRESET_REFUSAL = "Preset items cannot be used for this.";
const RUNES_HELD = 500;

/** Blood runes in a preset stack of 300 and a plain one of 200, with what the player is told recorded. */
async function runeStacks(t, plainFirst) {
  const f = actor(t);
  const slots = await bothStacks(f, I.BLOOD_RUNE, 200, plainFirst);
  const [plain, preset] = plainFirst ? slots : [...slots].reverse();
  const messages = [];
  t.mock.method(f.p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return f.p.getPacketSender();
  });
  return { f, plain, preset, messages };
}

const runesHeld = (f) => f.inv.getAmount(I.BLOOD_RUNE);

test("charging Sanguinesti from a preset and a plain stack conserves runes, in either slot order", async (t) => {
  const control = actor(t);
  put(control, item(I.BLOOD_RUNE, 200), 0);
  const staffC = put(control, item(I.SANGUINESTI_STAFF_UNCHARGED_), 1);
  await useOn(control, 0, 1);
  assert.equal(Sang._test.chargesOf(staffC), 100, "control: the staff is charged");
  assert.equal(control.inv.getAmount(I.BLOOD_RUNE), 0, "control: the runes went");

  for (const plainFirst of [true, false]) {
    const { f, plain, preset } = await runeStacks(t, plainFirst);
    const staff = put(f, item(I.SANGUINESTI_STAFF_UNCHARGED_), 20);
    await useOn(f, plain, 20);
    assert.equal(Sang._test.chargesOf(staff), 100, `plain first ${plainFirst}: charged from the plain stack alone`);
    assert.deepEqual(stacksOf(f, I.BLOOD_RUNE), [300], `plain first ${plainFirst}: the preset stack stays`);
    assert.equal(f.inv.getItems()[preset].isPresetItem(), true, `plain first ${plainFirst}: and is still preset`);
    assert.equal(Sang._test.chargesOf(staff) * 2 + runesHeld(f), RUNES_HELD, `plain first ${plainFirst}: conserved`);

    const refused = await runeStacks(t, plainFirst);
    const idle = put(refused.f, item(I.SANGUINESTI_STAFF_UNCHARGED_), 20);
    await useOn(refused.f, refused.preset, 20);
    assert.equal(Sang._test.chargesOf(idle), 0, `plain first ${plainFirst}: the preset stack charges nothing`);
    assert.equal(runesHeld(refused.f), RUNES_HELD, `plain first ${plainFirst}: and no rune goes`);
    assert.ok(refused.messages.includes(PRESET_REFUSAL), `plain first ${plainFirst}: the player is told`);
  }
});

test("storing in a rune pouch from a preset and a plain stack conserves runes, in either slot order", async (t) => {
  const control = actor(t);
  put(control, item(I.BLOOD_RUNE, 200), 0);
  put(control, item(I.RUNE_POUCH), 1);
  await useOn(control, 0, 1);
  assert.equal(Pouch.amountOf(control.p, I.BLOOD_RUNE), 200, "control: the pouch took them");
  assert.equal(control.inv.getAmount(I.BLOOD_RUNE), 0, "control: the runes went");

  for (const plainFirst of [true, false]) {
    const { f, plain, preset } = await runeStacks(t, plainFirst);
    put(f, item(I.RUNE_POUCH), 20);
    await useOn(f, plain, 20);
    assert.equal(Pouch.amountOf(f.p, I.BLOOD_RUNE), 200, `plain first ${plainFirst}: stored from the plain stack alone`);
    assert.deepEqual(stacksOf(f, I.BLOOD_RUNE), [300], `plain first ${plainFirst}: the preset stack stays`);
    assert.equal(f.inv.getItems()[preset].isPresetItem(), true, `plain first ${plainFirst}: and is still preset`);
    assert.equal(Pouch.amountOf(f.p, I.BLOOD_RUNE) + runesHeld(f), RUNES_HELD, `plain first ${plainFirst}: conserved`);

    const refused = await runeStacks(t, plainFirst);
    put(refused.f, item(I.RUNE_POUCH), 20);
    await useOn(refused.f, refused.preset, 20);
    assert.equal(Pouch.amountOf(refused.f.p, I.BLOOD_RUNE), 0, `plain first ${plainFirst}: the preset stack stores nothing`);
    assert.equal(runesHeld(refused.f), RUNES_HELD, `plain first ${plainFirst}: and no rune goes`);
    assert.ok(refused.messages.includes(PRESET_REFUSAL), `plain first ${plainFirst}: the player is told`);
  }
});

// ------------------------------------------------------------------ what callers rely on

test("delete by id: asks past the total still empty it, across every stack", (t) => {
  const f = actor(t);
  put(f, item(I.BRONZE_DART, 100), 0);
  f.inv.deleteNumber(I.BRONZE_DART, 1000);
  assert.deepEqual(stacksOf(f, I.BRONZE_DART), [], "control: one stack");

  const g = actor(t);
  put(g, item(I.BRONZE_DART, 30), 0);
  put(g, item(I.BRONZE_DART, 100), 1);
  g.inv.deleteNumber(I.BRONZE_DART, 1000);
  assert.deepEqual(stacksOf(g, I.BRONZE_DART), []);
  assert.equal(g.inv.getFreeSlots(), g.inv.capacity());
});

test("delete by id takes lower slots first and stops at the amount", (t) => {
  const f = actor(t);
  put(f, item(I.BRONZE_DART, 100), 0);
  f.inv.deleteNumber(I.BRONZE_DART, 40);
  assert.deepEqual(stacksOf(f, I.BRONZE_DART), [60], "control: one stack");

  const g = actor(t);
  put(g, item(I.BRONZE_DART, 30), 0);
  put(g, item(I.BRONZE_DART, 100), 1);
  g.inv.deleteNumber(I.BRONZE_DART, 40);
  assert.deepEqual(stacksOf(g, I.BRONZE_DART), [90]);
  assert.equal(g.inv.getItems()[0].getId(), -1, "the emptied stack clears");
});

test("delete by id on unstackable items still takes them one by one", (t) => {
  const f = actor(t);
  put(f, item(I.RAKE), 0);
  put(f, item(I.RAKE), 1);
  put(f, item(I.RAKE), 2);
  f.inv.deleteNumber(I.RAKE, 2);
  assert.equal(f.inv.getAmount(I.RAKE), 1);
  assert.equal(f.inv.getItems()[2].getId(), I.RAKE, "from the lowest slot up");
});

test("bank: delete by id spans slots of one id, and a lone placeholder behaves as before", (t) => {
  const f = actor(t);
  const bank = f.p.getBank(0);
  bank.setItem(0, item(I.BRONZE_DART, 100));
  bank.deleteNumber(I.BRONZE_DART, 40);
  assert.equal(bank.getAmount(I.BRONZE_DART), 60, "control: one stack");
  bank.resetItems();

  const first = item(I.SERPENTINE_HELM);
  first.setMetaValue("serpentine-helm", 10);
  const second = item(I.SERPENTINE_HELM);
  second.setMetaValue("serpentine-helm", 20);
  bank.setItem(0, first);
  bank.setItem(1, second);
  bank.deleteNumber(I.SERPENTINE_HELM, 2);
  assert.equal(bank.getAmount(I.SERPENTINE_HELM), 0, "both instances");
  bank.resetItems();

  bank.setItem(3, item(I.BRONZE_DART, 0));
  bank.deleteNumber(I.BRONZE_DART, 5);
  assert.equal(bank.getItems()[3].getId(), -1, "a placeholder alone clears, as before");
});

// ------------------------------------------------------------------ bank limits (#2317) on top

test("switchItems to the bank moves what the limit allows and deletes exactly that, across stacks", (t) => {
  const run = (stacks, banked) => {
    const f = actor(t);
    stacks.forEach((amount, slot) => put(f, item(I.BRONZE_DART, amount), slot));
    const bank = f.p.getBank(0);
    bank.setItem(0, item(I.BRONZE_DART, banked));
    f.inv.switchItems(bank, item(I.BRONZE_DART, stacks.at(-1)), false, false);
    return [f.inv.getAmount(I.BRONZE_DART), bank.getAmount(I.BRONZE_DART)];
  };
  assert.deepEqual(run([100], 10), [0, 110], "control: one stack");
  assert.deepEqual(run([100], MAX - 50), [50, MAX], "control: one stack at the limit");
  assert.deepEqual(run([30, 100], 10), [30, 110], "the amount asked, from both stacks");
  assert.deepEqual(run([30, 100], MAX - 50), [80, MAX], "the limit first, then both stacks");
});
