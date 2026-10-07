const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const Guild = require("./woodcutting/Guild.Woodcutting");
const ClueNests = require("./woodcutting/ClueNests.Woodcutting");
const InfernalAxe = require("./woodcutting/InfernalAxe.Woodcutting");
const CrystalAxe = require("./woodcutting/CrystalAxe.Woodcutting");
const EntTrunk = require("./woodcutting/EntTrunk.Woodcutting");
const Shrine = require("./woodcutting/Shrine.Woodcutting");

const DEFAULT_TREE_STUMP_ID = ObjectIds.TREE_STUMP_2;
// Older trees share models but not stumps, and some sit next to an unrelated stump id; key their
// stump by the tree's model.
const NORMAL_TREE_STUMP_BY_MODEL = new Map([
  [1570, ObjectIds.TREE_STUMP_2],
  [1637, ObjectIds.TREE_STUMP_2],
  [1667, ObjectIds.TREE_STUMP_2],
  [1715, ObjectIds.TREE_STUMP_7],
  [1716, ObjectIds.TREE_STUMP_11],
  [1718, ObjectIds.TREE_STUMP_14],
  [1719, ObjectIds.TREE_STUMP_18],
  [1700, ObjectIds.TREE_STUMP_19],
  [23908, ObjectIds.TREE_STUMP_50],
  [1611, ObjectIds.TREE_STUMP_15],
  [1614, ObjectIds.TREE_STUMP_15],
  [1688, ObjectIds.TREE_STUMP_15],
  [1681, ObjectIds.TREE_STUMP_17],
  [1682, ObjectIds.TREE_STUMP_17],
  [1683, ObjectIds.TREE_STUMP_17],
  [14747, ObjectIds.DYING_TREE_STUMP],
  [3944, ObjectIds.TREE_STUMP_22],
  [4146, ObjectIds.TREE_STUMP_20],
  [4144, ObjectIds.TREE_STUMP_24],
  [16293, ObjectIds.TREE_STUMP_49],
  [33650, ObjectIds.DEAD_TREE_STUMP],
  [33625, ObjectIds.DEAD_TREE_STUMP_2],
]);
const stumpIdByTreeId = new Map();
const WOODCUTTING_ACTION_INTERVAL_TICKS = 4;
const CHOP_ANIMATION_INTERVAL_TICKS = 4;
// Fallback for multi-log trees without a known Forestry despawn timer: 1/8 per log.
const MULTI_TREE_DEPLETION_ROLL_MAX = 15;
const MULTI_TREE_DEPLETION_THRESHOLD = 2;
// OSRS Forestry: a tree's despawn timer counts down one per tick while anyone is chopping it
// and regenerates one per tick while nobody is; it falls on the first log after reaching 0.
const treeDespawnTimers = new Map();
const BIRD_NEST_DROP_CHANCE = 256;
let woodcuttingTick = 0;
let activeSessionsRef = null;
let pluginApi;

const BIRD_NESTS = Object.freeze({
  RED_EGG_NEST: ItemIds.BIRD_NEST,
  GREEN_EGG_NEST: ItemIds.BIRD_NEST_2,
  BLUE_EGG_NEST: ItemIds.BIRD_NEST_3,
  SEED_NEST: ItemIds.BIRD_NEST_4,
  RING_NEST: ItemIds.BIRD_NEST_5,
  EMPTY_NEST: ItemIds.BIRD_NEST_6,
});

const SEARCHABLE_NEST_IDS = new Set([
  BIRD_NESTS.RED_EGG_NEST,
  BIRD_NESTS.GREEN_EGG_NEST,
  BIRD_NESTS.BLUE_EGG_NEST,
  BIRD_NESTS.SEED_NEST,
  BIRD_NESTS.RING_NEST,
]);

const WOODCUTTING_CAPE_IDS = [
  ItemIds.WOODCUTTING_CAPE,
  ItemIds.WOODCUT_CAPE_T_,
  ItemIds.MAX_CAPE,
  ItemIds.MAX_CAPE_2,
  ItemIds.MAX_CAPE_3,
];
const WOODCUTTING_CAPE_NEST_MULTIPLIER = 1.1;

const LUMBERJACK_OUTFIT = [
  { slot: Equipment.HEAD_SLOT, itemIds: [ItemIds.LUMBERJACK_HAT, ItemIds.FORESTRY_HAT], bonus: 0.004 },
  { slot: Equipment.BODY_SLOT, itemIds: [ItemIds.LUMBERJACK_TOP, ItemIds.FORESTRY_TOP], bonus: 0.008 },
  { slot: Equipment.LEG_SLOT, itemIds: [ItemIds.LUMBERJACK_LEGS, ItemIds.FORESTRY_LEGS], bonus: 0.006 },
  { slot: Equipment.FEET_SLOT, itemIds: [ItemIds.LUMBERJACK_BOOTS, ItemIds.FORESTRY_BOOTS], bonus: 0.002 },
];
const LUMBERJACK_SET_BONUS = 0.005;

// OSRS Wiki seed nest table (1,011 slots).
const NEST_SEEDS = [
  { id: ItemIds.ACORN, name: "acorn", weight: 214 },
  { id: ItemIds.APPLE_TREE_SEED, name: "apple", weight: 170 },
  { id: ItemIds.WILLOW_SEED, name: "willow", weight: 135 },
  { id: ItemIds.BANANA_TREE_SEED, name: "banana", weight: 108 },
  { id: ItemIds.ORANGE_TREE_SEED, name: "orange", weight: 85 },
  { id: ItemIds.CURRY_TREE_SEED, name: "curry", weight: 68 },
  { id: ItemIds.MAPLE_SEED, name: "maple", weight: 54 },
  { id: ItemIds.PINEAPPLE_SEED, name: "pineapple", weight: 42 },
  { id: ItemIds.PAPAYA_TREE_SEED, name: "papaya", weight: 34 },
  { id: ItemIds.YEW_SEED, name: "yew", weight: 27 },
  { id: ItemIds.PALM_TREE_SEED, name: "palm", weight: 22 },
  { id: ItemIds.CALQUAT_TREE_SEED, name: "calquat", weight: 17 },
  { id: ItemIds.SPIRIT_SEED, name: "spirit", weight: 11 },
  { id: ItemIds.DRAGONFRUIT_TREE_SEED, name: "dragonfruit", weight: 6 },
  { id: ItemIds.MAGIC_SEED, name: "magic", weight: 5 },
  { id: ItemIds.TEAK_SEED, name: "teak", weight: 4 },
  { id: ItemIds.MAHOGANY_SEED, name: "mahogany", weight: 4 },
  { id: ItemIds.CELASTRUS_SEED, name: "celastrus", weight: 3 },
  { id: ItemIds.REDWOOD_TREE_SEED, name: "redwood", weight: 2 },
];

