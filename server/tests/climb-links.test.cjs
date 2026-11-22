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

test("Braindeath Island's brewery stairs land on the floor, not the walled pocket at their head (issue #6499; Rum Deal capture)", () => {
    // Each stair head has a one-tile pocket beside it that a player cannot step off; the nearest
    // usable tile to the climber used to be that pocket. RumDeal.bin: up from 2152,5088,0 lands on
    // 2149,5089,1 (tick 1194), up from 2150,5109,0 on 2153,5108,1 (2998).
    assert.deepEqual(lands(mapObject(2149, 5088, 0, 10136), ClimbLinks.UP, new Location(2152, 5088, 0)), [2149, 5089, 1]);
    assert.deepEqual(lands(mapObject(2151, 5109, 0, 10136), ClimbLinks.UP, new Location(2150, 5109, 0)), [2153, 5108, 1]);
    // Down: 2152,5088,0 (tick 711), 2166,5088,0 (3148), and the north stairs' own west tile (2986).
    assert.deepEqual(lands(mapObject(2149, 5088, 1, 10137), ClimbLinks.DOWN, new Location(2149, 5089, 1)), [2152, 5088, 0]);
    assert.deepEqual(lands(mapObject(2163, 5088, 1, 10137), ClimbLinks.DOWN, new Location(2163, 5089, 1)), [2166, 5088, 0]);
    assert.deepEqual(lands(mapObject(2153, 5109, 1, 10137), ClimbLinks.DOWN, new Location(2153, 5108, 1)), [2151, 5109, 0]);
});

test("the Kebos Lowlands spiral staircase lands up on its north-east tile, as captured", () => {
    // rsprox 1692 ticks 1007 and 1352: up from 1239,3684,0 lands on 1240,3687,1, not the climber's
    // column; down from 1240,3687,1 lands on 1240,3684,0, which the search already picks.
    assert.deepEqual(lands(mapObject(1239, 3685, 0, 34502), ClimbLinks.UP, new Location(1239, 3684, 0)), [1240, 3687, 1]);
    assert.deepEqual(lands(mapObject(1239, 3685, 1, 34503), ClimbLinks.DOWN, new Location(1240, 3687, 1)), [1240, 3684, 0]);
});

test("the Kualti underground staircase in Civitas illa Fortis lands on one tile each way, from either side", () => {
    // rsprox 1098: down from 1641,3164,0 and 1640,3164,0 both land on 1640,9567,0; up from
    // 1641,9567,0 and 1640,9567,0 both on 1640,3164,0.
    for (const x of [1640, 1641]) {
        assert.deepEqual(lands(mapObject(1640, 3165, 0, 52641), ClimbLinks.DOWN, new Location(x, 3164, 0)), [1640, 9567, 0]);
        assert.deepEqual(lands(mapObject(1640, 9564, 0, 52642), ClimbLinks.UP, new Location(x, 9567, 0)), [1640, 3164, 0]);
    }
});

test("a trapdoor leads underground, 6400 tiles north, and the ladder there back up (Lumbridge castle)", () => {
    assert.deepEqual(lands(mapObject(3209, 3216, 0, 14880), ClimbLinks.DOWN, new Location(3209, 3217, 0)), [3209, 9617, 0]);
    assert.deepEqual(lands(mapObject(3209, 9616, 0, 17385), ClimbLinks.UP, new Location(3208, 9616, 0)), [3210, 3216, 0]);
});

test('both open Castle Wars central trapdoors lead to their actual tunnel ladders', () => {
    const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
    for (const [x, y, face, fromY, landingY] of [[2399, 3099, 3, 3100, 9500], [2400, 3108, 1, 3107, 9507]]) {
        const closed = mapObject(x, y, 0, 1579);
        assert.equal(closed.getFace(), face);
        const open = new GameObject(1581, closed.getLocation(), closed.getType(), face, null);
        assert.equal(ClimbLinks.climbs(open.getId(), ClimbLinks.DOWN), true);
        assert.deepEqual(lands(open, ClimbLinks.DOWN, new Location(x, fromY, 0)), [x, landingY, 0]);
    }
});

