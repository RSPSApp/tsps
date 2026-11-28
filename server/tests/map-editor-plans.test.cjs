const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { catalog, preview } = require("../plugins/world/MapPlans");
const { normalizeSource, normalizeWarp, updateWarps, warpAt, warpMenuActions, warpArrival } = require("../plugins/world/MapWarps");
const { z } = require("zod");
const registerLandscapeTools = require("../plugins/agent/mcp/EditLandscape.AgentMcp");
const { planLandscape, findEmptySite, buildPacks, overview } = require("../plugins/world/LandscapePlans");

test("editor exposes the agent's construction presets and previews editable area data", () => {
  const core = { ObjectDefinition: { forId: () => ({ getSizeX: () => 1, getSizeY: () => 1 }) } };
  assert.ok(catalog().styles.some(({ name, roof }) => name === "varrock-house" && roof));
  const house = preview(core, new URLSearchParams("name=furnished-house&style=varrock-house&storeys=2&width=8&height=8"));
  assert.ok(house.objects.some((loc) => loc.z === 1));
  assert.ok(house.tiles.some((tile) => tile.z === 1 && tile.overlay));
  assert.ok(house.tiles.some((tile) => tile.z === 2 && tile.height));
  assert.equal(house.foundation, true);
  assert.ok(house.tiles.some((tile) => tile.height && tile.dx === house.width && tile.dy === house.height));
  assert.ok(preview(core, new URLSearchParams("name=gatehouse")).objects.length > 0);
  assert.throws(() => preview(core, new URLSearchParams("name=farm&width=1000")), /width/);
  assert.throws(() => preview(core, new URLSearchParams("name=unknown")), /Unknown/);
});

test("diagonal wall plans use the cache style's joint pieces without closing openings", () => {
  const { styleNamed, planWall } = require("../plugins/agent/mcp/EditStyles.AgentMcp");
  const falador = styleNamed("falador-white");
  const points = [[3200, 3200], [3203, 3203], [3204, 3203]];
  const result = planWall(falador, points, { side: "right", gates: [[3200, 3200]] });
  assert.deepEqual(result.openings, [{ x: 3200, y: 3200, type: 9, face: 0 }]);
  assert.deepEqual(result.placements.filter(({ type }) => type === 1), [
    { id: 24175, x: 3202, y: 3201, z: 0, type: 1, face: 0 },
  ]);
  const transition = planWall(falador, points, { side: "left" });
  assert.ok(transition.placements.some(({ type, face, x, y }) => type === 1 && face === 2 && x === 3202 && y === 3203),
    "a straight wall and the adjacent diagonal share a joint on the diagonal's thick side");

  const timber = styleNamed("barbarian-timber");
  assert.equal(catalog().styles.find(({ name }) => name === "barbarian-timber").diagonalJoin, null);
  assert.deepEqual(planWall(timber, [[3200, 3200], [3202, 3202]]).placements, [
    { id: 11558, x: 3200, y: 3200, z: 0, type: 9, face: 2 },
    { id: 11558, x: 3201, y: 3201, z: 0, type: 9, face: 2 },
  ]);
});

