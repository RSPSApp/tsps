const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { ItemIds, NpcIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const QuestRuntime = require("../quests/QuestRuntime");
const InfernalHarpoon = require("./fishing/InfernalHarpoon.Fishing");
const CrystalHarpoon = require("./fishing/CrystalHarpoon.Fishing");
const Guild = require("./fishing/Guild.Fishing");
const AnglerOutfit = require("./fishing/AnglerOutfit.Fishing");
const MinnowPlatform = require("./fishing/MinnowPlatform.Fishing");
const RadasBlessing = require("./fishing/RadasBlessing.Fishing");
const KarambwanVessel = require("./fishing/Karambwan.Fishing");
const ClueBottles = require("./fishing/ClueBottles.Fishing");
const { pauseForLevelUp } = require("./SkillActions");

// Ticks per resource roll (Wiki: Game tick/Action lengths): rods 5, net, cage and harpoon
// spots 6, karambwan vessels 4. Spots the table leaves out keep the rods' 5.
const FISHING_ACTION_INTERVAL_TICKS = 5;
const NET_CAGE_HARPOON_INTERVAL_TICKS = 6;
const KARAMBWAN_INTERVAL_TICKS = 4;
// rsprox captures (rev 237, recordings 1098, 1102, 1106, 1149): the first roll comes 3 ticks
// after the start line for nets and cages, 4 for harpoons and rods, then every interval.
const NET_CAGE_FIRST_ROLL_TICKS = 3;
const HARPOON_ROD_FIRST_ROLL_TICKS = 4;
// Tools without animateOnRoll restart their animation this often instead.
const FISHING_ANIMATION_INTERVAL_TICKS = 5;
let fishingTick = 0;

// Rods cast once (human_fishing_casting), then wait on the spot (human_fish_onspot) on every
// roll; the barbarian rod has its own pair (rsprox captures 75, 1098, 1102, 1149).
const ANIM = Object.freeze({
  HARPOON: 618, CAGE: 619, BIG_NET: 620, NET: 621, ROD: 622, ROD_ON_SPOT: 623, VESSEL: 1193,
  BARBARIAN_ROD: 9349, BARBARIAN_ROD_ON_SPOT: 9350,
});

// rsprox captures 552, 1106, 3276 and 3285: a full inventory stops fishing with this message
// box, a reset animation and this sound, on the tick after the last catch.
const FULL_INVENTORY_STATEMENT = "You can't carry any more fish.";
const FULL_INVENTORY_SOUND = 2277;

// Start lines (rsprox captures): nets 7 recordings, harpoons 12, rods 8, lobster pots 6.
const CAST_NET = "You cast out your net...";
const CAST_LINE = "You cast out your line...";
const CAST_AND_ATTEMPT = "You cast out your line...<br>You attempt to catch a fish.";
const START_HARPOON = "You start harpooning fish.";

// Missing bait is a message box (rsprox captures 75, 1149, 1710, 1718, 1757, 1858, 3275).
const NO_FISHING_BAIT = "You don't have any fishing bait.";
const NO_FEATHERS = "You don't have any feathers left.";
const NO_BARBARIAN_BAIT = "You don't have any suitable bait left.";
// The level gate names the option (rsprox captures 1102 for the harpoon, 1718 for bait).
const harpoonLevel = (level) => `You need to be at least level ${level} Fishing to harpoon these fish.`;
const baitLevel = (level) => `You need at least level ${level} Fishing to bait these fish.`;

class Fish {
  /**
   * rolls: Wiki skilling success chart values [low, high] (out of 256, at levels 1 and 99).
   * Most fish have one; a big net's mackerel has two, so one cast can net two.
   * requires/extraXp: other skills barbarian fishing needs and trains.
   * amount: how many of the fish one catch lands (minnows come 10-14 at a time).
   * message: the catch message, when it isn't "You catch <caught>." (given the amount landed).
   * junk: not a fish (a big net's boots), so no pet roll and no "fishing:success".
   */
  constructor({ id, level, rolls, xp, caught, petBase = null, requires = [], extraXp = [], amount = () => 1, message = null, junk = false }) {
    this.id = id;
    this.level = level;
    this.rolls = rolls;
    this.experience = xp;
    /** What "You catch ..." names, matching OSRS since the 2024 raw-fish message update. */
    this.caught = caught;
    /** Heron base chance (Wiki); null where the Wiki gives no rate, so no pet roll. */
    this.petBase = petBase;
    this.requires = requires;
    this.extraXp = extraXp;
    this.amount = amount;
    this.message = message ?? (() => `You catch ${caught}.`);
    this.junk = junk;
  }
}

class FishingTool {
  /**
   * fish: highest level first. OSRS rolls them in that order (the Wiki charts' "cascade")
   * and the first success is the catch, unless multi: then every roll stands on its own and
   * one cast can land several items, as a big net does.
   * variants: items that count as this tool, best first, each with a level and catch bonus.
   * bait: any one of these is used up per catch. worn: one must be equipped.
   * quest: required once that quest is implemented here.
   * interval: ticks between attempts, or a function giving them. unboostable: the level must be the real one.
   * spot: a module that moves its own spots and can take over a catch (minnows' flying fish).
   * vessel: a module holding the bait in the tool itself, used up by every attempt (karambwan).
   * stationary: its spots never move, so a session runs until the player stops it.
   * firstRoll: ticks from the start line to the first roll, when it isn't the interval.
   * animation plays with the start line; loopAnimation (the same unless given) on every roll, or
   * every few ticks without animateOnRoll; catchAnimation, when given, plays on a successful roll.
   * startMessage, missMessage: what a cast and a missed attempt say, when they say anything.
   * followMessage: a second start line, a tick after the first.
   * noToolStatement, noBaitStatement: the message boxes shown without the tool or the bait.
   * noToolMessage: the chat line shown without the tool, where it is one instead of a box.
   * table: a spot that lands one item off a drop table a catch, not its fish charts: { rolls, preRoll,
   * weighted, tertiary } (see rollTable). `fish` then lists every item on it.
   * levelStatement: the message box (given the level) shown below the tool's level.
   */
  constructor({
    id, level, animation, loopAnimation = animation, catchAnimation = null, fish, variants, bait = [], worn = [], quest = null, multi = false,
    requires = [], interval = FISHING_ACTION_INTERVAL_TICKS, firstRoll = null, animateOnRoll = true, unboostable = false, spot = null,
    vessel = null, stationary = false, startMessage = "You begin to fish..", followMessage = null, missMessage = null,
    noToolStatement = null, noBaitStatement = null, noToolMessage = null, levelStatement = null, table = null, barehand = false,
  }) {
    this.id = id;
    this.level = level;
    this.animationId = animation;
    this.loopAnimationId = loopAnimation;
    this.catchAnimationId = catchAnimation;
    this.fish = fish;
    this.variants = variants ?? [{ ids: [id], level: 1, bonus: 100 }];
    this.bait = bait;
    this.worn = worn;
    this.quest = quest;
    this.multi = multi;
    this.requires = requires;
    this.interval = interval;
    this.firstRoll = firstRoll;
    this.animateOnRoll = animateOnRoll;
    this.unboostable = unboostable;
    this.spot = spot;
    this.vessel = vessel;
    this.stationary = stationary;
    this.startMessage = startMessage;
    this.followMessage = followMessage;
    this.missMessage = missMessage;
    this.noToolStatement = noToolStatement;
    this.noToolMessage = noToolMessage;
    this.table = table;
    this.noBaitStatement = noBaitStatement;
    this.levelStatement = levelStatement;
    this.barehand = barehand;
  }
}

/** Wiki (Game tick/Action lengths): a pike roll takes 6 ticks one time in 5, else 5. */
function pikeInterval(random = Math.random) {
  return random() < 0.2 ? NET_CAGE_HARPOON_INTERVAL_TICKS : FISHING_ACTION_INTERVAL_TICKS;
}

function rollInterval(tool) {
  return typeof tool.interval === "function" ? tool.interval() : tool.interval;
}

// Wiki: dragon-tier harpoons catch 20% more and a charged crystal harpoon 35% more
// (bonus is a percentage of the chart's low/high). The inactive crystal harpoon works as
// a dragon harpoon, and a barb-tail is a plain harpoon you can wield.
const HARPOONS = Object.freeze([
  // The league's Echo harpoon (Wiki): a crystal harpoon with no requirement and no charges.
  { ids: [ItemIds.ECHO_HARPOON], level: 1, bonus: 135 },
  // Charged crystal harpoons consume one charge per fish (./fishing/CrystalHarpoon.Fishing.js).
  { ids: [ItemIds.CRYSTAL_HARPOON, ItemIds.CRYSTAL_HARPOON_3], level: 71, bonus: 135, crystal: true },
  // Charged infernal harpoons can cook what they catch (./fishing/InfernalHarpoon.Fishing.js).
  {
    ids: [ItemIds.INFERNAL_HARPOON, ItemIds.INFERNAL_HARPOON_OR_, ItemIds.INFERNAL_HARPOON_OR__3],
    level: 75,
    bonus: 120,
    infernal: true,
  },
  {
    ids: [
      ItemIds.INFERNAL_HARPOON_UNCHARGED_, ItemIds.INFERNAL_HARPOON_UNCHARGED__2, ItemIds.INFERNAL_HARPOON_UNCHARGED__4,
    ],
    level: 75,
    bonus: 120,
  },
  { ids: [ItemIds.CRYSTAL_HARPOON_INACTIVE_], level: 71, bonus: 120 },
  { ids: [ItemIds.DRAGON_HARPOON, ItemIds.DRAGON_HARPOON_OR_, ItemIds.DRAGON_HARPOON_OR__3], level: 61, bonus: 120 },
  { ids: [ItemIds.HARPOON, ItemIds.BARB_TAIL_HARPOON], level: 1, bonus: 100 },
]);

// Pearl rods fish exactly as their plain versions.
const rod = (...ids) => [{ ids, level: 1, bonus: 100 }];
const FISHING_RODS = rod(ItemIds.FISHING_ROD, ItemIds.PEARL_FISHING_ROD);
const FLY_FISHING_RODS = rod(ItemIds.FLY_FISHING_ROD, ItemIds.PEARL_FLY_FISHING_ROD);
const OILY_FISHING_RODS = rod(ItemIds.OILY_FISHING_ROD, ItemIds.OILY_PEARL_FISHING_ROD);
const BARBARIAN_RODS = rod(ItemIds.BARBARIAN_ROD, ItemIds.PEARL_BARBARIAN_ROD);

const barbarian = (strengthAndAgility, xp) => ({
  requires: [[Skill.STRENGTH, strengthAndAgility], [Skill.AGILITY, strengthAndAgility]],
  extraXp: [[Skill.STRENGTH, xp], [Skill.AGILITY, xp]],
});

/** An item the park pond lands: level 1, 7.5 XP, "You find <what>." */
const parkFind = (caught) => ({ level: 1, rolls: [], xp: 7.5, caught, message: () => `You find ${caught}.`, junk: true });

// Levels, XP and charts: each fish's Wiki page. Pet bases: Wiki "Heron".
const FISH = Object.freeze({
  SHRIMP: new Fish({ id: ItemIds.RAW_SHRIMPS, level: 1, rolls: [[48, 256]], xp: 10, caught: "some raw shrimps", petBase: 870330 }),
  ANCHOVY: new Fish({ id: ItemIds.RAW_ANCHOVIES, level: 15, rolls: [[24, 128]], xp: 40, caught: "some raw anchovies", petBase: 870330 }),
  SARDINE: new Fish({ id: ItemIds.RAW_SARDINE, level: 5, rolls: [[32, 192]], xp: 20, caught: "a raw sardine", petBase: 1056000 }),
  HERRING: new Fish({ id: ItemIds.RAW_HERRING, level: 10, rolls: [[24, 128]], xp: 30, caught: "a raw herring", petBase: 1056000 }),
  // rsprox captures (8 recordings): the fly rod's catch lines have no full stop.
  TROUT: new Fish({ id: ItemIds.RAW_TROUT, level: 20, rolls: [[32, 192]], xp: 50, caught: "a raw trout", petBase: 923616, message: () => "You catch a raw trout" }),
  PIKE: new Fish({ id: ItemIds.RAW_PIKE, level: 25, rolls: [[16, 96]], xp: 60, caught: "a pike", petBase: 305792 }),
  SALMON: new Fish({ id: ItemIds.RAW_SALMON, level: 30, rolls: [[16, 96]], xp: 70, caught: "a raw salmon", petBase: 923616, message: () => "You catch a raw salmon" }),
  TUNA: new Fish({ id: ItemIds.RAW_TUNA, level: 35, rolls: [[8, 64]], xp: 80, caught: "a raw tuna", petBase: 257770 }),
  LOBSTER: new Fish({ id: ItemIds.RAW_LOBSTER, level: 40, rolls: [[6, 95]], xp: 90, caught: "a lobster", petBase: 116129 }),
  SWORDFISH: new Fish({ id: ItemIds.RAW_SWORDFISH, level: 50, rolls: [[4, 48]], xp: 100, caught: "a raw swordfish", petBase: 257770 }),
  SHARK: new Fish({
    id: ItemIds.RAW_SHARK, level: 76, rolls: [[3, 40]], xp: 110, caught: "a shark", petBase: 82243, message: () => "You catch a shark!",
  }),
  // Wiki (Barbarian Training#Barehanded fishing): barehand shark gives 11 Strength XP too.
  SHARK_BAREHAND: new Fish({
    id: ItemIds.RAW_SHARK, level: 76, rolls: [[3, 40]], xp: 110, caught: "a shark", petBase: 82243,
    message: () => "You catch a shark!", extraXp: [[Skill.STRENGTH, 11]],
  }),

  // Big net: charts from the Wiki (Fishing spot (big net, harpoon)); lines from rsprox captures
  // 1102 and 1718, whose XP drops give 1 for boots, gloves and seaweed and 10 for oysters and caskets.
  LEATHER_BOOTS: new Fish({ id: ItemIds.LEATHER_BOOTS, level: 16, rolls: [[10, 10]], xp: 1, caught: "some boots", junk: true }),
  SEAWEED: new Fish({ id: ItemIds.SEAWEED, level: 16, rolls: [[10, 10]], xp: 1, caught: "some seaweed", junk: true }),
  LEATHER_GLOVES: new Fish({ id: ItemIds.LEATHER_GLOVES, level: 16, rolls: [[5, 5]], xp: 1, caught: "some gloves", junk: true }),
  OYSTER: new Fish({ id: ItemIds.OYSTER, level: 16, rolls: [[3, 7]], xp: 10, caught: "an oyster shell", junk: true }),
  CASKET: new Fish({ id: ItemIds.CASKET, level: 16, rolls: [[1, 2]], xp: 10, caught: "a casket", junk: true }),
  MACKEREL: new Fish({ id: ItemIds.RAW_MACKEREL, level: 16, rolls: [[5, 65], [10, 10]], xp: 20, caught: "a raw mackerel", petBase: 1147827 }),
  COD: new Fish({ id: ItemIds.RAW_COD, level: 23, rolls: [[4, 55]], xp: 45, caught: "a raw cod", petBase: 1147827 }),
  BASS: new Fish({ id: ItemIds.RAW_BASS, level: 46, rolls: [[3, 40]], xp: 100, caught: "a raw bass", petBase: 1147827 }),
  MONKFISH: new Fish({ id: ItemIds.RAW_MONKFISH, level: 62, rolls: [[48, 90]], xp: 120, caught: "a raw monkfish", petBase: 138583 }),

  FROG_SPAWN: new Fish({ id: ItemIds.FROG_SPAWN, level: 33, rolls: [[16, 96]], xp: 75, caught: "some frog spawn" }),
  CAVE_EEL: new Fish({ id: ItemIds.RAW_CAVE_EEL, level: 38, rolls: [[10, 80]], xp: 80, caught: "a raw cave eel", petBase: 257770 }),
  // Slimy eels give 80 XP in the caves and 65 in Mort Myre (Wiki: Raw slimy eel).
  SLIMY_EEL: new Fish({ id: ItemIds.RAW_SLIMY_EEL, level: 28, rolls: [[10, 80]], xp: 80, caught: "a raw slimy eel" }),
  SWAMP_SLIMY_EEL: new Fish({ id: ItemIds.RAW_SLIMY_EEL, level: 28, rolls: [[10, 80]], xp: 65, caught: "a raw slimy eel" }),
  LAVA_EEL: new Fish({ id: ItemIds.RAW_LAVA_EEL, level: 53, rolls: [[16, 96]], xp: 60, caught: "a raw lava eel" }),
  INFERNAL_EEL: new Fish({ id: ItemIds.INFERNAL_EEL, level: 80, rolls: [[30, 93]], xp: 95, caught: "an infernal eel", petBase: 165000,
    message: () => "You catch an infernal eel. It hardens as you handle it with your ice gloves.",
  }),
  SACRED_EEL: new Fish({ id: ItemIds.SACRED_EEL, level: 87, rolls: [[0, 60]], xp: 105, caught: "a sacred eel", petBase: 99000 }),
  ANGLERFISH: new Fish({ id: ItemIds.RAW_ANGLERFISH, level: 82, rolls: [[3, 36]], xp: 120, caught: "a raw anglerfish", petBase: 78649 }),
  DARK_CRAB: new Fish({ id: ItemIds.RAW_DARK_CRAB, level: 85, rolls: [[3, 40]], xp: 130, caught: "a raw dark crab", petBase: 149434 }),
  // Wiki (Raw karambwanji): floor(level / 5) + 1 a catch, 5 XP and one pet roll per catch.
  KARAMBWANJI: new Fish({
    id: ItemIds.RAW_KARAMBWANJI, level: 5, rolls: [[100, 250]], xp: 5, caught: "some Karambwanji", petBase: 443697,
    amount: (player) => Math.floor(getFishingLevel(player) / 5) + 1,
    message: (amount) => `You catch ${amount} Karambwanji.`,
  }),
  KARAMBWAN: new Fish({
    id: ItemIds.RAW_KARAMBWAN, level: 65, rolls: [[5, 160]], xp: 50, caught: "a Karambwan", petBase: 170874,
    message: () => "You catch a Karambwan!",
  }),

  MINNOW: new Fish({
    id: ItemIds.MINNOW, level: 82, rolls: [MinnowPlatform.CATCH_CHART], xp: 26.1, caught: "some minnows", petBase: 977778,
    amount: MinnowPlatform.minnowsPerCatch,
  }),

  // Civitas illa Fortis's park pond (Wiki: Fishing spot (Civitas illa Fortis)): 7.5 XP a catch,
  // whatever it lands, and nothing is a fish. Lines: rsprox capture 237/01098 for the glass, the
  // casket, the net and the keys; the rest follow them (the Wiki gives none).
  PARK_BROKEN_GLASS: new Fish({ id: ItemIds.BROKEN_GLASS_2, ...parkFind("some broken glass") }),
  PARK_OLD_BOOT: new Fish({ id: ItemIds.OLD_BOOT, ...parkFind("an old boot") }),
  PARK_BIG_FISHING_NET: new Fish({ id: ItemIds.BIG_FISHING_NET, ...parkFind("a big fishing net") }),
  PARK_CASKET: new Fish({ id: ItemIds.CASKET, ...parkFind("a casket") }),
  PARK_HOUSE_KEYS: new Fish({ id: ItemIds.HOUSE_KEYS, ...parkFind("some house keys") }),
  PARK_JADE: new Fish({ id: ItemIds.JADE, ...parkFind("a jade") }),
  PARK_RED_TOPAZ: new Fish({ id: ItemIds.RED_TOPAZ, ...parkFind("a red topaz") }),
  // The moon key's loop half: a tertiary, on top of the catch and its experience.
  PARK_LOOP_HALF: new Fish({ id: ItemIds.LOOP_HALF_OF_KEY_4, ...parkFind("a loop half of a key"), xp: 0 }),

  LEAPING_TROUT: new Fish({ id: ItemIds.LEAPING_TROUT, level: 48, rolls: [[32, 192]], xp: 50, caught: "a leaping trout", petBase: 1280862, ...barbarian(15, 5) }),
  LEAPING_SALMON: new Fish({ id: ItemIds.LEAPING_SALMON, level: 58, rolls: [[16, 96]], xp: 70, caught: "a leaping salmon", petBase: 1280862, ...barbarian(30, 6) }),
  LEAPING_STURGEON: new Fish({ id: ItemIds.LEAPING_STURGEON, level: 70, rolls: [[8, 64]], xp: 80, caught: "a leaping sturgeon", petBase: 1280862, ...barbarian(45, 7) }),
});

// Tools of one kind share their start line, first-roll delay and refusals, so the spots without
// captures (dark crabs, monkfish, eels, anglerfish) follow the ones recorded.
const NET = { firstRoll: NET_CAGE_FIRST_ROLL_TICKS, startMessage: CAST_NET };
const CAGE = { firstRoll: NET_CAGE_FIRST_ROLL_TICKS };
const HARPOON = { firstRoll: HARPOON_ROD_FIRST_ROLL_TICKS, startMessage: START_HARPOON, levelStatement: harpoonLevel };
const ROD = { animation: ANIM.ROD, loopAnimation: ANIM.ROD_ON_SPOT, firstRoll: HARPOON_ROD_FIRST_ROLL_TICKS };
const BAIT_ROD = { ...ROD, startMessage: CAST_LINE, noBaitStatement: NO_FISHING_BAIT, levelStatement: baitLevel };

const TOOLS = Object.freeze({
  NET: new FishingTool({
    id: ItemIds.SMALL_FISHING_NET, level: 1, animation: ANIM.NET, fish: [FISH.ANCHOVY, FISH.SHRIMP],
    interval: NET_CAGE_HARPOON_INTERVAL_TICKS, ...NET,
  }),
  // Sea bait says its two lines a tick apart, casting again with the second (rsprox captures 75, 1098, 1710).
  FISHING_ROD: new FishingTool({
    id: ItemIds.FISHING_ROD, level: 5, fish: [FISH.HERRING, FISH.SARDINE],
    variants: FISHING_RODS, bait: [ItemIds.FISHING_BAIT], ...BAIT_ROD, followMessage: "You attempt to catch a fish.",
  }),
  PIKE_ROD: new FishingTool({
    id: ItemIds.FISHING_ROD, level: 25, fish: [FISH.PIKE],
    variants: FISHING_RODS, bait: [ItemIds.FISHING_BAIT], interval: () => pikeInterval(), ...BAIT_ROD,
    startMessage: CAST_AND_ATTEMPT,
  }),
  FLY_FISHING_ROD: new FishingTool({
    id: ItemIds.FLY_FISHING_ROD, level: 20, fish: [FISH.SALMON, FISH.TROUT],
    variants: FLY_FISHING_RODS, bait: [ItemIds.FEATHER], ...ROD, startMessage: CAST_AND_ATTEMPT, noBaitStatement: NO_FEATHERS,
  }),
  HARPOON: new FishingTool({
    id: ItemIds.HARPOON, level: 35, animation: ANIM.HARPOON, fish: [FISH.SWORDFISH, FISH.TUNA], variants: HARPOONS,
    interval: NET_CAGE_HARPOON_INTERVAL_TICKS, ...HARPOON,
  }),
  SHARK_HARPOON: new FishingTool({
    id: ItemIds.HARPOON, level: 76, animation: ANIM.HARPOON, fish: [FISH.SHARK], variants: HARPOONS,
    interval: NET_CAGE_HARPOON_INTERVAL_TICKS, ...HARPOON,
  }),
  // Wiki (Barbarian Training#Barehanded fishing): barehand shark needs 96 Fishing and 76
  // Strength, 110 Fishing XP and 11 Strength XP. Cache revision 241 sequences 6703 (start),
  // 6704 (ready loop) and 6706 (shark finish; 6705 is frame-identical); the empty ids variant
  // means "no tool, bare hands". Wiki: barehand speed and catch rate equal a harpoon's.
  BAREHAND_SHARK: new FishingTool({
    id: ItemIds.HARPOON, level: 96, animation: 6703, loopAnimation: 6704, catchAnimation: 6706, fish: [FISH.SHARK_BAREHAND],
    variants: [{ ids: [], level: 96, bonus: 100, barehand: true }], requires: [[Skill.STRENGTH, 76]],
    interval: NET_CAGE_HARPOON_INTERVAL_TICKS, firstRoll: HARPOON_ROD_FIRST_ROLL_TICKS, barehand: true,
    startMessage: START_HARPOON, levelStatement: (level) => `You need to be at least level ${level} Fishing to catch sharks with your bare hands.`,
  }),
  LOBSTER_POT: new FishingTool({
    id: ItemIds.LOBSTER_POT, level: 40, animation: ANIM.CAGE, fish: [FISH.LOBSTER], interval: NET_CAGE_HARPOON_INTERVAL_TICKS,
    ...CAGE, startMessage: "You attempt to catch a lobster.",
  }),

  // Every roll stands on its own, in Mod Ash's order (Wiki: Fishing spot (big net, harpoon)), with
  // the junk first as the capture's lines are.
  BIG_NET: new FishingTool({
    id: ItemIds.BIG_FISHING_NET, level: 16, animation: ANIM.BIG_NET,
    fish: [FISH.LEATHER_BOOTS, FISH.SEAWEED, FISH.LEATHER_GLOVES, FISH.OYSTER, FISH.CASKET, FISH.MACKEREL, FISH.COD, FISH.BASS],
    multi: true, interval: NET_CAGE_HARPOON_INTERVAL_TICKS, ...NET,
  }),
  MONKFISH_NET: new FishingTool({
    id: ItemIds.SMALL_FISHING_NET, level: 62, animation: ANIM.NET, fish: [FISH.MONKFISH], quest: "Swan Song", ...NET,
  }),
  FROG_SPAWN_NET: new FishingTool({ id: ItemIds.SMALL_FISHING_NET, level: 33, animation: ANIM.NET, fish: [FISH.FROG_SPAWN], ...NET }),
  CAVE_EEL_ROD: new FishingTool({
    id: ItemIds.FISHING_ROD, level: 28, fish: [FISH.CAVE_EEL, FISH.SLIMY_EEL],
    variants: FISHING_RODS, bait: [ItemIds.FISHING_BAIT], ...BAIT_ROD,
  }),
  SWAMP_EEL_ROD: new FishingTool({
    id: ItemIds.FISHING_ROD, level: 28, fish: [FISH.SWAMP_SLIMY_EEL],
    variants: FISHING_RODS, bait: [ItemIds.FISHING_BAIT], ...BAIT_ROD,
  }),
  LAVA_EEL_ROD: new FishingTool({
    id: ItemIds.OILY_FISHING_ROD, level: 53, fish: [FISH.LAVA_EEL],
    variants: OILY_FISHING_RODS, bait: [ItemIds.FISHING_BAIT], ...BAIT_ROD,
  }),
  // rsprox capture 543 only shows the cast animation here, repeated.
  INFERNAL_EEL_ROD: new FishingTool({
    id: ItemIds.OILY_FISHING_ROD, level: 80, fish: [FISH.INFERNAL_EEL],
    variants: OILY_FISHING_RODS, bait: [ItemIds.FISHING_BAIT], worn: [ItemIds.ICE_GLOVES, ItemIds.SMITHS_GLOVES_I_],
    ...BAIT_ROD, loopAnimation: ANIM.ROD,
  }),
  SACRED_EEL_ROD: new FishingTool({
    id: ItemIds.FISHING_ROD, level: 87, fish: [FISH.SACRED_EEL],
    variants: FISHING_RODS, bait: [ItemIds.FISHING_BAIT], ...BAIT_ROD,
  }),
  ANGLERFISH_ROD: new FishingTool({
    id: ItemIds.FISHING_ROD, level: 82, fish: [FISH.ANGLERFISH],
    variants: FISHING_RODS, bait: [ItemIds.SANDWORMS], ...BAIT_ROD, noBaitStatement: null,
  }),
  DARK_CRAB_POT: new FishingTool({
    id: ItemIds.LOBSTER_POT, level: 85, animation: ANIM.CAGE, fish: [FISH.DARK_CRAB], bait: [ItemIds.DARK_FISHING_BAIT], ...CAGE,
  }),
  // Wiki (Minnow): 82 Fishing that boosts can't reach, though boosts still speed up the catch.
  MINNOW_NET: new FishingTool({
    id: ItemIds.SMALL_FISHING_NET, level: 82, animation: ANIM.NET, fish: [FISH.MINNOW], unboostable: true,
    // Its 2-tick rolls are too often to restart the net animation on each.
    interval: MinnowPlatform.ATTEMPT_INTERVAL_TICKS, spot: MinnowPlatform, startMessage: CAST_NET, animateOnRoll: false,
  }),
  BARBARIAN_ROD: new FishingTool({
    id: ItemIds.BARBARIAN_ROD, level: 48, ...ROD, animation: ANIM.BARBARIAN_ROD, loopAnimation: ANIM.BARBARIAN_ROD_ON_SPOT,
    fish: [FISH.LEAPING_STURGEON, FISH.LEAPING_SALMON, FISH.LEAPING_TROUT], variants: BARBARIAN_RODS,
    // Wiki: Barbarian rod. Any of these baits the rod.
    bait: [ItemIds.FISHING_BAIT, ItemIds.FEATHER, ItemIds.FISH_OFFCUTS, ItemIds.ROE, ItemIds.CAVIAR],
    quest: "Barbarian Training", requires: FISH.LEAPING_TROUT.requires,
    startMessage: CAST_AND_ATTEMPT, noBaitStatement: NO_BARBARIAN_BAIT,
  }),
  // Holy Lake: karambwanji first, else shrimps (Wiki: Fishing spot (karambwanji); captures 75 and
  // 1102 for the messages).
  KARAMBWANJI_NET: new FishingTool({
    id: ItemIds.SMALL_FISHING_NET, level: 5, animation: ANIM.NET, fish: [FISH.KARAMBWANJI, FISH.SHRIMP],
    interval: NET_CAGE_HARPOON_INTERVAL_TICKS, ...NET,
  }),
  // Civitas illa Fortis's park pond (Wiki: Fishing spot (Civitas illa Fortis)): level 1, never moves,
  // one item off its table a catch. rsprox capture 237/01098 (7 casts): human_largenet every tick
  // and the catches 4 to 10 ticks apart, so a roll a tick; the wrong net is a chat line. The Wiki
  // gives no catch rate: 21/256 a tick is the recording's (6 catches in about 66 ticks).
  PARK_NET: new FishingTool({
    id: ItemIds.BIG_FISHING_NET, level: 1, animation: ANIM.BIG_NET, stationary: true, interval: 1, firstRoll: 1,
    fish: [FISH.PARK_BROKEN_GLASS, FISH.PARK_OLD_BOOT, FISH.PARK_BIG_FISHING_NET, FISH.PARK_CASKET, FISH.PARK_HOUSE_KEYS,
      FISH.PARK_JADE, FISH.PARK_RED_TOPAZ, FISH.PARK_LOOP_HALF],
    table: {
      rolls: [[20, 20]],
      preRoll: [[FISH.PARK_JADE, 1 / 100], [FISH.PARK_RED_TOPAZ, 1 / 505]],
      weighted: [[FISH.PARK_BROKEN_GLASS, 3], [FISH.PARK_OLD_BOOT, 2], [FISH.PARK_BIG_FISHING_NET, 2], [FISH.PARK_CASKET, 2], [FISH.PARK_HOUSE_KEYS, 1]],
      tertiary: [[FISH.PARK_LOOP_HALF, 1 / 1014]],
    },
    startMessage: CAST_NET,
    noToolMessage: "This is the wrong size net for fishing here.",
  }),
  // Wiki (Fishing): the spots never move. Captures 75, 83, 96, 792 and 1779 for the messages.
  KARAMBWAN_VESSEL: new FishingTool({
    id: ItemIds.KARAMBWAN_VESSEL, level: 65, animation: ANIM.VESSEL, fish: [FISH.KARAMBWAN],
    variants: [{ ids: [ItemIds.KARAMBWAN_VESSEL_3, ItemIds.KARAMBWAN_VESSEL], level: 1, bonus: 100 }],
    interval: KARAMBWAN_INTERVAL_TICKS, vessel: KarambwanVessel, stationary: true,
    startMessage: "You lower the Karambwan vessel.",
    missMessage: "A Karambwan deftly snatches the Karambwanji from your vessel!",
    noToolStatement: "You need a Karambwan vessel to fish here.",
  }),
});

// A spot fishes by its full option list in the cache, so every id with the same options
// (e.g. all ~30 "Cage/Harpoon" spots) behaves alike. "Bait" means sea fish on a
// "Small Net/Bait" spot but pike on a river "Lure/Bait" spot.
const SPOT_TOOLS_BY_OPTIONS = new Map([
  ["Small Net/Bait", { "Small Net": TOOLS.NET, Bait: TOOLS.FISHING_ROD }],
  ["Lure/Bait", { Lure: TOOLS.FLY_FISHING_ROD, Bait: TOOLS.PIKE_ROD }],
  ["Cage/Harpoon", { Cage: TOOLS.LOBSTER_POT, Harpoon: TOOLS.HARPOON }],
  ["Big Net/Harpoon", { "Big Net": TOOLS.BIG_NET, Harpoon: TOOLS.SHARK_HARPOON }],
  // Older spots label the big net "Net" (Wiki: Fishing spot (big net, harpoon)).
  ["Net/Harpoon", { Net: TOOLS.BIG_NET, Harpoon: TOOLS.SHARK_HARPOON }],
  ["Use-rod", { "Use-rod": TOOLS.BARBARIAN_ROD }],
  // Only the Wilderness dark crab spots offer a lone "Cage" (Wiki: Fishing spot (dark crab)).
  ["Cage", { Cage: TOOLS.DARK_CRAB_POT }],
]);

const FROG_SPAWN_AND_EELS = { "Small Net": TOOLS.FROG_SPAWN_NET, Net: TOOLS.FROG_SPAWN_NET, Bait: TOOLS.CAVE_EEL_ROD };

// Option lists that mean different fish at different spots, so they go by id. Spot types are
// the Wiki's "Fishing spot (...)" pages, which list each type's ids.
const SPOT_TOOLS_BY_NPC = new Map([
  // Tutorial Island's shrimp pond only offers "Net".
  [NpcIds.FISHING_SPOT_43, { Net: TOOLS.NET }],
  // Lumbridge Swamp's small net/bait spot labels its net "Net".
  [NpcIds.FISHING_SPOT_30, { Net: TOOLS.NET, Bait: TOOLS.FISHING_ROD }],
  // Piscatoris: small net for monkfish, harpoon for tuna/swordfish.
  [NpcIds.FISHING_SPOT_55, { Net: TOOLS.MONKFISH_NET, Harpoon: TOOLS.HARPOON }],
  // Frog spawn and eels, underground around Lumbridge and Dorgesh-Kaan.
  [NpcIds.FISHING_SPOT_2, FROG_SPAWN_AND_EELS],
  [NpcIds.FISHING_SPOT_3, FROG_SPAWN_AND_EELS],
  [NpcIds.FISHING_SPOT_4, FROG_SPAWN_AND_EELS],
  [NpcIds.FISHING_SPOT_5, FROG_SPAWN_AND_EELS],
  [NpcIds.FISHING_SPOT_92, FROG_SPAWN_AND_EELS],
  // Mort Myre swamp.
  [NpcIds.FISHING_SPOT_40, { Bait: TOOLS.SWAMP_EEL_ROD }],
  [NpcIds.FISHING_SPOT_41, { Bait: TOOLS.SWAMP_EEL_ROD }],
  [NpcIds.FISHING_SPOT_42, { Bait: TOOLS.SWAMP_EEL_ROD }],
  // Lava eels: Taverley Dungeon, Lava Maze and the rest.
  [NpcIds.FISHING_SPOT_63, { Bait: TOOLS.LAVA_EEL_ROD }],
  [NpcIds.FISHING_SPOT_6, { Bait: TOOLS.LAVA_EEL_ROD }],
  [NpcIds.FISHING_SPOT_130, { Bait: TOOLS.LAVA_EEL_ROD }],
  // Zul-Andra.
  [NpcIds.FISHING_SPOT_68, { Bait: TOOLS.SACRED_EEL_ROD }],
  // Port Piscarilius.
  [NpcIds.ROD_FISHING_SPOT_16, { Bait: TOOLS.ANGLERFISH_ROD }],
  // Mor Ul Rek.
  [NpcIds.ROD_FISHING_SPOT_20, { Bait: TOOLS.INFERNAL_EEL_ROD }],
  // Kylie Minnow's platform at the Fishing Guild.
  [NpcIds.FISHING_SPOT_87, { "Small Net": TOOLS.MINNOW_NET }],
  [NpcIds.FISHING_SPOT_88, { "Small Net": TOOLS.MINNOW_NET }],
  [NpcIds.FISHING_SPOT_89, { "Small Net": TOOLS.MINNOW_NET }],
  [NpcIds.FISHING_SPOT_90, { "Small Net": TOOLS.MINNOW_NET }],
  // Karamja: karambwanji in the Holy Lake, karambwan north of the shipyard and by Lubufu.
  [NpcIds.FISHING_SPOT_58, { Net: TOOLS.KARAMBWANJI_NET }],
  [NpcIds.FISHING_SPOT_60, { Fish: TOOLS.KARAMBWAN_VESSEL }],
  [NpcIds.FISHING_SPOT_61, { Fish: TOOLS.KARAMBWAN_VESSEL }],
  [NpcIds.FISHING_SPOT_62, { Fish: TOOLS.KARAMBWAN_VESSEL }],
  // Civitas illa Fortis's park pond (civitas_park_fishingspot_hmm), its lone "Cast".
  [NpcIds.FISHING_SPOT_101, { Cast: TOOLS.PARK_NET }],
]);

// Clue bottle bases are the documented heron bases for these catches. Other catches with no
// sourced base remain unsupported here; this is not a claim that they cannot yield bottles.
const CLUE_BOTTLE_FISH = new Set([
  FISH.SHRIMP, FISH.ANCHOVY, FISH.SARDINE, FISH.HERRING, FISH.TROUT, FISH.SALMON,
  FISH.PIKE, FISH.TUNA, FISH.LOBSTER, FISH.SWORDFISH, FISH.SHARK, FISH.SHARK_BAREHAND,
  FISH.MACKEREL, FISH.COD, FISH.BASS, FISH.MONKFISH, FISH.CAVE_EEL, FISH.INFERNAL_EEL,
  FISH.SACRED_EEL, FISH.ANGLERFISH, FISH.DARK_CRAB, FISH.KARAMBWANJI, FISH.KARAMBWAN,
  FISH.MINNOW, FISH.LEAPING_TROUT, FISH.LEAPING_SALMON, FISH.LEAPING_STURGEON,
]);
const PARK_CLUE_BASE = 152120; // Wiki: Fortis park uses the catfish base.

const FISHING_SPOT_NAMES = ["Fishing spot", "Rod Fishing spot"];
const FISHING_SPOT_OPTIONS = ["Small Net", "Net", "Big Net", "Bait", "Lure", "Cage", "Harpoon", "Use-rod", "Fish", "Cast"];

const TOOL_NAMES = new Map(Object.entries(TOOLS).map(([name, tool]) => [tool, name]));

/** The tools a spot fishes with, by option: [{ clickType, tool: "LOBSTER_POT" }] (bots index spots by tool). */
function spotTools(npcId, definition) {
  const actions = definition?.getActions?.() ?? [];
  const found = [];
  for (let clickType = 1; clickType <= actions.length; clickType++) {
    const tool = getSpotTool(npcId, definition, clickType);
    if (tool) found.push({ clickType, tool: TOOL_NAMES.get(tool) });
  }
  return found;
}

function getSpotTool(npcId, definition, clickType, player = null) {
  const actions = definition?.getActions?.() ?? [];
  const option = actions[clickType - 1];
  const tools = SPOT_TOOLS_BY_NPC.get(npcId) ??
    SPOT_TOOLS_BY_OPTIONS.get(actions.filter(Boolean).join("/"));
  const tool = option ? tools?.[option] : undefined;
  // No harpoon carried or wielded: the harpoon option falls back to Barbarian barehanding.
  if (tool === TOOLS.SHARK_HARPOON && player && !hasHarpoon(player)) return TOOLS.BAREHAND_SHARK;
  return tool;
}

function hasHarpoon(player) {
  const has = (id) => player.getInventory().contains(id) || player.getEquipment?.()?.contains(id);
  return HARPOONS.some((variant) => variant.ids.some(has));
}

function getFishingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.FISHING);
}

