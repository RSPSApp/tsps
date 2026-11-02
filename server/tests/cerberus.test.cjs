// From server/: node --test tests/cerberus.test.cjs (after yarn build).
//
// Cerberus against the OSRS Wiki (Cerberus, Cerberus/Strategies, Cerberus' Lair): the attack
// table (triple attack, souls below 400, lava below 200, their priority and skip chance), the
// souls' damage and prayer drain, the lava pools, the task-gated winch and the kill.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Lair, Fight, Combat, Kills;
let events, onTaskAnswer, messagesSent;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/bosses/cerberus/Common.Cerberus');
  Lair = require('../plugins/bosses/cerberus/Lair.Cerberus');
  Fight = require('../plugins/bosses/cerberus/Fight.Cerberus');
  Combat = require('../plugins/bosses/cerberus/Combat.Cerberus');
  Kills = require('../plugins/bosses/cerberus/Kills.Cerberus');
  events = {};
  const prayers = { active: new Set(), PROTECT_FROM_MELEE: 'melee', PROTECT_FROM_MISSILES: 'ranged', PROTECT_FROM_MAGIC: 'magic', isActivated: (player, prayer) => player.prayers.has(prayer) };
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: () => {} }, applyPrayerDrainModifiers: (player, amount) => (player.spectral ? Math.floor(amount / 2) : amount) },
    persistAttribute: () => {},
    getPrayerHandler: () => prayers,
    spawnNpc: (def) => fakeNpc(def.id, def.x, def.y),
    removeNpc: (npc) => { npc.removed = true; },
    onCustomEvent: (name, fn) => (events[name] ??= []).push(fn),
    emitCustomEvent(name, event) {
      if (name === 'slayer:on-task') { event.onTask = onTaskAnswer(event); return; }
      for (const fn of events[name] ?? []) fn(event);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  Lair.attach(api);
  Kills.attach(api);
});

function location(x, y, z = 0) {
  return new core.Location(x, y, z);
}

function fakeNpc(id, x, y, hitpoints = 600) {
  let tile = location(x, y);
  let transform = -1;
  const npc = {
    hitpoints, removed: false, chat: [], anims: [],
    getId: () => (transform !== -1 ? transform : id),
    setNpcTransformationId: (value) => { transform = value; },
    getLocation: () => tile,
    getSize: () => (id === 5863 || id === 5862 ? 5 : 1),
    getHitpoints: () => npc.hitpoints,
    setHitpoints: (value) => { npc.hitpoints = value; },
    getMaxHitpoints: () => 600,
    isDying: () => false,
    performAnimation: (anim) => npc.anims.push(anim.getId?.() ?? anim.id ?? anim),
    forceChat: (text) => npc.chat.push(text),
    getMovementQueue: () => ({ setBlockMovement: () => {} }),
    setFlag: () => {},
    getCombat: () => ({ reset: () => {}, attack: () => {}, getTarget: () => null }),
    isNpc: () => true,
    isPlayer: () => false,
  };
  return npc;
}

function fakePlayer(x, y) {
  let tile = location(x, y);
  const player = {
    messages: [], damage: [], prayers: new Set(), prayerDrained: 0, spectral: false, hp: 99, worn: [],
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    sendMessage: (text) => { player.messages.push(text); messagesSent?.push(text); },
    isRegistered: () => true,
    isPlayer: () => true,
    isNpc: () => false,
    getHitpoints: () => player.hp,
    getAttribute: (key) => player[key],
    setAttribute: (key, value) => { player[key] = value; },
    getPacketSender: () => ({ sendGraphic: () => {}, sendConfig: () => {} }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits.map((h) => h.getDamage())) }) }),
    getSkillManager: () => ({ decreaseCurrentLevel: (skill, amount) => { player.prayerDrained += amount; } }),
    getEquipment: () => ({ contains: (id) => player.worn.includes(id), getItems: () => [], get: () => ({ getId: () => -1 }) }),
    performGraphic: () => {},
  };
  return player;
}

function westArena() {
  const arena = Lair.arenas.find((entry) => entry.name === 'west');
  arena.cerberus = fakeNpc(Common.ids.npcs.sitting, 1238, 1250);
  arena.fight = null;
  arena.area = { getPlayers: () => arena.testPlayers ?? [] };
  return arena;
}

test('every id resolves from the cache', () => {
  const { npcs, locs, spotanims } = Common.ids;
  assert.deepEqual([npcs.attacking, npcs.sitting, npcs.soulRanged, npcs.soulMagic, npcs.soulMelee], [5862, 5863, 5867, 5868, 5869]);
  assert.equal(locs.winch, 23104);
  assert.equal(spotanims.lavaPool, 1246);
});

