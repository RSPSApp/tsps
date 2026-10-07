"use strict";

/**
 * The Gauntlet's resources: what a room holds when it is lit, and gathering from it.
 *
 * Wiki: deposits, phren roots and linum give 3 each, fishing spots 4, grym roots 1, with no level
 * needed; gathering may also give crystal shards. A spent node turns into its depleted version
 * (the next object id). How rooms are stocked follows Near-Reality: three in four rooms get
 * 1-3 gathering nodes (at most 2 in demi-boss rooms), one in five a few grym roots, placed by
 * the walls, apart from each other and clear of the doorways. A demi-boss room holds only its
 * demi-boss. The rest gets monsters (phase 4), recorded on the room for now.
 *
 * Gathering is Near-Reality's too: a yield every 2 ticks and a 1 in 5 chance of 5-30 shards.
 */

const Shared = require("./GauntletShared");
const Items = require("./GauntletItems");

const RESOURCES = {
  deposit: {
    ids: { regular: 36064, corrupted: 35967 }, size: 1, harvests: 3, item: "ore", tool: "pickaxe",
    skill: "MINING", animation: { regular: 8347, corrupted: 8348 },
    start: "You swing your pick at the rock.", gained: "You manage to mine some ore.",
    noTool: "You need a pickaxe to mine this rock.", full: "Your inventory is too full to hold any more ore.",
    spent: "You mine the last of the salvageable ore from the rock.",
  },
  roots: {
    ids: { regular: 36066, corrupted: 35969 }, size: 1, harvests: 3, item: "bark", tool: "axe",
    skill: "WOODCUTTING", animation: { regular: 8324, corrupted: 8325 },
    start: "You swing your axe at the roots.", gained: "You get some bark.",
    noTool: "You need an axe to chop bark from these roots.", full: "Your inventory is too full to hold any more bark.",
    spent: "You chop away the last of the bark.",
  },
  fishing: {
    ids: { regular: 36068, corrupted: 35971 }, size: 2, harvests: 4, item: "rawPaddlefish", tool: "harpoon",
    skill: "FISHING", animation: { regular: 8336, corrupted: 8337 },
    start: "You start harpooning fish.", gained: "You manage to catch a fish.",
    noTool: "You need a harpoon to catch these fish.", full: "You can't carry any more fish.",
    spent: "The fish have all been caught.",
  },
  linum: {
    ids: { regular: 36072, corrupted: 35975 }, size: 1, harvests: 3, item: "linum", tool: null,
    skill: "FARMING", animation: { regular: 2282, corrupted: 2282 },
    start: null, gained: "You pick some fibre from the plant.",
    full: "Your inventory is too full to hold any more fibre.", spent: "You pick the last of the fibre.",
  },
  grym: {
    ids: { regular: 36070, corrupted: 35973 }, size: 1, harvests: 1, item: "grymLeaf", tool: null,
    skill: "FARMING", animation: { regular: 2282, corrupted: 2282 },
    start: null, gained: "You pick a herb from the roots.",
    full: "Your inventory is too full to hold any more herbs.", spent: null,
  },
};
const GATHERING = ["deposit", "roots", "fishing", "linum"];
const YIELD_TICKS = 2;
const SHARD_CHANCE = 5;
const SHARDS = { min: 5, max: 30 };
const OBJECT_TYPE = 10;
const BLOCKING = 0x1280100;
// The doorway strips of a room's inner floor (offsets 2-13), kept clear.
const DOORWAY = { from: 6, to: 9 };

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function resourceById(id) {
  for (const [key, resource] of Object.entries(RESOURCES)) {
    for (const mode of ["regular", "corrupted"]) {
      if (resource.ids[mode] === id) return { key, resource, mode };
    }
  }
  return null;
}

// ------------------------------------------------------------------ stocking rooms

function clipAt(map, tile) {
  const { RegionManager } = Shared.core();
  return RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), map);
}

