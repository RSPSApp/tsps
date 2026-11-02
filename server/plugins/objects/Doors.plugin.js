"use strict";

let api;
let core;

// OSRS: an opened door/gate that nobody interacts with reverts on its own after
// 300 seconds (500 ticks @ 600ms/tick). Cross-checked against rsmod/OpenRune-Server
// (DoorConstants.DURATION = 500) and a from-scratch OSRS-parity server (DOOR_AUTO_CLOSE_TICKS).
const DOOR_AUTO_CLOSE_TICKS = 500;

// Single-door closed/open pairs are discovered from this server's own cache instead of a
// hand-picked ID list: OSRS models every plain door as two consecutive loc ids where the
// closed variant offers "Open" and closedId+1 offers "Close" (verified live against this
// cache: e.g. 23972 "Door" Open -> 23973 "Door" Close). A hardcoded whitelist can only ever
// cover the handful of doors someone happened to test; this covers all of them.
//
// Adding a door? Dump the ids around it from the cache first (needs `yarn build`, run from server/):
//   node -e '(async()=>{require("./dist/Server").Server.installProductionPathResolver();
//     await require("./dist/game/cache/CachePipeline").CachePipeline.initialize(process.cwd());
//     const {CacheDefinitions:C}=require("./dist/game/cache/CacheDefinitions");
//     for(const id of [1516,1517,1518,1519,1520]){const d=C.getObject(id);
//     console.log(id,d?.name,JSON.stringify(d?.actions),JSON.stringify(d?.models));}})()' 2>&1 | grep -E "^[0-9]"
// Closed = "Open" action; its open variant is a "Close" loc with the same models (usually id+1).
// Not id+1 -> SINGLE_DOOR_OPEN_IDS. Two leaves -> DOUBLE_DOOR_ID_FAMILIES (+ SPECIAL_* maps when
// the open ids are not closed+1). Same trick works for NPCs/items via C.getNpc / C.getItem.
const DOOR_NAMES = new Set([
  "Door", "Doors", "Large door", "Large doors", "Castle door", "Cell Door", "Cell door",
  "Glass door", "Magic door", "Metal door", "Mind Door", "Mithril door", "Tent door", "Wall",
  "Gate", "Metal gate", "Doorway", "Tree Door", "Storeroom Door", "Ardougne Wall Door",
  "Vitur door", "Myrmel door", "Shadum door", "Jovkai door", "Chained door", "Trapdoor",
  "Longhall door", "Prison door",
  // Pollnivneach curtains: closed 1533 "Open" -> open 1534 "Close" (closed id + 1, cache-derived).
  "Curtain",
]);

// Always name locs by their core.ObjectIdentifiers property (O.DOOR_358), never a raw id: the
// generated enum follows the cache, so ids stay right when it changes. Only locs the cache
// leaves nameless have no property; those stay numeric, marked "nameless". The tables need
// api.core, so register() builds them.
/**
 * Cache-nameless open door leaves. The generated ObjectIdentifiers has no property
 * for these; each is the actionless, same-model leaf of a named closed door.
 */
const NAMELESS_DOOR_LEAF_IDS = Object.freeze({
  DOOR_47_OPEN: 2001, // closed O.DOOR_47 (2000); same models, cache-derived
  DOOR_48_OPEN: 2003, // closed O.DOOR_48 (2002); same models, cache-derived
  LARGE_DOOR_100_OPEN: 39252, // Sins of the Father Arboretum; capture 1637
  LARGE_DOOR_101_OPEN: 39254,
});

let SELF_OPENING_DOOR_IDS, IN_PLACE_DOOR_IDS, SINGLE_DOOR_OPEN_IDS, COMPOSITE_DOOR_OPENINGS, WOODEN_GATES, WOODEN_GATE_BY_ID;
let DOUBLE_DOOR_ID_FAMILIES, DOUBLE_DOOR_FAMILY_IDS_BY_ID, DORGESH_CITY_DOOR_IDS;
let SPECIAL_DOUBLE_DOOR_PAIRS, SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID, SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID;

