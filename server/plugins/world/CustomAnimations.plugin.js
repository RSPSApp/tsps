"use strict";

// Custom animations and graphics: the cache editor's animation and graphic assets
// (data/definitions/custom-definitions.json `assets`, files under data/assets/<kind>/<hash>/, added
// in the editor's Assets tab; see server/docs/agents/cache-editor.md). Each animation's frames get
// a frame group of their own (FIRST_FRAME_GROUP + its position by id), its seq.dat is rewritten to
// point at them, a frame map of its own (an id from Files.FIRST_CUSTOM_FRAME_MAP) travels with it,
// and each graphic's spotanim.dat is pointed at its model (a model asset, which the
// editor ships as a custom model) and its animation. The server then knows them by id and name
// (CacheDefinitions.getSeq, getSeqId, getSpotanim, getCustomSpotanimId), and clients get them at login.

const path = require("path");
const Files = require("./CustomAnimationFiles.cjs");
const Assets = require("../tools/cache-editor/Assets.CacheEditor.cjs");

const { fail, readSeq, frameList, readSpotanim, checkFrame, encodeOps, framePayload, setOp, u16, u32 } = Files;

const { DATASET, PACKET_LIMIT } = Files;
/** server/: the cache editor's document and assets are under data/. */
const ROOT = path.resolve(__dirname, "../..");
const { FIRST_FRAME_GROUP } = Files;
const LAST_FRAME_GROUP = 32767;

let content = { rows: [], animations: [], graphics: [], packets: [] };
let encodeContentData = null;

/** An asset's folder, refusing a row whose file isn't one of the store's own folders. */
function folderOf(root, entry, what) {
  if (typeof entry.file !== "string" || !new RegExp(`^${entry.kind}/[0-9a-f]{8,64}$`).test(entry.file)) fail(`${what} has no stored folder`);
  return path.join(Assets.assetRoot(root), ...entry.file.split("/"));
}

/**
 * One animation: its frames moved to their own group, and seq.dat pointed at them. Its rows: one,
 * or several when it is too big for one content packet (Files.animationRows).
 */
function loadAnimation(entry, index, root, CacheDefinitions, encodeContentData) {
  const what = `animation ${entry.id} (${entry.name})`;
  const files = Files.readFolder(folderOf(root, entry, what));
  const checked = Files.animationFiles(files, what, CacheDefinitions);
  const group = FIRST_FRAME_GROUP + index;
  if (group > LAST_FRAME_GROUP) fail(`too many custom animations (frame groups end at ${LAST_FRAME_GROUP})`);
  return Files.animationRows(encodeContentData, checked, entry.id, entry.name, group);
}

/** One graphic: pointed at its model asset and its animation (custom or cache). */
function loadGraphic(entry, animations, models, root, CacheDefinitions) {
  const what = `graphic ${entry.id} (${entry.name})`;
  const spotanim = Files.readFolder(folderOf(root, entry, what)).get("spotanim.dat");
  if (!spotanim) fail(`${what} has no spotanim.dat`);
  let ops = readSpotanim(new Uint8Array(spotanim), what);
  const row = { kind: "spotanim", id: entry.id, name: entry.name };
  if (entry.model !== undefined && entry.model !== null) {
    if (!models.has(entry.model)) fail(`${what}: its model ${entry.model} is not a model asset`);
    ops = setOp(ops, 3, u32(entry.model), [1, 3]);
  }
  if (entry.animation !== undefined && entry.animation !== null) {
    const seqId = entry.animation;
    const custom = animations.some((animation) => animation.id === seqId);
    if (!Number.isInteger(seqId) || seqId < 0 || seqId > 0xfffe || (!custom && !CacheDefinitions.hasDefinition("seq", seqId))) {
      fail(`${what}: unknown animation ${JSON.stringify(entry.animation)}`);
    }
    ops = setOp(ops, 2, u16(seqId));
  }
  row.data = encodeOps(ops).toString("base64");
  return row;
}

function validEntry(entry, kind, seen) {
  const what = `${kind} ${JSON.stringify(entry?.id)}`;
  if (!entry || !Number.isInteger(entry.id)) fail(`every ${kind} needs an integer "id"`);
  if (typeof entry.name !== "string" || !Files.NAME.test(entry.name)) fail(`${what} needs a lower_case "name"`);
  if (seen.ids.has(entry.id)) fail(`${kind} id ${entry.id} is listed twice`);
  if (seen.names.has(entry.name)) fail(`${kind} name ${entry.name} is listed twice`);
  seen.ids.add(entry.id);
  seen.names.add(entry.name);
}

