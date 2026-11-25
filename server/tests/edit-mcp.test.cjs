// Edit MCP tools (plugins/agent/mcp/Edit.AgentMcp.js): search/describe/place/remove/list
// against a fake core and a temp spawns file. Run: node --test tests/edit-mcp.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const registerEditTools = require("../plugins/agent/mcp/Edit.AgentMcp");
const { commitMapEdit, effectiveFile } = require("../plugins/world/MapEditFiles");

const NAMES = {
  0: "null",
  1: "Oak tree",
  2: "Marble wall",
  3: "Marble wall",
  4: "Bank booth",
  5: "Oak door",
};

function fakeCore(live = []) {
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
  class GameObject {
    constructor(id, position, type, face) {
      this.id = id;
      this.position = position;
      this.objectType = type;
      this.objectFace = face;
    }
    getId() { return this.id; }
    getType() { return this.objectType; }
    getFace() { return this.objectFace; }
    getLocation() { return this.position; }
  }
  const keyOf = (position, type) => `${position.x},${position.y},${position.z},${type}`;
  return {
    Location,
    GameObject,
    CacheDefinitions: {
      getCounts: () => ({ objects: Object.keys(NAMES).length }),
      getObject: (id) => ({ name: NAMES[id] ?? "null" }),
    },
    ObjectDefinition: {
      forId: (id) => (NAMES[id] === undefined || NAMES[id] === "null" ? undefined : {
        getName: () => NAMES[id],
        getSizeX: () => 1,
        getSizeY: () => 1,
        isSolid: () => id !== 5,
        isImpenetrable: () => false,
        hasActions: () => id === 4,
        getInteractions: () => (id === 4 ? ["Bank"] : null),
      }),
    },
    ObjectManager: {
      register: (object) => {
        for (let i = live.length - 1; i >= 0; i--) {
          if (keyOf(live[i].position, live[i].objectType) === keyOf(object.position, object.objectType)) {
            live.splice(i, 1);
          }
        }
        live.push(object);
      },
      deregister: (object) => {
        const index = live.indexOf(object);
        if (index !== -1) live.splice(index, 1);
      },
      objectsAt: (position) => live.filter(
        (object) => object.position.x === position.x && object.position.y === position.y && object.position.z === position.z,
      ),
    },
    live,
    World: {
      removeQueue: [],
      getRemoveNPCQueue() { return this.removeQueue; },
      getNpcsNear: () => [],
    },
    MapObjects: {
      mapObjects: new Map(),
      getHash: (x, y, z) => `${x},${y},${z}`,
    },
  };
}

function setup(core, dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-mcp-"))) {
  const tools = new Map();
  process.env.AGENT_MCP_SPAWNS_FILE = path.join(dir, "object-spawns.json");
  fs.writeFileSync(process.env.AGENT_MCP_SPAWNS_FILE, "[]");
  process.env.AGENT_MCP_NPC_SPAWNS_FILE = path.join(dir, "npc-spawns.json");
  fs.writeFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, "[]");
  // Same envelope as Context.AgentMcp's tool(): JSON text, errors flagged.
  const tool = (name, _description, _schema, handler) => tools.set(name, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
    }
  });
  registerEditTools({ core, tool, z });
  const call = async (name, args) => {
    const result = await tools.get(name)(args);
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const callRaw = (name, args) => tools.get(name)(args);
  return { tools, call, callRaw, file: process.env.AGENT_MCP_SPAWNS_FILE };
}

test("registers the edit toolset", () => {
  const { tools } = setup(fakeCore());
  assert.deepEqual(
    [...tools.keys()],
    ["search_objects", "describe_object", "place_object", "remove_object", "clear_area", "restore_area", "list_placed_objects"],
  );
});

