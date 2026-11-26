// NPC + terrain edit MCP tools (plugins/agent/mcp/EditNpcs.AgentMcp.js,
// EditTerrain.AgentMcp.js) against fake cores and temp files.
// Run: node --test tests/edit-world-mcp.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const registerEditNpcTools = require("../plugins/agent/mcp/EditNpcs.AgentMcp");
const registerEditTerrainTools = require("../plugins/agent/mcp/EditTerrain.AgentMcp");
const { commitMapEdit, effectiveFile, readLayers } = require("../plugins/world/MapEditFiles");

function envelope(tools, name, handler) {
  tools.set(name, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
    }
  });
}

const NPC_NAMES = { 0: "null", 10: "Guard", 11: "Guard", 20: "Fishing spot" };

function npcTestSetup() {
  const live = [];
  const tools = new Map();
  class Location {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    getX() { return this.x; }
    getY() { return this.y; }
    getZ() { return this.z; }
  }
  const core = {
    Location,
    CacheDefinitions: {
      getCounts: () => ({ npcs: 21 }),
      getNpc: (id) => ({ name: NPC_NAMES[id] ?? "null" }),
    },
    NpcDefinition: {
      forId: (id) => ({
        getName: () => NPC_NAMES[id],
        getCombatLevel: () => 21,
        getSize: () => 1,
        isAttackable: () => true,
        isAggressive: () => false,
        getActions: () => ["Talk-to", "Attack"],
      }),
    },
    NPC: {
      create: (id, location) => ({
        id, location, radius: null,
        getId: () => id,
        getLocation: () => location,
        getMovementCoordinator: () => ({ setRadius: (r) => { npc.radius = r; } }),
      }),
    },
    World: {
      addQueue: [],
      removeQueue: [],
      getAddNPCQueue() { return this.addQueue; },
      getRemoveNPCQueue() { return this.removeQueue; },
      getNpcsNear: (at, radius) => live.filter(
        (npc) => Math.abs(npc.location.x - at.x) <= radius
          && Math.abs(npc.location.y - at.y) <= radius && npc.location.z === at.z,
      ),
    },
  };
  // NPC.create's closure needs the npc; rewire to set radius on the created object.
  const created = [];
  core.NPC.create = (id, location) => {
    const npc = {
      id, location, radius: null,
      getId: () => id,
      getLocation: () => npc.location,
      getSpawnPosition: () => location,
      getMovementCoordinator: () => ({ setRadius: (r) => { npc.radius = r; } }),
    };
    created.push(npc);
    return npc;
  };
  core.World.getNpcsNear = (at, radius) => live.filter(
    (npc) => Math.abs(npc.location.x - at.x) <= radius
      && Math.abs(npc.location.y - at.y) <= radius && npc.location.z === at.z,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-npc-"));
  process.env.AGENT_MCP_NPC_SPAWNS_FILE = path.join(dir, "npc-spawns.json");
  fs.writeFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, "[]");
  const sleepTicks = async () => {};
  registerEditNpcTools({ core, tool: (n, _d, _s, h) => envelope(tools, n, h), z, sleepTicks });
  const call = async (name, args) => {
    const result = await tools.get(name)(args);
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const callRaw = (name, args) => tools.get(name)(args);
  return {
    tools, call, callRaw, live, created, addQueue: core.World.addQueue,
    file: process.env.AGENT_MCP_NPC_SPAWNS_FILE,
  };
}

// Minimal valid encoded terrain: every tile of every plane is just terminator opcode 0.
function emptyTerrainBytes(wide) {
  const width = wide ? 2 : 1;
  return new Uint8Array(4 * 64 * 64 * width);
}

function terrainTestSetup(dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-terrain-"))) {
  const tools = new Map();
  const stored = new Map();
  const replaced = [];
  process.env.AGENT_MCP_REGIONS_DIR = path.join(dir, "regions");
  const baseTerrain = emptyTerrainBytes(true);
  const baseObjects = new Uint8Array([1, 2, 3]);
  const core = {
    CachePipeline: { getActive: () => ({ revision: 241 }) },
    CacheMaps: {
      getRegion: () => ({ terrainData: baseTerrain, objectData: baseObjects }),
    },
    MapRegionReplacementManager: {
      getReplacementMapData: (regionId) => stored.get(regionId) ?? null,
      replaceMapRegionData: (regionId, terrainData, objectData, source) => {
        stored.set(regionId, { terrainData, objectData, source });
        replaced.push({ regionId, source });
        return { regionId, source, terrainBytes: terrainData.length, objectBytes: objectData?.length ?? 0 };
      },
      getSource: (regionId) => stored.get(regionId)?.source ?? null,
      removeMapRegion: (regionId) => stored.delete(regionId),
      // Mirrors the real manager: a pack needs objects, and a caller may supply them
      // for a region whose live replacement is terrain-only.
      getRegionPack: (regionId, objectDataOverride) => {
        const entry = stored.get(regionId);
        const objects = objectDataOverride ?? entry?.objectData;
        if (!entry || !objects) return null;
        const header = Buffer.alloc(28);
        header.writeInt32BE(1, 0);
        return Buffer.concat([header, Buffer.from(objects), Buffer.from(entry.terrainData)]);
      },
      getRegionIds: () => [...stored.keys()].sort((a, b) => a - b),
    },
  };
  registerEditTerrainTools({ core, tool: (n, _d, _s, h) => envelope(tools, n, h), z });
  const call = async (name, args) => {
    const result = await tools.get(name)(args);
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const callRaw = (name, args) => tools.get(name)(args);
  return { tools, call, callRaw, stored, replaced, dir, manager: core.MapRegionReplacementManager };
}

function worldDataFixture(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "edit-world-layers-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const resolve = path.resolve;
  t.mock.method(path, "resolve", (...segments) =>
    segments.length === 1 && segments[0] === "data" ? data : resolve(...segments));
  return data;
}

test("npc tools register", () => {
  const { tools } = npcTestSetup();
  assert.deepEqual(
    [...tools.keys()],
    ["search_npcs", "describe_npc", "spawn_npc", "remove_npc", "list_spawned_npcs"],
  );
});

test("search_npcs + describe_npc", async () => {
  const { call, callRaw } = npcTestSetup();
  const guards = await call("search_npcs", { query: "guard", limit: 20 });
  assert.deepEqual(guards.results, [{ id: 10, name: "Guard" }, { id: 11, name: "Guard" }]);
  assert.deepEqual(await call("describe_npc", { id: 10 }), {
    id: 10, name: "Guard", combatLevel: 21, size: 1,
    attackable: true, aggressive: false, options: ["Talk-to", "Attack"],
  });
  assert.equal((await callRaw("describe_npc", { id: 99 })).isError, true);
});

test("spawn_npc goes live, persists once, validates", async () => {
  const t = npcTestSetup();
  const spawned = await t.call("spawn_npc", { id: 10, x: 3222, y: 3218 });
  assert.equal(spawned.spawned.name, "Guard");
  assert.equal(spawned.persisted, true);
  assert.equal(t.addQueue.length, 1);
  assert.equal(t.created[0].radius, 5);
  await t.call("spawn_npc", { id: 10, x: 3222, y: 3218 });
  assert.equal(t.addQueue.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(t.file, "utf8")).length, 1);
  for (const args of [
    { id: 99, x: 3222, y: 3218 },
    { id: 10, x: -1, y: 3218 },
    { id: 10, x: 3222, y: 3218, z: 5 },
  ]) {
    assert.equal((await t.callRaw("spawn_npc", args)).isError, true, JSON.stringify(args));
  }
});

test("remove_npc clears live and file; cache npcs warn", async () => {
  const t = npcTestSetup();
  await t.call("spawn_npc", { id: 10, x: 3222, y: 3218 });
  t.live.push(t.created[0]);
  const removed = await t.call("remove_npc", { x: 3222, y: 3218, z: 0 });
  assert.deepEqual(removed.removed, [{ id: 10, x: 3222, y: 3218, z: 0 }]);
  assert.equal(removed.persisted, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.file, "utf8")), []);
  // A live NPC with no file entry still goes, but warns it returns on restart.
  const cacheNpc = {
    getId: () => 20,
    location: { x: 3230, y: 3220, z: 0, getX: () => 3230, getY: () => 3220, getZ: () => 0 },
    getLocation() { return this.location; },
  };
  t.live.push(cacheNpc);
  const cacheRemoved = await t.call("remove_npc", { x: 3230, y: 3220, z: 0 });
  assert.equal(cacheRemoved.persisted, false);
  assert.ok(cacheRemoved.note);
  assert.equal((await t.callRaw("remove_npc", { x: 3200, y: 3200, z: 0 })).isError, true);
});

