"use strict";

// Run after `yarn build`: node --test tests/fremennik-isle-door-sounds.test.cjs
//
// Fremennik Isles doors with their own open sound (docs/door-sounds.md). Neitiznot's palisade gate
// (fris_palisade_door_l/r at 2328,3805 / 2328,3804) opens onto fris_palisade_door_open_r/l on the
// tiles east with synth 36 (rsprox 229/02722 tick 75, 231/03027 ticks 6880, 7466, 8896, 10387);
// Jatizso's town wall door (frisd_town_wall_door at 2407,3806) opens onto frisd_town_wall_door_open
// on the tile north with synth 71 (rsprox 231/03027 ticks 3760, 4738). Ours played 62 for both.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const ROOT = path.resolve(__dirname, "..");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const Doors = require("../plugins/objects/Doors.plugin");

let core;
let packet;

before(async () => {
  await CachePipeline.initialize(ROOT);
  core = PluginManager.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(2328, 3805);
  RegionManager.loadMapFiles(2407, 3806);
  const api = PluginManager.createApi("FremennikIsleDoorSoundsTest");
  const startup = [];
  Doors.register({ ...api, onServerStartup: (handler) => startup.push(handler) });
  startup.forEach((handler) => handler());
  packet = new ObjectActionPacketListener();
});

let nextIndex = 2600;
function player(at) {
  const actor = new Player(null);
  actor.setIndex(nextIndex++);
  actor.setRegistered(true);
  actor.setNeedsPlacement(false);
  actor.getSession = () => ({ sendClientPacket() {}, write() {} });
  actor.getPrivateArea = () => null;
  actor.sounds = [];
  const sender = actor.getPacketSender();
  const sendSoundEffect = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, ...rest) => { actor.sounds.push(id); return sendSoundEffect(id, ...rest); };
  actor.sendMessage = () => {};
  actor.moveTo(new Location(...at));
  return actor;
}

/** Clicks the option and runs the door's arrival callback, as the route would on arrival. */
function click(actor, id, at, option) {
  let execute;
  actor.setNeedsPlacement(false);
  actor.getMovementQueue().walkToObject = (_object, options) => { execute = options.execute; return true; };
  packet.executeAction(actor, id, at[0], at[1], undefined, option);
  // A player already in reach is answered on the click; otherwise the route's arrival runs it.
  execute?.();
}

function idAt(x, y) {
  return [...ObjectManager.objectsAt(new Location(x, y, 0))].map((object) => object.getId());
}

function loc(name) {
  const id = core.CacheDefinitions.getLocId(name);
  assert.ok(id > 0, `${name} is in the cache`);
  return id;
}

/** [id, face] of each palisade door leaf on the tile. */
function locsAt(x, y) {
  const leaves = ["fris_palisade_door_l", "fris_palisade_door_r", "fris_palisade_door_open_l", "fris_palisade_door_open_r"]
    .map(loc);
  return MapObjects.getObjectsAt(new Location(x, y, 0), null)
    .filter((object) => leaves.includes(object.getId()))
    .map((object) => [object.getId(), object.getFace()]);
}

// Live opens the clicked leaf as fris_palisade_door_open_r and its partner as _open_l, whichever
// leaf was clicked; 2329,3805 always turns to rotation 1 and 2329,3804 to rotation 3. door_l
// (2328,3805): rsprox 2722 tick 75, 3027 tick 8896; door_r (2328,3804): 3027 ticks 6880, 7466, 10387.
const PALISADE_CLICKS = [
  { clicked: "fris_palisade_door_l", at: [2328, 3805], north: "fris_palisade_door_open_r", south: "fris_palisade_door_open_l" },
  { clicked: "fris_palisade_door_r", at: [2328, 3804], north: "fris_palisade_door_open_l", south: "fris_palisade_door_open_r" },
];

test("Open on Neitiznot's palisade gate swings the clicked leaf open as open_r, with synth 36", () => {
  for (const { clicked, at, north, south } of PALISADE_CLICKS) {
    assert.deepEqual([locsAt(2328, 3805), locsAt(2328, 3804)],
      [[[loc("fris_palisade_door_l"), 2]], [[loc("fris_palisade_door_r"), 2]]], `${clicked}: the gate starts closed`);
    const actor = player([2327, at[1]]);
    click(actor, loc(clicked), at, "Open");
    assert.deepEqual([locsAt(2328, 3805), locsAt(2328, 3804), locsAt(2329, 3805), locsAt(2329, 3804)],
      [[], [], [[loc(north), 1]], [[loc(south), 3]]], `${clicked}: the open leaves`);
    assert.deepEqual(actor.sounds, [36], `${clicked}: the open synth`);
    TaskManager.cancelTasks(actor.getIndex());
    // Either open leaf closes the gate back to door_l north, door_r south (rsprox 3027 tick 8871
    // clicked open_r at 2329,3805; 227/00090 tick 9134 open_l at 2329,3804).
    const closer = player([2327, 3805]);
    click(closer, loc(north), [2329, 3805], "Close");
    assert.deepEqual([locsAt(2328, 3805), locsAt(2328, 3804), locsAt(2329, 3805), locsAt(2329, 3804)],
      [[[loc("fris_palisade_door_l"), 2]], [[loc("fris_palisade_door_r"), 2]], [], []], `${clicked}: closed again`);
    TaskManager.cancelTasks(closer.getIndex());
  }
});

test("Open on Jatizso's town wall door (frisd_town_wall_door) opens north with synth 71", () => {
  const at = [2407, 3806];
  assert.ok(MapObjects.get(loc("frisd_town_wall_door"), new Location(...at, 0), null), "the map has the door");
  const actor = player([2407, 3805]);
  click(actor, loc("frisd_town_wall_door"), at, "Open");
  try {
    assert.ok(idAt(2407, 3807).includes(loc("frisd_town_wall_door_open")), "open leaf on the tile north");
    assert.deepEqual(actor.sounds, [71]);
  } finally {
    TaskManager.cancelTasks(actor.getIndex());
  }
});
