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
