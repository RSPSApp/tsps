// From server/: node --test tests/grotesque-guardians.test.cjs (after yarn build).
//
// The Grotesque Guardians against the OSRS Wiki (Grotesque_Guardians, /Strategies, Dusk, Dawn):
// the roof's key and bell, who can be hurt by what in each phase, the phase changes at half
// health, the rockfall, spheres and prison, enraged Dusk's style switches, and the kill.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { AccuracyFormulasDpsCalc } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const core = PluginManager.getCoreApi();

let Common, Fight, Roof, Combat, Kills, tasks, onTaskAnswer, prayers, killTotal, dropEvents;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  Common = require('../plugins/bosses/grotesqueguardians/Common.GrotesqueGuardians');
  ({ Fight } = require('../plugins/bosses/grotesqueguardians/Fight.GrotesqueGuardians'));
  Roof = require('../plugins/bosses/grotesqueguardians/Roof.GrotesqueGuardians');
  Combat = require('../plugins/bosses/grotesqueguardians/Combat.GrotesqueGuardians');
  Kills = require('../plugins/bosses/grotesqueguardians/Kills.GrotesqueGuardians');
  tasks = [];
  onTaskAnswer = () => true;
  prayers = new Set();
  killTotal = undefined;
  dropEvents = [];
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => tasks.push(task) } },
    persistAttribute: () => {},
    onCombatHitRoll: PluginManager.createApi('GuardiansTests').onCombatHitRoll,
    getPrayerHandler: () => ({
      PROTECT_FROM_MELEE: 'melee', PROTECT_FROM_MISSILES: 'missiles',
      isActivated: (_player, prayer) => prayers.has(prayer),
    }),
    emitCustomEvent(name, event) {
      if (name === 'slayer:on-task') event.onTask = onTaskAnswer(event);
      if (name === 'combat-achievements:count') event.total = killTotal;
      if (name.startsWith('npc-drops:')) dropEvents.push({ name, event });
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  Roof.attach(api);
  Combat.attach(api);
});

/** Runs every queued one-shot task. */
function flush() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

const loc = (x, y) => new core.Location(x, y, 0);

function fakeGuardian(id, x, y, hp = 450) {
  let transform = -1;
  const npc = {
    hitpoints: hp, anims: [], locked: false, dying: false,
    setHitpointsLocked: (locked) => { npc.locked = locked; },
    isDyingFunction: () => npc.dying,
    getId: () => (transform !== -1 ? transform : id),
    setNpcTransformationId: (to) => { transform = to; },
    getLocation: () => loc(x, y),
    getSize: () => 4,
    getHitpoints: () => npc.hitpoints,
    setHitpoints: (value) => { npc.hitpoints = value; },
    getMaxHitpoints: () => 450,
    performAnimation: (anim) => npc.anims.push(anim.getId?.() ?? anim),
    getCombat: () => ({ reset: () => {}, setAttackDelay: () => {} }),
  };
  return npc;
}

function fakePlayer(x = 1695, y = 4575) {
  let tile = loc(x, y);
  const player = {
    damage: [], messages: [], blocked: false, attributes: {}, varbits: {}, items: new Map(),
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    isPlayer: () => true,
    getAsPlayer: () => player,
    getHitpoints: () => 99,
    sendMessage: (m) => player.messages.push(m),
    getAttribute: (key) => player.attributes[key],
    setAttribute: (key, value) => { player.attributes[key] = value; },
    boxes: [], anims: [], sounds: [], locAnims: [], faded: [],
    getPacketSender: () => ({
      sendGraphic: () => {},
      sendVarbit: (id, value) => { player.varbits[id] = value; },
      sendObjectAnimation: (object, anim) => player.locAnims.push([object, anim.getId?.() ?? anim]),
      sendSound: (id, volume, delay) => player.sounds.push([id, delay]),
      sendSubInterface: () => player.faded.push('fade'),
      closeSubInterface: () => player.faded.push('close'),
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.boxes.push(chain) }),
    performAnimation: (anim) => player.anims.push(anim.getId?.() ?? anim),
    getInventory: () => ({
      contains: (id) => (player.items.get(id) ?? 0) > 0,
      deleteNumber: (id, n) => player.items.set(id, (player.items.get(id) ?? 0) - n),
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits.map((h) => h.getDamage())) }) }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: (value) => { player.blocked = value; } }),
  };
  return player;
}

