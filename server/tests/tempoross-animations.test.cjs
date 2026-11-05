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
  attacks.fires.set("10,10", { npc: {}, loc: {}, x: 10, y: 10, spreads: 2, spreadAt: 999 });
  return { attacks, players };
}

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
