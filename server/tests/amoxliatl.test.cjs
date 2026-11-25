// Run after `yarn build`: node --test tests/amoxliatl.test.cjs
// Amoxliatl (Wiki: Amoxliatl, Amoxliatl/Strategies; rsprox captures 1147 and 1695): her drop
// rolls, the platform her spikes and pools cover, where her unstable ice lands, and her
// Combat Achievements.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { Task } = require("../dist/game/task/Task");
const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
const Common = require("../plugins/bosses/amoxliatl/Common.Amoxliatl");
const { Fight, onFloor, floorTiles, key } = require("../plugins/bosses/amoxliatl/Fight.Amoxliatl");
const UnstableIce = require("../plugins/bosses/amoxliatl/UnstableIce.Amoxliatl");
const CombatAchievements = require("../plugins/bosses/amoxliatl/CombatAchievements.Amoxliatl");
const Scoreboard = require("../plugins/bosses/amoxliatl/Scoreboard.Amoxliatl");
const { ChatType, encodeChatMessage } = require("../dist/net/protocol/ClientProtocol");

const FROZEN_TEAR = 29895;
const emitted = [];

before(() => {
  __internals.loadDrops();
  Common.init({
    core: { Location, RegionManager: { blocked: () => false } },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });
});

function withRandom(values, action) {
  const random = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try {
    return action();
  } finally {
    Math.random = random;
  }
}

const table = () => __internals.tablesByNpc.get(13685)[0];
const player = () => ({ getAttribute: () => undefined, getInventory: () => ({ getAmount: () => 0 }), getBanks: () => [] });

test("two rolls on her table, and one frozen tear roll out of 10", () => {
  assert.equal(table().rolls, 2);
  for (const [roll, [min, max]] of [[0, [2, 4]], [0.65, [5, 10]], [0.95, [10, 20]]]) {
    const drops = withRandom([roll], () => __internals.rollTable(table(), player(), null));
    const tears = drops.filter((drop) => drop.itemId === FROZEN_TEAR);
    assert.equal(tears.length, 1, `roll ${roll}`);
    assert.ok(tears[0].amount >= min && tears[0].amount <= max, `roll ${roll}: ${tears[0].amount}`);
    const main = drops.filter((drop) => drop.itemId !== FROZEN_TEAR);
    assert.ok(main.length >= 2, `roll ${roll}: two main-table drops, got ${main.length}`);
  }
});

test("the platform is the captured octagon around (1365, 4511) and the path east", () => {
  assert.ok(onFloor(1365, 4511));
  assert.ok(onFloor(1359, 4511) && onFloor(1371, 4511));
  assert.ok(onFloor(1363, 4517) && !onFloor(1362, 4517));
  assert.ok(onFloor(1376, 4510) && onFloor(1376, 4512) && !onFloor(1376, 4513));
  assert.ok(!onFloor(1377, 4511), "the ice blockages stand off the floor");
  assert.equal(floorTiles().length, 144);
});

function fightAt(px, py, { blocks = [], path = false } = {}) {
  const session = {
    worldTile: (location) => [location.getX(), location.getY()],
    tile: ([x, y, z]) => new Location(x, y, z ?? 0),
    area: null,
  };
  return {
    session,
    shatteringBlocks: new Set(),
    blocks: new Set(blocks.map(([x, y]) => ({ getLocation: () => new Location(x, y, 0) }))),
    boss: { getLocation: () => new Location(1362, 4510, 0), getSize: () => 3 },
    playerTile: () => [px, py],
    onPath: ([x]) => path || x >= 1372,
  };
}

test("unstable ice lands on free floor near the player: not on them, her, the path or other ice", () => {
  const fight = fightAt(1366, 4511, { blocks: [[1367, 4511]] });
  const tiles = withRandom([0.5], () => UnstableIce.targets(fight, 200));
  assert.ok(tiles.length > 0);
  for (const [x, y] of tiles) {
    assert.ok(onFloor(x, y), `${x},${y} on the floor`);
    assert.ok(Math.max(Math.abs(x - 1366), Math.abs(y - 4511)) <= 5, `${x},${y} within 5`);
    assert.ok(!(x === 1366 && y === 4511), "not the player's tile");
    assert.ok(!(x >= 1362 && x <= 1364 && y >= 4510 && y <= 4512), `${x},${y} not under her`);
    assert.ok(x < 1372, `${x},${y} not on the path`);
    assert.ok(!(x === 1367 && y === 4511), "not on another block");
  }
  assert.equal(UnstableIce.targets(fightAt(1366, 4511), 3).length, 3);
});