test("landscape previews are seeded and creation installs all packs or rolls them back", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "landscape-packs-"));
  const previous = process.env.AGENT_MCP_REGIONS_DIR;
  process.env.AGENT_MCP_REGIONS_DIR = directory;
  const replacements = new Map(), collision = new Set(), tools = new Map();
  let refuseCollision = true;
  const core = {
    CacheMaps: { getRegion: () => null, getArchiveIds: () => null },
    CachePipeline: { getActive: () => ({ revision: 242 }) },
    MapRegionReplacementManager: {
      getReplacementMapData: (id) => replacements.get(id),
      replaceMapRegionData: (id, terrain, objects) => replacements.set(id, { terrain, objects }),
      removeMapRegion: (id) => replacements.delete(id),
    },
    RegionManager: {
      registerReplacementRegion: (id) => collision.add(id),
      reloadRegion: () => !refuseCollision || collision.size < 2,
      unregisterEmptyReplacementRegion: (id) => collision.delete(id),
    },
  };
  registerLandscapeTools({ core, tool: (name, _description, _schema, run) => tools.set(name, run), z });
  const generate = tools.get("generate_landscape");
  const options = { x: 4096, y: 4096, landform: "river", biome: "forest", width: 90, height: 64, seed: 91 };
  try {
    const firstSite = findEmptySite(core, options);
    const draftSquare = ((firstSite.x >> 6) << 8) | (firstSite.y >> 6);
    assert.notDeepEqual(findEmptySite(core, options, new Set([draftSquare])), firstSite);
    const overview = generate(options);
    assert.equal(overview.regions.length, 2);
    assert.ok(overview.high > overview.low);
    assert.deepEqual(generate(options), overview);
    assert.notEqual(generate({ ...options, seed: 92 }).preview.pixels, overview.preview.pixels);
    assert.equal(fs.readdirSync(directory).length, 0);
    assert.throws(() => generate({ ...options, dryRun: false }), /load clipping/);
    assert.equal(replacements.size, 0);
    assert.equal(collision.size, 0);
    assert.equal(fs.readdirSync(directory).length, 0);
    refuseCollision = false;
    const created = generate({ ...options, dryRun: false });
    assert.equal(created.files.length, 2);
    for (const id of created.regions) {
      const pack = fs.readFileSync(path.join(directory, `${id}.pack`));
      assert.equal(pack.readInt32BE(4), -1, "new squares have no cache object archive");
      assert.equal(pack.readInt32BE(8), -1, "new squares have no cache terrain archive");
      assert.equal(pack.readInt32BE(12), id >> 8);
      assert.equal(pack.readInt32BE(16), id & 255);
      assert.equal(pack.readInt32BE(25), replacements.get(id).terrain.length);
    }
    assert.deepEqual(generate(options).occupied, created.regions);
    assert.throws(() => generate({ ...options, dryRun: false }), /Already used/);
  } finally {
    if (previous === undefined) delete process.env.AGENT_MCP_REGIONS_DIR;
    else process.env.AGENT_MCP_REGIONS_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("wetlands and tropical shores use shaped banks and a coherent water level", () => {
  const core = {
    CacheMaps: { getRegion: () => null },
    CachePipeline: { getActive: () => ({ revision: 242 }) },
    CacheDefinitions: { getObject: (id) => ({ name: id === 684 || id === 735 ? "Swamp bubbles" : "null", models: [1] }) },
  };
  for (const [landform, biome] of [["wetlands", "swamp"], ["island", "tropical"]]) {
    const map = planLandscape(core, { x: 4096, y: 4096, width: 128, height: 128, landform, biome, seed: 41 });
    const heights = new Set();
    let water = 0, banks = 0;
    for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) {
      const at = map.tileAt(map.x + x, map.y + y);
      if (!at.water) continue;
      water++;
      if (at.shape) banks++;
      else heights.add(at.elevation);
    }
    assert.ok(water > map.width * map.height * 0.08, `${landform} has enough water to read in the scene`);
    assert.ok(banks > 25, `${landform} needs shaped banks rather than square masks`);
    assert.deepEqual([...heights].sort((a, b) => a - b), landform === "wetlands" ? [0, 10] : [0],
      `${landform} uses the native water elevations`);
    if (biome !== "swamp") continue;
    let bubbles = 0;
    for (const [region, locs] of map.locs) for (const [id, packed] of locs) {
      if (id !== 684 && id !== 735) continue;
      const tile = map.tileAt((region >> 8) * 64 + (packed >> 6), (region & 255) * 64 + (packed & 63));
      assert.equal(tile.wetMask, 15, "swamp bubbles are on fully flooded tiles");
      assert.equal(tile.overlay, 6);
      bubbles++;
    }
    assert.ok(bubbles > 0);
  }
});

