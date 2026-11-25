const fs = require("fs");
const path = require("path");
const geometry = require("./EditGeometry.AgentMcp");
const { sizeOf } = require("./EditSizes.AgentMcp");
const { createStructurePlanner, RECIPES, INTERIORS, EXTERIORS, MAX_SEED, rng } = require("./StructureRecipes.AgentMcp");

// Generators: new structures in a captured style, laid out by rules read off real ones.
//
//   build_house     - walls, door, window frames, floors and a hip roof, one or two storeys
//   build_graveyard - an enclosure with rows of gravestones, a path from the gate, dead trees
//   build_farm      - a fenced field planted in rows, with a scarecrow and hay
//
// Wall pieces come from a style (capture_style); decoration ids from
// plugins/agent/data/edit-sets.json, hand-maintained and checked by screenshot. Everything
// goes live and persists through the same paths as place_objects and paint_ground.

const SIDES = ["south", "north", "east", "west"];

function createGeneratorPlans(core, terrain, styles) {
  const setsFile = () =>
    process.env.AGENT_MCP_SETS_FILE ?? path.resolve(__dirname, "..", "data", "edit-sets.json");
  const sets = () => JSON.parse(fs.readFileSync(setsFile(), "utf8"));

  const checkArea = (x, y, width, height, min) => {
    for (const [name, value] of [["x", x], ["y", y]]) {
      if (!Number.isInteger(value) || value < 0 || value + 64 > 16383) throw new Error(`Tile ${name}=${value} is outside the world`);
    }
    if (width < min || height < min) throw new Error(`Needs at least ${min}x${min} tiles`);
  };

  /** The four corners round the inside of a box, and the corner a gateway on `side` starts at. */
  const enclosure = (x0, y0, x1, y1, side) => {
    const points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const midX = Math.floor((x0 + x1) / 2);
    const midY = Math.floor((y0 + y1) / 2);
    // Gaps name the corner whose next edge stays open, in the order the path walks it.
    const gate = { south: [midX, y0], east: [x1, midY], north: [midX + 1, y1], west: [x0, midY + 1] }[side];
    return { points, gate };
  };

  // Ground more uneven than this across a footprint is a hillside: levelling it carves a
  // terrace, which the result says rather than doing it quietly.
  const STEEP = 16;
  /** Levels a footprint before building on it; the edits go first so the build sits on them. */
  const levelled = (x0, y0, x1, y1) => {
    const plan = terrain.levelEdits(x0, y0, x1, y1, { blend: 2 });
    const report = { level: plan.level, tilesChanged: plan.moved, spread: plan.spread };
    if (plan.unknown > 0) report.unstoredHeights = plan.unknown;
    if (plan.level === null) report.note = "No stored heights under the footprint; left as it is";
    else if (plan.spread > STEEP) report.note = `Steep ground (heights vary by ${plan.spread}): the footprint is cut level into it`;
    return { edits: plan.edits, report };
  };

  // Deterministic choice, so a rebuild with the same arguments places the same stones.
  const pick = (list, seed) => list[Math.abs(Math.imul(seed, 2654435761) >> 7) % list.length];

  const house = ({ style: styleName, x, y, width, height, storeys = 1, door = "south", windowEvery = 3, roof = true, floor, flatten = true, furnish = true, seed, furnishing, rearDepth = 0 }) => {
    checkArea(x, y, width, height, 4);
    const style = styles.styleNamed(styleName);
    const defaults = sets().house;
    const { points, gate } = enclosure(x + 1, y + 1, x + width - 1, y + height - 1, door);
    const placements = [];
    const random = seed === undefined ? undefined : rng(seed);
    for (let level = 0; level < storeys; level++) {
      // The door only on the ground floor; upstairs the wall runs unbroken.
      const plan = styles.planWall(level === 0 ? style : { ...style, gate: null, door: null }, points, {
        closed: true, facing: "out", gates: level === 0 ? [gate] : [], z: level, seed,
      });
      let count = random && windowEvery > 0 ? random(windowEvery) : 0;
      for (const piece of plan.placements) {
        const canWindow = piece.type === 0 && (piece.id === style.wall || style.wallVariants?.includes(piece.id));
        const windowWall = random ? style.windowWall : undefined;
        const window = (style.window || windowWall) && windowEvery > 0 && canWindow && ++count % windowEvery === 0;
        placements.push(window && windowWall ? { ...piece, id: windowWall } : piece);
        // Window frames hang on straight wall pieces; a window wall already includes its opening.
        if (window && !windowWall) placements.push({ id: style.window, x: piece.x, y: piece.y, z: level, type: 4, face: piece.face });
      }
    }
    // Furniture: a corridor from the door stays free, a ladder at its far end climbs to the
    // floor above (the climb handler pairs it with the ladder placed on the same tile there),
    // and the set's pieces go along the walls, in corners and in the middle.
    const furniture = { placed: 0, skipped: [] };
    if (furnish) {
      const [x0, y0, x1, y1] = [x + 1, y + 1, x + width - 2, y + height - 2];
      const midX = Math.floor((x0 + x1 + 1) / 2);
      const midY = Math.floor((y0 + y1 + 1) / 2);
      const inner = { south: [midX, y0], north: [midX, y1], east: [x1, midY], west: [x0, midY] }[door];
      const room = { x0, y0, x1, y1, door, doorX: inner[0], doorY: inner[1], random };
      let front = room;
      let rear;
      if (rearDepth) {
        const vertical = door === "south" || door === "north";
        const rearAtHighEnd = door === "south" || door === "west";
        const low = vertical ? "y0" : "x0";
        const high = vertical ? "y1" : "x1";
        const split = rearAtHighEnd ? room[high] - rearDepth + 1 : room[low] + rearDepth;
        front = { ...room, through: true, ...(rearAtHighEnd ? { [high]: split - 1 } : { [low]: split }) };
        rear = { ...room, ...(rearAtHighEnd ? { [low]: split } : { [high]: split - 1 }) };
        const line = vertical ? [[x0, split], [x1 + 1, split]] : [[split, y0], [split, y1 + 1]];
        const passage = vertical ? [midX, split] : [split, midY];
        for (let level = 0; level < storeys; level++) {
          placements.push(...styles.planWall({ ...style, door: null, gate: null }, line, { gates: [passage], z: level, seed }).placements);
        }
      }
      const sizeOfLoc = (id) => {
        try {
          const definition = core.ObjectDefinition.forId(id);
          return [definition?.getSizeX?.() ?? 1, definition?.getSizeY?.() ?? 1];
        } catch {
          return [1, 1];
        }
      };
      const withSizes = (list) => (list ?? []).map((item) => ({ ...item, size: sizeOfLoc(item.id) }));
      for (let level = 0; level < storeys; level++) {
        const list = furnishing ? withSizes(furnishing(level))
          : storeys === 1 ? [...withSizes(defaults.ground), ...withSizes(defaults.single)]
          : level === 0 ? withSizes(defaults.ground) : withSizes(defaults.upstairs);
        const ladder = storeys > 1 ? (level === 0 ? defaults.ladderUp : defaults.ladderDown) : undefined;
        const plans = [geometry.furnishPlan({ ...front, ladder }, list)];
        if (rear) plans.push(geometry.furnishPlan(rear, withSizes(furnishing?.(level, true))));
        for (const plan of plans) {
          for (const piece of plan.placed) placements.push({ id: piece.id, x: piece.x, y: piece.y, z: level, type: 10, face: piece.face });
          furniture.placed += plan.placed.length;
          furniture.skipped.push(...plan.skipped.map((item) => ({ ...item, level })));
        }
      }
    }
    const roofId = style.roof;
    if (roof && roofId) {
      for (const piece of geometry.hipRoof(x, y, width, height, { plane: storeys })) {
        if (piece.z <= 3) placements.push({ id: piece.type >= 18 ? style.roofEaves ?? roofId : roofId, ...piece });
      }
    }
    // Floors and flags as Varrock's houses have them: indoor tiles carry the floor and the
    // indoor flag on every storey (the roof hides when a player is under it), the roof plane
    // the roof flag over the whole footprint.
    const level = flatten ? levelled(x, y, x + width - 1, y + height - 1) : null;
    const edits = [...(level?.edits ?? [])];
    const floorId = floor ?? defaults.floor;
    for (let level = 0; level < storeys; level++) {
      for (let tx = x + 1; tx <= x + width - 2; tx++) {
        for (let ty = y + 1; ty <= y + height - 2; ty++) {
          edits.push({ kind: "terrain", tileX: tx, tileY: ty, plane: level, locId: floorId, shape: 0, rotation: 0 });
          edits.push({ kind: "flag", tileX: tx, tileY: ty, plane: level, locId: defaults.indoorFlag });
        }
      }
    }
    if (roof && roofId && storeys <= 3) {
      for (let tx = x; tx < x + width; tx++) {
        for (let ty = y; ty < y + height; ty++) edits.push({ kind: "flag", tileX: tx, tileY: ty, plane: storeys, locId: defaults.roofFlag });
      }
    }
    // An upper plane's stored height is its gap above the plane below, in eighths of a model
    // unit; left unset the client uses 240. Varrock's house stores its wall height for each
    // storey (37: walls 293 tall) and a slope's rise for each roof ring above (12: slopes 96),
    // so storeys stand on the walls and roof rings on each other. Corners are heights too, so
    // the row and column beyond the footprint get them as well.
    const wallGap = Math.round((sizeOf(style.wall, 0)?.height ?? 296) / 8);
    const roofGap = (random || style.roofEaves ? style.roofRise : undefined) ?? Math.round(((roofId && sizeOf(roofId, 12)?.height) || 96) / 8);
    const lastPlane = roof && roofId ? 3 : storeys;
    for (let level = 1; level <= lastPlane; level++) {
      const gap = level <= storeys ? wallGap : roofGap;
      for (let tx = x; tx <= x + width; tx++) {
        for (let ty = y; ty <= y + height; ty++) edits.push({ kind: "height", tileX: tx, tileY: ty, plane: level, locId: gap });
      }
    }
    return { placements, edits: edits, summary: {
      label: `house ${styleName}`, style: styleName, bounds: { x1: x, y1: y, x2: x + width - 1, y2: y + height - 1 },
      storeys, roof: roof && Boolean(roofId), windows: placements.filter((p) => p.type === 4).length,
      furniture: furniture.placed, ...(furniture.skipped.length > 0 ? { furnitureSkipped: furniture.skipped } : {}),
      ...(level ? { flatten: level.report } : {}),
    } };
  };

  const graveyard = ({ style: styleName, x, y, width, height, gate = "south", spacing = 2, flatten = false }) => {
    checkArea(x, y, width, height, 6);
    const style = styles.styleNamed(styleName);
    const set = sets().graveyard;
    const { points, gate: gateCorner } = enclosure(x, y, x + width, y + height, gate);
    const placements = [...styles.planWall(style, points, { closed: true, facing: "in", gates: [gateCorner] }).placements];
    // The path runs from the gate across the yard; stones stand in rows either side of it.
    const alongY = gate === "south" || gate === "north";
    const midX = x + Math.floor(width / 2);
    const midY = y + Math.floor(height / 2);
    const onPath = (tx, ty) => (alongY ? tx === midX : ty === midY);
    const level = flatten ? levelled(x, y, x + width - 1, y + height - 1) : null;
    const edits = [...(level?.edits ?? [])];
    for (let tx = x; tx < x + width; tx++) {
      for (let ty = y; ty < y + height; ty++) {
        if (onPath(tx, ty)) {
          if (set.path) edits.push({ kind: "terrain", tileX: tx, tileY: ty, plane: 0, locId: set.path, shape: 0, rotation: 0 });
          continue;
        }
        const inner = tx > x && tx < x + width - 1 && ty > y && ty < y + height - 1;
        if (!inner || (tx - x) % spacing !== 1 || (ty - y) % spacing !== 1) continue;
        // Stones face the path.
        const face = alongY ? (tx < midX ? 2 : 0) : (ty < midY ? 1 : 3);
        placements.push({ id: pick(set.stones, tx * 31 + ty), x: tx, y: ty, z: 0, type: 10, face });
      }
    }
    const far = { south: [midX, y + height - 1], north: [midX, y], east: [x, midY], west: [x + width - 1, midY] }[gate];
    if (set.tombstone) placements.push({ id: set.tombstone, x: far[0], y: far[1], z: 0, type: 10, face: 0 });
    const trees = set.trees ?? [];
    if (trees.length > 0) {
      placements.push({ id: trees[0], x, y: y + height - 1, z: 0, type: 10, face: 0 });
      placements.push({ id: trees[trees.length - 1], x: x + width - 1, y, z: 0, type: 10, face: 1 });
    }
    return { placements, edits: edits, summary: {
      label: `graveyard ${styleName}`, style: styleName, bounds: { x1: x - 1, y1: y - 1, x2: x + width, y2: y + height },
      stones: placements.filter((p) => set.stones.includes(p.id)).length,
      ...(level ? { flatten: level.report } : {}),
    } };
  };

  const farm = ({ style: styleName, x, y, width, height, gate = "south", crop = "wheat", flatten = false }) => {
    checkArea(x, y, width, height, 5);
    const style = styles.styleNamed(styleName);
    const set = sets().farm;
    const cropId = typeof crop === "number" ? crop : set.crops[crop];
    if (cropId === undefined) throw new Error(`Unknown crop "${crop}"; known: ${Object.keys(set.crops).join(", ")}`);
    const { points, gate: gateCorner } = enclosure(x, y, x + width, y + height, gate);
    const placements = [...styles.planWall(style, points, { closed: true, facing: "in", gates: [gateCorner] }).placements];
    const alongY = gate === "south" || gate === "north";
    const midX = x + Math.floor(width / 2);
    const midY = y + Math.floor(height / 2);
    for (let tx = x; tx < x + width; tx++) {
      for (let ty = y; ty < y + height; ty++) {
        // Rows run away from the gate; every third one is a walkway, and the middle stays clear.
        const row = alongY ? tx - x : ty - y;
        if (row % 3 === 2) continue;
        if ((alongY ? tx === midX : ty === midY)) continue;
        placements.push({ id: cropId, x: tx, y: ty, z: 0, type: 10, face: 0 });
      }
    }
    if (set.scarecrow) placements.push({ id: set.scarecrow, x: midX, y: midY, z: 0, type: 10, face: 0 });
    const hay = set.hay ?? [];
    if (hay.length > 0) {
      const near = { south: [x, y], north: [x, y + height - 1], east: [x + width - 1, y], west: [x, y] }[gate];
      placements.push({ id: hay[0], x: near[0], y: near[1], z: 0, type: 10, face: 0 });
    }
    const level = flatten ? levelled(x, y, x + width - 1, y + height - 1) : null;
    return { placements, edits: level?.edits ?? [], summary: {
      label: `farm ${styleName}`, style: styleName, crop: cropId,
      bounds: { x1: x - 1, y1: y - 1, x2: x + width, y2: y + height },
      ...(level ? { flatten: level.report } : {}),
    } };
  };

  const plans = { house, graveyard, farm };
  return { ...plans, structure: createStructurePlanner(core, plans, styles, terrain) };
}

