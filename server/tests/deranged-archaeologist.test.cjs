// Run after `yarn build`: node --test tests/deranged-archaeologist.test.cjs
//
// The Deranged archaeologist's fight, driven against fakes: attack selection, the
// "Learn to Read!" tile picking and damage falloff, the death line, and the plugin
// wiring. The live fight itself is verified in-game (see the PR); the tasked
// projectiles/graphics there need the running engine.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');
const { Misc } = require('../dist/util/Misc');
const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
const Core = {
  Animation: require('../dist/game/model/Animation').Animation,
  CombatMethod: require('../dist/game/content/combat/method/CombatMethod').CombatMethod,
  CombatType: require('../dist/game/content/combat/CombatType').CombatType,
  Graphic: require('../dist/game/model/Graphic').Graphic,
  GraphicHeight: require('../dist/game/model/GraphicHeight').GraphicHeight,
  HitDamage: require('../dist/game/content/combat/hit/HitDamage').HitDamage,
  HitMask: require('../dist/game/content/combat/hit/HitMask').HitMask,
  Location,
  Misc,
  NpcIdentifiers,
  PendingHit: require('../dist/game/content/combat/hit/PendingHit').PendingHit,
  Projectile: require('../dist/game/model/Projectile').Projectile,
  Task: require('../dist/game/task/Task').Task,
  TaskManager: require('../dist/game/task/TaskManager').TaskManager,
  World,
};

const Plugin = require('../plugins/bosses/DerangedArchaeologist.plugin.js');
const { Attack, chooseAttack, scatterTiles, initialSpecialTiles, burstSpecialTiles, explosionDamage } = Plugin._test;

const key = (tile) => `${tile.x},${tile.y}`;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

test('ids and content match the Wiki and the cache observations', () => {
  assert.equal(NpcIdentifiers.DERANGED_ARCHAEOLOGIST, 7806);
  assert.equal(Plugin.name, 'DerangedArchaeologist');
  assert.equal(Plugin.members, true);
});

test('attack choice: adjacent always melees, otherwise special or ranged', () => {
  assert.equal(chooseAttack({ adjacent: true, specialReady: true, specialRoll: 0 }), Attack.MELEE);
  assert.equal(chooseAttack({ adjacent: true, specialReady: false, specialRoll: 1 }), Attack.MELEE);
  assert.equal(chooseAttack({ adjacent: false, specialReady: true, specialRoll: 0 }), Attack.SPECIAL);
  assert.equal(chooseAttack({ adjacent: false, specialReady: true, specialRoll: 1 }), Attack.RANGED);
  assert.equal(chooseAttack({ adjacent: false, specialReady: true, specialRoll: 2 }), Attack.RANGED);
  assert.equal(chooseAttack({ adjacent: false, specialReady: false, specialRoll: 0 }), Attack.RANGED);
});

test('opening volley always centres on the player with two distinct scattered books', () => {
  const centre = { x: 3683, y: 3706 };
  for (let seed = 0; seed < 50; seed++) {
    let state = seed;
    const random = (n) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % (n + 1);
    const tiles = initialSpecialTiles(centre, random);
    assert.equal(tiles.length, 3);
    assert.deepEqual(tiles[0], centre);
    assert.equal(new Set(tiles.map(key)).size, 3);
    for (const tile of tiles) assert.ok(chebyshev(tile, centre) <= 2);
  }
});

test('burst books avoid every opening tile', () => {
  const centre = { x: 3683, y: 3706 };
  let state = 7;
  const random = (n) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % (n + 1);
  const opened = initialSpecialTiles(centre, random);
  const burst = burstSpecialTiles(centre, opened, random);
  assert.equal(burst.length, 2);
  const taken = new Set(opened.map(key));
  for (const tile of burst) {
    assert.ok(!taken.has(key(tile)));
    assert.ok(chebyshev(tile, centre) <= 2);
  }
});

test('explosions hit full on the tile, reduced adjacent, nothing further out', () => {
  const at = { x: 10, y: 10 };
  assert.equal(explosionDamage(at, { x: 10, y: 10 }, (max) => max), 56);
  assert.equal(explosionDamage(at, { x: 11, y: 10 }, (max) => max), 18);
  assert.equal(explosionDamage(at, { x: 9, y: 11 }, (max) => max), 18);
  assert.equal(explosionDamage(at, { x: 12, y: 10 }, (max) => max), 0);
  assert.equal(explosionDamage(at, { x: 10, y: 12 }, (max) => max), 0);
});

test('scatter helpers stay inside the 5x5', () => {
  const centre = { x: 0, y: 0 };
  const tiles = scatterTiles(centre, 4, [], (n) => Misc.getRandom(n));
  assert.equal(tiles.length, 4);
  for (const tile of tiles) assert.ok(chebyshev(tile, centre) <= 2);
});

function fakeSides(x, y) {
  const anims = [];
  const chats = [];
  const attributes = new Map();
  const character = {
    getLocation: () => new Location(x, y, 0),
    performAnimation: (animation) => anims.push(animation.getId()),
    forceChat: (message) => chats.push(message),
    getAsNpc: () => character,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
  const target = { getLocation: () => new Location(x + 1, y, 0) };
  return { character, target, anims, chats, attributes };
}

test('an adjacent target is always meleed with the observed anim and a transcript line', () => {
  const Method = Plugin._test.combatClass(Core);
  const method = new Method();
  const { character, target, anims, chats } = fakeSides(3683, 3706);
  method.start(character, target);
  assert.equal(method.attack, Attack.MELEE);
  assert.deepEqual(anims, [425]);
  assert.equal(chats.length, 1);
  assert.equal(method.type(), Core.CombatType.MELEE);
  assert.equal(method.attackDistance(), 1);
});

test('register wires the provider for 7806 as a per-npc instance plus the death line', () => {
  const calls = [];
  let deathHandler;
  Plugin.register({
    core: Core,
    registerNpcCombatMethodProvider: (ids, ctor, options) => calls.push({ ids, ctor, options }),
    onNpcDeath: (handler) => { deathHandler = handler; },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, [7806]);
  assert.deepEqual(calls[0].options, { singleton: false });
  assert.equal(typeof deathHandler, 'function');

  const said = [];
  deathHandler({ npc: { getId: () => 7806, forceChat: (line) => said.push(line) } });
  assert.deepEqual(said, ['Oh!']);
  deathHandler({ npc: { getId: () => 1, forceChat: (line) => said.push(line) } });
  deathHandler({ npc: null });
  assert.deepEqual(said, ['Oh!']);
});
