"use strict";

// The file formats of a custom animation or graphic, as the Blender add-ons export them
// (data/models/README.md), shared by the cache editor's asset store (which checks a folder before
// storing it) and the CustomAnimations plugin (which loads the stored folders):
//   animation: seq.dat, framemap-<id>.dat, frames/<group>-<file>.dat
//   graphic:   spotanim.dat (its model and its animation are stored as their own assets)

const fs = require("node:fs");
const path = require("node:path");

/** A custom animation's or graphic's name: what plugins look it up by (getSeqId, getCustomSpotanimId). */
const NAME = /^[a-z0-9_]+$/;

function fail(message) {
  throw new Error(`[custom-animations] ${message}`);
}

/** Just past a zero-terminated string at `o`; past the end (so "truncated") when it has no terminator. */
function afterString(bytes, o) {
  while (o < bytes.length && bytes[o] !== 0) o++;
  return o + 1;
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
    else if (op === 18) o = afterString(bytes, o);
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

/**
 * A frame decodes as the client decodes it (rs/model/seq/SeqFrame.ts, Dat2SeqFrame): frame map id
 * (u16), slot count (u8, at most the frame map's), one flag byte a slot (bits 0-2: x, y, z), then
 * each flagged value as a smart (one byte under 128, else two), all within the file.
 */
function checkFrame(data, slots, what) {
  if (data.length < 3) fail(`${what} is truncated`);
  const count = data[2];
  if (count > slots) fail(`${what} has ${count} slots; its frame map has ${slots}`);
  let o = 3 + count;
  if (o > data.length) fail(`${what} is truncated`);
  for (let i = 0; i < count; i++) {
    const flag = data[3 + i];
    if (flag > 7) fail(`${what}: slot ${i} has an unknown flag ${flag}`);
    for (let bit = 0; bit < 3; bit++) {
      if ((flag & (1 << bit)) === 0) continue;
      if (o >= data.length) fail(`${what} is truncated`);
      o += data[o] < 128 ? 1 : 2;
    }
  }
  if (o > data.length) fail(`${what} is truncated`);
  // The client refuses a frame with slots whose values don't end exactly at the end of the file.
  if (count !== 0 && o !== data.length) fail(`${what} has ${data.length - o} byte(s) after its last value`);
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
    else if (op === 9) o = afterString(bytes, o);
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

/** Every file under `dir` as `relative/path` (forward slashes) -> bytes. */
function readFolder(dir) {
  const files = new Map();
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else if (entry.isFile()) files.set(`${prefix}${entry.name}`, fs.readFileSync(full));
    }
  };
  walk(dir, "");
  return files;
}

/**
 * Frame maps (skeletons) of the animation's own, which the cache doesn't have: from this id, so a
 * cache revision that adds frame maps (about 2,800 today) never meets one. A frame names its frame
 * map in a u16, so they end at 65535.
 */
const FIRST_CUSTOM_FRAME_MAP = 30000;
const LAST_CUSTOM_FRAME_MAP = 0xffff;

/**
 * A frame map decodes as the client decodes it (rs/model/seq/SeqBase.ts, Dat2SeqBase): slot count
 * (u8), a transform type a slot (u8), a label count a slot (u8), then each slot's labels (u8), and
 * optionally a u16 bone count, which must be 0: a skeletal frame map isn't a frame animation's.
 * Returns the slot count.
 */
function checkFrameMapData(data, what) {
  if (data.length < 1 || data[0] === 0) fail(`${what} has no slots`);
  const count = data[0];
  let o = 1 + count;
  if (o + count > data.length) fail(`${what} is truncated`);
  let labels = 0;
  for (let i = 0; i < count; i++) labels += data[o + i];
  o += count + labels;
  if (o > data.length) fail(`${what} is truncated`);
  if (o === data.length) return count;
  if (o + 2 !== data.length) fail(`${what} has ${data.length - o} byte(s) after its labels`);
  if (data[o] !== 0 || data[o + 1] !== 0) fail(`${what} is a skeletal frame map; only frame animations are supported`);
  return count;
}

/**
 * The frame map `id` that an animation's frames use, returning its slot count. A cache frame map
 * is the cache's: a framemap-<id>.dat next to the frames must be the same bytes. Any other id is a
 * custom frame map, from FIRST_CUSTOM_FRAME_MAP, whose framemap-<id>.dat is checked and added to
 * `custom` (id -> bytes), so it ships with the animation.
 */
function checkFrameMap(files, id, what, CacheDefinitions, custom = new Map()) {
  const cached = CacheDefinitions.getFrameMapData(id);
  const own = files.get(`framemap-${id}.dat`);
  if (cached && cached.length >= 1) {
    if (own && !Buffer.from(cached).equals(own)) {
      fail(`${what}: framemap-${id}.dat differs from the cache's; give an edited frame map its own id, from ${FIRST_CUSTOM_FRAME_MAP}`);
    }
    return cached[0] & 0xff;
  }
  if (id < FIRST_CUSTOM_FRAME_MAP || id > LAST_CUSTOM_FRAME_MAP) {
    fail(`${what} uses frame map ${id}, which the cache doesn't have (custom frame maps are ${FIRST_CUSTOM_FRAME_MAP}..${LAST_CUSTOM_FRAME_MAP})`);
  }
  if (!own) fail(`${what} uses custom frame map ${id} but has no framemap-${id}.dat`);
  const slots = checkFrameMapData(own, `${what} framemap-${id}.dat`);
  custom.set(id, own);
  return slots;
}

