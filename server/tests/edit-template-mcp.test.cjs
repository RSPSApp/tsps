// Template tools (plugins/agent/mcp/EditTemplates.AgentMcp.js) and the rotation helpers they
// use, against a fake core and temp files. Run: node --test tests/edit-template-mcp.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { z } = require("zod");

const geometry = require("../plugins/agent/mcp/EditGeometry.AgentMcp");
const registerEditTemplateTools = require("../plugins/agent/mcp/EditTemplates.AgentMcp");

// --- rotation ------------------------------------------------------------------

test("four quarter turns bring every loc back", () => {
  for (const loc of [
    { dx: 1, dy: 0, type: 0, face: 2 },
    { dx: 0, dy: 1, type: 10, face: 1 },
    { dx: 2, dy: 2, type: 22, face: 3 },
  ]) {
    assert.deepEqual(geometry.rotateLoc(loc, 4, 5, 4, 3, 2), loc);
  }
});

test("a quarter turn moves a sized loc by its footprint and turns walls west to north", () => {
  // 3x2 scenery at the corner of a 5x4 template covers x 0-1, y 2-4 after a turn.
  assert.deepEqual(geometry.rotateLoc({ dx: 0, dy: 0, type: 10, face: 0 }, 1, 5, 4, 3, 2),
    { dx: 0, dy: 2, type: 10, face: 1 });
  // A wall on the west edge of the corner tile ends on the north edge of the top-left tile.
  assert.deepEqual(geometry.rotateLoc({ dx: 0, dy: 0, type: 0, face: 0 }, 1, 5, 4),
    { dx: 0, dy: 4, type: 0, face: 1 });
  assert.deepEqual(geometry.rotateOffset(4, 3, 2, 5, 4), { dx: 0, dy: 0 });
});

// --- tools ---------------------------------------------------------------------

function fakeCore(objects) {
  class Location {
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
    getX() { return this.x; }
    getY() { return this.y; }
    getZ() { return this.z; }
  }
  const mapObjects = new Map();
  const getHash = (x, y, z) => (z * 16384 + x) * 16384 + y;
  for (const [id, x, y, plane, type, face] of objects) {
    const object = {
      getId: () => id, getType: () => type, getFace: () => face,
      getLocation: () => new Location(x, y, plane), getOwner: () => null, getPrivateArea: () => null,
    };
    const key = getHash(x, y, plane);
    mapObjects.set(key, [...(mapObjects.get(key) ?? []), object]);
  }
  const names = { 1: "Wall", 2: "Table", 3: "Ladder" };
  return {
    MapObjects: { mapObjects, getHash },
    RegionManager: { loadMapFiles: () => {} },
    ObjectDefinition: {
      forId: (id) => ({
        getName: () => names[id], hasActions: () => id === 3,
        getSizeX: () => (id === 2 ? 2 : 1), getSizeY: () => 1,
      }),
    },
  };
}

function setup(objects, tiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-template-"));
  process.env.AGENT_MCP_TEMPLATES_DIR = dir;
  const tools = new Map();
  const placed = [];
  const edits = [];
  const build = { applyPlacements: (list) => { placed.push(...list); return { placed: list.length, persisted: list.length }; } };
  const terrain = {
    tileAt: (x, y, plane) => tiles[`${x},${y},${plane}`] ?? { overlay: null, underlay: null, height: null, flag: null },
    applyEdits: (list) => { edits.push(...list); return { regions: [{ regionId: 1, terrainBytes: 100 }] }; },
    levelEdits: () => ({ edits: [], level: null, moved: 0, spread: 0, unknown: 0 }),
  };
  registerEditTemplateTools({
    core: fakeCore(objects), z,
    tool: (name, _d, _s, handler) => tools.set(name, handler),
  }, { build, terrain });
  const call = async (name, args) => tools.get(name)(args);
  return { call, placed, edits, dir };
}

test("capture stores locs and terrain relative to the low corner", async () => {
  const t = setup(
    [[1, 100, 200, 0, 0, 0], [2, 101, 201, 0, 10, 0], [1, 100, 200, 1, 0, 1], [1, 300, 300, 0, 0, 0]],
    { "101,201,0": { overlay: { id: 5, shape: 0, rotation: 1 }, underlay: null, height: null, flag: 4 } },
  );
  const result = await t.call("capture_template", { name: "hut", x1: 100, y1: 200, x2: 103, y2: 202 });
  assert.equal(result.objects, 3, "the loc outside the rectangle is left out");
  assert.deepEqual(result.objectsByPlane, { 0: 2, 1: 1 });
  const saved = JSON.parse(fs.readFileSync(path.join(t.dir, "hut.json"), "utf8"));
  assert.equal(saved.width, 4);
  assert.equal(saved.height, 3);
  assert.deepEqual(saved.objects[0], { id: 1, dx: 0, dy: 0, z: 0, type: 0, face: 0 });
  assert.deepEqual(saved.tiles, [{ dx: 1, dy: 1, z: 0, overlay: { id: 5, shape: 0, rotation: 1 }, underlay: null, height: null, flag: 4 }]);
  await assert.rejects(t.call("capture_template", { name: "hut", x1: 100, y1: 200, x2: 103, y2: 202 }), /exists/);
  await assert.rejects(t.call("capture_template", { name: "Bad Name", x1: 1, y1: 1, x2: 1, y2: 1 }), /lowercase/);
});

