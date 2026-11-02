const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const InfernalPickaxe = require("./mining/InfernalPickaxe.Mining");
const CrystalPickaxe = require("./mining/CrystalPickaxe.Mining");
const ClueGeodes = require("./mining/ClueGeodes.Mining");
const { pauseForLevelUp } = require("./SkillActions");

// rsprox recordings: a mined-out rock becomes "rocks1"/"rocks2" (the digit of the rock's own gameval,
// copperrock2 -> rocks2) and the miner is sent a respawn timer by the cache's add_overlaytimer_loc.
// The Sailing rocks have their own "<gameval>_empty" loc (leadrock1 -> leadrock1_empty, named "Rocks").
const DEPLETED_ROCK_NAME = "rocks";
const EMPTY_ROCK_SUFFIX = "_empty";
const DEFAULT_DEPLETED_ROCK = `${DEPLETED_ROCK_NAME}1`;
const ROCK_VARIANT_PATTERN = /rock_?(\d)$/;
const RESPAWN_TIMER_SCRIPT = 5474; // add_overlaytimer_loc: coord, loc, shape, timer id, ticks, colour, 0
const RESPAWN_TIMER_ID = 1;
const RESPAWN_TIMER_COLOUR = 16765184;
const NO_ORE_MESSAGE = "There is currently no ore available in this rock.";
// rsprox captures 3139 (rev 232): Mine on a mined-out rock stops the swing and plays this sound.
const NO_ORE_SOUND = 2661;
// The rocks without their own mined-out loc that still offer Mine (amethyst's wall).
const EMPTY_ROCK_NAMES = ["Empty wall"];
const SWING_MESSAGE = "You swing your pick at the rock.";
const NO_PICKAXE_MESSAGE = "You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.";
const MINING_SUCCESS_SOUND = 3600;
const SMELT_SOUND = 2725;
const SMOKEPUFF_GRAPHIC = 86;
const SMOKEPUFF_HEIGHT = 150;
const ORE_MINED_VARP = "tracking_ore_mined";
const ORE_MINED_ATTRIBUTE = "mining:ores-mined";
// rsprox recordings 3139 and 3182: with the skilling timer clear, the first roll lands the tick
// after the swing (+2 after arrival; 33 of 34 iron attempts); later rolls follow the pickaxe.
// Each roll replays the swing (rsprox captures 1636, 3162, 3165, 468: the sequence is resent on
// every roll tick, at the pickaxe's interval), and the ore that empties the rock resets it.
const FIRST_ROLL_DELAY_TICKS = 2;
// Wiki "Skilling success rate": (1 + floor(low * (99 - L) / 98 + high * (L - 1) / 98 + 0.5)) / 256,
// with the visible level capped at 99 and invisible boosts added on top.
const SUCCESS_ROLL_SIDES = 256;
const MAX_VISIBLE_LEVEL = 99;
// Wiki "Template:MiningPreGemDropTable": a 1/256 gem roll before each ore roll (a charged glory adds a
// 3/256 roll when it fails); a hit gives a gem or nothing, never the ore, no XP, and the rock stays.
const GEM_ROLL_FACES = 1;
const GLORY_GEM_ROLL_FACES = 3;
const CHARGED_GLORY_PATTERN = /^Amulet of (glory ?\(t?[1-6]\)|eternal glory)$/;
const GEM_TABLE = [
  { name: null, weight: 70 },
  { name: "UNCUT_SAPPHIRE", weight: 32 },
  { name: "UNCUT_EMERALD", weight: 16 },
  { name: "UNCUT_RUBY", weight: 8 },
  { name: "UNCUT_DIAMOND", weight: 2 },
];
let miningTick = 0;

// Wiki Pickaxe "Ticks between rolls": the pickaxe sets how often the game rolls, never the chance.
// `key` names its wall swings: human_mining_<key>_pickaxe_wall, sang_mining_wall_<key>_pickaxe.
// Dragon and infernal: 3 ticks, 1/6 chance of 2; crystal: 3 ticks, 1/4 chance of 2 (members worlds only).
const PICKAXES = [
  { id: ItemIds.BRONZE_PICKAXE, key: "bronze", requiredLevel: 1, attemptIntervalTicks: 8, animation: new Animation(625) },
  { id: ItemIds.IRON_PICKAXE, key: "iron", requiredLevel: 1, attemptIntervalTicks: 7, animation: new Animation(626) },
  { id: ItemIds.STEEL_PICKAXE, key: "steel", requiredLevel: 6, attemptIntervalTicks: 6, animation: new Animation(627) },
  { id: ItemIds.BLACK_PICKAXE, key: "black", requiredLevel: 11, attemptIntervalTicks: 5, animation: new Animation(3873) },
  { id: ItemIds.MITHRIL_PICKAXE, key: "mithril", requiredLevel: 21, attemptIntervalTicks: 5, animation: new Animation(629) },
  { id: ItemIds.ADAMANT_PICKAXE, key: "adamant", requiredLevel: 31, attemptIntervalTicks: 4, animation: new Animation(628) },
  { id: ItemIds.RUNE_PICKAXE, key: "rune", requiredLevel: 41, attemptIntervalTicks: 3, animation: new Animation(624) },
  { id: ItemIds.DRAGON_PICKAXE, key: "dragon", requiredLevel: 61, attemptIntervalTicks: 3, fastRollChance: 1 / 6, animation: new Animation(7139) },
  { id: ItemIds.CRYSTAL_PICKAXE, key: "crystal", requiredLevel: 71, attemptIntervalTicks: 3, fastRollChance: 1 / 4, animation: new Animation(8347) },
  { id: ItemIds.INFERNAL_PICKAXE, key: "infernal", requiredLevel: 61, attemptIntervalTicks: 3, fastRollChance: 1 / 6, animation: new Animation(4482) },
  // The league's Echo pickaxe (Wiki): a crystal pickaxe with no requirement that always rolls every 2 ticks; `rank` places it above the crystal one.
  { id: ItemIds.ECHO_PICKAXE, key: "crystal", requiredLevel: 1, rank: 72, attemptIntervalTicks: 2, animation: new Animation(8347) },
];

