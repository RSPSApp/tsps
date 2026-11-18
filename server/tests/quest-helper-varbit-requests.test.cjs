// The headless path must answer the bridge's state requests, or the first step that reads a puzzle
// varbit comes back as `activeStep: null` and looks like a quest defect. This drives the real
// producer (Ernest the Chicken's lever handler), the real cache bit layout, and the real request
// loop, and asserts on the exact payload the bridge receives.
//
// Run after `yarn build`: node --test tests/quest-helper-varbit-requests.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { QuestHelperRuntime } = require("../plugins/quests/questhelper/Runtime.QuestHelper");
const { collectQuestHelperSnapshot } = require("../plugins/quests/questhelper/Snapshot.QuestHelper");
const { fillRequested } = require("../plugins/quests/questhelper/Requests.QuestHelper");

// varp "ernestlever": levers A-F are bits 1-6, so lever A is varbit 1788 at bit 1.
const VARP_LEVERS = 33;
const VARBIT_LEVER_A = 1788;
const LEVER_A_OBJECT = 146;
// ErnestTheChicken.java checks A/E first, then B/C/D/F/E. Conditions.check() evaluates every child
// (no short-circuit) and SnapshotClient.varbit() throws on the first missing id, so one evaluation
// asks for these one at a time, in this order. A single tool call has to walk all six.
const LEVER_VARBITS = [1788, 1792, 1789, 1790, 1791, 1793];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

/** Runs the real Ernest lever handler and returns the varps it published. */
function pullLeverA() {
  const configs = [];
  const attributes = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key) ?? 0,
    setAttribute: (key, value) => attributes.set(key, value),
    // The lever also plays its recorded sounds; only the varps matter here.
    getPacketSender: () => ({ sendConfig: (varp, value) => configs.push({ varp, value }), sendSoundEffect: () => {} }),
    // Inside the basement's bounds, so the lever/door visuals are published too.
    getLocation: () => ({ getX: () => 3115, getY: () => 9755, getZ: () => 0 }),
    performAnimation: () => {},
    sendMessage: () => {},
  };
  const noop = () => {};
  const registered = [];
  // The real plugin, registered through the real core with every hook a no-op.
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (fn) => registered.push(fn),
  }, { get: (target, key) => target[key] ?? noop });
  require("../plugins/quests/quests/ErnestTheChicken.Quest.js")(api);
  const handler = registered.at(-1);
  assert.equal(typeof handler, "function", "the quest registers an object interaction handler");
  const event = {
    player, objectId: LEVER_A_OBJECT, clickType: 1, location: player.getLocation(),
    definition: { getInteractions: () => ["Pull"] },
  };
  handler(event);
  assert.equal(event.handled, true, "the lever click is claimed by the quest");
  return configs;
}

/** The server's own reader: PacketSender.getVarbit over the published varps. */
function readerFor(configs) {
  const varps = new Map(configs.map((config) => [config.varp, config.value]));
  return {
    varbit: (id) => {
      const definition = CacheDefinitions.getVarbit(id);
      if (!definition) return Number.NaN;
      const value = varps.get(definition.baseVar) ?? 0;
      const width = definition.endBit - definition.startBit;
      return (value >>> definition.startBit) & (-1 >>> (31 - width));
    },
    definition: (id) => CacheDefinitions.getVarbit(id),
  };
}

const bridgeReply = (request) => ({
  protocol: 1, session: request.session, sequence: request.sequence, questKey: request.questKey,
  sourceCommit: "pinned", status: "active", activeStep: { id: "getCan", text: ["Pull the levers"] },
  panels: [], diagnostics: [], requests: [],
});

function playerFixture(configs) {
  return {
    getIndex: () => 7,
    getUsername: () => "Fixture",
    getAttribute: () => 0,
    getLocation: () => ({ getX: () => 3115, getY: () => 9755, getZ: () => 0 }),
    getInventory: () => ({ getItems: () => [] }),
    getEquipment: () => ({ getItems: () => [] }),
    getPacketSender: () => readerFor(configs),
    getSkillManager: () => ({ getMaxLevel: () => 1, getCurrentLevel: () => 1, getExperience: () => 0 }),
    getFrameUpdater: () => ({ interfaceTextMap: new Map() }),
  };
}

