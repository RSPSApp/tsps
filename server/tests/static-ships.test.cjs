// Run after `yarn build`: node --test tests/static-ships.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { World } = require("../dist/game/World");
const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");
const StaticShips = require("../plugins/skills/sailing/StaticShips.Sailing");
const ShipCombat = require("../plugins/skills/sailing/ShipCombat.Sailing");

const core = PluginManager.getCoreApi();
StaticShips.attach({ core });
ShipCombat.attach({ core });

const RAFT = {
  type: "raft", configId: 1, templateChunkX: 480, templateChunkY: 807,
  sizeX: 8, sizeZ: 8,
  hull: { offsetX: 0, offsetY: 0, width: 128, length: 384 },
  deckCentreX: 448, deckCentreY: 448, deckLevel: 1,
  walkableDeck: [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }],
  boardingTile: { x: 3, y: 4 }, locs: [],
};

function fakePlayer(index, location, area = null) {
  const player = {
    index,
    area,
    location,
    messages: [],
    inventory: new Map(),
    projectiles: [],
    graphics: [],
    animations: [],
    localPlayers: [],
    returnPoint: { x: 3222, y: 3218, z: 0 },
    varbits: new Map(),
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getArea: () => player.area,
    setArea: (next) => { player.area = next; },
    getLocation: () => player.location,
    setLocation: (next) => { player.location = next; },
    moveTo: (target) => { player.location = target; },
    sendMessage: (message) => player.messages.push(message),
    getLocalPlayers: () => player.localPlayers,
    getSailing: () => ({ returnPoint: player.returnPoint }),
    getInventory: () => ({
      contains: (itemId) => (player.inventory.get(itemId) ?? 0) > 0,
      deleteNumber: (itemId, amount) => {
        const left = (player.inventory.get(itemId) ?? 0) - amount;
        if (left > 0) player.inventory.set(itemId, left); else player.inventory.delete(itemId);
      },
    }),
    getPacketSender: () => ({
      sendProjectile: (start, end, ...rest) => player.projectiles.push({ start, end, rest }),
      sendGraphic: (graphic, at) => player.graphics.push({ graphic, at }),
      sendObjectAnimation: (object, animation) => player.animations.push({ object, animation }),
      sendVarbit: (id, value) => player.varbits?.set(id, value),
    }),
  };
  return player;
}

function realPlayer(x, y) {
  const player = new Player(null);
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "getVarbit") return () => 0;
      if (key === "isSubInterfaceOpen" || key === "isChatboxInterface") return () => false;
      if (key === "closeInterruptibleInterfaces") return () => {};
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.messages = [];
  player.sendMessage = (message) => player.messages.push(message);
  player.moveTo(new Location(x, y, 0));
  player.setNeedsPlacement(false);
  return player;
}

function registerNpc(id, x, y, owner = undefined, ownerOnly = false) {
  const npc = new NPC(id, new Location(x, y, 0));
  if (owner) npc.setOwner(owner);
  if (ownerOnly) npc.setOwnerOnly(true);
  assert.equal(World.getNpcs().add(npc, true), true);
  return npc;
}

function raft(index, x, y, ownerOnly = false) {
  const boat = BoatManager.spawn(index, RAFT, { fineX: x * 128 + 64, fineY: y * 128 + 64, level: 0, angle: 1024 });
  boat.ownerOnly = ownerOnly;
  return boat;
}

function cannonObject(boat, id = 59450) {
  return {
    getId: () => id,
    getLocation: () => new Location(boat.deckBaseX + 2, boat.deckBaseY + 3, 0),
    getType: () => 10,
    getFace: () => 0,
  };
}

function installCannon(boat, id = 59450) {
  BoatManager.setDeckLoc(boat, { id, x: 2, y: 3, level: 0, shape: 10, rotation: 0 });
}

function manCannon(player, boat, id = 59450) {
  return ShipCombat._test.operateCannon({
    player,
    object: cannonObject(boat, id),
    objectId: id,
    definition: { getName: () => "Adamant cannon" },
    option: "operate",
    location: { x: boat.deckBaseX + 2, y: boat.deckBaseY + 3, z: 0 },
    handled: false,
  });
}