function defineDoorData({ ObjectIdentifiers: O }) {
  // Doors with no open variant in the cache: OSRS opens them by rotating the same loc
  // (open id === closed id). Their consecutive ids are unrelated doors with the same
  // model, so the same-model pairing below must not pair them. Tutorial Island:
  // start house, chef entry/exit, quest guide, and the bank/prayer area doors. DOOR_358: a single
  // door whose same-model "Close" locs (5245, 11617, 15205, 17115) all belong to other doors.
  // GATE_52 (Gnome Ball pitch and Tree Gnome Village): its same-model open variants (193, 2395)
  // are nameless with no actions and are never placed, so the pairing below cannot find them.
  SELF_OPENING_DOOR_IDS = new Set([O.DOOR_223, O.DOOR_225, O.DOOR_226, O.DOOR_227, O.DOOR_228, O.DOOR_229, O.DOOR_230, O.DOOR_231, O.DOOR_358, O.GATE_52, O.WALL_9, O.DOOR_115, O.LARGE_DOOR_23,
    // The Blood Moon Rises crank-wheel house exit (61824) has no cache Close partner.
    O.DOOR_831,
    // The Vitur food-shop door (61838) also has no cache Close partner.
    O.VITUR_DOOR_4,
    // Blood Hunt doors are cache Open-only locs; the recording shows the selected loc id
    // retained while its panel swings into the adjoining tile.
    O.JOVKAI_DOOR,
    O.MYRMEL_DOOR,
    O.MYRMEL_DOOR_3,
    O.SHADUM_DOOR_3,
    O.VITUR_DOOR, O.VITUR_DOOR_2,
    // The DT2 final-cell gate (48774) is an Open-only loc; its same-model
    // actionless variant has no Close option, so it swings in place.
    O.GATE_270,
    O.GATE_327,
    // The two Ardougne Wall Door loc variants swing open by rotating the same cache loc.
    O.ARDOUGNE_WALL_DOOR, O.ARDOUGNE_WALL_DOOR_2,
    // Ghorrock Prison's western gate has no separate open loc in the cache.
    O.GATE_282,
    // Taverley jail/deeper-dungeon gates are Open-only model609 locs with no
    // uniquely named open partner; keep their IDs while swinging the panels.
    O.DOOR_99, O.GATE_57,
    // The Champions' Guild door (1805): its id+1 is an unrelated nameless loc.
    O.DOOR_45]);
  // Single doors the pairing below can't find: the open variant is not closedId + 1 (e.g. Large
  // door 1517 -> 1520, same models), or it has no "Close" (DOOR_181, the open Keldagrim door on
  // the way to the Blast Furnace, shares DOOR_180's model but offers no option). Witch's House's
  // interior doors (DOOR_499 closed -> DOOR_498 open) are inverted: the open "Close"-only leaf
  // carries the lower id, so the ascending scan never sees the pair.
  SINGLE_DOOR_OPEN_IDS = new Map([
    // Generic trapdoors have distinct open models, two ids after their closed variants.
    [O.TRAPDOOR_4, O.TRAPDOOR_6],
    [O.TRAPDOOR_5, O.TRAPDOOR_7],
    [O.LARGE_DOOR_11, O.LARGE_DOOR_14],
    [O.DOOR_180, O.DOOR_181],
    [O.DOOR_499, O.DOOR_498],
    // Vitur clothing-shop door is a transformed 61840 parent whose visible closed/open
    // children are 61842/61843. The unnamed parent cannot be catalogued by its cache name.
    [O.DOOR_837, O.DOOR_838],
    // Catacomb outer jail gate: its open cache variant has no Close action.
    [O.GATE_301, O.GATE_302],
    // The Lassar cistern gate opens into its actionless, same-model cache variant.
    [O.GATE_268, O.GATE_269],
    // Tree Gnome Stronghold doors: 1967/1968 open into the cache's nameless 1969/1970.
    [O.TREE_DOOR, 1969],
    [O.TREE_DOOR_2, 1970],
    // Troll Stronghold's cache has an action-less open loc 3811 with the same
    // model as closed 3810, so it cannot be paired by the normal action scan.
    [O.STOREROOM_DOOR, O.STOREROOM_DOOR + 1],
    // Slepe church crypt gate: its open form 39513 has the same model but no action.
    [O.GATE_210, O.GATE_211],
    // Active cache dump (osrs-241 2026-10-20): 2000/2002 "Door" have Open and
    // models 634/635/574/575/576; 2001/2003 are nameless, actionless, same-model
    // open leaves. They are not placed in the cache map. Cache-derived, no capture.
    [O.DOOR_47, NAMELESS_DOOR_LEAF_IDS.DOOR_47_OPEN],
    [O.DOOR_48, NAMELESS_DOOR_LEAF_IDS.DOOR_48_OPEN],
    // Barbarian Village Longhall: both leaves open four ids later (11620->11624,
    // 11621->11625); 11622/11623 are unused actionless locs.
    [O.LONGHALL_DOOR, O.LONGHALL_DOOR_3],
    [O.LONGHALL_DOOR_2, O.LONGHALL_DOOR_4],
  ]);

  // Curtains do not swing: the open loc is a drawn-back curtain model (1534: 879/880 vs the
  // closed 1533's 884/885) that replaces the closed one on the same tile with the same rotation.
  // These floor trapdoors likewise replace their model in place.
  IN_PLACE_DOOR_IDS = new Set([O.CURTAIN_3, O.TRAPDOOR_4, O.TRAPDOOR_5]);

  // Tree Gnome Stronghold main gate: one 5x2 loc (190, face 2) opens into two
  // nameless 2x2 leaves (191/192), leaving the centre tile clear.
  COMPOSITE_DOOR_OPENINGS = new Map([
    [O.GATE_16, [[191, 0, 0, 2], [192, 3, 0, 0]]],
    // shortcut: the cabinet house's nameless open leaf swings east to keep its
    // furniture-lined entrance usable; confirm the swing with a live OSRS capture.
    [O.DOOR_55, [[2055, 0, -1, 2]]],
    // shortcut: swing west past the Rehnison entrance chair; confirm against a live OSRS capture.
    [O.DOOR_85, [[O.DOOR_86, 0, 1, 0]]],
  ]);

  // The Dorgesh-Kaan city entrance is an inter-zone transport in loc-teleports.json; leave
  // its two threshold leaves to LocTeleports instead of swinging them as local doors.
  DORGESH_CITY_DOOR_IDS = new Set([O.DOOR_176, O.DOOR_177]);

  // OSRS wooden gates are two locs that pivot together around the hinge post: a hinge panel
  // and an extension panel. Opening/closing moves BOTH pieces, so the "closed id + 1 = open
  // id" auto-pairing below cannot find them (their ids are unrelated) and the metal
  // double-door families do not apply either. List each gate explicitly.
  // Sources: the original elvarg gate catalog (doors.json "definitions.gates", hinge style)
  // for 1558/1560, 1561/1562, 8810/8811, 12986/12987, 15514/15516; the remaining pairs come
  // from the unresolved gate catalog (gates.unresolved.json closed sets, id-collision) with
  // their adjacent-id open variants. Closed hinge is always the unrotated loc (or first
  // model), closed extension the rotated/mirrored one.
  WOODEN_GATES = Object.freeze([
    woodenGate(O.GATE_4, O.GATE_5, O.GATE_6, O.GATE_7),
    woodenGate(O.GATE_17, O.GATE_167, O.GATE_168, O.GATE_169),
    woodenGate(O.GATE_18, O.GATE_20, O.GATE_19, O.GATE_25),
    woodenGate(O.GATE_21, O.GATE_22, O.GATE_23, O.GATE_24),
    woodenGate(O.GATE_78, O.GATE_79, O.GATE_80, 4314), // 4314: open extension, nameless in the cache
    woodenGate(O.GATE_83, O.GATE_84, O.GATE_85, O.GATE_86),
    woodenGate(O.GATE_113, O.GATE_114, O.GATE_115, 12819), // 12819: open extension, nameless in the cache
    woodenGate(O.GATE_116, O.GATE_117, O.GATE_118, O.GATE_119),
    woodenGate(O.GATE_140, O.GATE_142, O.GATE_137, O.GATE_139),
    woodenGate(O.GATE_243, O.GATE_244, O.GATE_245, O.GATE_246),
    woodenGate(O.GATE_322, O.GATE_319, O.GATE_320, O.GATE_321),
    // Tutorial Island survival gate: swings open into 8810/8811's open panels (Zenyte Gate.java).
    woodenGate(O.GATE_90, O.GATE_91, O.GATE_85, O.GATE_86),
  ]);

  WOODEN_GATE_BY_ID = new Map();
  for (const gate of WOODEN_GATES) {
    // Open panels can be shared (the survival gate opens into 8812/8813); the first
    // gate keeps them, and closing restores the remembered closed panels anyway.
    for (const id of [gate.closed.hinge, gate.closed.extension, gate.opened.hinge, gate.opened.extension]) {
      if (!WOODEN_GATE_BY_ID.has(id)) WOODEN_GATE_BY_ID.set(id, gate);
    }
  }

  DOUBLE_DOOR_ID_FAMILIES = Object.freeze([
    // White Knights' Castle: the two leaves share model 639; their open ids are reversed.
    Object.freeze([O.CASTLE_DOOR, O.CASTLE_DOOR_6, O.CASTLE_DOOR_7, O.CASTLE_DOOR_8]),
    // Kourend Crypt's two thresholds have two adjacent shape-0 leaves with the same
    // definition. They keep their loc ids while swinging, so they must not be paired
    // by the single-door consecutive-id heuristic above.
    Object.freeze([O.LARGE_DOORS, O.LARGE_DOORS_2]),
    Object.freeze([O.LARGE_DOORS_3, O.LARGE_DOORS_4]),
    // Large doors (model 633): 1511 opens to 1512, 1513 to 1516 (1514 is an unnamed loc).
    Object.freeze([O.LARGE_DOOR_7, O.LARGE_DOOR_9, O.LARGE_DOOR_8, O.LARGE_DOOR_10]),
    Object.freeze([O.LARGE_DOOR_10, O.LARGE_DOOR_13]),
    Object.freeze([O.GATE_33, O.GATE_34, O.GATE_29, O.GATE_30]),
    Object.freeze([O.DOOR_354, O.DOOR_355, O.DOOR_356, O.DOOR_357]),
    Object.freeze([O.LARGE_DOOR_15, O.LARGE_DOOR_16, O.LARGE_DOOR_17, O.LARGE_DOOR_18]),
    Object.freeze([O.DOOR_36, O.DOOR_37]),
    Object.freeze([O.GATE_18, O.GATE_19]),
    Object.freeze([O.GATE_26, O.GATE_27, O.GATE_29, O.GATE_30]),
    Object.freeze([O.DOORWAY_2, O.DOORWAY_3, O.DOORWAY_4]),
      // Castle Wars large doors. West leaf is left: Saradomin 4423/4424 -> 4425/4426,
    // Zamorak 4428/4427 (ids run east to west on that wall) -> 4430/4429.
    Object.freeze([O.LARGE_DOOR_24, O.LARGE_DOOR_25, O.LARGE_DOOR_26, O.LARGE_DOOR_27]),
    Object.freeze([O.LARGE_DOOR_28, O.LARGE_DOOR_29, O.LARGE_DOOR_30, O.LARGE_DOOR_31]),
    Object.freeze([O.GATE_40, O.GATE_41, O.GATE_29, O.GATE_30]),
    // Sinclair Mansion: model-639 open leaves have a null cache name but a Close action.
    Object.freeze([O.LARGE_DOOR_79, O.LARGE_DOOR_80, 25749, 25751]),
    // Sins of the Father Arboretum: closed 39251/39253 "Large door" (Open, model
    // 40489) swing east into the nameless/actionless 39252/39254 leaves on the
    // adjacent tiles (capture 1637; matching cache pair).
    Object.freeze([O.LARGE_DOOR_100, O.LARGE_DOOR_101,
      NAMELESS_DOOR_LEAF_IDS.LARGE_DOOR_100_OPEN, NAMELESS_DOOR_LEAF_IDS.LARGE_DOOR_101_OPEN]),
    // Tutorial Island mining exit: same metal gate as 1727/1728 (9717 is the left leaf).
    Object.freeze([O.GATE_92, O.GATE_93, O.GATE_29, O.GATE_30]),
    // Tutorial Island rat cage: same metal gate, face 0 (9719 is the left/south leaf).
    Object.freeze([O.GATE_94, O.GATE_95, O.GATE_29, O.GATE_30]),
    // Catherby/Hemenster metal gates (53 west leaf, 52 east): open into the
    // nameless 28853/28854 leaves, same model (14356).
    Object.freeze([O.GATE_8, O.GATE_9, 28853, 28854]),
    // Large doors sharing model 639 with 1521/1524; they open into that family's 1522/1525.
    Object.freeze([O.LARGE_DOOR_98, O.LARGE_DOOR_99, O.LARGE_DOOR_16, O.LARGE_DOOR_18]),
    // Paterdomus' two-leaf chapel entrance. Closed leaves 3489/3490 swing into
    // the nameless cache locs 3491/3492; all four use model 3544.
    Object.freeze([O.LARGE_DOOR_21, O.LARGE_DOOR_22, 3491, 3492]),
    // Sophanem's north entrance: closed leaves 44036/44038, nameless open leaves 44037/44039.
    Object.freeze([O.GATE_232, O.GATE_233, 44037, 44039]),
    // Lassar residential shadow gate: 48278/48279 open into the paired
    // Close-action leaves 48282/48283 (48280/48281 are unused cache locs).
    Object.freeze([O.DOORS_21, O.DOORS_22, O.DOORS_25, O.DOORS_26]),
    // Lassar pub gate: 48289/48290 swing into the actual Close-action leaves
    // 48291/48292. The two intervening ids are not variants of this gate.
    Object.freeze([O.DOORS_29, O.DOORS_30, O.DOORS_31, O.DOORS_32]),
  ]);
  // Both leaves of each pair are partners of the other.
  SPECIAL_DOUBLE_DOOR_PAIRS = Object.freeze([
    [O.CASTLE_DOOR, O.CASTLE_DOOR_6],
    [O.CASTLE_DOOR_7, O.CASTLE_DOOR_8],
    // Kourend Crypt has two real double-door thresholds at z1. Both closed leaves
    // use the same "Open" loc definition/model; they swing in place and keep their ids.
    [O.LARGE_DOORS, O.LARGE_DOORS_2],
    [O.LARGE_DOORS_3, O.LARGE_DOORS_4],
    [O.GATE_26, O.GATE_27],
    [O.GATE_29, O.GATE_30],
    [O.GATE_33, O.GATE_34],
    [O.DOOR_354, O.DOOR_355],
    [O.DOOR_354, O.DOOR_357],
    [O.DOOR_355, O.DOOR_356],
    [O.DOOR_356, O.DOOR_357],
    [O.GATE_40, O.GATE_41],
    [O.GATE_92, O.GATE_93],
    [O.GATE_94, O.GATE_95],
    [O.GATE_8, O.GATE_9],
    [O.GATE_232, O.GATE_233],
    [O.DOORS_21, O.DOORS_22],
    [O.DOORS_25, O.DOORS_26],
    [O.DOORS_29, O.DOORS_30],
    [O.DOORS_31, O.DOORS_32],
    [44037, 44039],
    [O.LARGE_DOOR_24, O.LARGE_DOOR_25],
    [O.LARGE_DOOR_26, O.LARGE_DOOR_27],
    [O.LARGE_DOOR_29, O.LARGE_DOOR_28],
    [O.LARGE_DOOR_31, O.LARGE_DOOR_30],
    [O.LARGE_DOOR_98, O.LARGE_DOOR_99],
    [O.LARGE_DOOR_21, O.LARGE_DOOR_22],
    [O.GATE_232, O.GATE_233],
    [O.LARGE_DOOR_16, O.LARGE_DOOR_18],
    [O.LARGE_DOOR_7, O.LARGE_DOOR_9],
    [O.LARGE_DOOR_8, O.LARGE_DOOR_10],
    [O.LARGE_DOOR_79, O.LARGE_DOOR_80],
    [25749, 25751],
    // Sins of the Father Arboretum double door (capture 1637).
    [O.LARGE_DOOR_100, O.LARGE_DOOR_101],
  ]);
  SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID = new Map();
  for (const [a, b] of SPECIAL_DOUBLE_DOOR_PAIRS) {
    for (const [id, partner] of [[a, b], [b, a]]) {
      SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID.set(id, [...(SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID.get(id) ?? []), partner]);
    }
  }
  SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID = new Map([
    [O.CASTLE_DOOR, O.CASTLE_DOOR_7],
    [O.CASTLE_DOOR_6, O.CASTLE_DOOR_8],
    [O.LARGE_DOORS, O.LARGE_DOORS],
    [O.LARGE_DOORS_2, O.LARGE_DOORS_2],
    [O.LARGE_DOORS_3, O.LARGE_DOORS_3],
    [O.LARGE_DOORS_4, O.LARGE_DOORS_4],
    [O.GATE_26, O.GATE_29],
    [O.GATE_27, O.GATE_30],
    [O.GATE_33, O.GATE_29],
    [O.GATE_34, O.GATE_30],
    [O.DOOR_354, O.DOOR_356],
    [O.DOOR_355, O.DOOR_357],
    [O.GATE_40, O.GATE_29],
    [O.GATE_41, O.GATE_30],
    [O.GATE_92, O.GATE_29],
    [O.GATE_93, O.GATE_30],
    [O.GATE_94, O.GATE_29],
    [O.GATE_95, O.GATE_30],
    [O.GATE_8, 28853],
    [O.GATE_9, 28854],
    [O.LARGE_DOOR_24, O.LARGE_DOOR_26],
    [O.LARGE_DOOR_25, O.LARGE_DOOR_27],
    [O.LARGE_DOOR_29, O.LARGE_DOOR_31],
    [O.LARGE_DOOR_28, O.LARGE_DOOR_30],
    [O.LARGE_DOOR_98, O.LARGE_DOOR_16],
    [O.LARGE_DOOR_21, 3491],
    [O.LARGE_DOOR_22, 3492],
    [O.GATE_232, 44037],
    [O.GATE_233, 44039],
    [O.DOORS_21, O.DOORS_25],
    [O.DOORS_22, O.DOORS_26],
    [O.DOORS_29, O.DOORS_31],
    [O.DOORS_30, O.DOORS_32],
    [O.LARGE_DOOR_99, O.LARGE_DOOR_18],
    [O.LARGE_DOOR_7, O.LARGE_DOOR_8],
    [O.LARGE_DOOR_9, O.LARGE_DOOR_10],
  ]);
  DOUBLE_DOOR_FAMILY_IDS_BY_ID = new Map(
    DOUBLE_DOOR_ID_FAMILIES.flatMap((familyIds) =>
      familyIds.map((id) => [id, familyIds])
    )
  );
}

