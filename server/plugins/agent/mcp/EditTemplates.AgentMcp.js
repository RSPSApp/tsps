const fs = require("fs");
const geometry = require("./EditGeometry.AgentMcp");
const { templatesDir, templateFile, readTemplate, listTemplates } = require("./MapTemplateFiles");

// Templates: copy a structure that already stands in the world (a Varrock house, a
// Falador tower) and paste it anywhere, turned in quarter turns.
//
// The game's own buildings already get the hard parts right - corners that join, door
// frames, roofs, floor paint - so a captured building looks right wherever it is pasted,
// where a hand-made layout needs a screenshot round trip per mistake.
//
//   find_buildings   - roofed buildings in an area, as rectangles ready to capture
//   capture_template - read the locs (all planes) and terrain in a rectangle into a file
//   list_templates   - what has been captured
//   paste_template   - place a template at a tile, rotated; dryRun reports without placing
//
// Templates are data in plugins/agent/data/templates/<name>.json, one file each, so a good
// capture can be committed and reused like a preset.

const MAX_TILES = 4096;
// Tile flags kept in a pasted floor. 1 marks the tile blocked and 2 links it to the plane
// below (bridges); both describe the place it was captured from, not the new one.
const KEPT_FLAGS = ~3;

/** One loc or tile per line: compact, and a recapture diffs line by line. */
function serialize(template) {
  const fields = Object.entries(template).map(([key, value]) => {
    if (!Array.isArray(value)) return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    if (value.length === 0) return `  ${JSON.stringify(key)}: []`;
    return `  ${JSON.stringify(key)}: [\n${value.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n")}\n  ]`;
  });
  return `{\n${fields.join(",\n")}\n}\n`;
}

