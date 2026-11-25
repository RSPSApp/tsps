// Run after `yarn build`: node --test tests/echo-thermonuclear-smoke-devil.test.cjs
// The Leagues VI Echo Thermonuclear smoke devil's fight (EchoFight.ThermonuclearSmokeDevil.js) against
// rsprox.net 1161 (rev 237.1, 31 Echo kills): ticks from the spawn, the pools, the shots and what a
// pool and a prayer make of them, the special's damage and flight by distance, the enrage and the
// Echo's prayer. The cache resolves the data's gameval names; the boss, player and combat engine are
// stand-ins recording what the fight does, driven tick by tick.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Common = require("../plugins/bosses/thermonuclear/Common.ThermonuclearSmokeDevil");
const EchoFight = require("../plugins/bosses/thermonuclear/EchoFight.ThermonuclearSmokeDevil");

const ECHO = Common.DATA.echo;
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const spotanim = (name) => CacheDefinitions.getSpotanimId(name);
const seq = (name) => CacheDefinitions.getSeqId(name);

/** A fight on stand-ins: `log` holds [tick, kind, ...] for everything it sends. */
function setup({ hp = 1200, playerAt = [2376, 9452], prayer = null } = {}) {
  const log = [];
  let tick = 0;
  const area = {};
  const hits = [];
  const location = (x, y, z = 0) => new core.Location(x, y, z);
  const boss = {
    hp, headIcon: -1,
    getLocation: () => location(2362, 9448),
    getSize: () => 3,
    getHitpoints() { return this.hp; },
    isRegistered: () => true,
    performAnimation: (a) => log.push([tick, "anim", a.getId()]),
    showHeadbar: (id, opts) => log.push([tick, "headbar", id, opts.endFill, opts.duration]),
    setHeadIcon(icon) { this.headIcon = icon; log.push([tick, "headicon", icon]); },
    getCombat: () => ({ attack() {}, getLastAttack: () => ({ reset() {} }) }),
  };
  const player = {
    at: location(...playerAt), prayer,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getPrivateArea: () => area,
    getLocation() { return this.at; },
    performGraphic: (g) => log.push([tick, "gfx", g.getId()]),
    getCombat: () => ({ getHitQueue: () => ({ addPendingHit: (hit) => { hits.push([tick, hit]); log.push([tick, "hit", hit.style, hit.total]); } }) }),
    getPacketSender: () => ({
      sendGraphic: (g, at) => log.push([tick, "map", g.getId(), at.getX(), at.getY()]),
      sendSoundEffect: (id, loops, delay) => log.push([tick, "sound", id, delay]),
      sendAreaSound: (id, x, y, z, loops, delay, range) => log.push([tick, "area-sound", id, range]),
      sendTypedMessage: (type, text) => log.push([tick, "msg", text]),
    }),
  };
  class PendingHit {
    constructor(attacker, target, method, config) {
      this.attacker = attacker; this.style = method.type() === core.CombatType.RANGED ? "ranged" : "magic";
      this.parts = [{ damage: 0, setDamage(d) { this.damage = d; }, getDamage() { return this.damage; } }];
      this.total = 0; this.config = config; this.bypass = false;
    }
    getHits() { return this.parts; }
    updateTotalDamage() { this.total = this.parts.reduce((a, p) => a + p.damage, 0); }
    setTotalDamage(d) { this.parts[0].damage = d; this.total = d; }
    markProtectionBypassed() { this.bypass = true; }
    setTriggersVengeance(v) { this.vengeance = v; return this; }
    isAccurate() { return true; }
  }
  const projectile = (args) => {
    const shot = { args, angle: null, progress: null };
    const chain = { withAngle(a) { shot.angle = a; return chain; }, withProgress(p) { shot.progress = p; return chain; }, sendProjectile() { log.push([tick, "proj", args[2], args[3], args[4], shot.angle, shot.progress, args[5], args[6]]); } };
    return chain;
  };
  const fakeCore = {
    ...core,
    Projectile: { createProjectile: (...args) => projectile(args) },
    PendingHit,
    // Accurate, and the top of its range, so the pool and prayer multipliers show plainly.
    CombatFactory: { applyStyleDamage(hit, max, opts) { hit.markProtectionBypassed(); hit.parts[0].damage = max; hit.minHit = opts.minHit; hit.updateTotalDamage(); } },
    World: { getProcessCycle: () => 0 },
    PrayerHandler: { ...core.PrayerHandler, PROTECT_FROM_MAGIC: core.PrayerHandler.PROTECT_FROM_MAGIC, PROTECT_FROM_MISSILES: core.PrayerHandler.PROTECT_FROM_MISSILES,
      isActivated: (who, p) => (who.prayer === "magic" && p === core.PrayerHandler.PROTECT_FROM_MAGIC) || (who.prayer === "ranged" && p === core.PrayerHandler.PROTECT_FROM_MISSILES) },
  };
  Common.init({ core: fakeCore });
  const session = { player, area };
  const fight = new EchoFight.EchoFight(session, boss);
  fight.random = () => 0.99; // no misses unless a test says so
  fight.start();
  const run = (until) => { while (tick < until) { tick++; fight.process(); } };
  return { fight, boss, player, log, hits, run, at: (x, y) => { player.at = location(x, y); } };
}

