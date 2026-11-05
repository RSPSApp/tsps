const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Shared = require("../plugins/minigames/fishingtrawler/Shared.FishingTrawler");
const Rewards = require("../plugins/minigames/fishingtrawler/Rewards.FishingTrawler");
const CookingCommon = require("../plugins/skills/cooking/Common.Cooking");
const Cooking = require("../plugins/skills/cooking/Cookers.Cooking");

let core;
let mantaId;
let cookedMantaId;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  mantaId = core.CacheDefinitions.getObjId("raw_mantaray");
  cookedMantaId = core.CacheDefinitions.getObjId("mantaray");
});

function eventApi(events) {
  return { emitCustomEvent: (name, payload) => events.push([name, payload]) };
}

function trawlerPlayer({ room = 2, rewardCount = 2 } = {}) {
  const events = [];
  const banked = new Map();
  const attributes = new Map([[Shared.REWARD_ATTRIBUTE, { items: [[mantaId, rewardCount]], xp: 96 }]]);
  const location = new core.Location(2670, 3170, 0);
  const bank = {
    getAmount: id => banked.get(id) ?? 0,
    contains: () => false,
    getItems: () => [],
    getFreeSlots: () => 1,
    getAddableAmount: item => Math.min(item.getAmount(), room),
    add(item) { banked.set(item.getId(), this.getAmount(item.getId()) + item.getAmount()); },
  };
  const player = {
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => location,
    getBank: () => bank,
    getCurrentBankTab: () => 0,
    getInventory: () => ({ getAmount: () => 0 }),
    getEquipment: () => ({ getAmount: () => 0 }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    sendMessage() {},
  };
  Shared.bind({ core, ...eventApi(events) });
  return { player, events, banked, attributes, location };
}

test("the trawler net reports only manta rays accepted into the bank", () => {
  const f = trawlerPlayer({ room: 1 });
  Rewards.inspectNet({ player: f.player });
  assert.deepEqual(f.events.map(([name, event]) => [name, event.itemId, event.amount, event.source]), [
    ["items:obtained", mantaId, 1, "fishing-trawler"],
  ]);
  assert.deepEqual(f.events[0][1].location, f.location);
  assert.equal(f.banked.get(mantaId), 1);
  assert.deepEqual(f.attributes.get(Shared.REWARD_ATTRIBUTE).items, [[mantaId, 1]]);
});

test("a full bank reports no trawler reward as obtained", () => {
  const f = trawlerPlayer({ room: 0 });
  Rewards.inspectNet({ player: f.player });
  assert.deepEqual(f.events, []);
  assert.equal(f.banked.get(mantaId) ?? 0, 0);
  assert.deepEqual(f.attributes.get(Shared.REWARD_ATTRIBUTE).items, [[mantaId, 2]]);
});

function awardTrawlerFish(randomValues) {
  const f = trawlerPlayer({ rewardCount: 0 });
  const initialReward = f.attributes.get(Shared.REWARD_ATTRIBUTE);
  f.attributes.delete(Shared.REWARD_ATTRIBUTE);
  const api = eventApi(f.events);
  Shared.bind({ core, emitCustomEvent(name, payload) {
    if (name === "fishing-trawler:catch-awarded") {
      assert.notEqual(f.attributes.get(Shared.REWARD_ATTRIBUTE), initialReward);
      assert.ok(f.attributes.has(Shared.REWARD_ATTRIBUTE));
    }
    api.emitCustomEvent(name, payload);
  } });
  const voyage = { contribution: new Map([[f.player, 50]]), shareFor: () => 1 };
  let index = 0;
  const reward = Rewards.award(f.player, voyage, () => randomValues[index++] ?? 0.99);
  return { ...f, reward };
}

test("a generated manta catch emits an immutable fish snapshot before net collection", () => {
  const f = awardTrawlerFish([0, 0.3, 0.99]);
  const [name, event] = f.events.find(([type]) => type === "fishing-trawler:catch-awarded");
  assert.equal(name, "fishing-trawler:catch-awarded");
  assert.deepEqual(event.fish, [{ itemId: mantaId, amount: 1 }]);
  assert.equal(Object.isFrozen(event.fish), true);
  assert.equal(Object.isFrozen(event.fish[0]), true);
  assert.equal(f.banked.get(mantaId) ?? 0, 0);

  Rewards.inspectNet({ player: f.player });
  Rewards.inspectNet({ player: f.player });
  assert.equal(f.events.filter(([type]) => type === "fishing-trawler:catch-awarded").length, 1);
  assert.equal(f.events.filter(([type]) => type === "items:obtained").length, 1);
});

test("a generated non-manta catch does not include a manta fish", () => {
  const f = awardTrawlerFish([0.99, 0.3, 0.99]);
  const event = f.events.find(([type]) => type === "fishing-trawler:catch-awarded")[1];
  assert.ok(event.fish.length > 0);
  assert.equal(event.fish.some(({ itemId }) => itemId === mantaId), false);
  assert.equal(f.reward.items.some(([itemId]) => itemId === mantaId), false);
});

function cookScene({ burn = false, acceptOutput = true } = {}) {
  const events = [];
  const items = new Map([[mantaId, 1]]);
  const attributes = new Map();
  let xp = 0;
  const location = new core.Location(3200, 3201, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    getItems: () => [new core.Item(mantaId, 1)],
    deleteNumber(id, amount) { items.set(id, Math.max(0, this.getAmount(id) - amount)); },
    getAddableAmount(item) {
      return acceptOutput && this.getAmount(mantaId) === 0 ? item.getAmount() : 0;
    },
    addItem(item) {
      if (acceptOutput || item.getId() === mantaId) {
        items.set(item.getId(), this.getAmount(item.getId()) + item.getAmount());
      }
    },
  };
  const player = {
    getInventory: () => inventory,
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit() {}, sendTypedMessage() {} }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences(_skill, amount) { xp += amount; } }),
  };
  CookingCommon.init({ core, emitCustomEvent(name, payload) {
    events.push([name, payload]);
    if (name === "skillcape:has-perk") payload.result = !burn;
    if (name === "cooking:burn") payload.burn = burn;
  } });
  const cookable = { raw: mantaId, cooked: cookedMantaId, burnt: -2, name: "manta ray", level: 1, stopBurn: 99, xp: 1 };
  Cooking._test.cookOne(player, { cookable, objectId: -1, location });
  return { events, items, location, get xp() { return xp; } };
}

