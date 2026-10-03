// Run after `yarn build`: node --test tests/sailing.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

// Boat parts, stats and fees are read from the cache's sailing tables.
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { Boat, BoatMoveMode } = require("../dist/game/content/sailing/Boat");
const { canOccupy, hullTiles } = require("../dist/game/content/sailing/BoatCollision");
const { tickBoat } = require("../dist/game/content/sailing/BoatMovement");
const {
  angleFromCoordDelta,
  angleToFineDelta,
  packedHeadingToAngle,
  reverseAngle,
  turnAngleDelta,
} = require("../dist/game/content/sailing/HeadingUtils");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { Location } = require("../dist/game/model/Location");

const SOUTH = 0;
const WEST = 512;
const NORTH = 1024;
const EAST = 1536;

function makeRaft(angle = NORTH) {
  return new Boat({
    entityIndex: 3000,
    configId: 1,
    ownerPlayerId: 1,
    deckRegionX: 1200,
    deckRegionY: 1200,
    sizeX: 8,
    sizeZ: 8,
    hull: { offsetX: 0, offsetY: 0, width: 128, length: 384 },
    deckCentreX: 448,
    deckCentreY: 448,
    fineX: 100 * 128 + 64,
    fineY: 100 * 128 + 64,
    level: 0,
    angle,
  });
}

const openSea = () => true;

// Boat maths ported from xrsps `server/tests/sailing-boat-movement.test.ts`.

test("heading math", () => {
  assert.equal(packedHeadingToAngle(0), 0);
  assert.equal(packedHeadingToAngle(4), WEST);
  assert.equal(packedHeadingToAngle(15), 1920);
  assert.equal(reverseAngle(SOUTH), NORTH);
  assert.equal(reverseAngle(EAST), WEST);

  assert.equal(angleFromCoordDelta(0, -5), SOUTH);
  assert.equal(angleFromCoordDelta(-5, 0), WEST);
  assert.equal(angleFromCoordDelta(0, 5), NORTH);
  assert.equal(angleFromCoordDelta(5, 0), EAST);

  assert.deepEqual(angleToFineDelta(SOUTH, 64), { dx: 0, dy: -64 });
  assert.deepEqual(angleToFineDelta(WEST, 64), { dx: -64, dy: 0 });
  assert.deepEqual(angleToFineDelta(NORTH, 64), { dx: 0, dy: 64 });
  assert.deepEqual(angleToFineDelta(EAST, 64), { dx: 64, dy: 0 });

  // Clockwise is preferred up to and including a half turn.
  assert.equal(turnAngleDelta(SOUTH, WEST), 512);
  assert.equal(turnAngleDelta(SOUTH, NORTH), 1024);
  assert.equal(turnAngleDelta(SOUTH, EAST), -512);
  assert.equal(turnAngleDelta(100, 100), 0);
});

test("a stopped boat stays put", () => {
  const boat = makeRaft(NORTH);
  assert.deepEqual(tickBoat(boat, openSea), { moved: false, turned: false, blocked: false });
});

test("full sail moves 1.5 tiles a tick, half sail 0.75", () => {
  const boat = makeRaft(NORTH);
  boat.moveMode = BoatMoveMode.Full;
  const startY = boat.fineY;
  tickBoat(boat, openSea);
  assert.equal(boat.fineY - startY, 192);
  boat.moveMode = BoatMoveMode.Half;
  tickBoat(boat, openSea);
  assert.equal(boat.fineY - startY, 288);
});

test("a fast boat stops at a one-tile strip of land instead of hopping it", () => {
  const strip = (_x, y) => y !== 102;
  const boat = makeRaft(NORTH);
  boat.fineY = 100 * 128 + 64 - 128; // hull covers rows 98..100
  boat.moveMode = BoatMoveMode.Full;
  for (let i = 0; i < 10; i++) tickBoat(boat, strip);
  for (const tile of hullTiles(boat, boat.fineX, boat.fineY, boat.angle)) {
    assert.ok(tile % 0x8000 < 102, "hull never crosses the strip");
  }
});

test("reverse keeps the bow on the heading and backs up at half speed", () => {
  const boat = makeRaft(NORTH);
  boat.moveMode = BoatMoveMode.Reverse;
  const startY = boat.fineY;
  tickBoat(boat, openSea);
  assert.equal(boat.angle, NORTH);
  assert.equal(boat.fineY - startY, -96);
});

test("a quarter turn takes 4 ticks at 128 units a tick", () => {
  const boat = makeRaft(SOUTH);
  boat.moveMode = BoatMoveMode.Full;
  boat.heading = WEST;
  let ticks = 0;
  while (boat.angle !== WEST && ticks < 20) {
    assert.ok(tickBoat(boat, openSea).turned);
    ticks++;
  }
  assert.equal(ticks, 4);
});

test("a turning boat keeps sailing at its sail speed", () => {
  const boat = makeRaft(SOUTH);
  boat.moveMode = BoatMoveMode.Full;
  boat.heading = WEST;
  const startX = boat.fineX;
  const startY = boat.fineY;
  assert.ok(tickBoat(boat, openSea).turned);
  assert.ok(Math.abs(Math.hypot(boat.fineX - startX, boat.fineY - startY) - 192) <= 1);
});

test("the 1x3 raft hull covers 3 tiles facing north or east", () => {
  const boat = makeRaft(NORTH);
  assert.equal(hullTiles(boat, boat.fineX, boat.fineY, NORTH).size, 3);
  assert.equal(hullTiles(boat, boat.fineX, boat.fineY, EAST).size, 3);
});

test("the boat stops at the coast and can back off", () => {
  // Land starts at y = 102; the bow reaches it after sailing north.
  const coast = (_x, y) => y < 102;
  const boat = makeRaft(NORTH);
  boat.fineY = 100 * 128 + 64 - 128; // hull covers rows 98..100
  boat.moveMode = BoatMoveMode.Full;
  let blocked = false;
  for (let i = 0; i < 10 && !blocked; i++) {
    blocked = tickBoat(boat, coast).blocked;
  }
  assert.ok(blocked);
  for (const tile of hullTiles(boat, boat.fineX, boat.fineY, boat.angle)) {
    assert.ok(tile % 0x8000 < 102, "hull never overlaps land");
  }
  assert.ok(canOccupy(boat, boat.fineX, boat.fineY - 64, boat.angle, coast));
});

test("deck tiles project onto the world tile under the boat", () => {
  // Facing south (template orientation) the deck lane tile (3, 3) sits on the boat centre.
  const boat = makeRaft(SOUTH);
  assert.deepEqual(boat.deckTileToWorld(boat.deckBaseX + 3, boat.deckBaseY + 3), { x: 100, y: 100 });
  assert.deepEqual(boat.deckTileToWorld(boat.deckBaseX + 3, boat.deckBaseY + 4), { x: 100, y: 101 });
  // Turned north (half a turn), the tile ahead of the centre ends up behind it.
  const turned = makeRaft(NORTH);
  assert.deepEqual(turned.deckTileToWorld(turned.deckBaseX + 3, turned.deckBaseY + 4), { x: 100, y: 99 });
});

test("helm headings snap to the 16 directions", () => {
  const boat = makeRaft(NORTH);
  assert.equal(boat.helmHeadingToward(104, 100), EAST);
  assert.equal(boat.helmHeadingToward(100, 106), NORTH);
  assert.equal(boat.helmHeadingToward(94, 100), WEST);
  assert.equal(boat.helmHeadingToward(100, 100), undefined, "clicking the boat's own tile");
  // 18.4 degrees north of east rounds to the next 22.5-degree step (east-north-east).
  assert.equal(boat.helmHeadingToward(103, 101), 1408);
  // Measured from the exact centre: a boat 0.9 tiles into its tile heading for a tile due
  // north of that point stays north instead of drifting a step.
  boat.fineX = 100 * 128 + 115;
  assert.equal(boat.helmHeadingToward(100, 103), NORTH);
});

// A raft spec with the values ported from xrsps `boats.ts`.
const RAFT = {
  type: "raft",
  configId: 1,
  templateChunkX: 480,
  templateChunkY: 807,
  sizeX: 8,
  sizeZ: 8,
  hull: { offsetX: 0, offsetY: 0, width: 128, length: 384 },
  deckCentreX: 448,
  deckCentreY: 448,
  deckLevel: 1,
  walkableDeck: [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }],
  boardingTile: { x: 3, y: 4 },
  locs: [],
};

const AT_SEA = { fineX: 100 * 128 + 64, fineY: 100 * 128 + 64, level: 0, angle: NORTH };

function aboard(boat, dx, dy) {
  const deck = BoatManager.getDeck(boat);
  return { getArea: () => deck, getLocation: () => new Location(boat.deckBaseX + dx, boat.deckBaseY + dy, 0) };
}

test("only the boat type's walkable tiles are open on the deck", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    const deck = BoatManager.getDeck(boat);
    const clip = (dx, dy, z = 0) => RegionManager.getClipping(boat.deckBaseX + dx, boat.deckBaseY + dy, z, deck);
    assert.equal(clip(3, 2), 0);
    assert.equal(clip(3, 4), 0);
    assert.equal(clip(2, 3), RegionManager.BLOCKED_TILE);
    assert.equal(clip(3, 5), RegionManager.BLOCKED_TILE);
    assert.equal(clip(3, 3, 1), RegionManager.BLOCKED_TILE, "everyone aboard stands on level 0");
    assert.ok(BoatManager.isDeckTile(boat.deckBaseX, boat.deckBaseY));
  } finally {
    BoatManager.dispose(boat);
  }
});

test("each boat gets its own deck scene and entity index, freed on dispose", () => {
  const first = BoatManager.spawn(1, RAFT, AT_SEA);
  const second = BoatManager.spawn(2, RAFT, AT_SEA);
  assert.notEqual(first.entityIndex, second.entityIndex);
  assert.notEqual(first.deckBaseX, second.deckBaseX);
  BoatManager.dispose(first);
  assert.equal(BoatManager.getBoat(first.entityIndex), undefined);
  const third = BoatManager.spawn(3, RAFT, AT_SEA);
  assert.equal(third.entityIndex, first.entityIndex, "the freed slot is reused");
  BoatManager.dispose(second);
  BoatManager.dispose(third);
});

test("an actor on a deck is aboard that boat, and their root tile is the world tile under them", () => {
  const boat = BoatManager.spawn(1, RAFT, { ...AT_SEA, angle: SOUTH });
  try {
    const sailor = aboard(boat, 3, 4);
    assert.equal(BoatManager.getBoatAboard(sailor), boat);
    const root = BoatManager.rootLocation(sailor);
    assert.deepEqual([root.getX(), root.getY(), root.getZ()], [100, 101, 0]);

    const onLand = { getArea: () => null, getLocation: () => new Location(3200, 3200, 0) };
    assert.equal(BoatManager.getBoatAboard(onLand), undefined);
    assert.equal(BoatManager.rootLocation(onLand).getX(), 3200);
  } finally {
    BoatManager.dispose(boat);
  }
  assert.equal(BoatManager.getBoatAboard(aboard(boat, 3, 4)), undefined, "a disposed boat has no one aboard");
});

// --- World-entity packets, read the way client/network/packet/ServerBinaryDecoder.ts reads them.