function woodenGate(hinge, extension, openHinge, openExtension) {
  return Object.freeze({
    closed: Object.freeze({ hinge, extension }),
    opened: Object.freeze({ hinge: openHinge, extension: openExtension }),
  });
}

const COORD_OFFSETS = Object.freeze([
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
]);

// Double-door leaves turn opposite ways when they open: the face each closed face turns to.
const LEFT_LEAF_OPEN_FACES = Object.freeze([3, 0, 1, 0]);
const RIGHT_LEAF_OPEN_FACES = Object.freeze([1, 2, 3, 2]);
// Double doors outside the SPECIAL_* maps pair by id: per closed face, where the left leaf
// sits from the right one and how its id differs (the right leaf is the mirror).
const LEFT_LEAF_OFFSETS = Object.freeze([[0, -1, -3], [-1, 0, -3], [0, 1, -3], [-1, 0, 3]]);

const GATE_PARTNER_OFFSETS = Object.freeze([
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]);

let DOOR_CATALOG = null;
// Leaves of same-model double doors found by buildDoorCatalog. They only act as a double door
// where both leaves stand side by side, so a lone one stays a single door.
const SAME_MODEL_DOUBLE_DOOR_IDS = new Set();
const OPEN_OBJECT_STATES = new Map();
const RUNTIME_DOUBLE_DOOR_RECORDS = [];
const PRIVATE_AREA_IDS = new WeakMap();
let nextPrivateAreaId = 0;