class TestProjectile {
  static centreOf(npc) { return npc.getLocation(); }
  withAngle() { return this; }
  withProgress() { return this; }
  sendProjectile() {}
}

class TestAnimation {
  constructor(id) { this.id = id; }
}

const PRAYERS_DISABLED = "<col=ff3045>Amoxliatl disables your prayers and launches an icicle attack!</col>";

test("Icicle Crash sends the plain game message and leaves prayers alone when all are off", () => {
  const result = castIcicle([false, false]);
  assert.deepEqual(result.feedback, [[ChatType.GAME, "<col=ff3045>Amoxliatl launches an icicle attack!</col>"]]);
  assert.deepEqual(result.prayers, [false, false]);
});

test("Icicle Crash turns off active prayers before sending the disable game message", () => {
  const result = castIcicle([false, true]);
  assert.deepEqual(result.feedback, ["disable", [ChatType.GAME, PRAYERS_DISABLED]]);
  assert.deepEqual(result.prayers, [false, false]);
});

function castIcicle(prayers, session = {}) {
  const feedback = [];
  const target = new Location(1365, 4511, 0);
  const fight = {
    session,
    core: {
      Animation: TestAnimation,
      Projectile: TestProjectile,
      PrayerHandler: {
        deactivatePrayers(player) {
          player.getPrayerActive().fill(false);
          feedback.push("disable");
        },
      },
    },
    player: {
      getPrayerActive: () => prayers,
      getLocation: () => target,
      sendMessage: (text) => feedback.push([ChatType.GAME, text]),
    },
    boss: { getLocation: () => new Location(1362, 4510, 0), performAnimation() {} },
    at(ticks) { assert.equal(ticks, 5); },
  };
  Fight.prototype.icicleCrash.call(fight);
  return { feedback, prayers };
}

function trackUnstableIce(t, { px, py, random, session = {} }) {
  const api = Common.api;
  const fight = fightAt(px, py);
  const messages = [], formed = [], healed = [], splats = [], sounds = [], removed = [], bossAnims = [];
  const poolRegistrations = [];
  // Use Fight's actual event queue and pool placement. Record the object and NPC boundaries.
  Object.assign(fight, {
    core: {
      ...Common.core,
      Animation: TestAnimation,
      Projectile: TestProjectile,
      Graphic: { delayed: () => null },
      ChatType,
      Direction: { SOUTH: { getId: () => 0 } },
      GameObject: class { constructor(id, tile) { this.id = id; this.tile = tile; } },
      ObjectManager: { register: (pool) => poolRegistrations.push(pool) },
    },
    events: [], pools: new Map(), stats: {}, tick: 0, at: Fight.prototype.at, placePool: Fight.prototype.placePool,
    poolDamage() {}, prayerPoints() {}, updateHud() {}, clearPools() {},
  });
  Common.init({
    ...api,
    core: fight.core,
    removeNpc: (block) => { block.registered = false; removed.push(block); },
  });
  t.after(() => Common.init(api));
  Object.assign(fight.boss, {
    getCombat: () => ({ getLastAttack: () => ({ reset() {} }) }),
    performAnimation: (animation) => bossAnims.push(animation.id),
    heal: (amount) => healed.push(amount),
    showHitsplat: (amount, type) => splats.push([amount, type]),
  });
  fight.player = { getPacketSender: () => ({
    sendTypedMessage: (type, text) => messages.push([type, text]),
    sendGraphic() {},
    sendAreaSound: (...args) => sounds.push(args),
  }) };
  Object.assign(fight.session, session, {
    spawn(id, [x, y, z]) {
      assert.equal(id, 13688);
      const location = new Location(x, y, z);
      const block = {
        registered: true,
        animation: null,
        getLocation: () => location,
        getHitpoints: () => 10,
        isRegistered() { return this.registered; },
        getMovementQueue: () => ({ setBlockMovement: () => ({ reset() {} }) }),
        setFlag() {},
        performAnimation(animation) { this.animation = animation.id; },
      };
      formed.push(block);
      return block;
    },
  });
  const advance = (ticks) => withRandom([random], () => {
    for (let tick = 0; tick < ticks; tick++) Fight.prototype.process.call(fight);
  });
  withRandom([random], () => UnstableIce.launch(fight));
  return { fight, advance, messages, formed, healed, splats, sounds, removed, poolRegistrations, bossAnims };
}