test("terrain tools register", () => {
  const { tools } = terrainTestSetup();
  assert.deepEqual(
    [...tools.keys()],
    ["describe_tile", "paint_ground", "set_height", "clear_terrain", "list_region_packs", "set_walkability"],
  );
});

test("walkability changes only the ground blocking bit", async () => {
  const { call } = terrainTestSetup();
  const tile = { x1: 3200, y1: 3200, x2: 3200, y2: 3200, z: 0 };
  await call("set_walkability", { ...tile, blocked: true });
  assert.equal((await call("describe_tile", { x: 3200, y: 3200, z: 0 })).flag, 1);
  await call("set_walkability", { ...tile, blocked: false });
  assert.equal((await call("describe_tile", { x: 3200, y: 3200, z: 0 })).flag ?? 0, 0);
});

test("paint_ground round-trips through describe_tile and persists a pack", async () => {
  const t = terrainTestSetup();
  const before = await t.call("describe_tile", { x: 3222, y: 3218, z: 0 });
  assert.deepEqual(before, { x: 3222, y: 3218, z: 0, overlay: null, underlay: null, height: null, flag: null });
  const painted = await t.call("paint_ground", {
    x1: 3222, y1: 3218, x2: 3223, y2: 3219, z: 0, overlay: 5, underlay: 3,
  });
  assert.equal(painted.regions.length, 1);
  assert.equal(painted.regions[0].persisted, true);
  // Region of tile (3222,3218): map 50,50 -> id 50<<8|50.
  assert.equal(painted.regions[0].regionId, (50 << 8) | 50);
  // Persisted in the map editor's format: a full .pack, not a terrain-only file.
  const packFile = path.join(t.dir, "regions", `${painted.regions[0].regionId}.pack`);
  assert.equal(painted.regions[0].packFile, packFile);
  assert.equal(painted.regions[0].terrainFile, null);
  assert.ok(fs.existsSync(packFile));
  assert.equal(painted.regions[0].streamed, "pack");
  const after = await t.call("describe_tile", { x: 3222, y: 3218, z: 0 });
  assert.deepEqual(after.overlay, { id: 5, shape: 0, rotation: 0 });
  assert.equal(after.underlay, 3);
  // Untouched neighbor is still base.
  const neighbor = await t.call("describe_tile", { x: 3230, y: 3230, z: 0 });
  assert.equal(neighbor.overlay, null);
});