test('Top-floor and Bottom-floor go all the way (Lumbridge castle staircases)', () => {
    const bottom = mapObject(3204, 3207, 0, 56230);
    assert.deepEqual(lands(bottom, ClimbLinks.UP, new Location(3206, 3208, 0)), [3206, 3208, 1], 'Climb-up: one floor');
    assert.deepEqual(lands(bottom, ClimbLinks.UP, new Location(3206, 3208, 0), true), [3205, 3209, 2], 'Top-floor');
    assert.deepEqual(lands(mapObject(3205, 3208, 2, 56231), ClimbLinks.DOWN, new Location(3206, 3208, 2), true), [3206, 3208, 0], 'Bottom-floor');
});

test('declared Wizards Tower pair links both ways from plugin data', () => {
    const up = mapObject(3103, 9576, 0, 2148);
    const down = mapObject(3104, 3162, 0, 2147);
    assert.deepEqual(lands(up, ClimbLinks.UP, new Location(3104, 9576, 0)), [3105, 3162, 0]);
    assert.deepEqual(lands(down, ClimbLinks.DOWN, new Location(3105, 3162, 0)), [3104, 9576, 0]);
});

test('the Forthos Ruin staircase returns to the surface across the offset between regions', () => {
    const upstairs = new Location(1670, 3569, 0);
    const downstairs = new Location(1800, 9968, 0);
    const up = mapObject(1798, 9967, 0, 34864);
    const down = mapObject(1669, 3567, 0, 34865);
    assert.deepEqual(lands(up, ClimbLinks.UP, downstairs), [1670, 3569, 0]);
    assert.deepEqual(lands(down, ClimbLinks.DOWN, upstairs), [1800, 9968, 0]);
});

test("a declared landing overrides the nearest tile (Grand Tree base staircase, Anita's floor)", () => {
    // The nearest tile above the stairs is 2389,3512 and blocks the way to Anita; the captured
    // climb lands on 2388,3513 instead.
    const up = mapObject(2389, 3512, 0, 16675);
    assert.deepEqual(lands(up, ClimbLinks.UP, new Location(2389, 3511, 0)), [2388, 3513, 1]);
    assert.equal(ClimbLinks.destination(mapObject(2389, 3513, 1, 16677), ClimbLinks.DOWN, new Location(2388, 3513, 1)) !== null, true);
});

test("the Grand Tree cave ladder climbs to the base trapdoor's landing (the trapdoor only shows Open)", () => {
    assert.deepEqual(lands(mapObject(2463, 9897, 0, 17385), ClimbLinks.UP, new Location(2463, 9896, 0)), [2463, 3498, 0]);
});

test('a multi-storey ladder skips only an inert same-name middle segment (Goblin Village crate ladder)', () => {
    const bottom = mapObject(2954, 3497, 0, 16450);
    const middle = mapObject(2954, 3497, 1, 16557);
    const top = mapObject(2954, 3497, 2, 16556);
    assert.equal(ClimbLinks.climbs(middle.getId(), ClimbLinks.UP), false);
    assert.equal(ClimbLinks.climbs(middle.getId(), ClimbLinks.DOWN), false);
    assert.deepEqual(lands(bottom, ClimbLinks.UP, new Location(2954, 3498, 0)), [2954, 3498, 2], '0 -> 2');
    assert.deepEqual(lands(top, ClimbLinks.DOWN, new Location(2954, 3498, 2)), [2953, 3497, 0], '2 -> 0');
    const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
    assert.deepEqual((ObjectDefinition.forId(16557).getInteractions() ?? []).filter(Boolean), []);
});

