// Run after `yarn build`: node --test tests/retribution.test.cjs
// Retribution (docs/retribution.md): a death with the prayer on hurts what stands on the eight tiles around.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { Projectile } = require("../dist/game/model/Projectile");
const { Sounds } = require("../dist/game/Sounds");
const Retribution = require("../plugins/combat/Retribution.plugin");
const Pickpocket = require("../plugins/skills/thieving/Pickpocket.Thieving");

let core;
let api;
const handlers = {};
const submitted = [];
const projectiles = [];
const areaSounds = [];
const restore = [];
const realRandom = Math.random;

function stub(object, key, value) {
  const original = object[key];
  object[key] = value;
  restore.push(() => { object[key] = original; });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  api = {
    core,
    onCustomEvent: (name, handler) => (handlers[name] = (handlers[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => { for (const handler of handlers[name] ?? []) handler(payload); },
  };
  Retribution.register(api);
  Pickpocket.register({ ...api, persistAttribute() {}, onNpcsInteraction() {}, onNpcInteraction() {} });
});

let prayerOn;
const world = { npcs: [], players: [] };

beforeEach(() => {
  prayerOn = true;
  world.npcs = [];
  world.players = [];
  submitted.length = projectiles.length = areaSounds.length = 0;
  stub(core.PrayerHandler, "isActivated", (_player, prayer) => prayerOn && prayer === core.PrayerHandler.RETRIBUTION);
  stub(core.World, "getNpcsNear", (tile, radius) => world.npcs.filter((npc) => Math.max(Math.abs(npc.getLocation().getX() - tile.getX()), Math.abs(npc.getLocation().getY() - tile.getY())) <= radius));
  stub(core.World, "getPlayers", () => world.players);
  stub(core.TaskManager, "submit", (task) => submitted.push(task));
  stub(Projectile.prototype, "sendProjectile", function () { projectiles.push(this); });
  stub(Sounds, "playAreaSound", (options) => areaSounds.push(options));
  stub(core.CombatFactory, "canAttackByPolicy", (_dying, target) => (target.refused ? core.CanAttackResponse.CANT_ATTACK_IN_AREA : core.CanAttackResponse.CAN_ATTACK));
});

afterEach(() => {
  while (restore.length) restore.pop()();
  Math.random = realRandom;
});

function dyingPlayer(prayer = 99) {
  const player = new Player(null);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSkillManager().setMaxLevel(Skill.PRAYER, prayer);
  player.getSkillManager().setCurrentLevel(Skill.PRAYER, prayer, false);
  return player;
}

function fakeMobile(name, x, y, { npc = true, attackable = true, refused = false, hitpoints = 50, size = 1 } = {}) {
  const hits = [];
  return {
    name, refused, hits,
    isNpc: () => npc, isPlayer: () => !npc, getAsNpc() { return this; }, getAsPlayer() { return this; },
    isRegistered: () => true, isUntargetable: () => false, getHitpoints: () => hitpoints,
    getLocation: () => new Location(x, y, 0), getPrivateArea: () => null, getSize: () => size,
    getCurrentDefinition: () => ({ isAttackable: () => attackable }),
    getDueling: () => ({ inDuel: () => false }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (list) => hits.push(...list) }) }),
  };
}

function die(player, finalBlow = null) {
  player.getCombat().getHitQueue().lastAppliedHit = finalBlow;
  api.emitCustomEvent("player:dying", { player, killer: null });
}

test("the dying player plays the fire: graphic, area sound and a projectile to each of the eight tiles around", () => {
  const player = dyingPlayer();
  die(player);
  assert.equal(player.getGraphic().getId(), 437);
  assert.equal(player.getGraphic().getDelay(), 30);
  assert.equal(areaSounds.length, 1);
  assert.deepEqual([areaSounds[0].soundId, areaSounds[0].radius, areaSounds[0].x, areaSounds[0].y], [159, 5, 3200, 3200]);
  assert.equal(projectiles.length, 8);
  const ends = projectiles.map((shot) => `${shot.end.getX() - 3200},${shot.end.getY() - 3200}`).sort();
  assert.deepEqual(ends, ["-1,-1", "-1,0", "-1,1", "0,-1", "0,1", "1,-1", "1,0", "1,1"]);
  for (const shot of projectiles) {
    assert.equal(shot.projectileId, 438);
    assert.deepEqual([shot.delay, shot.speed, shot.angle, shot.progress], [36, 48, 0, 0]);
    assert.ok(shot.start.equals(new Location(3200, 3200, 0)));
  }
  assert.equal(submitted.length, 1, "the hits land with the projectile");
});

