// Run after `yarn build`: node --test tests/area-attacks-target-zone.test.cjs
// Wiki (Multicombat area): whether an area attack reaches more than its target depends on the zone the target stands
// in, not the attacker's: a player on a single-way tile still hits several opponents standing in multi. Real engine:
// every plugin loaded, a real Player and real NPCs on the real single/multi border at 3278/3279,3156.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { World } = require("../dist/game/World");

let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const SINGLE = [3275, 3156];
const MULTI = [3279, 3156];
const MULTI_BESIDE = [3280, 3156];
const SINGLE_BESIDE = [3277, 3156];

let next = 9610;
function scene(t, weapon, amount, at, targetAt, bystanderAt, forceAccurate = true) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("zone" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, amount));
  core.WeaponInterfaceManager.assign(p);
  const target = core.NPC.create(core.NpcIdentifiers.GIANT_BAT, new core.Location(targetAt[0], targetAt[1], 0));
  const bystander = core.NPC.create(core.NpcIdentifiers.GIANT_BAT, new core.Location(bystanderAt[0], bystanderAt[1], 0));
  for (const npc of [target, bystander]) {
    World.getNpcs().add(npc, true);
    t.after(() => World.getNpcs().remove(npc));
  }
  t.mock.method(p, "getLocalNpcs", () => new Map([[1, target], [2, bystander]]));
  if (forceAccurate) t.mock.method(core.PendingHit.prototype, "isAccurate", () => true);
  return { p, target, bystander };
}

const struck = (hits) => new Set(hits.map((hit) => hit.getTarget()));

test("the border tiles: the attacker's tile is single-way, the target's and the bystander's multi", (t) => {
  const { p, target, bystander } = scene(t, I.RED_CHINCHOMPA_2, 100, SINGLE, MULTI, MULTI_BESIDE);
  assert.deepEqual([AreaManager.inMulti(p), AreaManager.inMulti(target), AreaManager.inMulti(bystander)], [false, true, true]);
  assert.equal(core.CombatFactory.areaAttackSpreads(p, target), true, "the target's zone decides");
  assert.equal(core.CombatFactory.areaAttackSpreads(target, p), false, "a target in single-way: no spread");
});

test("a chinchompa thrown from a single-way tile at a target in multi hits the bystander too", (t) => {
  const { p, target, bystander } = scene(t, I.RED_CHINCHOMPA_2, 100, SINGLE, MULTI, MULTI_BESIDE);
  const method = core.CombatFactory.getMethod(p);
  const hits = method.hits(p, target);
  assert.ok(struck(hits).has(bystander), "the blast reaches the bystander in multi");
});

test("a chinchompa thrown from multi at a target in single-way hits the target only", (t) => {
  const { p, target } = scene(t, I.RED_CHINCHOMPA_2, 100, MULTI, SINGLE_BESIDE, SINGLE);
  const hits = core.CombatFactory.getMethod(p).hits(p, target);
  assert.deepEqual([...struck(hits)], [target]);
});

test("Chainhit from a single-way tile at a target in multi bounces to the bystander", (t) => {
  const { p, target, bystander } = scene(t, I.RUNE_THROWNAXE, 50, SINGLE, MULTI, MULTI_BESIDE);
  p.setSpecialPercentage(100);
  const method = core.CombatSpecial.getById("rune_thrownaxe").getCombatMethod();
  const hits = method.hits(p, target);
  assert.ok(struck(hits).has(bystander), "the axe bounces on in multi");
});

