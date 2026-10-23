/**
 * Defender of Varrock (members).
 *
 * The words come from the "Defender of Varrock" transcript page; this plugin
 * supplies the Elias White variant selector, the start (the transcript's own
 * offer choice, since it has no hook step), the prose-condition answers for the
 * tracking trail and the red-mist gates, the descendant roll and its five
 * candidate conversations, the Sacred Forge imbuing/Dream Theatre and the
 * Dimintheis cutscene that completes the quest.
 *
 * Route cross-check: RuneLite Quest Helper "Defender of Varrock"
 * (Zoinkwiz/quest-helper pinned 06da90f982518a093f2fe1c9cfac5547fa7053d3).
 *
 * Stage (varbit 9655 "dov", in varp 4093 "dov_primary"), cross-checked against
 * the RSProx capture of quest 1636 and Quest Helper's mapping: 2 accepted,
 * 4 Elias follows the player, 6/8/10 tracking trail (the per-clue progress also
 * lives in varbits 9659-9664 "dov_hunting_trail_1-6"), 12 the trapdoor is
 * unlocked only once all six clues are inspected, 14 entered
 * Zemouregal's Base, 16 first balcony watched, 18 bottles available, 20 first
 * gate opened, 22 Arrav cutscene, 24 Arrav conversation over and second bottles
 * available, 26 second gate opened, 28 back at Varrock Palace, 30 Rovin
 * briefed (go to Ramarno), 32 Ramarno asked about the shield, 34 imbued
 * barronite used on the forge, 36 forge dream ended, 38 Varrock invasion vision
 * (captured, non-interactive), 40 Captain Rovin handed over the Shield of
 * Arrav, 42 Reldo points at the scrolls, 44 list of elders found, 46 census
 * read (the candidate conversations can be tried once the list is found),
 * 48 the true descendant found, 50 the shield responds (cutscene), 52 zombie
 * army defeated, 54 Elias departs, 56 complete.
 * The cache's own multilocs agree (the hunting locs gain Inspect at 4/6).
 * The client sends their shadow loc ids 50082-50097; both those and the base
 * 50662-50670 ids are dispatched, with the initial-plant tile disambiguating
 * the shared 50094/50095 pair. The owner-only Elias follows the player at the
 * base landing (3560,4551) until the palace. Schema v3 migrates old stage-12
 * saves that had skipped the last two clues.
 *
 * Source: OSRS Wiki (Defender of Varrock, its Quick guide and
 * Transcript:Defender of Varrock); ids from the cache gameval dump: items
 * 25684/25700/28803-28808, NPCs 12610/12611/12612/12614/12617/5085/4242/
 * 10684-10685/4984/5083/3774/5215/2882/5214/5037/12720-12734, objects
 * 41411/41412 (Sacred Forge), 50082-50097 & 50662-50690 (tracking/base
 * multilocs), 50116/50118 (library), 50140-50142 (trapdoor), 50143 (ladder),
 * 50690 (red mist), 50149/50150 (gates), 50154-50162 (balconies), varbits
 * 9655/9658-9664/9667-9676 in varp 4093.
 *
 * Gaps / approximations:
 * - Elias does not physically follow the player: varbit 9658 is held at 1 while
 *   the trail is followed, and his "while following" conversation is played from
 *   his Jolly Boar spawn;
 * - the red mist is captured object 50690, spawned where an armoured zombie
 *   dies; using an empty bottle on it consumes the object and fills the bottle.
 *   The captured base bottle spawn at 3537,4572 is a normal reusable ground
 *   pickup. Both gates return the three empty bottles on use (capture 1636);
 *   the spawn is re-established after death/relog/base re-entry if missing;
 * - the base is the real (non-instanced) map, so the captured balcony/Arrav
 *   views use their recorded camera positions. The final invasion is chatbox
 *   dialogue but replays all four captured camera cuts at their dialogue
 *   boundaries (capture 1636 ticks 3808/3821/3835/3846), not a full instance;
 * - Curse of Arrav replaces the trapdoor multiloc 50689 with a permanently open
 *   50141 on first login and owns the 50141/50142 interactions (it registered
 *   first), so a DoV player's descent is usually its teleport: handleBaseEnter
 *   (a base-zone hook) then runs the stage transition, and the trapdoor's own
 *   key dialogue (and the grubby-key hand-over) can be skipped. The trapdoor
 *   handler still runs when CoA is absent; pre-quest clicks are refused;
 * - the post-quest Elias variant is his Curse of Arrav desert-camp conversation
 *   and his post-quest NPC lives in that quest, so no DoV Elias is spawned after
 *   completion;
 * - Family Pest is not implemented here, so the "not completed" Dimintheis
 *   branches are always the ones answered;
 * - prerequisites are enforced: 55 Smithing, 52 Hunter, Shield of Arrav with
 *   the Black Arm Gang, Temple of Ikov, Below Ice Mountain, Family Crest,
 *   Garden of Tranquillity, What Lies Below, Romeo & Juliet and Demon Slayer.
 *   Members gating is the quest list's job.
 */