/**
 * The level catch rolls use. Wiki (Fishing Guild, citing Mod Ash): a visible level above
 * 99 counts as 99, and the guild adds an invisible +7 on top that never unlocks a fish.
 */
function catchLevel(player) {
  return Math.min(99, getFishingLevel(player)) + Guild.invisibleBoost(player);
}

function meetsLevels(player, requires) {
  return requires.every(([skill, level]) => player.getSkillManager().getCurrentLevel(skill) >= level);
}

// A quest gates its fish only once this server implements it, so an unwritten quest
// does not lock its fishing away for good.
function questAllows(player, name) {
  const quest = QuestRuntime.getRegisteredQuests().find((registered) => registered.name === name);
  return !quest || quest.isComplete(player);
}

/** The best variant of the tool the player can use, carried or wielded; null if none. */
function findTool(player, tool) {
  const level = getFishingLevel(player);
  const has = (id) => player.getInventory().contains(id) || player.getEquipment?.()?.contains(id);
  const found = tool.variants.find((variant) => variant.level <= level && (variant.ids.length === 0 || variant.ids.some(has))) ?? null;
  if (found) return found;
  // Content may stand in for the tool ("fishing:tool", a league relic's harpoon that fishes as any of them).
  const request = { player, variants: tool.variants, variant: null };
  pluginApi?.emitCustomEvent("fishing:tool", request);
  return request.variant;
}

