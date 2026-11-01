// Run after `yarn build`: node --test tests/arrival-animation.test.cjs
// OSRS p_arrivedelay: the client drops a priority-1 seq sent with a step.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { getSequencePriority, getSequenceStall } = require('../dist/game/cache/NpcAnimationScanner');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Animation } = require('../dist/game/model/Animation');
const { Combat } = require('../dist/game/content/combat/Combat');
const { World } = require('../dist/game/World');
const { Location } = require('../dist/game/model/Location');

test('a skilling seq started on a step is held a tick; combat seqs are not', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  assert.equal(getSequencePriority(621), 1, 'net fishing is dropped by movement');
  assert.equal(getSequencePriority(422), -1, 'punch is not');

  const played = [];
  let stepped = true;
  const player = Object.create(Player.prototype);
  Object.assign(player, {
    animation: null,
    getMovementQueue: () => ({ steppedThisWorldCycle: () => stepped }),
    getUpdateFlag: () => ({ flag: () => played.push(player.animation.getId()) }),
    getCombat: () => ({ onAnimationStarted: () => {} }),
  });

  player.performAnimation(new Animation(621));
  assert.deepEqual(played, [], 'held on the arrival step');
  assert.equal(player.arrivalAnimation.getId(), 621);
  player.performAnimation(new Animation(422));
  assert.deepEqual(played, [422], 'combat plays at once');
  assert.equal(player.arrivalAnimation, null, 'a newer animation replaces the held one');

  stepped = false;
  player.animation = null; // a later tick: this one's punch would keep its place (interrupt priority)
  player.performAnimation(new Animation(621));
  assert.deepEqual(played, [422, 621], 'standing still plays at once');
});

test('a sequence priority lookup reads the decoded archive, not a fresh decompress each time', async () => {
  const { preloadSequences } = require('../dist/game/cache/NpcAnimationScanner');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  preloadSequences();
  const start = performance.now();
  for (let id = 8000; id < 8200; id++) getSequencePriority(id);
  // Each fresh decompress took ~100 ms; 200 first-time lookups now take well under one.
  assert.ok(performance.now() - start < 50, `${(performance.now() - start).toFixed(1)} ms for 200 lookups`);
  assert.equal(getSequencePriority(733), 1, 'cooking is still dropped by movement');
});

// Wiki: Animation stall. The seq config says how long the client keeps the animation on screen.
// It can withhold the actor's steps too (a partial stall), but the server keeps walking the true
// tile; full stalls are content, never cache config.
test('the cache says how long a swing animation stays on screen', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  // Crossbows run 81 client cycles: the hunters' crossbow stall the Wiki names.
  assert.equal(getSequenceStall(4230).ticks, 3);
  assert.equal(getSequenceStall(401).ticks, 2, 'a battleaxe swing');
  assert.equal(getSequenceStall(711).ticks, 3, 'a wind strike cast');
});

/** A player with a real Combat, and only the packet and movement plumbing stubbed out. */
function buildFighter(stepped) {
  const sent = [];
  const player = Object.create(Player.prototype);
  const combat = new Combat(player);
  Object.assign(player, {
    animation: null,
    getCombat: () => combat,
    getIndex: () => 7,
    getLocation: () => new Location(3200, 3200, 0),
    getMovementQueue: () => ({
      steppedThisWorldCycle: () => stepped,
      reset: () => {},
    }),
    getUpdateFlag: () => ({ flag: () => sent.push(player.animation.getId()) }),
    getPacketSender: () => ({
      sendConfig: () => {},
      sendDestination: () => {},
      sendAttackTimer: () => {},
      sendRunStatus: () => {},
    }),
    setMobileInteraction: () => {},
    setPositionToFace: () => {},
    setFollowing: () => {},
    getTimers: () => ({ has: () => false }),
    isNeedsPlacement: () => false,
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    getForceMovement: () => null,
    hasFlag: () => false,
    isRegistered: () => true,
    getHitpoints: () => 50,
  });
  combat.attack(swingTarget());
  return { player, combat, sent };
}

/**
 * Stands in for a data row: makes core measure this seq as a full stall. The real row is
 * covered by the definition-file test; hit stacking needs a full stall and no player fixture
 * here owns an equipment container to give the plugin.
 */
