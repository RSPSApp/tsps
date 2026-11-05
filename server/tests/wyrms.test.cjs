// Run after `yarn build`: node --test tests/wyrms.test.cjs
// Wyrms and wyrmlings in combat (plugins/npcs/Wyrms.plugin.js, docs/wyrms.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");

const sent = [];
/** A PendingHit stand-in that "rolled" its NPC's full max hit. */
class FakeHit {
  constructor(attacker, target, method, delay) {
    Object.assign(this, { attacker, target, method, delay, damage: attacker.getCurrentDefinition().getMaxHit(), type: method.type() });
  }
  getTotalDamage() { return this.damage; }
  setTotalDamage(value) { this.damage = value; }
}

const real = PluginManager.getCoreApi();
const core = {
  ...real,
  PendingHit: FakeHit,
  Projectile: { createProjectile: (...args) => ({ sendProjectile: () => sent.push(args) }), ticksToLand: real.Projectile.ticksToLand },
};
const providers = [];
const Wyrms = require("../plugins/npcs/Wyrms.plugin");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  new NpcDefinitionLoader().load();
  Wyrms.register({ core, registerNpcCombatMethodProvider: (ids, ctor) => providers.push({ ids, ctor }) });
});

const providerFor = (id) => providers.find((entry) => entry.ids.includes(id)).ctor;

function mobile(id, x, y, size = 1, z = 0) {
  const shown = [];
  return {
    shown,
    getLocation: () => new Location(x, y, z),
    getSize: () => size,
    getCurrentDefinition: () => real.NpcDefinition.forId(id),
    performAnimation: (animation) => shown.push(`anim ${animation.getId()}`),
    performGraphic: (graphic) => shown.push(`gfx ${graphic.getId()}`),
  };
}

test("wyrms and wyrmlings each get their combat method, for both forms", () => {
  assert.deepEqual(providers.map((entry) => entry.ids), [[8610, 8611], [13031, 13032, 16296, 16297]]);
});

test("beside means touching the footprint along an edge, not diagonally", () => {
  const { beside } = Wyrms._test;
  const wyrm = mobile(8611, 10, 10, 3); // covers 10..12
  assert.ok(beside(wyrm, mobile(0, 13, 11)));
  assert.ok(beside(wyrm, mobile(0, 11, 9)));
  assert.ok(!beside(wyrm, mobile(0, 13, 13)), "diagonal");
  assert.ok(!beside(wyrm, mobile(0, 15, 11)), "two tiles off");
});

test("a wyrm casts from a distance (Wiki), without walking in, and melees when beside", () => {
  const Method = providerFor(8611);
  const wyrm = mobile(8611, 10, 10, 3);
  const far = mobile(0, 18, 11);

  const method = new Method();
  assert.equal(method.type(), real.CombatType.MAGIC, "magic reach until an attack starts");
  assert.equal(method.attackDistance(wyrm), 10);
  sent.length = 0;
  method.start(wyrm, far);
  assert.deepEqual(wyrm.shown, ["anim 8271"], "wyrm_attack_magic");
  assert.equal(sent[0][2], 1634, "wyrm_range_proj");
  const [magicHit] = method.hits(wyrm, far);
  assert.equal(magicHit.damage, 13, "magic max hit 13");
  method.handleAfterHitEffects({ getCombatType: () => real.CombatType.MAGIC, isAccurate: () => true, getTarget: () => far });
  assert.deepEqual(far.shown, ["gfx 1635"], "wyrm_range_impact");

  const close = mobile(0, 13, 11);
  const melee = new Method();
  melee.start(wyrm, close);
  assert.equal(melee.type(), real.CombatType.MELEE);
  assert.equal(wyrm.shown.at(-1), "anim 8270", "wyrm_attack_melee");
  const [meleeHit] = melee.hits(wyrm, close);
  assert.equal(meleeHit.delay, 1);
  assert.equal(meleeHit.damage, 10, "the 13 roll scaled to melee's 10");
});

test("a wyrm's magic hits as its projectile lands, at each range (#1862)", () => {
  const Method = providerFor(8611);
  const wyrm = mobile(8611, 10, 10, 3);
  for (const [x, end, ticks] of [[14, 86, 3], [20, 146, 5]]) {
    const target = mobile(0, x, 10);
    const method = new Method();
    sent.length = 0;
    method.start(wyrm, target);
    assert.equal(sent[0][4], end, "launched at 51, landing 46 + 10 a tile");
    assert.equal(method.hits(wyrm, target)[0].delay, ticks, `${x - 10} tiles out: the tick it lands`);
  }
});

test("a wyrm's magic timing stays finite across floors and matches the horizontal shot distance", () => {
  const Method = providerFor(8611);
  const wyrm = mobile(8611, 10, 10, 3, 0);
  const target = mobile(0, 14, 10, 1, 1);
  const method = new Method();
  sent.length = 0;
  method.start(wyrm, target);
  assert.equal(sent[0][4], 86, "46 base cycles plus four horizontal tiles");
  assert.equal(method.hits(wyrm, target)[0].delay, 3, "the hit waits for the finite projectile flight");
});

test("a wyrmling only melees, up to 5", () => {
  const Method = providerFor(16296);
  const wyrmling = mobile(16296, 10, 10, 2);
  const method = new Method();
  assert.equal(method.type(), real.CombatType.MELEE);
  assert.equal(method.attackDistance(wyrmling), 1);
  method.start(wyrmling, mobile(0, 12, 10));
  assert.deepEqual(wyrmling.shown, ["anim 8270"]);
  assert.equal(method.hits(wyrmling, mobile(0, 12, 10))[0].damage, 5);
});

test("their block and death animations are the cache's, not guessed ones", () => {
  for (const id of [8610, 8611, 13031, 13032, 16296, 16297]) {
    const definition = real.NpcDefinition.forId(id);
    assert.equal(definition.getDefenceAnim(), -1, `${id} doesn't block`);
    assert.equal(definition.getDeathAnim(), 8272, `${id} wyrm_death`);
  }
});