function fakeRoof(player) {
  const [minX, maxX, minY, maxY] = Common.data.roof.floor;
  return {
    players: () => (player ? [player] : []),
    contains: (l) => l.getX() >= minX && l.getX() <= maxX && l.getY() >= minY && l.getY() <= maxY,
  };
}

function newFight(player = fakePlayer()) {
  const { npcs } = Common.ids;
  const dusk = fakeGuardian(npcs.duskPhase1, 1689, 4573);
  const dawn = fakeGuardian(npcs.dawnPhase1, 1701, 4573);
  return { fight: new Fight(fakeRoof(player), dusk, dawn, () => 0), dusk, dawn, player };
}

/** A PendingHit-shaped hit from the player of `type`, with `damages` per splat. */
function fakeHit(attacker, type, damages) {
  const parts = damages.map((value) => {
    let damage = value;
    return { getDamage: () => damage, setDamage: (v) => { damage = v; } };
  });
  return { parts, getAttacker: () => attacker, getCombatType: () => type, getHits: () => parts, updateTotalDamage: () => {} };
}

test('every id resolves from the cache', () => {
  const { npcs, locs, items, varbits } = Common.ids;
  assert.deepEqual(Common.duskForms(), [7851, 7854, 7882, 7883, 7887, 7888, 7889]);
  assert.deepEqual(Common.dawnForms(), [7852, 7853, 7884, 7885]);
  assert.equal(npcs.duskPhase4, 7888);
  assert.equal(locs.entrance, 31681);
  assert.equal(locs.exit, 31674);
  assert.ok(locs.bell.includes(31669), 'the bell is clicked as its multiloc parent');
  assert.equal(items.key, 21724);
  assert.equal(varbits.unlocked, 2468);
});

test('phase 1: only Dawn can be hurt; at half health she flies up and Dusk fights alone', () => {
  const { fight, dusk, dawn } = newFight();
  assert.equal(fight.vulnerable(dawn), true);
  assert.equal(fight.vulnerable(dusk), false);
  dawn.hitpoints = 225;
  assert.equal(fight.checkPhase(), true);
  assert.equal(fight.phase, 2);
  assert.equal(dawn.getId(), Common.ids.npcs.dawnFlying);
  assert.equal(dusk.getId(), Common.ids.npcs.duskPhase2);
  assert.equal(fight.vulnerable(dawn), false);
  assert.equal(fight.vulnerable(dusk), true);
});

test('phase 3 at half Dusk: Dawn comes down, safe until the lightning ends, then the spheres', () => {
  const { fight, dusk, dawn, player } = newFight();
  fight.phase = 2;
  dusk.hitpoints = 220;
  fight.tick([player]);
  assert.equal(fight.phase, 3);
  assert.equal(dusk.getId(), Common.ids.npcs.duskPhase3);
  assert.equal(dawn.getId(), Common.ids.npcs.dawnPhase3);
  assert.equal(fight.vulnerable(dawn), false);
  assert.equal(fight.vulnerable(dusk), false);
  while (fight.tickCount < fight.lightningUntil) fight.tick([player]);
  assert.equal(fight.vulnerable(dawn), true);
  assert.equal(fight.spheres.length, Common.data.spheres.count);
  assert.ok(player.damage.length > 0, 'a vortex always falls on the player');
});

test('a sphere left alone heals Dawn 90; one walked into is taken', () => {
  const { fight, dawn, player } = newFight(fakePlayer(1690, 4570));
  fight.phase = 3;
  dawn.hitpoints = 100;
  fight.spheres = [
    { tile: loc(1690, 4570), arrives: 5 },
    { tile: loc(1700, 4580), arrives: 5 },
  ];
  fight.tick([player]);
  assert.equal(fight.spheres.length, 1);
  fight.tickCount = 5;
  fight.tickSpheres([player]);
  assert.equal(dawn.hitpoints, 190);
  assert.equal(fight.spheres.length, 0);
});

test('Dawn finished: Dusk takes her essence, enrages and opens with a prison', () => {
  const { fight, dusk, dawn, player } = newFight();
  fight.phase = 3;
  dawn.hitpoints = 0;
  fight.tick([player]);
  assert.equal(fight.phase, 3, 'at 0 she waits for the rock hammer');
  dawn.dying = true;
  fight.tick([player]);
  assert.equal(fight.phase, 4);
  assert.equal(dusk.getId(), Common.ids.npcs.duskPhase4Spawn);
  flush();
  assert.equal(dusk.getId(), Common.ids.npcs.duskPhase4);
  assert.ok(fight.prison, 'the prison closes round the player');
  assert.equal(fight.vulnerable(dusk), false, 'Dusk cannot be hurt during the first prison');
  fight.dawnDied();
  assert.equal(fight.prisons, 1, 'a second death report changes nothing');
});