const {
  encodeRebuildWorldEntity,
  encodeWorldEntityInfo,
} = require("../dist/net/protocol/ClientProtocol");
const { WorldEntitySync } = require("../dist/game/content/sailing/WorldEntitySync");

function reader(buffer, offset) {
  let at = offset;
  return {
    u8: () => buffer[at++],
    i8: () => buffer.readInt8(at++),
    u16: () => { const v = buffer.readUInt16BE(at); at += 2; return v; },
    i16: () => { const v = buffer.readInt16BE(at); at += 2; return v; },
    i32: () => { const v = buffer.readInt32BE(at); at += 4; return v; },
    done: () => at >= buffer.length,
    at: () => at,
  };
}

function readPosition(r) {
  const flags = r.u8();
  const typed = (shift) => {
    const width = (flags >> shift) & 3;
    return width === 3 ? r.i32() : width === 2 ? r.i16() : width === 1 ? r.i8() : 0;
  };
  return { x: typed(0), y: typed(2), z: typed(4), orientation: typed(6) };
}

/** Decodes WORLDENTITY_INFO (opcode, u8 length, payload). */
function decodeWorldEntityInfo(packet) {
  assert.equal(packet[0], 143);
  const r = reader(packet, 2);
  const count = r.u8();
  const updates = [];
  for (let i = 0; i < count; i++) {
    const updateType = r.u8();
    const update = { updateType };
    if (updateType >= 2) update.delta = readPosition(r);
    if (updateType !== 0) assert.equal(r.u8(), 0, "no mask");
    updates.push(update);
  }
  const spawns = [];
  while (!r.done()) {
    const spawn = { entityIndex: r.u16(), sizeX: r.u8(), sizeZ: r.u8(), configId: r.u16() };
    spawn.position = readPosition(r);
    spawn.drawMode = r.u8();
    assert.equal(r.u8(), 0, "no mask");
    spawns.push(spawn);
  }
  return { updates, spawns };
}

test("WORLDENTITY_INFO packs updates and spawns the way the client reads them", () => {
  const packet = encodeWorldEntityInfo(
    [{ updateType: 2, delta: { x: 64, y: 0, z: -300, orientation: 128 } }, { updateType: 1 }, { updateType: 0 }],
    [{ entityIndex: 3000, sizeX: 8, sizeZ: 8, configId: 1, drawMode: 0, position: { x: 393472, y: 0, z: 382400, orientation: 1024 } }],
  );
  assert.equal(packet[1], packet.length - 2, "u8 length");
  assert.deepEqual(decodeWorldEntityInfo(packet), {
    updates: [
      { updateType: 2, delta: { x: 64, y: 0, z: -300, orientation: 128 } },
      { updateType: 1 },
      { updateType: 0 },
    ],
    spawns: [{ entityIndex: 3000, sizeX: 8, sizeZ: 8, configId: 1, drawMode: 0, position: { x: 393472, y: 0, z: 382400, orientation: 1024 } }],
  });
});

test("REBUILD_WORLDENTITY carries the deck scene the way the client reads it", () => {
  const chunks = Array.from({ length: 4 }, () => Array.from({ length: 13 }, () => new Array(13).fill(-1)));
  chunks[1][6][6] = 0x1234567;
  const packet = encodeRebuildWorldEntity(3000, 1, 8, 8, 1200, 1216, chunks, [[1, 2, 3, 4]]);
  assert.equal(packet[0], 142);
  assert.equal(packet.readUInt16BE(1), packet.length - 3, "u16 length");
  const r = reader(packet, 3);
  assert.deepEqual(
    [r.u16(), r.u16(), r.u8(), r.u8(), r.u16(), r.u16(), r.u16(), r.u8(), r.u16(), r.u16(), r.u8()],
    [3000, 1, 8, 8, 1200, 1216, 1216, 0, 1200, 1, 0],
    "entity, config, size, zone, regionY, force reload, regionX, xtea count, build areas",
  );
  // 4 x 13 x 13 presence bits, plus 26 bits for the one chunk, MSB first.
  let bit = r.at() * 8;
  const readBits = (count) => {
    let value = 0;
    for (let i = 0; i < count; i++, bit++) value = (value << 1) | ((packet[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  const found = [];
  for (let plane = 0; plane < 4; plane++) {
    for (let x = 0; x < 13; x++) {
      for (let y = 0; y < 13; y++) {
        if (readBits(1)) found.push([plane, x, y, readBits(26)]);
      }
    }
  }
  assert.deepEqual(found, [[1, 6, 6, 0x1234567]]);
  const keys = reader(packet, Math.ceil(bit / 8));
  assert.deepEqual([keys.i32(), keys.i32(), keys.i32(), keys.i32()], [1, 2, 3, 4]);
  assert.ok(keys.done());
});

function viewer(x, y) {
  const player = { location: new Location(x, y, 0) };
  player.getLocation = () => player.location;
  player.getArea = () => player.area ?? null;
  return player;
}

test("a viewer is sent a boat in range, its moves, and its removal once out of range", () => {
  const boat = BoatManager.spawn(1, { ...RAFT, locs: [{ id: 59554, x: 3, y: 4, level: 1, shape: 10, rotation: 0 }] }, AT_SEA);
  try {
    const watcher = viewer(boat.tileX + 10, boat.tileY);

    const first = WorldEntitySync.flush(watcher);
    assert.deepEqual(first.map((packet) => packet[0]), [142, 143, 134], "deck scene, spawn, then the deck loc (LOC_ADD_CHANGE)");
    const spawned = decodeWorldEntityInfo(first[1]);
    assert.deepEqual(spawned.updates, []);
    assert.equal(spawned.spawns[0].entityIndex, boat.entityIndex);
    assert.deepEqual(spawned.spawns[0].position, { x: boat.fineX, y: 0, z: boat.fineY, orientation: boat.angle });

    assert.deepEqual(WorldEntitySync.flush(watcher), [], "nothing to send while the boat is still");

    // A deck loc changed (a facility built) reaches a viewer who already has the boat, once;
    // a viewer who gets the boat later has it in the boat's locs.
    BoatManager.setDeckLoc(boat, { id: 59682, x: 3, y: 4, level: 1, shape: 10, rotation: 1 });
    assert.deepEqual(WorldEntitySync.flush(watcher).map((packet) => packet[0]), [134]);
    assert.deepEqual(WorldEntitySync.flush(watcher), []);
    const later = viewer(boat.tileX + 10, boat.tileY);
    assert.deepEqual(WorldEntitySync.flush(later).map((packet) => packet[0]), [142, 143, 134]);
    assert.deepEqual(WorldEntitySync.flush(later), []);

    boat.fineY += 64;
    assert.deepEqual(decodeWorldEntityInfo(WorldEntitySync.flush(watcher)[0]).updates,
      [{ updateType: 2, delta: { x: 0, y: 0, z: 64, orientation: 0 } }]);

    watcher.location = new Location(boat.tileX + 40, boat.tileY, 0);
    assert.deepEqual(decodeWorldEntityInfo(WorldEntitySync.flush(watcher)[0]).updates, [{ updateType: 0 }]);
    assert.deepEqual(WorldEntitySync.flush(watcher), []);
  } finally {
    BoatManager.dispose(boat);
  }
});

test("an owner-only boat, and anyone aboard it, is shown only to its owner", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    boat.ownerOnly = true;
    const owner = viewer(boat.tileX + 2, boat.tileY);
    owner.getIndex = () => 1;
    const other = viewer(boat.tileX + 2, boat.tileY);
    other.getIndex = () => 2;
    assert.equal(decodeWorldEntityInfo(WorldEntitySync.flush(owner)[1]).spawns[0].entityIndex, boat.entityIndex);
    assert.deepEqual(WorldEntitySync.flush(other), []);
    const aboard = { getArea: () => BoatManager.getDeck(boat) };
    assert.equal(BoatManager.canSeeAboard(owner, aboard), true);
    assert.equal(BoatManager.canSeeAboard(other, aboard), false);
    assert.equal(BoatManager.canSeeAboard(other, { getArea: () => null }), true);
  } finally {
    BoatManager.dispose(boat);
  }
});

test("the boat a player is on is always sent, and a disposed boat is removed", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  const sailor = viewer(0, 0);
  sailor.area = BoatManager.getDeck(boat);
  sailor.location = new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0);
  assert.equal(decodeWorldEntityInfo(WorldEntitySync.flush(sailor)[1]).spawns[0].entityIndex, boat.entityIndex);
  BoatManager.dispose(boat);
  sailor.area = null;
  assert.deepEqual(decodeWorldEntityInfo(WorldEntitySync.flush(sailor)[0]).updates, [{ updateType: 0 }]);
});

// --- Player sync and visibility across the deck boundary.

const { encodePlayerSync, createPlayerSyncState } = require("../dist/net/protocol/ClientProtocol");

function bitsOf(buffer) {
  return [...buffer].map((byte) => byte.toString(2).padStart(8, "0")).join("");
}

test("adding a player on a deck writes their boat as the world view", () => {
  const syncBits = (worldView) => {
    const self = { index: 1, x: 3200, y: 3200, level: 0, appearance: Buffer.alloc(1) };
    const sailor = { index: 2, x: 9624, y: 9636, level: 0, appearance: Buffer.alloc(1), worldView };
    const packet = encodePlayerSync(1, 3152, 3152, 1, [self, sailor], createPlayerSyncState(1, self));
    return bitsOf(packet.subarray(3 + 12)); // opcode + length, then the 12-byte header
  };
  const ashore = syncBits(undefined);
  const aboard = syncBits(3000);
  let at = 0;
  while (ashore[at] === aboard[at]) at++;
  assert.equal(ashore[at], "0", "the no-world-view bit");
  assert.equal(aboard.slice(at, at + 17), "1" + (3000).toString(2).padStart(16, "0"));
  assert.equal(aboard.slice(at + 17), ashore.slice(at + 1), "nothing else changes");
});

test("people aboard count as being in the main world, where the boat is", () => {
  const boat = BoatManager.spawn(1, RAFT, { ...AT_SEA, angle: SOUTH });
  try {
    const sailor = aboard(boat, 3, 4);
    sailor.getPrivateArea = () => BoatManager.getDeck(boat);
    assert.equal(BoatManager.syncArea(sailor), null);
    const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
    const house = new (class House extends PrivateArea {})();
    assert.equal(BoatManager.syncArea({ getPrivateArea: () => house }), house, "other private areas are unchanged");
    // A viewer 10 tiles from the boat sees the sailor; one 20 tiles away does not.
    const root = BoatManager.rootLocation(sailor);
    assert.ok(root.isViewableFromWithin(new Location(110, 101, 0), 15));
    assert.ok(!root.isViewableFromWithin(new Location(121, 101, 0), 15));
  } finally {
    BoatManager.dispose(boat);
  }
});

test("NPC_INFO carries the tile new NPCs are placed from (the root tile when aboard)", () => {
  const { encodeNpcSync, createNpcSyncState } = require("../dist/net/protocol/ClientProtocol");
  const packet = encodeNpcSync(7, { x: 3074, y: 2987, level: 0 }, [], createNpcSyncState());
  assert.equal(packet[0], 21);
  // opcode, u16 length, then loop cycle (4), large (1), root tile x and y, sync length.
  assert.equal(packet.readInt32BE(3), 7);
  assert.equal(packet.readUInt16BE(8), 3074);
  assert.equal(packet.readUInt16BE(10), 2987);
  assert.equal(packet.readUInt16BE(12), packet.length - 14);
});

