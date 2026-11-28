const geometry = require("./Geometry");

/**
 * "$name" reads params.name, "-$name" reads it negated. Only whole-value references are
 * supported: presets describe offsets, they do not run expressions.
 */
function resolveValue(value, params) {
  if (typeof value === "string") {
    const match = /^([+-]?)\$([A-Za-z0-9_]+)$/.exec(value);
    if (match) {
      const [, sign, key] = match;
      if (!(key in params)) throw new Error(`Unknown parameter "${key}"`);
      const resolved = params[key];
      if (sign !== "-") return resolved;
      const number = Number(resolved);
      if (!Number.isFinite(number)) throw new Error(`Cannot negate the non-number parameter "${key}"`);
      return -number;
    }
  }
  return value;
}

const numeric = (value, params, fallback) => {
  const resolved = resolveValue(value, params);
  if (resolved === undefined) return fallback;
  const number = Number(resolved);
  if (!Number.isFinite(number)) throw new Error(`Expected a number, got ${JSON.stringify(resolved)}`);
  return Math.round(number);
};

/**
 * Turns one preset part into the tiles it covers, in world coordinates.
 * `originX/originY` is where the preset was anchored; part offsets are relative to it.
 */
function expandPart(part, originX, originY, params, rotation) {
  const shape = part.shape;
  const ox = numeric(part.x, params, 0);
  const oy = numeric(part.y, params, 0);
  let tiles;
  switch (shape) {
    case "box": {
      const width = numeric(part.width, params, 3);
      const height = numeric(part.height, params, 3);
      const grow = numeric(part.grow, params, 0);
      const growHalf = Math.floor(grow / 2);
      tiles = geometry.box(
        originX + ox - growHalf, originY + oy - growHalf,
        originX + ox + width - 1 + (grow - growHalf), originY + oy + height - 1 + (grow - growHalf),
        { doorSide: part.doorSide ? resolveValue(part.doorSide, params) : undefined, doorWidth: numeric(part.doorWidth, params, 1) },
      );
      break;
    }
    case "ring": {
      const radius = numeric(part.radius, params, 10);
      tiles = geometry.ring(
        originX + ox, originY + oy, radius,
        {
          thickness: numeric(part.thickness, params, 1),
          gapDegrees: numeric(part.gapDegrees, params, 0),
          gapAngle: numeric(part.gapAngle, params, 0),
        },
      );
      break;
    }
    case "tower": {
      const width = numeric(part.width, params, 2);
      const height = numeric(part.height, params, width);
      tiles = geometry.tower(originX + ox, originY + oy, width, { height });
      break;
    }
    case "line": {
      tiles = geometry.line(
        originX + numeric(part.x1, params, 0), originY + numeric(part.y1, params, 0),
        originX + numeric(part.x2, params, 0), originY + numeric(part.y2, params, 0),
      );
      break;
    }
    case "avenue": {
      tiles = geometry.avenue(
        originX + numeric(part.x1, params, 0), originY + numeric(part.y1, params, 0),
        originX + numeric(part.x2, params, 0), originY + numeric(part.y2, params, 0),
        { offset: numeric(part.offset, params, 3), spacing: numeric(part.spacing, params, 4) },
      );
      break;
    }
    case "repeated": {
      tiles = geometry.repeated(
        originX + numeric(part.x1, params, 0), originY + numeric(part.y1, params, 0),
        originX + numeric(part.x2, params, 0), originY + numeric(part.y2, params, 0),
        numeric(part.spacing, params, 4),
      );
      break;
    }
    case "column": {
      tiles = [{
        x: originX + numeric(part.dx, params, 0),
        y: originY + numeric(part.dy, params, 0),
      }];
      break;
    }
    default:
      throw new Error(`Unknown shape "${shape}"`);
  }
  if (rotation) tiles = geometry.rotate(tiles, rotation, originX, originY);
  return tiles;
}

/**
 * A tile holds one object per type, so two parts placing on the same tile and type
 * leave only the later one standing. Collapse them here, keeping the later part, so
 * the counts are true and the spawn file does not keep the hidden one to bring back
 * on the next load.
 */
function collapseOverlaps(placements) {
  const byTile = new Map();
  for (const item of placements) {
    const tile = `${item.x},${item.y},${item.z ?? 0},${item.type ?? 10}`;
    byTile.delete(tile);
    byTile.set(tile, item);
  }
  return { placements: [...byTile.values()], overlapped: placements.length - byTile.size };
}

/** Builds a placement list from a preset/shape description without touching the world. */
const planParts = (parts, { originX, originY, params, rotation, catalog }) => {
  const placements = [];
  const materials = catalog?.materials ?? {};
  const materialId = (name) => {
    const key = resolveValue(name, params);
    const entry = materials[key];
    if (entry) return entry.id;
    const numericId = Number(key);
    if (Number.isInteger(numericId)) return numericId;
    throw new Error(`Unknown material "${key}"; known: ${Object.keys(materials).join(", ")}`);
  };
  for (const part of parts) {
    const id = materialId(part.material);
    const tiles = expandPart(part, originX, originY, params, rotation);
    for (const tile of tiles) {
      placements.push({
        id,
        x: tile.x,
        y: tile.y,
        z: numeric(part.z, params, 0),
        type: numeric(part.type, params, 10),
        face: part.face !== undefined ? numeric(part.face, params, 0)
          : geometry.facingFor(originX, originY, tile.x, tile.y),
      });
    }
  }
  return placements;
};

/**
 * Expands a preset into placements. A preset with `repeat` runs once per value of
 * the named parameter - tiered_city repeats its ring/tower parts per radius.
 */
const planPreset = (entry, x, y, rotation, params, catalog) => {
  const merged = { ...(entry.params ?? {}), ...params };
  const repeatKey = entry.repeat ? Object.keys(entry.repeat)[0] : undefined;
  const repeatValues = repeatKey ? resolveValue(entry.repeat[repeatKey], merged) : undefined;
  if (!Array.isArray(repeatValues)) {
    return planParts(entry.parts, { originX: x, originY: y, params: merged, rotation, catalog });
  }
  const placements = [];
  for (const value of repeatValues) {
    placements.push(...planParts(entry.parts, {
      originX: x, originY: y, params: { ...merged, [repeatKey]: value }, rotation, catalog,
    }));
  }
  return placements;
};

module.exports = { planPreset, planParts, collapseOverlaps };