test("Unstable Ice sends the recorded cyan spam line", (t) => {
  const { messages } = trackUnstableIce(t, { px: 1366, py: 4511, random: 0 });
  assert.deepEqual(messages, [[ChatType.SPAM, "<col=00e6e6>Amoxliatl forms some unstable ice blocks around you."]]);
});

test("intact Unstable Ice shatters at +14 with healing and 3x3 pools, and disappears at +15", (t) => {
  const { fight, advance, formed, healed, splats, sounds, removed, poolRegistrations, bossAnims } = trackUnstableIce(t, {
    px: 1362, py: 4515, random: 0.4,
  });
  advance(2);
  assert.equal(formed.length, 0);
  advance(1);
  assert.equal(formed.length, 2);
  assert.ok(formed.every((block) => block.animation === 11536));
  const centres = formed.map((block) => fight.session.worldTile(block.getLocation()));
  const squares = centres.flatMap(([x, y]) => [
    [x, y],
    [x - 1, y - 1], [x - 1, y], [x - 1, y + 1], [x, y - 1], [x, y + 1],
    [x + 1, y - 1], [x + 1, y], [x + 1, y + 1],
  ]);
  assert.ok(squares.some(([x, y]) => !onFloor(x, y)), "a square reaches beyond the floor");
  const onPlatform = squares.filter(([x, y]) => onFloor(x, y));
  const alreadyIced = onPlatform[0];
  fight.placePool(...alreadyIced);
  const iceBefore = fight.pools.get(key(...alreadyIced));
  poolRegistrations.length = 0;
  sounds.length = 0;
  bossAnims.length = 0;
  advance(11);
  assert.deepEqual(bossAnims, []);
  // R1140: her wind-up 2 ticks before the shatter.
  advance(1);
  assert.deepEqual(bossAnims, [11534]);
  advance(1);
  assert.ok(formed.every((block) => block.animation === 11536 && block.registered));
  assert.deepEqual([healed, splats, poolRegistrations, removed], [[], [], [], []]);
  assert.equal(fight.stats.shattered, undefined);
  advance(1);
  assert.ok(formed.every((block) => block.animation === 11035 && block.registered));
  assert.equal(fight.stats.shattered, true);
  assert.equal(healed.length, 2);
  assert.ok(healed.every((amount) => amount >= 16 && amount <= 25));
  assert.deepEqual(splats, healed.map((amount) => [amount, { mine: 6, others: 6 }]));
  assert.deepEqual(sounds.filter(([id]) => id === 9721), centres.map(([x, y]) => [9721, x, y, 0, 1, 0, 12, 6]));
  assert.deepEqual(sounds.filter(([id]) => id === 9726), [[9726, 1365, 4511, 0, 1, 30, 30, 30]]);
  assert.deepEqual(new Set(fight.pools.keys()), new Set(onPlatform.map(([x, y]) => key(x, y))));
  assert.equal(poolRegistrations.length, fight.pools.size - 1);
  assert.ok(poolRegistrations.every((pool) => pool.id === 54279));
  assert.equal(fight.pools.get(key(...alreadyIced)), iceBefore);
  advance(1);
  assert.deepEqual(removed, formed);
});

test("a kill on the shatter tick clears the burst blocks before their delayed removal", (t) => {
  const { fight, advance, formed, removed } = trackUnstableIce(t, {
    px: 1362, py: 4515, random: 0.4,
  });
  advance(17);
  assert.equal(formed.length, 2);
  assert.ok(formed.every((block) => block.animation === 11035 && block.registered));
  Fight.prototype.died.call(fight);
  assert.deepEqual(removed, formed);
  assert.ok(formed.every((block) => !block.registered));
  advance(1);
  assert.deepEqual(removed, formed, "no second removal on the next tick");
});

