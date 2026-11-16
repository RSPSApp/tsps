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
  assert.equal(s.npc.hasFlag('combat:no-regen'), true, 'nor the 20-second out-of-combat regeneration');
  assert.equal(s.npc.clone().hasFlag('combat:no-regen'), false, 'her next life regenerates as usual');
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

/** A lit candle in the pack: the Mole Hole is dark (Darkness.plugin.js). */
function carryLight(p) {
  p.getInventory().add(new core.Item(core.ItemIdentifiers.LIT_CANDLE, 1));
}

test('a spade on the mole hill digs the player into the lair 2 ticks later', t => {
  const s = scene(t);
  carryLight(s.p);
  const typed = [];
  const sender = new Proxy({ sendTypedMessage: (type, text) => { typed.push([type, text]); return sender; } }, { get: (obj, key) => obj[key] ?? (() => sender) });
  s.p.getPacketSender = () => sender;
  const hill = new core.Location(2997, 3375, 0);
  s.p.setLocation(hill);
  assert.equal(s.hooks.onItemOnObject({ player: s.p }), true);
  assert.equal(s.p.getAnimation()?.getId(), 830, 'shared dig animation');
  runTasks(s, 1);
  assert.ok(s.p.getLocation().equals(hill), 'still digging');
  runTasks(s, 1, 3);
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)), 'lands at the captured lair tile');
  assert.deepEqual(typed, [[core.ChatType.SPAM, 'You seem to have dropped down into a network of mole tunnels.']], 'captured spam line');
});

test('digging with a spade on top of a Falador Park mole hill enters the lair; elsewhere it does not', t => {
  const s = scene(t);
  carryLight(s.p);
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
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)));
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

test('without a light source the dig is refused with the captured line: no animation, no move (rsprox 240/911352)', t => {
  const s = scene(t);
  const messages = [];
  t.mock.method(s.p, 'sendMessage', text => messages.push(text));
  const hill = new core.Location(2991, 3378, 0);
  t.mock.method(core.MapObjects, 'getObjectsAt', (at) => at.equals(hill) ? [{ getId: () => Mole.MOLE_HILL_ID }] : []);
  s.p.setLocation(hill);
  s.p.getInventory().add(new core.Item(core.ItemIdentifiers.CANDLE, 1));
  assert.equal(s.hooks.onItemAction.Dig({ player: s.p }), true, 'the click is answered');
  assert.equal(s.hooks.onItemOnObject({ player: s.p }), true);
  assert.deepEqual(messages, [Mole.NEED_LIGHT_MESSAGE, Mole.NEED_LIGHT_MESSAGE]);
  assert.equal(messages[0], "It's going to be dark down there, I should bring a light source.");
  assert.equal(s.tasks.length, 0, 'no dig queued');
  assert.notEqual(s.p.getAnimation()?.getId(), 830, 'no dig animation');
  runTasks(s, 3);
  assert.ok(s.p.getLocation().equals(hill), 'still on the hill');

  // Lighting the candle (here: a lit one) lets the next dig through.
  carryLight(s.p);
  assert.equal(s.hooks.onItemAction.Dig({ player: s.p }), true);
  runTasks(s, 2, 5);
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)));
});

test('with the Fire of Eternal Light built (my2arm_fire_mole) no light source is needed', t => {
  const s = scene(t);
  const Darkness = require('../plugins/world/Darkness.plugin');
  Darkness.register({ core, registerArea() {}, log() {}, emitCustomEvent() {} });
  const fire = core.CacheDefinitions.getVarbitId('my2arm_fire_mole');
  assert.equal(fire, 6532);
  let built = 0;
  const sender = new Proxy({ getVarbit: id => (id === fire ? built : 0) }, { get: (obj, key) => obj[key] ?? (() => sender) });
  s.p.getPacketSender = () => sender;
  const hill = new core.Location(2997, 3375, 0);
  s.p.setLocation(hill);
  assert.equal(Darkness.canSeeAt(s.p, new core.Location(1752, 5237, 0)), false, 'dark without the fire');
  assert.equal(Darkness.canSeeAt(s.p, hill), true, 'Falador Park is not dark');
  built = 1;
  assert.equal(Darkness.canSeeAt(s.p, new core.Location(1752, 5237, 0)), true);
  assert.equal(s.hooks.onItemOnObject({ player: s.p }), true);
  runTasks(s, 2);
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)));
});