test("OPWORLDENTITY options decode with live's byte transforms", () => {
  assert.deepEqual(decodeClientPackets(Buffer.from([220, 0xb8, 0x0b, 128])), [
    { type: "world_entity_option", index: 3000, clickType: 1 },
  ]);
  assert.deepEqual(decodeClientPackets(Buffer.from([221, 0x38, 0x0b, 128])), [
    { type: "world_entity_option", index: 3000, clickType: 2 },
  ]);
  assert.deepEqual(decodeClientPackets(Buffer.from([222, 0x0b, 0xb8, 128])), [
    { type: "world_entity_option", index: 3000, clickType: 3 },
  ]);
  assert.deepEqual(decodeClientPackets(Buffer.from([223, 128, 0x0b, 0xb8])), [
    { type: "world_entity_option", index: 3000, clickType: 4 },
  ]);
  assert.deepEqual(decodeClientPackets(Buffer.from([224, 128, 0xb8, 0x0b])), [
    { type: "world_entity_option", index: 3000, clickType: 5 },
  ]);
  assert.deepEqual(decodeClientPackets(Buffer.from([225, 0x0b, 0x38])), [
    { type: "world_entity_option", index: 3000, clickType: 6 },
  ]);
});

test("the world entity interaction hook sees the decoded option", () => {
  const seen = [];
  const previous = PluginManager.worldEntityInteractionHooks;
  PluginManager.worldEntityInteractionHooks = [{ pluginName: "test", handler: (event) => {
    seen.push(event);
    event.handled = true;
  } }];
  try {
    const player = fakePlayer(1, new Location(2870, 2506, 0));
    assert.equal(PluginManager.emitWorldEntityInteraction({
      player, entityIndex: 14, clickType: 1, handled: false,
    }), true);
    assert.deepEqual(seen.map((event) => [event.entityIndex, event.clickType]), [[14, 1]]);
  } finally {
    PluginManager.worldEntityInteractionHooks = previous;
  }
});

test("the Zenith spawns from its cache template and appears in world-entity sync", () => {
  const viewer = fakePlayer(1, new Location(2870, 2506, 0));
  const ship = StaticShips.spawn("the_zenith");
  try {
    assert.equal(ship.boat.static, true);
    assert.equal(ship.boat.configId, 9);
    assert.equal(ship.spec.sizeX, 16);
    assert.equal(ship.spec.sizeZ, 32);
    assert.ok(ship.spec.walkableDeck.length > 0, "the template's deck tiles are walkable");
    assert.ok(ship.spec.locs.length > 0, "the template's locs are placed on the deck");
    assert.ok(ship.spec.locs.some((loc) => loc.x >= 8 || loc.y >= 8),
      "2x4-zone locs keep their zone offsets instead of stacking in the first 8x8");
    const packets = require("../dist/game/content/sailing/WorldEntitySync").WorldEntitySync.flush(viewer);
    assert.equal(packets[0][0], 142, "REBUILD_WORLDENTITY");
    const info = packets.find((packet) => packet[0] === 143);
    assert.ok(info, "WORLDENTITY_INFO");
    assert.equal(info.readUInt16BE(3), ship.boat.entityIndex);
  } finally {
    StaticShips.dispose(ship);
  }
});

test("boarding validates owner, visibility and root-world range", () => {
  const ship = StaticShips.spawn("the_zenith", { owner: fakePlayer(1, new Location(2870, 2506, 0)), ownerOnly: true });
  const owner = fakePlayer(1, new Location(2870, 2506, 0));
  const foreign = fakePlayer(2, new Location(2870, 2506, 0));
  const farOwner = fakePlayer(1, new Location(3000, 3000, 0));
  try {
    assert.equal(StaticShips.board(foreign, ship), "That ship is no longer there.");
    assert.equal(StaticShips.inRange(farOwner, ship, StaticShips.BOARD_RANGE), false);
    assert.equal(StaticShips.board(owner, ship), null);
    assert.equal(BoatManager.getBoatAboard(owner), ship.boat);
    assert.equal(StaticShips.leave(owner), true);
  } finally {
    StaticShips.dispose(ship);
  }
});

