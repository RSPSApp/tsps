"use strict";

// Custom animations and graphics: data/definitions/custom-animations.json lists them by id and
// name, each pointing at a folder under data/models exported by the Blender add-ons
// (data/models/README.md):
//   animation: seq.dat, framemap-<id>.dat, frames/<group>-<file>.dat
//   graphic:   spotanim.dat, model.dat (and its animation, listed as an animation)
// Each animation's frames get a frame group of their own (FIRST_FRAME_GROUP + its index), its
// seq.dat is rewritten to point at them, and each graphic's spotanim.dat is pointed at its model
// and animation. The server then knows them by id and name (CacheDefinitions.getSeq,
// getSeqId, getSpotanim, getCustomSpotanimId), and clients get them at login.

const fs = require("fs");
const path = require("path");

const DATASET = "customAnimations";
const FILE = "custom-animations.json";
/**
 * Frame groups above the cache's (index 0 has about 13,000): one per custom animation. A frame id
 * is group << 16 | file in a signed 32-bit int (client and server), so groups stay below 32768.
 */
const FIRST_FRAME_GROUP = 30000;
const LAST_FRAME_GROUP = 32767;
const FIRST_CUSTOM_MODEL = 1000000;
const PACKET_LIMIT = 0xffff;

let content = { rows: [], animations: [], graphics: [] };

function fail(message) {
  throw new Error(`[custom-animations] ${message}`);
}

/** A folder under data/models, refusing paths that leave it. */
function folderOf(modelRoot, rel, what) {
  if (typeof rel !== "string" || !/^[a-zA-Z0-9._/-]+$/.test(rel)) fail(`${what} needs a "path" under data/models`);
  const dir = fs.realpathSync(path.resolve(modelRoot, rel));
  if (!dir.startsWith(`${modelRoot}${path.sep}`)) fail(`${what}: path escapes data/models: ${rel}`);
  return dir;
}

/** A sequence definition's opcodes (rev 226+), each with its raw payload. */
function readSeq(bytes, what) {
  const ops = [];
  let o = 0;
  const u16 = (p) => (bytes[p] << 8) | bytes[p + 1];
  while (o < bytes.length) {
    const op = bytes[o++];
    if (op === 0) return ops;
    const start = o;
    if (op === 1) o += 2 + u16(o) * 6;
    else if (op === 2 || op === 6 || op === 7) o += 2;
    else if (op === 3 || op === 17) o += 1 + bytes[o];
    else if (op === 4 || op === 19) { /* no payload */ }
    else if ([5, 8, 9, 10, 11, 16].includes(op)) o += 1;
    else if (op === 12) o += 1 + bytes[o] * 4;
    else if (op === 13) fail(`${what} is a skeletal animation; only frame animations are supported`);
    else if (op === 14) o += 2 + u16(o) * 8;
    else if (op === 15) o += 4;
    else if (op === 18) { while (bytes[o] !== 0) o++; o++; }
    else fail(`${what}: unknown sequence opcode ${op}`);
    if (o > bytes.length) fail(`${what}: seq.dat is truncated`);
    ops.push({ op, payload: bytes.subarray(start, o) });
  }
  fail(`${what}: seq.dat has no terminator`);
}

function frameList(payload) {
  const n = (payload[0] << 8) | payload[1];
  const u16 = (k) => (payload[2 + 2 * k] << 8) | payload[3 + 2 * k];
  const lengths = [], ids = [];
  for (let k = 0; k < n; k++) lengths.push(u16(k));
  for (let k = 0; k < n; k++) ids.push(u16(n + k) + u16(2 * n + k) * 65536);
  return { lengths, ids };
}

function framePayload(lengths, ids) {
  const out = Buffer.alloc(2 + ids.length * 6);
  out.writeUInt16BE(ids.length, 0);
  lengths.forEach((v, k) => out.writeUInt16BE(v, 2 + 2 * k));
  ids.forEach((v, k) => out.writeUInt16BE(v & 0xffff, 2 + 2 * (ids.length + k)));
  ids.forEach((v, k) => out.writeUInt16BE(Math.floor(v / 65536), 2 + 2 * (2 * ids.length + k)));
  return out;
}

function encodeOps(ops) {
  return Buffer.concat([...ops.flatMap(({ op, payload }) => [Buffer.from([op]), Buffer.from(payload)]), Buffer.from([0])]);
}

