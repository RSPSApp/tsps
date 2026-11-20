// From server/: node --test tests/alchemical-hydra.test.cjs (after yarn build).
//
// The Alchemical Hydra against the OSRS Wiki (Alchemical_Hydra, /Strategies) and rsprox captures
// 1000143/1000471/1000473/1000480/1000497 (docs/alchemical-hydra.md): its reach (it walks after a
// player further than 4 tiles from its footprint, issue 6284), the attack count (three, the special,
// then every tenth), the style switches, the heads' projectiles and max hits, the 75% shield and its
// vents, the phase changes at 825/550/275, the poison, lightning and fire specials, the private
// chamber's door and spawn, and the kill.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPCDeathTask } = require('../dist/game/task/impl/NPCDeathTask');
const core = PluginManager.getCoreApi();

let Common, Fight, Lair, Kills, tasks, onTaskAnswer;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  Common = require('../plugins/bosses/alchemicalhydra/Common.AlchemicalHydra');
  ({ Fight } = { Fight: require('../plugins/bosses/alchemicalhydra/Fight.AlchemicalHydra').Fight });
  Lair = require('../plugins/bosses/alchemicalhydra/Lair.AlchemicalHydra');
  Kills = require('../plugins/bosses/alchemicalhydra/Kills.AlchemicalHydra');
  tasks = [];
  const events = {};
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => tasks.push(task) }, CombatFactory: { poisonEntity: (player, severity) => player.poison.push(severity) } },
    persistAttribute: () => {},
    onCustomEvent: (name, fn) => (events[name] ??= []).push(fn),
    emitCustomEvent(name, event) {
      if (name === 'slayer:on-task') { event.onTask = onTaskAnswer(event); return; }
      for (const fn of events[name] ?? []) fn(event);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
});

/** Runs every queued one-shot task (the phase change's second step). */
function flush() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

const loc = (x, y) => new core.Location(x, y, 0);

function fakeHydra(hp = 1100, at = loc(1364, 10265)) {
  let transform = -1;
  let tile = at;
  const npc = {
    hitpoints: hp, anims: [], flags: new Set(), steps: [], faced: [], scripted: false, attackDelay: null,
    getId: () => (transform !== -1 ? transform : Common.ids.npcs.serpentine),
    setNpcTransformationId: (id) => { transform = id; },
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    getSize: () => 6,
    getHitpoints: () => npc.hitpoints,
    isDyingFunction: () => false,
    performAnimation: (anim) => npc.anims.push(anim.getId?.() ?? anim.id),
    setFlag: (flag) => npc.flags.add(flag),
    removeFlag: (flag) => npc.flags.delete(flag),
    setScriptedMovement: (on) => { npc.scripted = on; },
    setPositionToFace: (to) => npc.faced.push([to.getX(), to.getY()]),
    getPrivateArea: () => null,
    forceChat: () => {},
    getMovementQueue: () => ({ walkStep: (dx, dy) => { npc.steps.push([dx, dy]); tile = tile.transform(dx, dy); } }),
    getCombat: () => ({ setAttackDelay: (d) => { npc.attackDelay = d; }, getHitQueue: () => ({ getQueuedDamage: () => 0 }) }),
  };
  return npc;
}

/** A packet sender that keeps what it was asked to send. */
function fakeSender(into) {
  return {
    sendGraphic: (graphic, at) => into.push({ graphic: graphic.id, delay: graphic.delay, x: at.getX(), y: at.getY() }),
    sendAreaSound: (id, x, y, level, loops, delay, range) => into.push({ sound: id, x, y, delay, range }),
    sendObject: (object) => into.push({ loc: object.getId(), x: object.getLocation().getX(), y: object.getLocation().getY() }),
    sendObjectAnimation: (object, anim) => into.push({ locAnim: anim.getId?.() ?? anim.id, loc: object.getId(), x: object.getLocation().getX(), y: object.getLocation().getY() }),
  };
}

function fakePlayer(x = 1363, y = 10260) {
  let tile = loc(x, y);
  const player = {
    damage: [], poison: [], messages: [], sent: [], blocked: false,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    getHitpoints: () => 99,
    sendMessage: (m) => player.messages.push(m),
    getPacketSender: () => fakeSender(player.sent),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits.map((h) => h.getDamage())) }) }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: (value) => { player.blocked = value; } }),
  };
  return player;
}

function fakeLair(player) {
  const [minX, maxX, minY, maxY] = Common.data.room.bounds;
  return {
    players: () => (player ? [player] : []),
    contains: (l) => l.getX() >= minX && l.getX() <= maxX && l.getY() >= minY && l.getY() <= maxY,
  };
}

test('every id resolves from the cache, the phase forms in the Wiki order', () => {
  assert.deepEqual(Common.phaseForms(), [8615, 8619, 8620, 8621]);
  assert.deepEqual(Common.ids.locs.door, [34553, 34554]);
  assert.deepEqual(Common.ids.seqs.switch, [9111, 9112, 9113]);
  assert.equal(Common.ids.seqs.special[3], Common.ids.seqs.ranged[3], 'enraged, the poison is thrown with its ranged sequence');
  assert.deepEqual([Common.ids.locs.blocking, Common.ids.locs.nonblocking], [26209, 29733]);
});

test('issue 6284: it attacks from range but walks in until the player is within 4 tiles of its footprint', () => {
  const { CombatRange } = require('../dist/game/content/combat/CombatRange');
  const { Combat: EngineCombat } = require('../dist/game/content/combat/Combat');
  const Combat = require('../plugins/bosses/alchemicalhydra/Combat.AlchemicalHydra');
  Lair.attach(new Proxy({}, { get: () => () => {} }));
  const owner = new Player(null, loc(1356, 10258));
  owner.setRegistered(true);
  const lair = new Lair.Lair(owner);
  const npc = lair.spawnHydra();
  try {
    assert.equal(npc.getAttribute(EngineCombat.CLOSE_IN_DISTANCE_ATTRIBUTE), 4, 'it closes in to 4');
    const method = new (Combat.combatClass())();
    // Its footprint is x 1364-1369: from the door, 8 off, it already attacks (rsprox 1000143 t245).
    for (const x of [1360, 1359, 1356]) {
      const player = new Player(null, loc(x, 10267));
      lair.area.add(player);
      assert.equal(CombatRange.canReach(npc, method, player), true, `it attacks from x ${x}`);
      assert.equal(CombatRange.within(npc, player, 4), x >= 1360, `x ${x}: it ${x >= 1360 ? 'stays' : 'walks in'}`);
    }
  } finally {
    lair.destroy();
    const queue = core.World.getAddNPCQueue();
    queue.length = 0;
    owner.setRegistered(false);
  }
});

