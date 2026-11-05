"use strict";

// 25th Anniversary event ("25 Years, 25 Mementos", OSRS's 13th birthday, 18 Feb - 4 Mar 2026).
// Sources: Wiki 25th Anniversary event (walkthrough, rewards), its transcript
// (data/definitions/event-dialogues.json), cache2468/rev236 (seasonal/data/anniversary-2026-archive.json).
const EVENT_KEY = "anniversary-2026";
const BUNDLE = "anniversary-2026";
const PAGE = "25th Anniversary event";

// Memento stops, in the order the transcript's "Where do we need to go?" hints walk them.
// The Wiki allows any order; the hint names the first stop still to visit. `hint` is the
// transcript step that holds Gary's directions for that stop (two are typed as actions).
const STOPS = Object.freeze([
  { key: "swordshop", npcs: ["swordshop1", "swordshop2"], skills: ["attack", "strength"], variant: "collecting-mementos-at-the-varrock-swordshop", hint: "TacWj0" },
  { key: "cook", npcs: ["fai_varrock_bluemoon_chef"], skills: ["cooking", "hitpoints"], variant: "collecting-mementos-in-the-blue-moon-inn", hint: "jHC4QM" },
  { key: "agility", npcs: ["rooftops_bigredjapan"], archived: ["rooftops_bigredjapan", "rooftops_bigredjapan_op"], skills: ["agility"], variant: "collecting-mementos-on-the-roof-of-the-blue-moon-inn", hint: "tnoZRD" },
  { key: "general-store", npcs: ["generalshopkeeper2", "generalassistant2"], skills: ["firemaking"], variant: "collecting-mementos-at-the-general-store", hint: "vCDtCC" },
  { key: "lowe", npcs: ["lowe"], skills: ["ranged", "fletching", "fishing"], variant: "collecting-mementos-at-lowe-s-archery-emporium", hint: "Y3tD9W" },
  { key: "horvik", npcs: ["horvik_the_armourer"], skills: ["smithing", "defence"], variant: "collecting-mementos-at-horvik-s-smithy", hint: "Bh5wPf" },
  { key: "church", npcs: ["father_lawrence"], skills: ["prayer"], variant: "collecting-mementos-at-the-varrock-church", hint: "JDWe0x" },
  { key: "asyff", npcs: ["tailorp"], skills: ["crafting", "hunter"], variant: "collecting-mementos-at-the-fancy-clothes-store", hint: "hKxO6i" },
  { key: "aubury", npcs: ["aubury", "aubury_2op", "aubury_3op"], skills: ["magic", "runecraft", "mining"], variant: "collecting-mementos-at-aubury-s-rune-shop", hint: "qXWm4a" },
  { key: "thief", npcs: [], archived: ["25th_thief"], skills: ["thieving"], variant: "collecting-mementos-talking-to-a-thief", hint: "eVxDtD" },
  { key: "yarlo", npcs: ["daddyshome_daddy"], skills: ["construction"], variant: "collecting-mementos-visiting-old-man-yarlo", hint: "2dEPhG" },
  { key: "apothecary", npcs: ["apothecary"], skills: ["herblore"], variant: "collecting-mementos-at-the-apothecary", hint: "aljCW_" },
  { key: "dreven", npcs: ["farming_gardener_bush_1"], skills: ["farming"], variant: "collecting-mementos-at-the-champions-guild-gardener", hint: "R8kaiY" },
  { key: "tarquin", npcs: ["canoeing_tarquin"], skills: ["sailing"], variant: "collecting-mementos-at-the-canoe-station", hint: "nHNX9a" },
  { key: "harlow", npcs: ["dr_harlow"], skills: ["slayer", "woodcutting"], variant: "collecting-mementos-back-to-the-blue-moon-inn", hint: "CwJ4vD" },
]);
const ALL_COLLECTED_HINT = "-TqPqn";
const SKILLS = Object.freeze(STOPS.flatMap(stop => stop.skills));

