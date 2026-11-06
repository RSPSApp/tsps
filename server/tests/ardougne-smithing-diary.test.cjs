const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Smithing = require("../plugins/skills/Smithing.plugin");
const Data = require("../plugins/skills/smithing/Data.Smithing");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const DiaryPlugin = require("../plugins/achievements/diaries/ArdougneSmithingDiary.plugin");

let core;
let objectActions;
let itemOnObjects;
let events;
let tasks;
let interfaceButtons;
let diary;
const { MITHRIL_PLATEBODY_TASK, DRAGON_SQ_SHIELD_TASK, ANVIL_OBJECT_ID } = DiaryPlugin._test;

function setup() {
  events = new Map();
  tasks = [];
  interfaceButtons = new Map();
  objectActions = new Map();
  itemOnObjects = [];
  const startups = [];
  const diaryEvents = [];
  const api = new Proxy({
    core,
    persistAttribute() {},
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    onPlayerLogin() {},
    onPlayerDisconnect() {},
    onServerStartup(handler) { startups.push(handler); },
    onItemOnObject(handler) { itemOnObjects.push(handler); },
    onItemOnItem() {},
    onSpellOnItem() {},
    onItemAction() {},
    onObjectInteraction(name, actions) { objectActions.set(name, actions); },
    onInterfaceActionButton(ids, handler) {
      for (const id of ids) interfaceButtons.set(id, handler);
    },
    onCustomEvent(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === "quest:is-started") event.started = event.player.plagueCityStarted === true;
      if (name === "quest:is-complete") event.complete = false;
      if (name === "diary:task") diaryEvents.push(event);
      for (const handler of events.get(name) ?? []) handler(event);
    },
    log() {},
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  DiaryPlugin.register(api);
  Smithing.register(api);
  for (const startup of startups) startup();
  return { api, diaryEvents };
}

function playerAt(x, y, items = new Map()) {
  const sender = new Proxy({}, { get: () => () => sender });
  const player = {
    items,
    attributes: {},
    level: 99,
    xp: 0,
    messages: [],
    spam: [],
    statements: [],
    interfaceId: -1,
    isRegistered: () => true,
    getHitpoints: () => 99,
    isDyingReturn: () => false,
    getPrivateArea: () => null,
    getLocation: () => new core.Location(player.x, player.y, player.z),
    getTeleportSerial: () => 0,
    getArea: () => null,
    x, y, z: 0,
    getInventory: () => ({
      contains: (id) => (items.get(id) ?? 0) > 0,
      getAmount: (id) => items.get(id) ?? 0,
      deleteNumber: (id, amount) => items.set(id, (items.get(id) ?? 0) - amount),
      addItem: (item) => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getEquipment: () => ({ contains: () => false, get: () => null }),
    getAttribute: (key) => player.attributes[key],
    setAttribute: (key, value) => { player.attributes[key] = value; },
    getSkillManager: () => ({
      getCurrentLevel: () => player.level,
      addExperiences: (_skill, xp) => { player.xp += xp; },
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.statements.push(chain), reset() {} }),
    getPacketSender: () => sender,
    getInterfaceId: () => player.interfaceId,
    setInterfaceId: (id) => { player.interfaceId = id; },
    setEnteredAmountAction: () => {},
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    performAnimation() {},
    sendMessage: (message) => player.messages.push(message),
  };
  return player;
}

function anvil(x, y, id = ANVIL_OBJECT_ID) {
  return {
    getId: () => id,
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }),
    getDefinition: () => ({ getName: () => "Anvil" }),
  };
}

function tick(count) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) if (!task.tick()) tasks.splice(tasks.indexOf(task), 1);
  }
}

function continueDialogue(player) {
  for (const dialogue of player.statements.at(-1).getDialogues().values()) dialogue.action?.execute?.();
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
});

test("smithing a mithril platebody at each listed nearby anvil records the hard task through diary progress", () => {
  const { diaryEvents } = setup();
  const product = Data.productsFor(core.ItemIdentifiers.MITHRIL_BAR)
    .find(({ itemId }) => itemId === core.ItemIdentifiers.MITHRIL_PLATEBODY);
  assert.ok(product);
  const buttonId = (312 << 16) | product.component;
  const buttonHandler = interfaceButtons.get(buttonId);
  assert.equal(typeof buttonHandler, "function");
  const allowed = [[2650, 3164], [2652, 3164], [2652, 3166], [2613, 3078], [2613, 3081], [2616, 3081], [2499, 3332], [2501, 3330]];

  for (const [x, y] of allowed) {
    const player = playerAt(x - 1, y, new Map([[core.ItemIdentifiers.HAMMER, 1], [core.ItemIdentifiers.MITHRIL_BAR, 5]]));
    objectActions.get("Anvil").Smith({ player, object: anvil(x, y) });
    buttonHandler({ player, buttonId });
    tick(4);
    assert.equal(player.items.get(core.ItemIdentifiers.MITHRIL_PLATEBODY), 1);
    assert.ok(Progress.doneTasks(player, diary).has(MITHRIL_PLATEBODY_TASK), `${x},${y}`);
  }
  assert.equal(diaryEvents.filter(({ task }) => task === MITHRIL_PLATEBODY_TASK).length, allowed.length);
});