test('the prison hits whoever is still inside when it closes, and heals Dusk by as much', () => {
  const player = fakePlayer(1695, 4575);
  const { fight, dusk } = newFight(player);
  fight.phase = 4;
  dusk.hitpoints = 200;
  fight.imprison(player);
  for (let i = 0; i < Common.data.prison.escapeTicks; i++) fight.tick([player]);
  assert.equal(fight.prison, null);
  const hit = player.damage.at(-1);
  assert.ok(hit >= 0 && hit <= Common.data.prison.max);
  assert.equal(dusk.hitpoints, 200 + hit);
  assert.equal(fight.vulnerable(dusk), true, 'after the first prison Dusk can be hurt');
});

test('stepping onto the gap escapes the prison', () => {
  const player = fakePlayer(1695, 4575);
  const { fight, dusk } = newFight(player);
  fight.phase = 4;
  fight.imprison(player);
  player.moveTo(fight.prison.gap);
  const before = player.damage.length;
  for (let i = 0; i < Common.data.prison.escapeTicks; i++) fight.tick([player]);
  assert.equal(player.damage.length, before);
  assert.equal(dusk.hitpoints, 450);
});

test('phase 2 rocks fall on the floor only; a direct hit stuns', () => {
  const { fight, player } = newFight();
  fight.phase = 2;
  fight.dropRocks(player);
  assert.ok(fight.rocks.length > 1);
  assert.ok(fight.rocks.every((rock) => fakeRoof(null).contains(rock.tile)));
  for (let i = 0; i < Common.data.rockfall.warnTicks; i++) fight.tick([player]);
  assert.equal(player.blocked, true);
  assert.ok(player.damage.length >= 1);
});

test('Dusk only takes melee; Dawn takes ranged or a halberd, never other melee', () => {
  const { fight, dusk, dawn } = newFight();
  const player = fakePlayer();
  player.getWeapon = () => core.WeaponInterfaces.WHIP;
  fight.phase = 2;
  const ranged = fakeHit(player, core.CombatType.RANGED, [20]);
  Roof.guardianHit({ npc: dusk, hit: ranged });
  assert.equal(ranged.parts[0].getDamage(), 0);
  const melee = fakeHit(player, core.CombatType.MELEE, [20]);
  Roof.guardianHit({ npc: dusk, hit: melee });
  assert.equal(melee.parts[0].getDamage(), 20);

  fight.phase = 1;
  const whip = fakeHit(player, core.CombatType.MELEE, [20]);
  Roof.guardianHit({ npc: dawn, hit: whip });
  assert.equal(whip.parts[0].getDamage(), 0);
  player.getWeapon = () => core.WeaponInterfaces.HALBERD;
  const halberd = fakeHit(player, core.CombatType.MELEE, [20]);
  Roof.guardianHit({ npc: dawn, hit: halberd });
  assert.equal(halberd.parts[0].getDamage(), 20);
  const bow = fakeHit(player, core.CombatType.RANGED, [20]);
  Roof.guardianHit({ npc: dawn, hit: bow });
  assert.equal(bow.parts[0].getDamage(), 20);
});

test('a hit stops at half health, so the phase change comes before any more damage', () => {
  const { dawn } = newFight();
  const player = fakePlayer();
  dawn.hitpoints = 240;
  const hit = fakeHit(player, core.CombatType.RANGED, [10, 10]);
  Roof.guardianHit({ npc: dawn, hit });
  assert.deepEqual(hit.parts.map((p) => p.getDamage()), [10, 5]);
});

test('neither Guardian takes anything outside a fight', () => {
  const dusk = fakeGuardian(Common.ids.npcs.duskPhase2, 1689, 4573);
  const hit = fakeHit(fakePlayer(), core.CombatType.MELEE, [30]);
  Roof.guardianHit({ npc: dusk, hit });
  assert.equal(hit.parts[0].getDamage(), 0);
});