function loadCustomAnimations(core, root = ROOT) {
  const { CacheDefinitions, encodeContentData } = core;
  const assets = Assets.assetsOf(root);
  const byId = (a, b) => a.id - b.id;
  const animations = assets.filter((asset) => asset.kind === "animation").sort(byId);
  const graphics = assets.filter((asset) => asset.kind === "graphic").sort(byId);
  const models = new Set(assets.filter((asset) => asset.kind === "model").map((asset) => asset.id));
  const seenAnimations = { ids: new Set(), names: new Set() };
  const seenGraphics = { ids: new Set(), names: new Set() };
  animations.forEach((entry) => validEntry(entry, "animation", seenAnimations));
  graphics.forEach((entry) => validEntry(entry, "graphic", seenGraphics));
  const rows = [
    ...animations.flatMap((entry, index) => loadAnimation(entry, index, root, CacheDefinitions, encodeContentData)),
    ...graphics.map((entry) => loadGraphic(entry, animations, models, root, CacheDefinitions)),
  ];
  // A custom frame map ships with every animation that uses it, so they must agree on its bytes.
  Files.checkSharedFrameMaps(rows);
  for (const row of rows) {
    // Every row fits a packet: a big animation is already split into parts (Files.animationRows).
    if (!Files.fitsPacket(encodeContentData, row)) {
      fail(`${row.kind === "spotanim" ? "graphic" : "animation"} ${row.id} is too big for one content packet`);
    }
  }
  const definition = (row) => ({ id: row.id, name: row.name, data: row.data });
  CacheDefinitions.registerCustomAnimations(
    rows.filter((row) => row.kind === "seq").map(definition),
    rows.filter((row) => row.kind === "spotanim").map(definition));
  return { rows, animations, graphics };
}

/**
 * The set as content packets: one, unless it is too big for one (0xffff after compression). The
 * first starts with a reset row, so a client replaces what it had; it then invalidates once.
 */
function packetsOf(_CacheDefinitions, rows) {
  const encode = (packetRows) => encodeContentData("server", [{ key: DATASET, rows: packetRows }]);
  const packets = [];
  let current = [{ kind: "reset" }];
  for (const row of rows) {
    if (current.length > 0 && encode([...current, row]).length > PACKET_LIMIT) {
      packets.push(current);
      current = [];
    }
    current.push(row);
  }
  packets.push(current);
  return packets;
}

function sendCustomAnimations({ player }) {
  const sender = player.getPacketSender();
  for (const rows of content.packets ?? packetsOf(null, content.rows)) sender.sendContentData("server", [{ key: DATASET, rows }]);
}

function customAnimationsResource() {
  const models = new Map(content.graphics.map((entry) => [entry.id, entry.model ?? undefined]));
  return content.rows.filter((row) => row.kind !== "frames").map(({ kind, id, name, group }) => ({ kind: kind === "seq" ? "animation" : "graphic", id, name, frameGroup: group, model: kind === "seq" ? undefined : models.get(id) }));
}

function loadInto(api) {
  encodeContentData = api.core.encodeContentData;
  // api.root: another server root's assets (tests); the server's own otherwise.
  content = loadCustomAnimations(api.core, api.root);
  content.packets = packetsOf(api.core.CacheDefinitions, content.rows);
  api.log("loaded", { animations: content.animations.length, graphics: content.graphics.length });
}

module.exports = {
  name: "CustomAnimations",
  description: "Loads the cache editor's animation and graphic assets as custom animations and graphics, and sends them to players at login.",
  _test: {
    loadCustomAnimations, readSeq, frameList, readSpotanim, checkFrame, FIRST_FRAME_GROUP,
    /** The plugin's state and hooks, for tests that register it. */
    content: () => content, sendCustomAnimations,
  },
  register(api) {
    loadInto(api);
    api.registerContentEndpoint("custom-animations", customAnimationsResource);
    // The rows every player gets at login, for pages that never log in (the cache editor's previews).
    api.registerContentEndpoint("custom-animations-data", () => ({ rows: [{ kind: "reset" }, ...content.rows] }));
    api.onPlayerLogin(sendCustomAnimations);
  },
};
