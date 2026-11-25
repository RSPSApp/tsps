// Generators (plugins/agent/mcp/EditGenerators.AgentMcp.js) and the hip roof rule, against
// fake stores. Run: node --test tests/edit-generator-mcp.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");

const geometry = require("../plugins/agent/mcp/EditGeometry.AgentMcp");
const registerEditGeneratorTools = require("../plugins/agent/mcp/EditGenerators.AgentMcp");
const registerEditStyleTools = require("../plugins/agent/mcp/EditStyles.AgentMcp");

test("the hip roof reproduces a Varrock house roof", () => {
  // varrock-house-a (8x7, roof on planes 2-3): eaves ring, a slope ring on plane 2, a slope
  // ring and two flat tops on plane 3.
  const roof = geometry.hipRoof(0, 0, 8, 7, { plane: 2 });
  const at = (x, y, plane) => roof.find((p) => p.x === x && p.y === y && p.z === plane);
  assert.deepEqual([at(0, 0, 2).type, at(0, 0, 2).face], [19, 1]);
  assert.deepEqual([at(7, 6, 2).type, at(7, 6, 2).face], [19, 3]);
  assert.deepEqual([at(3, 0, 2).type, at(3, 0, 2).face], [18, 1]);
  assert.deepEqual([at(1, 1, 2).type, at(1, 1, 2).face], [16, 1]);
  assert.deepEqual([at(6, 3, 2).type, at(6, 3, 2).face], [12, 0]);
  assert.deepEqual([at(2, 4, 3).type, at(2, 4, 3).face], [16, 2]);
  assert.deepEqual(roof.filter((p) => p.type === 17).map((p) => [p.x, p.y, p.z]), [[3, 3, 3], [4, 3, 3]]);
  assert.equal(roof.length, 26 + 18 + 10 + 2);
  // varrock-house-west's roof: no eaves, one slope ring and a 3x1 ridge on one plane.
  const small = geometry.hipRoof(0, 0, 5, 3, { plane: 2, eaves: false });
  assert.ok(small.every((p) => p.z === 2));
  assert.equal(small.filter((p) => p.type === 17).length, 3);
});

function setup() {
  process.env.AGENT_MCP_STYLES_FILE = require("node:path").join(
    require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "edit-gen-")), "styles.json");
  require("node:fs").writeFileSync(process.env.AGENT_MCP_STYLES_FILE, JSON.stringify({
    town: { wall: 10, corner: 10, door: 12, gate: null, roof: 20, window: 30, variants: [] },
    fence: { wall: 40, corner: 40, door: null, gate: 41, roof: null, window: null, variants: [] },
  }));
  const tools = new Map();
  const placed = [];
  const edits = [];
  const build = { applyPlacements: (list) => { placed.push(...list); return { placed: list.length }; } };
  // Ground rising 2 per tile eastward, so levelling has something to do.
  const heightAt = (x) => 30 + 2 * (x - 100);
  const terrain = {
    applyEdits: (list) => { edits.push(...list); return { regions: [] }; },
    tileAt: (x) => ({ height: heightAt(x) }),
    levelEdits: (x0, y0, x1, y1, options) => {
      const plan = geometry.levelPlan((x) => heightAt(x), x0, y0, x1, y1, options);
      return { ...plan, edits: plan.tiles.map((t) => ({ kind: "height", tileX: t.x, tileY: t.y, plane: 0, locId: t.height })) };
    },
  };
  const ctx = { core: { ObjectDefinition: { forId: () => null } }, z, tool: (name, _d, _s, handler) => tools.set(name, handler) };
  const styles = registerEditStyleTools(ctx, { build, terrain, objectsIn: () => [] });
  registerEditGeneratorTools(ctx, { build, terrain, styles });
  return { call: async (name, args) => tools.get(name)(args), placed, edits };
}

test("build_house: walls round the inside, a door, windows, floors, flags and a roof", async () => {
  const t = setup();
  const result = await t.call("build_house", { style: "town", x: 100, y: 100, width: 6, height: 5, storeys: 2, door: "south" });
  assert.equal(result.roof, true);
  const level = (n) => t.placed.filter((p) => p.z === n && p.type <= 4);
  // Ground floor: the wall ring with one door; upstairs the same ring without it.
  assert.equal(level(0).filter((p) => p.id === 12).length, 1, "one door downstairs");
  assert.equal(level(1).filter((p) => p.id === 12).length, 0, "no door upstairs");
  assert.ok(level(0).every((p) => p.x >= 100 && p.x <= 105 && p.y >= 100 && p.y <= 104));
  assert.ok(result.windows > 0);
  // The roof starts above the top storey.
  assert.ok(t.placed.filter((p) => p.id === 20).every((p) => p.z >= 2));
  // Indoor tiles: floor and indoor flag on both storeys; the roof plane carries the roof flag.
  assert.equal(t.edits.filter((e) => e.kind === "terrain" && e.plane === 0).length, 4 * 3);
  assert.equal(t.edits.filter((e) => e.kind === "flag" && e.plane === 2 && e.locId === 16).length, 6 * 5);
  // Storeys stand on the walls and roof rings on each other: upper planes get their gaps
  // (no sizes file here, so the defaults: 296 / 8 for walls, 96 / 8 for slopes).
  const gap = (plane) => [...new Set(t.edits.filter((e) => e.kind === "height" && e.plane === plane).map((e) => e.locId))];
  assert.deepEqual([gap(1), gap(2), gap(3)], [[37], [37], [12]]);
  assert.equal(t.edits.filter((e) => e.kind === "height" && e.plane === 1).length, 7 * 6, "footprint plus the corner row and column");
  assert.equal(t.placed.filter((p) => p.type === 1 && p.z === 0).length, 4, "four corner pieces");
  const dry = await t.call("build_house", { style: "town", x: 0, y: 0, width: 4, height: 4, dryRun: true });
  assert.equal(dry.dryRun, true);
});