/** Best first: by the level they need, a `rank` standing in for a tool whose requirement understates it. */
const PICKAXES_DESC = [...PICKAXES].sort((a, b) => (b.rank ?? b.requiredLevel) - (a.rank ?? a.requiredLevel)
  || a.attemptIntervalTicks - b.attemptIntervalTicks);

// Wiki rock pages: level, XP, respawn, and each rock's skilling success chart (`chance`: its low and
// high values). Rocks with `gems` roll the mining gem table before each ore roll.
const ROCKS = [
  { objectName: "Clay rocks", objectIds: [9711, 9712, 9713, 15503, 15504, 15505], level: 1, xp: 5, oreId: ItemIds.CLAY, petBase: 741600, chance: [128, 400], gems: true, respawnTicks: 2 },
  { objectName: "Copper rocks", objectIds: [7453,7484], level: 1, xp: 17.5, oreId: ItemIds.COPPER_ORE, petBase: 741600, chance: [100, 350], gems: true, respawnTicks: 4 },
  { objectName: "Tin rocks", objectIds: [7485, 7486], level: 1, xp: 17.5, oreId: ItemIds.TIN_ORE, petBase: 741600, chance: [100, 350], gems: true, respawnTicks: 4 },
  { objectName: "Blurite rocks", objectIds: [ObjectIds.BLURITE_ROCKS, ObjectIds.BLURITE_ROCKS_2], level: 10, xp: 17.5, oreId: ItemIds.BLURITE_ORE, chance: [90, 350], gems: true, respawnTicks: 42 },
  { objectName: "Iron rocks", objectIds: [7455, 7488], level: 15, xp: 35, oreId: ItemIds.IRON_ORE, petBase: 741600, chance: [96, 350], gems: true, respawnTicks: 9 },
  // Wiki Barronite rocks: level 14, 1-minute respawn; each success is 76% shards (4-6, 16xp)
  // or 24% deposit (1, 32xp). The rock depletes 20 seconds after it starts being mined, not on an
  // ore. rsprox capture 1636 (rev 226): wall swings, three ores off one rock that stays standing,
  // and a vein that runs out goes to its "_empty" loc with area sound 2661 (delay 10, range 1).
  {
    objectName: "Barronite rocks",
    objectIds: [41547, 41548, 41549, 41550],
    level: 14, xp: 32, oreId: ItemIds.BARRONITE_DEPOSIT,
    chance: [80, 100], gems: true, respawnTicks: 100, swing: "wall",
    depletionTicks: 33, depletionSound: { id: 2661, delay: 10, radius: 1 },
    outcomes: [
      { itemId: ItemIds.BARRONITE_SHARDS, min: 4, max: 6, weight: 76, xp: 16, message: "You manage to mine some barronite shards." },
      { itemId: ItemIds.BARRONITE_DEPOSIT, min: 1, max: 1, weight: 24, xp: 32, message: "You manage to mine a barronite deposit." },
    ],
  },
  // Wiki Sandstone rocks / Granite rocks: one piece per success, then the rock is "rocks1" for 9 ticks
  // (5.4 s; recorded add_overlaytimer_loc 9). The charts cascade: the biggest piece is rolled first and
  // each failed roll falls through to the next size; failing them all gives nothing. No gem pre-roll.
  // Recorded (232/03162): "You manage to quarry some sandstone."
  {
    objectName: "Sandstone rocks",
    objectIds: [11386],
    level: 35, xp: 30, oreId: 6971, petBase: 741600, // Wiki (Rock golem, Clue geode)
    respawnTicks: 9,
    cascade: [
      { itemId: 6977, chance: [4, 50], xp: 60, message: "You manage to quarry some sandstone." },
      { itemId: 6975, chance: [8, 75], xp: 50, message: "You manage to quarry some sandstone." },
      { itemId: 6973, chance: [16, 100], xp: 40, message: "You manage to quarry some sandstone." },
      { itemId: 6971, chance: [25, 200], xp: 30, message: "You manage to quarry some sandstone." },
    ],
  },
  {
    objectName: "Granite rocks",
    objectIds: [11387],
    depletedRock: "rocks2", // recorded (227/01757, 234/03285)
    level: 45, xp: 50, oreId: 6979, petBase: 741600,
    respawnTicks: 9,
    cascade: [
      { itemId: 6983, chance: [6, 64], xp: 75, message: "You manage to quarry some granite." },
      { itemId: 6981, chance: [8, 75], xp: 60, message: "You manage to quarry some granite." },
      { itemId: 6979, chance: [16, 100], xp: 50, message: "You manage to quarry some granite." },
    ],
  },
  { objectName: "Silver rocks", objectIds: [7457], level: 20, xp: 40, oreId: ItemIds.SILVER_ORE, petBase: 741600, chance: [25, 200], gems: true, respawnTicks: 100 },
  { objectName: "Coal rocks", objectIds: [7456], level: 30, xp: 50, oreId: ItemIds.COAL, petBase: 290640, chance: [16, 100], gems: true, respawnTicks: 50 },
  { objectName: "Gold rocks", objectIds: [7491, 9720, 9721, 9722, 11951, 11183, 11184, 11185, 2099, ObjectIds.GOLD_ROCKS_2], level: 40, xp: 65, oreId: ItemIds.GOLD_ORE, petBase: 296640, chance: [7, 75], gems: true, respawnTicks: 100 },
  { objectName: "Mithril rocks", objectIds: [7492, 7459], level: 55, xp: 80, oreId: ItemIds.MITHRIL_ORE, petBase: 148320, chance: [4, 50], gems: true, respawnTicks: 200 },
  { objectName: "Adamantite rocks", objectIds: [7460], level: 70, xp: 95, oreId: ItemIds.ADAMANTITE_ORE, petBase: 59328, chance: [2, 25], gems: true, respawnTicks: 400 },
  { objectName: "Runite rocks", objectIds: [14859, 4860, 2106, 2107, 7461], level: 85, xp: 125, oreId: ItemIds.RUNITE_ORE, petBase: 42377, chance: [1, 18], gems: true, respawnTicks: 1200 },
  // Wiki Soft clay rocks: success is certain long before 70, so clay's chart; 1.2 s respawn.
  { objectName: "Soft clay rocks", level: 70, xp: 5, oreId: ItemIdentifiers.SOFT_CLAY, petBase: 741600, chance: [128, 400], gems: true, respawnTicks: 2, oreMessage: "You manage to mine some soft clay." },
  // Wiki Lead rocks (Mod Ash's chart); 6 s respawn. Mined out as leadrock1_empty.
  { objectName: "Lead rocks", level: 25, xp: 40.5, oreId: ItemIdentifiers.LEAD_ORE, petBase: 741600, chance: [112, 278], gems: true, respawnTicks: 10 },
  // Wiki Lovakite rocks: 35 s respawn. No published chart: coal's is an estimate.
  { objectName: "Lovakite rocks", level: 65, xp: 60, oreId: ItemIdentifiers.LOVAKITE_ORE, petBase: 245562, chance: [16, 100], gems: true, respawnTicks: 58 },
  // Wiki Nickel rocks: 2-16 ores before the rock goes, 2 min respawn; only Varrock armour 4 adds ore,
  // so no "mining:extra-ore". No published chart: mithril's is an estimate.
  { objectName: "Nickel rocks", level: 74, xp: 80.5, oreId: ItemIdentifiers.NICKEL_ORE, petBase: 247200, chance: [4, 50], gems: true, respawnTicks: 200, yield: { min: 2, max: 16 }, noExtraOre: true },
  // Wiki Rubium rocks: stackable splinters, two a success from 72; at least two before the rock goes,
  // then a 1/6 chance on each. 35.4 s respawn. The chart is an estimate from the Wiki's splinter rates.
  { objectName: "Rubium rocks", level: 48, xp: 30, oreId: ItemIdentifiers.RUBIUM_SPLINTERS, chance: [107, 230], gems: true, respawnTicks: 59, yield: { min: 2, chance: 1 / 6 }, doubleFromLevel: 72, oreMessage: "You manage to mine some rubium splinters." },
  // Wiki Sunstone rocks: 5.4 s respawn. Its chart is the Wiki's momentum rate (75% at 53, 100% at 80);
  // momentum itself is not modelled. No gem pre-roll on the Wiki page.
  { objectName: "Sunstone rocks", level: 53, xp: 23, oreId: ItemIdentifiers.SUNSTONE, petBase: 741600, chance: [69, 301], respawnTicks: 9 },
  // Wiki Infernal shale rocks: one of ten XP values per shale, 9-tick respawn, no mining enhancers.
  // "Between iron and coal" to mine: the chart is an estimate.
  {
    objectName: "Infernal shale rocks",
    level: 78, xp: 13.2, oreId: ItemIdentifiers.INFERNAL_SHALE,
    chance: [60, 180], gems: true, respawnTicks: 9,
    outcomes: [13.2, 19.6, 21.7, 27.5, 30, 32.5, 38.3, 40.4, 46.8, 100].map((xp) => (
      { itemId: ItemIdentifiers.INFERNAL_SHALE, weight: 1, xp, message: "You manage to mine some infernal shale." }
    )),
  },
  // Wiki Gem rocks: 99-tick respawn, a charged glory triples the chart, no mining enhancers.
  // Recorded (227/1846, 1858, Leagues): "You just mined an Opal!", sound 2655, gemrock -> rocks2, gemrock1 -> rocks1.
  {
    objectName: "Gem rocks",
    level: 40, xp: 65, oreId: ItemIdentifiers.UNCUT_OPAL, petBase: 211886,
    chance: [28, 70], gloryChance: [84, 210], respawnTicks: 99, sound: 2655,
    depletedRocks: { gemrock: "rocks2" },
    outcomes: [
      { itemId: ItemIdentifiers.UNCUT_OPAL, weight: 60, xp: 65, message: "You just mined an Opal!" },
      { itemId: ItemIdentifiers.UNCUT_JADE, weight: 30, xp: 65, message: "You just mined a piece of Jade!" },
      { itemId: ItemIdentifiers.UNCUT_RED_TOPAZ, weight: 15, xp: 65, message: "You just mined a Red Topaz!" },
      { itemId: ItemIdentifiers.UNCUT_SAPPHIRE, weight: 9, xp: 65, message: "You just mined a Sapphire!" },
      { itemId: ItemIdentifiers.UNCUT_EMERALD, weight: 5, xp: 65, message: "You just mined an Emerald!" },
      { itemId: ItemIdentifiers.UNCUT_RUBY, weight: 5, xp: 65, message: "You just mined a Ruby!" },
      { itemId: ItemIdentifiers.UNCUT_DIAMOND, weight: 4, xp: 65, message: "You just mined a Diamond!" },
    ],
  },
  // Wiki Amethyst crystals (Mod Ash's chart): 2-3 amethyst before the wall empties, 75 s respawn.
  // Recorded (233-234, Leagues): wall swings, "You manage to mine some amethyst.", amethystrock_empty.
  { objectName: "Amethyst crystals", level: 92, xp: 240, oreId: ItemIdentifiers.AMETHYST, petBase: 46350, chance: [-18, 10], gems: true, respawnTicks: 125, yield: { min: 2, max: 3 }, swing: "wall", depletedRock: "amethystrock_empty" },
  // Wiki Daeyalt rocks: 17.5 XP, 28 s respawn. Recorded (226-231): sang wall swings, sound 2998,
  // "You manage to mine some ore." and the face steps down a stage per ore, _01 -> _02 -> _03,
  // then _04 with "This rock face is now empty.". Ore came on every roll: iron's chart is an estimate.
  {
    objectName: "Daeyalt rocks",
    level: 20, xp: 17.5, oreId: ItemIdentifiers.DAEYALT_ORE,
    chance: [96, 350], respawnTicks: 47, swing: "sang", sound: 2998, oreMessage: "You manage to mine some ore.", gameMessage: true,
    stages: ["area_sanguine_mine_minerocks_01", "area_sanguine_mine_minerocks_02", "area_sanguine_mine_minerocks_03"],
    depletedRock: "area_sanguine_mine_minerocks_04", emptyMessage: "This rock face is now empty.",
  },
];