test('issue 6284, the real combat cycle: from the door it attacks and steps in together, stopping 4 tiles off', (t) => {
  const { World } = require('../dist/game/World');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const Combat = require('../plugins/bosses/alchemicalhydra/Combat.AlchemicalHydra');
  RegionManager.init();
  RegionManager.loadMapFiles(1364, 10265);
  let cycle = 5000;
  t.mock.method(World, 'getProcessCycle', () => cycle);
  const Ctor = Combat.combatClass();
  const provider = { pluginName: 'test', provider: { provide: (npc) => (Common.phaseForms().includes(npc.getId()) ? new Ctor(npc) : null) }, npcIds: new Set(Common.phaseForms()) };
  PluginManager.npcCombatMethodProviders.unshift(provider);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(7911); player.setUsername('hydraqa'); player.setLocation(loc(1356, 10258));
  player.setAttribute('bot-skip-persistence', true);
  player.setRegistered(true); World.registerPlayerPosition(player); player.setNeedsPlacement(false);
  const npc = new core.NPC(Common.ids.npcs.serpentine, loc(1364, 10265));
  World.getNpcs().add(npc, true); npc.setNeedsPlacement(false);
  npc.setAttribute('combat:close-in-distance', Common.data.combat.closeInDistance);
  const fight = new Fight({ players: () => [player], contains: () => true }, npc, () => 0);
  const attacks = [];
  const perform = npc.performAnimation.bind(npc);
  npc.performAnimation = (anim) => { attacks.push(cycle); perform(anim); };
  try {
    npc.getCombat().attack(player);
    const path = [];
    for (let i = 0; i < 8; i++) {
      cycle += 1;
      npc.process();
      path.push(`${npc.getLocation().getX()},${npc.getLocation().getY()}`);
    }
    // rsprox 1000143 t245-247: (1363,10264) with the first attack, then a tile a tick; the stop at 4
    // off is the recordings' distance counts (docs/alchemical-hydra.md), the player moving at t247.
    assert.deepEqual(path.slice(0, 5), ['1363,10264', '1362,10263', '1361,10262', '1360,10261', '1360,10261']);
    assert.equal(attacks[0], 5001, 'it attacks on the tick it starts walking');
  } finally {
    PluginManager.npcCombatMethodProviders.splice(PluginManager.npcCombatMethodProviders.indexOf(provider), 1);
    fight.stop();
    World.getNpcs().remove(npc);
    World.unregisterPlayerPosition(player); player.setRegistered(false);
  }
});

test('three attacks, the special on the fourth, then every tenth; styles switch every three', () => {
  const fight = new Fight(fakeLair(null), fakeHydra(), () => 0);
  const kinds = [];
  for (let i = 0; i < 24; i++) {
    const kind = fight.nextAttack();
    kinds.push(kind);
    fight.counted(kind);
  }
  assert.deepEqual(kinds.flatMap((k, i) => (k === 'special' ? [i + 1] : [])), [4, 14, 24]);
  assert.deepEqual(kinds.slice(0, 14).map((k) => k[0]).join(''), 'rrrsmmmrrrmmms');
  fight.stop();
});

test('the style count carries over a phase change: two ranged, then one more, the other style, the special', () => {
  const npc = fakeHydra(824);
  const fight = new Fight(fakeLair(null), npc, () => 0);
  fight.style = 'ranged';
  fight.basics = 2;
  fight.checkPhase();
  flush();
  fight.tickCount = fight.transitionUntil;
  const kinds = [];
  for (let i = 0; i < 4; i++) { const k = fight.nextAttack(); kinds.push(k); fight.counted(k); }
  assert.deepEqual(kinds, ['ranged', 'magic', 'magic', 'special'], 'rsprox: "RwMMS"');
  fight.stop();
});

test('the switch sequence plays 3 ticks after the third attack of a style', () => {
  const npc = fakeHydra();
  const fight = new Fight(fakeLair(fakePlayer()), npc, () => 0);
  tasks = [];
  for (let i = 0; i < 2; i++) fight.counted('ranged');
  assert.equal(tasks.length, 0);
  fight.counted('ranged');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].getDelay?.() ?? tasks[0].delay, Common.data.combat.switchAnimDelay);
  flush();
  assert.equal(npc.anims.at(-1), Common.ids.seqs.switch[0]);
  fight.stop();
});

test('enraged, the style switches every attack', () => {
  const fight = new Fight(fakeLair(null), fakeHydra(), () => 0);
  fight.phase = 3;
  const kinds = [];
  for (let i = 0; i < 3; i++) { const k = fight.nextAttack(); kinds.push(k); fight.counted(k); }
  assert.deepEqual(kinds, ['magic', 'ranged', 'magic'], 'the first opposite the last style');
  fight.stop();
});

test('its basic attacks never poison; only the acid does (rsprox: 34 of 34 poisonings on a landing tick)', () => {
  const Combat = require('../plugins/bosses/alchemicalhydra/Combat.AlchemicalHydra');
  const event = { attacker: fakeHydra(), target: fakePlayer(), severity: 30, handled: false };
  Combat.basicAttackPoison(event);
  assert.equal(event.handled, true);
  const other = { attacker: { getId: () => 1 }, handled: false };
  Combat.basicAttackPoison(other);
  assert.equal(other.handled, false);
});

