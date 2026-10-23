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
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');

before(async () => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    RegionManager.init();
});

const removed = () => World.getRemovedObjects();

test('replacing private scenery detaches its old form and snapshot removals detach the registered form', () => {
    const area = new (class extends PrivateArea {})();
    const at = new Location(1637, 4835, 0);
    const opened = new GameObject(5623, at, 10, 3, area);
    ObjectManager.register(opened, true);
    ObjectManager.register(opened, true);
    assert.deepEqual(area.getObjects(), [opened], 'registering the same object keeps its area membership');
    const closed = new GameObject(5622, at.clone(), 10, 3, area);
    ObjectManager.register(closed, true);
    assert.deepEqual(area.getObjects(), [closed], 'old open wardrobe cannot survive in area lookup');
    assert.equal(MapObjects.get(5623, at, area)?.getPrivateArea(), undefined);
    assert.equal(MapObjects.get(5622, at, area), closed);
    const snapshot = new GameObject(5622, at.clone(), 10, 3, area);
    ObjectManager.deregister(snapshot, true);
    assert.deepEqual(area.getObjects(), [], 'both snapshot and actual registered form are detached');
    assert.ok(!World.getObjects().includes(closed));
    area.destroy();
});

test('moving solid private scenery clears old tiles and preserves unrelated projectile clipping', () => {
    const area = new (class extends PrivateArea {})();
    const tiles = [new Location(100,100,0),new Location(101,100,0),new Location(101,101,0)];
    for (const tile of tiles) area.setClip(tile,0x20000);
    let previous = null;
    for (const tile of [...tiles,...tiles.slice().reverse()]) {
        if (previous) ObjectManager.register(new GameObject(30144,previous.clone(),10,0,area),true);
        ObjectManager.register(new GameObject(30143,tile.clone(),10,0,area),true);
        for (const candidate of tiles) {
            assert.equal(area.getClip(candidate)&0x100,candidate.equals(tile)?0x100:0,'only the current mirror tile blocks walking');
            assert.equal(area.getClip(candidate)&0x20000,0x20000,'non-projectile mirror removal preserves other projectile clipping');
        }
        previous=tile;
    }
    ObjectManager.register(new GameObject(30144,previous.clone(),10,0,area),true);
    assert.ok(tiles.every(tile=>(area.getClip(tile)&0x100)===0));
    area.destroy();
});

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

test('a runtime object removed while out of a player\'s scene is removed when they come back', () => {
    const scenePlayer = (inScene) => {
        const packets = [];
        return {
            packets,
            inScene,
            getPrivateArea: () => null,
            getSession() { return { isTileInScene: () => this.inScene }; },
            getPacketSender: () => ({
                sendObject: (object) => packets.push(['add', object]),
                sendObjectRemoval: (object) => packets.push(['del', object]),
            }),
        };
    };
    const opener = scenePlayer(true);
    const stranger = scenePlayer(false);
    const originalForEach = World.forEachNetworkPlayer;
    World.forEachNetworkPlayer = (consumer) => [opener, stranger].forEach(consumer);
    try {
        // An opened door: a runtime loc the opener's client was sent.
        const at = new Location(3222, 3218, 0);
        const door = new GameObject(1536, at, 0, 1, null);
        ObjectManager.register(door, true);
        assert.deepEqual(opener.packets, [['add', door]]);

        // It closes while the opener is away: no packet reaches them.
        opener.inScene = false;
        opener.packets.length = 0;
        ObjectManager.deregister(new GameObject(1536, at.clone(), 0, 1, null), true);
        assert.deepEqual(opener.packets, []);

        // Back in the scene, the stale door is removed once; the stranger never saw it.
        opener.inScene = true;
        ObjectManager.onRegionChange(opener, 3222 - 52, 3218 - 52);
        assert.deepEqual(opener.packets.map(([kind, object]) => [kind, object.getId()]), [['del', 1536]]);
        opener.packets.length = 0;
        ObjectManager.onRegionChange(opener, 3222 - 52, 3218 - 52);
        assert.deepEqual(opener.packets, []);
        ObjectManager.onRegionChange(stranger, 3222 - 52, 3218 - 52);
        assert.deepEqual(stranger.packets, []);
    } finally {
        World.forEachNetworkPlayer = originalForEach;
    }
});

