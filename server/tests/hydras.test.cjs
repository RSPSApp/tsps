// Run after `yarn build`: node --test tests/hydras.test.cjs
// Karuulm Slayer Dungeon hydras in combat (plugins/npcs/Hydras.plugin.js, docs/hydras.md).
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");

const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");

const sent = [];
const sounds = [];
const graphics = [];
const tasks = [];
const events = [];
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
class FakeTask {
  constructor(delay) {
    this.delay = delay;
    this.left = delay;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }
}

const real = PluginManager.getCoreApi();
const players = [];
const core = {
  ...real,
  PendingHit: FakeHit,
  Projectile: FakeProjectile,
  Task: FakeTask,
  TaskManager: { submit: (task) => tasks.push(task) },
  World: { getPlayers: () => players },
  Sounds: { playAreaSound: (options) => sounds.push([options.soundId, options.x, options.y, options.delay, options.radius]) },
};
const providers = [];
const Hydras = require("../plugins/npcs/Hydras.plugin");

before(() => {
  Hydras.register({
    core,
    registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }),
    onCustomEvent: (name, fn) => events.push({ name, fn }),
    emitCustomEvent: () => {},
  });
});

const random = Math.random;
afterEach(() => {
  Math.random = random;
  sent.length = 0;
  sounds.length = 0;
  graphics.length = 0;
  tasks.length = 0;
  players.length = 0;
  Hydras._test.reset();
});

/** Runs the submitted tasks for `ticks` ticks, as the TaskManager would. */
function runTicks(ticks) {
  for (let t = 0; t < ticks; t++) {
    for (const task of [...tasks]) {
      if (task.stopped) continue;
      if (--task.left > 0) continue;
      task.left = task.delay;
      task.execute();
    }
    for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].stopped) tasks.splice(i, 1);
  }
}

function hydra(x, y) {
  const shown = [];
  return {
    shown,
    getId: () => 8609,
    isNpc: () => true,
    getLocation: () => new Location(x, y, 0),
    getSize: () => 3,
    getPrivateArea: () => null,
    getCurrentDefinition: () => ({ getAttackSpeed: () => 6 }),
    performAnimation: (animation) => shown.push(animation.getId()),
  };
}

function player(x, y, { immune = false } = {}) {
  const taken = [];
  let at = new Location(x, y, 0);
  const p = {
    taken,
    moveTo: (nx, ny) => { at = new Location(nx, ny, 0); },
    isPlayer: () => true,
    isNpc: () => false,
    getLocation: () => at,
    getPrivateArea: () => null,
    getHitpoints: () => 99,
    getCombat: () => ({
      getPoisonClock: () => ({ finished: () => !immune }),
      getHitQueue: () => ({ addPendingDamage: (hits) => taken.push(...hits.map((hit) => [hit.getDamage?.() ?? hit.damage, hit.getHitmask?.() ?? hit.hitmask])) }),
    }),
    getPacketSender: () => ({ sendGraphic: (graphic, location) => graphics.push([graphic.id, location.getX(), location.getY(), graphic.delay ?? 0]) }),
  };
  players.push(p);
  return p;
}

test("the hydra gets its own combat method, one per attack, and its basics don't poison", () => {
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0].ids, [8609]);
  assert.equal(providers[0].options.singleton, false);
  const poison = events.find((event) => event.name === "combat:npc-poison");
  const event = { attacker: hydra(0, 0), handled: false };
  poison.fn(event);
  assert.equal(event.handled, true);
  const other = { attacker: { isNpc: () => true, getId: () => 8612 }, handled: false };
  poison.fn(other);
  assert.equal(other.handled, false);
});

test("a random first style, switched every three attacks; every twelfth is the spit, outside the three (Wiki)", () => {
  const { nextAttack } = Hydras._test;
  Math.random = () => 0.1; // magic first
  const npc = hydra(1308, 10230);
  const seen = [];
  for (let i = 0; i < 24; i++) seen.push(nextAttack(npc));
  const M = "magic", R = "ranged", S = "special";
  assert.deepEqual(seen, [M, M, M, R, R, R, M, M, M, R, R, S, R, M, M, M, R, R, R, M, M, M, R, S]);
  Math.random = () => 0.9;
  assert.equal(nextAttack(hydra(0, 0)), R);
});

test("leaving combat keeps the count: a new attack method carries on from the hydra's last", () => {
  Math.random = () => 0.1;
  const npc = hydra(1308, 10230);
  const target = player(1312, 10226);
  const styles = [];
  for (let i = 0; i < 4; i++) {
    const attack = new providers[0].ctor();
    attack.start(npc, target);
    styles.push(attack.type());
  }
  const { MAGIC, RANGED } = real.CombatType;
  assert.deepEqual(styles, [MAGIC, MAGIC, MAGIC, RANGED]);
});

test("flights end at 40 + 5 a tile from the south-west tile (rsprox 1000480, 9 of 9)", () => {
  const { flightEnd, landingTicks } = Hydras._test;
  const cases = [
    [[1308, 10230], [1312, 10226], 60],
    [[1309, 10231], [1321, 10237], 100],
    [[1314, 10238], [1314, 10235], 55],
    [[1314, 10238], [1314, 10237], 45],
    [[1316, 10235], [1327, 10237], 95],
    [[1311, 10233], [1311, 10228], 65],
  ];
  for (const [[hx, hy], [tx, ty], end] of cases) {
    assert.equal(flightEnd(hydra(hx, hy), new Location(tx, ty, 0)), end);
  }
  assert.equal(landingTicks(60), 2);
  assert.equal(landingTicks(45), 1);
  assert.equal(landingTicks(100), 3);
});