test("an NPC on an adjacent tile is hit for up to a quarter of the base Prayer level; farther and unattackable ones are not", () => {
  const player = dyingPlayer(99);
  const monster = fakeMobile("Monster", 3201, 3199);
  const diagonal = fakeMobile("Diagonal", 3199, 3201);
  const far = fakeMobile("Far", 3202, 3200);
  const harmless = fakeMobile("Harmless", 3200, 3201, { attackable: false });
  const refused = fakeMobile("Refused", 3199, 3200, { refused: true });
  world.npcs.push(monster, diagonal, far, harmless, refused);
  Math.random = () => 0.999999;
  die(player);
  submitted[0].execute();
  for (const hit of [...monster.hits, ...diagonal.hits]) {
    assert.ok(hit instanceof core.HitDamage && hit.isReflected());
    assert.equal(hit.getDamage(), 24, "99 Prayer / 4 rounded down");
    assert.equal(hit.getSource(), player);
  }
  assert.equal(monster.hits.length + diagonal.hits.length, 2);
  assert.equal(far.hits.length + harmless.hits.length + refused.hits.length, 0);
});

test("a big NPC is hit when any tile it covers is next to the wearer, even though it is found by its south-west tile", () => {
  const player = dyingPlayer();
  const giant = fakeMobile("Giant", 3201, 3198, { size: 3 });
  const stands = fakeMobile("Two rows away", 3201, 3196, { size: 3 });
  const overlap = fakeMobile("Reaches back", 3198, 3201, { size: 2 });
  world.npcs.push(giant, stands, overlap);
  Math.random = () => 0.5;
  die(player);
  submitted[0].execute();
  assert.equal(giant.hits.length, 1, "its top row is level with the wearer");
  assert.equal(stands.hits.length, 0, "two rows away");
  assert.equal(overlap.hits.length, 1, "its right column is the column to the wearer's left");
});

test("the hit is a roll from 0 to the maximum and follows the base level, not the drained one", () => {
  const player = dyingPlayer(46);
  player.getSkillManager().setCurrentLevel(Skill.PRAYER, 3, false);
  const monster = fakeMobile("Monster", 3200, 3199);
  world.npcs.push(monster);
  Math.random = () => 0;
  die(player);
  submitted[0].execute();
  assert.equal(monster.hits[0].getDamage(), 0, "it can hit 0");
  assert.equal(Retribution._test.maxHit(player), 11, "46 Prayer / 4 rounded down");
});

test("another player on an adjacent tile is hit when the area lets the dying player attack them, and not otherwise", () => {
  const player = dyingPlayer();
  const open = fakeMobile("Open", 3201, 3200, { npc: false });
  const safe = fakeMobile("Safe", 3199, 3200, { npc: false, refused: true });
  world.players.push(player, open, safe);
  die(player);
  submitted[0].execute();
  assert.equal(open.hits.length, 1);
  assert.equal(safe.hits.length, 0);
});

test("nothing happens without the prayer, or when the killing blow was reflected damage", () => {
  const player = dyingPlayer();
  prayerOn = false;
  die(player);
  assert.equal(projectiles.length + submitted.length, 0, "no prayer");
  prayerOn = true;
  die(player, new core.HitDamage(5, core.HitMask.RED).markReflected());
  assert.equal(projectiles.length + submitted.length, 0, "Vengeance, recoil or another Retribution");
  die(player, new core.HitDamage(5, core.HitMask.RED));
  assert.equal(projectiles.length, 8, "an ordinary blow sets it off");
});

test("dying to a failed pickpocket's stun does not set it off", () => {
  const player = dyingPlayer();
  const stun = new core.HitDamage(3, core.HitMask.RED);
  Pickpocket._test.stunHits.add(stun);
  die(player, stun);
  assert.equal(projectiles.length + submitted.length, 0);
});

test("the policy check tells the dying player nothing, even when an area would message a refused attack", () => {
  const player = dyingPlayer();
  const told = [];
  const sender = new Proxy({}, { get: (_t, key) => (...args) => { if (key === "sendMessage") told.push(args[0]); return sender; } });
  player.getPacketSender = () => sender;
  const far = fakeMobile("Far", 3201, 3200, { npc: false, refused: true });
  world.players.push(player, far);
  stub(core.CombatFactory, "canAttackByPolicy", (attacker, target) => {
    attacker.getPacketSender().sendMessage("Your level difference is too great.");
    return target.refused ? core.CanAttackResponse.CANT_ATTACK_IN_AREA : core.CanAttackResponse.CAN_ATTACK;
  });
  die(player);
  submitted[0].execute();
  assert.equal(far.hits.length, 0);
  assert.deepEqual(told, []);
  assert.equal(player.getPacketSender(), sender, "the real sender is back afterwards");
});