test('full health: the triple attack is the first and every 10th, nothing else', () => {
  const fight = new Fight.Fight(westArena(), fakeNpc(5862, 1238, 1250, 600));
  const specials = [];
  for (let n = 1; n <= 30; n++) {
    specials.push(fight.nextSpecial(() => 0.5));
    fight.counted();
  }
  const at = (kind) => specials.flatMap((special, i) => (special === kind ? [i + 1] : []));
  assert.deepEqual(at('triple'), [1, 11, 21]);
  assert.deepEqual(at('souls'), []);
  assert.deepEqual(at('lava'), []);
});

test('below 200: souls every 7th and lava every 5th, with the triple attack first', () => {
  const fight = new Fight.Fight(westArena(), fakeNpc(5862, 1238, 1250, 150));
  const specials = [];
  for (let n = 1; n <= 35; n++) {
    specials.push(fight.nextSpecial(() => 0.5));
    fight.counted();
  }
  const at = (kind) => specials.flatMap((special, i) => (special === kind ? [i + 1] : []));
  // Wiki table: 1 COMBO, 5 LAVA, 7 GHOSTS, 10 LAVA, 11 COMBO, 14 GHOSTS, 15 LAVA, 20 LAVA, 21 COMBO...
  assert.deepEqual(at('triple'), [1, 11, 21, 31]);
  assert.deepEqual(at('souls'), [7, 14, 28, 35]);
  assert.deepEqual(at('lava'), [5, 10, 15, 20, 25, 30]);
});

test('between 200 and 400 only the souls come, and a due special can be skipped', () => {
  const fight = new Fight.Fight(westArena(), fakeNpc(5862, 1238, 1250, 300));
  fight.attacks = 4;
  assert.equal(fight.nextSpecial(() => 0.5), null);
  fight.attacks = 6;
  assert.equal(fight.nextSpecial(() => 0.5), 'souls');
  assert.equal(fight.nextSpecial(() => 0.05), null);
});

test('hit delays follow the OSRS projectile formulas and the bite needs a neighbour', () => {
  assert.equal(Combat.hitDelay('magic', 1), 1);
  assert.equal(Combat.hitDelay('magic', 5), 3);
  assert.equal(Combat.hitDelay('ranged', 3), 2);
  assert.equal(Combat.hitDelay('melee', 0), 0);
  for (let i = 0; i < 20; i++) assert.notEqual(Combat.ordinaryStyle(false, () => i / 20), 'melee');
  assert.equal(Combat.ordinaryStyle(true, () => 0.99), 'melee');
});

test('a soul hits for 30 unprotected, and drains 30 prayer (15 with a spectral) when prayed against as it attacks', () => {
  const player = fakePlayer(1240, 1244);
  Fight.soulHit({ kind: 'magic', target: player, npc: fakeNpc(5868, 1240, 1256), prayed: false });
  assert.deepEqual(player.damage, [30]);
  // Praying when it lands, too late, does not help.
  player.prayers.add('magic');
  Fight.soulHit({ kind: 'magic', target: player, npc: fakeNpc(5868, 1240, 1256), prayed: false });
  assert.deepEqual(player.damage, [30, 30]);
  Fight.soulHit({ kind: 'magic', target: player, npc: fakeNpc(5868, 1240, 1256), prayed: true });
  assert.equal(player.prayerDrained, 30);
  player.spectral = true;
  Fight.soulHit({ kind: 'magic', target: player, npc: fakeNpc(5868, 1240, 1256), prayed: true });
  assert.equal(player.prayerDrained, 45);
  assert.deepEqual(player.damage, [30, 30]);
});

test('the bite is only from beside her, never diagonally or from under her', () => {
  const npc = fakeNpc(5862, 1238, 1250);
  assert.equal(Combat.besideHer(location(1240, 1249), npc), true);
  assert.equal(Combat.besideHer(location(1243, 1252), npc), true);
  assert.equal(Combat.besideHer(location(1237, 1249), npc), false);
  assert.equal(Combat.besideHer(location(1240, 1252), npc), false);
  assert.equal(Combat.besideHer(location(1240, 1247), npc), false);
});

test('as she dies her pools go out and souls yet to attack vanish', () => {
  const arena = westArena();
  const npc = fakeNpc(5862, 1238, 1250, 150);
  const fight = new Fight.Fight(arena, npc);
  const player = fakePlayer(1240, 1244);
  arena.testPlayers = [player];
  fight.spewLava(player);
  fight.summonSouls(player);
  const souls = fight.souls.map((soul) => soul.npc);
  npc.hitpoints = 0;
  fight.tick([player]);
  assert.equal(fight.pools.length, 0);
  assert.ok(souls.every((soul) => soul.removed));
  assert.deepEqual(player.damage, []);
});

