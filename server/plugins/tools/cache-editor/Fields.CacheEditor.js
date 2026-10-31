"use strict";

// What a definition of each kind holds, and which of its fields point at another definition.
//
// The cache stores no such metadata: a loc's `seqId` is just a number, and only knowledge makes it
// a sequence. The inspector resolves links from this table, and a form generated from it would ask
// for the same things. Fields are listed by name rather than opcode number, because names are stable
// across cache revisions and opcodes are not.
//
// `ref` names the kind the value points into. `verify: false` marks a target this server cannot
// resolve yet (models, sprites, sounds are archive assets, not decoded definitions), so the inspector
// reports the id and says it is unverified instead of guessing.

/** Every kind the editor knows about, and whether a decoder exists today. */
const KINDS = {
  loc: { label: "Loc (object)", archive: "locs", decoded: true, gameval: "loc", count: "objects" },
  npc: { label: "NPC", archive: "npcs", decoded: true, gameval: "npc", count: "npcs" },
  item: { label: "Item", archive: "objs", decoded: true, gameval: "obj", count: "items" },
  varbit: { label: "Varbit", archive: "varbits", decoded: true, gameval: "varbit" },
  varp: { label: "Varp", archive: "varps", decoded: false, gameval: "varp" },
  seq: { label: "Sequence (animation)", archive: "sequences", decoded: true, gameval: "seq" },
  spotanim: { label: "SpotAnim (graphic)", archive: "spotanims", decoded: true, gameval: "spotanim" },
  struct: { label: "Struct", archive: "structs", decoded: true, gameval: null },
  enum: { label: "Enum", archive: "enums", decoded: true, gameval: null },
  dbro: { label: "DB row", archive: "dbrows", decoded: true, gameval: "dbrow" },
  dbtable: { label: "DB table", archive: "dbtables", decoded: true, gameval: "dbtable" },
  idk: { label: "Identity kit", archive: "identkits", decoded: true, gameval: null },
  inv: { label: "Inventory", archive: "inventories", decoded: false, gameval: "inv" },
  bas: { label: "BAS (npc stance)", archive: "bases", decoded: false, gameval: null },
  model: { label: "Model", archive: "models", decoded: false, gameval: null, verify: false },
  sprite: { label: "Sprite", archive: "sprites", decoded: false, gameval: null, verify: false },
  sound: { label: "Sound", archive: "sounds", decoded: false, gameval: null, verify: false },
  param: { label: "Param", archive: "params", decoded: false, gameval: null },
};

const field = (name, type, extra = {}) => ({ name, type, ...extra });