test("the shared forest planner uses materials and native scenery from the existing terrain capture", () => {
  const forest = require(require("../plugins/world/EditorGeneration").editorGenerationPath("landscapes/data/terrain-biomes/forest.json"));
  const { editorGenerationPath } = require("../plugins/world/EditorGeneration");
  const { normalizeTerrainBiome } = require(editorGenerationPath("landscapes/TerrainBiome"));
  const loaded = require("../plugins/world/procedural/TerrainBiomeUtil.ProceduralRegionStream").loadTerrainBiome("forest");
  for (const [key, value] of Object.entries(normalizeTerrainBiome(forest))) {
    assert.deepEqual(loaded[key], value, `server and browser share captured ${key}`);
  }
  assert.equal(loaded.inputPath, editorGenerationPath("landscapes/data/terrain-biomes/forest.json"));
  const tree = forest.ids.treeIds[0];
  const groundCover = forest.ids.groundDecorationIds[0];
  const core = {
    CacheMaps: { getRegion: () => null },
    CachePipeline: { getActive: () => ({ revision: 242 }) },
    CacheDefinitions: { getObject: (id) => id === tree ? { models: [1], types: [10], name: "Tree", actions: ["Chop down"] }
      : id === groundCover ? { models: [2], types: [22], name: "null" } : undefined },
  };
  const map = planLandscape(core, { x: 3200, y: 3200, biome: "forest", seed: 91 });
  const placed = new Set([...map.locs.values()].flat().map(([id]) => id));
  assert.deepEqual(placed, new Set([tree, groundCover]));
  assert.ok(forest.ids.underlayIds.includes(map.tileAt(3201, 3201).underlay));
});

test("a river crosses the shared edges of a sideways L footprint", () => {
  const base = (50 << 8) | 50;
  const core = { CacheMaps: { getRegion: () => null }, CachePipeline: { getActive: () => ({ revision: 242 }) } };
  const first = [base, base + 256, base + 512, base + 513];
  const plan = planLandscape(core, { squares: first, landform: "river", seed: 12, scenery: false });
  const flowAt = (x, y, stepX, stepY) => Array.from({ length: 64 }, (_, i) =>
    plan.tileAt(x + stepX * i, y + stepY * i).wetMask === 15).filter(Boolean).length;
  assert.ok(flowAt(51 * 64, 50 * 64, 0, 1) > 8, "the first horizontal join carries the channel");
  assert.ok(flowAt(52 * 64, 50 * 64, 0, 1) > 8, "the river continues along the horizontal leg");
  assert.ok(flowAt(52 * 64, 51 * 64, 1, 0) > 8, "the channel turns into the vertical leg");
});

