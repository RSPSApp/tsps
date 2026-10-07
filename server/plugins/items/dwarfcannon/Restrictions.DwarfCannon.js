/**
 * Where a cannon can't be set up: the Wiki's prohibited areas, with their messages, in
 * data/definitions/cannon-restrictions.json. Instanced content is refused with the default.
 */
const fs = require("fs");
const path = require("path");
const Cannon = require("./Common.DwarfCannon");

const FILE = "cannon-restrictions.json";

let restrictions = null;

function load() {
  if (restrictions) return restrictions;
  const file = path.join(Cannon.core.GameConstants.DEFINITIONS_DIRECTORY, FILE);
  restrictions = JSON.parse(fs.readFileSync(file, "utf8"));
  return restrictions;
}

/** Even-odd rule on tile coordinates; polygon points are tile corners. */
function inPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The message refusing a cannon at `location`, or null where one may be set up. */
function restrictionAt(location, privateArea = null) {
  const data = load();
  if (privateArea) return data.default;
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();
  for (const restriction of data.restrictions) {
    for (const area of restriction.areas ?? []) {
      if (area.z !== undefined && area.z !== z) continue;
      if (inPolygon(area.points, x, y)) return restriction.message;
    }
  }
  return null;
}

module.exports = { restrictionAt, inPolygon, load, FILE };
