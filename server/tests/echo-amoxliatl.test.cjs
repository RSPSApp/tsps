// Run after `yarn build`: node --test tests/echo-amoxliatl.test.cjs
// The Leagues VI Echo Amoxliatl's fight (EchoFight.Amoxliatl.js) against rsprox.net 1140 (rev 237.1,
// 7 Echoes, 6 kills): her turns from the rise, the magic shots, the black icicle and its spikes, the
// phase casts and the enrage, the pools. The cache resolves the data's gameval names; the boss,
// player and combat engine are stand-ins recording what the fight sends, driven tick by tick.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Common = require("../plugins/bosses/amoxliatl/Common.Amoxliatl");
const EchoFight = require("../plugins/bosses/amoxliatl/EchoFight.Amoxliatl");

const core = PluginManager.getCoreApi();
let ECHO;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const spotanim = (name) => CacheDefinitions.getSpotanimId(name);
const seq = (name) => CacheDefinitions.getSeqId(name);

/** A fight on stand-ins: `log` holds [tick, kind, ...] for everything it sends. */
function setup({ hp = 650, playerAt = [1366, 4511] } = {}) {
  const log = [];
  let tick = 0;
  const location = (x, y, z = 0) => new core.Location(x, y, z);
  const boss = {
    hp,
    getId: () => 13685,
    getLocation: () => location(1362, 4510),
    getSize: () => 3,
    getHitpoints() { return this.hp; },
    getMaxHitpoints: () => 650,
    isRegistered: () => true,
    getDefinition: () => ({ getName: () => "Amoxliatl" }),
    getTypeCustomisationForUpdate: () => ({ name: "Amoxliatl (Echo)" }),
    forceChat: (text) => log.push([tick, "say", text]),
    performAnimation: (a) => log.push([tick, "seq", a.getId()]),
    getCombat: () => ({ attack() {}, setAttackDelay() {}, getLastAttack: () => ({ reset() {} }) }),
  };
  const player = {
    at: location(...playerAt),
    isRegistered: () => true,
    getHitpoints: () => 99,
    getLocation() { return this.at; },
    getSkillManager: () => ({ getCurrentLevel: () => 70 }),
    sendMessage: (text) => log.push([tick, "message", text]),
    getCombat: () => ({ getHitQueue: () => ({ addPendingHit: (hit) => log.push([tick, "hit", hit.kind, hit.damage, hit.config]) }) }),
    getPacketSender: () => ({
      sendGraphic: (g, at) => log.push([tick, "map", g.getId(), at.getX(), at.getY(), g.getDelay()]),
      sendSoundEffect: (id, loops, delay) => log.push([tick, "sound", id, delay]),
      sendAreaSound: (id, x, y) => log.push([tick, "area-sound", id, x, y]),
      sendTypedMessage: (type, text, name) => log.push([tick, "npc-say", name, text]),
    }),
  };
  class PendingHit {
    constructor(attacker, target, method, config) {
      this.attacker = attacker; this.config = config;
      this.kind = config.rollAccuracy === false ? "fixed" : "shot";
      this.damage = config.damage ?? 0;
    }
  }
  class Projectile {
    constructor(from, to, lockon, id, delay, end, startHeight, endHeight) {
      this.sent = { from: [from.getX(), from.getY()], to: [to.getX(), to.getY()], lockon: !!lockon, id, delay, end, startHeight, endHeight };
    }
    static centreOf(npc) { const at = npc.getLocation(); return location(at.getX() + 1, at.getY() + 1); }
    withAngle(angle) { this.sent.angle = angle; return this; }
    withProgress(progress) { this.sent.progress = progress; return this; }
    sendProjectile() { log.push([tick, "proj", this.sent]); }
  }
  const fakeCore = {
    ...core,
    Projectile, PendingHit,
    CombatFactory: { applyStyleDamage(hit, max) { hit.damage = max; } },
    World: { getProcessCycle: () => 0 },
    RegionManager: { blocked: () => false },
    GameObject: class { constructor(id, tile, shape, rotation) { this.id = id; this.tile = tile; this.shape = shape; this.rotation = rotation; } getLocation() { return this.tile; } },
    ObjectManager: {
      register: (o) => log.push([tick, "pool+", o.tile.getX(), o.tile.getY(), o.id]),
      deregister: (o) => log.push([tick, "pool-", o.tile.getX(), o.tile.getY()]),
    },
    PrayerHandler: { ...core.PrayerHandler, deactivatePrayers: () => log.push([tick, "prayers-off"]) },
  };
  const events = [];
  Common.init({ core: fakeCore, emitCustomEvent: (name, payload) => events.push([tick, name, payload]) });
  ECHO = Common.data.echo;
  const session = {
    player, area: null, rises: 0,
    tile: ([x, y, z]) => location(x, y, z ?? 0),
    worldTile: (at) => [at.getX(), at.getY()],
  };
  const fight = new EchoFight.EchoFight(session, boss);
  fight.start();
  const run = (until) => { while (tick < until) { tick++; fight.process(); } };
  return { fight, boss, player, log, events, run, at: (x, y) => { player.at = location(x, y); }, session };
}

