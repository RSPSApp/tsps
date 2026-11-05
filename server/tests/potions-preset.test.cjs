// Run after `yarn build`: node --test tests/potions-preset.test.cjs
//
// Pouring, dividing and emptying potions keep the preset marks of the vessels they pour. Drinking and the
// Lunar share spells already carry an item's metadata (Potions.plugin.js passes item.getMeta()); pouring
// and Empty built plain `new Item(id, 1)` instead, so a preset (untradeable, unbankable) potion became
// plain doses and a plain vial. Pouring preset into plain, or a plain potion into a preset vial, is
// refused ("Preset items cannot be used for this.", the wording of #2255 and #2259; ours, not captured),
// because either way one vessel's restriction would be lost or another's invented.
// Native fixture: clicks go through ClientConnection.dispatch as decoded packets, preset copies come from
// the real applyPreset (the global Dharok preset after its quests, or a custom preset as Save builds one).
// A preset vial is marked by hand: no preset supplies one.
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
const BREWS = () => [I.SARADOMIN_BREW_1_, I.SARADOMIN_BREW_2_, I.SARADOMIN_BREW_3_, I.SARADOMIN_BREW_4_];
const dosesOf = (id) => BREWS().indexOf(id) + 1;
const doseTotal = (f, wantRestricted) => carried(f)
  .filter((held) => BREWS().includes(held.getId()) && restricted(held) === wantRestricted)
  .reduce((sum, held) => sum + dosesOf(held.getId()), 0);
const brewSlots = (f) => f.inv.getItems().flatMap((held, slot) => (BREWS().includes(held.getId()) ? [slot] : []));

function presetVial() {
  return item(I.VIAL).setMetaValue(core.Item.PRESET_META, true);
}

test("control: plain potions pour as before", async (t) => {
  const f = actor(t);
  put(f, item(I.SARADOMIN_BREW_3_), 0);
  put(f, item(I.SARADOMIN_BREW_3_), 1);
  await useOn(f, 0, 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_4_), 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_2_), 1);
  assert.equal(f.messages.includes(REFUSAL), false);
});

test("pouring a preset potion into a preset one keeps every dose preset", async (t) => {
  const f = actor(t);
  customPreset(f, [item(I.SARADOMIN_BREW_3_), item(I.SARADOMIN_BREW_3_)]);
  await useOn(f, 0, 1);
  assert.equal(presetOf(f, I.SARADOMIN_BREW_4_), 1, "the full potion is preset");
  assert.equal(presetOf(f, I.SARADOMIN_BREW_2_), 1, "and so is the remainder");
  assert.equal(doseTotal(f, false), 0, "no plain doses appear");
  assert.equal(doseTotal(f, true), 6, "and none were lost");
});

test("from a global preset: sipping then pouring Main Hybrid's brews keeps every dose preset, exactly", async (t) => {
  const f = actor(t);
  // Dharok carries one brew; Main Hybrid is a global preset with two Saradomin brew (4)s.
  globalPreset(f, "Main Hybrid");
  const slots = brewSlots(f);
  assert.equal(slots.length, 2, "the global Main Hybrid preset carries two Saradomin brews");
  const [a, b] = slots;
  assert.deepEqual([a, b].map((slot) => f.inv.getItems()[slot].getId()), [I.SARADOMIN_BREW_4_, I.SARADOMIN_BREW_4_]);
  for (const slot of [a, a, b]) {
    await browserOp(f, slot, "Drink");
    // The drink delay (a 3 tick POTION timer) runs in the player's own processing, which this fixture
    // doesn't run: TaskManager ticks leave it set and the next sip is silently ignored.
    for (let i = 0; i < 3; i++) f.p.getTimers().process();
    assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false, "the drink delay has run out");
  }
  const sipped = [a, b].map((slot) => f.inv.getItems()[slot]);
  assert.deepEqual(sipped.map((held) => held.getId()), [I.SARADOMIN_BREW_2_, I.SARADOMIN_BREW_3_], "two sips from one, one from the other");
  assert.ok(sipped.every(restricted), "sipping keeps the marks");
  await useOn(f, a, b);
  const poured = [a, b].map((slot) => f.inv.getItems()[slot]);
  assert.deepEqual(poured.map((held) => held.getId()), [I.SARADOMIN_BREW_1_, I.SARADOMIN_BREW_4_], "one dose moved: (2)+(3) -> (1)+(4)");
  assert.ok(poured.every(restricted), "both vessels are still preset");
  assert.equal(doseTotal(f, false), 0, "no plain doses appeared");
  assert.equal(doseTotal(f, true), 5, "and none were lost");
});