test("the magic attack: captured animation, projectile from its centre, area sound, a hit 2 ticks on", () => {
  Math.random = () => 0.1;
  const npc = hydra(1308, 10230);
  const target = player(1312, 10226);
  const attack = new providers[0].ctor();
  assert.equal(attack.attackSpeed(npc), 6);
  assert.equal(attack.attackDistance(npc), 10);
  attack.start(npc, target);
  const [hit] = attack.hits(npc, target);
  assert.equal(hit.type, real.CombatType.MAGIC);
  assert.equal(hit.delay, 2);
  assert.deepEqual(npc.shown, [8262]);
  assert.equal(sent.length, 1);
  const shot = sent[0];
  assert.equal(shot.lockon, target);
  assert.equal(shot.source, npc);
  assert.deepEqual([shot.start.getX(), shot.start.getY(), shot.end.getX(), shot.end.getY()], [1309, 10231, 1312, 10226]);
  assert.deepEqual([shot.id, shot.delay, shot.speed, shot.startHeight, shot.endHeight, shot.angle, shot.progress], [1662, 30, 60, 30, 16, 0, 64]);
  assert.deepEqual(sounds, [[4083, 1312, 10226, 60, 1]]);
});

test("the ranged attack: its own animation, projectile and sound (rsprox 1000480 tick 13012)", () => {
  Math.random = () => 0.9;
  const npc = hydra(1314, 10238);
  const target = player(1314, 10235);
  const attack = new providers[0].ctor();
  attack.start(npc, target);
  const [hit] = attack.hits(npc, target);
  assert.equal(hit.type, real.CombatType.RANGED);
  assert.equal(hit.delay, 1);
  assert.deepEqual(npc.shown, [8261]);
  assert.deepEqual([sent[0].id, sent[0].speed, sent[0].startHeight, sent[0].endHeight], [1663, 55, 30, 31]);
  assert.deepEqual(sounds, [[4120, 1314, 10235, 55, 1]]);
});

test("the twelfth attack spits three blobs, one on the player, and deals no hit of its own", () => {
  Math.random = () => 0.1;
  const npc = hydra(1315, 10233);
  const target = player(1320, 10237);
  for (let i = 0; i < 11; i++) new providers[0].ctor().start(npc, target);
  sent.length = 0;
  sounds.length = 0;
  graphics.length = 0;
  npc.shown.length = 0;
  const rolls = [0.05, 0.3, 0.6, 0.95, 0.2, 0.8];
  let roll = 0;
  Math.random = () => rolls[roll++ % rolls.length];
  const spit = new providers[0].ctor();
  spit.start(npc, target);
  assert.deepEqual(spit.hits(npc, target), []);
  assert.deepEqual(npc.shown, [8263]);
  assert.equal(sent.length, 3);
  for (const blob of sent) {
    assert.equal(blob.id, 1644);
    assert.equal(blob.lockon, null);
    assert.deepEqual([blob.start.getX(), blob.start.getY()], [1316, 10234]);
    const tiles = Math.max(Math.abs(blob.end.getX() - 1316), Math.abs(blob.end.getY() - 10234));
    assert.equal(blob.speed, 60 + 10 * tiles); // rsprox 1000143: 80 at 2 tiles, 100 at 4
  }
  assert.deepEqual([sent[0].end.getX(), sent[0].end.getY()], [1320, 10237]);
  const tiles = sent.map((blob) => `${blob.end.getX()},${blob.end.getY()}`);
  assert.equal(new Set(tiles).size, 3);
  for (const blob of sent.slice(1)) {
    assert.ok(Math.max(Math.abs(blob.end.getX() - 1320), Math.abs(blob.end.getY() - 10237)) <= 3);
  }
  assert.equal(sounds.filter(([id]) => id === 4135).length, 3);
  assert.equal(graphics.filter(([id]) => id === 1645).length, 3);
});

test("a blob lands: the 3x3 splat, then a pool that hurts 4 every two ticks while stood on, for 13 ticks", () => {
  const { land } = Hydras._test;
  Math.random = () => 0; // landing angle 0
  const npc = hydra(1315, 10233);
  const onTile = player(1320, 10237);
  const beside = player(1321, 10238);
  const away = player(1323, 10237);
  land(npc, new Location(1320, 10237, 0));
  assert.deepEqual(graphics.slice(0, 1).map(([id]) => id), [1646]);
  const GREEN = real.HitMask.GREEN;
  assert.deepEqual(onTile.taken, [[4, GREEN]]);
  assert.deepEqual(beside.taken, [[4, GREEN]]);
  assert.deepEqual(away.taken, []);
  runTicks(1);
  assert.ok(graphics.some(([id]) => id === 1654), "settled pool graphic a tick later");
  assert.deepEqual(onTile.taken.length, 1, "nothing on the tick after landing");
  runTicks(1);
  assert.deepEqual(onTile.taken, [[4, GREEN], [4, GREEN]]);
  assert.equal(beside.taken.length, 1, "the pool is its own tile only");
  runTicks(11);
  assert.equal(onTile.taken.length, 7, "hurts at 2, 4 ... 12 ticks after landing");
  runTicks(4);
  assert.equal(onTile.taken.length, 7, "gone after 13 ticks");
});

test("poison immunity cuts the pool to 1 to 2 (Wiki)", () => {
  const { land } = Hydras._test;
  Math.random = () => 0.99;
  const npc = hydra(1315, 10233);
  const immune = player(1320, 10237, { immune: true });
  land(npc, new Location(1320, 10237, 0));
  runTicks(2);
  assert.deepEqual(immune.taken.map(([damage]) => damage), [2, 2]);
});
