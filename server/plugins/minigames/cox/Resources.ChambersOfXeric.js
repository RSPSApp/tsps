"use strict";

/**
 * Resource rooms and the raid's gathering: fishing (and its cave snake), bats, the herb patches,
 * gourds and the geysers, saplings for kindling, the tools, the weeds and the energy well.
 *
 * Wiki (Chambers of Xeric, Resources):
 * - Bats and fish tier by the team (not said how exactly: bats below use the raid's best Hunter
 *   level; fish the fisher's own level, as the Bubbles page lists a level per fish).
 * - Fish need a fishing rod and cave worms; one of a room's three spots holds a cave snake that
 *   bites and steals food; that spot moves now and then. Fish: Fishing 1/15/30/45/60/75/90 for
 *   20/23/26/29/32/35/38 XP. Bats need a butterfly net, or 99 Hunter to catch barehanded: Hunter
 *   1/15/.../90 for 5/9/.../29 XP; two to three bats in a room.
 * - Herbs grow from golpar (Farming 27), buchu (39) and noxifer (55) seeds raked from weeds, in
 *   herb patches, with a seed dibber, fully grown in 30 seconds; picked herbs are grimy.
 * - Weeds (Weeds, Chambers of Xeric): raking goes on until cancelled, each pass 1-3 seeds of any
 *   of the three, one chance in three each.
 * - Gourds come from the gourd tree (Pick, Pick-lots) and are filled with water at a geyser.
 * Cache: bubbles (all on plane 0, so room A), geysers, gourd trees, tools, patches and the
 * well are map locs; FISHING_SPOTS are exactly those bubbles.
 * No capture fishes, catches a bat, plants, picks, rakes or picks a gourd: these stay unchecked:
 * - Resource room A has fishing (the snake spot one of three per version, moving every 50 ticks
 *   or after 10 snake rises; catch chance min(round((level - req) x 0.6) + 30, 70)%, every 4
 *   ticks); room B has 2 + raiders/8 bats (at most the Wiki's 3) of one type among the three best
 *   the raid's top Hunter level allows, and a caught bat comes back 2 ticks later. Catch chance
 *   (floor(306 x (level - 1) / 98) - 78) / 255, at least 10% so that the low levels the Wiki allows
 *   can catch at all (derived); anims 6606 caught, 6605 missed.
 * - The cave snake (7594) rises (anim 7333), bites 3 ticks later for 3-6 everyone within a
 *   tile of the spot and takes one food each, and dives (anim 4039) at 5.
 * - Herb patches grow a stage every 12 ticks to stage 4 (object id + 3 a stage); planting
 *   anim 2291, picking 2282 every 2 ticks with a 65% + (level - req)/250 chance (at most 95%)
 *   of keeping each of the patch's 3 lives; clearing with a spade (anim 830). XP planting /
 *   picking: golpar 4/10, buchu 6/15, noxifer 12/30.
 * - Raking weeds: anim 2273, every 3 ticks.
 * - Saplings give kindling (at most 28) with any axe.
 * Wiki (Ice demon; Mod Ash): a sapling falls at 1 in max(3, 2 x raiders), five times rarer in
 *   the Ice Demon's room.
 * rsprox captures (sapling chopping in all five recordings): "You swing your axe...", kindling
 *   every 5 ticks of chopping without fail (sound 2070, no message), the fallen sapling's sound
 *   2734, and its growing back 54-64 ticks later. Taking a tool (hammer 3389:65087, tinderbox
 *   3285:238750): anim 827 on arriving, the item and sound 2582 the next tick.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

const ITEM = {
  ROD: [307, 22846], CAVE_WORM: 20853, NET: 10010, RAKE: 5341, SPADE: 952, DIBBER: 5343,
  EMPTY_GOURD: 20800, WATER_GOURD: 20801, KINDLING: 20799, BRONZE_AXE: 1351, HAMMER: 2347,
  TINDERBOX: 590, IRON_PICKAXE: 1267,
};
const OBJECT = {
  BUBBLES: 29889, SAPLING: 29763, STUMP: 29764, GOURD_TREE: 29772, GEYSER: 29878, OLD_TOOLS: 29771,
  EMPTY_PATCH: 29765, WEEDS: 29773, ENERGY_WELL: 30066, BRONZE_AXE: 31862, HAMMER: 29711, TINDERBOX: 31634, IRON_PICKAXE: 41754,
};
const NPC = { CAVE_SNAKE: 7594 };

const FISH = [
  { item: 20855, level: 1, xp: 20 }, { item: 20857, level: 15, xp: 23 }, { item: 20859, level: 30, xp: 26 },
  { item: 20861, level: 45, xp: 29 }, { item: 20863, level: 60, xp: 32 }, { item: 20865, level: 75, xp: 35 },
  { item: 20867, level: 90, xp: 38 },
];
const BATS = [
  { npc: 7587, name: "Guanic bat", item: 20870, level: 1, xp: 5 }, { npc: 7588, name: "Prael bat", item: 20872, level: 15, xp: 9 },
  { npc: 7589, name: "Giral bat", item: 20874, level: 30, xp: 13 }, { npc: 7590, name: "Phluxia bat", item: 20876, level: 45, xp: 17 },
  { npc: 7591, name: "Kryket bat", item: 20878, level: 60, xp: 21 }, { npc: 7592, name: "Murng bat", item: 20880, level: 75, xp: 25 },
  { npc: 7593, name: "Psykk bat", item: 20882, level: 90, xp: 29 },
];
const BAT_NAMES = BATS.map((bat) => bat.name);
const HERBS = [
  { name: "golpar", patch: 29998, seed: 20906, grimy: 20904, level: 27, plantXp: 4, pickXp: 10 },
  { name: "buchu", patch: 29999, seed: 20909, grimy: 20907, level: 39, plantXp: 6, pickXp: 15 },
  { name: "noxifer", patch: 29997, seed: 20903, grimy: 20901, level: 55, plantXp: 12, pickXp: 30 },
];
const SEEDS = HERBS.map((herb) => herb.seed);
/** The herb patch's growing and grown forms (29997-30011), after the empty patch. */
const GROWING_PATCHES = { FIRST: 29997, LAST: 30011 };
const PATCH_IDS = [OBJECT.EMPTY_PATCH];
for (let id = GROWING_PATCHES.FIRST; id <= GROWING_PATCHES.LAST; id++) PATCH_IDS.push(id);
const BAREHANDED_HUNTER = 99;
const MIN_BAT_CHANCE = 0.1;
const GROWN_STAGE = 4;
const STAGE_TICKS = 12;
const PATCH_LIVES = 3;
const KINDLING_CAP = 28;
const SAPLING_CHOP_TICKS = 5;
const FOOD_IDS = new Set([...FISH.map((fish) => fish.item + 1), ...BATS.map((bat) => bat.item + 1)]);

