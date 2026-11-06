// Run directly: node --test tests/tempoross-animations.test.cjs
const assert = require("node:assert/strict");
const { test, after } = require("node:test");

const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const { Fight } = require("../plugins/minigames/tempoross/Fight.Tempoross");

const realAnimate = Shared.animate;
const realLater = Shared.later;
let animations = [];
let scheduled = [];

after(() => {
  Shared.animate = realAnimate;
  Shared.later = realLater;
});

function fakeFight({ first = false, submerges = 1, enraged = false } = {}) {
  const fight = Object.create(Fight.prototype);
  fight.boss = {
    setNpcTransformationId(id) {
      fight.bossId = id;
    },
  };
  fight.bossId = null;
  fight.cove = { message() {}, forEachPlayer() {}, players: new Set() };
  fight.spots = { onSurface() {} };
  fight.attacks = { onSurface() {} };
  fight.hosts = [];
  fight.phase = "submerged";
  fight.ticks = 10;
  fight.submerges = submerges;
  fight.enraged = enraged;
  fight.stopped = false;
  fight.maxEnergy = 2683;
  fight.storm = 50;
  fight.firstSurfaceTick = -1;
  animations = [];
  scheduled = [];
  Shared.animate = (_entity, id) => animations.push(id);
  Shared.later = (_key, _ticks, action) => {
    scheduled.push(action);
    return { stop() {} };
  };
  return fight;
}

test("the first rise plays fsb_spawn (8897)", () => {
  const fight = fakeFight();
  fight.surface(true);
  assert.equal(fight.bossId, 10572);
  assert.deepEqual(animations, [Shared.ANIM.BOSS_SPAWN]);
});

test("rising after a submerge plays fsb_whirl_to_ready (8901)", () => {
  const fight = fakeFight({ submerges: 1 });
  fight.surface(false);
  assert.equal(fight.bossId, 10572);
  assert.deepEqual(animations, [8901]);
});

test("the first enrage plays 8906, then 10575 with 8908 five ticks later", () => {
  const fight = fakeFight({ submerges: 3 });
  fight.surface(false);
  assert.equal(fight.bossId, 10572);
  assert.deepEqual(animations, [8906]);
  assert.equal(scheduled.length, 1);

  scheduled[0]();
  assert.equal(fight.bossId, 10575);
  assert.deepEqual(animations, [8906, 8908]);
});

test("later enraged surfacings are 10575 with 8908 directly", () => {
  const fight = fakeFight({ submerges: 4 });
  fight.surface(false);
  assert.equal(fight.bossId, 10575);
  assert.deepEqual(animations, [8908]);
  assert.equal(scheduled.length, 0);
});

const { scaled } = require("../plugins/minigames/tempoross/Fight.Tempoross");
const DATA = require("../plugins/minigames/data/tempoross.json");

// Issue #2455: the Wiki/Mod Squid approximation is a per-player contribution falling
// linearly from the solo value to the 40-player value; the total is that times the crew.
test("energy and essence scale per player from the solo capture to 40 players", () => {
  assert.equal(scaled(DATA.fight.energyPerPlayer, 1), 2683);
  assert.equal(scaled(DATA.fight.essencePerPlayer, 1), 2492);
  assert.equal(scaled(DATA.fight.energyPerPlayer, 40), 40 * 1800);
  assert.equal(scaled(DATA.fight.essencePerPlayer, 40), 40 * 1700);
});

test("the per-player contribution falls linearly between those ends", () => {
  const each = (spec, n) => spec.solo + ((spec.full - spec.solo) * (n - 1)) / (DATA.lobby.maxPlayers - 1);
  for (const n of [2, 10, 20, 39]) {
    assert.equal(scaled(DATA.fight.energyPerPlayer, n), Math.round(each(DATA.fight.energyPerPlayer, n) * n));
    assert.equal(scaled(DATA.fight.essencePerPlayer, n), Math.round(each(DATA.fight.essencePerPlayer, n) * n));
  }
});

const { Attacks } = require("../plugins/minigames/tempoross/Attacks.Tempoross");

function fireAttacksAt(tiles) {
  const players = tiles.map(([x, y]) => {
    const messages = [];
    return {
      messages,
      getLocation: () => ({ getX: () => x, getY: () => y }),
      sendMessage: (text) => messages.push(text),
      getInventory: () => ({
        contains: (id) => id === Shared.ITEM.RAW,
        getAmount: () => 3,
        delete() {},
        refreshItems() {},
      }),
    };
  });
  const fight = {
    ticks: 0,
    stopped: false,
    players: new Set(players),
    forEachPlayer(action) { players.forEach(action); },
  };
  const attacks = new Attacks(fight);
  attacks.cove = { templateTile: (location) => [location.getX(), location.getY(), 0] };
  attacks.fires.set("10,10", { npc: {}, loc: {}, x: 10, y: 10, spreadAt: 999 });
  return { attacks, players };
}

