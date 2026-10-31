// Run after `yarn build`: node --test tests/cache-editor.test.cjs
//
// Every assertion here reads the real copied cache, so a wrong field name or a link that resolves in
// theory but not against this revision fails here rather than in the editor.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const Fields = require("../plugins/tools/cache-editor/Fields.CacheEditor");
const Inspect = require("../plugins/tools/cache-editor/Inspect.CacheEditor");

const core = { CacheDefinitions, ObjectDefinition: require("../dist/game/definition/ObjectDefinition").ObjectDefinition };
const inspect = (request) => Inspect.describe(core, request);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

test("the field table is internally consistent", () => {
  for (const kind of Object.keys(Fields.FIELDS)) {
    assert.ok(Fields.KINDS[kind], `${kind} has fields but no kind entry`);
    const seen = new Set();
    for (const field of Fields.FIELDS[kind]) {
      assert.ok(!seen.has(field.name), `${kind}.${field.name} is listed twice`);
      seen.add(field.name);
      if (field.ref) assert.ok(Fields.KINDS[field.ref], `${kind}.${field.name} points at unknown kind ${field.ref}`);
      if (field.multi) assert.ok(Fields.fieldOf(kind, field.multi), `${kind}.${field.name} is gated by ${field.multi}, which must be a field of the same kind`);
    }
  }
  assert.deepEqual(Fields.referencedKinds("loc").includes("seq"), true);
  assert.throws(() => Fields.kindOf("nonsense"), /Unknown cache kind/);
});

test("a loc reports its links with names, and a non-definition target stays unverified", () => {
  const { objects } = CacheDefinitions.getCounts();
  let sample = null;
  for (let id = 0; id < objects && !sample; id++) {
    const definition = CacheDefinitions.getObject(id);
    if (definition?.seqId >= 0 && definition.models?.length) sample = definition;
  }
  assert.ok(sample, "the cache has a loc with an animation");
  const described = inspect({ kind: "loc", id: sample.id, skipUnset: false });
  const animation = described.links.find((link) => link.field === "seqId");
  assert.ok(animation, "the loc's animation is a link");
  assert.equal(animation.kind, "seq");
  assert.equal(animation.id, sample.seqId);
  assert.equal(animation.exists, "known", "a named sequence resolves");
  assert.match(animation.name ?? "", /.+/);
  const models = described.links.filter((link) => link.field === "models");
  assert.ok(models.length > 0, "models are reported as model links");
  assert.equal(models[0].exists, "unverified", "models are archive assets, not resolved definitions");
});

test("a multi-loc is reported as a gated placeholder with its children", () => {
  const { objects } = CacheDefinitions.getCounts();
  let sample = null;
  for (let id = 0; id < objects && !sample; id++) {
    const definition = CacheDefinitions.getObject(id);
    if (definition?.transforms?.length > 1) sample = definition;
  }
  assert.ok(sample, "the cache has a multi-loc");
  const described = inspect({ kind: "loc", id: sample.id });
  assert.ok(described.transforms, "a multi-def exposes its transform block");
  assert.equal(described.transforms.children.length, sample.transforms.filter((child) => child >= 0).length,
    "unset children are padding, not transforms");
  assert.ok(described.transforms.gatedBy, "and the variable that selects between them");
  assert.match(described.transforms.note, /placeholder/);
  assert.equal(described.transforms.children[0].exists, "known");
});

test("an item links to its noted form and a varbit names its varp and width", () => {
  const noted = CacheDefinitions.getItem(4151);
  assert.ok(noted, "item 4151 loads");
  const described = inspect({ kind: "item", id: 4151 });
  assert.equal(described.name, noted.name);
  const link = described.links.find((entry) => entry.field === "notedId" && entry.id === noted.notedId);
  if (noted.notedId >= 0) assert.ok(link, "the noted form is a link when the cache sets one");

  const varbit = CacheDefinitions.getVarbit(1788);
  const describedBit = inspect({ kind: "varbit", id: 1788 });
  assert.equal(describedBit.values.baseVar, varbit.baseVar);
  assert.equal(describedBit.values.startBit, varbit.startBit);
  assert.equal(describedBit.values.endBit, varbit.endBit);
  assert.equal(describedBit.links.find((entry) => entry.field === "baseVar").kind, "varp");
});

