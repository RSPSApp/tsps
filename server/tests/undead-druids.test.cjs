// Run after `yarn build`: node --test tests/undead-druids.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");

const projectiles = [];
const providers = [];
let nextHitAccurate = true;
const real = PluginManager.getCoreApi();
class FakeHit {
  constructor(attacker, target, method, delay) {
    Object.assign(this, { attacker, target, method, delay, damage: attacker.getCurrentDefinition().getMaxHit(), type: method.type(), accurate: nextHitAccurate });
  }
  isAccurate() { return this.accurate; }
  getTarget() { return this.target; }
  getTotalDamage() { return this.damage; }
  setTotalDamage(value) { this.damage = value; }
  getCombatType() { return this.type; }
}
const core = {
  ...real,
  PendingHit: FakeHit,
  CombatRange: { canReach: (_npc, _method, target) => target.meleeReach },
  CombatFactory: {
    ...real.CombatFactory,
    applyStyleDamage: (hit, maxHit) => hit.setTotalDamage(Math.min(hit.getTotalDamage(), maxHit)),
  },
  Projectile: {
    ...real.Projectile,
    ticksToLand: real.Projectile.ticksToLand,
    centreOf: real.Projectile.centreOf,
    createProjectile: (...args) => ({
      withAngle(angle) { this.angle = angle; return this; },
      withProgress(progress) { this.progress = progress; return this; },
      sendProjectile() { projectiles.push({ args, angle: this.angle, progress: this.progress }); },
    }),
  },
  Sounds: { sendSound: (...args) => projectiles.push({ sound: args[1].getId(), delay: args[1].getDelay() }) },
};
const plugin = require("../plugins/npcs/UndeadDruids.plugin");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  new NpcDefinitionLoader().load();
  plugin.register({ core, registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }) });
});

function mobile(id, x, y) {
  const shown = [];
  const definition = real.NpcDefinition.forId(id);
  return {
    shown,
    getLocation: () => new Location(x, y, 0),
    getSize: () => 1,
    getCurrentDefinition: () => definition,
    getAttackAnim: () => definition.getAttackAnim(),
    performAnimation: (animation) => shown.push(`anim ${animation.getId()}`),
    performGraphic: (graphic) => shown.push(`graphic ${graphic.getId()} height ${graphic.getHeight()}${graphic.getDelay() ? ` delay ${graphic.getDelay()}` : ""}`),
  };
}

test("the cache definition keeps Undead Druids aggressive", () => {
  assert.deepEqual(providers.map((entry) => entry.ids), [[2145]]);
  assert.equal(real.NpcDefinition.forId(2145).isAggressive(), true);
  assert.equal(providers[0].options.singleton, false);
});

test("a druid casts the captured magic projectile from range and caps damage at 22", () => {
  const Method = providers[0].ctor;
  const druid = mobile(2145, 1800, 9940);
  const target = mobile(0, 1800, 9945);
  target.meleeReach = false;
  projectiles.length = 0;
  const method = new Method();
  assert.equal(method.type(), real.CombatType.MAGIC);
  assert.equal(method.attackDistance(druid), 10);
  method.start(druid, target);
  assert.deepEqual(druid.shown, ["anim 5571", "graphic 1678 height 92"]);
  assert.deepEqual(projectiles[0], {
    args: [druid, target, 1679, 61, 111, 37, 30], angle: 10, progress: 96,
  });
  const [hit] = method.hits(druid, target);
  assert.equal(hit.type, real.CombatType.MAGIC);
  assert.equal(hit.delay, 4);
  assert.equal(hit.getTotalDamage(), 22);
});

test("a reachable adjacent target switches to crush melee and caps damage at 11", () => {
  const Method = providers[0].ctor;
  const druid = mobile(2145, 1800, 9940);
  const target = mobile(0, 1800, 9941);
  target.meleeReach = true;
  projectiles.length = 0;
  const method = new Method();
  method.start(druid, target);
  assert.equal(method.type(), real.CombatType.MELEE);
  assert.equal(method.attackDistance(druid), 1);
  assert.deepEqual(druid.shown, ["anim 5578"]);
  assert.deepEqual(projectiles, []);
  const [hit] = method.hits(druid, target);
  assert.equal(hit.type, real.CombatType.MELEE);
  assert.equal(hit.delay, 1);
  assert.equal(hit.getTotalDamage(), 11);
});

test("after a melee swing finishes, a target that moves away is reached with magic next", () => {
  const Method = providers[0].ctor;
  const druid = mobile(2145, 1800, 9940);
  const target = mobile(0, 1800, 9941);
  const method = new Method();
  projectiles.length = 0;

  target.meleeReach = true;
  method.start(druid, target);
  const [meleeHit] = method.hits(druid, target);
  assert.equal(meleeHit.type, real.CombatType.MELEE);
  method.finished(druid, target);

  target.meleeReach = false;
  assert.equal(method.type(), real.CombatType.MAGIC);
  assert.equal(method.attackDistance(druid), 10);
  method.start(druid, target);
  const [magicHit] = method.hits(druid, target);
  assert.equal(magicHit.type, real.CombatType.MAGIC);
  assert.deepEqual(druid.shown.slice(-2), ["anim 5571", "graphic 1678 height 92"]);
  assert.equal(projectiles.filter((entry) => entry.args).at(-1).args[2], 1679);
});

test("the impact graphic and sound go out at the cast, delayed to the projectile's end (RSProx 2966)", () => {
  const Method = providers[0].ctor;
  const druid = mobile(2145, 1800, 9940);
  const target = mobile(0, 1800, 9943);
  target.meleeReach = false;
  projectiles.length = 0;
  const method = new Method();
  method.start(druid, target);
  assert.equal(projectiles[0].args[4], 91);
  nextHitAccurate = true;
  method.hits(druid, target);
  assert.deepEqual(target.shown, ["graphic 1681 height 124 delay 91"]);
  assert.deepEqual(projectiles.slice(1), [{ sound: 135, delay: 91 }]);
});

test("a splash shows the splash graphic at the projectile's end and makes no impact sound", () => {
  const Method = providers[0].ctor;
  const druid = mobile(2145, 1800, 9940);
  const target = mobile(0, 1800, 9945);
  target.meleeReach = false;
  projectiles.length = 0;
  const method = new Method();
  method.start(druid, target);
  nextHitAccurate = false;
  try {
    method.hits(druid, target);
  } finally {
    nextHitAccurate = true;
  }
  const splash = real.MagicCombatMethod.SPLASH_GRAPHIC;
  assert.deepEqual(target.shown, [`graphic ${splash.getId()} height ${splash.getHeight()} delay 111`]);
  assert.equal(projectiles.length, 1);
});

test("melee swings send no magic impact", () => {
  const Method = providers[0].ctor;
  const druid = mobile(2145, 1800, 9940);
  const target = mobile(0, 1800, 9941);
  target.meleeReach = true;
  projectiles.length = 0;
  const method = new Method();
  method.start(druid, target);
  method.hits(druid, target);
  assert.deepEqual(target.shown, []);
  assert.deepEqual(projectiles, []);
});
