/**
 * Scrambled! (members).
 *
 * Route and stages come from the RSProx database capture (download 1106, revision 237.1)
 * and the OSRS Wiki transcript. The capture shows varbit 16758 "scrambled" moving through
 * 0,2,4,6,8,10,12,14,16,18,19,20,22,24,26,28,30. The sibling varbits drive the cache's own
 * NPC and loc transforms, so the quest uses them instead of private flags:
 *   16759/16764/16765  Nezketi/Kauayotl/Acatzin (0 talk, 2 agreed, 3 work agreed,
 *                      4 work done, 7 departed; Nezketi 2->7 when given his tea)
 *   16766/16769/16770  jaguar/dragon/chicken replacement egg (1 ready, 2 guardian out,
 *                      3 guardian dead, 4 handed in, 5 broken after judging)
 *   16994              egg on the wall visibility
 *   16995              workbench nails taken
 *
 * The actual quest locs are placed in this cache: chicken/dragon/jaguar egg piles
 * (56926/56929/56932), broken whetstone (56936), broken cart (56941), damiana (56935)
 * and the workbench (56945). Searching a pile spawns its guardian; looting after the kill
 * gives the egg.
 *
 * The captured egg jigsaw is interface 922, opened with varp 4756 = dbrow 5397. The cache's
 * own scripts build the 26 pieces, handle drag/rotate and send IF_TRIGGEROPLOCAL when a piece
 * is placed correctly. This plugin enables those triggers, records each solved piece in varp
 * 4749, sends script 7970 to lock it (the captured positions) and closes the interface when
 * all 26 are set. Progress is persisted, so a relog reopens the partly solved puzzle and
 * re-locks the pieces already placed.
 *
 * Rewards per the OSRS Wiki and capture: 1 Quest point, 5,000 Construction, Cooking and
 * Smithing XP; the pet Egg from the egg on the wall and Alan's bones afterwards.
 *
 * Quest Helper cross-check (pinned Zoinkwiz/quest-helper 06da90f):
 * src/main/java/com/questhelper/helpers/quests/scrambled/Scrambled.java. It confirms the
 * stage values, the whetstone/cart/egg-pile objects, the six required items, boss levels
 * (chicken 16, jaguar 88, dragon 106) and the three men's varbit states.
 */