/** Ticks to the next catch roll: the tool's, as content adjusts it ("fishing:interval", a league relic's faster harpoon). */
function catchInterval(player, tool) {
  const request = { player, ticks: rollInterval(tool) };
  pluginApi?.emitCustomEvent("fishing:interval", request);
  return Math.max(1, request.ticks | 0);
}

/** The best fish the player can land with this tool (the tool lists them highest first); a table's roll on it. */
function bestCatch(player, tool) {
  if (tool.table) return rollTable(tool.table);
  const fish = tool.fish.find((candidate) => !candidate.junk && getFishingLevel(player) >= candidate.level && meetsLevels(player, candidate.requires));
  return fish ? [fish] : [];
}

/** Bait in the inventory first, then in a carried container (the tackle box, "storage:amount"). */
function findBait(player, tool) {
  return tool.bait.find((id) => player.getInventory().contains(id)) ??
    tool.bait.find((id) => storedAmount(player, id) > 0);
}

function storedAmount(player, itemId) {
  const request = { player, itemId, amount: 0 };
  pluginApi?.emitCustomEvent("storage:amount", request);
  return request.amount;
}

function useBait(player, bait) {
  if (player.getInventory().contains(bait)) {
    player.getInventory().deleteNumber(bait, 1);
    return;
  }
  pluginApi?.emitCustomEvent("storage:take", { player, itemId: bait, amount: 1, taken: 0 });
}