test("a db row resolves its table and column names through gamevals", () => {
  const row = CacheDefinitions.getDbRow(14);
  const table = row.tableId;
  assert.equal(typeof table, "number");
  assert.ok(CacheDefinitions.getDbColumns(table).length > 10, "the table's columns are named");
  const described = inspect({ kind: "dbro", id: 14 });
  assert.equal(described.values.tableId, table);
  assert.equal(described.links.find((entry) => entry.field === "tableId").kind, "dbtable");
  const columns = Object.keys(described.values.columns ?? {});
  assert.ok(columns.some((column) => column.includes("endstate")), `endstate is named: ${columns.join(", ")}`);
  const tableDescription = inspect({ kind: "dbtable", id: table });
  assert.ok(tableDescription.values.columns.includes("endstate"));
});

test("search finds ids by developer name and reports unnamed kinds honestly", () => {
  const loc = CacheDefinitions.getLocId("ent_totems_site_1_base");
  assert.ok(loc !== null);
  const hits = Inspect.search(core, { kind: "loc", text: "ent_totems_site_1_base", limit: 5 });
  assert.equal(hits[0].kind, "loc");
  assert.equal(hits[0].id, loc);
  const byId = Inspect.search(core, { kind: "loc", text: String(loc), limit: 5 });
  assert.ok(byId.some((hit) => hit.id === loc), "a numeric search matches by id");
  assert.throws(() => Inspect.search(core, { text: "  " }), /Give some text/);
  const kinds = Inspect.kinds(core);
  assert.ok(kinds.find((entry) => entry.kind === "loc").named > 1000);
  assert.equal(kinds.find((entry) => entry.kind === "seq").decoded, true, "sequences have a decoder now");
  assert.equal(kinds.find((entry) => entry.kind === "varp").decoded, false, "and a kind without one says so");
});

test("a kind without a decoder still names the id instead of inventing fields", () => {
  const described = inspect({ kind: "varp", id: 29 });
  assert.equal(described.kind, "varp");
  assert.equal(described.exists, true);
  assert.equal(described.values, undefined);
  assert.match(described.note, /no varp decoder/i);
});

test("an id that does not exist is missing, in both directions", () => {
  const { objects } = CacheDefinitions.getCounts();
  // Past the end of a counted kind: proven absent, not merely unnamed.
  const beyond = CacheDefinitions.hasDefinition("loc", objects + 10);
  assert.equal(beyond, false, "the archive proves a loc past the end is absent");
  const described = inspect({ kind: "loc", id: objects + 10 });
  assert.equal(described.exists, false);
  assert.equal(described.values, undefined, "no fake default definition is invented");
  assert.equal(described.name, null);
  assert.match(described.note, /No loc/);

  // A real but unnamed loc is not missing — 51 locs from 50742 have no gameval name.
  assert.equal(CacheDefinitions.hasDefinition("loc", 50742), true);
  assert.equal(Inspect.resolveId(core, "loc", 50742), "known");

  // Kinds whose absence cannot be proven answer "unknown", never a guess.
  assert.equal(CacheDefinitions.hasDefinition("varp", 29), undefined);
  assert.equal(CacheDefinitions.hasDefinition("struct", 999999), undefined);
  assert.equal(Inspect.resolveId(core, "struct", 999999), "unverified");
  assert.equal(CacheDefinitions.hasDefinition("varbit", 999999), false);
  assert.equal(Inspect.resolveId(core, "varbit", 999999), "missing");
  // A named sequence we know exists resolves, and one past the archive does not.
  assert.equal(Inspect.resolveId(core, "seq", 3206), "known");
  assert.equal(Inspect.resolveId(core, "seq", 999999), "missing" === "missing" ? "missing" : "missing");
});