/** One animation: its frames moved to their own group, and seq.dat pointed at them. */
function loadAnimation(entry, index, modelRoot, CacheDefinitions) {
  const what = `animation ${entry.id} (${entry.name})`;
  const dir = folderOf(modelRoot, entry.path, what);
  const ops = readSeq(new Uint8Array(fs.readFileSync(path.join(dir, "seq.dat"))), what);
  const frameOp = ops.find(({ op }) => op === 1);
  if (!frameOp) fail(`${what} has no frames`);
  const { lengths, ids } = frameList(frameOp.payload);
  const group = FIRST_FRAME_GROUP + index;
  if (group > LAST_FRAME_GROUP) fail(`too many custom animations (frame groups end at ${LAST_FRAME_GROUP})`);
  const fileOf = new Map();
  const frames = {};
  for (const id of ids) {
    if (fileOf.has(id)) continue;
    const name = `${Math.floor(id / 65536)}-${id & 0xffff}.dat`;
    const file = path.join(dir, "frames", name);
    if (!fs.existsSync(file)) fail(`${what} is missing frames/${name}`);
    const data = fs.readFileSync(file);
    checkFrameMap(dir, (data[0] << 8) | data[1], what, CacheDefinitions);
    fileOf.set(id, fileOf.size);
    frames[fileOf.get(id)] = data.toString("base64");
  }
  frameOp.payload = framePayload(lengths, ids.map((id) => group * 65536 + fileOf.get(id)));
  return { kind: "seq", id: entry.id, name: entry.name, data: encodeOps(ops).toString("base64"), group, frames };
}

/** Frames use the cache's frame maps (skeletons); an edited frame map isn't supported yet. */
function checkFrameMap(dir, id, what, CacheDefinitions) {
  const cached = CacheDefinitions.getFrameMapData(id);
  if (!cached) fail(`${what} uses frame map ${id}, which the cache doesn't have`);
  const file = path.join(dir, `framemap-${id}.dat`);
  if (fs.existsSync(file) && !Buffer.from(cached).equals(fs.readFileSync(file))) {
    fail(`${what}: framemap-${id}.dat differs from the cache's; custom frame maps aren't supported yet`);
  }
}

/** A graphic definition's opcodes (rev 241), each with its raw payload. */
function readSpotanim(bytes, what) {
  const ops = [];
  let o = 0;
  while (o < bytes.length) {
    const op = bytes[o++];
    if (op === 0) return ops;
    const start = o;
    if ([1, 2, 4, 5, 6, 42].includes(op)) o += 2;
    else if (op === 3) o += 4;
    else if (op === 7 || op === 8) o += 1;
    else if (op === 9) { while (bytes[o] !== 0) o++; o++; }
    else if (op === 10) { /* no payload */ }
    else if (op === 40 || op === 41) o += 1 + bytes[o] * 4;
    else fail(`${what}: unknown graphic opcode ${op}`);
    if (o > bytes.length) fail(`${what}: spotanim.dat is truncated`);
    ops.push({ op, payload: bytes.subarray(start, o) });
  }
  fail(`${what}: spotanim.dat has no terminator`);
}

/** Sets an opcode's payload where the first of `replaces` was (dropping the others), or adds it. */
function setOp(ops, op, payload, replaces = [op]) {
  const out = [];
  let placed = false;
  for (const entry of ops) {
    if (!replaces.includes(entry.op)) out.push(entry);
    else if (!placed) { out.push({ op, payload }); placed = true; }
  }
  if (!placed) out.push({ op, payload });
  return out;
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }

/** One graphic: its model (as a custom model) and its animation (custom or cache). */
function loadGraphic(entry, animations, modelRoot, CacheDefinitions) {
  const what = `graphic ${entry.id} (${entry.name})`;
  const dir = folderOf(modelRoot, entry.path, what);
  let ops = readSpotanim(new Uint8Array(fs.readFileSync(path.join(dir, "spotanim.dat"))), what);
  const row = { kind: "spotanim", id: entry.id, name: entry.name };
  if (entry.model !== undefined) {
    if (!Number.isInteger(entry.model) || entry.model < FIRST_CUSTOM_MODEL || entry.model > 0x7fffffff) {
      fail(`${what}: "model" must be a custom model id (${FIRST_CUSTOM_MODEL} or more)`);
    }
    const data = fs.readFileSync(path.join(dir, "model.dat"));
    if (data.length < 18 || data.length > 1024 * 1024) fail(`${what}: model.dat must be 18 bytes..1 MiB`);
    row.model = { id: entry.model, data: data.toString("base64") };
    ops = setOp(ops, 3, u32(entry.model), [1, 3]);
  }
  if (entry.animation !== undefined) {
    const seqId = typeof entry.animation === "string"
      ? (animations.find((anim) => anim.name === entry.animation)?.id ?? CacheDefinitions.getSeqId(entry.animation))
      : entry.animation;
    if (!Number.isInteger(seqId) || seqId < 0 || seqId > 0xfffe) fail(`${what}: unknown animation ${JSON.stringify(entry.animation)}`);
    ops = setOp(ops, 2, u16(seqId));
  }
  row.data = encodeOps(ops).toString("base64");
  return row;
}