function instanceScene(t, { coins = 30000, hard = 0, iron = false, light = true } = {}) {
  const named = {}, hooks = {}, tasks = [], spawned = [], prompts = [];
  const api = new Proxy({
    core,
    onObjectInteraction: (name, actions) => { named[name] = actions; },
    onItemOnObject: (item, object, handler) => { hooks.itemOnObject = handler; },
    sendMultiChatboxPrompt: (player, title, ...pairs) => { prompts.push({ title, pairs }); return true; },
    onPlayerLogin: handler => { hooks.login = handler; },
    onNpcDeath: handler => { hooks.death = handler; },
    onCustomEvent: (name, handler) => { hooks[name] = handler; },
    emitCustomEvent: (name, query) => { if (name === 'ironman:mode' && iron) query.mode = 'standard'; },
    spawnNpc: ({ id, x, y, z }) => {
      const npc = core.NPC.create(id, new core.Location(x, y, z));
      spawned.push(npc);
      return npc;
    },
  }, { get: (obj, key) => obj[key] ?? (() => {}) });
  Mole.register(api);
  t.mock.method(core.TaskManager, 'submit', task => { task.setRunning(true); tasks.push(task); });
  const p = new Player(null);
  p.setUsername('mole-instance');
  const hardId = core.CacheDefinitions.getVarbitId('ca_tier_status_hard');
  const sender = new Proxy({ getVarbit: id => (id === hardId ? hard : 0) }, { get: (obj, key) => obj[key] ?? (() => sender) });
  p.getPacketSender = () => sender;
  const messages = [];
  p.sendMessage = text => messages.push(text);
  const spade = new core.Location(2983, 3387, 0);
  p.setLocation(spade);
  if (light) p.getInventory().add(new core.Item(core.ItemIdentifiers.LIT_CANDLE, 1));
  if (coins > 0) p.getBank(0).add(new core.Item(core.ItemIdentifiers.COINS, coins));
  const fight = () => named.Spade['Fight-privately']({ player: p, objectId: core.ObjectIdentifiers.SPADE_5 });
  return { p, named, hooks, tasks, spawned, messages, spade, fight, prompts };
}

/** Digs on a mole hill with the warning screen on, presses Yes, and returns the tunnels prompt. */
function digWithWarning(t, s) {
  let warning = null;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    if (name === 'warning-screen:show') { event.handled = true; warning = event; }
  });
  const typed = [];
  const sender = s.p.getPacketSender();
  const send = new Proxy({ sendTypedMessage: (type, text) => { typed.push([type, text]); return send; } },
    { get: (obj, key) => obj[key] ?? sender[key] });
  s.p.getPacketSender = () => send;
  s.p.isRegistered = () => true;
  const hill = new core.Location(2996, 3377, 0);
  s.p.setLocation(hill);
  assert.equal(s.hooks.itemOnObject({ player: s.p }), true);
  assert.ok(warning, 'the warning screen opens');
  assert.equal(s.prompts.length, 0, 'no choice before Yes');
  s.p.performAnimation(new core.Animation(-1));
  warning.proceed();
  assert.equal(s.prompts.length, 1);
  const prompt = s.prompts[0];
  assert.equal(prompt.title, 'What kind of tunnels would you like to enter?');
  assert.deepEqual(prompt.pairs.filter((value) => typeof value === 'string'), ['Public.', 'Private.']);
  assert.ok(s.p.getLocation().equals(hill), 'still on the hill while choosing');
  const choose = (label) => prompt.pairs[prompt.pairs.indexOf(label) + 1]();
  const tick = () => { for (const task of [...s.tasks]) if (task.isRunning()) task.tick(); };
  return { hill, typed, choose, tick };
}

