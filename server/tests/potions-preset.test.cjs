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
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
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




// Use the registered player and decoded action seam above for divine eligibility and maintenance.
function divineActor(t, hitpoints) {
  const f = actor(t);
  const skills = f.p.getSkillManager();
  const xp = core.SkillManager.getExperienceForLevel(99);
  for (const name of [...SKILLS, "HITPOINTS"]) {
    const skill = core.Skill[name];
    skills.setExperience(skill, xp);
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, name === "HITPOINTS" ? hitpoints : 99, false);
    assert.equal(skills.getExperience(skill), xp);
    assert.equal(skills.getMaxLevel(skill), 99);
    assert.equal(skills.getCurrentLevel(skill), name === "HITPOINTS" ? hitpoints : 99);
  }
  assert.equal(f.p.isPlayerBot(), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.STUN), false);
  return f;
}
function giveDrink(f, slot, id) {
  assert.equal(core.CacheDefinitions.getItem(id).inventoryActions[0], "Drink");
  assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
  const held = put(f, item(id), slot);
  assert.equal(held.getAmount(), 1);
  assert.equal(held.getMeta(), null);
}
function advancePotionTimer(f) {
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  for (let tick = 0; tick < 3; tick++) f.p.getTimers().process();
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
}

for (const hp of [1, 10]) {
  test(`divine super attack requires more than ${hp} Hitpoints`, async t => {
    const f = divineActor(t, hp);
    giveDrink(f, 0, I.DIVINE_SUPER_ATTACK_POTION_4_);
    assert.equal(f.inv.getItems()[0].getId(), 23697);
    assert.equal(f.p.getHitpoints(), hp);
    await browserOp(f, 0, "Drink");
    assert.equal(f.inv.getItems()[0].getId(), 23697, "the full dose remains when HP is too low");
    assert.equal(f.inv.getItems()[0].getAmount(), 1);
    assert.equal(f.p.getHitpoints(), hp);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 99);
    assert.equal(f.p.getAttribute("potions:divine:state") ?? null, null);
    assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
    assert.ok(f.messages.includes("You need more than 10 hitpoints to survive the power of a divine potion."));
  });
}

for (const [hp, after] of [[11, 1], [99, 89]]) {
  test(`divine super attack pays ten Hitpoints from ${hp}`, async t => {
    const f = divineActor(t, hp);
    giveDrink(f, 0, I.DIVINE_SUPER_ATTACK_POTION_4_);
    await browserOp(f, 0, "Drink");
    assert.equal(f.inv.getItems()[0].getId(), 23700);
    assert.equal(f.p.getHitpoints(), after);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
    assert.ok(f.p.getAttribute("potions:divine:state").endsAt > Date.now());
    assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  });
}

test("a non-divine super attack remains drinkable at ten Hitpoints", async t => {
  const f = divineActor(t, 10);
  giveDrink(f, 0, I.SUPER_ATTACK_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), I.SUPER_ATTACK_3_);
  assert.equal(f.p.getHitpoints(), 10);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
});

test("the existing potion cooldown still blocks a divine drink", async t => {
  const f = divineActor(t, 99);
  giveDrink(f, 0, I.SUPER_ATTACK_4_);
  giveDrink(f, 1, I.DIVINE_SUPER_ATTACK_POTION_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), I.SUPER_ATTACK_3_);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  await browserOp(f, 1, "Drink");
  assert.equal(f.inv.getItems()[1].getId(), 23697);
  assert.equal(f.p.getHitpoints(), 99);
  assert.equal(f.p.getAttribute("potions:divine:state") ?? null, null);
});

test("an active stun still blocks a divine drink", async t => {
  const f = divineActor(t, 11);
  giveDrink(f, 0, I.DIVINE_SUPER_ATTACK_POTION_4_);
  f.p.getTimers().extendOrRegister(core.TimerKey.STUN, 3);
  assert.equal(f.p.getTimers().has(core.TimerKey.STUN), true);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), 23697);
  assert.equal(f.p.getHitpoints(), 11);
  assert.equal(f.p.getAttribute("potions:divine:state") ?? null, null);
});