test('enraged Dusk opens on the style the player is not praying against, then mostly keeps it', () => {
  const npc = {};
  const target = fakePlayer();
  prayers = new Set(['melee']);
  assert.equal(Combat.nextEnragedStyle(npc, target, () => 0.1), 'ranged');
  assert.equal(Combat.nextEnragedStyle(npc, target, () => 0.5), 'ranged', 'no switch above 1 in 6');
  prayers = new Set(['missiles']);
  assert.equal(Combat.nextEnragedStyle(npc, target, () => 0.3), 'melee', 'praying against it: 1 in 3');
  prayers = new Set();
});

/** Real combat entities, cache-backed definitions, PendingHit and the registered prayer hook. */
function realCombat() {
  const player = new Player(null), graphics = [];
  const sender = new Proxy({}, { get: (_, key) => key === 'sendGraphic'
    ? (_graphic, tile) => graphics.push(tile) : () => sender });
  player.getPacketSender = () => sender;
  player.setRegistered(true);
  player.setHitpoints(99);
  player.moveTo(loc(1695, 4575));
  const dusk = core.NPC.create(Common.ids.npcs.duskPhase1, loc(1689, 4573));
  const dawn = core.NPC.create(Common.ids.npcs.dawnPhase1, loc(1701, 4573));
  const fight = new Fight({ players: () => [player] }, dusk, dawn, () => 0);
  return { player, dusk, dawn, fight, graphics };
}

test('real PendingHits preserve Dawn full protection and Dusk partial melee protection', t => {
  t.mock.method(AccuracyFormulasDpsCalc, 'rollAccuracy', () => true);
  t.mock.method(Math, 'random', () => 0.999);
  const { player, dusk, dawn, fight } = realCombat();
  const { DuskCombat, DawnCombat } = Combat.methods();
  for (const [npc, method, phase, tile, prayer, unprotected, protectedDamage] of [
    [dusk, new DuskCombat(), 1, loc(1693,4574), core.PrayerHandler.PROTECT_FROM_MELEE, [15], [3]],
    [dusk, new DuskCombat(), 4, loc(1693,4574), core.PrayerHandler.PROTECT_FROM_MELEE, [26], [5]],
    [dawn, new DawnCombat(), 1, loc(1695,4575), core.PrayerHandler.PROTECT_FROM_MISSILES, [9,9], [0,0]],
    [dawn, new DawnCombat(), 1, loc(1700,4574), core.PrayerHandler.PROTECT_FROM_MELEE, [15], [0]],
  ]) {
    fight.phase = phase;
    if (phase === 4) {
      dusk.setNpcTransformationId(Common.ids.npcs.duskPhase4);
      dusk.__ggLastStyle = 'melee';
    }
    player.moveTo(tile);
    for (const active of [false, true]) {
      player.setPrayerActive(prayer, active);
      method.start(npc, player);
      const hits = method.hits(npc, player);
      assert.ok(hits.every(hit => hit instanceof core.PendingHit && hit.isAccurate()));
      for (const hit of hits) core.CombatFactory.applyHitTimeDefences(hit);
      assert.deepEqual(hits.map(hit => hit.getTotalDamage()), active ? protectedDamage : unprotected);
    }
    player.setPrayerActive(prayer, false);
  }
});

test('enraged ranged orbs use the 60% cap, a fixed first hit and two rolls for the second', t => {
  let accuracyChecks = 0;
  t.mock.method(AccuracyFormulasDpsCalc, 'rollAccuracy', () => { accuracyChecks++; return true; });
  t.mock.method(Math, 'random', () => 0.999);
  const { player, dusk, fight } = realCombat();
  fight.phase = 4;
  dusk.setNpcTransformationId(Common.ids.npcs.duskPhase4);
  const method = new (Combat.methods().DuskCombat)();
  const rolls = [];
  t.mock.method(Common, 'randomInt', (min, max) => {
    rolls.push([min, max]);
    return Math.min(rolls.length === 1 ? 10 : 3, max);
  });
  for (const active of [false, true]) {
    player.setPrayerActive(core.PrayerHandler.PROTECT_FROM_MISSILES, active);
    rolls.length = 0;
    method.start(dusk, player);
    const hits = method.hits(dusk, player);
    for (const hit of hits) core.CombatFactory.applyHitTimeDefences(hit);
    assert.deepEqual(hits.map(hit => hit.getTotalDamage()), active ? [7,3] : [15,3]);
    assert.deepEqual(rolls, active ? [[0,7],[0,7]] : [[0,15],[0,10]]);
  }
  assert.equal(accuracyChecks, 4, 'each orb has its own accuracy check');
  let incoming = 0;
  PluginManager.createApi('GuardiansIncomingDamageTest').registerIncomingDamageModifier((target, damage) => {
    if (target !== player) return;
    incoming++;
    damage.multiplyDamage(0.5);
  });
  rolls.length = 0;
  const orbs = method.hits(dusk, player);
  for (const hit of orbs) core.CombatFactory.applyHitTimeDefences(hit);
  assert.deepEqual(orbs.map(hit => hit.getTotalDamage()), [3,1]);
  assert.equal(incoming, 2, 'incoming damage modifiers apply once per orb at impact, after partial prayer protection');
});