test('the heads: serpentine two a style, electric two magic and one ranged, flame and enraged one; the Wiki maxes', () => {
  const fight = new Fight(fakeLair(null), fakeHydra());
  const rows = [
    [0, 'ranged', 17, 2, 26], [0, 'magic', 17, 2, 26],
    [1, 'ranged', 35, 1, 52], [1, 'magic', 17, 2, 26],
    [2, 'ranged', 35, 1, 52], [2, 'magic', 35, 1, 52],
    [3, 'ranged', 55, 1, 55], [3, 'magic', 55, 1, 55],
  ];
  for (const [phase, style, max, hits, empowered] of rows) {
    fight.phase = phase;
    fight.empowered = false;
    assert.deepEqual(fight.hitsOf(style), { max, hits }, `phase ${phase} ${style}`);
    fight.empowered = true;
    assert.equal(fight.hitsOf(style).max, empowered, `phase ${phase} ${style} empowered`);
  }
  fight.stop();
});

test('shielded it takes a quarter; its own vent under it takes the shield once, any other empowers it every time', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const fight = new Fight(fakeLair(player), npc);
  assert.equal(fight.reduce(40), 10);
  // A tile off its footprint is not under it (rsprox: only a vent tile inside the 6x6 counts).
  npc.moveTo(loc(1365, 10258));
  fight.eruptVents([player]);
  assert.equal(fight.shielded, true, 'the red vent is a tile east of its footprint');
  // Its 6x6 footprint from (1366, 10258) covers (1371, 10263): on the red vent.
  npc.moveTo(loc(1366, 10258));
  fight.eruptVents([player]);
  assert.equal(fight.shielded, false);
  assert.equal(player.messages.at(-1), Common.message('weakened'));
  assert.equal(player.sent.filter((s) => s.sound === Common.data.sounds.roar.id).length, 1, 'it roars');
  fight.eruptVents([player]);
  assert.equal(player.messages.filter((m) => m === Common.message('weakened')).length, 1, 'once a phase');
  assert.equal(fight.reduce(40), 40);
  fight.phase = 1;
  fight.shielded = true;
  fight.eruptVents([player]);
  fight.eruptVents([player]);
  assert.equal(fight.shielded, true, 'the red vent does nothing for the electric phase');
  assert.equal(player.messages.filter((m) => m === Common.message('empowered')).length, 2, 'every eruption');
  assert.equal(Common.message('empowered'), 'The chemicals are absorbed by the Alchemical Hydra, empowering it further!');
  fight.stop();
});

test('the chamber: geysers erupt every 8 ticks of the world clock, off 5 later, judged 2 after', (t) => {
  let cycle = 0;
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  Lair.attach(new Proxy({}, { get: () => () => {} }));
  const player = new Player(null, loc(1363, 10260));
  const sent = [];
  player.getPacketSender = () => new Proxy(fakeSender(sent), { get: (target, key) => target[key] ?? (() => {}) });
  player.setRegistered(true);
  const lair = Lair.enterLair(player);
  try {
    const judged = [];
    lair.fight.eruptVents = () => judged.push(cycle);
    for (cycle = 16; cycle < 32; cycle++) lair.tick();
    const geysers = sent.filter((s) => s.locAnim === Common.ids.seqs.geyser);
    const off = sent.filter((s) => s.locAnim === Common.ids.seqs.geyserOff);
    assert.equal(geysers.length, 6, 'three vents, twice');
    assert.equal(off.length, 6);
    assert.deepEqual(judged, [18, 26]);
    assert.ok(sent.some((s) => s.sound === Common.data.sounds.geyser.id && s.delay === 38 && s.range === 10));
  } finally {
    Lair.leaveLair(player);
    const queue = core.World.getAddNPCQueue();
    for (let index = queue.indexOf(lair.hydra); index !== -1; index = queue.indexOf(lair.hydra)) queue.splice(index, 1);
    player.setRegistered(false);
  }
});

test('a head falls at 825, 550 and 275: each form in turn, 2, 1 and 2 ticks, shielded again until the enraged one', () => {
  const npc = fakeHydra(824);
  const player = fakePlayer();
  const fight = new Fight(fakeLair(player), npc);
  const { ids } = Common;
  assert.equal(fight.checkPhase(), true);
  assert.equal(npc.getId(), ids.npcs.toElectric);
  assert.equal(fight.transitionUntil - fight.tickCount, 2);
  assert.equal(fight.transitioning(), true);
  flush(1);
  assert.equal(npc.getId(), ids.npcs.electric);
  assert.equal(npc.attackDelay, Common.data.combat.firstAttackAfterSpawn);
  assert.equal(fight.shielded, true);
  assert.equal(fight.checkPhase(), false, 'not below 550 yet');
  fight.tickCount = fight.transitionUntil;
  npc.hitpoints = 549;
  fight.checkPhase();
  assert.equal(fight.transitionUntil - fight.tickCount, 1);
  flush(1);
  assert.equal(npc.getId(), ids.npcs.flame);
  fight.tickCount = fight.transitionUntil;
  npc.hitpoints = 274;
  fight.checkPhase();
  flush(1);
  assert.equal(npc.getId(), ids.npcs.enraged);
  assert.equal(fight.enraged, true);
  assert.equal(player.messages.at(-1), 'The Alchemical Hydra becomes enraged!');
  assert.equal(npc.attackDelay, Common.data.combat.firstEnragedAttackAfterSpawn);
  assert.equal(fight.reduce(40), 40, 'no shield once enraged');
  npc.hitpoints = 1;
  assert.equal(fight.checkPhase(), false);
  fight.stop();
});