test("pouring a preset potion into a plain one is refused and changes nothing", async (t) => {
  const f = actor(t);
  customPreset(f, [item(I.SARADOMIN_BREW_3_)]);
  put(f, item(I.SARADOMIN_BREW_1_), 1);
  await useOn(f, 0, 1);
  assert.equal(presetOf(f, I.SARADOMIN_BREW_3_), 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_1_), 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_4_), 0, "no free plain (4)");
  assert.ok(f.messages.includes(REFUSAL));
});

test("pouring a plain potion into a preset one is refused and changes nothing", async (t) => {
  const f = actor(t);
  customPreset(f, [item(I.SARADOMIN_BREW_3_)]);
  put(f, item(I.SARADOMIN_BREW_1_), 1);
  await useOn(f, 1, 0);
  assert.equal(presetOf(f, I.SARADOMIN_BREW_3_), 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_1_), 1);
  assert.equal(presetOf(f, I.SARADOMIN_BREW_4_), 0, "the preset potion was not topped up with plain doses");
  assert.ok(f.messages.includes(REFUSAL));
});

test("control: a plain potion divides into a vial as before", async (t) => {
  const f = actor(t);
  put(f, item(I.SARADOMIN_BREW_4_), 0);
  put(f, item(I.VIAL), 1);
  await useOn(f, 0, 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_2_), 2);
});

test("dividing a preset potion into a plain vial gives two preset halves", async (t) => {
  const f = actor(t);
  customPreset(f, [item(I.SARADOMIN_BREW_4_)]);
  put(f, item(I.VIAL), 1);
  await useOn(f, 0, 1);
  assert.equal(presetOf(f, I.SARADOMIN_BREW_2_), 2, "both halves keep the preset marks");
  assert.equal(plainOf(f, I.SARADOMIN_BREW_2_), 0);
});

test("dividing a plain potion into a preset vial is refused: the vial's marks would vanish", async (t) => {
  const f = actor(t);
  put(f, item(I.SARADOMIN_BREW_4_), 0);
  put(f, presetVial(), 1);
  await useOn(f, 0, 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_4_), 1);
  assert.equal(presetOf(f, I.VIAL), 1);
  assert.equal(plainOf(f, I.SARADOMIN_BREW_2_), 0);
  assert.ok(f.messages.includes(REFUSAL));
});

test("control: emptying a plain potion gives a plain vial", async (t) => {
  const f = actor(t);
  put(f, item(I.SARADOMIN_BREW_4_), 0);
  await heldOp(f, 0, "Empty");
  assert.equal(plainOf(f, I.VIAL), 1);
});

test("emptying a preset potion gives a preset vial, not a plain one", async (t) => {
  const f = actor(t);
  customPreset(f, [item(I.SARADOMIN_BREW_4_)]);
  await heldOp(f, 0, "Empty");
  assert.equal(presetOf(f, I.VIAL), 1);
  assert.equal(plainOf(f, I.VIAL), 0);
});

test("from a global preset: emptying one of Dharok's brews gives a preset vial", async (t) => {
  const f = actor(t);
  globalPreset(f, "Dharok");
  const [slot] = brewSlots(f);
  assert.ok(slot >= 0, "the global preset carries a brew");
  await heldOp(f, slot, "Empty");
  assert.equal(presetOf(f, I.VIAL), 1);
  assert.equal(plainOf(f, I.VIAL), 0);
});