/** Whether an open container (the fish barrel, "storage:room") would take this fish. */
function storageRoom(player, itemId) {
  // `skill`: the skill gathering it, so content storing one skill's resources answers only for those.
  const request = { player, itemId, skill: pluginApi?.core?.Skill?.FISHING, room: false };
  pluginApi?.emitCustomEvent("storage:room", request);
  return request.room;
}

/** An open container takes the catch first ("storage:gather"); the rest goes to the inventory. */
function giveCatch(player, itemId, amount, xp = 0) {
  const request = { player, itemId, amount, stored: 0, skill: Skill.FISHING, xp };
  pluginApi?.emitCustomEvent("storage:gather", request);
  if (amount > request.stored) {
    player.getInventory().addItem(new Item(itemId, amount - request.stored));
  }
}

/** Messages and returns null when the player can't fish with this tool, else the variant. */
function hasToolRequirements(player, tool) {
  const level = tool.unboostable ? player.getSkillManager().getMaxLevel(Skill.FISHING) : getFishingLevel(player);
  if (level < tool.level) {
    if (tool.levelStatement) statement(player, tool.levelStatement(tool.level));
    else player.sendMessage(`You need a Fishing level of at least ${tool.level} to do this.`);
    return null;
  }

  for (const [skill, needed] of tool.requires) {
    if (player.getSkillManager().getCurrentLevel(skill) < needed) {
      player.sendMessage(`You need a ${skill.getName()} level of at least ${needed} to do this.`);
      return null;
    }
  }

  if (tool.quest && !questAllows(player, tool.quest)) {
    player.sendMessage(`You need to complete ${tool.quest} to fish here.`);
    return null;
  }

  const variant = findTool(player, tool);
  if (!variant) {
    if (tool.noToolStatement) statement(player, tool.noToolStatement);
    else player.sendMessage(tool.noToolMessage ?? "You don't have the right tool to fish there.");
    return null;
  }

  if (tool.worn.length > 0 && !tool.worn.some((id) => player.getEquipment().contains(id))) {
    player.sendMessage("You need to wear ice gloves to handle these eels.");
    return null;
  }

  // A stand-in tool may fish without bait (`baitless`, a league relic's bare hands).
  if ((tool.bait.length > 0 && !variant.baitless && findBait(player, tool) === undefined) || (tool.vessel && !tool.vessel.ready(player))) {
    if (tool.noBaitStatement) statement(player, tool.noBaitStatement);
    else player.sendMessage("You do not have the required bait.");
    return null;
  }

  return variant;
}