test("npc models, item count variants and params are links too", () => {
  const npc = inspect({ kind: "npc", id: 1 });
  assert.ok(npc.links.some((entry) => entry.field === "modelIds" || entry.field === "chatheadModelIds"),
    "an npc's models are reported");
  const items = [];
  for (let id = 0; id < CacheDefinitions.getCounts().items && items.length < 1; id++) {
    const definition = CacheDefinitions.getItem(id);
    if (definition?.countObj?.length) items.push(definition);
  }
  if (items.length) {
    const described = inspect({ kind: "item", id: items[0].id });
    const counted = described.links.find((entry) => entry.field === "countObj");
    assert.ok(counted, "countObj links to the items it counts");
    assert.equal(counted.kind, "item");
  }
  const withParams = inspect({ kind: "item", id: 4151 });
  const params = withParams.links.find((entry) => entry.field === "params");
  if (params) assert.equal(params.kind, "param", "a param map's keys are links");
});

test("used_by answers the reverse question from real definitions", () => {
  const { objects } = CacheDefinitions.getCounts();
  let sample = null;
  for (let id = 0; id < objects && !sample; id++) {
    const definition = CacheDefinitions.getObject(id);
    if (definition?.seqId >= 0) sample = definition;
  }
  const reverse = Inspect.usedBy(core, { kind: "seq", id: sample.seqId, limit: 200 });
  assert.ok(reverse.count > 0, "the animation is referenced by at least the loc we found");
  assert.ok(reverse.sources.some((entry) => entry.kind === "loc" && entry.id === sample.id));
  assert.ok(reverse.sources.every((entry) => entry.name !== undefined));
  // Memoised: the second call must not rescan.
  const again = Inspect.usedBy(core, { kind: "seq", id: sample.seqId, limit: 200 });
  assert.equal(again.count, reverse.count);
});

test("browsing every loc and npc definition does not throw", () => {
  const { objects } = CacheDefinitions.getCounts();
  for (let id = 0; id < Math.min(objects, 400); id++) Inspect.describe(core, { kind: "loc", id });
  for (let id = 0; id < 200; id++) Inspect.describe(core, { kind: "npc", id });
  assert.throws(() => Inspect.describe(core, { kind: "loc", id: -1 }), /non-negative/);
});

test("a sequence reports its frames and its held items, and does not pretend frames are definitions", () => {
  const seq = CacheDefinitions.getSeq(3206);
  assert.ok(seq.frameIds.length > 0, "the cache's crate-shake sequence has frames");
  const described = inspect({ kind: "seq", id: 3206 });
  assert.equal(described.name, "quest_mcannon_crate_shake");
  assert.equal(described.values.maxLoops, seq.maxLoops);
  const frames = described.links.filter((entry) => entry.field === "frameIds");
  assert.ok(frames.length > 0, "frames are reported");
  assert.equal(frames[0].exists, "unverified", "a frame is an archive entry, not a definition");
  assert.match(frames[0].note, /frame archive/);
  for (const held of ["leftHandItem", "rightHandItem"]) {
    const link = described.links.find((entry) => entry.field === held);
    if (link) assert.equal(link.kind, "item");
  }
});

test("a graphic links to its model and its animation, which is the loc-to-animation hop", () => {
  const spot = CacheDefinitions.getSpotanim(1);
  assert.ok(spot.modelId > 0);
  const described = inspect({ kind: "spotanim", id: 1 });
  assert.equal(described.name, "firebreath_attack");
  const animation = described.links.find((entry) => entry.field === "animationId");
  assert.ok(animation, "a graphic names the sequence it plays");
  assert.equal(animation.kind, "seq");
  assert.equal(animation.id, spot.animationId);
  assert.equal(animation.exists, "known");
  assert.equal(described.links.find((entry) => entry.field === "modelId").exists, "unverified");
  // The two hops the user asked about: loc -> sequence, graphic -> sequence.
  const loc = inspect({ kind: "loc", id: 1 });
  assert.equal(loc.links.find((entry) => entry.field === "seqId").kind, "seq");
});