// Native NPCs from the archive: varbit-driven multinpc parents (one global copy, each
// player sees their own form) and the per-player follower.
const SPAWNS = Object.freeze([
  // Wiki Gary (25th Anniversary event): pin 3230,3388, where the cache's 25th_stone lies.
  { role: "outside", symbol: "25th_host_outside", x: 3230, y: 3388, z: 0, face: "SOUTH" },
  // No source records the hat's tile; it rests beside Gary until he puts it on.
  { role: "hat", symbol: "25th_hat_outside", x: 3231, y: 3388, z: 0, face: "SOUTH" },
  // Wiki Wizard Gary / Portal (Varrock): the ritual grid centre, 3234,3384 upstairs.
  { role: "inside", symbol: "25th_host_inside", x: 3234, y: 3384, z: 1, face: "SOUTH" },
  // The 5x5 portal stands over the 5x5 grid: south-west tile of a size-5 NPC.
  { role: "portal", symbol: "25th_portal_multi", x: 3232, y: 3382, z: 1, face: "SOUTH" },
  // Wiki Thief (25th Anniversary event): "outside of Aubury's Rune Shop"; no tile is recorded.
  { role: "thief", symbol: "25th_thief", x: 3253, y: 3398, z: 0, face: "SOUTH", wander: 2 },
  // Wiki Gary (Realm of Memories): pin 1856,6210 plane 2. Grayzag joins him for the finale.
  { role: "realm", symbol: "25th_host_realm", x: 1856, y: 6210, z: 2, face: "NORTH" },
  { role: "grayzag", symbol: "25th_grayzag", x: 1857, y: 6210, z: 2, face: "NORTH" },
]);
const FOLLOWER = "25th_host_follower";
// Live NPCs the event re-wired onto its varbits (rev236: BigRedJapan only gains Talk-to from
// 25th_progress 5). For the window his native spawn yields to the archived event version.
const NATIVE_SWAPS = Object.freeze([{ native: "rooftops_bigredjapan", symbol: "rooftops_bigredjapan", x: 3232, y: 3401, z: 3 }]);
// Wiki Portal (Realm of Memories): exit pin 1856,6213 plane 2; arrival is the tile below it.
const REALM_ARRIVAL = Object.freeze({ x: 1856, y: 6212, z: 2 });
// Leaving the Realm returns the player to the portal room, inside its east door (3237,3384).
const REALM_EXIT = Object.freeze({ x: 3236, y: 3384, z: 1 });
const REALM_SQUARES = Object.freeze([[28, 96], [28, 97], [29, 96], [29, 97]]);
// Upstairs room holding the ritual grid (3232-3236, 3382-3386) and the stair landing at
// 3231,3382; its south side (y 3381) and east door (x 3237) lie outside it.
const HOUSE = Object.freeze({ minX: 3230, maxX: 3236, minY: 3382, maxY: 3386, z: 1 });
// Every memento source and the house lie in these 64x64 squares (the canoe station is in 50_52).
const VARROCK_SQUARES = Object.freeze(new Set(["49_52", "49_53", "49_54", "50_52", "50_53", "50_54", "51_52", "51_53", "51_54"]));
// A teleport (a jump this far) loses Gary; within it he catches up, like a pet, after a
// ladder or staircase or when he falls this many tiles behind.
const FOLLOW_LEASH = 32;
const FOLLOW_CATCH_UP = 8;

const REWARDS = Object.freeze([
  "_25TH_ANNIVERSARY_HELMET", "_25TH_ANNIVERSARY_WARRIOR_TABARD",
  "_25TH_ANNIVERSARY_SKELETON_TABARD", "_25TH_ANNIVERSARY_5X5_HAT",
]);
// Wiki: "Two noted half full wine jugs".
const WINE_JUGS = 2;
const CABBAGES = Object.freeze(["CABBAGE", "CABBAGE_2"]);
const QUESTS = Object.freeze({
  impCatcher: "imp_catcher", romeoAndJuliet: "romeo_and_juliet", oneSmallFavour: "one_small_favour",
  runeMysteries: "rune_mysteries", daddysHome: "daddys_home", vampyreSlayer: "vampyre_slayer",
});

module.exports = {
  EVENT_KEY, BUNDLE, PAGE, STOPS, ALL_COLLECTED_HINT, SKILLS, SPAWNS, FOLLOWER, NATIVE_SWAPS, REALM_ARRIVAL, REALM_EXIT,
  REALM_SQUARES, HOUSE, VARROCK_SQUARES, FOLLOW_LEASH, FOLLOW_CATCH_UP, REWARDS, WINE_JUGS, CABBAGES, QUESTS,
};
