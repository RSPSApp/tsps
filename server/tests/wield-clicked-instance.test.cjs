// Run after `yarn build`: node --test tests/wield-clicked-instance.test.cjs
//
// Wield and Remove move the item the player clicked, keep its metadata and lose nothing.
//
// Wield goes in as the frame the browser client sends for a plain click, through the real decoder
// and ClientConnection.dispatch. client/tests/widget-script-inventory.test.ts asserts the client
// half: a left click on an inventory slot releases one inventory_action with that slot. Remove is
// the decoded IF_BUTTON on the Worn tab. Helms are charged through the real item-on-item route, and
// preset copies come from applyPreset with a custom preset, as "Save" builds one.
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

const HOME = [3222, 3218];
// ClientPacketId.INVENTORY_USE: a const enum, so it has no object at runtime. The decoder checks it.
const INVENTORY_USE_OPCODE = 240;
const MAX = 2147483647;
const WORN_SLOTS = [0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13];
const HELM_CHARGES = "serpentine-helm";
const SKILLS = ["ATTACK", "DEFENCE", "STRENGTH", "RANGED", "PRAYER", "MAGIC"];

let core;
let I;
let next = 4700;

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
  p.setUsername("wieldqa" + p.getIndex());
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
  assert.equal(packets.length, 1);
  assert.equal(packets[0].type, "inventory_action");
  assert.equal(packets[0].slot, slot);
  await f.c.dispatch(packets);
  f.c.processTurnPackets();
}

async function remove(f, wornSlot) {
  const childId = 15 + WORN_SLOTS.indexOf(wornSlot);
  await send(f, { type: "widget_action", widgetId: (387 << 16) | childId, groupId: 387, childId, buttonNum: 1 });
}

const item = (id, amount = 1) => new core.Item(id, amount);

function put(f, value, slot) {
  f.inv.setItem(slot, value);
  return f.inv.getItems()[slot];
}

const wear = (f, slot, value) => f.eq.setItem(slot, value);
const worn = (f, slot) => f.eq.getItems()[slot];

function fill(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(item(I.RAKE), false);
  f.inv.refreshItems();
}

const carried = (f) => [...f.inv.getItems(), ...f.eq.getItems()].filter((held) => held && held.getId() > 0 && held.getAmount() > 0);
const owned = (f) => carried(f).map((held) => `${held.getId()}x${held.getAmount()}`).sort();
const plainOf = (f, id) => carried(f).filter((held) => held.getId() === id && !held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);
const presetOf = (f, id) => carried(f).filter((held) => held.getId() === id && held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);

/** A helm with `scales` charges in `slot`, charged by using scales on it. */
async function chargedHelm(f, slot, scales) {
  put(f, item(I.SERPENTINE_HELM_UNCHARGED_), slot);
  put(f, item(I.ZULRAHS_SCALES, scales), 27);
  await send(f, {
    type: "inventory_use_on", slot: 27, itemId: I.ZULRAHS_SCALES,
    target: { kind: "inventory", slot, itemId: I.SERPENTINE_HELM_UNCHARGED_ },
  });
  const helm = f.inv.getItems()[slot];
  assert.equal(helm.getMetaValue(HELM_CHARGES), scales, "the scales charged it");
  assert.equal(f.inv.getAmount(I.ZULRAHS_SCALES), 0, "the scales were used");
}

const helmCharges = (f) => carried(f).filter((held) => held.getId() === I.SERPENTINE_HELM).map((held) => held.getMetaValue(HELM_CHARGES)).sort((a, b) => a - b);