const forcedFullStalls = new Set();
let fullStallHookInstalled = false;
function forceFullStall(animationId) {
  if (!fullStallHookInstalled) {
    const { PluginManager } = require('../dist/plugins/PluginManager');
    PluginManager.createApi('TestFullStall').onAnimationStall((event) => {
      if (forcedFullStalls.has(event.animationId)) event.kind = 'full';
    });
    fullStallHookInstalled = true;
  }
  forcedFullStalls.add(animationId);
  return () => forcedFullStalls.delete(animationId);
}

function swingTarget() {
  return {
    isPlayer: () => true,
    isNpc: () => false,
    getIndex: () => 8,
    getLocation: () => new Location(3201, 3200, 0),
    getCombat: () => ({ getAttacker: () => ({ isNpc: () => false }) }),
    getBlockAnim: () => 424,
    performAnimation: () => {},
  };
}

/** The swing itself, with the real attack pipeline in front of it. */
test('a swing through Combat measures a partial stall and keeps the true tile walking', async (t) => {
  const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { CombatRange } = require('../dist/game/content/combat/CombatRange');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 200;
  const { player, combat, sent } = buildFighter(false);
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;

  const method = {
    type: () => CombatType.RANGED,
    attackSpeed: () => 4,
    onCombatBegan: () => {},
    onCombatEnded: () => {},
    finished: () => {},
    requireProjectiles: () => false,
    hits: () => [],
    start: (character) => character.performAnimation(new Animation(4230)),
  };
  t.mock.method(CombatFactory, 'validTarget', () => true);
  t.mock.method(CombatFactory, 'canAttackPermission', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'canAttack', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'getMethod', () => method);
  t.mock.method(CombatRange, 'canReach', () => true);

  assert.equal(queue.getMobility().canMove(), true, 'free before the swing');
  combat.attack(swingTarget());
  assert.equal(combat.performNewAttack(false), true, 'the swing went off');

  assert.deepEqual(sent, [4230], 'the swing played its animation');
  assert.equal(combat.getAnimationStallTicks(), 0,
      'the seq withholds steps visually, so it is a partial stall, not a full one');
  assert.equal(combat.getIncomingHitCycle(), -1, 'a partial stall does not stack incoming hits');
  assert.equal(queue.getMobility().canMove(), true, 'a partial stall does not hold their feet');
  queue.addSteps(new Location(3200, 3201, 0));
  assert.equal(queue.size(), 1, 'a click during the animation still walks the true tile');

  World.processCycle = 203;
  assert.equal(queue.getMobility().canMove(), true, 'and the server never locks them');
});

/**
 * Issue #1679: casting a spell is a partial stall, not a full one. A player who clicks away the
 * tick the cast lands must keep their true tile walking; the client holds the animation on the
 * old tile and rubber-bands them once it ends.
 */
test('a spell cast leaves movement and the true tile free while its animation plays', async (t) => {
  const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { CombatRange } = require('../dist/game/content/combat/CombatRange');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 210;
  const { player, combat, sent } = buildFighter(false);
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;

  const method = {
    type: () => CombatType.MAGIC,
    attackSpeed: () => 5,
    onCombatBegan: () => {},
    onCombatEnded: () => {},
    finished: () => {},
    requireProjectiles: () => false,
    hits: () => [],
    start: (character) => character.performAnimation(new Animation(711)), // wind strike
  };
  t.mock.method(CombatFactory, 'validTarget', () => true);
  t.mock.method(CombatFactory, 'canAttackPermission', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'canAttack', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'getMethod', () => method);
  t.mock.method(CombatRange, 'canReach', () => true);

  combat.attack(swingTarget());
  assert.equal(combat.performNewAttack(false), true, 'the cast went off');
  assert.deepEqual(sent, [711], 'the cast animation plays');

  assert.equal(combat.isAnimationStalled(), false, 'a cast is not a full stall');
  assert.equal(queue.getMobility().canMove(), true, 'the player may walk the same tick');
  queue.addSteps(new Location(3200, 3201, 0));
  assert.equal(queue.size(), 1, 'and their true tile takes the step');

  // Process the tick: the step lands even though the client will keep the cast on screen.
  let location = new Location(3200, 3200, 0);
  player.getLocation = () => location;
  player.setLocation = (next) => { location = next; return player; };
  queue.handleRegionChange = () => {};
  queue.syncWildernessStateForMovedPlayer = () => {};
  queue.drainRunEnergy = () => {};
  queue.process();
  assert.deepEqual([location.getX(), location.getY()], [3200, 3201],
      'the true tile walked under the still-playing cast');

  // The partial stall still owns the animation: a click that drops the target must not cut it.
  combat.clearInteraction();
  assert.deepEqual(sent, [711], 'the click left the cast animation playing');
});

