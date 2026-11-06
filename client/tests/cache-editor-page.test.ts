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
import { previewModels, previewSpec, sequenceFrameCount } from "../custom/cache-editor/CacheEditorPreview";

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

console.log("cache-editor preview specs ok");

import { CustomDefinitionLoader, replaceCustomDefinitions, getCustomDefinitions } from "../custom/definitions/CustomDefinitionStore";
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
assert.equal(loader.load(50000), custom);
replaceCustomDefinitions([]);
assert.equal(loader.getCount(), 10);
assert.equal(loader.load(1), canonical);
console.log("custom definition client identity, isolation and reset ok");

import { formatFieldValue, parseFieldValue, initialOverrides } from "../custom/cache-editor/CacheEditorModel";
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
console.log("cache-editor structured fields and new names ok");

assert.deepEqual(previewModels({ ...loc, values: { models: [[15402, 15403], [15404]] } }), [15402, 15403, 15404]);
assert.ok(previewSpec({ ...loc, values: { models: [[15402]], seqId: 3206 } }));

assert.equal(sequenceFrameCount({ seqTypeLoader: { load: () => ({ isSkeletalSeq: () => true, getSkeletalDuration: () => 42 }) } } as any, 1), 42);