test("set_height, flatten and clear_terrain", async () => {
  const t = terrainTestSetup();
  await t.call("set_height", { x1: 3222, y1: 3218, x2: 3222, y2: 3218, z: 0, height: 200 });
  assert.equal((await t.call("describe_tile", { x: 3222, y: 3218, z: 0 })).height, 200);
  assert.equal((await t.call("describe_tile", { x: 3222, y: 3218, z: 1 })).height, null);
  await t.call("set_height", {
    x1: 3222, y1: 3218, x2: 3222, y2: 3218, z: 0, height: 100, allPlanes: true,
  });
  for (const z of [0, 1, 2, 3]) {
    assert.equal((await t.call("describe_tile", { x: 3222, y: 3218, z })).height, 100);
  }
  await t.call("clear_terrain", { x1: 3222, y1: 3218, x2: 3223, y2: 3219, z: 0 });
  const cleared = await t.call("describe_tile", { x: 3222, y: 3218, z: 0 });
  assert.deepEqual(cleared, { x: 3222, y: 3218, z: 0, overlay: null, underlay: null, height: null, flag: null });
  const packs = await t.call("list_region_packs", {});
  assert.equal(packs.count, 1);
});

test("spawn file keeps its formatting: only agent lines change", async () => {
  const t = npcTestSetup();
  const original = '[\r\n  {"level":0,"name":"Man","x":3222,"y":3218,"id":1},\r\n  {"level":0,"name":"Woman","x":3223,"y":3218,"id":2}\r\n]\r\n';
  fs.writeFileSync(t.file, original);
  await t.call("spawn_npc", { id: 10, x: 3240, y: 3240 });
  t.live.push(t.created[0]);
  const afterAdd = fs.readFileSync(t.file, "utf8");
  assert.ok(afterAdd.includes('  {"level":0,"name":"Man","x":3222,"y":3218,"id":1},'));
  assert.ok(afterAdd.includes('  {"level":0,"name":"Woman","x":3223,"y":3218,"id":2},'));
  assert.ok(afterAdd.includes('  {"level":0,"name":"Guard","x":3240,"y":3240,"id":10,"wanderRadius":5,"source":"agent-mcp"}'));
  assert.ok(afterAdd.endsWith("\r\n"));
  assert.ok(!afterAdd.replaceAll("\r\n", "").includes("\n"));
  await t.call("remove_npc", { x: 3240, y: 3240, z: 0 });
  assert.equal(fs.readFileSync(t.file, "utf8"), original);
});