/**
 * The real special attack plugin, handed the same core api the server hands it, so the swing under
 * test plays the two animations the real one does: the normal attack through super.start(), then
 * the special performed over it.
 */
function dragon2hSpecialMethod() {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const captured = { definition: null };
  // A special module exports its register function directly, not a { name, register } plugin.
  require('../plugins/combat/specials/Dragon2hSword.SpecialAttack')({
    core: PluginManager.getCoreApi(),
    registerCombatSpecial: (special) => { captured.definition = special; },
  });
  assert.ok(captured.definition?.combatMethod, 'the plugin registered its combat method');
  return captured.definition.combatMethod;
}

// Dragon2hSword.SpecialAttack.start calls super.start() and then replaces that animation with its
// own, as most specials do. Measuring the first one holds the player for a swing the client no
// longer shows and lets the next click cut the special off mid-play (Wiki: Animation stall).
test('a special that replaces its own swing is measured from the animation that ends up on screen', async (t) => {
  const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { CombatRange } = require('../dist/game/content/combat/CombatRange');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 200;
  const { player, combat, sent } = buildFighter(false);

  const NORMAL = 407; // the swing MeleeCombatMethod.start performs
  const SPECIAL = 3157; // the animation the special plays over it
  const normalTicks = getSequenceStall(NORMAL).ticks;
  const specialTicks = getSequenceStall(SPECIAL).ticks;
  assert.ok(specialTicks > normalTicks,
      `the special must outlast the swing it replaces (${normalTicks} then ${specialTicks})`);

  player.getAttackAnim = () => NORMAL;
  player.getAttackSound = () => null; // nothing to send
  player.getBaseAttackSpeed = () => 4;
  player.getCombatSpecial = () => null;
  player.getSpecialPercentage = () => 100; // so CombatSpecial.drain schedules no restore task
  player.decrementSpecialPercentage = () => {};
  player.isSpecialActivated = () => false;
  player.getWeapon = () => null;
  player.performGraphic = () => {};
  // CombatSpecial.drain redraws the special-attack orb, which the plain swing fixture never needs.
  const sender = {
    sendConfig: () => {},
    sendDestination: () => {},
    sendAttackTimer: () => {},
    sendRunStatus: () => {},
    updateSpecialAttackOrb: () => {},
    sendSpecialAttackState: () => {},
  };
  player.getPacketSender = () => sender;

  t.mock.method(CombatFactory, 'validTarget', () => true);
  t.mock.method(CombatFactory, 'canAttackPermission', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'canAttack', () => CanAttackResponse.CAN_ATTACK);
  // start() is what is under test and stays the real one; only the hit list is stubbed, because
  // building a PendingHit needs a target wired all the way down to its defence roll (the ranged
  // swing fixture above stubs hits for the same reason).
  const special = Object.create(dragon2hSpecialMethod());
  special.hits = () => [];
  t.mock.method(CombatFactory, 'getMethod', () => special);
  t.mock.method(CombatFactory, 'addPendingHit', () => {}); // this test is about the animation
  t.mock.method(CombatRange, 'canReach', () => true);

  combat.attack(swingTarget());
  assert.equal(combat.performNewAttack(false), true, 'the special went off');
  assert.deepEqual(sent, [NORMAL, SPECIAL], 'the special replaced its own swing on screen');

  // The tick the *replaced* swing would have been over. Measuring it instead of the special is what
  // made clearInteraction answer with 65535 here and cut the powerstab short.
  World.processCycle = 200 + normalTicks;
  combat.clearInteraction();
  assert.deepEqual(sent, [NORMAL, SPECIAL],
      'a click cannot cut the special off while it still plays');

  World.processCycle = 200 + specialTicks;
  assert.equal(combat.getIncomingHitCycle(), -1, 'the hold ends when the special has played out');
  // An ordinary reset needs an interaction to drop (clearInteraction above already took the
  // first one away), so re-attack without swinging: that is how the click that ends a stall works.
  combat.attack(swingTarget());
  combat.clearInteraction();
  assert.equal(sent.at(-1), 65535,
      'once the special has played out an ordinary reset goes out again');
});