module.exports = function registerEditGeneratorTools(ctx, { build, terrain, styles }) {
  const { tool, z } = ctx;
  const plans = createGeneratorPlans(ctx.core, terrain, styles);

  const finish = (placements, edits, summary, dryRun, includePlan = false) => {
    if (dryRun) return {
      dryRun: true, ...summary, placements: placements.length, terrainEdits: edits.length,
      ...(includePlan ? { preview: { placements, edits } } : {}),
    };
    const validated = build.validatePlacements?.(placements);
    const terrainResult = edits.length > 0 ? terrain.applyEdits(edits, summary.label) : null;
    const placed = build.applyPlacements(placements, validated);
    return {
      ...summary, ...placed,
      regions: terrainResult?.regions.map((region) => ({ regionId: region.regionId, terrainBytes: region.terrainBytes })) ?? [],
    };
  };

  const area = { x: z.number().int().describe("Low-corner tile x"), y: z.number().int().describe("Low-corner tile y") };

  tool(
    "list_structure_recipes",
    "List the structure generators shared by the map editor, including size ranges, default styles, and interior and exterior choices.",
    {},
    () => ({ generators: RECIPES, interiors: INTERIORS, exteriors: EXTERIORS }),
  );

  tool(
    "build_structure",
    "Plan a seeded house, smithy, shop, bank, chapel, tavern, guild, ruin, or town. Use list_structure_recipes and list_styles for choices. The same options generate the same plan in the map editor. Preview by default; pass dryRun:false to apply. includePlan includes the placements and terrain in a dry run.",
    {
      name: z.enum(RECIPES.map((recipe) => recipe.name)),
      ...area,
      width: z.number().int().min(4).max(48).optional(),
      height: z.number().int().min(4).max(48).optional(),
      style: z.string().optional(),
      seed: z.number().int().min(0).max(MAX_SEED).optional(),
      entrance: z.enum(SIDES).optional(),
      storeys: z.number().int().min(1).max(2).optional(),
      crop: z.enum(["wheat", "cabbage", "potato"]).optional(),
      interior: z.enum(INTERIORS.map((choice) => choice.name)).optional(),
      exterior: z.enum(EXTERIORS.map((choice) => choice.name)).optional(),
      flatten: z.boolean().optional(),
      dryRun: z.boolean().default(true),
      includePlan: z.boolean().default(false),
    },
    (input) => {
      const { placements, edits, summary } = plans.structure(input);
      return finish(placements, edits, summary, input.dryRun ?? true, input.includePlan);
    },
  );

  tool(
    "build_house",
    "Build a house in a captured style (capture_style; it needs wall, and uses door, window, roof): walls on the ring of tiles round the inside, a door in the middle of one side, window frames every few tiles, a wooden floor indoors on each storey, and a hip roof over the whole footprint (eaves, slopes, flat ridge, as Varrock's houses are built). (x, y) is the low corner of the footprint, walls included; width and height are 4 or more. One or two storeys, furnished (furnish, default on: a corridor from the door, a ladder between storeys that climbs, furniture along the walls); the roof hides when a player walks inside. flatten (default on) levels the footprint first and blends its edge, so walls stand even on uneven ground.",
    {
      style: z.string().describe("Style name from list_styles"),
      ...area,
      width: z.number().int().min(4).max(20),
      height: z.number().int().min(4).max(20),
      storeys: z.number().int().min(1).max(2).default(1),
      door: z.enum(SIDES).default("south"),
      windowEvery: z.number().int().min(0).max(10).default(3).describe("A window frame every n wall pieces; 0 for none"),
      roof: z.boolean().default(true),
      floor: z.number().int().min(1).optional().describe("Floor overlay id (default from edit-sets.json)"),
      flatten: z.boolean().default(true).describe("Level the footprint first and blend its edge, so walls stand even"),
      furnish: z.boolean().default(true).describe("Furniture from edit-sets.json, and a ladder between storeys"),
      dryRun: z.boolean().default(false),
    },
    (input) => {
      const { placements, edits, summary } = plans.house(input);
      return finish(placements, edits, summary, input.dryRun ?? false);
    }
  );

  tool(
    "build_graveyard",
    "Build a graveyard: an enclosure in a captured style (a fence or a wall) with a gate, a path from the gate up the middle, rows of gravestones either side of it, a tombstone at the far end and dead trees in two corners. (x, y) is the low corner inside the enclosure; width and height 6 or more. Decoration ids come from edit-sets.json (graveyard).",
    {
      style: z.string().describe("Style for the enclosure, e.g. lumbridge-fence"),
      ...area,
      width: z.number().int().min(6).max(40),
      height: z.number().int().min(6).max(40),
      gate: z.enum(SIDES).default("south"),
      spacing: z.number().int().min(2).max(4).default(2).describe("Tiles between gravestones"),
      flatten: z.boolean().default(false).describe("Level the yard first (fences on a slope look natural, so off by default)"),
      dryRun: z.boolean().default(false),
    },
    (input) => {
      const { placements, edits, summary } = plans.graveyard(input);
      return finish(placements, edits, summary, input.dryRun ?? false);
    }
  );

  tool(
    "build_farm",
    "Build a farm field: an enclosure in a captured style (a fence) with a gate, crops planted in rows with a walkway every third row, a scarecrow in the middle and hay bales by the gate. (x, y) is the low corner inside the fence; width and height 5 or more. crop is a name from edit-sets.json (farm.crops: wheat, cabbage, potato) or a loc id.",
    {
      style: z.string().describe("Style for the fence, e.g. lumbridge-fence"),
      ...area,
      width: z.number().int().min(5).max(40),
      height: z.number().int().min(5).max(40),
      gate: z.enum(SIDES).default("south"),
      crop: z.union([z.string(), z.number().int().min(0)]).default("wheat"),
      flatten: z.boolean().default(false).describe("Level the field first (off by default: fields follow the land)"),
      dryRun: z.boolean().default(false),
    },
    (input) => {
      const { placements, edits, summary } = plans.farm(input);
      return finish(placements, edits, summary, input.dryRun ?? false);
    }
  );
};

module.exports.createGeneratorPlans = createGeneratorPlans;