test("clear_area removes objects and npcs, persisting removals", async () => {
  const core = fakeCore();
  const tools = new Map();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-mcp-clear-"));
  process.env.AGENT_MCP_SPAWNS_FILE = path.join(dir, "object-spawns.json");
  process.env.AGENT_MCP_NPC_SPAWNS_FILE = path.join(dir, "npc-spawns.json");
  fs.writeFileSync(process.env.AGENT_MCP_SPAWNS_FILE, "[]");
  fs.writeFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, JSON.stringify([
    { level: 0, name: "Man", x: 101, y: 101, id: 1 },
  ]));
  const tool = (name, _description, _schema, handler) => tools.set(name, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
    }
  });
  registerEditTools({ core, tool, z });
  const call = async (name, args) => {
    const result = await tools.get(name)(args);
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  // ObjectManager object inside, MapObjects (cache) object inside, one outside; one live NPC inside.
  core.live.push(new core.GameObject(2, new core.Location(101, 101, 0), 10, 0));
  core.live.push(new core.GameObject(2, new core.Location(200, 200, 0), 10, 0));
  const cacheObject = new core.GameObject(4, new core.Location(102, 101, 0), 10, 0);
  core.MapObjects.mapObjects.set(core.MapObjects.getHash(102, 101, 0), [cacheObject]);
  const npc = { getId: () => 1, getLocation: () => new core.Location(101, 101, 0), getPrivateArea: () => null };
  core.World.getNpcsNear = () => [npc];
  const cleared = await call("clear_area", { x1: 100, y1: 100, x2: 102, y2: 102, includeCache: true });
  assert.equal(cleared.removedObjects, 2);
  assert.equal(cleared.removedNpcs, 1);
  assert.deepEqual(cleared.unpersistedCacheNpcs, []);
  assert.equal(core.live.length, 1);
  assert.equal(core.World.removeQueue.length, 1);
  const spawns = JSON.parse(fs.readFileSync(process.env.AGENT_MCP_SPAWNS_FILE, "utf8"));
  assert.equal(spawns.length, 2);
  assert.ok(spawns.every((entry) => entry.remove === true));
  assert.deepEqual(spawns.map((entry) => entry.id).sort(), [2, 4]);
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, "utf8")), []);
  // Cache NPCs with no file entry are reported as unpersisted.
  const stray = { getId: () => 9, getLocation: () => new core.Location(101, 102, 0), getPrivateArea: () => null };
  core.World.getNpcsNear = () => [stray];
  const cleared2 = await call("clear_area", { x1: 100, y1: 100, x2: 102, y2: 102, includeCache: true });
  assert.equal(cleared2.removedNpcs, 1);
  assert.deepEqual(cleared2.unpersistedCacheNpcs, [{ id: 9, x: 101, y: 102 }]);
  // Oversized rects are rejected.
  const big = await tools.get("clear_area")({ x1: 0, y1: 0, x2: 100, y2: 100 });
  assert.equal(big.isError, true);
});

test("search_objects matches names and ids, skipping null entries", async () => {
  const { call } = setup(fakeCore());
  const walls = await call("search_objects", { query: "marble", limit: 20 });
  assert.deepEqual(walls.results, [{ id: 2, name: "Marble wall" }, { id: 3, name: "Marble wall" }]);
  const byId = await call("search_objects", { query: "4", limit: 20 });
  assert.deepEqual(byId.results.map((r) => r.id), [4]);
  const none = await call("search_objects", { query: "zzz-no-such-loc", limit: 20 });
  assert.equal(none.count, 0);
});

test("describe_object reports footprint and flags; unknown ids fail", async () => {
  const { call, callRaw } = setup(fakeCore());
  process.env.AGENT_MCP_LOC_SIZES_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edit-sizes-")), "sizes.json");
  fs.writeFileSync(process.env.AGENT_MCP_LOC_SIZES_FILE, JSON.stringify({ locs: { 4: [[10, 96, 64, 120, 120]] } }));
  assert.deepEqual(await call("describe_object", { id: 4 }), {
    id: 4, name: "Bank booth", sizeX: 1, sizeY: 1,
    solid: true, blocksProjectiles: false, interactive: true, options: ["Bank"],
    sizes: { 10: { width: 96, depth: 64, height: 120, top: 120 } },
  });
  const bad = await callRaw("describe_object", { id: 99 });
  assert.equal(bad.isError, true);
});

test("place_object goes live, persists once, and validates", async () => {
  const core = fakeCore();
  const { call, callRaw, file } = setup(core);
  const placed = await call("place_object", { id: 2, x: 3200, y: 3200 });
  assert.equal(placed.placed.name, "Marble wall");
  assert.equal(placed.persisted, true);
  assert.equal(core.live.length, 1);
  // Placing again replaces live and does not duplicate the file entry.
  await call("place_object", { id: 2, x: 3200, y: 3200 });
  assert.equal(core.live.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).length, 1);
  const entry = JSON.parse(fs.readFileSync(file, "utf8"))[0];
  assert.deepEqual(entry, {
    id: 2, position: { x: 3200, y: 3200, z: 0 }, type: 10, face: 0, source: "agent-mcp",
  });
  for (const args of [
    { id: 99, x: 3200, y: 3200 },
    { id: 2, x: -1, y: 3200 },
    { id: 2, x: 3200, y: 3200, z: 5 },
    { id: 2, x: 3200, y: 3200, type: 23 },
  ]) {
    assert.equal((await callRaw("place_object", args)).isError, true, JSON.stringify(args));
  }
});