function stopFishing(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

/**
 * OSRS skilling success: interpolate low (level 1) to high (level 99), out of 256. A tool
 * bonus scales low and high first, rounded down, as the Wiki's dragon/crystal charts do.
 */
function catchChance(level, fish, bonus = 100, roll = 0) {
  const [baseLow, baseHigh] = fish.rolls[roll];
  const low = Math.floor((baseLow * bonus) / 100);
  const high = Math.floor((baseHigh * bonus) / 100);
  const value = Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5);
  return Math.min(1, (1 + value) / 256);
}

/**
 * What a drop table lands (the Wiki's: its pre-rolls first, each its own chance, else one of the
 * weighted items), and any tertiaries on top.
 */
function rollTable(table, random = Math.random) {
  let caught = table.preRoll.find(([, chance]) => random() < chance)?.[0];
  if (!caught) {
    let pick = random() * table.weighted.reduce((sum, [, weight]) => sum + weight, 0);
    caught = (table.weighted.find(([, weight]) => (pick -= weight) < 0) ?? table.weighted.at(-1))[0];
  }
  return [caught, ...table.tertiary.filter(([, chance]) => random() < chance).map(([fish]) => fish)];
}

/** One attempt: what it lands, highest fish first. Empty on a miss. */
function rollCatch(player, tool, random = Math.random, bonus = 100) {
  const level = catchLevel(player);
  if (tool.table) return random() < catchChance(level, tool.table, bonus) ? rollTable(tool.table, random) : [];
  const caught = [];
  for (const fish of tool.fish) {
    if (getFishingLevel(player) < fish.level || !meetsLevels(player, fish.requires)) {
      continue;
    }
    for (let roll = 0; roll < fish.rolls.length; roll++) {
      if (random() < catchChance(level, fish, bonus, roll)) {
        caught.push(fish);
        if (!tool.multi) {
          return caught;
        }
      }
    }
  }
  return caught;
}