test("the gameval names in the data are in the cache", () => {
  const { pools, orbs, special } = ECHO;
  for (const name of [pools.spawn, pools.idle, pools.despawn, pools.shield, orbs.ranged.projectile, orbs.ranged.impact,
    orbs.magic.projectile, orbs.magic.impact, special.projectile, special.impact]) {
    assert.ok(Number.isInteger(spotanim(name)) && spotanim(name) >= 0, name);
  }
  for (const name of [orbs.attackSeq, special.chargeSeq, special.launchSeq]) assert.ok(Number.isInteger(seq(name)) && seq(name) >= 0, name);
  // The ids the recording shows for them (rev 237.1; the active cache keeps them).
  assert.deepEqual([spotanim(pools.spawn), spotanim(pools.idle), spotanim(pools.despawn), spotanim(pools.shield)], [3672, 3673, 3675, 3676]);
  assert.deepEqual([spotanim(orbs.ranged.projectile), spotanim(orbs.magic.projectile), spotanim(special.projectile)], [3665, 3667, 3669]);
  assert.deepEqual([seq(special.chargeSeq), seq(special.launchSeq)], [11854, 11855]);
});

test("as recorded from the spawn: pools at 3, shots RRR MMM RRR MMM from 6 every 2 in sets of 12, the special at 54", () => {
  const { log, run } = setup();
  run(80);
  const spawnTicks = [...new Set(log.filter((e) => e[1] === "map" && e[2] === 3672).map((e) => e[0]))];
  assert.deepEqual(spawnTicks, [3, 68], "the pools appear 3 ticks after the spawn, and again 14 after the special begins");
  assert.equal(log.filter((e) => e[1] === "map" && e[2] === 3672 && e[0] === 3).length, 12, "twelve pools");
  assert.equal(log.filter((e) => e[1] === "map" && e[2] === 3673 && e[0] === 4).length, 12, "drawn every tick from the next");
  const shots = log.filter((e) => e[1] === "proj" && e[2] !== 3669).map((e) => `${e[0]}${e[2] === 3665 ? "R" : "M"}`);
  assert.deepEqual(shots.slice(0, 15), ["6R", "8R", "10R", "18M", "20M", "22M", "30R", "32R", "34R", "42M", "44M", "46M", "72R", "74R", "76R"],
    "recording ticks 5817/19/21, 5829.., 5841.., 5853.., then 5883 after the special (spawn 5811)");
  const charge = log.filter((e) => e[1] === "anim" && e[2] === 11854).map((e) => e[0]);
  assert.deepEqual(charge, [54, 56, 58, 60], "the charge, every 2 ticks from 54 (5865)");
  assert.deepEqual(log.filter((e) => e[1] === "anim" && e[2] === 11855).map((e) => e[0]), [62], "the blast at 62 (5873)");
  assert.deepEqual(log.find((e) => e[1] === "headbar"), [54, "headbar", 34, 60, 240], "its charge bar, 0 to 60 over 240 cycles");
  assert.equal(log.filter((e) => e[1] === "map" && e[2] === 3675 && e[0] === 54).length, 12, "the pools go as the charge begins");
  const shot = log.find((e) => e[1] === "proj" && e[2] === 3665);
  assert.deepEqual(shot.slice(3), [29, 150, 5, 220, 62, 10], "the shot's arc as recorded (starttime 29, endtime 150, angle 5, progress 220; startheight 246, endheight 40 on the wire, which carries x4)");
});

