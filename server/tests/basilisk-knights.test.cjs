// Run after `yarn build`: node --test tests/basilisk-knights.test.cjs
// Basilisk Knights in combat (plugins/npcs/BasiliskKnights.plugin.js, docs/basilisk-knights.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");

const sent = [];
const sounds = [];
let playerSpeed = 4;
let speedHook = (speed) => speed;
class FakeHit {
  constructor(attacker, target, method, delay) {
    Object.assign(this, { attacker, target, method, delay, type: method.type() });
  }
}

const real = PluginManager.getCoreApi();
const core = {
  ...real,
  PendingHit: FakeHit,
  Projectile: {
    centreOf: real.Projectile.centreOf,
    ticksToLand: real.Projectile.ticksToLand,
    createProjectile: (...args) => {
      const shot = { args, angle: null, progress: null };
      shot.withAngle = (angle) => ((shot.angle = angle), shot);
      shot.withProgress = (progress) => ((shot.progress = progress), shot);
      shot.sendProjectile = () => sent.push(shot);
      return shot;
    },
  },
  Sounds: { sendSound: (player, sound) => sounds.push([sound.getId?.() ?? sound.id, sound.getDelay?.() ?? sound.delay]) },
  CombatFactory: { getMethod: () => ({ attackSpeed: () => playerSpeed, type: () => real.CombatType.RANGED }) },
  PluginManager: { emitAttackSpeed: (attacker, target, type, speed) => speedHook(speed, type) },
};
const providers = [];
const Knights = require("../plugins/npcs/BasiliskKnights.plugin");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Knights.register({ core, registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }) });
});

const random = Math.random;
afterEach(() => {
  Math.random = random;
  sent.length = 0;
  sounds.length = 0;
  playerSpeed = 4;
  speedHook = (speed) => speed;
});

function mobile(x, y, size = 1, { player = false, target = null } = {}) {
  const shown = [];
  return {
    shown,
    getLocation: () => new Location(x, y, 0),
    getSize: () => size,
    isPlayer: () => player,
    isRegistered: () => true,
    getCombat: () => ({ getTarget: () => target }),
    performAnimation: (animation) => shown.push(`anim ${animation.getId()}`),
    performGraphic: (graphic) => shown.push(`gfx ${graphic.getId()} delay ${graphic.getDelay()} height ${graphic.getHeight()}`),
  };
}

/** The knight of rec 1862 tick 9686 (south-west tile 2453,10384, size 3) and a player beside it, east. */
const knightAt = (target) => mobile(2453, 10384, 3, { target });
const besidePlayer = () => mobile(2456, 10385, 1, { player: true });

test("the knight gets its own combat method, one per attack", () => {
  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0].ids, [9293]);
  assert.equal(providers[0].options.singleton, false);
});

test("melee range is touching the 3x3 footprint along an edge, not diagonally", () => {
  const { beside } = Knights._test;
  const knight = knightAt(null);
  assert.equal(beside(knight, mobile(2456, 10385)), true);
  assert.equal(beside(knight, mobile(2454, 10383)), true);
  assert.equal(beside(knight, mobile(2456, 10383)), false);
  assert.equal(beside(knight, mobile(2457, 10385)), false);
});

test("from range the knight only casts, with the captured projectile, impact and sounds", () => {
  Math.random = () => 0; // would pick melee if it could
  const player = mobile(2460, 10385, 1, { player: true }); // 6 tiles from the knight's centre (2454,10385)
  const knight = knightAt(player);
  const Method = providers[0].ctor;
  const attack = new Method();
  assert.equal(attack.attackDistance(knight), 10);
  attack.start(knight, player);
  const [hit] = attack.hits(knight, player);
  assert.equal(hit.type, real.CombatType.MAGIC);
  assert.deepEqual(knight.shown, ["anim 8500"]);
  assert.equal(sent.length, 1);
  const [source, victim, id, start, end, startHeight, endHeight] = sent[0].args;
  assert.equal(source, knight);
  assert.equal(victim, player);
  assert.deepEqual([id, start, end, startHeight * 4, endHeight * 4, sent[0].angle, sent[0].progress], [1735, 45, 75, 20, 26, 2, 16]);
  assert.deepEqual(player.shown, ["gfx 1736 delay 75 height 104"]);
  assert.deepEqual(sounds, [[4210, 6], [157, 12], [158, 75]]);
  assert.equal(hit.delay, 3);
});

test("the cast lands at cycle 60 up to 3 tiles from the centre, then 6 a tile later (rec 1862)", () => {
  const { landingCycle } = Knights._test;
  const knight = knightAt(null); // centre 2454,10385
  const at = (tiles) => landingCycle(knight, mobile(2454 + tiles, 10385));
  assert.deepEqual([2, 3, 4, 5, 6].map(at), [60, 60, 63, 69, 75]);
  assert.equal(real.Projectile.ticksToLand(at(2)), 2);
});

test("beside the player the knight swings or casts: melee anim, sounds, a hit next tick", () => {
  const player = besidePlayer();
  const knight = knightAt(player);
  const Method = providers[0].ctor;

  Math.random = () => 0;
  const swing = new Method();
  swing.start(knight, player);
  const [melee] = swing.hits(knight, player);
  assert.equal(melee.type, real.CombatType.MELEE);
  assert.equal(swing.attackDistance(knight), 1);
  assert.equal(melee.delay, 1);
  assert.deepEqual(knight.shown, ["anim 8499"]);
  assert.deepEqual(sounds, [[4199, 6], [4198, 53]]);
  assert.equal(sent.length, 0);
  assert.deepEqual(player.shown, []);

  Math.random = () => 0.99;
  sounds.length = 0;
  const cast = new Method();
  cast.start(knight, player);
  const [magic] = cast.hits(knight, player);
  assert.equal(magic.type, real.CombatType.MAGIC);
  assert.equal(magic.delay, 2);
  assert.deepEqual(player.shown, ["gfx 1736 delay 60 height 104"]);
  assert.deepEqual(sounds, [[4210, 6], [157, 12], [158, 60]]);
});

test("out of melee range it attacks at the player's speed, never faster than 4 ticks", () => {
  const Method = providers[0].ctor;
  const far = mobile(2460, 10385, 1, { player: true });
  playerSpeed = 6;
  assert.equal(new Method().attackSpeed(knightAt(far)), 6);
  playerSpeed = 2;
  assert.equal(new Method().attackSpeed(knightAt(far)), 4);
  playerSpeed = 6;
  assert.equal(new Method().attackSpeed(knightAt(besidePlayer())), 4);
  assert.equal(new Method().attackSpeed(knightAt(null)), 4);
});

test("the player's speed is taken after the attack-speed hooks (a league mastery's faster swing)", () => {
  const Method = providers[0].ctor;
  const far = mobile(2460, 10385, 1, { player: true });
  playerSpeed = 6;
  speedHook = (speed, type) => (type === real.CombatType.RANGED ? 5 : speed);
  assert.equal(new Method().attackSpeed(knightAt(far)), 5);
  speedHook = () => 3;
  assert.equal(new Method().attackSpeed(knightAt(far)), 4);
});
