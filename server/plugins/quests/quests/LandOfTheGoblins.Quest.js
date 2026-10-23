/**
 * Land of the Goblins (members).
 *
 * The words come from the "Land of the Goblins" transcript page; this plugin supplies
 * the variant selector for the quest NPCs, the start hook, the prose-condition answers
 * (pets, Oldak's teleport materials, Zanik's sphere, the tribe-mail enclave guards,
 * Aggie's coins), the goblin potion / berries / black-dye crafting, the six tribe key
 * pickpockets, the crypt high-priest fights, the 9-4-1 fungus-ring machine and the
 * strange-box cutscene.
 *
 * Stage varbit 13599 "lotg" (varp 3355 "lotg_base", bits 0-8). Evidence: loc 43463
 * (lotg_fairy_ring_machine_setup, 2738,5218) transforms on varbit 13599 - value 50 ->
 * 43101 "Machine" (Adjust), 51 hidden, 52-56 powered noop, 57+ hidden - and loc 43466
 * (lotg_wired_fairy_mushroom_ring) turns wired at 50-56. So 50 and 52/57 are
 * cache-anchored, and the RSProx 1694 capture confirms every transition below.
 * RuneLite Quest Helper pinned 06da90f9 (LandOfTheGoblins.java) follows the same map.
 *
 * Stages (varbit 13599):
 *   0  not started (talk to Grubfoot by the Dorgesh-Kaan mine entrance)
 *   2  agreed to take Grubfoot into the city
 *   4  Grubfoot's dream cutscene played in Oldak's lab
 *   6  Grubfoot left for Goblin Village
 *   8  ready to travel to the secret temple (Oldak teleports the pair)
 *   10 Oldak teleported the player and Zanik to the Goblin Cave (temple entrance)
 *   12 the temple guards refused a human entry
 *   14 the Makeover Mage was asked about becoming a goblin
 *   16 the Makeover Mage explained the goblin potion recipe (can pick berries)
 *   18 drank the potion (goblin form)
 *   20 passed the guards
 *   22 entered the Goblin Temple
 *   24 spoke to Zanik in the Huzamogaarb cell
 *   26 freed Zanik with a Dorgesh-kaan sphere
 *   28 asked High Priest Bighead where Zanik is
 *   30 passed High Priest Bighead's test on the Big High War God
 *   32 learned the crypt holds the old high priests
 *   34 learned the six tribe keys unlock the crypt
 *   36 unlocked the crypt door
 *   38 entered the crypt / disturbed Snothead
 *   40 learned Snailfeet's name
 *   42 learned Mosschin's name
 *   44 learned Redeyes' name
 *   46 learned Strongbones' name
 *   48 Strongbones revealed Yu'biusk is another plane of existence
 *   48 returned to Oldak and Zanik, who ask to meet at the fungus ring
 *   50 the fungus-ring machine can be adjusted (cache-anchored)
 *   52 arrived in Yu'biusk (captured 50->52 on arrival; machine powered)
 *   54 opened the strange box, Zanik was taken (captured)
 *   56 quest complete (captured 54->56; machine gone)
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 8,000 Agility, Fishing, Thieving and
 * Herblore XP, access to the Goblin Temple, Yu'biusk (fairy ring BLQ) and goblin potions.
 *
 * Sources: OSRS Wiki "Land of the Goblins", its Quick guide and Transcript; the cache
 * for every id, varbit and placement (`lookup-gameval`, `dump:loc`).
 *
 * Gaps / approximations:
 *  - The Goblin Cave map exists (loc 2 enters at 2622,3392; the chamber around
 *    2617,9797 and guards at 2580,9852 are walkable), so the cave is entered and walked
 *    normally. The temple staircase loc is absent from this cache (MapObjects is empty
 *    at 2581,9853), so accepting the guards moves the player inside the temple.
 *  - Goblin form uses the supported player appearance transform
 *    (setNpcTransformationId with the six lotg unarmoured goblins), the type varbit and
 *    transform graphic/animation. Sunlight/combat reversal and the custom name chathead
 *    are not simulated; "[goblin name]" placeholders play verbatim.
 *  - The Makeover Mage's Talk-to is owned by plugins/npcs/MakeOverMage.plugin.js
 *    (name hook, registers earlier), and Morris's Talk-to by FishingContest, so the
 *    mage's LOTG conversation is started when the player enters his house at stage 12
 *    and the whitefish is caught by using a raw slimy eel on the Hemenster fishing
 *    spots (FishingContest owns their Bait option).
 *  - Grubfoot's follower walk is talk-driven: he is teleported to the lab when the
 *    player enters the city; the walk-in cutscene lines and the pet-following lines
 *    are not simulated (pet conditions answer false).
 *  - Temple/enclave NPC ids and tiles come from the RSProx 1694 actor adds, cross-checked
 *    against Quest Helper's guard/priest names (the ids are not sequential by tribe).
 *    Each tribe's priest/guard pair stands in its enclave. The Preacher's sermon has no
 *    interaction in the cache and is not played.
 *  - Crypt priests are summoned by Say-name (a message, the wiki has no line), turn
 *    into their Talk-to ghosts on death, and are owned per player.
 *  - The 9-4-1 power distribution uses the real cache interface 738 (Add/Subtract on
 *    widgets 21-26, Confirm 38) and drives varbits 13603-13605.
 */
module.exports = function registerLandOfTheGoblinsQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Land of the Goblins";
  const START_HOOK = "quest:land-of-the-goblins:start";

  // Varbit 13599 "lotg" of varp 3355 "lotg_base" (cache dump; sibling bits survive).
  const VARBIT_LAND_OF_THE_GOBLINS = 13599;
  // Varbit 13612 lotg_player_is_a_goblin (varp 3355 bit 31).
  const VARBIT_GOBLIN_FORM = 13612;
  const VARBIT_GOBLIN_TYPE = 13615; // lotg_goblin_type (varp 3356 bits 11-13)
  const VARBIT_KNOWS_WHITEFISH = 13602; // lotg_know_about_fish (varp 3355 bit 11)
  const VARBIT_MACHINE_1 = 13603; // lotg_connectors_1 (varp 3355 bits 12-15)
  const VARBIT_MACHINE_2 = 13604; // lotg_connectors_2
  const VARBIT_MACHINE_3 = 13605; // lotg_connectors_3
  const VARBIT_FAIRY_RING_ANIMATING = 13611; // lotg_fairy_ring_animating (varp 3355 bits 29-30)
  const VARBIT_MACHINE_EXPLAINED = 13618; // lotg_machine_explained (varp 3356 bit 20)
  const MACHINE_INTERFACE = 738;
  const MACHINE_FLOATER_UID = (161 << 16) | 16;
  const MACHINE_ADD = new Map([[21, 0], [23, 1], [25, 2]]);
  const MACHINE_SUBTRACT = new Map([[22, 0], [24, 1], [26, 2]]);
  const MACHINE_CONFIRM = 38;
  const MACHINE_TARGET = [9, 4, 1];
  const MACHINE_POWER_ATTRIBUTES = [
    "land-of-the-goblins:machine-1",
    "land-of-the-goblins:machine-2",
    "land-of-the-goblins:machine-3",
  ];
  const GOBLIN_SELECTION_INTERFACE = 739;
  const GOBLIN_SELECT_BUTTONS = new Map([[12, 1], [15, 2], [18, 3], [21, 4], [24, 5], [27, 6]]);
  const GOBLIN_CONFIRM_BUTTON = 30;
  // The cache's six unarmoured lotg goblin appearances (type 1-6).
  const GOBLIN_FORM_NPC_IDS = [
    NpcIdentifiers.GOBLIN_88,
    NpcIdentifiers.GOBLIN_98,
    NpcIdentifiers.GOBLIN_108,
    NpcIdentifiers.GOBLIN_118,
    NpcIdentifiers.GOBLIN_128,
    NpcIdentifiers.GOBLIN_138,
  ];
  const GOBLIN_TRANSFORM_GRAPHIC = 2039;
  const GOBLIN_TRANSFORM_ANIMATION = 9286;
  const GOBLIN_TYPE_ATTRIBUTE = "land-of-the-goblins:goblin-type";
  const MIGRATION_ATTRIBUTE = "land-of-the-goblins:migration";
  const MIGRATION_VERSION = 2;
  const CAVE_ENTRANCE_OBJECT_ID = 2; // mcannoncave, the Fishing Guild goblin cave entrance
  const CAVE_ENTRANCE_TILE = { x: 2624, y: 3393 };
  const GOBLIN_CAVE_TILE = { x: 2617, y: 9797 };

  const STAGE_STARTED = 2;
  const STAGE_CUTSCENE = 4;
  const STAGE_ZANIK_TALK = 6;
  const STAGE_CITY = 8;
  const STAGE_CAVE = 10;
  const STAGE_REFUSED = 12;
  const STAGE_MAGE = 14;
  const STAGE_POTION = 16;
  const STAGE_GOBLIN = 18;
  const STAGE_TEMPLE = 20;
  const STAGE_SPHERE = 22;
  const STAGE_PRISON = 24;
  const STAGE_FREED = 26;
  const STAGE_BIGHEAD = 28;
  const STAGE_TEST = 30;
  const STAGE_CRYPT_KNOWN = 32;
  const STAGE_KEYS = 34;
  const STAGE_CRYPT = 36;
  const STAGE_SNOTHEAD = 38;
  const STAGE_SNAILFEET = 40;
  const STAGE_MOSSCHIN = 42;
  const STAGE_REDEYES = 44;
  const STAGE_STRONGBONES = 46;
  const STAGE_YUBIUSK_KNOWN = 48;
  const STAGE_MACHINE = 50;
  const STAGE_YUBIUSK = 52;
  const STAGE_BOX = 54;
  const STAGE_COMPLETE = 56;

  const BITS_ATTRIBUTE = "quest.land_of_the_goblins.bits";
  const KEYS_ATTRIBUTE = "quest.land_of_the_goblins.keys";
  const CRYPT_ATTRIBUTE = "quest.land_of_the_goblins.crypt";

  const BIT_FOLLOWING = 1 << 0;
  const BIT_MET_ZANIK = 1 << 1;
  const BIT_GRUBFOOT_LEFT = 1 << 2;
  const BIT_GUARDS_REFUSED = 1 << 3;
  const BIT_ASKED_OLDAK = 1 << 4;
  const BIT_MET_BIGHEAD = 1 << 5;
  const BIT_GOBLIN_FORM = 1 << 6;
  const BIT_GOBLIN_NAME = 1 << 7;
  const BIT_FOUND_SPHERE = 1 << 8;
  const BIT_ZANIK_FREED = 1 << 9;
  const BIT_TEST_DONE = 1 << 10;
  const BIT_PRISON_TALK = 1 << 11;
  const BIT_CRYPT_UNLOCKED = 1 << 12;
  const BIT_BOX_OPENED = 1 << 13;
  // Helper-facing dialogue knowledge, persisted with the other quest bits.
  const BIT_KNOWS_WHITEFISH = 1 << 14;
  const BIT_MACHINE_EXPLAINED = 1 << 15;

  // NPCs (cache names in NpcIdentifiers.ts).
  const GRUBFOOT_NPC_ID = NpcIdentifiers.GRUBFOOT_8; // 11255, mine entrance / lab
  const GRUBFOOT_POST_NPC_ID = NpcIdentifiers.GRUBFOOT_9; // 11259, Goblin Village after the quest
  const OLDAK_LAB_NPC_ID = NpcIdentifiers.OLDAK; // 11265, lab id (no spawn; ASOH spawns 11384 there)
  const OLDAK_ALT_NPC_ID = NpcIdentifiers.OLDAK_2; // 11266, alternate lab id
  const OLDAK_RING_NPC_ID = NpcIdentifiers.OLDAK_3; // 11384, the lab Oldak ASOH spawns, and the fungus-ring one
  const OLDAK_YUBIUSK_NPC_ID = NpcIdentifiers.OLDAK_4; // 11385, Yu'biusk portal
  /** Every lab Oldak id (11384 is another quest's spawn, and its own ring variant). */
  const OLDAK_LAB_NPC_IDS = new Set([OLDAK_LAB_NPC_ID, OLDAK_ALT_NPC_ID]);
  const ZANIK_LAB_NPC_ID = NpcIdentifiers.ZANIK_17; // 11260
  const ZANIK_CAVE_NPC_ID = NpcIdentifiers.ZANIK_18; // 11261
  const ZANIK_PRISON_NPC_ID = NpcIdentifiers.ZANIK_21; // 11264
  const ZANIK_RING_NPC_ID = NpcIdentifiers.ZANIK_6; // 4506
  const ZANIK_YUBIUSK_NPC_ID = NpcIdentifiers.ZANIK_7; // 4508
  const HIGH_PRIEST_BIGHEAD_NPC_ID = NpcIdentifiers.HIGH_PRIEST_BIGHEAD; // 11267
  const PREACHER_NPC_ID = NpcIdentifiers.PREACHER; // 11382
  const ENTRANCE_GUARD_NPC_IDS = new Set([
    NpcIdentifiers.GOBLIN_GUARD_2, // 11314
    NpcIdentifiers.GOBLIN_GUARD_3, // 11315
  ]);
  const CRYPT_ATTACKER_NPC_IDS = [
    NpcIdentifiers.SNOTHEAD, // 11269
    NpcIdentifiers.SNAILFEET, // 11270
    NpcIdentifiers.MOSSCHIN, // 11271
    NpcIdentifiers.REDEYES, // 11272
    NpcIdentifiers.STRONGBONES, // 11273
  ];
  const STRONGBONES_INDEX = CRYPT_ATTACKER_NPC_IDS.indexOf(NpcIdentifiers.STRONGBONES);
  const SKOBLIN_NPC_ID = NpcIdentifiers.SKOBLIN; // 11268, summoned by Strongbones
  const CRYPT_GHOST_NPC_IDS = [
    NpcIdentifiers.SNOTHEAD_2, // 11274
    NpcIdentifiers.SNAILFEET_2, // 11275
    NpcIdentifiers.MOSSCHIN_2, // 11298
    NpcIdentifiers.REDEYES_2, // 11299
    NpcIdentifiers.STRONGBONES_2, // 11300
  ];

  // The six tribes: Saragorgak white/west, Yurkolgokh yellow/north-west, Huzamogaarb
  // black/north-east, Ekeleshuun blue/east, Narogoshuun orange/south-east,
  // Horogothgar purple/south-west (wiki). The ids are NOT sequential by tribe: the
  // capture's actor adds and Quest Helper's guard/priest names put white=11319/11309,
  // yellow=11321/11313, black=11318/11307, blue=11316/11303, orange=11317/11305 and
  // purple=11320/11311. Mail and key arrays below stay in this same tribe order.
  const TRIBE_COUNT = 6;
  const TRIBE_PRIEST_IDS = [
    NpcIdentifiers.PRIEST_12, // 11309, white
    NpcIdentifiers.PRIEST_16, // 11313, yellow
    NpcIdentifiers.PRIEST_10, // 11307, black
    NpcIdentifiers.PRIEST_6, // 11303, blue
    NpcIdentifiers.PRIEST_8, // 11305, orange
    NpcIdentifiers.PRIEST_14, // 11311, purple
  ];
  const TRIBE_GUARD_IDS = [
    NpcIdentifiers.GUARD_155, // 11319, white
    NpcIdentifiers.GUARD_157, // 11321, yellow
    NpcIdentifiers.GUARD_154, // 11318, black
    NpcIdentifiers.GUARD_152, // 11316, blue
    NpcIdentifiers.GUARD_153, // 11317, orange
    NpcIdentifiers.GUARD_156, // 11320, purple
  ];
  const TRIBE_MAIL_IDS = [
    ItemIdentifiers.WHITE_GOBLIN_MAIL, // 26567
    ItemIdentifiers.YELLOW_GOBLIN_MAIL, // 9056
    ItemIdentifiers.BLACK_GOBLIN_MAIL, // 9055
    ItemIdentifiers.BLUE_GOBLIN_MAIL, // 287
    ItemIdentifiers.ORANGE_GOBLIN_MAIL, // 286
    ItemIdentifiers.PURPLE_GOBLIN_MAIL, // 9058
  ];
  const TRIBE_KEY_IDS = [
    ItemIdentifiers.SARAGORGAK_KEY, // 26574
    ItemIdentifiers.YURKOLGOKH_KEY, // 26576
    ItemIdentifiers.HUZAMOGAARB_KEY, // 26573
    ItemIdentifiers.EKELESHUUN_KEY, // 26571
    ItemIdentifiers.NAROGOSHUUN_KEY, // 26572
    ItemIdentifiers.HOROGOTHGAR_KEY, // 26575
  ];
  const TRIBE_PRIEST_VARIANTS = [
    "keys-to-the-crypt-talking-to-the-tribe-priests-saragorgak",
    "keys-to-the-crypt-talking-to-the-tribe-priests-yurkolgokh",
    "keys-to-the-crypt-talking-to-the-tribe-priests-huzamogaarb",
    "keys-to-the-crypt-talking-to-the-tribe-priests-ekeleshuun",
    "keys-to-the-crypt-talking-to-the-tribe-priests-narogoshuun",
    "keys-to-the-crypt-talking-to-the-tribe-priests-horogothgar",
  ];
  const PRIEST_TRIBE_BY_ID = new Map(TRIBE_PRIEST_IDS.map((id, index) => [id, index]));
  const GUARD_TRIBE_BY_ID = new Map(TRIBE_GUARD_IDS.map((id, index) => [id, index]));
  const CRYPT_GHOST_VARIANTS = [
    "high-priests-of-ages-past-snothead",
    "high-priests-of-ages-past-snailfeet",
    "high-priests-of-ages-past-mosschin",
    "high-priests-of-ages-past-redeyes",
    "high-priests-of-ages-past-strongbones",
  ];
  const CRYPT_GHOST_VARIANT_BY_ID = new Map(
    CRYPT_GHOST_NPC_IDS.map((id, index) => [id, CRYPT_GHOST_VARIANTS[index]])
  );

  // Items.
  const GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.GOBLIN_MAIL; // 288
  const BLACK_GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.BLACK_GOBLIN_MAIL; // 9055
  const WHITE_GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.WHITE_GOBLIN_MAIL; // 26567
  const PHARMAKOS_BERRIES_ITEM_ID = ItemIdentifiers.PHARMAKOS_BERRIES; // 26569
  const WHITEFISH_ITEM_ID = ItemIdentifiers.WHITEFISH; // 26579
  const GOBLIN_POTION_DOSE_ITEMS = [
    ItemIdentifiers.GOBLIN_POTION_4_, // 26581
    ItemIdentifiers.GOBLIN_POTION_3_, // 26583
    ItemIdentifiers.GOBLIN_POTION_2_, // 26585
    ItemIdentifiers.GOBLIN_POTION_1_, // 26587
  ];
  const TOADFLAX_POTION_UNF_ITEM_ID = ItemIdentifiers.TOADFLAX_POTION_UNF_; // 3002
  const BLACK_MUSHROOM_ITEM_ID = ItemIdentifiers.BLACK_MUSHROOM; // 4620
  const BLACK_DYE_ITEM_ID = ItemIdentifiers.BLACK_DYE; // 4622
  const PESTLE_AND_MORTAR_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const VIAL_ITEM_ID = ItemIdentifiers.VIAL; // 229
  const DORGESH_KAAN_SPHERE_ITEM_ID = ItemIdentifiers.DORGESH_KAAN_SPHERE; // 10972
  const LAW_RUNE_ITEM_ID = ItemIdentifiers.LAW_RUNE; // 563
  const MOLTEN_GLASS_ITEM_ID = ItemIdentifiers.MOLTEN_GLASS; // 1775
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const FISHING_ROD_ITEM_ID = ItemIdentifiers.FISHING_ROD; // 307
  const RAW_SLIMY_EEL_ITEM_ID = ItemIdentifiers.RAW_SLIMY_EEL; // 3379

  const DYE_TO_MAIL = new Map([
    [ItemIdentifiers.YELLOW_DYE, ItemIdentifiers.YELLOW_GOBLIN_MAIL], // 1765 -> 9056
    [ItemIdentifiers.BLUE_DYE, ItemIdentifiers.BLUE_GOBLIN_MAIL], // 1767 -> 287
    [ItemIdentifiers.ORANGE_DYE, ItemIdentifiers.ORANGE_GOBLIN_MAIL], // 1769 -> 286
    [ItemIdentifiers.PURPLE_DYE, ItemIdentifiers.PURPLE_GOBLIN_MAIL], // 1773 -> 9058
    [ItemIdentifiers.BLACK_DYE, ItemIdentifiers.BLACK_GOBLIN_MAIL], // 4622 -> 9055
  ]);
  const DYED_MAIL_ITEM_IDS = new Set([
    ItemIdentifiers.YELLOW_GOBLIN_MAIL,
    ItemIdentifiers.BLUE_GOBLIN_MAIL,
    ItemIdentifiers.ORANGE_GOBLIN_MAIL,
    ItemIdentifiers.PURPLE_GOBLIN_MAIL,
    ItemIdentifiers.BLACK_GOBLIN_MAIL,
  ]);

  // Hemenster fishing spots (FishingContest's constants 4079-4082).
  const HEMENSTER_SPOT_NPC_IDS = new Set([
    NpcIdentifiers.FISHING_SPOT_51,
    NpcIdentifiers.FISHING_SPOT_52,
    NpcIdentifiers.FISHING_SPOT_53,
    NpcIdentifiers.FISHING_SPOT_54,
  ]);
  const AGGIE_NPC_IDS = new Set([NpcIdentifiers.AGGIE, NpcIdentifiers.AGGIE_2]); // 120/121
  const MAKEOVER_MAGE_NPC_ID = NpcIdentifiers.MAKEOVER_MAGE_2; // 1307, world spawn

  // Objects (generated identifiers).
  const SPHERE_CRATE_OBJECT_ID = ObjectIdentifiers.CRATE_284; // 43085, Search
  const ARMOUR_CRATE_OBJECT_ID = ObjectIdentifiers.CRATE_285; // 43086, Search
  const TEMPLE_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_656; // 43087, Open
  const TEMPLE_HUGE_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_657; // 43088, Open
  const MACHINE_OBJECT_ID = ObjectIdentifiers.MACHINE_20; // 43101, Adjust (varbit 13599 = 50)
  // nameless in the cache: lotg_fairy_ring_machine_setup (4x2 at 2738,5218), transforms
  // to 43101/43102/43103 on varbit 13599.
  const MACHINE_SETUP_OBJECT_ID = 43463;
  const CRYPT_GRAVE_OBJECT_IDS = [
    ObjectIdentifiers.GRAVE_36, // 43122, Snothead (south-west)
    ObjectIdentifiers.GRAVE_37, // 43123, Snailfeet (south-east)
    ObjectIdentifiers.GRAVE_38, // 43124, Mosschin (north-west)
    ObjectIdentifiers.GRAVE_39, // 43125, Redeyes (north-east)
    ObjectIdentifiers.GRAVE_40, // 43126, Strongbones (north)
  ];
  const PHARMAKOS_BUSH_OBJECT_ID = ObjectIdentifiers.PHARMAKOS_BUSH; // 43158, Pick-from
  const BLACK_MUSHROOMS_OBJECT_ID = ObjectIdentifiers.BLACK_MUSHROOMS; // 6311, Pick (black dye)
  const STRANGE_BOX_OBJECT_ID = ObjectIdentifiers.STRANGE_BOX; // 43246, Open
  const CRYPT_GATE_OBJECT_ID = ObjectIdentifiers.GATE_231; // 43278, Open
  const QUEST_OBJECT_IDS = new Set([
    SPHERE_CRATE_OBJECT_ID,
    ARMOUR_CRATE_OBJECT_ID,
    TEMPLE_DOOR_OBJECT_ID,
    TEMPLE_HUGE_DOOR_OBJECT_ID,
    MACHINE_OBJECT_ID,
    MACHINE_SETUP_OBJECT_ID,
    CRYPT_GATE_OBJECT_ID,
    PHARMAKOS_BUSH_OBJECT_ID,
    BLACK_MUSHROOMS_OBJECT_ID,
    STRANGE_BOX_OBJECT_ID,
    ...CRYPT_GRAVE_OBJECT_IDS,
  ]);

  // Condition step ids on the "Land of the Goblins" page.
  const PET_WAITING_CONDITION_ID = "UsJUvB";
  const PET_TEMPLE_CONDITION_IDS = new Set(["dfOF2x", "kjwaIM", "yq72SS"]);
  const OLDAK_NO_MATERIALS_CONDITION_ID = "PwO-Ik";
  const OLDAK_HAS_MATERIALS_CONDITION_ID = "4j8klO";
  const ENCLAVE_WRONG_MAIL_CONDITION_ID = "qgFQDA";
  const ENCLAVE_RIGHT_MAIL_CONDITION_ID = "TTlqPM";
  const ENCLAVE_LEAVE_WRONG_CONDITION_ID = "uDN0yd";
  const ENCLAVE_LEAVE_RIGHT_CONDITION_ID = "grauSe";
  const ZANIK_HAS_SPHERE_CONDITION_IDS = new Set(["P-I4f0", "uR5upd"]);
  const ZANIK_NO_SPHERE_CONDITION_IDS = new Set(["qIdIKL", "aHkp3V"]);
  const AGGIE_ENOUGH_COINS_CONDITION_ID = "cIe6-r";
  const AGGIE_NOT_ENOUGH_COINS_CONDITION_ID = "wKCA-u";
  const FISHING_PASS_CONDITION_ID = "aXZGZT";
  const NO_FISHING_PASS_CONDITION_ID = "oL63RF";
  const ENCLAVE_CONDITION_IDS = new Set([
    ENCLAVE_WRONG_MAIL_CONDITION_ID,
    ENCLAVE_RIGHT_MAIL_CONDITION_ID,
    ENCLAVE_LEAVE_WRONG_CONDITION_ID,
    ENCLAVE_LEAVE_RIGHT_CONDITION_ID,
  ]);

  // Action / message step ids.
  const GRUBFOOT_LEAVES_ACTION_ID = "5Ck1fo";
  const TELEPORT_TO_CAVE_ACTION_ID = "8mebE2";
  const PAID_TELEPORT_ACTION_ID = "6cDx_0";
  const ZANIK_ENTERS_TEMPLE_ACTION_ID = "gge_be";
  const ZANIK_ESCAPES_ACTION_IDS = new Set(["Z18uaI", "EPc9qL"]);
  const CUTSCENE_START_ACTION_ID = "FS_LnE";
  const DREAM_CUTSCENE_START_ACTION_ID = "zSUlVq";
  const DREAM_CUTSCENE_END_ACTION_ID = "YUdQ2P";
  const ARRIVE_YUBIUSK_ACTION_ID = "UszKmx";
  const BOX_SUCKED_ACTION_ID = "Eh5lL0";
  const BOX_PLAYER_PORTAL_ACTION_ID = "oeHSHw";
  const QUEST_COMPLETE_ACTION_ID = "dfkFWY";
  const BIGHEAD_TEST_DONE_ACTION_ID = "jarIa4";
  const AGGIE_WHITE_MAIL_ACTION_ID = "vioBcH";
  const ACTION_STEP_IDS = new Set([
    GRUBFOOT_LEAVES_ACTION_ID,
    TELEPORT_TO_CAVE_ACTION_ID,
    PAID_TELEPORT_ACTION_ID,
    ZANIK_ENTERS_TEMPLE_ACTION_ID,
    ...ZANIK_ESCAPES_ACTION_IDS,
    CUTSCENE_START_ACTION_ID,
    DREAM_CUTSCENE_START_ACTION_ID,
    DREAM_CUTSCENE_END_ACTION_ID,
    ARRIVE_YUBIUSK_ACTION_ID,
    BOX_SUCKED_ACTION_ID,
    BOX_PLAYER_PORTAL_ACTION_ID,
    QUEST_COMPLETE_ACTION_ID,
    BIGHEAD_TEST_DONE_ACTION_ID,
    AGGIE_WHITE_MAIL_ACTION_ID,
  ]);

  // Spawn tiles (cache placements; temple interior from the capture actor adds).
  const GRUBFOOT_MINE_TILE = { x: 3318, y: 9613 };
  const GRUBFOOT_LAB_TILE = { x: 2702, y: 5369 };
  const GRUBFOOT_VILLAGE_TILE = { x: 2957, y: 3514 };
  const ZANIK_LAB_TILE = { x: 2703, y: 5366 };
  const ZANIK_CAVE_TILE = { x: 2617, y: 9797 };
  const ZANIK_PRISON_TILE = { x: 3755, y: 4340 };
  const ENTRANCE_GUARD_TILES = [
    { x: 2580, y: 9852 },
    { x: 2582, y: 9852 },
  ];
  const CAVE_TELEPORT_TILE = GOBLIN_CAVE_TILE;
  const TEMPLE_INSIDE_TILE = { x: 3744, y: 4306 };
  const HIGH_PRIEST_TILE = { x: 3744, y: 4326 };
  const PREACHER_TILE = { x: 3748, y: 4317 };
  // Temple spawn tiles are the capture 1694 actor adds (not the Quest Helper
  // interaction points, which are where the player stands). Order matches the tribes.
  const TRIBE_GUARD_TILES = [
    { x: 3732, y: 4320 }, // white
    { x: 3735, y: 4329 }, // yellow
    { x: 3753, y: 4329 }, // black
    { x: 3756, y: 4320 }, // blue
    { x: 3753, y: 4311 }, // orange
    { x: 3735, y: 4311 }, // purple
  ];
  const TRIBE_PRIEST_TILES = [
    { x: 3724, y: 4316 }, // white
    { x: 3724, y: 4332 }, // yellow
    { x: 3757, y: 4340 }, // black
    { x: 3760, y: 4319 }, // blue
    { x: 3761, y: 4307 }, // orange
    { x: 3734, y: 4302 }, // purple
  ];
  // Captured enclave pass: the guard shoves the player across one blocked mouth tile.
  // `from` is the hall side, `to` the enclave side (1694 lines 19275/31040/31912/32582/
  // 33158/33802). This is the only movement that may ignore clipping.
  const TRIBE_GUARD_PASS = [
    { from: { x: 3733, y: 4320 }, to: { x: 3731, y: 4320 } }, // white
    { from: { x: 3736, y: 4328 }, to: { x: 3734, y: 4330 } }, // yellow
    { from: { x: 3752, y: 4328 }, to: { x: 3754, y: 4330 } }, // black
    { from: { x: 3755, y: 4320 }, to: { x: 3757, y: 4320 } }, // blue
    { from: { x: 3752, y: 4312 }, to: { x: 3754, y: 4310 } }, // orange
    { from: { x: 3736, y: 4312 }, to: { x: 3734, y: 4310 } }, // purple
  ];
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
  const RING_OLDAK_TILE = { x: 2743, y: 5221 };
  const RING_ZANIK_TILE = { x: 2733, y: 5222 };
  const YUBIUSK_OLDAK_TILE = { x: 3540, y: 4384 };
  const YUBIUSK_ZANIK_TILE = { x: 3538, y: 4380 };
  const YUBIUSK_TELEPORT_TILE = { x: 3540, y: 4386 };
  const LAB_RETURN_TILE = { x: 2703, y: 5367 };

  const BLACK_MUSHROOM_ZONE = { minX: 2560, maxX: 2630, minY: 9780, maxY: 9870, levels: [0] };
  const MINE_ZONE = { minX: 3300, maxX: 3340, minY: 9590, maxY: 9640, levels: [0] };
  const CITY_ZONE = { minX: 2670, maxX: 2780, minY: 5270, maxY: 5440, levels: [0] };
  const TEMPLE_ZONE = { minX: 3690, maxX: 3800, minY: 4260, maxY: 4420, levels: [0] };
  const RING_ZONE = { minX: 2710, maxX: 2765, minY: 5200, maxY: 5245, levels: [0] };
  const MAGE_ZONE = { minX: 2900, maxX: 2940, minY: 3305, maxY: 3345, levels: [0] };
  const YUBIUSK_ZONE = { minX: 3500, maxX: 3900, minY: 4340, maxY: 4420, levels: [0] };

  const GOBLIN_NAMES = ["Dung", "Grub", "Spit", "Wart", "Bone", "Zog"];
  const REQUIREMENTS_MESSAGE =
    "You must complete Another Slice of H.A.M. and Fishing Contest, and have 38 Agility, " +
    "40 Fishing, 45 Thieving and 48 Herblore to start this quest.";
  const OLDAK_MATERIALS_HINT =
    "Oldak needs two law runes and a piece of molten glass to make a moving-over-distance sphere.";
  const PHARMAKOS_MESSAGE =
    "You shouldn't just go picking berries from bushes that don't belong to you.";

  /** Transient tribe context for the enclave-guard prose conditions (never persisted). */
  const enclaveTribe = new WeakMap();
  /** Scoped ignore-clipping movement for an accepted guard pass. */
  const guardPassMoves = new WeakMap();
  /** Potion showed the makeover interface but has not been confirmed. */
  const pendingGoblinPotion = new WeakMap();
  /** The 9-4-1 relay values while the player is using interface 738. */
  const machinePower = new WeakMap();
  /** Captured machine animation values 1/2 while the Yu'biusk cutscene plays. */
  const fairyRingAnimating = new WeakMap();
  const Scenes = createQuestScenes(api);
  /** Owner-only quest spawns per player, keyed by a stable key. */
  const trackedNpcs = new WeakMap();

  let quest;

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function clearBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) & ~bit);
  }

  function keysMask(player) {
    return Number(player.getAttribute(KEYS_ATTRIBUTE)) || 0;
  }

  function setKeysMask(player, mask) {
    player.setAttribute(KEYS_ATTRIBUTE, mask | 0);
  }

  function hasKey(player, tribe) {
    return (keysMask(player) & (1 << tribe)) !== 0;
  }

  function cryptMask(player) {
    return Number(player.getAttribute(CRYPT_ATTRIBUTE)) || 0;
  }

  function hasCryptBit(player, index) {
    return (cryptMask(player) & (1 << index)) !== 0;
  }

  function setCryptBit(player, index) {
    player.setAttribute(CRYPT_ATTRIBUTE, cryptMask(player) | (1 << index));
  }

  /** Publish the helper's native Land of the Goblins sub-varbits (bit siblings survive). */
  function syncQuestVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_KNOWS_WHITEFISH, hasBit(player, BIT_KNOWS_WHITEFISH) ? 1 : 0);
    sender.sendVarbit(VARBIT_MACHINE_EXPLAINED, hasBit(player, BIT_MACHINE_EXPLAINED) ? 1 : 0);
    sender.sendVarbit(VARBIT_FAIRY_RING_ANIMATING, fairyRingAnimating.get(player) ?? 0);
  }

  function setFairyRingAnimating(player, value) {
    fairyRingAnimating.set(player, value);
    syncQuestVarbits(player);
  }

  function allKeysHeld(player) {
    return keysMask(player) === (1 << TRIBE_COUNT) - 1;
  }

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  /** Keys can legitimately be banked; a banked key is owned and must not be duplicated. */
  function bankedAmount(player, itemId) {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.reduce((total, bank) => total + Number(bank?.getAmount?.(itemId) ?? 0), 0);
  }

  function hasOldakMaterials(player) {
    return held(player, LAW_RUNE_ITEM_ID, 2) && held(player, MOLTEN_GLASS_ITEM_ID, 1);
  }

  function wornBodyId(player) {
    const body = player.getEquipment().get(Equipment.BODY_SLOT);
    return body?.getId?.() ?? -1;
  }

  function questActive(player) {
    return quest.getStage(player) > 0 && !quest.isComplete(player);
  }

  function hasQuest(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    if (skills.getMaxLevel(Skill.AGILITY) < 38) return false;
    if (skills.getMaxLevel(Skill.FISHING) < 40) return false;
    if (skills.getMaxLevel(Skill.THIEVING) < 45) return false;
    if (skills.getMaxLevel(Skill.HERBLORE) < 48) return false;
    return hasQuest(player, "another_slice_of_ham") && hasQuest(player, "fishing_contest");
  }

  function setStage(player, value) {
    quest.setStage(player, value);
    syncQuestNpcs(player);
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, player.getLocation().getZ()));
  }

  function tileInZone(location, zone) {
    const x = location?.getX ? location.getX() : location?.x;
    const y = location?.getY ? location.getY() : location?.y;
    const z = location?.getZ ? location.getZ() : (location?.z ?? 0);
    return (
      x >= zone.minX &&
      x <= zone.maxX &&
      y >= zone.minY &&
      y <= zone.maxY &&
      (zone.levels ?? [0]).includes(z)
    );
  }

  function inZone(player, zone) {
    const location = player.getLocation();
    return (
      location.getX() >= zone.minX &&
      location.getX() <= zone.maxX &&
      location.getY() >= zone.minY &&
      location.getY() <= zone.maxY
    );
  }

  // ==========================================================================
  // Owner-only quest spawns
  // ==========================================================================

  function tracked(player) {
    let map = trackedNpcs.get(player);
    if (!map) {
      map = new Map();
      trackedNpcs.set(player, map);
    }
    return map;
  }

  function removeTracked(player, key) {
    const map = trackedNpcs.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  function trackNpc(player, key, npc) {
    if (npc) tracked(player).set(key, npc);
    return npc;
  }

  function spawnTracked(player, key, npcId, tile, wanderRadius = 0) {
    const npc = api.spawnNpc({
      id: npcId,
      x: tile.x,
      y: tile.y,
      z: 0,
      wanderRadius,
      owner: player,
      ownerOnly: true,
    });
    return trackNpc(player, key, npc);
  }

  function moveTracked(player, key, npcId, tile, wanderRadius = 0) {
    const npc = tracked(player).get(key);
    if (!npc) return spawnTracked(player, key, npcId, tile, wanderRadius);
    const location = npc.getLocation();
    if (location.getX() !== tile.x || location.getY() !== tile.y || location.getZ() !== 0) {
      npc.moveTo(new Location(tile.x, tile.y, 0));
    }
    return npc;
  }

  function removeAllTracked(player) {
    const map = trackedNpcs.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  /** Restore any existing ignore-clipping state; never leave free temple walking. */
  function finishGuardPass(player) {
    const state = guardPassMoves.get(player);
    if (!state) return;
    guardPassMoves.delete(player);
    if (state.previous) player.setFlag(IGNORE_CLIPPING_FLAG, true);
    else player.removeFlag(IGNORE_CLIPPING_FLAG);
  }

  /** Ends the scoped flag as soon as the queued pass has no steps left. */
  function pollGuardPass(player, token, ticks) {
    if (guardPassMoves.get(player)?.token !== token) return;
    const queue = player.getMovementQueue();
    if (queue.size() === 0 || ticks <= 0) {
      finishGuardPass(player);
      return;
    }
    Scenes.later(player, 1, () => pollGuardPass(player, token, ticks - 1));
  }

  /** Captured guard shove: only these exact two tiles may ignore clipping. */
  function walkGuardPass(player, destination) {
    finishGuardPass(player);
    const previous = player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true;
    const token = {};
    guardPassMoves.set(player, { previous, token });
    player.setFlag(IGNORE_CLIPPING_FLAG, true);
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(new Location(destination.x, destination.y, 0));
    pollGuardPass(player, token, 4);
  }

  /** Any ordinary walk request cancels the scoped pass movement. */
  function cancelGuardPass(event) {
    finishGuardPass(event.player);
  }

  /** Spawns exactly the NPCs the player's current stage/state calls for. */
  function syncQuestNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    const complete = quest.isComplete(player);

    const hideGrubfoot =
      complete || stage >= STAGE_CAVE || hasBit(player, BIT_GRUBFOOT_LEFT);
    if (hideGrubfoot) {
      removeTracked(player, "grubfoot");
    } else if (stage >= STAGE_CUTSCENE) {
      moveTracked(player, "grubfoot", GRUBFOOT_NPC_ID, GRUBFOOT_LAB_TILE);
    } else {
      moveTracked(player, "grubfoot", GRUBFOOT_NPC_ID, GRUBFOOT_MINE_TILE);
    }

    const zanikLab =
      (stage >= STAGE_STARTED && stage < STAGE_CAVE) ||
      (stage >= STAGE_FREED && stage < STAGE_MACHINE);
    if (zanikLab) {
      moveTracked(player, "zanik-lab", ZANIK_LAB_NPC_ID, ZANIK_LAB_TILE);
    } else {
      removeTracked(player, "zanik-lab");
    }

    if (questActive(player) && stage >= STAGE_CAVE && stage < STAGE_TEMPLE) {
      moveTracked(player, "zanik-cave", ZANIK_CAVE_NPC_ID, ZANIK_CAVE_TILE);
      moveTracked(player, "entrance-guard-1", NpcIdentifiers.GOBLIN_GUARD_2, ENTRANCE_GUARD_TILES[0]);
      moveTracked(player, "entrance-guard-2", NpcIdentifiers.GOBLIN_GUARD_3, ENTRANCE_GUARD_TILES[1]);
    } else {
      removeTracked(player, "zanik-cave");
      removeTracked(player, "entrance-guard-1");
      removeTracked(player, "entrance-guard-2");
    }

    const inTemple = stage >= STAGE_TEMPLE && (stage < STAGE_MACHINE || complete);
    if (inTemple) {
      moveTracked(player, "bighead", HIGH_PRIEST_BIGHEAD_NPC_ID, HIGH_PRIEST_TILE);
      moveTracked(player, "preacher", PREACHER_NPC_ID, PREACHER_TILE);
      for (let tribe = 0; tribe < TRIBE_COUNT; tribe++) {
        moveTracked(player, `tribe-guard-${tribe}`, TRIBE_GUARD_IDS[tribe], TRIBE_GUARD_TILES[tribe]);
        moveTracked(player, `tribe-priest-${tribe}`, TRIBE_PRIEST_IDS[tribe], TRIBE_PRIEST_TILES[tribe]);
      }
    } else {
      removeTracked(player, "bighead");
      removeTracked(player, "preacher");
      for (let tribe = 0; tribe < TRIBE_COUNT; tribe++) {
        removeTracked(player, `tribe-guard-${tribe}`);
        removeTracked(player, `tribe-priest-${tribe}`);
      }
    }

    if (questActive(player) && stage >= STAGE_TEMPLE && stage < STAGE_FREED) {
      moveTracked(player, "zanik-prison", ZANIK_PRISON_NPC_ID, ZANIK_PRISON_TILE);
    } else {
      removeTracked(player, "zanik-prison");
    }

    if (questActive(player) && stage === STAGE_MACHINE) {
      moveTracked(player, "oldak-ring", OLDAK_RING_NPC_ID, RING_OLDAK_TILE);
      moveTracked(player, "zanik-ring", ZANIK_RING_NPC_ID, RING_ZANIK_TILE);
    } else {
      removeTracked(player, "oldak-ring");
      removeTracked(player, "zanik-ring");
    }

    if (questActive(player) && stage >= STAGE_YUBIUSK && stage < STAGE_BOX) {
      moveTracked(player, "oldak-yubiusk", OLDAK_YUBIUSK_NPC_ID, YUBIUSK_OLDAK_TILE);
      moveTracked(player, "zanik-yubiusk", ZANIK_YUBIUSK_NPC_ID, YUBIUSK_ZANIK_TILE);
    } else {
      removeTracked(player, "oldak-yubiusk");
      removeTracked(player, "zanik-yubiusk");
    }

    if (complete) {
      moveTracked(player, "grubfoot-post", GRUBFOOT_POST_NPC_ID, GRUBFOOT_VILLAGE_TILE);
    } else {
      removeTracked(player, "grubfoot-post");
    }
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectGrubfootVariant(player, stage) {
    if (stage >= STAGE_CAVE) return null;
    if (stage >= STAGE_CUTSCENE) return "grubfoot-s-dream-walking-with-grubfoot-in-oldak-s-lab";
    if (stage >= STAGE_STARTED) {
      return hasBit(player, BIT_FOLLOWING)
        ? "grubfoot-s-dream-walking-with-grubfoot-whilst-following-the-player"
        : "grubfoot-s-dream-walking-with-grubfoot-waiting-for-the-player";
    }
    return "grubfoot-s-dream-talking-to-grubfoot-mistag";
  }

  function selectZanikVariant(player, stage) {
    if (stage === STAGE_STARTED) {
      if (!hasBit(player, BIT_MET_ZANIK)) {
        setBit(player, BIT_MET_ZANIK);
        setStage(player, STAGE_CUTSCENE);
        return "grubfoot-s-dream-talking-to-zanik-oldak";
      }
      return "grubfoot-s-dream-talking-to-zanik-oldak";
    }
    if (stage >= STAGE_CUTSCENE && stage < STAGE_CAVE) {
      return hasBit(player, BIT_GRUBFOOT_LEFT)
        ? "grubfoot-s-dream-talking-to-zanik-oldak-after-grubfoot-leaves"
        : "grubfoot-s-dream-talking-to-zanik-oldak-after-the-cutscene";
    }
    if (stage >= STAGE_FREED && stage < STAGE_YUBIUSK_KNOWN) {
      return "the-temple-of-tribes-talking-to-zanik-in-oldak-s-lab";
    }
    if (stage >= STAGE_YUBIUSK_KNOWN) return "path-to-yu-biusk-returning-to-dorgesh-kaan";
    return null;
  }

  function selectOldakLabVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-oldak";
    if (stage >= STAGE_CUTSCENE && stage < STAGE_CAVE) {
      return "grubfoot-s-dream-talking-to-zanik-oldak-after-the-cutscene";
    }
    if (stage >= STAGE_CAVE && stage < STAGE_REFUSED) {
      return "grubfoot-s-dream-talking-to-oldak-again-before-entering-the-goblin-temple";
    }
    if (stage === STAGE_REFUSED) {
      return hasBit(player, BIT_ASKED_OLDAK)
        ? "imposter-among-goblins-talking-to-oldak-talking-to-oldak-again"
        : "imposter-among-goblins-talking-to-oldak";
    }
    if (stage === STAGE_MAGE || stage === STAGE_POTION) {
      return "imposter-among-goblins-talking-to-oldak-after-talking-to-the-makeover-mage";
    }
    if (stage >= STAGE_GOBLIN && stage < STAGE_TEST) {
      return "the-temple-of-tribes-talking-to-oldak";
    }
    if (stage >= STAGE_YUBIUSK_KNOWN) {
      return "path-to-yu-biusk-returning-to-dorgesh-kaan";
    }
    if (stage >= STAGE_TEST) {
      return "the-temple-of-tribes-talking-to-oldak-2";
    }
    return null;
  }

  /** Which transcript variant the clicked NPC plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    const complete = quest.isComplete(player);

    if (npcId === GRUBFOOT_NPC_ID) return selectGrubfootVariant(player, stage);
    if (npcId === GRUBFOOT_POST_NPC_ID) {
      return complete ? "post-quest-dialogue-grubfoot" : null;
    }
    if (OLDAK_LAB_NPC_IDS.has(npcId)) return selectOldakLabVariant(player, stage);
    if (npcId === ZANIK_LAB_NPC_ID) return selectZanikVariant(player, stage);
    if (npcId === ZANIK_CAVE_NPC_ID) {
      return questActive(player) && stage < STAGE_TEMPLE
        ? "imposter-among-goblins-talking-to-zanik"
        : null;
    }
    if (npcId === ZANIK_PRISON_NPC_ID) {
      if (!questActive(player) || stage < STAGE_TEMPLE || stage >= STAGE_FREED) return null;
      if (!hasBit(player, BIT_PRISON_TALK)) {
        setBit(player, BIT_PRISON_TALK);
        if (stage < STAGE_PRISON) setStage(player, STAGE_PRISON);
        return "the-temple-of-tribes-talking-to-zanik";
      }
      return "the-temple-of-tribes-talking-to-zanik-again";
    }
    if (npcId === OLDAK_RING_NPC_ID) {
      // 11384 is both the ring Oldak and the lab one Another Slice of H.A.M.
      // spawns; only the machine stage wants the ring conversation.
      return stage === STAGE_MACHINE
        ? "path-to-yu-biusk-talking-to-oldak"
        : selectOldakLabVariant(player, stage);
    }
    if (npcId === ZANIK_RING_NPC_ID) {
      return stage === STAGE_MACHINE ? "path-to-yu-biusk-talking-to-zanik" : null;
    }
    if (npcId === OLDAK_YUBIUSK_NPC_ID) {
      return stage >= STAGE_YUBIUSK && stage < STAGE_BOX
        ? "through-the-fungus-ring-talking-to-oldak-upon-arrival"
        : null;
    }
    if (npcId === ZANIK_YUBIUSK_NPC_ID) {
      return stage >= STAGE_YUBIUSK && stage < STAGE_BOX
        ? "through-the-fungus-ring-talking-to-zanik"
        : null;
    }
    if (npcId === HIGH_PRIEST_BIGHEAD_NPC_ID) {
      if (!questActive(player) || stage < STAGE_TEMPLE) return null;
      if (stage < STAGE_FREED) {
        if (!hasBit(player, BIT_MET_BIGHEAD)) {
          setBit(player, BIT_MET_BIGHEAD);
          return "the-temple-of-tribes-talking-to-high-priest-bighead";
        }
        return "the-temple-of-tribes-talking-to-high-priest-bighead-again";
      }
      if (stage === STAGE_FREED) {
        setStage(player, STAGE_BIGHEAD);
        return "the-temple-of-tribes-talking-to-high-priest-bighead";
      }
      if (stage === STAGE_BIGHEAD) return "the-temple-of-tribes-talking-to-high-priest-bighead-2";
      if (stage === STAGE_TEST) {
        setStage(player, STAGE_CRYPT_KNOWN);
        return "the-temple-of-tribes-talking-to-high-priest-bighead-after-answering-questions";
      }
      if (stage === STAGE_CRYPT_KNOWN) {
        return "the-temple-of-tribes-talking-to-high-priest-bighead-after-answering-questions";
      }
      if (stage >= STAGE_KEYS) {
        return "the-temple-of-tribes-talking-to-high-priest-bighead-after-asking-him-all-questions";
      }
      return null;
    }
    if (ENTRANCE_GUARD_NPC_IDS.has(npcId)) {
      if (!questActive(player) || stage < STAGE_CAVE || stage >= STAGE_TEMPLE) return null;
      if (stage >= STAGE_MAGE && hasBit(player, BIT_GOBLIN_FORM)) {
        return "the-temple-of-tribes-talking-to-goblin-guards";
      }
      return hasBit(player, BIT_GUARDS_REFUSED)
        ? "imposter-among-goblins-talking-to-goblin-guards-talking-to-goblin-guards-again"
        : "imposter-among-goblins-talking-to-goblin-guards";
    }
    const priestTribe = PRIEST_TRIBE_BY_ID.get(npcId);
    if (priestTribe !== undefined) {
      if (!questActive(player) || stage < STAGE_KEYS) return null;
      return TRIBE_PRIEST_VARIANTS[priestTribe];
    }
    const ghostVariant = CRYPT_GHOST_VARIANT_BY_ID.get(npcId);
    if (ghostVariant !== undefined) {
      return questActive(player) && stage >= STAGE_KEYS ? ghostVariant : null;
    }
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerEnclaveCondition(player, stepId) {
    const state = enclaveTribe.get(player);
    if (!state) return null;
    const correct = wornBodyId(player) === TRIBE_MAIL_IDS[state.tribe];
    if (stepId === ENCLAVE_WRONG_MAIL_CONDITION_ID) return !state.leaving && !correct;
    if (stepId === ENCLAVE_RIGHT_MAIL_CONDITION_ID) return !state.leaving && correct;
    if (stepId === ENCLAVE_LEAVE_WRONG_CONDITION_ID) return state.leaving && !correct;
    if (stepId === ENCLAVE_LEAVE_RIGHT_CONDITION_ID) return state.leaving && correct;
    return false;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (npcId === undefined || !stepId) return null;
    if (stepId === PET_WAITING_CONDITION_ID || PET_TEMPLE_CONDITION_IDS.has(stepId)) return false;
    if (stepId === OLDAK_NO_MATERIALS_CONDITION_ID) return !hasOldakMaterials(player);
    if (stepId === OLDAK_HAS_MATERIALS_CONDITION_ID) return hasOldakMaterials(player);
    if (ZANIK_HAS_SPHERE_CONDITION_IDS.has(stepId)) return held(player, DORGESH_KAAN_SPHERE_ITEM_ID);
    if (ZANIK_NO_SPHERE_CONDITION_IDS.has(stepId)) return !held(player, DORGESH_KAAN_SPHERE_ITEM_ID);
    if (ENCLAVE_CONDITION_IDS.has(stepId)) return answerEnclaveCondition(player, stepId);
    if (stepId === AGGIE_ENOUGH_COINS_CONDITION_ID) return held(player, COINS_ITEM_ID, 5);
    if (stepId === AGGIE_NOT_ENOUGH_COINS_CONDITION_ID) return !held(player, COINS_ITEM_ID, 5);
    if (stepId === FISHING_PASS_CONDITION_ID) return false;
    if (stepId === NO_FISHING_PASS_CONDITION_ID) return true;
    return null;
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || npcId !== GRUBFOOT_NPC_ID) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) {
      player.sendMessage(REQUIREMENTS_MESSAGE);
      player.getDialogueManager()?.reset?.();
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    setStage(player, STAGE_STARTED);
  }

  function goblinType(player) {
    return Math.min(6, Math.max(1, Number(player.getAttribute(GOBLIN_TYPE_ATTRIBUTE)) || 1));
  }

  function applyGoblinAppearance(player) {
    const type = goblinType(player);
    player.setNpcTransformationId(GOBLIN_FORM_NPC_IDS[type - 1]);
    player.getUpdateFlag().flag(api.core.Flag.APPEARANCE);
    player.getPacketSender().sendVarbit(VARBIT_GOBLIN_FORM, 1).sendVarbit(VARBIT_GOBLIN_TYPE, type);
  }

  function setGoblinForm(player, on) {
    if (on) {
      setBit(player, BIT_GOBLIN_FORM);
      applyGoblinAppearance(player);
      player.performGraphic(new api.core.Graphic(GOBLIN_TRANSFORM_GRAPHIC, 0, 0));
      player.performAnimation?.(new api.core.Animation(GOBLIN_TRANSFORM_ANIMATION));
    } else {
      clearBit(player, BIT_GOBLIN_FORM);
      player.setNpcTransformationId(-1);
      player.getUpdateFlag().flag(api.core.Flag.APPEARANCE);
      player.getPacketSender().sendVarbit(VARBIT_GOBLIN_FORM, 0).sendVarbit(VARBIT_GOBLIN_TYPE, 0);
    }
  }

  function payForTeleport(player) {
    if (!hasOldakMaterials(player)) {
      player.sendMessage(OLDAK_MATERIALS_HINT);
      return false;
    }
    player.getInventory().deleteNumber(LAW_RUNE_ITEM_ID, 2);
    player.getInventory().deleteNumber(MOLTEN_GLASS_ITEM_ID, 1);
    player.getInventory().adds(DORGESH_KAAN_SPHERE_ITEM_ID, 1);
    return true;
  }

  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (!option) return;
    const text = String(option);
    if (npcId === GRUBFOOT_NPC_ID && text === "Follow me.") {
      setBit(player, BIT_FOLLOWING);
      const npc = tracked(player).get("grubfoot");
      const location = player.getLocation();
      npc?.moveTo?.(new Location(location.getX() + 1, location.getY(), location.getZ()));
      return;
    }
    if (npcId === GRUBFOOT_NPC_ID && text === "I need to do something else.") {
      clearBit(player, BIT_FOLLOWING);
      return;
    }
    if (ENTRANCE_GUARD_NPC_IDS.has(npcId) && /^Yes, me/.test(text)) {
      setBit(player, BIT_GOBLIN_NAME);
      setStage(player, STAGE_TEMPLE);
      teleport(player, TEMPLE_INSIDE_TILE);
      return;
    }
    if (OLDAK_LAB_NPC_IDS.has(npcId) || npcId === OLDAK_RING_NPC_ID) {
      if (text === "Can you teleport me to the temple again?") {
        if (quest.getStage(player) === STAGE_ZANIK_TALK) setStage(player, STAGE_CITY);
        // The refusal conversation pays for the trip in its own branch (condition
        // 4j8klO + action 6cDx_0); later variants lost the jump target, so pay here.
        const firstOldakVisit =
          quest.getStage(player) === STAGE_REFUSED && !hasBit(player, BIT_ASKED_OLDAK);
        if (firstOldakVisit) return;
        if (payForTeleport(player)) teleport(player, CAVE_TELEPORT_TILE);
        return;
      }
      if (text === "Can I buy a teleport sphere please?") {
        payForTeleport(player);
        return;
      }
      if (text === "I'll go and see this mage.") {
        setBit(player, BIT_ASKED_OLDAK);
        return;
      }
    }
    if (npcId === NpcIdentifiers.STRONGBONES_2 && /^Where is Yu'biusk/.test(text)) {
      setStage(player, STAGE_YUBIUSK_KNOWN);
    }
  }

  function finishCutscene(player) {
    Scenes.cancel(player);
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
  }

  function startDreamCutscene(player) {
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    Scenes.camera(player, [3864, 4369, 520], [3853, 4384, 320], { rate: 232, rate2: 232 });
    Scenes.later(player, 2, () => {
      Scenes.fade(player, false);
      Scenes.camera(player, [3868, 4384, 560], [3880, 4384, 320], { rate: 2, rate2: 0 });
    });
    Scenes.later(player, 4, () => {
      Scenes.camera(player, [3868, 4391, 540], [3868, 4395, 340], { rate: 1, rate2: 0 });
    });
    Scenes.later(player, 25, () => finishCutscene(player));
  }

  function startYubiuskCutscene(player) {
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    Scenes.camera(player, [3568, 4366, 450], [3576, 4374, 250], { rate: 232, rate2: 232 });
    Scenes.later(player, 3, () => {
      Scenes.fade(player, false);
      Scenes.camera(player, [3546, 4389, 580], [3537, 4389, 380], { rate: 232, rate2: 232 });
    });
    Scenes.later(player, 8, () => {
      Scenes.camera(player, [3534, 4396, 650], [3537, 4390, 350]);
    });
    Scenes.later(player, 10, () => {
      setFairyRingAnimating(player, 0);
      finishCutscene(player);
    });
  }

  function startBoxCutscene(player) {
    Scenes.cancel(player);
    Scenes.controls(player, true, true);
    Scenes.camera(player, [3546, 4389, 580], [3537, 4389, 380], { rate: 232, rate2: 232 });
    Scenes.later(player, 3, () => {
      Scenes.camera(player, [3534, 4396, 650], [3537, 4390, 350]);
    });
    Scenes.later(player, 8, () => finishCutscene(player));
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!stepId || !ACTION_STEP_IDS.has(stepId)) return;
    if (stepId === GRUBFOOT_LEAVES_ACTION_ID) {
      event.handled = true;
      setBit(player, BIT_GRUBFOOT_LEFT);
      if (quest.getStage(player) < STAGE_ZANIK_TALK) setStage(player, STAGE_ZANIK_TALK);
      syncQuestNpcs(player);
      return;
    }
    if (stepId === TELEPORT_TO_CAVE_ACTION_ID) {
      event.handled = true;
      setStage(player, STAGE_CAVE);
      teleport(player, CAVE_TELEPORT_TILE);
      return;
    }
    if (stepId === PAID_TELEPORT_ACTION_ID) {
      event.handled = true;
      if (payForTeleport(player)) teleport(player, CAVE_TELEPORT_TILE);
      return;
    }
    if (stepId === ZANIK_ENTERS_TEMPLE_ACTION_ID) {
      event.handled = true;
      setBit(player, BIT_GUARDS_REFUSED);
      if (quest.getStage(player) < STAGE_REFUSED) setStage(player, STAGE_REFUSED);
      syncQuestNpcs(player);
      return;
    }
    if (ZANIK_ESCAPES_ACTION_IDS.has(stepId)) {
      event.handled = true;
      setBit(player, BIT_ZANIK_FREED);
      setStage(player, STAGE_FREED);
      return;
    }
    if (stepId === BIGHEAD_TEST_DONE_ACTION_ID) {
      event.handled = true;
      setBit(player, BIT_TEST_DONE);
      setStage(player, STAGE_TEST);
      return;
    }
    if (stepId === CUTSCENE_START_ACTION_ID || stepId === DREAM_CUTSCENE_START_ACTION_ID) {
      event.handled = true;
      startDreamCutscene(player);
      return;
    }
    if (stepId === DREAM_CUTSCENE_END_ACTION_ID) {
      event.handled = true;
      finishCutscene(player);
      return;
    }
    if (stepId === ARRIVE_YUBIUSK_ACTION_ID) {
      event.handled = true;
      setStage(player, STAGE_YUBIUSK);
      teleport(player, YUBIUSK_TELEPORT_TILE);
      setFairyRingAnimating(player, 2);
      startYubiuskCutscene(player);
      return;
    }
    if (stepId === BOX_SUCKED_ACTION_ID) {
      event.handled = true;
      setBit(player, BIT_BOX_OPENED);
      setStage(player, STAGE_BOX);
      startBoxCutscene(player);
      removeTracked(player, "zanik-yubiusk");
      return;
    }
    if (stepId === BOX_PLAYER_PORTAL_ACTION_ID) {
      event.handled = true;
      teleport(player, LAB_RETURN_TILE);
      return;
    }
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      event.handled = true;
      finishCutscene(player);
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (stepId === AGGIE_WHITE_MAIL_ACTION_ID) {
      event.handled = true;
      const mail = [...DYED_MAIL_ITEM_IDS].find((itemId) => held(player, itemId));
      if (mail === undefined || !held(player, WHITEFISH_ITEM_ID) || !held(player, COINS_ITEM_ID, 5)) {
        return;
      }
      player.getInventory().deleteNumber(mail, 1);
      player.getInventory().deleteNumber(WHITEFISH_ITEM_ID, 1);
      player.getInventory().deleteNumber(COINS_ITEM_ID, 5);
      player.getInventory().adds(WHITE_GOBLIN_MAIL_ITEM_ID, 1);
      player.sendMessage(
        "You hand the goblin mail, whitefish, and payment to Aggie. She uses the whitefish to " +
          "remove the dye from the goblin mail and then hands it back to you."
      );
    }
  }

  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!text) return;
    const value = String(text);
    if (AGGIE_NPC_IDS.has(npcId) && value.includes("bring me a Hemenster Whitefish and five coins")) {
      setBit(player, BIT_KNOWS_WHITEFISH);
      syncQuestVarbits(player);
      return;
    }
    if (
      (OLDAK_LAB_NPC_IDS.has(npcId) || npcId === OLDAK_RING_NPC_ID) &&
      quest.getStage(player) === STAGE_MACHINE &&
      value.includes("The inner circle has a radius of one zurg")
    ) {
      setBit(player, BIT_MACHINE_EXPLAINED);
      syncQuestVarbits(player);
      return;
    }
    if (npcId === MAKEOVER_MAGE_NPC_ID || npcId === NpcIdentifiers.MAKEOVER_MAGE) {
      if (value.includes("add some pharmakos berries")) {
        if (quest.getStage(player) < STAGE_MAGE) setStage(player, STAGE_MAGE);
        if (quest.getStage(player) === STAGE_MAGE) setStage(player, STAGE_POTION);
        return;
      }
      if (quest.getStage(player) === STAGE_REFUSED) setStage(player, STAGE_MAGE);
      return;
    }
    if (ENTRANCE_GUARD_NPC_IDS.has(npcId) && value.includes("Only goblins allowed")) {
      if (quest.getStage(player) === STAGE_CAVE) setStage(player, STAGE_REFUSED);
      return;
    }
    if (npcId === HIGH_PRIEST_BIGHEAD_NPC_ID && value.includes("Crypt door locked by six keys")) {
      if (quest.getStage(player) === STAGE_CRYPT_KNOWN) setStage(player, STAGE_KEYS);
      return;
    }
    if (CRYPT_GHOST_VARIANT_BY_ID.has(npcId)) {
      if (value.startsWith("Snailfeet. That his name.") && quest.getStage(player) < STAGE_SNAILFEET) {
        setStage(player, STAGE_SNAILFEET);
      } else if (value === "Mosschin." && quest.getStage(player) < STAGE_MOSSCHIN) {
        setStage(player, STAGE_MOSSCHIN);
      } else if (value.startsWith("Redeyes.") && quest.getStage(player) < STAGE_REDEYES) {
        setStage(player, STAGE_REDEYES);
      } else if (value.startsWith("Strongbones. He was") && quest.getStage(player) < STAGE_STRONGBONES) {
        setStage(player, STAGE_STRONGBONES);
      } else if (value.includes("another plane of existence") && quest.getStage(player) < STAGE_YUBIUSK_KNOWN) {
        setStage(player, STAGE_YUBIUSK_KNOWN);
      }
      return;
    }
    if (
      (OLDAK_LAB_NPC_IDS.has(npcId) || npcId === OLDAK_RING_NPC_ID || npcId === ZANIK_LAB_NPC_ID) &&
      value.includes("meet us by the fungus ring") &&
      quest.getStage(player) === STAGE_YUBIUSK_KNOWN
    ) {
      setStage(player, STAGE_MACHINE);
    }
  }

  // ==========================================================================
  // NPC interactions: Pass, Pickpocket, Buy-sphere
  // ==========================================================================

  function passEnclaveGuard(player, npcId) {
    // Post-quest entry is still canonical; it grants no stage, key or item progress.
    if (quest.getStage(player) < STAGE_TEMPLE) return;
    const tribe = GUARD_TRIBE_BY_ID.get(npcId);
    if (tribe === undefined) return;
    const pass = TRIBE_GUARD_PASS[tribe];
    const location = player.getLocation();
    if (location.getZ() !== 0) return;
    const at = (tile) =>
      location.getX() === tile.x && location.getY() === tile.y;
    const guard = TRIBE_GUARD_TILES[tribe];
    const adjacent =
      Math.max(Math.abs(location.getX() - guard.x), Math.abs(location.getY() - guard.y)) <= 1;
    const fromDistance = Math.abs(location.getX() - pass.from.x) + Math.abs(location.getY() - pass.from.y);
    const toDistance = Math.abs(location.getX() - pass.to.x) + Math.abs(location.getY() - pass.to.y);
    const leaving = !at(pass.from) && toDistance < fromDistance;
    const correct = wornBodyId(player) === TRIBE_MAIL_IDS[tribe];
    enclaveTribe.set(player, { tribe, leaving });
    startTranscript(api, player, npcId, PAGE, "the-temple-of-tribes-talking-to-enclave-guards");
    if (correct) {
      // Npc interaction may have auto-pathed to a cardinal guard tile, not the exact
      // captured mouth tile, so cross from any valid adjacent approach.
      if (adjacent) walkGuardPass(player, leaving ? pass.from : pass.to);
    } else if (leaving) {
      // Captured throw-out (1694): player is moved back to the hall-side mouth.
      player.moveTo(new Location(pass.from.x, pass.from.y, 0));
    }
  }

  function pickpocketPriest(player, npcId) {
    const tribe = PRIEST_TRIBE_BY_ID.get(npcId);
    if (tribe === undefined || !questActive(player) || quest.getStage(player) < STAGE_KEYS) return;
    const keyId = TRIBE_KEY_IDS[tribe];
    const ownsKey = held(player, keyId) || bankedAmount(player, keyId) > 0;
    // The saved mask alone is not ownership: a key can be lost before the crypt. Re-stolen
    // keys are only credited once the physical key has been given.
    if (hasKey(player, tribe) && ownsKey) {
      player.sendMessage("You have already stolen this priest's key.");
      return;
    }
    if (!ownsKey) {
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You don't have enough inventory space.");
        return;
      }
      player.getInventory().adds(keyId, 1);
    }
    setKeysMask(player, keysMask(player) | (1 << tribe));
    if (allKeysHeld(player)) player.sendMessage("You have taken the keys of all six tribes.");
  }

  function buySphere(player) {
    if (hasOldakMaterials(player)) payForTeleport(player);
    else player.sendMessage(OLDAK_MATERIALS_HINT);
  }

  /**
   * Quest NPC ids the dialogue index does not map to the "Land of the Goblins" page
   * (11255/11259 Grubfoot, 11260/11261/11264 Zanik, 11314/11315 entrance guards):
   * NpcDialogues cannot select a variant for them, so their Talk-to plays the variant
   * this plugin picks, through startTranscript.
   */
  const OWN_TALK_NPC_IDS = new Set([
    GRUBFOOT_NPC_ID,
    GRUBFOOT_POST_NPC_ID,
    ZANIK_LAB_NPC_ID,
    ZANIK_CAVE_NPC_ID,
    ZANIK_PRISON_NPC_ID,
    ...ENTRANCE_GUARD_NPC_IDS,
  ]);

  /** Wiki action/unavailable markers precede the real post-test Bighead questions. */
  function withoutWikiMarkers(steps) {
    let start = 0;
    while (start < steps.length && ["action", "unavailable"].includes(steps[start].type)) start++;
    return steps.slice(start);
  }

  function handleNpcInteraction(event) {
    const { player, npcId, clickType, definition } = event;
    const option = definition?.getActions?.()?.[clickType - 1];
    if (!option) return;
    if (option === "Talk-to" && OWN_TALK_NPC_IDS.has(npcId)) {
      const variant = selectVariant({ npcId, player });
      if (!variant) return;
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, variant);
      return;
    }
    if (option === "Talk-to" && npcId === HIGH_PRIEST_BIGHEAD_NPC_ID &&
        questActive(player) && quest.getStage(player) >= STAGE_TEST) {
      const variant = selectVariant({ npcId, player });
      if (!variant) return;
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, variant, withoutWikiMarkers);
      return;
    }
    if (option === "Buy-sphere" && npcId === OLDAK_RING_NPC_ID) {
      event.handled = true;
      buySphere(player);
      return;
    }
    if (option === "Pass" && GUARD_TRIBE_BY_ID.has(npcId)) {
      event.handled = true;
      passEnclaveGuard(player, npcId);
      return;
    }
    if (option === "Pickpocket" && PRIEST_TRIBE_BY_ID.has(npcId)) {
      event.handled = true;
      pickpocketPriest(player, npcId);
    }
  }

  // ==========================================================================
  // Crypt fights
  // ==========================================================================

  // Walkable crypt tiles beside each grave (the grave tiles themselves block).
  const GRAVE_SPAWN_TILES = [
    { x: 3740, y: 4385 },
    { x: 3744, y: 4385 },
    { x: 3740, y: 4389 },
    { x: 3744, y: 4389 },
    { x: 3742, y: 4391 },
  ];
  // Walkable tiles around Strongbones' grave for the Skoblins he summons.
  const SKOBLIN_SPAWN_TILES = [
    { x: 3741, y: 4390 },
    { x: 3743, y: 4390 },
    { x: 3742, y: 4392 },
  ];

  function sayGraveName(player, objectId) {
    if (!questActive(player) || !hasBit(player, BIT_CRYPT_UNLOCKED)) {
      player.sendMessage("The crypt gate is sealed.");
      return;
    }
    const index = CRYPT_GRAVE_OBJECT_IDS.indexOf(objectId);
    if (index === -1 || hasCryptBit(player, index)) return;
    if (tracked(player).has(`crypt-attacker-${index}`)) return;
    player.sendMessage("You say the name of the ancient high priest.");
    spawnTracked(player, `crypt-attacker-${index}`, CRYPT_ATTACKER_NPC_IDS[index], GRAVE_SPAWN_TILES[index]);
    if (index === STRONGBONES_INDEX) {
      SKOBLIN_SPAWN_TILES.forEach((tile, i) => {
        spawnTracked(player, `crypt-skoblin-${i}`, SKOBLIN_NPC_ID, tile);
      });
    }
  }

  function handleNpcDeath(event) {
    const { killer, npc } = event;
    if (!killer || !npc) return;
    const index = CRYPT_ATTACKER_NPC_IDS.indexOf(npc.getId?.());
    if (index === -1) return;
    const location = npc.getLocation();
    api.removeNpc(npc);
    tracked(killer).delete(`crypt-attacker-${index}`);
    if (index === STRONGBONES_INDEX) {
      SKOBLIN_SPAWN_TILES.forEach((_, i) => removeTracked(killer, `crypt-skoblin-${i}`));
    }
    setCryptBit(killer, index);
    const ghost = api.spawnNpc({
      id: CRYPT_GHOST_NPC_IDS[index],
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: killer,
      ownerOnly: true,
    });
    trackNpc(killer, `crypt-ghost-${index}`, ghost);
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function pickPharmakosBerries(player) {
    if (quest.getStage(player) < STAGE_MAGE) {
      player.sendMessage(PHARMAKOS_MESSAGE);
      return;
    }
    player.getInventory().adds(PHARMAKOS_BERRIES_ITEM_ID, 1);
  }

  function searchSphereCrate(player) {
    if (quest.getStage(player) < STAGE_TEMPLE || quest.isComplete(player)) return;
    if (hasBit(player, BIT_FOUND_SPHERE)) {
      player.sendMessage("The crate is empty.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    setBit(player, BIT_FOUND_SPHERE);
    if (quest.getStage(player) < STAGE_SPHERE) setStage(player, STAGE_SPHERE);
    player.getInventory().adds(DORGESH_KAAN_SPHERE_ITEM_ID, 1);
  }

  function searchArmourCrate(player) {
    if (!questActive(player) || quest.getStage(player) < STAGE_TEMPLE) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    if (held(player, GOBLIN_MAIL_ITEM_ID, TRIBE_COUNT)) {
      player.sendMessage("You have already taken enough goblin mail.");
      return;
    }
    player.getInventory().adds(GOBLIN_MAIL_ITEM_ID, 1);
  }

  function openCryptGate(player) {
    if (hasBit(player, BIT_CRYPT_UNLOCKED)) {
      teleport(player, player.getLocation().getY() <= 4380 ? { x: 3742, y: 4383 } : { x: 3742, y: 4380 });
      return;
    }
    if (!allKeysHeld(player)) {
      player.sendMessage("The gate is locked. It needs the keys of all six tribal priests.");
      return;
    }
    for (let tribe = 0; tribe < TRIBE_COUNT; tribe++) {
      player.getInventory().deleteNumber(TRIBE_KEY_IDS[tribe], 1);
    }
    setKeysMask(player, 0);
    setBit(player, BIT_CRYPT_UNLOCKED);
    setStage(player, STAGE_CRYPT);
    player.sendMessage("You unlock the crypt gate with the six keys.");
    teleport(player, { x: 3742, y: 4383 });
    setStage(player, STAGE_SNOTHEAD);
  }

  function machineValues(player) {
    let values = machinePower.get(player);
    if (!values) {
      values = MACHINE_POWER_ATTRIBUTES.map((key) => Number(player.getAttribute(key)) || 0);
      machinePower.set(player, values);
    }
    return values;
  }

  function setMachineValue(player, index, value) {
    machinePower.get(player)[index] = value;
    player.setAttribute(MACHINE_POWER_ATTRIBUTES[index], value);
  }

  function sendMachineValues(player, values) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_MACHINE_1, values[0]);
    sender.sendVarbit(VARBIT_MACHINE_2, values[1]);
    sender.sendVarbit(VARBIT_MACHINE_3, values[2]);
  }

  function adjustMachine(player) {
    if (!questActive(player) || quest.getStage(player) !== STAGE_MACHINE) {
      player.sendMessage("The machine is not ready to be adjusted.");
      return;
    }
    const values = machineValues(player);
    sendMachineValues(player, values);
    player.getPacketSender().sendSubInterface(MACHINE_FLOATER_UID, MACHINE_INTERFACE, 1);
  }

  function handleMachineInterface(event) {
    const { player, buttonId } = event;
    if ((buttonId >> 16) !== MACHINE_INTERFACE) return;
    const child = buttonId & 0xffff;
    const values = machineValues(player);
    if (MACHINE_ADD.has(child)) {
      event.handled = true;
      const index = MACHINE_ADD.get(child);
      setMachineValue(player, index, Math.min(15, values[index] + 1));
      sendMachineValues(player, values);
      return;
    }
    if (MACHINE_SUBTRACT.has(child)) {
      event.handled = true;
      const index = MACHINE_SUBTRACT.get(child);
      setMachineValue(player, index, Math.max(0, values[index] - 1));
      sendMachineValues(player, values);
      return;
    }
    if (child === MACHINE_CONFIRM) {
      event.handled = true;
      if (values.some((value, index) => value !== MACHINE_TARGET[index])) {
        player.sendMessage("The relay buzzes; the power is not distributed correctly.");
        return;
      }
      player.getPacketSender().closeSubInterface(MACHINE_FLOATER_UID);
      setFairyRingAnimating(player, 1);
      startTranscript(
        api,
        player,
        OLDAK_RING_NPC_ID,
        PAGE,
        "through-the-fungus-ring-activating-the-machine"
      );
    }
  }

  function openStrangeBox(player) {
    if (!questActive(player) || quest.getStage(player) < STAGE_YUBIUSK || hasBit(player, BIT_BOX_OPENED)) {
      player.sendMessage("The strange box is sealed shut.");
      return;
    }
    startTranscript(api, player, ZANIK_YUBIUSK_NPC_ID, PAGE, "through-the-fungus-ring-a-strange-box");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === CAVE_ENTRANCE_OBJECT_ID) {
      event.handled = true;
      teleport(player, player.getLocation().getY() >= 9000 ? CAVE_ENTRANCE_TILE : GOBLIN_CAVE_TILE);
      return;
    }
    if (objectId === BLACK_MUSHROOMS_OBJECT_ID) {
      // 6311 is shared with The Golem and world content: only claim it inside LOTG's
      // Goblin Cave while this quest is active, leaving every other placement alone.
      if (!questActive(player) || !tileInZone(event.location, BLACK_MUSHROOM_ZONE)) return;
      event.handled = true;
      player.getInventory().adds(BLACK_MUSHROOM_ITEM_ID, 1);
      player.sendMessage("You pick a mushroom.");
      return;
    }
    if (!QUEST_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    if (objectId === PHARMAKOS_BUSH_OBJECT_ID) {
      pickPharmakosBerries(player);
      return;
    }
    if (objectId === SPHERE_CRATE_OBJECT_ID) {
      searchSphereCrate(player);
      return;
    }
    if (objectId === ARMOUR_CRATE_OBJECT_ID) {
      searchArmourCrate(player);
      return;
    }
    if (objectId === TEMPLE_DOOR_OBJECT_ID) {
      const y = player.getLocation().getY();
      teleport(player, y >= 4305 ? CAVE_TELEPORT_TILE : TEMPLE_INSIDE_TILE);
      return;
    }
    if (objectId === TEMPLE_HUGE_DOOR_OBJECT_ID) {
      // The crypt corridor north of the door is only reachable through the unmapped
      // east passage, so the door moves the player across the wall directly.
      const y = player.getLocation().getY();
      teleport(player, y <= 4331 ? { x: 3742, y: 4370 } : { x: 3743, y: 4330 });
      return;
    }
    if (objectId === CRYPT_GATE_OBJECT_ID) {
      openCryptGate(player);
      return;
    }
    if (objectId === MACHINE_OBJECT_ID || objectId === MACHINE_SETUP_OBJECT_ID) {
      adjustMachine(player);
      return;
    }
    if (objectId === STRANGE_BOX_OBJECT_ID) {
      openStrangeBox(player);
      return;
    }
    if (CRYPT_GRAVE_OBJECT_IDS.includes(objectId)) {
      sayGraveName(player, objectId);
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const first = usedItemId;
    const second = usedWithItemId;
    if (first === undefined || second === undefined) return;
    const berries = first === PHARMAKOS_BERRIES_ITEM_ID ? second : second === PHARMAKOS_BERRIES_ITEM_ID ? first : null;
    if (berries === TOADFLAX_POTION_UNF_ITEM_ID) {
      event.handled = true;
      player.getInventory().deleteNumber(PHARMAKOS_BERRIES_ITEM_ID, 1);
      player.getInventory().deleteNumber(TOADFLAX_POTION_UNF_ITEM_ID, 1);
      player.getInventory().adds(ItemIdentifiers.GOBLIN_POTION_4_, 1);
      return;
    }
    const mushroomOnVial =
      (first === BLACK_MUSHROOM_ITEM_ID && second === VIAL_ITEM_ID) ||
      (first === VIAL_ITEM_ID && second === BLACK_MUSHROOM_ITEM_ID);
    if (mushroomOnVial) {
      event.handled = true;
      if (!held(player, PESTLE_AND_MORTAR_ITEM_ID)) {
        player.sendMessage("You need a pestle and mortar to grind the mushroom.");
        return;
      }
      player.getInventory().deleteNumber(BLACK_MUSHROOM_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
      player.getInventory().adds(BLACK_DYE_ITEM_ID, 1);
      return;
    }
    const pestle = first === PESTLE_AND_MORTAR_ITEM_ID ? second : second === PESTLE_AND_MORTAR_ITEM_ID ? first : null;
    if (pestle === BLACK_MUSHROOM_ITEM_ID) {
      event.handled = true;
      if (!held(player, VIAL_ITEM_ID)) {
        player.sendMessage("You need an empty vial to make the dye.");
        return;
      }
      player.getInventory().deleteNumber(BLACK_MUSHROOM_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
      player.getInventory().adds(BLACK_DYE_ITEM_ID, 1);
      return;
    }
    const mail = first === GOBLIN_MAIL_ITEM_ID ? second : second === GOBLIN_MAIL_ITEM_ID ? first : null;
    if (mail !== null && DYE_TO_MAIL.has(mail)) {
      event.handled = true;
      player.getInventory().deleteNumber(GOBLIN_MAIL_ITEM_ID, 1);
      player.getInventory().deleteNumber(mail, 1);
      player.getInventory().adds(DYE_TO_MAIL.get(mail), 1);
    }
  }

  function catchWhitefish(player) {
    if (!questActive(player) || quest.getStage(player) < STAGE_KEYS) return;
    if (!held(player, FISHING_ROD_ITEM_ID)) {
      player.sendMessage("You need a fishing rod to catch a whitefish.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().deleteNumber(RAW_SLIMY_EEL_ITEM_ID, 1);
    player.getInventory().adds(WHITEFISH_ITEM_ID, 1);
  }

  function handleAggieItem(player, itemId) {
    if (!questActive(player) || quest.getStage(player) < STAGE_KEYS) return false;
    if (itemId === WHITE_GOBLIN_MAIL_ITEM_ID) {
      startTranscript(api, player, NpcIdentifiers.AGGIE, PAGE, "keys-to-the-crypt-using-white-goblin-mail-on-aggie");
      return true;
    }
    if (itemId === WHITEFISH_ITEM_ID) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.AGGIE,
        PAGE,
        hasDyedMail(player)
          ? "keys-to-the-crypt-using-goblin-mail-on-aggie-with-necessary-items"
          : "keys-to-the-crypt-using-whitefish-on-aggie-without-any-goblin-mail"
      );
      return true;
    }
    if (DYED_MAIL_ITEM_IDS.has(itemId)) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.AGGIE,
        PAGE,
        held(player, WHITEFISH_ITEM_ID)
          ? "keys-to-the-crypt-using-goblin-mail-on-aggie-with-necessary-items"
          : "keys-to-the-crypt-using-goblin-mail-on-aggie-without-whitefish"
      );
      return true;
    }
    return false;
  }

  function hasDyedMail(player) {
    for (const itemId of DYED_MAIL_ITEM_IDS) if (held(player, itemId)) return true;
    return false;
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (AGGIE_NPC_IDS.has(npcId) && handleAggieItem(player, itemId)) {
      event.handled = true;
      return;
    }
    if (HEMENSTER_SPOT_NPC_IDS.has(npcId) && itemId === RAW_SLIMY_EEL_ITEM_ID) {
      event.handled = true;
      catchWhitefish(player);
    }
  }

  function openGoblinSelection(player, itemId) {
    if (player.getEquipment().getItems().some((item) => (item?.getId?.() ?? -1) > 0)) {
      player.sendMessage("You should remove your equipment before drinking the potion.");
      return;
    }
    if (!held(player, itemId)) return;
    pendingGoblinPotion.set(player, itemId);
    player.getPacketSender()
      .sendVarbit(VARBIT_GOBLIN_TYPE, goblinType(player))
      .sendInterface(GOBLIN_SELECTION_INTERFACE);
  }

  function confirmGoblinPotion(player) {
    const itemId = pendingGoblinPotion.get(player);
    if (itemId === undefined || !held(player, itemId)) {
      pendingGoblinPotion.delete(player);
      return;
    }
    pendingGoblinPotion.delete(player);
    const index = GOBLIN_POTION_DOSE_ITEMS.indexOf(itemId);
    player.getInventory().deleteNumber(itemId, 1);
    const next = GOBLIN_POTION_DOSE_ITEMS[index + 1];
    player.getInventory().adds(next ?? VIAL_ITEM_ID, 1);
    player.sendMessage("You drink some of your goblin transmogrification potion.");
    if (next !== undefined) {
      player.sendMessage(`You have ${4 - (index + 1)} doses of potion left.`);
    }
    player.setAttribute(GOBLIN_TYPE_ATTRIBUTE, goblinType(player));
    player.setAttribute("quest.land_of_the_goblins.goblin-name", Math.floor(Math.random() * GOBLIN_NAMES.length));
    if (quest.getStage(player) < STAGE_GOBLIN) setStage(player, STAGE_GOBLIN);
    setGoblinForm(player, true);
    player.getPacketSender().sendInterfaceRemoval();
  }

  function handleGoblinSelectionButton(event) {
    const { player, buttonId } = event;
    if ((buttonId >> 16) !== GOBLIN_SELECTION_INTERFACE) return;
    const child = buttonId & 0xffff;
    if (GOBLIN_SELECT_BUTTONS.has(child)) {
      event.handled = true;
      player.setAttribute(GOBLIN_TYPE_ATTRIBUTE, GOBLIN_SELECT_BUTTONS.get(child));
      player.getPacketSender().sendVarbit(VARBIT_GOBLIN_TYPE, GOBLIN_SELECT_BUTTONS.get(child));
      return;
    }
    if (child === GOBLIN_CONFIRM_BUTTON) {
      event.handled = true;
      confirmGoblinPotion(player);
    }
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (option !== "Drink") return;
    if (!GOBLIN_POTION_DOSE_ITEMS.includes(itemId)) return;
    event.handled = true;
    openGoblinSelection(player, itemId);
  }

  // ==========================================================================
  // Zones, login and rewards
  // ==========================================================================

  function handleQuestZoneEnter(event) {
    const { player } = event;
    if (!player || player.isPlayerBot?.() === true) return;
    if (quest.getStage(player) === STAGE_TEMPLE && inZone(player, TEMPLE_ZONE)) {
      setStage(player, STAGE_SPHERE);
    }
    if (
      quest.getStage(player) === STAGE_REFUSED &&
      inZone(player, MAGE_ZONE) &&
      player.getDialogueManager?.()?.isActive?.() !== true
    ) {
      startTranscript(api, player, MAKEOVER_MAGE_NPC_ID, PAGE, "imposter-among-goblins-talking-to-the-makeover-mage");
    }
    syncQuestNpcs(player);
  }

  /** Old odd stages (10/15/20/25/.../60) -> captured even stages. Idempotent by version. */
  function migrateSave(player) {
    if ((Number(player.getAttribute(MIGRATION_ATTRIBUTE)) || 0) >= MIGRATION_VERSION) return;
    const old = quest.getStage(player);
    let next = old;
    if (old === 40) next = hasBit(player, BIT_CRYPT_UNLOCKED) ? STAGE_SNOTHEAD : STAGE_KEYS;
    else if (old === 10) next = STAGE_STARTED;
    else if (old === 15) next = STAGE_CUTSCENE;
    else if (old === 20) next = STAGE_CAVE;
    else if (old === 25) next = STAGE_REFUSED;
    else if (old === 27) next = STAGE_POTION;
    else if (old === 30) next = STAGE_TEMPLE;
    else if (old === 32) next = STAGE_FREED;
    else if (old === 35) next = STAGE_TEST;
    else if (old === 49) next = STAGE_YUBIUSK_KNOWN;
    else if (old === 51) next = STAGE_YUBIUSK;
    else if (old === 55) next = STAGE_BOX;
    else if (old === 60) next = STAGE_COMPLETE;
    if (next !== old) quest.setStage(player, next);
    player.setAttribute(MIGRATION_ATTRIBUTE, MIGRATION_VERSION);
  }

  function handleLogin({ player }) {
    migrateSave(player);
    refreshQuestList(player);
    if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_STARTED) {
      player.getPacketSender().sendVarbit(VARBIT_GOBLIN_FORM, hasBit(player, BIT_GOBLIN_FORM) ? 1 : 0);
      if (hasBit(player, BIT_GOBLIN_FORM)) applyGoblinAppearance(player);
    }
    fairyRingAnimating.delete(player);
    syncQuestVarbits(player);
    syncQuestNpcs(player);
  }

  function handleLogout({ player }) {
    finishGuardPass(player);
    finishCutscene(player);
    machinePower.delete(player);
    fairyRingAnimating.delete(player);
    removeAllTracked(player);
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 8000);
    skills.addExperiences(Skill.FISHING, 8000);
    skills.addExperiences(Skill.THIEVING, 8000);
    skills.addExperiences(Skill.HERBLORE, 8000);
    setGoblinForm(player, false);
    syncQuestNpcs(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Grubfoot asked me to take him to Dorgesh-Kaan to meet Zanik, the</str>",
        "<str>Chosen Commander, and together we found the secret Goblin Temple.</str>",
        "<str>I learned Yu'biusk is another plane and powered Oldak's machine to</str>",
        "<str>reach it, but Zanik was taken by the strange box there.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BOX) {
      return [
        "<str>We reached Yu'biusk and found it a wasteland.</str>",
        "",
        "Zanik was taken into the <col=800000>strange box</col>.",
        "I should return to Oldak's lab.",
      ];
    }
    if (stage >= STAGE_YUBIUSK) {
      return [
        "<str>The machine worked and opened a portal to Yu'biusk.</str>",
        "",
        "We arrived in <col=800000>Yu'biusk</col>. I should look around",
        "and find the <col=800000>strange box</col> to the north.",
      ];
    }
    if (stage >= STAGE_MACHINE) {
      return [
        "<str>Strongbones revealed Yu'biusk is another plane of existence.</str>",
        "",
        "I should power the <col=800000>fungus ring machine</col> for Oldak",
        "in the cave south of Dorgesh-Kaan (9-4-1).",
      ];
    }
    if (stage >= STAGE_YUBIUSK_KNOWN) {
      return [
        "<str>The high priests told me of Yu'biusk, the Land of the Goblins.</str>",
        "",
        "I should tell <col=800000>Zanik and Oldak</col> in Dorgesh-Kaan.",
      ];
    }
    if (stage >= STAGE_KEYS) {
      return [
        "<str>I unlocked the temple crypt with the six tribal keys.</str>",
        "",
        "The high priests buried in the crypt may know the way to Yu'biusk.",
      ];
    }
    if (stage >= STAGE_TEST) {
      return [
        "<str>I passed High Priest Bighead's test on the Big High War God.</str>",
        "",
        "I need to steal the keys of the <col=800000>six tribal priests</col>",
        "and dye goblin mail to enter their enclaves. Aggie in Draynor can",
        "bleach a goblin mail white with a Hemenster whitefish and 5 coins.",
      ];
    }
    if (stage >= STAGE_FREED) {
      return [
        "<str>I freed Zanik from the Huzamogaarb prison with a sphere.</str>",
        "",
        "I should ask <col=800000>High Priest Bighead</col> about Yu'biusk.",
      ];
    }
    if (stage >= STAGE_GOBLIN) {
      return [
        "<str>I turned myself into a goblin and entered the Goblin Temple.</str>",
        "",
        "Zanik is imprisoned by the <col=800000>Huzamogaarb</col> tribe.",
        "Black dye on goblin mail should let me into their enclave.",
      ];
    }
    if (stage >= STAGE_MAGE) {
      return [
        "<str>The Makeover Mage told me the goblin potion recipe: a toadflax</str>",
        "<str>potion with pharmakos berries added.</str>",
        "",
        "I should return to the <col=800000>Goblin Cave</col> and drink it.",
      ];
    }
    if (stage >= STAGE_REFUSED) {
      return [
        "<str>The temple guards let Zanik in but refused me, a human.</str>",
        "",
        "I should ask <col=800000>Oldak</col> in Dorgesh-Kaan for a way to change",
        "my appearance. He mentioned the <col=800000>Makeover Mage</col>.",
      ];
    }
    if (stage >= STAGE_CAVE) {
      return [
        "<str>Grubfoot told us of a secret temple near the Goblin Cave and</str>",
        "<str>Oldak teleported us there.</str>",
        "",
        "I should find the temple entrance north-west of the cave.",
      ];
    }
    if (stage >= STAGE_CITY) {
      return [
        "<str>I took Grubfoot into Dorgesh-Kaan.</str>",
        "",
        "I should take him to <col=800000>Zanik</col> in Oldak's lab.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Grubfoot wants to meet Zanik, the Chosen Commander, in Dorgesh-Kaan.</str>",
        "",
        "I should lead him to the city entrance and on to Oldak's lab.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Grubfoot</col>",
      "outside the main entrance to Dorgesh-Kaan, in the Dorgeshuun mine.",
    ];
  }

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(KEYS_ATTRIBUTE);
  api.persistAttribute(CRYPT_ATTRIBUTE);
  api.persistAttribute(GOBLIN_TYPE_ATTRIBUTE, 1);
  MACHINE_POWER_ATTRIBUTES.forEach((key) => api.persistAttribute(key, 0));
  api.persistAttribute(MIGRATION_ATTRIBUTE, 0);
  api.persistAttribute("quest.land_of_the_goblins.goblin-name");

  quest = registerQuest(api, {
    key: "land_of_the_goblins",
    name: "Land of the Goblins",
    varpId: 3355, // lotg_base
    varbitId: VARBIT_LAND_OF_THE_GOBLINS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 8000, label: "Agility" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 8000, label: "Herblore" },
      { skillId: Skill.THIEVING.getIndex(), amount: 8000, label: "Thieving" },
      { skillId: Skill.FISHING.getIndex(), amount: 8000, label: "Fishing" },
    ],
    scrollItemId: ItemIdentifiers.GOBLIN_POTION_3_,
    otherRewards: [],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onInterfaceActionButton([...GOBLIN_SELECT_BUTTONS.keys(), GOBLIN_CONFIRM_BUTTON].map((child) => (GOBLIN_SELECTION_INTERFACE << 16) | child), handleGoblinSelectionButton);
  api.onInterfaceActionButton([...MACHINE_ADD.keys(), ...MACHINE_SUBTRACT.keys(), MACHINE_CONFIRM].map((child) => (MACHINE_INTERFACE << 16) | child), handleMachineInterface);
  api.onObjectInteraction(handleObjectInteraction);
  api.onZoneEnter(MINE_ZONE, handleQuestZoneEnter);
  api.onZoneEnter(CITY_ZONE, handleQuestZoneEnter);
  api.onZoneEnter(TEMPLE_ZONE, handleQuestZoneEnter);
  api.onZoneEnter(RING_ZONE, handleQuestZoneEnter);
  api.onZoneEnter(MAGE_ZONE, handleQuestZoneEnter);
  api.onZoneEnter(YUBIUSK_ZONE, handleQuestZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onWalkRoute(cancelGuardPass);
};