test("boarding returns to land, supports several players, and leaves the old boat alone", () => {
  const boat = raft(1, 2870, 2506);
  const ship = StaticShips.spawn("the_zenith");
  const first = fakePlayer(1, new Location(2870, 2506, 0));
  const second = fakePlayer(2, new Location(2871, 2506, 0));
  const sailor = fakePlayer(3, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  try {
    assert.equal(StaticShips.board(first, ship), null);
    assert.equal(StaticShips.board(second, ship), null);
    assert.equal(BoatManager.getBoatAboard(second), ship.boat);
    assert.equal(StaticShips.leave(first), true);
    assert.deepEqual([first.getLocation().getX(), first.getLocation().getY()], [2870, 2506]);

    assert.equal(StaticShips.board(sailor, ship), null);
    assert.equal(BoatManager.getBoat(boat.entityIndex), boat, "the player's boat is still at sea");
    assert.equal(StaticShips.leave(sailor), true);
    assert.equal(sailor.getArea(), BoatManager.getDeck(boat));
    assert.equal(BoatManager.getBoatAboard(second), ship.boat, "the other boarder is unaffected");
    StaticShips.leave(second);
  } finally {
    StaticShips.dispose(ship);
    BoatManager.dispose(boat);
  }
});

test("direct deck entry leaves to the owned boat or last return point", () => {
  const ship = StaticShips.spawn("the_zenith", { owner: fakePlayer(1, new Location(2870, 2506, 0)), ownerOnly: true });
  const player = fakePlayer(1, new Location(3222, 3218, 0));
  try {
    BoatManager.getDeck(ship.boat).enter(player);
    BoatManager.getDeck(ship.boat).leave(player, false);
    player.moveTo(new Location(ship.boat.deckBaseX + 7, ship.boat.deckBaseY + 14, 0));
    BoatManager.getDeck(ship.boat).enter(player);
    assert.equal(StaticShips.leave(player), true);
    assert.equal(player.getArea(), null);
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3222, 3218]);
  } finally {
    StaticShips.dispose(ship);
  }
});

test("disposal evacuates every passenger safely", () => {
  const ship = StaticShips.spawn("the_zenith");
  const first = fakePlayer(1, new Location(2870, 2506, 0));
  const second = fakePlayer(2, new Location(2871, 2506, 0));
  first.returnPoint = { x: 3222, y: 3218, z: 0 };
  second.returnPoint = { x: 3230, y: 3220, z: 0 };
  StaticShips.board(first, ship);
  StaticShips.board(second, ship);
  StaticShips.dispose(ship);
  assert.equal(StaticShips.get(ship.boat.entityIndex), undefined);
  assert.equal(first.getArea(), null);
  assert.equal(second.getArea(), null);
  assert.deepEqual([first.getLocation().getX(), first.getLocation().getY()], [2870, 2506]);
  assert.deepEqual([second.getLocation().getX(), second.getLocation().getY()], [2871, 2506]);
});

test("forget restores an owner's saved position before disposing their ship", () => {
  const owner = fakePlayer(1, new Location(2870, 2506, 0));
  const ship = StaticShips.spawn("the_zenith", { owner, ownerOnly: true });
  StaticShips.board(owner, ship);
  StaticShips.forget(owner);
  assert.equal(StaticShips.get(ship.boat.entityIndex), undefined);
  assert.equal(owner.getArea(), null);
  assert.ok(!BoatManager.isDeckTile(owner.getLocation().getX(), owner.getLocation().getY()));
  assert.deepEqual([owner.getLocation().getX(), owner.getLocation().getY()], [2870, 2506]);
});

test("logout restores a saved deck tile before disposing the owner's ship", () => {
  const owner = fakePlayer(1, new Location(0, 0, 0));
  const ship = StaticShips.spawn("the_zenith", { owner, ownerOnly: true });
  owner.location = new Location(ship.boat.deckBaseX + 7, ship.boat.deckBaseY + 14, 0);
  owner.area = null;
  StaticShips.forget(owner);
  assert.equal(StaticShips.get(ship.boat.entityIndex), undefined);
  assert.ok(!BoatManager.isDeckTile(owner.getLocation().getX(), owner.getLocation().getY()));
  assert.deepEqual([owner.getLocation().getX(), owner.getLocation().getY()], [3222, 3218]);
});

