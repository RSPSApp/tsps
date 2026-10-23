/**
 * Monkey Madness II (members).
 *
 * The words come from the "Monkey Madness II" transcript page (plus the character
 * pages for the post-quest variants); this plugin supplies the variant selector for
 * every quest NPC it owns (Talk-to is claimed here because the Grand Tree and
 * Monkey Madness I selectors are registered earlier and would win the variant
 * hook), the prose-condition answers, chapter I (Glough's house, the note puzzle,
 * Anita, Lori, Auguste), chapter II (Garkor, Awowogei, the monkey archer, Kruk's
 * lair, Zooknock's Kruk greegree), chapter III (Kob, Keef, Le Smith, the airship
 * platform, Glough's laboratory), chapter IV (the Stronghold attack with Nieve)
 * and chapter V (the Crash Site caves and Glough).
 *
 * Stages (varbit 5027 "mm2_progress", varp 1339 bits 0-8; the cache dbTable "quest"
 * row 96 gives endstate 195, and NpcType transforms keyed to the same varbit prove
 * the intermediate values: Garkor 7181 -> 7158 for 0-129 and -1 from 130, the
 * breach Garkor 7111 at 140/145/150/..., Le Smith 6806 for mm2_le_smith_pos 1-4,
 * Nieve 7108 for mm2_nieve_at_tree 1). The values below are chosen so every NPC
 * visibility boundary the quest relies on is hit exactly):
 *   5   started - accepted from King Narnode
 *   10  investigated the tree in Glough's home (handkerchief)
 *   15  returned the handkerchief to Anita and heard her clue
 *   20  searched the upper floor: spy book, brush and mysterious note
 *   25  decrypted the note (lemon, candles, grapes, brush)
 *   30  showed the note to Narnode (translation book in hand)
 *   32  translation book used on the note
 *   35  Anita translated the note (translated note)
 *   40  showed the translated note to Narnode
 *   45  asked Assistant Lori who she is
 *   50  Auguste revealed Le Smith flew to Ape Atoll
 *   55  Narnode re-assigned the player to Ape Atoll
 *   60  Garkor briefed the player (speak to Awowogei)
 *   61  Awowogei asked the player to fetch Kruk
 *   62  Garkor's order: kill Kruk for a greegree
 *   65  the monkey archer pointed to the west ramp
 *   66  Kruk killed, paw taken
 *   70  Zooknock made the Kruk monkey greegree
 *   71  Awowogei told Kruk's battle plans
 *   72  Garkor's next order: convince the trolls and ogres
 *   73  Kob challenged (combat Kob out)
 *   74  Kob defeated
 *   75  Keef challenged (combat Keef out)
 *   76  Keef defeated
 *   77  Garkor revealed Le Smith is on Ape Atoll
 *   78  Le Smith revealed the airship fleet
 *   80  Garkor's order: sabotage the airships (and arrival on the platform)
 *   82  six charges planted
 *   83  Garkor's order: find Glough's secret laboratory
 *   85  entered the laboratory (tortured gorillas out)
 *   90  the three laboratory gorillas subdued
 *   95  charged onyx taken from the device
 *   100 incubator corrupted
 *   105 Garkor's order: tell Awowogei his plans failed
 *   110 Awowogei told; the attack is called off
 *   115 Garkor's cutscene: Glough's airship heads for the Stronghold
 *   120 warned King Narnode
 *   140 recruited Nieve
 *   145 four tortured gorillas defeated in the Stronghold
 *   150 Garkor at the breach: find the crash site
 *   155 entered the Crash Site cavern
 *   160 the cave gorillas defeated; Glough consumes the mutagen
 *   165 Glough defeated
 *   170 Zooknock pulled the player out and offered a teleport
 *   195 reported back to King Narnode - quest complete
 *
 * The lab values are pinned to the cache transforms: the incubator multi-loc
 * (28805) resolves to 15638 only at 80/85/90/95 and 16467 at 100/105/110/115, and
 * the lab passage multi (28813) only has Enter from 80. The other multi-locs the
 * quest clicks resolve through their own varbits (28800 mm2_found_handkerchief,
 * 28659 mm2_antias_clue, 28810 mm2_tracking_kruk, 28663 mm2_read_note); syncSideVarps
 * keeps those in step with the stage.
 *
 * Sources: OSRS Wiki "Monkey Madness II", its Quick guide and Transcript page;
 * the cache for every id, placement, varbit and NPC transform (dump:loc, varbit
 * lookup); no other private-server source was used.
 *
 * Gaps / approximations:
 *  - Prerequisites: Monkey Madness I, Enlightened Journey, The Eyes of Glouphrie,
 *    Troll Stronghold, Watchtower, the skill levels and Freeing King Awowogei
 *    (Recipe for Disaster rescue flag 128) are checked. The balloon-route varbit
 *    (ZEP_MULTI_GNO, 2870) is read by no plugin in this repo, so it cannot be
 *    checked; Enlightened Journey completion stands in for it.
 *  - The jungle-grass trapdoor now reaches the start of the real agility dungeon;
 *    the player reaches Kruk through the cache's cavern entrance after traversing
 *    it. The cached hazards, maze routes and shortcut are left to their normal
 *    world interactions and have not been verified in a live run. The lab passage
 *    now leads to the stunted-gorilla interaction; its climb starts the encounter,
 *    and the holding-area Use action is required before the device can be reached.
 *    Airship satchels are filled at the barrel and each ship target consumes a
 *    filled satchel, but the upper-floor/guard-catch stealth route remains outside
 *    this plugin. The Crash Site cave's own Enter teleport (LocTeleports) is left
 *    in place and a zone hook plays the arrival dialogue.
 *  - Instanced fights are owner-only spawns: Kruk (6805), Kob (7107), Keef (7105),
 *    the three lab gorillas (7095), four Stronghold gorillas (7097) and demonic
 *    Glough (7101). The Crash Site gorillas (7150/7151, 7144-7149) already exist
 *    as static spawns and are counted instead. Multi-phase Glough is one spawn.
 *  - Nieve does not follow: being "recruited" is the stage, and the fight credit
 *    is counted on the player's own kills.
 *  - Zooknock's Kruk-greegree conversation has no MM2 transcript anywhere in the
 *    npc-dialogues dump (his page only has the post-quest variant), so it is a
 *    functional message, as is the device's chisel/replace step (the transcript's
 *    own messages cover it).
 *  - Talking to Awowogei through the throne object (4771) is claimed by the
 *    Monkey Madness I plugin, which sets `handled` even when its own dialogue
 *    no-ops; this plugin spawns its own owner-only mm2_awowogei (6812) instead
 *    and releases it at stage 195. The post-quest throne conversation therefore
 *    stays with MM1 until it yields object 4771.
 *    Same class of conflict for post-quest Garkor/Lumo/Zooknock is avoided by
 *    owning Talk-to here.
 *  - Kruk's remains are a player-owned object 28675 at his lair while stage 66
 *    is active, so a destroyed paw can be recovered by Take-remains.
 *  - The player's own pet is never detected, so Nieve's pet condition is answered
 *    "no pet". Le Smith is pinned to position 1 (mm2_le_smith_pos = 1).
 */