test("an extension follows a custom footprint and samples the existing terrain edge", () => {
  const sourceId = (50 << 8) | 50;
  const bottom = (51 << 8) | 50;
  const x = 51 * 64, y = 50 * 64;
  const ground = Buffer.alloc(4096 * 5);
  for (let tile = 0; tile < 4096; tile++) {
    ground.writeUInt16BE(81 + 67, tile * 5);
    ground.writeUInt16BE(1, tile * 5 + 2);
    ground[tile * 5 + 4] = 68 + (tile & 3);
  }
  const tree = 998;
  const objects = Buffer.from([0x83, 0xe7, 0x8f, 0xc1, 10 << 2, 0, 0]);
  const core = {
    CacheMaps: { getRegion: () => null },
    CachePipeline: { getActive: () => ({ revision: 242 }) },
    CacheDefinitions: { getObject: (id) => id === tree ? { name: "Oak tree", types: [10], models: [1], actions: ["Chop down"] } : undefined },
    MapRegionReplacementManager: { getReplacementMapData: (id) => id === sourceId ? { terrainData: ground, objectData: objects } : undefined },
  };
  const options = { x, y, width: 128, height: 128, squares: [bottom, bottom + 1, bottom + 257], extend: true, biome: "auto", seed: 51 };
  const plan = planLandscape(core, { ...options, x: undefined, y: undefined, width: undefined, height: undefined });
  assert.deepEqual(plan.sourceRegions, [sourceId]);
  assert.equal(plan.tileAt(x, y + 9).elevation, 69, "the shared vertex matches the adjacent land");
  assert.equal(plan.tileAt(x, y + 9).underlay, 67);
  const materials = Array.from({ length: 56 }, (_, i) => plan.tileAt(x + 15, y + i).underlay);
  assert.ok(materials.some((id) => id === 67) && materials.some((id) => id !== 67),
    "the ground transition mixes source and generated materials before the end of the blend");
  assert.ok([...plan.locs.values()].flat().some(([id]) => id === tree), "natural objects near the seam are available to scatter");
  assert.deepEqual(buildPacks(core, plan).map(({ regionId }) => regionId), options.squares);
  assert.ok(Buffer.from(overview(plan).preview.pixels, "base64").some((_, i, bytes) => i % 3 === 0 && bytes[i] === 255));
  assert.throws(() => planLandscape(core, { ...options, squares: [bottom, bottom + 257] }), /edges/);
  assert.throws(() => planLandscape(core, { ...options, x: 52 * 64, squares: [bottom + 256] }), /next to terrain/);
  assert.equal(planLandscape(core, { ...options, foliage: 0 }).sceneryCount, 0);
  const lake = planLandscape(core, { ...options, extend: false, biome: "forest", lakes: 4 });
  const base = planLandscape(core, { ...options, extend: false, biome: "forest", lakes: 0 });
  assert.notEqual(overview(lake).preview.pixels, overview(base).preview.pixels);
  assert.deepEqual(overview(lake), overview(planLandscape(core, { ...options, extend: false, biome: "forest", lakes: 4 })));
});

