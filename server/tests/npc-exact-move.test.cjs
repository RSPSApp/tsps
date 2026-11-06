// Run after `yarn build`: node --test tests/npc-exact-move.test.cjs
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Location } = require('../dist/game/model/Location');
const { PlayerSession } = require('../dist/net/PlayerSession');

before(() => CachePipeline.initialize());

test('the default angle faces the way it travels (0 south, 512 west, 1024 north, 1536 east)', () => {
  assert.equal(NPC.travelAngle(0, -1), 0);
  assert.equal(NPC.travelAngle(-1, 0), 512);
  assert.equal(NPC.travelAngle(0, 1), 1024);
  assert.equal(NPC.travelAngle(1, 0), 1536);
  // A capture of the Doom of Mokhaiotl's burrowed zooms: north-west 768, east 1536.
  assert.equal(NPC.travelAngle(-4, 4), 768);
  assert.equal(NPC.travelAngle(4, 0), 1536);
});

test('exactMove moves the NPC at once and keeps the glide for this tick only', () => {
  const npc = new NPC(14709, new Location(3421, 6435, 0));
  npc.exactMove(new Location(3417, 6439, 0));
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [3417, 6439]);
  assert.deepEqual(npc.getExactMove(), { fromX: 3421, fromY: 6435, startCycles: 0, endCycles: 30, angle: 768 });
  const view = PlayerSession.prototype.exactMoveView.call(null, npc.getExactMove(), npc.getLocation());
  assert.deepEqual(view, {
    startDeltaX: 4, startDeltaY: -4, endDeltaX: 0, endDeltaY: 0,
    startCycleOffset: 0, endCycleOffset: 30, direction: 768,
  });
  npc.resetUpdating();
  assert.equal(npc.getExactMove(), null);
  npc.exactMove(new Location(3420, 6439, 0), { startCycles: 5, endCycles: 40, angle: 100 });
  assert.deepEqual(npc.getExactMove(), { fromX: 3417, fromY: 6439, startCycles: 5, endCycles: 40, angle: 100 });
});

