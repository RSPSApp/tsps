/**
 * The Fremennik Exiles (members, grandmaster).
 *
 * The words come from the "The Fremennik Exiles" transcript page; this plugin supplies the
 * variant selection for Brundt the Chieftain, Freygerd, Reeso, Bardur, Baba Yaga, Peer the
 * Seer, the exiled-phase Fremenniks and the quest objects, the prose-condition answers and the
 * item hand-ins/consumption the wiki marks with stage directions.
 *
 * Stage varbit: 9459 "vikingexile" (varp 2595, bits 0-8). Captured 1768.bin (revision
 * 227.1) and RuneLite Quest Helper both pin the route values below; cache dbTable 0
 * row 55 stores endstate 130. The sand pit/rockslide/boxes multilocs gain Search at 15,
 * the geysers Inspect at 50, the boat Travel at 85 and the island cave changes at 95.
 *
 * Stages (varbit 9459): 5 started, 10 briefed, 15 investigating, 20 evidence handed to
 * Freygerd, 25/30 Brundt's report, 35 exiled, 40 briefed, 50 V's shield hunt, 55 shield
 * handed over, 60 kegs requested, 65 kegs delivered, 70/75/76 back in Rellekka, 77
 * invasion, 80 defending the market, 85 boat and Island of Stone, 90 door explained, 95
 * combination solved, 100 prison, 105 Typhor dead, 110 Jormungand phase, 115 Jormungand
 * dead, 120 celebration, 125 finishing, 130 complete.
 * The shared Brundt world spawns now use cache ids 9263/9266/9267; legacy ids are still
 * accepted for old saves.
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 50,000 Slayer, 50,000 Crafting and 30,000
 * Runecraft XP, V's shield, access to the Island of Stone, Basilisk Knights as a Slayer task,
 * the Dräpare honorific.
 *
 * Sources: OSRS Wiki "The Fremennik Exiles" and its transcript, `Transcript:Unsealed letter`
 * for the letter body; the cache for every id, varbit and placement (scripts/lookup-gameval.ts
 * and the quest DB row).
 *
 * Gaps / approximations:
 *  - The door combination lock opens the cache interface 622 (puzzle_vikingexile) and drives
 *    its four rune selectors plus Go; wrong attempts and the solution persist across relog.
 *  - The Waterbirth Island Dungeon route uses the cache entrances and captured landings; its
 *    floor buttons hold the pet rock while the player stands on the other, and the rune
 *    thrownaxe special knocks down the three door-supports. Lower ladders come from the
 *    captured loc-teleport rows where present and the generic ladder mapper otherwise.
 *  - The market fight is a per-player instance in OSRS; here owner-only basilisk waves spawn in
 *    the Rellekka market. Varbit 9466 uses the captured 0-31 scale (1 per basilisk, 3 per
 *    Monstrous Basilisk), reaching 100% at 31. Leaving the market mid-fight is not tracked.
 *  - Stage 110 is entered on the first Jormungand hit. The captured gaze warning drains
 *    Magic/Defence when the player is not facing away; the stone bind and Typhor's magic stay
 *    presentation-only (conditions C6zHQ6/DLVETM answered false).
 *  - Captured camera/fade/shake beats use QuestScenes: Rellekka invasion, Island of Stone
 *    arrival and the longhall celebration with Olaf (9274).
 *  - The Item Retrieval Service (qY-jfP, the island deathbank) has no interface hook here; the
 *    Collect dialogue is replayed but nothing opens.
 *  - "being-exiled-bjorn-eldgrim" and "being-exiled-any-other-fremennik-in-rellekka" are not
 *    indexed to any NPC id in the dump and cannot fire.
 *  - The unsealed letter has no Read transcript in the dump; its body is sent as game messages
 *    from Transcript:Unsealed letter.
 *  - Lunar ore smelting (60 Smithing) is missing from the Smithing plugin, so a quest-scoped
 *    fallback smelts one lunar ore into one lunar bar at any furnace (13 Smithing XP).
 *  - The Dräpare honorific and the Neitiznot faceguard unlock are mirrored to varbit 9472 only;
 *    the repo has no title/faceguard systems.
 */
