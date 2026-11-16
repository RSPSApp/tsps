// From server/: node --test tests/cerberus-combat-achievements.test.cjs (after yarn build).
//
// Cerberus' Combat Achievement tasks (cache task structs 3193-3196): Arooo No More, Ghost Buster,
// Unrequired Antifire and Anti-Bite Mechanics, judged from her souls and lava (Fight.Cerberus.js),
// which hit as plain damage the fight log of Fights.CombatAchievements does not see.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Lair, Fight, rules;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/bosses/cerberus/Common.Cerberus');
  Lair = require('../plugins/bosses/cerberus/Lair.Cerberus');
  Fight = require('../plugins/bosses/cerberus/Fight.Cerberus');
  const prayers = { PROTECT_FROM_MELEE: 'melee', PROTECT_FROM_MISSILES: 'ranged', PROTECT_FROM_MAGIC: 'magic', isActivated: (player, prayer) => player.prayers.has(prayer) };
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: () => {} } },
    persistAttribute: () => {},
    getPrayerHandler: () => prayers,
    spawnNpc: (def) => fakeNpc(def.id, def.x, def.y),
    removeNpc: (npc) => { npc.removed = true; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  Lair.attach(api);
  const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  Data(new Proxy({ core }, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  const captured = {};
  require('../plugins/achievements/combatachievements/tasks/Cerberus.CombatAchievements')(
    { core }, { onKill: (name, tests) => { captured[name] = tests; } },
  );
  rules = captured.Cerberus;
  for (const name of Object.keys(rules)) assert.ok(Data.taskNamed(name), `the cache has a task called ${name}`);
});

function location(x, y, z = 0) {
  return new core.Location(x, y, z);
}

function fakeNpc(id, x, y, hitpoints = 600) {
  const npc = {
    hitpoints, removed: false,
    getId: () => id,
    getLocation: () => location(x, y),
    getSize: () => (id === 5862 ? 5 : 1),
    getHitpoints: () => npc.hitpoints,
    performAnimation: () => {},
    getMovementQueue: () => ({ setBlockMovement: () => {} }),
    setFlag: () => {},
  };
  return npc;
}

function fakePlayer(x, y) {
  const player = {
    damage: [], prayers: new Set(), hp: 99,
    getLocation: () => location(x, y),
    isRegistered: () => true,
    getHitpoints: () => player.hp,
    getPacketSender: () => ({ sendGraphic: () => {} }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits.map((h) => h.getDamage())) }) }),
    getSkillManager: () => ({ decreaseCurrentLevel: () => {} }),
    getAttribute: (key) => player[key],
    setAttribute: (key, value) => { player[key] = value; },
    getEquipment: () => ({ contains: () => false, getItems: () => [], get: () => ({ getId: () => -1 }) }),
  };
  return player;
}

function westArena(players) {
  const arena = Lair.arenas.find((entry) => entry.name === 'west');
  arena.area = { getPlayers: () => players };
  return arena;
}

/** What Fights.CombatAchievements hands a rule; `melee` is the melee damage she dealt this player. */
function fightOf(npc, player, melee = 0) {
  return { npc, player, damageTakenOfType: (type) => (type === 'MELEE' ? melee : 0) };
}

/** Runs the fight's souls until all three have attacked and gone. */
function runSouls(fight, player) {
  fight.summonSouls(player);
  for (let i = 0; i < 12; i++) { fight.tickCount += 1; fight.tickSouls(); }
}

test('a kill with no souls summoned, no lava and no melee damage finishes Arooo No More, Unrequired Antifire and Anti-Bite Mechanics', () => {
  const player = fakePlayer(1240, 1244);
  const npc = fakeNpc(5862, 1238, 1250);
  new Fight.Fight(westArena([player]), npc);
  const fight = fightOf(npc, player);
  assert.equal(rules['Arooo No More'](fight), true);
  assert.equal(rules['Unrequired Antifire'](fight), true);
  assert.equal(rules['Anti-Bite Mechanics'](fight), true);
  assert.equal(rules['Ghost Buster'](fight), false);
});