test("a shot lands 5 ticks after it is fired: a pool and the right prayer decide what it does", () => {
  // On a live pool with the right prayer: nothing, the line, the shield and the pool used.
  const a = setup({ playerAt: [2368, 9451], prayer: "ranged" });
  a.run(11);
  assert.deepEqual(a.log.filter((e) => e[0] === 11 && ["msg", "hit", "gfx"].includes(e[1])).map((e) => e.slice(1)),
    [["gfx", 3676], ["msg", "The power resonating here protects you from the blast."]]);
  assert.ok(a.log.some((e) => e[0] === 11 && e[1] === "map" && e[2] === 3675 && e[3] === 2368 && e[4] === 9451), "the pool goes");
  assert.ok(a.log.some((e) => e[0] === 11 && e[1] === "sound" && e[2] === 10074));
  assert.equal(a.fight.pools.has("2368,9451"), false);
  a.run(13);
  assert.deepEqual(a.log.filter((e) => e[0] === 13 && e[1] === "hit").map((e) => e.slice(2)), [["ranged", 31]],
    "the next shot on the used tile: off a pool, the right prayer halves it");
  // On a live pool with the wrong prayer: half, and the pool still used.
  const b = setup({ playerAt: [2368, 9451], prayer: "magic" });
  b.run(11);
  assert.deepEqual(b.log.filter((e) => e[0] === 11 && e[1] === "hit").map((e) => e.slice(2)), [["ranged", 31]]);
  assert.equal(b.fight.pools.has("2368,9451"), false);
  assert.ok(b.log.some((e) => e[0] === 11 && e[1] === "gfx" && e[2] === 3666), "the shot's own impact");
  // Off the pools with the wrong prayer: whole.
  const c = setup({ playerAt: [2370, 9450], prayer: "magic" });
  c.run(11);
  assert.deepEqual(c.log.filter((e) => e[0] === 11 && e[1] === "hit").map((e) => e.slice(2)), [["ranged", 62]]);
  assert.ok(c.log.some((e) => e[0] === 11 && e[1] === "area-sound" && e[2] === 1418 && e[3] === 4));
  assert.equal(c.hits[0][1].minHit, 48, "a recorded hit is 48 to 62");
  assert.equal(c.hits[0][1].vengeance, false, "Wiki: only the special triggers Vengeance");
  // About one shot in seven misses, either style (12 of 88 recorded), whatever its levels.
  const d = setup({ playerAt: [2370, 9450], prayer: "magic" });
  d.fight.random = () => 0.1;
  d.run(11);
  assert.deepEqual(d.log.filter((e) => e[0] === 11 && e[1] === "hit").map((e) => e.slice(2)), [["ranged", 0]]);
  assert.equal(ECHO.orbs.missChance, 0.14);
  // A bare face (the Slayer rule's verdict on the hit roll): never a miss, always the maximum, then the
  // pool and prayer rule (Wiki, Thermonuclear smoke devil/Strategies: "even more damage").
  for (const [prayer, expected] of [["magic", 62], ["ranged", 31]]) {
    const e = setup({ playerAt: [2370, 9450], prayer });
    e.fight.random = () => 0;
    e.fight.core = { ...e.fight.core, PluginManager: { emitCombatHitRoll: (roll) => { roll.forceAccurate = true; roll.forceMaxHit = true; } } };
    e.run(11);
    assert.deepEqual(e.log.filter((x) => x[0] === 11 && x[1] === "hit").map((x) => x[3]), [expected], `bare face, ${prayer} prayer`);
  }
});