/** Resource room tiles on the cache's map by version (west, north, east). */
const BAT_SPOTS = [
  [{ x: 3282, y: 5463 }, { x: 3288, y: 5461 }, { x: 3285, y: 5457 }],
  [{ x: 3308, y: 5455 }, { x: 3301, y: 5458 }, { x: 3305, y: 5462 }],
  [{ x: 3348, y: 5455 }, { x: 3344, y: 5459 }, { x: 3343, y: 5464 }],
];
const FISHING_SPOTS = [
  [{ x: 3274, y: 5457 }, { x: 3280, y: 5451 }, { x: 3281, y: 5454 }],
  [{ x: 3302, y: 5459 }, { x: 3308, y: 5449 }, { x: 3306, y: 5461 }],
  [{ x: 3337, y: 5453 }, { x: 3345, y: 5445 }, { x: 3343, y: 5461 }],
];
const SNAKE_SPOTS = [
  [{ x: 3275, y: 5457 }, { x: 3279, y: 5451 }, { x: 3280, y: 5454 }],
  [{ x: 3302, y: 5458 }, { x: 3309, y: 5449 }, { x: 3306, y: 5460 }],
  [{ x: 3338, y: 5453 }, { x: 3345, y: 5446 }, { x: 3343, y: 5460 }],
];
const SNAKE = { moveTicks: 50, maxRises: 10, biteAt: 3, diveAt: 5, rise: 7333, dive: 4039, minHit: 3, maxHit: 6 };

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sameTile(a, b) {
  return a && b && a.getX() === b.getX() && a.getY() === b.getY() && a.getZ() === b.getZ();
}

