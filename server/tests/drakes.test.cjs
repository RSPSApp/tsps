// Run after `yarn build`: node --test tests/drakes.test.cjs
// Drakes in combat (plugins/npcs/Drakes.plugin.js, docs/drakes.md).
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");

const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");

const sent = [];
const sounds = [];
class FakeHit {
  constructor(attacker, target, method, delay) {
    Object.assign(this, { attacker, target, method, delay, type: method.type() });
  }
}
class FakeProjectile {
  static centreOf(mobile) {
    return real.Projectile.centreOf(mobile);
  }

  constructor(start, end, lockon, id, delay, speed, startHeight, endHeight, area) {
    Object.assign(this, { start, end, lockon, id, delay, speed, startHeight, endHeight, area });
  }

  withSource(source) {
    this.source = source;
    return this;
  }

  withAngle(angle) {
    this.angle = angle;
    return this;
  }

  withProgress(progress) {
    this.progress = progress;
    return this;
  }

  sendProjectile() {
    sent.push(this);
  }
}

const real = PluginManager.getCoreApi();
const core = {
  ...real,
  PendingHit: FakeHit,
  Projectile: FakeProjectile,
  Sounds: { sendSound: (player, sound) => sounds.push([sound.getId?.() ?? sound.id, sound.getDelay?.() ?? sound.delay]) },
};
const providers = [];
const Drakes = require("../plugins/npcs/Drakes.plugin");

before(() => {
  Drakes.register({ core, registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }) });
});

const random = Math.random;
afterEach(() => {
  Math.random = random;
  sent.length = 0;
  sounds.length = 0;
});

function mobile(x, y, size = 1, { player = false } = {}) {
  const shown = [];
  return {
    shown,
    getLocation: () => new Location(x, y, 1),
    getSize: () => size,
    isPlayer: () => player,
    isRegistered: () => true,
    getPrivateArea: () => null,
    getCurrentDefinition: () => ({ getAttackSpeed: () => 4 }),
    performAnimation: (animation) => shown.push(`anim ${animation.getId()}`),
  };
}

/** The drake of rec 3014 tick 217 (south-west tile 1308,10235, size 5). */
const drake = () => mobile(1308, 10235, 5);
const player = (x, y) => mobile(x, y, 1, { player: true });

test("the drake gets its own combat method, one per attack", () => {
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0].ids, [8612]);
  assert.equal(providers[0].options.singleton, false);
});

test("melee reach is touching the 5x5 footprint along an edge or at a corner (Wiki: diagonals too)", () => {
  const { adjacent } = Drakes._test;
  assert.equal(adjacent(drake(), player(1312, 10234)), true); // south edge, rec 3014 tick 221
  assert.equal(adjacent(drake(), player(1313, 10234)), true); // south-east corner
  assert.equal(adjacent(drake(), player(1307, 10240)), true); // north-west corner
  assert.equal(adjacent(drake(), player(1312, 10233)), false);
  assert.equal(adjacent(drake(), player(1314, 10237)), false);
  assert.equal(adjacent(drake(), player(1310, 10237)), false); // under it
});

test("the shot starts at the drake's head and lands 57 + 3 a tile from there (rec 3014)", () => {
  const { launchTile, landingCycle } = Drakes._test;
  const npc = drake(); // centre 1310,10237
  for (const [x, y, end] of [[1312, 10229, 78], [1312, 10234, 63], [1312, 10230, 75]]) {
    const target = player(x, y);
    const from = launchTile(npc, target);
    assert.deepEqual([from.getX(), from.getY()], [1311, 10236]);
    assert.equal(landingCycle(from, target), end);
  }
});

test("from range the drake only shoots: captured animation, projectile, sounds, a hit 2 ticks out", () => {
  Math.random = () => 0; // would swing if it could
  const npc = drake();
  const target = player(1312, 10229);
  const attack = new providers[0].ctor();
  assert.equal(attack.attackDistance(npc), 6);
  assert.equal(attack.attackSpeed(npc), 4);
  attack.start(npc, target);
  const [hit] = attack.hits(npc, target);
  assert.equal(hit.type, real.CombatType.RANGED);
  assert.equal(hit.delay, 2);
  assert.deepEqual(npc.shown, ["anim 8276"]);
  assert.equal(sent.length, 1);
  const shot = sent[0];
  assert.equal(shot.source, npc);
  assert.equal(shot.lockon, target);
  assert.deepEqual([shot.start.getX(), shot.start.getY(), shot.end.getX(), shot.end.getY()], [1311, 10236, 1312, 10229]);
  assert.deepEqual([shot.id, shot.delay, shot.speed, shot.startHeight * 4, shot.endHeight * 4, shot.angle, shot.progress],
    [1636, 44, 78, 80, 90, 10, 128]);
  assert.deepEqual(sounds, [[4136, 5], [1965, 20]]);
});

test("beside the player it shoots or swings; the swing is still a ranged attack, its hit the same tick", () => {
  const npc = drake();
  const target = player(1313, 10234); // diagonal

  Math.random = () => 0;
  const swing = new providers[0].ctor();
  swing.start(npc, target);
  const [melee] = swing.hits(npc, target);
  assert.equal(melee.type, real.CombatType.RANGED);
  assert.equal(melee.delay, 0);
  assert.deepEqual(npc.shown, ["anim 8275"]);
  assert.equal(sent.length, 0);
  assert.deepEqual(sounds, [[4130, 0]]);

  Math.random = () => 0.99;
  sounds.length = 0;
  const shot = new providers[0].ctor();
  shot.start(npc, target);
  const [ranged] = shot.hits(npc, target);
  assert.equal(ranged.type, real.CombatType.RANGED);
  assert.equal(ranged.delay, 2);
  assert.equal(sent.length, 1);
  assert.deepEqual(sounds, [[4136, 5], [1965, 20]]);
});