test('a missing ladder floor is not skipped; only the real inert segment unlocks the next plane', () => {
    const bottom = mapObject(2954, 3497, 0, 16450);
    const hash = MapObjects.getHash(2954, 3497, 1);
    const original = MapObjects.mapObjects.get(hash);
    const middleIndex = original.findIndex((object) => object.getId() === 16557);
    assert.ok(middleIndex >= 0);
    const middleObject = original[middleIndex];
    original.splice(middleIndex, 1);
    try {
        assert.equal(ClimbLinks.destination(bottom, ClimbLinks.UP, new Location(2954, 3498, 0)), null,
            'no object on plane 1 means no jump over it to plane 2');
    } finally {
        original.splice(middleIndex, 0, middleObject);
    }
});

test('the Ladders task climbs the Goblin Village ladder 0 -> 2 and 2 -> 0', () => {
    const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
    const listeners = new Map(), interactions = new Map(), tasks = [];
    const api = {
        getTaskManager: () => ({ submit: (task) => { task.setRunning(true); tasks.push(task); }, cancelTasks: () => {} }),
        onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
        emitCustomEvent: (name, payload) => (listeners.get(name) ?? []).forEach((handler) => handler(payload)),
        onObjectInteraction: (name, actions) => interactions.set(name, actions),
        sendMultiChatboxPrompt: () => true,
    };
    require('../plugins/objects/Ladders.plugin').register(api);
    const climb = (object, direction, from) => {
        const movement = { block: false, reset() { return this; }, setBlockMovement(value) { this.block = value; return this; },
            isMovementBlocked() { return this.block; }, didMovePreviousCycle: () => false };
        const player = { location: from.clone(), getLocation: () => player.location, moveTo: (target) => { player.location = target; },
            getMovementQueue: () => movement, getPrivateArea: () => null, getHitpoints: () => 10, performAnimation() {} };
        const event = { player, object, objectId: object.getId(), clickType: 1, location: object.getLocation(),
            definition: ObjectDefinition.forId(object.getId()), sourceLocation: { x: from.getX(), y: from.getY(), z: from.getZ() } };
        const handler = interactions.get('Ladder')[direction === ClimbLinks.UP ? 'Climb-up' : 'Climb-down'];
        assert.ok(handler, 'Ladder climb handler');
        handler(event);
        for (let tick = 0; tick < 4; tick++) for (const task of [...tasks]) task.tick();
        return player.location;
    };
    assert.deepEqual(tileOf(climb(mapObject(2954, 3497, 0, 16450), ClimbLinks.UP, new Location(2954, 3498, 0))), [2954, 3498, 2]);
    assert.deepEqual(tileOf(climb(mapObject(2954, 3497, 2, 16556), ClimbLinks.DOWN, new Location(2954, 3498, 2))), [2953, 3497, 0]);
});

function tileOf(location) {
    return location && [location.getX(), location.getY(), location.getZ()];
}

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

test('Draynor east stairs claim the Count room and return to the manor, leaving Ernest alone', () => {
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const core = PluginManager.getCoreApi();
    const listeners = new Map();
    const climbs = [];
    const api = new Proxy({
        core,
        onCustomEvent: (name, h) => listeners.set(name, h),
        emitCustomEvent: (name, request) => climbs.push([name, request.destination]),
    }, { get: (target, prop) => prop in target ? target[prop] : () => {} });
    require('../plugins/bosses/CountDraynor.plugin').register(api);
    const attrs = new Map();
    const player = { setAttribute: (key, value) => attrs.set(key, value) };
    for (const [id, expected, name] of [
        [core.ObjectIdentifiers.STAIRS_11, [3077, 9772, 0], 'ladders:climbDown'],
        [core.ObjectIdentifiers.STAIRS_12, [3116, 3356, 0], 'ladders:climbUp'],
    ]) {
        const request = { player, objectId: id, handled: false };
        listeners.get('ladders:climb')(request);
        assert.equal(request.handled, true);
        const [event, at] = climbs.at(-1);
        assert.equal(event, name);
        assert.deepEqual([at.getX(), at.getY(), at.getZ()], expected);
    }
    assert.equal(attrs.get('count_draynor:pending_instance'), true);
    const request = { player, objectId: core.ObjectIdentifiers.LADDER_6, handled: false };
    listeners.get('ladders:climb')(request);
    assert.equal(request.handled, false);
    assert.equal(climbs.length, 2);
});