test('poison: five blobs, the first on the player, 3x3 splashes (up to 7, poison 6 on the target), one-tile pools for 13 ticks', (t) => {
  const flights = [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () { flights.push(this); });
  const player = fakePlayer();
  const npc = fakeHydra();
  const fight = new Fight(fakeLair(player), npc);
  tasks = [];
  fight.spitPoison(player);
  assert.equal(flights.length, Common.data.poison.blobs);
  assert.deepEqual([flights[0].end.getX(), flights[0].end.getY()], [1363, 10260]);
  const from = flights[0].start;
  for (const flight of flights) {
    const d = Math.max(Math.abs(flight.end.getX() - from.getX()), Math.abs(flight.end.getY() - from.getY()));
    assert.equal(flight.speed, 60 + 10 * d, 'rsprox: 60 + 10 a tile');
  }
  assert.equal(new Set(flights.map((f) => `${f.end.getX()},${f.end.getY()}`)).size, flights.length, 'each on its own tile');
  tasks = [];
  fight.landPoison(player.getLocation(), player);
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] <= Common.data.poison.splashMax);
  assert.deepEqual(player.poison, [Common.data.poison.poisonTargeted * 5], 'severity 30, a first hit of 6');
  assert.equal(fight.pools.length, 1, 'rsprox: the pool is the blob\'s own tile');
  fight.tickPools([player]);
  assert.equal(player.damage.length, 1, 'the pool hurts from the next tick');
  for (let i = 0; i < 13; i++) {
    fight.tickCount += 1;
    fight.tickPools([player]);
  }
  assert.equal(player.damage.length, 14, 'thirteen ticks of the pool');
  assert.ok(player.damage.slice(1).every((d) => d >= 1 && d <= Common.data.poison.poolMax));
  fight.tickCount += 1;
  fight.tickPools([player]);
  assert.equal(fight.pools.length, 0);
  fight.stop();
});

test('enraged, one blob while the flame phase\'s fires still burn, five once they are out', (t) => {
  const flights = [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () { flights.push(this); });
  const player = fakePlayer();
  const fight = new Fight(fakeLair(player), fakeHydra());
  fight.phase = 3;
  fight.blockedUntil = fight.tickCount + 10;
  fight.spitPoison(player);
  assert.equal(flights.length, 1);
  fight.blockedUntil = 0;
  fight.spitPoison(player);
  assert.equal(flights.length, 1 + Common.data.poison.blobs);
  tasks = [];
  fight.stop();
});

test('lightning: a ball on the centre, four currents a quadrant each 3 ticks later; one reaching the player hits and paralyses', (t) => {
  const flights = [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () { flights.push(this); });
  const player = fakePlayer(1360, 10256);
  const fight = new Fight(fakeLair(player), fakeHydra());
  fight.castLightning();
  assert.deepEqual([flights[0].end.getX(), flights[0].end.getY()], Common.data.room.lightningCentre);
  for (let i = 0; i < 3; i++) { fight.tickCount += 1; fight.tickCurrents([player]); }
  const travel = flights.slice(1);
  assert.equal(travel.length, 4);
  assert.deepEqual(travel.map((f) => [f.delay, f.speed]), [[15, 30], [45, 60], [75, 90], [105, 120]]);
  const quadrant = (f) => `${f.end.getX() > 1366 ? 'E' : 'W'}${f.end.getY() > 10267 ? 'N' : 'S'}`;
  assert.equal(new Set(travel.map(quadrant)).size, 4, 'one a quadrant');
  for (let i = 0; i < 30 && fight.lightningActive(); i++) {
    fight.tickCount += 1;
    fight.tickCurrents([player]);
  }
  assert.ok(player.damage.length >= 1, 'a current reached the player');
  assert.ok(player.damage.every((d) => d <= Common.data.lightning.max));
  assert.equal(player.messages[0], '<col=ff0000>The electricity temporarily paralyzes you!</col>');
  assert.equal(player.blocked, true);
  tasks = [];
  fight.stop();
});

test('a current lives 12 ticks', () => {
  const player = fakePlayer(1300, 10200); // out of its reach
  const fight = new Fight(fakeLair(player), fakeHydra());
  fight.currents = [{ x: 1360, y: 10261, at: 0, shown: 0 }];
  let ticks = 0;
  while (fight.currents.length && ticks < 30) { fight.tickCount += 1; fight.tickCurrents([player]); ticks += 1; }
  assert.equal(ticks, Common.data.lightning.lifetime);
  fight.stop();
});

test('fire: the walk to the centre, solid, the stun, a wall to each side of the player\'s diagonal, the tracking fire and its five burns', (t) => {
  t.mock.method(core.Projectile.prototype, 'sendProjectile', () => {});
  const player = fakePlayer(1362, 10272); // north-west of the centre
  const npc = fakeHydra(1100, loc(1361, 10272));
  const fight = new Fight(fakeLair(player), npc);
  fight.phase = 2;
  tasks = [];
  fight.startFire(player);
  assert.equal(fight.busy(), true);
  assert.equal(npc.scripted, true);
  for (let i = 0; i < 12 && fight.fire.stage === 'walk'; i++) { fight.tickCount += 1; fight.tickFire([player]); }
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], Common.data.room.centre);
  assert.deepEqual(npc.steps.slice(0, 3), [[1, -1], [1, -1], [1, -1]], 'diagonal first');
  assert.equal(npc.flags.has(core.NPC.BLOCKS_PLAYERS_FLAG), true, 'solid while the fires stand');
  assert.equal(player.sent.filter((s) => s.loc === Common.ids.locs.blocking).length, 36, 'blockers over its 6x6');
  const at = fight.tickCount;
  const step = () => { fight.tickCount += 1; fight.tickFire([player]); flush(); };
  step();
  assert.equal(player.messages.at(-1), 'The Alchemical Hydra temporarily stuns you.');
  assert.equal(player.blocked, true);
  while (fight.tickCount < at + 3) step();
  // North first (clockwise from the north-west), a wall 4 wide (x 1365-1368) out to y 10278.
  let flames = fight.flames.map((f) => `${f.getX()},${f.getY()}`);
  assert.equal(flames.length, 32);
  assert.ok(flames.includes('1365,10271') && flames.includes('1368,10278') && !flames.includes('1364,10271'));
  assert.deepEqual(npc.faced.at(-1), [1367, 10283]);
  while (fight.tickCount < at + 6) step();
  flames = fight.flames.map((f) => `${f.getX()},${f.getY()}`);
  assert.ok(flames.includes('1363,10266') && flames.includes('1356,10269'), 'then west, y 10266-10269 out to x 1356');
  assert.deepEqual(npc.faced.at(-1), [1352, 10268]);
  const fireDelays = player.sent.filter((s) => s.graphic === Common.ids.spotanims.fire && s.y === 10267).map((s) => s.delay);
  assert.deepEqual(fireDelays, [45, 50, 55, 60, 65, 70, 75, 80], '45 + 5 a tile');
  player.moveTo(loc(1362, 10273));
  while (fight.tickCount < at + 9) step();
  assert.deepEqual(npc.faced.at(-1), [1352, 10283], 'the tracking fire down the diagonal');
  for (let i = 0; i < 40; i++) step();
  assert.ok(player.damage.length >= 1 + Common.data.fire.burnHits, 'the fire and its burns');
  assert.equal(player.damage.filter((d) => d === Common.data.fire.burnDamage).length >= Common.data.fire.burnHits - 1, true);
  assert.ok(player.messages.includes('The fire scorches you leaving a lingering burn...'));
  assert.ok(player.messages.includes('You continue to suffer from the burn.'));
  assert.equal(player.messages.at(-1), 'The burn clears up.');
  assert.equal(fight.busy(), false, 'its attacks again');
  assert.equal(npc.scripted, false);
  fight.stop();
});