test("build_graveyard and build_farm: an enclosure with a gate, filled from the sets", async () => {
  const t = setup();
  const yard = await t.call("build_graveyard", { style: "fence", x: 10, y: 10, width: 9, height: 8 });
  assert.ok(yard.stones >= 6);
  assert.equal(t.placed.filter((p) => p.id === 41).length, 1, "the fence's gate hangs in the gateway");
  assert.ok(t.edits.every((e) => e.tileX === 14), "the path runs up the middle from the south gate");
  t.placed.length = 0;
  await t.call("build_farm", { style: "fence", x: 30, y: 30, width: 7, height: 6, crop: "cabbage" });
  assert.ok(t.placed.filter((p) => p.id === 1161).length >= 15);
  assert.ok(t.placed.some((p) => p.id === 297), "a scarecrow");
  await assert.rejects(t.call("build_farm", { style: "fence", x: 30, y: 30, width: 7, height: 6, crop: "melon" }), /Unknown crop/);
});

test("the footprint and the corners its walls stand on are levelled, the edge blended", () => {
  const slope = (x) => 30 + 2 * x;
  const plan = geometry.levelPlan((x) => slope(x), 0, 0, 4, 3, { blend: 2 });
  assert.equal(plan.level, 36, "the median over x 0-5 (the footprint and its east corners)");
  const at = (x, y) => plan.tiles.find((t) => t.x === x && t.y === y).height;
  for (let x = 0; x <= 5; x++) assert.equal(at(x, 2), 36);
  assert.equal(at(4, 4), 36, "the row north of the footprint carries its north walls' corners");
  assert.deepEqual([at(-1, 2), at(-2, 2), at(6, 2), at(7, 2)], [33, 29, 38, 41], "a third, then two thirds of the way back");
  const flat = geometry.levelPlan(() => null, 0, 0, 2, 2);
  assert.equal(flat.level, null, "no stored heights: nothing to level against");
});

test("build_house levels its footprint by default; the yard and farm only when asked", async () => {
  const t = setup();
  const house = await t.call("build_house", { style: "town", x: 100, y: 100, width: 5, height: 5 });
  assert.equal(house.flatten.level, 36, "the median of columns 30-40");
  assert.ok(t.edits.filter((e) => e.kind === "height").length > 25);
  t.edits.length = 0;
  const yard = await t.call("build_graveyard", { style: "fence", x: 100, y: 100, width: 6, height: 6 });
  assert.equal(yard.flatten, undefined);
  assert.equal(t.edits.filter((e) => e.kind === "height").length, 0);
  const steep = await t.call("build_house", { style: "town", x: 100, y: 100, width: 12, height: 5, dryRun: true });
  assert.match(steep.flatten.note, /Steep ground/);
});

test("levelling leaves a neighbour's ground alone", () => {
  const slope = (x) => 30 + 2 * x;
  // A building already stands on x 7-9: those tiles are kept.
  const plan = geometry.levelPlan((x) => slope(x), 0, 0, 4, 3, { blend: 2, keep: (x) => x >= 7 });
  assert.ok(!plan.tiles.some((t) => t.x >= 7), "nothing on the neighbour moves");
  assert.ok(plan.tiles.some((t) => t.x === 6), "the free ring still blends");
});

test("furniture keeps a corridor from the door, faces away from walls, and turns its footprint", () => {
  const plan = geometry.furnishPlan(
    { x0: 0, y0: 0, x1: 4, y1: 3, door: "south", doorX: 2, doorY: 0, ladder: 99 },
    [{ id: 1, place: "wall", size: [1, 2] }, { id: 2, place: "centre", chairs: [3, 3] }, { id: 4, place: "corner" }],
  );
  assert.ok(!plan.placed.some((p) => p.x === 2), "nothing stands in the corridor up from the door");
  const ladder = plan.placed.find((p) => p.role === "ladder");
  assert.equal(ladder.y, 3, "the ladder is at the corridor's far end");
  assert.equal(Math.abs(ladder.x - 2), 1);
  assert.equal(ladder.face, ladder.x < 2 ? 1 : 3, "its usable side faces the corridor");
  const range = plan.placed.find((p) => p.id === 1);
  // The north wall has no room left (ladder, corridor, a corner kept for corner pieces), so it
  // stands against the east wall, facing away from it, its 1x2 footprint along the wall.
  assert.deepEqual([range.x, range.y, range.face], [4, 1, 0]);
  const table = plan.placed.find((p) => p.id === 2);
  const chairs = plan.placed.filter((p) => p.id === 3);
  assert.deepEqual(chairs.map(({ x, y, face }) => [x - table.x, y - table.y, face]), [[0, -1, 2], [0, 1, 0]]);
});

test("a two-storey house gets a ladder pair on one tile and furniture on both floors", async () => {
  const t = setup();
  const house = await t.call("build_house", { style: "town", x: 200, y: 200, width: 7, height: 6, storeys: 2, door: "south" });
  const up = t.placed.find((p) => p.id === 11794);
  const down = t.placed.find((p) => p.id === 11802);
  assert.deepEqual([up.x, up.y, up.z], [down.x, down.y, 0].map((v, i) => (i === 2 ? 0 : v)));
  assert.equal(down.z, 1);
  assert.ok(house.furniture >= 8);
  assert.ok(t.placed.some((p) => p.id === 7190 && p.z === 1), "the bed is upstairs");
  t.placed.length = 0;
  await t.call("build_house", { style: "town", x: 300, y: 300, width: 7, height: 6, furnish: false });
  assert.ok(!t.placed.some((p) => p.type === 10), "furnish: false leaves the shell empty");
});