/** Loads a custom preset: copies of spawnable items are free and marked, on any account. */
function loadCustom(f, inventory, equipment = []) {
  const preset = new Presetable("qa", inventory, equipment, [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, preset);
  const expected = [...inventory, ...equipment];
  for (const entry of expected) assert.ok(presetOf(f, entry.getId()) > 0, `the preset gave marked copies of ${entry.getId()}`);
}

// ------------------------------------------------------------------ the clicked instance

test("Wield takes the clicked charged helm when a copy of the worn helm is held", async (t) => {
  const setup = async (spare) => {
    const f = actor(t);
    wear(f, core.Equipment.HEAD_SLOT, item(I.RUNE_FULL_HELM));
    await chargedHelm(f, 0, 10);
    await chargedHelm(f, 1, 5000);
    if (spare) put(f, item(I.RUNE_FULL_HELM), 2);
    return f;
  };
  const control = await setup(false);
  await click(control, 1);
  assert.deepEqual(helmCharges(control), [10, 5000], "control");

  const f = await setup(true);
  await click(f, 1);
  assert.equal(worn(f, core.Equipment.HEAD_SLOT).getMetaValue(HELM_CHARGES), 5000, "the clicked helm is worn");
  assert.deepEqual(helmCharges(f), [10, 5000], "charges in every helm");
  assert.equal(f.inv.getItems()[0].getMetaValue(HELM_CHARGES), 10, "the earlier helm is untouched");
  assert.equal(f.inv.getItems()[1].getId(), I.RUNE_FULL_HELM, "the worn helm takes the clicked slot");
  assert.equal(f.inv.getAmount(I.RUNE_FULL_HELM), 2);
});

test("Wield takes the clicked helm when it, an earlier one and the worn one share an id", async (t) => {
  const setup = async () => {
    const f = actor(t);
    await chargedHelm(f, 0, 100);
    await click(f, 0);
    assert.equal(worn(f, core.Equipment.HEAD_SLOT).getMetaValue(HELM_CHARGES), 100, "worn first");
    await chargedHelm(f, 0, 10);
    await chargedHelm(f, 1, 5000);
    return f;
  };
  const control = await setup();
  await click(control, 0);
  assert.deepEqual(helmCharges(control), [10, 100, 5000], "control: the first slot was always right");

  const f = await setup();
  await click(f, 1);
  assert.equal(worn(f, core.Equipment.HEAD_SLOT).getMetaValue(HELM_CHARGES), 5000, "the clicked helm is worn");
  assert.deepEqual(helmCharges(f), [10, 100, 5000]);
});

test("Wield a plain whip with a preset whip in an earlier slot: each stays what it was", async (t) => {
  const setup = (spare) => {
    const f = actor(t);
    loadCustom(f, [item(I.ABYSSAL_WHIP)]);
    assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the preset whip is first");
    wear(f, core.Equipment.WEAPON_SLOT, item(I.BRONZE_DAGGER));
    put(f, item(I.ABYSSAL_WHIP), 1);
    if (spare) put(f, item(I.BRONZE_DAGGER), 2);
    return f;
  };
  const control = setup(false);
  await click(control, 1);
  assert.deepEqual([plainOf(control, I.ABYSSAL_WHIP), presetOf(control, I.ABYSSAL_WHIP)], [1, 1], "control");

  const f = setup(true);
  await click(f, 1);
  assert.equal(worn(f, core.Equipment.WEAPON_SLOT).isPresetItem(), false, "the plain whip is wielded");
  assert.deepEqual([plainOf(f, I.ABYSSAL_WHIP), presetOf(f, I.ABYSSAL_WHIP)], [1, 1]);
});

test("Wield with a copy of the worn item held works on a full inventory", async (t) => {
  const run = async (full) => {
    const f = actor(t);
    wear(f, core.Equipment.WEAPON_SLOT, item(I.BRONZE_DAGGER));
    put(f, item(I.ABYSSAL_WHIP), 0);
    put(f, item(I.BRONZE_DAGGER), 1);
    if (full) fill(f);
    const start = owned(f);
    await click(f, 0);
    assert.equal(worn(f, core.Equipment.WEAPON_SLOT).getId(), I.ABYSSAL_WHIP, `full ${full}: wielded`);
    assert.deepEqual(owned(f), start, `full ${full}: nothing lost`);
  };
  await run(false);
  await run(true);
});

// ------------------------------------------------------------------ stacks keep their metadata

test("Wield preset ammo onto worn plain ammo swaps them instead of merging", async (t) => {
  const control = actor(t);
  wear(control, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 1));
  put(control, item(I.DRAGON_ARROW, 100), 0);
  await click(control, 0);
  assert.equal(worn(control, core.Equipment.AMMUNITION_SLOT).getAmount(), 101, "control: plain merges");

  const f = actor(t);
  loadCustom(f, [item(I.DRAGON_ARROW, 100)]);
  wear(f, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 1));
  await click(f, 0);
  assert.equal(worn(f, core.Equipment.AMMUNITION_SLOT).isPresetItem(), true, "the preset stack is worn");
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [1, 100]);
});

test("Wield plain ammo onto worn plain ammo takes the clicked stack, not a preset one before it", async (t) => {
  const control = actor(t);
  wear(control, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 1));
  put(control, item(I.DRAGON_ARROW, 100), 5);
  await click(control, 5);
  assert.equal(plainOf(control, I.DRAGON_ARROW), 101, "control");

  const f = actor(t);
  loadCustom(f, [item(I.DRAGON_ARROW, 175)]);
  assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the preset stack is first");
  wear(f, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 1));
  put(f, item(I.DRAGON_ARROW, 100), 5);
  await click(f, 5);
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [101, 175]);
  assert.equal(f.inv.getItems()[5].getId(), -1, "the clicked stack left");
});

test("Wield preset ammo onto worn preset ammo merges and stays preset", async (t) => {
  const f = actor(t);
  loadCustom(f, [item(I.DRAGON_ARROW, 100)], [item(I.DRAGON_ARROW, 50)]);
  await click(f, 0);
  assert.equal(worn(f, core.Equipment.AMMUNITION_SLOT).getAmount(), 150);
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [0, 150]);
});

test("swapping worn ammo for other ammo joins only a stack with the same metadata", async (t) => {
  const control = actor(t);
  wear(control, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 50));
  put(control, item(I.DRAGON_ARROW, 100), 0);
  put(control, item(I.IRON_ARROW, 10), 1);
  await click(control, 1);
  assert.equal(control.inv.getItems()[0].getAmount(), 150, "control: plain joins plain");
  assert.equal(control.inv.getItems()[1].getId(), -1, "control: the clicked slot empties");

  const f = actor(t);
  loadCustom(f, [], [item(I.DRAGON_ARROW, 50)]);
  put(f, item(I.DRAGON_ARROW, 100), 0);
  put(f, item(I.IRON_ARROW, 10), 1);
  await click(f, 1);
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [100, 50]);
});