// Issue #2730: a fire stopped after two spreads because the child inherited the parent's
// incremented depth counter, so a chain was only three fires deep. The Wiki has fires spreading
// until they are doused or a wave puts them out, and the maintainers ruled the Wiki wins over the
// capture that saw two. Each fire now spreads on its own 40-tick timer with no depth cap.
test("a fire keeps spreading on its timer instead of stopping after two", () => {
  const fight = { ticks: 0, stopped: false, players: new Set(), forEachPlayer() {} };
  const attacks = new Attacks(fight);
  attacks.cove = { tile: () => ({}), projectile() {}, areaSound() {} };
  // The spread lands 2 ticks later through the fight's task queue; run it inline.
  attacks.at = (_ticks, action) => action();
  const lit = [];
  attacks.ignite = (tile) => lit.push(tile);
  attacks.burnable = () => true;
  // `spreads` is what the old code capped on; it is carried here so this test fails against it.
  attacks.fires.set("10,10", { npc: {}, loc: {}, x: 10, y: 10, spreads: 0, spreadAt: 0 });

  for (let tick = 0; tick <= DATA.fight.fireSpreadTicks * 5; tick++) {
    fight.ticks = tick;
    attacks.tickFires();
  }

  assert.ok(lit.length > 2, `spread ${lit.length} times; the old cap stopped it at two`);
});

// Issue #2455: damage was tied to the fight's tick parity, so a fire lit on an odd tick
// could wait 3 ticks for its first hit. Every player in the fire must take the pulse.
test("fire damage pulses every 2 ticks and hits everyone standing in it", () => {
  const { attacks, players } = fireAttacksAt([[10, 10], [11, 11]]);
  // A fire lit between the fight's even ticks: old code waited for tick 2 and hit once in
  // ticks 1-3; the fire-relative pulse hits on 1 and 3.
  for (let tick = 1; tick <= 3; tick++) {
    attacks.fight.ticks = tick;
    attacks.tickFires();
  }
  assert.equal(players[0].messages.length, 2, "ticks 1 and 3");
  assert.equal(players[1].messages.length, 2, "the second player in the same 2x2 fire");
  assert.match(players[0].messages[0], /You lose .* to the fire\./);
});

const { Cove } = require("../plugins/minigames/tempoross/Cove.Tempoross");
const { attachAttacks } = require("../plugins/minigames/tempoross/Attacks.Tempoross");
const { attachCannons } = require("../plugins/minigames/tempoross/Cannons.Tempoross");

function actionPlayer() {
  const tasks = [];
  Shared.bind({ core: {
    Animation: class {},
    Task: class { stop() {} },
    TaskManager: { submit: (task) => tasks.push(task) },
  } });
  const cove = Object.create(Cove.prototype);
  cove.players = new Set();
  cove.crew = 0;
  cove.area = { enter() {} };
  cove.tile = (tile) => tile;
  const sender = { sendVarbit() {}, sendSound() { return sender; } };
  const location = { equals: () => true };
  let used = 0;
  let route = null;
  const inventory = {
    contains: () => true,
    getItems: () => [{ getId: () => Shared.ITEM.RAW }],
    delete() { used++; }, adds() {}, refreshItems() {},
  };
  const player = {
    moveTo() {}, setAttribute() {}, getPacketSender: () => sender,
    getLocation: () => location, isRegistered: () => true,
    performAnimation() {}, setPositionToFace() {}, sendMessage() {}, getInventory: () => inventory,
    getMovementQueue: () => ({ walkToEntity(npc, action, ...options) { route = { npc, action, options }; } }),
  };
  cove.arrive(player, 0);
  cove.fight = { tethers: { untether() {} } };
  return { player, cove, tasks, used: () => used, route: () => route };
}

test("Douse combat option waits for reaching the fire and rechecks it on arrival", () => {
  const fixture = actionPlayer();
  const { player, cove } = fixture;
  let fire = {};
  let points = 0;
  cove.fight.attacks = { fireOf: () => fire, extinguish() { fire = null; } };
  cove.fight.addPoints = () => points++;
  const npc = {
    __temporossCove: cove, getId: () => Shared.NPC.FIRE,
    getCurrentDefinition: () => ({ getActions: () => ["Douse"] }),
    getLocation: () => ({}),
  };
  let handler;
  attachAttacks({ onNpcInteraction() {}, onItemOnNpc() {}, onNpcAttackOption(hook) { handler = hook; } });
  const event = { player, npc, clickType: 1, handled: false };
  handler(event);
  assert.equal(event.handled, true);
  assert.equal(fixture.used(), 0, "distant click must not consume water");
  assert.equal(points, 0);
  assert.equal(fixture.route().npc, npc);
  assert.deepEqual(fixture.route().options, [1, false, true]);
  fixture.route().action();
  assert.equal(fixture.used(), 1);
  assert.equal(points, 1);
  fixture.route().action();
  assert.equal(fixture.used(), 1, "a fire removed while approaching cannot be doused again");
});

