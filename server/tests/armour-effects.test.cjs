// Run after `yarn build`: node --test tests/armour-effects.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

// Obsidian gear is matched by item name, read from the cache.
CachePipeline.initialize();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Item } = require("../dist/game/model/Item");
const { Flag } = require("../dist/game/model/Flag");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const registerObsidianEffects = require("../plugins/combat/effects/ObsidianArmour.EquipmentEffects");
const Graceful = require("../plugins/items/GracefulOutfit.plugin");
const VoidEquipment = require("../plugins/items/VoidEquipment.plugin");
const BarrowsEquipment = require("../plugins/items/BarrowsEquipment.plugin");
const EquipmentStats = require("../plugins/interface/EquipmentStats.plugin");

function item(id) {
  return { getId: () => id };
}

function playerWithEquipment(overrides) {
  const items = new Array(14).fill(null).map(() => item(0));
  for (const [slot, id] of Object.entries(overrides)) {
    items[Number(slot)] = item(id);
  }
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items }),
    getUpdateFlag: () => ({ flag: () => {} }),
    items,
  };
}

/** A fake plugin api that keeps modifiers, hooks and custom-event listeners. */
function buildApi(overrides = {}) {
  const listeners = new Map();
  const noop = () => {};
  const api = {
    core: { Equipment, ItemIdentifiers, CombatType, Flag, WeaponInterfaceManager, ItemDefinition },
    onCustomEvent(name, handler) {
      listeners.set(name, [...(listeners.get(name) ?? []), handler]);
    },
    emitCustomEvent(name, payload) {
      for (const handler of listeners.get(name) ?? []) handler(payload);
    },
    registerCombatEffectiveLevelModifier: noop,
    registerMagicDamageBonusModifier: noop,
    registerMeleeHitModifier: noop,
    registerMeleeAttackAccuracyModifier: noop,
    registerRunEnergyRestoreModifier: noop,
    registerBonusProvider: noop,
    registerMeleeDefenseModifier: noop,
    registerRangedDefenseModifier: noop,
    registerMagicDefenseModifier: noop,
    onCombatHitRoll: noop,
    onPlayerDealtDamage: noop,
    onCombatHitResolved: noop,
    onPlayerLogin: noop,
    onPlayerLogout: noop,
    onCanEquip: noop,
    onItemDropPolicy: noop,
    onPlayerDeathItemDrop: noop,
    onNpcInteraction: noop,
    onInterfaceActionButton: noop,
    onPlayerProcess: noop,
    getBonusManager: () => ({ update: noop }),
    getTaskManager: () => ({ submit: noop }),
    getCombatFactory: () => ({ inCombat: () => false, addPendingHit: noop }),
    sendMultiChatboxPrompt: noop,
    log: noop,
    ...overrides,
  };
  return { api, listeners };
}

test("the obsidian armour set adds 10% melee accuracy and damage, stacking with the berserker necklace", () => {
  let hitModifier;
  let accuracyModifier;
  registerObsidianEffects(buildApi({
    registerMeleeHitModifier: (modifier) => { hitModifier = modifier; },
    registerMeleeAttackAccuracyModifier: (modifier) => { accuracyModifier = modifier; },
  }).api);
  assert.equal(typeof hitModifier, "function");
  assert.equal(typeof accuracyModifier, "function");

  const weapon = 6528;
  const fullSet = { 0: ItemIdentifiers.OBSIDIAN_HELMET, 4: ItemIdentifiers.OBSIDIAN_PLATEBODY, 7: ItemIdentifiers.OBSIDIAN_PLATELEGS, 3: weapon };
  const setOnly = playerWithEquipment(fullSet);
  assert.ok(Math.abs(hitModifier(setOnly, 100) - 110) < 1e-9);
  assert.ok(Math.abs(accuracyModifier(setOnly, 100) - 110) < 1e-9);

  const withNecklace = playerWithEquipment({ ...fullSet, 2: ItemIdentifiers.BERSERKER_NECKLACE });
  assert.ok(Math.abs(hitModifier(withNecklace, 100) - 132) < 1e-9, "20% necklace * 10% set");
  assert.ok(Math.abs(accuracyModifier(withNecklace, 100) - 110) < 1e-9, "the necklace is damage only");

  const necklaceOnly = playerWithEquipment({ 2: ItemIdentifiers.BERSERKER_NECKLACE, 3: weapon });
  assert.ok(Math.abs(hitModifier(necklaceOnly, 100) - 120) < 1e-9);
  assert.equal(accuracyModifier(necklaceOnly, 100), 100);

  const noWeapon = playerWithEquipment({ 0: ItemIdentifiers.OBSIDIAN_HELMET, 4: ItemIdentifiers.OBSIDIAN_PLATEBODY, 7: ItemIdentifiers.OBSIDIAN_PLATELEGS });
  assert.equal(hitModifier(noWeapon, 100), 100, "no obsidian weapon, no bonus");
});