// The essence mine rocks are infinite and have no level requirement. Every roll succeeds (Wiki
// Pure essence, Mod Ash: "it's like everyone gets a 100% chance at any level"), so no `chance`.
// rsprox captures 70 (rev 227) and 3027 (rev 231): each essence plays sound 3600 and counts in
// tracking_ore_mined, with no chat line.
const ESSENCE_ROCKS = [
  { objectName: "Rune Essence", objectIds: [ObjectIds.RUNE_ESSENCE_3], level: 1, xp: 5, oreId: ItemIds.PURE_ESSENCE, respawnTicks: 0, infinite: true, silent: true },
  { objectName: "Rune essence", objectIds: [ObjectIds.RUNE_ESSENCE, ObjectIds.RUNE_ESSENCE_2], level: 1, xp: 5, oreId: ItemIds.PURE_ESSENCE, respawnTicks: 0, infinite: true, silent: true },
];

const ALL_ROCKS = [...ROCKS, ...ESSENCE_ROCKS];

const ROCK_BY_NAME = new Map(ALL_ROCKS.map((rock) => [rock.objectName, rock]));
let activeSessions;
const ACTIVE_MINERS = new Set();
// The tick each player's skilling timer next allows a roll.
const ROLL_READY_TICKS = new Map();
// Ore taken so far from rocks that give several before going (`yield`), by the standing rock.
const ROCK_YIELDS = new WeakMap();
// Ticks left on a rock that runs out on a timer (`depletionTicks`), by the standing rock; it counts
// down on the ticks someone mines it.
const ROCK_TIMERS = new WeakMap();
const SWING_SEQUENCES = { wall: (key) => `human_mining_${key}_pickaxe_wall`, sang: (key) => `sang_mining_wall_${key}_pickaxe` };
const swingAnimations = new Map();

