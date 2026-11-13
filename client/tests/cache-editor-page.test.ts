// The cache editor page's pure half: paths, the authoring port, and draft validation.
import assert from "node:assert/strict";
import {
    authoringBase, draftProblems, draftRow, fieldsPath, inspectPath, kindsPath, linksByField, pickableFields,
    searchPath, usableKinds, usedByPath, withField, withPickedId,
} from "../custom/cache-editor/CacheEditorModel";

assert.equal(kindsPath(), "/api/cache-kinds");
assert.equal(inspectPath("loc", 1), "/api/cache-inspect?kind=loc&id=1");
assert.equal(searchPath("crate", "loc", 5), "/api/cache-search?text=crate&kind=loc&limit=5");
assert.equal(searchPath("crate"), "/api/cache-search?text=crate&limit=20", "kind is optional");
assert.equal(usedByPath("seq", 3206), "/api/cache-used-by?kind=seq&id=3206&limit=50");

// The authoring service is one above the game's websocket port, the same offset the server applies.
assert.equal(authoringBase("http://127.0.0.1:43594"), "http://127.0.0.1:44695");
assert.equal(authoringBase("https://worlds.example.com"), undefined, "a remote world has no local authoring service");
assert.equal(authoringBase(undefined), undefined);
assert.equal(authoringBase("nonsense"), undefined);

const base = { kind: "loc", id: 1, exists: true, name: "Crate", label: "Loc (object)" };
const row = draftRow(base, 1, 63307);
assert.deepEqual(row, { kind: "loc", id: 63307, baseId: 1, fields: {} });
assert.deepEqual(draftProblems(row, base, 63307), ["nothing is overridden yet"], "an empty overlay is not a save");
assert.deepEqual(draftProblems({ ...row, id: 12 }, base, 63307), ["id must be 63307 or above (above the cache's own count)", "nothing is overridden yet"]);
assert.deepEqual(draftProblems({ ...row, fields: { seqId: 1 } }, { ...base, exists: false }, 63307), ["base must be a definition that exists in the cache"]);
assert.deepEqual(draftProblems({ ...row, baseId: null, fields: { name: "Blank loc" } }, null, 63307), [], "an unbased definition is valid");

let edited = withField(row, "seqId", 3206);
assert.deepEqual(edited.fields, { seqId: 3206 });
edited = withField(edited, "models", [1, 2]);
edited = withField(edited, "models", []);
assert.deepEqual(edited.fields, { seqId: 3206 }, "clearing a list removes the override");
edited = withField(edited, "seqId", undefined);
assert.deepEqual(edited.fields, {}, "clearing a value removes the override");

const grouped = linksByField([
    { field: "models", kind: "model", id: 1, name: null, exists: "unverified" },
    { field: "models", kind: "model", id: 2, name: null, exists: "unverified" },
    { field: "seqId", kind: "seq", id: 3206, name: "quest_mcannon_crate_shake", exists: "known" },
]);
assert.deepEqual(grouped.map((group) => group.field), ["models", "seqId"]);
assert.equal(grouped[0].entries.length, 2, "a list field groups its targets");
assert.deepEqual(linksByField(undefined), []);

assert.equal(fieldsPath("loc"), "/api/cache-fields?kind=loc");

// Kinds with neither a decoder nor a name map are not offered at all, which is what "Sprite (no
// decoder)" in the selector was: an archive nothing can open.
const kinds = [
    { kind: "loc", label: "Loc", archive: "locs", decoded: true, usable: true, searchable: true, count: 63307 },
    { kind: "seq", label: "Seq", archive: "seqs", decoded: true, usable: true, searchable: true },
    { kind: "varp", label: "Varp", archive: "varps", decoded: false, usable: true, searchable: true },
    { kind: "sprite", label: "Sprite", archive: "sprites", decoded: false, usable: false, searchable: false },
];
assert.deepEqual(usableKinds(kinds).map((entry) => entry.kind), ["loc", "seq", "varp"], "sprite is not selectable");