/** The Slice and Dice special, registered from the plugin that ships it. */
function dragonClawsSpecial() {
  const { CombatSpecial } = require('../dist/game/content/combat/CombatSpecial');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  let definition = null;
  require('../plugins/combat/specials/DragonClaw.SpecialAttack')({
    core: PluginManager.getCoreApi(),
    registerCombatSpecial: (special) => { definition = special; },
  });
  CombatSpecial.register(definition);
  const registered = CombatSpecial.getById('dragon_claws');
  assert.ok(registered, 'the claws special registered');
  return registered;
}

/** An attacker with the claws special active; enough for the real traits lookup. */
function clawsAttacker(special) {
  const attacker = {
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getHitpoints: () => 99,
    isSpecialActivated: () => true,
    getCombatSpecial: () => special,
  };
  attacker.getAsPlayer = () => attacker;
  return attacker;
}

/**
 * A real claws swing: the real PendingHit resolving the real registered traits. Only the roll is
 * scripted - the same seam melee-special-weapons.test.cjs uses - because this fixture has no world
 * to roll accuracy or strength in.
 */
function clawsSwing(attacker, target, baseDamage) {
  const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
  const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { AccuracyFormulasDpsCalc } =
      require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
  const realAccuracy = AccuracyFormulasDpsCalc.rollAccuracy;
  const realDamage = CombatFactory.getHitDamage;
  AccuracyFormulasDpsCalc.rollAccuracy = () => true;
  CombatFactory.getHitDamage = () => new HitDamage(baseDamage, 1);
  try {
    return new PendingHit(attacker, target, {
      type: () => CombatType.MELEE,
      accuracyDefenceType: () => undefined,
    });
  } finally {
    AccuracyFormulasDpsCalc.rollAccuracy = realAccuracy;
    CombatFactory.getHitDamage = realDamage;
  }
}

/** The swing fixture, with hitpoints that go down as the queue applies damage. */
function buildDamageTarget() {
  const fighter = buildFighter(false);
  let hp = 100;
  const taken = [];
  fighter.player.getHitpoints = () => hp;
  fighter.player.decrementHealth = (hit) => {
    hit.setDamage(Math.min(hit.getDamage(), hp));
    hp -= hit.getDamage();
    taken.push(hit.getDamage());
    return hit;
  };
  fighter.player.addTickHit = () => {};
  return { ...fighter, taken };
}

/** The bolt plugin reading the server's own core api, so real item names pick the effect. */
function realBoltHandlers() {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const EnchantedBolts = require('../plugins/combat/EnchantedBolts.plugin');
  EnchantedBolts._test.attach({ core: PluginManager.getCoreApi(), emitCustomEvent: () => {} });
  return EnchantedBolts;
}

/** A rune crossbow and enchanted ruby bolts, worn through the real equipment container. */
function equipRubyCrossbow(player, combat) {
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
  const { Ammunition, RangedWeapon } = require('../dist/game/content/combat/ranged/RangedData');
  const equipment = new Equipment(player);
  equipment.set(Equipment.WEAPON_SLOT, new Item(ItemIdentifiers.RUNE_CROSSBOW));
  player.equipment = equipment;
  player.setWeapon(WeaponInterfaces.CROSSBOW);
  combat.setRangedWeapon(RangedWeapon.RUNE_CROSSBOW);
  combat.setAmmunition(Ammunition.ENCHANTED_RUBY_BOLT);
}