// OSRS Wiki ring nest table.
const NEST_RINGS = [
  { id: ItemIds.GOLD_RING, name: "gold", weight: 35 },
  { id: ItemIds.SAPPHIRE_RING, name: "sapphire", weight: 40 },
  { id: ItemIds.EMERALD_RING, name: "emerald", weight: 15 },
  { id: ItemIds.RUBY_RING, name: "ruby", weight: 9 },
  { id: ItemIds.DIAMOND_RING, name: "diamond", weight: 1 },
];

// Wintertodt's own supply roll reads `speed`; it follows the axe's cut-chance tier.
const AXE_SPEED_BY_TIER = [0.03, 0.05, 0.09, 0.11, 0.13, 0.16, 0.19, 0.25];

function axe(id, requiredLevel, tier, animationId, extra = {}) {
  return { id, requiredLevel, tier, speed: AXE_SPEED_BY_TIER[tier], animationId, ...extra };
}

// OSRS Wiki axe list. `tier` indexes the CUT_CHANCE rows: 3rd age, crystal and infernal axes cut
// like dragon, gilded like rune and blessed like mithril. Felling axes cut like their standard
// counterpart (their bonus needs Forester's rations, which do not exist here). Animation ids are
// RuneLite's WOODCUTTING_* constants; blessed has none of its own and uses mithril's.
// Listed worst to best: a player uses the last axe here they hold and can use.
const AXES = [
  axe(ItemIds.BRONZE_FELLING_AXE, 1, 0, 10064),
  axe(ItemIds.BRONZE_AXE, 1, 0, 879, { standard: true }),
  axe(ItemIds.IRON_FELLING_AXE, 1, 1, 10065),
  axe(ItemIds.IRON_AXE, 1, 1, 877, { standard: true }),
  axe(ItemIds.STEEL_FELLING_AXE, 6, 2, 10066),
  axe(ItemIds.STEEL_AXE, 6, 2, 875, { standard: true }),
  axe(ItemIds.BLACK_FELLING_AXE, 11, 3, 10067),
  axe(ItemIds.BLACK_AXE, 11, 3, 873, { standard: true }),
  axe(ItemIds.BLESSED_AXE, 21, 4, 871),
  axe(ItemIds.MITHRIL_FELLING_AXE, 21, 4, 10068),
  axe(ItemIds.MITHRIL_AXE, 21, 4, 871, { standard: true }),
  axe(ItemIds.ADAMANT_FELLING_AXE, 31, 5, 10069),
  axe(ItemIds.ADAMANT_AXE, 31, 5, 869, { standard: true }),
  axe(ItemIds.GILDED_AXE, 41, 6, 8303),
  axe(ItemIds.RUNE_FELLING_AXE, 41, 6, 10070),
  axe(ItemIds.RUNE_AXE, 41, 6, 867, { standard: true }),
  axe(ItemIds._3RD_AGE_FELLING_AXE, 61, 7, 10074),
  axe(ItemIds.DRAGON_FELLING_AXE, 61, 7, 10071),
  axe(ItemIds._3RD_AGE_AXE, 61, 7, 7264),
  axe(ItemIds.DRAGON_AXE, 61, 7, 2846, { standard: true }),
  axe(ItemIds.INFERNAL_AXE_UNCHARGED_, 61, 7, 2117, { requiredFiremaking: 85 }),
  axe(ItemIds.INFERNAL_AXE_UNCHARGED__2, 61, 7, 8778, { requiredFiremaking: 85 }),
  axe(ItemIds.INFERNAL_AXE_UNCHARGED__4, 61, 7, 8778, { requiredFiremaking: 85 }),
  axe(ItemIds.CRYSTAL_AXE_INACTIVE_, 71, 7, 8324, { requiredAgility: 50 }),
  axe(ItemIds.CRYSTAL_FELLING_AXE, 71, 7, 10072, { requiredAgility: 50 }),
  axe(ItemIds.CRYSTAL_AXE, 71, 7, 8324, { requiredAgility: 50 }),
  axe(ItemIds.INFERNAL_AXE, 61, 7, 2117, { requiredFiremaking: 85, speed: 0.3 }),
  axe(ItemIds.INFERNAL_AXE_OR_, 61, 7, 8778, { requiredFiremaking: 85, speed: 0.3 }),
  axe(ItemIds.INFERNAL_AXE_OR__3, 61, 7, 8778, { requiredFiremaking: 85, speed: 0.3 }),
];

// OSRS Wiki "cut chance" charts: [low, high] per axe tier (bronze, iron, steel, black, mithril,
// adamant, rune, dragon). A log is rolled every 4 ticks with chance
// (1 + floor(low * (99 - L) / 98) + floor(high * (L - 1) / 98)) / 256.
// Achey, burnt, dramen and juniper trees use the normal tree chart; arctic pine and jatoba share
// maple's. Blisterwood only lists bronze and dragon, so missing tiers scale off the normal chart.
const CUT_CHANCE = Object.freeze({
  normal: [[64, 200], [96, 300], [128, 400], [144, 450], [160, 500], [192, 600], [224, 700], [240, 750]],
  oak: [[32, 100], [48, 150], [64, 200], [72, 225], [80, 250], [96, 300], [112, 350], [120, 375]],
  willow: [[16, 50], [24, 75], [32, 100], [36, 112], [40, 125], [48, 150], [56, 175], [60, 187]],
  teak: [[15, 46], [23, 70], [31, 93], [35, 102], [39, 117], [47, 140], [55, 164], [60, 190]],
  maple: [[8, 25], [12, 37], [16, 50], [18, 56], [20, 62], [24, 75], [28, 87], [30, 93]],
  mahogany: [[8, 25], [12, 38], [16, 50], [18, 54], [20, 63], [25, 75], [29, 88], [34, 94]],
  yew: [[4, 12], [6, 19], [8, 25], [9, 28], [10, 31], [12, 37], [14, 44], [15, 47]],
  magic: [[2, 6], [3, 9], [4, 12], [5, 13], [5, 15], [6, 18], [7, 21], [7, 22]],
  redwood: [[2, 6], [3, 9], [4, 12], [4, 14], [5, 15], [6, 18], [7, 21], [7, 30]],
  hollow: [[18, 26], [28, 40], [36, 54], [42, 57], [46, 68], [59, 81], [64, 94], [67, 101]],
  blisterwood: [[15, 50], null, null, null, null, null, null, [61, 186]],
  // The Wiki lists black as 17/71, above adamant; kept as published.
  camphor: [[8, 23], [11, 36], [15, 47], [17, 71], [19, 59], [23, 71], [27, 83], [32, 89]],
  ironwood: [[6, 21], [10, 38], [13, 42], [15, 46], [17, 53], [21, 63], [24, 75], [29, 80]],
  rosewood: [[6, 18], [9, 28], [12, 37], [13, 40], [15, 47], [18, 56], [21, 66], [25, 70]],
});

const AXES_BEST_FIRST = [...AXES].reverse();