async function boostThenBrew(f, divine) {
  const id = divine ? I.DIVINE_SUPER_ATTACK_POTION_4_ : I.SUPER_ATTACK_4_;
  giveDrink(f, 0, id);
  giveDrink(f, 1, I.SARADOMIN_BREW_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), divine ? 23700 : I.SUPER_ATTACK_3_);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  if (divine) assert.equal(f.p.getHitpoints(), 89);
  advancePotionTimer(f);
  await browserOp(f, 1, "Drink");
  assert.equal(f.inv.getItems()[1].getId(), I.SARADOMIN_BREW_3_);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
  if (divine) {
    const target = f.p.getAttribute("potions:divine:state").targets.find(entry => entry.skillIndex === core.Skill.ATTACK.getIndex());
    assert.equal(target.target, 105, "the actual drain updates the maintained level before the next phase");
  }
}

test("divine maintenance preserves the actual Saradomin brew drain", async t => {
  const f = divineActor(t, 99);
  await boostThenBrew(f, true);
  const state = f.p.getAttribute("potions:divine:state");
  assert.ok(state.endsAt > Date.now());
  const expiry = state.endsAt;
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
  // This is the registered plugin-processing phase, not a complete World tick.
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105,
    "the divine potion maintains the deliberately lowered boost");
  assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
});

test("ordinary super attack and brew retain the same drain", async t => {
  const f = divineActor(t, 99);
  await boostThenBrew(f, false);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
});

test("an ordinary reboost does not extend the divine expiry", async t => {
  const f = divineActor(t, 99);
  await boostThenBrew(f, true);
  const expiry = f.p.getAttribute("potions:divine:state").endsAt;
  advancePotionTimer(f);
  giveDrink(f, 2, I.SUPER_ATTACK_4_);
  await browserOp(f, 2, "Drink");
  assert.equal(f.inv.getItems()[2].getId(), I.SUPER_ATTACK_3_);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
});


for (const [name, drink, next] of [
  ["restore", () => I.RESTORE_POTION_4_, () => I.RESTORE_POTION_3_],
  ["Sanfew", () => I.SANFEW_SERUM_4_, () => I.SANFEW_SERUM_3_],
]) {
  test(`${name} does not restore a deliberately lowered divine boost`, async t => {
    const f = divineActor(t, 99);
    await boostThenBrew(f, true);
    const expiry = f.p.getAttribute("potions:divine:state").endsAt;
    advancePotionTimer(f);
    giveDrink(f, 2, drink());
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
    await browserOp(f, 2, "Drink");
    assert.equal(f.inv.getItems()[2].getId(), next());
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
    PM.emitPlayerProcess({ player: f.p });
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
    assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
  });
}


test("a later ordinary boost raises a maintained divine level without extending it", async t => {
  const f = divineActor(t, 99);
  await boostThenBrew(f, true);
  const expiry = f.p.getAttribute("potions:divine:state").endsAt;
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
  advancePotionTimer(f);
  giveDrink(f, 2, I.SUPER_ATTACK_4_);
  await browserOp(f, 2, "Drink");
  assert.equal(f.inv.getItems()[2].getId(), I.SUPER_ATTACK_3_);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
});

