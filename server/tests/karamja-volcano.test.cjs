// Run after `yarn build`: node --test tests/karamja-volcano.test.cjs
// The way down through the Karamja volcano to the TzHaar city and back, as rsprox captures show:
// the rocks lead into the volcano dungeon (not straight to the city), its cave entrance to the
// city, the city's exit back to the dungeon, and the rope up to the rocks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Karamja = require("../plugins/areas/Karamja.plugin");
const MorUiRek = require("../plugins/areas/MorUiRek.plugin");

let core;
const hooks = {};
const events = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = (plugin) => ({
    core,
    onObjectInteraction: (name, actions) => Object.entries(actions).forEach(([option, handler]) => (hooks[`${plugin}:${name}:${option}`] = handler)),
    onCustomEvent: (name, handler) => (hooks[`${plugin}:${name}`] = handler),
    onNpcDialogueCondition() {}, onItemOnNpc() {}, persistAttribute() {},
    emitCustomEvent: (name, payload) => events.push([name, payload]),
  });
  Karamja.register(api("Karamja"));
  MorUiRek.register(api("MorUiRek"));
});

function visitor(x, y) {
  let at = new core.Location(x, y, 0);
  return { getLocation: () => at, moveTo: (location) => (at = location), get at() { return [at.getX(), at.getY(), at.getZ()]; } };
}

const click = (hook, player, [x, y, z]) => {
  const event = { player, location: { x, y, z }, handled: false };
  hooks[hook](event);
  return event.handled;
};

test("the rocks lead into the volcano dungeon, below the side the player stands on", () => {
  const west = visitor(2855, 3168);
  assert.equal(click("Karamja:Rocks:Climb-down", west, [2856, 3168, 0]), true);
  assert.deepEqual(west.at, [2855, 9568, 0]);
  const east = visitor(2858, 3168);
  click("Karamja:Rocks:Climb-down", east, [2856, 3168, 0]);
  assert.deepEqual(east.at, [2858, 9568, 0]);
  assert.equal(click("Karamja:Rocks:Climb-down", visitor(3000, 3000), [3001, 3000, 0]), false, "other rocks aren't these");
});

test("the dungeon's cave entrance leads to the city, and the city's exit back beside it", () => {
  const player = visitor(2862, 9572);
  assert.equal(click("Karamja:Cave entrance:Enter", player, [2863, 9571, 0]), true);
  assert.deepEqual(player.at, [2480, 5175, 0]);
  assert.equal(click("MorUiRek:Cave exit:Enter", player, [2479, 5176, 0]), true);
  assert.deepEqual(player.at, [2862, 9572, 0]);
});

test("the rope only climbs up, beside the rocks on the side it's climbed from", () => {
  const player = visitor(2857, 9569);
  const rope = { getLocation: () => new core.Location(2856, 9569, 0) };
  const request = { player, object: rope, handled: false };
  hooks["Karamja:ladders:climb"](request);
  assert.equal(request.handled, true);
  const [name, payload] = events.pop();
  assert.equal(name, "ladders:climbUp");
  assert.deepEqual([payload.destination.getX(), payload.destination.getY(), payload.destination.getZ()], [2858, 3168, 0]);
});
