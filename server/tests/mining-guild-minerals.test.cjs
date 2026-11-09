// Unidentified minerals: Belona's toggle, the two dialogue branches that flip it, and the per-rock
// roll inside the members' area. The shop that spends them is data, so it is not covered here.
//
// Run after `yarn build`: node --test tests/mining-guild-minerals.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

const BELONA = 7719;
const IRON_ORE = 440;
const RUNITE_ORE = 451;
const MEMBERS_TILE = { getX: () => 3000, getY: () => 9700, getZ: () => 0 };
const OUTSIDE_TILE = { getX: () => 3000, getY: () => 3000, getZ: () => 0 };

let plugin;
let handlers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  plugin = require("../plugins/areas/MiningGuild.plugin");
  handlers = {};
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onCustomEvent: (name, fn) => { (handlers[name] ??= []).push(fn); },
    onNpcInteraction: (name, options) => { handlers[`npc:${name}`] = options; },
    onNpcDialogueCondition: (fn) => { handlers.condition = fn; },
    persistAttribute: noop,
  }, { get: (target, key) => target[key] ?? noop });
  plugin.register(api);
});

function player(attributes = new Map()) {
  const messages = [];
  const added = [];
  return {
    messages,
    added,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    getLocation: () => MEMBERS_TILE,
    getInventory: () => ({ forceAdd: (_player, item) => added.push(item.getId()) }),
  };
}

const roll = (p, itemId, location = MEMBERS_TILE) => plugin._test.rollMinerals({ player: p, itemId, location });

test("the toggle is on until Belona turns it off, and says so both ways", () => {
  const p = player();
  assert.equal(plugin._test.mineralsEnabled(p), true, "receiving is the default");
  plugin._test.toggleMinerals({ player: p });
  assert.equal(plugin._test.mineralsEnabled(p), false);
  assert.deepEqual(p.messages, ["You will no longer receive unidentified minerals when you mine here."]);
  plugin._test.toggleMinerals({ player: p });
  assert.equal(plugin._test.mineralsEnabled(p), true);
  assert.equal(p.messages.at(-1), "You will now receive unidentified minerals when you mine here.");
});

test("the dialogue branches are answered from the toggle, and only for Belona", () => {
  const p = player();
  const on = { npcId: BELONA, player: p, text: "If the player is currently receiving unidentified minerals:" };
  const off = { npcId: BELONA, player: p, text: "If the player is currently not receiving unidentified minerals:" };
  assert.equal(plugin._test.answerMineralCondition(on), true);
  assert.equal(plugin._test.answerMineralCondition(off), false);
  plugin._test.setMinerals(p, false);
  assert.equal(plugin._test.answerMineralCondition(on), false);
  assert.equal(plugin._test.answerMineralCondition(off), true);
  assert.equal(plugin._test.answerMineralCondition({ ...on, npcId: 1 }), null, "another NPC is not answered");
});

test("choosing either dialogue branch flips the toggle", () => {
  const p = player();
  plugin._test.chooseMinerals({ player: p, npcId: BELONA, option: "I don't want to receive minerals." });
  assert.equal(plugin._test.mineralsEnabled(p), false);
  plugin._test.chooseMinerals({ player: p, npcId: BELONA, option: "I'd like to receive minerals." });
  assert.equal(plugin._test.mineralsEnabled(p), true);
});

test("a successful roll in the members' area grants a mineral and says the Wiki line", () => {
  const p = player();
  const original = Math.random;
  Math.random = () => 0;
  try {
    roll(p, IRON_ORE);
  } finally {
    Math.random = original;
  }
  assert.deepEqual(p.added, [plugin._test.MINERAL_ITEM]);
  assert.deepEqual(p.messages, ["You find some minerals while you mine."]);
});

test("a missed roll, a rock outside the area, a noted ore and a disabled toggle all grant nothing", () => {
  const original = Math.random;
  Math.random = () => 0.999;
  try {
    const missed = player();
    roll(missed, IRON_ORE);
    assert.deepEqual(missed.added, [], "a missed roll grants nothing");

    Math.random = () => 0;
    const outside = player();
    roll(outside, IRON_ORE, OUTSIDE_TILE);
    assert.deepEqual(outside.added, [], "the roll is members' area only");

    const noted = player();
    roll(noted, IRON_ORE + 1);
    assert.deepEqual(noted.added, [], "a noted ore id is not a rock");

    const disabled = player();
    plugin._test.setMinerals(disabled, false);
    roll(disabled, RUNITE_ORE);
    assert.deepEqual(disabled.added, [], "the toggle stops the roll");
  } finally {
    Math.random = original;
  }
});

test("the registered handlers are the ones the plugin manager will call", () => {
  assert.equal(typeof handlers["npc:Belona"]?.["Toggle-minerals"], "function");
  assert.equal(typeof handlers.condition, "function");
  assert.equal(handlers["mining:success"]?.length, 1);
  assert.equal(handlers["npc-dialogue:choice"]?.length, 1);

  // Drive the captured handlers rather than the exported functions: this is the wiring the server
  // uses, so a renamed event or a handler registered on the wrong name fails here.
  const p = player();
  const original = Math.random;
  Math.random = () => 0;
  try {
    handlers["mining:success"][0]({ player: p, itemId: IRON_ORE, location: MEMBERS_TILE });
  } finally {
    Math.random = original;
  }
  assert.deepEqual(p.added, [plugin._test.MINERAL_ITEM], "mining:success reaches the roll");

  handlers["npc:Belona"]["Toggle-minerals"]({ player: p, npcId: BELONA });
  assert.equal(plugin._test.mineralsEnabled(p), false, "the right-click option reaches the toggle");
  handlers["npc-dialogue:choice"][0]({ player: p, npcId: BELONA, option: "I'd like to receive minerals." });
  assert.equal(plugin._test.mineralsEnabled(p), true, "the dialogue choice reaches the toggle");
});
