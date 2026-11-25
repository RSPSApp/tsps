const fs = require("fs");
const path = require("path");
const { randomUUID } = require("node:crypto");
const { effectiveFile, isWorldFile, commitWorldFiles } = require("../../world/MapEditFiles");

// Reads and writes the definition files the edit tools persist to
// (object-spawns.json, npc-spawns.json).
//
// The files are large and hand-maintained, so a write must not reformat untouched
// entries: every entry stays on its own line, exactly as the file already had it,
// and the file keeps its line endings. A tool that adds one spawn then shows a diff
// of one line, not of thirty thousand.

function readEntries(file) {
  const source = isWorldFile(file) ? effectiveFile(file) : file;
  if (!source) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array`);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(`Cannot read ${file}: ${error?.message ?? error}`);
  }
}

/**
 * The file's own text for each one-line entry, keyed by its compact JSON. Entries are
 * parsed objects by the time they are written back, so this is how an untouched line
 * keeps its spacing (`{"id": 6142, ...}` must not become `{"id":6142,...}`).
 */
function originalLines(original) {
  const lines = new Map();
  for (const line of original.split(/\r?\n/)) {
    const text = line.trim().replace(/,$/, "");
    if (!text.startsWith("{")) continue;
    try {
      const key = JSON.stringify(JSON.parse(text));
      if (!lines.has(key)) lines.set(key, line.replace(/,\s*$/, ""));
    } catch {
      // A multi-line entry: it is written compact, as before.
    }
  }
  return lines;
}

function writeEntries(file, entries) {
  const worldFile = isWorldFile(file);
  const source = worldFile ? effectiveFile(file) : file;
  let newline = "\n";
  let trailing = false;
  let lines = new Map();
  try {
    const original = source ? fs.readFileSync(source, "utf8") : "";
    if (original.includes("\r\n")) newline = "\r\n";
    trailing = original.endsWith("\n");
    lines = originalLines(original);
  } catch {
    // New file: LF, no trailing newline.
  }
  const lineFor = (entry) => {
    const key = JSON.stringify(entry);
    return lines.get(key) ?? `  ${key}`;
  };
  const body = entries.length === 0
    ? "[]"
    : `[${newline}${entries.map(lineFor).join(`,${newline}`)}${newline}]`;
  const contents = body + (trailing ? newline : "");
  if (!worldFile) {
    fs.writeFileSync(file, contents);
    return;
  }
  // Ordinary object edits are source changes. If the world already supplies a
  // layered definition, use its current data and preserve the editor's saved layer.
  if (source !== file || path.basename(file) !== "object-spawns.json") {
    commitWorldFiles(new Map([[file, contents]]));
    return;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, contents, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Object spawns: { id, position: { x, y, z }, type, face, remove?, source? }. */
function createObjectSpawnStore(file) {
  const key = (entry) => `${entry?.position?.x},${entry?.position?.y},${entry?.position?.z}`;
  const matches = (entry, id, x, y, z, type) =>
    entry.id === id && key(entry) === `${x},${y},${z}` && (entry.type ?? 10) === type;
  return {
    file,
    read: () => readEntries(file),
    write: (entries) => writeEntries(file, entries),
    /**
     * The placement entry for this object on this tile, or undefined. Removal markers
     * do not count: the object is not placed by the file, so re-placing it has to add
     * an entry (and clear the marker) rather than treat it as already saved.
     */
    find: (entries, id, x, y, z, type, face) => entries.find((entry) =>
      matches(entry, id, x, y, z, type) && entry.remove !== true
      && (face === undefined || (entry.face ?? 0) === face)),
    /** Drops a placement entry, so the object is no longer placed by this file. */
    dropPlacement: (entries, id, x, y, z, type) => {
      const before = entries.length;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (matches(entry, id, x, y, z, type) && entry.remove !== true) entries.splice(i, 1);
      }
      return entries.length !== before;
    },
    /**
     * Drops placement entries for other objects (or this one at another face) in the
     * tile's slot. A tile holds one object per type, so registering a placement replaces
     * whatever stood there live; its old entry would bring it back on the next load.
     */
    dropReplaced: (entries, id, x, y, z, type, face) => {
      const before = entries.length;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.remove === true || key(entry) !== `${x},${y},${z}` || (entry.type ?? 10) !== type) continue;
        if (entry.id === id && (entry.face ?? 0) === face) continue;
        entries.splice(i, 1);
      }
      return before - entries.length;
    },
    /**
     * Drops a removal marker for this object on this tile. A razed tile keeps its
     * marker, which would delete a fresh placement of the same id and type on the
     * next load; placing therefore clears it first.
     */
    dropRemoval: (entries, id, x, y, z, type) => {
      const before = entries.length;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (matches(entry, id, x, y, z, type) && entry.remove === true) entries.splice(i, 1);
      }
      return entries.length !== before;
    },
  };
}

/** NPC spawns: { level, name, x, y, id, wanderRadius?, direction?, source? }. */
function createNpcSpawnStore(file) {
  return {
    file,
    read: () => readEntries(file),
    write: (entries) => writeEntries(file, entries),
    find: (entries, id, x, y, z) => entries.find((entry) =>
      entry.id === id && entry.x === x && entry.y === y && (entry.level ?? 0) === z),
  };
}

module.exports = { readEntries, writeEntries, createObjectSpawnStore, createNpcSpawnStore };
