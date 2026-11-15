// Run after `yarn build`: node --test tests/use-item-on-object-slot.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");

const ITEM = 24790;

/** Clicks an item on an object, then empties or keeps the slot before the walk ends. */
function useOnObject(changeSlot) {
  const slots = [{ getId: () => ITEM }];
  const object = { getId: () => 1, getLocation: () => new Location(3200, 3200, 0) };
  let arrive = null;
  const messages = [];
  const emitted = [];
  const player = {
    getLocation: () => new Location(3199, 3200, 0),
    getInventory: () => ({ capacity: () => 28, getItems: () => slots }),
    getMovementQueue: () => ({ reset() {}, walkToReset() {}, walkToObject: (_, { execute }) => { arrive = execute; } }),
    setPositionToFace() {},
    sendMessage: (message) => messages.push(message),
  };
  const saved = [MapObjects.getPrivateArea, MapObjects.stillStands, PluginManager.emitItemOnObject, PluginManager.emitCanUseItem];
  MapObjects.getPrivateArea = () => object;
  MapObjects.stillStands = () => true;
  PluginManager.emitItemOnObject = (event) => { emitted.push(event); return true; };
  PluginManager.emitCanUseItem = () => true;
  try {
    UseItemPacketListener.itemOnObject(player, 0, 1, ITEM, 0, 3200, 3200);
    assert.ok(arrive, "the player walks to the object first");
    changeSlot(slots);
    arrive();
  } finally {
    [MapObjects.getPrivateArea, MapObjects.stillStands, PluginManager.emitItemOnObject, PluginManager.emitCanUseItem] = saved;
  }
  return { emitted, messages };
}

test("an item still in its slot on arrival is used on the object", () => {
  const { emitted, messages } = useOnObject(() => {});
  assert.equal(emitted.length, 1);
  assert.deepEqual(messages, []);
});

test("an item dropped or moved during the walk is not used, and nothing is said", () => {
  for (const change of [(slots) => { slots[0] = null; }, (slots) => { slots[0] = { getId: () => 995 }; }]) {
    const { emitted, messages } = useOnObject(change);
    assert.deepEqual([emitted.length, messages], [0, []]);
  }
});
