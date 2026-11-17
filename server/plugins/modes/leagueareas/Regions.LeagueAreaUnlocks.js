/**
 * Which area a map square (64 x 64 tiles, the cache's map archive) belongs to, built once per
 * league from the data's rectangles and squares over the cache's own map list
 * (CacheMaps.getRegionIds). The rules (data `regionRules`): the lowest-numbered area that names a
 * square owns it, a league's overrides reassign squares, an unnamed underground square (map y >=
 * 100) follows its surface square, and a square nobody names is open to everyone.
 * Sourced tile outlines refine only mixed squares; explicit underground ownership wins over
 * the legacy surface-offset approximation. League overrides remain last.
 */
const Common = require("./Common.LeagueAreaUnlocks");

const UNDERGROUND_ROWS = 100;

/** league type -> map square id -> area id. */
const byLeague = new Map();
/** Sparse tile detail, only for mixed squares; league overrides still take precedence. */
const tilesByLeague = new Map();

function squareId(mapX, mapY) {
  return ((mapX & 0xff) << 8) | (mapY & 0xff);
}

function squareOf(x, y) {
  return squareId(x >> 6, y >> 6);
}

function claim(index, mapX, mapY, area, cacheSquares) {
  const id = squareId(mapX, mapY);
  if (cacheSquares.has(id)) index.set(id, area);
}

function claimRect(index, [minX, minY, maxX, maxY], area, cacheSquares) {
  for (let mapX = minX; mapX <= maxX; mapX++) {
    for (let mapY = minY; mapY <= maxY; mapY++) claim(index, mapX, mapY, area, cacheSquares);
  }
}

function build(type) {
  const cacheSquares = new Set(Common.core.CacheMaps.getRegionIds());
  const index = new Map();
  const tiles = new Map();
  const ids = [...Common.areas.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const area = Common.area(id);
    const own = new Map();
    for (const [mapX, mapY] of area.squares) claim(own, mapX, mapY, id, cacheSquares);
    for (const rect of area.rects) claimRect(own, rect, id, cacheSquares);
    for (const [square, owner] of own) if (!index.has(square)) index.set(square, owner);
    for (const polygon of area.tilePolygons) {
      for (const [mapX, mapY] of polygon.squares) {
        const square = squareId(mapX, mapY);
        if (!cacheSquares.has(square)) continue;
        if (!tiles.has(square)) tiles.set(square, []);
        tiles.get(square).push({ area: id, outline: polygon.outline });
      }
    }
  }
  for (const override of Common.league(type)?.overrides ?? []) {
    const own = new Map();
    claimRect(own, override.rect, override.area, cacheSquares);
    for (const [square, owner] of own) {
      index.set(square, owner);
      tiles.delete(square);
    }
  }
  for (const square of cacheSquares) {
    const mapY = square & 0xff;
    if (mapY < UNDERGROUND_ROWS || index.has(square)) continue;
    const surface = squareId(square >> 8, mapY - UNDERGROUND_ROWS);
    if (index.has(surface)) index.set(square, index.get(surface));
  }
  byLeague.set(type, index);
  tilesByLeague.set(type, tiles);
  return index;
}

function indexFor(type) {
  return byLeague.get(type) ?? build(type);
}

/** Wiki vertices are tile grid lines; classify each tile by its centre with the crossing rule. */
function contains(outline, x, y) {
  x += 0.5;
  y += 0.5;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[j], [bx, by] = outline[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** The area id owning the tile, or null when it is open to everyone. */
function areaAt(type, x, y) {
  const index = indexFor(type);
  const square = squareOf(x, y);
  for (const polygon of tilesByLeague.get(type).get(square) ?? []) {
    if (contains(polygon.outline, x, y)) return polygon.area;
  }
  return index.get(square) ?? null;
}

/** Whether a same-square move needs the tile-level check; no scan of unrelated players/areas. */
function hasTileDetail(type, x, y) {
  indexFor(type);
  return tilesByLeague.get(type).has(squareOf(x, y));
}

/** Whether the character may stand on the tile: open ground, or an area it unlocked in a league that offers it. */
function isOpen(type, player, x, y) {
  const area = areaAt(type, x, y);
  if (area === null) return true;
  return Common.league(type).areas.includes(area) && Common.unlocked(player).includes(area);
}

function isOpenAt(type, player, location) {
  return isOpen(type, player, location.getX(), location.getY());
}

module.exports = { areaAt, isOpen, isOpenAt, squareId, squareOf, indexFor, hasTileDetail };
