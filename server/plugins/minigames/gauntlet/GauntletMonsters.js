"use strict";

/**
 * The Gauntlet's monsters: who a lit room holds, and what they drop.
 *
 * Rooms (Near-Reality): a room marked for monsters gets, three times in four away from the rim,
 * 1-4 weak monsters (rat, spider, bat); otherwise 2 strong ones (unicorn, scorpion, wolf). Each
 * demi-boss room (bear, dragon, dark beast; two of each per maze) holds its demi-boss in the
 * middle. Stats, attack styles and aggression come from the monster data (Wiki).
 *
 * Drops (Wiki, the Corrupted Gauntlet pages, whose weights are exact; the crystalline pages
 * only say common/uncommon, so both modes use them):
 * - weak: 20-30 shards; then nothing 9/24, 3-7 shards 9/24, 1-3 raw paddlefish 3/24, a grym
 *   leaf 2/24, a teleport crystal 1/24; a weapon frame 1/4, always from the first weak kill.
 * - strong: 80-100 shards; then 7-14 shards 9/21, nothing 6/21, 2-4 paddlefish 3/21, a grym
 *   leaf 2/21, a teleport crystal 1/21; a weapon frame 2/7, always by the second strong kill.
 * - demi-boss: 50-60 shards and a weapon frame; its own component (bear spike, dragon orb, dark
 *   beast bowstring) if not owned, else an equal chance of any not owned; then nothing 3/18,
 *   10-21 shards 9/18, 3-5 paddlefish 3/18, a grym leaf 2/18, a teleport crystal 1/18.
 */

const Shared = require("./GauntletShared");
const Items = require("./GauntletItems");
const Rewards = require("./GauntletRewards");

const MONSTERS = {
  rat: { ids: { regular: 9026, corrupted: 9040 }, tier: "weak" },
  spider: { ids: { regular: 9027, corrupted: 9041 }, tier: "weak" },
  bat: { ids: { regular: 9028, corrupted: 9042 }, tier: "weak" },
  unicorn: { ids: { regular: 9029, corrupted: 9043 }, tier: "strong" },
  scorpion: { ids: { regular: 9030, corrupted: 9044 }, tier: "strong" },
  wolf: { ids: { regular: 9031, corrupted: 9045 }, tier: "strong" },
  bear: { ids: { regular: 9032, corrupted: 9046 }, tier: "demi", component: "spike" },
  dragon: { ids: { regular: 9033, corrupted: 9047 }, tier: "demi", component: "orb" },
  dark_beast: { ids: { regular: 9034, corrupted: 9048 }, tier: "demi", component: "bowstring" },
};
const WEAK = ["rat", "spider", "bat"];
const STRONG = ["unicorn", "scorpion", "wolf"];
const COMPONENTS = ["spike", "orb", "bowstring"];
const WANDER = { monster: 3, demi: 0 };
const DEMI_TILE = { x: 7, y: 7 };

/** Per tier: the always-dropped shards and the resource roll (weights out of their sum). */
const TABLES = {
  weak: {
    shards: [20, 30], frameChance: [1, 4],
    roll: [[9, null], [9, "shards", [3, 7]], [3, "rawPaddlefish", [1, 3]], [2, "grymLeaf", [1, 1]], [1, "teleportCrystal", [1, 1]]],
  },
  strong: {
    shards: [80, 100], frameChance: [2, 7],
    roll: [[9, "shards", [7, 14]], [6, null], [3, "rawPaddlefish", [2, 4]], [2, "grymLeaf", [1, 1]], [1, "teleportCrystal", [1, 1]]],
  },
  demi: {
    shards: [50, 60], frame: true,
    roll: [[3, null], [9, "shards", [10, 21]], [3, "rawPaddlefish", [3, 5]], [2, "grymLeaf", [1, 1]], [1, "teleportCrystal", [1, 1]]],
  },
};

