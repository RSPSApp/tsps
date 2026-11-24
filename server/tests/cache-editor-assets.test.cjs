// Run after `yarn build`, from server/: node --test tests/cache-editor-assets.test.cjs
//
// The cache editor's animation and graphic assets, its asset library (the Blender add-ons' exports
// under data/models) and the Model Extractor it hosts, against the real cache and real exports. Each
// test writes into a temporary server root, never into data/.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
const Assets = require("../plugins/tools/cache-editor/Assets.CacheEditor.cjs");
const Document = require("../plugins/tools/cache-editor/Document.CacheEditor.cjs");
const Files = require("../plugins/world/CustomAnimationFiles.cjs");
const { createExtract } = require("../plugins/tools/cache-editor/Extract.CacheEditor.cjs");
const { createAuthoring } = require("../plugins/tools/cache-editor/Authoring.CacheEditor.plugin.js");
const CustomAnimations = require("../plugins/world/CustomAnimations.plugin");

const SERVER = path.resolve(__dirname, "..");
const MODELS = path.join(SERVER, "data", "models");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const core = { CacheDefinitions, CachePipeline, CacheIndexDat2, NpcDefinition, encodeContentData };

before(async () => {
  await CachePipeline.initialize(SERVER);
  new NpcDefinitionLoader().load();
});

/** A temporary server root whose data/models holds copies of these real export folders. */
function rootWith(folders) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cache-editor-assets-"));
  for (const [from, to] of Object.entries(folders)) fs.cpSync(path.join(MODELS, from), path.join(root, "data", "models", to), { recursive: true });
  return root;
}

const base64Files = (directory) => Object.fromEntries([...Files.readFolder(directory)].map(([name, bytes]) => [name, bytes.toString("base64")]));

test("an animation folder is checked, stored once by its content, and keeps its id and name when replaced", () => {
  const root = rootWith({ "zamorak-godsword-special/player-anim": "zgs" });
  const first = Assets.addAsset(root, { kind: "animation", library: "zgs" }, core);
  assert.equal(first.asset.id, 50000, "animations start at 50000");
  assert.equal(first.asset.name, "zgs", "named after its folder, lower_case");
  assert.equal(first.asset.frames, 25, "the ZGS special's 25 frames");
  assert.deepEqual(first.asset.framemaps, [0], "on the player skeleton");
  const stored = path.join(root, "data", "assets", ...first.asset.file.split("/"));
  assert.ok(fs.existsSync(path.join(stored, "seq.dat")) && fs.existsSync(path.join(stored, "frames")), "seq.dat and frames/ under data/assets");

  const again = Assets.addAsset(root, { kind: "animation", files: base64Files(path.join(root, "data/models/zgs")), name: "other" }, core);
  assert.equal(again.reused, true, "the same files are one asset");
  assert.equal(again.asset.id, 50000);

  // An edit in Blender (here: one frame made longer) replaces the files, not the id or the name.
  const seqFile = path.join(root, "data/models/zgs/seq.dat");
  const seq = fs.readFileSync(seqFile);
  seq[4] += 1;
  fs.writeFileSync(seqFile, seq);
  const replaced = Assets.addAsset(root, { kind: "animation", library: "zgs", replace: 50000 }, core);
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.asset.id, 50000);
  assert.equal(replaced.asset.name, "zgs");
  assert.notEqual(replaced.asset.hash, first.asset.hash);
  assert.equal(Assets.assetsOf(root).filter((row) => row.kind === "animation").length, 1);

  assert.throws(() => Assets.addAsset(root, { kind: "animation", library: "zgs", id: 50000 }, core), /already an asset/);
  assert.throws(() => Assets.addAsset(root, { kind: "animation", library: "zgs", id: 12 }, core), /50000\.\.65534/);
  assert.throws(() => Assets.renameAsset(root, { kind: "animation", id: 50000, name: "human_ready" }, core), /already a cache animation's name/);
  assert.equal(Assets.renameAsset(root, { kind: "animation", id: 50000, name: "My ZGS swing" }, core).asset.name, "my_zgs_swing", "names stay lower_case");
});

// Review of RSPSApp/tsps PR 6375: what an import accepts must also load at startup and decode in
// the client, and a refused graphic leaves the document as it was.
test("a frame with bytes after its last value is refused, as the client refuses it", () => {
  const root = rootWith({ "zamorak-godsword-special/player-anim": "zgs" });
  const files = base64Files(path.join(root, "data/models/zgs"));
  const frame = Object.keys(files).find((name) => name.startsWith("frames/"));
  const trailing = Buffer.concat([Buffer.from(files[frame], "base64"), Buffer.from([0])]).toString("base64");
  assert.throws(() => Assets.addAsset(root, { kind: "animation", files: { ...files, [frame]: trailing }, name: "trailing" }, core), /byte\(s\) after its last value/);
  assert.equal(Assets.assetsOf(root).length, 0, "nothing was stored");
});