test('fire: a player in its way doesn\'t stop its walk; one under it is pushed out; the blockers clear where they went up', (t) => {
  t.mock.method(core.Projectile.prototype, 'sendProjectile', () => {});
  const player = fakePlayer(1366, 10267);
  const npc = fakeHydra(1100, loc(1367, 10265));
  const fight = new Fight(fakeLair(player), npc, () => 0);
  fight.phase = 2;
  fight.startFire(player);
  assert.equal(npc.flags.has(core.NPC.WALK_THROUGH_ENTITIES_FLAG), true, 'it walks through the player');
  for (let i = 0; i < 6 && fight.fire.stage === 'walk'; i++) { fight.tickCount += 1; fight.tickFire([player]); }
  assert.equal(fight.fire.stage, 'breath');
  assert.equal(npc.flags.has(core.NPC.WALK_THROUGH_ENTITIES_FLAG), false);
  assert.equal(Common.distanceToFootprint(player.getLocation(), npc), 1, 'pushed out of its footprint');
  const blocked = player.sent.filter((s) => s.loc === Common.ids.locs.blocking).map((s) => `${s.x},${s.y}`);
  npc.moveTo(loc(1360, 10261)); // it walks off after the special
  fight.unblock();
  const cleared = player.sent.filter((s) => s.loc === Common.ids.locs.nonblocking).map((s) => `${s.x},${s.y}`);
  assert.deepEqual(cleared, blocked);
  tasks = [];
  fight.stop();
});

test('fire: the next attack 12 ticks after the last breath, the blockers gone 56 ticks after they came', (t) => {
  t.mock.method(core.Projectile.prototype, 'sendProjectile', () => {});
  const player = fakePlayer(1362, 10273);
  const npc = fakeHydra();
  const fight = new Fight(fakeLair(player), npc);
  fight.phase = 2;
  fight.breatheFire(player);
  const at = fight.tickCount;
  let resumed = null;
  for (let i = 0; i < 60; i++) {
    fight.tickCount += 1;
    fight.tickFire([player]);
    tasks = [];
    if (resumed === null && !fight.busy()) resumed = fight.tickCount - at;
  }
  assert.equal(resumed, 9 + 12 - 1, 'it lets go a tick before its next swing');
  assert.equal(npc.flags.has(core.NPC.BLOCKS_PLAYERS_FLAG), false);
  assert.equal(fight.firesBurning(), false);
  assert.equal(player.sent.filter((s) => s.loc === Common.ids.locs.nonblocking).length, 36);
  fight.stop();
});

test('it holds still through a form change, ending the player\'s attack quietly; a walk cut short counts no wall', () => {
  const player = fakePlayer();
  let target = null;
  player.getCombat = () => ({ getTarget: () => target, reset: () => { target = null; }, getHitQueue: () => ({ addPendingDamage: () => {} }) });
  const npc = fakeHydra(549);
  let resets = 0;
  const queue = npc.getMovementQueue();
  npc.getMovementQueue = () => ({ ...queue, reset: () => { resets += 1; } });
  const fight = new Fight(fakeLair(player), npc);
  fight.phase = 1;
  target = npc;
  tasks = [];
  fight.checkPhase();
  assert.equal(npc.scripted, true, 'held still');
  assert.equal(resets, 1);
  assert.equal(target, null, 'the player\'s attack ended');
  assert.deepEqual(player.messages, [], 'no refusal without a click');
  flush();
  assert.equal(npc.scripted, false, 'free again with the next form');
  fight.tickCount = fight.transitionUntil;
  npc.hitpoints = 274;
  fight.startFire(player);
  fight.checkPhase();
  assert.equal(npc.scripted, true, 'held still through a change that cut its fire special short');
  assert.equal(require('../plugins/bosses/alchemicalhydra/Fight.AlchemicalHydra').lifeOf(npc).fireBreaths, 0, 'The Flame Skipper: no wall was breathed');
  tasks = [];
  fight.stop();
});

test('a phase change dissipates the lightning and ends a fire special, and stopping clears everything', () => {
  const player = fakePlayer();
  const npc = fakeHydra(549);
  const fight = new Fight(fakeLair(player), npc);
  fight.phase = 1;
  fight.castLightning();
  fight.checkPhase();
  assert.equal(fight.lightningActive(), false);
  tasks = [];
  fight.tickCount = fight.transitionUntil;
  npc.hitpoints = 274;
  fight.startFire(player);
  fight.checkPhase();
  assert.equal(fight.busy(), false);
  fight.landPoison(player.getLocation(), player);
  fight.stop();
  assert.equal(fight.pools.length, 0);
  assert.equal(npc.__hydraFight, null);
  tasks = [];
});

