// Run after `yarn build`: node --test tests/climb-links.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Location } = require('../dist/game/model/Location');
const ClimbLinks = require('../plugins/objects/ClimbLinks');

before(async () => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    RegionManager.init();
});

/** The map object with `id` on a tile, from the cache's own map data. */
function mapObject(x, y, z, id) {
    RegionManager.loadMapFiles(x, y);
    const object = (MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []).find((o) => o.getId() === id);
    assert.ok(object, `object ${id} at ${x},${y},${z}`);
    return object;
}

function lands(object, direction, from, toEnd = false) {
    const tile = ClimbLinks.destination(object, direction, from, null, toEnd);
    return tile && [tile.getX(), tile.getY(), tile.getZ()];
}

test('map object keys are unique per tile (they used to collide across the map)', () => {
    // The old z + (x << 24) + (y << 48) gave a Lumbridge cellar tile the key of a castle tile.
    assert.notEqual(MapObjects.getHash(3204, 9613, 1), MapObjects.getHash(3229, 3213, 1));
    const keys = new Set();
    for (const [x, y, z] of [[0, 0, 0], [16383, 16383, 3], [3209, 3216, 0], [3209, 9616, 0], [3216, 3209, 0], [3209, 3216, 1]]) {
        keys.add(MapObjects.getHash(x, y, z));
    }
    assert.equal(keys.size, 6);
});

test("a staircase leads to the top of the stairs, not straight up (Juliet's house, Varrock)", () => {
    // Ground floor: a 2x3 Climb-up staircase; first floor: a 2x2 Climb-down one at the same corner.
    // Up from the foot of the stairs (east): onto the first floor at their top, the west side of
    // the upper staircase (either of its two tiles there; the one nearest the climber).
    const [x, y, z] = lands(mapObject(3156, 3435, 0, 11797), ClimbLinks.UP, new Location(3159, 3436, 0));
    assert.deepEqual([x, z], [3155, 1]);
    assert.ok(y === 3435 || y === 3436);
    // Down: at the foot of the stairs, the east side of the lower staircase.
    const [downX, downY, downZ] = lands(mapObject(3156, 3435, 1, 11799), ClimbLinks.DOWN, new Location(3155, 3435, 1));
    assert.deepEqual([downX, downZ], [3159, 0]);
    assert.ok(downY === 3435 || downY === 3436);
});

test("a trapdoor leads underground, 6400 tiles north, and the ladder there back up (Lumbridge castle)", () => {
    assert.deepEqual(lands(mapObject(3209, 3216, 0, 14880), ClimbLinks.DOWN, new Location(3209, 3217, 0)), [3209, 9617, 0]);
    assert.deepEqual(lands(mapObject(3209, 9616, 0, 17385), ClimbLinks.UP, new Location(3208, 9616, 0)), [3210, 3216, 0]);
});

test('Top-floor and Bottom-floor go all the way (Lumbridge castle staircases)', () => {
    const bottom = mapObject(3204, 3207, 0, 56230);
    assert.deepEqual(lands(bottom, ClimbLinks.UP, new Location(3206, 3208, 0)), [3206, 3208, 1], 'Climb-up: one floor');
    assert.deepEqual(lands(bottom, ClimbLinks.UP, new Location(3206, 3208, 0), true), [3205, 3209, 2], 'Top-floor');
    assert.deepEqual(lands(mapObject(3205, 3208, 2, 56231), ClimbLinks.DOWN, new Location(3206, 3208, 2), true), [3206, 3208, 0], 'Bottom-floor');
});

test('an object without the matching climb option, or nothing at the other end, leads nowhere', () => {
    const trapdoor = mapObject(3209, 3216, 0, 14880);
    assert.equal(ClimbLinks.destination(trapdoor, ClimbLinks.UP, new Location(3209, 3217, 0)), null, 'a trapdoor only climbs down');
    assert.equal(ClimbLinks.destination(null, ClimbLinks.UP, new Location(3209, 3217, 0)), null);
});