test("a disposed return boat falls back instead of stranding on its old deck tile", () => {
  const boat = raft(1, 2870, 2506);
  const ship = StaticShips.spawn("the_zenith");
  const sailor = fakePlayer(3, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  sailor.returnPoint = { x: 3222, y: 3218, z: 0 };
  try {
    StaticShips.board(sailor, ship);
    BoatManager.dispose(boat);
    assert.equal(StaticShips.leave(sailor), true);
    assert.equal(sailor.getArea(), null);
    assert.ok(!BoatManager.isDeckTile(sailor.getLocation().getX(), sailor.getLocation().getY()));
    assert.deepEqual([sailor.getLocation().getX(), sailor.getLocation().getY()], [3222, 3218]);
  } finally {
    StaticShips.dispose(ship);
  }
});

test("logout keeps the original land return after Player.onLogout removes the deck area", () => {
  const owner = fakePlayer(1, new Location(2870, 2506, 0));
  owner.returnPoint = { x: 3200, y: 3200, z: 0 };
  const ship = StaticShips.spawn("the_zenith", { owner, ownerOnly: true });
  StaticShips.board(owner, ship);
  // Player.onLogout runs Sailing.onLogout, then leaves the area, then plugin logout hooks.
  owner.getArea().leave(owner, true);
  owner.area = null;
  StaticShips.forget(owner);
  assert.deepEqual([owner.getLocation().getX(), owner.getLocation().getY()], [2870, 2506]);
});

test("quest-first logout disposal restores the original land return through the real hooks", () => {
  const owner = fakePlayer(30, new Location(2870, 2506, 0));
  owner.returnPoint = { x: 3222, y: 3218, z: 0 };
  const ship = StaticShips.spawn("the_zenith", { owner, ownerOnly: true });
  StaticShips.board(owner, ship);
  // Player.onLogout removes the deck area before any plugin logout hook runs.
  owner.getArea().leave(owner, true);
  owner.area = null;

  const hooks = PluginManager.logoutHooks.slice();
  const early = PluginManager.createApi("QuestFirstLogoutTest");
  early.onPlayerLogout(({ player }) => {
    if (player === owner) StaticShips.dispose(ship);
  });
  require("../plugins/skills/sailing/StaticShips.plugin")
    .register(PluginManager.createApi("SailingQuestFirstLogoutTest"));
  try {
    PluginManager.emitPlayerLogout({ player: owner, username: "QuestFirstOwner" });
    assert.equal(StaticShips.get(ship.boat.entityIndex), undefined, "quest dispose removed the ship");
    assert.deepEqual([owner.getLocation().getX(), owner.getLocation().getY()], [2870, 2506],
      "dispose recovered the land return before StaticShips' own logout hook ran");
  } finally {
    PluginManager.logoutHooks.length = 0;
    PluginManager.logoutHooks.push(...hooks);
    StaticShips.dispose(ship);
  }
});

test("real NPC listener projects a shore NPC from the deck root without walking the deck off-world", () => {
  RegionManager.init();
  RegionManager.loadMapFiles(2816, 2304, false);
  const boat = raft(40, 2830, 2360);
  const player = realPlayer(boat.deckBaseX + 3, boat.deckBaseY + 4);
  BoatManager.getDeck(boat).enter(player);
  player.setNeedsPlacement(false);
  const npc = registerNpc(3876, 2831, 2360);
  const interacted = [];
  const previousEmit = PluginManager.emitNpcInteraction;
  PluginManager.emitNpcInteraction = (event) => {
    interacted.push(event);
    event.handled = true;
    return true;
  };
  const listener = new NPCOptionPacketListener();
  try {
    listener.executeOption(player, npc.getIndex(), 1);
    assert.equal(interacted.length, 1, "root-adjacent shore NPC resolved");
    assert.equal(player.getMovementQueue().points.length, 0, "no virtual deck route was queued");
    assert.ok(BoatManager.isDeckTile(player.getLocation().getX(), player.getLocation().getY()),
      "the player stayed on the deck");

    World.getNpcs().remove(npc);
    const far = registerNpc(3876, 2840, 2360);
    interacted.length = 0;
    listener.executeOption(player, far.getIndex(), 1);
    assert.equal(interacted.length, 0, "root-out-of-reach shore NPC did not resolve");
    assert.equal(player.messages.at(-1), "I can't reach that!");
    assert.equal(player.getMovementQueue().points.length, 0,
      "an unreachable shore NPC must not start a virtual deck walk");
    World.getNpcs().remove(far);
  } finally {
    PluginManager.emitNpcInteraction = previousEmit;
    if (World.getNpcs().get(npc.getIndex()) === npc) World.getNpcs().remove(npc);
    BoatManager.dispose(boat);
  }
});

test("real NPC listener keeps same-deck routing and rejects foreign decks, owners and private areas", () => {
  RegionManager.init();
  RegionManager.loadMapFiles(2816, 2304, false);
  const ship = StaticShips.spawn("pandemonium_tutorial_ship");
  const player = realPlayer(ship.boat.tileX, ship.boat.tileY);
  assert.equal(StaticShips.board(player, ship), null);
  player.setNeedsPlacement(false);
  const deckNpc = StaticShips.addDeckNpc(ship, 14959, 3, 3, player);
  const otherBoat = raft(41, 2830, 2361);
  const other = realPlayer(otherBoat.deckBaseX + 3, otherBoat.deckBaseY + 4);
  BoatManager.getDeck(otherBoat).enter(other);
  other.setNeedsPlacement(false);
  const foreignDeckNpc = registerNpc(14959, otherBoat.deckBaseX + 3, otherBoat.deckBaseY + 3);
  BoatManager.getDeck(otherBoat).enter(foreignDeckNpc);
  const foreignOwnerNpc = registerNpc(14959, 2831, 2360, fakePlayer(42, new Location(0, 0, 0)), true);
  const scopedOwnerNpc = registerNpc(14959, 2831, 2360, fakePlayer(43, new Location(0, 0, 0)), false);
  const privateNpc = registerNpc(14959, 2831, 2360);
  privateNpc.setArea({ getObjects: () => [] });
  const interacted = [];
  const previousEmit = PluginManager.emitNpcInteraction;
  PluginManager.emitNpcInteraction = (event) => {
    interacted.push(event);
    event.handled = true;
    return true;
  };
  const listener = new NPCOptionPacketListener();
  try {
    listener.executeOption(player, deckNpc.getIndex(), 1);
    for (let tick = 0; tick < 2 && interacted.length === 0; tick++) TaskManager.process();
    assert.deepEqual(interacted.map((event) => event.npc), [deckNpc],
      "same-deck NPC keeps local routing");

    interacted.length = 0;
    listener.executeOption(player, foreignDeckNpc.getIndex(), 1);
    listener.executeOption(player, foreignOwnerNpc.getIndex(), 1);
    listener.executeOption(player, scopedOwnerNpc.getIndex(), 1);
    listener.executeOption(player, privateNpc.getIndex(), 1);
    assert.deepEqual(interacted, [], "other decks, foreign owners and private areas stay unreachable");
  } finally {
    PluginManager.emitNpcInteraction = previousEmit;
    for (const npc of [deckNpc, foreignDeckNpc, foreignOwnerNpc, scopedOwnerNpc, privateNpc]) {
      if (npc && World.getNpcs().get(npc.getIndex()) === npc) World.getNpcs().remove(npc);
    }
    StaticShips.dispose(ship);
    BoatManager.dispose(otherBoat);
  }
});

test("Pandemonium's tutorial ship keeps its explicit deck tiles and dynamic locs", () => {
  assert.equal(StaticShips.definitions.has("pandemonium_tutorial_ship"), true);
  const ship = StaticShips.spawn("pandemonium_tutorial_ship");
  try {
    assert.deepEqual(ship.spec.walkableDeck, [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }]);
    assert.deepEqual(ship.spec.locs.filter((loc) => [59554, 59530, 29506, 59663].includes(loc.id))
      .map((loc) => loc.id).sort((a, b) => a - b), [29506, 59530, 59554, 59663]);
    const npc = StaticShips.addDeckNpc(ship, 14959, 3, 2, fakePlayer(1, new Location(0, 0, 0)));
    assert.equal(BoatManager.getBoatAboard(npc), ship.boat, "deck NPCs join the static ship's area");
    const packets = require("../dist/game/content/sailing/WorldEntitySync")
      .WorldEntitySync.flush(fakePlayer(1, new Location(3025, 3209, 0)));
    assert.equal(packets.filter((packet) => packet[0] === 134).length, 4,
      "the blueprint's dynamic helm/sails/sail-cloth/placeholder locs are sent");
    assert.ok(packets.some((packet) => packet[0] === 142) && packets.some((packet) => packet[0] === 143));
  } finally {
    StaticShips.dispose(ship);
  }
});

