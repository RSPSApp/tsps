// A save is visible only after its manifest has been committed. The newest
// entry for each path wins. A missing entry leaves older edits and base data visible.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const layerName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f\d-]+$/;
const automaticMarker = ".automatic";
const regionPath = /^regions\/\d{1,5}\.(?:pack|terrain\.dat|objects\.dat)$/;
const definitionPath = /^definitions\/(?:object-spawns|npc-spawns-custom|ground-items-custom|map-warps|world\.local|map-zones|map-spawn)\.json$/;
const allowed = (relative) => regionPath.test(relative) || definitionPath.test(relative);

function list(directory) {
  try { return fs.readdirSync(directory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function readLayers(data = path.resolve("data")) {
  const directory = path.join(data, "map-edits");
  const effective = new Map();
  const layers = [];
  let latest;
  for (const id of list(directory).filter((name) => layerName.test(name)).sort()) {
    const layer = path.join(directory, id);
    let manifest;
    try { manifest = fs.readFileSync(path.join(layer, "manifest.json"), "utf8"); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!manifest) continue;
    const entries = JSON.parse(manifest);
    if (!Array.isArray(entries) || entries.some((entry) => !allowed(entry?.path) || typeof entry.exists !== "boolean")) {
      throw new Error(`Invalid map edit manifest: ${id}`);
    }
    for (const entry of entries) {
      effective.set(entry.path, entry.exists ? path.join(layer, entry.path) : null);
    }
    layers.push({ directory: layer, entries });
    latest = id;
  }
  return { effective, latest, layers };
}

function effectiveFile(base, layers) {
  const data = path.dirname(path.dirname(path.resolve(base)));
  const relative = path.relative(data, base).split(path.sep).join("/");
  if (!allowed(relative)) return base;
  const effective = layers ?? readLayers(data).effective;
  return effective.has(relative) ? effective.get(relative) : base;
}

function regionFiles(data = path.resolve("data")) {
  const layers = readLayers(data).effective;
  const files = new Set(list(path.join(data, "regions")).map((name) => `regions/${name}`));
  for (const relative of layers.keys()) if (regionPath.test(relative)) files.add(relative);
  return [...files].sort().filter((relative) => regionPath.test(relative)).flatMap((relative) => {
    const file = effectiveFile(path.join(data, relative), layers);
    return file ? [{ name: path.basename(relative), file }] : [];
  });
}

function pruneAutomaticLayers(layers, entries) {
  // An editor save can be removed or restored independently. Only a newer automatic
  // save can make an automatic layer redundant, and it must cover every entry.
  const newerPaths = new Set(entries.map((entry) => entry.path));
  for (const { directory, entries } of layers.reverse()) {
    if (!fs.existsSync(path.join(directory, automaticMarker))) continue;
    if (!entries.every((entry) => newerPaths.has(entry.path))) {
      for (const entry of entries) newerPaths.add(entry.path);
      continue;
    }
    // Remove it from the index in one step before removing its files.
    const obsolete = directory + ".superseded";
    try {
      fs.renameSync(directory, obsolete);
      fs.rmSync(obsolete, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not remove superseded map edit ${directory}: ${error.message}`);
    }
  }
}

function commitMapEdit(files, data = path.resolve("data"), { automatic = false } = {}) {
  const entries = [...files].map(([relative, contents]) => {
    if (!allowed(relative)) throw new Error(`Unsupported map edit file: ${relative}`);
    return { path: relative, exists: contents !== null };
  });
  const { latest, layers } = readLayers(data);
  const previous = latest ? Date.parse(latest.slice(0, 24).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z")) : 0;
  const id = `${new Date(Math.max(Date.now(), previous + 1)).toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const directory = path.join(data, "map-edits", id);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  try {
    for (const [relative, contents] of files) {
      if (contents === null) continue;
      const file = path.join(directory, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }
    const manifest = path.join(directory, "manifest.json");
    if (automatic) fs.writeFileSync(path.join(directory, automaticMarker), "");
    fs.writeFileSync(manifest + ".tmp", JSON.stringify(entries));
    fs.renameSync(manifest + ".tmp", manifest);
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  if (automatic) pruneAutomaticLayers(layers, entries);
  return directory;
}

// Explicit tool fixtures and custom deployment paths keep their existing storage.
function isWorldFile(file) {
  return allowed(path.relative(path.resolve("data"), path.resolve(file)).split(path.sep).join("/"));
}

function commitWorldFiles(files) {
  const data = path.resolve("data");
  return commitMapEdit(new Map([...files].map(([file, contents]) =>
    [path.relative(data, file).split(path.sep).join("/"), contents])), data, { automatic: true });
}

module.exports = { readLayers, effectiveFile, regionFiles, commitMapEdit, isWorldFile, commitWorldFiles };
