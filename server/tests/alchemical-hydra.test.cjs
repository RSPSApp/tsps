// From server/: node --test tests/alchemical-hydra.test.cjs (after yarn build).
//
// The Alchemical Hydra against the OSRS Wiki (Alchemical_Hydra, /Strategies): the attack count
// (three autos, then the special, then every nine), the style switches, the 75% shield and its
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

function fakeHydra(hp = 1100) {
  let transform = -1;
  const npc = {
    hitpoints: hp, anims: [],
    getId: () => (transform !== -1 ? transform : Common.ids.npcs.serpentine),
    setNpcTransformationId: (id) => { transform = id; },
    getLocation: () => loc(1364, 10265),
    getSize: () => 6,
    getHitpoints: () => npc.hitpoints,
    isDyingFunction: () => false,
    performAnimation: (anim) => npc.anims.push(anim),
    getCombat: () => ({ setAttackDelay: () => {}, getHitQueue: () => ({ getQueuedDamage: () => 0 }) }),
  };
  return npc;
}

function fakePlayer(x = 1363, y = 10260) {
  let tile = loc(x, y);
  const player = {
    damage: [], poison: [], messages: [], blocked: false,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    sendMessage: (m) => player.messages.push(m),
    getPacketSender: () => ({ sendGraphic: () => {} }),
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
});

test('three autos, the special on the fourth, then every ninth; styles switch every three', () => {
  const fight = new Fight(fakeLair(null), fakeHydra());
  const kinds = [];
  for (let i = 0; i < 22; i++) {
    const kind = fight.nextAttack();
    kinds.push(kind);
    fight.counted(kind);
  }
  assert.deepEqual(kinds.flatMap((k, i) => (k === 'special' ? [i + 1] : [])), [4, 13, 22]);
  assert.deepEqual(kinds.slice(0, 8), ['ranged', 'ranged', 'ranged', 'special', 'magic', 'magic', 'magic', 'ranged']);
});

test('enraged, the style switches every attack', () => {
  const fight = new Fight(fakeLair(null), fakeHydra());
  fight.phase = 3;
  const kinds = [];
  for (let i = 0; i < 3; i++) { const k = fight.nextAttack(); kinds.push(k); fight.counted(k); }
  assert.deepEqual(kinds, ['ranged', 'magic', 'ranged']);
});

test('shielded it takes a quarter; its own vent takes the shield, the wrong one empowers it', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const fight = new Fight(fakeLair(player), npc);
  assert.equal(fight.reduce(40), 10);
  // Its 6x6 footprint from (1366, 10258) reaches (1371, 10263): on the red vent.
  npc.getLocation = () => loc(1366, 10258);
  fight.eruptVents([player]);
  assert.equal(fight.shielded, false);
  assert.equal(player.messages.at(-1), Common.message('weakened'));
  assert.equal(fight.reduce(40), 40);
  fight.phase = 1;
  fight.shielded = true;
  fight.eruptVents([player]);
  assert.equal(fight.shielded, true, 'the red vent does nothing for the electric phase');
  assert.equal(player.messages.at(-1), Common.message('empowered'));
});

test('a head falls at 825, 550 and 275: each form in turn, shielded again until the enraged one', () => {
  const npc = fakeHydra(824);
  const fight = new Fight(fakeLair(null), npc);
  const { ids } = Common;
  assert.equal(fight.checkPhase(), true);
  assert.equal(npc.getId(), ids.npcs.toElectric);
  assert.equal(fight.transitioning(), true);
  flush(1);
  assert.equal(npc.getId(), ids.npcs.electric);
  assert.equal(fight.shielded, true);
  assert.equal(fight.checkPhase(), false, 'not below 550 yet');
  fight.tickCount = fight.transitionUntil;
  npc.hitpoints = 549;
  fight.checkPhase();
  flush(1);
  assert.equal(npc.getId(), ids.npcs.flame);
  fight.tickCount = fight.transitionUntil;
  npc.hitpoints = 274;
  fight.checkPhase();
  flush(1);
  assert.equal(npc.getId(), ids.npcs.enraged);
  assert.equal(fight.enraged, true);
  assert.equal(fight.reduce(40), 40, 'no shield once enraged');
  npc.hitpoints = 1;
  assert.equal(fight.checkPhase(), false);
});