// A multi-hit special's tail never rides in pendingHits: CombatFactory.applyResolvedHitDamage
// schedules each splat past its own delay straight into the target's pendingDamage list - dragon
// claws' Slice and Dice lands its front pair, then a tick later its back pair (Wiki: Animation
// stall queues the hits coming in to the player, so a stalled target must not take the tail early).
test('a stalled player takes a delayed special hit only when the animation releases', async (t) => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 301;
  const { player, combat, taken } = buildDamageTarget();
  t.after(forceFullStall(4230));
  const queue = combat.getHitQueue();

  const swing = clawsSwing(clawsAttacker(dragonClawsSpecial()), player, 35);
  assert.deepEqual(swing.getHits().map((hit) => hit.getDamage()), [35, 17, 8, 9], 'the real chain');
  assert.deepEqual([...swing.getHitDelays()], [0, 0, 1, 1],
      'and the back pair arrives a tick later');

  // applyResolvedHitDamage is what executeHit calls to spread the splats across the two ticks;
  // the rest of executeHit needs a live world (sounds, prayers, retaliation) and is not here.
  CombatFactory.applyResolvedHitDamage(player, swing);
  queue.process(301);
  assert.deepEqual(taken, [35, 17], 'the front pair lands on the swing tick');

  player.getCombat().expectAttackAnimation();
  player.performAnimation(new Animation(4230)); // 3 ticks, promoted to a full stall for this test
  assert.equal(combat.getIncomingHitCycle(), 304, 'held through cycle 304');

  World.processCycle = 302;
  TaskManager.process(); // the delayed splats are scheduled into the queue
  queue.process(302);
  assert.deepEqual(taken, [35, 17], 'the tail waits behind the animation');

  World.processCycle = 304;
  queue.process(304);
  assert.deepEqual(taken, [35, 17, 8, 9], 'the whole chain lands as the animation releases');
});

test('stopping the animation early releases the delayed special hit with it', async (t) => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 301;
  const { player, combat, taken } = buildDamageTarget();
  t.after(forceFullStall(4230));
  const queue = combat.getHitQueue();

  const swing = clawsSwing(clawsAttacker(dragonClawsSpecial()), player, 35);
  CombatFactory.applyResolvedHitDamage(player, swing);
  queue.process(301);
  assert.deepEqual(taken, [35, 17], 'the front pair landed');

  player.getCombat().expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  assert.equal(combat.getIncomingHitCycle(), 304, 'held through cycle 304');

  World.processCycle = 302;
  TaskManager.process();
  queue.process(302);
  assert.deepEqual(taken, [35, 17], 'the tail is held');

  World.processCycle = 303;
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION); // content ends the swing on purpose
  queue.process(303);
  assert.deepEqual(taken, [35, 17, 8, 9],
      'the tail lands on the tick the player is free, not on the deadline the stall once had');
});

// The cost of a ruby bolt (e) is the shooter's own hitpoints, queued with no other combatant as
// its source, so the stall must not hold it. Breaking the drain at the first held splat let a
// player who fired one while a delayed special was queued behind their animation dodge the cost
// until the stall ended - and whether they dodged it depended on which entry was queued first.
test('a stalled player still pays a bolt effect that costs them their own hitpoints', async (t) => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
  const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const EnchantedBolts = realBoltHandlers();

  World.processCycle = 301;
  const { player, combat, taken } = buildDamageTarget();
  t.after(forceFullStall(4230));
  const queue = combat.getHitQueue();
  equipRubyCrossbow(player, combat);
  player.getPacketSender = () => ({
    sendConfig: () => {},
    sendDestination: () => {},
    sendAttackTimer: () => {},
    sendRunStatus: () => {},
    sendSoundEffect: () => {},
  });

  const swing = clawsSwing(clawsAttacker(dragonClawsSpecial()), player, 15);
  assert.deepEqual(swing.getHits().map((hit) => hit.getDamage()), [15, 7, 3, 4], 'the real chain');
  CombatFactory.applyResolvedHitDamage(player, swing);
  queue.process(301);
  assert.deepEqual(taken, [15, 7], 'the front pair lands on the swing tick');
  assert.equal(player.getHitpoints(), 78);

  player.getCombat().expectAttackAnimation();
  player.performAnimation(new Animation(4230)); // 3 ticks, promoted to a full stall for this test
  assert.equal(combat.getIncomingHitCycle(), 304, 'held through cycle 304');

  World.processCycle = 302;
  TaskManager.process(); // the delayed tail is queued behind the animation
  queue.process(302);
  assert.deepEqual(taken, [15, 7], 'the tail waits');

  // The player's own bolt lands now, with the tail still held: Blood Forfeit takes a tenth of
  // their 78 hitpoints. Only the force-proc attribute is set, so the roll is not left to chance.
  const prey = { isPlayer: () => false, getHitpoints: () => 60, performGraphic: () => {} };
  const bolt = { getDelay: () => 2 };
  player.setAttribute('enchanted-bolts:force-proc', true);
  EnchantedBolts._test.rollBoltEffect({
    attacker: player,
    target: prey,
    combatType: CombatType.RANGED,
    hit: bolt,
    damage: new HitDamage(12, HitMask.RED),
    accurate: true,
  });
  EnchantedBolts._test.landBoltEffect({ attacker: player, target: prey, hit: bolt });
  assert.equal(queue.getQueuedDamage(), 14, 'the held tail and the bolt cost are both queued');

  World.processCycle = 303;
  queue.process(303);
  assert.deepEqual(taken, [15, 7, 7], 'the bolt cost lands on its own tick, behind the held tail');
  assert.equal(player.getHitpoints(), 71, 'and the queue order never decided whether it did');

  World.processCycle = 304;
  queue.process(304);
  assert.deepEqual(taken, [15, 7, 7, 3, 4],
      'the held chain still arrives together, in the order the client shows it');
  assert.equal(player.getHitpoints(), 64);
});