test("a boat deck counts as the main world; other private areas don't", () => {
  const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
  class House extends PrivateArea {}
  assert.equal(new House().countsAsMainWorld(), false);
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    assert.equal(BoatManager.getDeck(boat).countsAsMainWorld(), true);
  } finally {
    BoatManager.dispose(boat);
  }
});

test("SET_HEADING decodes to one of the 16 helm headings", () => {
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  assert.deepEqual(decodeClientPackets(Buffer.from([214, 9])), [{ type: "set_heading", heading: 9 }]);
  assert.deepEqual(decodeClientPackets(Buffer.from([214, 0xff])), [{ type: "set_heading", heading: 15 }]);
});

test("only the player at the helm steers, by heading or by clicking", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    const sailor = { ...aboard(boat, 3, 4), getIndex: () => 7 };
    BoatManager.setHelmHeading(sailor, 4);
    assert.equal(boat.heading, NORTH, "not at the helm");
    assert.equal(BoatManager.steerToward(sailor, 110, 100), false);

    boat.helmPlayerId = 7;
    BoatManager.setHelmHeading(sailor, 4);
    assert.equal(boat.heading, WEST);
    assert.equal(BoatManager.steerToward(sailor, boat.tileX + 10, boat.tileY), true);
    assert.equal(boat.heading, EAST, "a click east of the boat");
  } finally {
    BoatManager.dispose(boat);
  }
});

// --- Lifecycle: every way on and off a boat.

const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { emptySailingState, normalizeSailingState } = require("../dist/game/content/sailing/SailingState");
const cargo = require("../plugins/skills/sailing/cargo");
const { boatName } = require("../plugins/skills/sailing/sailingContent");

const ITEM_NAMES = {
  995: "Coins", 2: "Steel cannonball", 385: "Shark", 8794: "Saw", 31964: "Repair kit",
  31986: "Captain's log", 7534: "Fishbowl helmet", 7535: "Diving apparatus",
  32435: "Crate of adamantite ore",
};
const STACKABLE = new Set([995, 2, 32044, 4820, 1939]);
ItemDefinition.forId = (id) => ({
  getId: () => id,
  getName: () => ITEM_NAMES[id] ?? "Coins",
  isStackable: () => STACKABLE.has(id),
  isNoted: () => false,
  getExamine: () => `It's a ${ITEM_NAMES[id]}.`,
});

const DOCK = { id: "port_sarim", mooring: { fineX: 3074 * 128 + 64, fineY: 2987 * 128 + 64, level: 0, angle: NORTH }, landing: { x: 3069, y: 2987, z: 0 } };
Sailing.initialize();
Sailing.registerBoatType(RAFT);
Sailing.registerDock(DOCK);

let nextIndex = 100;
/** A player built on the real Mobile prototype, so teleports run through moveTo's listeners. */
function sailor(sailing = emptySailingState()) {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  const messages = [];
  let location = new Location(3069, 2987, 0);
  Object.assign(player, {
    messages,
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getSailing: () => sailing,
    setSailing: (next) => { sailing = next; },
    getPacketSender: () => new Proxy({}, { get: (_t, _k, proxy) => () => proxy }),
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  return player;
}

function tileOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

test("boarding at the dock puts the player on the deck of their boat, at sea", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id, [0, 69, 57]); // "Lady Pride"
  assert.equal(Sailing.board(player, DOCK.id), null);
  const boat = BoatManager.getBoatAboard(player);
  assert.ok(boat);
  assert.deepEqual(tileOf(player), [boat.deckBaseX + 3, boat.deckBaseY + 4, 0]);
  assert.equal(Sailing.activeBoat(player).location.kind, "at_sea");
  assert.deepEqual(player.getSailing().returnPoint, DOCK.landing);
  assert.equal(Sailing.board(player, DOCK.id), "You're already on a boat.");
  Sailing.disembark(player, DOCK.id);
});

test("boarding is refused with no boat here", () => {
  assert.equal(Sailing.board(sailor(), DOCK.id), "You don't have a boat moored here.");
});

test("disembarking moors the boat at the dock and removes it from the sea", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);

  const at = { fineX: boat.fineX, fineY: boat.fineY, level: boat.level, angle: boat.angle };
  assert.equal(Sailing.disembark(player, DOCK.id), null);

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: DOCK.id, at }, "left where it was");
  assert.deepEqual(tileOf(player), [3069, 2987, 0]);
  assert.equal(BoatManager.getBoatAboard(player), undefined);
  assert.equal(BoatManager.getBoat(boat.entityIndex), undefined);
  assert.equal(player.getArea(), null);
});

test("teleporting off the boat sinks it; a shipwright recovers it for 250 coins", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);

  player.moveTo(new Location(3222, 3218, 0)); // any teleport: spell, tablet, command, death

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "sunk" });
  assert.equal(BoatManager.getBoat(boat.entityIndex), undefined);
  assert.deepEqual(tileOf(player), [3222, 3218, 0], "the teleport itself still happens");
  assert.equal(Sailing.board(player, DOCK.id), "Your boat has sunk. A shipwright can recover it for you.");

  assert.equal(Sailing.recover(player, 0, DOCK.id), null);
  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: DOCK.id });
  assert.equal(Sailing.recover(player, 0, DOCK.id),
    "That boat is already at the nearby dock. There's no need to recover it.");
  assert.equal(Sailing.recover(player, 3, DOCK.id), "You can't choose that boat at the moment.");
  assert.equal(Sailing.board(player, DOCK.id), null);
  Sailing.disembark(player, DOCK.id);
});

test("boarding a chosen boat takes that slot, and only if it's moored here", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.giveBoat(player, "raft", DOCK.id);
  player.getSailing().boats[0].location = { kind: "sunk" };
  assert.equal(Sailing.board(player, DOCK.id, 0), "You can't choose that boat at the moment.");
  assert.equal(Sailing.board(player, DOCK.id, 1), null);
  assert.equal(Sailing.activeBoat(player).slot, 1);
  Sailing.disembark(player, DOCK.id);
});

test("moving about on the deck is not a teleport off the boat", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);
  player.moveTo(new Location(boat.deckBaseX + 3, boat.deckBaseY + 2, 0));
  assert.equal(Sailing.activeBoat(player).location.kind, "at_sea");
  assert.equal(BoatManager.getBoatAboard(player), boat);
  Sailing.disembark(player, DOCK.id);
});

test("Escape sinks the boat and returns the player to their last dock", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);

  Sailing.escape(player);

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "sunk" });
  assert.deepEqual(tileOf(player), [3069, 2987, 0]);
  assert.equal(BoatManager.getBoatAboard(player), undefined);
});

test("the boat's position is recorded every tick, so a save at sea restores it", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);
  boat.moveMode = BoatMoveMode.Full;
  const sailable = BoatManager.isSailable;
  BoatManager.isSailable = () => true;
  try {
    BoatManager.tick();
  } finally {
    BoatManager.isSailable = sailable;
  }
  assert.deepEqual(Sailing.activeBoat(player).location,
    { kind: "at_sea", fineX: boat.fineX, fineY: boat.fineY, level: 0, angle: boat.angle, dock: DOCK.id },
    "with the port it last docked at");
  assert.equal(boat.fineY, DOCK.mooring.fineY + 192);
  Sailing.disembark(player, DOCK.id);
});

test("logging out at sea keeps the boat at sea, and logging in puts the player back aboard", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);
  boat.fineX += 640;
  boat.angle = EAST;

  Sailing.onLogout(player);

  const saved = normalizeSailingState(JSON.parse(JSON.stringify(player.getSailing())));
  assert.deepEqual(saved.boats[0].location, { kind: "at_sea", fineX: boat.fineX, fineY: boat.fineY, level: 0, angle: EAST, dock: DOCK.id });
  assert.deepEqual(tileOf(player), [3069, 2987, 0], "saved ashore in case the boat can't be restored");
  assert.equal(BoatManager.getBoat(boat.entityIndex), undefined, "disposed after the state is recorded");

  const returning = sailor(saved);
  Sailing.onLogin(returning);
  const restored = BoatManager.getBoatAboard(returning);
  assert.ok(restored);
  assert.deepEqual([restored.fineX, restored.fineY, restored.angle], [boat.fineX, boat.fineY, EAST]);
  assert.deepEqual(tileOf(returning), [restored.deckBaseX + 3, restored.deckBaseY + 4, 0]);
  Sailing.disembark(returning, DOCK.id);
});

test("a save on a deck with no boat to return to lands the player ashore", () => {
  const player = sailor({ boats: [], activeBoatSlot: null, returnPoint: { x: 3069, y: 2987, z: 0 } });
  player.setLocation(new Location(9627, 9636, 0));
  Sailing.onLogin(player);
  assert.deepEqual(tileOf(player), [3069, 2987, 0]);
});

test("saved sailing state drops anything malformed", () => {
  assert.deepEqual(normalizeSailingState(undefined), emptySailingState());
  assert.deepEqual(normalizeSailingState({
    boats: [
      { slot: 0, type: "raft", name: [0, 32, 57], location: { kind: "docked", dock: "port_sarim" },
        cargo: [{ id: 31964, amount: 2 }, null, { id: "kit", amount: 1 }, { id: 385, amount: 0 }],
        parts: { hull: 4, keel: 9, sails: "x" } },
      { slot: 0, type: "raft", location: { kind: "docked", dock: "x" } },
      { slot: 1, type: "raft", location: { kind: "at_sea", fineX: "no" } },
      { type: "raft" },
    ],
    activeBoatSlot: 9,
    returnPoint: { x: 1 },
    tools: [0, 4, 4, "log"],
  }), {
    boats: [
      { slot: 0, type: "raft", name: [0, 32, 57], hitpoints: 0, facilities: [], location: { kind: "docked", dock: "port_sarim" },
        cargo: [{ id: 31964, amount: 2 }, null, null, null], parts: { hull: 4, keel: 0, sails: 0, helm: 0 } },
      { slot: 1, type: "raft", name: [0, 0, 0], hitpoints: 0, facilities: [], location: { kind: "sunk" }, cargo: [],
        parts: { hull: 0, keel: 0, sails: 0, helm: 0 } },
    ],
    activeBoatSlot: null,
    returnPoint: null,
    tools: [0, 4],
    lastDock: null,
    lastStandardDock: null,
  });
});

// --- Content plugins.

test("the sail buttons follow their labels for each move mode", () => {
  const { sailButtonTransition } = require("../plugins/skills/sailing/Helm.plugin");
  // mode: 0 stopped, 1 slow, 2 fast, 3 reversing, 4 moored
  const table = [0, 1, 2, 3, 4].map((mode) => [0, 1, 2].map((slot) => sailButtonTransition(slot, mode) ?? "-"));
  assert.deepEqual(table, [
    ["full", "reverse", "half"],
    ["stop", "stop", "full"],
    ["stop", "half", "-"],
    ["stop", "-", "stop"],
    ["full", "reverse", "half"],
  ]);
  assert.equal(sailButtonTransition(3, 0), undefined);
});

