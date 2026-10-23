/**
 * The Blood Moon Rises (members, Myreque #6). Dialogue and action ids are
 * taken from the current OSRS Wiki transcript export in npc-dialogues.json;
 * quest state uses the cache's myq6 varbit (15464 in varp 5618).
 */
module.exports = function registerTheBloodMoonRises(api) {
  const { Animation, Boundary, Equipment, Graphic, HitDamage, HitMask, Item, ItemIdentifiers, Location, NpcIdentifiers, ObjectDefinition, ObjectIdentifiers, PrayerHandler, PrivateArea, Skill, World } = api.core;
  const { registerQuest, loadTranscripts, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const { handleDrakanDodgeRoll } = require("../bmr/DrakanDodgeRoll.TheBloodMoonRises");
  const refinery = require("../bmr/Refinery.TheBloodMoonRises")(api, stage);
  require("../bmr/FinalCastleDeposit.TheBloodMoonRises")(api);
  const PAGE = "The Blood Moon Rises";
  const Scenes = createQuestScenes(api);
  const START_HOOK = "quest:the-blood-moon-rises:start";
  const START_DIALOGUE_COMPLETE = "the-blood-moon-rises:start-dialogue-complete";
  const HIDEOUT_CUTSCENE_STARTED = "the-blood-moon-rises:hideout-cutscene-started";
  const TOME_ID = ItemIdentifiers.TOME_OF_EXPERIENCE_3;
  const PREP_ATTRIBUTE = "quest.the_blood_moon_rises.preparations";
  // Quest Helper's actual sub-progress varbits (primary-captured, not hints).
  const IVAN_GIVEN_PICKAXE_VARBIT = 15469;
  const IVAN_HIDEOUT_PROGRESS_VARBIT = 15473;
  const VELIAF_HIDEOUT_PROGRESS_VARBIT = 15474;
  const SANGVESTI_SUPPLY_WARNING_VARBIT = 15481;
  const IN_VAMPYRIUM_VARBIT = 15482;
  const THRONE_PUZZLE_ATTRIBUTE = "quest.the_blood_moon_rises.castle-throne-puzzle";
  const THRONE_BUST_VARBITS = Object.freeze([15539, 15540, 15541, 15542]);
  const BASIN_PUZZLE_ATTRIBUTE = "quest.the_blood_moon_rises.castle-basin-puzzle";
  const SOLID_KEY_ATTRIBUTE = "quest.the_blood_moon_rises.castle-solid-key-puzzle";
  const CLOCK_ATTRIBUTE = "quest.the_blood_moon_rises.castle-clocks";
  const GALLERY_CHEST_ATTRIBUTE = "quest.the_blood_moon_rises.gallery-chest";
  const REFINER_ATTRIBUTE = "quest.the_blood_moon_rises.castle-refiner";
  const CASTLE_LAB_NOTES = ItemIdentifiers.LAB_NOTES;
  const HUNT_ATTRIBUTE = "quest.the_blood_moon_rises.blood-hunt";
  const HUNT_FOOD_SHOP_DOOR_VARBIT = 15583;
  const HUNT_DOOR_VARBITS = Object.freeze({
    viturManorDoor: 15580,
    foodShopDoorUnlocked: HUNT_FOOD_SHOP_DOOR_VARBIT,
    chainCut: 15586,
    pubDoorUnlocked: 15571,
    shadumDoorUnlocked: 15578,
    bankDoorUnlocked: 15575,
    innerBankDoorUnlocked: 15576,
    trapdoorUnlocked: 15585,
    jovkaiDoorUnlocked: 15569,
    fancyHouseDoorUnlocked: 15588,
    chapelBackDoorUnlocked: 15591,
    chapelPuzzleSolved: 15596,
  });
  const HUNT_CRANK_PROGRESS_VARBIT = 15594;
  const HUNT_CRANK_PROGRESS_CACHED_VARBIT = 15595;
  const BLOOD_HUNT_SCENE_ARRIVAL = Object.freeze({ x: 2576, y: 7838, z: 0 });
  const BLOOD_HUNT_PARTY_ARRIVAL = Object.freeze({ x: 2633, y: 7827, z: 0 });
  const BLOOD_HUNT_PARTY = Object.freeze([
    ["ivan", NpcIdentifiers.IVAN_STROM_13, 2635, 7825],
    ["veliaf", NpcIdentifiers.VELIAF_HURTZ_15, 2633, 7828],
    ["vanescula", NpcIdentifiers.VANESCULA_DRAKAN_10, 2633, 7830],
    ["safalaan", NpcIdentifiers.SAFALAAN_HALLOW_12, 2635, 7828],
  ]);
  const BLOOD_HUNT_ACTORS = new Map();
  const BLOOD_HUNT_PURSUER_ACTORS = new WeakMap();
  const BLOOD_HUNT_PURSUER_OWNERS = new WeakMap();
  let bloodHuntPursuitArea;
  const BLOOD_HUNT_PURSUER_ID = NpcIdentifiers.LOWERNIEL_DRAKAN_21;
  const BLOOD_HUNT_CRANK_HEADBAR_ID = 16228;
  const HIDEOUT_IVAN_VARBIT = 15467;
  const HIDEOUT_SHRINE_INSPECTED = "quest.the_blood_moon_rises.hideout-shrine-inspected";
  const HIDEOUT_DEFENSE_COMPLETE = "quest.the_blood_moon_rises.hideout-defense-complete";
  const SLEPE_STORY_ATTRIBUTE = "quest.the_blood_moon_rises.slepe-story";
  const SLEPE_NATIVE_STAGE_ATTRIBUTE = "the-blood-moon-rises:slepe-native-stage";
  const CASTLE_SHRINE_ATTRIBUTE = "quest.the_blood_moon_rises.castle-shrine-prayed";
  const CASTLE_SHRINE_VARBIT = 15470;
  const CASTLE_DUNGEON_STAIRS = Object.freeze({ id: 61208, x: 3147, y: 7585, z: 0 });
  const CASTLE_LOBBY_LANDING = Object.freeze({ x: 3150, y: 7717, z: 0 });
  const CASTLE_ROOM_ATTRIBUTE = "quest.the_blood_moon_rises.castle-room";
  const CASTLE_FLOOR_ATTRIBUTE = "quest.the_blood_moon_rises.castle-floor";
  const CASTLE_FACING_ATTRIBUTE = "quest.the_blood_moon_rises.castle-facing";
  const CASTLE_WORLD_MAP_FLOOR_VARBIT = 15489;
  const CASTLE_LAST_ROOM_VARBIT = 15499;
  const CASTLE_LAST_FLOOR_VARBIT = 15549;
  const CASTLE_LAST_FACING_VARBIT = 15500;
  const CASTLE_VENATOR_HEAD_VARBIT = 15523;
  const CASTLE_GIBBOUS_DISPLAY_CASE_VARBIT = 15563;
  const CASTLE_GIBBOUS_PORTAL_VARBIT = 15532;
  const CASTLE_CHAPEL_PORTAL_VARBIT = 15533;
  const CASTLE_GROUND_FLOOR = 1;
  const CASTLE_OUTER_LIBRARY_PORTAL_VARBIT = 15531;
  const CASTLE_VANESCULA_EMBLEM_VARBIT = 15504;
  const CASTLE_RANIS_PARLOUR_EMBLEM_VARBIT = 15505;
  const CASTLE_RANIS_EMBLEM_VARBIT = 15506;
  const CASTLE_NORTH_CHAPEL_EMBLEM_VARBIT = 15502;
  const CASTLE_GALLERY_EMBLEM_VARBIT = 15501;
  const CASTLE_THIRD_EMBLEM_RECEPTACLE_VARBIT = 15507;
  const CASTLE_THIRD_EMBLEM_FOUND_VARBIT = 15567;
  const CASTLE_THIRD_EMBLEM_RECEPTACLE = Object.freeze({ id: 61637, x: 2486, y: 7421, z: 0 });
  const CASTLE_VANESCULA_WALL_VARBIT = 15511;
  const CASTLE_VANESCULA_WALL = Object.freeze({ id: 61611, crackedId: 61613, holeId: 61614, x: 2492, y: 7364, z: 0 });
  const CASTLE_VANESCULA_STUDY_EMBLEM_VARBIT = 15503;
  const CASTLE_VANESCULA_STUDY_RECEPTACLE = Object.freeze({ id: 61633, x: 2476, y: 7367, z: 0 });
  const CASTLE_VANESCULA_EMBLEM_RECEPTACLE = Object.freeze({ id: 61634, x: 2469, y: 7408, z: 0 });
  const CASTLE_RANIS_EMBLEM_RECEPTACLE = Object.freeze({ id: 61636, x: 2476, y: 7410, z: 0 });
  const CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE = Object.freeze({ id: 61635, x: 2486, y: 7404, z: 0 });
  const CASTLE_NORTH_CHAPEL_EMBLEM_RECEPTACLE = Object.freeze({ id: 61632, x: 2371, y: 7410, z: 0 });
  const CASTLE_GALLERY_EMBLEM_RECEPTACLE = Object.freeze({ id: 61631, x: 2370, y: 7383, z: 0 });
  const CASTLE_OUTER_LIBRARY_LEVER = Object.freeze({ id: 61774, x: 2473, y: 7421, z: 0 });
  const CASTLE_OUTER_LIBRARY_PORTAL = Object.freeze({ id: 61768, x: 2473, y: 7419, z: 0,
    destination: [2361, 7382, 0] });
  const CASTLE_CHAPEL_LEVER = Object.freeze({ id: 61778, x: 2393, y: 7372, z: 0 });
  const CASTLE_NATIVE_STAGE_ATTRIBUTE = "quest.the_blood_moon_rises.castle-native-stage";
  const CASTLE_STORY_ATTRIBUTE = "quest.the_blood_moon_rises.castle-story";
  const CASTLE_UNLOCKED_PASSAGES_ATTRIBUTE = "quest.the_blood_moon_rises.castle-unlocked-passages";
  const KITCHEN_SANGUIDAE = Object.freeze([
    { key: "kitchen-sanguidae-west", tile: [2312, 7412] },
    { key: "kitchen-sanguidae-north", tile: [2311, 7408] },
    { key: "kitchen-sanguidae-south", tile: [2309, 7414] },
  ]);
  const CASTLE_BOOK_PUZZLE_ATTRIBUTE = "quest.the_blood_moon_rises.castle-book-puzzle";
  const CASTLE_TRANSITION_PENDING_ATTRIBUTE = "quest.the_blood_moon_rises.castle-transition-pending";
  const CASTLE_BOOK_VARBITS = Object.freeze([15550, 15551, 15552, 15553, 15554, 15555, 15556, 15557]);
  const CASTLE_GILDED_BOOKCASE_VARBIT = 15525;
  // 61698 Empty mount -> 61700 Mounted shield (Search) via varbit 15526.
  const CASTLE_SHIELD_MOUNT_VARBIT = 15526;
  const CASTLE_BOOKCASE_INTERFACE = 962;
  const CASTLE_BOOK_ITEMS = Object.freeze({ gilded: 33767, vampyre: 33768, fullMoonKey: ItemIdentifiers.FULL_MOON_KEY,
    mysteryJerky: ItemIdentifiers.MYSTERIOUS_JERKY,
    halfMoonKey: ItemIdentifiers.HALF_MOON_KEY, crescentMoonKey: ItemIdentifiers.CRESCENT_MOON_KEY,
    newMoonKey: ItemIdentifiers.NEW_MOON_KEY, gibbousMoonKey: ItemIdentifiers.GIBBOUS_MOON_KEY });
  const CASTLE_KEY_ITEMS = Object.freeze({
    plug: ItemIdentifiers.SINK_PLUG,
    pipe: ItemIdentifiers.BROKEN_PIPE,
    knife: ItemIdentifiers.SHARP_KNIFE,
    tongs: ItemIdentifiers.TONGS,
    needle: ItemIdentifiers.SYRINGE_NEEDLE,
    barrel: ItemIdentifiers.SYRINGE_BARREL,
    plunger: ItemIdentifiers.SYRINGE_PLUNGER,
    emptySyringe: ItemIdentifiers.EMPTY_SYRINGE,
    fullSyringe: ItemIdentifiers.FULL_SYRINGE,
    stomach: ItemIdentifiers.VENATOR_STOMACH,
    leftCrest: ItemIdentifiers.LEFT_CREST_HALF,
    rightCrest: ItemIdentifiers.RIGHT_CREST_HALF,
    fullCrest: ItemIdentifiers.FULL_CREST,
    sword: ItemIdentifiers.SWORD,
    spear: ItemIdentifiers.SPEAR_2,
    axe: ItemIdentifiers.BATTLEAXE,
    mace: ItemIdentifiers.MACE_3,
    congealedBlood: ItemIdentifiers.JAR_OF_CONGEALED_BLOOD,
    chunkyPotion1: ItemIdentifiers.FOUL_CHUNKY_POTION_1_,
    chunkyPotion2: ItemIdentifiers.FOUL_CHUNKY_POTION_2_,
    chunkyPotion3: ItemIdentifiers.FOUL_CHUNKY_POTION_3_,
    chunkyPotion4: ItemIdentifiers.FOUL_CHUNKY_POTION_4_,
  });
  // Visible Castle Drakan loc ids from the current client cache gamevals.
  const CASTLE_KEY_LOC_IDS = Object.freeze({
    searchableCrate: 61751,
    kitchenSink: [61719, 61720, 61721],
    larderSink: [61722, 61723, 61724, 61725],
    larderCabinet: 61726,
    kitchenCorpse: [61727, 61728, 61729],
    kitchenChest: [61683, 61684],
    armouryChest: [61685, 61686],
    weaponCase: 61741,
    statue1: 61742,
    statue2: 61743,
    statue3: 61744,
    statue4: 61745,
    unarmedStatue: 61746,
    swordStatue: 61747,
    maceStatue: 61749,
    axeStatue: 61750,
    studyFireplace: [61665, 61666, 61667],
  });
  const CASTLE_KEY_OBJECTS = Object.freeze({
    crate: new Set([CASTLE_KEY_LOC_IDS.searchableCrate]),
    kitchenSink: new Set(CASTLE_KEY_LOC_IDS.kitchenSink),
    larderSink: new Set(CASTLE_KEY_LOC_IDS.larderSink),
    larderCabinet: new Set([CASTLE_KEY_LOC_IDS.larderCabinet]),
    corpse: new Set(CASTLE_KEY_LOC_IDS.kitchenCorpse),
    kitchenChest: new Set(CASTLE_KEY_LOC_IDS.kitchenChest),
    weaponCase: new Set([CASTLE_KEY_LOC_IDS.weaponCase]),
    armouryChest: new Set(CASTLE_KEY_LOC_IDS.armouryChest),
    statues: new Set([CASTLE_KEY_LOC_IDS.statue1, CASTLE_KEY_LOC_IDS.statue2,
      CASTLE_KEY_LOC_IDS.statue3, CASTLE_KEY_LOC_IDS.statue4, CASTLE_KEY_LOC_IDS.unarmedStatue,
      CASTLE_KEY_LOC_IDS.swordStatue, CASTLE_KEY_LOC_IDS.maceStatue, CASTLE_KEY_LOC_IDS.axeStatue]),
    studyFireplace: new Set(CASTLE_KEY_LOC_IDS.studyFireplace),
  });
  const CASTLE_KEY_VARBITS = Object.freeze({ sinkEmptied: 15536, larderSink: 15537,
    corpseOpened: 15538, kitchenChest: 15518, fireplace: 15535,
    statue1: 15545, statue2: 15546, statue3: 15547, statue4: 15548 });
  const CASTLE_GILDED_BOOKCASE_IDS = new Set([61692, 61693, 61694, 61695]);
  const CASTLE_LIBRARY = Object.freeze({ z: 0, minX: 2448, maxX: 2461, minY: 7384, maxY: 7398,
    gildedBookcase: [2455, 7395], vampyreBookcase: [2458, 7388],
    westernBookcase: [2451, 7391], passage: [2455, 7386], secretKey: [2433, 7416] });
  const CASTLE_ACTORS = new Map();
  const CASTLE_ACTOR_OWNERS = new Map();
  // Cache gamevals from client/runelite/api/gameval/NpcID.ts. These Castle
  // variants have quest actions that are absent from the generic NPC IDs.
  const CASTLE_NPC = Object.freeze({
    IVAN_LIBRARY: 15845,
    IVAN_ENTRY_HALL: 15846,
    VELIAF_GALLERY: 15867,
    VELIAF_FOLLOWER: 15877,
    VELIAF_ENTRY_HALL: 15869,
    SAFALAAN_PRISON: 15888,
    VANESCULA_PRISON: 15903,
    VANESCULA_CASTLE: 15907,
    LOWERNIEL_CUTSCENE_NO_WING: 15924,
    SANGUIDAE: 16223,
    CROW: 16226,
    VENATOR: 16213,
    VENATOR_5: 16217,
    VENATOR_GIBBOUS: 16216,
  });
  const CASTLE_ROOM = Object.freeze({
    LOBBY: 1, DINING: 2, THRONE: 3, SOUTH_OF_THRONE: 4, EAST_STAIR_GROUND: 5, STORAGE: 6,
    STUDY: 7, WEST_DINING: 8, THRONE_STORAGE: 9, LARDER: 10, KITCHEN: 11, GALLERY_HALL: 12,
    GALLERY: 13, CHAPEL_LIBRARY: 14, WEST_CHAPEL: 15, BOTTLE_ROOM: 16, NORTH_CHAPEL: 17,
    UPPER_SOUTH_HALL: 18, ABOVE_STUDY: 19, BEDROOM: 20, ORNATE_KNIFE: 21,
    EAST_STAIR_FIRST: 22, VANESCULA_STUDY: 23, VANESCULA_CHAMBER: 24, EMBLEM_ROOM: 25,
    RANIS_PARLOUR: 26, CRESCENT_ROOM: 27, EXPLOSIVE_ROOM: 28, IVAN_ROOM: 29,
    SERVANTS_QUARTERS: 30, EXPLOSIVE_HALL: 31, SECRET_ROOM: 32, SMALL_HALL: 33,
    NORTH_LOBBY_HALL: 34, VANESCULA_HALL: 35, RANIS_HALL: 36, VENATOR_ROOM: 37,
    DISPLAY_ROOM: 38, VENATOR_PUZZLE: 39, SOLID_KEY_ROOM: 40, SOLID_DOOR_STORAGE: 41,
    LABORATORY: 42, STOCKPILE_STORAGE: 43, VENATOR_LIBRARY: 44, SOLID_DOOR_HALL: 45,
    GUEST_STORAGE: 46, BASEMENT_HALL: 48, BASEMENT_VENATOR: 49, BASEMENT_STORAGE: 50,
    BASEMENT_PRISON: 51,
  });
  // Cache gameval loc ids from client/runelite/api/gameval/ObjectID.ts.
  const CASTLE_DOOR_IDS = Object.freeze({ DOOR: 61572, DOOR_M: 61573, DOOR_ALT: 61576, DOOR_ALT_M: 61577,
    NEW: 61584, NEW_M: 61585, HALF: 61586, HALF_M: 61587, GIBBOUS: 61588, GIBBOUS_M: 61589,
    FULL: 61590, FULL_M: 61591, CRESCENT: 61592, CRESCENT_M: 61593,
    SOLID: 61574, SOLID_M: 61575, GILDED: 61626, GILDED_M: 61627,
    STAIRS_UP: 61599, STAIRS_UP_NORUG: 61600, STAIRS_DOWN: 61606, STAIRS_DOWN_INVISIBLE: 61608,
    DISPLAY_STAIRS_DOWN: 61609,
    SPIRAL_UP: 61602, SPIRAL_DOWN: 61604, GUEST_PORTAL_IN: 61771,
    CHAPEL_PORTAL_IN: 61773, CHAPEL_PORTAL_OUT: 61772, PUZZLE_LIBRARY: 61625, IVAN_PASSAGE: 61615 });
  const CASTLE_EMBLEM_IDS = Object.freeze([ItemIdentifiers.DRAKAN_EMBLEM, ItemIdentifiers.DRAKAN_EMBLEM_2,
    ItemIdentifiers.DRAKAN_EMBLEM_3]);
  // The Castle's Enter doors link distinct room endpoints. Quest Helper's
  // CastleDrakanRoomNetwork records the paired cache locs; the arrival tiles
  // below are adjacent, collision-clear tiles on the destination side.
  // shortcut: exact OSRS arrival tiles are not published, so use the verified
  // paired door endpoints and cache-walkable adjacent tiles until captured.
  const CASTLE_DOOR_TRANSITIONS = Object.freeze([
    { id: 61577, x: 2327, y: 7360, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.DINING, landing: [2342, 7372] },
    { id: 61576, x: 2328, y: 7360, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.DINING, landing: [2342, 7372] },
    { id: 61573, x: 2342, y: 7373, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.LOBBY,
      facing: 0, landing: [2328, 7361] },
    { id: 61572, x: 2341, y: 7373, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.LOBBY, landing: [2327, 7362] },
    { id: 61572, x: 2358, y: 7366, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.THRONE, landing: [2305, 7391] },
    { id: 61572, x: 2304, y: 7391, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.DINING, landing: [2357, 7366] },
    { id: 61573, x: 2304, y: 7392, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.DINING,
      facing: 6, landing: [2357, 7366] },
    // The half-moon door pair joins the dining room and the western dining hall.
    // shortcut: QH records the paired door tiles, not the OSRS teleport landing; these
    // adjacent destinations are collision-checked and can be refined from a live capture.
    { id: CASTLE_DOOR_IDS.HALF, x: 2336, y: 7370, z: 0, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.WEST_DINING,
      fromFloor: 1, toFloor: 1, key: CASTLE_BOOK_ITEMS.halfMoonKey, keyName: "half moon key", landing: [2338, 7395] },
    { id: CASTLE_DOOR_IDS.HALF_M, x: 2339, y: 7395, z: 0, from: CASTLE_ROOM.WEST_DINING, to: CASTLE_ROOM.DINING,
      fromFloor: 1, toFloor: 1, key: CASTLE_BOOK_ITEMS.halfMoonKey, keyName: "half moon key", landing: [2337, 7370] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2323, y: 7395, z: 0, from: CASTLE_ROOM.WEST_DINING, to: CASTLE_ROOM.STORAGE,
      fromFloor: 1, toFloor: 1, landing: [2347, 7383] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2348, y: 7383, z: 0, from: CASTLE_ROOM.STORAGE, to: CASTLE_ROOM.WEST_DINING,
      fromFloor: 1, toFloor: 1, landing: [2324, 7395] },
    { id: CASTLE_DOOR_IDS.SPIRAL_UP, x: 2339, y: 7383, z: 0, from: CASTLE_ROOM.STORAGE, to: CASTLE_ROOM.EXPLOSIVE_ROOM,
      fromFloor: 1, toFloor: 1, action: "Climb-up", landing: [2437, 7386] },
    { id: CASTLE_DOOR_IDS.SPIRAL_DOWN, x: 2435, y: 7386, z: 0, from: CASTLE_ROOM.EXPLOSIVE_ROOM, to: CASTLE_ROOM.STORAGE,
      fromFloor: 1, toFloor: 1, action: "Climb-down", landing: [2341, 7384] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2439, y: 7384, z: 0, from: CASTLE_ROOM.EXPLOSIVE_ROOM, to: CASTLE_ROOM.EMBLEM_ROOM,
      fromFloor: 1, toFloor: 1, landing: [2455, 7380] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2455, y: 7381, z: 0, from: CASTLE_ROOM.EMBLEM_ROOM, to: CASTLE_ROOM.EXPLOSIVE_ROOM,
      fromFloor: 1, toFloor: 1, landing: [2439, 7386] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2444, y: 7386, z: 0, from: CASTLE_ROOM.EXPLOSIVE_ROOM, to: CASTLE_ROOM.EXPLOSIVE_HALL,
      fromFloor: 1, toFloor: 1, landing: [2468, 7395] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2467, y: 7395, z: 0, from: CASTLE_ROOM.EXPLOSIVE_HALL, to: CASTLE_ROOM.EXPLOSIVE_ROOM,
      fromFloor: 1, toFloor: 1, landing: [2443, 7386] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2474, y: 7398, z: 0, from: CASTLE_ROOM.EXPLOSIVE_HALL, to: CASTLE_ROOM.LOBBY,
      fromFloor: 1, toFloor: 2, landing: [2314, 7361, 1] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2315, y: 7360, z: 1, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.EXPLOSIVE_HALL,
      fromFloor: 2, toFloor: 1, landing: [2475, 7397] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2327, y: 7382, z: 1, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.NORTH_LOBBY_HALL,
      fromFloor: 2, toFloor: 2, landing: [2469, 7418, 0] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2457, y: 7417, z: 0, from: CASTLE_ROOM.NORTH_LOBBY_HALL, to: CASTLE_ROOM.LOBBY,
      fromFloor: 2, toFloor: 2, landing: [2313, 7381, 1] },
    // Cache placements pair the ground lobby stair at2315,7370 with its
    // first-floor down variant at the same x/y on plane1.
    { id: CASTLE_DOOR_IDS.STAIRS_UP, x: 2315, y: 7370, z: 0, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.LOBBY,
      fromFloor: 1, toFloor: 2, action: "Climb-up", facing: 6, landing: [2314, 7371, 1] },
    { id: CASTLE_DOOR_IDS.STAIRS_DOWN_INVISIBLE, x: 2315, y: 7370, z: 1, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.LOBBY,
      fromFloor: 2, toFloor: 1, action: "Climb-down", landing: [2314, 7369, 0] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2466, y: 7422, z: 0, from: CASTLE_ROOM.NORTH_LOBBY_HALL, to: CASTLE_ROOM.VANESCULA_HALL,
      fromFloor: 2, toFloor: 2, landing: [2452, 7404] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2452, y: 7403, z: 0, from: CASTLE_ROOM.VANESCULA_HALL, to: CASTLE_ROOM.NORTH_LOBBY_HALL,
      fromFloor: 2, toFloor: 2, landing: [2466, 7421] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2468, y: 7407, z: 0, from: CASTLE_ROOM.VANESCULA_HALL, to: CASTLE_ROOM.VANESCULA_STUDY,
      fromFloor: 2, toFloor: 2, requiresStory: "vanesculaEmblemPlaced", landing: [2474, 7371] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2474, y: 7372, z: 0, from: CASTLE_ROOM.VANESCULA_STUDY, to: CASTLE_ROOM.VANESCULA_HALL,
      fromFloor: 2, toFloor: 2, landing: [2468, 7408] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2477, y: 7409, z: 0, from: CASTLE_ROOM.VANESCULA_HALL, to: CASTLE_ROOM.RANIS_HALL,
      fromFloor: 2, toFloor: 2, requiresStory: "ranisHallwayEmblemPlaced", landing: [2482, 7403] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2481, y: 7403, z: 0, from: CASTLE_ROOM.RANIS_HALL, to: CASTLE_ROOM.VANESCULA_HALL,
      fromFloor: 2, toFloor: 2, requiresStory: "ranisHallwayEmblemPlaced", landing: [2476, 7409] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2488, y: 7401, z: 0, from: CASTLE_ROOM.RANIS_HALL, to: CASTLE_ROOM.VENATOR_ROOM,
      fromFloor: 2, toFloor: 2, facing: 4, requiresStory: "ranisParlourEmblemPlaced", landing: [2487, 7421] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2485, y: 7405, z: 0, from: CASTLE_ROOM.RANIS_HALL,
      to: CASTLE_ROOM.RANIS_PARLOUR, fromFloor: 2, toFloor: 2,
      requiresStory: "ranisParlourEmblemPlaced", landing: [2475, 7380] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2475, y: 7379, z: 0, from: CASTLE_ROOM.RANIS_PARLOUR,
      to: CASTLE_ROOM.RANIS_HALL, fromFloor: 2, toFloor: 2, landing: [2485, 7404] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2483, y: 7368, z: 0, from: CASTLE_ROOM.VANESCULA_CHAMBER,
      to: CASTLE_ROOM.VANESCULA_STUDY, fromFloor: 2, toFloor: 2, landing: [2476, 7366] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2477, y: 7366, z: 0, from: CASTLE_ROOM.VANESCULA_STUDY,
      to: CASTLE_ROOM.VANESCULA_CHAMBER, fromFloor: 2, toFloor: 2,
      requiresStory: "vanesculaStudyEmblemPlaced", landing: [2483, 7368] },
    { id: CASTLE_DOOR_IDS.SPIRAL_DOWN, x: 2491, y: 7402, z: 0, from: CASTLE_ROOM.RANIS_HALL, to: CASTLE_ROOM.NORTH_CHAPEL,
      fromFloor: 2, toFloor: 1, action: "Climb-down", landing: [2386, 7405] },
    { id: CASTLE_DOOR_IDS.SPIRAL_UP, x: 2385, y: 7403, z: 0, from: CASTLE_ROOM.NORTH_CHAPEL, to: CASTLE_ROOM.RANIS_HALL,
      fromFloor: 1, toFloor: 2, action: "Climb-up", landing: [2490, 7401] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2372, y: 7409, z: 0, from: CASTLE_ROOM.NORTH_CHAPEL, to: CASTLE_ROOM.WEST_CHAPEL,
      fromFloor: 1, toFloor: 1, requiresStory: "northChapelHallwayEmblemPlaced", landing: [2371, 7395] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2371, y: 7396, z: 0, from: CASTLE_ROOM.WEST_CHAPEL, to: CASTLE_ROOM.NORTH_CHAPEL,
      fromFloor: 1, toFloor: 1, requiresStory: "northChapelHallwayEmblemPlaced", landing: [2373, 7409] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2369, y: 7384, z: 0, from: CASTLE_ROOM.WEST_CHAPEL, to: CASTLE_ROOM.GALLERY,
      fromFloor: 1, toFloor: 1, requiresStory: "galleryHallwayEmblemPlaced", landing: [2387, 7366] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2388, y: 7366, z: 0, from: CASTLE_ROOM.GALLERY, to: CASTLE_ROOM.WEST_CHAPEL,
      fromFloor: 1, toFloor: 1, requiresStory: "galleryHallwayEmblemPlaced", landing: [2370, 7384] },
    { id: CASTLE_DOOR_IDS.CRESCENT_M, x: 2370, y: 7370, z: 0, from: CASTLE_ROOM.GALLERY, to: CASTLE_ROOM.GALLERY_HALL,
      fromFloor: 1, toFloor: 1, landing: [2342, 7416] },
    { id: CASTLE_DOOR_IDS.CRESCENT, x: 2343, y: 7416, z: 0, from: CASTLE_ROOM.GALLERY_HALL, to: CASTLE_ROOM.GALLERY,
      fromFloor: 1, toFloor: 1, landing: [2371, 7370] },
    { id: CASTLE_DOOR_IDS.CRESCENT_M, x: 2325, y: 7403, z: 0, from: CASTLE_ROOM.GALLERY_HALL, to: CASTLE_ROOM.KITCHEN,
      fromFloor: 1, toFloor: 1, landing: [2314, 7420] },
    // Captured full-quest route after the kitchen chest: this reverse door
    // carries the player from the kitchen into the Gallery Hall beside Veliaf.
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2314, y: 7403, z: 0, from: CASTLE_ROOM.KITCHEN,
      to: CASTLE_ROOM.GALLERY_HALL, fromFloor: 1, toFloor: 1, landing: [2325, 7397] },
    // The half-moon door on the Gallery Hall's south side returns to the
    // ground-floor lobby, where the captured route descends to the basement.
    { id: CASTLE_DOOR_IDS.HALF_M, x: 2330, y: 7398, z: 0, from: CASTLE_ROOM.GALLERY_HALL,
      to: CASTLE_ROOM.LOBBY, fromFloor: 1, toFloor: 1, key: CASTLE_BOOK_ITEMS.halfMoonKey,
      keyName: "half moon key", landing: [2314, 7361] },
    { id: CASTLE_DOOR_IDS.CRESCENT, x: 2314, y: 7421, z: 0, from: CASTLE_ROOM.KITCHEN, to: CASTLE_ROOM.GALLERY_HALL,
      fromFloor: 1, toFloor: 1, landing: [2324, 7403] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2309, y: 7421, z: 0, from: CASTLE_ROOM.KITCHEN, to: CASTLE_ROOM.LARDER,
      // The recorded quest route lands at [2361,7394], from where both the
      // larder cabinet and the plugged sink are reachable through the cache.
      fromFloor: 1, toFloor: 1, landing: [2361, 7394] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2361, y: 7393, z: 0, from: CASTLE_ROOM.LARDER, to: CASTLE_ROOM.KITCHEN,
      fromFloor: 1, toFloor: 1, landing: [2309, 7420] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2330, y: 7407, z: 0, from: CASTLE_ROOM.GALLERY_HALL, to: CASTLE_ROOM.LOBBY,
      fromFloor: 1, toFloor: 1, landing: [2327, 7381] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2327, y: 7382, z: 0, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.GALLERY_HALL,
      fromFloor: 1, toFloor: 1, landing: [2331, 7407] },
    { id: CASTLE_DOOR_IDS.HALF_M, x: 2310, y: 7386, z: 0, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.SOUTH_OF_THRONE,
      fromFloor: 1, toFloor: 1, landing: [2327, 7390] },
    { id: CASTLE_DOOR_IDS.HALF_M, x: 2327, y: 7391, z: 0, from: CASTLE_ROOM.SOUTH_OF_THRONE, to: CASTLE_ROOM.THRONE,
      fromFloor: 1, toFloor: 1, landing: [2310, 7388] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2309, y: 7397, z: 0, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.STUDY,
      fromFloor: 1, toFloor: 1, landing: [2358, 7381] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2358, y: 7380, z: 0, from: CASTLE_ROOM.STUDY, to: CASTLE_ROOM.THRONE,
      fromFloor: 1, toFloor: 1, facing: 4, landing: [2310, 7396] },
    { id: CASTLE_DOOR_IDS.GIBBOUS, x: 2327, y: 7360, z: 1, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.DINING,
      fromFloor: 2, toFloor: 2, landing: [2342, 7372, 1] },
    { id: CASTLE_DOOR_IDS.GIBBOUS, x: 2342, y: 7373, z: 1, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.LOBBY,
      fromFloor: 2, toFloor: 2, landing: [2328, 7360, 1] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2358, y: 7366, z: 1, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.THRONE,
      fromFloor: 2, toFloor: 2, landing: [2305, 7392, 1] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2304, y: 7392, z: 1, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.DINING,
      fromFloor: 2, toFloor: 2, landing: [2357, 7366, 1] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2306, y: 7386, z: 1, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.UPPER_SOUTH_HALL,
      fromFloor: 2, toFloor: 2, landing: [2434, 7364] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2434, y: 7365, z: 0, from: CASTLE_ROOM.UPPER_SOUTH_HALL, to: CASTLE_ROOM.THRONE,
      fromFloor: 2, toFloor: 2, landing: [2305, 7386, 1] },
    { id: CASTLE_DOOR_IDS.FULL, x: 2436, y: 7361, z: 0, from: CASTLE_ROOM.UPPER_SOUTH_HALL, to: CASTLE_ROOM.BEDROOM,
      fromFloor: 2, toFloor: 2, landing: [2452, 7364] },
    { id: CASTLE_DOOR_IDS.FULL_M, x: 2452, y: 7365, z: 0, from: CASTLE_ROOM.BEDROOM, to: CASTLE_ROOM.UPPER_SOUTH_HALL,
      fromFloor: 2, toFloor: 2, landing: [2437, 7361] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2446, y: 7364, z: 0, from: CASTLE_ROOM.UPPER_SOUTH_HALL, to: CASTLE_ROOM.EAST_STAIR_FIRST,
      fromFloor: 2, toFloor: 2, landing: [2458, 7362] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2457, y: 7362, z: 0, from: CASTLE_ROOM.EAST_STAIR_FIRST, to: CASTLE_ROOM.UPPER_SOUTH_HALL,
      fromFloor: 2, toFloor: 2, landing: [2445, 7364] },
    // The current cache places the matching descent at 2459,7371; the QH
    // endpoint at 2359,7371 is an obsolete/incorrectly transcribed location.
    { id: CASTLE_DOOR_IDS.SPIRAL_DOWN, x: 2459, y: 7371, z: 0, from: CASTLE_ROOM.EAST_STAIR_FIRST, to: CASTLE_ROOM.EAST_STAIR_GROUND,
      fromFloor: 2, toFloor: 1, action: "Climb-down", landing: [2363, 7368] },
    { id: CASTLE_DOOR_IDS.SPIRAL_UP, x: 2363, y: 7369, z: 0, from: CASTLE_ROOM.EAST_STAIR_GROUND, to: CASTLE_ROOM.EAST_STAIR_FIRST,
      fromFloor: 1, toFloor: 2, action: "Climb-up", landing: [2358, 7371] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2363, y: 7362, z: 0, from: CASTLE_ROOM.EAST_STAIR_GROUND, to: CASTLE_ROOM.THRONE_STORAGE,
      fromFloor: 1, toFloor: 1, landing: [2348, 7397] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2349, y: 7399, z: 0, from: CASTLE_ROOM.THRONE_STORAGE, to: CASTLE_ROOM.EAST_STAIR_GROUND,
      fromFloor: 1, toFloor: 1, landing: [2364, 7362] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2344, y: 7395, z: 0, from: CASTLE_ROOM.THRONE_STORAGE, to: CASTLE_ROOM.SOUTH_OF_THRONE,
      fromFloor: 1, toFloor: 1, landing: [2332, 7388] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2333, y: 7388, z: 0, from: CASTLE_ROOM.SOUTH_OF_THRONE, to: CASTLE_ROOM.THRONE_STORAGE,
      fromFloor: 1, toFloor: 1, landing: [2345, 7395] },
    { id: CASTLE_DOOR_IDS.CRESCENT_M, x: 2471, y: 7422, z: 0, from: CASTLE_ROOM.NORTH_LOBBY_HALL, to: CASTLE_ROOM.CRESCENT_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2491, 7377] },
    { id: CASTLE_DOOR_IDS.CRESCENT, x: 2492, y: 7377, z: 0, from: CASTLE_ROOM.CRESCENT_ROOM, to: CASTLE_ROOM.NORTH_LOBBY_HALL,
      fromFloor: 2, toFloor: 2, landing: [2471, 7421] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT, x: 2507, y: 7409, z: 0, from: CASTLE_ROOM.SOLID_DOOR_HALL, to: CASTLE_ROOM.SOLID_DOOR_STORAGE,
      fromFloor: 2, toFloor: 2, landing: [2554, 7364] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2553, y: 7364, z: 0, from: CASTLE_ROOM.SOLID_DOOR_STORAGE, to: CASTLE_ROOM.SOLID_DOOR_HALL,
      fromFloor: 2, toFloor: 2, landing: [2506, 7409] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2585, y: 7370, z: 0, from: CASTLE_ROOM.BASEMENT_HALL, to: CASTLE_ROOM.BASEMENT_STORAGE,
      fromFloor: 1, toFloor: 1, landing: [2588, 7381] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2588, y: 7380, z: 0, from: CASTLE_ROOM.BASEMENT_STORAGE, to: CASTLE_ROOM.BASEMENT_HALL,
      fromFloor: 1, toFloor: 1, landing: [2583, 7370] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2442, y: 7361, z: 0, from: CASTLE_ROOM.UPPER_SOUTH_HALL, to: CASTLE_ROOM.ORNATE_KNIFE,
      fromFloor: 2, toFloor: 2, landing: [2451, 7371] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2452, y: 7373, z: 0, from: CASTLE_ROOM.ORNATE_KNIFE, to: CASTLE_ROOM.UPPER_SOUTH_HALL,
      fromFloor: 2, toFloor: 2, landing: [2441, 7361] },
    { id: CASTLE_DOOR_IDS.GUEST_PORTAL_IN, x: 2450, y: 7372, z: 0, from: CASTLE_ROOM.ORNATE_KNIFE, to: CASTLE_ROOM.GUEST_STORAGE,
      fromFloor: 2, toFloor: 2, action: "Enter", requiresStory: "gibbousGuestPortalOpened", landing: [2522, 7396] },
    // The actual return is through the Gibbous door; the cache has no portal at 2515,7396.
    { id: CASTLE_DOOR_IDS.GIBBOUS_M, x: 2522, y: 7397, z: 0, from: CASTLE_ROOM.GUEST_STORAGE, to: CASTLE_ROOM.DISPLAY_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2506, 7364] },
    { id: CASTLE_DOOR_IDS.GIBBOUS, x: 2506, y: 7363, z: 0, from: CASTLE_ROOM.DISPLAY_ROOM, to: CASTLE_ROOM.GUEST_STORAGE,
      fromFloor: 2, toFloor: 2, landing: [2520, 7396] },
    { id: CASTLE_DOOR_IDS.GIBBOUS, x: 2336, y: 7370, z: 1, from: CASTLE_ROOM.DINING, to: CASTLE_ROOM.EXPLOSIVE_HALL,
      fromFloor: 2, toFloor: 1, landing: [2482, 7395] },
    { id: CASTLE_DOOR_IDS.GIBBOUS_M, x: 2483, y: 7395, z: 0, from: CASTLE_ROOM.EXPLOSIVE_HALL, to: CASTLE_ROOM.DINING,
      fromFloor: 1, toFloor: 2, landing: [2337, 7370, 1] },
    { id: CASTLE_DOOR_IDS.GIBBOUS, x: 2510, y: 7370, z: 0, from: CASTLE_ROOM.DISPLAY_ROOM, to: CASTLE_ROOM.VENATOR_PUZZLE,
      fromFloor: 2, toFloor: 2, landing: [2516, 7368] },
    { id: CASTLE_DOOR_IDS.GIBBOUS_M, x: 2515, y: 7367, z: 0, from: CASTLE_ROOM.VENATOR_PUZZLE, to: CASTLE_ROOM.DISPLAY_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2509, 7370] },
    { id: CASTLE_DOOR_IDS.PUZZLE_LIBRARY, x: 2519, y: 7363, z: 0, from: CASTLE_ROOM.VENATOR_PUZZLE, to: CASTLE_ROOM.VENATOR_LIBRARY,
      fromFloor: 2, toFloor: 2, action: "Enter", requiresStory: "gibbousSpearDoorUnlocked", landing: [2551, 7386] },
    { id: CASTLE_DOOR_IDS.DOOR_ALT_M, x: 2551, y: 7387, z: 0, from: CASTLE_ROOM.VENATOR_LIBRARY, to: CASTLE_ROOM.VENATOR_PUZZLE,
      fromFloor: 2, toFloor: 2, landing: [2519, 7364] },
    { id: CASTLE_DOOR_IDS.DISPLAY_STAIRS_DOWN, x: 2503, y: 7369, z: 0, from: CASTLE_ROOM.DISPLAY_ROOM, to: CASTLE_ROOM.LOBBY,
      fromFloor: 2, toFloor: 2, action: "Climb-down", landing: [2309, 7369, 1] },
    { id: CASTLE_DOOR_IDS.DISPLAY_STAIRS_DOWN, x: 2503, y: 7379, z: 0, from: CASTLE_ROOM.DISPLAY_ROOM, to: CASTLE_ROOM.LOBBY,
      fromFloor: 2, toFloor: 2, action: "Climb-down", landing: [2309, 7373, 1] },
    { id: CASTLE_DOOR_IDS.STAIRS_UP, x: 2308, y: 7365, z: 1, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.DISPLAY_ROOM,
      fromFloor: 2, toFloor: 2, action: "Climb-up", landing: [2502, 7368] },
    { id: CASTLE_DOOR_IDS.GILDED_M, x: 2452, y: 7420, z: 0, from: CASTLE_ROOM.NORTH_LOBBY_HALL, to: CASTLE_ROOM.SMALL_HALL,
      fromFloor: 2, toFloor: 2, action: "Enter", key: ItemIdentifiers.GILDED_KEY, keyName: "gilded key", landing: [2444, 7418] },
    { id: CASTLE_DOOR_IDS.GILDED, x: 2445, y: 7418, z: 0, from: CASTLE_ROOM.SMALL_HALL, to: CASTLE_ROOM.NORTH_LOBBY_HALL,
      fromFloor: 2, toFloor: 2, action: "Enter", key: ItemIdentifiers.GILDED_KEY, keyName: "gilded key", landing: [2453, 7420] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2441, y: 7413, z: 0, from: CASTLE_ROOM.SMALL_HALL, to: CASTLE_ROOM.SECRET_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2437, 7419] },
    { id: CASTLE_DOOR_IDS.DOOR_M, x: 2441, y: 7417, z: 0, from: CASTLE_ROOM.SMALL_HALL, to: CASTLE_ROOM.IVAN_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2459, 7390] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2460, y: 7390, z: 0, from: CASTLE_ROOM.IVAN_ROOM, to: CASTLE_ROOM.SMALL_HALL,
      fromFloor: 2, toFloor: 2, landing: [2442, 7417] },
    { id: CASTLE_DOOR_IDS.IVAN_PASSAGE, x: 2455, y: 7386, z: 0, from: CASTLE_ROOM.IVAN_ROOM, to: CASTLE_ROOM.SECRET_ROOM,
      fromFloor: 2, toFloor: 2, action: "Enter", landing: [2437, 7419] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2438, y: 7419, z: 0, from: CASTLE_ROOM.SECRET_ROOM, to: CASTLE_ROOM.SMALL_HALL,
      fromFloor: 2, toFloor: 2, key: ItemIdentifiers.FULL_MOON_KEY, keyName: "full moon key", landing: [2442, 7413] },
    { id: CASTLE_DOOR_IDS.FULL_M, x: 2373, y: 7392, z: 0, from: CASTLE_ROOM.WEST_CHAPEL, to: CASTLE_ROOM.BOTTLE_ROOM,
      fromFloor: 1, toFloor: 1, landing: [2380, 7392] },
    { id: CASTLE_DOOR_IDS.FULL_M, x: 2379, y: 7392, z: 0, from: CASTLE_ROOM.BOTTLE_ROOM, to: CASTLE_ROOM.WEST_CHAPEL,
      fromFloor: 1, toFloor: 1, landing: [2372, 7392] },
    { id: CASTLE_DOOR_IDS.FULL, x: 2388, y: 7383, z: 0, from: CASTLE_ROOM.BOTTLE_ROOM, to: CASTLE_ROOM.CHAPEL_LIBRARY,
      fromFloor: 1, toFloor: 1, landing: [2393, 7363] },
    { id: CASTLE_DOOR_IDS.FULL_M, x: 2392, y: 7363, z: 0, from: CASTLE_ROOM.CHAPEL_LIBRARY, to: CASTLE_ROOM.BOTTLE_ROOM,
      fromFloor: 1, toFloor: 1, landing: [2387, 7383] },
    { id: CASTLE_DOOR_IDS.CHAPEL_PORTAL_IN, x: 2393, y: 7370, z: 0, from: CASTLE_ROOM.CHAPEL_LIBRARY, to: CASTLE_ROOM.SERVANTS_QUARTERS,
      requiresStory: "chapelPortalOpened",
      fromFloor: 1, toFloor: 1, action: "Enter", landing: [2441, 7400] },
    { id: CASTLE_DOOR_IDS.CHAPEL_PORTAL_OUT, x: 2440, y: 7400, z: 0, from: CASTLE_ROOM.SERVANTS_QUARTERS, to: CASTLE_ROOM.CHAPEL_LIBRARY,
      fromFloor: 1, toFloor: 1, action: "Enter", landing: [2394, 7370] },
    { id: CASTLE_DOOR_IDS.NEW_M, x: 2438, y: 7394, z: 0, from: CASTLE_ROOM.SERVANTS_QUARTERS, to: CASTLE_ROOM.EXPLOSIVE_ROOM,
      fromFloor: 1, toFloor: 1, landing: [2440, 7388] },
    { id: CASTLE_DOOR_IDS.NEW, x: 2441, y: 7389, z: 0, from: CASTLE_ROOM.EXPLOSIVE_ROOM, to: CASTLE_ROOM.SERVANTS_QUARTERS,
      fromFloor: 1, toFloor: 1, landing: [2439, 7394] },
    { id: CASTLE_DOOR_IDS.FULL, x: 2306, y: 7397, z: 1, from: CASTLE_ROOM.THRONE, to: CASTLE_ROOM.ABOVE_STUDY,
      fromFloor: 2, toFloor: 2, landing: [2439, 7377] },
    { id: CASTLE_DOOR_IDS.FULL_M, x: 2434, y: 7372, z: 0, from: CASTLE_ROOM.ABOVE_STUDY, to: CASTLE_ROOM.THRONE,
      fromFloor: 2, toFloor: 2, landing: [2306, 7396, 1] },
    { id: CASTLE_DOOR_IDS.FULL, x: 2525, y: 7363, z: 0, from: CASTLE_ROOM.VENATOR_PUZZLE, to: CASTLE_ROOM.SOLID_KEY_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2540, 7373] },
    { id: CASTLE_DOOR_IDS.FULL, x: 2541, y: 7374, z: 0, from: CASTLE_ROOM.SOLID_KEY_ROOM, to: CASTLE_ROOM.VENATOR_PUZZLE,
      fromFloor: 2, toFloor: 2, landing: [2526, 7363] },
    { id: CASTLE_DOOR_IDS.FULL, x: 2510, y: 7379, z: 0, from: CASTLE_ROOM.DISPLAY_ROOM, to: CASTLE_ROOM.SOLID_DOOR_HALL,
      fromFloor: 2, toFloor: 2, landing: [2499, 7400] },
    { id: CASTLE_DOOR_IDS.FULL_M, x: 2499, y: 7400, z: 0, from: CASTLE_ROOM.SOLID_DOOR_HALL, to: CASTLE_ROOM.DISPLAY_ROOM,
      fromFloor: 2, toFloor: 2, landing: [2509, 7379] },
    { id: 61575, x: 2503, y: 7400, z: 0, from: CASTLE_ROOM.SOLID_DOOR_HALL, to: CASTLE_ROOM.LABORATORY,
      fromFloor: 2, toFloor: 2, action: "Enter", key: ItemIdentifiers.SOLID_KEY, consumesKey: true,
      keyName: "solid key", landing: [2513, 7382] },
    { id: 61574, x: 2512, y: 7382, z: 0, from: CASTLE_ROOM.LABORATORY, to: CASTLE_ROOM.SOLID_DOOR_HALL,
      fromFloor: 2, toFloor: 2, action: "Enter", key: ItemIdentifiers.SOLID_KEY, keyName: "solid key", landing: [2502, 7400] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2523, y: 7389, z: 0, from: CASTLE_ROOM.LABORATORY, to: CASTLE_ROOM.STOCKPILE_STORAGE,
      fromFloor: 2, toFloor: 2, landing: [2534, 7378] },
    { id: CASTLE_DOOR_IDS.DOOR, x: 2535, y: 7377, z: 0, from: CASTLE_ROOM.STOCKPILE_STORAGE, to: CASTLE_ROOM.LABORATORY,
      fromFloor: 2, toFloor: 2, landing: [2524, 7388] },
    { id: 61606, x: 2311, y: 7366, z: 0, from: CASTLE_ROOM.LOBBY, to: CASTLE_ROOM.BASEMENT_HALL,
      fromFloor: 1, toFloor: 1, action: "Climb-down", landing: [2563, 7369] },
    { id: 61600, x: 2564, y: 7369, z: 0, from: CASTLE_ROOM.BASEMENT_HALL, to: CASTLE_ROOM.LOBBY,
      fromFloor: 1, toFloor: 1, action: "Climb-up", landing: [2310, 7366] },
    { id: CASTLE_DOOR_IDS.CRESCENT_M, x: 2570, y: 7365, z: 0, from: CASTLE_ROOM.BASEMENT_HALL, to: CASTLE_ROOM.BASEMENT_VENATOR,
      fromFloor: 1, toFloor: 1, landing: [2566, 7386] },
    { id: CASTLE_DOOR_IDS.CRESCENT, x: 2579, y: 7365, z: 0, from: CASTLE_ROOM.BASEMENT_HALL, to: CASTLE_ROOM.BASEMENT_VENATOR,
      fromFloor: 1, toFloor: 1, key: CASTLE_BOOK_ITEMS.crescentMoonKey, keyName: "crescent moon key", landing: [2575, 7386] },
    { id: CASTLE_DOOR_IDS.CRESCENT, x: 2566, y: 7387, z: 0, from: CASTLE_ROOM.BASEMENT_VENATOR, to: CASTLE_ROOM.BASEMENT_HALL,
      fromFloor: 1, toFloor: 1, landing: [2569, 7365] },
    { id: CASTLE_DOOR_IDS.CRESCENT_M, x: 2575, y: 7387, z: 0, from: CASTLE_ROOM.BASEMENT_VENATOR, to: CASTLE_ROOM.BASEMENT_HALL,
      fromFloor: 1, toFloor: 1, landing: [2579, 7366] },
    { id: CASTLE_DOOR_IDS.NEW, x: 2570, y: 7369, z: 0, from: CASTLE_ROOM.BASEMENT_HALL, to: CASTLE_ROOM.BASEMENT_PRISON,
      fromFloor: 1, toFloor: 1, landing: [2565, 7394] },
    { id: CASTLE_DOOR_IDS.NEW_M, x: 2566, y: 7394, z: 0, from: CASTLE_ROOM.BASEMENT_PRISON, to: CASTLE_ROOM.BASEMENT_HALL,
      fromFloor: 1, toFloor: 1, landing: [2570, 7368] },
  ]);
  const CASTLE_DOOR_NAMES = Object.freeze(["Door", "Half moon door", "Crescent moon door",
    "New moon door", "Gibbous moon door", "Full moon door", "Stairs", "Spiral staircase",
    "Gilded door", "Solid door", "Teleporter"]);
  const CASTLE_MOON_DOOR_KEYS = new Map([
    [CASTLE_DOOR_IDS.NEW, [CASTLE_BOOK_ITEMS.newMoonKey, "new moon key"]],
    [CASTLE_DOOR_IDS.NEW_M, [CASTLE_BOOK_ITEMS.newMoonKey, "new moon key"]],
    [CASTLE_DOOR_IDS.HALF, [CASTLE_BOOK_ITEMS.halfMoonKey, "half moon key"]],
    [CASTLE_DOOR_IDS.HALF_M, [CASTLE_BOOK_ITEMS.halfMoonKey, "half moon key"]],
    [CASTLE_DOOR_IDS.GIBBOUS, [CASTLE_BOOK_ITEMS.gibbousMoonKey, "gibbous moon key"]],
    [CASTLE_DOOR_IDS.GIBBOUS_M, [CASTLE_BOOK_ITEMS.gibbousMoonKey, "gibbous moon key"]],
    [CASTLE_DOOR_IDS.FULL, [CASTLE_BOOK_ITEMS.fullMoonKey, "full moon key"]],
    [CASTLE_DOOR_IDS.FULL_M, [CASTLE_BOOK_ITEMS.fullMoonKey, "full moon key"]],
    [CASTLE_DOOR_IDS.CRESCENT, [CASTLE_BOOK_ITEMS.crescentMoonKey, "crescent moon key"]],
    [CASTLE_DOOR_IDS.CRESCENT_M, [CASTLE_BOOK_ITEMS.crescentMoonKey, "crescent moon key"]],
    [CASTLE_DOOR_IDS.GILDED, [ItemIdentifiers.GILDED_KEY, "gilded key"]],
    [CASTLE_DOOR_IDS.GILDED_M, [ItemIdentifiers.GILDED_KEY, "gilded key"]],
    [CASTLE_DOOR_IDS.SOLID, [ItemIdentifiers.SOLID_KEY, "solid key"]],
    [CASTLE_DOOR_IDS.SOLID_M, [ItemIdentifiers.SOLID_KEY, "solid key"]],
  ]);
  // Quest Helper locates the Castle Drakan shrine at (3168, 7707) and the
  // Vampyrium entry portal at (3161, 7710). The medallion lands beside the
  // clipped shrine object; the entry portal then moves the player beside the
  // return portal in the Vampyrium castle.
  // shortcut: the Wiki does not publish teleport landing tiles; both adjacent
  // tiles are cache-verified and connected to their respective portal.
  const CASTLE_TELEPORT_TILE = Object.freeze({ x: 3167, y: 7707, z: 0 });
  const CASTLE_VAMPYRIUM_ENTRY = Object.freeze({ id: 61216, visibleId: 61214, x: 3161, y: 7710, z: 0 });
  const CASTLE_VAMPYRIUM_ARRIVAL = Object.freeze({ x: 2322, y: 7370, z: 0 });
  // Captured RSProx landing for returning from the public Castle shrine once
  // the siege hall has been earned. This is an explicit portal transition;
  // login/death recovery never moves a player here automatically.
  const CASTLE_SIEGE_HALL_ARRIVAL = Object.freeze({ x: 3168, y: 7857, z: 1 });
  // Bridge's captured 62144 entrance landing; used as the safe current-chapter
  // return when a prepared player uses the Castle Drakan lobby portal again.
  const CASTLE_PALACE_ENTRANCE_ARRIVAL = Object.freeze({ x: 3168, y: 7859, z: 1 });
  const CASTLE_VAMPYRIUM_RETURN = Object.freeze({ id: 61221, x: 2323, y: 7370, z: 0 });
  const CASTLE_LEGACY_BLOCKED_ARRIVAL = Object.freeze({ x: 2310, y: 7404, z: 0 });
  const REFINERY_COMPLETED_EVENT = "bmr:refinery-completed";
  const SLEPE_PLINTH_VARBITS = [15496, 15492, 15491, 15493, 15495, 15494];
  const SLEPE_BOOKS = [
    { id: ItemIdentifiers.ESSIANDARS_NOTES, name: "Essiandar's notes", varbitValue: 6, shelf: [3409, 3488] },
    { id: ItemIdentifiers.SARLS_JOURNAL, name: "Sarl's journal", varbitValue: 2, shelf: [3414, 3491] },
    { id: ItemIdentifiers.FROM_MISTHALIN_TO_MORYTANIA, name: "From Misthalin to Morytania", varbitValue: 1, shelf: [3411, 3492] },
    { id: ItemIdentifiers.SCRUFFY_NOTEBOOK, name: "Scruffy notebook", varbitValue: 3, shelf: [3409, 3488] },
    { id: ItemIdentifiers.THE_LIFE_OF_FRIAR, name: "The Life of Friar", varbitValue: 5, shelf: [3414, 3491] },
    { id: ItemIdentifiers.PIOUS_PROCEEDINGS, name: "Pious proceedings", varbitValue: 4, shelf: [3411, 3491] },
  ];
  const SLEPE_PLINTHS = [
    { x: 3409, y: 3483, window: "Essiandar", itemId: ItemIdentifiers.ESSIANDARS_NOTES },
    { x: 3408, y: 3485, window: "Sarl", itemId: ItemIdentifiers.SARLS_JOURNAL },
    { x: 3409, y: 3487, window: "Iriandul", itemId: ItemIdentifiers.FROM_MISTHALIN_TO_MORYTANIA },
    { x: 3409, y: 3490, window: "Derygull", itemId: ItemIdentifiers.SCRUFFY_NOTEBOOK },
    { x: 3408, y: 3492, window: "Friar", itemId: ItemIdentifiers.THE_LIFE_OF_FRIAR },
    { x: 3409, y: 3494, window: "Erysail", itemId: ItemIdentifiers.PIOUS_PROCEEDINGS },
  ];
  // P1 tick 1740 (30205-30217): Ivan 15863 plus two each 16154/16155/16156 at the captured
  // tiles; the 16271/16272 walkers (28371/29985) are world 3484/3485 morphs on varbit 15464.
  const PATERDOMUS_BATTLE_SPAWNS = Object.freeze([
    { id: NpcIdentifiers.IVAN_STROM_21, x: 3409, y: 3488, face: 1536 },
    { id: NpcIdentifiers.MONK_OF_ZAMORAK_12, x: 3413, y: 3489 },
    { id: NpcIdentifiers.MONK_OF_ZAMORAK_13, x: 3411, y: 3492 },
    { id: NpcIdentifiers.MONK_OF_ZAMORAK_14, x: 3415, y: 3491 },
    { id: NpcIdentifiers.MONK_OF_ZAMORAK_12, x: 3410, y: 3485 },
    { id: NpcIdentifiers.MONK_OF_ZAMORAK_13, x: 3414, y: 3484 },
    { id: NpcIdentifiers.MONK_OF_ZAMORAK_14, x: 3417, y: 3486 },
  ]);
  const PATERDOMUS_BATTLE_TARGET = Object.freeze({ x: 3408, y: 3488, z: 0 });
  const PATERDOMUS_ESCAPE_DOORS = Object.freeze([
    { id: ObjectIdentifiers.LARGE_DOOR_110, x: 3408, y: 3489 },
    { id: ObjectIdentifiers.LARGE_DOOR_111, x: 3408, y: 3488 },
  ]);
  const paterdomusBattles = new Map();
  const SLEPE_WINDOW_ROUTES = new Map([
    [61280, { x: 3408, y: 3485, destination: { x: 3409, y: 3485, z: 1 } }],
    [61282, { x: 3408, y: 3485, destination: { x: 3409, y: 3485, z: 1 } }],
    [61289, { x: 3408, y: 3492, destination: { x: 3409, y: 3491, z: 1 } }],
    [61291, { x: 3408, y: 3492, destination: { x: 3409, y: 3491, z: 1 } }],
    [61292, { x: 3409, y: 3483, destination: { x: 3409, y: 3484, z: 1 } }],
    [61294, { x: 3409, y: 3483, destination: { x: 3409, y: 3484, z: 1 } }],
    [61277, { x: 3409, y: 3487, destination: { x: 3409, y: 3486, z: 1 } }],
    [61279, { x: 3409, y: 3487, destination: { x: 3409, y: 3486, z: 1 } }],
    [61283, { x: 3409, y: 3490, destination: { x: 3410, y: 3489, z: 1 } }],
    [61285, { x: 3409, y: 3490, destination: { x: 3410, y: 3489, z: 1 } }],
    [61286, { x: 3409, y: 3494, destination: { x: 3409, y: 3493, z: 1 } }],
    [61288, { x: 3409, y: 3494, destination: { x: 3409, y: 3493, z: 1 } }],
  ]);
  const HIDEOUT_SHRINE_IDS = new Set([61174, ObjectIdentifiers.MAKESHIFT_SHRINE, ObjectIdentifiers.MAKESHIFT_SHRINE_2]);
  const HIDEOUT_SHRINE_TILE = { x: 3601, y: 9614, z: 0 };
  const HIDEOUT_CHEST_ID = ObjectIdentifiers.CLOSED_CHEST_37;
  const HIDEOUT_CHEST_TILE = { x: 3600, y: 9617, z: 0 };
  const VYRE_NOBLE_OUTFIT = [ItemIdentifiers.VYRE_NOBLE_TOP, ItemIdentifiers.VYRE_NOBLE_LEGS, ItemIdentifiers.VYRE_NOBLE_SHOES];
  const HUNT_TRAPDOOR_ID = 61848;
  // Raw cache loc at the Sangvesti drawbridge; 61804 transforms to 61805/61806.
  const HUNT_DRAWBRIDGE_MECHANISM_ID = 61804;
  const HUNT_DRAWBRIDGE_MECHANISM_TILE = Object.freeze({ x: 2633, y: 7831, z: 0 });
  const HUNT_FOUND_COG_VARBIT = 15485;
  const HUNT_ITEMS = {
    crank: ItemIdentifiers.CRANK_WHEEL, dustyBook: ItemIdentifiers.DUSTY_BOOK, viturKey: ItemIdentifiers.VITUR_KEY,
    boltCutters: ItemIdentifiers.BOLT_CUTTERS, toothHalf: ItemIdentifiers.TOOTH_HALF_OF_KEY_6,
    loopHalf: ItemIdentifiers.LOOP_HALF_OF_KEY_6, myrmelKey: ItemIdentifiers.MYRMEL_KEY,
    bucket: ItemIdentifiers.BUCKET, bucketWater: ItemIdentifiers.BUCKET_OF_WATER,
    shadumKey: ItemIdentifiers.SHADUM_KEY, trapdoorKey: ItemIdentifiers.TRAPDOOR_KEY,
    jovkaiKey: ItemIdentifiers.JOVKAI_KEY, oldCog: ItemIdentifiers.OLD_COG,
  };
  const PREP = {
    leaves: ItemIdentifiers.AMITIRE_LEAVES,
    stew: ItemIdentifiers.AMITIRE_STEW,
    bowl: ItemIdentifiers.BOWL,
    bowlWater: ItemIdentifiers.BOWL_OF_WATER,
    potato: ItemIdentifiers.POTATO,
    incompleteStew: ItemIdentifiers.INCOMPLETE_STEW,
    rawMeat: ItemIdentifiers.RAW_IMPALER_MEAT,
    cookedMeat: ItemIdentifiers.COOKED_MEAT,
    uncookedStew: ItemIdentifiers.UNCOOKED_STEW,
    cookedStew: ItemIdentifiers.STEW,
    hammer: ItemIdentifiers.HAMMER,
    chisel: ItemIdentifiers.CHISEL,
    knife: ItemIdentifiers.KNIFE,
    logs: ItemIdentifiers.BLISTERWOOD_LOGS,
    blessedSickle: ItemIdentifiers.SILVER_SICKLE_B_,
    diamond: ItemIdentifiers.DIAMOND,
    diamondTablet: ItemIdentifiers.ENCHANT_DIAMOND,
    diamondSickle: ItemIdentifiers.DIAMOND_SICKLE_B_,
    enchantedSickle: ItemIdentifiers.ENCHANTED_DIAMOND_SICKLE_B_,
    enhancedSickle: ItemIdentifiers.BLISTERWOOD_SICKLE_E_,
    marks: ItemIdentifiers.HALLOWED_MARKS,
    blisterwoodFlail: ItemIdentifiers.BLISTERWOOD_FLAIL,
    flail: ItemIdentifiers.HALLOWED_FLAIL,
    stakes: ItemIdentifiers.BLISTERWOOD_STAKE,
  };
  const ATTRIBUTE = "quest.the_blood_moon_rises.tome-uses";
  const STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    HIDEOUT: 20,
    RETURNED: 25,
    SLEPE: 30,
    CASTLE: 40,
    ESCAPE: 45,
    BLOOD_HUNT: 50,
    PREPARATIONS: 60,
    SIEGE: 70,
    THEATRE: 80,
    WYRDS: 90,
    WYRD_DEFEATED: 95,
    FENCE_FOUND: 96,
    FINAL: 100,
    COMPLETE: 110,
  };
  const WYRD_AREA_ATTRIBUTE = "quest.the_blood_moon_rises.wyrd-area";
  const WYRD_DEFEATED_ATTRIBUTE = "quest.the_blood_moon_rises.wyrd-defeated";
  const WYRD_CUTSCENE_ATTRIBUTE = "quest.the_blood_moon_rises.wyrd-cutscene-active";
  // RSProx 4288 records the stage-150 return from the inspected fence to this
  // walkable Burgh tile (the player then walks south into the pub scene).
  const WYRD_BURGH_RETURN = Object.freeze({ x: 3490, y: 9631, z: 0 });
  const DRAKAN_AREA_ATTRIBUTE = "quest.the_blood_moon_rises.drakan-area";
  const FIRST_BLOOD_AREA_ATTRIBUTE = "quest.the_blood_moon_rises.first-blood-area";
  const FIRST_BLOOD_ARENA = Object.freeze({ minX: 2688, maxX: 2735, minY: 7810, maxY: 7880, z: 0 });
  // Cache gamevals: vfx_lowerniel_drakan_spotanim_test_left/right, verified in spotanim index 24.
  const FIRST_BLOOD_SAFE_TILE_GRAPHIC = Object.freeze({ left: 3896, right: 3897 });
  const DRAKAN_ENCOUNTER_COMPLETE = "quest.the_blood_moon_rises.drakan-defeated";
  const DRAKAN_DEATH_CONFIRMED = "quest.the_blood_moon_rises.drakan-death-confirmed";
  const FINAL_NATIVE_STAGE_ATTRIBUTE = "quest.the_blood_moon_rises.final-native-stage";
  const DRAKAN_SUPPLY_ATTRIBUTE = "quest.the_blood_moon_rises.final-drakan-supplies";
  const FIRST_BLOOD_DEFEATED_ATTRIBUTE = "quest.the_blood_moon_rises.first-blood-defeated";
  const FINAL_PORTAL_OPEN_ATTRIBUTE = "quest.the_blood_moon_rises.final-portal-open";
  const FINAL_PORTAL_USED_ATTRIBUTE = "quest.the_blood_moon_rises.final-portal-used";
  const FINAL_DRAKAN_ID = NpcIdentifiers.LOWERNIEL_DRAKAN_17;
  const FINAL_EFARITAY_ID = NpcIdentifiers.EFARITAY_HALLOW_3;
  const FINAL_EFARITAY_CUTSCENE_ID = NpcIdentifiers.EFARITAY_HALLOW_5;
  const FINAL_WYRD_ID = NpcIdentifiers.WYRD_4;
  // Wiki Efaritay's Supplies page: location Castle Drakan, run by Efaritay
  // "after the completion of The Blood Moon Rises", map x=3163 y=7717 plane=0.
  // Cache 15943 is the named Efaritay with the Trade option.
  const POST_QUEST_EFARITAY = Object.freeze({ id: NpcIdentifiers.EFARITAY_HALLOW_3, x: 3163, y: 7717, z: 0 });
  const TOME_RECLAIM_PAGE = "Efaritay Hallow";
  const TOME_RECLAIM_VARIANT = "if-the-tome-of-experience-was-destroyed";
  // Night of the Blood Moon gathering (native stages 152-164): the captured
  // castle scene and its Lowerniel combat_3 encounter before Efaritay opens
  // the Vampyrium portal.
  const BLOOD_MOON_SCENE = Object.freeze({ x: 3570, y: 3351, z: 0 });
  // RSProx P1: Ivan's escape teleports the party to (3599,9615,0) and spawns
  // the hideout Ivan at (3597,9614,0).
  const HIDEOUT_ESCAPE_LANDING = Object.freeze({ x: 3599, y: 9615, z: 0 });
  const HIDEOUT_DEFENSE_COURTYARD = Object.freeze({ minX: 3561, maxX: 3589, minY: 3347, maxY: 3367, z: 0 });
  const BLOOD_MOON_DRAKAN_ID = NpcIdentifiers.LOWERNIEL_DRAKAN_18;
  const BLOOD_MOON_ALLIES = Object.freeze([NpcIdentifiers.IVAN_STROM_23,
    NpcIdentifiers.SUGADINTI_VITUR_6, NpcIdentifiers.ARANEI_92]);
  const BLOOD_MOON_FIGHT_ATTRIBUTE = "the-blood-moon-rises:gathering-fight";
  const BLOOD_MOON_SCENE_ATTRIBUTE = "the-blood-moon-rises:gathering-scene-started";
  const BLOOD_MOON_DRAKAN_MAX_HP = 3000;
  // RSProx 4288: the scripted Safalaan intervention fires when the hp bar is 879.
  const BLOOD_MOON_DRAKAN_THRESHOLD = 900;
  // Cache loc 61215 becomes Enterable child 61217 at native stage 166–171.
  const FINAL_PORTAL = Object.freeze({ id: 61215, visibleId: 61217, x: 3703, y: 3185, z: 0 });
  const FINAL_CASTLE_ARRIVAL = Object.freeze({ x: 2507, y: 7383, z: 0 });
  const FINAL_GRAVEYARD_AFTER_FIGHT = Object.freeze({ x: 3731, y: 3220, z: 0 });
  const FINAL_EFARITAY_TILE = Object.freeze({ x: 3706, y: 3211, z: 0 });
  // The stage-164 graveyard Efaritay is the captured 3700,3185 actor; the
  // post-fight 174 scene keeps its own 3706,3211 cutscene tiles.
  const FINAL_EFARITAY_GRAVEYARD_TILE = Object.freeze({ x: 3700, y: 3185, z: 0 });
  // RSProx: the gathering threshold conversation ends at the castle landing with
  // Ivan 15852 (transform parent of 15855) waiting beside the player.
  const GATHERING_CASTLE_LANDING = Object.freeze({ x: 2846, y: 7391, z: 0 });
  const GATHERING_CASTLE_IVAN = Object.freeze({ id: 15852, x: 2845, y: 7387, z: 0 });
  const GATHERING_CASTLE_SUGADINTI = Object.freeze({ id: 15957, x: 2846, y: 7389, z: 0 });
  // Cache loc 61764 becomes child 61765 (Take-supplies) during native stages 168–170.
  const FINAL_DRAKAN_SUPPLY_CHEST = Object.freeze({ id: 61764, x: 2503, y: 7386, z: 0 });
  // Cache DB row 16873: vampyrium_consumable_shop (omnishop_main 819 / side 806).
  const FINAL_SUPPLY_SHOP_ROW = 16873;
  const FINAL_DRAKAN_ROOF_DOOR = Object.freeze({ id: 61628, x: 2506, y: 7387, z: 0 });
  const FINAL_DRAKAN_WAVES = Object.freeze([
    "left", "right", "north", "left", "right", "left", "north", "pincer",
    "left", "right", "north", "left", "right", "left", "north", "pincer",
    "left", "north", "right",
  ]);
  // Animation ids and sequence names are from the captured final Lowerniel encounter.
  const FINAL_DRAKAN_ANIM = Object.freeze({
    melee: 14309, magic: 14311, phaseOut: 14315, phaseIn: 14316,
    thrustTelegraph: 14327, sweepTelegraph: 14333,
  });
  const SIEGE_DRAKAN_AREA_ATTRIBUTE = "quest.the_blood_moon_rises.siege-drakan-area";
  const SIEGE_DRAKAN_COMPLETE = "quest.the_blood_moon_rises.siege-drakan-defeated";
  const SIEGE_DEFENCE_ATTRIBUTE = "quest.the_blood_moon_rises.siege-defence";
  const TOB_CHALLENGE_ATTRIBUTE = "quest.the_blood_moon_rises.tob-challenge";
  const THEATRE_NATIVE_STAGE_ATTRIBUTE = "quest.the_blood_moon_rises.theatre-native-stage";
  const PREP_COMPLETE = "quest.the_blood_moon_rises.preparations-complete";
  const wyrdEncounters = new Map();
  const slepeIvans = new Map();
  const slepeRoys = new Map();
  const paterdomusIvans = new Map();
  const slepeManors = new Map();
  const drakanEncounters = new Map();
  const finalEfaritays = new Map();
  const postQuestEfaritays = new Map();
  const finalCutsceneActors = new Map();
  const siegeDrakanEncounters = new Map();
  const siegeAranei = new Map();
  const theatreActors = new Map();
  const gatheringCastleIvans = new Map();
  const gatheringCastleSugadintis = new Map();
  function preparationStoryReady(player) {
    const prep = player?.getAttribute(PREP_ATTRIBUTE) ?? {};
    return prep.introComplete && prep.stewFed && prep.safalaanAnswered && prep.preparationsDiscussed &&
      prep.flail && prep.stakes && prep.stakesConversationComplete && prep.veliafFirstTalkComplete &&
      prep.vanesculaTalkComplete && prep.veliafFollowupComplete;
  }
  function preparationReady(player) {
    return preparationStoryReady(player) && Boolean(player?.getAttribute(PREP_ATTRIBUTE)?.sugadintiReady) &&
      (hasItem(player, PREP.flail) || player?.getEquipment?.()?.contains?.(PREP.flail)) && hasItem(player, PREP.stakes);
  }

  // Publish Quest Helper's captured hideout/preparation sub-progress from the
  // state the quest already models. No stage or hint progress is forced.
  function publishHelperVarbits(player) {
    if (!player) return;
    const sender = player.getPacketSender?.();
    if (typeof sender?.sendVarbit !== "function") return;
    const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
    const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    const refineryProgress = refinery.progress(player);
    const ivanProgress = prep.sugadintiReady || prep.veliafFollowupComplete ||
      prep.vanesculaTalkComplete || prep.veliafFirstTalkComplete || prep.ivanStakesComplete ? 3
      : prep.stakes ? 2 : prep.stakesConversationComplete ? 1 : 0;
    const veliafProgress = prep.veliafFollowupComplete ? 3
      : prep.vanesculaTalkComplete ? 2 : prep.veliafFirstTalkComplete ? 1 : 0;
    const inVampyrium = isInVampyriumRealm(player);
    sender.sendVarbit(IVAN_GIVEN_PICKAXE_VARBIT, refineryProgress.borrowedPickaxe ? 1 : 0);
    sender.sendVarbit(IVAN_HIDEOUT_PROGRESS_VARBIT, ivanProgress);
    sender.sendVarbit(VELIAF_HIDEOUT_PROGRESS_VARBIT, veliafProgress);
    sender.sendVarbit(SANGVESTI_SUPPLY_WARNING_VARBIT, hunt.suppliesClaimed ? 1 : 0);
    sender.sendVarbit(IN_VAMPYRIUM_VARBIT, inVampyrium ? 1 : 0);
  }

  function publishHelperVarbitsOnLogin({ player } = {}) {
    publishHelperVarbits(player);
  }

  function publishHelperVarbitsOnStageChange({ player } = {}) {
    publishHelperVarbits(player);
  }
  const hideoutDefense = require("../bmr/HideoutDefense.TheBloodMoonRises")({ api, stage: player => stage(player),
    hideoutStage: STAGE.HIDEOUT,
    complete: (player, npcId) => startTranscript(api, player, npcId, PAGE, "starting-out-escaping-the-vampyres") });
  const CHAPTERS = [
    [STAGE.STARTED, "starting-out"],
    [STAGE.HIDEOUT, "starting-out-in-the-myreque-hideout"],
    [STAGE.RETURNED, "starting-out"],
    [STAGE.SLEPE, "the-truth-hurtz"],
    [STAGE.CASTLE, "escape-from-castle-drakan"],
    [STAGE.ESCAPE, "blood-hunt"],
    [STAGE.BLOOD_HUNT, "blood-hunt"],
    [STAGE.PREPARATIONS, "hallowed-preparations"],
    [STAGE.SIEGE, "drakan-s-siege"],
    [STAGE.THEATRE, "another-night-at-the-theatre"],
    [STAGE.WYRDS, "fighting-wyrds"],
    [STAGE.FINAL, "night-of-the-blood-moon"],
  ];
  const REQUIRED_QUESTS = [
    ["sins_of_the_father", "Sins of the Father"],
    ["a_night_at_the_theatre", "A Night at the Theatre"],
  ];
  const REQUIRED_SKILLS = [
    [Skill.SLAYER, 74, "Slayer"], [Skill.WOODCUTTING, 74, "Woodcutting"],
    [Skill.SMITHING, 72, "Smithing"], [Skill.COOKING, 72, "Cooking"],
    [Skill.FLETCHING, 70, "Fletching"], [Skill.MINING, 66, "Mining"],
    [Skill.HUNTER, 65, "Hunter"], [Skill.CRAFTING, 64, "Crafting"],
    [Skill.HERBLORE, 64, "Herblore"], [Skill.MAGIC, 57, "Magic"],
  ];
  let quest;

  // Private ground-floor fight. As in the other quest fights, the area is at the live temple
  // coordinates: entering it drops the main-world 3484/3485 morphs from the owner's NPC view
  // and exposes only the battle actors. The front-door threshold is included so stepping back
  // one tile does not end the fight.
  class PaterdomusBattleArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(3408, 3418, 3483, 3494, 0)]);
      this.owner = owner;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) return attackerHere && targetHere;
      return null;
    }
  }

  class WyrdEncounterArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(2944, 3007, 7424, 7487, 0)]);
      this.owner = owner;
    }

    isMulti() { return true; }

    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) return attackerHere && targetHere;
      return null;
    }

    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) wyrdEncounters.delete(this);
    }

    process(mobile) {
      if (!mobile?.isNpc?.()) return;
      const encounter = wyrdEncounters.get(this);
      if (!encounter || mobile !== encounter.boss || encounter.finished) return;
      if (mobile.getHitpoints() <= 0 && !encounter.pendingEnding) return;
      const now = World.getProcessCycle();
      if (encounter.lastCycle === now) return;
      encounter.lastCycle = now;
      mobile.setScriptedMovement(true);
      mobile.getCombat().getLastAttack().reset();
      const player = encounter.player;
      if (player.getArea?.() !== this || player.getHitpoints() <= 0) return;
      // The Wyrd breaks free several dialogue lines before the opening scene
      // ends. Keep the encounter dormant until the player's final line lands.
      if (!encounter.introComplete) return;

      // Never start or consume a threshold while another conversation owns the
      // chatbox: actual QA shows a walk/attack click cancelling the mandatory
      // 10% scene when it was started underneath the intro.
      if (player.getDialogueManager?.()?.isActive?.()) return;
      if (encounter.pendingEnding || encounter.ending) {
        // The 10% scene is mandatory. If a movement/attack cancelled its chatbox
        // before dJZbqF advanced the chapter, reopen it on the next free tick.
        if (stage(player) === STAGE.WYRDS) startWyrdEnding(encounter);
        return;
      }
      const hpPercent = mobile.getHitpoints() / mobile.getMaxHitpoints();
      const threshold = hpPercent <= 0.1 ? 10 : hpPercent <= 0.5 ? 50 : hpPercent <= 0.8 ? 80 : 0;
      if (threshold === 10) {
        startWyrdEnding(encounter);
        return;
      }
      if (threshold && !encounter.thresholdsSeen.has(threshold) &&
        startTranscript(api, player, mobile.getId(), PAGE, `fighting-wyrds-upon-reaching-${threshold}-hp`)) {
        encounter.thresholdsSeen.add(threshold);
        return;
      }

      const loc = player.getLocation();
      const px = loc.getX();
      const py = loc.getY();
      const bx = mobile.getLocation().getX();
      const by = mobile.getLocation().getY();
      const meleeDistance = Math.max(0, bx - px, px - (bx + 2), by - py, py - (by + 2));
      const protection = player.getPrayerActive?.() ?? [];
      const overheadActive = [PrayerHandler.PROTECT_FROM_MAGIC, PrayerHandler.PROTECT_FROM_MISSILES,
        PrayerHandler.PROTECT_FROM_MELEE].some((id) => protection[id] === true);
      const inPools = encounter.poolTiles?.has(`${px},${py}`) === true;

      // Bloody screech pools remain hazardous until the blast clears them. A player
      // who stands on one is hit every cycle, matching the fast repeat damage in-game.
      if (inPools) wyrdDamage(player, mobile, 10 + Math.floor(Math.random() * 11));
      if (encounter.bloodyBlast) {
        const separation = Math.max(0, bx - px, px - (bx + 2), by - py, py - (by + 2));
        if (separation <= encounter.blastRadius) wyrdDamage(player, mobile, 6 + Math.floor(Math.random() * 9));
        if (now >= encounter.blastEndsAt) {
          clearWyrdPools(encounter, false);
          encounter.bloodyBlast = false;
          player.sendMessage("The lightning subsides. The blood pools evaporate.");
        } else {
          encounter.blastRadius = Math.min(7, encounter.blastRadius + 1);
          clearWyrdLightningLane(encounter, player);
        }
      }

      if (encounter.impactAt && now >= encounter.impactAt) {
        const warning = encounter.warning;
        encounter.impactAt = 0;
        encounter.warning = null;
        if (warning === "screech" || warning === "bloody-screech") {
          if (overheadActive) {
            let damage = 15 + Math.floor(Math.random() * 6);
            if (hasWyrdEarProtection(player)) damage = Math.ceil(damage / 2);
            wyrdDamage(player, mobile, damage);
            player.sendMessage("The Wyrd's screech disrupts your concentration!");
            player.getCombat()?.setAttackDelay?.(3);
          } else player.sendMessage("You avoid the Wyrd's screech by keeping your protection prayers off.");
          if (warning === "bloody-screech") {
            encounter.bloodyBlast = true;
            encounter.blastRadius = 0;
            encounter.blastEndsAt = now + 10;
            player.sendMessage("A blast of energy bursts from the Wyrd. Run clear of the blood pools; the lightning will destroy some of them.");
          }
          encounter.nextAttackAt = now + 3;
          return;
        }
        if (warning === "slam") {
          wyrdSlam(encounter, encounter.slamSide);
          encounter.slamCount++;
          if (encounter.slamCount < 2) {
            encounter.impactAt = now + 2;
            encounter.warning = "slam";
            mobile.performAnimation(new Animation(14022));
            return;
          }
          encounter.slamCount = 0;
          encounter.sequenceStep = 0;
          encounter.meleeMode = null;
          encounter.nextAttackAt = now + 3;
          return;
        }
      }
      // The quick guide notes that keeping outside melee range prevents the
      // Wyrd's specials; it switches to unprayerable magic attacks (max hit 25).
      // Use the distance from the full 3x3 footprint, not its south-west anchor.
      if (!encounter.impactAt && !encounter.bloodyBlast && encounter.meleeMode == null) {
        encounter.meleeMode = meleeDistance <= 1;
      }
      if (!encounter.impactAt && !encounter.bloodyBlast && encounter.meleeMode === false && meleeDistance <= 1) {
        encounter.meleeMode = true;
      }
      if (!encounter.impactAt && !encounter.bloodyBlast && encounter.meleeMode === false) {
        if (now >= encounter.nextAttackAt) {
          encounter.nextAttackAt = now + 5;
          mobile.performAnimation(new Animation(14020));
          queueWyrdCombatHit(encounter, api.core.CombatType.MAGIC, 25);
          player.sendMessage("The Wyrd hurls a magic burst at you. Protection prayers cannot stop it.");
        }
        return;
      }
      if (encounter.impactAt || encounter.bloodyBlast || now < encounter.nextAttackAt) return;

      const step = encounter.sequenceStep;
      encounter.sequenceStep++;
      encounter.nextAttackAt = now + 5;
      if (step === 0 || step === 1 || step === 3 || step === 4) {
        const rightArm = step === 0 || step === 3;
        mobile.performAnimation(new Animation(rightArm ? 14018 : 14019));
        const meleeProtected = protection[PrayerHandler.PROTECT_FROM_MELEE] === true;
        queueWyrdCombatHit(encounter, api.core.CombatType.MELEE, 30, meleeProtected ? 1 / 3 : 1);
        const dx = Math.sign(px - (bx + 1));
        const dy = Math.sign(py - (by + 1));
        const wasPushed = stepPlayerBack(player, dx, dy);
        if (!wasPushed) {
          // The guide describes a small recoil when the knockback tile is blocked,
          // without publishing an exact amount; keep it below the normal hit range.
          wyrdDamage(player, mobile, 5 + Math.floor(Math.random() * 6));
          player.sendMessage("There is nowhere to move back, and the punch's recoil hurts you.");
        }
        player.sendMessage("The Wyrd punches you and knocks you back a tile.");
        return;
      }
      if (step === 2 || step === 5) {
        const bloody = hpPercent <= 0.6 && Math.random() < 0.5;
        encounter.warning = bloody ? "bloody-screech" : "screech";
        encounter.impactAt = now + (bloody ? 5 : 2);
        if (bloody) spawnWyrdPools(encounter);
        mobile.performAnimation(new Animation(bloody ? 14025 : 14023));
        player.sendMessage(bloody
          ? "The Wyrd gathers blood around itself and begins a bloody screech. Turn off protection prayers and run from the pools."
          : "The Wyrd draws breath for a screech. Turn off all protection prayers before it lands.");
        return;
      }

      encounter.sequenceStep = 0;
      encounter.slamCount = 0;
      encounter.slamSide = Math.random() < 0.5 ? "left" : "right";
      mobile.performAnimation(new Animation(14021));
      mobile.forceChat?.(encounter.slamSide === "left" ? "Argh!" : "Grah!");
      encounter.impactAt = now + 3;
      encounter.warning = "slam";
      player.sendMessage(`The Wyrd's ${encounter.slamSide} arm signals the double slam. Move to the opposite side.`);
    }
  }

  function wyrdDamage(player, source, damage) {
    if (damage <= 0) return;
    player.getCombat().getHitQueue().addPendingDamage([
      new HitDamage(damage, HitMask.RED).setSource(source),
    ]);
  }

  function allowWyrdHitThroughPrayer(event) {
    const { attacker, target } = event ?? {};
    const area = attacker?.getArea?.();
    const encounter = area && wyrdEncounters.get(area);
    if (encounter?.boss === attacker && encounter.player === target) event.bypassProtectionPrayer = true;
  }

  function queueWyrdCombatHit(encounter, type, maxDamage, multiplier = 1) {
    const method = type === api.core.CombatType.MAGIC
      ? api.core.CombatFactory.MAGIC_COMBAT
      : api.core.CombatFactory.MELEE_COMBAT;
    const hit = method.hits(encounter.boss, encounter.player)[0];
    if (!hit) return;
    hit.setTotalDamage(Math.floor(Math.min(maxDamage, hit.getTotalDamage()) * multiplier));
    api.core.CombatFactory.addPendingHit(hit);
  }

  function handleWyrdPlayerBeforeDeath(event) {
    const player = event?.player;
    const area = player?.getAttribute?.(WYRD_AREA_ATTRIBUTE);
    const encounter = area && wyrdEncounters.get(area);
    if (!encounter || encounter.player !== player || encounter.finished) return;
    // Wiki: death in the Wyrd fight returns the player outside with all items intact.
    event.preventDeath = true;
    encounter.finished = true;
    clearWyrdPools(encounter, false);
    api.removeNpc(encounter.boss);
    player.getCombat()?.getHitQueue?.().clear?.();
    Scenes.controls(player, false);
    area.leave(player, false);
    wyrdEncounters.delete(area);
    player.setAttribute(WYRD_AREA_ATTRIBUTE, null);
    player.setHitpoints(player.getSkillManager().getMaxLevel(api.core.Skill.HITPOINTS));
    player.moveTo(new Location(3506, 9838, 0));
    player.sendMessage("The Wyrd knocks you unconscious. You wake outside the laboratory with your belongings intact.");
  }

  function hasWyrdEarProtection(player) {
    const head = player.getEquipment?.()?.get?.(Equipment.HEAD_SLOT)?.getId?.();
    return Object.entries(ItemIdentifiers).some(([name, id]) =>
      id === head && (name.includes("EARMUFFS") || name.includes("SLAYER_HELMET")));
  }

  function stepPlayerBack(player, dx, dy) {
    if (!dx && !dy) dy = -1;
    const queue = player.getMovementQueue?.();
    if (!queue?.canWalk?.(dx, dy)) return false;
    queue.walkStep(dx, dy);
    return true;
  }

  function sendWyrdGraphic(player, id, x, y, z) {
    player.getPacketSender?.()?.sendGraphic?.(new Graphic(id), new Location(x, y, z));
  }

  function spawnWyrdPools(encounter) {
    const { boss, player } = encounter;
    const bx = boss.getLocation().getX();
    const by = boss.getLocation().getY();
    const z = boss.getLocation().getZ();
    encounter.poolTiles = new Set();
    // Five visible layers surround the Wyrd; the two-tile gap keeps the
    // footprint and its immediately adjacent attack tiles clear.
    for (let radius = 2; radius <= 6; radius++) {
      const minX = bx - radius;
      const maxX = bx + 2 + radius;
      const minY = by - radius;
      const maxY = by + 2 + radius;
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (x !== minX && x !== maxX && y !== minY && y !== maxY) continue;
          const key = `${x},${y}`;
          encounter.poolTiles.add(key);
          sendWyrdGraphic(player, 3856, x, y, z);
        }
      }
    }
  }

  function clearWyrdLightningLane(encounter, player) {
    const { boss } = encounter;
    const bx = boss.getLocation().getX();
    const by = boss.getLocation().getY();
    const z = boss.getLocation().getZ();
    const px = player.getLocation().getX();
    const py = player.getLocation().getY();
    // The lightning opens a lane away from the player's side of the Wyrd,
    // which is the escape route shown in the quest guide's bloody-screech clip.
    const dx = Math.sign(px - (bx + 1));
    const dy = Math.sign(py - (by + 1));
    for (let step = 2; step <= 6; step++) {
      const x = Math.abs(px - (bx + 1)) >= Math.abs(py - (by + 1))
        ? (dx < 0 ? bx - step : bx + 2 + step) : bx + 1;
      const y = Math.abs(px - (bx + 1)) >= Math.abs(py - (by + 1))
        ? by + 1 : (dy < 0 ? by - step : by + 2 + step);
      const key = `${x},${y}`;
      if (!encounter.poolTiles.delete(key)) continue;
      sendWyrdGraphic(player, 3861, x, y, z);
    }
  }

  function clearWyrdPools(encounter, animate = true) {
    if (!encounter.poolTiles) return;
    const z = encounter.boss.getLocation().getZ();
    for (const tile of encounter.poolTiles) {
      const [x, y] = tile.split(",").map(Number);
      if (animate) sendWyrdGraphic(encounter.player, 3860, x, y, z);
    }
    encounter.poolTiles.clear();
  }

  function wyrdSlam(encounter, side) {
    const { boss, player } = encounter;
    const bx = boss.getLocation().getX();
    const by = boss.getLocation().getY();
    const loc = player.getLocation();
    const px = loc.getX();
    const py = loc.getY();
    // Each arm sends a short wave down its side of the Wyrd's 3x3 footprint.
    const caught = side === "left"
      ? px >= bx - 3 && px <= bx - 1 && py >= by - 2 && py <= by + 4
      : px >= bx + 3 && px <= bx + 5 && py >= by - 2 && py <= by + 4;
    if (caught) wyrdDamage(player, boss, 25 + Math.floor(Math.random() * 6));
    else player.sendMessage("The Wyrd's slam wave tears through the opposite side of the room.");
  }

  class SlepeManorArea extends PrivateArea {
    constructor(player) {
      // The map's Crombwick Manor floor is at z=1, with its cache staircase at
      // (3725,3353,0). Each quest player gets their own Vyrewatch and kill state.
      super([new Boundary(3713, 3735, 3352, 3372, 1)]);
      this.player = player;
      this.enemies = [];
      this.storyActors = [];
      this.finished = false;
    }

    isMulti() { return true; }

    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) return attackerHere && targetHere;
      return null;
    }

    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (mobile !== this.player) return;
      for (const npc of [...this.enemies, ...this.storyActors]) if (npc) api.removeNpc(npc);
      if (slepeManors.get(mobile) === this) slepeManors.delete(mobile);
    }
  }

  class DrakanEncounterArea extends PrivateArea {
    constructor(owner, mode = "final") {
      super([mode === "first-blood"
        ? new Boundary(FIRST_BLOOD_ARENA.minX, FIRST_BLOOD_ARENA.maxX,
          FIRST_BLOOD_ARENA.minY, FIRST_BLOOD_ARENA.maxY, FIRST_BLOOD_ARENA.z)
        : new Boundary(2495, 2514, 7823, 7853, 3)]);
      this.owner = owner;
      this.mode = mode;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) return attackerHere && targetHere;
      return null;
    }
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) drakanEncounters.delete(this);
    }
    animate(fight, animation) {
      fight.boss.performAnimation?.(new api.core.Animation(animation));
    }
    process(mobile) {
      if (!mobile?.isNpc?.()) return;
      const fight = drakanEncounters.get(this);
      if (!fight || mobile !== fight.boss || fight.finished || mobile.getHitpoints() <= 0) return;
      const now = World.getProcessCycle();
      if (fight.lastCycle === now) return;
      fight.lastCycle = now;
      if (fight.mode !== "first-blood") mobile.setScriptedMovement(true);
      mobile.getCombat().getLastAttack().reset();
      const player = fight.player;
      if (player.getArea?.() !== this || player.getHitpoints() <= 0 || fight.ending) return;
      if (fight.mode === "first-blood") {
        if (mobile.getHitpoints() <= fight.thresholdHp && !fight.thresholdStarted) {
          fight.thresholdStarted = true;
          fight.ending = true;
          const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
          player.setAttribute(HUNT_ATTRIBUTE, { ...hunt, firstBloodThresholdReached: true, nativeStage: 92 });
          player.getPacketSender()?.sendVarbit?.(15464, 92);
          startTranscript(api, player, mobile.getId(), PAGE,
            "blood-hunt-after-dealing-enough-damage-to-lowerniel");
          return;
        }
        this.processFirstBloodLunges(fight, player, mobile, now);
        return;
      }
      const hp = mobile.getHitpoints();
      const phase = hp <= 900 ? 3 : hp <= 2100 ? 2 : 1;
      if (phase > fight.phase) {
        fight.phase = phase;
        fight.attackIndex = 0;
        fight.warning = null;
        fight.impactAt = 0;
        if (phase === 2) {
          fight.special = "waves";
          fight.waveIndex = 0;
          fight.waveCycles = 1;
          this.warnForBloodWave(fight, player, now);
        } else {
          fight.special = "lunges";
          fight.lungeIndex = 0;
          fight.lungeCycles = 0;
          this.warnForLunge(fight, player, now);
        }
        return;
      }
      if (fight.special === "waves") {
        this.processBloodWaves(fight, player, mobile, now);
        return;
      }
      if (fight.special === "blood-strikes" || fight.special === "wave-followup") {
        if (fight.phase === 2) this.processBloodWaves(fight, player, mobile, now);
        else this.processLunges(fight, player, mobile, now);
        return;
      }
      if (fight.special === "lunges") {
        this.processLunges(fight, player, mobile, now);
        return;
      }
      if (fight.impactAt && now >= fight.impactAt) {
        const warning = fight.warning;
        fight.impactAt = 0;
        fight.warning = null;
        const location = player.getLocation();
        const x = location.getX();
        const y = location.getY();
        const prayers = player.getPrayerActive?.() ?? [];
        const melee = prayers[PrayerHandler.PROTECT_FROM_MELEE] === true;
        const magic = prayers[PrayerHandler.PROTECT_FROM_MAGIC] === true;
        if (warning === "thrust") {
          const distance = Math.max(Math.abs(x - fight.markedX), Math.abs(y - fight.markedY));
          if (distance === 0) this.hit(player, mobile, 30, "The spear thrust catches you. Step away when Lowerniel draws the spear back.");
          else player.sendMessage("You sidestep Lowerniel's spear thrust.");
          return;
        }
        if (warning === "blood-spear") {
          if (!magic) this.hit(player, mobile, 32, "The blood spear strikes you. Protect from Magic when he fires it.");
          else player.sendMessage("Your Protect from Magic prayer turns aside the blood spear.");
          return;
        }
        if (warning === "front-back") {
          if (x === fight.markedX) this.hit(player, mobile, 36, "The blood burst catches you in front or behind Lowerniel. Move to his side.");
          else player.sendMessage("You move to the side and avoid the blood burst.");
          return;
        }
        if (warning === "semicircle") {
          const distance = Math.max(Math.abs(x - fight.markedX), Math.abs(y - fight.markedY));
          if (distance <= 2) this.hit(player, mobile, 28, "The spear's semicircular sweep catches you. Move beyond its arc.");
          else player.sendMessage("You move clear of Lowerniel's spear sweep.");
          return;
        }
        if (warning === "melee") {
          if (!melee) this.hit(player, mobile, 7 + Math.floor(Math.random() * 10), "Lowerniel's melee strike lands.");
          return;
        }
        if (warning === "pool" || warning === "lightning") {
          const distance = Math.max(Math.abs(x - fight.markedX), Math.abs(y - fight.markedY));
          if (distance <= 1) {
            player.sendMessage(warning === "pool"
              ? "The blood pool bursts beneath you and disables your overhead prayers."
              : "Lightning strikes beside you and disables your overhead prayers.");
            this.hit(player, mobile, warning === "pool" ? 24 : 18, "");
            PrayerHandler.deactivatePrayers(player);
          } else player.sendMessage("You move clear of the blood and lightning hazard.");
          return;
        }
      }
      if (fight.impactAt || now < fight.nextAttackAt) return;
      fight.nextAttackAt = now + (fight.phase === 1 ? 5 : 4);
      fight.attackIndex++;
      const loc = player.getLocation();
      if (fight.phase === 3 && fight.attackIndex % 3 === 0) {
        fight.warning = fight.attackIndex % 2 === 0 ? "pool" : "lightning";
        fight.markedX = loc.getX();
        fight.markedY = loc.getY();
        fight.impactAt = now + 2;
        if (fight.warning === "pool") {
          player.getPacketSender?.()?.sendGraphic?.(new api.core.Graphic(3856),
            new Location(fight.markedX, fight.markedY, 3));
          player.sendMessage("A blood pool opens beneath you. Move clear before it erupts.");
        } else {
          player.getPacketSender?.()?.sendGraphic?.(new api.core.Graphic(3881),
            new Location(fight.markedX, fight.markedY, 3));
          player.sendMessage("A dark shadow marks a lightning strike. Move clear and watch your overhead prayer.");
        }
      } else if (fight.attackIndex % 5 === 1) {
        fight.warning = "thrust"; fight.markedX = loc.getX(); fight.markedY = loc.getY(); fight.impactAt = now + 2;
        this.animate(fight, FINAL_DRAKAN_ANIM.thrustTelegraph);
        player.sendMessage("Lowerniel draws his spear back and lines up a thrust. Step at least one tile aside.");
      } else if (fight.attackIndex % 5 === 2) {
        fight.warning = "blood-spear"; fight.impactAt = now + 2;
        this.animate(fight, FINAL_DRAKAN_ANIM.magic);
        player.sendMessage("Lowerniel fires a blood spear. Protect from Magic before it lands.");
      } else if (fight.attackIndex % 5 === 3) {
        fight.warning = "front-back"; fight.markedX = loc.getX(); fight.markedY = loc.getY(); fight.impactAt = now + 2;
        this.animate(fight, FINAL_DRAKAN_ANIM.sweepTelegraph);
        player.sendMessage("Blood gathers in front of and behind Lowerniel. Move to either side before it bursts.");
      } else if (fight.attackIndex % 5 === 4) {
        fight.warning = "semicircle"; fight.markedX = loc.getX(); fight.markedY = loc.getY(); fight.impactAt = now + 5;
        this.animate(fight, FINAL_DRAKAN_ANIM.sweepTelegraph);
        player.sendMessage("Lowerniel sweeps his spear in an arc. Move around him to the opposite side.");
      } else {
        fight.warning = "melee"; fight.impactAt = now + 1;
        this.animate(fight, FINAL_DRAKAN_ANIM.melee);
        player.sendMessage("Lowerniel closes in with a melee strike. Protect from Melee.");
      }
    }
    warnForBloodWave(fight, player, now) {
      const direction = FINAL_DRAKAN_WAVES[fight.waveIndex];
      const loc = player.getLocation();
      fight.warning = "blood-wave";
      fight.waveDirection = direction;
      fight.markedX = loc.getX();
      fight.markedY = loc.getY();
      fight.impactAt = now + 3;
      this.animate(fight, FINAL_DRAKAN_ANIM.phaseOut);
      player.sendMessage(direction === "pincer"
        ? "Blood portals open on both sides. Run straight north or south through the walls of blood."
        : `A wall of blood surges from the ${direction}. Run straight toward it and cross its path by four tiles.`);
    }
    // Wiki: the player must dodge 3–5 lunges by stepping back onto the sparkling side.
    // shortcut: use three lunges and a two-tick response window until a First Blood capture calibrates timing.
    processFirstBloodLunges(fight, player, boss, now) {
      if (fight.warning === "first-blood-lunge" && fight.impactAt && now >= fight.impactAt) {
        const loc = player.getLocation();
        const dodged = loc.getX() === fight.safeX && loc.getY() === fight.safeY;
        fight.impactAt = 0;
        fight.warning = null;
        if (dodged) {
          fight.lungesDodged++;
          player.sendMessage(`You roll onto the marked safe tile. ${fight.lungesDodged} spear lunges dodged.`);
        } else {
          const protectedFromMelee = (player.getPrayerActive?.() ?? [])[PrayerHandler.PROTECT_FROM_MELEE] === true;
          this.hit(player, boss, protectedFromMelee ? 9 : 28,
            "The spear lunge catches you. Protect from Melee and move to the marked safe tile.");
        }
        fight.lungeIndex++;
        if (!fight.damageUnlocked && fight.lungesDodged >= 3) {
          fight.damageUnlocked = true;
          boss.setFlag?.("combat:no-retaliate", false);
          boss.getCombat?.()?.attack?.(player);
          player.sendMessage("After three clean lunges, Lowerniel turns his attention to you. You can now strike him.");
        } else fight.nextAttackAt = now + 2;
        return;
      }
      if (fight.impactAt || now < fight.nextAttackAt) return;
      const playerLoc = player.getLocation();
      const bossLoc = boss.getLocation();
      let awayX = Math.sign(playerLoc.getX() - (bossLoc.getX() + 1));
      let awayY = Math.sign(playerLoc.getY() - (bossLoc.getY() + 1));
      if (!awayX && !awayY) awayX = 1;
      const side = fight.lungeIndex % 2 === 0 ? 1 : -1;
      const perpendicular = [-awayY * side, awayX * side];
      const preferred = [
        [awayX + perpendicular[0], awayY + perpendicular[1]],
        [awayX, awayY],
        [awayX - perpendicular[0], awayY - perpendicular[1]],
      ];
      const candidates = [...preferred, ...[
        [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
      ]].map(([dx, dy]) => [Math.sign(dx), Math.sign(dy)])
        .filter(([dx, dy], index, all) => (dx || dy) && all.findIndex(([x, y]) => x === dx && y === dy) === index)
        .filter(([dx, dy]) => dx * awayX + dy * awayY > 0);
      const region = api.core.RegionManager;
      const safe = candidates.find(([dx, dy]) => {
        const x = playerLoc.getX() + dx;
        const y = playerLoc.getY() + dy;
        if (x < FIRST_BLOOD_ARENA.minX || x > FIRST_BLOOD_ARENA.maxX ||
            y < FIRST_BLOOD_ARENA.minY || y > FIRST_BLOOD_ARENA.maxY) return false;
        const tile = new Location(x, y, FIRST_BLOOD_ARENA.z);
        return !region.blocked(tile, fight.area) && region.canMove(
          playerLoc.getX(), playerLoc.getY(), x, y, FIRST_BLOOD_ARENA.z, 1, 1, fight.area);
      });
      if (!safe) {
        fight.nextAttackAt = now + 1;
        return;
      }
      const [dx, dy] = safe;
      fight.safeX = playerLoc.getX() + dx;
      fight.safeY = playerLoc.getY() + dy;
      fight.markedX = playerLoc.getX();
      fight.markedY = playerLoc.getY();
      fight.warning = "first-blood-lunge";
      fight.impactAt = now + 2;
      this.animate(fight, FINAL_DRAKAN_ANIM.thrustTelegraph);
      const direction = `${dy < 0 ? "south" : dy > 0 ? "north" : ""}${dx && dy ? "-" : ""}${dx < 0 ? "west" : dx > 0 ? "east" : ""}`;
      if (boss.getHitpoints() > 2900) {
        const cross = awayX * dy - awayY * dx;
        const graphicId = cross >= 0 ? FIRST_BLOOD_SAFE_TILE_GRAPHIC.left : FIRST_BLOOD_SAFE_TILE_GRAPHIC.right;
        player.getPacketSender?.()?.sendGraphic?.(new api.core.Graphic(graphicId),
          new Location(fight.safeX, fight.safeY, FIRST_BLOOD_ARENA.z));
        player.sendMessage(`Lowerniel marks the spear strike. A sparkling safe tile appears to the ${direction}; step onto its mark before the lunge lands.`);
      } else {
        // Wiki: the sparkles disappear once the encounter passes 2,900 HP; the boss thrust animation remains the cue.
        player.sendMessage(`Lowerniel's spear telegraph points ${direction}. Roll to that side before the lunge lands.`);
      }
    }
    processBloodWaves(fight, player, boss, now) {
      if (fight.special === "waves" && fight.impactAt && now >= fight.impactAt) {
        const direction = fight.waveDirection;
        const dx = player.getLocation().getX() - fight.markedX;
        const dy = player.getLocation().getY() - fight.markedY;
        const crossed = direction === "pincer" ? Math.abs(dy) >= 4 && Math.abs(dx) <= 1
          : direction === "north" ? dy >= 4 && Math.abs(dx) <= 1
            : direction === "left" ? dx <= -4 && Math.abs(dy) <= 1
              : dx >= 4 && Math.abs(dy) <= 1;
        fight.impactAt = 0;
        fight.warning = null;
        if (!crossed) {
          player.sendMessage("The blood wave crashes into you and disables your overhead prayers.");
          this.hit(player, boss, 24, "");
          PrayerHandler.deactivatePrayers(player);
        } else player.sendMessage("You run through the blood wave and escape its force.");
        fight.waveIndex++;
        if (fight.waveIndex >= FINAL_DRAKAN_WAVES.length) {
          fight.special = "blood-strikes";
          fight.warning = "blood-strikes";
          fight.impactAt = now + 3;
          this.animate(fight, FINAL_DRAKAN_ANIM.phaseIn);
          player.sendMessage("Lowerniel reappears and hurls four blood strikes. Protect from Magic before they land.");
        } else fight.nextAttackAt = now + 1;
        return;
      }
      if (fight.special === "blood-strikes" && fight.impactAt && now >= fight.impactAt) {
        const magic = (player.getPrayerActive?.() ?? [])[PrayerHandler.PROTECT_FROM_MAGIC] === true;
        if (!magic) this.hit(player, boss, 96, "The four blood strikes crash into you.");
        else player.sendMessage("Protect from Magic blocks Lowerniel's blood strikes.");
        fight.special = "wave-followup";
        fight.warning = null;
        const loc = player.getLocation();
        fight.markedX = loc.getX();
        fight.markedY = loc.getY();
        fight.impactAt = now + 3;
        player.sendMessage("Lowerniel rushes in with a spear combo. Dodge to his side to break the wave sequence.");
        return;
      }
      if (fight.special === "wave-followup" && fight.impactAt && now >= fight.impactAt) {
        const dx = player.getLocation().getX() - fight.markedX;
        const dy = player.getLocation().getY() - fight.markedY;
        const dodged = Math.max(Math.abs(dx), Math.abs(dy)) >= 2;
        fight.impactAt = 0;
        if (dodged || fight.waveCycles >= 3) {
          if (dodged) player.sendMessage("You dodge the combo and stop the blood waves.");
          fight.special = null;
          fight.nextAttackAt = now + 3;
        } else {
          fight.waveCycles++;
          fight.waveIndex = 0;
          fight.special = "waves";
          this.warnForBloodWave(fight, player, now);
        }
        return;
      }
      if (fight.impactAt || now < fight.nextAttackAt) return;
      this.warnForBloodWave(fight, player, now);
    }
    warnForLunge(fight, player, now) {
      const directions = ["north", "east", "south", "west"];
      const direction = directions[(fight.lungeIndex + fight.lungeCycles) % directions.length];
      const loc = player.getLocation();
      fight.warning = "lunge-appearances";
      fight.lungeRolled = false;
      fight.lungeDirection = direction;
      fight.lungeCueIndex = 0;
      fight.markedX = loc.getX();
      fight.markedY = loc.getY();
      fight.impactAt = now + 1;
      this.animate(fight, FINAL_DRAKAN_ANIM.phaseIn);
      player.sendMessage(`Lowerniel appears briefly to your ${direction}, turning as he lines up a lunge.`);
    }
    processLunges(fight, player, boss, now) {
      if (fight.special === "lunges" && fight.warning === "lunge-appearances" &&
        fight.impactAt && now >= fight.impactAt) {
        const directions = ["north", "east", "south", "west"];
        fight.lungeCueIndex++;
        if (fight.lungeCueIndex < 3) {
          fight.lungeDirection = directions[(fight.lungeIndex + fight.lungeCycles + fight.lungeCueIndex) % directions.length];
          fight.impactAt = now + 1;
          player.sendMessage(`Lowerniel flickers to your ${fight.lungeDirection} as the lunge turns.`);
          return;
        }
        fight.warning = "lunge";
        fight.impactAt = now + 1;
        this.animate(fight, FINAL_DRAKAN_ANIM.thrustTelegraph);
        player.sendMessage(`Lowerniel settles to your ${fight.lungeDirection}. Dodge two to five tiles perpendicular to that final direction.`);
        return;
      }
      if (fight.special === "lunges" && fight.warning === "lunge" && fight.impactAt && now >= fight.impactAt) {
        const dx = player.getLocation().getX() - fight.markedX;
        const dy = player.getLocation().getY() - fight.markedY;
        const verticalAttack = fight.lungeDirection === "north" || fight.lungeDirection === "south";
        const perpendicular = verticalAttack ? Math.abs(dx) : Math.abs(dy);
        const dodged = fight.lungeRolled || (perpendicular >= 2 && perpendicular <= 5);
        fight.lungeRolled = false;
        if (!dodged) this.hit(player, boss, 28, "Lowerniel's spear lunge catches you.");
        else player.sendMessage("You roll clear of the spear lunge.");
        fight.impactAt = 0;
        fight.warning = null;
        fight.lungeIndex++;
        if (fight.lungeIndex < 4) {
          this.warnForLunge(fight, player, now + 1);
        } else {
          fight.lungeCycles++;
          fight.special = "blood-strikes";
          fight.warning = "blood-strikes";
          fight.impactAt = now + 3;
          boss.setHitpoints(Math.max(1, boss.getHitpoints() - 90));
          player.sendMessage("Lowerniel sacrifices his blood and releases four enhanced strikes. Protect from Magic.");
        }
        return;
      }
      if (fight.special === "blood-strikes" && fight.impactAt && now >= fight.impactAt) {
        if (fight.warning === "lunge-followup") {
          const dx = player.getLocation().getX() - fight.markedX;
          const dy = player.getLocation().getY() - fight.markedY;
          const dodged = Math.max(Math.abs(dx), Math.abs(dy)) >= 2;
          const melee = (player.getPrayerActive?.() ?? [])[PrayerHandler.PROTECT_FROM_MELEE] === true;
          if (!dodged) this.hit(player, boss, 30, "Lowerniel's follow-up spear combo catches you.");
          else player.sendMessage("You roll clear of Lowerniel's follow-up spear combo.");
          if (!melee) this.hit(player, boss, 12, "The unprotected melee strike lands after the combo.");
          fight.impactAt = 0;
          fight.warning = null;
          if (fight.lungeCycles >= 3) {
            fight.special = null;
            fight.nextAttackAt = now + 2;
            player.sendMessage("Lowerniel's three lunge sequences are over. He resumes close combat; avoid blood pools and lightning.");
          } else {
            fight.special = "lunges";
            fight.lungeIndex = 0;
            this.warnForLunge(fight, player, now + 2);
          }
          return;
        }
        const magic = (player.getPrayerActive?.() ?? [])[PrayerHandler.PROTECT_FROM_MAGIC] === true;
        if (!magic) this.hit(player, boss, 96, "The four enhanced blood strikes crash into you.");
        else player.sendMessage("Protect from Magic blocks the enhanced blood strikes.");
        fight.warning = "lunge-followup";
        fight.impactAt = now + 3;
        const loc = player.getLocation();
        fight.markedX = loc.getX();
        fight.markedY = loc.getY();
        player.sendMessage("Lowerniel rushes in with a spear combo. Switch to Protect from Melee and dodge to his side.");
        return;
      }
      if (fight.special !== "lunges" || fight.impactAt || now < fight.nextAttackAt) return;
      this.warnForLunge(fight, player, now);
    }
    hit(player, source, damage, message) {
      if (message) player.sendMessage(message);
      player.getCombat().getHitQueue().addPendingDamage([
        new HitDamage(damage, HitMask.RED).setSource(source),
      ]);
    }
  }

  class SiegeDrakanArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(3155, 3181, 7823, 7863, 1)]);
      this.owner = owner;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) return attackerHere && targetHere;
      return null;
    }
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) siegeDrakanEncounters.delete(this);
    }
    process(mobile) {
      if (!mobile?.isNpc?.()) return;
      const fight = siegeDrakanEncounters.get(this);
      if (!fight || mobile !== fight.boss || fight.finished || mobile.getHitpoints() <= 0) return;
      const now = World.getProcessCycle();
      if (fight.lastCycle === now) return;
      fight.lastCycle = now;
      mobile.setScriptedMovement(true);
      mobile.getCombat().getLastAttack().reset();
      const player = fight.player;
      if (player.getArea?.() !== this || player.getHitpoints() <= 0 || fight.ending) return;
      if (mobile.getHitpoints() <= fight.thresholdHp) {
        fight.ending = true;
        startTranscript(api, player, mobile.getId(), PAGE,
          "drakan-s-siege-fighting-lowerniel-upon-lowerniel-reaching-58-hp");
        return;
      }
      if (fight.impactAt && now >= fight.impactAt) {
        const warning = fight.warning;
        fight.impactAt = 0;
        fight.warning = null;
        const location = player.getLocation();
        const x = location.getX();
        const y = location.getY();
        const prayers = player.getPrayerActive?.() ?? [];
        const melee = prayers[PrayerHandler.PROTECT_FROM_MELEE] === true;
        const magic = prayers[PrayerHandler.PROTECT_FROM_MAGIC] === true;
        if (warning === "thrust") {
          const distance = Math.max(Math.abs(x - fight.markedX), Math.abs(y - fight.markedY));
          if (distance === 0) this.hit(player, mobile, 30, "The spear thrust catches you. Step aside when Lowerniel draws the spear back.");
          else player.sendMessage("You sidestep Lowerniel's spear thrust.");
          return;
        }
        if (warning === "blood-spear") {
          if (!magic) this.hit(player, mobile, 32, "The blood spear strikes you. Protect from Magic before it lands.");
          else player.sendMessage("Your Protect from Magic prayer turns aside the blood spear.");
          return;
        }
        if (warning === "front-back") {
          const distance = Math.max(Math.abs(x - fight.markedX), Math.abs(y - fight.markedY));
          if (distance <= 2 && x === fight.markedX) {
            this.hit(player, mobile, 25, "Drakan's blood burst catches you in front of him. Move to either side.");
          } else player.sendMessage("You move to the side and avoid Drakan's blood burst.");
          return;
        }
        if (warning === "melee") {
          if (!melee) this.hit(player, mobile, 7 + Math.floor(Math.random() * 10), "Lowerniel's melee strike lands.");
          return;
        }
      }
      if (fight.impactAt || now < fight.nextAttackAt) return;
      fight.nextAttackAt = now + 4;
      fight.attackIndex++;
      const loc = player.getLocation();
      if (fight.attackIndex % 4 === 1) {
        fight.warning = "thrust";
        fight.markedX = loc.getX();
        fight.markedY = loc.getY();
        fight.impactAt = now + 2;
        player.sendMessage("Lowerniel draws his spear back and lines up a thrust. Step to either side.");
      } else if (fight.attackIndex % 4 === 2) {
        fight.warning = "front-back";
        fight.markedX = loc.getX();
        fight.markedY = loc.getY();
        fight.impactAt = now + 2;
        player.sendMessage("Lowerniel gathers blood in front of and behind him. Move to one of his sides.");
      } else if (fight.attackIndex % 4 === 3) {
        fight.warning = "blood-spear";
        fight.impactAt = now + 2;
        player.sendMessage("Lowerniel fires a blood spear. Protect from Magic before it lands.");
      } else {
        fight.warning = "melee";
        fight.impactAt = now + 1;
        player.sendMessage("Lowerniel closes in with a melee strike. Protect from Melee.");
      }
    }
    hit(player, source, damage, message) {
      if (message) player.sendMessage(message);
      player.getCombat().getHitQueue().addPendingDamage([
        new HitDamage(damage, HitMask.RED).setSource(source),
      ]);
    }
  }

  function startDrakanBattle(player) {
    if (stage(player) !== STAGE.FINAL || player.getAttribute(DRAKAN_DEATH_CONFIRMED) ||
      player.getAttribute(DRAKAN_ENCOUNTER_COMPLETE)) return false;
    const existing = player.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    if (existing && existing.isDestroyed?.() !== true) return true;
    const area = new DrakanEncounterArea(player.getUsername?.());
    const boss = api.spawnNpc({ id: FINAL_DRAKAN_ID, x: 2511, y: 7838, z: 3,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) { player.sendMessage("Lowerniel could not be reached. Return to the northern chamber door."); return false; }
    boss.setMultiCombat?.(true);
    boss.setMaxHitpoints(3000);
    boss.setHitpoints(3000);
    area.enter(player);
    area.enter(boss);
    player.setAttribute(DRAKAN_AREA_ATTRIBUTE, area);
    player.moveTo(new Location(2502, 7838, 3));
    drakanEncounters.set(area, { area, boss, player, phase: 1, special: null, lastCycle: -1,
      nextAttackAt: World.getProcessCycle() + 5, attackIndex: 0, impactAt: 0, warning: null,
      markedX: 2502, markedY: 7838, waveIndex: 0, lungeIndex: 0, lungeCycles: 0,
      deathConfirmed: false, ending: false, finished: false });
    player.sendMessage("Lowerniel attacks at full strength. His spear combos require you to dodge; use Protect from Magic against his blood strikes.");
    return true;
  }

  function handleFinalDrakanDodgeRoute(event) {
    const area = event?.player?.getArea?.();
    const fight = area && drakanEncounters.get(area);
    return handleDrakanDodgeRoll(event, fight, api.core);
  }

  function openFinalSupplyShop(player) {
    if (!player || stage(player) !== STAGE.FINAL) return false;
    // The supply chest is the cache-owned vampyrium consumables omnishop. This
    // flag records that the player has checked/opened the supplies for the roof
    // warning; it never blocks opening the shop again or buying more.
    player.setAttribute(DRAKAN_SUPPLY_ATTRIBUTE, true);
    const request = { player, shop: FINAL_SUPPLY_SHOP_ROW, handled: false };
    api.emitCustomEvent("omnishop:open", request);
    return request.handled === true;
  }

  function handleFinalDrakanSupplyChest(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const ids = [event?.objectId, event?.definition?.id];
    const option = String(event?.option ?? "").toLowerCase();
    if (!player || !ids.some(id => id === FINAL_DRAKAN_SUPPLY_CHEST.id || id === 61765) ||
      x !== FINAL_DRAKAN_SUPPLY_CHEST.x || y !== FINAL_DRAKAN_SUPPLY_CHEST.y || z !== FINAL_DRAKAN_SUPPLY_CHEST.z ||
      !["search", "take-supplies"].includes(option)) return false;
    event.handled = true;
    if (quest.isComplete(player) || stage(player) !== STAGE.FINAL) {
      player.sendMessage("The chest's Vampyrium supplies are only for the final pursuit of Lowerniel.");
      return true;
    }
    if (option === "search") {
      // Captured oploc1: Search opens the two-option useful-supplies menu and
      // sets the final-fight supply warning bit before the choice is made.
      player.setAttribute(DRAKAN_SUPPLY_ATTRIBUTE, true);
      player.getPacketSender?.().sendVarbit?.(15480, 1);
      startTranscript(api, player, 0, PAGE, "night-of-the-blood-moon-searching-the-supply-chest");
      return true;
    }
    // Captured oploc2: Take-supplies opens the real omnishop directly.
    openFinalSupplyShop(player);
    return true;
  }

  function handleFinalDrakanRoofDoor(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const ids = [event?.objectId, event?.definition?.id];
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.FINAL ||
      !ids.includes(FINAL_DRAKAN_ROOF_DOOR.id) || x !== FINAL_DRAKAN_ROOF_DOOR.x ||
      y !== FINAL_DRAKAN_ROOF_DOOR.y || z !== FINAL_DRAKAN_ROOF_DOOR.z ||
      String(event?.option ?? "").toLowerCase() !== "enter") return false;
    event.handled = true;
    if (!player.getAttribute(DRAKAN_SUPPLY_ATTRIBUTE)) {
      startTranscript(api, player, 0, PAGE,
        "night-of-the-blood-moon-attempting-to-enter-the-northern-door-without-searching-the-supply-chest");
      return true;
    }
    if (!hasItem(player, ItemIdentifiers.HALLOWED_FLAIL) &&
      !player.getEquipment?.()?.contains?.(ItemIdentifiers.HALLOWED_FLAIL)) {
      player.sendMessage("The Hallowed flail Efaritay gave you is needed to fight Lowerniel in Vampyrium.");
      return true;
    }
    startTranscript(api, player, 0, PAGE, "night-of-the-blood-moon-entering-the-northern-door");
    return true;
  }

  function handleFinalDrakanHit(event) {
    const npc = event?.npc;
    const fight = npc && drakanEncounters.get(npc.getArea?.());
    const hit = event?.hit;
    if (!fight || fight.mode === "first-blood" || npc !== fight.boss || fight.ending || !hit) return;
    // The Wiki records a 26–28 damage ceiling per hit in the final duel.
    for (const part of hit.getHits?.() ?? []) {
      const damage = part.getDamage?.() ?? 0;
      if (damage > 28) part.setDamage(28);
    }
    hit.updateTotalDamage?.();
  }

  function handleFirstBloodHit(event) {
    const npc = event?.npc;
    const hit = event?.hit;
    const attacker = event?.attacker;
    const fight = npc && drakanEncounters.get(npc.getArea?.());
    if (!fight || fight.mode !== "first-blood" || fight.ending || !hit) return;
    if (npc !== fight.boss) {
      if (!fight.damageUnlocked && fight.allies?.includes(npc) && attacker === fight.boss) {
        for (const part of hit.getHits?.() ?? []) part.setDamage(0);
        hit.updateTotalDamage?.();
      }
      return;
    }
    if (!fight.damageUnlocked && attacker?.isPlayer?.()) {
      for (const part of hit.getHits?.() ?? []) if ((part.getDamage?.() ?? 0) > 0) part.setDamage(0);
      hit.updateTotalDamage?.();
      return;
    }
    // The recorded First Blood escape begins at 2,550 HP after 450 damage.
    // Clamp the final hit so a high-damage roll cannot skip that cutscene.
    let remaining = Math.max(0, npc.getHitpoints() - fight.thresholdHp);
    for (const part of hit.getHits?.() ?? []) {
      const damage = part.getDamage?.() ?? 0;
      if (damage <= 0) continue;
      const allowed = Math.min(remaining, damage);
      if (allowed < damage) part.setDamage(allowed);
      remaining -= allowed;
    }
    hit.updateTotalDamage?.();
  }

  function setBloodHuntNativeStage(player, value) {
    const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    player.setAttribute(HUNT_ATTRIBUTE, { ...hunt, nativeStage: value });
    player.getPacketSender()?.sendVarbit?.(15464, value);
  }

  function startFirstBloodEncounter(player) {
    if (!player || stage(player) !== STAGE.BLOOD_HUNT ||
      !player.getAttribute(HUNT_ATTRIBUTE)?.drawbridgeRepaired ||
      player.getAttribute(FIRST_BLOOD_DEFEATED_ATTRIBUTE)) return false;
    const existing = player.getAttribute(FIRST_BLOOD_AREA_ATTRIBUTE);
    if (existing && existing.isDestroyed?.() !== true) return true;
    const area = new DrakanEncounterArea(player.getUsername?.(), "first-blood");
    const boss = api.spawnNpc({ id: NpcIdentifiers.LOWERNIEL_DRAKAN_20,
      x: 2710, y: 7840, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) {
      player.sendMessage("Lowerniel could not be reached. Speak to Vanescula to begin the crossing again.");
      return false;
    }
    boss.setMultiCombat?.(true);
    boss.setFlag?.("combat:no-retaliate", true);
    boss.setMaxHitpoints(3000);
    boss.setHitpoints(3000);
    const vanescula = api.spawnNpc({ id: NpcIdentifiers.VANESCULA_DRAKAN_20,
      x: 2709, y: 7840, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    const veliaf = api.spawnNpc({ id: NpcIdentifiers.VELIAF_HURTZ_25,
      x: 2709, y: 7841, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    area.enter(player);
    area.enter(boss);
    if (vanescula) area.enter(vanescula);
    if (veliaf) area.enter(veliaf);
    player.setAttribute(FIRST_BLOOD_AREA_ATTRIBUTE, area);
    player.moveTo(new Location(2712, 7840, 0));
    const fight = { mode: "first-blood", area, boss, player, allies: [vanescula, veliaf].filter(Boolean),
      thresholdHp: 2550, thresholdStarted: false, damageUnlocked: false, lungesDodged: 0,
      lungeIndex: 0, nextAttackAt: World.getProcessCycle() + 2,
      lastCycle: -1, ending: false, finished: false };
    drakanEncounters.set(area, fight);
    boss.getCombat?.()?.attack?.(vanescula ?? player);
    for (const ally of fight.allies) ally.getCombat?.()?.attack?.(boss);
    setBloodHuntNativeStage(player, 90);
    return true;
  }

  function cleanupFirstBloodEncounter({ player }) {
    const area = player?.getAttribute(FIRST_BLOOD_AREA_ATTRIBUTE);
    const fight = area && drakanEncounters.get(area);
    if (!fight || fight.mode !== "first-blood") {
      if (player) player.setAttribute(FIRST_BLOOD_AREA_ATTRIBUTE, null);
      return;
    }
    fight.finished = true;
    for (const actor of [fight.boss, ...(fight.allies ?? [])]) if (actor) api.removeNpc(actor);
    area.leave(player, false);
    drakanEncounters.delete(area);
    player.setAttribute(FIRST_BLOOD_AREA_ATTRIBUTE, null);
  }

  function recoverFirstBloodEncounter({ player }) {
    if (!player || stage(player) !== STAGE.BLOOD_HUNT) return;
    const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    if (hunt.firstBloodThresholdReached) {
      if (!hunt.firstBloodDefeated) {
        startTranscript(api, player, NpcIdentifiers.LOWERNIEL_DRAKAN_2,
          PAGE, "blood-hunt-after-dealing-enough-damage-to-lowerniel");
      } else if (!hunt.firstBloodFleeDialogueComplete && Number(hunt.nativeStage) < 98) {
        // The threshold transcript ends in a second, separately-started scene.
        // Resume it if logout happened after cleanup but before the scene opened.
        startTranscript(api, player, NpcIdentifiers.LOWERNIEL_DRAKAN_2,
          PAGE, "blood-hunt-fleeing-through-the-woods");
      }
      return;
    }
    if (Number(hunt.nativeStage) === 90) {
      setBloodHuntNativeStage(player, 86);
      player.moveTo(new Location(BLOOD_HUNT_PARTY_ARRIVAL.x, BLOOD_HUNT_PARTY_ARRIVAL.y,
        BLOOD_HUNT_PARTY_ARRIVAL.z));
      syncBloodHuntActors(player);
    }
  }

  function beginPreparationIntro(player) {
    if (!player || stage(player) !== STAGE.PREPARATIONS) return false;
    const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
    if (prep.introComplete) return false;
    player.setAttribute(PREP_ATTRIBUTE, { ...prep, introStarted: true });
    player.getPacketSender()?.sendVarbit?.(15464, 98);
    player.moveTo(new Location(2987, 7699, 0));
    return startTranscript(api, player, NpcIdentifiers.MYSTERIOUS_WOMAN, PAGE, "hallowed-preparations-talking-to-the-mysterious-woman");
  }

  function resumePreparationIntro({ player }) {
    if (!player || stage(player) !== STAGE.PREPARATIONS) return;
    const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
    if (!prep.introComplete && !player.getDialogueManager?.()?.getCurrent?.()) beginPreparationIntro(player);
  }

  function finishDrakanEncounter(player) {
    const area = player.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    const fight = area && drakanEncounters.get(area);
    if (!player.getAttribute(DRAKAN_DEATH_CONFIRMED) &&
      (!fight || !fight.deathConfirmed || fight.boss.getHitpoints() > 0)) return false;
    if (fight) {
      fight.finished = true;
      api.removeNpc(fight.boss);
      area.leave(player, false);
      drakanEncounters.delete(area);
    }
    player.setAttribute(DRAKAN_AREA_ATTRIBUTE, null);
    player.setAttribute(DRAKAN_ENCOUNTER_COMPLETE, true);
    return true;
  }

  function setFinalNativeStage(player, value) {
    player.setAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(15464, value);
  }

  function resumeFinalDrakanVictory({ player }) {
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.FINAL ||
      !player.getAttribute(DRAKAN_DEATH_CONFIRMED) || player.getAttribute(DRAKAN_ENCOUNTER_COMPLETE)) return;
    setFinalNativeStage(player, Math.max(172, Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) || 0));
    startTranscript(api, player, FINAL_DRAKAN_ID, PAGE, "night-of-the-blood-moon-upon-killing-lowerniel-drakan");
  }

  function cleanupFinalDrakanFight(player) {
    const area = player?.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    const fight = area && drakanEncounters.get(area);
    if (!fight) {
      if (player) player.setAttribute(DRAKAN_AREA_ATTRIBUTE, null);
      return;
    }
    fight.finished = true;
    api.removeNpc(fight.boss);
    area.leave(player, false);
    drakanEncounters.delete(area);
    player.setAttribute(DRAKAN_AREA_ATTRIBUTE, null);
  }

  function handleFinalDrakanLogout({ player }) {
    const area = player?.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    if (!area) return;
    cleanupFinalDrakanFight(player);
    if (stage(player) === STAGE.FINAL && !player.getAttribute(DRAKAN_DEATH_CONFIRMED)) {
      player.moveTo(new Location(FINAL_CASTLE_ARRIVAL.x, FINAL_CASTLE_ARRIVAL.y, FINAL_CASTLE_ARRIVAL.z));
    }
  }

  function recoverFinalDrakanLanding({ player }) {
    if (!player || stage(player) !== STAGE.FINAL || player.getAttribute(DRAKAN_DEATH_CONFIRMED)) return;
    const location = player.getLocation?.();
    if (location?.getZ?.() === 3 && location.getX() >= 2495 && location.getX() <= 2514 &&
      location.getY() >= 7823 && location.getY() <= 7853) {
      cleanupFinalDrakanFight(player);
      player.moveTo(new Location(FINAL_CASTLE_ARRIVAL.x, FINAL_CASTLE_ARRIVAL.y, FINAL_CASTLE_ARRIVAL.z));
    }
  }

  function handleFinalDrakanBeforeDeath(event) {
    const player = event?.player;
    const area = player?.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    const fight = area && drakanEncounters.get(area);
    if (!player || !fight || fight.player !== player || fight.deathConfirmed || fight.finished) return;
    event.preventDeath = true;
    player.setHitpoints(player.getSkillManager().getMaxLevel(Skill.HITPOINTS));
    player.getSkillManager().setCurrentLevel(Skill.PRAYER,
      player.getSkillManager().getMaxLevel(Skill.PRAYER), true);
    fight.finished = true;
    api.removeNpc(fight.boss);
    area.leave(player, false);
    drakanEncounters.delete(area);
    player.setAttribute(DRAKAN_AREA_ATTRIBUTE, null);
    setFinalNativeStage(player, 170);
    player.moveTo(new Location(FINAL_CASTLE_ARRIVAL.x, FINAL_CASTLE_ARRIVAL.y, FINAL_CASTLE_ARRIVAL.z));
    player.sendMessage("You awaken beside the northern door with your remaining supplies. Lowerniel still waits inside.");
  }

  function beginBloodMoonGathering(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND) return false;
    if (Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) >= 152) return false;
    setFinalNativeStage(player, 152);
    return true;
  }

  function sceneReady(player) {
    return typeof player?.getMovementQueue === "function" && typeof player?.getPacketSender === "function";
  }

  function resetBloodMoonScene(player) {
    if (!player) return;
    Scenes.cancel(player);
    player.setAttribute(BLOOD_MOON_SCENE_ATTRIBUTE, null);
    if (!sceneReady(player)) return;
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
  }

  function resetBloodMoonSceneOnLogin({ player } = {}) {
    resetBloodMoonScene(player);
    recoverGatheringFightOnLogin(player);
    recoverHideoutEscapeLanding({ player });
  }

  function recoverHideoutEscapeLanding({ player } = {}) {
    if (!player || stage(player) !== STAGE.RETURNED) return;
    const location = player.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    // Only the stranded courtyard save is repaired; stage 25 elsewhere is left alone.
    if (z !== HIDEOUT_DEFENSE_COURTYARD.z ||
      x < HIDEOUT_DEFENSE_COURTYARD.minX || x > HIDEOUT_DEFENSE_COURTYARD.maxX ||
      y < HIDEOUT_DEFENSE_COURTYARD.minY || y > HIDEOUT_DEFENSE_COURTYARD.maxY) return;
    resetBloodMoonScene(player);
    player.moveTo(new Location(HIDEOUT_ESCAPE_LANDING.x, HIDEOUT_ESCAPE_LANDING.y,
      HIDEOUT_ESCAPE_LANDING.z));
    player.sendMessage("Ivan's teleport sets you down in the Myreque hideout.");
  }

  function recoverGatheringFightOnLogin(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND) return;
    const fight = player.getAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE);
    if (fight?.boss?.getHitpoints?.() > 0) return;
    // No live gathering fight survives a restart: clear the stale scene/fight
    // markers so the fence -> Myreque prevail route can start the 152 scene again.
    cleanupGatheringDrakan(player);
    player.setAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE, null);
    if (Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) >= 152 &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) < 158) {
      // 158+ means the threshold conversation already moved the group to the
      // castle; keep that earned landing and let the login sync spawn Ivan.
      player.moveTo(new Location(WYRD_BURGH_RETURN.x, WYRD_BURGH_RETURN.y, WYRD_BURGH_RETURN.z));
      player.sendMessage("The gathering was interrupted. Inspect the broken fence again to continue.");
    }
  }

  function startGatheringScene(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND ||
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) !== 152 ||
      player.getAttribute(BLOOD_MOON_SCENE_ATTRIBUTE)) return false;
    player.setAttribute(BLOOD_MOON_SCENE_ATTRIBUTE, true);
    player.moveTo(new Location(BLOOD_MOON_SCENE.x, BLOOD_MOON_SCENE.y, BLOOD_MOON_SCENE.z));
    // RSProx P1 t358-406: fade in over the gathering then pan/rise over the crowd.
    if (sceneReady(player)) {
      Scenes.fade(player, true);
      Scenes.controls(player, true, true);
      Scenes.camera(player, [3594, 3358, 120], [3566, 3355, 180]);
      Scenes.later(player, 2, () => {
        Scenes.camera(player, [3581, 3358, 120], [3566, 3355, 180]);
        Scenes.fade(player, false);
      });
      Scenes.later(player, 6, () => Scenes.camera(player, [3571, 3350, 360], [3566, 3355, 180]));
    }
    return startTranscript(api, player, 0, PAGE, "night-of-the-blood-moon");
  }

  function failGatheringFight(player, message) {
    cleanupGatheringDrakan(player);
    resetBloodMoonScene(player);
    player.setAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE, null);
    if (stage(player) === STAGE.FENCE_FOUND) {
      player.moveTo(new Location(WYRD_BURGH_RETURN.x, WYRD_BURGH_RETURN.y, WYRD_BURGH_RETURN.z));
    }
    player.sendMessage(message);
    return false;
  }

  function startGatheringDrakanFight(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND ||
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) !== 152) return false;
    const existing = player.getAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE);
    if (existing && existing.boss?.getHitpoints?.() > 0) return true;
    const boss = api.spawnNpc({ id: BLOOD_MOON_DRAKAN_ID, x: 3570, y: 3352, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) {
      return failGatheringFight(player,
        "Lowerniel could not be reached. Inspect the broken fence again to retry the gathering.");
    }
    boss.setMultiCombat?.(true);
    boss.setMaxHitpoints(BLOOD_MOON_DRAKAN_MAX_HP);
    boss.setHitpoints(BLOOD_MOON_DRAKAN_MAX_HP);
    const allies = BLOOD_MOON_ALLIES.map((id, index) => api.spawnNpc({ id, x: 3571 + index, y: 3355, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true })).filter(Boolean);
    for (const ally of allies) ally.getCombat?.().attack?.(boss);
    boss.getCombat?.().attack?.(player);
    player.setAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE, { boss, allies, ending: false });
    setFinalNativeStage(player, 154);
    player.sendMessage("Lowerniel fights in the open. Keep your defences up; Safalaan's intervention ends the clash at the story threshold.");
    return true;
  }

  function finishGatheringDrakanClash(player, npc) {
    const fight = player?.getAttribute?.(BLOOD_MOON_FIGHT_ATTRIBUTE);
    if (!fight || fight.ending || fight.boss !== npc) return false;
    fight.ending = true;
    api.removeNpc(npc);
    // Keep Ivan and the aranei for the captured post-fight conversations.
    player.setAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE, { boss: null, allies: fight.allies ?? [], ending: true });
    setFinalNativeStage(player, 156);
    startTranscript(api, player, npc.getId(), PAGE, "night-of-the-blood-moon-upon-lowerniel-reaching-30-hp");
    return true;
  }

  function handleGatheringDrakanHit(event) {
    const npc = event?.npc;
    const fight = npc?.getOwner?.()?.getAttribute?.(BLOOD_MOON_FIGHT_ATTRIBUTE);
    if (!npc || npc.getId?.() !== BLOOD_MOON_DRAKAN_ID || !fight || fight.boss !== npc || fight.ending || !event?.hit) return;
    for (const part of event.hit.getHits?.() ?? []) {
      const damage = part.getDamage?.() ?? 0;
      if (npc.getHitpoints() - damage < BLOOD_MOON_DRAKAN_THRESHOLD) {
        part.setDamage(Math.max(0, npc.getHitpoints() - BLOOD_MOON_DRAKAN_THRESHOLD));
      }
    }
    event.hit.updateTotalDamage?.();
    const remaining = (event.hit.getHits?.() ?? []).reduce((hp, part) => hp - (part.getDamage?.() ?? 0), npc.getHitpoints());
    if (remaining <= BLOOD_MOON_DRAKAN_THRESHOLD) finishGatheringDrakanClash(fight.boss.getOwner?.(), npc);
  }

  function handleGatheringDrakanBeforeDeath(event) {
    const npc = event?.npc;
    const player = npc?.getOwner?.()?.isPlayer?.() ? npc.getOwner() : event?.killer;
    if (!npc || npc.getId?.() !== BLOOD_MOON_DRAKAN_ID || !player?.isPlayer?.() ||
      stage(player) !== STAGE.FENCE_FOUND || Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) !== 154) return;
    const fight = player.getAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE);
    if (!fight || fight.boss !== npc || event.preventDeath) return;
    event.preventDeath = true;
    finishGatheringDrakanClash(player, npc);
  }

  function cleanupGatheringDrakan(player) {
    const fight = player?.getAttribute?.(BLOOD_MOON_FIGHT_ATTRIBUTE);
    if (!fight) return;
    for (const npc of [fight.boss, ...(fight.allies ?? [])]) if (npc) api.removeNpc(npc);
    player.setAttribute(BLOOD_MOON_FIGHT_ATTRIBUTE, null);
  }

  function cleanupGatheringDrakanOnLogout({ player } = {}) {
    cleanupGatheringDrakan(player);
  }

  function spawnGatheringCastleIvan(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND) return null;
    const native = Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE));
    if (!(native >= 158 && native < 164)) return null;
    const existing = gatheringCastleIvans.get(player);
    if (existing && !existing.isDestroyed?.() && existing.getHitpoints?.() > 0) return existing;
    const npc = api.spawnNpc({ id: GATHERING_CASTLE_IVAN.id, x: GATHERING_CASTLE_IVAN.x,
      y: GATHERING_CASTLE_IVAN.y, z: GATHERING_CASTLE_IVAN.z,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return null;
    npc.setScriptedMovement?.(true);
    gatheringCastleIvans.set(player, npc);
    return npc;
  }

  function spawnGatheringCastleSugadinti(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND) return null;
    const native = Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE));
    if (!(native >= 160 && native < 164)) return null;
    const existing = gatheringCastleSugadintis.get(player);
    if (existing && !existing.isDestroyed?.() && existing.getHitpoints?.() > 0) return existing;
    const npc = api.spawnNpc({ id: GATHERING_CASTLE_SUGADINTI.id,
      x: GATHERING_CASTLE_SUGADINTI.x, y: GATHERING_CASTLE_SUGADINTI.y,
      z: GATHERING_CASTLE_SUGADINTI.z, wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return null;
    npc.setScriptedMovement?.(true);
    gatheringCastleSugadintis.set(player, npc);
    return npc;
  }

  function syncGatheringCastleActors(player) {
    spawnGatheringCastleIvan(player);
    spawnGatheringCastleSugadinti(player);
  }

  function cleanupGatheringCastleActors({ player } = {}) {
    const ivan = player && gatheringCastleIvans.get(player);
    if (ivan) api.removeNpc(ivan);
    const sugadinti = player && gatheringCastleSugadintis.get(player);
    if (sugadinti) api.removeNpc(sugadinti);
    if (player) {
      gatheringCastleIvans.delete(player);
      gatheringCastleSugadintis.delete(player);
    }
  }

  // The threshold transcript is a real conversation; only leave the gathering
  // scene after its final canonical line. gaf5Xw ("Efaritay flies away.") is a
  // mid-transcript action, so it must not move the player.
  function finishGatheringThresholdConversation(player) {
    if (!player || stage(player) !== STAGE.FENCE_FOUND ||
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) !== 156) return;
    cleanupGatheringDrakan(player);
    resetBloodMoonScene(player);
    player.setAttribute(BLOOD_MOON_SCENE_ATTRIBUTE, null);
    setFinalNativeStage(player, 158);
    player.moveTo(new Location(GATHERING_CASTLE_LANDING.x, GATHERING_CASTLE_LANDING.y,
      GATHERING_CASTLE_LANDING.z));
    syncGatheringCastleActors(player);
  }

  function syncGatheringCastleActorsOnLogin({ player } = {}) {
    if (player) syncGatheringCastleActors(player);
  }

  function syncFinalEfaritay(player) {
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.FINAL ||
      player.getAttribute(DRAKAN_ENCOUNTER_COMPLETE) || player.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE)) return;
    const existing = finalEfaritays.get(player);
    if (existing && existing.getHitpoints?.() > 0) return existing;
    const npc = api.spawnNpc({ id: FINAL_EFARITAY_ID, x: FINAL_EFARITAY_GRAVEYARD_TILE.x,
      y: FINAL_EFARITAY_GRAVEYARD_TILE.y, z: FINAL_EFARITAY_GRAVEYARD_TILE.z,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return null;
    npc.setScriptedMovement?.(true);
    finalEfaritays.set(player, npc);
    return npc;
  }

  function cleanupFinalEfaritay({ player }) {
    const npc = player && finalEfaritays.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    finalEfaritays.delete(player);
  }

  function syncPostQuestEfaritay({ player } = {}) {
    if (!player) return null;
    if (!quest.isComplete(player)) {
      cleanupPostQuestEfaritay({ player });
      return null;
    }
    const existing = postQuestEfaritays.get(player);
    if (existing && !existing.isDestroyed?.() && existing.getHitpoints?.() > 0) return existing;
    const npc = api.spawnNpc({ id: POST_QUEST_EFARITAY.id, x: POST_QUEST_EFARITAY.x,
      y: POST_QUEST_EFARITAY.y, z: POST_QUEST_EFARITAY.z, wanderRadius: 0,
      owner: player, ownerOnly: true });
    if (!npc) return null;
    npc.setScriptedMovement?.(true);
    postQuestEfaritays.set(player, npc);
    return npc;
  }

  function cleanupPostQuestEfaritay({ player } = {}) {
    const npc = player && postQuestEfaritays.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    postQuestEfaritays.delete(player);
  }

  function spawnFinalCutsceneActors(player) {
    cleanupFinalEfaritay({ player });
    const actors = [];
    for (const [id, tile] of [[FINAL_EFARITAY_CUTSCENE_ID, [3706, 3211, 0]],
      [FINAL_WYRD_ID, [3708, 3211, 0]]]) {
      const npc = api.spawnNpc({ id, x: tile[0], y: tile[1], z: tile[2],
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (npc) {
        npc.setScriptedMovement?.(true);
        actors.push(npc);
      }
    }
    finalCutsceneActors.set(player, actors);
  }

  function transformFinalWyrdForCutscene(player) {
    const actors = finalCutsceneActors.get(player) ?? [];
    for (const npc of actors) {
      if ((npc.getId?.() ?? npc.id) === FINAL_WYRD_ID) api.removeNpc(npc);
    }
    const wyrd = api.spawnNpc({ id: NpcIdentifiers.WYRD_7, x: 3708, y: 3211, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (wyrd) {
      wyrd.setScriptedMovement?.(true);
      actors.push(wyrd);
    }
    finalCutsceneActors.set(player, actors.filter(npc => (npc.getId?.() ?? npc.id) !== FINAL_WYRD_ID));
  }

  function spawnFinalArrivalActors(player) {
    cleanupFinalCutsceneActors({ player });
    const actors = [];
    for (const [id, x, y] of [[FINAL_EFARITAY_CUTSCENE_ID, 2505, 7383], [FINAL_WYRD_ID, 2509, 7383]]) {
      const npc = api.spawnNpc({ id, x, y, z: FINAL_CASTLE_ARRIVAL.z,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (npc) {
        npc.setScriptedMovement?.(true);
        actors.push(npc);
      }
    }
    finalCutsceneActors.set(player, actors);
  }

  function cleanupFinalCutsceneActors({ player }) {
    const actors = player && finalCutsceneActors.get(player);
    for (const npc of actors ?? []) api.removeNpc(npc);
    if (player) finalCutsceneActors.delete(player);
  }

  function syncFinalEfaritayOnLogin({ player }) {
    const location = player?.getLocation?.();
    // Older earned saves used the fence's clipped scene marker as their landing.
    if (player && [STAGE.WYRD_DEFEATED, STAGE.FENCE_FOUND, STAGE.FINAL].includes(stage(player)) &&
      player.getAttribute(WYRD_DEFEATED_ATTRIBUTE) && !player.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE) &&
      location?.getX?.() === 3562 && location?.getY?.() === 3323 && location?.getZ?.() === 0) {
      player.moveTo(new Location(3562, 3322, 0));
      player.sendMessage("You step clear of the broken fence and can continue toward the graveyard.");
    }
    if (player && stage(player) === STAGE.FINAL) {
      player.getPacketSender().sendVarbit(15464, nativeStage(STAGE.FINAL, player));
    }
    syncFinalEfaritay(player);
  }

  function openFinalPortal(player) {
    if (!player || stage(player) !== STAGE.FINAL) return false;
    player.setAttribute(FINAL_PORTAL_OPEN_ATTRIBUTE, true);
    setFinalNativeStage(player, 166);
    syncFinalEfaritay(player);
    return true;
  }

  function handleFinalPortal(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.FINAL ||
      ![event?.objectId, event?.definition?.id].some(id => id === FINAL_PORTAL.id || id === FINAL_PORTAL.visibleId) ||
      x !== FINAL_PORTAL.x || y !== FINAL_PORTAL.y || z !== FINAL_PORTAL.z ||
      String(event?.option ?? "").toLowerCase() !== "enter") return false;
    if (!player.getAttribute(FINAL_PORTAL_OPEN_ATTRIBUTE)) {
      event.handled = true;
      player.sendMessage("Efaritay must open a portal with her blood first.");
      return true;
    }
    const started = startTranscript(api, player, FINAL_EFARITAY_ID, PAGE,
      "night-of-the-blood-moon-entering-the-portal");
    if (started) event.handled = true;
    return started;
  }

  function handleFinalCastleReturnPortal(event) {
    const player = event?.player;
    const tile = event?.location;
    const id = event?.definition?.id ?? event?.objectId;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.FINAL ||
      id !== CASTLE_VAMPYRIUM_RETURN.id || x !== CASTLE_VAMPYRIUM_RETURN.x ||
      y !== CASTLE_VAMPYRIUM_RETURN.y || z !== CASTLE_VAMPYRIUM_RETURN.z ||
      String(event?.option ?? "").toLowerCase() !== "enter") return false;
    event.handled = true;
    if (player.getAttribute(DRAKAN_AREA_ATTRIBUTE)) {
      player.sendMessage("You cannot abandon the duel while Lowerniel is attacking.");
      return true;
    }
    player.setAttribute(FINAL_PORTAL_USED_ATTRIBUTE, false);
    setFinalNativeStage(player, 168);
    player.moveTo(new Location(FINAL_PORTAL.x, FINAL_PORTAL.y, FINAL_PORTAL.z));
    syncFinalEfaritay(player);
    return true;
  }

  function handleDrakanDeath(event) {
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const fight = area && drakanEncounters.get(area);
    if (!fight || npc !== fight.boss || fight.finished || fight.deathConfirmed) return false;
    if (npc.getHitpoints() > 0) return false;
    fight.ending = true;
    fight.deathConfirmed = true;
    fight.player.setAttribute(DRAKAN_DEATH_CONFIRMED, true);
    // RSProx 4272: death01 animation, camera over the roof, then stage 172.
    npc.performAnimation?.(new Animation(14339));
    fight.player.getPacketSender()?.sendCameraMoveTo?.(2497, 7838, 250, { rate: 232, rate2: 100 });
    fight.player.getPacketSender()?.sendCameraLookAt?.(2512, 7838, 100, { rate: 232, rate2: 100 });
    setFinalNativeStage(fight.player, 172);
    startTranscript(api, fight.player, npc.getId(), PAGE, "night-of-the-blood-moon-upon-killing-lowerniel-drakan");
    return true;
  }

  function startSiegeDrakanBattle(player) {
    const existing = player.getAttribute(SIEGE_DRAKAN_AREA_ATTRIBUTE);
    if (existing && existing.isDestroyed?.() !== true) return true;
    if (stage(player) !== STAGE.SIEGE || hallDefenceState(player).phase !== "breach") return false;
    const area = new SiegeDrakanArea(player.getUsername?.());
    const boss = api.spawnNpc({ id: NpcIdentifiers.LOWERNIEL_DRAKAN_19, x: 3168, y: 7853, z: 1,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) {
      player.sendMessage("Lowerniel could not be reached. Pass through the barricade into the palace hall and try again.");
      return false;
    }
    boss.setMultiCombat?.(true);
    boss.setMaxHitpoints(3000);
    boss.setHitpoints(2550);
    area.enter(player);
    area.enter(boss);
    player.setAttribute(SIEGE_DRAKAN_AREA_ATTRIBUTE, area);
    player.setAttribute(SIEGE_DRAKAN_COMPLETE, false);
    siegeDrakanEncounters.set(area, { area, boss, player, thresholdHp: 1740, lastCycle: -1,
      nextAttackAt: World.getProcessCycle() + 4, attackIndex: 0, impactAt: 0, warning: null,
      markedX: 3168, markedY: 7853, ending: false, finished: false });
    player.sendMessage("Lowerniel has breached the entrance hall. Dodge his spear thrusts and front-and-back blood bursts, and protect from Magic against his blood spears.");
    return true;
  }

  function finishSiegeDrakanBattle(player) {
    const area = player.getAttribute(SIEGE_DRAKAN_AREA_ATTRIBUTE);
    const fight = area && siegeDrakanEncounters.get(area);
    if (!fight || fight.player !== player) return false;
    fight.finished = true;
    api.removeNpc(fight.boss);
    area.leave(player, false);
    player.setAttribute(SIEGE_DRAKAN_AREA_ATTRIBUTE, null);
    player.setAttribute(SIEGE_DRAKAN_COMPLETE, true);
    siegeDrakanEncounters.delete(area);
    setTheatreNativeStage(player, 124);
    advance(player, STAGE.THEATRE);
    // The cutscene sends the party to the Haunted Woods; this is its canonical
    // post-scene checkpoint from the Quest Helper route.
    player.moveTo(new Location(3605, 3416, 0));
    syncTheatreActors(player);
    player.getPacketSender()?.sendVarbit?.(15464, nativeStage(STAGE.THEATRE, player));
    return true;
  }

  const SIEGE_HALL = {
    hammerCrate: ObjectIdentifiers.CRATE_OF_HAMMERS_2,
    potionCrate: ObjectIdentifiers.CRATE_OF_POTIONS,
    damagedPillar: ObjectIdentifiers.DAMAGED_PILLAR_2,
    pillar: ObjectIdentifiers.PILLAR_150,
    damagedWindow: ObjectIdentifiers.DAMAGED_WINDOW,
    window: ObjectIdentifiers.WINDOW_20,
    barricade: ObjectIdentifiers.BARRICADE_61,
    hammer: ItemIdentifiers.HAMMER,
    healingPotion: ItemIdentifiers.HEALING_POTION,
    injuredAranei: [NpcIdentifiers.ARANEI_108, NpcIdentifiers.ARANEI_109, NpcIdentifiers.ARANEI_110,
      NpcIdentifiers.ARANEI_111, NpcIdentifiers.ARANEI_112, NpcIdentifiers.ARANEI_113],
    aranei: [
      { normal: NpcIdentifiers.ARANEI_102, injured: NpcIdentifiers.ARANEI_108, x: 3161, y: 7854 },
      { normal: NpcIdentifiers.ARANEI_103, injured: NpcIdentifiers.ARANEI_109, x: 3163, y: 7855 },
      { normal: NpcIdentifiers.ARANEI_104, injured: NpcIdentifiers.ARANEI_110, x: 3165, y: 7855 },
      { normal: NpcIdentifiers.ARANEI_105, injured: NpcIdentifiers.ARANEI_111, x: 3171, y: 7855 },
      { normal: NpcIdentifiers.ARANEI_106, injured: NpcIdentifiers.ARANEI_112, x: 3173, y: 7855 },
      { normal: NpcIdentifiers.ARANEI_107, injured: NpcIdentifiers.ARANEI_113, x: 3175, y: 7854 },
    ],
    repairLocations: new Map([
      ["3174,7855", [ObjectIdentifiers.DAMAGED_PILLAR_2, ObjectIdentifiers.PILLAR_150]],
      ["3162,7855", [ObjectIdentifiers.DAMAGED_PILLAR_2, ObjectIdentifiers.PILLAR_150]],
      ["3176,7858", [ObjectIdentifiers.DAMAGED_WINDOW, ObjectIdentifiers.WINDOW_20]],
      ["3172,7858", [ObjectIdentifiers.DAMAGED_WINDOW, ObjectIdentifiers.WINDOW_20]],
      ["3174,7858", [ObjectIdentifiers.DAMAGED_WINDOW, ObjectIdentifiers.WINDOW_20]],
      ["3160,7858", [ObjectIdentifiers.DAMAGED_WINDOW, ObjectIdentifiers.WINDOW_20]],
      ["3162,7858", [ObjectIdentifiers.DAMAGED_WINDOW, ObjectIdentifiers.WINDOW_20]],
      ["3164,7858", [ObjectIdentifiers.DAMAGED_WINDOW, ObjectIdentifiers.WINDOW_20]],
    ]),
  };

  // Captured P3: the hall opens at 650 with a 300-tick timer. Loss per tick is
  // exactly 2 per damaged pillar plus 1 per injured Aranei; windows are
  // cosmetic. Timer expiry does not change the formula. Repairs remove the
  // pillar/window source and heals revert one Aranei; neither raises the meter.
  // shortcut: the only detail the capture does not decode is the attack cadence
  // (when pillars/windows break and Aranei fall); the intervals below follow the
  // observed acceleration without replaying the recorded timeline.
  const HALL_STATE_VERSION = 1;
  const HALL_INTEGRITY_MAX = 650;
  const HALL_SIEGE_TICKS = 300;
  const HALL_PILLAR_DAMAGE = 2;
  const HALL_ARANEI_DAMAGE = 1;
  const HALL_FIRST_PILLAR_TICK = 28;
  const HALL_FIRST_WINDOW_TICK = 14;
  const HALL_FIRST_ARANEI_TICK = 43;
  const HALL_INTEGRITY_OVERLAY_UID = (161 << 16) | 8;
  const HALL_INTEGRITY_INTERFACE = 968;
  const HALL_INTEGRITY_SCRIPT = 9674;
  const HALL_PILLAR_KEYS = [...SIEGE_HALL.repairLocations]
    .filter(([, ids]) => ids[0] === SIEGE_HALL.damagedPillar).map(([key]) => key);
  const HALL_WINDOW_KEYS = [...SIEGE_HALL.repairLocations]
    .filter(([, ids]) => ids[0] === SIEGE_HALL.damagedWindow).map(([key]) => key);
  const hallHuds = new WeakSet();

  function freshHallState() {
    return { version: HALL_STATE_VERSION, phase: "hall", integrity: HALL_INTEGRITY_MAX,
      timer: HALL_SIEGE_TICKS, elapsed: 0, damaged: {}, injured: {},
      nextPillarTick: HALL_FIRST_PILLAR_TICK, nextWindowTick: HALL_FIRST_WINDOW_TICK,
      nextAraneiTick: HALL_FIRST_ARANEI_TICK };
  }

  function hallDefenceState(player) {
    const raw = player.getAttribute(SIEGE_DEFENCE_ATTRIBUTE) ?? { phase: "bridge", integrity: 100 };
    if (raw.phase !== "hall" || raw.version === HALL_STATE_VERSION) return raw;
    // Legacy saves used a 0-100 bar, a participation gate and a permanent
    // repaired list; the capture replaced all three.
    const migrated = { ...freshHallState(),
      integrity: Math.max(0, Math.min(HALL_INTEGRITY_MAX,
        Math.round((Number(raw.integrity) || 0) * (HALL_INTEGRITY_MAX / 100)))) };
    // A qualified legacy defence had already survived the old 20-minute holdout,
    // so its 300-tick story timer cannot still be running after the migration.
    if (raw.qualified) migrated.timer = 0;
    return migrated;
  }

  function publishHallIntegrity(player, state) {
    const sender = player.getPacketSender?.();
    if (!sender || state.phase !== "hall") return;
    if (!hallHuds.has(player)) {
      hallHuds.add(player);
      sender.sendSubInterface?.(HALL_INTEGRITY_OVERLAY_UID, HALL_INTEGRITY_INTERFACE, 1);
      sender.sendString?.("Hideout Integrity", (HALL_INTEGRITY_INTERFACE << 16) | 6);
    }
    sender.sendClientScript?.(HALL_INTEGRITY_SCRIPT, state.integrity, HALL_INTEGRITY_MAX,
      state.timer, HALL_SIEGE_TICKS);
  }

  function closeHallIntegrity(player) {
    if (!hallHuds.delete(player)) return;
    player.getPacketSender?.()?.closeSubInterface?.(HALL_INTEGRITY_OVERLAY_UID);
  }

  function hallDamage(state) {
    const pillars = HALL_PILLAR_KEYS.filter(key => state.damaged?.[key]).length;
    const injured = Object.values(state.injured ?? {}).filter(Boolean).length;
    return pillars * HALL_PILLAR_DAMAGE + injured * HALL_ARANEI_DAMAGE;
  }

  function hallDamageChanged(previous, next) {
    const keys = new Set([...Object.keys(previous.damaged ?? {}), ...Object.keys(next.damaged ?? {})]);
    for (const key of keys) {
      if (Boolean(previous.damaged?.[key]) !== Boolean(next.damaged?.[key])) return true;
    }
    return false;
  }

  function advanceHallDefence(state) {
    const next = { ...state, elapsed: (state.elapsed ?? 0) + 1,
      damaged: { ...(state.damaged ?? {}) }, injured: { ...(state.injured ?? {}) } };
    next.timer = Math.max(0, state.timer - 1);
    if (next.elapsed >= next.nextPillarTick) {
      const key = HALL_PILLAR_KEYS.find(target => !next.damaged[target]);
      if (key) next.damaged[key] = true;
      next.nextPillarTick += Math.max(20, 70 - Math.floor(next.elapsed / 8));
    }
    if (next.elapsed >= next.nextWindowTick) {
      const key = HALL_WINDOW_KEYS.find(target => !next.damaged[target]);
      if (key) next.damaged[key] = true;
      next.nextWindowTick += Math.max(12, 40 - Math.floor(next.elapsed / 15));
    }
    if (next.elapsed >= next.nextAraneiTick) {
      const index = SIEGE_HALL.aranei.findIndex((_, i) => !next.injured[i]);
      if (index >= 0) next.injured[index] = true;
      next.nextAraneiTick += Math.max(5, 14 - Math.floor(next.elapsed / 35));
    }
    next.integrity = Math.max(0, state.integrity - hallDamage(next));
    return next;
  }

  function syncSiegeAranei(player, state) {
    const npcs = siegeAranei.get(player.getUsername?.() ?? player.getIndex?.());
    if (!npcs) return;
    SIEGE_HALL.aranei.forEach((def, index) => {
      const npc = npcs.get(index);
      if (!npc) return;
      const id = state.injured?.[index] ? def.injured : def.normal;
      if ((npc.getNpcTransformationId?.() ?? npc.getId?.()) !== id) npc.setNpcTransformationId?.(id);
    });
  }

  function failHallDefence(player) {
    player.sendMessage("You failed to defend the hideout!");
    const state = freshHallState();
    player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, state);
    hall.refresh?.(player);
    syncSiegeAranei(player, state);
    publishHallIntegrity(player, state);
  }

  function breachHallDefence(player, state) {
    const updated = { ...state, phase: "breach", integrity: 0 };
    player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, updated);
    closeHallIntegrity(player);
    quest.setStage(player, STAGE.SIEGE);
    startTranscript(api, player, NpcIdentifiers.LOWERNIEL_DRAKAN_19, PAGE,
      "drakan-s-siege-upon-reaching-0-hideout-integrity");
  }

  function processSiegeDefence({ player }) {
    if (!player || stage(player) !== STAGE.SIEGE) return;
    const state = hallDefenceState(player);
    if (state.phase !== "hall") return;
    const updated = advanceHallDefence(state);
    player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, updated);
    if (hallDamageChanged(state, updated)) hall.refresh?.(player);
    syncSiegeAranei(player, updated);
    publishHallIntegrity(player, updated);
    if (updated.integrity > 0) return;
    // P2 primary: reaching 0 before the timer shows "You failed to defend the
    // hideout!" and restarts a fresh 650/300 defence.
    if (updated.timer > 0) failHallDefence(player);
    else breachHallDefence(player, updated);
  }

  function spawnSiegeAranei(player) {
    const state = hallDefenceState(player);
    if (state.phase !== "hall") return;
    const key = player.getUsername?.() ?? player.getIndex?.();
    let npcs = siegeAranei.get(key);
    if (!npcs) siegeAranei.set(key, npcs = new Map());
    SIEGE_HALL.aranei.forEach((def, index) => {
      const injured = Boolean(state.injured?.[index]);
      const old = npcs.get(index);
      if (old?.isRegistered?.()) {
        const id = injured ? def.injured : def.normal;
        if ((old.getNpcTransformationId?.() ?? old.getId?.()) !== id) old.setNpcTransformationId?.(id);
        return;
      }
      const npc = api.spawnNpc({ id: injured ? def.injured : def.normal, x: def.x, y: def.y, z: 1,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (npc) { player.getPrivateArea?.()?.enter(npc); npcs.set(index, npc); }
    });
  }

  function removeSiegeAranei(player) {
    const key = player.getUsername?.() ?? player.getIndex?.();
    for (const npc of siegeAranei.get(key)?.values() ?? []) api.removeNpc(npc);
    siegeAranei.delete(key);
  }

  function handleSiegeLogin({ player }) {
    if (!player || stage(player) !== STAGE.SIEGE) return;
    const state = hallDefenceState(player);
    if (state.phase === "fall-back") {
      // The logout removed the bridge session. Resume the captured fall-back
      // conversation instead of skipping to phase hall; stage stays 118 until
      // the player really finishes vqg4qO.
      if (!player.getDialogueManager?.()?.getCurrent?.()) {
        startTranscript(api, player, NpcIdentifiers.SAREI_5, PAGE,
          "drakan-s-siege-upon-reaching-0-defender-integrity");
      }
      return;
    }
    hall.enter(player);
    if (state.phase === "hall") {
      player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, state);
      publishHallIntegrity(player, state);
    }
    spawnSiegeAranei(player);
  }

  function handleSiegeLogout({ player }) {
    if (!player) return;
    closeHallIntegrity(player);
    removeSiegeAranei(player);
  }

  function handleSiegeHallObject(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.SIEGE) return;
    const objectId = event.definition?.id ?? event.objectId;
    const { x, y, z } = event.location ?? {};
    const state = hallDefenceState(player);
    const inventory = player.getInventory();
    if (!["hall", "breach"].includes(state.phase) || event.object?.getPrivateArea?.() !== hall.sessions.get(player)) return;

    if (objectId === SIEGE_HALL.hammerCrate || objectId === SIEGE_HALL.potionCrate) {
      event.handled = true;
      const item = objectId === SIEGE_HALL.hammerCrate ? SIEGE_HALL.hammer : SIEGE_HALL.healingPotion;
      const label = item === SIEGE_HALL.hammer ? "hammer" : "healing potion";
      if (inventory.contains(item)) {
        player.sendMessage(`You already have a ${label}.`);
        return;
      }
      const before = inventory.getAmount(item);
      inventory.adds(item, 1);
      if (inventory.getAmount(item) === before) {
        player.sendMessage("You have no room in your inventory.");
        return;
      }
      player.sendMessage(`You take a ${label} from the crate.`);
      return;
    }

    if (objectId === SIEGE_HALL.barricade && x === 3167 && y === 7844 && z === 1) {
      event.handled = true;
      if (state.phase === "breach") { startSiegeDrakanBattle(player); return; }
      player.sendMessage("The reinforced door is still holding. Keep repairing the hall and helping the Aranei until Lowerniel breaks through.");
      return;
    }

    if (z !== 1 || state.phase !== "hall") return;
    const repairKey = `${x},${y}`;
    const repair = SIEGE_HALL.repairLocations.get(repairKey);
    if (!repair || objectId !== repair[0]) return;
    event.handled = true;
    if (!inventory.contains(SIEGE_HALL.hammer)) {
      player.sendMessage("You need a hammer from the crate in the hall to repair this.");
      return;
    }
    if (!state.damaged?.[repairKey]) {
      player.sendMessage("You have already repaired this part of the hall.");
      return;
    }
    const damaged = { ...state.damaged };
    delete damaged[repairKey];
    player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, { ...state, damaged });
    hall.refresh?.(player);
    player.sendMessage(repair[0] === SIEGE_HALL.damagedPillar ? "You brace and repair the damaged pillar." : "You repair the damaged window.");
  }

  function routeSiegeHallWindowRepair(event) {
    const player = event?.player;
    const object = event?.object;
    const tile = object?.getLocation?.();
    if (!player || stage(player) !== STAGE.SIEGE || hallDefenceState(player).phase !== "hall" ||
      !tile || tile.getZ() !== 1 || object.getPrivateArea?.() !== hall.sessions.get(player)) return;
    const visibleId = event.definition?.id ?? event.objectId;
    const repair = SIEGE_HALL.repairLocations.get(`${tile.getX()},${tile.getY()}`);
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1]?.toLowerCase();
    if (repair?.[0] !== SIEGE_HALL.damagedWindow ||
      (visibleId !== SIEGE_HALL.damagedWindow && event.objectId !== SIEGE_HALL.damagedWindow) || option !== "repair") return;

    // The north-wall windows are clipped from the outside; cache collision keeps
    // the interior tile directly south of each window reachable for its action.
    event.destination = { x: tile.getX(), y: tile.getY() - 1, z: tile.getZ() };
  }

  function healSiegeAranei(event) {
    const player = event?.player;
    const npc = event?.npc ?? event?.target;
    const npcId = event?.npcId ?? npc?.getId?.();
    if (!player || !npc || !SIEGE_HALL.injuredAranei.includes(npcId) ||
      stage(player) !== STAGE.SIEGE || hallDefenceState(player).phase !== "hall") return false;
    if (npc.getOwner?.() !== player || npc.getArea?.() !== hall.sessions.get(player)) return false;
    event.handled = true;
    const index = SIEGE_HALL.aranei.findIndex(def => def.injured === npcId);
    const state = hallDefenceState(player);
    const inventory = player.getInventory();
    if (!inventory.contains(SIEGE_HALL.healingPotion)) {
      player.sendMessage("The Aranei needs a healing potion from the crate in the hall.");
      return;
    }
    inventory.deleteNumber(SIEGE_HALL.healingPotion, 1);
    npc.setNpcTransformationId?.(SIEGE_HALL.aranei[index].normal);
    const injured = { ...(state.injured ?? {}) };
    delete injured[index];
    player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, { ...state, injured });
    player.sendMessage("You give the healing potion to the Aranei and help them back to their feet.");
  }

  function handleSiegeDrakanHit(event) {
    const npc = event?.npc;
    const hit = event?.hit;
    const fight = npc && siegeDrakanEncounters.get(npc.getArea?.());
    if (!fight || npc !== fight.boss || fight.ending || !hit) return;
    let remaining = Math.max(0, npc.getHitpoints() - fight.thresholdHp);
    for (const part of hit.getHits?.() ?? []) {
      const damage = part.getDamage?.() ?? 0;
      if (damage <= 0) continue;
      const allowed = Math.min(remaining, damage);
      if (allowed < damage) part.setDamage(allowed);
      remaining -= allowed;
    }
    hit.updateTotalDamage?.();
  }

  function handleSiegeDrakanDeath(event) {
    const npc = event?.npc;
    const fight = npc && siegeDrakanEncounters.get(npc.getArea?.());
    if (!fight || npc !== fight.boss || fight.finished) return false;
    // The story exits at 58% health; never let the combat hit skip its cutscene.
    npc.setHitpoints(Math.max(1, fight.thresholdHp));
    fight.ending = true;
    startTranscript(api, fight.player, npc.getId(), PAGE,
      "drakan-s-siege-fighting-lowerniel-upon-lowerniel-reaching-58-hp");
    return true;
  }

  function startWyrdBattle(player) {
    const existing = player.getAttribute(WYRD_AREA_ATTRIBUTE);
    if (existing && existing.isDestroyed?.() !== true) return true;
    // The cutscene is not resumed from its middle after a relog or failed
    // instance. Re-entering the fight returns native progress to its 144 step.
    if (player.getAttribute(WYRD_CUTSCENE_ATTRIBUTE)) {
      player.setAttribute(WYRD_CUTSCENE_ATTRIBUTE, false);
      Scenes.controls(player, false);
      quest.setStage(player, STAGE.WYRDS);
    }
    const area = new WyrdEncounterArea(player.getUsername?.());
    const boss = api.spawnNpc({ id: NpcIdentifiers.WYRD_8, x: 2976, y: 7456, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) {
      player.sendMessage("The Wyrd could not be reached. Return to Veliaf and try again.");
      return false;
    }
    boss.setMultiCombat?.(true);
    boss.setMaxHitpoints(1100);
    boss.setHitpoints(1100);
    area.enter(player);
    area.enter(boss);
    player.setAttribute(WYRD_AREA_ATTRIBUTE, area);
    player.moveTo(new Location(2976, 7452, 0));
    wyrdEncounters.set(area, { area, boss, player, phase: 1, lastCycle: -1, introComplete: false,
      nextAttackAt: Number.MAX_SAFE_INTEGER,
      impactAt: 0, warning: null, sequenceStep: 0, slamSide: "left", slamCount: 0,
      meleeMode: null, poolTiles: new Set(), bloodyBlast: false, blastRadius: 0, blastEndsAt: 0, finished: false,
      ending: false, thresholdsSeen: new Set() });
    return true;
  }

  function activateWyrdEncounter(player) {
    const area = player?.getAttribute?.(WYRD_AREA_ATTRIBUTE);
    const encounter = area && wyrdEncounters.get(area);
    if (!encounter || encounter.player !== player || encounter.finished || encounter.introComplete) return false;
    encounter.introComplete = true;
    encounter.nextAttackAt = World.getProcessCycle() + 4;
    player.sendMessage("The Wyrd breaks free. Its fists knock you back, so leave room behind you. Turn off protection prayers for a screech, and watch its arms before the double slam.");
    return true;
  }

  function startWyrdEnding(encounter) {
    const { player, boss } = encounter;
    if (encounter.finished || stage(player) !== STAGE.WYRDS) return false;
    if (player.getDialogueManager?.()?.isActive?.()) return false;
    // Native 146 marks the held 10% scene and is published before its first line.
    player.setAttribute(WYRD_CUTSCENE_ATTRIBUTE, true);
    quest.setStage(player, STAGE.WYRDS);
    if (!startTranscript(api, player, boss.getId(), PAGE, "fighting-wyrds-upon-reaching-10-hp")) {
      player.setAttribute(WYRD_CUTSCENE_ATTRIBUTE, false);
      return false;
    }
    encounter.ending = true;
    encounter.pendingEnding = false;
    encounter.thresholdsSeen.add(10);
    // The 10% scene is mandatory: stop autoattacks, pending targets and movement.
    player.getCombat().reset();
    boss.getCombat().reset();
    Scenes.controls(player, true, true);
    return true;
  }

  function handleWyrdDeath(event) {
    if (handleSiegeDrakanDeath(event)) return;
    if (handleDrakanDeath(event)) return;
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const encounter = area && wyrdEncounters.get(area);
    if (!encounter || npc !== encounter.boss || encounter.finished || event?.killer !== encounter.player) return;
    // A lethal hit can skip over 10% between NPC processing ticks. Keep the same
    // story outcome as the threshold trigger: Safalaan knocks the player out and flees.
    encounter.pendingEnding = true;
    startWyrdEnding(encounter);
  }

  function handleWyrdBeforeDeath(event) {
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const encounter = area && wyrdEncounters.get(area);
    if (!encounter || npc !== encounter.boss || encounter.finished || event.preventDeath) return;
    // The story cutscene happens at 10% health, not after the NPC's death task.
    // Preserve the boss at that threshold when one large hit would otherwise kill it.
    event.preventDeath = true;
    npc.setHitpoints(110);
    encounter.pendingEnding = true;
    startWyrdEnding(encounter);
  }

  function cleanupWyrdEncounter({ player } = {}) {
    if (!player) return;
    const area = player.getAttribute(WYRD_AREA_ATTRIBUTE);
    const encounter = area && wyrdEncounters.get(area);
    if (encounter) {
      encounter.finished = true;
      clearWyrdPools(encounter, false);
      api.removeNpc(encounter.boss);
      Scenes.controls(player, false);
      area.leave(player, false);
      wyrdEncounters.delete(area);
    }
    player.setAttribute(WYRD_AREA_ATTRIBUTE, null);
  }

  function recoverWyrdEncounterOnLogin({ player } = {}) {
    if (!player || stage(player) !== STAGE.WYRDS) return;
    const location = player.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    // The Wyrd's combat room is process-local. A restart can restore the saved
    // instance tile without its NPC/area, so return only that unfinished stage
    // to Veliaf's real ruins entrance and let the normal transcript restart it.
    if (z !== 0 || x < 2944 || x > 3007 || y < 7424 || y > 7487) return;
    const area = player.getAttribute(WYRD_AREA_ATTRIBUTE);
    if (area && area.isDestroyed?.() !== true) return;
    player.setAttribute(WYRD_AREA_ATTRIBUTE, null);
    player.moveTo(new Location(3506, 9838, 0));
    player.sendMessage("The Wyrd is no longer here. Veliaf waits outside the ruins so you can try again.");
  }

  function inspectWyrdFence(event) {
    const player = event?.player;
    const name = String(event?.definition?.getName?.() ?? "").toLowerCase();
    const objectId = event?.objectId ?? event?.definition?.id ?? event?.definition?.getId?.();
    // The transcript calls this scenery the broken fence; the cache exposes Fence
    // parents 61264/61268 and their Inspect children 61265/61269. Accept either the
    // object option or the legacy Examine path, restricted to the recorded tile.
    if (!player || !player.getAttribute(WYRD_DEFEATED_ATTRIBUTE) ||
      (!["broken fence", "fence"].includes(name) && ![61264, 61265, 61268, 61269].includes(objectId))) return false;
    const location = event.location ?? player.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    if (x == null || y == null || Math.max(Math.abs(x - 3562), Math.abs(y - 3323)) > 2) return false;
    event.handled = true;
    return startTranscript(api, player, 0, PAGE, "fighting-wyrds-inspecting-the-broken-fence");
  }

  function recoverWyrdBurghLandingOnLogin({ player } = {}) {
    if (!player || ![STAGE.FENCE_FOUND, STAGE.FINAL].includes(stage(player)) ||
      !player.getAttribute(WYRD_DEFEATED_ATTRIBUTE) || player.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE)) return;
    const location = player.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    // Migrate saves made by the earlier broken-fence handler, which advanced
    // through the Burgh return but left the player at the swamp fence.
    if (z === 0 && x === 3562 && [3322, 3323].includes(y)) {
      player.moveTo(new Location(WYRD_BURGH_RETURN.x, WYRD_BURGH_RETURN.y, WYRD_BURGH_RETURN.z));
    }
  }

  const SLEPE_REFINERY_NATIVE_STAGES = Object.freeze({
    route: 48, tomb: 50, pickaxe: 52, mined: 54, tunnel: 56,
    fight: 58, cleared: 60, freed: 62, escaped: 64,
  });

  function slepeNativeStage(player) {
    const phase = player?.getAttribute("the-blood-moon-rises:refinery-progress")?.phase;
    if (phase) {
      // Once the refinery route reaches the castle lobby, later native stages
      // (66+) must win over the refinery's own escaped stage 64.
      if (phase === "escaped" && Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 66) {
        return Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE));
      }
      return SLEPE_REFINERY_NATIVE_STAGES[phase] ?? 48;
    }
    return derivedSlepeNativeStage(player?.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {});
  }

  function nativeStage(value, player) {
    if (value === STAGE.SLEPE) return slepeNativeStage(player);
    if (value === STAGE.WYRDS) return player?.getAttribute(WYRD_CUTSCENE_ATTRIBUTE) ? 146 : 144;
    if (value === STAGE.WYRD_DEFEATED) return 148;
    if (value === STAGE.FENCE_FOUND) {
      // 158/160/162 are the earned Castle Drakan handoff sub-stages inside the
      // same quest stage. A login resync must not publish 150 and hide Ivan.
      const saved = Number(player?.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE));
      return Number.isInteger(saved) && saved >= 158 && saved < 164 ? saved : 150;
    }
    if (value === STAGE.COMPLETE) return 178;
    if (value === STAGE.STARTED) {
      // Captured start: accepting Sarius sets 2, the closing line sets 4, the
      // shrine objectbox sets 6, and its first line sets 8.
      if (player?.getAttribute(HIDEOUT_SHRINE_INSPECTED)) return 8;
      return player?.getAttribute(START_DIALOGUE_COMPLETE) ? 4 : 2;
    }
    if (value === STAGE.RETURNED) return 14;
    if (value === STAGE.HIDEOUT) {
      // "I'm ready." arms the trip (10); the Lowerniel cutscene opens at 12.
      return player?.getAttribute(HIDEOUT_CUTSCENE_STARTED) ? 12 : 10;
    }
    if (value === STAGE.CASTLE) return Number(player?.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70;
    if (value === STAGE.ESCAPE) {
      return player?.getAttribute(HUNT_ATTRIBUTE)?.finalDialogueComplete ? 84 : 82;
    }
    if (value === STAGE.BLOOD_HUNT) {
      const huntStage = Number(player?.getAttribute(HUNT_ATTRIBUTE)?.nativeStage);
      return Number.isInteger(huntStage) && huntStage >= 84 && huntStage <= 100 ? huntStage : 84;
    }

    if (value === STAGE.PREPARATIONS) {
      const prep = player?.getAttribute(PREP_ATTRIBUTE) ?? {};
      if (prep.introStarted && !prep.introComplete) return 98;
      if (prep.flail && prep.stakes) return 114;
      if (prep.flail) return 112;
      if (prep.preparationsDiscussed) return 110;
      if (prep.safalaanAnswered) return 108;
      if (prep.stewFed) return 106;
      if (player?.getInventory?.().contains(PREP.stew)) return 104;
      if (prep.gatherStarted) return 102;
      return prep.introComplete ? 100 : 102;
    }
    if (value === STAGE.SIEGE) {
      const phase = player?.getAttribute(SIEGE_DEFENCE_ATTRIBUTE)?.phase;
      return ({ 'fall-back': 118, hall: 120, breach: 122 })[phase] ?? 116;
    }
    if (value === STAGE.THEATRE) {
      const saved = Number(player?.getAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE));
      return Number.isInteger(saved) && saved >= 124 && saved <= 162 ? saved : 124;
    }
    if (value === STAGE.FINAL) {
      const saved = Number(player?.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE));
      if (Number.isInteger(saved) && saved >= 164 && saved <= 176) return saved;
      if (player?.getAttribute(DRAKAN_ENCOUNTER_COMPLETE)) return 174;
      if (player?.getAttribute(DRAKAN_DEATH_CONFIRMED)) return 172;
      if (player?.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE)) return 168;
      if (player?.getAttribute(FINAL_PORTAL_OPEN_ATTRIBUTE)) return 166;
      return 164;
    }
    return value;
  }

  function setTheatreNativeStage(player, value) {
    if (!player || !Number.isInteger(value) || value < 124 || value > 162) return;
    player.setAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE, value);
    player.getPacketSender?.().sendVarbit?.(15464, value);
    syncTheatreActors(player);
  }

  function cleanupTheatreActors(player) {
    const actors = theatreActors.get(player);
    if (!actors) return;
    for (const npc of actors) api.removeNpc(npc);
    theatreActors.delete(player);
  }

  function syncTheatreActors(player) {
    if (!player) return;
    if (stage(player) !== STAGE.THEATRE) {
      cleanupTheatreActors(player);
      return;
    }
    let native = Number(player.getAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE)) || 124;
    const location = player.getLocation?.();
    if (native === 130 && location?.getZ?.() === 0 &&
      location.getX() >= 3640 && location.getX() <= 3690 &&
      location.getY() >= 3200 && location.getY() <= 3245) {
      // A saved stage-130 player who already travelled by the medallion is at
      // the recorded destination; finish the missed native travel update.
      player.setAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE, 132);
      player.getPacketSender?.().sendVarbit?.(15464, 132);
      native = 132;
    }
    const actors = theatreActors.get(player) ?? [];
    const desired = native < 128
      ? [[NpcIdentifiers.IVAN_STROM_13, 3606, 3416, 0]]
      : native < 132
        ? [[15855, 3492, 9626, 0], [15872, 3493, 9628, 0], [15955, 3494, 9627, 0]]
        // The native recording places Sugadinti just west of the Theatre entrance.
        : native >= 132 && native <= 136
          ? [[15956, 3670, 3219, 0]]
          // RSProx places the post-Theatre Veliaf and Ivan outside the old lab.
          // 15874/15851 are transform parents that resolve to their Talk-to
          // children (15878/15855) on native 140-142.
          : native >= 140 && native <= 142
            ? [[15874, 3541, 3257, 0], [15851, 3541, 3260, 0]]
            : [];
    if (actors.length === desired.length && actors.every((npc, index) =>
      !npc.isDestroyed?.() && npc.getId?.() === desired[index][0])) return;
    cleanupTheatreActors(player);
    const spawned = desired.map(([id, x, y, z]) => api.spawnNpc({ id, x, y, z,
      wanderRadius: 0, owner: player, ownerOnly: true })).filter(Boolean);
    if (spawned.length) theatreActors.set(player, spawned);
  }

  function syncHideoutIvan(event) {
    const player = event?.player;
    if (!player || (event.key && event.key !== "the_blood_moon_rises")) return;
    const value = stage(player);
    // Cache NPC 5049 is invisible at 0, becomes the ordinary blisterwood Ivan
    // at 1, and the trade/disguise variant at 2.
    const variant = value === STAGE.STARTED ? 1 : value === STAGE.HIDEOUT ? 2 : 0;
    player.getPacketSender().sendVarbit(HIDEOUT_IVAN_VARBIT, variant);
  }

  function removeSlepeIvan(player) {
    const npc = slepeIvans.get(player);
    if (npc) api.removeNpc(npc);
    slepeIvans.delete(player);
  }

  function cleanupSlepeIvan({ player }) {
    if (!player) return;
    removeSlepeIvan(player);
    const paterdomusIvan = paterdomusIvans.get(player);
    if (paterdomusIvan?.npc) api.removeNpc(paterdomusIvan.npc);
    paterdomusIvans.delete(player);
    const roy = slepeRoys.get(player);
    if (roy) api.removeNpc(roy);
    slepeRoys.delete(player);
  }

  function cleanupSlepeStory(event) {
    if (event?.player && stage(event.player) !== STAGE.SLEPE) cleanupSlepeManor(event);
  }

  function inSlepe(player) {
    const location = player?.getLocation?.();
    if (!location) return false;
    const x = location.getX(), y = location.getY(), z = location.getZ();
    return z === 0 && x >= 3648 && x <= 3791 && y >= 3232 && y <= 3407;
  }

  function syncSlepeIvan(event) {
    const player = event?.player;
    if (!player) return;
    if (stage(player) !== STAGE.SLEPE || !inSlepe(player)) { removeSlepeIvan(player); return; }
    if (slepeIvans.get(player)) return;
    const story = player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {};
    const location = player.getLocation();
    const x = story.ivanFollowing ? Math.max(3727, location.getX() - 1) : 3729;
    const y = story.ivanFollowing ? location.getY() : 3308;
    const npc = api.spawnNpc({ id: NpcIdentifiers.IVAN_STROM_4, x, y, z: location.getZ(),
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return;
    npc.setScriptedMovement?.(true);
    slepeIvans.set(player, npc);
  }

  function syncSlepeRoy(event) {
    const player = event?.player;
    if (!player) return;
    if (stage(player) !== STAGE.SLEPE || !inSlepe(player)) {
      const npc = slepeRoys.get(player);
      if (npc) api.removeNpc(npc);
      slepeRoys.delete(player);
      return;
    }
    if (slepeRoys.has(player)) return;
    const roy = api.spawnNpc({ id: NpcIdentifiers.ROY, x: 3750, y: 3296, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!roy) return;
    roy.setScriptedMovement?.(true);
    slepeRoys.set(player, roy);
  }

  function processSlepeIvan({ player }) {
    if (!player) return;
    syncSlepeIvan({ player });
    syncSlepeRoy({ player });
    const npc = slepeIvans.get(player);
    if (!npc || stage(player) !== STAGE.SLEPE) return;
    const story = player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {};
    if (!story.ivanFollowing) return;
    const from = npc.getLocation(), to = player.getLocation();
    if (from.getZ() !== to.getZ() || from.getDistance(to) > 12) {
      npc.moveTo(new Location(to.getX() - 1, to.getY(), to.getZ()));
    } else if (from.getDistance(to) > 1) {
      api.core.PathFinder.calculateWalkRoute(npc, to.getX(), to.getY());
    }
  }

  function inCrombwickManor(player) {
    const location = player?.getLocation?.();
    if (!location) return false;
    const x = location.getX(), y = location.getY();
    return location.getZ() === 1 && x >= 3713 && x <= 3735 && y >= 3352 && y <= 3372;
  }

  function startSlepeManor(player) {
    if (slepeManors.has(player)) return slepeManors.get(player);
    const story = player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {};
    if (!story.ivanFollowing || !story.royClue || !inCrombwickManor(player)) return null;
    const area = new SlepeManorArea(player);
    area.enter(player);
    slepeManors.set(player, area);
    if (story.manorEnemiesDefeated) {
      // Private-area actors are recreated after login; a saved clear must resume
      // at Veliaf rather than starting the manor wave again.
      area.finished = true;
      spawnSlepeManorStoryActors(player, area);
      return area;
    }
    // shortcut: the current Wiki text requires every manor Vyrewatch but gives no roster;
    // the three cache forms below are the quest-room wave used until an OSRS capture exists.
    const enemies = [
      [NpcIdentifiers.VYREWATCH_54, 3721, 3358],
      [NpcIdentifiers.VYREWATCH_55, 3723, 3359],
      [NpcIdentifiers.VYREWATCH_56, 3727, 3358],
    ];
    for (const [id, x, y] of enemies) {
      const npc = api.spawnNpc({ id, x, y, z: 1, wanderRadius: 0, owner: player, ownerOnly: true });
      if (!npc) {
        for (const spawned of area.enemies) api.removeNpc(spawned);
        area.leave(player, false);
        slepeManors.delete(player);
        player.sendMessage("The Vyrewatch have not gathered in the manor yet. Enter again from the stairs.");
        return null;
      }
      npc.setMultiCombat?.(true);
      area.enter(npc);
      area.enemies.push(npc);
      npc.getCombat?.().attack?.(player);
    }
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, manorEntered: true });
    startTranscript(api, player, NpcIdentifiers.VELIAF_HURTZ, PAGE, "the-truth-hurtz-upon-entering-crombwick-manor");
    return area;
  }

  function spawnSlepeManorStoryActors(player, area) {
    if (area.storyActors.length) return;
    const ivan = api.spawnNpc({ id: NpcIdentifiers.IVAN_STROM_4, x: 3722, y: 3358, z: 1, wanderRadius: 0, owner: player, ownerOnly: true });
    const veliaf = api.spawnNpc({ id: NpcIdentifiers.VELIAF_HURTZ_2, x: 3720, y: 3359, z: 1, wanderRadius: 0, owner: player, ownerOnly: true });
    for (const actor of [ivan, veliaf]) {
      if (!actor) continue;
      actor.setScriptedMovement?.(true);
      area.storyActors.push(actor);
      area.enter(actor);
    }
  }

  function processSlepeManor({ player }) {
    if (!player || stage(player) !== STAGE.SLEPE) return;
    if (inCrombwickManor(player)) startSlepeManor(player);
  }

  function cleanupSlepeManor({ player }) {
    const area = player && slepeManors.get(player);
    if (!area) return;
    for (const npc of [...area.enemies, ...area.storyActors]) if (npc) api.removeNpc(npc);
    area.leave(player, true);
    slepeManors.delete(player);
  }

  function handleSlepeManorDeath(event) {
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const encounter = area instanceof SlepeManorArea ? area : null;
    if (!encounter || encounter.finished || !encounter.enemies.includes(npc) || event?.killer !== encounter.player) return;
    if (encounter.enemies.some(enemy => enemy !== npc && enemy.getHitpoints?.() > 0)) return;
    const player = encounter.player;
    encounter.finished = true;
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...(player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {}), manorEnemiesDefeated: true });
    spawnSlepeManorStoryActors(player, encounter);
    player.sendMessage("The manor is clear. Speak to Veliaf.");
  }

  function handleSlepeJournalCondition({ player, stepId }) {
    if (!player || !["eNc25m", "lq2B7i"].includes(stepId)) return null;
    const hasSpace = player.getInventory().getFreeSlots() > 0;
    return stepId === "eNc25m" ? hasSpace : !hasSpace;
  }

  function readSlepeJournal(event) {
    const player = event?.player;
    if (!player || event.itemId !== ItemIdentifiers.SQUIRES_JOURNAL || stage(player) !== STAGE.SLEPE ||
      !(player.getAttribute(SLEPE_STORY_ATTRIBUTE)?.journalGiven)) return;
    event.handled = true;
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...player.getAttribute(SLEPE_STORY_ATTRIBUTE), journalRead: true });
    player.sendMessage("The squire records that Ivandis left a book describing the Seven Priestly Warriors somewhere within Paterdomus.");
  }

  function slepeStory(player) { return player?.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {}; }

  function paterdomusLocation(player) {
    const loc = player?.getLocation?.();
    if (!loc) return null;
    return { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
  }

  function inPaterdomusCellar(player) {
    const { x, y, z } = paterdomusLocation(player) ?? {};
    return z === 0 && x >= 3434 && x <= 3450 && y >= 9880 && y <= 9910;
  }

  function inPaterdomusTemple(player, plane) {
    const { x, y, z } = paterdomusLocation(player) ?? {};
    return z === plane && x >= 3408 && x <= 3419 && y >= 3483 && y <= 3494;
  }

  function spawnPaterdomusIvan(player, tile) {
    const key = `${tile.x},${tile.y},${tile.z}`;
    const existing = paterdomusIvans.get(player);
    if (existing?.key === key && existing.npc?.isRegistered?.() !== false) return existing.npc;
    if (existing?.npc) api.removeNpc(existing.npc);
    const ivan = api.spawnNpc({ id: NpcIdentifiers.IVAN_STROM_4, ...tile,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (ivan) {
      ivan.setScriptedMovement?.(true);
      paterdomusIvans.set(player, { npc: ivan, key });
    }
    return ivan;
  }

  // Quest Helper's varbit map runs 16-44 through the Slepe and Paterdomus
  // chapters; the castle refinery owns 48-64 after "Lead the way". Mirror those
  // cache stages as the story flags change so NPC/object morphs see real progress.
  function derivedSlepeNativeStage(story) {
    if (story.tombRouteStarted) return 44;
    if (story.writingsRead) return 42;
    if (story.writingsGiven) return 40;
    if (story.booksPlaced) return 38;
    if (story.monksCleared) return 36;
    if (story.monksRequested) return story.monksBattleStarted ? 34 : 32;
    if (story.upstairsTalked) return 30;
    if (story.journalRead) return 28;
    if (story.journalGiven) return 26;
    if (story.manorComplete) return 24;
    if (story.manorEnemiesDefeated) return 22;
    if (story.manorEntered) return 20;
    if (story.royClue) return 18;
    return 16;
  }

  function syncSlepeNativeStage(player) {
    if (!player || stage(player) !== STAGE.SLEPE) return;
    // The refinery owns 48-64 while its route is active.
    if (player.getAttribute("the-blood-moon-rises:refinery-progress")?.phase) return;
    const value = derivedSlepeNativeStage(slepeStory(player));
    if (Number(player.getAttribute(SLEPE_NATIVE_STAGE_ATTRIBUTE)) === value) return;
    player.setAttribute(SLEPE_NATIVE_STAGE_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(15464, value);
  }

  // Quest Helper's ground floor for this scene: the front-door threshold plus the
  // temple interior (3409-3418, 3483-3494). The captured 32 -> 34 transition happens
  // on the tick after the player steps through the opened 3489/3490 doors.
  function inPaterdomusBattleZone(player) {
    const { x, y, z } = paterdomusLocation(player) ?? {};
    return z === 0 && x >= 3409 && x <= 3418 && y >= 3483 && y <= 3494;
  }

  function inPaterdomusBattleBounds(player) {
    const { x, y, z } = paterdomusLocation(player) ?? {};
    return z === 0 && x >= 3408 && x <= 3418 && y >= 3483 && y <= 3494;
  }

  function cleanupPaterdomusBattle(player) {
    const battle = player && paterdomusBattles.get(player);
    if (!battle) return;
    paterdomusBattles.delete(player);
    for (const npc of battle.actors) if (npc?.isRegistered?.() !== false) api.removeNpc(npc);
    for (const object of battle.locs) player.getPacketSender?.().sendObjectRemoval?.(object);
    if (battle.area && player.getArea?.() === battle.area) battle.area.leave(player, false);
  }

  function cleanupPaterdomusBattleOnLogout({ player } = {}) {
    cleanupPaterdomusBattle(player);
  }

  function startPaterdomusBattle(player) {
    if (!player || paterdomusBattles.has(player)) return;
    const story = slepeStory(player);
    if (stage(player) !== STAGE.SLEPE || !story.monksRequested || story.monksCleared) return;
    const area = new PaterdomusBattleArea(player);
    const battle = { area, actors: [], monks: new Set(), locs: [] };
    paterdomusBattles.set(player, battle);
    area.enter(player);
    const target = new Location(PATERDOMUS_BATTLE_TARGET.x, PATERDOMUS_BATTLE_TARGET.y, PATERDOMUS_BATTLE_TARGET.z);
    for (const spawn of PATERDOMUS_BATTLE_SPAWNS) {
      const npc = api.spawnNpc({ id: spawn.id, x: spawn.x, y: spawn.y, z: 0, wanderRadius: 0,
        owner: player, ownerOnly: true, ...(spawn.face === undefined ? {} : { face: spawn.face }) });
      if (!npc) continue;
      battle.actors.push(npc);
      area.enter(npc);
      if (spawn.id === NpcIdentifiers.IVAN_STROM_21) continue;
      npc.setMultiCombat?.(true);
      npc.setPositionToFace?.(target);
      npc.getCombat?.().attack?.(player);
      battle.monks.add(npc);
    }
    for (const door of PATERDOMUS_ESCAPE_DOORS) {
      const object = new api.core.GameObject(door.id, new Location(door.x, door.y, 0), 0, 2, area);
      area.add(object);
      api.core.ObjectManager.register(object, true);
      battle.locs.push(object);
    }
    const expectedMonks = PATERDOMUS_BATTLE_SPAWNS.length - 1;
    if (battle.monks.size !== expectedMonks) {
      cleanupPaterdomusBattle(player);
      return;
    }
    if (!story.monksBattleStarted) {
      player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, monksBattleStarted: true });
      syncSlepeNativeStage(player);
    }
  }

  function processPaterdomusBattle(player) {
    const story = slepeStory(player);
    if (stage(player) !== STAGE.SLEPE || !story.monksRequested || story.monksCleared) {
      cleanupPaterdomusBattle(player);
      return;
    }
    const battle = paterdomusBattles.get(player);
    if (battle) {
      // AreaManager also leaves the scene at its bounds; cleaning up here keeps the
      // captured exit prompt and covers a direct move/logout between area ticks.
      if (player.getArea?.() !== battle.area || !inPaterdomusBattleBounds(player)) {
        cleanupPaterdomusBattle(player);
      }
      return;
    }
    if (inPaterdomusBattleZone(player)) startPaterdomusBattle(player);
  }

  function processSlepeProgress({ player }) {
    if (!player || stage(player) !== STAGE.SLEPE) return;
    syncSlepeNativeStage(player);
    const story = slepeStory(player);
    if (!story.manorComplete) return;
    processPaterdomusBattle(player);
    if (story.monksCleared && inPaterdomusTemple(player, 1)) {
      spawnPaterdomusIvan(player, { x: 3417, y: 3487, z: 1 });
      return;
    }
    if (!story.monksRequested && inPaterdomusCellar(player)) {
      spawnPaterdomusIvan(player, { x: 3441, y: 9897, z: 0 });
      return;
    }
    const current = paterdomusIvans.get(player);
    if (current?.npc) api.removeNpc(current.npc);
    paterdomusIvans.delete(player);
  }

  function syncPaterdomusBookPuzzle({ player }) {
    if (!player || stage(player) !== STAGE.SLEPE) return;
    const story = slepeStory(player);
    const placements = story.booksPlaced ? {} : (story.bookPlacements ?? {});
    SLEPE_PLINTHS.forEach((plinth, index) => {
      const book = SLEPE_BOOKS.find(({ id }) => id === placements[`${plinth.x},${plinth.y}`]);
      player.getPacketSender?.().sendVarbit(SLEPE_PLINTH_VARBITS[index], book?.varbitValue ?? 0);
    });
  }

  function resolveObjectInteraction(event) {
    const definition = event?.definition ?? ObjectDefinition?.forPlayer?.(event?.objectId, event?.player);
    const option = event?.option ?? definition?.getInteractions?.()?.[(event?.clickType ?? 1) - 1] ?? "";
    return { definition, option: String(option).toLowerCase() };
  }

  function eventTile(event) {
    const loc = event?.location;
    if (!loc) return null;
    return { x: typeof loc.getX === "function" ? loc.getX() : loc.x,
      y: typeof loc.getY === "function" ? loc.getY() : loc.y,
      z: typeof loc.getZ === "function" ? loc.getZ() : loc.z ?? 0 };
  }

  function bookOnShelf(player, book, shelf) {
    const story = slepeStory(player);
    if (story.bookPlacements && Object.values(story.bookPlacements).includes(book.id)) return false;
    return book.shelf[0] === shelf.x && book.shelf[1] === shelf.y &&
      player.getInventory().getAmount(book.id) === 0;
  }

  function offerBooksFromShelf(player, shelf) {
    const books = SLEPE_BOOKS.filter((book) => bookOnShelf(player, book, shelf));
    if (!books.length) {
      player.sendMessage("You have already taken the books from this shelf.");
      return;
    }
    const inventory = player.getInventory();
    const chooseBooks = (selected) => {
      const chosen = selected === "Both." ? books : books.filter((book) => book.name === selected);
      if (chosen.length > inventory.getFreeSlots()) {
        player.sendMessage("Make room in your inventory before taking those books.");
        return;
      }
      for (const book of chosen) {
        if (!inventory.adds(book.id, 1)) return;
        player.sendMessage(`You find ${book.name}.`);
      }
    };
    const options = [];
    if (books.length > 1) options.push("Both.", () => chooseBooks("Both."));
    for (const book of books) options.push(book.name, () => chooseBooks(book.name));
    api.sendMultiChatboxPrompt(player, "You find several books. Which would you like to take?", ...options);
  }

  function routePaterdomusWindows(event) {
    const player = event?.player;
    const route = SLEPE_WINDOW_ROUTES.get(event?.definition?.id ?? event?.objectId);
    const loc = event?.object?.getLocation?.();
    const tile = loc && { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
    const story = player && slepeStory(player);
    if (!player || stage(player) !== STAGE.SLEPE || !story.monksCleared || !story.journalRead ||
      !story.upstairsTalked || !route || tile?.x !== route.x || tile?.y !== route.y || tile?.z !== 1) return;
    event.destination = route.destination;
  }

  function handlePaterdomusObject(event) {
    const player = event?.player;
    if (!player || stage(player) !== STAGE.SLEPE) return;
    const story = slepeStory(player);
    if (!story.monksCleared || !story.journalRead || !story.upstairsTalked) return;
    const tile = eventTile(event);
    if (!tile || tile.z !== 1) return;
    const { definition } = resolveObjectInteraction(event);
    const option = String(event?.option ?? "").toLowerCase();
    const objectName = String(definition?.getName?.() ?? "");
    if (option === "search" && /bookcase|bookshelf/i.test(objectName)) {
      const shelf = SLEPE_BOOKS.find(({ shelf: [x, y] }) => x === tile.x && y === tile.y)?.shelf;
      if (!shelf) return;
      event.handled = true;
      offerBooksFromShelf(player, { x: shelf[0], y: shelf[1] });
      return;
    }
    const plinth = SLEPE_PLINTHS.find(({ x, y }) => x === tile.x && y === tile.y);
    if (option === "inspect" && /window|glass/i.test(objectName)) {
      const portrait = SLEPE_PLINTHS.find(({ x, y }) => x === tile.x && y === tile.y);
      if (!portrait) return;
      event.handled = true;
      startTranscript(api, player, 0, PAGE,
        `the-truth-hurtz-inspecting-the-stained-glass-windows-${portrait.window.toLowerCase()}`);
      return;
    }
    if (!plinth || objectName !== "Plinth") return;
    if (option === "inspect") {
      event.handled = true;
      startTranscript(api, player, 0, PAGE, "the-truth-hurtz-inspecting-the-plinths");
      return;
    }
    if (option === "take") {
      const placements = { ...(story.bookPlacements ?? {}) };
      const key = `${plinth.x},${plinth.y}`;
      const bookId = placements[key];
      if (!bookId) return;
      event.handled = true;
      if (player.getInventory().getFreeSlots() <= 0 || !player.getInventory().adds(bookId, 1)) {
        player.sendMessage("Make room in your inventory before taking the book.");
        return;
      }
      delete placements[key];
      player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, bookPlacements: placements });
      player.getPacketSender().sendVarbit(SLEPE_PLINTH_VARBITS[SLEPE_PLINTHS.indexOf(plinth)], 0);
    }
  }

  function handlePaterdomusItemOnObject(event) {
    const player = event?.player;
    if (!player || stage(player) !== STAGE.SLEPE) return;
    const story = slepeStory(player);
    if (!story.monksCleared || !story.journalRead || !story.upstairsTalked || story.booksPlaced) return;
    const tile = eventTile(event);
    if (!tile || tile.z !== 1) return;
    const plinth = SLEPE_PLINTHS.find(({ x, y }) => x === tile.x && y === tile.y);
    const book = SLEPE_BOOKS.find(({ id }) => id === event.itemId);
    if (!plinth || !book) return;
    event.handled = true;
    if (!player.getInventory().contains(event.itemId)) return;
    const placements = { ...(story.bookPlacements ?? {}) };
    const key = `${plinth.x},${plinth.y}`;
    if (placements[key]) {
      if (placements[key] === book.id) {
        player.sendMessage("That book is already on this plinth.");
        return;
      }
      if (!player.getInventory().adds(placements[key], 1)) {
        player.sendMessage("Make room in your inventory before changing the book on this plinth.");
        return;
      }
      player.sendMessage(`You take ${SLEPE_BOOKS.find(({ id }) => id === placements[key])?.name ?? "the misplaced book"} from the plinth.`);
    }
    player.getInventory().deleteNumber(event.itemId, 1);
    placements[key] = book.id;
    const complete = SLEPE_PLINTHS.every((spot) =>
      placements[`${spot.x},${spot.y}`] === spot.itemId);
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, bookPlacements: placements, ...(complete ? { booksPlaced: true } : {}) });
    player.getPacketSender().sendVarbit(SLEPE_PLINTH_VARBITS[SLEPE_PLINTHS.indexOf(plinth)], book.varbitValue);
    player.sendMessage(`You place ${book.name} on the plinth.`);
    if (!complete) return;
    for (const varbit of SLEPE_PLINTH_VARBITS) player.getPacketSender().sendVarbit(varbit, 0);
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, booksPlaced: true, bookPlacements: {} });
    startTranscript(api, player, NpcIdentifiers.IVAN_STROM_4, PAGE, "the-truth-hurtz-upon-completing-the-book-puzzle");
  }

  function handlePaterdomusBattleDeath(event) {
    const player = event?.killer;
    const npc = event?.npc;
    if (!player?.isPlayer?.() || !npc || stage(player) !== STAGE.SLEPE) return;
    const battle = paterdomusBattles.get(player);
    if (!battle?.monks.has(npc)) return;
    battle.monks.delete(npc);
    if (battle.monks.size > 0) return;
    const story = slepeStory(player);
    if (!story.monksRequested || story.monksCleared) return;
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, monksCleared: true });
    const ivan = battle.actors.find((actor) => actor?.getId?.() === NpcIdentifiers.IVAN_STROM_21);
    battle.outroPending = true;
    syncSlepeNativeStage(player);
    player.sendMessage("The Zamorakian monks are defeated. Ivan is waiting upstairs in the temple.");
    if (ivan) {
      startTranscript(api, player, NpcIdentifiers.IVAN_STROM_4, PAGE,
        "the-truth-hurtz-upon-killing-the-monks-of-zamorak", undefined, ivan);
    } else {
      cleanupPaterdomusBattle(player);
    }
  }

  function readPaterdomusBook(event) {
    const player = event?.player;
    const book = SLEPE_BOOKS.find(({ id }) => id === event?.itemId);
    if (!player || !book || stage(player) !== STAGE.SLEPE || !slepeStory(player).upstairsTalked ||
      !player.getInventory().contains(book.id)) return;
    event.handled = true;
    const identities = {
      [ItemIdentifiers.ESSIANDARS_NOTES]: "Essiandar Gar",
      [ItemIdentifiers.SARLS_JOURNAL]: "Sarl Dunegun",
      [ItemIdentifiers.FROM_MISTHALIN_TO_MORYTANIA]: "Iriandul Caistlyn",
      [ItemIdentifiers.SCRUFFY_NOTEBOOK]: "Derygull Templeton",
      [ItemIdentifiers.THE_LIFE_OF_FRIAR]: "Friar Twiblick",
      [ItemIdentifiers.PIOUS_PROCEEDINGS]: "Erysail the Pious",
    };
    player.sendMessage(`The book identifies ${identities[book.id]} as one of the Seven Priestly Warriors.`);
  }

  function readIvandisWritings(event) {
    const player = event?.player;
    if (!player || event?.itemId !== ItemIdentifiers.IVANDIS_WRITINGS || stage(player) !== STAGE.SLEPE ||
      !slepeStory(player).writingsGiven || !player.getInventory().contains(ItemIdentifiers.IVANDIS_WRITINGS)) return;
    event.handled = true;
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...slepeStory(player), writingsRead: true });
    player.sendMessage("Ivandis describes his final attempt to reach Castle Drakan through a tunnel near his tomb.");
  }

  function inspectHideoutShrine(event) {
    const player = event?.player;
    if (!player || !HIDEOUT_SHRINE_IDS.has(event.objectId) || stage(player) !== STAGE.STARTED) return;
    const at = player.getLocation?.();
    const x = typeof at?.getX === "function" ? at.getX() : at?.x;
    const y = typeof at?.getY === "function" ? at.getY() : at?.y;
    const z = typeof at?.getZ === "function" ? at.getZ() : at?.z;
    if (z !== HIDEOUT_SHRINE_TILE.z || Math.abs(x - HIDEOUT_SHRINE_TILE.x) > 2 || Math.abs(y - HIDEOUT_SHRINE_TILE.y) > 2) return;
    event.handled = true;
    player.setAttribute(HIDEOUT_SHRINE_INSPECTED, true);
    // The shrine objectbox opens at native stage 6; its first line advances to 8.
    player.getPacketSender().sendVarbit(15464, 6);
    startTranscript(api, player, 9531, PAGE, "starting-out-inspecting-the-shrine");
  }

  function hideoutOutfitWorn(player) {
    const equipment = player.getEquipment();
    return equipment.get(Equipment.BODY_SLOT)?.getId?.() === VYRE_NOBLE_OUTFIT[0] &&
      equipment.get(Equipment.LEG_SLOT)?.getId?.() === VYRE_NOBLE_OUTFIT[1] &&
      equipment.get(Equipment.FEET_SLOT)?.getId?.() === VYRE_NOBLE_OUTFIT[2];
  }

  function answerHideoutCondition({ player, stepId }) {
    if (!player || !["nMuybV", "wAGF9J", "ysow_0"].includes(stepId)) return null;
    const outfitWorn = hideoutOutfitWorn(player);
    const hasOutfit = outfitWorn || VYRE_NOBLE_OUTFIT.every((id) => player.getInventory().contains(id));
    if (stepId === "nMuybV") return !hasOutfit;
    if (stepId === "wAGF9J") return hasOutfit && !outfitWorn;
    return outfitWorn;
  }

  function answerPreparationStakesCondition({ player, stepId }) {
    if (!player || !["sqIM75", "cv4yCk"].includes(stepId) || stage(player) !== STAGE.PREPARATIONS) return null;
    const hasStakes = Boolean((player.getAttribute(PREP_ATTRIBUTE) ?? {}).stakes && hasItem(player, PREP.stakes));
    return stepId === "sqIM75" ? !hasStakes : hasStakes;
  }

  function openHideoutChest(event) {
    const player = event?.player;
    const visibleId = event?.definition?.id ?? event?.objectId;
    if (!player || visibleId !== HIDEOUT_CHEST_ID || ![STAGE.STARTED, STAGE.HIDEOUT].includes(stage(player))) return false;
    const location = event.location ?? event.object?.getLocation?.();
    const x = typeof location?.getX === "function" ? location.getX() : location?.x;
    const y = typeof location?.getY === "function" ? location.getY() : location?.y;
    const z = typeof location?.getZ === "function" ? location.getZ() : location?.z;
    if (x !== HIDEOUT_CHEST_TILE.x || y !== HIDEOUT_CHEST_TILE.y || z !== HIDEOUT_CHEST_TILE.z ||
      String(event.option ?? "").toLowerCase() !== "open") return false;
    event.handled = true;
    if (VYRE_NOBLE_OUTFIT.every((id) => player.getInventory().contains(id))) {
      player.sendMessage("The chest contains no more of the disguise.");
      return true;
    }
    const inventory = player.getInventory();
    const freeSlots = typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
    const missing = VYRE_NOBLE_OUTFIT.filter((id) => !inventory.contains(id));
    if (freeSlots < missing.length) {
      player.sendMessage("You need more inventory space to take the vyre noble disguise.");
      return true;
    }
    for (const id of missing) inventory.adds(id, 1);
    player.sendMessage("You open the chest and take a vyre noble disguise.");
    return true;
  }

  function stage(player) { return quest.getStage(player); }

  function isInVampyriumRealm(player) {
    if (!player) return false;
    const currentStage = stage(player);
    const location = player.getLocation?.();
    const x = location?.getX?.(), y = location?.getY?.(), z = location?.getZ?.();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const castleRoom = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE));
    const castleFloor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE));
    const inCastle = (currentStage === STAGE.CASTLE || currentStage === STAGE.ESCAPE) &&
      Object.values(CASTLE_ROOM).includes(castleRoom) &&
      (castleFloor === 1 || castleFloor === 2) && (z === 0 || z === 1) &&
      x >= 2300 && x <= 2600 && y >= 7300 && y <= 7440;
    const inTown = [STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(currentStage) &&
      x >= 2560 && x <= 2660 && y >= 7780 && y <= 7900;
    const inFirstBlood = [STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(currentStage) &&
      x >= FIRST_BLOOD_ARENA.minX && x <= FIRST_BLOOD_ARENA.maxX &&
      y >= FIRST_BLOOD_ARENA.minY && y <= FIRST_BLOOD_ARENA.maxY && z === FIRST_BLOOD_ARENA.z;
    // QH inResupplyZone/refuge and the palace approach remain Vampyrium.
    const inRefuge = [STAGE.ESCAPE, STAGE.BLOOD_HUNT, STAGE.PREPARATIONS, STAGE.SIEGE].includes(currentStage) &&
      x >= 2830 && x <= 3060 && y >= 7630 && y <= 7930;
    const inPalace = [STAGE.PREPARATIONS, STAGE.SIEGE].includes(currentStage) &&
      x >= 3154 && x <= 3183 && y >= 7823 && y <= 7861;
    const drakanArea = player.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    const inFinalEncounter = currentStage === STAGE.FINAL && drakanArea != null &&
      player.getArea?.() === drakanArea;
    const inFinalStaging = currentStage === STAGE.FINAL &&
      Boolean(player.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE)) && z === 0 &&
      x >= 2500 && x <= 2516 && y >= 7378 && y <= 7390;
    return inCastle || inTown || inFirstBlood || inRefuge || inPalace ||
      inFinalEncounter || inFinalStaging;
  }

  function handleVampyriumPotionArea(request) {
    if (request?.area !== "vampyrium" || !request.player) return;
    const player = request.player;
    const currentStage = stage(player);
    const location = player.getLocation?.();
    const x = location?.getX?.(), y = location?.getY?.(), z = location?.getZ?.();
    const castleRoom = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE));
    const castleFloor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE));
    const inCastle = (currentStage === STAGE.CASTLE || currentStage === STAGE.ESCAPE) &&
      Object.values(CASTLE_ROOM).includes(castleRoom) &&
      (castleFloor === 1 || castleFloor === 2) && (z === 0 || z === 1) &&
      x >= 2300 && x <= 2600 && y >= 7300 && y <= 7440;
    const inBloodHunt = (currentStage === STAGE.ESCAPE || currentStage === STAGE.BLOOD_HUNT) && z === 0 &&
      x >= 2565 && x <= 2630 && y >= 7790 && y <= 7880;
    const drakanArea = player.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    const inFinalEncounter = currentStage === STAGE.FINAL && drakanArea != null && player.getArea?.() === drakanArea;
    const inFinalStaging = currentStage === STAGE.FINAL && player.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE) === true &&
      z === 0 && x >= 2500 && x <= 2516 && y >= 7378 && y <= 7390;
    request.inside = Boolean(inCastle || inBloodHunt || inFinalStaging || inFinalEncounter);
  }
  function isAtSinsMedallionHideout(event) {
    const location = event?.location ?? event?.npc?.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return z === 0 && Math.abs(x - 3598) <= 12 && Math.abs(y - 9613) <= 12;
  }
  function advance(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
  }
  function hasQuest(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }
  function meetsRequirements(player) {
    return REQUIRED_QUESTS.every(([key]) => hasQuest(player, key)) &&
      REQUIRED_SKILLS.every(([skill, level]) => player.getSkillManager().getMaxLevel(skill) >= level);
  }
  function explainRequirements(player) {
    for (const [key, name] of REQUIRED_QUESTS) {
      if (!hasQuest(player, key)) player.sendMessage(`You must have completed ${name} to start this quest.`);
    }
    for (const [skill, level, name] of REQUIRED_SKILLS) {
      if (player.getSkillManager().getMaxLevel(skill) < level) player.sendMessage(`You need ${level} ${name} to start this quest.`);
    }
  }
  function currentChapter(value) {
    let selected = CHAPTERS[0][1];
    for (const [threshold, chapter] of CHAPTERS) if (value >= threshold) selected = chapter;
    return selected;
  }

  // Only Ivan is proven safe for a Blood Moon post-quest greeting across the
  // shared pages. Other shared NPCs (notably King Roald) can still need a
  // fresh start conversation from another quest at stage 0, so they are left
  // to their canonical index/default selection.
  const IVAN_POST_QUEST_VARIANT = "post-quest-dialogue-ivan";
  const IVAN_SHARED_QUEST_KEYS = Object.freeze([
    "in_search_of_the_myreque", "in_aid_of_the_myreque",
    "darkness_of_hallowvale", "sins_of_the_father", "a_night_at_the_theatre",
  ]);

  function questStage(player, key) {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number.isInteger(request.stage) ? request.stage : null;
  }

  function questActive(player, key) {
    const current = questStage(player, key);
    if (current === null || current <= 0) return false;
    const complete = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", complete);
    return complete.complete !== true;
  }

  function ivanSharedQuestActive(player) {
    return IVAN_SHARED_QUEST_KEYS.some((key) => questActive(player, key));
  }

  function selectVariant(event) {
    const player = event?.player;
    if (!player) return null;
    if (quest.isComplete(player)) {
      const npcName = String(event.definition?.getName?.() ?? "").toLowerCase();
      if (npcName === "efaritay hallow") {
        const efaritayPage = event.pages?.find((entry) => entry.page === TOME_RECLAIM_PAGE);
        if (!efaritayPage?.variants?.includes(TOME_RECLAIM_VARIANT)) return null;
        return !hasTome(player) && tomeUses(player) < 6
          ? { page: TOME_RECLAIM_PAGE, variant: TOME_RECLAIM_VARIANT } : null;
      }
      if (npcName !== "ivan strom" || ivanSharedQuestActive(player)) return null;
      const page = event.pages?.find((entry) => entry.page === PAGE);
      return page?.variants?.includes(IVAN_POST_QUEST_VARIANT)
        ? { page: PAGE, variant: IVAN_POST_QUEST_VARIANT } : null;
    }
    const page = event.pages?.find((entry) => entry.page === PAGE);
    if (!page) return null;
    const value = stage(player);
    if (value === STAGE.SLEPE && event.definition?.getName?.() === "Ivan Strom" && isAtSinsMedallionHideout(event)) {
      const sinsPage = event.pages.find((entry) => entry.page === "Ivan Strom");
      const sinsVariant = "standard-dialogue-after-completing-sins-of-the-father";
      if (hasQuest(player, "sins_of_the_father") && sinsPage?.variants.includes(sinsVariant)) {
        return { page: sinsPage.page, variant: sinsVariant };
      }
      return null;
    }
    if (value === STAGE.RETURNED) {
      if (event.definition?.getName?.() !== "Ivan Strom") return null;
      return page.variants.includes("starting-out-back-at-the-hideout")
        ? { page: PAGE, variant: "starting-out-back-at-the-hideout" } : null;
    }
    if (value === STAGE.NOT_STARTED) {
      if (event.definition?.getName?.() !== "Sarius Guile" || !meetsRequirements(player)) return null;
      return page.variants.includes("starting-out") ? { page: PAGE, variant: "starting-out" } : null;
    }
    const chapter = currentChapter(value);
    const candidates = page.variants.filter((variant) => variant.startsWith(`${chapter}-`));
    if (!candidates.length) return null;
    const useful = candidates.filter((variant) => !variant.includes("again"));
    return { page: PAGE, variant: (useful[0] ?? candidates[0]) };
  }

  function onStartHook(event) {
    if (event?.hook !== START_HOOK || !event.player) return;
    if (!meetsRequirements(event.player)) { explainRequirements(event.player); return; }
    advance(event.player, STAGE.STARTED);
  }

  function prayAtCastleShrine(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const name = String(event?.definition?.getName?.() ?? "").toLowerCase();
    const objectId = event?.definition?.id ?? event?.objectId;
    const atShrine = [[3168, 7707], [3168, 7713]].some(([sx, sy]) => x === sx && y === sy && z === 0);
    if (!player || stage(player) !== STAGE.SLEPE || !slepeStory(player).refineryComplete ||
      !atShrine || (objectId !== 61225 && objectId !== 61226 && name !== "shrine") ||
      String(event?.option ?? "").toLowerCase() !== "pray-to") return false;
    event.handled = true;
    if (!player.getAttribute(CASTLE_SHRINE_ATTRIBUTE)) {
      player.setAttribute(CASTLE_SHRINE_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(CASTLE_SHRINE_VARBIT, 1);
      player.sendMessage("You pray at the vampyric shrine. Drakan's medallion can now return you to Castle Drakan.");
    }
    return true;
  }

  function handleCastleLobbyStairs(request) {
    const player = request?.player;
    const location = request?.object?.getLocation?.();
    if (!player || request?.handled || request.clickType !== 1) return false;
    if (stage(player) === STAGE.SLEPE) {
      if (!slepeStory(player).refineryComplete ||
        player.getAttribute("the-blood-moon-rises:refinery-progress")?.phase !== "escaped" ||
        request.objectId !== CASTLE_DUNGEON_STAIRS.id ||
        location?.getX?.() !== CASTLE_DUNGEON_STAIRS.x ||
        location?.getY?.() !== CASTLE_DUNGEON_STAIRS.y ||
        location?.getZ?.() !== CASTLE_DUNGEON_STAIRS.z) return false;
      request.handled = true;
      setCastleNativeStage(player, 66);
      api.emitCustomEvent("ladders:climbUp", {
        player,
        destination: new Location(CASTLE_LOBBY_LANDING.x, CASTLE_LOBBY_LANDING.y, CASTLE_LOBBY_LANDING.z),
      });
      return true;
    }

    if (stage(player) < STAGE.CASTLE || stage(player) > STAGE.ESCAPE) return false;
    const x = location?.getX?.(), y = location?.getY?.(), z = location?.getZ?.();
    const transition = CASTLE_DOOR_TRANSITIONS.find((entry) =>
      entry.id === request.objectId && entry.x === x && entry.y === y && (entry.z ?? 0) === z &&
      (entry.action === "Climb-up" || entry.action === "Climb-down"));
    if (!transition || Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== transition.from) return false;
    const currentFloor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) || CASTLE_GROUND_FLOOR;
    // A prior generic climb can leave a saved ground-lobby player marked as
    // floor 2. The exact ground stair plus room and physical plane identify
    // this recoverable mismatch; the normal paired climb restores floor 2.
    const recoveredGroundFloor = transition.id === CASTLE_DOOR_IDS.STAIRS_UP && z === 0 &&
      player.getLocation?.()?.getZ?.() === 0 && currentFloor === 2;
    if (currentFloor !== transition.fromFloor && !recoveredGroundFloor) return false;
    request.handled = true;
    if (recoveredGroundFloor) {
      player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, CASTLE_GROUND_FLOOR);
      syncCastleRoom(player);
    }
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, transition.to);
    player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, transition.toFloor ?? CASTLE_GROUND_FLOOR);
    syncCastleRoom(player, transition.facing);
    api.emitCustomEvent(transition.action === "Climb-up" ? "ladders:climbUp" : "ladders:climbDown", {
      player,
      destination: new Location(transition.landing[0], transition.landing[1], transition.landing[2] ?? 0),
    });
    syncCastleActors(player);
    return true;

  }

  function syncCastleLobbyOnLogin({ player }) {
    if (!player || stage(player) !== STAGE.SLEPE ||
      player.getAttribute("the-blood-moon-rises:refinery-progress")?.phase !== "escaped") return;
    const nativeStage = Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 66 ?
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) : 64;
    player.getPacketSender().sendVarbit(15464, nativeStage);
  }

  function syncCastleShrine({ player }) {
    if (!player || stage(player) < STAGE.SLEPE) return;
    player.getPacketSender().sendVarbit(CASTLE_SHRINE_VARBIT,
      player.getAttribute(CASTLE_SHRINE_ATTRIBUTE) ? 1 : 0);
  }

  function syncCastleRoom(player, facing, duringSiege = false) {
    if (!player || (stage(player) !== STAGE.CASTLE && !(duringSiege && stage(player) === STAGE.SIEGE))) return;
    const room = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) || CASTLE_ROOM.LOBBY;
    const floor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) || CASTLE_GROUND_FLOOR;
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, room);
    player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, floor);
    player.getPacketSender().sendVarbit(CASTLE_WORLD_MAP_FLOOR_VARBIT, floor);
    player.getPacketSender().sendVarbit(CASTLE_LAST_ROOM_VARBIT, room);
    player.getPacketSender().sendVarbit(CASTLE_LAST_FLOOR_VARBIT, floor);
    const story = castleStory(player);
    player.getPacketSender().sendVarbit(CASTLE_VANESCULA_WALL_VARBIT, story.vanesculaWallBlown ? 1 : 0);
    player.getPacketSender().sendVarbit(CASTLE_VANESCULA_EMBLEM_VARBIT, story.vanesculaEmblemPlaced
      ? castleEmblemVarbitValue(story.vanesculaEmblemId ?? ItemIdentifiers.DRAKAN_EMBLEM) : 0);
    player.getPacketSender().sendVarbit(CASTLE_RANIS_PARLOUR_EMBLEM_VARBIT, story.ranisParlourEmblemPlaced
      ? castleEmblemVarbitValue(story.ranisParlourEmblemId ?? ItemIdentifiers.DRAKAN_EMBLEM_2) : 0);
    player.getPacketSender().sendVarbit(CASTLE_RANIS_EMBLEM_VARBIT, story.ranisHallwayEmblemPlaced
      ? castleEmblemVarbitValue(story.ranisHallwayEmblemId ?? ItemIdentifiers.DRAKAN_EMBLEM_2) : 0);
    player.getPacketSender().sendVarbit(CASTLE_NORTH_CHAPEL_EMBLEM_VARBIT, story.northChapelHallwayEmblemPlaced
      ? castleEmblemVarbitValue(story.northChapelHallwayEmblemId ?? ItemIdentifiers.DRAKAN_EMBLEM_2) : 0);
    player.getPacketSender().sendVarbit(CASTLE_GALLERY_EMBLEM_VARBIT, story.galleryHallwayEmblemPlaced
      ? castleEmblemVarbitValue(story.galleryHallwayEmblemId ?? ItemIdentifiers.DRAKAN_EMBLEM_2) : 0);
    player.getPacketSender().sendVarbit(CASTLE_VANESCULA_STUDY_EMBLEM_VARBIT, story.vanesculaStudyEmblemPlaced
      ? castleEmblemVarbitValue(story.vanesculaStudyEmblemId ?? ItemIdentifiers.DRAKAN_EMBLEM) : 0);
    if (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 72) {
      player.getPacketSender().sendVarbit(CASTLE_THIRD_EMBLEM_RECEPTACLE_VARBIT,
        story.thirdEmblemClaimed ? 0 : 3);
      player.getPacketSender().sendVarbit(CASTLE_THIRD_EMBLEM_FOUND_VARBIT, story.thirdEmblemClaimed ? 1 : 0);
    }
    if (Number.isInteger(facing)) player.setAttribute(CASTLE_FACING_ATTRIBUTE, facing);
    const lastFacing = Number(player.getAttribute(CASTLE_FACING_ATTRIBUTE));
    if (Number.isInteger(lastFacing) && lastFacing >= 0 && lastFacing <= 7) {
      player.getPacketSender().sendVarbit(CASTLE_LAST_FACING_VARBIT, lastFacing);
    }
    syncCastleExplosiveBarrel(player);
    syncCastleLabNotes(player);
  }

  function syncCastleLabNotes(player) {
    if (!player || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.LABORATORY ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 78 || hasItem(player, CASTLE_LAB_NOTES)) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const tile = new Location(2524, 7378, 0);
    const privateArea = player.getPrivateArea?.() ?? null;
    if (!manager.getGroundItem?.(player.getUsername?.(), CASTLE_LAB_NOTES, tile, privateArea)) {
      manager.registerLocation(player, new Item(CASTLE_LAB_NOTES, 1), tile);
    }
  }

  function syncCastleRoomOnLogin({ player }) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    repairLegacyCastleLanding(player);
    reconcileCastleLobbyFloor(player);
    syncCastleRoom(player);
    player.getPacketSender().sendVarbit(CASTLE_OUTER_LIBRARY_PORTAL_VARBIT,
      castleStory(player).parlourPortalUnlocked ? 1 : 0);
    if (stage(player) === STAGE.CASTLE) {
      syncCastleChapelPortal(player);
      player.getPacketSender().sendVarbit(15464,
        Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70);
      player.getPacketSender().sendVarbit(15543, castleStory(player).gibbous.fireplaceLit ? 1 : 0);
      syncCastleVenatorHead(player);
      syncCastleGibbousDisplayCase(player);
      syncCastleGibbousPortal(player);
    }
    syncCastleActors(player);
    const bookPuzzle = bookPuzzleState(player);
    if (stage(player) === STAGE.CASTLE && Array.isArray(bookPuzzle.positions)) {
      player.setAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE, { ...bookPuzzle, open: false, selected: null });
      writeBookPuzzlePositions(player, bookPuzzle.positions);
    }
    if (stage(player) === STAGE.CASTLE) {
      player.getPacketSender().sendVarbit(CASTLE_GILDED_BOOKCASE_VARBIT,
        castleStory(player).bookPuzzleComplete || bookPuzzle.solved ? 2 : bookPuzzle.prepared ? 1 : 0);
    }
    syncCastleKeyVarbits(player);
    syncCastleBookKey(player);
    syncCastleGibbousKey(player);
    syncCastleSyringeBarrel(player);
  }

  function syncCastleChapelPortal(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    player.getPacketSender().sendVarbit(CASTLE_CHAPEL_PORTAL_VARBIT,
      castleStory(player).chapelPortalOpened ? 1 : 0);
  }

  function syncCastleChapelPortalOnLogin({ player }) {
    syncCastleChapelPortal(player);
  }

  function reconcileCastleLobbyFloor(player) {
    if (!player || Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.LOBBY) return;
    const z = player.getLocation?.()?.getZ?.();
    const expectedFloor = z === 1 ? 2 : z === 0 ? CASTLE_GROUND_FLOOR : null;
    if (expectedFloor !== null && Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== expectedFloor) {
      player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, expectedFloor);
    }
  }

  function syncCastleLobbyFloorOnMapSquareChange({ player }) {
    if (!player || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.LOBBY) return;
    const floor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE));
    reconcileCastleLobbyFloor(player);
    if (Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== floor) syncCastleRoom(player);
  }

  function repairLegacyCastleLanding(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const location = player.getLocation?.();
    const prisonStory = castleStory(player);
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.LABORATORY &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 78 && location?.getZ?.() === 0 &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      location.getX() >= 2488 && location.getX() <= 2510 &&
      location.getY() >= 7363 && location.getY() <= 7387) {
      // The first Solid-key landing placed players west of an uncrossable cache wall.
      player.moveTo(new Location(2514, 7382, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.BASEMENT_HALL &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 76 && prisonStory.prisonersFound &&
      location?.getX?.() >= 2565 && location.getX() <= 2575 &&
      location.getY() >= 7395 && location.getY() <= 7398 && location.getZ() === 0) {
      // The freeing cutscene leaves the player physically inside the cell map chunk.
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.BASEMENT_PRISON);
      player.moveTo(new Location(2570, 7394, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.STOCKPILE_STORAGE &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 78 &&
      location?.getX?.() === 2531 && location.getY() === 7385 && location.getZ() === 0) {
      // Earlier builds left the stockpile click route in a disconnected corner of the room.
      player.moveTo(new Location(2534, 7378, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.UPPER_SOUTH_HALL &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 78 &&
      location?.getZ?.() === 0 && location.getX() >= 2434 && location.getX() <= 2443 &&
      location.getY() >= 7372 && location.getY() <= 7382) {
      // The captured Throne door arrives in Above Study (room 19), not Upper South Hall (room 18).
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.ABOVE_STUDY);
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.VENATOR_PUZZLE &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 76 &&
      location?.getX?.() === 2516 && [7363, 7367].includes(location.getY()) && location.getZ() === 0) {
      // Earlier builds landed at the door or left saved players on the wrong clipped approach tile.
      player.moveTo(new Location(2516, 7368, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.BASEMENT_HALL &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 76 && prisonStory.prisonersFound &&
      location?.getX?.() === 2567 && location.getY() === 7394 && location.getZ() === 0) {
      // The old prison exit left saved players in the isolated cell map chunk.
      player.moveTo(new Location(2570, 7368, 0));

      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.BASEMENT_PRISON &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 76 && prisonStory.prisonersFound &&
      !prisonStory.gibbousKeyClaimed && !hasItem(player, CASTLE_BOOK_ITEMS.gibbousMoonKey) &&
      location?.getZ?.() === 0 && location.getY() === 7394 && location.getX() >= 2565 && location.getX() <= 2575) {
      // The freeing cutscene leaves the player north of the cell wall, beside the bench key.
      player.moveTo(new Location(2570, 7394, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.RANIS_HALL &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      location?.getX?.() >= 2487 && location.getX() <= 2488 && location.getY() === 7405 && location.getZ() === 0) {
      // The earlier hallway landing put saved players behind a clipped wall.
      player.moveTo(new Location(2482, 7403, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.NORTH_CHAPEL &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 1 &&
      location?.getX?.() === 2384 && location.getY() === 7403 && location.getZ() === 0) {
      // The earlier spiral-stair landing was outside the walkable route to the chapel doors.
      player.moveTo(new Location(2386, 7405, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.VANESCULA_HALL &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      location?.getX?.() === 2451 && location.getY() === 7403 && location.getZ() === 0) {
      // The captured upper-hall door lands on the east side of the room at2452,7404.
      player.moveTo(new Location(2452, 7404, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.VANESCULA_STUDY &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      location?.getX?.() === 2471 && location.getY() === 7371 && location.getZ() === 0) {
      // The recorded emblem passage arrives beside the study crate at2474,7371.
      player.moveTo(new Location(2474, 7371, 0));
      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.LOBBY &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      location?.getX?.() === 2314 && location.getY() === 7359 && location.getZ() === 1) {
      // The recording places the upper-lobby arrival two tiles farther north.
      player.moveTo(new Location(2314, 7361, 1));

      return;
    }
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.EXPLOSIVE_ROOM &&
      location?.getX?.() === 2434 && location.getY() === 7386 && location.getZ() === 0) {
      // RSProx's current OSRS recording shows the usable explosive-room arrival at 2437,7386.
      player.moveTo(new Location(2437, 7386, 0));
      return;
    }
    if (!location || location.getX() !== CASTLE_LEGACY_BLOCKED_ARRIVAL.x ||
      location.getY() !== CASTLE_LEGACY_BLOCKED_ARRIVAL.y || location.getZ() !== CASTLE_LEGACY_BLOCKED_ARRIVAL.z) return;
    // Older builds used a nearby NPC/cutscene marker as the player's arrival.
    // Move only that exact stuck save to the actual Vampyrium lobby; quest flags
    // and inventory are left untouched.
    player.moveTo(new Location(CASTLE_VAMPYRIUM_ARRIVAL.x, CASTLE_VAMPYRIUM_ARRIVAL.y,
      CASTLE_VAMPYRIUM_ARRIVAL.z));
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.LOBBY);
  }

  function castleStory(player) {
    const saved = player.getAttribute(CASTLE_STORY_ATTRIBUTE) ?? {};
    return { defeated: [], talkedToVeliaf: false, prisonersFound: false, talkedToIvan: false,
      bookPuzzleComplete: false, stockpileDestroyed: false, ...saved,
      defeated: Array.isArray(saved.defeated) ? saved.defeated : [], gibbous: saved.gibbous ?? {} };
  }

  function bookPuzzleState(player) {
    return player?.getAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE) ?? { open: false, positions: null, selected: null, solved: false };
  }

  function writeBookPuzzlePositions(player, positions) {
    CASTLE_BOOK_VARBITS.forEach((varbit, slot) => player.getPacketSender().sendVarbit(varbit, positions[slot]));
  }

  function openCastleBookPuzzle(player) {
    const state = bookPuzzleState(player);
    if (!state.positions) {
      const cached = CASTLE_BOOK_VARBITS.map(varbit => player.getPacketSender().getVarbit?.(varbit));
      const validCacheOrder = cached.length === 8 && cached.every(Number.isInteger) &&
        [...cached].sort((a, b) => a - b).every((value, index) => value === index + 1) &&
        !cached.every((value, index) => value === index + 1);
      // The cache puzzle exposes the active order through these eight varbits.
      // Its initial permutation is cache/client-generated; the stable fallback
      // below is only used when this server has no valid initial cache values.
      state.positions = validCacheOrder ? cached : [4, 1, 7, 2, 8, 3, 5, 6];
    }
    player.setAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE, { ...state, open: true, selected: null });
    writeBookPuzzlePositions(player, state.positions);
    player.getPacketSender().sendInterface(CASTLE_BOOKCASE_INTERFACE);
  }

  function startCastleBookPuzzlePrompt(player) {
    api.sendMultiChatboxPrompt(player, "The gilded bookcase asks you to arrange the Vampyric Houses alphabetically.",
      "Rearrange the books", () => openCastleBookPuzzle(player),
      "Not yet", () => player.getPacketSender().sendInterfaceRemoval());
  }

  function handleCastleBookWidgetAction(event) {
    const player = event?.player;
    const packet = event?.packet;
    const state = bookPuzzleState(player);
    if (!player || !packet || packet.type !== "widget_action" || packet.groupId !== CASTLE_BOOKCASE_INTERFACE ||
      stage(player) !== STAGE.CASTLE || !state.open || state.solved || !Array.isArray(state.positions)) return;
    const slot = Number.isInteger(packet.slot) && packet.slot >= 0 && packet.slot < 8
      ? packet.slot : packet.childId;
    if (!Number.isInteger(slot) || slot < 0 || slot >= 8) return;
    event.handled = true;
    if (state.selected === null) {
      player.setAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE, { ...state, selected: slot });
      return;
    }
    if (state.selected === slot) {
      player.setAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE, { ...state, selected: null });
      return;
    }
    const positions = [...state.positions];
    [positions[state.selected], positions[slot]] = [positions[slot], positions[state.selected]];
    const solved = positions.every((value, index) => value === index + 1);
    player.setAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE, { open: !solved, positions, selected: null, solved });
    writeBookPuzzlePositions(player, positions);
    if (solved) {
      const story = castleStory(player);
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, bookPuzzleComplete: true });
      player.getPacketSender().sendVarbit(CASTLE_GILDED_BOOKCASE_VARBIT, 2);
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage("You arrange the Vampyric Houses alphabetically. A secret passage opens to the south.");
      syncCastleBookKey(player);
    }
  }

  function syncCastleBookKey(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const story = castleStory(player);
    if (!story.bookPuzzleComplete) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const privateArea = player.getPrivateArea?.() ?? null;
    if (!hasItem(player, CASTLE_BOOK_ITEMS.fullMoonKey)) {
      const keyTile = new Location(...CASTLE_LIBRARY.secretKey, CASTLE_LIBRARY.z);
      if (!manager.getGroundItem?.(player.getUsername?.(), CASTLE_BOOK_ITEMS.fullMoonKey, keyTile, privateArea)) {
        manager.registerLocation(player, new Item(CASTLE_BOOK_ITEMS.fullMoonKey, 1), keyTile);
      }
    }
    if (!story.mysteryJerkyClaimed && !hasItem(player, CASTLE_BOOK_ITEMS.mysteryJerky)) {
      const jerkyTile = new Location(2433, 7415, CASTLE_LIBRARY.z);
      if (!manager.getGroundItem?.(player.getUsername?.(), CASTLE_BOOK_ITEMS.mysteryJerky, jerkyTile, privateArea)) {
        manager.registerLocation(player, new Item(CASTLE_BOOK_ITEMS.mysteryJerky, 1), jerkyTile);
      }
    }
  }

  function syncCastleGibbousKey(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const story = castleStory(player);
    if (!story.prisonersFound || hasItem(player, CASTLE_BOOK_ITEMS.gibbousMoonKey)) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const tile = new Location(2573, 7394, 0);
    if (!manager.getGroundItem?.(player.getUsername?.(), CASTLE_BOOK_ITEMS.gibbousMoonKey, tile,
      player.getPrivateArea?.() ?? null)) {
      manager.registerLocation(player, new Item(CASTLE_BOOK_ITEMS.gibbousMoonKey, 1), tile);
    }
  }

  function syncCastleRanisParlourSkull(player) {
    if (!player) return;
    const gibbous = castleStory(player).gibbous;
    if (stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76 ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.RANIS_PARLOUR ||
      !castleStory(player).ranisParlourEmblemPlaced || gibbous.caseItems?.includes("skull") ||
      hasItem(player, ItemIdentifiers.ORNATE_SKULL)) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const tile = new Location(2471, 7384, 0);
    if (!manager.getGroundItem?.(player.getUsername?.(), ItemIdentifiers.ORNATE_SKULL, tile,
      player.getPrivateArea?.() ?? null)) {
      manager.registerLocation(player, new Item(ItemIdentifiers.ORNATE_SKULL, 1), tile);
    }
  }

  function syncCastleVenatorHead(player) {
    const gibbous = castleStory(player).gibbous;
    player.getPacketSender().sendVarbit(CASTLE_VENATOR_HEAD_VARBIT,
      gibbous.secondGemPlaced ? 3 : gibbous.firstGemPlaced ? 2 : 0);
  }

  function syncCastleGibbousDisplayCase(player) {
    const placed = new Set(castleStory(player).gibbous.caseItems ?? []);
    const value = (placed.has("skull") ? 1 : 0) | (placed.has("knife") ? 2 : 0) |
      (placed.has("hourglass") ? 4 : 0);
    player.getPacketSender().sendVarbit(CASTLE_GIBBOUS_DISPLAY_CASE_VARBIT, value);
  }

  function syncCastleGibbousPortal(player) {
    player.getPacketSender().sendVarbit(CASTLE_GIBBOUS_PORTAL_VARBIT,
      castleStory(player).gibbousGuestPortalOpened ? 1 : 0);
  }

  function syncCastleSyringeBarrel(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const story = castleStory(player);
    if (!story.defeated.includes("kitchen-sanguidae") || story.syringeBarrelClaimed ||
      hasItem(player, CASTLE_KEY_ITEMS.barrel)) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const tile = new Location(2315, 7418, 0);
    if (!manager.getGroundItem?.(player.getUsername?.(), CASTLE_KEY_ITEMS.barrel, tile,
      player.getPrivateArea?.() ?? null)) {
      manager.registerLocation(player, new Item(CASTLE_KEY_ITEMS.barrel, 1), tile);
    }
  }

  function syncGibbousPuzzleClues(player) {
    if (!player || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76 ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VENATOR_PUZZLE) return;
    const story = castleStory(player).gibbous;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const area = player.getPrivateArea?.() ?? null;
    for (const [itemId, tile] of [
      [ItemIdentifiers.ANCESTRAL_DAGGER, [2527, 7368, 0]],
      [ItemIdentifiers.GRID_NOTE_2, [2522, 7366, 0]],
    ]) {
      const location = new Location(...tile);
      // A pickup hook can run before core rejects it for a full inventory. Re-create
      // an unowned clue item even if an earlier attempt persisted its claim flag.
      if (!hasItem(player, itemId) && !manager.getGroundItem?.(player.getUsername?.(), itemId, location, area)) {
        manager.registerLocation(player, new Item(itemId, 1), location);
      }
    }
  }

  function updateGibbousStory(player, changes) {
    const story = castleStory(player);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, {
      ...story, gibbous: { ...story.gibbous, ...changes },
    });
  }

  function chooseGibbousDigit(player, position, offset = 1) {
    const end = Math.min(offset + 3, 8);
    const options = [];
    for (let digit = offset; digit <= end; digit++) {
      options.push(String(digit), () => enterGibbousDigit(player, position, digit));
    }
    if (end < 8) options.push("More symbols...", () => chooseGibbousDigit(player, position, end + 1));
    else if (offset > 1) options.push("Back...", () => chooseGibbousDigit(player, position, 1));
    api.sendMultiChatboxPrompt(player, `Choose the lockbox symbol (${position + 1} of 3)`, ...options);
  }

  function enterGibbousDigit(player, position, digit) {
    const code = [4, 2, 6];
    if (digit !== code[position]) {
      player.sendMessage("The lockbox clicks, but the symbols are in the wrong order.");
      return;
    }
    if (position < code.length - 1) {
      chooseGibbousDigit(player, position + 1);
      return;
    }
    const gibbous = castleStory(player).gibbous;
    if (!gibbous.lockboxOpened && castleKeyGive(player, ItemIdentifiers.FANCY_GEM,
      "The lockbox opens. Inside, you find a fancy gem.")) {
      player.getInventory().deleteNumber(ItemIdentifiers.LOCKBOX, 1);
      updateGibbousStory(player, { lockboxOpened: true });
    }
  }

  function chooseGibbousDoorLetter(player, index = 0, offset = 0) {
    const solution = "SPEAR";
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const end = Math.min(offset + 3, letters.length - 1);
    const options = [];
    for (let cursor = offset; cursor <= end; cursor++) {
      const letter = letters[cursor];
      options.push(letter, () => {
        const current = castleStory(player).gibbous.doorCode ?? "";
        if (letter !== solution[index]) {
          updateGibbousStory(player, { doorCode: "" });
          player.sendMessage("The mechanism resets. The clue on the dagger and grid note may help.");
          return;
        }
        const next = current + letter;
        updateGibbousStory(player, { doorCode: next });
        if (index < solution.length - 1) chooseGibbousDoorLetter(player, index + 1);
        else {
          updateGibbousStory(player, { doorCode: "", spearDoorUnlocked: true });
          player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...castleStory(player), gibbousSpearDoorUnlocked: true });
          player.sendMessage("The lock accepts SPEAR. The door is now unlocked.");
        }
      });
    }
    if (end < letters.length - 1) options.push("More letters...", () => chooseGibbousDoorLetter(player, index, end + 1));
    api.sendMultiChatboxPrompt(player, `Enter the door code (${index + 1} of 5)`, ...options);
  }

  function handleCastleGibbousObjects(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const id = event?.definition?.id ?? event?.objectId;
    const isObject = (...ids) => ids.includes(id) || ids.includes(event?.objectId);
    const option = String(event?.option ?? "").toLowerCase();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76 || z !== 0) return;
    const room = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE));
    const gibbous = castleStory(player).gibbous;
    const clues = new Set(gibbous.clues ?? []);
    if (room === CASTLE_ROOM.ORNATE_KNIFE && isObject(61776) && x === 2449 && y === 7371 && option === "pull") {
      event.handled = true;
      const story = castleStory(player);
      if (!story.gibbousGuestPortalOpened) {
        player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, gibbousGuestPortalOpened: true });
        syncCastleGibbousPortal(player);
        player.sendMessage("You pull the lever and a portal appears.");
      }
      return;
    }
    if (room === CASTLE_ROOM.ORNATE_KNIFE && isObject(61751) && x === 2454 && y === 7372 && option === "search") {
      event.handled = true;
      if (gibbous.knifeClaimed || hasItem(player, ItemIdentifiers.ORNATE_KNIFE)) {
        player.sendMessage("You search the crate, but find nothing of interest.");
        return;
      }
      if (castleKeyGive(player, ItemIdentifiers.ORNATE_KNIFE,
        "You search the crate and take an ornate knife.")) {
        updateGibbousStory(player, { knifeClaimed: true });
      }
      return;
    }
    if (room === CASTLE_ROOM.VENATOR_PUZZLE && (id === 61730 || event?.objectId === 61730) &&
      x === 2521 && y === 7371 && option === "light") {
      event.handled = true;
      if (!gibbous.fireplaceLit) {
        updateGibbousStory(player, { fireplaceLit: true });
        player.getPacketSender?.().sendVarbit?.(15543, 1);
        player.sendMessage("You light the fireplace.");
      }
      return;
    }
    if (room === CASTLE_ROOM.VENATOR_PUZZLE && isObject(61734) && x === 2526 && y === 7371 && option === "search") {
      event.handled = true;
      if (!gibbous.fireplaceLit) { player.sendMessage("The chest is frozen shut. Light the fireplace first."); return; }
      if (gibbous.lockboxClaimed || hasItem(player, ItemIdentifiers.LOCKBOX)) return;
      if (castleKeyGive(player, ItemIdentifiers.LOCKBOX, "You open the chest and find a small lockbox. You take it.")) {
        updateGibbousStory(player, { lockboxClaimed: true });
      }
      return;
    }
    if (room === CASTLE_ROOM.VENATOR_PUZZLE && isObject(61687) && x === 2531 && y === 7367 && option === "inspect") {
      event.handled = true;
      clues.add("head"); updateGibbousStory(player, { clues: [...clues] });
      player.sendMessage("The plaque bears the code 426. The room's banners, shields and braziers represent its digits.");
      return;
    }
    if (room === CASTLE_ROOM.VENATOR_PUZZLE && isObject(61687) && x === 2531 && y === 7367 && option === "search") {
      event.handled = true;
      if (!gibbous.firstGemPlaced || !gibbous.secondGemPlaced) {
        clues.add("head");
        updateGibbousStory(player, { clues: [...clues] });
        player.sendMessage("You inspect the mounted venator head and find the number 426 engraved beneath it.");
        return;
      }
      if (gibbous.hourglassClaimed || hasItem(player, ItemIdentifiers.ORNATE_HOURGLASS)) return;
      if (castleKeyGive(player, ItemIdentifiers.ORNATE_HOURGLASS, "You search the mounted head and take an ornate hourglass.")) {
        updateGibbousStory(player, { hourglassClaimed: true });
      }
      return;
    }
    const bannerTiles = new Map([['2516,7365', [61739, 'banner-1']], ['2516,7370', [61739, 'banner-2']],
      ['2528,7364', [61738, 'banner-3']], ['2528,7371', [61737, 'banner-4']]]);
    const shieldTiles = new Map([['2531,7365', [61736, 'shield-1']], ['2531,7370', [61736, 'shield-2']]]);
    const brazierTiles = new Map([['2520,7364', [61740, 'brazier-1']], ['2520,7371', [61740, 'brazier-2']],
      ['2524,7364', [61740, 'brazier-3']], ['2524,7371', [61740, 'brazier-4']],
      ['2527,7366', [61740, 'brazier-5']], ['2527,7369', [61740, 'brazier-6']]]);
    const tileKey = `${x},${y}`;
    const clue = option === "inspect" && room === CASTLE_ROOM.VENATOR_PUZZLE
      ? [bannerTiles, shieldTiles, brazierTiles].map(tiles => tiles.get(tileKey))
        .find(value => value && isObject(value[0]))?.[1]
      : null;
    if (clue) {
      event.handled = true;
      clues.add(clue); updateGibbousStory(player, { clues: [...clues] });
      player.sendMessage(clue.startsWith("banner") ? "You inspect one of the room's four banners."
        : clue.startsWith("shield") ? "You inspect one of the room's two shields."
        : "You inspect one of the room's six braziers.");
      return;
    }
  }

  function handleCastleGibbousItemAction(event) {
    const player = event?.player;
    const id = event?.itemId;
    const option = String(event?.option ?? "").toLowerCase();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76) return;
    const story = castleStory(player);
    if (id === ItemIdentifiers.LOCKBOX && option === "open" &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.VENATOR_PUZZLE) {
      event.handled = true;
      const clues = new Set(story.gibbous.clues ?? []);
      const counted = ["head", "banner-1", "banner-2", "banner-3", "banner-4", "shield-1", "shield-2",
        "brazier-1", "brazier-2", "brazier-3", "brazier-4", "brazier-5", "brazier-6"];
      if (!story.gibbous.fireplaceLit || !story.gibbous.lockboxClaimed || !counted.every(clues.has, clues)) {
        player.sendMessage("Inspect the mounted head and count its banners, shields and braziers before opening the lockbox.");
        return;
      }
      chooseGibbousDigit(player, 0);
      return;
    }
    if (id === ItemIdentifiers.ANCESTRAL_DAGGER && ["inspect", "check", "read"].includes(option)) {
      event.handled = true;
      updateGibbousStory(player, { daggerRead: true });
      player.sendMessage("A word is etched into the dagger: SPEAR.");
      return;
    }
    if (id === ItemIdentifiers.GRID_NOTE_2 && ["read", "check"].includes(option)) {
      event.handled = true;
      updateGibbousStory(player, { gridNoteRead: true });
      player.sendMessage("The grid note's highlighted letters spell SPEAR.");
      return;
    }
    if (id === ItemIdentifiers.MYSTERIOUS_BOOK && option === "open") {
      event.handled = true;
      if (story.gibbous.bookRead || !hasItem(player, ItemIdentifiers.MYSTERIOUS_BOOK)) return;
      if (castleKeyGive(player, ItemIdentifiers.FANCY_GEM_2, "You open the book and find a fancy gem hidden inside.")) {
        player.getInventory().deleteNumber(ItemIdentifiers.MYSTERIOUS_BOOK, 1);
        updateGibbousStory(player, { bookRead: true });
      }
    }
  }

  function handleCastleGibbousItemOnObject(event) {
    const player = event?.player;
    const id = event?.definition?.id ?? event?.objectId;
    const item = event?.itemId;
    const x = event?.location?.x ?? event?.location?.getX?.();
    const y = event?.location?.y ?? event?.location?.getY?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76 || x !== 2531 || y !== 7367 ||
      (id !== 61687 && event?.objectId !== 61687) ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VENATOR_PUZZLE) return;
    event.handled = true;
    const gibbous = castleStory(player).gibbous;
    const gem = item === ItemIdentifiers.FANCY_GEM ? "firstGemPlaced"
      : item === ItemIdentifiers.FANCY_GEM_2 ? "secondGemPlaced" : null;
    if (!gem) return;
    if (gibbous[gem]) { player.sendMessage("That gem is already set into the mounted head."); return; }
    if (!player.getInventory().contains(item)) return;
    player.getInventory().deleteNumber(item, 1);
    updateGibbousStory(player, { [gem]: true });
    syncCastleVenatorHead(player);
    player.sendMessage("You set the fancy gem into the mounted Venator head.");
  }

  function handleCastleDisplayCaseItem(event) {
    const player = event?.player;
    const id = event?.definition?.id ?? event?.objectId;
    const item = event?.itemId;
    const x = event?.location?.x ?? event?.location?.getX?.();
    const y = event?.location?.y ?? event?.location?.getY?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76 || (id !== 61672 && event?.objectId !== 61672) ||
      x !== 2497 || y !== 7374 ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.DISPLAY_ROOM) return;
    const slot = new Map([[ItemIdentifiers.ORNATE_SKULL, "skull"], [ItemIdentifiers.ORNATE_KNIFE, "knife"],
      [ItemIdentifiers.ORNATE_HOURGLASS, "hourglass"]]).get(item);
    if (!slot) return;
    event.handled = true;
    const state = castleStory(player).gibbous;
    const placed = new Set(state.caseItems ?? []);
    if (placed.has(slot) || !player.getInventory().contains(item)) return;
    player.getInventory().deleteNumber(item, 1);
    placed.add(slot); updateGibbousStory(player, { caseItems: [...placed] });
    syncCastleGibbousDisplayCase(player);
    player.sendMessage(`You place the ${slot} in the display case.`);
    if (placed.size === 3) player.sendMessage("A hidden compartment opens beneath the display case.");
  }

  function searchGibbousDisplayCase(event) {
    const player = event?.player;
    const x = event?.location?.x ?? event?.location?.getX?.();
    const y = event?.location?.y ?? event?.location?.getY?.();
    const id = event?.definition?.id ?? event?.objectId;
    if (!player || (id !== 61672 && event?.objectId !== 61672) || x !== 2497 || y !== 7374 ||
      String(event.option).toLowerCase() !== "search" ||
      stage(player) !== STAGE.CASTLE || Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 76 ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.DISPLAY_ROOM) return;
    event.handled = true;
    if (!new Set(castleStory(player).gibbous.caseItems ?? []).size ||
      new Set(castleStory(player).gibbous.caseItems ?? []).size < 3) {
      player.sendMessage("The display case's compartment is still locked."); return;
    }
    if (hasItem(player, ItemIdentifiers.GILDED_KEY)) return;
    if (castleKeyGive(player, ItemIdentifiers.GILDED_KEY, "You search the compartment and take the gilded key.")) {
      updateGibbousStory(player, { gildedKeyClaimed: true });
    }
  }

  function syncCastleKeyVarbits(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const story = castleStory(player);
    const state = story.newMoon ?? {};
    const vars = player.getPacketSender();
    vars.sendVarbit(CASTLE_KEY_VARBITS.sinkEmptied, state.sinkPlugClaimed ? 1 : 0);
    vars.sendVarbit(CASTLE_KEY_VARBITS.larderSink, state.larderSinkCollapsed ? 2 : state.larderSinkPlugged ? 1 : 0);
    vars.sendVarbit(CASTLE_KEY_VARBITS.corpseOpened, state.corpseOpened ? 1 : 0);
    vars.sendVarbit(CASTLE_KEY_VARBITS.kitchenChest, state.kitchenChestUnlocked ? 1 : 0);
    vars.sendVarbit(CASTLE_KEY_VARBITS.fireplace, state.fullCrestInFireplace ? 1 : 0);
    ["statue1", "statue2", "statue3", "statue4"].forEach((key, index) => {
      vars.sendVarbit(CASTLE_KEY_VARBITS[key], state.weaponPuzzle?.[index] ? 1 : 0);
    });
  }

  function updateCastleKeyStory(player, changes) {
    const story = castleStory(player);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, newMoon: { ...(story.newMoon ?? {}), ...changes } });
    syncCastleKeyVarbits(player);
  }

  function castleKeyGive(player, itemId, message) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() <= 0 || !inventory.adds(itemId, 1)) {
      player.sendMessage("Make room in your inventory before continuing.");
      return false;
    }
    if (message) player.sendMessage(message);
    return true;
  }

  function confirmCastleKeyAction(player, prompt, accept) {
    api.sendMultiChatboxPrompt(player, prompt,
      "Yes.", () => {
        if (player.isRegistered?.() === false || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
        accept();
      },
      "No.", () => {});
  }

  function handleCastleKeyPickup(event) {
    const player = event?.player;
    const id = event?.groundItemId;
    if (!player || stage(player) !== STAGE.CASTLE || id !== CASTLE_KEY_ITEMS.barrel) return;
    const location = event.location;
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    const story = castleStory(player);
    if (x !== 2315 || y !== 7418 || z !== 0) return;
    if (!story.defeated.includes("kitchen-sanguidae")) {
      event.handled = true;
      player.sendMessage("The other Sanguidae are still defending the syringe barrel.");
      return;
    }
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, syringeBarrelClaimed: true });
    player.sendMessage("You take the syringe barrel left by the kitchen aranei.");
  }

  function handleCastleKeyObjects(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70) < 74) return;
    const tile = event.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (z !== 0) return;
    const id = event.definition?.id ?? event.objectId;
    const option = String(event.option ?? "").toLowerCase();
    const story = castleStory(player);
    const key = story.newMoon ?? {};

    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.BEDROOM &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 78 && option === "search") {
      if (id === CASTLE_KEY_LOC_IDS.searchableCrate && x === 2450 && y === 7362) {
        event.handled = true;
        const claimed = Number(story.bedroomChunkyPotionsClaimed) || 0;
        if (claimed >= 2) {
          player.sendMessage("The crate is empty.");
          return;
        }
        api.sendMultiChatboxPrompt(player, "You search the crate and find some foul chunky potions.",
          "Leave them", () => {},
          "Take them", () => {
            const current = castleStory(player);
            const currentClaimed = Number(current.bedroomChunkyPotionsClaimed) || 0;
            if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
              Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.BEDROOM ||
              Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2 || currentClaimed >= 2) return;
            if (castleKeyGive(player, CASTLE_KEY_ITEMS.chunkyPotion1,
              "You take some foul chunky potions from the crate.")) {
              player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...current,
                bedroomChunkyPotionsClaimed: currentClaimed + 1 });
            }
          });
        return;
      }
      if (id === 61752 && x === 2449 && y === 7363) {
        event.handled = true;
        if (story.bedroomJerkyClaimed) {
          player.sendMessage("You search the shelves, but find nothing else of use.");
          return;
        }
        api.sendMultiChatboxPrompt(player, "You search the shelves and find some mysterious jerky.",
          "Leave it", () => {},
          "Take it", () => {
            const current = castleStory(player);
            if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
              Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.BEDROOM ||
              Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2 || current.bedroomJerkyClaimed) return;
            if (castleKeyGive(player, CASTLE_BOOK_ITEMS.mysteryJerky,
              "You take some mysterious jerky from the shelves.")) {
              player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...current, bedroomJerkyClaimed: true });
            }
          });
        return;
      }
    }

    if (id === CASTLE_KEY_LOC_IDS.searchableCrate && x === 2461 && y === 7421 && option === "search" &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.NORTH_LOBBY_HALL &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 &&
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) >= 78) {
      event.handled = true;
      if (story.northLobbyJerkyClaimed) {
        player.sendMessage("The crate is empty.");
        return;
      }
      api.sendMultiChatboxPrompt(player, "You search the crate and find some mysterious jerky.",
        "Leave it", () => {},
        "Take it", () => {
          const current = castleStory(player);
          if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
            Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.NORTH_LOBBY_HALL ||
            Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2 || current.northLobbyJerkyClaimed) return;
          if (castleKeyGive(player, CASTLE_BOOK_ITEMS.mysteryJerky, "You take some mysterious jerky from the crate.")) {
            player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...current, northLobbyJerkyClaimed: true });
          }
        });
      return;
    }

    if (CASTLE_KEY_OBJECTS.crate.has(id) && x === 2315 && y === 7408 && option === "search") {
      event.handled = true;
      if (!story.syringeBarrelClaimed || !hasItem(player, CASTLE_KEY_ITEMS.barrel)) {
        player.sendMessage("The kitchen insects are still guarding the tools; take the syringe barrel first.");
        return;
      }
      if (key.stomachClaimed) { player.sendMessage("The venator stomach crate is empty."); return; }
      if (castleKeyGive(player, CASTLE_KEY_ITEMS.stomach, "You search the south-eastern crate and take the venator stomach.")) {
        updateCastleKeyStory(player, { stomachClaimed: true });
      }
      return;
    }
    if (CASTLE_KEY_OBJECTS.kitchenSink.has(id) && x === 2308 && y === 7411 && option === "inspect") {
      event.handled = true;
      if (key.sinkPlugClaimed) { player.sendMessage("You have already removed the sink plug."); return; }
      confirmCastleKeyAction(player, "Remove the plug from the sink?", () => {
        if (castleStory(player).newMoon?.sinkPlugClaimed) return;
        if (castleKeyGive(player, CASTLE_KEY_ITEMS.plug, "You remove the plug from the kitchen sink.")) {
          updateCastleKeyStory(player, { sinkPlugClaimed: true });
        }
      });
      return;
    }
    if (CASTLE_KEY_OBJECTS.larderSink.has(id) && x === 2356 && y === 7400 && option === "inspect") {
      event.handled = true;
      if (key.larderSinkCollapsed) {
        if (key.pipeClaimed) { player.sendMessage("You already took the broken pipe."); return; }
        confirmCastleKeyAction(player, "Take the pipe?", () => {
          if (castleStory(player).newMoon?.pipeClaimed) return;
          if (castleKeyGive(player, CASTLE_KEY_ITEMS.pipe,
            "You take a long broken pipe from behind the damaged sink.")) {
            updateCastleKeyStory(player, { pipeClaimed: true });
          }
        });
        return;
      }
      api.sendMultiChatboxPrompt(player,
        key.larderSinkPlugged ? "The sink is empty and the drain is plugged." : "The sink is empty.",
        "Turn the tap on", () => {
          const current = castleStory(player).newMoon ?? {};
          if (current.larderSinkCollapsed) return;
          if (!current.larderSinkPlugged) {
            player.sendMessage("You turn the tap on, but the water just goes straight down the drain. You turn it off again.");
            return;
          }
          updateCastleKeyStory(player, { larderSinkCollapsed: true });
          player.sendMessage("You turn the tap on and the sink fills up, but the weight of the water causes it to collapse. A long pipe also breaks away from behind it.");
        },
        "Leave it", () => {});
      return;
    }
    if (CASTLE_KEY_OBJECTS.larderCabinet.has(id) && x === 2360 && y === 7403 && option === "search") {
      event.handled = true;
      if (!key.pipeClaimed || !hasItem(player, CASTLE_KEY_ITEMS.pipe)) {
        player.sendMessage("You need the broken pipe to reach behind the cabinet.");
        return;
      }
      player.sendMessage("The cabinet is too close to reach behind without using the broken pipe on it.");
      return;
    }
    if (CASTLE_KEY_OBJECTS.crate.has(id) && x === 2358 && y === 7397 && option === "search") {
      event.handled = true;
      if (!key.larderSinkCollapsed) { player.sendMessage("The crate is wedged behind the intact sink."); return; }
      if (key.plungerClaimed) { player.sendMessage("The crate is empty."); return; }
      if (castleKeyGive(player, CASTLE_KEY_ITEMS.plunger, "You search the larder crate and take a syringe plunger.")) {
        updateCastleKeyStory(player, { plungerClaimed: true });
      }
      return;
    }
    if (CASTLE_KEY_OBJECTS.corpse.has(id) && x === 2311 && y === 7417 &&
      ["inspect", "search"].includes(option)) {
      event.handled = true;
      if (!key.corpseOpened) { player.sendMessage("The venator corpse is still closed."); return; }
      if (key.tongsClaimed) { player.sendMessage("You have already taken the tongs."); return; }
      if (castleKeyGive(player, CASTLE_KEY_ITEMS.tongs, "You search the opened corpse and take the tongs.")) {
        updateCastleKeyStory(player, { tongsClaimed: true });
      }
      return;
    }
    if (CASTLE_KEY_OBJECTS.kitchenChest.has(id) && x === 2308 && y === 7415 && option === "search") {
      event.handled = true;
      if (!key.kitchenChestUnlocked) { player.sendMessage("The kitchen chest is locked."); return; }
      if (key.leftCrestClaimed) { player.sendMessage("The chest is empty."); return; }
      confirmCastleKeyAction(player, "Search the unlocked chest?", () => {
        if (castleStory(player).newMoon?.leftCrestClaimed) return;
        if (castleKeyGive(player, CASTLE_KEY_ITEMS.leftCrest, "You open the chest and take the left crest half.")) {
          updateCastleKeyStory(player, { leftCrestClaimed: true });
        }
      });
      return;
    }
    if (CASTLE_KEY_OBJECTS.armouryChest.has(id) && x === 2570 && y === 7380 && option === "search") {
      event.handled = true;
      if (!story.defeated.includes("first-venator")) { player.sendMessage("The venator still guards the armoury."); return; }
      if (!Array.isArray(key.weaponPuzzle) || key.weaponPuzzle.length !== 4 || !key.weaponPuzzle.every(Boolean)) {
        player.sendMessage("The chest remains locked until the statues mirror their weapons.");
        return;
      }
      if (key.rightCrestClaimed || hasItem(player, CASTLE_KEY_ITEMS.rightCrest)) { player.sendMessage("You already have the right crest half."); return; }
      if (castleKeyGive(player, CASTLE_KEY_ITEMS.rightCrest, "You search the armoury chest and find the right crest half.")) {
        updateCastleKeyStory(player, { rightCrestClaimed: true });
      }
      return;
    }
    if (CASTLE_KEY_OBJECTS.weaponCase.has(id) && x === 2579 && y === 7382 && option === "search") {
      event.handled = true;
      if (!story.defeated.includes("first-venator")) {
        player.sendMessage("The venator still guards the armoury.");
        return;
      }
      startCastleWeaponChoice(player);
      return;
    }
    if (CASTLE_KEY_OBJECTS.studyFireplace.has(id) && x === 2358 && y === 7386 &&
      ["inspect", "search"].includes(option)) {
      event.handled = true;
      if (!key.fullCrestInFireplace) { player.sendMessage("The fireplace's hidden lock needs the full crest."); return; }
      if (hasItem(player, CASTLE_BOOK_ITEMS.newMoonKey)) {
        player.sendMessage("You already have the new moon key.");
        return;
      }
      confirmCastleKeyAction(player, "Search the fireplace?", () => {
        if (hasItem(player, CASTLE_BOOK_ITEMS.newMoonKey)) return;
        if (castleKeyGive(player, CASTLE_BOOK_ITEMS.newMoonKey, "You search the fireplace and find a key with the symbol of a new moon on it. You take it.")) {
          updateCastleKeyStory(player, { newMoonKeyClaimed: true });
        }
      });
    }
  }

  function startCastleWeaponChoice(player) {
    const choices = [
      ["Take a sword", CASTLE_KEY_ITEMS.sword, "You take a sword from the armoury rack."],
      ["Take a spear", CASTLE_KEY_ITEMS.spear, "You take a spear from the armoury rack."],
      ["Take a mace", CASTLE_KEY_ITEMS.mace, "You take a mace from the armoury rack."],
      ["Take a battleaxe", CASTLE_KEY_ITEMS.axe, "You take a battleaxe from the armoury rack."],
      ["Take nothing", null, ""],
    ];
    api.sendMultiChatboxPrompt(player, "Choose a weapon from the armoury rack.",
      ...choices.flatMap(([label, id, message]) => [label, () => {
        if (id) castleKeyGive(player, id, message);
      }]));
  }

  function handleCastleKeyItemOnObject(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70) < 74) return;
    const tile = event.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const id = event.definition?.id ?? event.objectId;
    const item = event.itemId;
    if (z !== 0) return;
    const story = castleStory(player);
    const key = story.newMoon ?? {};
    const inv = player.getInventory();
    if (CASTLE_KEY_OBJECTS.larderSink.has(id) && x === 2356 && y === 7400 && item === CASTLE_KEY_ITEMS.plug) {
      event.handled = true;
      if (key.larderSinkPlugged || !inv.contains(CASTLE_KEY_ITEMS.plug)) { player.sendMessage("The sink is already plugged."); return; }
      inv.deleteNumber(CASTLE_KEY_ITEMS.plug, 1);
      updateCastleKeyStory(player, { larderSinkPlugged: true });
      player.sendMessage("You plug the larder sink.");
      return;
    }
    if (CASTLE_KEY_OBJECTS.larderCabinet.has(id) && x === 2360 && y === 7403 && item === CASTLE_KEY_ITEMS.pipe) {
      event.handled = true;
      if (!key.larderSinkCollapsed || !key.pipeClaimed || !inv.contains(CASTLE_KEY_ITEMS.pipe)) {
        player.sendMessage("You need the broken pipe from the collapsed larder sink."); return;
      }
      if (key.knifeClaimed) { player.sendMessage("You already took the knife from behind the cabinet."); return; }
      if (castleKeyGive(player, CASTLE_KEY_ITEMS.knife, "You use the broken pipe to reach behind the cabinet and take a sharp knife.")) {
        inv.deleteNumber(CASTLE_KEY_ITEMS.pipe, 1);
        updateCastleKeyStory(player, { knifeClaimed: true });
      }
      return;
    }
    if (CASTLE_KEY_OBJECTS.corpse.has(id) && x === 2311 && y === 7417 && item === CASTLE_KEY_ITEMS.knife) {
      event.handled = true;
      if (!key.knifeClaimed || !inv.contains(CASTLE_KEY_ITEMS.knife)) { player.sendMessage("You need the sharp kitchen knife."); return; }
      if (key.corpseOpened) { player.sendMessage("The venator corpse is already open."); return; }
      updateCastleKeyStory(player, { corpseOpened: true });
      player.sendMessage("You cut open the venator corpse with the sharp kitchen knife.");
      return;
    }
    if (CASTLE_KEY_OBJECTS.kitchenSink.has(id) && x === 2308 && y === 7411 && item === CASTLE_KEY_ITEMS.tongs) {
      event.handled = true;
      if (!key.corpseOpened || !key.tongsClaimed) { player.sendMessage("Open the venator corpse and take its tongs first."); return; }
      if (key.needleClaimed) { player.sendMessage("You have already taken the syringe needle."); return; }
      if (castleKeyGive(player, CASTLE_KEY_ITEMS.needle, "You use the tongs to retrieve a syringe needle from the sink.")) {
        updateCastleKeyStory(player, { needleClaimed: true });
      }
      return;
    }
    if (CASTLE_KEY_OBJECTS.kitchenChest.has(id) && x === 2308 && y === 7415 && item === CASTLE_KEY_ITEMS.fullSyringe) {
      event.handled = true;
      if (!inv.contains(CASTLE_KEY_ITEMS.fullSyringe)) return;
      if (key.kitchenChestUnlocked) { player.sendMessage("The kitchen chest is already unlocked."); return; }
      inv.deleteNumber(CASTLE_KEY_ITEMS.fullSyringe, 1);
      updateCastleKeyStory(player, { kitchenChestUnlocked: true });
      player.sendMessage("You use the venator blood to unlock the kitchen chest.");
      return;
    }
    if (CASTLE_KEY_OBJECTS.studyFireplace.has(id) && x === 2358 && y === 7386 && item === CASTLE_KEY_ITEMS.fullCrest) {
      event.handled = true;
      if (!inv.contains(CASTLE_KEY_ITEMS.fullCrest) || key.fullCrestInFireplace) return;
      inv.deleteNumber(CASTLE_KEY_ITEMS.fullCrest, 1);
      updateCastleKeyStory(player, { fullCrestInFireplace: true });
      player.sendMessage("You place the crest in the slot above the fireplace and hear a clicking sound come from the fireplace itself.");
      confirmCastleKeyAction(player, "Search the fireplace?", () => {
        if (hasItem(player, CASTLE_BOOK_ITEMS.newMoonKey)) return;
        if (castleKeyGive(player, CASTLE_BOOK_ITEMS.newMoonKey, "You search the fireplace and find a key with the symbol of a new moon on it. You take it.")) {
          updateCastleKeyStory(player, { newMoonKeyClaimed: true });
        }
      });
      return;
    }
    const statuePlacements = [
      { id: CASTLE_KEY_LOC_IDS.statue2, x: 2577, y: 7380, item: CASTLE_KEY_ITEMS.axe, slot: 1, name: "battleaxe" },
      { id: CASTLE_KEY_LOC_IDS.statue3, x: 2569, y: 7386, item: CASTLE_KEY_ITEMS.mace, slot: 2, name: "mace" },
      { id: CASTLE_KEY_LOC_IDS.statue4, x: 2569, y: 7380, item: CASTLE_KEY_ITEMS.mace, slot: 3, name: "mace" },
      { id: CASTLE_KEY_LOC_IDS.statue1, x: 2565, y: 7386, item: CASTLE_KEY_ITEMS.sword, slot: 0, name: "sword" },
    ];
    const placement = statuePlacements.find(target => id === target.id && x === target.x && y === target.y && item === target.item);
    if (!placement) return;
    event.handled = true;
    const puzzle = [...(key.weaponPuzzle ?? [false, false, false, false])];
    if (puzzle[placement.slot]) { player.sendMessage("That statue already holds its weapon."); return; }
    if (!inv.contains(item)) return;
    inv.deleteNumber(item, 1);
    puzzle[placement.slot] = true;
    updateCastleKeyStory(player, { weaponPuzzle: puzzle });
    player.sendMessage(`You place the ${placement.name} on the statue.`);
    if (puzzle.every(Boolean)) player.sendMessage("The armoury statues align and the chest unlocks.");
  }

  function handleVanesculaEmblemReceptacle(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE || !castleEventHasObjectId(event, 61634) ||
      x !== 2469 || y !== 7408 || z !== 0 || !CASTLE_EMBLEM_IDS.includes(event?.itemId)) return;
    event.handled = true;
    const inventory = player.getInventory();
    if (!inventory.contains(event.itemId)) return;
    const story = castleStory(player);
    if (story.vanesculaEmblemPlaced) {
      player.sendMessage("An emblem already rests in the receptacle.");
      return;
    }
    inventory.deleteNumber(event.itemId, 1);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, vanesculaEmblemPlaced: true,
      vanesculaEmblemId: event.itemId });
    player.getPacketSender().sendVarbit(CASTLE_VANESCULA_EMBLEM_VARBIT, castleEmblemVarbitValue(event.itemId));
    player.sendMessage("You place the emblem into the receptacle and hear a click come from the nearby door.");
  }

  function handleVanesculaStudyEmblemReceptacle(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      !castleEventHasObjectId(event, CASTLE_VANESCULA_STUDY_RECEPTACLE.id) ||
      x !== CASTLE_VANESCULA_STUDY_RECEPTACLE.x || y !== CASTLE_VANESCULA_STUDY_RECEPTACLE.y ||
      z !== CASTLE_VANESCULA_STUDY_RECEPTACLE.z || !CASTLE_EMBLEM_IDS.includes(event?.itemId)) return;
    event.handled = true;
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VANESCULA_STUDY ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("This receptacle belongs to another part of the castle.");
      return;
    }
    const inventory = player.getInventory();
    if (!inventory.contains(event.itemId)) return;
    const story = castleStory(player);
    if (story.vanesculaStudyEmblemPlaced) {
      player.sendMessage("An emblem already rests in the receptacle.");
      return;
    }
    inventory.deleteNumber(event.itemId, 1);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, vanesculaStudyEmblemPlaced: true,
      vanesculaStudyEmblemId: event.itemId });
    player.getPacketSender().sendVarbit(CASTLE_VANESCULA_STUDY_EMBLEM_VARBIT,
      castleEmblemVarbitValue(event.itemId));
    player.sendMessage("You place the emblem into the receptacle and hear a click come from the nearby door.");
  }

  function handleRanisEmblemReceptacle(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      !castleEventHasObjectId(event, CASTLE_RANIS_EMBLEM_RECEPTACLE.id) ||
      x !== CASTLE_RANIS_EMBLEM_RECEPTACLE.x || y !== CASTLE_RANIS_EMBLEM_RECEPTACLE.y ||
      z !== CASTLE_RANIS_EMBLEM_RECEPTACLE.z || !CASTLE_EMBLEM_IDS.includes(event?.itemId)) return;
    event.handled = true;
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VANESCULA_HALL ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("This receptacle belongs to another part of the castle.");
      return;
    }
    const inventory = player.getInventory();
    if (!inventory.contains(event.itemId)) return;
    const story = castleStory(player);
    if (story.ranisHallwayEmblemPlaced) {
      player.sendMessage("An emblem already rests in the receptacle.");
      return;
    }
    inventory.deleteNumber(event.itemId, 1);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, ranisHallwayEmblemPlaced: true,
      ranisHallwayEmblemId: event.itemId });
    player.getPacketSender().sendVarbit(CASTLE_RANIS_EMBLEM_VARBIT, castleEmblemVarbitValue(event.itemId));
    player.sendMessage("You place the emblem into the receptacle and hear a click come from the nearby door.");
  }

  function handleRanisParlourEmblemReceptacle(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      !castleEventHasObjectId(event, CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE.id) ||
      x !== CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE.x ||
      y !== CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE.y || z !== CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE.z ||
      !CASTLE_EMBLEM_IDS.includes(event?.itemId)) return;
    event.handled = true;
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.RANIS_HALL ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("This receptacle belongs to another part of the castle.");
      return;
    }
    const inventory = player.getInventory();
    if (!inventory.contains(event.itemId)) return;
    const story = castleStory(player);
    if (story.ranisParlourEmblemPlaced) {
      player.sendMessage("An emblem already rests in the receptacle.");
      return;
    }
    inventory.deleteNumber(event.itemId, 1);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, ranisParlourEmblemPlaced: true,
      ranisParlourEmblemId: event.itemId });
    player.getPacketSender().sendVarbit(CASTLE_RANIS_PARLOUR_EMBLEM_VARBIT, castleEmblemVarbitValue(event.itemId));
    player.sendMessage("You place the emblem into the receptacle and hear a click come from the nearby door.");
  }

  function handleCastleLowerEmblemReceptacle(event, receptacle, room, storyFlag, itemKey, varbit) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      !castleEventHasObjectId(event, receptacle.id) || x !== receptacle.x || y !== receptacle.y || z !== receptacle.z ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== room ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 1 ||
      String(event?.option ?? "").toLowerCase() !== "place-item") return;
    event.handled = true;
    const story = castleStory(player);
    if (story[storyFlag]) {
      player.sendMessage("An emblem already rests in this receptacle.");
      return;
    }
    const itemId = CASTLE_EMBLEM_IDS.find(candidate => player.getInventory().contains(candidate));
    if (!itemId) {
      player.sendMessage("It looks like something could be placed into this receptacle, but you aren't carrying anything that would fit into it.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, [storyFlag]: true, [itemKey]: itemId });
    player.getPacketSender().sendVarbit(varbit, castleEmblemVarbitValue(itemId));
    player.sendMessage("You place the emblem into the receptacle and hear a click come from the nearby door.");
  }

  function handleNorthChapelEmblemReceptacle(event) {
    handleCastleLowerEmblemReceptacle(event, CASTLE_NORTH_CHAPEL_EMBLEM_RECEPTACLE,
      CASTLE_ROOM.NORTH_CHAPEL, "northChapelHallwayEmblemPlaced", "northChapelHallwayEmblemId",
      CASTLE_NORTH_CHAPEL_EMBLEM_VARBIT);
  }

  function handleGalleryEmblemReceptacle(event) {
    handleCastleLowerEmblemReceptacle(event, CASTLE_GALLERY_EMBLEM_RECEPTACLE,
      CASTLE_ROOM.WEST_CHAPEL, "galleryHallwayEmblemPlaced", "galleryHallwayEmblemId",
      CASTLE_GALLERY_EMBLEM_VARBIT);
  }

  function castleEmblemVarbitValue(itemId) {
    const index = CASTLE_EMBLEM_IDS.indexOf(itemId);
    return index < 0 ? 0 : index + 1;
  }

  function castleEventHasObjectId(event, id) {
    return event?.objectId === id || event?.definition?.id === id;
  }

  function handleCastleEmblemReceptaclePlacement(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      String(event?.option ?? "").toLowerCase() !== "place-item") return;
    const placements = [
      [CASTLE_NORTH_CHAPEL_EMBLEM_RECEPTACLE, handleNorthChapelEmblemReceptacle],
      [CASTLE_GALLERY_EMBLEM_RECEPTACLE, handleGalleryEmblemReceptacle],
      [CASTLE_VANESCULA_EMBLEM_RECEPTACLE, handleVanesculaEmblemReceptacle],
      [CASTLE_VANESCULA_STUDY_RECEPTACLE, handleVanesculaStudyEmblemReceptacle],
      [CASTLE_RANIS_EMBLEM_RECEPTACLE, handleRanisEmblemReceptacle],
      [CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE, handleRanisParlourEmblemReceptacle],
    ];
    const placement = placements.find(([receptacle]) => castleEventHasObjectId(event, receptacle.id) && receptacle.x === x &&
      receptacle.y === y && receptacle.z === z);
    if (!placement) return;
    event.handled = true;
    const itemId = CASTLE_EMBLEM_IDS.find(candidate => player.getInventory().contains(candidate));
    if (!itemId) {
      player.sendMessage("It looks like something could be placed into this receptacle, but you aren't carrying anything that would fit into it.");
      return;
    }
    placement[1]({ ...event, itemId, handled: false });
  }

  function handleCastleEmblemReceptacleRemoval(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      String(event?.option ?? "").toLowerCase() !== "remove-emblem") return;
    const receptacle = [
      { ...CASTLE_NORTH_CHAPEL_EMBLEM_RECEPTACLE, storyFlag: "northChapelHallwayEmblemPlaced",
        itemKey: "northChapelHallwayEmblemId", room: CASTLE_ROOM.NORTH_CHAPEL, floor: 1,
        varbit: CASTLE_NORTH_CHAPEL_EMBLEM_VARBIT, fallbackItem: ItemIdentifiers.DRAKAN_EMBLEM_2 },
      { ...CASTLE_GALLERY_EMBLEM_RECEPTACLE, storyFlag: "galleryHallwayEmblemPlaced",
        itemKey: "galleryHallwayEmblemId", room: CASTLE_ROOM.WEST_CHAPEL, floor: 1,
        varbit: CASTLE_GALLERY_EMBLEM_VARBIT, fallbackItem: ItemIdentifiers.DRAKAN_EMBLEM_2 },
      { ...CASTLE_VANESCULA_EMBLEM_RECEPTACLE, storyFlag: "vanesculaEmblemPlaced", itemKey: "vanesculaEmblemId",
        room: CASTLE_ROOM.VANESCULA_HALL, varbit: CASTLE_VANESCULA_EMBLEM_VARBIT,
        fallbackItem: ItemIdentifiers.DRAKAN_EMBLEM },
      { ...CASTLE_RANIS_EMBLEM_RECEPTACLE, storyFlag: "ranisHallwayEmblemPlaced", itemKey: "ranisHallwayEmblemId",
        room: CASTLE_ROOM.VANESCULA_HALL, varbit: CASTLE_RANIS_EMBLEM_VARBIT,
        fallbackItem: ItemIdentifiers.DRAKAN_EMBLEM_2 },
      { ...CASTLE_RANIS_PARLOUR_EMBLEM_RECEPTACLE, storyFlag: "ranisParlourEmblemPlaced",
        itemKey: "ranisParlourEmblemId", room: CASTLE_ROOM.RANIS_HALL,
        varbit: CASTLE_RANIS_PARLOUR_EMBLEM_VARBIT, fallbackItem: ItemIdentifiers.DRAKAN_EMBLEM_2 },
      { ...CASTLE_VANESCULA_STUDY_RECEPTACLE, storyFlag: "vanesculaStudyEmblemPlaced",
        itemKey: "vanesculaStudyEmblemId", room: CASTLE_ROOM.VANESCULA_STUDY,
        varbit: CASTLE_VANESCULA_STUDY_EMBLEM_VARBIT, fallbackItem: ItemIdentifiers.DRAKAN_EMBLEM },
    ].find(value => castleEventHasObjectId(event, value.id) && value.x === x && value.y === y && value.z === z);
    if (!receptacle) return;
    event.handled = true;
    const story = castleStory(player);
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== receptacle.room ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== (receptacle.floor ?? 2) || !story[receptacle.storyFlag]) {
      player.sendMessage("There is no emblem here to take.");
      return;
    }
    const itemId = story[receptacle.itemKey] ?? receptacle.fallbackItem;
    if (hasItem(player, itemId)) {
      player.sendMessage("You are already carrying that emblem.");
      return;
    }
    if (!giveInventoryItem(player, itemId, "Make room in your inventory before taking the emblem.")) return;
    const nextStory = { ...story, [receptacle.storyFlag]: false };
    delete nextStory[receptacle.itemKey];
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, nextStory);
    player.getPacketSender().sendVarbit(receptacle.varbit, 0);
    player.sendMessage("You take the emblem from the receptacle.");
  }

  function handleCastleThirdEmblemReceptacle(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70) < 72 ||
      String(event?.option ?? "").toLowerCase() !== "remove-emblem" ||
      !castleEventHasObjectId(event, CASTLE_THIRD_EMBLEM_RECEPTACLE.id) ||
      x !== CASTLE_THIRD_EMBLEM_RECEPTACLE.x || y !== CASTLE_THIRD_EMBLEM_RECEPTACLE.y ||
      z !== CASTLE_THIRD_EMBLEM_RECEPTACLE.z) return;
    event.handled = true;
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VENATOR_ROOM ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("There is no emblem here to take.");
      return;
    }
    const story = castleStory(player);
    if (!story.defeated?.includes("crescent-venator")) {
      player.sendMessage("The Venator still guards the emblem.");
      return;
    }
    if (story.thirdEmblemClaimed || hasItem(player, ItemIdentifiers.DRAKAN_EMBLEM_3)) {
      player.sendMessage("You have already taken this emblem.");
      return;
    }
    if (!giveInventoryItem(player, ItemIdentifiers.DRAKAN_EMBLEM_3,
      "Make room in your inventory before taking the emblem.")) return;
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, thirdEmblemClaimed: true });
    player.getPacketSender().sendVarbit(CASTLE_THIRD_EMBLEM_RECEPTACLE_VARBIT, 0);
    player.getPacketSender().sendVarbit(CASTLE_THIRD_EMBLEM_FOUND_VARBIT, 1);
    player.sendMessage("You take the emblem from the receptacle.");
  }

  function handleCastleVanesculaWall(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      x !== CASTLE_VANESCULA_WALL.x || y !== CASTLE_VANESCULA_WALL.y || z !== CASTLE_VANESCULA_WALL.z ||
      (!castleEventHasObjectId(event, CASTLE_VANESCULA_WALL.id) &&
        !castleEventHasObjectId(event, CASTLE_VANESCULA_WALL.crackedId) &&
        !castleEventHasObjectId(event, CASTLE_VANESCULA_WALL.holeId))) return;
    const option = String(event?.option ?? "").toLowerCase();
    const story = castleStory(player);
    if (option === "inspect" && !story.vanesculaWallBlown) {
      event.handled = true;
      player.sendMessage("The wall is cracked. An explosive barrel could break through it.");
      return;
    }
    if (option !== "enter" || !story.vanesculaWallBlown) return;
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VANESCULA_CHAMBER ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("There is no opening here.");
      return;
    }
    event.handled = true;
    player.moveTo(new Location(2487, 7421, 0));
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.VENATOR_ROOM);
    player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, 2);
    syncCastleRoom(player, 4);
    syncCastleActors(player);
  }

  function handleCastleVanesculaWallItem(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      x !== CASTLE_VANESCULA_WALL.x || y !== CASTLE_VANESCULA_WALL.y || z !== CASTLE_VANESCULA_WALL.z ||
      (!castleEventHasObjectId(event, CASTLE_VANESCULA_WALL.id) &&
        !castleEventHasObjectId(event, CASTLE_VANESCULA_WALL.crackedId) &&
        !castleEventHasObjectId(event, CASTLE_VANESCULA_WALL.holeId)) ||
      event?.itemId !== ItemIdentifiers.EXPLOSIVE_BARREL) return;
    event.handled = true;
    if (Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VANESCULA_CHAMBER ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) return;
    const story = castleStory(player);
    if (story.vanesculaWallBlown) {
      player.sendMessage("The wall is already broken open.");
      return;
    }
    if (!hasItem(player, ItemIdentifiers.TINDERBOX)) {
      player.sendMessage("You need a tinderbox to light the barrel.");
      return;
    }
    if (!hasItem(player, ItemIdentifiers.EXPLOSIVE_BARREL)) {
      player.sendMessage("You need an explosive barrel.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.EXPLOSIVE_BARREL, 1);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, vanesculaWallBlown: true });
    player.getPacketSender().sendVarbit(CASTLE_VANESCULA_WALL_VARBIT, 1);
    player.sendMessage("You wedge the explosive barrel into the crack and light it. The wall collapses.");
  }

  function inspectRanisCrackedWall(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      !["enter", "inspect"].includes(String(event?.option ?? "").toLowerCase()) ||
      !castleEventHasObjectId(event, 61612) || x !== 2482 || y !== 7412 || z !== 0 ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.VENATOR_ROOM ||
      !castleStory(player).thirdEmblemClaimed) return;
    event.handled = true;
    player.moveTo(new Location(2491, 7364, 0));
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.VANESCULA_CHAMBER);
    player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, 2);
    syncCastleRoom(player, 6);
  }

  function handleCastleKeyItemOnItem(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const used = event.usedItemId;
    const withItem = event.usedWithItemId;
    const pair = [used, withItem];
    const inv = player.getInventory();
    const syringeParts = [CASTLE_KEY_ITEMS.barrel, CASTLE_KEY_ITEMS.plunger, CASTLE_KEY_ITEMS.needle];
    if (pair.some(id => syringeParts.includes(id))) {
      event.handled = true;
      for (const id of syringeParts) {
        if (!inv.contains(id)) { player.sendMessage("You need the syringe barrel, plunger and needle together."); return; }
      }
      syringeParts.forEach(id => inv.deleteNumber(id, 1));
      castleKeyGive(player, CASTLE_KEY_ITEMS.emptySyringe, "You assemble the syringe.");
      return;
    }
    if (pair.includes(CASTLE_KEY_ITEMS.emptySyringe) && pair.includes(CASTLE_KEY_ITEMS.stomach)) {
      event.handled = true;
      if (!inv.contains(CASTLE_KEY_ITEMS.emptySyringe) || !inv.contains(CASTLE_KEY_ITEMS.stomach)) return;
      inv.deleteNumber(CASTLE_KEY_ITEMS.emptySyringe, 1);
      inv.deleteNumber(CASTLE_KEY_ITEMS.stomach, 1);
      castleKeyGive(player, CASTLE_KEY_ITEMS.fullSyringe, "You draw blood from the venator stomach into the syringe.");
      return;
    }
    if (pair.includes(CASTLE_KEY_ITEMS.leftCrest) && pair.includes(CASTLE_KEY_ITEMS.rightCrest)) {
      event.handled = true;
      if (!inv.contains(CASTLE_KEY_ITEMS.leftCrest) || !inv.contains(CASTLE_KEY_ITEMS.rightCrest)) return;
      inv.deleteNumber(CASTLE_KEY_ITEMS.leftCrest, 1);
      inv.deleteNumber(CASTLE_KEY_ITEMS.rightCrest, 1);
      castleKeyGive(player, CASTLE_KEY_ITEMS.fullCrest, "You join the two halves into a full crest.");
    }
  }

  function processCastleDialogueTransition({ player }) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const pending = player.getAttribute(CASTLE_TRANSITION_PENDING_ATTRIBUTE);
    if (pending !== "free-prisoners" || player.getDialogueManager?.()?.getCurrent?.()) return;
    const story = castleStory(player);
    if (!story.prisonersFound) {
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, prisonersFound: true });
      setCastleNativeStage(player, 76);
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.BASEMENT_PRISON);
      player.moveTo(new Location(2570, 7394, 0));
      syncCastleActors(player);
      syncCastleGibbousKey(player);
    }
    player.setAttribute(CASTLE_TRANSITION_PENDING_ATTRIBUTE, null);
  }

  function handleCastleCellDoor(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const id = event?.definition?.id ?? event?.objectId;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) !== 74 ||
      ![61584, 61585].includes(id) || x !== 2570 || y !== 7369 || z !== 0 ||
      String(event?.option ?? "").toLowerCase() !== "enter") return;
    event.handled = true;
    if (!hasItem(player, CASTLE_BOOK_ITEMS.newMoonKey)) {
      player.sendMessage("The north cell door needs the new moon key from the castle fireplace.");
      return;
    }
    if (castleStory(player).prisonersFound) return;
    if (!startTranscript(api, player, 0, PAGE, "escape-from-castle-drakan-upon-finding-safalaan-and-vanescula")) {
      event.handled = false;
      return;
    }
    player.setAttribute(CASTLE_TRANSITION_PENDING_ATTRIBUTE, "free-prisoners");
  }

  function handleCastleBookPickup(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.getX?.() ?? tile?.x;
    const y = tile?.getY?.() ?? tile?.y;
    const z = tile?.getZ?.() ?? tile?.z;
    if (player && event?.groundItemId === ItemIdentifiers.ORNATE_SKULL && stage(player) === STAGE.CASTLE &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.RANIS_PARLOUR &&
      x === 2471 && y === 7384 && z === 0) {
      if ((player.getInventory?.()?.getFreeSlots?.() ?? 1) < 1) return;
      updateGibbousStory(player, { skullClaimed: true });
      player.sendMessage("You pick up the ornate skull from the floor.");
      return;
    }
    if (player && stage(player) === STAGE.CASTLE && z === 0 &&
      ((event?.groundItemId === ItemIdentifiers.ANCESTRAL_DAGGER && x === 2527 && y === 7368) ||
       (event?.groundItemId === ItemIdentifiers.GRID_NOTE_2 && x === 2522 && y === 7366))) {
      if ((player.getInventory?.()?.getFreeSlots?.() ?? 1) < 1) return;
      const story = castleStory(player);
      const dagger = event.groundItemId === ItemIdentifiers.ANCESTRAL_DAGGER;
      updateGibbousStory(player, { [dagger ? "daggerClaimed" : "gridNoteClaimed"]: true });
      player.sendMessage(dagger ? "You take the ancestral dagger." : "You take the grid note.");
      return;
    }
    if (player && event?.groundItemId === CASTLE_BOOK_ITEMS.mysteryJerky && stage(player) === STAGE.CASTLE &&
      x === 2433 && y === 7415 && z === CASTLE_LIBRARY.z && castleStory(player).bookPuzzleComplete) {
      const story = castleStory(player);
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, mysteryJerkyClaimed: true });
      player.sendMessage("You take some mysterious jerky from the table.");
      return;
    }
    if (player && event?.groundItemId === CASTLE_BOOK_ITEMS.gibbousMoonKey && stage(player) === STAGE.CASTLE &&
      x === 2573 && y === 7395 && z === 0 && castleStory(player).prisonersFound) {
      const story = castleStory(player);
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, gibbousKeyClaimed: true });
      player.sendMessage("You pick up the gibbous moon key from the bench.");
      return;
    }
    if (!player || event?.groundItemId !== CASTLE_BOOK_ITEMS.fullMoonKey || stage(player) !== STAGE.CASTLE ||
      x !== CASTLE_LIBRARY.secretKey[0] || y !== CASTLE_LIBRARY.secretKey[1] ||
      z !== CASTLE_LIBRARY.z || !castleStory(player).bookPuzzleComplete) return;
    const story = castleStory(player);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, fullMoonKeyClaimed: true });
    player.sendMessage("You take the full moon key from the table.");
  }

  function setCastleNativeStage(player, value) {
    player.setAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(15464, value);
  }

  function castleActors(player) {
    let actors = CASTLE_ACTORS.get(player);
    if (!actors) {
      actors = new Map();
      CASTLE_ACTORS.set(player, actors);
    }
    return actors;
  }

  function spawnCastleActor(player, key, id, tile, hostile = false) {
    const actors = castleActors(player);
    const existing = actors.get(key);
    if (existing && existing.getHitpoints?.() > 0 &&
      (existing.getId?.() ?? existing.id) === id) return existing;
    if (existing) removeCastleActor(player, key);
    const npc = api.spawnNpc({ id, x: tile[0], y: tile[1], z: tile[2] ?? 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) return null;
    if (hostile) npc.setMultiCombat?.(true);
    else npc.setScriptedMovement?.(true);
    actors.set(key, npc);
    CASTLE_ACTOR_OWNERS.set(npc, { player, key });
    return npc;
  }

  function removeCastleActor(player, key) {
    const actors = CASTLE_ACTORS.get(player);
    const npc = actors?.get(key);
    if (!npc) return;
    CASTLE_ACTOR_OWNERS.delete(npc);
    api.removeNpc(npc);
    actors.delete(key);
    if (actors.size === 0) CASTLE_ACTORS.delete(player);
  }

  function syncCastleActors(player) {
    if (!player || stage(player) !== STAGE.CASTLE) return;
    const progress = Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70;
    const room = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) || CASTLE_ROOM.LOBBY;
    let story = castleStory(player);
    const defeated = story.defeated ?? [];
    if (defeated.includes("kitchen-sanguidae") &&
      !KITCHEN_SANGUIDAE.some(({ key }) => defeated.includes(key))) {
      // Older builds saved the whole swarm as defeated after killing the one
      // Sanguidae they spawned. Retain that kill against the nearest recorded
      // anchor and let the remaining two live enemies finish the chapter.
      story = { ...story, defeated: [...defeated.filter(key => key !== "kitchen-sanguidae"), "kitchen-sanguidae-south"] };
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, story);
    }
    if (progress >= 72 && progress < 76) {
      // The captured quest uses the follower variant after the first
      // conversation. Keep him available through the prison stage so a relog
      // or an interrupted conversation cannot remove the supplies dialogue.
      // He remains at the Gallery Hall anchor while the player explores the
      // cellar; the paired Castle route lets them return and speak to him.
      spawnCastleActor(player, "veliaf-gallery",
        story.talkedToVeliaf ? CASTLE_NPC.VELIAF_FOLLOWER : CASTLE_NPC.VELIAF_GALLERY,
        [2326, 7397]);
    } else {
      removeCastleActor(player, "veliaf-gallery");
    }
    if (progress >= 72) {
      if (room === CASTLE_ROOM.BASEMENT_VENATOR && !story.defeated.includes("first-venator"))
        spawnCastleActor(player, "first-venator", CASTLE_NPC.VENATOR_5, [2568, 7383], true);
      else removeCastleActor(player, "first-venator");
      if (room === CASTLE_ROOM.VENATOR_ROOM && !story.defeated.includes("crescent-venator"))
        // QH points at the emblem holder in this room; the adjacent floor tile
        // is the nearest collision-clear combat anchor.
        spawnCastleActor(player, "crescent-venator", CASTLE_NPC.VENATOR, [2486, 7420], true);
      else removeCastleActor(player, "crescent-venator");
      if (room === CASTLE_ROOM.KITCHEN && !story.defeated.includes("kitchen-sanguidae")) {
        for (const { key, tile } of KITCHEN_SANGUIDAE) {
          if (!story.defeated.includes(key)) spawnCastleActor(player, key, CASTLE_NPC.SANGUIDAE, tile, true);
        }
      } else {
        for (const { key } of KITCHEN_SANGUIDAE) removeCastleActor(player, key);
      }
      if (room === CASTLE_ROOM.BASEMENT_STORAGE) {
        spawnCastleActor(player, "storage-sanguidae-east", CASTLE_NPC.SANGUIDAE, [2590, 7385], true);
        spawnCastleActor(player, "storage-sanguidae-north", CASTLE_NPC.SANGUIDAE, [2593, 7382], true);
      } else {
        removeCastleActor(player, "storage-sanguidae-east");
        removeCastleActor(player, "storage-sanguidae-north");
      }
    }
    if (progress >= 72 && Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.RANIS_HALL &&
      !story.defeated.includes("ranis-sanguidae")) {
      spawnCastleActor(player, "ranis-sanguidae", CASTLE_NPC.SANGUIDAE, [2488, 7403], true);
    }
    if (progress >= 76 && room === CASTLE_ROOM.RANIS_PARLOUR && story.ranisParlourEmblemPlaced) {
      spawnCastleActor(player, "ranis-parlour-crow-west", CASTLE_NPC.CROW, [2475, 7385]);
      spawnCastleActor(player, "ranis-parlour-crow-east", CASTLE_NPC.CROW, [2469, 7382]);
      syncCastleRanisParlourSkull(player);
    } else {
      removeCastleActor(player, "ranis-parlour-crow-west");
      removeCastleActor(player, "ranis-parlour-crow-east");
    }
    if (progress >= 76 && story.prisonersFound) {
      // Keep the captured pickup tile (2573, 7396) clear so the key on the bench
      // can be reached and picked up normally.
      spawnCastleActor(player, "safalaan-prison", CASTLE_NPC.SAFALAAN_PRISON, [2571, 7397]);
      spawnCastleActor(player, "vanescula-prison", CASTLE_NPC.VANESCULA_PRISON, [2576, 7396]);
    }
    if (progress >= 76 && room === CASTLE_ROOM.VENATOR_PUZZLE) {
      syncGibbousPuzzleClues(player);
      if (!story.defeated.includes("gibbous-venator"))
        spawnCastleActor(player, "gibbous-venator", CASTLE_NPC.VENATOR_GIBBOUS, [2521, 7368], true);
    } else {
      removeCastleActor(player, "gibbous-venator");
    }
    if (progress >= 76 && room === CASTLE_ROOM.IVAN_ROOM) {
      if (!story.defeated.includes("library-venator"))
        spawnCastleActor(player, "library-venator", CASTLE_NPC.VENATOR, [2455, 7391], true);
      if (story.defeated.includes("library-venator") && !story.bookPuzzleComplete)
        spawnCastleActor(player, "ivan-library", CASTLE_NPC.IVAN_LIBRARY, [2455, 7389]);
      else removeCastleActor(player, "ivan-library");
    } else {
      removeCastleActor(player, "library-venator");
      removeCastleActor(player, "ivan-library");
    }
    if (progress >= 78) {
      spawnCastleActor(player, "ivan-entry-hall", CASTLE_NPC.IVAN_ENTRY_HALL, [2313, 7371]);
      spawnCastleActor(player, "veliaf-entry-hall", CASTLE_NPC.VELIAF_ENTRY_HALL, [2313, 7372]);
    }
  }

  function cleanupCastleActors({ player }) {
    const actors = CASTLE_ACTORS.get(player);
    if (!actors) return;
    for (const npc of actors.values()) {
      CASTLE_ACTOR_OWNERS.delete(npc);
      api.removeNpc(npc);
    }
    CASTLE_ACTORS.delete(player);
  }

  function handleCastleNpcDeath(event) {
    const npc = event?.npc;
    const owner = CASTLE_ACTOR_OWNERS.get(npc);
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!owner || owner.player !== player || stage(player) !== STAGE.CASTLE) return;
    const story = castleStory(player);
    if (["first-venator", "crescent-venator", "gibbous-venator", "library-venator", "ranis-sanguidae"].includes(owner.key)) {
      const defeated = [...new Set([...story.defeated, owner.key])];
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, defeated });
      removeCastleActor(player, owner.key);
      if (owner.key === "library-venator") syncCastleActors(player);
    } else if (owner.key.startsWith("kitchen-sanguidae-")) {
      const defeated = [...new Set([...story.defeated, owner.key])];
      if (KITCHEN_SANGUIDAE.every(({ key }) => defeated.includes(key))) defeated.push("kitchen-sanguidae");
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, defeated });
      removeCastleActor(player, owner.key);
      syncCastleSyringeBarrel(player);
    }
  }

  function talkCastleNpc(event, npcName) {
    const player = event?.player;
    const npc = event?.npc;
    if (!player || !npc || stage(player) !== STAGE.CASTLE || !CASTLE_ACTOR_OWNERS.has(npc)) return false;
    const owner = CASTLE_ACTOR_OWNERS.get(npc);
    if (owner.player !== player) return false;
    const progress = Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70;
    const story = castleStory(player);
    let variant = null;
    if (npcName === "veliaf hurtz" && owner.key === "veliaf-gallery") {
      if (!player.getAttribute(GALLERY_CHEST_ATTRIBUTE)?.key) {
        player.sendMessage("The emblem-gallery chest is still locked.");
        event.handled = true;
        return true;
      }
      variant = story.talkedToVeliaf
        ? "escape-from-castle-drakan-talking-to-veliaf-again"
        : "escape-from-castle-drakan-finding-veliaf";
    } else if ((npcName === "safalaan hallow" && owner.key === "safalaan-prison") ||
      (npcName === "vanescula drakan" && owner.key === "vanescula-prison")) {
      if (progress < 76 || !story.prisonersFound) return false;
      variant = "escape-from-castle-drakan-upon-finding-safalaan-and-vanescula";
    } else if (npcName === "ivan strom" && owner.key === "ivan-library") {
      if (!story.defeated.includes("library-venator")) {
        player.sendMessage("The venator is still guarding Ivan.");
        event.handled = true;
        return true;
      }
      variant = story.bookPuzzleComplete
        ? "escape-from-castle-drakan-talking-to-ivan-again-after-solving-the-bookshelf-puzzle"
        : story.talkedToIvan
          ? "escape-from-castle-drakan-talking-to-ivan-again"
          : "escape-from-castle-drakan-talking-to-ivan-after-defeating-the-venator";
    }
    if (!variant) return false;
    const started = startTranscript(api, player, event.npcId, PAGE, variant);
    if (!started) return false;
    event.handled = true;
    return true;
  }

  function addCastleMedallionDestination(event) {
    const player = event?.player;
    // The medallion's Castle Drakan option is unlocked by inspecting the
    // shrine and stays available after the quest, so completed players can
    // walk from the medallion landing to the post-quest Efaritay normally.
    if (!player || !Array.isArray(event.destinations) || stage(player) < STAGE.SLEPE ||
      !slepeStory(player).refineryComplete || !player.getAttribute(CASTLE_SHRINE_ATTRIBUTE)) return;
    event.destinations.push({
      label: "Castle Drakan.",
      tile: CASTLE_TELEPORT_TILE,
    });
  }

  function enterVampyriumPortal(event) {
    const player = event?.player;
    const idMatches = [event?.objectId, event?.definition?.id].some(id =>
      id === CASTLE_VAMPYRIUM_ENTRY.id || id === CASTLE_VAMPYRIUM_ENTRY.visibleId);
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const currentStage = player && stage(player);
    if (!player || quest.isComplete(player) || currentStage < STAGE.SLEPE || currentStage > STAGE.SIEGE ||
      !slepeStory(player).refineryComplete || !player.getAttribute(CASTLE_SHRINE_ATTRIBUTE) ||
      !idMatches || x !== CASTLE_VAMPYRIUM_ENTRY.x ||
      y !== CASTLE_VAMPYRIUM_ENTRY.y || z !== CASTLE_VAMPYRIUM_ENTRY.z ||
      String(event.option ?? "").toLowerCase() !== "enter") return false;
    const siegeDefence = currentStage === STAGE.SIEGE ? hallDefenceState(player) : null;
    if (siegeDefence && !["hall", "breach"].includes(siegeDefence.phase)) return false;
    event.handled = true;
    if (currentStage === STAGE.SLEPE) {
      advance(player, STAGE.CASTLE);
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.LOBBY);
      player.setAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE, 70);
      syncCastleRoom(player);
      startTranscript(api, player, 0, PAGE, "escape-from-castle-drakan-entering-the-portal",
        steps => steps.filter(step => step.type !== "unavailable"));
    } else if (currentStage === STAGE.CASTLE &&
      (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70) === 70) {
      startTranscript(api, player, 0, PAGE, "escape-from-castle-drakan-entering-the-portal",
        steps => steps.filter(step => step.type !== "unavailable"));
    } else if (currentStage === STAGE.CASTLE) {
      player.moveTo(new Location(CASTLE_VAMPYRIUM_ARRIVAL.x, CASTLE_VAMPYRIUM_ARRIVAL.y,
        CASTLE_VAMPYRIUM_ARRIVAL.z));
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.LOBBY);
      syncCastleRoom(player);
    } else if (currentStage === STAGE.PREPARATIONS) {
      // QH returnToVampyrium* proves the lobby portal is the bank/resupply
      // return. The exact resume tile is uncaptured; reuse the recorded normal
      // palace entrance landing (Bridge 62144 -> 3168,7859,1), preserving stage,
      // progress and inventory.
      player.moveTo(new Location(CASTLE_PALACE_ENTRANCE_ARRIVAL.x,
        CASTLE_PALACE_ENTRANCE_ARRIVAL.y, CASTLE_PALACE_ENTRANCE_ARRIVAL.z));
      palace.sync(player);
    } else if (currentStage === STAGE.SIEGE) {
      const existing = player.getAttribute(SIEGE_DRAKAN_AREA_ATTRIBUTE);
      if (existing && existing.isDestroyed?.() !== true) {
        player.sendMessage("Lowerniel is still attacking inside. Finish or escape the fight before using the portal.");
        return true;
      }
      // A destroyed encounter can be left behind as a session-only reference
      // after death. Clear that actor handle, but retain all earned defence
      // flags, integrity and qualification state for the normal retry.
      if (existing) player.setAttribute(SIEGE_DRAKAN_AREA_ATTRIBUTE, null);
      player.moveTo(new Location(CASTLE_SIEGE_HALL_ARRIVAL.x, CASTLE_SIEGE_HALL_ARRIVAL.y,
        CASTLE_SIEGE_HALL_ARRIVAL.z));
      if (!hall.enter(player)) return false;
      spawnSiegeAranei(player);
      player.getPacketSender().sendVarbit(15464, nativeStage(STAGE.SIEGE, player));
    }
    publishHelperVarbits(player);
    return true;
  }

  function tryCastleReturnPortal(event) {
    const player = event?.player;
    const id = event?.definition?.id ?? event?.objectId;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      id !== CASTLE_VAMPYRIUM_RETURN.id || x !== CASTLE_VAMPYRIUM_RETURN.x ||
      y !== CASTLE_VAMPYRIUM_RETURN.y || z !== CASTLE_VAMPYRIUM_RETURN.z ||
      String(event.option ?? "").toLowerCase() !== "enter" ||
      (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70) !== 80) return false;
    const started = startTranscript(api, player, 0, PAGE,
      "escape-from-castle-drakan-attempting-to-head-back-to-the-foyer");
    if (!started) return false;
    event.handled = true;
    return true;
  }

  // Transcript cutscenes mark the major route changes. The separate object,
  // puzzle and boss handlers below remain responsible for the actual mechanics.
  function onTranscriptAction(event) {
    const player = event?.player;
    if (!player) return;
    if (quest.isComplete(player)) {
      if (event.stepId === "8qI8YD") {
        // Canonical post-quest Efaritay recovery for a lost/destroyed tome.
        // The shared completion add cannot place it in a full inventory, so
        // this is the normal route to reclaim it without duplicating a held,
        // equipped, banked or fully-read copy.
        event.handled = true;
        if (hasTome(player) || tomeUses(player) >= 6) {
          event.end = true;
          return;
        }
        const inventory = player.getInventory();
        if ((inventory.getFreeSlots?.() ?? 0) < 1 || inventory.adds(TOME_ID, 1) === false) {
          player.sendMessage("You need an empty inventory slot to reclaim the tome of experience.");
          event.end = true;
          return;
        }
      }
      return;
    }
    if (event.stepId === "O3RVAV") {
      // Refinery runs first and owns the actual grant; publish from its state.
      publishHelperVarbits(player);
    }
    if (event.stepId === "1JPVz5" && stage(player) === STAGE.THEATRE) {
      setTheatreNativeStage(player, 126);
    }
    if (event.kind === "message" && event.stepId === "gEkhma" && stage(player) === STAGE.THEATRE) {
      setTheatreNativeStage(player, 130);
    }
    // The captured Ivan handout is four inventory slots: two individual jerky,
    // one chunky potion (3), and one sticky potion (2). Keep the availability
    // varbit set until all four items fit and are actually awarded.
    if (event.kind === "message" && event.stepId === "lvEeSL" && stage(player) === STAGE.BLOOD_HUNT) {
      event.handled = true;
      const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
      if (hunt.suppliesClaimed) {
        event.end = true;
        player.sendMessage("Ivan has already given you the supplies he found.");
        return;
      }
      const inventory = player.getInventory();
      if (typeof inventory.getFreeSlots === "function" && inventory.getFreeSlots() < 4) {
        event.end = true;
        player.sendMessage("Make room for Ivan's four supplies before asking him to hand them over.");
        return;
      }
      const supplies = [ItemIdentifiers.MYSTERIOUS_JERKY, ItemIdentifiers.MYSTERIOUS_JERKY,
        ItemIdentifiers.FOUL_CHUNKY_POTION_3_, ItemIdentifiers.PUTRID_STICKY_POTION_2_];
      const given = [];
      for (const id of supplies) {
        if (inventory.adds(id, 1) === false) {
          for (const added of given) inventory.deleteNumber(added, 1);
          event.end = true;
          player.sendMessage("Make room for Ivan's four supplies before asking him to hand them over.");
          return;
        }
        given.push(id);
      }
      player.setAttribute(HUNT_ATTRIBUTE, { ...hunt, suppliesClaimed: true });
      player.getPacketSender()?.sendVarbit?.(15565, 0);
      publishHelperVarbits(player);
      event.box = { items: [ItemIdentifiers.MYSTERIOUS_JERKY, ItemIdentifiers.FOUL_CHUNKY_POTION_3_] };
      return;
    }
    // The captured stage-90 Veliaf transcripts hand over the quest flail in a
    // message step (both the first conversation and its repeat-before-entry
    // variant). Message steps are dispatched once with kind "message".
    if (event.kind === "message" && ["zPvWqR", "S_PhrW"].includes(event.stepId) &&
      stage(player) === STAGE.WYRDS) {
      event.handled = true;
      const inventory = player.getInventory();
      if (hasItem(player, ItemIdentifiers.HALLOWED_FLAIL)) return;
      if (typeof inventory.getFreeSlots === "function" && inventory.getFreeSlots() < 1) {
        player.sendMessage("Make room in your inventory before taking the Hallowed flail.");
        event.end = true;
        return;
      }
      if (inventory.adds(ItemIdentifiers.HALLOWED_FLAIL, 1) === false) {
        player.sendMessage("Make room in your inventory before taking the Hallowed flail.");
        event.end = true;
        return;
      }
      event.box = { items: [ItemIdentifiers.HALLOWED_FLAIL] };
      return;
    }
    if (event.stepId === "lKvIyH" && stage(player) === STAGE.ESCAPE &&
      !player.getAttribute(HUNT_ATTRIBUTE)?.drawbridgeRepaired) {
      event.handled = true;
      event.end = true;
      player.sendMessage("The group cannot cross until you fit the old cog to the Sangvesti drawbridge.");
      return;
    }
    if (event.stepId === "lKvIyH" && stage(player) === STAGE.BLOOD_HUNT) {
      // Captured P1: fitting the cog lowers the bridge and advances 86 -> 88.
      setBloodHuntNativeStage(player, 88);
    }
    if (event.stepId === "D5qF0g" && stage(player) === STAGE.BLOOD_HUNT) {
      setBloodHuntNativeStage(player, 88);
    }
    if (event.stepId === "sw9z49" && stage(player) === STAGE.BLOOD_HUNT) {
      setBloodHuntNativeStage(player, 90);
      startFirstBloodEncounter(player);
    }
    if (event.stepId === "Ysx_tX" && stage(player) === STAGE.BLOOD_HUNT &&
      !player.getAttribute(HUNT_ATTRIBUTE)?.firstBloodThresholdReached) {
      event.handled = true;
      event.end = true;
      player.sendMessage("Lowerniel is still fighting. Drive him back before the group can escape.");
      return;
    }
    if (event.stepId === "OD8Uux" && stage(player) === STAGE.BLOOD_HUNT) {
      cleanupFirstBloodEncounter({ player });
      setBloodHuntNativeStage(player, 94);
      player.setAttribute(FIRST_BLOOD_DEFEATED_ATTRIBUTE, true);
      player.setAttribute(HUNT_ATTRIBUTE, { ...(player.getAttribute(HUNT_ATTRIBUTE) ?? {}),
        firstBloodDefeated: true, nativeStage: 94 });
      // RSProx records this post-fight teleport at the ruined camp.
      player.moveTo(new Location(2730, 7852, 0));
      startTranscript(api, player, NpcIdentifiers.LOWERNIEL_DRAKAN_2, PAGE,
        "blood-hunt-fleeing-through-the-woods");
      event.handled = true;
      event.end = true;
      return;
    }
    if (event.stepId === "iPqujl" && stage(player) === STAGE.BLOOD_HUNT) {
      setBloodHuntNativeStage(player, 96);
      player.moveTo(new Location(2730, 7852, 0));
    }
    if (event.stepId === "kfvYPl" && stage(player) === STAGE.BLOOD_HUNT) {
      setBloodHuntNativeStage(player, 98);
    }
    if (event.stepId === "0I1l4O" && stage(player) === STAGE.BLOOD_HUNT) {
      player.setAttribute(HUNT_ATTRIBUTE, { ...(player.getAttribute(HUNT_ATTRIBUTE) ?? {}),
        firstBloodFleeDialogueComplete: true, nativeStage: 98 });
      player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), introStarted: true });
      advance(player, STAGE.PREPARATIONS);
      beginPreparationIntro(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (event.stepId === "P8i6Tl" && stage(player) === STAGE.PREPARATIONS) {
      player.moveTo(new Location(3168, 7830, 1));
    }
    if (event.stepId === "ikSyAR" && stage(player) === STAGE.CASTLE) {
      player.moveTo(new Location(CASTLE_VAMPYRIUM_ARRIVAL.x, CASTLE_VAMPYRIUM_ARRIVAL.y,
        CASTLE_VAMPYRIUM_ARRIVAL.z));
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.LOBBY);
      syncCastleRoom(player);
      setCastleNativeStage(player, 72);
      syncCastleActors(player);
      publishHelperVarbits(player);
    }
    if (event.stepId === "LTAe0k" && stage(player) === STAGE.CASTLE) {
      const refiner = player.getAttribute(REFINER_ATTRIBUTE) ?? {};
      if (!refiner.destroyed) {
        event.handled = true;
        player.sendMessage("Destroy the blood stockpile before trying to leave Castle Drakan.");
        return;
      }
      const story = castleStory(player);
      player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, stockpileDestroyed: true });
      setCastleNativeStage(player, 80);
    }
    if (event.stepId === "huhOGU" && stage(player) === STAGE.FINAL) {
      event.handled = true;
      openFinalSupplyShop(player);
      return;
    }
    if (event.stepId === "5E6Et6" && stage(player) === STAGE.FINAL) {
      event.handled = true;
      api.emitCustomEvent("bank:open-deposit-box", { player });
      return;
    }
    if (event.stepId === "W2h12S" && stage(player) === STAGE.FINAL) {
      event.handled = true;
      if (!openFinalPortal(player)) {
        player.sendMessage("The portal is open, but the passage has not appeared. Speak to Efaritay again.");
        event.end = true;
      }
      return;
    }
    if (event.stepId === "R8kt3U" && stage(player) === STAGE.FINAL &&
      player.getAttribute(FINAL_PORTAL_OPEN_ATTRIBUTE)) {
      event.handled = true;
      player.setAttribute(FINAL_PORTAL_USED_ATTRIBUTE, true);
      setFinalNativeStage(player, 168);
      publishHelperVarbits(player);
      cleanupFinalEfaritay({ player });
      player.moveTo(new Location(FINAL_CASTLE_ARRIVAL.x, FINAL_CASTLE_ARRIVAL.y, FINAL_CASTLE_ARRIVAL.z));
      spawnFinalArrivalActors(player);
      return;
    }
    if (event.stepId === "t7FMNM" && stage(player) === STAGE.FINAL) {
      cleanupFinalCutsceneActors({ player });
    }
    if (event.kind === "message" && event.stepId === "RldbTP" && stage(player) === STAGE.FINAL) {
      event.handled = true;
      const inventory = player.getInventory();
      if (hasItem(player, ItemIdentifiers.HALLOWED_FLAIL)) return;
      if (inventory.getFreeSlots() < 1 || !inventory.adds(ItemIdentifiers.HALLOWED_FLAIL, 1)) {
        player.sendMessage("Make room in your inventory before taking the Hallowed flail from Efaritay.");
        event.end = true;
        return;
      }
      event.box = { items: [ItemIdentifiers.HALLOWED_FLAIL] };
      return;
    }
    if (event.stepId === "RkdJSc" && stage(player) === STAGE.CASTLE) {
      const loc = player.getLocation();
      spawnCastleActor(player, "stockpile-venator", CASTLE_NPC.VENATOR,
        [loc.getX() + 1, loc.getY(), loc.getZ()], true);
    }
    if (event.stepId === "iutH3M" && stage(player) === STAGE.CASTLE) {
      removeCastleActor(player, "stockpile-venator");
      const loc = player.getLocation();
      spawnCastleActor(player, "vanescula-escape", CASTLE_NPC.VANESCULA_CASTLE,
        [loc.getX() + 1, loc.getY(), loc.getZ()]);
    }
    if (event.stepId === "ERoU4N" && stage(player) === STAGE.CASTLE) {
      removeCastleActor(player, "ivan-library");
      removeCastleActor(player, "veliaf-gallery");
      const loc = player.getLocation();
      spawnCastleActor(player, "ivan-escape", CASTLE_NPC.IVAN_ENTRY_HALL,
        [loc.getX() - 1, loc.getY(), loc.getZ()]);
      spawnCastleActor(player, "veliaf-escape", CASTLE_NPC.VELIAF_ENTRY_HALL,
        [loc.getX() + 1, loc.getY(), loc.getZ()]);
    }
    if (event.stepId === "KaZlum" && stage(player) === STAGE.CASTLE) {
      const loc = player.getLocation();
      spawnCastleActor(player, "lowerniel-cutscene", CASTLE_NPC.LOWERNIEL_CUTSCENE_NO_WING,
        [loc.getX() + 2, loc.getY(), loc.getZ()]);
    }
    if (event.stepId === "pvorJI" && stage(player) === STAGE.CASTLE) {
      setCastleNativeStage(player, 82);
    }
    if (event.stepId === "UgyYUc" && stage(player) === STAGE.SLEPE &&
      player.getAttribute(SLEPE_STORY_ATTRIBUTE)?.manorComplete) {
      const inventory = player.getInventory();
      if (inventory.getFreeSlots() <= 0 || !inventory.adds(ItemIdentifiers.SQUIRES_JOURNAL, 1)) {
        event.handled = true;
        player.sendMessage("Make room for the squire's journal before taking it.");
        return;
      }
      event.handled = true;
      event.box = { items: [ItemIdentifiers.SQUIRES_JOURNAL] };
      player.setAttribute(SLEPE_STORY_ATTRIBUTE,
        { ...player.getAttribute(SLEPE_STORY_ATTRIBUTE), journalGiven: true });
      return;
    }
    if (event.stepId === "OW0EIY" && stage(player) === STAGE.SLEPE &&
      player.getAttribute(SLEPE_STORY_ATTRIBUTE)?.booksPlaced) {
      const inventory = player.getInventory();
      if (inventory.getFreeSlots() <= 0 || !inventory.adds(ItemIdentifiers.IVANDIS_WRITINGS, 1)) {
        event.handled = true;
        player.sendMessage("Make room in your inventory for Ivandis' writings.");
        return;
      }
      event.handled = true;
      event.box = { items: [ItemIdentifiers.IVANDIS_WRITINGS] };
      player.setAttribute(SLEPE_STORY_ATTRIBUTE,
        { ...player.getAttribute(SLEPE_STORY_ATTRIBUTE), writingsGiven: true });
      return;
    }
    if (event.stepId === "y37Yph" && stage(player) === STAGE.SLEPE &&
      player.getAttribute(SLEPE_STORY_ATTRIBUTE)?.tombRouteStarted) {
      // The Wiki gives no exact landing tile; this walkable tile is beside the cache blockage.
      player.moveTo(new Location(3507, 9860, 0));
      return;
    }
    if (event.stepId === "fiqzZ7" && !player.getAttribute(HIDEOUT_DEFENSE_COMPLETE)) {
      player.sendMessage("Keep the vyrewatch away from Ivan and let him complete the spell before escaping.");
      return;
    }
    if (event.stepId === "fiqzZ7") {
      resetBloodMoonScene(player);
      // Captured escape landing (P1): hideout, beside Ivan.
      player.moveTo(new Location(HIDEOUT_ESCAPE_LANDING.x, HIDEOUT_ESCAPE_LANDING.y,
        HIDEOUT_ESCAPE_LANDING.z));
    }
    const next = ACTION_STAGE[event.stepId];
    if (event.stepId === "vqg4qO") {
      if (stage(player) !== STAGE.SIEGE || !bridge.finish(player)) return;
      const state = freshHallState();
      player.setAttribute(SIEGE_DEFENCE_ATTRIBUTE, state);
      quest.setStage(player, STAGE.SIEGE);
      hall.enter(player);
      publishHallIntegrity(player, state);
      spawnSiegeAranei(player);
    }
    if (event.stepId === "Sut83Q") {
      if (!preparationReady(player)) {
        player.sendMessage("Before the siege, finish your preparations with Ivan, Veliaf, Vanescula and Sugadinti, and bring the Hallowed flail and blisterwood stakes.");
        return;
      }
      player.setAttribute(PREP_COMPLETE, true);
      advance(player, STAGE.SIEGE);
      bridge.start(player);
    }
    if (event.stepId === "XqVfhB" && !player.getAttribute(THRONE_PUZZLE_ATTRIBUTE)?.keyClaimed) {
      player.sendMessage("Solve the throne-room bust puzzle and take the half moon key before leaving the castle.");
      return;
    }
    if (event.stepId === "XqVfhB" && stage(player) === STAGE.CASTLE &&
      !player.getAttribute(REFINER_ATTRIBUTE)?.destroyed) {
      player.sendMessage("Destroy the blood stockpile before leaving Castle Drakan.");
      return;
    }
    if (event.stepId === "XqVfhB" && stage(player) === STAGE.CASTLE) {
      cleanupCastleActors({ player });
      player.moveTo(new Location(BLOOD_HUNT_SCENE_ARRIVAL.x, BLOOD_HUNT_SCENE_ARRIVAL.y,
        BLOOD_HUNT_SCENE_ARRIVAL.z));
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, null);
      publishHelperVarbits(player);
    }
    if (next) advance(player, next);
    if (event.stepId === "4G5OZg") startWyrdBattle(player);
    if (event.stepId === "t7FMNM" && stage(player) === STAGE.FINAL) {
      event.handled = true;
      if (!player.getAttribute(DRAKAN_SUPPLY_ATTRIBUTE) ||
        (!hasItem(player, ItemIdentifiers.HALLOWED_FLAIL) &&
          !player.getEquipment?.()?.contains?.(ItemIdentifiers.HALLOWED_FLAIL))) {
        player.sendMessage("Prepare at the Vampyrium supply chest and bring the Hallowed flail before fighting Lowerniel.");
        event.end = true;
        return;
      }
      setFinalNativeStage(player, 170);
      startDrakanBattle(player);
    }
    if (event.stepId === "BzMe5D") finishDrakanEncounter(player);
    const finalDrakanArea = player.getAttribute(DRAKAN_AREA_ATTRIBUTE);
    const finalDrakanFight = finalDrakanArea && drakanEncounters.get(finalDrakanArea);
    if (event.stepId === "YweyKw" &&
      (player.getAttribute(DRAKAN_ENCOUNTER_COMPLETE) || player.getAttribute(DRAKAN_DEATH_CONFIRMED) ||
        finalDrakanFight?.deathConfirmed)) {
      const inventory = player.getInventory();
      if (!hasItem(player, ItemIdentifiers.SUNSPEAR) && !inventory.adds(ItemIdentifiers.SUNSPEAR, 1)) {
        event.handled = true;
        player.sendMessage("Make room in your inventory to take the Sunspear from Lowerniel's body.");
        event.end = true;
        return;
      }
      event.handled = true;
      event.box = { items: [ItemIdentifiers.SUNSPEAR] };
    }
    if (event.stepId === "HNA3XS" &&
      (player.getAttribute(DRAKAN_DEATH_CONFIRMED) || finalDrakanFight?.deathConfirmed)) {
      if (!finishDrakanEncounter(player)) {
        event.handled = true;
        player.sendMessage("The return portal cannot open until Lowerniel's defeat has settled.");
        event.end = true;
        return;
      }
      setFinalNativeStage(player, 174);
      player.moveTo(new Location(FINAL_GRAVEYARD_AFTER_FIGHT.x,
        FINAL_GRAVEYARD_AFTER_FIGHT.y, FINAL_GRAVEYARD_AFTER_FIGHT.z));
      publishHelperVarbits(player);
      spawnFinalCutsceneActors(player);
      // RSProx 4272 t2507: fade into the graveyard with Efaritay and the Wyrd.
      if (sceneReady(player)) {
        Scenes.fade(player, true);
        Scenes.controls(player, true, true);
        Scenes.camera(player, [3715, 3210, 345], [3707, 3211, 65]);
        Scenes.later(player, 2, () => Scenes.fade(player, false));
      }
    }
    if (event.stepId === "NrSBWo" && stage(player) === STAGE.FINAL) {
      transformFinalWyrdForCutscene(player);
    }
    if (event.stepId === "I_SfUV" && stage(player) === STAGE.FINAL) {
      if (sceneReady(player)) {
        Scenes.fade(player, true);
        Scenes.later(player, 1, () => {
          setFinalNativeStage(player, 176);
          player.moveTo(new Location(FINAL_GRAVEYARD_AFTER_FIGHT.x,
            FINAL_GRAVEYARD_AFTER_FIGHT.y, FINAL_GRAVEYARD_AFTER_FIGHT.z));
          cleanupFinalCutsceneActors({ player });
          resetBloodMoonScene(player);
          Scenes.fade(player, false);
        });
      } else {
        setFinalNativeStage(player, 176);
        player.moveTo(new Location(FINAL_GRAVEYARD_AFTER_FIGHT.x,
          FINAL_GRAVEYARD_AFTER_FIGHT.y, FINAL_GRAVEYARD_AFTER_FIGHT.z));
        cleanupFinalCutsceneActors({ player });
      }
    }
    if (event.stepId === "OF-fKO" && stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) === 160) {
      setFinalNativeStage(player, 162);
    }
    if (event.stepId === "Xz7d4O") startSiegeDrakanBattle(player);
    if (event.stepId === "zPiZ9c") finishSiegeDrakanBattle(player);
    if (event.stepId === "1Z5SGt" && stage(player) === STAGE.THEATRE) {
      const challenge = player.getAttribute(TOB_CHALLENGE_ATTRIBUTE);
      if (!challenge?.started && !challenge?.completed) {
        player.setAttribute(TOB_CHALLENGE_ATTRIBUTE, { started: true, completed: false });
        api.emitCustomEvent("tob:bmr-start", { player });
      }
    }
    if (event.stepId === "dJZbqF") {
      const area = player.getAttribute(WYRD_AREA_ATTRIBUTE);
      const encounter = area && wyrdEncounters.get(area);
      if (encounter) {
        encounter.finished = true;
        clearWyrdPools(encounter);
        api.removeNpc(encounter.boss);
        area.leave(player, false);
      }
      player.setAttribute(WYRD_AREA_ATTRIBUTE, null);
      player.setAttribute(WYRD_CUTSCENE_ATTRIBUTE, false);
      Scenes.controls(player, false);
      player.setAttribute(WYRD_DEFEATED_ATTRIBUTE, true);
      advance(player, STAGE.WYRD_DEFEATED);
      player.moveTo(new Location(3562, 3322, 0));
    }
    if (event.stepId === "xt3dPV" && player.getAttribute(WYRD_DEFEATED_ATTRIBUTE)) {
      advance(player, STAGE.FENCE_FOUND);
      player.moveTo(new Location(WYRD_BURGH_RETURN.x, WYRD_BURGH_RETURN.y, WYRD_BURGH_RETURN.z));
    }
    if (event.stepId === "2QgFZA" && player.getAttribute(WYRD_DEFEATED_ATTRIBUTE) &&
      String(event.kind ?? "action") !== "message") {
      // "I'm ready." walks the party out to the Blood Moon gathering (native
      // 152); Efaritay's portal only opens after its fight and conversations.
      beginBloodMoonGathering(player);
    }
    if (event.stepId === "BzMe5D" && stage(player) === STAGE.FINAL
      && player.getAttribute(DRAKAN_ENCOUNTER_COMPLETE)) {
      cleanupFinalCutsceneActors({ player });
      cleanupFinalEfaritay({ player });
      quest.complete(player);
      syncPostQuestEfaritay({ player });
      if (sceneReady(player)) {
        Scenes.fade(player, true);
        Scenes.later(player, 2, () => {
          resetBloodMoonScene(player);
          Scenes.fade(player, false);
        });
      }
    }
  }

  function onBloodMoonTobCompleted(event) {
    const player = event?.player;
    const challenge = player?.getAttribute(TOB_CHALLENGE_ATTRIBUTE);
    if (!player || stage(player) !== STAGE.THEATRE || !challenge?.started || challenge.completed) return;
    player.setAttribute(TOB_CHALLENGE_ATTRIBUTE, { ...challenge, completed: true });
    // Captured order after the last Theatre boss: 138 while Sugadinti and the
    // aranei explain Vanescula's location, 140 once that scene closes, 142 when
    // Veliaf leads the way at the ruins, 144 when the Wyrd fight begins.
    setTheatreNativeStage(player, 138);
    startTranscript(api, player, NpcIdentifiers.SUGADINTI_VITUR_6, PAGE,
      "another-night-at-the-theatre-after-killing-the-nylocas-vasilias");
  }

  function onRefineryCompleted(event) {
    const player = event?.player;
    const story = slepeStory(player);
    if (!player || stage(player) !== STAGE.SLEPE || !story.tombRouteStarted || story.refineryComplete) return;
    player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, refineryComplete: true });
    player.sendMessage("The tunnel through the refinery is clear. Return to the passage into Castle Drakan.");
  }

  function onChoice(event) {
    if (!event?.player) return;
    const player = event.player;
    if (event.option === "I'm ready." && stage(player) === STAGE.THEATRE &&
      Number(player.getAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE)) >= 136) {
      const challenge = player.getAttribute(TOB_CHALLENGE_ATTRIBUTE);
      if (challenge?.started && !challenge.completed) {
        api.emitCustomEvent("tob:bmr-start", { player });
        return;
      }
    }
    if (event.option === "Lead the way." && stage(player) === STAGE.SLEPE &&
      player.getAttribute(SLEPE_STORY_ATTRIBUTE)?.writingsRead) {
      const story = player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {};
      player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...story, tombRouteStarted: true });
      api.emitCustomEvent("bmr:refinery-start", { player });
      return;
    }
    if (event.option === "Yes." && stage(player) === STAGE.NOT_STARTED &&
      event.definition?.getName?.() === "Sarius Guile" && meetsRequirements(player)) {
      advance(player, STAGE.STARTED);
    } else if (event.option === "I'm ready." && stage(player) === STAGE.STARTED &&
      player.getAttribute(HIDEOUT_SHRINE_INSPECTED) && hideoutOutfitWorn(player)) {
      advance(player, STAGE.HIDEOUT);
    } else if (event.option === "I'll get back to it." && stage(player) === STAGE.ESCAPE &&
      atBloodHuntParty(player)) {
      player.setAttribute(HUNT_ATTRIBUTE, { ...(player.getAttribute(HUNT_ATTRIBUTE) ?? {}),
        finalDialogueComplete: true, talkedToVanescula: true });
      quest.setStage(player, STAGE.ESCAPE);
    }
  }

  function atBloodHuntParty(player) {
    const location = player?.getLocation?.();
    const x = location?.getX?.();
    const y = location?.getY?.();
    const z = location?.getZ?.();
    return z === BLOOD_HUNT_PARTY_ARRIVAL.z && Math.abs(x - BLOOD_HUNT_PARTY_ARRIVAL.x) <= 12 &&
      Math.abs(y - BLOOD_HUNT_PARTY_ARRIVAL.y) <= 12;
  }

  function bloodHuntActors(player) {
    let actors = BLOOD_HUNT_ACTORS.get(player);
    if (!actors) {
      actors = new Map();
      BLOOD_HUNT_ACTORS.set(player, actors);
    }
    return actors;
  }

  function syncBloodHuntActors(player) {
    if (!player || ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player)) || !atBloodHuntParty(player)) return;
    const actors = bloodHuntActors(player);
    for (const [key, id, x, y] of BLOOD_HUNT_PARTY) {
      const existing = actors.get(key);
      if (existing && existing.isDestroyed?.() !== true) continue;
      const npc = api.spawnNpc({ id, x, y, z: BLOOD_HUNT_PARTY_ARRIVAL.z,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (!npc) continue;
      npc.setScriptedMovement?.(true);
      actors.set(key, npc);
    }
  }

  function inBloodHuntPursuitBounds(player) {
    const location = player?.getLocation?.();
    if (!location) return false;
    const x = location.getX(), y = location.getY();
    return location.getZ() === 0 && x >= 2560 && x <= 2660 && y >= 7780 && y <= 7900;
  }

  function inBloodHuntPartySafeZone(player) {
    const location = player?.getLocation?.();
    if (!location || location.getZ() !== BLOOD_HUNT_PARTY_ARRIVAL.z) return false;
    return BLOOD_HUNT_PARTY.some(([, , x, y]) =>
      Math.max(Math.abs(location.getX() - x), Math.abs(location.getY() - y)) <= 4);
  }

  function cleanupBloodHuntPursuer(player) {
    const actors = player && BLOOD_HUNT_PURSUER_ACTORS.get(player);
    if (!actors) return;
    for (const npc of actors) {
      BLOOD_HUNT_PURSUER_OWNERS.delete(npc);
      bloodHuntPursuitArea?.leave(npc, false);
      api.removeNpc(npc);
    }
    BLOOD_HUNT_PURSUER_ACTORS.delete(player);
  }

  function syncBloodHuntPursuer(player) {
    if (!player) return;
    if (![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player)) || !inBloodHuntPursuitBounds(player)) {
      cleanupBloodHuntPursuer(player);
      return;
    }
    let hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    if (inBloodHuntPartySafeZone(player)) {
      if (hunt.pursuitStarted) {
        hunt = { ...hunt, pursuitStarted: false, pursuitSpawn: null };
        player.setAttribute(HUNT_ATTRIBUTE, hunt);
        player.getPacketSender?.().sendVarbit(15603, 0);
      }
      cleanupBloodHuntPursuer(player);
      return;
    }
    if (!hunt.pursuitStarted) {
      cleanupBloodHuntPursuer(player);
      return;
    }
    let actors = BLOOD_HUNT_PURSUER_ACTORS.get(player);
    if (!actors || !actors[0] || actors[0].isDestroyed?.() === true) {
      actors = [];
      const fromBlacksmith = hunt.pursuitSpawn === "blacksmith";
      const pursuer = api.spawnNpc({ id: BLOOD_HUNT_PURSUER_ID,
        x: fromBlacksmith ? 2594 : 2599, y: fromBlacksmith ? 7808 : 7853, z: 0,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (pursuer) {
        pursuer.setMovementSteps?.(fromBlacksmith ? 2 : 1);
        pursuer.setScriptedMovement?.(true);
        BLOOD_HUNT_PURSUER_OWNERS.set(pursuer, player);
        bloodHuntPursuitArea?.enter(pursuer);
        actors.push(pursuer);
      }
      if (!fromBlacksmith) {
        const headbar = api.spawnNpc({ id: BLOOD_HUNT_CRANK_HEADBAR_ID, x: 2588, y: 7855, z: 0,
          wanderRadius: 0, owner: player, ownerOnly: true });
        if (headbar) {
          headbar.setScriptedMovement?.(true);
          headbar.setMaxHitpoints?.(60);
          bloodHuntPursuitArea?.enter(headbar);
          actors.push(headbar);
        }
      }
      BLOOD_HUNT_PURSUER_ACTORS.set(player, actors);
    }
    const [pursuer, headbar] = actors;
    const progress = hunt.bankCrankStarted ? hunt.bankCrankTurns : hunt.crankTurns;
    if (headbar && !headbar.isDestroyed?.()) {
      headbar.setHitpoints?.(Math.max(6, Math.min(60, (Number(progress) || 1) * 6)));
    }
    if (pursuer && !pursuer.isDestroyed?.()) {
      const from = pursuer.getLocation?.(), to = player.getLocation?.();
      const combat = pursuer.getCombat?.();
      const target = combat?.getTarget?.();
      if (target === player) {
        pursuer.setScriptedMovement?.(false);
      } else if (from && to && from.getZ() === to.getZ() && from.getDistance(to) > 1) {
        pursuer.setScriptedMovement?.(true);
        api.core.PathFinder.calculateWalkRoute(pursuer, to.getX(), to.getY());
      } else if (from && to && from.getZ() === to.getZ()) {
        // The captured chase becomes a normal attack when Drakan catches the player.
        // Scripted movement disables NPC combat, so hand movement back to Combat here.
        pursuer.setScriptedMovement?.(false);
        if (target !== player) combat?.attack?.(player);
      }
    }
  }

  function handleBloodHuntPursuerDeath({ npc }) {
    const owner = npc && BLOOD_HUNT_PURSUER_OWNERS.get(npc);
    if (!owner) return;
    BLOOD_HUNT_PURSUER_OWNERS.delete(npc);
    bloodHuntPursuitArea?.leave(npc, false);
    const actors = BLOOD_HUNT_PURSUER_ACTORS.get(owner) ?? [];
    for (const actor of actors) {
      if (actor === npc) continue;
      BLOOD_HUNT_PURSUER_OWNERS.delete(actor);
      bloodHuntPursuitArea?.leave(actor, false);
      api.removeNpc(actor);
    }
    BLOOD_HUNT_PURSUER_ACTORS.delete(owner);
  }

  class BloodHuntPursuitArea extends api.core.Area {
    constructor() { super([new Boundary(2560, 2660, 7780, 7900, 0)]); }
    getName() { return "Blood Moon Sangvesti Pursuit"; }
    process(member) {
      if (member?.isPlayer?.()) {
        const player = member.getAsPlayer();
        syncBloodHuntActors(player);
        syncBloodHuntPursuer(player);
      }
    }
    postLeave(member) {
      if (member?.isPlayer?.()) cleanupBloodHuntPursuer(member.getAsPlayer());
    }
    canAttack(attacker, target) {
      const targetOwner = target && BLOOD_HUNT_PURSUER_OWNERS.get(target);
      const attackerOwner = attacker && BLOOD_HUNT_PURSUER_OWNERS.get(attacker);
      if (!targetOwner && !attackerOwner) return null;
      const player = attacker.getAsPlayer?.() ?? attacker;
      const victim = target.getAsPlayer?.() ?? target;
      const ownerIsSafe = (owner) => inBloodHuntPartySafeZone(owner);
      if (targetOwner) return player === targetOwner && !ownerIsSafe(targetOwner) &&
        [STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(targetOwner));
      return victim === attackerOwner && !ownerIsSafe(attackerOwner) &&
        [STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(attackerOwner));
    }
  }

  function cleanupBloodHuntActors({ player }) {
    const actors = player && BLOOD_HUNT_ACTORS.get(player);
    for (const npc of actors?.values?.() ?? []) api.removeNpc(npc);
    if (player) BLOOD_HUNT_ACTORS.delete(player);
    cleanupBloodHuntPursuer(player);
  }

  function recoverBloodHuntLanding({ player }) {
    if (!player || stage(player) !== STAGE.ESCAPE ||
      !castleStory(player).stockpileDestroyed ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.STOCKPILE_STORAGE) return;
    const location = player.getLocation?.();
    if (!location || location.getX() < 2528 || location.getX() > 2542 ||
      location.getY() < 7376 || location.getY() > 7394 || location.getZ() !== 0) return;
    // Earlier builds saved after the cutscene advanced the chapter but before its
    // captured teleport reached the Sangvesti party. Repair only that stale room save.
    player.moveTo(new Location(BLOOD_HUNT_PARTY_ARRIVAL.x, BLOOD_HUNT_PARTY_ARRIVAL.y,
      BLOOD_HUNT_PARTY_ARRIVAL.z));
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, null);
    syncBloodHuntActors(player);
  }

  function syncBloodHuntPartyOnLogin({ player }) {
    if (player) syncBloodHuntActors(player);
  }

  function syncBloodHuntPartyOnStageChange(event) {
    if (event?.key === "the_blood_moon_rises" && event.player) syncBloodHuntActors(event.player);
  }

  function startHideoutDeparture(player) {
    if (stage(player) !== STAGE.HIDEOUT) return false;
    if (!hideoutOutfitWorn(player)) {
      player.sendMessage("Wear the vyre noble outfit before leaving for Castle Drakan.");
      return false;
    }
    if (!hideoutDefense.prepare(player)) return false;
    // RSProx P1 t255-257: fade out under the hideout camera as the party leaves.
    if (sceneReady(player)) {
      Scenes.fade(player, true);
      Scenes.controls(player, true, true);
      Scenes.camera(player, [3597, 9617, 370], [3602, 9610, 369]);
      Scenes.later(player, 2, () => Scenes.fade(player, false));
    }
    player.setAttribute(HIDEOUT_CUTSCENE_STARTED, true);
    player.getPacketSender().sendVarbit(15464, nativeStage(STAGE.HIDEOUT, player));
    return startTranscript(api, player, NpcIdentifiers.IVAN_STROM_13, PAGE, "starting-out-lowerniel-s-speech");
  }

  // Line steps have no stable id in the transcript export, so scope them to
  // this quest page, the exact variant, the raw (unformatted) text and speaker.
  // request.text is the wiki source with placeholders such as "[player name]".
  function isQuestLine(request, variant, text, speaker = undefined) {
    if (!request?.pages?.some(page => page.page === PAGE && page.variants?.includes(variant))) return false;
    if (request.text !== text) return false;
    return speaker === undefined || request.step?.speaker === speaker;
  }

  function onBloodMoonDialogueLine(request) {
    const player = request?.player;
    if (!player) return;
    if (stage(player) === STAGE.STARTED) {
      if (!player.getAttribute(START_DIALOGUE_COMPLETE) &&
        isQuestLine(request, "starting-out", "Good luck, [player name].", "Sarius Guile")) {
        player.setAttribute(START_DIALOGUE_COMPLETE, true);
        player.getPacketSender().sendVarbit(15464, nativeStage(STAGE.STARTED, player));
      } else if (player.getAttribute(HIDEOUT_SHRINE_INSPECTED) &&
        isQuestLine(request, "starting-out-inspecting-the-shrine", "[player name].", "Ivan Strom")) {
        player.getPacketSender().sendVarbit(15464, nativeStage(STAGE.STARTED, player));
      }
    }
    if (stage(player) === STAGE.RETURNED &&
      isQuestLine(request, "starting-out-back-at-the-hideout", "What is it?")) {
      advance(player, STAGE.SLEPE);
      return;
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) === 152 &&
      isQuestLine(request, "night-of-the-blood-moon", "I suppose we're about to find out...", "Sugadinti Vitur")) {
      // Release the held gathering camera controls before the fight itself.
      request.after = () => {
        Scenes.controls(player, false);
        startGatheringDrakanFight(player);
      };
      return;
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) === 152 &&
      isQuestLine(request, "fighting-wyrds-inspecting-the-broken-fence", "Myreque prevail.")) {
      request.after = () => startGatheringScene(player);
      return;
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) === 156 &&
      isQuestLine(request, "night-of-the-blood-moon-upon-lowerniel-reaching-30-hp",
        "I promise you, we will discuss this matter properly, but first, the crowd needs to be placated. I must address them. Please, wait for me inside the castle...",
        "Sugadinti Vitur")) {
      // The conversation ends here; only now does the captured script move the
      // group to the castle and leave Ivan waiting inside.
      request.after = () => finishGatheringThresholdConversation(player);
      return;
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) === 158 &&
      isQuestLine(request, "night-of-the-blood-moon-talking-to-ivan",
        "My children, I'm sorry for rushing you inside. Time was of the essence in gaining control of the vampyres. However, I have promising news. It seems that for now at least, most are willing to accept me as their ruler.",
        "Sugadinti Vitur")) {
      setFinalNativeStage(player, 160);
      syncGatheringCastleActors(player);
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) >= 160 &&
      isQuestLine(request, "night-of-the-blood-moon-talking-to-ivan",
        "Thank you, and good luck, my child.", "Sugadinti Vitur")) {
      cleanupGatheringDrakan(player);
      cleanupGatheringCastleActors({ player });
      resetBloodMoonScene(player);
      player.setAttribute(BLOOD_MOON_SCENE_ATTRIBUTE, null);
      setFinalNativeStage(player, 164);
      advance(player, STAGE.FINAL);
      syncFinalEfaritay(player);
      player.moveTo(new Location(FINAL_EFARITAY_GRAVEYARD_TILE.x, FINAL_EFARITAY_GRAVEYARD_TILE.y, FINAL_EFARITAY_GRAVEYARD_TILE.z));
    }
    if (stage(player) === STAGE.THEATRE &&
      isQuestLine(request, "another-night-at-the-theatre-after-killing-the-nylocas-vasilias",
        "Go quick, my child. I wish you good luck.", "Sugadinti Vitur")) {
      setTheatreNativeStage(player, 140);
    }
    if (stage(player) === STAGE.WYRDS && request.step?.speaker === "Wyrd"
      && request.text === "Then stay... Stay and die!") {
      request.after = () => activateWyrdEncounter(player);
    }
    if (stage(player) === STAGE.THEATRE && request.text === "We'd better get over there then." &&
      request.step?.speaker === "Ivan Strom") {
      request.after = () => {
        if (stage(player) !== STAGE.THEATRE ||
          (Number(player.getAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE)) || 0) < 126) return;
        player.moveTo(new Location(3491, 9628, 0));
        setTheatreNativeStage(player, 128);
      };
      return;
    }
    const theatreMilestone = stage(player) === STAGE.THEATRE && ({
      "The situation here in Hallowvale is... delicate, my child. To avoid attention, I would suggest we travel to Ver Sinhaza separately.": 132,
      "Alright. I can do that.": 134,
      "Then let us begin, my child.": 136,
    })[request.text];
    if (theatreMilestone) {
      request.after = () => {
        if (stage(player) === STAGE.THEATRE) setTheatreNativeStage(player, theatreMilestone);
      };
    }
    if (stage(player) === STAGE.PREPARATIONS) {
      const prepProgress = [
        ["I hope so too. We're going to need all the", "stakesConversationComplete"],
        ["Well, if you want to try getting something out of her, be my guest.", "veliafFirstTalkComplete"],
        ["Now, as fun as all this has been, my brother will almost certainly be upon you and your new friends soon.", "vanesculaTalkComplete"],
        ["Best you go and get ready, [player name]. Won't be long until Drakan is here.", "veliafFollowupComplete"],
        ["I will see that it is. Now, my disciples are gathering on the bridge outside.", "sugadintiReady"],
      ].find(([text]) => request.text === text || request.text?.startsWith(text));
      if (prepProgress) {
        request.after = () => {
          if (stage(player) !== STAGE.PREPARATIONS) return;
          const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
          const updated = { ...prep, [prepProgress[1]]: true };
          if (prepProgress[1] === "stakesConversationComplete" && prep.stakes) {
            updated.ivanStakesComplete = true;
          }
          player.setAttribute(PREP_ATTRIBUTE, updated);
          publishHelperVarbits(player);
        };
        return;
      }
    }
    if (stage(player) === STAGE.PREPARATIONS && !(player.getAttribute(PREP_ATTRIBUTE) ?? {}).ivanSareiIntroComplete &&
      ((request.step?.player && request.text === "I'll get to it.") ||
        (request.step?.speaker === "Sarei" &&
          request.text?.startsWith("As for what those plans are, as I say, you'll need to ask Father Sugadinti")))) {
      request.after = () => {
        if (stage(player) === STAGE.PREPARATIONS) {
          player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), ivanSareiIntroComplete: true });
        }
      };
      return;
    }
    if (stage(player) === STAGE.PREPARATIONS && request.step?.speaker === "Efaritay Hallow" &&
      request.text?.endsWith("Now, let us get to work.")) {
      request.after = () => {
        if (stage(player) !== STAGE.PREPARATIONS) return;
        player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), introComplete: true });
        player.getPacketSender()?.sendVarbit?.(15464, 100);
      };
      return;
    }
    if (stage(player) === STAGE.PREPARATIONS && request.step?.player &&
      request.text === "Alright, I'll get to it.") {
      request.after = () => {
        const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
        if (stage(player) !== STAGE.PREPARATIONS || !prep.introComplete || prep.gatherStarted) return;
        player.setAttribute(PREP_ATTRIBUTE, { ...prep, gatherStarted: true });
        quest.setStage(player, STAGE.PREPARATIONS);
      };
      return;
    }
    if (stage(player) === STAGE.PREPARATIONS && request.step?.player && request.text === "Never.") {
      request.after = () => {
        const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
        if (stage(player) !== STAGE.PREPARATIONS || !prep.stewFed || prep.safalaanAnswered) return;
        player.setAttribute(PREP_ATTRIBUTE, { ...prep, safalaanAnswered: true });
        quest.setStage(player, STAGE.PREPARATIONS);
      };
      return;
    }
    if (stage(player) === STAGE.PREPARATIONS && request.step?.speaker === "Efaritay Hallow" &&
      request.text?.startsWith("Let me know if you need a hand with anything")) {
      request.after = () => {
        const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
        if (stage(player) !== STAGE.PREPARATIONS || !prep.safalaanAnswered || prep.preparationsDiscussed) return;
        player.setAttribute(PREP_ATTRIBUTE, { ...prep, preparationsDiscussed: true });
        quest.setStage(player, STAGE.PREPARATIONS);
      };
      return;
    }
    if ([STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player)) && request.step?.player &&
      request.text === "We don't have time for this. Whatever we do next, we can't stay here. Let's get across that bridge." &&
      !player.getAttribute(HUNT_ATTRIBUTE)?.drawbridgeRepaired) {
      // This conversation only reports that the cog was found (captured varbit
      // 15485). Fitting it to the mechanism at 2633,7831 is the mandatory next
      // interaction; do not repair or consume it during the dialogue.
      request.after = () => {
        const state = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
        if (state.cogFound || state.drawbridgeRepaired) return;
        if (!player.getInventory().contains(HUNT_ITEMS.oldCog)) {
          player.sendMessage("The drawbridge still needs the old cog from the Jovkai smithy.");
          return;
        }
        player.setAttribute(HUNT_ATTRIBUTE, { ...state, cogFound: true });
        player.getPacketSender().sendVarbit(HUNT_FOUND_COG_VARBIT, 1);
      };
      return;
    }
    if (stage(player) === STAGE.ESCAPE && request.step?.player &&
      request.text === "Then I'll just have to avoid him." && castleStory(player).stockpileDestroyed) {
      request.after = () => {
        if (stage(player) !== STAGE.ESCAPE || !castleStory(player).stockpileDestroyed) return;
        player.setAttribute(HUNT_ATTRIBUTE, { ...(player.getAttribute(HUNT_ATTRIBUTE) ?? {}),
          finalDialogueComplete: true });
        quest.setStage(player, STAGE.ESCAPE);
        player.moveTo(new Location(BLOOD_HUNT_PARTY_ARRIVAL.x, BLOOD_HUNT_PARTY_ARRIVAL.y,
          BLOOD_HUNT_PARTY_ARRIVAL.z));
        player.setAttribute(CASTLE_ROOM_ATTRIBUTE, null);
        syncBloodHuntActors(player);
      };
      return;
    }
    if (stage(player) === STAGE.CASTLE &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.IVAN_ROOM &&
      request.step?.player && request.text === "Let's go." &&
      !castleStory(player).talkedToIvan && castleStory(player).defeated.includes("library-venator")) {
      request.after = () => {
        const story = castleStory(player);
        if (stage(player) !== STAGE.CASTLE ||
          Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.IVAN_ROOM ||
          story.talkedToIvan || !story.defeated.includes("library-venator")) return;
        player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, talkedToIvan: true });
        setCastleNativeStage(player, 78);
        removeCastleActor(player, "ivan-library");
        syncCastleActors(player);
      };
      return;
    }
    if (stage(player) === STAGE.CASTLE && request.step?.speaker === "Veliaf Hurtz" &&
      request.text === "Hmm... Best we keep progressing on then." && !castleStory(player).talkedToVeliaf) {
      request.after = () => {
        const story = castleStory(player);
        if (story.talkedToVeliaf || stage(player) !== STAGE.CASTLE) return;
        player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, talkedToVeliaf: true });
        setCastleNativeStage(player, 74);
        syncCastleActors(player);
      };
      return;
    }
    if (stage(player) !== STAGE.HIDEOUT) return;
    if (request.step?.speaker === "Ivan Strom" && request.text === "Alright... To Darkmeyer then.") {
      request.after = () => startHideoutDeparture(player);
      return;
    }
    if (request.step?.speaker === "Lowerniel Drakan" &&
      request.text === "As a starting point, you may wish to deal with the two humans that stand among you, unless of course you've all become so weak that you can't even do that anymore...") {
      // Captured departure ends its held cutscene when the courtyard fight begins:
      // release movement/cutscene controls but keep the scene camera until escape.
      request.after = () => {
        Scenes.controls(player, false);
        hideoutDefense.start(player);
      };
    }
  }

  function onSlepeDialogueLine(request) {
    const player = request?.player;
    if (!player || stage(player) !== STAGE.SLEPE) return;
    if (isQuestLine(request, "the-truth-hurtz-upon-killing-the-monks-of-zamorak",
      "Nice job, [player name]. Let's check upstairs.", "Ivan Strom")) {
      request.after = () => {
        if (paterdomusBattles.get(player)?.outroPending) cleanupPaterdomusBattle(player);
      };
      return;
    }
    if (request.step?.player && request.text === "Sounds like a plan! Let's do it!") {
      request.after = () => player.setAttribute(SLEPE_STORY_ATTRIBUTE,
        { ...slepeStory(player), monksRequested: true });
      return;
    }
    if (request.step?.speaker === "Ivan Strom" && request.text === "Sounds good.") {
      request.after = () => player.setAttribute(SLEPE_STORY_ATTRIBUTE,
        { ...slepeStory(player), upstairsTalked: true });
      return;
    }
    if (request.step?.speaker === "Ivan Strom" &&
      ["I'm right behind you.", "The truth is that I don't think I'll know until we do, so we may as well get to it."].includes(request.text)) {
      request.after = () => {
        player.setAttribute(SLEPE_STORY_ATTRIBUTE, { ...(player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {}), ivanFollowing: true });
        syncSlepeIvan({ player });
      };
    } else if (request.step?.speaker === "Roy" &&
      request.text === "That, I do not. However, I did hear that there was some commotion up at Crombwick Manor soon afterwards.") {
      request.after = () => player.setAttribute(SLEPE_STORY_ATTRIBUTE,
        { ...(player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {}), royClue: true });
    } else if (request.text?.includes("Now, I'd better get to Paterdomus.") &&
      (request.step?.player || request.step?.speaker === "Veliaf Hurtz")) {
      request.after = () => {
        player.setAttribute(SLEPE_STORY_ATTRIBUTE,
          { ...(player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {}), manorComplete: true });
        cleanupSlepeManor({ player });
      };
    }
  }

  function resumeHideoutEscape({ player }) {
    if (!player || stage(player) !== STAGE.HIDEOUT || !player.getAttribute(HIDEOUT_DEFENSE_COMPLETE)) return;
    if (player.getDialogueManager?.()?.getCurrent?.()) return;
    startTranscript(api, player, NpcIdentifiers.IVAN_STROM_13, PAGE, "starting-out-escaping-the-vampyres");
  }

  function claimNightLamps(player) {
    const request = { player, handled: false };
    api.emitCustomEvent("night-at-the-theatre:claim-lamps", request);
    if (!request.handled) player.sendMessage("There are no unused Hallowed lamps to reclaim.");
  }

  function talkQuestNpc(event) {
    const player = event?.player;
    if (!player) return false;
    const npcName = String(event.definition?.getName?.() ?? "").toLowerCase();
    if (stage(player) === STAGE.CASTLE) {
      const started = talkCastleNpc(event, npcName);
      if (started) return true;
    }
    // Night at the Theatre owns this same Stranger until its story is complete.
    // Once Night is done, preserve its lamp reclaim service while Blood Moon is active.
    if (npcName === "mysterious stranger") {
      if (!hasQuest(player, "a_night_at_the_theatre")) return false;
      api.sendMultiChatboxPrompt(player, "What would you like to do?",
        "Claim unused Hallowed lamps", () => claimNightLamps(player),
        "I'm off", () => {});
      event.handled = true;
      return true;
    }
    if (quest.isComplete(player)) return false;
    if (stage(player) === STAGE.RETURNED && npcName === "ivan strom") {
      event.handled = true;
      return startTranscript(api, player, event.npcId, PAGE, "starting-out-back-at-the-hideout");
    }
    if (stage(player) === STAGE.HIDEOUT && npcName === "ivan strom") {
      event.handled = true;
      api.sendMultiChatboxPrompt(player, "Are you ready to go to Darkmeyer?",
        "I'm ready.", () => startHideoutDeparture(player),
        "I need more time to prepare.", () => {});
      return true;
    }
    if (stage(player) === STAGE.FINAL && npcName === "efaritay hallow") {
      event.handled = true;
      const variant = player.getAttribute(FINAL_PORTAL_USED_ATTRIBUTE)
        ? "night-of-the-blood-moon-entering-the-portal-talking-to-efaritay-again"
        : "night-of-the-blood-moon-talking-to-efaritay";
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) >= 156 && npcName === "ivan strom") {
      event.handled = true;
      setFinalNativeStage(player, 158);
      return startTranscript(api, player, event.npcId, PAGE, "night-of-the-blood-moon-talking-to-ivan");
    }
    if (stage(player) === STAGE.FENCE_FOUND &&
      Number(player.getAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE)) >= 160 && npcName === "sugadinti vitur") {
      event.handled = true;
      return startTranscript(api, player, event.npcId, PAGE, "night-of-the-blood-moon-talking-to-ivan");
    }
    if (stage(player) === STAGE.THEATRE) {
      const native = Number(player.getAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE)) || 124;
      if (native < 128 && npcName === "ivan strom") {
        event.handled = true;
        return startTranscript(api, player, event.npcId, PAGE, "another-night-at-the-theatre");
      }
      if (native >= 128 && native < 132 && ["veliaf hurtz", "sugadinti vitur"].includes(npcName)) {
        event.handled = true;
        return startTranscript(api, player, event.npcId, PAGE,
          "another-night-at-the-theatre-talking-to-veliaf-and-sugadinti-in-burgh-de-rott");
      }
      if (native >= 130 && native <= 136 && npcName === "sugadinti vitur" &&
        !player.getAttribute(TOB_CHALLENGE_ATTRIBUTE)?.started) {
        event.handled = true;
        return startTranscript(api, player, event.npcId, PAGE,
          "another-night-at-the-theatre-talking-to-sugadinti-outside-the-theatre");
      }
      if (native >= 140 && ["veliaf hurtz", "ivan strom"].includes(npcName)) {
        event.handled = true;
        setTheatreNativeStage(player, 142);
        return startTranscript(api, player, event.npcId, PAGE,
          "fighting-wyrds-talking-to-veliaf-outside-the-ruins");
      }
      if (native >= 136 && native <= 138 && npcName === "sugadinti vitur" &&
        player.getAttribute(TOB_CHALLENGE_ATTRIBUTE)?.started &&
        !player.getAttribute(TOB_CHALLENGE_ATTRIBUTE)?.completed) {
        event.handled = true;
        return startTranscript(api, player, event.npcId, PAGE,
          "another-night-at-the-theatre-talking-to-sugadinti-outside-the-theatre-talking-to-sugadinti-outside-the-theatre-after-leaving");
      }
    }
    // The Sins of the Father reclaim dialogue also belongs to Ivan in this
    // hideout. SLEPE's later story variant is only relevant at its own scene;
    // let the completed Sins transcript win here instead of hijacking Talk-to.
    if (stage(player) === STAGE.SLEPE && npcName === "ivan strom" &&
      isAtSinsMedallionHideout(event)) {
      return false;
    }
    if (stage(player) === STAGE.PREPARATIONS && npcName === "efaritay hallow" &&
      (player.getAttribute(PREP_ATTRIBUTE) ?? {}).preparationsDiscussed &&
      !hasItem(player, PREP.blisterwoodFlail) && !hasItem(player, PREP.flail) &&
      !player.getEquipment?.()?.contains?.(PREP.blisterwoodFlail) &&
      !player.getEquipment?.()?.contains?.(PREP.flail)) {
      const started = startTranscript(api, player, event.npcId, "Efaritay Hallow", "standard-dialogue");
      if (started) event.handled = true;
      return started;
    }
    if (stage(player) === STAGE.PREPARATIONS && ["ivan strom", "sarei"].includes(npcName)) {
      event.handled = true;
      const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
      const variant = prep.ivanSareiIntroComplete
        ? "hallowed-preparations-talking-to-ivan-and-sarei-talking-to-them-again"
        : "hallowed-preparations-talking-to-ivan-and-sarei";
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if (stage(player) === STAGE.PREPARATIONS && ["veliaf hurtz", "vanescula drakan", "sugadinti vitur"].includes(npcName)) {
      const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
      const hasFlail = hasItem(player, PREP.flail) || player.getEquipment?.()?.contains?.(PREP.flail);
      const hasStakes = hasItem(player, PREP.stakes);
      event.handled = true;
      if (npcName === "sugadinti vitur") {
        const variant = preparationStoryReady(player)
          ? "hallowed-preparations-talking-to-sugadinti-after-finishing-preparations"
          : "hallowed-preparations-talking-to-sugadinti";
        return startTranscript(api, player, event.npcId, PAGE, variant);
      }
      if (!prep.stakesConversationComplete || !hasFlail || !hasStakes) {
        player.sendMessage("Finish the Hallowed flail and blisterwood stakes, then speak with Ivan and Sarei about them.");
        return true;
      }
      if (npcName === "veliaf hurtz") {
        if (prep.vanesculaTalkComplete) {
          return startTranscript(api, player, event.npcId, PAGE,
            "hallowed-preparations-talking-to-veliaf-after-talking-to-vanescula");
        }
        if (prep.veliafFirstTalkComplete) {
          player.sendMessage("I should hear what Vanescula has to say before returning to Veliaf.");
          return true;
        }
        return startTranscript(api, player, event.npcId, PAGE, "hallowed-preparations-talking-to-veliaf");
      }
      if (!prep.veliafFirstTalkComplete) {
        player.sendMessage("I should speak to Veliaf before questioning Vanescula.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, prep.vanesculaTalkComplete
        ? "hallowed-preparations-talking-to-vanescula-trying-to-talk-to-her-again"
        : "hallowed-preparations-talking-to-vanescula");
    }
    if (stage(player) === STAGE.SLEPE) {
      const story = player.getAttribute(SLEPE_STORY_ATTRIBUTE) ?? {};
      let variant = null;
      if (npcName === "ivan strom") {
        if (story.monksCleared) {
          variant = !story.upstairsTalked
            ? "the-truth-hurtz-talking-to-ivan-upstairs"
            : story.booksPlaced
              ? story.writingsRead
                ? "the-truth-hurtz-talking-to-ivan-after-reading-ivandis-writings"
                : "the-truth-hurtz-talking-to-ivan-after-solving-the-book-puzzle"
              : "the-truth-hurtz-talking-to-ivan-again-3";
        } else if (story.manorComplete) {
          variant = story.journalRead
            ? "the-truth-hurtz-talking-to-ivan-and-drezel-after-reading-the-journal"
            : story.journalGiven
              ? "the-truth-hurtz-talking-to-ivan-or-drezel-again-before-reading-the-journal"
              : "the-truth-hurtz-talking-to-ivan-and-drezel-in-the-mausoleum";
        } else if (story.royClue) {
          variant = "the-truth-hurtz-talking-to-ivan-again";
        } else {
          variant = story.ivanFollowing
            ? "the-truth-hurtz-talking-to-ivan-while-he-is-following-the-player"
            : "the-truth-hurtz-talking-to-ivan-in-slepe";
        }
      } else if (npcName === "roy") {
        if (!story.ivanFollowing) {
          player.sendMessage("I should find Ivan by the church and bring him to the pub.");
          event.handled = true;
          return true;
        }
        variant = story.royClue
          ? "the-truth-hurtz-talking-to-roy-talking-to-roy-again"
          : "the-truth-hurtz-talking-to-roy";
      } else if (npcName === "veliaf hurtz") {
        if (story.manorEnemiesDefeated) variant = "the-truth-hurtz-talking-to-veliaf-inside-crombwick-manor";
        else if (story.manorComplete) variant = "the-truth-hurtz-talking-to-veliaf-again";
        else {
          player.sendMessage("The Vyrewatch are still fighting in the manor.");
          event.handled = true;
          return true;
        }
      } else if (npcName === "drezel") {
        if (!story.manorComplete) return false;
        variant = story.journalRead
          ? "the-truth-hurtz-talking-to-ivan-and-drezel-after-reading-the-journal"
          : story.journalGiven
            ? "the-truth-hurtz-talking-to-ivan-or-drezel-again-before-reading-the-journal"
            : "the-truth-hurtz-talking-to-ivan-and-drezel-in-the-mausoleum";
      }
      if (variant) {
        event.handled = true;
        const started = startTranscript(api, player, event.npcId, PAGE, variant);
        return started;
      }
    }
    if ([STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player)) && npcName === "vanescula drakan") {
      const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
      const variant = hunt.drawbridgeRepaired
        ? "blood-hunt-crossing-the-bridge"
        : hasItem(player, HUNT_ITEMS.oldCog)
          ? "blood-hunt-after-finding-the-cog"
          : "blood-hunt-talking-to-vanescula-in-the-town";
      event.handled = true;
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if (stage(player) === STAGE.NOT_STARTED) {
      if (npcName !== "sarius guile") return false;
      if (!meetsRequirements(player)) { explainRequirements(player); return true; }
      return startTranscript(api, player, event.npcId, PAGE, "starting-out");
    }
    const chapter = currentChapter(stage(player));
    const alias = ({
      "king roald": "king-roald",
      "the nylocas queen": "nylocas-queen",
      "ivan strom": "ivan",
      "safalaan hallow": "safalaan",
      "efaritay hallow": "efaritay",
      "vanescula drakan": "vanescula",
      // The transcript uses Veliaf's given name in chapter variant IDs.
      "veliaf hurtz": "veliaf",
    })[npcName] ?? npcName.replace(/[^a-z0-9]+/g, "-");
    const variants = Object.keys(loadTranscripts(api)[PAGE]?.variants ?? {});
    const candidates = variants.filter((variant) => variant.startsWith(`${chapter}-`) && variant.includes(alias));
    const selected = candidates.find((variant) => variant.includes("talking-to") && !variant.includes("again")) ??
      candidates.find((variant) => variant.includes("talking-to")) ?? candidates[0];
    return selected ? startTranscript(api, player, event.npcId, PAGE, selected) : false;
  }

  function buildJournal(player) {
    if (quest.isComplete(player)) return ["The confrontation at the blood moon is over.", "The Myreque have survived the battle and must regroup."];
    const value = stage(player);
    if (value >= STAGE.FINAL) return ["The Myreque have set out for Castle Drakan.", "I must follow them and stop Lowerniel Drakan."];
    if (value >= STAGE.FENCE_FOUND) return ["Safalaan escaped toward Castle Drakan.", "I should join the Myreque in Burgh de Rott and prepare to pursue him."];
    if (value >= STAGE.WYRD_DEFEATED) return ["The Wyrd knocked me unconscious and fled north.", "I should inspect the broken fence beyond Barrows and follow Safalaan's trail."];
    if (value >= STAGE.THEATRE) return ["Safalaan is becoming a wyrd.", "I must help Veliaf defeat him before he loses himself."];
    if (value >= STAGE.SIEGE) return ["The aranei hideout is under attack.", "I must help defend the bridge and protect the portal."];
    if (value >= STAGE.PREPARATIONS) return ["Sugadinti's followers are preparing to face Lowerniel.", "I should speak to Veliaf when I am ready."];
    if (value >= STAGE.BLOOD_HUNT) return ["I have escaped into Vampyrium.", "I must find the group and survive the hunt."];
    if (value >= STAGE.ESCAPE) return ["I am fleeing Castle Drakan with the others.", "I must escape the vampyres and get clear of the castle."];
    if (value >= STAGE.CASTLE) return ["I am trapped inside Castle Drakan.", "I must find the others and escape."];
    if (value >= STAGE.SLEPE) return ["I need to investigate the events in Slepe and Castle Drakan.", "I should follow Ivan's leads."];
    if (value >= STAGE.HIDEOUT) return ["Ivan has agreed to help me reach Castle Drakan.", "I should make sure we are both disguised before we leave."];
    return ["Sarius Guile told me Lowerniel Drakan has taken Safalaan.", "I should find Ivan in the Myreque hideout."];
  }

  function readTome({ player, itemId, item, slot }) {
    if (itemId !== TOME_ID || !quest.isComplete(player) || player.getInventory().get(slot) !== item) return false;
    if ((Number(player.getAttribute(ATTRIBUTE)) || 0) >= 6) return true;
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: 70,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        if (player.getInventory().get(slot) !== item) return null;
        const used = (Number(player.getAttribute(ATTRIBUTE)) || 0) + 1;
        player.setAttribute(ATTRIBUTE, used);
        if (used >= 6) player.getInventory().deleteAtSlot(slot, 1);
        player.getSkillManager().addExperience(skill, 30000, false);
        return `You have been awarded 30,000 ${name} XP!`;
      },
    });
    return true;
  }

  function hasItem(player, itemId) {
    return player.getInventory().contains(itemId) || player.getEquipment?.().contains?.(itemId) === true;
  }

  function tomeUses(player) {
    return Number(player?.getAttribute?.(ATTRIBUTE)) || 0;
  }

  // The tome is unbankable in OSRS, but a stale/manual bank copy still counts as
  // owned so the reclaim can never duplicate it.
  function hasTome(player) {
    return hasItem(player, TOME_ID) || hasBankedItem(player, TOME_ID);
  }

  function giveInventoryItem(player, itemId, fullMessage = "Make room in your inventory before taking that item.") {
    const inventory = player.getInventory();
    if (inventory.contains(itemId)) return true;
    if (typeof inventory.getFreeSlots === "function" && inventory.getFreeSlots() <= 0) {
      player.sendMessage(fullMessage);
      return false;
    }
    inventory.adds(itemId, 1);
    return true;
  }

  function hasBankedItem(player, itemId) {
    for (let tab = 0; tab < 11; tab++) {
      if (player.getBank?.(tab)?.contains?.(itemId)) return true;
    }
    return false;
  }

  function replaceItems(player, required, removed, added) {
    const inventory = player.getInventory();
    if (!required.every((itemId) => inventory.contains(itemId))) return false;
    for (const itemId of removed) inventory.deleteNumber(itemId, 1);
    for (const [itemId, amount] of added) inventory.adds(itemId, amount);
    return true;
  }

  function prepAction(player, variant, npcId = 0) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  function prepObjectAt(event, x, y, z) {
    const tile = event?.location;
    return tile?.x === x && tile?.y === y && tile?.z === z;
  }

  function syncThroneBustVarbits(player) {
    if (!player || stage(player) < STAGE.CASTLE || stage(player) > STAGE.ESCAPE) return;
    const state = player.getAttribute(THRONE_PUZZLE_ATTRIBUTE) ?? {};
    THRONE_BUST_VARBITS.forEach((varbit, index) => {
      // The cache keeps each bust inert until the throne reveals the levers. The
      // first/second transformed children are the two lever positions.
      const value = state.started ? (state.pulled?.[index] ? 2 : 1) : 0;
      player.getPacketSender().sendVarbit(varbit, value);
    });
  }

  function syncThroneBustsOnLogin({ player }) {
    syncThroneBustVarbits(player);
  }

  function handleCastleOuterLibraryLever(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    // The oploc packet and the cache varbit are keyed by the placed loc id. Its
    // resolved definition can be a different lever model, so match either ID.
    const ids = [event?.objectId, event?.definition?.id];
    if (!player || !ids.includes(CASTLE_OUTER_LIBRARY_LEVER.id) || x !== CASTLE_OUTER_LIBRARY_LEVER.x ||
      y !== CASTLE_OUTER_LIBRARY_LEVER.y || z !== CASTLE_OUTER_LIBRARY_LEVER.z ||
      String(event?.option ?? "").toLowerCase() !== "pull") return false;
    event.handled = true;
    const story = castleStory(player);
    if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.NORTH_LOBBY_HALL ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("The lever does not respond from this side of the castle.");
      return;
    }
    if (story.parlourPortalUnlocked) {
      player.sendMessage("The portal is already open.");
      return;
    }
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, parlourPortalUnlocked: true });
    player.getPacketSender().sendVarbit(CASTLE_OUTER_LIBRARY_PORTAL_VARBIT, 1);
    player.sendMessage("You pull the lever and a portal appears.");
  }

  function handleCastleOuterLibraryPortal(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const ids = [event?.objectId, event?.definition?.id];
    if (!player || !ids.includes(CASTLE_OUTER_LIBRARY_PORTAL.id) || x !== CASTLE_OUTER_LIBRARY_PORTAL.x ||
      y !== CASTLE_OUTER_LIBRARY_PORTAL.y || z !== CASTLE_OUTER_LIBRARY_PORTAL.z ||
      String(event?.option ?? "").toLowerCase() !== "enter") return false;
    event.handled = true;
    if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE || !castleStory(player).parlourPortalUnlocked ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.NORTH_LOBBY_HALL ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2) {
      player.sendMessage("The portal is not ready for you to enter.");
      return;
    }
    player.setAttribute(CASTLE_ROOM_ATTRIBUTE, CASTLE_ROOM.STUDY);
    player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, CASTLE_GROUND_FLOOR);
    syncCastleRoom(player, 2);
    player.moveTo(new Location(...CASTLE_OUTER_LIBRARY_PORTAL.destination));
  }

  function handleCastleDoorEnter(event) {
    const player = event?.player;
    const { x, y, z } = event?.location ?? {};
    const currentStage = player && stage(player);
    const name = event?.definition?.getName?.();
    const visibleId = event?.definition?.id ?? event?.objectId;
    const objectIds = [visibleId, event?.objectId];
    const option = String(event?.option ?? "").toLowerCase();
    if (!player || quest.isComplete(player) || currentStage < STAGE.CASTLE || currentStage > STAGE.ESCAPE ||
      !["enter", "climb-up", "climb-down"].includes(option) ||
      (!CASTLE_DOOR_NAMES.includes(name) && !CASTLE_DOOR_TRANSITIONS.some(door => objectIds.includes(door.id) &&
        door.x === x && door.y === y && (door.z ?? 0) === z)) ||
      x < 2300 || x > 2600 || y < 7300 || y > 7440) return false;
    const transition = CASTLE_DOOR_TRANSITIONS.find(door => objectIds.includes(door.id) && door.x === x && door.y === y &&
      (door.z ?? 0) === z && String(door.action ?? "Enter").toLowerCase() === option);
    // The active transformed definition can reuse an unrelated canonical door
    // ID. An exact placed-route match is more specific than that child ID.
    const moonDoorKey = CASTLE_MOON_DOOR_KEYS.get(transition?.id) ??
      (transition ? null : CASTLE_MOON_DOOR_KEYS.get(visibleId) ?? CASTLE_MOON_DOOR_KEYS.get(event?.objectId));
    const passageKey = transition && `${transition.id}:${transition.x},${transition.y},${transition.z ?? 0}:${transition.from}->${transition.to}`;
    const unlockedPassages = player.getAttribute(CASTLE_UNLOCKED_PASSAGES_ATTRIBUTE) ?? [];
    const passageAlreadyUnlocked = passageKey && unlockedPassages.includes(passageKey);
    if (moonDoorKey && !hasItem(player, moonDoorKey[0]) && !passageAlreadyUnlocked) {
      event.handled = true;
      player.sendMessage(`The door is locked. You need the ${moonDoorKey[1]}.`);
      return;
    }
    if (transition) {
      const currentRoom = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) || CASTLE_ROOM.LOBBY;
      const currentFloor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) || CASTLE_GROUND_FLOOR;
      if (transition.key && !hasItem(player, transition.key) && !passageAlreadyUnlocked) {
        event.handled = true;
        player.sendMessage(`The door is locked. You need the ${transition.keyName}.`);
        return;
      }
      if (transition.anyKey && !transition.anyKey.some(itemId => hasItem(player, itemId))) {
        event.handled = true;
        player.sendMessage(`The door is locked. You need ${transition.keyName}.`);
        return;
      }
      if (transition.requiresStory && !castleStory(player)[transition.requiresStory]) {
        event.handled = true;
        if (transition.requiresStory === "gibbousSpearDoorUnlocked") {
          const gibbous = castleStory(player).gibbous;
          if (!gibbous.daggerRead || !gibbous.gridNoteRead) {
            player.sendMessage("The lock needs a five-letter code. The dagger and grid note contain clues.");
          } else {
            chooseGibbousDoorLetter(player);
          }
        } else if (transition.requiresStory === "chapelPortalOpened") {
          player.sendMessage("The chapel lever must be pulled before the portal appears.");
        } else {
          player.sendMessage("The nearby passage remains sealed until you place a Drakan emblem in its receptacle.");
        }
        return;
      }
      if (currentRoom !== transition.from || currentFloor !== (transition.fromFloor ?? CASTLE_GROUND_FLOOR)) {
        player.sendMessage("That doorway does not lead onward from this part of the castle.");
        event.handled = true;
        return;
      }
      event.handled = true;
      // Remember only this exact placed passage, after its normal key check and
      // room-side validation. A solved puzzle or a key claimed long ago does
      // not unlock every door that shares the same visible cache definition.
      const keyId = moonDoorKey?.[0] ?? transition.key;
      const hasUnlockItem = keyId && hasItem(player, keyId);
      const unlockReturn = transition.consumesKey && transition.key && hasUnlockItem
        ? CASTLE_DOOR_TRANSITIONS.find(door => door.from === transition.to && door.to === transition.from && door.key === transition.key)
        : null;
      const returnPassageKey = unlockReturn &&
        `${unlockReturn.id}:${unlockReturn.x},${unlockReturn.y},${unlockReturn.z ?? 0}:${unlockReturn.from}->${unlockReturn.to}`;
      const unlocked = new Set(unlockedPassages);
      if (passageKey && (moonDoorKey || transition.key) && !passageAlreadyUnlocked && hasUnlockItem) {
        unlocked.add(passageKey);
      }
      // The solid key breaks in this lock. Remember both sides of that one
      // paired doorway so the consumed key does not strand the player inside.
      if (transition.consumesKey && returnPassageKey && hasUnlockItem) {
        player.getInventory().deleteNumber(transition.key, 1);
        unlocked.add(passageKey);
        unlocked.add(returnPassageKey);
      }
      if (unlocked.size !== unlockedPassages.length) {
        player.setAttribute(CASTLE_UNLOCKED_PASSAGES_ATTRIBUTE, [...unlocked]);
      }
      player.setAttribute(CASTLE_ROOM_ATTRIBUTE, transition.to);
      player.setAttribute(CASTLE_FLOOR_ATTRIBUTE, transition.toFloor ?? CASTLE_GROUND_FLOOR);
      syncCastleRoom(player, transition.facing);
      player.moveTo(new Location(transition.landing[0], transition.landing[1], transition.landing[2] ?? 0));
      syncCastleActors(player);
      if (transition.to === CASTLE_ROOM.SECRET_ROOM) syncCastleBookKey(player);
      return;
    }
    if (name !== "Door") return false;
    const door = event.object;
    const face = door?.getFace?.();
    if (!Number.isInteger(face)) return false;
    const axis = (face & 1) === 0 ? "x" : "y";
    const source = event.sourceLocation ?? {
      x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ(),
    };
    const side = Math.sign(source[axis] - event.location[axis]) || (face === 0 || face === 3 ? 1 : -1);
    const privateArea = player.getPrivateArea?.() ?? null;
    let destination = null;
    // Castle doors sit in thick walls; the first tile beyond the clickable loc
    // can still be clipped by the wall. Walk the same line until clear floor.
    for (let distance = 1; distance <= 8; distance++) {
      const across = event.location[axis] - side * distance;
      const candidate = axis === "x"
        ? new Location(across, source.y, z)
        : new Location(source.x, across, z);
      if (!api.core.RegionManager.blocked(candidate, privateArea)) {
        destination = candidate;
        break;
      }
    }
    if (!destination) return false;
    event.handled = true;
    player.moveTo(destination);
  }

  function handleCastleBookObjects(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    if (z !== CASTLE_LIBRARY.z) return;
    const id = event?.definition?.id ?? event?.objectId;
    const rawId = event?.objectId;
    const option = String(event?.option ?? "").toLowerCase();
    const name = String(event?.definition?.getName?.() ?? "").toLowerCase();
    const story = castleStory(player);
    const progress = Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70;
    if (progress >= 76 && Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.VENATOR_LIBRARY &&
      (id === 61757 || rawId === 61757) && x === 2549 && y === 7381 && option === "search") {
      event.handled = true;
      if (!story.gibbous.spearDoorUnlocked && !story.gibbousSpearDoorUnlocked) {
        player.sendMessage("The library door is still locked."); return;
      }
      if (story.gibbous.mysteriousBookClaimed || hasItem(player, ItemIdentifiers.MYSTERIOUS_BOOK)) return;
      if (castleKeyGive(player, ItemIdentifiers.MYSTERIOUS_BOOK,
        "You search the bookcase and find an oddly weighted book. You take it.")) {
        updateGibbousStory(player, { mysteriousBookClaimed: true });
      }
      return;
    }
    if ([61615, 61616, 61617, 61618].includes(id) && x === CASTLE_LIBRARY.passage[0] &&
      y === CASTLE_LIBRARY.passage[1] && option === "enter") {
      if (!story.bookPuzzleComplete) {
        event.handled = true;
        player.sendMessage("The hidden passage remains sealed until you arrange the Vampyric Houses alphabetically.");
        return;
      }
      syncCastleBookKey(player);
      return;
    }
    const puzzle = bookPuzzleState(player);
    if (CASTLE_GILDED_BOOKCASE_IDS.has(id) && x === CASTLE_LIBRARY.westernBookcase[0] &&
      y === CASTLE_LIBRARY.westernBookcase[1] && option === "search" && puzzle.prepared && !puzzle.solved) {
      event.handled = true;
      startCastleBookPuzzlePrompt(player);
      return;
    }
    const gildedShelf = id === 61756 && x === CASTLE_LIBRARY.gildedBookcase[0] && y === CASTLE_LIBRARY.gildedBookcase[1];
    const vampyreShelf = id === 61757 && x === CASTLE_LIBRARY.vampyreBookcase[0] && y === CASTLE_LIBRARY.vampyreBookcase[1];
    if (option !== "search" || !/bookcase|bookshelf/.test(name) || (!gildedShelf && !vampyreShelf) ||
      progress < 78 || !story.talkedToIvan || !story.defeated.includes("library-venator")) return;
    event.handled = true;
    const inventory = player.getInventory();
    if (gildedShelf) {
      if (inventory.contains(CASTLE_BOOK_ITEMS.gilded)) {
        player.sendMessage("You already have the gilded book from this shelf.");
        return;
      }
      if (inventory.getFreeSlots() <= 0 || !inventory.adds(CASTLE_BOOK_ITEMS.gilded, 1)) {
        player.sendMessage("Make room in your inventory before taking the gilded book.");
        return;
      }
      player.sendMessage("You search the northern bookcase and take a gilded book.");
      return;
    }
    if (inventory.contains(CASTLE_BOOK_ITEMS.vampyre)) {
      player.sendMessage("You have already taken a book about the Vampyric Houses from this shelf.");
      return;
    }
    if (inventory.getFreeSlots() <= 0 || !inventory.adds(CASTLE_BOOK_ITEMS.vampyre, 1)) {
      player.sendMessage("Make room in your inventory before taking the book.");
      return;
    }
    player.sendMessage("You search the south-eastern bookcase and take a book about the Vampyric Houses.");
  }

  function handleCastleSecretRoomObjects(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const id = event?.definition?.id ?? event?.objectId;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) < 78 ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.SECRET_ROOM ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== 2 || z !== CASTLE_LIBRARY.z ||
      id !== 61752 || x !== 2433 || y !== 7411 || String(event?.option ?? "").toLowerCase() !== "search") return false;
    event.handled = true;
    const story = castleStory(player);
    const potion = CASTLE_KEY_ITEMS.chunkyPotion1;
    if (story.secretRoomPotionClaimed || hasItem(player, potion)) {
      player.sendMessage("You search the shelves, but find nothing else of use.");
      return true;
    }
    api.sendMultiChatboxPrompt(player, "You search the shelves and find a foul chunky potion.",
      "Leave it", () => {},
      "Take it", () => {
        if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
          Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.SECRET_ROOM ||
          castleStory(player).secretRoomPotionClaimed || hasItem(player, potion)) return;
        if (castleKeyGive(player, potion, "You take a foul chunky potion from the shelves.")) {
          player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...castleStory(player), secretRoomPotionClaimed: true });
        }
      });
    return true;
  }

  function handleCastleChunkyPotionCombine(event) {
    const player = event?.player;
    const oneDose = CASTLE_KEY_ITEMS.chunkyPotion1;
    const room = Number(player?.getAttribute(CASTLE_ROOM_ATTRIBUTE));
    const floor = Number(player?.getAttribute(CASTLE_FLOOR_ATTRIBUTE));
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      ![CASTLE_ROOM.SECRET_ROOM, CASTLE_ROOM.BEDROOM].includes(room) ||
      (room === CASTLE_ROOM.BEDROOM && floor !== 2) ||
      event.usedItemId !== oneDose || event.usedWithItemId !== oneDose) return false;
    event.handled = true;
    const inventory = player.getInventory();
    if (event.usedItemSlot === event.usedWithItemSlot || inventory.getAmount(oneDose) < 2 ||
      !inventory.deleteNumber(oneDose, 2) || inventory.adds(CASTLE_KEY_ITEMS.chunkyPotion2, 1) === false) {
      player.sendMessage("You need two separate one-dose foul chunky potions to combine them.");
      return true;
    }
    player.sendMessage("You combine the potion into two doses.");
    return true;
  }

  function handleCastleBookOnObject(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const objectId = event?.definition?.id ?? event?.objectId;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      (Number(player.getAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE)) || 70) < 78 || !castleStory(player).talkedToIvan ||
      event?.itemId !== CASTLE_BOOK_ITEMS.gilded || !CASTLE_GILDED_BOOKCASE_IDS.has(objectId) ||
      x !== CASTLE_LIBRARY.westernBookcase[0] || y !== CASTLE_LIBRARY.westernBookcase[1] || z !== CASTLE_LIBRARY.z) return;
    event.handled = true;
    const inventory = player.getInventory();
    if (!inventory.contains(CASTLE_BOOK_ITEMS.vampyre)) {
      player.sendMessage("The book asks for the Vampyric Houses volume from the south-eastern bookcase before it can be arranged.");
      return;
    }
    const state = bookPuzzleState(player);
    if (state.solved || castleStory(player).bookPuzzleComplete) {
      player.sendMessage("The books are already arranged in alphabetical order.");
      return;
    }
    inventory.deleteNumber(CASTLE_BOOK_ITEMS.gilded, 1);
    player.setAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE, { ...state, prepared: true });
    player.getPacketSender().sendVarbit(CASTLE_GILDED_BOOKCASE_VARBIT, 1);
    startCastleBookPuzzlePrompt(player);
  }

  function routeCastleDoorEnter(event) {
    const player = event?.player;
    const tile = event?.object?.getLocation?.();
    const currentStage = player && stage(player);
    const name = event.definition?.getName?.();
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
    const visibleId = event.definition?.id ?? event.objectId;
    const objectIds = [visibleId, event.objectId];
    if (!player || quest.isComplete(player) || currentStage < STAGE.CASTLE || currentStage > STAGE.ESCAPE ||
      (!CASTLE_DOOR_NAMES.includes(name) && !CASTLE_DOOR_TRANSITIONS.some(door => objectIds.includes(door.id) &&
        door.x === tile?.getX?.() && door.y === tile?.getY?.() && (door.z ?? 0) === tile?.getZ?.())) ||
      !["Enter", "Climb-up", "Climb-down"].includes(option) ||
      !tile || tile.getX() < 2300 || tile.getX() > 2600 ||
      tile.getY() < 7300 || tile.getY() > 7440) return;
    const source = event.sourceLocation;
    const sourceX = source?.x ?? source?.getX?.();
    const sourceY = source?.y ?? source?.getY?.();
    const sourceZ = source?.z ?? source?.getZ?.();
    // The hidden passage is a scenery loc embedded in a blocked wall tile.
    // Generic object pathing cannot execute its Enter action from the adjacent
    // floor tile, so replay the click from that same reachable tile.
    if (objectIds.includes(CASTLE_DOOR_IDS.IVAN_PASSAGE) && tile.getX() === 2455 &&
      tile.getY() === 7386 && tile.getZ() === 0 &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.IVAN_ROOM &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 && sourceZ === 0 &&
      Math.max(Math.abs(sourceX - tile.getX()), Math.abs(sourceY - tile.getY())) <= 1) {
      event.destination = { x: sourceX, y: sourceY, z: sourceZ };
      return;
    }
    // The ground-lobby staircase fills a 3x4 cache footprint against a wall.
    // Its only reachable interaction edge is the west side, even though the
    // cache rotation directs generic pathing toward the blocked south edge.
    // Replaying the click from the player's current west-edge tile lets the
    // normal interaction handler perform the paired climb transition.
    if (objectIds.includes(CASTLE_DOOR_IDS.STAIRS_UP) && tile.getX() === 2315 &&
      tile.getY() === 7370 && tile.getZ() === 0 &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.LOBBY &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === CASTLE_GROUND_FLOOR &&
      sourceZ === 0 && sourceX === 2314 && sourceY >= 7369 && sourceY <= 7374) {
      event.destination = { x: sourceX, y: sourceY, z: sourceZ };
      return;
    }
    // The basement stair is also embedded in the lobby's clipped west wall.
    // The cache footprint has a clear approach on its west edge; replaying
    // from that edge lets the normal Climb-down action reach the paired hall.
    if (objectIds.includes(CASTLE_DOOR_IDS.STAIRS_DOWN) && tile.getX() === 2311 &&
      tile.getY() === 7366 && tile.getZ() === 0 &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.LOBBY &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === CASTLE_GROUND_FLOOR &&
      sourceZ === 0 && sourceX === 2310 && sourceY >= 7366 && sourceY <= 7374) {
      event.destination = { x: 2310, y: 7366, z: 0 };
      return;
    }
    // The paired basement stair is clickable from the west, but its footprint
    // never reaches the interaction threshold used by generic object pathing.
    // Replay the valid climb from the same cache-clear hall-side tile.
    if (objectIds.includes(CASTLE_DOOR_IDS.STAIRS_UP_NORUG) && tile.getX() === 2564 &&
      tile.getY() === 7369 && tile.getZ() === 0 &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.BASEMENT_HALL &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === CASTLE_GROUND_FLOOR &&
      sourceZ === 0 && sourceX === 2563 && sourceY >= 7367 && sourceY <= 7372) {
      event.destination = { x: sourceX, y: sourceY, z: sourceZ };
      return;
    }
    // This basement crescent door faces a clipped row on its southern edge.
    // Its hall-side approach is west; the normal face-based route picks the
    // blocked south tile, so replay Enter from the cache-clear west approach.
    if (objectIds.includes(CASTLE_DOOR_IDS.CRESCENT_M) && tile.getX() === 2570 &&
      tile.getY() === 7365 && tile.getZ() === 0 &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.BASEMENT_HALL &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === CASTLE_GROUND_FLOOR &&
      sourceZ === 0 && sourceX >= 2563 && sourceX <= 2569 && sourceY >= 7365 && sourceY <= 7369) {
      event.destination = { x: 2568, y: 7365, z: 0 };
      return;
    }
    if (sourceZ === tile.getZ() &&
      Math.max(Math.abs(sourceX - tile.getX()), Math.abs(sourceY - tile.getY())) <= 1) return;
    // The north-lobby door is placed in a clipped wall segment disconnected
    // from the player's landing room component. Route to the known connected
    // room arrival point, then let the same Enter packet use the paired door.
    if (objectIds.includes(61576) && tile.getX() === 2466 && tile.getY() === 7422 &&
      tile.getZ() === 0 && Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.NORTH_LOBBY_HALL) {
      event.destination = { x: 2456, y: 7417, z: 0 };
      return;
    }
    // The shield crate sits in a clipped pocket on the far side of the return door.
    // Replay Enter from a reachable tile in that pocket instead of pathing through
    // the wall to the door footprint.
    if (objectIds.includes(CASTLE_DOOR_IDS.FULL_M) && tile.getX() === 2434 &&
      tile.getY() === 7372 && tile.getZ() === 0 &&
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) === CASTLE_ROOM.ABOVE_STUDY &&
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) === 2 && sourceZ === 0 &&
      [[2438, 7377], [2439, 7377], [2440, 7377], [2440, 7378]].some(([x, y]) => sourceX === x && sourceY === y)) {
      event.destination = { x: sourceX, y: sourceY, z: sourceZ };
      return;
    }
    const face = event.object.getFace();
    const axis = (face & 1) === 0 ? "x" : "y";
    const side = Math.sign(source?.[axis] - (axis === "x" ? tile.getX() : tile.getY())) ||
      (face === 0 || face === 3 ? 1 : -1);
    const privateArea = player.getPrivateArea?.() ?? null;
    // Castle doors can sit in a multi-tile clipped wall. Route to the first
    // clear tile on the player's current side instead of falling through to a
    // clear tile on the far side, which leaves pathfinding trying to cross the
    // wall without executing the Enter action.
    for (let distance = 1; distance <= 8; distance++) {
      const candidate = axis === "x"
        ? new Location(tile.getX() + side * distance, tile.getY(), tile.getZ())
        : new Location(tile.getX(), tile.getY() + side * distance, tile.getZ());
      if (api.core.RegionManager.blocked(candidate, privateArea)) continue;
      event.destination = { x: candidate.getX(), y: candidate.getY(), z: candidate.getZ() };
      return;
    }
  }

  function handleCastleThronePuzzle(event) {
    const player = event?.player;
    const value = player && stage(player);
    if (!player || quest.isComplete(player) || value < STAGE.CASTLE || value > STAGE.ESCAPE) return;
    const tile = event.location;
    const x = tile?.x ?? tile?.getX?.();
    const y = tile?.y ?? tile?.getY?.();
    const z = tile?.z ?? tile?.getZ?.();
    const name = String(event.definition?.getName?.() ?? "").toLowerCase();
    const state = player.getAttribute(THRONE_PUZZLE_ATTRIBUTE) ?? { step: 0, solved: false, keyClaimed: false, pulled: [] };
    // The loc is placed at y=7391 and covers y=7391–7392. The Quest Helper
    // highlights the southern footprint tile (7392), while normal object
    // packets resolve to the cache anchor (7391).
    if (name.includes("throne") && x === 2313 && [7391, 7392].includes(y) && z === 0) {
      event.handled = true;
      const throneOption = String(event.option ?? "").toLowerCase();
      if (["investigate", "search"].includes(throneOption) && !state.started && !state.solved) {
        const next = { ...state, started: true, pulled: [false, false, false, false] };
        player.setAttribute(THRONE_PUZZLE_ATTRIBUTE, next);
        syncThroneBustVarbits(player);
        player.sendMessage("The four busts conceal a mechanism. Their levers must be pulled in the right order.");
        return;
      }
      const hasKey = hasItem(player, ItemIdentifiers.HALF_MOON_KEY);
      if (state.solved && !hasKey && ["search", "take", "investigate"].includes(throneOption)) {
        if (!giveInventoryItem(player, ItemIdentifiers.HALF_MOON_KEY, "Make room before taking the half moon key.")) return;
        player.setAttribute(THRONE_PUZZLE_ATTRIBUTE, { ...state, keyClaimed: true });
        player.sendMessage("You find a half moon key inside the throne.");
        return;
      }
      player.sendMessage(state.solved ? "The throne's hidden compartment is empty." : "There is nothing more to learn from the throne yet.");
      return;
    }
    const leverRow = x === 2317 && [7393, 7392, 7391, 7390].indexOf(y);
    if (!name.includes("bust") || !name.includes("lever") || z !== 0 || leverRow < 0) return;
    event.handled = true;
    if (!state.started) {
      player.sendMessage("Investigate the throne first; the busts must be part of its mechanism.");
      return;
    }
    if (state.solved) {
      player.sendMessage("The busts are already set in the correct order.");
      return;
    }
    // The OSRS puzzle order is the third bust, fourth, first, then second.
    const order = [2, 3, 0, 1];
    const pulled = [...(state.pulled ?? [false, false, false, false])];
    pulled[leverRow] = !pulled[leverRow];
    if (leverRow !== order[state.step]) {
      player.setAttribute(THRONE_PUZZLE_ATTRIBUTE, { ...state, step: 0, pulled });
      syncThroneBustVarbits(player);
      player.sendMessage("The mechanism clicks back into place. The bust sequence has reset.");
      return;
    }
    const step = state.step + 1;
    const solved = step === order.length;
    player.setAttribute(THRONE_PUZZLE_ATTRIBUTE, { ...state, step, solved, pulled });
    syncThroneBustVarbits(player);
    player.sendMessage(solved ? "The busts turn into alignment, and a compartment opens beneath the throne." : "The bust lever locks into place.");
  }

  function handleCastleBasinPuzzle(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const { x, y, z } = event.location ?? {};
    const name = String(event.definition?.getName?.() ?? "").toLowerCase();
    if (name !== "shelves" || x !== 2380 || y !== 7396 || z !== 0) return;
    event.handled = true;
    const state = player.getAttribute(BASIN_PUZZLE_ATTRIBUTE) ?? { basins: {}, symbol: false };
    const inventory = player.getInventory();
    const potions = [ItemIdentifiers.CLOUDY_GREY_POTION, ItemIdentifiers.WEIGHTLESS_BLACK_POTION,
      ItemIdentifiers.THICK_RED_POTION, ItemIdentifiers.COLD_BLUISH_WHITE_POTION];
    for (const potion of potions) if (!inventory.contains(potion)) inventory.adds(potion, 1);
    player.sendMessage("You search the north-west shelves and take one potion of each colour.");
  }

  function handleBasinPotion(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const { x, y, z } = event.location ?? {};
    if (z !== 0) return;
    const basin = `${x},${y}`;
    const correctBasin = new Map([
      [ItemIdentifiers.THICK_RED_POTION, "2380,7389"], // north-west: blood
      [ItemIdentifiers.WEIGHTLESS_BLACK_POTION, "2387,7389"], // north-east: shadow
      [ItemIdentifiers.CLOUDY_GREY_POTION, "2380,7384"], // south-west: smoke
      [ItemIdentifiers.COLD_BLUISH_WHITE_POTION, "2387,7384"], // south-east: ice
    ]);
    const expected = correctBasin.get(event.itemId);
    if (!expected || !["61702", "61703", "61704", "61705"].includes(String(event.objectId))) return;
    event.handled = true;
    const state = player.getAttribute(BASIN_PUZZLE_ATTRIBUTE) ?? { basins: {}, symbol: false };
    if (!player.getInventory().contains(event.itemId)) return;
    if (basin !== expected) {
      player.sendMessage("The basin rejects the potion. Read its inscription and choose another basin.");
      return;
    }
    if (state.basins[basin]) {
      player.sendMessage("A potion has already been poured into this basin.");
      return;
    }
    player.getInventory().deleteNumber(event.itemId, 1);
    const basins = { ...state.basins, [basin]: true };
    player.setAttribute(BASIN_PUZZLE_ATTRIBUTE, { ...state, basins });
    player.sendMessage("You pour the potion into the basin. The liquid settles beneath its inscription.");
  }

  function handleBasinAltar(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const { x, y, z } = event.location ?? {};
    const name = String(event.definition?.getName?.() ?? "").toLowerCase();
    if (name !== "altar" || x !== 2382 || y !== 7393 || z !== 0) return;
    event.handled = true;
    const state = player.getAttribute(BASIN_PUZZLE_ATTRIBUTE) ?? { basins: {}, symbol: false };
    if (!Object.values(state.basins).length || Object.keys(state.basins).length !== 4) {
      player.sendMessage("The altar remains still. The four inscriptions must each receive the correct potion.");
      return;
    }
      if (!giveInventoryItem(player, ItemIdentifiers.ANCIENT_SYMBOL, "Make room in your inventory before taking the ancient symbol.")) return;
      player.setAttribute(BASIN_PUZZLE_ATTRIBUTE, { ...state, symbol: true });
      player.sendMessage("You search the altar and take an ancient symbol.");
  }

  function handleCastleChapelLever(event) {
    const player = event?.player;
    const location = event?.location;
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const z = location?.z ?? location?.getZ?.();
    const ids = [event?.objectId, event?.definition?.id];
    if (!player || !ids.includes(CASTLE_CHAPEL_LEVER.id) || x !== CASTLE_CHAPEL_LEVER.x ||
      y !== CASTLE_CHAPEL_LEVER.y || z !== CASTLE_CHAPEL_LEVER.z ||
      String(event?.option ?? "").toLowerCase() !== "pull") return false;
    event.handled = true;
    if (quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.CHAPEL_LIBRARY ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== CASTLE_GROUND_FLOOR) {
      player.sendMessage("The lever does not respond from this side of the castle.");
      return true;
    }
    const basin = player.getAttribute(BASIN_PUZZLE_ATTRIBUTE) ?? { basins: {}, symbol: false };
    if (!basin.symbol || !hasItem(player, ItemIdentifiers.ANCIENT_SYMBOL)) {
      player.sendMessage("The lever remains still. The ancient symbol from the four basins is needed first.");
      return true;
    }
    const story = castleStory(player);
    if (story.chapelPortalOpened) {
      player.sendMessage("The portal is already open.");
      return true;
    }
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, chapelPortalOpened: true });
    syncCastleChapelPortal(player);
    player.sendMessage("You pull the lever and a portal appears.");
    return true;
  }

  function giveMountedShieldSolidKey(player) {
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const state = player.getAttribute(SOLID_KEY_ATTRIBUTE) ?? { shield: false, mounted: false, key: false };
    if (player.getInventory().contains(ItemIdentifiers.SOLID_KEY)) {
      player.sendMessage("You already have the solid key.");
      return;
    }
    if (!giveInventoryItem(player, ItemIdentifiers.SOLID_KEY,
      "Make room in your inventory before taking the solid key.")) return;
    player.setAttribute(SOLID_KEY_ATTRIBUTE, { ...state, key: true });
    player.sendMessage("You search the mounted shield and find a solid looking key. You take it.");
  }

  function handleSolidKeyObjects(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const { x, y, z } = event.location ?? {};
    if (z !== 0) return;
    const name = String(event.definition?.getName?.() ?? "").toLowerCase();
    const option = String(event.option ?? "").toLowerCase();
    const basinState = player.getAttribute(BASIN_PUZZLE_ATTRIBUTE) ?? { basins: {}, symbol: false };
    const state = player.getAttribute(SOLID_KEY_ATTRIBUTE) ?? { shield: false, mounted: false, key: false };
    if (name === "crate" && x === 2439 && y === 7378) {
      event.handled = true;
      if (!basinState.symbol || !player.getInventory().contains(ItemIdentifiers.ANCIENT_SYMBOL)) {
        player.sendMessage("The ancient shield's room lies beyond the chapel. Find the ancient symbol first.");
        return;
      }
      if (!giveInventoryItem(player, ItemIdentifiers.ANCIENT_SHIELD, "Make room in your inventory before taking the ancient shield.")) return;
      player.setAttribute(SOLID_KEY_ATTRIBUTE, { ...state, shield: true });
      player.sendMessage("You search the crate and take an ancient shield.");
      return;
    }
    if (x !== 2543 || y !== 7361) return;
    const visibleId = event.definition?.id ?? event.objectId;
    if (!state.mounted || (visibleId !== 61700 && name !== "mounted shield") || option !== "search") return;
    event.handled = true;
    if (player.getInventory().contains(ItemIdentifiers.SOLID_KEY)) {
      player.sendMessage("You already have the solid key.");
      return;
    }
    api.sendMultiChatboxPrompt(player, "Search the compartment?",
      "Yes.", () => giveMountedShieldSolidKey(player),
      "No.", () => {});
  }

  function setClockValue(player, side, hand, value) {
    const state = player.getAttribute(CLOCK_ATTRIBUTE) ?? { west: {}, east: {}, emblem: false };
    const clock = { ...(state[side] ?? {}), [hand]: value };
    player.setAttribute(CLOCK_ATTRIBUTE, { ...state, [side]: clock });
    player.sendMessage(`You set the ${hand === "large" ? "large" : "small"} clock hand to ${value}.`);
  }

  function syncCastleExplosiveBarrel(player) {
    if (!player || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.EXPLOSIVE_ROOM ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== CASTLE_GROUND_FLOOR ||
      !hasItem(player, ItemIdentifiers.TINDERBOX) || hasItem(player, ItemIdentifiers.EXPLOSIVE_BARREL)) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const tile = new Location(2439, 7388, 0);
    if (!manager.getGroundItem?.(player.getUsername?.(), ItemIdentifiers.EXPLOSIVE_BARREL, tile,
      player.getPrivateArea?.() ?? null)) {
      manager.registerLocation(player, new Item(ItemIdentifiers.EXPLOSIVE_BARREL, 1), tile);
    }
  }

  function handleCastleExplosiveBarrelPickup(event) {
    const player = event?.player;
    const tile = event?.location;
    const x = tile?.getX?.() ?? tile?.x;
    const y = tile?.getY?.() ?? tile?.y;
    const z = tile?.getZ?.() ?? tile?.z;
    if (!player || event?.groundItemId !== ItemIdentifiers.EXPLOSIVE_BARREL || stage(player) !== STAGE.CASTLE ||
      Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) !== CASTLE_ROOM.EXPLOSIVE_ROOM ||
      Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) !== CASTLE_GROUND_FLOOR ||
      x !== 2439 || y !== 7388 || z !== 0 || hasItem(player, ItemIdentifiers.TINDERBOX)) return;
    event.handled = true;
    player.sendMessage("The explosive barrel needs a tinderbox before you can take it.");
  }

  function promptClockValue(player, side, hand, page = 0) {
    const choices = [];
    const first = [0, 4, 7, 10][page];
    const count = [4, 3, 3, 2][page];
    for (let value = first; value < first + count; value++) choices.push(String(value),
      () => setClockValue(player, side, hand, value));
    if (page > 0) choices.push("Previous", () => promptClockValue(player, side, hand, page - 1));
    if (page < 3) choices.push("More...", () => promptClockValue(player, side, hand, page + 1));
    api.sendMultiChatboxPrompt(player, `Set the ${side} ${hand} clock hand`, ...choices);
  }

  function handleCastleClocks(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const { x, y, z } = event.location ?? {};
    if (z !== 0) return;
    const state = player.getAttribute(CLOCK_ATTRIBUTE) ?? { west: {}, east: {}, emblem: false };
    const room = Number(player.getAttribute(CASTLE_ROOM_ATTRIBUTE)) || CASTLE_ROOM.LOBBY;
    const floor = Number(player.getAttribute(CASTLE_FLOOR_ATTRIBUTE)) || CASTLE_GROUND_FLOOR;
    const visibleId = event.definition?.id ?? event.objectId;
    if (visibleId === 61691 && x === 2344 && y === 7387) {
      event.handled = true;
      if (room !== CASTLE_ROOM.STORAGE || floor !== CASTLE_GROUND_FLOOR) {
        player.sendMessage("The sparkling crate belongs to the storage room below the explosive-barrel chamber.");
        return;
      }
      if (!giveInventoryItem(player, ItemIdentifiers.TINDERBOX,
        "Make room in your inventory before taking the tinderbox.")) return;
      player.setAttribute(CLOCK_ATTRIBUTE, { ...state, tinderboxClaimed: true });
      player.sendMessage("You search the sparkling crate and take a tinderbox.");
      return;
    }
    if (visibleId === 61751 && x === 2454 && y === 7378) {
      event.handled = true;
      if (room !== CASTLE_ROOM.EMBLEM_ROOM || floor !== CASTLE_GROUND_FLOOR ||
        !hasItem(player, ItemIdentifiers.TINDERBOX) || !hasItem(player, ItemIdentifiers.EXPLOSIVE_BARREL)) {
        player.sendMessage("The crate is in the room south of the explosive-barrel chamber. First take the tinderbox and barrel.");
        return;
      }
      if (!giveInventoryItem(player, ItemIdentifiers.DRAKAN_EMBLEM,
        "Make room in your inventory before taking the Drakan emblem.")) return;
      player.setAttribute(CLOCK_ATTRIBUTE, { ...state, firstEmblemClaimed: true });
      player.sendMessage("You search the crate and take a Drakan emblem.");
      return;
    }
    if (event.objectId === 61752 && x === 2323 && y === 7386) {
      event.handled = true;
      if (!giveInventoryItem(player, ItemIdentifiers.SMALL_CLOCK_HAND, "Make room in your inventory before taking the small clock hand.")) return;
      player.sendMessage("You search the shelves and take a small clock hand.");
      return;
    }
    if (event.objectId === 61751 && x === 2466 && y === 7370) {
      event.handled = true;
      if (!giveInventoryItem(player, ItemIdentifiers.LARGE_CLOCK_HAND, "Make room in your inventory before taking the large clock hand.")) return;
      player.sendMessage("You search the crate and take a large clock hand.");
      return;
    }
    const side = event.objectId === 61656 && x === 2344 && y === 7372 ? "west" :
      event.objectId === 61657 && x === 2350 && y === 7372 ? "east" : null;
    if (side) {
      event.handled = true;
      const clock = state[side] ?? {};
      if (!clock.installed) {
        player.sendMessage("The clock is missing its hand. Fit the small hand to the western clock and the large hand to the eastern clock.");
        return;
      }
      api.sendMultiChatboxPrompt(player, `Adjust the ${side} grandfather clock`,
        "Set the large hand", () => promptClockValue(player, side, "large"),
        "Set the small hand", () => promptClockValue(player, side, "small"));
      return;
    }
    if (event.objectId === 61662 && x === 2346 && y === 7372) {
      event.handled = true;
      const west = state.west ?? {};
      const east = state.east ?? {};
      if (west.large !== 11 || west.small !== 9 || east.large !== 0 || east.small !== 4) {
        player.sendMessage("The fireplace mechanism remains locked. The western clock must show 11:45 and the eastern clock 12:20.");
        return;
      }
      if (!giveInventoryItem(player, ItemIdentifiers.DRAKAN_EMBLEM_2, "Make room in your inventory before taking the Drakan emblem.")) return;
      player.setAttribute(CLOCK_ATTRIBUTE, { ...state, emblem: true });
      player.sendMessage("You search the fireplace and take a second Drakan emblem.");
    }
  }

  function handleClockHandOnClock(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE || event.location?.z !== 0) return;
    const side = event.objectId === 61656 && event.location.x === 2344 && event.location.y === 7372 ? "west" :
      event.objectId === 61657 && event.location.x === 2350 && event.location.y === 7372 ? "east" : null;
    const itemId = event.itemId;
    const expectedItem = side === "west" ? ItemIdentifiers.SMALL_CLOCK_HAND :
      side === "east" ? ItemIdentifiers.LARGE_CLOCK_HAND : null;
    if (!side || itemId !== expectedItem) return;
    event.handled = true;
    const inventory = player.getInventory();
    if (!inventory.contains(itemId)) return;
    const state = player.getAttribute(CLOCK_ATTRIBUTE) ?? { west: {}, east: {}, emblem: false };
    if (state[side]?.installed) {
      player.sendMessage("A clock hand is already fitted there.");
      return;
    }
    inventory.deleteNumber(itemId, 1);
    player.setAttribute(CLOCK_ATTRIBUTE, { ...state, [side]: { ...(state[side] ?? {}), installed: true } });
    player.sendMessage(`You fit the ${side === "west" ? "small" : "large"} clock hand to the ${side} clock.`);
  }

  function promptGalleryChest(player) {
    const state = player.getAttribute(GALLERY_CHEST_ATTRIBUTE) ?? { step: 0, solved: false, key: false };
    const solution = ["right", "down", "right", "left", "left"];
    if (state.step >= solution.length) {
      player.setAttribute(GALLERY_CHEST_ATTRIBUTE, { ...state, solved: true });
      player.sendMessage("The chest's arrow mechanism clicks open. Search it for the crescent moon key.");
      return;
    }
    const options = ["Up", "Right", "Down", "Left"];
    const callbacks = options.map((label) => () => {
      const direction = label.toLowerCase();
      const current = player.getAttribute(GALLERY_CHEST_ATTRIBUTE) ?? { step: 0, solved: false, key: false };
      if (direction !== solution[current.step]) {
        player.setAttribute(GALLERY_CHEST_ATTRIBUTE, { ...current, step: 0, solved: false });
        player.sendMessage("The arrows click back to their starting positions. The chest puzzle resets.");
        return;
      }
      const step = current.step + 1;
      player.setAttribute(GALLERY_CHEST_ATTRIBUTE, { ...current, step, solved: step === solution.length });
      if (step === solution.length) {
        player.sendMessage("The chest's arrow mechanism clicks open. Search it for the crescent moon key.");
      } else {
        player.sendMessage(`One arrow locks into place (${step} of ${solution.length}).`);
        promptGalleryChest(player);
      }
    });
    const pairs = [];
    options.forEach((label, index) => pairs.push(label, callbacks[index]));
    api.sendMultiChatboxPrompt(player, `Chest arrows (${state.step + 1} of ${solution.length})`, ...pairs);
  }

  function handleGalleryChest(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      event.objectId !== 61681 || event.location?.x !== 2379 || event.location?.y !== 7372 || event.location?.z !== 0) return;
    event.handled = true;
    const state = player.getAttribute(GALLERY_CHEST_ATTRIBUTE) ?? { step: 0, solved: false, key: false };
    if (!state.solved) {
      promptGalleryChest(player);
      return;
    }
    if (hasItem(player, ItemIdentifiers.CRESCENT_MOON_KEY)) {
      player.sendMessage("You already have the crescent moon key.");
      return;
    }
    if (!giveInventoryItem(player, ItemIdentifiers.CRESCENT_MOON_KEY, "Make room in your inventory before taking the crescent moon key.")) return;
    player.setAttribute(GALLERY_CHEST_ATTRIBUTE, { ...state, key: true });
    player.sendMessage("You search the chest and take the crescent moon key.");
  }

  function syncHuntGroundItems(event) {
    const player = event?.player ?? event;
    if (!player || player.isPlayerBot?.() === true ||
      ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player))) return;
    const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    const manager = api.getItemOnGroundManager();
    if (!manager?.registerLocation) return;
    const area = player.getPrivateArea?.() ?? null;
    const drops = [
      { id: HUNT_ITEMS.crank, tile: new Location(2603, 7847, 0), claimed: hunt.crankStarted },
      { id: HUNT_ITEMS.toothHalf, tile: new Location(2600, 7845, 0), claimed: hasItem(player, HUNT_ITEMS.myrmelKey) },
      { id: HUNT_ITEMS.loopHalf, tile: new Location(2588, 7816, 0), claimed: hasItem(player, HUNT_ITEMS.myrmelKey) },
      { id: HUNT_ITEMS.bucket, tile: new Location(2596, 7833, 0), claimed: hasItem(player, HUNT_ITEMS.bucket) || hasItem(player, HUNT_ITEMS.bucketWater) },
      { id: HUNT_ITEMS.trapdoorKey, tile: new Location(2619, 7812, 0), claimed: hunt.trapdoorUnlocked || hasItem(player, HUNT_ITEMS.trapdoorKey) },
      { id: HUNT_ITEMS.oldCog, tile: new Location(2582, 7817, 0), claimed: hunt.drawbridgeRepaired || hasItem(player, HUNT_ITEMS.oldCog), enabled: hunt.chapelPuzzleSolved === true },
    ];
    for (const { id, tile, claimed, enabled = true } of drops) {
      if (!enabled) continue;
      if (claimed || hasItem(player, id) || manager.getGroundItem(player.getUsername(), id, tile, area)) continue;
      manager.registerLocation(player, new Item(id, 1), tile);
    }
  }

  function handleBloodHuntDoorToggle(event) {
    const player = event?.player;
    const { x, y, z } = event?.location ?? {};
    if (!player || quest.isComplete(player) || ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player)) ||
      z !== 0) return;
    const state = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    const inventory = player.getInventory();
    const id = event.objectId;
    const doors = [
      { x: 2612, y: 7853, ids: [ObjectIdentifiers.VITUR_DOOR], item: HUNT_ITEMS.viturKey, flag: "viturManorDoor", varbit: HUNT_DOOR_VARBITS.viturManorDoor, name: "The Vitur manor is locked. Find the key in the bookcase north-west of the crank." },
      { x: 2612, y: 7852, ids: [ObjectIdentifiers.VITUR_DOOR_2], item: HUNT_ITEMS.viturKey, flag: "viturManorDoor", varbit: HUNT_DOOR_VARBITS.viturManorDoor, name: "The door is locked. You need the Vitur key." },
      { x: 2598, y: 7843, ids: [ObjectIdentifiers.VITUR_DOOR_4], item: HUNT_ITEMS.viturKey, flag: "foodShopDoorUnlocked", varbit: HUNT_DOOR_VARBITS.foodShopDoorUnlocked, name: "The door is locked. You need the Vitur key." },
      { x: 2590, y: 7818, ids: [61840, ObjectIdentifiers.CHAINED_DOOR], item: HUNT_ITEMS.boltCutters, flag: "chainCut", varbit: HUNT_DOOR_VARBITS.chainCut, consume: true, name: "The clothes-shop door is chained shut. You need bolt cutters.", success: "You cut the chain on the door using the bolt cutters. Seeing no further use for them, you discard the bolt cutters." },
      { x: 2599, y: 7826, ids: [ObjectIdentifiers.MYRMEL_DOOR], item: HUNT_ITEMS.myrmelKey, flag: "pubDoorUnlocked", varbit: HUNT_DOOR_VARBITS.pubDoorUnlocked, name: "The pub door is locked. Join the two halves of the key to make a Myrmel key." },
      { x: 2614, y: 7814, ids: [ObjectIdentifiers.SHADUM_DOOR_3], item: HUNT_ITEMS.shadumKey, flag: "shadumDoorUnlocked", varbit: HUNT_DOOR_VARBITS.shadumDoorUnlocked, name: "The house is locked. The barrel in the Myrmel pub may hold a key." },
      { x: 2580, y: 7812, ids: [ObjectIdentifiers.JOVKAI_DOOR], item: HUNT_ITEMS.jovkaiKey, flag: "jovkaiDoorUnlocked", varbit: HUNT_DOOR_VARBITS.jovkaiDoorUnlocked, name: "The smithy is locked. Search the altar chest for its key." },
      { x: 2580, y: 7835, ids: [ObjectIdentifiers.MYRMEL_DOOR_3], item: HUNT_ITEMS.myrmelKey, flag: "bankDoorUnlocked", varbit: HUNT_DOOR_VARBITS.bankDoorUnlocked, name: "The bank door needs the Myrmel key." },
      { x: 2580, y: 7832, ids: [61854, 61855], flag: "innerBankDoorUnlocked", varbit: HUNT_DOOR_VARBITS.innerBankDoorUnlocked, name: "The bank gate is securely locked. Operate the crank base inside first.", extra: () => Boolean(state.bankCrank) },
      { x: 2579, y: 7830, ids: [HUNT_TRAPDOOR_ID], item: HUNT_ITEMS.trapdoorKey, flag: "trapdoorUnlocked", varbit: HUNT_DOOR_VARBITS.trapdoorUnlocked, consume: true, name: "The trapdoor is locked. Find its key and operate the bank crank.", extra: () => Boolean(state.bankCrank) },
      { x: 2587, y: 7857, ids: [ObjectIdentifiers.DOOR_839], flag: "fancyHouseDoorUnlocked", varbit: HUNT_DOOR_VARBITS.fancyHouseDoorUnlocked, name: "The crank mechanism has not released this door.", extra: () => Number(state.crankTurns) >= 10 },
      { x: 2581, y: 7842, ids: [ObjectIdentifiers.DOOR_842], flag: "chapelBackDoorUnlocked", varbit: HUNT_DOOR_VARBITS.chapelBackDoorUnlocked, name: "The chapel door is locked. Solve the chest puzzle first.", extra: () => Boolean(state.chapelPuzzleSolved) },
    ];
    const door = doors.find((entry) => entry.x === x && entry.y === y && entry.ids.includes(id));
    if (!door) return;
    if (state[door.flag]) return;
    if ((door.item !== undefined && !inventory.contains(door.item)) || (door.extra && !door.extra())) {
      event.handled = true;
      player.sendMessage(door.name);
      return;
    }
    if (door.consume && door.item !== undefined) inventory.deleteNumber(door.item, 1);
    player.setAttribute(HUNT_ATTRIBUTE, { ...state, [door.flag]: true });
    player.getPacketSender().sendVarbit(door.varbit, 1);
    if (door.success) player.sendMessage(door.success);
    else if (door.item !== undefined) player.sendMessage(`You unlock the door using the ${door.flag === "viturManorDoor" || door.flag === "foodShopDoorUnlocked" ? "Vitur" : door.flag === "pubDoorUnlocked" || door.flag === "bankDoorUnlocked" ? "Myrmel" : door.flag === "shadumDoorUnlocked" ? "Shadum" : door.flag === "jovkaiDoorUnlocked" ? "Jovkai" : "trapdoor"} key.`);
  }

  function syncBloodHuntDoorOnLogin(event) {
    const player = event?.player ?? event;
    if (!player) return;
    const state = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    // Early versions recorded the chain as cut before the scene varbit was updated and
    // left the single-use cutters in the backpack. Reconcile that saved state to the
    // captured result (the chain is gone and the cutters are discarded).
    if (state.chainCut) {
      const inventory = player.getInventory?.();
      if (inventory?.contains?.(HUNT_ITEMS.boltCutters)) inventory.deleteNumber(HUNT_ITEMS.boltCutters, 1);
    }
    for (const [flag, varbit] of Object.entries(HUNT_DOOR_VARBITS)) {
      player.getPacketSender().sendVarbit(varbit, state[flag] ? 1 : 0);
    }
    const savedCrankTurns = state.bankCrankStarted ? state.bankCrankTurns : state.crankTurns;
    player.getPacketSender().sendVarbit(HUNT_CRANK_PROGRESS_VARBIT, Math.min(10, Number(savedCrankTurns) || 0));
    player.getPacketSender().sendVarbit(HUNT_CRANK_PROGRESS_CACHED_VARBIT, Math.min(10, Number(savedCrankTurns) || 0));
    player.getPacketSender().sendVarbit(HUNT_DOOR_VARBITS.innerBankDoorUnlocked, state.bankCrank ? 1 : 0);
    player.getPacketSender().sendVarbit(15485, state.drawbridgeRepaired ? 1 : 0);
    player.getPacketSender().sendVarbit(15603, state.pursuitStarted ? 1 : 0);
    if ([STAGE.BLOOD_HUNT, STAGE.PREPARATIONS].includes(stage(player))) {
      player.getPacketSender().sendVarbit(15565, state.suppliesClaimed ? 0 : 1);
    }
    if (stage(player) === STAGE.BLOOD_HUNT) {
      player.getPacketSender().sendVarbit(15464, nativeStage(STAGE.BLOOD_HUNT, player));
    }
  }

  function promptHuntCode(player, kind, offset = 0) {
    const code = kind === "shed" ? "TOOLS" : "35158";
    const key = kind === "shed" ? "shedDigits" : "chestDigits";
    const state = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    const entered = state[key] ?? "";
    const options = kind === "shed" ? ["T", "O", "L", "S"] : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
    const pairs = [];
    const pageSize = kind === "shed" ? options.length : 3;
    const page = options.slice(offset, offset + pageSize);
    for (const label of page) pairs.push(label, () => {
      const current = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
      const value = (current[key] ?? "") + label;
      if (value !== code.slice(0, value.length)) {
        player.setAttribute(HUNT_ATTRIBUTE, { ...current, [key]: "" });
        player.sendMessage("The lock clicks and resets.");
        promptHuntCode(player, kind);
        return;
      }
      player.setAttribute(HUNT_ATTRIBUTE, { ...current, [key]: value });
      if (value === code) {
        player.setAttribute(HUNT_ATTRIBUTE, { ...current, [key]: value, [`${kind}Open`]: true,
          ...(kind === "chest" ? { chapelPuzzleSolved: true } : {}) });
        if (kind === "chest") player.getPacketSender().sendVarbit(HUNT_DOOR_VARBITS.chapelPuzzleSolved, 1);
        if (kind === "shed" && !player.getInventory().contains(HUNT_ITEMS.boltCutters)) player.getInventory().adds(HUNT_ITEMS.boltCutters, 1);
        if (kind === "chest" && !player.getInventory().contains(HUNT_ITEMS.jovkaiKey)) player.getInventory().adds(HUNT_ITEMS.jovkaiKey, 1);
        player.sendMessage(kind === "shed" ? "The shed lock opens. You take a pair of bolt cutters." : "The altar chest opens. You take the Jovkai key.");
        return;
      }
      promptHuntCode(player, kind, offset);
    });
    if (offset + pageSize < options.length) {
      pairs.push("More digits...", () => promptHuntCode(player, kind, offset + pageSize));
    }
    if (offset > 0) {
      pairs.push("Back...", () => promptHuntCode(player, kind, 0));
    }
    api.sendMultiChatboxPrompt(player, `${kind === "shed" ? "Shed" : "Altar chest"} combination (${entered.length + 1} of ${code.length})`, ...pairs);
  }

  function handleBloodHuntObjects(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player)) return;
    const { x, y, z } = event.location ?? {};
    if (z !== 0) return;
    const ids = [event.objectId, event.definition?.id];
    const isTrapdoor = x === 2579 && y === 7830 && ids.includes(HUNT_TRAPDOOR_ID);
    const huntActive = [STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player));
    if (!huntActive) {
      if (isTrapdoor) {
        event.handled = true;
        player.sendMessage("The tunnel is sealed. The Blood Hunt is not underway.");
      }
      return;
    }
    const state = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    const inventory = player.getInventory();
    const has = (itemId) => inventory.contains(itemId);
    const locked = (message) => { event.handled = true; player.sendMessage(message); };
    if (x === 2612 && y === 7853 && !has(HUNT_ITEMS.viturKey)) return locked("The Vitur manor is locked. Find the key in the bookcase north-west of the crank.");
    if ((x === 2612 && y === 7852 || x === 2598 && y === 7843) && !has(HUNT_ITEMS.viturKey)) return locked("The door is locked. You need the Vitur key.");
    if (x === 2599 && y === 7826 && !has(HUNT_ITEMS.myrmelKey)) return locked("The pub door is locked. Join the two halves of the key to make a Myrmel key.");
    if (x === 2614 && y === 7814 && !has(HUNT_ITEMS.shadumKey)) return locked("The house is locked. The barrel in the Myrmel pub may hold a key.");
    if (x === 2580 && y === 7812 && !has(HUNT_ITEMS.jovkaiKey)) return locked("The smithy is locked. Search the altar chest for its key.");
    if (x === 2580 && y === 7835 && !has(HUNT_ITEMS.myrmelKey)) return locked("The bank door needs the Myrmel key.");
    if (x === 2582 && y === 7834) {
      const ids = [event.objectId, event.definition?.id];
      if (!ids.includes(ObjectIdentifiers.CRANK_BASE_2) ||
        (event.option !== undefined && String(event.option).toLowerCase() !== "operate")) return;
      event.handled = true;
      if (state.bankCrank) { player.sendMessage("The bank crank has already released the inner gate."); return; }
      if (!has(HUNT_ITEMS.trapdoorKey)) { player.sendMessage("The bank crank needs the trapdoor key from the Shadum house."); return; }
      let turns = Number(state.bankCrankTurns) || 0;
      if (!state.bankCrankStarted) {
        if (!has(HUNT_ITEMS.crank)) { player.sendMessage("The bank crank needs its wheel."); return; }
        turns = 0;
      }
      turns = Math.min(10, turns + 1);
      const complete = turns === 10;
      player.setAttribute(HUNT_ATTRIBUTE, { ...state, bankCrankStarted: true,
        bankCrankTurns: turns, bankCrank: complete,
        ...(complete ? { innerBankDoorUnlocked: true } : {}) });
      if (complete) inventory.deleteNumber(HUNT_ITEMS.crank, 1);
      player.getPacketSender().sendVarbit(HUNT_CRANK_PROGRESS_VARBIT, turns);
      player.getPacketSender().sendVarbit(HUNT_CRANK_PROGRESS_CACHED_VARBIT, turns);
      if (complete) {
        player.getPacketSender().sendVarbit(HUNT_DOOR_VARBITS.innerBankDoorUnlocked, 1);
        player.sendMessage("The crank wheel won't budge any further and you hear a click as the inner gate unlocks. Seeing no further use for the crank wheel, you discard it.");
      } else if (turns === 1) player.sendMessage("You insert the crank wheel and start turning it... Better keep cranking!");
      syncBloodHuntPursuer(player);
      return;
    }
    if (x === 2579 && y === 7830) {
      if (!isTrapdoor || String(event.option ?? "").toLowerCase() !== "climb-through") return;
      if (!state.bankCrank || !state.trapdoorUnlocked) return locked("The trapdoor is locked. Find its key and finish operating the bank crank.");
      player.setAttribute(HUNT_ATTRIBUTE, { ...state, enteredTrapdoor: true });
      event.handled = true;
      player.sendMessage("You climb through the long, dark tunnel.");
      player.moveTo(new Location(2581, 7844, 0));
      return;
    }
    if (x === 2588 && y === 7855) {
      const ids = [event.objectId, event.definition?.id];
      if (!ids.includes(ObjectIdentifiers.CRANK_BASE) ||
        (event.option !== undefined && String(event.option).toLowerCase() !== "operate")) return;
      event.handled = true;
      if (!inventory.contains(HUNT_ITEMS.crank)) { player.sendMessage("The crank base needs its wheel."); return; }
      const turns = Math.min(10, (Number(state.crankTurns) || 0) + 1);
      const unlocked = turns === 10;
      player.setAttribute(HUNT_ATTRIBUTE, { ...state, crankStarted: true, crankTurns: turns,
        ...(unlocked ? { fancyHouseDoorUnlocked: true } : {}) });
      player.getPacketSender().sendVarbit(HUNT_CRANK_PROGRESS_VARBIT, turns);
      player.getPacketSender().sendVarbit(HUNT_CRANK_PROGRESS_CACHED_VARBIT, turns);
      if (unlocked) {
        player.getPacketSender().sendVarbit(HUNT_DOOR_VARBITS.fancyHouseDoorUnlocked, 1);
        player.sendMessage("The crank wheel won't budge any further and you hear a click as something nearby unlocks.");
      } else if (turns === 1) {
        player.setAttribute(HUNT_ATTRIBUTE, { ...player.getAttribute(HUNT_ATTRIBUTE), pursuitStarted: true,
          pursuitSpawn: "crank" });
        player.getPacketSender().sendVarbit(15603, 1);
        player.sendMessage("You insert the crank wheel and start turning it... Better keep cranking! A presence stirs behind you.");
      }
      syncBloodHuntPursuer(player);
      return;
    }
    if (x === 2585 && y === 7861) {
      event.handled = true;
      if (Number(state.crankTurns) < 10) { player.sendMessage("You should finish operating the nearby crank first."); return; }
      if (inventory.contains(HUNT_ITEMS.viturKey)) {
        player.sendMessage("You have already found the key marked with the Vitur crest.");
        return;
      }
      if (!inventory.contains(HUNT_ITEMS.dustyBook)) inventory.adds(HUNT_ITEMS.dustyBook, 1);
      player.sendMessage("You search the bookcase and find a dusty book. Read it to discover the Vitur key.");
      return;
    }
    if (x === 2616 && y === 7855) {
      event.handled = true;
      if (!inventory.contains(HUNT_ITEMS.viturKey)) { player.sendMessage("The shed lock needs the Vitur key."); return; }
      if (!state.shedOpen) promptHuntCode(player, "shed");
      else if (!inventory.contains(HUNT_ITEMS.boltCutters)) inventory.adds(HUNT_ITEMS.boltCutters, 1);
      return;
    }
    if (x === 2591 && y === 7825) {
      if (!event.itemId && !event.usedItemId) return;
      const itemId = event.itemId ?? event.usedItemId;
      if (itemId !== HUNT_ITEMS.bucket) return;
      event.handled = true;
      if (!inventory.contains(HUNT_ITEMS.bucket)) return;
      inventory.deleteNumber(HUNT_ITEMS.bucket, 1);
      inventory.adds(HUNT_ITEMS.bucketWater, 1);
      player.sendMessage("You fill the bucket with water from the well.");
      return;
    }
    if (x === 2592 && y === 7833 && event.itemId === HUNT_ITEMS.bucketWater) {
      event.handled = true;
      if (!inventory.contains(HUNT_ITEMS.bucketWater)) return;
      inventory.deleteNumber(HUNT_ITEMS.bucketWater, 1);
      inventory.adds(HUNT_ITEMS.shadumKey, 1);
      player.sendMessage("The water washes away the grime on the barrel and reveals a Shadum key.");
      return;
    }
    if (x === 2576 && y === 7846) {
      event.handled = true;
      if (!state.enteredTrapdoor || !state.trapdoorUnlocked || !state.bankCrank) { player.sendMessage("The chest is below the bank. Operate the crank and enter through the unlocked trapdoor first."); return; }
      if (!state.chestOpen) promptHuntCode(player, "chest");
      else if (!inventory.contains(HUNT_ITEMS.jovkaiKey)) inventory.adds(HUNT_ITEMS.jovkaiKey, 1);
      return;
    }
  }

  function routeBloodHuntObjects(event) {
    const player = event?.player;
    if (!player || ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player))) return;
    const location = event.object?.getLocation?.() ?? event.object?.location ?? {};
    const x = location.getX?.() ?? location.x;
    const y = location.getY?.() ?? location.y;
    const z = location.getZ?.() ?? location.z;
    if (z !== 0) return;
    const source = event.sourceLocation ?? player.getLocation?.();
    const sourceX = source?.getX?.() ?? source?.x;
    const sourceY = source?.getY?.() ?? source?.y;
    const ids = [event.objectId, event.definition?.id];
    const hunt = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
    if (ids.includes(HUNT_TRAPDOOR_ID) && x === 2579 && y === 7830 &&
      hunt.trapdoorUnlocked && hunt.bankCrank &&
      Number.isFinite(sourceX) && Number.isFinite(sourceY) &&
      Math.max(Math.abs(sourceX - x), Math.abs(sourceY - y)) <= 1) {
      // The tunnel destination is blocked; resolve the gated climb from an adjacent tile.
      event.destination = { x: sourceX, y: sourceY, z: 0 };
      return;
    }
    if (ids.includes(ObjectIdentifiers.DOOR_839) && x === 2587 && y === 7857 &&
      sourceY < y && Number(hunt.crankTurns) >= 10 && hunt.pursuitStarted) {
      player.setAttribute(HUNT_ATTRIBUTE, { ...hunt, pursuitStarted: false, pursuitSpawn: null });
      player.getPacketSender?.().sendVarbit(15603, 0);
      cleanupBloodHuntPursuer(player);
      return;
    }
    if (ids.includes(ObjectIdentifiers.JOVKAI_DOOR) && x === 2580 && [7811, 7812].includes(y) &&
      Number.isFinite(sourceX) && Number.isFinite(sourceY) &&
      Math.max(Math.abs(sourceX - x), Math.abs(sourceY - y)) <= 1 &&
      hasItem(player, HUNT_ITEMS.oldCog)) {
      player.setAttribute(HUNT_ATTRIBUTE, { ...hunt, pursuitStarted: true, pursuitSpawn: "blacksmith" });
      player.getPacketSender?.().sendVarbit(15603, 1);
      syncBloodHuntPursuer(player);
      return;
    }
    if (event.objectId === 61818 && x === 2585 && y === 7861) {
      event.destination = { x: 2584, y: 7862, z: 0 };
    }
  }

  function handleBloodHuntItemOnObject(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player))) return;
    const { x, y, z } = event.location ?? {};
    if (z !== 0) return;
    const itemId = event.itemId;
    const inventory = player.getInventory();
    if (x === HUNT_DRAWBRIDGE_MECHANISM_TILE.x && y === HUNT_DRAWBRIDGE_MECHANISM_TILE.y &&
      [event.objectId, event.definition?.id].includes(HUNT_DRAWBRIDGE_MECHANISM_ID) &&
      itemId === HUNT_ITEMS.oldCog) {
      event.handled = true;
      const state = player.getAttribute(HUNT_ATTRIBUTE) ?? {};
      if (state.drawbridgeRepaired) {
        player.sendMessage("The drawbridge mechanism is already repaired.");
        return;
      }
      if (!inventory.contains(HUNT_ITEMS.oldCog)) return;
      inventory.deleteNumber(HUNT_ITEMS.oldCog, 1);
      player.setAttribute(HUNT_ATTRIBUTE, { ...state, drawbridgeRepaired: true, cogHandedIn: true });
      player.getPacketSender().sendVarbit(HUNT_FOUND_COG_VARBIT, 1);
      startTranscript(api, player, NpcIdentifiers.VANESCULA_DRAKAN_10, PAGE,
        "blood-hunt-crossing-the-bridge");
      return;
    }
    if (x === 2591 && y === 7825 && itemId === HUNT_ITEMS.bucket) {
      handleBloodHuntObjects({ ...event, player, itemId });
    } else if (x === 2592 && y === 7833 && itemId === HUNT_ITEMS.bucketWater) {
      handleBloodHuntObjects({ ...event, player, itemId });
    }
  }

  function handleBloodHuntItemOnItem(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player))) return;
    const pair = new Set([event.usedItemId, event.usedWithItemId]);
    const inventory = player.getInventory();
    if (pair.has(HUNT_ITEMS.toothHalf) && pair.has(HUNT_ITEMS.loopHalf)) {
      event.handled = true;
      if (!inventory.contains(HUNT_ITEMS.toothHalf) || !inventory.contains(HUNT_ITEMS.loopHalf)) return;
      inventory.deleteNumber(HUNT_ITEMS.toothHalf, 1);
      inventory.deleteNumber(HUNT_ITEMS.loopHalf, 1);
      inventory.adds(HUNT_ITEMS.myrmelKey, 1);
      player.sendMessage("The two halves fit together to make a Myrmel key.");
    }
  }

  function readDustyBook(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || ![STAGE.ESCAPE, STAGE.BLOOD_HUNT].includes(stage(player)) ||
      event.itemId !== HUNT_ITEMS.dustyBook) return;
    event.handled = true;
    if (!player.getInventory().contains(HUNT_ITEMS.dustyBook)) return;
    player.getInventory().deleteNumber(HUNT_ITEMS.dustyBook, 1);
    if (!player.getInventory().contains(HUNT_ITEMS.viturKey)) {
      player.getInventory().adds(HUNT_ITEMS.viturKey, 1);
    } else {
      player.sendMessage("You already have the key marked with the Vitur crest.");
      return;
    }
    player.setAttribute(HUNT_ATTRIBUTE, { ...(player.getAttribute(HUNT_ATTRIBUTE) ?? {}), readBook: true });
    player.sendMessage("A key falls from the dusty book. It is marked with the Vitur crest.");
  }

  function readCastleLabNotes(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      event.itemId !== CASTLE_LAB_NOTES || !hasItem(player, CASTLE_LAB_NOTES)) return;
    event.handled = true;
    const packet = player.getPacketSender();
    const lines = [
      "", "", "", "New development: Appears pretty much all substances",
      "have some level of haemalchemic potential. Will refer to",
      "this as HP. Value is negligible for most substances, but",
      "small number of magical materials offer potential.",
      "Further tests needed. Will prepare suitable devices.", "", "", "", "",
    ];
    packet.sendInterface(291);
    lines.forEach((line, index) => packet.sendString(line, (291 << 16) | (5 + index)));
  }

  function handleAncientShieldAssembly(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const pair = new Set([event.usedItemId, event.usedWithItemId]);
    if (!pair.has(ItemIdentifiers.ANCIENT_SYMBOL) || !pair.has(ItemIdentifiers.ANCIENT_SHIELD)) return;
    event.handled = true;
    const inventory = player.getInventory();
    if (!inventory.contains(ItemIdentifiers.ANCIENT_SYMBOL) || !inventory.contains(ItemIdentifiers.ANCIENT_SHIELD)) return;
    inventory.deleteNumber(ItemIdentifiers.ANCIENT_SYMBOL, 1);
    inventory.deleteNumber(ItemIdentifiers.ANCIENT_SHIELD, 1);
    if (!inventory.adds(ItemIdentifiers.SHIELD_WITH_SYMBOL, 1)) {
      inventory.adds(ItemIdentifiers.ANCIENT_SYMBOL, 1);
      inventory.adds(ItemIdentifiers.ANCIENT_SHIELD, 1);
      player.sendMessage("Make room for the shield with symbol.");
      return;
    }
    player.setAttribute(SOLID_KEY_ATTRIBUTE, { ...(player.getAttribute(SOLID_KEY_ATTRIBUTE) ?? {}), assembled: true });
    player.sendMessage("You fit the ancient symbol onto the shield.");
  }

  function handleMountShield(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      event.itemId !== ItemIdentifiers.SHIELD_WITH_SYMBOL) return;
    const { x, y, z } = event.location ?? {};
    if (x !== 2543 || y !== 7361 || z !== 0) return;
    event.handled = true;
    const state = player.getAttribute(SOLID_KEY_ATTRIBUTE) ?? { shield: false, mounted: false, key: false };
    if (state.mounted) {
      player.sendMessage("The shield is already mounted.");
      return;
    }
    if (!state.assembled || !player.getInventory().contains(ItemIdentifiers.SHIELD_WITH_SYMBOL)) {
      player.sendMessage("The shield is missing its ancient symbol.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.SHIELD_WITH_SYMBOL, 1);
    player.setAttribute(SOLID_KEY_ATTRIBUTE, { ...state, mounted: true });
    player.getPacketSender().sendVarbit(CASTLE_SHIELD_MOUNT_VARBIT, 1);
    player.sendMessage("You place the shield on the mount and a hidden compartment beneath it opens.");
  }

  function syncSolidKeyMountOnLogin({ player } = {}) {
    if (!player) return;
    const state = player.getAttribute(SOLID_KEY_ATTRIBUTE) ?? {};
    player.getPacketSender()?.sendVarbit?.(CASTLE_SHIELD_MOUNT_VARBIT, state.mounted ? 1 : 0);
  }

  function handleRefiner(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE) return;
    const { x, y, z } = event.location ?? {};
    const name = String(event.definition?.getName?.() ?? "").toLowerCase();
    if (name === "shelves" && x === 2513 && y === 7387 && z === 0) {
      event.handled = true;
      if (String(event.option ?? "").toLowerCase() !== "search") return;
      api.sendMultiChatboxPrompt(player, "There are various items on the shelves.",
        "Take a vial of water.", () => takeCastleLabSupply(player, ItemIdentifiers.VIAL_OF_WATER_6, 2,
          "You take a vial of water from the shelves."),
        "Take a vial of blood.", () => takeCastleLabSupply(player, ItemIdentifiers.VIAL_OF_BLOOD_5, 3,
          "You take a vial of blood from the shelves."),
        "Take a piece of pure essence.", () => takeCastleLabSupply(player, ItemIdentifiers.PURE_ESSENCE_4, 3,
          "You take a piece of pure essence from the shelves."),
        "Take a chunk of daeyalt ore.", () => takeCastleLabSupply(player, ItemIdentifiers.DAEYALT_ORE_3, 1,
          "You take a chunk of daeyalt ore from the shelves."),
        "Take nothing.", () => {});
      return;
    }
    if (name !== "blood stockpile" || x !== 2535 || y !== 7385 || z !== 0) return;
    event.handled = true;
    const state = player.getAttribute(REFINER_ATTRIBUTE) ?? { mixtures: [], made: [], used: 0, total: 0, destroyed: false };
    if (state.used !== 4 || state.total !== 53) {
      player.sendMessage("The stockpile is protected by the refiner. Make mixtures totalling 53 haemalchemic potential and use all four on the basin.");
      return;
    }
    player.setAttribute(REFINER_ATTRIBUTE, { ...state, destroyed: true });
    const story = castleStory(player);
    player.setAttribute(CASTLE_STORY_ATTRIBUTE, { ...story, stockpileDestroyed: true });
    player.sendMessage("You destroy the blood stockpile. The refiner's north door is now clear.");
    startTranscript(api, player, 0, PAGE, "escape-from-castle-drakan-destroying-the-blood-stockpile");
  }

  function takeCastleLabSupply(player, itemId, maximum, message) {
    const inventory = player.getInventory();
    const amount = inventory.getAmount?.(itemId) ?? (inventory.contains(itemId) ? 1 : 0);
    if (amount >= maximum) {
      player.sendMessage("You already have all you need from these shelves.");
      return;
    }
    if (!inventory.adds(itemId, 1)) {
      player.sendMessage("Make room in your inventory before taking anything from the shelves.");
      return;
    }
    player.sendMessage(message);
  }

  function handleRefinerMixture(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE || event.objectId !== 61709) return;
    const { x, y, z } = event.location ?? {};
    if (x !== 2520 || y !== 7385 || z !== 0) return;
    const inventory = player.getInventory();
    const state = player.getAttribute(REFINER_ATTRIBUTE) ?? { mixtures: [], used: 0, total: 0, destroyed: false };
    const made = state.made ?? state.mixtures;
    const candidates = [
      { items: [ItemIdentifiers.VIAL_OF_BLOOD_5, ItemIdentifiers.PURE_ESSENCE_4], value: 17, max: 2 },
      { items: [ItemIdentifiers.VIAL_OF_BLOOD_5, ItemIdentifiers.VIAL_OF_WATER_6], value: 13, max: 1 },
      { items: [ItemIdentifiers.PURE_ESSENCE_4, ItemIdentifiers.VIAL_OF_WATER_6], value: 6, max: 1 },
    ];
    const recipe = candidates.find(({ items, value, max }) => items.includes(event.itemId) &&
      items.every((id) => inventory.contains(id)) && made.filter((entry) => entry === value).length < max);
    if (!recipe) return;
    event.handled = true;
    for (const id of recipe.items) inventory.deleteNumber(id, 1);
    if (!inventory.adds(ItemIdentifiers.CHEMICAL_VIAL, 1)) {
      for (const id of recipe.items) inventory.adds(id, 1);
      player.sendMessage("Make room in your inventory for the chemical vial.");
      return;
    }
    const mixtures = [...state.mixtures, recipe.value];
    player.setAttribute(REFINER_ATTRIBUTE, { ...state, mixtures, made: [...made, recipe.value] });
    player.sendMessage(`The refiner fills a chemical vial with ${recipe.value} haemalchemic potential.`);
  }

  function handleRefinerVial(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) !== STAGE.CASTLE ||
      event.itemId !== ItemIdentifiers.CHEMICAL_VIAL || event.objectId !== 61707) return;
    const { x, y, z } = event.location ?? {};
    if (x !== 2518 || y !== 7389 || z !== 0) return;
    event.handled = true;
    const state = player.getAttribute(REFINER_ATTRIBUTE) ?? { mixtures: [], used: 0, total: 0, destroyed: false };
    if (!state.mixtures.length || !player.getInventory().contains(ItemIdentifiers.CHEMICAL_VIAL)) {
      player.sendMessage("The refiner's basin is waiting for a prepared chemical vial.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.CHEMICAL_VIAL, 1);
    const [value, ...mixtures] = state.mixtures;
    const total = state.total + value;
    player.setAttribute(REFINER_ATTRIBUTE, { ...state, mixtures, used: state.used + 1, total });
    player.sendMessage(`The basin absorbs the vial. Haemalchemic potential: ${total} HP.`);
  }

  function handlePrepObject(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) < STAGE.PREPARATIONS || stage(player) >= STAGE.SIEGE) return;
    const name = String(event.definition?.getName?.() ?? "").toLowerCase();
    const option = String(event.option ?? "").toLowerCase();
    const inventory = player.getInventory();
    let variant = null;
    let changed = false;
    if (name === "amitire plant" && prepObjectAt(event, 2982, 7679, 0) && !hasItem(player, PREP.leaves)) {
      changed = inventory.adds(PREP.leaves, 1);
      variant = "hallowed-preparations-picking-the-amitire-plant";
    } else if (name === "shelves" && prepObjectAt(event, 3159, 7824, 1) && !hasItem(player, PREP.bowl)) {
      changed = inventory.adds(PREP.bowl, 1);
      variant = "hallowed-preparations-searching-the-shelves";
    } else if (name === "cupboard" && prepObjectAt(event, 3155, 7832, 1)) {
      event.handled = true;
      api.sendMultiChatboxPrompt(player, "What would you like to take?",
        "Potato.", () => takePrepItem(player, PREP.potato, "You take a potato from the cupboard."),
        "Raw meat.", () => takePrepItem(player, PREP.rawMeat, "You take some raw meat from the cupboard."),
        "Nothing.", () => {});
      return;
    } else if (name === "workbench" && prepObjectAt(event, 3176, 7841, 1)) {
      event.handled = true;
      api.sendMultiChatboxPrompt(player, "What would you like to take?",
        "Hammer.", () => takePrepItem(player, PREP.hammer, "You take a hammer from the workbench."),
        "Chisel.", () => takePrepItem(player, PREP.chisel, "You take a chisel from the workbench."),
        "Knife.", () => takePrepItem(player, PREP.knife, "You take a knife from the workbench."),
        "Nothing.", () => {});
      return;
    } else if ((name.includes("crate") || name.includes("blisterwood")) && prepObjectAt(event, 3177, 7843, 1) && !hasItem(player, PREP.logs)) {
      changed = inventory.adds(PREP.logs, 1);
      variant = "hallowed-preparations-searching-the-blisterwood-crate";
    } else if ((name.includes("crate") || name.includes("sickle")) && prepObjectAt(event, 3181, 7841, 1) && !hasItem(player, PREP.blessedSickle)) {
      changed = inventory.adds(PREP.blessedSickle, 1);
      variant = "hallowed-preparations-searching-the-sickle-crate";
    } else if (name === "chest" && !hasItem(player, PREP.diamond) && hasItem(player, PREP.blessedSickle) &&
      prepObjectAt(event, 3181, 7835, 1)) {
      changed = inventory.adds(PREP.diamond, 1);
      variant = "hallowed-preparations-searching-the-workshop-s-eastern-chest";
    } else if (name === "chest" && !hasItem(player, PREP.diamondTablet) && hasItem(player, PREP.diamondSickle) &&
      prepObjectAt(event, 3175, 7836, 1)) {
      changed = inventory.adds(PREP.diamondTablet, 1);
      variant = "hallowed-preparations-searching-the-workshop-s-western-chest";
    } else if (name.includes("range") && prepObjectAt(event, 3160, 7826, 1) && inventory.contains(PREP.rawMeat)) {
      changed = replaceItems(player, [PREP.rawMeat], [PREP.rawMeat], [[PREP.cookedMeat, 1]]);
    } else if (name.includes("range") && prepObjectAt(event, 3160, 7826, 1) && inventory.contains(PREP.uncookedStew)) {
      changed = replaceItems(player, [PREP.uncookedStew], [PREP.uncookedStew], [[PREP.cookedStew, 1]]);
    } else if (name === "anvil" && prepObjectAt(event, 3179, 7842, 1) && inventory.contains(PREP.enhancedSickle) && inventory.contains(PREP.marks) &&
      inventory.contains(PREP.blisterwoodFlail) && inventory.contains(PREP.hammer) &&
      player.getSkillManager().getMaxLevel(Skill.SMITHING) >= 72) {
      event.handled = true;
      api.sendMultiChatboxPrompt(player, "Upgrade your flail?", "Yes.", () => {
        if (stage(player) !== STAGE.PREPARATIONS || player.getSkillManager().getMaxLevel(Skill.SMITHING) < 72) return;
        if (replaceItems(player, [PREP.enhancedSickle, PREP.marks, PREP.blisterwoodFlail, PREP.hammer],
          [PREP.enhancedSickle, PREP.marks, PREP.blisterwoodFlail], [[PREP.flail, 1]])) {
          player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), flail: true });
          quest.setStage(player, STAGE.PREPARATIONS);
          player.sendMessage("You upgrade your flail by swapping out the sickle and shortening the shaft before enhancing it with pure silvthrill.");
        }
      }, "No.", () => {});
      return;
    }
    if (!changed) return;
    event.handled = true;
    if (variant) prepAction(player, variant);
    else player.sendMessage(`You ${option === "search" ? "search" : "use"} the ${name}.`);
  }

  function handlePrepItemOnObject(event) {
    const player = event?.player;
    if (!player || stage(player) !== STAGE.PREPARATIONS) return;
    let result;
    if (event.objectId === ObjectIdentifiers.SINK_40 && prepObjectAt(event, 3156, 7824, 1) && event.itemId === PREP.bowl) result = PREP.bowlWater;
    if (event.objectId === ObjectIdentifiers.RANGE_24 && prepObjectAt(event, 3160, 7826, 1)) {
      if (event.itemId === PREP.rawMeat) result = PREP.cookedMeat;
      if (event.itemId === PREP.uncookedStew) result = PREP.cookedStew;
    }
    if (!result || !replaceItems(player, [event.itemId], [event.itemId], [[result, 1]])) return;
    event.handled = true;
    player.sendMessage(result === PREP.bowlWater ? 'You fill the bowl with water.' : 'You cook the ingredient for Safalaan’s stew.');
  }

  function handlePrepItemOnItem(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || stage(player) < STAGE.PREPARATIONS) return;
    const pair = new Set([event.usedItemId, event.usedWithItemId]);
    const stakesRecipe = pair.has(PREP.logs) && pair.has(PREP.knife);
    const currentStage = stage(player);
    const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
    // Stakes are consumed during the later Wyrd encounter. Once the player has
    // completed the original recipe, allow them to make replacement batches
    // from real logs and a knife without reopening the preparation chapter.
    if (currentStage !== STAGE.PREPARATIONS && !(stakesRecipe && prep.stakes)) return;
    if (currentStage >= STAGE.SIEGE && !stakesRecipe) return;
    const inventory = player.getInventory();
    let recipe = null;
    if (pair.has(PREP.bowlWater) && pair.has(PREP.potato)) {
      recipe = [[PREP.bowlWater, PREP.potato], [PREP.bowlWater, PREP.potato], [[PREP.incompleteStew, 1]]];
    } else if (pair.has(PREP.incompleteStew) && pair.has(PREP.cookedMeat)) {
      recipe = [[PREP.incompleteStew, PREP.cookedMeat], [PREP.incompleteStew, PREP.cookedMeat], [[PREP.uncookedStew, 1]]];
    } else if (pair.has(PREP.cookedStew) && pair.has(PREP.leaves)) {
      recipe = [[PREP.cookedStew, PREP.leaves], [PREP.cookedStew, PREP.leaves], [[PREP.stew, 1]]];
    } else if (pair.has(PREP.blessedSickle) && pair.has(PREP.diamond)) {
      recipe = [[PREP.blessedSickle, PREP.diamond], [PREP.blessedSickle, PREP.diamond], [[PREP.diamondSickle, 1]]];
    } else if (pair.has(PREP.diamondSickle) && pair.has(PREP.diamondTablet)) {
      recipe = [[PREP.diamondSickle, PREP.diamondTablet], [PREP.diamondSickle, PREP.diamondTablet], [[PREP.enchantedSickle, 1]]];
    } else if (pair.has(PREP.enchantedSickle) && pair.has(PREP.logs)) {
      recipe = [[PREP.enchantedSickle, PREP.logs], [PREP.enchantedSickle, PREP.logs], [[PREP.enhancedSickle, 1]]];
    } else if (pair.has(PREP.logs) && pair.has(PREP.knife)) {
      recipe = [[PREP.logs, PREP.knife], [PREP.logs], [[PREP.stakes, 5]]];
    }
    if (!recipe) return;
    event.handled = true;
    if (pair.has(PREP.blessedSickle) || pair.has(PREP.enchantedSickle)) {
      const diamond = pair.has(PREP.blessedSickle);
      api.sendMultiChatboxPrompt(player, diamond ? "Craft a diamond sickle?" : "Craft an enhanced blisterwood sickle?",
        "Yes.", () => craftPrepRecipe(player, recipe, pair), "No.", () => {});
    } else craftPrepRecipe(player, recipe, pair);
  }

  function takePrepItem(player, id, message) {
    if (stage(player) !== STAGE.PREPARATIONS || hasItem(player, id)) return;
    if (player.getInventory().adds(id, 1)) player.sendMessage(message);
  }

  function craftPrepRecipe(player, recipe, pair) {
    const currentStage = stage(player);
    const stakesRecipe = pair.has(PREP.logs) && pair.has(PREP.knife);
    const prep = player.getAttribute(PREP_ATTRIBUTE) ?? {};
    if (currentStage !== STAGE.PREPARATIONS && !(stakesRecipe && prep.stakes)) return;
    if (!replaceItems(player, ...recipe)) return;
    if (stakesRecipe) {
      player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), stakes: true });
      publishHelperVarbits(player);
      player.sendMessage("You cut the blisterwood logs into five stakes.");
    } else if (pair.has(PREP.blessedSickle)) {
      player.sendMessage("You embed the diamond into the sickle.");
    } else if (pair.has(PREP.diamondSickle)) {
      player.sendMessage("You enchant the diamond sickle.");
    } else if (pair.has(PREP.enchantedSickle)) {
      player.sendMessage("You enhance the diamond sickle with blisterwood, making an enhanced blisterwood sickle.");
      player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), sickle: true });
    } else if (pair.has(PREP.cookedStew)) {
      prepAction(player, "hallowed-preparations-making-the-amitire-stew");
    } else player.sendMessage("You combine the ingredients.");
    if (currentStage === STAGE.PREPARATIONS) quest.setStage(player, STAGE.PREPARATIONS);
  }

  function feedSafalaan(event) {
    const player = event?.player;
    const targetName = String(event?.target?.getDefinition?.()?.getName?.() ?? event?.target?.getName?.() ?? "").toLowerCase();
    if (!player || !targetName.includes("safalaan") || event.itemId !== PREP.stew || stage(player) < STAGE.PREPARATIONS || stage(player) >= STAGE.SIEGE) return;
    event.handled = true;
    if (!player.getInventory().contains(PREP.stew)) return;
    player.getInventory().deleteNumber(PREP.stew, 1);
    player.getInventory().adds(PREP.marks, 1);
    player.setAttribute(PREP_ATTRIBUTE, { ...(player.getAttribute(PREP_ATTRIBUTE) ?? {}), stewFed: true });
    quest.setStage(player, STAGE.PREPARATIONS);
    prepAction(player, "hallowed-preparations-feeding-safalaan-the-stew", event.npcId);
  }

  const ACTION_STAGE = {
    "gzCVlH": STAGE.SLEPE,
    "fiqzZ7": STAGE.RETURNED,
    "XqVfhB": STAGE.ESCAPE,
    "D5qF0g": STAGE.BLOOD_HUNT,
    "sw9z49": STAGE.BLOOD_HUNT,
    "lKvIyH": STAGE.BLOOD_HUNT,
    "Sut83Q": STAGE.SIEGE,
    "vqg4qO": STAGE.SIEGE,
    "1JPVz5": STAGE.THEATRE,
    "4G5OZg": STAGE.WYRDS,
  };

  quest = registerQuest(api, {
    key: "the_blood_moon_rises",
    name: PAGE,
    varpId: 5618,
    varbitId: 15464,
    // shortcut: other chapter native stages need their cache morphs validated before mapping.
    varpValue: nativeStage,
    varbitValue: nativeStage,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 4,
    rewardItemId: TOME_ID,
    rewardItemLabel: "A Tome of Experience",
    otherRewards: ["The Sunspear", "Access to Vampyrium"],
    buildJournal,
  });
  api.persistAttribute(START_DIALOGUE_COMPLETE, false);
  api.persistAttribute(HIDEOUT_CUTSCENE_STARTED, false);
  api.persistAttribute(HIDEOUT_SHRINE_INSPECTED);
  api.persistAttribute(SLEPE_STORY_ATTRIBUTE);
  api.persistAttribute(SLEPE_NATIVE_STAGE_ATTRIBUTE, 16);
  api.persistAttribute(CASTLE_SHRINE_ATTRIBUTE);
  api.persistAttribute(CASTLE_UNLOCKED_PASSAGES_ATTRIBUTE);
  const hall = require("../bmr/Hall.TheBloodMoonRises")({ api, state: hallDefenceState,
    process: processSiegeDefence, cleanup: handleSiegeLogout, scenery: player => {
      const damaged = hallDefenceState(player).damaged ?? {};
      // P3 4336-4348: the four crates, barricade and windows at their exact
      // captured tiles, shapes and rotations.
      return [[SIEGE_HALL.hammerCrate, 3173, 7847, 10, 1],
        [SIEGE_HALL.hammerCrate, 3162, 7849, 10, 0],
        [SIEGE_HALL.potionCrate, 3174, 7848, 11, 0],
        [SIEGE_HALL.potionCrate, 3163, 7847, 11, 3],
        [SIEGE_HALL.barricade, 3167, 7844, 10, 2],
        ...[...SIEGE_HALL.repairLocations].map(([key, ids]) => {
          const [x, y] = key.split(',').map(Number);
          return [ids[damaged[key] ? 0 : 1], x, y,
            ids[0] === SIEGE_HALL.damagedWindow ? 0 : 10,
            ids[0] === SIEGE_HALL.damagedWindow ? 3 : 0];
        })];
    } });
  const palace = require("../bmr/Palace.TheBloodMoonRises")({ api, stage,
    preparationAttribute: PREP_ATTRIBUTE, processHall: ({ player }) => hall.enter(player) });
  function syncPalaceActorsOnLogin({ player }) {
    if (player) palace.sync(player);
  }
  function syncPalaceActorsAfterBootstrap({ player }) {
    if (player) palace.sync(player);
  }
  function syncTheatreActorsOnStageChange({ player }) {
    if (player) syncTheatreActors(player);
  }
  function syncTheatreActorsAfterBootstrap({ player }) {
    if (player) syncTheatreActors(player);
  }
  function cleanupPalaceActors({ player }) {
    if (player) palace.cleanup(player);
  }
  const bridge = require("../bmr/Bridge.TheBloodMoonRises")({ api, stage, attribute: SIEGE_DEFENCE_ATTRIBUTE,
    sync: player => quest.setStage(player, STAGE.SIEGE),
    ready: preparationReady,
    play: (player, npc, variant) => startTranscript(api, player, npc, PAGE, variant) });
  api.persistAttribute(ATTRIBUTE);
  api.persistAttribute(THEATRE_NATIVE_STAGE_ATTRIBUTE);
  api.onCustomEvent("npc-dialogue:hook", onStartHook);
  api.onCustomEvent("potions:area", handleVampyriumPotionArea);
  api.onCustomEvent("food:area", handleVampyriumPotionArea);
  api.onWalkRoute(handleFinalDrakanDodgeRoute);
  api.onCustomEvent("npc-dialogue:action", onTranscriptAction);
  api.onCustomEvent("quest:stage-changed", syncHideoutIvan);
  api.onCustomEvent("quest:stage-changed", syncSlepeIvan);
  api.onCustomEvent("quest:stage-changed", syncSlepeRoy);
  api.onCustomEvent("quest:stage-changed", cleanupSlepeStory);
  api.onCustomEvent("quest:stage-changed", syncTheatreActorsOnStageChange);
  api.onCustomEvent("quest:stage-changed", publishHelperVarbitsOnStageChange);
  api.onCustomEvent("quest:stage-changed", syncBloodHuntPartyOnStageChange);
  api.onCustomEvent("ladders:climb", handleCastleLobbyStairs);
  api.onCustomEvent("player:bootstrap-complete", syncPalaceActorsAfterBootstrap);
  api.onCustomEvent("player:bootstrap-complete", syncTheatreActorsAfterBootstrap);
  api.onObjectInteraction(prayAtCastleShrine);
  api.onObjectInteraction(enterVampyriumPortal);
  api.onObjectInteraction(tryCastleReturnPortal);
  api.onObjectInteraction(handleFinalPortal);
  api.onObjectInteraction(handleFinalCastleReturnPortal);
  api.onObjectInteraction(handleFinalDrakanSupplyChest);
  api.onObjectInteraction(handleFinalDrakanRoofDoor);
  api.onCustomEvent("drakan-medallion:destinations", addCastleMedallionDestination);
  api.onCustomEvent("world:object-examine", inspectHideoutShrine);
  // The shipped loc 61177 exposes Inspect (not Examine): use the named object hook.
  api.onObjectInteraction("Makeshift shrine", { Inspect: inspectHideoutShrine });
  api.onNpcDialogueCondition(handleSlepeJournalCondition);
  api.onNpcDialogueCondition(answerHideoutCondition);
  api.onNpcDialogueCondition(answerPreparationStakesCondition);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onCustomEvent("npc-dialogue:line", onBloodMoonDialogueLine);
  api.onCustomEvent("npc-dialogue:line", onSlepeDialogueLine);
  api.onCustomEvent("tob:bmr-completed", onBloodMoonTobCompleted);
  api.onCustomEvent(REFINERY_COMPLETED_EVENT, onRefineryCompleted);
  api.onNpcDialogueVariant(selectVariant);
  api.onAnyNpcInteraction({ "Talk-to": talkQuestNpc });
  // Claim Ivan after Sins of the Father and In Aid of the Myreque decline him,
  // before their generic completed-quest transcript can answer for this stage.
  api.onNpcInteraction("Ivan Strom", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Sarei", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Sugadinti Vitur", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Roy", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Safalaan Hallow", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Vanescula Drakan", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Drezel", { "Talk-to": talkQuestNpc });
  api.onNpcInteraction("Efaritay Hallow", { "Talk-to": talkQuestNpc });
  api.onObjectInteraction(handlePaterdomusObject);
  api.onObjectRoute(routePaterdomusWindows);
  api.onItemOnObject(handlePaterdomusItemOnObject, { noted: false });
  api.onObjectInteraction(openHideoutChest);
  api.onObjectInteraction(handleSiegeHallObject);
  api.onObjectRoute(routeSiegeHallWindowRepair);
  api.onObjectInteraction(inspectWyrdFence);
  api.onObjectInteraction(handleCastleThronePuzzle);
  api.onObjectInteraction(handleCastleCellDoor);
  api.onObjectInteraction(handleCastleOuterLibraryLever);
  api.onObjectInteraction("Lever", { Pull: handleCastleOuterLibraryLever });
  api.onObjectInteraction(handleCastleOuterLibraryPortal);
  api.onObjectInteraction("Teleporter", { Enter: handleCastleOuterLibraryPortal });
  api.onObjectInteraction(handleCastleDoorEnter);
  api.onObjectInteraction("Door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Half moon door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Crescent moon door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("New moon door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Gibbous moon door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Full moon door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Stairs", { "Climb-up": handleCastleDoorEnter, "Climb-down": handleCastleDoorEnter });
  api.onObjectInteraction("Spiral staircase", { "Climb-up": handleCastleDoorEnter, "Climb-down": handleCastleDoorEnter });
  api.onObjectInteraction("Gilded door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Solid door", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction("Teleporter", { Enter: handleCastleDoorEnter });
  api.onObjectInteraction(handleCastleBookObjects);
  api.onObjectInteraction(handleCastleSecretRoomObjects);
  api.onObjectInteraction(handleCastleGibbousObjects);
  api.onObjectInteraction(searchGibbousDisplayCase);
  api.onObjectInteraction(handleCastleKeyObjects);
  api.onItemOnObject(handleCastleBookOnObject, { noted: false });
  api.onItemOnObject(handleCastleGibbousItemOnObject, { noted: false });
  api.onItemOnObject(handleCastleDisplayCaseItem, { noted: false });
  api.onItemOnObject(handleCastleKeyItemOnObject, { noted: false });
  api.onItemOnObject(handleVanesculaEmblemReceptacle, { noted: false });
  api.onItemOnObject(handleRanisEmblemReceptacle, { noted: false });
  api.onItemOnObject(handleRanisParlourEmblemReceptacle, { noted: false });
  api.onObjectInteraction(handleCastleEmblemReceptaclePlacement);
  api.onObjectInteraction(handleCastleEmblemReceptacleRemoval);
  api.onObjectInteraction(handleCastleThirdEmblemReceptacle);
  api.onObjectInteraction(handleCastleVanesculaWall);
  api.onItemOnObject(handleCastleVanesculaWallItem, { noted: false });
  api.onObjectInteraction(inspectRanisCrackedWall);
  api.onItemOnItem(handleCastleKeyItemOnItem);
  api.onItemOnItem(handleCastleChunkyPotionCombine, { noted: false });
  api.onCustomEvent("player:widget-action", handleCastleBookWidgetAction);
  api.onGroundItemPickup(handleCastleBookPickup);
  api.onItemAction(handleCastleGibbousItemAction);
  api.onGroundItemPickup(handleCastleKeyPickup);
  api.onGroundItemPickup(handleCastleExplosiveBarrelPickup);
  api.onObjectRoute(routeCastleDoorEnter);
  api.onObjectInteraction(handleCastleBasinPuzzle);
  api.onObjectInteraction(handleBasinAltar);
  api.onObjectInteraction(handleCastleChapelLever);
  api.onObjectInteraction(handleSolidKeyObjects);
  api.onObjectInteraction(handleCastleClocks);
  api.onObjectInteraction(handleGalleryChest);
  bloodHuntPursuitArea = new BloodHuntPursuitArea();
  api.registerArea(bloodHuntPursuitArea);
  api.onObjectInteraction(handleBloodHuntObjects);
  api.onObjectRoute(routeBloodHuntObjects);
  api.onItemOnObject(handlePrepItemOnObject, { noted: false });
  api.onItemOnObject(handleBasinPotion, { noted: false });
  api.onItemOnObject(handleMountShield, { noted: false });
  api.onItemOnObject(handleClockHandOnClock, { noted: false });
  api.onItemOnObject(handleRefinerVial, { noted: false });
  api.onObjectInteraction(handlePrepObject);
  api.onObjectInteraction(handleRefiner);
  api.onItemOnObject(handleRefinerMixture, { noted: false });
  api.onItemOnObject(handleBloodHuntItemOnObject, { noted: false });
  api.onItemOnItem(handleAncientShieldAssembly);
  api.onItemOnItem(handlePrepItemOnItem);
  api.onItemOnItem(handleBloodHuntItemOnItem);
  api.onItemOnNpc(feedSafalaan);
  api.onItemAction("Dusty book", { Read: readDustyBook });
  api.onItemAction("Lab notes", { Read: readCastleLabNotes });
  api.onItemAction("Squire's journal", { Read: readSlepeJournal });
  for (const book of SLEPE_BOOKS) api.onItemAction(book.name, { Read: readPaterdomusBook });
  api.onItemAction("Ivandis' writings", { Read: readIvandisWritings });
  api.onNpcInteraction("Aranei", { Heal: healSiegeAranei });
  api.onPlayerProcess(syncHuntGroundItems);
  api.onCustomEvent("door:toggle", handleBloodHuntDoorToggle);
  api.onPlayerProcess(processSlepeIvan);
  api.onPlayerProcess(processSlepeManor);
  api.onPlayerProcess(processSlepeProgress);
  api.onPlayerProcess(processCastleDialogueTransition);
  api.onPlayerMapSquareChange(syncCastleLobbyFloorOnMapSquareChange);
  api.onPlayerLogin(handleSiegeLogin);
  api.onPlayerLogin(recoverWyrdEncounterOnLogin);
  api.onPlayerLogin(syncPalaceActorsOnLogin);
  api.onPlayerLogin(recoverWyrdBurghLandingOnLogin);
  api.onPlayerLogin(syncHideoutIvan);
  api.onPlayerLogin(syncSlepeIvan);
  api.onPlayerLogin(syncSlepeRoy);
  api.onPlayerLogin(syncPaterdomusBookPuzzle);
  api.onCustomEvent("player:bootstrap-complete", syncPaterdomusBookPuzzle);
  api.onPlayerLogin(resumeHideoutEscape);
  api.onPlayerLogin(syncCastleShrine);
  api.onPlayerLogin(recoverBloodHuntLanding);
  api.onPlayerLogin(syncBloodHuntDoorOnLogin);
  api.onPlayerLogin(syncBloodHuntPartyOnLogin);
  api.onPlayerLogin(recoverFirstBloodEncounter);
  api.onPlayerLogin(resumePreparationIntro);
  api.onPlayerLogin(syncCastleLobbyOnLogin);
  api.onPlayerLogin(resetBloodMoonSceneOnLogin);
  api.onPlayerLogin(syncCastleRoomOnLogin);
  api.onPlayerLogin(syncCastleChapelPortalOnLogin);
  api.onPlayerLogin(syncSolidKeyMountOnLogin);
  api.onPlayerLogin(recoverFinalDrakanLanding);
  api.onPlayerLogin(syncFinalEfaritayOnLogin);
  api.onPlayerLogin(syncGatheringCastleActorsOnLogin);
  api.onPlayerLogin(syncPostQuestEfaritay);
  api.onPlayerLogin(publishHelperVarbitsOnLogin);
  api.onPlayerLogin(resumeFinalDrakanVictory);
  api.onPlayerLogout(cleanupCastleActors);
  api.onPlayerLogout(cleanupPalaceActors);
  api.onPlayerLogout(cleanupBloodHuntActors);
  api.onPlayerLogout(cleanupFirstBloodEncounter);
  api.onPlayerLogout(cleanupGatheringDrakanOnLogout);
  api.onPlayerLogout(cleanupGatheringCastleActors);
  api.onPlayerLogout(cleanupPaterdomusBattleOnLogout);
  api.onPlayerLogout(({ player } = {}) => { if (player) Scenes.cancel(player); });
  api.onPlayerLogout(cleanupFinalEfaritay);
  api.onPlayerLogout(cleanupPostQuestEfaritay);
  api.onPlayerLogout(cleanupFinalCutsceneActors);
  api.onPlayerLogout(handleFinalDrakanLogout);
  api.onPlayerLogout(handleSiegeLogout);
  api.onPlayerLogout(cleanupWyrdEncounter);
  api.onPlayerLogout(hideoutDefense.onPlayerLogout);
  api.onPlayerLogout(cleanupSlepeIvan);
  api.onPlayerLogout(cleanupSlepeManor);
  api.onNpcDeath(handleWyrdDeath);
  api.onNpcBeforeDeath(handleWyrdBeforeDeath);
  api.onNpcBeforeDeath(handleGatheringDrakanBeforeDeath);
  api.onPlayerBeforeDeath(handleWyrdPlayerBeforeDeath);
  api.onCombatHitRoll(allowWyrdHitThroughPrayer);
  api.onCustomEvent("world:object-examine", inspectWyrdFence);
  api.onObjectInteraction("Fence", { Inspect: inspectWyrdFence });
  api.onNpcDeath(handleSlepeManorDeath);
  api.onNpcDeath(handlePaterdomusBattleDeath);
  api.onNpcDeath(handleCastleNpcDeath);
  api.onNpcDeath(handleBloodHuntPursuerDeath);
  api.onPlayerBeforeDeath(handleFinalDrakanBeforeDeath);
  api.persistAttribute(HIDEOUT_DEFENSE_COMPLETE);
  api.onNpcHitModify(handleSiegeDrakanHit);
  api.onNpcHitModify(handleGatheringDrakanHit);
  api.onNpcHitModify(handleFirstBloodHit);
  api.onNpcHitModify(handleFinalDrakanHit);
  api.persistAttribute(WYRD_DEFEATED_ATTRIBUTE);
  api.persistAttribute(WYRD_CUTSCENE_ATTRIBUTE);
  api.persistAttribute(DRAKAN_ENCOUNTER_COMPLETE);
  api.persistAttribute(DRAKAN_DEATH_CONFIRMED);
  api.persistAttribute(FINAL_NATIVE_STAGE_ATTRIBUTE);
  api.persistAttribute(FINAL_PORTAL_OPEN_ATTRIBUTE);
  api.persistAttribute(FINAL_PORTAL_USED_ATTRIBUTE);
  api.persistAttribute(DRAKAN_SUPPLY_ATTRIBUTE);
  api.persistAttribute(FIRST_BLOOD_DEFEATED_ATTRIBUTE);
  api.persistAttribute(SIEGE_DRAKAN_COMPLETE);
  api.persistAttribute(SIEGE_DEFENCE_ATTRIBUTE);
  api.persistAttribute(TOB_CHALLENGE_ATTRIBUTE);
  api.persistAttribute(PREP_ATTRIBUTE);
  api.persistAttribute(PREP_COMPLETE);
  api.persistAttribute(THRONE_PUZZLE_ATTRIBUTE);
  api.persistAttribute(CASTLE_ROOM_ATTRIBUTE);
  api.persistAttribute(CASTLE_FLOOR_ATTRIBUTE);
  api.persistAttribute(CASTLE_FACING_ATTRIBUTE);
  api.persistAttribute(CASTLE_NATIVE_STAGE_ATTRIBUTE);
  api.persistAttribute(CASTLE_STORY_ATTRIBUTE);
  api.persistAttribute(CASTLE_BOOK_PUZZLE_ATTRIBUTE);
  api.persistAttribute(CASTLE_TRANSITION_PENDING_ATTRIBUTE);
  api.onPlayerLogin(syncThroneBustsOnLogin);
  api.persistAttribute(BASIN_PUZZLE_ATTRIBUTE);
  api.persistAttribute(SOLID_KEY_ATTRIBUTE);
  api.persistAttribute(CLOCK_ATTRIBUTE);
  api.persistAttribute(GALLERY_CHEST_ATTRIBUTE);
  api.persistAttribute(REFINER_ATTRIBUTE);
  api.persistAttribute(HUNT_ATTRIBUTE);
  // Cache item 33715 is named exactly "Tome of experience". Named item-action
  // hooks compare that cache name case-sensitively.
  api.onItemAction("Tome of experience", { Read: readTome });
};