const sceneDeps = {
  nearby: () => ({ npcs: [], objects: [], groundItems: [] }),
  items: () => [],
  skills: () => ({ HITPOINTS: { real: 10, boosted: 10, xp: 1154 } }),
  tick: () => 1,
};
const quest = {
  key: "ernest_the_chicken", name: "Ernest the Chicken", varpId: 32, getStage: () => 1,
  isStarted: () => true, isComplete: () => false, varpValue: () => 1,
};

test("a lever varbit the helper asks for is recovered from the real producer", async () => {
  const configs = pullLeverA();
  const varpLevers = configs.find((config) => config.varp === VARP_LEVERS);
  assert.equal(varpLevers.value, 2, "lever A publishes varp 33 bit 1");

  const read = readerFor(configs);
  const cacheDefinition = CacheDefinitions.getVarbit(VARBIT_LEVER_A);
  assert.deepEqual(
    { baseVar: cacheDefinition.baseVar, startBit: cacheDefinition.startBit, endBit: cacheDefinition.endBit },
    { baseVar: VARP_LEVERS, startBit: 1, endBit: 1 },
    "the cache puts ERNESTLEVER_A at varp 33 bit 1",
  );
  assert.equal(read.varbit(VARBIT_LEVER_A), 1, "the server's reader sees the lever as pulled");

  const player = playerFixture(configs);
  const snapshot = collectQuestHelperSnapshot(sceneDeps, player, { radius: 8 });
  assert.equal(snapshot.varbits[VARBIT_LEVER_A], undefined, "the plain snapshot omits it");

  const calls = [];
  const bridge = {
    catalog: async () => ({ quests: [{ questKey: quest.key, supported: true }] }),
    close: async () => {},
    evaluate: async (request) => {
      calls.push(request);
      // Exactly what the pinned helper does: read the lever varbits in its own order, and ask for
      // the first one the snapshot is missing.
      for (const id of LEVER_VARBITS) {
        const value = request.snapshot.varbits[id];
        if (value === undefined) return {
          protocol: 1, status: "unavailable", activeStep: null,
          diagnostics: [{ code: "MISSING_STATE", method: "varbit", message: `Snapshot requires varbit ${id}` }],
          requests: [{ kind: "varbit", id }, { kind: "varbitDefinition", id }],
        };
      }
      return bridgeReply(request);
    },
  };
  const runtime = new QuestHelperRuntime({
    getQuests: () => [quest], bridge, send: () => {},
    varbitDefinition: (id) => CacheDefinitions.getVarbit(id),
    contract: () => null,
    fillRequests: (p, requests, state) => fillRequested(state, requests, readerFor(configs)),
  });
  const result = await runtime.evaluateHeadless(player, { questKey: quest.key, snapshot });

  assert.equal(calls.length, LEVER_VARBITS.length + 1, "one round per lever, then the answer");
  const last = calls.at(-1).snapshot;
  for (const id of LEVER_VARBITS) {
    const expected = id === VARBIT_LEVER_A ? 1 : 0;
    assert.equal(last.varbits[id], expected, `varbit ${id} is present in the final request`);
    const definition = last.varbitDefinitions[id];
    assert.ok(definition, `varbit ${id} definition is present`);
    // The bridge reads a varbit as (varp >>> lsb) & mask, so the packed varp must agree.
    const packed = (last.varps[definition.varp] >>> definition.lsb) & (-1 >>> (31 - (definition.msb - definition.lsb)));
    assert.equal(packed, expected, `packed varp ${definition.varp} reads back ${id} as ${expected}`);
  }
  assert.equal(result.activeStep.id, "getCan", "the step survives instead of coming back unavailable");
  assert.equal(result.requestsFilled, LEVER_VARBITS.length);

  // A second call starts from an empty snapshot again, but the discovered values are remembered
  // and refreshed from the server, so the chain is not walked twice.
  const before = calls.length;
  const second = await runtime.evaluateHeadless(player, {
    questKey: quest.key, snapshot: collectQuestHelperSnapshot(sceneDeps, player, { radius: 8 }),
  });
  assert.equal(calls.length, before + 1, "the second call evaluates once");
  assert.equal(calls.at(-1).snapshot.varbits[VARBIT_LEVER_A], 1, "and still carries the lever value");
  assert.equal(second.requestsFilled, undefined, "nothing left to fill");
});