function registerPlugin(file) {
  const hooks = { objects: {}, objectHandlers: [], npcs: {}, events: {}, emitted: [], interfaceClicks: [] };
  require(`../plugins/skills/sailing/${file}`).register({
    onObjectInteraction: (name, actions) => {
      if (typeof name === "function") hooks.objectHandlers.push(name);
      else hooks.objects[name] = actions;
    },
    emitCustomEvent: (name, payload) => hooks.emitted.push([name, payload]),
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onCustomEvent: (name, handler) => { hooks.events[name] = handler; },
    onInterfaceActionClick: (handler) => hooks.interfaceClicks.push(handler),
    onObjectRoute: (handler) => { hooks.route = handler; },
    persistAttribute: () => {},
    onPlayerLogin: (handler) => { hooks.login = handler; },
    onPlayerLogout: () => {},
    onServerStartup: (handler) => { hooks.startup = handler; },
    spawnNpc: (definition) => { hooks.spawned = definition; return null; },
    removeNpc: () => {},
    sendMultiChatboxPrompt: (_player, title, ...pairs) => { hooks.prompt = { title, pairs }; },
  });
  return hooks;
}

test("the sailing plugins register their hooks and load the boat and dock data", () => {
  assert.deepEqual(Object.keys(registerPlugin("Gangplank.plugin").objects.Gangplank), ["Board", "Disembark"]);
  const helm = registerPlugin("Helm.plugin");
  assert.deepEqual(Object.keys(helm.objects.Helm), ["Navigate", "Stop-navigating", "Escape"]);
  assert.equal(helm.interfaceClicks.length, 1);
  assert.deepEqual(Object.keys(registerPlugin("Sailing.plugin").events).sort(), ["sailing:boarded", "sailing:left"]);
  assert.deepEqual(Object.keys(registerPlugin("Shipwright.plugin").npcs), ["Junior Jim"]);
  assert.ok(Sailing.getDock("the_pandemonium"));
});

test("Navigate walks the player onto the helm's tile first", () => {
  const { route } = registerPlugin("Helm.plugin");
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const helm = new Location(9603, 9604, 0);
  const click = (name, clickType) => {
    const event = {
      player,
      object: { getLocation: () => helm },
      definition: { getName: () => name, getInteractions: () => ["Navigate", null, null, "Escape", null] },
      clickType,
      destination: null,
    };
    route(event);
    return event.destination;
  };
  try {
    assert.deepEqual(click("Helm", 1), { x: 9603, y: 9604, z: 0 });
    assert.equal(click("Helm", 4), null, "Escape keeps the normal reach");
    assert.equal(click("Sails", 1), null);
  } finally {
    Sailing.disembark(player, DOCK.id);
  }
});

test("the helm's Escape asks first and only sinks the boat on yes", () => {
  const helm = registerPlugin("Helm.plugin");
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);

  helm.objects.Helm.Escape({ player });
  const [yes, onYes, no, onNo] = helm.prompt.pairs;
  assert.deepEqual([yes, no], ["Yes, abandon ship.", "No."]);
  onNo();
  assert.ok(Sailing.instanceAboard(player));
  onYes();
  assert.equal(Sailing.instanceAboard(player), undefined);
  assert.equal(Sailing.activeBoat(player).location.kind, "sunk");
});

/** A player at Junior Jim with a bank, choosing through the boat selection interface. */
function shipwrightHarness(bankCoins) {
  const shipwright = registerPlugin("Shipwright.plugin");
  const [chooseBoat] = registerPlugin("BoatSelection.plugin").interfaceClicks;
  const player = sailor();
  let interfaceId = -1;
  player.getInterfaceId = () => interfaceId;
  player.setInterfaceId = (id) => { interfaceId = id; return player; };
  const bank = new Inventory(player);
  bank.resetItems();
  if (bankCoins) bank.add(new Item(995, bankCoins), false);
  player.getBank = () => bank;
  player.getCurrentBankTab = () => 0;
  const varbits = new Map();
  const scripts = [];
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendInterfaceScript") scripts.push(args[0]);
      if (key === "sendInterfaceRemoval") interfaceId = -1;
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  const recover = () => shipwright.npcs["Junior Jim"]["Recover-boat"]({
    player, npc: { getDefinition: () => ({ getName: () => "Junior Jim" }) },
  });
  const choose = (slot) => chooseBoat({ player, groupId: 934, childId: 5, action: slot + 1, handled: false });
  return { player, bank, varbits, scripts, recover, choose, shipwright };
}

test("Junior Jim's Recover-boat asks which boat, takes the fee from the bank and docks it here", () => {
  const h = shipwrightHarness(1000);
  Sailing.giveBoat(h.player, "raft", "the_pandemonium");
  Sailing.activeBoat(h.player).location = { kind: "sunk" };

  h.recover();
  assert.equal(h.player.getInterfaceId(), 934);
  assert.equal(h.varbits.get(18553), 5, "the boat selection interface in Recover mode");
  h.choose(0);

  assert.deepEqual(Sailing.activeBoat(h.player).location, { kind: "docked", dock: "the_pandemonium" });
  assert.equal(h.bank.getAmount(995), 750);
  assert.deepEqual(h.player.messages, ["Payment has been taken from your bank."]);
  assert.equal(h.varbits.get(19260), 1, "the boat's port varbit shows The Pandemonium");
  assert.equal(h.player.getInterfaceId(), -1, "choosing closes the interface");
  assert.ok(h.scripts.includes(2158), "and gives the chatbox its input back (chatdefault_restoreinput)");

  h.recover();
  h.choose(0);
  assert.equal(h.player.messages.at(-1), "That boat is already at the nearby dock. There's no need to recover it.");
  assert.equal(h.bank.getAmount(995), 750, "nothing is charged for a refused recovery");
});

test("with more than one boat, the gangplank's Board asks which one", () => {
  const h = shipwrightHarness(0);
  const board = registerPlugin("Gangplank.plugin").objects.Gangplank.Board;
  Sailing.giveBoat(h.player, "raft", "the_pandemonium");
  Sailing.giveBoat(h.player, "raft", "the_pandemonium");
  board({ player: h.player, location: { x: 3070, y: 2987, z: 0 } });
  assert.equal(h.player.getInterfaceId(), 934);
  assert.equal(h.varbits.get(18553), 3, "the boat selection interface in Board mode");
});

test("each owned boat is described to the client by its varbit block", () => {
  const { slotVarbits } = require("../plugins/skills/sailing/boatVarbits");
  const player = sailor();
  Sailing.giveBoat(player, "raft", "the_pandemonium", [0, 32, 57]);
  const raft = slotVarbits(0, player.getSailing().boats[0]);
  const expected = { 19258: 1, 19259: 0, 19260: 1, 19261: 255, 19262: 1, 19263: 0, 19264: 32, 19265: 57, 19273: 15, 19458: 20, 19463: 20 };
  for (const [id, value] of Object.entries(expected)) assert.equal(raft.get(Number(id)), value, `varbit ${id}`);
  player.getSailing().boats[0].location = { kind: "sunk" };
  assert.equal(slotVarbits(0, player.getSailing().boats[0]).get(19260), 253, "a sunk boat is \"lost at sea\" (port 0 is Port Sarim)");
  assert.equal(slotVarbits(2, undefined).get(19334), 0, "an empty slot isn't owned");
});

test("a boat's deck locs exist on the deck level people stand on, so clicks resolve", () => {
  const boat = BoatManager.spawn(1, { ...RAFT, locs: [{ id: 59554, x: 3, y: 4, level: 1, shape: 10, rotation: 0 }] }, AT_SEA);
  try {
    const [helm] = BoatManager.getDeck(boat).getObjects();
    assert.equal(helm.getId(), 59554);
    assert.deepEqual([helm.getLocation().getX(), helm.getLocation().getY(), helm.getLocation().getZ()],
      [boat.deckBaseX + 3, boat.deckBaseY + 4, 0]);
    assert.equal(helm.getPrivateArea(), BoatManager.getDeck(boat));
  } finally {
    BoatManager.dispose(boat);
  }
});

test("::raft gives a raft moored at The Pandemonium; ::boatinfo lists boats", () => {
  const commands = {};
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler) => { commands[name] = handler; },
    persistAttribute: () => {},
  });
  const player = sailor();
  commands.raft({ player, parts: ["raft"] });
  const boat = Sailing.activeBoat(player);
  assert.deepEqual(boat.location, { kind: "docked", dock: "the_pandemonium" });
  assert.equal(boat.name[0], 0, "the first word list is empty in this revision");
  assert.ok(boat.name[1] > 0 && boat.name[2] > 0, "a new boat gets a random name");
  const name = boatName(boat);
  commands.boatinfo({ player, parts: ["boatinfo"] });
  assert.deepEqual(player.messages, [
    `The ${name}, a raft, is moored for you at The Pandemonium (slot 0).`,
    `Slot 0: raft "${name}", docked at the_pandemonium (active)`,
  ]);
});

test("::pandemonium is a developer command that teleports to the dock, sinking a boat you're on", () => {
  const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
  const commands = {};
  const rights = {};
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler, minimum) => { commands[name] = handler; rights[name] = minimum; },
    persistAttribute: () => {},
  });
  assert.equal(rights.pandemonium, PlayerRights.DEVELOPER);

  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  commands.pandemonium({ player, parts: ["pandemonium"] });
  const at = player.getLocation();
  assert.deepEqual([at.x, at.y, at.z], [DOCK.landing.x, DOCK.landing.y, DOCK.landing.z]);
  assert.equal(Sailing.activeBoat(player).location.kind, "sunk");
});

test("leaving the boat by logging out sends nothing to the (closed) client", () => {
  const { events } = registerPlugin("Sailing.plugin");
  let sent = 0;
  const player = { getPacketSender: () => { sent++; throw new Error("the socket is closed"); } };
  assert.doesNotThrow(() => events["sailing:left"]({ player, reason: "logout" }));
  assert.equal(sent, 0);
});