test('the world spawn in the chamber stays out; a hit off task does nothing', () => {
  const event = { npcId: Common.ids.npcs.serpentine, location: loc(1364, 10265), allow: true };
  Lair.blockWorldSpawn(event);
  assert.equal(event.allow, false);
  const outside = { npcId: Common.ids.npcs.serpentine, location: loc(1300, 10200), allow: true };
  Lair.blockWorldSpawn(outside);
  assert.equal(outside.allow, true);

  const npc = fakeHydra();
  const fight = new Fight(fakeLair(null), npc);
  const part = { damage: 40, getDamage() { return this.damage; }, setDamage(d) { this.damage = d; } };
  const player = { isPlayer: () => true, getAsPlayer: () => player };
  onTaskAnswer = () => false;
  Lair.hydraHit({ npc, hit: { getAttacker: () => player, getHits: () => [part] } });
  assert.equal(part.damage, 0);
  onTaskAnswer = () => true;
  part.damage = 40;
  Lair.hydraHit({ npc, hit: { getAttacker: () => player, getHits: () => [part] } });
  assert.equal(part.damage, 10, 'shielded: a quarter');
  fight.stop();
});

test('a hit on its shield shows the absorb line with the swing; none once weakened or for a miss', () => {
  const npc = fakeHydra();
  const fight = new Fight(fakeLair(null), npc);
  const player = fakePlayer();
  const hit = (damage) => ({ getTotalDamage: () => damage });
  Lair.absorbedHit({ player, target: npc, hit: hit(12) });
  assert.deepEqual(player.messages, ["The Alchemical Hydra's defences partially absorb your attack!"]);
  Lair.absorbedHit({ player, target: npc, hit: hit(0) });
  fight.shielded = false;
  Lair.absorbedHit({ player, target: npc, hit: hit(12) });
  assert.equal(player.messages.length, 1);
  fight.stop();
});

test('the door: in a tile on its own row, jammed while the Hydra lives, out a tile once it is dead', () => {
  Lair.attach(new Proxy({}, { get: () => () => {} }));
  const player = new Player(null, loc(1355, 10258));
  const sent = [];
  player.getPacketSender = () => new Proxy(fakeSender(sent), { get: (target, key) => target[key] ?? (() => {}) });
  const messages = [];
  player.sendMessage = (m) => messages.push(m);
  player.setRegistered(true);
  const [door] = Common.ids.locs.door;
  try {
    Lair.openDoor({ player, objectId: door });
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1356, 10258]);
    assert.deepEqual(sent.filter((s) => s.sound).map((s) => s.sound), [4129, 4102]);
    Lair.openDoor({ player, objectId: door });
    assert.deepEqual(messages, ['The door is jammed.']);
    const lair = Lair.lairOf(player);
    lair.hydra.setHitpoints(0);
    Lair.openDoor({ player, objectId: door });
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1355, 10258]);
    assert.equal(Lair.lairOf(player), null);
  } finally {
    Lair.leaveLair(player);
    const queue = core.World.getAddNPCQueue();
    queue.length = 0;
    player.setRegistered(false);
  }
});

test('the kill: its fight stops, it stays 2 more ticks, then the fight duration and the count; a task kill is worth 1,320 Slayer xp', (t) => {
  let cycle = 1000;
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  const npc = fakeHydra(0);
  const fight = new Fight(fakeLair(null), npc);
  fight.counted('ranged');
  const attrs = new Map();
  const player = { isPlayer: () => true, isRegistered: () => true, messages: [], sendMessage(m) { this.messages.push(m); }, getAttribute: (k) => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v) };
  cycle = 1098;
  const event = { npc, killer: player };
  Kills.hydraDeath(event);
  assert.equal(fight.stopped, true);
  assert.deepEqual(event.remains, { ticks: 2 }, 'the engine gives it 1 + 7 death ticks; 2 more make 10');
  assert.deepEqual(player.messages, [], 'not until it is taken away');
  flush();
  assert.deepEqual(player.messages, [
    'Fight duration: <col=ff0000>1:00</col> (new personal best).',
    'Your Alchemical Hydra kill count is: <col=ff0000>1</col>.',
  ]);
  // The next, slower kill against that best; with precise timing on, hundredths and no full stop.
  assert.equal(Kills.fightDuration(player, 110), 'Fight duration: <col=ff0000>1:06</col>. Personal best: 1:00.');
  // To the nearest second: 176 ticks (105.6 s) is 1:46 (rsprox 1000480 t8419-8595), 186 is 1:52.
  assert.deepEqual([Common.formatTicks(176, false), Common.formatTicks(186, false), Common.formatTicks(176, true)], ['1:46', '1:52', '1:45.60']);
  const kill = { npc, xp: 1100 };
  Kills.slayerXp(kill);
  assert.equal(kill.xp, 1320);
});

test('its death: removed 10 ticks after the killing hit, the death task waiting out the enraged form\'s ticks', () => {
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  const npc = fakeHydra(0);
  npc.getCurrentDefinition = () => NpcDefinition.forId(npc.getId());
  const fight = new Fight(fakeLair(null), npc);
  fight.phase = 3;
  npc.setNpcTransformationId(Common.ids.npcs.enraged);
  tasks = [];
  Kills.beforeDeath({ npc, preventDeath: false });
  flush(); // the dead form now, whose own death ticks are 2
  const event = { npc, killer: null };
  Kills.hydraDeath(event);
  // The death task: 1 tick + the enraged form's 7; the remains make it 10 (rsprox 1000471 t10027-10037).
  assert.equal(1 + NpcDefinition.forId(Common.ids.npcs.enraged).getDeathTicks() + event.remains.ticks, 10);
  tasks = [];
});

test('its death: the enraged death sequence now, the dead form 3 ticks later', () => {
  const npc = fakeHydra(0);
  const fight = new Fight(fakeLair(null), npc);
  fight.phase = 3;
  npc.setNpcTransformationId(Common.ids.npcs.enraged);
  tasks = [];
  const event = { npc, preventDeath: false };
  Kills.beforeDeath(event);
  assert.equal(event.preventDeath, false);
  assert.equal(npc.anims.at(-1), Common.ids.seqs.deathStart);
  assert.equal(npc.getId(), Common.ids.npcs.enraged);
  flush();
  assert.equal(npc.getId(), Common.ids.npcs.dead);
  assert.equal(npc.anims.at(-1), Common.ids.seqs.death);
  fight.stop();
});