for (const [name, drink, next] of [
  ["restore", () => I.RESTORE_POTION_4_, () => I.RESTORE_POTION_3_],
  ["super restore", () => I.SUPER_RESTORE_4_, () => I.SUPER_RESTORE_3_],
  ["Sanfew", () => I.SANFEW_SERUM_4_, () => I.SANFEW_SERUM_3_],
]) {
  test(`${name} restores a divine level drained below base`, async t => {
    const f = divineActor(t, 99);
    await boostThenBrew(f, true);
    const expiry = f.p.getAttribute("potions:divine:state").endsAt;
    PM.emitPlayerProcess({ player: f.p });
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 105);
    advancePotionTimer(f);
    giveDrink(f, 2, I.SARADOMIN_BREW_4_);
    await browserOp(f, 2, "Drink");
    assert.equal(f.inv.getItems()[2].getId(), I.SARADOMIN_BREW_3_);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 93);
    PM.emitPlayerProcess({ player: f.p });
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 93);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.STRENGTH), 78);
    advancePotionTimer(f);
    giveDrink(f, 3, drink());
    await browserOp(f, 3, "Drink");
    assert.equal(f.inv.getItems()[3].getId(), next());
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 99);
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.STRENGTH), 99);
    PM.emitPlayerProcess({ player: f.p });
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 99);
    assert.equal(f.p.getAttribute("potions:divine:state").targets.find(entry => entry.skillIndex === core.Skill.ATTACK.getIndex()).target, 99);
    assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
  });
}

test("a death reset and later reboost update the maintained divine level", async t => {
  const f = divineActor(t, 99);
  await boostThenBrew(f, true);
  const expiry = f.p.getAttribute("potions:divine:state").endsAt;
  PM.emitPlayerProcess({ player: f.p });
  advancePotionTimer(f);
  giveDrink(f, 2, I.SARADOMIN_BREW_4_);
  await browserOp(f, 2, "Drink");
  assert.equal(f.inv.getItems()[2].getId(), I.SARADOMIN_BREW_3_);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 93);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getAttribute("potions:divine:state").targets.find(entry => entry.skillIndex === core.Skill.ATTACK.getIndex()).target, 93);
  advancePotionTimer(f);

  // This fixture account does not persist; death still follows the real queued task and hooks.
  f.p.setAttribute("bot-skip-persistence", true);
  f.inv.resetItems().refreshItems();
  const existingGround = new Set(core.World.getItems());
  t.after(() => {
    for (const ground of [...core.World.getItems()]) {
      if (!existingGround.has(ground) && ground.getOwner() === f.p.getUsername()) {
        core.ItemOnGroundManager.deregister(ground);
        const index = core.World.getItems().indexOf(ground);
        if (index >= 0) core.World.getItems().splice(index, 1);
      }
    }
  });
  let deaths = 0;
  const emitDeath = PM.emitPlayerDeath;
  t.mock.method(PM, "emitPlayerDeath", function(event) {
    if (event.player === f.p) deaths++;
    return emitDeath.call(this, event);
  });
  let deathTask;
  const submit = core.TaskManager.submit;
  t.mock.method(core.TaskManager, "submit", function(task) {
    if (task instanceof PlayerDeathTask && task.player === f.p) deathTask = task;
    return submit.call(this, task);
  });
  t.after(() => deathTask?.stop());
  f.p.setHitpoints(0);
  f.p.appendDeath();
  assert.ok(deathTask, "the real death task was submitted for this player");
  assert.equal(f.p.isDyingReturn(), true);
  for (let i = 0; i < 8 && deaths === 0; i++) core.TaskManager.process();
  assert.equal(deaths, 1, "the actual queued death task reached its death hook");
  assert.equal(f.p.isDyingReturn(), false);
  assert.equal(f.p.getHitpoints(), 99);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 99);
  assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 99);
  assert.equal(f.p.getAttribute("potions:divine:state").targets.find(entry => entry.skillIndex === core.Skill.ATTACK.getIndex()).target, 99);

  giveDrink(f, 0, I.SUPER_ATTACK_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), I.SUPER_ATTACK_3_);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 118);
  assert.equal(f.p.getAttribute("potions:divine:state").endsAt, expiry);
});

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