test("attacking without the attack option, ammo or a cannon is refused", () => {
  const boat = raft(1, 2830, 2360);
  const ship = StaticShips.spawn("red_reef_pirate_1");
  const player = fakePlayer(1, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  try {
    assert.equal(ShipCombat._test.attackWorldEntity({
      player, entityIndex: ship.boat.entityIndex, clickType: 1, handled: false,
    }), false, "op1 never attacks");
    assert.deepEqual(player.messages, []);
    assert.equal(ShipCombat._test.attackWorldEntity({
      player, entityIndex: ship.boat.entityIndex, clickType: 2, handled: false,
    }), true);
    assert.deepEqual(player.messages, ["You can only attack a boat with a weapon mounted on another boat!"]);

    installCannon(boat);
    assert.equal(manCannon(player, boat), true);
    player.inventory.clear();
    assert.equal(ShipCombat._test.attackWorldEntity({
      player, entityIndex: ship.boat.entityIndex, clickType: 2, handled: false,
    }), true);
    assert.equal(player.messages.at(-1), "You have no cannonballs to fire.");
    assert.equal(player.projectiles.length, 0);
  } finally {
    StaticShips.dispose(ship);
    BoatManager.dispose(boat);
    ShipCombat._test.forget(player);
  }
});

test("cannon manning requires reach and is lost when the player walks away", () => {
  const boat = raft(1, 2830, 2360);
  const ship = StaticShips.spawn("red_reef_pirate_1");
  const player = fakePlayer(1, new Location(boat.deckBaseX + 7, boat.deckBaseY + 7, 0), BoatManager.getDeck(boat));
  installCannon(boat);
  player.inventory.set(31912, 2);
  try {
    assert.equal(manCannon(player, boat), true);
    assert.equal(player.messages.at(-1), "You can't use that cannon.");
    assert.equal(ShipCombat._test.manning.has(player.getIndex()), false);
    player.moveTo(new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0));
    assert.equal(manCannon(player, boat), true);
    player.moveTo(new Location(boat.deckBaseX + 6, boat.deckBaseY + 6, 0));
    assert.equal(ShipCombat._test.attackWorldEntity({
      player, entityIndex: ship.boat.entityIndex, clickType: 2, handled: false,
    }), false);
    assert.equal(ShipCombat._test.manning.has(player.getIndex()), false);
    assert.equal(player.projectiles.length, 0);
  } finally {
    StaticShips.dispose(ship);
    BoatManager.dispose(boat);
    ShipCombat._test.forget(player);
  }
});

