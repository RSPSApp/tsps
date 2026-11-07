// Run after yarn build: node --test tests/vestas-spear.test.cjs
// Vesta's spear (bh) Spear Wall (Wiki: Vesta's_spear): two hits, 8 ticks of melee/ranged immunity, -1 attack delay.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const core = PluginManager.getCoreApi();
const { World, CombatType } = core;

const hitModifiers = [];
require("../plugins/combat/specials/VestasSpearBh.SpecialAttack")({
  core, registerCombatSpecial: CombatSpecial.register, onPlayerHitModify: (handler) => hitModifiers.push(handler),
});
before(async () => CachePipeline.initialize(path.resolve(__dirname, "..")));

function player() {
  const attributes = new Map();
  const p = {
    energy: 100, special: null, activated: false, animations: [], attackDelay: 4,
    isPlayer: () => true, isNpc: () => false, getAsPlayer() { return this; },
    getEquipment: () => ({ get: () => ({ getId: () => core.ItemIdentifiers.VESTAS_SPEAR_BH_ }) }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getCombatSpecial() { return this.special; }, setCombatSpecial(s) { this.special = s; },
    isSpecialActivated() { return this.activated; }, setSpecialActivated(on) { this.activated = on; },
    getDueling: () => ({ inDuel: () => false }),
    getSpecialPercentage() { return this.energy; },
    decrementSpecialPercentage(amount) { this.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getPacketSender: () => ({ updateSpecialAttackOrb() {}, sendSpecialAttackState() {} }),
    performAnimation(a) { this.animations.push(a); }, performGraphic() {}, getAttackSound: () => null, getAttackAnim: () => -1,
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: (key) => attributes.get(key),
    getCombat() {
      return { getTarget: () => null, getAttackDelay: () => p.attackDelay, setAttackDelay: (ticks) => { p.attackDelay = ticks; } };
    },
  };
  CombatSpecial.assign(p);
  return p;
}

const target = { isPlayer: () => false, getHitpoints: () => 200 };

function spearHit(p, t, { accurate, rolled, random }) {
  t.mock.method(AccuracyFormulasDpsCalc, "rollAccuracy", () => accurate);
  t.mock.method(core.CombatFactory, "getHitDamage", () => new core.HitDamage(rolled, core.HitMask.RED));
  t.mock.method(Math, "random", () => random);
  p.activated = true;
  return new PendingHit(p, target, p.special.getCombatMethod());
}

test("Spear Wall costs 50% and hits twice, the second two ticks after the first", (t) => {
  const p = player();
  assert.ok(p.special);
  assert.equal(p.special.getDrainAmount(), 50);
  assert.equal(p.special.getTraits().hitCount, 2);
  assert.deepEqual(p.special.getTraits().hitDelayTicks, [0, 2]);
  const hit = spearHit(p, t, { accurate: true, rolled: 40, random: 0 });
  assert.equal(hit.getHits().length, 2);
  assert.deepEqual(hit.getHitDelays(), [0, 2]);
});

test("the second hit is 50-75% of the first", (t) => {
  const p = player();
  assert.deepEqual(spearHit(p, t, { accurate: true, rolled: 40, random: 0 }).getHits().map((h) => h.getDamage()), [40, 20]);
  const q = player();
  assert.deepEqual(spearHit(q, t, { accurate: true, rolled: 40, random: 0.999 }).getHits().map((h) => h.getDamage()), [40, 29]);
});

test("a failed accuracy roll misses both hits", (t) => {
  const p = player();
  assert.deepEqual(spearHit(p, t, { accurate: false, rolled: 40, random: 0.5 }).getHits().map((h) => h.getDamage()), [0, 0]);
});

test("the wielder is immune to melee and ranged hits for 8 ticks from the use, not to magic", (t) => {
  const p = player();
  let cycle = 100;
  t.mock.method(World, "getProcessCycle", () => cycle);
  p.special.getCombatMethod().start(p, target);
  const incoming = (type) => {
    const hit = { getCombatType: () => type, total: 9, setTotalDamage(n) { this.total = n; } };
    for (const modify of hitModifiers) modify({ player: p, hit });
    return hit.total;
  };
  assert.equal(incoming(CombatType.MELEE), 0);
  assert.equal(incoming(CombatType.RANGED), 0);
  assert.equal(incoming(CombatType.MAGIC), 9);
  cycle = 107;
  assert.equal(incoming(CombatType.MELEE), 0);
  cycle = 108;
  assert.equal(incoming(CombatType.MELEE), 9, "immunity ends after 8 ticks");
  assert.equal(incoming(CombatType.RANGED), 9);
});

test("a successful hit takes a tick off the next attack delay; a miss does not", () => {
  const method = player().special.getCombatMethod();
  const p = player();
  method.handleAfterHitEffects({ isAccurate: () => true, getTotalDamage: () => 12, getAttacker: () => p });
  assert.equal(p.attackDelay, 3);
  method.handleAfterHitEffects({ isAccurate: () => false, getTotalDamage: () => 0, getAttacker: () => p });
  assert.equal(p.attackDelay, 3);
});
