// Run after `yarn build`: node --test tests/prayer-bones.test.cjs
// Prayer's bone data, its restore (Catacombs of Kourend, dragonbone necklace, never stacked), the
// bonecrusher's crushing and charges (docs/prayer-bones.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");
const { ObjectIdentifiers: Objects } = require("../dist/util/ObjectIdentifiers");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Animation } = require("../dist/game/model/Animation");
const { Sound } = require("../dist/game/Sound");
const { Task } = require("../dist/game/task/Task");
const { CountdownTask } = require("../dist/game/task/impl/CountdownTask");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");
const { CombatRange } = require("../dist/game/content/combat/CombatRange");
const { Projectile } = require("../dist/game/model/Projectile");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Sounds } = require("../dist/game/Sounds");

const DATA = require("../plugins/skills/data/bones.json");
const ASHES = require("../plugins/skills/data/ashes.json");

const handlers = new Map();
const firstActions = [];
const groundClicks = [];
const groundPickups = [];
const persistedAttributes = [];
let prompt;
let burialTasks = [];
let membersWorld = true;
let pluginConfig = {};
const configReads = [];
const api = {
  core: {
    Bank: require("../dist/game/model/container/impl/Bank").Bank,
    ChatType: require("../dist/net/protocol/ClientProtocol").ChatType,
    Skill, Location, Equipment, ItemIdentifiers: Items, ObjectIdentifiers: Objects, CacheDefinitions, Animation, Sound,
    Task, CountdownTask, ItemDefinition,
    WorldDefinition: { isMembersWorld: () => membersWorld },
    Sounds: { sendSound: (who, sound) => who.sounds?.push(sound) },
  },
  emitCustomEvent: (name, payload) => (handlers.get(name) ?? []).forEach((handler) => handler(payload)),
  onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  persistAttribute: (...args) => persistedAttributes.push(args),
  onItemFirstAction(handler) { firstActions.push(handler); },
  onGroundItemClick(itemId, option, handler) { groundClicks.push({ itemId, option, handler }); },
  onGroundItemPickup(handler) { groundPickups.push(handler); },
  sendMultiChatboxPrompt(...args) { prompt = args; },
  onItemAction() {},
  onItemOnItem() {},
  onObjectInteraction() {},
  onCanUseItem(handler) { handlers.set("can-use-item", [handler]); },
  onPlayerLogout(handler) { handlers.set("logout", [handler]); },
  onPlayerDisconnect(handler) { handlers.set("disconnect", [handler]); },
  onPlayerDeath(handler) { handlers.set("death", [handler]); },
  getTaskManager: () => ({ submit(task) { task.setRunning(true); burialTasks.push(task); } }),
  getPluginConfig(key, fallback) { configReads.push([key, fallback]); return key in pluginConfig ? pluginConfig[key] : fallback; },
};

let diaryElite = false;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/Prayer.plugin").register(api);
  require("../plugins/items/DragonboneNecklace.plugin").register(api);
  require("../plugins/items/Bonecrusher.plugin").register(api);
  require("../plugins/areas/CatacombsOfKourend.plugin").register(api);
  api.onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "morytania" && request.tier === "elite") request.complete = diaryElite;
  });
});

beforeEach(() => {
  diaryElite = false;
  burialTasks = [];
  membersWorld = true;
  pluginConfig = {};
  configReads.length = 0;
  prompt = null;
});

function player({ at = [3222, 3218], prayer = 50, maxPrayer = 70, amulet = null, inventory = {} } = {}) {
  const attributes = new Map();
  const xp = new Map();
  const levels = { current: prayer, max: maxPrayer };
  const items = { ...inventory };
  const messages = [];
  const worn = [];
  worn[Equipment.AMULET_SLOT] = amulet ? { getId: () => amulet } : null;
  return {
    messages, xp, levels,
    getLocation: () => new Location(at[0], at[1], 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    getPacketSender: () => ({ sendSound() {}, sendInterfaceRemoval() {} }),
    getEquipment: () => ({ get: (slot) => worn[slot] }),
    getInventory: () => ({
      contains: (id) => (items[id] ?? 0) > 0,
      getAmount: (id) => items[id] ?? 0,
      getFreeSlots: () => 10,
      adds: (id, amount) => { items[id] = (items[id] ?? 0) + amount; },
      deleteNumber: (id, amount) => { items[id] -= amount; },
    }),
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.set(skill, (xp.get(skill) ?? 0) + amount),
      getMaxLevel: () => levels.max,
      getCurrentLevel: () => levels.current,
      increaseCurrentLevel: (skill, amount, max) => { levels.current = Math.min(levels.current + amount, max); },
    }),
  };
}

