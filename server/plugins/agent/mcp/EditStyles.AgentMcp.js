const { editorGenerationPath } = require("../../world/EditorGeneration");
const fs = require("fs");
const path = require("path");
const geometry = require("./EditGeometry.AgentMcp");
const { sizeOf } = require("./EditSizes.AgentMcp");

// Styles: the wall pieces one real building is made of, by role, so new structures can be
// built in that building's look. A template copies a building; a style lets a generator
// draw a new one.
//
//   capture_style - read the pieces a building uses (straight, corner, post, diagonal, door,
//                   floor) into plugins/agent/data/edit-styles.json
//   list_styles   - what has been captured
//   build_wall    - a wall in a style along a path of tile corners: city walls, palisades,
//                   enclosures (closed), with gateways and towers
//
// Roles come from what the building really uses, most common first, so a capture of
// Falador castle walls in Falador stone. Override any role when the guess is wrong.

const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_PIECES = 4000;
const ROLES = ["wall", "corner", "post", "diagonal", "door", "gate", "floor", "roof", "window"];

// Overridable for tests. Kept out of nodemon's watch (server/nodemon.json): a capture
// must not restart the server under its players.
const stylesFile = () =>
  process.env.AGENT_MCP_STYLES_FILE ?? editorGenerationPath("buildings/data/edit-styles.json");