const of = (log, kind, filter = () => true) => log.filter((e) => e[1] === kind && filter(e));

test("the data's gameval names are in the cache, as the recording names them", () => {
  setup();
  const { standard, enrage, icicle, spikes, phase, pools } = ECHO;
  assert.equal(seq(standard.seq), 2973);
  assert.equal(seq(phase.seq), 11530);
  assert.ok(Number.isInteger(seq(enrage.seq)), enrage.seq);
  assert.equal(spotanim(standard.shot.spotanim), 3706);
  assert.equal(spotanim(icicle.projectile.spotanim), 3707);
  assert.equal(spotanim(icicle.impact.spotanim), 3705);
  assert.equal(spotanim(icicle.shadow), 2111);
  assert.equal(spotanim(spikes.spotanim), 3712);
  assert.equal(spotanim(phase.spotanim), 3713);
  assert.equal(spotanim(pools.clearSpotanim), 3709);
  assert.equal(CacheDefinitions.getLocId(pools.loc), 29412);
});

test("as recorded from the rise: a turn every 4 ticks from 4, two shots landing 3 and 4 later, the icicle sent the next tick", () => {
  const { log, run } = setup();
  run(14);
  assert.deepEqual(of(log, "seq", (e) => e[2] === 2973).map((e) => e[0]), [4, 8, 12]);
  const shots = of(log, "proj", (e) => e[2].id === 3706);
  assert.deepEqual(shots.slice(0, 2).map((e) => [e[0], e[2].delay, e[2].end, e[2].lockon]), [[4, 60, 90, true], [4, 90, 120, true]]);
  assert.deepEqual(of(log, "hit", (e) => e[2] === "shot").map((e) => e[0]).slice(0, 2), [7, 8], "the shots land at +3 and +4");
  assert.equal(of(log, "hit", (e) => e[2] === "shot")[0][3], 30, "rolled up to 30");
  assert.deepEqual(of(log, "sound", (e) => e[0] === 4).map((e) => [e[2], e[3]]), [[8655, 35], [8667, 70], [8726, 90]]);
  const icicle = of(log, "proj", (e) => e[2].id === 3707)[0];
  assert.equal(icicle[0], 5);
  assert.deepEqual([icicle[2].to, icicle[2].lockon, icicle[2].delay, icicle[2].end], [[1366, 4511], false, 0, 60], "at the tile, not the player");
  assert.deepEqual([icicle[2].startHeight * 4, icicle[2].endHeight * 4, icicle[2].angle, icicle[2].progress], [400, 70, 128, 90], "the recorded wire arc");
  assert.ok(of(log, "map", (e) => e[0] === 5 && e[2] === 3705 && e[5] === 60).length === 1, "its impact, 60 cycles in");
  assert.ok(of(log, "map", (e) => e[0] === 5 && e[2] === 2111).length === 1, "and its shadow");
  assert.deepEqual(of(log, "pool+").slice(0, 1).map((e) => [e[0], e[2], e[3], e[4]]), [[7, 1366, 4511, 29412]], "a pool where it lands");
  assert.ok(of(log, "area-sound", (e) => e[0] === 7 && e[2] === 9726 && e[3] === 1365 && e[4] === 4511).length === 1, "the pool's sound from the platform's middle");
});