// ---------------------------------------------------------------- the rooms

class ResourcesRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.spotIndex = 0;
    this.ticks = 0;
    this.rises = 0;
    this.snake = null;
  }

  load() {
    if (this.key === "RESOURCES_B") this.loadBats();
    else this.moveSnakeSpot(Math.floor(Math.random() * 3));
  }

  /** Bats of one type among the three best the raid's top Hunter level allows. */
  loadBats() {
    const hunter = Math.max(1, ...[...this.raid.players].map((player) => Shared.baseLevel(player, "HUNTER")));
    const allowed = BATS.filter((bat) => bat.level <= hunter).slice(-3);
    const type = allowed[Math.floor(Math.random() * allowed.length)] ?? BATS[0];
    const spots = BAT_SPOTS[this.record.variant];
    const count = Math.min(3, 2 + (this.raid.scale >> 3));
    for (let i = 0; i < count; i++) {
      const spot = spots[Math.floor(Math.random() * spots.length)];
      const bat = this.spawnNpc(type.npc, spot, { wanderRadius: 3 });
      if (bat) bat.__coxBat = type;
    }
  }

  moveSnakeSpot(index) {
    this.spotIndex = index;
    this.fishingSpot = this.tile(FISHING_SPOTS[this.record.variant][index].x, FISHING_SPOTS[this.record.variant][index].y);
    this.snakeSpot = this.tile(SNAKE_SPOTS[this.record.variant][index].x, SNAKE_SPOTS[this.record.variant][index].y);
  }

  tick() {
    if (this.key !== "RESOURCES_A" || !this.fishingSpot) return;
    if (++this.ticks >= SNAKE.moveTicks || this.rises >= SNAKE.maxRises) {
      this.ticks = 0;
      this.rises = 0;
      const others = [0, 1, 2].filter((index) => index !== this.spotIndex);
      this.moveSnakeSpot(others[Math.floor(Math.random() * others.length)]);
    }
  }

  isSnakeSpot(tile) {
    return sameTile(tile, this.fishingSpot);
  }

  /** The snake rises at its spot, bites whoever stands by it, and dives. */
  riseSnake() {
    if (this.snake) return;
    this.rises++;
    const at = this.snakeSpot.clone().add(-1, -1);
    const snake = this.spawnNpc(NPC.CAVE_SNAKE, at);
    if (!snake) return;
    this.snake = snake;
    snake.setPositionToFace?.(this.fishingSpot);
    Shared.animate(snake, SNAKE.rise);
    Shared.later(this.raid, SNAKE.biteAt, () => this.bite());
    Shared.later(this.raid, SNAKE.diveAt, () => {
      if (snake.isRegistered()) Shared.animate(snake, SNAKE.dive);
      Shared.later(this.raid, 2, () => {
        this.removeNpc(snake);
        this.snake = null;
      });
    });
  }

  bite() {
    const { HitDamage, HitMask } = Shared.core();
    for (const player of this.raid.players) {
      if (player.getLocation().getDistance(this.fishingSpot) > 1) continue;
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(randomInt(SNAKE.minHit, SNAKE.maxHit), HitMask.RED)]);
      const items = player.getInventory().getItems();
      const slot = items.findIndex((item) => item && FOOD_IDS.has(item.getId()));
      if (slot >= 0) {
        player.getInventory().deleteAtSlot(slot, 1, true);
        player.sendMessage("The snake stole some food off you!");
      }
    }
  }
}

Raid.registerRoom("RESOURCES_A", ResourcesRoom);
Raid.registerRoom("RESOURCES_B", ResourcesRoom);

function raidAndRoom(player) {
  const raid = Raid.raidOf(player);
  return raid ? { raid, room: raid.roomAt(player.getLocation()) } : null;
}

