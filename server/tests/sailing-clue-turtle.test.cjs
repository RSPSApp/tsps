// Run after `yarn build`: node --test tests/sailing-clue-turtle.test.cjs
// The clue turtle ocean encounter (Wiki: Clue turtle, Ocean encounters; rsprox for the Retrieve
// packets): the encounter timer, the tier by Sailing level, the spawn ahead of the bow, Retrieve's
// timeline and its refusals.
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const turtle = require("../plugins/skills/sailing/ClueTurtle.Sailing");

const STOPPED = 0;
const FULL = 2;
const PICK_UP_AND_WAVE = 13078;
const DIVE = 13552;
const ITEMS = { CLUE_SCROLL_EASY_: 2677, CLUE_SCROLL_MEDIUM_: 2801, SCROLL_BOX_MEDIUM_: 24363 };

class Location {
  constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
}

/** A task manager stepped one tick at a time. */
function scheduler() {
  const tasks = [];
  class Task {
    constructor(delay = 1) { this.delay = typeof delay === "number" ? delay : 1; this.left = this.delay; this.running = true; }
    stop() { this.running = false; }
    isRunning() { return this.running; }
  }
  const TaskManager = { submit: (task) => tasks.push(task) };
  function runTick() {
    for (const task of [...tasks]) {
      if (!task.running) continue;
      if (--task.left > 0) continue;
      task.left = task.delay;
      task.execute();
    }
    for (let i = tasks.length - 1; i >= 0; i--) if (!tasks[i].running) tasks.splice(i, 1);
  }
  return { Task, TaskManager, runTick, tasks };
}

/** A boat lying with its single deck tile at (100, 100), facing `angle`. */
function boatAt(owner, { angle = 0, moveMode = FULL, hotspotData = [] } = {}) {
  return {
    angle, moveMode, level: 0, static: false, ownerPlayerId: owner.index, tileX: 100, tileY: 100,
    deckBaseX: 0, deckBaseY: 0, owned: { hotspotData },
    deckTileToWorld: () => ({ x: 100, y: 100 }),
  };
}

let world;
function setup({ sailable = () => true } = {}) {
  const clock = scheduler();
  const events = [];
  const spawned = [];
  const removed = [];
  const players = new Map();
  const boats = [];
  const handlers = {};
  const capacity = { allowed: null, box: false };
  const core = {
    ...clock,
    Location,
    Animation: class { constructor(id) { this.id = id; } getId() { return this.id; } },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
    ItemIdentifiers: ITEMS,
    Skill: { SAILING: "SAILING" },
    BoatMoveMode: { Stopped: STOPPED },
    PlayerRights: { DEVELOPER: "dev" },
    DialogueChainBuilder: class { add(entry) { this.entry = entry; return this; } },
    ItemStatementDialogue: class { constructor(index, itemId, text) { this.itemId = itemId; this.text = text; } },
    PathFinder: { calculateWalkRoute: (player, x, y) => { player.route = { x, y }; } },
    World: {
      getPlayers: () => ({ get: (index) => players.get(index) }),
      getRemoveNPCQueue: () => ({ push: (npc) => { npc.registered = false; removed.push(npc); } }),
    },
    BoatManager: {
      all: () => boats,
      isSailable: (x, y) => sailable(x, y),
      getSpec: () => ({ walkableDeck: [{ x: 0, y: 0 }] }),
      getBoatAboard: (player) => player.boat,
      rootLocation: () => new Location(100, 100, 0),
      deckTileToward: () => undefined,
    },
    Sailing: {
      instanceAboard: (player) => player.boat,
      activeBoat: (player) => player.boat?.owned,
    },
  };
  const api = {
    core,
    spawnNpc: (definition) => {
      const npc = fakeNpc(definition.x, definition.y);
      spawned.push(npc);
      return npc;
    },
    emitCustomEvent: (name, payload) => {
      events.push([name, payload]);
      if (name === "treasure-trails:can-receive") payload.allowed = capacity.allowed;
      if (name === "treasure-trails:clue-item" && capacity.box) payload.itemId = ITEMS.SCROLL_BOX_MEDIUM_;
    },
    onServerStartup: (fn) => { handlers.startup = fn; },
    onNpcRoute: (fn) => { handlers.route = fn; },
    onAnyNpcInteraction: (actions) => { handlers.retrieve = actions.Retrieve; },
    onCustomEvent: (name, fn) => { handlers[name] = fn; },
    onPlayerLogout: (fn) => { handlers.logout = fn; },
    registerCommand: (name, fn) => { handlers[name] = fn; },
  };
  turtle.turtles.clear();
  turtle.register(api);
  world = { clock, events, spawned, removed, players, boats, handlers, capacity };
  return world;
}