const TREES = [
  {
    name: "normal tree",
    objectNames: ["Tree", "Dead tree", "Evergreen tree", "Dying tree"],
    action: ["Chop down", "Chop-down"],
    requiredLevel: 1,
    xpReward: 25,
    logId: ItemIds.LOGS, petBase: 317647,
    objectIds: [
      ObjectIds.EVERGREEN_TREE,
      ObjectIds.EVERGREEN_TREE_2,
      ObjectIds.EVERGREEN_TREE_3,
      ObjectIds.EVERGREEN_TREE_4,
      ObjectIds.EVERGREEN_TREE_5,
      ObjectIds.EVERGREEN_TREE_6,
      ObjectIds.EVERGREEN_TREE_7,
      ObjectIds.EVERGREEN_TREE_8,
      ObjectIds.EVERGREEN_TREE_9,
      ObjectIds.JUNGLE_TREE_3,
      ObjectIds.TREE,
      ObjectIds.TREE_2,
      ObjectIds.TREE_3,
      ObjectIds.TREE_4,
      ObjectIds.TREE_5,
      ObjectIds.DEAD_TREE,
      ObjectIds.DEAD_TREE_2,
      ObjectIds.DEAD_TREE_3,
      ObjectIds.DEAD_TREE_4,
      ObjectIds.DEAD_TREE_5,
      ObjectIds.DEAD_TREE_8,
      ObjectIds.DEAD_TREE_9,
      ObjectIds.DEAD_TREE_10,
      ObjectIds.TREE_9,
      ObjectIds.TREE_10,
      ObjectIds.TREE_11,
      ObjectIds.DEAD_TREE_12,
      ObjectIds.DEAD_TREE_13,
      ObjectIds.DEAD_TREE_14,
      ObjectIds.TREE_16,
      ObjectIds.TREE_17,
      ObjectIds.TREE_18,
      ObjectIds.DEAD_TREE_18,
      ObjectIds.DEAD_TREE_19,
      ObjectIds.DEAD_TREE_20,
    ],
    cutChance: CUT_CHANCE.normal,
    respawnTicks: 59,
    respawnTicksMax: 98,
    stumpId: ObjectIds.TREE_STUMP_2,
    multi: false,
  },
  {
    name: "achey tree",
    objectNames: ["Achey Tree"],
    action: "Chop",
    requiredLevel: 1,
    xpReward: 25,
    logId: ItemIds.ACHEY_TREE_LOGS, petBase: 317647,
    objectIds: [ObjectIds.ACHEY_TREE],
    cutChance: CUT_CHANCE.normal,
    respawnTicks: 59,
    respawnTicksMax: 98,
    stumpId: ObjectIds.ACHEY_TREE_STUMP,
    multi: false,
  },
  {
    name: "oak",
    objectNames: ["Oak tree"],
    action: "Chop down",
    requiredLevel: 15,
    xpReward: 37.5,
    logId: ItemIds.OAK_LOGS, petBase: 361146,
    objectIds: [
      ObjectIds.ARCTIC_PINE_TREE,
      ObjectIds.OAK_TREE, ObjectIds.OAK_TREE_2, ObjectIds.OAK_TREE_3, ObjectIds.OAK_TREE_4,
      ObjectIds.OAK_TREE_5, ObjectIds.OAK_TREE_6, ObjectIds.OAK_TREE_7, ObjectIds.OAK_TREE_8,
      ObjectIds.OAK_TREE_9, ObjectIds.OAK_TREE_10, ObjectIds.OAK_TREE_11, ObjectIds.OAK_TREE_12,
      ObjectIds.OAK_TREE_13, ObjectIds.OAK_TREE_14, ObjectIds.OAK_TREE_15, ObjectIds.OAK_TREE_16,
      ObjectIds.OAK_TREE_17, ObjectIds.OAK_TREE_18,
    ],
    cutChance: CUT_CHANCE.oak,
    respawnTicks: 14,
    stumpId: ObjectIds.TREE_STUMP_16,
    multi: true,
    despawnTicks: 45,
  },
  {
    name: "willow",
    objectNames: ["Willow tree"],
    action: "Chop down",
    requiredLevel: 30,
    xpReward: 67.5,
    logId: ItemIds.WILLOW_LOGS, petBase: 289286,
    objectIds: [
      ObjectIds.WILLOW_TREE, ObjectIds.WILLOW_TREE_2, ObjectIds.WILLOW_TREE_3, ObjectIds.WILLOW_TREE_4,
      ObjectIds.WILLOW_TREE_5, ObjectIds.WILLOW_TREE_6, ObjectIds.WILLOW_TREE_7, ObjectIds.WILLOW_TREE_8,
      ObjectIds.WILLOW_TREE_9, ObjectIds.WILLOW_TREE_10, ObjectIds.WILLOW_TREE_11, ObjectIds.WILLOW_TREE_12,
      ObjectIds.WILLOW_TREE_13, ObjectIds.WILLOW_TREE_14,
    ],
    cutChance: CUT_CHANCE.willow,
    respawnTicks: 14,
    stumpId: ObjectIds.TREE_STUMP_35,
    multi: true,
    despawnTicks: 50,
  },
  {
    name: "teak",
    objectNames: ["Teak tree"],
    action: "Chop down",
    requiredLevel: 35,
    xpReward: 85,
    logId: ItemIds.TEAK_LOGS, petBase: 264336,
    objectIds: [
      ObjectIds.TEAK_TREE, ObjectIds.TEAK_TREE_2, ObjectIds.TEAK_TREE_3, ObjectIds.TEAK_TREE_4,
      ObjectIds.TEAK_TREE_5, ObjectIds.TEAK_TREE_6, ObjectIds.TEAK_TREE_7, ObjectIds.TEAK_TREE_8,
      ObjectIds.TEAK_TREE_9, ObjectIds.TEAK_TREE_10, ObjectIds.TEAK_TREE_11, ObjectIds.TEAK_TREE_12,
      ObjectIds.TEAK_TREE_13,
    ],
    cutChance: CUT_CHANCE.teak,
    respawnTicks: 15,
    stumpId: ObjectIds.TREE_STUMP_32,
    multi: true,
    despawnTicks: 50,
  },
  {
    name: "dramen",
    objectNames: ["Dramen tree"],
    action: "Chop down",
    requiredLevel: 36,
    xpReward: 0,
    logMessage: "You cut a branch from the Dramen tree.",
    logId: ItemIds.DRAMEN_BRANCH,
    objectIds: [ObjectIds.DRAMEN_TREE],
    cutChance: CUT_CHANCE.normal,
    respawnTicks: 17,
    multi: true,
    depletes: false,
  },
  {
    name: "maple",
    objectNames: ["Maple tree"],
    action: "Chop down",
    requiredLevel: 45,
    xpReward: 100,
    logId: ItemIds.MAPLE_LOGS, petBase: 221918,
    objectIds: [
      ObjectIds.MAPLE_TREE, ObjectIds.MAPLE_TREE_2, ObjectIds.MAPLE_TREE_3, ObjectIds.MAPLE_TREE_4,
      ObjectIds.MAPLE_TREE_5, ObjectIds.MAPLE_TREE_6, ObjectIds.MAPLE_TREE_7, ObjectIds.MAPLE_TREE_8,
      ObjectIds.MAPLE_TREE_9, ObjectIds.MAPLE_TREE_10, ObjectIds.MAPLE_TREE_11, ObjectIds.MAPLE_TREE_12,
      ObjectIds.MAPLE_TREE_13, ObjectIds.MAPLE_TREE_14, ObjectIds.MAPLE_TREE_15, ObjectIds.MAPLE_TREE_16,
      ObjectIds.MAPLE_TREE_17, ObjectIds.MAPLE_TREE_18,
    ],
    cutChance: CUT_CHANCE.maple,
    respawnTicks: 59,
    stumpId: ObjectIds.TREE_STUMP_36,
    multi: true,
    despawnTicks: 100,
  },
  {
    name: "mahogany",
    objectNames: ["Mahogany tree"],
    action: "Chop down",
    requiredLevel: 50,
    xpReward: 125,
    logId: ItemIds.MAHOGANY_LOGS, petBase: 220623,
    objectIds: [
      ObjectIds.MAHOGANY_TREE, ObjectIds.MAHOGANY_TREE_2, ObjectIds.MAHOGANY_TREE_3, ObjectIds.MAHOGANY_TREE_4,
      ObjectIds.MAHOGANY_TREE_5, ObjectIds.MAHOGANY_TREE_6, ObjectIds.MAHOGANY_TREE_7, ObjectIds.MAHOGANY_TREE_8,
      ObjectIds.MAHOGANY_TREE_9, ObjectIds.MAHOGANY_TREE_10, ObjectIds.MAHOGANY_TREE_11, ObjectIds.MAHOGANY_TREE_12,
      ObjectIds.MAHOGANY_TREE_13, ObjectIds.MAHOGANY_TREE_14,
    ],
    cutChance: CUT_CHANCE.mahogany,
    respawnTicks: 14,
    stumpId: ObjectIds.TREE_STUMP_31,
    multi: true,
    despawnTicks: 100,
  },
  {
    name: "yew",
    objectNames: ["Yew tree"],
    action: "Chop down",
    requiredLevel: 60,
    xpReward: 175,
    logId: ItemIds.YEW_LOGS, petBase: 145013,
    objectIds: [
      ObjectIds.YEW_TREE, ObjectIds.YEW_TREE_2, ObjectIds.YEW_TREE_3, ObjectIds.YEW_TREE_4,
      ObjectIds.YEW_TREE_5, ObjectIds.YEW_TREE_6, ObjectIds.YEW_TREE_7, ObjectIds.YEW_TREE_8,
      ObjectIds.YEW_TREE_9, ObjectIds.YEW_TREE_10, ObjectIds.YEW_TREE_11, ObjectIds.YEW_TREE_12,
      ObjectIds.YEW_TREE_13, ObjectIds.YEW_TREE_14, ObjectIds.YEW_TREE_15, ObjectIds.YEW_TREE_16,
      ObjectIds.YEW_TREE_17, ObjectIds.YEW_TREE_18, ObjectIds.YEW_TREE_19,
    ],
    cutChance: CUT_CHANCE.yew,
    respawnTicks: 99,
    stumpId: ObjectIds.TREE_STUMP_38,
    multi: true,
    despawnTicks: 190,
  },
  {
    name: "magic",
    objectNames: ["Magic tree"],
    action: "Chop down",
    requiredLevel: 75,
    xpReward: 250,
    logId: ItemIds.MAGIC_LOGS, petBase: 72321,
    objectIds: [
      ObjectIds.MAGIC_TREE, ObjectIds.MAGIC_TREE_2, ObjectIds.MAGIC_TREE_3, ObjectIds.MAGIC_TREE_4,
      ObjectIds.MAGIC_TREE_5, ObjectIds.MAGIC_TREE_6, ObjectIds.MAGIC_TREE_7, ObjectIds.MAGIC_TREE_8,
      ObjectIds.MAGIC_TREE_9, ObjectIds.MAGIC_TREE_10, ObjectIds.MAGIC_TREE_11, ObjectIds.MAGIC_TREE_12,
      ObjectIds.MAGIC_TREE_13, ObjectIds.MAGIC_TREE_14, ObjectIds.MAGIC_TREE_15, ObjectIds.MAGIC_TREE_16,
      ObjectIds.MAGIC_TREE_17, ObjectIds.MAGIC_TREE_18,
    ],
    cutChance: CUT_CHANCE.magic,
    respawnTicks: 199,
    stumpId: ObjectIds.TREE_STUMP_37,
    multi: true,
    despawnTicks: 390,
  },
  {
    name: "redwood",
    objectNames: ["Redwood tree"],
    action: "Cut",
    requiredLevel: 90,
    xpReward: 380,
    logId: ItemIds.REDWOOD_LOGS, petBase: 72321,
    objectIds: [
      ObjectIds.REDWOOD_TREE, ObjectIds.REDWOOD_TREE_2, ObjectIds.REDWOOD_TREE_3, ObjectIds.REDWOOD_TREE_4,
      ObjectIds.REDWOOD_TREE_5, ObjectIds.REDWOOD_TREE_6, ObjectIds.REDWOOD_TREE_7, ObjectIds.REDWOOD_TREE_8,
      ObjectIds.REDWOOD_TREE_9, ObjectIds.REDWOOD_TREE_10, ObjectIds.REDWOOD_TREE_11, ObjectIds.REDWOOD_TREE_12,
      ObjectIds.REDWOOD_TREE_13, ObjectIds.REDWOOD_TREE_14, ObjectIds.REDWOOD_TREE_15, ObjectIds.REDWOOD_TREE_16,
      ObjectIds.REDWOOD_TREE_17, ObjectIds.REDWOOD_TREE_18, ObjectIds.REDWOOD_TREE_19, ObjectIds.REDWOOD_TREE_20,
      ObjectIds.REDWOOD_TREE_21, ObjectIds.REDWOOD_TREE_22, ObjectIds.REDWOOD_TREE_23, ObjectIds.REDWOOD_TREE_24,
      ObjectIds.REDWOOD_TREE_25, ObjectIds.REDWOOD_TREE_26, ObjectIds.REDWOOD_TREE_27, ObjectIds.REDWOOD_TREE_28,
      ObjectIds.REDWOOD_TREE_29, ObjectIds.REDWOOD_TREE_30, ObjectIds.REDWOOD_TREE_31, ObjectIds.REDWOOD_TREE_32,
      ObjectIds.REDWOOD_TREE_33, ObjectIds.REDWOOD_TREE_34, ObjectIds.REDWOOD_TREE_35, ObjectIds.REDWOOD_TREE_36,
      ObjectIds.REDWOOD_TREE_37, ObjectIds.REDWOOD_TREE_38, ObjectIds.REDWOOD_TREE_39, ObjectIds.REDWOOD_TREE_40,
      ObjectIds.REDWOOD_TREE_41, ObjectIds.REDWOOD_TREE_42, ObjectIds.REDWOOD_TREE_43, ObjectIds.REDWOOD_TREE_44,
      ObjectIds.REDWOOD_TREE_45, ObjectIds.REDWOOD_TREE_46, ObjectIds.REDWOOD_TREE_47, ObjectIds.REDWOOD_TREE_48,
      ObjectIds.REDWOOD_TREE_49, ObjectIds.REDWOOD_TREE_50, ObjectIds.REDWOOD_TREE_51, ObjectIds.REDWOOD_TREE_52,
      ObjectIds.REDWOOD_TREE_53, ObjectIds.REDWOOD_TREE_54, ObjectIds.REDWOOD_TREE_55, ObjectIds.REDWOOD_TREE_56,
      ObjectIds.REDWOOD_TREE_57, ObjectIds.REDWOOD_TREE_58, ObjectIds.REDWOOD_TREE_59, ObjectIds.REDWOOD_TREE_60,
      ObjectIds.REDWOOD_TREE_61, ObjectIds.REDWOOD_TREE_62, ObjectIds.REDWOOD_TREE_63, ObjectIds.REDWOOD_TREE_64,
      ObjectIds.REDWOOD_TREE_65, ObjectIds.REDWOOD_TREE_66, ObjectIds.REDWOOD_TREE_67, ObjectIds.REDWOOD_TREE_68,
      ObjectIds.REDWOOD_TREE_69, ObjectIds.REDWOOD_TREE_70, ObjectIds.REDWOOD_TREE_71, ObjectIds.REDWOOD_TREE_72,
      ObjectIds.REDWOOD_TREE_73, ObjectIds.REDWOOD_TREE_74, ObjectIds.REDWOOD_TREE_75, ObjectIds.REDWOOD_TREE_76,
      ObjectIds.REDWOOD_TREE_77, ObjectIds.REDWOOD_TREE_78, ObjectIds.REDWOOD_TREE_79, ObjectIds.REDWOOD_TREE_80,
      ObjectIds.REDWOOD_TREE_81, ObjectIds.REDWOOD_TREE_82, ObjectIds.REDWOOD_TREE_83, ObjectIds.REDWOOD_TREE_84,
      ObjectIds.REDWOOD_TREE_85, ObjectIds.REDWOOD_TREE_86, ObjectIds.REDWOOD_TREE_87, ObjectIds.REDWOOD_TREE_88,
      ObjectIds.REDWOOD_TREE_89, ObjectIds.REDWOOD_TREE_90, ObjectIds.REDWOOD_TREE_91, ObjectIds.REDWOOD_TREE_92,
      ObjectIds.REDWOOD_TREE_93, ObjectIds.REDWOOD_TREE_94, ObjectIds.REDWOOD_TREE_95, ObjectIds.REDWOOD_TREE_96,
      ObjectIds.REDWOOD_TREE_97, ObjectIds.REDWOOD_TREE_98, ObjectIds.REDWOOD_TREE_99, ObjectIds.REDWOOD_TREE_100,
      ObjectIds.REDWOOD_TREE_101, ObjectIds.REDWOOD_TREE_102, ObjectIds.REDWOOD_TREE_103, ObjectIds.REDWOOD_TREE_104,
      ObjectIds.REDWOOD_TREE_105, ObjectIds.REDWOOD_TREE_106, ObjectIds.REDWOOD_TREE_107, ObjectIds.REDWOOD_TREE_108,
      ObjectIds.REDWOOD_TREE_109, ObjectIds.REDWOOD_TREE_110, ObjectIds.REDWOOD_TREE_111, ObjectIds.REDWOOD_TREE_112,
      ObjectIds.REDWOOD_TREE_113, ObjectIds.REDWOOD_TREE_114, ObjectIds.REDWOOD_TREE_115, ObjectIds.REDWOOD_TREE_116,
      ObjectIds.REDWOOD_TREE_117, ObjectIds.REDWOOD_TREE_118, ObjectIds.REDWOOD_TREE_119, ObjectIds.REDWOOD_TREE_120,
      ObjectIds.REDWOOD_TREE_121,
    ],
    cutChance: CUT_CHANCE.redwood,
    respawnTicks: 199,
    multi: true,
    despawnTicks: 440,
  },
  {
    name: "hollow",
    objectNames: ["Hollow tree"],
    action: "Chop down",
    requiredLevel: 45,
    xpReward: 82.5,
    logId: ItemIds.BARK, petBase: 214367,
    cutChance: CUT_CHANCE.hollow,
    respawnTicks: 43,
    multi: true,
    despawnTicks: 60,
  },
  {
    name: "arctic pine",
    objectNames: ["Arctic pine tree"],
    action: "Cut down",
    requiredLevel: 54,
    xpReward: 40,
    logId: ItemIds.ARCTIC_PINE_LOGS, petBase: 145758,
    cutChance: CUT_CHANCE.maple,
    respawnTicks: 14,
    stumpId: ObjectIds.TREE_STUMP_49,
    multi: true,
    despawnTicks: 140,
  },
  {
    name: "mature juniper",
    objectNames: ["Mature juniper tree"],
    action: "Chop down",
    requiredLevel: 42,
    xpReward: 35,
    logId: ItemIds.JUNIPER_LOGS, petBase: 360000,
    cutChance: CUT_CHANCE.normal,
    respawnTicks: 13,
    multi: true,
    depleteChance: 16,
  },
  {
    name: "jatoba",
    objectNames: ["Jatoba tree"],
    action: "Chop down",
    requiredLevel: 40,
    xpReward: 92,
    logId: ItemIds.JATOBA_LOGS, petBase: 264336,
    cutChance: CUT_CHANCE.maple,
    respawnTicks: 14,
    multi: true,
    depletes: false,
  },
  {
    name: "blisterwood",
    objectNames: ["Blisterwood tree"],
    action: "Chop",
    requiredLevel: 62,
    xpReward: 76,
    logId: ItemIds.BLISTERWOOD_LOGS, petBase: 289286,
    cutChance: CUT_CHANCE.blisterwood,
    respawnTicks: 0,
    multi: true,
    depleteChance: 10,
    // OSRS: a spider jumps out instead of the tree falling; the player just has to click again.
    interruptMessage: "A small spider jumps at you from the log you just cut.",
  },
  {
    name: "burnt tree",
    objectNames: ["Burnt tree"],
    action: "Chop down",
    requiredLevel: 1,
    xpReward: 25,
    logId: ItemIds.CHARCOAL,
    cutChance: CUT_CHANCE.normal,
    respawnTicks: 59,
    respawnTicksMax: 98,
    multi: false,
  },
  {
    name: "camphor",
    objectNames: ["Camphor tree"],
    action: "Chop down",
    requiredLevel: 66,
    xpReward: 143.5,
    logId: ItemIds.CAMPHOR_LOGS, petBase: 145013,
    cutChance: CUT_CHANCE.camphor,
    respawnTicks: 99,
    multi: true,
    despawnTicks: 200,
  },
  {
    name: "ironwood",
    objectNames: ["Ironwood tree"],
    action: "Chop down",
    requiredLevel: 80,
    xpReward: 175,
    logId: ItemIds.IRONWOOD_LOGS, petBase: 72321,
    cutChance: CUT_CHANCE.ironwood,
    respawnTicks: 199,
    multi: true,
    despawnTicks: 400,
  },
  {
    name: "rosewood",
    objectNames: ["Rosewood tree"],
    action: "Chop down",
    requiredLevel: 92,
    xpReward: 212.5,
    logId: ItemIds.ROSEWOOD_LOGS, petBase: 72321,
    cutChance: CUT_CHANCE.rosewood,
    respawnTicks: 205,
    multi: true,
    despawnTicks: 458,
  },
];