test('the fixed ranged orb still misses and respects the real PendingHit HP cap', t => {
  const accuracy = t.mock.method(AccuracyFormulasDpsCalc, 'rollAccuracy', () => false);
  t.mock.method(Math, 'random', () => 0.999);
  const { player, dusk, fight } = realCombat();
  fight.phase = 4;
  dusk.setNpcTransformationId(Common.ids.npcs.duskPhase4);
  const method = new (Combat.methods().DuskCombat)();
  method.start(dusk, player);
  assert.deepEqual(method.hits(dusk, player).map(hit => hit.getTotalDamage()), [0,0]);
  accuracy.mock.mockImplementation(() => true);
  player.setHitpoints(2);
  assert.equal(method.hits(dusk, player)[0].getTotalDamage(), 2);
});

test('the 5x5 prison keeps its closed wall inside and its gap safe in the real hit queue', t => {
  t.mock.method(Math, 'random', () => 0.999);
  for (const [offset, damaged] of [[[2,0],true], [[1,0],true], [null,false], [[3,0],false]]) {
    const { player, dusk, fight, graphics } = realCombat();
    fight.phase = 4;
    dusk.setHitpointsLocked(false);
    dusk.setHitpoints(200);
    fight.imprison(player);
    const { centre, gap } = fight.prison;
    assert.equal(graphics.length, 15);
    assert.ok(graphics.every(tile => Common.chebyshev(tile, centre) === 2));
    assert.ok(graphics.every(tile => Common.chebyshev(tile, gap) > 0));
    assert.equal(Common.chebyshev(gap, centre), 2);
    player.moveTo(offset ? centre.transform(...offset) : gap);
    fight.tickCount = Common.data.prison.escapeTicks;
    fight.tickPrison();
    assert.equal(player.getCombat().getHitQueue().getQueuedDamage(), damaged ? 65 : 0);
    assert.equal(dusk.getHitpoints(), damaged ? 265 : 200);
  }
});

test('the brittle key used on the Roof Entrance is absorbed and opens it for good; a click does not use it', () => {
  const player = fakePlayer(3427, 3541);
  const { entrance } = Common.ids.locs;
  const key = Common.ids.items.key;
  player.items.set(key, 1);
  Roof.entrance({ player, objectId: entrance });
  assert.equal(player.items.get(key), 1, 'clicking it does not take the key');
  assert.equal(player.getAttribute(Common.UNLOCKED_ATTRIBUTE), undefined);
  const use = { player, objectId: entrance, itemId: key, handled: false };
  Roof.keyOnEntrance(use);
  assert.equal(use.handled, true);
  assert.equal(player.getAttribute(Common.UNLOCKED_ATTRIBUTE), true);
  assert.equal(player.varbits[Common.ids.varbits.unlocked], 1);
  assert.equal(player.items.get(key), 0);
  assert.equal(player.boxes.length, 1, 'an objectbox with the key');
  assert.equal(Common.message('unlocked'), 'You use the key and it is absorbed by the gateway as<br>it activates...');
  assert.equal(Roof.entrance({ player, objectId: 1 }), false);
});