module.exports = function registerScrambledQuest(api) {
  const {
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Scrambled!";

  const VARBIT_STAGE = 16758;
  const VARP_SCRAMBLED = 4748;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_CONFIRMED = 4;
  const STAGE_EGG_FELL = 6;
  const STAGE_INSPECTED = 8;
  const STAGE_KING_RALLIED = 10;
  const STAGE_KING_BRIEFED = 12;
  const STAGE_MEN = 14;
  const STAGE_GATHERED = 16;
  const STAGE_PLAN = 18;
  const STAGE_TWO_EGGS = 19;
  const STAGE_GIVEN = 20;
  const STAGE_JUDGED = 22;
  const STAGE_FIXING = 24;
  const STAGE_FIXED = 26;
  const STAGE_FINALE = 28;
  const STAGE_COMPLETE = 30;

  const VARBIT_NEZKETI = 16759;
  const VARBIT_KAUAYOTL = 16764;
  const VARBIT_ACATZIN = 16765;
  const VARBIT_JAGUAR_EGG = 16766;
  const VARBIT_DRAGON_EGG = 16769;
  const VARBIT_CHICKEN_EGG = 16770;
  const VARBIT_EGG_VISIBLE = 16994;
  const VARBIT_NAILS = 16995;

  const MAN_NEZKETI = "nezketi";
  const MAN_KAUAYOTL = "kauayotl";
  const MAN_ACATZIN = "acatzin";

  const EGGS = [
    {
      key: "chicken",
      varbit: VARBIT_CHICKEN_EGG,
      itemId: ItemIdentifiers.LARGE_EGG, // 30967
      objectId: 56926, // scr_eggs_chicken (multi-loc)
      objectTile: { x: 1238, y: 3137 },
      guardianId: NpcIdentifiers.LARGE_CHICKEN, // 14510
      guardianTile: { x: 1239, y: 3137 },
      pileVariant: "talking-to-king-after-gathering-all-her-men-interacting-with-the-pile-of-eggs-large-chicken-s-egg-pile",
      giveNpc: MAN_ACATZIN,
      setupStep: "0pMMZD",
      giveVariant: "after-collecting-the-three-eggs-talking-to-acatzin",
      giveAgainVariant: "after-collecting-the-three-eggs-talking-to-acatzin-talking-to-acatzin-again",
    },
    {
      key: "jaguar",
      varbit: VARBIT_JAGUAR_EGG,
      itemId: ItemIdentifiers.JAGUAR_EGG, // 30969
      objectId: 56932, // scr_eggs_jaguar (multi-loc)
      objectTile: { x: 1332, y: 3122 },
      guardianId: NpcIdentifiers.BLACK_JAGUAR_2, // 14512
      guardianTile: { x: 1329, y: 3122 },
      pileVariant: "talking-to-king-after-gathering-all-her-men-interacting-with-the-pile-of-eggs-jaguar-s-egg-pile",
      giveNpc: MAN_NEZKETI,
      setupStep: "NXRXMq",
      giveVariant: "after-collecting-the-three-eggs-nezketi",
      giveAgainVariant: "after-collecting-the-three-eggs-nezketi-talking-to-nezketi-again",
    },
    {
      key: "dragon",
      varbit: VARBIT_DRAGON_EGG,
      itemId: ItemIdentifiers.DRAGON_EGG, // 30968
      objectId: 56929, // scr_eggs_dragon (multi-loc)
      objectTile: { x: 1259, y: 9482 },
      guardianId: NpcIdentifiers.RED_DRAGON_9, // 14511
      guardianTile: { x: 1257, y: 9482 },
      pileVariant: "talking-to-king-after-gathering-all-her-men-interacting-with-the-pile-of-eggs-red-dragon-s-egg-pile",
      giveNpc: MAN_KAUAYOTL,
      setupStep: "teOflj",
      giveVariant: "after-collecting-the-three-eggs-kauayotl",
      giveAgainVariant: "after-collecting-the-three-eggs-kauayotl-talking-to-kauayotl-again",
    },
  ];
  const EGG_BY_OBJECT = new Map(EGGS.map((egg) => [egg.objectId, egg]));
  const EGG_BY_ITEM = new Map(EGGS.map((egg) => [egg.itemId, egg]));
  const EGG_BY_SETUP_STEP = new Map(EGGS.map((egg) => [egg.setupStep, egg]));

  const MAN_CONFIG = new Map([
    [MAN_NEZKETI, { varbit: VARBIT_NEZKETI, npcId: NpcIdentifiers.NEZKETI, town: { x: 1224, y: 3104 }, temple: { x: 1246, y: 3167 } }],
    [MAN_KAUAYOTL, { varbit: VARBIT_KAUAYOTL, npcId: NpcIdentifiers.KAUAYOTL, town: { x: 1252, y: 3107 }, temple: { x: 1248, y: 3165 } }],
    [MAN_ACATZIN, { varbit: VARBIT_ACATZIN, npcId: NpcIdentifiers.ACATZIN, town: { x: 1228, y: 3117 }, temple: { x: 1246, y: 3165 } }],
  ]);

  const ALAN_NPC_ID = NpcIdentifiers.ALAN_2; // 14475, Talk-to
  const ALAN_CUTSCENE_NPC_ID = NpcIdentifiers.ALAN_3; // 14476, silent cutscene actor
  const EGG_VISIBLE_NPC_ID = NpcIdentifiers.HUMPHREY_DUMPHREY; // 14487, egg on the wall
  const FALLEN_EGG_NPC_ID = 14479; // scrambled_egg_fallen (multinpc -> 14488)
  const EGG_SPLAT_ANIMATION = 12308;
  const BROKEN_EGG_NPC_ID = NpcIdentifiers.HUMPHREY_DUMPHREY_2; // 14488, Inspect
  const EGG_FIX_NPC_ID = NpcIdentifiers.HUMPHREY_DUMPHREY_3; // 14489, Fix
  const PET_EGG_NPC_ID = NpcIdentifiers.HUMPHREY_DUMPHREY; // 14487, Talk-to
  const KING_NPC_ID = NpcIdentifiers.KING; // 14496
  const BLACKSMITH_NPC_ID = NpcIdentifiers.BLACKSMITH_4; // 14509
  const CITIZEN_NPC_IDS = new Set([
    NpcIdentifiers.CITIZEN_125, NpcIdentifiers.CITIZEN_126, NpcIdentifiers.CITIZEN_127,
    NpcIdentifiers.CITIZEN_128, NpcIdentifiers.CITIZEN_129, NpcIdentifiers.CITIZEN_130,
    NpcIdentifiers.CITIZEN_131, NpcIdentifiers.CITIZEN_132, NpcIdentifiers.FARMER_34,
  ]);
  const GUARDIAN_IDS = new Set(EGGS.map((egg) => egg.guardianId));

  const ALAN_TILE = { x: 1247, y: 3167 };
  const BROKEN_EGG_TILE = { x: 1247, y: 3170 };
  const BROKEN_EGG_TEMPLE_TILE = { x: 1244, y: 3168 };
  const WALL_EGG_TILE = { x: 1247, y: 3170 };
  const BONES_TILE = new Location(1247, 3163, 0);
  const BOWL_TILE = new Location(1229, 3119, 0);
  const PLANKS_TILE = new Location(1238, 3076, 0);
  const HAMMER_TILE = new Location(1207, 3108, 0);
  const SAW_TILE = new Location(1212, 3093, 0);
  const PLANKS_COUNT = 2;
  const TAL_TEKLAND_ZONE = { minX: 1200, maxX: 1265, minY: 3075, maxY: 3180, levels: [0] };

  const WHETSTONE_OBJECT_ID = 56936;
  const CART_OBJECT_ID = 56941;
  const WORKBENCH_OBJECT_ID = 56945;
  const DAMIANA_OBJECT_ID = 56935;

  const LARGE_EGG_ITEM_ID = ItemIdentifiers.LARGE_EGG;
  const DRAGON_EGG_ITEM_ID = ItemIdentifiers.DRAGON_EGG;
  const JAGUAR_EGG_ITEM_ID = ItemIdentifiers.JAGUAR_EGG;
  const PET_EGG_ITEM_ID = ItemIdentifiers.EGG_4; // 30970
  const ALANS_BONES_ITEM_ID = ItemIdentifiers.ALANS_BONES; // 30973
  const DAMIANA_LEAVES_ITEM_ID = ItemIdentifiers.DAMIANA_LEAVES; // 30977
  const DAMIANA_WATER_ITEM_ID = ItemIdentifiers.DAMIANA_WATER; // 30979
  const DAMIANA_TEA_BOWL_ITEM_ID = ItemIdentifiers.DAMIANA_TEA; // 30981
  const DAMIANA_TEA_CUP_ITEM_ID = ItemIdentifiers.CUP_OF_TEA_22; // 30985
  const DAMAGED_AXE_ITEM_ID = ItemIdentifiers.ACATZINS_AXE; // 30989
  const FIXED_AXE_ITEM_ID = ItemIdentifiers.ACATZINS_AXE_2; // 30990
  const EMPTY_CUP_ITEM_ID = ItemIdentifiers.EMPTY_CUP; // 1980
  const BOWL_ITEM_ID = ItemIdentifiers.BOWL; // 1923
  const BOWL_OF_WATER_ITEM_ID = ItemIdentifiers.BOWL_OF_WATER; // 1921
  const BOWL_OF_HOT_WATER_ITEM_ID = ItemIdentifiers.BOWL_OF_HOT_WATER; // 4456
  const CUP_OF_TEA_ITEM_ID = ItemIdentifiers.CUP_OF_TEA; // 712
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const SAW_ITEM_ID = ItemIdentifiers.SAW; // 8794
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const IRON_NAILS_ITEM_ID = ItemIdentifiers.IRON_NAILS; // 4820
  const CART_TOOL_ITEM_IDS = new Set([HAMMER_ITEM_ID, SAW_ITEM_ID, PLANK_ITEM_ID, IRON_NAILS_ITEM_ID]);

  const V_START = "starting-off";
  const V_EGG_INSPECT = "starting-off-the-great-fall";
  const V_CITIZEN = "starting-off-the-great-fall-talking-to-the-nearby-farmer-or-citizen";
  const V_KING_CITIZEN = "starting-off-the-great-fall-talking-to-the-king-the-bartender";
  const V_KING_DIRECT = "starting-off-the-great-fall-talking-to-king-first-without-talking-to-anyone-else";
  const V_KING_AGAIN = "starting-off-the-great-fall-talking-to-king-again";
  const V_KING_MEN = "talking-to-king-after-gathering-all-her-men";
  const V_KING_POST = "post-quest-dialogue-king";

  const V_ACATZIN_INTRO = "all-the-king-s-men-talking-to-acatzin";
  const V_ACATZIN_AGAIN = "all-the-king-s-men-talking-to-acatzin-subsequent-dialogue-with-acatzin";
  const V_ACATZIN_AXE = "all-the-king-s-men-talking-to-the-blacksmith-talking-to-acatzin-after-receiving-the-axe";
  const V_ACATZIN_POST = "post-quest-dialogue-acatzin";
  const V_BS_INTRO = "all-the-king-s-men-talking-to-the-blacksmith";
  const V_BS_AGAIN = "all-the-king-s-men-talking-to-the-blacksmith-talking-to-the-blacksmith-again-before-repairing-the-whetstone";
  const V_BS_AFTER = "all-the-king-s-men-talking-to-the-blacksmith-talking-to-the-blacksmith-after-repairing-the-whetstone";

  const V_NEZKETI_INTRO = "all-the-king-s-men-talking-to-nezketi";
  const V_NEZKETI_AGAIN = "all-the-king-s-men-talking-to-nezketi-subsequent-dialogue-with-nezketi";
  const V_NEZKETI_MAKING_TEA = "all-the-king-s-men-talking-to-nezketi-making-the-tea";
  const V_NEZKETI_TEA = "all-the-king-s-men-talking-to-nezketi-talking-to-nezketi-with-brewed-tea";
  const V_NEZKETI_POST = "post-quest-dialogue-nezketi";

  const V_KAUAYOTL_INTRO = "all-the-king-s-men-talking-to-kauayotl";
  const V_KAUAYOTL_AGAIN = "all-the-king-s-men-talking-to-kauayotl-subsequent-dialogue-with-kauayotl";
  const V_KAUAYOTL_REPAIR = "all-the-king-s-men-talking-to-kauayotl-fixing-the-cart";
  const V_KAUAYOTL_AFTER = "all-the-king-s-men-talking-to-kauayotl-talking-to-kauayotl-after-fixing-the-cart";
  const V_KAUAYOTL_POST = "post-quest-dialogue-kauayotl";

  const V_TEMPLE_PLAN = "talking-to-king-after-gathering-all-her-men-talking-to-any-of-king-s-men-at-the-temple";
  const V_REMIND = {
    [MAN_ACATZIN]: "talking-to-king-after-gathering-all-her-men-talking-to-king-s-men-again-talking-to-acatzin",
    [MAN_NEZKETI]: "talking-to-king-after-gathering-all-her-men-talking-to-king-s-men-again-talking-to-nezketi",
    [MAN_KAUAYOTL]: "talking-to-king-after-gathering-all-her-men-talking-to-king-s-men-again-talking-to-kauayotl",
  };
  const V_JUDGE = "judging-the-eggs";
  const V_FIX = "judging-the-eggs-talking-to-any-of-king-s-men-before-putting-humphrey-dumphrey-back-together";

  const PROFANITY_ON_IDS = new Set(["XIV3xs", "8wyNJx", "HpBDKB"]);
  const PROFANITY_OFF_IDS = new Set(["31iRqs", "7O2bIU", "4D6mHx"]);
  const EGG_INTERACT_CONDITION_ID = "nqU4Qn";
  const NO_SMITHING_CONDITION_ID = "jd3uiy";
  const SMITHING_CONDITION_ID = "sX4CDu";
  const NO_HAMMER_CONDITION_ID = "iqpELc";
  const HAMMER_CONDITION_ID = "81aaOL";
  const NO_SPACE_AXE_CONDITION_ID = "wJL8nr";
  const SPACE_AXE_CONDITION_ID = "bq8dgW";
  const HAS_BROKEN_AXE_CONDITION_ID = "DRj_is";
  const HAS_FIXED_AXE_CONDITION_ID = "j7DTpN";
  const NO_SPACE_CUP_CONDITION_ID = "m0_j_t";
  const HAS_CUP_CONDITION_ID = "0GmlhG";
  const NO_CUP_CONDITION_ID = "nFi8iD";
  const NO_SPACE_REGIVE_CONDITION_ID = "WjYKqn";
  const LEAVES_ON_CUP_CONDITION_ID = "1cNTsz";
  const LEAVES_ON_BOWL_CONDITION_ID = "oZjb1-";
  const LEAVES_ON_WATER_CONDITION_ID = "jHtr8H";
  const LEAVES_ON_HOT_CONDITION_ID = "_4z3lk";
  const BOIL_CONDITION_ID = "SINu3i";
  const TEA_BOWL_CONDITION_ID = "aLq4lu";
  const TEA_OTHER_CONDITION_ID = "2Lt2Ms";
  const TEA_CUP_CONDITION_ID = "Xng0jB";
  const NO_CONSTRUCTION_CONDITION_ID = "SAFyQ6";
  const CONSTRUCTION_CONDITION_ID = "YBtv6Z";
  const NO_CART_ITEMS_CONDITION_ID = "L_ogIR";
  const CART_ITEMS_CONDITION_ID = "5uVvuD";
  const PILE_CONDITION_IDS = new Set([
    "spety9", "2UjyxQ", "-HzjUb",
    "JuFOIQ", "470ssp", "4Gi17J",
    "tGBrGi", "Q8GqFE", "CWV8aX",
  ]);

  const CUTSCENE_STEP = "KvvDVx";
  const EGG_FALLS_STEP = "2DUXLf";
  const WHETSTONE_FIXED_STEP = "RjBq3R";
  const AXE_RECEIVE_STEP = "cXz59o";
  const AXE_HANDED_STEP = "vP_T1a";
  const ACATZIN_LEAVES_STEP = "Ycv_sH";
  const CUP_GIVEN_STEPS = new Set(["MKmsN9", "GZ5xmp"]);
  const TEA_LEAVES_ADDED_STEP = "Q7zTx5";
  const TEA_BREWED_STEP = "8UQD6q";
  const TEA_XP_STEP = "EQiiPp";
  const TEA_HANDED_STEP = "mLipel";
  const CART_FIXED_STEP = "hRq_q5";
  const KAUAYOTL_DEPARTED_STEP = "i-UzgE";
  const EGG_BROKEN_STEP = "pR1dDX";
  const ALL_EGGS_FALL_STEP = "dPmRwZ";
  const FIX_ATTEMPT_STEP = "QzLEE2";
  const MEN_LEAVE_STEP = "R85gy5";
  const ALAN_DIES_STEP = "Txl_sf";

  // Cache jigsaw (interface 922). The onLoad scripts build the 26 pieces from dbrow 5397;
  // dragging/rotating calls if_triggeroplocal, and script 7970 locks a solved piece.
  const JIGSAW_GROUP = 922;
  const JIGSAW_PIECES_CHILD = 7;
  const JIGSAW_PIECES_UID = (JIGSAW_GROUP << 16) | JIGSAW_PIECES_CHILD;
  const JIGSAW_DBROW = 5397;
  const JIGSAW_VARP = 4756;
  const JIGSAW_PROGRESS_VARP = 4749;
  const JIGSAW_LOCK_SCRIPT = 7970;
  const JIGSAW_PIECE_COUNT = 26;
  const JIGSAW_SCRIPT_TRIGGER = 1 << 23;
  // Target positions from Quest Helper's EggSolver, in piece order.
  const JIGSAW_POSITIONS = [
    [194, 121], [217, 27], [260, 22], [250, 41], [175, 58], [198, 60],
    [288, 71], [231, 71], [231, 99], [257, 113], [273, 115], [306, 119],
    [243, 149], [309, 160], [269, 177], [297, 217], [252, 213], [244, 255],
    [199, 248], [222, 199], [187, 210], [149, 179], [209, 160], [165, 141],
    [157, 103], [196, 105],
  ];

  const STATE_PREFIX = "scrambled:";
  const VERSION_ATTRIBUTE = "scrambled:version";
  const VERSION = 2;
  const JIGSAW_ATTRIBUTE = "scrambled:jigsaw";
  const OLD_STAGE_MAP = new Map([[1, 6], [2, 8], [3, 14], [4, 16], [5, 18], [6, 20], [7, 24], [8, 30]]);
  const BITS_ATTRIBUTE = "quest.scrambled.bits";
  const BIT_CITIZEN_MET = 1;
  const BIT_WORKBENCH_SEARCHED = 1 << 1;
  const BIT_PET_EGG_RECEIVED = 1 << 2;
  const BIT_AXE_RECEIVED = 1 << 3;
  const BIT_KAUAYOTL_REPAIRED = 1 << 4;
  const BIT_ACATZIN_REPAIRED = 1 << 5;

  /** The tea-making condition matching a just-performed item use. */
  const teaAction = new WeakMap();
  /** Tracked owner-only spawns, keyed by role tag. */
  const trackedNpcs = new WeakMap();

  let quest;
  let groundItems;
  const Scenes = createQuestScenes(api, { onEnd: handleSceneEnd });

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function stateKey(kind, key) {
    return `${STATE_PREFIX}${kind}-${key}`;
  }

  function varbitValue(player, varbit, kind, key) {
    return Number(player.getAttribute(stateKey(kind, key))) || 0;
  }

  function sendVarbit(player, varbit, value, kind, key) {
    player.setAttribute(stateKey(kind, key), value | 0);
    player.getPacketSender().sendVarbit(varbit, value | 0);
  }

  const man = (player, key) => varbitValue(player, MAN_CONFIG.get(key).varbit, "man", key);
  const setMan = (player, key, value) => sendVarbit(player, MAN_CONFIG.get(key).varbit, value, "man", key);
  const eggValue = (player, egg) => varbitValue(player, egg.varbit, "egg", egg.key);
  const setEgg = (player, egg, value) => sendVarbit(player, egg.varbit, value, "egg", egg.key);
  const nailsTaken = (player) => varbitValue(player, VARBIT_NAILS, "misc", "nails") > 0;
  const setNailsTaken = (player) => sendVarbit(player, VARBIT_NAILS, 1, "misc", "nails");

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const full = (player) => player.getInventory().getFreeSlots() < 1;

  function hasAnyBowl(player) {
    return (
      held(player, BOWL_ITEM_ID) ||
      held(player, BOWL_OF_WATER_ITEM_ID) ||
      held(player, BOWL_OF_HOT_WATER_ITEM_ID) ||
      held(player, DAMIANA_WATER_ITEM_ID) ||
      held(player, DAMIANA_TEA_BOWL_ITEM_ID)
    );
  }

  function hasAnyTea(player) {
    return (
      held(player, DAMIANA_TEA_BOWL_ITEM_ID) ||
      held(player, DAMIANA_TEA_CUP_ITEM_ID) ||
      held(player, CUP_OF_TEA_ITEM_ID)
    );
  }

  function hasAllCartItems(player) {
    return (
      held(player, PLANK_ITEM_ID, 2) &&
      held(player, IRON_NAILS_ITEM_ID, 6) &&
      held(player, HAMMER_ITEM_ID) &&
      held(player, SAW_ITEM_ID)
    );
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    if (!questComplete(player, "children_of_the_sun")) return false;
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.CONSTRUCTION) >= 38 &&
      skills.getMaxLevel(Skill.COOKING) >= 36 &&
      skills.getMaxLevel(Skill.SMITHING) >= 35
    );
  }

  function notifyRequirements(player) {
    if (!questComplete(player, "children_of_the_sun")) {
      player.sendMessage("You must have completed Children of the Sun to start this quest.");
    }
    const skills = player.getSkillManager();
    if (skills.getMaxLevel(Skill.CONSTRUCTION) < 38) {
      player.sendMessage("You need a Construction level of at least 38 to start this quest.");
    }
    if (skills.getMaxLevel(Skill.COOKING) < 36) {
      player.sendMessage("You need a Cooking level of at least 36 to start this quest.");
    }
    if (skills.getMaxLevel(Skill.SMITHING) < 35) {
      player.sendMessage("You need a Smithing level of at least 35 to start this quest.");
    }
  }

  function setStage(player, stage) {
    if (quest.getStage(player) !== stage) quest.setStage(player, stage);
  }

  // ==========================================================================
  // Owner-only NPC spawns
  // ==========================================================================

  function tracked(player) {
    let map = trackedNpcs.get(player);
    if (!map) {
      map = new Map();
      trackedNpcs.set(player, map);
    }
    return map;
  }

  function spawnTracked(player, key, definition) {
    const map = tracked(player);
    if (map.has(key)) return map.get(key);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) map.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const map = trackedNpcs.get(player);
    const npc = map?.get(key);
    if (npc) {
      api.removeNpc(npc);
      map.delete(key);
    }
  }

  function removeAllTracked(player) {
    const map = trackedNpcs.get(player);
    if (map) {
      for (const npc of map.values()) api.removeNpc(npc);
      trackedNpcs.delete(player);
    }
  }

  function spawnAt(player, key, id, tile) {
    spawnTracked(player, key, { id, x: tile.x, y: tile.y, z: 0, wanderRadius: 0 });
  }

  function ensureSpawns(player) {
    if (!player || player.isPlayerBot?.() === true || !quest) return;
    const stage = quest.getStage(player);

    // Alan and the egg on the wall before the fall.
    if (stage < STAGE_EGG_FELL) {
      spawnAt(player, "alan", ALAN_NPC_ID, ALAN_TILE);
    } else {
      removeTracked(player, "alan");
    }

    // The broken egg moves into the temple once all three eggs are handed in.
    removeTracked(player, "egg-ground");
    removeTracked(player, "egg-temple");
    removeTracked(player, "egg-fix");
    if (stage >= STAGE_EGG_FELL && stage <= STAGE_PLAN) {
      spawnAt(player, "egg-ground", BROKEN_EGG_NPC_ID, BROKEN_EGG_TILE);
    } else if (stage >= STAGE_TWO_EGGS && stage < STAGE_FIXING) {
      spawnAt(player, "egg-temple", BROKEN_EGG_NPC_ID, BROKEN_EGG_TEMPLE_TILE);
    } else if (stage >= STAGE_FIXING && stage < STAGE_FINALE) {
      spawnAt(player, "egg-fix", EGG_FIX_NPC_ID, BROKEN_EGG_TEMPLE_TILE);
    }

    // King's men: village while rallying, temple once gathered.
    for (const key of MAN_CONFIG.keys()) {
      removeTracked(player, `man-town-${key}`);
      removeTracked(player, `man-temple-${key}`);
    }
    if (stage >= STAGE_MEN && stage < STAGE_GATHERED) {
      for (const [key, config] of MAN_CONFIG) spawnAt(player, `man-town-${key}`, config.npcId, config.town);
    } else if (stage >= STAGE_GATHERED) {
      for (const [key, config] of MAN_CONFIG) spawnAt(player, `man-temple-${key}`, config.npcId, config.temple);
    }

    // A guardian stays out until killed; level 2 in its varbit means "spawned".
    for (const egg of EGGS) {
      const key = `guardian-${egg.key}`;
      if (eggValue(player, egg) === 2) {
        spawnAt(player, key, egg.guardianId, egg.guardianTile);
      } else {
        removeTracked(player, key);
      }
    }

    if (stage >= STAGE_FINALE) {
      spawnAt(player, "pet-egg", PET_EGG_NPC_ID, WALL_EGG_TILE);
    } else {
      removeTracked(player, "pet-egg");
    }
  }

  function ensureGroundItems(player) {
    if (!player || !quest) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_INSPECTED && stage < STAGE_PLAN && !hasAnyBowl(player)) {
      if (!groundItems.getGroundItem(player.getUsername(), BOWL_ITEM_ID, BOWL_TILE)) {
        groundItems.registerLocation(player, new Item(BOWL_ITEM_ID, 1), BOWL_TILE);
      }
    }
    if (stage >= STAGE_MEN && stage < STAGE_PLAN && !held(player, PLANK_ITEM_ID, PLANKS_COUNT)) {
      if (!groundItems.getGroundItem(player.getUsername(), PLANK_ITEM_ID, PLANKS_TILE)) {
        groundItems.registerLocation(player, new Item(PLANK_ITEM_ID, PLANKS_COUNT), PLANKS_TILE);
      }
    }
    if (stage >= STAGE_INSPECTED && stage < STAGE_PLAN && !held(player, HAMMER_ITEM_ID)) {
      if (!groundItems.getGroundItem(player.getUsername(), HAMMER_ITEM_ID, HAMMER_TILE)) {
        groundItems.registerLocation(player, new Item(HAMMER_ITEM_ID, 1), HAMMER_TILE);
      }
    }
    if (stage >= STAGE_INSPECTED && stage < STAGE_PLAN && !held(player, SAW_ITEM_ID)) {
      if (!groundItems.getGroundItem(player.getUsername(), SAW_ITEM_ID, SAW_TILE)) {
        groundItems.registerLocation(player, new Item(SAW_ITEM_ID, 1), SAW_TILE);
      }
    }
  }

  function handleZoneEnter({ player }) {
    ensureSpawns(player);
    ensureGroundItems(player);
  }

  // ==========================================================================
  // Transcript wiring
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (npcId === ALAN_NPC_ID) {
      return quest.getStage(player) < STAGE_EGG_FELL ? V_START : null;
    }
    if (npcId === KING_NPC_ID) return selectKingVariant(player);
    if (npcId === BLACKSMITH_NPC_ID) return selectBlacksmithVariant(player);
    if (npcId === MAN_CONFIG.get(MAN_ACATZIN).npcId) return selectAcatzinVariant(player);
    if (npcId === MAN_CONFIG.get(MAN_NEZKETI).npcId) return selectNezketiVariant(player);
    if (npcId === MAN_CONFIG.get(MAN_KAUAYOTL).npcId) return selectKauayotlVariant(player);
    return null;
  }

  function selectKingVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return V_KING_POST;
    if (stage >= STAGE_GATHERED) return V_KING_MEN;
    if (stage >= STAGE_MEN) return V_KING_AGAIN;
    if (stage >= STAGE_INSPECTED) return hasBit(player, BIT_CITIZEN_MET) ? V_KING_CITIZEN : V_KING_DIRECT;
    return null;
  }

  function selectBlacksmithVariant(player) {
    if (man(player, MAN_ACATZIN) < 3 || man(player, MAN_ACATZIN) >= 7) return null;
    return man(player, MAN_ACATZIN) >= 4 ? V_BS_AFTER : V_BS_INTRO;
  }

  function selectAcatzinVariant(player) {
    if (quest.isComplete(player)) return V_ACATZIN_POST;
    if (quest.getStage(player) >= STAGE_FINALE) return selectGatherVariant(player, EGGS[0]);
    if (man(player, MAN_ACATZIN) >= 7) return selectGatherVariant(player, EGGS[0]);
    if (man(player, MAN_ACATZIN) === 0) return V_ACATZIN_INTRO;
    if (held(player, FIXED_AXE_ITEM_ID) || held(player, DAMAGED_AXE_ITEM_ID)) return V_ACATZIN_AXE;
    return V_ACATZIN_AGAIN;
  }

  function selectNezketiVariant(player) {
    if (quest.isComplete(player)) return V_NEZKETI_POST;
    if (quest.getStage(player) >= STAGE_FINALE) return selectGatherVariant(player, EGGS[1]);
    if (man(player, MAN_NEZKETI) >= 7) return selectGatherVariant(player, EGGS[1]);
    if (man(player, MAN_NEZKETI) === 0) return V_NEZKETI_INTRO;
    return hasAnyTea(player) ? V_NEZKETI_TEA : V_NEZKETI_AGAIN;
  }

  function selectKauayotlVariant(player) {
    if (quest.isComplete(player)) return V_KAUAYOTL_POST;
    if (quest.getStage(player) >= STAGE_FINALE) return selectGatherVariant(player, EGGS[2]);
    if (man(player, MAN_KAUAYOTL) >= 7) return selectGatherVariant(player, EGGS[2]);
    if (man(player, MAN_KAUAYOTL) === 0) return V_KAUAYOTL_INTRO;
    if (man(player, MAN_KAUAYOTL) >= 3) return V_KAUAYOTL_AFTER;
    return V_KAUAYOTL_AGAIN;
  }

  /** The temple conversation: plan, hand-ins, judging and the egg fix. */
  function selectGatherVariant(player, egg) {
    const stage = quest.getStage(player);
    // 26 is "egg rebuilt"; 24 still waits for the jigsaw and must not start the finale.
    if (stage >= STAGE_FIXED) return V_FIX;
    if (stage >= STAGE_FIXING) return null;
    if (stage >= STAGE_GIVEN) return V_JUDGE;
    if (stage < STAGE_PLAN) return V_TEMPLE_PLAN;
    const value = eggValue(player, egg);
    if (value >= 4) return egg.giveAgainVariant;
    if (held(player, egg.itemId)) return egg.giveVariant;
    return V_REMIND[egg.giveNpc];
  }

  function answerCondition({ player, stepId }) {
    if (!stepId) return null;
    if (PROFANITY_ON_IDS.has(stepId)) return false;
    if (PROFANITY_OFF_IDS.has(stepId)) return true;
    if (stepId === EGG_INTERACT_CONDITION_ID) return true;
    if (stepId === NO_SMITHING_CONDITION_ID) return player.getSkillManager().getMaxLevel(Skill.SMITHING) < 35;
    if (stepId === SMITHING_CONDITION_ID) return player.getSkillManager().getMaxLevel(Skill.SMITHING) >= 35;
    if (stepId === NO_HAMMER_CONDITION_ID) return !held(player, HAMMER_ITEM_ID);
    if (stepId === HAMMER_CONDITION_ID) return held(player, HAMMER_ITEM_ID);
    if (stepId === NO_SPACE_AXE_CONDITION_ID) return full(player);
    if (stepId === SPACE_AXE_CONDITION_ID) return !full(player);
    if (stepId === HAS_BROKEN_AXE_CONDITION_ID) return held(player, DAMAGED_AXE_ITEM_ID);
    if (stepId === HAS_FIXED_AXE_CONDITION_ID) return held(player, FIXED_AXE_ITEM_ID);
    if (stepId === NO_SPACE_CUP_CONDITION_ID) return full(player);
    if (stepId === HAS_CUP_CONDITION_ID) return held(player, EMPTY_CUP_ITEM_ID);
    if (stepId === NO_CUP_CONDITION_ID) return !held(player, EMPTY_CUP_ITEM_ID);
    if (stepId === NO_SPACE_REGIVE_CONDITION_ID) return full(player);
    if (stepId === LEAVES_ON_CUP_CONDITION_ID) return teaAction.get(player) === "leaves-on-cup";
    if (stepId === LEAVES_ON_BOWL_CONDITION_ID) return teaAction.get(player) === "leaves-on-bowl";
    if (stepId === LEAVES_ON_WATER_CONDITION_ID) return teaAction.get(player) === "leaves-on-water";
    if (stepId === LEAVES_ON_HOT_CONDITION_ID) return teaAction.get(player) === "leaves-on-hot";
    if (stepId === BOIL_CONDITION_ID) return teaAction.get(player) === "boil";
    if (stepId === TEA_BOWL_CONDITION_ID) return held(player, DAMIANA_TEA_BOWL_ITEM_ID);
    if (stepId === TEA_OTHER_CONDITION_ID) return held(player, CUP_OF_TEA_ITEM_ID);
    if (stepId === TEA_CUP_CONDITION_ID) return held(player, DAMIANA_TEA_CUP_ITEM_ID);
    if (stepId === NO_CONSTRUCTION_CONDITION_ID) return player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < 38;
    if (stepId === CONSTRUCTION_CONDITION_ID) return player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) >= 38;
    if (stepId === NO_CART_ITEMS_CONDITION_ID) return !hasAllCartItems(player);
    if (stepId === CART_ITEMS_CONDITION_ID) return hasAllCartItems(player);
    if (PILE_CONDITION_IDS.has(stepId)) return answerPileCondition(player, stepId);
    return null;
  }

  function answerPileCondition(player, stepId) {
    const pile = EGGS.find((entry) =>
      (entry.key === "chicken" && ["spety9", "2UjyxQ", "-HzjUb"].includes(stepId)) ||
      (entry.key === "jaguar" && ["JuFOIQ", "470ssp", "4Gi17J"].includes(stepId)) ||
      (entry.key === "dragon" && ["tGBrGi", "Q8GqFE", "CWV8aX"].includes(stepId))
    );
    if (!pile) return null;
    const value = eggValue(player, pile);
    const attempt = ["spety9", "JuFOIQ", "tGBrGi"].includes(stepId);
    const take = ["2UjyxQ", "470ssp", "Q8GqFE"].includes(stepId);
    if (attempt) return value === 1;
    if (take) return value === 3 && !full(player);
    return value === 3 && full(player);
  }

  function handleChoice({ player, npcId, option }) {
    const stage = quest.getStage(player);
    if (npcId === ALAN_NPC_ID) {
      if (option === "Yes." && stage === STAGE_NOT_STARTED) {
        if (!meetsRequirements(player)) {
          notifyRequirements(player);
          return;
        }
        player.setAttribute(VERSION_ATTRIBUTE, VERSION);
        setStage(player, STAGE_STARTED);
        player.sendMessage("You've started a new quest: <col=0ab0ff>Scrambled!</col>");
      } else if (option === "Of course!" && stage === STAGE_STARTED) {
        setStage(player, STAGE_CONFIRMED);
      }
      return;
    }
    if (npcId === MAN_CONFIG.get(MAN_ACATZIN).npcId) {
      if (option === "I can talk to the blacksmith." && man(player, MAN_ACATZIN) < 3) {
        setMan(player, MAN_ACATZIN, 3);
      }
      return;
    }
    if (npcId === MAN_CONFIG.get(MAN_NEZKETI).npcId) {
      if (option === "I can get you some tea." && man(player, MAN_NEZKETI) < 2) {
        setMan(player, MAN_NEZKETI, 2);
      }
      return;
    }
    if (npcId === MAN_CONFIG.get(MAN_KAUAYOTL).npcId) {
      if (option === "I see. Well, maybe I can help out with that?" && man(player, MAN_KAUAYOTL) < 2) {
        setMan(player, MAN_KAUAYOTL, 2);
      }
    }
  }

  /** Stage moves carried by exact transcript lines (the capture has no ids for them). */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    const line = String(text);
    const stage = quest.getStage(player);
    // The profanity-disabled finale branch ends on this line without an explicit end step.
    if (stage === STAGE_FINALE && (line === "Bollocks." || line === ".")) {
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (npcId === KING_NPC_ID) {
      if (stage === STAGE_INSPECTED && line.includes("They'll be up to the task")) {
        setStage(player, STAGE_KING_RALLIED);
        setStage(player, STAGE_KING_BRIEFED);
      } else if (stage === STAGE_KING_BRIEFED && line.includes("Nezketi should be in the temple just south of here")) {
        setStage(player, STAGE_MEN);
        ensureSpawns(player);
      }
      return;
    }
    if (line.includes("No, it's necessary") && stage === STAGE_JUDGED) {
      setStage(player, STAGE_FIXING);
      ensureSpawns(player);
      api.core.TaskManager.submit(new api.core.CountdownTask(player, 1, () => {
        if (player.isRegistered?.() !== false && quest.getStage(player) === STAGE_FIXING) openJigsaw(player);
      }));
      return;
    }
    if (
      [...MAN_CONFIG.values()].some((config) => config.npcId === npcId) &&
      line.includes("I'll be back once I have some eggs")
    ) {
      if (stage === STAGE_GATHERED) {
        setStage(player, STAGE_PLAN);
        for (const egg of EGGS) if (eggValue(player, egg) === 0) setEgg(player, egg, 1);
      }
    }
  }

  function handleCondition({ player, stepId }) {
    if (stepId === EGG_INTERACT_CONDITION_ID && quest.getStage(player) === STAGE_EGG_FELL) {
      setStage(player, STAGE_INSPECTED);
    }
  }

  function handleSceneEnd() {}

  /** The captured start cutscene: fade, Alan and the egg, camera, splat, then the fallen egg. */
  function playEggFallScene(player) {
    if (Scenes.get(player)) return;
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => {
      if (quest.getStage(player) !== STAGE_CONFIRMED) return;
      removeTracked(player, "alan");
      player.moveTo(new Location(1247, 3167, 0));
      const scene = Scenes.open(player, "scrambled-egg-fall", [[1244, 1250, 3163, 3172, 0]]);
      Scenes.actor(scene, ALAN_CUTSCENE_NPC_ID, [1247, 3166, 0], [1247, 3170]);
      const egg = Scenes.actor(scene, EGG_VISIBLE_NPC_ID, [1247, 3170, 0]);
      Scenes.camera(player, [1251, 3165, 340], [1246, 3168, 140]);
      Scenes.fade(player, false);
      Scenes.later(scene, 44, () => egg?.performAnimation(new api.core.Animation(EGG_SPLAT_ANIMATION)));
      Scenes.later(scene, 49, () => {
        if (egg) Scenes.removeActor(scene, egg);
        Scenes.actor(scene, FALLEN_EGG_NPC_ID, [1247, 3170, 0]);
      });
      Scenes.later(scene, 56, () => Scenes.fade(player, true));
      Scenes.later(scene, 58, () => {
        Scenes.end(player);
        Scenes.closeFade(player);
        player.moveTo(new Location(1247, 3167, 0));
        setStage(player, STAGE_EGG_FELL);
        ensureSpawns(player);
      });
    });
  }

  function handleAction(event) {
    const { player, stepId, step } = event;
    const isKingsMan = [...MAN_CONFIG.values()].some((config) => config.npcId === event.npcId);
    if (step?.type === "end" && isKingsMan && quest.getStage(player) === STAGE_FINALE) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (!stepId) return;
    if (stepId === EGG_FALLS_STEP) {
      if (quest.getStage(player) === STAGE_CONFIRMED) playEggFallScene(player);
      return;
    }
    if (stepId === WHETSTONE_FIXED_STEP) {
      if (man(player, MAN_ACATZIN) === 3) setMan(player, MAN_ACATZIN, 4);
      return;
    }
    if (stepId === AXE_RECEIVE_STEP) {
      event.handled = true;
      if (!held(player, DAMAGED_AXE_ITEM_ID)) player.getInventory().adds(DAMAGED_AXE_ITEM_ID, 1);
      setBit(player, BIT_AXE_RECEIVED);
      return;
    }
    if (stepId === AXE_HANDED_STEP) {
      if (held(player, FIXED_AXE_ITEM_ID)) player.getInventory().deleteNumber(FIXED_AXE_ITEM_ID, 1);
      setMan(player, MAN_ACATZIN, 7);
      advanceIfAllMenDeparted(player);
      return;
    }
    if (stepId === ACATZIN_LEAVES_STEP) {
      setMan(player, MAN_ACATZIN, 7);
      advanceIfAllMenDeparted(player);
      return;
    }
    if (CUP_GIVEN_STEPS.has(stepId)) {
      if (man(player, MAN_NEZKETI) < 2) setMan(player, MAN_NEZKETI, 2);
      if (!full(player) && !held(player, EMPTY_CUP_ITEM_ID)) player.getInventory().adds(EMPTY_CUP_ITEM_ID, 1);
      return;
    }
    if (stepId === TEA_LEAVES_ADDED_STEP) {
      player.getInventory().deleteNumber(DAMIANA_LEAVES_ITEM_ID, 1);
      player.getInventory().deleteNumber(BOWL_OF_WATER_ITEM_ID, 1);
      player.getInventory().adds(DAMIANA_WATER_ITEM_ID, 1);
      return;
    }
    if (stepId === TEA_BREWED_STEP) {
      player.getInventory().deleteNumber(DAMIANA_WATER_ITEM_ID, 1);
      player.getInventory().adds(DAMIANA_TEA_BOWL_ITEM_ID, 1);
      return;
    }
    if (stepId === TEA_XP_STEP) {
      player.getSkillManager().addExperiences(Skill.COOKING, 68);
      return;
    }
    if (stepId === TEA_HANDED_STEP) {
      if (held(player, DAMIANA_TEA_CUP_ITEM_ID)) player.getInventory().deleteNumber(DAMIANA_TEA_CUP_ITEM_ID, 1);
      setMan(player, MAN_NEZKETI, 7);
      advanceIfAllMenDeparted(player);
      return;
    }
    if (stepId === CART_FIXED_STEP) {
      setMan(player, MAN_KAUAYOTL, 3);
      return;
    }
    if (stepId === KAUAYOTL_DEPARTED_STEP) {
      setMan(player, MAN_KAUAYOTL, 7);
      advanceIfAllMenDeparted(player);
      return;
    }
    if (stepId === EGG_BROKEN_STEP) {
      if (quest.getStage(player) < STAGE_INSPECTED) setStage(player, STAGE_INSPECTED);
      return;
    }
    const egg = EGG_BY_SETUP_STEP.get(stepId);
    if (egg) {
      finishEggHandIn(player, egg);
      return;
    }
    if (stepId === ALL_EGGS_FALL_STEP) {
      if (quest.getStage(player) === STAGE_GIVEN) {
        setStage(player, STAGE_JUDGED);
        for (const entry of EGGS) if (eggValue(player, entry) >= 4) setEgg(player, entry, 5);
      }
      return;
    }
    if (stepId === FIX_ATTEMPT_STEP) return;
    if (stepId === MEN_LEAVE_STEP) {
      for (const key of MAN_CONFIG.keys()) removeTracked(player, `man-temple-${key}`);
      return;
    }
    if (stepId === ALAN_DIES_STEP) {
      if (!quest.isComplete(player)) {
        setStage(player, STAGE_FINALE);
        removeTracked(player, "egg-ground");
        removeTracked(player, "egg-temple");
        removeTracked(player, "egg-fix");
        for (const key of MAN_CONFIG.keys()) removeTracked(player, `man-temple-${key}`);
        for (const key of MAN_CONFIG.keys()) setMan(player, key, 0);
        for (const entry of EGGS) setEgg(player, entry, 0);
        sendStateVarbits(player);
        if (!groundItems.getGroundItem(player.getUsername(), ALANS_BONES_ITEM_ID, BONES_TILE)) {
          groundItems.registerLocation(player, new Item(ALANS_BONES_ITEM_ID, 1), BONES_TILE);
        }
        ensureSpawns(player);
      }
    }
  }

  function allMenDeparted(player) {
    return [...MAN_CONFIG.keys()].every((key) => man(player, key) >= 7);
  }

  function advanceIfAllMenDeparted(player) {
    if (allMenDeparted(player) && quest.getStage(player) === STAGE_MEN) {
      setStage(player, STAGE_GATHERED);
      ensureSpawns(player);
    }
  }

  function finishEggHandIn(player, egg) {
    player.getInventory().deleteNumber(egg.itemId, 1);
    setEgg(player, egg, 4);
    if (quest.getStage(player) !== STAGE_PLAN && quest.getStage(player) !== STAGE_TWO_EGGS) return;
    const given = EGGS.filter((entry) => eggValue(player, entry) >= 4).length;
    if (given >= 3) setStage(player, STAGE_GIVEN);
    else if (given === 2) setStage(player, STAGE_TWO_EGGS);
  }

  // ==========================================================================
  // World interactions
  // ==========================================================================

  /** Farmer/Citizen point the player at King after the egg breaks. */
  function handleCitizenTalk(event) {
    const { player, npcId } = event;
    if (!CITIZEN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_INSPECTED || hasBit(player, BIT_CITIZEN_MET)) return;
    event.handled = true;
    setBit(player, BIT_CITIZEN_MET);
    startTranscript(api, player, npcId, PAGE, V_CITIZEN);
  }

  function inspectEgg(event) {
    const { player, npcId } = event;
    if (npcId !== BROKEN_EGG_NPC_ID) return;
    if (quest.getStage(player) < STAGE_EGG_FELL || quest.getStage(player) > STAGE_JUDGED) return;
    event.handled = true;
    startTranscript(api, player, BROKEN_EGG_NPC_ID, PAGE, V_EGG_INSPECT);
  }

  function fixEgg(event) {
    const { player, npcId } = event;
    if (npcId !== EGG_FIX_NPC_ID || quest.getStage(player) !== STAGE_FIXING) return;
    event.handled = true;
    openJigsaw(player);
  }

  function jigsawMask(player) {
    return Number(player.getAttribute(JIGSAW_ATTRIBUTE)) || 0;
  }

  function jigsawComplete(player) {
    return jigsawMask(player) === (1 << JIGSAW_PIECE_COUNT) - 1;
  }

  function openJigsaw(player) {
    const sender = player.getPacketSender();
    if (sender.isSubInterfaceOpen?.(JIGSAW_GROUP)) return;
    sender.sendConfig(JIGSAW_VARP, JIGSAW_DBROW);
    sender.sendSubInterface((161 << 16) | 16, JIGSAW_GROUP, 0);
    sender.sendInterfaceFlagsRange(JIGSAW_PIECES_UID, 0, JIGSAW_PIECE_COUNT - 1, JIGSAW_SCRIPT_TRIGGER);
    sender.sendConfig(JIGSAW_PROGRESS_VARP, jigsawMask(player));
    // Re-lock pieces already solved before a logout/reopen.
    for (let piece = 0; piece < JIGSAW_PIECE_COUNT; piece++) {
      if ((jigsawMask(player) & (1 << piece)) !== 0) sendJigsawLock(sender, piece);
    }
    if (jigsawComplete(player)) finishJigsaw(player);
  }

  function sendJigsawLock(sender, piece) {
    const [x, y] = JIGSAW_POSITIONS[piece];
    sender.sendInterfaceScript(JIGSAW_LOCK_SCRIPT, [JIGSAW_DBROW, piece, x, y]);
  }

  function handleJigsawTrigger(event) {
    const { player } = event;
    if (!event.scriptTrigger || event.groupId !== JIGSAW_GROUP || event.childId !== JIGSAW_PIECES_CHILD) return;
    if (quest.getStage(player) !== STAGE_FIXING) return;
    const piece = Number(event.slot);
    if (!Number.isInteger(piece) || piece < 0 || piece >= JIGSAW_PIECE_COUNT) return;
    event.handled = true;
    const mask = jigsawMask(player);
    if ((mask & (1 << piece)) !== 0) return;
    const next = mask | (1 << piece);
    player.setAttribute(JIGSAW_ATTRIBUTE, next);
    const sender = player.getPacketSender();
    sender.sendConfig(JIGSAW_PROGRESS_VARP, next);
    sendJigsawLock(sender, piece);
    if (next === (1 << JIGSAW_PIECE_COUNT) - 1) finishJigsaw(player);
  }

  function finishJigsaw(player) {
    player.getPacketSender().closeInterface(JIGSAW_GROUP);
    setStage(player, STAGE_FIXED);
    ensureSpawns(player);
  }

  function petEggTalk(event) {
    const { player, npcId } = event;
    if (npcId !== PET_EGG_NPC_ID || !quest.isComplete(player)) return;
    event.handled = true;
    if (!hasBit(player, BIT_PET_EGG_RECEIVED)) {
      const before = player.getInventory().getAmount(PET_EGG_ITEM_ID);
      player.getInventory().adds(PET_EGG_ITEM_ID, 1);
      if (player.getInventory().getAmount(PET_EGG_ITEM_ID) <= before) return;
      setBit(player, BIT_PET_EGG_RECEIVED);
      player.sendMessage("The egg wibbles fondly. You gain an egg.");
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (npcId !== BLACKSMITH_NPC_ID) return;
    if (itemId === HAMMER_ITEM_ID && man(player, MAN_ACATZIN) === 3) {
      event.handled = true;
      setMan(player, MAN_ACATZIN, 4);
      player.sendMessage("You fix the blacksmith's whetstone.");
      return;
    }
    if (itemId === DAMAGED_AXE_ITEM_ID && man(player, MAN_ACATZIN) >= 4) {
      event.handled = true;
      player.getInventory().deleteNumber(DAMAGED_AXE_ITEM_ID, 1);
      player.getInventory().adds(FIXED_AXE_ITEM_ID, 1);
      player.sendMessage("You repair Acatzin's axe using the whetstone.");
    }
  }

  /** Damiana tea making, leaf by leaf, from the transcript's own messages. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (ids.has(DAMIANA_LEAVES_ITEM_ID)) {
      const other = usedItemId === DAMIANA_LEAVES_ITEM_ID ? usedWithItemId : usedItemId;
      let action;
      if (other === EMPTY_CUP_ITEM_ID) action = "leaves-on-cup";
      else if (other === BOWL_ITEM_ID) action = "leaves-on-bowl";
      else if (other === BOWL_OF_WATER_ITEM_ID) action = "leaves-on-water";
      else if (other === BOWL_OF_HOT_WATER_ITEM_ID) action = "leaves-on-hot";
      if (!action) return;
      event.handled = true;
      teaAction.set(player, action);
      startTranscript(api, player, MAN_NEZKETI, PAGE, V_NEZKETI_MAKING_TEA);
      teaAction.delete(player);
      return;
    }
    if (ids.has(DAMIANA_TEA_BOWL_ITEM_ID) && ids.has(EMPTY_CUP_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(DAMIANA_TEA_BOWL_ITEM_ID, 1);
      player.getInventory().deleteNumber(EMPTY_CUP_ITEM_ID, 1);
      player.getInventory().adds(DAMIANA_TEA_CUP_ITEM_ID, 1);
      player.getInventory().adds(BOWL_ITEM_ID, 1);
      player.sendMessage("You pour the damiana tea into the cup.");
    }
  }

  function handleDamianaWaterOnOven(event) {
    const { player } = event;
    if (!held(player, DAMIANA_WATER_ITEM_ID)) return false;
    event.handled = true;
    teaAction.set(player, "boil");
    startTranscript(api, player, MAN_NEZKETI, PAGE, V_NEZKETI_MAKING_TEA);
    teaAction.delete(player);
    return true;
  }

  function handleBowlOnWater(event) {
    const { player, itemId } = event;
    if (itemId !== BOWL_ITEM_ID) return false;
    event.handled = true;
    player.getInventory().deleteNumber(BOWL_ITEM_ID, 1);
    player.getInventory().adds(BOWL_OF_WATER_ITEM_ID, 1);
    player.sendMessage("You fill the bowl with water.");
    return true;
  }

  function pickDamiana(event) {
    const { player, objectId } = event;
    if (objectId !== DAMIANA_OBJECT_ID) return;
    event.handled = true;
    if (full(player)) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().adds(DAMIANA_LEAVES_ITEM_ID, 1);
    player.sendMessage("You pick some damiana leaves.");
  }

  function searchWorkbench(event) {
    const { player, objectId } = event;
    if (objectId !== WORKBENCH_OBJECT_ID) return;
    event.handled = true;
    if (nailsTaken(player)) {
      player.sendMessage("You have already taken the nails from the workbench.");
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    setNailsTaken(player);
    player.getInventory().adds(IRON_NAILS_ITEM_ID, 20);
    player.sendMessage("You take some iron nails from the workbench.");
  }

  function repairWhetstone(event) {
    const { player, objectId } = event;
    if (objectId !== WHETSTONE_OBJECT_ID) return;
    if (man(player, MAN_ACATZIN) !== 3) return;
    event.handled = true;
    if (!held(player, HAMMER_ITEM_ID)) {
      player.sendMessage("You need a hammer to repair the whetstone.");
      return;
    }
    setMan(player, MAN_ACATZIN, 4);
    player.sendMessage("You fix the blacksmith's whetstone.");
  }

  function repairCart(event) {
    const { player, objectId } = event;
    if (objectId !== CART_OBJECT_ID) return;
    if (man(player, MAN_KAUAYOTL) !== 2) return;
    event.handled = true;
    if (!hasAllCartItems(player)) {
      player.sendMessage("You need two planks, six nails, a hammer and a saw to repair the cart.");
      return;
    }
    player.getInventory().deleteNumber(PLANK_ITEM_ID, 2);
    player.getInventory().deleteNumber(IRON_NAILS_ITEM_ID, 6);
    setMan(player, MAN_KAUAYOTL, 3);
    player.sendMessage("You repair the cart.");
  }

  function useAxeOnWhetstone(event) {
    const { player, itemId, objectId } = event;
    if (objectId !== WHETSTONE_OBJECT_ID || itemId !== DAMAGED_AXE_ITEM_ID) return;
    if (man(player, MAN_ACATZIN) < 4) return;
    event.handled = true;
    player.getInventory().deleteNumber(DAMAGED_AXE_ITEM_ID, 1);
    player.getInventory().adds(FIXED_AXE_ITEM_ID, 1);
    player.sendMessage("You repair Acatzin's axe using the whetstone.");
  }

  /** Search a real egg-pile loc: the first search wakes its guardian. */
  function searchEggPile(event) {
    const { player, objectId } = event;
    const egg = EGG_BY_OBJECT.get(objectId);
    if (!egg) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_PLAN || stage >= STAGE_JUDGED) return;
    event.handled = true;
    let value = eggValue(player, egg);
    if (value === 0 && stage >= STAGE_PLAN) {
      setEgg(player, egg, 1);
      value = 1;
    }
    if (value === 1) {
      startTranscript(api, player, egg.guardianId, PAGE, egg.pileVariant);
      setEgg(player, egg, 2);
      ensureSpawns(player);
      return;
    }
    if (value === 3) {
      startTranscript(api, player, egg.guardianId, PAGE, egg.pileVariant);
      if (full(player)) return;
      player.getInventory().adds(egg.itemId, 1);
    }
  }

  /** Killing a pile guardian opens its egg pile. */
  function handleNpcDeath(event) {
    const { npcId, killer, npc } = event;
    if (!GUARDIAN_IDS.has(npcId) || !killer?.setAttribute) return;
    const egg = EGGS.find((entry) => entry.guardianId === npcId);
    if (!egg) return;
    setEgg(killer, egg, 3);
    const map = trackedNpcs.get(killer);
    if (map) {
      for (const [key, trackedNpc] of map) {
        if (trackedNpc === npc) map.delete(key);
      }
    }
  }

  function handleLogin({ player }) {
    migrate(player);
    // A relog during the egg-fall scene resumes just after it: the egg has fallen.
    if (quest.getStage(player) === STAGE_CONFIRMED) setStage(player, STAGE_EGG_FELL);
    sendStateVarbits(player);
    player.getPacketSender().sendConfig(JIGSAW_PROGRESS_VARP, jigsawMask(player));
    if (quest.getStage(player) === STAGE_FIXING && jigsawComplete(player)) finishJigsaw(player);
    ensureSpawns(player);
    ensureGroundItems(player);
    refreshQuestList(player);
  }

  /** Cancel the egg-fall pre-scene timer and leave no half-open fade on logout/death. */
  function handleTransitionInterrupted({ player } = {}) {
    if (!player) return;
    Scenes.cancel(player);
    if (Scenes.get(player)) {
      Scenes.end(player, true);
      return;
    }
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    player.getPacketSender?.().sendCameraReset?.();
  }

  function handleLogout({ player }) {
    if (!player) return;
    handleTransitionInterrupted({ player });
    removeAllTracked(player);
  }

  /**
   * Version 1 used stages 0..8 for the same route (1 started, 2 inspected, ... 8 complete).
   * Version 2 uses the captured 0..30 scale. Saves without the version marker are v1.
   */
  function migrate(player) {
    if ((Number(player.getAttribute(VERSION_ATTRIBUTE)) || 0) >= VERSION) return;
    const stage = quest.getStage(player);
    const mapped = OLD_STAGE_MAP.get(stage);
    if (mapped !== undefined) quest.setStage(player, mapped);
    player.setAttribute(VERSION_ATTRIBUTE, VERSION);
  }

  function sendStateVarbits(player) {
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    for (const [key, config] of MAN_CONFIG) sender.sendVarbit(config.varbit, man(player, key));
    for (const egg of EGGS) sender.sendVarbit(egg.varbit, eggValue(player, egg));
    sender.sendVarbit(VARBIT_NAILS, nailsTaken(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_EGG_VISIBLE, stage < STAGE_EGG_FELL || stage >= STAGE_FINALE ? 1 : 0);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function manLine(player, key, label) {
    return man(player, key) >= 7
      ? `<str>${label} has gone to the temple.</str>`
      : `${label} still needs my help.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Alan left me to look after his egg while he gathered food,</str>",
        "<str>but it fell from the wall and smashed. I rallied King's men,</str>",
        "<str>gathered replacement eggs and put Alan's egg back together.</str>",
        "<str>Alan finally found himself, then had a great fall of his own.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FIXED) {
      return [
        "<str>I rallied King's men and rebuilt the broken egg.</str>",
        "",
        "I should speak to one of <col=800000>King's men</col> at the temple.",
      ];
    }
    if (stage >= STAGE_FIXING) {
      return [
        "<str>All of the replacement eggs broke, so the only option is to</str>",
        "<str>put Humphrey Dumphrey back together again.</str>",
        "",
        "I should fix the <col=800000>broken egg</col> at the temple.",
      ];
    }
    if (stage >= STAGE_JUDGED) {
      return [
        "<str>I gathered eggs from a large chicken, a red dragon and a jaguar,</str>",
        "<str>but every replacement broke too.</str>",
        "",
        "I should speak to one of <col=800000>King's men</col> at the temple.",
      ];
    }
    if (stage >= STAGE_GIVEN) {
      return [
        "<str>King's men have prepared all three replacement eggs.</str>",
        "",
        "I should speak to one of <col=800000>King's men</col> at the temple.",
      ];
    }
    if (stage >= STAGE_PLAN) {
      return [
        "<str>There is no way to put the broken egg back together, so King's</str>",
        "<str>men want to find a replacement egg to judge.</str>",
        "",
        eggValue(player, EGGS[0]) >= 3 ? "<str>A large chicken egg.</str>" : "A large chicken egg from the farm south of <col=800000>Tal Teok</col>.",
        eggValue(player, EGGS[2]) >= 3 ? "<str>A dragon egg.</str>" : "A dragon egg from the <col=800000>Dragon Nest</col> to the east.",
        eggValue(player, EGGS[1]) >= 3 ? "<str>A jaguar egg.</str>" : "A jaguar egg from the campsite by the mine east of town.",
      ];
    }
    if (stage >= STAGE_GATHERED) {
      return [
        "<str>King's men have all agreed to help.</str>",
        "",
        "I should meet them at the temple of <col=800000>Tal Teok</col>.",
      ];
    }
    if (stage >= STAGE_MEN) {
      return [
        "King asked me to rally her men to help the broken egg:",
        "",
        manLine(player, MAN_ACATZIN, "Acatzin (in the inn)"),
        manLine(player, MAN_NEZKETI, "Nezketi (in the temple south of the inn)"),
        manLine(player, MAN_KAUAYOTL, "Kauayotl (at the eastern entrance)"),
      ];
    }
    if (stage >= STAGE_INSPECTED) {
      return [
        "<str>Alan left me to look after his egg while he gathered food,</str>",
        "<str>but it fell from the wall and smashed.</str>",
        "",
        "I should look for help in <col=800000>Tal Teklan</col>.",
      ];
    }
    if (stage >= STAGE_EGG_FELL) {
      return [
        "<str>Alan left me to look after his egg while he gathered food,</str>",
        "<str>but it fell from the wall and smashed.</str>",
        "",
        "I should inspect the <col=800000>broken egg</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Alan</col> at the",
      "temple of <col=800000>Tal Teok</col>, north of Tal Teklan.",
    ];
  }

  api.persistAttribute(BITS_ATTRIBUTE, 0);
  api.persistAttribute(VERSION_ATTRIBUTE, 0);
  api.persistAttribute(JIGSAW_ATTRIBUTE, 0);
  for (const key of MAN_CONFIG.keys()) {
    api.persistAttribute(stateKey("man", key), 0);
  }
  for (const egg of EGGS) api.persistAttribute(stateKey("egg", egg.key), 0);
  api.persistAttribute(stateKey("misc", "nails"), 0);

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CONSTRUCTION, 5000);
    player.getSkillManager().addExperiences(Skill.COOKING, 5000);
    player.getSkillManager().addExperiences(Skill.SMITHING, 5000);
  }

  quest = registerQuest(api, {
    key: "scrambled",
    name: "Scrambled!",
    varpId: VARP_SCRAMBLED,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 5000, label: "Construction" },
      { skillId: Skill.COOKING.getIndex(), amount: 5000, label: "Cooking" },
      { skillId: Skill.SMITHING.getIndex(), amount: 5000, label: "Smithing" },
    ],
    scrollItemId: PET_EGG_ITEM_ID,
    rewardItemLabel: "An egg (talk to the egg on the wall)",
    otherRewards: ["Alan's bones can be picked up south of the temple"],
    buildJournal,
    onReward: grantReward,
  });

  groundItems = api.getItemOnGroundManager();

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onInterfaceActionClick(handleJigsawTrigger);
  api.onNpcInteraction("Citizen", { "Talk-to": handleCitizenTalk });
  api.onNpcInteraction("Farmer", { "Talk-to": handleCitizenTalk });
  api.onNpcInteraction("Humphrey Dumphrey", { Inspect: inspectEgg, Fix: fixEgg, "Talk-to": petEggTalk });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject("Damiana water", "Oven", handleDamianaWaterOnOven);
  api.onItemOnObject("Damiana water", "Stove", handleDamianaWaterOnOven);
  api.onItemOnObject("Bowl", "Water Pump", handleBowlOnWater);
  api.onItemOnObject("Bowl", "Fountain", handleBowlOnWater);
  api.onItemOnObject(useAxeOnWhetstone);
  api.onObjectInteraction("Damiana", { Pick: pickDamiana });
  api.onObjectInteraction("Workbench", { Search: searchWorkbench });
  api.onObjectInteraction("Broken whetstone", { Repair: repairWhetstone });
  api.onObjectInteraction("Cart", { Repair: repairCart });
  api.onObjectInteraction("Eggs", { Search: searchEggPile });
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(TAL_TEKLAND_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handleTransitionInterrupted);
};