// rsprox_transcripts/227/910326.txt ticks 1292-1295: Yes, the prompt, Public. digs again and drops a tick later.
test('Yes on the mole hill warning asks which tunnels; Public. digs again and drops into the lair a tick later', t => {
  const s = instanceScene(t, { coins: 30000 });
  const dig = digWithWarning(t, s);
  dig.choose('Public.');
  assert.equal(s.p.getAnimation()?.getId(), 830, 'the dig plays again on the choice');
  assert.ok(s.p.getLocation().equals(dig.hill));
  dig.tick();
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)), 'the public lair a tick after the choice');
  assert.equal(s.p.getPrivateArea(), null);
  assert.deepEqual(dig.typed, [[core.ChatType.SPAM, 'You seem to have dropped down into a network of mole tunnels.']]);
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 30000, 'public tunnels are free');
});

// rsprox_transcripts/227/910356.txt ticks 13201-13207: Private. digs again and drops into an instance a tick later;
// the Wiki's fee is taken from the bank as Fight-privately takes it.
test('Private. on the mole hill rents the instance a tick after the choice; short of coins it stays outside', t => {
  const s = instanceScene(t, { coins: 25000 });
  const dig = digWithWarning(t, s);
  dig.choose('Private.');
  assert.equal(s.p.getAnimation()?.getId(), 830);
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 25000, 'nothing taken before the drop');
  dig.choose('Private.');
  dig.tick();
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)));
  assert.ok(s.p.getPrivateArea() instanceof core.PrivateArea, 'a private lair');
  assert.equal(s.spawned.length, 1, 'one instance, one Mole, despite a second click');
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 0, 'the fee once');
  assert.deepEqual(s.messages, ['<col=ef1020>25,000 coins is taken from your bank to rent a private instance.</col>']);
  assert.deepEqual(dig.typed, [[core.ChatType.SPAM, 'You seem to have dropped down into a network of mole tunnels.']]);

  const short = instanceScene(t, { coins: 24999 });
  const outside = digWithWarning(t, short);
  outside.choose('Private.');
  outside.tick();
  assert.ok(short.p.getLocation().equals(outside.hill), 'short of coins: still on the hill');
  assert.equal(short.p.getPrivateArea(), null);
  assert.deepEqual(short.messages, ['You need 25,000 coins in your bank to rent a private instance.']);
  assert.deepEqual(outside.typed, [], 'no drop line');
});

test('Fight-privately on the north-west spade without a light source is refused first (rsprox 240/911352 tick 45)', t => {
  const s = instanceScene(t, { light: false });
  assert.equal(core.ObjectIdentifiers.SPADE_5, 29460, 'mole_hill_spade');
  assert.equal(s.fight(), true);
  assert.deepEqual(s.messages, ["It's going to be dark down there, I should bring a light source."]);
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 30000, 'no fee taken');
  assert.ok(s.p.getLocation().equals(s.spade));
  assert.equal(s.spawned.length, 0);
});

test('Fight-privately refuses when the bank is short and takes nothing', t => {
  const s = instanceScene(t, { coins: 24999 });
  assert.equal(s.fight(), true);
  assert.deepEqual(s.messages, ['You need 25,000 coins in your bank to rent a private instance.']);
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 24999);
  assert.ok(s.p.getLocation().equals(s.spade));
  assert.equal(s.p.getPrivateArea(), null);
});