test("boarding sends the raft's varbits and stats as live OSRS does", () => {
  const [switchTab] = registerPlugin("Sailing.plugin").interfaceClicks;
  const player = sailor();
  const varbits = new Map();
  const varps = new Map();
  const sender = new Proxy({}, {
    get: (_t, key) => key === "sendVarbit"
      ? (id, value) => { varbits.set(id, value); return sender; }
      : key === "sendConfig"
        ? (id, value) => { varps.set(id, value); return sender; }
        : () => sender,
  });
  player.getPacketSender = () => sender;
  Sailing.giveBoat(player, "raft", "the_pandemonium");
  Sailing.board(player, "the_pandemonium");
  try {
    switchTab({ player, groupId: 593, childId: 46, handled: false });
    // Boat slot (from 1) and type (raft 0).
    for (const [id, value] of [[19121, 1], [18554, 1], [19130, 1], [19137, 0], [19143, 0]]) {
      assert.equal(varbits.get(id), value, `varbit ${id}`);
    }
    // Speed stats: base 192 (1.5 tiles a tick), cap 320, boost 20, acceleration 64.
    for (const [id, value] of [[19250, 192], [19251, 320], [19256, 20], [19257, 64]]) {
      assert.equal(varbits.get(id), value, `varbit ${id}`);
    }
    assert.equal(varbits.has(19145), false, "OSRS doesn't set the last-dock varbit on boarding");
    for (const [id, value] of [[5117, 8110], [5147, 1], [5159, 24], [5160, 11], [5161, 6], [5162, 9], [5163, 4], [5164, 13], [5165, 26]]) {
      assert.equal(varps.get(id), value, `varp ${id}`);
    }
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("the combat tab's View button shows the sailing sidepanel aboard, and Combat Options switches back", () => {
  const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
  const [switchTab] = registerPlugin("Sailing.plugin").interfaceClicks;
  const player = sailor();
  const mounted = [];
  const events = [];
  const sender = new Proxy({}, {
    get: (_t, key) => key === "sendSubInterface"
      ? (uid, group) => { mounted.push([uid >>> 16, uid & 0xffff, group]); return sender; }
      : key === "sendInterfaceFlagsRange"
        ? (uid, from, to, flags) => { events.push([uid >>> 16, uid & 0xffff, from, to, flags]); return sender; }
        : () => sender,
  });
  player.getPacketSender = () => sender;

  const click = (groupId, childId) => {
    const event = { player, groupId, childId, handled: false };
    switchTab(event);
    return event.handled;
  };
  assert.equal(click(593, 46), true);
  assert.deepEqual(mounted, [], "not aboard: nothing to show");

  Sailing.giveBoat(player, "raft", "the_pandemonium");
  Sailing.board(player, "the_pandemonium");
  click(593, 46);
  assert.deepEqual(mounted, [[161, 76, 937]]);
  assert.deepEqual(events, [[937, 1, 0, 12, 2], [937, 25, 0, 16, 30]],
    "View Combat Options and the raft's facility buttons get OSRS's event ranges");

  const assign = WeaponInterfaceManager.assign;
  let restored = 0;
  WeaponInterfaceManager.assign = () => { restored++; };
  try {
    assert.equal(click(937, 1), true);
  } finally {
    WeaponInterfaceManager.assign = assign;
  }
  assert.equal(restored, 1);
  assert.equal(click(593, 12), false, "other combat buttons are left alone");
  Sailing.disembark(player, "the_pandemonium");
});

// --- Cargo hold.

function holdHarness() {
  const hold = registerPlugin("CargoHold.plugin");
  const player = sailor();
  player.attributes = new Map();
  let interfaceId = -1;
  let amountAction = null;
  player.getInterfaceId = () => interfaceId;
  player.setInterfaceId = (id) => { interfaceId = id; return player; };
  player.setEnteredAmountAction = (action) => { amountAction = action; };
  const sent = { inventories: [], varps: new Map(), varbits: new Map(), sounds: [], scripts: [], prompt: null };
  const record = {
    sendInventory: (id, capacity, items) => sent.inventories.push({ id, capacity, items: items.map((slot) => slot && { ...slot }) }),
    sendConfig: (id, value) => sent.varps.set(id, value),
    sendVarbit: (id, value) => sent.varbits.set(id, value),
    sendSoundEffect: (id) => sent.sounds.push(id),
    sendInterfaceScript: (id, args) => sent.scripts.push([id, ...(args ?? [])]),
    sendEnterAmountPrompt: (title) => { sent.prompt = title; },
  };
  const sender = new Proxy({}, { get: (_t, key) => (...args) => { record[key]?.(...args); return sender; } });
  player.getPacketSender = () => sender;
  Sailing.giveBoat(player, "raft", DOCK.id, [0, 32, 57]); // "Extreme Pride"
  Sailing.board(player, DOCK.id);
  const click = (groupId, childId, action, slot, itemId) => {
    const event = { player, groupId, childId, action, slot, itemId, handled: false };
    hold.interfaceClicks[0](event);
    return event.handled;
  };
  const slotOf = (id) => player.getInventory().getItems().findIndex((item) => item?.getId() === id);
  const give = (id, amount = 1) => player.getInventory().add(new Item(id, amount), false);
  return {
    hold, player, sent, click, slotOf, give,
    boat: () => Sailing.activeBoat(player),
    open: () => hold.objects["Basic cargo hold"].Open({ player }),
    answer: (amount) => amountAction.execute(amount),
    done: () => Sailing.disembark(player, DOCK.id),
  };
}

test("opening the cargo hold sends the boat's hold and opens 943 and 944 as live OSRS does", () => {
  const h = holdHarness();
  try {
    h.give(31964);
    h.give(8794);
    h.open();
    assert.equal(h.player.getInterfaceId(), 943);
    assert.equal(h.sent.varps.get(5204), 963, "the raft in slot 0 uses inventory 963");
    assert.deepEqual(h.sent.inventories.at(-1), { id: 963 + 32768, capacity: 20, items: [] },
      "sent as the scripts' \"other\" inventory, as live OSRS does");
    assert.equal(h.sent.varps.get(5205), 1, "only the repair kit's slot can be deposited");
    assert.ok(h.sent.sounds.includes(10907));
    assert.ok(h.sent.scripts.some(([id, frame, title]) => id === 227 && frame === ((943 << 16) | 1) && title === "Cargo Hold: Extreme Pride"));
  } finally {
    h.done();
  }
});

test("depositing and withdrawing follow the selected quantity and the op", () => {
  const h = holdHarness();
  try {
    for (let i = 0; i < 3; i++) h.give(31964);
    h.open();
    assert.equal(h.click(944, 1, 1, h.slotOf(31964), 31964), true);
    assert.equal(cargo.countIn(h.boat(), 31964), 1, "op 1 with quantity 1 deposits one");
    assert.equal(h.sent.varbits.get(19210), 5, "the sidepanel counts 5 uses per kit in the hold");

    h.click(943, 21, 1);
    assert.equal(h.sent.varbits.get(4430), 1, "the 5 button sets depositbox_mode 1");
    h.click(944, 1, 1, h.slotOf(31964), 31964);
    assert.equal(cargo.countIn(h.boat(), 31964), 3, "op 1 with quantity 5 deposits the other two");
    assert.equal(h.player.getInventory().getAmount(31964), 0);

    h.click(943, 10, 2, 0, 31964);
    assert.equal(h.player.getInventory().getAmount(31964), 1, "op 2 is always 1");
    h.click(943, 10, 6, 1, 31964);
    assert.equal(h.player.getInventory().getAmount(31964), 3, "op 6 is All, across the kit's slots");
    assert.equal(h.sent.varbits.get(19210), 0);
  } finally {
    h.done();
  }
});

test("X prompts for an amount, and the hold refuses what it can't store", () => {
  const h = holdHarness();
  try {
    for (let i = 0; i < 3; i++) h.give(31964);
    h.give(8794);
    h.open();
    h.click(944, 1, 5, h.slotOf(31964), 31964);
    assert.equal(h.sent.prompt, "Enter amount:");
    h.answer(2);
    assert.equal(cargo.countIn(h.boat(), 31964), 2);

    h.click(944, 1, 1, h.slotOf(8794), 8794);
    assert.deepEqual(h.player.messages.slice(-1), ["The cargo hold cannot store that item."]);
    assert.equal(h.player.getInventory().getAmount(8794), 1);
  } finally {
    h.done();
  }
});

test("a stack takes one slot, and a full hold says so", () => {
  const h = holdHarness();
  try {
    h.give(2, 500);
    for (let i = 0; i < 26; i++) h.give(31964);
    h.open();
    h.click(943, 24, 1);
    h.click(944, 1, 1, h.slotOf(2), 2);
    assert.deepEqual(h.boat().cargo[0], { id: 2, amount: 500 });
    h.click(944, 1, 1, h.slotOf(31964), 31964);
    assert.equal(cargo.countIn(h.boat(), 31964), 19, "the raft's 20 slots, one used by the cannonballs");
    assert.equal(h.player.getInventory().getAmount(31964), 7);
    assert.deepEqual(h.player.messages.slice(-1), ["Your cargo hold is full."]);
  } finally {
    h.done();
  }
});

test("tools go to the tools compartment and come back out, without using space", () => {
  const h = holdHarness();
  try {
    h.give(31986);
    h.give(7534);
    h.give(7535);
    h.open();
    h.click(943, 15, 1);
    assert.deepEqual(h.player.getSailing().tools.sort(), [0, 4]);
    assert.equal(h.player.getInventory().getValidItems().length, 0);
    assert.deepEqual(h.boat().cargo, [], "tools take no hold space");
    assert.ok(h.sent.sounds.includes(10905));

    h.click(943, 18, 1, 4);
    assert.equal(h.player.getInventory().getAmount(7534) + h.player.getInventory().getAmount(7535), 2);
    assert.deepEqual(h.player.messages.slice(-1), ["You collect some diving gear from the tools compartment."]);
    assert.deepEqual(h.player.getSailing().tools, [0]);
    assert.ok(h.sent.sounds.includes(2582));
  } finally {
    h.done();
  }
});

test("Deposit Cargo and Deposit Salvage only take their own items", () => {
  const h = holdHarness();
  try {
    h.give(31964);
    h.open();
    h.click(943, 13, 1);
    assert.deepEqual(h.player.messages.slice(-1), ["You have no cargo to deposit."]);
    h.click(943, 14, 1);
    assert.deepEqual(h.player.messages.slice(-1), ["You have no salvage to deposit."]);
    assert.ok(h.sent.sounds.includes(2277));
    h.give(32435);
    h.click(943, 13, 1);
    assert.equal(cargo.countIn(h.boat(), 32435), 1);
    assert.equal(cargo.countIn(h.boat(), 31964), 0, "the repair kit isn't cargo");
  } finally {
    h.done();
  }
});

test("a shipwright's recovery loses courier crates, salvage and fish, and keeps supplies", () => {
  const h = shipwrightHarness(1000);
  Sailing.giveBoat(h.player, "raft", "the_pandemonium");
  const boat = Sailing.activeBoat(h.player);
  boat.location = { kind: "sunk" };
  boat.cargo = [{ id: 32435, amount: 1 }, { id: 31964, amount: 1 }, { id: 385, amount: 1 }];
  h.recover();
  h.choose(0);
  assert.equal(boat.location.kind, "docked");
  assert.deepEqual(boat.cargo, [null, { id: 31964, amount: 1 }, null]);
});

test("the hold's item ops map to amounts as cache scripts 8873 and 8896 label them", () => {
  const { opAmount } = require("../plugins/skills/sailing/CargoHold.plugin");
  const player = { getAttribute: () => 4 };
  assert.equal(opAmount(player, 1), 10, "op 1 is the selected quantity (mode 4 = 10)");
  assert.deepEqual([2, 3, 4, 6].map((op) => opAmount(player, op)), [1, 5, 10, Number.MAX_SAFE_INTEGER]);
  assert.equal(opAmount(player, 5), undefined, "X prompts");
});

test("::sailingtools shows every tool, and the hold keeps sending it after a relog", () => {
  const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");
  const commands = {};
  const rights = {};
  const persisted = [];
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler, minimum) => { commands[name] = handler; rights[name] = minimum; },
    persistAttribute: (key) => persisted.push(key),
  });
  assert.equal(rights.sailingtools, PlayerRights.DEVELOPER);
  assert.ok(persisted.includes("sailing:tools-unlocked"));

  const h = holdHarness();
  try {
    h.open();
    assert.equal(h.sent.varbits.has(18314), false, "not unlocked: only the captain's log shows");
    commands.sailingtools({ player: h.player, parts: ["sailingtools"] });
    assert.deepEqual([18314, 18282, 18317, 1895].map((id) => h.sent.varbits.get(id)), [50, 40, 20, 40]);
    h.sent.varbits.clear();
    h.open();
    assert.equal(h.sent.varbits.get(18314), 50, "opening the hold sends them again");
  } finally {
    h.done();
  }
});