/** Fishing's chat lines go on the spam channel, as every recorded one does. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, text);
}

/** The message box, reset animation and sound live sends when the catch has nowhere to go. */
function inventoryFull(player) {
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  player.getPacketSender().sendSoundEffect(FULL_INVENTORY_SOUND, 1, 0, 1);
  statement(player, FULL_INVENTORY_STATEMENT);
}

/** A message box, through the dialogue manager so "Click here to continue" closes it. */
function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text), new EndDialogue(1)));
}

/** Whether this fish has somewhere to go: a free slot, its own stack, or an open fish barrel. */
function hasRoom(player, fish) {
  const inventory = player.getInventory();
  return inventory.getFreeSlots() > 0 || storageRoom(player, fish.id) ||
    (inventory.contains(fish.id) && pluginApi.core.ItemDefinition.forId(fish.id).isStackable());
}

/** A full inventory only stops fishing when the catch has nowhere to stack. */
function inventoryBlocks(player, tool) {
  const inventory = player.getInventory();
  return inventory.isFull() &&
    !tool.fish.some((fish) => inventory.contains(fish.id) && pluginApi.core.ItemDefinition.forId(fish.id).isStackable()) &&
    !tool.fish.some((fish) => storageRoom(player, fish.id));
}

/**
 * Rada's blessing: a chance to double a catch, with no experience or bait. The Wiki
 * (Rada's blessing 4) shows "Rada's blessing enabled you to catch an extra fish." for it. An
 * infernal harpoon gives the extra its own chance to be cooked (Wiki: Infernal harpoon), which
 * gives Cooking XP and uses an infernal charge. That the extra uses no crystal harpoon charge is
 * inferred, not Wiki.
 * Junk is left out: the Wiki says "fish" and doesn't settle it.
 */