// ---------------------------------------------------------------- fishing

function fish(event) {
  const { player, object } = event;
  const here = raidAndRoom(player);
  if (!here) return false;
  if (!ITEM.ROD.some((id) => Shared.has(player, id))) {
    player.sendMessage("You need a fishing rod to fish here.");
    return true;
  }
  if (!Shared.has(player, ITEM.CAVE_WORM)) {
    player.sendMessage("You need some suitable bait to catch these fish.");
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("Your inventory is too full to do that.");
    return true;
  }
  const level = Shared.level(player, "FISHING");
  const type = FISH.filter((entry) => entry.level <= level).at(-1);
  const room = here.room instanceof ResourcesRoom ? here.room : null;
  const snakeHere = () => room?.isSnakeSpot(object.getLocation());
  Shared.animate(player, 622);
  if (snakeHere()) {
    room.riseSnake();
    player.sendMessage("This seems like a very bad moment to fish here.");
    return true;
  }
  player.sendMessage("You cast out your line...");
  Shared.action(player, {
    first: 4,
    interval: 4,
    step() {
      if (snakeHere()) {
        room.riseSnake();
        player.sendMessage("This seems like a very bad moment to fish here.");
        return false;
      }
      if (player.getInventory().getFreeSlots() <= 0) {
        player.sendMessage("Your inventory is too full to do that.");
        return false;
      }
      if (!Shared.has(player, ITEM.CAVE_WORM)) {
        player.sendMessage("You need some suitable bait to catch these fish.");
        return false;
      }
      Shared.animate(player, 622);
      const chance = Math.min(Math.round((Shared.level(player, "FISHING") - type.level) * 0.6) + 30, 70);
      if (chance > Math.random() * 100) {
        player.getInventory().delete(ITEM.CAVE_WORM, 1);
        Shared.give(player, type.item);
        Shared.addXp(player, "FISHING", type.xp);
      }
      return true;
    },
    stop: () => Shared.animate(player, -1),
  });
  return true;
}

// ---------------------------------------------------------------- bats

function catchBat(event) {
  const { player, npc } = event;
  const type = npc?.__coxBat ?? BATS.find((bat) => bat.npc === npc?.getId());
  if (!type || !Raid.raidOf(player)) return false;
  if (!Shared.wielding(player, ITEM.NET) && Shared.baseLevel(player, "HUNTER") < BAREHANDED_HUNTER) {
    Shared.statement(player, "You need a butterfly net to catch these bats.");
    return true;
  }
  const level = Shared.level(player, "HUNTER");
  if (level < type.level) {
    player.sendMessage(`You need a Hunter level of at least ${type.level} to catch this bat.`);
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You need some free inventory space to catch the bat.");
    return true;
  }
  const chance = Math.max(MIN_BAT_CHANCE, (Math.floor((306 * (level - 1)) / 98) - 78) / 255);
  const caught = Math.random() < chance;
  const name = npc.getDefinition?.()?.getName?.()?.toLowerCase() ?? "bat";
  Shared.animate(player, caught ? 6606 : 6605);
  Shared.sound(player, 2623);
  Shared.later(player, 1, () => {
    if (!caught || !npc.isRegistered()) {
      player.sendMessage(`You fail to catch the ${name}.`);
      return;
    }
    player.sendMessage(`You successfully catch the ${name}.`);
    Shared.sound(player, 293);
    Shared.give(player, type.item);
    Shared.addXp(player, "HUNTER", type.xp);
    respawnBat(npc, type);
  });
  return true;
}

function respawnBat(npc, type) {
  const room = npc.__coxRoom;
  const spot = npc.getLocation().clone();
  room?.removeNpc(npc);
  Shared.later(room?.raid ?? npc, 2, () => {
    if (!room || room.raid.destroyed) return;
    const bat = room.spawnNpc(type.npc, spot, { wanderRadius: 3 });
    if (bat) bat.__coxBat = type;
  });
}

// ---------------------------------------------------------------- the herb patches

function patchKey(object) {
  const at = object.getLocation();
  return `${at.getX()},${at.getY()},${at.getZ()}`;
}