const TREES_BY_NAME = new Map(TREES.flatMap((tree) => tree.objectNames.map((name) => [name, tree])));
// Farmed sailing hardwoods chop like the wild trees but regrow on farming's own patch timer.
const FARMED_HARDWOODS = ["camphor", "ironwood", "rosewood"].map((name) => ({
  ...TREES.find((tree) => tree.name === name),
  respawnTicks: 150,
}));



const TREE_LOG_IDS = Object.freeze(
  // Only the bot-tracked trees (those with objectIds); bots also burn these, so no bark/charcoal.
  Array.from(new Set(TREES.filter((tree) => tree.objectIds).map((tree) => tree.logId)))
);

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getWoodcuttingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.WOODCUTTING);
}

function getEquippedWeaponId(player) {
  const equippedWeapon =
    player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  return equippedWeapon ? equippedWeapon.getId() : -1;
}

function canUseAxe(player, axe) {
  const skills = player.getSkillManager();
  return (
    getWoodcuttingLevel(player) >= axe.requiredLevel &&
    skills.getCurrentLevel(Skill.AGILITY) >= (axe.requiredAgility ?? 1) &&
    skills.getCurrentLevel(Skill.FIREMAKING) >= (axe.requiredFiremaking ?? 1)
  );
}

function findBestUsableAxe(player) {
  const equippedWeaponId = getEquippedWeaponId(player);
  const inventory = player.getInventory();

  for (const axe of AXES_BEST_FIRST) {
    if ((equippedWeaponId === axe.id || inventory.contains(axe.id)) && canUseAxe(player, axe)) {
      return axe;
    }
  }

  return null;
}