function fakeNpc(x, y) {
  let location = new Location(x, y, 0);
  const npc = {
    registered: true, animations: [], steps: [],
    getId: () => turtle.CLUE_TURTLE,
    getLocation: () => location,
    getSize: () => 1,
    isRegistered: () => npc.registered,
    performAnimation: (animation) => npc.animations.push(animation.getId()),
    setScriptedMovement() {}, setFlag() {},
    getMovementQueue: () => ({
      reset() {},
      walkStep: (dx, dy) => { npc.steps.push([dx, dy]); location = new Location(location.x + dx, location.y + dy, 0); },
    }),
  };
  return npc;
}

let nextIndex = 1;
function sailor(level = 99) {
  const index = nextIndex++;
  const player = {
    index, messages: [], animations: [], items: [], xp: [], boxes: [], route: undefined,
    getIndex: () => index,
    getLocation: () => new Location(0, 0, 1),
    sendMessage: (text) => player.messages.push(text),
    setPositionToFace: (location) => { player.facing = location; },
    performAnimation: (animation) => player.animations.push(animation.getId()),
    getMovementQueue: () => ({ reset() {}, isMovings: () => false, size: () => 0 }),
    getSkillManager: () => ({
      getCurrentLevel: () => level,
      addExperiences: (skill, amount) => player.xp.push([skill, amount]),
    }),
    getInventory: () => ({ forceAdd: (_player, item) => player.items.push(item.id) }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.boxes.push(chain.entry) }),
  };
  world.players.set(index, player);
  return player;
}

beforeEach(() => setup());

test("the tier follows the Wiki's table by Sailing level", () => {
  assert.equal(turtle.rollTier(4, () => 0), null);
  assert.equal(turtle.rollTier(5, () => 0.99), "easy");
  assert.equal(turtle.rollTier(29, () => 0.99), "easy");
  // 30-49: easy 8/20, medium 12/20.
  assert.equal(turtle.rollTier(30, () => 0.39), "easy");
  assert.equal(turtle.rollTier(30, () => 0.41), "medium");
  // 50-69: easy 9, medium 6, hard 5 of 20.
  assert.equal(turtle.rollTier(50, () => 0.44), "easy");
  assert.equal(turtle.rollTier(50, () => 0.74), "medium");
  assert.equal(turtle.rollTier(69, () => 0.76), "hard");
  // 70+: easy 9, medium 6, hard 3, elite 2 of 20.
  assert.equal(turtle.rollTier(70, () => 0.89), "hard");
  assert.equal(turtle.rollTier(99, () => 0.91), "elite");
});

test("the clue turtle is about 2.5% of ocean encounters", () => {
  const total = turtle.ENCOUNTERS.reduce((sum, encounter) => sum + encounter.share, 0);
  let below = 0;
  for (const encounter of turtle.ENCOUNTERS) {
    if (encounter.key === "clue_turtle") {
      assert.equal(turtle.rollEncounter(() => (below + 0.1) / total), "clue_turtle");
      assert.equal(turtle.rollEncounter(() => (below + encounter.share - 0.1) / total), "clue_turtle");
    }
    below += encounter.share;
  }
  assert.equal(turtle.ENCOUNTERS.find((encounter) => encounter.key === "clue_turtle").share, 2.5);
});