/** Every custom frame map id must name the same bytes in every animation that ships it. */
function checkSharedFrameMaps(rows) {
  const seen = new Map();
  for (const row of rows) {
    for (const [id, data] of Object.entries(row.framemaps ?? {})) {
      const first = seen.get(id);
      if (first && first.data !== data) fail(`animations ${first.id} and ${row.id} use different frame maps under id ${id}`);
      if (!first) seen.set(id, { id: row.id, data });
    }
  }
}

/**
 * Reads and checks an animation's files: seq.dat, every frame it names (frames/<group>-<file>.dat)
 * and the frame maps they use. Returns its opcodes, its frame list, each distinct frame's bytes (by
 * its original frame id, in order of first use), the frame maps (skeletons) it moves and, of
 * those, the custom ones' bytes (customFrameMaps, id -> bytes).
 */
function animationFiles(files, what, CacheDefinitions) {
  const seq = files.get("seq.dat");
  if (!seq) fail(`${what} has no seq.dat`);
  const ops = readSeq(new Uint8Array(seq), what);
  const frameOp = ops.find(({ op }) => op === 1);
  if (!frameOp) fail(`${what} has no frames`);
  const { lengths, ids } = frameList(frameOp.payload);
  const frames = new Map();
  const framemaps = [];
  const customFrameMaps = new Map();
  for (const id of ids) {
    if (frames.has(id)) continue;
    const name = `frames/${Math.floor(id / 65536)}-${id & 0xffff}.dat`;
    const data = files.get(name);
    if (!data) fail(`${what} is missing ${name}`);
    const framemap = (data[0] << 8) | data[1];
    const slots = checkFrameMap(files, framemap, what, CacheDefinitions, customFrameMaps);
    checkFrame(data, slots, `${what} ${name}`);
    if (!framemaps.includes(framemap)) framemaps.push(framemap);
    frames.set(id, data);
  }
  return { ops, frameOp, lengths, ids, frames, framemaps, customFrameMaps };
}

/**
 * The row players get for an animation (dataset customAnimations): its frames renumbered into its
 * own frame group, its seq.dat pointed at them and, when it has any, its custom frame maps
 * (framemaps, id -> base64). `checked` is animationFiles' result.
 */
function animationRow(checked, id, name, group) {
  const { ops, frameOp, lengths, ids, frames: bytes, customFrameMaps } = checked;
  const fileOf = new Map([...bytes.keys()].map((frameId, file) => [frameId, file]));
  const frames = {};
  for (const [frameId, data] of bytes) frames[fileOf.get(frameId)] = data.toString("base64");
  frameOp.payload = framePayload(lengths, ids.map((frameId) => group * 65536 + fileOf.get(frameId)));
  const row = { kind: "seq", id, name, data: encodeOps(ops).toString("base64"), group, frames };
  if (customFrameMaps?.size) {
    row.framemaps = Object.fromEntries([...customFrameMaps].map(([framemap, data]) => [framemap, data.toString("base64")]));
  }
  return row;
}

/** The players' dataset of custom animations and graphics, and the most one content packet holds. */
const DATASET = "customAnimations";
const PACKET_LIMIT = 0xffff;
/**
 * Frame groups above the cache's (index 0 has about 13,000): one per custom animation, by its
 * position by id. A frame id is group << 16 | file in a signed 32-bit int (client and server), so
 * groups stay below 32768.
 */
const FIRST_FRAME_GROUP = 30000;

/** Whether one row fits a content packet on its own (the encoder throws past a packet's length field). */
function fitsPacket(encodeContentData, row) {
  try {
    return encodeContentData("server", [{ key: DATASET, rows: [row] }]).length <= PACKET_LIMIT;
  } catch {
    return false;
  }
}

/** The files an animation's asset keeps: the ones animationFiles read, plus info.json for Blender. */
function animationKeeps(files, checked) {
  const keep = new Map([["seq.dat", files.get("seq.dat")]]);
  for (const id of checked.frames.keys()) {
    const name = `frames/${Math.floor(id / 65536)}-${id & 0xffff}.dat`;
    keep.set(name, files.get(name));
  }
  for (const framemap of checked.framemaps) {
    const name = `framemap-${framemap}.dat`;
    if (files.has(name)) keep.set(name, files.get(name));
  }
  if (files.has("info.json")) keep.set("info.json", files.get("info.json"));
  return keep;
}

module.exports = {
  NAME, fail, readSeq, frameList, framePayload, encodeOps, checkFrame, readSpotanim, setOp, u16, u32,
  readFolder, checkFrameMap, checkFrameMapData, checkSharedFrameMaps, animationFiles, animationKeeps, animationRow,
  fitsPacket, DATASET, PACKET_LIMIT, FIRST_FRAME_GROUP, FIRST_CUSTOM_FRAME_MAP, LAST_CUSTOM_FRAME_MAP,
};
