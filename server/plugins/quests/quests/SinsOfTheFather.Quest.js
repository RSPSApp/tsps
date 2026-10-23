/**
 * Sins of the Father (members, Myreque #5).
 *
 * The words come from the "Sins of the Father" transcript page; this plugin
 * supplies the variant selection for the quest's cast, the prose-condition
 * answers, the start hook, the Slepe Sleeper Plague investigation (Hameln,
 * Carl's barrel, the eavesdrop and the Kroy fight), the Paterdomus/Haunted
 * Woods meeting, the Ivan escort, the Icyene Graveyard mausoleum puzzle, the
 * Myreque convincing, the Meiyerditch laboratory (mutated bloodveld and
 * Haemalchemy volume 2), the vyre noble disguise chain (Trader Sven, Polmafi,
 * Damien Leucurte), Darkmeyer (Desmodus, Mordan Nikazsi, the Gadderanks prison
 * scene), the Blisterwood Arboretum valve/logs puzzle, the blisterwood weapon
 * crafting and the Vanstrom Klause finale, plus the completion reward and
 * post-quest unlocks (boat travel, tome recovery, the medallion's Darkmeyer
 * destination once this quest is done, and the XP tome's six chapters).
 *
 * Stages (varbit 7255 "myq5" in varp 2712 "myq5", bits 0-8; cache evidence:
 * `scripts/lookup-gameval.ts varbit myq5`, and the live 226 transcript's
 * varbit updates): 0 unstarted, 2 Veliaf briefed, 6 Hameln told (pub lead),
 * 12 following Carl, 14 Carl reaches the crypt, 16 Kroy fight, 18 Kroy dead, 20 lab tables destroyed,
 * 22 reported to Veliaf (go Paterdomus), 24 Paterdomus briefed (meet Ivan),
 * 34 meeting watched (escort), 36 escorting Ivan, 38 Ivan delivered to
 * Burgh de Rott, 40 boathouse briefed, 44 arrived Icyene Graveyard (meeting),
 * 48 Vanescula (mausoleum), 50 lock ready, 52 puzzle solved, 54 convincing the Myreque,
 * 56 all convinced (weapons plan), 58 go to the laboratory, 62 bloodveld
 * fight, 64 Safalaan after the fight, 66 book found, 68 book given (back to
 * graveyard), 72 disguise briefing (Polmafi), 78 disguise made, 80 Damien
 * confrontation, 84 Damien attacks, 86 Damien dead (disguise scented),
 * 88 Vanescula (enter Darkmeyer), 90 Desmodus task, 92 Mordan found,
 * 94 prison, 98 slaves handled, 100 Arboretum open, 112 eight logs,
 * 114 logs delivered, 116 seven logs to Vertida (crafting), 118 crafting,
 * 120 flail made (back to graveyard), 122 Safalaan returns, 126 ready,
 * 130 Castle Drakan (Vanstrom fight), 132 Vanstrom dead, 138 complete.
 * The quest's own sub-bits live in one persisted attribute
 * "quest.sins_of_the_father.bits" and key ones are mirrored to the cache's
 * varbits (10347-10351 convinced, 10353/10354 Kroy tables, 10359 Trader Sven
 * met, 10365 puzzle, 13719 lab unlocked).
 *
 * Source: OSRS Wiki "Sins of the Father", its Quick guide and
 * Transcript:Sins of the Father; the cache for every id, varbit and
 * placement (lookup-gameval.ts / dump:loc); the wiki location infoboxes for
 * NPC tiles.
 *
 * Gaps / approximations:
 * - The skill requirements (62 Woodcutting, 60 Fletching, 56 Crafting,
 *   52 Agility, 50 Attack, 50 Slayer, 49 Magic) gate the start, plus A Taste
 *   of Hope completion; the warning for a low combat level is computed from
 *   the skill levels.
 * - Carl's follow is area-scoped (surface Slepe) and uses NPC 9558's actual
 *   spawn and walk updates from capture 1637 (ticks 1164-1504), on the real
 *   collision map. The barrel action teleports the player to the captured
 *   follow start (3754,3307). Captured idle points pause/turn Carl; sight uses
 *   the view cone plus blocked-tile line of sight, and too-close/seen or
 *   too-far resets to Hameln for the captured retry. Progress persists by
 *   captured step, never by player proximity; blocked barrel/stairs tiles stay
 *   out of the NPC chain. The normal end
 *   unlocks the church stairs; the stairs' captured "Continue the Sins of the
 *   Father quest." choice starts the cutscene/Kroy room. Kroy's QH-only potion
 *   throw is not modelled (no capture evidence here). Tables are per-player
 *   overlays swapped on destroy.
 * - The Ivan escort is a scripted trek in Mort Myre (three vines -> long vine
 *   -> swing, two nail beasts, two juvinates) with no fail state; the bridge
 *   repair is a flavour line. There is no instance.
 * - The mausoleum lock is the real cache Kakurasu interface 665: it opens
 *   after the briefing, shows captured row/column sums and accepts OP1 clicks
 *   on buttons 0-24; only a matching grid advances the quest.
 * - Darkmeyer's bank/shop/attack gating (the newcomers transcripts) and the
 *   Daeyalt mine/Hallowed Sepulchre entrances are not wired; the Cracked wall
 *   is bidirectional and gates entry until Vanescula sends you.
 * - The finale uses the captured camera tracks, scene actors and fade, but the
 *   Safalaan power/escape dialogue still uses NPC chatheads rather than a
 *   fully instanced cutscene. Vanstrom uses his real stats (9569), enrage
 *   (9571), lightning, pets, darkness and blood-orb mechanics.
 * - Damien's fires and the medallion's destination UI belong to A Taste of
 *   Hope; this plugin only answers the medallion once this quest is complete.
 */