/** Records spam lines (rsprox captures: burying and scattering never send game messages). */
const spamTo = (who) => (type, text) => {
  assert.equal(type, api.core.ChatType.SPAM, text);
  who.messages.push(text);
};

const bury = (who, itemId, extra = {}) => {
  const request = { player: who, itemId, handled: false, ...extra };
  api.emitCustomEvent("prayer:bury", request);
  return request.handled;
};

test("every bone and bonemeal in the data is a real obj, and each inventory bone has a worship row", () => {
  const bonemeal = new Set(DATA.bonemeal.map((row) => row.obj));
  for (const row of [...DATA.bones, ...DATA.bonemeal]) {
    assert.ok(Number.isInteger(CacheDefinitions.getObjId(row.obj)), row.obj);
  }
  for (const row of DATA.bones.filter((bone) => !bone.groundOnly)) assert.ok(bonemeal.has(row.bonemeal), `${row.obj} -> ${row.bonemeal}`);
});

test("the shared ground-bury preference keeps its saved key and false default", () => {
  const preference = persistedAttributes.filter(([key]) => key === "giant-lairs:bury-without-asking");
  assert.deepEqual(preference, [["giant-lairs:bury-without-asking", false]]);
});

test("worship gives four times the burying experience, as the Wiki's tables do", () => {
  const worship = new Map(DATA.bonemeal.map((row) => [row.obj, row.xp]));
  for (const bone of ["big_bones", "dragon_bones", "dagannoth_king_bones", "dragon_bones_superior"]) {
    const row = DATA.bones.find((entry) => entry.obj === bone);
    assert.equal(worship.get(row.bonemeal), row.xp * 4, bone);
  }
});

test("burying preserves a bone's fractional experience, and restores nothing outside the Catacombs without the necklace", () => {
  const who = player();
  assert.equal(bury(who, Items.BONES), true);
  assert.equal(who.xp.get(Skill.PRAYER), 4.5);
  assert.equal(who.levels.current, 50);
  assert.equal(bury(who, Items.COINS), false);
});

test("bull bones remain eligible for Prayer bury events but stay out of altar and Ectofuntus handling", () => {
  const who = player();
  assert.equal(bury(who, Items.BULL_BONES), true);
  assert.equal(who.xp.get(Skill.PRAYER), 40);
  const bone = { itemId: Items.BULL_BONES, bone: "unset" };
  api.emitCustomEvent("prayer:bone", bone);
  assert.equal(bone.bone, null);
  assert.equal(bury(who, Items.BULL_BONES, { crushed: true, scale: 0.5 }), true);
  assert.equal(who.xp.get(Skill.PRAYER), 60);
});