/** Inner-floor tiles beside a wall or object, as single tiles and 2x2 squares. */
function spawnSpots(map, room) {
  const free = (x, y) => (clipAt(map, map.roomTile(room, x, y)) & BLOCKING) === 0;
  const doorway = (x, y) => ((x === 2 || x === 13) && y >= DOORWAY.from && y <= DOORWAY.to)
    || ((y === 2 || y === 13) && x >= DOORWAY.from && x <= DOORWAY.to);
  const single = [];
  const square = [];
  for (let x = 2; x <= 13; x++) {
    for (let y = 2; y <= 13; y++) {
      if (doorway(x, y) || !free(x, y)) continue;
      const nearWall = [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [0, -2], [2, 0], [-2, 0]]
        .some(([dx, dy]) => !free(x + dx, y + dy));
      if (!nearWall) continue;
      single.push({ x, y });
      if (x < 13 && y < 13 && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1)) square.push({ x, y });
    }
  }
  return { single, square };
}

/** Takes a spot and everything too close to it: neighbours, and its row and column. */
function claim(spots, spot, size) {
  const near = (other) => Math.abs(other.x - spot.x) <= size && Math.abs(other.y - spot.y) <= size;
  for (const list of [spots.single, spots.square]) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (near(list[i]) || list[i].x === spot.x || list[i].y === spot.y) list.splice(i, 1);
    }
  }
}

// The inner floor tiles each doorway opens onto, and the approach kept clear in front of them.
const DOORWAY_TILES = [[2, 7], [2, 8], [13, 7], [13, 8], [7, 2], [8, 2], [7, 13], [8, 13]];
const APPROACH = 3;

function inApproach(x, y) {
  const across = (v) => v >= DOORWAY.from && v <= DOORWAY.to;
  return (across(y) && (x < 2 + APPROACH || x > 13 - APPROACH))
    || (across(x) && (y < 2 + APPROACH || y > 13 - APPROACH));
}

/**
 * Whether every doorway of the room can still reach every other once `blocked` tiles (a node
 * about to be placed) are taken. A spawned node must never wall off a way through the room.
 */
function staysConnected(map, room, blocked) {
  const { RegionManager } = Shared.core();
  const key = (x, y) => `${x},${y}`;
  const open = (x, y) => x >= 2 && x <= 13 && y >= 2 && y <= 13 && !blocked.has(key(x, y))
    && (clipAt(map, map.roomTile(room, x, y)) & BLOCKING) === 0;
  const doorways = DOORWAY_TILES.filter(([x, y]) => open(x, y) && leadsOut(map, room, x, y));
  if (doorways.length < 2) return true;
  const seen = new Set([key(...doorways[0])]);
  const queue = [doorways[0]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (seen.has(key(nx, ny)) || !open(nx, ny)) continue;
      const from = map.roomTile(room, x, y);
      if (!RegionManager.canMove(from.getX(), from.getY(), from.getX() + dx, from.getY() + dy, from.getZ(), 1, 1, map)) continue;
      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }
  return doorways.every(([x, y]) => seen.has(key(x, y)));
}

/** Whether a doorway tile has a passage beyond it (rim rooms have closed sides). */
function leadsOut(map, room, x, y) {
  const { RegionManager } = Shared.core();
  const dx = x === 2 ? -1 : x === 13 ? 1 : 0;
  const dy = y === 2 ? -1 : y === 13 ? 1 : 0;
  const from = map.roomTile(room, x, y);
  return RegionManager.canMove(from.getX(), from.getY(), from.getX() + dx, from.getY() + dy, from.getZ(), 1, 1, map);
}

/** A spot's tiles, if it can take a node there without blocking a doorway or a way through. */
function placeable(map, room, spot, size) {
  const tiles = [];
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      if (inApproach(spot.x + dx, spot.y + dy)) return false;
      tiles.push(`${spot.x + dx},${spot.y + dy}`);
    }
  }
  return staysConnected(map, room, new Set(tiles));
}

function spawnResource(map, room, key, spot, random) {
  const { GameObject, ObjectManager } = Shared.core();
  const resource = RESOURCES[key];
  const mode = map.corrupted ? "corrupted" : "regular";
  const object = new GameObject(resource.ids[mode], map.roomTile(room, spot.x, spot.y), OBJECT_TYPE,
    Math.floor(random() * 4), map);
  object.__gauntletLeft = resource.harvests;
  ObjectManager.register(object, true);
  return object;
}