function patchesOf(raid) {
  raid.patches ??= new Map();
  return raid.patches;
}

/** Every patch grows a stage each 12 ticks until it is grown. */
function growPatches(raid) {
  for (const patch of patchesOf(raid).values()) {
    if (patch.stage >= GROWN_STAGE || ++patch.ticks < STAGE_TICKS) continue;
    patch.ticks = 0;
    patch.stage++;
    patch.object = Shared.replaceObject(raid.map, patch.object, patch.herb.patch + patch.stage * 3);
  }
}

function plant(player, object, seedId) {
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  if (object.getId() !== OBJECT.EMPTY_PATCH) {
    player.sendMessage("There are already herbs growing there!");
    return true;
  }
  const herb = HERBS.find((entry) => entry.seed === seedId);
  if (!herb) return false;
  if (Shared.level(player, "FARMING") < herb.level) {
    player.sendMessage(`You need a Farming level of at least ${herb.level} to plant ${herb.name} seeds.`);
    return true;
  }
  if (!Shared.has(player, ITEM.DIBBER)) {
    player.sendMessage("You need a seed dibber to plant seeds.");
    return true;
  }
  const key = patchKey(object);
  if (patchesOf(raid).has(key)) {
    player.sendMessage("Someone else is already planting something here.");
    return true;
  }
  Shared.animate(player, 2291);
  Shared.sound(player, 2432);
  patchesOf(raid).set(key, { planting: true });
  Shared.later(player, 1, () => {
    if (!Shared.has(player, herb.seed)) {
      patchesOf(raid).delete(key);
      return;
    }
    player.getInventory().delete(herb.seed, 1);
    player.sendMessage(`You plant a ${herb.name} in the herb patch.`);
    Shared.addXp(player, "FARMING", herb.plantXp);
    patchesOf(raid).set(key, {
      herb, stage: 0, ticks: 0, lives: PATCH_LIVES, object: Shared.replaceObject(raid.map, object, herb.patch),
    });
  });
  return true;
}

function emptyPatch(raid, key, patch) {
  patchesOf(raid).delete(key);
  Shared.replaceObject(raid.map, patch.object, OBJECT.EMPTY_PATCH);
}

function inspectPatch(player, patch) {
  Shared.later(player, 1, () => {
    if (!patch?.herb) {
      player.sendMessage("This patch is currently empty. The soil looks to be imbued by a magical power, not many seeds would be capable of growing here.");
      return;
    }
    const name = patch.herb.name;
    const text = [
      `There's a freshly planted ${name} plant growing here.`,
      `There's a ${name} plant growing here.`,
      `There's a ${name} plant growing here. It looks to be about half-grown.`,
      `There's a ${name} plant growing here. It's almost ready for harvesting.`,
      `There's a ${name} plant growing here. It's ready to be harvested.`,
    ][patch.stage];
    player.sendMessage(text);
  });
  player.sendMessage("You inspect the herb patch...");
}

function pickPatch(player, raid, key, patch) {
  if (Shared.level(player, "FARMING") < patch.herb.level) {
    player.sendMessage(`You need a Farming level of at least ${patch.herb.level} to harvest these herbs.`);
    return;
  }
  player.sendMessage("You begin to harvest the herb patch.");
  Shared.animate(player, 2282);
  Shared.action(player, {
    first: 2,
    interval: 2,
    step() {
      if (patchesOf(raid).get(key) !== patch || patch.lives <= 0) return false;
      Shared.sound(player, 2581);
      Shared.addXp(player, "FARMING", patch.herb.pickXp);
      Shared.give(player, patch.herb.grimy);
      const chance = Math.min(0.95, 0.65 + (Shared.level(player, "FARMING") - patch.herb.level) / 250);
      if (chance < Math.random() && --patch.lives <= 0) {
        emptyPatch(raid, key, patch);
        player.sendMessage("The herb patch is now empty.");
        return false;
      }
      Shared.animate(player, 2282);
      return true;
    },
  });
}