// Actual bank-note production and the registered health-orb widget route.
async function withdrawSanfewNotes(f) {
  const ordinary = 10931;
  const noted = 10932;
  const original = core.ItemDefinition.forId(ordinary);
  const certificate = core.ItemDefinition.forId(noted);
  assert.equal(original.isNoted(), false);
  assert.equal(original.getNoteId(), noted);
  assert.equal(certificate.isNoted(), true);
  assert.equal(certificate.unNote(), ordinary);
  assert.equal(certificate.isStackable(), true);
  assert.equal(core.CacheDefinitions.getItem(ordinary).inventoryActions[0], "Drink");
  assert.equal((core.CacheDefinitions.getItem(noted).inventoryActions ?? []).includes("Drink"), false);
  const bank = f.p.getBank(0);
  bank.add(item(ordinary, 2), false);
  assert.equal(bank.getAmount(ordinary), 2);
  bank.open();
  assert.equal(core.Bank.isOpen(f.p), true);
  assert.equal(f.p.withdrawAsNote(), false);
  await button(f, core.Bank.MAIN_INTERFACE_ID, core.Bank.NOTE_CHILD, undefined, 1);
  assert.equal(f.p.withdrawAsNote(), true);
  const slot = bank.getSlotForItemId(ordinary);
  assert.ok(slot >= 0);
  core.Bank.withdraw(f.p, ordinary, slot, 2, 0);
  assert.equal(bank.getAmount(ordinary), 0);
  assert.equal(f.inv.getAmount(noted), 2);
  const noteSlot = f.inv.getItems().findIndex(held => held?.getId() === noted);
  assert.ok(noteSlot >= 0);
  assert.equal(f.inv.getItems()[noteSlot].getAmount(), 2);
  assert.equal(f.inv.getItems()[noteSlot].getMeta(), null);
  f.p.getPacketSender().sendInterfaceRemoval();
  assert.equal(core.Bank.isOpen(f.p), false);
  return noteSlot;
}

function poisonForOrb(t, f) {
  const { CombatPoisonEffect } = require("../dist/game/task/impl/CombatPoisonEffect");
  assert.equal(f.p.isPoisoned(), false);
  assert.equal(f.p.isVenomed(), false);
  core.CombatFactory.poisonEntity(f.p, 20, 1);
  t.after(() => CombatPoisonEffect.suspend(f.p));
  assert.equal(f.p.isPoisoned(), true);
  assert.equal(f.p.isVenomed(), false);
  assert.equal(f.p.getPoisonDamage(), 20);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.STUN), false);
  assert.ok(f.p.getHitpoints() > 0);
}
async function clickHealthCure(f) {
  const component = core.CacheDefinitions.getComponentId("orbs:healthbutton");
  assert.equal(component, (160 << 16) | 9);
  await button(f, component >>> 16, component & 0xffff, undefined, 1);
}

test("health-orb Cure leaves bank-noted Sanfew serum untouched", async t => {
  const f = actor(t);
  const slot = await withdrawSanfewNotes(f);
  poisonForOrb(t, f);
  assert.equal(f.inv.getItems()[slot].getId(), 10932);
  assert.equal(f.inv.getItems()[slot].getAmount(), 2);
  await clickHealthCure(f);
  assert.equal(f.inv.getAmount(10932), 2, "notes are not drinkable and must be retained");
  assert.equal(f.inv.getItems()[slot].getMeta(), null);
  assert.equal(f.inv.getAmount(I.VIAL), 0);
  assert.equal(f.p.getPoisonDamage(), 20);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
});