test('a swing is measured from its own animation, and a click does not cut it away', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 100;
  const { player, combat, sent } = buildFighter(false);

  combat.expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  assert.deepEqual(sent, [4230], 'the swing plays out');
  assert.equal(combat.getAnimationStallTicks(), 0,
      'its 81 cycles withhold steps on the client, a partial stall the server never locks for');

  // Only the armed swing is measured: a flinch or an overhead effect stalls nobody. The block
  // does not even reach the screen here - the cache gives an attack interrupt priority 6 and a
  // block 5, so it cannot replace the swing it lands on (Wiki: Animation interrupt priority).
  player.performAnimation(new Animation(424));
  assert.equal(combat.isAnimationStalled(), false, 'the block anim that followed holds nobody');

  combat.clearInteraction();
  assert.deepEqual(sent, [4230], 'the click that dropped the target left the animation playing');

  // The partial stall ends with the animation, and an ordinary reset may cut what follows.
  World.processCycle = 103;
  combat.attack(swingTarget());
  combat.clearInteraction();
  assert.equal(sent.at(-1), 65535, 'an ordinary reset still stops the animation');
});

test('a swing started on the tick the player stepped holds their actions but not their feet', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 100;
  const { player, combat, sent } = buildFighter(true);

  combat.expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  // The rubber band: their true tile keeps moving under the animation, so no click is held and
  // no hit waits - but the animation itself still plays to its end.
  assert.equal(combat.isAnimationStalled(), false, 'a moving start is not a full stall');
  combat.clearInteraction();
  assert.deepEqual(sent, [4230], 'and the click still cannot cut the animation away');
});

test('content that stops a full stall on purpose releases it with the animation', async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 100;
  const { player, combat } = buildFighter(false);
  t.after(forceFullStall(4230));

  combat.expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  assert.equal(combat.getAnimationStallTicks(), 3, 'the promoted swing still locks');
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  assert.equal(combat.getAnimationStallTicks(), 0, 'teleports and deaths are not held by a swing');
});

test('the definition file declares no unsourced full stalls', () => {
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  const stalls = require('../plugins/combat/data/animation-stalls.json');
  // The Wiki's "Attack animation stalls" list does not distinguish full stalls from partial
  // ones, so a row needs evidence beyond membership in it. None has that today.
  assert.deepEqual(stalls.animations, {}, 'no animation rows');
  assert.deepEqual(stalls.weapons, {}, 'no weapon rows');

  let applyStall = null;
  require('../plugins/combat/AnimationStalls.plugin').register({
    core: { Equipment },
    onAnimationStall: (handler) => { applyStall = handler; },
  });

  // The leaf-bladed battleaxe's walk delay was fixed on 9 July 2020 (Wiki: Leaf-bladed
  // battleaxe - Changes), so it is a partial stall like the other listed attack animations.
  const named = {
    player: {
      getEquipment: () => ({
        get: (slot) => slot === Equipment.WEAPON_SLOT
            ? { getId: () => ItemIdentifiers.LEAF_BLADED_BATTLEAXE }
            : null,
      }),
    },
    animationId: 401,
    ticks: 2,
    kind: 'partial',
    holdsHits: true,
  };
  applyStall(named);
  assert.equal(named.kind, 'partial', 'no row: the battleaxe keeps core\'s partial stall');
  assert.equal(named.ticks, 2, 'and its length still comes from the cache');
});
