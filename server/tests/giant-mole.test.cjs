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
  assert.equal(s.tasks.filter(task => task.key === s.npc && task.getDelay() === 3).length, 1);
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
  assert.equal(s.tasks.filter(task => task.key === s.npc && task.getDelay() === 3).length, 0);
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
  assert.equal(s.tasks.filter(task => task.key === s.npc && task.getDelay() === 3).length, 1);
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
  for (let i = 0; i < 7; i++) {
    for (const task of [...s.tasks]) if (task.isRunning()) task.tick();
    s.advance(i + 2);
  }
  assert.equal(s.npc.isUntargetable(), false);
  assert.equal(s.npc.isVisible(), true);
  assert.equal(s.npc.getCombat().getTarget(), null);
  assert.equal(s.npc.getLocation().equals(old), false);
});

function runTasks(s, ticks, from = 2) {
  for (let i = 0; i < ticks; i++) {
    s.advance(from + i);
    for (const task of [...s.tasks]) if (task.isRunning()) task.tick();
  }
}

test('she digs down in sight for 3 ticks before vanishing, then resurfaces 4 ticks later', t => {
  const s = scene(t);
  s.attack(12);
  s.step(1);
  assert.equal(s.npc.getAnimation()?.getId(), 3314, 'mole_burrow_down');
  assert.equal(s.npc.isUntargetable(), true, 'untargetable while digging');
  assert.equal(s.npc.isVisible(), true, 'still seen digging');
  runTasks(s, 2);
  assert.equal(s.npc.isVisible(), true, 'the animation is still playing');
  runTasks(s, 1, 4);
  assert.equal(s.npc.isVisible(), false, 'underground once the dig is done');
  assert.equal(s.npc.isUntargetable(), true);
  runTasks(s, 3, 5);
  assert.equal(s.npc.isVisible(), false);
  runTasks(s, 1, 8);
  assert.equal(s.npc.isVisible(), true);
  assert.equal(s.npc.isUntargetable(), false);
  assert.equal(s.npc.getAnimation()?.getId(), 3315, 'mole_burrow_up');
});

test('dying mid-dig leaves her visible and stops the burrow', t => {
  const s = scene(t);
  s.attack(12);
  s.step(1);
  s.hooks.onNpcBeforeDeath({ npc: s.npc });
  const at = s.npc.getLocation().clone();
  runTasks(s, 8);
  assert.equal(s.npc.isVisible(), true);
  assert.ok(s.npc.getLocation().equals(at), 'no resurfacing elsewhere');
});

test('she makes her resurface spot home: no walk back, no retreat regeneration, and dies home', t => {
  const s = scene(t);
  const lair = s.npc.getSpawnPosition().clone();
  s.attack(12);
  s.step(1);
  runTasks(s, 7);
  const spot = s.npc.getLocation().clone();
  assert.equal(spot.equals(lair), false);
  assert.ok(s.npc.getSpawnPosition().equals(spot), 'home is where she came up');
  const { CoordinateState } = require('../dist/game/entity/impl/npc/NPCMovementCoordinator');
  // Home, not away or retreating: no walk back, and no retreat regeneration (NPC.process).
  assert.equal(s.npc.getMovementCoordinator().getCoordinateState(), CoordinateState.HOME);
  s.hooks.onNpcBeforeDeath({ npc: s.npc });
  assert.ok(s.npc.getSpawnPosition().equals(lair), 'her respawn clone comes back at the lair spawn');
  assert.ok(s.npc.clone().getLocation().equals(lair));
});

test('each life counts her burrows and keeps the tick she last resurfaced and died', t => {
  const s = scene(t);
  const { BURROWS_ATTRIBUTE, SURFACED_TICK_ATTRIBUTE, DIED_TICK_ATTRIBUTE } = Mole;
  assert.equal(s.npc.getAttribute(BURROWS_ATTRIBUTE) ?? 0, 0);
  s.attack(1);
  s.step(1);
  runTasks(s, 7);
  assert.equal(s.npc.getAttribute(BURROWS_ATTRIBUTE), 1);
  assert.equal(s.npc.getAttribute(SURFACED_TICK_ATTRIBUTE), 8, 'up on the 7th tick after the trigger');
  // She came up elsewhere: placed there (the world's update does it), with the player beside her.
  s.npc.setNeedsPlacement(false);
  s.p.setLocation(s.npc.getLocation().transform(1, 1, 0));
  s.attack(1);
  s.step(9);
  runTasks(s, 7, 10);
  assert.equal(s.npc.getAttribute(BURROWS_ATTRIBUTE), 2);
  assert.equal(s.npc.getAttribute(SURFACED_TICK_ATTRIBUTE), 16);
  s.advance(20);
  s.hooks.onNpcBeforeDeath({ npc: s.npc });
  assert.equal(s.npc.getAttribute(DIED_TICK_ATTRIBUTE), 20);
  const clone = s.npc.clone();
  assert.equal(clone.getAttribute(BURROWS_ATTRIBUTE) ?? 0, 0, 'a respawn starts a new life');
});