module.exports = function registerMonkeyMadnessIIQuest(api) {
  const {
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  // ==========================================================================
  // Ids and constants
  // ==========================================================================

  const PAGE = "Monkey Madness II";
  const NARNODE_PAGE = "King Narnode Shareen";
  const ANITA_PAGE = "Anita";
  const GARKOR_PAGE = "Garkor";
  const ZOOKNOCK_PAGE = "Zooknock";
  const AWOWOGEI_PAGE = "Awowogei";
  const POST_QUEST = "standard-dialogue-after-monkey-madness-ii";
  const POST_QUEST_CHAR = "after-completing-monkey-madness-ii";

  const VARBIT_MM2_PROGRESS = 5027; // varp 1339, bits 0-8; completes at 195
  const VARBIT_READ_NOTE = 5028; // mm2_read_note: 1 once the scrawled note is read
  const VARBIT_ANTIAS_CLUE = 5030; // mm2_antias_clue: 1 shows the upper tree branch
  const VARBIT_TRACKING_KRUK = 5033; // mm2_tracking_kruk: 1 reveals the trapdoor
  const VARBIT_NIEVE_AT_TREE = 5038; // mm2_nieve_at_tree: 1 shows Nieve 7108
  const VARBIT_LE_SMITH_POS = 5040; // mm2_le_smith_pos: 1-4 show Le Smith 6806
  const VARBIT_FOUND_HANDKERCHIEF = 5039; // 1 tree branch, 2 found
  const VARBIT_KOB_CHALLENGE = 5067; // 1 hides the non-combat Kob (1452)
  const VARBIT_KEEF_CHALLENGE = 5066; // 1 hides the non-combat Keef (1451)

  const STAGE_STARTED = 5;
  const STAGE_HANDKERCHIEF = 10;
  const STAGE_ANITA = 15;
  const STAGE_UPSTAIRS = 20;
  const STAGE_DECRYPTED = 25;
  const STAGE_BOOK_SHOWN = 30;
  const STAGE_NOTE_ATTEMPTED = 32;
  const STAGE_TRANSLATED = 35;
  const STAGE_KING_TOLD = 40;
  const STAGE_LORI_ASKED = 45;
  const STAGE_AUGUSTE_ASKED = 50;
  const STAGE_CH1_DONE = 55;
  const STAGE_GARKOR_BRIEFED = 60;
  const STAGE_AWOWOGEI_ASKED = 61;
  const STAGE_GARKOR_KRUK = 62;
  const STAGE_ARCHER_ASKED = 65;
  const STAGE_KRUK_KILLED = 66;
  const STAGE_GREE_GREE = 70;
  const STAGE_AWOWOGEI_AS_KRUK = 71;
  const STAGE_CH2_DONE = 72;
  const STAGE_KOB_CHALLENGE = 73;
  const STAGE_KOB_DEFEATED = 74;
  const STAGE_KEEF_CHALLENGE = 75;
  const STAGE_KEEF_DEFEATED = 76;
  const STAGE_SMITH_HUNT = 77;
  const STAGE_SMITH_TALKED = 78;
  const STAGE_GARKOR_PLATFORM = 80;
  const STAGE_PLATFORM = 80;
  const STAGE_SHIPS_SABOTAGED = 82;
  const STAGE_GARKOR_LAB = 83;
  const STAGE_LAB_ARRIVED = 85;
  const STAGE_LAB_GORILLAS = 90;
  const STAGE_MUTAGEN_TAKEN = 95;
  const STAGE_MUTAGEN_CORRUPTED = 100;
  const STAGE_GARKOR_AFTER_LAB = 105;
  const STAGE_AWOWOGEI_TOLD = 110;
  const STAGE_CH3_DONE = 115;
  const STAGE_KING_TOLD_2 = 120;
  const STAGE_NIEVE_RECRUITED = 140;
  const STAGE_STRONGHOLD_GORILLAS = 145;
  const STAGE_GARKOR_BREACH = 150;
  const STAGE_CRASH_ENTERED = 155;
  const STAGE_CRASH_GORILLAS = 160;
  const STAGE_GLOUGH_DEFEATED = 165;
  const STAGE_ZOOKNOCK_SAVED = 170;
  const STAGE_COMPLETE = 195;

  const NARNODE_IDS = new Set([
    NpcIdentifiers.KING_NARNODE_SHAREEN, // 8019
    NpcIdentifiers.KING_NARNODE_SHAREEN_2, // 8020
    1423, // spawn placeholder resolved through mm2_progress
  ]);
  const ANITA_IDS = new Set([
    NpcIdentifiers.ANITA, // 7156
    NpcIdentifiers.ANITA_2, // 7157
    7180, // spawn placeholder
  ]);
  const LORI_IDS = new Set([
    NpcIdentifiers.ASSISTANT_LORI, // 7154
    7179, // spawn placeholder
  ]);
  const AUGUSTE_IDS = new Set([
    NpcIdentifiers.AUGUSTE, // 4715
    NpcIdentifiers.AUGUSTE_2, // 4716
    NpcIdentifiers.AUGUSTE_3, // 4717
    NpcIdentifiers.AUGUSTE_4, // 4718
  ]);
  const GARKOR_IDS = new Set([
    NpcIdentifiers.GARKOR, // 1434
    NpcIdentifiers.GARKOR_2, // 7111, breach
    NpcIdentifiers.GARKOR_3, // 7158, Ape Atoll
    NpcIdentifiers.GARKOR_4, // 7159
    7181, // spawn placeholder
  ]);
  const GARKOR_BREACH_IDS = new Set([NpcIdentifiers.GARKOR_2, 7111]);
  const LUMO_IDS = new Set([
    NpcIdentifiers.LUMO, // 1435
    NpcIdentifiers.LUMO_2, // 7112
    NpcIdentifiers.LUMO_3, // 7160
    NpcIdentifiers.LUMO_4, // 7161
    1457, // spawn placeholder
  ]);
  const ZOOKNOCK_IDS = new Set([
    NpcIdentifiers.ZOOKNOCK, // 1442
    NpcIdentifiers.ZOOKNOCK_2, // 7113
    NpcIdentifiers.ZOOKNOCK_3, // 7170
    NpcIdentifiers.ZOOKNOCK_4, // 7171
    1458, // spawn placeholder at the Crash Site
  ]);
  const AWOWOGEI_MM2_ID = 6812; // mm2_awowogei (spawned owner-only)
  const ARCHER_IDS = new Set([
    NpcIdentifiers.MONKEY_ARCHER, // 5272
    NpcIdentifiers.MONKEY_ARCHER_2, // 5273
    NpcIdentifiers.MONKEY_ARCHER_3, // 5274
    NpcIdentifiers.MONKEY_ARCHER_5, // 6813
  ]);
  const KRUK_IDS = new Set([
    NpcIdentifiers.KRUK_2, // 6804, non-combat
    NpcIdentifiers.KRUK_3, // 6805, combat
  ]);
  const KOB_IDS = new Set([
    NpcIdentifiers.KOB, // 7106, non-combat
    NpcIdentifiers.KOB_2, // 7107, combat
    1452, // spawn placeholder
  ]);
  const KEEF_IDS = new Set([
    NpcIdentifiers.KEEF, // 7104, non-combat
    NpcIdentifiers.KEEF_2, // 7105, combat
    1451, // spawn placeholder
  ]);
  const SMITH_IDS = new Set([
    NpcIdentifiers.ASSISTANT_LE_SMITH, // 4722
    NpcIdentifiers.ASSISTANT_LE_SMITH_2, // 6806
    6807, 6808, 6809, 6810, // mm2_le_smith_pos placeholders
  ]);
  const BOAT_GUARD_ID = NpcIdentifiers.MONKEY_GUARD_4; // 6811
  const NIEVE_IDS = new Set([
    NpcIdentifiers.NIEVE, // 6797
    NpcIdentifiers.NIEVE_2, // 7108
    NpcIdentifiers.NIEVE_3, // 7109
    NpcIdentifiers.NIEVE_4, // 7110
    1455, // spawn placeholder
  ]);
  const GLOUGH_CAVERN_ID = NpcIdentifiers.GLOUGH_3; // 7100
  const GLOUGH_LAB_ID = NpcIdentifiers.GLOUGH_7; // 7115
  const GLOUGH_DEMON_ID = NpcIdentifiers.GLOUGH_4; // 7101
  const LAB_GORILLA_ID = NpcIdentifiers.TORTURED_GORILLA; // 7095
  const STRONGHOLD_GORILLA_ID = NpcIdentifiers.TORTURED_GORILLA_3; // 7097
  const CRASH_TORTURED_IDS = new Set([
    NpcIdentifiers.TORTURED_GORILLA_4, // 7150
    NpcIdentifiers.TORTURED_GORILLA_5, // 7151
  ]);
  const CRASH_DEMONIC_IDS = new Set([
    NpcIdentifiers.DEMONIC_GORILLA, // 7144
    NpcIdentifiers.DEMONIC_GORILLA_2, // 7145
    NpcIdentifiers.DEMONIC_GORILLA_3, // 7146
    NpcIdentifiers.DEMONIC_GORILLA_4, // 7147
    NpcIdentifiers.DEMONIC_GORILLA_5, // 7148
    NpcIdentifiers.DEMONIC_GORILLA_6, // 7149
  ]);

  // Every npc id whose transcript events this quest answers.
  const DIALOGUE_NPC_IDS = new Set([
    ...NARNODE_IDS, ...ANITA_IDS, ...LORI_IDS, ...AUGUSTE_IDS, ...GARKOR_IDS,
    ...LUMO_IDS, ...ZOOKNOCK_IDS, ...ARCHER_IDS, ...KRUK_IDS, ...KOB_IDS,
    ...KEEF_IDS, ...SMITH_IDS, ...NIEVE_IDS,
    AWOWOGEI_MM2_ID, BOAT_GUARD_ID, GLOUGH_CAVERN_ID, GLOUGH_LAB_ID,
    GLOUGH_DEMON_ID,
  ]);

  const HANDKERCHIEF_ITEM = ItemIdentifiers.HANDKERCHIEF; // 19521
  const MYSTERIOUS_NOTE_ITEM = ItemIdentifiers.MYSTERIOUS_NOTE; // 19505
  const MYSTERIOUS_NOTE_HEATED_ITEM = ItemIdentifiers.MYSTERIOUS_NOTE_3; // 19509
  const SCRAWLED_NOTE_ITEM = ItemIdentifiers.SCRAWLED_NOTE_2; // 19511
  const TRANSLATED_NOTE_ITEM = ItemIdentifiers.TRANSLATED_NOTE; // 19513
  const SPY_BOOK_ITEM = ItemIdentifiers.BOOK_OF_SPYOLOGY; // 19515
  const BRUSH_ITEM = ItemIdentifiers.BRUSH; // 19517
  const JUICE_COATED_BRUSH_ITEM = ItemIdentifiers.JUICE_COATED_BRUSH; // 19519
  const TRANSLATION_BOOK_ITEM = ItemIdentifiers.TRANSLATION_BOOK; // 784
  const LEMON_ITEM = ItemIdentifiers.LEMON; // 2102
  const GRAPES_ITEM = ItemIdentifiers.GRAPES; // 1987
  const PESTLE_ITEM = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const CHISEL_ITEM = ItemIdentifiers.CHISEL; // 1755
  const HAMMER_ITEM = ItemIdentifiers.HAMMER; // 2347
  const MONKEY_TALISMAN_ITEM = ItemIdentifiers.MONKEY_TALISMAN; // 4023
  const KRUKS_PAW_ITEM = ItemIdentifiers.KRUKS_PAW; // 19523
  const KRUK_GREEGREE_ITEM = ItemIdentifiers.KRUK_MONKEY_GREEGREE; // 19525
  const SATCHEL_ITEM = ItemIdentifiers.SATCHEL; // 19527
  const FILLED_SATCHEL_ITEM = ItemIdentifiers.SATCHEL_2; // 19528
  const CHARGED_ONYX_ITEM = ItemIdentifiers.CHARGED_ONYX; // 19560
  const DECONSTRUCTED_ONYX_ITEM = ItemIdentifiers.DECONSTRUCTED_ONYX; // 19562
  const ROYAL_SEED_POD_ITEM = ItemIdentifiers.ROYAL_SEED_POD; // 19564
  const BANANA_ITEM = ItemIdentifiers.BANANA; // 1963

  // The cache resolves these multi-locs per player through the mm2 varbits, but the
  // interaction event carries the map's base id, so handlers match the base too.
  const BRANCH_TREE_MULTI_ID = 28800; // mm2_glough_branch_down_multi -> 28801
  const BRANCH_TREE_UP_MULTI_ID = 28659; // mm2_glough_branch_up_multi -> 28657
  const JUNGLE_GRASS_MULTI_ID = 28810; // mm2_secret_entrance_multi -> 28673/28674
  const FIRE_REMAINS_MULTI_ID = 28663; // mm2_gloughs_fireplace_multi -> 28661/28662
  const INCUBATOR_MULTI_ID = 28805; // mm2_lab_incubator_multi -> 15638/16467
  const LAB_PASSAGE_MULTI_ID = 28813; // mm2_secret_lab_entrance_multi -> 28682/28683
  const TRACKS_IDS = new Set([28808, 28809]); // mm2 (other) tracks multiplicators

  const TREE_INVESTIGATE_ID = ObjectIdentifiers.TREE_125; // 28801, floor 2
  const TREE_UP_ID = ObjectIdentifiers.TREE_122; // 28657, floor 2 -> 3
  const TREE_DOWN_ID = ObjectIdentifiers.TREE_124; // 28660, floor 3 -> 2
  const STATUE_ID = ObjectIdentifiers.GNOME_STATUE_7; // 28670
  const CUPBOARD_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_68, // 28664, closed
    ObjectIdentifiers.CUPBOARD_69, // 28665, open
  ]);
  const GNOME_CRATES_ID = ObjectIdentifiers.GNOME_CRATES_2; // 28666
  const FIRE_REMAINS_IDS = new Set([
    ObjectIdentifiers.FIRE_REMAINS_8, // 28661
    ObjectIdentifiers.FIRE_REMAINS_9, // 28662
    FIRE_REMAINS_MULTI_ID, // 28663
  ]);
  const CANDLES_ID = ObjectIdentifiers.CANDLES_17; // 28668
  const JUNGLE_GRASS_ID = ObjectIdentifiers.JUNGLE_GRASS_4; // 28673
  const LAB_PASSAGE_IDS = new Set([
    ObjectIdentifiers.PASSAGE_7, // 28682
    ObjectIdentifiers.PASSAGE_8, // 28683
    LAB_PASSAGE_MULTI_ID, // 28813
  ]);
  const LAB_CRATE_IDS = new Set([
    ObjectIdentifiers.CRATE_223, // 27100
    ObjectIdentifiers.CRATES_52, // 27101
    ObjectIdentifiers.CRATES_53, // 27102
  ]);
  const DEVICE_ID = ObjectIdentifiers.DEVICE; // 23117
  const INCUBATOR_IDS = new Set([
    ObjectIdentifiers.INCUBATION_CHAMBER, // 15638
    ObjectIdentifiers.INCUBATION_CHAMBER_2, // 16467
    INCUBATOR_MULTI_ID, // 28805
  ]);
  const SATCHEL_CRATE_ID = ObjectIdentifiers.CRATE_237; // 28652
  const EXPLOSIVE_BARREL_ID = ObjectIdentifiers.BARREL_136; // 28653
  const KRUK_BATTLE_ENTRANCE_ID = ObjectIdentifiers.CAVERN_ENTRANCE; // 28684, Enter
  const KRUK_BATTLE_ENTRANCE_TILES = new Set(["2531,9227,1", "2548,9225,1"]);
  const LAB_HOLDING_AREA_ID = ObjectIdentifiers.HOLDING_AREA; // 25369, Use
  const SABOTAGE_TARGET_IDS = [
    ObjectIdentifiers.COMPROMISED_SUPPORT, // 28621
    ObjectIdentifiers.COMPROMISED_SUPPORT_2, // 28622
    ObjectIdentifiers.COMPROMISED_FLOORBOARDS, // 28623
    ObjectIdentifiers.COMPROMISED_FLOORBOARDS_2, // 28624
    ObjectIdentifiers.GAS_CYLINDER, // 28625
    ObjectIdentifiers.GAS_CYLINDER_2, // 28626
  ];
  const SABOTAGE_TARGET_INDEX = new Map(SABOTAGE_TARGET_IDS.map((id, index) => [id, index]));
  const CRASH_CAVERN_ID = ObjectIdentifiers.CAVERN_ENTRANCE_2; // 28686
  const KRUK_REMAINS_ID = 28675; // "Kruk", Take-remains

  // Tiles (OSRS positions from the wiki/Quest Helper, each checked walkable in the
  // cache collision map where the player is placed).
  const LAIR_LANDING = new Location(2531, 9229, 1);
  const DUNGEON_ENTRY = new Location(2509, 9169, 1);
  const KRUK_SPAWN = new Location(2535, 9213, 1);
  const KOB_SPAWN = new Location(2831, 10061, 2);
  const KEEF_SPAWN = new Location(2543, 3031, 0);
  const PLATFORM_ENTRY = new Location(2078, 5397, 1);
  const LAB_ENTRY = new Location(2207, 5447, 0);
  const LAB_STUNTED_GORILLA_ID = NpcIdentifiers.STUNTED_DEMONIC_GORILLA; // 7098, Climb-on
  const LAB_RIDE_ATTRIBUTE = "monkey-madness-ii:lab-gorilla-ride";
  const LAB_DEVICE_STAND = new Location(2209, 5488, 0);
  const LAB_GORILLA_TILES = [
    new Location(2205, 5474, 0),
    new Location(2207, 5474, 0),
    new Location(2209, 5474, 0),
  ];
  const STRONGHOLD_GORILLA_TILES = [
    new Location(2436, 3518, 0),
    new Location(2439, 3516, 0),
    new Location(2437, 3512, 0),
    new Location(2432, 3510, 0),
  ];
  const CRASH_LANDING = new Location(2130, 5645, 0);
  const GLOUGH_SPAWN = new Location(2075, 5677, 0);
  const CRASH_ZONE = { minX: 2050, maxX: 2167, minY: 5640, maxY: 5695, levels: [0] };
  const GRAND_TREE_KING = new Location(2465, 3496, 0);
  const AWOWOGEI_SPAWN = new Location(2803, 2764, 0);

  const SATCHELS_PER_RUN = 6;
  const START_SKILLS = [
    [Skill.SLAYER, 69],
    [Skill.CRAFTING, 70],
    [Skill.HUNTER, 60],
    [Skill.AGILITY, 55],
    [Skill.THIEVING, 55],
    [Skill.FIREMAKING, 60],
  ];
  const START_QUESTS = [
    "monkey_madness_i",
    "enlightened_journey",
    "the_eyes_of_glouphrie",
    "troll_stronghold",
    "watchtower",
  ];
  // Recipe for Disaster keeps each rescue in its own bit; the quest is not
  // required as a whole, only Freeing King Awowogei.

  // ==========================================================================
  // Persisted attributes
  // ==========================================================================

  const PLANTED_MASK_ATTRIBUTE = "quest.monkey_madness_ii.planted";
  const LAB_KILLS_ATTRIBUTE = "quest.monkey_madness_ii.lab-kills";
  const STRONGHOLD_KILLS_ATTRIBUTE = "quest.monkey_madness_ii.stronghold-kills";
  const CRASH_TORTURED_ATTRIBUTE = "quest.monkey_madness_ii.crash-tortured";
  const CRASH_DEMONIC_ATTRIBUTE = "quest.monkey_madness_ii.crash-demonic";

  const PERSISTED_ATTRIBUTES = [
    PLANTED_MASK_ATTRIBUTE, LAB_KILLS_ATTRIBUTE, STRONGHOLD_KILLS_ATTRIBUTE,
    CRASH_TORTURED_ATTRIBUTE, CRASH_DEMONIC_ATTRIBUTE, LAB_RIDE_ATTRIBUTE,
  ];

  const npcs = new Map(); // player -> { kruk, lab: [], stronghold: [], glough, awowogei, kob, keef }

  let quest;

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function attribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function addItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function optionOf(event) {
    const actions = event.definition?.getActions?.() ?? [];
    return actions[event.clickType - 1] ?? null;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function canStart(player) {
    const skills = player.getSkillManager();
    for (const [skill, level] of START_SKILLS) {
      if (skills.getMaxLevel(skill) < level) return false;
    }
    const rescue = { player, rescue: "king-awowogei", complete: false };
    api.emitCustomEvent("recipe-for-disaster:rescue-status", rescue);
    if (!rescue.complete) return false;
    return START_QUESTS.every((key) => questComplete(player, key));
  }

  /** The player who owns the spawned NPC, or null for static ones. */
  function ownerOf(npc) {
    return npc?.getOwner?.() ?? null;
  }

  function playerState(player) {
    let state = npcs.get(player);
    if (!state) {
      state = { kruk: null, lab: [], stronghold: [], glough: null, awowogei: null, kob: null, keef: null };
      npcs.set(player, state);
    }
    return state;
  }

  function alive(npc) {
    return npc && npc.isRegistered?.() !== false;
  }

  function equippedKrukGreegree(player) {
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === KRUK_GREEGREE_ITEM;
  }

  function bankHasItem(player, itemId) {
    for (const bank of player.getBanks?.() ?? []) {
      if (bank?.contains?.(itemId) === true || (bank?.getAmount?.(itemId) ?? 0) > 0) return true;
    }
    return false;
  }

  function hasKrukGreegree(player) {
    return hasItem(player, KRUK_GREEGREE_ITEM) || equippedKrukGreegree(player)
      || bankHasItem(player, KRUK_GREEGREE_ITEM);
  }

  /** Add one non-stackable quest item only when a slot is free; false means retry later. */
  function tryAddItem(player, itemId) {
    if (player.getInventory().getFreeSlots() <= 0) return false;
    addItem(player, itemId);
    return true;
  }

  function inCrashSite(player) {
    const location = player.getLocation();
    return location.getZ() === 0
      && location.getX() >= CRASH_ZONE.minX && location.getX() <= CRASH_ZONE.maxX
      && location.getY() >= CRASH_ZONE.minY && location.getY() <= CRASH_ZONE.maxY;
  }

  /** Advances the stage and re-sends the side varbits the cache NPCs read. */
  function advance(player, value) {
    if (quest.getStage(player) < value) quest.setStage(player, value);
    syncSideVarps(player);
    ensureAwowogei(player);
    ensureKrukRemains(player);
  }

  /** mm2_progress drives this quest's NPC/loc transforms; keep the sibling varbits in step. */
  function syncSideVarps(player) {
    const stage = stageOf(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_NIEVE_AT_TREE, stage >= STAGE_KING_TOLD_2 && stage < STAGE_COMPLETE ? 1 : 0);
    sender.sendVarbit(VARBIT_LE_SMITH_POS, stage >= STAGE_SMITH_HUNT && stage < STAGE_COMPLETE ? 1 : 0);
    sender.sendVarbit(VARBIT_KOB_CHALLENGE, stage === STAGE_KOB_CHALLENGE ? 1 : 0);
    sender.sendVarbit(VARBIT_KEEF_CHALLENGE, stage === STAGE_KEEF_CHALLENGE ? 1 : 0);
    sender.sendVarbit(VARBIT_FOUND_HANDKERCHIEF, stage >= STAGE_HANDKERCHIEF ? 2 : stage >= STAGE_STARTED ? 1 : 0);
    sender.sendVarbit(VARBIT_ANTIAS_CLUE, stage >= STAGE_ANITA ? 1 : 0);
    sender.sendVarbit(VARBIT_TRACKING_KRUK, stage >= STAGE_ARCHER_ASKED ? 1 : 0);
    sender.sendVarbit(VARBIT_READ_NOTE, stage >= STAGE_DECRYPTED ? 1 : 0);
  }

  function play(player, npcId, variant, select) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  // ==========================================================================
  // Spawns
  // ==========================================================================

  function spawnOwnerNpc(player, id, location) {
    return api.spawnNpc({
      id,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    }) ?? null;
  }

  function ensureAwowogei(player) {
    const state = playerState(player);
    const stage = stageOf(player);
    if (stage < STAGE_GARKOR_BRIEFED || stage >= STAGE_COMPLETE) {
      releaseAwowogei(player);
      return;
    }
    if (alive(state.awowogei)) {
      removeOwnedAwowogei(player, state.awowogei);
      return;
    }
    state.awowogei = null;
    removeOwnedAwowogei(player, null);
    state.awowogei = spawnOwnerNpc(player, AWOWOGEI_MM2_ID, AWOWOGEI_SPAWN);
  }

  function releaseAwowogei(player) {
    playerState(player).awowogei = null;
    removeOwnedAwowogei(player, null);
  }

  function removeOwnedAwowogei(player, keep) {
    const npcsInWorld = api.getWorld?.()?.getNpcs?.();
    if (!npcsInWorld) return;
    const username = player.getUsername?.();
    for (const npc of npcsInWorld) {
      if (!npc || npc === keep || npc.getId?.() !== AWOWOGEI_MM2_ID) continue;
      const owner = npc.getOwner?.();
      if (owner === player || (username && owner?.getUsername?.() === username)) api.removeNpc(npc);
    }
  }

  function spawnKruk(player) {
    const state = playerState(player);
    if (alive(state.kruk)) return;
    state.kruk = spawnOwnerNpc(player, NpcIdentifiers.KRUK_3, KRUK_SPAWN);
  }

  const krukRemains = new WeakMap();

  /**
   * Kruk's destroy text says to find his remains again. Keep a player-owned
   * Take-remains object in the lair while stage 66 is active, including after a
   * relog; it is removed as soon as the stage moves past Kruk's paw.
   */
  function ensureKrukRemains(player) {
    const needed = stageOf(player) === STAGE_KRUK_KILLED;
    const existing = krukRemains.get(player);
    if (!needed) {
      if (existing) ObjectManager.deregister(existing, true);
      krukRemains.delete(player);
      return;
    }
    if (existing && existing.getId?.() === KRUK_REMAINS_ID && existing.getOwner?.() === player) return;
    if (existing) ObjectManager.deregister(existing, true);
    const username = player.getUsername?.();
    for (const object of ObjectManager.objectsAt(KRUK_SPAWN)) {
      if (object.getId?.() !== KRUK_REMAINS_ID) continue;
      const owner = object.getOwner?.();
      if (owner === player || (username && owner?.getUsername?.() === username)) {
        ObjectManager.deregister(object, true);
      }
    }
    const object = new GameObject(KRUK_REMAINS_ID, KRUK_SPAWN.clone(), 10, 0, null).setOwner(player);
    ObjectManager.register(object, true);
    krukRemains.set(player, object);
  }

  function spawnKob(player) {
    const state = playerState(player);
    if (alive(state.kob)) return;
    state.kob = spawnOwnerNpc(player, NpcIdentifiers.KOB_2, KOB_SPAWN);
  }

  function spawnKeef(player) {
    const state = playerState(player);
    if (alive(state.keef)) return;
    state.keef = spawnOwnerNpc(player, NpcIdentifiers.KEEF_2, KEEF_SPAWN);
  }

  function spawnLabGorillas(player) {
    const state = playerState(player);
    const kills = attribute(player, LAB_KILLS_ATTRIBUTE);
    const needed = LAB_GORILLA_TILES.length - kills;
    if (needed <= 0 || state.lab.filter(alive).length >= needed) return;
    state.lab = LAB_GORILLA_TILES.map((tile, index) => {
      const existing = state.lab[index];
      if (alive(existing)) return existing;
      return spawnOwnerNpc(player, LAB_GORILLA_ID, tile);
    }).filter(Boolean);
  }

  function spawnStrongholdGorillas(player) {
    const state = playerState(player);
    const kills = attribute(player, STRONGHOLD_KILLS_ATTRIBUTE);
    const needed = STRONGHOLD_GORILLA_TILES.length - kills;
    if (needed <= 0 || state.stronghold.filter(alive).length >= needed) return;
    state.stronghold = STRONGHOLD_GORILLA_TILES.map((tile, index) => {
      const existing = state.stronghold[index];
      if (alive(existing)) return existing;
      return spawnOwnerNpc(player, STRONGHOLD_GORILLA_ID, tile);
    }).filter(Boolean);
  }

  function spawnDemonicGlough(player) {
    const state = playerState(player);
    if (alive(state.glough)) return;
    state.glough = spawnOwnerNpc(player, GLOUGH_DEMON_ID, GLOUGH_SPAWN);
  }

  // ==========================================================================
  // NPC conversations
  // ==========================================================================

  function narnodeVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_ZOOKNOCK_SAVED) return "chapter-v-reporting-back-to-king-narnode";
    if (stage >= STAGE_CH3_DONE) {
      return stage < STAGE_STRONGHOLD_GORILLAS
        ? "chapter-iv-talking-to-king-narnode"
        : "chapter-iv-talking-to-king-narnode-2";
    }
    if (stage >= STAGE_CH1_DONE) return "chapter-i-talking-to-king-narnode-talking-to-king-narnode-again-3";
    if (stage >= STAGE_AUGUSTE_ASKED) return "chapter-i-talking-to-king-narnode-5";
    if (stage >= STAGE_KING_TOLD) return "chapter-i-talking-to-king-narnode-talking-to-king-narnode-again-2";
    if (stage >= STAGE_TRANSLATED) return "chapter-i-talking-to-king-narnode-4";
    if (stage >= STAGE_NOTE_ATTEMPTED) return "chapter-i-talking-to-king-narnode-3";
    if (stage >= STAGE_UPSTAIRS) return "chapter-i-talking-to-king-narnode-2";
    if (stage >= STAGE_STARTED) return "chapter-i-talking-to-king-narnode-talking-to-king-narnode-again";
    return "chapter-i-talking-to-king-narnode";
  }

  function selectNarnodeVariant({ npcId, player }) {
    if (!NARNODE_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return { page: NARNODE_PAGE, variant: POST_QUEST_CHAR };
    if (stage === 0 && !canStart(player)) return null;
    return { page: PAGE, variant: narnodeVariant(player) };
  }

  function handleNarnodeTalk(event) {
    const { player, npcId } = event;
    if (stageOf(player) === 0 && !canStart(player)) return false;
    event.handled = true;
    if (stageOf(player) >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, NARNODE_PAGE, POST_QUEST_CHAR);
      return true;
    }
    const stage = stageOf(player);
    const variant = narnodeVariant(player);
    play(player, npcId, variant);
    return true;
  }

  function handleAnitaTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage === 0 && !canStart(player)) return false;
    event.handled = true;
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, ANITA_PAGE, POST_QUEST_CHAR);
      return true;
    }
    if (stage >= STAGE_HANDKERCHIEF && stage < STAGE_ANITA) {
      play(player, npcId, "chapter-i-talking-to-anita");
      return true;
    }
    // Anita only offers to translate once the note has been decoded and the
    // player has tried (and failed) to use the translation book on it.
    if (stage >= STAGE_NOTE_ATTEMPTED && stage < STAGE_TRANSLATED
      && hasItem(player, SCRAWLED_NOTE_ITEM)) {
      play(player, npcId, "chapter-i-talking-to-anita-2");
      return true;
    }
    startTranscript(api, player, npcId, ANITA_PAGE, "standard-dialogue");
    return true;
  }

  function handleLoriTalk(event) {
    const { player, npcId } = event;
    if (stageOf(player) < STAGE_KING_TOLD) return false;
    event.handled = true;
    // The Assistant Lori character page has no variants; replay her balloon spiel.
    play(player, npcId, "chapter-i-talking-to-assistant-lori");
    return true;
  }

  function handleAugusteTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_LORI_ASKED || stage >= STAGE_AUGUSTE_ASKED) return false;
    event.handled = true;
    play(player, npcId, "chapter-i-talking-to-auguste");
    return true;
  }

  function garkorVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_CH3_DONE) {
      if (stage < STAGE_STRONGHOLD_GORILLAS) return "chapter-iv-talking-to-garkor";
      return "chapter-iv-talking-to-garkor-talking-to-garkor-after-killing-enough-tortured-gorillas";
    }
    if (stage >= STAGE_AWOWOGEI_TOLD) return "chapter-iii-talking-to-garkor-5";
    if (stage >= STAGE_GARKOR_AFTER_LAB) return "chapter-iii-talking-to-garkor-talking-to-garkor-again-2";
    if (stage >= STAGE_MUTAGEN_CORRUPTED) return "chapter-iii-talking-to-garkor-4";
    if (stage >= STAGE_GARKOR_LAB) return "chapter-iii-talking-to-garkor-talking-to-garkor-again";
    if (stage >= STAGE_SHIPS_SABOTAGED) return "chapter-iii-talking-to-garkor-3";
    if (stage >= STAGE_SMITH_TALKED) return "chapter-iii-talking-to-garkor-2";
    if (stage >= STAGE_KEEF_DEFEATED) return "chapter-iii-talking-to-garkor";
    if (stage >= STAGE_CH2_DONE) return "chapter-ii-talking-to-garkor-talking-to-garkor-again-3";
    if (stage >= STAGE_GREE_GREE) return "chapter-ii-talking-to-garkor-3";
    if (stage >= STAGE_ARCHER_ASKED) return "chapter-ii-talking-to-garkor-talking-to-garkor-again-2";
    if (stage >= STAGE_AWOWOGEI_ASKED) return "chapter-ii-talking-to-garkor-2";
    if (stage >= STAGE_GARKOR_BRIEFED) return "chapter-ii-talking-to-garkor-talking-to-garkor-again";
    return "chapter-ii-talking-to-garkor";
  }

  function handleGarkorTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_CH1_DONE) return false;
    event.handled = true;
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, GARKOR_PAGE, POST_QUEST);
      return true;
    }
    const variant = garkorVariant(player);
    if (variant === "chapter-ii-talking-to-garkor-2" && stage < STAGE_GARKOR_KRUK) {
      advance(player, STAGE_GARKOR_KRUK);
    }
    if (variant === "chapter-ii-talking-to-garkor-3" && stage < STAGE_CH2_DONE) {
      advance(player, STAGE_CH2_DONE);
    }
    if (variant === "chapter-iii-talking-to-garkor" && stage < STAGE_SMITH_HUNT) {
      advance(player, STAGE_SMITH_HUNT);
    }
    if (variant === "chapter-iii-talking-to-garkor-2" && stage < STAGE_GARKOR_PLATFORM) {
      advance(player, STAGE_GARKOR_PLATFORM);
    }
    if (variant === "chapter-iii-talking-to-garkor-3" && stage < STAGE_GARKOR_LAB) {
      advance(player, STAGE_GARKOR_LAB);
    }
    if (variant === "chapter-iii-talking-to-garkor-4" && stage < STAGE_GARKOR_AFTER_LAB) {
      advance(player, STAGE_GARKOR_AFTER_LAB);
    }
    if (variant === "chapter-iii-talking-to-garkor-5" && stage < STAGE_CH3_DONE) {
      advance(player, STAGE_CH3_DONE);
    }
    if (GARKOR_BREACH_IDS.has(npcId) && stage >= STAGE_STRONGHOLD_GORILLAS && stage < STAGE_GARKOR_BREACH) {
      advance(player, STAGE_GARKOR_BREACH);
    }
    play(player, npcId, variant);
    return true;
  }

  function handleLumoTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_KING_TOLD_2 || stage >= STAGE_CRASH_ENTERED) return false;
    event.handled = true;
    if (stage >= STAGE_STRONGHOLD_GORILLAS) {
      play(player, npcId, "chapter-iv-talking-to-lumo-talking-to-lumo-after-killing-enough-tortured-gorillas");
      return true;
    }
    play(player, npcId, "chapter-iv-talking-to-lumo");
    return true;
  }

  function handleZooknockTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      event.handled = true;
      startTranscript(api, player, npcId, ZOOKNOCK_PAGE, POST_QUEST);
      return true;
    }
    // The greegree can be lost (destroyed or left behind) before Kruk's role is
    // finished; Zooknock makes another at the end of the Ape Atoll dungeon.
    if (stage >= STAGE_GREE_GREE && stage < STAGE_COMPLETE && !hasKrukGreegree(player)) {
      event.handled = true;
      if (!tryAddItem(player, KRUK_GREEGREE_ITEM)) {
        player.sendMessage("You need a free inventory slot before Zooknock can hand you another greegree.");
        return true;
      }
      player.sendMessage("Zooknock shapes another Kruk monkey greegree for you.");
      return true;
    }
    // After Glough falls, Zooknock is the QH/wiki hand-out: his half of the
    // after-defeating-Glough transcript offers the teleport back to the king.
    if (stage >= STAGE_ZOOKNOCK_SAVED) {
      event.handled = true;
      play(player, npcId, "chapter-v-after-defeating-glough", (steps) => {
        const start = steps.findIndex(step => step?.speaker === "Zooknock");
        return start >= 0 ? steps.slice(start) : steps;
      });
      return true;
    }
    if (stage !== STAGE_KRUK_KILLED) return false;
    event.handled = true;
    if (!hasItem(player, KRUKS_PAW_ITEM) || !hasItem(player, MONKEY_TALISMAN_ITEM)) {
      player.sendMessage("Zooknock needs Kruk's paw and a monkey talisman.");
      return true;
    }
    player.getInventory().deleteNumber(KRUKS_PAW_ITEM, 1);
    player.getInventory().deleteNumber(MONKEY_TALISMAN_ITEM, 1);
    addItem(player, KRUK_GREEGREE_ITEM);
    player.sendMessage("Zooknock takes Kruk's paw and your talisman, and shapes a Kruk monkey greegree.");
    advance(player, STAGE_GREE_GREE);
    return true;
  }

  function handleAwowogeiTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      event.handled = true;
      startTranscript(api, player, npcId, AWOWOGEI_PAGE, POST_QUEST_CHAR);
      return true;
    }
    if (stage < STAGE_GARKOR_BRIEFED) return false;
    event.handled = true;
    if (stage >= STAGE_GARKOR_AFTER_LAB) {
      play(player, npcId, "chapter-iii-talking-to-awowogei");
      if (stage < STAGE_AWOWOGEI_TOLD) advance(player, STAGE_AWOWOGEI_TOLD);
      return true;
    }
    if (stage >= STAGE_GREE_GREE && equippedKrukGreegree(player)) {
      play(player, npcId, "chapter-ii-talking-to-awowogei-as-kruk");
      if (stage < STAGE_AWOWOGEI_AS_KRUK) advance(player, STAGE_AWOWOGEI_AS_KRUK);
      return true;
    }
    play(player, npcId, "chapter-ii-talking-to-awowogei");
    return true;
  }

  function handleArcherTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_GARKOR_KRUK || stage >= STAGE_CH2_DONE) return false;
    event.handled = true;
    const variant = stage >= STAGE_ARCHER_ASKED
      ? "chapter-ii-talking-to-the-monkey-archer-talking-to-the-monkey-archer-again"
      : "chapter-ii-talking-to-the-monkey-archer";
    if (stage < STAGE_ARCHER_ASKED) advance(player, STAGE_ARCHER_ASKED);
    play(player, npcId, variant);
    return true;
  }

  function handleKrukTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_ARCHER_ASKED || stage > STAGE_KRUK_KILLED) return false;
    if (npcId !== NpcIdentifiers.KRUK_2) return false;
    event.handled = true;
    play(player, npcId, "chapter-ii-confronting-kruk");
    return true;
  }

  function handleKobTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage !== STAGE_CH2_DONE) return false;
    if (npcId !== NpcIdentifiers.KOB) return false;
    event.handled = true;
    play(player, npcId, "chapter-iii-talking-to-kob");
    return true;
  }

  function handleKeefTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage !== STAGE_KOB_DEFEATED) return false;
    if (npcId !== NpcIdentifiers.KEEF) return false;
    event.handled = true;
    play(player, npcId, "chapter-iii-talking-to-keef");
    return true;
  }

  function handleSmithTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_SMITH_HUNT) return false;
    event.handled = true;
    // The Assistant Le Smith character page has no variants; replay the MM2 chat.
    play(player, npcId, equippedKrukGreegree(player)
      ? "chapter-iii-talking-to-assistant-le-smith-as-kruk"
      : "chapter-iii-talking-to-assistant-le-smith-as-yourself");
    return true;
  }

  function handleBoatGuardTalk(event) {
    const { player, npcId } = event;
    event.handled = true;
    play(player, npcId, "chapter-iii-talking-to-the-monkey-guard");
    return true;
  }

  function handleNieveTalk(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_KING_TOLD_2 || stage >= STAGE_COMPLETE) return false;
    event.handled = true;
    if (stage >= STAGE_STRONGHOLD_GORILLAS) {
      play(player, npcId, "chapter-iv-talking-to-nieve-talking-to-nieve-after-killing-enough-tortured-gorillas");
      return true;
    }
    if (stage >= STAGE_NIEVE_RECRUITED) {
      spawnStrongholdGorillas(player);
      play(player, npcId, "chapter-iv-talking-to-nieve-talking-to-nieve-while-she-is-following-you");
      return true;
    }
    play(player, npcId, "chapter-iv-talking-to-nieve");
    return true;
  }

  function handleNpcInteraction(event) {
    const { npcId } = event;
    if (npcId === LAB_STUNTED_GORILLA_ID && optionOf(event) === "Climb-on") {
      const player = event.player;
      if (stageOf(player) !== STAGE_GARKOR_LAB) return;
      event.handled = true;
      if (!equippedKrukGreegree(player)) {
        player.sendMessage("You need to wear the Kruk monkey greegree to pass the gorilla.");
        return;
      }
      player.setAttribute(LAB_RIDE_ATTRIBUTE, true);
      advance(player, STAGE_LAB_ARRIVED);
      play(player, GLOUGH_LAB_ID, "chapter-iii-at-glough-s-secret-lab-upon-arrival");
      spawnLabGorillas(player);
      return;
    }
    if (optionOf(event) !== "Talk-to") return;
    if (NARNODE_IDS.has(npcId) && handleNarnodeTalk(event)) return;
    if (ANITA_IDS.has(npcId) && handleAnitaTalk(event)) return;
    if (LORI_IDS.has(npcId) && handleLoriTalk(event)) return;
    if (AUGUSTE_IDS.has(npcId) && handleAugusteTalk(event)) return;
    if (GARKOR_IDS.has(npcId) && handleGarkorTalk(event)) return;
    if (LUMO_IDS.has(npcId) && handleLumoTalk(event)) return;
    if (ZOOKNOCK_IDS.has(npcId) && handleZooknockTalk(event)) return;
    if (npcId === AWOWOGEI_MM2_ID && handleAwowogeiTalk(event)) return;
    if (ARCHER_IDS.has(npcId) && handleArcherTalk(event)) return;
    if (KRUK_IDS.has(npcId) && handleKrukTalk(event)) return;
    if (KOB_IDS.has(npcId) && handleKobTalk(event)) return;
    if (KEEF_IDS.has(npcId) && handleKeefTalk(event)) return;
    if (SMITH_IDS.has(npcId) && handleSmithTalk(event)) return;
    if (npcId === BOAT_GUARD_ID && handleBoatGuardTalk(event)) return;
    if (NIEVE_IDS.has(npcId) && handleNieveTalk(event)) return;
  }

  // ==========================================================================
  // Transcript events
  // ==========================================================================

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!DIALOGUE_NPC_IDS.has(event.npcId)) return;
    switch (stepId) {
      case "1cZ5q5": // Anita's handkerchief returned
        player.getInventory().deleteNumber(HANDKERCHIEF_ITEM, 1);
        advance(player, STAGE_ANITA);
        return;
      case "B8_LH9": // half-burned note in the ashes
        if (!hasItem(player, MYSTERIOUS_NOTE_ITEM) && !hasItem(player, MYSTERIOUS_NOTE_HEATED_ITEM)
          && !hasItem(player, SCRAWLED_NOTE_ITEM) && !hasItem(player, TRANSLATED_NOTE_ITEM)) {
          addItem(player, MYSTERIOUS_NOTE_ITEM);
        }
        return;
      case "jwE-bA": // the note shown to Narnode
        advance(player, STAGE_BOOK_SHOWN);
        return;
      case "1LK8qR": // rest of the note burned
      case "SNNSAQ":
        return;
      case "-HXvYT": // replacement translation book
        if (!hasItem(player, TRANSLATION_BOOK_ITEM)) addItem(player, TRANSLATION_BOOK_ITEM);
        return;
      case "H_6MDI": // phrases missing from the translation book
        advance(player, STAGE_NOTE_ATTEMPTED);
        return;
      case "4UmJhp": // Anita shown the notes
      case "iJfk7C": // Anita translates
        return;
      case "a1AZnL": // Anita hands over the translation
        if (!hasItem(player, TRANSLATED_NOTE_ITEM)
          && !tryAddItem(player, TRANSLATED_NOTE_ITEM)) {
          player.sendMessage("You need a free inventory slot for the translated note.");
          return;
        }
        advance(player, STAGE_TRANSLATED);
        return;
      case "IxEFah": // Narnode reads the translated note
        advance(player, STAGE_KING_TOLD);
        return;
      case "USRRlD": // lab lever pulled
        return;
      case "C7KDQ5": // charged onyx removed from the orb
        if (!hasItem(player, CHARGED_ONYX_ITEM) && !hasItem(player, DECONSTRUCTED_ONYX_ITEM)) {
          addItem(player, CHARGED_ONYX_ITEM);
        }
        return;
      case "GHfqMr": // the onyx reshaped
        if (hasItem(player, CHARGED_ONYX_ITEM)) {
          player.getInventory().deleteNumber(CHARGED_ONYX_ITEM, 1);
          addItem(player, DECONSTRUCTED_ONYX_ITEM);
        }
        return;
      case "D48jrs": // the gem replaced, energy reversed
        if (hasItem(player, DECONSTRUCTED_ONYX_ITEM)) {
          player.getInventory().deleteNumber(DECONSTRUCTED_ONYX_ITEM, 1);
        }
        advance(player, STAGE_MUTAGEN_TAKEN);
        return;
      case "3ua0rB": // incubator drained
        advance(player, STAGE_MUTAGEN_CORRUPTED);
        return;
      case "9BK_6I": // the screen rumbles
      case "UV-ajw": // a shadow is spotted
      case "zNRRJ4": // the screen fades to black
      case "lX0-oJ": // camera returns to the player and Garkor
        return;
      case "FWgGzC": // Glough's airship arrives
        advance(player, STAGE_NIEVE_RECRUITED);
        spawnStrongholdGorillas(player);
        return;
      case "YIbvbT": // screen fades
      case "-IX1qz": // the camera returns; the screen rumbles
        return;
      case "biXw8B": // tortured gorillas jump down
      case "d_zUT5": // Glough consumes the mutagen
        return;
      case "DPLs0V": // Glough retreats
        return;
      case "7wLJF6": // Glough falls, the cavern collapses
        advance(player, STAGE_ZOOKNOCK_SAVED);
        return;
      case "ZNn05x": // the player appears by the cavern entrance
        player.moveTo(CRASH_LANDING);
        return;
      case "p_qrn4": // the kings meet
        return;
      case "FRajWl": // quest complete
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (!DIALOGUE_NPC_IDS.has(npcId)) return;
    if (NARNODE_IDS.has(npcId)) {
      if (option === "I'll help you look for Glough." && stageOf(player) === 0) {
        advance(player, STAGE_STARTED);
      }
      return;
    }
    if (GARKOR_IDS.has(npcId)) {
      if (option === "It's worth a shot." && stageOf(player) < STAGE_GARKOR_BRIEFED) {
        advance(player, STAGE_GARKOR_BRIEFED);
      }
      return;
    }
    if (npcId === AWOWOGEI_MM2_ID) {
      if (option === "Of course, my king." && stageOf(player) < STAGE_AWOWOGEI_ASKED) {
        advance(player, STAGE_AWOWOGEI_ASKED);
      }
      return;
    }
    if (LORI_IDS.has(npcId)) {
      if (option === "Who are you?" && stageOf(player) < STAGE_LORI_ASKED) {
        advance(player, STAGE_LORI_ASKED);
      }
      return;
    }
    if (AUGUSTE_IDS.has(npcId)) {
      if (option === "Thanks for the information." && stageOf(player) < STAGE_AUGUSTE_ASKED) {
        advance(player, STAGE_AUGUSTE_ASKED);
      }
      return;
    }
    // Anita's choice does not advance on its own: the transcript's a1AZnL
    // action hands over the translated note and advances the stage with it.
    if (ANITA_IDS.has(npcId)) return;
    if (KOB_IDS.has(npcId) && option === "I accept your challenge.") {
      if (stageOf(player) === STAGE_CH2_DONE) {
        advance(player, STAGE_KOB_CHALLENGE);
        spawnKob(player);
        player.sendMessage("Kob bellows and charges at you!");
      }
      return;
    }
    if (KEEF_IDS.has(npcId) && option === "I accept your challenge.") {
      if (stageOf(player) === STAGE_KOB_DEFEATED) {
        advance(player, STAGE_KEEF_CHALLENGE);
        spawnKeef(player);
        player.sendMessage("Keef roars and charges at you!");
      }
      return;
    }
    if (SMITH_IDS.has(npcId) && option === "Where is the fleet, currently?") {
      if (stageOf(player) < STAGE_SMITH_TALKED) advance(player, STAGE_SMITH_TALKED);
      return;
    }
    if (npcId === BOAT_GUARD_ID && option === "Can I visit the platform?") {
      if (stageOf(player) >= STAGE_GARKOR_PLATFORM) {
        player.moveTo(PLATFORM_ENTRY);
        player.sendMessage("The monkey rows you out to the construction platform.");
        if (stageOf(player) < STAGE_PLATFORM) advance(player, STAGE_PLATFORM);
      } else {
        player.sendMessage("You should speak to Sergeant Garkor before boarding.");
      }
      return;
    }
    if (NIEVE_IDS.has(npcId) && option === "Yes." && stageOf(player) < STAGE_NIEVE_RECRUITED) {
      advance(player, STAGE_NIEVE_RECRUITED);
      spawnStrongholdGorillas(player);
      player.sendMessage("Nieve checks her equipment and nods. Let's defend the Stronghold!");
      return;
    }
    if ((npcId === GLOUGH_CAVERN_ID || ZOOKNOCK_IDS.has(npcId))
      && option === "Yes." && stageOf(player) >= STAGE_ZOOKNOCK_SAVED) {
      player.moveTo(GRAND_TREE_KING);
      return;
    }
  }

  function handleDialogueLine(event) {
    const { npcId, text, player } = event;
    if (!DIALOGUE_NPC_IDS.has(npcId)) return;
    if (NARNODE_IDS.has(npcId)) {
      if (text.startsWith("Glough is a threat to us all... I must hereby re-assign you")) {
        advance(player, STAGE_CH1_DONE);
      } else if (text === "Nieve is the most highly skilled warrior we have here, get her assistance and defend the Stronghold.") {
        advance(player, STAGE_KING_TOLD_2);
      }
    }
    if (NIEVE_IDS.has(npcId) && text === "You should pick up your pet first. It would only get in the way.") {
      event.skip = true;
    }
  }

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!DIALOGUE_NPC_IDS.has(event.npcId)) return null;
    switch (stepId) {
      case "_w4LLz": // the player does not have the requirements to start
        return !canStart(player);
      case "-HdqgX": // the player has the requirements
        return canStart(player);
      case "s0JCbh": // no translation book
        return !hasItem(player, TRANSLATION_BOOK_ITEM);
      case "imakIO": // has a translation book
        return hasItem(player, TRANSLATION_BOOK_ITEM);
      case "jyTCc-": // not disguised as Kruk
        return !equippedKrukGreegree(player);
      case "rftZUo": // disguised as Kruk
        return equippedKrukGreegree(player);
      case "JqE_qU": // a pet is following
        return false;
      case "E5gZen": // no pet following
        return true;
      case "VEjijh": // Nieve is not following the player
        return stageOf(player) < STAGE_NIEVE_RECRUITED;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player } = event;
    const objectId = event.objectId;
    const option = optionOf(event);

    if ((objectId === TREE_INVESTIGATE_ID || objectId === BRANCH_TREE_MULTI_ID) && option === "Investigate") {
      event.handled = true;
      if (stageOf(player) === 0) {
        player.sendMessage("You should speak to King Narnode first.");
        return;
      }
      if (stageOf(player) >= STAGE_HANDKERCHIEF) {
        player.sendMessage("You've already searched up here.");
        return;
      }
      addItem(player, HANDKERCHIEF_ITEM);
      play(player, NpcIdentifiers.KING_NARNODE_SHAREEN, "chapter-i-investigating-the-tree-in-glough-s-home");
      advance(player, STAGE_HANDKERCHIEF);
      return;
    }
    if ((objectId === TREE_UP_ID || objectId === BRANCH_TREE_UP_MULTI_ID) && option === "Climb-up") {
      event.handled = true;
      player.moveTo(new Location(2486, 3465, 3));
      return;
    }
    if (objectId === TREE_DOWN_ID && option === "Climb-down") {
      event.handled = true;
      player.moveTo(new Location(2485, 3465, 2));
      return;
    }
    if ((objectId === TREE_INVESTIGATE_ID || objectId === BRANCH_TREE_MULTI_ID) && option === "Climb-down") {
      event.handled = true;
      player.moveTo(new Location(2485, 3464, 1));
      return;
    }
    if (TRACKS_IDS.has(objectId) && option === "Investigate") {
      event.handled = true;
      player.sendMessage("Kruk's tracks lead west towards a patch of jungle grass.");
      return;
    }
    if (objectId === STATUE_ID && option === "Investigate") {
      event.handled = true;
      if (stageOf(player) < STAGE_ANITA) {
        player.sendMessage("The statue seems to be fixed to the floor.");
        return;
      }
      player.sendMessage("You turn the gnome statue; something clicks nearby.");
      return;
    }
    if (CUPBOARD_IDS.has(objectId) && (option === "Open" || option === "Search")) {
      event.handled = true;
      if (stageOf(player) < STAGE_ANITA) {
        player.sendMessage("The cupboard is locked.");
        return;
      }
      if (!hasItem(player, SPY_BOOK_ITEM)) addItem(player, SPY_BOOK_ITEM);
      player.sendMessage("You search the cupboard and find a book of spyology.");
      checkUpstairs(player);
      return;
    }
    if (objectId === GNOME_CRATES_ID && option === "Search") {
      event.handled = true;
      if (stageOf(player) < STAGE_ANITA) return;
      if (!hasItem(player, BRUSH_ITEM) && !hasItem(player, JUICE_COATED_BRUSH_ITEM)) addItem(player, BRUSH_ITEM);
      player.sendMessage("You search the crates and find a brush.");
      checkUpstairs(player);
      return;
    }
    if (FIRE_REMAINS_IDS.has(objectId) && option === "Investigate") {
      event.handled = true;
      if (stageOf(player) < STAGE_ANITA) return;
      if (!hasItem(player, MYSTERIOUS_NOTE_ITEM) && !hasItem(player, MYSTERIOUS_NOTE_HEATED_ITEM)
        && !hasItem(player, SCRAWLED_NOTE_ITEM) && !hasItem(player, TRANSLATED_NOTE_ITEM)) {
        addItem(player, MYSTERIOUS_NOTE_ITEM);
      }
      play(player, NpcIdentifiers.KING_NARNODE_SHAREEN, "chapter-i-searching-fire-remains");
      checkUpstairs(player);
      return;
    }
    if (objectId === CANDLES_ID && option === "Investigate") {
      event.handled = true;
      if (hasItem(player, MYSTERIOUS_NOTE_ITEM)) {
        player.getInventory().deleteNumber(MYSTERIOUS_NOTE_ITEM, 1);
        addItem(player, MYSTERIOUS_NOTE_HEATED_ITEM);
        player.sendMessage("You hold the note over the candle; hidden writing starts to brown.");
      } else {
        player.sendMessage("A candle burns on the table.");
      }
      return;
    }
    if ((objectId === JUNGLE_GRASS_ID || objectId === JUNGLE_GRASS_MULTI_ID) && option === "Investigate") {
      handleJungleGrass(player);
      event.handled = true;
      return;
    }
    if (LAB_PASSAGE_IDS.has(objectId) && option === "Enter") {
      event.handled = true;
      const location = event.location ?? {};
      if ((location.y ?? 0) > 9000) {
        enterLab(player);
      } else {
        player.moveTo(new Location(2910, 9096, 0));
        player.sendMessage("You head back into the Ape Atoll dungeon.");
      }
      return;
    }
    if (LAB_CRATE_IDS.has(objectId) && option === "Search") {
      event.handled = true;
      if (!hasItem(player, CHISEL_ITEM)) addItem(player, CHISEL_ITEM);
      if (!hasItem(player, HAMMER_ITEM)) addItem(player, HAMMER_ITEM);
      player.sendMessage("You search the crate and find a chisel and a hammer.");
      return;
    }
    if (objectId === DEVICE_ID && option === "Tamper") {
      event.handled = true;
      if (stageOf(player) < STAGE_LAB_GORILLAS || stageOf(player) >= STAGE_MUTAGEN_TAKEN) {
        player.sendMessage("The device is humming quietly.");
        return;
      }
      if (player.getAttribute(LAB_RIDE_ATTRIBUTE) === true) {
        player.sendMessage("You need to dismount the gorilla before approaching the device.");
        return;
      }
      player.moveTo(LAB_DEVICE_STAND);
      play(player, GLOUGH_LAB_ID, "chapter-iii-at-glough-s-secret-lab-tampering-the-device");
      return;
    }
    if (INCUBATOR_IDS.has(objectId) && option === "Investigate") {
      event.handled = true;
      if (stageOf(player) < STAGE_MUTAGEN_TAKEN) {
        player.sendMessage("The incubation chamber is filled with a strange mutagen.");
        return;
      }
      play(player, NpcIdentifiers.ZOOKNOCK_2, "chapter-iii-at-glough-s-secret-lab-inspecting-the-incubators");
      return;
    }
    if (objectId === SATCHEL_CRATE_ID && option === "Search") {
      event.handled = true;
      if (stageOf(player) < STAGE_PLATFORM || stageOf(player) >= STAGE_SHIPS_SABOTAGED) return;
      const missing = SATCHELS_PER_RUN - player.getInventory().getAmount(SATCHEL_ITEM)
        - player.getInventory().getAmount(FILLED_SATCHEL_ITEM);
      if (missing > 0) addItem(player, SATCHEL_ITEM, missing);
      player.sendMessage("You take satchels from the crate.");
      return;
    }
    if (objectId === EXPLOSIVE_BARREL_ID && option === "Search") {
      event.handled = true;
      if (stageOf(player) < STAGE_PLATFORM || stageOf(player) >= STAGE_SHIPS_SABOTAGED) return;
      const emptySatchels = player.getInventory().getAmount(SATCHEL_ITEM);
      if (emptySatchels < 1) {
        player.sendMessage("You need an empty satchel before filling it with explosives.");
        return;
      }
      player.getInventory().deleteNumber(SATCHEL_ITEM, emptySatchels);
      addItem(player, FILLED_SATCHEL_ITEM, emptySatchels);
      player.sendMessage("You fill your empty satchels with explosives.");
      return;
    }
    if (SABOTAGE_TARGET_INDEX.has(objectId) && option === "Investigate") {
      event.handled = true;
      plantCharge(player, objectId);
      return;
    }
    if (objectId === CRASH_CAVERN_ID && option === "Enter") {
      event.handled = true;
      enterCrashSite(player);
      return;
    }
    const location = event.location;
    const locationKey = location && `${location.x},${location.y},${location.z}`;
    if (objectId === KRUK_BATTLE_ENTRANCE_ID && option === "Enter" && stageOf(player) === STAGE_ARCHER_ASKED
      && KRUK_BATTLE_ENTRANCE_TILES.has(locationKey)) {
      event.handled = true;
      player.moveTo(LAIR_LANDING);
      spawnKruk(player);
      play(player, NpcIdentifiers.KRUK_2, "chapter-ii-confronting-kruk");
      return;
    }
    if (objectId === LAB_HOLDING_AREA_ID && option === "Use") {
      const location = event.location;
      if (stageOf(player) < STAGE_LAB_GORILLAS || stageOf(player) >= STAGE_MUTAGEN_TAKEN
        || location?.getX?.() !== 2213 || location?.getY?.() !== 5464 || location?.getZ?.() !== 0
        || player.getAttribute(LAB_RIDE_ATTRIBUTE) !== true) return;
      event.handled = true;
      player.setAttribute(LAB_RIDE_ATTRIBUTE, false);
      player.sendMessage("You dismount the stunted gorilla.");
      return;
    }
    if (objectId === KRUK_REMAINS_ID && option === "Take-remains") {
      event.handled = true;
      if (stageOf(player) !== STAGE_KRUK_KILLED) {
        player.sendMessage("There is nothing to take.");
        return;
      }
      if (hasItem(player, KRUKS_PAW_ITEM) || bankHasItem(player, KRUKS_PAW_ITEM)) {
        player.sendMessage("You have already taken Kruk's remains.");
        return;
      }
      if (!tryAddItem(player, KRUKS_PAW_ITEM)) {
        player.sendMessage("You need a free inventory slot to take Kruk's remains.");
        return;
      }
      player.sendMessage("You take Kruk's remains.");
      return;
    }
  }

  function hasMysteriousNote(player) {
    return hasItem(player, MYSTERIOUS_NOTE_ITEM) || hasItem(player, MYSTERIOUS_NOTE_HEATED_ITEM)
      || hasItem(player, SCRAWLED_NOTE_ITEM) || hasItem(player, TRANSLATED_NOTE_ITEM);
  }

  function checkUpstairs(player) {
    if (stageOf(player) >= STAGE_UPSTAIRS) return;
    if (hasItem(player, SPY_BOOK_ITEM) && hasItem(player, BRUSH_ITEM) && hasMysteriousNote(player)) {
      advance(player, STAGE_UPSTAIRS);
    }
  }

  function handleJungleGrass(player) {
    const stage = stageOf(player);
    if (stage === STAGE_ARCHER_ASKED || stage === STAGE_GARKOR_LAB) {
      if (stage === STAGE_GARKOR_LAB && !equippedKrukGreegree(player)) {
        player.sendMessage("You need to wear the Kruk monkey greegree to enter the dungeon.");
        return;
      }
      api.sendMultiChatboxPrompt(player, "Enter the hidden trapdoor?", "Yes.", () => {
        player.moveTo(DUNGEON_ENTRY);
        player.sendMessage("You enter the Ape Atoll dungeon.");
      }, "No.", () => player.getPacketSender().sendInterfaceRemoval());
      return;
    }
    if (stage === STAGE_KRUK_KILLED) {
      player.sendMessage("Kruk's lair lies below. Take his paw to Zooknock in the Ape Atoll dungeon.");
      return;
    }
    if (stage >= STAGE_GLOUGH_DEFEATED && stage < STAGE_COMPLETE) {
      player.sendMessage("You drop back into Kruk's lair.");
      player.moveTo(LAIR_LANDING);
      return;
    }
    player.sendMessage("Just some jungle grass.");
  }

  function enterLab(player) {
    const stage = stageOf(player);
    if (stage === STAGE_GARKOR_LAB) {
      player.moveTo(LAB_ENTRY);
      player.sendMessage("You enter the laboratory. A stunted gorilla waits nearby.");
      return;
    }
    if (stage >= STAGE_LAB_ARRIVED && stage < STAGE_GARKOR_AFTER_LAB) {
      player.moveTo(LAB_ENTRY);
      if (stage === STAGE_LAB_ARRIVED) spawnLabGorillas(player);
      return;
    }
    player.sendMessage("You see a long passage ahead.");
  }

  function plantCharge(player, objectId) {
    const stage = stageOf(player);
    if (stage < STAGE_PLATFORM || stage >= STAGE_SHIPS_SABOTAGED) {
      player.sendMessage("Sabotaging this would be pointless.");
      return;
    }
    if (!hasItem(player, FILLED_SATCHEL_ITEM)) {
      play(player, NpcIdentifiers.MONKEY_GUARD_4, "chapter-iii-investigating-pillar");
      return;
    }
    const index = SABOTAGE_TARGET_INDEX.get(objectId);
    const mask = attribute(player, PLANTED_MASK_ATTRIBUTE);
    const bit = 1 << index;
    if (mask & bit) {
      player.sendMessage("A charge is already planted here.");
      return;
    }
    player.setAttribute(PLANTED_MASK_ATTRIBUTE, mask | bit);
    player.getInventory().deleteNumber(FILLED_SATCHEL_ITEM, 1);
    const planted = SABOTAGE_TARGET_IDS.filter((_, i) => (mask | bit) & (1 << i)).length;
    player.sendMessage("You plant a satchel of explosives.");
    if (planted >= SABOTAGE_TARGET_IDS.length) {
      play(player, NpcIdentifiers.MONKEY_GUARD_4, "chapter-iii-after-planting-the-last-explosive");
      advance(player, STAGE_SHIPS_SABOTAGED);
    }
  }

  function enterCrashSite(player) {
    const stage = stageOf(player);
    if (stage < STAGE_GARKOR_BREACH) {
      player.sendMessage("You see a dark cavern ahead.");
      return;
    }
    if (stage >= STAGE_CRASH_ENTERED) {
      player.moveTo(CRASH_LANDING);
      return;
    }
    player.moveTo(CRASH_LANDING);
    play(player, GLOUGH_CAVERN_ID, "chapter-v-confronting-glough");
    advance(player, STAGE_CRASH_ENTERED);
  }

  /** The crash-site cave Enter is captured by LocTeleports; the zone catches arrival. */
  function handleCrashZone({ player }) {
    if (stageOf(player) !== STAGE_GARKOR_BREACH) return;
    play(player, GLOUGH_CAVERN_ID, "chapter-v-confronting-glough");
    advance(player, STAGE_CRASH_ENTERED);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (pair.has(PESTLE_ITEM) && pair.has(LEMON_ITEM)) {
      event.handled = true;
      if (!hasItem(player, LEMON_ITEM)) return;
      player.getInventory().deleteNumber(LEMON_ITEM, 1);
      player.sendMessage("You mash the lemon; you can smear the pulp onto the note.");
      return;
    }
    if (pair.has(PESTLE_ITEM) && pair.has(GRAPES_ITEM)) {
      event.handled = true;
      if (!hasItem(player, GRAPES_ITEM)) return;
      player.getInventory().deleteNumber(GRAPES_ITEM, 1);
      if (hasItem(player, BRUSH_ITEM)) {
        player.getInventory().deleteNumber(BRUSH_ITEM, 1);
        addItem(player, JUICE_COATED_BRUSH_ITEM);
        player.sendMessage("You coat the brush in grape juice.");
      } else {
        player.sendMessage("You squeeze the grapes, but you have no brush to coat.");
      }
      return;
    }
    if (pair.has(JUICE_COATED_BRUSH_ITEM) && pair.has(MYSTERIOUS_NOTE_HEATED_ITEM)) {
      event.handled = true;
      player.getInventory().deleteNumber(MYSTERIOUS_NOTE_HEATED_ITEM, 1);
      addItem(player, SCRAWLED_NOTE_ITEM);
      player.sendMessage("You brush the note; letters appear in ancient gnomish.");
      advance(player, STAGE_DECRYPTED);
      return;
    }
    if (pair.has(TRANSLATION_BOOK_ITEM) && pair.has(SCRAWLED_NOTE_ITEM)) {
      event.handled = true;
      if (stageOf(player) < STAGE_BOOK_SHOWN) {
        player.sendMessage("You should show the note to King Narnode first.");
        return;
      }
      play(player, NpcIdentifiers.KING_NARNODE_SHAREEN, "chapter-i-translating-the-note");
      return;
    }
  }

  function handleItemOnObject(event) {
    const { itemId, objectId, player } = event;
    if (itemId === MYSTERIOUS_NOTE_ITEM && objectId === CANDLES_ID) {
      event.handled = true;
      player.getInventory().deleteNumber(MYSTERIOUS_NOTE_ITEM, 1);
      addItem(player, MYSTERIOUS_NOTE_HEATED_ITEM);
      player.sendMessage("You hold the note over the candle; hidden writing starts to brown.");
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (itemId === BANANA_ITEM && npcId === NpcIdentifiers.KRUK_3) {
      event.handled = true;
      play(player, npcId, "chapter-ii-confronting-kruk-using-a-banana-on-kruk");
      return;
    }
    if (npcId === NpcIdentifiers.KRUK_2 && (itemId === KRUKS_PAW_ITEM || itemId === MONKEY_TALISMAN_ITEM)) {
      event.handled = true;
      player.sendMessage("You should take that to Zooknock.");
    }
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    const option = String(event.option ?? "").toLowerCase();
    if (itemId === ROYAL_SEED_POD_ITEM && option === "commune") {
      event.handled = true;
      player.moveTo(GRAND_TREE_KING);
      player.sendMessage("The royal seed pod carries you to the Grand Tree.");
      return;
    }
    if (option !== "read") return;
    if (itemId === MYSTERIOUS_NOTE_ITEM) {
      event.handled = true;
      play(player, NpcIdentifiers.KING_NARNODE_SHAREEN, "chapter-i-reading-the-mysterious-note");
      return;
    }
    if (itemId === SCRAWLED_NOTE_ITEM) {
      event.handled = true;
      const seen = player.getAttribute(SCRAWLED_READ_ATTRIBUTE) === true;
      player.setAttribute(SCRAWLED_READ_ATTRIBUTE, true);
      play(player, NpcIdentifiers.KING_NARNODE_SHAREEN, seen
        ? "chapter-i-reading-the-scrawled-note-reading-the-scrawled-note-again"
        : "chapter-i-reading-the-scrawled-note");
      return;
    }
    if (itemId === TRANSLATED_NOTE_ITEM) {
      event.handled = true;
      play(player, NpcIdentifiers.KING_NARNODE_SHAREEN, "chapter-i-reading-the-translated-note");
    }
  }

  const SCRAWLED_READ_ATTRIBUTE = "quest.monkey_madness_ii.scrawled-read";

  // ==========================================================================
  // Deaths
  // ==========================================================================

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    const npcId = event.npcId;
    if (!killer || !DIALOGUE_NPC_TRACKED.has(npcId)) return;
    if (ownerOf(npc) && ownerOf(npc) !== killer) return;
    const player = killer;
    if (npcId === NpcIdentifiers.KRUK_3) {
      if (stageOf(player) !== STAGE_ARCHER_ASKED) return;
      if (!hasItem(player, KRUKS_PAW_ITEM)) giveOrDrop(player, KRUKS_PAW_ITEM);
      player.sendMessage("Kruk collapses; you take his paw.");
      advance(player, STAGE_KRUK_KILLED);
      return;
    }
    if (npcId === NpcIdentifiers.KOB_2) {
      if (stageOf(player) !== STAGE_KOB_CHALLENGE) return;
      advance(player, STAGE_KOB_DEFEATED);
      play(player, NpcIdentifiers.KOB, "chapter-iii-defeating-kob");
      return;
    }
    if (npcId === NpcIdentifiers.KEEF_2) {
      if (stageOf(player) !== STAGE_KEEF_CHALLENGE) return;
      advance(player, STAGE_KEEF_DEFEATED);
      play(player, NpcIdentifiers.KEEF, "chapter-iii-defeating-keef");
      return;
    }
    if (npcId === LAB_GORILLA_ID) {
      if (stageOf(player) !== STAGE_LAB_ARRIVED) return;
      const kills = attribute(player, LAB_KILLS_ATTRIBUTE) + 1;
      player.setAttribute(LAB_KILLS_ATTRIBUTE, kills);
      if (kills >= LAB_GORILLA_TILES.length) {
        advance(player, STAGE_LAB_GORILLAS);
        play(player, GLOUGH_LAB_ID, "chapter-iii-at-glough-s-secret-lab-after-defeating-all-the-tortured-gorillas");
      }
      return;
    }
    if (npcId === STRONGHOLD_GORILLA_ID) {
      if (stageOf(player) !== STAGE_NIEVE_RECRUITED) return;
      const kills = attribute(player, STRONGHOLD_KILLS_ATTRIBUTE) + 1;
      player.setAttribute(STRONGHOLD_KILLS_ATTRIBUTE, kills);
      if (kills >= STRONGHOLD_GORILLA_TILES.length) advance(player, STAGE_STRONGHOLD_GORILLAS);
      return;
    }
    if (CRASH_TORTURED_IDS.has(npcId) && stageOf(player) === STAGE_CRASH_ENTERED && inCrashSite(player)) {
      player.setAttribute(CRASH_TORTURED_ATTRIBUTE, attribute(player, CRASH_TORTURED_ATTRIBUTE) + 1);
      checkCrashSite(player);
      return;
    }
    if (CRASH_DEMONIC_IDS.has(npcId) && stageOf(player) === STAGE_CRASH_ENTERED && inCrashSite(player)) {
      player.setAttribute(CRASH_DEMONIC_ATTRIBUTE, attribute(player, CRASH_DEMONIC_ATTRIBUTE) + 1);
      checkCrashSite(player);
      return;
    }
    if (npcId === GLOUGH_DEMON_ID) {
      if (stageOf(player) !== STAGE_CRASH_GORILLAS) return;
      advance(player, STAGE_GLOUGH_DEFEATED);
      play(player, GLOUGH_CAVERN_ID, "chapter-v-after-defeating-glough");
    }
  }

  const DIALOGUE_NPC_TRACKED = new Set([
    NpcIdentifiers.KRUK_3, NpcIdentifiers.KOB_2, NpcIdentifiers.KEEF_2,
    LAB_GORILLA_ID, STRONGHOLD_GORILLA_ID, GLOUGH_DEMON_ID,
    ...CRASH_TORTURED_IDS, ...CRASH_DEMONIC_IDS,
  ]);

  function checkCrashSite(player) {
    if (attribute(player, CRASH_TORTURED_ATTRIBUTE) < 2) return;
    if (attribute(player, CRASH_DEMONIC_ATTRIBUTE) < 2) return;
    advance(player, STAGE_CRASH_GORILLAS);
    play(player, GLOUGH_CAVERN_ID, "chapter-v-after-defeating-all-the-gorillas");
    spawnDemonicGlough(player);
  }

  // ==========================================================================
  // Login
  // ==========================================================================

  function handleLogin({ player }) {
    syncSideVarps(player);
    ensureAwowogei(player);
    ensureKrukRemains(player);
  }

  function handleQuestCompleted({ player, key }) {
    if (key === "monkey_madness_ii") releaseAwowogei(player);
  }

  // ==========================================================================
  // Rewards and journal
  // ==========================================================================

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SLAYER, 80000);
    skills.addExperiences(Skill.AGILITY, 60000);
    skills.addExperiences(Skill.THIEVING, 50000);
    skills.addExperiences(Skill.HUNTER, 50000);
    giveOrDrop(player, ROYAL_SEED_POD_ITEM);
  }

  /** Reward items go on the ground rather than into the void when the inventory is full. */
  function giveOrDrop(player, itemId, amount = 1) {
    if (player.getInventory().getFreeSlots() > 0) {
      addItem(player, itemId, amount);
      return;
    }
    api.getItemOnGroundManager()?.registerLocation(
      player, new Item(itemId, amount), player.getLocation()
    );
    player.sendMessage("You couldn't hold your reward, so it was left on the ground.");
  }

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>King Narnode asked me to track down Glough after he escaped the Stronghold.</str>",
        "<str>I decoded his note, followed him to Ape Atoll and foiled the monkeys' plans.</str>",
        "<str>Nieve and I defeated the mutated Glough above the Crash Site Caverns.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ZOOKNOCK_SAVED) {
      return [
        "<str>Glough is defeated and his mutagen is corrupted.</str>",
        "",
        "I should report back to <col=800000>King Narnode</col> in the Grand Tree.",
      ];
    }
    if (stage >= STAGE_CRASH_GORILLAS) {
      return [
        "Nieve was killed when Glough consumed the mutagen.",
        "",
        "I must defeat <col=800000>Glough</col> in the caverns.",
      ];
    }
    if (stage >= STAGE_CRASH_ENTERED) {
      return [
        "I found the crash site cave. Gorillas swarm inside.",
        "",
        "I should clear a path to <col=800000>Glough</col>.",
      ];
    }
    if (stage >= STAGE_GARKOR_BREACH) {
      return [
        "<str>Glough's airship crashed north of the Stronghold.</str>",
        "",
        "I should enter the cavern to the north-east and find <col=800000>Glough</col>.",
      ];
    }
    if (stage >= STAGE_NIEVE_RECRUITED) {
      return [
        "Glough's airship is attacking the Stronghold!",
        "",
        "I must defeat the <col=800000>tortured gorillas</col> with Nieve.",
      ];
    }
    if (stage >= STAGE_KING_TOLD_2) {
      return [
        "<str>Garkor warned that Glough's airship is heading for the Stronghold.</str>",
        "",
        "I should warn <col=800000>King Narnode</col> and recruit <col=800000>Nieve</col>.",
      ];
    }
    if (stage >= STAGE_CH3_DONE) {
      return [
        "<str>Awowogei called off the attack and stripped Kruk of his rank.</str>",
        "",
        "I should get back to the <col=800000>Stronghold</col> and warn the king.",
      ];
    }
    if (stage >= STAGE_AWOWOGEI_TOLD) {
      return [
        "<str>I convinced the trolls and ogres to stay out of the alliance.</str>",
        "<str>I destroyed the airships and corrupted Glough's mutagen.</str>",
        "",
        "I should tell <col=800000>Garkor</col> the attack is called off... as Kruk.",
      ];
    }
    if (stage >= STAGE_MUTAGEN_CORRUPTED) {
      return [
        "<str>I corrupted the mutagen in Glough's laboratory.</str>",
        "",
        "I should report back to <col=800000>Garkor</col>.",
      ];
    }
    if (stage >= STAGE_LAB_ARRIVED) {
      return [
        "<str>I entered Glough's secret laboratory beneath Kruk's dungeon.</str>",
        "",
        "Glough wants the <col=800000>tortured gorillas</col> caged; I must subdue them.",
      ];
    }
    if (stage >= STAGE_GARKOR_LAB) {
      return [
        "<str>I sabotaged the airship fleet.</str>",
        "",
        "Garkor says the secret weapon is in a cavern below <col=800000>Kruk's dungeon</col>.",
      ];
    }
    if (stage >= STAGE_SHIPS_SABOTAGED) {
      return [
        "<str>I planted charges on the airship platform but I am not sure it worked.</str>",
        "",
        "I should report back to <col=800000>Garkor</col>.",
      ];
    }
    if (stage >= STAGE_PLATFORM) {
      return [
        "<str>I reached the airship construction platform.</str>",
        "",
        "I need six <col=800000>satchels</col>, the explosive barrel and the six weak points.",
      ];
    }
    if (stage >= STAGE_GARKOR_PLATFORM) {
      return [
        "<str>Le Smith revealed the fleet is being built off Ape Atoll.</str>",
        "",
        "I should find the construction platform with the <col=800000>monkey boat guard</col>.",
      ];
    }
    if (stage >= STAGE_SMITH_TALKED) {
      return [
        "<str>Assistant Le Smith is on Ape Atoll's rooftops.</str>",
        "",
        "I found him and learned of the airship fleet.",
      ];
    }
    if (stage >= STAGE_SMITH_HUNT) {
      return [
        "<str>Kob and Keef agreed not to side with the monkeys.</str>",
        "",
        "I should find <col=800000>Assistant Le Smith</col> on Ape Atoll's rooftops.",
      ];
    }
    if (stage >= STAGE_KEEF_DEFEATED) {
      return [
        "<str>Kob called off the trolls.</str>",
        "<str>Keef called off the ogres.</str>",
        "",
        "I should report back to <col=800000>Garkor</col>.",
      ];
    }
    if (stage >= STAGE_KOB_DEFEATED) {
      return [
        "<str>Kob called off the trolls after I bested him.</str>",
        "",
        "The head of the Gu'Tanoth guard, <col=800000>Keef</col>, must be next.",
      ];
    }
    if (stage >= STAGE_CH2_DONE) {
      return [
        "<str>I found Kruk's lair and Zooknock made me his greegree.</str>",
        "<str>As Kruk I learned of a three-way assault on the mainland.</str>",
        "",
        "I must convince the <col=800000>trolls</col> and <col=800000>ogres</col> not to ally with the monkeys.",
      ];
    }
    if (stage >= STAGE_AWOWOGEI_AS_KRUK) {
      return [
        "<str>Disguised as Kruk, I learned the monkeys' battle plans.</str>",
        "",
        "I should report to <col=800000>Garkor</col>.",
      ];
    }
    if (stage >= STAGE_GREE_GREE) {
      return [
        "<str>Zooknock turned Kruk's remains into a Kruk monkey greegree.</str>",
        "",
        "Disguised as <col=800000>Kruk</col>, I should report to <col=800000>Awowogei</col>.",
      ];
    }
    if (stage >= STAGE_KRUK_KILLED) {
      return [
        "<str>I defeated Kruk and took his paw.</str>",
        "",
        "I must take the paw and a <col=800000>monkey talisman</col> to <col=800000>Zooknock</col>.",
      ];
    }
    if (stage >= STAGE_ARCHER_ASKED) {
      return [
        "<str>The monkey archer says Kruk has been slipping away down the western ramp.</str>",
        "",
        "I should follow the tracks to the <col=800000>trapdoor</col> in the jungle grass.",
      ];
    }
    if (stage >= STAGE_GARKOR_KRUK) {
      return [
        "<str>Awowogei will only talk to Kruk.</str>",
        "",
        "Garkor wants me to kill <col=800000>Kruk</col> and make a greegree from his remains.",
      ];
    }
    if (stage >= STAGE_AWOWOGEI_ASKED) {
      return [
        "<str>Awowogei dismissed me; I need to speak to Kruk first.</str>",
        "",
        "I should report to <col=800000>Garkor</col>.",
      ];
    }
    if (stage >= STAGE_GARKOR_BRIEFED) {
      return [
        "<str>Garkor sent me to find out what Awowogei is planning.</str>",
        "",
        "I should speak to <col=800000>King Awowogei</col>.",
      ];
    }
    if (stage >= STAGE_CH1_DONE) {
      return [
        "<str>I decoded Glough's note and tracked Le Smith's route to Ape Atoll.</str>",
        "",
        "I should report to <col=800000>Sergeant Garkor</col> on Ape Atoll.",
      ];
    }
    if (stage >= STAGE_AUGUSTE_ASKED) {
      return [
        "<str>Auguste told me Le Smith flew the balloon to Ape Atoll.</str>",
        "",
        "I should report to <col=800000>King Narnode</col> in the Grand Tree.",
      ];
    }
    if (stage >= STAGE_LORI_ASKED) {
      return [
        "<str>Assistant Lori said to speak to Auguste on Entrana.</str>",
        "",
        "I should find <col=800000>Auguste</col> and ask about Assistant Le Smith.",
      ];
    }
    if (stage >= STAGE_KING_TOLD) {
      return [
        "<str>Anita translated the note: Le Smith helped Glough escape.</str>",
        "",
        "King Narnode said <col=800000>Assistant Lori</col> may know more.",
      ];
    }
    if (stage >= STAGE_TRANSLATED) {
      return [
        "<str>The translation book was missing too many phrases.</str>",
        "<str>Anita translated the notes for me.</str>",
        "",
        "I should show <col=800000>King Narnode</col> the translated note.",
      ];
    }
    if (stage >= STAGE_NOTE_ATTEMPTED) {
      return [
        "<str>The translation book is missing phrases from the note.</str>",
        "",
        "I should ask <col=800000>Anita</col>, the book's author, to help.",
      ];
    }
    if (stage >= STAGE_BOOK_SHOWN) {
      return [
        "<str>I found a mysterious note in Glough's home.</str>",
        "<str>King Narnode gave me his translation book.</str>",
        "",
        "I should use the book on the <col=800000>note</col>.",
      ];
    }
    if (stage >= STAGE_DECRYPTED) {
      return [
        "<str>I decoded the note with lemon juice and a brush.</str>",
        "",
        "I should show the <col=800000>scrawled note</col> to King Narnode.",
      ];
    }
    if (stage >= STAGE_UPSTAIRS) {
      return [
        "<str>I searched the hidden floor of Glough's home.</str>",
        "",
        "I should decode the <col=800000>mysterious note</col> (lemon, candles, grapes, brush).",
      ];
    }
    if (stage >= STAGE_ANITA) {
      return [
        "<str>Anita heard whispering on an upper floor of Glough's home.</str>",
        "",
        "I should search the tree and the floor above.",
      ];
    }
    if (stage >= STAGE_HANDKERCHIEF) {
      return [
        "<str>I found an embroidered handkerchief in Glough's tree.</str>",
        "",
        "I should ask <col=800000>Anita</col> about it.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>King Narnode asked me to find Glough, who has escaped.</str>",
        "",
        "I should search <col=800000>Glough's home</col> south-east of the Grand Tree.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>King Narnode Shareen</col>",
      "in the <col=800000>Grand Tree</col>.",
      "",
      "I need to have completed Monkey Madness I, Enlightened Journey,",
      "The Eyes of Glouphrie, Troll Stronghold and Watchtower.",
    ];
  }

  // ==========================================================================
  // Wiring
  // ==========================================================================

  for (const attributeKey of PERSISTED_ATTRIBUTES) api.persistAttribute(attributeKey);
  api.persistAttribute(SCRAWLED_READ_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "monkey_madness_ii",
    name: "Monkey Madness II",
    varpId: 1339,
    varbitId: VARBIT_MM2_PROGRESS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    xpRewards: [
      { skillId: Skill.SLAYER.getIndex(), amount: 80000, label: "Slayer" },
      { skillId: Skill.AGILITY.getIndex(), amount: 60000, label: "Agility" },
      { skillId: Skill.THIEVING.getIndex(), amount: 50000, label: "Thieving" },
      { skillId: Skill.HUNTER.getIndex(), amount: 50000, label: "Hunter" },
    ],
    // The seed pod is granted in grantReward (dropped if the inventory is full);
    // the scroll still shows it.
    scrollItemId: ROYAL_SEED_POD_ITEM,
    rewardItemLabel: "Royal seed pod",
    otherRewards: [
      "Duke's combat training (2 x 50,000 XP) on Ape Atoll",
      "Access to the Crash Site Cavern and demonic gorillas",
      "A gnome glider route to Ape Atoll",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectNarnodeVariant);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(CRASH_ZONE, handleCrashZone);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("quest:completed", handleQuestCompleted);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onPlayerLogin(handleLogin);
};