test("health-orb Cure consumes an ordinary Sanfew dose", async t => {
  const f = actor(t);
  assert.equal(core.ItemDefinition.forId(10931).isNoted(), false);
  assert.equal(core.CacheDefinitions.getItem(10931).inventoryActions[0], "Drink");
  put(f, item(10931), 0);
  poisonForOrb(t, f);
  await clickHealthCure(f);
  assert.equal(f.inv.getItems()[0].getId(), I.VIAL);
  assert.equal(f.inv.getItems()[0].getAmount(), 1);
  assert.equal(f.p.getPoisonDamage(), 0);
  assert.equal(f.p.isPoisoned(), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
});

test("health-orb Cure skips noted Sanfew and uses carried antipoison", async t => {
  const f = actor(t);
  const slot = await withdrawSanfewNotes(f);
  const antipoison = I.ANTIPOISON_1_;
  assert.equal(core.ItemDefinition.forId(antipoison).isNoted(), false);
  assert.equal(core.CacheDefinitions.getItem(antipoison).inventoryActions[0], "Drink");
  const treatmentSlot = slot === 0 ? 1 : 0;
  put(f, item(antipoison), treatmentSlot);
  poisonForOrb(t, f);
  await clickHealthCure(f);
  assert.equal(f.inv.getAmount(10932), 2, "the noted stack remains whole");
  assert.equal(f.inv.getItems()[treatmentSlot].getId(), I.VIAL);
  assert.equal(f.p.getPoisonDamage(), 0);
  assert.equal(f.p.isPoisoned(), false);
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


// These use the registered player, real timer repository and decoded inventory action above.
function prepareHitpoints(f, current) {
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const hp = core.Skill.HITPOINTS;
  const skills = f.p.getSkillManager();
  const xp = SkillManager.getExperienceForLevel(99);
  for (const name of SKILLS) {
    skills.setExperience(core.Skill[name], xp);
    assert.equal(skills.getMaxLevel(core.Skill[name]), 99);
    assert.equal(skills.getCurrentLevel(core.Skill[name]), 99);
    assert.equal(skills.getExperience(core.Skill[name]), xp);
  }
  skills.setExperience(hp, xp);
  skills.setMaxLevel(hp, 99);
  skills.setCurrentLevel(hp, current, false);
  assert.equal(skills.getExperience(hp), xp);
  assert.equal(skills.getMaxLevel(hp), 99);
  assert.equal(f.p.getHitpoints(), current);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  return xp;
}

function plainDrink(f, slot, id) {
  assert.equal(core.CacheDefinitions.getItem(id).inventoryActions[0], "Drink");
  assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
  const held = put(f, item(id), slot);
  assert.equal(held.getAmount(), 1);
  assert.equal(held.getMeta(), null);
}

async function produceOverheal(f) {
  const xp = prepareHitpoints(f, 99);
  plainDrink(f, 0, I.SARADOMIN_BREW_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), I.SARADOMIN_BREW_3_);
  assert.equal(f.p.getHitpoints(), 115);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  for (let tick = 0; tick < 3; tick++) f.p.getTimers().process();
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  assert.equal(f.p.getHitpoints(), 115);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.HITPOINTS), xp);
  return xp;
}

test("an ordinary healing mix does not lower a brew's existing overheal", async t => {
  const f = actor(t);
  const xp = await produceOverheal(f);
  f.p.setRunEnergy(50);
  plainDrink(f, 1, I.ENERGY_MIX_2_);
  assert.equal(f.inv.getItems()[1].getId(), 11453);
  assert.equal(f.p.getRunEnergy(), 50);
  assert.equal(f.p.getHitpoints(), 115);
  await browserOp(f, 1, "Drink");
  assert.equal(f.p.getHitpoints(), 115, "healing must preserve the existing overheal");
  assert.equal(f.inv.getItems()[1].getId(), 11455);
  assert.equal(f.inv.getItems()[1].getMeta(), null);
  assert.equal(f.p.getRunEnergy(), 65);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.HITPOINTS), xp);
});

for (const [start, expected] of [[90, 93], [99, 99]]) {
  test(`ordinary healing mix from ${start} Hitpoints`, async t => {
    const f = actor(t);
    const xp = prepareHitpoints(f, start);
    f.p.setRunEnergy(50);
    plainDrink(f, 0, I.ENERGY_MIX_2_);
    await browserOp(f, 0, "Drink");
    assert.equal(f.p.getHitpoints(), expected);
    assert.equal(f.inv.getItems()[0].getId(), 11455);
    assert.equal(f.p.getRunEnergy(), 65);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.HITPOINTS), xp);
  });
}