test("giant bones remain eligible for Prayer bury events but stay out of inventory, altar and Ectofuntus handling", () => {
  const id = CacheDefinitions.getObjId("giant_bones");
  const who = player({ inventory: { [id]: 1, [Items.BONECRUSHER]: 1 } });
  const inventoryBurial = firstActions[0]({ player: who, itemId: id, slot: 0 });
  assert.equal(inventoryBurial, false);
  const altarBone = { itemId: id, bone: "unset" };
  api.emitCustomEvent("prayer:bone", altarBone);
  assert.equal(altarBone.bone, null);
  assert.equal(bury(who, id), true);
  assert.equal(who.xp.get(Skill.PRAYER), 150);

  who.performAnimation = () => {};
  who.sendMessage = (text) => who.messages.push(text);
  const removed = { value: false };
  api.core.ItemOnGroundManager = { deregister() { removed.value = true; } };
  const groundPlayer = player();
  groundPlayer.performAnimation = () => {};
  const groundItem = { getItem: () => ({ getId: () => id }), isPendingRemoval: () => removed.value };
  const pickup = { player: who, groundItem, groundItemId: id, handled: false };
  assert.equal(groundPickups.at(-1)(pickup), true);
  assert.deepEqual(who.messages, ["I don't think those will fit in my backpack..."]);
  const telegrab = { groundItem, allow: true };
  api.emitCustomEvent("magic:can-telekinetic-grab", telegrab);
  assert.equal(telegrab.allow, false);
  const click = groundClicks.find(({ itemId }) => itemId === id);
  assert.ok(click);
  click.handler({ player: groundPlayer, groundItem, groundItemId: id, handled: false });
  assert.equal(prompt[1], "Bury the bones? (This grants Prayer XP)");
  prompt[3]();
  assert.equal(groundPlayer.xp.get(Skill.PRAYER), 150);
  assert.equal(removed.value, true);
});

test("bull bones cannot be picked up and their ground Bury uses the giant-bones confirmation", () => {
  const who = player();
  who.performAnimation = () => {};
  const removed = { value: false };
  const groundItem = {
    getItem: () => ({ getId: () => Items.BULL_BONES }),
    isPendingRemoval: () => removed.value,
  };
  let registered = false;
  api.core.ItemOnGroundManager = { deregister(item) { assert.equal(item, groundItem); removed.value = true; registered = true; } };
  const pickup = { player: who, groundItem, groundItemId: Items.BULL_BONES, handled: false };
  assert.equal(groundPickups.at(-1)(pickup), true);
  assert.equal(pickup.handled, true);
  assert.deepEqual(who.messages, ["I don't think those will fit in my backpack..."]);
  const telegrab = { player: who, itemId: Items.BULL_BONES, source: "telegrab", allow: true };
  api.emitCustomEvent("ground-items:take", telegrab);
  assert.equal(telegrab.allow, false, "the shared ground transfer guard rejects Telegrab");

  const click = groundClicks.find(({ itemId }) => itemId === Items.BULL_BONES);
  assert.equal(click.itemId, Items.BULL_BONES);
  assert.equal(click.option, 3);
  const event = { player: who, groundItem, groundItemId: Items.BULL_BONES, handled: false };
  click.handler(event);
  assert.equal(event.handled, true);
  assert.equal(prompt[1], "Bury the bones? (This grants Prayer XP)");
  assert.deepEqual([prompt[2], prompt[4], prompt[6]], ["Yes", "No", "Yes, don't ask me again"]);
  prompt[3]();
  assert.equal(registered, true);
  assert.equal(who.xp.get(Skill.PRAYER), 40);
  assert.equal(removed.value, true);
  prompt[3]();
  assert.equal(who.xp.get(Skill.PRAYER), 40, "a resolved ground bone cannot award XP twice");
});

test("cancelled and stale Bull-bone burial prompts leave the ground item and award no XP", () => {
  const who = player();
  who.performAnimation = () => {};
  const items = new Set();
  api.core.ItemOnGroundManager = { deregister(item) { items.add(item); } };
  const groundItem = { getItem: () => ({ getId: () => Items.BULL_BONES }), isPendingRemoval: () => items.has(groundItem) };

  groundClicks.find(({ itemId }) => itemId === Items.BULL_BONES).handler({ player: who, groundItem, groundItemId: Items.BULL_BONES, handled: false });
  prompt[5]();
  assert.equal(who.xp.get(Skill.PRAYER), undefined, "No cancels the burial");
  assert.equal(items.has(groundItem), false);

  groundClicks.find(({ itemId }) => itemId === Items.BULL_BONES).handler({ player: who, groundItem, groundItemId: Items.BULL_BONES, handled: false });
  items.add(groundItem);
  prompt[3]();
  assert.equal(who.xp.get(Skill.PRAYER), undefined, "a bone removed before confirmation gives no XP");
});

