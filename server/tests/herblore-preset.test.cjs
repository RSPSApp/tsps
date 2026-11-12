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
require("./helpers/pvp-mode-on.cjs");
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

test("a knife grinds an ordinary chocolate bar into dust", async (t) => {
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  const INVENTORY_USE_ON = 241; // ClientPackets.INVENTORY_USE_ON; high-level decoded input.
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "the Herblore plugin is enabled in the members world");
  for (const [id, expected, name] of [
    [I.PESTLE_AND_MORTAR, 233, "Pestle and mortar"], [I.KNIFE, 946, "Knife"],
    [I.CHOCOLATE_BAR, 1973, "Chocolate bar"], [I.CHOCOLATE_DUST, 1975, "Chocolate dust"],
  ]) {
    assert.equal(id, expected);
    const definition = new core.Item(id, 1).getDefinition();
    assert.equal(definition.getName(), name, "the active cache resolves the ordinary item");
    assert.equal(definition.isNoted(), false);
    assert.equal(definition.isStackable(), false);
    assert.equal(definition.isTradeable(), true);
  }
  const observed = [], emit = PM.emitItemOnItem;
  t.mock.method(PM, "emitItemOnItem", (event) => {
    const parsed = { player: event.player, used: event.usedItem, target: event.usedWithItem,
      usedId: event.usedItemId, targetId: event.usedWithItemId,
      usedSlot: event.usedItemSlot, targetSlot: event.usedWithItemSlot };
    const result = emit.call(PM, event);
    observed.push({ ...parsed, handled: event.handled, result });
    return result;
  });
  function ordinaryActor(index, username) {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), p = new Player(session);
    session.setPlayer(p);
    p.setIndex(index); p.setUsername(username); p.setRegistered(true);
    p.setLocation(new core.Location(HOME[0], HOME[1], 0)); p.needsPlacement = false;
    assert.ok(p.getHitpoints() > 0, "a living ordinary player");
    assert.equal(p.getCombat().isAnimationStalled(), false, "no action stall");
    const c = new ClientConnection(channel); c.player = p;
    t.after(() => {
      PM.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      PM.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex());
    });
    return { p, c, inv: p.getInventory(), skills: p.getSkillManager() };
  }
  async function useActual(f, usedSlot, targetSlot) {
    const used = f.inv.getItems()[usedSlot], target = f.inv.getItems()[targetSlot];
    assert.ok(used && target && usedSlot !== targetSlot);
    const usedId = used.getId(), targetId = target.getId();
    const body = Buffer.alloc(13); // ClientBinaryEncoder.encodeInventoryUseOn: big-endian short fields.
    body.writeUInt16BE(usedSlot, 0); body.writeUInt16BE(usedId, 2);
    body[4] = 4; // inventory target; id and has-tile at 5..7 and plane at 8 remain zero.
    body.writeUInt16BE(targetSlot, 9); body.writeUInt16BE(targetId, 11);
    const packets = decodeClientPackets(Buffer.concat([Buffer.from([INVENTORY_USE_ON, body.length]), body]));
    assert.deepEqual(packets, [{ type: "inventory_use_on", slot: usedSlot, itemId: usedId,
      target: { kind: "inventory", slot: targetSlot, itemId: targetId } }], "the actual protocol reader resolves both current slots");
    const at = observed.length;
    await f.c.dispatch(packets);
    f.c.processTurnPackets();
    assert.equal(observed.length, at + 1, "the decoded use reaches the original item-on-item dispatcher");
    const got = observed[at];
    assert.equal(got.player, f.p); assert.equal(got.used, used); assert.equal(got.target, target);
    assert.deepEqual([got.usedId, got.targetId, got.usedSlot, got.targetSlot], [usedId, targetId, usedSlot, targetSlot],
      "the dispatcher receives the selected native item references and slots");
    return got;
  }
  function setup(index, username, toolId) {
    const f = ordinaryActor(index, username);
    f.inv.add(new core.Item(toolId, 1), false);
    f.inv.add(new core.Item(I.CHOCOLATE_BAR, 1), false);
    assert.equal(f.inv.getAmount(toolId), 1);
    assert.equal(f.inv.getAmount(I.CHOCOLATE_BAR), 1);
    assert.equal(f.inv.getAmount(I.CHOCOLATE_DUST), 0);
    for (const id of [toolId, I.CHOCOLATE_BAR]) {
      const slot = f.inv.getSlotForItemId(id), held = f.inv.getItems()[slot];
      assert.ok(slot >= 0 && held.getId() === id && held.getAmount() === 1);
      assert.equal(held.isPresetItem(), false); assert.equal(held.isUntradeable(), false);
      assert.equal(held.isUnbankable(), false); assert.equal(held.isTradeable(), true);
      assert.equal(held.getMeta(), null);
    }
    assert.ok(f.inv.getAddableAmount(new core.Item(I.CHOCOLATE_DUST, 1)) >= 1, "one dust fits");
    return f;
  }
  const xp = (f) => core.Skill.values().map((skill) => f.skills.getExperience(skill));
  const control = setup(6720, "pestlectl", I.PESTLE_AND_MORTAR);
  assert.equal(control.inv.getAmount(I.KNIFE), 0);
  const controlToolSlot = control.inv.getSlotForItemId(I.PESTLE_AND_MORTAR);
  const controlTool = control.inv.getItems()[controlToolSlot], controlXp = xp(control);
  const controlEvent = await useActual(control, controlToolSlot, control.inv.getSlotForItemId(I.CHOCOLATE_BAR));
  assert.equal(controlEvent.handled, true, "the real pestle consumer admits the control");
  assert.deepEqual([control.inv.getAmount(I.CHOCOLATE_BAR), control.inv.getAmount(I.CHOCOLATE_DUST)], [0, 1],
    "the pestle control converts the bar");
  assert.equal(control.inv.getItems()[controlToolSlot], controlTool, "the pestle is retained");
  assert.equal(control.inv.getAmount(I.PESTLE_AND_MORTAR), 1);
  assert.deepEqual(xp(control), controlXp, "the pestle control awards no skill XP");

  for (const [index, username, reverse] of [[6721, "knifefwd", false], [6722, "kniferev", true]]) {
    const f = setup(index, username, I.KNIFE);
    assert.equal(f.inv.getAmount(I.PESTLE_AND_MORTAR), 0, "the knife case carries no pestle");
    const knifeSlot = f.inv.getSlotForItemId(I.KNIFE), barSlot = f.inv.getSlotForItemId(I.CHOCOLATE_BAR);
    const knife = f.inv.getItems()[knifeSlot], beforeXp = xp(f);
    await useActual(f, reverse ? barSlot : knifeSlot, reverse ? knifeSlot : barSlot);
    assert.deepEqual([f.inv.getAmount(I.CHOCOLATE_BAR), f.inv.getAmount(I.CHOCOLATE_DUST)], [0, 1],
      "one ordinary chocolate bar becomes chocolate dust with a knife");
    assert.equal(f.inv.getItems()[knifeSlot], knife, "the selected knife is retained");
    assert.equal(f.inv.getAmount(I.KNIFE), 1);
    assert.equal(knife.getMeta(), null, "the retained knife remains plain");
    assert.deepEqual(xp(f), beforeXp, "knife grinding awards no skill XP");
  }
  const other = ordinaryActor(6723, "knifehorn");
  other.inv.add(new core.Item(I.KNIFE, 1), false);
  other.inv.add(new core.Item(I.UNICORN_HORN, 1), false);
  const otherKnifeSlot = other.inv.getSlotForItemId(I.KNIFE), hornSlot = other.inv.getSlotForItemId(I.UNICORN_HORN);
  const otherKnife = other.inv.getItems()[otherKnifeSlot], otherXp = xp(other);
  assert.ok(otherKnifeSlot >= 0 && hornSlot >= 0);
  assert.equal(other.inv.getAmount(I.PESTLE_AND_MORTAR), 0);
  assert.equal(other.inv.getAmount(I.UNICORN_HORN_DUST), 0);
  await useActual(other, otherKnifeSlot, hornSlot);
  assert.deepEqual([other.inv.getAmount(I.UNICORN_HORN), other.inv.getAmount(I.UNICORN_HORN_DUST)], [1, 0],
    "a knife does not gain unrelated pestle recipes");
  assert.equal(other.inv.getItems()[otherKnifeSlot], otherKnife);
  assert.deepEqual(xp(other), otherXp);
});