/** The pickaxe's swing at this rock: its own, or its wall swing at a wall rock (`swing`). */
function swingAnimation(pickaxe, rock) {
  const sequence = rock.swing && SWING_SEQUENCES[rock.swing](pickaxe.key);
  if (!sequence) return pickaxe.animation;
  if (!swingAnimations.has(sequence)) {
    const id = pluginApi.core.CacheDefinitions.getSeqId(sequence);
    swingAnimations.set(sequence, id == null ? pickaxe.animation : new Animation(id));
  }
  return swingAnimations.get(sequence);
}

/**
 * Whether a rock with a `yield` still stands after this ore: a fixed count drawn the first time
 * (`min`-`max`), or past `min` ores a `chance` each ore that it goes.
 */
function rockHolds(rockObject, rock) {
  const { yield: rockYield } = rock;
  if (!rockYield) return false;
  const taken = ROCK_YIELDS.get(rockObject) ?? {
    mined: 0,
    total: rockYield.max === undefined ? Infinity : rockYield.min + Math.floor(Math.random() * (rockYield.max - rockYield.min + 1)),
  };
  taken.mined++;
  const holds = rockYield.chance === undefined
    ? taken.mined < taken.total
    : !(taken.mined >= rockYield.min && Math.random() < rockYield.chance);
  if (holds) ROCK_YIELDS.set(rockObject, taken);
  else ROCK_YIELDS.delete(rockObject);
  return holds;
}

class RockRespawnTask extends Task {
  constructor(delayTicks, originalRockObject, depletedObject) {
    super(Math.max(1, delayTicks));
    this.originalRockObject = originalRockObject;
    this.depletedObject = depletedObject;
  }

  execute() {
    const existingDepleted = MapObjects.get(
      this.depletedObject.getId(),
      this.depletedObject.getLocation(),
      this.depletedObject.getPrivateArea()
    );
    if (existingDepleted) {
      ObjectManager.deregister(existingDepleted, true);
    }
    ObjectManager.register(this.originalRockObject, true);
    this.stop();
  }
}

function getMiningLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.MINING);
}

/**
 * The level the success rolls use: the visible level, capped at 99, plus invisible boosts other plugins
 * add ("mining:level-boost", the celestial ring's +4), which do count past 99 (Wiki "Skilling success
 * rate", Boosts over 99). Requirements still read the visible level.
 */
function getRollMiningLevel(player) {
  const request = { player, boost: 0 };
  pluginApi.emitCustomEvent("mining:level-boost", request);
  return Math.min(MAX_VISIBLE_LEVEL, getMiningLevel(player)) + Math.max(0, Number(request.boost) || 0);
}

/** The Wiki skilling success numerator out of 256 for a chart's [low, high] at this level. */
function successNumerator([low, high], level) {
  const numerator = 1 + Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5);
  return Math.max(0, Math.min(SUCCESS_ROLL_SIDES, numerator));
}

function rollSucceeds(chance, level) {
  return Math.floor(Math.random() * SUCCESS_ROLL_SIDES) < successNumerator(chance, level);
}

/** Ticks to the next roll: the pickaxe's interval, one less on a dragon/infernal/crystal speed-up (members only). */
function rollInterval(pickaxe) {
  const fast = pickaxe.fastRollChance && pluginApi.core.WorldDefinition.isMembersWorld() && Math.random() < pickaxe.fastRollChance;
  return pickaxe.attemptIntervalTicks - (fast ? 1 : 0);
}