const readStyles = () => {
  try {
    return JSON.parse(fs.readFileSync(stylesFile(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
};

const { styleNamed, diagonalJoinOf, planWall } = require(editorGenerationPath("buildings/Styles")).createStylePlanner(readStyles, sizeOf);

module.exports = function registerEditStyleTools(ctx, { build, terrain, objectsIn }) {
  const { core, tool, z } = ctx;
  const { ObjectDefinition } = core;

  const writeStyles = (styles) => {
    const names = Object.keys(styles).sort();
    const body = names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(styles[name])}`).join(",\n");
    fs.writeFileSync(stylesFile(), names.length === 0 ? "{}\n" : `{\n${body}\n}\n`);
  };
  const definitionOf = (id) => {
    try {
      return ObjectDefinition.forId(id) ?? null;
    } catch {
      return null;
    }
  };
  const nameOf = (id) => definitionOf(id)?.getName?.() ?? null;

  const mostCommon = (counts) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const tally = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);

  tool(
    "capture_style",
    "Read a building's wall pieces by role into a style for build_wall and the generators: wall (shape 0), corner (shape 2, falls back to wall), post (shape 3), diagonal (shape 9), door and gate (interactive shape-0 locs named Door/Gate), floor (most common overlay), roof (most common roof piece, any plane), window (most common wall decoration, shape 4: usually the window frames). Most common piece wins each role; pass roles to override a guess. Other shape-0 pieces come back as variants (windows, decorated walls) to assign by hand after a screenshot.",
    {
      name: z.string().describe("Style name: lowercase letters, digits, - or _"),
      x1: z.number().int(), y1: z.number().int(), x2: z.number().int(), y2: z.number().int(),
      plane: z.number().int().min(0).max(3).default(0),
      roles: z.record(z.number().int().min(0)).optional().describe("Role -> id overrides, e.g. {\"wall\": 24175}"),
      about: z.string().max(200).optional(),
    },
    ({ name, x1, y1, x2, y2, plane = 0, roles = {}, about }) => {
      if (!NAME.test(name)) throw new Error(`Style name "${name}" must be lowercase letters, digits, - or _`);
      for (const role of Object.keys(roles)) {
        if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}"; roles: ${ROLES.join(", ")}`);
      }
      const area = {
        minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2),
      };
      if ((area.maxX - area.minX + 1) * (area.maxY - area.minY + 1) > 4096) {
        throw new Error("Rectangle covers more than 4096 tiles");
      }
      const byShape = { 0: new Map(), 2: new Map(), 3: new Map(), 4: new Map(), 9: new Map() };
      const doors = new Map();
      const gates = new Map();
      for (const object of objectsIn(area, [plane])) {
        const id = object.getId();
        const type = object.getType();
        if (!(type in byShape)) continue;
        const interactive = definitionOf(id)?.hasActions?.() === true;
        const label = (nameOf(id) ?? "").toLowerCase();
        if (type === 0 && interactive && label.includes("door")) tally(doors, id);
        else if (type === 0 && interactive && label.includes("gate")) tally(gates, id);
        else if (!interactive) tally(byShape[type], id);
      }
      // Roofs sit on the planes above the walls, so look at every plane for them.
      const roofs = new Map();
      for (const object of objectsIn(area, [0, 1, 2, 3])) {
        if (object.getType() >= 12 && object.getType() <= 21) tally(roofs, object.getId());
      }
      const floors = new Map();
      for (let x = area.minX; x <= area.maxX; x++) {
        for (let y = area.minY; y <= area.maxY; y++) {
          const overlay = terrain.tileAt(x, y, plane).overlay;
          if (overlay) tally(floors, overlay.id);
        }
      }
      const wall = roles.wall ?? mostCommon(byShape[0]);
      if (wall === null) throw new Error("No straight wall pieces (shape 0) in that rectangle; pick one round a building");
      const style = {
        about: about ?? "",
        source: { x: area.minX, y: area.minY, x2: area.maxX, y2: area.maxY, plane },
        wall,
        corner: roles.corner ?? mostCommon(byShape[2]) ?? wall,
        post: roles.post ?? mostCommon(byShape[3]),
        diagonal: roles.diagonal ?? mostCommon(byShape[9]),
        door: roles.door ?? mostCommon(doors),
        gate: roles.gate ?? mostCommon(gates),
        floor: roles.floor ?? mostCommon(floors),
        roof: roles.roof ?? mostCommon(roofs),
        // Windows are usually a wall decoration (shape 4) hung on a plain wall piece, so the
        // most common decoration is the guess; check it in a screenshot.
        window: roles.window ?? mostCommon(byShape[4]),
        variants: [...byShape[0]].filter(([id]) => id !== wall).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([id, count]) => ({ id, count })),
      };
      const styles = readStyles();
      styles[name] = style;
      writeStyles(styles);
      // Pieces that will stand side by side should be about as tall as the wall: a corner or a
      // gate much taller or shorter usually means the capture picked a neighbour's piece.
      const wallSize = sizeOf(style.wall, 0);
      const sizeWarnings = [];
      for (const [role, shape] of [["corner", 2], ["post", 3], ["diagonal", 9], ["door", 0], ["gate", 0]]) {
        const size = style[role] === null || style[role] === undefined ? null : sizeOf(style[role], shape);
        if (wallSize && size && Math.abs(size.height - wallSize.height) > 48) {
          sizeWarnings.push(`${role} ${style[role]} is ${size.height} tall, the wall ${wallSize.height}`);
        }
      }
      return { name, ...style, wallSize, sizeWarnings };
    }
  );

  tool(
    "list_styles",
    "Styles captured with capture_style: the piece used for each role, and the variants seen.",
    {},
    () => {
      const styles = readStyles();
      return { count: Object.keys(styles).length, styles };
    }
  );

  tool(
    "build_wall",
    "Build a wall in a captured style along a path of tile corners ([[x, y], ...]; corner x, y is the south-west corner of tile x, y). Straight runs become wall pieces on tile edges, 45-degree runs diagonal pieces, and closed:true joins the last corner to the first (an enclosure). Many walls only have a finished face on one side: facing 'out' (default) or 'in' picks it for an enclosure, side 'left'/'right' of the walking direction for an open wall; a black wall in a screenshot is the back face, so flip it. gates are corners whose next edge stays open, with the style's gate or door hung in it (gateDoors:false leaves it open). towerEvery puts a towerSize x towerSize square of wall round every n-th corner. Live and persisted like place_objects; dryRun reports without placing.",
    {
      style: z.string().describe("Style name from list_styles"),
      points: z.array(z.array(z.number().int()).length(2)).min(2).max(200).describe("Tile corners along the wall"),
      closed: z.boolean().default(false),
      gates: z.array(z.array(z.number().int()).length(2)).max(50).default([]),
      gateDoors: z.boolean().default(true).describe("Hang the style's gate or door in each gateway"),
      towerEvery: z.number().int().min(0).max(200).default(0),
      towerSize: z.number().int().min(2).max(6).default(2),
      facing: z.enum(["out", "in"]).default("out").describe("Closed walls: finished face outward or inward"),
      side: z.enum(["left", "right"]).default("left").describe("Open walls: finished face on this side of the walking direction"),
      z: z.number().int().min(0).max(3).default(0),
      seed: z.number().int().min(0).max(2147483647).optional().describe("Vary straight pieces when the style has compatible variants"),
      dryRun: z.boolean().default(false),
    },
    ({ style: styleName, points, closed = false, gates = [], gateDoors = true, towerEvery = 0, towerSize = 2, facing = "out", side = "left", z: plane = 0, seed, dryRun = false }) => {
      const style = styleNamed(styleName);
      const plan = planWall(gateDoors ? style : { ...style, gate: null, door: null }, points,
        { closed, gates, towerEvery, towerSize, z: plane, side, facing, seed });
      if (plan.placements.length > MAX_PIECES) throw new Error(`${plan.placements.length} pieces; split the wall`);
      const xs = plan.placements.map((p) => p.x);
      const ys = plan.placements.map((p) => p.y);
      const summary = {
        style: styleName, pieces: plan.placements.length, gateways: plan.openings.length,
        bounds: xs.length === 0 ? null : { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) },
      };
      if (dryRun) return { dryRun: true, ...summary };
      return { ...summary, ...build.applyPlacements(plan.placements) };
    }
  );

  return { styleNamed, planWall };
};

module.exports.readStyles = readStyles;
module.exports.styleNamed = styleNamed;
module.exports.planWall = planWall;
module.exports.diagonalJoinOf = diagonalJoinOf;