module.exports = function registerDefenderOfVarrockQuest(api) {
  const {
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    MapObjects,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    RegionManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Defender of Varrock";

  // ==========================================================================
  // Varp / varbits / stages
  // ==========================================================================

  const VARP_DOV = 4093; // "dov_primary"
  const VARBIT_DOV = 9655; // "dov", stage bits 0-8

  const VARBIT_ELIAS_VIS = 9658; // "elias_white_vis" placeholder transform
  const VARBIT_TRAIL = [9659, 9660, 9661, 9662, 9663, 9664]; // dov_hunting_trail_1-6
  const VARBIT_READ_CENSUS = 9668; // "dov_read_census"

  const STAGE_STARTED = 2;
  const STAGE_FOLLOWING = 4;
  const STAGE_TRACK_MAX = 12;
  const STAGE_ENTERED_BASE = 14;
  const STAGE_BALCONY_1 = 16;
  const STAGE_FIRST_BOTTLES = 18;
  const STAGE_GATE_1 = 20; // the first gate absorbed the mist
  const STAGE_ARRAV = 22;
  const STAGE_SECOND_BOTTLES = 24;
  const STAGE_BALCONY_2 = 26;
  const STAGE_PALACE = 28;
  const STAGE_BRIEFED = 30;
  const STAGE_RAMARNO = 32;
  const STAGE_FORGE = 34;
  const STAGE_DREAM = 36; // the forge dream has ended
  const STAGE_INVASION = 38; // the captured invasion vision has played
  const STAGE_SHIELD = 40;
  const STAGE_RELDO = 42; // Reldo points you at the scrolls
  const STAGE_LIST = 44; // the elder list is in hand
  const STAGE_CANDIDATES = 46;
  const STAGE_DIMINTHEIS = 48;
  const STAGE_CUTSCENE = 50;
  const STAGE_VICTORY = 52;
  const STAGE_ELIAS_DEPARTS = 54;
  const STAGE_COMPLETE = 56;

  const BITS_ATTRIBUTE = "quest.defender_of_varrock.bits";
  const KEY_ATTRIBUTE = "quest.defender_of_varrock.key";
  const DESCENDANT_ATTRIBUTE = "quest.defender_of_varrock.descendant";
  const SCHEMA_ATTRIBUTE = "defender-of-varrock:schema";
  const SCHEMA_VERSION = 3;

  // Quest Helper's prerequisite quests for Defender of Varrock. Shield of Arrav
  // counts only for the Black Arm Gang route, which is what its own quest stores.
  const REQUIRED_QUESTS = [
    "temple_of_ikov",
    "below_ice_mountain",
    "family_crest",
    "garden_of_tranquillity",
    "what_lies_below",
    "romeo_and_juliet",
    "demon_slayer",
  ];
  const SHIELD_OF_ARRAV_KEY = "shield_of_arrav";
  const SHIELD_GANG_ATTRIBUTE = "shield-of-arrav.gang";
  const BLACK_ARM_GANG = 2;

  const BIT_ENTERED_BASE = 1 << 0;
  const BIT_TRAPDOOR_UNLOCKED = 1 << 7;
  const BIT_GATE_1 = 1 << 1;
  const BIT_GATE_2 = 1 << 2;
  const BIT_BALCONY_1 = 1 << 3;
  const BIT_BALCONY_2 = 1 << 4;
  const BIT_BOTTLES_1 = 1 << 5;

  // ==========================================================================
  // Ids
  // ==========================================================================

  const ELIAS = NpcIdentifiers.ELIAS_WHITE; // 12610, "Elias White" Talk-to
  // 12611 shares the chathead; playing our transcripts on it keeps the shared
  // 12610-scoped Curse of Arrav dialogue handlers out of Defender of Varrock.
  const ELIAS_CHATHEAD = NpcIdentifiers.ELIAS_WHITE_2; // 12611
  const ROVIN = NpcIdentifiers.CAPTAIN_ROVIN; // 5085 (upstairs, 3204,3496,2)
  const RELDO = NpcIdentifiers.RELDO; // 4242 (library, 3209,3495)
  const RAMARNO = NpcIdentifiers.RAMARNO_2; // 10684 (Talk-to + Exchange)
  const RAMARNO_ENTRANCE = NpcIdentifiers.RAMARNO_3; // 10685 (Talk-to)
  const DIMINTHEIS = NpcIdentifiers.DIMINTHEIS; // 4984
  const DIMINTHEIS_CUTSCENE = NpcIdentifiers.DIMINTHEIS_2; // 12629 (chathead)
  const ARRAV_CUTSCENE = NpcIdentifiers.ARRAV; // 12612 (chathead)
  const ZEMOUREGAL_CUTSCENE = NpcIdentifiers.ZEMOUREGAL; // 12614 (chathead)
  const ARMOURED_ZOMBIE = NpcIdentifiers.ARMOURED_ZOMBIE; // 12720 (chathead)

  const ARMOURED_ZOMBIE_IDS = new Set([
    NpcIdentifiers.ARMOURED_ZOMBIE, // 12720
    NpcIdentifiers.ARMOURED_ZOMBIE_2,
    NpcIdentifiers.ARMOURED_ZOMBIE_3,
    NpcIdentifiers.ARMOURED_ZOMBIE_4,
    NpcIdentifiers.ARMOURED_ZOMBIE_5,
    NpcIdentifiers.ARMOURED_ZOMBIE_6,
    NpcIdentifiers.ARMOURED_ZOMBIE_7,
    NpcIdentifiers.ARMOURED_ZOMBIE_8,
    NpcIdentifiers.ARMOURED_ZOMBIE_9,
    NpcIdentifiers.ARMOURED_ZOMBIE_10,
    NpcIdentifiers.ARMOURED_ZOMBIE_11,
    NpcIdentifiers.ARMOURED_ZOMBIE_12,
    NpcIdentifiers.ARMOURED_ZOMBIE_13,
    NpcIdentifiers.ARMOURED_ZOMBIE_14,
    NpcIdentifiers.ARMOURED_ZOMBIE_15, // 12734
  ]);

  const GRUBBY_KEY_ITEM = ItemIdentifiers.GRUBBY_KEY_4; // 28803
  const BOTTLE_ITEM = ItemIdentifiers.BOTTLE; // 28804
  const BOTTLE_OF_MIST_ITEM = ItemIdentifiers.BOTTLE_OF_MIST; // 28805
  const IMBUED_BARRONITE_ITEM = ItemIdentifiers.IMBUED_BARRONITE; // 28806
  const SHIELD_OF_ARRAV_ITEM = ItemIdentifiers.SHIELD_OF_ARRAV; // 28807
  const LIST_OF_ELDERS_ITEM = ItemIdentifiers.LIST_OF_ELDERS; // 28808
  const CHAOS_CORE_ITEM = ItemIdentifiers.CHAOS_CORE; // 25700
  const BARRONITE_DEPOSIT_ITEM = ItemIdentifiers.BARRONITE_DEPOSIT; // 25684

  // Tracking clues are placed as null-named varbit multilocs (50662-50670) that
  // resolve per player to the op/no-op children 50082-50097. No identifiers are
  // generated for the base ids.
  const HUNTING_PLANT_INITIAL = 50662; // "Plant" north of the Jolly Boar Inn
  const HUNTING_SIGN = 50663; // "Wilderness Sign" decoy
  const HUNTING_BOULDER_1 = 50664; // "Rocks"
  const HUNTING_BOULDER_2 = 50665; // "Rocks" decoy
  const HUNTING_TREE_STUMP = 50666; // "Tree stump" decoy
  const HUNTING_BUSH_1 = 50667; // "Bush" by the Silvarea gate
  const HUNTING_BUSH_2 = 50668; // "Bush" further east
  const HUNTING_PLANT_1 = 50669; // "Plant", the one with the grubby key
  const HUNTING_PLANT_2 = 50670; // "Bush" south of the statue
  const HUNTING_BASE_IDS = new Set([
    HUNTING_PLANT_INITIAL,
    HUNTING_SIGN,
    HUNTING_BOULDER_1,
    HUNTING_BOULDER_2,
    HUNTING_TREE_STUMP,
    HUNTING_BUSH_1,
    HUNTING_BUSH_2,
    HUNTING_PLANT_1,
    HUNTING_PLANT_2,
  ]);
  // Shadowed loc ids the client sends for those varbit multilocs. The same
  // planted plant uses 50094/50095 for both the initial plant and the key plant,
  // so the initial tile disambiguates that pair.
  const HUNTING_CHILD_TO_BASE = new Map([
    [50082, HUNTING_SIGN], [50083, HUNTING_SIGN],
    [50084, HUNTING_BOULDER_1], [50085, HUNTING_BOULDER_1],
    [50086, HUNTING_BOULDER_2], [50087, HUNTING_BOULDER_2],
    [50088, HUNTING_TREE_STUMP], [50089, HUNTING_TREE_STUMP],
    [50090, HUNTING_BUSH_1], [50091, HUNTING_BUSH_1],
    [50092, HUNTING_BUSH_2], [50093, HUNTING_BUSH_2],
    [50094, HUNTING_PLANT_1], [50095, HUNTING_PLANT_1],
    [50096, HUNTING_PLANT_2], [50097, HUNTING_PLANT_2],
  ]);
  const HUNTING_CHILD_IDS = new Set(HUNTING_CHILD_TO_BASE.keys());
  const HUNTING_PLANT_INITIAL_TILE = { x: 3280, y: 3516 };
  const HUNTING_DECOY_IDS = new Set([HUNTING_SIGN, HUNTING_BOULDER_2, HUNTING_TREE_STUMP]);
  // The correct order (QuestHelper's walkthrough): plant, rocks, plant (key),
  // bush, bush by the gate, small bush.
  const CLUE_SEQUENCE = [
    HUNTING_PLANT_INITIAL,
    HUNTING_BOULDER_1,
    HUNTING_PLANT_1,
    HUNTING_PLANT_2,
    HUNTING_BUSH_1,
    HUNTING_BUSH_2,
  ];

  const TRAPDOOR_BASE = 50689; // placed multiloc (Curse of Arrav replaces it)
  const TRAPDOOR_OP_IDS = new Set([
    TRAPDOOR_BASE,
    ObjectIdentifiers.TRAPDOOR_99, // 50140
    ObjectIdentifiers.TRAPDOOR_100, // 50141 Open
    ObjectIdentifiers.TRAPDOOR_101, // 50142 Enter
  ]);
  const GATE_1 = ObjectIdentifiers.GATE_290; // 50149 at 3536,4571
  const GATE_2 = ObjectIdentifiers.GATE_291; // 50150 at 3540,4597
  const BALCONY_1_IDS = new Set([ObjectIdentifiers.BALCONY, ObjectIdentifiers.BALCONY_2]); // 50154/50155
  const BALCONY_2_IDS = new Set([ObjectIdentifiers.BALCONY_5, ObjectIdentifiers.BALCONY_6]); // 50159/50160
  const LADDER_EXIT = ObjectIdentifiers.LADDER_445; // 50143 at 3559,4552
  const CENSUS_OBJECT = ObjectIdentifiers.VARROCK_CENSUS; // 50116 at 3214,3497
  const SCROLLS_OBJECT = ObjectIdentifiers.SCROLLS_5; // 50118, registered in the library
  const SACRED_FORGE_MULTI = 41411; // bim_ruins_wallkit_sacred_forge_multi
  const SACRED_FORGE_OBJECT = ObjectIdentifiers.SACRED_FORGE; // 41412 Fuel/Check/Empty
  const RED_MIST_OBJECT = 50690; // spawned where an armoured zombie dies (capture 1636)
  const RED_MIST_PARENT_OBJECT = 50146; // the client-visible parent of 50690
  const RED_MIST_OBJECT_IDS = new Set([RED_MIST_OBJECT, RED_MIST_PARENT_OBJECT]);

  const DOV_OBJECT_IDS = new Set([
    ...HUNTING_BASE_IDS,
    ...HUNTING_CHILD_IDS,
    ...TRAPDOOR_OP_IDS,
    GATE_1,
    GATE_2,
    ...BALCONY_1_IDS,
    ...BALCONY_2_IDS,
    CENSUS_OBJECT,
    SCROLLS_OBJECT,
    ...RED_MIST_OBJECT_IDS,
  ]);

  const TRAPDOOR_TILE = { x: 3343, y: 3515 };
  // Capture 1636: gate 1 is crossed east -> west (3539,4571 -> 3535,4571),
  // gate 2 is crossed west -> east (3535,4597 -> 3544,4598). A later return
  // uses the opposite landing; never force one side.
  const GATE_1_TILE = { x: 3536, y: 4571 };
  const GATE_2_TILE = { x: 3540, y: 4597 };
  const GATE_1_WEST_LANDING = { x: 3535, y: 4571 };
  const GATE_1_EAST_LANDING = { x: 3539, y: 4571 };
  const GATE_2_WEST_LANDING = { x: 3535, y: 4597 };
  const GATE_2_EAST_LANDING = { x: 3544, y: 4598 };
  const BASE_ENTRY_LANDING = { x: 3560, y: 4551 };
  const BASE_EXIT_LANDING = { x: 3345, y: 3514 };
  const BASE_ELIAS_TILE = { x: 3560, y: 4551 };
  // Capture 1636 lines 29589-29596: eight individual Bottle (28804) floor spawns.
  const BOTTLE_SPAWN_TILES = [
    { x: 3534, y: 4595 }, { x: 3531, y: 4600 }, { x: 3542, y: 4569 }, { x: 3540, y: 4569 },
    { x: 3537, y: 4572 }, { x: 3536, y: 4600 }, { x: 3547, y: 4568 }, { x: 3544, y: 4573 },
  ];
  const BASE_ZONE = { minX: 3490, maxX: 3620, minY: 4530, maxY: 4630, levels: [0] };
  const JOLLY_BOAR_ELIAS_TILE = { x: 3283, y: 3501 };
  const PALACE_ELIAS_TILE = { x: 3208, y: 3475 };
  const LIBRARY_SCROLLS_TILE = { x: 3216, y: 3497 };
  const SACRED_FORGE_TILE = { x: 2957, y: 5811 }; // Ruins of Camdozaal

  // Camera positions captured in 1636 for the four scripted views.
  const CAMERA_OPTIONS = { rate: 232, rate2: 100, heightRelative: false };
  const CAMERA_BALCONY_1 = { move: { x: 3563, y: 4570, h: 820 }, look: { x: 3569, y: 4572, h: 100 } };
  const CAMERA_ARRAV = { move: { x: 3526, y: 4566, h: 530 }, look: { x: 3534, y: 4572, h: 330 } };
  const CAMERA_BALCONY_2 = { move: { x: 3561, y: 4592, h: 850 }, look: { x: 3565, y: 4584, h: 170 } };
  const CAMERA_DREAM = { move: { x: 2081, y: 5344, h: 670 }, look: { x: 2081, y: 5358, h: 660 } };
  const CAMERA_INVASION = { move: { x: 3925, y: 4938, h: 490 }, look: { x: 3914, y: 4928, h: 190 } };
  const CAMERA_INVASION_2 = { move: { x: 3924, y: 4946, h: 425 }, look: { x: 3919, y: 4946, h: 300 } };
  const CAMERA_INVASION_3 = { move: { x: 3937, y: 4953, h: 320 }, look: { x: 3933, y: 4950, h: 220 } };
  const CAMERA_INVASION_4 = { move: { x: 3915, y: 4996, h: 520 }, look: { x: 3915, y: 4985, h: 500 } };
  // The four captured cuts play at these dialogue boundaries (capture 1636,
  // ticks 3808/3821/3835/3846; reset at 3858).
  const INVASION_CUTS = [
    { text: "Die, zombie scum!", view: CAMERA_INVASION },
    { text: "Hurrah! Free at last.", view: CAMERA_INVASION_2 },
    { text: "Stay back! I won't let you eat me!", view: CAMERA_INVASION_3 },
    { text: "Zemouregal... The forces... What do we do?", view: CAMERA_INVASION_4 },
  ];

  // ==========================================================================
  // Transcript variants
  // ==========================================================================

  const V_START = "organised-zombies-talking-to-elias-white";
  const V_STARTED_AGAIN = "organised-zombies-talking-to-elias-white-after-starting-the-quest-talking-to-elias-again";
  const V_FOLLOWING = "organised-zombies-talking-to-elias-white-while-he-is-following-the-player";
  const V_FOLLOWING_KEY = "organised-zombies-talking-to-elias-white-while-he-is-following-the-player-after-finding-the-key";
  const V_TRAPDOOR = "organised-zombies-opening-the-trapdoor";
  const V_BASE_ENTER = "the-infamous-necromancer-upon-entering-zemouregal-s-base";
  const V_BASE_ELIAS = "the-infamous-necromancer-talking-to-elias-after-entering-the-dungeon";
  const V_BALCONY_1 = "the-infamous-necromancer-looking-over-the-first-balcony";
  const V_BALCONY_1_DONE = "the-infamous-necromancer-looking-over-the-balcony-after-finishing-the-cutscene";
  const V_BALCONY_2 = "the-infamous-necromancer-looking-over-the-second-balcony";
  const V_GATE = "the-infamous-necromancer-opening-the-first-gate";
  const V_ARRAV = "the-infamous-necromancer-upon-entering-the-first-gate";
  const V_PALACE_ELIAS = "the-sacred-forge-talking-to-elias-white";
  const V_PALACE_ELIAS_AGAIN = "the-sacred-forge-talking-to-elias-white-or-captain-rovin-after-moving-upstairs-talking-to-elias-again";
  const V_ROVIN_AGAIN = "the-sacred-forge-talking-to-elias-white-or-captain-rovin-after-moving-upstairs-talking-to-captain-rovin-again";
  const V_RAMARNO = "the-sacred-forge-talking-to-ramarno";
  const V_RAMARNO_AGAIN = "the-sacred-forge-talking-to-ramarno-talking-to-ramarno-again";
  const V_RAMARNO_IMBUED = "the-sacred-forge-talking-to-ramarno-after-getting-the-imbued-barronite";
  const V_RAMARNO_DONE = "the-sacred-forge-talking-to-ramarno-after-the-cutscene";
  const V_IMBUE = "the-sacred-forge-imbuing-the-barronite";
  const V_DREAM = "the-sacred-forge-inside-the-dream-theatre";
  const V_SHIELD = "the-true-descendant-returning-to-elias-or-rovin";
  const V_SHIELD_AGAIN = "the-true-descendant-returning-to-elias-or-rovin-talking-to-elias-or-rovin-again";
  const V_RELDO = "the-true-descendant-talking-to-reldo";
  const V_RELDO_AGAIN = "the-true-descendant-talking-to-reldo-talking-to-reldo-again";
  const V_RELDO_LIST = "the-true-descendant-talking-to-reldo-after-finding-the-list";
  const V_SCROLLS = "the-true-descendant-searching-the-scrolls";
  const V_ROVIN_LIST = "the-true-descendant-talking-to-elias-or-rovin-after-finding-the-list";
  const V_DIMINTHEIS = "the-true-descendant-talking-to-dimintheis-fitzharmon";
  const V_DIMINTHEIS_CUTSCENE = "the-true-descendant-talking-to-dimintheis-before-completing-the-cutscene";
  const V_ARMY = "the-true-descendant-defeating-the-zombie-army";
  const V_FINISH = "the-true-descendant-talking-to-elias-or-rovin";
  const V_POST_ROVIN = "post-quest-dialogue-captain-rovin";

  const CANDIDATES = {
    aeonisig: { variant: "the-true-descendant-searching-for-the-descendant-talking-to-aeonisig-raispher" },
    prysin: { variant: "the-true-descendant-searching-for-the-descendant-talking-to-enhtor-prysin" },
    horvik: { variant: "the-true-descendant-searching-for-the-descendant-talking-to-horvik-ravitz" },
    romeo: { variant: "the-true-descendant-searching-for-the-descendant-talking-to-romeo-gontamue" },
    haig: { variant: "the-true-descendant-searching-for-the-descendant-talking-to-haig-halen" },
  };
  const CANDIDATE_KEYS = Object.keys(CANDIDATES);
  // Raised when a candidate is asked; none of these by itself advances the quest.
  const CANDIDATE_VARBIT = {
    roald: 9669,
    aeonisig: 9670,
    prysin: 9671,
    horvik: 9672,
    romeo: 9673,
    haig: 9676,
  };
  const ROALD_VARIANT = "the-true-descendant-searching-for-the-descendant-talking-to-roald-remanis";

  // Condition step ids on the page, answered from player state.
  const CONDITION_IDS = new Set([
    "FTHrni", "xBrF47", "vJY99z", "kHTVHb",
    "42fdrZ", "vHD1wW",
    "tAWHOk", "fc_OHv",
    "EhDRp6", "ZMNc1M", "m6VWtf",
    "Zhg91s", "2wRzsx", "OISO0L",
    "ZRUkBI", "ZO3mnK", "x_6_H0", "TbCubA", "wndMT9",
    "sjUxDR", "vLC2pb", "2sNLo-",
    "qdSnbF", "B8haC9", "xyDd-U", "WhsZv7", "AnQkfd",
    "mGcA4h", "DZqAWt", "Cm9iBG", "eyo5lV", "8CsRv3", "1UENq_",
    "SwoZS-", "vGNLNb", "ot05V8", "PKPnSn",
    "VhCg_L", "DkbWkx", "9mJsd9", "QTK2JK",
  ]);

  // Action / message step ids we react to.
  const ACTION_FOLLOW = "SH3bFy"; // "(Elias begins to follow the player.)"
  const ACTION_KEY_TAKEN_BY_ELIAS = "LEtYmg";
  const ACTION_KEY_FOUND = "dNPSQl";
  const ACTION_TRAPDOOR_UNLOCKED_PLAYER = "KgpKon";
  const ACTION_TRAPDOOR_UNLOCKED_ELIAS = "_VAC2e";
  const ACTION_PALACE_UPSTAIRS = "BebI-p";
  const ACTION_DREAM_END = "f7q7yU";
  const ACTION_SHIELD_GIVEN_1 = "dC8HMf";
  const ACTION_SHIELD_GIVEN_2 = "FwITlv";
  const ACTION_SHIELD_GIVEN_3 = "N-7VVK";
  const ACTION_SHIELD_GIVEN_4 = "btrLbe";
  const ACTION_CUTSCENE_1 = "eUroT0";
  const ACTION_CUTSCENE_2 = "8eNIjz";
  const ACTION_ARMY_END = "5CmvoK";
  const ACTION_COMPLETE = "_NZz-1"; // "Congratulations! Quest complete!"
  const ACTION_SCROLLS_FOUND = "jiqhlV";
  const ACTION_SHIELD_PASSED = "eRxQvK";
  const ACTION_ELIAS_DEPARTS = "QJMciX";

  const ACTION_IDS = new Set([
    ACTION_FOLLOW,
    ACTION_KEY_TAKEN_BY_ELIAS,
    ACTION_KEY_FOUND,
    ACTION_TRAPDOOR_UNLOCKED_PLAYER,
    ACTION_TRAPDOOR_UNLOCKED_ELIAS,
    ACTION_PALACE_UPSTAIRS,
    ACTION_DREAM_END,
    ACTION_SHIELD_GIVEN_1,
    ACTION_SHIELD_GIVEN_2,
    ACTION_SHIELD_GIVEN_3,
    ACTION_SHIELD_GIVEN_4,
    ACTION_CUTSCENE_1,
    ACTION_CUTSCENE_2,
    ACTION_ARMY_END,
    ACTION_COMPLETE,
    ACTION_SCROLLS_FOUND,
    ACTION_SHIELD_PASSED,
    ACTION_ELIAS_DEPARTS,
  ]);

  // Dialogue lines whose follow-up the transcript does not spell out as an
  // action step (bottle hand-outs and the Reldo lead).
  const LINE_BALCONY_DONE = "Very well. I'll meet you in the palace";
  const LINE_ARRAV_DONE = "I'm sorry, he calls to me";
  const LINE_RELDO_DONE = "That's perfect! Thanks, Reldo.";

  // ==========================================================================
  // State helpers
  // ==========================================================================

  let quest;
  const eliasByPlayer = new Map();
  const dialogueContext = new WeakMap();
  const mistObjects = new WeakMap();
  const bottleRespawnPending = new WeakSet();
  let worldInstalled = false;

  function stageOf(player) {
    return quest.getStage(player);
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  /** Never rewinds a quest; milestones can be reached out of order. */
  function ensureStage(player, value) {
    if (quest.getStage(player) < value && !quest.isComplete(player)) {
      quest.setStage(player, value);
    }
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function missingRequirements(player) {
    const skills = player.getSkillManager();
    const missing = [];
    if (skills.getMaxLevel(Skill.SMITHING) < 55) missing.push("55 Smithing");
    if (skills.getMaxLevel(Skill.HUNTER) < 52) missing.push("52 Hunter");
    if (!questComplete(player, SHIELD_OF_ARRAV_KEY) || Number(player.getAttribute(SHIELD_GANG_ATTRIBUTE)) !== BLACK_ARM_GANG) {
      missing.push("Shield of Arrav (Black Arm Gang)");
    }
    for (const key of REQUIRED_QUESTS) {
      if (!questComplete(player, key)) missing.push(questName(key));
    }
    return missing;
  }

  function questName(key) {
    return String(key).split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }

  function meetsRequirements(player) {
    return missingRequirements(player).length === 0;
  }

  function sendCamera(player, view) {
    const sender = player.getPacketSender();
    sender.sendCameraMoveTo(view.move.x, view.move.y, view.move.h, CAMERA_OPTIONS);
    sender.sendCameraLookAt(view.look.x, view.look.y, view.look.h, CAMERA_OPTIONS);
  }

  function playScene(player, view, variant, npcId) {
    sendCamera(player, view);
    play(player, npcId, variant);
    afterDialogue(player, () => player.getPacketSender().sendCameraReset());
  }

  function keyHolder(player) {
    return String(player.getAttribute(KEY_ATTRIBUTE) ?? "");
  }

  function setKeyHolder(player, value) {
    player.setAttribute(KEY_ATTRIBUTE, value);
  }

  function trapdoorUnlocked(player) {
    return hasBit(player, BIT_TRAPDOOR_UNLOCKED);
  }

  /** The key must actually be in hand, or Elias must be carrying it. */
  function hasTrapdoorKey(player) {
    const holder = keyHolder(player);
    return (holder === "player" && held(player, GRUBBY_KEY_ITEM)) || holder === "elias";
  }

  function canEnterBase(player) {
    return trapdoorUnlocked(player) || hasTrapdoorKey(player);
  }

  function descendant(player) {
    let value = String(player.getAttribute(DESCENDANT_ATTRIBUTE) ?? "");
    if (!CANDIDATE_KEYS.includes(value)) {
      value = CANDIDATE_KEYS[Math.floor(Math.random() * CANDIDATE_KEYS.length)];
      player.setAttribute(DESCENDANT_ATTRIBUTE, value);
    }
    return value;
  }

  function trailCount(player) {
    let count = 0;
    for (const bit of VARBIT_TRAIL) {
      if (Number(player.getAttribute(`quest.defender_of_varrock.trail.${bit}`)) === 1) count++;
    }
    return count;
  }

  function setTrailBit(player, index) {
    player.setAttribute(`quest.defender_of_varrock.trail.${VARBIT_TRAIL[index]}`, 1);
    player.getPacketSender().sendVarbit(VARBIT_TRAIL[index], 1);
  }

  function sendTrailVarbits(player) {
    const sender = player.getPacketSender();
    for (const bit of VARBIT_TRAIL) {
      sender.sendVarbit(bit, Number(player.getAttribute(`quest.defender_of_varrock.trail.${bit}`)) === 1 ? 1 : 0);
    }
  }

  function inBase(player) {
    const location = player.getLocation();
    return (
      location.getX() >= BASE_ZONE.minX &&
      location.getX() <= BASE_ZONE.maxX &&
      location.getY() >= BASE_ZONE.minY &&
      location.getY() <= BASE_ZONE.maxY
    );
  }

  function nearTile(location, tile, radius = 8) {
    if (!location || !tile) return false;
    return Math.abs(location.getX() - tile.x) <= radius && Math.abs(location.getY() - tile.y) <= radius;
  }

  function objectResolvedId(event) {
    if (typeof event.definition?.getId === "function") return event.definition.getId();
    const resolved = ObjectDefinition.forPlayer(event.objectId, event.player);
    return resolved?.getId?.() ?? event.objectId;
  }

  /** Mirror the player to the first free tile on the far side of an object. */
  function stepAcross(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const step = dx >= 0 ? -1 : 1;
      for (let n = 1; n <= 3; n++) {
        const tile = new Location(location.x + step * n, current.getY(), current.getZ());
        if (!RegionManager.blocked(tile, null)) {
          player.moveTo(tile);
          return true;
        }
      }
      return false;
    }
    const step = dy >= 0 ? -1 : 1;
    for (let n = 1; n <= 3; n++) {
      const tile = new Location(current.getX(), location.y + step * n, current.getZ());
      if (!RegionManager.blocked(tile, null)) {
        player.moveTo(tile);
        return true;
      }
    }
    return false;
  }

  /** Runs `action` once the current chatbox has closed (a tick later). */
  function afterDialogue(player, action) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (player.getDialogueManager?.()?.isActive?.()) {
          afterDialogue(player, action);
          return;
        }
        action();
      })
    );
  }

  function play(player, npcId, variant, select) {
    dialogueContext.set(player, { npcId, variant });
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  // ==========================================================================
  // World install / Elias spawn
  // ==========================================================================

  /** The library scrolls and the Sacred Forge only exist in quest-scoped cache maps,
   * so place a copy of each in the real world: the scrolls by the desks in the
   * Varrock Palace library, the forge at its wiki tile in the Ruins of Camdozaal. */
  function installWorld() {
    if (worldInstalled) return;
    worldInstalled = true;
    installQuestObject(SCROLLS_OBJECT, LIBRARY_SCROLLS_TILE);
    installQuestObject(SACRED_FORGE_OBJECT, SACRED_FORGE_TILE);
  }

  function installQuestObject(objectId, tile) {
    const location = new Location(tile.x, tile.y, 0);
    if (MapObjects.get(objectId, location.clone(), null)) return;
    ObjectManager.register(new GameObject(objectId, location, 10, 0, null), true);
  }

  function desiredEliasTile(stage) {
    if (stage < STAGE_ENTERED_BASE) return JOLLY_BOAR_ELIAS_TILE;
    if (stage < STAGE_PALACE) return BASE_ELIAS_TILE;
    if (stage < STAGE_COMPLETE) return PALACE_ELIAS_TILE;
    return null;
  }

  /** One owner-only Elias, moved between the inn, the palace and nowhere. */
  function syncElias(player) {
    const wanted = desiredEliasTile(stageOf(player));
    const existing = eliasByPlayer.get(player);
    if (existing && (!wanted || !nearTile(existing.getLocation?.(), wanted, 0))) {
      api.removeNpc(existing);
      eliasByPlayer.delete(player);
    }
    if (!wanted || eliasByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: ELIAS,
      x: wanted.x,
      y: wanted.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) eliasByPlayer.set(player, npc);
  }

  /**
   * The earlier stage map used 42 for "list found" and stopped at 34 for the
   * finished dream. Saves without the schema marker are migrated once; values
   * at or above completion are left alone.
   */
  function migrate(player) {
    if (Number(player.getAttribute(SCHEMA_ATTRIBUTE)) >= SCHEMA_VERSION) return;
    if (!quest.isComplete(player)) {
      const stage = quest.getStage(player);
      if (stage === STAGE_FORGE) quest.setStage(player, STAGE_DREAM);
      else if (stage === 42) quest.setStage(player, STAGE_LIST);
      // Saves from the early stage-12 gate had not necessarily inspected the
      // last two clues; keep them moving rather than trapping them on the surface.
      if (stage === STAGE_TRACK_MAX && trailCount(player) < CLUE_SEQUENCE.length) {
        for (let index = 0; index < CLUE_SEQUENCE.length; index++) setTrailBit(player, index);
      }
    }
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
  }

  function handleLogin({ player }) {
    installWorld();
    migrate(player);
    ensureBottleSource(player);
    syncElias(player);
    sendTrailVarbits(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    const npc = eliasByPlayer.get(player);
    if (npc) {
      api.removeNpc(npc);
      eliasByPlayer.delete(player);
    }
    clearMistObjects(player);
    player.getPacketSender().sendCameraReset();
  }

  function handleStageChanged(event) {
    if (event.key !== "defender_of_varrock" || !event.player) return;
    syncElias(event.player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Elias White and I tracked organised zombies from the Jolly Boar</str>",
        "<str>Inn to Zemouregal's Base, where Zemouregal plans to send Arrav</str>",
        "<str>and an undead army against Varrock.</str>",
        "<str>The Sacred Forge showed that only a descendant of Avarrocka's</str>",
        "<str>founder can use Arrav's shield. That descendant was Dimintheis</str>",
        "<str>Fitzharmon, and the shield destroyed the invasion.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SHIELD) {
      return [
        "<str>Elias and I spied on Zemouregal's Base and learnt of the coming</str>",
        "<str>invasion. At the Sacred Forge we saw that only a descendant of</str>",
        "<str>Avarrocka's founder can use Arrav's shield.</str>",
        "",
        "I should search the palace <col=800000>library</col> for the <col=800000>list of elders</col>",
        "and the <col=800000>Varrock Census</col> to find a living descendant.",
      ];
    }
    if (stage >= STAGE_DREAM) {
      return [
        "<str>The Sacred Forge showed me how Arrav's shield was made and the</str>",
        "<str>invasion Zemouregal is preparing. I should report back to</str>",
        "<col=800000>Captain Rovin</col> in Varrock Palace.",
      ];
    }
    if (stage >= STAGE_RAMARNO) {
      return [
        "<str>Elias and I spied on Zemouregal's Base and reported the coming</str>",
        "<str>invasion to Captain Rovin. He sent me to Ramarno in Camdozaal</str>",
        "<str>to ask how Arrav's shield can be used.</str>",
        "",
        "I should make some <col=800000>imbued barronite</col> (a barronite deposit and a",
        "chaos core) and use it on the <col=800000>Sacred Forge</col>.",
      ];
    }
    if (stage >= STAGE_PALACE) {
      return [
        "<str>Elias and I tracked the zombies to Zemouregal's Base and</str>",
        "<str>discovered his invasion plans. I should report back to</str>",
        "<col=800000>Elias White</col> at <col=800000>Varrock Palace</col>.",
      ];
    }
    if (stage >= STAGE_BALCONY_2) {
      return [
        "<str>At Zemouregal's Base I saw Arrav, enslaved against his will, and</str>",
        "<str>Zemouregal's army preparing to march on Varrock.</str>",
        "",
        "I should leave the base and get to <col=800000>Varrock</col> at once.",
      ];
    }
    if (stage >= STAGE_ARRAV) {
      return [
        "<str>At Zemouregal's Base I found Arrav, enslaved against his will,</str>",
        "<str>and learnt that Zemouregal holds his heart.</str>",
        "",
        "I should fill more <col=800000>bottles of mist</col> and go deeper into the base.",
      ];
    }
    if (stage >= STAGE_ENTERED_BASE) {
      return [
        "<str>Elias and I followed the zombie trail to a trapdoor and entered</str>",
        "<str>Zemouregal's Base.</str>",
        "",
        "I should look over the balcony and find out what is going on here.",
      ];
    }
    if (stage >= STAGE_FOLLOWING) {
      return [
        "<str>I agreed to help Elias White investigate sightings of organised</str>",
        "<str>zombies near the Jolly Boar Inn.</str>",
        "",
        "I should inspect the <col=800000>trail</col> the zombies left behind.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I spoke to <col=800000>Elias White</col> at the <col=800000>Jolly Boar Inn</col>. He asked",
        "for my help investigating sightings of organised zombies.",
        "I should speak to him again when I am ready.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Elias White</col> in the",
      "<col=800000>Jolly Boar Inn</col>, north-east of Varrock.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SMITHING, 15000);
    skills.addExperiences(Skill.HUNTER, 15000);
  }

  // ==========================================================================
  // Dialogue variants
  // ==========================================================================

  function selectEliasVariant(player, location) {
    const stage = stageOf(player);
    if (nearTile(location, PALACE_ELIAS_TILE, 8)) {
      if (stage >= STAGE_VICTORY) return V_FINISH;
      if (stage >= STAGE_SHIELD) return V_SHIELD_AGAIN;
      if (stage >= STAGE_BRIEFED) return V_PALACE_ELIAS_AGAIN;
      if (stage >= STAGE_PALACE) return V_PALACE_ELIAS;
      return V_FINISH;
    }
    if (stage < STAGE_STARTED) return V_START;
    if (stage < STAGE_FOLLOWING) return V_STARTED_AGAIN;
    if (stage < STAGE_ENTERED_BASE) {
      return keyHolder(player) === "" ? V_FOLLOWING : V_FOLLOWING_KEY;
    }
    if (stage < STAGE_PALACE) return V_BASE_ELIAS;
    return V_FINISH;
  }

  /** Elias at the Jolly Boar Inn or the palace (never the Curse of Arrav camp). */
  function talkToElias(event) {
    const { player } = event;
    if (event.npcId !== ELIAS && event.npcId !== ELIAS_CHATHEAD) return false;
    if (!player || quest.isComplete(player)) return false;
    const location = event.npc?.getLocation?.();
    const mine = nearTile(location, JOLLY_BOAR_ELIAS_TILE, 8) || nearTile(location, PALACE_ELIAS_TILE, 8);
    if (!mine) return false;
    play(player, ELIAS_CHATHEAD, selectEliasVariant(player, location));
    return true;
  }

  function talkToRovin(event) {
    const { player } = event;
    if (event.npcId !== ROVIN || !player) return false;
    if (quest.isComplete(player)) {
      play(player, ROVIN, V_POST_ROVIN);
      return true;
    }
    if (!questActive(player)) return false;
    const stage = stageOf(player);
    if (stage >= STAGE_VICTORY) {
      play(player, ROVIN, V_FINISH);
      return true;
    }
    if (stage >= STAGE_LIST) {
      play(player, ROVIN, V_ROVIN_LIST);
      return true;
    }
    if (stage >= STAGE_SHIELD) {
      play(player, ROVIN, V_SHIELD_AGAIN);
      return true;
    }
    if (stage >= STAGE_FORGE) {
      // The captured route plays its non-interactive invasion vision before
      // Rovin hands the shield over.
      if (held(player, SHIELD_OF_ARRAV_ITEM)) ensureStage(player, STAGE_SHIELD);
      else ensureStage(player, STAGE_INVASION);
      play(player, ROVIN, V_SHIELD);
      return true;
    }
    if (stage >= STAGE_PALACE) {
      play(player, ROVIN, V_ROVIN_AGAIN);
      return true;
    }
    return false;
  }

  function talkToReldo(event) {
    const { player } = event;
    if ((event.npcId !== RELDO && event.npcId !== NpcIdentifiers.RELDO_3) || !player) return false;
    if (!questActive(player)) return false;
    const stage = stageOf(player);
    if (stage >= STAGE_LIST && stage < STAGE_CANDIDATES) {
      play(player, event.npcId, V_RELDO_AGAIN);
      return true;
    }
    if (stage >= STAGE_CANDIDATES && stage < STAGE_COMPLETE) {
      play(player, event.npcId, V_RELDO_LIST);
      return true;
    }
    if (stage >= STAGE_SHIELD) {
      play(player, event.npcId, V_RELDO);
      return true;
    }
    return false;
  }

  function talkToRamarno(event) {
    const { player } = event;
    if ((event.npcId !== RAMARNO && event.npcId !== RAMARNO_ENTRANCE) || !player) return false;
    if (!questActive(player)) return false;
    const stage = stageOf(player);
    if (stage >= STAGE_FORGE && stage < STAGE_SHIELD) {
      play(player, event.npcId, V_RAMARNO_DONE);
      return true;
    }
    if (stage >= STAGE_RAMARNO) {
      if (held(player, IMBUED_BARRONITE_ITEM)) {
        play(player, event.npcId, V_RAMARNO_IMBUED);
        return true;
      }
      play(player, event.npcId, V_RAMARNO_AGAIN);
      return true;
    }
    if (stage >= STAGE_BRIEFED) {
      play(player, event.npcId, V_RAMARNO);
      return true;
    }
    return false;
  }

  function talkToDimintheis(event) {
    const { player } = event;
    if ((event.npcId !== DIMINTHEIS && event.npcId !== DIMINTHEIS_CUTSCENE) || !player) return false;
    if (!questActive(player)) return false;
    const stage = stageOf(player);
    if (stage >= STAGE_CUTSCENE && stage < STAGE_COMPLETE) {
      play(player, event.npcId, V_DIMINTHEIS_CUTSCENE);
      return true;
    }
    if (stage >= STAGE_DIMINTHEIS) {
      play(player, event.npcId, V_DIMINTHEIS);
      return true;
    }
    return false;
  }

  /** The descendant candidates share one handler; only the rolled one advances. */
  function talkToCandidate(event, key) {
    const { player } = event;
    if (!player || !questActive(player)) return false;
    const stage = stageOf(player);
    if (stage < STAGE_LIST || stage >= STAGE_DIMINTHEIS) return false;
    const candidate = CANDIDATES[key];
    player.getPacketSender().sendVarbit(CANDIDATE_VARBIT[key], 1);
    if (descendant(player) === key) ensureStage(player, STAGE_DIMINTHEIS);
    play(player, event.npcId, candidate.variant);
    return true;
  }

  function talkToRoald(event) {
    const { player } = event;
    if (!player || !questActive(player)) return false;
    const stage = stageOf(player);
    if (stage < STAGE_LIST || stage >= STAGE_DIMINTHEIS) return false;
    player.getPacketSender().sendVarbit(CANDIDATE_VARBIT.roald, 1);
    play(player, event.npcId, ROALD_VARIANT);
    return true;
  }

  function talkToPrysin(event) {
    return talkToCandidate(event, "prysin");
  }

  function talkToAeonisig(event) {
    return talkToCandidate(event, "aeonisig");
  }

  function talkToHorvik(event) {
    return talkToCandidate(event, "horvik");
  }

  function talkToRomeo(event) {
    return talkToCandidate(event, "romeo");
  }

  function talkToHaig(event) {
    return talkToCandidate(event, "haig");
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!player || !CONDITION_IDS.has(stepId)) return null;
    switch (stepId) {
      // The Uzer Oasis meeting with Elias is the Curse of Arrav prologue.
      case "FTHrni":
      case "vJY99z":
        return true;
      case "xBrF47":
      case "kHTVHb":
        return false;
      case "42fdrZ":
        return !meetsRequirements(player);
      case "vHD1wW":
        return meetsRequirements(player);
      case "tAWHOk":
        return freeSlots(player) < 1;
      case "fc_OHv":
        return freeSlots(player) >= 1;
      case "EhDRp6":
        return keyHolder(player) === "player" && held(player, GRUBBY_KEY_ITEM);
      case "ZMNc1M":
        return keyHolder(player) === "elias";
      case "m6VWtf":
        return keyHolder(player) === "elias";
      case "Zhg91s":
        return !held(player, BOTTLE_OF_MIST_ITEM);
      case "2wRzsx":
        return player.getInventory().getAmount(BOTTLE_OF_MIST_ITEM) < 3;
      case "OISO0L":
        return player.getInventory().getAmount(BOTTLE_OF_MIST_ITEM) >= 3;
      // The Shield of Arrav hand-outs.
      case "ZRUkBI":
      case "x_6_H0":
      case "sjUxDR":
      case "xyDd-U":
        return !held(player, SHIELD_OF_ARRAV_ITEM);
      case "ZO3mnK":
      case "TbCubA":
      case "vLC2pb":
      case "WhsZv7":
      case "B8haC9":
        return freeSlots(player) < 1;
      case "wndMT9":
      case "2sNLo-":
      case "AnQkfd":
        return held(player, SHIELD_OF_ARRAV_ITEM);
      case "qdSnbF":
        return held(player, LIST_OF_ELDERS_ITEM);
      // The descendant candidates; one of them was rolled per player.
      case "mGcA4h":
        return descendant(player) !== "prysin";
      case "DZqAWt":
        return descendant(player) === "prysin";
      case "Cm9iBG":
        return descendant(player) !== "aeonisig";
      case "eyo5lV":
        return descendant(player) === "aeonisig";
      case "8CsRv3":
        return descendant(player) !== "horvik";
      case "1UENq_":
        return descendant(player) === "horvik";
      case "SwoZS-":
        return descendant(player) !== "haig";
      case "vGNLNb":
        return descendant(player) === "haig";
      case "ot05V8":
        return descendant(player) !== "romeo";
      case "PKPnSn":
        return descendant(player) === "romeo";
      // Family Pest is not implemented: the "not completed" branches always play.
      case "VhCg_L":
      case "9mJsd9":
        return true;
      case "DkbWkx":
      case "QTK2JK":
        return false;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Hooks, choices, lines and actions
  // ==========================================================================

  function handleDialogueChoice(event) {
    const { player, option } = event;
    const context = player ? dialogueContext.get(player) : null;
    if (!context) return;
    // The transcript has no hook step for the start, so its offer menu is the
    // acceptance point. Roll the hidden descendant here, as the hook would.
    if (context.variant === V_START && String(option) === "Yes." && stageOf(player) === 0) {
      const missing = missingRequirements(player);
      if (missing.length > 0) {
        player.sendMessage(`You need ${missing.join(", ")} to start Defender of Varrock.`);
        return;
      }
      descendant(player);
      player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
      quest.setStage(player, STAGE_STARTED);
    }
    if (context.variant === V_TRAPDOOR) {
      dialogueContext.delete(player);
      if (!String(option).startsWith("Let's do it")) return;
      if (!canEnterBase(player)) {
        player.sendMessage("You need the grubby key before you can enter the trapdoor.");
        return;
      }
      descendToBase(player);
      return;
    }
    // The stage-2 re-talk has no action step of its own; its "Let's get going."
    // choice is the same as accepting the quest's initial follow action.
    if (context.variant === V_STARTED_AGAIN && String(option).startsWith("Let's get going")) {
      handleDialogueAction({ player, stepId: ACTION_FOLLOW });
      return;
    }
    // Ramarno's shield branch has no action step; accept it when chosen.
    if (context.variant === V_RAMARNO && String(option) === "I need your help with a shield.") {
      ensureStage(player, STAGE_RAMARNO);
    }
  }

  function handleDialogueLine(event) {
    const { player, text } = event;
    if (!player) return;
    const value = String(text ?? "");
    if (dialogueContext.get(player)?.variant === V_ARMY) {
      const cut = INVASION_CUTS.find((entry) => value.startsWith(entry.text));
      if (cut) event.before = () => sendCamera(player, cut.view);
    }
    if (value.startsWith(LINE_BALCONY_DONE)) {
      if (stageOf(player) < STAGE_FIRST_BOTTLES) {
        ensureStage(player, STAGE_FIRST_BOTTLES);
        giveBottles(player, BIT_BOTTLES_1);
        player.getPacketSender().sendVarbit(VARBIT_ELIAS_VIS, 3);
      }
      return;
    }
    if (value.startsWith(LINE_ARRAV_DONE)) {
      if (stageOf(player) >= STAGE_ARRAV && stageOf(player) < STAGE_SECOND_BOTTLES) {
        ensureStage(player, STAGE_SECOND_BOTTLES);
        ensureBottleSource(player);
      }
      return;
    }
    if (value.startsWith(LINE_RELDO_DONE)) {
      ensureStage(player, STAGE_RELDO);
      return;
    }
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId || !ACTION_IDS.has(stepId)) return;
    switch (stepId) {
      case ACTION_FOLLOW:
        ensureStage(player, STAGE_FOLLOWING);
        player.getPacketSender().sendVarbit(VARBIT_ELIAS_VIS, 1);
        return;
      case ACTION_KEY_FOUND:
        if (!held(player, GRUBBY_KEY_ITEM) && keyHolder(player) !== "elias") {
          player.getInventory().adds(GRUBBY_KEY_ITEM, 1);
          setKeyHolder(player, "player");
        }
        return;
      case ACTION_KEY_TAKEN_BY_ELIAS:
        setKeyHolder(player, "elias");
        return;
      case ACTION_TRAPDOOR_UNLOCKED_PLAYER:
      case ACTION_TRAPDOOR_UNLOCKED_ELIAS:
        setBit(player, BIT_TRAPDOOR_UNLOCKED);
        if (keyHolder(player) === "player" && held(player, GRUBBY_KEY_ITEM)) {
          player.getInventory().deleteNumber(GRUBBY_KEY_ITEM, 1);
        }
        return;
      case ACTION_PALACE_UPSTAIRS:
        ensureStage(player, STAGE_BRIEFED);
        return;
      case ACTION_DREAM_END:
        ensureStage(player, STAGE_DREAM);
        player.getPacketSender().sendCameraReset();
        return;
      case ACTION_SHIELD_GIVEN_1:
      case ACTION_SHIELD_GIVEN_2:
      case ACTION_SHIELD_GIVEN_3:
      case ACTION_SHIELD_GIVEN_4:
        if (!held(player, SHIELD_OF_ARRAV_ITEM)) player.getInventory().adds(SHIELD_OF_ARRAV_ITEM, 1);
        ensureStage(player, STAGE_SHIELD);
        return;
      case ACTION_CUTSCENE_1:
      case ACTION_CUTSCENE_2:
        ensureStage(player, STAGE_CUTSCENE);
        afterDialogue(player, () => {
          if (player.isRegistered?.() === false || !questActive(player)) return;
          play(player, ZEMOUREGAL_CUTSCENE, V_ARMY);
        });
        return;
      case ACTION_ARMY_END:
        ensureStage(player, STAGE_VICTORY);
        player.getPacketSender().sendCameraReset();
        return;
      case ACTION_SHIELD_PASSED:
        if (held(player, SHIELD_OF_ARRAV_ITEM)) player.getInventory().deleteNumber(SHIELD_OF_ARRAV_ITEM, 1);
        return;
      case ACTION_ELIAS_DEPARTS:
        ensureStage(player, STAGE_ELIAS_DEPARTS);
        return;
      case ACTION_COMPLETE:
        event.handled = true;
        event.end = true;
        player.getPacketSender().sendCameraReset();
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case ACTION_SCROLLS_FOUND:
        if (!held(player, LIST_OF_ELDERS_ITEM) && freeSlots(player) >= 1) {
          player.getInventory().adds(LIST_OF_ELDERS_ITEM, 1);
        }
        ensureStage(player, STAGE_LIST);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Tracking trail
  // ==========================================================================

  /** Resolve a clicked shadow loc back to the base varbit multiloc. */
  function huntingBaseId(event) {
    const mapped = HUNTING_CHILD_TO_BASE.get(event.objectId);
    if (!mapped) return event.objectId;
    const at = event.location;
    if (mapped === HUNTING_PLANT_1 && at?.x === HUNTING_PLANT_INITIAL_TILE.x && at?.y === HUNTING_PLANT_INITIAL_TILE.y) {
      return HUNTING_PLANT_INITIAL;
    }
    return mapped;
  }

  function handleHunting(event) {
    const { player } = event;
    if (!questActive(player)) return;
    event.handled = true;
    if (stageOf(player) < STAGE_FOLLOWING) return;
    const clue = huntingBaseId(event);
    const index = trailCount(player);
    // Recovery: the key plant can be searched again if the key was dropped or a
    // migrated stage-12 save never kept it. This hands over the key, not a stage.
    if (clue === HUNTING_PLANT_1 && index >= 3 && !trapdoorUnlocked(player) &&
        keyHolder(player) !== "elias" && !held(player, GRUBBY_KEY_ITEM)) {
      play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-the-plant-with-the-grubby-key");
      return;
    }
    if (HUNTING_DECOY_IDS.has(clue)) {
      play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-any-incorrect-clue");
      return;
    }
    if (index >= CLUE_SEQUENCE.length || clue !== CLUE_SEQUENCE[index]) {
      play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-any-incorrect-clue");
      return;
    }
    setTrailBit(player, index);
    // The capture only reaches stage 8 after the fourth clue and 10 after the
    // sixth; stage 12 is the trapdoor unlock, so it is granted there.
    ensureStage(player, index === CLUE_SEQUENCE.length - 1
      ? STAGE_TRACK_MAX - 2
      : STAGE_FOLLOWING + (index >= 3 ? 4 : 2));
    if (index === 0) {
      play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-the-plant-north-of-the-jolly-boar-inn");
      return;
    }
    if (index === 1) {
      play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-correct-rocks");
      return;
    }
    if (index === 2) {
      play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-the-plant-with-the-grubby-key");
      return;
    }
    play(player, ELIAS_CHATHEAD, "organised-zombies-inspecting-the-correct-bush");
  }

  // ==========================================================================
  // Trapdoor and the base
  // ==========================================================================

  function descendToBase(player) {
    player.moveTo(new Location(BASE_ENTRY_LANDING.x, BASE_ENTRY_LANDING.y, 0));
    player.getPacketSender().sendVarbit(VARBIT_ELIAS_VIS, 2);
    if (!hasBit(player, BIT_ENTERED_BASE)) {
      setBit(player, BIT_ENTERED_BASE);
      setBit(player, BIT_TRAPDOOR_UNLOCKED);
      ensureStage(player, STAGE_ENTERED_BASE);
      afterDialogue(player, () => {
        if (player.isRegistered?.() === false || !questActive(player)) return;
        play(player, ELIAS_CHATHEAD, V_BASE_ENTER);
      });
      return;
    }
    ensureStage(player, STAGE_ENTERED_BASE);
  }

  function handleTrapdoor(event) {
    const { player } = event;
    const location = event.location;
    if (!location || location.x !== TRAPDOOR_TILE.x || location.y !== TRAPDOOR_TILE.y) return;
    event.handled = true;
    if (!questActive(player)) return;
    if (stageOf(player) >= STAGE_ENTERED_BASE) {
      descendToBase(player);
      return;
    }
    if (trailCount(player) < CLUE_SEQUENCE.length) {
      player.sendMessage("You don't have any reason to go down there yet.");
      return;
    }
    ensureStage(player, STAGE_TRACK_MAX);
    if (trapdoorUnlocked(player)) {
      descendToBase(player);
      return;
    }
    if (!hasTrapdoorKey(player)) {
      player.sendMessage("You need the grubby key. Search the plant where you found it.");
      return;
    }
    play(player, ELIAS_CHATHEAD, V_TRAPDOOR);
  }

  /**
   * Curse of Arrav owns the trapdoor object (it replaces the 50689 multiloc with
   * a permanently open 50141 when it installs its world), so a Defender of
   * Varrock player's first descent can land here instead of in handleTrapdoor.
   */
  function handleBaseEnter({ player }) {
    if (!player) return;
    ensureBottleSource(player);
    if (!questActive(player) || hasBit(player, BIT_ENTERED_BASE)) return;
    // Curse of Arrav owns the placed trapdoor and can teleport first. Validate the
    // Defender trail and the real key here too, so a lost key cannot bypass entry.
    if (stageOf(player) < STAGE_TRACK_MAX) {
      if (trailCount(player) < CLUE_SEQUENCE.length) return;
      ensureStage(player, STAGE_TRACK_MAX);
    }
    if (!canEnterBase(player)) return;
    descendToBase(player);
  }

  function crossGate(player, gate2) {
    const gate = gate2 ? GATE_2_TILE : GATE_1_TILE;
    const west = player.getLocation().getX() < gate.x;
    const landing = gate2
      ? (west ? GATE_2_EAST_LANDING : GATE_2_WEST_LANDING)
      : (west ? GATE_1_EAST_LANDING : GATE_1_WEST_LANDING);
    player.moveTo(new Location(landing.x, landing.y, 0));
  }

  function handleGate(event) {
    const { player, objectId } = event;
    if (!player) return;
    const location = event.location;
    if (objectId !== GATE_1 && objectId !== GATE_2) return;
    event.handled = true;
    if (!questActive(player)) return;
    const gate2 = objectId === GATE_2;
    const stage = stageOf(player);
    if (gate2 ? stage < STAGE_SECOND_BOTTLES : stage < STAGE_FIRST_BOTTLES) {
      play(player, ELIAS_CHATHEAD, V_GATE);
      return;
    }
    const passedBit = gate2 ? BIT_GATE_2 : BIT_GATE_1;
    if (!hasBit(player, passedBit)) {
      if (player.getInventory().getAmount(BOTTLE_OF_MIST_ITEM) < 3) {
        play(player, ELIAS_CHATHEAD, V_GATE);
        return;
      }
      setBit(player, passedBit);
      // Play first: the transcript's mist conditions read the bottles synchronously.
      play(player, ELIAS_CHATHEAD, V_GATE);
      player.getInventory().deleteNumber(BOTTLE_OF_MIST_ITEM, 3);
      // Capture 1636: both gates return the three empty bottles to the inventory.
      player.getInventory().adds(BOTTLE_ITEM, 3);
      afterDialogue(player, () => {
        if (player.isRegistered?.() === false || !questActive(player)) return;
        crossGate(player, gate2);
        if (gate2) {
          ensureStage(player, STAGE_BALCONY_2);
          ensureBottleSource(player);
          return;
        }
        ensureStage(player, STAGE_GATE_1);
        // The transcript emits its lines while it is built, so Arrav must be the
        // current stage before V_ARRAV plays or the second-bottle line is missed.
        ensureStage(player, STAGE_ARRAV);
        playScene(player, CAMERA_ARRAV, V_ARRAV, ARRAV_CUTSCENE);
      });
      return;
    }
    crossGate(player, gate2);
  }

  /**
   * Doors.plugin.js matches the gates by name ("Gate"/Open) and asks via door:toggle
   * before toggling, so the mist cost and cutscene have to run from here. The object
   * hook above stays as a fallback for when the Doors plugin is absent.
   */
  function claimGateToggle(request) {
    if (request.handled) return;
    const { objectId } = request;
    if (objectId !== GATE_1 && objectId !== GATE_2) return;
    request.handled = true;
    handleGate(request);
  }

  function handleBalcony(event) {
    const { player, objectId } = event;
    if (!player || !inBase(player)) return;
    if (BALCONY_1_IDS.has(objectId)) {
      event.handled = true;
      if (!questActive(player) || stageOf(player) < STAGE_ENTERED_BASE) return;
      if (hasBit(player, BIT_BALCONY_1)) {
        play(player, ZEMOUREGAL_CUTSCENE, V_BALCONY_1_DONE);
        return;
      }
      setBit(player, BIT_BALCONY_1);
      ensureStage(player, STAGE_BALCONY_1);
      playScene(player, CAMERA_BALCONY_1, V_BALCONY_1, ZEMOUREGAL_CUTSCENE);
      return;
    }
    if (BALCONY_2_IDS.has(objectId)) {
      event.handled = true;
      // The second balcony is past the second gate; the first balcony must not
      // stand in for it.
      if (!questActive(player) || stageOf(player) < STAGE_SECOND_BOTTLES) return;
      setBit(player, BIT_BALCONY_2);
      ensureStage(player, STAGE_BALCONY_2);
      playScene(player, CAMERA_BALCONY_2, V_BALCONY_2, ZEMOUREGAL_CUTSCENE);
    }
  }

  /** The captured base bottle pickups are normal reusable floor spawns. */
  function bottleRecoveryActive(player) {
    return questActive(player) && stageOf(player) >= STAGE_FIRST_BOTTLES &&
      !hasBit(player, BIT_GATE_2) && stageOf(player) < STAGE_BALCONY_2;
  }

  function ownBottleSources(player) {
    return (api.getWorld?.()?.getItems?.() ?? []).filter((item) =>
      !item.isPendingRemoval?.() && item.getOwner?.() === player.getUsername() && item.getItem?.()?.getId?.() === BOTTLE_ITEM);
  }

  /**
   * Capture 1636 spawns eight normal single Bottle (28804) floor items. Keep any
   * missing ones present while a gate still needs bottles; they are static,
   * owner-only pickups, not an inventory grant or a total-owned cap.
   */
  function ensureBottleSource(player) {
    if (!bottleRecoveryActive(player) || bottleRespawnPending.has(player)) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager) return;
    const present = new Set(ownBottleSources(player).map((item) => {
      const at = item.getPosition?.();
      return `${at?.getX?.()},${at?.getY?.()}`;
    }));
    if (present.size > 0) return; // respawning missing ones is the 4-tick task's job
    for (const spawn of BOTTLE_SPAWN_TILES) {
      const ground = manager.registerLocation(player, new Item(BOTTLE_ITEM, 1), new Location(spawn.x, spawn.y, 0));
      if (ground) {
        ground.staticSpawn = true;
        ground.respawnTimer = 4; // capture 1636: picked bottle returns after four ticks
      }
    }
  }

  /** Lifecycle only seeds missing sources; the 4-tick ground respawn handles pickups. */
  function handleBottlePickup(event) {
    const { player, groundItemId, location } = event;
    if (!player || groundItemId !== BOTTLE_ITEM) return;
    if (!BOTTLE_SPAWN_TILES.some((spawn) => spawn.x === location?.x && spawn.y === location?.y)) return;
    bottleRespawnPending.add(player);
    const { CountdownTask, TaskManager } = api.core;
    if (CountdownTask && TaskManager) {
      TaskManager.submit(new CountdownTask(player, 4, () => bottleRespawnPending.delete(player)));
    } else {
      setTimeout(() => bottleRespawnPending.delete(player), 2400);
    }
  }

  function giveBottles(player, bit) {
    if (hasBit(player, bit)) return;
    setBit(player, bit);
    ensureBottleSource(player);
  }

  function handleNpcDeath(event) {
    const { npcId, killer, npc } = event;
    if (!ARMOURED_ZOMBIE_IDS.has(npcId)) return;
    const player = killer?.isPlayer?.() ? killer : null;
    if (!player || !questActive(player) || !inBase(player)) return;
    const stage = stageOf(player);
    if (stage < STAGE_FIRST_BOTTLES || stage >= STAGE_BALCONY_2) return;
    const at = npc?.getLocation?.() ?? player.getLocation();
    const object = new GameObject(RED_MIST_OBJECT, new Location(at.getX(), at.getY(), at.getZ()), 10, 3, null);
    ObjectManager.register(object, true);
    const spawned = mistObjects.get(player) ?? [];
    spawned.push(object);
    mistObjects.set(player, spawned);
    player.sendMessage("A strange red mist rises from the dying zombie.");
  }

  function clearMistObjects(player) {
    for (const object of mistObjects.get(player) ?? []) ObjectManager.deregister(object, true);
    mistObjects.delete(player);
  }

  function takeMistObject(player, object) {
    const spawned = mistObjects.get(player) ?? [];
    const index = spawned.indexOf(object);
    if (index >= 0) spawned.splice(index, 1);
  }

  function fillBottleFromMist(player, object) {
    if (!questActive(player)) return false;
    const stage = stageOf(player);
    if (stage < STAGE_FIRST_BOTTLES || stage >= STAGE_BALCONY_2) return false;
    if (!held(player, BOTTLE_ITEM)) {
      player.sendMessage("You need an empty bottle to collect the mist.");
      return true;
    }
    if (player.getInventory().getAmount(BOTTLE_OF_MIST_ITEM) >= 3) {
      player.sendMessage("You already have enough bottles of mist.");
      return true;
    }
    player.getInventory().deleteNumber(BOTTLE_ITEM, 1);
    player.getInventory().adds(BOTTLE_OF_MIST_ITEM, 1);
    ObjectManager.deregister(object, true);
    takeMistObject(player, object);
    player.sendMessage("You fill the bottle with mist.");
    return true;
  }

  /** The base exit ladder; Ladders asks owners before guessing a destination. */
  function handleClimbRequest(request) {
    if (request.objectId !== LADDER_EXIT) return;
    request.handled = true;
    if (!request.player) return;
    api.emitCustomEvent("ladders:climbUp", {
      player: request.player,
      destination: new Location(BASE_EXIT_LANDING.x, BASE_EXIT_LANDING.y, 0),
    });
    // Only the second-balcony look-over moves the quest on; an early exit just
    // returns the player to the surface, where the trapdoor lets them back in.
    if (questActive(request.player) && stageOf(request.player) >= STAGE_BALCONY_2) {
      ensureStage(request.player, STAGE_PALACE);
    }
  }

  // ==========================================================================
  // Library, forge and objects
  // ==========================================================================

  function handleCensus(event) {
    const { player } = event;
    if (!player) return;
    event.handled = true;
    if (!questActive(player)) return;
    player.getPacketSender().sendVarbit(VARBIT_READ_CENSUS, 1);
    if (stageOf(player) >= STAGE_LIST) ensureStage(player, STAGE_CANDIDATES);
  }

  function handleScrolls(event) {
    const { player } = event;
    if (!player) return;
    event.handled = true;
    if (!questActive(player) || stageOf(player) < STAGE_SHIELD) return;
    play(player, RELDO, V_SCROLLS);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || !DOV_OBJECT_IDS.has(objectId)) return;
    if (HUNTING_BASE_IDS.has(objectId) || HUNTING_CHILD_IDS.has(objectId)) return handleHunting(event);
    if (TRAPDOOR_OP_IDS.has(objectId)) return handleTrapdoor(event);
    if (objectId === GATE_1 || objectId === GATE_2) return handleGate(event);
    if (BALCONY_1_IDS.has(objectId) || BALCONY_2_IDS.has(objectId)) return handleBalcony(event);
    if (objectId === CENSUS_OBJECT) return handleCensus(event);
    if (objectId === SCROLLS_OBJECT) return handleScrolls(event);
    if (RED_MIST_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      fillBottleFromMist(player, event.object ?? null);
    }
  }

  // Testing note: a modal interface (e.g. 90, opened by ::quest) swallows object and
  // item clicks client-side, so close it before using the barronite on the forge.
  function handleItemOnObject(event) {
    const { player, itemId } = event;
    if (!player) return;
    if (RED_MIST_OBJECT_IDS.has(event.objectId)) {
      event.handled = true;
      if (itemId === BOTTLE_ITEM) fillBottleFromMist(player, event.object ?? null);
      return;
    }
    if (itemId !== IMBUED_BARRONITE_ITEM) return;
    const resolved = objectResolvedId(event);
    if (resolved !== SACRED_FORGE_OBJECT && event.objectId !== SACRED_FORGE_MULTI) return;
    event.handled = true;
    if (!questActive(player) || stageOf(player) < STAGE_RAMARNO) return;
    player.getInventory().deleteNumber(IMBUED_BARRONITE_ITEM, 1);
    ensureStage(player, STAGE_FORGE);
    playScene(player, CAMERA_DREAM, V_DREAM, ARRAV_CUTSCENE);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(CHAOS_CORE_ITEM) || !pair.has(BARRONITE_DEPOSIT_ITEM)) return;
    event.handled = true;
    if (!questActive(player) || stageOf(player) < STAGE_RAMARNO) return;
    if (held(player, IMBUED_BARRONITE_ITEM)) return;
    player.getInventory().deleteNumber(CHAOS_CORE_ITEM, 1);
    player.getInventory().deleteNumber(BARRONITE_DEPOSIT_ITEM, 1);
    player.getInventory().adds(IMBUED_BARRONITE_ITEM, 1);
    play(player, RAMARNO, V_IMBUE);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(KEY_ATTRIBUTE);
  api.persistAttribute(DESCENDANT_ATTRIBUTE);
  api.persistAttribute(SCHEMA_ATTRIBUTE, 0);
  for (const bit of VARBIT_TRAIL) api.persistAttribute(`quest.defender_of_varrock.trail.${bit}`);

  quest = registerQuest(api, {
    key: "defender_of_varrock",
    name: "Defender of Varrock",
    varpId: VARP_DOV,
    varbitId: VARBIT_DOV,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.SMITHING.getIndex(), amount: 15000, label: "Smithing" },
      { skillId: Skill.HUNTER.getIndex(), amount: 15000, label: "Hunter" },
    ],
    otherRewards: [
      "Access to Zemouregal's Base",
      "5 Kudos and an antique lamp from Historian Minas",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onGroundItemPickup(handleBottlePickup);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("ladders:climb", handleClimbRequest);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Elias White", { "Talk-to": talkToElias });
  api.onNpcInteraction("Captain Rovin", { "Talk-to": talkToRovin });
  api.onNpcInteraction("Reldo", { "Talk-to": talkToReldo });
  api.onNpcInteraction("Ramarno", { "Talk-to": talkToRamarno });
  api.onNpcInteraction("Dimintheis", { "Talk-to": talkToDimintheis });
  api.onNpcInteraction("King Roald", { "Talk-to": talkToRoald });
  api.onNpcInteraction("Sir Prysin", { "Talk-to": talkToPrysin });
  api.onNpcInteraction("Aeonisig Raispher", { "Talk-to": talkToAeonisig });
  api.onNpcInteraction("Horvik", { "Talk-to": talkToHorvik });
  api.onNpcInteraction("Romeo", { "Talk-to": talkToRomeo });
  api.onNpcInteraction("Curator Haig Halen", { "Talk-to": talkToHaig });
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("door:toggle", claimGateToggle);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(BASE_ZONE, handleBaseEnter);
};