test("a failed mithril platebody attempt does not record the hard task", () => {
  setup();
  const product = Data.productsFor(core.ItemIdentifiers.MITHRIL_BAR)
    .find(({ itemId }) => itemId === core.ItemIdentifiers.MITHRIL_PLATEBODY);
  const buttonId = (312 << 16) | product.component;
  const player = playerAt(2498, 3332, new Map([[core.ItemIdentifiers.MITHRIL_BAR, 5]]));

  objectActions.get("Anvil").Smith({ player, object: anvil(2499, 3332) });
  interfaceButtons.get(buttonId)({ player, buttonId });
  tick(4);

  assert.equal(player.items.has(core.ItemIdentifiers.MITHRIL_PLATEBODY), false);
  assert.equal(Progress.doneTasks(player, diary).has(MITHRIL_PLATEBODY_TASK), false);
});

test("mithril platebody credit rejects other tiles, items, wrong object ids, and invalid source context", () => {
  const { api } = setup();
  const player = playerAt(2498, 3332);
  const fire = (overrides = {}) => api.emitCustomEvent("smithing:success", {
    player, skill: core.Skill.SMITHING, itemId: core.ItemIdentifiers.MITHRIL_PLATEBODY,
    source: "anvil", objectId: ANVIL_OBJECT_ID, location: { x: 2499, y: 3332, z: 0 }, ...overrides,
  });

  fire({ location: { x: 2498, y: 3332, z: 0 } });
  fire({ itemId: core.ItemIdentifiers.MITHRIL_BAR });
  fire({ objectId: ANVIL_OBJECT_ID + 1 });
  fire({ source: undefined });
  fire({ location: { x: 2499, y: 3332, z: 1 } });
  fire({ player: playerAt(2490, 3332) });
  fire({ player: Object.assign(playerAt(2498, 3332), { z: 1 }) });
  fire({ player: Object.assign(playerAt(2498, 3332), { getPrivateArea: () => ({}) }) });
  assert.equal(Progress.doneTasks(player, diary).has(MITHRIL_PLATEBODY_TASK), false);
});

test("dragon sq shield credit requires a successful West Ardougne repair and started Plague City", () => {
  const { diaryEvents } = setup();
  const west = anvil(2499, 3332);
  const player = playerAt(2498, 3332, new Map([[core.ItemIdentifiers.HAMMER, 1], [core.ItemIdentifiers.SHIELD_LEFT_HALF, 1], [core.ItemIdentifiers.SHIELD_RIGHT_HALF, 1]]));
  player.plagueCityStarted = true;
  const event = { player, itemId: core.ItemIdentifiers.SHIELD_LEFT_HALF, object: west };
  for (const handler of itemOnObjects) handler(event);
  continueDialogue(player);
  tick(7);
  continueDialogue(player);
  assert.equal(player.items.get(core.ItemIdentifiers.DRAGON_SQ_SHIELD), 1);
  assert.ok(Progress.doneTasks(player, diary).has(DRAGON_SQ_SHIELD_TASK));
  assert.equal(diaryEvents.filter(({ task }) => task === DRAGON_SQ_SHIELD_TASK).length, 1);
});

test("dragon sq shield failures, other areas, missing quest start, and legacy events do not credit", () => {
  const { api } = setup();
  const player = playerAt(2498, 3332);
  const failedRepair = { player, itemId: core.ItemIdentifiers.SHIELD_LEFT_HALF, object: anvil(2499, 3332) };
  for (const handler of itemOnObjects) handler(failedRepair);
  assert.equal(Progress.doneTasks(player, diary).has(DRAGON_SQ_SHIELD_TASK), false);

  const fire = (overrides = {}) => api.emitCustomEvent("smithing:success", {
    player, skill: core.Skill.SMITHING, itemId: core.ItemIdentifiers.DRAGON_SQ_SHIELD,
    source: "anvil", objectId: ANVIL_OBJECT_ID, location: { x: 2499, y: 3332, z: 0 }, ...overrides,
  });
  fire();
  player.plagueCityStarted = true;
  fire({ location: { x: 2650, y: 3164, z: 0 } });
  fire({ itemId: core.ItemIdentifiers.SHIELD_LEFT_HALF });
  fire({ source: undefined });
  assert.equal(Progress.doneTasks(player, diary).has(DRAGON_SQ_SHIELD_TASK), false);
});