test("remove_object clears live and file; cache objects get a removal entry", async () => {
  const core = fakeCore();
  const { call, callRaw, file } = setup(core);
  await call("place_object", { id: 2, x: 3200, y: 3200 });
  const removed = await call("remove_object", { x: 3200, y: 3200, z: 0 });
  assert.deepEqual(removed.removed, [{ id: 2, type: 10, x: 3200, y: 3200, z: 0 }]);
  assert.equal(core.live.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), []);
  // A cache-map object (live, but no file entry) leaves a remove:true marker.
  core.live.push(new core.GameObject(1, new core.Location(3210, 3210, 0), 10, 0));
  await call("remove_object", { x: 3210, y: 3210, z: 0 });
  const [marker] = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(marker.remove, true);
  assert.equal(marker.id, 1);
  const empty = await callRaw("remove_object", { x: 3220, y: 3220, z: 0 });
  assert.equal(empty.isError, true);
});

test("list_placed_objects filters by source", async () => {
  const { call, file } = setup(fakeCore());
  fs.writeFileSync(file, JSON.stringify([
    { id: 2, position: { x: 1, y: 2, z: 0 }, type: 10, face: 0, source: "agent-mcp" },
    { id: 4, position: { x: 3, y: 4, z: 0 }, type: 10, face: 0 },
  ]));
  assert.equal((await call("list_placed_objects", {})).count, 2);
  const agent = await call("list_placed_objects", { source: "agent-mcp" });
  assert.equal(agent.count, 1);
});

// --- review follow-ups -------------------------------------------------------

test("clear_area does not write removal markers for objects it placed itself", async () => {
  const core = fakeCore();
  const tools = new Map();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-mcp-clear2-"));
  process.env.AGENT_MCP_SPAWNS_FILE = path.join(dir, "object-spawns.json");
  process.env.AGENT_MCP_NPC_SPAWNS_FILE = path.join(dir, "npc-spawns.json");
  fs.writeFileSync(process.env.AGENT_MCP_SPAWNS_FILE, "[]");
  fs.writeFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, "[]");
  const tool = (name, _d, _s, handler) => tools.set(name, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
    }
  });
  registerEditTools({ core, tool, z });
  const call = async (name, args) => {
    const result = await tools.get(name)(args);
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  // Place an object through the toolset, then raze the tile.
  // place_object already registered it live; the fake keeps that in core.live.
  await call("place_object", { id: 2, x: 500, y: 500 });
  await call("clear_area", { x1: 500, y1: 500, x2: 500, y2: 500, includeNpcs: false });
  const entries = JSON.parse(fs.readFileSync(process.env.AGENT_MCP_SPAWNS_FILE, "utf8"));
  assert.equal(entries.filter((entry) => entry.remove === true).length, 0,
    "an agent-placed object is dropped, not turned into a cache-map removal marker");
});

test("placing on a razed tile keeps the object after a reload", async () => {
  const core = fakeCore();
  const tools = new Map();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-mcp-replace-"));
  process.env.AGENT_MCP_SPAWNS_FILE = path.join(dir, "object-spawns.json");
  process.env.AGENT_MCP_NPC_SPAWNS_FILE = path.join(dir, "npc-spawns.json");
  fs.writeFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, "[]");
  fs.writeFileSync(process.env.AGENT_MCP_SPAWNS_FILE, JSON.stringify([
    { id: 2, position: { x: 700, y: 700, z: 0 }, type: 10, face: 0, remove: true, source: "agent-mcp" },
  ]));
  const tool = (name, _d, _s, handler) => tools.set(name, async (args) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      return { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true };
    }
  });
  registerEditTools({ core, tool, z });
  const result = await tools.get("place_object")({ id: 2, x: 700, y: 700 });
  assert.equal(result.isError, undefined);
  const entries = JSON.parse(fs.readFileSync(process.env.AGENT_MCP_SPAWNS_FILE, "utf8"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].remove, undefined, "the stale marker must be gone");
});

// --- live-test follow-ups ----------------------------------------------------

test("clear_area keeps cache objects by default and drops only spawn-file placements", async () => {
  const core = fakeCore();
  const { call, file } = setup(core);
  await call("place_object", { id: 2, x: 600, y: 600 });
  // A cache fence on the next tile: not in the spawn file.
  const fence = new core.GameObject(4, new core.Location(601, 600, 0), 0, 0);
  core.MapObjects.mapObjects.set(core.MapObjects.getHash(601, 600, 0), [fence]);
  core.live.push(fence);
  const cleared = await call("clear_area", { x1: 600, y1: 600, x2: 601, y2: 600, includeNpcs: false });
  assert.equal(cleared.removedObjects, 1);
  assert.equal(cleared.removedCacheObjects, 0);
  assert.equal(cleared.keptObjects, 1);
  assert.deepEqual(core.live, [fence], "the cache fence still stands");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), [], "no removal marker for the fence");
});