module.exports = function registerEditTemplateTools(ctx, { build, terrain }) {
  const { core, tool, z } = ctx;
  const { MapObjects, ObjectDefinition, RegionManager } = core;

  const definitionOf = (id) => {
    try {
      return ObjectDefinition.forId(id) ?? null;
    } catch {
      return null;
    }
  };
  const isInteractive = (id) => definitionOf(id)?.hasActions?.() === true;
  const sizeOf = (id) => {
    const definition = definitionOf(id);
    return { sizeX: definition?.getSizeX?.() ?? 1, sizeY: definition?.getSizeY?.() ?? 1 };
  };

  const rect = (x1, y1, x2, y2) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (const [name, value] of [["x1", minX], ["x2", maxX], ["y1", minY], ["y2", maxY]]) {
      if (!Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error(`Tile ${name}=${value} is outside the world (0-16383)`);
      }
    }
    const tiles = (maxX - minX + 1) * (maxY - minY + 1);
    if (tiles > MAX_TILES) throw new Error(`Rectangle covers ${tiles} tiles; split it under ${MAX_TILES}`);
    return { minX, maxX, minY, maxY };
  };

  /** Everything standing in the rectangle, on the given planes: cache locs and placed ones alike. */
  const objectsIn = ({ minX, maxX, minY, maxY }, planes) => {
    // Regions load lazily; an unvisited one has no MapObjects yet.
    for (let x = minX; x <= maxX + 63; x += 64) {
      for (let y = minY; y <= maxY + 63; y += 64) RegionManager?.loadMapFiles?.(Math.min(x, maxX), Math.min(y, maxY), false);
    }
    const seen = new Set();
    const found = [];
    for (const plane of planes) {
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, plane)) ?? []) {
            if (object.getOwner?.() || object.getPrivateArea?.()) continue;
            const at = object.getLocation();
            const key = `${object.getId()}:${object.getType()}:${at.getX()},${at.getY()},${at.getZ()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push(object);
          }
        }
      }
    }
    return found;
  };

  tool(
    "find_buildings",
    "Find roofed buildings in an area: connected tiles with roof pieces (shapes 12-21, any plane), each reported as its roof outline and that outline grown by one tile, the rectangle to pass to capture_template (walls often sit on the tile just outside the roof, and a building can share a wall with its neighbour or a city wall, which the margin then pulls in). Largest area 256x256.",
    {
      x1: z.number().int().describe("Area corner x"),
      y1: z.number().int().describe("Area corner y"),
      x2: z.number().int().describe("Opposite corner x"),
      y2: z.number().int().describe("Opposite corner y"),
    },
    ({ x1, y1, x2, y2 }) => {
      const area = { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2) };
      rect(area.minX, area.minY, area.minX, area.minY);
      rect(area.maxX, area.maxY, area.maxX, area.maxY);
      if (area.maxX - area.minX >= 256 || area.maxY - area.minY >= 256) throw new Error("Area is larger than 256x256");
      const roofs = new Set();
      for (const object of objectsIn(area, [0, 1, 2, 3])) {
        if (object.getType() < 12 || object.getType() > 21) continue;
        const at = object.getLocation();
        roofs.add(`${at.getX()},${at.getY()}`);
      }
      const seen = new Set();
      const buildings = [];
      for (const start of roofs) {
        if (seen.has(start)) continue;
        seen.add(start);
        const stack = [start];
        let [minX, minY] = start.split(",").map(Number);
        let [maxX, maxY] = [minX, minY];
        let tiles = 0;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop().split(",").map(Number);
          tiles++;
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const next = `${cx + dx},${cy + dy}`;
            if (roofs.has(next) && !seen.has(next)) {
              seen.add(next);
              stack.push(next);
            }
          }
        }
        buildings.push({
          roof: { x1: minX, y1: minY, x2: maxX, y2: maxY },
          capture: { x1: minX - 1, y1: minY - 1, x2: maxX + 1, y2: maxY + 1 },
          width: maxX - minX + 1, height: maxY - minY + 1, roofTiles: tiles,
        });
      }
      buildings.sort((a, b) => a.width * a.height - b.width * b.height);
      return { count: buildings.length, buildings: buildings.slice(0, 50) };
    }
  );

  tool(
    "capture_template",
    "Copy a structure that stands in the world into a reusable template: every loc in the rectangle on the chosen planes (cache scenery and placed objects alike), plus its terrain (floor overlays, underlays, heights, flags) unless terrain is false. Saved as plugins/agent/data/templates/<name>.json; paste_template places it anywhere, rotated. Draw the rectangle tight round one building so neighbours and loose scenery stay out.",
    {
      name: z.string().describe("Template name: lowercase letters, digits, - or _"),
      x1: z.number().int().describe("Rectangle corner x"),
      y1: z.number().int().describe("Rectangle corner y"),
      x2: z.number().int().describe("Opposite corner x"),
      y2: z.number().int().describe("Opposite corner y"),
      planes: z.array(z.number().int().min(0).max(3)).min(1).max(4).default([0, 1, 2, 3]).describe("Planes to copy"),
      terrain: z.boolean().default(true).describe("Also copy floor overlays, underlays, heights and flags"),
      about: z.string().max(200).optional().describe("One line on what this is"),
      overwrite: z.boolean().default(false).describe("Replace an existing template of this name"),
    },
    ({ name, x1, y1, x2, y2, planes = [0, 1, 2, 3], terrain: withTerrain = true, about, overwrite = false }) => {
      const file = templateFile(name);
      if (fs.existsSync(file) && !overwrite) {
        throw new Error(`Template "${name}" exists; pass overwrite:true to replace it`);
      }
      const area = rect(x1, y1, x2, y2);
      const objects = objectsIn(area, planes).map((object) => {
        const at = object.getLocation();
        return {
          id: object.getId(), dx: at.getX() - area.minX, dy: at.getY() - area.minY, z: at.getZ(),
          type: object.getType(), face: object.getFace(),
        };
      }).sort((a, b) => a.z - b.z || a.dy - b.dy || a.dx - b.dx || a.type - b.type);

      const tiles = [];
      if (withTerrain) {
        for (const plane of planes) {
          for (let x = area.minX; x <= area.maxX; x++) {
            for (let y = area.minY; y <= area.maxY; y++) {
              const tile = terrain.tileAt(x, y, plane);
              if (!tile.overlay && tile.underlay === null && tile.height === null && tile.flag === null) continue;
              tiles.push({ dx: x - area.minX, dy: y - area.minY, z: plane, ...tile });
            }
          }
        }
      }
      const origin = withTerrain ? terrain.tileAt(area.minX, area.minY, 0).height : null;
      const template = {
        name,
        about: about ?? "",
        source: { x: area.minX, y: area.minY, planes },
        width: area.maxX - area.minX + 1,
        height: area.maxY - area.minY + 1,
        originHeight: origin,
        objects,
        tiles,
      };
      fs.mkdirSync(templatesDir(), { recursive: true });
      fs.writeFileSync(file, serialize(template));

      const byPlane = {};
      for (const object of objects) byPlane[object.z] = (byPlane[object.z] ?? 0) + 1;
      const interactive = [...new Set(objects.filter((object) => isInteractive(object.id))
        .map((object) => `${definitionOf(object.id)?.getName?.() ?? "?"} (${object.id})`))];
      return {
        name, file, width: template.width, height: template.height,
        objects: objects.length, objectsByPlane: byPlane, tiles: tiles.length,
        interactive: interactive.slice(0, 20),
      };
    }
  );

  tool(
    "list_templates",
    "Templates captured with capture_template: name, about, size, and how many locs and terrain tiles each holds.",
    {},
    () => {
      const templates = listTemplates();
      return { count: templates.length, templates };
    }
  );

  /**
   * Turns a template into placements and terrain edits at (x, y): rotation in quarter
   * turns clockwise, interactive locs left out unless asked for (a copied ladder or door
   * keeps handlers written for the place it was captured from).
   */
  const planPaste = (template, { x, y, plane, rotation, interactive, terrainMode, baseHeight }) => {
    if (rotation % 90 !== 0) throw new Error(`Rotation ${rotation} must be a multiple of 90`);
    const turns = (((rotation / 90) % 4) + 4) % 4;
    const { width, height } = template;
    const placements = [];
    const skipped = new Map();
    for (const object of template.objects) {
      if (interactive === "skip" && isInteractive(object.id)) {
        const label = `${definitionOf(object.id)?.getName?.() ?? "?"} (${object.id})`;
        skipped.set(label, (skipped.get(label) ?? 0) + 1);
        continue;
      }
      const { sizeX, sizeY } = sizeOf(object.id);
      const turned = geometry.rotateLoc(object, turns, width, height, sizeX, sizeY);
      const level = object.z + plane;
      if (level > 3) continue;
      placements.push({ id: object.id, x: x + turned.dx, y: y + turned.dy, z: level, type: object.type, face: turned.face });
    }

    const edits = [];
    if (terrainMode !== "none") {
      const shift = terrainMode === "all" && baseHeight !== undefined && template.originHeight !== null
        ? baseHeight - template.originHeight : 0;
      for (const tile of template.tiles) {
        const { dx, dy } = geometry.rotateOffset(tile.dx, tile.dy, turns, width, height);
        const at = { tileX: x + dx, tileY: y + dy, plane: tile.z + plane };
        if (at.plane > 3) continue;
        if (tile.overlay) {
          edits.push({
            kind: "terrain", ...at, locId: tile.overlay.id, shape: tile.overlay.shape,
            rotation: (tile.overlay.rotation + turns) & 3,
          });
        }
        const flag = (tile.flag ?? 0) & KEPT_FLAGS;
        if (flag > 0) edits.push({ kind: "flag", ...at, locId: flag });
        // On an upper plane a stored height is the gap above the plane below (a house's storey
        // and roof-ring heights), not a ground height: it belongs to the building, so it always
        // comes along. Without it storeys and roof rings sit 240 apart and come loose.
        if (terrainMode !== "all" && tile.z > 0 && tile.height !== null) {
          edits.push({ kind: "height", ...at, locId: tile.height });
        }
        if (terrainMode === "all") {
          if (tile.underlay !== null) edits.push({ kind: "underlay", ...at, locId: tile.underlay });
          if (tile.height !== null) {
            edits.push({ kind: "height", ...at, locId: Math.max(0, Math.min(255, tile.height + shift)) });
          }
        }
      }
    }
    const turnedWidth = turns % 2 === 1 ? height : width;
    const turnedHeight = turns % 2 === 1 ? width : height;
    return {
      placements, edits,
      skippedInteractive: [...skipped].map(([loc, count]) => ({ loc, count })),
      bounds: { x1: x, y1: y, x2: x + turnedWidth - 1, y2: y + turnedHeight - 1 },
    };
  };

  tool(
    "paste_template",
    "Place a captured template with its low corner at (x, y), turned clockwise by rotation (0/90/180/270). Locs go live and persist like place_objects; terrain 'floors' (default) copies floor overlays, roof/indoor tile flags and the upper planes' storey and roof heights, 'all' also underlays and heights (shifted so the template's corner sits at baseHeight when given), 'none' skips terrain; flatten (default on) levels the footprint first so walls stand even on uneven ground. Interactive locs (doors, ladders, stairs, banks) are skipped by default: their handlers belong to the place they were captured from. dryRun reports without placing.",
    {
      name: z.string().describe("Template name from list_templates"),
      x: z.number().int().describe("Low-corner tile x"),
      y: z.number().int().describe("Low-corner tile y"),
      plane: z.number().int().min(0).max(3).default(0).describe("Plane offset: 0 keeps the template's planes"),
      rotation: z.number().int().min(-270).max(270).default(0),
      interactive: z.enum(["skip", "keep"]).default("skip").describe("Leave out interactive locs (default) or keep them"),
      terrain: z.enum(["floors", "all", "none"]).default("floors"),
      baseHeight: z.number().int().min(0).max(255).optional().describe("With terrain 'all': height of the template's corner tile"),
      flatten: z.boolean().default(true).describe("Level the footprint first and blend its edge (not with terrain 'all', which brings its own heights)"),
      dryRun: z.boolean().default(false),
    },
    ({ name, x, y, plane = 0, rotation = 0, interactive = "skip", terrain: terrainMode = "floors", baseHeight, flatten = true, dryRun = false }) => {
      const template = readTemplate(name);
      rect(x, y, x, y);
      const plan = planPaste(template, { x, y, plane, rotation, interactive, terrainMode, baseHeight });
      // Walls stand on the ground under their corners: on uneven ground a pasted building's
      // walls come out at different heights, so level the footprint first.
      let level = null;
      if (flatten && terrainMode !== "all") {
        const { x1, y1, x2, y2 } = plan.bounds;
        const levelling = terrain.levelEdits(x1, y1, x2, y2, { blend: 2, plane });
        plan.edits.unshift(...levelling.edits);
        level = { level: levelling.level, tilesChanged: levelling.moved, spread: levelling.spread };
        if (levelling.level === null) level.note = "No stored heights under the footprint; left as it is";
      }
      const summary = {
        name, rotation, bounds: plan.bounds, placements: plan.placements.length,
        terrainEdits: plan.edits.length, skippedInteractive: plan.skippedInteractive,
        ...(level ? { flatten: level } : {}),
      };
      if (dryRun) return { dryRun: true, ...summary };
      // Terrain first: a region over the packet budget fails here, before any loc stands.
      const terrainResult = plan.edits.length > 0 ? terrain.applyEdits(plan.edits, `template ${name}`) : null;
      const placed = build.applyPlacements(plan.placements);
      return {
        ...summary, ...placed,
        regions: terrainResult?.regions.map((region) => ({ regionId: region.regionId, terrainBytes: region.terrainBytes })) ?? [],
      };
    }
  );

  // Styles read buildings through the same region-loading object scan.
  return { objectsIn };
};
