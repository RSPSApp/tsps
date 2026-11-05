// Run after `yarn build`: node --test tests/demonic-gorillas.test.cjs
// Demonic and tortured gorillas (plugins/npcs/DemonicGorillas.plugin.js, docs/demonic-gorillas.md).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");

const Combat = require("../plugins/npcs/demonicgorillas/Combat.DemonicGorillas");
const Prayer = require("../plugins/npcs/demonicgorillas/Prayer.DemonicGorillas");
const Cavern = require("../plugins/npcs/demonicgorillas/Cavern.DemonicGorillas");
const State = require("../plugins/npcs/demonicgorillas/State.DemonicGorillas");

const core = PluginManager.getCoreApi();
const providers = [];

before(() => {
  const api = {
    core,
    registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }),
    onPlayerDealtDamage: () => {},
    onNpcHitModify: () => {},
    registerArea: () => {},
    emitCustomEvent: () => {},
  };
  Combat(api);
  Prayer(api);
  Cavern(api);
});

/** A gorilla stand-in: its id (transformations included), shouts and animations. */
function gorilla(id, { target = null } = {}) {
  const npc = {
    id, shouts: [], anims: [], target,
    isNpc: () => true,
    getId: () => npc.id,
    getRealId: () => id,
    getHitpoints: () => 380,
    setNpcTransformationId: (next) => { npc.id = next; },
    performAnimation: (animation) => npc.anims.push(animation.getId()),
    forceChat: (text) => npc.shouts.push(text),
    getCombat: () => ({ getTarget: () => npc.target }),
  };
  return npc;
}

function hit(type, damage, { bypass = false } = {}) {
  const parts = [{ damage, setDamage(value) { this.damage = value; } }];
  return {
    getCombatType: () => type,
    getHits: () => parts,
    getTotalDamage: () => parts.reduce((sum, part) => sum + part.damage, 0),
    updateTotalDamage() {},
    bypassesProtectionPrayer: () => bypass,
  };
}

test("every demonic and level 141 tortured gorilla id gets a per-attack combat method", () => {
  assert.deepEqual(providers[0].ids, [7144, 7145, 7146, 7147, 7148, 7149, 7150, 7151]);
  assert.equal(providers[0].options.singleton, false);
});

test("projectiles land when the capture says: 46 cycles, then 5 a tile (rock) or 4 (spell)", () => {
  const { projectileEnd, hitDelay } = Combat;
  assert.equal(projectileEnd({ delay: 46, cyclesPerTile: 5 }, 1), 51);
  assert.equal(projectileEnd({ delay: 46, cyclesPerTile: 4 }, 1), 50);
  // The hit shows on the first tick (30 cycles) at or after the landing (#1862).
  assert.equal(hitDelay(51), 2);
  assert.equal(hitDelay(60), 2);
  assert.equal(hitDelay(61), 3);
  for (const spec of [{ delay: 46, cyclesPerTile: 5 }, { delay: 46, cyclesPerTile: 4 }]) {
    for (const tiles of [1, 4, 10]) {
      const end = projectileEnd(spec, tiles);
      assert.ok(hitDelay(end) * 30 >= end && (hitDelay(end) - 1) * 30 < end, `${spec.cyclesPerTile}/tile, ${tiles} tiles`);
    }
  }
});

test("a boulder takes a third of the hitpoints, rounded down, and never kills", () => {
  assert.equal(Combat.boulderDamage(120), 40);
  assert.equal(Combat.boulderDamage(99), 33);
  assert.equal(Combat.boulderDamage(1), 0);
});

test("the method's style and reach follow the gorilla's fight", () => {
  const npc = gorilla(7144);
  const method = new providers[0].ctor(npc);
  State.stateOf(npc).style = "melee";
  assert.equal(method.type(), core.CombatType.MELEE);
  assert.equal(method.attackDistance(), 1);
  State.stateOf(npc).style = "magic";
  assert.equal(method.type(), core.CombatType.MAGIC);
  assert.equal(method.attackDistance(), 7);
  assert.equal(method.attackSpeed(), 5);
});

test("three misses change a demonic gorilla's style, four a tortured one's, with a scream", () => {
  for (const [id, misses] of [[7144, 3], [7150, 4]]) {
    const npc = gorilla(id);
    const state = State.stateOf(npc);
    state.style = "ranged";
    for (let i = 1; i < misses; i++) State.countMiss(npc, state);
    assert.equal(state.style, "ranged");
    State.countMiss(npc, state, () => 0.99);
    assert.notEqual(state.style, "ranged");
    assert.equal(state.misses, 0);
    assert.deepEqual(npc.shouts, ["Rhaaaaaaa!"]);
  }
});

test("a style change never picks the same style", () => {
  for (const roll of [0, 0.5, 0.99]) {
    for (const from of ["melee", "ranged", "magic"]) assert.notEqual(State.randomStyle(() => roll, from), from);
  }
});

test("its prayer stops hits in its style unless Verac's set gets through", () => {
  const npc = gorilla(7145); // _1_ranged
  assert.equal(State.protecting(npc), "ranged");
  assert.equal(Prayer.blocks(npc, hit(core.CombatType.RANGED, 20)), true);
  assert.equal(Prayer.blocks(npc, hit(core.CombatType.MELEE, 20)), false);
  assert.equal(Prayer.blocks(gorilla(7144), hit(core.CombatType.MELEE, 20, { bypass: true })), false);
});

test("four damaging hits and 70 damage off-prayer switch it to the last hit's style", () => {
  const npc = gorilla(7148); // _2_ranged
  for (const damage of [30, 30, 0, 9]) Prayer.countOffPrayer(npc, hit(core.CombatType.MELEE, damage));
  assert.equal(npc.getId(), 7148, "a zero is not a damaging hit, and 69 is short");
  Prayer.countOffPrayer(npc, hit(core.CombatType.MAGIC, 1));
  assert.equal(npc.getId(), 7149, "the same colour, protecting against Magic");
  assert.deepEqual(npc.anims, [7228]);
  assert.equal(State.stateOf(npc).offPrayerHits, 0);
});

test("in Melee with a target it can't reach, it changes style after 10 ticks", () => {
  const npc = gorilla(7150, { target: {} });
  const state = State.stateOf(npc);
  state.style = "melee";
  for (let i = 0; i < 9; i++) Cavern.ageMelee(npc);
  assert.equal(state.style, "melee");
  Cavern.ageMelee(npc);
  assert.notEqual(state.style, "melee");
  npc.target = null;
  state.style = "melee";
  for (let i = 0; i < 20; i++) Cavern.ageMelee(npc);
  assert.equal(state.style, "melee", "no target, no count");
});
