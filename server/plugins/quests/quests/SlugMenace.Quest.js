/**
 * The Slug Menace (members), aligned with the user's whole-quest capture (RSProx capture
 * TheSlugMenace, revision 242.1; ticks cited below are that recording's; the facts are listed in
 * docs/quests/the-slug-menace/README.md).
 *
 * The words come from the "The Slug Menace" transcript page (npc-dialogues.json, osrsreboxed-db);
 * this plugin picks the variants, answers the prose conditions and does what the capture shows
 * between the lines: the stage changes, the items, the sub-varbits, the scans and the scenes.
 *
 * The stage is the native slug2_main value (varbit 2610, bits 0-7 of varp 874 quest_slug2), as live
 * sets it:
 *   0 not started; 1 Sir Tiffy updates the CommOrb ("Now, is there anything else...", tick 238);
 *   2 O'Niall names the three people (tick 997); 3 the report to O'Niall (tick 1506); 4 Savant's
 *   door scan (tick 1860); 5 Jorral's translation (tick 2152); 6 Savant calls back (tick 2157);
 *   7 O'Niall hears about the Mother Mallum (tick 2315); 8 Mayor Hobb leaves the church (tick 2505);
 *   9 Maledict asks for the pages (tick 2553); 10 Savant stops the swamp paste (tick 2986); 11 Bailey
 *   cooks the glue (tick 3086); 12 Savant's teleport lands in Falador (tick 4879); 14 complete (tick
 *   4991). The cache's NPC transforms follow it (O'Niall 4781 to 8, 4782 from 9, the Chair at 13+).
 *
 * The sub-varbits are saved as attributes and resent at login: slug2_npc_track1-3 and alltrack
 * (Holgart 1, Hobb 2, Maledict 4), slug2_scan_mayor (0/1/2), slug2_oniall_control, slug2_doorbit
 * (the false wall), slug2_haveslug, slug2_savant_scan, slug2_doorscan, slug2_tornpages,
 * slug2_fixed_page (and varp 875), slug2_used_runes and the five used-rune bits, slug2_queen_door.
 *
 * Saves from the older plugin (its own stage numbers) are converted once at login (STAGE_FORMAT).
 */
