// Run after `yarn build`: node --test tests/world-map-position.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { packWorldMapCoord } = require('../dist/net/protocol/WorldMapProtocol');
const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
const WorldMapPosition = require('../plugins/interface/WorldMapPosition.plugin');

// Which fake player is aboard which fake boat (BoatManager looks at the player's deck area).
const aboard = new Map();
BoatManager.getBoatAboard = (player) => aboard.get(player);

/** A player whose map was opened at `open` (sending that position, as toggleWorldMap does). */
function player(open) {
    const sent = [];
    let location = open;
    let mapOpen = true;
    let position = packWorldMapCoord(open.getX(), open.getY(), open.getZ());
    const packetSender = {
        isWorldMapOpen: () => mapOpen,
        getWorldMapPosition: () => position,
        sendWorldMapPosition: (at) => {
            position = packWorldMapCoord(at.getX(), at.getY(), at.getZ());
            sent.push(`${at.getX() % 64},${at.getY() % 64}`);
        },
    };
    const entity = { getPacketSender: () => packetSender, getLocation: () => location };
    return {
        entity,
        sent,
        /** One tick: the player ends it on `at` (movement runs before the plugin hook). */
        tick(at = location) {
            location = at;
            WorldMapPosition._test.updateWorldMapPosition({ player: entity });
            WorldMapPosition._test.sendBoatPositions(); // boats move after the players
        },
        close() { mapOpen = false; },
    };
}

const tile = (x, y) => new Location(50 * 64 + x, 50 * 64 + y, 0);

test('as captured in OSRS: every 3 ticks, the start-of-tick position, only when it changed', () => {
    // Capture ticks 15787 (map opened at 23,21) to 15799: where the player ended each tick.
    const ends = [[23, 21], [23, 21], [23, 21], [25, 21], [27, 20], [29, 19], [31, 19],
        [33, 19], [35, 20], [37, 22], [39, 24], [40, 25], [42, 25]];
    const map = player(tile(23, 21));
    const sentAt = [];
    ends.forEach(([x, y], index) => {
        const before = map.sent.length;
        map.tick(tile(x, y));
        if (map.sent.length > before) sentAt.push(15787 + index);
    });
    // 15790 sends nothing: the player had not moved yet at the start of that tick.
    assert.deepEqual(sentAt, [15793, 15796, 15799]);
    assert.deepEqual(map.sent, ['29,19', '35,20', '40,25']);
});

test('standing still sends nothing; closing the map stops the updates and resets the count', () => {
    const map = player(tile(10, 10));
    for (let i = 0; i < 9; i++) map.tick();
    assert.deepEqual(map.sent, []);
    map.close();
    map.tick(tile(12, 10));
    map.tick(tile(14, 10));
    map.tick(tile(16, 10));
    assert.deepEqual(map.sent, [], 'no updates while closed');
});

test('aboard a boat, as captured while sailing: every 3 ticks, the boat\'s own tile after it moved that tick', () => {
    // Capture: the map opened at 19992 on a boat at 3,43; at each update tick the boat had just
    // moved to the tile that was sent (20001: moved 14,54 -> 16,55 and sent 16,55).
    const boat = { x: 0, y: 0, worldTile() { return { x: 48 * 64 + this.x, y: 46 * 64 + this.y, level: 0 }; } };
    const deck = new Location(60 * 64 + 36, 100 * 64 + 52, 1); // where the player stands, in the deck instance
    const map = player(new Location(48 * 64 + 3, 46 * 64 + 43, 0));
    aboard.set(map.entity, boat);
    const updates = { 19992: [3, 43], 19995: [5, 45], 19998: [10, 50], 20001: [16, 55], 20004: [22, 52], 20007: [25, 45], 20010: [28, 39] };
    const sentAt = [];
    for (let tick = 19992; tick <= 20010; tick++) { // 19992: the map opens (tick 0)
        const before = map.sent.length;
        // The boat moves after the player hook: the hook queues, the after-boats listener sends.
        WorldMapPosition._test.updateWorldMapPosition({ player: map.entity });
        [boat.x, boat.y] = updates[tick] ?? [boat.x + 1, boat.y];
        WorldMapPosition._test.sendBoatPositions();
        if (map.sent.length > before) sentAt.push(tick);
    }
    aboard.delete(map.entity);
    assert.deepEqual(sentAt, [19995, 19998, 20001, 20004, 20007, 20010]);
    assert.deepEqual(map.sent, ['5,45', '10,50', '16,55', '22,52', '25,45', '28,39'], 'never the deck instance tile');
    assert.ok(!map.sent.includes(`${deck.getX() % 64},${deck.getY() % 64}`));
});

test('opening the map aboard marks the boat, not the deck tile', () => {
    const { PacketSender } = require('../dist/net/packet/PacketSender');
    const deck = new Location(60 * 64 + 36, 100 * 64 + 52, 1);
    const fakePlayer = { getLocation: () => deck };
    const location = PacketSender.prototype.worldMapLocation.call({ player: fakePlayer });
    assert.equal(location, deck, 'on land (no boat): the player\'s own tile');
    aboard.set(fakePlayer, { worldTile: () => ({ x: 48 * 64 + 3, y: 46 * 64 + 43, level: 0 }) });
    const onBoat = PacketSender.prototype.worldMapLocation.call({ player: fakePlayer });
    aboard.delete(fakePlayer);
    assert.deepEqual([onBoat.getX(), onBoat.getY(), onBoat.getZ()], [48 * 64 + 3, 46 * 64 + 43, 0]);
});
