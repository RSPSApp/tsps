// Run after `yarn build`: node --test tests/object-manager-removed.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');

before(async () => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    RegionManager.init();
});

const removed = () => World.getRemovedObjects();

test('a removed map object is remembered (hidden on scene reloads); a runtime fire is not', () => {
    RegionManager.loadMapFiles(3204, 3229);
    const stairs = MapObjects.get(56230, new Location(3204, 3229, 0), null);
    assert.ok(stairs?.isBaseMap(), 'map objects are flagged when the region loads');

    const before = removed().length;
    const fire = new GameObject(26185, new Location(3222, 3218, 0), 10, 0, null);
    ObjectManager.register(fire, false);
    ObjectManager.deregister(fire, false);
    assert.equal(removed().length, before, 'an expired fire leaves nothing behind');

    // Doors deregister a copy rebuilt from a snapshot, not the loaded instance.
    const copy = new GameObject(56230, new Location(3204, 3229, 0), stairs.getType(), stairs.getFace(), null);
    ObjectManager.deregister(copy, false);
    assert.equal(removed().length, before + 1, 'a copy of a map object is remembered');

    // Put back in its place, it counts as the map object again.
    const restored = new GameObject(56230, new Location(3204, 3229, 0), stairs.getType(), stairs.getFace(), null);
    ObjectManager.register(restored, false);
    assert.equal(removed().length, before, 'restoring clears the record');
    assert.ok(restored.isBaseMap());
    ObjectManager.deregister(restored, false);
    assert.equal(removed().length, before + 1, 'and removing it again is remembered');
});

test('a respawning tree or rock restores the map: nothing stays in the runtime object list', () => {
    RegionManager.loadMapFiles(3204, 3229);
    const tree = MapObjects.get(56230, new Location(3204, 3229, 0), null); // any map object stands in
    assert.ok(tree.isMapOriginal(), 'the region loader marks its own objects');
    const objects = () => World.getObjects().length;
    const before = objects();

    // Chopped: the map object goes, a stump takes its tile.
    ObjectManager.deregister(tree, true);
    const stump = new GameObject(1342, new Location(3204, 3229, 0), tree.getType(), tree.getFace(), null);
    ObjectManager.register(stump, true);
    assert.equal(objects(), before + 1, 'the stump is a runtime object');

    // Respawned: the stump goes and the very map object is put back.
    ObjectManager.deregister(stump, true);
    ObjectManager.register(tree, true);
    assert.equal(objects(), before, 'the respawned tree is not kept: the tile is the map again');
    assert.ok(MapObjects.get(56230, new Location(3204, 3229, 0), null), 'still there server side');
    assert.ok(!removed().some((entry) => entry.getLocation().equals(tree.getLocation()) && entry.getType() === tree.getType()),
        'and nothing about the tile is remembered');

    // Chopped again: its removal is recorded as the first time.
    const recorded = removed().length;
    ObjectManager.deregister(tree, true);
    assert.equal(removed().length, recorded + 1);
    ObjectManager.register(tree, true);
});

test('runtime objects are indexed by tile and region, in step with the world list', () => {
    const fire = new GameObject(26185, new Location(3222, 3218, 0), 10, 0, null);
    const elsewhere = new GameObject(26185, new Location(3300, 3300, 0), 10, 0, null);
    ObjectManager.register(fire, false);
    ObjectManager.register(elsewhere, false);
    assert.deepEqual(ObjectManager.objectsAt(new Location(3222, 3218, 0)), [fire]);
    assert.ok(ObjectManager.existsLocation(new Location(3222, 3218, 0)));
    assert.ok(!ObjectManager.existsLocation(new Location(3222, 3219, 0)));

    // A scene load sends the objects in view only.
    const sent = [];
    const player = {
        getPrivateArea: () => null,
        getPacketSender: () => ({ sendObject: (object) => sent.push(object), sendObjectRemoval: () => {} }),
    };
    ObjectManager.onRegionChange(player, 3222 - 52, 3218 - 52);
    assert.ok(sent.includes(fire) && !sent.includes(elsewhere));

    ObjectManager.deregister(fire, false);
    ObjectManager.deregister(elsewhere, false);
    assert.equal(ObjectManager.objectsAt(new Location(3222, 3218, 0)).length, 0);
    assert.ok(!World.getObjects().includes(fire) && !World.getObjects().includes(elsewhere));
});

test('a door closed again (Doors puts back a copy of the map door) restores the map too', () => {
    RegionManager.loadMapFiles(3226, 3214);
    const door = MapObjects.get(1535, new Location(3226, 3214, 0), null);
    assert.ok(door?.isMapOriginal(), 'the castle door is a map object');
    const objects = () => World.getObjects().length;
    const before = objects();

    // Opened: the map door goes (remembered), the open door stands beside it.
    ObjectManager.deregister(door, true);
    const open = new GameObject(1536, new Location(3227, 3214, 0), door.getType(), (door.getFace() + 1) & 3, null);
    ObjectManager.register(open, true);
    assert.equal(objects(), before + 1);

    // Closed: the open door goes and a copy of the map door is put back.
    ObjectManager.deregister(open, true);
    const closed = new GameObject(1535, new Location(3226, 3214, 0), door.getType(), door.getFace(), null);
    ObjectManager.register(closed, true);
    assert.equal(objects(), before, 'the closed copy is the map again, not a runtime object');
    assert.ok(!removed().some((entry) => entry.getLocation().equals(door.getLocation())), 'nothing remembered');

    // Opened again: still remembered as removed, so a scene reload hides it.
    const recorded = removed().length;
    ObjectManager.deregister(closed, true);
    assert.equal(removed().length, recorded + 1);
    ObjectManager.register(door, true);
});