function clearPatch(player, raid, key, patch) {
  if (Shared.level(player, "FARMING") < patch.herb.level) {
    player.sendMessage(`You need a Farming level of at least ${patch.herb.level} to clear ${patch.herb.name} patch.`);
    return;
  }
  if (!Shared.has(player, ITEM.SPADE)) {
    player.sendMessage("You need a spade to clear this patch.");
    return;
  }
  Shared.animate(player, 830);
  Shared.sound(player, 1470);
  Shared.later(player, 1, () => {
    if (patchesOf(raid).get(key) !== patch) return;
    player.sendMessage("You clear the patch...");
    for (const raider of raid.players) Shared.raidMessage(raider, `${Shared.displayName(player)} has cleared the farming patch.`);
    emptyPatch(raid, key, patch);
  });
}

function usePatch(event) {
  const { player, object, option } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const key = patchKey(object);
  const patch = patchesOf(raid).get(key);
  if (option === "Inspect") inspectPatch(player, patch);
  else if (option === "Pick" && patch?.herb) pickPatch(player, raid, key, patch);
  else if (option === "Clear" && patch?.herb) clearPatch(player, raid, key, patch);
  return true;
}

function itemOnPatch(event) {
  const { player, object, itemId } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  if (itemId === ITEM.SPADE) {
    const key = patchKey(object);
    const patch = patchesOf(raid).get(key);
    if (patch?.herb) clearPatch(player, raid, key, patch);
    return true;
  }
  return plant(player, object, itemId);
}

/** Raking goes on until cancelled or out of room, each pass 1-3 seeds of any type. */
function rakeWeeds(event) {
  const { player } = event;
  if (!Raid.raidOf(player)) return false;
  if (!Shared.has(player, ITEM.RAKE)) {
    player.sendMessage("You need a rake to do that.");
    return true;
  }
  const noRoom = () => player.getInventory().getFreeSlots() <= 0 && !SEEDS.every((seed) => Shared.has(player, seed));
  if (noRoom()) {
    player.sendMessage("You need some free inventory space to do this.");
    return true;
  }
  Shared.animate(player, 2273);
  Shared.sound(player, 2442);
  Shared.action(player, {
    first: 4,
    interval: 3,
    step() {
      if (noRoom()) {
        player.sendMessage("You need some free inventory space to do this.");
        return false;
      }
      Shared.give(player, SEEDS[Math.floor(Math.random() * SEEDS.length)], randomInt(1, 3));
      Shared.animate(player, 2273);
      Shared.sound(player, 2442);
      return true;
    },
    stop: () => Shared.animate(player, -1),
  });
  return true;
}

// ---------------------------------------------------------------- gourds, saplings, tools

function pickGourds(event) {
  const { player, option } = event;
  if (!Raid.raidOf(player)) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You need some more free inventory space to pick the gourd tree.");
    return true;
  }
  const single = option === "Pick";
  Shared.animate(player, 2280);
  Shared.action(player, {
    first: 2,
    interval: 2,
    step() {
      const free = player.getInventory().getFreeSlots();
      if (free <= 0) return false;
      Shared.give(player, ITEM.EMPTY_GOURD, single ? 1 : free);
      player.sendMessage(`You pick ${single ? "a" : "some"} gourd fruit from the tree, tearing the ${single ? "top" : "tops"} off in the process.`);
      Shared.sound(player, 2437);
      if (!single) return false;
      Shared.animate(player, 2280);
      return true;
    },
  });
  return true;
}

/** Fills every empty gourd from a geyser. */
function fillGourds(event) {
  const { player } = event;
  if (!Raid.raidOf(player)) return false;
  const { Item } = Shared.core();
  const inventory = player.getInventory();
  let filled = 0;
  inventory.getItems().forEach((item, slot) => {
    if (item?.getId() !== ITEM.EMPTY_GOURD) return;
    inventory.setItem(slot, new Item(ITEM.WATER_GOURD, 1));
    filled++;
  });
  if (filled === 0) {
    player.sendMessage("You need an empty gourd vial to fill from the geyser.");
    return true;
  }
  inventory.refreshItems();
  Shared.animate(player, 832);
  player.sendMessage(`You fill the gourd vial${filled > 1 ? "s" : ""} from the geyser.`);
  return true;
}