test("successful cooking reports the granted output, raw fish and cooker location", () => {
  const f = cookScene();
  const [name, event] = f.events.find(([type]) => type === "items:obtained");
  assert.equal(name, "items:obtained");
  assert.equal(event.rawId, mantaId);
  assert.equal(event.itemId, cookedMantaId);
  assert.equal(event.amount, 1);
  assert.equal(event.source, "cooking");
  assert.deepEqual(event.location, f.location);
  const success = f.events.find(([type]) => type === "cooking:success")[1];
  assert.equal(success.rawId, mantaId);
  assert.equal(success.itemId, cookedMantaId);
  assert.equal(success.amount, 1);
  assert.deepEqual(success.location, f.location);
  assert.equal(f.items.get(cookedMantaId), 1);
});

test("burns and unaccepted cooked output do not report an obtained item", () => {
  assert.equal(cookScene({ burn: true }).events.some(([name]) => name === "items:obtained"), false);
  const failedGrant = cookScene({ acceptOutput: false });
  assert.equal(failedGrant.events.some(([name]) => name === "items:obtained"), false);
  assert.equal(failedGrant.events.some(([name]) => name === "cooking:success"), false);
  assert.equal(failedGrant.events.some(([name]) => name === "skills:produced"), false);
  assert.equal(failedGrant.xp, 0);
  assert.equal(failedGrant.items.get(mantaId), 1);
  assert.equal(failedGrant.items.get(cookedMantaId) ?? 0, 0);
});

function realInventoryCook({ rejectOutput = false } = {}) {
  const events = [];
  const location = new core.Location(3200, 3201, 0);
  const player = {
    getUsername: () => "cooking-test",
    getPacketSender: () => ({ sendItemContainer() {}, sendVarbit() {}, sendTypedMessage() {} }),
    getInterfaceId: () => -1,
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences() {} }),
    getAttribute: () => undefined,
    setAttribute() {},
  };
  const inventory = new core.Inventory(player);
  const rawMeta = { preset: true, origin: { slot: 4 } };
  inventory.setItem(0, new core.Item(mantaId, 1, rawMeta));
  for (let slot = 1; slot < inventory.capacity(); slot++) {
    inventory.setItem(slot, new core.Item(mantaId, 1));
  }
  if (rejectOutput) inventory.getAddableAmount = () => 0;
  player.getInventory = () => inventory;
  CookingCommon.init({ core, emitCustomEvent(name, payload) {
    events.push([name, payload]);
    if (name === "skillcape:has-perk") payload.result = false;
    if (name === "cooking:burn") payload.burn = false;
  } });
  const cookable = { raw: mantaId, cooked: cookedMantaId, burnt: -2, name: "manta ray", level: 1, stopBurn: 99, xp: 1 };
  Cooking._test.cookOne(player, { cookable, objectId: -1, location });
  return { events, inventory, rawMeta };
}

test("a full real inventory frees the raw slot for cooked food", () => {
  assert.equal(core.ItemDefinition.forId(cookedMantaId).isStackable(), false);
  const f = realInventoryCook();
  assert.equal(f.inventory.capacity(), 28);
  assert.equal(f.inventory.getAmount(mantaId), 27);
  assert.equal(f.inventory.getAmount(cookedMantaId), 1);
  assert.equal(f.events.some(([name]) => name === "cooking:success"), true);
});

test("a rejected output restores the original raw item metadata in a real inventory", () => {
  const f = realInventoryCook({ rejectOutput: true });
  assert.equal(f.inventory.getAmount(mantaId), 28);
  assert.equal(f.inventory.getAmount(cookedMantaId), 0);
  assert.deepEqual(f.inventory.getItems().find(item => item.getId() === mantaId).getMeta(), f.rawMeta);
  assert.equal(f.events.some(([name]) => name === "cooking:success"), false);
  assert.equal(f.events.some(([name]) => name === "skills:produced"), false);
});