test('a gangplank crosses between the dock and the ship beside it, onto the deck and back (Port Sarim, Musa Point)', () => {
    const cross = (x, y, z, id) => {
        const tile = ClimbLinks.crossDestination(mapObject(x, y, z, id));
        return tile && [tile.getX(), tile.getY(), tile.getZ()];
    };
    assert.deepEqual(cross(3030, 3217, 0, 2083), [3032, 3217, 1], 'dock to deck, past the ship half');
    assert.deepEqual(cross(3031, 3217, 1, 2084), [3029, 3217, 0], 'deck to dock');
    assert.deepEqual(cross(2956, 3145, 0, 2081), [2956, 3143, 1]);
    assert.deepEqual(cross(2956, 3144, 1, 2082), [2956, 3146, 0]);
});

test('other spellings of up and down climb too (Walk-up, Ascend, "Climb up", ...)', () => {
    const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
    const real = ObjectDefinition.forId;
    const ops = { 1: ['Walk-up'], 2: ['Descend'], 3: ['Climb Down'], 4: ['Exit'] };
    ObjectDefinition.forId = (id) => (ops[id] ? { getInteractions: () => ops[id] } : real(id));
    try {
        assert.ok(ClimbLinks.climbs(1, ClimbLinks.UP));
        assert.ok(ClimbLinks.climbs(2, ClimbLinks.DOWN));
        assert.ok(ClimbLinks.climbs(3, ClimbLinks.DOWN));
        assert.ok(!ClimbLinks.climbs(4, ClimbLinks.UP) && !ClimbLinks.climbs(4, ClimbLinks.DOWN), 'Exit goes somewhere content decides');
    } finally {
        ObjectDefinition.forId = real;
    }
});

test('the plugin climbs the surveyed names and verbs, and leaves a claimed gangplank to its owner (Dragon Slayer)', () => {
    const interactions = new Map();
    const listeners = new Map();
    const api = {
        getTaskManager: () => ({ submit: () => {} }),
        onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
        emitCustomEvent: (name, payload) => (listeners.get(name) ?? []).forEach((handler) => handler(payload)),
        onObjectInteraction: (name, actions) => interactions.set(name, actions),
    };
    require('../plugins/objects/Ladders.plugin').register(api);
    for (const name of ["Ship's ladder", 'Vine ladder', 'Bamboo Ladder', 'Rope', 'Stairs']) {
        assert.ok(interactions.get(name)['Climb-up'] && interactions.get(name)['Climb-down'], name);
    }
    assert.ok(interactions.get('Stairs')['Walk-down'] && interactions.get('Stairs').Ascend);
    assert.ok(interactions.get('Gangplank').Cross);

    // Dragon Slayer claims the Lady Lumbridge's gangplanks through ladders:climb.
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const questApi = new Proxy({ core: PluginManager.getCoreApi(), onCustomEvent: api.onCustomEvent, persistAttribute: () => {} }, {
        get: (target, prop) => (prop in target ? target[prop] : () => {}),
    });
    require('../plugins/quests/quests/DragonSlayer.Quest')(questApi);
    const messages = [];
    const player = new Proxy({ getAttribute: () => 0, sendMessage: (message) => messages.push(message) }, {
        get: (target, prop) => (prop in target ? target[prop] : () => undefined),
    });
    const claim = { player, objectId: 2593, clickType: 1, handled: false };
    api.emitCustomEvent('ladders:climb', claim);
    assert.equal(claim.handled, true);
    assert.deepEqual(messages, ['The ship is not ready to sail yet.']);
    const other = { player, objectId: 2083, clickType: 1, handled: false };
    api.emitCustomEvent('ladders:climb', other);
    assert.equal(other.handled, false, 'an ordinary gangplank is left to the generic crossing');
});