test('Why Are You Running? and Whack-a-Mole read her life', () => {
  const rules = {};
  const Unit = require('../plugins/achievements/combatachievements/tasks/GiantMole.CombatAchievements');
  Unit(null, { onKill: (name, tests) => { assert.equal(name, 'Giant Mole'); Object.assign(rules, tests); } });
  const mole = (attributes) => ({ getAttribute: (key) => attributes[key] });
  const life = (burrows, surfaced, died) => ({ npc: mole({
    [Mole.BURROWS_ATTRIBUTE]: burrows, [Mole.SURFACED_TICK_ATTRIBUTE]: surfaced, [Mole.DIED_TICK_ATTRIBUTE]: died }) });
  const running = rules['Why Are You Running?'];
  assert.equal(running(life(undefined, undefined, 50)), true, 'never burrowed');
  assert.equal(running(life(2, 30, 50)), true);
  assert.equal(running(life(3, 30, 50)), false);
  const whack = rules['Whack-a-Mole'];
  assert.equal(whack(life(undefined, undefined, 50)), false, 'she has to resurface first');
  assert.equal(whack(life(1, 30, 46)), true, '16 ticks is 9.6 seconds');
  assert.equal(whack(life(1, 30, 47)), false, '17 ticks is 10.2 seconds');
  assert.equal(whack(life(1, 30, 30)), true, 'killed as she comes up');
});

test('the Wiki respawn of 16 ticks is applied to the Mole on startup', t => {
  const s = scene(t);
  s.hooks.onServerStartup();
  assert.equal(NpcDefinition.forId(5779).getRespawn(), 16, 'wiki respawn');
});

test('a spade on the mole hill digs the player into the lair 2 ticks later', t => {
  const s = scene(t);
  const hill = new core.Location(2997, 3375, 0);
  s.p.setLocation(hill);
  assert.equal(s.hooks.onItemOnObject({ player: s.p }), true);
  assert.equal(s.p.getAnimation()?.getId(), 830, 'shared dig animation');
  runTasks(s, 1);
  assert.ok(s.p.getLocation().equals(hill), 'still digging');
  runTasks(s, 1, 3);
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5236, 0)), 'lands at the lair entrance');
});

test('digging with a spade on top of a Falador Park mole hill enters the lair; elsewhere it does not', t => {
  const s = scene(t);
  const hill = new core.Location(2991, 3378, 0);
  t.mock.method(core.MapObjects, 'getObjectsAt', (at) => at.equals(hill) ? [{ getId: () => Mole.MOLE_HILL_ID }] : []);
  const dig = s.hooks.onItemAction.Dig;
  const beside = new core.Location(2992, 3378, 0);
  s.p.setLocation(beside);
  assert.equal(dig({ player: s.p }), false, 'off the hill the click stays open (Nothing interesting happens.)');
  runTasks(s, 3);
  assert.ok(s.p.getLocation().equals(beside));
  s.p.setLocation(hill);
  assert.equal(dig({ player: s.p }), true);
  assert.equal(dig({ player: s.p }), true, 'a second click mid-dig is swallowed');
  runTasks(s, 2, 5);
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5236, 0)));
  assert.equal(s.tasks.length, 1, 'one move, not two');
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

test('Look-inside on a mole hill counts the Mole Hole in a game message (rsprox 1638: none)', t => {
  const named = {};
  Mole.register(new Proxy({ core, onObjectInteraction: (name, actions) => { named[name] = actions; } },
    { get: (obj, key) => obj[key] ?? (() => {}) }));
  const at = (x, y, z) => ({ getLocation: () => new core.Location(x, y, z) });
  const crowd = [at(2996, 3376, 0), at(1758, 5188, 1)];
  const nearRope = at(1752, 5136, 0);
  t.mock.method(core.World, 'getPlayers', () => crowd);
  const messages = [];
  const look = () => named['Mole hill']['Look-inside']({ player: { sendMessage: text => messages.push(text) } });
  look();
  crowd.push(at(1752, 5236, 0));
  look();
  crowd.push(at(1760, 5163, 0));
  look();
  crowd.push(nearRope);
  look();
  assert.deepEqual(messages, [
    'You look inside the mole hill and see no adventurers inside the mole tunnels.',
    'You look inside the mole hill and see one adventurer inside the mole tunnels.',
    'You look inside the mole hill and see 2 adventurers inside the mole tunnels.',
    'You look inside the mole hill and see 3 adventurers inside the mole tunnels.',
  ]);
});