const fs = require("node:fs");
const os = require("node:os");
const Document = require("../plugins/tools/cache-editor/Document.CacheEditor.cjs");
const Catalog = require("../plugins/tools/cache-editor/Catalog.CacheEditor.plugin.js");
const { deflateSync } = require("node:zlib");

function scratchRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cache-editor-"));
  fs.mkdirSync(path.join(root, "server", "data", "definitions"), { recursive: true });
  return root;
}

test("an overlay row is rejected when its links do not resolve", () => {
  const { objects } = CacheDefinitions.getCounts();
  const base = (() => {
    for (let id = 0; id < objects; id++) {
      const definition = CacheDefinitions.getObject(id);
      if (definition?.seqId >= 0) return definition;
    }
    return null;
  })();
  assert.ok(base);
  const start = Math.max(Document.OVERLAY_ID_START, objects);
  const ok = { kind: "loc", id: start, baseId: base.id, fields: { seqId: base.seqId } };
  assert.deepEqual(Document.audit(core, ok), [], "a resolvable override is clean");

  assert.match(Document.audit(core, { ...ok, fields: { transforms: [objects + 5] } }).join(" "), /missing loc/);
  assert.match(Document.audit(core, { ...ok, fields: { transforms: [start] } }).join(" "), /points at itself/);
  assert.match(Document.audit(core, { ...ok, fields: { notAField: 1 } }).join(" "), /no field "notAField"/);
  assert.match(Document.audit(core, { ...ok, fields: { seqId: [1, 2] } }).join(" "), /not a list/);
  assert.match(Document.audit(core, { ...ok, id: 5 }).join(" "), /overlay ids start at/);
  assert.match(Document.audit(core, { ...ok, baseId: 999999 }).join(" "), /baseId must be a cache id below/);
});

test("saving writes the document atomically, checks the budget, and refuses stale revisions", () => {
  const root = scratchRoot();
  const { objects } = CacheDefinitions.getCounts();
  const base = CacheDefinitions.getObject(1);
  const start = Math.max(Document.OVERLAY_ID_START, objects);
  const row = { kind: "loc", id: start, baseId: 1, fields: { seqId: base.seqId } };

  const first = Document.save(core, root, { row });
  assert.equal(first.rows.length, 1);
  assert.equal(first.restartRequired, true);
  assert.ok(fs.existsSync(path.join(root, "server/data/definitions", Document.DOCUMENT)));

  assert.throws(() => Document.save(core, root, { row: { ...row, id: start + 1 }, revision: "deadbeef" }), /changed since it was loaded/);
  const second = Document.save(core, root, { row: { ...row, id: start + 1 }, revision: first.revision });
  assert.deepEqual(second.rows.map((entry) => entry.id), [start, start + 1]);
  assert.equal(fs.readdirSync(path.join(root, "server/data/definitions")).filter((name) => name.endsWith(".tmp")).length, 0, "no temp file is left behind");

  // A document that cannot fit the client transport is refused before it is written.
  // Unique text, so the check measures the real compressed size instead of a run of one character.
  const noise = require("node:crypto").randomBytes(120000).toString("hex");
  const fat = { version: 1, rows: [{ ...row, fields: { seqId: base.seqId, desc: noise } }] };
  assert.match(Document.check(core, fat).problems.join(" "), /transport budget/);
  assert.ok(deflateSync(Buffer.from(JSON.stringify(fat))).length > 0);
});