test('owner objects resolve through normal loc lookup and only enter their owner scene', () => {
    const ownerPackets = [], otherPackets = [];
    const player = (packets) => ({
        getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0,
            sendObject: (entry) => packets.push(entry), sendObjectRemoval() {} }),
        getPrivateArea: () => null,
        getRights: () => 0,
        getSession: () => ({ isTileInScene: () => true }),
        getHitpoints: () => 99,
        busy: () => false,
        getLocation: () => new Location(2435, 6415, 0),
        setPositionToFace() {},
        getMovementQueue: () => ({ walkToObject: (_object, { execute }) => execute(), reset() {}, walkToReset() {} }),
    });
    const owner = player(ownerPackets);
    const other = player(otherPackets);
    const object = new GameObject(48216, new Location(2435, 6415, 0), 22, 0, null).setOwner(owner);
    ObjectManager.register(object, true);

    assert.equal(MapObjects.getPrivateArea(owner, 48216, object.getLocation()), object,
        'ordinary object packet lookup accepts the registered owner object');
    assert.equal(MapObjects.getPrivateArea(other, 48216, object.getLocation()), null,
        'another player cannot resolve the private object');
    const originalInteraction = PluginManager.emitObjectInteraction;
    let dispatched;
    PluginManager.emitObjectInteraction = (event) => (dispatched = event, true);
    try {
        new ObjectActionPacketListener().executeAction(owner, 48216, 2435, 6415, 0, 'Use');
    } finally {
        PluginManager.emitObjectInteraction = originalInteraction;
    }
    assert.equal(dispatched?.object, object, 'the ordinary Use packet reaches the owner-scoped object handler');
    assert.equal(dispatched?.option, 'use');
    assert.deepEqual(MapObjects.ownerObjectsInScene(owner, 2430, 6410, 11), [object]);
    assert.deepEqual(MapObjects.ownerObjectsInScene(other, 2430, 6410, 11), []);

    ObjectManager.onRegionChange(owner, 2400, 6380);
    ObjectManager.onRegionChange(other, 2400, 6380);
    assert.ok(ownerPackets.includes(object));
    assert.ok(!otherPackets.includes(object));

    ObjectManager.deregister(object, true);
    assert.equal(MapObjects.getPrivateArea(owner, 48216, object.getLocation()), null);
});

test('deck-to-world loc clicks keep their route hook; ordinary clicks delegate the option once', (t) => {
    const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
    const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
    const object = new GameObject(1535, new Location(3226, 3214, 0), 0, 0, null);
    const definition = { getInteractions: () => ['Open', 'Close'] };
    const source = new Location(10003, 10004, 0);
    let area = { countsAsMainWorld: () => true };
    let root = new Location(3226, 3213, 0);
    const routes = [], walks = [], interactions = [], messages = [];
    const queue = {
        reset() {}, walkToReset() {},
        walkToObject: (...args) => walks.push(args),
    };
    const player = {
        getHitpoints: () => 99, busy: () => false,
        getLocation: () => source, getPrivateArea: () => area,
        getMovementQueue: () => queue, setPositionToFace() {},
        sendMessage: (text) => messages.push(text),
    };
    t.mock.method(MapObjects, 'getPrivateArea', () => object);
    t.mock.method(ObjectDefinition, 'forPlayer', () => definition);
    t.mock.method(BoatManager, 'rootLocation', () => root);
    t.mock.method(PluginManager, 'emitObjectRoute', event => routes.push(event));
    t.mock.method(PluginManager, 'emitObjectInteraction', event => {
        assert.equal(routes.length, 1, 'route side effects happen before the deck operation');
        interactions.push(event);
        return true;
    });
    const listener = new ObjectActionPacketListener();
    listener.executeAction(player, 1535, 3226, 3214, 2);
    assert.equal(routes.length, 1, 'the deck shortcut still emits exactly one route event');
    assert.equal(routes[0].definition, definition);
    assert.equal(routes[0].clickType, 2);
    assert.deepEqual(routes[0].sourceLocation, { x: 10003, y: 10004, z: 0 });
    assert.equal(interactions.length, 1);
    assert.equal(interactions[0].clickType, 2);
    assert.equal(walks.length, 0, 'the boat still operates the nearby world loc without a land route');
    assert.deepEqual(messages, []);

    routes.length = 0;
    root = new Location(3300, 3300, 0);
    listener.executeAction(player, 1535, 3226, 3214, 2);
    assert.equal(routes.length, 1, 'route side effects also precede an out-of-range deck refusal');
    assert.equal(interactions.length, 1, 'the unreachable loc is not operated');
    assert.deepEqual(messages, ["You can't reach that."]);

    area = null;
    routes.length = 0;
    listener.executeAction(player, 1535, 3226, 3214, 2);
    assert.equal(routes.length, 0, 'normal routing emits in MovementQueue, never twice in the listener');
    assert.equal(walks.length, 1);
    assert.equal(walks[0][0], object);
    assert.equal(typeof walks[0][1].execute, 'function');
    assert.equal(walks[0][2], 2, 'the normalized option reaches the central object router');
});

test('a closed door snapshot replays when a player returns after missing auto-close', () => {
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
    assert.equal(objects(), before + 1, 'keep the closed snapshot for clients that missed it');
    const sent = [];
    ObjectManager.onRegionChange({
        getPrivateArea: () => null,
        getPacketSender: () => ({ sendObject: (object) => sent.push(object), sendObjectRemoval() {} }),
    }, 3200, 3200);
    assert.ok(sent.includes(closed), 'replay the closed door into a cached scene');
    assert.ok(!removed().some((entry) => entry.getLocation().equals(door.getLocation())), 'nothing remembered');

    // Opened again: still remembered as removed, so a scene reload hides it.
    const recorded = removed().length;
    ObjectManager.deregister(closed, true);
    assert.equal(removed().length, recorded + 1);
    ObjectManager.register(door, true);
});