function wearsChargedGlory(player) {
  const amulet = player.getEquipment().getItems()[Equipment.AMULET_SLOT];
  if (!amulet || amulet.getId() <= 0) return false;
  return CHARGED_GLORY_PATTERN.test(pluginApi.core.CacheDefinitions.getItem(amulet.getId())?.name ?? "");
}

/** The gem pre-roll hits on the top face(s) of a 256 roll: 1/256, and 3/256 more with a charged glory. */
function rollGemTable(player) {
  const hit = (faces) => Math.floor(Math.random() * SUCCESS_ROLL_SIDES) >= SUCCESS_ROLL_SIDES - faces;
  if (!hit(GEM_ROLL_FACES) && !(wearsChargedGlory(player) && hit(GLORY_GEM_ROLL_FACES))) {
    return false;
  }
  const total = GEM_TABLE.reduce((sum, row) => sum + row.weight, 0);
  let roll = Math.random() * total;
  const row = GEM_TABLE.find((entry) => (roll -= entry.weight) < 0) ?? GEM_TABLE[0];
  return { itemId: row.name ? pluginApi.core.ItemIdentifiers[row.name] : null };
}

/** "You just found a Sapphire!" / "an Emerald!" (rsprox recordings 403 and 90; Emerald, Ruby, Diamond on Leagues worlds). */
function gemMessage(itemId) {
  const gem = pluginApi.core.CacheDefinitions.getItem(itemId).name.replace(/^Uncut /, "");
  const name = gem.charAt(0).toUpperCase() + gem.slice(1);
  return `You just found ${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}!`;
}

/** A cascading chart (sandstone, granite): the first size whose roll succeeds, else nothing. */
function rollCascade(rock, level) {
  return rock.cascade.find((outcome) => rollSucceeds(outcome.chance, level)) ?? null;
}

/** "mining:best-pickaxe": the best pickaxe the player can use, for other mining content (stars). */
function answerBestPickaxe(request) {
  if (request && request.player && request.pickaxe == null) {
    request.pickaxe = findBestPickaxe(request.player);
  }
}

/** "mining:roll-interval": ticks to the next roll with `pickaxe`, for other mining content (stars, GotR, Volcanic Mine). */
function answerRollInterval(request) {
  if (request && request.pickaxe && request.ticks == null) {
    request.ticks = rollInterval(request.pickaxe);
  }
}

function findBestPickaxe(player) {
  const miningLevel = getMiningLevel(player);
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  const weaponId = weapon ? weapon.getId() : -1;

  for (const pickaxe of PICKAXES_DESC) {
    if (miningLevel < pickaxe.requiredLevel) {
      continue;
    }
    if (weaponId === pickaxe.id || player.getInventory().contains(pickaxe.id)) {
      return pickaxe;
    }
  }
  return null;
}