test("the read-only content endpoints serve what the MCP tools serve", () => {
  const endpoints = new Map();
  assert.equal(Catalog.name, "CacheEditorCatalog");
  const api = { core, registerContentEndpoint: (name, handler) => endpoints.set(name, handler), onServerStartup: () => {}, onPlayerLogin: () => {} };
  Catalog.register(api);
  assert.deepEqual([...endpoints.keys()].sort(), ["cache-assets", "cache-fields", "cache-inspect", "cache-kinds", "cache-search", "cache-used-by"]);

  const kinds = endpoints.get("cache-kinds")(new URLSearchParams(), []);
  assert.ok(kinds.kinds.some((entry) => entry.kind === "loc" && entry.count > 1000));

  const described = endpoints.get("cache-inspect")(new URLSearchParams({ kind: "loc", id: "1" }), []);
  assert.equal(described.name, "Crate");
  assert.ok(described.links.some((entry) => entry.field === "seqId"));

  const hits = endpoints.get("cache-search")(new URLSearchParams({ text: "ent_totems_site_1_base", kind: "loc" }), []);
  assert.equal(hits.hits[0].kind, "loc");

  const used = endpoints.get("cache-used-by")(new URLSearchParams({ kind: "seq", id: String(described.links.find((l) => l.field === "seqId").id) }), []);
  assert.ok(used.count > 0);

  assert.throws(() => endpoints.get("cache-inspect")(new URLSearchParams({ kind: "loc" }), []), /Missing \?id/);
  assert.throws(() => endpoints.get("cache-inspect")(new URLSearchParams({ kind: "loc", id: "-1" }), []), /non-negative/);
});

test("an overlay row is applied at load, so an authored loc is a real definition", () => {
  const { objects } = CacheDefinitions.getCounts();
  const start = Math.max(Document.OVERLAY_ID_START, objects);
  const base = (() => {
    for (let id = 0; id < objects; id++) {
      const definition = CacheDefinitions.getObject(id);
      if (definition?.seqId >= 0 && definition.name) return definition;
    }
    return null;
  })();
  assert.ok(base);
  // A different, real sequence, so the override is observable rather than a no-op.
  const otherSeq = base.seqId === 3206 ? 3207 : 3206;

  const applied = CacheDefinitions.registerCustomDefinitions([
    { kind: "loc", id: start, baseId: base.id, fields: { seqId: otherSeq, name: "Cache editor test loc" } },
  ]);
  assert.equal(applied, 1);
  assert.equal(CacheDefinitions.hasCustomDefinition("loc", start), true);
  assert.equal(CacheDefinitions.hasDefinition("loc", start), true, "an overlay id exists even though the cache is smaller");
  assert.equal(CacheDefinitions.getObject(start).seqId, otherSeq, "the override is what the game reads");
  assert.equal(CacheDefinitions.getObject(start).name, "Cache editor test loc");
  assert.equal(CacheDefinitions.getObject(base.id).seqId, base.seqId, "the base is untouched");
  assert.deepEqual(CacheDefinitions.getCustomDefinitions().map((row) => [row.kind, row.id, row.baseId]), [["loc", start, base.id]]);

  // The inspector reports it as an authored id, and resolves its links like any other.
  const described = inspect({ kind: "loc", id: start });
  assert.equal(described.exists, true);
  assert.equal(described.name, "Cache editor test loc");
  assert.equal(described.links.find((entry) => entry.field === "seqId").id, otherSeq);

  assert.equal(CacheDefinitions.registerCustomDefinitions([]), 0, "clearing the overlay restores the cache");
  assert.equal(CacheDefinitions.getObject(start).seqId, -1, "and the id is a cache default again");
});

test("the field table is served so a picker can search a target kind by name", () => {
  const endpoints = new Map();
  const api = { core, registerContentEndpoint: (name, handler) => endpoints.set(name, handler), onServerStartup: () => {}, onPlayerLogin: () => {} };
  Catalog.register(api);
  const body = endpoints.get("cache-fields")(new URLSearchParams({ kind: "loc" }), []);
  assert.equal(body.kind, "loc");
  const seq = body.fields.find((field) => field.name === "seqId");
  assert.deepEqual(seq, { name: "seqId", type: "int", ref: "seq", note: "the loc's animation" });
  assert.ok(body.fields.every((field) => field.ref), "only reference fields by default");
  assert.ok(!body.fields.some((field) => field.name === "sizeX"), "plain values are not offered as links");
  const all = endpoints.get("cache-fields")(new URLSearchParams({ kind: "loc", all: "1" }), []);
  assert.ok(all.fields.some((field) => field.name === "sizeX"), "?all=1 includes plain fields");
  assert.throws(() => endpoints.get("cache-fields")(new URLSearchParams({}), []), /Missing \?kind/);

  // The picker must only be offered kinds a search can answer for.
  const kinds = endpoints.get("cache-kinds")(new URLSearchParams(), []).kinds;
  const sprite = kinds.find((entry) => entry.kind === "sprite");
  assert.equal(sprite.usable, false, "a sprite archive has neither decoder nor names");
  assert.equal(sprite.searchable, false);
  assert.equal(kinds.find((entry) => entry.kind === "seq").searchable, true, "sequences can be filtered by name");
  assert.equal(kinds.find((entry) => entry.kind === "varp").usable, true, "a named kind is usable even without a decoder");
});