module.exports = function registerTheFremennikExilesQuest(api) {
  const {
    Bank,
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    ItemOnGroundManager,
    Location,
    NpcDefinition,
    NpcIdentifiers,
    MapObjects,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
    Task,
    TaskManager,
    World,
  } = api.core;
  const { loadTranscripts, registerQuest, startTranscript } = require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  const PAGE = "The Fremennik Exiles";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const BRUNDT_THE_CHIEFTAIN = NpcIdentifiers.BRUNDT_THE_CHIEFTAIN; // 8048
  const BRUNDT_LONGHALL = NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_6; // 9263, the longhall spawn's transform
  const BRUNDT_SOUTH_EAST = NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_8; // 9266, the exile meeting place
  const BRUNDT_ISLAND_DOOR = NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_9; // 9267
  const BRUNDT_ISLAND_PRISON = NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_10; // 9268
  // Stale npc-spawns.json entries predate the current cache; accepting them keeps
  // existing worlds playable until the shared spawn data is corrected.
  const LEGACY_BRUNDT_LONGHALL = 3926;
  const LEGACY_BRUNDT_EXILED = 7318;
  const LEGACY_BRUNDT_ISLAND_DOOR = 9269;
  const BRUNDT_NPC_IDS = new Set([
    BRUNDT_THE_CHIEFTAIN,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_2, // 8145
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_3, // 8153
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_4, // 8161
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_5, // 8169
    BRUNDT_LONGHALL, // 9263
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_7, // 9265
    BRUNDT_SOUTH_EAST, // 9266
    BRUNDT_ISLAND_DOOR, // 9267
    BRUNDT_ISLAND_PRISON, // 9268
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_11, // 9278
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_12, // 9279
    LEGACY_BRUNDT_LONGHALL,
    LEGACY_BRUNDT_EXILED,
    LEGACY_BRUNDT_ISLAND_DOOR,
  ]);

  const FREYGERD = NpcIdentifiers.FREYGERD_2; // 3942
  const REESO = NpcIdentifiers.REESO; // 5388
  const ASKELADDEN = NpcIdentifiers.ASKELADDEN; // 8402
  const ASKELADDEN_NPC_IDS = new Set([
    ASKELADDEN,
    NpcIdentifiers.ASKELADDEN_2, // 8403
    NpcIdentifiers.ASKELADDEN_3, // 8404
    NpcIdentifiers.ASKELADDEN_4, // 8405
  ]);
  const BARDUR = NpcIdentifiers.BARDUR; // 2263
  const BABA_YAGA = NpcIdentifiers.BABA_YAGA; // 3837
  const PEER_THE_SEER = NpcIdentifiers.PEER_THE_SEER; // 3895
  const PEER_THE_SEER_2 = NpcIdentifiers.PEER_THE_SEER_2; // 8147
  const PEER_NPC_IDS = new Set([PEER_THE_SEER, PEER_THE_SEER_2]);
  const FOSSEGRIMEN = NpcIdentifiers.FOSSEGRIMEN; // 808
  const JARVALD = NpcIdentifiers.JARVALD; // 5937, spawned by this plugin while exiled
  const JARVALD_2 = NpcIdentifiers.JARVALD_2; // 7205
  const JARVALD_3 = NpcIdentifiers.JARVALD_3; // 10407, the Waterbirth dock spawn
  const TORFINN = NpcIdentifiers.TORFINN; // 8131
  const TORFINN_NPC_IDS = new Set([
    TORFINN,
    NpcIdentifiers.TORFINN_2, // 10403
    NpcIdentifiers.TORFINN_3, // 10404
    NpcIdentifiers.TORFINN_4, // 10405
    NpcIdentifiers.TORFINN_5, // 10406
  ]);
  const THORODIN_NPC_IDS = new Set([NpcIdentifiers.THORODIN, NpcIdentifiers.THORODIN_2]); // 1094, 5526
  const FALO_THE_BARD = NpcIdentifiers.FALO_THE_BARD; // 7306
  const MARIA_GUNNARS_NPC_IDS = new Set([
    NpcIdentifiers.MARIA_GUNNARS, // 1882
    NpcIdentifiers.MARIA_GUNNARS_2, // 1883
  ]);
  const MORD_GUNNARS_NPC_IDS = new Set([
    NpcIdentifiers.MORD_GUNNARS, // 1900
    NpcIdentifiers.MORD_GUNNARS_2, // 1940
  ]);
  const OLAF_THE_BARD = NpcIdentifiers.OLAF_THE_BARD; // 802
  const SAILOR = NpcIdentifiers.SAILOR; // 3680, the Miscellania dock
  const SAILOR_2 = NpcIdentifiers.SAILOR_2; // 3936, the Rellekka dock
  const SAILOR_NPC_IDS = new Set([SAILOR, SAILOR_2]);
  const HASKELL_NPC_IDS = new Set([
    NpcIdentifiers.HASKELL, // 9270
    NpcIdentifiers.HASKELL_2, // 9271
    NpcIdentifiers.HASKELL_3, // 9272
  ]);
  const BASILISK_YOUNGLING = NpcIdentifiers.BASILISK_YOUNGLING; // 9282
  const MARKET_BASILISK_IDS = new Set([
    NpcIdentifiers.BASILISK, // 9283
    NpcIdentifiers.BASILISK_4, // 9284
    NpcIdentifiers.BASILISK_5, // 9285
    NpcIdentifiers.BASILISK_6, // 9286
  ]);
  const MARKET_MONSTROUS_IDS = new Set([
    NpcIdentifiers.MONSTROUS_BASILISK_2, // 9287
    NpcIdentifiers.MONSTROUS_BASILISK_3, // 9288
  ]);
  const TYPHOR = NpcIdentifiers.TYPHOR; // 9295
  const TYPHOR_2 = NpcIdentifiers.TYPHOR_2; // 9296
  const TYPHOR_NPC_IDS = new Set([TYPHOR, TYPHOR_2]);
  const THE_JORMUNGAND = NpcIdentifiers.THE_JORMUNGAND; // 9289
  const JORMUNGAND_NPC_IDS = new Set([
    THE_JORMUNGAND,
    NpcIdentifiers.THE_JORMUNGAND_2, // 9290
    NpcIdentifiers.THE_JORMUNGAND_3, // 9291
    NpcIdentifiers.THE_JORMUNGAND_4, // 9292
  ]);
  const BAKUNA = NpcIdentifiers.BAKUNA; // 9294
  const VRITRA = NpcIdentifiers.VRITRA; // 9297

  const DIALOGUE_NPC_IDS = new Set([
    ...BRUNDT_NPC_IDS,
    FREYGERD,
    REESO,
    ...ASKELADDEN_NPC_IDS,
    BARDUR,
    BABA_YAGA,
    ...PEER_NPC_IDS,
    FOSSEGRIMEN,
    JARVALD,
    JARVALD_2,
    JARVALD_3,
    ...TORFINN_NPC_IDS,
    ...THORODIN_NPC_IDS,
    FALO_THE_BARD,
    ...MARIA_GUNNARS_NPC_IDS,
    ...MORD_GUNNARS_NPC_IDS,
    OLAF_THE_BARD,
    ...SAILOR_NPC_IDS,
    NpcIdentifiers.HASKELL,
    NpcIdentifiers.HASKELL_2,
    NpcIdentifiers.HASKELL_3,
    THE_JORMUNGAND,
  ]);

  const FANG_ITEM = ItemIdentifiers.FANG; // 24254
  const VENOM_GLAND_ITEM = ItemIdentifiers.VENOM_GLAND; // 24255
  const UNSEALED_LETTER_ITEM = ItemIdentifiers.UNSEALED_LETTER; // 24256
  const UNSEALED_LETTER_2_ITEM = ItemIdentifiers.UNSEALED_LETTER_2; // 24257
  const V_SIGIL_ITEM = ItemIdentifiers.V_SIGIL; // 24258
  const V_SIGIL_E_ITEM = ItemIdentifiers.V_SIGIL_E_; // 24259
  const MOLTEN_GLASS_I_ITEM = ItemIdentifiers.MOLTEN_GLASS_I_; // 24260
  const LUNAR_GLASS_ITEM = ItemIdentifiers.LUNAR_GLASS; // 24261
  const POLISHING_ROCK_ITEM = ItemIdentifiers.POLISHING_ROCK; // 24262
  const VS_SHIELD_ITEM = ItemIdentifiers.VS_SHIELD_2; // 24266, the wieldable shield
  const PET_ROCK_ITEM = ItemIdentifiers.PET_ROCK; // 3695
  const PET_ROCK_ITEM_2 = ItemIdentifiers.PET_ROCK_2; // 16746
  const FREMENNIK_SHIELD_ITEM = ItemIdentifiers.FREMENNIK_SHIELD; // 3758
  const FREMENNIK_SHIELD_2_ITEM = ItemIdentifiers.FREMENNIK_SHIELD_2; // 16759
  const MOLTEN_GLASS_ITEM = ItemIdentifiers.MOLTEN_GLASS; // 1775
  const GLASSBLOWING_PIPE_ITEM = ItemIdentifiers.GLASSBLOWING_PIPE; // 1785
  const HAMMER_ITEM = ItemIdentifiers.HAMMER; // 2347
  const LUNAR_BAR_ITEM = ItemIdentifiers.LUNAR_BAR; // 9077
  const LUNAR_ORE_ITEM = ItemIdentifiers.LUNAR_ORE; // 9076
  const ASTRAL_RUNE_ITEM = ItemIdentifiers.ASTRAL_RUNE; // 9075
  const ICE_GLOVES_ITEM = ItemIdentifiers.ICE_GLOVES; // 1580
  const SMITHS_GLOVES_I_ITEM = ItemIdentifiers.SMITHS_GLOVES_I_; // 27031
  const KEG_OF_BEER_ITEM = ItemIdentifiers.KEG_OF_BEER_2; // 3801, the tradeable keg
  const KEG_OF_BEER_2_ITEM = ItemIdentifiers.KEG_OF_BEER_3; // 3802
  const RING_OF_CHAROS_A_ITEM = ItemIdentifiers.RING_OF_CHAROS_A_; // 6465
  const COINS_ITEM = ItemIdentifiers.COINS; // 995

  const UNSEALED_LETTER_ITEMS = new Set([UNSEALED_LETTER_ITEM, UNSEALED_LETTER_2_ITEM]);
  const FREMENNIK_SHIELD_ITEMS = new Set([FREMENNIK_SHIELD_ITEM, FREMENNIK_SHIELD_2_ITEM]);
  const VS_SHIELD_ITEMS = new Set([
    ItemIdentifiers.VS_SHIELD, // 24265
    VS_SHIELD_ITEM, // 24266
    ItemIdentifiers.VS_SHIELD_3, // 24267
  ]);
  const KEG_ITEMS = new Set([KEG_OF_BEER_ITEM, KEG_OF_BEER_2_ITEM]);
  const FISHING_ROD_ITEMS = new Set([
    ItemIdentifiers.FISHING_ROD, // 307
    ItemIdentifiers.FISHING_ROD_2, // 308
    ItemIdentifiers.FLY_FISHING_ROD, // 309
    ItemIdentifiers.FLY_FISHING_ROD_2, // 310
    ItemIdentifiers.BARBARIAN_ROD, // 11323
  ]);

  const SAND_PIT_IDS = new Set([
    ObjectIdentifiers.SAND_PIT_3, // 37391, the searchable state
    ObjectIdentifiers.SAND_PIT_4, // 37392
  ]);
  const ROCKSLIDE_IDS = new Set([
    ObjectIdentifiers.ROCKSLIDE_53, // 37395
    ObjectIdentifiers.ROCKSLIDE_54, // 37396
  ]);
  const BOXES_IDS = new Set([
    ObjectIdentifiers.BOXES_37, // 37398
    ObjectIdentifiers.BOXES_38, // 37399
  ]);
  const SMALL_GEYSER_IDS = new Set([
    ObjectIdentifiers.SMALL_GEYSER_2, // 37400
    ObjectIdentifiers.SMALL_GEYSER_3, // 37401
  ]);
  const LARGE_GEYSER_IDS = new Set([
    ObjectIdentifiers.LARGE_GEYSER_3, // 37402
    ObjectIdentifiers.LARGE_GEYSER_4, // 37403
  ]);
  const FREMENNIK_BOAT_IDS = new Set([
    ObjectIdentifiers.FREMENNIK_BOAT_6, // 37406
    ObjectIdentifiers.FREMENNIK_BOAT_7, // 37407
    ObjectIdentifiers.FREMENNIK_BOAT_8, // 37408, the Island of Stone side
  ]);
  const CAVE_IDS = new Set([
    ObjectIdentifiers.CAVE_74, // 37409
    ObjectIdentifiers.CAVE_75, // 37410
  ]);
  // Waterbirth dungeon route (cache map, rev 241): two unnamed floor buttons beside each
  // circular gate. 8965 is the north button, 8964 the south one; the closed gates are
  // 8960/8959/8958 from north to south and 8963 is the cache's actionless open leaf.
  const WATERBIRTH_BUTTON_IDS = new Set([8965, 8964]);
  const WATERBIRTH_BUTTON_X = 2490;
  const WATERBIRTH_GATE_DOORS = new Map([
    [8960, 10130],
    [8959, 10146],
    [8958, 10162],
  ]);
  const WATERBIRTH_OPEN_GATE_ID = 8963;
  // Door-support NPC barricades: 2250 north, 2253 middle/west, 2256 south.
  const WATERBIRTH_SUPPORT_IDS = new Set([2250, 2253, 2256]);
  const WATERBIRTH_SUPPORT_MIDDLE = 2253;
  const WATERBIRTH_SUPPORT_TILE = new Location(2544, 10143, 0);
  // Doors auto-close after 500 ticks (plugins/objects/Doors.plugin.js); pressure gates close
  // once the buttons are released, with a short grace for walking through.
  const WATERBIRTH_GATE_CLOSE_TICKS = 500;
  const WATERBIRTH_BUTTON_RELEASE_TICKS = 5;
  const WATERBIRTH_SUPPORT_RANGE = 4;
  const WATERBIRTH_SUPPORT_RESPAWN_TICKS = 25; // cache NpcDefinition respawn; door restore is inferred
  const WATERBIRTH_CENTRAL_DOOR_ID = 8967;
  const WATERBIRTH_CENTRAL_DOOR_TILES = [
    new Location(2545, 10141, 0),
    new Location(2543, 10143, 0),
    new Location(2545, 10145, 0),
  ];
  // Nameless multiloc parents placed in the map; forPlayer resolves them to the 37391+ ids.
  const SAND_PIT_PARENT = 4373;
  const ROCKSLIDE_PARENT = 20091;
  const BOXES_PARENT = 20092;
  const SMALL_GEYSER_PARENT = 20093;
  const LARGE_GEYSER_PARENT = 20094;
  const FREMENNIK_BOAT_PARENT = 37432;
  const CAVE_PARENT = 37433;
  const STRANGE_ALTAR = ObjectIdentifiers.STRANGE_ALTAR; // 4141
  const ASTRAL_ALTAR = ObjectIdentifiers.ALTAR_57; // 34771, Lunar Isle
  const ANVIL_IDS = new Set([
    ObjectIdentifiers.ANVIL, // 2031
    ObjectIdentifiers.AN_EXPERIMENTAL_ANVIL, // 2672
  ]);
  // Shipped rev241 Varrock/Lumbridge anvils and furnaces use these; quest objects keep
  // their canonical cache names, so ordinary smithing still falls through below.
  const CANONICAL_ANVIL_ID = 2097;
  const CANONICAL_FURNACE_ID = 24009;
  const FURNACE_IDS = new Set([
    ObjectIdentifiers.FURNACE, // 2030
    ObjectIdentifiers.FURNACE_2, // 2966
    ObjectIdentifiers.FURNACE_3, // 3294
    ObjectIdentifiers.SMALL_FURNACE, // 3994
  ]);

  function objectName(event) {
    return event.definition?.getName?.() ?? ObjectDefinition.forId(event.objectId)?.getName?.() ?? "";
  }

  function isAnvil(event) {
    return ANVIL_IDS.has(event.objectId) || event.objectId === CANONICAL_ANVIL_ID || objectName(event) === "Anvil";
  }

  function isFurnace(event) {
    return FURNACE_IDS.has(event.objectId) || event.objectId === CANONICAL_FURNACE_ID || objectName(event) === "Furnace";
  }

  // ==========================================================================
  // Varbits / stages / attributes
  // ==========================================================================

  const VARP_FREMENNIK_EXILES = 2595; // "vikingexile" parent
  const VARBIT_STAGE = 9459; // vikingexile, bits 0-8
  const VARBIT_YOUNGLING_KILLED = 9460;
  const VARBIT_LETTER_READ = 9461;
  const VARBIT_SHIELD_INFO = 9462;
  const VARBIT_GLASS_INFO = 9463;
  const VARBIT_ROCK_INFO = 9464;
  const VARBIT_SIGIL_INFO = 9465;
  const VARBIT_BASILISK_KILLS = 9466;
  const VARBIT_FREYGERD_TOLD = 9467;
  const VARBIT_YOUNGLING_FOUND = 9468;
  const VARBIT_BALLAD = 9469;
  const VARBIT_ROCK_GONE = 9470;
  const VARBIT_SHIELD_GIVEN = 9471;
  const VARBIT_HELM_UNLOCK = 9472;

  // Captured 1768.bin varbit 9459 route, cross-checked with RuneLite Quest Helper.
  const STAGE_STARTED = 5;
  const STAGE_BRIEFED = 10;
  const STAGE_INVESTIGATING = 15;
  const STAGE_REPORTED = 20;
  const STAGE_REPORT_ACK = 25;
  const STAGE_REPORT_EXPLAINED = 30;
  const STAGE_EXILED = 35;
  const STAGE_EXILED_BRIEFED = 40;
  const STAGE_COMPONENTS = 50;
  const STAGE_SHIELD_MADE = 50;
  const STAGE_SHIELD_GIVEN = 55;
  const STAGE_KEGS_REQUESTED = 60;
  const STAGE_KEGS_DRUNK = 65;
  const STAGE_MARKET = 70;
  const STAGE_MARKET_FIGHT = 77;
  const STAGE_INVASION = 80;
  const STAGE_BOAT = 85;
  const STAGE_MARKET_DONE = STAGE_BOAT;
  const STAGE_ISLAND = 85;
  const STAGE_DOOR_TOLD = 90;
  const STAGE_DOOR_OPEN = 95;
  const STAGE_PRISON = 100;
  const STAGE_TYPHOR_DEAD = 105;
  const STAGE_JORMUNGAND_PHASE = 110;
  const STAGE_JORMUNGAND_DEAD = 115;
  const STAGE_CELEBRATION = 120;
  const STAGE_FINISHING = 125;
  const STAGE_COMPLETE = 130;

  // varbit 9466 is the 0-100% invasion counter stored as 0-31; capture ends at 31.
  const BASILISK_POINTS = 1;
  const MONSTROUS_POINTS = 3;
  const BASILISK_TARGET = 31;
  const SECOND_KEG_LINE = "The chieftain quickly drinks the second keg and stumbles off.";
  const SECOND_KEG_STEP_ID = "F4atZx";
  const KEG_TAIL_VARIANT = "making-v-s-shield-making-the-shield-brundt-with-v-s-shield-without-two-kegs-of-beer-bringing-the-kegs-afterwards";

  const SCHEMA_ATTRIBUTE = "the-fremennik-exiles:schema";
  const SCHEMA_VERSION = 1;
  const LOCK_GROUP = 622;
  const LOCK_TARGET_UID = (164 << 16) | 16;
  const LOCK_SLOT_BUTTONS = [8, 15, 21, 27];
  const LOCK_GO_BUTTON = (LOCK_GROUP << 16) | 33;
  const LOCK_CLOSE_BUTTON = (LOCK_GROUP << 16) | 2;
  const LOCK_VARBIT_FIRST_SLOT = 9477;
  const LOCK_VARBIT_FEEDBACK_FIRST = 9482;
  const LOCK_VARBIT_ROWS_DONE = 9481;

  const LETTER_READ_ATTRIBUTE = "quest.the_fremennik_exiles.letter-read";
  const FREYGERD_TOLD_ATTRIBUTE = "quest.the_fremennik_exiles.freygerd-told";
  const YOUNGLING_FOUND_ATTRIBUTE = "quest.the_fremennik_exiles.youngling-found";
  const YOUNGLING_KILLED_ATTRIBUTE = "quest.the_fremennik_exiles.youngling-killed";
  const SAND_SEARCHED_ATTRIBUTE = "quest.the_fremennik_exiles.sand-searched";
  const SHIELD_INFO_ATTRIBUTE = "quest.the_fremennik_exiles.shield-info";
  const GLASS_INFO_ATTRIBUTE = "quest.the_fremennik_exiles.glass-info";
  const ROCK_INFO_ATTRIBUTE = "quest.the_fremennik_exiles.rock-info";
  const SIGIL_INFO_ATTRIBUTE = "quest.the_fremennik_exiles.sigil-info";
  const BARDUR_GOT_ATTRIBUTE = "quest.the_fremennik_exiles.bardur-got";
  const ROCK_ATTEMPTED_ATTRIBUTE = "quest.the_fremennik_exiles.rock-attempted";
  const PEER_FORGOT_ATTRIBUTE = "quest.the_fremennik_exiles.peer-forgot";
  const ROCK_GONE_ATTRIBUTE = "quest.the_fremennik_exiles.rock-gone";
  const SHIELD_GIVEN_ATTRIBUTE = "quest.the_fremennik_exiles.shield-given";
  const BASILISK_KILLS_ATTRIBUTE = "quest.the_fremennik_exiles.basilisk-kills";
  const MARKET_STARTED_ATTRIBUTE = "quest.the_fremennik_exiles.market-started";
  const TYPHOR_DEAD_ATTRIBUTE = "quest.the_fremennik_exiles.typhor-dead";
  const JORMUNGAND_DEAD_ATTRIBUTE = "quest.the_fremennik_exiles.jormungand-dead";
  const PUZZLE_OPEN_ATTRIBUTE = "quest.the_fremennik_exiles.puzzle-open";
  const PUZZLE_SOLUTION_ATTRIBUTE = "quest.the_fremennik_exiles.puzzle-solution";
  const PUZZLE_ATTEMPTS_ATTRIBUTE = "quest.the_fremennik_exiles.puzzle-attempts";
  const PUZZLE_GUESS_ATTRIBUTE = "quest.the_fremennik_exiles.puzzle-guess";

  // Tiles (checked walkable against the cache map).
  const WATERBIRTH_LANDING = new Location(2545, 3760, 0);
  const RELLEKKA_JARVALD_PIER = new Location(2641, 3709, 0);
  const RELLEKKA_MARKET_TILES = [
    new Location(2660, 3648, 0),
    new Location(2665, 3652, 0),
    new Location(2670, 3648, 0),
    new Location(2655, 3655, 0),
    new Location(2675, 3658, 0),
    new Location(2668, 3658, 0),
  ];
  const PRISON_ENTRY = new Location(2455, 10390, 0);
  const PRISON_TYPHOR = new Location(2458, 10380, 0);
  const PRISON_JORMUNGAND = new Location(2456, 10370, 0);
  const LONGHALL_LANDING = new Location(2659, 3665, 0);
  const RELLEKKA_PORT = new Location(2625, 3692, 0);
  const ISLAND_LANDING = new Location(2470, 4010, 0);

  const INVASION_CAMERA = [[2659, 3665, 600], [2659, 3670, 100]];
  const INVASION_CAMERA_TWO = [[2655, 3670, 600], [2659, 3675, 100]];
  const INVASION_CAMERA_THREE = [[2659, 3675, 600], [2659, 3669, 100]];
  const CELEBRATION_CAMERA = [[2659, 3671, 700], [2659, 3685, 200]];
  const CELEBRATION_CAMERA_TWO = [[2659, 3671, 700], [2659, 3674, 200]];
  const BALLAD_SINGER_ID = NpcIdentifiers.OLAF_THE_BARD_2; // 9274 during the celebration
  const BALLAD_SINGER_TILE = { x: 2659, y: 3683 };
  const CELEBRATION_START = new WeakSet();
  const JORM_PHASE_STARTED = new WeakSet();

  const RUNE_NAMES = ["Air", "Water", "Earth", "Fire", "Astral", "Cosmic"];
  const PUZZLE_SLOTS = 4;
  const PUZZLE_MAX_ATTEMPTS = 8;

  const QUEST_KEYS = {
    fremennik_trials: "fremennik_trials",
    the_fremennik_isles: "the_fremennik_isles",
    lunar_diplomacy: "lunar_diplomacy",
    mountain_daughter: "mountain_daughter",
    heroes_quest: "heroes_quest",
  };

  const startMenu = new WeakSet();
  const trackedNpcs = new Map();
  const marketNpcs = new Map();

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) === value) return;
    quest.setStage(player, value);
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
    syncVarbits(player);
    syncQuestNpcs(player);
  }

  /** Old saves used 1-130 values with several moved milestones. */
  function migrateStage(stage) {
    if (stage <= 0) return 0;
    if (stage <= 14) return STAGE_STARTED;
    if (stage <= 29) return STAGE_INVESTIGATING;
    if (stage <= 34) return STAGE_REPORTED;
    if (stage <= 49) return STAGE_EXILED;
    if (stage <= 60) return STAGE_COMPONENTS;
    if (stage <= 65) return STAGE_SHIELD_GIVEN;
    if (stage <= 79) return STAGE_MARKET;
    if (stage === 80) return STAGE_BOAT; // legacy 80 meant the invasion was survived
    if (stage <= 85) return STAGE_BOAT;
    if (stage <= 95) return STAGE_DOOR_TOLD;
    if (stage <= 99) return STAGE_DOOR_OPEN;
    if (stage <= 115) return STAGE_PRISON;
    if (stage <= 119) return STAGE_JORMUNGAND_DEAD;
    if (stage <= 129) return STAGE_CELEBRATION;
    return STAGE_COMPLETE;
  }

  function migrateSave(player) {
    if ((Number(player.getAttribute(SCHEMA_ATTRIBUTE)) || 0) >= SCHEMA_VERSION) return;
    const stage = quest.getStage(player);
    const migrated = migrateStage(stage);
    if (migrated !== stage) quest.setStage(player, migrated);
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function hasAnyItem(player, itemIds, amount = 1) {
    for (const itemId of itemIds) {
      if (player.getInventory().getAmount(itemId) >= amount) return true;
    }
    return false;
  }

  function inBank(player, itemId) {
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (player.getBank(tab)?.contains?.(itemId)) return true;
    }
    return false;
  }

  function hasItemAnywhere(player, itemId) {
    return hasItem(player, itemId) || inBank(player, itemId);
  }

  function hasAnyItemAnywhere(player, itemIds) {
    for (const itemId of itemIds) {
      if (hasItemAnywhere(player, itemId)) return true;
    }
    return false;
  }

  function addItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function takeItem(player, itemId, amount = 1) {
    if (!hasItem(player, itemId)) return false;
    player.getInventory().deleteNumber(itemId, amount);
    return true;
  }

  function takeAnyItem(player, itemIds, amount = 1) {
    for (const itemId of itemIds) {
      if (player.getInventory().getAmount(itemId) >= amount) {
        player.getInventory().deleteNumber(itemId, amount);
        return true;
      }
    }
    return false;
  }

  function hasQuestCompleted(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      hasQuestCompleted(player, QUEST_KEYS.the_fremennik_isles) &&
      hasQuestCompleted(player, QUEST_KEYS.lunar_diplomacy) &&
      hasQuestCompleted(player, QUEST_KEYS.mountain_daughter) &&
      hasQuestCompleted(player, QUEST_KEYS.heroes_quest) &&
      skills.getMaxLevel(Skill.CRAFTING) >= 65 &&
      skills.getMaxLevel(Skill.SLAYER) >= 60 &&
      skills.getMaxLevel(Skill.SMITHING) >= 60 &&
      skills.getMaxLevel(Skill.FISHING) >= 60 &&
      skills.getMaxLevel(Skill.MINING) >= 60 &&
      skills.getMaxLevel(Skill.RUNECRAFTING) >= 55
    );
  }

  function hasLetter(player) {
    return hasAnyItem(player, UNSEALED_LETTER_ITEMS);
  }

  function letterRead(player) {
    return player.getAttribute(LETTER_READ_ATTRIBUTE) === true;
  }

  function younglingFound(player) {
    return player.getAttribute(YOUNGLING_FOUND_ATTRIBUTE) === true;
  }

  function younglingKilled(player) {
    return player.getAttribute(YOUNGLING_KILLED_ATTRIBUTE) === true;
  }

  function sandSearched(player) {
    return player.getAttribute(SAND_SEARCHED_ATTRIBUTE) === true;
  }

  function freygerdTold(player) {
    return Number(player.getAttribute(FREYGERD_TOLD_ATTRIBUTE)) || 0;
  }

  function hasFremennikShield(player) {
    return hasAnyItem(player, FREMENNIK_SHIELD_ITEMS);
  }

  function hasGlovesEquipped(player) {
    const gloves = player.getEquipment().get(Equipment.HANDS_SLOT);
    const id = gloves?.getId?.();
    return id === ICE_GLOVES_ITEM || id === SMITHS_GLOVES_I_ITEM;
  }

  function hasGlovesInInventory(player) {
    return hasItem(player, ICE_GLOVES_ITEM) || hasItem(player, SMITHS_GLOVES_I_ITEM);
  }

  function hasFishingRod(player) {
    return hasAnyItem(player, FISHING_ROD_ITEMS);
  }

  function hasPetRock(player) {
    return hasItem(player, PET_ROCK_ITEM);
  }

  function rockGone(player) {
    return player.getAttribute(ROCK_GONE_ATTRIBUTE) === true;
  }

  function rockAttempted(player) {
    return player.getAttribute(ROCK_ATTEMPTED_ATTRIBUTE) === true;
  }

  function peerForgot(player) {
    return player.getAttribute(PEER_FORGOT_ATTRIBUTE) === true;
  }

  function hasPolishingRockAnywhere(player) {
    return hasItemAnywhere(player, POLISHING_ROCK_ITEM);
  }

  function shieldMade(player) {
    return hasAnyItem(player, VS_SHIELD_ITEMS);
  }

  function hasVsShieldInBank(player) {
    for (const itemId of VS_SHIELD_ITEMS) {
      if (inBank(player, itemId)) return true;
    }
    return false;
  }

  function kegCount(player) {
    let count = 0;
    for (const itemId of KEG_ITEMS) count += player.getInventory().getAmount(itemId);
    return count;
  }

  function killPercent(player) {
    return Number(player.getAttribute(BASILISK_KILLS_ATTRIBUTE)) || 0;
  }

  function setKillPercent(player, value) {
    const capped = Math.max(0, Math.min(BASILISK_TARGET, value | 0));
    player.setAttribute(BASILISK_KILLS_ATTRIBUTE, capped);
    player.getPacketSender().sendVarbit(VARBIT_BASILISK_KILLS, capped);
    return capped;
  }

  function marketStarted(player) {
    return player.getAttribute(MARKET_STARTED_ATTRIBUTE) === true;
  }

  function setMarketStarted(player, value) {
    player.setAttribute(MARKET_STARTED_ATTRIBUTE, value === true);
  }

  function typhorDead(player) {
    return player.getAttribute(TYPHOR_DEAD_ATTRIBUTE) === true;
  }

  function jormungandDead(player) {
    return player.getAttribute(JORMUNGAND_DEAD_ATTRIBUTE) === true;
  }

  function puzzleOpen(player) {
    return player.getAttribute(PUZZLE_OPEN_ATTRIBUTE) === true;
  }

  function resolvedObjectId(event) {
    if (typeof event.definition?.getId === "function") {
      const resolved = api.core.ObjectDefinition.forPlayer(event.objectId, event.player);
      return resolved?.getId?.() ?? event.definition.getId();
    }
    return event.objectId;
  }

  function contentNpcId(event) {
    return event.npc?.getContentId?.(event.player) ?? event.npcId;
  }

  function isExiled(player) {
    const stage = stageOf(player);
    return stage >= STAGE_EXILED && stage < STAGE_MARKET;
  }

  // ==========================================================================
  // Varbit sync
  // ==========================================================================

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_YOUNGLING_KILLED, younglingKilled(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_LETTER_READ, letterRead(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_SHIELD_INFO, Number(player.getAttribute(SHIELD_INFO_ATTRIBUTE)) || 0);
    sender.sendVarbit(VARBIT_GLASS_INFO, Number(player.getAttribute(GLASS_INFO_ATTRIBUTE)) || 0);
    sender.sendVarbit(VARBIT_ROCK_INFO, Number(player.getAttribute(ROCK_INFO_ATTRIBUTE)) || 0);
    sender.sendVarbit(VARBIT_SIGIL_INFO, Number(player.getAttribute(SIGIL_INFO_ATTRIBUTE)) || 0);
    sender.sendVarbit(VARBIT_BASILISK_KILLS, killPercent(player));
    sender.sendVarbit(VARBIT_FREYGERD_TOLD, freygerdTold(player));
    sender.sendVarbit(VARBIT_YOUNGLING_FOUND, younglingFound(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_BALLAD, quest.isComplete(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_ROCK_GONE, rockGone(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_SHIELD_GIVEN, player.getAttribute(SHIELD_GIVEN_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_HELM_UNLOCK, quest.isComplete(player) ? 1 : 0);
  }

  function handleLogin({ player }) {
    migrateSave(player);
    syncVarbits(player);
    syncQuestNpcs(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
    syncQuestNpcs(player);
  }

  function handleStageChanged(event) {
    if (event?.key !== "the_fremennik_exiles" || !event.player) return;
    syncVarbits(event.player);
    syncQuestNpcs(event.player);
  }

  function handleLogout({ player }) {
    Scenes.cancel(player);
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
    CELEBRATION_START.delete(player);
    JORM_PHASE_STARTED.delete(player);
    const tracked = trackedNpcs.get(player);
    if (tracked) {
      for (const npc of tracked.values()) {
        if (npc?.isRegistered?.()) api.removeNpc(npc);
      }
      trackedNpcs.delete(player);
    }
    clearMarketNpcs(player);
  }

  // ==========================================================================
  // Spawns
  // ==========================================================================

  function syncTracked(player, key, spawn) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    const existing = tracked.get(key);
    if (!spawn) {
      if (existing?.isRegistered?.()) api.removeNpc(existing);
      if (existing) tracked.delete(key);
      return null;
    }
    if (existing?.isRegistered?.() && existing.getId?.() === spawn.id) return existing;
    if (existing?.isRegistered?.()) api.removeNpc(existing);
    const npc = api.spawnNpc({ ...spawn, owner: player, ownerOnly: true });
    if (npc) tracked.set(key, npc);
    return npc;
  }

  function tracked(player, key) {
    return trackedNpcs.get(player)?.get(key) ?? null;
  }

  function syncQuestNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = stageOf(player);
    syncTracked(player, "jarvald", isExiled(player)
      ? { id: JARVALD, ...RELLEKKA_JARVALD_PIER, z: 0, wanderRadius: 0 }
      : null);
    // Askeladden has no world spawn in this repo; the exiled player needs him for a pet rock.
    syncTracked(player, "askeladden", isExiled(player)
      ? { id: ASKELADDEN, x: 2663, y: 3654, z: 0, wanderRadius: 0 }
      : null);
    // Fossegrimen has no world spawn either; the sigil hand-in needs her at the lake.
    syncTracked(player, "fossegrimen", isExiled(player) && stage >= STAGE_COMPONENTS
      ? { id: FOSSEGRIMEN, x: 2626, y: 3598, z: 0, wanderRadius: 0 }
      : null);
    // The captured celebration singer stands in the longhall while the ballad plays.
    syncTracked(player, "ballad-singer", stage >= STAGE_CELEBRATION && stage < STAGE_COMPLETE
      ? { id: BALLAD_SINGER_ID, ...BALLAD_SINGER_TILE, z: 0, wanderRadius: 0 }
      : null);
    if (stage >= STAGE_MARKET_FIGHT && stage < STAGE_MARKET_DONE && !marketWaveAlive(player)) {
      spawnMarketWave(player);
    }
    if (stage >= STAGE_PRISON && stage < STAGE_JORMUNGAND_DEAD && !typhorDead(player)) {
      ensurePrisonScene(player);
    } else if (stage >= STAGE_PRISON && stage < STAGE_JORMUNGAND_DEAD && typhorDead(player) && !jormungandDead(player)) {
      ensureJormungand(player);
    }
  }

  function ensurePrisonScene(player) {
    syncTracked(player, "bakuna", { id: BAKUNA, x: 2458, y: 10385, z: 0, wanderRadius: 0 });
    syncTracked(player, "vritra", { id: VRITRA, x: 2452, y: 10380, z: 0, wanderRadius: 0 });
    // 9295 is the non-attackable Typhor; 9296 carries the Attack option.
    syncTracked(player, "typhor", { id: TYPHOR_2, ...PRISON_TYPHOR, z: 0, wanderRadius: 0 });
  }

  function ensureJormungand(player) {
    syncTracked(player, "bakuna", null);
    syncTracked(player, "vritra", null);
    syncTracked(player, "typhor", null);
    // 9289 is the non-attackable Jormungand; 9291 carries the Attack option.
    const jorm = syncTracked(player, "jormungand", { id: NpcIdentifiers.THE_JORMUNGAND_3, ...PRISON_JORMUNGAND, z: 0, wanderRadius: 0 });
    startJormPhase(player, jorm);
  }

  /**
   * Captured Jormungand phase: his gaze warns, then drains combat stats unless the player
   * faces away. The stone bind is left to the base combat/area presentation.
   */
  function startJormPhase(player, jorm) {
    if (!jorm || JORM_PHASE_STARTED.has(player)) return;
    JORM_PHASE_STARTED.add(player);
    Scenes.later(player, 15, () => gazeAt(player, jorm));
    Scenes.later(player, 45, () => gazeAt(player, jorm));
  }

  function gazeAt(player, jorm) {
    if (stageOf(player) < STAGE_JORMUNGAND_PHASE || stageOf(player) >= STAGE_JORMUNGAND_DEAD) return;
    if (!jorm?.isRegistered?.() || !tracked(player, "jormungand")) return;
    player.sendMessage("<col=ef1020>The Jormungand gazes upon you!</col>");
    player.sendMessage("Brundt the Chieftain|Don't look at him Dalkar!");
    if (facingAwayFrom(player, jorm)) {
      player.sendMessage("<col=06600c>You avoid the gaze of the Jormungand!</col>");
      return;
    }
    player.sendMessage("<col=ef1020>The gaze of the Jormungand drains you!</col>");
    const skills = player.getSkillManager();
    for (const skill of [Skill.MAGIC, Skill.DEFENCE]) {
      const current = skills.getCurrentLevel(skill);
      skills.setCurrentLevelCombat?.(skill, Math.max(1, current - Math.max(1, Math.floor(current * 0.05))));
    }
  }

  /** True when the player's facing vector points away from the Jormungand. */
  function facingAwayFrom(player, npc) {
    const face = player.getPositionToFace?.();
    const from = player.getLocation?.();
    const to = npc.getLocation?.();
    if (!face || !from || !to) return false;
    const fx = face.getX?.() - from.getX?.();
    const fy = face.getY?.() - from.getY?.();
    const tx = to.getX?.() - from.getX?.();
    const ty = to.getY?.() - from.getY?.();
    return fx * tx + fy * ty < 0;
  }

  function clearMarketNpcs(player) {
    const wave = marketNpcs.get(player) ?? [];
    for (const npc of wave) {
      if (npc?.isRegistered?.()) api.removeNpc(npc);
    }
    marketNpcs.delete(player);
  }

  function marketWaveAlive(player) {
    const wave = marketNpcs.get(player) ?? [];
    return wave.some((npc) => npc?.isRegistered?.() && npc.getHitpoints?.() > 0);
  }

  function spawnMarketWave(player) {
    clearMarketNpcs(player);
    const wave = [];
    RELLEKKA_MARKET_TILES.forEach((tile, index) => {
      const isMonstrous = index === RELLEKKA_MARKET_TILES.length - 1;
      const npc = api.spawnNpc({
        id: isMonstrous ? NpcIdentifiers.MONSTROUS_BASILISK_2 : NpcIdentifiers.BASILISK,
        x: tile.getX(),
        y: tile.getY(),
        z: tile.getZ(),
        wanderRadius: 4,
        owner: player,
        ownerOnly: true,
      });
      if (npc) wave.push(npc);
    });
    marketNpcs.set(player, wave);
  }

  function startMarketFight(player) {
    setMarketStarted(player, true);
    setStage(player, STAGE_MARKET_FIGHT);
    playInvasionScene(player);
    spawnMarketWave(player);
    setStage(player, STAGE_INVASION);
    player.sendMessage("Basilisks pour into the Rellekka market!");
  }

  /** Captured 25189/25217-25765: fade, Rellekka camera frames, then reset. */
  function playInvasionScene(player) {
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => Scenes.camera(player, INVASION_CAMERA[0], INVASION_CAMERA[1], { rate: 0, rate2: 100 }));
    Scenes.later(player, 4, () => Scenes.camera(player, INVASION_CAMERA_TWO[0], INVASION_CAMERA_TWO[1], { rate: 1, rate2: 50 }));
    Scenes.later(player, 6, () => Scenes.camera(player, INVASION_CAMERA_THREE[0], INVASION_CAMERA_THREE[1], { rate: 1, rate2: 50 }));
    Scenes.later(player, 8, () => Scenes.fade(player, false));
    Scenes.later(player, 11, () => {
      player.getPacketSender().sendCameraReset();
      Scenes.closeFade(player);
      Scenes.controls(player, false);
    });
  }

  // ==========================================================================
  // Variant selection (transcript pages this plugin owns)
  // ==========================================================================

  function selectVariant(event) {
    const player = event?.player;
    if (!player) return null;
    const npcId = contentNpcId(event);
    const stage = stageOf(player);

    if (npcId === FREYGERD) return freygerdVariants(player, stage);
    if (npcId === REESO) return reesoVariants(player, stage);
    if (npcId === BARDUR) return bardurVariants(player, stage);
    if (npcId === BABA_YAGA) return babaYagaVariants(player, stage);
    if (npcId === JARVALD || npcId === JARVALD_2 || npcId === JARVALD_3) return jarvaldVariants(player, npcId, stage);
    if (TORFINN_NPC_IDS.has(npcId)) return exileOnly(player, "being-exiled-torfinn-before-dragon-slayer-ii", stage);
    if (THORODIN_NPC_IDS.has(npcId)) return exileOnly(player, "being-exiled-thorodin", stage);
    if (npcId === FALO_THE_BARD) return exileOnly(player, "being-exiled-falo-the-bard", stage);
    if (MARIA_GUNNARS_NPC_IDS.has(npcId)) return exileOnly(player, "being-exiled-maria-gunnars", stage);
    if (MORD_GUNNARS_NPC_IDS.has(npcId)) return exileOnly(player, "being-exiled-mord-gunnars", stage);
    if (HASKELL_NPC_IDS.has(npcId)) return haskellVariant(player, npcId, stage);
    return null;
  }

  function exileOnly(player, variant, stage) {
    return stage >= STAGE_EXILED && stage < STAGE_MARKET ? { page: PAGE, variant } : null;
  }

  function freygerdVariants(player, stage) {
    if (stage < STAGE_STARTED || stage >= STAGE_EXILED) return null;
    if (stage < STAGE_BRIEFED) setStage(player, STAGE_BRIEFED);
    if (stage < STAGE_INVESTIGATING) {
      setStage(player, STAGE_INVESTIGATING);
      return "investigating-the-disturbance-freygerd";
    }
    if (stage < STAGE_REPORTED) {
      if (hasLetter(player)) {
        takeAnyItem(player, UNSEALED_LETTER_ITEMS);
        takeItem(player, VENOM_GLAND_ITEM);
        takeItem(player, FANG_ITEM);
        player.setAttribute(FREYGERD_TOLD_ATTRIBUTE, 1);
        setStage(player, STAGE_REPORTED);
        return "investigating-the-disturbance-after-acquiring-the-unsealed-letter-freygerd";
      }
      return "investigating-the-disturbance-freygerd-again";
    }
    if (freygerdTold(player) >= 2) {
      return "investigating-the-disturbance-after-acquiring-the-unsealed-letter-freygerd-again-freygerd-after-telling-her-about-the-basilisk";
    }
    return "investigating-the-disturbance-after-acquiring-the-unsealed-letter-freygerd-again";
  }

  function reesoVariants(player, stage) {
    if (stage < STAGE_STARTED || stage >= STAGE_EXILED) return null;
    if (stage < STAGE_BRIEFED) setStage(player, STAGE_BRIEFED);
    if (stage < STAGE_INVESTIGATING) {
      setStage(player, STAGE_INVESTIGATING);
      return "investigating-the-disturbance-reeso";
    }
    if (stage >= STAGE_REPORTED) {
      return "investigating-the-disturbance-after-acquiring-the-unsealed-letter-reeso-again";
    }
    if (hasLetter(player)) {
      return "investigating-the-disturbance-after-acquiring-the-unsealed-letter-reeso";
    }
    return "investigating-the-disturbance-reeso-again";
  }

  function bardurVariants(player, stage) {
    if (stage < STAGE_EXILED || stage >= STAGE_MARKET) return null;
    if (stage < STAGE_COMPONENTS) return "being-exiled-bardur";
    if (player.getAttribute(BARDUR_GOT_ATTRIBUTE) === true) {
      return "making-v-s-shield-fremennik-shield-bardur-after-receiving-a-fremennik-shield-from-him";
    }
    return "making-v-s-shield-fremennik-shield-bardur";
  }

  function babaYagaVariants(player, stage) {
    if (stage < STAGE_COMPONENTS || stage >= STAGE_MARKET) return null;
    const info = Number(player.getAttribute(GLASS_INFO_ATTRIBUTE)) || 0;
    if (info >= 2) return "making-v-s-shield-lunar-glass-baba-yaga-again-after-she-imbues-the-molten-glass";
    if (info >= 1) return "making-v-s-shield-lunar-glass-baba-yaga-again";
    player.setAttribute(GLASS_INFO_ATTRIBUTE, 1);
    return "making-v-s-shield-lunar-glass-baba-yaga";
  }

  function jarvaldVariants(player, npcId, stage) {
    if (stage < STAGE_EXILED || stage >= STAGE_MARKET) return null;
    if (npcId === JARVALD) return "being-exiled-jarvald-rellekka";
    return "being-exiled-jarvald-waterbirth-island";
  }

  function haskellVariant(player, npcId, stage) {
    if (stage < STAGE_BOAT) return null;
    if (npcId === NpcIdentifiers.HASKELL) return "after-the-fremennik-exiles-rellekka";
    if (npcId === NpcIdentifiers.HASKELL_2) return "after-the-fremennik-exiles-rellekka";
    return "after-the-fremennik-exiles-island-of-stone";
  }

  // ==========================================================================
  // Prison scenes
  //
  // startTranscript flattens wiki speakers onto one chathead; the prison scenes
  // swap between Typhor/Bakuna/Vritra and the Jormungand, so play them through
  // NpcDialogues directly with the speaker -> NPC id map.
  // ==========================================================================

  const PRISON_SPEAKERS = new Map([
    ["Typhor", TYPHOR_2],
    ["Bakuna", BAKUNA],
    ["Vritra", VRITRA],
    ["The Jormungand", NpcIdentifiers.THE_JORMUNGAND_3],
    ["Brundt the Chieftain", BRUNDT_ISLAND_PRISON],
  ]);

  function playScene(player, npcId, variant) {
    const record = loadTranscripts(api)?.[PAGE];
    const steps = record?.variants?.[variant];
    if (!Array.isArray(steps) || steps.length === 0) return false;
    const definition = NpcDefinition.forId(npcId);
    const event = { player, npc: null, npcId, definition };
    startDialogue(api, event, steps, record.branches, {
      player,
      npc: null,
      npcId,
      definition,
      speakerIdByName: PRISON_SPEAKERS,
    });
    return true;
  }

  // ==========================================================================
  // Brundt / Peer / Askeladden / Sailor Talk-to overrides
  //
  // Fremennik Trials' variant selector claims these shared NPCs post-Trials, so the exiles
  // overrides them on the interaction hook and start the transcript themselves.
  // ==========================================================================

  function talksToMyQuest(event) {
    const player = event.player;
    if (!player) return false;
    const npcId = contentNpcId(event);
    const stage = stageOf(player);

    if (BRUNDT_NPC_IDS.has(npcId)) {
      const choice = brundtVariant(player, npcId, stage);
      const variant = typeof choice === "string" ? choice : choice?.variant;
      if (!variant) return false;
      event.handled = true;
      if (variant === "starting-out-brundt-the-chieftain") startMenu.add(player);
      // The prison scene swaps speakers, so give each line its own chathead.
      if (npcId === BRUNDT_ISLAND_PRISON) {
        playScene(player, npcId, variant);
        return true;
      }
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: event.npc,
        npcId,
        variant,
        select: typeof choice === "object" ? choice.select : undefined,
      });
      return true;
    }

    if (npcId === BABA_YAGA) {
      // Lunar Diplomacy's post-quest selector claims her; this specific hook runs
      // before the generic transcript resolver, so the shield hunt gets its menu.
      const variant = babaYagaVariants(player, stage);
      if (!variant) return false;
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", { player, npc: event.npc, npcId, variant });
      return true;
    }

    if (PEER_NPC_IDS.has(npcId)) {
      if (!isExiled(player) || stage < STAGE_COMPONENTS) return false;
      if (!rockAttempted(player) || peerForgot(player)) return false;
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: event.npc,
        npcId,
        variant: "making-v-s-shield-polishing-rock-peer-the-seer",
      });
      return true;
    }

    if (ASKELADDEN_NPC_IDS.has(npcId)) {
      if (!isExiled(player)) return false;
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: event.npc,
        npcId,
        variant: "being-exiled-askeladden",
      });
      return true;
    }

    if (SAILOR_NPC_IDS.has(npcId)) {
      if (!isExiled(player)) return false;
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: event.npc,
        npcId,
        variant: npcId === SAILOR_2 ? "being-exiled-sailor-rellekka" : "being-exiled-sailor-miscellania",
      });
      return true;
    }

    if (npcId === FOSSEGRIMEN) {
      if (!isExiled(player) || stage < STAGE_COMPONENTS) return false;
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: event.npc,
        npcId,
        variant: "making-v-s-shield-v-sigil-fossegrimen",
      });
      return true;
    }

    return false;
  }

  function brundtVariant(player, npcId, stage) {
    if (stage === STAGE_KEGS_DRUNK &&
        (npcId === BRUNDT_SOUTH_EAST || npcId === BRUNDT_LONGHALL)) {
      return { variant: KEG_TAIL_VARIANT, select: () => kegTailSteps() };
    }
    if (npcId === BRUNDT_SOUTH_EAST) {
      if (stage < STAGE_EXILED || stage >= STAGE_MARKET) return null;
      if (stage < STAGE_EXILED_BRIEFED) {
        setStage(player, STAGE_EXILED_BRIEFED);
        return "undoing-the-exilement-brundt";
      }
      if (stage < STAGE_COMPONENTS) {
        return "undoing-the-exilement-brundt-again";
      }
      if (stage < STAGE_SHIELD_GIVEN) {
        if (hasVsShieldInBank(player)) {
          return "making-v-s-shield-making-the-shield-brundt-with-v-s-shield-in-the-bank";
        }
        if (!shieldMade(player)) return "undoing-the-exilement-brundt-again";
        return "making-v-s-shield-making-the-shield-brundt-with-v-s-shield-without-two-kegs-of-beer";
      }
      if (kegCount(player) >= 2) {
        // The with-kegs variant opens and closes on "same as above" jumps into a
        // menu elsewhere on the page (the last one is Fossegrimen's); neither
        // resolves standalone, so drop them and let the beer hand-over play.
        return {
          variant: "making-v-s-shield-making-the-shield-brundt-with-v-s-shield-and-two-kegs-of-beer",
          select: (steps) => [
            ...(Array.isArray(steps) ? steps.filter((step) => step.type !== "jump") : []),
            ...kegTailSteps(),
          ],
        };
      }
      return "making-v-s-shield-making-the-shield-brundt-with-v-s-shield-without-two-kegs-of-beer-bringing-the-kegs-afterwards";
    }
    if (npcId === BRUNDT_ISLAND_DOOR) {
      if (stage < STAGE_ISLAND || stage >= STAGE_PRISON) return null;
      if (stage < STAGE_DOOR_TOLD) {
        setStage(player, STAGE_DOOR_TOLD);
        return "island-of-stone-brundt";
      }
      if (stage < STAGE_DOOR_OPEN) return "island-of-stone-brundt-brundt-again";
      if (stage === STAGE_DOOR_OPEN) {
        return "island-of-stone-brundt-unlocking-the-door";
      }
      return "island-of-stone-brundt-again-after-unlocking-the-door";
    }
    if (npcId === BRUNDT_ISLAND_PRISON) {
      if (stage < STAGE_PRISON || stage >= STAGE_JORMUNGAND_DEAD) return null;
      return "island-of-stone-brundt-again-after-unlocking-the-door-going-into-jormungand-s-prison";
    }
    // The longhall Brundt.
    if (stage <= 0) {
      // Let Lunar Diplomacy reclaim a lost Seal of Passage before offering this quest.
      if (npcId === BRUNDT_LONGHALL &&
          hasQuestCompleted(player, QUEST_KEYS.lunar_diplomacy) &&
          !hasItemAnywhere(player, ItemIdentifiers.SEAL_OF_PASSAGE)) return null;
      if (!meetsRequirements(player)) return null;
      return "starting-out-brundt-the-chieftain";
    }
    if (stage < STAGE_INVESTIGATING) {
      return "starting-out-brundt-the-chieftain-when-talked-to-again-before-going-to-investigate";
    }
    if (stage < STAGE_EXILED) {
      return "investigating-the-disturbance-after-acquiring-the-unsealed-letter-brundt";
    }
    if (stage < STAGE_MARKET) {
      return "being-exiled-brundt";
    }
    if (stage < STAGE_MARKET_DONE) {
      if (stage === STAGE_MARKET && !marketStarted(player)) {
        return "basilisks-in-the-market-brundt";
      }
      return "basilisks-in-the-market-brundt-again";
    }
    if (stage === STAGE_MARKET_DONE) {
      return "basilisks-in-the-market-brundt-again-after-killing-enough-basilisks";
    }
    if (stage >= STAGE_CELEBRATION && stage < STAGE_COMPLETE) {
      return "longhall-celebration";
    }
    if (stage >= STAGE_COMPLETE) {
      // Yield only when Lunar needs to replace a lost Seal; otherwise keep the
      // Exiles postquest page on Brundt.
      if (hasQuestCompleted(player, QUEST_KEYS.lunar_diplomacy) &&
          !hasItemAnywhere(player, ItemIdentifiers.SEAL_OF_PASSAGE)) return null;
      return "standard-dialogue-after-the-fremennik-exiles";
    }
    return null;
  }

  // ==========================================================================
  // Prose condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return null;
    const freeSlot = player.getInventory().getFreeSlots() > 0;
    switch (stepId) {
      // Inventory space (boxes, rockslide, sand pit).
      case "GCFS54":
      case "8Q-E67":
        return !freeSlot;
      case "KGOb__":
      case "c5H4CI":
        return freeSlot;
      // The unsealed letter.
      case "1QUfx_":
        return hasLetter(player);
      case "DYv8e2":
        return !hasLetter(player) && !freeSlot;
      case "1STYgW":
        return !hasLetter(player);
      case "eFLDx5":
        return !letterRead(player);
      case "IRogRM":
        return !hasLetter(player);
      case "C5vRKR":
        return letterRead(player);
      // Fremennik shield.
      case "1dygsA":
        return hasFremennikShield(player);
      case "rNkcIz":
        return !hasFremennikShield(player);
      case "0Ac_mq":
        return hasAnyItemAnywhere(player, FREMENNIK_SHIELD_ITEMS);
      case "3ppJYa":
        return !hasAnyItemAnywhere(player, FREMENNIK_SHIELD_ITEMS);
      // Molten glass and molten glass (i).
      case "hia57h":
      case "L9f-vG":
      case "yj3IxO":
        return !hasItem(player, MOLTEN_GLASS_ITEM);
      case "ffjoLb":
      case "tEOn3E":
      case "OQRvzn":
        return hasItem(player, MOLTEN_GLASS_ITEM);
      case "wh85o9":
        return !hasItem(player, MOLTEN_GLASS_I_ITEM);
      case "HVD0O6":
        return hasItem(player, MOLTEN_GLASS_I_ITEM) && !hasItem(player, ASTRAL_RUNE_ITEM, 100);
      case "Bsq0Q6":
        return hasItem(player, MOLTEN_GLASS_I_ITEM) && hasItem(player, ASTRAL_RUNE_ITEM, 100);
      case "Mw2A_K":
        return hasItem(player, MOLTEN_GLASS_I_ITEM);
      case "puIcJz":
        return !hasItem(player, MOLTEN_GLASS_I_ITEM);
      case "7Qi3Ua":
        return hasItemAnywhere(player, LUNAR_GLASS_ITEM);
      // Pet rock and the geyser.
      case "4wwkfk":
      case "upcKPL":
        return !hasPetRock(player);
      case "mZk-yK":
      case "tOBGEa":
        return hasPetRock(player);
      case "pqQg4L":
        return !rockGone(player);
      case "k6qIvx":
        return rockGone(player);
      // Gloves.
      case "G99VCG":
        return !hasGlovesEquipped(player);
      case "cvO2CX":
        return !hasGlovesInInventory(player);
      case "k4hbGi":
        return hasGlovesInInventory(player);
      case "rrj50Q":
        return hasGlovesEquipped(player);
      // Polishing rock.
      case "O4HyUr":
        return hasItem(player, POLISHING_ROCK_ITEM);
      case "gsF60N":
        return inBank(player, POLISHING_ROCK_ITEM);
      // Lunar bars and the V sigil.
      case "Q7HhQQ":
        return player.getInventory().getAmount(LUNAR_BAR_ITEM) < 3;
      case "C4wsVN":
        return player.getInventory().getAmount(LUNAR_BAR_ITEM) >= 3;
      case "zuvNDl":
        return !hasItem(player, V_SIGIL_ITEM);
      case "-DcC04":
        return hasItem(player, V_SIGIL_ITEM);
      // The glassblowing pipe.
      case "wOTBii":
        return !hasItem(player, GLASSBLOWING_PIPE_ITEM);
      case "3gyYTy":
        return hasItem(player, GLASSBLOWING_PIPE_ITEM);
      // The Jormungand's specials are not simulated.
      case "C6zHQ6":
      case "DLVETM":
        return false;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript action/message handler
  // ==========================================================================

  function finishCelebration(player) {
    if (quest.isComplete(player)) return;
    if (stageOf(player) < STAGE_FINISHING) setStage(player, STAGE_FINISHING);
    quest.complete(player);
    player.getPacketSender().sendCameraReset();
    Scenes.controls(player, false);
  }

  function handleAction(event) {
    const { player } = event;
    if (!player) return;
    switch (event.stepId) {
      case "GlBLqd":
        if (!hasItem(player, VENOM_GLAND_ITEM)) addItem(player, VENOM_GLAND_ITEM);
        return;
      case "VS6v4T":
        if (!hasItem(player, FANG_ITEM)) addItem(player, FANG_ITEM);
        return;
      case "2ifb16":
        findYoungling(player);
        return;
      case "-FwZ36":
      case "7GSRhQ":
        if (!hasLetter(player)) addItem(player, UNSEALED_LETTER_ITEM);
        return;
      case "3GZ_6N":
        if (BRUNDT_NPC_IDS.has(event.npcId) && stageOf(player) < STAGE_EXILED) {
          setStage(player, STAGE_EXILED);
        }
        return;
      case "0vNIwJ":
        buyFremennikShield(player);
        return;
      case "rVPVWw":
        receiveCharmedShield(player);
        return;
      case "RavOEl":
        if (!hasPetRock(player) && !rockGone(player)) addItem(player, PET_ROCK_ITEM);
        return;
      case "jql-pN":
      case "GEaVzt":
      case "hsbo5w":
        if (takeItem(player, MOLTEN_GLASS_ITEM)) {
          addItem(player, MOLTEN_GLASS_I_ITEM);
          player.setAttribute(GLASS_INFO_ATTRIBUTE, 2);
          player.getPacketSender().sendVarbit(VARBIT_GLASS_INFO, 2);
        }
        return;
      case "ozZK9D":
        if (hasItem(player, ASTRAL_RUNE_ITEM, 100) && takeItem(player, MOLTEN_GLASS_I_ITEM)) {
          player.getInventory().deleteNumber(ASTRAL_RUNE_ITEM, 100);
          addItem(player, LUNAR_GLASS_ITEM);
        }
        return;
      case "E44eQ-":
        if (player.getInventory().getAmount(LUNAR_BAR_ITEM) >= 3) {
          player.getInventory().deleteNumber(LUNAR_BAR_ITEM, 3);
          if (!hasItem(player, V_SIGIL_ITEM)) addItem(player, V_SIGIL_ITEM);
        }
        return;
      case "6KqfTH":
      case "A8Q8So":
        dropPetRock(player);
        return;
      case "YkBPHX":
      case "RhgQ8J":
        collectPolishingRock(player);
        return;
      case "hneqPY":
        player.setAttribute(ROCK_INFO_ATTRIBUTE, 2);
        player.getPacketSender().sendVarbit(VARBIT_ROCK_INFO, 2);
        return;
      case "mOTzCI":
        makeShield(player);
        return;
      case "jcMyFM":
        handShieldToBrundt(player);
        return;
      case "CyJ-jx":
        drinkKegs(player);
        return;
      case "mSB9hO":
        if (!shieldMade(player)) addItem(player, VS_SHIELD_ITEM);
        if (stageOf(player) >= STAGE_MARKET && stageOf(player) < STAGE_MARKET_FIGHT) setStage(player, 76);
        return;
      case "M7J2_U":
        if (stageOf(player) >= STAGE_MARKET && stageOf(player) < STAGE_MARKET_FIGHT) startMarketFight(player);
        return;
      case "GciOqM":
        clearMarketNpcs(player);
        return;
      case "DwWDam":
        if (player) syncTracked(player, "bakuna", null);
        return;
      case "qY-jfP":
        player.sendMessage("Brundt's item retrieval service isn't available here.");
        return;
      case "TxYAiw":
        player.getPacketSender().sendVarbit(VARBIT_BALLAD, 1);
        return;
      case "2pgrdA":
        finishCelebration(player);
        return;
      case SECOND_KEG_STEP_ID:
        if (stageOf(player) === STAGE_KEGS_DRUNK) setStage(player, STAGE_MARKET);
        return;
      default:
        return;
    }
  }

  function findYoungling(player) {
    if (tracked(player, "youngling")?.isRegistered?.()) return;
    syncTracked(player, "youngling", {
      id: BASILISK_YOUNGLING,
      x: 2668,
      y: 3706,
      z: 0,
      wanderRadius: 2,
    });
    player.setAttribute(YOUNGLING_FOUND_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_YOUNGLING_FOUND, 1);
  }

  function buyFremennikShield(player) {
    if (!hasItem(player, COINS_ITEM, 150000)) {
      player.sendMessage("You don't have 150,000 coins.");
      return;
    }
    player.getInventory().deleteNumber(COINS_ITEM, 150000);
    addItem(player, FREMENNIK_SHIELD_ITEM);
    player.setAttribute(BARDUR_GOT_ATTRIBUTE, true);
    player.setAttribute(SHIELD_INFO_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(VARBIT_SHIELD_INFO, 1);
  }

  function receiveCharmedShield(player) {
    const ring = player.getEquipment().get(Equipment.RING_SLOT)?.getId?.();
    if (ring !== RING_OF_CHAROS_A_ITEM && !hasItem(player, RING_OF_CHAROS_A_ITEM)) {
      player.sendMessage("Bardur is not charmed - the Ring of Charos(a) would help.");
      return;
    }
    if (!hasFremennikShield(player)) addItem(player, FREMENNIK_SHIELD_ITEM);
    player.setAttribute(BARDUR_GOT_ATTRIBUTE, true);
    player.setAttribute(SHIELD_INFO_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(VARBIT_SHIELD_INFO, 1);
  }

  function dropPetRock(player) {
    if (rockGone(player)) return;
    if (!takeItem(player, PET_ROCK_ITEM)) return;
    player.setAttribute(ROCK_GONE_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_ROCK_GONE, 1);
  }

  function collectPolishingRock(player) {
    if (!hasGlovesEquipped(player)) {
      player.sendMessage("The geyser is too hot to reach into without ice gloves.");
      return;
    }
    if (!hasFishingRod(player)) {
      player.sendMessage("You need a fishing rod to reach into the geyser.");
      return;
    }
    if (rockGone(player)) {
      player.setAttribute(ROCK_GONE_ATTRIBUTE, false);
      player.getPacketSender().sendVarbit(VARBIT_ROCK_GONE, 0);
    }
    if (!hasItem(player, POLISHING_ROCK_ITEM)) addItem(player, POLISHING_ROCK_ITEM);
    player.setAttribute(ROCK_INFO_ATTRIBUTE, 3);
    player.getPacketSender().sendVarbit(VARBIT_ROCK_INFO, 3);
  }

  function makeShield(player) {
    if (!hasItem(player, GLASSBLOWING_PIPE_ITEM)) {
      player.sendMessage("You need a glassblowing pipe to work the lunar glass.");
      return;
    }
    if (!hasItem(player, FREMENNIK_SHIELD_ITEM) && !hasItem(player, FREMENNIK_SHIELD_2_ITEM)) return;
    if (!takeAnyItem(player, FREMENNIK_SHIELD_ITEMS)) return;
    takeItem(player, LUNAR_GLASS_ITEM);
    takeItem(player, POLISHING_ROCK_ITEM);
    takeItem(player, V_SIGIL_E_ITEM);
    if (!hasItem(player, PET_ROCK_ITEM)) addItem(player, PET_ROCK_ITEM);
    addItem(player, VS_SHIELD_ITEM);
  }

  function handShieldToBrundt(player) {
    takeAnyItem(player, VS_SHIELD_ITEMS);
    player.setAttribute(SHIELD_GIVEN_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_SHIELD_GIVEN, 1);
    setStage(player, STAGE_SHIELD_GIVEN);
  }

  function drinkKegs(player) {
    if (stageOf(player) !== STAGE_KEGS_REQUESTED || kegCount(player) < 2) return;
    let remaining = 2;
    for (const itemId of KEG_ITEMS) {
      const take = Math.min(remaining, player.getInventory().getAmount(itemId));
      if (take > 0) {
        player.getInventory().deleteNumber(itemId, take);
        remaining -= take;
      }
    }
    setStage(player, STAGE_KEGS_DRUNK);
  }

  /** The shipped "bringing the kegs afterwards" branch from its Hey! tail. */
  function kegTailSteps() {
    const record = loadTranscripts(api)?.[PAGE];
    const raw = record?.variants?.[KEG_TAIL_VARIANT] ?? [];
    const start = raw.findIndex((step) => step?.player === "Hey!");
    if (start < 0) return [];
    return raw.slice(start).map((step) =>
      step?.id === SECOND_KEG_STEP_ID
        ? { ...step, type: "message", text: SECOND_KEG_LINE, box: { statement: true } }
        : step
    );
  }

  // ==========================================================================
  // Transcript choice handler
  // ==========================================================================

  function finishShieldQuestions(player) {
    const asked = [SHIELD_INFO_ATTRIBUTE, GLASS_INFO_ATTRIBUTE, ROCK_INFO_ATTRIBUTE, SIGIL_INFO_ATTRIBUTE]
      .every((key) => Number(player.getAttribute(key)) >= 1);
    if (asked && stageOf(player) === STAGE_EXILED_BRIEFED) setStage(player, STAGE_COMPONENTS);
  }

  function handleChoice(event) {
    const { player, option } = event;
    if (!player) return;
    const npcId = contentNpcId(event);

    if (BRUNDT_NPC_IDS.has(npcId)) {
      if (startMenu.has(player)) {
        if (option === "Yes." || option === "No.") {
          startMenu.delete(player);
          if (option === "Yes.") {
            if (!meetsRequirements(player)) {
              player.sendMessage("You don't meet the requirements for this quest.");
            } else if (quest.getStage(player) === 0) {
              setStage(player, STAGE_STARTED);
            }
          }
        }
        return;
      }
      if (option === "Where can I find a Fremennik Shield?") {
        player.setAttribute(SHIELD_INFO_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(VARBIT_SHIELD_INFO, 1);
        finishShieldQuestions(player);
        return;
      }
      if (option === "Where can I get Lunar Glass?") {
        player.setAttribute(GLASS_INFO_ATTRIBUTE, Math.max(1, Number(player.getAttribute(GLASS_INFO_ATTRIBUTE)) || 0));
        player.getPacketSender().sendVarbit(VARBIT_GLASS_INFO, Number(player.getAttribute(GLASS_INFO_ATTRIBUTE)) || 1);
        finishShieldQuestions(player);
        return;
      }
      if (option === "How do I make the Polishing Rock?") {
        player.setAttribute(ROCK_INFO_ATTRIBUTE, Math.max(1, Number(player.getAttribute(ROCK_INFO_ATTRIBUTE)) || 0));
        player.getPacketSender().sendVarbit(VARBIT_ROCK_INFO, Number(player.getAttribute(ROCK_INFO_ATTRIBUTE)) || 1);
        finishShieldQuestions(player);
        return;
      }
      if (option === "How do I make V's Sigil?") {
        player.setAttribute(SIGIL_INFO_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(VARBIT_SIGIL_INFO, 1);
        finishShieldQuestions(player);
        return;
      }
      return;
    }

    if (npcId === FREYGERD) {
      if (option === "Terrify her with all the details.") {
        player.setAttribute(FREYGERD_TOLD_ATTRIBUTE, 2);
        player.getPacketSender().sendVarbit(VARBIT_FREYGERD_TOLD, 2);
        return;
      }
      if (option === "Spare her the truth.") {
        player.setAttribute(FREYGERD_TOLD_ATTRIBUTE, Math.max(1, freygerdTold(player)));
        player.getPacketSender().sendVarbit(VARBIT_FREYGERD_TOLD, freygerdTold(player));
        return;
      }
    }

    if ((npcId === JARVALD || npcId === JARVALD_2 || npcId === JARVALD_3)) {
      if (npcId === JARVALD && option === "Please Jarvald, it's really important!") {
        player.moveTo(WATERBIRTH_LANDING);
        return;
      }
      if (npcId !== JARVALD && option === "Yes please.") {
        player.moveTo(RELLEKKA_JARVALD_PIER);
        return;
      }
    }

    if (SAILOR_NPC_IDS.has(npcId)) {
      if (npcId === SAILOR_2 && option === "Please, I must get to Miscellania.") {
        player.moveTo(new Location(2581, 3847, 0));
        return;
      }
      if (npcId === SAILOR && option === "Let's go!") {
        player.moveTo(RELLEKKA_JARVALD_PIER);
        return;
      }
    }

    if (HASKELL_NPC_IDS.has(npcId) && option === "Yes please.") {
      if (npcId === NpcIdentifiers.HASKELL_3) {
        player.moveTo(RELLEKKA_PORT);
      } else {
        player.moveTo(ISLAND_LANDING);
      }
      return;
    }
  }

  // ==========================================================================
  // Transcript line handler
  // ==========================================================================

  function handleLine(event) {
    const { player, npcId } = event;
    if (!player || typeof event.text !== "string") return;
    const text = event.text;
    if (!DIALOGUE_NPC_IDS.has(npcId)) return;

    if (text.includes("[Fremennik name]")) {
      event.text = text.split("[Fremennik name]").join(player.getUsername?.() ?? "");
    }
    const gendered = [
      ["[He/She]", "He", "She"],
      ["[he/she]", "he", "she"],
      ["[him/her]", "him", "her"],
      ["[his/her]", "his", "her"],
    ];
    if (event.text.includes("[")) {
      const male = player.getAppearance?.()?.isMale?.() !== false;
      for (const [token, maleText, femaleText] of gendered) {
        if (event.text.includes(token)) {
          event.text = event.text.split(token).join(male ? maleText : femaleText);
        }
      }
    }

    if (npcId === FOSSEGRIMEN && text.startsWith("There you go! Go forth mighty warrior.")) {
      if (takeItem(player, V_SIGIL_ITEM)) {
        addItem(player, V_SIGIL_E_ITEM);
        player.setAttribute(SIGIL_INFO_ATTRIBUTE, 2);
        player.getPacketSender().sendVarbit(VARBIT_SIGIL_INFO, 2);
      }
      return;
    }

    if (PEER_NPC_IDS.has(npcId) && text.startsWith("Now be gone with you, exile!")) {
      player.setAttribute(PEER_FORGOT_ATTRIBUTE, true);
      player.setAttribute(ROCK_INFO_ATTRIBUTE, 2);
      player.getPacketSender().sendVarbit(VARBIT_ROCK_INFO, 2);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && text.includes("Freygerd and Reeso run the sandpit")) {
      if (stageOf(player) < STAGE_BRIEFED) setStage(player, STAGE_BRIEFED);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && stageOf(player) === STAGE_REPORTED && text.startsWith("Dalkar, I'm glad")) {
      setStage(player, STAGE_REPORT_ACK);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && stageOf(player) === STAGE_REPORT_ACK && text.startsWith("Exactly. Now the Moon Clan")) {
      setStage(player, STAGE_REPORT_EXPLAINED);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && stageOf(player) === STAGE_EXILED && text.startsWith("Keep in mind, now that you've been exiled")) {
      setStage(player, STAGE_EXILED_BRIEFED);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && stageOf(player) === STAGE_EXILED_BRIEFED && text.startsWith("Then you have the Polishing Rock")) {
      setStage(player, STAGE_COMPONENTS);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && stageOf(player) === STAGE_MARKET && text.startsWith("Good to see you")) {
      setStage(player, 75);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && text.startsWith("Return to me with two beers")) {
      if (stageOf(player) >= STAGE_SHIELD_GIVEN && stageOf(player) < STAGE_KEGS_REQUESTED) {
        setStage(player, STAGE_KEGS_REQUESTED);
      }
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && text.startsWith("The chieftain quickly drinks the second keg")) {
      if (stageOf(player) < STAGE_MARKET) setStage(player, STAGE_MARKET);
      return;
    }

    if (BRUNDT_NPC_IDS.has(npcId) && text.startsWith("Leave at once. Do not attempt")) {
      if (stageOf(player) < STAGE_EXILED) setStage(player, STAGE_EXILED);
      return;
    }

    // RoyalTrouble's line handler substitutes "[Fremennik name]" before this runs.
    if (BRUNDT_NPC_IDS.has(npcId) && text.includes("Get to the boat")) {
      if (stageOf(player) === STAGE_MARKET_DONE) setStage(player, STAGE_BOAT);
      return;
    }

    if (npcId === BRUNDT_ISLAND_PRISON && stageOf(player) >= STAGE_JORMUNGAND_DEAD && text.startsWith("You worry too much")) {
      handleJormungandFinish(player);
      return;
    }

    // The celebration ends on the player's "Uh oh..." line, spoken with Brundt's
    // npc id (the transcript's Olaf lines belong to the cutscene).
    if (stageOf(player) >= STAGE_CELEBRATION && text.startsWith("T'was on a haughty winter")) {
      startCelebrationScene(player);
      return;
    }

    if (stageOf(player) >= STAGE_CELEBRATION && text.startsWith("Uh oh")) {
      if (stageOf(player) < STAGE_FINISHING) setStage(player, STAGE_FINISHING);
      // The wiki transcript puts its final completion action after an explicit
      // `end`, which the dialogue chain closes before reaching. Run the canonical
      // completion once the player continues past this final line instead.
      event.after = () => finishCelebration(player);
      return;
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player } = event;
    if (!player) return;
    const objectId = resolvedObjectId(event);
    const rawId = event.objectId;

    if (SAND_PIT_IDS.has(objectId) || rawId === SAND_PIT_PARENT) {
      event.handled = true;
      searchSandPit(player);
      return;
    }
    if (ROCKSLIDE_IDS.has(objectId) || rawId === ROCKSLIDE_PARENT) {
      event.handled = true;
      searchRockslide(player);
      return;
    }
    if (BOXES_IDS.has(objectId) || rawId === BOXES_PARENT) {
      event.handled = true;
      searchBoxes(player);
      return;
    }
    if (SMALL_GEYSER_IDS.has(objectId) || rawId === SMALL_GEYSER_PARENT) {
      event.handled = true;
      inspectSmallGeyser(player);
      return;
    }
    if (LARGE_GEYSER_IDS.has(objectId) || rawId === LARGE_GEYSER_PARENT) {
      event.handled = true;
      inspectLargeGeyser(player);
      return;
    }
    if (FREMENNIK_BOAT_IDS.has(objectId) || rawId === FREMENNIK_BOAT_PARENT) {
      event.handled = true;
      travelFremennikBoat(player, objectId);
      return;
    }
    if (CAVE_IDS.has(objectId) || rawId === CAVE_PARENT) {
      event.handled = true;
      enterIslandCave(player);
      return;
    }
    if (WATERBIRTH_GATE_DOORS.has(objectId)) {
      if (isExiled(player) && stageOf(player) >= STAGE_COMPONENTS && stageOf(player) < STAGE_MARKET) {
        event.handled = true;
        openWaterbirthGate(player, objectId, event.object);
      }
      return;
    }
    // The Waterbirth cave entrances (8929/8930) deliberately fall through to
    // LocTeleports, which plays their captured landings inside the real dungeon.
    if (objectId === STRANGE_ALTAR || rawId === STRANGE_ALTAR) {
      if (isExiled(player) && stageOf(player) >= STAGE_COMPONENTS) {
        event.handled = true;
        summonFossegrimen(player);
      }
    }
  }

  function inInvestigationStage(player) {
    const stage = stageOf(player);
    return stage >= STAGE_STARTED && stage < STAGE_EXILED;
  }

  function searchSandPit(player) {
    if (!inInvestigationStage(player)) return;
    if (younglingKilled(player) && !sandSearched(player)) {
      player.setAttribute(SAND_SEARCHED_ATTRIBUTE, true);
      startTranscript(api, player, FREYGERD, PAGE, "investigating-the-disturbance-searching-outside-the-house-sand-pit-after-killing-the-basilisk-youngling");
      return;
    }
    if (younglingKilled(player)) {
      startTranscript(api, player, FREYGERD, PAGE, "investigating-the-disturbance-searching-outside-the-house-sand-pit-search-the-sandpit-again-after-killing-the-basilisk-youngling");
      return;
    }
    startTranscript(api, player, FREYGERD, PAGE, "investigating-the-disturbance-searching-outside-the-house-sand-pit");
  }

  function searchRockslide(player) {
    if (!inInvestigationStage(player)) return;
    const variant = hasItem(player, FANG_ITEM)
      ? "investigating-the-disturbance-searching-outside-the-house-rockslide-inspecting-the-fang"
      : "investigating-the-disturbance-searching-outside-the-house-rockslide";
    startTranscript(api, player, FREYGERD, PAGE, variant);
  }

  function searchBoxes(player) {
    if (!inInvestigationStage(player)) return;
    const variant = hasItem(player, VENOM_GLAND_ITEM)
      ? "investigating-the-disturbance-searching-outside-the-house-box-inspecting-the-gland"
      : "investigating-the-disturbance-searching-outside-the-house-box";
    startTranscript(api, player, FREYGERD, PAGE, variant);
  }

  function inspectSmallGeyser(player) {
    const stage = stageOf(player);
    if (stage < STAGE_COMPONENTS || stage >= STAGE_MARKET) return;
    startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-small-geyser");
  }

  function inspectLargeGeyser(player) {
    const stage = stageOf(player);
    if (stage < STAGE_COMPONENTS || stage >= STAGE_MARKET) return;
    if (hasPolishingRockAnywhere(player)) {
      startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-inspecting-either-geyser-with-a-polishing-rock-in-the-player-s-inventory-or-bank");
      return;
    }
    if (rockGone(player)) {
      if (hasFishingRod(player)) {
        startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser-after-the-player-has-forgotten-their-memories-with-their-pet-rock-with-a-fishing-rod");
      } else if (hasPetRock(player)) {
        startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser-after-the-player-has-forgotten-their-memories-with-their-pet-rock-without-a-fishing-rod-inspecting-again-with-another-pet-rock");
      } else {
        startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser-after-the-player-has-forgotten-their-memories-with-their-pet-rock-without-a-fishing-rod-inspecting-again");
      }
      return;
    }
    if (!hasPetRock(player)) {
      startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser");
      return;
    }
    if (!peerForgot(player)) {
      if (!rockAttempted(player)) {
        player.setAttribute(ROCK_ATTEMPTED_ATTRIBUTE, true);
        startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser");
      } else {
        startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser-when-tried-again");
      }
      return;
    }
    if (hasFishingRod(player)) {
      startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser-after-the-player-has-forgotten-their-memories-with-their-pet-rock-with-a-fishing-rod");
      return;
    }
    startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-polishing-rock-large-geyser-after-the-player-has-forgotten-their-memories-with-their-pet-rock-without-a-fishing-rod");
  }

  function travelFremennikBoat(player, objectId) {
    const stage = stageOf(player);
    if (stage < STAGE_BOAT) return;
    if (objectId === ObjectIdentifiers.FREMENNIK_BOAT_8) {
      player.moveTo(RELLEKKA_PORT);
      return;
    }
    if (stage < STAGE_ISLAND) setStage(player, STAGE_ISLAND);
    player.moveTo(ISLAND_LANDING);
    player.getPacketSender().sendCameraShake(1, 10, 0, 25); // captured Island of Stone arrival
  }

  function enterIslandCave(player) {
    const stage = stageOf(player);
    if (stage < STAGE_ISLAND || stage >= STAGE_JORMUNGAND_DEAD) return;
    if (!puzzleOpen(player) && stage < STAGE_DOOR_OPEN) {
      startDoorPuzzle(player);
      return;
    }
    enterPrison(player);
  }

  function enterPrison(player) {
    if (stageOf(player) < STAGE_PRISON) setStage(player, STAGE_PRISON);
    player.moveTo(PRISON_ENTRY);
    if (!typhorDead(player)) {
      ensurePrisonScene(player);
    } else if (!jormungandDead(player)) {
      ensureJormungand(player);
    }
    playScene(player, BRUNDT_ISLAND_PRISON, "island-of-stone-brundt-again-after-unlocking-the-door-going-into-jormungand-s-prison");
  }

  // ==========================================================================
  // Waterbirth dungeon: pet-rock floor buttons, gates and door-supports
  //
  // These are shared world objects/NPCs: another player can hold the other floor
  // button, follow through an opened gate, or benefit from knocked-down supports.
  // Gate state is transient (Doors' 500-tick close plus button release); the
  // door-supports use the engine's canonical NPC death/respawn path (25 ticks).
  // ==========================================================================

  const openWaterbirthGates = new Map();

  function waterbirthButtonTiles(doorY) {
    return [
      new Location(WATERBIRTH_BUTTON_X, doorY, 0),
      new Location(WATERBIRTH_BUTTON_X, doorY + 2, 0),
    ];
  }

  function petRockOnTile(tile, owner = null) {
    const manager = ItemOnGroundManager;
    if (!manager?.getGroundItem) return false;
    const owners = new Set([null, owner?.getUsername?.()]);
    for (const player of World.getPlayers?.() ?? []) owners.add(player?.getUsername?.());
    for (const name of owners) {
      for (const itemId of [PET_ROCK_ITEM, PET_ROCK_ITEM_2]) {
        if (manager.getGroundItem(name, itemId, tile, null)) return true;
      }
    }
    return false;
  }

  function holdingWaterbirthButton(player, tile) {
    const at = player.getLocation();
    return at.getX() === tile.getX() && at.getY() === tile.getY() && at.getZ() === tile.getZ();
  }

  function playerOnTile(tile, except = null) {
    for (const other of World.getPlayers?.() ?? []) {
      if (!other || other === except || other.isRegistered?.() === false) continue;
      const at = other.getLocation?.();
      if (at && at.getX() === tile.getX() && at.getY() === tile.getY() && at.getZ() === tile.getZ()) return true;
    }
    return false;
  }

  function waterbirthButtonHeld(tile, except = null) {
    return petRockOnTile(tile) || playerOnTile(tile, except);
  }

  function waterbirthButtonsHeld(player, doorY) {
    const [first, second] = waterbirthButtonTiles(doorY);
    return (holdingWaterbirthButton(player, first) && waterbirthButtonHeld(second, player)) ||
      (holdingWaterbirthButton(player, second) && waterbirthButtonHeld(first, player));
  }

  function waterbirthPressureHeld(doorY) {
    const [first, second] = waterbirthButtonTiles(doorY);
    return waterbirthButtonHeld(first) && waterbirthButtonHeld(second);
  }

  function waterbirthGateAt(doorY) {
    const tile = new Location(2491, doorY, 0);
    return (ObjectManager.objectsAt?.(tile) ?? []).find((object) =>
      WATERBIRTH_GATE_DOORS.has(object.getId?.()));
  }

  function closeWaterbirthGate(doorId) {
    const state = openWaterbirthGates.get(doorId);
    if (!state) return;
    openWaterbirthGates.delete(doorId);
    const open = (ObjectManager.objectsAt?.(state.location) ?? []).find((object) =>
      object.getId?.() === WATERBIRTH_OPEN_GATE_ID);
    if (open) ObjectManager.deregister(open, true);
    ObjectManager.register(new GameObject(
      state.closedId,
      state.location,
      state.type,
      state.face,
      state.privateArea,
    ), true);
  }

  function pulseWaterbirthGate(doorId) {
    const state = openWaterbirthGates.get(doorId);
    if (!state) return;
    const task = new Task(1, `waterbirth-gate:${doorId}`);
    task.execute = () => {
      task.stop();
      const current = openWaterbirthGates.get(doorId);
      if (!current) return;
      current.ticks += 1;
      current.released = waterbirthPressureHeld(current.doorY) ? 0 : current.released + 1;
      if (current.ticks >= WATERBIRTH_GATE_CLOSE_TICKS ||
          current.released >= WATERBIRTH_BUTTON_RELEASE_TICKS) {
        closeWaterbirthGate(doorId);
        return;
      }
      pulseWaterbirthGate(doorId);
    };
    TaskManager.submit(task);
  }

  function openWaterbirthGate(player, doorId, object = null) {
    const doorY = WATERBIRTH_GATE_DOORS.get(doorId);
    if (doorY === undefined) return;
    if (!waterbirthButtonsHeld(player, doorY)) {
      player.sendMessage("The gate is held shut. Put your pet rock on one floor button and stand on the other.");
      return;
    }
    if (openWaterbirthGates.has(doorId)) return;
    const gate = object?.getId?.() === doorId ? object : waterbirthGateAt(doorY);
    if (!gate) return;
    const state = {
      doorId,
      doorY,
      closedId: doorId,
      location: gate.getLocation().clone(),
      type: gate.getType(),
      face: gate.getFace(),
      privateArea: gate.getPrivateArea?.() ?? null,
      ticks: 0,
      released: 0,
    };
    ObjectManager.deregister(gate, true);
    ObjectManager.register(new GameObject(
      WATERBIRTH_OPEN_GATE_ID,
      state.location,
      state.type,
      state.face,
      state.privateArea,
    ), true);
    openWaterbirthGates.set(doorId, state);
    player.sendMessage("The gate grinds open.");
    pulseWaterbirthGate(doorId);
  }

  function runeThrownaxeEquipped(player) {
    const weapon = player.getEquipment?.().get?.(Equipment.WEAPON_SLOT)?.getId?.();
    return weapon === ItemIdentifiers.RUNE_THROWNAXE || weapon === ItemIdentifiers.RUNE_THROWNAXE_2;
  }

  function isWaterbirthSupportDestroy(event) {
    const { player, npc } = event;
    if (!player || !npc) return false;
    if (!isExiled(player)) return false;
    const stage = stageOf(player);
    if (stage < STAGE_COMPONENTS || stage >= STAGE_MARKET) return false;
    const npcId = npc.getContentId?.(player) ?? event.npcId;
    if (npcId !== WATERBIRTH_SUPPORT_MIDDLE) return false;
    if (npc.getOwner?.() && npc.getOwner() !== player) return false;
    const action = event.definition?.getActions?.()?.[event.clickType - 1];
    if (String(action ?? "").toLowerCase() !== "destroy") return false;
    if (!runeThrownaxeEquipped(player) || player.getSpecialPercentage() < 10) return false;
    if (player.getLocation().getY() === WATERBIRTH_SUPPORT_TILE.getY()) return false;
    return player.getLocation().isWithinDistance(npc.getLocation(), WATERBIRTH_SUPPORT_RANGE);
  }

  /** Handler-side death step: remove the actual cache-map central doors and restore
   *  their original type/face with the support respawn. The door restore uses the cache
   *  support respawn (25 ticks); no recorded primary door timer exists, so this is an
   *  inference. */
  function openWaterbirthCentralDoors() {
    const removed = [];
    for (const tile of WATERBIRTH_CENTRAL_DOOR_TILES) {
      const object = MapObjects.get(WATERBIRTH_CENTRAL_DOOR_ID, tile, null)
        ?? (ObjectManager.objectsAt?.(tile) ?? []).find((entry) => entry.getId?.() === WATERBIRTH_CENTRAL_DOOR_ID);
      if (!object) continue;
      removed.push({ tile, type: object.getType(), face: object.getFace() });
      ObjectManager.deregister(object, true);
    }
    TaskManager.cancelTasks("waterbirth-central-doors");
    const task = new Task(WATERBIRTH_SUPPORT_RESPAWN_TICKS, "waterbirth-central-doors");
    task.execute = () => {
      task.stop();
      for (const { tile, type, face } of removed) {
        const present = MapObjects.get(WATERBIRTH_CENTRAL_DOOR_ID, tile, null)
          ?? (ObjectManager.objectsAt?.(tile) ?? []).find((entry) => entry.getId?.() === WATERBIRTH_CENTRAL_DOOR_ID);
        if (!present) ObjectManager.register(new GameObject(WATERBIRTH_CENTRAL_DOOR_ID, tile, type, face, null), true);
      }
    };
    TaskManager.submit(task);
  }

  function destroyWaterbirthSupport(event) {
    const { player } = event;
    if (!isWaterbirthSupportDestroy(event)) return;
    player.decrementSpecialPercentage(10);
    const nearby = World.getNpcsNear?.(WATERBIRTH_SUPPORT_TILE, 8, null) ?? [];
    for (const support of nearby) {
      const id = support?.getContentId?.(player) ?? support?.getId?.();
      if (WATERBIRTH_SUPPORT_IDS.has(id) && support?.isRegistered?.()) support.setHitpoints?.(0);
    }
    openWaterbirthCentralDoors();
    player.sendMessage("The rune thrownaxe bounces between the door-supports, knocking them all down.");
    event.handled = true;
  }

  /**
   * Wiki Exiles route: from the north/south path, use the Rune thrownaxe special on the
   * west/middle support (2253), not the door directly opposite. Real cache collision blocks
   * the ordinary projectile line, so this scoped route asks core for the quest-local ranged
   * clip exception; it must not perform the attack itself.
   */
  function routeWaterbirthSupport(event) {
    if (!isWaterbirthSupportDestroy(event)) return;
    event.range = WATERBIRTH_SUPPORT_RANGE;
    event.ignoreProjectileClip = true;
  }

  function summonFossegrimen(player) {
    if (!isExiled(player) || stageOf(player) < STAGE_COMPONENTS) return;
    if (!hasItem(player, V_SIGIL_ITEM) && !hasItem(player, V_SIGIL_E_ITEM)) return;
    startTranscript(api, player, FOSSEGRIMEN, PAGE, "making-v-s-shield-v-sigil-fossegrimen");
  }

  // ==========================================================================
  // Door combination puzzle (cache interface 622, buttons 8/15/21/27 + 33)
  // ==========================================================================

  function startDoorPuzzle(player) {
    if (!puzzleSolution(player)) newPuzzle(player);
    if (!puzzleRunes(player).length) player.setAttribute(PUZZLE_GUESS_ATTRIBUTE, "0,0,0,0");
    sendLockState(player);
    player.getPacketSender().sendSubInterface(LOCK_TARGET_UID, LOCK_GROUP, 1);
    player.sendMessage("The door bears a combination lock: four slots, six rune symbols.");
  }

  function newPuzzle(player) {
    const solution = [];
    for (let i = 0; i < PUZZLE_SLOTS; i++) solution.push(Math.floor(Math.random() * RUNE_NAMES.length));
    player.setAttribute(PUZZLE_SOLUTION_ATTRIBUTE, solution.join(","));
    player.setAttribute(PUZZLE_ATTEMPTS_ATTRIBUTE, 0);
    player.setAttribute(PUZZLE_GUESS_ATTRIBUTE, "0,0,0,0");
  }

  function puzzleSolution(player) {
    const raw = String(player.getAttribute(PUZZLE_SOLUTION_ATTRIBUTE) ?? "");
    const parts = raw.split(",").map((value) => Number(value));
    return parts.length === PUZZLE_SLOTS && parts.every((value) => Number.isInteger(value)) ? parts : null;
  }

  function puzzleRunes(player) {
    const parts = String(player.getAttribute(PUZZLE_GUESS_ATTRIBUTE) ?? "")
      .split(",").map((value) => Number(value));
    return parts.length === PUZZLE_SLOTS && parts.every((value) => Number.isInteger(value) && value >= 0 && value < RUNE_NAMES.length)
      ? parts : [0, 0, 0, 0];
  }

  function sendLockState(player) {
    const sender = player.getPacketSender();
    puzzleRunes(player).forEach((rune, slot) => sender.sendVarbit(LOCK_VARBIT_FIRST_SLOT + slot, rune + 1));
    sender.sendVarbit(LOCK_VARBIT_ROWS_DONE, 0);
  }

  function cycleLockRune(player, slot, backwards) {
    const runes = puzzleRunes(player);
    runes[slot] = (runes[slot] + (backwards ? -1 : 1) + RUNE_NAMES.length) % RUNE_NAMES.length;
    player.setAttribute(PUZZLE_GUESS_ATTRIBUTE, runes.join(","));
    player.getPacketSender().sendVarbit(LOCK_VARBIT_FIRST_SLOT + slot, runes[slot] + 1);
  }

  function handleLockButton(event) {
    const { player } = event;
    if (!player) return;
    if (event.buttonId === LOCK_CLOSE_BUTTON) {
      player.getPacketSender().closeInterface(LOCK_GROUP);
      return;
    }
    if (event.buttonId === LOCK_GO_BUTTON) {
      submitLockGuess(player);
      return;
    }
    const child = event.buttonId & 0xffff;
    const slot = LOCK_SLOT_BUTTONS.indexOf(child);
    if (slot !== -1) cycleLockRune(player, slot, event.action === 2);
  }

  function submitLockGuess(player) {
    const solution = puzzleSolution(player);
    if (!solution) return;
    const guess = puzzleRunes(player);
    const matches = guess.map((rune, slot) => rune === solution[slot]);
    const remaining = solution.filter((_, slot) => !matches[slot]);
    const feedback = guess.map((rune, slot) => {
      if (matches[slot]) return 1;
      const at = remaining.indexOf(rune);
      if (at === -1) return 0;
      remaining.splice(at, 1);
      return 2;
    });
    player.getPacketSender().sendVarbit(LOCK_VARBIT_ROWS_DONE, 1);
    feedback.forEach((value, slot) => {
      player.getPacketSender().sendVarbit(LOCK_VARBIT_FEEDBACK_FIRST + slot, value);
    });
    if (matches.every(Boolean)) {
      player.setAttribute(PUZZLE_OPEN_ATTRIBUTE, true);
      setStage(player, STAGE_DOOR_OPEN);
      player.getPacketSender().closeInterface(LOCK_GROUP);
      player.sendMessage("The runes lock into place and the door grinds open.");
      return;
    }
    const attempts = (Number(player.getAttribute(PUZZLE_ATTEMPTS_ATTRIBUTE)) || 0) + 1;
    if (attempts > PUZZLE_MAX_ATTEMPTS) {
      newPuzzle(player);
      sendLockState(player);
      player.sendMessage("The lock resets and the runes shuffle into a new combination.");
      return;
    }
    player.setAttribute(PUZZLE_ATTEMPTS_ATTRIBUTE, attempts);
    player.sendMessage("The lock rejects the combination. The runes show which are right.");
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function readLetter(event) {
    const { player } = event;
    if (letterRead(player)) {
      player.sendMessage("You have already read the letter.");
      return false;
    }
    player.setAttribute(LETTER_READ_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_LETTER_READ, 1);
    player.sendMessage("You read the unsealed letter.");
    player.sendMessage("For years we have waited and at last, our time to rise has come. Soon, we will bring terror to the Fremennik Province.");
    player.sendMessage("Go forth brothers and sisters. Go forth and wreak havoc amongst their people. Once they are distracted, we will tear down the walls that hold our king.");
    player.sendMessage("We will finally free the Jormungand! The time is ours. They will be unprepared. Their ban on magic shall be their downfall.");
    player.sendMessage("They have no champion to defend them this time. No V.");
    player.sendMessage("- Bakuna");
    return true;
  }

  function interactPetRock(event) {
    const { player } = event;
    if (!isExiled(player)) return false;
    startTranscript(api, player, ASKELADDEN, PAGE, "being-exiled-pet-rock");
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    if (!player) return;
    const objectId = resolvedObjectId(event);

    if ((itemId === PET_ROCK_ITEM || itemId === PET_ROCK_ITEM_2) && WATERBIRTH_BUTTON_IDS.has(objectId)) {
      if (!isExiled(player) || stageOf(player) < STAGE_COMPONENTS || stageOf(player) >= STAGE_MARKET) return;
      event.handled = true;
      const tile = event.object?.getLocation?.() ?? player.getLocation();
      if (!takeItem(player, itemId)) return;
      ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), tile);
      player.sendMessage("You place the pet rock on the floor button.");
      return;
    }
    if (itemId === PET_ROCK_ITEM && (LARGE_GEYSER_IDS.has(objectId) || event.objectId === LARGE_GEYSER_PARENT)) {
      event.handled = true;
      inspectLargeGeyser(player);
      return;
    }
    if (itemId === MOLTEN_GLASS_I_ITEM && objectId === ASTRAL_ALTAR) {
      if (stageOf(player) < STAGE_COMPONENTS || stageOf(player) >= STAGE_MARKET) return;
      event.handled = true;
      startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-lunar-glass-enchanting-the-molten-glass-i");
      return;
    }
    if (itemId === LUNAR_BAR_ITEM && isAnvil(event)) {
      if (stageOf(player) < STAGE_COMPONENTS || stageOf(player) >= STAGE_MARKET) return;
      event.handled = true;
      if (!hasItem(player, HAMMER_ITEM)) {
        player.sendMessage("You need a hammer to work the lunar bars.");
        return;
      }
      startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-v-sigil-anvil");
      return;
    }
    if (itemId === LUNAR_ORE_ITEM && isFurnace(event)) {
      if (stageOf(player) < STAGE_COMPONENTS || stageOf(player) >= STAGE_MARKET) return;
      event.handled = true;
      smeltLunarOre(player);
      return;
    }
  }

  function smeltLunarOre(player) {
    if (player.getSkillManager().getMaxLevel(Skill.SMITHING) < 60) {
      player.sendMessage("You need a Smithing level of 60 to smelt lunar ore.");
      return;
    }
    if (!takeItem(player, LUNAR_ORE_ITEM)) return;
    addItem(player, LUNAR_BAR_ITEM);
    player.getSkillManager().addExperiences(Skill.SMITHING, 13);
    player.sendMessage("You smelt the lunar ore into a lunar bar.");
  }

  function handleItemOnItem(event) {
    const { player } = event;
    if (!player) return;
    const pair = new Set([event.usedItemId, event.usedWithItemId]);
    const hasSigil = pair.has(V_SIGIL_E_ITEM) || pair.has(V_SIGIL_ITEM);
    const hasShield = [...FREMENNIK_SHIELD_ITEMS].some((id) => pair.has(id));
    if (!hasSigil || !hasShield) return;
    if (!hasItem(player, GLASSBLOWING_PIPE_ITEM)) {
      player.sendMessage("You need a glassblowing pipe to work the lunar glass.");
      return;
    }
    if (!hasItem(player, LUNAR_GLASS_ITEM) || !hasItem(player, POLISHING_ROCK_ITEM)) {
      player.sendMessage("You need the lunar glass and the polishing rock as well.");
      return;
    }
    if (!hasItem(player, V_SIGIL_E_ITEM)) {
      player.sendMessage("The V sigil must be enchanted first.");
      return;
    }
    event.handled = true;
    startTranscript(api, player, BABA_YAGA, PAGE, "making-v-s-shield-making-the-shield-using-the-items-on-each-other");
  }

  // ==========================================================================
  // NPC deaths
  // ==========================================================================

  function handleJormungandHit({ npc, hit }) {
    const player = hit?.getAttacker?.();
    if (!player?.isPlayer?.()) return;
    const npcId = npc?.getContentId?.(player) ?? npc?.getId?.();
    if (!JORMUNGAND_NPC_IDS.has(npcId)) return;
    if (stageOf(player) === STAGE_TYPHOR_DEAD) setStage(player, STAGE_JORMUNGAND_PHASE);
  }

  function handleNpcDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player) return;
    const npcId = event.npcId;

    if (npcId === BASILISK_YOUNGLING) {
      if (!inInvestigationStage(player)) return;
      player.setAttribute(YOUNGLING_KILLED_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_YOUNGLING_KILLED, 1);
      // The youngling's drop table already always drops the unsealed letter.
      syncTracked(player, "youngling", null);
      return;
    }

    if (MARKET_BASILISK_IDS.has(npcId) || MARKET_MONSTROUS_IDS.has(npcId)) {
      const stage = stageOf(player);
      if (stage < STAGE_MARKET || stage >= STAGE_MARKET_DONE) return;
      const points = MARKET_MONSTROUS_IDS.has(npcId) ? MONSTROUS_POINTS : BASILISK_POINTS;
      const total = setKillPercent(player, killPercent(player) + points);
      if (total >= BASILISK_TARGET) {
        clearMarketNpcs(player);
        setStage(player, STAGE_MARKET_DONE);
        player.sendMessage("You have held back the basilisk invasion. Brundt waves you towards the boat.");
      } else if (!marketWaveAlive(player)) {
        spawnMarketWave(player);
      }
      return;
    }

    if (TYPHOR_NPC_IDS.has(npcId)) {
      if (stageOf(player) < STAGE_PRISON) return;
      player.setAttribute(TYPHOR_DEAD_ATTRIBUTE, true);
      setStage(player, STAGE_TYPHOR_DEAD);
      ensureJormungand(player);
      playScene(player, THE_JORMUNGAND, "island-of-stone-the-jormungand");
      return;
    }

    if (JORMUNGAND_NPC_IDS.has(npcId)) {
      if (stageOf(player) < STAGE_PRISON) return;
      JORM_PHASE_STARTED.delete(player);
      player.setAttribute(JORMUNGAND_DEAD_ATTRIBUTE, true);
      syncTracked(player, "jormungand", null);
      setStage(player, STAGE_JORMUNGAND_DEAD);
      startTranscript(api, player, BRUNDT_ISLAND_PRISON, PAGE, "island-of-stone-after-killing-the-jormungand");
      return;
    }
  }

  function handleJormungandFinish(player) {
    setStage(player, STAGE_CELEBRATION);
    player.moveTo(LONGHALL_LANDING);
  }

  /** Captured 73799-73878: frame the longhall while Olaf sings the ballad. */
  function startCelebrationScene(player) {
    if (CELEBRATION_START.has(player)) return;
    CELEBRATION_START.add(player);
    tracked(player, "ballad-singer")?.forceChat?.("T'was on a haughty winter,");
    Scenes.camera(player, CELEBRATION_CAMERA[0], CELEBRATION_CAMERA[1], { rate: 0, rate2: 100 });
    Scenes.later(player, 3, () => Scenes.camera(player, CELEBRATION_CAMERA_TWO[0], CELEBRATION_CAMERA_TWO[1], { rate: 1, rate2: 50 }));
    Scenes.later(player, 18, () => player.getPacketSender().sendCameraReset());
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I investigated the disturbance, was exiled and remade V's Shield.</str>",
        "<str>I fought beside Brundt at the market and on the Island of Stone,</str>",
        "<str>where I defeated Typhor and the Jormungand.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_CELEBRATION) {
      return [
        "<str>The Jormungand is defeated and the End of Things averted.</str>",
        "I should celebrate with <col=800000>Brundt</col> in the Rellekka longhall.",
      ];
    }
    if (stage >= STAGE_JORMUNGAND_DEAD) {
      return [
        "<str>The Jormungand has been defeated in his prison.</str>",
        "I should speak to <col=800000>Brundt</col> and return to Rellekka.",
      ];
    }
    if (stage >= STAGE_TYPHOR_DEAD) {
      return [
        "<str>Typhor has fallen. The Jormungand is loose in his prison.</str>",
        "Defeat <col=800000>the Jormungand</col>.",
      ];
    }
    if (stage >= STAGE_PRISON) {
      return [
        "<str>I entered Jormungand's Prison with Brundt.</str>",
        "Defeat <col=800000>Typhor</col> and then <col=800000>the Jormungand</col>.",
      ];
    }
    if (stage >= STAGE_DOOR_OPEN) {
      return [
        "<str>I solved the door's combination lock.</str>",
        "Enter the <col=800000>cave</col> and stop the basilisks.",
      ];
    }
    if (stage >= STAGE_ISLAND) {
      return [
        "<str>I reached the Island of Stone with Brundt.</str>",
        "Solve the <col=800000>combination lock</col> on the cave door.",
      ];
    }
    if (stage >= STAGE_INVASION && stage < STAGE_BOAT) {
      return [
        "<str>Basilisks are attacking Rellekka's market.</str>",
        "Fight beside <col=800000>Brundt</col> until the invasion is broken.",
      ];
    }
    if (stage >= STAGE_BOAT) {
      return [
        "<str>The basilisk invasion is broken; the council trusts me again.</str>",
        "Board the <col=800000>Fremennik boat</col> at the Rellekka dock and sail",
        "to the Island of Stone.",
      ];
    }
    if (stage === STAGE_MARKET_DONE) {
      return [
        "<str>I survived the basilisk invasion of the market.</str>",
        "Speak to <col=800000>Brundt</col> in the longhall.",
      ];
    }
    if (stage >= STAGE_MARKET) {
      return [
        "<str>The basilisks are invading Rellekka's market.</str>",
        "Wield <col=800000>V's shield</col> and fight beside Brundt until the",
        "invasion is broken.",
      ];
    }
    if (stage >= STAGE_SHIELD_GIVEN) {
      return [
        "<str>Brundt has V's Shield; he needs two kegs of beer for courage.</str>",
        "Bring him two <col=800000>kegs of beer</col>.",
      ];
    }
    if (stage >= STAGE_SHIELD_MADE) {
      return [
        "<str>I remade V's Shield from its four components.</str>",
        "Give it to <col=800000>Brundt</col> south-east of Rellekka.",
      ];
    }
    if (stage >= STAGE_COMPONENTS) {
      return [
        "<str>I must remake V's Shield to win back the council's trust.</str>",
        "Gather a <col=800000>Fremennik shield</col> (Bardur, Waterbirth Dungeon),",
        "<col=800000>lunar glass</col> (Baba Yaga, astral altar), a",
        "<col=800000>polishing rock</col> (Peer the Seer, Mountain Camp geyser)",
        "and an enchanted <col=800000>V sigil</col> (anvil, Fossegrimen).",
      ];
    }
    if (stage >= STAGE_EXILED) {
      return [
        "<str>I have been exiled from the Fremennik Province.</str>",
        "Meet <col=800000>Brundt</col> south-east of Rellekka.",
      ];
    }
    if (stage >= STAGE_REPORTED) {
      return [
        "<str>Freygerd sent the evidence ahead to Brundt.</str>",
        "Report to the <col=800000>Chieftain</col> in the longhall.",
      ];
    }
    if (stage >= STAGE_INVESTIGATING) {
      if (younglingKilled(player)) {
        return [
          "<str>I killed the basilisk youngling and found its letter.</str>",
          "Read the <col=800000>unsealed letter</col>, then take the evidence to",
          "<col=800000>Freygerd</col>.",
        ];
      }
      return [
        "<str>Something was seen outside Freygerd and Reeso's house.</str>",
        "Search the <col=800000>boxes</col>, the <col=800000>rockslide</col> and the",
        "<col=800000>sand pit</col> for clues.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Brundt asked me to look into a disturbance by the sand pit.</str>",
        "Speak to <col=800000>Freygerd</col> north of Rellekka.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Brundt the Chieftain</col>",
      "in the Rellekka longhall.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SLAYER, 50000);
    skills.addExperiences(Skill.CRAFTING, 50000);
    skills.addExperiences(Skill.RUNECRAFTING, 30000);
    if (!hasAnyItemAnywhere(player, VS_SHIELD_ITEMS)) {
      player.getInventory().forceAdd(player, new Item(VS_SHIELD_ITEM, 1));
    }
    player.getPacketSender().sendVarbit(VARBIT_BALLAD, 1);
    player.getPacketSender().sendVarbit(VARBIT_HELM_UNLOCK, 1);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(LETTER_READ_ATTRIBUTE);
  api.persistAttribute(FREYGERD_TOLD_ATTRIBUTE);
  api.persistAttribute(YOUNGLING_FOUND_ATTRIBUTE);
  api.persistAttribute(YOUNGLING_KILLED_ATTRIBUTE);
  api.persistAttribute(SAND_SEARCHED_ATTRIBUTE);
  api.persistAttribute(SHIELD_INFO_ATTRIBUTE);
  api.persistAttribute(GLASS_INFO_ATTRIBUTE);
  api.persistAttribute(ROCK_INFO_ATTRIBUTE);
  api.persistAttribute(SIGIL_INFO_ATTRIBUTE);
  api.persistAttribute(BARDUR_GOT_ATTRIBUTE);
  api.persistAttribute(ROCK_ATTEMPTED_ATTRIBUTE);
  api.persistAttribute(PEER_FORGOT_ATTRIBUTE);
  api.persistAttribute(ROCK_GONE_ATTRIBUTE);
  api.persistAttribute(SHIELD_GIVEN_ATTRIBUTE);
  api.persistAttribute(BASILISK_KILLS_ATTRIBUTE);
  api.persistAttribute(MARKET_STARTED_ATTRIBUTE);
  api.persistAttribute(TYPHOR_DEAD_ATTRIBUTE);
  api.persistAttribute(JORMUNGAND_DEAD_ATTRIBUTE);
  api.persistAttribute(PUZZLE_OPEN_ATTRIBUTE);
  api.persistAttribute(PUZZLE_SOLUTION_ATTRIBUTE);
  api.persistAttribute(PUZZLE_ATTEMPTS_ATTRIBUTE);
  api.persistAttribute(PUZZLE_GUESS_ATTRIBUTE);
  api.persistAttribute(SCHEMA_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "the_fremennik_exiles",
    name: "The Fremennik Exiles",
    varpId: VARP_FREMENNIK_EXILES,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.SLAYER.getIndex(), amount: 50000, label: "Slayer" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 50000, label: "Crafting" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 30000, label: "Runecraft" },
    ],
    scrollItemId: VS_SHIELD_ITEM,
    rewardItemLabel: "V's shield",
    otherRewards: [
      "Access to the Island of Stone",
      "Basilisk Knights as a Slayer task",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Brundt the Chieftain", { "Talk-to": talksToMyQuest });
  api.onNpcInteraction("Baba Yaga", { "Talk-to": talksToMyQuest });
  api.onNpcInteraction("Peer the Seer", { "Talk-to": talksToMyQuest });
  api.onNpcInteraction("Askeladden", { "Talk-to": talksToMyQuest });
  api.onNpcInteraction("Sailor", { "Talk-to": talksToMyQuest });
  api.onNpcInteraction("Fossegrimen", { "Talk-to": talksToMyQuest });
  api.onNpcInteraction("Door-support", { Destroy: destroyWaterbirthSupport });
  api.onNpcRoute(routeWaterbirthSupport);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Unsealed letter", { Read: readLetter });
  api.onItemAction("Pet rock", { Interact: interactPetRock });
  api.onInterfaceActionButton([
    ...LOCK_SLOT_BUTTONS.map((child) => (LOCK_GROUP << 16) | child),
    LOCK_GO_BUTTON,
    LOCK_CLOSE_BUTTON,
  ], handleLockButton);
  api.onNpcDeath(handleNpcDeath);
  api.onNpcHitModify(handleJormungandHit);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
};
