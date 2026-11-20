// Run after `yarn build`: node --test tests/model-extractor.test.cjs
// The Model Extractor (scripts/model-extractor, `yarn models`): search the cache for items, NPCs,
// objects, animations and graphics by id or name, write their files into data/models/<folder>/,
// and preview them (animations playing on an NPC or the player).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before } = require("node:test");
const { ModelExtractor, filesOf, fileRows, modelInfo, slug } = require("../scripts/model-extractor/ModelExtractor.cjs");
const { createHandler, allowed } = require("../scripts/model-extractor/server.cjs");
const { buildDecoder } = require("../scripts/model-extractor/decoder.cjs");
const { decodeKit } = require("../scripts/model-extractor/animations.cjs");
const vm = require("node:vm");

/** The page's scripts run in a bare context with `window`, as the browser runs them. */
function pageScripts(...sources) {
  const context = { console, Math, Map, atob, Float32Array, Int8Array, Uint8Array, Int32Array, Uint16Array, Int16Array };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  for (const source of sources) vm.runInContext(`${source}\n;this.OsrsModel = typeof OsrsModel === "undefined" ? undefined : OsrsModel;`, context);
  return context;
}

let extractor;
before(async () => {
  extractor = await new ModelExtractor(path.resolve(__dirname, "..")).open();
  extractor.modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-extractor-"));
});

test("files are named as the extracted folders so far", () => {
  assert.deepEqual(filesOf("item", { model: 1, maleModel: 2, femaleModel: 3, maleModel1: -1, maleHeadModel: 4, femaleHeadModel: 4 }).map((f) => [f.file, f.model]),
    [["drop.dat", 1], ["equip.dat", 2], ["equip-female.dat", 3], ["chathead.dat", 4]]);
  assert.deepEqual(filesOf("item", { model: 1, maleHeadModel: 4, femaleHeadModel: 5 }).map((f) => f.file), ["drop.dat", "chathead.dat", "chathead-female.dat"]);
  assert.deepEqual(filesOf("npc", { modelIds: [10], chatheadModelIds: [11] }).map((f) => f.file), ["body.dat", "chathead.dat"]);
  assert.deepEqual(filesOf("npc", { modelIds: [10, 12], chatheadModelIds: [] }).map((f) => f.file), ["body/10.dat", "body/12.dat"]);
  assert.deepEqual(filesOf("object", { models: [[7], [8, 7]], types: [10, 22] }).map((f) => [f.file, f.role]),
    [["model-7.dat", "Model (shape 10)"], ["model-8.dat", "Model (shape 22)"]]);
  assert.equal(slug("Twisted coat (t1)"), "twisted-coat-t1");
  assert.equal(slug("<col=ff0000>Fox</col> whistle"), "fox-whistle");
  // A v3 model's 26-byte header ends the file and starts with the vertex and face counts.
  const v3 = Uint8Array.from([9, 9, 0, 101, 0, 186, ...new Array(20).fill(0), 0xff, 0xfd]);
  assert.deepEqual(modelInfo(v3), { format: "v3", bytes: 28, vertices: 101, faces: 186 });
});

test("search by id or by every word of the name, best matches first", () => {
  assert.deepEqual(extractor.search("item", "28626").map((row) => row.name), ["Fox whistle"]);
  assert.deepEqual(extractor.search("item", "whistle fox").map((row) => row.id), [28626]);
  assert.equal(extractor.search("item", "28627").length, 1, "an id finds its placeholder too");
  assert.ok(!extractor.search("item", "fox whistle").some((row) => row.tag), "noted items and placeholders only when asked");
  assert.ok(extractor.search("item", "fox whistle", { includeVariants: true }).some((row) => row.tag === "placeholder"));
  const whips = extractor.search("item", "abyssal whip");
  assert.equal(whips[0].name, "Abyssal whip", "the exact name comes first");
  assert.equal(extractor.search("npc", "fennec fox")[0].id, 12980);
  assert.ok(extractor.search("object", "bank booth").length > 0);
  assert.deepEqual(extractor.search("item", "forestry pet whistle").map((row) => row.id), [28626], "gameval names are searched too");
  assert.deepEqual(extractor.search("item", ""), []);
});