// A picker only offers fields whose target can be searched by name.
const fields = [
    { name: "seqId", type: "int", ref: "seq" },
    { name: "mapSceneId", type: "int", ref: "sprite" },
    { name: "models", type: "int[]", ref: "model", many: true },
    { name: "name", type: "string" },
];
assert.deepEqual(pickableFields(fields, kinds).map((entry) => entry.name), ["seqId"], "models and sprites are not searchable");

// Picking sets a scalar, and appends to a list without duplicating.
const overlay = { kind: "loc", id: 63307, baseId: 1, fields: {} };
const seqField = { name: "seqId", type: "int", ref: "seq" };
const listField = { name: "randomSeqIds", type: "int[]", ref: "seq", many: true };
assert.deepEqual(withPickedId(overlay, seqField, 3206).fields, { seqId: 3206 });
assert.deepEqual(withPickedId(withPickedId(overlay, listField, 1), listField, 2).fields, { randomSeqIds: [1, 2] });
assert.deepEqual(withPickedId(withPickedId(withPickedId(overlay, listField, 1), listField, 2), listField, 1).fields, { randomSeqIds: [1, 2] }, "a pick never duplicates");
assert.deepEqual(withPickedId(withPickedId(overlay, seqField, 3206), seqField, 3207).fields, { seqId: 3207 }, "a scalar pick replaces");

console.log("cache-editor page model ok");

// Preview specs: which models a definition draws, and which sequence plays.
import { buildModelRecolorPairs, previewModels, previewSpec, scanModelColors, sequenceFrameCount } from "../custom/cache-editor/CacheEditorPreview";

const loc = {
    kind: "loc", id: 1, exists: true, name: "Crate", label: "Loc (object)",
    values: { models: [15402, 15403], seqId: 3206, zoom2d: 1800, ambient: 25, contrast: 100 },
};
assert.deepEqual(previewModels(loc), [15402, 15403], "a loc merges its model groups");
assert.deepEqual(previewSpec(loc, "loc", 3), {
    modelIds: [15402, 15403], sequenceId: 3206, sequenceFrame: 3,
    zoom2d: 1800, ambient: 25, contrast: 100,
});
assert.deepEqual(previewModels({ ...loc, kind: "npc", values: { modelIds: [7], idleSeqId: 808 } }), [7], "an npc uses modelIds");
assert.equal(previewSpec({ ...loc, kind: "npc", values: { modelIds: [7], idleSeqId: 808 } }, "npc").sequenceId, 808, "an npc idles");
assert.deepEqual(previewModels({ ...loc, kind: "item", values: { model: 5, maleModel: 6, femaleModel: 7 } }), [5, 6, 7], "an item previews its inventory and worn models");
assert.deepEqual(previewModels({ ...loc, kind: "spotanim", values: { modelId: 9, animationId: 86 } }), [9]);
assert.equal(previewSpec({ ...loc, kind: "spotanim", values: { modelId: 9, animationId: 86 } }, "spotanim").sequenceId, 86, "a graphic plays its animation");
assert.equal(previewSpec({ ...loc, kind: "loc", values: { seqId: 1 } }), null, "no models, nothing to draw");
assert.deepEqual(previewModels({ ...loc, kind: "varbit", values: {} }), [], "a kind with no models previews nothing");
assert.equal(sequenceFrameCount(undefined as any, 3206), 1, "without a client a sequence is a still");

const scanned = scanModelColors({
    getModel: (id: number) => id === 10
        ? { faceCount: 4, faceColors: new Uint16Array([20, 10, 20, 0]) } as any
        : undefined,
    missCount: 0,
} as any, [10, 10, 11]);
assert.deepEqual(scanned, { colors: [0, 10, 20], unavailableModelIds: [11], waiting: false }, "model colors are unique, sorted and missing models are reported");
let modelMisses = 0;
const waitingScan = scanModelColors({
    getModel: () => { modelMisses++; return undefined; },
    get missCount() { return modelMisses; },
} as any, [12]);
assert.deepEqual(waitingScan, { colors: [], unavailableModelIds: [12], waiting: true }, "sparse cache misses are retried while model data downloads");
assert.deepEqual(buildModelRecolorPairs([20, 10, 20], [10, 7], [15, 8]), [
    { from: 20, to: 20, isModelColor: true },
    { from: 10, to: 15, isModelColor: true },
    { from: 7, to: 8, isModelColor: false },
], "unmapped model colors default to themselves while existing extra pairs are retained");

