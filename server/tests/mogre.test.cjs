// Run after `yarn build`: node --test tests/mogre.test.cjs
// Mudskipper Point: a fishing explosive thrown at an Ominous Fishing Spot lures a Mogre out of
// the water (rsprox 464, 3299; docs/mogre.md).
const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";

require("../dist/Server").Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const plugin = require("../plugins/npcs/Mogre.plugin");

const EXPLOSIVE = 6664;
const SPOT = new Location(2982, 3113, 0);
const SPAM = 99;

let tasks;
let added;
let removed;
let state;
let handlers;
let waterTiles;

class Task {
  constructor(delay) { this.delay = delay; }
  stop() { this.stopped = true; }
}

class FakeProjectile {
  constructor(...args) { state.projectiles.push(args); }
  withAngle(angle) { state.projectileAngle = angle; return this; }
  withProgress(progress) { state.projectileProgress = progress; return this; }
  sendProjectile() { state.projectileSent = true; }
}

class FakeNpc {
  constructor(id, location) {
    this.id = id;
    this.location = location;
    this.registered = true;
  }
  setOwner(owner) { this.owner = owner; return this; }
  getOwner() { return this.owner; }
  isRegistered() { return this.registered; }
  isDyingFunction() { return false; }
  getCombat() { return { attack: (target) => { state.attacked = target; } }; }
  onAdd() {}
}

const core = {
  Location,
  Animation: class { constructor(id) { this.id = id; } },
  Graphic: class { constructor(id, delay, height) { Object.assign(this, { id, delay, height }); } },
  Projectile: FakeProjectile,
  NPC: FakeNpc,
  NpcIdentifiers: { MOGRE: 2592 },
  ChatType: { SPAM },
  ItemIdentifiers: { FISHING_EXPLOSIVE: 6660, FISHING_EXPLOSIVE_2: EXPLOSIVE },
  Task,
  TaskManager: { submit: (task) => tasks.push(task) },
  World: {
    getAddNPCQueue: () => ({ push: (npc) => added.push(npc) }),
    getRemoveNPCQueue: () => ({ push: (npc) => removed.push(npc) }),
  },
  RegionManager: { blocked: (tile) => waterTiles.some(([x, y]) => x === tile.getX() && y === tile.getY()) },
};

function makePlayer(x = 2986, y = 3108) {
  const sent = [];
  const owned = { explosives: 3 };
  const player = {
    sent,
    owned,
    location: new Location(x, y, 0),
    isRegistered: () => true,
    getHitpoints: () => 10,
    getLocation() { return this.location; },
    getPrivateArea: () => null,
    sendMessage: (text) => sent.push(["game", text]),
    forceChat: (text) => sent.push(["chat", text]),
    performAnimation: (animation) => sent.push(["animation", animation.id]),
    performGraphic: (graphic) => sent.push(["graphic", graphic.id, graphic.height]),
    getInventory: () => ({
      getAmount: () => owned.explosives,
      deleteNumber: (_id, amount) => { owned.explosives -= amount; },
    }),
    getPacketSender: () => ({
      sendTypedMessage: (type, text) => sent.push([type === SPAM ? "spam" : type, text]),
      sendSoundEffect: (id) => sent.push(["sound", id]),
      sendEntityHint: (npc) => sent.push(["hint", npc.id]),
      sendEntityHintRemoval: () => sent.push(["hint-removed"]),
    }),
  };
  return player;
}

function register(questComplete) {
  handlers = {};
  const api = {
    core,
    onServerStartup: (fn) => fn(),
    onItemOnObject: (item, object, fn) => { handlers.itemOnObject = { item, object, fn }; },
    onObjectInteraction: (object, options) => { handlers.options = { object, options }; },
    onObjectRoute: (fn) => { handlers.route = fn; },
    onNpcDeath: (fn) => { handlers.death = fn; },
    onPlayerLogout: (fn) => { handlers.logout = fn; },
    onPlayerDisconnect: () => {},
    emitCustomEvent: (name, request) => {
      assert.equal(name, "quest:is-complete");
      assert.equal(request.key, "skippy_and_the_mogres");
      request.complete = questComplete;
    },
  };
  plugin.register(api);
}

function throwAt(player) {
  return handlers.itemOnObject.fn({ player, itemId: EXPLOSIVE, object: { getLocation: () => SPOT } });
}

function runTasks(ticks) {
  const due = tasks.filter((task) => task.delay === ticks);
  tasks = tasks.filter((task) => task.delay !== ticks);
  due.forEach((task) => task.execute());
}

beforeEach(() => {
  tasks = [];
  added = [];
  removed = [];
  state = { projectiles: [] };
  // The spot's own tile and its neighbours to the north-west are water; land starts at x 2984.
  waterTiles = [];
  for (let x = 2975; x <= 2983; x++) for (let y = 3105; y <= 3120; y++) waterTiles.push([x, y]);
});