const byId = new Map();
for (const [key, monster] of Object.entries(MONSTERS)) {
  for (const id of Object.values(monster.ids)) byId.set(id, { key, ...monster });
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

// ------------------------------------------------------------------ spawning

function npcSize(id) {
  return Shared.core().NpcDefinition.forId(id)?.getSize?.() ?? 1;
}

/** Free inner-floor squares of `size` in a room, away from the doorways. */
function freeSquares(map, room, size) {
  const { RegionManager } = Shared.core();
  const free = (x, y) => {
    const tile = map.roomTile(room, x, y);
    return (RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), map) & 0x1280100) === 0;
  };
  const squares = [];
  for (let x = 3; x + size - 1 <= 12; x++) {
    for (let y = 3; y + size - 1 <= 12; y++) {
      let fits = true;
      for (let dx = 0; dx < size && fits; dx++) for (let dy = 0; dy < size && fits; dy++) fits = free(x + dx, y + dy);
      if (fits) squares.push({ x, y });
    }
  }
  return squares;
}

function spawn(run, room, id, spot, wander) {
  const api = Shared.api();
  const tile = run.map.roomTile(room, spot.x, spot.y);
  const npc = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: wander });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  npc.__gauntletRun = run;
  run.map.add(npc);
  return npc;
}

/** Populates a newly lit room. Returns the NPCs spawned. */
function populateRoom(run, room, random = run.random) {
  if (room.special || room.populated) return [];
  room.populated = true;
  const spawned = [];
  if (room.demiBoss) {
    const id = MONSTERS[room.demiBoss].ids[run.mode];
    const npc = spawn(run, room, id, DEMI_TILE, WANDER.demi);
    if (npc) spawned.push(npc);
    return spawned;
  }
  if (!room.monsters) return spawned;
  const rim = room.gridX === 0 || room.gridY === 0 || room.gridX === 6 || room.gridY === 6;
  const weak = !rim && random() < 0.75;
  const count = weak ? randomInt(random, 1, 4) : 2;
  const taken = [];
  for (let i = 0; i < count; i++) {
    const key = pick(weak ? WEAK : STRONG, random);
    const id = MONSTERS[key].ids[run.mode];
    const size = npcSize(id);
    const spots = freeSquares(run.map, room, size).filter((spot) =>
      taken.every((other) => Math.abs(other.x - spot.x) > other.size + 1 || Math.abs(other.y - spot.y) > other.size + 1));
    if (spots.length === 0) continue;
    const spot = pick(spots, random);
    taken.push({ ...spot, size });
    const npc = spawn(run, room, id, spot, WANDER.monster);
    if (npc) spawned.push(npc);
  }
  return spawned;
}

// ------------------------------------------------------------------ drops

function hasComponent(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id);
}

/** What a run's kill drops, as { itemId, amount } (the NpcDrops shape). Counts the kill. */
function rollDrops(run, player, npcId, random = run.random) {
  const monster = byId.get(npcId);
  if (!monster) return null;
  const items = Items.itemsFor(run.mode);
  const table = TABLES[monster.tier];
  const drops = [{ itemId: items.shards, amount: randomInt(random, ...table.shards) }];
  run.kills[monster.tier] = (run.kills[monster.tier] ?? 0) + 1;
  run.addPoints?.(Rewards.POINTS[monster.tier]);

  if (table.frame) {
    drops.push({ itemId: items.frame, amount: 1 });
  } else {
    const kills = run.kills[monster.tier];
    // Wiki: always from the first weak kill; by the second strong kill at the latest.
    const guaranteed = (monster.tier === "weak" && kills === 1)
      || (monster.tier === "strong" && kills === 2 && !run.strongFrame);
    const [hit, out] = table.frameChance;
    if (guaranteed || Math.floor(random() * out) < hit) {
      drops.push({ itemId: items.frame, amount: 1 });
      if (monster.tier === "strong") run.strongFrame = true;
    }
  }

  if (monster.component) {
    const own = items[monster.component];
    const missing = COMPONENTS.map((key) => items[key]).filter((id) => !hasComponent(player, id) && !run.components.has(id));
    const id = missing.includes(own) ? own : missing.length ? pick(missing, random) : null;
    if (id != null) {
      run.components.add(id);
      drops.push({ itemId: id, amount: 1 });
    }
  }

  const total = table.roll.reduce((sum, [weight]) => sum + weight, 0);
  let roll = Math.floor(random() * total);
  for (const [weight, item, amount] of table.roll) {
    if (roll < weight) {
      if (item) drops.push({ itemId: items[item], amount: randomInt(random, ...amount) });
      break;
    }
    roll -= weight;
  }
  return drops;
}

module.exports = { MONSTERS, WEAK, STRONG, TABLES, byId, populateRoom, rollDrops, freeSquares };
