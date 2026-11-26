const Landscape = require("../../world/LandscapePlans");

module.exports = function registerEditLandscapeTools({ core, tool, z }) {
  tool("list_landscapes", "List landforms, OSRS reference biomes, and size presets for generate_landscape.", {}, Landscape.catalog);
  tool("generate_landscape",
    "Preview or create a landscape in unused map squares. Set extend to blend into adjacent terrain and use nearby scenery. Combine a landform, OSRS reference biome, seed, relief and dimensions. The result includes a north-up shaded map (base64 RGB triplets of palette index, shade, height), elevation range, scenery count and affected region IDs. Defaults to preview. Set dryRun:false to write region packs and load playable terrain with clipping.",
    {
      x: z.number().int().optional().describe("South-west world tile x, omit both coordinates to find empty space"),
      y: z.number().int().optional().describe("South-west world tile y, omit both coordinates to find empty space"),
      landform: z.enum(["hills", "basin", "island", "river", "wetlands", "cavern"]).optional(),
      biome: z.enum(["forest", "desert", "swamp", "tropical", "alpine", "auto"]).optional(),
      size: z.enum(["tiny", "small", "region", "large", "massive"]).optional(),
      width: z.number().int().min(6).max(512).optional().describe("Override size preset width in tiles"),
      height: z.number().int().min(6).max(512).optional().describe("Override size preset depth in tiles"),
      seed: z.number().int().min(0).max(2147483647).optional(),
      relief: z.number().int().min(0).max(200).optional().describe("Percent of the preset's normal height variation"),
      foliage: z.number().int().min(0).max(200).optional().describe("Percent of normal native scenery density"),
      lakes: z.number().int().min(0).max(12).optional().describe("Additional inland lakes, as many as fit"),
      squares: z.array(z.number().int().min(0).max(65535)).min(1).max(64).optional()
        .describe("Exact edge-connected map square IDs. The bounds are inferred when omitted."),
      extend: z.boolean().optional().describe("Blend into existing terrain on the selected squares' shared edges"),
      edgeBlend: z.number().int().min(4).max(48).optional().describe("Depth of edge blending in tiles"),
      scenery: z.boolean().optional().describe("Scatter suitable native scenery, enabled by default"),
      dryRun: z.boolean().default(true),
    },
    ({ dryRun = true, ...options }) => {
      if (options.extend && !options.squares && (options.x === undefined || options.y === undefined)) {
        throw new Error("Supply map square IDs or the south-west x and y for a map extension");
      }
      const origin = !options.squares && options.x === undefined && options.y === undefined ? Landscape.findEmptySite(core, options) : {};
      const plan = Landscape.planLandscape(core, { ...options, ...origin });
      return dryRun ? { ...Landscape.overview(plan), occupied: Landscape.occupiedRegions(core, plan) } : Landscape.createLandscape(core, plan);
    });
};