test('Ardougne castle main staircase arrives on walkable landings in both directions', () => {
    const up = mapObject(2571, 3295, 0, 15645);
    const down = mapObject(2571, 3295, 1, 15648);
    assert.deepEqual(lands(up, ClimbLinks.UP, new Location(2571, 3298, 0)), [2571, 3294, 1]);
    assert.deepEqual(lands(down, ClimbLinks.DOWN, new Location(2571, 3294, 1)), [2571, 3298, 0]);
    assert.equal(RegionManager.blocked(new Location(2571, 3294, 1), null), false);
    assert.equal(RegionManager.blocked(new Location(2571, 3298, 0), null), false);
});

// Temple of Ikov route integration: real cache/World and decoded client inputs.
// Start tile, torch and cutting tool are supplied fixtures; boots come from static stock.
// No completion API, earned quest ending, authentication or rendered-scene claim.
let bootsCore, bootsPM, bootsOriginalSubmit, bootsOriginalWarn, bootsOriginalError, bootsOriginalLog;
const bootsTasks = new Set(), bootsErrors = [];
let bootsSerial = 0;
async function bootsSetup() {
    if (bootsCore) return;
    process.env.DISABLE_PLAYER_BOTS = "1";
    const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
    bootsPM = require('../dist/plugins/PluginManager').PluginManager;
    bootsOriginalWarn = console.warn; bootsOriginalError = console.error; bootsOriginalLog = console.log;
    console.warn = (...args) => {
        if (/\[plugins\].*hook.*(?:threw|failed)/.test(args.map(String).join(' '))) bootsErrors.push(args.map(String).join(' '));
        bootsOriginalWarn(...args);
    };
    console.error = (...args) => { bootsErrors.push(args.map(String).join(' ')); bootsOriginalError(...args); };
    console.log = (...args) => {
        if (args.some(value => value instanceof Error)) bootsErrors.push(args.map(String).join(' '));
        bootsOriginalLog(...args);
    };
    new NpcDefinitionLoader().load();
    bootsPM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
    bootsCore = bootsPM.getCoreApi();
    bootsOriginalSubmit = bootsCore.TaskManager.submit;
    bootsCore.TaskManager.submit = function(task, ...args) {
        bootsTasks.add(task); return bootsOriginalSubmit.call(this, task, ...args);
    };
    for (const [x, y] of [[2651, 9805], [2639, 9764]]) bootsCore.RegionManager.loadMapFiles(x, y);
    bootsPM.emitServerStartup({});
    const { GroundItemSpawnDefinitionLoader } = require('../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader');
    assert.equal(new GroundItemSpawnDefinitionLoader().load(), true, 'canonical static-ground-stock producer');
}
require('node:test').after(() => {
    if (!bootsOriginalWarn) return;
    try {
        if (bootsCore) bootsPM.emitServerShutdown({});
        for (const task of bootsTasks) if (task.isRunning()) task.stop();
        assert.deepEqual(bootsErrors, [], 'no swallowed route plugin/engine errors');
    } finally {
        console.warn = bootsOriginalWarn; console.error = bootsOriginalError; console.log = bootsOriginalLog;
        if (bootsCore) bootsCore.TaskManager.submit = bootsOriginalSubmit;
    }
});
function bootsTurns(count = 1) { for (let i = 0; i < count; i++) bootsCore.World.process(); }
function bootsWhere(player) { return tileOf(player.getLocation()); }
function bootsObject(id, x, y, player) {
    bootsCore.RegionManager.loadMapFiles(x, y);
    const object = bootsCore.MapObjects.getPrivateArea(player, id, new bootsCore.Location(x, y, 0));
    assert.ok(object, `actual registered cache object ${id}@${x},${y},0`);
    return object;
}
function bootsStand(object, player) {
    const at = object.getLocation();
    const stand = ClimbLinks.landingTile(object, { x: at.getX(), y: at.getY() - 1 }, player?.getPrivateArea() ?? null);
    assert.ok(stand, 'existing cache geometry resolves a reachable stair stand');
    return stand;
}
async function bootsActor(t) {
    await bootsSetup();
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
        close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), player = new Player(session), connection = new ClientConnection(channel);
    connection.player = player; session.setPlayer(player); session.setTurnPacketProcessor(() => connection.processTurnPackets());
    player.setUsername(`ikovboots${++bootsSerial}`);
    player.setLongUsername(bootsCore.Misc.stringToLongBigInt(player.getUsername()));
    player.setAttribute('bot-skip-persistence', true);
    assert.equal(bootsCore.World.getPlayers().add(player), true);
    const down = bootsObject(98, 2650, 9804, player), up = bootsObject(96, 2638, 9763, player);
    // This is the only position grant: a disclosed settled start beside the real down stairs.
    player.moveTo(bootsStand(down, player)); bootsTurns(4);
    assert.equal(player.isNeedsPlacement(), false); assert.equal(player.isRegistered(), true); assert.ok(player.getHitpoints() > 0);
    const messages = [], objectEvents = [], taken = [];
    const send = player.sendMessage.bind(player); player.sendMessage = text => { messages.push(String(text)); return send(text); };
    const sender = player.getPacketSender(), sendString = sender.sendString.bind(sender);
    sender.sendString = (text, ...args) => { messages.push(String(text)); return sendString(text, ...args); };
    const emitObject = bootsPM.emitObjectInteraction.bind(bootsPM), emitCustom = bootsPM.emitCustomEvent.bind(bootsPM);
    t.mock.method(bootsPM, 'emitObjectInteraction', event => {
        if (event.player === player) objectEvents.push(event); return emitObject(event);
    });
    t.mock.method(bootsPM, 'emitCustomEvent', (name, event) => {
        if (name === 'ground-items:taken' && event.player === player) taken.push(event);
        return emitCustom(name, event);
    });
    t.after(() => {
        const index = player.getIndex();
        bootsPM.emitPlayerDisconnect({ player, username: player.getUsername() });
        bootsPM.emitPlayerLogout({ player, username: player.getUsername() });
        player.closeInterruptibleInterfaces(); player.getMovementQueue().reset(); player.getMovementQueue().walkToReset();
        bootsCore.TaskManager.cancelTasks(player); bootsCore.TaskManager.cancelTasks(index);
        bootsCore.World.getPlayers().remove(player);
        assert.equal(player.isRegistered(), false);
        assert.equal(bootsCore.TaskManager.hasActiveTask(player), false);
        assert.equal(bootsCore.TaskManager.hasActiveTask(index), false);
    });
    async function input(packet, turns = 4) { await connection.dispatch([packet]); bootsTurns(turns); }
    async function click(object, action, turns = 8) {
        const at = object.getLocation(), before = objectEvents.length;
        await input({ type: 'object_option', id: object.getId(), x: at.getX(), y: at.getY(), action, clickType: 1 }, turns);
        assert.ok(objectEvents.slice(before).some(event => event.object === object && event.definition?.id === object.getId()
            && event.clickType === 1 && event.handled === true), 'decoded input is handled by the same actual registered object');
    }
    function add(id) {
        const before = player.getInventory().getAmount(id); player.getInventory().adds(id, 1);
        assert.equal(player.getInventory().getAmount(id), before + 1, 'declared fixture item supplied exactly once');
    }
    return { player, down, up, messages, taken, input, click, add, dispatch: packet => connection.dispatch([packet]) };
}
async function bootsWalkToReturn(f, requireDisplacement = false) {
    const stand = bootsStand(f.up, f.player), before = bootsWhere(f.player), area = f.player.getPrivateArea();
    const items = container => structuredClone(container.getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() })));
    const inventory = items(f.player.getInventory()), equipment = items(f.player.getEquipment()), trace = [];
    await f.dispatch({ type: 'move', worldX: stand.getX(), worldY: stand.getY(), modifierFlags: 0, run: false });
    for (let turn = 1; turn <= 32; turn++) {
        bootsTurns();
        assert.equal(f.player.isRegistered(), true); assert.ok(f.player.getHitpoints() > 0);
        assert.equal(f.player.isNeedsPlacement(), false); assert.equal(f.player.hasFlag('movement:ignore-clipping'), false);
        assert.equal(f.player.getPrivateArea(), area); assert.equal(f.player.getLocation().getZ(), stand.getZ());
        assert.deepEqual(items(f.player.getInventory()), inventory); assert.deepEqual(items(f.player.getEquipment()), equipment);
        trace.push({ turn, at: bootsWhere(f.player) });
        if (f.player.getLocation().equals(stand) && f.player.getMovementQueue().size() === 0) break;
    }
    assert.deepEqual(bootsWhere(f.player), tileOf(stand), 'ordinary decoded walk reaches the return stairs without placement');
    if (requireDisplacement) assert.notDeepEqual(before, bootsWhere(f.player), 'pickup-to-return approach actually displaced the player');
    console.log('IKOV_BOOTS_RETURN_WALK', JSON.stringify({ username: f.player.getUsername(), before, target: tileOf(stand), trace,
        positiveDisplacement: before.some((value, index) => value !== bootsWhere(f.player)[index]) }));
    return stand;
}