// Bots only ever get the standard bronze-to-dragon axes.
function findBestUsableAxeByLevel(level) {
  for (const axe of AXES_BEST_FIRST) {
    if (axe.standard && level >= axe.requiredLevel) {
      return axe;
    }
  }
  return null;
}

function isWoodcuttingActive(player) {
  return !!(activeSessionsRef && player && activeSessionsRef.has(player));
}

function cutChanceRange(tree, axe) {
  const chart = tree.cutChance ?? CUT_CHANCE.normal;
  const range = chart[axe.tier];
  if (range) {
    return range;
  }
  const [baseLow, baseHigh] = chart[0];
  const [normalLow, normalHigh] = CUT_CHANCE.normal[axe.tier];
  const [normalBaseLow, normalBaseHigh] = CUT_CHANCE.normal[0];
  return [Math.round((baseLow * normalLow) / normalBaseLow), Math.round((baseHigh * normalHigh) / normalBaseHigh)];
}

function calculateCutChance(level, tree, axe) {
  const [low, high] = cutChanceRange(tree, axe);
  const successes = 1 + Math.floor((low * (99 - level)) / 98) + Math.floor((high * (level - 1)) / 98);
  return Math.min(1, Math.max(0, successes / 256));
}

function rollLog(player, tree, axe) {
  const level = getWoodcuttingLevel(player) + Guild.invisibleBoost(player);
  return Math.random() < calculateCutChance(level, tree, axe);
}