test("bull-bone confirmation preference skips future prompts", () => {
  const who = player();
  who.performAnimation = () => {};
  const removed = new Set();
  api.core.ItemOnGroundManager = { deregister(item) { removed.add(item); } };
  const groundItem = () => ({ getItem: () => ({ getId: () => Items.BULL_BONES }), isPendingRemoval: () => removed.has(item) });
  let item = groundItem();
  groundClicks.find(({ itemId }) => itemId === Items.BULL_BONES).handler({ player: who, groundItem: item, groundItemId: Items.BULL_BONES, handled: false });
  assert.ok(prompt, "the first ground burial asks");
  prompt[7]();
  assert.equal(who.getAttribute("giant-lairs:bury-without-asking"), true);
  assert.equal(who.xp.get(Skill.PRAYER), 40);

  prompt = null;
  item = groundItem();
  groundClicks.find(({ itemId }) => itemId === Items.BULL_BONES).handler({ player: who, groundItem: item, groundItemId: Items.BULL_BONES, handled: false });
  assert.equal(who.xp.get(Skill.PRAYER), 80);
  assert.equal(prompt, null, "the saved preference avoids later prompts");
});

test("the Catacombs give back the bone's restore, and the necklace there doesn't add to it", () => {
  const inside = player({ at: [1666, 10050], amulet: Items.DRAGONBONE_NECKLACE });
  bury(inside, Items.DRAGON_BONES);
  assert.equal(inside.levels.current, 54);
  const worn = player({ amulet: Items.DRAGONBONE_NECKLACE });
  bury(worn, Items.BIG_BONES);
  assert.equal(worn.levels.current, 52);
});

test("a restore never lifts Prayer above its level", () => {
  const who = player({ at: [1666, 10050], prayer: 69 });
  bury(who, Items.DRAGON_BONES);
  assert.equal(who.levels.current, 70);
});

function kill(who, drops) {
  const event = { player: who, drops, handled: false };
  api.emitCustomEvent("npc-drops:generated", event);
  return event.drops;
}

test("the bonecrusher crushes a kill's bones for half their experience, one charge each", () => {
  const who = player({ inventory: { [Items.BONECRUSHER]: 1 } });
  who.setAttribute("bonecrusher:charges", 10);
  const left = kill(who, [{ itemId: Items.BIG_BONES, amount: 2 }, { itemId: Items.COINS, amount: 5 }]);
  assert.deepEqual(left.map((drop) => drop.itemId), [Items.COINS]);
  assert.equal(who.xp.get(Skill.PRAYER), 15);
  assert.equal(who.getAttribute("bonecrusher:charges"), 8);
});

test("the bonecrusher crushes bull bones for 20 or 40 base Prayer XP", () => {
  const who = player({ inventory: { [Items.BONECRUSHER]: 1 } });
  who.setAttribute("bonecrusher:charges", 2);
  assert.deepEqual(kill(who, [{ itemId: Items.BULL_BONES, amount: 1 }]), []);
  assert.equal(who.xp.get(Skill.PRAYER), 20);
  assert.equal(who.getAttribute("bonecrusher:charges"), 1);

  diaryElite = true;
  assert.deepEqual(kill(who, [{ itemId: Items.BULL_BONES, amount: 1 }]), []);
  assert.equal(who.xp.get(Skill.PRAYER), 60);
  assert.equal(who.getAttribute("bonecrusher:charges"), 0);
});

test("the bonecrusher crushes giant bones for half experience and one charge each", () => {
  const giantBones = CacheDefinitions.getObjId("giant_bones");
  const who = player({ inventory: { [Items.BONECRUSHER]: 1 } });
  who.setAttribute("bonecrusher:charges", 2);
  assert.deepEqual(kill(who, [{ itemId: giantBones, amount: 1 }]), []);
  assert.equal(who.xp.get(Skill.PRAYER), 75);
  assert.equal(who.getAttribute("bonecrusher:charges"), 1);

  assert.deepEqual(kill(who, [{ itemId: giantBones, amount: 1 }]), []);
  assert.equal(who.xp.get(Skill.PRAYER), 150);
  assert.equal(who.getAttribute("bonecrusher:charges"), 0);
});