test('before it is enraged, no hit can take its last hitpoint', () => {
  const npc = fakeHydra(3);
  const fight = new Fight(fakeLair(null), npc);
  fight.shielded = false;
  const parts = [20, 15].map((damage) => ({ damage, getDamage() { return this.damage; }, setDamage(d) { this.damage = d; } }));
  const player = { isPlayer: () => true, getAsPlayer: () => player };
  onTaskAnswer = () => true;
  Lair.hydraHit({ npc, hit: { getAttacker: () => player, getHits: () => parts } });
  assert.equal(parts.reduce((sum, p) => sum + p.getDamage(), 0), 2, 'it keeps 1 hitpoint');
  fight.phase = 3;
  parts.forEach((p) => p.setDamage(20));
  Lair.hydraHit({ npc, hit: { getAttacker: () => player, getHits: () => parts } });
  assert.equal(parts.reduce((sum, p) => sum + p.getDamage(), 0), 40, 'enraged, it can die');
  fight.stop();
});


for (const lastStyle of ['magic', 'ranged']) {
  test(`enrage opens opposite the last ${lastStyle} attack, then alternates around its special`, () => {
    for (const priorBasics of [1, 2, 3]) {
      const npc = fakeHydra(275);
      const fight = new Fight(fakeLair(null), npc);
      fight.phase = 2;
      fight.style = lastStyle;
      fight.basics = priorBasics;
      assert.equal(fight.checkPhase(), true);
      flush();
      fight.tickCount = fight.transitionUntil;
      const kinds = [];
      for (let i = 0; i < 5; i++) {
        const kind = fight.nextAttack();
        kinds.push(kind);
        fight.counted(kind);
      }
      const opposite = lastStyle === 'magic' ? 'ranged' : 'magic';
      assert.deepEqual(kinds, [opposite, lastStyle, opposite, 'special', lastStyle]);
      fight.stop();
    }
  });
}

/** Real combat/health/death code, dispatching the plugin's registered hooks. */
function realFlameFight(t) {
  tasks = [];
  let beforeDeath;
  Kills.attach(new Proxy({ onNpcBeforeDeath: (handler) => { beforeDeath = handler; } }, {
    get: (target, key) => target[key] ?? (() => {}),
  }));
  t.mock.method(PluginManager, 'emitNpcBeforeDeath', (event) => {
    beforeDeath(event);
    return event.preventDeath === true;
  });
  t.mock.method(PluginManager, 'emitNpcHitModify', (npc, hit) => {
    Lair.hydraHit({ npc, hit });
    return hit;
  });
  const submitted = [];
  t.mock.method(core.TaskManager, 'submit', (task) => submitted.push(task));
  const player = new Player(null, loc(1363, 10265));
  player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
  player.setRegistered(true);
  player.setHitpoints(99);
  player.setNeedsPlacement(false);
  const npc = core.NPC.create(Common.ids.npcs.serpentine, loc(1364, 10265));
  npc.setRegistered(true);
  npc.setNeedsPlacement(false);
  const fight = new Fight(fakeLair(null), npc);
  fight.phase = 2;
  fight.shielded = false;
  npc.setNpcTransformationId(Common.ids.npcs.flame);
  npc.setHitpoints(280); // Valid third-phase HP, just above its 275 threshold.
  onTaskAnswer = () => true;
  const method = new (class extends core.CombatMethod {
    type() { return core.CombatType.RANGED; }
  })();
  const hit = (damage) => new core.PendingHit(player, npc, method, {
    delay: 0, damage, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
  });
  const queue = npc.getCombat().getHitQueue();
  t.after(() => {
    fight.stop();
    queue.clear();
    npc.setRegistered(false);
    player.setRegistered(false);
  });
  return { npc, fight, queue, submitted, hit };
}

test('same-tick real PendingHits keep one HP until enrage, then schedule normal death', (t) => {
  const { npc, fight, queue, submitted, hit } = realFlameFight(t);
  const hits = [hit(100), hit(100), hit(100)];
  for (const pending of hits) queue.addPendingHit(pending, 100);
  queue.process(100);
  assert.deepEqual(hits.map((pending) => pending.getTotalDamage()), [100, 100, 79]);
  assert.equal(npc.getHitpoints(), 1);
  assert.notEqual(npc.isDyingFunction(), true);
  assert.equal(npc.getId(), Common.ids.npcs.flame);
  assert.equal(submitted.filter((task) => task instanceof NPCDeathTask).length, 0);

  fight.tick([]);
  flush();
  fight.tickCount = fight.transitionUntil;
  assert.equal(fight.enraged, true);
  assert.equal(npc.getId(), Common.ids.npcs.enraged);
  queue.addPendingHit(hit(10), 101);
  queue.process(101);
  assert.equal(npc.getHitpoints(), 0);
  assert.equal(npc.isDyingFunction(), true);
  assert.equal(npc.getId(), Common.ids.npcs.enraged, 'its death sequence plays as the enraged form first');
  assert.equal(submitted.filter((task) => task instanceof NPCDeathTask).length, 1);
  flush();
  assert.equal(npc.getId(), Common.ids.npcs.dead);
});

test('direct pending damage cannot bypass the pre-enrage death guard', (t) => {
  const { npc, fight, queue, submitted } = realFlameFight(t);
  queue.addPendingDamage([new core.HitDamage(300, core.HitMask.RED), new core.HitDamage(300, core.HitMask.RED)]);
  queue.process(100);
  assert.equal(npc.getHitpoints(), 1);
  assert.equal(npc.getId(), Common.ids.npcs.flame);
  assert.notEqual(npc.isDyingFunction(), true);
  assert.equal(submitted.filter((task) => task instanceof NPCDeathTask).length, 0);
  fight.tick([]);
  assert.equal(fight.enraged, true, 'the rescued hitpoint still lets the final phase begin');
});

