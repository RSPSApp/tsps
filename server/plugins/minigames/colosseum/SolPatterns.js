"use strict";

/**
 * The tiles Sol Heredit's attacks cover, inside the gladiators' barricade.
 *
 * Wiki ("Fortis Colosseum/Strategies", Sol Heredit):
 * - Spear 1: 5x6 (under him and the row in front) with two 4x1 lines towards the player.
 * - Spear 2: 5x5 under him with three 4x1 lines towards the player.
 * - Shield 1: 15x15 around him with a safe ring at 9x9; Shield 2's safe ring is at 11x11.
 * - The barricade keeps the fight inside the four pillars.
 * Offline_Scape: where each line starts for each direction, the 7x7 under him for Spear 2 at a
 * diagonal, and the barricade's corners (1817, 3099)-(1832, 3114). Its lines are 8 tiles; the
 * Wiki's 4 is used.
 */

/** Where the fight happens: inside the barricade. */
const ARENA = { minX: 1818, maxX: 1831, minY: 3100, maxY: 3113 };
/** The barricade's corners; its locs run along the edges between the pillars. */
const BARRICADE = { minX: 1817, maxX: 1832, minY: 3099, maxY: 3114 };
const SIZE = 5;
const LINE = 4;
const SHIELD_REACH = 7;
const SHIELD_SAFE_RING = [4, 5];

const DIRECTIONS = {
  N: [0, 1], NE: [1, 1], E: [1, 0], SE: [1, -1], S: [0, -1], SW: [-1, -1], W: [-1, 0], NW: [-1, 1],
};

/**
 * From Sol's south-west tile, per direction: the row in front (cardinal only, as
 * [fromX, fromY, toX, toY), exclusive ends) and where Spear 1's and Spear 2's lines start.
 */
const SPEAR = {
  W: { strip: [-1, 0, 0, 5], first: [[-2, 1], [-2, 3]], second: [[-2, 0], [-2, 2], [-2, 4]] },
  E: { strip: [5, 0, 6, 5], first: [[6, 1], [6, 3]], second: [[6, 0], [6, 2], [6, 4]] },
  N: { strip: [0, 5, 5, 6], first: [[1, 6], [3, 6]], second: [[0, 6], [2, 6], [4, 6]] },
  S: { strip: [0, -1, 5, 0], first: [[1, -2], [3, -2]], second: [[0, -2], [2, -2], [4, -2]] },
  NE: { first: [[4, 5], [5, 4]], second: [[6, 6], [3, 6], [6, 3]] },
  SE: { first: [[5, 0], [4, -1]], second: [[6, 1], [6, -2], [3, -2]] },
  SW: { first: [[-1, 0], [0, -1]], second: [[-2, -2], [-2, 1], [1, -2]] },
  NW: { first: [[-1, 4], [0, 5]], second: [[-2, 3], [-2, 6], [1, 6]] },
};

function inside(x, y) {
  return x >= ARENA.minX && x <= ARENA.maxX && y >= ARENA.minY && y <= ARENA.maxY;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Which way the player is from Sol's nearest tile. */
function directionTo(sol, player) {
  const closestX = clamp(player.x, sol.x, sol.x + SIZE - 1);
  const closestY = clamp(player.y, sol.y, sol.y + SIZE - 1);
  const dx = Math.sign(player.x - closestX);
  const dy = Math.sign(player.y - closestY);
  return Object.keys(DIRECTIONS).find((key) => DIRECTIONS[key][0] === dx && DIRECTIONS[key][1] === dy) ?? "NW";
}

/** Tiles by ring around a centre, as { x, y, ring }: the ring sets when its smoke shows. */
function square(centreX, centreY, radius, skipRing = -1) {
  const tiles = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (ring === skipRing) continue;
      const x = centreX + dx;
      const y = centreY + dy;
      if (inside(x, y)) tiles.push({ x, y, ring });
    }
  }
  return tiles;
}

/** A line from `start` heading `direction`, stopping at the barricade. */
function line([x, y], [dx, dy], ring) {
  const tiles = [];
  for (let n = 0; n < LINE && inside(x + dx * n, y + dy * n); n++) tiles.push({ x: x + dx * n, y: y + dy * n, ring: ring + n });
  return tiles;
}

/** Spear 1 or 2, from Sol's south-west tile, towards the player. */
function spear(sol, player, second) {
  const key = directionTo(sol, player);
  const shape = SPEAR[key];
  const diagonal = key.length === 2;
  const radius = second && diagonal ? 3 : 2;
  const tiles = square(sol.x + 2, sol.y + 2, radius);
  let ring = radius + 1;
  if (shape.strip) {
    const [fromX, fromY, toX, toY] = shape.strip;
    for (let x = sol.x + fromX; x < sol.x + toX; x++) {
      for (let y = sol.y + fromY; y < sol.y + toY; y++) if (inside(x, y)) tiles.push({ x, y, ring });
    }
    ring++;
  }
  for (const [dx, dy] of second ? shape.second : shape.first) {
    tiles.push(...line([sol.x + dx, sol.y + dy], DIRECTIONS[key], ring));
  }
  return tiles;
}

/** Shield 1 or 2: everything within 7 tiles but the safe ring. */
function shield(sol, second) {
  return square(sol.x + 2, sol.y + 2, SHIELD_REACH, SHIELD_SAFE_RING[second ? 1 : 0]);
}

/** Up to `count` distinct tiles in the 9x9 around the player, kept inside the barricade. */
function sandTargets(player, count, random, taken = () => false) {
  const tiles = [];
  const seen = new Set();
  for (let tries = 0; tiles.length < count && tries < count * 20; tries++) {
    const x = clamp(player.x - 4 + Math.floor(random() * 9), ARENA.minX, ARENA.maxX);
    const y = clamp(player.y - 4 + Math.floor(random() * 9), ARENA.minY, ARENA.maxY);
    const key = `${x},${y}`;
    if (seen.has(key) || taken({ x, y })) continue;
    seen.add(key);
    tiles.push({ x, y });
  }
  return tiles;
}

/** The barricade's tiles: each edge between the pillars, facing in. */
function barricade() {
  const { minX, maxX, minY, maxY } = BARRICADE;
  const tiles = [];
  for (let x = minX + 2; x <= maxX - 2; x++) tiles.push({ x, y: minY, rotation: 2 }, { x, y: maxY, rotation: 0 });
  for (let y = minY + 2; y <= maxY - 2; y++) tiles.push({ x: maxX, y, rotation: 1 }, { x: minX, y, rotation: 3 });
  return tiles;
}

module.exports = { ARENA, BARRICADE, DIRECTIONS, SIZE, inside, directionTo, spear, shield, sandTargets, barricade, line };