test('a soul summoned fails Arooo No More even if all three were prayed against', () => {
  const player = fakePlayer(1240, 1244);
  player.prayers = new Set(['melee', 'ranged', 'magic']);
  const npc = fakeNpc(5862, 1238, 1250, 300);
  const cerberus = new Fight.Fight(westArena([player]), npc);
  runSouls(cerberus, player);
  assert.deepEqual(player.damage, []);
  assert.equal(rules['Arooo No More'](fightOf(npc, player)), false);
});

test('Ghost Buster needs six soul attacks prayed against, each as it attacks', () => {
  const player = fakePlayer(1240, 1244);
  player.prayers = new Set(['melee', 'ranged', 'magic']);
  const npc = fakeNpc(5862, 1238, 1250, 300);
  const cerberus = new Fight.Fight(westArena([player]), npc);
  runSouls(cerberus, player);
  assert.equal(rules['Ghost Buster'](fightOf(npc, player)), false, 'three negated');
  // The second round: one unprotected soul leaves five negated.
  player.prayers = new Set();
  runSouls(cerberus, player);
  assert.equal(player.damage.length, 3);
  assert.equal(rules['Ghost Buster'](fightOf(npc, player)), false, 'still three');
  player.prayers = new Set(['melee', 'ranged', 'magic']);
  runSouls(cerberus, player);
  assert.equal(rules['Ghost Buster'](fightOf(npc, player)), true, 'six negated');
  // Another player's count is their own.
  assert.equal(rules['Ghost Buster'](fightOf(npc, fakePlayer(1241, 1244))), false);
});

test('a lava pool hit fails Unrequired Antifire for the player it hit only', () => {
  const on = fakePlayer(1240, 1244);
  const off = fakePlayer(1250, 1230);
  const npc = fakeNpc(5862, 1238, 1250, 150);
  const cerberus = new Fight.Fight(westArena([on, off]), npc);
  cerberus.spewLava(on);
  for (let t = 0; t < 14; t++) { cerberus.tickCount += 1; cerberus.tickPools([on, off]); }
  assert.ok(on.damage.length > 0);
  assert.equal(rules['Unrequired Antifire'](fightOf(npc, on)), false);
  assert.equal(rules['Unrequired Antifire'](fightOf(npc, off)), true);
});

test("Anti-Bite Mechanics: her bite or the melee soul's unprotected hit fails it, a ranged or magic soul's hit does not", () => {
  const npc = fakeNpc(5862, 1238, 1250, 300);
  const bitten = fakePlayer(1240, 1244);
  new Fight.Fight(westArena([bitten]), npc);
  assert.equal(rules['Anti-Bite Mechanics'](fightOf(npc, bitten, 12)), false, 'her bite');

  const player = fakePlayer(1240, 1244);
  player.prayers = new Set(['melee']);
  const cerberus = new Fight.Fight(westArena([player]), npc);
  runSouls(cerberus, player);
  assert.equal(player.damage.length, 2, 'the ranged and magic souls hit');
  assert.equal(rules['Anti-Bite Mechanics'](fightOf(npc, player)), true);
  player.prayers = new Set(['ranged', 'magic']);
  runSouls(cerberus, player);
  assert.equal(rules['Anti-Bite Mechanics'](fightOf(npc, player)), false, 'the melee soul hit');
});

test('a new fight starts her record over, and the record outlives stop() for her death', () => {
  const player = fakePlayer(1240, 1244);
  const npc = fakeNpc(5862, 1238, 1250, 300);
  const first = new Fight.Fight(westArena([player]), npc);
  runSouls(first, player);
  first.stop();
  assert.equal(rules['Arooo No More'](fightOf(npc, player)), false, 'read after stop()');
  new Fight.Fight(westArena([player]), npc);
  assert.equal(rules['Arooo No More'](fightOf(npc, player)), true, 'a fresh fight');
});