test("Bull bones bury on a free-to-play world", () => {
  membersWorld = false;
  const who = player();
  const removed = { value: false };
  who.performAnimation = () => {};
  api.core.ItemOnGroundManager = { deregister() { removed.value = true; } };
  who.setAttribute("giant-lairs:bury-without-asking", true);
  const groundItem = { getItem: () => ({ getId: () => Items.BULL_BONES }), isPendingRemoval: () => removed.value };
  groundClicks.find(({ itemId }) => itemId === Items.BULL_BONES).handler({ player: who, groundItem, groundItemId: Items.BULL_BONES, handled: false });
  assert.equal(removed.value, true);
  assert.equal(who.xp.get(Skill.PRAYER), 40);
});

test("real Telegrab rejects Bull bones before consuming runes or scheduling a projectile", (t) => {
  const who = player();
  const listener = new MagicOnItemPacketListener();
  let consumed = 0, scheduled = 0, projectile = 0, magicExperience = 0;
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => api.emitCustomEvent(name, event));
  t.mock.method(CombatRange, "withinApproachDistance", () => true);
  t.mock.method(listener, "runeCosts", () => []);
  t.mock.method(listener, "hasRunes", () => true);
  t.mock.method(listener, "consumeRunes", () => { consumed++; });
  t.mock.method(listener, "findVisibleGroundItem", () => ({ getItem: () => ({ getId: () => Items.BULL_BONES }) }));
  t.mock.method(TaskManager, "submit", () => { scheduled++; });
  t.mock.method(Projectile.prototype, "sendProjectile", () => { projectile++; });
  t.mock.method(Sounds, "sendSound", () => {});
  who.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
  who.getSkillManager = () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences(skill, amount) { magicExperience += amount; } });
  who.setPositionToFace = () => {};
  who.performAnimation = () => {};
  who.performGraphic = () => {};
  who.getPrivateArea = () => null;
  who.getPacketSender = () => ({ sendGlobalGraphic() {} });

  listener.castGroundItem(who, Items.BULL_BONES, 3222, 3218, 1168);
  assert.equal(consumed, 0);
  assert.equal(scheduled, 0);
  assert.equal(projectile, 0);
  assert.equal(magicExperience, 0);
});

test("with the elite Morytania diary it gives all the experience", () => {
  diaryElite = true;
  const who = player({ inventory: { [Items.BONECRUSHER]: 1 } });
  who.setAttribute("bonecrusher:charges", 10);
  kill(who, [{ itemId: Items.DRAGON_BONES, amount: 1 }]);
  assert.equal(who.xp.get(Skill.PRAYER), 72);
});

test("noted bones, tertiary long bones, an empty or inactive crusher or one in the bank leave the bones", () => {
  const who = player({ inventory: { [Items.BONECRUSHER]: 1 } });
  who.setAttribute("bonecrusher:charges", 10);
  const longBone = CacheDefinitions.getObjId("dorgesh_construction_bone");
  assert.equal(kill(who, [{ itemId: Items.BONES, amount: 1, noted: true }, { itemId: longBone, amount: 1 }]).length, 2);
  who.setAttribute("bonecrusher:inactive", 1);
  assert.equal(kill(who, [{ itemId: Items.BONES, amount: 1 }]).length, 1);
  const none = player({ inventory: { [Items.BONECRUSHER]: 1 } });
  assert.equal(kill(none, [{ itemId: Items.BONES, amount: 1 }]).length, 1);
  const banked = player();
  banked.setAttribute("bonecrusher:charges", 10);
  assert.equal(kill(banked, [{ itemId: Items.BONES, amount: 1 }]).length, 1);
});