function doorStateKey(key, privateArea) {
  if (!privateArea) return key;
  if (!PRIVATE_AREA_IDS.has(privateArea)) PRIVATE_AREA_IDS.set(privateArea, ++nextPrivateAreaId);
  return `${key}:area:${PRIVATE_AREA_IDS.get(privateArea)}`;
}
function hasAction(actions, keyword) {
  return Array.isArray(actions) && actions.some((action) => typeof action === "string" && action.toLowerCase() === keyword);
}
function buildDoorCatalog() {
  const closedToOpen = new Map();
  const openToClosed = new Map();
  const total = core.CacheDefinitions.getCounts().objects;
  const sameModelPairs = [];
  for (let id = 0; id < total; id++) {
    const def = core.CacheDefinitions.getObject(id);
    if (!def || !DOOR_NAMES.has(def.name) || !hasAction(def.actions, "open")) {
      continue;
    }
    // Wooden gates are tracked by WOODEN_GATES, never by the generic pairing heuristics.
    if (WOODEN_GATE_BY_ID.has(id)) {
      continue;
    }
    if (SELF_OPENING_DOOR_IDS.has(id)) {
      closedToOpen.set(id, id);
      continue;
    }
    // Gameval names can identify the open leaf even when its id comes first
    // (canafis_door_ground_open / canafis_door_ground). Keep paired gates with
    // their family handler and require a matching, Close-only cache definition.
    // A leaf of a same-model double door (fai_varrock_member_gatel/r 11766/11767) also has a
    // gameval-named open loc; leave it to the pairing below, which registers both leaves.
    const namedOpenId = namedOpenLeaf(id);
    const namedOpen = namedOpenId == null ? null : core.CacheDefinitions.getObject(namedOpenId);
    if (
      !isSameModelLeafPair(id, id + 1) && !isSameModelLeafPair(id - 1, id) &&
      !DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(id) &&
      !DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(namedOpenId) &&
      namedOpen?.name === def.name &&
      hasAction(namedOpen.actions, "close") && !hasAction(namedOpen.actions, "open")
    ) {
      closedToOpen.set(id, namedOpenId);
      openToClosed.set(namedOpenId, id);
      continue;
    }
    const partner = core.CacheDefinitions.getObject(id + 1);
    if (!partner || partner.name !== def.name) {
      continue;
    }
    if (hasAction(partner.actions, "close")) {
      // The open variant only closes back (the classic closed id N, open id N+1).
      if (!hasAction(partner.actions, "open")) {
        closedToOpen.set(id, id + 1);
        openToClosed.set(id + 1, id);
      }
      continue;
    }
    // Some cache exports list both variants with only "Open" (the open door shares
    // the same model and only differs by rotation). Pair consecutive same-model
    // doors so they still open; see e.g. Varrock Palace door 32464/32465.
    // Skip double-door leaves and already-paired ids so chains don't form.
    // The same pair is also how the cache builds a double door's two leaves (11766/11767, the
    // second mirrored), so it is registered as one too; see addSameModelDoubleDoor.
    if (
      hasAction(partner.actions, "open") &&
      !SELF_OPENING_DOOR_IDS.has(id + 1) &&
      JSON.stringify(partner.models) === JSON.stringify(def.models) &&
      !DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(id) && !DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(id + 1) &&
      !openToClosed.has(id) &&
      !closedToOpen.has(id + 1)
    ) {
      closedToOpen.set(id, id + 1);
      openToClosed.set(id + 1, id);
      sameModelPairs.push(id);
    }
    // An unused, actionless variant can sit between a door and its open loc: Varrock's
    // 11780 -> 11782 (Katrine's hideout, the Phoenix Gang ladder house), Lassar's 48262 -> 48264.
    const skipped = core.CacheDefinitions.getObject(id + 2);
    if (
      !partner.actions?.some(Boolean) &&
      skipped?.name === def.name &&
      hasAction(skipped.actions, "close") && !hasAction(skipped.actions, "open") &&
      JSON.stringify(skipped.models) === JSON.stringify(def.models) &&
      !DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(id) && !DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(id + 2) &&
      !openToClosed.has(id)
    ) {
      closedToOpen.set(id, id + 2);
      openToClosed.set(id + 2, id);
    }
    // Some pairs interleave: closed A, closed B, open B, open A. Require both
    // matching model pairs so the neighbouring door is never used as A's open leaf.
    const outerOpen = core.CacheDefinitions.getObject(id + 3);
    if (
      !closedToOpen.has(id) && !openToClosed.has(id + 3) &&
      Array.isArray(def.models) && def.models.length > 0 &&
      Array.isArray(partner.models) && partner.models.length > 0 &&
      hasAction(partner.actions, "open") && !hasAction(partner.actions, "close") &&
      skipped?.name === def.name &&
      hasAction(skipped.actions, "close") && !hasAction(skipped.actions, "open") &&
      JSON.stringify(partner.models) === JSON.stringify(skipped.models) &&
      outerOpen?.name === def.name &&
      hasAction(outerOpen.actions, "close") && !hasAction(outerOpen.actions, "open") &&
      JSON.stringify(outerOpen.models) === JSON.stringify(def.models) &&
      ![id, id + 1, id + 2, id + 3].some((candidate) => DOUBLE_DOOR_FAMILY_IDS_BY_ID.has(candidate))
    ) {
      closedToOpen.set(id, id + 3);
      openToClosed.set(id + 3, id);
    }
  }
  for (const [closedId, openId] of SINGLE_DOOR_OPEN_IDS) {
    closedToOpen.set(closedId, openId);
    openToClosed.set(openId, closedId);
  }
  for (const left of sameModelPairs) {
    if (!SINGLE_DOOR_OPEN_IDS.has(left) && !SINGLE_DOOR_OPEN_IDS.has(left + 1)) addSameModelDoubleDoor(left, left + 1);
  }
  return { closedToOpen, openToClosed };
}

// Two consecutive locs that are the closed leaves of one same-model double door: same name and
// models, both offering only "Open", and each with a gameval-named open loc.
function isSameModelLeafPair(a, b) {
  const left = core.CacheDefinitions.getObject(a);
  const right = core.CacheDefinitions.getObject(b);
  if (!left || !right || left.name !== right.name) return false;
  if (!Array.isArray(left.models) || left.models.length === 0) return false;
  if (JSON.stringify(left.models) !== JSON.stringify(right.models)) return false;
  const openOnly = (def) => hasAction(def.actions, "open") && !hasAction(def.actions, "close");
  if (!openOnly(left) || !openOnly(right)) return false;
  const names = core.CacheDefinitions.getLocNames();
  return isMirroredLeafName(names.get(a), names.get(b)) && namedOpenLeaf(a) != null && namedOpenLeaf(b) != null;
}

// The two gameval names differ only by the leaf's side: gatel/gater, _left/_right, door/doorl,
// face/face_mirr. Neighbouring variants (archeuus_door_double_left_green/_red) are not leaves.
const LEAF_SIDE_SUFFIXES = new Set(["l|r", "left|right", "|l", "|r", "|_mirr", "|_mirror"]);
function isMirroredLeafName(a, b) {
  if (!a || !b || a === b) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  // Back the shared tail off a letter at a time: left_closed/right_closed share "t_closed".
  for (; end >= 0; end--) {
    const [x, y] = [a.slice(start, a.length - end), b.slice(start, b.length - end)].sort();
    if (LEAF_SIDE_SUFFIXES.has(`${x}|${y}`)) return true;
  }
  return false;
}