test('going through needs the task at the entrance; then up 5 ticks later, with a fade, at (1697, 4567)', () => {
  const player = fakePlayer(3427, 3541);
  player.attributes[Common.UNLOCKED_ATTRIBUTE] = true;
  player.getIndex = () => 1;
  player.getArea = () => null;
  player.setArea = () => {};
  tasks = [];
  onTaskAnswer = () => false;
  Roof.entrance({ player, objectId: Common.ids.locs.entrance });
  assert.equal(player.boxes.length, 1, 'refused in a mesbox');
  assert.equal(Common.message('noTask'), 'You must have an assigned slayer task of Gargoyles or Grotesque Guardians to access the roof.');
  assert.equal(tasks.length, 0, 'and not taken up');
  onTaskAnswer = () => true;
  Roof.entrance({ player, objectId: Common.ids.locs.entrance });
  assert.equal(player.boxes.length, 2, '"You enter the passageway..."');
  assert.equal(player.blocked, true);
  const due = tasks.map((task) => task.getDelay?.() ?? task.delay);
  assert.ok(due.includes(Common.data.travel.upTicks));
  for (let i = 0; i < 3 && tasks.length; i++) flush();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1697, 4567]);
  assert.ok(player.faded.includes('fade'));
  assert.equal(player.blocked, false);
  Roof.leaveRoof(player);
  tasks = [];
});

test('the bell: the player strikes it, the bell loc swings with sound 3879, the statues come 4 ticks later; Ring says so, Quick-start does not', () => {
  const player = fakePlayer();
  const roof = new Roof.Roof(player);
  let started = 0;
  roof.players = () => [player];
  roof.start = () => { started += 1; };
  player.attributes[Roof.ROOF_ATTRIBUTE] = roof;
  tasks = [];
  const bell = { id: 31669 };
  Roof.ringBell({ player, objectId: 31669, object: bell, option: 'Ring' });
  assert.deepEqual(player.anims, [Common.ids.seqs.ringBell]);
  assert.deepEqual(player.locAnims, [[bell, Common.ids.seqs.bell]], 'the swing is the bell loc\'s');
  assert.deepEqual(player.sounds, [[3879, 20]]);
  assert.equal(player.boxes.length, 1);
  assert.equal(started, 0, 'not straight away');
  Roof.ringBell({ player, objectId: 31669, object: bell, option: 'Ring' });
  assert.equal(player.anims.length, 1, 'ringing again while they wake does nothing');
  assert.equal(tasks[0].getDelay?.() ?? tasks[0].delay, Common.data.bell.wakeTicks);
  flush();
  assert.equal(started, 1);

  const quick = fakePlayer();
  const quickRoof = new Roof.Roof(quick);
  quickRoof.players = () => [quick];
  quickRoof.start = () => {};
  quick.attributes[Roof.ROOF_ATTRIBUTE] = quickRoof;
  Roof.ringBell({ player: quick, objectId: 31669, object: bell, option: 'Quick-start' });
  assert.equal(quick.boxes.length, 0, 'Quick-start has no message');
  tasks = [];
});

test('the Roof Exit: "You escape down..." and down to (3426, 3541, 2) 3 ticks later', () => {
  const player = fakePlayer();
  const roof = new Roof.Roof(player);
  player.attributes[Roof.ROOF_ATTRIBUTE] = roof;
  tasks = [];
  assert.equal(Roof.escape({ player, objectId: Common.ids.locs.exit }), true);
  assert.equal(player.boxes.length, 1);
  assert.ok(tasks.some((task) => (task.getDelay?.() ?? task.delay) === Common.data.travel.downTicks));
  for (let i = 0; i < 3 && tasks.length; i++) flush();
  const at = player.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [3426, 3541, 2]);
  assert.equal(Roof.roofOf(player), null);
  assert.equal(Roof.escape({ player, objectId: Common.ids.locs.exit }), false, 'only from the roof');
  tasks = [];
});

test("the world's own Dusk on the roof is kept out; elsewhere spawns are untouched", () => {
  const roofSpawn = { npcId: Common.ids.npcs.duskPhase2, location: loc(1695, 4573), allow: true };
  Roof.blockWorldSpawn(roofSpawn);
  assert.equal(roofSpawn.allow, false);
  const elsewhere = { npcId: Common.ids.npcs.duskPhase2, location: loc(3200, 3200), allow: true };
  Roof.blockWorldSpawn(elsewhere);
  assert.equal(elsewhere.allow, true);
});