function stopMining(activeSessions, player, resetAnim = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  ACTIVE_MINERS.delete(player);
  if (resetAnim) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

/**
 * The mined-out loc for a rock: its own (granite's rocks2, gemrock's rocks2), else its gameval's
 * "_empty" loc (leadrock1_empty), else "rocks" plus the digit its gameval ends in (copperrock2 -> rocks2).
 */
function depletedRockId(rockId, rock) {
  const { CacheDefinitions } = pluginApi.core;
  const gameval = CacheDefinitions.getLocNames().get(rockId) ?? "";
  const own = rock?.depletedRocks?.[gameval] ?? rock?.depletedRock;
  if (own) return CacheDefinitions.getLocId(own);
  const empty = CacheDefinitions.getLocId(`${gameval}${EMPTY_ROCK_SUFFIX}`);
  if (gameval && empty != null) return empty;
  const variant = ROCK_VARIANT_PATTERN.exec(gameval)?.[1];
  return CacheDefinitions.getLocId(variant ? `${DEPLETED_ROCK_NAME}${variant}` : DEFAULT_DEPLETED_ROCK);
}

/** The respawn timer the client draws over a depleted rock (cache script add_overlaytimer_loc), with the loc's own shape (0 for amethyst's wall). */
function sendRespawnTimer(player, depleted, ticks) {
  const location = depleted.getLocation();
  const coordinate = (location.getZ() << 28) | (location.getX() << 14) | location.getY();
  player
    .getPacketSender()
    .sendClientScript(RESPAWN_TIMER_SCRIPT, coordinate, depleted.getId(), depleted.getType(), RESPAWN_TIMER_ID, ticks, RESPAWN_TIMER_COLOUR, 0);
}

/** Another loc in the rock's place (a staged rock's next stage, or its mined-out loc). */
function replaceRock(rockObject, locId) {
  const replacement = new GameObject(
    locId,
    rockObject.getLocation().clone(),
    rockObject.getType(),
    rockObject.getFace(),
    rockObject.getPrivateArea()
  );
  ObjectManager.deregister(rockObject, true);
  ObjectManager.register(replacement, true);
  return replacement;
}

/** A staged rock's next stage after this ore (Daeyalt _01 -> _02 -> _03), or null on its last. */
function nextStageId(rockObject, rock) {
  if (!rock.stages) return null;
  const { CacheDefinitions } = pluginApi.core;
  const stage = rock.stages.indexOf(CacheDefinitions.getLocNames().get(rockObject.getId()));
  return stage >= 0 && stage < rock.stages.length - 1 ? CacheDefinitions.getLocId(rock.stages[stage + 1]) : null;
}

/** Depletes the rock unless content keeps it standing ("mining:deplete-rock", a league relic's four ores a rock); true when it went. */
function depleteRock(player, rockObject, rock) {
  const event = { player, object: rockObject, rock: rock.objectName, handled: false };
  pluginApi.emitCustomEvent("mining:deplete-rock", event);
  if (event.handled) return false;
  // A staged rock grows back whole, from whichever stage it was mined out.
  const whole = rock.stages ? new GameObject(
    pluginApi.core.CacheDefinitions.getLocId(rock.stages[0]),
    rockObject.getLocation().clone(),
    rockObject.getType(),
    rockObject.getFace(),
    rockObject.getPrivateArea()
  ) : rockObject;
  const depleted = replaceRock(rockObject, depletedRockId(rockObject.getId(), rock));
  if (rock.depletionSound) {
    const at = depleted.getLocation();
    const { id, delay, radius } = rock.depletionSound;
    pluginApi.core.Sounds.playAreaSound({ soundId: id, delay, radius, x: at.getX(), y: at.getY(), level: at.getZ() });
  }
  TaskManager.submit(new RockRespawnTask(rock.respawnTicks, whole, depleted));
  sendRespawnTimer(player, depleted, rock.respawnTicks);
  if (rock.emptyMessage) player.sendMessage(rock.emptyMessage);
  return true;
}

/** Failures are message boxes in live OSRS (rsprox recordings). */
function messageBox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function inventoryFull(player, oreId) {
  const name = pluginApi.core.CacheDefinitions.getItem(oreId).name.toLowerCase();
  messageBox(player, `Your inventory is too full to hold any more ${name}.`);
}

/** "You manage to mine some iron." - the first word of the rock's name, as recorded for each ore. */
function oreMessage(rock) {
  return `You manage to mine some ${rock.objectName.split(" ")[0].toLowerCase()}.`;
}

function startMining(player, rockObject, rock, activeSessions) {
  const pickaxe = findBestPickaxe(player);
  if (!pickaxe) {
    messageBox(player, NO_PICKAXE_MESSAGE);
    return false;
  }

  const miningLevel = getMiningLevel(player);
  if (miningLevel < rock.level) {
    messageBox(player, `You need a Mining level of ${rock.level} to mine this rock.`);
    return false;
  }
  if (inventoryBlocks(player, rock.oreId)) {
    inventoryFull(player, rock.oreId);
    return false;
  }

  stopMining(activeSessions, player, false);
  activeSessions.set(player, {
    rock,
    pickaxe,
    objectId: rockObject.getId(),
    location: rockObject.getLocation().clone(),
    privateArea: rockObject.getPrivateArea(),
    swingTick: miningTick + 1,
    // The skilling timer carries over between rocks: a roll waits for the last one's interval.
    nextRollTick: Math.max(miningTick + FIRST_ROLL_DELAY_TICKS, ROLL_READY_TICKS.get(player) ?? 0),
  });
  ACTIVE_MINERS.add(player);
  return true;
}

/** Mining's chat lines are spam (rsprox captures), except where a rock was recorded otherwise. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, text);
}

/** The first swing lands the tick after the click (rsprox recordings: message and animation at +1). */
function swing(player, state) {
  state.swingTick = undefined;
  spam(player, SWING_MESSAGE);
  player.performAnimation(swingAnimation(state.pickaxe, state.rock));
}

/**
 * A rock on a depletion timer (barronite) loses a tick on each tick someone mines it; true once it
 * has run out.
 */
function rockTimerRanOut(rockObject, rock) {
  if (!rock.depletionTicks) return false;
  const timer = ROCK_TIMERS.get(rockObject) ?? { left: rock.depletionTicks, tick: -1 };
  if (timer.tick !== miningTick) {
    timer.tick = miningTick;
    timer.left--;
  }
  ROCK_TIMERS.set(rockObject, timer);
  return timer.left <= 0;
}

/** The line for an ore, with " and give it to <taker>" when someone takes it off the player. */
function successLine(rock, outcome, taker) {
  const line = outcome?.message ?? rock.oreMessage ?? oreMessage(rock);
  return taker ? line.replace(/\.$/, `, and give it to ${taker}.`) : line;
}

/** Which of a successful roll's weighted outcomes (barronite shards or a deposit) the player gets. */
function rollOutcome(rock) {
  const { outcomes } = rock;
  const total = outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  let roll = Math.random() * total;
  return outcomes.find((outcome) => (roll -= outcome.weight) < 0) ?? outcomes[outcomes.length - 1];
}

/** One roll's result: a gem-table hit, the ore outcome, or null for a miss. */
function rollAttempt(player, rock) {
  if (rock.gems) {
    const gem = rollGemTable(player);
    if (gem) return { gem };
  }
  const level = getRollMiningLevel(player);
  if (rock.cascade) {
    const outcome = rollCascade(rock, level);
    return outcome ? { outcome } : null;
  }
  // A charged glory has gem rocks roll their own, better chart (Wiki Gem rocks).
  const chance = rock.gloryChance && wearsChargedGlory(player) ? rock.gloryChance : rock.chance;
  if (chance && !rollSucceeds(chance, level)) {
    return null;
  }
  return { outcome: rock.outcomes ? rollOutcome(rock) : null };
}

/**
 * A gem-table hit: the gem (or nothing), no XP, and the rock is left as it was. The find line comes
 * before an open gem bag's own line (Wiki Transcript:Gem bag).
 */
function giveGem(player, { itemId }) {
  if (itemId == null) return;
  player.sendMessage(gemMessage(itemId));
  giveOre(player, itemId, 1);
}

function outcomeAmount(outcome) {
  return outcome.min + Math.floor(Math.random() * (outcome.max - outcome.min + 1));
}

/** One ore a success, or two from a rock's `doubleFromLevel` (rubium splinters at 72, the visible level). */
function oreAmount(player, rock) {
  return rock.doubleFromLevel !== undefined && getMiningLevel(player) >= rock.doubleFromLevel ? 2 : 1;
}

class MiningTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.cycle = 0;
  }

  execute() {
    this.cycle++;
    miningTick = this.cycle;
    for (const [player, state] of this.activeSessions) {
      if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
        this.activeSessions.delete(player);
        continue;
      }
      if (player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
        stopMining(this.activeSessions, player);
        continue;
      }
      if (state.levelUpPaused) continue;

      const rockObject = MapObjects.get(
        state.objectId,
        state.location,
        state.privateArea
      );
      if (!rockObject) {
        stopMining(this.activeSessions, player);
        continue;
      }

      if (!rockObject.isWithinInteractionDistance(player.getLocation())) {
        stopMining(this.activeSessions, player);
        continue;
      }

      const pickaxe = findBestPickaxe(player);
      if (!pickaxe || getMiningLevel(player) < state.rock.level) {
        stopMining(this.activeSessions, player);
        continue;
      }

      state.pickaxe = pickaxe;

      if (inventoryBlocks(player, state.rock.oreId)) {
        inventoryFull(player, state.rock.oreId);
        stopMining(this.activeSessions, player);
        continue;
      }

      if (state.swingTick !== undefined && this.cycle >= state.swingTick) {
        swing(player, state);
      }
      if (rockTimerRanOut(rockObject, state.rock)) {
        // The countdown ends with this depletion: the rock that respawns, or one content keeps
        // standing ("mining:deplete-rock"), starts a fresh one.
        ROCK_TIMERS.delete(rockObject);
        if (depleteRock(player, rockObject, state.rock)) {
          stopMining(this.activeSessions, player);
          continue;
        }
      }

      if (this.cycle < state.nextRollTick) {
        continue;
      }
      state.nextRollTick = this.cycle + rollInterval(pickaxe);
      ROLL_READY_TICKS.set(player, state.nextRollTick);
      player.performAnimation(swingAnimation(state.pickaxe, state.rock));

      const result = rollAttempt(player, state.rock);
      // Content may turn a miss into a hit ("mining:attempt", a league relic's second chance); a gem roll is never a miss.
      const attempt = { player, object: rockObject, oreId: state.rock.oreId, success: result !== null };
      pluginApi.emitCustomEvent("mining:attempt", attempt);
      const landed = result ?? (attempt.success ? { outcome: state.rock.outcomes ? rollOutcome(state.rock) : null } : null);
      if (!landed) continue;
      if (landed.gem) {
        giveGem(player, landed.gem);
        continue;
      }

      const { outcome } = landed;
      const oreId = outcome?.itemId ?? state.rock.oreId;
      const amount = outcome?.min !== undefined ? outcomeAmount(outcome) : oreAmount(player, state.rock);
      // Content may take the ore off the player as it is mined ("mining:hand-over", Miscellania's
      // coal goes to Miner Magnus): no ore, no count and no sound, only the line naming who took it.
      const handOver = { player, object: rockObject, itemId: oreId, amount, taker: null };
      pluginApi.emitCustomEvent("mining:hand-over", handOver);
      let pendingOre = null;
      let kept = false;
      if (!handOver.taker) {
        if (InfernalPickaxe.tryCombustOre(player, state.pickaxe.id, oreId)) {
          player.performGraphic(new pluginApi.core.Graphic(SMOKEPUFF_GRAPHIC, 0, SMOKEPUFF_HEIGHT));
          player.getPacketSender().sendSoundEffect(SMELT_SOUND, 1, 0, 1);
        } else {
          pendingOre = prepareOre(player, oreId, amount, outcome?.xp ?? state.rock.xp);
          countOre(player);
          kept = true;
        }
        player.getPacketSender().sendSoundEffect(state.rock.sound ?? MINING_SUCCESS_SOUND, 1, 0, 1);
      }
      if (!state.rock.silent) {
        const line = successLine(state.rock, outcome, handOver.taker);
        if (state.rock.gameMessage) player.sendMessage(line);
        else spam(player, line);
      }
      CrystalPickaxe.tryUseCharge(player);
      player.getSkillManager().addExperiences(Skill.MINING, outcome?.xp ?? state.rock.xp);
      // OSRS gives a winning pet the last backpack slot before the resource.
      // Storage and XP retain their order; ordinary success consumers run after delivery.
      const petRoll = { player, skill: Skill.MINING, petBase: state.rock.petBase, handled: false };
      pluginApi.emitCustomEvent("pets:skilling-roll", petRoll);
      deliverOre(player, pendingOre);
      if (kept && !state.rock.outcomes) mineExtraOre(player, state.rock, outcome);
      pluginApi.emitCustomEvent("mining:success", { player, skill: Skill.MINING, petBase: state.rock.petBase, itemId: oreId, petRolled: petRoll.handled });
      if (state.rock.infinite || state.rock.depletionTicks) {
        if (inventoryBlocks(player, state.rock.oreId)) {
          inventoryFull(player, state.rock.oreId);
          stopMining(this.activeSessions, player);
          continue;
        }
        continue;
      }
      // A staged rock steps down and the player mines on; a rock with a `yield` may hold more ore.
      const nextStage = nextStageId(rockObject, state.rock);
      if (nextStage != null) {
        state.objectId = replaceRock(rockObject, nextStage).getId();
        continue;
      }
      if (rockHolds(rockObject, state.rock)) continue;
      if (!depleteRock(player, rockObject, state.rock)) continue;
      stopMining(this.activeSessions, player);
    }
  }
}