test("custom travel links are keyed by exact placement and restore vanilla behavior when removed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-warp-test-"));
  const original = process.env.AGENT_MCP_MAP_WARPS_FILE;
  process.env.AGENT_MCP_MAP_WARPS_FILE = path.join(directory, "map-warps.json");
  try {
    const warp = normalizeWarp({
      id: 2, op: 1, from: [3200, 3200, 0], destinations: [
        { label: " Upstairs  ", to: [3200, 3200, 1] },
        { label: "Downstairs", to: [3200, 9600, 0] },
      ],
    });
    updateWarps([warp]);
    assert.deepEqual(JSON.parse(fs.readFileSync(process.env.AGENT_MCP_MAP_WARPS_FILE, "utf8")), [warp]);
    assert.equal(warpAt(2, 1, [3200, 3200, 0]).destinations[0].label, "Upstairs");
    assert.equal(warpAt(3, 1, [3200, 3200, 0]), undefined, "a different object on the tile keeps its own action");
    updateWarps([normalizeSource(warp)], true);
    assert.equal(warpAt(2, 1, warp.from), undefined);
    assert.deepEqual(fs.readdirSync(directory), ["map-warps.json"]);
  } finally {
    if (original === undefined) delete process.env.AGENT_MCP_MAP_WARPS_FILE;
    else process.env.AGENT_MCP_MAP_WARPS_FILE = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("MCP adds actions to scenery with empty slots and keeps both ends of a return link in sync", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "map-warp-pair-"));
  const original = process.env.AGENT_MCP_MAP_WARPS_FILE;
  process.env.AGENT_MCP_MAP_WARPS_FILE = path.join(directory, "map-warps.json");
  const tools = new Map();
  const core = { ObjectDefinition: { forId: () => ({ getInteractions: () => [] }) } };
  let refreshed = 0;
  require("../plugins/agent/mcp/EditWarps.AgentMcp")({
    core, z, tool: (name, _description, _schema, run) => tools.set(name, run),
  }, () => { refreshed++; });
  const set = tools.get("set_map_warp");
  const source = { id: 50, op: 1, from: [3200, 3200, 0] };
  const back = { id: 51, op: 1, from: [3210, 9600, 0] };
  const another = { id: 51, op: 2, from: back.from };
  const destinations = [{ label: "Basement", to: [3210, 9601, 0], beside: { id: back.id, at: back.from } }];
  try {
    assert.throws(() => set({ ...source, destinations }), /Name the new option/);
    assert.throws(() => set({ ...source, actionLabel: "<img>", destinations }), /plain text label/);
    const created = set({ ...source, actionLabel: " Climb down ", destinations,
      returnFrom: { ...back, actionLabel: "Climb up" } });
    assert.deepEqual(created.warps[0].returnLink, back);
    assert.deepEqual(created.warps[1].returnLink, source);
    assert.deepEqual(warpMenuActions(), [
      { ...source, actionLabel: "Climb down" }, { ...back, actionLabel: "Climb up" },
    ]);
    set({ ...source, destinations });
    set({ ...another, actionLabel: "Go outside", destinations: [{ label: "Courtyard", to: [3199, 3200, 0] }] });
    assert.equal(warpAt(back.id, back.op, back.from).actionLabel, "Climb up");
    set({ ...source, destinations, returnFrom: null });
    assert.equal(warpAt(back.id, back.op, back.from), undefined);
    assert.equal(warpAt(another.id, another.op, another.from).actionLabel, "Go outside");
    set({ ...source, destinations, returnFrom: back });
    tools.get("remove_map_warp")(back);
    assert.equal(warpAt(source.id, source.op, source.from), undefined);
    assert.equal(warpAt(another.id, another.op, another.from).actionLabel, "Go outside");
    assert.equal(refreshed, 6);
    tools.get("remove_map_warp")(another);
  } finally {
    if (original === undefined) delete process.env.AGENT_MCP_MAP_WARPS_FILE;
    else process.env.AGENT_MCP_MAP_WARPS_FILE = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("object arrivals use the placed rotation and avoid blocked tiles and the source", () => {
  const destination = { to: [3200, 3202, 0], beside: { id: 51, at: [3200, 3200, 0] } };
  const blocked = new Set(["3200,3202"]);
  const core = {
    Location: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
    MapObjects: { get: () => ({ getType: () => 10, getFace: () => 1 }) },
    ObjectDefinition: { forId: () => ({ getSizeX: () => 2, getSizeY: () => 1 }) },
    RegionManager: { blocked: ({ x, y }) => blocked.has(`${x},${y}`) },
  };
  assert.deepEqual(warpArrival(core, destination), [3199, 3201, 0]);
  assert.deepEqual(warpArrival(core, destination, [3199, 3201, 0]), [3201, 3201, 0]);
  assert.equal(warpArrival({ ...core, MapObjects: { get: () => null } }, destination), null);
  const settings = new Uint8Array(16384);
  settings[4096] = settings[4097] = 2;
  const bridge = {
    ...core,
    getTemplateRegion: () => ({ settings }),
    MapObjects: { get: (id, { z }) => z === 0 ? { getType: () => 10, getFace: () => 0 } : null },
  };
  assert.deepEqual(warpArrival(bridge, { ...destination, beside: { id: 51, at: [3200, 3200, 1] } }), [3200, 3201, 0]);
});

test("seeded structure recipes share their layouts, styles and objects across editor and MCP previews", () => {
  const registerGenerators = require("../plugins/agent/mcp/EditGenerators.AgentMcp");
  const { styleNamed, planWall } = require("../plugins/agent/mcp/EditStyles.AgentMcp");
  const { sizeOf } = require("../plugins/agent/mcp/EditSizes.AgentMcp");
  const furnitureSizes = new Map([[24009, [2, 3]], [7183, [1, 2]], [2307, [2, 2]]]);
  const tools = new Map();
  const core = { ObjectDefinition: { forId: (id) => ({
    getSizeX: () => furnitureSizes.get(id)?.[0] ?? 1,
    getSizeY: () => furnitureSizes.get(id)?.[1] ?? 1,
  }) } };
  registerGenerators({ core, z, tool: (name, _description, _schema, run) => tools.set(name, run) }, {
    build: { applyPlacements: () => assert.fail("A preview must leave the world alone") },
    styles: { styleNamed, planWall },
    terrain: null,
  });
  const recipes = tools.get("list_structure_recipes")().generators;
  assert.deepEqual(recipes, catalog().generators);
  for (const name of ["furnished-house", "crafting-guild", "crossroads-village", "swamp-hamlet", "ruins"]) {
    const input = { name, x: 4096, y: 4096, seed: 91, entrance: "east", flatten: false, includePlan: true };
    const query = new URLSearchParams(input);
    const editor = preview(core, query);
    const mcp = tools.get("build_structure")(input);
    assert.equal(mcp.dryRun, true);
    assert.equal(mcp.placements, editor.objects.length);
    assert.deepEqual(editor.objects.map(({ dx, dy, ...loc }) => ({ ...loc, x: dx + editor.source.x, y: dy + editor.source.y })),
      mcp.preview.placements);
    assert.deepEqual(preview(core, query), editor);
    query.set("seed", "92");
    assert.notDeepEqual(preview(core, query).objects, editor.objects);
    for (const object of editor.objects) assert.ok(sizeOf(object.id, object.type), `Loc ${object.id} shape ${object.type}`);
    for (const tile of editor.tiles) {
      const verticesOnly = tile.height !== undefined && tile.overlay === undefined && tile.flag === undefined;
      assert.ok(tile.dx >= 0 && tile.dx < editor.width + Number(verticesOnly));
      assert.ok(tile.dy >= 0 && tile.dy < editor.height + Number(verticesOnly));
    }
  }
  assert.throws(() => preview(core, new URLSearchParams("name=ruins&style=varrock-house")), /ruins style/);
});

test("structure seeds vary floor plans and keep themed furniture indoors", () => {
  const { footprint } = require("../plugins/agent/mcp/EditGeometry.AgentMcp");
  const sizes = new Map([[7183, [1, 2]], [11626, [2, 1]], [595, [2, 1]], [7175, [2, 1]], [25930, [2, 1]], [835, [1, 2]]]);
  const core = { ObjectDefinition: { forId: (id) => ({
    getSizeX: () => sizes.get(id)?.[0] ?? 1, getSizeY: () => sizes.get(id)?.[1] ?? 1,
  }) } };
  const interiors = new Set([1106, 724, 11606, 11626, 7183, 835, 817, 818, 819, 820]);
  for (const [name, width, height] of [["tavern", 12, 12], ["warriors-guild", 24, 22]]) {
    const layouts = new Set();
    for (const entrance of ["south", "west", "north", "east"]) {
      for (let seed = 0; seed < 6; seed++) {
        const plan = preview(core, new URLSearchParams({ name, width, height, seed, style: "warriors-stone", entrance }));
        assert.equal(plan.width, width);
        assert.equal(plan.height, height);
        const floor = new Set(plan.tiles.filter(({ flag, z }) => flag === 4 && z === 0).map(({ dx, dy }) => `${dx},${dy}`));
        if (entrance === "south") layouts.add([...floor].sort().join(";"));
        const walls = plan.objects.filter(({ type }) => type === 0);
        const roofs = plan.objects.filter(({ type }) => type >= 12 && type <= 21);
        assert.ok(walls.some(({ id }) => id === 23949));
        assert.ok(walls.every(({ id }) => id === 23949 || id === 1535), "the selected style supplies all walls and doors");
        assert.ok(roofs.length && roofs.every(({ id }) => id === 1924 || id === 1790), "the selected style also supplies the roof");
        assert.ok(plan.tiles.filter(({ flag }) => flag === 4).every(({ overlay }) => overlay.id === 11));
        for (const loc of plan.objects.filter(({ z }) => z === 0)) {
          assert.notEqual(loc.id, 3474, "guild wall fixtures must not stand in for windows");
          if (loc.type !== 10 || !interiors.has(loc.id)) continue;
          const dims = footprint(loc.type, loc.face, ...(sizes.get(loc.id) ?? [1, 1]));
          for (let dx = 0; dx < dims.width; dx++) for (let dy = 0; dy < dims.height; dy++) {
            assert.ok(floor.has(`${loc.dx + dx},${loc.dy + dy}`), `interior loc ${loc.id} is outdoors`);
          }
        }
      }
    }
    assert.ok(layouts.size >= 3, `${name} only made ${layouts.size} floor plans`);
  }
});

test("server-only snapshots resolve the editor planners and assets from the generated dist bundle", t => {
  const { prepareEditorGeneration } = require("../scripts/prepare-editor-generation.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "editor-generation-runtime-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = path.join(directory, "server");
  const destination = path.join(runtime, "dist/editor-generation");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "stale.js"), "throw new Error('stale artifact')");
  prepareEditorGeneration(path.resolve(__dirname, "../../client/game/plugins/editmode/generation"), destination);
  assert.equal(fs.existsSync(path.join(destination, "stale.js")), false, "deleted sources cannot survive in a release");
  assert.equal(fs.existsSync(path.join(destination, "landscapes/LocalLandscape.ts")), false, "browser integration code stays out of the server bundle");
  const resolver = path.join(runtime, "plugins/world/EditorGeneration.js");
  fs.mkdirSync(path.dirname(resolver), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, "../plugins/world/EditorGeneration.js"), resolver);
  const { editorGenerationPath } = require(resolver);
  assert.equal(fs.realpathSync(editorGenerationPath("buildings/MapPlans.js")), fs.realpathSync(path.join(destination, "buildings/MapPlans.js")));
  fs.mkdirSync(path.join(directory, "client/game/plugins/editmode/generation"), { recursive: true });
  assert.equal(fs.realpathSync(editorGenerationPath("buildings/MapPlans.js")), fs.realpathSync(path.join(destination, "buildings/MapPlans.js")),
    "a full source checkout with only server dependencies installed still uses the self-contained runtime bundle");
  const plans = require(editorGenerationPath("buildings/MapPlans.js"));
  assert.ok(plans.preview(new URLSearchParams("name=furnished-house&seed=12"), () => ({ sizeX: 1, sizeY: 1 })).objects.length > 0);
  const landscapeFile = editorGenerationPath("landscapes/LandscapePlans.js");
  assert.ok(fs.readFileSync(landscapeFile, "utf8").includes('require("node:zlib")'), "the snapshot uses its built-in compression codec");
  assert.ok(require(landscapeFile).catalog().biomes.length > 0);
  const templates = path.join(runtime, "plugins/agent/mcp/MapTemplateFiles.js");
  fs.mkdirSync(path.dirname(templates), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, "../plugins/agent/mcp/MapTemplateFiles.js"), templates);
  const previous = process.env.AGENT_MCP_TEMPLATES_DIR;
  delete process.env.AGENT_MCP_TEMPLATES_DIR;
  try {
    const library = require(templates);
    assert.equal(library.readTemplate("varrock-house-a").width, 8);
    assert.equal(library.listTemplates().length, 3);
  } finally {
    if (previous === undefined) delete process.env.AGENT_MCP_TEMPLATES_DIR;
    else process.env.AGENT_MCP_TEMPLATES_DIR = previous;
  }
});