test("the timer rolls k/6 every interval, sure after six tries", () => {
  const timer = { ticks: 120, failures: 0 };
  for (let i = 0; i < 119; i++) assert.equal(turtle.countDown(timer, 120, () => 0), false);
  // A 5/6 roll fails the first try (1/6), and the timer starts over.
  assert.equal(turtle.countDown(timer, 120, () => 0.5), false);
  assert.deepEqual(timer, { ticks: 120, failures: 1 });
  // A 0.99 roll passes only k/6 = 6/6: tries two to five fail, the sixth spawns.
  const interval = () => { for (let i = 0; i < 119; i++) turtle.countDown(timer, 120, () => 0.99); return turtle.countDown(timer, 120, () => 0.99); };
  const results = Array.from({ length: 5 }, interval);
  assert.deepEqual(results, [false, false, false, false, true]);
  assert.deepEqual(timer, { ticks: 120, failures: 0 });
  // A shorter interval (kraken ink stout) takes effect at once.
  timer.ticks = 120;
  for (let i = 0; i < 114; i++) turtle.countDown(timer, 115, () => 0.99);
  assert.equal(timer.ticks, 1);
});

test("a moving boat's owner gets a turtle ahead of the bow; a still boat's timer pauses", () => {
  const player = sailor();
  const boat = boatAt(player, { angle: 1536 }); // east
  player.boat = boat;
  world.boats.push(boat);
  // 0.97 of the list's total is the clue turtle's share; as a k/6 roll it only passes the sixth try.
  const random = () => 0.97;
  boat.moveMode = STOPPED;
  for (let i = 0; i < 200; i++) turtle.onTick(random);
  assert.equal(world.spawned.length, 0);
  boat.moveMode = FULL;
  for (let i = 0; i < 120 * 5; i++) turtle.onTick(random);
  assert.equal(world.spawned.length, 0);
  for (let i = 0; i < 119; i++) turtle.onTick(random);
  assert.equal(world.spawned.length, 0);
  turtle.onTick(random);
  assert.equal(world.spawned.length, 1, "sure on the sixth try");
  const at = world.spawned[0].getLocation();
  assert.ok(at.getX() >= 100 + 22 - 1 && at.getX() <= 100 + 28 + 1, `x ${at.getX()}`);
  assert.ok(Math.abs(at.getY() - 100) <= 4, `y ${at.getY()}`);
});

test("the turtle is gone after a minute", () => {
  const player = sailor();
  player.boat = boatAt(player);
  world.handlers.clueturtle({ player });
  assert.equal(world.spawned.length, 1);
  for (let i = 0; i < 99; i++) turtle.onTick(() => 0.99);
  assert.equal(world.removed.length, 0);
  turtle.onTick(() => 0.99);
  assert.deepEqual(world.removed, world.spawned);
});

test("no turtle below level 5", () => {
  const player = sailor(4);
  const boat = boatAt(player);
  player.boat = boat;
  world.boats.push(boat);
  for (let i = 0; i < 120 * 6; i++) turtle.onTick(() => 0.97);
  assert.equal(world.spawned.length, 0);
});

test("disembarking gives 20 ticks back, up to the full timer", () => {
  const player = sailor();
  turtle.timers.set(player, { ticks: 50, failures: 2 });
  world.handlers["sailing:left"]({ player, reason: "disembark" });
  assert.equal(turtle.timers.get(player).ticks, 70);
  turtle.timers.get(player).ticks = 110;
  world.handlers["sailing:left"]({ player, reason: "disembark" });
  assert.equal(turtle.timers.get(player).ticks, 120);
  world.handlers.logout({ player });
  assert.equal(turtle.timers.has(player), false);
});

function spawnFor(player, x = 104, y = 100) {
  const npc = fakeNpc(x, y);
  turtle.turtles.set(npc, { owner: player, expiresAt: Infinity, retrieving: false });
  return npc;
}

