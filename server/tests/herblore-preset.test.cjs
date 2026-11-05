// Run after `yarn build`: node --test tests/herblore-preset.test.cjs
//
// Herblore mixes by item id: a preset (untradeable, unbankable) potion went into a mix and a plain,
// tradeable product came out. Like #2255 (Cerberus boots) and #2259 (Avernic defender) the fix refuses
// restricted ingredients ("Preset items cannot be used for this.": the wording of those PRs, ours, not
// captured) and consumes the unrestricted copies by slot. Unlike pouring a potion, a mix makes a different
// item, so carrying the marks onto it would invent a preset product no preset supplies.
// Native fixture: clicks go through ClientConnection.dispatch as decoded packets, preset copies come from
// the real applyPreset (a custom preset as Save builds one); a preset herb is marked by hand.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const QuestEquipment = require("../plugins/quests/data/quest-equipment.json");

const HOME = [3222, 3218];
const MAX = 2147483647;
const WORN_SLOTS = [0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13];
const SKILLS = ["ATTACK", "DEFENCE", "STRENGTH", "RANGED", "PRAYER", "MAGIC", "HERBLORE", "FLETCHING", "CRAFTING"];

let core;
let I;
let next = 6700;

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
  p.setUsername("potqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const name of SKILLS) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), eq: p.getEquipment(), messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

async function useOn(f, slot, targetSlot) {
  await send(f, {
    type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
    target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
  });
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

const browserOp = (f, slot, option) => send(f, { type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option });

async function takeOff(f, wornSlot) {
  const childId = 15 + WORN_SLOTS.indexOf(wornSlot);
  await send(f, { type: "widget_action", widgetId: (387 << 16) | childId, groupId: 387, childId, buttonNum: 1 });
}

const button = (f, groupId, childId, slot, buttonNum = 1) => send(f, { type: "widget_action", widgetId: (groupId << 16) | childId, groupId, childId, buttonNum, slot });

const item = (id, amount = 1) => new core.Item(id, amount);

function put(f, value, slot) {
  f.inv.setItem(slot, value);
  return f.inv.getItems()[slot];
}

function fill(f, free = 0) {
  while (f.inv.getFreeSlots() > free) f.inv.add(item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), free);
}

const carried = (f) => [...f.inv.getItems(), ...f.eq.getItems()].filter((held) => held && held.getId() > 0 && held.getAmount() > 0);
const restricted = (held) => held.isPresetItem() || held.isUntradeable() || held.isUnbankable();
const plainOf = (f, id) => carried(f).filter((held) => held.getId() === id && !restricted(held)).reduce((sum, held) => sum + held.getAmount(), 0);
const presetOf = (f, id) => carried(f).filter((held) => held.getId() === id && restricted(held)).reduce((sum, held) => sum + held.getAmount(), 0);
const owned = (f) => carried(f).map((held) => `${held.getId()}x${held.getAmount()}`).sort();

function customPreset(f, inventory) {
  Presets.applyPreset(f.p, new Presetable("qa", inventory, [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false));
  for (const entry of inventory) assert.ok(presetOf(f, entry.getId()) > 0, `marked copies of ${entry.getId()}`);
}

function globalPreset(f, name) {
  const preset = Presets.getGlobalPresetByName(name);
  const ids = new Set([...preset.getInventory(), ...preset.getEquipment()].map((entry) => entry.getId()));
  const quests = QuestEquipment.quests.filter((entry) => entry.items.some((key) => ids.has(I[key]))).map((entry) => entry.quest);
  for (const quest of QuestRuntime.getRegisteredQuests().filter((entry) => quests.includes(entry.name))) {
    quest.complete(f.p, { experience: false });
  }
  Presets.applyPreset(f.p, preset);
  assert.ok(carried(f).some(restricted), `${name} loaded`);
}

function completeQuest(f, key) {
  QuestRuntime.getRegisteredQuests().find((quest) => quest.key === key).complete(f.p, { experience: false });
}

const slotOfId = (f, id) => f.inv.getItems().findIndex((held) => held.getId() === id);


// ------------------------------------------------------------------ the tests

const REFUSAL = "Preset items cannot be used for this.";
const COMBAT_INPUTS = () => [I.SUPER_ATTACK_4_, I.SUPER_DEFENCE_4_, I.SUPER_STRENGTH_4_];

function presetHerb(id) {
  return item(id).setMetaValue(core.Item.PRESET_META, true);
}

/** The three super potions then the torstol in the inventory, ready to mix. */
function mixSetup(f, { presetPotions = false, presetHerbItem = false, plainToo = false } = {}) {
  completeQuest(f, "druidic_ritual");
  if (presetPotions) customPreset(f, COMBAT_INPUTS().map((id) => item(id)));
  if (plainToo || !presetPotions) COMBAT_INPUTS().forEach((id) => f.inv.add(item(id), false));
  f.inv.add(presetHerbItem ? presetHerb(I.TORSTOL) : item(I.TORSTOL), false);
}

async function mix(f) {
  const torstol = f.inv.getItems().findIndex((held) => held.getId() === I.TORSTOL);
  assert.ok(torstol >= 0, "a torstol to mix with");
  await useOn(f, torstol, slotOfId(f, I.SUPER_ATTACK_4_));
  ticks(10);
}

test("control: plain super potions and a torstol make a super combat potion", async (t) => {
  const f = actor(t);
  mixSetup(f);
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 1);
  assert.equal(plainOf(f, I.TORSTOL), 0);
  assert.equal(f.messages.includes(REFUSAL), false);
});

test("preset super potions are refused: no plain super combat, nothing consumed", async (t) => {
  const f = actor(t);
  mixSetup(f, { presetPotions: true });
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 0, "no plain product");
  assert.equal(presetOf(f, I.SUPER_COMBAT_POTION_4_), 0, "and no invented preset product");
  for (const id of COMBAT_INPUTS()) assert.equal(presetOf(f, id), 1, `the preset potion ${id} is still there`);
  assert.equal(plainOf(f, I.TORSTOL), 1, "the herb is kept");
  assert.ok(f.messages.includes(REFUSAL));
});