test("ordinary food preserves a brew's existing overheal", async t => {
  const f = actor(t);
  const xp = await produceOverheal(f);
  const shark = I.SHARK;
  assert.equal(core.CacheDefinitions.getItem(shark).inventoryActions[0], "Eat");
  assert.equal(core.ItemDefinition.forId(shark).isNoted(), false);
  put(f, item(shark), 1);
  assert.equal(f.inv.getItems()[1].getMeta(), null);
  assert.equal(f.p.getTimers().has(core.TimerKey.FOOD), false);
  assert.equal(f.p.getHitpoints(), 115);
  await browserOp(f, 1, "Eat");
  assert.equal(f.p.getHitpoints(), 115);
  assert.notEqual(f.inv.getItems()[1]?.getId(), shark);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.HITPOINTS), xp);
});

// Prayer restores must not lower a boost produced by a real Ancient brew.
function prayerRestoreActor(t) {
  const f = actor(t);
  const skills = f.p.getSkillManager();
  const xp = core.SkillManager.getExperienceForLevel(99);
  for (const name of [...SKILLS, "HITPOINTS"]) {
    const skill = core.Skill[name];
    skills.setExperience(skill, xp);
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, 99, false);
    assert.equal(skills.getExperience(skill), xp);
    assert.equal(skills.getMaxLevel(skill), 99);
    assert.equal(skills.getCurrentLevel(skill), 99);
  }
  assert.equal(f.p.isPlayerBot(), false);
  assert.equal(f.p.getPrayerActive().some(Boolean), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.STUN), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  assert.equal(f.p.getAttribute("potions:divine:state") ?? null, null);
  return { ...f, prayerXp: xp };
}

async function ancientPrayerBoost(f) {
  plainDrink(f, 0, I.ANCIENT_BREW_4_);
  assert.equal(f.inv.getItems()[0].getId(), 26340);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), 26342);
  assert.equal(f.inv.getItems()[0].getAmount(), 1);
  assert.equal(f.inv.getItems()[0].getMeta(), null);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 103);
  for (const name of ["ATTACK", "STRENGTH", "DEFENCE"]) {
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill[name]), 88);
  }
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  for (let tick = 0; tick < 3; tick++) f.p.getTimers().process();
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.STUN), false);
  assert.equal(f.p.getPrayerActive().some(Boolean), false);
  assert.equal(f.p.getAttribute("potions:divine:state") ?? null, null);
  assert.equal(f.p.getSkillManager().getMaxLevel(core.Skill.PRAYER), 99);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 103);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.PRAYER), f.prayerXp);
}

test("a super restore preserves an existing Ancient brew Prayer boost", async t => {
  const f = prayerRestoreActor(t);
  await ancientPrayerBoost(f);
  plainDrink(f, 1, I.SUPER_RESTORE_4_);
  assert.equal(f.inv.getItems()[1].getId(), 3024);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 88);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 103);
  await browserOp(f, 1, "Drink");
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 103,
    "a positive restore must not remove existing Prayer points");
  assert.equal(f.inv.getItems()[1].getId(), 3026);
  assert.equal(f.inv.getItems()[1].getAmount(), 1);
  assert.equal(f.inv.getItems()[1].getMeta(), null);
  assert.equal(f.inv.getItems()[0].getId(), 26342);
  for (const name of ["ATTACK", "STRENGTH", "DEFENCE"]) {
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill[name]), 99);
  }
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.PRAYER), f.prayerXp);
});

test("the Ancient brew Prayer boost remains after its intake timer clears", async t => {
  const f = prayerRestoreActor(t);
  await ancientPrayerBoost(f);
  PM.emitPlayerProcess({ player: f.p });
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 103);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 88);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.PRAYER), f.prayerXp);
});

test("a super restore raises Prayer below base", async t => {
  const f = prayerRestoreActor(t);
  f.p.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 60, false);
  assert.equal(f.p.getSkillManager().getMaxLevel(core.Skill.PRAYER), 99);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 60);
  plainDrink(f, 0, I.SUPER_RESTORE_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 92);
  assert.equal(f.inv.getItems()[0].getId(), 3026);
  assert.equal(f.inv.getItems()[0].getMeta(), null);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.PRAYER), f.prayerXp);
});