test("cannon shots use the selected cannonball, root projectile coords and 7-tick cooldown", () => {
  const boat = raft(1, 2830, 2360, true);
  const ship = StaticShips.spawn("red_reef_pirate_1");
  const player = fakePlayer(1, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  const outsider = fakePlayer(2, new Location(2831, 2361, 0));
  player.localPlayers = [outsider];
  player.inventory.set(31912, 2);
  try {
    installCannon(boat);
    manCannon(player, boat);
    const event = { player, entityIndex: ship.boat.entityIndex, clickType: 2, handled: false };
    assert.equal(ShipCombat._test.attackWorldEntity(event), true);
    assert.equal(player.inventory.get(31912), 1, "one cannonball consumed");
    assert.equal(player.projectiles.length, 1);
    assert.equal(player.projectiles[0].rest[2], 3492, "adamant projectile");
    assert.ok(player.projectiles[0].start.getX() < 3000, "projectile starts from the main world");
    assert.equal(outsider.projectiles.length, 0, "owner-only boat effects stay private");

    assert.equal(ShipCombat._test.attackWorldEntity({ ...event, handled: false }), true);
    assert.equal(player.projectiles.length, 1, "cooldown blocks a second shot");
  } finally {
    StaticShips.dispose(ship);
    BoatManager.dispose(boat);
    ShipCombat._test.forget(player);
  }
});

test("queued impacts cancel on leaving and sink only once when they land", () => {
  const boat = raft(1, 2830, 2360);
  const ship = StaticShips.spawn("red_reef_pirate_1");
  const player = fakePlayer(1, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  player.inventory.set(31912, 5);
  const events = [];
  const previousEmit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => events.push({ name, payload });
  try {
    installCannon(boat);
    installCannon(boat);
    ship.hitpoints = 25;
    manCannon(player, boat);
    const event = { player, entityIndex: ship.boat.entityIndex, clickType: 2, handled: false };
    // Queue two shots by bypassing the cooldown between clicks.
    assert.equal(ShipCombat._test.attackWorldEntity(event), true);
    ShipCombat._test.manning.get(player.getIndex()).nextAttackTick = 0;
    assert.equal(ShipCombat._test.attackWorldEntity({ ...event, handled: false }), true);
    for (let tick = 0; tick < 3; tick++) TaskManager.process();
    assert.deepEqual(events.map((entry) => entry.name), ["sailing:ship-hit", "sailing:ship-sunk"]);
    assert.equal(StaticShips.get(ship.boat.entityIndex), undefined);

    // A fresh target shot cancels if the player steps off the boat before impact.
    const secondShip = StaticShips.spawn("red_reef_pirate_2");
    BoatManager.getDeck(boat).leave(player, false);
    ShipCombat._test.manning.get(player.getIndex()).nextAttackTick = 0;
    assert.equal(ShipCombat._test.attackWorldEntity({
      player, entityIndex: secondShip.boat.entityIndex, clickType: 2, handled: false,
    }), false, "not aboard the cannon boat");
    StaticShips.dispose(secondShip);
  } finally {
    PluginManager.emitCustomEvent = previousEmit;
    StaticShips.dispose(ship);
    BoatManager.dispose(boat);
    ShipCombat._test.forget(player);
  }
});

test("hostile ships return fire with the captured bronze projectile and damage the boat", () => {
  const boat = raft(1, 2830, 2360);
  const player = fakePlayer(1, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  BoatManager.getDeck(boat).enter(player);
  const owned = { slot: 0, type: "raft", name: [0, 0, 0], hitpoints: 100, facilities: [], location: { kind: "docked", dock: "port_sarim" }, cargo: [], parts: {} };
  player.getSailing = () => ({ boats: [owned], activeBoatSlot: 0, returnPoint: player.returnPoint, tools: [], lastDock: null, lastStandardDock: null });
  core.Sailing.instances.set(boat, { player, slot: 0 });
  const ship = StaticShips.spawn("red_reef_pirate_1");
  const events = [];
  const previousEmit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => events.push({ name, payload });
  try {
    ShipCombat._test.tickHostileShips();
    assert.equal(player.projectiles.length, 1);
    assert.equal(player.projectiles[0].rest[2], 3487, "bronze return-fire projectile");
    for (let tick = 0; tick < 3; tick++) TaskManager.process();
    assert.equal(owned.hitpoints, 100 - ShipCombat._test.ENEMY_DAMAGE);
    assert.deepEqual(events.map((entry) => entry.name), ["sailing:ship-attacked"]);
  } finally {
    PluginManager.emitCustomEvent = previousEmit;
    core.Sailing.instances.delete(boat);
    StaticShips.dispose(ship);
    BoatManager.dispose(boat);
  }
});

test("private pirate return fire ignores foreign boats and guest-only crews", () => {
  const owner = fakePlayer(1, new Location(2830, 2360, 0));
  const pirate = StaticShips.spawn("red_reef_pirate_1", { owner, ownerOnly: true });
  const foreignBoat = raft(2, 2830, 2361);
  const foreign = fakePlayer(2, new Location(foreignBoat.deckBaseX + 3, foreignBoat.deckBaseY + 4, 0), BoatManager.getDeck(foreignBoat));
  BoatManager.getDeck(foreignBoat).enter(foreign);
  const guestBoat = raft(1, 2831, 2360);
  guestBoat.ownerPlayerId = 1;
  const guest = fakePlayer(3, new Location(guestBoat.deckBaseX + 3, guestBoat.deckBaseY + 4, 0), BoatManager.getDeck(guestBoat));
  BoatManager.getDeck(guestBoat).enter(guest);
  try {
    ShipCombat._test.tickHostileShips();
    assert.equal(foreign.projectiles.length, 0);
    assert.equal(guest.projectiles.length, 0, "no owner aboard the target boat");
  } finally {
    StaticShips.dispose(pirate);
    BoatManager.dispose(foreignBoat);
    BoatManager.dispose(guestBoat);
  }
});

test("enemy ships reject foreign owners and non-hostile targets", () => {
  const owner = fakePlayer(1, new Location(2830, 2360, 0));
  const pirate = StaticShips.spawn("red_reef_pirate_1", { owner, ownerOnly: true });
  const zenith = StaticShips.spawn("the_zenith");
  try {
    assert.equal(ShipCombat._test.attackWorldEntity({
      player: fakePlayer(2, new Location(2830, 2360, 0)),
      entityIndex: pirate.boat.entityIndex, clickType: 2, handled: false,
    }), false);
    assert.equal(ShipCombat._test.attackWorldEntity({
      player: owner, entityIndex: zenith.boat.entityIndex, clickType: 2, handled: false,
    }), false, "the Zenith is not hostile");
  } finally {
    StaticShips.dispose(pirate);
    StaticShips.dispose(zenith);
  }
});

test("a disposed static ship does not affect existing player boats", () => {
  const boat = raft(1, 100, 100);
  const ship = StaticShips.spawn("the_zenith");
  StaticShips.dispose(ship);
  assert.equal(BoatManager.getBoat(boat.entityIndex), boat);
  BoatManager.dispose(boat);
});

test("the static ship plugin attaches core and boards/disembarks on op1", () => {
  const plugin = require("../plugins/skills/sailing/StaticShips.plugin");
  let handler;
  plugin.register({
    core,
    onObjectInteraction: () => {},
    onWorldEntityInteraction: (fn) => { handler = fn; },
    onPlayerLogout: () => {},
  });
  const ship = StaticShips.spawn("the_zenith");
  const player = fakePlayer(1, new Location(2870, 2506, 0));
  const far = fakePlayer(2, new Location(3000, 3000, 0));
  try {
    handler({ player: far, entityIndex: ship.boat.entityIndex, clickType: 1, handled: false });
    assert.equal(BoatManager.getBoatAboard(far), undefined);
    assert.equal(far.messages.at(-1), "You can't reach that ship.");
    handler({ player, entityIndex: ship.boat.entityIndex, clickType: 1, handled: false });
    assert.equal(BoatManager.getBoatAboard(player), ship.boat);
    handler({ player, entityIndex: ship.boat.entityIndex, clickType: 1, handled: false });
    assert.equal(BoatManager.getBoatAboard(player), undefined);
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2870, 2506]);
  } finally {
    StaticShips.dispose(ship);
  }
});

test("registered logout hooks receive {player}, clean manning and preserve returns", () => {
  const plugin = require("../plugins/skills/sailing/StaticShips.plugin");
  // Register through the real PluginManager api so onPlayerLogout uses the real hook contract.
  plugin.register(PluginManager.createApi("SailingLogoutTest"));

  const owner = fakePlayer(20, new Location(2870, 2506, 0));
  owner.returnPoint = { x: 3222, y: 3218, z: 0 };
  const ownedShip = StaticShips.spawn("the_zenith", { owner, ownerOnly: true });
  StaticShips.board(owner, ownedShip);
  owner.getArea().leave(owner, true);
  owner.area = null;

  const passenger = fakePlayer(21, new Location(2870, 2506, 0));
  passenger.returnPoint = { x: 3230, y: 3220, z: 0 };
  const publicShip = StaticShips.spawn("the_zenith");
  StaticShips.board(passenger, publicShip);
  passenger.getArea().leave(passenger, true);
  passenger.area = null;

  const boat = raft(22, 2830, 2360);
  const sailor = fakePlayer(22, new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0), BoatManager.getDeck(boat));
  BoatManager.getDeck(boat).enter(sailor);
  installCannon(boat);
  manCannon(sailor, boat);
  assert.equal(ShipCombat._test.manning.has(22), true);

  const errors = [];
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    PluginManager.emitPlayerLogout({ player: owner, username: "Owner" });
    PluginManager.emitPlayerLogout({ player: passenger, username: "Passenger" });
    PluginManager.emitPlayerLogout({ player: sailor, username: "Sailor" });
  } finally {
    console.error = previousError;
  }

  assert.deepEqual(errors, [], "neither registered logout hook throws");
  assert.equal(StaticShips.get(ownedShip.boat.entityIndex), undefined, "owner ship disposed");
  assert.deepEqual([owner.getLocation().getX(), owner.getLocation().getY()], [2870, 2506]);
  assert.deepEqual([passenger.getLocation().getX(), passenger.getLocation().getY()], [2870, 2506]);
  assert.ok(StaticShips.get(publicShip.boat.entityIndex), "a public ship survives a passenger's logout");
  assert.equal(ShipCombat._test.manning.has(22), false, "manning cleaned by the registered hook");

  StaticShips.dispose(publicShip);
  BoatManager.dispose(boat);
});