test("an animation too big for one content packet is refused before it is stored", () => {
  const root = rootWith({ "zamorak-godsword-special/player-anim": "zgs" });
  const folder = path.join(root, "data/models/zgs");
  const sample = fs.readFileSync(path.join(folder, "frames", fs.readdirSync(path.join(folder, "frames"))[0]));
  const slots = sample[2];
  // 1,200 valid frames of random one-byte values on every axis: they don't compress, so their row
  // is far past a packet, though the files are well under the 1 MiB cap.
  fs.rmSync(path.join(folder, "frames"), { recursive: true });
  fs.mkdirSync(path.join(folder, "frames"));
  const count = 1200;
  let seed = 6375;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 128;
  const ids = [];
  for (let file = 0; file < count; file++) {
    const frame = Buffer.alloc(3 + slots * 4);
    frame[0] = sample[0];
    frame[1] = sample[1];
    frame[2] = slots;
    for (let slot = 0; slot < slots; slot++) {
      frame[3 + slot] = 7;
      for (let axis = 0; axis < 3; axis++) frame[3 + slots + slot * 3 + axis] = random();
    }
    fs.writeFileSync(path.join(folder, "frames", `12146-${file + 1}.dat`), frame);
    ids.push(12146 * 65536 + file + 1);
  }
  const ops = Files.readSeq(new Uint8Array(fs.readFileSync(path.join(folder, "seq.dat"))), "seq.dat");
  ops.find(({ op }) => op === 1).payload = Files.framePayload(ids.map(() => 1), ids);
  fs.writeFileSync(path.join(folder, "seq.dat"), Files.encodeOps(ops.filter(({ op }) => op !== 12 && op !== 13)));
  assert.throws(() => Assets.addAsset(root, { kind: "animation", library: "zgs" }, core), (failure) => failure.status === 413 && /one content packet/.test(failure.message));
  assert.equal(Assets.assetsOf(root).length, 0, "nothing was stored");
  assert.equal(fs.existsSync(path.join(root, "data", "assets")), false, "no files either");
});