// Grinding: a pestle (or a knife on a chocolate bar) turned a preset copy into a plain, tradeable
// dust with no message. It is refused like a mix, and a plain copy next to it is still ground.
// A grindable is not a spawnable preset item, so the copy is tagged by hand with the three marks
// spawnPresetItem sets (untradeable, unbankable, preset).
function presetCopy(id) {
  return item(id)
    .setMetaValue(core.Item.UNTRADEABLE_META, true)
    .setMetaValue(core.Item.UNBANKABLE_META, true)
    .setMetaValue(core.Item.PRESET_META, true);
}

async function grindWith(f, toolId, targetId) {
  await useOn(f, slotOfId(f, toolId), slotOfId(f, targetId));
  ticks(10);
}

for (const [tool, toolName] of [[() => I.KNIFE, "a knife"], [() => I.PESTLE_AND_MORTAR, "a pestle and mortar"]]) {
  test(`a preset chocolate bar is refused with ${toolName}: nothing consumed, no dust`, async (t) => {
    const f = actor(t);
    f.inv.add(presetCopy(I.CHOCOLATE_BAR), false);
    f.inv.add(item(tool()), false);
    await grindWith(f, tool(), I.CHOCOLATE_BAR);
    assert.equal(presetOf(f, I.CHOCOLATE_BAR), 1, "the preset bar is kept");
    assert.equal(plainOf(f, I.CHOCOLATE_DUST) + presetOf(f, I.CHOCOLATE_DUST), 0, "no dust");
    assert.equal(f.inv.getAmount(tool()), 1);
    assert.ok(f.messages.includes(REFUSAL));
  });

  test(`a plain chocolate bar is still ground with ${toolName}`, async (t) => {
    const f = actor(t);
    f.inv.add(item(I.CHOCOLATE_BAR), false);
    f.inv.add(item(tool()), false);
    await grindWith(f, tool(), I.CHOCOLATE_BAR);
    assert.equal(plainOf(f, I.CHOCOLATE_DUST), 1);
    assert.equal(f.inv.getAmount(I.CHOCOLATE_BAR), 0);
    assert.equal(f.messages.includes(REFUSAL), false);
  });

  test(`a preset and a plain chocolate bar with ${toolName}: only the plain one is ground`, async (t) => {
    const f = actor(t);
    f.inv.add(presetCopy(I.CHOCOLATE_BAR), false);
    f.inv.add(item(I.CHOCOLATE_BAR), false);
    f.inv.add(item(tool()), false);
    await grindWith(f, tool(), I.CHOCOLATE_BAR);
    assert.equal(plainOf(f, I.CHOCOLATE_DUST), 1, "the plain bar became dust");
    assert.equal(presetOf(f, I.CHOCOLATE_BAR), 1, "the preset bar stays preset");
    assert.equal(plainOf(f, I.CHOCOLATE_BAR), 0);
    assert.equal(presetOf(f, I.CHOCOLATE_DUST), 0);
  });
}

test("a preset unicorn horn is refused with a pestle and mortar", async (t) => {
  const f = actor(t);
  f.inv.add(presetCopy(I.UNICORN_HORN), false);
  f.inv.add(item(I.PESTLE_AND_MORTAR), false);
  await grindWith(f, I.PESTLE_AND_MORTAR, I.UNICORN_HORN);
  assert.equal(presetOf(f, I.UNICORN_HORN), 1, "the preset horn is kept");
  assert.equal(f.inv.getAmount(I.UNICORN_HORN_DUST), 0, "no dust");
  assert.ok(f.messages.includes(REFUSAL));
});

test("a plain unicorn horn is still ground with a pestle and mortar", async (t) => {
  const f = actor(t);
  f.inv.add(item(I.UNICORN_HORN), false);
  f.inv.add(item(I.PESTLE_AND_MORTAR), false);
  await grindWith(f, I.PESTLE_AND_MORTAR, I.UNICORN_HORN);
  assert.equal(plainOf(f, I.UNICORN_HORN_DUST), 1);
  assert.equal(f.inv.getAmount(I.UNICORN_HORN), 0);
});