console.log("cache-editor preview specs and model colors ok");

import { CustomDefinitionLoader, replaceCustomDefinitions, getCustomDefinitions } from "../custom/definitions/CustomDefinitionStore";
import { NpcType } from "../rs/config/npctype/NpcType";
import { LocType } from "../rs/config/loctype/LocType";
import { buildLocAabb } from "../game/math/Aabb";
const canonical = { id: 1, name: "Goblin", modelIds: [3], params: new Map([[1, "base"]]), isInteractive: 1 };
const loader = new CustomDefinitionLoader<any>({ load: () => canonical, getCount: () => 10, clearCache() {} }, "npc");
replaceCustomDefinitions([{ kind: "npc", id: 50000, baseId: 1, fields: { name: "Demo goblin", actions: [null], params: { "2": "custom" } } }]);
assert.equal(loader.getCount(), 50001);
const custom = loader.load(50000);
assert.equal(custom.id, 50000);
assert.equal(custom.name, "Demo goblin");
assert.equal(custom.isInteractive, 0);
assert.equal(custom.params.get(2), "custom");
custom.modelIds.push(4);
assert.deepEqual(canonical.modelIds, [3]);
const exported = getCustomDefinitions(); exported[0].fields.name = "mutated";
assert.equal(getCustomDefinitions()[0].fields.name, "Demo goblin");
assert.throws(() => replaceCustomDefinitions([{ kind: "npc", id: 1, baseId: 1, fields: {} }]), /Invalid/);
assert.throws(() => replaceCustomDefinitions([{ kind: "npc", id: 50001, baseId: -1, fields: {} }]), /Invalid/);
assert.throws(() => replaceCustomDefinitions([{ kind: "npc", id: 50001, fields: {} }]), /Invalid/, "missing baseId is not confused with explicit null");
assert.equal(loader.load(50000), custom);
replaceCustomDefinitions([]);
assert.equal(loader.getCount(), 10);
assert.equal(loader.load(1), canonical);
const cacheInfo = { name: "test", game: "oldschool", environment: "live", revision: 1, timestamp: "", size: 0 } as any;
const stockNpc = new NpcType(1, cacheInfo);
stockNpc.name = "Stock npc";
stockNpc.modelIds = [3];
const blankLoader = new CustomDefinitionLoader<NpcType>({ load: () => stockNpc, getCount: () => 10, clearCache() {} }, "npc");
replaceCustomDefinitions([{ kind: "npc", id: 50000, baseId: null, fields: { name: "Blank npc" } }]);
const blankNpc = blankLoader.load(50000);
assert.equal(blankNpc.id, 50000);
assert.equal(blankNpc.name, "Blank npc");
assert.equal(blankNpc.size, 1, "the type constructor supplies valid defaults");
assert.equal(blankNpc.modelIds, undefined, "a blank definition does not inherit the stock model");
const stockLoc = new LocType(1, cacheInfo);
const locLoader = new CustomDefinitionLoader<LocType>({ load: () => stockLoc, getCount: () => 10, clearCache() {} }, "loc");
replaceCustomDefinitions([
    { kind: "loc", id: 50001, baseId: null, fields: { name: "Model-only loc", models: [[1]], types: [10], actions: [] } },
    { kind: "loc", id: 50002, baseId: null, fields: { name: "Actionable loc", actions: ["Open"] } },
    { kind: "loc", id: 50003, baseId: null, fields: { name: "Explicit flags", models: [[1]], types: [10], isInteractive: 0, supportItems: 0 } },
    { kind: "loc", id: 50004, baseId: null, fields: { name: "Non-solid loc", clipType: 0 } },
]);
const modelOnlyLoc = locLoader.load(50001);
const actionableLoc = locLoader.load(50002);
const explicitLoc = locLoader.load(50003);
const nonSolidLoc = locLoader.load(50004);
assert.equal(modelOnlyLoc.id, 50001, "finalization preserves the custom definition identity");
assert.equal(modelOnlyLoc.isInteractive, 1, "model-only locs derive interactivity after authored models are applied");
assert.equal(modelOnlyLoc.supportItems, 1, "the default clipped loc supports items");
assert.equal(actionableLoc.isInteractive, 1, "actionable locs derive interactivity");
assert.equal(actionableLoc.supportItems, 1);
assert.equal(explicitLoc.isInteractive, 0, "explicit authored flags survive finalization");
assert.equal(explicitLoc.supportItems, 0);
assert.equal(nonSolidLoc.supportItems, 0, "supportItems derives from an authored non-clipping clipType");
const bounds = buildLocAabb({
    locId: 50001, tileX: 10, tileY: 20, level: 0,
    mapManager: { getMapForWorldTile: () => undefined }, locTypeLoader: locLoader, varManager: {},
});
assert.ok(bounds, "a finalized model-only loc has selectable client bounds");
replaceCustomDefinitions([]);
console.log("custom definition client identity, blank defaults, loc finalization, isolation and reset ok");

