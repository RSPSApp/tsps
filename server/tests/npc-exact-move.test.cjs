// Run after `yarn build`: node --test tests/npc-exact-move.test.cjs
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
