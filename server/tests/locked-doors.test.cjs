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
  // Load order as on the server: Doors, then LockedDoors, then their startup hooks in that order.
  Doors.register({ ...api, onServerStartup: (handler) => startup.push(handler) });
  LockedDoors.register({ ...api, onServerStartup: (handler) => startup.push(handler) });
  startup.forEach((handler) => handler());
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

test("an unlocked Neitiznot house door (frisb_abode_door, 2339,3801) still opens", () => {
  const id = core.CacheDefinitions.getLocId("frisb_abode_door");
  const at = [2339, 3801, 0];
  assert.ok(MapObjects.get(id, new Location(...at), null), "the map has frisb_abode_door at 2339,3801");
  const actor = player([2339, 3800, 0]);
  open(actor, id, at);
  assert.deepEqual(actor.messages, []);
  assert.ok(idsAt(at).includes(core.CacheDefinitions.getLocId("frisb_abode_door_open")), "its open leaf spawns");
});

/**
 * Real routing: the click, then the player's processing each cycle. The first cycle is the click
 * tick's own (packets are read before players are processed), so the reply's tick is cycle - 1.
 */
function clickAndRun(actor, id, at, ticks = 8) {
  actor.setNeedsPlacement(false);
  packet.executeAction(actor, id, at[0], at[1], undefined, "Open");
  let replied = null;
  let face = null;
  for (let cycle = 1; cycle <= ticks && replied == null; cycle++) {
    actor.setNeedsPlacement(false);
    actor.getMovementQueue().process();
    core.TaskManager.process();
    core.TaskManager.processWalkTo(actor.getIndex());
    if (actor.messages.length || actor.texts.some((t) => t.uid === MESSAGEBOX_TEXT)) {
      replied = cycle - 1;
      face = actor.getPositionToFace?.();
    }
  }
  core.TaskManager.cancelTasks(actor.getIndex());
  return { replied, at: [actor.getLocation().getX(), actor.getLocation().getY()], face: face ? [face.getX(), face.getY()] : null };
}

// Recorded start tiles. rsprox 323 tick 4897: idle at 3012,3196, the reply on the click tick;
// tick 4202: one step 3012,3187 -> 3188, the reply the next tick. local 1000321 tick 11928:
// 2349,3801 -> 2348,3801, then the reply. rec 1695 tick 2556: walks to 1500,3222.
const ROUTES = [
  { loc: "prisonbarsdoor_locked", at: [3012, 3195, 0], from: [3012, 3196, 0], end: [3012, 3196], tick: 0 },
  { loc: "prisonbarsdoor_locked", at: [3012, 3189, 0], from: [3012, 3187, 0], end: [3012, 3188], tick: 1 },
  { loc: "frisb_abode_door_locked", at: [2347, 3801, 0], from: [2349, 3801, 0], end: [2348, 3801], tick: 1 },
  { loc: "fortis_door_l_locked", at: [1500, 3223, 0], from: [1500, 3221, 0], end: [1500, 3222], tick: 1 },
];

for (const r of ROUTES) {
  test(`from ${r.from.slice(0, 2)} the ${r.loc} at ${r.at.slice(0, 2)} answers from ${r.end} on tick ${r.tick}, facing it`, () => {
    const actor = player(r.from);
    const result = clickAndRun(actor, core.CacheDefinitions.getLocId(r.loc), r.at);
    assert.deepEqual(result, { replied: r.tick, at: r.end, face: r.at.slice(0, 2) });
  });
}
