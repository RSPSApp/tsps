// Run after `yarn build`: node --test tests/pest-control-collection-log.test.cjs
// The Void Knights' reward options credit their items to the collection log, after the grant.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let Rewards, core, obtains;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  obtains = [];
  Rewards = require("../plugins/minigames/pestcontrol/Rewards.PestControl");
  Rewards.initRewards({
    core,
    emitCustomEvent: (name, event) => { if (name === "collection-log:obtain") obtains.push(event); },
  });
});

function player(points = 4000) {
  const attributes = new Map([[Rewards.POINTS_ATTRIBUTE, points]]);
  const added = [];
  const inventory = {
    items: new Map(),
    containsNumber: () => false,
    getFreeSlots: () => 28,
    getAmount(id) { return this.items.get(id) ?? 0; },
    adds(id, amount) { this.items.set(id, this.getAmount(id) + amount); added.push([id, amount]); },
  };
  return {
    added,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      addExperience: () => {},
    }),
    getInventory: () => inventory,
    getPacketSender: () => ({ sendConfig: () => {} }),
    getSession: () => ({ sendClientPacket: () => true }),
    sendMessage: (message) => { throw new Error(`unexpected refusal: ${message}`); },
  };
}

test("a Void knight top is credited to the collection log after it is added", () => {
  const p = player();
  obtains.length = 0;
  const option = Rewards._test.buildRewards().findIndex((reward) =>
    reward.pack && reward.pack().some(([id]) => id === core.ItemIdentifiers.VOID_KNIGHT_TOP));
  assert.ok(option >= 0, "the top is one of the reward options");
  assert.equal(Rewards._test.claimReward(p, option), true);
  assert.deepEqual(p.added, [[core.ItemIdentifiers.VOID_KNIGHT_TOP, 1]]);
  assert.deepEqual(obtains.map((event) => [event.itemId, event.amount]), [[core.ItemIdentifiers.VOID_KNIGHT_TOP, 1]]);
});

test("an XP reward grants no item and is not credited", () => {
  const p = player();
  obtains.length = 0;
  assert.equal(Rewards._test.claimReward(p, 0), true);
  assert.deepEqual(p.added, []);
  assert.deepEqual(obtains, []);
});
