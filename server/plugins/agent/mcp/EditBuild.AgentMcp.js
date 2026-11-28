const { editorGenerationPath } = require("../../world/EditorGeneration");
const fs = require("fs");
const path = require("path");
const geometry = require("./EditGeometry.AgentMcp");
const { createObjectSpawnStore } = require("./EditSpawnStore.AgentMcp");

// Higher-level map building for the agent MCP.
//
// The single-object tools (place_object, remove_object, ...) are the foundation, but a
// city is thousands of tiles: driving them one call at a time is slow and makes the
// agent do arithmetic that belongs in code. These tools raise the level:
//
//   place_objects  - one call, many placements, one definition-file write
//   build_shape    - a wall/ring/box/tower/avenue of one material, in one call
//   build_preset   - a named structure (house, tower, gatehouse, plaza, tiered_city)
//                    from data/edit-presets.json, with parameters
//   list_presets   - what is available, with its parameters
//   plan_build     - what a build would place, without touching the world
//
// Shapes come from EditGeometry.AgentMcp.js (pure tile math, unit tested); materials
// come from the preset catalog, so ids stay in data rather than in tool arguments.

const PRESETS_FILE = editorGenerationPath("buildings/data/edit-presets.json");
const MAX_BATCH = 4000;

function readCatalog() {
  const parsed = JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8"));
  if (!parsed?.materials || !parsed?.presets) {
    throw new Error(`${PRESETS_FILE}: needs "materials" and "presets"`);
  }
  return parsed;
}

const { planPreset, planParts, collapseOverlaps } = require(editorGenerationPath("buildings/Presets"));

