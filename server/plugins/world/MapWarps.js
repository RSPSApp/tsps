const fs = require("fs");
const path = require("path");
const { effectiveFile, isWorldFile, commitWorldFiles } = require("./MapEditFiles");
const { randomUUID } = require("crypto");

const filePath = () => process.env.AGENT_MCP_MAP_WARPS_FILE ??
  path.resolve("data/definitions/map-warps.json");

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function position(value) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("Use a tile with x, y and level");
  return [
    integer(value[0], 0, 16383, "X"), integer(value[1], 0, 16383, "Y"), integer(value[2], 0, 3, "Level"),
  ];
}

function normalizeSource(value) {
  if (!value || typeof value !== "object") throw new Error("Warp must be an object");
  const actionLabel = value.actionLabel === undefined ? undefined : plainLabel(value.actionLabel, 40, "Object action");
  return {
    id: integer(value.id, 0, 65535, "Object ID"),
    op: integer(value.op, 1, 5, "Object option"),
    from: position(value.from),
    ...(actionLabel === undefined ? {} : { actionLabel }),
  };
}

function plainLabel(value, limit, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > limit || /[<>\x00-\x1f]/.test(text)) {
    throw new Error(`${label} needs a plain text label of up to ${limit} characters`);
  }
  return text;
}

function normalizeWarp(value) {
  const source = normalizeSource(value);
  const { from } = source;
  if (!Array.isArray(value.destinations) || !value.destinations.length || value.destinations.length > 4) {
    throw new Error("Choose one to four destinations");
  }
  const destinations = value.destinations.map((destination) => {
    const label = plainLabel(destination?.label, 60, "Each destination");
    const to = position(destination.to);
    const beside = destination.beside === undefined ? undefined : {
      id: integer(destination.beside?.id, 0, 65535, "Arrival object ID"),
      at: position(destination.beside?.at),
    };
    if (to.every((coordinate, index) => from[index] === coordinate) && !beside) throw new Error("Choose a different arrival tile");
    if (beside && (beside.at[2] !== to[2] || (beside.id === source.id && beside.at.every((at, i) => at === from[i])))) {
      throw new Error("Choose a different arrival object on the destination floor");
    }
    return { label, to, ...(beside ? { beside } : {}) };
  });
  let returnLink;
  if (value.returnLink !== undefined) {
    const { id, op, from } = normalizeSource(value.returnLink);
    returnLink = { id, op, from };
    if (id === source.id && from.every((at, i) => at === source.from[i])) {
      throw new Error("Choose a different return object");
    }
  }
  return { ...source, destinations, ...(returnLink ? { returnLink } : {}) };
}

const warpKey = (id, op, from) => `${id}:${op}:${from.join(",")}`;
const sourceKey = ({ id, op, from }) => warpKey(id, op, from);
let warps;

function loadWarps() {
  const base = filePath();
  const file = isWorldFile(base) ? effectiveFile(base) : base;
  if (!file || !fs.existsSync(file)) return new Map();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new Error("map-warps.json must contain an array");
  return new Map(data.map((value) => {
    const warp = normalizeWarp(value);
    return [warpKey(warp.id, warp.op, warp.from), warp];
  }));
}

function listWarps() {
  warps ??= loadWarps();
  return [...warps.values()];
}

function warpAt(id, op, from) {
  warps ??= loadWarps();
  return warps.get(warpKey(id, op, from));
}

function isBridgeTile(core, x, y) {
  const region = core.getTemplateRegion?.(((x >> 6) << 8) | (y >> 6));
  return ((region?.settings[4096 | ((x & 63) << 6) | (y & 63)] ?? 0) & 2) !== 0;
}

function warpForObject(core, object, op) {
  const at = object.getLocation();
  const x = at.getX(), y = at.getY(), z = at.getZ(), id = object.getId();
  const stored = warpAt(id, op, [x, y, z]);
  if (stored || z === 3 || !object.isMapOriginal?.()) return stored;
  // Client editing uses the visible plane. Cached bridge locs are registered one floor lower.
  const onBridge = warpAt(id, op, [x, y, z + 1]);
  return onBridge && isBridgeTile(core, x, y) ? onBridge : undefined;
}

function pairedWarp(warp, lookup = ({ id, op, from }) => warpAt(id, op, from)) {
  const pair = warp?.returnLink && lookup(warp.returnLink);
  return pair?.returnLink && sourceKey(pair.returnLink) === sourceKey(warp) ? pair : undefined;
}

function warpMenuActions() {
  return listWarps().flatMap(({ id, op, from, actionLabel }) =>
    actionLabel ? [{ id, op, from, actionLabel }] : []);
}

/** Resolve the closest usable side of the actual object when the link is taken. */
function warpArrival(core, destination, source) {
  if (!destination.beside) return destination.to;
  const { id, at: [x, y, plane] } = destination.beside;
  let z = plane;
  let object = core.MapObjects.get(id, new core.Location(x, y, z), null);
  const bridge = !object && z > 0 && isBridgeTile(core, x, y);
  if (bridge) object = core.MapObjects.get(id, new core.Location(x, y, --z), null);
  if (!object) return null;
  const definition = core.ObjectDefinition.forId(id);
  const sized = [10, 11, 22].includes(object.getType());
  let width = sized ? Math.max(1, definition?.getSizeX?.() ?? 1) : 1;
  let depth = sized ? Math.max(1, definition?.getSizeY?.() ?? 1) : 1;
  if (object.getFace() & 1) [width, depth] = [depth, width];
  const candidates = [];
  for (let dx = 0; dx < width; dx++) candidates.push([x + dx, y - 1, z], [x + dx, y + depth, z]);
  for (let dy = 0; dy < depth; dy++) candidates.push([x - 1, y + dy, z], [x + width, y + dy, z]);
  const distance = ([ax, ay]) => Math.abs(ax - destination.to[0]) + Math.abs(ay - destination.to[1]);
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates.find(([ax, ay]) => ax >= 0 && ay >= 0 && ax <= 16383 && ay <= 16383 &&
    (ax !== source?.[0] || ay !== source?.[1] || z !== source?.[2]) &&
    (!bridge || isBridgeTile(core, ax, ay)) &&
    !core.RegionManager.blocked(new core.Location(ax, ay, z), null)) ?? null;
}

function updateWarps(changes, remove = false) {
  const next = loadWarps();
  const updates = new Map(changes.map((warp) => [sourceKey(warp), warp]));
  for (const [key, change] of updates) {
    const pair = pairedWarp(next.get(key), (source) => next.get(sourceKey(source)));
    if (pair && (remove || !change.returnLink || sourceKey(change.returnLink) !== sourceKey(pair)) &&
        !updates.has(sourceKey(pair))) next.delete(sourceKey(pair));
  }
  for (const [key, change] of updates) {
    if (remove) next.delete(key);
    else next.set(key, change);
  }
  for (const change of remove ? [] : updates.values()) {
    if (change.returnLink && !pairedWarp(change, (source) => next.get(sourceKey(source)))) {
      throw new Error("Both ends must point to each other");
    }
  }
  const file = filePath();
  const contents = "[\n" + [...next.values()].map((warp) => "  " + JSON.stringify(warp)).join(",\n") + "\n]\n";
  if (isWorldFile(file)) {
    commitWorldFiles(new Map([[file, contents]]));
    warps = next;
    return;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temp, contents, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  warps = next;
}

module.exports = { listWarps, normalizeSource, normalizeWarp, updateWarps, warpAt, warpForObject, pairedWarp, warpMenuActions, warpArrival };