test("paste turns the template, skips interactive locs, and copies floors", async () => {
  const t = setup(
    [[1, 100, 200, 0, 0, 0], [2, 101, 201, 0, 10, 0], [3, 102, 200, 0, 10, 0]],
    { "101,201,0": { overlay: { id: 5, shape: 0, rotation: 1 }, underlay: 9, height: 40, flag: 4 | 2 | 1 } },
  );
  await t.call("capture_template", { name: "hut", x1: 100, y1: 200, x2: 103, y2: 202 });
  const plan = await t.call("paste_template", { name: "hut", x: 500, y: 500, rotation: 90, dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.equal(t.placed.length, 0);
  assert.deepEqual(plan.skippedInteractive, [{ loc: "Ladder (3)", count: 1 }]);
  assert.deepEqual(plan.bounds, { x1: 500, y1: 500, x2: 502, y2: 503 });

  const pasted = await t.call("paste_template", { name: "hut", x: 500, y: 500, rotation: 90 });
  assert.equal(pasted.placements, 2);
  // West wall at the corner turns to a north wall at the top-left; the 2x1 table at
  // 1,1 turns to 1x2 at dx 1, dy 4-1-2 = 1.
  assert.deepEqual(t.placed.map(({ id, x, y, face }) => ({ id, x, y, face })), [
    { id: 1, x: 500, y: 503, face: 1 },
    { id: 2, x: 501, y: 501, face: 1 },
  ]);
  // Floors: the overlay (turned) and the indoor flag, without the blocked/bridge bits.
  assert.deepEqual(t.edits, [
    { kind: "terrain", tileX: 501, tileY: 502, plane: 0, locId: 5, shape: 0, rotation: 2 },
    { kind: "flag", tileX: 501, tileY: 502, plane: 0, locId: 4 },
  ]);
});

test("terrain all shifts heights to baseHeight; keep places interactive locs", async () => {
  const t = setup(
    [[3, 100, 200, 0, 10, 0]],
    {
      "100,200,0": { overlay: null, underlay: 7, height: 30, flag: null },
      "101,200,0": { overlay: null, underlay: null, height: 34, flag: null },
    },
  );
  await t.call("capture_template", { name: "plot", x1: 100, y1: 200, x2: 101, y2: 200 });
  await t.call("paste_template", { name: "plot", x: 10, y: 10, terrain: "all", baseHeight: 50, interactive: "keep" });
  assert.equal(t.placed.length, 1);
  assert.deepEqual(t.edits.filter((edit) => edit.kind === "height").map((edit) => edit.locId), [50, 54]);
  assert.deepEqual(t.edits.filter((edit) => edit.kind === "underlay").map((edit) => edit.locId), [7]);
  const listed = await t.call("list_templates", {});
  assert.equal(listed.count, 1);
  assert.equal(listed.templates[0].name, "plot");
});

test("find_buildings groups roof tiles and adds a one-tile capture margin", async () => {
  const t = setup([
    [7, 10, 10, 2, 12, 0], [7, 11, 10, 2, 16, 0], [7, 11, 11, 3, 12, 0], // one roof, planes 2-3
    [7, 20, 20, 2, 12, 0],                                                // a second, apart
    [1, 15, 15, 0, 0, 0],                                                 // a wall, not a roof
  ]);
  const found = await t.call("find_buildings", { x1: 0, y1: 0, x2: 40, y2: 40 });
  assert.equal(found.count, 2);
  assert.deepEqual(found.buildings[1].roof, { x1: 10, y1: 10, x2: 11, y2: 11 });
  assert.deepEqual(found.buildings[1].capture, { x1: 9, y1: 9, x2: 12, y2: 12 });
  await assert.rejects(t.call("find_buildings", { x1: 0, y1: 0, x2: 300, y2: 10 }), /256/);
});

test("a floors paste keeps the upper planes' storey and roof gaps, but no ground heights", async () => {
  const t = setup([[1, 100, 200, 0, 0, 0]], {
    "100,200,0": { overlay: null, underlay: null, height: 30, flag: null },
    "100,200,1": { overlay: null, underlay: null, height: 37, flag: null },
    "100,200,3": { overlay: null, underlay: null, height: 12, flag: null },
  });
  await t.call("capture_template", { name: "storeys", x1: 100, y1: 200, x2: 100, y2: 200 });
  await t.call("paste_template", { name: "storeys", x: 50, y: 50 });
  assert.deepEqual(t.edits.filter((e) => e.kind === "height").map((e) => [e.plane, e.locId]), [[1, 37], [3, 12]]);
});

test("the default agent template library uses the editor's canonical bundled assets", () => {
  const previous = process.env.AGENT_MCP_TEMPLATES_DIR;
  delete process.env.AGENT_MCP_TEMPLATES_DIR;
  try {
    const { templatesDir, listTemplates, readTemplate } = require("../plugins/agent/mcp/MapTemplateFiles");
    assert.match(templatesDir(), /client[/\\]game[/\\]plugins[/\\]editmode[/\\]generation[/\\]templates$/);
    assert.deepEqual(listTemplates().map(({ name }) => name), ["varrock-house-a", "varrock-house-west", "varrock-tent"]);
    assert.equal(readTemplate("varrock-house-a").width, 8);
  } finally {
    if (previous === undefined) delete process.env.AGENT_MCP_TEMPLATES_DIR;
    else process.env.AGENT_MCP_TEMPLATES_DIR = previous;
  }
});