test("a super restore remains drinkable at base Prayer", async t => {
  const f = prayerRestoreActor(t);
  plainDrink(f, 0, I.SUPER_RESTORE_4_);
  await browserOp(f, 0, "Drink");
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 99);
  assert.equal(f.inv.getItems()[0].getId(), 3026);
  assert.equal(f.inv.getItems()[0].getMeta(), null);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.PRAYER), f.prayerXp);
});

test("Jangerberries preserve an existing Ancient brew Prayer boost", async t => {
  const f = prayerRestoreActor(t);
  await ancientPrayerBoost(f);
  assert.equal(core.CacheDefinitions.getItem(I.JANGERBERRIES).inventoryActions[0], "Eat");
  assert.equal(core.ItemDefinition.forId(I.JANGERBERRIES).isNoted(), false);
  const berries = put(f, item(I.JANGERBERRIES), 1);
  assert.equal(berries.getAmount(), 1);
  assert.equal(berries.getMeta(), null);
  assert.equal(f.p.getTimers().has(core.TimerKey.FOOD), false);
  await browserOp(f, 1, "Eat");
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 103);
  assert.notEqual(f.inv.getItems()[1].getId(), I.JANGERBERRIES);
  assert.equal(f.p.getTimers().has(core.TimerKey.FOOD), true);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.PRAYER), f.prayerXp);
});

// Ordinary drinks and house refreshments use different empty glasses.
function ordinaryAleActor(t) {
  const f = divineActor(t, 90);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.equal(f.p.isRegistered(), true);
  assert.equal(f.p.isPlayerBot(), false);
  assert.equal(f.p.isDyingReturn() ?? false, false);
  assert.equal(f.p.getPrivateArea(), null);
  assert.equal(f.p.getLocation().getX(), HOME[0]);
  assert.equal(f.p.getLocation().getY(), HOME[1]);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.FOOD), false);
  assert.equal(f.p.getTimers().has(core.TimerKey.STUN), false);
  assert.equal(I.BEER_GLASS, 1919);
  assert.equal(I.BEER_GLASS_4, 7742);
  const ordinary = core.CacheDefinitions.getItem(I.BEER_GLASS);
  const house = core.CacheDefinitions.getItem(I.BEER_GLASS_4);
  assert.equal(ordinary.name, "Beer glass");
  assert.equal(ordinary.isTradable, true);
  assert.equal(ordinary.noteTemplate, -1);
  assert.equal(ordinary.placeholderTemplate, -1);
  assert.equal(house.name, "Beer glass");
  assert.equal(house.isMembers, true);
  assert.equal(f.inv.getAmount(I.BEER_GLASS), 0);
  assert.equal(f.inv.getAmount(I.BEER_GLASS_4), 0);
  return f;
}

function placeOrdinaryAle(f, id, expectedName) {
  const definition = core.CacheDefinitions.getItem(id);
  assert.equal(definition.name, expectedName);
  assert.equal(definition.inventoryActions[0], "Drink");
  assert.equal(definition.isTradable, true);
  assert.equal(definition.noteTemplate, -1);
  assert.equal(definition.placeholderTemplate, -1);
  assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
  assert.equal(core.ItemDefinition.forId(id).isTradeable(), true);
  const held = put(f, item(id), 0);
  assert.equal(f.inv.getItems()[0], held);
  assert.equal(held.getId(), id);
  assert.equal(held.getAmount(), 1);
  assert.equal(held.getMeta(), null);
  return held;
}