test("every hundredth charge says how many are left, and a crush in the Catacombs restores Prayer", () => {
  const who = player({ at: [1666, 10050], inventory: { [Items.BONECRUSHER]: 1 } });
  who.setAttribute("bonecrusher:charges", 5701);
  kill(who, [{ itemId: Items.BONES, amount: 2 }]);
  assert.deepEqual(who.messages, ["Your bonecrusher has 5,700 charges left."]);
  assert.equal(who.levels.current, 52);
});

test("every demonic ash in the data is a real obj whose first option is Scatter, with the Wiki's experience", () => {
  const wiki = { fiendish_ashes: 10, vile_ashes: 25, malicious_ashes: 65, abyssal_ashes: 85, infernal_ashes: 110 };
  assert.deepEqual(ASHES.ashes.map((row) => row.obj), Object.keys(wiki));
  for (const row of ASHES.ashes) {
    const id = CacheDefinitions.getObjId(row.obj);
    assert.ok(Number.isInteger(id), row.obj);
    assert.equal(CacheDefinitions.getItem(id).inventoryActions[0], "Scatter", row.obj);
    assert.equal(row.xp, wiki[row.obj], row.obj);
  }
});

test("the first-action handlers leave items that are neither bones nor ashes alone", () => {
  const who = player();
  assert.equal(firstActions.length, 2);
  for (const handler of firstActions) {
    assert.equal(handler({ player: who, itemId: Items.COINS, slot: 0, handled: false }), false);
  }
});

test("a scatter resolves on the click, with the sequence, synth, message and experience live OSRS sends", () => {
  const vile = CacheDefinitions.getObjId("vile_ashes");
  const who = player();
  const slots = [{ getId: () => vile }];
  const animations = [];
  const skills = who.getSkillManager();
  Object.assign(who, {
    sounds: [],
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getInventory: () => ({ get: (slot) => slots[slot] ?? null, deleteAtSlot: (slot) => { slots[slot] = null; } }),
    getSkillManager: () => ({ ...skills, stopSkillable() {} }),
    sendMessage: (text) => assert.fail(`game message: ${text}`),
    getPacketSender: () => ({ sendInterfaceRemoval() {}, sendTypedMessage: spamTo(who) }),
    performAnimation: (animation) => animations.push(animation),
  });
  // This api has no CountdownTask or task manager, so a scatter that waited for a later tick throws.
  assert.deepEqual(firstActions.map((handler) => handler({ player: who, itemId: vile, slot: 0, handled: false })), [false, true]);
  assert.equal(slots[0], null);
  assert.equal(who.xp.get(Skill.PRAYER), 25);
  assert.deepEqual(who.messages, ["You scatter the ashes."]);
  assert.deepEqual(animations.map((animation) => animation.id), [2295]);
  assert.deepEqual(who.sounds.map((sound) => sound.getId()), [2444]);
});

function burialPlayer(ids, maxPrayer = 70) {
  const who = player({ maxPrayer });
  const slots = Array.from({ length: 28 }, (_, i) => new Item(ids[i] ?? -1, ids[i] ? 1 : 0));
  const inventory = {
    get: slot => slots[slot], getItems: () => slots,
    deleteAtSlot: slot => { slots[slot] = new Item(-1, 0); },
  };
  const state = { location: new Location(3222, 3218, 0), registered: true, hp: 10, skill: null };
  const skills = who.getSkillManager();
  Object.assign(who, {
    slots, state, animations: [], sounds: [],
    getIndex: () => 8761,
    getLocation: () => state.location,
    isRegistered: () => state.registered,
    getHitpoints: () => state.hp,
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    getInventory: () => inventory,
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getSkill: () => state.skill, setSkill: skill => { state.skill = skill; },
    getSkillManager: () => ({ ...skills, stopSkillable() { state.skill?.cancel(who); state.skill = null; } }),
    sendMessage: (text) => assert.fail(`game message: ${text}`),
    getPacketSender: () => ({ sendInterfaceRemoval() {}, sendTypedMessage: spamTo(who) }),
    performAnimation: animation => who.animations.push(animation),
  });
  return who;
}
function tickBurials(count) {
  for (let i = 0; i < count; i++) for (const task of [...burialTasks]) if (task.isRunning()) task.tick();
}
const clickBury = (who, slot = 0) => firstActions[0]({ player: who, itemId: who.slots[slot].getId(), slot });