test('a gliding NPC stays in view in its teleport tick; a plain teleport still leaves it for that tick', () => {
  const { World } = require('../dist/game/World');
  const npc = new NPC(14709, new Location(3222, 3221, 0));
  assert.ok(World.getNpcs().add(npc, true), 'registered');
  try {
    const localNpcs = [];
    const player = {
      getLocation: () => new Location(3222, 3218, 0),
      getPrivateArea: () => null,
      getArea: () => null,
      getLocalNpcs: () => localNpcs,
      getAttribute: () => undefined,
    };
    const refresh = () => World.updateLocalNpcs(player, [npc]);
    refresh();
    assert.deepEqual(localNpcs, [npc], 'in view');

    npc.exactMove(new Location(3226, 3221, 0));
    refresh();
    assert.deepEqual(localNpcs, [npc], 'still in view, so the glide reaches the client with the teleport');
    npc.resetUpdating();
    npc.setNeedsPlacement(false);

    npc.moveTo(new Location(3222, 3221, 0));
    refresh();
    assert.deepEqual(localNpcs, [], 'a plain teleport: out for the tick, as before');
    npc.resetUpdating();
    npc.setNeedsPlacement(false);
    refresh();
    assert.deepEqual(localNpcs, [npc], 'and back the tick after');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('headbars besides the hitpoints one last a tick; showing one again replaces it', () => {
  const npc = new NPC(14707, new Location(3421, 6435, 0));
  npc.showHeadbar(81, { fill: 0, endFill: 100, duration: 390 });
  npc.showHeadbar(11, { fill: 13 });
  assert.deepEqual(npc.getHeadbars(), [
    { id: 81, fill: 0, endFill: 100, duration: 390, delay: 0 },
    { id: 11, fill: 13, endFill: 13, duration: 0, delay: 0 },
  ]);
  npc.showHeadbar(81, { fill: 0, endFill: 100, duration: 510 });
  assert.equal(npc.getHeadbars().filter((bar) => bar.id === 81).length, 1, 'restarted, not stacked');
  assert.equal(npc.getHeadbars().find((bar) => bar.id === 81).duration, 510);
  npc.removeHeadbar(81);
  assert.deepEqual(npc.getHeadbars().find((bar) => bar.id === 81), { id: 81, remove: true });
  npc.resetUpdating();
  assert.deepEqual(npc.getHeadbars(), []);
});

test('a face tile lasts a tick; crawling stays until it is turned off', () => {
  const npc = new NPC(14710, new Location(3421, 6435, 0));
  npc.faceTile(new Location(3419, 6445, 0));
  assert.deepEqual(npc.getFaceTile(), { x: 3419, y: 6445 });
  npc.resetUpdating();
  assert.equal(npc.getFaceTile(), null);
  assert.equal(npc.isCrawling(), false);
  npc.setCrawling(true);
  npc.resetUpdating();
  assert.equal(npc.isCrawling(), true);
});

test('NPC facing setters reach native NPC_INFO through the real session sync', () => {
  const npc = new NPC(7636, new Location(1615, 4833, 0));
  npc.setIndex(8);
  const location = new Location(1615, 4827, 0);
  const player = {
    getIndex: () => 1, getLocation: () => location,
    getArea: () => null, getPrivateArea: () => null,
    getLocalNpcs: () => [npc], getLocalPlayers: () => [],
    getAudioSettings: () => ({ 18: 1 }), getForceMovement: () => null,
  };
  const session = new PlayerSession({ isOpen: true });
  session.setPlayer(player);
  // Keep map/music setup out of this test; exercise the production NPC view and encoder.
  const baseX = (location.getX() - 48) & ~7, baseY = (location.getY() - 48) & ~7;
  const region = ((location.getX() >> 6) << 8) | (location.getY() >> 6);
  Object.assign(session, {
    hasReplayedScene: true, replayedSceneBaseX: baseX, replayedSceneBaseY: baseY,
    replayedSceneLevel: 0, lastGroundItemRegion: region, lastGroundItemLevel: 0,
    lastMusicRegion: region, lastMusicMode: 1,
  });
  const packets = [];
  session.sendClientPacket = packet => { packets.push(packet); return true; };
  let tick = 0;
  const sync = () => {
    packets.length = 0;
    session.playerSyncState = undefined; // Avoid unrelated player-appearance setup.
    session.flush(++tick);
    const packet = packets.find(packet => packet[0] === 21); // native NPC_INFO
    assert.ok(packet, 'an actual NPC_INFO packet was sent');
    const body = packet.subarray(3);
    assert.equal(body.readUInt16BE(9), body.length - 11);
    return [...body.subarray(11)];
  };
  sync(); // Establish the NPC so subsequent packets contain one known, stationary actor.
  const noUpdate = [1, 0x7f, 0xff, 0x80];
  const face = (x, y) => [1, 0x9f, 0xff, 0xe0, 0x80, 0x08, x >> 8, x & 255, y >> 8, y & 255];

  npc.resetUpdating();
  npc.setPositionToFace(new Location(1615, 4832, 0));
  assert.deepEqual(sync(), face(1615, 4832), 'Sid’s killer receives a south-facing coordinate update');
  npc.resetUpdating();
  assert.deepEqual(sync(), noUpdate, 'the saved face coordinate is not resent every tick');
  npc.setPositionToFace(new Location(1615, 4832, 0));
  assert.deepEqual(sync(), noUpdate, 'the ordinary setter keeps its same-coordinate deduplication');
  npc.forcePositionToFace(new Location(1615, 4832, 0));
  assert.deepEqual(sync(), face(1615, 4832), 'the force setter can reassert a turn after walking');
  npc.resetUpdating();
  npc.setPositionToFaceCoordinates(1639, 4838, 0);
  assert.deepEqual(sync(), face(1639, 4838), 'the inherited coordinate setter uses the same NPC sync path');

  for (const explicitFirst of [true, false]) {
    npc.resetUpdating();
    if (explicitFirst) npc.faceTile(new Location(1640, 4838, 0));
    npc.forcePositionToFace(new Location(1639, 4838, 0));
    if (!explicitFirst) npc.faceTile(new Location(1640, 4838, 0));
    assert.deepEqual(sync(), face(1640, 4838), 'explicit faceTile wins regardless of call order');
  }
  npc.resetUpdating();
  const target = new NPC(7625, new Location(1615, 4832, 0));
  target.setIndex(9);
  npc.setMobileInteraction(target);
  npc.forcePositionToFace(target.getLocation());
  assert.deepEqual(sync(), [1, 0x9f, 0xff, 0xe0, 0x88, 0x08, 137, 0, 128, 6, 79, 18, 224],
    'facing a tile does not discard the separately encoded interaction target');
  npc.resetUpdating();
  npc.setPositionToFace(null);
  assert.deepEqual(sync(), noUpdate, 'clearing a tile target does not turn the NPC towards world origin');
  assert.equal(npc.getInteractingMobile(), target);
});

test('players walk through NPCs, while NPCs still block each other', () => {
  const { World } = require('../dist/game/World');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  const npc = new NPC(3106, new Location(3300, 3300, 0));
  const pet = new NPC(3106, new Location(3300, 3302, 0));
  pet.setPet(true);
  assert.ok(World.getNpcs().add(npc, true), 'registered');
  assert.ok(World.getNpcs().add(pet, true), 'registered');
  try {
    // osrs-docs: Entity Collision - the NPC flag is checked by NPCs only; players
    // walk over it and clear it (the entity-stacking mechanic). Followers/pets add
    // no flag at all.
    const player = { isNpc: () => false, isPlayer: () => true, getSize: () => 1, getPrivateArea: () => null };
    const occupied = (x, y) => MovementQueue.prototype.isDynamicallyOccupied.call(
      { character: player }, new Location(x, y, 0));
    assert.equal(occupied(3300, 3300), false, 'a player steps onto a normal NPC tile');
    assert.equal(occupied(3300, 3302), false, 'followers/pets are walk-through');

    const otherNpc = {
      isNpc: () => true, isPlayer: () => false, getSize: () => 1,
      getPrivateArea: () => null, canWalkThroughNPCs: () => false,
    };
    const npcBlocked = (x, y) => MovementQueue.prototype.isDynamicallyOccupied.call(
      { character: otherNpc }, new Location(x, y, 0));
    assert.equal(npcBlocked(3300, 3300), true, 'an NPC is stopped by another NPC');
    assert.equal(npcBlocked(3300, 3301), false, 'the free tile beside it is walkable');
    assert.equal(npcBlocked(3300, 3302), false, 'an NPC passes through a pet rather than safespotting behind it');
  } finally {
    World.getNpcs().remove(npc);
    World.getNpcs().remove(pet);
  }
});

test('the attack timing hook lets an attack ignore the timer, or leave it as it was', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const api = PluginManager.createApi('timing-test');
  api.onAttackTiming((event) => {
    if (event.target !== 'larva') return;
    event.ignoreDelay = true;
    event.keepDelay = true;
  });
  const event = (target) => ({ attacker: {}, target, method: null, ignoreDelay: false, keepDelay: false });
  const larva = event('larva');
  PluginManager.emitAttackTiming(larva);
  assert.deepEqual([larva.ignoreDelay, larva.keepDelay], [true, true]);
  const boss = event('boss');
  PluginManager.emitAttackTiming(boss);
  assert.deepEqual([boss.ignoreDelay, boss.keepDelay], [false, false]);
});

test('a player sees NPCs 15 tiles out unless an area widens it (up to 127, the large NPC update)', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = { npcViewDistance: 15 };
  const get = () => Player.prototype.getNpcViewDistance.call(player);
  const set = (distance) => Player.prototype.setNpcViewDistance.call(player, distance);
  set(32);
  assert.equal(get(), 32);
  set(500);
  assert.equal(get(), 127);
  set(null);
  assert.equal(get(), 15);
});

test('idle NPC state stays unallocated until used and stays private to each actor', () => {
  const a = new NPC(14709, new Location(3200, 3200));
  const b = new NPC(14709, new Location(3200, 3201));
  assert.equal(a.getAttribute('test'), undefined);
  assert.equal(a.getSlotGraphics().size, 0);
  a.withdrawGraphicInSlot(1);
  a.resetUpdating();
  assert.equal(a.attributes, null);
  assert.equal(a.slotGraphics, null);
  assert.equal(a.combatOverrideViews, null);
  assert.equal(a.prayerActive, null);
  a.setAttribute('test', 42);
  assert.equal(a.getAttribute('test'), 42);
  assert.equal(b.getAttribute('test'), undefined);
  a.setPrayerActive(3, true);
  assert.equal(a.getPrayerActive().length, 30);
  assert.equal(a.getPrayerActive()[3], true);
  a.getPrayerActive()[3] = false;
  a.getPrayerActive()[4] = true;
  assert.equal(a.getPrayerActive()[3], false);
  assert.equal(a.getPrayerActive()[4], true);
  for (const name of ['poisonImmunityTimer', 'fireImmunityTimer', 'teleblockTimer', 'prayerBlockTimer']) {
    assert.equal(b.getCombat()[name], null, `${name} is allocated on first use`);
  }
  const teleblock = a.getCombat().getTeleblockTimer();
  assert.equal(teleblock.finished(), true);
  assert.equal(a.getCombat().getTeleblockTimer(), teleblock, 'the lazily created timer is kept');
  assert.equal(b.prayerActive, null, 'another NPC still has no prayer array');
  const replacement = [true];
  a.setPrayerActives(replacement);
  assert.equal(a.prayerActive, replacement, 'the mutable array API keeps caller identity');
  const graphic = { id: 123 };
  a.performGraphicInSlot(1, graphic);
  a.performGraphicInSlot(2, null);
  assert.equal(a.getSlotGraphics().get(1), graphic);
  assert.equal(a.getSlotGraphics().has(2), true, 'null is a queued slot-clear, not an absent slot');
  assert.equal(b.getSlotGraphics().size, 0);
  a.withdrawGraphicInSlot(1);
  assert.equal(a.getSlotGraphics().has(1), false);
  a.resetUpdating();
  assert.equal(a.getSlotGraphics().size, 0);
  const original = a.getCurrentDefinition();
  a.setCombatOverride({ maxHit: 123 });
  assert.equal(a.getCurrentDefinition().getMaxHit(), 123);
  assert.equal(a.getCurrentDefinition(), a.getCurrentDefinition(), 'override views remain cached');
  a.setCombatOverride(null);
  assert.equal(a.getCurrentDefinition(), original);
});

test('lazy combat damage tracking preserves contributors, killer selection and reset', () => {
  const combat = new NPC(14709, new Location(3200, 3200)).getCombat();
  const a = { isNpc: () => false, isRegistered: () => true };
  const b = { isNpc: () => false, isRegistered: () => true };
  assert.equal(combat.getKiller(false), null);
  assert.deepEqual(combat.getRecentDamagers(), []);
  assert.deepEqual(combat.getRecentDamagerEntries(), []);
  assert.equal(combat.damageMapContains(a), false);
  combat.clearDamageMap();
  assert.equal(combat.damageMap, null);
  combat.addDamage(a, 2);
  combat.addDamage(a, 3);
  combat.addDamage(b, 4);
  assert.deepEqual(combat.getRecentDamagerEntries(), [{ player: a, damage: 5 }, { player: b, damage: 4 }]);
  assert.equal(combat.getKiller(true), a);
  assert.equal(combat.damageMapContains(a), false);
  combat.addDamage(b, 1);
  assert.equal(combat.getKiller(false), b);
  combat.removeDamager(b);
  assert.equal(combat.getKiller(false), null, 'a dead attacker no longer wins a later kill');
});

test('lazy timers preserve reads, extension, ticking, cancellation and mutable access', () => {
  const { TimerRepository } = require('../dist/util/timers/TimerRepository');
  const { TimerKey } = require('../dist/util/timers/TimerKey');
  const { Timer } = require('../dist/util/timers/Timer');
  const timers = new TimerRepository(), key = TimerKey.FREEZE;
  assert.equal(timers.has(key), false);
  assert.equal(timers.left(key), 0);
  assert.equal(timers.getTicks(key), 0);
  assert.equal(timers.willEndIn(key, 1), true);
  assert.equal(timers.hasActive(), false);
  timers.process(); timers.cancel(key);
  assert.equal(timers.timer, null);
  timers.registers(key, 2);
  timers.extendOrRegister(key, 1);
  assert.equal(timers.left(key), 2);
  timers.addOrSet(key, 2);
  timers.process();
  assert.equal(timers.left(key), 3);
  assert.equal(timers.hasActive(), true);
  timers.cancel(key);
  assert.equal(timers.hasActive(), false);
  const mutable = timers.timers();
  mutable.set(key, new Timer(key, 1));
  assert.equal(timers.has(key), true);
  timers.process();
  assert.equal(timers.has(key), false);
  timers.register(new Timer(key, 2));
  assert.equal(mutable.get(key).ticks(), 2, 'previously returned maps stay connected');
});

/** Real hit/death producers; only transport, persistence and death-floor effects are stubbed. */
function nativeKillCredit(t) {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = PluginManager.getCoreApi();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { CombatType } = require('../dist/game/content/combat/CombatType');
  const actors = [], tasks = [];
  const initialCycle = core.World.getProcessCycle();
  t.mock.method(core.TaskManager, 'submit', task => tasks.push(task));
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', () => {});
  t.mock.method(core.GameConstants.PLAYER_PERSISTENCE, 'requestSave', () => {});
  t.mock.method(PluginManager, 'emitShouldDropItemsOnDeath', () => false);
  function actor() {
    const channel = { kind: 'test', isOpen: () => true, send: () => true };
    const session = new PlayerSession(channel), p = new Player(session);
    session.setPlayer(p);
    p.setUsername(`killcredit${actors.length}`);
    assert.ok(core.World.getPlayers().add(p));
    p.setLocation(new core.Location(3300 + actors.length, 3700));
    p.setNeedsPlacement(false); p.setUntargetable(false); p.setAutoRetaliate(false);
    p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false).setCurrentLevel(core.Skill.HITPOINTS, 99, false);
    actors.push(p);
    return p;
  }
  const clock = () => ++core.World.processCycle;
  const process = p => p.getCombat().getHitQueue().process(clock());
  function pending(a, b, damage, type = CombatType.MELEE) {
    return new core.PendingHit(a, b, { type: () => type, accuracyDefenceType: () => undefined },
      { damage, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
  }
  function hit(a, b, damage) {
    core.CombatFactory.executeHit(pending(a, b, damage));
    process(b);
  }
  const death = p => tasks.find(task => task.constructor.name === 'PlayerDeathTask' && task.player === p);
  function respawn(p) {
    const task = death(p);
    assert.ok(task);
    for (let tick = 0; tick < 3; tick++) { clock(); task.execute(); }
    assert.equal(p.isDyingReturn(), false);
    assert.equal(p.getHitpoints(), 99);
  }
  t.after(() => {
    for (const p of actors) {
      p.getCombat().getHitQueue().clear();
      t.mock.method(p, 'onRemove', () => {});
      core.World.getPlayers().remove(p);
    }
    for (const task of tasks) task.stop();
    core.World.processCycle = initialCycle;
  });
  return { core, PluginManager, CombatType, actor, clock, process, pending, hit, death, respawn };
}

test('a real death and same-object respawn discard old PvP damage, retaining PvM credit and the later killer', t => {
  const f = nativeKillCredit(t), a = f.actor(), b = f.actor(), c = f.actor();
  f.hit(b, a, 75);
  assert.equal(a.getCombat().getKiller(false), b);
  const npc = new NPC(1, new Location(3300, 3701));
  npc.getCombat().addDamage(b, 10);
  f.hit(a, b, 99);
  assert.equal(a.getCombat().getKiller(false), null);
  assert.equal(npc.getCombat().getKiller(false), b, 'PvM contributors are unchanged');
  f.respawn(b);
  assert.equal(a.getCombat().getKiller(false), null, 'the same registered Player has a new life');
  f.hit(c, a, 24);
  assert.equal(f.death(a).killer, c);
});

for (const delayed of [false, true]) {
  test(`a real Vengeance double KO keeps both killers${delayed ? ' even when the reflected hit waits past respawn' : ''}`, t => {
    const f = nativeKillCredit(t), a = f.actor(), b = f.actor();
    f.hit(b, a, 94); // a is on 5 HP, b still owns the earlier damage.
    b.getSkillManager().setCurrentLevel(f.core.Skill.HITPOINTS, 10, false);
    b.setHasVengeance(true);
    if (delayed) {
      const shot = f.pending(a, b, 10, f.CombatType.RANGED);
      b.getCombat().getHitQueue().addPendingHit(shot, f.core.World.getProcessCycle() + 2);
      t.mock.method(f.PluginManager, 'emitAnimationStall', event => {
        event.kind = 'full'; event.holdsHits = true; event.ticks = 12;
      });
      a.getCombat().expectAttackAnimation();
      a.performAnimation(new f.core.Animation(830));
      f.process(b); f.process(b); // The already-launched shot kills b during a's stall.
      f.process(a);
      assert.equal(a.getHitpoints(), 5);
      f.respawn(b);
      assert.equal(a.getCombat().getKiller(false), null, 'old-life damage stays discarded');
      while (a.getHitpoints() > 0) f.process(a);
    } else {
      f.hit(a, b, 10);
      f.process(a);
    }
    assert.equal(f.death(b).killer, a);
    assert.equal(f.death(a).killer, b);
    assert.deepEqual(a.__recentDeathDamagerEntries, [{ player: b, damage: 5 }],
      'only the fresh, HP-capped reflection counts, never the discarded 94 damage');
  });
}

test('alive Vengeance is credited once and stays proportional to an opposing contributor', t => {
  const f = nativeKillCredit(t), reflector = f.actor(), victim = f.actor(), other = f.actor();
  f.hit(other, victim, 7);
  reflector.setHasVengeance(true);
  f.hit(victim, reflector, 8);
  f.process(victim);
  assert.deepEqual(victim.getCombat().getRecentDamagerEntries(), [
    { player: other, damage: 7 }, { player: reflector, damage: 6 },
  ]);
  assert.equal(victim.getCombat().getKiller(false), other);
});

test('reflected PvP credit uses modified and capped HP loss, excluding zero, missing/NPC source and PvM hits', t => {
  const f = nativeKillCredit(t), source = f.actor(), victim = f.actor();
  const { HitDamage, HitMask } = f.core;
  const apply = hit => { victim.getCombat().getHitQueue().addPendingDamage([hit]); f.process(victim); };
  t.mock.method(f.PluginManager, 'emitCustomEvent', (name, event) => {
    if (name === 'combat:damage-apply' && event.hit.getDamage() === 90) event.hit.setDamage(4);
  });
  apply(new HitDamage(90, HitMask.RED).markReflected().setSource(source));
  assert.deepEqual(victim.getCombat().getRecentDamagerEntries(), [{ player: source, damage: 4 }]);
  victim.getCombat().clearDamageMap();
  const npc = new NPC(1, new Location(3300, 3701));
  for (const hit of [new HitDamage(0, HitMask.RED).markReflected().setSource(source),
    new HitDamage(1, HitMask.RED).markReflected(), new HitDamage(1, HitMask.RED).markReflected().setSource(npc),
    new HitDamage(1, HitMask.RED).markReflected().setSource(victim),
    new HitDamage(1, HitMask.RED).setSource(source)]) apply(hit);
  assert.deepEqual(victim.getCombat().getRecentDamagers(), []);
  npc.setRegistered(true); npc.setHitpoints(10);
  npc.getCombat().getHitQueue().addPendingDamage([new HitDamage(2, HitMask.RED).markReflected().setSource(source)]);
  f.process(npc);
  assert.deepEqual(npc.getCombat().getRecentDamagers(), [], 'PvM reflection accounting is unchanged');
  npc.setRegistered(false);
  victim.getSkillManager().setCurrentLevel(f.core.Skill.HITPOINTS, 3, false);
  apply(new HitDamage(99, HitMask.RED).markReflected().setSource(source));
  assert.equal(f.death(victim).killer, source);
  assert.deepEqual(victim.__recentDeathDamagerEntries, [{ player: source, damage: 3 }]);
});

// Check the real dialogue producer and session views inside the boat's coordinate system.
test('Pandemonium native dialogue turns to its actual deck speakers', async t => {
  const path = require('node:path');
  const { PluginManager: PM } = require('../dist/plugins/PluginManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const core = PM.getCoreApi(), initialCycle = core.World.processCycle;
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); PM.emitServerStartup({});
  core.RegionManager.init();
  t.after(() => { PM.emitServerShutdown({}); core.World.processCycle = initialCycle; });
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'pandemonium');
  const ships = require('../plugins/skills/sailing/StaticShips.Sailing'), syncs = [];
  const willId = core.CacheDefinitions.getNpcId('sailing_intro_will_boat');
  const anneId = core.CacheDefinitions.getNpcId('sailing_intro_anne_boat');
  PM.createApi('DeckFacingTest').onCustomEvent('network:sync-views', event => syncs.push(event));
  let counter = 0;
  function fixture(test) {
    const packets = [], channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), player = new Player(session);
    player.setUsername(`deckfacing${counter++}`); session.setPlayer(player);
    test.mock.method(session, 'sendClientPacket', packet => { packets.push(packet); return true; });
    assert.ok(core.World.getPlayers().add(player));
    const connection = new ClientConnection(channel); connection.player = player;
    player.setAttribute('pandemonium:stage-version', 2); quest.setStage(player, 6);
    const lifecycle = { player, username: player.getUsername(), isNewAccount: false };
    PM.emitPlayerLogin(lifecycle);
    const ship = ships.all().find(s => s.boat.ownerPlayerId === player.getIndex()); assert.ok(ship);
    const crew = [...core.World.getNpcs()].filter(n => n.getOwner() === player && [willId, anneId].includes(n.getId()));
    const will = crew.find(n => n.getId() === willId), anne = crew.find(n => n.getId() === anneId);
    assert.equal(will.getContentId(player), core.CacheDefinitions.getNpcId('sailing_intro_will_vis'));
    assert.equal(anne.getContentId(player), core.CacheDefinitions.getNpcId('sailing_intro_anne_vis'));
    player.closeInterruptibleInterfaces(); player.setNeedsPlacement(false); crew.forEach(n => n.setNeedsPlacement(false));
    test.after(() => {
      player.closeInterruptibleInterfaces(); PM.emitPlayerLogout(lifecycle); core.TaskManager.cancelTasks(player.getIndex());
      test.mock.method(player, 'onRemove', () => {}); core.World.getPlayers().remove(player);
      assert.equal(core.World.getPlayers().get(player.getIndex()), null);
    });
    async function input(frame) { await connection.dispatch(decodeClientPackets(frame)); connection.processTurnPackets(); }
    async function talk(npc = will) {
      const index = npc.getIndex();
      await input(Buffer.from([ClientPacketId.OPNPC1_ALT, 0, index >>> 8, (index + 128) & 255]));
      for (let tick = 0; tick < 8; tick++) {
        core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().beginCycle(); player.getMovementQueue().process();
        core.TaskManager.process(); crew.filter(n => n.isRegistered()).forEach(n => n.process());
      }
    }
    function continuation() {
      const frame = Buffer.alloc(7); frame[0] = ClientPacketId.RESUME_PAUSEBUTTON; frame[1] = 255; frame[2] = 127;
      frame.writeUInt32BE((player.getPacketSender().getChatboxGroupId() << 16) | 5, 3); return frame;
    }
    function flush() {
      core.World.updateLocalNpcs(player, crew.filter(n => n.isRegistered()));
      session.flush(++core.World.processCycle); session.flush(++core.World.processCycle);
      assert.ok(packets.some(p => p[0] === 21), 'the real session sends native NPC_INFO');
      return syncs.filter(event => event.player === player).at(-1);
    }
    return { player, will, anne, talk, input, continuation, flush,
      next: () => input(continuation()), current: () => player.getDialogueManager().getCurrent() };
  }
  await t.test('native Talk-to and Continues alternate the player between Will and Anne', async test => {
    const f = fixture(test); await f.talk();
    assert.equal(f.current().getNpcId(), willId);
    assert.equal(f.will.getInteractingMobile(), f.player, 'ordinary native Talk-to still pairs the NPC');
    let view = f.flush();
    assert.equal(view.players.find(p => p.index === f.player.getIndex()).faceDirection, 0, 'Will is due south');
    assert.deepEqual(view.npcs.find(n => n.index === f.will.getIndex()).faceTile,
      { x: f.player.getLocation().getX(), y: f.player.getLocation().getY() });
    await f.next(); await f.next(); assert.equal(f.current().getNpcId(), anneId);
    view = f.flush();
    assert.equal(view.players.find(p => p.index === f.player.getIndex()).faceDirection, 151,
      'Anne at deck(3,2) receives the angle observed in recording381');
    assert.ok(f.player.getPositionToFace().equals(f.anne.getLocation()));
    await f.next(); await f.next(); assert.equal(f.current().getNpcId(), willId);
    assert.equal(f.flush().players.find(p => p.index === f.player.getIndex()).faceDirection, 0);
  });
  await t.test('foreign, cancelled and retired dialogue actors cannot retarget the player', async test => {
    const f = fixture(test), other = fixture(test); await other.talk(f.will);
    assert.equal(other.current(), undefined, 'a native foreign-actor click is rejected');
    await f.talk(); await f.next(); const stale = f.continuation(); f.player.closeInterruptibleInterfaces();
    const sentinel = f.player.getLocation().clone().add(1, 0); f.player.setPositionToFace(sentinel);
    PM.createApi('DeckFacingReplacement').sendMultiChatboxPrompt(f.player, 'Keep this choice', 'Yes', () => {}, 'No', () => {});
    await f.input(stale); assert.ok(f.player.getPositionToFace().equals(sentinel));
    assert.equal(MultiChatboxPrompt.getPending(f.player)?.title, 'Keep this choice');
    f.player.closeInterruptibleInterfaces(); await f.talk(); await f.next(); PM.removeNpc(f.anne);
    f.player.setPositionToFace(sentinel); await f.next();
    assert.ok(f.player.getPositionToFace().equals(sentinel), 'a queued line ignores a retired actor');
    PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() }); await f.input(stale);
    assert.ok(f.player.getPositionToFace().equals(sentinel), 'departed playback has no pending turn');
  });
});


