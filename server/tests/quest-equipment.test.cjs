// Run after `yarn build`: node --test tests/quest-equipment.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");
const attachEquipment = require("../plugins/quests/Equipment.Quests");

const WIELD = new Set([Items.DRAGON_SCIMITAR, Items.DRAGON_HALBERD]);
const world = { pluginConfig: {}, pvpMode: false, complete: new Map(), canEquip: null };

attachEquipment({
  core: {
    ItemIdentifiers: Items,
    CacheDefinitions: { getItem: (id) => ({ inventoryActions: [null, WIELD.has(id) ? "Wield" : "Wear"] }) },
  },
  onCanEquip: (handler) => { world.canEquip = handler; },
  onCustomEvent: (_name, handler) => { world.checkEquipment = handler; },
  getPluginConfig: (key, fallback) => world.pluginConfig[key] ?? fallback,
  emitCustomEvent(name, request) {
    if (name === "pvp-mode:is-enabled" && world.pvpMode) request.enabled = true;
    if (name === "quest:is-complete" && world.complete.has(request.name)) request.complete = world.complete.get(request.name);
  },
});

function equip(itemId, { bot = false } = {}) {
  const messages = [];
  const player = { sendMessage: (text) => messages.push(text), isPlayerBot: () => bot };
  const event = { player, slot: 3, item: { getId: () => itemId }, allow: null };
  world.canEquip(event);
  return { allow: event.allow, messages };
}

function reset({ equipmentRequirements, pvpMode = false, complete = {} } = {}) {
  world.pluginConfig = equipmentRequirements === undefined ? {} : { "quests:equipment-requirements": equipmentRequirements };
  world.pvpMode = pvpMode;
  world.complete = new Map(Object.entries(complete));
}

test("every listed item resolves to an id", () => {
  assert.ok(attachEquipment._test.requirements().size > 90);
});

test("a rune platebody without Dragon Slayer I is refused with live OSRS's two lines", () => {
  reset({ complete: { "Dragon Slayer I": false } });
  assert.deepEqual(equip(Items.RUNE_PLATEBODY), {
    allow: false,
    messages: ["You have not earned the right to wear this yet.", "You need to complete the Dragon Slayer I quest first."],
  });
});

test("quest equipment requirements default to enabled even in PvP mode", () => {
  reset({ pvpMode: true, complete: { "Lost City": false } });
  assert.equal(equip(Items.DRAGON_DAGGER).allow, false);
});

test("the config can enable requirements independently of PvP mode", () => {
  for (const pvpMode of [false, true]) {
    reset({ equipmentRequirements: true, pvpMode, complete: { "Lost City": false } });
    assert.equal(equip(Items.DRAGON_DAGGER).allow, false);
  }
});

test("the config can disable requirements independently of PvP mode", () => {
  for (const pvpMode of [false, true]) {
    reset({ equipmentRequirements: false, pvpMode, complete: { "Lost City": false } });
    assert.deepEqual(equip(Items.DRAGON_DAGGER), { allow: null, messages: [] });
  }
});

test("a weapon says wield", () => {
  reset({ complete: { "Monkey Madness I": false } });
  assert.equal(equip(Items.DRAGON_SCIMITAR).messages[0], "You have not earned the right to wield this yet.");
});

test("the quest done, the item goes on", () => {
  reset({ complete: { "Monkey Madness I": true } });
  assert.deepEqual(equip(Items.DRAGON_SCIMITAR), { allow: null, messages: [] });
});

test("an item's own message replaces the two lines", () => {
  reset({ complete: { "Zogre Flesh Eaters": false } });
  assert.deepEqual(equip(Items.INOCULATION_BRACELET).messages, [
    "You need to have completed the Zogre Flesh Eaters quest to wear a bracelet of inoculation.",
  ]);
});

test("bots and ungated items are left alone", () => {
  reset({ complete: { "Lost City": false } });
  assert.equal(equip(Items.DRAGON_DAGGER, { bot: true }).allow, null);
  assert.equal(equip(Items.DRAGON_DAGGER_3).allow, null);
  assert.equal(equip(Items.RUNE_CHAINBODY).allow, null);
});

test("disabled or missing quests leave equipment wearable with requirements enabled", () => {
  reset({ equipmentRequirements: true });
  assert.deepEqual(equip(Items.DRAGON_DAGGER), { allow: null, messages: [] });
});

test("quest eligibility queries return refusal text without messaging or equipping the player", () => {
  reset({ complete: { "Lost City": false } });
  const request = {
    player: { sendMessage: () => assert.fail("a query must not send messages") },
    item: { getId: () => Items.DRAGON_DAGGER }, allow: true, messages: [],
  };
  world.checkEquipment(request);
  assert.equal(request.allow, false);
  assert.equal(request.messages[1], "You need to complete the Lost City quest first.");
  reset({ equipmentRequirements: false, complete: { "Lost City": false } });
  request.allow = true;
  request.messages = [];
  world.checkEquipment(request);
  assert.equal(request.allow, true);
  assert.deepEqual(request.messages, []);
});