let TaskManager;
let ObjectManager;
let pluginApi;

/**
 * A full inventory stops mining unless the ore stacks onto what the player holds (rubium splinters)
 * or an open container (the coal bag) has room for it ("storage:room").
 */
function inventoryBlocks(player, oreId) {
  if (!player.getInventory().isFull()) {
    return false;
  }
  if (pluginApi.core.ItemDefinition.forId(oreId)?.isStackable?.() === true && player.getInventory().contains(oreId)) {
    return false;
  }
  // `skill`: the skill gathering it, so content storing one skill's resources answers only for those.
  const request = { player, itemId: oreId, skill: pluginApi.core.Skill.MINING, room: false };
  pluginApi.emitCustomEvent("storage:room", request);
  return !request.room;
}

/** An open container takes the ore first ("storage:gather"); the rest goes to the inventory. */
function giveOre(player, oreId, amount, xp = 0) {
  const request = { player, itemId: oreId, amount, stored: 0, skill: Skill.MINING, xp };
  pluginApi.emitCustomEvent("storage:gather", request);
  if (amount > request.stored) {
    player.getInventory().adds(oreId, amount - request.stored);
  }
}

/** Storage resolves first; a winning pet can take room reserved for the remaining ore. */
function prepareOre(player, oreId, amount, xp) {
  const request = { player, itemId: oreId, amount, stored: 0, skill: Skill.MINING, xp };
  pluginApi.emitCustomEvent("storage:gather", request);
  return amount > request.stored ? new pluginApi.core.Item(oreId, amount - request.stored) : null;
}

