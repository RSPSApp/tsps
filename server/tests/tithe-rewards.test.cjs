// Run after `yarn build`: node --test tests/tithe-rewards.test.cjs
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
require("../plugins/skills/farming/Core.Farming").init({ core });
const Data = require("../plugins/skills/farming/Data.Farming");
const Patches = require("../plugins/skills/farming/Patches.Farming");
const Tithe = require("../plugins/skills/farming/Tithe.Farming");
const ClogData = require("../plugins/collectionlog/ClogData");

let choices = [];
let obtained = [];
let originalChoose;
let originalEmit;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Data.initializeFarmingData();
  originalChoose = Patches.choose;
  originalEmit = core.PluginManager.emitCustomEvent;
  Patches.choose = (_player, entries) => { choices = entries; };
  core.PluginManager.emitCustomEvent = (name, request) => {
    if (name === "collection-log:obtain") obtained.push({ ...request });
  };
});

after(() => {
  Patches.choose = originalChoose;
  core.PluginManager.emitCustomEvent = originalEmit;
});

function player({ points = 150, full = false } = {}) {
  const attributes = new Map([["farming:state", { tithe: { points, score: 0 } }]]);
  const items = [];
  let fullCalls = 0;
  const inventory = {
    getFreeSlots: () => full ? 0 : 28,
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
    contains: (id) => items.some((item) => item.getId() === id),
    isFull: () => full,
    addItem: (item) => items.push(item),
    full: () => { fullCalls++; },
  };
  const p = {
    items,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => ({ isWithinDistance: () => true }),
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getPacketSender: () => ({ sendVarbit() { return this; } }),
    sendMessage() {},
    get points() { return attributes.get("farming:state").tithe.points; },
    get fullCalls() { return fullCalls; },
  };
  return p;
}

function openRewards(player) {
  Tithe.titheNpc({
    player,
    definition: { getName: () => "Farmer Gricoller" },
    npc: { getLocation: () => ({}) },
  });
}

test("a purchased Tithe Farm reward is logged after it is granted and paid for", () => {
  obtained = [];
  const p = player();
  openRewards(p);
  const strawhat = choices.find(([label]) => label.startsWith("Farmer's strawhat"));
  assert.ok(strawhat);
  strawhat[1]();

  const itemId = Data.itemId("Farmer's strawhat");
  assert.equal(p.items[0].getId(), itemId);
  assert.equal(p.points, 75);
  assert.deepEqual(obtained.map(({ player: eventPlayer, itemId: loggedId, amount }) => ({ eventPlayer, loggedId, amount })), [
    { eventPlayer: p, loggedId: itemId, amount: 1 },
  ]);
});

test("a failed reward grant keeps points and emits no collection-log event", () => {
  obtained = [];
  const p = player({ points: 75, full: true });
  openRewards(p);
  choices.find(([label]) => label.startsWith("Farmer's strawhat"))[1]();
  assert.equal(p.points, 75);
  assert.equal(p.fullCalls, 1);
  assert.deepEqual(obtained, []);
});

test("Auto-weed is virtual and absent from the native Tithe Farm log category", () => {
  obtained = [];
  const category = ClogData.tabs().flatMap((tab) => tab.categories).find((entry) => entry.name === "Tithe Farm");
  assert.ok(category);
  assert.equal(category.items.includes(core.ItemIdentifiers.AUTO_WEED), false);

  const p = player({ points: 50 });
  openRewards(p);
  const unlock = choices.find(([label]) => label.startsWith("Unlock Auto-weed"));
  unlock[1]();
  assert.equal(p.points, 0);
  assert.deepEqual(obtained, []);

  openRewards(p);
  choices.find(([label]) => label.startsWith("Toggle Auto-weed"))[1]();
  assert.equal(p.points, 0, "later toggles are not another unlock");
  assert.deepEqual(obtained, []);
});