// #6783: Hallowfell's passive uses the real cache item, complete resolver registry and hit queue.
const ARC = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
function hallowScene(t, direction = 0) {
  const at = [3290, 3166], [dx, dy] = ARC[direction];
  const f = scene(t, I.HALLOWFELL, 1, at, [at[0] + dx, at[1] + dy], [at[0], at[1]], false);
  World.getNpcs().remove(f.bystander);
  const others = [];
  for (const [x, y] of ARC) {
    const npc = core.NPC.create(core.NpcIdentifiers.CHICKEN, new core.Location(at[0] + x, at[1] + y));
    World.getNpcs().add(npc, true); npc.setNeedsPlacement(false); npc.setHitpoints(100);
    assert.equal(npc.getSize(), 1); assert.equal(AreaManager.inMulti(npc), true);
    assert.equal(npc.getCurrentDefinition().isAttackable(), true);
    others.push(npc); t.after(() => World.getNpcs().remove(npc));
  }
  f.target.setNeedsPlacement(false); f.target.setHitpoints(100);
  f.p.setNeedsPlacement(false); f.p.setMobileInteraction(f.target);
  const multiplier = core.GameConstants.EXPERIENCE_MULTIPLIER;
  core.GameConstants.EXPERIENCE_MULTIPLIER = 1;
  t.after(() => { core.GameConstants.EXPERIENCE_MULTIPLIER = multiplier; });
  return { ...f, others, at };
}
function hallowRoll(t, p, target, accuracy = [true, true, true], maximum = 47) {
  const checks = [], ranges = [];
  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', (attacker, victim) => {
    assert.equal(attacker, p); checks.push(victim); return accuracy[checks.length - 1] ?? true;
  });
  t.mock.method(core.DamageFormulas, 'sourceMaxHit', () => maximum);
  const api = PM.createApi('HallowfellRange' + p.getIndex());
  api.onCustomEvent('combat:hit-rolled', event => {
    if (event.attacker === p) { ranges.push(event.maximum); event.damage = event.maximum; }
  });
  const method = core.CombatFactory.getMethod(p);
  const hits = method.hits(p, target);
  return { method, hits, checks, ranges };
}

test('Hallowfell: each of eight facings reaches exactly the forward five tiles and at most two other actors', t => {
  for (let facing = 0; facing < 8; facing++) {
    const { p, target, others } = hallowScene(t, facing);
    assert.equal(p.getFacingDirection(), core.Direction.fromDeltas(...ARC[facing]));
    const reached = new Set();
    // Isolate each tile so the two-secondary cap cannot hide a wrong arc.
    for (let i = 0; i < others.length; i++) {
      for (let j = 0; j < others.length; j++) others[j].setRegistered(i === j);
      const hits = core.CombatFactory.getMethod(p).hits(p, target);
      if (struck(hits).has(others[i])) reached.add(i);
    }
    assert.deepEqual([...reached].sort(), [-2, -1, 0, 1, 2].map(d => (facing + d + 8) % 8).sort(), 'facing ' + facing);
    others.forEach(npc => npc.setRegistered(true));
    const targets = core.CombatFactory.getMethod(p).hits(p, target).map(hit => hit.getTarget());
    assert.equal(targets.length, 3); assert.equal(new Set(targets).size, 3); assert.equal(targets[0], target);
    for (const npc of [target, ...others]) { npc.setRegistered(true); World.getNpcs().remove(npc); }
  }
});

test('Hallowfell: secondaries independently roll half the maximum before armour, caps and XP', t => {
  const { p, target, others } = hallowScene(t);
  others.slice(2).forEach(npc => npc.setRegistered(false));
  const result = hallowRoll(t, p, target);
  assert.deepEqual(result.ranges, [47, 23, 23]);
  assert.equal(result.checks.length, 3);
  assert.deepEqual(result.hits.map(hit => hit.getTotalDamage()), [47, 23, 23]);
  const before = p.getSkillManager().getExperience(core.Skill.ATTACK);
  for (const hit of result.hits) core.CombatFactory.addPendingHit(hit);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK) - before, 372);
  for (const npc of [target, ...others.slice(0, 2)]) npc.getCombat().getHitQueue().process(World.getProcessCycle() + 10);
  assert.deepEqual([target, ...others.slice(0, 2)].map(npc => npc.getHitpoints()), [53, 77, 77]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK) - before, 372, 'landing pays no second XP');
});

test('Hallowfell: a missed primary still rolls the two secondary accuracies independently', t => {
  const { p, target, others } = hallowScene(t);
  others.slice(2).forEach(npc => npc.setRegistered(false));
  const result = hallowRoll(t, p, target, [false, true, false]);
  assert.equal(result.checks.length, 3);
  assert.deepEqual(result.hits.map(hit => hit.getTotalDamage()), [0, 23, 0]);
  assert.deepEqual(result.hits.map(hit => hit.getFailedAccuracyChecks()), [1, 0, 1]);
});

