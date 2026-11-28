const { editorGenerationPath } = require("./EditorGeneration");
const fs = require("node:fs");
const path = require("node:path");
const { isWorldFile, regionFiles, commitWorldFiles } = require("./MapEditFiles");
const { loadTerrainBiome } = require("./procedural/TerrainBiomeUtil.ProceduralRegionStream");
const planner = require(editorGenerationPath("landscapes/LandscapePlans"));
const withBiomes = (core) => ({ ...core, loadTerrainBiome: (id) => loadTerrainBiome(id, { optional: true }) });
const catalog = planner.catalog;
const normalize = planner.normalize;
const overview = planner.overview;
const sampleBiome = (core, id) => planner.sampleBiome(withBiomes(core), id);
const planLandscape = (core, input) => planner.planLandscape(withBiomes(core), input);
const buildPacks = (core, plan) => planner.buildPacks(core, plan).map(result => ({ ...result,
  pack: Buffer.from(result.pack), terrain: Buffer.from(result.terrain), objects: Buffer.from(result.objects) }));
const occupiedSquareIds = (core) => planner.occupiedSquareIds(core, savedRegionIds());
const occupiedRegions = (core, plan, saved = savedRegionIds()) => planner.occupiedRegions(core, plan, saved);
const findEmptySite = (core, options, skip = new Set()) => planner.findEmptySite(core, options, skip, savedRegionIds());

const regionsDirectory = () => process.env.AGENT_MCP_REGIONS_DIR ?? path.resolve("data/regions");

function savedRegionIds() {
  const directory = regionsDirectory();
  const names = isWorldFile(path.join(directory, "0.pack"))
    ? regionFiles().map(({ name }) => name)
    : fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  return new Set(names.flatMap((name) => {
    const match = /^(\d+)\.(?:pack|terrain\.dat|objects\.dat)$/.exec(name);
    return match ? [Number(match[1])] : [];
  }));
}

function createLandscape(core, plan) {
  const taken = occupiedRegions(core, plan);
  if (taken.length) throw new Error(`Choose empty map squares. Already used: ${taken.join(", ")}`);
  const generated = buildPacks(core, plan);
  const directory = regionsDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const layered = isWorldFile(path.join(directory, "0.pack"));
  const created = [];
  const installed = [];
  const manager = core.MapRegionReplacementManager;
  try {
    for (const { regionId: id, pack } of layered ? [] : generated) {
      const file = path.join(directory, `${id}.pack`);
      const handle = fs.openSync(file, "wx");
      created.push(file);
      try { fs.writeFileSync(handle, pack); } finally { fs.closeSync(handle); }
    }
    for (const { regionId: id, terrain, objects } of generated) {
      manager.replaceMapRegionData(id, terrain, objects, "agent-landscape");
      installed.push(id);
      core.RegionManager.registerReplacementRegion(id);
      if (!core.RegionManager.reloadRegion(id)) throw new Error(`Could not load clipping for map square ${id}`);
    }
    if (layered) commitWorldFiles(new Map(generated.map(({ regionId: id, pack }) => [path.join(directory, `${id}.pack`), pack])));
  } catch (error) {
    for (const id of installed.reverse()) {
      manager.removeMapRegion(id);
      core.RegionManager.unregisterEmptyReplacementRegion(id);
    }
    for (const file of created) fs.unlinkSync(file);
    throw error;
  }
  return { files: generated.map(({ regionId: id }) => `${id}.pack`), ...overview(plan) };
}

module.exports = { catalog, normalize, sampleBiome, planLandscape, overview, buildPacks, occupiedRegions, occupiedSquareIds, findEmptySite, createLandscape };