test('pet occupancy stays walk-through across moves, classification changes and removal without hiding other actors', () => {
  const { World } = require('../dist/game/World');
  const at = new Location(3300, 3302, 0), next = new Location(3301, 3302, 0);
  const pet = new NPC(3106, at.clone()), blocker = new NPC(3106, at.clone());
  pet.setPet(true);
  World.getNpcs().add(pet, true);
  try {
    assert.equal(World.isNpcOccupyingTile(at), false);
    assert.equal(World.isNpcOccupyingTile(new Location(3299, 3301, 0), null, 2), false, 'large movers ignore every covered pet tile');
    assert.ok(World.getNpcsNear(at, 1).includes(pet), 'pet remains spatially visible');
    pet.setPet(false);
    assert.equal(World.isNpcOccupyingTile(at), true, 'classification is live, not stale registration state');
    pet.setPet(true);
    assert.equal(World.isNpcOccupyingTile(at), false);
    pet.setLocation(next.clone());
    assert.equal(World.isNpcOccupyingTile(at), false);
    assert.equal(World.isNpcOccupyingTile(next), false);
    World.getNpcs().add(blocker, true);
    assert.equal(World.isNpcOccupyingTile(at), true, 'a real NPC still blocks');
    pet.setLocation(at.clone());
    assert.equal(World.isNpcOccupyingTile(at), true, 'a pet cannot conceal a colocated blocker');
    assert.equal(World.isNpcOccupyingTile(at, blocker), false, 'ignored mover sees only the walk-through pet');
    World.getNpcs().remove(pet);
    assert.equal(World.isNpcOccupyingTile(at), true, 'despawning the pet preserves other occupancy');
  } finally {
    World.getNpcs().remove(pet);
    World.getNpcs().remove(blocker);
  }
  assert.equal(World.isNpcOccupyingTile(at), false);
});