// OSRS Wiki: hat 0.4%, top 0.8%, legs 0.6%, boots 0.2%, plus 0.5% for all four; forestry pieces count.
function lumberjackXpMultiplier(player) {
  const worn = LUMBERJACK_OUTFIT.filter((piece) => isWearing(player, piece.slot, piece.itemIds));
  const bonus = worn.reduce((sum, piece) => sum + piece.bonus, 0);
  return 1 + bonus + (worn.length === LUMBERJACK_OUTFIT.length ? LUMBERJACK_SET_BONUS : 0);
}

function logMessage(tree) {
  if (tree.logMessage) {
    return tree.logMessage;
  }
  const name = pluginApi.core.ItemDefinition.forId(tree.logId).getName().toLowerCase();
  return `You get some ${name}.`;
}

function treeTimerKey(objectId, location) {
  return `${objectId}:${location.getX()},${location.getY()},${location.getZ()}`;
}

function tickTreeDespawnTimer(state, currentTick) {
  if (!state.tree.despawnTicks) {
    return;
  }
  const key = treeTimerKey(state.objectId, state.location);
  let timer = treeDespawnTimers.get(key);
  if (!timer) {
    timer = { remaining: state.tree.despawnTicks, max: state.tree.despawnTicks, lastChopTick: -1 };
    treeDespawnTimers.set(key, timer);
  }
  // Several players on one tree still only drain it once per tick.
  if (timer.lastChopTick !== currentTick) {
    timer.lastChopTick = currentTick;
    timer.remaining = Math.max(0, timer.remaining - 1);
  }
}

function regenerateTreeDespawnTimers(currentTick) {
  for (const [key, timer] of treeDespawnTimers) {
    if (timer.lastChopTick === currentTick) {
      continue;
    }
    timer.remaining++;
    if (timer.remaining >= timer.max) {
      treeDespawnTimers.delete(key);
    }
  }
}

function shouldDepleteTree(state) {
  const tree = state.tree;
  if (tree.depletes === false) {
    return false;
  }
  if (!tree.multi) {
    return true;
  }
  if (tree.despawnTicks) {
    const timer = treeDespawnTimers.get(treeTimerKey(state.objectId, state.location));
    return !!timer && timer.remaining <= 0;
  }
  if (tree.depleteChance) {
    return randomIntInclusive(1, tree.depleteChance) === 1;
  }
  const roll = randomIntInclusive(0, MULTI_TREE_DEPLETION_ROLL_MAX);
  return roll < MULTI_TREE_DEPLETION_THRESHOLD;
}

function rollWeighted(table) {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = randomIntInclusive(1, total);
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry;
    }
  }
  return table[table.length - 1];
}

function isWearing(player, slot, itemIds) {
  const item = player.getEquipment().getItems()[slot];
  return !!item && itemIds.includes(item.getId());
}