function landExtra(player, variant, fish, amount) {
  if (fish.junk || !RadasBlessing.rollExtraFish(player)) return;
  if (variant.infernal && InfernalHarpoon.tryCookFish(player, fish.id)) {
    spam(player, RadasBlessing.EXTRA_FISH_MESSAGE);
    return;
  }
  if (!hasRoom(player, fish)) return;
  giveCatch(player, fish.id, amount);
  spam(player, RadasBlessing.EXTRA_FISH_MESSAGE);
}

function landCatch(player, tool, variant, caught, spotId = null) {
  const xpMultiplier = AnglerOutfit.xpMultiplier(player);
  // Each fish needs a free slot, its own stack or room in an open fish barrel. Holy Lake shrimps
  // are lost to a full inventory that still takes karambwanji (Wiki: Fishing spot (karambwanji)).
  const landed = [];
  for (const fish of caught) {
    if (!hasRoom(player, fish)) break;
    const amount = fish.amount(player);
    landed.push({ fish, amount });
    if (!variant.infernal || !InfernalHarpoon.tryCookFish(player, fish.id)) {
      giveCatch(player, fish.id, amount, fish.experience * xpMultiplier);
      spam(player, fish.message(amount));
    }
    if (variant.crystal) {
      CrystalHarpoon.tryUseCharge(player);
    }
    player.getSkillManager().addExperiences(Skill.FISHING, fish.experience * xpMultiplier);
    for (const [skill, xp] of fish.extraXp) {
      player.getSkillManager().addExperiences(skill, xp);
    }
  }
  // Rada's blessing rolls once for each fish, after the whole catch has its slots.
  for (const { fish, amount } of landed) {
    landExtra(player, variant, fish, amount);
  }
  // One bottle roll set per natural catch batch; Rada's extra is not another action.
  // The tutorial pond is outside the supported scope; no retail exclusion is inferred.
  // The park uses its own base even though its successful catches are labelled junk.
  if (spotId !== NpcIds.FISHING_SPOT_43) {
    const clueFish = landed.find(({ fish }) => CLUE_BOTTLE_FISH.has(fish))?.fish;
    const clueBase = landed.length && tool === TOOLS.PARK_NET ? PARK_CLUE_BASE : clueFish?.petBase;
    if (clueBase > 0) ClueBottles.rollClueBottles(player, clueBase);
  }

  // Wiki (Heron): a big net catch rolls the pet once per kind of fish in it.
  // A listener may take over the session (the tutorial stops after one catch).
  let stop = false;
  for (const fish of new Set(landed.map((entry) => entry.fish))) {
    if (fish.junk) continue;
    const event = { player, skill: Skill.FISHING, itemId: fish.id, petBase: fish.petBase, barehand: variant.barehand === true, stop: false };
    pluginApi.emitCustomEvent("fishing:success", event);
    if (event.stop) stop = true;
  }

  // Bait and feathers are only used up by a catch, one per cast.
  const bait = variant.baitless ? undefined : findBait(player, tool);
  if (bait !== undefined) {
    useBait(player, bait);
  }
  return stop;
}