test('Hallowfell: single-way primary cannot spread, and each secondary must pass lifecycle, plane and area policy', t => {
  const { p, target, others } = hallowScene(t);
  target.setLocation(new core.Location(...SINGLE_BESIDE));
  assert.equal(core.CombatFactory.getMethod(p).hits(p, target).length, 1);
  target.setLocation(new core.Location(3290, 3167));
  for (const npc of others) npc.setRegistered(false);
  const beside = others[0]; beside.setRegistered(true);
  const hits = () => core.CombatFactory.getMethod(p).hits(p, target);
  assert.equal(hits().length, 2);
  beside.setNeedsPlacement(true); assert.equal(hits().length, 1); beside.setNeedsPlacement(false);
  beside.setHitpoints(0); assert.equal(hits().length, 1); beside.setHitpoints(100);
  beside.setLocation(new core.Location(3290, 3167, 1)); assert.equal(hits().length, 1);
  beside.setLocation(new core.Location(3290, 3167));
  beside.getTimers().registers(core.TimerKey.ATTACK_IMMUNITY, 10); assert.equal(hits().length, 1);
  beside.getTimers().cancel(core.TimerKey.ATTACK_IMMUNITY);
  t.mock.method(beside, 'getPrivateArea', () => ({})); assert.equal(hits().length, 1);
});

test('Hallowfell: a large actor intersecting several arc tiles is hit once, and a large primary is not hit again', t => {
  const { p, target, others, at } = hallowScene(t, 1);
  others.forEach(npc => npc.setRegistered(false));
  const large = core.NPC.create(core.NpcIdentifiers.GIANT_BAT, new core.Location(at[0], at[1] + 1));
  assert.equal(large.getSize(), 2);
  World.getNpcs().add(large, true); large.setNeedsPlacement(false);
  t.after(() => World.getNpcs().remove(large));
  const targets = core.CombatFactory.getMethod(p).hits(p, target).map(hit => hit.getTarget());
  assert.deepEqual(targets, [target, large]);
  target.setLocation(new core.Location(...at));
  assert.equal(p.getFacingDirection(), core.Direction.NORTH_EAST, 'overlapping the primary retains the last actual facing');
  assert.deepEqual(core.CombatFactory.getMethod(p).hits(p, target).map(hit => hit.getTarget()), [target, large]);
});

test('Hallowfell: half-maximum hits gain flat armour before their first HP cap and pay XP only for final damage', t => {
  const { p, target, others, at } = hallowScene(t);
  others.forEach(npc => npc.setRegistered(false));
  const victims = ['frost_nagua', 'elite_black_knight_1'].map((name, i) => {
    const npc = core.NPC.create(core.CacheDefinitions.getNpcId(name), new core.Location(at[0] + i, at[1] + 1));
    World.getNpcs().add(npc, true); npc.setNeedsPlacement(false); npc.setHitpoints(i ? 10 : 3);
    t.after(() => { npc.getCombat().getHitQueue().clear(); World.getNpcs().remove(npc); });
    return npc;
  });
  const result = hallowRoll(t, p, target, [true, true, true], 5);
  assert.deepEqual(result.ranges, [5, 2, 2]);
  assert.deepEqual(result.hits.map(hit => hit.getTotalDamage()), [5, 3, 0], 'raw secondary2 plus4 capped3; raw2 minus7 becomes0');
  const xp = p.getSkillManager().getExperience(core.Skill.ATTACK);
  for (const hit of result.hits) core.CombatFactory.addPendingHit(hit);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK) - xp, 32);
  for (const npc of victims) npc.getCombat().getHitQueue().process(World.getProcessCycle() + 10);
  assert.deepEqual(victims.map(npc => npc.getHitpoints()), [0, 10]);
});

