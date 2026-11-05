const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const { CombatFactory, CombatType, Skill, World, ItemIdentifiers } = core;
function special(name, options = {}) {
  let value;
  require(`../plugins/combat/specials/${name}.SpecialAttack`)({ core: options.core ?? core,
    registerCombatSpecial: (entry) => { value = entry; },
    emitCustomEvent: (_name, event) => { event.inside = options.inside ?? false; },
    onPlayerDealtDamage: (handler) => { options.damageHook = handler; } });
  return value;
}
function attacker() {
  const xp = [];
  const value = { xp, isPlayer: () => true, isNpc: () => false, getAsPlayer: () => value,
    getCombatSpecial: () => null, isSpecialActivated: () => false,
    getSkillManager: () => ({ addExperience: (...args) => xp.push(args) }) };
  return value;
}
function target() {
  const value = { isPlayer: () => false, isNpc: () => true, getAsNpc: () => value,
    getHitpoints: () => 8, getPrayerActive: () => [], performGraphic() {} };
  return value;
}
function lightning(source, victim) {
  let value;
  const oldBounds = core.DamageFormulas.sourceHitBounds;
  core.DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  const old = CombatFactory.addPendingHit;
  CombatFactory.addPendingHit = (hit) => { value = hit; };
  try { special('SaradominSword').combatMethod.handleAfterHitEffects({ isAccurate: () => true,
    getAttacker: () => source, getTarget: () => victim }); }
  finally { CombatFactory.addPendingHit = old; core.DamageFormulas.sourceHitBounds = oldBounds; }
  return value;
}
test('lightning is a capped delayed Magic hit paying 2 Magic XP per damage', () => {
  const source = attacker();
  const hit = lightning(source, target());
  assert.equal(hit.getCombatType(), CombatType.MAGIC);
  assert.equal(hit.getDelay(), 1);
  assert.ok(hit.getTotalDamage() >= 1 && hit.getTotalDamage() <= 8);
  assert.equal(hit.rewardsExperience(), false);
  hit.getCombatMethod().handleAfterHitEffects(hit);
  assert.equal(source.xp.find(([skill]) => skill === Skill.MAGIC)[1], hit.getTotalDamage() * 2);
});
test('lightning never inherits a newly activated special hit count, skip flag or damage cap', () => {
  const source = attacker();
  source.isSpecialActivated = () => true;
  source.getCombatSpecial = () => ({ getTraits: () => ({ skipAttack: true, hitCount: 4, maximumDamageCap: 0, damageType: 'melee' }) });
  const hit = lightning(source, target());
  assert.equal(hit.getHits().length, 1);
  assert.ok(hit.getTotalDamage() > 0);
  assert.equal(hit.getCombatType(), CombatType.MAGIC);
});
test('fixed Magic hits keep Elysian and incoming damage reductions', () => {
  const oldBounds = core.DamageFormulas.sourceHitBounds, oldRandom = Math.random;
  core.DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  Math.random = () => 0;
  try {
    const source = { isNpc: () => true, isPlayer: () => false, getAsNpc: () => source,
      getCurrentDefinition: () => ({ isDemon: () => false }) };
    const victim = { isPlayer: () => true, isNpc: () => false, getAsPlayer: () => victim,
      getHitpoints: () => 100, getPrayerActive: () => [], getAttribute: () => null, performGraphic() {},
      getEquipment: () => ({ getItems: () => Array.from({ length: 14 }, () => ({ getId: () => ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD })) }) };
    const { registerIncomingDamageModifier } = require('../dist/game/content/combat/EquipmentEffects');
    registerIncomingDamageModifier((entity, damage) => { if (entity === victim) damage.multiplyDamage(0.5); });
    const hit = new core.PendingHit(source, victim, { type: () => CombatType.MAGIC, accuracyDefenceType: (type) => type }, { damage: 16, rollAccuracy: false });
    assert.equal(hit.getTotalDamage(), 16, 'the roll is not reduced before impact');
    core.CombatFactory.applyHitTimeDefences(hit);
    assert.equal(hit.getTotalDamage(), 6, '16 reduced by Elysian25%, then incoming50% at impact');
  } finally { core.DamageFormulas.sourceHitBounds = oldBounds; Math.random = oldRandom; }
});
test('guild cyclopes reject real lightning through existing non-melee immunity and give no XP', () => {
  let immune;
  require('../plugins/areas/warriors-guild/Common.WarriorsGuild').init({ core });
  require('../plugins/areas/warriors-guild/Cyclopes.WarriorsGuild')(new Proxy({
    onNpcHitModify: (handler) => { immune = handler; },
  }, { get: (object, key) => object[key] ?? (() => {}) }));
  const source = attacker(), cyclops = target();
  cyclops.getId = () => core.NpcIdentifiers.CYCLOPS_10;
  const hit = lightning(source, cyclops);
  immune({ npc: cyclops, hit });
  hit.getCombatMethod().handleAfterHitEffects(hit);
  assert.equal(hit.getTotalDamage(), 0);
  assert.deepEqual(source.xp, []);
});
test('Corruption is ToA-only, successful hits mark for ten ticks, refreshing without stacking', () => {
  let cycle = 100;
  const old = World.getProcessCycle;
  World.getProcessCycle = () => cycle;
  try {
    const messages = [];
    assert.equal(special('KerisPartisanOfCorruption').combatMethod.canAttack({ sendMessage: (text) => messages.push(text) }, target()), false);
    assert.match(messages[0], /only be used within the Tombs/);
    const options = { inside: true };
    const value = special('KerisPartisanOfCorruption', options), victim = target();
    victim.getHitpoints = () => 100;
    assert.equal(value.traits.attackSpeedTicks, 8);
    assert.equal(value.combatMethod.canAttack({}, victim), true);
    const hit = (accurate) => ({ isAccurate: () => accurate, getTarget: () => victim });
    const damage = () => {
      const splat = new core.HitDamage(20, core.HitMask.RED);
      options.damageHook({ target: victim, hit: { getHits: () => [splat], updateTotalDamage() {} } });
      return splat.getDamage();
    };
    value.combatMethod.handleAfterHitEffects(hit(false)); assert.equal(damage(), 20);
    value.combatMethod.handleAfterHitEffects(hit(true)); assert.equal(damage(), 25);
    cycle = 109; assert.equal(damage(), 25);
    value.combatMethod.handleAfterHitEffects(hit(true)); assert.equal(damage(), 25);
    victim.getHitpoints = () => 12;
    const first = new core.HitDamage(8, core.HitMask.RED), second = new core.HitDamage(8, core.HitMask.RED);
    let updated = false;
    options.damageHook({ target: victim, hit: { getHits: () => [first, second], updateTotalDamage() { updated = true; } } });
    assert.deepEqual([first.getDamage(), second.getDamage()], [10, 2], 'final rerolled hits are amplified and capped together');
    assert.equal(updated, true);
    victim.getHitpoints = () => 100;
    cycle = 119; assert.equal(damage(), 20);
  } finally { World.getProcessCycle = old; }
});
test('Sun refuses outside ToA before spending energy or Prayer', () => {
  const messages = [];
  const player = { isPlayer: () => true, getAsPlayer: () => player, sendMessage: (text) => messages.push(text) };
  special('KerisPartisanOfTheSun').combatMethod.start(player, player);
  assert.match(messages[0], /only be used within the Tombs/);
});
test('Sun spends 75 energy and 50 Prayer, restores drains, cures and overheals', () => {
  let drained = 0;
  const current = new Map(Skill.values().map((skill) => [skill, 50]));
  current.set(Skill.PRAYER, 49);
  current.set(Skill.ATTACK, 110);
  const skills = { getCurrentLevel: (s) => current.get(s), getMaxLevel: () => 99,
    setCurrentLevels: (s, v) => current.set(s, v) };
  const player = { isPlayer: () => true, getAsPlayer: () => player, getSkillManager: () => skills,
    sendMessage() {}, performAnimation() {}, performGraphic() {},
    setPoisonDamage(v) { this.poison = v; }, setVenomed(v) { this.venom = v; },
    setHitpoints: (v) => current.set(Skill.HITPOINTS, v), setRunEnergy(v) { this.energy = v; },
    getPacketSender: () => ({ sendRunEnergy() {} }) };
  const value = special('KerisPartisanOfTheSun', { inside: true,
    core: { ...core, CombatSpecial: { drain: (_p, amount) => { drained += amount; } } } });
  value.combatMethod.start(player, player);
  assert.equal(drained, 0);
  current.set(Skill.PRAYER, 50);
  value.combatMethod.start(player, player);
  assert.equal(drained, 75);
  assert.equal(current.get(Skill.PRAYER), 0);
  assert.equal(current.get(Skill.HITPOINTS), 118);
  assert.equal(current.get(Skill.STRENGTH), 99);
  assert.equal(current.get(Skill.ATTACK), 110);
  assert.equal(player.energy, 100);
  assert.equal(player.poison, 0);
  assert.equal(player.venom, false);
});
const loc = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
test('scythe cleaves three forward tiles across NPCs and players in multi with attackability', () => {
  const npcs = [], players = [];
  const Scythe = require('../plugins/items/ScytheOfVitur.plugin');
  let resolver, multi = true;
  Scythe.register({ core: { ...core,
    World: { getNpcs: () => npcs, getPlayers: () => players },
    CombatFactory: { canAttackSecondaryTarget: (_a, _b, c) => c.attackable !== false,
      applyStyleDamage: (hit, max) => { hit.max = max; hit.damage = max; } },
    DamageFormulas: { calculateMaxMeleeHit: () => 48 },
    PendingHit: class { constructor(a, target) { this.target = target; this.damage = 48; } getTotalDamage() { return this.damage ?? 0; } setTotalDamage(value) { this.damage = value; } },
  }, getAreaManager: () => ({ inMulti: () => multi }), onServerStartup: (fn) => fn(), onItemAction() {}, onItemOnItem() {}, persistAttribute() {}, onItemOnObject() {}, onObjectInteraction() {}, onPlayerLogin() {},
    registerCombatMethodResolver: (value) => { resolver = value; } });
  const actor = (x, y, player = false, size = 1) => {
    const value = { getLocation: () => loc(x, y), isNpc: () => !player, isPlayer: () => player,
      getAsNpc: () => value, getAsPlayer: () => value, getHitpoints: () => 1000, getSize: () => size };
    return value;
  };
  const wielder = actor(0, 0, true);
  wielder.getEquipment = () => ({ get: () => ({ getId: () => ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_ }) });
  const primary = actor(0, 1), left = actor(-1, 1), right = actor(1, 1, true), behind = actor(0, -1);
  npcs.push(primary, left, behind); players.push(wielder, right);
  const method = resolver.resolve(wielder);
  const hits = method.hits(wielder, primary);
  assert.deepEqual(hits.map((hit) => hit.target), [primary, left, right]);
  assert.deepEqual(hits.slice(1).map((hit) => hit.max), [24, 12]);
  left.attackable = false;
  assert.deepEqual(method.hits(wielder, primary).map((hit) => hit.target), [primary, right]);
  multi = false; assert.equal(method.hits(wielder, primary).length, 1);
  multi = true;
  const large = actor(0, 1, false, 3);
  assert.deepEqual(method.hits(wielder, large).map((hit) => hit.target), [large, large, large]);
});

