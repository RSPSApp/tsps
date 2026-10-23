// Run after `yarn build`: node --test tests/slayer-helmet.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const NAMES = new Map([
  [ItemIdentifiers.SLAYER_HELMET, "Slayer helmet"],
  [ItemIdentifiers.SLAYER_HELMET_I_, "Slayer helmet (i)"],
  [ItemIdentifiers.BLACK_MASK, "Black mask"],
  [ItemIdentifiers.BLACK_MASK_7_, "Black mask (7)"],
  [ItemIdentifiers.BLACK_MASK_7_I_, "Black mask (7) (i)"],
  [ItemIdentifiers.BLACK_MASK_I_, "Black mask (i)"],
  [ItemIdentifiers.EARMUFFS, "Earmuffs"],
]);

const HELM_UNLOCKED_VARBIT = 3202;
const modifiers = {};
let onTask = true;
const SlayerHelmet = require("../plugins/items/SlayerHelmet.plugin");
SlayerHelmet.register({
  core: {
    ItemIdentifiers,
    Skill,
    Equipment: { HEAD_SLOT: 0 },
    ItemDefinition: { forId: (id) => ({ getName: () => NAMES.get(id) ?? "" }) },
    CacheDefinitions: { getVarbitId: (name) => (name === "slayer_helm_unlocked" ? HELM_UNLOCKED_VARBIT : null) },
  },
  emitCustomEvent: (name, request) => { if (name === "slayer:on-task") request.onTask = onTask; },
  registerMeleeAttackAccuracyModifier: (fn) => { modifiers.meleeAccuracy = fn; },
  registerMeleeHitModifier: (fn) => { modifiers.meleeHit = fn; },
  registerRangedAttackAccuracyModifier: (fn) => { modifiers.rangedAccuracy = fn; },
  registerRangedHitModifier: (fn) => { modifiers.rangedHit = fn; },
  registerMagicAttackAccuracyModifier: (fn) => { modifiers.magicAccuracy = fn; },
  registerMagicHitModifier: (fn) => { modifiers.magicHit = fn; },
  onItemOnItem() {},
  onItemAction() {},
  onCustomEvent() {},
});

const { assemble, imbue } = SlayerHelmet._test;

const EquipmentStats = require("../plugins/interface/EquipmentStats.plugin");
EquipmentStats.register({
  getBonusManager: () => ({}),
  onInterfaceActionButton() {},
  onPlayerProcess() {},
  emitCustomEvent: (name, request) => { if (name === "slayer:on-task") request.onTask = onTask; },
});
const { formatTargetBonus, getTargetBonuses } = EquipmentStats._test;

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getDefinition: () => ({ getName: () => NAMES.get(id) ?? "" }),
  };
}

function createPlayer({ head = -1, crafting = 99, inventory = [], helmUnlocked = true } = {}) {
  const items = inventory.map(item);
  const messages = [];
  const target = { isNpc: () => true, getAsNpc: () => ({}) };
  const player = {
    messages,
    items,
    isPlayer: () => true,
    getAsPlayer: () => player,
    getEquipment: () => ({ getItems: () => [head > 0 ? item(head) : null] }),
    getCombat: () => ({ getTarget: () => target }),
    getSkillManager: () => ({ getCurrentLevel: () => crafting }),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({ getVarbit: (id) => (id === HELM_UNLOCKED_VARBIT && helmUnlocked ? 1 : 0) }),
    getInventory: () => ({
      getItems: () => items,
      contains: (id) => items.some((entry) => entry.getId() === id),
      deleteNumber: (id) => {
        const index = items.findIndex((entry) => entry.getId() === id);
        if (index >= 0) items.splice(index, 1);
      },
      adds: (id) => items.push(item(id)),
      getFreeSlots: () => 28 - items.length,
      refreshItems() {},
    }),
  };
  return player;
}

test("a slayer helmet adds a sixth to melee accuracy and damage on task only", () => {
  const player = createPlayer({ head: ItemIdentifiers.SLAYER_HELMET });
  onTask = true;
  assert.equal(modifiers.meleeAccuracy(player, 600), 700);
  assert.equal(modifiers.meleeHit(player, 42), 49);
  assert.equal(modifiers.rangedHit(player, 40), 40);
  onTask = false;
  assert.equal(modifiers.meleeHit(player, 42), 42);
});

test("an imbued black mask also boosts Ranged and Magic by 15%", () => {
  const player = createPlayer({ head: ItemIdentifiers.BLACK_MASK_I_ });
  onTask = true;
  assert.equal(modifiers.rangedAccuracy(player, 1000), 1150);
  assert.equal(modifiers.magicHit(player, 40), 46);
  assert.equal(modifiers.meleeHit(player, 42), 49);
});

const PARTS = ["EARMUFFS", "FACEMASK", "NOSE_PEG", "SPINY_HELMET", "ENCHANTED_GEM"].map((name) => ItemIdentifiers[name]);

test("any component on another assembles the helmet, and a charged mask loses its charges", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK_7_, ...PARTS] });
  const event = { player, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.BLACK_MASK_7_, handled: false };
  assemble(event);
  assert.equal(event.handled, true);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET]);
});