test("Remove preset ammo onto a preset stack stays preset, with a free slot or none", async (t) => {
  const control = actor(t);
  loadCustom(control, [], [item(I.DRAGON_ARROW, 50)]);
  await remove(control, core.Equipment.AMMUNITION_SLOT);
  assert.deepEqual([plainOf(control, I.DRAGON_ARROW), presetOf(control, I.DRAGON_ARROW)], [0, 50], "control: no stack held");

  for (const full of [false, true]) {
    const f = actor(t);
    loadCustom(f, [item(I.DRAGON_ARROW, 100)], [item(I.DRAGON_ARROW, 50)]);
    if (full) fill(f);
    await remove(f, core.Equipment.AMMUNITION_SLOT);
    assert.equal(worn(f, core.Equipment.AMMUNITION_SLOT).getId(), -1, `full ${full}: taken off`);
    assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [0, 150], `full ${full}`);
  }
});

test("Remove preset ammo with a plain stack held keeps two stacks", async (t) => {
  const control = actor(t);
  wear(control, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 50));
  put(control, item(I.DRAGON_ARROW, 1), 0);
  await remove(control, core.Equipment.AMMUNITION_SLOT);
  assert.equal(control.inv.getItems()[0].getAmount(), 51, "control: plain joins plain");

  const f = actor(t);
  loadCustom(f, [], [item(I.DRAGON_ARROW, 50)]);
  put(f, item(I.DRAGON_ARROW, 1), 0);
  await remove(f, core.Equipment.AMMUNITION_SLOT);
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [1, 50]);
});

test("Remove plain ammo on a full inventory holding only a preset stack leaves it worn", async (t) => {
  const setup = (full) => {
    const f = actor(t);
    loadCustom(f, [item(I.DRAGON_ARROW, 100)]);
    wear(f, core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 50));
    if (full) fill(f);
    return f;
  };
  const control = setup(false);
  await remove(control, core.Equipment.AMMUNITION_SLOT);
  assert.deepEqual([plainOf(control, I.DRAGON_ARROW), presetOf(control, I.DRAGON_ARROW)], [50, 100], "control: a slot of its own");
  assert.equal(worn(control, core.Equipment.AMMUNITION_SLOT).getId(), -1, "control: taken off");

  const f = setup(true);
  await remove(f, core.Equipment.AMMUNITION_SLOT);
  assert.equal(worn(f, core.Equipment.AMMUNITION_SLOT).getAmount(), 50, "still worn");
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [50, 100]);
});

// ------------------------------------------------------------------ the stack limit

test("Remove onto a stack with no room for the worn ammo leaves it worn", async (t) => {
  const run = async (held) => {
    const f = actor(t);
    wear(f, core.Equipment.AMMUNITION_SLOT, item(I.IRON_ARROW, 100));
    put(f, item(I.IRON_ARROW, held), 0);
    await remove(f, core.Equipment.AMMUNITION_SLOT);
    return [f.inv.getAmount(I.IRON_ARROW), worn(f, core.Equipment.AMMUNITION_SLOT).getAmount()];
  };
  assert.deepEqual(await run(MAX - 100), [MAX, 0], "control: exactly fits");
  assert.deepEqual(await run(MAX - 99), [MAX - 99, 100]);
});

test("swapping worn ammo onto a stack with no room for it changes nothing", async (t) => {
  const run = async (held) => {
    const f = actor(t);
    wear(f, core.Equipment.AMMUNITION_SLOT, item(I.IRON_ARROW, 100));
    put(f, item(I.IRON_ARROW, held), 0);
    put(f, item(I.DRAGON_ARROW, 10), 1);
    await click(f, 1);
    return [f.inv.getAmount(I.IRON_ARROW), f.inv.getAmount(I.DRAGON_ARROW), worn(f, core.Equipment.AMMUNITION_SLOT).getId()];
  };
  assert.deepEqual(await run(MAX - 100), [MAX, 0, I.DRAGON_ARROW], "control: exactly fits");
  assert.deepEqual(await run(MAX - 99), [MAX - 99, 10, I.IRON_ARROW]);
});

test("Wield ammo onto a worn stack with no room for it changes nothing", async (t) => {
  const run = async (wornAmount) => {
    const f = actor(t);
    wear(f, core.Equipment.AMMUNITION_SLOT, item(I.IRON_ARROW, wornAmount));
    put(f, item(I.IRON_ARROW, 100), 0);
    await click(f, 0);
    return [worn(f, core.Equipment.AMMUNITION_SLOT).getAmount(), f.inv.getAmount(I.IRON_ARROW)];
  };
  assert.deepEqual(await run(MAX - 100), [MAX, 0], "control: exactly fits");
  assert.deepEqual(await run(MAX - 99), [MAX - 99, 100]);
});
