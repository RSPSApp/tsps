// Run after `yarn build`: node --test tests/double-door-sounds.test.cjs
// Double doors whose leaves live swings with nicedoor_open (81) / nicedoor_close (80):
// Arceuus as an area sound of range 1 on the clicked leaf's tile, the goblin outpost's inner
// doors as the opener's private synth. Other double doors keep the plain door pair (62/60).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { Sounds } = require("../dist/game/Sounds");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PlayerSession } = require("../dist/net/PlayerSession");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  require("../plugins/objects/Doors.plugin").register(PluginManager.createApi("Doors"));
});

function addPlayer(t, name, location) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername(name);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(location);
  player.needsPlacement = false;
  assert.ok(World.getPlayers().add(player));
  t.after(() => World.getPlayers().remove(player));
  return player;
}

function recordSounds(t) {
  const sent = [];
  t.mock.method(Sounds, "sendSound", (entity, sound) => sent.push({ kind: "synth", to: entity, id: sound.getId() }));
  t.mock.method(Sounds, "playAreaSound", (options) => sent.push({
    kind: "area", id: options.soundId, x: options.x, y: options.y, radius: options.radius, loops: options.loops, delay: options.delay,
  }));
  return sent;
}

function operate(player, gameval, x, y) {
  const id = CacheDefinitions.getLocId(gameval);
  const object = MapObjects.get(id, new Location(x, y, 0), null);
  assert.ok(object, `${gameval} at ${x},${y}`);
  const option = object.getDefinition().getInteractions().findIndex((name) => name === "Open" || name === "Close");
  assert.ok(option >= 0);
  assert.ok(PluginManager.emitObjectInteraction({
    player, object, objectId: id, clickType: option + 1, location: { x, y, z: 0 },
  }));
}

function cleanUp(tiles) {
  for (const [x, y] of tiles) {
    for (const object of [...ObjectManager.objectsAt(new Location(x, y, 0))]) {
      if (!object.isMapOriginal?.()) ObjectManager.deregister(object, true);
    }
  }
}

// The door leaves on these tiles as [gameval, x, y, rotation].
function leaves(tiles) {
  const names = CacheDefinitions.getLocNames();
  const found = [];
  for (const [x, y] of tiles) {
    const location = new Location(x, y, 0);
    const live = ObjectManager.objectsAt(location).filter((object) => object.getType() === 0);
    const mapped = live.length ? live : [];
    for (const object of mapped) found.push([names.get(object.getId()), x, y, object.getFace()]);
  }
  return found;
}

const AREA = (id, x, y) => ({ kind: "area", id, x, y, radius: 1, loops: 1, delay: 0 });

test("Arceuus double doors play nicedoor open/close as an area sound on the clicked leaf", async (t) => {
  // local 1001998 ticks 1222-1223 and 1335-1336: Open on the right/left blue leaf, sound_area 81 range 1 on that leaf.
  await t.test("blue", (t) => {
    RegionManager.loadMapFiles(1718, 3727);
    const player = addPlayer(t, "arceuusblue", new Location(1717, 3727, 0));
    const sent = recordSounds(t);
    t.after(() => cleanUp([[1718, 3727], [1718, 3728]]));
    operate(player, "archeuus_door_double_right_blue", 1718, 3728);
    // Both leaves turn on their own tiles: right_open rotation 1, left_open rotation 3 (tick 1223).
    assert.deepEqual(leaves([[1718, 3727], [1718, 3728]]), [
      ["archeuus_door_double_left_blue_open", 1718, 3727, 3],
      ["archeuus_door_double_right_blue_open", 1718, 3728, 1],
    ]);
    operate(player, "archeuus_door_double_right_blue_open", 1718, 3728);
    assert.deepEqual(leaves([[1718, 3727], [1718, 3728]]), [
      ["archeuus_door_double_left_blue", 1718, 3727, 0],
      ["archeuus_door_double_right_blue", 1718, 3728, 0],
    ]);
    operate(player, "archeuus_door_double_left_blue", 1718, 3727);
    assert.deepEqual(sent, [AREA(81, 1718, 3728), AREA(80, 1718, 3728), AREA(81, 1718, 3727)]);
  });

  // local 1000453 ticks 9679-9681: Open on the left green leaf, left_open rotation 1, right_open rotation 3.
  await t.test("green", (t) => {
    RegionManager.loadMapFiles(1642, 3806);
    const player = addPlayer(t, "arceuusgreen", new Location(1643, 3806, 0));
    const sent = recordSounds(t);
    t.after(() => cleanUp([[1642, 3805], [1642, 3806]]));
    operate(player, "archeuus_door_double_left_green", 1642, 3806);
    assert.deepEqual(leaves([[1642, 3805], [1642, 3806]]), [
      ["archeuus_door_double_right_green_open", 1642, 3805, 3],
      ["archeuus_door_double_left_green_open", 1642, 3806, 1],
    ]);
    assert.deepEqual(sent, [AREA(81, 1642, 3806)]);
  });

  // rsprox 2297 ticks 448-457: the Library's turquoise doors, Close plays sound_area 80 range 1 on the clicked leaf.
  await t.test("turquoise", (t) => {
    RegionManager.loadMapFiles(1633, 3817);
    const player = addPlayer(t, "arceuusturq", new Location(1633, 3816, 0));
    const sent = recordSounds(t);
    t.after(() => cleanUp([[1632, 3817], [1633, 3817]]));
    operate(player, "archeuus_door_double_right_turquoise", 1633, 3817);
    // Tick 451: right_open rotation 2 on 1633, left_open rotation 0 on 1632.
    assert.deepEqual(leaves([[1632, 3817], [1633, 3817]]), [
      ["archeuus_door_double_left_turquoise_open", 1632, 3817, 0],
      ["archeuus_door_double_right_turquoise_open", 1633, 3817, 2],
    ]);
    operate(player, "archeuus_door_double_right_turquoise_open", 1633, 3817);
    assert.deepEqual(sent, [AREA(81, 1633, 3817), AREA(80, 1633, 3817)]);
  });
});

test("the goblin outpost's inner double doors send nicedoor open/close to the opener", (t) => {
  // local 1001339: Open 12446 at tick 301 -> synth 81 at 302; Close 12449 at 308 -> synth 80 at 309.
  RegionManager.loadMapFiles(2957, 3509);
  const player = addPlayer(t, "goblindoor", new Location(2957, 3508, 0));
  const sent = recordSounds(t);
  t.after(() => cleanUp([[2957, 3509], [2958, 3509], [2957, 3510], [2958, 3510]]));
  operate(player, "goblin_outpost_poordoor_double_inner", 2957, 3509);
  operate(player, "goblin_outpost_openpoordoor_doubler_inner", 2958, 3510);
  assert.deepEqual(sent.map(({ kind, to, id }) => ({ kind, to: to === player, id })), [
    { kind: "synth", to: true, id: 81 },
    { kind: "synth", to: true, id: 80 },
  ]);
});