test("assembly needs 55 Crafting and every component", () => {
  const low = createPlayer({ crafting: 54, inventory: [ItemIdentifiers.BLACK_MASK_I_, ...PARTS] });
  assemble({ player: low, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.FACEMASK, handled: false });
  assert.equal(low.items.length, 6);
  assert.match(low.messages[0], /Crafting level of 55/);

  const missing = createPlayer({ inventory: [ItemIdentifiers.BLACK_MASK_I_, ...PARTS.slice(1)] });
  const event = { player: missing, usedItemId: ItemIdentifiers.FACEMASK, usedWithItemId: ItemIdentifiers.NOSE_PEG, handled: false };
  assemble(event);
  assert.equal(event.handled, false);
});

test("assembly needs the Malevolent masquerade unlock", () => {
  const player = createPlayer({ helmUnlocked: false, inventory: [ItemIdentifiers.BLACK_MASK_7_, ...PARTS] });
  const event = { player, usedItemId: ItemIdentifiers.EARMUFFS, usedWithItemId: ItemIdentifiers.BLACK_MASK_7_, handled: false };
  assemble(event);
  assert.equal(event.handled, true);
  assert.equal(player.items.length, 6);
  assert.match(player.messages[0], /Malevolent masquerade/);
});

test("a scroll of imbuing turns a black mask into its imbued form, keeping its charges", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.SCROLL_OF_IMBUING, ItemIdentifiers.BLACK_MASK_7_] });
  const mask = player.items[1];
  const event = {
    player,
    usedItem: player.items[0],
    usedWithItem: mask,
    usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.BLACK_MASK_7_,
    handled: false,
  };
  imbue(event);
  assert.equal(event.handled, true);
  assert.equal(mask.getId(), ItemIdentifiers.BLACK_MASK_7_I_);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.BLACK_MASK_7_I_]);
  assert.match(player.messages.at(-1), /black mask/);

  const helmet = createPlayer({ inventory: [ItemIdentifiers.SLAYER_HELMET, ItemIdentifiers.SCROLL_OF_IMBUING_2] });
  imbue({
    player: helmet,
    usedItem: helmet.items[0],
    usedWithItem: helmet.items[1],
    usedItemId: ItemIdentifiers.SLAYER_HELMET,
    usedWithItemId: ItemIdentifiers.SCROLL_OF_IMBUING_2,
    handled: false,
  });
  assert.deepEqual(helmet.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_]);
});

test("a scroll on a component makes the imbued helmet directly", () => {
  const player = createPlayer({
    inventory: [ItemIdentifiers.BLACK_MASK, ...PARTS, ItemIdentifiers.SCROLL_OF_IMBUING],
  });
  const event = {
    player,
    usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.EARMUFFS,
    handled: false,
  };
  assemble(event);
  assert.equal(event.handled, true);
  assert.deepEqual(player.items.map((entry) => entry.getId()), [ItemIdentifiers.SLAYER_HELMET_I_]);
});

test("a scroll with no mask or helmet is left alone", () => {
  const player = createPlayer({ inventory: [ItemIdentifiers.SCROLL_OF_IMBUING, ItemIdentifiers.EARMUFFS] });
  const event = {
    player,
    usedItemId: ItemIdentifiers.SCROLL_OF_IMBUING,
    usedWithItemId: ItemIdentifiers.EARMUFFS,
    handled: false,
  };
  imbue(event);
  assert.equal(event.handled, false);
  assert.equal(player.items.length, 2);
});

test("a boosted hit does not spam chat; the stats row carries the on-task state", () => {
  const player = createPlayer({ head: ItemIdentifiers.SLAYER_HELMET });
  onTask = true;
  modifiers.meleeHit(player, 42);
  modifiers.meleeHit(player, 42);
  assert.deepEqual(player.messages, []);
  assert.equal(getTargetBonuses(player).slayer.active, true);
  onTask = false;
});

test("equipment stats shows the imbued percentages and whether the target is on task", () => {
  const player = createPlayer({ head: ItemIdentifiers.SLAYER_HELMET_I_ });
  onTask = true;
  const active = getTargetBonuses(player).slayer;
  assert.equal(active.imbued, true);
  assert.equal(active.active, true);
  assert.match(formatTargetBonus(active), /\+16\.7% melee, \+15% ranged\/magic, on task/);

  onTask = false;
  const inactive = getTargetBonuses(player).slayer;
  assert.equal(inactive.active, false);
  assert.match(formatTargetBonus(inactive), /off task/);
  onTask = true;
});

test("a worn Slayer helmet's Check is its worn option, not the inventory's Disassemble", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const helmet = {
    inventoryActions: [null, "Wear", "Check", "Disassemble", "Drop"],
    params: new Map([[453, "Check"], [454, "Partner"], [455, "Log"]]),
  };
  const option = (interfaceId, clickType) => PluginManager.itemActionOption(helmet, { interfaceId, clickType });
  assert.equal(option(Equipment.INVENTORY_INTERFACE_ID, 4), "Check");
  assert.equal(option(Equipment.INVENTORY_INTERFACE_ID, 1), null, "Remove");
  assert.equal(option(149, 4), "Disassemble");
  assert.equal(option(149, 3), "Check");
});