test('scythe queue caps a corrupted victim across every hit before awarding XP', () => {
  const previous = { damage: CombatFactory.getHitDamage, source: core.DamageFormulas.sourceMaxHit,
    melee: core.DamageFormulas.calculateMaxMeleeHit, accuracy: core.AccuracyFormulasDpsCalc.rollAccuracy,
    dealt: PluginManager.emitPlayerDealtDamage };
  const options = { inside: true };
  const corruption = special('KerisPartisanOfCorruption', options);
  const queued = [];
  const victim = target();
  Object.assign(victim, { getHitpoints: () => 50, getSize: () => 3, getLocation: () => loc(0, 1),
    isUntargetable: () => false, isNeedsPlacement: () => false,
    getCombat: () => ({ getHitQueue: () => ({ addPendingHit: (hit) => queued.push(hit) }) }) });
  const source = attacker();
  Object.assign(source, { getLocation: () => loc(0, 0), getEquipment: () => ({ get: () => ({ getId: () => ItemIdentifiers.SCYTHE_OF_VITUR_UNCHARGED_ }) }),
    getFightType: () => ({ getStyle: () => ({ skill: () => [Skill.ATTACK.getIndex()] }) }) });
  try {
    core.DamageFormulas.sourceMaxHit = () => 48;
    core.DamageFormulas.calculateMaxMeleeHit = () => 48;
    core.AccuracyFormulasDpsCalc.rollAccuracy = () => true;
    CombatFactory.getHitDamage = (_a, _b, _c, _d, bounds) => new core.HitDamage(bounds?.maximumBonus ?? 48, core.HitMask.RED);
    PluginManager.emitPlayerDealtDamage = options.damageHook;
    let resolver;
    delete require.cache[require.resolve('../plugins/items/ScytheOfVitur.plugin')];
    require('../plugins/items/ScytheOfVitur.plugin').register({ core, getAreaManager: () => ({ inMulti: () => false }),
      onServerStartup: (handler) => handler(), onItemAction() {}, onItemOnItem() {}, persistAttribute() {}, onItemOnObject() {}, onObjectInteraction() {}, onPlayerLogin() {},
      registerCombatMethodResolver: (value) => { resolver = value; } });
    const hits = resolver.resolve(source).hits(source, victim);
    assert.deepEqual(hits.map((hit) => hit.getTotalDamage()), [48, 24, 12]);
    corruption.combatMethod.handleAfterHitEffects({ isAccurate: () => true, getTarget: () => victim });
    for (const hit of hits) CombatFactory.addPendingHit(hit);
    assert.deepEqual(queued.map((hit) => hit.getTotalDamage()), [50, 0, 0]);
    assert.equal(source.xp.filter(([skill]) => skill === Skill.ATTACK).reduce((sum, [, xp]) => sum + xp, 0), 200);
    assert.equal(source.xp.filter(([skill]) => skill === Skill.HITPOINTS).reduce((sum, [, xp]) => sum + xp, 0), 50 * 4 / 3);
  } finally {
    CombatFactory.getHitDamage = previous.damage;
    core.DamageFormulas.sourceMaxHit = previous.source;
    core.DamageFormulas.calculateMaxMeleeHit = previous.melee;
    core.AccuracyFormulasDpsCalc.rollAccuracy = previous.accuracy;
    PluginManager.emitPlayerDealtDamage = previous.dealt;
  }
});

