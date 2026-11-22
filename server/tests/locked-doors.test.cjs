"use strict";

// Run after `yarn build`: node --test tests/locked-doors.test.cjs
//
// Doors that never open (plugins/objects/data/locked-doors.json). The Port Sarim jail cells
// (prisonbarsdoor_locked) and Neitiznot's houses (frisb_abode_door_locked) are an "Open" loc
// whose id + 1 is a same-model "Close" loc, so the Doors plugin swung them open; Civitas illa
// Fortis's locked door answered nothing. Live: rsprox 230/00323 ticks 4202-4900 (cells),
// 227/local 1000321 tick 11928 (Neitiznot), 226/01695 tick 2556 (Civitas).
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
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const Doors = require("../plugins/objects/Doors.plugin");
const LockedDoors = require("../plugins/objects/LockedDoors.plugin");

const MESSAGEBOX_TEXT = (229 << 16) | 3;
const LOCKED_SOUND = 2402;

const CASES = [
  { loc: "prisonbarsdoor_locked", at: [3012, 3189, 0], from: [3013, 3189, 0],
    message: "The door is securely locked.", box: false, sound: LOCKED_SOUND },
  { loc: "prisonbarsdoor_locked", at: [3012, 3195, 0], from: [3013, 3195, 0],
    message: "The door is securely locked.", box: false, sound: LOCKED_SOUND },
  { loc: "frisb_abode_door_locked", at: [2347, 3801, 0], from: [2348, 3801, 0],
    message: "The door is locked.", box: false, sound: null },
  { loc: "fortis_door_l_locked", at: [1500, 3223, 0], from: [1500, 3222, 0],
    message: "The door is locked.", box: true, sound: LOCKED_SOUND },
];

let core;
let packet;

before(async () => {
  await CachePipeline.initialize(ROOT);
  core = PluginManager.getCoreApi();
  RegionManager.init();
  for (const { at } of CASES) RegionManager.loadMapFiles(at[0], at[1]);
  const api = PluginManager.createApi("LockedDoorsTest");
  const startup = [];
  Doors.register({ ...api, onServerStartup: (handler) => startup.push(handler) });
  startup.forEach((handler) => handler());
  LockedDoors.register(api);
  packet = new ObjectActionPacketListener();
});

let nextIndex = 2400;
function player(at) {
  const actor = new Player(null);
  actor.setIndex(nextIndex++);
  actor.setRegistered(true);
  actor.setNeedsPlacement(false);
  actor.getSession = () => ({ sendClientPacket() {}, write() {} });
  actor.getPrivateArea = () => null;
  actor.getHitpoints = () => 10;
  actor.isDyingReturn = () => false;
  actor.messages = [];
  actor.sounds = [];
  actor.texts = [];
  const sender = actor.getPacketSender();
  sender.sendMessage = (message) => { actor.messages.push(String(message)); return sender; };
  const sendSound = sender.sendSound.bind(sender);
  sender.sendSound = (id, volume, delay) => { actor.sounds.push(id); return sendSound(id, volume, delay); };
  const sendString = sender.sendString.bind(sender);
  sender.sendString = (text, uid) => { actor.texts.push({ text, uid }); return sendString(text, uid); };
  actor.sendMessage = (message) => actor.messages.push(String(message));
  actor.moveTo(new Location(...at));
  return actor;
}

function open(actor, id, at) {
  let execute;
  actor.setNeedsPlacement(false);
  actor.getMovementQueue().walkToObject = (_object, options) => { execute = options.execute; return true; };
  packet.executeAction(actor, id, at[0], at[1], undefined, "Open");
  assert.equal(typeof execute, "function", "the click routes to the door");
  execute();
}

/** Spawned locs on the door's tile and the four beside it, where an open leaf would go. */
function idsAt(at) {
  const [x, y, z] = at;
  return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dy]) =>
    [...ObjectManager.objectsAt(new Location(x + dx, y + dy, z))].map((object) => object.getId()));
}

for (const c of CASES) {
  test(`Open on ${c.loc} at ${c.at.join(",")} answers "${c.message}" and the door stays shut`, () => {
    const id = core.CacheDefinitions.getLocId(c.loc);
    assert.ok(id > 0, `${c.loc} is in the cache`);
    assert.ok(MapObjects.get(id, new Location(...c.at), null), `the map has ${c.loc} at ${c.at}`);
    const actor = player(c.from);
    const before = idsAt(c.at);

    open(actor, id, c.at);

    if (c.box) {
      assert.deepEqual(actor.texts.filter((t) => t.uid === MESSAGEBOX_TEXT).map((t) => t.text), [c.message]);
      assert.deepEqual(actor.messages, []);
    } else {
      assert.deepEqual(actor.messages, [c.message]);
    }
    assert.deepEqual(actor.sounds, c.sound ? [c.sound] : []);
    assert.deepEqual(idsAt(c.at), before, "no open leaf replaces the closed door");
    assert.deepEqual([actor.getLocation().getX(), actor.getLocation().getY()], c.from.slice(0, 2),
      "the player stays outside");
  });
}

test("every listed loc resolves to a cache loc whose Open reaches the door plugin", () => {
  for (const door of LockedDoors._test.DOORS) {
    for (const loc of door.locs) {
      const id = core.CacheDefinitions.getLocId(loc);
      assert.ok(id > 0, `${loc} is in the cache`);
      assert.equal(core.CacheDefinitions.getObject(id).actions[0], "Open", `${loc} has Open`);
      assert.equal(LockedDoors._test.lockedDoorFor(id), door);
    }
  }
});

test("the unlocked cell door beside them still opens", () => {
  const request = { player: player([3013, 3189, 0]), objectId: core.CacheDefinitions.getLocId("prisonbarsdoor"), handled: false };
  LockedDoors._test.refuseLockedDoor(request);
  assert.equal(request.handled, false);
});
