const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const Mole = require('../plugins/bosses/GiantMole.plugin');
let core;
before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
});
const NpcDefinition = require('../dist/game/definition/NpcDefinition').NpcDefinition;

test('the mole fights with its own combat anims from the combat defs at speed 4', t => {
  const defs = require('../data/definitions/npc-combat-defs.json').npcs;
  assert.deepEqual(defs['5779'].anims, { attack: 3312, block: 3311, death: 3310 });
  const def = NpcDefinition.forId(5779);
  assert.equal(def.getAttackAnim(), 3312, 'mole_attack');
  assert.equal(def.getDefenceAnim(), 3311, 'mole_defend');
  assert.equal(def.getDeathAnim(), 3310, 'mole_death');
  assert.equal(def.getAttackSpeed(), 4, 'wiki attack speed');
});

function scene(t, hp = 80, random = 0) {
  const hooks = {}, tasks = [];
  const api = new Proxy({ core, getTaskManager: () => core.TaskManager,
    onCustomEvent: (name, handler) => { hooks[name] = handler; },
  }, {
    get: (obj, key) => obj[key] ?? ((...args) => { hooks[key] = args.at(-1); }),
  });
  Mole.register(api);
  t.mock.method(core.TaskManager, 'submit', task => { task.setRunning(true); tasks.push(task); });
  t.mock.method(core.Misc, 'getRandom', () => random);
  let cycle = 0;
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  t.mock.method(PluginManager, 'emitPlayerDealtDamage', e => hooks.onPlayerDealtDamage?.(e));
  t.mock.method(PluginManager, 'emitCombatHitResolved', e => hooks.onCombatHitResolved?.(e));
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => hooks[name]?.(event));
  const p = new Player(null);
  p.setUsername('mole-regression');
  const sender = new Proxy({}, { get: () => () => sender });
  p.getPacketSender = () => sender;
  p.setLocation(new core.Location(1758, 5188, 0));
  p.isRegistered = () => true;
  p.setNeedsPlacement(false);
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99);
  const npc = core.NPC.create(core.NpcIdentifiers.GIANT_MOLE, new core.Location(1759, 5189, 0));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  npc.setHitpoints(hp);
  function attack(amount, type = core.CombatType.MELEE, accurate = true, delay = 0, hitAmount = 1) {
    const method = new core.CombatMethod();
    method.type = () => type;
    method.handleAfterHitEffects = () => {};
    const hit = new core.PendingHit(p, npc, method,
      { damage: 0, rollAccuracy: false, experience: false, delay, hitAmount });
    for (const part of hit.getHits()) part.setDamage(amount);
    hit.updateTotalDamage();
    hit.isAccurate = () => accurate;
    core.CombatFactory.addPendingHit(hit);
    return hit;
  }
  return { p, npc, tasks, attack, hooks, step: tick => { cycle = tick; npc.getCombat().getHitQueue().process(tick); },
    advance: tick => { cycle = tick; npc.getCombat().preMovementProcess(); npc.getCombat().postMovementProcess(); } };
}
test('the burrow-triggering hit lands instead of being cancelled', t => {
  const s = scene(t);
  s.attack(12);
  assert.equal(s.npc.isUntargetable(), false, 'stay targetable until impact');
  s.step(1);
  assert.equal(s.npc.getHitpoints(), 68);
  assert.equal(s.npc.isUntargetable(), true);
  assert.equal(s.tasks.filter(task => task.key === s.npc && task.getDelay() === 4).length, 1);
});
test('ranged attacks wait for the projectile impact before burrowing', t => {
  const s = scene(t);
  s.attack(12, core.CombatType.RANGED, true, 3);
  s.step(1);
  assert.equal(s.npc.isUntargetable(), false);
  s.step(4);
  assert.equal(s.npc.getHitpoints(), 68);
  assert.equal(s.npc.isUntargetable(), true);
});
for (const hp of [1, 9, 10]) test(`no burrow at ${hp} remaining HP`, t => {
  const s = scene(t, hp);
  s.attack(0);
  s.step(1);
  assert.equal(s.npc.isUntargetable(), false);
  assert.equal(s.tasks.filter(task => task.key === s.npc && task.getDelay() === 4).length, 0);
});
for (const [hp, damage, burrow] of [[110,20,true], [80,70,false], [80,80,false], [101,0,false], [100,0,true], [11,0,true]]) {
  test(`impact ${hp} minus ${damage} checks surviving HP for burrowing`, t => {
    const s = scene(t, hp);
    s.attack(damage);
    s.step(1);
    assert.equal(s.npc.getHitpoints(), hp - damage);
    assert.equal(s.npc.isUntargetable(), burrow);
  });
}
for (const [label, type, accurate, burrow] of [
  ['melee miss','MELEE',false,true], ['ranged miss','RANGED',false,true],
  ['accurate magic zero','MAGIC',true,true], ['magic splash','MAGIC',false,false],
]) test(label, t => {
  const s = scene(t);
  s.attack(0, core.CombatType[type], accurate);
  s.step(1);
  assert.equal(s.npc.isUntargetable(), burrow);
});
test('a failed one-in-four roll leaves the Mole above ground', t => {
  const s = scene(t, 80, 1);
  s.attack(12);
  s.step(1);
  assert.equal(s.npc.getHitpoints(), 68);
  assert.equal(s.npc.isUntargetable(), false);
});
test('each applied hit of a multi-hit attack can trigger the burrow', t => {
  const s = scene(t);
  let rolls = 0;
  t.mock.method(core.Misc, 'getRandom', () => {
    // Ignore the separate poison roll, which runs before the HP changes.
    if (s.npc.getHitpoints() === 80) return 1;
    return ++rolls === 1 ? 1 : 0;
  });
  s.attack(10, core.CombatType.MELEE, true, 0, 2);
  s.step(1);
  assert.equal(s.npc.getHitpoints(), 60);
  assert.equal(rolls, 2, 'the second hit still gets a chance after the first fails');
  assert.equal(s.npc.isUntargetable(), true);
});
test('an early burrow does not discard the other hits already landing', t => {
  const s = scene(t);
  s.attack(10, core.CombatType.MELEE, true, 0, 2);
  s.step(1);
  assert.equal(s.npc.getHitpoints(), 60);
  assert.equal(s.npc.isUntargetable(), true);
  assert.equal(s.tasks.filter(task => task.key === s.npc && task.getDelay() === 4).length, 1);
});
test('direct poison damage does not trigger a burrow', t => {
  const s = scene(t);
  s.npc.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(6, core.HitMask.GREEN).setSource(s.p)]);
  s.step(1);
  assert.equal(s.npc.getHitpoints(), 74);
  assert.equal(s.npc.isUntargetable(), false);
});
test('resurfacing restores targetability and moves to a different spot', t => {
  const s = scene(t);
  const old = s.npc.getLocation().clone();
  s.attack(0);
  s.step(1);
  assert.equal(s.npc.isUntargetable(), true);
  assert.equal(s.npc.getCombat().getTarget(), null);
  for (let i = 0; i < 4; i++) {
    for (const task of [...s.tasks]) if (task.isRunning()) task.tick();
    s.advance(i + 2);
  }
  assert.equal(s.npc.isUntargetable(), false);
  assert.equal(s.npc.isVisible(), true);
  assert.equal(s.npc.getCombat().getTarget(), null);
  assert.equal(s.npc.getLocation().equals(old), false);
});