test("by default a Bury click buries only the clicked bone on the click's tick, as live OSRS does", () => {
  // Unset, false or anything but the boolean true leaves burial as upstream: one bone per click.
  for (const value of [undefined, false, "true"]) {
    pluginConfig = value === undefined ? {} : { "Prayer:sequentialBurying": value };
    const who = burialPlayer([Items.BONES, Items.BONES, Items.BONES]);
    assert.equal(clickBury(who), true);
    assert.deepEqual(configReads.at(-1), ["Prayer:sequentialBurying", false]);
    assert.equal(who.state.skill, null, "a single burial is not a cancellable skilling action");
    // Rsprox captures 901, 3455, 3461: dig message, bone, experience, sequence and synth on the click.
    assert.equal(who.xp.get(Skill.PRAYER), 4.5, String(value));
    assert.equal(who.slots.filter(item => item.getId() === Items.BONES).length, 2);
    assert.deepEqual(who.messages, ["You dig a hole in the ground..."]);
    assert.deepEqual(who.animations.map(animation => animation.id), [827]);
    assert.deepEqual(who.sounds.map(sound => sound.getId()), [2738]);
    tickBurials(1);
    assert.deepEqual(who.messages, ["You dig a hole in the ground...", "You bury the bones."]);
    tickBurials(4);
    assert.equal(who.xp.get(Skill.PRAYER), 4.5, String(value));
    assert.equal(who.slots.filter(item => item.getId() === Items.BONES).length, 2);
    assert.equal(burialTasks.some(task => task.isRunning()), false);
  }
});

test("every bone sends the same two burial messages, not its own name", () => {
  const who = burialPlayer([Items.BIG_BONES]);
  clickBury(who);
  tickBurials(1);
  assert.deepEqual(who.messages, ["You dig a hole in the ground...", "You bury the bones."]);
});

test("by default walking away after the click does not give the bone back", () => {
  const who = burialPlayer([Items.BONES]);
  clickBury(who);
  who.state.location = new Location(3223, 3218, 0);
  tickBurials(2);
  assert.equal(who.xp.get(Skill.PRAYER), 4.5);
  assert.equal(who.slots[0].getId(), -1);
});

test("one Bury click buries the remaining bones sequentially, one every two ticks", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  const who = burialPlayer([Items.BONES, Items.BONES, Items.BONES]);
  assert.equal(clickBury(who), true);
  tickBurials(1);
  assert.equal(who.xp.get(Skill.PRAYER), undefined);
  tickBurials(1);
  assert.equal(who.xp.get(Skill.PRAYER), 4.5);
  assert.equal(who.slots.filter(item => item.getId() === Items.BONES).length, 2);
  tickBurials(4);
  assert.equal(who.xp.get(Skill.PRAYER), 13.5);
  assert.equal(who.slots.some(item => item.getId() === Items.BONES), false);
  assert.equal(burialTasks.some(task => task.isRunning()), false);
});

test("the clicked bone is first, then eligible mixed bones in slot order", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  const superior = CacheDefinitions.getObjId("dragon_bones_superior");
  const who = burialPlayer([Items.BONES, Items.COINS, Items.BIG_BONES, superior, Items.BIG_BONES], 1);
  clickBury(who, 2);
  tickBurials(2);
  assert.equal(who.xp.get(Skill.PRAYER), 15);
  assert.equal(who.slots[0].getId(), Items.BONES);
  tickBurials(4);
  assert.equal(who.xp.get(Skill.PRAYER), 34.5);
  assert.equal(who.slots[1].getId(), Items.COINS);
  assert.equal(who.slots[3].getId(), superior);
});