test("details list each file with its model, format and the colour changes", () => {
  const coat = extractor.details("item", 24407);
  assert.deepEqual(coat.files.map((f) => [f.file, f.model]), [["drop.dat", 39047], ["equip.dat", 38966], ["equip-female.dat", 38977]]);
  assert.ok(coat.files.every((f) => f.format === "v3" && f.vertices > 0));
  assert.equal(coat.folder, "twisted-coat-t1");
  assert.ok(coat.notes.includes("Worn in the body slot; hides the arms"), coat.notes.join(" | "));
  assert.ok(!extractor.search("npc", "ornate undead combat dummy").some((row) => row.name.includes("<")), "colour tags are left out of names");
  const booth = extractor.details("object", extractor.search("object", "bank booth")[0].id);
  assert.ok(booth.recolours.length > 0);
  assert.ok(booth.notes.some((note) => note.startsWith("Recoloured")));
});

test("extract writes the cache's model bytes and a README, and asks before replacing a folder", () => {
  const result = extractor.extract("item", 28626, "fox-whistle");
  assert.deepEqual(result.written, ["drop.dat", "README.md"]);
  const bytes = fs.readFileSync(path.join(result.directory, "drop.dat"));
  assert.equal(bytes.length, 1090);
  assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xfd]);
  assert.match(fs.readFileSync(path.join(result.directory, "README.md"), "utf8"), /# Fox whistle \(item 28626\)[\s\S]*\| `drop.dat` \| 49875 \|/);
  assert.throws(() => extractor.extract("item", 28626, "fox-whistle"), (error) => error.code === "EXISTS");
  assert.doesNotThrow(() => extractor.extract("item", 28626, "fox-whistle", { overwrite: true }));
  for (const bad of ["../escape", "Fox Whistle", "", "a/b"]) {
    assert.throws(() => extractor.extract("item", 28626, bad), /folder name/, bad);
  }
  const fox = extractor.extract("npc", 12980, "fennec-fox");
  assert.deepEqual(fox.written, ["body.dat", "README.md"]);
});

test("animations and graphics are found by their gameval names and ids", () => {
  assert.deepEqual(extractor.search("animation", "atlatl attack ranged").map((row) => row.id), [11057]);
  assert.equal(extractor.search("animation", "human ready")[0].name, "human_ready", "underscores read as spaces; the exact name first");
  assert.equal(extractor.search("animation", "808")[0].name, "human_ready");
  assert.deepEqual(extractor.search("graphic", "1210").map((row) => row.name), ["dh_sword_update_zamorak_special_spotanim"]);
  assert.ok(extractor.search("graphic", "ice barrage").some((row) => row.id === 369));
  assert.ok(extractor.index("animation").some((row) => row.tag === "skeletal"), "skeletal animations are listed, tagged");
});

test("an animation is extracted as io_osrs_anim reads it: seq.dat, frames, frame maps and info.json", () => {
  const atlatl = extractor.details("animation", 11057);
  assert.equal(atlatl.folder, "human-atlatl-attack-ranged-01");
  assert.deepEqual(atlatl.files.map((f) => f.file).filter((file) => !file.startsWith("frames/")), ["seq.dat", "framemap-0.dat"]);
  assert.equal(atlatl.files.filter((f) => f.group === "frames/").length, 15);
  assert.equal(atlatl.files[1].file, "frames/10823-1.dat");
  assert.ok(atlatl.notes.includes("15 frames, 64 client cycles (1.28 s) per play"), atlatl.notes.join(" | "));
  assert.ok(atlatl.notes.includes("Left hand shows nothing (emptied) while it plays"));
  const rows = fileRows(atlatl.files);
  assert.deepEqual(rows.map((row) => row.file), ["seq.dat", "frames/ (15 files)", "framemap-0.dat"], "the frames are one row");

  const result = extractor.extract("animation", 11057, "atlatl-attack");
  assert.equal(result.written.length, 15 + 4, "15 frames, seq.dat, framemap-0.dat, info.json and the README");
  const info = JSON.parse(fs.readFileSync(path.join(result.directory, "info.json"), "utf8"));
  assert.equal(info.name, "human_atlatl_attack_ranged_01", "io_osrs_anim names the action from info.json");
  assert.deepEqual(info.framemaps, [0]);
  assert.equal(info.rightHand, 29515);
  assert.match(fs.readFileSync(path.join(result.directory, "README.md"), "utf8"), /\| `frames\/ \(15 files\)` \|/);
});