test('the kill: Dusk gives the pair 1,350 Slayer XP and the kill count; Dawn gives none', () => {
  const dusk = fakeGuardian(Common.ids.npcs.duskPhase4, 1689, 4573);
  const dawn = fakeGuardian(Common.ids.npcs.dawnPhase3, 1701, 4573);
  const duskKill = { npc: dusk, xp: 450 };
  Kills.slayerXp(duskKill);
  assert.equal(duskKill.xp, 1350);
  // The pair is one kill on the task: Dawn's death isn't eligible, Dawn alive still is (helmet).
  const alive = { npc: dawn, eligible: true };
  Kills.dawnKillEligible(alive);
  assert.equal(alive.eligible, true);
  dawn.hitpoints = 0;
  const dead = { npc: dawn, eligible: true };
  Kills.dawnKillEligible(dead);
  assert.equal(dead.eligible, false);
  const duskQuery = { npc: dusk, eligible: true };
  dusk.hitpoints = 0;
  Kills.dawnKillEligible(duskQuery);
  assert.equal(duskQuery.eligible, true);

  const player = fakePlayer();
  killTotal = 4;
  Kills.guardianDeath({ npc: dusk, killer: player });
  flush();
  assert.equal(player.getAttribute(Common.KILLS_ATTRIBUTE), 1);
  assert.equal(player.messages.at(-1), Common.message('killCount', { kills: 4 }));
  killTotal = undefined;
});

test("Dusk's kill rolls the Wiki drop table, and Noon is one 1/3,000 tertiary", () => {
  const drops = Common.data.drops;
  assert.equal(drops.rolls, 2, 'two rolls, tertiary excluded (Wiki)');
  assert.equal(drops.main_max_roll, 142);
  const main = drops.entries.filter((entry) => Number.isFinite(entry.weight) && !entry.separate_roll);
  assert.equal(main.reduce((sum, entry) => sum + entry.weight, 0), 142, 'the 142-slot pool');
  const noon = drops.tertiary.filter((entry) => entry.item_id === 21748);
  assert.equal(noon.length, 1);
  assert.deepEqual([noon[0].weight, noon[0].out_of], [1, 3000]);

  const dusk = fakeGuardian(Common.ids.npcs.duskPhase4, 1689, 4573);
  const player = fakePlayer();
  const { __internals } = require('../plugins/npcs/NpcDrops.plugin');
  const original = Math.random;
  Math.random = () => 0;
  try {
    const rolled = __internals.rollTable(drops, player, dusk);
    assert.ok(rolled.some((drop) => drop.itemId === 21726), 'granite dust is 100%');
    assert.ok(rolled.some((drop) => drop.itemId === 21748), 'Noon rolls from the data');
  } finally {
    Math.random = original;
  }

  dropEvents = [];
  Kills.guardianDeath({ npc: dusk, killer: player });
  assert.deepEqual(dropEvents.map((event) => event.name), ['npc-drops:roll-table', 'npc-drops:roll', 'npc-drops:place']);
  assert.equal(dropEvents[0].event.table, drops);
  flush();
});

test('both are finished with a rock hammer at 9 or below, like the gargoyles', () => {
  const file = path.join(__dirname, '..', 'plugins', 'skills', 'data', 'slayer-finishers.json');
  const finishers = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(finishers) ? finishers : finishers.finishers;
  const entry = list.find((f) => f.names?.includes('Dusk'));
  const gargoyle = list.find((f) => f.names?.includes('Gargoyle'));
  const dawn = list.find((f) => f.names?.includes('Dawn'));
  assert.ok(entry && dawn);
  for (const [finisher, name] of [[entry, 'Dusk'], [dawn, 'Dawn']]) {
    assert.deepEqual(finisher.names, [name]);
    assert.equal(finisher.threshold, Common.data.phases.finishThreshold);
    assert.deepEqual(finisher.items, gargoyle.items);
    assert.equal(finisher.finished, `${name} cracks apart.`, 'rsprox');
  }
  assert.equal(entry.tooStrong, "Dusk isn't weak enough to be harmed by the hammer.");
});

test('a stun ends after its ticks; a shorter one inside a longer one leaves the longer release', () => {
  const { bind } = require('../plugins/bosses/grotesqueguardians/Fight.GrotesqueGuardians');
  const player = fakePlayer();
  bind(player, 10);
  bind(player, 3);
  assert.equal(player.blocked, true);
  assert.equal(tasks.length, 1, 'only the longer stun schedules a release');
  flush();
  assert.equal(player.blocked, false);
});

test('a Guardian that cannot be hurt keeps its hitpoints against any damage', () => {
  const { fight, dusk, dawn, player } = newFight();
  assert.equal(dusk.locked, true);
  assert.equal(dawn.locked, false);
  dawn.hitpoints = 225;
  fight.tick([player]);
  assert.equal(dusk.locked, false);
  assert.equal(dawn.locked, true, 'Dawn in the sky');
  fight.stop();
  assert.equal(dusk.locked, false);
  assert.equal(dawn.locked, false);
});