test("a preset herb is refused too, and kept", async (t) => {
  const f = actor(t);
  mixSetup(f, { presetHerbItem: true });
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 0);
  assert.equal(presetOf(f, I.TORSTOL), 1);
  for (const id of COMBAT_INPUTS()) assert.equal(plainOf(f, id), 1, `the plain potion ${id} is kept`);
  assert.ok(f.messages.includes(REFUSAL));
});

test("preset and plain potions together: the plain ones are used and the preset ones stay preset", async (t) => {
  const f = actor(t);
  mixSetup(f, { presetPotions: true, plainToo: true });
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 1, "made from the plain potions");
  for (const id of COMBAT_INPUTS()) {
    assert.equal(presetOf(f, id), 1, `the preset potion ${id} is untouched`);
    assert.equal(plainOf(f, id), 0, `the plain potion ${id} was used`);
  }
  assert.equal(plainOf(f, I.TORSTOL), 0);
});

test("only the unrestricted set counts toward a make: one plain set and one preset set make one", async (t) => {
  const f = actor(t);
  completeQuest(f, "druidic_ritual");
  customPreset(f, COMBAT_INPUTS().map((id) => item(id)));
  COMBAT_INPUTS().forEach((id) => f.inv.add(item(id), false));
  f.inv.add(item(I.TORSTOL, 1), false);
  f.inv.add(item(I.TORSTOL, 1), false);
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 1, "one made, not two");
  for (const id of COMBAT_INPUTS()) assert.equal(presetOf(f, id), 1, `the preset potion ${id} is untouched`);
  assert.equal(plainOf(f, I.TORSTOL), 1, "the second torstol is left");
});

// A herblore:mix listener may change what a mix takes (the league relics keep or cut secondaries). The
// unrestricted copies must still cover what it asks for, or the mix makes nothing and takes nothing.
let raiseTorstol = false;
before(() => {
  PM.createApi("HerbloreRecheckTest").onCustomEvent("herblore:mix", (mixing) => {
    if (!raiseTorstol) return;
    mixing.consume.find((entry) => entry.id === I.TORSTOL).count = 2;
  });
});

test("a listener that raises what is taken is re-checked: two torstol are taken when two plain ones are there", async (t) => {
  raiseTorstol = true;
  t.after(() => { raiseTorstol = false; });
  const f = actor(t);
  mixSetup(f);
  f.inv.add(item(I.TORSTOL), false);
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 1, "control: the listener's amount is real, and met");
  assert.equal(plainOf(f, I.TORSTOL), 0, "both torstol went");
});

test("a listener that raises what is taken beyond the plain copies: nothing is made or taken", async (t) => {
  raiseTorstol = true;
  t.after(() => { raiseTorstol = false; });
  const f = actor(t);
  mixSetup(f);
  f.inv.add(presetHerb(I.TORSTOL), false);
  await mix(f);
  assert.equal(plainOf(f, I.SUPER_COMBAT_POTION_4_), 0, "no product");
  assert.equal(plainOf(f, I.TORSTOL), 1, "the plain torstol is kept");
  assert.equal(presetOf(f, I.TORSTOL), 1, "and the preset one");
  for (const id of COMBAT_INPUTS()) assert.equal(plainOf(f, id), 1, `the potion ${id} is kept`);
});