for (const [name, session] of [["quest", { quest: true }], ["Echo", { variant: "echo", echoToken: {} }]]) {
  test(`the ${name} fight keeps its existing special behaviour`, (t) => {
    assert.deepEqual(castIcicle([false], session).feedback, ["disable", [ChatType.GAME, PRAYERS_DISABLED]]);
    const { fight, advance, messages, formed, splats, removed } = trackUnstableIce(t, {
      px: 1366, py: 4511, random: 0, session,
    });
    assert.deepEqual(messages, [[ChatType.SPAM, "<col=00ffff>Amoxliatl forms some unstable ice blocks around you."]]);
    advance(17);
    assert.equal(formed[0].animation, 11536);
    advance(1);
    assert.equal(formed[0].animation, 11035);
    assert.equal(fight.pools.size, 0);
    assert.deepEqual(splats, []);
    advance(1);
    assert.deepEqual(removed, formed);
    const [x, y] = fight.session.worldTile(formed[0].getLocation());
    assert.ok([...fight.pools.values()].every((pool) => Math.abs(pool.tile.getX() - x) <= 1 && Math.abs(pool.tile.getY() - y) <= 1));
  });
}

test("Amoxliatl rises 28 ticks after her kill-count message", (t) => {
  const api = Common.api;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "amoxliatl-respawn-"));
  Scoreboard._useFile(path.join(scratch, "scoreboard.json"));
  t.after(() => {
    Common.init(api);
    Scoreboard._useFile(path.join(process.cwd(), "data", "saves", "amoxliatl-scoreboard.json"));
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  const tasks = [], messages = [], rises = [];
  const taskManager = { submit(task) { task.setRunning(true); tasks.push(task); } };
  Common.init({ ...api, core: { ...Common.core, Task, TaskManager: taskManager } });
  let onDeath;
  require("../plugins/bosses/amoxliatl/Kills.Amoxliatl")({
    persistAttribute() {}, onNpcBeforeDeath() {}, onNpcDeath(handler) { onDeath = handler; },
    onCustomEvent() {}, onPlayerLogin() {},
  });
  const attributes = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => ({ sendConfig() {} }),
  };
  let tick = 0;
  const session = { kills: 0, spawnBoss: () => rises.push(tick) };
  const fight = { session, player, stats: {}, duration: () => 42, hideHud() {}, stop() {} };
  onDeath({ npc: { __amoxliatlFight: fight } });
  assert.equal(messages[0], "Your Amoxliatl kill count is: <col=ff0000>1</col>.");
  for (tick = 1; tick <= 27; tick++) tasks.forEach((task) => task.tick());
  assert.deepEqual(rises, []);
  tasks.forEach((task) => task.tick());
  assert.deepEqual(rises, [28]);
  assert.deepEqual(Common.data.spawn.tile, [1362, 4510, 0]);
  assert.equal(Common.data.spawn.direction, "EAST");
  assert.equal(Common.data.spawn.anim, 11527);
});

test("the fight's tasks are judged from what it saw", () => {
  const judged = (stats, ticks, kills = 1) => {
    emitted.length = 0;
    CombatAchievements.judge({ player: {}, session: { kills }, stats }, ticks);
    return emitted.filter((event) => event.name === "combat-achievements:complete").map((event) => event.payload.task);
  };
  const clean = { damageTaken: 0, prayerLost: false, shattered: false, usedTemotli: false, otherWeapon: true };
  assert.deepEqual(judged(clean, 40), ["Amoxliatl Speed-Trialist", "Amoxliatl Speed-Chaser", "Nagua Negation", "Totally Shattered", "Without Ralos' Light"]);
  assert.deepEqual(judged({ ...clean, damageTaken: 3, prayerLost: true, shattered: true }, 60, 10), ["Amoxliatl Speed-Trialist", "Kemo Makti"]);
  assert.deepEqual(judged({ ...clean, damageTaken: 1, prayerLost: true, shattered: true, usedTemotli: true, otherWeapon: false }, 100), ["Temotli Triumph"]);
});