const FIELDS = {
  loc: [
    field("name", "string"),
    field("desc", "string"),
    field("category", "int"),
    field("models", "int[]", { ref: "model", many: true, note: "model ids, flattened across the cache's groups" }),
    field("sizeX", "int"), field("sizeY", "int"),
    field("seqId", "int", { ref: "seq", note: "the loc's animation" }),
    field("randomSeqIds", "int[]", { ref: "seq", many: true, note: "played at random when the loc is interacted with" }),
    field("ambient", "int"), field("contrast", "int"),
    field("actions", "string[]"),
    field("recolorFrom", "int[]"), field("recolorTo", "int[]"),
    field("retextureFrom", "int[]"), field("retextureTo", "int[]"),
    field("mapSceneId", "int", { ref: "sprite" }),
    field("mapFunctionId", "int"),
    field("ambientSoundId", "int", { ref: "sound" }),
    field("ambientSoundIds", "int[]", { ref: "sound", many: true }),
    field("contourGroundParam", "int", { ref: "param" }),
    field("contouredGround", "int"), field("contourGroundType", "int"),
    field("clipType", "int"), field("clipMask", "int"),
    field("blocksProjectile", "boolean"),
    field("mergeNormals", "boolean"), field("modelClipped", "boolean"),
    field("isRotated", "boolean"), field("clipped", "boolean"),
    field("obstructsGround", "boolean"), field("isHollow", "boolean"),
    field("supportItems", "int"),
    field("flipMapSceneSprite", "boolean"),
    field("decorDisplacement", "int"),
    field("params", "map", { ref: "param", note: "param id -> value" }),
    field("transformVarbit", "int", { ref: "varbit", multi: "transforms" }),
    field("transformVarp", "int", { ref: "varp", multi: "transforms" }),
    field("transforms", "int[]", { ref: "loc", many: true, transform: true }),
  ],
  npc: [
    field("name", "string"),
    field("desc", "string"),
    field("category", "int"),
    field("modelIds", "int[]", { ref: "model", many: true }),
    field("chatheadModelIds", "int[]", { ref: "model", many: true }),
    field("size", "int"),
    field("combatLevel", "int"),
    field("attackLevel", "int"), field("defenceLevel", "int"), field("strengthLevel", "int"),
    field("hitpoints", "int"), field("rangedLevel", "int"), field("magicLevel", "int"),
    field("attackSpeed", "int"),
    field("actions", "string[]"),
    field("idleSeqId", "int", { ref: "seq" }),
    field("walkSeqId", "int", { ref: "seq" }), field("walkBackSeqId", "int", { ref: "seq" }),
    field("walkLeftSeqId", "int", { ref: "seq" }), field("walkRightSeqId", "int", { ref: "seq" }),
    field("runSeqId", "int", { ref: "seq" }), field("runBackSeqId", "int", { ref: "seq" }),
    field("runLeftSeqId", "int", { ref: "seq" }), field("runRightSeqId", "int", { ref: "seq" }),
    field("crawlSeqId", "int", { ref: "seq" }), field("crawlBackSeqId", "int", { ref: "seq" }),
    field("crawlLeftSeqId", "int", { ref: "seq" }), field("crawlRightSeqId", "int", { ref: "seq" }),
    field("turnLeftSeqId", "int", { ref: "seq" }), field("turnRightSeqId", "int", { ref: "seq" }),
    field("headIconPrayer", "int", { ref: "sprite" }),
    field("headIconSpriteIds", "int[]", { ref: "sprite", many: true }),
    field("headIconSpriteIndices", "int[]"),
    field("basTypeId", "int", { ref: "bas" }),
    field("widthScale", "int"), field("heightScale", "int"),
    field("footprintSize", "int"), field("heightOffset", "int"),
    field("spawnDirection", "int"), field("rotationSpeed", "int"),
    field("ambient", "int"), field("contrast", "int"),
    field("isVisible", "boolean"), field("isFollower", "boolean"),
    field("canHideForOverlap", "boolean"), field("overlapTintHsl", "int"),
    field("drawMapDot", "boolean"), field("drawPriority", "int"),
    field("isInteractable", "boolean"), field("isClickable", "boolean"),
    field("isClipped", "boolean"),
    field("params", "map", { ref: "param", note: "param id -> value" }),
    field("transformVarbit", "int", { ref: "varbit", multi: "transforms" }),
    field("transformVarp", "int", { ref: "varp", multi: "transforms" }),
    field("transforms", "int[]", { ref: "npc", many: true, transform: true }),
  ],
  item: [
    field("name", "string"),
    field("examine", "string"),
    field("model", "int", { ref: "model" }),
    field("maleModel", "int", { ref: "model" }),
    field("femaleModel", "int", { ref: "model" }),
    field("maleHeadModel", "int", { ref: "model" }),
    field("femaleHeadModel", "int", { ref: "model" }),
    field("resizeX", "int"), field("resizeY", "int"), field("resizeZ", "int"),
    field("ambient", "int"), field("contrast", "int"),
    field("price", "int"), field("weight", "number"), field("team", "int"),
    field("wearPos", "int"), field("category", "int"),
    field("isMembers", "boolean"), field("isTradable", "boolean"), field("isUnlockable", "boolean"),
    field("countObj", "int[]", { ref: "item", many: true, note: "items this one counts, for stack variants" }),
    field("note", "int", { ref: "item" }),
    field("noteTemplate", "int", { ref: "item" }),
    field("unnotedId", "int", { ref: "item" }),
    field("notedId", "int", { ref: "item", note: "the noted form of this item" }),
    field("placeholder", "int", { ref: "item" }),
    field("placeholderTemplate", "int", { ref: "item" }),
    field("recolorFrom", "int[]"), field("recolorTo", "int[]"),
    field("retextureFrom", "int[]"), field("retextureTo", "int[]"),
  ],
  spotanim: [
    field("modelId", "int", { ref: "model", note: "the model this graphic draws" }),
    field("animationId", "int", { ref: "seq", note: "the animation it plays" }),
    field("resizeX", "int"), field("resizeY", "int"), field("rotation", "int"),
    field("ambient", "int"), field("contrast", "int"),
    field("rotate", "boolean"),
    field("recolorFrom", "int[]"), field("recolorTo", "int[]"),
    field("retextureFrom", "int[]"), field("retextureTo", "int[]"),
    field("recolAll", "int"),
  ],
  seq: [
    field("frameIds", "int[]", { ref: "model", note: "frame ids live in the frame archive, so they are not definitions" }),
    field("frameDelays", "int[]"),
    field("frameStep", "int"),
    field("interleaveLeave", "int[]"),
    field("chatFrameIds", "int[]"),
    field("maxLoops", "int"), field("forcedPriority", "int"),
    field("precedenceAnimating", "int"), field("priority", "int"), field("replyMode", "int"),
    field("stretches", "boolean"),
    field("leftHandItem", "int", { ref: "item" }),
    field("rightHandItem", "int", { ref: "item" }),
  ],
  varbit: [
    field("baseVar", "int", { ref: "varp" }),
    field("startBit", "int"),
    field("endBit", "int", { note: "inclusive; the width is endBit - startBit + 1" }),
  ],
  struct: [field("params", "map", { ref: "param" })],
  enum: [field("values", "map")],
  dbro: [
    field("tableId", "int", { ref: "dbtable" }),
    field("columns", "map"),
  ],
  dbtable: [
    field("columns", "string[]", { note: "column names by column id, from gamevals" }),
    field("rowCount", "int"),
  ],
};