test('Temple of Ikov down stairs refuse darkness and an unlit torch without changing held items', async t => {
    const f = await bootsActor(t), before = bootsWhere(f.player);
    const items = container => structuredClone(container.getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() })));
    let inventory = items(f.player.getInventory()), equipment = items(f.player.getEquipment());
    await f.click(f.down, 'Climb-down', 4);
    assert.deepEqual(bootsWhere(f.player), before, 'darkness refuses descent');
    assert.deepEqual(items(f.player.getInventory()), inventory); assert.deepEqual(items(f.player.getEquipment()), equipment);
    f.add(bootsCore.ItemIdentifiers.TORCH); // supplied unlit fixture, not an Extinguish action
    inventory = items(f.player.getInventory()); equipment = items(f.player.getEquipment());
    await f.click(f.down, 'Climb-down', 4);
    assert.deepEqual(bootsWhere(f.player), before, 'an unlit torch still refuses descent');
    assert.deepEqual(items(f.player.getInventory()), inventory); assert.deepEqual(items(f.player.getEquipment()), equipment);
});

test('Temple of Ikov lit descent, actual web Slash/static boots Take and ordinary return preserve the acquired pair', async t => {
    const f = await bootsActor(t), boots = bootsCore.ItemIdentifiers.BOOTS_OF_LIGHTNESS;
    f.add(bootsCore.ItemIdentifiers.LIT_TORCH);
    f.add(bootsCore.ItemIdentifiers.WILDERNESS_SWORD_1); // existing Wilderness Web producer chance1, no RNG stub/retry
    assert.equal(f.player.getInventory().getAmount(boots), 0);
    await f.click(f.down, 'Climb-down');
    const litDescent = bootsWhere(f.player);
    assert.deepEqual(litDescent, [2641, 9764, 0], 'exact lit-descent landing');
    const webs = [];
    for (const list of bootsCore.MapObjects.mapObjects.values()) for (const object of list) {
        const at = object.getLocation();
        if (object.getId() === 733 && at.getZ() === 0 && at.getX() >= 2637 && at.getX() <= 2654
            && at.getY() >= 9759 && at.getY() <= 9767) webs.push(object);
    }
    assert.equal(webs.length, 1, 'one actual standing web in the boots-room cache bounds');
    const web = webs[0], at = web.getLocation();
    assert.equal(bootsObject(733, at.getX(), at.getY(), f.player), web);
    assert.equal(bootsCore.ObjectDefinition.forPlayer(web.getId(), f.player).getInteractions()[0], 'Slash');
    const stock = bootsCore.World.getItems().filter(item => item.isStaticSpawn() && !item.isPendingRemoval()
        && item.getItem().getId() === boots && item.getPosition().equals(new bootsCore.Location(2654, 9767, 0)));
    assert.equal(stock.length, 1, 'canonical static boots stock, not an injected item');
    const ground = stock[0];
    assert.equal(ground.getPrivateArea(), f.player.getPrivateArea());
    assert.equal(bootsCore.ItemOnGroundManager.canOperate(f.player, ground, bootsCore.ItemOnGroundManager.takeOperation(boots)), true);
    await f.click(web, 'Slash', 32);
    assert.ok(f.messages.includes('You slash the web apart.'));
    const slashed = bootsCore.MapObjects.getPrivateArea(f.player, 734, at);
    assert.ok(slashed); assert.equal(slashed.getType(), web.getType()); assert.equal(slashed.getFace(), web.getFace());
    assert.equal(bootsCore.MapObjects.getPrivateArea(f.player, 733, at), null);
    await f.input({ type: 'ground_item_action', itemId: boots, x: 2654, y: 9767, option: 'Take', stackId: ground.getId() }, 32);
    assert.equal(f.player.getInventory().getAmount(boots), 1);
    assert.ok(f.taken.some(event => event.groundItem === ground && event.itemId === boots && event.amount === 1 && event.source === 'pickup'));
    assert.ok(ground.isPendingRemoval() || !bootsCore.World.getItems().includes(ground));
    await bootsWalkToReturn(f, true);
    const inventory = structuredClone(f.player.getInventory().getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() })));
    await f.click(f.up, 'Climb-up', 12);
    assert.deepEqual(bootsWhere(f.player), [2649, 9805, 0], 'exact return landing');
    assert.deepEqual(f.player.getInventory().getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() })), inventory);
    assert.equal(f.player.getInventory().getAmount(boots), 1, 'the physical acquired pair survives the ordinary return');
    console.log('IKOV_BOOTS_ACCESS', JSON.stringify({ scope: 'supplied start/torch/tool; actual cache Slash/static Take/ordinary return, no completion API',
        username: f.player.getUsername(), litDescent, down: tileOf(f.down.getLocation()), up: tileOf(f.up.getLocation()),
        stock: { stackId: ground.getId(), at: tileOf(ground.getPosition()), actualTaken: f.taken.some(event => event.groundItem === ground) },
        returned: bootsWhere(f.player), boots: f.player.getInventory().getAmount(boots) }));
});

test('Temple of Ikov ordinary return remains available after removing the supplied light', async t => {
    const f = await bootsActor(t), torch = bootsCore.ItemIdentifiers.LIT_TORCH;
    f.add(torch); await f.click(f.down, 'Climb-down');
    assert.deepEqual(bootsWhere(f.player), [2641, 9764, 0], 'exact lit-descent landing');
    f.player.getInventory().deleteNumber(torch, 1);
    assert.equal(f.player.getInventory().getAmount(torch), 0);
    await bootsWalkToReturn(f); await f.click(f.up, 'Climb-up', 12);
    assert.deepEqual(bootsWhere(f.player), [2649, 9805, 0], 'exact return remains available without light');
});
