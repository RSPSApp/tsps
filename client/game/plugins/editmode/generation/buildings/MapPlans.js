const defaultCatalog = require("./data/edit-presets.json");
const defaultStyles = require("./data/edit-styles.json");
const { planPreset } = require("./Presets");
const { footprint } = require("./Geometry");
const { createStylePlanner } = require("./Styles");
const { createGeneratorPlans } = require("./Generators");
const { RECIPES, INTERIORS, EXTERIORS, MAX_SEED, styleRoles } = require("./StructureRecipes");
const { sizeOf: defaultSizeOf } = require("./ModelSizes");

function catalog(options = {}) {
  const readCatalog = options.readCatalog ?? (() => defaultCatalog);
  const readStyles = options.readStyles ?? (() => defaultStyles);
  const { diagonalJoinOf } = createStylePlanner(readStyles, options.sizeOf ?? defaultSizeOf);
  return {
    presets: Object.entries(readCatalog().presets).map(([name, preset]) => ({ name, about: preset.about })),
    styles: Object.entries(readStyles()).map(([name, style]) => ({
      name, label: style.label ?? name, about: style.about, roles: styleRoles(style),
      wall: style.wall, corner: style.corner ?? style.wall,
      diagonal: style.diagonal ?? null, diagonalJoin: diagonalJoinOf(style), gate: style.gate ?? style.door ?? null, roof: Boolean(style.roof),
      ...(style.wallVariants?.length ? { variants: style.wallVariants } : {}),
    })),
    generators: RECIPES,
    interiors: INTERIORS,
    exteriors: EXTERIORS,
  };
}

function integer(query, key, min, max, fallback) {
  const value = Number(query.get(key) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
  return value;
}

function preview(query, objectInfo, options = {}) {
  const readCatalog = options.readCatalog ?? (() => defaultCatalog);
  const readStyles = options.readStyles ?? (() => defaultStyles);
  const sizeOf = options.sizeOf ?? defaultSizeOf;
  const { styleNamed, planWall } = createStylePlanner(readStyles, sizeOf);
  const core = {
    ObjectDefinition: {
      forId(id) {
        const info = objectInfo?.(id);
        return { getSizeX: () => info?.sizeX ?? 1, getSizeY: () => info?.sizeY ?? 1 };
      },
    },
  };
  const name = query.get("name") ?? "";
  if (!/^[a-z][a-z0-9_-]{0,48}$/.test(name)) throw new Error("Choose a generator");
  const x = 4096;
  const y = 4096;
  let edits = [];
  let placements;
  let summary;
  let foundation = true;
  if (RECIPES.some((entry) => entry.name === name)) {
    const style = query.get("style") || undefined;
    if (style && !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(style)) throw new Error("Choose a captured style");
    const crop = query.get("crop") || "wheat";
    if (!["wheat", "cabbage", "potato"].includes(crop)) throw new Error("Choose a crop");
    const plans = createGeneratorPlans(core, null, { styleNamed, planWall }, { readSets: options.readSets, sizeOf });
    const plan = plans.structure({
      name, x, y, style, crop, flatten: false, entrance: query.get("entrance") || undefined,
      width: query.has("width") ? integer(query, "width", 4, 48) : undefined,
      height: query.has("height") ? integer(query, "height", 4, 48) : undefined,
      storeys: integer(query, "storeys", 1, 2, 1),
      seed: query.has("seed") ? integer(query, "seed", 0, MAX_SEED) : undefined,
      interior: query.get("interior") || undefined,
      exterior: query.get("exterior") || undefined,
    });
    ({ placements, edits, summary } = plan);
    foundation = plan.foundation ?? (name !== "farm" && name !== "graveyard");
  } else {
    const source = readCatalog();
    if (!Object.hasOwn(source.presets, name)) throw new Error("Unknown construction preset");
    placements = planPreset(source.presets[name], x, y, 0, {}, source);
  }
  const floorEdits = edits.filter((edit) => edit.kind !== "height");
  const xs = floorEdits.map((edit) => edit.tileX);
  const ys = floorEdits.map((edit) => edit.tileY);
  if (summary?.seed !== undefined) {
    xs.push(summary.bounds.x1, summary.bounds.x2);
    ys.push(summary.bounds.y1, summary.bounds.y2);
  }
  for (const placement of placements) {
    const def = core.ObjectDefinition.forId(placement.id);
    const size = footprint(placement.type, placement.face, def?.getSizeX?.() ?? 1, def?.getSizeY?.() ?? 1);
    xs.push(placement.x, placement.x + size.width - 1);
    ys.push(placement.y, placement.y + size.height - 1);
  }
  const originX = Math.min(...xs), originY = Math.min(...ys);
  const records = new Map();
  for (const { kind, tileX, tileY, plane, locId, shape, rotation } of edits) {
    const key = `${tileX},${tileY},${plane}`;
    const tile = records.get(key) ?? { dx: tileX - originX, dy: tileY - originY, z: plane };
    if (kind === "terrain") tile.overlay = { id: locId, shape, rotation };
    if (kind === "flag") tile.flag = locId;
    if (kind === "height") tile.height = locId;
    records.set(key, tile);
  }
  return {
    name,
    foundation,
    ...(summary ? { summary } : {}),
    source: { x: originX, y: originY },
    width: Math.max(...xs) - originX + 1,
    height: Math.max(...ys) - originY + 1,
    objects: placements.map(({ x, y, ...loc }) => ({ ...loc, dx: x - originX, dy: y - originY })),
    tiles: [...records.values()],
  };
}

module.exports = { catalog, preview };