// The open loc the cache's gameval names for a closed leaf (fai_varrock_member_gatel ->
// fai_varrock_member_gatel_open, kr_camelot_metalgateclosedl -> kr_camelot_metalgateopenl).
function namedOpenLeaf(closedId) {
  const name = core.CacheDefinitions.getLocNames().get(closedId);
  if (!name) return null;
  const models = JSON.stringify(core.CacheDefinitions.getObject(closedId)?.models);
  for (const candidate of [`${name}_open`, name.replace("closed", "open")]) {
    const id = candidate === name ? null : core.CacheDefinitions.getLocId(candidate);
    if (id != null && JSON.stringify(core.CacheDefinitions.getObject(id)?.models) === models) return id;
  }
  return null;
}

// Registers two same-model "Open" leaves as a double door that opens into their gameval-named
// open locs, or swings them in place under their own ids when the cache names none.
function addSameModelDoubleDoor(a, b) {
  const openA = namedOpenLeaf(a);
  const openB = namedOpenLeaf(b);
  const [nextA, nextB] = openA != null && openB != null ? [openA, openB] : [a, b];
  const family = [...new Set([a, b, nextA, nextB])];
  for (const id of family) {
    DOUBLE_DOOR_FAMILY_IDS_BY_ID.set(id, family);
    SAME_MODEL_DOUBLE_DOOR_IDS.add(id);
  }
  for (const [id, partner] of [[a, b], [b, a], [nextA, nextB], [nextB, nextA]]) {
    SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID.set(id, [partner]);
  }
  SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID.set(a, nextA);
  SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID.set(b, nextB);
}

function getDoorCatalog() {
  if (!DOOR_CATALOG) {
    DOOR_CATALOG = buildDoorCatalog();
  }
  return DOOR_CATALOG;
}

function doorSound(id, open) {
  const gate = core.CacheDefinitions.getObject(id)?.name === "Gate";
  return gate ? (open ? core.Sound.GATE_OPEN : core.Sound.GATE_CLOSE) : (open ? core.Sound.DOOR_OPEN : core.Sound.DOOR_CLOSE);
}

function cloneLocation(x, y, z) {
  return new core.Location(x, y, z);
}

function locationKey(location) {
  if (!location) {
    return "0,0,0";
  }
  const x = location.getX?.() ?? location.x ?? 0;
  const y = location.getY?.() ?? location.y ?? 0;
  const z = location.getZ?.() ?? location.z ?? 0;
  return `${x},${y},${z}`;
}

function locationRegionId(location) {
  const x = location.getX?.() ?? location.x ?? 0;
  const y = location.getY?.() ?? location.y ?? 0;
  return ((x >> 6) << 8) | (y >> 6);
}

function toObjectSnapshot(object) {
  const location = object?.getLocation?.() ?? object?.location;
  return {
    id: Number(object?.getId?.() ?? object?.id ?? -1),
    type: Number(object?.getType?.() ?? object?.type ?? 0),
    face: Number(object?.getFace?.() ?? object?.face ?? 0) & 0x3,
    location: {
      x: location?.getX?.() ?? location?.x ?? 0,
      y: location?.getY?.() ?? location?.y ?? 0,
      z: location?.getZ?.() ?? location?.z ?? 0,
    },
    privateArea: object?.getPrivateArea?.() ?? object?.privateArea ?? null,
  };
}

function objectFromSnapshot(snapshot, privateArea = null) {
  const area = privateArea ?? snapshot.privateArea ?? null;
  const existing = area?.getObjects?.().find((object) =>
    object.getId?.() === snapshot.id && object.getType?.() === snapshot.type && object.getFace?.() === snapshot.face &&
    locationKey(object.getLocation?.()) === locationKey(snapshot.location)
  );
  if (existing) return existing;
  return new core.GameObject(
    snapshot.id,
    cloneLocation(snapshot.location.x, snapshot.location.y, snapshot.location.z),
    snapshot.type,
    snapshot.face,
    area
  );
}

function objectForArea(object, privateArea) {
  // Unchanged scenery in a private area can resolve to the shared map's object.
  return (object.getPrivateArea?.() ?? null) === privateArea
    ? object
    : objectFromSnapshot(toObjectSnapshot(object), privateArea);
}

function resolveClosedId(objectId) {
  const catalog = getDoorCatalog();
  if (catalog.closedToOpen.has(objectId)) {
    return objectId;
  }
  const closedId = catalog.openToClosed.get(objectId);
  return closedId ?? null;
}

function findOpenDoorState(closedId, location, privateArea) {
  const directKey = doorStateKey(locationKey(location), privateArea);
  const direct = OPEN_OBJECT_STATES.get(directKey);
  if (direct?.closed?.length === 1 && (direct.closedId ?? direct.closed[0]?.id) === closedId) {
    return [directKey, direct];
  }

  for (const [anchorKey, state] of OPEN_OBJECT_STATES.entries()) {
    if (state.closed?.length !== 1 || (state.closedId ?? state.closed[0]?.id) !== closedId ||
        (state.closed[0]?.privateArea ?? null) !== privateArea) {
      continue;
    }
    if (locationKey(state.current[0]?.location) === locationKey(location)) {
      return [anchorKey, state];
    }
  }

  return [directKey, null];
}

function rememberOpenObjects(anchorKey, closedObjects, currentObjects, closedId) {
  OPEN_OBJECT_STATES.set(anchorKey, {
    closedId,
    closed: closedObjects.map(toObjectSnapshot),
    current: currentObjects.map(toObjectSnapshot),
  });
  scheduleAutoClose(anchorKey);
}

function clearOpenDoor(anchorKey) {
  OPEN_OBJECT_STATES.delete(anchorKey);
  core.TaskManager.cancelTasks(anchorKey);
}

// Reverts every object tracked under an anchor back to its closed snapshot.
function autoCloseDoor(anchorKey) {
  const state = OPEN_OBJECT_STATES.get(anchorKey);
  if (!state) {
    return;
  }
  const destroyed = state.closed?.[0]?.privateArea?.isDestroyed?.() ?? false;
  if (!destroyed) {
    for (const snapshot of state.current ?? []) {
      const object = objectFromSnapshot(snapshot);
      core.ObjectManager.deregister(object, true);
    }
    for (const snapshot of state.closed ?? []) {
      core.ObjectManager.register(objectFromSnapshot(snapshot), true);
    }
  }
  forgetDoubleDoorRecords(doubleDoorRecordsFor(state));
  OPEN_OBJECT_STATES.delete(anchorKey);
  const closedSample = state.closed?.[0];
  if (closedSample && !destroyed) {
    core.Sounds.sendSound(objectFromSnapshot(closedSample), doorSound(closedSample.id, false));
  }
}

function scheduleAutoClose(anchorKey) {
  core.TaskManager.cancelTasks(anchorKey);
  const task = new core.Task(DOOR_AUTO_CLOSE_TICKS, anchorKey);
  task.execute = () => {
    task.stop();
    autoCloseDoor(anchorKey);
  };
  core.TaskManager.submit(task);
}

// The shared map's own copy of a snapshot, read without loading the region it is in.
function mapObjectFor(snapshot) {
  const { x, y, z } = snapshot.location;
  return core.MapObjects.mapObjects.get(core.MapObjects.getHash(x, y, z))?.find((object) =>
    object.getId() === snapshot.id && object.getType() === snapshot.type && object.getFace() === snapshot.face
  ) ?? null;
}

function sameSharedObject(object, snapshot) {
  return !object.getPrivateArea?.() && object.getId() === snapshot.id && object.getType() === snapshot.type &&
    object.getFace() === snapshot.face && locationKey(object.getLocation()) === locationKey(snapshot.location);
}

// Opening a map door leaves its closed loc in World's removed objects; a runtime-spawned door has none.
function isRemovedMapObject(snapshot) {
  return core.World.getRemovedObjects().some((removed) => sameSharedObject(removed, snapshot));
}

// Core replays World's removed objects before this hook, so a closed leaf the load placed may already
// be gone again; RegionManager remembers those.
function placedByLoad(snapshot) {
  const { x, y, z } = snapshot.location;
  return Boolean(mapObjectFor(snapshot)) ||
    core.RegionManager.wasRemovedOnLoad(snapshot.id, snapshot.type, snapshot.face, x, y, z);
}