test("restarting Fill retains the new cannon marker for torrent targeting", () => {
  const { player, cove } = actionPlayer();
  const crate = {};
  cove.fight.cannons = { crateOf: () => crate, disabled: () => false };
  const npc = { __temporossCove: cove, getLocation: () => ({}) };
  let fill;
  attachCannons({ onNpcInteraction(_name, hooks) { fill = hooks.Fill; } });
  fill({ player, npc });
  assert.equal(player.__temporossLoading, crate);
  fill({ player, npc });
  assert.equal(Shared.actionOf(player), "load");
  assert.equal(player.__temporossLoading, crate);
  Shared.stopAction(player);
  assert.equal(player.__temporossLoading, null);
});

const { attachSupplies } = require("../plugins/minigames/tempoross/Supplies.Tempoross");
const { Cannons } = require("../plugins/minigames/tempoross/Cannons.Tempoross");

// Issue #2692: the pump turned every bucket into water on one tick. Captures 552 and 1858
// fill one a tick, each with its own animation, sound and message.
test("the water pump fills one bucket a tick until none are empty", () => {
  const { player, tasks } = actionPlayer();
  const counts = { [Shared.ITEM.BUCKET]: 3, [Shared.ITEM.BUCKET_OF_WATER]: 0 };
  const messages = [];
  let sounds = 0;
  const sender = { sendSound() { sounds++; return sender; }, sendVarbit() {} };
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  player.getInventory = () => ({
    getAmount: (id) => counts[id] ?? 0,
    delete: (id, n) => { counts[id] -= n; },
    adds: (id, n) => { counts[id] += n; },
    refreshItems() {},
  });
  let pump;
  attachSupplies({ onObjectInteraction(name, hooks) { if (name === "Water pump") pump = hooks["Fill-bucket"]; } });
  pump({ player, object: { getLocation: () => ({ getX: () => 0, getY: () => 0 }) } });
  assert.equal(counts[Shared.ITEM.BUCKET], 3, "nothing fills on the click itself");

  const task = tasks[tasks.length - 1];
  for (let tick = 1; tick <= 3; tick++) {
    task.execute();
    assert.equal(counts[Shared.ITEM.BUCKET_OF_WATER], tick);
    assert.equal(messages.length, tick);
    assert.equal(sounds, tick);
  }
  assert.deepEqual(messages, Array(3).fill("You fill the bucket with water."));
  task.execute();
  assert.equal(Shared.actionOf(player), null, "the action ends once no bucket is left");
});

// Issue #2692: Tempoross submerging before the wave landed skipped the hit and left the
// overlay up until the next wave.
test("a wave cut short by a submerge still closes its overlay", () => {
  const scripts = [];
  const player = { getPacketSender: () => ({ sendClientScript: (id, ...args) => scripts.push([id, ...args]) }) };
  const fight = { phase: "submerged", players: new Set([player]), forEachPlayer(action) { action(player); } };
  const attacks = new Attacks(fight);
  attacks.waveHits();
  assert.deepEqual(scripts, [[Shared.SCRIPT.WAVE_HIDE, DATA.fight.waveOverlayHide]]);
  assert.equal(attacks.waves, 0, "no wave landed");
});

// Issue #2692: the torrent held a loader for the cannon's 24-tick disable, long after the
// stars stopped circling their head.
test("a torrent stuns its loader with the stars, only as long as they last", () => {
  const realLaterNow = Shared.later;
  const timers = [];
  Shared.later = (_key, ticks, action) => {
    const timer = { ticks, action, stop() {} };
    timers.push(timer);
    return timer;
  };
  try {
    const { player } = actionPlayer();
    const core = Shared.core();
    Shared.bind({ core: { ...core, Graphic: class { constructor(id, delay = 0, height = 0) { this.id = id; this.height = height; } } } });
    const graphics = [];
    let blocked = false;
    player.performGraphic = (graphic) => graphics.push(graphic);
    player.getMovementQueue = () => ({ reset() {}, setBlockMovement(value) { blocked = value; } });
    const crate = { data: { cannon: 41241 }, cannonLoc: {} };
    const cannons = Object.create(Cannons.prototype);
    cannons.crates = [crate];
    cannons.cove = { replaceLoc: () => ({}) };
    cannons.fight = { ticks: 0, players: new Set([player]) };
    Shared.startAction(player, "load", () => true);
    player.__temporossLoading = crate;
    cannons.disable(crate);
    assert.equal(blocked, true);
    assert.deepEqual(graphics.map((graphic) => graphic.id), [Shared.GFX.STUNNED]);
    assert.equal(graphics[0].height, 124, "stars at head height, like every other stunned_thieving");
    assert.equal(Shared.GFX.STUNNED, 245, "stunned_thieving, the circling stars");
    const release = timers.find((timer) => timer.ticks === DATA.fight.torrentStunTicks);
    assert.ok(release, "released after the stars' ticks");
    assert.ok(DATA.fight.torrentStunTicks < DATA.fight.torrentDisabledTicks);
    release.action();
    assert.equal(blocked, false);
  } finally {
    Shared.later = realLaterNow;
  }
});
