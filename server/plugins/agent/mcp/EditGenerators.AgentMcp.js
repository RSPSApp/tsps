const { editorGenerationPath } = require("../../world/EditorGeneration");
const fs = require("fs");
const path = require("path");
const { sizeOf } = require("./EditSizes.AgentMcp");
const { RECIPES, INTERIORS, EXTERIORS, MAX_SEED } = require("./StructureRecipes.AgentMcp");

// Generators: new structures in a captured style, laid out by rules read off real ones.
//
//   build_house     - walls, door, window frames, floors and a hip roof, one or two storeys
//   build_graveyard - an enclosure with rows of gravestones, a path from the gate, dead trees
//   build_farm      - a fenced field planted in rows, with a scarecrow and hay
//
// Wall pieces come from a style (capture_style); decoration ids from
// plugins/agent/data/edit-sets.json, hand-maintained and checked by screenshot. Everything
// goes live and persists through the same paths as place_objects and paint_ground.

const readSets = () => JSON.parse(fs.readFileSync(
  process.env.AGENT_MCP_SETS_FILE ?? editorGenerationPath("buildings/data/edit-sets.json"), "utf8"));
const sharedPlans = require(editorGenerationPath("buildings/Generators"));
const { SIDES } = sharedPlans;
const createGeneratorPlans = (core, terrain, styles) => sharedPlans.createGeneratorPlans(core, terrain, styles, { readSets, sizeOf });

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

module.exports.readSets = readSets;