// A region reload rebuilt from new map data (a region replacement) that no longer has the closed
// door: the open leaves are stale, so they go and the door is forgotten instead of re-applied.
function isStaleAfterReload(state, regionId) {
  return state.closed.some((snapshot) => locationRegionId(snapshot.location) === regionId &&
    isRemovedMapObject(snapshot) && !placedByLoad(snapshot));
}

function dropStaleDoor(anchorKey, state) {
  const removed = core.World.getRemovedObjects();
  for (let i = removed.length - 1; i >= 0; i--) {
    if (state.closed.some((snapshot) => sameSharedObject(removed[i], snapshot))) removed.splice(i, 1);
  }
  for (const snapshot of state.current) {
    core.ObjectManager.deregister(objectFromSnapshot(snapshot), true);
    // The despawn cleared the leaf's edges, which the new map may use too.
    const { x, y, z } = snapshot.location;
    for (const object of core.MapObjects.mapObjects.get(core.MapObjects.getHash(x, y, z)) ?? []) {
      core.RegionManager.addObjectClipping(object);
    }
  }
  forgetDoubleDoorRecords(doubleDoorRecordsFor(state));
  clearOpenDoor(anchorKey);
}

// A loaded region holds the map's closed doors again: hide those of open doors and put their open
// leaves back. Idempotent, so a door across two regions is not added twice to the loaded one.
function reapplyOpenDoorsForRegion(regionId) {
  for (const [anchorKey, state] of [...OPEN_OBJECT_STATES]) {
    // Private overlays already own their removals; this hook reloads the shared map.
    if (state.closed?.[0]?.privateArea) continue;
    const inRegion = [...(state.closed ?? []), ...(state.current ?? [])].some(
      (snapshot) => locationRegionId(snapshot.location) === regionId
    );
    if (!inRegion) {
      continue;
    }
    if (isStaleAfterReload(state, regionId)) {
      dropStaleDoor(anchorKey, state);
      continue;
    }
    for (const snapshot of state.closed ?? []) {
      const placed = mapObjectFor(snapshot);
      if (placed) core.MapObjects.remove(placed);
    }
    for (const snapshot of state.current ?? []) {
      if (!mapObjectFor(snapshot)) core.MapObjects.add(objectFromSnapshot(snapshot));
    }
  }
}
// OSRS swings a wooden gate 90 degrees around its hinge post, so both panels land on the
// perpendicular tile line and face the same direction. Ported 1:1 from the original elvarg
// gate state manager (computeGateHingeOpenTransform / computeGateHingeCloseTransform).
function gateHingeTransform(x, y, rotation, opening) {
  switch (rotation & 0x3) {
    case 0:
      return opening
        ? { hinge: [x - 1, y], extension: [x - 2, y], face: 3 }
        : { hinge: [x, y - 1], extension: [x + 1, y - 1], face: 1 };
    case 1:
      return opening
        ? { hinge: [x, y + 1], extension: [x, y + 2], face: 0 }
        : { hinge: [x - 1, y], extension: [x - 1, y - 1], face: 2 };
    case 2:
      return opening
        ? { hinge: [x + 1, y], extension: [x + 2, y], face: 1 }
        : { hinge: [x, y + 1], extension: [x - 1, y + 1], face: 3 };
    case 3:
      return opening
        ? { hinge: [x, y - 1], extension: [x, y - 2], face: 2 }
        : { hinge: [x + 1, y], extension: [x + 1, y + 1], face: 0 };
    default:
      return null;
  }
}

function findAdjacentGatePartner(objectId, x, y, z, privateArea) {
  for (const [dx, dy] of GATE_PARTNER_OFFSETS) {
    const partner = core.MapObjects.get(objectId, cloneLocation(x + dx, y + dy, z), privateArea ?? null);
    if (partner) {
      return partner;
    }
  }
  return null;
}

// Opens/closes a wooden gate by swinging its hinge and extension panels together. Tracks
// both pieces as one open-object state so auto-close reverts the whole gate.
function handleWoodenGate(player, object, objectId, location) {
  const gate = WOODEN_GATE_BY_ID.get(objectId);
  if (!gate || !object || !location) {
    return false;
  }

  const privateArea = player?.getPrivateArea?.() ?? null;
  const isClosed = objectId === gate.closed.hinge || objectId === gate.closed.extension;
  // Closing a gate this plugin opened puts back exactly the panels it replaced.
  if (!isClosed) {
    const key = locationKey(location);
    for (const [anchorKey, state] of OPEN_OBJECT_STATES) {
      if (anchorKey.startsWith("wooden-gate:") &&
          state.current.some((snapshot) => snapshot.id === objectId && snapshot.privateArea === privateArea &&
            locationKey(snapshot.location) === key)) {
        core.TaskManager.cancelTasks(anchorKey);
        autoCloseDoor(anchorKey);
        return true;
      }
    }
  }
  const isHinge = objectId === gate.closed.hinge || objectId === gate.opened.hinge;

  const oldHingeId = isClosed ? gate.closed.hinge : gate.opened.hinge;
  const oldExtensionId = isClosed ? gate.closed.extension : gate.opened.extension;
  const newHingeId = isClosed ? gate.opened.hinge : gate.closed.hinge;
  const newExtensionId = isClosed ? gate.opened.extension : gate.closed.extension;
  const partnerId = isHinge ? oldExtensionId : oldHingeId;

  const x = Number(location.getX?.() ?? location.x ?? 0);
  const y = Number(location.getY?.() ?? location.y ?? 0);
  const z = Number(location.getZ?.() ?? location.z ?? 0);
  const rotation = Number(object.getFace?.() ?? object.face ?? 0) & 0x3;

  const partner = findAdjacentGatePartner(partnerId, x, y, z, privateArea);
  if (!partner) {
    return false;
  }

  const clickedPart = {
    object: objectForArea(object, privateArea),
    x,
    y,
    rotation,
    type: Number(object.getType?.() ?? object.type ?? 0),
  };
  const partnerPart = {
    object: objectForArea(partner, privateArea),
    x: Number(partner.getLocation?.().getX?.() ?? 0),
    y: Number(partner.getLocation?.().getY?.() ?? 0),
    rotation: Number(partner.getFace?.() ?? 0) & 0x3,
    type: Number(partner.getType?.() ?? 0),
  };
  const hingeOld = isHinge ? clickedPart : partnerPart;
  const extensionOld = isHinge ? partnerPart : clickedPart;

  const transform = gateHingeTransform(hingeOld.x, hingeOld.y, hingeOld.rotation, isClosed);
  if (!transform) {
    return false;
  }

  const hingeNew = new core.GameObject(
    newHingeId,
    cloneLocation(transform.hinge[0], transform.hinge[1], z),
    hingeOld.type,
    transform.face,
    privateArea
  );
  const extensionNew = new core.GameObject(
    newExtensionId,
    cloneLocation(transform.extension[0], transform.extension[1], z),
    extensionOld.type,
    transform.face,
    privateArea
  );

  core.ObjectManager.deregister(hingeOld.object, true);
  core.ObjectManager.deregister(extensionOld.object, true);
  core.ObjectManager.register(hingeNew, true);
  core.ObjectManager.register(extensionNew, true);

  // Anchor on the CLOSED hinge tile so open and close compute the same key for auto-close.
  const closedHingeX = isClosed ? hingeOld.x : transform.hinge[0];
  const closedHingeY = isClosed ? hingeOld.y : transform.hinge[1];
  const anchorKey = doorStateKey(`wooden-gate:${gate.closed.hinge}:${closedHingeX},${closedHingeY},${z}`, privateArea);
  if (isClosed) {
    rememberOpenObjects(anchorKey, [hingeOld.object, extensionOld.object], [hingeNew, extensionNew]);
  } else {
    clearOpenDoor(anchorKey);
  }

  core.Sounds.sendSound(player, doorSound(gate.closed.hinge, isClosed));

  return true;
}

