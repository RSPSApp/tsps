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
 * Frames use the cache's frame maps (skeletons); an edited frame map isn't supported yet. Returns
 * the frame map's slot count (its first byte).
 */
function checkFrameMap(files, id, what, CacheDefinitions) {
  const cached = CacheDefinitions.getFrameMapData(id);
  if (!cached || cached.length < 1) fail(`${what} uses frame map ${id}, which the cache doesn't have`);
  const own = files.get(`framemap-${id}.dat`);
  if (own && !Buffer.from(cached).equals(own)) {
    fail(`${what}: framemap-${id}.dat differs from the cache's; custom frame maps aren't supported yet`);
  }
  return cached[0] & 0xff;
}

/**
 * Reads and checks an animation's files: seq.dat, every frame it names (frames/<group>-<file>.dat)
 * and the frame maps they use. Returns its opcodes, its frame list, each distinct frame's bytes (by
 * its original frame id, in order of first use) and the frame maps (skeletons) it moves.
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
  for (const id of ids) {
    if (frames.has(id)) continue;
    const name = `frames/${Math.floor(id / 65536)}-${id & 0xffff}.dat`;
    const data = files.get(name);
    if (!data) fail(`${what} is missing ${name}`);
    const framemap = (data[0] << 8) | data[1];
    const slots = checkFrameMap(files, framemap, what, CacheDefinitions);
    checkFrame(data, slots, `${what} ${name}`);
    if (!framemaps.includes(framemap)) framemaps.push(framemap);
    frames.set(id, data);
  }
  return { ops, frameOp, lengths, ids, frames, framemaps };
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
  readFolder, checkFrameMap, animationFiles, animationKeeps,
};