test('the Wiki respawn of 16 ticks is applied to the Mole on startup', t => {
  const s = scene(t);
  s.hooks.onServerStartup();
  assert.equal(NpcDefinition.forId(5779).getRespawn(), 16, 'wiki respawn');
});

test('a spade on the mole hill digs the player into the lair', t => {
  const s = scene(t);
  s.p.setLocation(new core.Location(2997, 3375, 0));
  s.hooks.onItemOnObject({ player: s.p });
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5236, 0)), 'lands at the lair entrance');
  assert.equal(s.p.getAnimation()?.getId(), 830, 'shared dig animation');
});

test('the rope at the mole hole climbs the player back out of the lair', t => {
  const s = scene(t);
  s.p.setLocation(new core.Location(1752, 5136, 0));
  assert.equal(s.hooks.onObjectFirstClick({ player: s.p, location: new core.Location(1752, 5136, 0) }), true);
  assert.ok(s.p.getLocation().equals(new core.Location(2984, 3314, 0)));
  const elsewhere = new core.Location(1750, 5130, 0);
  s.p.setLocation(elsewhere);
  assert.equal(s.hooks.onObjectFirstClick({ player: s.p, location: new core.Location(1750, 5130, 0) }), false);
  assert.ok(s.p.getLocation().equals(elsewhere), 'a click away from the rope leaves the player put');
});

test('the real thrall attack path can trigger a burrow after its damage lands', t => {
  const s = scene(t);
  const { ArceuusThralls } = require('../dist/game/content/combat/magic/ArceuusThralls');
  const create = core.NPC.create;
  t.mock.method(core.NPC, 'create', (...args) => {
    const thrall = create(...args);
    thrall.isRegistered = () => true;
    thrall.setNeedsPlacement(false);
    return thrall;
  });
  t.mock.method(core.World, 'getAddNPCQueue', () => []);
  t.mock.method(core.World, 'getRemoveNPCQueue', () => []);
  s.p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99);
  s.p.getCombat().setTarget(s.npc);
  // The spell definition uses this cache NPC (its display name is intentionally null).
  const GREATER_GHOST_NPC_ID = 10880;
  ArceuusThralls.summon(s.p, GREATER_GHOST_NPC_ID, 0, 3, 6);
  // The thrall rolls three damage, then the Mole's independent burrow roll is zero.
  let calls = 0;
  t.mock.method(core.Misc, 'getRandom', () => calls++ === 0 ? 3 : 0);
  for (let i = 0; i < 4; i++) for (const task of [...s.tasks]) if (task.isRunning()) task.tick();
  assert.equal(s.npc.getHitpoints(), 80, 'thrall has only queued its damage');
  s.step(1);
  assert.equal(s.npc.getHitpoints(), 77);
  assert.equal(s.npc.isUntargetable(), true);
});
