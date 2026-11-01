"use strict";

// The cache editor's canonical document: definitions that are laid over the cache, never written into
// it. One row is `{ kind, id, baseId, fields }` — a base definition from the cache plus the fields
// this project overrides — which is the shape `custom-items.json` already proved, made general.
//
// Nothing here is applied to the running world yet: saving writes the document and says a restart is
// needed, exactly as the item overlay does. The point of the file is that every write is validated
// against the real cache, so a dangling link or a colliding id never reaches a loader.

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const Fields = require("./Fields.CacheEditor");
const Inspect = require("./Inspect.CacheEditor");

const DOCUMENT = "custom-definitions.json";
// Overlay ids start above the cache's own count per kind, so a cache revision that grows never
// collides with something this project authored.
const OVERLAY_ID_START = 50000;
// ContentData v1: 3-byte packet header + 5-byte compression header.
const TRANSPORT_BUDGET = 65535 - 8;

const revision = (document) => createHash("sha256").update(JSON.stringify(document)).digest("hex").slice(0, 16);

function documentPath(root) {
  return path.join(root, "server", "data", "definitions", DOCUMENT);
}

function empty() {
  return { version: 1, rows: [], assets: [] };
}

/** Writes the whole document atomically; the one path every writer uses. */
function write(root, document) {
  const file = documentPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}
`, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return document;
}

function read(root) {
  const file = documentPath(root);
  if (!fs.existsSync(file)) return empty();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
    throw new Error(`${DOCUMENT} is not { version, rows }`);
  }
  return { ...parsed, assets: Array.isArray(parsed.assets) ? parsed.assets : [] };
}

function cacheCount(core, kind) {
  const counts = core.CacheDefinitions.getCounts();
  switch (kind) {
    case "loc": return counts.objects;
    case "npc": return counts.npcs;
    case "item": return counts.items;
    default: throw new Error(`A ${kind} overlay is not supported: only loc, npc and item ids are ranged by the cache today`);
  }
}

/** Everything wrong with one row, as sentences, so a save can refuse with a reason. */
function auditRow(core, row, seen) {
  const problems = [];
  const kind = row?.kind;
  if (!kind) return ["every row needs a kind"];
  let total;
  try {
    total = cacheCount(core, kind);
  } catch (error) {
    return [error.message];
  }
  const entry = Fields.KINDS[kind];
  if (!Number.isInteger(row.id) || row.id < Math.max(OVERLAY_ID_START, total)) {
    problems.push(`${kind} ${row.id}: overlay ids start at ${Math.max(OVERLAY_ID_START, total)} (cache has ${total})`);
  }
  if (seen.has(`${kind}:${row.id}`)) problems.push(`${kind} ${row.id}: duplicate overlay id`);
  seen.add(`${kind}:${row.id}`);
  if (!Number.isInteger(row.baseId) || row.baseId < 0 || row.baseId >= total) {
    problems.push(`${kind} ${row.id}: baseId must be a cache id below ${total}`);
  } else if (Inspect.resolveId(core, kind, row.baseId) === "missing") {
    problems.push(`${kind} ${row.id}: base ${row.baseId} does not exist`);
  }
  const fields = row.fields ?? {};
  if (typeof fields !== "object" || Array.isArray(fields)) problems.push(`${kind} ${row.id}: fields must be an object`);
  for (const [name, value] of Object.entries(fields)) {
    const meta = Fields.fieldOf(kind, name);
    if (!meta) {
      problems.push(`${kind} ${row.id}: no field "${name}" on a ${kind}`);
      continue;
    }
    const targets = (Array.isArray(value) ? value : [value]).filter((entry) => Number.isInteger(entry));
    if (meta.ref) {
      for (const target of targets) {
        const state = Inspect.resolveId(core, meta.ref, target);
        if (state === "missing") problems.push(`${kind} ${row.id}: ${name} points at missing ${meta.ref} ${target}`);
        if (target === row.id && meta.ref === kind) problems.push(`${kind} ${row.id}: ${name} points at itself`);
      }
    }
    if (Array.isArray(value) && !/(\[\])$/.test(meta.type)) {
      problems.push(`${kind} ${row.id}: ${name} is a ${meta.type}, not a list`);
    }
    if (!meta.ref && ["int", "boolean", "number", "string"].includes(meta.type)
      && typeof value !== meta.type.replace("int", "number") && !(meta.type === "int" && Number.isInteger(value))) {
      problems.push(`${kind} ${row.id}: ${name} should be a ${meta.type}`);
    }
  }
  return problems;
}

function audit(core, row) {
  return auditRow(core, row, new Set());
}

/** Validates the whole document, including the budget the client transport would impose. */
function check(core, document) {
  const problems = [];
  const seen = new Set();
  for (const row of document.rows) for (const problem of auditRow(core, row, seen)) problems.push(problem);
  if (!problems.length) {
    const bytes = deflateSync(Buffer.from(JSON.stringify({ gamemodeId: "server", datasets: [{ key: "customDefinitions", rows: document.rows }] })));
    if (bytes.length > TRANSPORT_BUDGET) problems.push(`definitions exceed the transport budget (${bytes.length} > ${TRANSPORT_BUDGET} bytes compressed)`);
  }
  return { ok: problems.length === 0, problems };
}

function snapshot(root) {
  const document = read(root);
  return { ...document, revision: revision(document), restartRequired: true };
}

/** Replaces or appends one row. The caller's revision must match, so two editors cannot interleave. */
function upsert(root, { row, revision: expected }) {
  const document = read(root);
  if (expected && expected !== revision(document)) {
    throw Object.assign(new Error("The document changed since it was loaded; reload before saving"), { status: 409 });
  }
  if (!row || typeof row !== "object") throw Object.assign(new Error("Missing row"), { status: 400 });
  const problems = auditRowCore(null, row);
  if (problems.length) throw Object.assign(new Error(problems.join("; ")), { status: 400 });
  const rows = document.rows.filter((entry) => !(entry.kind === row.kind && entry.id === row.id));
  rows.push({ kind: row.kind, id: row.id, baseId: row.baseId, fields: row.fields ?? {} });
  rows.sort((left, right) => left.kind.localeCompare(right.kind) || left.id - right.id);
  return { ...document, rows };
}

// `upsert` validates shape only; the cache-dependent checks need the core and run in `save`.
function auditRowCore(_core, row) {
  if (!row.kind || !Fields.KINDS[row.kind]) return [`unknown kind ${String(row.kind)}`];
  if (!Number.isInteger(row.id) || row.id < 0) return ["id must be a non-negative integer"];
  if (!Number.isInteger(row.baseId) || row.baseId < 0) return ["baseId must be a non-negative integer"];
  if (row.fields !== undefined && (typeof row.fields !== "object" || Array.isArray(row.fields) || row.fields === null)) {
    return ["fields must be an object"];
  }
  return [];
}

/** Shape first, then the cache-dependent audit, then an atomic replace. */
function save(core, root, payload) {
  const next = upsert(root, payload);
  const verdict = check(core, next);
  if (!verdict.ok) throw Object.assign(new Error(verdict.problems.join("; ")), { status: 400 });
  const file = documentPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return snapshot(root);
}

module.exports = { DOCUMENT, OVERLAY_ID_START, documentPath, read, write, snapshot, check, audit, upsert, save, revision };