test('three souls attack west to east, two ticks apart, and a stop removes them', () => {
  const arena = westArena();
  const npc = fakeNpc(5862, 1238, 1250, 300);
  const fight = new Fight.Fight(arena, npc);
  const player = fakePlayer(1240, 1244);
  fight.summonSouls(player);
  assert.equal(fight.souls.length, 3);
  assert.deepEqual(fight.souls.map((soul) => soul.npc.getLocation().getX()), [1239, 1240, 1241]);
  assert.deepEqual(new Set(fight.souls.map((soul) => soul.kind)), new Set(['ranged', 'magic', 'melee']));
  assert.deepEqual(fight.souls.map((soul) => soul.attackAt - fight.tickCount), [4, 6, 8]);
  const spawned = fight.souls.map((soul) => soul.npc);
  fight.stop();
  assert.ok(spawned.every((soul) => soul.removed));
  assert.equal(fight.souls.length, 0);
});

test('departing targets lose their summoned souls while another player remains', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const arena = westArena(), target = new Player(null), remaining = fakePlayer(1240, 1244);
  target.setRegistered(true);
  target.setLocation(location(1240, 1244));
  target.prayers = new Set();
  const hits = [];
  t.mock.method(target.getCombat().getHitQueue(), 'addPendingDamage', parts => hits.push(...parts));
  const fight = new Fight.Fight(arena, fakeNpc(5862, 1238, 1250, 300));
  arena.fight = fight;
  arena.testPlayers = [target, remaining];
  fight.summonSouls(target);
  const summoned = fight.souls.map(soul => soul.npc);
  // One soul has launched; departure cancels its impact as well as future launches.
  fight.tickCount = fight.souls[0].attackAt;
  fight.tickSouls();
  target.setLocation(location(3222, 3218));
  fight.forget(target);
  arena.testPlayers = [remaining];
  for (let i = 0; i < 15; i++) fight.tick([remaining]);
  assert.deepEqual(hits, []);
  assert.ok(summoned.every(npc => npc.removed));
  assert.equal(fight.souls.length, 0);
  assert.equal(fight.target, remaining);
  fight.stop();
});

test('souls also reject an out-of-arena target before the leave hook runs', () => {
  const arena = westArena(), target = fakePlayer(1240, 1244);
  const fight = new Fight.Fight(arena, fakeNpc(5862, 1238, 1250, 300));
  fight.summonSouls(target);
  const summoned = fight.souls.map(soul => soul.npc);
  target.moveTo(location(3222, 3218));
  for (let i = 0; i < 15; i++) { fight.tickCount++; fight.tickSouls(); }
  assert.deepEqual(target.damage, []);
  assert.equal(fight.souls.length, 0);
  assert.ok(summoned.every(npc => npc.removed));
});

test('lava: 10 as a pool lands under the player, then 15 every 2 ticks on it, nothing off it', () => {
  const arena = westArena();
  const fight = new Fight.Fight(arena, fakeNpc(5862, 1238, 1250, 150));
  const on = fakePlayer(1240, 1244);
  const off = fakePlayer(1250, 1230);
  arena.testPlayers = [on, off];
  fight.spewLava(on);
  assert.equal(fight.pools.length, 3);
  for (let t = 0; t < 14; t++) {
    fight.tickCount += 1;
    fight.tickPools([on, off]);
  }
  assert.deepEqual(on.damage, [10, 15, 15, 15, 15, 15]);
  assert.deepEqual(off.damage, []);
  assert.equal(fight.pools.length, 0);
});

test('the winch lets in only a player on task, and Peek counts who is inside', () => {
  const arena = westArena();
  const player = fakePlayer(1292, 1254);
  onTaskAnswer = () => false;
  assert.equal(Lair.turnWinch({ player, location: { x: 1291, y: 1254, z: 0 } }), true);
  assert.equal(player.messages.at(-1), 'You need a hellhound or Cerberus Slayer task to fight Cerberus.');
  assert.equal(player.getLocation().getY(), 1254);
  onTaskAnswer = (request) => request.npcId === Common.ids.npcs.attacking;
  Lair.turnWinch({ player, location: { x: 1291, y: 1254, z: 0 } });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1240, 1226]);
  arena.testPlayers = [player];
  Lair.peekWinch({ player, location: { x: 1291, y: 1254, z: 0 } });
  assert.equal(player.messages.at(-1), '1 adventurer is inside the cave.');
  assert.equal(Lair.turnWinch({ player, location: { x: 1000, y: 1000, z: 0 } }), false);
});