test("her line goes to the chatbox as npc_say with her name, the Unstable Ice line as spam", () => {
  // The chat packet's body: the text, the chat type, the sender's name, the prefix, the player id.
  const body = (packet) => packet.subarray(packet.length - (packet.readUInt16BE(1)));
  const line = body(encodeChatMessage("game", "Euat!", "Amoxliatl", "", -1, ChatType.NPC_SAY));
  assert.equal(line.toString("latin1", 0, 5), "Euat!");
  assert.equal(line[6], 116);
  assert.equal(line.toString("latin1", 7, 16), "Amoxliatl");
  assert.equal(body(encodeChatMessage("game", "x", "", "", -1, ChatType.SPAM))[2], 105);
  assert.equal(body(encodeChatMessage("game", "x"))[2], 0);
});

test("the spikes hurt a player still on one when they come up, not one who stepped off", () => {
  const hits = [];
  const fightOn = (x, y) => ({ over: false, player: { getHitpoints: () => 99 }, playerTile: () => [x, y], hurtPlayer: (damage) => hits.push(damage) });
  const spiked = new Set([key(1365, 4511), key(1366, 4511)]);
  Fight.prototype.spikesErupt.call(fightOn(1365, 4511), spiked);
  assert.equal(hits.length, 1);
  assert.ok(hits[0] >= 6 && hits[0] <= 16, `${hits[0]}`);
  Fight.prototype.spikesErupt.call(fightOn(1365, 4513), spiked);
  assert.equal(hits.length, 1, "stepped off: no damage");
});

test("her next attack comes 9 ticks after Icicle Crash and 7 after Unstable Ice", (t) => {
  const launch = UnstableIce.launch;
  t.after(() => { UnstableIce.launch = launch; });
  UnstableIce.launch = () => {};
  const delays = [];
  const fight = {
    attacks: 3, nextSpecial: "icicle", rollAttacksBeforeSpecial: () => 2,
    onPath: () => false, playerTile: () => [1365, 4511], icicleCrash() {},
    boss: { getCombat: () => ({ setAttackDelay: (ticks) => delays.push(ticks) }) },
  };
  assert.deepEqual(Fight.prototype.special.call(fight), []);
  Fight.prototype.special.call(fight);
  assert.deepEqual(delays, [9, 7]);
});

test("each tick on an icy pool hurts with the pool's sound", () => {
  const hits = [], sounds = [];
  const fight = {
    pools: new Map([[key(1365, 4511), {}]]), playerTile: () => [1365, 4511],
    player: { getHitpoints: () => 99, getPacketSender: () => ({ sendSoundEffect: (id) => sounds.push(id) }) },
    hurtPlayer: (damage) => hits.push(damage),
  };
  Fight.prototype.poolDamage.call(fight);
  assert.equal(hits.length, 1);
  assert.ok(hits[0] >= 6 && hits[0] <= 10);
  assert.deepEqual(sounds, [4464]);
  fight.playerTile = () => [1366, 4511];
  Fight.prototype.poolDamage.call(fight);
  assert.deepEqual(sounds, [4464], "off the pool: nothing");
});

test("the quest's guardian is just there: no rise and no line", (t) => {
  const api = Common.api;
  t.after(() => Common.init(api));
  const shown = [];
  Common.init({ ...api, emitCustomEvent: (name) => shown.push(name) });
  const seen = [];
  const fight = {
    session: { quest: true }, core: { Animation: TestAnimation, ChatType },
    player: { getPacketSender: () => ({ sendTypedMessage: () => seen.push("message") }) },
    boss: {
      performAnimation: () => seen.push("anim"), forceChat: () => seen.push("say"),
      getHitpoints: () => 400, getMaxHitpoints: () => 400, getId: () => 13686,
      getCombat: () => ({ attack() {}, setAttackDelay: (ticks) => seen.push(["delay", ticks]) }),
    },
  };
  Fight.prototype.start.call(fight);
  assert.deepEqual(seen, [["delay", 4]]);
  assert.deepEqual(shown, ["boss-hud:show"]);
  assert.equal(Common.data.spawn.questAfterArrivalTicks, 2);
});

