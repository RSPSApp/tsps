"use strict";
// Writes the Shortest Path plugin's collision map (client/public/shortestpath/collision-map.zip)
// from this server's own cache and region replacements, so the client routes over the same walls
// the server moves players through. Run after `yarn build`, from server/:
//   node scripts/export-collision-map.cjs [--out <zip>] [--regions <id,id,...>]
//
// The format is Skretzo's shortest-path collision map: one zip entry per map square, named
// "<regionX>_<regionY>", holding a java.util.BitSet's bytes. Each tile has four bits, at
// ((plane * 64 + localY) * 64 + localX) * 4: north edge open, east edge open, north edge is a
// wall or door, east edge is a wall or door. Movement bits start open; trailing zero bytes are
// trimmed (BitSet.toByteArray), so an all-blocked plane above the last walkable one costs nothing.
//
// The edges come from Region.clips, with the masks RegionManager.canMove tests. Two upstream rules
// from CollisionMapDumper (osrs-pathfinding/shortest-path-tooling 92bf3c26) are kept on top:
//   - doors are passable: a wall loc with actions (wallOrDoor) is routed through, since the player
//     opens it on the way; EXCLUDED_DOORS lists the ones that stay shut (locked or quest doors);
//   - a tile with no floor (no underlay or overlay, the void around upper floors) is blocked.
// The output is deterministic: regions in id order, fixed zip timestamps, so a rerun is identical.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SERVER_DIR = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.resolve(SERVER_DIR, "..", "client", "public", "shortestpath", "collision-map.zip");

// RegionManager.BLOCKED_MASK: the solid-object (0x100), blocking floor decoration (0x40000),
// unknown (0x80000), blocked-floor (0x200000) and unloaded (0x1000000) bits, plus the wall bits.
// 0x40000 is what a type-22 ground decoration sets when it is clipped (the log balances, stepping
// stones and other walk-across scenery): without it the map says those tiles are open ground, so
// the pathfinder walks straight over a shortcut instead of using its transport and its level gate.
const TILE_BLOCKED = 0x100 | 0x40000 | 0x80000 | 0x200000 | 0x1000000;
const WALL_NORTH = 0x2;
const WALL_EAST = 0x8;
const WALL_SOUTH = 0x20;
const WALL_WEST = 0x80;

const FLAG_NORTH = 0;
const FLAG_EAST = 1;
const FLAG_WALL_NORTH = 2;
const FLAG_WALL_EAST = 3;
const FLAG_COUNT = 4;
const REGION_SIZE = 64;
const PLANES = 4;

// CollisionMapDumper.Exclusion, the entries that keep a door or gate blocked. Ids alone apply to
// every placement; [id, x, y, z] only to that tile.
const EXCLUDED_DOORS = [
  11393, 4800, 4801, 35795, 20878, [1535, 2789, 3197, 0], [1722, 2794, 3199, 0], 12816, 12817, 12776,
  9562, 10045, 24958, 14910, 2606, 38014, 2689, 24560, 24561, 134, 135, [62422, 3085, 3352, 0],
  4035, 4036, 1804, 17049, 17050, 17051, 17052, 39652, 39653, 79, 80, 41400, 34843, 34854, 43457,
  10060, 10061, 30390, 41801, 24759, 9038, 9039, 4963, 4964, 41814, 41815, 41816, 46380, 46381,
  46382, 5860, 28681, 28798, 12348, 12349, 12350, 11726, 52, 53, 17973, 2599, 2595, 2602, 2601,
  2600, 2597, 2596, 2598, 18411, 31885, 3463, 14216, 14217, 14218, 14219, 14225, 14226, 14228,
  14229, 25636, 9563, 9565, 2881, 11665, 10335, 10337, 10342, 10344, 40889, 2692, 9025, 9026, 9027,
  9028, 9029, 2143, 2144, 2623, 28849, 102, 16061, 16100, 3367, 2149, 3763, 3765, 3767, 3772, 3773,
  3774, 3780, 16518, 2918, 2002, 34932, 46815, 46816, 46817, 26760, 11728, 17047, 17058, 1732, 1733,
  [12045, 2469, 4438, 0], [12047, 2469, 4437, 0], [12045, 2466, 4434, 0], [12047, 2465, 4434, 0], 2406,
];
// The Dwarf Cannon's damaged railings are doors in the cache but only crossed by the quest.
const EXCLUDED_DOOR_RANGES = [[15589, 15603]];

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, regions: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
    else if (argv[i] === "--regions") args.regions = argv[++i].split(",").map(Number).filter(Number.isInteger);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function isExcludedDoor(id, x, y, z) {
  for (const [low, high] of EXCLUDED_DOOR_RANGES) if (id >= low && id <= high) return true;
  for (const entry of EXCLUDED_DOORS) {
    if (entry === id) return true;
    if (Array.isArray(entry) && entry[0] === id && entry[1] === x && entry[2] === y && entry[3] === z) return true;
  }
  return false;
}