test('OSRS minimum player hit clamps successful zeroes without rerolling or changing XP rates', t => {
  const { Misc } = require('../dist/util/Misc');
  const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
  t.mock.method(core.DamageFormulas, 'sourceMaxHit', () => 3);
  t.mock.method(core.DamageFormulas, 'sourceHitBounds', () => ({ minimum: 0, maximum: 3 }));
  let selected = 0;
  t.mock.method(Misc, 'randomInclusive', () => selected);
  const source = attacker(), victim = target();
  for (const style of [CombatType.MELEE, CombatType.RANGED, CombatType.MAGIC]) {
    const damages = [0, 1, 2, 3].map(value => {
      selected = value;
      return CombatFactory.rollHitDamage(source, victim, style, false, undefined, false, false).getDamage();
    });
    assert.deepEqual(damages, [1, 1, 2, 3], 'raise zero to one; do not replace 0..max with a uniform 1..max roll');
  }
  selected = 0;
  t.mock.method(core.DamageFormulas, 'sourceMaxHit', () => 1);
  const makeHit = () => new core.PendingHit(source, victim,
    { type: () => CombatType.MELEE, accuracyDefenceType: type => type }, { rollAccuracy: true });
  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => true);
  const hit = makeHit();
  assert.equal(hit.getTotalDamage(), 1, 'a beginner successful zero now deals one');
  assert.equal(hit.getHits()[0].getHitmask(), HitMask.RED);
  CombatFactory.rewardExp(source, {
    getTotalDamage: () => hit.getTotalDamage(), getSkills: () => [Skill.ATTACK.getIndex()],
    getCombatType: () => CombatType.MELEE, getTarget: () => victim,
  });
  assert.equal(source.xp.find(([skill]) => skill === Skill.ATTACK)[1], 4, 'still four melee XP per damage');

  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => false);
  assert.equal(makeHit().getTotalDamage(), 0, 'failed accuracy stays a miss');
  const npc = { isPlayer: () => false, isNpc: () => true };
  assert.equal(CombatFactory.rollHitDamage(npc, victim, CombatType.MELEE, false, undefined, false, false).getDamage(), 0, 'NPC zeroes are unchanged');
  const zeroBound = { minimumMultiplier: 0, maximumMultiplier: 0 };
  assert.equal(CombatFactory.rollHitDamage(source, victim, CombatType.MELEE, false, zeroBound, false, false).getDamage(), 0,
    'explicit zero-damage bounds remain zero');
  selected = 1;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    if (name === 'combat:hit-rolled') event.damage = 0;
  });
  assert.equal(CombatFactory.rollHitDamage(source, victim, CombatType.MELEE, false, undefined, false, false).getDamage(), 1,
    'clamp after plugin roll modifiers too');

  t.mock.method(core.PrayerHandler, 'isActivated', () => true);
  assert.equal(CombatFactory.rollHitDamage(source, victim, CombatType.MELEE, false, undefined, false, true).getDamage(), 0,
    'defensive reductions can still reduce the promoted roll to zero');
});