function emptyGourd(event) {
  const { player, slot } = event;
  const { Item } = Shared.core();
  player.getInventory().setItem(slot, new Item(ITEM.EMPTY_GOURD, 1)).refreshItems();
  Shared.sound(player, 2401);
  return true;
}

/** Saplings give kindling, 28 at most; now and then one falls for 15 ticks. */
function chopSapling(event) {
  const { player, object } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const axe = Shared.axeOf(player);
  if (!axe) {
    player.sendMessage("You do not have an axe which you have the woodcutting level to use.");
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0 && !Shared.has(player, ITEM.KINDLING)) {
    player.sendMessage("Not enough space in your inventory.");
    return true;
  }
  player.sendMessage("You swing your axe...");
  let ticks = 0;
  Shared.action(player, {
    first: 1,
    interval: 1,
    step() {
      if (object.__coxFelled) return false;
      if (ticks++ % 4 === 0) Shared.animate(player, axe.animation);
      // rsprox captures: kindling every 5 ticks of chopping, without fail.
      if (ticks % SAPLING_CHOP_TICKS !== 0) return true;
      const have = player.getInventory().getAmount(ITEM.KINDLING);
      if (have >= KINDLING_CAP) {
        player.sendMessage("You already have the maximum amount of kindlings.");
        return false;
      }
      const iceDemonRoom = raid.roomAt(player.getLocation())?.key === "ICE_DEMON";
      const amount = Math.min(KINDLING_CAP - have, iceDemonRoom ? kindlingPerChop(player) : 1);
      Shared.give(player, ITEM.KINDLING, amount);
      Shared.addXp(player, "WOODCUTTING", KINDLING_XP[amount - 1] ?? KINDLING_XP[0]);
      Shared.sound(player, 2070);
      const fallOdds = Math.max(3, 2 * raid.scale) * (iceDemonRoom ? 5 : 1);
      if (Math.floor(Math.random() * fallOdds) === 0) {
        fellSapling(raid, object);
        return false;
      }
      return true;
    },
    stop: () => Shared.animate(player, -1),
  });
  return true;
}

/**
 * Wiki (Ice demon; Mod Ash): in the Ice Demon's room a chop gives 0 to Woodcutting / 12
 * (boosts count) kindling, 0 counting as 1.
 */
function kindlingPerChop(player) {
  return Math.max(1, Shared.random(0, Math.floor(Shared.level(player, "WOODCUTTING") / 12)));
}

/** Woodcutting XP by how much kindling one chop gave (Wiki, Kindling: Mod Bruno's table). */
const KINDLING_XP = [30, 45, 55, 62.5, 68.5, 73.5, 77.7, 81.5];

function fellSapling(raid, sapling) {
  if (sapling.__coxFelled) return;
  sapling.__coxFelled = true;
  const stump = Shared.replaceObject(raid.map, sapling, OBJECT.STUMP);
  const viewers = [...raid.players].filter((player) => raid.roomAt(player.getLocation()) === raid.roomAt(stump.getLocation()));
  Shared.areaSound(viewers, 2734, stump.getLocation(), { range: 4 });
  // rsprox captures: a sapling grows back 54-64 ticks after falling.
  Shared.later(raid, Shared.random(54, 64), () => {
    if (!raid.destroyed) Shared.replaceObject(raid.map, stump, OBJECT.SAPLING);
  });
}

/** The old tools: a rake, a spade and a seed dibber. */
function takeTools(event) {
  const { player, option } = event;
  if (!Raid.raidOf(player)) return false;
  const tools = { "Take Rake": [ITEM.RAKE], "Take Spade": [ITEM.SPADE], "Take Seed Dibber": [ITEM.DIBBER] };
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You need some free inventory space to take the tools.");
    return true;
  }
  if (tools[option]) {
    takeTool(player, tools[option][0]);
    return true;
  }
  if ([ITEM.RAKE, ITEM.SPADE, ITEM.DIBBER].every((id) => Shared.has(player, id))) {
    player.sendMessage("You have nothing more to take from here.");
    return true;
  }
  Shared.options(player, "Select a Tool",
    "Rake.", () => takeTool(player, ITEM.RAKE),
    "Spade.", () => takeTool(player, ITEM.SPADE),
    "Seed dibber.", () => takeTool(player, ITEM.DIBBER),
    "Take all.", () => [ITEM.RAKE, ITEM.SPADE, ITEM.DIBBER].forEach((id) => takeTool(player, id, true)));
  return true;
}

