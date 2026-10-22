// Run after `yarn build`: node --test tests/arceuus-reanimation-resurrect.test.cjs
// Reanimation and Resurrect animate as in rsprox captures of live OSRS.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ArceuusItemSpells } = require("../dist/game/content/combat/magic/ArceuusItemSpells");
const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");
const { ArceuusThralls } = require("../dist/game/content/combat/magic/ArceuusThralls");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const seq = (name) => CacheDefinitions.getSeqId(name);
const spotanim = (name) => CacheDefinitions.getSpotanimId(name);

/** Replaces `object[key]` with `value` while `run` runs. */
function withStub(object, key, value, run) {
  const original = object[key];
  object[key] = value;
  try {
    return run();
  } finally {
    object[key] = original;
  }
}

/** A mobile that records the animations and graphics it is given. */
function recorder(extra = {}) {
  return {
    animations: [],
    graphics: [],
    performAnimation(animation) { this.animations.push(animation.getId()); },
    performGraphic(graphic) { this.graphics.push(graphic.getId()); },
    ...extra,
  };
}

test("Reanimation casts arceuus_necromancy_playeranim with its player graphic", () => {
  const head = { getId: () => 13448, getDefinition: () => ({ getName: () => "Ensouled goblin head" }) };
  const player = recorder({
    getInventory: () => ({ getItems: () => [head], deleteNumber() {} }),
    getLocation: () => ({ clone: () => ({}) }),
    getSkillManager: () => ({ addExperiences() {} }),
    sendMessage(message) { throw new Error(message); },
  });
  const npc = { setOwner() {} };
  withStub(Spell.prototype, "canCast", () => true, () =>
    withStub(NPC, "create", () => npc, () =>
      withStub(World, "getAddNPCQueue", () => ({ push() {} }), () =>
        ArceuusItemSpells.castOnItem(player, ArceuusItemSpells.BASIC_REANIMATION, 13448, 0))));
  assert.deepEqual(player.animations, [seq("arceuus_necromancy_playeranim")]);
  assert.deepEqual(player.graphics, [spotanim("arceuus_necromancy_playerspot")]);
});

test("each Resurrect casts human_spellcast_resurrect with its kind's graphic, and its thrall rises", () => {
  const rises = { ghost: "ghost_update_thrall_spawn_raised", skeleton: "skeleton_update_thrall_spawn_raised", zombie: "zombie_update_thrawl_spawn_raised" };
  for (const [kind, rise] of Object.entries(rises)) {
    for (const tier of ["lesser", "superior", "greater"]) {
      const spell = ArceuusSpells.SELF_SPELLS.get(`resurrect ${tier} ${kind}`);
      assert.equal(spell.data.animation, seq("human_spellcast_resurrect"), `${tier} ${kind}`);
      assert.equal(spell.data.graphic, spotanim(`resurrect_${kind}_cast_spotanim`), `${tier} ${kind}`);
      let spawn;
      withStub(ArceuusThralls, "summon", (...args) => { spawn = args[5]; }, () => spell.data.effect({}));
      assert.equal(spawn.rise, seq(rise), `${tier} ${kind}`);
      assert.equal(spawn.impact, spotanim(`resurrect_${kind}_impact_spotanim`), `${tier} ${kind}`);
    }
  }
});

test("a summoned thrall plays its rising animation and graphic", () => {
  const thrall = recorder({ setOwner() {}, setPet() {}, setUntargetable() {}, setFollowing() {} });
  const attributes = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({ decreaseCurrentLevel() {}, getCurrentLevel: () => 99 }),
    getLocation: () => ({ clone: () => ({}) }),
  };
  withStub(NPC, "create", () => thrall, () =>
    withStub(World, "getAddNPCQueue", () => ({ push() {} }), () =>
      withStub(TaskManager, "submit", () => {}, () =>
        ArceuusThralls.summon(player, 10886, 6, 3, 1, { rise: 13685, impact: 1905 }))));
  assert.deepEqual(thrall.animations, [13685]);
  assert.deepEqual(thrall.graphics, [1905]);
});