test("Retrieve: the turtle swims in, the wave and dive, then the clue, XP and box", () => {
  const player = sailor(40);
  player.boat = boatAt(player);
  const npc = spawnFor(player);
  const route = { npc, range: 1 };
  world.handlers.route(route);
  assert.equal(route.range, 8);
  const original = Math.random;
  Math.random = () => 0.9; // medium at 30-49
  try {
    const event = { player, npc, handled: false };
    assert.equal(world.handlers.retrieve(event), true);
    assert.equal(event.handled, true);
  } finally {
    Math.random = original;
  }
  assert.ok(world.events.some(([name]) => name === "sailing:leave-helm"));
  for (let t = 1; t <= 3; t++) {
    world.clock.runTick();
    assert.equal(npc.steps.length, t);
  }
  assert.deepEqual(player.animations, [PICK_UP_AND_WAVE]);
  assert.deepEqual(npc.animations, [DIVE]);
  assert.deepEqual(player.items, []);
  world.clock.runTick();
  assert.deepEqual(player.items, [ITEMS.CLUE_SCROLL_MEDIUM_]);
  assert.deepEqual(player.xp, [["SAILING", 50]]);
  assert.equal(player.boxes[0].itemId, ITEMS.CLUE_SCROLL_MEDIUM_);
  assert.equal(player.boxes[0].text, "You find a bottle attached to the turtle. It has a medium clue scroll inside! "
    + "You take the bottle and the turtle dives away. You give it a wave goodbye!");
  assert.equal(world.removed.length, 0);
  world.clock.runTick();
  assert.deepEqual(world.removed, [npc]);
});

test("after X Marks the Spot the bottle holds a scroll box", () => {
  world.capacity.box = true;
  const player = sailor(99);
  player.boat = boatAt(player);
  const npc = spawnFor(player);
  world.handlers.retrieve({ player, npc, handled: false });
  for (let t = 0; t < 4; t++) world.clock.runTick();
  assert.deepEqual(player.items, [ITEMS.SCROLL_BOX_MEDIUM_]);
  assert.equal(player.boxes[0].itemId, ITEMS.SCROLL_BOX_MEDIUM_);
});

test("under the boat: the message, and nothing else", () => {
  const player = sailor();
  player.boat = boatAt(player);
  const npc = spawnFor(player, 100, 100);
  assert.equal(turtle.underTheBoat(player, npc), true);
  world.handlers.retrieve({ player, npc, handled: false });
  for (let t = 0; t < 6; t++) world.clock.runTick();
  assert.deepEqual(player.messages, ["You can't interact with something under the boat!"]);
  assert.deepEqual(player.items, []);
  assert.deepEqual(world.removed, []);
});

test("another player's turtle, or a tier at its limit, is refused", () => {
  const owner = sailor();
  const friend = sailor(30);
  friend.boat = boatAt(owner);
  const npc = spawnFor(owner);
  world.handlers.retrieve({ player: friend, npc, handled: false });
  assert.deepEqual(friend.messages, ["You can't take that clue scroll from this turtle."]);
  assert.ok(world.events.some(([name, payload]) => name === "treasure-trails:missed-clue" && payload.player === friend));

  world.capacity.allowed = false;
  owner.boat = boatAt(owner);
  world.handlers.retrieve({ player: owner, npc, handled: false });
  assert.deepEqual(owner.messages, ["You can't take that clue scroll from this turtle."]);
  for (let t = 0; t < 6; t++) world.clock.runTick();
  assert.deepEqual(owner.items, []);
  assert.deepEqual(owner.xp, []);
  assert.deepEqual(world.removed, []);
});

test("Retrieve walks to the deck tile nearest the turtle first", () => {
  const player = sailor();
  player.boat = boatAt(player);
  let location = new Location(0, 0, 1);
  player.getLocation = () => location;
  const npc = spawnFor(player);
  const core = require("../plugins/skills/sailing/seacombat/Common.SeaCombat").core();
  core.BoatManager.deckTileToward = () => new Location(1, 0, 1);
  world.handlers.retrieve({ player, npc, handled: false });
  assert.deepEqual(player.route, { x: 1, y: 0 });
  assert.equal(npc.steps.length, 0);
  location = new Location(1, 0, 1);
  world.clock.runTick(); // arrives
  for (let t = 1; t <= 3; t++) world.clock.runTick();
  assert.equal(npc.steps.length, 3);
});