test("graceful pieces give 3-4% each and the full set another 10%", () => {
  const names = {
    0: "Graceful hood",
    4: "Graceful top",
    7: "Graceful legs",
    9: "Graceful gloves",
    10: "Graceful boots",
    1: "Graceful cape",
  };
  assert.equal(Graceful._test.gracefulRestoreBonusFromSlots({ 0: "Graceful hood" }, false), 0.03);
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots(names, false) - 0.30) < 1e-9);
  const noCape = { ...names, 1: "Spottier cape" };
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots(noCape, false) - 0.17) < 1e-9);
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots(noCape, true) - 0.27) < 1e-9, "agility cape substitutes for the set");
  assert.equal(Graceful._test.gracefulRestoreBonusFromSlots({ 1: "Graceful cape (Arceuus)" }, false), 0.03);
  assert.equal(Graceful._test.gracefulRestoreBonusFromSlots({ 1: "Spottier cape", 0: "Rune full helm" }, false), 0);
});

function realEquipment(idsBySlot) {
  const items = new Array(14).fill(null).map(() => new Item(-1));
  for (const [slot, id] of Object.entries(idsBySlot)) items[Number(slot)] = new Item(id);
  return items;
}

test("void set bonus is surfaced only for a complete matching set", () => {
  const { api } = buildApi();
  VoidEquipment.register(api);

  const full = playerWithEquipment({
    0: ItemIdentifiers.VOID_MELEE_HELM,
    4: ItemIdentifiers.VOID_KNIGHT_TOP,
    7: ItemIdentifiers.VOID_KNIGHT_ROBE,
    9: ItemIdentifiers.VOID_KNIGHT_GLOVES,
  });
  const shown = { player: full, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", shown);
  assert.deepEqual(shown.lines, ["Void (melee): +10% melee accuracy and damage"]);

  full.items[9] = item(0);
  const removed = { player: full, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", removed);
  assert.deepEqual(removed.lines, [], "removing the gloves removes the displayed bonus");

  const eliteRanged = playerWithEquipment({
    0: ItemIdentifiers.VOID_RANGER_HELM,
    4: ItemIdentifiers.ELITE_VOID_TOP,
    7: ItemIdentifiers.ELITE_VOID_ROBE,
    9: ItemIdentifiers.VOID_KNIGHT_GLOVES,
  });
  const ranged = { player: eliteRanged, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", ranged);
  assert.deepEqual(ranged.lines, ["Elite void (ranged): +10% accuracy, +12.5% damage"]);

  const magic = playerWithEquipment({
    0: ItemIdentifiers.VOID_MAGE_HELM,
    4: ItemIdentifiers.VOID_KNIGHT_TOP,
    7: ItemIdentifiers.VOID_KNIGHT_ROBE,
    9: ItemIdentifiers.VOID_KNIGHT_GLOVES,
  });
  const magicShown = { player: magic, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", magicShown);
  assert.deepEqual(magicShown.lines, ["Void (magic): +45% magic accuracy"]);
});

test("void helm/top/robe/gloves swaps refresh the combat tab", () => {
  const originalAssign = WeaponInterfaceManager.assign;
  let assigned = 0;
  WeaponInterfaceManager.assign = () => { assigned++; };
  try {
    const { api } = buildApi();
    VoidEquipment.register(api);
    const player = playerWithEquipment({
      0: ItemIdentifiers.VOID_MELEE_HELM,
      4: ItemIdentifiers.VOID_KNIGHT_TOP,
      7: ItemIdentifiers.VOID_KNIGHT_ROBE,
      9: ItemIdentifiers.VOID_KNIGHT_GLOVES,
    });
    let appearanceFlags = 0;
    player.getUpdateFlag = () => ({ flag: () => { appearanceFlags++; } });

    api.emitCustomEvent("equipment:changed", { player });
    api.emitCustomEvent("equipment:changed", { player });
    assert.equal(assigned, 1, "an unchanged refresh does not reassign the tab");
    player.items[0] = item(ItemIdentifiers.VOID_RANGER_HELM);
    api.emitCustomEvent("equipment:changed", { player });
    assert.equal(assigned, 2, "a helm swap reassigns it");
    assert.equal(appearanceFlags, 2);
    player.items[9] = item(0);
    api.emitCustomEvent("equipment:changed", { player });
    assert.equal(assigned, 3, "removing a piece reassigns it");
  } finally {
    WeaponInterfaceManager.assign = originalAssign;
  }
});

test("obsidian armour and berserker necklace bonuses are surfaced", () => {
  const { api } = buildApi();
  registerObsidianEffects(api);

  const full = playerWithEquipment({
    0: ItemIdentifiers.OBSIDIAN_HELMET,
    4: ItemIdentifiers.OBSIDIAN_PLATEBODY,
    7: ItemIdentifiers.OBSIDIAN_PLATELEGS,
    3: 6528,
    2: ItemIdentifiers.BERSERKER_NECKLACE,
  });
  const shown = { player: full, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", shown);
  assert.deepEqual(shown.lines, [
    "Obsidian armour: +10% melee accuracy and damage",
    "Berserker necklace: +20% melee damage",
  ]);

  full.items[3] = item(0);
  const unarmed = { player: full, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", unarmed);
  assert.deepEqual(unarmed.lines, [], "the bonuses need an obsidian weapon");

  full.items[3] = item(6528);
  full.items[0] = item(0);
  const noHelm = { player: full, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", noHelm);
  assert.deepEqual(noHelm.lines, ["Berserker necklace: +20% melee damage"]);
});

test("obsidian weapon/necklace/armour swaps refresh the combat tab", () => {
  const originalAssign = WeaponInterfaceManager.assign;
  let assigned = 0;
  WeaponInterfaceManager.assign = () => { assigned++; };
  try {
    const { api } = buildApi();
    registerObsidianEffects(api);
    const player = playerWithEquipment({
      0: ItemIdentifiers.OBSIDIAN_HELMET,
      4: ItemIdentifiers.OBSIDIAN_PLATEBODY,
      7: ItemIdentifiers.OBSIDIAN_PLATELEGS,
      3: 6528,
    });
    api.emitCustomEvent("equipment:changed", { player });
    api.emitCustomEvent("equipment:changed", { player });
    assert.equal(assigned, 1);
    player.items[3] = item(4151);
    api.emitCustomEvent("equipment:changed", { player });
    assert.equal(assigned, 2);
    player.items[2] = item(ItemIdentifiers.BERSERKER_NECKLACE);
    api.emitCustomEvent("equipment:changed", { player });
    assert.equal(assigned, 3);
  } finally {
    WeaponInterfaceManager.assign = originalAssign;
  }
});

test("graceful effects and weights cover every colour variant", () => {
  const { api } = buildApi();
  Graceful.register(api);

  const defaultSet = playerWithEquipment({ 0: 11850, 1: 11852, 4: 11854, 7: 11856, 9: 11858, 10: 11860 });
  const shown = { player: defaultSet, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", shown);
  assert.deepEqual(shown.lines, ["Graceful set: +30% run energy restore"]);
  assert.equal(Object.values(shown.slotWeights).reduce((sum, kg) => sum + kg, 0), -25);

  const arceuusSet = playerWithEquipment({ 0: 13579, 1: 13581, 4: 13583, 7: 13585, 9: 13587, 10: 13589 });
  const recoloured = { player: arceuusSet, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", recoloured);
  assert.deepEqual(recoloured.lines, shown.lines);
  assert.deepEqual(recoloured.slotWeights, shown.slotWeights, "a recolour never changes the weight");

  defaultSet.items[1] = item(0);
  const noCape = { player: defaultSet, lines: [], slotWeights: {} };
  api.emitCustomEvent("equipment:effects", noCape);
  assert.deepEqual(noCape.lines, [], "five pieces alone do not complete the set effect");
  assert.equal(Object.values(noCape.slotWeights).reduce((sum, kg) => sum + kg, 0), -21);
});

test("graceful restoration is recomputed from the worn pieces after death and relog", () => {
  const { api } = buildApi();
  Graceful.register(api);
  const ids = { 0: 11850, 1: 11852, 4: 11854, 7: 11856, 9: 11858, 10: 11860 };

  assert.ok(Math.abs(Graceful._test.energyRestoreBonus(playerWithEquipment(ids)) - 0.30) < 1e-9);
  assert.ok(Math.abs(Graceful._test.energyRestoreBonus(playerWithEquipment(ids)) - 0.30) < 1e-9, "a relog rebuilds the same bonus");
  assert.equal(Graceful._test.energyRestoreBonus(playerWithEquipment({})), 0, "lost pieces grant nothing");
  assert.ok(Math.abs(Graceful._test.gracefulRestoreBonusFromSlots({
    0: "Graceful hood (Arceuus)",
    1: "Graceful cape (Trailblazer)",
    4: "Graceful top (Hallowed)",
    7: "Graceful legs (Varlamore)",
    9: "Graceful gloves (Kourend)",
    10: "Graceful boots (Agility Arena)",
  }, false) - 0.30) < 1e-9, "mixed recolours still complete the set");
});

function barrowsPlayer({ equipmentIds = {}, inventoryItems = [], coins = 1_000_000 } = {}) {
  const items = realEquipment(equipmentIds);
  const inventory = [...inventoryItems];
  const messages = [];
  const flags = [];
  const counts = { equipment: 0, inventory: 0, paid: 0 };
  const equipment = {
    getItems: () => items,
    get: (slot) => items[slot],
    set: (slot, newItem) => { items[slot] = newItem; },
    refreshItems: () => { counts.equipment++; },
  };
  const inventoryContainer = {
    getItems: () => inventory,
    refreshItems: () => { counts.inventory++; },
    getAmount: (id) => (id === 995 ? coins : 0),
    deleteNumber: (id, amount) => { if (id === 995) { counts.paid += amount; coins -= amount; } },
  };
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
    getEquipment: () => equipment,
    getInventory: () => inventoryContainer,
    getUpdateFlag: () => ({ flag: (flag) => flags.push(flag) }),
    sendMessage: (message) => messages.push(message),
    getCombat: () => ({ getTarget: () => null }),
  };
  return { player, items, inventory, messages, flags, counts, get coins() { return coins; } };
}

test("barrows degradation reports each stage, breaks at 0 and refreshes the panels", () => {
  const { api } = buildApi();
  BarrowsEquipment.register(api);
  const { Barrows } = require("../dist/game/content/combat/Barrows");
  const { player, items, messages, flags, counts } = barrowsPlayer({ equipmentIds: { 0: 4716 } });

  for (let i = 0; i < 250; i++) BarrowsEquipment._test.degradeEquipment(player);
  assert.deepEqual(messages, ["Your Dharok's helm has degraded to 75%."]);
  assert.equal(counts.equipment, 250);
  assert.equal(counts.inventory, 250);
  assert.equal(flags.length, 250, "the appearance flag redraws the worn model");

  for (let i = 0; i < 750; i++) BarrowsEquipment._test.degradeEquipment(player);
  assert.equal(messages.at(-1), "Your Dharok's helm has fully degraded and can no longer be used.");
  assert.equal(Math.round(messages.filter((message) => message.includes("degraded to")).length), 3);
  assert.ok(Barrows.isBroken(items[0].getId()));
  assert.equal(BarrowsEquipment._test.durability(items[0]), 0);
});

test("an Echo Ahrim's piece degrades through its own staged ids", () => {
  const { api } = buildApi();
  BarrowsEquipment.register(api);
  const { Barrows } = require("../dist/game/content/combat/Barrows");
  const { ItemIds } = require("../dist/util/IdEnums");
  Barrows.registerVariantStages(ItemIds.AHRIMS_HOOD, [
    ItemIds.ECHO_AHRIMS_HOOD_100, ItemIds.ECHO_AHRIMS_HOOD_75, ItemIds.ECHO_AHRIMS_HOOD_50,
    ItemIds.ECHO_AHRIMS_HOOD_25, ItemIds.ECHO_AHRIMS_HOOD_0,
  ], ItemIds.ECHO_AHRIMS_HOOD);
  const { player, items, messages } = barrowsPlayer({ equipmentIds: { 0: 30445 } });

  for (let i = 0; i < 250; i++) BarrowsEquipment._test.degradeEquipment(player);
  assert.equal(items[0].getId(), 30525, "Echo ahrim's hood 75");
  assert.equal(Barrows.baseItemId(items[0].getId()), 4708);
  assert.deepEqual(messages, ["Your Echo ahrim's hood has degraded to 75%."]);

  for (let i = 0; i < 750; i++) BarrowsEquipment._test.degradeEquipment(player);
  assert.equal(items[0].getId(), 30543, "Echo ahrim's hood 0");
  assert.equal(Barrows.isBroken(items[0].getId()), true);
  assert.equal(BarrowsEquipment._test.durability(items[0]), 0);
});

test("barrows weapon degradation refreshes the weapon interface and stage name", () => {
  const originalAssign = WeaponInterfaceManager.assign;
  let assigned = 0;
  WeaponInterfaceManager.assign = () => { assigned++; };
  try {
    const { api } = buildApi();
    BarrowsEquipment.register(api);
    const { Barrows } = require("../dist/game/content/combat/Barrows");
    const { player, items, counts } = barrowsPlayer({ equipmentIds: { 3: 4718 } });
    BarrowsEquipment._test.degradeEquipment(player);
    assert.equal(assigned, 1);
    assert.equal(counts.equipment, 1);
    assert.equal(Barrows.baseItemId(items[3].getId()), 4718);
    assert.equal(items[3].getDefinition().getName(), "Dharok's greataxe 100");
  } finally {
    WeaponInterfaceManager.assign = originalAssign;
  }
});

test("barrows repair restores the base item and reports the cost", () => {
  const originalAssign = WeaponInterfaceManager.assign;
  let assigned = 0;
  WeaponInterfaceManager.assign = () => { assigned++; };
  try {
    const { api } = buildApi();
    BarrowsEquipment.register(api);
    const damagedHelm = new Item(4716);
    BarrowsEquipment._test.setDurability(damagedHelm, 500);
    const damagedAxe = new Item(4718);
    BarrowsEquipment._test.setDurability(damagedAxe, 900);
    const { player, inventory, messages, flags } = barrowsPlayer({
      inventoryItems: [damagedHelm, damagedAxe],
    });

    BarrowsEquipment._test.repairAll(player);
    assert.equal(damagedHelm.getId(), 4716, "the helm returns to its base id");
    assert.equal(damagedAxe.getId(), 4718, "the weapon returns to its base id");
    assert.equal(damagedHelm.getMetaValue("barrows"), undefined, "repair clears the durability");
    assert.ok(messages.at(-1).includes("has been repaired for"), messages.at(-1));
    assert.equal(assigned, 1, "a repaired weapon reassigns the weapon interface");
    assert.ok(flags.length > 0);
    assert.equal(inventory.length, 2);
  } finally {
    WeaponInterfaceManager.assign = originalAssign;
  }
});

test("barrows amulet of the damned crumbles and the target rows read the new equipment", () => {
  const { api } = buildApi();
  BarrowsEquipment.register(api);
  const { Barrows } = require("../dist/game/content/combat/Barrows");
  const amulet = new Item(Barrows.AMULET_OF_THE_DAMNED_FULL);
  amulet.setMetaValue("barrows", { remaining: 1 });
  const { player, items, messages, counts } = barrowsPlayer({ equipmentIds: { 2: Barrows.AMULET_OF_THE_DAMNED_FULL } });
  items[2] = amulet;

  BarrowsEquipment._test.degradeEquipment(player);
  assert.equal(items[2].getId(), -1);
  assert.ok(messages.includes("Your amulet of the damned crumbles to dust."));
  assert.equal(counts.equipment, 1);

  items[2] = new Item(4081);
  assert.ok(EquipmentStats._test.getTargetBonuses(player).undead, "a salve amulet shows its target bonus");
  items[2] = new Item(Barrows.AMULET_OF_THE_DAMNED_FULL);
  assert.equal(EquipmentStats._test.getTargetBonuses(player).undead, undefined,
    "replacing it refreshes the target rows from the worn equipment");
});

test("the equipment panel shows weight and set effects and re-renders on an equipment change", () => {
  const { api } = buildApi();
  Graceful.register(api);
  EquipmentStats.register(api);

  const sent = [];
  const messages = [];
  const items = realEquipment({ 0: 11850, 1: 11852, 4: 11854, 7: 11856, 9: 11858, 10: 11860 });
  const player = {
    getInterfaceId: () => 84,
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({
      sendString: (text, uid) => sent.push({ text, uid }),
      sendInterfaceRemoval: () => {},
      sendVarbit: () => player.getPacketSender(),
    }),
    getBonusManager: () => ({
      update: () => {},
      getAttackBonus: () => new Array(14).fill(0),
      getDefenceBonus: () => new Array(14).fill(0),
      getOtherBonus: () => new Array(14).fill(0),
    }),
    getEquipment: () => ({ getItems: () => items }),
    getInventory: () => ({ getItems: () => [] }),
    getWeapon: () => null,
    getBaseAttackSpeed: () => 4,
    getCombat: () => ({ getTarget: () => null }),
    getUpdateFlag: () => ({ flag: () => {} }),
  };

  api.emitCustomEvent("equipment:changed", { player });
  const weightRow = () => sent.filter((entry) => entry.uid === ((84 << 16) | 50)).at(-1).text;
  assert.equal(weightRow(), "-25.0 kg");
  assert.ok(EquipmentStats._test.describeEffects(player).lines.includes("Graceful set: +30% run energy restore"));
  assert.deepEqual(messages, [], "set effects are shown in the panel, not spammed in chat");

  items[1] = new Item(-1);
  api.emitCustomEvent("equipment:changed", { player });
  assert.equal(weightRow(), "-21.0 kg");
  assert.ok(!EquipmentStats._test.describeEffects(player).lines.some((line) => line.startsWith("Graceful set:")));
});

test("Skillcape.forId resolves every cape variant", () => {
  const { Skillcape } = require("../dist/game/model/Skillcape");
  for (const id of [9747, 9748, 10639]) {
    assert.equal(Skillcape.forId(id), Skillcape.ATTACK);
  }
  assert.equal(Skillcape.forId(9771), Skillcape.AGILITY);
  assert.equal(Skillcape.forId(9813), Skillcape.QUEST_POINT);
  assert.equal(Skillcape.forId(123456), undefined);
});