function startFishing(player, npc, tool, activeSessions) {
  if (!hasToolRequirements(player, tool)) {
    return true;
  }

  if (inventoryBlocks(player, tool)) {
    inventoryFull(player);
    return true;
  }

  stopFishing(activeSessions, player, false);

  activeSessions.set(player, {
    npcIndex: npc.getIndex(),
    npcId: npc.getId(),
    // A spot that moves ends the session, as in OSRS: the player has to click it again.
    spotX: npc.getLocation().getX(),
    spotY: npc.getLocation().getY(),
    tool,
    nextAnimationTick: fishingTick + FISHING_ANIMATION_INTERVAL_TICKS,
    nextCatchTick: fishingTick + Math.min(tool.firstRoll ?? Infinity, catchInterval(player, tool)),
    followMessageTick: tool.followMessage ? fishingTick + 1 : null,
  });
  tool.spot?.onStart(player, npc);
  tool.vessel?.onStart(player);

  spam(player, tool.startMessage);

  player.performAnimation(new Animation(tool.animationId));
  return true;
}

class FishingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.cycle = 0;
  }

  execute() {
    this.cycle++;
    fishingTick = this.cycle;

    for (const [player, session] of this.activeSessions) {
      if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
        this.activeSessions.delete(player);
        continue;
      }

      // Global tasks precede player turns; the last step may have drained the route.
      const movement = player.getMovementQueue();
      if (movement.size() > 0 || movement.isMovings?.() || player.getForceMovement() != null) {
        stopFishing(this.activeSessions, player);
        continue;
      }
      if (session.levelUpPaused) continue;

      const npc = World.getNpcs().get(session.npcIndex);
      if (!npc || npc.getId() !== session.npcId ||
          npc.getLocation().getX() !== session.spotX || npc.getLocation().getY() !== session.spotY) {
        stopFishing(this.activeSessions, player);
        continue;
      }

      if (!player.getLocation().isWithinDistance(npc.getLocation(), 2)) {
        stopFishing(this.activeSessions, player);
        continue;
      }

      const variant = hasToolRequirements(player, session.tool);
      if (!variant) {
        stopFishing(this.activeSessions, player);
        continue;
      }

      if (inventoryBlocks(player, session.tool)) {
        stopFishing(this.activeSessions, player, false);
        inventoryFull(player);
        continue;
      }

      if (this.cycle === session.followMessageTick) {
        spam(player, session.tool.followMessage);
        player.performAnimation(new Animation(session.tool.animationId));
      }

      // rsprox captures: the animation restarts on every roll, caught or not.
      const { animateOnRoll } = session.tool;
      if (!animateOnRoll && this.cycle >= session.nextAnimationTick) {
        player.performAnimation(new Animation(session.tool.loopAnimationId));
        session.nextAnimationTick = this.cycle + FISHING_ANIMATION_INTERVAL_TICKS;
      }

      if (this.cycle < session.nextCatchTick) {
        continue;
      }
      session.nextCatchTick = this.cycle + catchInterval(player, session.tool);
      if (animateOnRoll) player.performAnimation(new Animation(session.tool.loopAnimationId));

      let caught = rollCatch(player, session.tool, Math.random, variant.bonus);
      // Content may turn a miss into a catch ("fishing:attempt", a league relic's second chance): the best fish the player can land.
      const attempt = { player, success: caught.length > 0 };
      pluginApi.emitCustomEvent("fishing:attempt", attempt);
      if (caught.length === 0 && attempt.success) caught = bestCatch(player, session.tool);
      // A vessel's bait goes with every attempt, caught or not (Wiki: Raw karambwan).
      session.tool.vessel?.useBait(player);
      if (caught.length === 0) {
        if (session.tool.missMessage) spam(player, session.tool.missMessage);
        continue;
      }
      if (session.tool.catchAnimationId !== null) {
        player.performAnimation(new Animation(session.tool.catchAnimationId));
      }
      if (session.tool.spot?.takesCatch(player, npc)) {
        continue;
      }
      const stopAfterCatch = landCatch(player, session.tool, variant, caught, session.npcId);

      // ponytail: spots without their own movement still stop at random instead of moving. A full
      // inventory waits for the next tick's check, which says so.
      if (stopAfterCatch || !hasToolRequirements(player, session.tool) ||
          (!session.tool.spot && !session.tool.stationary && Misc.getRandom(90) === 0)) {
        stopFishing(this.activeSessions, player);
      }
    }
  }
}

let TaskManager;
let World;
let pluginApi;
let activeSessionsRef = null;

function isFishingActive(player) {
  return activeSessionsRef?.has(player) === true;
}

function pauseFishing(event) {
  pauseForLevelUp(event, activeSessionsRef, (player) => stopFishing(activeSessionsRef, player, false));
}

module.exports = {
  name: "Fishing",
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    World = api.getWorld();
    const activeSessions = new Map();
    activeSessionsRef = activeSessions;
    TaskManager.submit(new FishingTask(activeSessions));
    InfernalHarpoon.attach(api);
    RadasBlessing.attach(api);
    CrystalHarpoon.attach(api);
    Guild.attach(api);
    AnglerOutfit.attach(api);
    MinnowPlatform.attach(api);
    KarambwanVessel.attach(api);
    ClueBottles.attach(api);

    api.onPlayerDisconnect(({ player }) => {
      stopFishing(activeSessions, player, false);
    });
    api.onCustomEvent("level-up:popup-opened", pauseFishing);

    // Returning false leaves spots this plugin doesn't fish (aerial...) to others.
    function startFishingInteraction(event) {
      const tool = getSpotTool(event.npcId, event.definition, event.clickType, event.player);
      return tool ? startFishing(event.player, event.npc, tool, activeSessions) : false;
    }
    const actions = Object.fromEntries(FISHING_SPOT_OPTIONS.map((option) => [option, startFishingInteraction]));
    for (const name of FISHING_SPOT_NAMES) {
      api.onNpcInteraction(name, actions);
    }

    api.log("registered", {
      spotTypes: SPOT_TOOLS_BY_OPTIONS.size + SPOT_TOOLS_BY_NPC.size,
      tools: Object.keys(TOOLS).length,
    });
  },
  TOOLS,
  FISH,
  catchChance,
  catchLevel,
  rollInterval,
  pikeInterval,
  rollCatch,
  rollTable,
  findTool,
  getSpotTool,
  hasHarpoon,
  spotTools,
  isFishingActive,
  FISHING_SPOT_NAMES,
  hasToolRequirements,
  landCatch,
  anglerXpMultiplier: (player) => AnglerOutfit.xpMultiplier(player),
};