module.exports = function registerEditBuildTools(ctx) {
  const { core, tool, z } = ctx;
  const { GameObject, ObjectManager, Location, ObjectDefinition, CacheDefinitions } = core;

  const spawnsFile = () =>
    process.env.AGENT_MCP_SPAWNS_FILE ?? path.resolve(process.cwd(), "data/definitions/object-spawns.json");
  const store = () => createObjectSpawnStore(spawnsFile());

  const objectCount = () => CacheDefinitions.getCounts().objects;

  const validate = (id, x, y, z, type, face) => {
    if (!Number.isInteger(id) || id < 0 || id >= objectCount()) throw new Error(`Unknown object id ${id}`);
    for (const [name, value] of [["x", x], ["y", y]]) {
      if (!Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error(`Tile ${name}=${value} is outside the world (0-16383)`);
      }
    }
    if (!Number.isInteger(z) || z < 0 || z > 3) throw new Error(`Plane z=${z} is outside 0-3`);
    if (!Number.isInteger(type) || type < 0 || type > 22) throw new Error(`Type ${type} is outside 0-22`);
    if (!Number.isInteger(face) || face < 0 || face > 3) throw new Error(`Face ${face} is outside 0-3`);
  };

  /**
   * Applies placements: registers them live for every player, then writes the
   * definition file once (a per-object write would rewrite a 30k-entry file
   * thousands of times).
   *
   * Validation runs over the whole batch before anything is registered: a bad id or
   * tile partway through must not leave half a structure standing in the world with
   * nothing persisted, because that divergence lasts until the next restart.
   */
  const validatePlacements = (requested) => {
    if (requested.length > MAX_BATCH) {
      throw new Error(`Batch of ${requested.length} exceeds ${MAX_BATCH}; split the build`);
    }
    const { placements, overlapped } = collapseOverlaps(requested);
    const problems = [];
    placements.forEach((item, index) => {
      const { id, x, y, z = 0, type = 10, face = 0 } = item;
      try {
        validate(id, x, y, z, type, face);
        if (!ObjectDefinition.forId(id)) throw new Error(`no definition for object id ${id}`);
      } catch (error) {
        if (problems.length < 10) problems.push({ index, reason: String(error?.message ?? error) });
      }
    });
    if (problems.length > 0) {
      throw new Error(
        `Nothing was placed: ${problems.length} placement(s) are invalid, e.g. ${JSON.stringify(problems)}`,
      );
    }

    return { placements, overlapped };
  };

  const applyPlacements = (requested, prepared = validatePlacements(requested)) => {
    const { placements, overlapped } = prepared;
    if (placements.length === 0) return { placed: 0, skipped: [], persisted: 0, overlapped, replaced: 0 };
    const spawnStore = store();
    const entries = spawnStore.read();
    let placed = 0;
    const skipped = [];
    let persisted = 0;
    let replaced = 0;
    for (const [index, item] of placements.entries()) {
      const { id, x, y, z = 0, type = 10, face = 0 } = item;
      try {
        ObjectManager.register(new GameObject(id, new Location(x, y, z), type, face, null), true);
        placed++;
      } catch (error) {
        // Keep going (one bad tile should not abort a city) but say why.
        if (skipped.length < 10) skipped.push({ index, x, y, reason: String(error?.message ?? error) });
        continue;
      }
      // The live object it replaced must not come back from its old entry on reload.
      replaced += spawnStore.dropReplaced(entries, id, x, y, z, type, face);
      const existing = spawnStore.find(entries, id, x, y, z, type, face);
      if (!existing) {
        // A razed tile still carries a removal marker for this object; clear it, or the
        // marker deletes the new placement on the next load.
        spawnStore.dropRemoval(entries, id, x, y, z, type);
        entries.push({ id, position: { x, y, z }, type, face, source: "agent-mcp" });
        persisted++;
      }
    }
    if (persisted > 0 || replaced > 0) spawnStore.write(entries);
    return { placed, skipped, persisted, overlapped, replaced };
  };

  const summarize = (placements) => {
    const ids = {};
    for (const item of placements) ids[item.id] = (ids[item.id] ?? 0) + 1;
    const xs = placements.map((item) => item.x);
    const ys = placements.map((item) => item.y);
    return {
      count: placements.length,
      bounds: placements.length === 0 ? null : {
        x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys),
      },
      byObjectId: ids,
      sample: placements.slice(0, 8),
    };
  };

  tool(
    "place_objects",
    "Place many objects in one call: [{id, x, y, z?, type?, face?}]. Registers them live for every player and persists them in one file write. Use this instead of repeated place_object calls for anything bigger than a handful of tiles.",
    {
      objects: z.array(z.object({
        id: z.number().int().min(0),
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int().min(0).max(3).optional(),
        type: z.number().int().min(0).max(22).optional(),
        face: z.number().int().min(0).max(3).optional(),
      })).min(1).max(MAX_BATCH),
    },
    ({ objects }) => {
      const started = Date.now();
      const result = applyPlacements(objects);
      return { ...result, ms: Date.now() - started };
    }
  );

  tool(
    "build_shape",
    "Build one shape of one material in a single call, e.g. a 20-tile wall line, a ring of castle wall with a gate gap, a box with a doorway, a tower, or an avenue of lamps. " +
      "Shapes: line, ring, box, tower, repeated, avenue, column. For line/avenue/repeated, (x, y) is the start tile and (x2, y2) the end tile; for ring it is the centre; for box/tower it is the low-x/low-y corner.",
    {
      shape: z.enum(["line", "ring", "box", "tower", "repeated", "avenue", "column"]),
      id: z.number().int().min(0).optional().describe("Object id, or omit and use `material`"),
      material: z.string().optional().describe("Material name from list_presets (alternative to id)"),
      x: z.number().int().describe("Origin / centre x"),
      y: z.number().int().describe("Origin / centre y"),
      z: z.number().int().min(0).max(3).default(0),
      radius: z.number().int().min(1).max(64).optional(),
      thickness: z.number().int().min(1).max(8).optional(),
      gapDegrees: z.number().min(0).max(360).optional(),
      gapAngle: z.number().min(0).max(360).optional(),
      width: z.number().int().min(1).max(64).optional(),
      height: z.number().int().min(1).max(64).optional(),
      doorSide: z.enum(["north", "south", "east", "west"]).optional(),
      doorWidth: z.number().int().min(1).max(9).optional(),
      x2: z.number().int().optional(),
      y2: z.number().int().optional(),
      spacing: z.number().int().min(1).max(32).optional(),
      offset: z.number().int().min(1).max(32).optional(),
      rotation: z.number().int().min(-270).max(270).default(0),
    },
    ({ shape, id, material, x, y, z = 0, rotation = 0, ...options }) => {
      if (id === undefined && material === undefined) {
        throw new Error("Give either `id` (a cache object id) or `material` (a name from list_presets)");
      }
      const catalog = readCatalog();
      // Line-family shapes take absolute start/end tiles; the geometry engine works in
      // offsets from the preset origin, so shift the end point into that space.
      const endRelative = (["line", "avenue", "repeated"].includes(shape))
        ? {
            x1: 0,
            y1: 0,
            x2: options.x2 === undefined ? 0 : options.x2 - x,
            y2: options.y2 === undefined ? 0 : options.y2 - y,
          }
        : {};
      const plan = planParts(
        [{ shape, material: material ?? id, x: 0, y: 0, ...options, ...endRelative }],
        { originX: x, originY: y, params: {}, rotation, catalog },
      ).map((item) => ({ ...item, z }));
      const { placements, overlapped } = collapseOverlaps(plan);
      const result = applyPlacements(placements);
      return { ...result, overlapped, ...summarize(placements) };
    }
  );

  tool(
    "build_preset",
    "Build a named structure from data/edit-presets.json (house, tower, gatehouse, plaza, tiered_city) at an origin tile, with parameters and 90-degree rotation. One call builds the whole thing.",
    {
      preset: z.string().describe("Preset name; list_presets shows what exists"),
      x: z.number().int().describe("Origin tile x"),
      y: z.number().int().describe("Origin tile y"),
      z: z.number().int().min(0).max(3).default(0),
      rotation: z.number().int().min(-270).max(270).default(0),
      params: z.record(z.union([z.number(), z.string(), z.array(z.number().int())])).optional(),
    },
    ({ preset, x, y, z = 0, rotation = 0, params = {} }) => {
      const catalog = readCatalog();
      const entry = catalog.presets[preset];
      if (!entry) throw new Error(`Unknown preset "${preset}"; known: ${Object.keys(catalog.presets).join(", ")}`);
      const { placements, overlapped } = collapseOverlaps(planPreset(entry, x, y, rotation, params, catalog)
        .map((item) => ({ ...item, z })));
      const result = applyPlacements(placements);
      return { preset, ...result, overlapped, ...summarize(placements) };
    }
  );

  tool(
    "plan_build",
    "Dry run: report what a preset would place (count, tile bounds, objects by id) without changing the world. Use it to size a build before spending time on it.",
    {
      preset: z.string(),
      x: z.number().int(),
      y: z.number().int(),
      rotation: z.number().int().min(-270).max(270).default(0),
      params: z.record(z.union([z.number(), z.string(), z.array(z.number().int())])).optional(),
    },
    ({ preset, x, y, rotation = 0, params = {} }) => {
      const catalog = readCatalog();
      const entry = catalog.presets[preset];
      if (!entry) throw new Error(`Unknown preset "${preset}"`);
      const { placements, overlapped } = collapseOverlaps(planPreset(entry, x, y, rotation, params, catalog));
      return { preset, overlapped, ...summarize(placements) };
    }
  );

  tool(
    "list_presets",
    "Named structures available to build_preset, each with its parameters, plus the material names usable as ids.",
    {},
    () => {
      const catalog = readCatalog();
      return {
        materials: Object.fromEntries(Object.entries(catalog.materials).map(([name, entry]) =>
          [name, { id: entry.id, about: entry.about }])),
        presets: Object.fromEntries(Object.entries(catalog.presets).map(([name, entry]) =>
          [name, { about: entry.about, params: entry.params ?? {}, repeat: entry.repeat ?? null,
            parts: entry.parts.length }])),
      };
    }
  );

  // Templates (EditTemplates.AgentMcp.js) place through the same path, so their
  // placements validate, collapse and persist exactly like a build's.
  return { applyPlacements, validatePlacements };
};

module.exports.readCatalog = readCatalog;
module.exports.planPreset = planPreset;