test('Dusk down to the hammer takes nothing back from a prison', () => {
  const player = fakePlayer(1695, 4575);
  const { fight, dusk } = newFight(player);
  fight.phase = 4;
  fight.imprison(player);
  dusk.hitpoints = 0;
  for (let i = 0; i < Common.data.prison.escapeTicks; i++) fight.tick([player]);
  assert.equal(dusk.hitpoints, 0);
});

test('a bell rung straight after the kill keeps its new fight', () => {
  const dusk = fakeGuardian(Common.ids.npcs.duskPhase4, 1689, 4573);
  const old = { stop: () => {} };
  let cleared = 0;
  const roof = { fight: old, clearGuardians: () => { cleared += 1; } };
  dusk.__ggFight = old;
  dusk.__ggRoof = roof;
  Kills.guardianDeath({ npc: dusk, killer: null });
  roof.fight = { stop: () => {} };
  flush();
  assert.equal(cleared, 0);
  roof.fight = old;
  dusk.__ggFight = old;
  Kills.guardianDeath({ npc: dusk, killer: null });
  flush();
  assert.equal(cleared, 1);
});

test("the fight's own lines: knocked out by a rock, an energy sphere absorbed, trampled under Dusk", () => {
  const { fight, dusk, dawn, player } = newFight(fakePlayer(1695, 4575));
  dawn.hitpoints = 225;
  fight.tick([player]);
  assert.equal(fight.phase, 2);
  fight.rocks = [{ tile: player.getLocation(), lands: fight.tickCount + 1 }];
  fight.tick([player]);
  assert.ok(player.messages.includes(Common.message('knockedOut')));
  assert.equal(Common.message('knockedOut'), 'You have been knocked out!');

  const under = fakePlayer(1690, 4574);
  const alone = newFight(under);
  alone.dawn.hitpoints = 225;
  const before = under.damage.length;
  alone.fight.tick([under]);
  assert.equal(alone.fight.phase, 2, "Dusk alone");
  alone.fight.tick([under]);
  assert.equal(under.messages.at(-1), "You get trampled under Dusk's massive body.");
  const trample = under.damage.slice(before);
  assert.ok(trample.length === 1 && trample[0] >= 30 && trample[0] <= 40, 'Wiki: 30-40');
  alone.fight.tick([under]);
  assert.equal(under.damage.length, before + 1, 'not every tick');

  const third = newFight(fakePlayer(1695, 4575));
  third.fight.phase = 3;
  third.fight.spheres = [{ tile: third.player.getLocation(), arrives: 999 }];
  third.fight.tickSpheres([third.player]);
  assert.equal(third.player.messages.at(-1), 'You absorb the energy sphere.');
  tasks = [];
});

test("Dusk's blocked hits say why: his stone armour against ranged and magic, his wing against melee", () => {
  const { fight, dusk, player } = newFight();
  dusk.__ggFight = fight;
  const ranged = fakeHit(player, core.CombatType.RANGED, [10]);
  Roof.guardianHit({ npc: dusk, hit: ranged });
  assert.equal(player.messages.at(-1), "Dusk's stone armour absorbs all magic and ranged based attacks.");
  const melee = fakeHit(player, core.CombatType.MELEE, [10]);
  Roof.guardianHit({ npc: dusk, hit: melee });
  assert.equal(player.messages.at(-1), 'Dusk is defending himself with his wing! He absorbs the attack.');
});

test('the kill gives the fight duration from the bell and the personal best', () => {
  const dusk = fakeGuardian(Common.ids.npcs.duskPhase4, 1689, 4573);
  const fight = { stop: () => {} };
  const roof = { fight, startedAt: 0, clearGuardians: () => {} };
  dusk.__ggFight = fight;
  dusk.__ggRoof = roof;
  const player = fakePlayer();
  const original = core.World.getProcessCycle;
  core.World.getProcessCycle = () => 139;
  try {
    tasks = [];
    Kills.guardianDeath({ npc: dusk, killer: player });
    flush();
  } finally {
    core.World.getProcessCycle = original;
  }
  assert.equal(player.messages.at(-1), 'Fight duration: <col=ff0000>1:23.4</col>. Personal best: 1:23.4');
  assert.equal(player.getAttribute(Common.BEST_ATTRIBUTE), 139);
  assert.equal(Common.formatTicks(100), '1:00.0');
  tasks = [];
});
