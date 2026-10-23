// Root-world locs are placed as raw parents; the client/object packet uses the raw id while
// the display definition resolves the child (Gangplank/Mooring point). MCP observe must expose
// the raw id for object_option/interact, not only the child.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { Location } = require('../dist/game/model/Location');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
});

function player() {
  return {
    getPrivateArea: () => null,
    getRights: () => 0,
    getPacketSender: () => ({ getVarbit: (id) => (id === 19104 ? 1 : 0), getVarp: () => 0 }),
  };
}

function placed(rawId, displayId, x, y) {
  const p = player();
  const object = MapObjects.getPrivateArea(p, displayId, new Location(x, y, 0));
  assert.ok(object, `raw ${rawId} at ${x},${y} is placed`);
  assert.equal(object.getId(), rawId, 'packet/raw id');
  assert.equal(ObjectDefinition.forPlayer(rawId, p)?.id, displayId, 'display child id');
  return object;
}

test('Wyrmscraig root gangplank exposes raw 62397 -> display 59831', () => {
  const p = player();
  const object = placed(62397, 59831, 2568, 2295);
  assert.equal(ObjectDefinition.forPlayer(object.getId(), p)?.getName(), 'Gangplank');
  assert.deepEqual(ObjectDefinition.forPlayer(object.getId(), p)?.getInteractions()?.filter(Boolean), ['Disembark']);
});

test('Remote Island mooring exposes raw parent -> display 59833 (Tort dock unaffected)', () => {
  const p = player();
  const object = placed(59871, 59833, 2972, 2602);
  assert.equal(ObjectDefinition.forPlayer(object.getId(), p)?.getName(), 'Mooring point');
  assert.ok(ObjectDefinition.forPlayer(object.getId(), p)?.getInteractions()?.includes('Disembark'));
});

test('plain Wyrmscraig buoy raw id remains the display id', () => {
  const p = player();
  const object = MapObjects.getPrivateArea(p, 62395, new Location(2569, 2298, 0));
  assert.ok(object);
  assert.equal(object.getId(), 62395);
  assert.equal(ObjectDefinition.forPlayer(62395, p)?.getName(), 'Buoy');
  assert.ok(ObjectDefinition.forPlayer(62395, p)?.getInteractions()?.includes('Dock'));
});