// OSRS: 100 slots (seed 65, ring 32, one per egg colour); a strung rabbit foot drops 5 seed slots.
function rollBirdNestId(player) {
  const seedWeight = isWearing(player, Equipment.AMULET_SLOT, [ItemIds.STRUNG_RABBIT_FOOT]) ? 60 : 65;
  return rollWeighted([
    { id: BIRD_NESTS.SEED_NEST, weight: seedWeight },
    { id: BIRD_NESTS.RING_NEST, weight: 32 },
    { id: BIRD_NESTS.RED_EGG_NEST, weight: 1 },
    { id: BIRD_NESTS.GREEN_EGG_NEST, weight: 1 },
    { id: BIRD_NESTS.BLUE_EGG_NEST, weight: 1 },
  ]).id;
}

function maybeDropBirdNest(player) {
  if (!player) {
    return;
  }
  const chance = isWearing(player, Equipment.CAPE_SLOT, WOODCUTTING_CAPE_IDS)
    ? WOODCUTTING_CAPE_NEST_MULTIPLIER / BIRD_NEST_DROP_CHANCE
    : 1 / BIRD_NEST_DROP_CHANCE;
  if (Math.random() >= chance) {
    return;
  }

  const nestId = rollBirdNestId(player);
  ItemOnGroundManager.registers(player, new Item(nestId, 1));
  player.sendMessage("<col=ff0000>A bird's nest falls out of the tree.");
}

function rollNestSeed() {
  return rollWeighted(NEST_SEEDS);
}

function rollNestRing() {
  return rollWeighted(NEST_RINGS);
}

function searchBirdNest(player, nestId) {
  if (!SEARCHABLE_NEST_IDS.has(nestId)) {
    return false;
  }

  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("Your inventory is too full to search the bird's nest.");
    return true;
  }

  player.getInventory().deleteNumber(nestId, 1);
  player.getInventory().adds(BIRD_NESTS.EMPTY_NEST, 1);

  if (nestId === BIRD_NESTS.SEED_NEST) {
    const seed = rollNestSeed();
    player.getInventory().adds(seed.id, 1);
    player.sendMessage(`You take a ${seed.name} seed out of the bird's nest.`);
    return true;
  }

  if (nestId === BIRD_NESTS.RING_NEST) {
    const ring = rollNestRing();
    player.getInventory().adds(ring.id, 1);
    player.sendMessage(`You take a ${ring.name} ring out of the bird's nest.`);
    return true;
  }

  const eggId =
    nestId === BIRD_NESTS.RED_EGG_NEST
      ? ItemIds.BIRDS_EGG
      : nestId === BIRD_NESTS.GREEN_EGG_NEST
        ? ItemIds.BIRDS_EGG_3
        : ItemIds.BIRDS_EGG_2;
  player.getInventory().adds(eggId, 1);
  player.sendMessage("You take the bird's egg out of the bird's nest.");
  return true;
}

