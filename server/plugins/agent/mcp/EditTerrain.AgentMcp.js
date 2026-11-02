const fs = require("fs");
const path = require("path");
const geometry = require("./EditGeometry.AgentMcp");

// Ground-tile tools for the agent MCP server: inspect and repaint terrain overlays and
// underlays, raise/lower/flatten height, and clear tiles back to base. Changes apply per
// region through the server's region replacement manager, so online players see them when
// their scene rebuilds (walk, teleport, relog; Refresh map in the ?edit editor), and they
// persist as data/regions/<regionId>.pack files, which the server loads on startup.
// Visual only: server collision still comes from objects and the base map, exactly as with
// ?edit editor exports.
const MAP_SIZE = 64;
const PLANE_COUNT = 4;
const MAX_RECT_TILES = 4096;

module.exports = function registerEditTerrainTools(ctx) {
  const { core, tool, z } = ctx;
  const { CacheMaps, CachePipeline, MapRegionReplacementManager } = core;

  // The client picks wide (2-byte) terrain values on oldschool caches rev 209+.
  const wideTerrain = () => (CachePipeline.getActive()?.revision ?? 0) >= 209;

  // Overridable for tests.
  const regionsDir = () =>
    process.env.AGENT_MCP_REGIONS_DIR ?? path.resolve(process.cwd(), "data/regions");

  const baseBytes = (regionId) => {
    const replacement = MapRegionReplacementManager.getReplacementMapData(regionId);
    if (replacement) return replacement;
    const region = CacheMaps.getRegion(regionId);
    if (!region || !region.terrainData) throw new Error(`Region ${regionId} is not in the cache`);
    return { terrainData: region.terrainData, objectData: region.objectData ?? null };
  };

  // Port of client/game/plugins/editmode/RegionPack.ts patchTerrain: splices overlay,
  // height, flag and underlay values into encoded region terrain bytes. Edits are
  // EditModeEdit-shaped: {kind, tileX, tileY, plane, locId, shape, rotation}.
  function patchTerrain(data, edits, mapX, mapY, wide) {
    const overlays = new Map();
    const heights = new Map();
    const flags = new Map();
    const underlays = new Map();
    for (const edit of edits) {
      if ((edit.tileX >> 6) !== mapX || (edit.tileY >> 6) !== mapY) continue;
      const x = edit.tileX & 0x3f;
      const y = edit.tileY & 0x3f;
      if (edit.kind === "clear") {
        for (let plane = 0; plane < PLANE_COUNT; plane++) {
          overlays.set(`${plane}:${x}:${y}`, edit);
        }
      } else if (edit.kind === "terrain") {
        overlays.set(`${edit.plane}:${x}:${y}`, edit);
      } else if (edit.kind === "height") {
        heights.set(`${edit.plane}:${x}:${y}`, edit.locId);
      } else if (edit.kind === "underlay") {
        underlays.set(`${edit.plane}:${x}:${y}`, edit.locId);
      } else if (edit.kind === "flag") {
        flags.set(`${edit.plane}:${x}:${y}`, edit.locId);
      }
    }
    if (overlays.size === 0 && heights.size === 0 && flags.size === 0 && underlays.size === 0) {
      return data.slice();
    }

    const width = wide ? 2 : 1;
    const output = [];
    let offset = 0;
    const readValue = () => {
      if (offset + width > data.length) throw new Error("Truncated region terrain data");
      const value = wide ? (data[offset] << 8) | data[offset + 1] : data[offset];
      offset += width;
      return value;
    };
    const writeTerrainValue = (value) => {
      if (wide) output.push((value >> 8) & 0xff, value & 0xff);
      else output.push(value & 0xff);
    };

    for (let plane = 0; plane < PLANE_COUNT; plane++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        for (let y = 0; y < MAP_SIZE; y++) {
          const overlay = overlays.get(`${plane}:${x}:${y}`);
          const height = heights.get(`${plane}:${x}:${y}`);
          const underlay = underlays.get(`${plane}:${x}:${y}`);
          const flag = flags.get(`${plane}:${x}:${y}`);
          const tileParts = [];
          let terminator;
          const tileStart = offset;
          while (true) {
            const partStart = offset;
            const opcode = readValue();
            if (opcode === 0) {
              terminator = data.subarray(partStart, offset);
              break;
            }
            if (opcode === 1) {
              if (offset >= data.length) throw new Error("Truncated region terrain data");
              offset++;
              terminator = data.subarray(partStart, offset);
              break;
            }
            if (opcode <= 49) readValue();
            if ((!overlay || opcode > 49) && (flag === undefined || opcode < 50 || opcode > 81)
              && (underlay === undefined || opcode <= 81)) {
              tileParts.push(data.subarray(partStart, offset));
            }
          }
          if (!overlay && height === undefined && flag === undefined && underlay === undefined) {
            output.push(...data.subarray(tileStart, offset));
            continue;
          }
          for (const part of tileParts) output.push(...part);
          if (overlay?.kind === "terrain") {
            writeTerrainValue(2 + overlay.shape * 4 + (overlay.rotation & 3));
            writeTerrainValue(overlay.locId);
          }
          if (underlay !== undefined && underlay > 0) writeTerrainValue(81 + underlay);
          if (flag !== undefined && flag > 0) writeTerrainValue(49 + flag);
          if (height === undefined) {
            output.push(...terminator);
          } else {
            writeTerrainValue(1);
            output.push(height & 0xff);
          }
        }
      }
    }
    output.push(...data.subarray(offset));
    return Uint8Array.from(output);
  }

  // Restores a set of tiles ("plane:x:y" keys) to bytes from another encoding of the
  // same region (e.g. the cache originals), keeping every other tile as-is.
  function restoreTiles(current, original, tiles, wide) {
    const width = wide ? 2 : 1;
    const output = [];
    const cursors = [0, 0];
    const sources = [current, original];
    const skipTile = (which) => {
      const data = sources[which];
      let offset = cursors[which];
      const start = offset;
      const readValue = () => {
        if (offset + width > data.length) throw new Error("Truncated region terrain data");
        const value = wide ? (data[offset] << 8) | data[offset + 1] : data[offset];
        offset += width;
        return value;
      };
      while (true) {
        const opcode = readValue();
        if (opcode === 0) break;
        if (opcode === 1) {
          if (offset >= data.length) throw new Error("Truncated region terrain data");
          offset++;
          break;
        }
        if (opcode <= 49) readValue();
      }
      cursors[which] = offset;
      return data.subarray(start, offset);
    };
    for (let plane = 0; plane < PLANE_COUNT; plane++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        for (let y = 0; y < MAP_SIZE; y++) {
          const fromOriginal = tiles.has(`${plane}:${x}:${y}`);
          const tile = skipTile(fromOriginal ? 1 : 0);
          skipTile(fromOriginal ? 0 : 1);
          output.push(...tile);
        }
      }
    }
    output.push(...current.subarray(cursors[0]));
    return Uint8Array.from(output);
  }

  // Reads one tile's values back out of encoded region terrain bytes.
  function decodeTile(data, plane, x, y, wide) {
    const width = wide ? 2 : 1;
    let offset = 0;
    const readValue = () => {
      if (offset + width > data.length) throw new Error("Truncated region terrain data");
      const value = wide ? (data[offset] << 8) | data[offset + 1] : data[offset];
      offset += width;
      return value;
    };
    const result = { overlay: null, underlay: null, height: null, flag: null };
    for (let p = 0; p < PLANE_COUNT; p++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        for (let ty = 0; ty < MAP_SIZE; ty++) {
          const wanted = p === plane && tx === x && ty === y;
          while (true) {
            const opcode = readValue();
            if (opcode === 0) break;
            if (opcode === 1) {
              if (offset >= data.length) throw new Error("Truncated region terrain data");
              const height = data[offset++];
              if (wanted) result.height = height;
              break;
            }
            if (opcode <= 49) {
              const overlayId = readValue();
              if (wanted) {
                result.overlay = {
                  id: overlayId, shape: (opcode - 2) >> 2, rotation: (opcode - 2) & 3,
                };
              }
            } else if (opcode <= 81) {
              if (wanted) result.flag = opcode - 49;
            } else if (wanted) {
              result.underlay = opcode - 81;
            }
          }
        }
      }
    }
    return result;
  }

  const rectSchema = {
    x1: z.number().int().describe("Rectangle corner x"),
    y1: z.number().int().describe("Rectangle corner y"),
    x2: z.number().int().describe("Opposite corner x"),
    y2: z.number().int().describe("Opposite corner y"),
    z: z.number().int().min(0).max(3).default(0).describe("Plane, 0 is ground level"),
  };

  const normalizeRect = ({ x1, y1, x2, y2, z = 0 }) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (const [name, value] of [["x1", minX], ["x2", maxX], ["y1", minY], ["y2", maxY]]) {
      if (!Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error(`Tile ${name}=${value} is outside the world (0-16383)`);
      }
    }
    const tiles = (maxX - minX + 1) * (maxY - minY + 1);
    if (tiles > MAX_RECT_TILES) {
      throw new Error(`Rectangle covers ${tiles} tiles; split it under ${MAX_RECT_TILES}`);
    }
    return { minX, maxX, minY, maxY, z };
  };

  const regionIdFor = (x, y) => ((x >> 6) << 8) | (y >> 6);

  const toU8 = (data) => (data instanceof Uint8Array ? data : Uint8Array.from(data));

  const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

  // Streams one region's bytes to players and persists it so the server loads it on
  // startup.
  //
  // Persistence uses the editor's format: data/regions/<regionId>.pack (header + object
  // archive + terrain archive), so agent edits and map-editor exports look the same on
  // disk and the /regions/<id>.pack endpoint serves either.
  //
  // Streaming is a different question. A REGION_REPLACEMENT packet carries 7 + terrain +
  // objects bytes against a 65,533-byte ceiling, and dense regions are over it from the cache
  // alone; encodeRegionReplacement deflates those, so they still stream whole (Falador 12084:
  // 82,242 raw, ~13,400 deflated). The terrain-only fallback below remains for objects so large
  // that even the deflated payload will not fit - the client then keeps the cache's objects -
  // while the .pack on disk still carries them.
  const commitRegion = (regionId, terrain, tiles) => {
    const mapX = regionId >> 8;
    const mapY = regionId & 0xff;
    const prior = MapRegionReplacementManager.getReplacementMapData(regionId);
    const cacheObjects = CacheMaps.getRegion(regionId)?.objectData ?? null;
    // An existing replacement may carry objects from an editor .pack; keep those in
    // preference to the cache's, so an export's object edits are not thrown away.
    const objects = prior?.objectData ? toU8(prior.objectData) : (cacheObjects ? toU8(cacheObjects) : null);

    let result;
    let streamed = "pack";
    try {
      result = MapRegionReplacementManager.replaceMapRegionData(regionId, terrain, objects, "agent-mcp");
    } catch (error) {
      // Dense region: the packet with objects is too large. Stream the terrain alone; the
      // client keeps the cache's objects, and the .pack on disk still carries them.
      if (!objects || !/too large/i.test(String(error?.message ?? error))) {
        throw new Error(`Region ${regionId}: ${error?.message ?? error}`);
      }
      streamed = "terrain";
      result = MapRegionReplacementManager.replaceMapRegionData(regionId, terrain, null, "agent-mcp");
    }

    const dir = regionsDir();
    fs.mkdirSync(dir, { recursive: true });
    const packPath = path.join(dir, `${regionId}.pack`);
    const terrainPath = path.join(dir, `${regionId}.terrain.dat`);

    // Back to the cache's own terrain and its own objects: nothing to persist, so the
    // region stops loading as a replacement on restart. The live replacement stays for
    // this session, so clients still holding the edited terrain get the cache's on their
    // next scene rebuild.
    const cacheTerrain = CacheMaps.getRegion(regionId)?.terrainData;
    const objectsAreCache = !objects || !cacheObjects || sameBytes(objects, toU8(cacheObjects));
    if (objectsAreCache && cacheTerrain && sameBytes(terrain, toU8(cacheTerrain))) {
      for (const file of [packPath, terrainPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
      return { regionId, mapX, mapY, tiles, ...result, packFile: null, terrainFile: null,
        persisted: false, matchesCache: true, streamed };
    }

    const pack = MapRegionReplacementManager.getRegionPack(regionId, objects ?? undefined);
    if (pack) {
      fs.writeFileSync(packPath, pack);
      if (fs.existsSync(terrainPath)) fs.unlinkSync(terrainPath);
      return { regionId, mapX, mapY, tiles, ...result, packFile: packPath, terrainFile: null,
        persisted: true, streamed };
    }
    // No object archive for this region in the cache (nothing to build a pack from).
    fs.writeFileSync(terrainPath, Buffer.from(terrain));
    if (fs.existsSync(packPath)) fs.unlinkSync(packPath);
    return { regionId, mapX, mapY, tiles, ...result, packFile: null, terrainFile: terrainPath,
      persisted: true, streamed };
  };

  // Patches every touched region, streams it to players, and persists the pack so the
  // server loads it on startup.
  const applyEdits = (edits, label) => {
    const wide = wideTerrain();
    const byRegion = new Map();
    for (const edit of edits) {
      const regionId = regionIdFor(edit.tileX, edit.tileY);
      if (!byRegion.has(regionId)) byRegion.set(regionId, []);
      byRegion.get(regionId).push(edit);
    }
    const regions = [];
    for (const [regionId, regionEdits] of byRegion) {
      const base = baseBytes(regionId);
      const mapX = regionId >> 8;
      const mapY = regionId & 0xff;
      regions.push(commitRegion(
        regionId,
        patchTerrain(toU8(base.terrainData), regionEdits, mapX, mapY, wide),
        regionEdits.length,
      ));
    }
    return { change: label, regions };
  };

  tool(
    "describe_tile",
    "Read a ground tile's terrain: overlay (painted texture), underlay (ground texture), height (0-255) and flag, on one plane. Reports the live value, including agent or editor replacements.",
    {
      x: z.number().int().describe("World tile x"),
      y: z.number().int().describe("World tile y"),
      z: z.number().int().min(0).max(3).default(0),
    },
    ({ x, y, z = 0 }) => {
      if (!Number.isInteger(x) || x < 0 || x > 16383 || !Number.isInteger(y) || y < 0 || y > 16383) {
        throw new Error(`Tile ${x},${y} is outside the world (0-16383)`);
      }
      const base = baseBytes(regionIdFor(x, y));
      const terrain = base.terrainData instanceof Uint8Array
        ? base.terrainData : Uint8Array.from(base.terrainData);
      return { x, y, z, ...decodeTile(terrain, z, x & 0x3f, y & 0x3f, wideTerrain()) };
    }
  );

  tool(
    "paint_ground",
    "Paint ground tiles with an overlay (paths, floors) and/or an underlay (grass, sand, rock), or clear tiles back to base. Overlay ids are cache-specific: overlay 1 is the dirt path the ?edit editor uses as its default (DEFAULT_PATH_OVERLAY_ID), and ids seen in the world can be read back with describe_tile before painting with them. Applies per region; players see it on scene rebuild (walk, teleport, relog; Refresh map in ?edit). Visual only: collision is unchanged.",
    {
      ...rectSchema,
      overlay: z.number().int().min(1).optional().describe("Overlay texture id (omit to keep)"),
      overlayShape: z.number().int().min(0).default(0),
      overlayRotation: z.number().int().min(0).max(3).default(0),
      underlay: z.number().int().min(1).optional().describe("Underlay texture id (omit to keep)"),
      clear: z.boolean().default(false).describe("Clear painted overlays back to base first"),
    },
    ({ overlay, overlayShape = 0, overlayRotation = 0, underlay, clear = false, ...rect }) => {
      if (overlay === undefined && underlay === undefined && !clear) {
        throw new Error("Give overlay and/or underlay, or clear:true");
      }
      const { minX, maxX, minY, maxY, z } = normalizeRect(rect);
      const edits = [];
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (clear) edits.push({ kind: "clear", tileX: x, tileY: y, plane: z });
          if (overlay !== undefined) {
            edits.push({
              kind: "terrain", tileX: x, tileY: y, plane: z,
              locId: overlay, shape: overlayShape, rotation: overlayRotation,
            });
          }
          if (underlay !== undefined) {
            edits.push({ kind: "underlay", tileX: x, tileY: y, plane: z, locId: underlay });
          }
        }
      }
      return applyEdits(edits, `paint ${edits.length} edits`);
    }
  );

  tool(
    "set_height",
    "Raise, lower or flatten ground height (0-255) over a rectangle on one plane; flatten_area sets every plane. Players see it on scene rebuild. Visual only: it does not move objects or change collision, so pair it with object edits.",
    {
      ...rectSchema,
      height: z.number().int().min(0).max(255).describe("Height value"),
      allPlanes: z.boolean().default(false).describe("Apply to planes 0-3 (flatten)"),
    },
    ({ height, allPlanes = false, ...rect }) => {
      if (!Number.isInteger(height) || height < 0 || height > 255) {
        throw new Error(`Height ${height} is outside 0-255`);
      }
      const { minX, maxX, minY, maxY, z } = normalizeRect(rect);
      const planes = allPlanes ? [0, 1, 2, 3] : [z];
      const edits = [];
      for (const plane of planes) {
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            edits.push({ kind: "height", tileX: x, tileY: y, plane, locId: height });
          }
        }
      }
      return applyEdits(edits, `height ${height} over ${edits.length} tiles`);
    }
  );

  tool(
    "clear_terrain",
    "Restore a rectangle to the base map on every plane: painted overlays, heights, flags and underlays all go back to the cached originals. Other tiles in the touched regions keep their edits.",
    {
      x1: rectSchema.x1, y1: rectSchema.y1, x2: rectSchema.x2, y2: rectSchema.y2,
    },
    (rect) => {
      const { minX, maxX, minY, maxY } = normalizeRect({ ...rect, z: 0 });
      const wide = wideTerrain();
      const byRegion = new Map();
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const regionId = regionIdFor(x, y);
          if (!byRegion.has(regionId)) byRegion.set(regionId, new Set());
          const tiles = byRegion.get(regionId);
          for (let plane = 0; plane < PLANE_COUNT; plane++) {
            tiles.add(`${plane}:${x & 0x3f}:${y & 0x3f}`);
          }
        }
      }
      const regions = [];
      for (const [regionId, tiles] of byRegion) {
        const current = toU8(baseBytes(regionId).terrainData);
        const cache = CacheMaps.getRegion(regionId);
        if (!cache?.terrainData) throw new Error(`Region ${regionId} is not in the cache`);
        // `tiles` holds one key per plane; report world tiles, as the rectangle has them.
        regions.push(commitRegion(regionId, restoreTiles(current, toU8(cache.terrainData), tiles, wide), tiles.size / PLANE_COUNT));
      }
      return { change: `clear ${regions.reduce((n, r) => n + r.tiles, 0)} tiles on every plane`, regions };
    }
  );

  tool(
    "list_region_packs",
    "Regions with active agent/editor replacements (regionId, map tile range). These persist as data/regions/<regionId>.pack - the map editor's own format - and load on startup; matchesCache marks one cleared back to the cache, which has no file and is gone after a restart.",
    {},
    () => ({
      count: MapRegionReplacementManager.getRegionIds().length,
      regions: MapRegionReplacementManager.getRegionIds().map((regionId) => {
        const mapX = regionId >> 8;
        const mapY = regionId & 0xff;
        const replacement = MapRegionReplacementManager.getReplacementMapData(regionId);
        const cache = CacheMaps.getRegion(regionId)?.terrainData;
        const cacheObjects = CacheMaps.getRegion(regionId)?.objectData;
        // A replacement is back to the cache only when both halves match: its terrain
        // and its objects (a .pack carries the cache's objects, a live edit may too).
        const objectsAreCache = !replacement?.objectData || !cacheObjects
          || sameBytes(toU8(replacement.objectData), toU8(cacheObjects));
        const matchesCache = Boolean(replacement && objectsAreCache && cache
          && sameBytes(toU8(replacement.terrainData), toU8(cache)));
        return {
          regionId, mapX, mapY, x1: mapX * 64, y1: mapY * 64, x2: mapX * 64 + 63, y2: mapY * 64 + 63, matchesCache,
        };
      }),
    })
  );

  // Templates read and write terrain through these, so a pasted floor goes through the
  // same patching, budget check and persistence as paint_ground.
  const tileAt = (x, y, z) => decodeTile(
    toU8(baseBytes(regionIdFor(x, y)).terrainData), z, x & 0x3f, y & 0x3f, wideTerrain(),
  );
  /**
   * Height edits that level a building's footprint and blend its edge (levelPlan), read from
   * the live terrain on plane 0. Callers apply them with their own edits, before placing.
   */
  const levelEdits = (x0, y0, x1, y1, options = {}) => {
    // Tiles on or next to an indoor floor (flag 4) belong to a building already standing:
    // its walls sit on those corners, so the blend leaves them be.
    const indoor = (x, y) => ((tileAt(x, y, 0).flag ?? 0) & 4) !== 0;
    const keep = (x, y) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (indoor(x + dx, y + dy)) return true;
      return false;
    };
    const plan = geometry.levelPlan((x, y) => tileAt(x, y, 0).height, x0, y0, x1, y1, { keep, ...options });
    const edits = plan.tiles.map((tile) => ({ kind: "height", tileX: tile.x, tileY: tile.y, plane: 0, locId: tile.height }));
    return { edits, level: plan.level, spread: plan.spread, moved: plan.moved, unknown: plan.unknown };
  };
  return { applyEdits, tileAt, levelEdits };
};