function takeTool(player, id, quiet = false) {
  if (Shared.has(player, id)) {
    if (!quiet) player.sendMessage(`You already have a ${Shared.core().ItemDefinition.forId(id).getName().toLowerCase()}.`);
    return;
  }
  Shared.give(player, id);
}

/** A tool lying in the raid: take one (a bronze axe only if you have none). */
function pickUpTool(id, name, { one = false } = {}) {
  return function takeLyingTool(event) {
    const { player } = event;
    if (!Raid.raidOf(player)) return false;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(`You need some free inventory space to take a ${name}.`);
      return true;
    }
    if (one && Shared.has(player, id)) {
      player.sendMessage("You already have one of those.");
      return true;
    }
    Shared.animate(player, 827);
    Shared.later(player, 1, () => {
      Shared.sound(player, 2582);
      Shared.give(player, id);
    });
    return true;
  };
}

function touchWell(event) {
  const { player } = event;
  if (!Raid.raidOf(player)) return false;
  Shared.animate(player, 832);
  if (player.getRunEnergy() >= 100) {
    player.sendMessage("The pool has no effect on you.");
    return true;
  }
  Shared.sound(player, 224);
  player.setRunEnergy(100);
  player.getPacketSender().sendRunEnergy();
  player.sendMessage("You feel replenished.");
  return true;
}

/** The raid's farming ticks with it. */
function tickFarming(raid) {
  if (raid.patches?.size) growPatches(raid);
}

function itemOnRaidObject(event) {
  const id = event.objectId ?? event.object?.getId?.();
  if (id === OBJECT.GEYSER && event.itemId === ITEM.EMPTY_GOURD) return fillGourds(event) || undefined;
  if (PATCH_IDS.includes(id) && (SEEDS.includes(event.itemId) || event.itemId === ITEM.SPADE)) {
    if (itemOnPatch(event)) event.handled = true;
  }
  return undefined;
}

module.exports = function registerCoxResources(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.BUBBLES], fish);
  Shared.onObjectIds(api, [OBJECT.SAPLING], chopSapling);
  Shared.onObjectIds(api, [OBJECT.GOURD_TREE], pickGourds);
  Shared.onObjectIds(api, [OBJECT.GEYSER], fillGourds);
  Shared.onObjectIds(api, [OBJECT.OLD_TOOLS], takeTools);
  Shared.onObjectIds(api, PATCH_IDS, usePatch);
  Shared.onObjectIds(api, [OBJECT.WEEDS], rakeWeeds);
  Shared.onObjectIds(api, [OBJECT.ENERGY_WELL], touchWell);
  Shared.onObjectIds(api, [OBJECT.BRONZE_AXE], pickUpTool(ITEM.BRONZE_AXE, "bronze axe", { one: true }));
  Shared.onObjectIds(api, [OBJECT.HAMMER], pickUpTool(ITEM.HAMMER, "hammer"));
  Shared.onObjectIds(api, [OBJECT.TINDERBOX], pickUpTool(ITEM.TINDERBOX, "tinderbox"));
  Shared.onObjectIds(api, [OBJECT.IRON_PICKAXE], pickUpTool(ITEM.IRON_PICKAXE, "pickaxe", { one: true }));
  api.onItemOnObject(itemOnRaidObject);
  api.onNpcsInteraction(BAT_NAMES, { Catch: catchBat });
  api.onItemAction("Water-filled gourd vial", { Empty: emptyGourd });
  Raid.onTick(tickFarming);
};

Object.assign(module.exports, { FISH, BATS, HERBS, ResourcesRoom, plant, growPatches, patchesOf, KINDLING_CAP });