// --- Skiff and sloop.

test("the skiff and sloop moor at their own spot and board onto the captured deck tiles", () => {
  for (const [type, boardingTile, speed] of [["skiff", [4, 4], 192], ["sloop", [3, 8], 192]]) {
    const player = sailor();
    Sailing.giveBoat(player, type, "the_pandemonium");
    assert.equal(Sailing.board(player, "the_pandemonium"), null, type);
    const boat = BoatManager.getBoatAboard(player);
    try {
      assert.deepEqual(tileOf(player), [boat.deckBaseX + boardingTile[0], boat.deckBaseY + boardingTile[1], 0], type);
      assert.equal(boat.fineX, 3075 * 128 + 64, `${type} moors one tile east of the raft, as captured`);
      assert.equal(boat.baseSpeed, speed, `${type}'s wooden hull sails 1.5 tiles a tick`);
      boat.moveMode = BoatMoveMode.Full;
      const startY = boat.fineY;
      tickBoat(boat, () => true);
      assert.equal(boat.fineY - startY, speed);
    } finally {
      Sailing.disembark(player, "the_pandemonium");
    }
  }
});

test("boarding a new skiff sends its base-tier stats and only its cargo hold", () => {
  const [switchTab] = registerPlugin("Sailing.plugin").interfaceClicks;
  const player = sailor();
  const varbits = new Map();
  const varps = new Map();
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendConfig") varps.set(args[0], args[1]);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  Sailing.giveBoat(player, "skiff", "the_pandemonium");
  Sailing.board(player, "the_pandemonium");
  try {
    switchTab({ player, groupId: 593, childId: 46, handled: false });
    // Wooden hull, bronze keel, wooden helm, sails and trim (the cache's part rows): HP 30 + 50.
    const expected = {
      19137: 1, // boat type: skiff
      19156: 0, 19160: 0, 19161: 0, 19162: 1, // only the basic cargo hold, in hotspot 6
      19154: 0, 19155: 0, 19167: 0, 19168: 0, 19172: 0, // every part at its base tier
      19248: 0, 19249: 0, 19252: 0, 19253: 0, // no resistances
      19250: 192, 19251: 384, 19256: 20, 19257: 64, 19177: 80, // speed cap from the wooden hull's row
    };
    for (const [id, value] of Object.entries(expected)) assert.equal(varbits.get(Number(id)), value, `varbit ${id}`);
    assert.equal(varps.get(5117), 8111);
    assert.equal(varps.get(5148), 100, "armour from the bronze keel");
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("::skiff and ::sloop moor new boats for testing", () => {
  const commands = {};
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler) => { commands[name] = handler; },
    persistAttribute: () => {},
  });
  const player = sailor();
  commands.skiff({ player, parts: ["skiff"] });
  commands.sloop({ player, parts: ["sloop"] });
  assert.deepEqual(player.getSailing().boats.map((boat) => boat.type), ["skiff", "sloop"]);
});

// --- Boat parts and the shipyard.

test("the Build trigger's argument decodes as the live capture's option row", () => {
  const { readOptionRow } = require("../plugins/skills/sailing/Shipyard.plugin");
  // Live OSRS sent [-90, -127, 1, 0] building a camphor skiff hull: row 8275.
  assert.equal(readOptionRow(Buffer.from([0xa6, 0x81, 0x01, 0x00])), 8275);
  assert.equal(readOptionRow(Buffer.alloc(0)), undefined);
});

test("a boat's parts rebuild the captured upgraded boats from the cache", () => {
  const parts = require("../plugins/skills/sailing/boatParts");
  const { boatType } = require("../plugins/skills/sailing/sailingContent");
  const locIds = (spec) => Object.fromEntries(spec.locs.filter((loc) => loc.part).map((loc) => [loc.part, loc.id]));
  // The captured skiff: camphor hull, steel keel, teak sails, oak helm.
  const skiff = { type: "skiff", parts: { hull: 4, keel: 2, sails: 2, helm: 1 } };
  const skiffSpec = parts.specFor(skiff, boatType("skiff"));
  assert.equal(skiffSpec.templateChunkX, 484, "camphor is the template's fifth column");
  assert.deepEqual(locIds(skiffSpec), { helm: 59579, sails: 59539, keel: 59518, trim: 59628 });
  assert.deepEqual(parts.boatStats(skiff), {
    hitpoints: 180, armour: 300, baseSpeed: 320, speedCap: 384, acceleration: 64,
    speedBoostDuration: 24, stormResistance: 1, rapidResistance: 1, crystalFleckedResistance: 0,
  });
  // The captured sloop: camphor hull, adamant keel, camphor sails, mahogany helm.
  const sloop = { type: "sloop", parts: { hull: 4, keel: 4, sails: 4, helm: 3 } };
  assert.deepEqual(locIds(parts.specFor(sloop, boatType("sloop"))), { helm: 59607, sails: 59548, keel: 59527, trim: 59646 });
  assert.equal(parts.boatStats(sloop).hitpoints, 260);
  assert.equal(parts.boatStats(sloop).acceleration, 128);
  assert.deepEqual([parts.recoveryFee({ type: "raft" }), parts.recoveryFee({ type: "skiff" }), parts.recoveryFee(sloop)], [250, 3750, 50000]);
});

const { TaskManager } = require("../dist/game/task/TaskManager");

/** Drops tasks earlier tests left queued: one that throws stops the whole tick. */
function clearTasks() {
  while (TaskManager.pendingTasks.shift() != null);
  TaskManager.activeTasks.length = 0;
}

function shipyardHarness() {
  clearTasks();
  const { Skill } = require("../dist/game/model/Skill");
  const shipyard = registerPlugin("Shipyard.plugin");
  registerPlugin("Sailing.plugin"); // the part-built spec resolver
  const player = sailor();
  const levels = new Map([[Skill.SAILING, 1], [Skill.CONSTRUCTION, 1]]);
  const xp = [];
  const statements = [];
  let interfaceId = -1;
  player.getSkillManager = () => ({
    getMaxLevel: (skill) => levels.get(skill) ?? 1,
    addExperience: (skill, amount) => xp.push([skill.getName(), amount]),
  });
  player.getDialogueManager = () => ({ startDialogues: (chain) => statements.push(chain) });
  player.getInterfaceId = () => interfaceId;
  player.setInterfaceId = (id) => { interfaceId = id; return player; };
  const varbits = new Map();
  const chatboxes = [];
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendChatboxInterface") chatboxes.push(args[0]);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  player.getAttribute = () => undefined;
  Sailing.giveBoat(player, "skiff", "the_pandemonium");
  const dock = Sailing.getDock("the_pandemonium");
  require("../plugins/skills/sailing/Shipyard.plugin").beginVisit(player, dock, 0);
  const buildRow = (row) => {
    const zigzag = (row << 1) ^ (row >> 31);
    const bytes = [];
    let v = zigzag >>> 0;
    while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
    bytes.push(v, 0);
    const event = { player, groupId: 939, childId: 17, scriptTrigger: true, argsData: Buffer.from(bytes), handled: false };
    shipyard.interfaceClicks.forEach((handler) => handler(event));
    return event.handled;
  };
  return { Skill, shipyard, player, levels, xp, statements, varbits, chatboxes, buildRow, boat: () => player.getSailing().boats[0] };
}

test("building at the schematics swaps a part for the cache's materials and gives Construction XP", () => {
  const h = shipyardHarness();
  const OAK_HULL = 8272; // skiff: Sailing 20, Construction 8; 10 oak hull parts, 300 iron nails, 20 swamp tar
  assert.equal(h.buildRow(OAK_HULL), true);
  assert.match(h.player.messages.at(-1), /Sailing level of 20 and a Construction level of 8/);
  h.levels.set(h.Skill.SAILING, 20);
  h.levels.set(h.Skill.CONSTRUCTION, 8);
  h.buildRow(OAK_HULL);
  assert.equal(h.player.messages.at(-1), "You don't have the materials needed to build that.");
  for (const [item, count] of [[32044, 10], [4820, 300], [1939, 20]]) h.player.getInventory().add(new Item(item, count), false);
  h.buildRow(OAK_HULL);
  assert.equal(h.boat().parts.hull, 1, "the hull is now oak");
  assert.deepEqual([32044, 4820, 1939].map((item) => h.player.getInventory().getAmount(item)), [0, 0, 0]);
  assert.deepEqual(h.xp, [["Construction", 238]]);
  assert.deepEqual(h.chatboxes, [229], "the workers' message box, shown through the fade");
  assert.equal(h.statements.length, 0, "not continuable until the fade in");
  for (let tick = 0; tick < 4; tick++) TaskManager.process();
  assert.equal(h.statements.length, 1, "continuable once faded back in");
  // Back to wooden: a downgrade costs its own materials and the oak hull isn't refunded.
  h.buildRow(8271);
  assert.equal(h.player.messages.at(-1), "You don't have the materials needed to build that.");
  assert.equal(h.player.getInventory().getAmount(32044), 0);
});

test("leaving the shipyard takes its boat away", () => {
  const h = shipyardHarness();
  const shown = [...Array(1000).keys()].map((i) => BoatManager.getBoat(3000 + i)).filter((boat) => boat?.ownerPlayerId === h.player.getIndex());
  assert.equal(shown.length, 1, "the chosen boat is shown in the shipyard");
  assert.equal(h.varbits.get(18314), 50, "sailing_intro, or the schematics refuse every build");
  h.player.moveTo(new Location(3058, 2980, 0));
  assert.equal(BoatManager.getBoat(shown[0].entityIndex), undefined);
  assert.equal(h.varbits.get(18314), 0, "the tools stay behind ::sailingtools");
  assert.equal(h.varbits.has(18166), false, "18166 locks Sailing in the skills tab");
});

test("::boatmats spawns a part's materials from the cache, for the named or current boat", () => {
  const commands = {};
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler) => { commands[name] = handler; },
    persistAttribute: () => {},
  });
  const player = sailor();
  commands.boatmats({ player, parts: ["boatmats", "hull", "oak", "skiff"] });
  assert.deepEqual([32044, 4820, 1939].map((item) => player.getInventory().getAmount(item)), [10, 300, 20]);
  assert.equal(player.messages.at(-1), "Spawned the materials for a skiff's Oak hull (Sailing 20, Construction 8).");

  // Without a boat type, the active boat's is used; tiers can be numbers.
  Sailing.giveBoat(player, "skiff", "the_pandemonium");
  commands.boatmats({ player, parts: ["boatmats", "keel", "1"] });
  assert.equal(player.messages.at(-1), "Spawned the materials for a skiff's Iron keel (Sailing 22, Construction 17).");

  for (const parts of [["boatmats", "keel", "bronze", "raft"], ["boatmats", "hull", "gold"], ["boatmats"]]) {
    commands.boatmats({ player, parts });
    assert.match(player.messages.at(-1), /^Usage: ::boatmats/, parts.join(" "));
  }
});

// --- Facilities.

const facilities = require("../plugins/skills/sailing/boatFacilities");
const { slotVarbits, hotspotVarbit } = require("../plugins/skills/sailing/boatVarbits");