/**
 * The tiles of a region with no floor, per plane, as the dumper finds them: a bridge tile's floor
 * is the one a plane up. Parsed like RegionManager.loadMapFiles, keeping the underlay it skips.
 */
function noFloorTiles(terrain, newFormat) {
  let offset = 0;
  const u8 = () => terrain[offset++];
  const u16 = () => { const v = (terrain[offset] << 8) | terrain[offset + 1]; offset += 2; return v; };
  const settings = new Uint8Array(PLANES * REGION_SIZE * REGION_SIZE);
  const floor = new Uint8Array(PLANES * REGION_SIZE * REGION_SIZE);
  for (let z = 0; z < PLANES; z++) {
    for (let x = 0; x < REGION_SIZE; x++) {
      for (let y = 0; y < REGION_SIZE; y++) {
        const index = (z << 12) | (x << 6) | y;
        for (;;) {
          const type = newFormat ? u16() : u8();
          if (type === 0) break;
          if (type === 1) { u8(); break; }
          if (type <= 49) {
            if ((newFormat ? u16() : u8()) !== 0) floor[index] = 1;
          } else if (type <= 81) {
            settings[index] = type - 49;
          } else if (type - 81 !== 0) {
            floor[index] = 1;
          }
        }
      }
    }
  }
  const noFloor = new Uint8Array(PLANES * REGION_SIZE * REGION_SIZE);
  for (let z = 0; z < PLANES; z++) {
    for (let x = 0; x < REGION_SIZE; x++) {
      for (let y = 0; y < REGION_SIZE; y++) {
        const bridge = (settings[(1 << 12) | (x << 6) | y] & 2) !== 0;
        const floorZ = z < 3 && bridge ? z + 1 : z;
        if (!floor[(floorZ << 12) | (x << 6) | y]) noFloor[(z << 12) | (x << 6) | y] = 1;
      }
    }
  }
  return noFloor;
}

function crc32(bytes) {
  return zlib.crc32(bytes) >>> 0;
}

