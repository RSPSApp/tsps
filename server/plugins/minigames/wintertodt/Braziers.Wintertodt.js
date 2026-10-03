"use strict";

/**
 * The braziers: lighting, fixing and feeding.
 *
 * Wiki ("Brazier", "Wintertodt"):
 * - Light: a tinderbox or bruma torch (carried or worn), 25 points and 6x Firemaking level XP.
 *   It can't be lit while its pyromancer is down. Everyone who starts lighting before the
 *   brazier changes gets the full reward.
 * - Fix: a hammer, 25 points and 4x Construction level XP for players who own a house.
 * - Feed: a root is 10 points and 3x Firemaking XP, kindling 25 and 3.8x.
 * Captures: lighting with a bruma torch is anim 7174 and takes 2 ticks ("You light the
 * brazier."); feeding is anim 832, one item every 3 ticks, until "You have run out of bruma
 * roots.". Near-Reality: the tinderbox anim (733), the fix anim (3676) and its messages.
 */

const Shared = require("./WintertodtShared");
const Round = require("./WintertodtRound");
const Corners = require("./WintertodtCorners");

const LIGHT_TICKS = 2;
const FIX_TICKS = 2;
const FEED_TICKS = 3;
const POINTS = { LIGHT: 25, FIX: 25, ROOT: 10, KINDLING: 25 };
const XP = { LIGHT: 6, FIX: 4, ROOT: 3, KINDLING: 3.8 };
/** The house's location varbit; 0 means no house (Construction). */
const VARBIT_HOUSE_LOCATION = 2187;
const BRAZIER_IDS = [Shared.OBJECT.BRAZIER_UNLIT, Shared.OBJECT.BRAZIER_BROKEN, Shared.OBJECT.BRAZIER_LIT];
/** Floor that can't be stood on: a blocking loc or blocked ground. */
const BLOCKED_FLOOR = 0x100 | 0x200000;
const BRAZIER_SIZE = 3;

const approachTiles = new Map();

/** The open tiles beside a brazier's 3x3, on any side (corners excluded). */
function approachesOf(index) {
  if (approachTiles.has(index)) return approachTiles.get(index);
  const { RegionManager } = Shared.core();
  const { x: bx, y: by } = Corners.corner(index).corner.brazier;
  const tiles = [];
  for (let x = bx - 1; x <= bx + BRAZIER_SIZE; x++) {
    for (let y = by - 1; y <= by + BRAZIER_SIZE; y++) {
      const sideX = x === bx - 1 || x === bx + BRAZIER_SIZE;
      const sideY = y === by - 1 || y === by + BRAZIER_SIZE;
      if (sideX === sideY) continue;
      if ((RegionManager.getClipping(x, y, 0, null) & BLOCKED_FLOOR) === 0) tiles.push({ x, y });
    }
  }
  approachTiles.set(index, tiles);
  return tiles;
}

function routeToBrazier(event) {
  if (!BRAZIER_IDS.includes(event.objectId)) return;
  const location = event.object?.getLocation?.();
  const index = location ? Corners.indexOfBrazier(location) : -1;
  if (index < 0) return;
  const { x: sx, y: sy } = event.sourceLocation;
  let best = null;
  let bestDistance = Infinity;
  for (const tile of approachesOf(index)) {
    const distance = Math.max(Math.abs(tile.x - sx), Math.abs(tile.y - sy)) * 100 + Math.hypot(tile.x - sx, tile.y - sy);
    if (distance < bestDistance) {
      best = tile;
      bestDistance = distance;
    }
  }
  if (best) event.destination = { x: best.x, y: best.y, z: 0 };
}

/** The corner whose brazier was clicked; -1 for any other brazier in the world. */
function cornerOf(event) {
  const location = event.object?.getLocation?.();
  return location ? Corners.indexOfBrazier(location) : -1;
}

function quiet(player) {
  if (Round.isActive()) return false;
  player.sendMessage("There's no need to do that at this time.");
  return true;
}

function hasTorch(player) {
  return Shared.hasItem(player, Shared.ITEM.BRUMA_TORCH) || Shared.hasItem(player, Shared.ITEM.BRUMA_TORCH_OFFHAND);
}

// ------------------------------------------------------------------ light

function light(event) {
  const { player } = event;
  const index = cornerOf(event);
  if (index < 0) return false;
  if (quiet(player)) return true;
  const c = Corners.corner(index);
  if (c.brazier === Shared.BRAZIER.BROKEN) {
    player.sendMessage("Fix the brazier before lighting it.");
    return true;
  }
  if (c.brazier === Shared.BRAZIER.LIT) return feed(event);
  if (!c.pyromancerHealthy) {
    player.sendMessage("Heal the Pyromancer before lighting the brazier.");
    return true;
  }
  const torch = hasTorch(player);
  if (!torch && !player.getInventory().contains(Shared.ITEM.TINDERBOX)) {
    player.sendMessage("You need a tinderbox or bruma torch to light that brazier.");
    return true;
  }
  Shared.startAction(player, "light", (ticks) => {
    if (ticks < LIGHT_TICKS) return true;
    finishLighting(player, index);
    return false;
  });
  Shared.animate(player, torch ? Shared.ANIM.LIGHT_TORCH : Shared.ANIM.LIGHT_TINDERBOX);
  return true;
}