test("the icicle's spikes: its tile, then the floor 2-4 steps out but not the 8 around it, 2 cycles a step", () => {
  const tiles = EchoFight.spikeTiles([1365, 4511]);
  const grid = [];
  for (let dy = 4; dy >= -4; dy--) {
    let row = "";
    for (let dx = -4; dx <= 4; dx++) {
      const spike = tiles.find(({ tile }) => tile[0] - 1365 === dx && tile[1] - 4511 === dy);
      row += dx === 0 && dy === 0 ? "O" : spike ? String(spike.steps * ECHO.spikes.delayPerStep) : ".";
    }
    grid.push(row);
  }
  // As recorded around (1367, 4511) and (1366, 4513), 79 icicles alike on open floor.
  assert.deepEqual(grid, ["....8....", "...868...", "..86468..", ".86...68.", "864.O.468", ".86...68.", "..86468..", "...868...", "....8...."]);
});

test("the icicle lands on whoever is on its tile or spikes as the tick before ends; the 8 tiles around it are safe", () => {
  const outcome = (to) => {
    const { log, run, at } = setup();
    run(6);
    at(...to);
    run(7);
    return { hit: of(log, "hit", (e) => e[0] === 7 && e[2] === "fixed")[0], miss: of(log, "sound", (e) => e[0] === 7 && e[2] === 7965).length };
  };
  const stayed = outcome([1366, 4511]);
  assert.ok(stayed.hit && stayed.hit[3] >= 18 && stayed.hit[3] <= 26, "18-26 on its tile");
  assert.equal(stayed.hit[4].bypassProtectionPrayer, true, "through Protect from Magic (prayed players took it, 23 of 23)");
  assert.equal(stayed.miss, 0);
  const spiked = outcome([1368, 4511]);
  assert.ok(spiked.hit, "2 steps out: a spike");
  const adjacent = outcome([1367, 4512]);
  assert.equal(adjacent.hit, undefined, "diagonally next to it: safe (149 of 149)");
  assert.equal(adjacent.miss, 1, "and it shatters audibly");
});

test("the first turn at or below 520 is a phase cast: spikes within 2, prayers off, then the hit and pools; the next turn 5 later", () => {
  const { log, run, boss, at } = setup();
  run(7);
  boss.hp = 516;
  run(8);
  assert.deepEqual(of(log, "seq", (e) => e[0] === 8).map((e) => e[2]), [11530]);
  assert.deepEqual(of(log, "say", (e) => e[0] === 8).map((e) => e[2]), ["Rani grows within me!"]);
  assert.deepEqual(of(log, "npc-say", (e) => e[0] === 8).map((e) => e[2]), ["Amoxliatl (Echo)"], "under her Echo name, as live's npc_say");
  assert.ok(of(log, "sound", (e) => e[0] === 8 && e[2] === 6867).length === 1);
  assert.equal(of(log, "map", (e) => e[0] === 8 && e[2] === 3713).length, 13, "a radius-2 diamond on open floor (13 tiles, as recorded)");
  assert.equal(of(log, "proj", (e) => e[0] === 8).length, 0, "no shots with it");
  run(9);
  assert.equal(of(log, "prayers-off", (e) => e[0] === 9).length, 1);
  assert.deepEqual(of(log, "message", (e) => e[0] === 9).map((e) => e[2]), ["<col=ff3045>Amoxliatl disables your prayers.</col>"]);
  at(1366, 4513);
  run(11);
  assert.ok(of(log, "hit", (e) => e[0] === 11 && e[2] === "fixed").length === 1, "still within it: hit");
  assert.ok(of(log, "pool+", (e) => e[0] === 11).length >= 11, "pools on its tiles, but not where one is");
  run(13);
  assert.deepEqual(of(log, "seq", (e) => e[0] > 8 && e[0] <= 13).map((e) => e[0]), [13], "the next turn 5 ticks after the cast");
  assert.equal(of(log, "seq", (e) => e[0] === 13)[0][2], 2973, "a standard turn again");
});