/** A zip with fixed timestamps and no extra fields, so equal entries give equal bytes. */
function writeZip(entries) {
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The cache, target.txt and data/regions are all found from the server directory.
  process.chdir(SERVER_DIR);
  const dist = path.join(SERVER_DIR, "dist");
  if (!fs.existsSync(path.join(dist, "Server.js"))) throw new Error("run `yarn build` in server/ first");
  require(path.join(dist, "Server")).Server.installProductionPathResolver();
  const { CachePipeline } = require(path.join(dist, "game/cache/CachePipeline"));
  const { CacheMaps } = require(path.join(dist, "game/cache/CacheMaps"));
  const { CacheDefinitions } = require(path.join(dist, "game/cache/CacheDefinitions"));
  const { RegionManager } = require(path.join(dist, "game/collision/RegionManager"));
  const { MapRegionReplacementManager } = require(path.join(dist, "game/collision/MapRegionReplacementManager"));
  const { MapObjects } = require(path.join(dist, "game/entity/impl/object/MapObjects"));

  const quiet = console.debug;
  console.debug = () => {};
  const cache = await CachePipeline.initialize(SERVER_DIR);
  RegionManager.init();
  console.debug = quiet;

  const allRegions = CacheMaps.getRegionIds().slice().sort((a, b) => a - b);
  const wanted = args.regions ? new Set(args.regions) : null;
  // A region's edges depend on the tiles just across its border, so its neighbours load too.
  const loadIds = new Set();
  for (const id of wanted ? args.regions : allRegions) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) loadIds.add((((id >> 8) + dx) << 8) | ((id & 0xff) + dy));
    }
  }
  const loaded = allRegions.filter((id) => loadIds.has(id));
  for (const id of loaded) RegionManager.loadMapFiles((id >> 8) * 64, (id & 0xff) * 64, false);

  const newFormat = cache.revision >= 209;
  const noFloor = new Map();
  for (const id of loaded) {
    const replacement = MapRegionReplacementManager.getReplacementMapData(id);
    const terrain = replacement?.terrainData ?? CacheMaps.getRegion(id)?.terrainData;
    if (terrain) noFloor.set(id, noFloorTiles(terrain, newFormat));
  }

  const clip = (x, y, z) => RegionManager.getRegionid(((x >> 6) << 8) | (y >> 6))?.getClip(x, y, z) ?? 0;
  // Wall bits are read before the doors open, so a door's edge still counts as a wall.
  const walls = new Map();
  for (const id of loaded) {
    const region = RegionManager.getRegionid(id);
    walls.set(id, region?.clips ? Uint32Array.from(region.clips) : null);
  }

  // The server clips a diagonal wall as a solid tile; the dumper also records its four edges as
  // walls, which tells a wall from an object's footprint when routing to a blocked target.
  const diagonalWalls = new Set();
  let doors = 0;
  for (const objects of MapObjects.mapObjects.values()) {
    for (const object of objects) {
      const type = object.getType();
      if (!(type >= 0 && type <= 3) && type !== 9) continue;
      const def = object.getDefinition();
      if (!def?.isSolid()) continue;
      const at = object.getLocation();
      if (type === 9) diagonalWalls.add(`${at.getX()},${at.getY()},${at.getZ()}`);
      if (CacheDefinitions.getObject(object.getId())?.isInteractive !== 1) continue;
      if (isExcludedDoor(object.getId(), at.getX(), at.getY(), at.getZ())) continue;
      RegionManager.removeObjectClipping(object);
      doors++;
    }
  }

  const blocked = (x, y, z) => {
    if ((clip(x, y, z) & TILE_BLOCKED) !== 0) return true;
    const tiles = noFloor.get(((x >> 6) << 8) | (y >> 6));
    return !tiles || tiles[(z << 12) | ((x & 63) << 6) | (y & 63)] === 1;
  };
  const wallClip = (x, y, z) => {
    const before = walls.get(((x >> 6) << 8) | (y >> 6));
    let bits = before ? before[(z << 12) | ((x & 63) << 6) | (y & 63)] | 0 : 0;
    if (diagonalWalls.has(`${x},${y},${z}`)) bits |= WALL_NORTH | WALL_EAST | WALL_SOUTH | WALL_WEST;
    return bits;
  };

  const entries = [];
  for (const id of allRegions) {
    if (wanted && !wanted.has(id)) continue;
    const baseX = (id >> 8) * 64;
    const baseY = (id & 0xff) * 64;
    const bits = new Uint8Array(PLANES * REGION_SIZE * REGION_SIZE * FLAG_COUNT / 8);
    const set = (localX, localY, z, flag) => {
      const bit = ((z * REGION_SIZE + localY) * REGION_SIZE + localX) * FLAG_COUNT + flag;
      bits[bit >> 3] |= 1 << (bit & 7);
    };
    for (let z = 0; z < PLANES; z++) {
      for (let localX = 0; localX < REGION_SIZE; localX++) {
        for (let localY = 0; localY < REGION_SIZE; localY++) {
          const x = baseX + localX;
          const y = baseY + localY;
          const here = clip(x, y, z);
          const self = blocked(x, y, z);
          if (!self && !blocked(x, y + 1, z) && (here & WALL_NORTH) === 0 && (clip(x, y + 1, z) & WALL_SOUTH) === 0) {
            set(localX, localY, z, FLAG_NORTH);
          }
          if (!self && !blocked(x + 1, y, z) && (here & WALL_EAST) === 0 && (clip(x + 1, y, z) & WALL_WEST) === 0) {
            set(localX, localY, z, FLAG_EAST);
          }
          if ((wallClip(x, y, z) & WALL_NORTH) !== 0 || (wallClip(x, y + 1, z) & WALL_SOUTH) !== 0) {
            set(localX, localY, z, FLAG_WALL_NORTH);
          }
          if ((wallClip(x, y, z) & WALL_EAST) !== 0 || (wallClip(x + 1, y, z) & WALL_WEST) !== 0) {
            set(localX, localY, z, FLAG_WALL_EAST);
          }
        }
      }
    }
    let length = bits.length;
    while (length > 0 && bits[length - 1] === 0) length--;
    if (length === 0) continue;
    entries.push({ name: `${id >> 8}_${id & 0xff}`, data: Buffer.from(bits.subarray(0, length)) });
  }

  const zip = writeZip(entries);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, zip);
  console.log(`[collision-map] ${entries.length} regions, ${doors} doors opened, ${zip.length} bytes -> ${args.out}`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
