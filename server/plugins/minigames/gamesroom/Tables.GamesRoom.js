const { GAMES } = require('./Games.GamesRoom');
let core;
const reserved = new Set();
// Games Room occupies cache map square 34,77 on two planes. Seating comes from
// the active map's actual stool locs, not historical seating-order guesses.
const REGION_X = 34;
const REGION_Y = 77;

function configure(apiCore) {
  core = apiCore;
}

function key(object) {
  const at = object.getLocation();
  return `${at.getX()},${at.getY()},${at.getZ()},${object.getType()}`;
}

function replace(original, id) {
  const replacement = new core.GameObject(id, original.getLocation().clone(),
    original.getType(), original.getFace(), original.getPrivateArea());
  core.ObjectManager.deregister(original, true);
  core.ObjectManager.register(replacement, true);
  return replacement;
}

function allocate(game, plane) {
  if (!core || !Object.hasOwn(GAMES, game) || ![0, 1].includes(plane)) return null;
  const cache = core.CacheDefinitions;
  const tableId = cache.getLocId('boardgames_table');
  const stoolId = cache.getLocId('boardgames_barstool_white');
  const playingId = cache.getLocId(`boardgames_table_${game}`);
  const hiddenId = cache.getLocId('boardgames_barstool_invis');
  if ([tableId, stoolId, playingId, hiddenId].some(id => id == null)) return null;
  core.RegionManager.loadMapFiles(REGION_X * 64, REGION_Y * 64, false);
  const objects = [];
  for (const entries of core.MapObjects.mapObjects.values()) {
    for (const object of entries) {
      const at = object.getLocation();
      if ((at.getX() >> 6) === REGION_X && (at.getY() >> 6) === REGION_Y && at.getZ() === plane
          && object.getPrivateArea() == null && object.getOwner() == null) objects.push(object);
    }
  }
  const tables = objects.filter(object => object.getId() === tableId && !reserved.has(key(object)));
  tables.sort((a, b) => a.getLocation().getX() - b.getLocation().getX()
    || a.getLocation().getY() - b.getLocation().getY());
  for (const table of tables) {
    const at = table.getLocation();
    const stools = objects.filter(object => object.getId() === stoolId
      && Math.abs(object.getLocation().getX() - at.getX()) <= 1
      && Math.abs(object.getLocation().getY() - at.getY()) <= 1);
    if (stools.length !== 2) continue;
    stools.sort((a, b) => a.getLocation().getX() - b.getLocation().getX()
      || a.getLocation().getY() - b.getLocation().getY());
    const tableKey = key(table);
    reserved.add(tableKey);
    const originals = [table, ...stools], replacements = [];
    let released = false;
    function release() {
      if (released) return;
      released = true;
      for (let i = replacements.length - 1; i >= 0; i--) {
        core.ObjectManager.deregister(replacements[i], true);
        core.ObjectManager.register(originals[i], true);
      }
      reserved.delete(tableKey);
    }
    try {
      replacements.push(replace(table, playingId));
      for (const stool of stools) replacements.push(replace(stool, hiddenId));
    } catch (error) {
      release();
      throw error;
    }
    return { table, playingTable: replacements[0], stools, seats: stools.map(stool => stool.getLocation().clone()), release };
  }
  return null;
}

module.exports = { configure, allocate };