test("the special: damage fixed at launch by distance, its flight as recorded, lands and the Echo prays against the last style", () => {
  // Recorded from 4 tiles out; nearer, the Wiki's (130 underneath, 117 adjacent, 13 less a tile).
  for (const [tiles, damage, cycles] of [[0, 130, 60], [1, 117, 60], [2, 104, 60], [3, 91, 60], [4, 91, 60], [5, 78, 60], [8, 39, 86], [9, 26, 96], [10, 13, 106], [11, 9, 116], [12, 9, 126]]) {
    assert.equal(EchoFight.specialDamage(tiles), damage, `damage at ${tiles}`);
    assert.equal(EchoFight.specialFlightCycles(tiles), cycles, `flight at ${tiles}`);
  }
  const { log, run, fight, boss, at } = setup({ playerAt: [2376, 9448] });
  fight.onHit({ getCombatType: () => core.CombatType.MAGIC, getHits: () => [], updateTotalDamage() {} });
  run(62);
  at(2368, 9448); // moves in after the blast is cast: no difference
  const blast = log.find((e) => e[1] === "proj" && e[2] === 3669);
  assert.deepEqual(blast.slice(0, 5), [62, "proj", 3669, 29, 126], "12 tiles: endtime 126");
  assert.deepEqual(blast.slice(7), [62, 30], "from its head: startheight 246, endheight 120 on the wire (x4)");
  run(65);
  assert.deepEqual(log.filter((e) => e[1] === "hit" && e[0] > 62), [], "not before round(126/30) = 4 ticks");
  run(66);
  assert.deepEqual(log.filter((e) => e[1] === "hit" && e[0] === 66).map((e) => e[3]), [9], "9, as cast from 12 tiles");
  assert.equal(boss.headIcon, 2, "it now prays against magic, the last style to land");
});

test("its prayer: the protected style does a quarter", () => {
  const { fight } = setup();
  fight.protecting = "magic";
  const parts = [{ d: 31, setDamage(x) { this.d = x; }, getDamage() { return this.d; } }];
  fight.onHit({ getCombatType: () => core.CombatType.MAGIC, getHits: () => parts, updateTotalDamage() {} });
  assert.equal(parts[0].d, 7, "recorded: protected magic peaked at 7 against 31");
  const ranged = [{ d: 31, setDamage(x) { this.d = x; }, getDamage() { return this.d; } }];
  fight.onHit({ getCombatType: () => core.CombatType.RANGED, getHits: () => ranged, updateTotalDamage() {} });
  assert.equal(ranged[0].d, 31, "other styles in full");
  assert.equal(fight.lastStyle, "ranged");
});

test("the enrage: below 660 HP 8 ticks before a set, every set alternates from the style it would have had", () => {
  assert.deepEqual(EchoFight.setStyles(0, true), ["ranged", "magic", "ranged"]);
  assert.deepEqual(EchoFight.setStyles(1, true), ["magic", "ranged", "magic"]);
  const { log, run, boss } = setup();
  run(9);
  boss.hp = 659; // the second set's decision is at 18 - 8 = 10
  run(24);
  const shots = log.filter((e) => e[1] === "proj").map((e) => `${e[0]}${e[2] === 3665 ? "R" : "M"}`);
  assert.deepEqual(shots, ["6R", "8R", "10R", "18M", "20R", "22M"], "the first set ran as decided; the next is MRM");
  const late = setup();
  late.run(10);
  late.boss.hp = 500; // after the decision at 10: the set at 18 is still MMM
  late.run(24);
  assert.deepEqual(late.log.filter((e) => e[1] === "proj").map((e) => e[2] === 3665 ? "R" : "M").join(""), "RRRMMM");
});

test("its death stops the fight: no shot in flight lands", () => {
  const { log, run, boss, fight } = setup({ playerAt: [2370, 9450] });
  run(8);
  boss.hp = 0;
  run(20);
  assert.equal(fight.stopped, true);
  assert.deepEqual(log.filter((e) => e[1] === "hit"), []);
});