test("an animation's packet size is checked with its real id, name and frame group", () => {
  const source = Files.readFolder(path.join(MODELS, "zamorak-godsword-special/player-anim"));
  const ops = Files.readSeq(new Uint8Array(source.get("seq.dat")), "seq.dat").filter(({ op }) => op !== 12 && op !== 13);
  ops.find(({ op }) => op === 1).payload = Files.framePayload([1], [12146 * 65536 + 1]);
  const seq = Files.encodeOps(ops);
  // One frame with no slots (which the client accepts with any bytes after it), padded with random
  // bytes that don't compress, so the padding sets the row's size.
  const noise = Buffer.alloc(100000);
  let seed = 12345;
  for (let i = 0; i < noise.length; i++) noise[i] = (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
  const filesOf = (padding) => new Map([
    ["seq.dat", seq],
    ["framemap-0.dat", source.get("framemap-0.dat")],
    ["frames/12146-1.dat", Buffer.concat([Buffer.from([0, 0, 0]), noise.subarray(0, padding)])],
  ]);
  const fits = (padding, id, name, group) => Files.fitsPacket(encodeContentData,
    Files.animationRow(Files.animationFiles(filesOf(padding), "fixture", CacheDefinitions), id, name, group));
  const largest = (id, name, group) => {
    let low = 0;
    let high = noise.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(mid, id, name, group)) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  const name = "q7z9a3f5h8k2m4p6r1t0v3x5b7d9g2j4n6s8w1y0c3e5i7o9u2l4q6z8a1f3h5k7";
  assert.equal(name.length, 64, "the longest name an animation keeps");
  const upload = (padding) => ({ kind: "animation", name, files: Object.fromEntries([...filesOf(padding)].map(([file, bytes]) => [file, bytes.toString("base64")])) });

  // The largest upload whose row fits with a placeholder id and name is too big as id 50000 with
  // this name: the row the server builds at startup is the one that has to fit.
  const placeholder = largest(0, "animation", 0x7fff);
  assert.equal(fits(placeholder, 50000, name, CustomAnimations._test.FIRST_FRAME_GROUP), false, "the real row is bigger");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cache-editor-assets-"));
  assert.throws(() => Assets.addAsset(root, upload(placeholder), core), (failure) => failure.status === 413 && /one content packet/.test(failure.message));
  assert.equal(Assets.assetsOf(root).length, 0, "nothing was stored");
  assert.equal(fs.existsSync(path.join(root, "data", "assets")), false, "no files either");

  // The largest one that fits as itself is accepted, takes the id the refused one didn't, and loads.
  const fitting = largest(50000, name, CustomAnimations._test.FIRST_FRAME_GROUP);
  assert.ok(fitting < placeholder);
  const added = Assets.addAsset(root, upload(fitting), core);
  assert.equal(added.asset.id, 50000, "the refused upload used no id");
  assert.equal(added.asset.name, name);
  const loaded = CustomAnimations._test.loadCustomAnimations({ CacheDefinitions, encodeContentData }, root);
  assert.deepEqual(loaded.rows.map((row) => row.id), [50000]);
});

test("a graphic's animation link is checked, and a refused graphic leaves no parts behind", () => {
  const root = rootWith({ "zamorak-godsword-special/graphic": "zgs-trail" });
  assert.throws(() => Assets.addAsset(root, { kind: "graphic", library: "zgs-trail", animation: 70000 }, core), /0 to 65534/);
  assert.throws(() => Assets.addAsset(root, { kind: "graphic", library: "zgs-trail", animation: "7638" }, core), /0 to 65534/);
  assert.throws(() => Assets.addAsset(root, { kind: "graphic", library: "zgs-trail", animation: 65000 }, core), /No animation 65000/);
  assert.equal(Assets.assetsOf(root).length, 0, "nothing was stored");
  // A cache animation is a valid link (the graphic's own anim/ is then left out).
  const linked = Assets.addAsset(root, { kind: "graphic", library: "zgs-trail", animation: 7638, name: "linked" }, core);
  assert.equal(linked.asset.animation, 7638);

  // Its model is stored first; its anim/ then fails (a trailing byte): the document is put back.
  const before = Document.read(root);
  const anim = path.join(root, "data/models/zgs-trail/anim/frames");
  const frame = path.join(anim, fs.readdirSync(anim)[0]);
  fs.writeFileSync(frame, Buffer.concat([fs.readFileSync(frame), Buffer.from([0])]));
  assert.throws(() => Assets.addAsset(root, { kind: "graphic", library: "zgs-trail", name: "broken" }, core), /after its last value/);
  assert.deepEqual(Document.read(root), before, "no model, animation or graphic row was left");
});

test("an animation with a missing frame or a bad frame is refused with the reason", () => {
  const root = rootWith({ "zamorak-godsword-special/player-anim": "zgs" });
  const files = base64Files(path.join(root, "data/models/zgs"));
  const frame = Object.keys(files).find((name) => name.startsWith("frames/"));
  const missing = { ...files };
  delete missing[frame];
  assert.throws(() => Assets.addAsset(root, { kind: "animation", files: missing, name: "broken" }, core), new RegExp(`missing ${frame}`));
  assert.throws(() => Assets.addAsset(root, { kind: "animation", files: { ...files, [frame]: Buffer.from([0, 0, 255]).toString("base64") }, name: "broken" }, core), /truncated|slots/);
  assert.throws(() => Assets.addAsset(root, { kind: "animation", files: { "../seq.dat": "AA==" }, name: "x" }, core), /Bad file name/);
  assert.throws(() => Assets.addAsset(root, { kind: "animation", library: "../../definitions" }, core), /under data\/models/);
  assert.equal(Assets.assetsOf(root).length, 0, "nothing was stored");
});

test("a graphic stores its model and its own animation as assets, and loads as the game sends it", () => {
  const root = rootWith({ "zamorak-godsword-special/graphic": "zgs-trail" });
  const { asset, parts } = Assets.addAsset(root, { kind: "graphic", library: "zgs-trail" }, core);
  assert.equal(asset.id, 50000);
  assert.equal(asset.name, "zgs_trail");
  const model = parts.find((part) => part.kind === "model");
  const animation = parts.find((part) => part.kind === "animation");
  assert.equal(asset.model, model.id, "points at its model asset");
  assert.equal(asset.animation, animation.id, "and at its animation asset");
  assert.equal(animation.name, "zgs_trail_anim");
  assert.deepEqual(Assets.customModels(root).map((row) => row.id), [model.id], "the model ships with the editor's custom models");

  const loaded = CustomAnimations._test.loadCustomAnimations({ CacheDefinitions, encodeContentData }, root);
  try {
    const gfx = CacheDefinitions.getSpotanim(asset.id);
    assert.equal(gfx.modelId, model.id);
    assert.equal(gfx.animationId, animation.id);
    assert.equal(CacheDefinitions.getCustomSpotanimId("zgs_trail"), asset.id);
    assert.equal(CacheDefinitions.getSeqId("zgs_trail_anim"), animation.id);
    assert.equal(loaded.rows.length, 2);
  } finally {
    CustomAnimations._test.loadCustomAnimations({ CacheDefinitions, encodeContentData });
  }

  // Back to data/models for Blender, then in again over the same graphic: same ids, same names.
  const exported = Assets.exportAsset(root, { kind: "graphic", id: asset.id, folder: "zgs-trail-edit" });
  assert.ok(exported.written.includes("spotanim.dat") && exported.written.includes("model.dat") && exported.written.includes("anim/seq.dat"));
  assert.throws(() => Assets.exportAsset(root, { kind: "graphic", id: asset.id, folder: "zgs-trail-edit" }), /already exists/);
  const again = Assets.addAsset(root, { kind: "graphic", library: "zgs-trail-edit", replace: asset.id }, core);
  assert.equal(again.asset.id, asset.id);
  assert.equal(again.asset.animation, animation.id, "its animation was replaced in place");
  assert.equal(Assets.assetsOf(root).filter((row) => row.kind === "animation").length, 1);
});

test("the asset library lists the add-ons' exports by kind", () => {
  const root = rootWith({ "zamorak-godsword-special": "zgs" });
  const models = Assets.library(root, "model").map((entry) => entry.path);
  assert.ok(models.includes("zgs/player.dat") && models.includes("zgs/graphic/model.dat"), "model files");
  assert.ok(!models.some((name) => /seq\.dat|spotanim\.dat|framemap|frames\//.test(name)), "not animation files");
  assert.deepEqual(Assets.library(root, "animation").map((entry) => entry.path), ["zgs/graphic/anim", "zgs/player-anim"]);
  assert.deepEqual(Assets.library(root, "graphic").map((entry) => entry.path), ["zgs/graphic"]);
  const imported = Assets.addAsset(root, { kind: "model", library: "zgs/player.dat" }, core);
  assert.equal(imported.asset.name, "zgs/player.dat", "named by its library path");
  assert.equal(Assets.library(root, "model").find((entry) => entry.path === "zgs/player.dat").stored, imported.asset.id, "an imported model says so");
});

test("the extractor runs on the loaded cache: details, extraction, an NPC's animations and an animation's bodies", async () => {
  const root = rootWith({});
  const extract = createExtract(core, root);
  const whip = extract.details("item", 4151);
  assert.equal(whip.name, "Abyssal whip");
  assert.ok(whip.rows.some((row) => row.file === "drop.dat"));
  assert.throws(() => extract.details("varbit", 1), /nothing to extract/);
  const written = extract.extract("item", 4151, "abyssal-whip");
  assert.ok(written.written.includes("drop.dat") && written.written.includes("README.md"));
  assert.ok(fs.existsSync(path.join(root, "data/models/abyssal-whip/drop.dat")));
  assert.throws(() => extract.extract("item", 4151, "abyssal-whip"), (failure) => failure.status === 409);

  const zgs = extract.details("seq", 7638);
  assert.ok(zgs.rows.some((row) => row.file === "seq.dat"), "an animation's files");

  const jad = await extract.npcAnimations(3127);
  assert.ok(jad.used.some((row) => row.roles.includes("Attack") && row.sources.includes("server")), "Jad's attacks, from the server's own NPC definitions");
  const bodies = await extract.bodies(808);
  assert.equal(bodies.playerSkeleton, true);
  assert.ok(bodies.bodies.length > 0 && bodies.bodies.every((body) => body.kind === "npc"), "NPC bodies for a player animation");
});

test("the authoring service serves the library, extraction and imports to the local page only", async () => {
  const root = rootWith({ "zamorak-godsword-special/player-anim": "zgs" });
  const { handle } = createAuthoring(core, root);
  const server = require("node:http").createServer(handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = `http://localhost:${process.env.PORT || 3000}`;
  const call = async (route, body) => {
    const response = await fetch(`${base}${route}`, body === undefined ? { headers: { Origin: origin } } : {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  try {
    assert.equal((await fetch(`${base}/library?kind=animation`, { headers: { Origin: "http://evil.example" } })).status, 403);
    assert.deepEqual((await call("/library?kind=animation")).body.entries.map((entry) => entry.path), ["zgs"]);
    const imported = await call("/assets", { kind: "animation", library: "zgs" });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.asset.id, 50000);
    assert.equal((await call("/extract?kind=item&id=4151")).body.name, "Abyssal whip");
    assert.equal((await call("/extract", { kind: "item", id: 4151, folder: "whip" })).status, 200);
    const again = await call("/extract", { kind: "item", id: 4151, folder: "whip" });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "EXISTS");
    assert.match((await call("/extract?kind=seq&id=50000")).body.unsupported ?? "", /animation asset/, "a custom animation is exported, not extracted");
    assert.equal((await call("/assets/export", { kind: "animation", id: 50000, folder: "zgs-again" })).status, 200);
    assert.ok(Document.read(root).assets.length === 1);
  } finally {
    server.close();
  }
});