function handleCompositeDoor(player, object, objectId) {
  const opening = COMPOSITE_DOOR_OPENINGS.get(objectId);
  if (!opening) return false;
  const location = object.getLocation();
  const privateArea = player.getPrivateArea?.() ?? null;
  object = objectForArea(object, privateArea);
  const opened = opening.map(([id, dx, dy, face]) => new core.GameObject(
    id,
    cloneLocation(location.getX() + dx, location.getY() + dy, location.getZ()),
    object.getType(), face, privateArea
  ));
  core.ObjectManager.deregister(object, true);
  for (const leaf of opened) core.ObjectManager.register(leaf, true);
  rememberOpenObjects(doorStateKey(locationKey(location), privateArea), [object], opened);
  core.Sounds.sendSound(player, doorSound(objectId, true));
  return true;
}

function handleMappedDoor(player, object, objectId, location) {
  if (!object || !location) {
    return false;
  }

  const visibleObjectId = core.ObjectDefinition?.forPlayer?.(object.getId?.() ?? objectId, player)?.id
    ?? objectId;
  const closedId = resolveClosedId(visibleObjectId);
  if (closedId == null) {
    return false;
  }

  const privateArea = player?.getPrivateArea?.() ?? null;
  const [anchorKey, existingState] = findOpenDoorState(closedId, location, privateArea);
  const activeObject = existingState?.current?.[0]
    ? objectFromSnapshot(existingState.current[0], privateArea)
    : objectForArea(object, privateArea);
  const activeLocation = activeObject.getLocation?.() ?? location;
  const openId = getDoorCatalog().closedToOpen.get(closedId);
  // A self-opening door keeps its id, so only the tracked state says it is open.
  const activeVisibleId = core.ObjectDefinition?.forPlayer?.(activeObject.getId?.() ?? visibleObjectId, player)?.id
    ?? visibleObjectId;
  const open = openId === closedId
    ? existingState != null
    : activeVisibleId !== closedId;
  const nextId = open ? closedId : openId;
  const type = Number(activeObject.getType?.() ?? activeObject.type ?? 0);
  const rotation = Number(activeObject.getFace?.() ?? activeObject.face ?? 0) & 0x3;
  const inPlace = IN_PLACE_DOOR_IDS.has(closedId);
  const nextRotation = open ? ((rotation + 1) & 0x3) : rotation;
  const offsetIndex = type === 9 ? ((nextRotation + 1) & 0x3) : nextRotation;
  const [dx, dy] = inPlace ? [0, 0] : (COORD_OFFSETS[offsetIndex] ?? [0, 0]);
  const previousObject = activeObject;
  const nextObject = open && existingState?.closed?.[0]
    ? objectFromSnapshot(existingState.closed[0])
    : new core.GameObject(
      nextId,
      cloneLocation(
        (activeLocation.getX?.() ?? activeLocation.x ?? 0) + dx,
        (activeLocation.getY?.() ?? activeLocation.y ?? 0) + dy,
        activeLocation.getZ?.() ?? activeLocation.z ?? 0
      ),
      type,
      inPlace ? rotation : open ? ((rotation - 1) & 0x3) : ((rotation + 1) & 0x3),
      privateArea
    );

  core.ObjectManager.deregister(previousObject, true);
  core.ObjectManager.register(nextObject, true);

  if (open) {
    clearOpenDoor(anchorKey);
  } else {
    rememberOpenObjects(anchorKey, [previousObject], [nextObject], closedId);
  }

  core.Sounds.sendSound(player, doorSound(closedId, !open));

  return true;
}

function findDoubleDoorRecord(id, x, y, z, privateArea) {
  return RUNTIME_DOUBLE_DOOR_RECORDS.find(
    (record) => record.currentId === id && record.x === x && record.y === y && record.z === z &&
      record.privateArea === privateArea
  ) ?? null;
}

// Removes records by identity; one already gone (indexOf -1) must not splice the last record.
function forgetDoubleDoorRecords(records) {
  for (const record of records) {
    const index = RUNTIME_DOUBLE_DOOR_RECORDS.indexOf(record);
    if (index >= 0) RUNTIME_DOUBLE_DOOR_RECORDS.splice(index, 1);
  }
}

// The records of the leaves an open-door state closes back to.
function doubleDoorRecordsFor(state) {
  return RUNTIME_DOUBLE_DOOR_RECORDS.filter((record) => state.closed.some((snapshot) =>
    snapshot.id === record.originalId && snapshot.location.x === record.originalX &&
    snapshot.location.y === record.originalY && snapshot.location.z === record.z &&
    snapshot.privateArea === record.privateArea));
}

function createDynamicDoubleDoorRecord(object, location, originalId, privateArea) {
  return {
    originalId,
    currentId: Number(object.getId?.() ?? object.id ?? originalId),
    x: Number(location.getX?.() ?? location.x ?? 0),
    y: Number(location.getY?.() ?? location.y ?? 0),
    z: Number(location.getZ?.() ?? location.z ?? 0),
    originalX: Number(location.getX?.() ?? location.x ?? 0),
    originalY: Number(location.getY?.() ?? location.y ?? 0),
    currentFace: Number(object.getFace?.() ?? object.face ?? 0) & 0x3,
    originalFace: Number(object.getFace?.() ?? object.face ?? 0) & 0x3,
    type: Number(object.getType?.() ?? object.type ?? 0),
    privateArea,
  };
}

function ensureDynamicDoubleDoorRecords(object, objectId, location, privateArea = null) {
  if (!object || !location) {
    return null;
  }

  const familyIds = DOUBLE_DOOR_FAMILY_IDS_BY_ID.get(objectId);
  if (!familyIds) {
    return null;
  }

  for (const [dx, dy] of COORD_OFFSETS) {
    const candidateLocation = cloneLocation(
      (location.getX?.() ?? location.x ?? 0) + dx,
      (location.getY?.() ?? location.y ?? 0) + dy,
      location.getZ?.() ?? location.z ?? 0
    );
    for (const partnerId of familyIds) {
      const partnerObject = core.MapObjects.get(partnerId, candidateLocation, privateArea)
        ?? privateArea?.resolveObject?.(partnerId, candidateLocation);
      if (!partnerObject || !isSameModelLeafPartner(object, objectId, partnerObject)) {
        continue;
      }

      const clickedRecord = createDynamicDoubleDoorRecord(
        object,
        location,
        Number(object.getId?.() ?? object.id ?? objectId),
        privateArea
      );
      const partnerCurrentId = Number(partnerObject.getId?.() ?? partnerObject.id ?? partnerId);
      // A leaf already paired with another neighbour keeps its one record.
      const existingPartner = findDoubleDoorRecord(partnerCurrentId, candidateLocation.getX(),
        candidateLocation.getY(), candidateLocation.getZ(), privateArea);
      const partnerRecord = existingPartner
        ?? createDynamicDoubleDoorRecord(partnerObject, candidateLocation, partnerCurrentId, privateArea);
      RUNTIME_DOUBLE_DOOR_RECORDS.push(clickedRecord);
      if (!existingPartner) RUNTIME_DOUBLE_DOOR_RECORDS.push(partnerRecord);
      return [clickedRecord, partnerRecord];
    }
  }

  return null;
}

// A same-model leaf pairs only with a leaf in the same wall line, never with a lone open door.
function isSameModelLeafPartner(object, objectId, partnerObject) {
  if (!SAME_MODEL_DOUBLE_DOOR_IDS.has(objectId)) return true;
  return (Number(object.getFace?.() ?? object.face ?? 0) & 0x3) === (Number(partnerObject.getFace?.() ?? 0) & 0x3) &&
    Number(object.getType?.() ?? object.type ?? 0) === Number(partnerObject.getType?.() ?? 0);
}

function buildDoubleDoorAnchorKey(records) {
  return doorStateKey(records
    .map((record) => `${record.originalId}:${record.originalX},${record.originalY},${record.z}`)
    .sort()
    .join("|"), records[0].privateArea);
}

function isDoubleDoorOpen(record) {
  return (
    record.currentId !== record.originalId ||
    record.x !== record.originalX ||
    record.y !== record.originalY ||
    record.currentFace !== record.originalFace
  );
}