function validEntry(entry, kind, seen) {
  const what = `${kind} ${JSON.stringify(entry?.id)}`;
  if (!entry || !Number.isInteger(entry.id)) fail(`every ${kind} needs an integer "id"`);
  if (typeof entry.name !== "string" || !/^[a-z0-9_]+$/.test(entry.name)) fail(`${what} needs a lower_case "name"`);
  if (seen.ids.has(entry.id)) fail(`${kind} id ${entry.id} is listed twice`);
  if (seen.names.has(entry.name)) fail(`${kind} name ${entry.name} is listed twice`);
  seen.ids.add(entry.id);
  seen.names.add(entry.name);
}

function loadCustomAnimations(core) {
  const { CacheDefinitions, GameConstants, encodeContentData } = core;
  const file = path.resolve(process.cwd(), GameConstants.DEFINITIONS_DIRECTORY, FILE);
  if (!fs.existsSync(file)) return { rows: [], animations: [], graphics: [] };
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  const animations = Array.isArray(list.animations) ? list.animations : [];
  const graphics = Array.isArray(list.graphics) ? list.graphics : [];
  const modelRoot = fs.realpathSync(path.resolve(process.cwd(), GameConstants.DEFINITIONS_DIRECTORY, "../models"));
  const seenAnimations = { ids: new Set(), names: new Set() };
  const seenGraphics = { ids: new Set(), names: new Set() };
  animations.forEach((entry) => validEntry(entry, "animation", seenAnimations));
  graphics.forEach((entry) => validEntry(entry, "graphic", seenGraphics));
  const rows = [
    ...animations.map((entry, index) => loadAnimation(entry, index, modelRoot, CacheDefinitions)),
    ...graphics.map((entry) => loadGraphic(entry, animations, modelRoot, CacheDefinitions)),
  ];
  for (const row of rows) {
    // One packet per animation or graphic; a bigger one needs chunked delivery.
    if (encodeContentData("server", [{ key: DATASET, rows: [row] }]).length > PACKET_LIMIT) {
      fail(`${row.kind === "seq" ? "animation" : "graphic"} ${row.id} is too big for one content packet`);
    }
  }
  const definition = (row) => ({ id: row.id, name: row.name, data: row.data });
  CacheDefinitions.registerCustomAnimations(
    rows.filter((row) => row.kind === "seq").map(definition),
    rows.filter((row) => row.kind === "spotanim").map(definition));
  return { rows, animations, graphics };
}

/** Graphic models must not share ids with custom item models (known once every plugin loaded). */
function checkModelIds({ CacheDefinitions }) {
  const taken = new Set(CacheDefinitions.getCustomModels().map((model) => model.id));
  for (const row of content.rows) {
    if (row.model && taken.has(row.model.id)) fail(`graphic ${row.id}'s model id ${row.model.id} is already a custom item model`);
  }
}

function sendCustomAnimations({ player }) {
  const sender = player.getPacketSender();
  sender.sendContentData("server", [{ key: DATASET, rows: [] }]);
  for (const row of content.rows) sender.sendContentData("server", [{ key: DATASET, rows: [row] }]);
}

function customAnimationsResource() {
  return content.rows.map(({ kind, id, name, group, model }) => ({ kind: kind === "seq" ? "animation" : "graphic", id, name, frameGroup: group, model: model?.id }));
}

function loadInto(api) {
  content = loadCustomAnimations(api.core);
  api.log("loaded", { animations: content.animations.length, graphics: content.graphics.length });
}

module.exports = {
  name: "CustomAnimations",
  description: "Loads custom animations and graphics (data/definitions/custom-animations.json) and sends them to players at login.",
  _test: { loadCustomAnimations, readSeq, frameList, readSpotanim, FIRST_FRAME_GROUP },
  register(api) {
    loadInto(api);
    api.onServerStartup?.(checkModelIds.bind(null, api.core));
    api.registerContentEndpoint("custom-animations", customAnimationsResource);
    api.onPlayerLogin(sendCustomAnimations);
  },
};
