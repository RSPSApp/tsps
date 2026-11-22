// Staircases are walked, not climbed. Live OSRS sends no animation for any staircase op, only the
// teleport, on the tick a ladder starts its climb animation (rsprox captures: Varrock castle's
// staircase in local 1001607 and rec 960, Falador's spiral staircases in local 1002048/1002089,
// and the Civitas, Keldagrim and Paterdomus staircases). The generic climb played the ladder's
// reach-up animation (828) on every staircase, and moved the player a tick later than live.
//
// Run after `yarn build`: node --test tests/staircase-climb-animation.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Location } = require("../dist/game/model/Location");

const VARROCK_CASTLE_STAIRCASE = 11798; // fai_varrock_woodenstairs_castle
const ARDOUGNE_LADDER = 17026; // ladder_directional, local 1001580 climbs it
const tasks = [];
let options;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  const plugin = require("../plugins/objects/Ladders.plugin");
  const noop = () => {};
  options = {};
  const api = new Proxy(
    {
      core: PluginManager.getCoreApi(),
      getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
      onObjectInteraction: (name, actions) => {
        options[name] = actions;
      },
      emitCustomEvent: noop,
    },
    { get: (target, key) => target[key] ?? noop },
  );
  plugin.register(api);
});

/** The first placed object with `match` within `radius` tiles of (x, y, z). */
function findObject(x, y, z, radius, match) {
  RegionManager.loadMapFiles(x, y);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const found = (MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? []).find(match);
      if (found) return found;
    }
  }
  return null;
}

function fakePlayer(location) {
  const state = { location, animations: [], moves: [] };
  const movement = {
    blocked: false,
    isMovementBlocked() { return this.blocked; },
    setBlockMovement(value) { this.blocked = value; return this; },
    reset() { return this; },
    didMovePreviousCycle: () => false,
  };
  state.player = {
    getLocation: () => state.location,
    getMovementQueue: () => movement,
    getHitpoints: () => 10,
    getPrivateArea: () => null,
    performAnimation: (animation) => state.animations.push(animation.getId?.() ?? animation.id ?? animation),
    moveTo: (target) => { state.moves.push(state.animations.length); state.location = target; },
  };
  return state;
}

/** Runs the op and its climb task to the end; returns the animations played and when it moved. */
function operate(object, option, from) {
  tasks.length = 0;
  const definition = ObjectDefinition.forId(object.getId());
  const state = fakePlayer(from);
  options[definition.getName()][option]({
    player: state.player, object, objectId: object.getId(), definition,
    location: object.getLocation(), clickType: 1,
  });
  assert.equal(tasks.length, 1, `${definition.getName()} ${option} starts a climb`);
  let cycles = 0;
  while (cycles < 5) {
    cycles++;
    tasks[0].execute();
    if (state.moves.length) break;
  }
  return { animations: state.animations, cycles, to: state.location };
}

test("a staircase moves the player up with no animation, on the first cycle", () => {
  const stairs = findObject(3266, 3455, 0, 6, (o) => o.getId() === VARROCK_CASTLE_STAIRCASE);
  assert.ok(stairs, "Varrock castle's staircase is placed");
  const from = new Location(stairs.getLocation().getX(), stairs.getLocation().getY() - 1, 0);
  const result = operate(stairs, "Climb-up", from);
  assert.deepEqual(result.animations, [], "no climb animation on a staircase");
  assert.equal(result.to.getZ(), 1, "lands on the floor above");
  assert.equal(result.cycles, 1, "moves on the tick a ladder would start climbing");
});

test("a ladder still plays the climb animation before moving", () => {
  const ladder = findObject(2655, 3322, 0, 1, (o) => o.getId() === ARDOUGNE_LADDER);
  assert.ok(ladder, "Ardougne's ladder is placed");
  const from = new Location(ladder.getLocation().getX(), ladder.getLocation().getY() + 1, 0);
  const result = operate(ladder, "Climb-up", from);
  assert.deepEqual(result.animations, [828], "the reach-for-ladder animation plays");
  assert.equal(result.cycles, 2, "the move follows the animation by a cycle");
});

test("callers can still force the animation either way", () => {
  const stairs = findObject(3266, 3455, 0, 6, (o) => o.getId() === VARROCK_CASTLE_STAIRCASE);
  tasks.length = 0;
  const state = fakePlayer(new Location(stairs.getLocation().getX(), stairs.getLocation().getY() - 1, 0));
  options.Staircase["Climb-up"]({
    player: state.player, object: stairs, objectId: stairs.getId(),
    definition: ObjectDefinition.forId(stairs.getId()), location: stairs.getLocation(), animate: true,
  });
  tasks[0].execute();
  tasks[0].execute();
  assert.deepEqual(state.animations, [828], "animate: true keeps the climb on a staircase");
});