/** A loc carries its model ids as `models[][]`, one group per model type; the field is flattened. */
const READERS = {
  loc: {
    models: (definition) => (definition.models ?? []).flat(),
  },
};

const CUSTOM_ITEM_RANGE = 50000;

function kindOf(kind) {
  const entry = KINDS[kind];
  if (!entry) throw new Error(`Unknown cache kind "${kind}"; known: ${Object.keys(KINDS).join(", ")}`);
  return entry;
}

function fieldsOf(kind) {
  kindOf(kind);
  return FIELDS[kind] ?? null;
}

/** The metadata for one field, or null when the kind has no such field. */
function fieldOf(kind, name) {
  return (FIELDS[kind] ?? []).find((entry) => entry.name === name) ?? null;
}

/** Fields that point at another definition, in table order. */
function referenceFields(kind) {
  return (FIELDS[kind] ?? []).filter((entry) => entry.ref);
}

/** Every kind a field of this kind can point at, deduplicated. */
function referencedKinds(kind) {
  return [...new Set(referenceFields(kind).map((entry) => entry.ref))];
}

/** Reads a field off a decoded definition, honouring the few shapes that differ from the name. */
function readField(kind, definition, name) {
  const reader = READERS[kind]?.[name];
  if (reader) return reader(definition);
  return definition?.[name];
}

module.exports = {
  KINDS, FIELDS, CUSTOM_ITEM_RANGE,
  kindOf, fieldsOf, fieldOf, referenceFields, referencedKinds, readField,
};