test('poison: a 3x3 splash (up to 7, poison 6 on the target) leaves pools hitting up to 12 a tick', () => {
  const player = fakePlayer();
  const fight = new Fight(fakeLair(player), fakeHydra());
  fight.landPoison(player.getLocation(), player);
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] <= Common.data.poison.splashMax);
  assert.deepEqual(player.poison, [Common.data.poison.poisonTargeted]);
  assert.equal(fight.pools.length, 9);
  fight.tickCount += 1;
  fight.tickPools([player]);
  assert.equal(player.damage.length, 2);
  assert.ok(player.damage[1] >= 1 && player.damage[1] <= Common.data.poison.poolMax);
  fight.tickCount += Common.data.poison.poolTicks;
  fight.tickPools([player]);
  assert.equal(fight.pools.length, 0);
});

test('lightning: four currents from the corners close in; reaching the player hits and binds', () => {
  const player = fakePlayer(1360, 10256);
  const fight = new Fight(fakeLair(player), fakeHydra());
  fight.castLightning();
  assert.equal(fight.currents.length, 4);
  for (let i = 0; i < 30 && fight.currents.length; i++) {
    fight.tickCount += 1;
    fight.tickCurrents([player]);
  }
  assert.ok(player.damage.length >= 1, 'a current reached the player');
  assert.ok(player.damage.every((d) => d <= Common.data.lightning.max));
  assert.equal(player.blocked, true);
});

test('fire: walls to the player\'s sides, then a tracking fire and its five burns', () => {
  const player = fakePlayer(1366, 10262);
  const fight = new Fight(fakeLair(player), fakeHydra());
  fight.breatheFire(player);
  assert.equal(fight.walls.length, 10);
  assert.ok(fight.walls.every((w) => w.tile.getX() !== player.getLocation().getX() || w.tile.getY() !== player.getLocation().getY()), 'the walls flank, not cover, the player');
  for (let i = 0; i < 30; i++) {
    fight.tickCount += 1;
    fight.tickFire([player]);
  }
  const burns = player.damage.filter((d) => d === Common.data.fire.burnDamage).length;
  assert.ok(player.damage.length >= 1 + Common.data.fire.burnHits - 1);
  assert.ok(burns >= Common.data.fire.burnHits - 1);
});

test('a phase change dissipates the lightning, and stopping clears everything', () => {
  const player = fakePlayer();
  const npc = fakeHydra(549);
  const fight = new Fight(fakeLair(player), npc);
  fight.phase = 1;
  fight.castLightning();
  fight.checkPhase();
  assert.equal(fight.currents.length, 0);
  fight.landPoison(player.getLocation(), player);
  fight.stop();
  assert.equal(fight.pools.length, 0);
  assert.equal(npc.__hydraFight, null);
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

test('the kill: its fight stops, the count goes up, a task kill is worth 1,320 Slayer xp', () => {
  const npc = fakeHydra(0);
  const fight = new Fight(fakeLair(null), npc);
  const attrs = new Map();
  const player = { isPlayer: () => true, isRegistered: () => true, messages: [], sendMessage(m) { this.messages.push(m); }, getAttribute: (k) => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v) };
  Kills.hydraDeath({ npc, killer: player });
  assert.equal(fight.stopped, true);
  flush();
  assert.equal(player.messages.at(-1), 'Your Alchemical Hydra kill count is: <col=ff0000>1</col>.');
  const kill = { npc, xp: 1100 };
  Kills.slayerXp(kill);
  assert.equal(kill.xp, 1320);
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
  assert.equal(npc.getId(), Common.ids.npcs.dead);
  assert.equal(submitted.filter((task) => task instanceof NPCDeathTask).length, 1);
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

test('basic attacks are well-formed flights whose hits land with them (#1862)', (t) => {
  const Combat = require('../plugins/bosses/alchemicalhydra/Combat.AlchemicalHydra');
  const sent = [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () { sent.push(this); });
  for (const style of ['magic', 'ranged']) {
    for (const x of [1363, 1361, 1356]) {
      const npc = fakeHydra();
      npc.getAsNpc = () => npc;
      npc.getPrivateArea = () => null;
      npc.__hydraFight = { stopped: false, phase: 0, transitioning: () => false, nextAttack: () => style, counted: () => {} };
      const player = { getLocation: () => loc(x, 10265), getSize: () => 1, isPlayer: () => true, getIndex: () => 1 };
      const method = new (Combat.combatClass())();
      method.start(npc, player);
      const shot = sent.at(-1);
      assert.ok(shot.speed > shot.delay + 1, `${style} from ${x} is drawn as a flight`);
      assert.equal(method.delay, Math.ceil(shot.speed / 30), `${style} from ${x}`);
    }
  }
  // Within a tile the 1-tick hit's 30-cycle end is replaced by 35 + 10 (magic) / 5 (ranged) a tile.
  assert.equal(Combat.flightEnd('magic', 1), 45);
  assert.equal(Combat.flightEnd('ranged', 2), 45);
  assert.equal(Combat.flightEnd('magic', 4), 60);
});