function deliverOre(player, ore) {
  if (!ore) return;
  const amount = ore.getAmount();
  const accepted = player.getInventory().getAddableAmount(ore);
  if (accepted > 0) player.getInventory().add(ore.clone().setAmount(accepted), true);
  if (accepted < amount) pluginApi.getItemOnGroundManager().registers(player, ore.clone().setAmount(amount - accepted));
}

/**
 * "mining:extra-ore": a mining enhancer (the charged celestial ring) may grant a second ore with
 * its experience, and its own `message`. Without room for it, neither is given (Wiki, Mod Ash).
 * A sandstone or granite piece is doubled at its own size (Wiki Sandstone rocks; rsprox capture
 * 3165: "Your cape allows you to mine an additional ore.", two 1kg pieces, two counts).
 */
function mineExtraOre(player, rock, outcome) {
  if (rock.infinite || rock.noExtraOre) {
    return;
  }
  const oreId = outcome?.itemId ?? rock.oreId;
  const xp = outcome?.xp ?? rock.xp;
  const request = { player, oreId, rockLevel: rock.level, extra: false, message: null };
  pluginApi.emitCustomEvent("mining:extra-ore", request);
  if (!request.extra || inventoryBlocks(player, oreId)) {
    return;
  }
  if (request.message) spam(player, request.message);
  giveOre(player, oreId, 1, xp);
  countOre(player);
  player.getSkillManager().addExperiences(Skill.MINING, xp);
}

/** tracking_ore_mined counts every ore kept, essence too (rsprox captures 70, 3027); the client reads it for the Mining tab. */
function countOre(player) {
  const mined = (player.getAttribute(ORE_MINED_ATTRIBUTE) ?? 0) + 1;
  player.setAttribute(ORE_MINED_ATTRIBUTE, mined);
  player.getPacketSender().sendConfig(pluginApi.core.CacheDefinitions.getVarpId(ORE_MINED_VARP), mined);
}

function sendOresMined({ player }) {
  const mined = player.getAttribute(ORE_MINED_ATTRIBUTE);
  if (mined > 0) {
    player.getPacketSender().sendConfig(pluginApi.core.CacheDefinitions.getVarpId(ORE_MINED_VARP), mined);
  }
}

/** A depleted rock ("rocks1"/"rocks2", a Sailing rock's "_empty" loc, amethyst's empty wall) still offers Mine; it only says it is empty. */
function mineDepletedRock(event) {
  const { CacheDefinitions } = pluginApi.core;
  const gameval = CacheDefinitions.getLocNames().get(event.object.getId()) ?? "";
  const depleted = [`${DEPLETED_ROCK_NAME}1`, `${DEPLETED_ROCK_NAME}2`].includes(gameval) || gameval.endsWith(EMPTY_ROCK_SUFFIX)
    || EMPTY_ROCK_NAMES.includes(CacheDefinitions.getObject(event.object.getId())?.name);
  if (!depleted) {
    return false;
  }
  stopMining(activeSessions, event.player, false);
  event.player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  event.player.getPacketSender().sendSoundEffect(NO_ORE_SOUND, 1, 0, 1);
  event.player.sendMessage(NO_ORE_MESSAGE);
  event.handled = true;
}

function handleMine(event) {
  const rock = ROCK_BY_NAME.get(event.definition.getName());
  if (!rock) {
    return;
  }

  const started = startMining(event.player, event.object, rock, activeSessions);
  if (started) {
    event.handled = true;
  }
}

function endMiningSession({ player }) {
  stopMining(activeSessions, player, false);
  ROLL_READY_TICKS.delete(player);
}

function pauseMining(event) {
  pauseForLevelUp(event, activeSessions, (player) => stopMining(activeSessions, player, false));
}

module.exports = {
  name: "Mining",
  PICKAXES,
  PICKAXES_DESC,
  ROCKS,
  ESSENCE_ROCKS,
  findBestPickaxe,
  rollOutcome,
  isMiningActive(player) {
    return ACTIVE_MINERS.has(player);
  },
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    ObjectManager = api.getObjectManager();
    activeSessions = new Map();
    TaskManager.submit(new MiningTask(activeSessions));

    api.onPlayerDisconnect(endMiningSession);
    api.onCustomEvent("level-up:popup-opened", pauseMining);
    api.onCustomEvent("mining:best-pickaxe", answerBestPickaxe);
    api.onCustomEvent("mining:roll-interval", answerRollInterval);
    api.persistAttribute(ORE_MINED_ATTRIBUTE, 0);
    api.onPlayerLogin(sendOresMined);
    api.onObjectInteraction("Rocks", { Mine: mineDepletedRock });
    for (const name of EMPTY_ROCK_NAMES) api.onObjectInteraction(name, { Mine: mineDepletedRock });

    for (const rock of ALL_ROCKS) {
      api.onObjectInteraction(rock.objectName, { Mine: handleMine });
    }

    InfernalPickaxe.attach(api);
    CrystalPickaxe.attach(api);
    ClueGeodes.attach(api);

    api.log("registered", {
      rocks: ROCKS.length,
      essenceRocks: ESSENCE_ROCKS.length,
      pickaxes: PICKAXES.length,
    });
  },
};