for (const [name, id, expectedId, hitpoints] of [
  ["Moonlight mead", () => I.MOONLIGHT_MEAD, 2955, 94],
  ["Wizard's mind bomb", () => I.WIZARDS_MIND_BOMB, 1907, 91],
]) {
  test(`${name} returns an ordinary beer glass`, async t => {
    const f = ordinaryAleActor(t);
    assert.equal(id(), expectedId);
    placeOrdinaryAle(f, id(), name);
    const hpXp = f.p.getSkillManager().getExperience(core.Skill.HITPOINTS);
    assert.equal(f.p.getHitpoints(), 90);
    await browserOp(f, 0, "Drink");
    assert.equal(f.inv.getItems()[0].getId(), I.BEER_GLASS,
      "the consumed ordinary ale leaves an ordinary beer glass in its slot");
    assert.equal(f.inv.getAmount(I.BEER_GLASS_4), 0);
    assert.equal(f.inv.getItems()[0].getAmount(), 1);
    assert.equal(f.inv.getItems()[0].getMeta(), null);
    assert.equal(f.inv.getAmount(id()), 0);
    assert.equal(f.inv.getAmount(I.BEER_GLASS), 1);
    assert.equal(f.p.getHitpoints(), hitpoints);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.HITPOINTS), hpXp);
    assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  });
}

test("ordinary beer leaves its normal glass", async t => {
  const f = ordinaryAleActor(t);
  assert.equal(I.BEER, 1917);
  placeOrdinaryAle(f, I.BEER, "Beer");
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), I.BEER_GLASS);
  assert.equal(f.inv.getItems()[0].getAmount(), 1);
  assert.equal(f.inv.getItems()[0].getMeta(), null);
  assert.equal(f.inv.getAmount(I.BEER_GLASS_4), 0);
  assert.equal(f.p.getHitpoints(), 91);
});

test("ordinary beer replaces its own slot when the inventory is full", async t => {
  const f = ordinaryAleActor(t);
  placeOrdinaryAle(f, I.BEER, "Beer");
  fill(f);
  assert.equal(f.inv.getFreeSlots(), 0);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0].getId(), I.BEER_GLASS);
  assert.equal(f.inv.getItems()[0].getAmount(), 1);
  assert.equal(f.inv.getItems()[0].getMeta(), null);
  assert.equal(f.inv.getFreeSlots(), 0);
  assert.equal(f.inv.getAmount(I.BEER_GLASS_4), 0);
});

test("an active potion cooldown keeps ordinary mead intact", async t => {
  const f = ordinaryAleActor(t);
  const held = placeOrdinaryAle(f, I.MOONLIGHT_MEAD, "Moonlight mead");
  f.p.getTimers().extendOrRegister(core.TimerKey.POTION, 3);
  assert.equal(f.p.getTimers().has(core.TimerKey.POTION), true);
  await browserOp(f, 0, "Drink");
  assert.equal(f.inv.getItems()[0], held);
  assert.equal(f.inv.getItems()[0].getId(), I.MOONLIGHT_MEAD);
  assert.equal(f.inv.getItems()[0].getAmount(), 1);
  assert.equal(f.inv.getItems()[0].getMeta(), null);
  assert.equal(f.inv.getAmount(I.BEER_GLASS), 0);
  assert.equal(f.inv.getAmount(I.BEER_GLASS_4), 0);
  assert.equal(f.p.getHitpoints(), 90);
});

// This checks the registered identities; it does not create or consume a house drink.
test("ale registrations retain the glass for their drink variant", () => {
  const { findPotionEntry } = require("../plugins/items/Potions.plugin")._test;
  const ordinary = [I.WIZARDS_MIND_BOMB, I.DWARVEN_STOUT, I.AXEMANS_FOLLY, I.BANDITS_BREW,
    I.MOONLIGHT_MEAD, I.MOONLIGHT_MEAD_M_, I.SLAYERS_RESPITE, I.SLAYERS_RESPITE_M_];
  const house = [I.BEER_3, I.CIDER_3, I.ASGARNIAN_ALE_3, I.GREENMANS_ALE_3,
    I.DRAGON_BITTER_3, I.CHEFS_DELIGHT_3];
  for (const [ids, expected] of [[ordinary, I.BEER_GLASS], [house, I.BEER_GLASS_4]]) {
    for (const id of ids) {
      const entry = findPotionEntry(id);
      assert.ok(entry, `ale ${id} is registered`);
      assert.equal(entry.replacementId, expected, `ale ${id} has the correct empty glass`);
    }
  }
});