module.exports = function registerSlugMenaceQuest(api) {
  const {
    Animation,
    CombatType,
    CountdownTask,
    Graphic,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    TaskManager,
  } = api.core;
  const { loadTranscripts, refreshQuestList, registerQuest, startTranscript } = require("../QuestRuntime");
  const { buildLines } = require("../slugmenace/Journal.SlugMenace");
  const createPagePuzzle = require("../slugmenace/Puzzle.SlugMenace");
  const createSlugMenaceScenes = require("../slugmenace/Scenes.SlugMenace");

  const PAGE = "The Slug Menace";
  const TIFFY_PAGE = "Sir Tiffy Cashien";

  // Cache vars (`lookup-gameval varbit slug`).
  const VARP_SLUG_MENACE = 874; // quest_slug2
  const VARBIT_SLUG_MAIN = 2610; // slug2_main, bits 0-7
  const VARBIT_FIXED_PAGE = 2611;
  const VARBIT_SAVANT_GOTINFO = 2612;
  const VARBIT_SAVANT_SCAN = 2613;
  const VARBIT_TRACK_1 = 2614; // Holgart
  const VARBIT_TRACK_2 = 2615; // Hobb
  const VARBIT_TRACK_3 = 2616; // Maledict
  const VARBIT_ALLTRACK = 2617;
  const VARBIT_DOORBIT = 2618;
  const VARBIT_TORNPAGES = 2619;
  const VARBIT_DOORSCAN = 2620;
  const VARBIT_SCAN_MAYOR = 2621;
  const VARBIT_USED_RUNES = 2627;
  const VARBIT_QUEEN_DOOR = 2628;
  const VARBIT_ONIALL_CONTROL = 2630;
  const VARBIT_HAVESLUG = 2631;
  const PUZZLE_COMPLETE_VARP = 875;

  // Quest NPCs.
  const SIR_TIFFY_NPC_IDS = new Set([
    NpcIdentifiers.SIR_TIFFY_CASHIEN, // 4687
    NpcIdentifiers.SIR_TIFFY_CASHIEN_2,
    NpcIdentifiers.SIR_TIFFY_CASHIEN_3,
    NpcIdentifiers.SIR_TIFFY_CASHIEN_4,
    NpcIdentifiers.SIR_TIFFY_CASHIEN_5,
    NpcIdentifiers.SIR_TIFFY_CASHIEN_6,
  ]);
  const COL_ONIALL_NPC_IDS = new Set([6242, NpcIdentifiers.COL_ONIALL, NpcIdentifiers.COL_ONIALL_2]);
  const MAYOR_HOBB_NPC_IDS = new Set([6243, NpcIdentifiers.MAYOR_HOBB, NpcIdentifiers.MAYOR_HOBB_2]);
  const BROTHER_MALEDICT_NPC_IDS = new Set([6244, NpcIdentifiers.BROTHER_MALEDICT, NpcIdentifiers.BROTHER_MALEDICT_2]);
  /** The villagers' placeholders and transforms; the odd stage-2 forms (4791/4793/4795) are possessed. */
  const VILLAGER_NPC_IDS = new Set([4790, 4791, 4792, 4793, 4794, 4795, 6245, 6246, 6247, 6248, 6249, 6250]);
  const POSSESSED_VILLAGER_IDS = new Set([4791, 4793, 4795]);
  const SLUG_PRINCE_NPC_IDS = new Set([NpcIdentifiers.SLUG_PRINCE, NpcIdentifiers.SLUG_PRINCE_2]);
  const EZEKIAL_NPC_ID = NpcIdentifiers.EZEKIAL_LOVECRAFT; // 4789
  const JORRAL_NPC_ID = NpcIdentifiers.JORRAL; // 3490
  const SAVANT_NPC_ID = NpcIdentifiers.SAVANT; // 4931
  const BAILEY_NPC_ID = NpcIdentifiers.BAILEY; // 5066
  const JEB_NPC_IDS = new Set([6252, 6241, NpcIdentifiers.JEB, NpcIdentifiers.JEB_2]);
  const MAYOR_HOBB_NPC_ID = NpcIdentifiers.MAYOR_HOBB;

  // Items.
  const COMMORB_ITEM_ID = ItemIdentifiers.COMMORB; // 6635
  const COMMORB_V2_ITEM_ID = ItemIdentifiers.COMMORB_V2; // 9681
  const DOOR_TRANSCRIPTION_ITEM_ID = ItemIdentifiers.DOOR_TRANSCRIPTION; // 9682
  const DEAD_SEA_SLUG_ITEM_ID = ItemIdentifiers.DEAD_SEA_SLUG; // 9683
  const PAGE_1_ITEM_ID = ItemIdentifiers.PAGE_1; // 9684
  const PAGE_2_ITEM_ID = ItemIdentifiers.PAGE_2; // 9685
  const PAGE_3_ITEM_ID = ItemIdentifiers.PAGE_3; // 9686
  const FRAGMENT_1_ITEM_ID = ItemIdentifiers.FRAGMENT_1; // 9687
  const FRAGMENT_2_ITEM_ID = ItemIdentifiers.FRAGMENT_2; // 9688
  const FRAGMENT_3_ITEM_ID = ItemIdentifiers.FRAGMENT_3; // 9689
  const SEA_SLUG_GLUE_ITEM_ID = ItemIdentifiers.SEA_SLUG_GLUE; // 9680
  const SWAMP_PASTE_ITEM_ID = ItemIdentifiers.SWAMP_PASTE;
  const QUEST_SCROLL_ITEM_ID = 9700; // slug2_quest_complete_dummy (tick 4991)
  const CHISEL_ITEM_IDS = new Set([ItemIdentifiers.CHISEL, ItemIdentifiers.CHISEL_2, ItemIdentifiers.CHISEL_3]);
  const RUNE_ESSENCE_ITEM_ID = ItemIdentifiers.RUNE_ESSENCE;
  const PURE_ESSENCE_ITEM_ID = ItemIdentifiers.PURE_ESSENCE;
  const FRAGMENT_ITEM_IDS = new Set([FRAGMENT_1_ITEM_ID, FRAGMENT_2_ITEM_ID, FRAGMENT_3_ITEM_ID]);
  const PAGE_ITEM_IDS = new Set([PAGE_1_ITEM_ID, PAGE_2_ITEM_ID, PAGE_3_ITEM_ID]);

  /**
   * The five runes: blank, finished, the used-rune varbit and slug2_used_runes' bit (earth 1, air 2,
   * fire 4, water 8, mind 16: ticks 4566-4589 go 0 -> 2 -> 3 -> 19 -> 27 -> 31), the altar, the
   * success line's transcript variant and the journal line.
   */
  const RUNES = [
    { name: "earth", blank: ItemIdentifiers.BLANK_EARTH_RUNE, rune: ItemIdentifiers.EARTH_RUNE_4, varbit: 2622, bit: 1, altar: ObjectIdentifiers.ALTAR_36, variant: "crafting-the-runes-enchanting-the-earth-rune" },
    { name: "air", blank: ItemIdentifiers.BLANK_AIR_RUNE, rune: ItemIdentifiers.AIR_RUNE_6, varbit: 2623, bit: 2, altar: ObjectIdentifiers.ALTAR_33, variant: "crafting-the-runes-enchanting-the-air-rune" },
    { name: "fire", blank: ItemIdentifiers.BLANK_FIRE_RUNE, rune: ItemIdentifiers.FIRE_RUNE_6, varbit: 2624, bit: 4, altar: ObjectIdentifiers.ALTAR_37, variant: "crafting-the-runes-enchanting-the-fire-rune" },
    { name: "water", blank: ItemIdentifiers.BLANK_WATER_RUNE, rune: ItemIdentifiers.WATER_RUNE_6, varbit: 2625, bit: 8, altar: ObjectIdentifiers.ALTAR_35, variant: "crafting-the-runes-enchanting-the-water-rune" },
    { name: "mind", blank: ItemIdentifiers.BLANK_MIND_RUNE, rune: ItemIdentifiers.MIND_RUNE_4, varbit: 2626, bit: 16, altar: ObjectIdentifiers.ALTAR_34, variant: "crafting-the-runes-enchanting-the-mind-rune" },
  ];
  const ALL_RUNES_USED = 31;
  const RUNE_BY_FINISHED = new Map(RUNES.map((rune) => [rune.rune, rune]));
  const RUNE_BY_ALTAR = new Map(RUNES.map((rune) => [rune.altar, rune]));
  /** The page's Shape options and the blank each makes (page 1: earth/air, 2: fire/water, 3: mind). */
  const SHAPES = { "shape-earth": "earth", "shape-air": "air", "shape-fire": "fire", "shape-water": "water", "shape-mind": "mind" };

  // Objects.
  const OLD_RUIN_ENTRANCE_OBJECT_ID = ObjectIdentifiers.OLD_RUIN_ENTRANCE; // 18270
  const DUNGEON_EXIT_OBJECT_ID = ObjectIdentifiers.EXIT_16; // 18354
  /** The map's 19124 resolves by slug2_doorbit to 18359 (Wall, Push) or 18360 (Wall opening, Enter). */
  const HIDDEN_ENTRANCE_OBJECT_IDS = new Set([19124, ObjectIdentifiers.WALL_100, 18360]);
  const WALL_PASSAGE_OBJECT_ID = ObjectIdentifiers.PASSAGE_3; // 18412, slug2_cave_entrance
  const IMPOSING_DOOR_OBJECT_IDS = new Set([ObjectIdentifiers.IMPOSING_DOORS, ObjectIdentifiers.IMPOSING_DOORS_2, ObjectIdentifiers.IMPOSING_DOORS_3]);
  const STUDY_DESK_OBJECT_ID = ObjectIdentifiers.STUDY_DESK_8; // 18224, slug2_mayors_desk
  const DESK_TILE = { x: 2708, y: 3294, z: 0 };

  const OLD_RUIN_ENTRANCE_TILE = { x: 2696, y: 3283, z: 0 };
  const DUNGEON_LANDING_TILE = { x: 2696, y: 9684, z: 0 }; // tick 1640
  const DUNGEON_EXIT_TILE = { x: 2696, y: 9682, z: 0 };
  const SURFACE_LANDING_TILE = { x: 2697, y: 3283, z: 0 }; // tick 4502
  const CAVE_ENTRY_TILE = { x: 2324, y: 5104, z: 0 }; // ticks 1728, 1750
  /** Back through the passage: the tile west of the wall, not the wall's own (issue #4211 point 4; tick 1741). */
  const WALL_RETURN_TILE = { x: 2700, y: 9689, z: 0 };
  const DEAD_SLUG_TILE = { x: 2352, y: 5096, z: 0 }; // tick 1823
  const MAYOR_SCAN_RANGE = 8;

  const DOOR_ZONE = { minX: 2343, maxX: 2358, minY: 5094, maxY: 5100, levels: [0] };
  const CHURCH_ZONE = { minX: 2710, maxX: 2730, minY: 3275, maxY: 3287, levels: [0] };

  // Animations, graphics and sounds (tick of the capture).
  const ANIM_HANDING_OVER = 4834; // slug2_human_handing_over: the wall (1723), the desk (2587), a rune (4566)
  const ANIM_SEARCH = 899; // human_furnace: a locked or empty desk (425, 2606), Bailey cooking (3088)
  const ANIM_SIDESTEP = 752; // human_into_sidestep (1727, 1739)
  const SOUND_SQUEEZE = 1107; // ft_squeeze_past
  const ANIM_SCAN = 2721; // wanted_crystal_ball_scan
  const GFX_SCAN = 454;
  const ANIM_SCAN_MAYOR = 4839; // slug2_crystal_ball_scan (1343)
  const GFX_SCAN_MAYOR = 799;
  const SOUND_SCAN = 1900; // wanted_scan
  const SOUND_LOCKED = 2402;
  const SOUND_DRAWER = 64;
  const SOUND_DOOR_FLASH = 3029; // slug2_light_flash (1863)
  const SOUND_PLACE_RUNE = 3032; // slug2_place_rune
  const ANIM_RUNECRAFT = 791;
  const GFX_RUNECRAFT = 186;
  const SOUND_BIND = 2710;
  const DOOR_BURN_DAMAGE = 5; // tick 1864, the Wiki's 5 damage

  // Captured game messages.
  const MSG_NOTHING_TO_SCAN = "You have nothing to scan for..."; // ticks 1369, 1480, 2170
  const MSG_DESK_LOCKED = "The desk appears to be locked."; // tick 425
  const MSG_DESK_EMPTY = "The desk is empty."; // tick 2606
  const MSG_WALL_OPENED_ID = "BlbTdL"; // "The wall creaks open to reveal a hidden entrance!"

  // Native stages.
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_BRIEFED = 2;
  const STAGE_REPORTED = 3;
  const STAGE_DOOR_SCANNED = 4;
  const STAGE_TRANSLATED = 5;
  const STAGE_SAVANT_INFO = 6;
  const STAGE_ONIALL_WARNED = 7;
  const STAGE_HOBB_SEEN = 8;
  const STAGE_PAGES_REQUESTED = 9;
  const STAGE_PASTE_REFUSED = 10;
  const STAGE_GLUE = 11;
  const STAGE_PRINCE_KILLED = 12;
  const STAGE_COMPLETE = 14;

  // Transcript variants on the "The Slug Menace" page.
  const V_TIFFY_NO_REQS = "starting-off-talking-to-sir-tiffy-cashien-without-the-requirements";
  const V_TIFFY_START = "starting-off-talking-to-sir-tiffy-cashien-to-start-the-quest";
  const V_TIFFY_LOST_ORB = "starting-off-talking-to-sir-tiffy-cashien-after-losing-the-commorb";
  const V_TIFFY_STARTED = "starting-off-talking-to-sir-tiffy-cashien-after-starting-the-quest";
  const V_TIFFY_COMPLETE = "the-imposing-door-talking-to-sir-tiffy-cashien-after-killing-the-slug-prince";
  const V_TIFFY_POST = "after-slug-menace";
  const V_COMMORB_CONTACT = "starting-off-contact-with-commorb-v2";
  const V_COMMORB_PLAYBACK = "starting-off-playback-with-commorb-v2";
  const V_COMMORB_INVESTIGATING = "witchaven-contacting-the-commorb-while-investigating-witchaven";
  const V_HOBB = "witchaven-talking-to-mayor-hobb";
  const V_HOBB_2 = "witchaven-talking-to-mayor-hobb-2";
  const V_HOBB_AGAIN = "witchaven-talking-to-mayor-hobb-again";
  const V_SAVANT_SCAN_MAYOR = "witchaven-savant-asking-to-scan-the-mayor";
  const V_SCAN_MAYOR = "witchaven-scanning-the-mayor";
  const V_MALEDICT = "witchaven-talking-to-brother-maledict";
  const V_MALEDICT_2 = "witchaven-talking-to-brother-maledict-2";
  const V_MALEDICT_AGAIN = "witchaven-talking-to-brother-maledict-again";
  const V_MALEDICT_PAGES = "the-pages-talking-to-maledict-after-learning-about-mother-mallum";
  const V_MALEDICT_PAGES_AGAIN = "the-pages-talking-to-brother-maledict-again";
  const V_ONIALL_INTRO = "witchaven-talking-to-col-o-niall";
  const V_ONIALL_QUESTIONS = "witchaven-talking-to-col-o-niall-before-getting-all-the-information";
  const V_ONIALL_REPORT = "witchaven-talking-to-col-o-niall-after-talking-to-mayor-hobb";
  const V_ONIALL_MOTHER = "the-pages-talking-to-col-o-niall-after-learning-abotu-mother-mallum";
  const V_ONIALL_AGAIN = "the-pages-talking-to-col-o-niall-again";
  const V_ONIALL_FINAL_PAGE = "the-pages-talking-to-col-o-niall-while-looking-for-the-final-page";
  const V_ONIALL_LOST_ORB = "crafting-the-runes-talking-to-col-o-niall-after-losing-the-commorb";
  const V_JEB = "witchaven-talking-to-jeb";
  const V_JEB_HELLO = "witchaven-talking-to-jeb-before-holgart-mentions-the-boat";
  const V_JEB_BOAT = "witchaven-talking-to-jeb-after-holgart-says-to-ask-him-about-a-boat";
  const V_JEB_PLATFORM = "witchaven-talking-to-jeb-at-the-fishing-platform";
  const V_HOLGART = "witchaven-talking-to-holgart";
  const V_HOLGART_AGAIN = "witchaven-talking-to-holgart-again";
  const V_BAILEY = "witchaven-talking-to-bailey-at-the-fishing-platform";
  const V_BAILEY_GLUE = "the-pages-talking-to-bailey-after-learning-about-the-glue";
  const V_WALL_BEFORE = "the-shrine-attempting-to-push-the-wall-before-talking-about-the-shrine";
  const V_WALL_NO_ORB = "the-shrine-pushing-the-wall-without-the-commorb";
  const V_PASSAGE_NO_ORB = "the-shrine-attempting-to-enter-the-open-wall-without-the-commorb";
  const V_COMMORB_BEFORE_SCAN = "the-shrine-contacting-commorb-before-scanning-the-shrine";
  const V_SCAN_WRONG = "the-shrine-scanning-the-commorb-in-the-wrong-place";
  const V_SCAN_COMBAT = "the-shrine-scanning-the-commorb-while-in-combat";
  const V_SCAN_ASK = "the-shrine-scanning-the-commorb-near-the-door";
  const V_SCAN_RESULT = "the-shrine-scanning-commorb-near-the-door";
  const V_DOOR_ATTEMPT = "the-shrine-attempting-to-open-the-door";
  const V_DOOR_NO_ORB = "the-shrine-approaching-door-without-commorb";
  const V_COMMORB_AFTER_SCAN = "the-shrine-contacting-the-commorb-after-scanning-the-doors";
  const V_COMMORB_LOST_TRANSCRIPTION = "the-shrine-contacting-commorb-after-losing-door-transcription";
  const V_SLUG_PICKUP = "the-shrine-picking-up-the-dead-sea-slug";
  const V_JORRAL = "the-pages-talking-to-jorral";
  const V_SAVANT_AFTER_JORRAL = "the-pages-after-talking-to-jorral";
  const V_COMMORB_MOTHER = "the-pages-contacting-the-commorb-after-learning-about-mother-mallum";
  const V_DESK = "the-pages-opening-maledict-s-desk";
  const V_EZEKIAL = "the-pages-talking-to-ezekial-lovecraft-after-brother-maledict-asks-about-the-pages";
  const V_PASTE = "the-pages-using-swamp-paste-on-the-pages";
  const V_SHAPE = "crafting-the-runes-shaping-a-rune";
  const V_ENCHANT_FAIL = "crafting-the-runes-failing-to-enchant-a-rune";
  const V_DOOR_RUNES_NO_ORB = "the-imposing-door-opening-the-door-without-the-commorb";
  const V_VILLAGER_PRE = "pre-quest-dialogue";
  const V_VILLAGER_POST = "post-quest-dialogue";

  const START_HOOK = "quest:the-slug-menace:start";

  // Prose condition step ids.
  const COND_NO_ORB = "QCYHeQ";
  const COND_HAS_ORB = "Z3OYJz";
  const COND_NO_SPACE_ORB = "qD7fRj";
  const COND_SPACE_ORB = "M3YJU2";
  const COND_NO_SPACE_SCAN = "NBrQCq";
  const COND_NO_SPACE_TRANSCRIPTION = "vfZW8h";
  const COND_NO_TRANSCRIPTION = "sEmc0h";
  const COND_NO_SPACE_DESK = "dEd0U2";
  const COND_NO_SPACE_EZEKIAL = "efYvu4";
  const COND_NO_SPACE_FRAGMENTS = "X95XqV";
  const COND_NO_SLUG = "xSBg2p";
  const COND_NO_CHISEL = "oj0WZU";
  const COND_NO_ESSENCE = "7GC2LN";
  const COND_SHAPE_FAIL = "3Dotry";
  const COND_SHAPE_SUCCESS = "ypS1Qi";
  const COND_LOST_COMMORB_POST = "fOsyy-";
  const COND_WHILE_GUTHIX_SLEEPS = "upb-U5";

  // Action / message step ids.
  const MSG_TRAVEL_PLATFORM = "dEwoRO"; // "You arrive at the fishing platform."
  const MSG_TRAVEL_SHORE = "j6g4Cr"; // "The boat arrives at Witchaven."
  const ACTION_RECEIVE_TRANSCRIPTION = "3Tep8t"; // receive "Door transcription"
  const ACTION_RECEIVE_COMMORB_POST = "usNZAT";
  const ACTION_SHAPE_FAIL = "IE1248";
  const ACTION_SHAPE_SUCCESS = "UADauT";
  const ACTION_COMPLETE = "YMQ0V4"; // "Congratulations! Quest complete!"
  /**
   * The transcript's box lines, which live shows in the message box (229), not in chat: the
   * villagers' stare (tick 534) and the wall (1725); the requirements refusal and the early push
   * are the Wiki's {{tbox}} too.
   */
  const BOX_STEP_IDS = new Set(["qu7kOj", MSG_WALL_OPENED_ID, "i4nECO", "q1AVRm"]);
  const ROUTE_PLATFORM = "sea-slug-platform"; // tick 3022: the Sea Slug leg, 2782,3273, box at +8
  const ROUTE_WITCHAVEN = "sea-slug-witchaven"; // tick 3162: 2722,3305, box at +11
  const PLATFORM_MIN_X = 2750;

  // Lines the capture changes state on (the transcript's text, as the capture plays it).
  const LINE = {
    TIFFY_ANYTHING_ELSE: "Now, is there anything else I can do for you?", // 238: stage 1, CommOrb v2
    ONIALL_MENU: "Now what do you want to know.", // 900: slug2_oniall_control
    ONIALL_NAMED: "Will do Col. O'Niall. Thanks for the advice.", // 997: stage 2
    ONIALL_REPORTED: "Anything else I can do for you?", // 1506: stage 3
    ONIALL_WARNED: "Of course! The temple of Saradomin has had a shrine here for centuries. I'll get right on it.", // 2315
    ONIALL_PIECES: "Don't mention it.", // 2912: the fragments
    HOBB_TRACK: "Is there anything else you need to know?", // 1231: continued into his menu
    MALEDICT_TRACK: "Well, that would make sense. Hmm, one more thing.", // 1089: continued into his menu
    HOLGART_DONE: "Aye. Fare thee well.", // 1433
    SCAN_MAYOR_ASKED: "Sure thing, one moment.", // 1334
    TRANSCRIPT_ADDED: "I have added a transcript of the runes into your pack.", // 1856
    DOOR_SCANNED: "Fantastic - I'll get right on it.", // 1860
    JORRAL_TAKES: "Hmm. Interesting, very interesting.", // 2137: the transcript goes
    JORRAL_DONE: "Uh, right. Goodbye.", // 2152: stage 5
    SLUG_ANALYSIS: "Righty ho Savant. I look forward to your results.", // 1844: slug2_savant_scan
    MALEDICT_PAGES: "It is imperative that you find them.", // 2553: stage 9
    EZEKIAL_PAGE: "Sure, here you go.", // 2705: page 2 with the next line
    PASTE_REFUSED: "No problem Savant. I'll snap to it right away.", // 2986: stage 10
    BAILEY_COOKING: "Right, I'll get cooking.", // 3086: stage 11 and the glue
    BAILEY_DONE: "Right, there you go.", // 3090, two ticks after Bailey's seq 899
  };

  const STAGE_FORMAT_ATTRIBUTE = "the-slug-menace:stage-format";
  const STAGE_FORMAT = 1;
  const TRACKS_ATTRIBUTE = "quest.the_slug_menace.tracks";
  const USED_RUNES_ATTRIBUTE = "quest.the_slug_menace.used-runes";
  const FLAGS_ATTRIBUTE = "the-slug-menace:flags";
  const SCAN_MAYOR_ATTRIBUTE = "the-slug-menace:scan-mayor";
  const OLD_WALL_OPEN_ATTRIBUTE = "quest.the_slug_menace.wall-open";
  const OLD_DOOR_REVEALED_ATTRIBUTE = "quest.the_slug_menace.door-revealed";
  const OLD_MALEDICT_ASKED_ATTRIBUTE = "quest.the_slug_menace.maledict-asked";
  const TRACK_HOLGART = 1;
  const TRACK_HOBB = 2;
  const TRACK_MALEDICT = 4;
  const ALL_TRACKS = 7;
  /** One-way flags, each one of the cache's sub-varbits. */
  const FLAG = {
    ONIALL_CONTROL: { bit: 1 << 0, varbit: VARBIT_ONIALL_CONTROL },
    WALL_OPEN: { bit: 1 << 1, varbit: VARBIT_DOORBIT },
    HAVE_SLUG: { bit: 1 << 2, varbit: VARBIT_HAVESLUG },
    SAVANT_SCAN: { bit: 1 << 3, varbit: VARBIT_SAVANT_SCAN },
    DOOR_SCAN: { bit: 1 << 4, varbit: VARBIT_DOORSCAN },
    TORN_PAGES: { bit: 1 << 5, varbit: VARBIT_TORNPAGES },
    FIXED_PAGE: { bit: 1 << 6, varbit: VARBIT_FIXED_PAGE },
    QUEEN_DOOR: { bit: 1 << 7, varbit: VARBIT_QUEEN_DOOR },
    SAVANT_GOTINFO: { bit: 1 << 8, varbit: VARBIT_SAVANT_GOTINFO },
  };

  const WANTED_QUEST_KEY = "wanted";
  const SEA_SLUG_QUEST_KEY = "sea_slug";
  const DEVIOUS_MINDS_QUEST_KEY = "devious_minds";
  const DEVIOUS_MINDS_TIFFY_STAGE = 9;
  const CRAFTING_LEVEL = 30;
  const RUNECRAFT_LEVEL = 30;
  const SLAYER_LEVEL = 30;
  const THIEVING_LEVEL = 30;
  // update_stat deltas in the capture: shaping +2 Crafting (3562), empowering +2 Runecraft (3790).
  const SHAPE_CRAFTING_XP = 2;
  const EMPOWER_RUNECRAFT_XP = 2;

  let quest;
  let groundItems;
  const pendingShape = new WeakMap();
  const promptedDoorScan = new Set();
  const savantAfterJorral = new Set();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const heldAny = (player, itemIds) => [...itemIds].some((itemId) => held(player, itemId));
  const hasChisel = (player) => heldAny(player, CHISEL_ITEM_IDS);
  const hasAnyCommorb = (player) => held(player, COMMORB_ITEM_ID) || held(player, COMMORB_V2_ITEM_ID);
  const hasFragments = (player) => heldAny(player, FRAGMENT_ITEM_IDS);
  const stage = (player) => quest.getStage(player);
  /**
   * Ours (no capture loses them): from Maledict's request until the door opens, a lost page,
   * the fragments, the dead slug or the glue can be had again where they first came from.
   */
  const pageSearch = (player) => stage(player) >= 9 && stage(player) <= 11 && !hasFlag(player, FLAG.QUEEN_DOOR);
  const online = (player) => player.isRegistered?.() !== false;

  function later(player, ticks, run) {
    TaskManager.submit(new CountdownTask(player, ticks, () => { if (online(player)) run(); }));
  }

  /** `fromId` goes and `toId` takes its slot, as live's swaps do (the glue, a blank, Page 3). */
  function swapInSlot(player, fromId, toId) {
    const inventory = player.getInventory();
    const slot = inventory.getSlotForItemId?.(fromId) ?? -1;
    inventory.deleteNumber(fromId, 1);
    if (slot >= 0 && inventory.isSlotFree?.(slot)) inventory.setItem(slot, new Item(toId, 1)).refreshItems();
    else inventory.adds(toId, 1);
  }

  function essenceAmount(player) {
    return player.getInventory().getAmount(RUNE_ESSENCE_ITEM_ID) + player.getInventory().getAmount(PURE_ESSENCE_ITEM_ID);
  }

  function consumeEssence(player) {
    if (held(player, RUNE_ESSENCE_ITEM_ID)) player.getInventory().deleteNumber(RUNE_ESSENCE_ITEM_ID, 1);
    else if (held(player, PURE_ESSENCE_ITEM_ID)) player.getInventory().deleteNumber(PURE_ESSENCE_ITEM_ID, 1);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questActive(player, key) {
    const request = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true && !questComplete(player, key);
  }

  function meetsSkillRequirements(player) {
    const skills = player.getSkillManager();
    // The Wiki marks all four as not boostable, so check the base level.
    return skills.getMaxLevel(Skill.CRAFTING) >= CRAFTING_LEVEL
      && skills.getMaxLevel(Skill.RUNECRAFTING) >= RUNECRAFT_LEVEL
      && skills.getMaxLevel(Skill.SLAYER) >= SLAYER_LEVEL
      && skills.getMaxLevel(Skill.THIEVING) >= THIEVING_LEVEL;
  }

  function meetsQuestRequirements(player) {
    return questComplete(player, WANTED_QUEST_KEY) && questComplete(player, SEA_SLUG_QUEST_KEY);
  }

  function canStart(player) {
    return meetsQuestRequirements(player) && meetsSkillRequirements(player) && hasAnyCommorb(player);
  }

  // ==========================================================================
  // Saved sub-state and its varbits
  // ==========================================================================

  const tracks = (player) => Number(player.getAttribute(TRACKS_ATTRIBUTE)) || 0;
  const trackSet = (player, bit) => (tracks(player) & bit) !== 0;
  const allTracks = (player) => (tracks(player) & ALL_TRACKS) === ALL_TRACKS;
  const usedRunes = (player) => Number(player.getAttribute(USED_RUNES_ATTRIBUTE)) || 0;
  const flags = (player) => Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  const hasFlag = (player, flag) => (flags(player) & flag.bit) !== 0;
  const scanMayor = (player) => Number(player.getAttribute(SCAN_MAYOR_ATTRIBUTE)) || 0;

  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | flag.bit);
    player.getPacketSender().sendVarbit(flag.varbit, 1);
  }

  function setTrack(player, bit) {
    const value = tracks(player) | bit;
    player.setAttribute(TRACKS_ATTRIBUTE, value);
    sendTrackVarps(player);
  }

  function setScanMayor(player, value) {
    player.setAttribute(SCAN_MAYOR_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_SCAN_MAYOR, value);
  }

  function sendTrackVarps(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_TRACK_1, trackSet(player, TRACK_HOLGART) ? 1 : 0);
    sender.sendVarbit(VARBIT_TRACK_2, trackSet(player, TRACK_HOBB) ? 1 : 0);
    sender.sendVarbit(VARBIT_TRACK_3, trackSet(player, TRACK_MALEDICT) ? 1 : 0);
    sender.sendVarbit(VARBIT_ALLTRACK, tracks(player) & ALL_TRACKS);
  }

  function sendRuneVarps(player) {
    const sender = player.getPacketSender();
    const used = usedRunes(player);
    for (const rune of RUNES) sender.sendVarbit(rune.varbit, (used & rune.bit) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_USED_RUNES, used & ALL_RUNES_USED);
  }

  /** Every sub-varbit the client reads; the login bootstrap clobbers varps. */
  function sendSlugVarps(player) {
    const sender = player.getPacketSender();
    for (const flag of Object.values(FLAG)) sender.sendVarbit(flag.varbit, hasFlag(player, flag) ? 1 : 0);
    // Live clears varp 875 at the hand-in (tick 4991).
    sender.sendConfig(PUZZLE_COMPLETE_VARP, hasFlag(player, FLAG.FIXED_PAGE) && !quest.isComplete(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_SCAN_MAYOR, scanMayor(player));
    sendTrackVarps(player);
    sendRuneVarps(player);
    Puzzle.resend(player);
  }

  // ==========================================================================
  // Saves from the older plugin
  // ==========================================================================

  /** Old stage -> native stage. Old 3 was "all three spoken to" (native 2 with the tracks), old 12 the mended page. */
  const OLD_STAGES = { 0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 9, 10: 10, 11: 11, 12: 11, 13: 12, 14: 14 };
  /** Old used-rune bits (air 1, water 2, earth 4, fire 8, mind 16) -> slug2_used_runes's. */
  const OLD_RUNE_BITS = [[1, 2], [2, 8], [4, 1], [8, 4], [16, 16]];

  function convertOldSave(player) {
    if (Number(player.getAttribute(STAGE_FORMAT_ATTRIBUTE)) === STAGE_FORMAT) return;
    const old = stage(player);
    if (old > 0) {
      quest.setStage(player, OLD_STAGES[old] ?? old);
      let bits = flags(player);
      if (Number(player.getAttribute(OLD_WALL_OPEN_ATTRIBUTE)) === 1) bits |= FLAG.WALL_OPEN.bit;
      if (old >= 5) bits |= FLAG.DOOR_SCAN.bit | FLAG.SAVANT_SCAN.bit;
      if (old >= 7) bits |= FLAG.SAVANT_GOTINFO.bit;
      if (old >= 12) bits |= FLAG.FIXED_PAGE.bit;
      if (Number(player.getAttribute(OLD_DOOR_REVEALED_ATTRIBUTE)) === 1) bits |= FLAG.QUEEN_DOOR.bit;
      if (hasFragments(player) || old >= 10) bits |= FLAG.TORN_PAGES.bit;
      if (held(player, DEAD_SEA_SLUG_ITEM_ID) || old >= 11) bits |= FLAG.HAVE_SLUG.bit;
      if (old >= 2) bits |= FLAG.ONIALL_CONTROL.bit;
      player.setAttribute(FLAGS_ATTRIBUTE, bits);
      const oldRunes = usedRunes(player);
      player.setAttribute(USED_RUNES_ATTRIBUTE, OLD_RUNE_BITS.reduce((sum, [from, to]) => sum | ((oldRunes & from) ? to : 0), 0));
    }
    player.setAttribute(OLD_WALL_OPEN_ATTRIBUTE, 0);
    player.setAttribute(OLD_DOOR_REVEALED_ATTRIBUTE, 0);
    player.setAttribute(OLD_MALEDICT_ASKED_ATTRIBUTE, 0);
    player.setAttribute(STAGE_FORMAT_ATTRIBUTE, STAGE_FORMAT);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  /** Devious Minds hands in to Sir Tiffy at its own stage 9; its plugin answers for him then. */
  function deviousMindsOwnsTiffy(player) {
    if (questComplete(player, DEVIOUS_MINDS_QUEST_KEY)) return false;
    const request = { player, key: DEVIOUS_MINDS_QUEST_KEY, stage: undefined };
    api.emitCustomEvent("quest:get-stage", request);
    const value = Number(request.stage);
    return Number.isFinite(value) && value === DEVIOUS_MINDS_TIFFY_STAGE;
  }

  function tiffyVariant(player) {
    const current = stage(player);
    if (deviousMindsOwnsTiffy(player)) return null;
    if (current >= STAGE_COMPLETE) return { page: TIFFY_PAGE, variant: V_TIFFY_POST };
    if (current === STAGE_NOT_STARTED) {
      if (questActive(player, DEVIOUS_MINDS_QUEST_KEY)) return null;
      if (!meetsQuestRequirements(player)) return null;
      if (!meetsSkillRequirements(player)) return V_TIFFY_NO_REQS;
      if (!hasAnyCommorb(player)) return V_TIFFY_LOST_ORB;
      return V_TIFFY_START;
    }
    if (!hasAnyCommorb(player)) return V_TIFFY_LOST_ORB;
    if (current >= STAGE_PRINCE_KILLED) return V_TIFFY_COMPLETE;
    return V_TIFFY_STARTED;
  }

  function oniallVariant(player) {
    const current = stage(player);
    if (!quest.isStarted(player) || current >= STAGE_PRINCE_KILLED) return quest.isStarted(player) ? null : V_ONIALL_INTRO;
    if (!hasAnyCommorb(player)) {
      if (player.getInventory().getFreeSlots() < 1) return null;
      return V_ONIALL_LOST_ORB;
    }
    if (current === STAGE_STARTED) return V_ONIALL_INTRO;
    if (current === STAGE_BRIEFED) return allTracks(player) ? V_ONIALL_REPORT : V_ONIALL_QUESTIONS;
    if (current === STAGE_SAVANT_INFO) return V_ONIALL_MOTHER;
    // The last page: once the two stolen pages are held and no fragment or mended page is (tick 2865).
    if (pageSearch(player) && !hasFlag(player, FLAG.FIXED_PAGE) && !hasFragments(player)
      && held(player, PAGE_1_ITEM_ID) && held(player, PAGE_2_ITEM_ID)) return V_ONIALL_FINAL_PAGE;
    return current >= STAGE_ONIALL_WARNED ? V_ONIALL_AGAIN : V_ONIALL_QUESTIONS;
  }

  function hobbVariant(player) {
    const current = stage(player);
    if (current < STAGE_BRIEFED) return V_HOBB;
    if (current === STAGE_BRIEFED && !trackSet(player, TRACK_HOBB)) return V_HOBB_2;
    return V_HOBB_AGAIN;
  }

  /**
   * Talk-to on the Mayor once his questions are done and before the report: Savant breaks in and
   * asks for a scan (ticks 1318-1334); the Wiki's walkthrough has it after "Nothing at the moment".
   */
  function savantInterruptsHobb(player) {
    return stage(player) === STAGE_BRIEFED && trackSet(player, TRACK_HOBB) && scanMayor(player) === 0 && hasAnyCommorb(player);
  }

  function maledictVariant(player) {
    const current = stage(player);
    if (current >= STAGE_PAGES_REQUESTED) return V_MALEDICT_PAGES_AGAIN;
    if (current === STAGE_HOBB_SEEN) return V_MALEDICT_PAGES;
    if (current < STAGE_BRIEFED) return V_MALEDICT;
    if (current === STAGE_BRIEFED && !trackSet(player, TRACK_MALEDICT)) return V_MALEDICT_2;
    return V_MALEDICT_AGAIN;
  }

  function jebVariant(player) {
    if (!quest.isStarted(player)) return V_JEB;
    if (player.getLocation().getX() >= PLATFORM_MIN_X) return V_JEB_PLATFORM;
    // Holgart sends the player to Jeb; before that Jeb only says hello (tick 351). After the quest
    // he still rows (tick 5157).
    return holgartLostBoat(player) ? V_JEB_BOAT : V_JEB_HELLO;
  }

  function jorralVariant(player) {
    return stage(player) === STAGE_DOOR_SCANNED ? V_JORRAL : null;
  }

  function ezekialVariant(player) {
    if (!pageSearch(player) || held(player, PAGE_2_ITEM_ID)) return null;
    return V_EZEKIAL;
  }

  /** A villager in a possessed form (the cache's stage-2 transforms) has the vacant stare. */
  function villagerVariant(npcId, npc) {
    const shown = npc?.getTransformationId?.() ?? npc?.getNpcTransformationId?.() ?? npcId;
    return POSSESSED_VILLAGER_IDS.has(shown) || POSSESSED_VILLAGER_IDS.has(npcId) ? V_VILLAGER_POST : V_VILLAGER_PRE;
  }

  function selectVariant({ npcId, player, npc }) {
    if (!player) return null;
    if (SIR_TIFFY_NPC_IDS.has(npcId)) return tiffyVariant(player);
    if (COL_ONIALL_NPC_IDS.has(npcId)) return oniallVariant(player);
    if (MAYOR_HOBB_NPC_IDS.has(npcId)) return hobbVariant(player);
    if (BROTHER_MALEDICT_NPC_IDS.has(npcId)) return maledictVariant(player);
    if (JEB_NPC_IDS.has(npcId)) return jebVariant(player);
    if (VILLAGER_NPC_IDS.has(npcId)) return villagerVariant(npcId, npc);
    if (npcId === JORRAL_NPC_ID) return jorralVariant(player);
    if (npcId === EZEKIAL_NPC_ID) return ezekialVariant(player);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    if (!player) return null;
    const inventory = player.getInventory();
    switch (stepId) {
      case COND_NO_ORB: return !hasAnyCommorb(player);
      case COND_HAS_ORB: return hasAnyCommorb(player);
      case COND_NO_SPACE_ORB: return inventory.isFull();
      case COND_SPACE_ORB: return !inventory.isFull();
      case COND_NO_SPACE_SCAN: return inventory.isFull() && !held(player, DOOR_TRANSCRIPTION_ITEM_ID);
      case COND_NO_SPACE_TRANSCRIPTION: return inventory.isFull();
      case COND_NO_TRANSCRIPTION: return !held(player, DOOR_TRANSCRIPTION_ITEM_ID);
      // The desk's page goes in before this check, so a full bag only refuses when nothing was granted.
      case COND_NO_SPACE_DESK: return inventory.isFull() && !held(player, PAGE_1_ITEM_ID);
      case COND_NO_SPACE_EZEKIAL: return inventory.isFull();
      case COND_NO_SPACE_FRAGMENTS: return inventory.getFreeSlots() < 3;
      case COND_NO_SLUG: return !held(player, DEAD_SEA_SLUG_ITEM_ID);
      case COND_NO_CHISEL: return !hasChisel(player);
      case COND_NO_ESSENCE: return essenceAmount(player) === 0;
      case COND_SHAPE_FAIL: return pendingShape.has(player) ? !pendingShape.get(player).success : false;
      case COND_SHAPE_SUCCESS: return pendingShape.has(player) ? pendingShape.get(player).success : false;
      case COND_LOST_COMMORB_POST: return !hasAnyCommorb(player);
      case COND_WHILE_GUTHIX_SLEEPS: return questComplete(player, "while_guthix_sleeps");
      default: return null;
    }
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function startQuest(player) {
    if (stage(player) !== STAGE_NOT_STARTED || !canStart(player)) return;
    if (held(player, COMMORB_ITEM_ID) && !held(player, COMMORB_V2_ITEM_ID)) {
      player.getInventory().deleteNumber(COMMORB_ITEM_ID, 1);
      player.getInventory().adds(COMMORB_V2_ITEM_ID, 1);
    }
    quest.setStage(player, STAGE_STARTED);
  }

  /** The start hook fires on "Yes."; live starts as Sir Tiffy's last line shows (the line hook below). */
  function handleStartHook(event) {
    if (event.hook === START_HOOK && SIR_TIFFY_NPC_IDS.has(event.npcId)) event.handled = true;
  }

  function handleChosenCondition({ player, npcId, stepId }) {
    if (!player) return;
    if (stepId === COND_SPACE_ORB && SIR_TIFFY_NPC_IDS.has(npcId) && !hasAnyCommorb(player)) grantReplacementCommorb(player);
  }

  function travel(player, route) {
    const request = { player, route, handled: false };
    api.emitCustomEvent("ferries:travel", request);
    return request.handled;
  }

  function handleDialogueAction(event) {
    if (Scenes.marker(event)) return;
    const { player, npcId, stepId } = event;
    if (!player || typeof stepId !== "string") return;
    if (BOX_STEP_IDS.has(stepId) && event.kind === "message") {
      event.box = { statement: true };
      return;
    }
    if (stepId === MSG_TRAVEL_PLATFORM || stepId === MSG_TRAVEL_SHORE) {
      // The rowing trip (fade, seaslug_boat_travel, the arrival box) replaces the transcript's box.
      event.handled = true;
      event.end = true;
      travel(player, stepId === MSG_TRAVEL_PLATFORM ? ROUTE_PLATFORM : ROUTE_WITCHAVEN);
      return;
    }
    if (stepId === ACTION_RECEIVE_TRANSCRIPTION) {
      event.handled = true;
      if (!held(player, DOOR_TRANSCRIPTION_ITEM_ID) && !player.getInventory().isFull()) {
        player.getInventory().adds(DOOR_TRANSCRIPTION_ITEM_ID, 1);
      }
      return;
    }
    if (stepId === ACTION_RECEIVE_COMMORB_POST) {
      event.handled = true;
      if (!hasAnyCommorb(player) && !player.getInventory().isFull()) player.getInventory().adds(COMMORB_V2_ITEM_ID, 1);
      return;
    }
    if (stepId === ACTION_SHAPE_FAIL || stepId === ACTION_SHAPE_SUCCESS) {
      finishShape(player, stepId === ACTION_SHAPE_SUCCESS);
      return;
    }
    if (stepId === ACTION_COMPLETE) {
      event.handled = true;
      event.end = true;
      if (SIR_TIFFY_NPC_IDS.has(npcId) && stage(player) >= STAGE_PRINCE_KILLED) quest.complete(player);
    }
  }

  /** `before` runs as the line shows, `after` once it is continued (NpcDialogues' line event). */
  function handleDialogueLine(event) {
    const { player, npcId, text, step } = event;
    if (!player || typeof text !== "string") return;
    const speakerId = Scenes.speakerFor(player, step?.speaker);
    if (speakerId) event.speakerId = speakerId;
    const sceneHook = Scenes.lineHook(player, text);
    if (sceneHook) {
      event.before = sceneHook;
      return;
    }
    const current = stage(player);
    const at = (expected, when, action) => {
      if (text === expected) event[when] = action;
    };
    if (SIR_TIFFY_NPC_IDS.has(npcId)) {
      if (current === STAGE_NOT_STARTED) at(LINE.TIFFY_ANYTHING_ELSE, "before", () => startQuest(player));
      return;
    }
    if (COL_ONIALL_NPC_IDS.has(npcId)) {
      at(LINE.ONIALL_MENU, "after", () => { if (!hasFlag(player, FLAG.ONIALL_CONTROL)) setFlag(player, FLAG.ONIALL_CONTROL); });
      if (current === STAGE_STARTED) at(LINE.ONIALL_NAMED, "after", () => advance(player, STAGE_STARTED, STAGE_BRIEFED));
      if (current === STAGE_BRIEFED && allTracks(player)) at(LINE.ONIALL_REPORTED, "after", () => advance(player, STAGE_BRIEFED, STAGE_REPORTED));
      if (current === STAGE_SAVANT_INFO) at(LINE.ONIALL_WARNED, "after", () => advance(player, STAGE_SAVANT_INFO, STAGE_ONIALL_WARNED));
      if (pageSearch(player) && !hasFlag(player, FLAG.FIXED_PAGE)) at(LINE.ONIALL_PIECES, "before", () => givePieces(player));
      return;
    }
    if (MAYOR_HOBB_NPC_IDS.has(npcId)) {
      if (current === STAGE_BRIEFED && !trackSet(player, TRACK_HOBB)) at(LINE.HOBB_TRACK, "after", () => setTrack(player, TRACK_HOBB));
    }
    if (BROTHER_MALEDICT_NPC_IDS.has(npcId)) {
      if (current === STAGE_BRIEFED && !trackSet(player, TRACK_MALEDICT)) at(LINE.MALEDICT_TRACK, "after", () => setTrack(player, TRACK_MALEDICT));
      if (current === STAGE_HOBB_SEEN) at(LINE.MALEDICT_PAGES, "before", () => advance(player, STAGE_HOBB_SEEN, STAGE_PAGES_REQUESTED));
    }
    if (current === STAGE_BRIEFED && !trackSet(player, TRACK_HOLGART)) at(LINE.HOLGART_DONE, "after", () => setTrack(player, TRACK_HOLGART));
    if (current === STAGE_BRIEFED) at(LINE.SCAN_MAYOR_ASKED, "after", () => { if (scanMayor(player) === 0) setScanMayor(player, 1); });
    if (current === STAGE_REPORTED) {
      at(LINE.TRANSCRIPT_ADDED, "before", () => giveTranscription(player));
      at(LINE.DOOR_SCANNED, "after", () => advance(player, STAGE_REPORTED, STAGE_DOOR_SCANNED));
    }
    at(LINE.SLUG_ANALYSIS, "after", () => { if (!hasFlag(player, FLAG.SAVANT_SCAN)) setFlag(player, FLAG.SAVANT_SCAN); });
    if (npcId === JORRAL_NPC_ID && current === STAGE_DOOR_SCANNED) {
      at(LINE.JORRAL_TAKES, "before", () => {
        if (held(player, DOOR_TRANSCRIPTION_ITEM_ID)) player.getInventory().deleteNumber(DOOR_TRANSCRIPTION_ITEM_ID, 1);
      });
      at(LINE.JORRAL_DONE, "after", () => {
        advance(player, STAGE_DOOR_SCANNED, STAGE_TRANSLATED);
        armSavantAfterJorral(player);
      });
    }
    if (npcId === EZEKIAL_NPC_ID && pageSearch(player)) at(LINE.EZEKIAL_PAGE, "after", () => givePage(player, PAGE_2_ITEM_ID));
    if (current === STAGE_PAGES_REQUESTED) at(LINE.PASTE_REFUSED, "after", () => advance(player, STAGE_PAGES_REQUESTED, STAGE_PASTE_REFUSED));
    if (npcId === BAILEY_NPC_ID && (current === STAGE_PASTE_REFUSED || (current === STAGE_GLUE && !hasFlag(player, FLAG.FIXED_PAGE) && !held(player, SEA_SLUG_GLUE_ITEM_ID)))) {
      at(LINE.BAILEY_COOKING, "before", () => cookGlue(player));
      at(LINE.BAILEY_COOKING, "after", () => event.npc?.performAnimation?.(new Animation(ANIM_SEARCH)));
    }
    if (npcId === BAILEY_NPC_ID && text === LINE.BAILEY_DONE) event.holdTicks = 2;
  }

  function advance(player, from, to) {
    if (stage(player) === from) quest.setStage(player, to);
  }

  function grantReplacementCommorb(player) {
    if (quest.isComplete(player) || hasAnyCommorb(player)) return;
    if (player.getInventory().getFreeSlots() < 1) return;
    // Before the mission Sir Tiffy replaces the original Commorb; once it has started, the v2.
    player.getInventory().adds(stage(player) === STAGE_NOT_STARTED ? COMMORB_ITEM_ID : COMMORB_V2_ITEM_ID, 1);
  }

  function giveTranscription(player) {
    if (!held(player, DOOR_TRANSCRIPTION_ITEM_ID) && !player.getInventory().isFull()) {
      player.getInventory().adds(DOOR_TRANSCRIPTION_ITEM_ID, 1);
    }
  }

  function givePage(player, itemId) {
    if (!held(player, itemId) && player.getInventory().getFreeSlots() >= 1) player.getInventory().adds(itemId, 1);
  }

  /** The three fragments and slug2_tornpages as "Don't mention it." shows (tick 2912). */
  function givePieces(player) {
    if (hasFragments(player) || player.getInventory().getFreeSlots() < 3) return;
    player.getInventory().adds(FRAGMENT_1_ITEM_ID, 1);
    player.getInventory().adds(FRAGMENT_2_ITEM_ID, 1);
    player.getInventory().adds(FRAGMENT_3_ITEM_ID, 1);
    if (!hasFlag(player, FLAG.TORN_PAGES)) setFlag(player, FLAG.TORN_PAGES);
  }

  /** Bailey takes the slug as "Right, I'll get cooking." shows: stage 11 and the glue in its slot (tick 3086). */
  function cookGlue(player) {
    if (!held(player, DEAD_SEA_SLUG_ITEM_ID)) return;
    swapInSlot(player, DEAD_SEA_SLUG_ITEM_ID, SEA_SLUG_GLUE_ITEM_ID);
    advance(player, STAGE_PASTE_REFUSED, STAGE_GLUE);
  }

  /**
   * After Jorral's goodbye Savant calls (tick 2157, stage 6 and slug2_savant_gotinfo as the call
   * starts). Live's call came five ticks after the goodbye, while the player was back with Jorral;
   * here it waits for a closed chatbox (Ours).
   */
  function armSavantAfterJorral(player) {
    if (savantAfterJorral.has(player)) return;
    savantAfterJorral.add(player);
    const tryCall = (ticks) => later(player, ticks, () => {
      if (!savantAfterJorral.has(player) || stage(player) !== STAGE_TRANSLATED) {
        savantAfterJorral.delete(player);
        return;
      }
      if (player.getDialogueManager?.()?.isActive?.() === true || Scenes.busy(player)) return tryCall(1);
      savantAfterJorral.delete(player);
      advance(player, STAGE_TRANSLATED, STAGE_SAVANT_INFO);
      if (!hasFlag(player, FLAG.SAVANT_GOTINFO)) setFlag(player, FLAG.SAVANT_GOTINFO);
      savant(player, V_SAVANT_AFTER_JORRAL);
    });
    tryCall(5);
  }

  function savant(player, variant, select) {
    return startTranscript(api, player, SAVANT_NPC_ID, PAGE, variant, select);
  }

  // ==========================================================================
  // Commorb v2
  // ==========================================================================

  function inCombat(player) {
    return player.getCombat?.()?.getTarget?.() != null;
  }

  function nearImposingDoors(player) {
    const at = player.getLocation();
    return at.getZ() === 0 && Math.abs(at.getX() - 2350) <= 6 && Math.abs(at.getY() - 5095) <= 5;
  }

  function nearHobb(player) {
    const at = player.getLocation();
    const list = player.getLocalNpcs?.();
    if (Array.isArray(list)) {
      return list.some((npc) => MAYOR_HOBB_NPC_IDS.has(npc?.getId?.()) && npc.getLocation().getZ() === at.getZ()
        && Math.max(Math.abs(npc.getLocation().getX() - at.getX()), Math.abs(npc.getLocation().getY() - at.getY())) <= MAYOR_SCAN_RANGE);
    }
    // No NPC list (tests): the Mayor's house and the street outside it.
    return at.getZ() === 0 && at.getX() >= 2700 && at.getX() <= 2720 && at.getY() >= 3284 && at.getY() <= 3300;
  }

  function scanEffect(player, mayor) {
    player.performAnimation(new Animation(mayor ? ANIM_SCAN_MAYOR : ANIM_SCAN));
    player.performGraphic(new Graphic(mayor ? GFX_SCAN_MAYOR : GFX_SCAN, 92));
    player.getPacketSender().sendSound(SOUND_SCAN, 1, 0);
  }

  /**
   * Scan: the scan plays and the answer comes two ticks later - the Mayor's reading (scan_mayor 2,
   * ticks 1343-1345), the door's glyphs (doorscan 1 at once, Savant at +2, ticks 1846-1849), or
   * "You have nothing to scan for..." (ticks 1367-1369).
   */
  function handleCommorbScan(player) {
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    if (inCombat(player)) {
      savant(player, V_SCAN_COMBAT);
      return;
    }
    const current = stage(player);
    if (current === STAGE_BRIEFED && scanMayor(player) === 1 && nearHobb(player)) {
      scanEffect(player, true);
      later(player, 2, () => {
        setScanMayor(player, 2);
        savant(player, V_SCAN_MAYOR);
      });
      return;
    }
    scanEffect(player, false);
    if (current === STAGE_REPORTED && nearImposingDoors(player)) {
      if (!hasFlag(player, FLAG.DOOR_SCAN)) setFlag(player, FLAG.DOOR_SCAN);
      later(player, 2, () => savant(player, V_SCAN_RESULT));
      return;
    }
    if (current === STAGE_REPORTED) {
      later(player, 2, () => savant(player, V_SCAN_WRONG));
      return;
    }
    later(player, 2, () => player.sendMessage(MSG_NOTHING_TO_SCAN));
  }

  /** Contact, by stage: the capture's 2 (tick 1383), 6 (2173) and 7 (2341); the Wiki's for the rest. */
  function handleCommorbContact(player) {
    if (!quest.isStarted(player) || quest.isComplete(player)) return false;
    const current = stage(player);
    if (current >= STAGE_PRINCE_KILLED) return false;
    if (current === STAGE_STARTED) return savant(player, V_COMMORB_CONTACT);
    if (current === STAGE_BRIEFED) return savant(player, V_COMMORB_INVESTIGATING) || savant(player, V_COMMORB_BEFORE_SCAN);
    if (current === STAGE_DOOR_SCANNED || current === STAGE_TRANSLATED) return savant(player, V_COMMORB_AFTER_SCAN);
    if (current === STAGE_SAVANT_INFO) return savant(player, V_COMMORB_MOTHER);
    return savant(player, V_COMMORB_BEFORE_SCAN);
  }

  function handleCommorbPlayback(player) {
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    if (stage(player) >= STAGE_DOOR_SCANNED && stage(player) <= STAGE_TRANSLATED && !held(player, DOOR_TRANSCRIPTION_ITEM_ID)) {
      savant(player, V_COMMORB_LOST_TRANSCRIPTION);
      return;
    }
    savant(player, V_COMMORB_PLAYBACK);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player) return;
    const action = String(option ?? "").toLowerCase();
    if (itemId === COMMORB_V2_ITEM_ID) {
      if (action.includes("scan")) {
        event.handled = true;
        handleCommorbScan(player);
      } else if (action.includes("contact")) {
        if (handleCommorbContact(player) !== false) event.handled = true;
      } else if (action.includes("playback")) {
        event.handled = true;
        handleCommorbPlayback(player);
      }
      return;
    }
    if (!PAGE_ITEM_IDS.has(itemId)) return;
    const shape = RUNES.find((rune) => rune.name === SHAPES[action]);
    if (!shape || !hasFlag(player, FLAG.FIXED_PAGE) || quest.isComplete(player)) return;
    event.handled = true;
    shapeRune(player, shape);
  }

  /**
   * Shaping a rune from a page: with a chisel and essence, live's message and 2 Crafting XP, the
   * blank in the essence's slot (tick 3562). The transcript still answers a missing chisel or
   * essence and a failure; the success chance is Mod Ash's 43% at 1 to 99% at 99 (Wiki).
   */
  function shapeRune(player, rune) {
    if (!hasChisel(player) || essenceAmount(player) === 0 || held(player, rune.blank) || held(player, rune.rune)) {
      if (!hasChisel(player) || essenceAmount(player) === 0) {
        pendingShape.set(player, { blank: rune.blank, success: false });
        startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SHAPE);
      }
      return;
    }
    const success = Math.random() < shapeChance(player);
    if (!success) {
      pendingShape.set(player, { blank: rune.blank, success: false });
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SHAPE);
      return;
    }
    swapInSlot(player, held(player, RUNE_ESSENCE_ITEM_ID) ? RUNE_ESSENCE_ITEM_ID : PURE_ESSENCE_ITEM_ID, rune.blank);
    const message = stepById(V_SHAPE, ACTION_SHAPE_SUCCESS)?.text;
    if (message) player.sendMessage(message);
    player.getSkillManager().addExperiences(Skill.CRAFTING, SHAPE_CRAFTING_XP);
  }

  /** The transcript's failure (or a missing tool): the essence goes on a failed shape. */
  function finishShape(player, success) {
    const shape = pendingShape.get(player);
    pendingShape.delete(player);
    if (!shape) return;
    if (!hasChisel(player) || essenceAmount(player) === 0) return;
    consumeEssence(player);
    if (success && !player.getInventory().isFull()) player.getInventory().adds(shape.blank, 1);
  }

  function shapeChance(player) {
    const level = Math.max(1, Math.min(99, player.getSkillManager().getCurrentLevel(Skill.RUNECRAFTING)));
    return Math.min(0.99, 0.43 + ((level - 1) * 0.56) / 98);
  }

  // ==========================================================================
  // Items on objects and each other
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    const rune = RUNE_BY_ALTAR.get(objectId);
    if (rune && itemId === rune.blank) {
      event.handled = true;
      if (!quest.isStarted(player) || quest.isComplete(player)) return;
      empowerRune(player, rune);
      return;
    }
    if (IMPOSING_DOOR_OBJECT_IDS.has(objectId) && RUNE_BY_FINISHED.has(itemId)) {
      event.handled = true;
      useRuneOnDoor(player, RUNE_BY_FINISHED.get(itemId));
    }
  }

  /**
   * At its altar: success plays seq 791 with spotanim 186 and sound 2710, 2 Runecraft XP, the blank
   * goes and the rune lands in its slot with the message the next tick (ticks 3790-3791); a failure
   * is the message with the blank gone (3779).
   */
  function empowerRune(player, rune) {
    const inventory = player.getInventory();
    const slot = inventory.getSlotForItemId?.(rune.blank) ?? -1;
    inventory.deleteNumber(rune.blank, 1);
    if (Math.random() >= shapeChance(player)) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_ENCHANT_FAIL);
      return;
    }
    player.performAnimation(new Animation(ANIM_RUNECRAFT));
    player.performGraphic(new Graphic(GFX_RUNECRAFT, 92));
    player.getPacketSender().sendSound(SOUND_BIND, 1, 0);
    player.getSkillManager().addExperiences(Skill.RUNECRAFTING, EMPOWER_RUNECRAFT_XP);
    later(player, 1, () => {
      if (slot >= 0 && inventory.isSlotFree?.(slot)) inventory.setItem(slot, new Item(rune.rune, 1)).refreshItems();
      else inventory.adds(rune.rune, 1);
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, rune.variant); // the message, tick 3791
    });
  }

  /** Each rune: seq 4834, sound 3032 and its varbits (ticks 4566-4589); the fifth opens the door. */
  function useRuneOnDoor(player, rune) {
    if (stage(player) !== STAGE_GLUE || !hasFlag(player, FLAG.FIXED_PAGE)) return;
    if (!hasAnyCommorb(player)) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_DOOR_RUNES_NO_ORB);
      return;
    }
    const used = usedRunes(player);
    if ((used & rune.bit) !== 0 || hasFlag(player, FLAG.QUEEN_DOOR)) return;
    player.getInventory().deleteNumber(rune.rune, 1);
    player.setAttribute(USED_RUNES_ATTRIBUTE, used | rune.bit);
    sendRuneVarps(player);
    player.performAnimation(new Animation(ANIM_HANDING_OVER));
    player.getPacketSender().sendSound(SOUND_PLACE_RUNE, 1, 0);
    if (((used | rune.bit) & ALL_RUNES_USED) === ALL_RUNES_USED) {
      // Saved now (a logout before the scene must not strand the spent runes); the varbit goes
      // with the scene's opening (tick 4592).
      player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | FLAG.QUEEN_DOOR.bit);
      Scenes.openDoor(player);
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    for (const [itemId, otherId] of [[usedItemId, usedWithItemId], [usedWithItemId, usedItemId]]) {
      if (!FRAGMENT_ITEM_IDS.has(otherId)) continue;
      if (itemId === SWAMP_PASTE_ITEM_ID && stage(player) === STAGE_PAGES_REQUESTED) {
        event.handled = true;
        savant(player, V_PASTE);
        return;
      }
      if (itemId === SEA_SLUG_GLUE_ITEM_ID && stage(player) === STAGE_GLUE && !hasFlag(player, FLAG.FIXED_PAGE)) {
        event.handled = true;
        Puzzle.openPuzzle(player);
        return;
      }
    }
  }

  /** The page is whole: Page 3 in the glue's slot, the fragments gone, slug2_fixed_page (tick 3293). */
  function pageMended(player) {
    if (stage(player) !== STAGE_GLUE || !hasFragments(player) || !held(player, SEA_SLUG_GLUE_ITEM_ID)) return false;
    for (const id of FRAGMENT_ITEM_IDS) if (held(player, id)) player.getInventory().deleteNumber(id, 1);
    swapInSlot(player, SEA_SLUG_GLUE_ITEM_ID, PAGE_3_ITEM_ID);
    setFlag(player, FLAG.FIXED_PAGE);
    return true;
  }

  const Puzzle = createPagePuzzle(api, {
    canSolve: (player) => stage(player) === STAGE_GLUE && !hasFlag(player, FLAG.FIXED_PAGE),
    onSolved: pageMended,
  });

  // ==========================================================================
  // Objects
  // ==========================================================================

  function stepById(variant, id) {
    const find = (list) => {
      for (const step of list ?? []) {
        if (step?.id === id) return step;
        const nested = find(step?.steps) ?? find(step?.options?.flatMap?.((option) => option?.steps ?? []));
        if (nested) return nested;
      }
      return null;
    };
    return find(loadTranscripts(api)?.[PAGE]?.variants?.[variant]);
  }

  /** Squeezing past (seq 752, sound 1107) and the move a tick later (ticks 1727-1728, 1739-1741). */
  function squeeze(player, tile, ticks = 1) {
    player.getMovementQueue?.()?.reset?.();
    player.performAnimation(new Animation(ANIM_SIDESTEP));
    player.getPacketSender().sendSound(SOUND_SQUEEZE, 1, 0);
    later(player, ticks, () => {
      player.performAnimation(new Animation(-1));
      player.moveTo(new Location(tile.x, tile.y, tile.z));
    });
  }

  /**
   * The false wall: Push hands over (seq 4834, delay 30) and two ticks later slug2_doorbit and the
   * box; its continue squeezes the player through (ticks 1715-1728). Once open it is a squeeze.
   */
  function pushShrineWall(player) {
    if (quest.isComplete(player)) {
      squeeze(player, CAVE_ENTRY_TILE);
      return;
    }
    if (stage(player) < STAGE_REPORTED) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_WALL_BEFORE);
      return;
    }
    if (!hasAnyCommorb(player)) {
      if (!hasFlag(player, FLAG.WALL_OPEN)) setFlag(player, FLAG.WALL_OPEN);
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_WALL_NO_ORB);
      return;
    }
    if (hasFlag(player, FLAG.WALL_OPEN)) {
      squeeze(player, CAVE_ENTRY_TILE);
      return;
    }
    player.performAnimation(new Animation(ANIM_HANDING_OVER, 30));
    later(player, 2, () => {
      setFlag(player, FLAG.WALL_OPEN);
      const text = stepById(V_WALL_NO_ORB, MSG_WALL_OPENED_ID)?.text ?? "The wall creaks open to reveal a hidden entrance!";
      const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = api.core;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder()
        .add(new StatementDialogue(0, text))
        .add(new ActionDialogue(1, { execute: () => {
          player.getPacketSender().sendInterfaceRemoval?.();
          squeeze(player, CAVE_ENTRY_TILE);
        } })));
    });
  }

  function enterShrineWall(player) {
    if (!hasFlag(player, FLAG.WALL_OPEN) && !quest.isComplete(player)) {
      pushShrineWall(player);
      return;
    }
    if (!hasAnyCommorb(player) && !quest.isComplete(player)) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_PASSAGE_NO_ORB);
      return;
    }
    squeeze(player, CAVE_ENTRY_TILE);
  }

  /** The imposing door: the flash, sound 3029, and 5 damage the next tick (ticks 1862-1864). */
  function touchImposingDoor(player) {
    if (stage(player) === STAGE_GLUE && (hasFlag(player, FLAG.QUEEN_DOOR) || (usedRunes(player) & ALL_RUNES_USED) === ALL_RUNES_USED)) {
      Scenes.reenterFight(player);
      return;
    }
    const message = loadTranscripts(api)?.[PAGE]?.variants?.[V_DOOR_ATTEMPT]?.find?.((step) => step?.text)?.text;
    if (message) player.sendMessage(message);
    player.getPacketSender().sendSound(SOUND_DOOR_FLASH, 1, 0);
    later(player, 1, () => {
      const { HitDamage, HitMask } = api.core;
      if (HitDamage && HitMask) player.getCombat().getHitQueue().addPendingDamage([new HitDamage(DOOR_BURN_DAMAGE, HitMask.RED)]);
    });
  }

  /**
   * The Mayor's desk: locked (seq 899, sound 2402) until Maledict asks for the pages; then the page
   * with seq 4834 and sound 64, the item three ticks later; empty after (ticks 424, 2586-2606).
   */
  function openDesk(player) {
    const current = stage(player);
    const wanted = pageSearch(player) && !held(player, PAGE_1_ITEM_ID);
    if (!wanted) {
      player.performAnimation(new Animation(ANIM_SEARCH));
      if (current >= STAGE_PAGES_REQUESTED) player.sendMessage(MSG_DESK_EMPTY);
      else {
        player.sendMessage(MSG_DESK_LOCKED);
        player.getPacketSender().sendSound(SOUND_LOCKED, 1, 0);
      }
      return;
    }
    const text = loadTranscripts(api)?.[PAGE]?.variants?.[V_DESK]?.find?.((step) => step?.text)?.text;
    if (text) player.sendMessage(text);
    player.performAnimation(new Animation(ANIM_HANDING_OVER));
    player.getPacketSender().sendSound(SOUND_DRAWER, 1, 0);
    later(player, 3, () => givePage(player, PAGE_1_ITEM_ID));
  }

  function isTile(location, tile) {
    if (!location) return false;
    const x = location.getX?.() ?? location.x;
    const y = location.getY?.() ?? location.y;
    const z = location.getZ?.() ?? location.z;
    return Number(x) === tile.x && Number(y) === tile.y && Number(z) === tile.z;
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (!player) return;
    if (HIDDEN_ENTRANCE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (String(event.option ?? "").toLowerCase() === "enter") enterShrineWall(player);
      else pushShrineWall(player);
      return;
    }
    if (objectId === WALL_PASSAGE_OBJECT_ID) {
      event.handled = true;
      squeeze(player, WALL_RETURN_TILE, 2);
      return;
    }
    if (IMPOSING_DOOR_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      touchImposingDoor(player);
      return;
    }
    if (objectId === STUDY_DESK_OBJECT_ID && isTile(location, DESK_TILE)) {
      event.handled = true;
      openDesk(player);
    }
  }

  /** The ruin lands in the hobgoblin dungeon (tick 1640) and its exit on the ruin (4502). */
  function handleLadderClaim(event) {
    const location = event.object?.getLocation?.();
    if (!location) return;
    const claim = (direction, tile) => {
      event.handled = true;
      api.emitCustomEvent(direction, { player: event.player, object: event.object, destination: new Location(tile.x, tile.y, tile.z) });
    };
    if (event.objectId === OLD_RUIN_ENTRANCE_OBJECT_ID && isTile(location, OLD_RUIN_ENTRANCE_TILE)) claim("ladders:climbDown", DUNGEON_LANDING_TILE);
    else if (event.objectId === DUNGEON_EXIT_OBJECT_ID && isTile(location, DUNGEON_EXIT_TILE)) claim("ladders:climbUp", SURFACE_LANDING_TILE);
  }

  /** Near the door at stage 3, Savant asks for a scan (tick 1826); without the orb, the overhead line. */
  function handleDoorZoneEnter({ player }) {
    if (!player || stage(player) !== STAGE_REPORTED || promptedDoorScan.has(player)) return;
    promptedDoorScan.add(player);
    if (!hasAnyCommorb(player)) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_DOOR_NO_ORB);
      return;
    }
    savant(player, V_SCAN_ASK);
  }

  /** Walking by the church at stage 7: Mayor Hobb leaves it (tick 2502). */
  function handleChurchZoneEnter({ player }) {
    if (!player || stage(player) !== STAGE_ONIALL_WARNED || Scenes.busy(player)) return;
    Scenes.church(player);
  }

  // ==========================================================================
  // NPC conversations claimed by name (Sea Slug shares Holgart and Bailey)
  // ==========================================================================

  /**
   * Holgart has lost his boat once he has said so (track 1) and for good after: Talk-to and Travel
   * are his boat line mid-quest and after it (ticks 1438, 1441, 5164). Before that, Sea Slug's
   * Holgart still offers the trip (tick 356, stage 1).
   */
  const holgartLostBoat = (player) => quest.isStarted(player) && (trackSet(player, TRACK_HOLGART) || stage(player) >= STAGE_REPORTED);

  function talkToHolgart(event) {
    const { player, npcId } = event;
    if (stage(player) === STAGE_BRIEFED && !trackSet(player, TRACK_HOLGART)) {
      startTranscript(api, player, npcId, PAGE, V_HOLGART);
      return undefined;
    }
    if (!holgartLostBoat(player)) return false;
    startTranscript(api, player, npcId, PAGE, V_HOLGART_AGAIN);
    return undefined;
  }

  function travelWithHolgart(event) {
    const { player, npcId } = event;
    if (!holgartLostBoat(player)) return false;
    startTranscript(api, player, npcId, PAGE, V_HOLGART_AGAIN);
    return undefined;
  }

  function answerHolgartBoat(request) {
    if (request?.player && holgartLostBoat(request.player)) request.lost = true;
  }

  function talkToBailey(event) {
    const { player, npcId } = event;
    if (!quest.isStarted(player) || quest.isComplete(player)) return false;
    const current = stage(player);
    const variant = current === STAGE_PASTE_REFUSED || current === STAGE_GLUE ? V_BAILEY_GLUE : V_BAILEY;
    startTranscript(api, player, npcId, PAGE, variant, null, event.npc ?? null);
    return undefined;
  }

  function talkToJeb(event) {
    const { player, npcId } = event;
    if (!quest.isStarted(player)) return false;
    startTranscript(api, player, npcId, PAGE, jebVariant(player));
    return undefined;
  }

  /** Talk-to on the Mayor while Savant wants his scan (ticks 1318-1334). */
  function talkToHobb(event) {
    const { player } = event;
    if (!savantInterruptsHobb(player)) return false;
    savant(player, V_SAVANT_SCAN_MAYOR);
    return undefined;
  }

  // ==========================================================================
  // The dead sea slug and the fight
  // ==========================================================================

  function syncDeadSlug(player) {
    const current = stage(player);
    if (current < STAGE_REPORTED || current > STAGE_GLUE || quest.isComplete(player)) return;
    if (current === STAGE_GLUE && hasFlag(player, FLAG.FIXED_PAGE)) return;
    if (held(player, DEAD_SEA_SLUG_ITEM_ID) || held(player, SEA_SLUG_GLUE_ITEM_ID)) return;
    const position = new Location(DEAD_SLUG_TILE.x, DEAD_SLUG_TILE.y, DEAD_SLUG_TILE.z);
    if (!groundItems.getGroundItem(player.getUsername(), DEAD_SEA_SLUG_ITEM_ID, position, player.getPrivateArea())) {
      groundItems.registerLocation(player, new Item(DEAD_SEA_SLUG_ITEM_ID, 1), position);
    }
  }

  /** The pickup: slug2_haveslug, and Savant calls about it once the chatbox is free (ticks 1824-1844). */
  function handleGroundItemPickup({ player, groundItemId }) {
    if (!player || groundItemId !== DEAD_SEA_SLUG_ITEM_ID || quest.isComplete(player)) return;
    // Pickup hooks run before the inventory add (which can still fail for capacity).
    later(player, 1, () => {
      if (!held(player, DEAD_SEA_SLUG_ITEM_ID) || hasFlag(player, FLAG.HAVE_SLUG)) return;
      setFlag(player, FLAG.HAVE_SLUG);
      const call = () => later(player, 1, () => {
        if (player.getDialogueManager?.()?.isActive?.() === true) return call();
        if (!hasFlag(player, FLAG.SAVANT_SCAN) && hasAnyCommorb(player)) savant(player, V_SLUG_PICKUP);
      });
      call();
    });
  }

  function handleNpcDeath(event) {
    const killer = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!killer || !event.npc || Scenes.princeOf(killer) !== event.npc) return;
    Scenes.princeDied(killer);
  }

  /** Only melee hurts the Slug Prince (Wiki). */
  function handleNpcHitModify({ npc, hit }) {
    if (!npc || !SLUG_PRINCE_NPC_IDS.has(npc.getId?.())) return;
    if (hit?.getCombatType?.() === CombatType.MELEE) return;
    if (hit.isAccurate?.() !== true || hit.getTotalDamage?.() <= 0) return;
    for (const damage of hit.getHits?.() ?? []) damage.setDamage(0);
    hit.updateTotalDamage?.();
  }

  /** "Its attacks drain your Prayer by the amount of damage dealt." (Wiki; ticks 4724, 4740.) */
  function handleDamageApply({ target, hit }) {
    const source = hit?.getSource?.();
    if (!target?.isPlayer?.() || !source || !SLUG_PRINCE_NPC_IDS.has(source.getId?.())) return;
    const damage = Math.max(0, Number(hit.getDamage?.()) || 0);
    if (damage <= 0) return;
    const skills = target.getSkillManager();
    skills.setCurrentLevel(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - damage), true);
  }

  // ==========================================================================
  // Scenes
  // ==========================================================================

  const Scenes = createSlugMenaceScenes(api, {
    onChurchOpened: (player) => advance(player, STAGE_ONIALL_WARNED, STAGE_HOBB_SEEN),
    onFightStart: () => {},
    onPrinceDeathScene: () => {},
    onReturned: (player) => advance(player, STAGE_GLUE, STAGE_PRINCE_KILLED),
  });

  /** The fifth rune's scene sets slug2_queen_door as it opens (tick 4592). */
  const openDoor = Scenes.openDoor;
  Scenes.openDoor = (player) => {
    later(player, 3, () => player.getPacketSender().sendVarbit(VARBIT_QUEEN_DOOR, 1));
    openDoor(player);
  };

  // ==========================================================================
  // Lifecycle / journal / rewards
  // ==========================================================================

  function handleStageChanged({ player, key }) {
    if (key !== "the_slug_menace" || !player) return;
    syncDeadSlug(player);
  }

  function handleLogin({ player }) {
    if (!player) return;
    convertOldSave(player);
    refreshQuestList(player);
    // Savant's call after Jorral is a timer; a logout before it (or an old save at that point)
    // gets it again.
    if (stage(player) === STAGE_TRANSLATED) armSavantAfterJorral(player);
    sendSlugVarps(player);
    syncDeadSlug(player);
  }

  function handleLogout(event) {
    const { player } = event;
    if (!player) return;
    promptedDoorScan.delete(player);
    pendingShape.delete(player);
    savantAfterJorral.delete(player);
    Puzzle.forget(event);
    Scenes.interrupted(event);
  }

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    const used = usedRunes(player);
    const rune = (id) => RUNES.find((entry) => `rune-${entry.name}` === id);
    const shown = {
      started: current >= STAGE_STARTED,
      briefed: current >= STAGE_BRIEFED,
      "track-holgart": current >= STAGE_BRIEFED,
      "track-hobb": current >= STAGE_BRIEFED,
      "track-maledict": current >= STAGE_BRIEFED,
      "all-tracks": current >= STAGE_REPORTED || (current === STAGE_BRIEFED && allTracks(player)),
      reported: current >= STAGE_REPORTED,
      slug: current >= STAGE_REPORTED && hasFlag(player, FLAG.HAVE_SLUG),
      scanned: current >= STAGE_DOOR_SCANNED,
      translated: current >= STAGE_TRANSLATED,
      "savant-info": current >= STAGE_SAVANT_INFO,
      warned: current >= STAGE_ONIALL_WARNED,
      church: current >= STAGE_HOBB_SEEN,
      pages: current >= STAGE_PAGES_REQUESTED,
      torn: current >= STAGE_PAGES_REQUESTED && (hasFlag(player, FLAG.TORN_PAGES) || current >= STAGE_PASTE_REFUSED),
      "glue-advice": current >= STAGE_PASTE_REFUSED,
      glue: current >= STAGE_GLUE,
      fixed: hasFlag(player, FLAG.FIXED_PAGE),
      duped: hasFlag(player, FLAG.QUEEN_DOOR) || current >= STAGE_PRINCE_KILLED,
      escaped: current >= STAGE_PRINCE_KILLED,
    };
    const done = {
      started: current >= STAGE_BRIEFED,
      briefed: current >= STAGE_REPORTED,
      "track-holgart": trackSet(player, TRACK_HOLGART) || current >= STAGE_REPORTED,
      "track-hobb": trackSet(player, TRACK_HOBB) || current >= STAGE_REPORTED,
      "track-maledict": trackSet(player, TRACK_MALEDICT) || current >= STAGE_REPORTED,
      "all-tracks": current >= STAGE_REPORTED,
      reported: current >= STAGE_DOOR_SCANNED,
      slug: current >= STAGE_DOOR_SCANNED,
      scanned: current >= STAGE_TRANSLATED,
      translated: current >= STAGE_SAVANT_INFO,
      "savant-info": current >= STAGE_ONIALL_WARNED,
      warned: current >= STAGE_HOBB_SEEN,
      church: current >= STAGE_PAGES_REQUESTED,
      pages: current >= STAGE_PASTE_REFUSED,
      torn: current >= STAGE_PASTE_REFUSED,
      "glue-advice": current >= STAGE_GLUE,
      glue: hasFlag(player, FLAG.FIXED_PAGE),
      fixed: hasFlag(player, FLAG.QUEEN_DOOR) || current >= STAGE_PRINCE_KILLED,
      duped: current >= STAGE_PRINCE_KILLED,
      escaped: false,
    };
    return buildLines({
      complete: current >= STAGE_COMPLETE,
      shown: (id) => (rune(id) ? hasFlag(player, FLAG.FIXED_PAGE) : shown[id] === true),
      done: (id) => (rune(id) ? (used & rune(id).bit) !== 0 || current >= STAGE_PRINCE_KILLED : done[id] === true),
    });
  }

  function grantReward(player, questHandle, options = {}) {
    if (options.experience === false) return;
    const manager = player.getSkillManager();
    manager.addExperiences(Skill.CRAFTING, 3500);
    manager.addExperiences(Skill.RUNECRAFTING, 3500);
    manager.addExperiences(Skill.THIEVING, 3500);
  }

  api.persistAttribute(STAGE_FORMAT_ATTRIBUTE, 0);
  api.persistAttribute(TRACKS_ATTRIBUTE, 0);
  api.persistAttribute(USED_RUNES_ATTRIBUTE, 0);
  api.persistAttribute(FLAGS_ATTRIBUTE, 0);
  api.persistAttribute(SCAN_MAYOR_ATTRIBUTE, 0);
  api.persistAttribute(Puzzle.STATE_ATTRIBUTE, { pieces: [] });
  // Read once by the conversion, then cleared.
  api.persistAttribute(OLD_WALL_OPEN_ATTRIBUTE, 0);
  api.persistAttribute(OLD_DOOR_REVEALED_ATTRIBUTE, 0);
  api.persistAttribute(OLD_MALEDICT_ASKED_ATTRIBUTE, 0);

  groundItems = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "the_slug_menace",
    name: "The Slug Menace",
    varpId: VARP_SLUG_MENACE,
    varbitId: VARBIT_SLUG_MAIN,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 3500, label: "Crafting" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 3500, label: "Runecraft" },
      { skillId: Skill.THIEVING.getIndex(), amount: 3500, label: "Thieving" },
    ],
    // The scroll's lines and model, and jingle 154 (tick 4991).
    otherRewards: ["Promotion to Proselyte"],
    scrollItemId: QUEST_SCROLL_ITEM_ID,
    completionJingleId: 154,
    buildJournal,
    onReward: grantReward,
  });

  /** The hand-in clears varp 875 with the completion (tick 4991). */
  function handleCompleted({ player, key }) {
    if (key === "the_slug_menace" && player) player.getPacketSender().sendConfig(PUZZLE_COMPLETE_VARP, 0);
  }

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleChosenCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("quest:completed", handleCompleted);
  api.onCustomEvent("combat:damage-apply", handleDamageApply);
  api.onNpcInteraction("Holgart", { "Talk-to": talkToHolgart, Travel: travelWithHolgart });
  api.onNpcInteraction("Bailey", { "Talk-to": talkToBailey });
  api.onNpcInteraction("Jeb", { "Talk-to": talkToJeb });
  api.onCustomEvent("sea-slug:holgart-boat", answerHolgartBoat);
  api.onNpcInteraction("Mayor Hobb", { "Talk-to": talkToHobb });
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem, { noted: false });
  api.onInterfaceActionButton(Puzzle.BUTTON_UIDS, Puzzle.click);
  api.onCustomEvent("interface:closed", Puzzle.closed);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onNpcHitModify(handleNpcHitModify);
  api.onCustomEvent("ladders:climb", handleLadderClaim);
  api.onZoneEnter(DOOR_ZONE, handleDoorZoneEnter);
  api.onZoneEnter(CHURCH_ZONE, handleChurchZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