test('queued zeroes and ones credit actual Attack XP and send skill updates for every damaging hit', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { Misc } = require('../dist/util/Misc');
  const { GameConstants } = require('../dist/game/GameConstants');
  assert.equal(GameConstants.EXPERIENCE_MULTIPLIER, 1, 'exercise the default 1x world rate');
  const source = new Player(null);
  const skills = source.getSkillManager();
  const drops = [], updates = [];
  const sender = new Proxy({}, { get: (_, name) => (...args) => {
    if (name === 'sendExpDrop') drops.push(args);
    if (name === 'sendSkill') updates.push(args[0]);
    return sender;
  } });
  source.getPacketSender = () => sender;
  const victim = target();
  victim.isUntargetable = victim.isNeedsPlacement = () => false;
  victim.getCombat = () => ({ getHitQueue: () => ({ addPendingHit() {} }) });
  t.mock.method(core.DamageFormulas, 'sourceMaxHit', () => 1);
  t.mock.method(Misc, 'randomInclusive', () => 0);
  let accurate = false;
  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => accurate);
  const totals = [];
  for (const success of [false, true, false, true, true]) {
    accurate = success;
    const hit = new core.PendingHit(source, victim,
      { type: () => CombatType.MELEE, accuracyDefenceType: type => type }, { rollAccuracy: true });
    assert.equal(hit.getTotalDamage(), success ? 1 : 0);
    CombatFactory.addPendingHit(hit);
    totals.push(skills.getExperience(Skill.ATTACK));
  }
  assert.deepEqual(totals, [0, 4, 4, 8, 12], 'misses give zero; every one-damage hit credits four Attack XP');
  assert.equal(skills.getExperience(Skill.STRENGTH), 0, 'fresh accounts now train Attack, not Strength');
  assert.deepEqual(drops.filter(([skill]) => skill === Skill.ATTACK).map(([, xp]) => xp), [4, 4, 4]);
  assert.equal(updates.filter(skill => skill === Skill.ATTACK).length, 3, 'each awarded hit publishes the new skill total');
});
