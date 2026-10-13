/**
 * A Kingdom Divided (members).
 *
 * The words come from the "A Kingdom Divided" transcript page plus the
 * "Commander Fullore" and "Asteros Arceuus" pages; this plugin supplies the
 * per-stage variant selectors for the story NPCs, the prose-condition answers,
 * the object/NPC puzzles across the kingdom, the fights, the rewards and the
 * post-quest unlocks (Book of the Dead, antique lamps, Kourend Castle respawn
 * and the Arceuus spellbook flag).
 *
 * Stage (varbit 12296 "akd", varp 3063 bits 0-8). The values below are not
 * invented: every threshold was read out of this cache's own multi-loc and
 * NPC transform tables for varbit 12296, so the client resolves the correct
 * furniture/NPC states:
 *   1  Martin accepted the investigation
 *   10 searching Councillor Hughes' house (furniture interactive at 10 only)
 *   11 told Fullore about the Deeper Lode
 *   12 Fuggy names Veos' ship
 *   18 the Judge of Yama fight (re-entry portal live at 18)
 *   24 Judge defeated; Fullore outside Kourend Castle
 *   25 spoke Fullore outside; find Martin
 *   30 Library Historical Archive (Istoria distracted 30-32)
 *   34 Rose's diary taken (display empty 34-35)
 *   35 Martin hands over Rose's note
 *   36 Rose's note read
 *   42 Forthos Ruins (stone piles 42-48, vines cut at 46)
 *   50 Forthos panel open (open 50-54)
 *   52 second note taken; go to the Settlement Ruins
 *   56 Settlement Ruins (panel op 52-63)
 *   60 ice chunk meltable (60-61)
 *   62 cold key taken
 *   64 Settlement panel open (64-68)
 *   66 The Legless Faun (panel op 66-73)
 *   70 statues phase (pillar/battlement 70-78)
 *   74 final note / Martin's arrest
 *   78 the shack's hidden trapdoor opens (78 only)
 *   82 Rose found in the basement (bed named 82-106)
 *   84 Orson revealed; go to Molch (Orson 84-104)
 *   88 lizardman egg searchable (88-90, Kaht gone at 95+)
 *   92 damp key taken
 *   93 temple door (closed-with-key 84-92; open 83/93)
 *   94 Xamphur's lair (Xamphur fight)
 *   104 research table searchable (104-106)
 *   108 Fullore at the shack; gather the five Houses
 *   110 the five leaders' halls (Lord meeting variants)
 *   119 Xeric's Lookout trapdoor open
 *   122 the leaders gathered at the lookout (122-144)
 *   145 Rose's Accord; the protest is over
 *   146 the Council arrested (Andrews/Unkar jailed 146-150)
 *   148 coronation (the royal family appears at 148+)
 *   150 complete (Asteros' AKD dialogue and 11138 spawn at 148+)
 *
 * Requirements (wiki): The Depths of Despair, The Queen of Thieves, The
 * Ascent of Arceuus, The Forsaken Tower and Tale of the Righteous complete
 * (Client of Kourend and X Marks the Spot are implied), plus 54 Agility,
 * 52 Thieving, 52 Woodcutting, 50 Herblore, 42 Mining, 38 Crafting and 35
 * Magic, all not boostable.
 *
 * Rewards (wiki): 2 Quest points, the Book of the Dead, two antique lamps
 * (10,000 XP to any skill level 40+; one if the Architectural Alliance lamp
 * was claimed before the 2024 favour removal), the Kourend Castle respawn
 * point via Asteros Arceuus, 24 new Arceuus spellbook spells and the ability
 * to fight Yama.
 *
 * Post-quest unlocks: the Book of the Dead (25818) is what the Arceuus thrall
 * spells require, so granting it is the whole unlock; the lamps open the
 * xpreward interface with minLevel 40 and a flat 10,000 XP; Asteros (11138)
 * offers the Kourend respawn, which this plugin honours in onPlayerDeath; and
 * varbit 9631 "arceuus_spellbook_unlocked" is set on completion. There is no
 * active Arceuus quest gate in this server (the spells were deliberately
 * ungated in commit 77809f79), so nothing needed removing.
 *
 * Gaps / approximations (see also the final report):
 *  - Cutscenes are played as transcript dialogue plus summary messages; the
 *    cinematic camera/fade presentation is not reproduced. The Judge and
 *    Xamphur fights happen where their transcripts leave the player
 *    (Piscarilius docks and the lab instance at 3031,5943) rather than in a
 *    scripted instance with the special wave/hand mechanics.
 *  - The Forthos ROSE stone-pile combination is simplified: inspecting all
 *    four piles reveals the word, then checking the panel opens it (no
 *    per-player random digit entry UI exists).
 *  - The Legless Faun statue ordering is simplified: the panel gives the
 *    order, inspecting the statues advances the puzzle.
 *  - The Hughes house optional clue objects each give their wiki item once,
 *    but the exact per-object clue mapping is approximate.
 *  - Yama: the boss NPCs exist in the cache (14176 Yama, 14179-14185) but
 *    there is no Yama lair/boss implementation in this server, so the reward
 *    is the flag/ability only; the actual fight remains unimplemented.
 *  - The Architectural Alliance miniquest does not exist here, so both lamps
 *    are always claimable (the wiki's one-lamp exception cannot trigger).
 */