test("at or below 250 the second cast, then the enrage: only the icicle, every 2 ticks", () => {
  const { log, run, boss } = setup();
  run(3);
  boss.hp = 500;
  run(4);
  boss.hp = 240;
  run(30);
  const turns = of(log, "seq", (e) => e[0] > 0).map((e) => [e[0], e[2]]);
  const melee = seq(ECHO.enrage.seq);
  assert.deepEqual(turns.slice(0, 5), [[4, 11530], [9, 11530], [14, melee], [16, melee], [18, melee]]);
  assert.deepEqual(of(log, "say").map((e) => e[2]).slice(1), ["Rani grows within me!", "Let the darkness consume you!"]);
  assert.equal(of(log, "proj", (e) => e[0] >= 14 && e[2].id === 3706).length, 0, "no magic shots in the enrage");
  assert.deepEqual(of(log, "proj", (e) => e[2].id === 3707).map((e) => e[0]).slice(0, 3), [15, 17, 19], "an icicle the tick after each");
  assert.ok(of(log, "sound", (e) => e[0] === 14 && e[2] === 8655 && e[3] === 48).length === 1);
});

test("a pool hurts from its second tick, 7-15 a tick, and goes after 100 ticks with a puff", () => {
  const { log, run, fight } = setup({ playerAt: [1366, 4511] });
  run(7);
  assert.equal(of(log, "pool+", (e) => e[0] === 7).length, 1);
  const icicleHit = of(log, "hit", (e) => e[0] === 7 && e[2] === "fixed").length;
  run(8);
  assert.equal(of(log, "hit", (e) => e[0] === 8 && e[2] === "fixed").length, 0, "nothing the tick after it forms");
  run(9);
  const pool = of(log, "hit", (e) => e[0] === 9 && e[2] === "fixed");
  assert.equal(pool.length, 1);
  assert.ok(pool[0][3] >= 7 && pool[0][3] <= 15, `${pool[0][3]}`);
  assert.equal(icicleHit, 1);
  fight.player.at = new core.Location(1370, 4515, 0);
  fight.stopped = false;
  run(107);
  assert.ok(of(log, "pool-", (e) => e[0] === 107 && e[2] === 1366 && e[3] === 4511).length === 1, "gone 100 ticks after it formed");
  assert.ok(of(log, "map", (e) => e[0] === 107 && e[2] === 3709).length >= 1, "with its puff");
});

test("her death takes every pool, with the Echo's puff", () => {
  const { log, run, fight } = setup();
  run(12);
  const pools = of(log, "pool+").length;
  fight.died();
  assert.equal(of(log, "pool-", (e) => e[0] === 12).length, pools);
  assert.equal(of(log, "map", (e) => e[0] === 12 && e[2] === 3709).length, pools);
  run(20);
  assert.equal(of(log, "proj", (e) => e[0] > 12).length, 0, "and her turns with her");
});

test("she rises with her first line, then one of the recorded others", () => {
  const first = setup();
  assert.deepEqual(of(first.log, "say").map((e) => e[2]), ["Euat! You are not welcome here!"]);
  const again = setup();
  again.session.rises = 1;
  again.fight.start();
  assert.ok(Common.data.respawnLines.lines.includes(of(again.log, "say").pop()[2]));
});