function doubleDoorRecordToObject(record, privateArea = record.privateArea ?? null) {
  const existing = privateArea?.getObjects?.().find((object) =>
    object.getId?.() === record.currentId && object.getType?.() === record.type && object.getFace?.() === record.currentFace &&
    object.getLocation?.().getX?.() === record.x && object.getLocation?.().getY?.() === record.y && object.getLocation?.().getZ?.() === record.z
  );
  if (existing) return existing;
  return new core.GameObject(
    record.currentId,
    cloneLocation(record.x, record.y, record.z),
    Number(record.type ?? 0),
    record.currentFace,
    privateArea
  );
}

function resolveOpenedDoubleDoorId(record) {
  return SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID.get(record.originalId) ?? (record.originalId + 1);
}

// Swings one leaf of a double door: opening steps it a tile along its closed face and turns it
// to openFaces[closed face], closing puts it back.
function toggleDoubleDoorLeaf(record, openFaces) {
  const closedPose = record.currentFace === record.originalFace;
  const [dx, dy] = closedPose ? COORD_OFFSETS[record.originalFace] : [0, 0];
  if (record.x === record.originalX && record.y === record.originalY) {
    record.x += dx;
    record.y += dy;
  } else {
    record.x = record.originalX;
    record.y = record.originalY;
  }
  record.currentId = record.currentId === record.originalId ? resolveOpenedDoubleDoorId(record) : record.originalId;
  record.currentFace = closedPose ? openFaces[record.originalFace] : record.originalFace;
}

function resolveDoubleDoorPair(clicked) {
  const specialPartnerIds = SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID.get(clicked.currentId);
  if (specialPartnerIds) {
    for (const [dx, dy] of COORD_OFFSETS) {
      const candidateX = clicked.x + dx;
      const candidateY = clicked.y + dy;
      for (const partnerId of specialPartnerIds) {
        const partner = findDoubleDoorRecord(partnerId, candidateX, candidateY, clicked.z, clicked.privateArea);
        if (!partner) {
          continue;
        }
        // The cache places these pairs in both leaf orders (1728 west of 1727 on some
        // walls), so the left leaf comes from the closed layout, never from the id.
        // Closed positions keep this right while the leaves are swung open too.
        const [leftDx, leftDy] = LEFT_LEAF_OFFSETS[clicked.originalFace];
        const partnerIsLeft = partner.originalX - clicked.originalX === leftDx &&
          partner.originalY - clicked.originalY === leftDy;
        return partnerIsLeft ? [partner, clicked] : [clicked, partner];
      }
    }
  }

  const { currentId: id, x, y, z, originalFace } = clicked;
  const [dx, dy, idDelta] = LEFT_LEAF_OFFSETS[originalFace];
  const left = findDoubleDoorRecord(id + idDelta, x + dx, y + dy, z, clicked.privateArea);
  if (left) return [left, clicked];
  const right = findDoubleDoorRecord(id - idDelta, x - dx, y - dy, z, clicked.privateArea);
  return right ? [clicked, right] : null;
}

function handleDoubleDoor(player, object, objectId, location) {
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z ?? 0;
  const privateArea = player?.getPrivateArea?.() ?? null;
  const recordCount = RUNTIME_DOUBLE_DOOR_RECORDS.length;
  const clickedDoor = findDoubleDoorRecord(objectId, x, y, z, privateArea)
    ?? ensureDynamicDoubleDoorRecords(object, objectId, location, privateArea)?.[0];
  if (!clickedDoor) {
    return false;
  }

  const pair = resolveDoubleDoorPair(clickedDoor);
  if (!pair) {
    // No partner on its left or right after all: drop the records this click made.
    forgetDoubleDoorRecords(RUNTIME_DOUBLE_DOOR_RECORDS.slice(recordCount));
    return false;
  }

  const previousObjects = pair.map((record) => doubleDoorRecordToObject(record));

  toggleDoubleDoorLeaf(pair[0], LEFT_LEAF_OPEN_FACES);
  toggleDoubleDoorLeaf(pair[1], RIGHT_LEAF_OPEN_FACES);

  const currentObjects = pair.map((record) => doubleDoorRecordToObject(record));
  for (const previousObject of previousObjects) {
    core.ObjectManager.deregister(previousObject, true);
  }
  for (const currentObject of currentObjects) {
    core.ObjectManager.register(currentObject, true);
  }


  const anchorKey = buildDoubleDoorAnchorKey(pair);
  if (pair.some(isDoubleDoorOpen)) {
    rememberOpenObjects(anchorKey, previousObjects, currentObjects);
  } else {
    clearOpenDoor(anchorKey);
    if (privateArea) forgetDoubleDoorRecords(pair);
  }

  core.Sounds.sendSound(
    player,
    doorSound(pair[0].originalId, pair.some(isDoubleDoorOpen))
  );

  return true;
}

function toggleDoor({ player, object, objectId, definition, location, clickType }) {
  if (!player || !object || !location) return false;
  if (DORGESH_CITY_DOOR_IDS.has(objectId) || DORGESH_CITY_DOOR_IDS.has(definition?.id)) return false;
  const request = { player, object, objectId, definition, location, clickType, handled: false };
  api.emitCustomEvent("door:toggle", request);
  if (request.handled) return true;
  if (handleCompositeDoor(player, object, objectId)) return true;
  if (handleWoodenGate(player, object, objectId, location)) return true;
  if (handleDoubleDoor(player, object, objectId, location)) return true;
  return handleMappedDoor(player, object, definition?.id ?? objectId, location);
}

/** Key-on-object and other content request an Open, never toggle an open door shut. */
function requestDoorOpen(event) {
  if (event.handled || !event.player || !event.object) return;
  const objectId = event.object.getId();
  const location = event.object.getLocation();
  const definition = core.ObjectDefinition.forPlayer(objectId, event.player) ?? event.object.getDefinition();
  const area = event.player.getPrivateArea?.() ?? null;
  const existing = [...OPEN_OBJECT_STATES.values()].some(state => state.current?.some(snapshot =>
    snapshot.id === objectId && locationKey(snapshot.location) === locationKey(location)
    && (snapshot.privateArea ?? null) === area));
  if (existing) {
    event.handled = true;
    return;
  }
  const clickType = (definition?.getInteractions?.() ?? []).findIndex(action => action?.toLowerCase() === "open") + 1;
  if (clickType < 1) return;
  event.handled = toggleDoor({ player: event.player, object: event.object, objectId, definition,
    location: { x: location.getX(), y: location.getY(), z: location.getZ() }, clickType });
}

function routeWallDoor(event) {
  const name = event.definition?.getName?.() ?? "";
  if (event.object?.getType?.() !== 0 ||
    (!DOOR_NAMES.has(name) && !/\b(?:doors?|doorway|gates?)\b/i.test(name))) return;
  // A closed straight wall door is used across its face, never from either end of the wall.
  // An open leaf stands across the doorway instead, and the tile inside the doorway is at its
  // end, so it keeps ordinary wall reach: closing it from inside doesn't walk the player out.
  if (isOpenLeaf(event.definition)) return;
  event.blockAccessFlags = (event.blockAccessFlags ?? 0) | 0x5;
}

function isOpenLeaf(definition) {
  const actions = definition?.getInteractions?.();
  return hasAction(actions, "close") && !hasAction(actions, "open");
}

function registerWallDoorRoutes() {
  // Explicit routes retain priority for objects whose usable tile differs from the wall edge.
  api.onObjectRoute(routeWallDoor);
}

module.exports = {
  name: "Doors",
  register: (pluginApi) => {
    api = pluginApi;
    core = pluginApi.core;
    defineDoorData(core);
    // Warm the door catalog at startup. It scans every loc definition (~185ms for ~60k
    // objects); building it lazily on the first door click stalled a live game tick.
    getDoorCatalog();
    for (const name of DOOR_NAMES) {
      // Some gates (e.g. 60760/60763) expose "Release" instead of "Open".
      api.onObjectInteraction(name, { Open: toggleDoor, Close: toggleDoor, Release: toggleDoor });
    }
    api.onRegionLoaded(({ regionId }) => reapplyOpenDoorsForRegion(regionId));
    api.onServerStartup(registerWallDoorRoutes);
    api.onCustomEvent("door:open", requestDoorOpen);
  },
  __internals: { OPEN_OBJECT_STATES, RUNTIME_DOUBLE_DOOR_RECORDS },
};