module.exports = function registerSinsOfTheFatherQuest(api) {
  const {
    Skill,
    Location,
    Equipment,
    ItemDefinition,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectManager,
    MapObjects,
    RegionManager,
    GameObject,
    Area,
    Boundary,
  } = api.core;
  const { registerQuest, startTranscript, startDialogue, refreshQuestList } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  const PAGE = "Sins of the Father";
  const START_HOOK = "quest:sins-of-the-father:start";
  const PREREQUISITE_KEY = "taste_of_hope";
  const BLOOD_MOON_KEY = "the_blood_moon_rises";
  const BITS_ATTRIBUTE = "quest.sins_of_the_father.bits";
  const TOME_USES_ATTRIBUTE = "quest.sins_of_the_father.tome-chapters";
  const BRIDGE_ATTRIBUTE = "sins-of-the-father:bridge-repairs";
  const VINE_ATTACHED_ATTRIBUTE = "sins-of-the-father:vine-attached";
  const VAMPYRE_NAME_ATTRIBUTE = "quest.sins_of_the_father.vampyre-name";
  const SCHEMA_ATTRIBUTE = "sins-of-the-father:schema";
  const CARL_PROGRESS_ATTRIBUTE = "sins-of-the-father:carl-progress";
  const SCHEMA_VERSION = 2;
  const TOME_MAX_CHAPTERS = 6;

  // Vanescula gives the player a fake vyre name (OSRS Wiki "Vampyric name") used
  // by the wiki's "[vampyre name]" transcript blanks.
  const VAMPYRE_FIRST_NAMES = [
    "Anaric", "Balnar", "Carnivar", "Dracona", "Epsenti", "Haemar", "Kaerin", "Leardin",
    "Molark", "Morytan", "Noctil", "Remian", "Rumelo", "Sanguinak", "Vanpyrus", "Varniprus",
  ];
  const VAMPYRE_LAST_NAMES = [
    "Caermoran", "Caernivus", "Constantine", "Diaemus", "Draskarin", "Helsing", "Jargarin",
    "Kardava", "Lasarin", "Lugosi", "Mortabel", "Nightshade", "Rasputin", "Sanguine",
    "von Pitt", "von Tyn",
  ];

  // ---------------------------------------------------------------------------
  // Stage ladder (varbit 7255, varp 2712)
  // ---------------------------------------------------------------------------

  const STAGE_UNSTARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_HAMELN = 6;
  const STAGE_FOLLOWING = 12;
  const STAGE_CARL_DONE = 14;
  const STAGE_KROY_FIGHT = 16;
  const STAGE_KROY_DEAD = 18;
  const STAGE_LAB_DESTROYED = 20;
  const STAGE_VELIAF_REPORTED = 22;
  const STAGE_PATERDOMUS = 24;
  const STAGE_MEETING = 34;
  const STAGE_ESCORT = 36;
  const STAGE_ESCORT_DONE = 38;
  const STAGE_BOATHOUSE = 40;
  const STAGE_GRAVEYARD = 44;
  const STAGE_MUSEUM_TALK = 48;
  const STAGE_PUZZLE_READY = 50;
  const STAGE_PUZZLE_DONE = 52;
  const STAGE_CONVINCING = 54;
  const STAGE_CONVINCED = 56;
  const STAGE_LAB_PLAN = 58;
  const STAGE_BLOODVELD = 62;
  const STAGE_BLOODVELD_TALK = 64;
  const STAGE_LAB_BOOK = 66;
  const STAGE_LAB_DONE = 68;
  const STAGE_DISGUISE_BRIEF = 72;
  const STAGE_DISGUISE_GIVEN = 76;
  const STAGE_DISGUISE_MADE = 78;
  const STAGE_DISGUISE_READY = 80;
  const STAGE_DAMIEN_READY = 82;
  const STAGE_DAMIEN_CONFRONT = 84;
  const STAGE_DAMIEN_DONE = 86;
  const STAGE_DARKMEYER_PLAN = 88;
  const STAGE_DARKMEYER = 90;
  const STAGE_MORDAN = 92;
  const STAGE_PRISON = 94;
  const STAGE_SLAVES_DONE = 98;
  const STAGE_ARBORETUM = 100;
  const STAGE_LOGS = 112;
  const STAGE_LOGS_GIVEN = 114;
  const STAGE_VERTIDA_LOGS = 116;
  const STAGE_CRAFTING = 118;
  const STAGE_FLAIL = 120;
  const STAGE_SAFALAAN_WALK = 122;
  const STAGE_READY = 126;
  const STAGE_CASTLE = 130;
  const STAGE_VANSTROM_DEAD = 132;
  const STAGE_COMPLETE = 138;

  // Cache sub-varbits of varp 2712 mirrored so the cache's own scripts follow.
  const VARBIT_KAEL_CONVINCED = 10347;
  const VARBIT_VERTIDA_CONVINCED = 10348;
  const VARBIT_IVAN_CONVINCED = 10349;
  const VARBIT_POLMAFI_CONVINCED = 10350;
  const VARBIT_RADIGAD_CONVINCED = 10351;
  const VARBIT_KROY_TABLE_1 = 10353;
  const VARBIT_KROY_TABLE_2 = 10354;
  const VARBIT_TRADER_SVEN_MET = 10359;
  const VARBIT_PUZZLE_COMPLETED = 10365;
  const VARBIT_LAB_UNLOCKED = 13719;

  const BIT_KAEL = 1 << 0;
  const BIT_VERTIDA = 1 << 1;
  const BIT_IVAN = 1 << 2;
  const BIT_POLMAFI = 1 << 3;
  const BIT_RADIGAD = 1 << 4;
  const BIT_VELIAF_ASKED = 1 << 5;
  const BIT_CARL_ASKED = 1 << 6;
  const BIT_TABLE_1 = 1 << 7;
  const BIT_TABLE_2 = 1 << 8;
  const BIT_TRAIL = 1 << 9; // following Carl / Kroy fight started
  const BIT_DAMIEN = 1 << 10; // Damien fight started
  const BIT_VANSTROM = 1 << 11; // Vanstrom fight started
  const BIT_PUZZLE_PLAYED = 1 << 12; // the mausoleum lock conversation seen
  const BIT_TREK = 1 << 13; // escort crossed the bog on the vine
  const BIT_SVEN = 1 << 14; // bought from Trader Sven
  const BIT_BRIDGE = 1 << 15; // escort crossed the repaired bridge
  const CONVINCED_MASK = BIT_KAEL | BIT_VERTIDA | BIT_IVAN | BIT_POLMAFI | BIT_RADIGAD;
  // 2-bit fields for the escort kill counts and the 3-bit valve fields.
  const NAIL_SHIFT = 16;
  const JUVI_SHIFT = 18;
  const VALVE_NORTH_SHIFT = 20;
  const VALVE_SOUTH_SHIFT = 23;
  const GALLONS_SHIFT = 26; // 6 bits (0-63)

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------

  const VELIAF_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879,
    15885,
  ]);
  const SAFALAAN_IDS = new Set([
    NpcIdentifiers.SAFALAAN_HALLOW, // 3775
    NpcIdentifiers.SAFALAAN_HALLOW_2, // 8216
    NpcIdentifiers.SAFALAAN_HALLOW_5, // 8219
    15893,
    15894,
  ]);
  const VANESCULA_IDS = new Set([
    NpcIdentifiers.VANESCULA_DRAKAN, // 3740
    9574, // myq5 human, Talk-to
  ]);
  const VERTIDA_IDS = new Set([
    NpcIdentifiers.VERTIDA_SEFALATIS, // 8220
    NpcIdentifiers.VERTIDA_SEFALATIS_3, // 8222
  ]);
  const KAEL_IDS = new Set([NpcIdentifiers.KAEL_FORSHAW, NpcIdentifiers.KAEL_FORSHAW_2]); // 8230/8231
  const RADIGAD_IDS = new Set([NpcIdentifiers.RADIGAD_PONFIT]); // 5051
  const POLMAFI_IDS = new Set([NpcIdentifiers.POLMAFI_FERDYGRIS]); // 5052
  const IVAN_IDS = new Set([
    NpcIdentifiers.IVAN_STROM, // 4440
    NpcIdentifiers.IVAN_STROM_2, // 4441
    NpcIdentifiers.IVAN_STROM_3, // 5053
    NpcIdentifiers.IVAN_STROM_5, // 9531
    NpcIdentifiers.IVAN_STROM_10, // 9536 (escort)
  ]);
  const DREZEL_IDS = new Set([NpcIdentifiers.DREZEL]); // 9636
  const HAMELN_IDS = new Set([NpcIdentifiers.HAMELN_THE_JESTER_2]); // 9505 (Talk-to)
  const CARL_IDS = new Set([9767]); // slepe Carl with Talk-to
  const MARIA_IDS = new Set([NpcIdentifiers.MARIA_GADDERANKS]); // 9594
  const DESMODUS_IDS = new Set([NpcIdentifiers.DESMODUS_LASIURUS]); // 9588 (world)
  const MORDAN_IDS = new Set([NpcIdentifiers.MORDAN_NIKAZSI]); // 9589 (world)

  const VELIAF_ID = NpcIdentifiers.VELIAF_HURTZ_2; // 5048
  const SAFALAAN_ID = NpcIdentifiers.SAFALAAN_HALLOW_2; // 8216
  const VANESCULA_ID = 9574;
  const VERTIDA_ID = NpcIdentifiers.VERTIDA_SEFALATIS; // 8220
  const KAEL_ID = NpcIdentifiers.KAEL_FORSHAW; // 8230
  const RADIGAD_ID = NpcIdentifiers.RADIGAD_PONFIT; // 5051
  const POLMAFI_ID = NpcIdentifiers.POLMAFI_FERDYGRIS; // 5052
  const IVAN_ID = NpcIdentifiers.IVAN_STROM; // 4440
  const IVAN_ESCORT_ID = NpcIdentifiers.IVAN_STROM_10; // 9536
  const DREZEL_ID = NpcIdentifiers.DREZEL; // 9636
  const HAMELN_ID = NpcIdentifiers.HAMELN_THE_JESTER_2; // 9505
  const CARL_ID = 9767;
  const MARIA_ID = NpcIdentifiers.MARIA_GADDERANKS; // 9594
  const KROY_FIGHT_ID = NpcIdentifiers.KROY_2; // 9560 (lvl 133)
  const DAMIEN_FIGHT_ID = NpcIdentifiers.DAMIEN_LEUCURTE_4; // 9564 (lvl 204)
  const VANSTROM_FIGHT_ID = NpcIdentifiers.VANSTROM_KLAUSE_15; // 9569 (lvl 459)
  const VANSTROM_ENRAGE_ID = NpcIdentifiers.VANSTROM_KLAUSE_17; // 9571 phase two
  const VANSTROM_SCENE_ID = NpcIdentifiers.VANSTROM_KLAUSE_14; // 9568 escape scene
  const SAFALAAN_SCENE_ID = 9539; // escape scene
  const ACIDIC_BLOODVELD_ID = 9573;
  const BLOOD_ORB_OBJECT_ID = 38015;
  const BLOODVELD_ID = 9611; // myq5 mutated bloodveld
  const NAIL_BEAST_IDS = [9612, 9613]; // myq5 nail beasts (lvl 69/141)
  const JUVI_IDS = [9614, 9615]; // myq5 trek juvinates
  const PROP_ID = CARL_ID;
  const TRADER_SVEN_ID = NpcIdentifiers.TRADER_SVEN; // 3779, global world spawn

  // Every NPC this quest spawns owner-only: used to sweep ghosts left by an
  // unclean disconnect, where the old player object (same username) never ran
  // the logout hook and its owner-only spawns stayed in the world unseen.
  const SPAWNED_NPC_IDS = new Set([
    VELIAF_ID, SAFALAAN_ID, VANESCULA_ID, VERTIDA_ID, KAEL_ID, RADIGAD_ID, POLMAFI_ID,
    IVAN_ID, IVAN_ESCORT_ID, DREZEL_ID, HAMELN_ID, CARL_ID, MARIA_ID,
    KROY_FIGHT_ID, DAMIEN_FIGHT_ID, VANSTROM_FIGHT_ID, BLOODVELD_ID,
    ...NAIL_BEAST_IDS, ...JUVI_IDS,
    ACIDIC_BLOODVELD_ID, VANSTROM_SCENE_ID, SAFALAAN_SCENE_ID,
  ]);

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  const IVANDIS_FLAIL_ITEM_ID = ItemIdentifiers.IVANDIS_FLAIL; // 22398
  const DRAKANS_MEDALLION_ITEM_ID = ItemIdentifiers.DRAKANS_MEDALLION; // 22400
  const RUBY_ITEM_ID = ItemIdentifiers.RUBY; // 1603
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const COSMIC_RUNE_ITEM_ID = ItemIdentifiers.COSMIC_RUNE; // 564
  const FIRE_RUNE_ITEM_ID = ItemIdentifiers.FIRE_RUNE; // 554
  const ENCHANT_RUBY_TABLET_ITEM_ID = ItemIdentifiers.ENCHANT_RUBY_OR_TOPAZ; // 8018
  const SILVER_SICKLE_BLESSED_ITEM_ID = ItemIdentifiers.SILVER_SICKLE_B_; // 2963
  const VYREWATCH_ITEM_IDS = [
    ItemIdentifiers.VYREWATCH_TOP, // 9634
    ItemIdentifiers.VYREWATCH_LEGS, // 9636
    ItemIdentifiers.VYREWATCH_SHOES, // 9638
  ];
  const VYRE_NOBLE_UNSCENTED_IDS = [
    ItemIdentifiers.VYRE_NOBLE_TOP_UNSCENTED_, // 24673
    ItemIdentifiers.VYRE_NOBLE_LEGS_UNSCENTED_, // 24674
    ItemIdentifiers.VYRE_NOBLE_SHOES_UNSCENTED_, // 24675
  ];
  const VYRE_NOBLE_SCENTED_IDS = [
    ItemIdentifiers.VYRE_NOBLE_TOP, // 24676
    ItemIdentifiers.VYRE_NOBLE_LEGS, // 24678
    ItemIdentifiers.VYRE_NOBLE_SHOES, // 24680
  ];
  const HAEMALCHEMY_VOL_2_ITEM_ID = ItemIdentifiers.HAEMALCHEMY_VOLUME_2; // 24672
  const OLD_NOTE_ITEM_ID = 24682; // myq5 arboretum note
  const BLISTERWOOD_LOGS_ITEM_ID = ItemIdentifiers.BLISTERWOOD_LOGS; // 24691
  const RUBY_SICKLE_ITEM_ID = ItemIdentifiers.RUBY_SICKLE_B_; // 24693
  const ENCHANTED_RUBY_SICKLE_ITEM_ID = 24695; // myq5 enchanted ruby sickle (b)
  const BLISTERWOOD_SICKLE_ITEM_ID = ItemIdentifiers.BLISTERWOOD_SICKLE; // 24697
  const BLISTERWOOD_FLAIL_ITEM_ID = ItemIdentifiers.BLISTERWOOD_FLAIL; // 24699
  const ENCHANTED_EMERALD_SICKLE_ITEM_ID = ItemIdentifiers.ENCHANTED_EMERALD_SICKLE_B_; // 22435
  const TOME_ITEM_ID = 24690; // myq5 xp tome
  const LONG_VINE_ITEM_ID = 7777; // temple trekking long vine
  const SHORT_VINE_ITEM_ID = 7778; // temple trekking short vine
  const BRONZE_AXE_ITEM_ID = ItemIdentifiers.BRONZE_AXE; // 1351, zombie's axe
  const LOGS_ITEM_ID = ItemIdentifiers.LOGS; // 1511, bridge repair

  // ---------------------------------------------------------------------------
  // Objects (cache ids; names are the cache's own)
  // ---------------------------------------------------------------------------

  const BARREL_OBJECT_ID = 37980; // "Barrel" Inspect (installed over 39515 at Slepe)
  const KROY_TABLE_OP_OBJECT_ID = 37983; // "Lab table" Destroy
  const KROY_TABLE_BROKEN_OBJECT_ID = 37984; // "Broken table"
  const MAUSOLEUM_DOOR_BASE_OBJECT_ID = 39519; // "Mausoleum door" Unlock (map loc)
  const MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID = 38070; // legacy transform, still handled
  const MAUSOLEUM_DOOR_OPEN_OBJECT_ID = 38071; // legacy transform, still handled
  const MAUSOLEUM_DOOR_UNLOCKED_OBJECT_ID = 38072; // captured after the puzzle
  const CRYPT_STAIRS_OBJECT_ID = 32637; // "Stairs" Climb-down at the Slepe church
  const LAB_BOOKSHELF_OBJECT_ID = 38017; // "Bookshelf" Search (vol 2)
  const ARBORETUM_TREE_OBJECT_ID = 37989; // "Blisterwood tree" Chop
  const ARBORETUM_SHELVES_OBJECT_ID = 37999; // "Shelves" Search (old note)
  const VALVE_NORTH_OBJECT_ID = 37997; // "Valve" Turn (+7)
  const VALVE_SOUTH_OBJECT_ID = 37998; // "Valve" Turn (+4)
  // Cache valve menu: script 217 writes the "set the valve to" options into 187:3.
  const VALVE_MENU = 187;
  const VALVE_MENU_CHOICES = 3;
  const VALVE_MENU_SLOTS = 127;
  const VALVE_MAIN_MODAL = (161 << 16) | 16;
  const VALVE_SCRIPT_MAINMODAL_OPEN = 2524;
  const VALVE_SCRIPT_MENU = 217;
  const VALVE_SCRIPT_RESTORE_INPUT = 2158;
  const VALVE_PAUSE_BUTTON = 1;
  const VALVE_MENU_UID = (VALVE_MENU << 16) | VALVE_MENU_CHOICES;
  const ARBORETUM_DOOR_IDS = new Set([39251, 39253]); // "Large door" Open
  const CRACKED_WALL_OBJECT_ID = 39170; // "Cracked wall" Enter
  const BOAT_OBJECT_ID = 38089; // "Boat" Board (installed at both docks)
  const SWAMP_BRANCH_OBJECT_ID = 38004; // "Swamp tree branch" Use long vine
  const SWAMP_TREE_OBJECT_ID = 38005; // "Swamp tree branch" Swing-from
  const SWAMP_VINES_OBJECT_ID = 13847; // templetrek_swamptree_small_vines
  const SWAMP_RUCKSACK_OBJECT_ID = 13872; // templetrek_swing_rucksack
  const DEAD_TREE_OBJECT_ID = 1365; // deadtree2_swamp
  const BRIDGE_OBJECT_IDS = [13834, 13835, 13836, 13837]; // broken, fixed 1-3
  const ZOMBIE_NPC_ID = 5647; // templetrek_zombie
  const CARL_FOLLOW_NPC_ID = 9558; // myq5_carl_follow
  const CARL_FOLLOW_START = { x: 3748, y: 3310, z: 0 }; // capture 1637 tick 1164
  // Actual NPC 9558 spawn + walk updates from capture 1637 ticks 1164-1504.
  const CAPTURED_CARL_ROUTE = [
    { x: 3748, y: 3310 },
    { x: 3748, y: 3311 },
    { x: 3748, y: 3312 },
    { x: 3748, y: 3313 },
    { x: 3748, y: 3314 },
    { x: 3748, y: 3315 },
    { x: 3748, y: 3316 },
    { x: 3748, y: 3317 },
    { x: 3748, y: 3318, lookBack: true, lookBackTicks: 15 },
    { x: 3748, y: 3319 },
    { x: 3747, y: 3320 },
    { x: 3747, y: 3321 },
    { x: 3747, y: 3322 },
    { x: 3746, y: 3323 },
    { x: 3746, y: 3324 },
    { x: 3745, y: 3325 },
    { x: 3744, y: 3326 },
    { x: 3743, y: 3327 },
    { x: 3742, y: 3328 },
    { x: 3741, y: 3328 },
    { x: 3740, y: 3328 },
    { x: 3739, y: 3328 },
    { x: 3738, y: 3328 },
    { x: 3737, y: 3328 },
    { x: 3736, y: 3328 },
    { x: 3735, y: 3328 },
    { x: 3734, y: 3328, lookBack: true, lookBackTicks: 15 },
    { x: 3733, y: 3328 },
    { x: 3732, y: 3327 },
    { x: 3731, y: 3326 },
    { x: 3730, y: 3326 },
    { x: 3729, y: 3325 },
    { x: 3728, y: 3325 },
    { x: 3727, y: 3324 },
    { x: 3726, y: 3324 },
    { x: 3725, y: 3324 },
    { x: 3724, y: 3324 },
    { x: 3723, y: 3324 },
    { x: 3722, y: 3324 },
    { x: 3721, y: 3325 },
    { x: 3720, y: 3326 },
    { x: 3719, y: 3327 },
    { x: 3718, y: 3327 },
    { x: 3717, y: 3328 },
    { x: 3716, y: 3328 },
    { x: 3715, y: 3328 },
    { x: 3714, y: 3328, lookBack: true, lookBackTicks: 15 },
    { x: 3713, y: 3328 },
    { x: 3712, y: 3328 },
    { x: 3711, y: 3328 },
    { x: 3710, y: 3327 },
    { x: 3709, y: 3326 },
    { x: 3708, y: 3325 },
    { x: 3707, y: 3324 },
    { x: 3706, y: 3324 },
    { x: 3705, y: 3324 },
    { x: 3704, y: 3324 },
    { x: 3703, y: 3323 },
    { x: 3702, y: 3322 },
    { x: 3702, y: 3321 },
    { x: 3702, y: 3320 },
    { x: 3702, y: 3319, lookBack: true, lookBackTicks: 15 },
    { x: 3702, y: 3318 },
    { x: 3703, y: 3317 },
    { x: 3703, y: 3316 },
    { x: 3703, y: 3315 },
    { x: 3703, y: 3314 },
    { x: 3703, y: 3313 },
    { x: 3703, y: 3312 },
    { x: 3704, y: 3311 },
    { x: 3705, y: 3311 },
    { x: 3706, y: 3311 },
    { x: 3707, y: 3311 },
    { x: 3708, y: 3311 },
    { x: 3709, y: 3311 },
    { x: 3710, y: 3312 },
    { x: 3711, y: 3313 },
    { x: 3712, y: 3313 },
    { x: 3713, y: 3313 },
    { x: 3714, y: 3313 },
    { x: 3715, y: 3314 },
    { x: 3716, y: 3315 },
    { x: 3717, y: 3316 },
    { x: 3718, y: 3317 },
    { x: 3719, y: 3317 },
    { x: 3720, y: 3317 },
    { x: 3721, y: 3317 },
    { x: 3722, y: 3317, lookBack: true, lookBackTicks: 15 },
    { x: 3723, y: 3317 },
    { x: 3724, y: 3317 },
    { x: 3725, y: 3317 },
    { x: 3726, y: 3317 },
    { x: 3727, y: 3317 },
    { x: 3728, y: 3317 },
    { x: 3729, y: 3317 },
    { x: 3730, y: 3317 },
    { x: 3731, y: 3316 },
    { x: 3732, y: 3315 },
    { x: 3732, y: 3314 },
    { x: 3732, y: 3313 },
    { x: 3733, y: 3312 },
    { x: 3733, y: 3311 },
    { x: 3733, y: 3310 },
    { x: 3733, y: 3309 },
    { x: 3732, y: 3308 },
    { x: 3731, y: 3308 },
    { x: 3730, y: 3308 },
    { x: 3729, y: 3308 },
    { x: 3728, y: 3307 },
    { x: 3728, y: 3306 },
    { x: 3728, y: 3305 },
    { x: 3728, y: 3304 },
  ];

  const CARL_FOLLOW_FAIL_DISTANCE = 14;
  const CARL_VIEW_RANGE = 10;
  const CARL_LOOKBACK_TICKS = 15; // capture 1637: every look-back pauses for 15 ticks
  const HIDEOUT_CRATE_OBJECT_ID = 32575; // actual cache Crate, Search (Old Man Ral's base)
  const DISGUISE_CHEST_CLOSED_ID = 37986; // "Closed Chest" Open
  const DISGUISE_CHEST_OPEN_ID = 37987; // "Open Chest" Search/Shut
  const DISGUISE_CHEST_TILE = { x: 3600, y: 9617, z: 0 };
  const LAB_ESCAPE_GATE_ID = 37992; // "Gate" Escape (Kroy's lab)
  const SLEPE_ROWBOAT_OBJECT_ID = 32602; // cache "Row boat" Travel at Slepe

  // ---------------------------------------------------------------------------
  // Captured camera tracks (RSProx 1637, rev 226.1)
  // Each entry is [tick offset, move, look, optional rates]; null move resets.
  // ---------------------------------------------------------------------------

  const CAMERA_CARL_FOLLOW = [
    [0, [3758, 3289, 710], [3749, 3292, 160]],
    [22, [3756, 3297, 700], [3751, 3306, 150]],
    [38, [3747, 3307, 600], [3756, 3307, 50]],
    [43, null],
  ];
  const CAMERA_CRYPT_KROY = [
    [0, [3728, 3300, 700], [3728, 3303, 10]],
    [15, [3728, 9742, 620], [3728, 9768, 100]],
    [16, [3728, 9749, 620], [3728, 9768, 100], { rate: 2, rate2: 0 }],
    [50, [3724, 9747, 820], [3729, 9747, 120]],
    [59, [3728, 9751, 720], [3728, 9760, 140]],
    [154, [3730, 9764, 420], [3728, 9755, 220]],
    [174, null],
  ];
  const CAMERA_PATERDOMUS_MEETING = [
    [5, [3541, 3514, 710], [3550, 3518, 160]],
    [16, [3525, 3500, 610], [3538, 3494, 110]],
    [43, [3541, 3514, 710], [3550, 3518, 160]],
    [50, [3544, 3508, 710], [3548, 3521, 160], { rate: 3, rate2: 0 }],
    [103, null],
  ];
  const CAMERA_GRAVEYARD_MEETING = [
    [0, [3690, 3185, 550], [3690, 3196, 50]],
    [0, [3690, 3179, 550], [3690, 3196, 50], { rate: 2, rate2: 0 }],
    [15, [3699, 3187, 500], [3686, 3187, 200]],
    [44, null],
  ];
  const CAMERA_MAUSOLEUM = [
    [0, [3704, 3195, 790], [3704, 3192, 90]],
    [58, null],
  ];
  const CAMERA_LAB = [
    [9, [3610, 9730, 900], [3610, 9738, 100]],
    [35, null],
  ];
  const CAMERA_DAMIEN = [
    [5, [3725, 3357, 520], [3718, 3357, 100]],
    [25, [3719, 3358, 600], [3722, 3357, 10]],
    [30, [3722, 3354, 400], [3716, 3361, 10]],
    [47, [3714, 3357, 500], [3721, 3357, 0]],
    [54, null],
  ];
  const CAMERA_PRISON = [
    [5, [3622, 3379, 600], [3617, 3379, 10]],
    [24, [3617, 3375, 600], [3618, 3380, 0]],
    [67, null],
  ];
  const CAMERA_CASTLE = [
    [11, [3589, 3358, 500], [3574, 3358, 400]],
    [12, [3581, 3358, 500], [3566, 3358, 400], { rate: 2, rate2: 0 }],
    [19, [3580, 3358, 1200], [3565, 3358, 400], { rate: 2, rate2: 0 }],
    [34, [3570, 3358, 500], [3572, 3358, 400]],
    [34, [3566, 3358, 500], [3572, 3358, 400], { rate: 2, rate2: 0 }],
    [44, [3567, 3362, 500], [3571, 3356, 400], { rate: 2, rate2: 0 }],
    [74, [3568, 3358, 740], [3561, 3358, 130]],
    [89, [3579, 3358, 740], [3561, 3358, 130], { rate: 1, rate2: 0 }],
    [152, [3570, 3350, 500], [3570, 3366, 400]],
    [155, [3570, 3350, 500], [3575, 3366, 400], { rate: 1, rate2: 0 }],
    [162, [3570, 3350, 500], [3566, 3366, 400], { rate: 1, rate2: 0 }],
    [174, [3570, 3350, 500], [3570, 3366, 400], { rate: 1, rate2: 0 }],
    [187, [3570, 3350, 500], [3567, 3366, 400], { rate: 1, rate2: 0 }],
    [208, [3578, 3358, 640], [3565, 3358, 40]],
    [208, [3581, 3358, 640], [3565, 3358, 40], { rate: 1, rate2: 0 }],
    [227, [3574, 3353, 500], [3575, 3358, 100]],
    [234, [3572, 3351, 500], [3572, 3366, 400]],
    [253, [3581, 3358, 640], [3565, 3358, 10]],
    [259, null],
  ];
  const CAMERA_ESCAPE = [
    [4, [3570, 3365, 500], [3570, 3350, 400]],
    [28, [3567, 3358, 500], [3584, 3358, 400]],
    [33, [3570, 3365, 500], [3570, 3350, 400]],
    [55, [3567, 3358, 500], [3584, 3358, 400]],
    [68, [3580, 3358, 2100], [3570, 3358, 10]],
  ];
  const CAMERA_HIDEOUT = [
    [0, [3594, 9613, 500], [3601, 9613, 10]],
    [40, null],
  ];

  // ---------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------

  const VELIAF_SLEPE_TILE = { x: 3729, y: 3318, z: 0 };
  const HAMELN_CHURCH_TILE = { x: 3736, y: 3316, z: 0 };
  const CARL_PUB_TILE = { x: 3749, y: 3298, z: 0 };
  const BARREL_TILE = { x: 3749, y: 3291, z: 0 };
  const CRYPT_LANDING = { x: 3738, y: 9703, z: 1 }; // canonical church crypt ladder landing
  const KROY_ARRIVAL = { x: 3728, y: 9742, z: 1 }; // captured crypt cutscene arrival
  const KROY_LAB_TILE = { x: 3727, y: 9759, z: 1 };
  const KROY_TABLE_TILES = [
    { x: 3729, y: 9760, z: 1, rotation: 0 },
    { x: 3725, y: 9759, z: 1, rotation: 3 },
  ];
  const DREZEL_TEMPLE_TILE = { x: 3439, y: 9896, z: 0 };
  const VELIAF_PATERDOMUS_TILE = { x: 3440, y: 9897, z: 0 };
  const IVAN_MEETING_TILE = { x: 3548, y: 3516, z: 0 };
  const VELIAF_WOODS_TILE = { x: 3549, y: 3517, z: 0 };
  const IVAN_TREK_TILE = { x: 3444, y: 3485, z: 0 };
  const TREK_START = { x: 3445, y: 3412, z: 0 };
  const TREK_TREE_TILE = { x: 3442, y: 3408, z: 0 };
  const TREK_CROSSED = { x: 3437, y: 3402, z: 0 };
  const TREK_RUCKSACK_TILE = { x: 3446, y: 3411, z: 0 };
  const BRIDGE_TILE = { x: 3439, y: 3400, z: 0, rotation: 1 };
  const DEAD_TREE_TILE = { x: 3441, y: 3403, z: 0 };
  const ZOMBIE_TILE = { x: 3442, y: 3398, z: 0 };
  // Capture 1637: player encounter start 2334,5005; 9612 add at (-2,+3) and
  // 9613 add at (-6,+5).  Source post-vine corridor anchor 3438,3398 maps
  // those to dry, melee-reachable 3436,3401 and 3432,3403 (old tiles were water).
  const TREK_NAIL_TILES = [
    { x: 3436, y: 3401, z: 0 },
    { x: 3432, y: 3403, z: 0 },
  ];
  const TREK_JUVI_TILES = [
    { x: 3426, y: 3390, z: 0 },
    { x: 3424, y: 3388, z: 0 },
  ];
  const BURGH_DOCKS = { x: 3523, y: 3169, z: 0 };
  // The boat is anchored in the water, so its map anchor cannot be used as a
  // player landing tile.  The first clear shore tile east of the dock connects
  // to Burgh de Rott's normal paths.
  const BURGH_LANDING = { x: 3529, y: 3169, z: 0 };
  const IVAN_BOATHOUSE_TILE = { x: 3530, y: 3169, z: 0 };
  const VELIAF_BOATHOUSE_TILE = { x: 3529, y: 3168, z: 0 };
  const ICYENE_DOCK = { x: 3696, y: 3198, z: 0 };
  const ICYENE_LANDING = { x: 3696, y: 3199, z: 0 };
  const GRAVEYARD_VELIAF_TILE = { x: 3689, y: 3182, z: 0 };
  const GRAVEYARD_SAFALAAN_TILE = { x: 3707, y: 3186, z: 0 };
  const GRAVEYARD_VANESCULA_TILE = { x: 3705, y: 3189, z: 0 };
  const GRAVEYARD_VERTIDA_TILE = { x: 3697, y: 3186, z: 0 };
  const GRAVEYARD_KAEL_TILE = { x: 3686, y: 3186, z: 0 };
  const GRAVEYARD_RADIGAD_TILE = { x: 3690, y: 3189, z: 0 };
  const GRAVEYARD_POLMAFI_TILE = { x: 3705, y: 3182, z: 0 };
  const GRAVEYARD_IVAN_TILE = { x: 3696, y: 3181, z: 0 };
  const MAUSOLEUM_DOOR_TILE = { x: 3704, y: 3190, z: 0, rotation: 3 };
  const MAUSOLEUM_INSIDE = { x: 3704, y: 3191, z: 0 };

  // Kakurasu lock (capture: interface 665, col sums 19-23, row sums 26-30,
  // dynamic OP1 buttons 0-24 under component 32).
  const TOMB_PUZZLE_GROUP = 665;
  const TOMB_PUZZLE_OVERLAY = (161 << 16) | 16; // captured modal target
  const TOMB_PUZZLE_BUTTONS = (TOMB_PUZZLE_GROUP << 16) | 32;
  const TOMB_PUZZLE_COLUMNS = [19, 20, 21, 22, 23];
  const TOMB_PUZZLE_ROWS = [26, 27, 28, 29, 30];
  const TOMB_PUZZLE_SIZE = 5;
  const SAFALAAN_WALK_TILE = { x: 3696, y: 3204, z: 0 };
  const HIDEOUT_VERTIDA_TILE = { x: 3599, y: 9611, z: 0 };
  const HIDEOUT_IVAN_TILE = { x: 3598, y: 9613, z: 0 };
  const HIDEOUT_POLMAFI_TILE = { x: 3601, y: 9612, z: 0 };
  const LAB_SAFALAAN_TILE = { x: 3611, y: 9737, z: 0 };
  const LAB_BLOODVELD_TILE = { x: 3600, y: 9740, z: 0 };
  const DAMIEN_MANOR_TILE = { x: 3718, y: 3358, z: 1 };
  const PRISON_MARIA_TILE = { x: 3618, y: 3377, z: 0 };
  const DARKMEYER_ARRIVAL = { x: 3627, y: 3332, z: 0 };
  const CRACK_MEIYERDITCH = { x: 3627, y: 3328, z: 0 };
  const CASTLE_ARENA = { x: 3565, y: 3362, z: 0 };
  const BURGH_HIDEOUT = { x: 3494, y: 9628, z: 0 };
  const VER_SINHAZA = { x: 3663, y: 3220, z: 0 };
  const DARKMEYER = { x: 3597, y: 3360, z: 0 };
  const SLEPE_DOCK = { x: 3666, y: 3279, z: 0 }; // walkable shore beside the cache rowboat

  // ---------------------------------------------------------------------------
  // Persisted state helpers
  // ---------------------------------------------------------------------------

  let quest;
  const spawnedByPlayer = new Map();
  const tombPuzzleByPlayer = new WeakMap();
  const valveMenus = new WeakMap();
  const vanstromFights = new WeakMap();
  const vanstromNpcMeta = new WeakMap();
  const carlFollowSessions = new WeakMap();
  const carlFailureActors = new WeakMap();
  const personalObjects = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
  }

  function give(player, itemId, amount = 1) {
    if (amount <= 0) return true;
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    if (hasBit(player, bit)) return;
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function field(player, shift, width = 2) {
    return (bits(player) >> shift) & ((1 << width) - 1);
  }

  function setField(player, shift, width, value) {
    const mask = ((1 << width) - 1) << shift;
    player.setAttribute(BITS_ATTRIBUTE, (bits(player) & ~mask) | ((value & ((1 << width) - 1)) << shift));
  }

  function convincedMask(player) {
    return bits(player) & CONVINCED_MASK;
  }

  /** Sets a Myreque member's convinced bit and re-sends its cache varbit mirror. */
  function setConvinced(player, bit) {
    setBit(player, bit);
    syncVisuals(player);
  }

  const allConvinced = (player) => convincedMask(player) === CONVINCED_MASK;

  function near(player, spot, radius = 8) {
    const location = player.getLocation();
    return Math.max(Math.abs(location.getX() - spot.x), Math.abs(location.getY() - spot.y)) <= radius;
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface((161 << 16) | 1, 174, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 80] : [0, 0, 0, 255, 80] }],
    });
  }

  function playCamera(player, shots) {
    Scenes.cancel(player);
    for (const [ticks, move, look, rates] of shots) {
      Scenes.later(player, ticks, () => {
        if (player.isRegistered?.() === false) return;
        if (!move) player.getPacketSender().sendCameraReset();
        else Scenes.camera(player, move, look, rates);
      });
    }
  }

  function resetCamera(player) {
    Scenes.cancel(player);
    player.getPacketSender().sendCameraReset();
  }

  function beginCastleFight(player) {
    if (quest.getStage(player) < STAGE_CASTLE) advance(player, STAGE_CASTLE);
    teleport(player, CASTLE_ARENA);
    playCamera(player, CAMERA_CASTLE);
    later(player, 1, () =>
      play(player, VANSTROM_FIGHT_ID, "a-bloody-show-face-to-face-with-the-lord-of-vampyrium")
    );
  }

  function later(player, ticks, fn) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      fn();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, ticks, () => {
        if (player.isRegistered?.() === false) return;
        fn();
      })
    );
  }

  /** A standalone transcript replay can lead with a wiki navigation jump; skip it. */
  function withoutLeadingJumps(steps) {
    if (!Array.isArray(steps)) return steps;
    let start = 0;
    while (start < steps.length && steps[start]?.type === "jump") start++;
    return start > 0 ? steps.slice(start) : steps;
  }

  function play(player, npcId, variant, npc = null) {
    return startTranscript(api, player, npcId, PAGE, variant, withoutLeadingJumps, npc);
  }

  function say(player, npcId, text) {
    startDialogue(api, player, { npcId }, [{ npc: [text] }]);
  }

  // The wiki transcript leaves three blanks the data export kept literal.
  function vampyreName(player) {
    const stored = player.getAttribute(VAMPYRE_NAME_ATTRIBUTE);
    if (typeof stored === "string" && stored.length > 0) return stored;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const name = `${pick(VAMPYRE_FIRST_NAMES)} ${pick(VAMPYRE_LAST_NAMES)}`;
    player.setAttribute(VAMPYRE_NAME_ATTRIBUTE, name);
    return name;
  }

  function fillTranscriptText(event) {
    const { player } = event;
    if (!player || typeof event.text !== "string") return;
    let text = event.text;
    if (text.includes("[vampyre name]")) {
      text = text.replace(/\[vampyre name\]/gi, vampyreName(player));
    }
    if (text.includes("[does he/does she/do they]")) {
      const male = player.getAppearance?.()?.isMale?.() !== false;
      text = text.replace(/\[does he\/does she\/do they\]/gi, male ? "does he" : "does she");
    }
    if (text.includes("[He/She/They]")) {
      const male = player.getAppearance?.()?.isMale?.() !== false;
      text = text.replace(/\[He\/She\/They\]/g, male ? "He" : "She");
    }
    event.text = text;
  }

  /** Trader Sven's shop is global; the quest only records that he was met. */
  function handleNpcLine(event) {
    const { player, npcId } = event;
    if (!player) return;
    if (
      quest.getStage(player) === STAGE_PUZZLE_DONE &&
      /inform the others/i.test(String(event.text ?? ""))
    ) {
      advance(player, STAGE_CONVINCING);
    }
    if (npcId !== TRADER_SVEN_ID) return;
    if (quest.getStage(player) < STAGE_DISGUISE_BRIEF) return;
    if (hasBit(player, BIT_SVEN)) return;
    setBit(player, BIT_SVEN);
    syncVisuals(player);
  }

  // ---------------------------------------------------------------------------
  // Requirements
  // ---------------------------------------------------------------------------

  const REQUIRED_QUESTS = [
    { key: "vampyre_slayer", name: "Vampyre Slayer" },
    { key: PREREQUISITE_KEY, name: "A Taste of Hope" },
  ];
  const REQUIRED_SKILLS = [
    { skill: Skill.WOODCUTTING, level: 62, label: "Woodcutting" },
    { skill: Skill.FLETCHING, level: 60, label: "Fletching" },
    { skill: Skill.CRAFTING, level: 56, label: "Crafting" },
    { skill: Skill.AGILITY, level: 52, label: "Agility" },
    { skill: Skill.ATTACK, level: 50, label: "Attack" },
    { skill: Skill.SLAYER, level: 50, label: "Slayer" },
    { skill: Skill.MAGIC, level: 49, label: "Magic" },
  ];

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questStarted(player, key) {
    const request = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  /**
   * A Taste of Hope owns the old-base Vertida's post-quest flail reclaim, and
   * it answers this question through "taste-of-hope:flail-reclaim". Sins
   * keeps its own Vertida conversation while the crafting steps (the logs and
   * the flail handover) still need it, then yields the talk so a completed
   * Taste player can still buy a replacement flail during the quest.
   */
  function tasteFlailReclaimDue(player, npc) {
    const request = { player, npc, needed: false };
    api.emitCustomEvent("taste-of-hope:flail-reclaim", request);
    if (!request.needed) return false;
    if (quest.getStage(player) < STAGE_SAFALAAN_WALK) return false;
    const spot = npc?.getLocation?.() ?? player.getLocation?.();
    if (!spot) return false;
    return Math.max(Math.abs(spot.getX() - HIDEOUT_VERTIDA_TILE.x),
      Math.abs(spot.getY() - HIDEOUT_VERTIDA_TILE.y)) <= 3;
  }

  function meetsRequirements(player) {
    if (!REQUIRED_QUESTS.every((requirement) => questComplete(player, requirement.key))) return false;
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.every((entry) => skills.getMaxLevel(entry.skill) >= entry.level);
  }

  function requirementsMessage(player) {
    for (const requirement of REQUIRED_QUESTS) {
      if (!questComplete(player, requirement.key)) {
        player.sendMessage(`You must have completed ${requirement.name} to start this quest.`);
      }
    }
    const skills = player.getSkillManager();
    for (const entry of REQUIRED_SKILLS) {
      if (skills.getMaxLevel(entry.skill) < entry.level) {
        player.sendMessage(`You need ${entry.level} ${entry.label} to start this quest.`);
      }
    }
  }

  function combatLevel(player) {
    const skills = player.getSkillManager();
    const level = (skill) => skills.getMaxLevel(skill);
    const base = 0.25 * (level(Skill.DEFENCE) + level(Skill.HITPOINTS) + Math.floor(level(Skill.PRAYER) / 2));
    const melee = 0.325 * (level(Skill.ATTACK) + level(Skill.STRENGTH));
    const ranged = 0.325 * Math.floor(level(Skill.RANGED) * 1.5);
    const magic = 0.325 * Math.floor(level(Skill.MAGIC) * 1.5);
    return Math.floor(base + Math.max(melee, ranged, magic));
  }

  // ---------------------------------------------------------------------------
  // Inventory helpers
  // ---------------------------------------------------------------------------

  const hasVyreNoble = (player) =>
    VYRE_NOBLE_UNSCENTED_IDS.every((id) => held(player, id)) || VYRE_NOBLE_SCENTED_IDS.every((id) => held(player, id));
  const hasVyrewatchOutfit = (player) => VYREWATCH_ITEM_IDS.every((id) => held(player, id));
  const hasBlisterwoodFlail = (player) => held(player, BLISTERWOOD_FLAIL_ITEM_ID);
  const logCount = (player) => player.getInventory().getAmount(BLISTERWOOD_LOGS_ITEM_ID);

  function isAxe(itemId) {
    const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "");
    return /(^| )axe$/i.test(name);
  }

  function hasAxe(player) {
    const inventory = player.getInventory();
    for (let slot = 0; slot < 28; slot++) {
      const item = inventory.get(slot);
      if (item && isAxe(item.getId())) return true;
    }
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return Boolean(weapon && isAxe(weapon.getId()));
  }

  function hasKnife(player) {
    return held(player, KNIFE_ITEM_ID) ||
      player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === KNIFE_ITEM_ID;
  }

  function swapOutfit(player, fromIds, toIds) {
    for (const id of fromIds) {
      while (player.getInventory().getAmount(id) > 0) player.getInventory().deleteNumber(id, 1);
    }
    for (const id of toIds) give(player, id, 1);
  }

  function bridgeRepairs(player) {
    return Math.max(0, Math.min(3, Number(player.getAttribute(BRIDGE_ATTRIBUTE)) || 0));
  }

  function setBridgeRepairs(player, value) {
    player.setAttribute(BRIDGE_ATTRIBUTE, Math.max(0, Math.min(3, value | 0)));
  }

  function requiredGallons(player) {
    const stored = field(player, GALLONS_SHIFT, 6);
    if (stored > 0) return stored;
    const north = Math.floor(Math.random() * 6);
    const south = Math.floor(Math.random() * 6);
    const gallons = 7 * north + 4 * south || 4;
    setField(player, GALLONS_SHIFT, 6, gallons);
    return gallons;
  }

  function waterTotal(player) {
    return 7 * field(player, VALVE_NORTH_SHIFT, 3) + 4 * field(player, VALVE_SOUTH_SHIFT, 3);
  }

  // ---------------------------------------------------------------------------
  // Owner-only spawns
  // ---------------------------------------------------------------------------

  function spawnKey(player, key, npcId, tile) {
    if (!player) return;
    let map = spawnedByPlayer.get(player);
    if (!map) {
      map = new Map();
      spawnedByPlayer.set(player, map);
    }
    const existing = map.get(key);
    if (existing) {
      if (
        existing.getId?.() === npcId &&
        existing.getLocation?.().equals?.(new Location(tile.x, tile.y, tile.z))
      ) {
        return;
      }
      api.removeNpc(existing);
      map.delete(key);
    }
    const npc = api.spawnNpc({
      id: npcId,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) map.set(key, npc);
    return npc;
  }

  function despawnKey(player, key) {
    const map = spawnedByPlayer.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  function despawnAll(player) {
    const map = spawnedByPlayer.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    map.clear();
    spawnedByPlayer.delete(player);
  }

  /**
   * A force-dropped session never runs the logout hook, so its owner-only spawns
   * survive into the next login as invisible-duplicate NPCs for the same account.
   * Login sweeps any of this quest's owner-only NPCs held by another object with
   * the same username before respawning.
   */
  function sweepStaleOwnedNpcs(player) {
    const username = String(player.getUsername?.() ?? "").toLowerCase();
    if (!username) return;
    const World = api.core.World;
    if (typeof World?.getNpcs !== "function") return;
    for (const npc of World.getNpcs()) {
      if (!npc || npc.isOwnerOnly?.() !== true || !SPAWNED_NPC_IDS.has(npc.getId?.())) continue;
      const owner = npc.getOwner?.();
      if (!owner || owner === player) continue;
      if (String(owner.getUsername?.() ?? "").toLowerCase() !== username) continue;
      api.removeNpc(npc);
    }
  }

  function spawnAt(player, key, npcId, tile, from, to) {
    const stage = quest.getStage(player);
    if (stage >= from && stage < to) spawnKey(player, key, npcId, tile);
    else despawnKey(player, key);
  }

  // Carl's town follow: captured Quest Helper line points joined on the real
  // collision map, so the required leg is walked rather than skipped.
  let carlRouteCache;
  function carlRoute() {
    return CAPTURED_CARL_ROUTE;
  }

  function removeCarlFollow(player) {
    const session = carlFollowSessions.get(player);
    if (!session) return;
    carlFollowSessions.delete(player);
    if (session.npc) api.removeNpc(session.npc);
  }
  function carlProgress(player) {
    return Math.max(0, Number(player.getAttribute(CARL_PROGRESS_ATTRIBUTE)) || 0);
  }
  function startCarlFollow(player) {
    removeCarlFollow(player);
    const route = carlRoute();
    const index = Math.min(route.length - 1, carlProgress(player));
    const start = route[index];
    const npc = api.spawnNpc({
      id: CARL_FOLLOW_NPC_ID, x: start.x, y: start.y, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    if (!npc) return;
    carlFollowSessions.set(player, {
      npc, route, index, stuck: 0, grace: 2, lookBackTicks: 0, facing: [1, 0],
      lastX: start.x, lastY: start.y,
    });
  }
  function failCarlFollow(player, caught) {
    const session = carlFollowSessions.get(player);
    if (!session) return;
    carlFollowSessions.delete(player);
    const failureActors = carlFailureActors.get(player) ?? new Set();
    failureActors.add(session.npc);
    carlFailureActors.set(player, failureActors);
    player.setAttribute(CARL_PROGRESS_ATTRIBUTE, 0);
    quest.setStage(player, STAGE_HAMELN);
    applyStageSpawns(player);
    syncQuestObjects(player);
    play(player, PROP_ID, caught
      ? "plague-s-end-if-caught-by-carl"
      : "plague-s-end-if-the-player-falls-too-far-behind-carl", session.npc);
    later(player, 3, () => {
      if (!failureActors.delete(session.npc)) return;
      if (!failureActors.size) carlFailureActors.delete(player);
      api.removeNpc(session.npc);
    });
  }
  /**
   * RSMOD/RegionManager ray: each Bresenham step must be traversable, so wall
   * and prop edge clipping blocks sight, not just blocked destination tiles.
   */
  function carlLineBlocked(from, to) {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    let previous = from;
    for (let step = 1; step <= steps; step++) {
      const x = Math.round(from.x + (to.x - from.x) * step / steps);
      const y = Math.round(from.y + (to.y - from.y) * step / steps);
      if (RegionManager.canMove(previous.x, previous.y, x, y, 0, 1, 1, null) === false) return true;
      previous = { x, y };
    }
    return false;
  }
  function carlSees(player, guard, facing) {
    const here = player.getLocation();
    const dx = here.getX() - guard.getX(), dy = here.getY() - guard.getY();
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (distance > CARL_VIEW_RANGE) return false;
    if (facing[0] * dx + facing[1] * dy <= 0) return false;
    return !carlLineBlocked(guard, { x: here.getX(), y: here.getY() });
  }
  function tickCarlFollow(player, session) {
    const npc = session.npc;
    if (!npc || quest.getStage(player) !== STAGE_FOLLOWING || hasBit(player, BIT_TRAIL)) {
      removeCarlFollow(player);
      return;
    }
    const guard = npc.getLocation();
    const here = player.getLocation();
    const distance = Math.max(Math.abs(here.getX() - guard.getX()), Math.abs(here.getY() - guard.getY()));
    if (session.grace > 0) {
      session.grace--;
    } else if (distance <= 1) {
      failCarlFollow(player, true);
      return;
    } else if (distance > CARL_FOLLOW_FAIL_DISTANCE) {
      failCarlFollow(player, false);
      return;
    }
    if (session.lookBackTicks > 0) {
      if (session.grace === 0 && carlSees(player, guard, session.facing)) {
        failCarlFollow(player, true);
        return;
      }
      session.lookBackTicks--;
      return;
    }
    const target = session.route[session.index];
    if (!target) {
      setBit(player, BIT_TRAIL);
      player.setAttribute(CARL_PROGRESS_ATTRIBUTE, 0);
      removeCarlFollow(player);
      player.sendMessage("You follow Carl to the crypt. You can now go down the stairs.");
      return;
    }
    if (guard.getX() === target.x && guard.getY() === target.y) {
      const previous = session.route[session.index - 1] ?? target;
      session.index++;
      player.setAttribute(CARL_PROGRESS_ATTRIBUTE, session.index);
      session.stuck = 0;
      if (target.lookBack && session.grace === 0) {
        const fx = Math.sign(previous.x - target.x), fy = Math.sign(previous.y - target.y);
        session.facing = fx || fy ? [fx, fy] : [1, 0];
        session.lookBackTicks = target.lookBackTicks ?? CARL_LOOKBACK_TICKS;
        npc.setPositionToFace(new Location(target.x + session.facing[0], target.y + session.facing[1], 0));
        return;
      }
      const next = session.route[session.index];
      if (next) npc.getMovementQueue().addFirstStep(new Location(next.x, next.y, 0));
      return;
    }
    if (guard.getX() === session.lastX && guard.getY() === session.lastY) session.stuck++;
    else { session.stuck = 0; session.lastX = guard.getX(); session.lastY = guard.getY(); }
    if (npc.getMovementQueue().hasPendingWork()) {
      if (session.stuck > 8) npc.getMovementQueue().reset();
      else return;
    }
    if (session.stuck > 8) npc.moveTo(new Location(target.x, target.y, 0));
    else npc.getMovementQueue().addFirstStep(new Location(target.x, target.y, 0));
  }

  /** Slepe follow is area-scoped, not a global every-player process hook. */
  class CarlFollowArea extends Area {
    constructor() {
      super([new Boundary(3690, 3760, 3280, 3340, 0)]);
    }
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const session = carlFollowSessions.get(mobile);
      if (session) tickCarlFollow(mobile, session);
    }
  }

  /** Keeps exactly the quest NPCs the current stage needs present. */
  function applyStageSpawns(player) {
    if (!player) return;
    const stage = quest.getStage(player);
    spawnAt(player, "veliaf_slepe_start", VELIAF_ID, VELIAF_SLEPE_TILE, STAGE_UNSTARTED, STAGE_VELIAF_REPORTED);
    spawnAt(player, "veliaf_pater", VELIAF_ID, VELIAF_PATERDOMUS_TILE, STAGE_VELIAF_REPORTED, STAGE_PATERDOMUS);
    spawnAt(player, "veliaf_woods", VELIAF_ID, VELIAF_WOODS_TILE, STAGE_PATERDOMUS, STAGE_MEETING);
    spawnAt(player, "veliaf_boat", VELIAF_ID, VELIAF_BOATHOUSE_TILE, STAGE_ESCORT_DONE, STAGE_GRAVEYARD);
    spawnAt(player, "veliaf_grave_main", VELIAF_ID, GRAVEYARD_VELIAF_TILE, STAGE_GRAVEYARD, STAGE_DISGUISE_READY);
    spawnAt(player, "veliaf_slepe_damien", VELIAF_ID, VELIAF_SLEPE_TILE, STAGE_DISGUISE_READY, STAGE_DARKMEYER_PLAN);
    spawnAt(player, "veliaf_grave_late", VELIAF_ID, GRAVEYARD_VELIAF_TILE, STAGE_DARKMEYER_PLAN, STAGE_VANSTROM_DEAD);
    spawnAt(player, "drezel", DREZEL_ID, DREZEL_TEMPLE_TILE, STAGE_VELIAF_REPORTED, STAGE_MEETING);
    spawnAt(player, "ivan_meet", IVAN_ID, IVAN_MEETING_TILE, STAGE_PATERDOMUS, STAGE_MEETING);
    spawnAt(player, "ivan_start", IVAN_ESCORT_ID, IVAN_TREK_TILE, STAGE_MEETING, STAGE_ESCORT);
    spawnAt(player, "ivan_boat", IVAN_ID, IVAN_BOATHOUSE_TILE, STAGE_ESCORT_DONE, STAGE_GRAVEYARD);
    spawnAt(player, "ivan_grave", IVAN_ID, GRAVEYARD_IVAN_TILE, STAGE_GRAVEYARD, STAGE_VANSTROM_DEAD);
    // The escape conversation completes the quest; keep Ivan at the hideout while
    // the finale is unfinished so a relog mid-conversation can pick it back up.
    spawnAt(player, "ivan_escape", IVAN_ID, BURGH_HIDEOUT, STAGE_VANSTROM_DEAD, STAGE_COMPLETE);
    // The wiki item page: lost tomes are reclaimed from Ivan in Old Man Ral's
    // house in Meiyerditch once the quest is done.
    if (quest.isComplete(player)) spawnKey(player, "ivan_post", IVAN_ID, HIDEOUT_IVAN_TILE);
    else despawnKey(player, "ivan_post");
    spawnAt(player, "hameln", HAMELN_ID, HAMELN_CHURCH_TILE, STAGE_STARTED, STAGE_FOLLOWING);
    spawnAt(player, "carl", CARL_ID, CARL_PUB_TILE, STAGE_HAMELN, STAGE_FOLLOWING);
    if (stage === STAGE_FOLLOWING && !hasBit(player, BIT_TRAIL) &&
      player.getLocation?.().getZ?.() === 0) {
      if (!carlFollowSessions.has(player)) startCarlFollow(player);
    } else {
      removeCarlFollow(player);
    }
    spawnAt(player, "vanescula", VANESCULA_ID, GRAVEYARD_VANESCULA_TILE, STAGE_GRAVEYARD, STAGE_CASTLE);
    spawnAt(player, "vertida_grave", VERTIDA_ID, GRAVEYARD_VERTIDA_TILE, STAGE_GRAVEYARD, STAGE_LOGS_GIVEN);
    spawnAt(player, "vertida_hideout", VERTIDA_ID, HIDEOUT_VERTIDA_TILE, STAGE_LOGS_GIVEN, STAGE_VANSTROM_DEAD);
    spawnAt(player, "kael", KAEL_ID, GRAVEYARD_KAEL_TILE, STAGE_GRAVEYARD, STAGE_CASTLE);
    spawnAt(player, "radigad", RADIGAD_ID, GRAVEYARD_RADIGAD_TILE, STAGE_GRAVEYARD, STAGE_CASTLE);
    spawnAt(player, "polmafi_grave1", POLMAFI_ID, GRAVEYARD_POLMAFI_TILE, STAGE_GRAVEYARD, STAGE_DISGUISE_BRIEF);
    spawnAt(player, "polmafi_hideout1", POLMAFI_ID, HIDEOUT_POLMAFI_TILE, STAGE_DISGUISE_BRIEF, STAGE_DAMIEN_DONE);
    spawnAt(player, "polmafi_grave2", POLMAFI_ID, GRAVEYARD_POLMAFI_TILE, STAGE_DAMIEN_DONE, STAGE_LOGS_GIVEN);
    spawnAt(player, "polmafi_hideout2", POLMAFI_ID, HIDEOUT_POLMAFI_TILE, STAGE_LOGS_GIVEN, STAGE_VANSTROM_DEAD);
    spawnAt(player, "maria", MARIA_ID, PRISON_MARIA_TILE, STAGE_PRISON, STAGE_ARBORETUM);
    spawnAt(player, "safalaan_grave1", SAFALAAN_ID, GRAVEYARD_SAFALAAN_TILE, STAGE_GRAVEYARD, STAGE_LAB_PLAN);
    spawnAt(player, "safalaan_lab", SAFALAAN_ID, LAB_SAFALAAN_TILE, STAGE_LAB_PLAN, STAGE_LAB_DONE);
    spawnAt(player, "safalaan_grave2", SAFALAAN_ID, GRAVEYARD_SAFALAAN_TILE, STAGE_LAB_DONE, STAGE_SAFALAAN_WALK);
    spawnAt(player, "safalaan_walk", SAFALAAN_ID, SAFALAAN_WALK_TILE, STAGE_SAFALAAN_WALK, STAGE_CASTLE);
    // Fighters.
    if (stage >= STAGE_CARL_DONE && stage < STAGE_KROY_DEAD && hasBit(player, BIT_TRAIL)) {
      spawnKey(player, "kroy_fight", KROY_FIGHT_ID, KROY_LAB_TILE);
    } else {
      despawnKey(player, "kroy_fight");
    }
    if (stage === STAGE_BLOODVELD) {
      spawnKey(player, "bloodveld", BLOODVELD_ID, LAB_BLOODVELD_TILE);
    } else {
      despawnKey(player, "bloodveld");
    }
    if (stage >= STAGE_DISGUISE_READY && stage < STAGE_DAMIEN_DONE && hasBit(player, BIT_DAMIEN)) {
      spawnKey(player, "damien_fight", DAMIEN_FIGHT_ID, DAMIEN_MANOR_TILE);
    } else {
      despawnKey(player, "damien_fight");
    }
    if (stage >= STAGE_ESCORT && stage < STAGE_ESCORT_DONE) {
      spawnKey(player, "ivan_trek", IVAN_ESCORT_ID, TREK_START);
      const nails = field(player, NAIL_SHIFT);
      const juvis = field(player, JUVI_SHIFT);
      if (hasBit(player, BIT_TREK) && nails < 2) {
        spawnKey(player, "nail1", NAIL_BEAST_IDS[0], TREK_NAIL_TILES[0]);
        spawnKey(player, "nail2", NAIL_BEAST_IDS[1], TREK_NAIL_TILES[1]);
      } else {
        despawnKey(player, "nail1");
        despawnKey(player, "nail2");
      }
      if (nails >= 2 && !hasBit(player, BIT_BRIDGE)) {
        spawnKey(player, "zombie", ZOMBIE_NPC_ID, ZOMBIE_TILE);
      } else {
        despawnKey(player, "zombie");
      }
      if (nails >= 2 && hasBit(player, BIT_BRIDGE) && juvis < 2) {
        spawnKey(player, "juvi1", JUVI_IDS[0], TREK_JUVI_TILES[0]);
        spawnKey(player, "juvi2", JUVI_IDS[1], TREK_JUVI_TILES[1]);
      } else {
        despawnKey(player, "juvi1");
        despawnKey(player, "juvi2");
      }
    } else {
      despawnKey(player, "ivan_trek");
      despawnKey(player, "nail1");
      despawnKey(player, "nail2");
      despawnKey(player, "zombie");
      despawnKey(player, "juvi1");
      despawnKey(player, "juvi2");
    }
    if (stage >= STAGE_CASTLE && stage < STAGE_VANSTROM_DEAD && hasBit(player, BIT_VANSTROM)) {
      const vanstrom = spawnKey(player, "vanstrom_fight", VANSTROM_FIGHT_ID, CASTLE_ARENA);
      if (vanstrom && !vanstromFights.has(player)) {
        const state = { player, npc: vanstrom, phase: 1, ticks: 0, bloodvelds: [], objects: [] };
        vanstromFights.set(player, state);
        vanstromNpcMeta.set(vanstrom, state);
      }
    } else {
      despawnKey(player, "vanstrom_fight");
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime quest objects
  // ---------------------------------------------------------------------------

  // Stage-dependent route objects are personal overlays. The cache/map object stays
  // as the shared collision anchor; the overlay is sent only to its owner and is also
  // what MapObjects.getPrivateArea returns for that player's click validation.
  function personalObjectsFor(player) {
    let objects = personalObjects.get(player);
    if (!objects) personalObjects.set(player, objects = new Map());
    return objects;
  }

  function personalKey(tile) {
    return `${tile.x},${tile.y},${tile.z}`;
  }

  function hasBaseObject(objectId, tile) {
    if (!MapObjects?.get) return false;
    try {
      return MapObjects.get(objectId, new Location(tile.x, tile.y, tile.z), null) != null;
    } catch {
      return false;
    }
  }

  function clearPersonalObject(player, tile) {
    const objects = personalObjectsFor(player);
    const key = personalKey(tile);
    const existing = objects.get(key);
    if (!existing) return;
    objects.delete(key);
    ObjectManager.deregister(existing, true);
  }

  function syncPersonalObject(player, tile, objectId, type = 10, rotation = tile.rotation ?? 0) {
    const objects = personalObjectsFor(player);
    const key = personalKey(tile);
    const existing = objects.get(key);
    // The map object is already the correct visible/collidable anchor for base states.
    if (objectId == null || hasBaseObject(objectId, tile)) {
      clearPersonalObject(player, tile);
      return;
    }
    if (existing?.getId() === objectId && existing.getType() === type && existing.getFace() === rotation) return;
    clearPersonalObject(player, tile);
    const object = new GameObject(objectId, new Location(tile.x, tile.y, tile.z), type, rotation, null).setOwner(player);
    ObjectManager.register(object, true);
    objects.set(key, object);
  }

  function clearPersonalObjects(player) {
    const objects = personalObjects.get(player);
    if (!objects) return;
    personalObjects.delete(player);
    for (const object of objects.values()) ObjectManager.deregister(object, true);
  }

  function syncQuestObjects(player) {
    const stage = quest.getStage(player);
    // Login-installed anchors are personal overlays too, so a later region load
    // cannot replace them with the cache's noop/no-option base object.
    if (stage >= STAGE_HAMELN && stage < STAGE_FOLLOWING) {
      syncPersonalObject(player, BARREL_TILE, BARREL_OBJECT_ID);
    } else {
      clearPersonalObject(player, BARREL_TILE);
    }
    if (stage >= STAGE_ESCORT_DONE) {
      syncPersonalObject(player, BURGH_DOCKS, BOAT_OBJECT_ID);
      syncPersonalObject(player, ICYENE_DOCK, BOAT_OBJECT_ID);
    } else {
      clearPersonalObject(player, BURGH_DOCKS);
      clearPersonalObject(player, ICYENE_DOCK);
    }
    if (stage >= STAGE_KROY_FIGHT && stage < STAGE_LAB_DESTROYED) {
      for (let index = 0; index < KROY_TABLE_TILES.length; index++) {
        const tile = KROY_TABLE_TILES[index];
        const broken = hasBit(player, index === 0 ? BIT_TABLE_1 : BIT_TABLE_2);
        syncPersonalObject(player, tile, broken ? KROY_TABLE_BROKEN_OBJECT_ID : KROY_TABLE_OP_OBJECT_ID, 10, tile.rotation);
      }
    }
    if (stage >= STAGE_ESCORT && stage < STAGE_ESCORT_DONE) {
      if (!hasBit(player, BIT_TREK)) {
        // With the long vine, the branch accepts Use; only after the throw/wrap
        // does the Swing-from object 38005 replace it. Before that the small-vines
        // Cut-vine object is the only interaction.
        const treeObject = held(player, LONG_VINE_ITEM_ID)
          ? SWAMP_BRANCH_OBJECT_ID
          : player.getAttribute(VINE_ATTACHED_ATTRIBUTE) ? SWAMP_TREE_OBJECT_ID : SWAMP_VINES_OBJECT_ID;
        syncPersonalObject(player, TREK_TREE_TILE, treeObject);
        syncPersonalObject(player, TREK_RUCKSACK_TILE, SWAMP_RUCKSACK_OBJECT_ID);
      } else {
        syncPersonalObject(player, TREK_TREE_TILE, SWAMP_TREE_OBJECT_ID);
      }
      const repairs = bridgeRepairs(player);
      syncPersonalObject(player, BRIDGE_TILE, BRIDGE_OBJECT_IDS[repairs], 22, BRIDGE_TILE.rotation);
      if (field(player, NAIL_SHIFT) >= 2 && repairs < 3) {
        syncPersonalObject(player, DEAD_TREE_TILE, DEAD_TREE_OBJECT_ID);
      } else {
        clearPersonalObject(player, DEAD_TREE_TILE);
      }
    } else {
      for (const tile of [TREK_TREE_TILE, TREK_RUCKSACK_TILE, BRIDGE_TILE, DEAD_TREE_TILE]) {
        clearPersonalObject(player, tile);
      }
    }
    // The cache's base 39519 is a no-action transform parent; install the
    // actionable owner variant (Unlock before the grid, Open after it).
    syncPersonalObject(
      player,
      MAUSOLEUM_DOOR_TILE,
      stage >= STAGE_PUZZLE_DONE ? MAUSOLEUM_DOOR_OPEN_OBJECT_ID : MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID,
      0,
      MAUSOLEUM_DOOR_TILE.rotation
    );
  }

  // ---------------------------------------------------------------------------
  // Cache sub-varbit mirrors
  // ---------------------------------------------------------------------------

  function syncVisuals(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_KAEL_CONVINCED, hasBit(player, BIT_KAEL) ? 1 : 0);
    sender.sendVarbit(VARBIT_VERTIDA_CONVINCED, hasBit(player, BIT_VERTIDA) ? 1 : 0);
    sender.sendVarbit(VARBIT_IVAN_CONVINCED, hasBit(player, BIT_IVAN) ? 1 : 0);
    sender.sendVarbit(VARBIT_POLMAFI_CONVINCED, hasBit(player, BIT_POLMAFI) ? 1 : 0);
    sender.sendVarbit(VARBIT_RADIGAD_CONVINCED, hasBit(player, BIT_RADIGAD) ? 1 : 0);
    // Live 226: both tables read 1 when Kroy dies and 2 once each is smashed.
    const stage = quest.getStage(player);
    const tableState = (bit) => (hasBit(player, bit) ? 2 : stage >= STAGE_KROY_DEAD ? 1 : 0);
    sender.sendVarbit(VARBIT_KROY_TABLE_1, tableState(BIT_TABLE_1));
    sender.sendVarbit(VARBIT_KROY_TABLE_2, tableState(BIT_TABLE_2));
    sender.sendVarbit(VARBIT_TRADER_SVEN_MET, hasBit(player, BIT_SVEN) ? 1 : 0);
    sender.sendVarbit(VARBIT_PUZZLE_COMPLETED, quest.getStage(player) >= STAGE_PUZZLE_DONE ? 1 : 0);
    sender.sendVarbit(VARBIT_LAB_UNLOCKED, quest.getStage(player) >= STAGE_LAB_PLAN ? 1 : 0);
  }

  // ---------------------------------------------------------------------------
  // Journal and rewards
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I found the source of the Sleeper Plague in Slepe: vampyres had</str>",
        "<str>dosed the Bloody Bracers, and I put a stop to Kroy's work.</str>",
        "<str>Vanescula Drakan offered the Myreque a chance to kill her brother,</str>",
        "<str>and Safalaan learned the truth of his icyene heritage.</str>",
        "<str>I infiltrated Darkmeyer, cut blisterwood from the Arboretum and</str>",
        "<str>helped forge weapons for the final battle at Castle Drakan.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_VANSTROM_DEAD) {
      return [
        "Vanstrom Klause has fallen. Ivan teleported us out of Castle Drakan,",
        "but Safalaan was left behind.",
        "",
        "I should speak to <col=800000>Ivan</col> at the hideout.",
      ];
    }
    if (stage >= STAGE_CASTLE) {
      return [
        "Vanescula has taken us to Castle Drakan as her prisoners.",
        "",
        "I must face <col=800000>Vanstrom Klause</col>.",
      ];
    }
    if (stage >= STAGE_SAFALAAN_WALK) {
      return [
        "Safalaan has gone for a walk north of the Icyene Graveyard.",
        "",
        "I should find him, then tell <col=800000>Vanescula</col> we are ready.",
      ];
    }
    if (stage >= STAGE_FLAIL) {
      return [
        "I have a <col=800000>blisterwood flail</col>.",
        "",
        "I should return to the <col=800000>Icyene Graveyard</col>.",
      ];
    }
    if (stage >= STAGE_VERTIDA_LOGS) {
      return [
        "Vertida told me how to make the new weapons: embed a ruby in a",
        "blessed silver sickle, enchant it, add a blisterwood log, then attach",
        "the blisterwood sickle to my Ivandis flail.",
      ];
    }
    if (stage >= STAGE_LOGS_GIVEN) {
      return [
        "Vanescula took the blisterwood logs and sent me to",
        "<col=800000>Vertida</col> in the Meiyerditch hideout.",
      ];
    }
    if (stage >= STAGE_LOGS) {
      return [
        "I have cut eight <col=800000>blisterwood logs</col>.",
        "",
        "I should return to <col=800000>Vanescula</col> at the Icyene Graveyard.",
      ];
    }
    if (stage >= STAGE_ARBORETUM) {
      return [
        "Desmodus has let me into the Arboretum.",
        "",
        "I should search the shelves, read the old note, set the valves to the",
        "required flow and chop eight logs from the Blisterwood tree.",
      ];
    }
    if (stage >= STAGE_SLAVES_DONE) {
      return [
        "The Gadderanks slaves will be returned to Desmodus.",
        "",
        "I should tell <col=800000>Desmodus Lasiurus</col> so he lets me into the",
        "Arboretum.",
      ];
    }
    if (stage >= STAGE_PRISON) {
      return [
        "I found the Gadderanks in Lord Jovkai's prison. Vanstrom nearly",
        "recognised me, but Sarius Guile intervened.",
        "",
        "I should return to <col=800000>Desmodus</col> at the Arboretum.",
      ];
    }
    if (stage >= STAGE_MORDAN) {
      return [
        "Mordan Nikazsi sold Desmodus' slaves to Lord Alexei Jovkai.",
        "",
        "I should find them in <col=800000>Lord Jovkai's prison</col> north of the",
        "Arboretum.",
      ];
    }
    if (stage >= STAGE_DARKMEYER) {
      return [
        "I entered <col=800000>Darkmeyer</col> through the cracked wall.",
        "",
        "I need to get into the Arboretum. Its guard, Desmodus Lasiurus,",
        "wants a juvinate called Mordan Nikazsi found first.",
      ];
    }
    if (stage >= STAGE_DARKMEYER_PLAN) {
      return [
        "Vanescula says the only Blisterwood tree is in Efaritay's Arboretum,",
        "in the middle of Darkmeyer.",
        "",
        "I can enter the city through a <col=800000>crack in the southern wall</col> of",
        "Meiyerditch, north of the daeyalt mine.",
      ];
    }
    if (stage >= STAGE_DAMIEN_DONE) {
      return [
        "Damien Leucurte is dead and I scented my disguise with his blood.",
        "",
        "I should return to <col=800000>Vanescula</col> at the Icyene Graveyard.",
      ];
    }
    if (stage >= STAGE_DISGUISE_READY) {
      return [
        "Vanescula wants Damien Leucurte dead so I can use his noble blood to",
        "scent the disguise.",
        "",
        "I should meet <col=800000>Veliaf</col> outside the church in Slepe.",
      ];
    }
    if (stage >= STAGE_DISGUISE_BRIEF) {
      return [
        "I need a <col=800000>vyre noble disguise</col>: buy a vyrewatch outfit from",
        "Trader Sven in Meiyerditch, have Polmafi adapt it at the hideout,",
        "then return to Vanescula.",
      ];
    }
    if (stage >= STAGE_LAB_DONE) {
      return [
        "Safalaan has Haemalchemy volume 2.",
        "",
        "I should return to the <col=800000>Icyene Graveyard</col>.",
      ];
    }
    if (stage >= STAGE_LAB_BOOK) {
      return [
        "I found <col=800000>Haemalchemy volume 2</col> in the laboratory.",
        "",
        "I should give it to <col=800000>Safalaan</col>.",
      ];
    }
    if (stage >= STAGE_BLOODVELD_TALK) {
      return [
        "Safalaan killed one mutated bloodveld with his powers and I killed",
        "another. He is still weak.",
        "",
        "I should search the laboratory for more haemalchemy research.",
      ];
    }
    if (stage >= STAGE_BLOODVELD) {
      return [
        "A <col=800000>mutated bloodveld</col> attacked us in the laboratory.",
        "",
        "I must kill it.",
      ];
    }
    if (stage >= STAGE_LAB_PLAN) {
      return [
        "Vanescula believes the Meiyerditch laboratory holds the secret to",
        "upgrading the Ivandis flail.",
        "",
        "Safalaan is meeting me at the laboratory in sector six of Meiyerditch.",
      ];
    }
    if (stage >= STAGE_CONVINCED) {
      return [
        "The Myreque have agreed to Vanescula's plan.",
        "",
        "I should speak to <col=800000>Vanescula</col> at the Icyene Graveyard.",
      ];
    }
    if (stage >= STAGE_CONVINCING) {
      const convinced = [];
      if (hasBit(player, BIT_VERTIDA)) convinced.push("Vertida");
      if (hasBit(player, BIT_KAEL)) convinced.push("Kael");
      if (hasBit(player, BIT_RADIGAD)) convinced.push("Radigad");
      if (hasBit(player, BIT_POLMAFI)) convinced.push("Polmafi");
      if (hasBit(player, BIT_IVAN)) convinced.push("Ivan");
      return [
        "Safalaan wants to work with Vanescula to kill her brother.",
        "",
        "I must convince the Myreque. So far:",
        convinced.length ? `Agreed: ${convinced.join(", ")}.` : "No one has agreed yet.",
        "Then I should speak to <col=800000>Veliaf</col>.",
      ];
    }
    if (stage >= STAGE_PUZZLE_DONE) {
      return [
        "Safalaan is the half-icyene son of Queen Efaritay and King Ascertes",
        "Hallow, and Vanstrom Klause is his father.",
        "",
        "He has agreed to work with Vanescula. I should convince the Myreque.",
      ];
    }
    if (stage >= STAGE_MUSEUM_TALK) {
      return [
        "Vanescula wants to speak with Safalaan at the large mausoleum.",
        "",
        "I should open the <col=800000>Mausoleum door</col> and solve its lock.",
      ];
    }
    if (stage >= STAGE_GRAVEYARD) {
      return [
        "We have arrived at the <col=800000>Icyene Graveyard</col>.",
        "",
        "I should speak to <col=800000>Veliaf</col>.",
      ];
    }
    if (stage >= STAGE_BOATHOUSE) {
      return [
        "Everything is ready. I should board the boat at the Burgh de Rott",
        "boathouse and sail to the <col=800000>Icyene Graveyard</col>.",
      ];
    }
    if (stage >= STAGE_ESCORT_DONE) {
      return [
        "I escorted Ivan through Mort Myre to <col=800000>Burgh de Rott</col>.",
        "",
        "I should meet him and Veliaf at the boathouse on the southern coast.",
      ];
    }
    if (stage >= STAGE_ESCORT) {
      return [
        "I am escorting Ivan Strom through the swamp to Burgh de Rott.",
        "",
        "We must deal with the bog crossing, nail beasts and vampyre",
        "juvinates along the way.",
      ];
    }
    if (stage >= STAGE_MEETING) {
      return [
        "Vanescula Drakan ambushed us at the Haunted Woods meeting.",
        "",
        "She wants the whole Myreque at the <col=800000>Icyene Graveyard</col>.",
        "I should escort <col=800000>Ivan</col> down to Burgh de Rott first.",
      ];
    }
    if (stage >= STAGE_PATERDOMUS) {
      return [
        "Drezel told us Ivan is the last descendant of Ivandis Seergaze, and",
        "that he has gone to spy on a meeting in the Haunted Woods.",
        "",
        "I should meet Veliaf and Ivan south of Fenkenstrain's Castle.",
      ];
    }
    if (stage >= STAGE_VELIAF_REPORTED) {
      return [
        "Veliaf wants to check in with Drezel and Ivan at",
        "<col=800000>Paterdomus</col> before investigating the werewolves.",
      ];
    }
    if (stage >= STAGE_LAB_DESTROYED) {
      return [
        "Kroy is dead and his laboratory is destroyed.",
        "",
        "I should report back to <col=800000>Veliaf</col> in Slepe.",
      ];
    }
    if (stage >= STAGE_KROY_DEAD) {
      return [
        "Kroy is dead.",
        "",
        "I should destroy both of his <col=800000>lab tables</col>.",
      ];
    }
    if (stage >= STAGE_KROY_FIGHT) {
      return ["Kroy is behind the Sleeper Plague.", "", "I must kill <col=800000>Kroy</col>."];
    }
    if (stage >= STAGE_FOLLOWING) {
      return [
        "Carl is out of Bloody Bracers and has gone to his supplier.",
        "",
        "I followed him into the dungeon beneath Slepe and overheard",
        "vampyres discussing the Sleeper Plague.",
      ];
    }
    if (stage >= STAGE_HAMELN) {
      return [
        "Hameln says Hanchen fell ill after drinking Bloody Bracers at",
        "the <col=800000>Rat & Bat</col>.",
        "",
        "I should question <col=800000>Carl</col> the barkeep.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Veliaf asked me to find the source of the Sleeper Plague while he",
        "investigates the vampyres at Crombwick Manor.",
        "",
        "The victims are in the <col=800000>church</col> in Slepe.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Veliaf Hurtz</col> outside",
      "the church in <col=800000>Slepe</col>.",
      "",
      "I need to have completed <col=800000>A Taste of Hope</col>.",
    ];
  }

  function grantReward(player) {
    markSchema(player);
    player.setAttribute(TOME_USES_ATTRIBUTE, 0);
    applyStageSpawns(player);
    syncVisuals(player);
  }

  // ---------------------------------------------------------------------------
  // Prose conditions
  // ---------------------------------------------------------------------------

  function answerCondition(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "7D8z_N": // requirements, missing
        return !meetsRequirements(player);
      case "S4umqc": // requirements, met
        return meetsRequirements(player);
      case "SGj1He": // combat, below recommended
        return combatLevel(player) < 95;
      case "Y7Eh4F": // vyre disguise, present
        return hasVyreNoble(player);
      case "CIrOJv": // vyre disguise, missing
        return !hasVyreNoble(player);
      case "kqP6AE": // blisterwood flail, present
        return hasBlisterwoodFlail(player);
      case "pl5f2L": // blisterwood flail, missing
        return !hasBlisterwoodFlail(player);
      case "svlKBi": // 40,000 coins, missing
        return !held(player, ItemIdentifiers.COINS, 40000);
      case "z2xhAs": // 40,000 coins, present
        return held(player, ItemIdentifiers.COINS, 40000);
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Transcript action handling
  // ---------------------------------------------------------------------------

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case "bsrbMj": // The player begins following Carl.
        player.setAttribute(CARL_PROGRESS_ATTRIBUTE, 0);
        teleport(player, { x: 3754, y: 3307, z: 0 }); // capture 1637 tick 1164
        if (quest.getStage(player) < STAGE_FOLLOWING) advance(player, STAGE_FOLLOWING);
        return;
      case "5Nx48P": // Kroy attacks the player.
        setBit(player, BIT_TRAIL);
        if (quest.getStage(player) < STAGE_KROY_FIGHT) advance(player, STAGE_KROY_FIGHT);
        else applyStageSpawns(player);
        return;
      case "uRyt8i": // Ivan and Veliaf depart, leaving you alone in the woods.
        if (quest.getStage(player) < STAGE_MEETING) advance(player, STAGE_MEETING);
        else applyStageSpawns(player);
        return;
      case "_popnC": // You escort Ivan through the swamp...
        if (quest.getStage(player) < STAGE_ESCORT) advance(player, STAGE_ESCORT);
        else applyStageSpawns(player);
        teleport(player, TREK_START);
        return;
      case "uD7Qcw": // Ivan departs towards the boathouse.
        teleport(player, BURGH_LANDING);
        if (quest.getStage(player) < STAGE_ESCORT_DONE) advance(player, STAGE_ESCORT_DONE);
        else applyStageSpawns(player);
        return;
      case "2Ond7l":
      case "_TdnV6": // The player and Safalaan enter the laboratory.
        teleport(player, LAB_BLOODVELD_TILE);
        playCamera(player, CAMERA_LAB);
        return;
      case "WV-HwC":
      case "Gdz7wW": // Safalaan is attacked by a mutated bloodveld...
        if (quest.getStage(player) < STAGE_BLOODVELD) advance(player, STAGE_BLOODVELD);
        else applyStageSpawns(player);
        return;
      case "A5NXtS": // You give the book of haemalchemy research to Safalaan.
        player.getInventory().deleteNumber(HAEMALCHEMY_VOL_2_ITEM_ID, 1);
        return;
      case "DW1fI1": // You give Polmafi the vyrewatch disguise.
        if (hasVyrewatchOutfit(player)) swapOutfit(player, VYREWATCH_ITEM_IDS, VYRE_NOBLE_UNSCENTED_IDS);
        if (quest.getStage(player) < STAGE_DISGUISE_GIVEN) advance(player, STAGE_DISGUISE_GIVEN);
        return;
      case "YuGfYA": // Polmafi hands back the finished noble disguise.
        if (!hasVyreNoble(player)) swapOutfit(player, VYREWATCH_ITEM_IDS, VYRE_NOBLE_UNSCENTED_IDS);
        if (quest.getStage(player) < STAGE_DISGUISE_MADE) advance(player, STAGE_DISGUISE_MADE);
        return;
      case "OieoC2": // The player and Veliaf go off to confront Damien.
        if (quest.getStage(player) < STAGE_DAMIEN_READY) advance(player, STAGE_DAMIEN_READY);
        teleport(player, { x: 3717, y: 3358, z: 1 });
        playCamera(player, CAMERA_DAMIEN);
        later(player, 1, () =>
          play(player, DAMIEN_FIGHT_ID, "a-vyre-ry-noble-disguise-going-back-to-slepe-confronting-damien")
        );
        return;
      case "oKCkn5": // Damien attacks the player and Veliaf.
        setBit(player, BIT_DAMIEN);
        if (quest.getStage(player) < STAGE_DAMIEN_CONFRONT) advance(player, STAGE_DAMIEN_CONFRONT);
        else applyStageSpawns(player);
        return;
      case "3dLkuB": // As Damien dies, you use his blood to scent your disguise.
        swapOutfit(player, VYRE_NOBLE_UNSCENTED_IDS, VYRE_NOBLE_SCENTED_IDS);
        if (quest.getStage(player) < STAGE_DAMIEN_DONE) advance(player, STAGE_DAMIEN_DONE);
        return;
      case "sM_w-r": // You give seven blisterwood logs to Vertida.
        player.getInventory().deleteNumber(BLISTERWOOD_LOGS_ITEM_ID, 7);
        if (quest.getStage(player) < STAGE_VERTIDA_LOGS) advance(player, STAGE_VERTIDA_LOGS);
        return;
      case "JaZXc6": // You and Safalaan return to the graveyard.
        if (quest.getStage(player) < STAGE_READY) advance(player, STAGE_READY);
        return;
      case "HgxSdS": // The player, Vanescula, and the Myreque go to Castle Drakan.
        beginCastleFight(player);
        return;
      case "ntch-j": // Vanescula's "I'm ready." in the canonical post-Safalaan variant.
        if (quest.getStage(player) < STAGE_READY || !hasBlisterwoodFlail(player)) return;
        beginCastleFight(player);
        return;
      case "2PLAE9": // Vanstrom attacks the player.
        resetCamera(player);
        setBit(player, BIT_VANSTROM);
        applyStageSpawns(player);
        return;
      case "32fCzz": // The player and Veliaf return to Darkmeyer castle.
        teleport(player, CASTLE_ARENA);
        setBit(player, BIT_VANSTROM);
        applyStageSpawns(player);
        return;
      case "VkGiX9": // Veliaf gives you a Blisterwood Flail.
        player.getInventory().deleteNumber(ItemIdentifiers.COINS, 40000);
        if (!hasBlisterwoodFlail(player)) give(player, BLISTERWOOD_FLAIL_ITEM_ID, 1);
        return;
      case "I_cLuQ": // Safalaan's Icyene powers activate, killing Vanstrom...
        playCamera(player, CAMERA_ESCAPE);
        cleanupVanstromFight(player);
        despawnKey(player, "vanstrom_fight");
        spawnKey(player, "scene-vanstrom", VANSTROM_SCENE_ID, { x: 3569, y: 3358, z: 0 });
        const safalaan = spawnKey(player, "scene-safalaan", SAFALAAN_SCENE_ID, { x: 3574, y: 3358, z: 0 });
        later(player, 1, () => safalaan?.moveTo?.(new Location(3570, 3358, 0)));
        if (quest.getStage(player) < STAGE_VANSTROM_DEAD) advance(player, STAGE_VANSTROM_DEAD);
        return;
      case "y7Pa27": {
        // Ivan teleports himself, Veliaf, and the player out of Castle Drakan.
        event.handled = true;
        event.end = true;
        cleanupVanstromFight(player);
        despawnKey(player, "vanstrom_fight");
        despawnKey(player, "scene-vanstrom");
        despawnKey(player, "scene-safalaan");
        resetCamera(player);
        fade(player, true);
        later(player, 2, () => {
          teleport(player, BURGH_HIDEOUT);
          fade(player, false);
          play(player, IVAN_ID, "shattered-after-escaping-from-castle-drakan");
        });
        later(player, 11, () => playCamera(player, CAMERA_HIDEOUT));
        return;
      }
      case "epguG1": // Congratulations! Quest complete!
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "UPl9kU": // recovering a lost tome from Ivan
        if (!held(player, TOME_ITEM_ID)) give(player, TOME_ITEM_ID, 1);
        return;
      case "ZoWCuH": // Ivan's post-Sins Drakan's medallion reclaim interface
      case "R8U1L0":
        if (!IVAN_IDS.has(event.npcId) || !quest.isComplete(player)) return;
        if (held(player, DRAKANS_MEDALLION_ITEM_ID)) {
          player.sendMessage("You already have a Drakan's medallion.");
          return;
        }
        if (freeSlots(player) < 1) {
          player.sendMessage("You need an empty inventory slot to reclaim a Drakan's medallion.");
          return;
        }
        give(player, DRAKANS_MEDALLION_ITEM_ID, 1);
        return;
      default:
        return;
    }
  }

  function handleDialogueChoice(event) {
    const { player, option, npcId } = event;
    if (!player) return;
    if (option === "Where do you get your Bloody Bracers from?" && CARL_IDS.has(npcId)) {
      setBit(player, BIT_CARL_ASKED);
    }
    // The wiki only carries the start hook on the low-combat branch of the
    // opening offer; the normal "Yes." needs starting here.
    if (
      option === "Yes." &&
      VELIAF_IDS.has(npcId) &&
      quest.getStage(player) === STAGE_UNSTARTED &&
      near(player, VELIAF_SLEPE_TILE, 12) &&
      meetsRequirements(player)
    ) {
      advance(player, STAGE_STARTED);
    }
  }

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !VELIAF_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_UNSTARTED) return;
    if (!meetsRequirements(player)) {
      requirementsMessage(player);
      return;
    }
    advance(player, STAGE_STARTED);
  }

  // ---------------------------------------------------------------------------
  // Stage advancement
  // ---------------------------------------------------------------------------

  function advance(player, stage) {
    markSchema(player);
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    applyStageSpawns(player);
    syncVisuals(player);
    syncQuestObjects(player);
  }

  function handleStageChanged(event) {
    if (event.key !== "sins_of_the_father" || !event.player) return;
    markSchema(event.player);
    applyStageSpawns(event.player);
    syncVisuals(event.player);
    syncQuestObjects(event.player);
  }

  // ---------------------------------------------------------------------------
  // Talk-to handlers
  // ---------------------------------------------------------------------------

  function talkVeliaf(event) {
    const { player, npcId } = event;
    if (!VELIAF_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_UNSTARTED) {
      // Only the Slepe spawn is ours: the Burgh de Rott copy belongs to the
      // earlier Myreque quests.
      if (!near(player, VELIAF_SLEPE_TILE, 12)) return false;
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-veliaf");
      return true;
    }
    if (stage >= STAGE_COMPLETE) return false;
    if (stage < STAGE_HAMELN) {
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-veliaf-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_FOLLOWING) {
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-hameln-report-back-to-veliaf");
      return true;
    }
    if (stage < STAGE_LAB_DESTROYED) {
      say(player, npcId, "You should follow Carl and see where he goes.");
      return true;
    }
    if (stage < STAGE_VELIAF_REPORTED) {
      play(player, npcId, "an-unwelcome-surprise-reporting-back-to-veliaf");
      advance(player, STAGE_VELIAF_REPORTED);
      return true;
    }
    if (stage < STAGE_PATERDOMUS) {
      play(player, npcId, "an-unwelcome-surprise-checking-in-at-paterdomus");
      advance(player, STAGE_PATERDOMUS);
      return true;
    }
    if (stage < STAGE_MEETING) {
      play(player, npcId, "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_ESCORT) {
      play(player, npcId, "an-unwelcome-surprise-meeting-at-the-haunted-woods");
      return true;
    }
    if (stage < STAGE_ESCORT_DONE) return false;
    if (stage < STAGE_BOATHOUSE) {
      play(player, npcId, "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott");
      advance(player, STAGE_BOATHOUSE);
      return true;
    }
    if (stage < STAGE_GRAVEYARD) {
      play(player, npcId, "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_MUSEUM_TALK) {
      playCamera(player, CAMERA_GRAVEYARD_MEETING);
      play(player, npcId, "a-nice-and-simple-plan-meeting-at-the-icyene-graveyard");
      advance(player, STAGE_MUSEUM_TALK);
      return true;
    }
    if (stage < STAGE_PUZZLE_DONE) {
      play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-veliaf");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (allConvinced(player)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-after-convincing-everyone-else");
        advance(player, STAGE_CONVINCED);
        return true;
      }
      if (hasBit(player, BIT_VELIAF_ASKED)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-before-convincing-everyone-else");
      } else {
        setBit(player, BIT_VELIAF_ASKED);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf");
      }
      return true;
    }
    if (stage < STAGE_LAB_PLAN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-veliaf");
      return true;
    }
    if (stage < STAGE_DISGUISE_BRIEF) {
      play(player, npcId, "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_DISGUISE_READY) return false;
    if (stage < STAGE_DAMIEN_DONE) {
      play(player, npcId, "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf");
      return true;
    }
    if (stage < STAGE_DARKMEYER_PLAN) {
      play(player, npcId, "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf-2");
      advance(player, STAGE_DARKMEYER_PLAN);
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      say(player, npcId, "Darkmeyer awaits, friend. Be careful in there.");
      return true;
    }
    if (stage < STAGE_FLAIL) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-without-a-blisterwood-flail");
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail");
      advance(player, STAGE_SAFALAAN_WALK);
      return true;
    }
    if (stage < STAGE_CASTLE) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_VANSTROM_DEAD) {
      if (!hasBlisterwoodFlail(player)) {
        play(player, npcId, "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-dying-during-the-fight");
      } else {
        play(player, npcId, "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-leaving-the-fight");
      }
      return true;
    }
    return false;
  }

  function talkHameln(event) {
    const { player, npcId } = event;
    if (!HAMELN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_FOLLOWING) return false;
    if (stage < STAGE_HAMELN) {
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-hameln");
      advance(player, STAGE_HAMELN);
      return true;
    }
    play(player, npcId, "slepe-s-sleeper-plague-talking-to-hameln-talking-to-hameln-again");
    return true;
  }

  function talkCarl(event) {
    const { player, npcId } = event;
    if (!CARL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_HAMELN || stage >= STAGE_LAB_DESTROYED) return false;
    if (hasBit(player, BIT_CARL_ASKED)) {
      play(player, npcId, "plague-s-end-talking-to-carl-talking-to-carl-again");
    } else {
      play(player, npcId, "plague-s-end-talking-to-carl");
    }
    return true;
  }

  function talkDrezel(event) {
    const { player, npcId } = event;
    if (!DREZEL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_VELIAF_REPORTED || stage >= STAGE_ESCORT) return false;
    if (stage < STAGE_MEETING) {
      play(player, npcId, "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-drezel-again");
    } else {
      play(player, npcId, "an-unwelcome-surprise-talking-to-drezel-after-attending-the-meeting");
    }
    return true;
  }

  function talkSafalaan(event) {
    const { player, npcId } = event;
    if (!SAFALAAN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_MUSEUM_TALK) {
      say(player, npcId, "Talk to Veliaf first.");
      return true;
    }
    if (stage < STAGE_PUZZLE_DONE) {
      play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-safalaan");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      say(player, npcId, "Please, speak to the others. I need some time alone.");
      return true;
    }
    if (stage < STAGE_LAB_PLAN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-safalaan");
      return true;
    }
    if (stage < STAGE_BLOODVELD) {
      play(player, npcId, "a-nice-and-simple-plan-the-meiyerditch-laboratories");
      return true;
    }
    if (stage < STAGE_BLOODVELD_TALK) {
      play(player, npcId, "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld");
      advance(player, STAGE_BLOODVELD_TALK);
      return true;
    }
    if (stage < STAGE_LAB_BOOK) {
      play(player, npcId, "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld-talking-to-safalaan-again");
      return true;
    }
    if (stage < STAGE_LAB_DONE && held(player, HAEMALCHEMY_VOL_2_ITEM_ID)) {
      play(player, npcId, "a-nice-and-simple-plan-talking-to-safalaan-after-getting-the-book");
      advance(player, STAGE_LAB_DONE);
      return true;
    }
    if (stage < STAGE_LAB_DONE) {
      say(player, npcId, "You need to try and find some more haemalchemy research. There must be something of note around here.");
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      play(player, npcId, "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-safalaan-again");
      return true;
    }
    if (stage < STAGE_CASTLE) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-safalaan");
      return true;
    }
    return false;
  }

  function talkVanescula(event) {
    const { player, npcId } = event;
    if (!VANESCULA_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_CASTLE) return false;
    if (stage < STAGE_MUSEUM_TALK) {
      say(player, npcId, "Talk to Veliaf first.");
      return true;
    }
    if (stage < STAGE_PUZZLE_DONE) {
      if (!hasBit(player, BIT_PUZZLE_PLAYED)) {
        setBit(player, BIT_PUZZLE_PLAYED);
        play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1");
        advance(player, STAGE_PUZZLE_READY);
        return true;
      }
      play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-vanescula");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vanescula");
      return true;
    }
    if (stage < STAGE_LAB_PLAN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade");
      advance(player, STAGE_LAB_PLAN);
      return true;
    }
    if (stage < STAGE_LAB_DONE) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-vanescula");
      return true;
    }
    if (stage < STAGE_DISGUISE_BRIEF) {
      play(player, npcId, "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula");
      advance(player, STAGE_DISGUISE_BRIEF);
      return true;
    }
    if (stage < STAGE_DISGUISE_READY) {
      if (hasVyreNoble(player)) {
        play(player, npcId, "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-after-getting-a-vyre-noble-disguise");
        advance(player, STAGE_DISGUISE_READY);
      } else {
        play(player, npcId, "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-before-getting-a-vyre-noble-disguise");
      }
      return true;
    }
    if (stage < STAGE_DAMIEN_DONE) {
      play(player, npcId, "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_DARKMEYER) {
      play(player, npcId, "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise");
      advance(player, STAGE_DARKMEYER);
      return true;
    }
    if (stage < STAGE_LOGS) {
      play(player, npcId, "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_VERTIDA_LOGS) {
      if (logCount(player) >= 8) {
        play(player, npcId, "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs");
        advance(player, STAGE_LOGS_GIVEN);
      } else {
        play(player, npcId, "the-final-preparations-talking-to-vanescula-without-eight-blisterwood-logs");
      }
      return true;
    }
    if (stage < STAGE_FLAIL) {
      play(player, npcId, "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_READY) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_CASTLE) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-vanescula-after-safalaan-returns");
      return true;
    }
    return false;
  }

  function talkVertida(event) {
    const { player, npcId } = event;
    if (!VERTIDA_IDS.has(npcId)) return false;
    // The completed A Taste of Hope reclaim owns the old-base Vertida while
    // the player has no flail to hand.
    if (tasteFlailReclaimDue(player, event.npc)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-vertida");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_VERTIDA)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida-talking-to-vertida-again");
      } else {
        setConvinced(player, BIT_VERTIDA);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "the-final-preparations-talking-to-vertida-without-eight-blisterwood-logs");
      return true;
    }
    if (stage < STAGE_VERTIDA_LOGS) {
      if (logCount(player) >= 8) {
        play(player, npcId, "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs");
      } else {
        play(player, npcId, "the-final-preparations-talking-to-vertida-without-eight-blisterwood-logs");
      }
      return true;
    }
    if (stage < STAGE_FLAIL) {
      play(player, npcId, "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-again");
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      play(player, npcId, "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-with-a-blisterwood-flail");
      advance(player, STAGE_SAFALAAN_WALK);
      return true;
    }
    say(player, npcId, "Myreque prevail, friend.");
    return true;
  }

  function talkKael(event) {
    const { player, npcId } = event;
    if (!KAEL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_CASTLE) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-kael");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_KAEL)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael-talking-to-kael-again-after-convincing-him");
      } else {
        setConvinced(player, BIT_KAEL);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-kael");
      return true;
    }
    say(player, npcId, "Good to see you, friend.");
    return true;
  }

  function talkRadigad(event) {
    const { player, npcId } = event;
    if (!RADIGAD_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_CASTLE) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-radigad");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_RADIGAD)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad-talking-to-radigad-again-after-convincing-him");
      } else {
        setConvinced(player, BIT_RADIGAD);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-radigad");
      return true;
    }
    say(player, npcId, "Well met, friend.");
    return true;
  }

  function talkPolmafi(event) {
    const { player, npcId } = event;
    if (!POLMAFI_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-polmafi");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_POLMAFI)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-convincing-him");
      } else if (hasBit(player, BIT_RADIGAD)) {
        setConvinced(player, BIT_POLMAFI);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-talking-to-radigad");
      } else if (hasBit(player, BIT_VERTIDA) || hasBit(player, BIT_KAEL) || hasBit(player, BIT_IVAN)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-before-talking-to-radigad");
      } else {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi");
      }
      return true;
    }
    if (stage < STAGE_DISGUISE_BRIEF) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-polmafi");
      return true;
    }
    if (stage < STAGE_DISGUISE_READY) {
      if (hasVyrewatchOutfit(player) || hasVyreNoble(player)) {
        play(player, npcId, "a-vyre-ry-noble-disguise-meiyerditch-hideout-talking-to-polmafi-if-the-player-already-have-a-vyrewatch-outfit");
      } else {
        play(player, npcId, "a-vyre-ry-noble-disguise-meiyerditch-hideout-talking-to-polmafi-if-the-player-does-not-already-have-a-vyrewatch-outfit");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "a-vyre-ry-noble-disguise-meiyerditch-hideout-talking-to-polmafi-if-the-player-does-not-already-have-a-vyrewatch-outfit-talking-to-polmafi-again-without-getting-a-vyrewatch-outfit");
      return true;
    }
    say(player, npcId, "Be careful out there, friend.");
    return true;
  }

  function talkIvan(event) {
    const { player, npcId } = event;
    if (!IVAN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      if (!held(player, TOME_ITEM_ID) && npcId !== IVAN_ESCORT_ID) {
        play(player, npcId, "shattered-after-escaping-from-castle-drakan-recovering-a-lost-tome-of-experience-from-ivan");
        return true;
      }
      return false;
    }
    // A relog between Vanstrom's death and the escape scene leaves the finale
    // unfinished; Ivan replays it so the player is never stranded at stage 280.
    if (stage >= STAGE_VANSTROM_DEAD) {
      play(player, npcId, "shattered-after-escaping-from-castle-drakan");
      return true;
    }
    if (stage < STAGE_PATERDOMUS || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_MEETING) {
      playCamera(player, CAMERA_PATERDOMUS_MEETING);
      play(player, npcId, "an-unwelcome-surprise-meeting-at-the-haunted-woods");
      return true;
    }
    if (stage < STAGE_ESCORT) {
      play(player, npcId, "an-unwelcome-surprise-escorting-ivan-again");
      return true;
    }
    if (stage < STAGE_ESCORT_DONE) {
      // If the final juvinate died while the finishing cutscene was lost (a
      // weapon swap or log during it), replay it so the trek cannot soft-lock.
      if (field(player, NAIL_SHIFT) >= 2 && field(player, JUVI_SHIFT) >= 2) {
        play(player, npcId, "an-unwelcome-surprise-escorting-ivan-again-finishing-temple-trekking");
      } else {
        play(player, npcId, "an-unwelcome-surprise-escorting-ivan-again-talking-to-ivan-during-temple-trekking");
      }
      return true;
    }
    if (stage < STAGE_GRAVEYARD) {
      play(player, npcId, "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-ivan-again");
      return true;
    }
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-ivan");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_IVAN)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan-talking-to-ivan-again-after-convincing-him");
      } else {
        setConvinced(player, BIT_IVAN);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan");
      }
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      if (npcId === IVAN_ESCORT_ID) return false;
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-ivan");
      return true;
    }
    return false;
  }

  function talkMaria(event) {
    const { player, npcId } = event;
    if (!MARIA_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MORDAN || stage >= STAGE_ARBORETUM) return false;
    if (stage < STAGE_SLAVES_DONE) {
      playCamera(player, CAMERA_PRISON);
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-gadderanks");
      advance(player, STAGE_SLAVES_DONE);
      return true;
    }
    play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-afterwards");
    return true;
  }

  function talkMordan(event) {
    const { player, npcId } = event;
    if (!MORDAN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DARKMEYER || stage >= STAGE_ARBORETUM) return false;
    if (stage < STAGE_PRISON) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan");
      advance(player, STAGE_PRISON);
      return true;
    }
    if (stage < STAGE_SLAVES_DONE) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-before-finding-desmodus-slaves");
      return true;
    }
    play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-after-finding-desmodus-slaves");
    return true;
  }

  function talkDesmodus(event) {
    const { player, npcId } = event;
    if (!DESMODUS_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DARKMEYER || stage >= STAGE_LOGS) return false;
    if (stage < STAGE_MORDAN) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-lasiurus-before-attempting-to-enter-the-arboretum");
      advance(player, STAGE_MORDAN);
      return true;
    }
    if (stage < STAGE_PRISON) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-again-before-finding-mordan");
      return true;
    }
    if (stage < STAGE_SLAVES_DONE) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-after-finding-mordan-but-before-getting-the-slaves-back");
      return true;
    }
    if (stage < STAGE_ARBORETUM) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves");
      advance(player, STAGE_ARBORETUM);
      return true;
    }
    play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves-talking-to-desmodus-again");
    return true;
  }

  // ---------------------------------------------------------------------------
  // Generic variant selector (the generic Talk-to path and the dialogue tests)
  // ---------------------------------------------------------------------------

  function selectVariant(event) {
    const { player, npcId } = event;
    if (!player || !npcId) return null;
    const stage = quest.getStage(player);
    if (stage === STAGE_UNSTARTED) {
      if (VELIAF_IDS.has(npcId) && meetsRequirements(player) && near(player, VELIAF_SLEPE_TILE, 12)) {
        return "slepe-s-sleeper-plague-talking-to-veliaf";
      }
      return null;
    }
    if (quest.isComplete(player)) {
      // Post-Sins Ivan keeps the canonical transcript with the medallion reclaim
      // option. Blood Moon owns Ivan while it is in progress (and after it is
      // complete); its earlier variant hook supplies that page instead.
      const bloodMoonOwned = questStarted(player, BLOOD_MOON_KEY) || questComplete(player, BLOOD_MOON_KEY);
      if (npcId === IVAN_ID && !bloodMoonOwned) {
        return "standard-dialogue-after-completing-sins-of-the-father";
      }
      return null;
    }
    if (VELIAF_IDS.has(npcId)) {
      if (stage < STAGE_HAMELN) return "slepe-s-sleeper-plague-talking-to-veliaf-talking-to-veliaf-again";
      if (stage < STAGE_FOLLOWING) return "slepe-s-sleeper-plague-talking-to-hameln-report-back-to-veliaf";
      if (stage < STAGE_LAB_DESTROYED) return null;
      if (stage < STAGE_VELIAF_REPORTED) return "an-unwelcome-surprise-reporting-back-to-veliaf";
      if (stage < STAGE_PATERDOMUS) return "an-unwelcome-surprise-checking-in-at-paterdomus";
      if (stage < STAGE_MEETING) return "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-veliaf-again";
      if (stage < STAGE_ESCORT) return "an-unwelcome-surprise-meeting-at-the-haunted-woods";
      if (stage < STAGE_BOATHOUSE) return "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott";
      if (stage < STAGE_GRAVEYARD) return "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-veliaf-again";
      if (stage < STAGE_MUSEUM_TALK) return "a-nice-and-simple-plan-meeting-at-the-icyene-graveyard";
      if (stage < STAGE_PUZZLE_DONE) return "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-veliaf";
      if (stage < STAGE_CONVINCED) {
        if (allConvinced(player)) {
          return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-after-convincing-everyone-else";
        }
        return hasBit(player, BIT_VELIAF_ASKED)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-before-convincing-everyone-else"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf";
      }
      if (stage < STAGE_LAB_PLAN) return "a-nice-and-simple-plan-weapons-upgrade-talking-to-veliaf";
      if (stage < STAGE_DISGUISE_READY) return "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-veliaf-again";
      if (stage < STAGE_DAMIEN_DONE) return "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf";
      if (stage < STAGE_DARKMEYER_PLAN) return "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf-2";
      if (stage < STAGE_FLAIL) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-without-a-blisterwood-flail";
      if (stage < STAGE_SAFALAAN_WALK) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail";
      if (stage < STAGE_CASTLE) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-veliaf-again";
      if (stage < STAGE_VANSTROM_DEAD) {
        return hasBlisterwoodFlail(player)
          ? "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-leaving-the-fight"
          : "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-dying-during-the-fight";
      }
      return null;
    }
    if (SAFALAAN_IDS.has(npcId)) {
      if (stage < STAGE_GRAVEYARD) return null;
      if (stage < STAGE_CONVINCED) return "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-safalaan";
      if (stage < STAGE_BLOODVELD) return "a-nice-and-simple-plan-the-meiyerditch-laboratories";
      if (stage < STAGE_BLOODVELD_TALK) return "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld";
      if (stage < STAGE_LAB_BOOK) return "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld-talking-to-safalaan-again";
      if (stage < STAGE_LAB_DONE) return "a-nice-and-simple-plan-talking-to-safalaan-after-getting-the-book";
      if (stage < STAGE_SAFALAAN_WALK) return "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-safalaan-again";
      if (stage < STAGE_CASTLE) return "the-final-preparations-calm-before-the-storm-talking-to-safalaan";
      return null;
    }
    if (HAMELN_IDS.has(npcId)) {
      if (stage < STAGE_STARTED || stage >= STAGE_FOLLOWING) return null;
      return stage < STAGE_HAMELN
        ? "slepe-s-sleeper-plague-talking-to-hameln"
        : "slepe-s-sleeper-plague-talking-to-hameln-talking-to-hameln-again";
    }
    if (CARL_IDS.has(npcId)) {
      if (stage < STAGE_HAMELN || stage >= STAGE_LAB_DESTROYED) return null;
      return hasBit(player, BIT_CARL_ASKED)
        ? "plague-s-end-talking-to-carl-talking-to-carl-again"
        : "plague-s-end-talking-to-carl";
    }
    if (DREZEL_IDS.has(npcId)) {
      if (stage < STAGE_VELIAF_REPORTED || stage >= STAGE_ESCORT) return null;
      return stage < STAGE_MEETING
        ? "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-drezel-again"
        : "an-unwelcome-surprise-talking-to-drezel-after-attending-the-meeting";
    }
    if (IVAN_IDS.has(npcId)) {
      if (stage < STAGE_PATERDOMUS) return null;
      if (stage < STAGE_MEETING) return "an-unwelcome-surprise-meeting-at-the-haunted-woods";
      if (stage < STAGE_ESCORT) return "an-unwelcome-surprise-escorting-ivan-again";
      if (stage < STAGE_ESCORT_DONE) return "an-unwelcome-surprise-escorting-ivan-again-talking-to-ivan-during-temple-trekking";
      if (stage < STAGE_GRAVEYARD) return "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-ivan-again";
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-ivan";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_IVAN)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan-talking-to-ivan-again-after-convincing-him"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan";
      }
      if (stage < STAGE_SAFALAAN_WALK) return "the-final-preparations-calm-before-the-storm-talking-to-ivan";
      if (stage >= STAGE_VANSTROM_DEAD) return "shattered-after-escaping-from-castle-drakan";
      return null;
    }
    if (VERTIDA_IDS.has(npcId)) {
      // The completed A Taste of Hope reclaim owns the old-base Vertida while
      // the player has no flail to hand; its page answers instead.
      if (tasteFlailReclaimDue(player, event.npc)) return null;
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-vertida";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_VERTIDA)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida-talking-to-vertida-again"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida";
      }
      if (stage < STAGE_LOGS_GIVEN) return "the-final-preparations-talking-to-vertida-without-eight-blisterwood-logs";
      if (stage < STAGE_VERTIDA_LOGS) return "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs";
      if (stage < STAGE_FLAIL) return "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-again";
      return "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-with-a-blisterwood-flail";
    }
    if (KAEL_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-kael";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_KAEL)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael-talking-to-kael-again-after-convincing-him"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael";
      }
      return "a-nice-and-simple-plan-weapons-upgrade-talking-to-kael";
    }
    if (RADIGAD_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-radigad";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_RADIGAD)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad-talking-to-radigad-again-after-convincing-him"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad";
      }
      return "a-nice-and-simple-plan-weapons-upgrade-talking-to-radigad";
    }
    if (POLMAFI_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-polmafi";
      if (stage < STAGE_CONVINCED) {
        if (hasBit(player, BIT_POLMAFI)) return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-convincing-him";
        if (hasBit(player, BIT_RADIGAD)) return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-talking-to-radigad";
        return hasBit(player, BIT_VERTIDA) || hasBit(player, BIT_KAEL) || hasBit(player, BIT_IVAN)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-before-talking-to-radigad"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi";
      }
      return "a-nice-and-simple-plan-weapons-upgrade-talking-to-polmafi";
    }
    if (VANESCULA_IDS.has(npcId)) {
      if (stage < STAGE_MUSEUM_TALK || stage >= STAGE_CASTLE) return null;
      if (stage < STAGE_PUZZLE_DONE) return "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-vanescula";
      if (stage < STAGE_CONVINCED) return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vanescula";
      if (stage < STAGE_LAB_PLAN) return "a-nice-and-simple-plan-weapons-upgrade";
      if (stage < STAGE_LAB_DONE) return "a-nice-and-simple-plan-weapons-upgrade-talking-to-vanescula";
      if (stage < STAGE_DISGUISE_BRIEF) return "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula";
      if (stage < STAGE_DISGUISE_READY) {
        return hasVyreNoble(player)
          ? "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-after-getting-a-vyre-noble-disguise"
          : "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-before-getting-a-vyre-noble-disguise";
      }
      if (stage < STAGE_DAMIEN_DONE) return "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-again";
      if (stage < STAGE_DARKMEYER) return "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise";
      if (stage < STAGE_LOGS) return "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise-talking-to-vanescula-again";
      if (stage < STAGE_LOGS_GIVEN) {
        return logCount(player) >= 8
          ? "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs"
          : "the-final-preparations-talking-to-vanescula-without-eight-blisterwood-logs";
      }
      if (stage < STAGE_FLAIL) return "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs-talking-to-vanescula-again";
      if (stage < STAGE_READY) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-vanescula-again";
      return "the-final-preparations-calm-before-the-storm-talking-to-vanescula-after-safalaan-returns";
    }
    if (MARIA_IDS.has(npcId)) {
      if (stage < STAGE_MORDAN || stage >= STAGE_ARBORETUM) return null;
      return stage < STAGE_SLAVES_DONE
        ? "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-gadderanks"
        : "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-afterwards";
    }
    if (MORDAN_IDS.has(npcId)) {
      if (stage < STAGE_DARKMEYER || stage >= STAGE_ARBORETUM) return null;
      if (stage < STAGE_PRISON) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan";
      return stage < STAGE_SLAVES_DONE
        ? "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-before-finding-desmodus-slaves"
        : "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-after-finding-desmodus-slaves";
    }
    if (DESMODUS_IDS.has(npcId)) {
      if (stage < STAGE_DARKMEYER || stage >= STAGE_LOGS) return null;
      if (stage < STAGE_MORDAN) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-lasiurus-before-attempting-to-enter-the-arboretum";
      if (stage < STAGE_PRISON) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-again-before-finding-mordan";
      if (stage < STAGE_SLAVES_DONE) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-after-finding-mordan-but-before-getting-the-slaves-back";
      if (stage < STAGE_ARBORETUM) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves";
      return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves-talking-to-desmodus-again";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Vanstrom specials (captured sayings, orb and darkness; Quest Helper phase 2)
  // ---------------------------------------------------------------------------

  function hitPlayer(player, amount) {
    const { HitDamage, HitMask } = api.core;
    player.getCombat?.().getHitQueue?.().addPendingDamage?.([new HitDamage(amount, HitMask.RED)]);
  }

  function fightState(player) {
    const state = vanstromFights.get(player);
    if (!state) return null;
    if (!state.npc || state.npc.isRegistered?.() === false || quest.getStage(player) >= STAGE_VANSTROM_DEAD) {
      cleanupVanstromFight(player);
      return null;
    }
    return state;
  }

  function cleanupVanstromFight(player) {
    const state = vanstromFights.get(player);
    if (!state) return;
    for (const npc of state.bloodvelds) api.removeNpc(npc);
    for (const object of state.objects) ObjectManager.deregister(object, true);
    vanstromNpcMeta.delete(state.npc);
    vanstromFights.delete(player);
  }

  function summonBloodveld(player, state) {
    state.npc.forceChat("My pets will feast on your corpse!");
    player.sendMessage("<col=e00a19>Vanstrom summons a bloodveld!</col>");
    const at = player.getLocation();
    const bloodveld = api.spawnNpc({
      id: ACIDIC_BLOODVELD_ID, x: at.getX() + 2, y: at.getY(), z: at.getZ(),
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    if (bloodveld) state.bloodvelds.push(bloodveld);
  }

  function castDarkness(player, state) {
    state.npc.forceChat("Stare into darkness!");
    player.sendMessage("<col=e00a19>Darkness emanates from Vanstrom!</col>");
    const at = player.getLocation();
    later(player, 2, () => {
      const here = player.getLocation();
      if (Math.max(Math.abs(here.getX() - at.getX()), Math.abs(here.getY() - at.getY())) <= 1) {
        hitPlayer(player, 15);
        player.sendMessage("<col=e00a19>You are consumed by the darkness!</col>");
      } else {
        player.sendMessage("<col=06600c>You manage to avoid the darkness.</col>");
      }
    });
  }

  function summonBloodOrb(player, state) {
    player.sendMessage("<col=e00a19>Vanstrom summons a magical blood orb!</col>");
    const at = player.getLocation();
    const orb = new GameObject(BLOOD_ORB_OBJECT_ID, new Location(at.getX(), at.getY(), at.getZ()), 10, 0, null);
    ObjectManager.register(orb, true);
    state.objects.push(orb);
    later(player, 3, () => {
      const index = state.objects.indexOf(orb);
      if (index !== -1) state.objects.splice(index, 1);
      ObjectManager.deregister(orb, true);
      const here = player.getLocation();
      if (Math.max(Math.abs(here.getX() - at.getX()), Math.abs(here.getY() - at.getY())) <= 1) {
        hitPlayer(player, 20);
        player.sendMessage("<col=e00a19>You're badly hurt by the exploding blood orb!</col>");
        player.sendMessage("The blood orb increases the damage of Vanstrom's magic attacks.");
      } else {
        player.sendMessage("You avoid the exploding blood orb.");
      }
    });
  }

  function castLightning(player, state) {
    const at = player.getLocation();
    player.sendMessage("<col=e00a19>Lightning crackles around Vanstrom!</col>");
    later(player, 1, () => {
      const here = player.getLocation();
      if (Math.max(Math.abs(here.getX() - at.getX()), Math.abs(here.getY() - at.getY())) <= 1) {
        hitPlayer(player, 20);
        player.sendMessage("<col=e00a19>You are struck by lightning!</col>");
      } else {
        player.sendMessage("You avoid the lightning.");
      }
    });
  }

  function tickVanstrom(player) {
    const state = fightState(player);
    if (!state) return;
    state.ticks++;
    if (state.phase === 2) {
      if (state.ticks % 5 === 0) castLightning(player, state);
      return;
    }
    if (state.ticks % 18 !== 0) return;
    const special = (state.ticks / 18) % 3;
    if (special === 1) summonBloodveld(player, state);
    else if (special === 2) castDarkness(player, state);
    else summonBloodOrb(player, state);
  }

  /** Castle Drakan fight arena: specials tick only for players inside it. */
  class VanstromArena extends Area {
    constructor() {
      super([new Boundary(3560, 3584, 3348, 3371, 0)]);
    }
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      tickVanstrom(mobile);
    }
  }

  function handleVanstromBeforeDeath(event) {
    const state = vanstromNpcMeta.get(event.npc);
    if (!state || state.phase !== 1) return;
    const { player } = state;
    event.preventDeath = true;
    state.phase = 2;
    state.ticks = 0;
    event.npc.setNpcTransformationId(VANSTROM_ENRAGE_ID);
    event.npc.setHitpoints(200);
    event.npc.getCombat?.()?.reset?.();
    event.npc.forceChat("No! I will not be defeated!");
    player.sendMessage("<col=e00a19>Vanstrom draws on the power of the storm!</col>");
    player.sendMessage("Vanstrom has healed to 200 hitpoints. Move off the lightning!");
  }

  // ---------------------------------------------------------------------------
  // NPC deaths
  // ---------------------------------------------------------------------------

  function handleNpcDeath(event) {
    const killer = event.killer;
    if (!killer || killer.isPlayer?.() !== true) return;
    const player = killer;
    const stage = quest.getStage(player);
    if (event.npcId === KROY_FIGHT_ID && stage >= STAGE_KROY_FIGHT && stage < STAGE_KROY_DEAD) {
      despawnKey(player, "kroy_fight");
      advance(player, STAGE_KROY_DEAD);
      play(player, KROY_FIGHT_ID, "plague-s-end-after-killing-kroy");
      player.sendMessage("You should destroy the two lab tables.");
      return;
    }
    if (event.npcId === BLOODVELD_ID && stage === STAGE_BLOODVELD) {
      despawnKey(player, "bloodveld");
      player.sendMessage("Safalaan: Well done... now help me up.");
      return;
    }
    if (event.npcId === DAMIEN_FIGHT_ID && stage >= STAGE_DISGUISE_READY && stage < STAGE_DAMIEN_DONE) {
      despawnKey(player, "damien_fight");
      play(player, DAMIEN_FIGHT_ID, "a-vyre-ry-noble-disguise-going-back-to-slepe-death-of-damien");
      return;
    }
    if (stage === STAGE_ESCORT) {
      if (event.npcId === ZOMBIE_NPC_ID) {
        api.removeNpc(event.npc);
        if (!hasAxe(player)) give(player, BRONZE_AXE_ITEM_ID, 1);
        player.sendMessage("The zombie drops an axe.");
        applyStageSpawns(player);
        syncQuestObjects(player);
        return;
      }
      if (event.npcId === NAIL_BEAST_IDS[0] || event.npcId === NAIL_BEAST_IDS[1]) {
        api.removeNpc(event.npc);
        const kills = field(player, NAIL_SHIFT) + 1;
        setField(player, NAIL_SHIFT, 2, kills);
        if (kills >= 2) player.sendMessage("Ivan: The bridge is out. We'll need logs and an axe.");
        applyStageSpawns(player);
        syncQuestObjects(player);
        return;
      }
      if (event.npcId === JUVI_IDS[0] || event.npcId === JUVI_IDS[1]) {
        api.removeNpc(event.npc);
        const kills = field(player, JUVI_SHIFT) + 1;
        setField(player, JUVI_SHIFT, 2, kills);
        if (kills >= 2) {
          later(player, 1, () =>
            play(player, IVAN_ESCORT_ID, "an-unwelcome-surprise-escorting-ivan-again-finishing-temple-trekking")
          );
        } else {
          applyStageSpawns(player);
        }
        return;
      }
    }
    if ((event.npcId === VANSTROM_FIGHT_ID || event.npcId === VANSTROM_ENRAGE_ID) && stage >= STAGE_CASTLE && stage < STAGE_VANSTROM_DEAD) {
      cleanupVanstromFight(player);
      despawnKey(player, "vanstrom_fight");
      play(player, VANSTROM_FIGHT_ID, "shattered-after-defeating-vanstrom");
    }
  }

  // ---------------------------------------------------------------------------
  // Object interactions
  // ---------------------------------------------------------------------------

  function handleBarrel(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_HAMELN || stage >= STAGE_KROY_FIGHT) return false;
    event.handled = true;
    playCamera(player, CAMERA_CARL_FOLLOW);
    play(player, PROP_ID, "plague-s-end-barrel-investigation");
    return true;
  }

  function handleCrackedWall(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    const location = player.getLocation();
    if (!near(player, { x: 3627, y: 3330 }, 4)) return false;
    event.handled = true;
    if (location.getY() >= 3331) {
      teleport(player, CRACK_MEIYERDITCH);
      return true;
    }
    if (stage < STAGE_DARKMEYER) {
      say(player, PROP_ID, "The crack is too narrow to squeeze through.");
      return true;
    }
    teleport(player, DARKMEYER_ARRIVAL);
    player.sendMessage("You squeeze through the crack into Darkmeyer.");
    return true;
  }

  function openBoatMenu(player) {
    api.sendMultiChatboxPrompt(
      player,
      "Where would you like to sail?",
      "Burgh de Rott.",
      () => teleport(player, BURGH_LANDING),
      "Slepe.",
      () => teleport(player, SLEPE_DOCK),
      "Icyene Graveyard.",
      () => teleport(player, ICYENE_LANDING)
    );
  }

  function handleBoat(event) {
    const { player, objectId } = event;
    const location = event.location ?? event.object?.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    if (objectId === SLEPE_ROWBOAT_OBJECT_ID && (x !== SLEPE_DOCK.x - 4 || y !== SLEPE_DOCK.y || z !== SLEPE_DOCK.z)) return false;
    if (objectId !== BOAT_OBJECT_ID && objectId !== SLEPE_ROWBOAT_OBJECT_ID) return false;
    event.handled = true;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      openBoatMenu(player);
      return true;
    }
    // The player stands on the shore beside the water-anchored boat object.
    if (near(player, BURGH_LANDING, 8) && stage >= STAGE_ESCORT_DONE) {
      teleport(player, ICYENE_LANDING);
      if (stage < STAGE_GRAVEYARD) advance(player, STAGE_GRAVEYARD);
      return true;
    }
    if (near(player, ICYENE_DOCK, 4) && stage >= STAGE_GRAVEYARD) {
      teleport(player, BURGH_LANDING);
      return true;
    }
    return true;
  }

  function cutTrekVines(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_ESCORT || hasBit(player, BIT_TREK)) return false;
    event.handled = true;
    if (!hasKnife(player)) {
      player.sendMessage("You need a knife to cut the vines.");
      return true;
    }
    const held = player.getInventory().getAmount(SHORT_VINE_ITEM_ID);
    if (held >= 3) {
      player.sendMessage("You have enough short vines.");
      return true;
    }
    give(player, SHORT_VINE_ITEM_ID, 1);
    player.sendMessage("You slice a vine from the tree.");
    return true;
  }

  function searchTrekRucksack(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_ESCORT || hasBit(player, BIT_TREK)) return false;
    event.handled = true;
    if (!hasKnife(player)) {
      give(player, KNIFE_ITEM_ID, 1);
      player.sendMessage("You find a knife in the rucksack.");
    } else {
      player.sendMessage("You search the rucksack but find nothing else useful.");
    }
    return true;
  }

  function chopBridgeTree(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_ESCORT || field(player, NAIL_SHIFT) < 2) return false;
    event.handled = true;
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to chop the dead tree.");
      return true;
    }
    give(player, LOGS_ITEM_ID, 1);
    player.sendMessage("You swing your axe at the tree.");
    player.sendMessage("You get some logs.");
    return true;
  }

  function useBridge(event) {
    const { player, objectId } = event;
    if (quest.getStage(player) !== STAGE_ESCORT) return false;
    const repairs = bridgeRepairs(player);
    const index = BRIDGE_OBJECT_IDS.indexOf(objectId);
    if (index === -1 || index !== repairs) return false;
    event.handled = true;
    if (repairs >= 3) {
      setBit(player, BIT_BRIDGE);
      player.sendMessage("You walk across the fixed bridge.");
      teleport(player, TREK_JUVI_TILES[0]);
      applyStageSpawns(player);
      return true;
    }
    if (!hasAxe(player)) {
      player.sendMessage("You'll need an axe equipped or in your inventory to fix the bridge.");
      return true;
    }
    if (!held(player, LOGS_ITEM_ID)) {
      player.sendMessage("You need some logs to repair the bridge.");
      return true;
    }
    player.getInventory().deleteNumber(LOGS_ITEM_ID, 1);
    setBridgeRepairs(player, repairs + 1);
    player.sendMessage("You place a log down over the shaky wooden support struts.");
    player.sendMessage("You carefully use your axe to tap the log into place.");
    syncQuestObjects(player);
    return true;
  }

  function ownsNoblePiece(player, itemId) {
    if (held(player, itemId)) return true;
    if ((player.getEquipment().getItems() || []).some((item) => item?.getId?.() === itemId)) return true;
    return (player.getBanks?.() ?? []).some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  }

  function disguiseChestEvent(event, objectId) {
    if (!event?.player || event.objectId !== objectId) return false;
    const location = event.location ?? event.object?.getLocation?.();
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const z = location?.z ?? location?.getZ?.() ?? 0;
    return x === DISGUISE_CHEST_TILE.x && y === DISGUISE_CHEST_TILE.y && z === DISGUISE_CHEST_TILE.z;
  }

  function hasOpenDisguiseChest(player) {
    const object = personalObjects.get(player)?.get(personalKey(DISGUISE_CHEST_TILE));
    return object?.getId?.() === DISGUISE_CHEST_OPEN_ID;
  }

  function openDisguiseChest(event) {
    if (quest.getStage(event.player) < STAGE_DISGUISE_MADE) return false;
    if (!disguiseChestEvent(event, DISGUISE_CHEST_CLOSED_ID)) return false;
    event.handled = true;
    syncPersonalObject(event.player, DISGUISE_CHEST_TILE, DISGUISE_CHEST_OPEN_ID, 10, 2);
    return true;
  }

  function searchDisguiseChest(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_DISGUISE_MADE) return false;
    if (!disguiseChestEvent(event, DISGUISE_CHEST_OPEN_ID) || !hasOpenDisguiseChest(player)) return false;
    event.handled = true;
    // Polmafi's spares are the noble disguise; after Damien's blood the set is scented.
    const pieces = quest.getStage(player) >= STAGE_DAMIEN_DONE ? VYRE_NOBLE_SCENTED_IDS : VYRE_NOBLE_UNSCENTED_IDS;
    for (const itemId of pieces) {
      if (ownsNoblePiece(player, itemId)) continue;
      if (!give(player, itemId, 1)) break;
    }
    return true;
  }

  function shutDisguiseChest(event) {
    if (quest.getStage(event.player) < STAGE_DISGUISE_MADE) return false;
    if (!disguiseChestEvent(event, DISGUISE_CHEST_OPEN_ID) || !hasOpenDisguiseChest(event.player)) return false;
    event.handled = true;
    clearPersonalObject(event.player, DISGUISE_CHEST_TILE);
    return true;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || event.handled) return;
    if (objectId === SWAMP_VINES_OBJECT_ID) {
      cutTrekVines(event);
      return;
    }
    if (objectId === SWAMP_RUCKSACK_OBJECT_ID) {
      searchTrekRucksack(event);
      return;
    }
    if (objectId === DEAD_TREE_OBJECT_ID) {
      chopBridgeTree(event);
      return;
    }
    if (BRIDGE_OBJECT_IDS.includes(objectId)) {
      useBridge(event);
      return;
    }
    if (objectId === BARREL_OBJECT_ID) {
      handleBarrel(event);
      return;
    }
    if (objectId === CRACKED_WALL_OBJECT_ID) {
      handleCrackedWall(event);
      return;
    }
    if (objectId === BOAT_OBJECT_ID || objectId === SLEPE_ROWBOAT_OBJECT_ID) {
      handleBoat(event);
      return;
    }
    if (objectId === HIDEOUT_CRATE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_LOGS_GIVEN) return;
      event.handled = true;
      if (!held(player, SILVER_SICKLE_BLESSED_ITEM_ID)) {
        give(player, SILVER_SICKLE_BLESSED_ITEM_ID, 1);
        player.sendMessage("You find a silver sickle (b).");
      }
      return;
    }
    if (objectId === SWAMP_TREE_OBJECT_ID) {
      if (quest.getStage(player) !== STAGE_ESCORT) return;
      event.handled = true;
      if (!hasBit(player, BIT_TREK)) {
        if (!player.getAttribute(VINE_ATTACHED_ATTRIBUTE)) {
          play(player, IVAN_ESCORT_ID, "an-unwelcome-surprise-escorting-ivan-again-vine-puzzle");
          return;
        }
        play(player, IVAN_ESCORT_ID, "an-unwelcome-surprise-escorting-ivan-again-after-crossing");
        setBit(player, BIT_TREK);
        teleport(player, TREK_CROSSED);
        applyStageSpawns(player);
        syncQuestObjects(player);
      } else {
        teleport(player, TREK_CROSSED);
      }
      return;
    }
    if (objectId === LAB_ESCAPE_GATE_ID) {
      if (quest.getStage(player) < STAGE_KROY_DEAD) return;
      event.handled = true;
      teleport(player, { x: 3726, y: 3356, z: 0 });
      return;
    }
  }

  function handleClimbRequest(request) {
    if (request.handled || request.clickType !== 1) return;
    if (request.objectId !== CRYPT_STAIRS_OBJECT_ID) return;
    const { player, object } = request;
    const location = object?.getLocation?.();
    if (!player || !location || location.getZ() !== 0) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FOLLOWING || stage >= STAGE_LAB_DESTROYED) return;
    if (!hasBit(player, BIT_TRAIL)) {
      request.handled = true;
      player.sendMessage("You should follow Carl first.");
      return;
    }
    request.handled = true;
    if (stage >= STAGE_CARL_DONE) {
      beginKroyCryptScene(player);
      return;
    }
    startDialogue(api, player, { npcId: PROP_ID }, [{
      options: [
        { text: "Continue the Sins of the Father quest.", next: [{ exec: () => beginKroyCryptScene(player) }] },
        { text: "Not yet." },
      ],
    }]);
  }

  /** The captured crypt cutscene after the Continue choice: camera, Kroy room, eavesdrop. */
  function beginKroyCryptScene(player) {
    if (quest.getStage(player) < STAGE_CARL_DONE) advance(player, STAGE_CARL_DONE);
    playCamera(player, CAMERA_CRYPT_KROY);
    later(player, 3, () => {
      teleport(player, KROY_ARRIVAL);
      play(player, PROP_ID, "plague-s-end-eavesdropping-on-carl");
    });
  }

  function handleDoorToggle(request) {
    if (request.handled || !request.player) return;
    if (!ARBORETUM_DOOR_IDS.has(request.objectId)) return;
    const stage = quest.getStage(request.player);
    if (stage >= STAGE_ARBORETUM) return;
    if (stage < STAGE_DARKMEYER) return;
    request.handled = true;
    play(request.player, NpcIdentifiers.DESMODUS_LASIURUS, "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum");
  }

  function destroyLabTable(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_KROY_DEAD || quest.getStage(player) >= STAGE_LAB_DESTROYED) return false;
    const location = event.location ?? event.object?.getLocation?.();
    if (!location) return false;
    const tile = KROY_TABLE_TILES.find(
      (entry) => entry.x === location.x && entry.y === location.y && entry.z === location.z
    );
    if (!tile) return false;
    event.handled = true;
    const bit = tile === KROY_TABLE_TILES[0] ? BIT_TABLE_1 : BIT_TABLE_2;
    if (!hasBit(player, bit)) {
      setBit(player, bit);
      syncQuestObjects(player);
      syncVisuals(player);
      player.sendMessage("You smash the lab table.");
    }
    if (hasBit(player, BIT_TABLE_1) && hasBit(player, BIT_TABLE_2)) {
      advance(player, STAGE_LAB_DESTROYED);
      play(player, PROP_ID, "plague-s-end-after-destroying-the-lab-tables");
    }
    return true;
  }

  function unlockMausoleum(event) {
    const { player } = event;
    if (!near(player, MAUSOLEUM_DOOR_TILE, 6)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MUSEUM_TALK) return false;
    if (stage >= STAGE_PUZZLE_DONE) return false;
    event.handled = true;
    if (!hasBit(player, BIT_PUZZLE_PLAYED)) {
      setBit(player, BIT_PUZZLE_PLAYED);
      play(player, VANESCULA_ID, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1");
      advance(player, STAGE_PUZZLE_READY);
      return true;
    }
    openTombPuzzle(player);
    return true;
  }

  function tombPuzzleFor(player) {
    let puzzle = tombPuzzleByPlayer.get(player);
    if (puzzle) return puzzle;
    let cells;
    do {
      cells = 0;
      for (let index = 0; index < TOMB_PUZZLE_SIZE * TOMB_PUZZLE_SIZE; index++) {
        if (Math.random() < 0.45) cells |= 1 << index;
      }
    } while (!cells);
    const rowSums = [], colSums = [];
    for (let row = 0; row < TOMB_PUZZLE_SIZE; row++) {
      let sum = 0;
      for (let col = 0; col < TOMB_PUZZLE_SIZE; col++) {
        if (cells & (1 << (row * TOMB_PUZZLE_SIZE + col))) sum += col + 1;
      }
      rowSums.push(sum);
    }
    for (let col = 0; col < TOMB_PUZZLE_SIZE; col++) {
      let sum = 0;
      for (let row = 0; row < TOMB_PUZZLE_SIZE; row++) {
        if (cells & (1 << (row * TOMB_PUZZLE_SIZE + col))) sum += row + 1;
      }
      colSums.push(sum);
    }
    puzzle = { cells: 0, rowSums, colSums };
    tombPuzzleByPlayer.set(player, puzzle);
    return puzzle;
  }

  function openTombPuzzle(player) {
    const puzzle = tombPuzzleFor(player);
    const sender = player.getPacketSender();
    sender.sendSubInterface(TOMB_PUZZLE_OVERLAY, TOMB_PUZZLE_GROUP, 0);
    TOMB_PUZZLE_COLUMNS.forEach((component, index) =>
      sender.sendString(String(puzzle.colSums[index]), (TOMB_PUZZLE_GROUP << 16) | component));
    TOMB_PUZZLE_ROWS.forEach((component, index) =>
      sender.sendString(String(puzzle.rowSums[index]), (TOMB_PUZZLE_GROUP << 16) | component));
  }

  function tombPuzzleSolved(puzzle) {
    for (let row = 0; row < TOMB_PUZZLE_SIZE; row++) {
      let sum = 0;
      for (let col = 0; col < TOMB_PUZZLE_SIZE; col++) {
        if (puzzle.cells & (1 << (row * TOMB_PUZZLE_SIZE + col))) sum += col + 1;
      }
      if (sum !== puzzle.rowSums[row]) return false;
    }
    for (let col = 0; col < TOMB_PUZZLE_SIZE; col++) {
      let sum = 0;
      for (let row = 0; row < TOMB_PUZZLE_SIZE; row++) {
        if (puzzle.cells & (1 << (row * TOMB_PUZZLE_SIZE + col))) sum += row + 1;
      }
      if (sum !== puzzle.colSums[col]) return false;
    }
    return true;
  }

  function handleTombPuzzleButton(event) {
    const { player } = event;
    const puzzle = tombPuzzleByPlayer.get(player);
    if (!puzzle) return;
    const slot = Number.isInteger(event.slot) ? event.slot : event.childId;
    if (!Number.isInteger(slot) || slot < 0 || slot >= TOMB_PUZZLE_SIZE * TOMB_PUZZLE_SIZE) return;
    event.handled = true;
    puzzle.cells ^= 1 << slot;
    if (!tombPuzzleSolved(puzzle)) return;
    tombPuzzleByPlayer.delete(player);
    player.getPacketSender().closeSubInterface(TOMB_PUZZLE_OVERLAY);
    playCamera(player, CAMERA_MAUSOLEUM);
    say(player, VANESCULA_ID, "The puzzle shifts under your fingers, and the door swings open.");
    advance(player, STAGE_PUZZLE_DONE);
    syncQuestObjects(player);
    later(player, 1, () => play(player, SAFALAAN_ID, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-2"));
  }

  function openMausoleum(event) {
    const { player } = event;
    if (!near(player, MAUSOLEUM_DOOR_TILE, 6)) return false;
    if (quest.getStage(player) < STAGE_PUZZLE_DONE) return false;
    event.handled = true;
    teleport(player, MAUSOLEUM_INSIDE);
    return true;
  }

  function searchArboretumShelves(event) {
    const { player, objectId } = event;
    if (objectId !== ARBORETUM_SHELVES_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_ARBORETUM) return false;
    event.handled = true;
    if (!held(player, OLD_NOTE_ITEM_ID)) {
      give(player, OLD_NOTE_ITEM_ID, 1);
      player.sendMessage("You find an old note among the fallen shelves.");
    } else {
      player.sendMessage("You search the shelves but find nothing else of interest.");
    }
    return true;
  }

  function closeValveMenu(player) {
    if (!valveMenus.has(player)) return;
    valveMenus.delete(player);
    const sender = player.getPacketSender();
    sender.closeSubInterface(VALVE_MAIN_MODAL);
    sender.sendInterfaceScript(VALVE_SCRIPT_RESTORE_INPUT);
    player.setInterfaceId(-1);
  }

  function valveMenuClosed({ player, interfaceId }) {
    if (interfaceId !== VALVE_MENU || !valveMenus.has(player)) return;
    valveMenus.delete(player);
    player.getPacketSender().sendInterfaceScript(VALVE_SCRIPT_RESTORE_INPUT);
    player.setInterfaceId(-1);
  }

  function turnValve(event) {
    const { player, objectId } = event;
    if (objectId !== VALVE_NORTH_OBJECT_ID && objectId !== VALVE_SOUTH_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_ARBORETUM) return false;
    event.handled = true;
    const shift = objectId === VALVE_NORTH_OBJECT_ID ? VALVE_NORTH_SHIFT : VALVE_SOUTH_SHIFT;
    const current = field(player, shift, 3);
    const options = [];
    for (let value = 0; value <= 5; value++) {
      options.push(value === current ? `${value} (current)` : String(value));
    }
    options.push("(Cancel)");
    valveMenus.set(player, { shift });
    const sender = player.getPacketSender();
    sender.sendInterfaceScript(VALVE_SCRIPT_MAINMODAL_OPEN, [-1, -1]);
    player.setInterfaceId(VALVE_MENU);
    sender.sendSubInterface(VALVE_MAIN_MODAL, VALVE_MENU, 0);
    sender.sendClientScript(VALVE_SCRIPT_MENU, "What would you like to set the valve to?", options.join("|"), false);
    sender.sendInterfaceFlagsRange(VALVE_MENU_UID, 0, VALVE_MENU_SLOTS, VALVE_PAUSE_BUTTON);
    return true;
  }

  function chooseValve(event) {
    const { player } = event;
    const buttonId = Number(event.buttonId ?? 0);
    if ((event.groupId ?? (buttonId >>> 16)) !== VALVE_MENU ||
        (event.childId ?? (buttonId & 0xffff)) !== VALVE_MENU_CHOICES) return;
    const pending = player && valveMenus.get(player);
    if (!pending) return;
    const choice = Number(event.action);
    if (!Number.isInteger(choice) || choice < 0 || choice > 6) return;
    event.handled = true;
    closeValveMenu(player);
    if (choice === 6) return;
    setField(player, pending.shift, 3, choice);
    player.sendMessage(`You set the valve to ${choice}.`);
    if (waterTotal(player) === requiredGallons(player)) {
      player.sendMessage("Water begins to flow through the arboretum's irrigation.");
    }
  }

  function chopBlisterwood(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_ARBORETUM || quest.getStage(player) >= STAGE_LOGS) return false;
    event.handled = true;
    const required = requiredGallons(player);
    if (waterTotal(player) !== required) {
      player.sendMessage("The tree is too dry to cut. You should set the valves by the entrance.");
      return true;
    }
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to chop the Blisterwood tree.");
      return true;
    }
    if (logCount(player) >= 8) return true;
    give(player, BLISTERWOOD_LOGS_ITEM_ID, 1);
    if (logCount(player) >= 8) {
      advance(player, STAGE_LOGS);
      player.sendMessage("You have eight blisterwood logs.");
    }
    return true;
  }

  function searchLabBookshelf(event) {
    const { player, objectId } = event;
    if (objectId !== LAB_BOOKSHELF_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_BLOODVELD_TALK || stage >= STAGE_LAB_DONE) return false;
    event.handled = true;
    if (!held(player, HAEMALCHEMY_VOL_2_ITEM_ID)) {
      give(player, HAEMALCHEMY_VOL_2_ITEM_ID, 1);
      player.sendMessage("You find a book of haemalchemy research on the bookshelf.");
      if (stage < STAGE_LAB_BOOK) advance(player, STAGE_LAB_BOOK);
    } else {
      player.sendMessage("You search the bookshelf but find nothing else of interest.");
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Item handlers
  // ---------------------------------------------------------------------------

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === SWAMP_VINES_OBJECT_ID && itemId === KNIFE_ITEM_ID) {
      cutTrekVines(event);
      return;
    }
    if (objectId === SWAMP_BRANCH_OBJECT_ID && itemId === LONG_VINE_ITEM_ID) {
      if (quest.getStage(player) !== STAGE_ESCORT || hasBit(player, BIT_TREK)) return;
      event.handled = true;
      player.getInventory().deleteNumber(LONG_VINE_ITEM_ID, 1);
      player.setAttribute(VINE_ATTACHED_ATTRIBUTE, true);
      player.sendMessage("You throw the vine up and wrap it around the branch.");
      syncQuestObjects(player);
      return;
    }
    if (objectId === SWAMP_BRANCH_OBJECT_ID && itemId === SHORT_VINE_ITEM_ID) {
      event.handled = true;
      player.sendMessage("You don't think the short vine will reach, but something similar might.");
      return;
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = new Set([usedItemId, usedWithItemId]);
    const stage = quest.getStage(player);
    if (usedItemId === SHORT_VINE_ITEM_ID && usedWithItemId === SHORT_VINE_ITEM_ID) {
      if (stage !== STAGE_ESCORT || hasBit(player, BIT_TREK)) return;
      event.handled = true;
      if (player.getInventory().getAmount(SHORT_VINE_ITEM_ID) < 3) {
        player.sendMessage("You need at least three short vines in order to make a long vine.");
        return;
      }
      player.getInventory().deleteNumber(SHORT_VINE_ITEM_ID, 3);
      give(player, LONG_VINE_ITEM_ID, 1);
      player.sendMessage("You twist the vines together to make a long vine.");
      syncQuestObjects(player);
      return;
    }
    if (pair.has(RUBY_ITEM_ID) && pair.has(SILVER_SICKLE_BLESSED_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      if (!held(player, CHISEL_ITEM_ID)) {
        player.sendMessage("You need a chisel to set the ruby into the sickle.");
        return;
      }
      player.getInventory().deleteNumber(RUBY_ITEM_ID, 1);
      player.getInventory().deleteNumber(SILVER_SICKLE_BLESSED_ITEM_ID, 1);
      give(player, RUBY_SICKLE_ITEM_ID, 1);
      player.sendMessage("You embed the ruby into the silver sickle.");
      return;
    }
    if (pair.has(COSMIC_RUNE_ITEM_ID) && pair.has(RUBY_SICKLE_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      if (!held(player, FIRE_RUNE_ITEM_ID, 5)) {
        player.sendMessage("You need 5 fire runes and a cosmic rune for Lvl-3 Enchant.");
        return;
      }
      player.getInventory().deleteNumber(COSMIC_RUNE_ITEM_ID, 1);
      player.getInventory().deleteNumber(FIRE_RUNE_ITEM_ID, 5);
      player.getInventory().deleteNumber(RUBY_SICKLE_ITEM_ID, 1);
      give(player, ENCHANTED_RUBY_SICKLE_ITEM_ID, 1);
      player.sendMessage("You enchant the ruby sickle.");
      return;
    }
    if (pair.has(ENCHANT_RUBY_TABLET_ITEM_ID) && pair.has(RUBY_SICKLE_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      player.getInventory().deleteNumber(ENCHANT_RUBY_TABLET_ITEM_ID, 1);
      player.getInventory().deleteNumber(RUBY_SICKLE_ITEM_ID, 1);
      give(player, ENCHANTED_RUBY_SICKLE_ITEM_ID, 1);
      player.sendMessage("You enchant the ruby sickle.");
      return;
    }
    if (pair.has(BLISTERWOOD_LOGS_ITEM_ID) && pair.has(ENCHANTED_RUBY_SICKLE_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      if (!held(player, KNIFE_ITEM_ID)) {
        player.sendMessage("You need a knife to carve the blisterwood.");
        return;
      }
      player.getInventory().deleteNumber(BLISTERWOOD_LOGS_ITEM_ID, 1);
      player.getInventory().deleteNumber(ENCHANTED_RUBY_SICKLE_ITEM_ID, 1);
      give(player, BLISTERWOOD_SICKLE_ITEM_ID, 1);
      player.sendMessage("You carve a blisterwood sickle.");
      return;
    }
    if (pair.has(BLISTERWOOD_SICKLE_ITEM_ID) && pair.has(IVANDIS_FLAIL_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      player.getInventory().deleteNumber(BLISTERWOOD_SICKLE_ITEM_ID, 1);
      player.getInventory().deleteNumber(IVANDIS_FLAIL_ITEM_ID, 1);
      give(player, BLISTERWOOD_FLAIL_ITEM_ID, 1);
      give(player, ENCHANTED_EMERALD_SICKLE_ITEM_ID, 1);
      advance(player, STAGE_FLAIL);
      player.sendMessage("You attach the blisterwood sickle to the Ivandis flail.");
      return;
    }
  }

  function readTome(event) {
    const { player, itemId, item, slot } = event;
    if (itemId !== TOME_ITEM_ID) return false;
    if (!quest.isComplete(player)) return false;
    if (player.getInventory().get(slot) !== item) return false;
    const chapters = Number(player.getAttribute(TOME_USES_ATTRIBUTE)) || 0;
    if (chapters >= TOME_MAX_CHAPTERS) return true;
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: 60,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        if (player.getInventory().get(slot) !== item) return null;
        const used = (Number(player.getAttribute(TOME_USES_ATTRIBUTE)) || 0) + 1;
        player.setAttribute(TOME_USES_ATTRIBUTE, used);
        if (used >= TOME_MAX_CHAPTERS) player.getInventory().deleteAtSlot(slot, 1);
        player.getSkillManager().addExperience(skill, 15000, false);
        return `You have been awarded 15,000 ${name} XP!`;
      },
    });
    return true;
  }

  function readOldNote(event) {
    const { player, itemId } = event;
    if (itemId !== OLD_NOTE_ITEM_ID) return false;
    if (quest.getStage(player) < STAGE_ARBORETUM) return false;
    player.sendMessage(`The old note says the tree needs ${requiredGallons(player)} gallons of water.`);
    return true;
  }

  function teleportMedallion(event) {
    const { player, itemId } = event;
    if (itemId !== DRAKANS_MEDALLION_ITEM_ID) return false;
    if (!quest.isComplete(player)) return false;
    const destinations = [
      { label: "Ver Sinhaza.", tile: VER_SINHAZA },
      { label: "Slepe.", tile: SLEPE_DOCK },
      { label: "Darkmeyer.", tile: DARKMEYER },
    ];
    // Later Myreque chapters can add a destination unlocked by their own
    // world interaction without replacing this shared medallion menu.
    api.emitCustomEvent("drakan-medallion:destinations", { player, destinations });
    const options = destinations.flatMap(({ label, tile, onTeleport }) => [label, () => {
      teleport(player, tile);
      onTeleport?.();
    }]);
    api.sendMultiChatboxPrompt(
      player,
      "Where would you like to teleport?",
      ...options
    );
    return true;
  }

  // ---------------------------------------------------------------------------
  // Login / relog
  // ---------------------------------------------------------------------------

  // The pre-change ladder (10..300). Its values overlap the native ones, so a
  // save is only interpreted through this map once, before the schema marker is
  // written. Every native transition writes the marker (handleStageChanged).
  const LEGACY_STAGE_MAP = {
    10: 2, 20: 6, 30: 12, 40: 16, 50: 18, 60: 20, 70: 22, 80: 24, 90: 34,
    100: 36, 110: 38, 115: 40, 120: 44, 125: 48, 127: 52, 130: 54, 140: 56,
    145: 58, 150: 62, 152: 64, 155: 66, 160: 68, 165: 72, 170: 80, 180: 86,
    185: 88, 190: 90, 195: 92, 200: 94, 205: 98, 210: 100, 220: 112, 230: 114,
    240: 116, 245: 118, 250: 120, 260: 122, 265: 126, 270: 130, 280: 132, 300: 138,
  };

  function markSchema(player) {
    if (Number(player.getAttribute(SCHEMA_ATTRIBUTE)) === SCHEMA_VERSION) return;
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
  }

  function migrateLegacyStage(player) {
    if (Number(player.getAttribute(SCHEMA_ATTRIBUTE)) === SCHEMA_VERSION) return;
    const native = LEGACY_STAGE_MAP[quest.getStage(player)];
    if (native !== undefined) quest.setStage(player, native);
    markSchema(player);
  }

  /** Re-sync personal anchors after a real map load (login may precede it). */
  function handleRegionLoaded() {
    for (const player of api.core.World?.getPlayers?.() ?? []) {
      if (!player || player.isPlayerBot?.() === true) continue;
      if (quest.getStage(player) > STAGE_UNSTARTED || personalObjects.has(player)) {
        syncQuestObjects(player);
      }
    }
  }

  function handleLogin({ player }) {
    migrateLegacyStage(player);
    sweepStaleOwnedNpcs(player);
    applyStageSpawns(player);
    syncVisuals(player);
    syncQuestObjects(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    valveMenus.delete(player);
    resetCamera(player);
    cleanupVanstromFight(player);
    clearPersonalObjects(player);
    removeCarlFollow(player);
    for (const npc of carlFailureActors.get(player) ?? []) api.removeNpc(npc);
    carlFailureActors.delete(player);
    despawnAll(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(TOME_USES_ATTRIBUTE);
  api.persistAttribute(VAMPYRE_NAME_ATTRIBUTE);
  api.persistAttribute(BRIDGE_ATTRIBUTE, 0);
  api.persistAttribute(VINE_ATTACHED_ATTRIBUTE, false);
  api.persistAttribute(SCHEMA_ATTRIBUTE, 0);
  api.persistAttribute(CARL_PROGRESS_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "sins_of_the_father",
    name: "Sins of the Father",
    varpId: 2712, // myq5
    varbitId: 7255, // myq5 (bits 0-8)
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    rewardItemId: TOME_ITEM_ID,
    rewardItemLabel: "Tome of Experience",
    // Live 226 completion scroll displays the Blisterwood flail (24697).
    scrollItemId: BLISTERWOOD_FLAIL_ITEM_ID,
    otherRewards: [
      "Access to Darkmeyer",
      "The Blisterwood flail",
      "Boat travel to Slepe and the Icyene Graveyard",
      "Darkmeyer teleport via Drakan's medallion",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptText);
  api.onCustomEvent("npc-dialogue:line", handleNpcLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("ladders:climb", handleClimbRequest);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Safalaan Hallow", { "Talk-to": talkSafalaan });
  api.onNpcInteraction("Vanescula Drakan", { "Talk-to": talkVanescula });
  api.onNpcInteraction("Vertida Sefalatis", { "Talk-to": talkVertida });
  api.onNpcInteraction("Kael Forshaw", { "Talk-to": talkKael });
  api.onNpcInteraction("Radigad Ponfit", { "Talk-to": talkRadigad });
  api.onNpcInteraction("Polmafi Ferdygris", { "Talk-to": talkPolmafi });
  api.onNpcInteraction("Ivan Strom", { "Talk-to": talkIvan });
  api.onNpcInteraction("Drezel", { "Talk-to": talkDrezel });
  api.onNpcInteraction("Hameln the Jester", { "Talk-to": talkHameln });
  api.onNpcInteraction("Carl", { "Talk-to": talkCarl });
  api.onNpcInteraction("Maria Gadderanks", { "Talk-to": talkMaria });
  api.onNpcInteraction("Mordan Nikazsi", { "Talk-to": talkMordan });
  api.onNpcInteraction("Desmodus Lasiurus", { "Talk-to": talkDesmodus });
  api.onObjectInteraction("Barrel", { Inspect: handleBarrel });
  api.onObjectInteraction("Closed Chest", { Open: openDisguiseChest });
  api.onObjectInteraction("Open Chest", { Search: searchDisguiseChest, Shut: shutDisguiseChest });
  api.onObjectInteraction("Cracked wall", { Enter: handleCrackedWall });
  api.onObjectInteraction("Blisterwood tree", { Chop: chopBlisterwood });
  api.onObjectInteraction("Bookshelf", { Search: searchLabBookshelf });
  api.onObjectInteraction("Shelves", { Search: searchArboretumShelves });
  api.onObjectInteraction("Valve", { Turn: turnValve });
  api.onObjectInteraction("Lab table", { Destroy: destroyLabTable });
  api.onObjectInteraction("Mausoleum door", { Unlock: unlockMausoleum, Open: openMausoleum });
  api.onObjectInteraction([MAUSOLEUM_DOOR_BASE_OBJECT_ID, MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID,
    MAUSOLEUM_DOOR_OPEN_OBJECT_ID, MAUSOLEUM_DOOR_UNLOCKED_OBJECT_ID],
  { Unlock: unlockMausoleum, Open: openMausoleum });
  api.onInterfaceActionButton(TOMB_PUZZLE_BUTTONS, handleTombPuzzleButton);
  api.onInterfaceActionClick(chooseValve);
  api.onCustomEvent("interface:closed", valveMenuClosed);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Tome of Experience", { Read: readTome });
  api.onItemAction("Old note", { Read: readOldNote });
  api.onItemAction("Drakan's medallion", { Teleport: teleportMedallion });
  api.onNpcDeath(handleNpcDeath);
  api.onNpcBeforeDeath(handleVanstromBeforeDeath);
  api.registerArea(new CarlFollowArea());
  api.registerArea(new VanstromArena());
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
  api.onRegionLoaded(handleRegionLoaded);
};