test('Hallowfell: Leagues two-handed reach changes only the primary reach, keeping the adjacent cleave arc', t => {
  const { p, target, others, at } = hallowScene(t);
  const method = core.CombatFactory.getMethod(p);
  const { CombatRange } = require('../dist/game/content/combat/CombatRange');
  assert.equal(CombatRange.attackDistance(p, method, target), 1);
  const Common = require('../plugins/modes/leaguepacts/Common.LeaguePacts');
  p.setProfile('league'); p.setAttribute('league:type', 6); Common.forgetLeague(p);
  const nodes = Common.nodes.filter(node => ['talent_melee_range_multiplier', 'talent_melee_range_conditional_boost'].includes(node.varbit));
  assert.ok(nodes.length >= 2, 'cache supplies range multiplier and conditional boost: ' + JSON.stringify(nodes));
  Common.save(p, nodes.map(node => node.index));
  assert.equal(CombatRange.attackDistance(p, method, target), 2);
  target.setLocation(new core.Location(at[0], at[1] + 2));
  assert.equal(core.CombatFactory.getMethod(p), method, 'the native registry keeps the weapon method');
  assert.equal(method.hits(p, target).length, 3, 'distant primary does not exclude adjacent cleaves');
  others.forEach(npc => npc.setLocation(new core.Location(at[0], at[1] + 6)));
  assert.equal(method.hits(p, target).length, 1, 'the arc is not stretched to distant tiles');
});

test('Hallowfell: the resolver leaves autocasts, specials and other weapons with their ordinary owners', t => {
  const { p, target } = hallowScene(t);
  const method = core.CombatFactory.getMethod(p);
  assert.equal(method.type(), core.CombatType.MELEE);
  assert.equal(method.attackDistance(p), 1);
  assert.equal(method.attackSpeed(p), 6);
  assert.ok(core.CacheDefinitions.getItem(I.HALLOWFELL).inventoryActions.includes('Wield'));
  for (const id of [I.HALLOWFELL_2, I.HALLOWFELL_3, I.RUNE_SCIMITAR]) {
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id, 1));
    assert.notEqual(core.CombatFactory.getMethod(p), method, 'noted, placeholder and unrelated ' + id);
  }
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.HALLOWFELL, 1));
  p.setSpecialActivated(true); assert.notEqual(core.CombatFactory.getMethod(p), method);
  p.setSpecialActivated(false);
  t.mock.method(core.Autocasting, 'isActive', () => true);
  assert.equal(core.CombatFactory.getMethod(p), core.CombatFactory.MAGIC_COMBAT);
});

test('Hallowfell: each secondary keeps its own protection prayer and ownership checks', t => {
  const { p, target, others } = hallowScene(t);
  others.slice(2).forEach(npc => npc.setRegistered(false));
  const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
  PrayerHandler.activatePrayerPrayerId(others[0], PrayerHandler.PROTECT_FROM_MELEE);
  const result = hallowRoll(t, p, target);
  assert.deepEqual(result.hits.map(hit => hit.getTotalDamage()), [47, 23, 23]);
  for (const hit of result.hits) core.CombatFactory.addPendingHit(hit);
  assert.deepEqual(result.hits.map(hit => hit.getTotalDamage()), [47, 0, 23]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK), 280);
  others[1].setOwner({});
  assert.equal(core.CombatFactory.getMethod(p).hits(p, target).length, 2, 'another player owns the second NPC');
});

test('Hallowfell: players outside PvP are not collateral targets', t => {
  const { p, target, others, at } = hallowScene(t);
  others.forEach(npc => npc.setRegistered(false));
  const victim = scene(t, I.RUNE_SCIMITAR, 1, [at[0] + 1, at[1]], [3400, 3400], [3400, 3401]).p;
  victim.setRegistered(false); World.getPlayers().add(victim, true); victim.setNeedsPlacement(false);
  t.after(() => { victim.setRegistered(true); World.getPlayers().remove(victim); });
  assert.equal(AreaManager.inMulti(victim), true);
  assert.equal(core.CombatFactory.canAttackSecondaryTarget(p, target, victim), false);
  assert.deepEqual(core.CombatFactory.getMethod(p).hits(p, target).map(hit => hit.getTarget()), [target]);
});