test("clear_area dryRun reports without touching the world or the file", async () => {
  const core = fakeCore();
  const { call, file } = setup(core);
  await call("place_object", { id: 2, x: 610, y: 610 });
  const before = fs.readFileSync(file, "utf8");
  const cache = new core.GameObject(4, new core.Location(611, 610, 0), 10, 0);
  core.MapObjects.mapObjects.set(core.MapObjects.getHash(611, 610, 0), [cache]);
  const plan = await call("clear_area", { x1: 610, y1: 610, x2: 611, y2: 610, includeCache: true, dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.removedObjects, 2);
  assert.equal(plan.removedCacheObjects, 1);
  assert.equal(plan.droppedOrphanEntries, 0);
  assert.equal(core.live.length, 1);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("clear_area drops placements a later placement hid on the same tile", async () => {
  const core = fakeCore();
  const { call, file } = setup(core);
  // An entry whose object no longer stands live (it was replaced on its tile).
  fs.writeFileSync(file, JSON.stringify([
    { id: 3, position: { x: 620, y: 620, z: 0 }, type: 10, face: 0, source: "agent-mcp" },
  ]));
  const cleared = await call("clear_area", { x1: 620, y1: 620, x2: 620, y2: 620, includeNpcs: false });
  assert.equal(cleared.droppedOrphanEntries, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), []);
});

test("restore_area puts razed cache objects back and drops their markers", async () => {
  const core = fakeCore();
  const { call, file } = setup(core);
  const fence = new core.GameObject(4, new core.Location(630, 630, 0), 0, 1);
  core.MapObjects.mapObjects.set(core.MapObjects.getHash(630, 630, 0), [fence]);
  await call("clear_area", { x1: 630, y1: 630, x2: 630, y2: 630, includeCache: true, includeNpcs: false });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))[0].remove, true);
  const restored = await call("restore_area", { x1: 629, y1: 629, x2: 631, y2: 631 });
  assert.equal(restored.restored, 1);
  assert.deepEqual(core.live.map((object) => [object.getId(), object.getType(), object.getFace()]), [[4, 0, 1]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), []);
});

test("place_object drops the entry of the object it replaced on the tile", async () => {
  const { call, file } = setup(fakeCore());
  await call("place_object", { id: 2, x: 640, y: 640 });
  const second = await call("place_object", { id: 3, x: 640, y: 640 });
  assert.equal(second.replaced, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).map((entry) => entry.id), [3]);
});

test("place_object saves to the base file and respects an active editor layer", async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "edit-mcp-layer-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const resolve = path.resolve;
  t.mock.method(path, "resolve", (...segments) =>
    segments.length === 1 && segments[0] === "data" ? data : resolve(...segments));
  const definitions = path.join(data, "definitions");
  fs.mkdirSync(definitions);
  const { call, file } = setup(fakeCore(), definitions);
  const first = { id: 1, position: { x: 639, y: 640, z: 0 } };
  fs.writeFileSync(file, JSON.stringify([first]));
  const ids = (filename) => JSON.parse(fs.readFileSync(filename, "utf8")).map((entry) => entry.id);

  await call("place_object", { id: 2, x: 640, y: 640 });
  assert.deepEqual(ids(file), [1, 2]);
  assert.equal(fs.existsSync(path.join(data, "map-edits")), false);
  const base = JSON.parse(fs.readFileSync(file, "utf8"));
  base.push({ id: 99, position: { x: 641, y: 640, z: 0 } });
  fs.writeFileSync(file, JSON.stringify(base));
  assert.deepEqual(ids(effectiveFile(file)), [1, 2, 99]);

  const relative = "definitions/object-spawns.json";
  const editor = commitMapEdit(new Map([[relative, JSON.stringify([first])]]), data);
  await call("place_object", { id: 3, x: 642, y: 640 });
  assert.deepEqual(ids(effectiveFile(file)), [1, 3]);
  assert.deepEqual(ids(path.join(editor, relative)), [1]);
  assert.deepEqual(ids(file), [1, 2, 99]);
});

test("clear_area drops a wandering NPC's spawn entry by its spawn tile", async () => {
  const core = fakeCore();
  const { call } = setup(core);
  fs.writeFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, JSON.stringify([
    { level: 0, name: "Cow", x: 650, y: 650, id: 7, source: "agent-mcp" },
  ]));
  // Spawned on 650,650; it has wandered one tile east.
  const cow = {
    getId: () => 7, getLocation: () => new core.Location(651, 650, 0),
    getSpawnPosition: () => new core.Location(650, 650, 0), getPrivateArea: () => null,
  };
  core.World.getNpcsNear = () => [cow];
  const cleared = await call("clear_area", { x1: 649, y1: 649, x2: 652, y2: 651 });
  assert.equal(cleared.removedNpcs, 1);
  assert.deepEqual(cleared.unpersistedCacheNpcs, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.AGENT_MCP_NPC_SPAWNS_FILE, "utf8")), []);
});