/** Stocks a newly lit room. Returns what was placed, for tests and the run's records. */
function stockRoom(map, room, random = Math.random) {
  if (room.special || room.stocked) return [];
  room.stocked = true;
  if (room.demiBoss) return [];
  const spots = spawnSpots(map, room);
  shuffle(spots.single, random);
  shuffle(spots.square, random);
  const placed = [];
  const place = (key) => {
    const size = RESOURCES[key].size;
    const spot = (size > 1 ? spots.square : spots.single).find((candidate) => placeable(map, room, candidate, size));
    if (!spot) return;
    claim(spots, spot, size);
    placed.push({ key, object: spawnResource(map, room, key, spot, random) });
  };
  const gathering = random() >= 0.25;
  room.monsters = !gathering || random() >= 0.25;
  if (gathering) {
    const count = randomInt(random, room.monsters ? 1 : 2, 3);
    for (let i = 0; i < count; i++) place(GATHERING[Math.floor(random() * GATHERING.length)]);
  }
  if (random() < 0.2) {
    const roots = randomInt(random, 1, random() < 1 / 3 ? 3 : 2);
    for (let i = 0; i < roots; i++) place("grym");
  }
  return placed;
}

// ------------------------------------------------------------------ gathering

/** Swaps a spawned loc for another id in place (a spent node, a lit node). */
function replaceObject(map, object, id) {
  const { GameObject, ObjectManager } = Shared.core();
  ObjectManager.deregister(object, true);
  map.detach(object);
  const next = new GameObject(id, object.getLocation(), object.getType(), object.getFace(), map);
  ObjectManager.register(next, true);
  return next;
}

function hasItem(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id);
}

function rollShards(player, items, random) {
  if (Math.floor(random() * SHARD_CHANCE) !== 0) return;
  const amount = randomInt(random, SHARDS.min, SHARDS.max);
  player.getInventory().adds(items.shards, amount);
  player.getInventory().refreshItems();
  player.sendMessage(`You find ${amount} ${items.shards === Items.MODES.corrupted.shards ? "corrupted" : "crystal"} shards.`);
}

/**
 * Starts gathering from a node: a yield every 2 ticks until it is spent, the inventory fills or
 * the player moves away. `run` supplies the mode and randomness.
 */
function gather(run, player, object, random = run.random) {
  const found = resourceById(object.getId());
  if (!found) return false;
  const { resource } = found;
  const items = Items.itemsFor(run.mode);
  if (resource.tool && !hasItem(player, items[resource.tool])) {
    Shared.statement(player, resource.noTool);
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0 && !player.getInventory().contains(items[resource.item])) {
    player.sendMessage(resource.full);
    return true;
  }
  if (object.__gauntletLeft == null) object.__gauntletLeft = resource.harvests;
  const { Animation, Skill } = Shared.core();
  const animation = new Animation(resource.animation[run.mode]);
  if (resource.start) player.sendMessage(resource.start);
  player.performAnimation(animation);
  const origin = player.getLocation();
  let node = object;
  let ticks = 0;
  stopGathering(player);
  player.__gauntletGathering = Shared.repeat(player, 1, () => {
    if (run.stage === "ended" || !player.getLocation().equals(origin) || node.__gauntletLeft <= 0) return finish();
    if (++ticks % YIELD_TICKS !== 0) return true;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(resource.full);
      return finish();
    }
    player.performAnimation(animation);
    player.getInventory().adds(items[resource.item], 1);
    player.getInventory().refreshItems();
    player.sendMessage(resource.gained);
    player.getSkillManager().addExperiences(Skill[resource.skill], 1);
    rollShards(player, items, random);
    node.__gauntletLeft--;
    if (node.__gauntletLeft > 0) return true;
    if (resource.spent) player.sendMessage(resource.spent);
    node = replaceObject(run.map, node, node.getId() + 1);
    return finish();
  });
  return true;

  function finish() {
    player.__gauntletGathering = null;
    player.performAnimation(new Animation(-1));
    return false;
  }
}

function stopGathering(player) {
  player.__gauntletGathering?.stop?.();
  player.__gauntletGathering = null;
}

module.exports = {
  RESOURCES, GATHERING, YIELD_TICKS, resourceById, spawnSpots, staysConnected, stockRoom, replaceObject, gather, stopGathering,
};