test("terrain validation", async () => {
  const t = terrainTestSetup();
  assert.equal((await t.callRaw("paint_ground", { x1: 0, y1: 0, x2: 0, y2: 0, z: 0 })).isError, true);
  assert.equal((await t.callRaw("paint_ground", {
    x1: 0, y1: 0, x2: 200, y2: 200, z: 0, overlay: 5,
  })).isError, true);
  assert.equal((await t.callRaw("set_height", {
    x1: 0, y1: 0, x2: 0, y2: 0, z: 0, height: 300,
  })).isError, true);
});

// --- review follow-ups -------------------------------------------------------

test("terrain writes leave exactly one region file, in the editor's pack format", async () => {
  const t = terrainTestSetup();
  const regionId = (50 << 8) | 50; // tiles 3200-3263 x 3200-3263
  const dir = path.join(t.dir, "regions");
  fs.mkdirSync(dir, { recursive: true });
  // A leftover terrain-only file from an older build of these tools.
  const staleTerrain = path.join(dir, `${regionId}.terrain.dat`);
  fs.writeFileSync(staleTerrain, Buffer.from([1, 2, 3]));
  await t.call("paint_ground", { x1: 3222, y1: 3218, x2: 3222, y2: 3218, z: 0, overlay: 5 });
  assert.equal(fs.existsSync(staleTerrain), false, "the .terrain.dat must not survive next to a .pack");
  assert.equal(fs.existsSync(path.join(dir, `${regionId}.pack`)), true);
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${regionId}.pack`]);
});

test("terrain saves and clears both sides of a region boundary in one layer", async (t) => {
  const data = worldDataFixture(t);
  const { call } = terrainTestSetup(data);
  const rect = { x1: 3263, y1: 3218, x2: 3264, y2: 3218 };
  const mapEdits = path.join(data, "map-edits");
  const painted = await call("paint_ground", { ...rect, overlay: 5 });
  assert.equal(painted.regions.length, 2);
  const [layer] = fs.readdirSync(mapEdits);
  assert.deepEqual(fs.readdirSync(mapEdits), [layer]);
  const files = painted.regions.map(({ regionId, packFile }) => {
    const base = path.join(data, "regions", `${regionId}.pack`);
    assert.equal(packFile, path.join(mapEdits, layer, "regions", path.basename(base)));
    assert.equal(effectiveFile(base), packFile);
    return base;
  });
  const cleared = await call("clear_terrain", rect);
  assert.ok(cleared.regions.every((region) => region.matchesCache && !region.persisted));
  assert.equal(fs.existsSync(path.join(mapEdits, layer)), false);
  assert.equal(fs.readdirSync(mapEdits).length, 1);
  assert.deepEqual(files.map((file) => effectiveFile(file)), [null, null]);
});

test("a failed second terrain region restores the first and saves no layer", async (t) => {
  const data = worldDataFixture(t);
  const { callRaw, manager, stored } = terrainTestSetup(data);
  const first = (50 << 8) | 50;
  const second = (51 << 8) | 50;
  const terrainData = emptyTerrainBytes(true);
  const objectData = Uint8Array.of(4, 5, 6);
  manager.replaceMapRegionData(first, terrainData, objectData, "editor");
  const replace = manager.replaceMapRegionData;
  manager.replaceMapRegionData = (id, ...args) => {
    if (id === second) throw new Error("injected failure");
    return replace(id, ...args);
  };
  const result = await callRaw("paint_ground", { x1: 3263, y1: 3218, x2: 3264, y2: 3218, overlay: 5 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /injected failure/);
  assert.deepEqual(stored.get(first), { terrainData, objectData, source: "editor" });
  assert.equal(stored.has(second), false);
  assert.equal(fs.existsSync(path.join(data, "map-edits")), false);
});

test("automatic layers only disappear when newer automatic saves cover every path", (t) => {
  const data = worldDataFixture(t);
  const pack = "regions/12850.pack";
  const warps = "definitions/map-warps.json";
  const commit = (entries, automatic = false) => commitMapEdit(new Map(entries), data, { automatic });
  const older = commit([[pack, "first terrain"], [warps, "first links"]], true);
  const editor = commit([[pack, "editor terrain"], [warps, "editor links"]]);
  const terrain = commit([[pack, "new terrain"]], true);
  assert.equal(fs.readFileSync(path.join(older, warps), "utf8"), "first links");
  assert.equal(readLayers(data).effective.get(warps), path.join(editor, warps));

  commit([[warps, null]], true);
  assert.equal(fs.existsSync(older), false);
  assert.equal(fs.readFileSync(path.join(editor, pack), "utf8"), "editor terrain");
  assert.equal(fs.readFileSync(path.join(editor, warps), "utf8"), "editor links");
  const { effective } = readLayers(data);
  assert.equal(effective.get(pack), path.join(terrain, pack));
  assert.equal(effective.get(warps), null);
});

// --- live-test follow-ups ----------------------------------------------------

test("remove_npc finds a wandering spawn by its spawn tile", async () => {
  const t = npcTestSetup();
  await t.call("spawn_npc", { id: 10, x: 3229, y: 3262, wanderRadius: 1 });
  const cow = t.created[0];
  t.live.push(cow);
  // It wandered one tile west before the removal arrived.
  cow.location = { x: 3228, y: 3262, z: 0, getX: () => 3228, getY: () => 3262, getZ: () => 0 };
  const removed = await t.call("remove_npc", { x: 3229, y: 3262, z: 0, id: 10 });
  assert.deepEqual(removed.removed, [{ id: 10, x: 3228, y: 3262, z: 0 }]);
  assert.equal(removed.persisted, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.file, "utf8")), []);
});

test("spawn file keeps an untouched entry's own spacing", async () => {
  const t = npcTestSetup();
  const original = '[\n  {"id": 6142, "name": "Ernest", "x": 3110, "y": 3365, "level": 2},\n  {"level":0,"name":"Man","x":3222,"y":3218,"id":1}\n]\n';
  fs.writeFileSync(t.file, original);
  await t.call("spawn_npc", { id: 10, x: 3240, y: 3240 });
  t.live.push(t.created[0]);
  assert.ok(fs.readFileSync(t.file, "utf8").includes('  {"id": 6142, "name": "Ernest", "x": 3110, "y": 3365, "level": 2},'));
  await t.call("remove_npc", { x: 3240, y: 3240, z: 0 });
  assert.equal(fs.readFileSync(t.file, "utf8"), original);
});

test("a region cleared back to the cache stops persisting", async () => {
  const t = terrainTestSetup();
  const regionId = (50 << 8) | 50;
  // Edits persist in the editor's pack format now, not a terrain-only file.
  const file = path.join(t.dir, "regions", `${regionId}.pack`);
  await t.call("paint_ground", { x1: 3222, y1: 3218, x2: 3222, y2: 3218, z: 0, overlay: 5 });
  assert.ok(fs.existsSync(file));
  assert.equal((await t.call("list_region_packs", {})).regions[0].matchesCache, false);
  const cleared = await t.call("clear_terrain", { x1: 3222, y1: 3218, x2: 3223, y2: 3218 });
  assert.equal(cleared.change, "clear 2 tiles on every plane");
  assert.equal(cleared.regions[0].matchesCache, true);
  assert.equal(cleared.regions[0].persisted, false);
  assert.equal(fs.existsSync(file), false, "no file, so nothing loads on restart");
  assert.equal((await t.call("list_region_packs", {})).regions[0].matchesCache, true);
});

test("a dense region streams terrain-only but still persists a .pack", async () => {
  const t = terrainTestSetup();
  const regionId = (50 << 8) | 50;
  // Behave like the real manager on a region too dense to carry objects in one packet.
  const manager = t.manager;
  const realReplace = manager.replaceMapRegionData;
  manager.replaceMapRegionData = (id, terrain, objects, source) => {
    if (objects) throw new Error(`region replacement is too large: region=${id} bytes=99999 max=65533`);
    return realReplace(id, terrain, objects, source);
  };
  const painted = await t.call("paint_ground", {
    x1: 3222, y1: 3218, x2: 3222, y2: 3218, z: 0, overlay: 5,
  });
  assert.equal(painted.regions[0].streamed, "terrain", "players get terrain; the client keeps cache objects");
  assert.equal(painted.regions[0].objectBytes, 0);
  // The file is still the editor's format, carrying the cache's objects.
  assert.equal(painted.regions[0].packFile, path.join(t.dir, "regions", `${regionId}.pack`));
  assert.ok(fs.existsSync(painted.regions[0].packFile));
  assert.equal(fs.existsSync(path.join(t.dir, "regions", `${regionId}.terrain.dat`)), false);
  manager.replaceMapRegionData = realReplace;
});