test("a boat's facility hotspots, what they allow and their deck locs come from the cache", () => {
  const sloop = facilities.hotspotsOf("sloop");
  assert.equal(sloop.length, 13, "a sloop has 13 hotspots; 11 and 12 are its cannon spots");
  // Hotspot 2 is where the captured range was built: deck (4, 9), level 1, facing 1.
  assert.deepEqual([sloop[2].x, sloop[2].y, sloop[2].level, sloop[2].side], [4, 9, 1, 3], "on the east side");
  assert.equal(sloop[2].allowed[0], 8512, "the range is first on its list");
  assert.equal(facilities.hotspotsOf("raft").length, 1);
  assert.equal(facilities.hotspotsOf("skiff").length, 7);

  // A new boat has its type's defaults: the raft's cargo hold (position 15) on hotspot 0.
  const raft = { type: "raft", facilities: [] };
  assert.deepEqual(facilities.facilitiesOf(raft), [15]);
  assert.equal(facilities.facilitiesUnaltered(raft), true);
  assert.deepEqual(facilities.hotspotLocs(raft).map((loc) => [loc.id, loc.x, loc.y, loc.blocks]), [[60245, 3, 2, true]],
    "a solid facility blocks its tile");

  // At sea empty hotspots show nothing; in the shipyard their placeholder, which doesn't block.
  assert.deepEqual(facilities.hotspotLocs({ type: "sloop", facilities: [] }).map((loc) => loc.hotspot), [10]);
  const sloopLocs = facilities.hotspotLocs({ type: "sloop", facilities: [] }, true);
  assert.equal(sloopLocs.find((loc) => loc.hotspot === 2).blocks, false);
  assert.equal(sloopLocs.find((loc) => loc.hotspot === 2).id, 59673);
  assert.equal(sloopLocs.find((loc) => loc.hotspot === 12).id, 60721);
  assert.equal(sloopLocs.find((loc) => loc.hotspot === 10).id, 60273, "its cargo hold");

  // Facing: a range faces in (captured at 1 on east hotspot 2), so 3 on the west side; a hook
  // faces out (captured at 1 on the skiff's west hotspot 4); the centre line faces 0.
  const facing = (type, hotspot, facility) => {
    const boat = { type, facilities: [] };
    facilities.setFacility(boat, hotspot, facility);
    return facilities.hotspotLocs(boat, true).find((loc) => loc.hotspot === hotspot).rotation;
  };
  assert.equal(facing("sloop", 2, 8512), 1);
  assert.equal(facing("sloop", 1, 8512), 3);
  assert.equal(facing("skiff", 4, 8444), 1);
  assert.equal(facing("skiff", 6, 8469), 0);
  assert.equal(facing("sloop", 2, undefined), 1, "a placeholder");

  assert.equal(facilities.facilityNamed("Mithril salvaging hook"), 8437);
  assert.deepEqual(facilities.facilityRequirements(8512), {
    name: "Range", sailing: 16, construction: 6, materials: [[2353, 4], [973, 2], [590, 1]],
  });
});

test("the hotspot varbits hold each facility's position in its hotspot's list", () => {
  const sloop = { slot: 2, type: "sloop", name: [0, 0, 0], facilities: [], location: { kind: "docked", dock: DOCK.id }, parts: {} };
  facilities.setFacility(sloop, 2, 8512);
  const values = slotVarbits(2, sloop);
  assert.equal(values.get(19351), 1, "sailing_boat_3_hotspot_2: the range, as captured");
  assert.equal(values.get(19359), 1, "its cargo hold stays");
  assert.equal(values.get(19338), 0, "sailing_boat_3_facilities_unaltered");
  assert.deepEqual([hotspotVarbit(2, 11), hotspotVarbit(2, 12)], [20215, 20216]);
  facilities.setFacility(sloop, 2, undefined);
  assert.equal(slotVarbits(2, sloop).get(19351), 0);
  assert.equal(slotVarbits(2, sloop).get(19338), 0, "still altered once changed");
});

test("aboard in the shipyard, a hotspot's Build builds a facility and Modify removes it", () => {
  const h = shipyardHarness();
  const built = registerPlugin("ShipyardFacilities.plugin");
  h.player.performAnimation = (animation) => { h.player.animation = animation.getId(); };
  const boat = h.boat();
  const shown = [...Array(1000).keys()].map((i) => BoatManager.getBoat(3000 + i)).find((candidate) => candidate?.ownerPlayerId === h.player.getIndex());
  assert.equal(shown.ownerOnly, true, "only its owner sees the boat in the shipyard");
  assert.ok(BoatManager.getSpec(shown).locs.some((loc) => loc.id === 59666), "its empty hotspots show");
  const gangplank = { x: 2087, y: 2723, z: 0 };
  h.shipyard.objects.Gangplank.Board({ player: h.player, location: gangplank });
  assert.equal(BoatManager.getBoatAboard(h.player), shown, "on the shown boat's deck");
  assert.deepEqual(h.shipyard.emitted.map(([name]) => name), ["sailing:boarded"]);

  // The skiff's hotspot 2 allows a range (4th on its list).
  const hotspot = facilities.hotspotsOf("skiff")[2];
  const tile = { x: shown.deckBaseX + hotspot.x, y: shown.deckBaseY + hotspot.y, z: 0 };
  built.objects["Facility hotspot"].Build({ player: h.player, location: tile });
  assert.equal(h.varbits.get(19524), 2, "sailing_boat_customisation_hotspot_id");
  assert.equal(h.varbits.get(19523), 1, "facility mode");
  const trigger = (row) => {
    const zigzag = (row << 1) ^ (row >> 31);
    const bytes = [];
    let v = zigzag >>> 0;
    while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
    bytes.push(v, 0);
    const event = { player: h.player, groupId: 939, childId: 17, scriptTrigger: true, argsData: Buffer.from(bytes), handled: false };
    for (const handler of [...h.shipyard.interfaceClicks, ...built.interfaceClicks]) handler(event);
    return event.handled;
  };
  assert.equal(trigger(8512), true);
  assert.match(h.player.messages.at(-1), /Sailing level of 16 and a Construction level of 6/);
  h.levels.set(h.Skill.SAILING, 16);
  h.levels.set(h.Skill.CONSTRUCTION, 6);
  for (const [item, count] of [[2353, 4], [973, 2], [590, 1]]) h.player.getInventory().add(new Item(item, count), false);
  trigger(8512);
  assert.equal(facilities.facilityAt(boat, 2), 8512);
  assert.deepEqual([2353, 973, 590].map((item) => h.player.getInventory().getAmount(item)), [0, 0, 0]);
  assert.deepEqual(h.xp, [], "building a facility gives no XP");
  assert.equal(h.player.animation, 3676);
  assert.equal(h.varbits.get(19524), 0, "the customisation closed");
  assert.equal(h.varbits.get(19158), 4, "the sidepanel's hotspot 2");
  const rangeLoc = BoatManager.getSpec(shown).locs.find((loc) => loc.x === hotspot.x && loc.y === hotspot.y && loc.shape === 10);
  assert.equal(rangeLoc.id, 59682, "the range replaces the placeholder on the deck");
  assert.equal(rangeLoc.blocks, true, "and blocks its tile, so interacting walks beside it");
  assert.equal(BoatManager.getDeck(shown).getClip(new Location(tile.x, tile.y, 0)), 0x100, "a solid object on a walkable deck tile");
  assert.equal(BoatManager.deckLocChanges(shown).count, 1);

  // Modify: "Completely remove it." then "Yes." puts the placeholder back, refunding nothing.
  const modify = { player: h.player, location: tile, clickType: 5, handled: false,
    definition: { getInteractions: () => ["Cook", null, null, null, "Modify"] } };
  built.objectHandlers.forEach((handler) => handler(modify));
  assert.equal(built.prompt.title, "How would you like to modify this facility?");
  assert.deepEqual(built.prompt.pairs.filter((_, i) => i % 2 === 0), ["Completely remove it.", "Replace it.", "Do nothing."]);
  built.prompt.pairs[1](h.player);
  assert.equal(built.prompt.title, "Really remove it?");
  built.prompt.pairs[1](h.player);
  assert.equal(facilities.facilityAt(boat, 2), undefined);
  assert.equal(h.player.animation, 3685);
  assert.equal(BoatManager.getSpec(shown).locs.find((loc) => loc.x === hotspot.x && loc.y === hotspot.y && loc.shape === 10).id, 59666);
  assert.equal(h.player.getInventory().getAmount(2353), 0);

  h.shipyard.objects.Gangplank.Disembark({ player: h.player, location: { ...gangplank, z: 1 } });
  assert.equal(BoatManager.getBoatAboard(h.player), undefined);
  assert.equal(BoatManager.getBoat(shown.entityIndex), shown, "the boat stays shown in the yard");
});

test("::boatmats facility spawns a facility's materials", () => {
  const commands = {};
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler) => { commands[name] = handler; },
    persistAttribute: () => {},
  });
  const player = sailor();
  commands.boatmats({ player, parts: ["boatmats", "facility", "range"] });
  assert.deepEqual([2353, 973, 590].map((item) => player.getInventory().getAmount(item)), [4, 2, 1]);
  assert.equal(player.messages.at(-1), "Spawned the materials for a Range (Sailing 16, Construction 6).");
  commands.boatmats({ player, parts: ["boatmats", "facility", "sofa"] });
  assert.match(player.messages.at(-1), /^Usage: ::boatmats/);
});

// --- Shipwreck salvaging.

const shipwrecks = require("../plugins/skills/sailing/shipwrecks");
const { content } = require("../plugins/skills/sailing/sailingContent");
const { hookTierOf, successChance, rollLoot, outwardFrom } = require("../plugins/skills/sailing/Salvaging.plugin");

function withRandom(value, run) {
  const random = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = random;
  }
}

test("salvaging's hook tiers, success chance and loot rolls", () => {
  assert.equal(hookTierOf("Bronze salvaging hook"), 0);
  assert.equal(hookTierOf("Dragon salvaging hook"), 6);
  assert.equal(hookTierOf("Range"), -1);
  // The wiki's small shipwreck chart: bronze 50-100 of 256, dragon 67-135.
  assert.equal(successChance(50, 100, 1), 51 / 256);
  assert.equal(successChance(50, 100, 99), 101 / 256);
  assert.equal(successChance(50, 100, 15), 58 / 256);

  const small = content().salvage.salvage[32847];
  assert.equal(small.name, "Small salvage");
  // Every roll below the first pre-roll's 1/750 hits it; otherwise the main table by weight.
  assert.deepEqual(rollLoot(small, () => 0), { item: 31989, amount: 1 }, "boat bottle (empty)");
  const rolls = [0.5, 0.5, 0.5, 0.05, 0];
  assert.deepEqual(rollLoot(small, () => rolls.shift()), { item: 2349, amount: 1 }, "bronze bar, first on the table");
  // Working a hook, the player faces out over its side: the sloop's hook hotspot 7 is on the
  // west side (deck x 2), 8 on the east (x 4).
  const deck = { deckBaseX: 100, deckBaseY: 200 };
  const sloop = { type: "sloop" };
  assert.deepEqual([outwardFrom(deck, { x: 2, y: 5 }, sloop, 7).getX(), outwardFrom(deck, { x: 4, y: 5 }, sloop, 8).getX()], [101, 105]);
  assert.equal(outwardFrom(deck, { x: 2, y: 5 }, undefined, undefined).getX(), 102, "unknown side: the hook itself");
  const coins = small.table.find((line) => line.item === 995);
  assert.deepEqual([coins.min, coins.max, coins.weight], [1, 200, 100]);
});