test("the item is the explosive on the ominous spot, and Lure and Bait only scare the fish", () => {
  register(true);
  assert.equal(handlers.itemOnObject.item, "Fishing explosive");
  assert.equal(handlers.itemOnObject.object, "Ominous Fishing Spot");
  const player = makePlayer();
  handlers.options.options.Lure({ player });
  handlers.options.options.Bait({ player });
  assert.deepEqual(player.sent, [
    ["game", "Something seems to have scared all the fishes away..."],
    ["game", "Something seems to have scared all the fishes away..."],
  ]);
});

test("before Skippy and the Mogres is finished the explosive is kept and refused", () => {
  register(false);
  const player = makePlayer();
  assert.equal(throwAt(player), true);
  assert.deepEqual(player.sent, [["game", "Sinister as that fishing spot is, why would I want to explode it?"]]);
  assert.equal(player.owned.explosives, 3);
  assert.equal(tasks.length, 0);
});

test("a throw uses one explosive, then a Mogre appears 5 ticks on and fights the thrower", () => {
  register(true);
  const player = makePlayer();
  throwAt(player);
  assert.equal(player.owned.explosives, 2);
  assert.deepEqual(player.sent, [
    ["animation", 929],
    ["graphic", 50, 96],
    ["sound", 2708],
    ["spam", "You hurl the shuddering vial into the water..."],
  ]);
  const [start, end, lockon, id, delay, speed, startHeight, endHeight] = state.projectiles[0];
  assert.equal(start, player.location);
  assert.deepEqual(end, SPOT);
  assert.equal(lockon, null);
  assert.deepEqual([id, delay, startHeight, endHeight], [49, 41, 163, 30]);
  assert.equal(speed, 41 + 5 * 5);
  assert.deepEqual([state.projectileAngle, state.projectileProgress, state.projectileSent], [15, 11, true]);

  runTasks(3);
  assert.deepEqual(player.sent.at(-1), ["sound", 1487]);
  assert.equal(added.length, 0);

  runTasks(5);
  assert.deepEqual(player.sent.slice(-2).map((entry) => entry[0]), ["spam", "hint"]);
  assert.equal(player.sent.at(-2)[1], "...and a Mogre appears!");
  assert.equal(added.length, 1);
  assert.equal(added[0].id, 2592);
  assert.equal(added[0].getOwner(), player);
  // The spot is water: the Mogre stands on the nearest free 2x2 of land instead.
  assert.deepEqual([added[0].location.getX(), added[0].location.getY()], [2984, 3111]);
  added[0].onAdd();
  assert.equal(state.attacked, player);
});

test("with a Mogre out, a second throw is refused and keeps the explosive", () => {
  register(true);
  const player = makePlayer();
  throwAt(player);
  runTasks(5);
  const before = player.owned.explosives;
  player.sent.length = 0;
  throwAt(player);
  assert.deepEqual(player.sent, [["game", "There is already one Mogre attacking you!"]]);
  assert.equal(player.owned.explosives, before);
});

test("a second throw while the first vial is in the air is swallowed", () => {
  register(true);
  const player = makePlayer();
  throwAt(player);
  throwAt(player);
  assert.equal(player.owned.explosives, 2);
});

test("a thrower within two squares of the spot warns themselves aloud", () => {
  register(true);
  const player = makePlayer(2984, 3112);
  throwAt(player);
  assert.deepEqual(player.sent[0], ["chat", "If this thing explodes, I think I should stand a liiiiittle further away..."]);
  const far = makePlayer(2990, 3108);
  throwAt(far);
  assert.equal(far.sent.some((entry) => entry[0] === "chat"), false);
});

test("the Mogre's death frees the thrower for another throw and clears the hint arrow", () => {
  register(true);
  const player = makePlayer();
  throwAt(player);
  runTasks(5);
  handlers.death({ npc: added[0], killer: player });
  assert.deepEqual(player.sent.at(-1), ["hint-removed"]);
  player.sent.length = 0;
  throwAt(player);
  assert.equal(player.sent[0][0], "animation");
});

test("logging out takes the Mogre away", () => {
  register(true);
  const player = makePlayer();
  throwAt(player);
  runTasks(5);
  handlers.logout({ player });
  assert.deepEqual(removed, [added[0]]);
});

test("the throw is made from where the player stands, within range of the spot only", () => {
  register(true);
  const spot = { getName: () => "Ominous Fishing Spot" };
  const near = { player: makePlayer(), object: { getLocation: () => SPOT }, definition: spot, destination: null };
  handlers.route(near);
  assert.deepEqual(near.destination, { x: 2986, y: 3108, z: 0 });
  const far = { player: makePlayer(3000, 3120), object: { getLocation: () => SPOT }, definition: spot, destination: null };
  handlers.route(far);
  assert.equal(far.destination, null);
  const other = { player: makePlayer(), object: { getLocation: () => SPOT }, definition: { getName: () => "Tree" }, destination: null };
  handlers.route(other);
  assert.equal(other.destination, null);
});