module.exports = function registerAKingdomDividedQuest(api) {
  const {
    Location,
    Skill,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    GameObject,
    ObjectManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "A Kingdom Divided";
  const FULLORE_PAGE = "Commander Fullore";
  const ASTEROS_PAGE = "Asteros Arceuus";

  // Varbit 12296 "akd" (varp 3063, bits 0-8); the stage map above is its real
  // threshold table from the cache's multi-loc/NPC transforms.
  const VARP_AKD = 3063;
  const VARBIT_STAGE = 12296;
  const VARBIT_DEMON_FOUND = 12297;
  const VARBIT_HUGHES_RECEIPT = 12298;
  const VARBIT_HUGHES_CONFIRMATION = 12299;
  const VARBIT_HUGHES_MAP = 12300;
  const VARBIT_HUGHES_ORDER = 12301;
  const VARBIT_TOMAS_LIE = 12302;
  // Cache NPC transforms these varbits read: 12144 "tomas_lawry_location"
  // moves Tomas Lawry to the castle for the investigation, 12145
  // "piscquest_queen_vis" unmaskes the Queen of Thieves as Lady Shauna.
  const VARBIT_TOMAS_LOCATION = 12144;
  const VARBIT_QUEEN_VISIBLE = 12145;
  const VARBIT_ORSON_LOOKOUT = 12311;
  const VARBIT_PISCARILIUS_HELPED = 12318; // bits 8-11
  const VARBIT_ARCEUUS_HELPED = 12319; // bits 12-15
  const VARBIT_LOVAKENGJ_HELPED = 12320; // bits 16-20
  const VARBIT_HOSIDIUS_HELPED = 12321; // bits 21-24
  const VARBIT_SHAYZIEN_HELPED = 12322; // bits 25-28
  const VARBIT_FUNERAL = 12310; // akd funeral/sealing flag, mirrored locally
  const VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED = 9631; // varp 2071 bit 17

  const STAGE_STARTED = 1;
  const STAGE_HOUSE = 10;
  const STAGE_FULLORE_KINGSTOWN = 11;
  const STAGE_FUGGY = 12;
  const STAGE_JUDGE = 18;
  const STAGE_JUDGE_DEAD = 24;
  const STAGE_FULLORE_OUTSIDE = 25;
  const STAGE_ARCHIVE = 30;
  const STAGE_DIARY = 34;
  const STAGE_NOTE = 35;
  const STAGE_NOTE_READ = 36;
  const STAGE_FORTHOS = 42;
  const STAGE_FORTHOS_PANEL = 50;
  const STAGE_FORTHOS_NOTE = 52;
  const STAGE_SETTLEMENT = 56;
  const STAGE_ASSASSIN = 57;
  const STAGE_ASSASSIN_DEAD = 58;
  const STAGE_ICE = 60;
  const STAGE_COLD_KEY = 62;
  const STAGE_SETTLEMENT_PANEL = 64;
  const STAGE_SETTLEMENT_DONE = 65;
  const STAGE_FAUN = 66;
  const STAGE_FAUN_TALK = 67;
  const STAGE_FAUN_PANEL = 70;
  const STAGE_FAUN_NOTE = 74;
  const STAGE_SHACK = 78;
  const STAGE_BASEMENT = 82;
  const STAGE_ORSON = 84;
  const STAGE_EGG = 88;
  const STAGE_EGG_TAKEN = 90;
  const STAGE_KEY = 92;
  const STAGE_XAMPHUR = 94;
  const STAGE_TABLE = 104;
  const STAGE_NOTES_READ = 106;
  const STAGE_HOUSES = 110;
  const STAGE_LOOKOUT = 119;
  const STAGE_MEETING = 122;
  // The cache's 12296 transform tables put the leaders/Fullore at Xeric's
  // Lookout for 122-134 and 138-144, so the accord basement scene (the
  // "Rose's Accord" cutscene and the Hosidius/Fullore talks) is stage 138.
  const STAGE_ACCORD = 138;
  const STAGE_ARREST = 146;
  const STAGE_CORONATION = 148;
  const STAGE_COMPLETE = 150;

  const AGILITY_REQUIREMENT = 54;
  const THIEVING_REQUIREMENT = 52;
  const WOODCUTTING_REQUIREMENT = 52;
  const HERBLORE_REQUIREMENT = 50;
  const MINING_REQUIREMENT = 42;
  const CRAFTING_REQUIREMENT = 38;
  const MAGIC_REQUIREMENT = 35;
  const LAMP_MIN_LEVEL = 40;
  const LAMP_XP = 10_000;
  const LAMP_CLAIMS = 2;

  const REQUIRED_QUESTS = [
    ["the_depths_of_despair", "The Depths of Despair"],
    ["the_queen_of_thieves", "The Queen of Thieves"],
    ["the_ascent_of_arceuus", "The Ascent of Arceuus"],
    ["the_forsaken_tower", "The Forsaken Tower"],
    ["tale_of_the_righteous", "Tale of the Righteous"],
  ];

  // NPC ids. Most are spawned by the world; the story variants the world does
  // not place are spawned owner-only by this plugin.
  const MARTIN_STORY_IDS = new Set([
    NpcIdentifiers.MARTIN_HOLT, // 10890 castle/Settlement/Faun spawns
    NpcIdentifiers.MARTIN_HOLT_2, // 10891
    NpcIdentifiers.MARTIN_HOLT_3, // 10892 prison
    NpcIdentifiers.MARTIN_HOLT_4, // 10893
    NpcIdentifiers.MARTIN_HOLT_5, // 10894
    NpcIdentifiers.MARTIN_HOLT_6, // 10895
    7609, // world spawn at the Forthos Ruins
    7017, // world spawn at the Kingstown protest platform
  ]);
  const FULLORE_STORY_IDS = new Set([
    NpcIdentifiers.COMMANDER_FULLORE, // 10922
    NpcIdentifiers.COMMANDER_FULLORE_2, // 10923
    11117, // world: castle ground floor
    11118, // world: Kingstown (Hughes house)
    11119, // world: Port Piscarilius docks
    11120, // world: south of the castle
    11121, // world: the shack basement
    11122, // world: the shack (post-funeral)
    11123, // world: Xeric's Lookout
  ]);
  const TOMAS_IDS = new Set([7904, NpcIdentifiers.TOMAS_LAWRY_2, NpcIdentifiers.TOMAS_LAWRY_3, 10930]);
  const FUGGY_ID = NpcIdentifiers.FUGGY; // 7090
  const HERBERT_IDS = new Set([
    NpcIdentifiers.CABIN_BOY_HERBERT, // 10932
    NpcIdentifiers.CABIN_BOY_HERBERT_2, // 10933
    NpcIdentifiers.CABIN_BOY_HERBERT_3, // 10934
    11125,
    11126,
    11127,
  ]);
  const ARCHEIO_ID = NpcIdentifiers.ARCHEIO; // 7614
  const ISTORIA_IDS = new Set([NpcIdentifiers.ISTORIA, NpcIdentifiers.ISTORIA_2, 11151]);
  const ORSON_IDS = new Set([NpcIdentifiers.COUNCILLOR_ORSON, 11128]);
  const KAHT_ID = 11039;
  const KAHT_IDS = new Set([KAHT_ID, 11149]);
  // 7669 transforms on varbit 16284 to the 14186/14187 story variants.
  const DISCIPLE_OF_YAMA_IDS = new Set([7669, 7670, 14186, 14187]);
  const TASAKAAL_IDS = new Set([8602, 8603, 8604]);
  const MORI_IDS = new Set([NpcIdentifiers.MORI, NpcIdentifiers.MORI_2, 8501, 8502]);
  const JORRA_IDS = new Set([11037, 11141, 11147]);
  const PHILEAS_IDS = new Set([7999, 10990, 10991]);
  const LORD_TROBIN_IDS = new Set([8504, 8505, 10961, 10962, 11132]);
  const LORD_KANDUR_IDS = new Set([10966, 10967, 10968, 10969, 10970, 10971, 11033, 11134, 11143]);
  const LADY_VULCANA_IDS = new Set([10972, 10973, 11035, 11135]);
  const LADY_SHAUNA_IDS = new Set([7908, 7909, 10974, 10975, 11136]);
  const LORD_SHIRO_IDS = new Set([10963, 10964, 10965, 11038, 11133, 11148]);
  const ASTEROS_IDS = new Set([10889, 10978, 10979, 11138]);
  const JUDGE_OF_YAMA_NPC_ID = 10938;
  const ASSASSIN_SETTLEMENT_ID = 10940;
  const ASSASSIN_SHAYZIEN_ID = 10941;
  const XAMPHUR_ID = 10955;
  const BARBARIAN_WARLORD_ID = 10989;
  const LIZARDMAN_BRUTE_QUEST_ID = 10947;
  const ICE_CHUNKS_IDS = new Set([11028, 11029, 11030, 11031, 11142]);

  // Items.
  const RECEIPT_ITEM_ID = ItemIdentifiers.RECEIPT_2; // 25793
  const ROSE_ITEM_ID = ItemIdentifiers.ROSE; // 25795
  const DELIVERY_CONFIRMATION_ITEM_ID = ItemIdentifiers.DELIVERY_CONFIRMATION; // 25796
  const ORDER_FORM_ITEM_ID = ItemIdentifiers.ORDER_FORM; // 25797
  const DEMONIC_INCANTATIONS_ITEM_ID = ItemIdentifiers.DEMONIC_INCANTATIONS; // 25798
  const BLOODY_KNIFE_ITEM_ID = ItemIdentifiers.BLOODY_KNIFE; // 25799
  const CULTIST_ROBE_ITEM_ID = ItemIdentifiers.CULTIST_ROBE; // 25800
  const KOUREND_MAP_ITEM_ID = ItemIdentifiers.KOUREND_MAP; // 25801
  const ROSES_DIARY_ITEM_ID = ItemIdentifiers.ROSES_DIARY; // 25802
  const BLUISH_KEY_ITEM_ID = ItemIdentifiers.BLUISH_KEY; // 25803
  const COLD_KEY_ITEM_ID = ItemIdentifiers.COLD_KEY; // 25804
  const ROSE_NOTE_ITEM_IDS = [
    ItemIdentifiers.ROSES_NOTE, // 25805
    ItemIdentifiers.ROSES_NOTE_2, // 25806
    ItemIdentifiers.ROSES_NOTE_3, // 25807
    ItemIdentifiers.ROSES_NOTE_4, // 25808
  ];
  const LIZARDMAN_EGG_ITEM_ID = ItemIdentifiers.LIZARDMAN_EGG; // 25809
  const DAMP_KEY_ITEM_ID = ItemIdentifiers.DAMP_KEY; // 25810
  const BROKEN_REDIRECTOR_ITEM_ID = ItemIdentifiers.BROKEN_REDIRECTOR; // 25811
  const SULPHUR_POTION_ITEM_ID = ItemIdentifiers.SULPHUR_POTION; // 25812
  const SHIELDING_POTION_ITEM_ID = ItemIdentifiers.SHIELDING_POTION; // 25813
  const DECLARATION_ITEM_ID = ItemIdentifiers.DECLARATION; // 25814
  const DARK_NULLIFIER_ITEM_ID = ItemIdentifiers.DARK_NULLIFIER; // 25815
  const SHAYZIEN_JOURNAL_ITEM_ID = ItemIdentifiers.SHAYZIEN_JOURNAL; // 25816
  const BOOK_OF_THE_DEAD_ITEM_ID = ItemIdentifiers.BOOK_OF_THE_DEAD; // 25818
  const ANTIQUE_LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP_24; // 25820
  const RESEARCH_NOTES_ITEM_ID = ItemIdentifiers.RESEARCH_NOTES_2; // 25824
  const TATTY_NOTE_ITEM_ID = ItemIdentifiers.TATTY_NOTE; // 23007
  const VOLCANIC_SULPHUR_ITEM_ID = ItemIdentifiers.VOLCANIC_SULPHUR;
  const DEFENCE_POTION_IDS = [
    ItemIdentifiers.DEFENCE_POTION_4_, // 2432 (4)
    ItemIdentifiers.DEFENCE_POTION_3_, // 133 (3)
    ItemIdentifiers.DEFENCE_POTION_2_, // 135 (2)
    ItemIdentifiers.DEFENCE_POTION_1_, // 137 (1)
  ];
  const MOLTEN_GLASS_ITEM_ID = ItemIdentifiers.MOLTEN_GLASS;
  const DARK_ESSENCE_BLOCK_ITEM_ID = ItemIdentifiers.DARK_ESSENCE_BLOCK;

  // Object multi-loc parents, from this cache's map placements. The house uses
  // two parallel parent sets for the same furniture (the 4177x/4179x aliases at
  // the first-floor placements), so each entry carries the clue slot it shares.
  const HUGHES_OBJECTS = new Map([
    [42431, { slot: 0, item: ROSE_ITEM_ID, name: "the roses" }],
    [42432, { slot: 1, item: ORDER_FORM_ITEM_ID, name: "a cabinet", varbit: VARBIT_HUGHES_ORDER }],
    [41784, { slot: 1, item: ORDER_FORM_ITEM_ID, name: "a cabinet", varbit: VARBIT_HUGHES_ORDER }],
    [42433, { slot: 2, item: DELIVERY_CONFIRMATION_ITEM_ID, name: "a cabinet", varbit: VARBIT_HUGHES_CONFIRMATION }],
    [41785, { slot: 2, item: DELIVERY_CONFIRMATION_ITEM_ID, name: "a cabinet", varbit: VARBIT_HUGHES_CONFIRMATION }],
    [42434, { slot: 3, item: KOUREND_MAP_ITEM_ID, name: "the bath", varbit: VARBIT_HUGHES_MAP }],
    [42435, { slot: 4, item: DEMONIC_INCANTATIONS_ITEM_ID, name: "the desk", varbit: VARBIT_DEMON_FOUND }],
    [42436, { slot: 5, item: BLOODY_KNIFE_ITEM_ID, name: "the dresser" }],
    [42437, { slot: 6, item: CULTIST_ROBE_ITEM_ID, name: "the wardrobe" }],
    [41794, { slot: 6, item: CULTIST_ROBE_ITEM_ID, name: "the wardrobe" }],
    [42438, { slot: 7, item: RECEIPT_ITEM_ID, name: "the drawers", varbit: VARBIT_HUGHES_RECEIPT }],
    [41797, { slot: 7, item: RECEIPT_ITEM_ID, name: "the drawers", varbit: VARBIT_HUGHES_RECEIPT }],
    [41798, { slot: 7, item: RECEIPT_ITEM_ID, name: "the drawers", varbit: VARBIT_HUGHES_RECEIPT }],
    [42439, { slot: 8, item: null, name: "the bed" }],
    [42440, { slot: 9, item: null, name: "the table" }],
    [42441, { slot: 10, item: null, name: "the skeleton" }],
  ]);
  const HUGHES_DRAWERS_SLOT = 7;
  const HUGHES_JUDGE_PORTAL_ID = 42442; // (1823,3684,0) Port Piscarilius re-entry
  const ARCHIVE_DISPLAY_ID = 42443; // (1559,10219,0)
  const FORTHOS_VINES_ID = 42444; // (1671,3577,0)
  const FORTHOS_PANEL_ID = 42445; // (1672,3579,0)
  const FORTHOS_STONE_PILE_ID = 42446; // four piles around the ruin
  const SETTLEMENT_PANEL_ID = 42447; // (1543,3892,0)
  const PISCARILIUS_PANEL_ID = 42448; // (1768,3686,1)
  const PISCARILIUS_STATUE_IDS = [42453, 42451, 42455, 42452, 42454]; // Lovakengj, Arceuus, Shayzien, Hosidius, Piscarilius
  const PISCARILIUS_PILLAR_ID = 42449; // (1772,3680,0)
  const PISCARILIUS_BATTLEMENT_ID = 42450; // (1772,3679,1)
  const ROSE_BASEMENT_ENTRY_ID = 42456; // (1281,3763,0) shack crates/trapdoor
  const ROSE_BASEMENT_LADDER_ID = 41853; // basement exit ladder
  const SHACK_LANDING = { x: 1280, y: 3764, z: 0 };
  const TEMPLE_DOOR_ID = 42459; // (1323,10080,0)
  const LIZARD_EGG_OBJECT_IDS = new Set([42460, 42461, 42462]); // correct/center/corner
  const XAMPHUR_TABLE_ID = 42463; // (3031,5943,0)
  const XAMPHUR_TABLE_TILE = { x: 3031, y: 5943, z: 0 };
  const LOOKOUT_TRAPDOOR_ID = 42464; // (1590,3526,0)
  const HOSIDIUS_OFFICE_ENTRY_ID = 42465; // (1809,3544,0) wine barrel
  const HOSIDIUS_OFFICE_CHEST_ID = 41931; // (1898,9957,0) Picklock
  const DOORS_OF_DINH_ID = ObjectIdentifiers.DOORS_OF_DINH; // 29322 (1627,3964,0)

  const FORTHOS_STONE_TILES = [
    { x: 1670, y: 3575 },
    { x: 1672, y: 3571 },
    { x: 1678, y: 3567 },
    { x: 1680, y: 3576 },
  ];
  const HUGHES_HOUSE_ZONE = { minX: 1665, maxX: 1690, minY: 3672, maxY: 3690, levels: [0, 1, 2] };
  const FORTHOS_ZONE = { minX: 1660, maxX: 1690, minY: 3560, maxY: 3590, levels: [0] };
  const SETTLEMENT_ZONE = { minX: 1530, maxX: 1560, minY: 3880, maxY: 3905, levels: [0] };
  const FAUN_ZONE = { minX: 1760, maxX: 1780, minY: 3672, maxY: 3692, levels: [0, 1] };
  const SHACK_ZONE = { minX: 1270, maxX: 1290, minY: 3752, maxY: 3772, levels: [0] };
  const BASEMENT_ZONE = { minX: 1175, maxX: 1200, minY: 10255, maxY: 10275, levels: [0] };
  const TEMPLE_ZONE = { minX: 1310, maxX: 1345, minY: 10065, maxY: 10095, levels: [0] };
  const LAB_ZONE = { minX: 3020, maxX: 3045, minY: 5930, maxY: 5960, levels: [0] };
  const BARBARIAN_CAMP_ZONE = { minX: 1565, maxX: 1595, minY: 9815, maxY: 9850, levels: [0] };
  const LOOKOUT_ZONE = { minX: 1580, maxX: 1600, minY: 3515, maxY: 3535, levels: [0, 1] };
  const LOOKOUT_BASEMENT_ZONE = { minX: 1555, maxX: 1580, minY: 9945, maxY: 9965, levels: [0] };
  const HOSIDIUS_OFFICE_ZONE = { minX: 1890, maxX: 1910, minY: 9948, maxY: 9965, levels: [0] };

  const HUGHES_HOUSE_TILE = { x: 1677, y: 3686, z: 0 };
  const BASEMENT_LANDING = { x: 1186, y: 10264, z: 0 };
  const XAMPHUR_LAB_TILE = { x: 3031, y: 5940, z: 0 };
  const CHASM_FOREST_TILE = { x: 1404, y: 3660, z: 0 };
  const KOUREND_CASTLE_RESPAWN = { x: 1634, y: 3679, z: 0 };

  const KANDUR_BASEMENT_TILE = { x: 1568, y: 9955, z: 0 };

  // Prose-condition step ids on the transcript pages.
  const NO_REQUIREMENTS_STEP_ID = "TSrl_5";
  const HAS_REQUIREMENTS_STEP_ID = "XbjdFE";
  const MEMOIR_USED_STEP_IDS = new Set(["_Vitw1", "UjYANw"]); // "has not used"
  const MEMOIR_UNUSED_STEP_IDS = new Set(["7v1NB0", "xgb3ZY"]); // "has used"
  const MORI_NO_MATERIALS_STEP_ID = "ljMJ1O";
  const MORI_HAS_MATERIALS_STEP_ID = "j5_KeL";

  // Text anchors for stage transitions the transcripts only narrate.
  const MARTIN_ARRESTS_TEXT = "Rose can take her rightful place on the throne.";
  const MARTIN_SPLIT_TEXT = "We should split up. The Council could be watching us";
  const FULLORE_DEED_LODE_TEXT = "It's the pub in Lovakengj, north west of here.";
  const FUGGY_SHIP_TEXT = "catching a ship at Port Piscarilius";
  const JUDGE_BEGIN_TEXT = "Now, in the name of Yama, let us begin.";
  const ACCORD_NAMED_TEXT = "I name this declaration Rose's Accord.";

  const STONE_PILES_ATTRIBUTE = "quest.a_kingdom_divided.stone-piles";
  const VINES_ATTRIBUTE = "quest.a_kingdom_divided.vines-cut";
  const STATUES_ATTRIBUTE = "quest.a_kingdom_divided.statues";
  const RECRUITED_ATTRIBUTE = "quest.a_kingdom_divided.recruited";
  const HELPED_ATTRIBUTE = "quest.a_kingdom_divided.helped";
  const LAMPS_ATTRIBUTE = "quest.a_kingdom_divided.lamps-rubbed";
  const ASTEROS_MET_ATTRIBUTE = "quest.a_kingdom_divided.asteros-met";
  const RESPAWN_ATTRIBUTE = "quest.a_kingdom_divided.respawn";
  const FUNERAL_ATTRIBUTE = "quest.a_kingdom_divided.funeral";
  const EGG_SEARCHED_ATTRIBUTE = "quest.a_kingdom_divided.egg-searched";
  const JORRA_TASK_ATTRIBUTE = "quest.a_kingdom_divided.jorra-task";
  const JORRA_DONE_ATTRIBUTE = "quest.a_kingdom_divided.jorra-assassin-dead";
  const HERBERT_ASKED_ATTRIBUTE = "quest.a_kingdom_divided.herbert-asked";
  const FUGGY_TOLD_ATTRIBUTE = "quest.a_kingdom_divided.fuggy-told";
  const KAHT_ASKED_ATTRIBUTE = "quest.a_kingdom_divided.kaht-asked";
  const FORTHOS_NOTE_ATTRIBUTE = "quest.a_kingdom_divided.forthos-note-seen";
  const SETTLEMENT_NOTE_ATTRIBUTE = "quest.a_kingdom_divided.settlement-note-seen";
  const MARTIN_PRISON_ATTRIBUTE = "quest.a_kingdom_divided.martin-prison-told";
  const KANDUR_ACCORD_ATTRIBUTE = "quest.a_kingdom_divided.kandur-accord";
  const FAUN_ORDER_ATTRIBUTE = "quest.a_kingdom_divided.faun-order";

  const RESPAWN_KOUREND = "kourend";

  const RECRUITED_VARBITS = new Map([
    ["piscarilius", 12313],
    ["arceuus", 12314],
    ["lovakengj", 12315],
    ["hosidius", 12316],
    ["shayzien", 12317],
  ]);
  const RECRUIT_BITS = { piscarilius: 0, arceuus: 1, lovakengj: 2, hosidius: 3, shayzien: 4 };
  const HELPED_VARBITS = new Map([
    ["piscarilius", VARBIT_PISCARILIUS_HELPED],
    ["arceuus", VARBIT_ARCEUUS_HELPED],
    ["lovakengj", VARBIT_LOVAKENGJ_HELPED],
    ["hosidius", VARBIT_HOSIDIUS_HELPED],
    ["shayzien", VARBIT_SHAYZIEN_HELPED],
  ]);
  const HELPED_DONE = 14;
  const HELPED_TASK_STARTED = {
    piscarilius: 2,
    arceuus: 2,
    lovakengj: 6,
    hosidius: 2,
    shayzien: 1,
  };

  let quest;
  const trackedNpcs = new Map();

  // ==========================================================================
  // State helpers
  // ==========================================================================

  const stageOf = (player) => quest.getStage(player);

  function advance(player, stage) {
    if (stageOf(player) < stage) quest.setStage(player, stage);
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function give(player, itemId, amount, message) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount ?? 1);
    if (message) player.sendMessage(message);
    return true;
  }

  function take(player, itemId, amount = 1) {
    if (held(player, itemId, amount)) {
      player.getInventory().deleteNumber(itemId, amount);
      return true;
    }
    return false;
  }

  function countAttribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function bitAttribute(player, key, bit) {
    return (countAttribute(player, key) & (1 << bit)) !== 0;
  }

  function setBitAttribute(player, key, bit) {
    player.setAttribute(key, countAttribute(player, key) | (1 << bit));
  }

  function clueTaken(player, index) {
    return bitAttribute(player, "quest.a_kingdom_divided.clues", index);
  }

  function markClue(player, index) {
    setBitAttribute(player, "quest.a_kingdom_divided.clues", index);
  }

  function recruited(player, house) {
    return bitAttribute(player, RECRUITED_ATTRIBUTE, RECRUIT_BITS[house]);
  }

  function markRecruited(player, house) {
    if (recruited(player, house)) return;
    setBitAttribute(player, RECRUITED_ATTRIBUTE, RECRUIT_BITS[house]);
    const varbit = RECRUITED_VARBITS.get(house);
    if (varbit !== undefined) player.getPacketSender().sendVarbit(varbit, 1);
  }

  function allRecruited(player) {
    return Object.keys(RECRUIT_BITS).every((house) => recruited(player, house));
  }

  function helpedValue(player, house) {
    return countAttribute(player, `${HELPED_ATTRIBUTE}.${house}`);
  }

  function setHelped(player, house, value) {
    if (helpedValue(player, house) >= value) return;
    player.setAttribute(`${HELPED_ATTRIBUTE}.${house}`, value);
    const varbit = HELPED_VARBITS.get(house);
    if (varbit !== undefined) player.getPacketSender().sendVarbit(varbit, value);
  }

  function allHelped(player) {
    return Object.keys(HELPED_VARBITS).every((house) => helpedValue(player, house) >= HELPED_DONE);
  }

  function respawnPoint(player) {
    return String(player.getAttribute(RESPAWN_ATTRIBUTE) ?? "");
  }

  /** Re-sends every mirrored varbit (login/bootstrap resync). */
  function sendQuestProgressVarbits(player) {
    const sender = player.getPacketSender();
    for (const [house, varbit] of RECRUITED_VARBITS) {
      sender.sendVarbit(varbit, recruited(player, house) ? 1 : 0);
    }
    for (const [house, varbit] of HELPED_VARBITS) {
      sender.sendVarbit(varbit, helpedValue(player, house));
    }
    sender.sendVarbit(VARBIT_FUNERAL, countAttribute(player, FUNERAL_ATTRIBUTE) ? 1 : 0);
    syncStageVarbits(player);
  }

  // ==========================================================================
  // Requirements
  // ==========================================================================

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    return Number(player.getAttribute(`quest.${key}.stage`)) >= 2;
  }

  function questStarted(player, key) {
    const request = { player, key, started: null };
    api.emitCustomEvent("quest:is-started", request);
    if (typeof request.started === "boolean") return request.started;
    return Number(player.getAttribute(`quest.${key}.stage`)) >= 1;
  }

  function missingRequirement(player) {
    const skills = player.getSkillManager();
    const checks = [
      [Skill.AGILITY, AGILITY_REQUIREMENT, "Agility"],
      [Skill.THIEVING, THIEVING_REQUIREMENT, "Thieving"],
      [Skill.WOODCUTTING, WOODCUTTING_REQUIREMENT, "Woodcutting"],
      [Skill.HERBLORE, HERBLORE_REQUIREMENT, "Herblore"],
      [Skill.MINING, MINING_REQUIREMENT, "Mining"],
      [Skill.CRAFTING, CRAFTING_REQUIREMENT, "Crafting"],
      [Skill.MAGIC, MAGIC_REQUIREMENT, "Magic"],
    ];
    for (const [skill, level, name] of checks) {
      if (skills.getMaxLevel(skill) < level) {
        return `You need at least level ${level} ${name} to start this quest.`;
      }
    }
    for (const [key, name] of REQUIRED_QUESTS) {
      if (!questComplete(player, key)) return `You need to complete ${name} before starting this quest.`;
    }
    return null;
  }

  function meetsRequirements(player) {
    return missingRequirement(player) === null;
  }

  // ==========================================================================
  // Dialogue variants
  // ==========================================================================

  function martinVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-a-kingdom-divided";
    if (stage <= 0) return "the-disgraced-councillor-s-escape-talking-to-martin-holt";
    if (stage < STAGE_HOUSE) return "the-disgraced-councillor-s-escape-talking-to-martin-holt-talking-to-martin-holt-again";
    if (stage === STAGE_HOUSE) return "the-disgraced-councillor-s-escape-talking-to-martin-holt-after-beginning-the-investigation";
    if (stage < STAGE_JUDGE_DEAD) return null;
    if (stage < STAGE_FULLORE_OUTSIDE) return "kourend-s-last-princess-talking-to-martin-holt-before-speaking-to-commander-fullore";
    if (stage < STAGE_ARCHIVE) return "kourend-s-last-princess-talking-to-martin-holt-after-speaking-to-commander-fullore";
    if (stage < STAGE_DIARY) return "kourend-s-last-princess-talking-to-martin-holt-talking-to-martin-holt-again";
    if (stage < STAGE_NOTE) return "kourend-s-last-princess-returning-to-martin-holt";
    if (stage < STAGE_NOTE_READ) return "kourend-s-last-princess-talking-to-martin-holt-after-reading-rose-s-note";
    if (stage < STAGE_FORTHOS) return "kourend-s-last-princess-talking-to-martin-holt-after-reading-rose-s-note";
    if (stage < STAGE_FORTHOS_NOTE) {
      return countAttribute(player, FORTHOS_NOTE_ATTRIBUTE)
        ? "kourend-s-last-princess-talking-to-martin-holt-at-the-forthos-ruin-talking-to-martin-holt-again-after-finding-rose-s-second-note"
        : "kourend-s-last-princess-talking-to-martin-holt-at-the-forthos-ruin";
    }
    if (stage < STAGE_SETTLEMENT) {
      return countAttribute(player, FORTHOS_NOTE_ATTRIBUTE)
        ? "kourend-s-last-princess-talking-to-martin-holt-at-the-forthos-ruin-talking-to-martin-holt-again-after-finding-rose-s-second-note"
        : "kourend-s-last-princess-talking-to-martin-holt-at-the-forthos-ruin-talking-to-martin-holt-again-before-leaving";
    }
    if (stage < STAGE_ASSASSIN_DEAD) return "kourend-s-last-princess-talking-to-martin-holt-at-the-settlement-ruins";
    if (stage < STAGE_FAUN) {
      return countAttribute(player, SETTLEMENT_NOTE_ATTRIBUTE)
        ? "kourend-s-last-princess-talking-to-martin-holt-at-the-settlement-ruins-talking-to-martin-holt-again-before-leaving"
        : "kourend-s-last-princess-talking-to-martin-holt-at-the-settlement-ruins-talking-to-martin-holt-again-after-defeating-the-assassin";
    }
    if (stage < STAGE_FAUN_NOTE) return "kourend-s-last-princess-talking-to-martin-holt-at-the-legless-faun";
    if (stage < STAGE_ARREST) {
      // Imprisoned in Shayzien for the Lady Lovakengj favour.
      return countAttribute(player, MARTIN_PRISON_ATTRIBUTE)
        ? "lady-lovakengj-s-favour-talking-to-martin-holt-talking-to-martin-holt-again"
        : "lady-lovakengj-s-favour-talking-to-martin-holt";
    }
    return null;
  }

  function fulloreVariant(player, npcId) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage < STAGE_HOUSE) {
      return npcId === 11117 || npcId === 10922
        ? "the-disgraced-councillor-s-escape-talking-to-commander-fullore"
        : null;
    }
    if (stage === STAGE_HOUSE) return "the-disgraced-councillor-s-escape-talking-to-commander-fullore-in-kingstown";
    if (stage < STAGE_JUDGE) return null;
    if (stage === STAGE_JUDGE) return "the-disgraced-councillor-s-escape-talking-to-commander-fullore";
    if (stage < STAGE_FULLORE_OUTSIDE) return "kourend-s-last-princess-talking-to-commander-fullore-outside-kourend-castle";
    if (stage < STAGE_ARCHIVE) return "kourend-s-last-princess-talking-to-commander-fullore-again";
    if (stage < STAGE_NOTES_READ) return null;
    if (stage < STAGE_HOUSES) return "the-mysterious-mage-returning-to-commander-fullore";
    if (stage < STAGE_MEETING) {
      return allRecruited(player)
        ? "the-houses-of-kourend-talking-to-commander-fullore-after-gathering-the-leaders"
        : "the-houses-of-kourend-talking-to-commander-fullore-at-xeric-s-lookout";
    }
    if (stage < STAGE_ACCORD) {
      const lovakengj = helpedValue(player, "lovakengj");
      if (lovakengj >= HELPED_TASK_STARTED.lovakengj - 1 && lovakengj < HELPED_DONE) {
        return lovakengj === HELPED_TASK_STARTED.lovakengj - 1
          ? "lady-lovakengj-s-favour-talking-to-commander-fullore"
          : "lady-lovakengj-s-favour-talking-to-commander-fullore-talking-to-commander-fullore-again";
      }
      if (allHelped(player)) return "the-new-royal-accord-rose-s-accord";
      return "the-houses-of-kourend-talking-to-commander-fullore-after-gathering-the-leaders-talking-to-commander-fullore-again";
    }
    if (stage < STAGE_ARREST) {
      return countAttribute(player, KANDUR_ACCORD_ATTRIBUTE)
        ? "the-new-royal-accord-talking-to-commander-fullore-after-talking-to-lord-hosidius"
        : "the-new-royal-accord-talking-to-commander-fullore-before-talking-to-lord-hosidius";
    }
    return "the-council-s-end-coronation-ceremony";
  }

  function selectVariant({ npcId, player }) {
    if (!player || typeof player.getAttribute !== "function") return null;
    if (MARTIN_STORY_IDS.has(npcId)) return martinVariant(player);
    if (FULLORE_STORY_IDS.has(npcId)) return fulloreVariant(player, npcId);
    if (TOMAS_IDS.has(npcId)) {
      return stageOf(player) === STAGE_HOUSE
        ? "the-disgraced-councillor-s-escape-talking-to-tomas-lawry"
        : null;
    }
    if (npcId === FUGGY_ID) {
      const stage = stageOf(player);
      if (stage < STAGE_FULLORE_KINGSTOWN || stage >= STAGE_JUDGE_DEAD) return null;
      return countAttribute(player, FUGGY_TOLD_ATTRIBUTE)
        ? "the-disgraced-councillor-s-escape-talking-to-fuggy-talking-to-fuggy-again"
        : "the-disgraced-councillor-s-escape-talking-to-fuggy";
    }
    if (HERBERT_IDS.has(npcId)) {
      const stage = stageOf(player);
      return stage >= STAGE_FUGGY && stage < STAGE_JUDGE_DEAD
        ? "the-disgraced-councillor-s-escape-talking-to-cabin-boy-herbert"
        : null;
    }
    if (ISTORIA_IDS.has(npcId)) {
      const stage = stageOf(player);
      return stage >= STAGE_ARCHIVE && stage < STAGE_HOUSES
        ? "kourend-s-last-princess-talking-to-istoria"
        : null;
    }
    if (ORSON_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_BASEMENT || stage >= STAGE_HOUSES) return null;
      return stage >= STAGE_ORSON
        ? "kourend-s-last-princess-the-sleeping-princess-talking-to-councillor-orson"
        : "kourend-s-last-princess-the-sleeping-princess";
    }
    if (KAHT_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_ORSON || stage >= STAGE_XAMPHUR) return null;
      if (held(player, LIZARDMAN_EGG_ITEM_ID)) {
        return "the-mysterious-mage-talking-to-kaht-b-alam-with-his-egg";
      }
      return countAttribute(player, KAHT_ASKED_ATTRIBUTE)
        ? "the-mysterious-mage-talking-to-kaht-b-alam-talking-to-kaht-b-alam-again"
        : "the-mysterious-mage-talking-to-kaht-b-alam";
    }
    if (DISCIPLE_OF_YAMA_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD && held(player, DARK_NULLIFIER_ITEM_ID)) {
        return "lady-piscarilius-favour-entering-the-chasm-of-fire";
      }
      return null;
    }
    if (MORI_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return null;
      if (held(player, DARK_NULLIFIER_ITEM_ID)) {
        return "lady-piscarilius-favour-talking-to-mori-talking-to-mori-again-after-obtaining-the-nullifier";
      }
      if (held(player, MOLTEN_GLASS_ITEM_ID) && held(player, DARK_ESSENCE_BLOCK_ITEM_ID)) {
        return "lady-piscarilius-favour-talking-to-mori-talking-to-mori-again-with-the-required-items";
      }
      if (helpedValue(player, "piscarilius") >= 1) {
        return "lady-piscarilius-favour-talking-to-mori-talking-to-mori-again-without-the-required-items";
      }
      return "lady-piscarilius-favour-talking-to-mori";
    }
    if (JORRA_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return null;
      return countAttribute(player, JORRA_DONE_ATTRIBUTE)
        ? "lady-lovakengj-s-favour-talking-to-jorra-talking-to-jorra-again-after-defeating-the-assassin"
        : "lady-lovakengj-s-favour-talking-to-jorra";
    }
    if (PHILEAS_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return null;
      return helpedValue(player, "hosidius") >= HELPED_TASK_STARTED.hosidius + 2
        ? "lord-hosidius-favour-talking-to-phileas-rimor-talking-to-phileas-rimor-again"
        : "lord-hosidius-favour-talking-to-phileas-rimor";
    }
    if (LORD_TROBIN_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_HOUSES && stage < STAGE_LOOKOUT) {
        return "the-houses-of-kourend-talking-to-lord-trobin-arceuus";
      }
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        const helped = helpedValue(player, "arceuus");
        if (helped >= HELPED_DONE) {
          return "lord-arceuus-favour-talking-to-lord-arceuus-talking-to-lord-arceuus-again";
        }
        if (helped >= HELPED_TASK_STARTED.arceuus + 3) {
          return "lord-arceuus-favour-talking-to-lord-arceuus";
        }
        if (helped >= HELPED_TASK_STARTED.arceuus) {
          return "convincing-the-five-houses-talking-to-lord-arceuus-talking-to-lord-arceuus-again";
        }
        return "convincing-the-five-houses-talking-to-lord-arceuus";
      }
      return null;
    }
    if (LORD_KANDUR_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_HOUSES && stage < STAGE_LOOKOUT) {
        return "the-houses-of-kourend-talking-to-lord-kandur-hosidius";
      }
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        const helped = helpedValue(player, "hosidius");
        if (helped >= HELPED_DONE) {
          return "lord-hosidius-favour-talking-to-lord-hosidius-talking-to-lord-hosidius-again";
        }
        if (helped >= HELPED_TASK_STARTED.hosidius + 1) {
          return "lord-hosidius-favour-talking-to-lord-hosidius";
        }
        if (helped >= HELPED_TASK_STARTED.hosidius) {
          return "convincing-the-five-houses-talking-to-lord-hosidius-talking-to-lord-hosidius-again";
        }
        return "convincing-the-five-houses-talking-to-lord-hosidius";
      }
      if (stage >= STAGE_ACCORD && stage < STAGE_ARREST) {
        return "the-new-royal-accord-talking-to-lord-hosidius";
      }
      if (stage >= STAGE_ARREST && stage < STAGE_COMPLETE) {
        return "the-new-royal-accord-talking-to-lord-hosidius-talking-to-lord-hosidius-again";
      }
      return null;
    }
    if (LADY_VULCANA_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_HOUSES && stage < STAGE_LOOKOUT) {
        return "the-houses-of-kourend-talking-to-lady-vulcana-lovakengj";
      }
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        const helped = helpedValue(player, "lovakengj");
        if (helped >= HELPED_DONE) {
          return "lady-lovakengj-s-favour-talking-to-lady-lovakengj-talking-to-lady-lovakengj-again";
        }
        if (helped >= HELPED_TASK_STARTED.lovakengj + 1) {
          return "lady-lovakengj-s-favour-talking-to-lady-lovakengj";
        }
        if (helped >= HELPED_TASK_STARTED.lovakengj - 1) {
          return "convincing-the-five-houses-talking-to-lady-lovakengj-talking-to-lady-lovakengj-again";
        }
        return "convincing-the-five-houses-talking-to-lady-lovakengj";
      }
      return null;
    }
    if (LADY_SHAUNA_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_HOUSES && stage < STAGE_LOOKOUT) {
        return "the-houses-of-kourend-talking-to-lady-shauna-piscarilius";
      }
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        const helped = helpedValue(player, "piscarilius");
        if (helped >= HELPED_DONE) {
          return "lady-piscarilius-favour-talking-to-lady-piscarilius-talking-to-lady-piscarilius-again";
        }
        if (helped >= HELPED_TASK_STARTED.piscarilius + 1) {
          return "lady-piscarilius-favour-talking-to-lady-piscarilius";
        }
        if (helped >= HELPED_TASK_STARTED.piscarilius) {
          return "convincing-the-five-houses-talking-to-lady-piscarilius-talking-to-lady-piscarilius-again";
        }
        return "convincing-the-five-houses-talking-to-lady-piscarilius";
      }
      return null;
    }
    if (LORD_SHIRO_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage >= STAGE_HOUSES && stage < STAGE_LOOKOUT) {
        return "the-houses-of-kourend-talking-to-lord-shiro-shayzien";
      }
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        const helped = helpedValue(player, "shayzien");
        if (helped >= HELPED_DONE) {
          return "lord-shayzien-s-favour-talking-to-lord-shayzien-talking-to-lord-shayzien-again";
        }
        if (held(player, SHAYZIEN_JOURNAL_ITEM_ID)) {
          return "lord-shayzien-s-favour-talking-to-lord-shayzien";
        }
        if (helped >= HELPED_TASK_STARTED.shayzien) {
          return "convincing-the-five-houses-talking-to-lord-shayzien-talking-to-lord-shayzien-again";
        }
        return "convincing-the-five-houses-talking-to-lord-shayzien";
      }
      return null;
    }
    if (TASAKAAL_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return null;
      const helped = helpedValue(player, "arceuus");
      if (held(player, SULPHUR_POTION_ITEM_ID)) {
        return "lord-arceuus-favour-speaking-to-the-tasaskaal-after-making-the-potion";
      }
      if (helped >= HELPED_TASK_STARTED.arceuus + 2 && !held(player, SHIELDING_POTION_ITEM_ID)) {
        return "lord-arceuus-favour-speaking-to-the-tasaskaal-after-making-the-potion-speaking-to-the-tasaskaal-if-the-potion-is-lost";
      }
      if (helped <= HELPED_TASK_STARTED.arceuus) {
        return "lord-arceuus-favour-speaking-to-the-tasakaal";
      }
      return "lord-arceuus-favour-speaking-to-the-tasakaal-speaking-to-the-tasaskaal-again";
    }
    if (ASTEROS_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_COMPLETE) return null;
      return {
        page: ASTEROS_PAGE,
        variant: countAttribute(player, ASTEROS_MET_ATTRIBUTE)
          ? "standard-dialogue-after-completing-a-kingdom-divided-subsequent-times"
          : "standard-dialogue-after-completing-a-kingdom-divided-first-time",
      };
    }
    return null;
  }

  /** Answers the wiki prose conditions on the pages this quest drives. */
  function answerCondition({ player, stepId }) {
    if (stepId === NO_REQUIREMENTS_STEP_ID) return !meetsRequirements(player);
    if (stepId === HAS_REQUIREMENTS_STEP_ID) return meetsRequirements(player);
    if (MEMOIR_USED_STEP_IDS.has(stepId)) {
      return !held(player, ItemIdentifiers.A_DARK_DISPOSITION);
    }
    if (MEMOIR_UNUSED_STEP_IDS.has(stepId)) {
      return held(player, ItemIdentifiers.A_DARK_DISPOSITION);
    }
    if (stepId === MORI_NO_MATERIALS_STEP_ID) {
      return !(held(player, MOLTEN_GLASS_ITEM_ID) && held(player, DARK_ESSENCE_BLOCK_ITEM_ID));
    }
    if (stepId === MORI_HAS_MATERIALS_STEP_ID) {
      return held(player, MOLTEN_GLASS_ITEM_ID) && held(player, DARK_ESSENCE_BLOCK_ITEM_ID);
    }
    // Asteros' "lost A Dark Disposition" branch.
    if (stepId === "ozExts") return !held(player, ItemIdentifiers.A_DARK_DISPOSITION);
    // Fuggy's standard chat asks how far along the Kourend quest chain the player is.
    if (stepId === "AmPebY") return !questStarted(player, "client_of_kourend");
    if (stepId === "9d4A3N") return !questStarted(player, "the_queen_of_thieves");
    if (stepId === "yg-nvl") return !questStarted(player, "the_depths_of_despair");
    if (stepId === "7C7nBW") return !questStarted(player, "tale_of_the_righteous");
    if (stepId === "oOLDA1") return !questStarted(player, "the_forsaken_tower");
    if (stepId === "5i_8x1") return !questStarted(player, "the_ascent_of_arceuus");
    if (stepId === "B9iIjK") return !questStarted(player, "a_kingdom_divided");
    if (stepId === "yydNAu") {
      return ["client_of_kourend", "the_queen_of_thieves", "the_depths_of_despair", "tale_of_the_righteous",
        "the_forsaken_tower", "the_ascent_of_arceuus"].every((key) => questComplete(player, key));
    }
    // Asteros' respawn conditions (two id sets for the same toggles).
    if (stepId === "IB9NlH" || stepId === "k0ZSJE") return respawnPoint(player) !== RESPAWN_KOUREND;
    if (stepId === "3vRQ9o" || stepId === "nzefy4") return respawnPoint(player) === RESPAWN_KOUREND;
    if (stepId === "pgLfyl") return respawnPoint(player) !== RESPAWN_KOUREND;
    if (stepId === "1jpzwD") return respawnPoint(player) === RESPAWN_KOUREND;
    return null;
  }

  // ==========================================================================
  // Transcript replay and the named talk router
  // ==========================================================================

  /**
   * The wiki dump leaves empty "unavailable" markers where a collapsible
   * template sat; the dialogue runtime stops at them, which would cut the
   * start/quest menus short. Strip the empty ones before playing.
   */
  function stripUnavailable(steps) {
    if (!Array.isArray(steps)) return steps;
    const out = [];
    for (const step of steps) {
      if (step.type === "unavailable" && !String(step.text ?? "").trim()) continue;
      const copy = { ...step };
      if (Array.isArray(step.steps)) copy.steps = stripUnavailable(step.steps);
      if (Array.isArray(step.options)) {
        copy.options = step.options.map((option) => ({ ...option, steps: stripUnavailable(option.steps) }));
      }
      out.push(copy);
    }
    return out;
  }

  /**
   * Resolves the prose conditions this quest owns inside the steps it plays, so
   * the branch the player meets never depends on cross-plugin condition hook
   * ordering. Asteros' respawn toggles are applied here as well.
   */
  const CONDITION_PREDICATES = new Map([
    ["TSrl_5", (p) => !meetsRequirements(p)],
    ["XbjdFE", (p) => meetsRequirements(p)],
    ["_Vitw1", (p) => !held(p, ItemIdentifiers.A_DARK_DISPOSITION)],
    ["7v1NB0", (p) => held(p, ItemIdentifiers.A_DARK_DISPOSITION)],
    ["UjYANw", (p) => !held(p, ItemIdentifiers.A_DARK_DISPOSITION)],
    ["xgb3ZY", (p) => held(p, ItemIdentifiers.A_DARK_DISPOSITION)],
    ["j5_KeL", (p) => held(p, MOLTEN_GLASS_ITEM_ID) && held(p, DARK_ESSENCE_BLOCK_ITEM_ID)],
    ["ljMJ1O", (p) => !(held(p, MOLTEN_GLASS_ITEM_ID) && held(p, DARK_ESSENCE_BLOCK_ITEM_ID))],
    ["ozExts", (p) => !held(p, ItemIdentifiers.A_DARK_DISPOSITION)],
    ["IB9NlH", (p) => respawnPoint(p) !== RESPAWN_KOUREND],
    ["3vRQ9o", (p) => respawnPoint(p) === RESPAWN_KOUREND],
    ["k0ZSJE", (p) => respawnPoint(p) !== RESPAWN_KOUREND],
    ["nzefy4", (p) => respawnPoint(p) === RESPAWN_KOUREND],
    ["pgLfyl", (p) => respawnPoint(p) !== RESPAWN_KOUREND],
    ["1jpzwD", (p) => respawnPoint(p) === RESPAWN_KOUREND],
  ]);

  function inlineConditions(player, steps) {
    if (!Array.isArray(steps)) return steps;
    const out = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type !== "condition") {
        const copy = { ...step };
        if (Array.isArray(step.steps)) copy.steps = inlineConditions(player, step.steps);
        if (Array.isArray(step.options)) {
          copy.options = step.options.map((option) => ({ ...option, steps: inlineConditions(player, option.steps) }));
        }
        out.push(copy);
        continue;
      }
      const run = [step];
      while (steps[i + 1]?.type === "condition") {
        run.push(steps[++i]);
      }
      // Mirror the runtime: the first true condition wins, else the first
      // condition this plugin cannot answer (its branch plays unchanged).
      const predicates = run.map((condition) => CONDITION_PREDICATES.get(condition.id) ?? null);
      let chosen = run[predicates.findIndex((predicate) => predicate && predicate(player))];
      if (!chosen) {
        const unknown = predicates.findIndex((predicate) => !predicate);
        if (unknown < 0) continue;
        chosen = run[unknown];
      }
      if (chosen.id === "pgLfyl") player.setAttribute(RESPAWN_ATTRIBUTE, RESPAWN_KOUREND);
      if (chosen.id === "1jpzwD") player.setAttribute(RESPAWN_ATTRIBUTE, "");
      out.push(...inlineConditions(player, chosen.steps || []));
    }
    return out;
  }

  function play(player, npcId, variant, page = PAGE) {
    if (!variant) return false;
    const request = {
      player,
      npc: null,
      npcId,
      page,
      variant,
      handled: false,
      select: (steps) => inlineConditions(player, stripUnavailable(steps)),
    };
    api.emitCustomEvent("npc-dialogue:start", request);
    if (request.handled === true) return true;
    // Spawn ids the dialogue index does not know (and variants it cannot resolve)
    // still play: look the page up directly, as QuestRuntime.startTranscript does.
    try {
      return startTranscript(api, player, npcId, page, variant,
        (steps) => inlineConditions(player, stripUnavailable(steps)));
    } catch {
      return false;
    }
  }

  function playPage(player, npcId, page, variant) {
    return play(player, npcId, variant, page);
  }

  function isStoryNpc(npcId) {
    return (
      MARTIN_STORY_IDS.has(npcId) || FULLORE_STORY_IDS.has(npcId) || TOMAS_IDS.has(npcId) ||
      npcId === FUGGY_ID || HERBERT_IDS.has(npcId) || npcId === ARCHEIO_ID ||
      ISTORIA_IDS.has(npcId) || ORSON_IDS.has(npcId) || KAHT_IDS.has(npcId) ||
      DISCIPLE_OF_YAMA_IDS.has(npcId) || MORI_IDS.has(npcId) || JORRA_IDS.has(npcId) ||
      PHILEAS_IDS.has(npcId) || LORD_TROBIN_IDS.has(npcId) || LORD_KANDUR_IDS.has(npcId) ||
      LADY_VULCANA_IDS.has(npcId) || LADY_SHAUNA_IDS.has(npcId) || LORD_SHIRO_IDS.has(npcId) ||
      ASTEROS_IDS.has(npcId)
    );
  }

  /**
   * The world-spawned post-quest NPCs use ids the dialogue index does not know,
   * so the story conversations (and the houses/favours) are routed here; the
   * indexed story ids fall through to NpcDialogues + selectVariant.
   */
  function handleTalk(event) {
    const { player, npcId } = event;
    if (!player || typeof player.getAttribute !== "function") return false;
    if (event.clickType !== undefined && event.clickType !== 1) return false;
    if (!isStoryNpc(npcId)) return false;
    const stage = stageOf(player);

    if (MARTIN_STORY_IDS.has(npcId)) {
      const variant = martinVariant(player);
      if (!variant) return false;
      if (stage === STAGE_SETTLEMENT) {
        quest.setStage(player, STAGE_ASSASSIN);
        spawnAssassin(player, ASSASSIN_SETTLEMENT_ID, 1541, 3893);
        player.sendMessage("An assassin bursts from the ruins!");
      } else if (stage === STAGE_ASSASSIN_DEAD) {
        quest.setStage(player, STAGE_ICE);
        player.sendMessage("The ice chunks south-west of Martin look suspicious. Melt them with a fire spell.");
      }
      event.handled = true;
      play(player, NpcIdentifiers.MARTIN_HOLT, variant);
      return true;
    }

    if (FULLORE_STORY_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        event.handled = true;
        handleFullorePostQuest(player, npcId);
        return true;
      }
      const variant = fulloreVariant(player, npcId);
      if (!variant) return false;
      event.handled = true;
      play(player, NpcIdentifiers.COMMANDER_FULLORE, variant);
      return true;
    }

    if (ASTEROS_IDS.has(npcId)) {
      if (stage < STAGE_COMPLETE) return false;
      event.handled = true;
      const first = !countAttribute(player, ASTEROS_MET_ATTRIBUTE);
      playPage(player, NpcIdentifiers.ASTEROS_ARCEUUS, ASTEROS_PAGE,
        first ? "standard-dialogue-after-completing-a-kingdom-divided-first-time"
          : "standard-dialogue-after-completing-a-kingdom-divided-subsequent-times");
      player.setAttribute(ASTEROS_MET_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(12304, 1);
      return true;
    }

    if (TOMAS_IDS.has(npcId)) {
      if (stage !== STAGE_HOUSE) return false;
      event.handled = true;
      play(player, 10928, "the-disgraced-councillor-s-escape-talking-to-tomas-lawry");
      return true;
    }

    if (npcId === FUGGY_ID) {
      if (stage < STAGE_FULLORE_KINGSTOWN || stage >= STAGE_JUDGE_DEAD) return false;
      event.handled = true;
      play(player, FUGGY_ID, selectVariant({ npcId, player }));
      return true;
    }

    if (HERBERT_IDS.has(npcId)) {
      if (stage < STAGE_FUGGY || stage >= STAGE_JUDGE_DEAD) return false;
      event.handled = true;
      play(player, 10934, "the-disgraced-councillor-s-escape-talking-to-cabin-boy-herbert");
      return true;
    }

    if (npcId === ARCHEIO_ID) return false;

    if (ISTORIA_IDS.has(npcId)) return false;

    if (ORSON_IDS.has(npcId)) {
      if (stage < STAGE_BASEMENT || stage >= STAGE_HOUSES) return false;
      event.handled = true;
      play(player, 10943, selectVariant({ npcId: 10943, player }));
      return true;
    }

    if (KAHT_IDS.has(npcId)) {
      if (stage < STAGE_ORSON || stage >= STAGE_XAMPHUR) return false;
      event.handled = true;
      play(player, KAHT_ID, selectVariant({ npcId: KAHT_ID, player }));
      return true;
    }

    if (DISCIPLE_OF_YAMA_IDS.has(npcId)) {
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return false;
      if (!held(player, DARK_NULLIFIER_ITEM_ID)) return false;
      event.handled = true;
      play(player, 7669, "lady-piscarilius-favour-entering-the-chasm-of-fire");
      return true;
    }

    if (MORI_IDS.has(npcId)) {
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return false;
      if (!recruited(player, "piscarilius")) return false;
      event.handled = true;
      play(player, NpcIdentifiers.MORI, selectVariant({ npcId: NpcIdentifiers.MORI, player }));
      return true;
    }

    if (JORRA_IDS.has(npcId)) {
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return false;
      if (!countAttribute(player, JORRA_TASK_ATTRIBUTE) && helpedValue(player, "lovakengj") < HELPED_TASK_STARTED.lovakengj) {
        event.handled = true;
        player.sendMessage("You have no reason to talk to Jorra yet.");
        return true;
      }
      event.handled = true;
      play(player, 11037, selectVariant({ npcId: 11037, player }));
      return true;
    }

    if (PHILEAS_IDS.has(npcId)) {
      if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return false;
      if (helpedValue(player, "hosidius") < HELPED_TASK_STARTED.hosidius) return false;
      event.handled = true;
      play(player, NpcIdentifiers.PHILEAS_RIMOR, selectVariant({ npcId: 7999, player }));
      return true;
    }

    if (LORD_TROBIN_IDS.has(npcId) || LORD_KANDUR_IDS.has(npcId) || LADY_VULCANA_IDS.has(npcId) ||
      LADY_SHAUNA_IDS.has(npcId) || LORD_SHIRO_IDS.has(npcId)) {
      const variant = selectVariant({ npcId, player });
      if (!variant) return false;
      event.handled = true;
      play(player, npcId, variant);
      return true;
    }
    return false;
  }

  /** Post-quest Fullore: the Book of the Dead and the two antique lamps. */
  function handleFullorePostQuest(player, npcId) {
    playPage(player, npcId, FULLORE_PAGE, "standard-dialogue-after-completing-a-kingdom-divided");
    if (!held(player, BOOK_OF_THE_DEAD_ITEM_ID)) {
      give(player, BOOK_OF_THE_DEAD_ITEM_ID, 1, "Lydia gives you the Book of the Dead.");
    }
    // Lamps can be destroyed and reclaimed until they have been rubbed (wiki), so
    // the claim count is rubbed lamps plus any still carried.
    let claimed = countAttribute(player, LAMPS_ATTRIBUTE) + player.getInventory().getAmount(ANTIQUE_LAMP_ITEM_ID);
    while (claimed < LAMP_CLAIMS) {
      if (!give(player, ANTIQUE_LAMP_ITEM_ID, 1)) break;
      claimed++;
      player.sendMessage(claimed === 1
        ? "Lydia gives you an antique lamp. Rub it to claim 10,000 experience in a skill level 40 or above."
        : "Lydia gives you a second antique lamp.");
    }
  }

  // ==========================================================================
  // Dialogue events: chosen conditions, choices, lines and actions
  // ==========================================================================

  function handleConditionChosen(event) {
    const { player, stepId } = event;
    if (!player || typeof player.setAttribute !== "function") return;
    // Asteros' respawn toggle (the chosen branch tells us the new point).
    if (stepId === "pgLfyl") player.setAttribute(RESPAWN_ATTRIBUTE, RESPAWN_KOUREND);
    if (stepId === "1jpzwD") player.setAttribute(RESPAWN_ATTRIBUTE, "");
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    const stage = stageOf(player);
    if (MARTIN_STORY_IDS.has(npcId) && option === "Yes." && stage <= 0 && meetsRequirements(player)) {
      quest.setStage(player, STAGE_STARTED);
      player.sendMessage("You agree to help Martin Holt investigate the disappearance of Councillor Hughes.");
      return;
    }
    if (FULLORE_STORY_IDS.has(npcId) && option === "Let's get going." && stage < STAGE_HOUSE) {
      player.moveTo(new Location(HUGHES_HOUSE_TILE.x, HUGHES_HOUSE_TILE.y, HUGHES_HOUSE_TILE.z));
      quest.setStage(player, STAGE_HOUSE);
      player.sendMessage("Commander Fullore leads you to Councillor Hughes' house.");
      return;
    }
    if (npcId === FUGGY_ID && /Ship|ship|which/i.test(String(option))) {
      player.setAttribute(FUGGY_TOLD_ATTRIBUTE, 1);
      if (stage < STAGE_FUGGY) quest.setStage(player, STAGE_FUGGY);
      return;
    }
    if (HERBERT_IDS.has(npcId) && /looking for a councillor/i.test(String(option))) {
      player.setAttribute(HERBERT_ASKED_ATTRIBUTE, 1);
      return;
    }
    if (MARTIN_STORY_IDS.has(npcId)) {
      if (/Alright\. I'll see you soon\./i.test(String(option))) {
        if (stage >= STAGE_FORTHOS_NOTE && stage < STAGE_SETTLEMENT &&
          countAttribute(player, FORTHOS_NOTE_ATTRIBUTE)) {
          quest.setStage(player, STAGE_SETTLEMENT);
          player.sendMessage("Meet Martin at the Settlement Ruins, south-west of Wintertodt.");
        } else if (stage >= STAGE_ASSASSIN_DEAD && stage < STAGE_FAUN &&
          countAttribute(player, SETTLEMENT_NOTE_ATTRIBUTE)) {
          quest.setStage(player, STAGE_FAUN);
          player.sendMessage("Meet Martin at The Legless Faun in southern Port Piscarilius.");
        }
        return;
      }
      // Leaving the Faun conversation starts the statue puzzle; the cache only
      // gives the pillar its Climb option from stage 70, so open that window here.
      if (/I'll have a look around/i.test(String(option)) && stage === STAGE_FAUN) {
        quest.setStage(player, STAGE_FAUN_PANEL);
        return;
      }
    }
    if (FULLORE_STORY_IDS.has(npcId) && stage >= STAGE_MEETING && stage < STAGE_ACCORD &&
      /help with Lady Lovakengj/i.test(String(option))) {
      setHelped(player, "lovakengj", HELPED_TASK_STARTED.lovakengj);
      player.sendMessage("Fullore suggests speaking to Martin Holt, imprisoned in Shayzien.");
      return;
    }
    if (JORRA_IDS.has(npcId) && /Evil only triumphs/i.test(String(option))) {
      player.setAttribute(JORRA_TASK_ATTRIBUTE, 1);
      setHelped(player, "lovakengj", HELPED_TASK_STARTED.lovakengj);
      spawnAssassin(player, ASSASSIN_SHAYZIEN_ID, 1496, 3554);
      player.sendMessage("You speak the passphrase. An assassin leaps from the shadows!");
      return;
    }
  }

  function handleLine(event) {
    const { player, npcId } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    let text = String(event.text ?? "");
    const stage = stageOf(player);
    if (text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(player.getUsername?.() ?? ""));
      event.text = text;
    }

    // Once the accord cutscene has sent the player to gather the five Houses,
    // their invite conversations mark each leader as on their way.
    if (stage >= STAGE_HOUSES && stage < STAGE_MEETING) {
      if (LORD_TROBIN_IDS.has(npcId) && text.includes("I will join you there soon")) {
        markRecruited(player, "arceuus");
        return;
      }
      if (LORD_KANDUR_IDS.has(npcId) && text.includes("I will depart for Xeric's Lookout shortly")) {
        markRecruited(player, "hosidius");
        return;
      }
      if (LADY_VULCANA_IDS.has(npcId) && text.includes("I will come at once, but first")) {
        markRecruited(player, "lovakengj");
        return;
      }
      if (LADY_SHAUNA_IDS.has(npcId) && text.includes("you will seriously regret it")) {
        markRecruited(player, "piscarilius");
        return;
      }
      if (LORD_SHIRO_IDS.has(npcId) && text.includes("I will depart soon")) {
        markRecruited(player, "shayzien");
        return;
      }
    }

    if (MARTIN_STORY_IDS.has(npcId)) {
      if (text.includes(MARTIN_SPLIT_TEXT) && stage >= STAGE_NOTE_READ && stage < STAGE_FORTHOS) {
        quest.setStage(player, STAGE_FORTHOS);
        player.sendMessage("You agree to meet Martin at the Forthos Ruins, north-east of the Woodcutting Guild.");
        return;
      }
      if (text.includes("Talk to Archeio in the Arceuus Library") && stage < STAGE_ARCHIVE) {
        quest.setStage(player, STAGE_ARCHIVE);
        return;
      }
      // Rose's notes end with a player line bidding Martin goodbye; that is the
      // transcript's marker to move on to the next meeting place.
      if (text.includes("I'll see you soon")) {
        if (stage >= STAGE_FORTHOS_NOTE && stage < STAGE_SETTLEMENT) {
          quest.setStage(player, STAGE_SETTLEMENT);
          player.sendMessage("Meet Martin at the Settlement Ruins, south-west of Wintertodt.");
          return;
        }
        if (stage >= STAGE_SETTLEMENT_DONE && stage < STAGE_FAUN) {
          quest.setStage(player, STAGE_FAUN);
          player.sendMessage("Meet Martin at The Legless Faun in southern Port Piscarilius.");
          return;
        }
      }
      if (text.includes("Evil only triumphs when the good do nothing") && stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        player.setAttribute(MARTIN_PRISON_ATTRIBUTE, 1);
        return;
      }
      if (text.includes(MARTIN_ARRESTS_TEXT) && stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        markRecruited(player, "hosidius");
        return;
      }
      return;
    }

    if (FULLORE_STORY_IDS.has(npcId)) {
      if (text.includes(FULLORE_DEED_LODE_TEXT) && stage < STAGE_FULLORE_KINGSTOWN) {
        quest.setStage(player, STAGE_FULLORE_KINGSTOWN);
        player.sendMessage("The Deeper Lode is the pub in Lovakengj, north-west of Kingstown.");
        return;
      }
      if (text.includes("Rose. If she's still alive, then she's the key to the truth.")) {
        advance(player, STAGE_FULLORE_OUTSIDE);
        return;
      }
      return;
    }

    if (npcId === FUGGY_ID && text.includes(FUGGY_SHIP_TEXT)) {
      player.setAttribute(FUGGY_TOLD_ATTRIBUTE, 1);
      if (stage < STAGE_FUGGY) {
        quest.setStage(player, STAGE_FUGGY);
        player.sendMessage("Sophia booked passage on Veos' ship in Port Piscarilius.");
      }
      return;
    }

    if (HERBERT_IDS.has(npcId) && text.includes(JUDGE_BEGIN_TEXT)) {
      if (stage < STAGE_JUDGE) {
        quest.setStage(player, STAGE_JUDGE);
        spawnJudge(player);
        player.sendMessage("The Judge of Yama attacks! It is immune to magic and ranged - use melee.");
      }
      return;
    }

    if (KAHT_IDS.has(npcId)) {
      if (text.includes("lassst egg") && stage < STAGE_EGG) {
        player.setAttribute(KAHT_ASKED_ATTRIBUTE, 1);
        quest.setStage(player, STAGE_EGG);
        player.sendMessage("Search the lizardman egg piles south-west of the temple, across the stone bridge.");
      }
      return;
    }

    if (MORI_IDS.has(npcId)) {
      if (text.includes("molten glass") && text.includes("dark essence block") && stage >= STAGE_MEETING) {
        if (held(player, MOLTEN_GLASS_ITEM_ID) && held(player, DARK_ESSENCE_BLOCK_ITEM_ID)) {
          take(player, MOLTEN_GLASS_ITEM_ID, 1);
          take(player, DARK_ESSENCE_BLOCK_ITEM_ID, 1);
          give(player, DARK_NULLIFIER_ITEM_ID, 1, "Mori gives you a dark nullifier. Plant it in the Chasm of Fire.");
          setHelped(player, "piscarilius", HELPED_TASK_STARTED.piscarilius);
        }
      }
      return;
    }

    if (LORD_TROBIN_IDS.has(npcId) && stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
      const helped = helpedValue(player, "arceuus");
      if (text.includes("the Tasakaal at Mount Karuulm") && helped < HELPED_TASK_STARTED.arceuus) {
        if (!held(player, BROKEN_REDIRECTOR_ITEM_ID)) give(player, BROKEN_REDIRECTOR_ITEM_ID, 1);
        setHelped(player, "arceuus", HELPED_TASK_STARTED.arceuus);
      } else if (text.includes("I will. While I have no desire to rule myself")) {
        setHelped(player, "arceuus", HELPED_DONE);
      }
      return;
    }

    if (LORD_KANDUR_IDS.has(npcId)) {
      if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
        const helped = helpedValue(player, "hosidius");
        if (text.includes("I can go and take a look around this camp") && helped < HELPED_TASK_STARTED.hosidius) {
          setHelped(player, "hosidius", HELPED_TASK_STARTED.hosidius);
        } else if (text.includes("King Shayzien VII's journal") && helped >= HELPED_TASK_STARTED.hosidius + 1) {
          setHelped(player, "hosidius", HELPED_DONE);
        }
        return;
      }
      if (stage >= STAGE_ACCORD && stage < STAGE_ARREST) {
        if (text.includes("You should speak with Commander Fullore")) {
          player.setAttribute(KANDUR_ACCORD_ATTRIBUTE, 1);
        }
        return;
      }
      return;
    }

    if (LADY_VULCANA_IDS.has(npcId) && stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
      if (text.includes("Let me chat to Commander Fullore about this") &&
        helpedValue(player, "lovakengj") < HELPED_TASK_STARTED.lovakengj - 1) {
        setHelped(player, "lovakengj", HELPED_TASK_STARTED.lovakengj - 1);
      } else if (text.includes("sign the accord")) {
        setHelped(player, "lovakengj", HELPED_DONE);
        player.sendMessage("Lady Lovakengj agrees to sign the new accord.");
      }
      return;
    }

    if (LADY_SHAUNA_IDS.has(npcId) && stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
      if (text.includes("Mori") && helpedValue(player, "piscarilius") < HELPED_TASK_STARTED.piscarilius) {
        markRecruited(player, "piscarilius");
      } else if (text.includes("still a stupid idea")) {
        setHelped(player, "piscarilius", HELPED_DONE);
      }
      return;
    }

    if (LORD_SHIRO_IDS.has(npcId) && stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
      if (text.includes("private office")) {
        setHelped(player, "shayzien", HELPED_TASK_STARTED.shayzien);
        player.sendMessage("The journal is hidden in Lord Hosidius' private office at the Hosidius Vinery.");
      }
      return;
    }

    if (text.includes(ACCORD_NAMED_TEXT)) {
      advance(player, STAGE_ACCORD);
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    const stage = stageOf(player);
    switch (stepId) {
      case "8TtRNo": // Asteros replaces a lost A Dark Disposition
        if (!held(player, ItemIdentifiers.A_DARK_DISPOSITION)) {
          give(player, ItemIdentifiers.A_DARK_DISPOSITION, 1, "Asteros gives you a replacement page.");
        }
        return;
      case "NJKmeD": // Tomas departs for Mount Quidamortem
        player.getPacketSender().sendVarbit(VARBIT_TOMAS_LIE, 1);
        player.sendMessage("Tomas sets off for Mount Quidamortem, none the wiser.");
        return;
      case "m0I43E": // You give Rose's diary to Martin
        take(player, ROSES_DIARY_ITEM_ID, 1);
        return;
      case "b__Eq6": { // Martin gives you the note
        event.handled = true;
        quest.setStage(player, STAGE_NOTE);
        if (!held(player, ROSE_NOTE_ITEM_IDS[0])) {
          giveNote(player, 0, "Martin gives you a note he found hidden in the diary's cover.");
        }
        return;
      }
      case "l6apnj": // Martin is taken away; the arrest cutscene ends
        quest.setStage(player, STAGE_SHACK);
        player.sendMessage("Martin is arrested by Tomas Lawry. Read the note - it points to a shack west of fairy ring CIR.");
        return;
      case "I2Qmi5": // the basement cutscene ends
        quest.setStage(player, STAGE_ORSON);
        player.sendMessage("You leave Orson and Rose. Head to the Lizardman Temple in Molch.");
        return;
      case "fJgRkX": // You give the egg to Kaht B'alam
        take(player, LIZARDMAN_EGG_ITEM_ID, 1);
        return;
      case "q_znuf": // Kaht B'alam gives you a key
        event.handled = true;
        if (give(player, DAMP_KEY_ITEM_ID, 1, "Kaht B'alam gives you a damp key.")) {
          quest.setStage(player, STAGE_KEY);
        }
        return;
      case "ffoI7M": // the lab table note
        if (!held(player, RESEARCH_NOTES_ITEM_ID)) {
          give(player, RESEARCH_NOTES_ITEM_ID, 1, "You take a research note from the table.");
        }
        return;
      case "WVk15p": // funeral cutscene begins
        player.setAttribute(FUNERAL_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(VARBIT_FUNERAL, 1);
        quest.setStage(player, STAGE_HOUSES);
        player.sendMessage("You and Fullore bury Rose. Gather the five House leaders and send them to Xeric's Lookout.");
        return;
      case "NNKsTw": // the leaders gather at the lookout
        quest.setStage(player, STAGE_MEETING);
        player.sendMessage("The five leaders have gathered. Speak to each of them at the lookout.");
        return;
      case "k3QL50": // Orson found dead outside the lookout
        advance(player, STAGE_ACCORD);
        return;
      case "1V4vkQ": // the leaders arrive at Kourend Castle to arrest the Council
        if (stage >= STAGE_ACCORD) quest.setStage(player, STAGE_ARREST);
        return;
      case "C4IzdV": // the council arrest cutscene ends
        if (stage >= STAGE_ARREST) quest.setStage(player, STAGE_CORONATION);
        return;
      case "ba1Q60": // Congratulations! Quest complete!
        event.handled = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "UrYt0S": // Jorra gives you a declaration
        event.handled = true;
        if (give(player, DECLARATION_ITEM_ID, 1, "Jorra gives you a declaration from the Kourend Council.")) {
          player.setAttribute(JORRA_DONE_ATTRIBUTE, 1);
          setHelped(player, "lovakengj", HELPED_TASK_STARTED.lovakengj + 1);
          player.sendMessage("Read the declaration, then show it to Lady Lovakengj.");
        }
        return;
      case "imB3VC": // You show the declaration to Lady Lovakengj
        take(player, DECLARATION_ITEM_ID, 1);
        setHelped(player, "lovakengj", HELPED_DONE);
        return;
      case "oVzVj1": // You show the journal to Lord Shayzien
        if (take(player, SHAYZIEN_JOURNAL_ITEM_ID, 1)) {
          setHelped(player, "shayzien", HELPED_DONE);
        }
        return;
      case "nZUFpX": // the Tasakaal inspect the broken redirector
        setHelped(player, "arceuus", HELPED_TASK_STARTED.arceuus + 1);
        player.sendMessage("Use volcanic sulphur on a defence potion ((3) or (4)), then speak to the Tasakaal again.");
        return;
      case "FiTFVv": // the Tasakaal enchant the potion
        if (take(player, SULPHUR_POTION_ITEM_ID, 1)) {
          give(player, SHIELDING_POTION_ITEM_ID, 1, "The Tasakaal enchant your potion into a shielding potion.");
        }
        setHelped(player, "arceuus", HELPED_TASK_STARTED.arceuus + 2);
        player.sendMessage("Pour the shielding potion on the Doors of Dinh at the Wintertodt Camp.");
        return;
      case "Tro_e8": // the potion was lost: the Tasakaal replace it
        if (!held(player, SHIELDING_POTION_ITEM_ID)) {
          give(player, SHIELDING_POTION_ITEM_ID, 1, "The Tasakaal replace your lost shielding potion.");
        }
        setHelped(player, "arceuus", HELPED_TASK_STARTED.arceuus + 2);
        return;
      case "0nbQ54": // Lord Arceuus shows you the broken device
      case "D_G41B": // Lord Arceuus gives you the broken device
        if (!held(player, BROKEN_REDIRECTOR_ITEM_ID)) give(player, BROKEN_REDIRECTOR_ITEM_ID, 1);
        setHelped(player, "arceuus", HELPED_TASK_STARTED.arceuus);
        return;
      case "plj3LC":
      case "K21EBD": // You give Mori the materials
        take(player, MOLTEN_GLASS_ITEM_ID, 1);
        take(player, DARK_ESSENCE_BLOCK_ITEM_ID, 1);
        return;
      case "Ixqm1f":
      case "gDPQYV":
      case "pbYYih": // Mori gives you a Dark Nullifier
        if (!held(player, DARK_NULLIFIER_ITEM_ID)) give(player, DARK_NULLIFIER_ITEM_ID, 1);
        setHelped(player, "piscarilius", HELPED_TASK_STARTED.piscarilius);
        return;
      case "4SJtB9": // transcript message text is the wipe narration
      case "zpY26z":
        return;
      case "bTpKUc":
        return;
      case "jmDwK4": // you wake in the forest, believing the nullifier planted
        event.handled = true;
        take(player, DARK_NULLIFIER_ITEM_ID, 1);
        setHelped(player, "piscarilius", HELPED_TASK_STARTED.piscarilius + 1);
        player.moveTo(new Location(CHASM_FOREST_TILE.x, CHASM_FOREST_TILE.y, CHASM_FOREST_TILE.z));
        player.sendMessage("You wake up in the forest south of the chasm, believing the nullifier was planted.");
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // NPC spawns, fights and deaths
  // ==========================================================================

  function tracked(player) {
    let map = trackedNpcs.get(player);
    if (!map) {
      map = new Map();
      trackedNpcs.set(player, map);
    }
    return map;
  }

  function ensureNpc(player, key, definition) {
    const map = tracked(player);
    const existing = map.get(key);
    if (existing && existing.isDead?.() !== true) return existing;
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) map.set(key, npc);
    return npc;
  }

  function removeNpc(player, key) {
    const map = trackedNpcs.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  function clearNpcs(player) {
    const map = trackedNpcs.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  function worldHasNpcIdNear(id, x, y, z, radius) {
    const npcs = api.getWorld()?.getNpcs?.();
    if (!npcs) return false;
    for (const npc of npcs) {
      if (npc?.getId?.() !== id) continue;
      const location = npc.getLocation?.();
      if (!location) return true;
      if (Math.abs(location.getX() - x) <= radius && Math.abs(location.getY() - y) <= radius &&
        (location.getZ?.() ?? 0) === z) {
        return true;
      }
    }
    return false;
  }

  function spawnJudge(player) {
    const location = player.getLocation();
    ensureNpc(player, "judge", {
      id: JUDGE_OF_YAMA_NPC_ID,
      x: Math.max(0, location.getX() - 1),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
    });
  }

  function spawnAssassin(player, id, x, y) {
    ensureNpc(player, id === ASSASSIN_SHAYZIEN_ID ? "assassin-shayzien" : "assassin-settlement",
      { id, x, y, z: 0, wanderRadius: 0 });
  }

  // Most story NPCs are already placed by the world with the cache's 12296
  // transform tables (see the stage map above), so the server resolves the
  // right NPC id/variant per player and no owner-only clone is needed. The one
  // exception is Lord Hosidius in the lookout basement after the accord, where
  // the transform goes null at 145; he is spawned while the endgame plays.
  const STORY_SPAWNS = [
    { key: "kandur-basement", id: NpcIdentifiers.LORD_KANDUR_HOSIDIUS_3, ...KANDUR_BASEMENT_TILE, from: STAGE_ARREST, to: STAGE_COMPLETE },
  ];

  function syncStoryNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = stageOf(player);
    for (const spawn of STORY_SPAWNS) {
      const inStage = stage >= spawn.from && stage < spawn.to;
      const gated = typeof spawn.gate === "function" ? spawn.gate(player) : true;
      if (inStage && gated) {
        const map = tracked(player);
        const avoid = Array.isArray(spawn.avoidIds) ? spawn.avoidIds : [spawn.id];
        const alreadyNear = avoid.some((id) => worldHasNpcIdNear(id, spawn.x, spawn.y, spawn.z ?? 0, 12));
        if (!map.has(spawn.key) && !alreadyNear) {
          ensureNpc(player, spawn.key, { id: spawn.id, x: spawn.x, y: spawn.y, z: spawn.z ?? 0, wanderRadius: 0 });
        }
      } else {
        removeNpc(player, spawn.key);
      }
    }
    if (stage === STAGE_JUDGE) {
      // Re-entry after a death/relog: the portal and a fresh login must both
      // still leave a Judge to fight.
      spawnJudge(player);
    } else {
      removeNpc(player, "judge");
    }
    if (stage === STAGE_XAMPHUR) {
      // Likewise for Xamphur's lair: re-entering the door or relogging inside
      // must leave the fight resumable.
      ensureNpc(player, "xamphur", { id: XAMPHUR_ID, x: 3031, y: 5938, z: 0, wanderRadius: 0 });
    } else {
      removeNpc(player, "xamphur");
    }
    if (stage !== STAGE_MEETING && stage !== STAGE_ACCORD) removeNpc(player, "warlord");
  }

  /**
   * Cache NPC transforms read these standalone varbits, so they follow the
   * quest stage rather than the transcript: Tomas Lawry appears at the castle
   * for the house search, Lady Shauna is unmasked once the accord is being
   * built, and Orson is at the lookout for the meeting and favours.
   */
  function syncStageVarbits(player) {
    const stage = stageOf(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_TOMAS_LOCATION, stage === STAGE_HOUSE ? 2 : 0);
    sender.sendVarbit(VARBIT_QUEEN_VISIBLE, stage >= STAGE_HOUSES ? 1 : 0);
    sender.sendVarbit(VARBIT_ORSON_LOOKOUT, stage >= STAGE_MEETING && stage < STAGE_ACCORD ? 1 : 0);
  }

  function handleNpcDeath(event) {
    const killer = event.killer?.isPlayer?.() ? event.killer : null;
    if (!killer || typeof killer.getAttribute !== "function") return;
    const stage = stageOf(killer);
    switch (event.npcId) {
      case JUDGE_OF_YAMA_NPC_ID:
        removeNpc(killer, "judge");
        if (stage >= STAGE_JUDGE && stage < STAGE_JUDGE_DEAD) {
          quest.setStage(killer, STAGE_JUDGE_DEAD);
          killer.getPacketSender().sendVarbit(VARBIT_DEMON_FOUND, 1);
          killer.sendMessage("The Judge of Yama is defeated. Councillor Andrews will want to hear of this.");
          killer.moveTo(new Location(1634, 3684, 0));
        }
        return;
      case ASSASSIN_SETTLEMENT_ID:
        if (stage >= STAGE_ASSASSIN && stage < STAGE_ASSASSIN_DEAD) {
          removeNpc(killer, "assassin-settlement");
          quest.setStage(killer, STAGE_ASSASSIN_DEAD);
          killer.sendMessage("The assassin is dead. Search the melted ice chunks, then the panel.");
        }
        return;
      case ASSASSIN_SHAYZIEN_ID:
        if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
          removeNpc(killer, "assassin-shayzien");
          killer.setAttribute(JORRA_DONE_ATTRIBUTE, 1);
          killer.sendMessage("The assassin is dead. Speak to Jorra again.");
        }
        return;
      case XAMPHUR_ID:
        if (stage >= STAGE_XAMPHUR && stage < STAGE_TABLE) {
          removeNpc(killer, "xamphur");
          quest.setStage(killer, STAGE_TABLE);
          killer.sendMessage("Xamphur is defeated. Search the table in the north of the room.");
        }
        return;
      case BARBARIAN_WARLORD_ID:
        if (stage >= STAGE_MEETING && stage < STAGE_ACCORD) {
          removeNpc(killer, "warlord");
          setHelped(killer, "hosidius", HELPED_TASK_STARTED.hosidius + 1);
          killer.sendMessage("The Barbarian Warlord is dead. Speak to Phileas.");
        }
        return;
      case LIZARDMAN_BRUTE_QUEST_ID:
        removeNpc(killer, "egg-brute");
        killer.sendMessage("The lizardman brute is dead. Search the egg pile again.");
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function inZone(zone, tile) {
    return Boolean(tile) && tile.x >= zone.minX && tile.x <= zone.maxX &&
      tile.y >= zone.minY && tile.y <= zone.maxY &&
      (!zone.levels || zone.levels.includes(tile.z));
  }

  function searchHughesObject(player, objectId) {
    const stage = stageOf(player);
    if (stage !== STAGE_HOUSE) {
      player.sendMessage("You have no reason to search through this.");
      return;
    }
    const clue = HUGHES_OBJECTS.get(objectId);
    if (!clue) return;
    if (clueTaken(player, clue.slot)) {
      player.sendMessage("You have already searched this.");
      return;
    }
    markClue(player, clue.slot);
    if (clue.varbit !== undefined) player.getPacketSender().sendVarbit(clue.varbit, 1);
    if (clue.slot === HUGHES_DRAWERS_SLOT) {
      give(player, RECEIPT_ITEM_ID, 1, "You search the drawers and find a receipt. There is an order for a bed at The Deeper Lode.");
      player.sendMessage("Read the receipt, then tell Tomas Lawry what you found.");
      return;
    }
    if (clue.item) {
      give(player, clue.item, 1, `You search ${clue.name} and find something.`);
      return;
    }
    player.sendMessage(`You search ${clue.name} but find nothing useful.`);
  }

  function searchArchiveDisplay(player) {
    const stage = stageOf(player);
    if (stage < STAGE_ARCHIVE || stage >= STAGE_DIARY) {
      player.sendMessage("The display case is already empty.");
      return;
    }
    if (!held(player, BLUISH_KEY_ITEM_ID)) {
      player.sendMessage("The display case is locked. Istoria must have the key.");
      return;
    }
    take(player, BLUISH_KEY_ITEM_ID, 1);
    if (give(player, ROSES_DIARY_ITEM_ID, 1, "You unlock the display case and take Rose's diary.")) {
      quest.setStage(player, STAGE_DIARY);
      player.sendMessage("Take the diary to Martin Holt.");
    }
  }

  function cutForthosVines(player) {
    if (stageOf(player) < STAGE_FORTHOS || stageOf(player) >= STAGE_FORTHOS_NOTE) {
      player.sendMessage("You have no reason to cut these vines.");
      return;
    }
    if (countAttribute(player, VINES_ATTRIBUTE)) {
      player.sendMessage("The vines are already cut.");
      player.moveTo(new Location(1671, 3579, player.getLocation().getZ()));
      return;
    }
    player.setAttribute(VINES_ATTRIBUTE, 1);
    player.sendMessage("You cut through the vines and squeeze into the hidden room.");
    player.moveTo(new Location(1671, 3579, player.getLocation().getZ()));
  }

  function searchForthosPile(player, tile) {
    const stage = stageOf(player);
    if (stage < STAGE_FORTHOS || stage >= STAGE_FORTHOS_PANEL) {
      player.sendMessage("You search the stone pile but find nothing.");
      return;
    }
    const index = FORTHOS_STONE_TILES.findIndex((entry) => entry.x === tile.x && entry.y === tile.y);
    if (index < 0) return;
    if (bitAttribute(player, STONE_PILES_ATTRIBUTE, index)) {
      player.sendMessage("You have already read this stone pile.");
      return;
    }
    setBitAttribute(player, STONE_PILES_ATTRIBUTE, index);
    const letters = ["R", "O", "S", "E"];
    player.sendMessage(`The inscription reads: ${letters[index]} - ${1 + index}.`);
    if (countAttribute(player, STONE_PILES_ATTRIBUTE) === (1 << FORTHOS_STONE_TILES.length) - 1) {
      player.sendMessage("The word ROSE is clear now. Check the panel behind the vines.");
    }
  }

  function checkForthosPanel(player) {
    const stage = stageOf(player);
    if (stage < STAGE_FORTHOS || stage >= STAGE_FORTHOS_NOTE) {
      player.sendMessage("The panel is closed and silent.");
      return;
    }
    if (stage >= STAGE_FORTHOS_PANEL) {
      player.sendMessage("You have already taken the note.");
      return;
    }
    if (!countAttribute(player, VINES_ATTRIBUTE)) {
      player.sendMessage("The panel is behind the vines to the south.");
      return;
    }
    quest.setStage(player, STAGE_FORTHOS_PANEL);
    if (!held(player, ROSE_NOTE_ITEM_IDS[1])) {
      giveNote(player, 1, "You set the dials to ROSE. The panel opens and you take a note.");
    }
    player.sendMessage("Read the note, then talk to Martin.");
  }

  function searchSettlementPanel(player) {
    const stage = stageOf(player);
    if (stage < STAGE_SETTLEMENT || stage >= STAGE_FAUN) {
      player.sendMessage("The panel is sealed.");
      return;
    }
    if (stage >= STAGE_SETTLEMENT_PANEL) {
      if (!countAttribute(player, SETTLEMENT_NOTE_ATTRIBUTE) && !held(player, ROSE_NOTE_ITEM_IDS[2])) {
        giveNote(player, 2, "You take the note from the open panel.");
      } else {
        player.sendMessage("You have already taken the note.");
      }
      return;
    }
    if (!held(player, COLD_KEY_ITEM_ID)) {
      player.sendMessage("The panel needs a key. The ice chunks south-west of Martin look suspicious.");
      return;
    }
    take(player, COLD_KEY_ITEM_ID, 1);
    quest.setStage(player, STAGE_SETTLEMENT_PANEL);
    if (giveNote(player, 2, "You unlock the panel and find a note.")) {
      player.setAttribute(SETTLEMENT_NOTE_ATTRIBUTE, 1);
      player.sendMessage("Read the note, then talk to Martin.");
    }
  }

  function searchFaunPanel(player) {
    const stage = stageOf(player);
    if (stage < STAGE_FAUN || stage >= STAGE_FAUN_NOTE) {
      player.sendMessage("The panel is closed.");
      return;
    }
    // The pillar only gains its Climb option from stage 70 (cache transform), so
    // the order is read on the first check at any Faun stage and from then the
    // player can climb up to it.
    if (!countAttribute(player, FAUN_ORDER_ATTRIBUTE)) {
      player.setAttribute(FAUN_ORDER_ATTRIBUTE, 1);
      if (stage < STAGE_FAUN_PANEL) quest.setStage(player, STAGE_FAUN_PANEL);
      player.sendMessage("The panel names the cities in order: Lovakengj, Arceuus, Shayzien, Hosidius, Piscarilius. Press the matching statues below.");
      return;
    }
    if (countAttribute(player, STATUES_ATTRIBUTE) < 5) {
      player.sendMessage("You must press the five statues in the order shown first.");
      return;
    }
    if (!held(player, ROSE_NOTE_ITEM_IDS[3])) {
      giveNote(player, 3, "Something clicks. You climb back up and take the final note from the panel.");
    }
    quest.setStage(player, STAGE_FAUN_NOTE);
    play(player, 10890, "kourend-s-last-princess-martin-s-arrest");
  }

  function pressFaunStatue(player, objectId) {
    const stage = stageOf(player);
    if (stage < STAGE_FAUN_PANEL || stage >= STAGE_FAUN_NOTE) {
      player.sendMessage("The statue is fixed in place.");
      return;
    }
    const pressed = countAttribute(player, STATUES_ATTRIBUTE);
    if (pressed >= 5) {
      player.sendMessage("You have already pressed all five statues.");
      return;
    }
    if (PISCARILIUS_STATUE_IDS[pressed] !== objectId) {
      player.setAttribute(STATUES_ATTRIBUTE, objectId === PISCARILIUS_STATUE_IDS[0] ? 1 : 0);
      player.sendMessage(objectId === PISCARILIUS_STATUE_IDS[0]
        ? "The first statue sinks with a click. (1/5)"
        : "The statue doesn't move. The panel named the cities in a specific order.");
      return;
    }
    player.setAttribute(STATUES_ATTRIBUTE, pressed + 1);
    player.sendMessage(pressed + 1 >= 5
      ? "The fifth statue sinks with a click. Climb up and check the panel again."
      : `The statue sinks with a click. (${pressed + 1}/5)`);
  }

  function searchTattyBed(player) {
    if (stageOf(player) < STAGE_SHACK || stageOf(player) >= STAGE_BASEMENT) {
      player.sendMessage("The bed is damp and unremarkable.");
      return;
    }
    if (!countAttribute(player, "quest.a_kingdom_divided.tatty-note")) {
      player.setAttribute("quest.a_kingdom_divided.tatty-note", 1);
      give(player, TATTY_NOTE_ITEM_ID, 1, "You find a tatty note under the bed.");
      player.sendMessage("Read the note, then inspect the crates in the north-western corner.");
      return;
    }
    player.sendMessage("You have already searched the bed.");
  }

  function enterRoseBasement(player) {
    const stage = stageOf(player);
    if (stage < STAGE_SHACK || stage >= STAGE_ORSON) {
      player.sendMessage("The trapdoor is locked.");
      return;
    }
    if (!countAttribute(player, "quest.a_kingdom_divided.tatty-note")) {
      player.sendMessage("The crates hide a trapdoor, but you should search the bed first.");
      return;
    }
    player.moveTo(new Location(BASEMENT_LANDING.x, BASEMENT_LANDING.y, BASEMENT_LANDING.z));
    if (stage < STAGE_BASEMENT) quest.setStage(player, STAGE_BASEMENT);
    player.sendMessage("You climb down into the basement beneath the shack.");
    if (stageOf(player) < STAGE_ORSON) {
      // The sleeping-princess cutscene; interrupted attempts can re-inspect the
      // crates until Orson has been revealed (the I2Qmi5 action sets 84).
      play(player, 10943, "kourend-s-last-princess-the-sleeping-princess");
    }
  }

  function openTempleDoor(player) {
    const stage = stageOf(player);
    if (stage < STAGE_KEY || stage >= STAGE_TABLE) {
      player.sendMessage("The door is locked tight.");
      return;
    }
    if (stage < STAGE_XAMPHUR) {
      if (!held(player, DAMP_KEY_ITEM_ID)) {
        player.sendMessage("The door needs a key.");
        return;
      }
      take(player, DAMP_KEY_ITEM_ID, 1);
      quest.setStage(player, STAGE_XAMPHUR);
      play(player, 10951, "the-mysterious-mage-through-the-doorway");
    }
    player.moveTo(new Location(XAMPHUR_LAB_TILE.x, XAMPHUR_LAB_TILE.y, XAMPHUR_LAB_TILE.z));
    ensureNpc(player, "xamphur", { id: XAMPHUR_ID, x: 3031, y: 5938, z: 0, wanderRadius: 0 });
    player.sendMessage("Xamphur attacks! Protect from Magic and kill the phantom hands.");
  }

  function searchLizardEggs(player) {
    const stage = stageOf(player);
    if (stage < STAGE_EGG || stage >= STAGE_EGG_TAKEN) {
      player.sendMessage("The eggs are unremarkable.");
      return;
    }
    if (!countAttribute(player, EGG_SEARCHED_ATTRIBUTE)) {
      player.setAttribute(EGG_SEARCHED_ATTRIBUTE, 1);
      ensureNpc(player, "egg-brute", { id: LIZARDMAN_BRUTE_QUEST_ID, x: 1237, y: 3617, z: 0, wanderRadius: 0 });
      player.sendMessage("You disturb a lizardman brute! It attacks.");
      return;
    }
    if (give(player, LIZARDMAN_EGG_ITEM_ID, 1, "You find the correct egg.")) {
      quest.setStage(player, STAGE_EGG_TAKEN);
      player.sendMessage("Take the egg to Kaht B'alam.");
    }
  }

  function searchXamphurTable(player) {
    const stage = stageOf(player);
    if (stage < STAGE_TABLE || stage >= STAGE_HOUSES) {
      player.sendMessage("The table is covered in rubble.");
      return;
    }
    play(player, 10951, "the-mysterious-mage-searching-the-table-in-the-lab");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    const location = event.location;
    const tile = location
      ? { x: location.getX?.() ?? location.x, y: location.getY?.() ?? location.y, z: location.getZ?.() ?? location.z ?? 0 }
      : null;

    if (HUGHES_OBJECTS.has(objectId)) {
      if (inZone(HUGHES_HOUSE_ZONE, tile)) {
        event.handled = true;
        searchHughesObject(player, objectId);
      }
      return;
    }
    if (PISCARILIUS_STATUE_IDS.includes(objectId)) {
      event.handled = true;
      pressFaunStatue(player, objectId);
      return;
    }
    if (LIZARD_EGG_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      searchLizardEggs(player);
      return;
    }
    switch (objectId) {
      case HUGHES_JUDGE_PORTAL_ID:
        event.handled = true;
        player.moveTo(new Location(1690, 5918, 0));
        player.sendMessage("You step through the portal.");
        return;
      case ARCHIVE_DISPLAY_ID:
        event.handled = true;
        searchArchiveDisplay(player);
        return;
      case FORTHOS_VINES_ID:
        event.handled = true;
        cutForthosVines(player);
        return;
      case FORTHOS_PANEL_ID:
        event.handled = true;
        checkForthosPanel(player);
        return;
      case FORTHOS_STONE_PILE_ID:
        if (tile) {
          event.handled = true;
          searchForthosPile(player, tile);
        }
        return;
      case SETTLEMENT_PANEL_ID:
        event.handled = true;
        searchSettlementPanel(player);
        return;
      case PISCARILIUS_PANEL_ID:
        event.handled = true;
        searchFaunPanel(player);
        return;
      case PISCARILIUS_PILLAR_ID: // climb to the pub's upper floor
        event.handled = true;
        player.moveTo(new Location(1772, 3680, 1));
        player.sendMessage("You climb up the pillar onto the pub's upper floor.");
        return;
      case PISCARILIUS_BATTLEMENT_ID: // climb back down
        event.handled = true;
        player.moveTo(new Location(1772, 3679, 0));
        player.sendMessage("You climb back down to the ground floor.");
        return;
      case ROSE_BASEMENT_ENTRY_ID:
        if (inZone(SHACK_ZONE, tile)) {
          event.handled = true;
          enterRoseBasement(player);
        }
        return;
      case ROSE_BASEMENT_LADDER_ID:
        event.handled = true;
        player.moveTo(new Location(SHACK_LANDING.x, SHACK_LANDING.y, SHACK_LANDING.z));
        player.sendMessage("You climb up out of the basement.");
        return;
      case 34501: // the shack's bed (tatty note)
        if (inZone(SHACK_ZONE, tile)) {
          event.handled = true;
          searchTattyBed(player);
        }
        return;
      case TEMPLE_DOOR_ID:
        event.handled = true;
        openTempleDoor(player);
        return;
      case XAMPHUR_TABLE_ID:
        event.handled = true;
        searchXamphurTable(player);
        return;
      case LOOKOUT_TRAPDOOR_ID: {
        if (!inZone(LOOKOUT_ZONE, tile)) return;
        event.handled = true;
        const stage = stageOf(player);
        if (stage >= STAGE_ARREST && stage < STAGE_COMPLETE) {
          player.moveTo(new Location(1565, 9952, 0));
          player.sendMessage("You climb down into the lookout basement.");
        } else {
          player.sendMessage("You climb down the trapdoor into the lookout basement.");
        }
        return;
      }
      case HOSIDIUS_OFFICE_ENTRY_ID:
        if (stageOf(player) >= STAGE_MEETING && stageOf(player) < STAGE_ACCORD &&
          helpedValue(player, "shayzien") >= HELPED_TASK_STARTED.shayzien) {
          event.handled = true;
          player.moveTo(new Location(1903, 9955, 0));
          player.sendMessage("You slip into Lord Hosidius' hidden office.");
          return;
        }
        event.handled = true;
        player.sendMessage("The wine barrel is fixed in place.");
        return;
      case HOSIDIUS_OFFICE_CHEST_ID:
        event.handled = true;
        if (stageOf(player) >= STAGE_MEETING && stageOf(player) < STAGE_ACCORD &&
          helpedValue(player, "shayzien") >= HELPED_TASK_STARTED.shayzien) {
          if (!held(player, SHAYZIEN_JOURNAL_ITEM_ID)) {
            give(player, SHAYZIEN_JOURNAL_ITEM_ID, 1, "You pick the lock and find King Shayzien VII's journal.");
          } else {
            player.sendMessage("The chest is empty.");
          }
        } else {
          player.sendMessage("You have no reason to open this chest.");
        }
        return;
      default:
        return;
    }
  }

  /** Statues of the Great Kourend puzzle (any "Statue" object in the pub). */
  function handleStatue(event) {
    const { player, objectId } = event;
    if (!player || typeof player.getAttribute !== "function") return false;
    const stage = stageOf(player);
    if (stage < STAGE_FAUN_PANEL || stage >= STAGE_FAUN_NOTE) return false;
    event.handled = true;
    pressFaunStatue(player, objectId);
    return true;
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  /** Hands over one of Rose's notes, replacing any earlier note (one at a time). */
  function giveNote(player, index, message) {
    for (const id of ROSE_NOTE_ITEM_IDS) take(player, id, 1);
    return give(player, ROSE_NOTE_ITEM_IDS[index], 1, message);
  }

  function readNotes(player, itemId) {
    const lines = [];
    if (itemId === RECEIPT_ITEM_ID) {
      lines.push("The receipt is for a bed, ordered to The Deeper Lode in Lovakengj.");
    } else if (itemId === ROSES_DIARY_ITEM_ID) {
      lines.push("You flick through Rose's diary, but find nothing of note.");
    } else if (itemId === ROSE_NOTE_ITEM_IDS[0]) {
      lines.push("The note is a riddle about a place Rose and her father loved.");
      if (stageOf(player) < STAGE_NOTE_READ) quest.setStage(player, STAGE_NOTE_READ);
    } else if (itemId === ROSE_NOTE_ITEM_IDS[1]) {
      lines.push("The second note points to the Settlement Ruins, south-west of Wintertodt.");
      player.setAttribute(FORTHOS_NOTE_ATTRIBUTE, 1);
      if (stageOf(player) < STAGE_FORTHOS_NOTE) quest.setStage(player, STAGE_FORTHOS_NOTE);
    } else if (itemId === ROSE_NOTE_ITEM_IDS[2]) {
      lines.push("The third note points to The Legless Faun in Port Piscarilius.");
      player.setAttribute(SETTLEMENT_NOTE_ATTRIBUTE, 1);
      if (stageOf(player) < STAGE_SETTLEMENT_DONE) quest.setStage(player, STAGE_SETTLEMENT_DONE);
    } else if (itemId === ROSE_NOTE_ITEM_IDS[3]) {
      lines.push("The final note points to a shack west of fairy ring CIR, south of Mount Karuulm.");
    } else if (itemId === RESEARCH_NOTES_ITEM_ID) {
      lines.push("The note reveals Xamphur was behind the events of The Ascent of Arceuus.");
      quest.setStage(player, STAGE_NOTES_READ);
      player.sendMessage("Return to Fullore in the shack basement.");
    } else if (itemId === SHAYZIEN_JOURNAL_ITEM_ID) {
      lines.push("King Shayzien VII's journal links his house to Xeric.");
    } else if (itemId === DECLARATION_ITEM_ID) {
      lines.push("The declaration shows Unkar planned to overthrow Lady Lovakengj.");
    } else if (itemId === TATTY_NOTE_ITEM_ID) {
      lines.push("The tatty note is a letter to Rose signed L.O. It mentions the shack.");
    }
    for (const line of lines) player.sendMessage(line);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    const action = String(option ?? "").toLowerCase();
    if (itemId === ANTIQUE_LAMP_ITEM_ID) {
      if (action !== "rub") return;
      event.handled = true;
      api.emitCustomEvent("xpreward:open", {
        player,
        minLevel: LAMP_MIN_LEVEL,
        title: "Choose the stat you wish to be advanced!",
        onConfirm: (skill, name) => {
          const before = player.getSkillManager().getExperience(skill);
          player.getSkillManager().addExperience(skill, LAMP_XP, false);
          if (player.getSkillManager().getExperience(skill) === before) {
            player.sendMessage("You cannot gain experience in that skill right now.");
            return null;
          }
          const slot = player.getInventory().getSlotForItemId?.(itemId) ?? -1;
          if (slot >= 0) player.getInventory().deleteAtSlot(slot, 1);
          else player.getInventory().deleteNumber(itemId, 1);
          player.setAttribute(LAMPS_ATTRIBUTE, countAttribute(player, LAMPS_ATTRIBUTE) + 1);
          return `You rub the lamp and feel more experienced. You have been awarded ${LAMP_XP.toLocaleString("en-US")} ${name} XP!`;
        },
      });
      return;
    }
    const readable = [RECEIPT_ITEM_ID, ROSES_DIARY_ITEM_ID, ...ROSE_NOTE_ITEM_IDS,
      RESEARCH_NOTES_ITEM_ID, SHAYZIEN_JOURNAL_ITEM_ID, DECLARATION_ITEM_ID, TATTY_NOTE_ITEM_ID];
    if (readable.includes(itemId) && (action === "read" || action === "check" || action === "inspect")) {
      event.handled = true;
      readNotes(player, itemId);
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    const pair = [usedItemId, usedWithItemId];
    if (!pair.includes(VOLCANIC_SULPHUR_ITEM_ID)) return;
    const potionId = pair.find((id) => DEFENCE_POTION_IDS.includes(id));
    if (potionId === undefined) return;
    const doses = DEFENCE_POTION_IDS.indexOf(potionId); // 0 = (4) ... 3 = (1)
    if (doses > 1) {
      player.sendMessage("The potion needs at least 3 doses.");
      return;
    }
    event.handled = true;
    take(player, VOLCANIC_SULPHUR_ITEM_ID, 1);
    take(player, potionId, 1);
    give(player, SULPHUR_POTION_ITEM_ID, 1, "You mix the volcanic sulphur into the defence potion.");
    player.sendMessage("Take the sulphur potion to the Tasakaal at Mount Karuulm.");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player || typeof player.getAttribute !== "function") return;
    if (objectId !== DOORS_OF_DINH_ID || itemId !== SHIELDING_POTION_ITEM_ID) return;
    if (stageOf(player) < STAGE_MEETING || stageOf(player) >= STAGE_ACCORD) {
      player.sendMessage("The Doors of Dinh do not need this potion.");
      return;
    }
    event.handled = true;
    take(player, SHIELDING_POTION_ITEM_ID, 1);
    setHelped(player, "arceuus", HELPED_TASK_STARTED.arceuus + 3);
    play(player, 7374, "lord-arceuus-favour-pouring-the-shielding-potion");
    player.sendMessage("You pour the shielding potion over the Doors of Dinh. Return to Lord Arceuus.");
  }

  /** The Settlement Ruins ice chunks (NPC 11142) melt under a fire spell or Search. */
  function handleIceChunks(event) {
    const { player } = event;
    if (!player || typeof player.getAttribute !== "function") return false;
    const stage = stageOf(player);
    if (stage < STAGE_ASSASSIN_DEAD || stage >= STAGE_COLD_KEY) return false;
    if (stage <= STAGE_ICE) {
      // Melt the ice first, then search the melted chunks.
      if (stage < STAGE_ICE) {
        quest.setStage(player, STAGE_ICE);
        player.sendMessage("You melt the ice with fire. Search the chunks for anything inside.");
        return true;
      }
      if (give(player, COLD_KEY_ITEM_ID, 1, "You find a cold key inside the melted chunks.")) {
        quest.setStage(player, STAGE_COLD_KEY);
        player.sendMessage("Open the panel on the western wall.");
      }
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Zone, login and death handling
  // ==========================================================================

  function handleZoneEnter({ player }) {
    syncStoryNpcs(player);
  }

  function handleCampZoneEnter({ player }) {
    syncStoryNpcs(player);
    if (!player || typeof player.getAttribute !== "function") return;
    const stage = stageOf(player);
    if (stage < STAGE_MEETING || stage >= STAGE_ACCORD) return;
    if (helpedValue(player, "hosidius") < HELPED_TASK_STARTED.hosidius) return;
    if (helpedValue(player, "hosidius") >= HELPED_TASK_STARTED.hosidius + 1) return;
    ensureNpc(player, "warlord", { id: BARBARIAN_WARLORD_ID, x: 1582, y: 9828, z: 0, wanderRadius: 0 });
    player.sendMessage("The Barbarian Warlord attacks!");
  }

  function handleZoneExit({ player }) {
    syncStoryNpcs(player);
  }

  function handleLogin({ player }) {
    if (!player || typeof player.getAttribute !== "function") return;
    syncStoryNpcs(player);
    sendQuestProgressVarbits(player);
    refreshQuestList(player);
  }

  /** Stage changes drive the cache-transform varbits the world NPCs read. */
  function handleStageChanged({ player, key }) {
    if (key !== "a_kingdom_divided" || !player) return;
    syncStageVarbits(player);
  }

  function handleLogout({ player }) {
    clearNpcs(player);
  }

  function handlePlayerDeath(event) {
    const { player, itemsLost } = event;
    if (!player || player.isPlayerBot?.() === true) return;
    if (itemsLost === false) return;
    if (respawnPoint(player) !== RESPAWN_KOUREND) return;
    event.handled = true;
    player.moveTo(new Location(KOUREND_CASTLE_RESPAWN.x, KOUREND_CASTLE_RESPAWN.y, KOUREND_CASTLE_RESPAWN.z));
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const helped = (house) => helpedValue(player, house) >= HELPED_DONE;
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I uncovered the Kourend Council's conspiracy: they poisoned</str>",
        "<str>King Kharedst's daughter Rose and hid her away. Xamphur,</str>",
        "<str>Xeric's ancient ally, was behind it all.</str>",
        "<str>I destroyed the Council and King Artur Hosidius was crowned.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ARREST) {
      return [
        "<str>Rose's Accord has been signed. The leaders march on the</str>",
        "<str>castle to depose the Council.</str>",
        "",
        "I should speak to <col=800000>Commander Fullore</col> to see",
        "this through.",
      ];
    }
    if (stage >= STAGE_ACCORD) {
      return countAttribute(player, KANDUR_ACCORD_ATTRIBUTE)
        ? [
          "<str>Lord Hosidius revealed his plans, and Rose's Accord is</str>",
          "<str>ready. The leaders will march on the castle.</str>",
          "",
          "I should speak to <col=800000>Commander Fullore</col>.",
        ]
        : [
          "<str>The five Houses have signed Rose's Accord.</str>",
          "",
          "I should speak to <col=800000>Lord Hosidius</col> in the",
          "<col=800000>lookout basement</col>.",
        ];
    }
    if (stage >= STAGE_MEETING) {
      const remaining = ["piscarilius", "arceuus", "lovakengj", "hosidius", "shayzien"]
        .filter((house) => !helped(house));
      if (remaining.length === 0) {
        return [
          "<str>All five Houses have agreed to sign Rose's Accord.</str>",
          "",
          "I should speak to <col=800000>Commander Fullore</col> at Xeric's Lookout.",
        ];
      }
      return [
        "<str>The five leaders have gathered at Xeric's Lookout and each</str>",
        "<str>asked for my help before they will sign Rose's Accord.</str>",
        "",
        `I still need to help: <col=800000>${remaining.join(", ")}</col>.`,
      ];
    }
    if (stage >= STAGE_HOUSES) {
      return [
        "<str>Rose is dead. Fullore and I buried her, and Xamphur's</str>",
        "<str>research is in Fullore's hands.</str>",
        "",
        "I must ask the <col=800000>five House leaders</col> to meet at",
        "<col=800000>Xeric's Lookout</col> and help depose the Council.",
      ];
    }
    if (stage >= STAGE_TABLE) {
      return [
        "<str>I defeated Xamphur beneath the Lizardman Temple and found</str>",
        "<str>his research notes: he was behind the Ascent of Arceuus too.</str>",
        "",
        "I should return to <col=800000>Fullore</col> in the shack's basement.",
      ];
    }
    if (stage >= STAGE_XAMPHUR) {
      return [
        "<str>Through the temple door I was attacked by Xamphur, one of</str>",
        "<str>Xeric's oldest allies.</str>",
        "",
        "I must defeat him.",
      ];
    }
    if (stage >= STAGE_KEY) {
      return [
        "<str>Kaht B'alam gave me a damp key for the small door in the</str>",
        "<str>temple corridor.</str>",
        "",
        "I should open the door near <col=800000>Kaht B'alam</col>.",
      ];
    }
    if (stage >= STAGE_EGG) {
      return [
        "<str>Kaht B'alam will help me find the mage if I fetch his last</str>",
        "<str>egg from the lizardman egg piles south-west of the temple.</str>",
      ];
    }
    if (stage >= STAGE_ORSON) {
      return [
        "<str>Deep beneath the shack I found Rose and Councillor Orson,</str>",
        "<str>who confessed the Council poisoned the King and Rose.</str>",
        "",
        "Rose is kept alive by a mysterious mage among the lizardmen.",
        "I should look for him in <col=800000>Molch</col>.",
      ];
    }
    if (stage >= STAGE_BASEMENT) {
      return [
        "<str>I found a hidden basement beneath the shack near fairy ring</str>",
        "<str>CIR - and Rose, the last princess, inside it.</str>",
        "",
        "Someone is coming. I should hide and listen.",
      ];
    }
    if (stage >= STAGE_SHACK) {
      return [
        "<str>Martin was arrested by Tomas Lawry. The final note points</str>",
        "<str>to a shack west of fairy ring CIR, south of Mount Karuulm.</str>",
        "",
        "I should search the shack.",
      ];
    }
    if (stage >= STAGE_FAUN_NOTE) {
      return [
        "<str>I solved the Legless Faun's statue puzzle and took the final</str>",
        "<str>note, but Tomas arrested Martin on the Council's orders.</str>",
      ];
    }
    if (stage >= STAGE_FAUN_PANEL) {
      return [
        "<str>At The Legless Faun the panel named the cities in order.</str>",
        "",
        "I should press the <col=800000>five statues</col> in that order and",
        "check the panel again.",
      ];
    }
    if (stage >= STAGE_FAUN) {
      return [
        "<str>Martin and I are following Rose's notes.</str>",
        "",
        "I should speak to <col=800000>Martin</col> at",
        "<col=800000>The Legless Faun</col> in Port Piscarilius.",
      ];
    }
    if (stage >= STAGE_SETTLEMENT_DONE) {
      return [
        "<str>I defeated an assassin at the Settlement Ruins and found</str>",
        "<str>Rose's third note, which names The Legless Faun.</str>",
      ];
    }
    if (stage >= STAGE_SETTLEMENT) {
      return [
        "<str>Martin and I are following Rose's notes together.</str>",
        "",
        "I should help him at the <col=800000>Settlement Ruins</col>,",
        "south-west of Wintertodt.",
      ];
    }
    if (stage >= STAGE_FORTHOS_NOTE) {
      return [
        "<str>I found Rose's second note behind the Forthos panel.</str>",
        "",
        "I should show it to <col=800000>Martin</col>.",
      ];
    }
    if (stage >= STAGE_FORTHOS) {
      return [
        "<str>Martin and I searched the Forthos Ruins for Rose's clue.</str>",
        "",
        "I should search the <col=800000>stone piles</col>, cut the",
        "<col=800000>vines</col> and open the <col=800000>panel</col>.",
      ];
    }
    if (stage >= STAGE_NOTE_READ) {
      return [
        "<str>Rose's note is a riddle pointing to a location.</str>",
        "",
        "I should discuss it with <col=800000>Martin Holt</col>.",
      ];
    }
    if (stage >= STAGE_NOTE) {
      return [
        "<str>Martin found a note hidden in Rose's diary and gave it</str>",
        "<str>to me.</str>",
        "",
        "I should read it.",
      ];
    }
    if (stage >= STAGE_DIARY) {
      return [
        "<str>I stole Rose's diary from the Library Historical Archive.</str>",
        "",
        "I should take it to <col=800000>Martin Holt</col>.",
      ];
    }
    if (stage >= STAGE_ARCHIVE) {
      return [
        "<str>Rose's diary is on display in the Library Historical Archive.</str>",
        "",
        "I should pickpocket <col=800000>Istoria</col> for the case key.",
      ];
    }
    if (stage >= STAGE_FULLORE_OUTSIDE) {
      return [
        "<str>Commander Fullore wants the truth about the Council's</str>",
        "<str>conspiracy against the last royal family.</str>",
        "",
        "I should speak to <col=800000>Martin Holt</col> at Kourend Castle.",
      ];
    }
    if (stage >= STAGE_JUDGE_DEAD) {
      return [
        "<str>Hughes summoned the Judge of Yama, who killed her, and I</str>",
        "<str>defeated it on the Port Piscarilius docks.</str>",
        "",
        "I should find <col=800000>Commander Fullore</col> outside",
        "<col=800000>Kourend Castle</col>.",
      ];
    }
    if (stage >= STAGE_JUDGE) {
      return [
        "<str>Sophia Hughes summoned the Judge of Yama at the docks.</str>",
        "",
        "I must defeat the demon.",
      ];
    }
    if (stage >= STAGE_FUGGY) {
      return [
        "<str>Fuggy told me Hughes chartered Veos' ship in Port Piscarilius.</str>",
        "",
        "I should look for her at the <col=800000>Port Piscarilius docks</col>.",
      ];
    }
    if (stage >= STAGE_FULLORE_KINGSTOWN) {
      return [
        "<str>The receipt names The Deeper Lode in Lovakengj.</str>",
        "",
        "I should search the pub's records for Councillor Hughes.",
      ];
    }
    if (stage >= STAGE_HOUSE) {
      return [
        "<str>I am investigating Councillor Hughes' escape.</str>",
        "",
        "I should search the <col=800000>house</col> for clues and read",
        "anything I find.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Martin Holt asked me to investigate Sophia Hughes' escape.</str>",
        "",
        "I should speak to <col=800000>Commander Fullore</col> in",
        "<col=800000>Kourend Castle</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Martin Holt</col>",
      "east of <col=800000>Kourend Castle</col>.",
      "",
      "I must have completed the five Great Kourend quests, and have",
      "54 Agility, 52 Thieving, 52 Woodcutting, 50 Herblore, 42 Mining,",
      "38 Crafting and 35 Magic.",
    ];
  }

  function grantReward(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED, 1);
    player.sendMessage("You can now use the new Arceuus spells and fight Yama.");
    player.sendMessage("Speak to Commander Fullore for the Book of the Dead and your antique lamps.");
  }

  function pickpocketIstoria(event) {
    const { player } = event;
    if (!player || typeof player.getAttribute !== "function") return false;
    const stage = stageOf(player);
    if (stage < STAGE_ARCHIVE || stage >= STAGE_HOUSES) return false;
    if (held(player, BLUISH_KEY_ITEM_ID) || stage >= STAGE_DIARY) {
      event.handled = true;
      player.sendMessage("Istoria has nothing else for you.");
      return true;
    }
    event.handled = true;
    if (give(player, BLUISH_KEY_ITEM_ID, 1, "You pickpocket a bluish key from Istoria.")) {
      player.sendMessage("Use it on the pink display case in the south-east corner.");
    }
    return true;
  }

  function talkArcheio(event) {
    const { player } = event;
    if (!player || typeof player.getAttribute !== "function") return false;
    const stage = stageOf(player);
    if (stage < STAGE_FULLORE_OUTSIDE || stage >= STAGE_HOUSES) return false;
    event.handled = true;
    player.moveTo(new Location(1553, 10219, 0));
    player.sendMessage("Archeio teleports you to the Library Historical Archive.");
    return true;
  }

  function pickpocketIceChunks(event) {
    const { player, npcId } = event;
    if (!ICE_CHUNKS_IDS.has(npcId)) return false;
    const handled = handleIceChunks(event);
    if (handled) event.handled = true;
    return handled;
  }

  let labTablePlaced = false;

  function handleServerStartup() {
    // The Xamphur lair is a bare area in this cache, so its research table (the
    // [Search] multi-loc parent) is ours to place. One global object; the area
    // only exists for this quest.
    if (labTablePlaced) return;
    const location = new Location(XAMPHUR_TABLE_TILE.x, XAMPHUR_TABLE_TILE.y, XAMPHUR_TABLE_TILE.z);
    const existing = ObjectManager.objectsAt?.(location) ?? [];
    if (existing.some((object) => object.getId?.() === XAMPHUR_TABLE_ID)) {
      labTablePlaced = true;
      return;
    }
    try {
      ObjectManager.register(new GameObject(XAMPHUR_TABLE_ID, location, 10, 0, null), true);
      labTablePlaced = true;
    } catch {
      // Already placed (e.g. double startup in one process): harmless.
    }
  }

  api.persistAttribute(RECRUITED_ATTRIBUTE);
  api.persistAttribute(LAMPS_ATTRIBUTE);
  api.persistAttribute(ASTEROS_MET_ATTRIBUTE);
  api.persistAttribute(RESPAWN_ATTRIBUTE);
  api.persistAttribute(FUNERAL_ATTRIBUTE);
  api.persistAttribute(MARTIN_PRISON_ATTRIBUTE);
  api.persistAttribute(KANDUR_ACCORD_ATTRIBUTE);
  api.persistAttribute("quest.a_kingdom_divided.clues");
  api.persistAttribute("quest.a_kingdom_divided.tatty-note");
  api.persistAttribute(STONE_PILES_ATTRIBUTE);
  api.persistAttribute(VINES_ATTRIBUTE);
  api.persistAttribute(STATUES_ATTRIBUTE);
  api.persistAttribute(FUGGY_TOLD_ATTRIBUTE);
  api.persistAttribute(HERBERT_ASKED_ATTRIBUTE);
  api.persistAttribute(KAHT_ASKED_ATTRIBUTE);
  api.persistAttribute(EGG_SEARCHED_ATTRIBUTE);
  api.persistAttribute(JORRA_TASK_ATTRIBUTE);
  api.persistAttribute(JORRA_DONE_ATTRIBUTE);
  api.persistAttribute(FORTHOS_NOTE_ATTRIBUTE);
  api.persistAttribute(SETTLEMENT_NOTE_ATTRIBUTE);
  api.persistAttribute(FAUN_ORDER_ATTRIBUTE);
  api.persistAttribute(`${HELPED_ATTRIBUTE}.piscarilius`);
  api.persistAttribute(`${HELPED_ATTRIBUTE}.arceuus`);
  api.persistAttribute(`${HELPED_ATTRIBUTE}.lovakengj`);
  api.persistAttribute(`${HELPED_ATTRIBUTE}.hosidius`);
  api.persistAttribute(`${HELPED_ATTRIBUTE}.shayzien`);

  quest = registerQuest(api, {
    key: "a_kingdom_divided",
    name: "A Kingdom Divided",
    varpId: VARP_AKD,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [],
    rewardItemId: BOOK_OF_THE_DEAD_ITEM_ID,
    rewardItemLabel: "Book of the Dead",
    otherRewards: [
      "Two antique lamps (10,000 XP each, level 40+)",
      "Kourend Castle respawn point (talk to Asteros Arceuus)",
      "24 new Arceuus spellbook spells",
      "The ability to fight Yama",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(handleTalk);
  api.onNpcInteraction("Istoria", { Pickpocket: pickpocketIstoria });
  api.onNpcInteraction("Archeio", { Teleport: talkArcheio });
  api.onNpcInteraction(pickpocketIceChunks);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectInteraction("Statue", {
    Inspect: handleStatue,
    Push: handleStatue,
    Press: handleStatue,
    "Press statue": handleStatue,
  });
  api.onItemAction(handleItemAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onZoneEnter(HUGHES_HOUSE_ZONE, handleZoneEnter);
  api.onZoneEnter(FORTHOS_ZONE, handleZoneEnter);
  api.onZoneEnter(SETTLEMENT_ZONE, handleZoneEnter);
  api.onZoneEnter(FAUN_ZONE, handleZoneEnter);
  api.onZoneEnter(SHACK_ZONE, handleZoneEnter);
  api.onZoneEnter(BASEMENT_ZONE, handleZoneEnter);
  api.onZoneEnter(TEMPLE_ZONE, handleZoneEnter);
  api.onZoneEnter(LAB_ZONE, handleZoneEnter);
  api.onZoneEnter(BARBARIAN_CAMP_ZONE, handleCampZoneEnter);
  api.onZoneEnter(LOOKOUT_ZONE, handleZoneEnter);
  api.onZoneEnter(LOOKOUT_BASEMENT_ZONE, handleZoneEnter);
  api.onZoneEnter(HOSIDIUS_OFFICE_ZONE, handleZoneEnter);
  api.onServerStartup(handleServerStartup);
};