test("shipwreck sites raise their share of wrecks, and a sunk wreck raises another", () => {
  withRandom(0, () => shipwrecks.start());
  const all = shipwrecks.all();
  const sites = content().salvage.sites;
  assert.equal(all.length, sites.reduce((sum, site) => sum + site.wrecks.length, 0));
  sites.forEach((site, index) => {
    assert.equal(all.filter((wreck) => wreck.site === index && wreck.raised).length, Math.min(site.active, site.wrecks.length));
  });
  // The small wrecks south-east of the Pandemonium: 8 spots, 5 raised.
  const pandemonium = all.filter((wreck) => wreck.type === "small" && wreck.x > 3000);
  assert.equal(pandemonium.length, 8);
  assert.equal(pandemonium.filter((wreck) => wreck.raised).length, 5);

  const wreck = pandemonium.find((candidate) => candidate.raised);
  const generation = wreck.generation;
  withRandom(0, () => shipwrecks.sink(wreck));
  assert.equal(wreck.raised, false);
  assert.equal(wreck.generation, generation + 1);
  assert.equal(pandemonium.filter((candidate) => candidate.raised).length, 5, "another rose");

  // A small wreck is 2x1; its range is measured to its nearest tile.
  const raised = pandemonium.find((candidate) => candidate.raised);
  assert.equal(shipwrecks.raisedWreckNear(raised.x + 3, raised.y, raised.z, 4), raised);
  assert.equal(shipwrecks.raisedWreckNear(raised.x + 300, raised.y + 300, raised.z, 4), undefined);

  // The first salvage starts the despawn: a small wreck lasts 2:30 (250 ticks).
  shipwrecks.startDespawn(raised);
  for (let tick = 0; tick < 249; tick++) shipwrecks.onTick();
  assert.equal(raised.raised, true);
  shipwrecks.onTick();
  assert.equal(raised.raised, false);
});

function salvager(boat) {
  const player = sailor();
  const levels = new Map([[Skill.SAILING, 15]]);
  const xp = [];
  let animation;
  Object.assign(player, {
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill) ?? 1,
      addExperiences: (skill, amount) => xp.push([skill.getName(), amount]),
    }),
    performAnimation: (anim) => { animation = anim.getId(); },
    setPositionToFace() {},
    getMovementQueue: () => ({ size: () => 0, reset() {}, handleRegionChange() {} }),
    isRegistered: () => true,
    getHitpoints: () => 10,
    getLocalPlayers: () => [],
  });
  if (boat) {
    BoatManager.getDeck(boat).enter(player);
    player.setLocation(new Location(boat.deckBaseX + 3, boat.deckBaseY + 3, 0));
  }
  return { player, levels, xp, animation: () => animation };
}

const { Skill } = require("../dist/game/model/Skill");

test("Deploy reels salvage in from a raised wreck nearby, and nothing without one", () => {
  clearTasks();
  withRandom(0, () => shipwrecks.start());
  const wreck = shipwrecks.all().find((candidate) => candidate.type === "small" && candidate.raised);
  const salvaging = registerPlugin("Salvaging.plugin");
  const hookLoc = { id: 60490, x: 3, y: 4, level: 1, shape: 10, rotation: 1 };
  const boat = BoatManager.spawn(1, { ...RAFT, locs: [hookLoc] },
    { fineX: wreck.x * 128 + 64, fineY: wreck.y * 128 + 64 - 3 * 128, level: 0, angle: NORTH });
  try {
    const h = salvager(boat);
    const deploy = () => {
      const event = { player: h.player, clickType: 1, handled: false,
        location: { x: boat.deckBaseX + 3, y: boat.deckBaseY + 4, z: 0 },
        definition: { getName: () => "Bronze salvaging hook", getInteractions: () => ["Deploy", null, null, null, "Modify"] } };
      salvaging.objectHandlers.forEach((handler) => handler(event));
      return event.handled;
    };

    h.levels.set(Skill.SAILING, 14);
    assert.equal(deploy(), true);
    assert.equal(h.player.messages.at(-1), "You need a Sailing level of at least 15 to salvage this shipwreck.");

    h.levels.set(Skill.SAILING, 15);
    deploy();
    assert.equal(h.player.messages.at(-1), "You cast out your salvaging hook towards the shipwreck...");
    assert.equal(h.animation(), 13576);
    assert.notEqual(wreck.sinksAt, undefined, "casting starts the wreck's despawn");
    withRandom(0, () => { for (let tick = 0; tick < 5; tick++) TaskManager.process(); });
    assert.equal(h.player.getInventory().getAmount(32847), 0);
    assert.equal(h.animation(), 13577, "the hook's idle");
    withRandom(0, () => TaskManager.process());
    assert.equal(h.player.getInventory().getAmount(32847), 1, "the first salvage, 6 ticks after the cast");
    assert.equal(h.player.messages.at(-1), "You reel in some salvage.");
    assert.deepEqual(h.xp, [["Sailing", 10]]);

    // The wreck sinking ends it.
    shipwrecks.sink(wreck);
    TaskManager.process();
    assert.equal(h.player.messages.at(-1), "You salvage all you can from the shipwreck before it is reclaimed by the sea.");

    // Far from any wreck.
    boat.fineX += 60 * 128;
    deploy();
    assert.equal(h.player.messages.at(-1), "There are no shipwrecks within range of the salvaging hook.");
  } finally {
    BoatManager.dispose(boat);
    clearTasks();
  }
});

test("Sort-salvage sorts every salvage in the inventory, one each 3 ticks", () => {
  clearTasks();
  const salvaging = registerPlugin("Salvaging.plugin");
  const h = salvager();
  h.player.getInventory().add(new Item(32847, 1), false);
  h.player.getInventory().add(new Item(32847, 1), false);
  salvaging.objects["Salvaging station"]["Sort-salvage"]({ player: h.player });
  assert.equal(h.player.messages.at(-1), "You begin sorting through your salvage...");
  assert.equal(h.animation(), 13599);
  // Rolls of 0.5 miss every pre-roll and land mid-table.
  withRandom(0.5, () => { for (let tick = 0; tick < 3; tick++) TaskManager.process(); });
  assert.equal(h.player.getInventory().getAmount(32847), 1);
  assert.match(h.player.messages.at(-1), /^You sort through the small salvage and find: \d+ x .+\.$/);
  withRandom(0.5, () => { for (let tick = 0; tick < 3; tick++) TaskManager.process(); });
  assert.equal(h.player.getInventory().getAmount(32847), 0);
  assert.equal(h.player.messages.at(-1), "You have no more salvage to sort.");
  assert.deepEqual(h.xp, [["Sailing", 5.5], ["Sailing", 5.5]]);
  clearTasks();
});

test("logging in unlocks every facility and part schematic", () => {
  const { login } = registerPlugin("Sailing.plugin");
  const player = sailor();
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => { if (key === "sendVarbit") varbits.set(args[0], args[1]); return sender; },
  });
  player.getPacketSender = () => sender;
  login({ player });
  // Script 9078: the salvaging station's schematic is 19544, the ballistic attractor's 20227.
  assert.deepEqual([19544, 19553, 20227].map((id) => varbits.get(id)), [1, 1, 1]);
});

// --- Ports and docking.

test("every port comes from the cache, with its buoy, gangplank, landing and mooring", () => {
  const docks = content().docks;
  const byId = (id) => docks.find((dock) => dock.id === id);
  assert.equal(docks.length, 57, "table 194's 59 rows, less Red Rock and Last Light (no gangplank)");
  // Port Sarim as captured: buoy (3048, 3186), gangplank (3051, 3193), landing one west of it.
  const sarim = byId("port_sarim");
  assert.deepEqual([sarim.portId, sarim.level, sarim.buoy, sarim.gangplank, sarim.landing],
    [0, 1, { x: 3048, y: 3186, z: 0 }, { x: 3051, y: 3193, z: 0 }, { x: 3050, y: 3193, z: 0 }]);
  // The Pandemonium's generated mooring and landing are its captured ones; Junior Jim stays.
  const pandemonium = byId("the_pandemonium");
  assert.deepEqual(pandemonium.mooring, { fineX: 3074 * 128 + 64, fineY: 2987 * 128 + 64, level: 0, angle: 1024 });
  assert.deepEqual(pandemonium.landing, { x: 3069, y: 2987, z: 0 });
  assert.equal(pandemonium.shipwright, "Junior Jim");
  assert.equal(byId("catherby").level, 20);
  assert.equal(byId("dognose_island").mooringPoint, true);
});

test("Dock on a port's buoy docks the boat there; Disembark at any port docks it if it wasn't", () => {
  clearTasks();
  const plugin = registerPlugin("Gangplank.plugin");
  const musa = content().docks.find((dock) => dock.id === "musa_point");
  const catherby = content().docks.find((dock) => dock.id === "catherby");
  const player = sailor();
  const levels = new Map([[Skill.SAILING, 10]]);
  player.getSkillManager = () => ({ getCurrentLevel: (skill) => levels.get(skill) ?? 1 });
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => { if (key === "sendVarbit") varbits.set(args[0], args[1]); return sender; },
  });
  player.getPacketSender = () => sender;
  Sailing.giveBoat(player, "raft", "the_pandemonium");
  Sailing.board(player, "the_pandemonium");
  try {
    assert.equal(player.getSailing().lastDock, "the_pandemonium", "boarding at a port docks there");

    // Catherby needs Sailing 20.
    plugin.objects.Buoy.Dock({ player, location: catherby.buoy });
    assert.equal(player.messages.at(-1), "You need a Sailing level of at least 20 to dock at Catherby.");

    plugin.objects.Buoy.Dock({ player, location: musa.buoy });
    assert.equal(player.messages.at(-1),
      "You dock the boat at Musa Point. You will return here if you have to abandon your boat for any reason.");
    assert.ok(Sailing.instanceAboard(player), "still aboard");
    assert.equal(Sailing.activeBoat(player).location.dock, "musa_point");
    assert.deepEqual(player.getSailing().returnPoint, musa.landing);
    assert.deepEqual([19145, 19146, 19258 + 2].map((id) => varbits.get(id)), [3, 3, 3], "last dock, last port, boat 1's port");

    // Disembarking at the Pandemonium docks the boat there instead, where it is.
    const boat = BoatManager.getBoatAboard(player);
    const at = { fineX: boat.fineX, fineY: boat.fineY, level: boat.level, angle: boat.angle };
    const pandemonium = content().docks.find((dock) => dock.id === "the_pandemonium");
    plugin.objects.Gangplank.Disembark({ player, location: pandemonium.gangplank });
    TaskManager.process();
    TaskManager.process();
    assert.equal(player.messages.at(-1), "You disembark at the Pandemonium.");
    assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: "the_pandemonium", at });
    assert.deepEqual(tileOf(player), [3069, 2987, 0]);
    assert.equal(player.getSailing().lastDock, "the_pandemonium");

    // Boarding there again puts the boat back where it was left.
    Sailing.board(player, "the_pandemonium");
    const again = BoatManager.getBoatAboard(player);
    assert.deepEqual([again.fineX, again.fineY, again.angle], [at.fineX, at.fineY, at.angle]);
  } finally {
    if (Sailing.instanceAboard(player)) Sailing.disembark(player, "the_pandemonium");
    clearTasks();
  }
});