test('basic attacks: one flight a head from the facing head, 30 to 40 + 5 a tile from its south-west tile, the hit with it', (t) => {
  const Combat = require('../plugins/bosses/alchemicalhydra/Combat.AlchemicalHydra');
  const sent = [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () { sent.push(this); });
  const cases = [
    // phase, style, target x/y, heads, the first launch tile (rsprox)
    [0, 'magic', 1356, 10258, 2, [1366, 10265]],
    [0, 'ranged', 1366, 10280, 2, [1368, 10269]],
    [1, 'ranged', 1356, 10267, 1, [1365, 10269]],
    [1, 'magic', 1356, 10267, 2, [1365, 10266]],
    [2, 'magic', 1356, 10267, 1, [1365, 10266]],
    [3, 'ranged', 1366, 10256, 1, [1365, 10266]],
  ];
  for (const [phase, style, x, y, heads, first] of cases) {
    sent.length = 0;
    const npc = fakeHydra();
    npc.getAsNpc = () => npc;
    const player = fakePlayer(x, y);
    const fight = new Fight(fakeLair(player), npc);
    fight.phase = phase;
    fight.nextAttack = () => style;
    const method = new (Combat.combatClass())();
    method.start(npc, player);
    assert.equal(sent.length, heads, `phase ${phase} ${style}: heads`);
    assert.deepEqual([sent[0].start.getX(), sent[0].start.getY()], first, `phase ${phase} ${style}: launch tile`);
    const d = Math.max(Math.abs(x - 1364), Math.abs(y - 10265));
    for (const shot of sent) {
      assert.equal(shot.delay, 30);
      assert.equal(shot.speed, 40 + 5 * d);
    }
    if (heads > 1) assert.deepEqual([sent[0].startHeight, sent[1].startHeight], [30, 35]);
    assert.equal(method.delay, Math.floor((40 + 5 * d) / 30), 'rsprox: an 85-cycle flight hits 2 ticks on');
    assert.ok(player.sent.some((s) => s.sound === Common.data.sounds[style].id && s.delay === 40 + 5 * d));
    fight.stop();
  }
  assert.equal(Combat.hitDelay(45), 1);
  assert.equal(Combat.hitDelay(85), 2);
  assert.equal(Combat.hitDelay(90), 3);
});

test('basic attacks hit as many times as it has heads for the style, each up to the phase\'s max (#970)', (t) => {
  const Combat = require('../plugins/bosses/alchemicalhydra/Combat.AlchemicalHydra');
  t.mock.method(core.Projectile.prototype, 'sendProjectile', () => {});
  const player = new Player(null, loc(1360, 10265));
  player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
  player.setHitpoints(99);
  const npc = core.NPC.create(Common.ids.npcs.serpentine, loc(1364, 10265));
  const fight = new Fight(fakeLair(null), npc);
  npc.__hydraFight = fight;
  t.after(() => fight.stop());
  const cases = [
    { phase: 0, style: 'ranged', empowered: false, hits: 2, max: 17 },
    { phase: 0, style: 'magic', empowered: true, hits: 2, max: 26 },
    { phase: 1, style: 'ranged', empowered: false, hits: 1, max: 35 },
    { phase: 1, style: 'magic', empowered: false, hits: 2, max: 17 },
    { phase: 1, style: 'magic', empowered: true, hits: 2, max: 26 },
    { phase: 2, style: 'ranged', empowered: false, hits: 1, max: 35 },
    { phase: 2, style: 'magic', empowered: true, hits: 1, max: 52 },
    { phase: 3, style: 'ranged', empowered: false, hits: 1, max: 55 },
  ];
  for (const c of cases) {
    npc.setNpcTransformationId(Common.phaseForms()[c.phase]);
    fight.phase = c.phase;
    fight.empowered = c.empowered;
    let top = 0;
    for (let i = 0; i < 400; i++) {
      const method = new (Combat.combatClass())();
      method.style = c.style;
      method.delay = 2;
      const hits = method.hits(npc, player);
      assert.equal(hits.length, c.hits, `phase ${c.phase} ${c.style}: hits an attack`);
      for (const hit of hits) {
        assert.ok(hit.getTotalDamage() <= c.max, `phase ${c.phase} ${c.style}: ${hit.getTotalDamage()} > ${c.max}`);
        top = Math.max(top, hit.getTotalDamage());
      }
    }
    assert.ok(top > c.max * 0.8, `phase ${c.phase} ${c.style} reaches near ${c.max} (best ${top})`);
  }
});

test('the logout button is refused in the chamber; in combat the combat refusal shows instead (Wiki)', () => {
  Lair.attach(new Proxy({}, { get: () => () => {} }));
  const player = new Player(null, loc(1363, 10255));
  player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
  player.setRegistered(true);
  const lair = Lair.enterLair(player);
  try {
    assert.ok(lair.contains(player.getLocation()), 'the player is in the chamber');
    const inside = { player, allow: null };
    Lair.holdLogout(inside);
    assert.equal(inside.allow, false, 'no logout in the chamber');

    player.inLogoutCombat = () => true;
    const inCombat = { player, allow: null };
    Lair.holdLogout(inCombat);
    assert.equal(inCombat.allow, null, 'left to the 10-second combat refusal');
    delete player.inLogoutCombat;

    player.moveTo(Common.toLocation(Common.data.room.outside));
    const outside = { player, allow: null };
    Lair.holdLogout(outside);
    assert.equal(outside.allow, null, 'outside the chamber the button works');
  } finally {
    Lair.leaveLair(player);
    const queue = core.World.getAddNPCQueue();
    for (let index = queue.indexOf(lair.hydra); index !== -1; index = queue.indexOf(lair.hydra)) queue.splice(index, 1);
  }
  const after = { player, allow: null };
  Lair.holdLogout(after);
  assert.equal(after.allow, null, 'no chamber, no hold');
});