function stopWoodcutting(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

class TreeRespawnTask extends Task {
  constructor(delayTicks, originalTreeObject, stumpObject) {
    super(Math.max(1, delayTicks));
    this.originalTreeObject = originalTreeObject;
    this.stumpObject = stumpObject;
  }

  execute() {
    const existingStump = MapObjects.get(
      this.stumpObject.getId(),
      this.stumpObject.getLocation(),
      this.stumpObject.getPrivateArea()
    );
    if (existingStump) {
      ObjectManager.deregister(existingStump, true);
    }

    // Always re-register the original tree so clients receive an explicit spawn
    // update, even if cache-backed map objects can still resolve this id/location.
    ObjectManager.register(this.originalTreeObject, true);

    this.stop();
  }
}

function firstModelId(def) {
  return def?.models?.[0]?.[0];
}

// Newer trees keep their depleted state at the next loc id: an option-less "...stump", or (redwood,
// some Forestry-era maples) an option-less loc with the tree's own name and a different model.
function nextIdStump(treeId, treeDef, allowSameName) {
  const next = pluginApi.core.CacheDefinitions.getObject(treeId + 1);
  if (!next || (next.actions || []).some(Boolean)) {
    return null;
  }
  const isStump = /stump/i.test(next.name || "");
  const isDepletedVariant =
    allowSameName && next.name === treeDef.name && firstModelId(next) !== firstModelId(treeDef);
  return isStump || isDepletedVariant ? treeId + 1 : null;
}

function resolveStumpId(treeId, tree) {
  if (stumpIdByTreeId.has(treeId)) {
    return stumpIdByTreeId.get(treeId);
  }
  const treeDef = pluginApi.core.CacheDefinitions.getObject(treeId);
  const stumpId =
    NORMAL_TREE_STUMP_BY_MODEL.get(firstModelId(treeDef)) ??
    (treeDef && nextIdStump(treeId, treeDef, false)) ??
    (treeDef && nextIdStump(treeId, treeDef, true)) ??
    tree.stumpId ??
    DEFAULT_TREE_STUMP_ID;
  stumpIdByTreeId.set(treeId, stumpId);
  return stumpId;
}

function rollRespawnTicks(tree) {
  return tree.respawnTicksMax
    ? randomIntInclusive(tree.respawnTicks, tree.respawnTicksMax)
    : tree.respawnTicks;
}

function depleteTree(player, treeObject, tree) {
  const respawnTicks = rollRespawnTicks(tree);
  const event = { player, object: treeObject, respawnTicks, handled: false };
  pluginApi.emitCustomEvent("woodcutting:deplete-tree", event);
  if (event.handled) return;
  const stump = new GameObject(
    resolveStumpId(treeObject.getId(), tree),
    treeObject.getLocation().clone(),
    treeObject.getType(),
    treeObject.getFace(),
    treeObject.getPrivateArea()
  );
  ObjectManager.deregister(treeObject, true);
  ObjectManager.register(stump, true);
  TaskManager.submit(new TreeRespawnTask(respawnTicks, treeObject, stump));
}

function startWoodcutting(player, treeObject, tree, activeSessions) {
  const request = { player, object: treeObject, allow: true };
  pluginApi.emitCustomEvent("woodcutting:validate-tree", request);
  if (!request.allow) return false;
  const axe = findBestUsableAxe(player);
  if (!axe) {
    player.sendMessage("You don't have an axe which you can use.");
    return false;
  }

  const woodcuttingLevel = getWoodcuttingLevel(player);
  if (woodcuttingLevel < tree.requiredLevel) {
    player.sendMessage(
      `You need a Woodcutting level of at least ${tree.requiredLevel} to cut this tree.`
    );
    return false;
  }

  if (tree.logId >= 0 && player.getInventory().isFull()) {
    player.getInventory().full();
    return false;
  }

  const location = treeObject.getLocation().clone();
  const existingTree = MapObjects.get(
    treeObject.getId(),
    location,
    treeObject.getPrivateArea()
  );
  if (!existingTree) {
    player.sendMessage("You can't reach that tree right now.");
    return false;
  }

  player.getSkillManager()?.stopSkillable?.();
  stopWoodcutting(activeSessions, player, false);
  // reset() clears the face the object click set, so face the tree again.
  player.getCombat()?.reset?.();
  player.setPositionToFace(treeObject.getLocation());

  activeSessions.set(player, {
    tree,
    axe,
    objectId: treeObject.getId(),
    location,
    privateArea: treeObject.getPrivateArea(),
    nextActionTick: woodcuttingTick + WOODCUTTING_ACTION_INTERVAL_TICKS,
    nextAnimationTick: woodcuttingTick + CHOP_ANIMATION_INTERVAL_TICKS,
  });

  player.sendMessage("You swing your axe at the tree..");
  player.performAnimation(new Animation(axe.animationId));
  return true;
}

function processWoodcuttingTick(activeSessions, currentTick) {
  for (const [player, state] of activeSessions) {
    if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
      activeSessions.delete(player);
      continue;
    }

    if (player.getForceMovement() != null) {
      continue;
    }

    if (player.getMovementQueue()?.size?.() > 0) {
      stopWoodcutting(activeSessions, player);
      continue;
    }

    const activeTree = MapObjects.get(
      state.objectId,
      state.location,
      state.privateArea
    );
    if (!activeTree) {
      stopWoodcutting(activeSessions, player);
      continue;
    }
    const request = { player, object: activeTree, allow: true };
    pluginApi.emitCustomEvent("woodcutting:validate-tree", request);
    if (!request.allow) {
      stopWoodcutting(activeSessions, player);
      continue;
    }

    if (
      !player.getLocation().isWithinInteractionDistance(activeTree.getLocation())
    ) {
      stopWoodcutting(activeSessions, player);
      continue;
    }

    const axe = findBestUsableAxe(player);
    if (!axe) {
      player.sendMessage("You don't have an axe which you can use.");
      stopWoodcutting(activeSessions, player);
      continue;
    }

    const woodcuttingLevel = getWoodcuttingLevel(player);
    if (woodcuttingLevel < axe.requiredLevel) {
      player.sendMessage(
        "You don't have an axe which you have the required Woodcutting level to use."
      );
      stopWoodcutting(activeSessions, player);
      continue;
    }

    if (woodcuttingLevel < state.tree.requiredLevel) {
      player.sendMessage(
        `You need a Woodcutting level of at least ${state.tree.requiredLevel} to cut this tree.`
      );
      stopWoodcutting(activeSessions, player);
      continue;
    }

    state.axe = axe;

    if (state.tree.logId >= 0 && player.getInventory().isFull()) {
      player.getInventory().full();
      stopWoodcutting(activeSessions, player);
      continue;
    }

    tickTreeDespawnTimer(state, currentTick);

    if (currentTick >= state.nextAnimationTick) {
      player.performAnimation(new Animation(state.axe.animationId));
      state.nextAnimationTick = currentTick + CHOP_ANIMATION_INTERVAL_TICKS;
    }

    if (currentTick < state.nextActionTick) {
      continue;
    }
    state.nextActionTick = currentTick + WOODCUTTING_ACTION_INTERVAL_TICKS;
    if (!rollLog(player, state.tree, state.axe)) {
      continue;
    }

    if (state.tree.logId >= 0) {
      if (!InfernalAxe.tryBurnLog(player, state.axe.id, state.tree.logId)) {
        player.getInventory().adds(state.tree.logId, 1);
        player.sendMessage(logMessage(state.tree));
      }
      CrystalAxe.tryUseCharge(player);
      player
        .getSkillManager()
        .addExperiences(Skill.WOODCUTTING, state.tree.xpReward * lumberjackXpMultiplier(player));
      pluginApi.emitCustomEvent("woodcutting:success", {
        player,
        skill: Skill.WOODCUTTING,
        petBase: state.tree.petBase,
        logId: state.tree.logId,
      });
      maybeDropBirdNest(player);
      ClueNests.rollClueNests(player, state.tree);
    }

    if (shouldDepleteTree(state)) {
      treeDespawnTimers.delete(treeTimerKey(state.objectId, state.location));
      if (state.tree.interruptMessage) {
        player.sendMessage(state.tree.interruptMessage);
        stopWoodcutting(activeSessions, player);
        continue;
      }
      Sounds.sendSound(player, Sound.WOODCUTTING_TREE_DOWN);
      depleteTree(player, activeTree, state.tree);
      stopWoodcutting(activeSessions, player);
      continue;
    }
  }
}

class WoodcuttingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.currentTick = 0;
  }

  execute() {
    this.currentTick++;
    woodcuttingTick = this.currentTick;
    processWoodcuttingTick(this.activeSessions, this.currentTick);
    regenerateTreeDespawnTimers(this.currentTick);
  }
}

let TaskManager;
let ObjectManager;
let ItemOnGroundManager;

function handleChop(event) {
  const tree = TREES_BY_NAME.get(event.definition.getName());
  if (!tree) {
    return;
  }

  startWoodcutting(event.player, event.object, tree, activeSessionsRef);

  // Tree clicks are fully handled by this plugin (including fail messages).
  event.handled = true;
}

function requestedChop(event) {
  // Patch hardwoods share log ids with the wild trees but regrow on farming's own timer.
  let tree = [...FARMED_HARDWOODS, ...TREES].find(tree => tree.logId === event.logId);
  if (tree && event.removeOnly) tree = { ...tree, logId: -1, xpReward: 0, multi: false };
  if (tree) event.handled = startWoodcutting(event.player, event.object, tree, activeSessionsRef);
}

module.exports = {
  name: "Woodcutting",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("woodcutting:chop", requestedChop);
    TaskManager = api.getTaskManager();
    ObjectManager = api.getObjectManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    const activeSessions = new Map();
    activeSessionsRef = activeSessions;

    TaskManager.submit(new WoodcuttingTask(activeSessions));
    Guild.attach(api);
    ClueNests.attach(api);
    InfernalAxe.attach(api);
    CrystalAxe.attach(api);
    EntTrunk.attach(api, { findBestUsableAxe, calculateCutChance, lumberjackXpMultiplier, maybeDropBirdNest });
    Shrine.attach(api);

    api.onPlayerDisconnect(({ player }) => {
      stopWoodcutting(activeSessions, player, false);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopWoodcutting(activeSessions, player, false);
    });

    api.onItemFirstAction((event) => {
      if (searchBirdNest(event.player, event.itemId)) {
        event.handled = true;
        return true;
      }
      return false;
    });

    for (const tree of TREES) {
      for (const name of tree.objectNames) {
        for (const action of [].concat(tree.action)) {
          api.onObjectInteraction(name, { [action]: handleChop });
        }
      }
    }

    api.log("registered", {
      treeNames: TREES_BY_NAME.size,
      supportedTrees: TREES.length,
      axes: AXES.length,
    });
  },
  AXES,
  AXES_BEST_FIRST,
  TREES,
  TREE_LOG_IDS,
  findBestUsableAxe,
  findBestUsableAxeByLevel,
  isWoodcuttingActive,
};
