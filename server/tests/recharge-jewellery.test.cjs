const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const Recharge = require("../plugins/items/Recharge.Jewellery");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const { DIARIES } = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const TASK = Recharge._test.ARDOUGNE_HARD_TASK;
const registerLegendsQuest = require("../plugins/quests/quests/LegendsQuest.Quest");

const questApi = new Proxy({
  core: {
    ItemIdentifiers,
    ObjectIdentifiers,
    NpcIdentifiers,
    Skill: new Proxy({}, { get: () => 0 }),
  },
  persistAttribute() {},
}, {
  get(target, key) {
    if (key in target) return target[key];
    return () => {};
  },
});
registerLegendsQuest(questApi);
const legendsQuest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "legends_quest");
assert.ok(legendsQuest, "Legends' Quest registers with QuestRuntime");

function setup({ questStage = 70, usedId = ItemIdentifiers.SKILLS_NECKLACE_3_, equipment = [], objectId = ObjectIdentifiers.TOTEM_POLE_5 } = {}) {
  const attributes = new Map();
  const sent = { updates: 0, flags: 0, messages: [] };
  const makeItem = (id) => ({ getId: () => id, setId(next) { id = next; }, id: () => id });
  const inventoryItems = [makeItem(usedId)];
  const equipmentItems = equipment.map(makeItem);
  const container = (items) => ({ getItems: () => items, refreshItems() {} });
  const player = {
    getInventory: () => container(inventoryItems),
    getEquipment: () => container(equipmentItems),
    sendMessage: (text) => sent.messages.push(text),
    getUpdateFlag: () => ({ flag: () => sent.flags++ }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit() {} }),
    isRegistered: () => true,
  };
  player.setAttribute("quest.legends_quest.stage", questStage);
  const core = {
    ItemIdentifiers,
    ObjectIdentifiers,
    Flag: { APPEARANCE: 1 },
    ObjectDefinition: { forPlayer: (id) => ({ id, getName: () => "Totem Pole" }) },
    ItemDefinition: { forId: () => ({ isNoted: () => false }) },
  };
  const taskEvents = [];
  const api = {
    core,
    onItemOnObject(handler) { this.handler = handler; },
    emitCustomEvent(name, event) { if (name === "diary:task") { taskEvents.push(event); AchievementDiaries._test.onTask(event); } },
    getBonusManager: () => ({ update: () => sent.updates++ }),
  };
  Recharge(api);
  Progress({ core: {}, persistAttribute() {}, onPlayerLogin() {}, emitCustomEvent() {} });
  const event = { player, objectId, item: makeItem(usedId), handled: false };
  return {
    api, event, player, taskEvents, sent, inventoryItems, equipmentItems, attributes,
    restore() {},
  };
}

test("Legends' Guild totem recharges jewellery and records the hard diary task", () => {
  const state = setup({ equipment: [ItemIdentifiers.COMBAT_BRACELET_2_] });
  try {
    state.api.handler(state.event);
    assert.equal(state.event.handled, true);
    assert.equal(state.inventoryItems[0].id(), ItemIdentifiers.SKILLS_NECKLACE_4_);
    assert.equal(state.equipmentItems[0].id(), ItemIdentifiers.COMBAT_BRACELET_4_);
    assert.equal(state.taskEvents.length, 1);
    assert.equal(state.taskEvents[0].task, TASK);
    const diary = DIARIES.find(({ key }) => key === "ardougne");
    assert.equal(Progress.tierCount(state.player, diary, "hard"), 1);

    state.event.item = { getId: () => ItemIdentifiers.SKILLS_NECKLACE_4_ };
    state.event.objectId = ObjectIdentifiers.TOTEM_POLE_7;
    state.api.handler(state.event);
    assert.equal(state.taskEvents.length, 1, "a full recharge does not emit another task event");
    assert.equal(Progress.tierCount(state.player, diary, "hard"), 1);
  } finally {
    state.restore();
  }
});

test("a full used necklace does not block recharging eligible equipped jewellery", () => {
  const state = setup({ usedId: ItemIdentifiers.SKILLS_NECKLACE_4_, equipment: [ItemIdentifiers.COMBAT_BRACELET_2_] });
  try {
    state.api.handler(state.event);
    assert.equal(state.event.handled, true);
    assert.equal(state.inventoryItems[0].id(), ItemIdentifiers.SKILLS_NECKLACE_4_);
    assert.equal(state.equipmentItems[0].id(), ItemIdentifiers.COMBAT_BRACELET_4_);
    assert.equal(state.taskEvents.length, 1);
    const diary = DIARIES.find(({ key }) => key === "ardougne");
    assert.equal(Progress.tierCount(state.player, diary, "hard"), 1);
  } finally {
    state.restore();
  }
});

test("full jewellery, missing Legends' Quest, and unrelated totems do not earn progress", () => {
  for (const options of [
    { usedId: ItemIdentifiers.SKILLS_NECKLACE_6_ },
    { questStage: 69 },
    { usedId: ItemIdentifiers.RING_OF_WEALTH_1_ },
    { objectId: 31877 },
  ]) {
    const state = setup(options);
    try {
      state.api.handler(state.event);
      assert.equal(state.taskEvents.length, 0);
      const diary = DIARIES.find(({ key }) => key === "ardougne");
      assert.equal(Progress.tierCount(state.player, diary, "hard"), 0);
    } finally {
      state.restore();
    }
  }
});