test("moving or replacing the resolving bone stops burial without consuming another item", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  for (const changed of ["location", "slot"]) {
    const who = burialPlayer([Items.BONES, Items.BONES]);
    clickBury(who);
    tickBurials(1);
    if (changed === "location") who.state.location = new Location(3223, 3218, 0);
    else who.slots[0] = new Item(Items.COINS, 1);
    tickBurials(4);
    assert.equal(who.xp.get(Skill.PRAYER), undefined);
    assert.equal(who.slots[1].getId(), Items.BONES);
  }
});

test("logout, disconnect, death, level-up and another item action cancel unresolved burial", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  for (const event of ["logout", "disconnect", "death", "level-up:popup-opened", "can-use-item"]) {
    const who = burialPlayer([Items.BONES, Items.BONES]);
    clickBury(who);
    api.emitCustomEvent(event, { player: who, action: "action", itemId: Items.COINS });
    tickBurials(6);
    assert.equal(who.xp.get(Skill.PRAYER), undefined, event);
    assert.equal(who.slots[0].getId(), Items.BONES, event);
    assert.equal(burialTasks.some(task => task.isRunning()), false, event);
  }
});

test("a repeated Bury click replaces its previous sequence instead of doubling rewards", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  const who = burialPlayer([Items.BONES, Items.BONES, Items.BONES]);
  clickBury(who);
  clickBury(who, 1);
  assert.equal(burialTasks.filter(task => task.isRunning()).length, 1);
  tickBurials(6);
  assert.equal(who.xp.get(Skill.PRAYER), 13.5);
});

test("automatic burial leaves members-only bones untouched on a free world", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  membersWorld = false;
  const who = burialPlayer([Items.BONES, Items.DRAGON_BONES, Items.BONES]);
  clickBury(who);
  tickBurials(6);
  assert.equal(who.xp.get(Skill.PRAYER), 9);
  assert.equal(who.slots[1].getId(), Items.DRAGON_BONES);
});

test("a level-up caused by resolving a bone stops before consuming the next bone", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  const who = burialPlayer([Items.BONES, Items.BONES]);
  const skills = who.getSkillManager();
  who.getSkillManager = () => ({ ...skills, addExperiences(skill, amount) {
    skills.addExperiences(skill, amount);
    api.emitCustomEvent("level-up:popup-opened", { player: who });
  } });
  clickBury(who);
  tickBurials(6);
  assert.equal(who.xp.get(Skill.PRAYER), 4.5);
  assert.equal(who.slots[1].getId(), Items.BONES);
  assert.equal(who.state.skill, null);
  assert.equal(burialTasks.some(task => task.isRunning()), false);
});

test("an acknowledged level-up resumes sequential burial at the next bone without repeating its XP", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  const who = burialPlayer([Items.BONES, Items.BONES]);
  const skills = who.getSkillManager(), resumes = [];
  let levelled = false;
  who.getSkillManager = () => ({ ...skills, addExperiences(skill, amount) {
    skills.addExperiences(skill, amount);
    if (!levelled) {
      levelled = true;
      api.emitCustomEvent("level-up:popup-opened", { player: who, pause: (_, resume) => resumes.push(resume) });
    }
  } });
  clickBury(who);
  tickBurials(8);
  assert.equal(who.xp.get(Skill.PRAYER), 4.5);
  assert.equal(who.slots[1].getId(), Items.BONES, "the next bone remains while the popup is open");
  assert.equal(resumes.length, 1);
  resumes[0]();
  tickBurials(6);
  assert.equal(who.xp.get(Skill.PRAYER), 9);
  assert.equal(burialTasks.some(task => task.isRunning()), false);
});

test("loss of skilling ownership cancels burial without resetting another action's animation", () => {
  pluginConfig["Prayer:sequentialBurying"] = true;
  const who = burialPlayer([Items.BONES, Items.BONES]);
  clickBury(who);
  const count = who.animations.length;
  const other = { cancel() {} };
  who.setSkill(other);
  tickBurials(4);
  assert.equal(who.xp.get(Skill.PRAYER), undefined);
  assert.equal(who.getSkill(), other);
  assert.equal(who.animations.length, count);
});