test('a rented instance takes the fee from the bank and drops the player into a private lair with her own Mole', t => {
  const s = instanceScene(t, { coins: 25000 });
  assert.equal(s.fight(), true);
  assert.deepEqual(s.messages, ['<col=ef1020>25,000 coins is taken from your bank to rent a private instance.</col>']);
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 0, 'the exact fee');
  assert.ok(s.p.getLocation().equals(new core.Location(1752, 5237, 0)));
  const instance = s.p.getPrivateArea();
  assert.ok(instance instanceof core.PrivateArea);
  assert.equal(instance.getName(), 'Mole Hole');
  assert.equal(s.spawned.length, 1);
  const mole = s.spawned[0];
  assert.equal(mole.getId(), core.NpcIdentifiers.GIANT_MOLE);
  assert.equal(mole.getPrivateArea(), instance, 'her own Mole, in the instance');
  assert.ok(mole.getLocation().equals(new core.Location(1759, 5189, 0)), 'at her lair spawn');
  assert.equal(s.p.getAttribute(Mole.INSTANCE_ATTRIBUTE), true);
  assert.equal(s.fight(), true, 'a second click from inside does nothing');
  assert.equal(s.spawned.length, 1);
  assert.equal(s.messages.length, 1);

  // A kill brings her next life 16 ticks later while the player is still there.
  s.hooks.death({ npc: mole });
  const respawn = s.tasks.find(task => task.getDelay() === 16);
  assert.ok(respawn, 'respawn after 16 ticks');
  respawn.execute();
  assert.equal(s.spawned.length, 2);
  assert.equal(s.spawned[1].getPrivateArea(), instance);

  // Look-inside does not count players in private instances.
  t.mock.method(core.World, 'getPlayers', () => [s.p]);
  s.named['Mole hill']['Look-inside']({ player: s.p });
  assert.equal(s.messages.at(-1), 'You look inside the mole hill and see no adventurers inside the mole tunnels.');

  // The instance is as dark as the public lair.
  s.p.getInventory().delete(core.ItemIdentifiers.LIT_CANDLE, 1);
  assert.equal(instance.canAttack(s.p, mole), false, 'no attacking her in the dark');
  for (let tick = 0; tick < 15; tick++) instance.process(s.p);
  assert.equal(s.messages.at(-1), 'You hear tiny insects skittering over the ground...');

  // A death in it leaves the grave by the spade, outside the entrance (Wiki, Instance).
  const grave = { player: s.p, location: s.p.getLocation(), tile: null, feeMultiplier: 1 };
  s.hooks['gravestones:grave-location'](grave);
  assert.deepEqual(grave.tile, { x: 2983, y: 3387, z: 0 }, 'grave outside the instance entrance');
  const publicGrave = { player: new Player(null), location: new core.Location(1752, 5237, 0), tile: null };
  publicGrave.player.setLocation(new core.Location(1752, 5237, 0));
  s.hooks['gravestones:grave-location'](publicGrave);
  assert.equal(publicGrave.tile, null, 'a death in the public lair keeps its own grave spot');

  // Logging out in it ends it; the next login is by the spade.
  instance.leave(s.p, true);
  assert.equal(instance.isDestroyed(), true, 'the instance ends with its player');
  assert.equal(s.p.getAttribute(Mole.INSTANCE_ATTRIBUTE), true, 'remembered across the logout');
  s.hooks.login({ player: s.p });
  assert.ok(s.p.getLocation().equals(s.spade));
  assert.equal(s.p.getAttribute(Mole.INSTANCE_ATTRIBUTE), false);
});

for (const [label, options, fee] of [
  ['the hard Combat Achievement tier', { hard: 1 }, 12500],
  ['an ironman', { iron: true }, 12500],
  ['an ironman with the hard tier', { hard: 1, iron: true }, 6250],
]) test(`the instance costs ${fee} for ${label} (Wiki, Mole Hole)`, t => {
  const s = instanceScene(t, { coins: fee, ...options });
  s.fight();
  assert.equal(s.messages[0], `<col=ef1020>${fee.toLocaleString('en-US')} coins is taken from your bank to rent a private instance.</col>`);
  assert.equal(s.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 0);
});