test("a graphic is extracted with its model and its animation in anim/, as io_osrs_gfx reads it", () => {
  const zgs = extractor.details("graphic", 1210);
  assert.deepEqual(zgs.files.filter((f) => !f.group).map((f) => [f.file, f.model ?? null]),
    [["spotanim.dat", null], ["model.dat", 28085], ["anim/seq.dat", null], ["anim/framemap-1581.dat", null]]);
  assert.equal(zgs.files.find((f) => f.file === "model.dat").format, "v2");
  const result = extractor.extract("graphic", 1210, "zgs-special-graphic");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory, "info.json"), "utf8")),
    { spotanim: 1210, model: 28085, seq: 7051, seqName: "dh_sword_update_zamorak_special_spotanim" });
  assert.ok(fs.existsSync(path.join(result.directory, "anim", "info.json")));
  const frames = new Set(extractor.cache.getSeq(7051).frameIds).size;
  assert.ok(frames < 40, "its 40 frames reuse some frame files");
  assert.equal(fs.readdirSync(path.join(result.directory, "anim", "frames")).length, frames, "each frame file once");
  assert.ok(fs.readFileSync(path.join(result.directory, "README.md"), "utf8").includes(`anim/frames/ (${frames} files)`), "the README counts the files");
});

test("a skeletal animation is shown but can't be extracted", () => {
  const skeletal = extractor.index("animation").find((row) => row.tag === "skeletal");
  const details = extractor.details("animation", skeletal.id);
  assert.deepEqual(details.files.map((f) => f.file), ["seq.dat"]);
  assert.match(details.unsupported, /Skeletal animations can't be extracted/);
  assert.throws(() => extractor.extract("animation", skeletal.id, "skeletal"), /Skeletal animations can't be extracted/);
  assert.ok(!fs.existsSync(path.join(extractor.modelsDir, "skeletal")), "nothing is written");
});

test("the preview decodes models with the client's decoder and hides what the game hides", () => {
  const decoder = buildDecoder(path.resolve(__dirname, "..", ".."));
  assert.equal(decoder.error, undefined, decoder.error);
  const page = pageScripts(decoder.code, fs.readFileSync(path.resolve(__dirname, "../scripts/model-extractor/preview.js"), "utf8"));
  const whistle = page.OsrsModel.decode(new Uint8Array(extractor.modelBytes(49875)));
  assert.equal(whistle.vertexCount, 101);
  assert.equal(whistle.faceCount, 186);
  const katana = fs.readFileSync(path.resolve(__dirname, "../data/models/dragonic-katana/drop.dat"));
  assert.equal(page.OsrsModel.decode(new Uint8Array(katana)).faceCount, 780, "the old model format too");

  const { buildMesh, hslToRgb } = page.ModelPreviewParts;
  assert.deepEqual(Array.from(hslToRgb(0)), [0, 0, 0]);
  assert.ok(hslToRgb(127).every((value) => value > 0.99), "full lightness is white");
  const triangle = (overrides) => ({
    faceCount: 4, x: [0, 128, 0], y: [0, 0, -128], z: [0, 0, 0], a: [0, 0, 0, 0], b: [1, 1, 1, 1], c: [2, 2, 2, 2],
    colors: [127, 127, 127, 127], alphas: [0, -1, 64, 0], textures: [-1, -1, -1, 5], renderTypes: [0, 0, 0, 1], ...overrides,
  });
  const mesh = buildMesh(triangle({}), null);
  assert.equal(mesh.shown, 2, "alpha -1 and a textured face of render type 1 are hidden");
  assert.equal(mesh.opaque.positions.length / 9, 1);
  assert.equal(mesh.clear.positions.length / 9, 1, "a see-through face is drawn apart");
  assert.ok(Math.abs(mesh.clear.colors[3] - (1 - 64 / 255)) < 1e-6);
  assert.deepEqual(Array.from(mesh.opaque.positions.slice(6, 9)), [0, 128, 0], "OSRS y points down, so it is flipped");
  const recoloured = buildMesh(triangle({ colors: [127, 127, 127, 127], alphas: null }), [[127, 0]]);
  assert.deepEqual(Array.from(recoloured.opaque.colors.slice(0, 3)), [0, 0, 0], "recolours apply to matching faces");
  assert.equal(recoloured.colourFaces.get(127), 3, "drawn faces are counted by the file's colour, before recolouring");
  assert.equal(recoloured.colourFaces.has(0), false);

  const { hslToHex } = page.ModelPreviewParts;
  assert.equal(hslToHex(0), "#000000");
  assert.equal(hslToHex(127), "#fefdfd", "the lightest colour is 127/128 light, as in the client's palette");
  const hex = hslToHex(926);
  assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.equal(hex, "#" + Array.from(hslToRgb(926)).map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join(""), "the hex is the colour the preview draws");
  assert.equal(hslToHex(-64610), hslToHex(-64610 & 0xffff), "signed cache values read as 16-bit colours");
});

test("the page's API answers only this machine's page", async () => {
  const handler = createHandler(extractor, 4790, { code: "var OsrsModel = {};" });
  const call = (url, headers, method = "GET") => new Promise((resolve) => {
    const response = { status: 0, body: "", writeHead(status) { this.status = status; }, end(body) { this.raw = body; this.body = String(body ?? ""); resolve(this); } };
    handler({ url, method, headers }, response);
  });
  const model = await call("/api/model?id=49875", { host: "localhost:4790" });
  assert.equal(model.status, 200);
  assert.equal(model.raw.length, 1090, "the model's raw bytes, for the preview");
  assert.equal((await call("/api/model?id=-1", { host: "localhost:4790" })).status, 400);
  assert.equal((await call("/decoder.js", { host: "localhost:4790" })).body, "var OsrsModel = {};");
  assert.match((await call("/preview.js", { host: "localhost:4790" })).body, /class ModelPreview/);
  const missing = createHandler(extractor, 4790, { error: "no esbuild" });
  assert.match((await new Promise((resolve) => missing({ url: "/decoder.js", method: "GET", headers: { host: "localhost:4790" } },
    { writeHead() {}, end(body) { resolve(String(body)); } }))), /OsrsModelError = "no esbuild"/);
  assert.equal(allowed({ headers: { host: "localhost:4790" } }, 4790), true);
  assert.equal(allowed({ headers: { host: "evil.example:4790" } }, 4790), false, "another host name (DNS rebinding)");
  assert.equal(allowed({ headers: { host: "localhost:4790", origin: "http://evil.example" } }, 4790), false, "another site's page");
  const found = await call("/api/search?kind=item&q=fox%20whistle", { host: "127.0.0.1:4790" });
  assert.equal(found.status, 200);
  assert.equal(JSON.parse(found.body).results[0].id, 28626);
  assert.equal((await call("/api/search?kind=spell&q=x", { host: "127.0.0.1:4790" })).status, 400);
  assert.equal((await call("/api/search?kind=item&q=x", { host: "evil.example:4790" })).status, 403);
  const page = await call("/", { host: "localhost:4790" });
  assert.equal(page.status, 200);
  assert.match(page.body, /Model Extractor/);
});

test("an NPC's animations: its movement from the cache, its combat from the server, then its skeleton's", () => {
  const jad = extractor.animations.npcAnimations(3127);
  const roles = new Map(jad.used.map((row) => [row.id, row]));
  assert.deepEqual(roles.get(2650).roles, ["Stand"]);
  assert.deepEqual(roles.get(2650).sources, ["cache"]);
  assert.deepEqual(roles.get(2652).roles, ["Attack"], "attacks aren't in the cache: the server's");
  assert.deepEqual(roles.get(2652).sources, ["server"]);
  assert.ok(jad.used.every((row) => row.fits), "all made for Jad's skeleton");
  assert.equal(jad.skeleton, 159);
  assert.equal(jad.playerSkeleton, false);
  assert.ok(jad.related.some((row) => row.id === 2655 && row.name === "lordmagmus_attack"), "an attack he doesn't play, by its skeleton");
  assert.ok(jad.related.every((row) => !roles.has(row.id)));
  const man = extractor.animations.npcAnimations(3106);
  assert.equal(man.playerSkeleton, true);
  assert.deepEqual(man.related, [], "the player skeleton fits thousands; none are listed");
});

test("an animation plays on the player, an NPC that plays it, or an NPC of its skeleton", () => {
  const attack = extractor.animations.animationBodies(2652);
  assert.deepEqual(attack.bodies[0], { kind: "npc", id: 3127, name: "TzTok-Jad", why: "plays it (Attack)" });
  assert.equal(new Set(attack.bodies.map((body) => `${body.name}`)).size, attack.bodies.length, "one body per look");
  const atlatl = extractor.animations.animationBodies(11057);
  assert.equal(atlatl.playerSkeleton, true);
  assert.deepEqual(atlatl.bodies, [{ kind: "player", id: 0, name: "Player", why: "the player skeleton" }]);
  assert.equal(extractor.animations.animationBodies(808).bodies[0].kind, "player", "the player first for a player animation");
  const unused = extractor.animations.animationBodies(2655);
  assert.equal(unused.bodies[0].why, "the same skeleton");
  assert.ok(unused.bodies.some((body) => body.id === 3127));
});

test("the default player is the first selectable kit of each body part, as the client picks them", () => {
  assert.deepEqual(extractor.animations.playerKits().map((kit) => kit.id), [0, 10, 18, 26, 33, 36, 42]);
  // Body part 2, a u16 model list (2: 300, 301), recolour 40: 10 -> 20, not selectable (3).
  const kit = decodeKit(Uint8Array.from([1, 2, 2, 2, 1, 44, 1, 45, 40, 1, 0, 10, 0, 20, 3, 0]));
  assert.deepEqual(kit, { bodyPart: 2, selectable: false, models: [300, 301], recolours: [[10, 20]], retextures: [] });
  const player = extractor.animations.body("player", 0);
  assert.equal(player.parts.length, 7);
  assert.equal(player.playerColours, true);
});

test("the preview poses bodies on an animation's frames with the client's own code", () => {
  const decoder = buildDecoder(path.resolve(__dirname, "..", ".."));
  assert.ok(decoder.code, decoder.error);
  const page = pageScripts(decoder.code, fs.readFileSync(path.resolve(__dirname, "../scripts/model-extractor/preview.js"), "utf8"));
  const json = (value) => JSON.parse(JSON.stringify(value));
  const { buildLitMesh, frameAt } = page.ModelPreviewParts;
  const sum = (model) => { let total = 0; for (let i = 0; i < model.verticesCount; i++) total += model.verticesX[i] + 3 * model.verticesY[i] + 7 * model.verticesZ[i]; return total; };
  const jad = page.OsrsModel.buildBody(json(extractor.animations.body("npc", 3127)));
  const smash = page.OsrsModel.loadAnimation(json(extractor.animations.animation(2652)));
  assert.equal(smash.frames.length, 12);
  assert.notEqual(sum(page.OsrsModel.pose(jad, smash, 0)), sum(page.OsrsModel.pose(jad, smash, 6)), "frames move the body");
  const mesh = buildLitMesh(page.OsrsModel.pose(jad, smash, 6));
  assert.equal(mesh.lit, true);
  assert.ok(mesh.shown > 900, "Jad's faces are drawn");
  const skeletal = extractor.animations.animation(2973);
  assert.ok(skeletal.keyframes && skeletal.skeletalId >= 0);
  const nagua = page.OsrsModel.buildBody(json(extractor.animations.body("npc", 12879)));
  const merge = page.OsrsModel.loadAnimation(json(skeletal));
  assert.ok(merge.skeletal);
  assert.equal(merge.lengths.length, skeletal.skeletalEnd - skeletal.skeletalStart, "a keyframe per client cycle");
  assert.notEqual(sum(page.OsrsModel.pose(nagua, merge, 0)), sum(page.OsrsModel.pose(nagua, merge, 60)));
  // Frames last their lengths in client cycles, then the animation loops.
  assert.deepEqual([0, 1, 2, 4, 5, 6].map((cycles) => frameAt([2, 3], cycles)), [0, 0, 1, 1, 0, 0]);
});

test("the page's API serves NPC animations, bodies and animations", async () => {
  const handler = createHandler(extractor, 4790, { code: "var OsrsModel = {};" });
  const call = (url) => new Promise((resolve) => {
    const response = { status: 0, writeHead(status) { this.status = status; }, end(body) { this.body = String(body ?? ""); resolve(this); } };
    handler({ url, method: "GET", headers: { host: "localhost:4790" } }, response);
  });
  const list = await call("/api/npc-animations?id=3127");
  assert.equal(list.status, 200);
  assert.ok(JSON.parse(list.body).used.length >= 5);
  assert.equal(JSON.parse((await call("/api/bodies?id=11057")).body).bodies[0].kind, "player");
  const body = JSON.parse((await call("/api/body?kind=npc&id=3127")).body);
  assert.equal(body.name, "TzTok-Jad");
  assert.ok(body.parts[0].bytes.length > 100, "models as base64");
  assert.equal((await call("/api/body?kind=item&id=4151")).status, 400);
  const animation = JSON.parse((await call("/api/animation?id=2652")).body);
  assert.equal(animation.frameIds.length, 12);
  assert.ok(animation.framemaps[159], "with its frame map");
  assert.equal((await call("/api/details?kind=graphic&id=1210")).status, 200);
  assert.equal(JSON.parse((await call("/api/details?kind=graphic&id=1210")).body).animation, 7051, "a graphic's own animation, for its preview");
});