test("the quest's guardian banishes at 0 HP instead of dying", (t) => {
  const api = Common.api;
  const tasks = [];
  const taskManager = { submit(task) { task.setRunning(true); tasks.push(task); } };
  const log = [];
  class TestGraphic { constructor(id) { this.id = id; } }
  Common.init({
    ...api,
    core: { ...Common.core, Task, TaskManager: taskManager, Animation: TestAnimation, Graphic: TestGraphic, Projectile: TestProjectile, ChatType },
    emitCustomEvent: (name, payload) => log.push([name, payload.player === player]),
  });
  t.after(() => Common.init(api));
  let beforeDeath, death;
  require("../plugins/bosses/amoxliatl/Kills.Amoxliatl")({
    persistAttribute() {}, onNpcBeforeDeath(handler) { beforeDeath = handler; }, onNpcDeath(handler) { death = handler; },
    onCustomEvent() {}, onPlayerLogin() {},
  });
  let tick = 0;
  const at = (what) => log.push([tick, what]);
  const combat = (who) => ({ reset: () => at(`${who} combat reset`), getHitQueue: () => ({ clear() {} }) });
  const player = {
    isRegistered: () => true, getLocation: () => new Location(1365, 4511, 0), getCombat: () => combat("player"),
    getMovementQueue() {
      const queue = { reset: () => queue, setBlockMovement: (blocked) => { at(`held ${blocked}`); return queue; }, getBlockMovementGeneration: () => 1 };
      return queue;
    },
    performAnimation: (a) => at(`player anim ${a.id}`), performGraphic: (g) => at(`player spot ${g.id}`),
    getPacketSender: () => ({
      sendTypedMessage: (type, text, from) => at(`${type} ${from}|${text}`),
      sendSoundEffect: (id) => at(`sound ${id}`),
    }),
  };
  const boss = {
    getLocation: () => new Location(1362, 4510, 0), getCombat: () => combat("boss"), getDefinition: () => ({ getName: () => "Amoxliatl" }),
    setHitpointsLocked: (locked) => at(`locked ${locked}`), setNpcTransformationId: (id) => at(`becomes ${id}`),
    setPositionToFace() {}, performAnimation: (a) => at(`boss anim ${a.id}`), forceChat: (text) => at(`says ${text}`),
  };
  const session = { quest: true, ended: false, area: null, end() { this.ended = true; at("chamber ends"); } };
  const fight = { session, player, boss, over: false, died() { this.over = true; at("ice goes"); }, hideHud: () => at("hud hidden") };
  boss.__amoxliatlFight = fight;
  const event = { npc: boss, preventDeath: false };
  beforeDeath(event);
  assert.equal(event.preventDeath, true);
  const again = { npc: boss, preventDeath: false };
  beforeDeath(again);
  assert.equal(again.preventDeath, true, "still not dying");
  death({ npc: boss });
  for (tick = 1; tick <= 6; tick++) tasks.forEach((task) => task.isRunning() && task.tick());
  assert.deepEqual(log, [
    [0, "held true"], ["amoxliatl:quest-won", true],
    [0, "ice goes"], [0, "locked true"], [0, "boss combat reset"], [0, "player combat reset"], [0, "becomes 13687"],
    [0, "boss anim 11531"], [0, "says Zema ami miki!"], [0, `${ChatType.NPC_SAY} Amoxliatl|Zema ami miki!`],
    [3, "player anim 4018"], [3, "player spot 2754"], [3, "boss anim 11532"],
    [4, "sound 7928"], [4, "hud hidden"],
    [6, "chamber ends"], ["amoxliatl:quest-defeated", true],
  ]);
  assert.equal(session.banished, true);
});

test('Echo completes once without normal kill, best-time, achievement or respawn credit', () => {
  let death;
  require('../plugins/bosses/amoxliatl/Kills.Amoxliatl')({
    persistAttribute() {}, onNpcBeforeDeath() {}, onNpcDeath(handler) { death = handler; },
    onCustomEvent() {}, onPlayerLogin() {},
  });
  Common.init({core:{ Projectile:{centreOf:()=>({x:1,y:2,z:0})} },emitCustomEvent:(name,payload)=>emitted.push({name,payload})});
  emitted.length=0;
  const session={echoToken:'echo-amox'};
  const fight={stopped:false,player:{},session,hideHud(){},stop(){this.stopped=true;}};
  const npc={__amoxliatlFight:fight};
  death({npc}); death({npc});
  assert.equal(emitted.length,1);
  assert.equal(emitted[0].name,'echo-boss:completed');
  assert.equal(emitted[0].payload.token,'echo-amox');
  assert.deepEqual(emitted[0].payload.npcs,[npc]);
  assert.equal(session.echoCompleted,true);
});