const Assets = require("../plugins/tools/cache-editor/Assets.CacheEditor.cjs");

/** A minimal but real cache model: the V3 trailer the loader looks for. */
function modelBytes(size = 64) {
  const bytes = Buffer.alloc(size, 7);
  bytes[bytes.length - 2] = 0xff; // -1
  bytes[bytes.length - 1] = 0xfd; // -3, i.e. version 3
  return bytes;
}

test("an uploaded model is stored once, named, and given an id above the cache", () => {
  const root = scratchRoot();
  const bytes = modelBytes();
  const first = Assets.addAsset(root, { kind: "model", name: "my_loc", data: bytes.toString("base64") });
  assert.equal(first.reused, false);
  assert.equal(first.asset.id, Assets.ASSET_KINDS.model.start, "models start at 1,000,000");
  assert.equal(first.asset.name, "my_loc");
  assert.equal(first.asset.size, bytes.length);
  assert.match(first.asset.file, /^model\/[0-9a-f]{32}\.dat$/);
  assert.ok(fs.existsSync(path.join(root, "server/data/assets", first.asset.file)));

  // The same bytes again are the same asset, not a second row and not a second file.
  const again = Assets.addAsset(root, { kind: "model", name: "duplicate", data: bytes.toString("base64") });
  assert.equal(again.reused, true);
  assert.equal(again.asset.id, first.asset.id);
  assert.equal(Assets.assetsOf(root).length, 1);

  // A different mesh gets the next id in the same kind.
  const second = Assets.addAsset(root, { kind: "model", name: "my_tree", data: modelBytes(80).toString("base64") });
  assert.equal(second.asset.id, first.asset.id + 1);

  // Kinds have their own ranges, so ids cannot collide across them.
  const sprite = Assets.addAsset(root, { kind: "sprite", name: "my_icon", data: Buffer.from("png-like").toString("base64") });
  assert.equal(sprite.asset.id, Assets.ASSET_KINDS.sprite.start);

  assert.deepEqual(Assets.customModels(root).map((row) => row.id), [first.asset.id, second.asset.id], "only models ship as custom models");
  assert.equal(Assets.assetNames(root).get(`model:${first.asset.id}`), "my_loc");

  const renamed = Assets.renameAsset(root, { kind: "model", id: first.asset.id, name: "my_door" });
  assert.equal(renamed.asset.name, "my_door");
});

test("an upload that is not a cache model is refused, with the reason", () => {
  const root = scratchRoot();
  assert.throws(() => Assets.addAsset(root, { kind: "nonsense", name: "x", data: "AAAA" }), /Unknown asset kind/);
  assert.throws(() => Assets.addAsset(root, { kind: "model", name: "x", data: "" }), /Missing file data/);
  assert.throws(() => Assets.addAsset(root, { kind: "model", name: "x", data: Buffer.from("not a model at all").toString("base64") }), /version trailer/);
  const huge = Buffer.alloc(Assets.ASSET_KINDS.model.maxBytes + 1, 0);
  huge[huge.length - 2] = 0xff;
  huge[huge.length - 1] = 0xfd;
  assert.throws(() => Assets.addAsset(root, { kind: "model", name: "x", data: huge.toString("base64") }), /cap is/);
  // Sprites are images, not models: no trailer requirement.
  assert.ok(Assets.addAsset(root, { kind: "sprite", name: "icon", data: "AAAA" }).asset);
});