function finishLighting(player, index) {
  const c = Corners.corner(index);
  if (!Round.isActive() || c.brazier === Shared.BRAZIER.BROKEN || !c.pyromancerHealthy) return;
  if (c.brazier === Shared.BRAZIER.UNLIT) {
    Corners.setBrazier(index, Shared.BRAZIER.LIT);
    Round.broadcast();
  }
  player.sendMessage("You light the brazier.");
  Round.addPoints(player, POINTS.LIGHT);
  Shared.addXp(player, "FIREMAKING", XP.LIGHT * Shared.level(player, "FIREMAKING"));
}

// ------------------------------------------------------------------ fix

function fix(event) {
  const { player } = event;
  const index = cornerOf(event);
  if (index < 0) return false;
  if (quiet(player)) return true;
  if (Corners.corner(index).brazier !== Shared.BRAZIER.BROKEN) return true;
  if (!player.getInventory().contains(Shared.ITEM.HAMMER)) {
    player.sendMessage("You need a hammer to fix this brazier.");
    return true;
  }
  Shared.startAction(player, "fix", (ticks) => {
    if (ticks < FIX_TICKS) return true;
    finishFixing(player, index);
    return false;
  });
  Shared.animate(player, Shared.ANIM.FIX);
  return true;
}

function finishFixing(player, index) {
  const c = Corners.corner(index);
  if (!Round.isActive() || c.brazier === Shared.BRAZIER.LIT) return;
  if (c.brazier === Shared.BRAZIER.BROKEN) {
    Corners.setBrazier(index, Shared.BRAZIER.UNLIT);
    Round.broadcast();
  }
  player.sendMessage("You fix the brazier.");
  Round.addPoints(player, POINTS.FIX);
  if (player.getPacketSender().getVarbit(VARBIT_HOUSE_LOCATION) > 0) {
    Shared.addXp(player, "CONSTRUCTION", XP.FIX * Shared.level(player, "CONSTRUCTION"));
  }
}

// ------------------------------------------------------------------ feed

function fuelOf(player) {
  const inventory = player.getInventory();
  if (inventory.contains(Shared.ITEM.BRUMA_KINDLING)) return Shared.ITEM.BRUMA_KINDLING;
  if (inventory.contains(Shared.ITEM.BRUMA_ROOT)) return Shared.ITEM.BRUMA_ROOT;
  return -1;
}

/** Puts one root or kindling in; false when there is nothing left to burn. */
function feedOne(player, index) {
  const fuel = fuelOf(player);
  if (fuel < 0) {
    player.sendMessage("You have run out of bruma roots.");
    return false;
  }
  const kindling = fuel === Shared.ITEM.BRUMA_KINDLING;
  player.getInventory().delete(fuel, 1);
  player.getInventory().refreshItems();
  Shared.animate(player, Shared.ANIM.FEED);
  Round.addPoints(player, kindling ? POINTS.KINDLING : POINTS.ROOT);
  Shared.addXp(player, "FIREMAKING", (kindling ? XP.KINDLING : XP.ROOT) * Shared.level(player, "FIREMAKING"));
  return true;
}

function feed(event) {
  const { player } = event;
  const index = cornerOf(event);
  if (index < 0) return false;
  if (!Round.isActive()) {
    player.sendMessage("There's no use for bruma roots at this time.");
    return true;
  }
  if (Corners.corner(index).brazier !== Shared.BRAZIER.LIT) return true;
  if (fuelOf(player) < 0) {
    player.sendMessage("You have run out of bruma roots.");
    return true;
  }
  Shared.startAction(player, `feed:${index}`, (ticks) => {
    if (!Round.isActive() || Corners.corner(index).brazier !== Shared.BRAZIER.LIT) return false;
    if (ticks % FEED_TICKS !== 0) return true;
    return feedOne(player, index);
  });
  feedOne(player, index);
  return true;
}

module.exports = function registerWintertodtBraziers(api) {
  api.onObjectRoute(routeToBrazier);
  api.onObjectInteraction(Shared.OBJECT.BRAZIER, { Light: light, Fix: fix });
  api.onObjectInteraction(Shared.OBJECT.BURNING_BRAZIER, { Feed: feed });
  for (const item of ["Tinderbox", "Bruma torch", "Bruma torch (off-hand)"]) {
    api.onItemOnObject(item, Shared.OBJECT.BRAZIER, light);
  }
  for (const item of ["Bruma root", "Bruma kindling"]) {
    api.onItemOnObject(item, Shared.OBJECT.BURNING_BRAZIER, feed);
  }
  api.onItemOnObject("Hammer", Shared.OBJECT.BRAZIER, fix);
};

module.exports.light = light;
module.exports.fix = fix;
module.exports.feed = feed;
module.exports.routeToBrazier = routeToBrazier;