test('the task is asked about as her attacking form, which carries the hellhound task', () => {
  const asked = [];
  onTaskAnswer = (request) => { asked.push(request.npcId); return true; };
  assert.equal(Common.onTask(fakePlayer(0, 0), fakeNpc(Common.ids.npcs.sitting, 1238, 1250)), true);
  assert.deepEqual(asked, [Common.ids.npcs.attacking]);
});

test("the Key Master's task conditions follow the player's task", () => {
  westArena();
  onTaskAnswer = () => true;
  assert.equal(Lair.keyMasterCondition({ player: fakePlayer(0, 0), stepId: '2429x7' }), true);
  assert.equal(Lair.keyMasterCondition({ player: fakePlayer(0, 0), stepId: 'eLHU2R' }), false);
  onTaskAnswer = () => false;
  assert.equal(Lair.keyMasterCondition({ player: fakePlayer(0, 0), stepId: 'eLHU2R' }), true);
  assert.equal(Lair.keyMasterCondition({ player: fakePlayer(0, 0), stepId: 'other' }), null);
});

test('the portcullis leads out beside the winch, the cave back to Taverley Dungeon', () => {
  westArena();
  const player = fakePlayer(1240, 1226);
  assert.equal(Lair.leaveArena({ player, objectId: Common.ids.locs.portcullis, location: { x: 1239, y: 1225, z: 0 } }), true);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1292, 1253], "the hall side of the winch");
  assert.equal(Lair.leaveArena({ player, objectId: 1, location: { x: 1239, y: 1225, z: 0 } }), false);
  assert.equal(Lair.leaveLair({ player, objectId: Common.ids.locs.caves[1] }), true);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2873, 9847]);
});

test('her death clears the fight and counts the kill; a task kill is worth 690 Slayer xp', () => {
  const arena = westArena();
  const npc = arena.cerberus;
  npc.setNpcTransformationId(Common.ids.npcs.attacking);
  const fight = Fight.begin(arena, npc);
  arena.fight = fight;
  const player = fakePlayer(1240, 1244);
  fight.summonSouls(player);
  Kills.cerberusDeath({ npc, killer: player });
  assert.equal(fight.stopped, true);
  assert.equal(arena.fight, null);
  assert.equal(player.messages.at(-1), 'Your Cerberus kill count is: <col=ff0000>1</col>.');
  assert.equal(player[Common.KILLS_ATTRIBUTE], 1);
  const kill = { npc, xp: 600 };
  Kills.slayerXp(kill);
  assert.equal(kill.xp, 690);
});

test('Ward of Arceuus cuts a prayed soul to 20 drain, 10 with a spectral; an Elysian hit is 22', () => {
  const { ArceuusSpells, ItemIdentifiers } = Common.core;
  const hasWard = ArceuusSpells.hasWard;
  const random = Math.random;
  try {
    ArceuusSpells.hasWard = () => true;
    const warded = fakePlayer(1240, 1244);
    Fight.soulHit({ kind: 'magic', target: warded, npc: fakeNpc(5868, 1240, 1256), prayed: true });
    assert.equal(warded.prayerDrained, 20);
    warded.spectral = true;
    Fight.soulHit({ kind: 'magic', target: warded, npc: fakeNpc(5868, 1240, 1256), prayed: true });
    assert.equal(warded.prayerDrained, 30);
    ArceuusSpells.hasWard = () => false;
    const elysian = fakePlayer(1240, 1244);
    elysian.worn.push(ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD);
    Math.random = () => 0;
    Fight.soulHit({ kind: 'melee', target: elysian, npc: fakeNpc(5869, 1240, 1256), prayed: false });
    Math.random = () => 0.99;
    Fight.soulHit({ kind: 'melee', target: elysian, npc: fakeNpc(5869, 1240, 1256), prayed: false });
    assert.deepEqual(elysian.damage, [22, 30], 'the 25% cut fires 70% of the time');
  } finally {
    ArceuusSpells.hasWard = hasWard;
    Math.random = random;
  }
});

test('standing in lava: 15 a tick, 12 with an anti-dragon shield', () => {
  const { CombatEquipment } = Common.core;
  const shield = CombatEquipment.hasDragonProtectionGear;
  try {
    const player = fakePlayer(1240, 1244);
    CombatEquipment.hasDragonProtectionGear = () => false;
    assert.equal(Fight.lavaTickDamage(player), 15);
    CombatEquipment.hasDragonProtectionGear = () => true;
    assert.equal(Fight.lavaTickDamage(player), 12);
  } finally {
    CombatEquipment.hasDragonProtectionGear = shield;
  }
});