import { formatFieldValue, parseFieldValue, initialOverrides, supportsModelRecolor, packedHslToHex, hexToPackedHsl } from "../custom/cache-editor/CacheEditorModel";
for (const [field, value] of [
    [{ name: "actions", type: "string[]" }, ["Talk-to", null, "Trade"]],
    [{ name: "models", type: "int[][]" }, [[1, 2], [3]]],
    [{ name: "params", type: "map" }, { "1": "custom", "2": 3 }],
] as const) assert.deepEqual(parseFieldValue(field, formatFieldValue(value)), value);
assert.throws(() => parseFieldValue({ name: "models", type: "int[][]" }, "[1,2]"), /expected int/);
assert.throws(() => parseFieldValue({ name: "models", type: "int[]" }, "1,broken"), /valid JSON/);
assert.throws(() => parseFieldValue({ name: "size", type: "int" }, "1.5"), /expected int/);
assert.deepEqual(initialOverrides([{ name: "name", type: "string" }], "My goblin"), { name: "My goblin" });
assert.deepEqual(initialOverrides([], "Sequence"), {});
assert.equal(supportsModelRecolor("item"), true);
assert.equal(supportsModelRecolor("loc"), true);
assert.equal(supportsModelRecolor("npc"), true);
assert.equal(supportsModelRecolor("spotanim"), false);
assert.equal(packedHslToHex(0), "#000000");
assert.equal(packedHslToHex(127), "#ffffff");
assert.equal(hexToPackedHsl("#000000"), 0);
assert.equal(hexToPackedHsl("#ffffff"), 127);
const packedRed = hexToPackedHsl("#ff0000");
assert.equal((packedRed >>> 10) & 63, 0);
assert.equal((packedRed >>> 7) & 7, 7);
assert.match(packedHslToHex(packedRed), /^#ff[0-9a-f]{4}$/);
assert.throws(() => hexToPackedHsl("red"), /six-digit hex/);
console.log("cache-editor structured fields, recolors and new names ok");

assert.deepEqual(previewModels({ ...loc, values: { models: [[15402, 15403], [15404]] } }), [15402, 15403, 15404]);
assert.ok(previewSpec({ ...loc, values: { models: [[15402]], seqId: 3206 } }));

assert.equal(sequenceFrameCount({ seqTypeLoader: { load: () => ({ isSkeletalSeq: () => true, getSkeletalDuration: () => 42 }) } } as any, 1), 42);
