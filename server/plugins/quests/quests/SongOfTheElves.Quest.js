/**
 * Song of the Elves (members, Elf series #8). The Wiki transcript is the source
 * for dialogue and cutscene ids; quest state mirrors the cache's sote varbit.
 */
module.exports = function registerSongOfTheElves(api) {
  const { Area, Boundary, Equipment, GameObject, HitDamage, HitMask, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, ObjectManager, PrivateArea, Skill, World } = api.core;
  const { registerQuest, loadTranscripts, startTranscript } = require("../QuestRuntime");
  const { findBestPickaxe } = require("../../skills/Mining.plugin.js");
  const { findBestUsableAxe } = require("../../skills/Woodcutting.plugin.js");
  const PAGE = "Song of the Elves";
  const FRAGMENT_BASIC_ATTACK_MAX = 12;
  const FRAGMENT_BASIC_ATTACK_SPEED = 7;
  // The cache leaves the Crystal Whirlwind attack speed unset; the server's
  // default attack interval is four ticks. The Wiki gives heal size, not rate.
  // shortcut: use that four-tick default for the healing beams' attack cycle.
  const FRAGMENT_BEAM_HEAL_SPEED = 4;
  const START_HOOK = "quest:song-of-the-elves:start";
  const CHEMICAL_CHOICE = "quest.song_of_the_elves.chemical-choice";
  const FALLS_PILLARS = "quest.song_of_the_elves.falls-pillars";
  const FALLS_ORDER = "quest.song_of_the_elves.falls-order";
  const INCITEMENTS = "quest.song_of_the_elves.incitements";
  const RESISTANCE_MEMBERS = "quest.song_of_the_elves.resistance-members";
  const RESISTANCE_BRIEFING = "quest.song_of_the_elves.resistance-briefing";
  const HEADQUARTERS_WARNING_HEARD = "song-of-the-elves:headquarters-warning-heard";
  const HEADQUARTERS_TRAPDOOR = ObjectIdentifiers.TRAPDOOR_38;
  const BATTLE_TRAPDOOR = ObjectIdentifiers.TRAPDOOR_95; // mourning_hideout_trap_door_battle
  const WEST_BATTLE_KILLS = "quest.song_of_the_elves.west-battle-kills";
  const KING_SCENE_PROGRESS = "song-of-the-elves:king-scene-progress";
  const FIRST_MEETING_PROGRESS = "song-of-the-elves:first-meeting-progress";
  const FALLS_DEPARTURE = "song-of-the-elves:falls-departure";
  const FALLS_BOOK_READ = "song-of-the-elves:falls-book-read";
  const FALLS_ACTORS = new Map();
  const FALLS_KEY = ItemIdentifiers.KEY_18; // cache waterfall quest key, 298
  const FALLS_INTRODUCTION = "song-of-the-elves:falls-introduction";
  const PREPARATION_PROGRESS = "song-of-the-elves:preparation-progress";
  const PREPARATION_ELDERS = "song-of-the-elves:preparation-elders";
  const TRAHAEARN_REPAIRED = "song-of-the-elves:trahaearn-repaired";
  const TRAHAEARN_CREVICE = "song-of-the-elves:trahaearn-crevice";
  const PREPARATION_ACTORS = new Map();
  const TRAHAEARN_CREVICE_VARBIT = 9018;
  const TRAHAEARN_CREVICE_LOC = 37271; // cache sote_well_cave transform parent
  const EARLY_STORY_ACTORS = new Map();
  const EAST_BATTLE_KILLS = "quest.song_of_the_elves.east-battle-kills";
  const BATTLE_AREA = "quest.song_of_the_elves.battle-area";
  const LATE_CHAPTER = "quest.song_of_the_elves.late-chapter";
  const WAR_END_ARIANWYN_DONE = "quest.song_of_the_elves.war-end-arianwyn-done";
  const VALLEY_FIGURE = "quest.song_of_the_elves.valley-figure";
  const LIBRARY_INSTANCE = "quest.song_of_the_elves.library-instance";
  const LIBRARY_SEALS = "quest.song_of_the_elves.library-seals";
  const LIBRARY_PUZZLE = "quest.song_of_the_elves.library-puzzle";
  const LIBRARY_MIRRORS = "quest.song_of_the_elves.library-mirrors";
  const LIBRARY_CRYSTALS = "quest.song_of_the_elves.library-crystals";
  const LIBRARY_PILLAR_STATE = "quest.song_of_the_elves.library-pillar-state";
  const LIBRARY_MEMORY_ACTORS = new WeakMap();
  const RECRUITED_ELDERS = "quest.song_of_the_elves.recruited-elders";
  const REVELATIONS_MEETING_STARTED = "quest.song_of_the_elves.revelations-meeting-started";
  const CRWYS_CLUE_HEARD = "quest.song_of_the_elves.crwys-clue-heard";
  // Cache transform for the Crwys disguise: hidden tree, chop-able tree, revealed elf.
  const CRWYS_TREE_TRANSFORM_VARBIT = 9022;
  const HEFIN_CLUE_HEARD = "quest.song_of_the_elves.hefin-clue-heard";
  const YSGAWYN_TRACK_STEP = "quest.song_of_the_elves.ysgawyn-track-step";
  const YSGAWYN_CLEARING_NPC = "quest.song_of_the_elves.ysgawyn-clearing-npc";
  const YSGAWYN_TRACKS = [
    { id: 37292, x: 2302, y: 3195, clue: "You notice a disturbed patch among the mushrooms." },
    { id: 37297, x: 2291, y: 3187, clue: "The marks on the rock show where someone climbed down." },
    { id: 37296, x: 2277, y: 3184, clue: "You find another set of boot prints on the rock." },
    { id: 3918, x: 2269, y: 3164, clue: "You inspect the old lamp and find fresh signs of passage." },
    { id: 3916, x: 2259, y: 3159, clue: "You find more disturbed mushrooms leading north-west." },
    { id: 37297, x: 2244, y: 3170, clue: "The final rock bears fresh climbing marks." },
  ];
  const HEFIN_CROSSING = "quest.song_of_the_elves.hefin-crossing";
  const HEFIN_JUMP_ANIMATION = 769; // human_steppingstonejump
  const HEFIN_STONE_ROUTE = [
    [2299, 3114], [2299, 3113], [2299, 3110], [2302, 3110], [2302, 3107], [2302, 3104],
    [2299, 3104], [2299, 3101], [2299, 3098], [2302, 3098], [2302, 3095], [2302, 3092],
    [2299, 3092], [2299, 3089], [2296, 3089], [2293, 3089], [2293, 3092], [2290, 3092],
    [2290, 3095], [2287, 3095], [2284, 3095], [2284, 3092], [2280, 3092],
  ];
  const MEILYR_CLUE = "quest.song_of_the_elves.meilyr-clue";
  const MEILYR_CLUE_ITEMS_MIGRATED = "song-of-the-elves:meilyr-clue-items-migrated";
  const MEILYR_CLUE_ITEMS = [ItemIdentifiers.CLUE_SCROLL_2, ItemIdentifiers.CLUE_SCROLL_3,
    ItemIdentifiers.CLUE_SCROLL_4, ItemIdentifiers.CLUE_SCROLL_5];
  const MEILYR_CLUE_TEXT = [
    "Dig south-east of Port Tyras near the yew tree, four tiles south of the triple mushroom cluster.",
    "Dig on the east side of the northernmost hut in Zul-Andra, two steps north of the hole.",
    "DEAD ROASTING UPSHIFTS. Dig one square north of the north-eastern elven lamp at Prifddinas's south gates.",
    "Spin outside the Underground Pass entrance in eastern Isafdar with nothing equipped.",
  ];
  const ITHELL_SYMBOLS = "quest.song_of_the_elves.ithell-symbols";
  const ITHELL_STATUE = "quest.song_of_the_elves.ithell-statue";
  const ITHELL_CLUE_STAGE = "quest.song_of_the_elves.ithell-clue-stage";
  const ITHELL_RECRUITED = "quest.song_of_the_elves.ithell-recruited";
  const ITHELL_KELYN_NPC = "quest.song_of_the_elves.ithell-kelyn-npc";
  const MEILYR_FFION_NPC = "quest.song_of_the_elves.meilyr-ffion-npc";
  const ITHELL_VARBIT = 9035;
  const MEILYR_VARBIT = 9036;
  const ITHELL_SYMBOL_VARBITS = [9041, 9039, 9040, 9038, 9037];
  const ITHELL_SYMBOLS_BY_TILE = [
    { id: 37307, x: 2349, y: 3161, z: 0 }, // Lletya bank
    { id: 37305, x: 2322, y: 3163, z: 0 }, // north of Elena
    { id: 37306, x: 2340, y: 3181, z: 0 }, // general store, ground floor
    { id: 37304, x: 2334, y: 3183, z: 1 }, // general store, upper floor
    { id: 37303, x: 2351, y: 3172, z: 1 }, // altar
  ];
  const ITHELL_WELL_IDS = new Set([37308, 37309, 37310, 35880, 35881, 35882, 35883, 35884]);
  const ITHELL_EXAMINE_MARKERS = [
    new Set([37307, 1189, 10529]), new Set([37305, 8773]), new Set([37306]),
    new Set([37304, 8744]), new Set([37303, 35878, 35879]),
  ].map((markers) => new Set([...markers, 35878, 35879]));
  const MEILYR_DIG_SPOTS = [
    { x: 2225, y: 3133, message: "You dig up a clue scroll pointing to Zul-Andra." },
    { x: 2203, y: 3061, message: "You dig up a clue scroll pointing to Prifddinas's southern gate." },
    { x: 2240, y: 3269, message: "You dig up the final clue scroll. Read it to learn what to do next." },
  ];
  const LLETYA_GUIDE_NPC = "song-of-the-elves:lletya-guide-npc";
  const LLETYA_BAXTORIAN_NPC = "quest.song_of_the_elves.lletya-baxtorian-npc";
  const HEFIN_GUIDE_SPAWNED = "quest.song_of_the_elves.hefin-guide-spawned";
  const LLETYA_ARIANWYN_NPC = "quest.song_of_the_elves.lletya-arianwyn-npc";
  const LLETYA_CHILDREN = "quest.song_of_the_elves.lletya-children";
  const LLETYA_TRAITOR_REVEALED = "quest.song_of_the_elves.lletya-traitor-revealed";
  const LLETYA_ARIANWYN_CONFRONTED = "quest.song_of_the_elves.lletya-arianwyn-confronted";
  const LLETYA_BOSS = "quest.song_of_the_elves.lletya-boss";
  const FRAGMENT_DEFEATED = "quest.song_of_the_elves.fragment-defeated";
  const ORB_CAVE_AREA = "quest.song_of_the_elves.orb-cave-area";
  const ORB_CAVE_ENTRY_PENDING = "song-of-the-elves:orb-cave-entry-pending";
  const YSGAWYN_RETURN_MEETING = "quest.song_of_the_elves.ysgawyn-return-meeting";
  const ELENA_PRE_MEETING_RESPONSE = "quest.song_of_the_elves.elena-pre-meeting-response";
  const CAMP_AREA = "quest.song_of_the_elves.camp-area";
  const CAMP_HOLES = "quest.song_of_the_elves.camp-holes";
  // This is the stackable Song of the Elves item. EXPLOSIVE_POTION (4045) is
  // the older, non-stackable Castle Wars barricade potion.
  const CAMP_EXPLOSIVE_ITEM = ItemIdentifiers.EXPLOSIVE_POTION_3;
  const CAMP_EXPLOSIVES = "quest.song_of_the_elves.camp-explosives";
  const CAMP_DEFENSE = "quest.song_of_the_elves.camp-defense";
  const CAMP_DEFENSE_COMPLETE = "quest.song_of_the_elves.camp-defense-complete";
  const CAMP_BATTLE = "quest.song_of_the_elves.camp-battle";
  const CAMP_ARRIVAL_STARTED = "quest.song_of_the_elves.camp-arrival-started";
  const TEMPLE_CUTSCENE_STARTED = "quest.song_of_the_elves.temple-cutscene-started";
  const CAMP_HOLE_ID = 35887;
  const CAMP_CAVE_ID = ObjectIdentifiers.CAVE_STAIRS_2;
  const CAMP_HOLE_TILES = [[2439, 6126], [2444, 6129], [2450, 6127], [2452, 6122], [2456, 6119], [2459, 6114], [2457, 6109]];
  const CAMP_CENTER = new Location(2445, 6092, 0);
  const LIBRARY_SEAL_DATA = [
    { name: "ithell", id: ObjectIdentifiers.SEAL_OF_ITHELL, mapId: 36730, memory: NpcIdentifiers.MEMORY_OF_SEREN_2, tile: [2676, 6101, 1], tileRotation: 1, source: [2651, 6102, 1], sourceDirection: "south", steps: ["E", "N", "E", "N", "E", "S", "W", "S", "E", "N", "E", "N", "E"], targets: [[2651, 6098, 1], [2655, 6098, 1], [2655, 6106, 1], [2659, 6106, 1], [2659, 6110, 1], [2663, 6110, 1], [2663, 6098, 1], [2659, 6098, 1], [2659, 6094, 1], [2667, 6094, 1], [2667, 6098, 1], [2671, 6098, 1], [2671, 6102, 1]] },
    { name: "cadarn", id: ObjectIdentifiers.SEAL_OF_CADARN, mapId: 36725, memory: NpcIdentifiers.MEMORY_OF_SEREN_3, tile: [2622, 6097, 0], tileRotation: 2, source: [2609, 6130, 1], sourceDirection: "north", steps: ["E", "D", "S", "W", "S", "red", "E", "S"], targets: [[2609, 6158, 1], [2623, 6158, 1], [2623, 6158, 0], [2623, 6130, 0], [2609, 6130, 0], [2609, 6116, 0], [2609, 6102, 0], [2623, 6102, 0]] },
    { name: "crwys", id: ObjectIdentifiers.SEAL_OF_CRWYS, mapId: 36726, memory: NpcIdentifiers.MEMORY_OF_SEREN_4, tile: [2576, 6171, 1], tileRotation: 3, source: [2609, 6158, 1], sourceDirection: "south", steps: ["W", "N", "W", "fractured", "N", "green", "D", "E", "U", "cyan", "S", "D", "S"], targets: [[2609, 6144, 1], [2595, 6144, 1], [2595, 6158, 1], [2581, 6158, 1], [2567, 6158, 1], [2567, 6172, 1], [2567, 6200, 1], [2567, 6200, 0], [2581, 6200, 0], [2581, 6200, 1], [2581, 6200, 2], [2581, 6186, 2], [2581, 6186, 1]] },
    { name: "amlodd", id: ObjectIdentifiers.SEAL_OF_AMLODD, mapId: 36727, memory: NpcIdentifiers.MEMORY_OF_SEREN_5, tile: [2614, 6157, 0], tileRotation: 1, source: [2623, 6144, 1], sourceDirection: "west", steps: ["fractured", "N", "red", "E", "N", "W", "D", "S", "E", "D", "S", "W", "S", "W", "N", "green", "yellow", "E", "E", "S"], targets: [[2609, 6144, 1], [2595, 6144, 1], [2595, 6158, 1], [2595, 6172, 1], [2609, 6172, 1], [2609, 6186, 1], [2595, 6186, 1], [2595, 6186, 0], [2609, 6158, 1], [2623, 6158, 1], [2623, 6158, 0], [2623, 6130, 0], [2609, 6130, 0], [2609, 6116, 0], [2595, 6116, 0], [2595, 6130, 0], [2595, 6144, 0], [2595, 6158, 0], [2595, 6172, 0], [2609, 6172, 0]], branches: { 8: { fromStep: 0 }, 18: { fromStep: 7 } } },
    { name: "meilyr", id: ObjectIdentifiers.SEAL_OF_MEILYR, mapId: 36731, memory: NpcIdentifiers.MEMORY_OF_SEREN_6, tile: [2580, 6163, 2], tileRotation: 0, source: [2595, 6158, 1], sourceDirection: "east", steps: ["E", "D", "S", "W", "S", "W", "N", "W", "N", "U", "red", "N", "U", "N", "W", "N", "W", "S", "W"], targets: [[2609, 6158, 1], [2623, 6158, 1], [2623, 6158, 0], [2623, 6130, 0], [2609, 6130, 0], [2609, 6116, 0], [2595, 6116, 0], [2595, 6130, 0], [2581, 6130, 0], [2581, 6144, 0], [2581, 6144, 1], [2581, 6144, 2], [2637, 6144, 1], [2637, 6144, 2], [2637, 6158, 2], [2609, 6158, 2], [2609, 6172, 2], [2595, 6172, 2], [2595, 6158, 2]], branches: { 12: { source: [2637, 6130, 1], direction: "north" } } },
    { name: "hefin", id: ObjectIdentifiers.SEAL_OF_HEFIN, mapId: 36728, memory: NpcIdentifiers.MEMORY_OF_SEREN_7, tile: [2562, 6129, 2], tileRotation: 3, source: [2595, 6158, 1], sourceDirection: "east", steps: ["E", "D", "S", "W", "S", "W", "N", "W", "S", "W", "N", "D", "E", "U", "N", "W", "U", "N", "W", "S"], targets: [[2609, 6158, 1], [2623, 6158, 1], [2623, 6158, 0], [2623, 6130, 0], [2609, 6130, 0], [2609, 6116, 0], [2595, 6116, 0], [2595, 6130, 0], [2595, 6102, 1], [2595, 6088, 1], [2567, 6088, 1], [2567, 6116, 1], [2567, 6116, 0], [2581, 6116, 0], [2581, 6130, 0], [2581, 6144, 0], [2567, 6144, 0], [2581, 6116, 2], [2581, 6130, 2], [2567, 6144, 2]], branches: { 8: { source: [2595, 6116, 1], direction: "south" }, 14: { source: [2581, 6116, 0], direction: "north" }, 17: { source: [2581, 6102, 2], direction: "north" }, 19: { source: [2567, 6172, 2], direction: "south" } } },
    { name: "trahaearn", id: ObjectIdentifiers.SEAL_OF_TRAHAEARN, mapId: 36732, memory: NpcIdentifiers.MEMORY_OF_SEREN_8, tile: [2646, 6143, 2], tileRotation: 3, source: [2595, 6116, 1], sourceDirection: "south", steps: ["S", "W", "N", "D", "E", "U", "N", "E", "S", "E", "blue", "S", "E", "N", "W", "N", "N", "E", "U", "E", "N", "W", "S"], targets: [[2595, 6102, 1], [2595, 6088, 1], [2567, 6088, 1], [2567, 6116, 1], [2567, 6116, 0], [2581, 6116, 0], [2581, 6116, 2], [2581, 6130, 2], [2609, 6130, 2], [2609, 6102, 2], [2637, 6102, 2], [2651, 6102, 2], [2651, 6094, 2], [2665, 6094, 2], [2665, 6110, 2], [2651, 6110, 2], [2651, 6130, 1], [2651, 6144, 1], [2665, 6144, 1], [2665, 6144, 2], [2679, 6144, 2], [2679, 6158, 2], [2651, 6158, 2]], branches: { 16: { source: [2651, 6116, 1], direction: "north" } } },
    { name: "iorwerth", id: ObjectIdentifiers.SEAL_OF_IORWERTH, mapId: 36729, memory: NpcIdentifiers.MEMORY_OF_SEREN_9, tile: [2650, 6167, 1], tileRotation: 2, source: [2637, 6130, 1], sourceDirection: "north", steps: ["cyan", "blue", "W", "D", "N", "fractured", "E", "U", "S", "E", "yellow", "N", "W", "N", "U", "S", "magenta", "N", "E", "red", "N", "W", "N", "E", "N", "U", "N", "W", "S", "D", "S", "D"], targets: [[2637, 6144, 1], [2637, 6158, 1], [2637, 6172, 1], [2623, 6172, 1], [2623, 6172, 0], [2623, 6186, 0], [2623, 6200, 0], [2637, 6200, 0], [2637, 6186, 0], [2637, 6172, 0], [2651, 6172, 0], [2665, 6172, 0], [2665, 6186, 0], [2651, 6186, 0], [2651, 6200, 0], [2651, 6200, 1], [2637, 6200, 1], [2651, 6130, 1], [2651, 6144, 1], [2665, 6144, 1], [2679, 6144, 1], [2679, 6158, 1], [2665, 6158, 1], [2665, 6172, 1], [2679, 6172, 1], [2679, 6186, 1], [2679, 6186, 2], [2679, 6200, 2], [2665, 6200, 2], [2665, 6186, 2], [2637, 6200, 2], [2637, 6186, 2]], branches: { 8: { fromStep: 5 }, 16: { source: [2637, 6186, 1], direction: "north" }, 17: { source: [2651, 6116, 1], direction: "north" }, 30: { source: [2637, 6186, 2], direction: "north" } } },
  ];
  // The cache's seal destination anchors are blocked object tiles. Land on
  // the adjacent clear floor so the player can approach the seal normally.
  const LIBRARY_MEMORY_ARRIVALS = [
    [2675, 6102, 1], [2623, 6098, 0], [2577, 6172, 1],
    [2613, 6158, 0], [2581, 6162, 2], [2563, 6130, 2],
    [2647, 6144, 2], [2651, 6168, 1],
  ];
  const LIBRARY_OPERATIONS = { E: "east", W: "west", N: "north", S: "south", U: "up", D: "down" };
  const LIBRARY_CRYSTAL_ITEMS = {
    red: ItemIdentifiers.RED_CRYSTAL_2, yellow: ItemIdentifiers.YELLOW_CRYSTAL_2,
    green: ItemIdentifiers.GREEN_CRYSTAL_2, cyan: ItemIdentifiers.CYAN_CRYSTAL_2,
    blue: ItemIdentifiers.BLUE_CRYSTAL_2, magenta: ItemIdentifiers.MAGENTA_CRYSTAL_2,
    fractured: ItemIdentifiers.FRACTURED_CRYSTAL_3,
  };
  const LIBRARY_PILLAR_IDS = new Set(Object.entries(ObjectIdentifiers)
    .filter(([name]) => name.startsWith("PILLAR_OF_LIGHT"))
    .map(([, id]) => id)
    // The cache substitutes these ids into its static library beam pillars.
    .concat(Array.from({ length: 20 }, (_, index) => 36705 + index)));
  const LIBRARY_DIRECTIONS = { east: "E", west: "W", north: "N", south: "S", up: "U", down: "D" };
  const PILLAR_ITEMS = [
    [ItemIdentifiers.NATURE_RUNE,"Nature rune",[]],
    [ItemIdentifiers.IRIT_LEAF,"Irit leaf",[ItemIdentifiers.GRIMY_IRIT_LEAF,
      ItemIdentifiers.ASSORTED_FLOWERS,ItemIdentifiers.BLACK_FLOWERS,ItemIdentifiers.BLUE_FLOWERS,
      ItemIdentifiers.MIXED_FLOWERS,ItemIdentifiers.ORANGE_FLOWERS,ItemIdentifiers.PURPLE_FLOWERS,
      ItemIdentifiers.RED_FLOWERS,ItemIdentifiers.WHITE_FLOWERS,ItemIdentifiers.YELLOW_FLOWERS]],
    [ItemIdentifiers.BLACK_DAGGER,"Black dagger",[ItemIdentifiers.BLACK_DAGGER_P_,ItemIdentifiers.BLACK_DAGGER_P_PLUS_,
      ItemIdentifiers.BLACK_DAGGER_P_PLUS_PLUS_,ItemIdentifiers.BLACK_KNIFE,ItemIdentifiers.BLACK_KNIFE_P_,
      ItemIdentifiers.BLACK_KNIFE_P_PLUS_,ItemIdentifiers.BLACK_KNIFE_P_PLUS_PLUS_]],
    [ItemIdentifiers.WINE_OF_ZAMORAK,"Wine of Zamorak",[ItemIdentifiers.ZAMORAK_BREW_4_]],
    [ItemIdentifiers.ADAMANT_CHAINBODY,"Adamant chainbody",[]],
    [ItemIdentifiers.CABBAGE,"Cabbage",[]],
  ];
  const FALLS_PILLAR_LOCATIONS = [
    [2600,9909,0],[2600,9911,0],[2600,9913,0],
    [2607,9911,0],[2607,9913,0],[2607,9909,0],
  ];
  const CHEMICALS = [ItemIdentifiers.BLUE_LIQUID, ItemIdentifiers.GREEN_POWDER, ItemIdentifiers.CLEAR_LIQUID, ItemIdentifiers.RED_POWDER];
  const SULPHURIC_ACID = ItemIdentifiers.SULPHURIC_ACID;
  const DISGUISE_BRIEFED = "song-of-the-elves:disguise-briefed";
  const ELENA_ESCAPE_PROGRESS = "song-of-the-elves:elena-escape-progress";
  const PRISON_ENTRY = 35791;
  const PRISON_EXIT = 35792;
  const PRISON_ELENA_BASE = 1150; // Cache multiloc NPC controlled by the quest stage.
  const DISGUISE = {
    STEEL_HELM: ItemIdentifiers.STEEL_FULL_HELM,
    STEEL_BODY: ItemIdentifiers.STEEL_PLATEBODY,
    STEEL_LEGS: ItemIdentifiers.STEEL_PLATELEGS,
    RED_DYE: ItemIdentifiers.RED_DYE,
    PURPLE_DYE: ItemIdentifiers.PURPLE_DYE,
    SILK: ItemIdentifiers.SILK,
    HELM: ItemIdentifiers.ARDOUGNE_KNIGHT_HELM,
    BODY: ItemIdentifiers.ARDOUGNE_KNIGHT_PLATEBODY,
    LEGS: ItemIdentifiers.ARDOUGNE_KNIGHT_PLATELEGS,
    TABARD: ItemIdentifiers.ARDOUGNE_KNIGHT_TABARD,
  };
  const MOURNER_OUTFIT = [
    [Equipment.HEAD_SLOT, ItemIdentifiers.GAS_MASK],
    [Equipment.BODY_SLOT, ItemIdentifiers.MOURNER_TOP],
    [Equipment.LEG_SLOT, ItemIdentifiers.MOURNER_TROUSERS],
    [Equipment.HANDS_SLOT, ItemIdentifiers.MOURNER_GLOVES],
    [Equipment.FEET_SLOT, ItemIdentifiers.MOURNER_BOOTS],
    [Equipment.CAPE_SLOT, ItemIdentifiers.MOURNER_CLOAK],
  ];
  const CITIZEN_SUPPORT = {
    "Priest": 6, "Nurse Sarah": 6, Chadwell: 4,
    "Silk merchant": 2, "Western baker": 4, "Eastern baker": 4,
    "Silver merchant": 2, "Gem merchant": 2, "Fur trader": 2,
    "Spice seller": 2, "Town Crier": 8, Zenesha: 3, Probita: 2,
    "Estate agent": 2, Aemad: 4, Kortan: 4,
    "Doctor Orbon": 6, Richard: 4, Bartender: 6,
  };
  const RESISTANCE_VARBITS = {
    "fire:AWdFbp": 9058, "fire:y9pqh3": 9059, "fire:Nn3EkA": 9060,
    "fire:east-farm": 9061, "fire:east-docks": 9062,
    "npc:west:nurse sarah": 9063, "npc:east:doctor orbon": 9064,
    "npc:west:chadwell": 9065, "npc:east:general-store": 9066,
    "npc:east:probita": 9067, "npc:east:zenesha": 9068,
    "npc:east:silk merchant": 9069, "npc:east:spice seller": 9070,
    "npc:east:fur trader": 9071, "npc:east:gem merchant": 9072,
    "npc:east:western baker": 9073, "npc:east:silver merchant": 9074,
    "npc:east:town crier": 9075, "npc:east:bartender": 9076,
    "npc:east:richard": 9077, "npc:east:priest": 9078,
    "npc:west:priest": 9079, "npc:east:estate agent": 9080,
    "npc:east:eastern baker": 9081,
  };
  const FIRE_SUPPORT = { "y9pqh3": 8, "Nn3EkA": 8, "AWdFbp": 8 };
  const STAGE = { NOT_STARTED: 0, STARTED: 10, COMPLETE: 200 };
  const IORWERTH_CAMP_TELEPORT_IDS = new Set([
    ItemIdentifiers.IORWERTH_CAMP_TELEPORT,
    ItemIdentifiers.IORWERTH_CAMP_TELEPORT_2,
  ]);
  const CHAPTERS = [
    "starting-out", "making-a-knightly-disguise", "freeing-elena",
    "meet-the-ardougne-resistance", "causing-an-insurrection",
    "vive-la-ardougne-r-volution", "battle-of-two-ardougnes",
    "face-to-face-with-lord-iorwerth", "retreating-to-lletya",
    "the-first-meeting", "visiting-baxtorian-falls",
    "preparing-to-enter-prifddinas", "the-grand-library-of-prifddinas",
    "reporting-back-after-the-revelations", "recovering-the-orb",
    "attack-on-lletya", "after-the-attack", "preparations-at-the-dwarf-camp",
    "sealing-the-underground-pass", "the-fragment-of-seren", "the-war-s-end",
  ];
  // Shared named NPCs whose generic transcript picker would otherwise stop at an
  // older "standard" variant after this quest. Keyed by cache NPC name; the page
  // and variant must both exist in the cross-page dialogue index.
  const POST_QUEST_DIALOGUE = {
    Edmond: ["Edmond", "standard-dialogue-after-the-song-of-the-elves-quest"],
    Elena: ["Elena", "after-song-of-the-elves"],
    Alrena: ["Alrena", "standard-dialogue-after-song-of-the-elves"],
    Eluned: ["Eluned", "standard-dialogue-after-song-of-the-elves"],
    "Councillor Halgrive": ["Councillor Halgrive", "standard-dialogue-after-song-of-the-elves"],
    "Martha Rehnison": ["Martha Rehnison", "standard-dialogue-after-song-of-the-elves"],
    "Ted Rehnison": ["Ted Rehnison", "standard-dialogue-after-song-of-the-elves"],
    "Milli Rehnison": ["Milli Rehnison", "standard-dialogue-after-song-of-the-elves"],
  };
  const REQUIRED_QUESTS = [
    ["mournings_end_part_ii", "Mourning's End Part II"],
    ["making_history", "Making History"],
    ["druidic_ritual", "Druidic Ritual"],
  ];
  const REQUIRED_SKILLS = [
    [Skill.AGILITY, "Agility"], [Skill.CONSTRUCTION, "Construction"],
    [Skill.FARMING, "Farming"], [Skill.HERBLORE, "Herblore"],
    [Skill.HUNTER, "Hunter"], [Skill.MINING, "Mining"],
    [Skill.SMITHING, "Smithing"], [Skill.WOODCUTTING, "Woodcutting"],
  ];
  const REWARD_SKILLS = [
    [Skill.AGILITY, "Agility"], [Skill.CONSTRUCTION, "Construction"],
    [Skill.FARMING, "Farming"], [Skill.HERBLORE, "Herblore"],
    [Skill.HUNTER, "Hunter"], [Skill.MINING, "Mining"],
    [Skill.SMITHING, "Smithing"], [Skill.WOODCUTTING, "Woodcutting"],
  ];
  let quest;
  const battleInstances = new Map();
  const arianwynInstances = new Map();
  const libraryInstances = new Map();
  const fragmentInstances = new Map();
  const warEndActors = new Map();
  const campInstances = new Map();
  const orbCaveInstances = new Map();
  let ithellSymbolsInstalled = false;

  class LletyaStoryArea extends Area {
    postLeave(mobile) { if(mobile?.isPlayer?.() && mobile.getAsPlayer().getAttribute(VALLEY_FIGURE)!==true)clearPreparationActors(mobile.getAsPlayer()); }
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (quest.isComplete(player)) return;
      if (currentChapter(player) === 16 && (Number(player.getAttribute(ITHELL_CLUE_STAGE)) || 0) > 0) {
        ensureIthellSymbolObjects();
      }
      const currentGuide=player.getAttribute(LLETYA_GUIDE_NPC);
      if(currentChapter(player)===12 && !currentGuide?.isRegistered?.()) {
        const guide=api.spawnNpc({id:NpcIdentifiers.LORD_IEUAN_AMLODD_2,x:2353,y:3179,z:0,wanderRadius:0,owner:player,ownerOnly:true});
        if(guide)player.setAttribute(LLETYA_GUIDE_NPC,guide);
      } else if(currentChapter(player)!==12 && currentGuide) {
        api.removeNpc(currentGuide);player.setAttribute(LLETYA_GUIDE_NPC,null);
      }
      // Lletya's map NPC is a cache scenery variant (5292) with no Talk-to
      // action. Use the cache's actual Talk-to Arianwyn variant for this chapter.
      const arianwynCurrent = player.getAttribute(LLETYA_ARIANWYN_NPC);
      if ([13, 15].includes(currentChapter(player)) && !arianwynCurrent?.isRegistered?.()) {
        const arianwyn = api.spawnNpc({ id: NpcIdentifiers.ARIANWYN_6, x: 2353, y: 3173, z: 0,
          wanderRadius: 0, owner: player, ownerOnly: true });
        if (arianwyn) player.setAttribute(LLETYA_ARIANWYN_NPC, arianwyn);
      }
      if (![13, 15].includes(currentChapter(player))) {
        const arianwyn = player.getAttribute(LLETYA_ARIANWYN_NPC);
        if (arianwyn) api.removeNpc(arianwyn);
        player.setAttribute(LLETYA_ARIANWYN_NPC, null);
      }
      const baxtorian = player.getAttribute(LLETYA_BAXTORIAN_NPC);
      const chapter = currentChapter(player);
      if ([8,9].includes(chapter)) ensureFirstMeetingActors(player);
      if (chapter===11)ensurePreparationActors(player);
      const campRetry = chapter === 19 && player.getAttribute(CAMP_DEFENSE_COMPLETE) === true &&
        player.getAttribute(FRAGMENT_DEFEATED) !== true;
      if (([16, 17].includes(chapter) || campRetry) && !baxtorian?.isRegistered?.()) {
        const npc = api.spawnNpc({ id: NpcIdentifiers.BAXTORIAN, x: 2352, y: 3170, z: 0,
          wanderRadius: 0, owner: player, ownerOnly: true });
        if (npc) player.setAttribute(LLETYA_BAXTORIAN_NPC, npc);
      } else if (!([16, 17].includes(chapter) || campRetry) && baxtorian) {
        api.removeNpc(baxtorian);
        player.setAttribute(LLETYA_BAXTORIAN_NPC, null);
      }
      const kelyn = player.getAttribute(ITHELL_KELYN_NPC);
      const awaitingKelyn = currentChapter(player) === 16 && player.getAttribute(ITHELL_STATUE) === true &&
        player.getAttribute(ITHELL_RECRUITED) !== true;
      if (awaitingKelyn && !kelyn?.isRegistered?.()) {
        const npc = api.spawnNpc({ id: NpcIdentifiers.LADY_KELYN_ITHELL, x: 2334, y: 3169, z: 0,
          wanderRadius: 0, owner: player, ownerOnly: true });
        if (npc) player.setAttribute(ITHELL_KELYN_NPC, npc);
      } else if (!awaitingKelyn && kelyn) {
        api.removeNpc(kelyn);
        player.setAttribute(ITHELL_KELYN_NPC, null);
      }
    }
  }

  class MeilyrPassArea extends Area {
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      const existing = player.getAttribute(MEILYR_FFION_NPC);
      if (quest.isComplete(player) || currentChapter(player) !== 16 ||
        (Number(player.getAttribute(MEILYR_CLUE)) || 0) < 4) {
        if (existing) api.removeNpc(existing);
        player.setAttribute(MEILYR_FFION_NPC, null);
        return;
      }
      ensureMeilyrAtPass(player);
    }
  }

  class YsgawynClearingArea extends Area {
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      const existing = player.getAttribute(YSGAWYN_CLEARING_NPC);
      if (quest.isComplete(player) || currentChapter(player) !== 14 ||
        Number(player.getAttribute(YSGAWYN_TRACK_STEP) ?? 0) < YSGAWYN_TRACKS.length + 1) {
        if (existing) api.removeNpc(existing);
        player.setAttribute(YSGAWYN_CLEARING_NPC, null);
        return;
      }
      if (existing?.isRegistered?.()) return;
      const ysgawyn = api.spawnNpc({ id: NpcIdentifiers.YSGAWYN, x: 2256, y: 3168, z: 0,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (ysgawyn) player.setAttribute(YSGAWYN_CLEARING_NPC, ysgawyn);
    }
  }

  class HefinStoryArea extends Area {
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (quest.isComplete(player) || currentChapter(player) !== 14 ||
        player.getAttribute(HEFIN_CLUE_HEARD) !== true) return;
      const existing = player.getAttribute(HEFIN_GUIDE_SPAWNED);
      if (existing?.isRegistered?.()) return;
      const hermit = api.spawnNpc({ id: NpcIdentifiers.ELF_HERMIT, x: 2277, y: 3093, z: 0,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (hermit) player.setAttribute(HEFIN_GUIDE_SPAWNED, hermit);
    }
  }

  class ArdougneBattleArea extends PrivateArea {
    constructor(battle, owner) {
      const bounds = battle === "west"
        ? [new Boundary(2504, 2568, 3256, 3336, 0), new Boundary(2024, 2056, 4616, 4664, 0)]
        : [new Boundary(2568, 2615, 3268, 3340, 0), new Boundary(2568, 2615, 3268, 3340, 1)];
      super(bounds);
      this.battle = battle;
      this.owner = owner;
    }

    canAttack(attacker, target) {
      const attackerInBattle = attacker?.getArea?.() === this;
      const targetInBattle = target?.getArea?.() === this;
      if ([NpcIdentifiers.ELENA_3, NpcIdentifiers.COUNCILLOR_HALGRIVE_3, NpcIdentifiers.ESSYLLT_2].includes(target?.getId?.())) return false;
      if (attackerInBattle || targetInBattle) return attackerInBattle && targetInBattle;
      return null;
    }

    isMulti() {
      return true;
    }

    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed?.()) battleInstances.delete(this);
    }
  }

  class OrbSupplyArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(2194, 2208, 9674, 9686, 0)]);
      this.owner = owner;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) {
        const state = orbCaveInstances.get(this);
        if (state && !state.ambushStarted) return false;
        return attackerHere && targetHere;
      }
      return null;
    }
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) orbCaveInstances.delete(this);
    }
  }

  class GrandLibraryArea extends PrivateArea {
    constructor(owner) {
      super([
        new Boundary(2548, 2690, 6078, 6220, 0),
        new Boundary(2548, 2690, 6078, 6220, 1),
        new Boundary(2548, 2690, 6078, 6220, 2),
      ]);
      this.owner = owner;
    }

    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) libraryInstances.delete(this.owner);
    }

    resolveObject(id, location) {
      return this.getObjects().find((object) => object.getId() === id &&
        object.getLocation().equals(location)) ?? null;
    }
  }

  class FragmentArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(3282, 3307, 5906, 5930, 1)]);
      this.owner = owner;
    }

    isMulti() { return true; }

    npcAggression(player, npc) {
      const state = fragmentInstances.get(this);
      return state && state.player === player && (npc === state.boss ||
        state.clones.includes(npc) || state.beams.has(npc)) ? false : null;
    }

    canAttack(attacker, target) {
      const attackerHere = attacker?.getArea?.() === this;
      const targetHere = target?.getArea?.() === this;
      if (attackerHere || targetHere) return attackerHere && targetHere;
      return null;
    }

    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (!this.isDestroyed()) return;
      const state = fragmentInstances.get(this);
      if (!state) return;
      state.finished = true;
      if (state.player.getAttribute(FRAGMENT_AREA) === this) state.player.setAttribute(FRAGMENT_AREA, null);
      state.player.setAttribute(TEMPLE_CUTSCENE_STARTED, false);
      fragmentInstances.delete(this);
    }

    process(mobile) {
      if (!mobile?.isNpc?.()) return;
      const state = fragmentInstances.get(this);
      if (!state || state.finished || (mobile !== state.boss &&
        !state.clones.includes(mobile) && !state.beams.has(mobile))) return;
      if (mobile === state.boss && mobile.getHitpoints() <= 0) return;
      mobile.setScriptedMovement(true);
      mobile.getCombat().getLastAttack().reset();
      if (mobile !== state.boss) return;
      const now = World.getProcessCycle();
      if (state.lastCycle === now) return;
      state.lastCycle = now;
      if (!state.introStarted) {
        state.introStarted = true;
        startTranscript(api, state.player, NpcIdentifiers.FRAGMENT_OF_SEREN, PAGE,
          "the-fragment-of-seren-the-fragment-enraged");
      }
      if (!state.introFinished) {
        if (state.player.getDialogueManager?.()?.isActive?.()) {
          state.nextBasicAttackAt = now + state.basicAttackSpeed;
          state.nextSpecialAt = now + 12;
          return;
        }
        state.introFinished = true;
      }
      if (state.beams.size > 0 && state.boss.getHitpoints() > 0) {
        if (now >= state.nextBeamHealAt) {
          const livingBeams = [...state.beams].filter(beam => beam.getHitpoints() > 0).length;
          const heal = livingBeams * (4 + Math.floor(Math.random() * 5));
          state.boss.setHitpoints(Math.min(state.boss.getMaxHitpoints(), state.boss.getHitpoints() + heal));
          state.nextBeamHealAt = now + FRAGMENT_BEAM_HEAL_SPEED;
        }
      }
      if (now >= state.nextBasicAttackAt) {
        state.nextBasicAttackAt = now + state.basicAttackSpeed;
        const firstDamage = Math.floor(Math.random() * (FRAGMENT_BASIC_ATTACK_MAX + 1));
        const secondDamage = Math.max(0, firstDamage - (Math.random() < 0.5 ? 0 : 1));
        // Wiki: Protect from Missiles reduces Seren's 12-damage auto-attack to
        // at most 3 per projectile. This two-hit ranged attack is separate from
        // the typeless blast, which intentionally bypasses protection prayers.
        if (api.core.PrayerHandler.isActivated(state.player, api.core.PrayerHandler.PROTECT_FROM_MISSILES)) {
          const hits = [firstDamage, secondDamage].map(damage => Math.floor(damage * 0.25));
          if (hits.some(damage => damage > 0)) {
            state.player.getCombat().getHitQueue().addPendingDamage(hits.map(damage =>
              new HitDamage(damage, HitMask.RED).setSource(state.boss)));
          }
        } else if (firstDamage > 0 || secondDamage > 0) {
          state.player.getCombat().getHitQueue().addPendingDamage([
            new HitDamage(firstDamage, HitMask.RED).setSource(state.boss),
            new HitDamage(secondDamage, HitMask.RED).setSource(state.boss),
          ]);
        }
      }
      if (now >= state.nextSpecialAt ||
        (state.followupAt && now >= state.followupAt) ||
        (state.meleeHitsRemaining && now >= state.nextMeleeHitAt) ||
        (state.specialImpactAt && now >= state.specialImpactAt)) {
        resolveFragmentSpecial(this, state, now);
      }
    }
  }

  class LletyaArianwynArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(2320, 2390, 3150, 3210, 0)]);
      this.owner = owner;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      const a = attacker?.getArea?.() === this;
      const t = target?.getArea?.() === this;
      if (a || t) return a && t;
      return null;
    }
    process(mobile) {
      const state = arianwynInstances.get(this);
      if (!state || mobile !== state.player || state.finished) return;
      const cycle = World.getProcessCycle();
      if (state.lastCycle === cycle) return;
      state.lastCycle = cycle;
      // This fight uses normal hit queues but drives its warning specials from
      // the private-area tick. Refresh engagement so generic NPC regeneration
      // does not erase ranged hits between player attack cycles.
      state.boss.getCombat().getLastAttack().reset();
      if (state.boss.getHitpoints() <= 60) {
        finishArianwynEncounter(this, state);
        return;
      }
      if (state.bomb && cycle >= state.bomb.impactAt) {
        const loc = state.player.getLocation();
        if (loc.getX() === state.bomb.x && loc.getY() === state.bomb.y) {
          const damage = 18 + Math.floor(Math.random() * 19);
          state.player.getCombat().getHitQueue().addPendingDamage([
            new HitDamage(damage, HitMask.RED).setSource(state.boss),
          ]);
          state.player.sendMessage("The orange arrow explodes beneath you.");
        } else {
          state.player.sendMessage("You avoid the orange arrow's blast.");
        }
        state.bomb = null;
      }
      if (cycle < state.nextSpecialAt) return;
      state.nextSpecialAt = cycle + 9;
      if (state.specialCount++ % 2 === 0) {
        api.core.PrayerHandler.deactivatePrayers(state.player);
        state.player.sendMessage("Arianwyn's purple arrow disables your prayers!");
      } else {
        const loc = state.player.getLocation();
        state.bomb = { x: loc.getX(), y: loc.getY(), impactAt: cycle + 2 };
        state.player.sendMessage("An orange arrow lands at your feet. Move before it explodes!");
      }
    }
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) arianwynInstances.delete(this);
    }
  }

  class FragmentThresholdArea extends Area {
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (currentChapter(player) !== 19 || player.getAttribute(CAMP_BATTLE) !== true ||
        player.getAttribute(FRAGMENT_DEFEATED) === true || player.getAttribute(FRAGMENT_AREA)) return;
      if (player.getAttribute(TEMPLE_CUTSCENE_STARTED) === true) {
        if (player.getDialogueManager?.()?.isActive?.()) return;
        player.setAttribute(TEMPLE_CUTSCENE_STARTED, false);
      }
      player.setAttribute(TEMPLE_CUTSCENE_STARTED, true);
      startTranscript(api, player, NpcIdentifiers.LORD_IORWERTH_2, PAGE,
        "the-fragment-of-seren-the-fragment-freed-at-last");
    }
  }

  class DwarvenCampArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(2424, 2472, 6078, 6142, 0)]);
      this.owner = owner;
    }
    isMulti() { return true; }
    canAttack(attacker, target) {
      const a = attacker?.getArea?.() === this;
      const t = target?.getArea?.() === this;
      const state = campInstances.get(this);
      if (state?.essylltPending && (a || t)) return false;
      if (state?.arrivalActors?.has(attacker) || state?.arrivalActors?.has(target)) return false;
      if (a || t) return a && t;
      return null;
    }
    process(mobile) {
      const state = campInstances.get(this);
      if (!state) return;
      // Drive the siege from its owner so it keeps advancing after the last
      // add dies; relying on an NPC tick can strand the timer when the Set
      // still contains a dead or despawned attacker.
      if (mobile !== state.player) return;
      const cycle = World.getProcessCycle();
      if (state.lastCycle === cycle) return;
      state.lastCycle = cycle;
      if (state.pendingArrivalAt && cycle >= state.pendingArrivalAt) {
        state.pendingArrivalAt = 0;
        state.arrivalTranscriptStarted = true;
        state.player.setAttribute(CAMP_ARRIVAL_STARTED, true);
        startTranscript(api, state.player, NpcIdentifiers.ELENA_3, PAGE,
          "sealing-the-underground-pass-attack-of-the-iorwerth-upon-killing-essyllt");
        return;
      }
      if (state.pendingEssylltAt && cycle >= state.pendingEssylltAt) {
        state.pendingEssylltAt = 0;
        startTranscript(api, state.player, NpcIdentifiers.ELENA_3, PAGE,
          "sealing-the-underground-pass-attack-of-the-iorwerth-upon-successfully-defending-the-dwarf-camp");
        return;
      }
      if (!state.defending || state.finished) return;
      for (const npc of state.attackers) {
        if (npc.getHitpoints?.() <= 0 || npc.getArea?.() !== this) state.attackers.delete(npc);
      }
      if (cycle >= state.endsAt) finishCampDefense(this, state);
      else if (cycle >= state.nextWaveAt && state.attackers.size < 3) spawnCampAttacker(this, state);
    }
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (this.isDestroyed()) campInstances.delete(this);
    }
  }

  class DwarvenCampAccessArea extends Area {
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (currentChapter(player) < 17 || currentChapter(player) > 19 || quest.isComplete(player)) return;
      if (player.getArea?.() instanceof DwarvenCampArea) return;
      ensureDwarvenCamp(player);
    }
  }

  function hasQuest(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }
  function requirementsMet(player) {
    return REQUIRED_QUESTS.every(([key]) => hasQuest(player, key)) &&
      REQUIRED_SKILLS.every(([skill]) => player.getSkillManager().getMaxLevel(skill) >= 70);
  }
  function explainRequirements(player) {
    for (const [key, name] of REQUIRED_QUESTS) if (!hasQuest(player, key)) {
      player.sendMessage(`You must have completed ${name} to start this quest.`);
    }
    for (const [skill, name] of REQUIRED_SKILLS) if (player.getSkillManager().getMaxLevel(skill) < 70) {
      player.sendMessage(`You need 70 ${name} to start this quest.`);
    }
  }
  function onStart(event) {
    if (event?.hook !== START_HOOK || !event.player || quest.isStarted(event.player)) return;
    if (!requirementsMet(event.player)) { explainRequirements(event.player); return; }
    quest.setStage(event.player, STAGE.STARTED);
  }
  function chapterFor(variant) {
    return CHAPTERS.findIndex((chapter) => variant === chapter || variant.startsWith(`${chapter}-`));
  }
  function postQuestVariant(event) {
    const entry = POST_QUEST_DIALOGUE[event?.definition?.getName?.()];
    if (!entry) return null;
    const [page, variant] = entry;
    const record = event.pages?.find((candidate) => candidate.page === page);
    return record?.variants?.includes(variant) ? { page, variant } : null;
  }
  function selectVariant(event) {
    const player = event?.player;
    if (!player) return null;
    if (quest.isComplete(player)) return postQuestVariant(event);
    const page = event.pages?.find((entry) => entry.page === PAGE);
    if (!page) return null;
    const value = quest.getStage(player);
    if (value === STAGE.NOT_STARTED) {
      if (event.definition?.getName?.() !== "Edmond" || !requirementsMet(player)) return null;
      return page.variants.includes("starting-out-talking-to-edmond")
        ? { page: PAGE, variant: "starting-out-talking-to-edmond" } : null;
    }
    const candidates = page.variants.map((variant) => ({ variant, chapter: chapterFor(variant) }))
      .filter((entry) => entry.chapter >= 0);
    if (!candidates.length) return null;
    const current = candidates.filter((entry) => entry.chapter === currentChapter(player));
    const selected = current.find((entry) => !entry.variant.includes("again")) ?? current[0] ?? candidates[0];
    return { page: PAGE, variant: selected.variant };
  }
  function currentChapter(player) {
    if (quest.isComplete(player)) return CHAPTERS.length - 1;
    const lateChapter = Number(player.getAttribute(LATE_CHAPTER));
    if (Number.isInteger(lateChapter) && lateChapter >= 19) return Math.min(lateChapter, 20);
    const value = quest.getStage(player);
    if (value >= STAGE.COMPLETE) return 18;
    // Stage is advanced by the transcript milestones below; cap it to the final chapter.
    return Math.min(CHAPTERS.length - 1, Math.max(0, Math.floor((value - STAGE.STARTED) / 10)));
  }
  function clearWarEndActors(player) {
    for (const npc of warEndActors.get(player) ?? []) api.removeNpc(npc);
    warEndActors.delete(player);
  }
  function ensureWarEndActors(player) {
    const done = player.getAttribute(WAR_END_ARIANWYN_DONE) === true;
    const actors = warEndActors.get(player) ?? [];
    if (actors.some(npc => npc.isRegistered?.())) return;
    clearWarEndActors(player);
    const definitions = done
      ? [
        { id: NpcIdentifiers.BAXTORIAN, x: 2240, y: 3265, z: 0 },
        { id: NpcIdentifiers.ELENA, x: 2242, y: 3265, z: 0 },
      ]
      : [{ id: NpcIdentifiers.ARIANWYN_6, x: 2242, y: 3265, z: 0 }];
    const spawned = definitions.map(definition => api.spawnNpc({ ...definition, wanderRadius: 0,
      owner: player, ownerOnly: true })).filter(Boolean);
    warEndActors.set(player, spawned);
  }
  function finishWarEndArianwynLine(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 20 || player.getAttribute(WAR_END_ARIANWYN_DONE) === true ||
      event.text !== "And I you. Farewell friend.") return;
    event.after = () => {
      player.setAttribute(WAR_END_ARIANWYN_DONE, true);
      clearWarEndActors(player);
      ensureWarEndActors(player);
    };
  }
  function finishDisguiseBriefing(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 1 || ![NpcIdentifiers.EDMOND, NpcIdentifiers.EDMOND_2].includes(event.npcId)) return;
    if (event.text?.startsWith("My wife should be able to help you with the tabard.")) {
      event.after = () => player.setAttribute(DISGUISE_BRIEFED, true);
    } else if (wearingDisguise(player) && event.text?.includes("Now get yourself down to the prison")) {
      event.after = () => setChapter(player, 2);
    }
  }
  function onPlayerLogout(event) {
    const player = event?.player;
    if (!player) return;
    clearWarEndActors(player);
    clearEarlyStoryActors(player);
    clearFallsActors(player);
    clearPreparationActors(player);
    const guide=player.getAttribute(LLETYA_GUIDE_NPC);if(guide)api.removeNpc(guide);player.setAttribute(LLETYA_GUIDE_NPC,null);
    const area = player.getAttribute(BATTLE_AREA);
    if (area instanceof ArdougneBattleArea) {
      if (!area.isDestroyed()) area.leave(player, true);
      player.setAttribute(BATTLE_AREA, null);
      player.moveTo(new Location(2537, 9745, 0));
    }
  }
  function onAction(event) {
    finishIncitement(event);
    if (handleEarlyStoryAction(event)) return;
    if (handlePreparationAction(event)) return;
    const player = event?.player;
    if (!player || quest.isComplete(player)) return;
    if (event.kind === "message" && event.stepId === "zc7ehX" && currentChapter(player) === 14) {
      player.setAttribute(YSGAWYN_RETURN_MEETING, true);
    }
    if (inLibrary(player) && event.action === "open_interface" && event.target === "An") {
      event.handled = true;
      const { CountdownTask, TaskManager } = api.core;
      TaskManager.submit(new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() !== false && inLibrary(player)) openLibraryTeleportMenu(player);
      }));
      return;
    }
    if (inLibrary(player) && event.action === "teleport" &&
      event.text === "The player is teleported to the central chamber.") {
      event.handled = true;
      player.moveTo(new Location(2623, 6144, 0));
      player.sendMessage("Seren's memory returns you to the central chamber of the Grand Library.");
      return;
    }
    const inventory = player.getInventory();
    if (event.stepId === "_moa2Q" && hasItems(player, [DISGUISE.STEEL_HELM, DISGUISE.RED_DYE])) {
      inventory.deleteNumber(DISGUISE.STEEL_HELM, 1);
      inventory.deleteNumber(DISGUISE.RED_DYE, 1);
      inventory.adds(DISGUISE.HELM, 1);
    } else if (event.stepId === "I5Jusz" && hasItems(player, [DISGUISE.STEEL_BODY, DISGUISE.TABARD])) {
      inventory.deleteNumber(DISGUISE.STEEL_BODY, 1);
      inventory.deleteNumber(DISGUISE.TABARD, 1);
      inventory.adds(DISGUISE.BODY, 1);
    } else if (["tNiXqt", "0nVxB-"].includes(event.stepId) && hasItems(player, [DISGUISE.SILK, DISGUISE.PURPLE_DYE])) {
      inventory.deleteNumber(DISGUISE.SILK, 1);
      inventory.deleteNumber(DISGUISE.PURPLE_DYE, 1);
    } else if (["Y45282", "bGd6H8"].includes(event.stepId) && !hasItems(player, [DISGUISE.TABARD])) {
      inventory.deleteNumber(DISGUISE.SILK, 1);
      inventory.deleteNumber(DISGUISE.PURPLE_DYE, 1);
      inventory.adds(DISGUISE.TABARD, 1);
    } else if (["QMXa3C", "taCC98"].includes(event.stepId)) {
      if (!CHEMICALS.some(id => inventory.getAmount(id) > 0) && inventory.getFreeSlots() < 1) {
        event.handled = true;
        player.sendMessage("Make room in your inventory before taking a chemical.");
        return;
      }
      if (event.stepId === "taCC98") {
        for (const id of CHEMICALS) inventory.deleteNumber(id, inventory.getAmount(id));
      }
      const chemical = Number(player.getAttribute(CHEMICAL_CHOICE)) || ItemIdentifiers.CLEAR_LIQUID;
      if (inventory.getAmount(chemical) === 0) inventory.adds(chemical, 1);
      player.setAttribute(CHEMICAL_CHOICE, 0);
      if (chemical === ItemIdentifiers.CLEAR_LIQUID && currentChapter(player) === 2) {
        player.setAttribute(ELENA_ESCAPE_PROGRESS, 24);
        player.getPacketSender().sendVarbit(9016, 24);
      }
    } else if (event.stepId === "PZ3EOG") {
      inventory.deleteNumber(ItemIdentifiers.CLEAR_LIQUID, 1);
      inventory.deleteNumber(SULPHURIC_ACID, 1);
      player.setAttribute(ELENA_ESCAPE_PROGRESS, 26);
      player.getPacketSender().sendVarbit(9016, 26);
    }
    if (FIRE_SUPPORT[event.stepId] && currentChapter(player) === 4 && wearingMourner(player)) {
      addResistanceSupport(player, FIRE_SUPPORT[event.stepId], `fire:${event.stepId}`);
    }
    if (event.kind === "message") {
      const itemByMessage = {
        "5Ndx0y": ItemIdentifiers.ODE_TO_ETERNITY,
        "eS601c": ItemIdentifiers.CRYSTAL_SEED_3,
        "0lNCRc": ItemIdentifiers.ELDER_CADANTINE,
        "edE31_": ItemIdentifiers.CRYSTAL_5,
        "_Q1RaJ": ItemIdentifiers.ORB_OF_LIGHT_5,
      };
      const itemId = itemByMessage[event.stepId];
      if (itemId) {
        if (inventory.getFreeSlots() > 0 && inventory.getAmount(itemId) === 0) {
          inventory.adds(itemId, 1);
          event.box = { items: [itemId] };
          if (itemId === ItemIdentifiers.ORB_OF_LIGHT_5 && currentChapter(player) === 14) {
            player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
          }
          if (itemId === ItemIdentifiers.ODE_TO_ETERNITY) {
            if (!player.getAttribute(FALLS_ORDER)) randomizeFallsOrder(player);
          }
        } else if (inventory.getFreeSlots() === 0) {
          event.handled = true;
          player.sendMessage("You need an empty inventory slot before you can take that.");
        }
      }
      if (event.stepId === "vh7Q_s") giveMeilyrClue(player, event);
      if (event.stepId === "ITn7ep") {
        if(currentChapter(player)===11 && player.getAttribute(TRAHAEARN_REPAIRED)!==true){
          inventory.deleteNumber(ItemIdentifiers.RUNITE_BAR,1);player.setAttribute(TRAHAEARN_REPAIRED,true);
          player.setAttribute(TRAHAEARN_CREVICE,5);player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,5);
        }
      }
      if (event.stepId === "koxQh3") player.setAttribute(REVELATIONS_MEETING_STARTED, true);
      if (event.stepId === "XhOxpi") {
        player.moveTo(new Location(2353, 3172, 0));
        setChapter(player, 15);
        startTranscript(api, player, NpcIdentifiers.MAWRTH_3, PAGE, "attack-on-lletya-a-village-on-fire");
      }
      if (event.stepId === "UNrb5z") recordElder(player, 1);
      if (event.stepId === "K9K0W4") recordElder(player, 2);
      const messageChapter = ACTION_CHAPTER[event.stepId];
      if (messageChapter !== undefined) setChapter(player, messageChapter);
      if (event.stepId === "U-Vihn") {
        player.setAttribute(ITHELL_RECRUITED, true);
        recordElder(player, 4);
        sendIthellMeilyrVarbits(player);
      }
      if (event.stepId === "S3ME_F") {
        inventory.deleteNumber(meilyrClueItem(player), 1);
        recordElder(player, 8);
        sendIthellMeilyrVarbits(player);
      }
      if (event.stepId === "gBRsQm") {
        if (inventory.getAmount(CAMP_EXPLOSIVE_ITEM) === 0 && inventory.getFreeSlots() < 1) {
          event.handled = true;
          player.sendMessage("You need one empty inventory slot for Elena's stackable explosive potions.");
          return;
        }
        if (inventory.getAmount(CAMP_EXPLOSIVE_ITEM) === 0) inventory.adds(CAMP_EXPLOSIVE_ITEM, 7);
        event.box = { items: [CAMP_EXPLOSIVE_ITEM] };
        player.setAttribute(CAMP_EXPLOSIVES, 7);
        player.sendMessage("You take seven explosive potions from Elena.");
      }
      return;
    }
    const chapter = ACTION_CHAPTER[event.stepId];
    if (chapter !== undefined && (event.stepId !== "jtPiC1" || wearingDisguise(player))) {
      setChapter(player, chapter);
    }
    if (event.stepId === "UeAKgA") {
      clearPreparationActors(player);
      player.moveTo(new Location(3050,4485,0));
      player.setAttribute(VALLEY_FIGURE, true);
      const figure = api.spawnNpc({ id: NpcIdentifiers.MYSTERIOUS_FIGURE, x: 3051, y: 4485, z: 0,
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (figure) PREPARATION_ACTORS.set(player,[figure]);
    }
    if (event.stepId === "v3r3p_") player.moveTo(new Location(2353, 3172, 0));
    if (event.stepId === "D1wXY6") {
      player.setAttribute(VALLEY_FIGURE, false);
      player.moveTo(new Location(2353, 3172, 0));
    }
    if (event.stepId === "o4CmGU") {
      // Baxtorian hands the Orb over during this narrated action. It is no
      // longer in the player's possession once Lord Iorwerth takes it.
      inventory.deleteNumber(ItemIdentifiers.ORB_OF_LIGHT_5, inventory.getAmount(ItemIdentifiers.ORB_OF_LIGHT_5));
      setChapter(player, 15);
    }
    if (event.stepId === "eIlh1C") {
      // The chapter was already entered earlier in this transcript, so its
      // stage write can be a no-op. Sync the newly earned native milestone now.
      player.setAttribute(LLETYA_TRAITOR_REVEALED, true);
      setChapter(player, 15);
      player.getPacketSender?.()?.sendVarbit(9016, nativeEarlyProgress(160, player));
    }
    if (event.stepId === "9yLw8T") setChapter(player, 15);
    if (event.stepId === "6nBDUf") setChapter(player, 16);
    if (event.stepId === "xfnkES") {
      event.handled = true;
      setChapter(player, 19);
      if (!startFragmentBattle(player)) player.setAttribute(TEMPLE_CUTSCENE_STARTED, false);
    }
    if (event.stepId === "YAPX-R") {
      event.handled = true;
      beginEssylltEncounter(player);
    }
    if (event.stepId === "vdBzNa") spawnPostEssylltArrival(player);
    if (event.stepId === "FK0kOz") {
      setChapter(player, 19);
      player.sendMessage("Lord Iorwerth and Arianwyn have entered the Temple of Light. Follow them through the Underground Pass.");
    }
    if (event.stepId === "yR9ETJ" && player.getAttribute(FRAGMENT_DEFEATED) === true) {
      setChapter(player, 20);
      player.moveTo(new Location(2241, 3266, 0));
      ensureWarEndActors(player);
      event.handled = true;
      event.steps = loadTranscripts(api)[PAGE]?.variants?.["the-war-s-end-arianwyn-atones"] ?? [];
    }
    if (event.stepId === "eOtNFO") setChapter(player, 12);
    if (event.stepId === "W-ainS") {
      if (player.getAttribute(FRAGMENT_DEFEATED) !== true || currentChapter(player) !== 20 ||
        player.getAttribute(WAR_END_ARIANWYN_DONE) !== true) {
        event.handled = true;
        player.sendMessage("Finish Arianwyn's farewell before speaking with Baxtorian to end the quest.");
        return;
      }
      quest.complete(player);
    }
  }

  function hefinPathIndex(point, goal = false) {
    if (point.x <= 2279 && point.y >= 3088 && point.y <= 3100) return HEFIN_STONE_ROUTE.length - 1;
    let best = -1;
    let distance = Infinity;
    for (let index = 0; index < HEFIN_STONE_ROUTE.length; index++) {
      const [x, y] = HEFIN_STONE_ROUTE[index];
      const next = Math.max(Math.abs(point.x - x), Math.abs(point.y - y));
      if (next < distance) {
        best = index;
        distance = next;
      }
    }
    return distance <= 1 ? best : -1;
  }

  function routeToLadyHefin(event) {
    const { player, destination } = event;
    if (quest.isComplete(player) || currentChapter(player) !== 14 ||
      player.getAttribute(HEFIN_CLUE_HEARD) !== true || player.getAttribute(HEFIN_CROSSING) === true) return;
    const source = player.getLocation();
    const from = hefinPathIndex({ x: source.getX(), y: source.getY() });
    const to = hefinPathIndex(destination, true);
    if (from < 0 || to < 0 || from === to) return;

    const { Animation, CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager || !Animation) return;
    event.handled = true;
    player.setAttribute(HEFIN_CROSSING, true);
    const movement = player.getMovementQueue();
    movement.reset();
    movement.walkToReset();
    movement.setBlockMovement(true);
    const direction = Math.sign(to - from);
    let index = from;
    const step = () => {
      if (player.isRegistered?.() === false || player.getHitpoints() <= 0) {
        player.setAttribute(HEFIN_CROSSING, false);
        movement.setBlockMovement(false);
        return;
      }
      if (index === to) {
        player.setAttribute(HEFIN_CROSSING, false);
        movement.setBlockMovement(false);
        movement.requestWalk(new Location(destination.x, destination.y, destination.z));
        return;
      }
      const [x, y] = HEFIN_STONE_ROUTE[index + direction];
      player.setPositionToFace(new Location(x, y, 0));
      player.performAnimation(new Animation(HEFIN_JUMP_ANIMATION));
      TaskManager.submit(new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false || player.getHitpoints() <= 0) {
          player.setAttribute(HEFIN_CROSSING, false);
          movement.setBlockMovement(false);
          return;
        }
        player.moveTo(new Location(x, y, 0));
        index += direction;
        TaskManager.submit(new CountdownTask(player, 1, step));
      }));
    };
    step();
  }

  function recordElder(player, bit) {
    const recruited = (Number(player.getAttribute(RECRUITED_ELDERS)) || 0) | bit;
    player.setAttribute(RECRUITED_ELDERS, recruited);
    player.getPacketSender?.()?.sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    syncCrwysTree(player);
    if ((recruited & 3) === 3 && currentChapter(player) === 14) {
      const arianwyn = player.getAttribute(LLETYA_ARIANWYN_NPC);
      if (arianwyn) api.removeNpc(arianwyn);
      player.setAttribute(LLETYA_ARIANWYN_NPC, null);
      setChapter(player, 14);
      player.sendMessage("Lord Crwys and Lady Hefin are on their way to Lletya. Return to Baxtorian for the next part of the plan.");
    }
    if ((recruited & 15) === 15 && currentChapter(player) === 16) {
      setChapter(player, 17);
      player.sendMessage("The clan elders are reunited. Return to Baxtorian and help the dwarves prepare to seal the Pass.");
    }
  }

  function sendIthellMeilyrVarbits(player) {
    const sender = player?.getPacketSender?.();
    if (!sender) return;
    const symbols = Number(player.getAttribute(ITHELL_SYMBOLS)) || 0;
    const ithell = player.getAttribute(ITHELL_RECRUITED) === true ? 4 :
      player.getAttribute(ITHELL_STATUE) === true ? 3 :
      symbols === 31 ? 2 : Number(player.getAttribute(ITHELL_CLUE_STAGE)) || 0;
    sender.sendVarbit(ITHELL_VARBIT, ithell);
    sender.sendVarbit(MEILYR_VARBIT, Number(player.getAttribute(MEILYR_CLUE)) || 0);
    for (let index = 0; index < ITHELL_SYMBOL_VARBITS.length; index++) {
      sender.sendVarbit(ITHELL_SYMBOL_VARBITS[index], symbols & (1 << index) ? 2 : ithell > 0 ? 1 : 0);
    }
  }

  function handleIthellSymbolExamine(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 16 || (Number(player.getAttribute(ITHELL_CLUE_STAGE)) || 0) < 1) return;
    // The client sends only the object ID for Examine. Validate it against the
    // nearby mapped symbol/marker and the player's current tile before using
    // that packet, so an Examine packet from elsewhere cannot grant a clue.
    const location = player.getLocation();
    const x = location?.getX?.();
    const y = location?.getY?.();
    const z = location?.getZ?.();
    const index = ITHELL_SYMBOLS_BY_TILE.findIndex((tile, i) => tile.z === z &&
      ITHELL_EXAMINE_MARKERS[i].has(event.objectId) &&
      Math.max(Math.abs(tile.x - x), Math.abs(tile.y - y)) <= 1);
    if (index < 0) return;
    // Older scenes may still expose the inactive symbol or only its wall marker.
    // Keep their nearby Examine fallback alongside the native active Touch loc.
    const proxyEvent = { player, objectId: ITHELL_SYMBOLS_BY_TILE[index].id,
      location: ITHELL_SYMBOLS_BY_TILE[index], option: "Touch", handled: false };
    if (touchIthellSymbol(proxyEvent)) {
      event.handled = true;
      player.sendMessage("You trace the glowing symbol on the wall and absorb its knowledge.");
    }
  }

  function ensureIthellSymbolObjects() {
    if (ithellSymbolsInstalled) return;
    ithellSymbolsInstalled = true;
    for (const symbol of ITHELL_SYMBOLS_BY_TILE) {
      const location = new Location(symbol.x, symbol.y, symbol.z);
      if (ObjectManager.objectsAt(location).some((object) =>
        object.getId() === symbol.id && !object.getPrivateArea?.())) continue;
      // The map export has none of the five quest locs. Add the cache-backed
      // Touch locs at the official Wiki/Quest Helper positions; each remains
      // gated by its own chapter-16 varbit and can only be absorbed once.
      ObjectManager.register(new GameObject(symbol.id, location, 10, 0, null), true);
    }
  }

  function meilyrClueItem(player) {
    const step = Number(player.getAttribute(MEILYR_CLUE)) || 1;
    return MEILYR_CLUE_ITEMS[Math.max(0, Math.min(3, step - 1))];
  }

  function restoreLegacyMeilyrClue({ player }) {
    if (currentChapter(player) !== 16 || !(Number(player.getAttribute(MEILYR_CLUE)) > 0) ||
      player.getAttribute(MEILYR_CLUE_ITEMS_MIGRATED) === true) return;
    const inventory = player.getInventory();
    if (inventory.getAmount(ItemIdentifiers.CLUE_SCROLL_HARD_) > 0 &&
      !MEILYR_CLUE_ITEMS.some((id) => inventory.getAmount(id) > 0)) {
      // Earlier saves used a generic hard clue for this earned quest item.
      inventory.deleteNumber(ItemIdentifiers.CLUE_SCROLL_HARD_, 1);
      inventory.adds(meilyrClueItem(player), 1);
    }
    player.setAttribute(MEILYR_CLUE_ITEMS_MIGRATED, true);
  }

  function readMeilyrClue(event) {
    const { player, itemId } = event;
    if (currentChapter(player) !== 16 || !MEILYR_CLUE_ITEMS.includes(itemId) ||
      player.getInventory().getAmount(itemId) === 0) return false;
    event.handled = true;
    // shortcut: the native paper-clue interface is not mapped; expose the
    // Wiki's landmark directions through the real cache item's Read action.
    player.sendMessage(MEILYR_CLUE_TEXT[MEILYR_CLUE_ITEMS.indexOf(itemId)]);
    return true;
  }

  function giveMeilyrClue(player, event) {
    if (currentChapter(player) !== 16) return;
    const inventory = player.getInventory();
    const itemId = meilyrClueItem(player);
    if (inventory.getAmount(itemId) === 0) {
      if (inventory.getFreeSlots() < 1) {
        if (event) event.handled = true;
        player.sendMessage("You need an empty inventory slot before you can take the clue scroll.");
        return false;
      }
      inventory.adds(itemId, 1);
      if (event) event.box = { items: [itemId] };
    }
    player.setAttribute(MEILYR_CLUE, Math.max(1, Number(player.getAttribute(MEILYR_CLUE)) || 0));
    player.setAttribute(MEILYR_CLUE_ITEMS_MIGRATED, true);
    sendIthellMeilyrVarbits(player);
    return true;
  }

  function touchIthellSymbol(event) {
    const player = event?.player;
    if (!player || String(event.option ?? "").toLowerCase() !== "touch" || quest.isComplete(player) || currentChapter(player) !== 16 ||
      (Number(player.getAttribute(ITHELL_CLUE_STAGE)) || 0) < 1) return false;
    const location = event.location ?? event.object?.getLocation?.();
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const z = location?.z ?? event.sourceLocation?.z ?? location?.getZ?.();
    const symbol = ITHELL_SYMBOLS_BY_TILE.find((entry) => entry.x === x && entry.y === y && entry.z === z &&
      (entry.id === event.objectId || [35878, 35879].includes(event.objectId)));
    if (!symbol) return false;
    event.handled = true;
    const index = ITHELL_SYMBOLS_BY_TILE.indexOf(symbol);
    const bit = 1 << index;
    const mask = Number(player.getAttribute(ITHELL_SYMBOLS)) || 0;
    if ((mask & bit) !== 0) {
      player.sendMessage("You have already absorbed the knowledge from this symbol.");
      return true;
    }
    const next = mask | bit;
    player.setAttribute(ITHELL_SYMBOLS, next);
    if (next === 31) {
      player.setAttribute(ITHELL_CLUE_STAGE, 2);
      startTranscript(api, player, 0, PAGE, "after-the-attack-finding-lady-ithell-touching-the-final-symbol");
    } else {
      startTranscript(api, player, 0, PAGE, "after-the-attack-finding-lady-ithell-touching-the-symbols");
    }
    sendIthellMeilyrVarbits(player);
    return true;
  }

  function buildIthellStatue(event) {
    const player = event?.player;
    const location = event?.location;
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const z = location?.z ?? location?.getZ?.();
    if (!player || !["build", "construct"].includes(String(event.option ?? "").toLowerCase()) || currentChapter(player) !== 16 ||
      (Number(player.getAttribute(ITHELL_CLUE_STAGE)) || 0) < 2 || !ITHELL_WELL_IDS.has(event.objectId) ||
      x !== 2337 || ![3170, 3171].includes(y) || z !== 0) return false;
    event.handled = true;
    if (player.getAttribute(ITHELL_STATUE) === true) {
      player.sendMessage("The statue is already complete.");
      return true;
    }
    const inventory = player.getInventory();
    if (inventory.getAmount(ItemIdentifiers.LIMESTONE_BRICK) < 8 ||
      inventory.getAmount(ItemIdentifiers.SAW) < 1 || inventory.getAmount(ItemIdentifiers.HAMMER) < 1) {
      player.sendMessage("You need a saw, a hammer, and eight limestone bricks to build Lady Ithell's statue.");
      return true;
    }
    inventory.deleteNumber(ItemIdentifiers.LIMESTONE_BRICK, 8);
    player.setAttribute(ITHELL_STATUE, true);
    sendIthellMeilyrVarbits(player);
    const area = player.getArea?.();
    if (area instanceof LletyaStoryArea) area.process(player);
    player.sendMessage("You build Lady Ithell's statue from the plans. Speak to Kelyn.");
    return true;
  }

  function handleMeilyrDig(event) {
    const player = event?.player;
    if (!player || event.itemId !== ItemIdentifiers.SPADE || quest.isComplete(player) ||
      currentChapter(player) !== 16 || player.getInventory().getAmount(meilyrClueItem(player)) === 0) return false;
    const location = player.getLocation();
    const x = location?.getX?.();
    const y = location?.getY?.();
    const step = Number(player.getAttribute(MEILYR_CLUE)) || 0;
    const spot = MEILYR_DIG_SPOTS[step - 1];
    if (!spot || x !== spot.x || y !== spot.y || location?.getZ?.() !== 0) return false;
    event.handled = true;
    player.performAnimation?.(new api.core.Animation(831));
    const next = Math.min(4, step + 1);
    player.getInventory().deleteNumber(meilyrClueItem(player), 1);
    player.setAttribute(MEILYR_CLUE, next);
    player.getInventory().adds(meilyrClueItem(player), 1);
    sendIthellMeilyrVarbits(player);
    player.sendMessage(spot.message);
    return true;
  }

  function handleMeilyrSpin(event) {
    const player = event?.player;
    if (!player || event.sequence !== 2107 || currentChapter(player) !== 16 || (Number(player.getAttribute(MEILYR_CLUE)) || 0) < 4 ||
      player.getInventory().getAmount(meilyrClueItem(player)) === 0) return;
    const loc = player.getLocation();
    if (Math.abs(loc.getX() - 2309) > 1 || Math.abs(loc.getY() - 3215) > 1 || loc.getZ() !== 0) return;
    if (player.getEquipment().getItems().some((item) => item && item.getId() > 0 && item.getAmount() > 0)) {
      player.sendMessage("You need to remove all your equipment before following the final clue.");
      return;
    }
    player.setAttribute(MEILYR_CLUE, 5);
    sendIthellMeilyrVarbits(player);
    ensureMeilyrAtPass(player);
    player.sendMessage("You spin by the Underground Pass entrance and hear a voice answer the final clue.");
    return true;
  }

  function ensureMeilyrAtPass(player) {
    const npc = player.getAttribute(MEILYR_FFION_NPC);
    if (npc?.isRegistered?.()) return npc;
    const ffion = api.spawnNpc({ id: NpcIdentifiers.LADY_FFION_MEILYR, x: 2311, y: 3215, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (ffion) player.setAttribute(MEILYR_FFION_NPC, ffion);
    return ffion;
  }

  function setChapter(player, chapter) {
    if (chapter < currentChapter(player)) return;
    if (chapter >= 19) {
      // Stage 200 is the cache completion value; retain stage 190 through the
      // final battle and store its late chapters separately.
      quest.setStage(player, 190);
      player.setAttribute(LATE_CHAPTER, chapter);
      return;
    }
    player.setAttribute(LATE_CHAPTER, 0);
    quest.setStage(player, Math.max(10, STAGE.STARTED + chapter * 10));
  }
  function claimArianwynAfterLibrary(event) {
    const player = event?.player;
    if (!player) return false;
    const chapter = currentChapter(player);
    if ([8,9,10,11].includes(chapter)) {
      event.handled=true;
      return onTalk({...event,definition:{getName:()=> "Arianwyn"}});
    }
    if (chapter === 15) {
      event.handled = true;
      if (player.getAttribute(LLETYA_TRAITOR_REVEALED) !== true) {
        player.sendMessage("You need to find Eoin and Iona and learn why Lord Iorwerth has come to Lletya.");
        return true;
      }
      if (player.getAttribute(LLETYA_ARIANWYN_CONFRONTED) === true) {
        player.sendMessage("Arianwyn stands in your way. Prepare to fight.");
        return startArianwynBattle(player);
      }
      return startTranscript(api, player, event.npcId, PAGE, "attack-on-lletya-confronting-the-traitor");
    }
    if (chapter !== 13) return false;
    event.handled = true;
    return startTranscript(api, player, event.npcId, PAGE,
      "reporting-back-after-the-revelations-the-curse-of-seren");
  }

  function searchLletyaChild(event) {
    const player = event?.player;
    const { objectId, location } = event ?? {};
    if (!player || currentChapter(player) !== 15 || !location || String(event.option ?? "").toLowerCase() !== "search") return false;
    const children = { ...(player.getAttribute(LLETYA_CHILDREN) ?? {}) };
    if (objectId === ObjectIdentifiers.TABLE_75 && location.x === 2340 && location.y === 3158 && location.z === 0) {
      event.handled = true;
      if (children.eoin) {
        player.sendMessage("Eoin has already escaped from the table.");
        return true;
      }
      if (startTranscript(api, player, NpcIdentifiers.EOIN_2, PAGE, "attack-on-lletya-a-village-on-fire-finding-eoin")) {
        children.eoin = true;
        player.setAttribute(LLETYA_CHILDREN, children);
        player.getPacketSender?.()?.sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
      }
      return true;
    }
    const isIonaPot = [ObjectIdentifiers.COOKING_POTS, ObjectIdentifiers.COOKING_POTS_2].includes(objectId) &&
      ((location.x === 2338 && location.y === 3157) || (location.x === 2339 && location.y === 3156)) && location.z === 1;
    if (!isIonaPot) return false;
    event.handled = true;
    if (!children.eoin) {
      player.sendMessage("You hear movement in the pots upstairs, but should search the table downstairs first.");
      return true;
    }
    if (children.iona) {
      player.sendMessage("Iona has already climbed out of the cooking pots.");
      return true;
    }
    if (startTranscript(api, player, NpcIdentifiers.IONA_2, PAGE, "attack-on-lletya-a-village-on-fire-finding-iona")) {
      children.iona = true;
      player.setAttribute(LLETYA_CHILDREN, children);
      player.getPacketSender?.()?.sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
      player.sendMessage("Take the children back to Mawrth in the village square.");
    }
    return true;
  }

  function examineLletyaChild(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 15) return;
    const targets = [
      { id: ObjectIdentifiers.TABLE_75, x: 2340, y: 3158, z: 0 },
      { id: ObjectIdentifiers.COOKING_POTS_2, x: 2338, y: 3157, z: 1 },
      { id: ObjectIdentifiers.COOKING_POTS, x: 2339, y: 3156, z: 1 },
    ];
    const location = player.getLocation();
    const target = targets.find((tile) => tile.id === event.objectId &&
      location.getZ() === tile.z && Math.max(Math.abs(location.getX() - tile.x), Math.abs(location.getY() - tile.y)) <= 1);
    if (!target) return;
    const object = api.core.MapObjects.get(target.id, new Location(target.x, target.y, target.z), player.getPrivateArea?.());
    if (!object) return;
    event.handled = true;
    searchLletyaChild({
      player, object, objectId: target.id, location: target, option: "Search", handled: false,
    });
  }

  function handleLletyaConfrontationLine(event) {
    if (!event?.player || currentChapter(event.player) !== 15 || event.text !== "So be it." ||
      String(event.definition?.getName?.() ?? "").toLowerCase() !== "arianwyn") return;
    event.after = () => {
      const player = event.player;
      if (currentChapter(player) !== 15 || player.getAttribute(LLETYA_TRAITOR_REVEALED) !== true ||
        player.getAttribute(LLETYA_ARIANWYN_CONFRONTED) === true) return;
      player.setAttribute(LLETYA_ARIANWYN_CONFRONTED, true);
      startArianwynBattle(player);
    };
  }

  function cleanupTransferredOrb({ player } = {}) {
    if (!player || currentChapter(player) < 15 || player.getAttribute(LLETYA_TRAITOR_REVEALED) !== true) return;
    const inventory = player.getInventory?.();
    const amount = inventory?.getAmount?.(ItemIdentifiers.ORB_OF_LIGHT_5) ?? 0;
    if (amount > 0) inventory.deleteNumber(ItemIdentifiers.ORB_OF_LIGHT_5, amount);
  }

  function campElenaSupplySteps(player, steps) {
    const canTake = player.getInventory().getAmount(CAMP_EXPLOSIVE_ITEM) > 0 || player.getInventory().getFreeSlots() > 0;
    return steps.flatMap(step => {
      // Resolve these two branches before another quest's global inventory-prose hook can claim them.
      if (["P2yzxj", "eU_IkG"].includes(step.id)) {
        return (step.id === "eU_IkG") === canTake ? campElenaSupplySteps(player, step.steps ?? []) : [];
      }
      const copy = { ...step };
      if (step.steps) copy.steps = campElenaSupplySteps(player, step.steps);
      if (step.options) copy.options = step.options.map(option => ({ ...option,
        steps: campElenaSupplySteps(player, option.steps ?? []) }));
      return [copy];
    });
  }

  function onTalk(event) {
    const player = event?.player;
    if (!player) return false;
    const npcName = resistanceCitizenName(event).toLowerCase();
    if (quest.getStage(player) === STAGE.NOT_STARTED) {
      if (npcName !== "edmond") return false;
      if (!requirementsMet(player)) { explainRequirements(player); return true; }
      return startTranscript(api, player, event.npcId, PAGE, "starting-out-talking-to-edmond");
    }
    if (quest.isComplete(player)) return false;
    if (player.getArea?.() instanceof ArdougneBattleArea && ["elena", "councillor halgrive"].includes(npcName)) {
      player.sendMessage("Defeat the enemy soldiers before continuing with the resistance.");
      return true;
    }
    if (currentChapter(player) === 15 && npcName === "mawrth") {
      const children = player.getAttribute(LLETYA_CHILDREN) ?? {};
      if (!children.eoin || !children.iona) {
        return startTranscript(api, player, event.npcId, PAGE, "attack-on-lletya-a-village-on-fire");
      }
      if (player.getAttribute(LLETYA_TRAITOR_REVEALED) === true) return false;
      return startTranscript(api, player, NpcIdentifiers.LORD_IORWERTH_2, PAGE,
        "attack-on-lletya-lord-iorwerth-arrives");
    }
    if (currentChapter(player) === 15 && npcName === "arianwyn") {
      if (player.getAttribute(LLETYA_TRAITOR_REVEALED) !== true) {
        player.sendMessage("You need to find Eoin and Iona and learn why Lord Iorwerth has come to Lletya.");
        return true;
      }
      if (player.getAttribute(LLETYA_ARIANWYN_CONFRONTED) === true) {
        player.sendMessage("Arianwyn stands in your way. Prepare to fight.");
        return startArianwynBattle(player);
      }
      return startTranscript(api, player, event.npcId, PAGE, "attack-on-lletya-confronting-the-traitor");
    }
    const camp = player.getArea?.() instanceof DwarvenCampArea ? player.getArea() : null;
    const campState = camp && campInstances.get(camp);
    if (npcName === "elena" && campState?.finished) {
      if (player.getAttribute(CAMP_BATTLE) === true) {
        if (player.getAttribute(CAMP_ARRIVAL_STARTED) !== true && !campState.arrivalTranscriptStarted && !campState.pendingArrivalAt) {
          campState.pendingArrivalAt = World.getProcessCycle() + 2;
        } else if (player.getAttribute(CAMP_ARRIVAL_STARTED) === true || campState.arrivalTranscriptStarted) {
          player.sendMessage("The elven leaders have gone into the Temple of Light. Follow them through the Underground Pass.");
        }
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE,
        "sealing-the-underground-pass-attack-of-the-iorwerth-upon-successfully-defending-the-dwarf-camp");
    }
    if (currentChapter(player) === 13 && npcName === "arianwyn") {
      return startTranscript(api, player, event.npcId, PAGE,
        "reporting-back-after-the-revelations-the-curse-of-seren");
    }
    if (currentChapter(player) === 13 && npcName === "baxtorian") {
      const afterMeeting = player.getAttribute(REVELATIONS_MEETING_STARTED) === true;
      if (afterMeeting) setChapter(player, 14);
      const variant = afterMeeting
        ? "reporting-back-after-the-revelations-talking-to-baxtorian-after-the-meeting"
        : "reporting-back-after-the-revelations-dialogue-with-npcs-post-library-visit-talking-to-baxtorian";
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if (currentChapter(player) === 14 && npcName === "lord piquan crwys" &&
      player.getAttribute(CRWYS_CLUE_HEARD) === true) {
      player.sendMessage("Chop the tree at the end of the old trail to reveal Lord Crwys.");
      return true;
    }
    if (currentChapter(player) === 14 && ["elf hermit", "lady carys hefin"].includes(npcName) &&
      player.getAttribute(HEFIN_CLUE_HEARD) === true &&
      Math.abs((event.location?.x ?? 0) - 2276) <= 3 && Math.abs((event.location?.y ?? 0) - 3094) <= 3) {
      return startTranscript(api, player, event.npcId, PAGE,
        "reporting-back-after-the-revelations-finding-lady-hefin");
    }
    if (currentChapter(player) === 14 && npcName === "baxtorian") {
      // The meeting advances the quest into chapter 14 before its two clue
      // choices are made. If a player closes the dialogue at that point,
      // resume those choices instead of skipping straight to the orb chapter.
      if (player.getAttribute(CRWYS_CLUE_HEARD) !== true ||
        player.getAttribute(HEFIN_CLUE_HEARD) !== true) {
        return startTranscript(api, player, event.npcId, PAGE,
          "reporting-back-after-the-revelations-talking-to-baxtorian-after-the-meeting");
      }
      const hasOrb = player.getInventory().getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) > 0;
      return startTranscript(api, player, event.npcId, PAGE, hasOrb
        ? "recovering-the-orb-talking-to-baxtorian-after-getting-the-orb"
        : "recovering-the-orb-ysgawyn-returns");
    }
    if (currentChapter(player) === 14 && npcName === "elena" &&
      player.getInventory().getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) > 0) {
      if (player.getAttribute(YSGAWYN_TRACK_STEP) == null) player.setAttribute(YSGAWYN_TRACK_STEP, 0);
      player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
      return startTranscript(api, player, event.npcId, PAGE, "recovering-the-orb-talking-to-elena");
    }
    if (currentChapter(player) === 14 && npcName === "ysgawyn" &&
      player.getInventory().getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) > 0) {
      if (Number(player.getAttribute(YSGAWYN_TRACK_STEP) ?? 0) < 7) {
        player.sendMessage("Follow the trail from the mushrooms, rocks and lamp before confronting Ysgawyn.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, "recovering-the-orb-confronting-ysgawyn");
    }
    if (npcName === "baxtorian" && currentChapter(player) === 17) {
      const wasAtCamp = player.getArea?.() instanceof DwarvenCampArea;
      ensureDwarvenCamp(player);
      return startTranscript(api, player, event.npcId, PAGE, wasAtCamp
        ? "preparations-at-the-dwarf-camp-talking-to-baxtorian"
        : "preparations-at-the-dwarf-camp-talking-to-baxtorian-at-lletya");
    }
    if (npcName === "baxtorian" && currentChapter(player) === 19 &&
      player.getAttribute(CAMP_DEFENSE_COMPLETE) === true &&
      player.getAttribute(FRAGMENT_DEFEATED) !== true && !(player.getArea?.() instanceof DwarvenCampArea)) {
      ensureDwarvenCamp(player);
      player.sendMessage("Baxtorian leads you back to the dwarven camp to face Essyllt.");
      return true;
    }
    if (npcName === "elena" && currentChapter(player) === 17 && player.getArea?.() instanceof DwarvenCampArea) {
      if (!player.getInventory().getAmount(CAMP_EXPLOSIVE_ITEM)) {
        if (player.getInventory().getFreeSlots() < 1) {
          player.sendMessage("Make one inventory space so Elena can hand you the stackable explosive potions.");
          return true;
        }
      }
      return startTranscript(api, player, event.npcId, PAGE, "preparations-at-the-dwarf-camp-talking-to-elena-after-talking-to-baxtorian",
        steps => campElenaSupplySteps(player, steps));
    }
    if (npcName === "baxtorian" && currentChapter(player) === 18 && player.getArea?.() instanceof DwarvenCampArea) {
      if ((Number(player.getAttribute(CAMP_HOLES)) || 0) !== 127) {
        player.sendMessage("Fill all seven holes with Elena's explosive potions before the final meeting.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, "preparations-at-the-dwarf-camp-a-final-meeting");
    }
    if (npcName === "lord ieuan amlodd" && player.getArea?.() instanceof GrandLibraryArea) {
      const area = player.getArea();
      area.leave(player, false);
      player.setAttribute(LIBRARY_INSTANCE, null);
      player.moveTo(new Location(2353, 3172, 0));
      player.sendMessage("Lord Ieuan guides you back to Lletya. You can return to the library when you are ready.");
      return true;
    }
    if (["elena", "councillor halgrive"].includes(npcName) && [4, 5].includes(currentChapter(player))) {
      const enoughSupport = resistanceSupport(player) >= 80;
      return startTranscript(api, player, event.npcId, PAGE, enoughSupport
        ? "vive-la-ardougne-r-volution-talking-to-elena-or-councillor-halgrive"
        : "meet-the-ardougne-resistance-planning-a-revolution-talking-to-elena-before-recruiting-enough-people",
        steps => steps.map(step => ({ ...step, text: step.text?.replace("[number]", String(resistanceSupport(player))).replace("[number]", String(80 - resistanceSupport(player))) })));

    }
    if ((npcName === "elena" || npcName === "councillor halgrive") && currentChapter(player) === 6 &&
      (Number(player.getAttribute(WEST_BATTLE_KILLS)) || 0) >= 21) {
      return startTranscript(api, player, event.npcId, PAGE, "battle-of-two-ardougnes-west-ardougne-returning-to-base");
    }
    if (currentChapter(player) === 4 && Object.keys(CITIZEN_SUPPORT).some((name) => name.toLowerCase() === npcName)) {
      const aliases = {
        "nurse sarah": "retraining-nurse-sarah",
        chadwell: "taxing-chadwell-the-general-store-owner",
        "town crier": "talking-to-the-town-crier",
        bartender: "taxing-the-bar",
        probita: "taxing-the-pet-insurance-bureau",
        "doctor orbon": "retraining-doctor-orbon",
        "silk merchant": "taxing-the-silk-merchant",
        "western baker": "taxing-the-western-baker",
        "eastern baker": "taxing-the-eastern-baker",
        "silver merchant": "taxing-the-silver-merchant",
        "gem merchant": "taxing-the-gem-merchant",
        "fur trader": "taxing-the-fur-merchant",
        "spice seller": "taxing-the-spice-seller",
        zenesha: "taxing-zenesha-the-armour-store-owner",
        aemad: "taxing-aemad-or-kortan-the-general-store-owners",
        kortan: "taxing-aemad-or-kortan-the-general-store-owners",
        richard: "taxing-richard",
        "priest": event.npc?.getLocation?.()?.getX?.() >= 2570
          ? "east-ardougne-taxing-the-priest" : "west-ardougne-taxing-the-priest",
      };
      const match = aliases[npcName] ?? (npcName === "estate agent"
        ? "taxing-the-estate-agent" : `taxing-${npcName.replace(/[^a-z0-9]+/g, "-")}`);
      const variant = Object.keys(loadTranscripts(api)[PAGE]?.variants ?? {})
        .find((name) => name.startsWith("causing-an-insurrection-") && name.endsWith(match));
      if (variant) return startTranscript(api, player, event.npcId, PAGE, variant,
        steps => incitementSteps(steps, variant.includes("-west-ardougne-")));
    }
    if (npcName === "king thoros" && quest.getStage(player) === STAGE.STARTED) {
      // In this world state Thoros occupies the post-quest castle throne room;
      // use the Lathas transcript only while the player is beginning SOTE.
      quest.setStage(player, 20);
      return startTranscript(api, player, event.npcId, PAGE, "talking-to-the-king");
    }
    if (npcName === "king lathas") {
      const variant = quest.getStage(player) === STAGE.STARTED
        ? "talking-to-the-king"
        : "talking-to-the-king-talking-to-him-again";
      if (quest.getStage(player) === STAGE.STARTED) quest.setStage(player, 20);
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if (npcName === "elena" && currentChapter(player) === 2) {
      if (Number(player.getAttribute(ELENA_ESCAPE_PROGRESS)) === 26) {
        return startTranscript(api, player, event.npcId, PAGE, "freeing-elena-returning-to-elena", elenaEscapeReminder);
      }
      const inventory = player.getInventory();
      const hasChemical = CHEMICALS.some((id) => inventory.getAmount(id) > 0) || inventory.getAmount(SULPHURIC_ACID) > 0;
      return startTranscript(api, player, event.npcId, PAGE,
        hasChemical ? "freeing-elena-returning-to-elena"
          : Number(player.getAttribute(ELENA_ESCAPE_PROGRESS)) >= 22
            ? "freeing-elena-talking-to-elena-again" : "freeing-elena-talking-to-elena");
    }
    if(currentChapter(player)===11 && npcName==="lady tangwen trahaearn" && player.getAttribute(TRAHAEARN_REPAIRED)===true && !(Number(player.getAttribute(PREPARATION_ELDERS))&2))return startTranscript(api,player,event.npcId,PAGE,"preparing-to-enter-prifddinas-finding-lady-trahaearn-repairing-the-exoskeleton",steps=>steps.slice(1));
    if(currentChapter(player)===11 && ["elena","arianwyn","baxtorian","eluned"].includes(npcName))return talkPreparation(event,npcName);
    if (currentChapter(player) === 20 && npcName === "arianwyn" && player.getAttribute(WAR_END_ARIANWYN_DONE) === true) {
      player.sendMessage("Arianwyn has left the elven lands. Baxtorian is waiting by the gates of Prifddinas.");
      return true;
    }
    if (currentChapter(player) === 20 && npcName === "baxtorian" &&
      player.getAttribute(FRAGMENT_DEFEATED) === true &&
      player.getAttribute(WAR_END_ARIANWYN_DONE) === true) {
      return startTranscript(api, player, event.npcId, PAGE, "the-war-s-end-prifddinas-reformed");
    }
    if (currentChapter(player) === 16 && npcName === "lady ffion meilyr") {
      if (!player.getInventory().getAmount(meilyrClueItem(player))) {
        player.sendMessage("Ask Baxtorian for Lady Meilyr's clue scroll before following it.");
        return true;
      }
      if ((Number(player.getAttribute(MEILYR_CLUE)) || 0) < 5) {
        player.sendMessage("Follow the three marked locations, then spin by the Underground Pass entrance.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, "after-the-attack-finding-lady-meilyr");
    }
    if (currentChapter(player) === 16 && npcName === "lady kelyn ithell") {
      if (player.getAttribute(ITHELL_STATUE) !== true) {
        player.sendMessage("Finish the statue using the five symbols' design before speaking to Kelyn.");
        return true;
      }
      if (player.getAttribute(ITHELL_RECRUITED) === true) {
        player.sendMessage("Lady Ithell is already on her way to the Underground Pass.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, "after-the-attack-finding-lady-ithell-her-greatest-work");
    }
    if (currentChapter(player) === 16 && npcName === "baxtorian") {
      const variant = player.getInventory().getAmount(meilyrClueItem(player)) > 0
        ? "after-the-attack-talking-to-baxtorian-talking-to-baxtorian-again"
        : "after-the-attack-talking-to-baxtorian";
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if (currentChapter(player) === 11 && npcName === "lord ieuan amlodd" && player.getAttribute(VALLEY_FIGURE) === true) {
      player.setAttribute(VALLEY_FIGURE, false);
      player.moveTo(new Location(2353, 3172, 0));
      return startTranscript(api, player, event.npcId, PAGE,
        "preparing-to-enter-prifddinas-a-mysterious-figure-talking-to-lord-amlodd-once-he-is-in-lletya");
    }
    if (npcName === "edmond" && currentChapter(player) >= 3) {
      return startTranscript(api, player, event.npcId, PAGE,
        "freeing-elena-telling-edmond-the-good-news-talking-to-him-again");
    }
    if (npcName === "edmond" && currentChapter(player) === 2) {
      if (Number(player.getAttribute(ELENA_ESCAPE_PROGRESS)) !== 26) {
        return startTranscript(api, player, event.npcId, PAGE,
          "making-a-knightly-disguise-talking-to-edmond-after-completing-the-disguise-talking-to-him-again-2");
      }
      quest.setStage(player, STAGE.STARTED + 30);
      return startTranscript(api, player, event.npcId, PAGE, "freeing-elena-telling-edmond-the-good-news");
    }
    if ((npcName === "knight of ardougne" || npcName === "ardougne knight" || npcName === "guard") && currentChapter(player) === 2) {
      const variant = "freeing-elena-talking-to-the-knight-of-ardougne";
      return startTranscript(api, player, event.npcId, PAGE, variant);
    }
    if ((npcName === "knight of ardougne" || npcName === "ardougne knight" || npcName === "guard") && currentChapter(player) === 1) {
      if (!wearingDisguise(player)) {
        return startTranscript(api, player, event.npcId, PAGE,
          "talking-to-the-king-talking-to-the-knight-of-ardougne-talking-to-knight-without-knight-armour");
      }
      quest.setStage(player, STAGE.STARTED + 20);
      return startTranscript(api, player, event.npcId, PAGE, "freeing-elena-upon-entering-the-prison");
    }
    if (["martha rehnison", "ted rehnison", "milli rehnison"].includes(npcName) && currentChapter(player) === 3) {
      const variants = {
        "martha rehnison": "meet-the-ardougne-resistance-the-rehnisons-talking-to-martha-or-ted-rehnison",
        "ted rehnison": "meet-the-ardougne-resistance-the-rehnisons-talking-to-martha-or-ted-rehnison-again",
        "milli rehnison": "meet-the-ardougne-resistance-the-rehnisons-talking-to-milli-rehnison",
      };
      return startTranscript(api, player, event.npcId, PAGE, variants[npcName]);
    }
    if (["elena", "councillor halgrive"].includes(npcName) && currentChapter(player) === 3 &&
      player.getLocation().getY() > 9700) {
      return startTranscript(api, player, event.npcId, PAGE,
        "meet-the-ardougne-resistance-planning-a-revolution-entering-the-hidden-basement");
    }
    if (currentChapter(player) === 7 && Number(player.getAttribute(EAST_BATTLE_KILLS)) === 15 &&
      ["elena", "councillor halgrive"].includes(npcName)) {
      const scene = Number(player.getAttribute(KING_SCENE_PROGRESS)) || 0;
      if (scene===0) ensureCapturedKing(player);
      return startTranscript(api, player, event.npcId, PAGE, scene === 2 ? "face-to-face-with-lord-iorwerth"
        : scene === 1 ? "battle-of-two-ardougnes-killing-of-a-king" : "battle-of-two-ardougnes-it-s-treason-then",
        scene === 0 ? kingQuestionSteps : undefined);
    }
    if (currentChapter(player) === 8 && npcName === "arianwyn") {
      if (Number(player.getAttribute(FIRST_MEETING_PROGRESS)) > 0) {
        player.sendMessage("Fetch Ysgawyn from the upper platforms and Elena from the pond for Arianwyn's meeting.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, "retreating-to-lletya");
    }
    if (currentChapter(player) === 8 && npcName === "ysgawyn") {
      if (Number(player.getAttribute(FIRST_MEETING_PROGRESS)) < 1) return false;
      return startTranscript(api, player, event.npcId, PAGE, "retreating-to-lletya-fetching-ysgawyn");
    }
    if (currentChapter(player) === 8 && npcName === "elena") {
      if (Number(player.getAttribute(FIRST_MEETING_PROGRESS)) < 2) {
        player.sendMessage("Fetch Ysgawyn for the meeting first.");
        return true;
      }
      return startTranscript(api, player, event.npcId, PAGE, "retreating-to-lletya-fetching-elena");
    }
    if (currentChapter(player) === 9 && npcName === "arianwyn") {
      return startTranscript(api, player, event.npcId, PAGE, "the-first-meeting-the-first-meeting-begins");
    }
    if (currentChapter(player)===10 && npcName==="arianwyn" && player.getLocation().getY()<4000) {
      return startTranscript(api,player,event.npcId,PAGE,"the-first-meeting-talking-to-arianwyn-after-the-meeting");
    }
    if (currentChapter(player)===10 && npcName==="baxtorian") {
      if (Number(player.getAttribute(FALLS_PILLARS))!==63) return false;
      return startTranscript(api,player,event.npcId,PAGE,"visiting-baxtorian-falls-baxtorian-lives");
    }
    const chapterName = CHAPTERS[currentChapter(player)];
    if (npcName === "edmond" && currentChapter(player) === 1) {
      const hasDisguise = wearingDisguise(player);
      if (player.getAttribute(DISGUISE_BRIEFED) !== true) {
        return startTranscript(api, player, event.npcId, PAGE,
          "making-a-knightly-disguise-talking-to-edmond-after-completing-the-disguise");
      }
      const variant = hasDisguise
        ? "making-a-knightly-disguise-talking-to-edmond-after-completing-the-disguise-2"
        : "making-a-knightly-disguise-talking-to-edmond-after-completing-the-disguise-talking-to-him-again";
      return startTranscript(api, player, event.npcId, PAGE,
        variant);
    }
    const alias = ({ "king lathas": "king", "ted rehnison": "martha-or-ted", "martha rehnison": "martha-or-ted" })[npcName] ?? npcName.replace(/[^a-z0-9]+/g, "-");
    const variants = Object.keys(loadTranscripts(api)[PAGE]?.variants ?? {});
    const candidates = variants.filter((variant) => variant.startsWith(`${chapterName}-`) && variant.includes(alias));
    const selected = candidates.find((variant) => variant.includes("talking-to") && !variant.includes("again")) ??
      candidates.find((variant) => variant.includes("talking-to")) ?? candidates[0];
    return selected ? startTranscript(api, player, event.npcId, PAGE, selected) : false;
  }

  function handleYsgawynTrackExamine(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || currentChapter(player) !== 14 ||
      player.getInventory().getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) <= 0) return;
    const step = Number(player.getAttribute(YSGAWYN_TRACK_STEP) ?? 0);
    const clue = YSGAWYN_TRACKS[step];
    if (!clue || event.objectId !== clue.id) return;
    const location = player.getLocation();
    if (location.getZ() !== 0 || Math.max(Math.abs(location.getX() - clue.x), Math.abs(location.getY() - clue.y)) > 5) return;
    event.handled = true;
    player.setAttribute(YSGAWYN_TRACK_STEP, step + 1);
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    player.sendMessage(clue.clue);
    if (step + 1 === YSGAWYN_TRACKS.length) {
      player.sendMessage("The tracks lead through the tripwire into a clearing to the north-west.");
    }
  }

  function processYsgawynTrail({ player }) {
    if (!player || quest.isComplete(player) || currentChapter(player) !== 14 ||
      Number(player.getAttribute(YSGAWYN_TRACK_STEP) ?? 0) !== YSGAWYN_TRACKS.length) return;
    const location = player.getLocation();
    if (location.getZ() !== 0 || location.getX() < 2253 || location.getX() > 2258 ||
      location.getY() < 3166 || location.getY() > 3170) return;
    player.setAttribute(YSGAWYN_TRACK_STEP, YSGAWYN_TRACKS.length + 1);
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    player.sendMessage("You follow the final tracks through the tripwire and find Ysgawyn in the clearing.");
  }

  function routeYsgawynLeafTrap(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player) || currentChapter(player) !== 14 ||
      player.getInventory().getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) <= 0 ||
      ![3923, 3924, 3925].includes(event.objectId)) return;
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1]?.toLowerCase();
    if (option !== "jump") return;
    const source = event.sourceLocation;
    if (!source) return;
    const inside = source.x >= 2273 && source.x <= 2275 && source.y >= 3173 && source.y <= 3175;
    const beside = source.x >= 2271 && source.x <= 2277 && source.y >= 3171 && source.y <= 3177;
    if (inside || !beside) return;
    // Keep the normal Regicide Jump handler's source side intact. Without this
    // route stop, pathfinding walks onto the multi-tile trap before its Agility
    // handler runs, so it cannot tell which edge the player approached.
    event.destination = { x: source.x, y: source.y, z: source.z };
  }

  function onCrwysTreeInteraction(event) {
    const player = event?.player;
    const action = event?.definition?.getActions?.()?.[event.clickType - 1];
    const npc = event?.npc;
    const spawn = npc?.getSpawnPosition?.();
    const spawnX = spawn?.getX?.() ?? event?.location?.x;
    const spawnY = spawn?.getY?.() ?? event?.location?.y;
    const id = npc?.getContentId?.(player) ?? event?.npcId;
    if (!player || currentChapter(player) !== 14 ||
      player.getAttribute(CRWYS_CLUE_HEARD) !== true ||
      id !== NpcIdentifiers.COL_00FFFF_TREE_COL_2 ||
      !/^(chop down|chop)$/i.test(String(action ?? "")) ||
      Math.abs((spawnX ?? 0) - 2176) > 2 || Math.abs((spawnY ?? 0) - 3211) > 2) return false;
    event.handled = true;
    if (!findBestUsableAxe(player)) {
      player.sendMessage("You need an axe to chop through Lord Crwys's tree disguise.");
      return true;
    }
    player.getPacketSender().sendVarbit(CRWYS_TREE_TRANSFORM_VARBIT, 2);
    return startTranscript(api, player, NpcIdentifiers.LORD_PIQUAN_CRWYS, PAGE,
      "reporting-back-after-the-revelations-finding-lord-crwys");
  }

  function syncCrwysTree(player) {
    if (!player?.getPacketSender) return;
    const recruited = Number(player.getAttribute(RECRUITED_ELDERS)) || 0;
    const transform = (recruited & 1) !== 0 ? 2 :
      currentChapter(player) === 14 && player.getAttribute(CRWYS_CLUE_HEARD) === true ? 1 : 0;
    player.getPacketSender().sendVarbit(CRWYS_TREE_TRANSFORM_VARBIT, transform);
  }

  function hasItems(player, ids) {
    const inventory = player.getInventory();
    return ids.every((id) => inventory.getAmount(id) > 0);
  }

  function equippedId(player, slot) {
    return player.getEquipment().get(slot)?.getId?.();
  }

  function wearingDisguise(player) {
    return equippedId(player, Equipment.HEAD_SLOT) === DISGUISE.HELM &&
      equippedId(player, Equipment.BODY_SLOT) === DISGUISE.BODY &&
      [DISGUISE.STEEL_LEGS, DISGUISE.LEGS].includes(equippedId(player, Equipment.LEG_SLOT));
  }

  function wearingMourner(player) {
    return MOURNER_OUTFIT.every(([slot, id]) => equippedId(player, slot) === id);
  }

  function resistanceSupport(player) {
    return Number(player.getAttribute(RESISTANCE_MEMBERS)) || 0;
  }

  function addResistanceSupport(player, amount, key) {
    const completed = new Set(String(player.getAttribute(INCITEMENTS) ?? "").split(",").filter(Boolean));
    if (completed.has(key)) return;
    completed.add(key);
    player.setAttribute(INCITEMENTS, [...completed].join(","));
    player.setAttribute(RESISTANCE_MEMBERS, Math.min(80, resistanceSupport(player) + amount));
    syncResistanceProgress(player);
    if (resistanceSupport(player) >= 80 && currentChapter(player) === 4) {
      player.sendMessage("The resistance has recruited 80 people. Report back to Elena.");
    }
  }

  function resistanceCitizenName(event) {
    const name = String(event.definition?.getName?.() ?? "");
    if (name !== "Baker") return name;
    if (event.npcId === NpcIdentifiers.BAKER_2) return "Western baker";
    if (event.npcId === NpcIdentifiers.BAKER_3) return "Eastern baker";
    return name;
  }
  function incitementSteps(steps, west) {
    return steps.map(step => {
      if (step.type === "choice") return { ...step, options: step.options.map(option => ({ ...option,
        steps: incitementSteps(option.steps ?? [], west) })) };
      if (step.type !== "condition") return step;
      const correctOutfit = step.text.startsWith("If the player is wearing ") && step.text.includes(west ? "wearing a mourner's outfit" : "wearing Knight of Ardougne armour");
      return { ...step, steps: correctOutfit ? [
        ...step.steps.filter(entry => entry.type !== "end"),
        { type: "action", action: "recruit-resistance" }, { type: "end" },
      ] : step.steps };
    });
  }
  function recordIncitement(event) {
    const text = String(event.text ?? "");
    if (text.includes("not wearing a mourner's outfit")) return !wearingMourner(event.player);
    if (text.includes("wearing Knight of Ardougne armour")) return wearingDisguise(event.player);
    if (text.includes("wearing a mourner's outfit")) return wearingMourner(event.player);
    if (text.includes("not wearing either")) return !wearingDisguise(event.player) && !wearingMourner(event.player);
    return null;
  }
  function finishIncitement(event) {
    const player = event?.player;
    if (event.action !== "recruit-resistance" || !player || currentChapter(player) !== 4) return;
    event.handled = true;
    const name = resistanceCitizenName(event);
    const loc = event.npc?.getSpawnPosition?.() ?? event.npc?.getLocation?.() ?? player.getLocation();
    const x = loc.getX(), y = loc.getY(), west = x < 2570;
    if (x < 2430 || x > 2700 || y < 3250 || y > 3400 || !(west ? wearingMourner(player) : wearingDisguise(player))) return;
    const amount = CITIZEN_SUPPORT[name];
    if (!amount) return;
    const citizen = ["Aemad", "Kortan"].includes(name) ? "general-store" : name.toLowerCase();
    addResistanceSupport(player, amount, `npc:${west ? "west" : "east"}:${citizen}`);
  }

  function disguiseCondition(event) {
    if (event.stepId === "H43Lmv") return wearingDisguise(event.player);
    if (event.stepId === "H5jIPU") return event.player.getSkillManager().getMaxLevel(Skill.DEFENCE) >= 5;
    if (event.stepId === "bQLjI3") return event.player.getSkillManager().getMaxLevel(Skill.DEFENCE) < 5;
    if (event.stepId === "kiR0oJ") return hasItems(event.player, [DISGUISE.SILK, DISGUISE.PURPLE_DYE]);
    if (event.stepId === "Ne_wSN") {
      return event.player.getInventory().getAmount(ItemIdentifiers.CLEAR_LIQUID) > 0 ||
        event.player.getInventory().getAmount(SULPHURIC_ACID) > 0;
    }
    if (event.stepId === "IqvKw7") {
      return CHEMICALS.some((id) => id !== ItemIdentifiers.CLEAR_LIQUID && event.player.getInventory().getAmount(id) > 0);
    }
    if (event.stepId === "3T9hP1") {
      return CHEMICALS.every((id) => event.player.getInventory().getAmount(id) === 0);
    }
    if (event.stepId === "_iv2oi") {
      return CHEMICALS.some((id) => event.player.getInventory().getAmount(id) > 0);
    }
    return null;
  }

  function handleDialogueChoice(event) {
    if (!event?.player) return;
    const player = event.player;
    const npcName = String(event.definition?.getName?.() ?? "").toLowerCase();
    if (currentChapter(player) === 8 && npcName === "elena") {
      if (event.option === "Go ahead.") player.setAttribute(ELENA_PRE_MEETING_RESPONSE, "asked");
      else if (event.option === "Maybe later.") player.setAttribute(ELENA_PRE_MEETING_RESPONSE, "later");
      else if (player.getAttribute(ELENA_PRE_MEETING_RESPONSE) === "asked" && [
        "I care about helping people.", "People reward me for helping them.",
        "I need to fix my mistakes.", "It's my duty to help people.", "I don't know.",
      ].includes(event.option)) player.setAttribute(ELENA_PRE_MEETING_RESPONSE, "full");
    }
    if (player.getAttribute(ORB_CAVE_ENTRY_PENDING) === true && currentChapter(player) === 14 &&
      event.npcId === NpcIdentifiers.IORWERTH_WARRIOR_9) {
      if (event.option === "No.") {
        player.setAttribute(ORB_CAVE_ENTRY_PENDING, null);
        return;
      }
      if (event.option === "Yes.") {
        player.setAttribute(ORB_CAVE_ENTRY_PENDING, null);
        enterOrbSupplyCaveAfterConfirmation(player);
        return;
      }
    }
    if(currentChapter(event.player)===11 && event.option==="How do I find Lady Trahaearn?") {
      event.player.setAttribute(TRAHAEARN_CREVICE,1);event.player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,1);
    }
    if (event.option === "Yes" && currentChapter(event.player) === 12 &&
      String(event.definition?.getName?.() ?? "").toLowerCase() === "lord ieuan amlodd") {
      if (event.player.getInventory().getFreeSlots() < 6) {
        event.player.sendMessage("You need at least six free inventory spaces before entering the Grand Library.");
        return;
      }
      const player = event.player;
      ensureLibraryInstance(player);
      player.moveTo(new Location(2623, 6144, 0));
      player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
      player.sendMessage("You enter the Grand Library. Its doors seal behind you; find the Seal of the Forgotten in the central chamber.");
      return;
    }
    if (currentChapter(event.player) === 14 &&
      String(event.definition?.getName?.() ?? "").toLowerCase() === "baxtorian") {
      if (event.option === "How do I find Lord Crwys?") {
        event.player.setAttribute(CRWYS_CLUE_HEARD, true);
        syncCrwysTree(event.player);
      }
      if (event.option === "How do I find Lady Hefin?") event.player.setAttribute(HEFIN_CLUE_HEARD, true);
    }
    if (currentChapter(event.player) === 16 &&
      String(event.definition?.getName?.() ?? "").toLowerCase() === "baxtorian") {
      if (event.option === "What's Lady Ithell's clue?") {
        event.player.setAttribute(ITHELL_CLUE_STAGE, Math.max(1, Number(event.player.getAttribute(ITHELL_CLUE_STAGE)) || 0));
        sendIthellMeilyrVarbits(event.player);
      } else if (event.option === "What's Lady Meilyr's clue?") {
        // The message action gives the scroll, and this exact choice is a safe
        // fallback for clients that don't forward the nested message action.
        giveMeilyrClue(event.player);
      }
    }
    if (event.option === "I'm ready." && currentChapter(event.player) === 18 &&
      String(event.definition?.getName?.() ?? "").toLowerCase() === "baxtorian") {
      const player = event.player;
      const area = ensureDwarvenCamp(player);
      const holes = Number(player.getAttribute(CAMP_HOLES)) || 0;
      if (holes !== 127) {
        player.sendMessage(`The dwarves are not ready. You have filled ${holes} of the seven explosive holes.`);
        return;
      }
      spawnCampNpc(area, NpcIdentifiers.LORD_IORWERTH_2, 2448, 6110);
      const state = campInstances.get(area);
      if (state) state.meetingPending = true;
      return;
    }
    if (event.option === "Climb through it." && [3, 4, 5, 6].includes(currentChapter(event.player))) {
      const loc = event.player.getLocation();
      if (loc.getX() >= 2522 && loc.getX() <= 2541 && loc.getY() >= 3320 && loc.getY() <= 3344) {
        event.player.moveTo(new Location(2537, 9745, 0));
        if (currentChapter(event.player) === 3) event.player.setAttribute(RESISTANCE_BRIEFING, true);
        event.player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(event.player), event.player));
      }
      return;
    }
    const chemical = {
      "The thin blue liquid.": ItemIdentifiers.BLUE_LIQUID,
      "The light green powder.": ItemIdentifiers.GREEN_POWDER,
      "The thick clear liquid.": ItemIdentifiers.CLEAR_LIQUID,
      "The dark red powder.": ItemIdentifiers.RED_POWDER,
    }[event.option];
    if (!chemical || currentChapter(event.player) !== 2) return;
    event.player.setAttribute(CHEMICAL_CHOICE, chemical);
  }

  function ensureLibraryInstance(player) {
    const current = player.getArea?.();
    if (current instanceof GrandLibraryArea && !current.isDestroyed()) {
      ensureLibraryMemories(player, current);
      return current;
    }
    const username = player.getUsername?.();
    const area = new GrandLibraryArea(username);
    libraryInstances.set(username, area);
    player.setAttribute(LIBRARY_INSTANCE, area);
    area.enter(player);
    const guide = api.spawnNpc({ id: NpcIdentifiers.LORD_IEUAN_AMLODD, x: 2625, y: 6144, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (guide) area.enter(guide);
    ensureLibraryMemories(player, area);
    return area;
  }

  function syncLibraryLogin({ player }) {
    if (!player || quest.isComplete(player) || ![12, 13].includes(currentChapter(player))) return;
    const location = player.getLocation();
    if (location.getX() < 2548 || location.getX() > 2690 ||
      location.getY() < 6078 || location.getY() > 6220 ||
      location.getZ() < 0 || location.getZ() > 2) return;
    ensureLibraryInstance(player);
  }

  function inLibrary(player) {
    return player?.getArea?.() instanceof GrandLibraryArea;
  }

  function librarySealMask(player) {
    return Number(player?.getAttribute(LIBRARY_SEALS)) || 0;
  }

  function hasForgottenMemory(player) {
    const mask = librarySealMask(player);
    // Preserve older legitimate saves where another seal bit was already set
    // before the Forgotten-seal gate was enforced.
    return (mask & 1) !== 0 || (mask & ~1) !== 0;
  }

  function ensureLibraryMemories(player, area) {
    if (!area || !hasForgottenMemory(player)) return;
    let actors = LIBRARY_MEMORY_ACTORS.get(player);
    if (!actors) LIBRARY_MEMORY_ACTORS.set(player, actors = new Map());
    const unlocked = [{ id: NpcIdentifiers.MEMORY_OF_SEREN, tile: [2623, 6135, 1], bit: 0 },
      ...LIBRARY_SEAL_DATA.map((seal, index) => ({ id: seal.memory, tile: seal.tile, bit: index + 1 }))]
      .filter(({ bit }) => (librarySealMask(player) & (1 << bit)) !== 0);
    for (const { id, tile, bit } of unlocked) {
      const existing = actors.get(id);
      if (existing?.area === area) continue;
      const npc = api.spawnNpc({ id, x: tile[0], y: tile[1], z: tile[2],
        wanderRadius: 0, owner: player, ownerOnly: true });
      if (!npc) continue;
      area.enter(npc);
      actors.set(id, npc);
    }
  }

  function talkToLibraryMemory({ player, npcId }) {
    if (!player || !inLibrary(player) || !hasForgottenMemory(player)) return false;
    let name = "the-forgotten";
    if (npcId !== NpcIdentifiers.MEMORY_OF_SEREN) {
      const index = LIBRARY_SEAL_DATA.findIndex((seal) => seal.memory === npcId);
      if (index < 0 || !(librarySealMask(player) & (1 << (index + 1)))) return false;
      name = LIBRARY_SEAL_DATA[index].name;
    }
    const variant = `the-grand-library-of-prifddinas-the-seal-of-${name}`;
    const memory = loadTranscripts(api)[PAGE].variants[variant]
      .filter(step => step.type === "line" && step.text.startsWith("'"));
    // The export loses this jump's target; generic "Yes please" matching loops back into itself.
    return startTranscript(api, player, npcId, PAGE,
      `${variant}-talking-to-the-memory-again`, steps => steps.map(step => step.type !== "choice" ? step : {
        ...step, options: step.options.map(option => option.text !== "Yes please." ? option : {
          ...option, steps: option.steps.flatMap(entry => entry.type === "jump" && entry.reference === "above" ? memory : [entry]),
        }),
      }));
  }

  function openLibraryTeleportMenu(player, offset = 0) {
    const destinations = [{ name: "The Forgotten seal", tile: [2623, 6135, 1], arrival: [2623, 6134, 1], bit: 0 },
      ...LIBRARY_SEAL_DATA.map((seal, index) => ({
        name: `The Seal of ${seal.name[0].toUpperCase()}${seal.name.slice(1)}`,
        tile: seal.tile, arrival: LIBRARY_MEMORY_ARRIVALS[index], bit: index + 1,
      }))];
    const visible = destinations.slice(offset, offset + 3);
    const choices = visible.flatMap((destination) => [destination.name, () => {
      if (!(librarySealMask(player) & (1 << destination.bit))) {
        player.sendMessage("I can only take you to a seal which has already been broken.");
        return;
      }
      const area = ensureLibraryInstance(player);
      area.enter(player);
      player.moveTo(new Location(...destination.arrival));
      player.sendMessage("The Memory of Seren carries you to the unlocked seal.");
    }]);
    if (offset + visible.length < destinations.length) choices.push("More...", () => openLibraryTeleportMenu(player, offset + 3));
    choices.push("Stay here.", () => {});
    api.sendMultiChatboxPrompt(player, "Where would you like to go?", ...choices);
  }

  function currentLibrarySeal(player) {
    if (!hasForgottenMemory(player)) return -1;
    const completed = librarySealMask(player);
    return LIBRARY_SEAL_DATA.findIndex((_, index) => !(completed & (1 << (index + 1))));
  }

  function libraryPuzzleState(player) {
    const [seal, step] = String(player.getAttribute(LIBRARY_PUZZLE) ?? "0:0").split(":").map(Number);
    return { seal: Number.isInteger(seal) ? seal : 0, step: Number.isInteger(step) ? step : 0 };
  }

  function libraryPillarState(player) {
    try { return JSON.parse(String(player.getAttribute(LIBRARY_PILLAR_STATE) || "{}")); }
    catch { return {}; }
  }
  function resetLibraryPuzzle(player, sealIndex) {
    player.setAttribute(LIBRARY_PUZZLE, `${sealIndex}:0`);
    player.setAttribute(LIBRARY_PILLAR_STATE, "{}");
  }

  function beamReaches(previous, location, area, placements) {
    const direction = previous?.operation === "fractured" ? "fractured" :
      (LIBRARY_OPERATIONS[previous?.operation] ?? previous?.direction);
    if (!previous || !location || !direction) return true;
    const { x, y, z } = previous;
    const dx = location.x - x;
    const dy = location.y - y;
    const dz = location.z - z;
    let step;
    switch (direction) {
      case "east": if (dz === 0 && dy === 0 && dx > 0) step = [1, 0, 0]; break;
      case "west": if (dz === 0 && dy === 0 && dx < 0) step = [-1, 0, 0]; break;
      case "north": if (dz === 0 && dx === 0 && dy > 0) step = [0, 1, 0]; break;
      case "south": if (dz === 0 && dx === 0 && dy < 0) step = [0, -1, 0]; break;
      case "up": if (dx === 0 && dy === 0 && dz > 0) step = [0, 0, 1]; break;
      case "down": if (dx === 0 && dy === 0 && dz < 0) step = [0, 0, -1]; break;
      // A fractured crystal sends light down both branches; the next mirror
      // must be on one of those rays. Its own direction is checked afterward.
      case "fractured":
        if (dz === 0 && dx !== 0 && dy === 0) step = [Math.sign(dx), 0, 0];
        else if (dz === 0 && dy !== 0 && dx === 0) step = [0, Math.sign(dy), 0];
        break;
    }
    if (!step) return false;
    for (let x = previous.x + step[0], y = previous.y + step[1], z = previous.z + step[2];
      x !== location.x || y !== location.y || z !== location.z;
      x += step[0], y += step[1], z += step[2]) {
      // A placed mirror/crystal intercepts the outgoing beam. Ground walking
      // collision is unrelated: the puzzle's light travels above scenery.
      if (Object.values(placements ?? {}).some((placed) =>
        placed.x === x && placed.y === y && placed.z === z)) return false;
    }
    return true;
  }

  // Keep every numbered solution honest, including the independent cyan and
  // blue rays that branch away from a route's last mirror. This runs at plugin
  // load so a bad later-puzzle source cannot survive until a full live replay.
  function validateLibraryRoutes() {
    for (const seal of LIBRARY_SEAL_DATA) {
      if (seal.steps.length !== seal.targets.length) {
        throw new Error(`Incomplete ${seal.name} light-puzzle route: every operation needs a pillar.`);
      }
      const placements = {};
      for (let step = 0; step < seal.steps.length; step++) {
        const operation = seal.steps[step];
        const [x, y, z] = seal.targets[step] ?? [];
        if ((!LIBRARY_OPERATIONS[operation] && !Object.hasOwn(LIBRARY_CRYSTAL_ITEMS, operation)) ||
          !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
          throw new Error(`Invalid ${seal.name} light-puzzle step ${step + 1}.`);
        }
        const branch = seal.branches?.[step];
        const previous = branch?.fromStep !== undefined
          ? Object.values(placements).find((placed) => placed.step === branch.fromStep) ?? null
          : branch?.source
            ? { x: branch.source[0], y: branch.source[1], z: branch.source[2], direction: branch.direction }
            : Object.values(placements).at(-1) ?? {
              x: seal.source[0], y: seal.source[1], z: seal.source[2], direction: seal.sourceDirection,
            };
        const key = `${x},${y},${z}`;
        if (Object.hasOwn(placements, key) || !beamReaches(previous, { x, y, z }, null, placements)) {
          throw new Error(`Unreachable ${seal.name} light-puzzle step ${step + 1}; check its independent beam source.`);
        }
        placements[key] = {
          operation,
          direction: LIBRARY_OPERATIONS[operation] ?? previous?.direction ?? "",
          x, y, z, step,
        };
      }
    }
  }
  validateLibraryRoutes();

  function dispenserCollect(event) {
    const player = event?.player;
    if (!player || !inLibrary(player) || quest.isComplete(player)) return false;
    if (!hasForgottenMemory(player)) {
      event.handled = true;
      player.sendMessage("Touch the Seal of the Forgotten and receive its memory before collecting another seal's puzzle tools.");
      return true;
    }
    const sealIndex = currentLibrarySeal(player);
    if (sealIndex < 0) return false;
    event.handled = true;
    const inventory = player.getInventory();
    const seal = LIBRARY_SEAL_DATA[sealIndex];
    const mirrors = seal.steps.filter((step) => LIBRARY_OPERATIONS[step]).length;
    const colors = seal.steps.filter((step) => LIBRARY_CRYSTAL_ITEMS[step]);
    const supplies = [[ItemIdentifiers.HAND_MIRROR_2, mirrors], ...[...new Set(colors)].map((color) =>
      [LIBRARY_CRYSTAL_ITEMS[color], colors.filter((entry) => entry === color).length])];
    const neededSlots = supplies.filter(([id, amount]) => inventory.getAmount(id) < amount).length;
    if (inventory.getFreeSlots() < neededSlots) {
      player.sendMessage(`You need ${neededSlots} free inventory spaces to collect the ${seal.name} puzzle tools.`);
      return true;
    }
    for (const [id, amount] of supplies) {
      const missing = amount - inventory.getAmount(id);
      if (missing > 0) inventory.adds(id, missing);
    }
    player.setAttribute(LIBRARY_MIRRORS, mirrors);
    player.setAttribute(LIBRARY_CRYSTALS, colors.join(","));
    player.setAttribute(LIBRARY_PUZZLE, `${sealIndex}:0`);
    player.setAttribute(LIBRARY_PILLAR_STATE, "{}");
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    player.sendMessage(`You collect ${mirrors} hand mirrors and the crystals needed to direct light to the Seal of ${seal.name[0].toUpperCase()}${seal.name.slice(1)}.`);
    return true;
  }

  function isLibraryPillar(player, objectId, location, seal) {
    if (!inLibrary(player) || !location || !seal) return false;
    const definition = api.core.ObjectDefinition?.forPlayer?.(objectId, player);
    const cacheName = definition?.getName?.() ?? definition?.name;
    // The item-on-object hook already selected the visible Pillar of Light
    // name. Static library locs can have a different raw map id from their
    // resolved menu variant, so do not require that variant id to equal the
    // map object's parent id here; the exact seal route validates the tile.
    return cacheName === "Pillar of Light" || LIBRARY_PILLAR_IDS.has(objectId);
  }

  function submitLibraryOperation(player, sealIndex, operation, location) {
    const seal = LIBRARY_SEAL_DATA[sealIndex];
    const state = libraryPuzzleState(player);
    if (currentLibrarySeal(player) !== sealIndex || state.seal !== sealIndex || state.step >= seal.steps.length) return;
    const target = seal.targets?.[state.step];
    if (target && (!location || target[0] !== location.x || target[1] !== location.y || target[2] !== location.z)) {
      resetLibraryPuzzle(player, sealIndex);
      player.sendMessage("The light has reached a different pillar. Return to the numbered route and direct it from the correct pillar.");
      return;
    }
    if (seal.steps[state.step] !== operation) {
      resetLibraryPuzzle(player, sealIndex);
      player.sendMessage("The light scatters. The seal's mirror sequence has reset; follow the beam from its source and try again.");
      return;
    }
    const next = state.step + 1;
    if (location) {
      const key = `${location.x},${location.y},${location.z}`;
      const placements = libraryPillarState(player);
      if (Object.hasOwn(placements, key)) {
        resetLibraryPuzzle(player, sealIndex);
        player.sendMessage("The beam returns to a mirror you have already placed. The seal's route resets; use a fresh pillar for each turn.");
        return;
      }
      const branch = seal.branches?.[state.step];
      const previous = branch?.fromStep !== undefined
        ? Object.values(placements).find((placed) => placed.step === branch.fromStep) ?? null
        : branch?.source
          ? { x: branch.source[0], y: branch.source[1], z: branch.source[2], direction: branch.direction }
          : Object.values(placements).at(-1) ?? (seal.source ? {
            x: seal.source[0], y: seal.source[1], z: seal.source[2], direction: seal.sourceDirection,
          } : null);
      if (!beamReaches(previous, location, player.getArea(), placements)) {
        resetLibraryPuzzle(player, sealIndex);
        player.sendMessage("The beam cannot reach that pillar from the previous mirror. The seal's route resets; follow the lit beam to the next pillar.");
        return;
      }
      placements[key] = { operation, direction: LIBRARY_OPERATIONS[operation] ?? previous?.direction ?? "", x: location.x, y: location.y, z: location.z, step: state.step };
      player.setAttribute(LIBRARY_PILLAR_STATE, JSON.stringify(placements));
    }
    player.setAttribute(LIBRARY_PUZZLE, `${sealIndex}:${next}`);
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    player.sendMessage(next === seal.steps.length
      ? `The beam reaches the Seal of ${seal.name[0].toUpperCase()}${seal.name.slice(1)}. Touch it to receive the memory.`
      : "The light bends along the passage. Follow its new direction to the next pillar.");
  }

  function useLibraryMirror(event) {
    const player = event?.player;
    if (!player || !inLibrary(player)) return false;
    if (!hasForgottenMemory(player)) {
      event.handled = true;
      player.sendMessage("The Forgotten seal must be touched before you can direct light to the clan seals.");
      return true;
    }
    const sealIndex = currentLibrarySeal(player);
    if (sealIndex < 0) return false;
    const seal = LIBRARY_SEAL_DATA[sealIndex];
    const state = libraryPuzzleState(player);
    const loc = event.location;
    // A library pillar is commonly a transformed loc. The generic item-on-
    // object event retains the raw parent id in objectId; its definition is
    // the visible cache variant the player actually used.
    const visibleObjectId = event.definition?.id ??
      api.core.ObjectDefinition?.forPlayer?.(event.objectId, player)?.id ?? event.objectId;
    if (!isLibraryPillar(player, visibleObjectId, loc, seal)) return false;
    if (state.seal !== sealIndex || !LIBRARY_OPERATIONS[seal.steps[state.step]]) {
      player.sendMessage("This pillar is not where the current beam needs to be redirected.");
      return true;
    }
    if (player.getInventory().getAmount(ItemIdentifiers.HAND_MIRROR_2) < 1) {
      player.sendMessage("You need a hand mirror from the crystal dispenser.");
      return true;
    }
    const choose = (direction) => {
      const current = libraryPuzzleState(player);
      if (current.seal !== sealIndex) return;
      player.getInventory().deleteNumber(ItemIdentifiers.HAND_MIRROR_2, 1);
      submitLibraryOperation(player, sealIndex, LIBRARY_DIRECTIONS[direction], loc);
    };
    api.sendMultiChatboxPrompt(player, "Which direction should the mirror face?",
      "Reflect east", () => choose("east"),
      "Reflect south", () => choose("south"),
      "Reflect west", () => choose("west"),
      "Reflect north", () => choose("north"),
      "More directions...", () => api.sendMultiChatboxPrompt(player, "Choose a vertical direction.",
        "Reflect up", () => choose("up"),
        "Reflect down", () => choose("down"),
        "Back", () => useLibraryMirror(event)));
    event.handled = true;
    return true;
  }

  function useLibraryCrystal(event) {
    const player = event?.player;
    if (!player || !inLibrary(player)) return false;
    if (!hasForgottenMemory(player)) {
      event.handled = true;
      player.sendMessage("The Forgotten seal must be touched before you can direct light to the clan seals.");
      return true;
    }
    const color = Object.keys(LIBRARY_CRYSTAL_ITEMS).find((name) => LIBRARY_CRYSTAL_ITEMS[name] === event.itemId);
    const sealIndex = currentLibrarySeal(player);
    if (!color || sealIndex < 0) return false;
    const seal = LIBRARY_SEAL_DATA[sealIndex];
    const state = libraryPuzzleState(player);
    if (!isLibraryPillar(player, event.objectId, event.location, seal)) return false;
    if (state.seal !== sealIndex || seal.steps[state.step] !== color) {
      player.sendMessage("The crystal colour does not match the light at this pillar.");
      event.handled = true;
      return true;
    }
    player.getInventory().deleteNumber(event.itemId, 1);
    submitLibraryOperation(player, sealIndex, color, event.location);
    event.handled = true;
    return true;
  }

  function touchLibrarySeal(event) {
    const player = event?.player;
    if (!player || !inLibrary(player)) return false;
    const completed = Number(player.getAttribute(LIBRARY_SEALS)) || 0;
    if (event.objectId === ObjectIdentifiers.SEAL_OF_THE_FORGOTTEN) {
      if (completed & 1) return startTranscript(api, player, NpcIdentifiers.MEMORY_OF_SEREN, PAGE,
        "the-grand-library-of-prifddinas-the-seal-of-the-forgotten-talking-to-the-memory-again");
      player.setAttribute(LIBRARY_SEALS, completed | 1);
      player.setAttribute(LIBRARY_MIRRORS, null);
      player.setAttribute(LIBRARY_CRYSTALS, null);
      resetLibraryPuzzle(player, 0);
      ensureLibraryMemories(player, player.getArea());
      player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
      return startTranscript(api, player, NpcIdentifiers.MEMORY_OF_SEREN, PAGE, "the-grand-library-of-prifddinas-the-seal-of-the-forgotten");
    }
    const index = LIBRARY_SEAL_DATA.findIndex((seal) => seal.id === event.objectId || seal.mapId === event.objectId);
    if (index < 0) return false;
    if (!hasForgottenMemory(player)) {
      event.handled = true;
      player.sendMessage("The Forgotten seal's memory must be received first.");
      return true;
    }
    const seal = LIBRARY_SEAL_DATA[index];
    if (completed & (1 << (index + 1))) {
      return startTranscript(api, player, seal.memory, PAGE, `the-grand-library-of-prifddinas-the-seal-of-${seal.name}`);
    }
    const state = libraryPuzzleState(player);
    if (currentLibrarySeal(player) !== index || state.seal !== index || state.step < seal.steps.length ||
      Object.keys(libraryPillarState(player)).length !== seal.steps.length) {
      player.sendMessage("The seal remains dark. Direct every beam of light to it first.");
      return true;
    }
    player.setAttribute(LIBRARY_SEALS, completed | (1 << (index + 1)));
    player.setAttribute(LIBRARY_MIRRORS, null);
    player.setAttribute(LIBRARY_CRYSTALS, null);
    resetLibraryPuzzle(player, index + 1);
    ensureLibraryMemories(player, player.getArea());
    const done = LIBRARY_SEAL_DATA.every((_, sealIndex) => (Number(player.getAttribute(LIBRARY_SEALS)) & (1 << (sealIndex + 1))) !== 0);
    if (done) setChapter(player, 13);
    else player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    startTranscript(api, player, seal.memory, PAGE, `the-grand-library-of-prifddinas-the-seal-of-${seal.name}`);
    return true;
  }

  function enterOrbSupplyCave(event) {
    const player = event?.player;
    const name = String(event?.definition?.getName?.() ?? "").toLowerCase();
    const x = event?.location?.x ?? event?.location?.getX?.();
    const y = event?.location?.y ?? event?.location?.getY?.();
    if (!player || quest.isComplete(player) || currentChapter(player) !== 14 ||
      (Number(player.getAttribute(RECRUITED_ELDERS)) & 3) !== 3 ||
      !hasYsgawynReturnMeeting(player) ||
      x !== 2200 || y !== 3262 || !(event.objectId === ObjectIdentifiers.CAVE_69 || name === "cave")) return false;
    event.handled = true;
    player.setAttribute(ORB_CAVE_ENTRY_PENDING, true);
    if (startTranscript(api, player, NpcIdentifiers.IORWERTH_WARRIOR_9, PAGE,
      "recovering-the-orb-entering-the-iorwerth-camp-s-supply-cave")) return true;
    player.setAttribute(ORB_CAVE_ENTRY_PENDING, null);
    return false;
  }

  function enterOrbSupplyCaveAfterConfirmation(player) {
    let area = player.getAttribute(ORB_CAVE_AREA);
    let state = area && orbCaveInstances.get(area);
    if (!state || area.isDestroyed?.()) {
      area = new OrbSupplyArea(player.getUsername?.());
      state = { area, player, guards: new Set(), defeated: false, ambushStarted: false };
      orbCaveInstances.set(area, state);
      const chest = new GameObject(ObjectIdentifiers.CHEST_122, new Location(2200, 9681, 0), 10, 2, area);
      area.add(chest);
      ObjectManager.register(chest, true);
      for (const [id, gx] of [[NpcIdentifiers.IORWERTH_ARCHER_7, 2199], [NpcIdentifiers.IORWERTH_WARRIOR_9, 2202]]) {
        const guard = api.spawnNpc({ id, x: gx, y: 9678, z: 0, wanderRadius: 2, owner: player, ownerOnly: true });
        if (guard) { area.enter(guard); state.guards.add(guard); }
      }
      if (!state.guards.size) {
        orbCaveInstances.delete(area);
        player.sendMessage("The cave guards are missing. Try entering the Iorwerth supply cave again.");
        return;
      }
      player.setAttribute(ORB_CAVE_AREA, area);
    }
    area.enter(player);
    player.moveTo(new Location(2198, 9677, 0));
  }

  function hasYsgawynReturnMeeting(player) {
    if (player.getAttribute(YSGAWYN_RETURN_MEETING) === true) return true;
    // Older legitimate saves do not carry the new checkpoint. An Orb in the
    // player's inventory or a started trail proves the return meeting passed.
    const hasOrb = player.getInventory?.()?.getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) > 0;
    const trailStarted = player.getAttribute(YSGAWYN_TRACK_STEP) != null;
    if (hasOrb || trailStarted) {
      player.setAttribute(YSGAWYN_RETURN_MEETING, true);
      return true;
    }
    return false;
  }

  function fillOrbCavePlayerName(event) {
    if (!event?.player || typeof event.text !== "string" || !event.text.includes("[Tim/Sue/Sam]") ||
      currentChapter(event.player) !== 14 ||
      (event.player.getAttribute(ORB_CAVE_ENTRY_PENDING) !== true && !(event.player.getArea?.() instanceof OrbSupplyArea))) return;
    event.text = event.text.replaceAll("[Tim/Sue/Sam]", "Sam");
  }

  function elenaPreMeetingCondition(event) {
    if (!event?.player || !["KmA1ih", "SGwqUW"].includes(event.stepId) ||
      !event.pages?.some((page) => page.page === PAGE)) return null;
    const response = event.player.getAttribute(ELENA_PRE_MEETING_RESPONSE);
    if (event.stepId === "KmA1ih") return response !== "later";
    if (event.stepId === "SGwqUW") return response === "later";
    return null;
  }

  function syncYsgawynReturnMeeting({ player }) {
    if (player && currentChapter(player) === 14) hasYsgawynReturnMeeting(player);
  }

  function startOrbCaveAmbush(event) {
    const player = event?.player;
    if (!player || event.text !== "Uh oh..." || currentChapter(player) !== 14) return;
    const area = player.getArea?.();
    const state = area && orbCaveInstances.get(area);
    if (!state || state.player !== player || state.ambushStarted) return;
    event.after = () => {
      if (state.ambushStarted || state.guards.size === 0) return;
      state.ambushStarted = true;
      for (const guard of state.guards) guard.getCombat?.()?.attack?.(player);
    };
  }

  function searchOrbChest(event) {
    const player = event?.player;
    const area = player?.getArea?.();
    const state = area && orbCaveInstances.get(area);
    const name = String(event?.definition?.getName?.() ?? "").toLowerCase();
    const x = event?.location?.x ?? event?.location?.getX?.();
    const y = event?.location?.y ?? event?.location?.getY?.();
    if (!state || state.player !== player || x !== 2200 || y !== 9681 ||
      !(event.objectId === ObjectIdentifiers.CHEST_122 || name === "chest")) return false;
    event.handled = true;
    if (state.guards.size) {
      player.sendMessage("The Iorwerth guards still protect the chest.");
      return true;
    }
    state.defeated = true;
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need an empty inventory slot to take the Orb of Light.");
      return true;
    }
    if (player.getInventory().getAmount(ItemIdentifiers.ORB_OF_LIGHT_5) > 0) {
      player.sendMessage("You already have the Orb of Light. Return to Baxtorian in Lletya.");
      return true;
    }
    return startTranscript(api, player, 0, PAGE, "recovering-the-orb-entering-the-iorwerth-camp-s-supply-cave-searching-the-chest");
  }

  function handleOrbCaveDeath(event) {
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const state = area && orbCaveInstances.get(area);
    if (!state || !state.guards.delete(npc)) return false;
    if (event.killer === state.player && state.guards.size === 0) {
      state.player.sendMessage("The supply cave guards are defeated. Search the chest for the orb.");
    }
    return true;
  }

  function handleLibraryObject(event) {
    const player = event?.player;
    if (!player || !inLibrary(player)) return false;
    if (event.objectId === ObjectIdentifiers.CRYSTAL_DISPENSER_3) return dispenserCollect(event);
    if (event.objectId === ObjectIdentifiers.SEAL_OF_THE_FORGOTTEN ||
      LIBRARY_SEAL_DATA.some((seal) => seal.id === event.objectId || seal.mapId === event.objectId)) return touchLibrarySeal(event);
    return false;
  }

  function crossLibraryFloatingBooks(event) {
    const player = event?.player;
    const location = event?.location;
    if (!player || !inLibrary(player) || !location || location.z !== 2 ||
      player.getSkillManager().getMaxLevel(Skill.AGILITY) < 70) return false;
    // The cache models the two ends of the top-floor handhold as separate
    // climbable objects. Crossing the books is an Agility shortcut, not a
    // ground collision bypass: land on the matching far-end cache tile.
    const endpoints = new Map([
      ["2598,6173", [2606, 6173]], ["2606,6173", [2598, 6173]],
      ["2640,6101", [2648, 6101]], ["2648,6101", [2640, 6101]],
    ]);
    const destination = endpoints.get(`${location.x},${location.y}`);
    if (!destination) return false;
    event.handled = true;
    player.moveTo(new Location(destination[0], destination[1], 2));
    player.sendMessage("You cross the floating books to the other side of the library.");
    return true;
  }

  function enterTemplePassage(event) {
    const player = event?.player;
    const location = event?.location;
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    if (!player || event.objectId !== CAMP_CAVE_ID || x !== 2464 || y !== 6081 ||
      !(player.getArea?.() instanceof DwarvenCampArea) || currentChapter(player) !== 19 ||
      player.getAttribute(CAMP_BATTLE) !== true) return false;
    event.handled = true;
    if (player.getAttribute(FRAGMENT_DEFEATED) === true) {
      player.moveTo(CAMP_CENTER);
      player.sendMessage("You return through the passage to the dwarven camp.");
      return true;
    }
    player.setAttribute(TEMPLE_CUTSCENE_STARTED, false);
    // The cache's Ascend cave is the passage the elves used to enter the temple.
    // The tunnel lands west of the Fragment chamber; the player still walks in.
    player.moveTo(new Location(3278, 5918, 1));
    player.sendMessage("You climb through the crack and follow the old passage toward the Temple of Light.");
    return true;
  }

  function ensureDwarvenCamp(player) {
    const existing = player.getAttribute(CAMP_AREA);
    if (existing && !existing.isDestroyed?.()) {
      existing.enter(player);
      return existing;
    }
    const area = new DwarvenCampArea(player.getUsername?.());
    player.setAttribute(CAMP_AREA, area);
    area.enter(player);
    const atFinalBattle = (player.getAttribute(CAMP_DEFENSE_COMPLETE) === true || currentChapter(player) >= 19) &&
      player.getAttribute(FRAGMENT_DEFEATED) !== true;
    const postEssyllt = atFinalBattle && player.getAttribute(CAMP_BATTLE) === true;
    const retryingEssyllt = atFinalBattle && !postEssyllt;
    campInstances.set(area, { player, attackers: new Set(), nextWaveAt: 0, endsAt: 0,
      lastCycle: -1, defending: false, finished: atFinalBattle, essyllt: null,
      pendingArrivalAt: postEssyllt && player.getAttribute(CAMP_ARRIVAL_STARTED) !== true
        ? World.getProcessCycle() + 2 : 0,
      pendingEssylltAt: retryingEssyllt ? World.getProcessCycle() + 2 : 0 });
    const holesFilled = Number(player.getAttribute(CAMP_HOLES)) || 0;
    for (const [index, [x, y]] of CAMP_HOLE_TILES.entries()) {
      const id = holesFilled & (1 << index) ? ObjectIdentifiers.HOLE_59 : CAMP_HOLE_ID;
      const object = new GameObject(id, new Location(x, y, 0), 10, 0, area);
      area.add(object);
      ObjectManager.register(object, true);
      player.getPacketSender().sendObject(object);
    }
    for (const [id, x, y] of [
      [NpcIdentifiers.BAXTORIAN_2, 2444, 6092], [NpcIdentifiers.ELENA_3, 2454, 6091],
      [NpcIdentifiers.NILOOF_2, 2437, 6084], [NpcIdentifiers.KAMEN_2, 2453, 6087],
      [NpcIdentifiers.THORGEL_2, 2441, 6083], [NpcIdentifiers.KLANK_2, 2451, 6094],
      [NpcIdentifiers.GENERAL_HINING_2, 2446, 6094], [NpcIdentifiers.LORD_IEUAN_AMLODD, 2437, 6092],
      [NpcIdentifiers.LADY_CARYS_HEFIN, 2440, 6088], [NpcIdentifiers.LADY_TANGWEN_TRAHAEARN_2, 2442, 6087],
      [NpcIdentifiers.LADY_KELYN_ITHELL_2, 2444, 6097], [NpcIdentifiers.LADY_FFION_MEILYR_2, 2452, 6090],
      [NpcIdentifiers.LORD_PIQUAN_CRWYS_2, 2450, 6084], [NpcIdentifiers.ISLWYN_4, 2438, 6110],
      [NpcIdentifiers.ELUNED_4, 2448, 6089], [NpcIdentifiers.IESTIN_3, 2459, 6089],
    ]) {
      const npc = api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (npc) area.enter(npc);
    }
    player.moveTo(CAMP_CENTER);
    player.sendMessage("You follow the winding pass to the dwarven camp. The clan elders and resistance are gathering there.");
    return area;
  }

  function spawnCampNpc(area, id, x, y) {
    const state = campInstances.get(area);
    if (!state) return null;
    const npc = api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner: state.player, ownerOnly: true });
    if (npc) area.enter(npc);
    return npc;
  }

  function placeCampExplosive(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 17 || event.itemId !== CAMP_EXPLOSIVE_ITEM) return false;
    const area = player.getArea?.();
    if (!(area instanceof DwarvenCampArea) || area.owner !== player.getUsername?.()) return false;
    const targetLocation = event.location ?? event.object?.getLocation?.();
    const x = targetLocation?.x ?? targetLocation?.getX?.();
    const y = targetLocation?.y ?? targetLocation?.getY?.();
    const index = CAMP_HOLE_TILES.findIndex(([hx, hy]) => hx === x && hy === y);
    if (![CAMP_HOLE_ID, ObjectIdentifiers.HOLE_58].includes(event.objectId) || index < 0) return false;
    event.handled = true;
    const placed = Number(player.getAttribute(CAMP_HOLES)) || 0;
    if (placed & (1 << index)) {
      player.sendMessage("This hole has already been filled with an explosive potion.");
      return true;
    }
    const inventory = player.getInventory();
    if (inventory.getAmount(CAMP_EXPLOSIVE_ITEM) < 1) {
      player.sendMessage("You need one of Elena's explosive potions to fill this hole.");
      return true;
    }
    inventory.deleteNumber(CAMP_EXPLOSIVE_ITEM, 1);
    player.setAttribute(CAMP_HOLES, placed | (1 << index));
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    const object = event.object;
    const location = object?.getLocation?.() ?? new Location(x, y, 0);
    if (object) ObjectManager.deregister(object, true);
    const filled = new GameObject(ObjectIdentifiers.HOLE_59, location.clone(), 10, object?.getFace?.() ?? 0, area);
    area.add(filled);
    ObjectManager.register(filled, true);
    player.getPacketSender().sendObject(filled);
    player.sendMessage("You place the potion in the hole and gently cover the top with dirt.");
    if ((placed | (1 << index)) === 127) {
      setChapter(player, 18);
      player.sendMessage("All seven charges are in place. Return to Baxtorian and report that the camp is ready.");
    }
    return true;
  }

  function finishCampMeetingLine(event) {
    const player = event?.player;
    const area = player?.getArea?.();
    const state = area && campInstances.get(area);
    if (!state?.meetingPending || currentChapter(player) !== 18) return;
    if (event.text === "Then we will leave at once.") {
      event.after = () => {
        if (state.meetingPending && player.getArea?.() === area && currentChapter(player) === 18) {
          startTranscript(api, player, NpcIdentifiers.LORD_IORWERTH_2, PAGE, "sealing-the-underground-pass-meeting-with-lord-iorwerth");
        }
      };
      return;
    }
    if (event.text !== "As am I.") return;
    event.after = () => {
      if (!state.meetingPending || player.getArea?.() !== area || currentChapter(player) !== 18) return;
      state.meetingPending = false;
      beginCampDefense(player, area);
    };
  }

  function beginCampDefense(player, area) {
    if (!area) return;
    const state = campInstances.get(area);
    if (!state || state.defending || state.finished) return;
    state.defending = true;
    state.endsAt = World.getProcessCycle() + 400; // 240 seconds at the 600ms world tick.
    state.nextWaveAt = World.getProcessCycle();
    state.lastCycle = -1;
    player.setAttribute(CAMP_DEFENSE, state.endsAt);
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    player.sendMessage("Iorwerth's forces attack the barricade. Hold the camp for four minutes; draw their warriors and archers away from the barrier.");
    spawnCampAttacker(area, state);
  }

  function spawnCampAttacker(area, state) {
    const cycle = World.getProcessCycle();
    state.nextWaveAt = cycle + 7;
    const ranged = Math.random() < 0.45;
    const index = state.attackers.size;
    const npc = api.spawnNpc({ id: ranged ? NpcIdentifiers.IORWERTH_ARCHER_10 : NpcIdentifiers.IORWERTH_WARRIOR_12,
      // The statue line north of the camp blocks direct melee routes. Keep the
      // spawned raiders on the open approach beside the player's barricade.
      x: 2444 + (index % 2), y: 6105 + (index % 3), z: 0, wanderRadius: 0,
      owner: state.player, ownerOnly: true });
    if (!npc) return;
    npc.setMultiCombat?.(true);
    area.enter(npc);
    state.attackers.add(npc);
    npc.getCombat().attack(state.player);
  }

  function finishCampDefense(area, state) {
    if (state.finished) return;
    state.defending = false;
    state.finished = true;
    state.player.setAttribute(CAMP_DEFENSE_COMPLETE, true);
    for (const npc of state.attackers) api.removeNpc(npc);
    state.attackers.clear();
    state.player.setAttribute(CAMP_DEFENSE, 0);
    state.player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(state.player), state.player));
    state.player.sendMessage("The dwarves finish sealing the tunnel. The camp has held for four minutes.");
    state.rebel = spawnCampNpc(area, NpcIdentifiers.REBEL_WARRIOR_8, 2444, 6096);
    state.player.sendMessage("Elena has an urgent message after the siege. Speak to her.");
  }

  function beginEssylltEncounter(player) {
    const area = player.getAttribute(CAMP_AREA);
    const state = area && campInstances.get(area);
    if (!state || !state.finished) return;
    // The core can remove the boss on player death before our area state sees
    // that death. Clear a dead/unregistered reference so the retry transcript
    // can start the encounter again.
    if (state.essyllt && state.essyllt.isRegistered?.() !== false && state.essyllt.getHitpoints?.() > 0) return;
    if (state.essyllt) {
      api.removeNpc(state.essyllt);
      state.essyllt = null;
      for (const npc of state.essylltAdds ?? []) api.removeNpc(npc);
      state.essylltAdds?.clear();
    }
    const boss = api.spawnNpc({ id: NpcIdentifiers.ESSYLLT_5, x: 2448, y: 6118, z: 0, wanderRadius: 0,
      owner: player, ownerOnly: true });
    if (!boss) {
      player.sendMessage("Essyllt could not be reached in the chaos. Speak to Elena to draw him out again.");
      return;
    }
    boss.setMultiCombat?.(true);
    boss.setScriptedMovement?.(true);
    area.enter(boss);
    state.essyllt = boss;
    state.essylltPending = true;
    setChapter(player, 19);
    for (const [id, x, y] of [[NpcIdentifiers.IORWERTH_WARRIOR_12, 2446, 6117],
      [NpcIdentifiers.IORWERTH_WARRIOR_12, 2449, 6117]]) {
      const guard = api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (!guard) continue;
      guard.setMultiCombat?.(true);
      guard.setScriptedMovement?.(true);
      area.enter(guard);
      (state.essylltAdds ??= new Set()).add(guard);
    }
  }

  function finishEssylltChallengeLine(event) {
    const player = event?.player;
    const area = player?.getArea?.();
    const state = area && campInstances.get(area);
    if (!state?.essylltPending || currentChapter(player) !== 19 || event.text !== "Oh I'm going to enjoy this...") return;
    event.after = () => {
      if (!state.essylltPending || player.getArea?.() !== area || !state.essyllt?.isRegistered?.()) return;
      state.essylltPending = false;
      for (const npc of [state.essyllt, ...(state.essylltAdds ?? [])]) {
        npc.setScriptedMovement?.(false);
        npc.getCombat().attack(player);
      }
    };
  }

  function spawnPostEssylltArrival(player) {
    const area = player.getAttribute(CAMP_AREA);
    const state = area && campInstances.get(area);
    if (!state || state.arrivals) return;
    state.arrivals = true;
    for (const [id, x, y] of [[NpcIdentifiers.LORD_IORWERTH_2, 2448, 6110],
      [NpcIdentifiers.ARIANWYN_2, 2447, 6112], [NpcIdentifiers.IORWERTH_WARRIOR_12, 2446, 6112],
      [NpcIdentifiers.IORWERTH_WARRIOR_12, 2449, 6112], [NpcIdentifiers.IORWERTH_ARCHER_10, 2445, 6113],
      [NpcIdentifiers.IORWERTH_ARCHER_10, 2450, 6113]]) {
      const npc = spawnCampNpc(area, id, x, y);
      if (!npc) continue;
      // These nearby NPCs are the post-fight story tableau, not another wave.
      // Keep their cache combat options from turning the dialogue into an
      // accidental aggro encounter or letting the player attack a cutscene actor.
      npc.setScriptedMovement?.(true);
      (state.arrivalActors ??= new Set()).add(npc);
    }
  }

  function handleCampDeath(event) {
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const state = area && campInstances.get(area);
    if (!state || !state.player || event?.killer !== state.player) return false;
    if (state.attackers.delete(npc)) return true;
    if (state.essylltAdds?.delete(npc)) return true;
    if (npc !== state.essyllt) return false;
    state.essyllt = null;
    state.player.setAttribute(CAMP_BATTLE, true);
    // Let the death animation and combat cleanup finish before the cutscene
    // replaces the active dialogue manager. Its first action owns the arrivals.
    state.pendingArrivalAt = World.getProcessCycle() + 2;
    return true;
  }

  function handleQuestPlayerDeath(event) {
    const player = event?.player;
    if (!player || quest.isComplete(player)) return;
    const aArea = player.getAttribute(LLETYA_BOSS);
    const aState = aArea && arianwynInstances.get(aArea);
    if (aState) {
      api.removeNpc(aState.boss);
      aState.finished = true;
      arianwynInstances.delete(aArea);
      aArea.leave(player, false);
      player.setAttribute(LLETYA_BOSS, null);
      player.sendMessage("Arianwyn is still waiting in Lletya. Recover and speak to him to continue the fight.");
    }
    const camp = player.getAttribute(CAMP_AREA);
    const campState = camp && campInstances.get(camp);
    if (campState?.essyllt) {
      api.removeNpc(campState.essyllt);
      campState.essyllt = null;
      for (const npc of campState.essylltAdds ?? []) api.removeNpc(npc);
      campState.essylltAdds?.clear();
      campState.pendingEssylltAt = World.getProcessCycle() + 4;
    }
    const area = player.getAttribute(FRAGMENT_AREA);
    const state = area && fragmentInstances.get(area);
    if (!state || state.player !== player || state.finished) return;
    event.handled = true;
    state.finished = true;
    for (const npc of [...state.beams, ...state.clones, state.boss]) api.removeNpc(npc);
    state.beams.clear();
    state.clones = [];
    fragmentInstances.delete(area);
    area.leave(player, false);
    player.setAttribute(FRAGMENT_AREA, null);
    player.setAttribute(TEMPLE_CUTSCENE_STARTED, false);
    ensureDwarvenCamp(player);
    player.moveTo(CAMP_CENTER);
    player.sendMessage("You can return through the cave by the camp and face the Fragment again.");
  }

  class FallsStoryArea extends Area {
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player=mobile.getAsPlayer();
      if (currentChapter(player)===10 && player.getAttribute(FALLS_DEPARTURE)===true) ensureFallsActors(player);
      else clearFallsActors(player);
    }
  }
  function clearFallsActors(player) {
    for (const npc of FALLS_ACTORS.get(player) ?? []) api.removeNpc(npc);
    FALLS_ACTORS.delete(player);
  }
  function ensureFallsActors(player) {
    const actors=FALLS_ACTORS.get(player) ?? [];
    const specs=[{id:NpcIdentifiers.ARIANWYN_6,x:2603,y:9905,z:0}];
    if (Number(player.getAttribute(FALLS_PILLARS))===63) specs.push({id:NpcIdentifiers.BAXTORIAN,x:2605,y:9915,z:0});
    for (const spec of specs) {
      if (actors.some(npc=>npc.getId?.()===spec.id && npc.isRegistered?.())) continue;
      const npc=api.spawnNpc({...spec,wanderRadius:0,owner:player,ownerOnly:true});if(npc)actors.push(npc);
    }
    FALLS_ACTORS.set(player,actors);
  }
  function preparationProgress(player) { return Number(player.getAttribute(PREPARATION_PROGRESS)) || 72; }
  function setPreparationProgress(player,value) {
    player.setAttribute(PREPARATION_PROGRESS,value);
    player.getPacketSender().sendVarbit(9016,value);
  }
  function clearPreparationActors(player) {
    for(const npc of PREPARATION_ACTORS.get(player) ?? [])api.removeNpc(npc);
    PREPARATION_ACTORS.delete(player);
  }
  function ensurePreparationActors(player) {
    if(currentChapter(player)!==11)return;
    const from=player.getLocation();
    const old=PREPARATION_ACTORS.get(player) ?? [];
    if(old.some(n=>n.isRegistered?.()))return;
    const specs=[];
    if(from.getX()>=2320 && from.getX()<=2390 && from.getY()>=3150 && from.getY()<=3210) {
      const elders=Number(player.getAttribute(PREPARATION_ELDERS))||0;
      if(elders&1)specs.push({id:NpcIdentifiers.LORD_IEUAN_AMLODD_2,x:2349,y:3171});
      if(elders&2)specs.push({id:NpcIdentifiers.LADY_TANGWEN_TRAHAEARN,x:2348,y:3172});
    }
    if(player.getAttribute(VALLEY_FIGURE)===true && from.getX()>=3040 && from.getX()<=3060 && from.getY()>=4475 && from.getY()<=4495)specs.push({id:NpcIdentifiers.MYSTERIOUS_FIGURE,x:3051,y:4485});
    if(specs.length)PREPARATION_ACTORS.set(player,specs.map(spec=>api.spawnNpc({...spec,z:0,wanderRadius:0,owner:player,ownerOnly:true})).filter(Boolean));
  }
  class PreparationStoryArea extends Area {
    process(mobile) { if(mobile?.isPlayer?.())ensurePreparationActors(mobile.getAsPlayer()); }
    postLeave(mobile) { if(mobile?.isPlayer?.())clearPreparationActors(mobile.getAsPlayer()); }
  }
  function preparationCondition(event) {
    const player=event?.player;
    if(!player || currentChapter(player)!==11 || !event.pages?.some(p=>p.page===PAGE))return null;
    const free=player.getInventory().getFreeSlots();
    if(["7LTpqE","DiZSIi","QCeWgy"].includes(event.stepId))return free<1;
    if(["67SlRZ","XuyA41","mX1Kjz"].includes(event.stepId))return free>0;
    if(event.stepId==="KWY6vh")return player.getInventory().getAmount(ItemIdentifiers.CADANTINE_SEED)>0;
    if(event.stepId==="LuXLRK")return player.getInventory().getAmount(ItemIdentifiers.CADANTINE_SEED)<1;
    if(event.stepId==="uCIMMt")return true;
    if(event.stepId==="s5MEWd")return false;
    return null;
  }
  function handlePreparationAction(event) {
    const player=event?.player;if(!player || currentChapter(player)!==11)return false;
    const inventory=player.getInventory(),id=event.stepId;
    if(id==="iNVHlg")setPreparationProgress(player,74);
    else if(id==="rlWDAM") {
      if(inventory.getAmount(ItemIdentifiers.CRYSTAL_SEED_3)<1 && inventory.getAmount(ItemIdentifiers.CRYSTAL_SEED_5)<1 && inventory.getFreeSlots()>0)inventory.adds(ItemIdentifiers.CRYSTAL_SEED_3,1);
    } else if(id==="eS601c") {
      if(inventory.getAmount(ItemIdentifiers.CRYSTAL_SEED_3)>0){inventory.deleteNumber(ItemIdentifiers.CRYSTAL_SEED_3,1);inventory.adds(ItemIdentifiers.CRYSTAL_SEED_5,1);}
    } else if(id==="D1wXY6" || id==="EMxiFg") {
      if(id==="D1wXY6")player.setAttribute(VALLEY_FIGURE,false);
      else {player.setAttribute(TRAHAEARN_CREVICE,6);player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,6);}
      player.setAttribute(PREPARATION_ELDERS,(Number(player.getAttribute(PREPARATION_ELDERS))||0)|(id==="D1wXY6"?1:2));
      if((Number(player.getAttribute(PREPARATION_ELDERS))&3)===3)setPreparationProgress(player,84);
      else if(id==="D1wXY6")setPreparationProgress(player,82);
      clearPreparationActors(player);if(id==="D1wXY6")player.moveTo(new Location(2353,3172,0));ensurePreparationActors(player);
    } else if(id==="ZYvQiu") {
      if((Number(player.getAttribute(PREPARATION_ELDERS))&3)!==3)return true;
    } else if(id==="0lNCRc") {
      if(preparationProgress(player)>=84 && inventory.getFreeSlots()>0 && inventory.getAmount(ItemIdentifiers.ELDER_CADANTINE)<1){inventory.adds(ItemIdentifiers.ELDER_CADANTINE,1);setPreparationProgress(player,86);}
    } else if(id==="eOtNFO") {
      if(preparationProgress(player)<88 && inventory.getAmount(ItemIdentifiers.INVERSION_POTION)<1)return true;
      if(inventory.getAmount(ItemIdentifiers.INVERSION_POTION)>0)inventory.deleteNumber(ItemIdentifiers.INVERSION_POTION,1);
      setPreparationProgress(player,88);
    }
    else if(id==="_2-0Qk") {clearPreparationActors(player);setChapter(player,12);}
    else return false;
    event.handled=true;return true;
  }
  function finishPreparationLine(event) {
    const player=event?.player;if(!player || currentChapter(player)!==11)return;
    if(event.text==="Great. The patch is all prepared so just plant it when you're ready." || event.text==="Indeed. When you're ready, go ahead and plant the seed." || event.text==="Will do, I'll be back soon.")event.after=()=>setPreparationProgress(player,76);
    if(event.text?.endsWith(", myself and Baxtorian will continue to work on deciphering these clues. While we do, it would be of great help if you could find Lord Amlodd and Lady Trahaearn for us."))event.after=()=>setPreparationProgress(player,80);
  }
  function talkPreparation(event,name) {
    const player=event.player,p=preparationProgress(player),inv=player.getInventory();let variant;
    if(name==="elena")variant=p===74?"talking-to-elena":p===76?"talking-to-elena-talking-to-elena-"+(inv.getAmount(ItemIdentifiers.CADANTINE_SEED)>0?"after":"before")+"-getting-a-cadantine-seed":p>=84?"making-the-inversion-potion-talking-to-elena"+(inv.getAmount(ItemIdentifiers.ELDER_CADANTINE)>0||inv.getAmount(ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_)>0?"-again":""):"the-second-meeting-talking-to-arianwyn-again";
    if(name==="arianwyn")variant=p===88?"making-the-inversion-potion-talking-to-arianwyn-after-finishing-the-potion":p===72?"the-second-meeting":p<78?"the-second-meeting-talking-to-arianwyn-again":p===78?"talking-to-arianwyn-and-baxtorian":p>=84?"making-the-inversion-potion-talking-to-arianwyn"+(inv.getAmount(ItemIdentifiers.CRYSTAL_5)>0||inv.getAmount(ItemIdentifiers.CRYSTAL_DUST)>0?"-again":""):"talking-to-arianwyn-and-baxtorian-talking-to-arianwyn-again";
    if(name==="baxtorian")variant=p<78?"talking-to-baxtorian":p===78?"talking-to-arianwyn-and-baxtorian":p>=84?"finding-lady-trahaearn-talking-to-baxtorian-once-amlodd-and-trahaearn-are-in-lletya":"talking-to-arianwyn-and-baxtorian-talking-to-baxtorian-again";
    if(name==="eluned" && inv.getAmount(ItemIdentifiers.CRYSTAL_SEED_3)>0)variant="finding-lord-amlodd-talking-to-eluned";
    if(name==="arianwyn" && inv.getAmount(ItemIdentifiers.INVERSION_POTION)>0) {variant="making-the-inversion-potion-talking-to-arianwyn-after-finishing-the-potion";}
    return variant?startTranscript(api,player,event.npcId,PAGE,"preparing-to-enter-prifddinas-"+variant):false;
  }
  function syncPreparationLogin({player}) {
    player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,Number(player.getAttribute(TRAHAEARN_CREVICE))||0);
    if(player.getAttribute(VALLEY_FIGURE)===true)ensurePreparationActors(player);
  }
  function routeTrahaearnCrevice(event) {
    const player=event?.player,loc=event.object?.getLocation?.();
    if(!player || currentChapter(player)!==11 || loc?.getZ()!==0)return;
    if(event.objectId===TRAHAEARN_CREVICE_LOC && loc.getX()===2341 && loc.getY()===9616)event.destination={x:2341,y:9618,z:0};
  }
  function useTrahaearnCrevice(event) {
    const player=event?.player,loc=event?.location,option=String(event?.option??event?.definition?.getInteractions?.()?.[event.clickType-1]??"").toLowerCase();
    if(!player || currentChapter(player)!==11 || loc?.z!==0)return false;
    if(loc.x===2334 && loc.y===9580 && option==="enter") {event.handled=true;clearPreparationActors(player);player.moveTo(new Location(2341,9618,0));return true;}
    if(loc.x!==2341 || loc.y!==9616)return false;
    if(event.itemId!==undefined && !/pickaxe$/i.test(api.core.CacheDefinitions.getItem(event.itemId)?.name ?? ""))return false;
    event.handled=true;const progress=Number(player.getAttribute(TRAHAEARN_CREVICE))||0;
    if(progress<1){player.sendMessage("Ask Baxtorian about Lady Trahaearn's clue first.");return true;}
    if(option==="inspect" && progress===1){player.setAttribute(TRAHAEARN_CREVICE,2);player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,2);player.sendMessage("The crevice has been blocked. A pickaxe could clear it.");return true;}
    if(option==="mine" || event.itemId!==undefined) {
      if(!findBestPickaxe(player)){player.sendMessage("You need a pickaxe to clear the blocked crevice.");return true;}
      if(progress>=3){player.sendMessage("The crevice is already clear.");return true;}
      player.setAttribute(TRAHAEARN_CREVICE,3);player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,3);player.sendMessage("You clear the blocked crevice with your pickaxe.");return true;
    }
    if(option==="enter" && progress>=3){clearPreparationActors(player);player.moveTo(new Location(2334,9573,0));ensurePreparationActors(player);return true;}
    return true;
  }
  function inspectTrahaearn(event) {
    const player=event?.player;if(!player || currentChapter(player)!==11)return false;
    event.handled=true;player.setAttribute(TRAHAEARN_CREVICE,4);player.getPacketSender().sendVarbit(TRAHAEARN_CREVICE_VARBIT,4);
    return startTranscript(api,player,event.npcId,PAGE,"preparing-to-enter-prifddinas-finding-lady-trahaearn-inspecting-the-elderly-elf");
  }
  function fixTrahaearn(event) { return handleItemOnNpc({...event,itemId:ItemIdentifiers.HAMMER,target:event.npc}); }
  function plantPreparationSeed(event) {
    const player=event?.player,loc=event?.location;
    if(!player || currentChapter(player)!==11 || event.itemId!==ItemIdentifiers.CADANTINE_SEED || loc?.x!==2321 || loc?.y!==3151 || loc?.z!==0)return false;
    event.handled=true;
    if(preparationProgress(player)!==76){player.sendMessage("Ask Elena to prepare the patch before planting the seed.");return true;}
    if(!hasItems(player,[ItemIdentifiers.CADANTINE_SEED,ItemIdentifiers.SEED_DIBBER])){player.sendMessage("You need a cadantine seed and a seed dibber.");return true;}
    player.getInventory().deleteNumber(ItemIdentifiers.CADANTINE_SEED,1);setPreparationProgress(player,78);
    startTranscript(api,player,NpcIdentifiers.ELENA_3,PAGE,"preparing-to-enter-prifddinas-talking-to-elena-planting-the-cadantine-seed");return true;
  }
  function randomizeFallsOrder(player) {
    const order=PILLAR_ITEMS.map((_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    if(order.join(",")===player.getAttribute(FALLS_ORDER))order.push(order.shift());
    player.setAttribute(FALLS_ORDER,order.join(","));
  }
  function fallsInventoryCondition(event) {
    const player=event?.player;
    if(!player || currentChapter(player)!==10 || !event.pages?.some(entry=>entry.page===PAGE))return null;
    if(event.stepId==="KjzbLu")return player.getInventory().getFreeSlots()<1;
    if(event.stepId==="nAc44D")return player.getInventory().getFreeSlots()>0;
    return null;
  }
  function readFallsOde(event) {
    const player=event?.player;if(!player || currentChapter(player)!==10 || player.getInventory().getAmount(ItemIdentifiers.ODE_TO_ETERNITY)<1)return false;
    event.handled=true;player.setAttribute(FALLS_BOOK_READ,true);
    player.sendMessage("Ode to eternity numbers the offerings: 1 Nature rune, 2 Flowers or irit, 3 Black knife or dagger, 4 Wine of Zamorak, 5 Adamant chainbody, 6 Cabbage.");
    return true;
  }
  function searchFallsKey(event) {
    const player=event?.player,loc=event?.location;
    if(!player || currentChapter(player)!==10 || loc?.x!==2589 || loc?.y!==9888 || loc?.z!==0)return false;
    event.handled=true;const inv=player.getInventory();
    if(inv.getAmount(FALLS_KEY)>0)player.sendMessage("You already have the key to the waterfall doors.");
    else if(inv.getFreeSlots()<1)player.sendMessage("Make room for the waterfall key.");
    else {inv.adds(FALLS_KEY,1);player.sendMessage("You find a small key among the crates.");}
    return true;
  }
  function boardFallsRaft(event) {
    const player=event?.player,loc=event?.location;
    if (!player || currentChapter(player)!==10 || loc?.x!==2509 || loc?.y!==3493 || loc?.z!==0)return false;
    event.handled=true;
    // shortcut: Wiki route with cache-clear arrivals; animation timing awaits an OSRS capture.
    player.moveTo(new Location(2512,3480,0));player.sendMessage("The log raft breaks up, leaving you on Hudon's island.");return true;
  }
  function routeFallsDoors(event) {
    const player=event?.player,loc=event?.object?.getLocation?.();
    if(!player || ![10,11].includes(currentChapter(player)) || event.objectId!==ObjectIdentifiers.DOOR_48 || loc?.getZ()!==0)return;
    if(loc.getX()===2568 && loc.getY()===9893)event.destination={x:2568,y:player.getLocation().getY()<=9893?9892:9894,z:0};
    if(loc.getX()===2566 && loc.getY()===9901)event.destination={x:2566,y:9900,z:0};
    if(loc.getX()===2604 && loc.getY()===9900)event.destination={x:2604,y:9902,z:0};
  }
  function routeFallsRope(event) {
    const player=event?.player,loc=event?.object?.getLocation?.(),from=event?.sourceLocation;
    if (!player || currentChapter(player)!==10 || !loc || from?.z!==0)return;
    if(event.objectId===ObjectIdentifiers.ROCK && loc.getX()===2512 && loc.getY()===3468 && from.y>=3476 && from.y<=3482)
      event.destination={x:2512,y:3476,z:0};
    if(event.objectId===ObjectIdentifiers.DEAD_TREE_15 && loc.getX()===2512 && loc.getY()===3465 && from.y>=3465 && from.y<=3475)
      event.destination={x:2513,y:3466,z:0};
  }
  function useFallsRope(event) {
    const player=event?.player,loc=event?.location,from=player?.getLocation?.();
    if(!player || currentChapter(player)!==10 || player.getInventory().getAmount(ItemIdentifiers.ROPE)<1 || loc?.z!==0)return false;
    if(loc.x!==2512)return false;
    if(event.objectId===ObjectIdentifiers.ROCK && loc.y===3468 && from.getY()>=3476 && from.getY()<=3482) {
      player.moveTo(new Location(2513,3468,0));player.sendMessage("You use the rope to cross to the rock's island.");return true;
    }
    if(event.objectId===ObjectIdentifiers.DEAD_TREE_15 && loc.y===3465 && from.getY()>=3465 && from.getY()<=3475) {
      player.moveTo(new Location(2511,3463,0));player.sendMessage("You lower yourself from the dead tree to the waterfall ledge.");return true;
    }
    return false;
  }
  function guardFallsDoors(event) {
    const player=event?.player,loc=event?.location;
    if(player && currentChapter(player)===10 && event.objectId===ObjectIdentifiers.DOOR_6 && loc?.x===2511 && loc?.y===3464 && loc?.z===0) {
      event.handled=true;player.moveTo(new Location(2574,9864,0));player.sendMessage("You enter the Waterfall Dungeon.");return;
    }
    if(player && [10,11].includes(currentChapter(player)) && loc?.x===2604 && loc?.y===9900 && loc?.z===0) {
      event.handled=true;player.moveTo(new Location(2566,9900,0));return;
    }
    if(player && currentChapter(player)===10 && loc?.x===2566 && loc?.y===9901 && loc?.z===0 && player.getInventory().getAmount(FALLS_KEY)>0) {
      // The cache holds the SOTE Baxtorian chamber in the adjacent copied room.
      event.handled=true;player.moveTo(new Location(2604,9902,0));return;
    }
    if(!player || currentChapter(player)!==10 || loc?.z!==0 || ![[2568,9893],[2566,9901]].some(([x,y])=>loc.x===x&&loc.y===y))return;
    if(player.getInventory().getAmount(FALLS_KEY)>0) {
      // These scripted key doors have no Close variant in the cache door catalog.
      if(loc.x===2568 && loc.y===9893) {
        event.handled=true;player.moveTo(new Location(2568,player.getLocation().getY()<=9893?9894:9892,0));
      }
      return;
    }
    event.handled=true;player.sendMessage("The waterfall door is locked. Search the eastern chamber's crate for its key.");
  }

  function clearEarlyStoryActors(player) {
    for (const npc of EARLY_STORY_ACTORS.get(player) ?? []) api.removeNpc(npc);
    EARLY_STORY_ACTORS.delete(player);
  }
  function ensureCapturedKing(player) {
    if ((EARLY_STORY_ACTORS.get(player) ?? []).some(npc=>npc.isRegistered?.())) return;
    clearEarlyStoryActors(player);
    const king=api.spawnNpc({id:NpcIdentifiers.KING_LATHAS_2,x:2541,y:9745,z:0,wanderRadius:0,owner:player,ownerOnly:true});
    if (king) EARLY_STORY_ACTORS.set(player,[king]);
  }
  function ensureFirstMeetingActors(player) {
    const old = EARLY_STORY_ACTORS.get(player) ?? [];
    if (old.some(npc=>npc.isRegistered?.())) return;
    clearEarlyStoryActors(player);
    // QH marks the upper platform's wall; the adjacent clear tile is reachable.
    const spawned = [
      { id: NpcIdentifiers.YSGAWYN, x:2334,y:3167,z:1 },
    ].map(spec=>api.spawnNpc({...spec,wanderRadius:0,owner:player,ownerOnly:true})).filter(Boolean);
    EARLY_STORY_ACTORS.set(player, spawned);
  }
  function resumeEarlyStory({player}) {
    if (quest.isComplete(player)) return;
    if (currentChapter(player) === 7 && Number(player.getAttribute(EAST_BATTLE_KILLS)) === 15) {
      const scene=Number(player.getAttribute(KING_SCENE_PROGRESS)) || 0;
      if (scene===0) { player.moveTo(new Location(2537,9745,0)); ensureCapturedKing(player); }
      else startTranscript(api,player,NpcIdentifiers.ELENA_3,PAGE,scene===1
        ? "battle-of-two-ardougnes-killing-of-a-king" : "face-to-face-with-lord-iorwerth");
    }
  }
  function kingQuestionSteps(steps) {
    return steps.map(step => step.type !== "choice" ? step : {...step,options:step.options.map(option =>
      option.text === "We're done here, take him away." ? {...option,steps:[{player:option.text},
        {type:"action",action:"take-lathas-away"}]} : option)});
  }
  function handleEarlyStoryAction(event) {
    const player=event?.player;
    if (!player || quest.isComplete(player)) return false;
    if (event.action==="take-lathas-away" && currentChapter(player)===7 && Number(player.getAttribute(EAST_BATTLE_KILLS))===15) {
      player.setAttribute(KING_SCENE_PROGRESS,1);
      player.getPacketSender().sendVarbit(9016,52);
      event.handled=true;event.steps=loadTranscripts(api)[PAGE].variants["battle-of-two-ardougnes-killing-of-a-king"];
      return true;
    }
    if (event.stepId==="Rc0W1H" && currentChapter(player)===7 && Number(player.getAttribute(KING_SCENE_PROGRESS))===1) {
      player.setAttribute(KING_SCENE_PROGRESS,2);
      player.getPacketSender().sendVarbit(9016,54);
      // shortcut: dialogue and cache-clear arrival represent the narrated capture;
      // cinematic camera choreography needs a live OSRS packet capture.
      player.moveTo(new Location(2198,3252,0));
      clearEarlyStoryActors(player);
      EARLY_STORY_ACTORS.set(player,[
        {id:NpcIdentifiers.LORD_IORWERTH,x:2196,y:3252,z:0},
        {id:NpcIdentifiers.ELENA_3,x:2199,y:3252,z:0},
        {id:NpcIdentifiers.ESSYLLT_2,x:2200,y:3252,z:0},
        {id:NpcIdentifiers.ARIANWYN_6,x:2197,y:3251,z:0},
      ].map(spec=>api.spawnNpc({...spec,wanderRadius:0,owner:player,ownerOnly:true})).filter(Boolean));
      event.handled=true;event.steps=loadTranscripts(api)[PAGE].variants["face-to-face-with-lord-iorwerth"];
      return true;
    }
    if (event.stepId==="v3r3p_" && currentChapter(player)===7 && Number(player.getAttribute(KING_SCENE_PROGRESS))===2) {
      clearEarlyStoryActors(player);setChapter(player,8);player.moveTo(new Location(2353,3172,0));ensureFirstMeetingActors(player);
      return true;
    }
    if (event.kind==="message" && ["HhCkbH","NuOcWI","GkCxQQ"].includes(event.stepId) && currentChapter(player)===8 && Number(player.getAttribute(FIRST_MEETING_PROGRESS))===2) {
      player.setAttribute(FIRST_MEETING_PROGRESS,3);setChapter(player,9);return true;
    }
    if (event.stepId==="5Ndx0y" && currentChapter(player)===10 && (player.getInventory().getFreeSlots()>0 || player.getInventory().getAmount(ItemIdentifiers.ODE_TO_ETERNITY)>0)) {
      player.setAttribute(FALLS_INTRODUCTION,true);
      player.getPacketSender().sendVarbit(9016,68);
    }
    return false;
  }
  function finishEarlyStoryLine(event) {
    const player=event?.player;if (!player || quest.isComplete(player)) return;
    if (currentChapter(player)===8 && event.text==="Okay, I'll be back soon.") {
      event.after=()=>{player.setAttribute(FIRST_MEETING_PROGRESS,1);player.getPacketSender().sendVarbit(9016,58);};
    } else if (currentChapter(player)===8 && Number(player.getAttribute(FIRST_MEETING_PROGRESS))===1 && event.text==="Well... he was nice.") {
      event.after=()=>{player.setAttribute(FIRST_MEETING_PROGRESS,2);player.getPacketSender().sendVarbit(9016,60);};
    } else if (currentChapter(player)===10 && player.getLocation().getY()<4000 && event.text==="Sounds good, see you there.") {
      event.after=()=>{player.setAttribute(FALLS_DEPARTURE,true);player.getPacketSender().sendVarbit(9016,66);};
    } else if (currentChapter(player)===9 && event.text==="Well in that case, I'll meet you there.") {
      event.after=()=>{setChapter(player,10);clearEarlyStoryActors(player);};
    }
  }

  function finishArdougneBattleBriefing(event) {
    const player = event?.player;
    if (!player) return;
    const chapter = currentChapter(player);
    if ([4, 5].includes(chapter) && resistanceSupport(player) >= 80 &&
      event.text?.startsWith("This is it! The plague of West Ardougne")) {
      event.after = () => {
        setChapter(player, 5);
        startBattle(player, "west");
      };
    } else if (chapter === 6 && Number(player.getAttribute(WEST_BATTLE_KILLS)) >= 21 &&
      event.text === "Let's show him what it means to cross the people of Ardougne!") {
      event.after = () => startBattle(player, "east");
    }
  }
  function spawnBattleWave(player, area, wave) {
    const ground = [[2544,3314],[2546,3314],[2548,3314],[2550,3314],
      [2544,3316],[2546,3316],[2548,3316],[2550,3316],[2543,3318],[2545,3318]];
    const basement = [[2035,4635],[2037,4635],[2039,4635],[2041,4635],[2043,4635],
      [2035,4636],[2037,4636],[2039,4636],[2041,4636],[2043,4636],[2040,4637]];
    const west = (wave === 0 ? ground : basement).map(([x,y], i) => ({ x, y, z: 0,
      id: i < 3 ? NpcIdentifiers.MOURNER_2 : i < (wave === 0 ? 8 : 7) ? NpcIdentifiers.MOURNER_3 : NpcIdentifiers.MOURNER_4 }));
    const east = [
      ...[[2581,3286],[2582,3286],[2583,3286],[2582,3287],[2584,3288]].map(([x,y])=>({id:NpcIdentifiers.KNIGHT_OF_ARDOUGNE_6,x,y,z:0})),
      ...[[2585,3289],[2586,3290],[2587,3290],[2586,3291],[2587,3291],[2588,3291]].map(([x,y])=>({id:NpcIdentifiers.PALADIN_5,x,y,z:0})),
      ...[[2576,3293],[2577,3293]].map(([x,y])=>({id:NpcIdentifiers.KNIGHT_OF_ARDOUGNE_7,x,y,z:1})),
      ...[[2578,3293],[2578,3294]].map(([x,y])=>({id:NpcIdentifiers.PALADIN_6,x,y,z:1})),
    ];
    const waveNpcs = area.battle === "west" ? west : east;
    const enemies = new Set();
    for (const spawn of waveNpcs) {
      const npc = api.spawnNpc({ ...spawn, wanderRadius: 0, owner: player, ownerOnly: true });
      if (!npc) continue;
      npc.setMultiCombat?.(true);
      area.enter(npc);
      enemies.add(npc);
    }
    const companions = battleInstances.get(area)?.companions ?? [];
    battleInstances.set(area, { player, battle: area.battle, wave, kills: 0, target: waveNpcs.length, enemies, companions });
  }
  function enterArdougneBattleBasement(event) {
    const player = event?.player, area = player?.getArea?.(), state = area && battleInstances.get(area);
    if (!(area instanceof ArdougneBattleArea) || area.battle !== "west" || state?.player !== player ||
      event.location?.x !== 2542 || event.location?.y !== 3327 ||
      (event.objectId !== HEADQUARTERS_TRAPDOOR && event.objectId !== BATTLE_TRAPDOOR && event.definition?.getId?.() !== BATTLE_TRAPDOOR &&
        !api.core.CacheDefinitions.getObject(event.objectId)?.transforms?.includes(BATTLE_TRAPDOOR))) return false;
    event.handled = true;
    if (Number(player.getAttribute(WEST_BATTLE_KILLS)) < 10) {
      player.sendMessage("Defeat the mourners on the ground floor before heading downstairs.");
      return true;
    }
    api.emitCustomEvent("ladders:climbDown", { player, destination: new Location(2039, 4637, 0) });
    if (state.wave === 0 && !state.awaitingBasement) beginHeadquartersBasement(player, area);
    return true;
  }
  function beginHeadquartersBasement(player, area) {
    let state = battleInstances.get(area);
    if (!state) {
      state = { player, battle: "west", wave: 0, kills: 10, target: 10, enemies: new Set(), companions: [] };
      battleInstances.set(area, state);
    }
    for (const [i, npc] of state.companions.entries()) npc.moveTo(new Location(2044, 4636 - i, 0));
    if (player.getAttribute(HEADQUARTERS_WARNING_HEARD) === true) return spawnBattleWave(player, area, 1);
    state.awaitingBasement = true;
    const warning = api.spawnNpc({ id: NpcIdentifiers.ESSYLLT_2, x: 2043, y: 4637, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (warning) area.enter(warning);
    state.warning = warning;
    startTranscript(api, player, NpcIdentifiers.ESSYLLT_2, PAGE, "battle-of-two-ardougnes-west-ardougne-upon-entering-the-basement");
  }
  function finishHeadquartersWarning(event) {
    const player = event?.player, area = player?.getArea?.(), state = area && battleInstances.get(area);
    if (!state?.awaitingBasement || event.npcId !== NpcIdentifiers.ESSYLLT_2 ||
      !event.text?.includes("Lord Iorwerth will learn of your betrayal!")) return;
    event.after = () => {
      player.setAttribute(HEADQUARTERS_WARNING_HEARD, true);
      if (state.warning) api.removeNpc(state.warning);
      spawnBattleWave(player, area, 1);
    };
  }
  function startBattle(player, battle) {
    const existing = player.getAttribute(BATTLE_AREA);
    if (existing && existing.isDestroyed?.() !== true) return;
    const area = new ArdougneBattleArea(battle, player.getUsername?.());
    player.setAttribute(BATTLE_AREA, area);
    area.enter(player);
    const wave = battle === "west" && Number(player.getAttribute(WEST_BATTLE_KILLS)) >= 10 ? 1 : 0;
    const start = battle === "west" ? (wave === 0 ? new Location(2547,3314,0) : new Location(2039,4637,0)) : new Location(2583,3287,0);
    player.moveTo(start);
    if (wave === 1) beginHeadquartersBasement(player, area);
    else spawnBattleWave(player, area, wave);
    const state = battleInstances.get(area);
    const spots = battle === "east" ? [[2587,3292],[2588,3292]] : wave === 1 ? [[2044,4636],[2044,4635]] : [[2546,3313],[2548,3313]];
    for (const [i, id] of [NpcIdentifiers.ELENA_3, NpcIdentifiers.COUNCILLOR_HALGRIVE_3].entries()) {
      const npc = api.spawnNpc({ id, x: spots[i][0], y: spots[i][1], z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (npc) { area.enter(npc); state.companions.push(npc); }
    }
    player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
    player.sendMessage(battle === "west"
      ? (wave === 0 ? "The resistance storms the Mourner headquarters. Defeat the mourners on the ground floor." : "The resistance returns to the headquarters basement. Defeat the remaining mourners.")
      : "The resistance storms East Ardougne. Defeat the paladins and knights protecting the castle.");
  }

  function handleBattleDeath(event) {
    if (handleOrbCaveDeath(event)) return;
    if (handleArianwynDeath(event)) return;
    if (handleFragmentDeath(event)) return;
    if (handleCampDeath(event)) return;
    const player = event?.killer;
    const npc = event?.npc;
    if (!player || !npc || quest.isComplete(player)) return;
    const area = npc.getArea?.();
    const instance = area && battleInstances.get(area);
    if (instance && instance.player === player && instance.enemies.delete(npc)) {
      instance.kills++;
      if (instance.kills < instance.target) return;
      if (instance.battle === "west" && instance.wave === 0) {
        player.sendMessage("The mourners on the ground floor have fallen. Continue into the basement.");
        player.setAttribute(WEST_BATTLE_KILLS, 10);
        player.getPacketSender().sendVarbit(9016, 45);
        startTranscript(api, player, 0, PAGE, "battle-of-two-ardougnes-west-ardougne-after-killing-10-mourners-on-the-ground-level");
        return;
      }
      if (instance.battle === "west") {
        player.setAttribute(WEST_BATTLE_KILLS, 21);
        quest.setStage(player, STAGE.STARTED + 60);
        player.sendMessage("The Mourner headquarters is clear. Return to Elena and Councillor Halgrive.");
        startTranscript(api, player, 0, PAGE, "battle-of-two-ardougnes-west-ardougne-after-killing-11-mourners-in-the-basement");
        area.leave(player, false);
        player.setAttribute(BATTLE_AREA, null);
        player.moveTo(new Location(2537, 9745, 0));
        return;
      }
      player.setAttribute(EAST_BATTLE_KILLS, 15);
      quest.setStage(player, STAGE.STARTED + 70);
      player.sendMessage("The paladins and knights have fallen. King Lathas is exposed.");
      startTranscript(api, player, 0, PAGE, "battle-of-two-ardougnes-east-ardougne-after-killing-15-paladins-and-knights");
      area.leave(player, false);
      player.setAttribute(BATTLE_AREA, null);
      player.moveTo(new Location(2537, 9745, 0));
      return;
    }
  }

  function startFragmentBattle(player) {
    const existing = player.getAttribute(FRAGMENT_AREA);
    if (existing && existing.isDestroyed?.() !== true) return true;
    const area = new FragmentArea(player.getUsername?.());
    const spawn = new Location(3294, 5918, 1);
    const boss = api.spawnNpc({ id: NpcIdentifiers.FRAGMENT_OF_SEREN, x: 3294, y: 5918, z: 1,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) {
      player.sendMessage("The Fragment of Seren could not be reached. Return to Arianwyn and try again.");
      return false;
    }
    boss.setMultiCombat?.(true);
    boss.setMaxHitpoints(1000);
    boss.setHitpoints(1000);
    // This encounter owns the Fragment's attack cycle. Prevent the cached NPC
    // combat AI from adding a second attack beside the prayer-aware scripted hit.
    boss.setScriptedMovement(true);
    area.enter(player);
    area.enter(boss);
    player.setAttribute(FRAGMENT_AREA, area);
    player.setAttribute(FRAGMENT_DEFEATED, false);
    player.moveTo(spawn);
    fragmentInstances.set(area, {
      player, boss, area, lastCycle: -1, nextSpecialAt: World.getProcessCycle() + 12,
      nextBasicAttackAt: World.getProcessCycle() + FRAGMENT_BASIC_ATTACK_SPEED,
      basicAttackSpeed: boss.getCurrentDefinition?.()?.getAttackSpeed?.() || FRAGMENT_BASIC_ATTACK_SPEED,
      nextBeamHealAt: 0,
      clones: [], realClone: null, introStarted: false, introFinished: false,
      specialIndex: 0, beams: new Set(), specialImpactAt: 0, followupAt: 0,
      meleeHitsRemaining: 0, nextMeleeHitAt: 0, finished: false,
    });
    player.sendMessage("The Fragment of Seren emerges. Watch for its teleport, true echo, healing whirlwinds, and devastating blast.");
    return true;
  }

  const FRAGMENT_AREA = "quest.song_of_the_elves.fragment-area";

  function startArianwynBattle(player) {
    const existing = player.getAttribute(LLETYA_BOSS);
    if (existing && !existing.isDestroyed?.()) return true;
    if (player.getAttribute(LLETYA_TRAITOR_REVEALED) !== true || currentChapter(player) !== 15) return false;
    const area = new LletyaArianwynArea(player.getUsername?.());
    const boss = api.spawnNpc({ id: NpcIdentifiers.ARIANWYN_2, x: 2353, y: 3173, z: 0,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!boss) {
      player.sendMessage("Arianwyn cannot be reached in the chaos. Speak to him again to try.");
      return false;
    }
    boss.setMultiCombat?.(true);
    boss.setScriptedMovement?.(true);
    area.enter(player);
    area.enter(boss);
    player.setAttribute(LLETYA_BOSS, area);
    player.moveTo(new Location(2351, 3172, 0));
    arianwynInstances.set(area, {
      player, boss, finished: false, lastCycle: -1, nextSpecialAt: World.getProcessCycle() + 8,
      specialCount: 0, bomb: null,
    });
    boss.getCombat().attack(player);
    player.sendMessage("Arianwyn attacks with a bow. Protect from Range blocks his normal arrows; avoid the orange arrow's marked tile.");
    return true;
  }

  function finishArianwynEncounter(area, state) {
    if (state.finished) return;
    state.finished = true;
    api.removeNpc(state.boss);
    state.player.setAttribute(LLETYA_BOSS, null);
    state.player.setAttribute(LLETYA_ARIANWYN_NPC, null);
    area.leave(state.player, false);
    state.player.moveTo(new Location(2353, 3172, 0));
    arianwynInstances.delete(area);
    // shortcut: the Wiki says the cutscene begins when Arianwyn is near death
    // but gives no exact hitpoint threshold; 20% of his cached 300 HP starts it.
    startTranscript(api, state.player, NpcIdentifiers.ISLWYN, PAGE, "after-the-attack-a-rebellion-divided");
  }

  function handleArianwynDeath(event) {
    const npc = event?.npc;
    const area = npc?.getArea?.();
    const state = area && arianwynInstances.get(area);
    if (!state || npc !== state.boss || event?.killer !== state.player) return false;
    finishArianwynEncounter(area, state);
    return true;
  }

  function spawnFragmentAdds(area, ids, points) {
    const state = fragmentInstances.get(area);
    if (!state) return [];
    const spawned = [];
    for (const [index, id] of ids.entries()) {
      const [x, y] = points[index];
      const npc = api.spawnNpc({ id, x, y, z: 1, wanderRadius: 0, owner: state.player, ownerOnly: true });
      if (!npc) continue;
      npc.setMultiCombat?.(true);
      npc.setScriptedMovement?.(true);
      npc.setMaxHitpoints(1);
      npc.setHitpoints(1);
      area.enter(npc);
      spawned.push(npc);
    }
    return spawned;
  }

  function spawnFragmentClones(area, state) {
    const phase = fragmentPhase(state.boss.getHitpoints());
    const points = [[3290, 5918], [3298, 5918], [3294, 5912], [3294, 5924]];
    const realIndex = Math.floor(Math.random() * phase.clones);
    // Cache 8917/8919/8920 use the lighter lighting; 8918 has the darker ambient.
    // The actual encounter calls out the lighter shadow as the valid target.
    const ids = Array.from({ length: phase.clones }, (_, index) => index === realIndex
      ? NpcIdentifiers.FRAGMENT_OF_SEREN
      : NpcIdentifiers.FRAGMENT_OF_SEREN_2);
    state.clones = spawnFragmentAdds(area, ids, points.slice(0, phase.clones));
    state.realClone = state.clones[realIndex] ?? null;
    state.boss.sendMessage?.(`The Fragment splits into ${phase.clones} echoes. One is real; strike the true one before they fade.`);
    state.player.sendMessage(`The Fragment divides into ${phase.clones} echoes. Strike the true echo; the false ones cannot be harmed.`);
  }

  function fragmentPhase(hitpoints) {
    if (hitpoints > 666) return { clones: 2, beams: 2, teleportDelay: 4, blastRemainder: 5 };
    if (hitpoints > 333) return { clones: 3, beams: 3, teleportDelay: 3, blastRemainder: 3 };
    return { clones: 4, beams: 4, teleportDelay: 2, blastRemainder: 1 };
  }

  function spawnFragmentBeams(area, state) {
    const phase = fragmentPhase(state.boss.getHitpoints());
    const points = [[3289, 5922], [3299, 5922], [3294, 5913], [3294, 5923]];
    state.beams = new Set(spawnFragmentAdds(area,
      Array.from({ length: phase.beams }, () => NpcIdentifiers.COL_00FFFF_CRYSTAL_WHIRLWIND_COL),
      points.slice(0, phase.beams)));
    state.nextBeamHealAt = World.getProcessCycle() + FRAGMENT_BEAM_HEAL_SPEED;
    state.player.sendMessage(`${phase.beams} Crystal Whirlwinds surround the Fragment. Attack them to stop its healing.`);
  }

  function removeFragmentBeams(state) {
    for (const beam of state.beams) api.removeNpc(beam);
    state.beams.clear();
  }

  function zeroHit(hit) {
    for (const part of hit?.getHits?.() ?? []) part.setDamage(0);
    hit?.updateTotalDamage?.();
  }

  function forceFragmentSpecialHit(event) {
    const target = event?.target;
    const area = target?.getArea?.();
    const state = area && fragmentInstances.get(area);
    if (state && !state.finished && event.attacker === state.player &&
        (state.beams.has(target) || target === state.realClone)) {
      event.forceAccurate = true;
    }
  }

  function handleFragmentHit(event) {
    const npc = event?.npc;
    const hit = event?.hit;
    const state = npc && fragmentInstances.get(npc.getArea?.());
    if (!state || state.finished || !hit) return;
    const attacker = hit.getAttacker?.();
    if (!attacker?.isPlayer?.() || attacker.getUsername?.() !== state.player.getUsername?.()) {
      zeroHit(hit);
      return;
    }
    if (state.beams.has(npc)) {
      const remaining = npc.getHitpoints?.() ?? 1;
      const parts = hit.getHits?.() ?? [];
      if (parts.length) {
        parts[0].setDamage(Math.max(remaining, parts[0].getDamage?.() ?? 0));
        for (const part of parts.slice(1)) part.setDamage(0);
        hit.updateTotalDamage?.();
      }
      return;
    }
    if (state.clones.includes(npc)) {
      if (npc !== state.realClone) {
        zeroHit(hit);
        return;
      }
      const remaining = npc.getHitpoints?.() ?? 1;
      const parts = hit.getHits?.() ?? [];
      if (parts.length) {
        parts[0].setDamage(Math.max(remaining, parts[0].getDamage?.() ?? 0));
        for (const part of parts.slice(1)) part.setDamage(0);
        hit.updateTotalDamage?.();
      }
      return;
    }
    if (npc !== state.boss) return;
    if (state.realClone) {
      zeroHit(hit);
      attacker.sendMessage("Destroy the true echo before attacking the Fragment again.");
      return;
    }
    // Seren's fragment has a hard 24 damage cap per hit, regardless of style.
    for (const part of hit.getHits?.() ?? []) {
      if (part.getDamage() > 24) part.setDamage(22 + Math.floor(Math.random() * 3));
    }
    hit.updateTotalDamage?.();
  }

  function queueFragmentBlast(state) {
    const player = state.player;
    const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
    const hp = player.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
    const bossHp = state.boss.getHitpoints();
    const remainder = bossHp <= 333 ? 1 : bossHp <= 666 ? 3 : 5;
    const damage = Math.max(1, max - remainder);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED).setSource(state.boss)]);
    player.sendMessage(hp <= damage
      ? "The Fragment's blast leaves you barely standing."
      : "Your overhealed vitality lets you endure the Fragment's blast.");
  }

  function resolveFragmentSpecial(area, state, now) {
    if (state.specialImpactAt && now >= state.specialImpactAt) {
      state.specialImpactAt = 0;
      queueFragmentBlast(state);
      state.specialIndex = 0;
      state.nextSpecialAt = now + 24;
      return;
    }
    if (state.followupAt && now >= state.followupAt) {
      state.followupAt = 0;
      if (state.player.getLocation().getDistance(state.boss.getLocation()) <= 1) {
        const damage = Math.floor(Math.random() * 11);
        if (damage > 0) state.player.getCombat().getHitQueue().addPendingDamage([
          new HitDamage(damage, HitMask.RED).setSource(state.boss),
        ]);
        state.meleeHitsRemaining = 4;
        state.nextMeleeHitAt = now + 1;
        state.player.sendMessage("The Fragment's melee strike catches you before you can escape.");
      } else {
        state.player.sendMessage("You dodge the Fragment's follow-up strike.");
      }
      return;
    }
    if (state.meleeHitsRemaining && now >= state.nextMeleeHitAt) {
      if (state.player.getLocation().getDistance(state.boss.getLocation()) <= 1) {
        const damage = Math.floor(Math.random() * 11);
        if (damage > 0) state.player.getCombat().getHitQueue().addPendingDamage([
          new HitDamage(damage, HitMask.RED).setSource(state.boss),
        ]);
        state.meleeHitsRemaining -= 1;
        state.nextMeleeHitAt = now + 1;
      } else {
        state.meleeHitsRemaining = 0;
      }
      return;
    }
    if (now < state.nextSpecialAt || state.specialImpactAt) return;

    const phase = fragmentPhase(state.boss.getHitpoints());
    if (state.specialIndex === 0) {
      state.player.sendMessage("The Fragment teleports you beside it and winds up a melee strike. Step away before it lands!");
      state.player.moveTo(new Location(3294, 5918, 1));
      state.followupAt = now + phase.teleportDelay;
      state.nextSpecialAt = now + 24;
      state.specialIndex = 1;
      return;
    }
    if (state.specialIndex === 1) {
      if (state.clones.length) {
        for (const clone of state.clones) api.removeNpc(clone);
        state.clones = [];
        state.realClone = null;
      }
      spawnFragmentClones(area, state);
      state.specialIndex = 2;
      state.nextSpecialAt = now + 24;
      return;
    }
    if (state.specialIndex === 2) {
      spawnFragmentBeams(area, state);
      state.specialIndex = 3;
      state.nextSpecialAt = now + 24;
      return;
    }

    removeFragmentBeams(state);
    state.player.sendMessage("The Fragment gathers a devastating burst of magic. Restore your health before it lands!");
    state.specialImpactAt = now + 3;
    state.nextSpecialAt = now + 3;
  }

  function handleFragmentDeath(event) {
    const npc = event?.npc;
    const state = npc && fragmentInstances.get(npc.getArea?.());
    if (!state || state.finished) return false;
    if (state.beams.delete(npc)) return true;
    if (state.clones.includes(npc)) {
      if (npc !== state.realClone) return true;
      state.realClone = null;
      for (const clone of state.clones) if (clone !== npc) api.removeNpc(clone);
      state.clones = [];
      state.player.sendMessage("The false echoes vanish. The Fragment is vulnerable again.");
      return true;
    }
    if (npc !== state.boss) return false;
    state.finished = true;
    state.player.setAttribute(FRAGMENT_DEFEATED, true);
    removeFragmentBeams(state);
    for (const add of state.clones) api.removeNpc(add);
    state.clones = [];
    const area = npc.getArea?.();
    area?.leave(state.player, false);
    state.player.setAttribute(FRAGMENT_AREA, null);
    fragmentInstances.delete(area);
    state.player.moveTo(new Location(3278, 5918, 1));
    startTranscript(api, state.player, NpcIdentifiers.LORD_IORWERTH, PAGE, "the-fragment-of-seren-the-fragment-defeated");
    return true;
  }

  function chemicalCabinetSteps(steps) {
    // The Wiki's other chemical options say "above"; all four share the first option's handout.
    return steps.map(step => step.type === "choice" ? { ...step,
      options: step.options.map((option, index) => index < CHEMICALS.length
        ? { ...option, steps: step.options[0].steps } : option),
    } : step);
  }
  function searchElenaCabinet(event) {
    const player = event?.player;
    const loc = event?.location;
    if (!player || currentChapter(player) !== 2 || quest.isComplete(player)) return false;
    if (loc && (loc.x < 2588 || loc.x > 2597 || loc.y < 3328 || loc.y > 3342)) return false;
    return startTranscript(api, player, 0, PAGE, "freeing-elena-searching-her-cabinet", chemicalCabinetSteps);
  }

  function resistanceBedSteps(steps) {
    const briefing = loadTranscripts(api)[PAGE].variants[
      "meet-the-ardougne-resistance-planning-a-revolution-entering-the-hidden-basement"];
    return steps.map(step => step.type === "choice" ? { ...step,
      options: step.options.map(option => option.text === "Climb through it."
        ? { ...option, steps: briefing } : option),
    } : step);
  }
  function finishResistanceBriefing(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 3 || player.getAttribute(RESISTANCE_BRIEFING) !== true ||
      player.getLocation().getY() < 9700 || event.text !== "Good luck.") return;
    event.after = () => {
      player.setAttribute(RESISTANCE_BRIEFING, false);
      setChapter(player, 4);
    };
  }
  function searchRehnisonBed(event) {
    const player = event?.player;
    if (!player || ![3, 4, 5, 6].includes(currentChapter(player)) || quest.isComplete(player)) return false;
    const loc = event.location;
    if (loc && (loc.x < 2522 || loc.x > 2541 || loc.y < 3320 || loc.y > 3344)) return false;
    return startTranscript(api, player, 0, PAGE, "meet-the-ardougne-resistance-planning-a-revolution-searching-the-bed",
      currentChapter(player) === 3 ? resistanceBedSteps : undefined);
  }

  function enterResistanceBasement(event) {
    const player = event?.player;
    const loc = event?.location;
    if (!player || !loc || ![3, 4, 5, 6].includes(currentChapter(player)) || quest.isComplete(player) ||
      loc.x < 2522 || loc.x > 2541 || loc.y < 3320 || loc.y > 3344) return false;
    event.handled = true;
    player.moveTo(new api.core.Location(2537, 9745, 0));
    if (currentChapter(player) === 3) {
      player.setAttribute(RESISTANCE_BRIEFING, true);
      startTranscript(api, player, 0, PAGE, "meet-the-ardougne-resistance-planning-a-revolution-entering-the-hidden-basement");
    }
  }

  function enterPrison(event) {
    const player = event?.player, loc = event?.location;
    if (!player || !loc || loc.x !== 2569 || loc.y !== 3295 || currentChapter(player) > 2 || currentChapter(player) < 1) return false;
    event.handled = true;
    if (!wearingDisguise(player)) {
      player.sendMessage("Only Knights of Ardougne are allowed in the prison.");
      return true;
    }
    const firstEntry = (Number(player.getAttribute(ELENA_ESCAPE_PROGRESS)) || 0) < 20;
    player.setAttribute(ELENA_ESCAPE_PROGRESS, Math.max(20, Number(player.getAttribute(ELENA_ESCAPE_PROGRESS)) || 0));
    setChapter(player, 2);
    api.emitCustomEvent("ladders:climbDown", { player, destination: new Location(2565, 9709, 0) });
    if (firstEntry) startTranscript(api, player, NpcIdentifiers.KNIGHT_OF_ARDOUGNE_3, PAGE, "freeing-elena-upon-entering-the-prison");
    return true;
  }
  function nativeEarlyProgress(value, player) {
    if (value === 10) return 2;
    if (value === 20) return player?.getAttribute(DISGUISE_BRIEFED) === true ? 10 : 4;
    if (value === 30) {
      const progress = Number(player?.getAttribute(ELENA_ESCAPE_PROGRESS)) || 18;
      // Existing saves may have taken the clear liquid before its menu updated the native stage.
      return progress === 22 && player?.getInventory?.()?.getAmount?.(ItemIdentifiers.CLEAR_LIQUID) > 0 ? 24 : progress;
    }
    if (value === 40) return player?.getAttribute(RESISTANCE_BRIEFING) === true ? 32 : 28;
    if (value === 50) return 40;
    if (value === 60) return Number(player?.getAttribute(WEST_BATTLE_KILLS)) >= 10 ? 45 : 44;
    if (value === 70) return player?.getAttribute(BATTLE_AREA)?.battle === "east" ? 48 : 46;
    if (value === 80) return [50,52,54][Number(player?.getAttribute(KING_SCENE_PROGRESS)) || 0];
    if (value === 90) return [56,58,60][Math.min(2,Number(player?.getAttribute(FIRST_MEETING_PROGRESS)) || 0)];
    if (value === 100) return 62;
    if (value === 120) return preparationProgress(player);
    if (value === 130) {
      if (!hasForgottenMemory(player)) {
        const location = player?.getLocation?.();
        const inside = inLibrary(player) || location && location.getX() >= 2548 && location.getX() <= 2690 &&
          location.getY() >= 6078 && location.getY() <= 6220 && location.getZ() <= 2;
        return inside ? 92 : 90;
      }
      const index = currentLibrarySeal(player);
      if (index < 0) return 110;
      const puzzle = libraryPuzzleState(player);
      const solved = puzzle.seal === index && puzzle.step >= LIBRARY_SEAL_DATA[index].steps.length;
      return 94 + index * 2 + (solved ? 1 : 0);
    }
    if (value === 110) return Number(player?.getAttribute(FALLS_PILLARS))===63 ? 70 : player?.getAttribute(FALLS_INTRODUCTION) === true ? 68 : player?.getAttribute(FALLS_DEPARTURE) === true ? 66 : 64;
    if (value === 140) return 110;
    if (value === 150) {
      const recruited = Number(player?.getAttribute(RECRUITED_ELDERS)) || 0;
      if (player?.getInventory?.()?.getAmount?.(ItemIdentifiers.ORB_OF_LIGHT_5) > 0 &&
        player?.getAttribute(YSGAWYN_TRACK_STEP) == null) return 130;
      if (player?.getAttribute(YSGAWYN_TRACK_STEP) != null) {
        const step = Number(player.getAttribute(YSGAWYN_TRACK_STEP)) || 0;
        if (step >= YSGAWYN_TRACKS.length + 1) return 140;
        if (step > 0) return 138;
        return 134;
      }
      if ((recruited & 3) === 3) return 120;
      if (recruited & 2) return 116;
      if (recruited & 1) return 118;
      return 112;
    }
    if (value === 160) {
      const children = player?.getAttribute(LLETYA_CHILDREN) ?? {};
      if (player?.getAttribute(LLETYA_ARIANWYN_CONFRONTED) === true) return 152;
      if (player?.getAttribute(LLETYA_TRAITOR_REVEALED) === true) return 150;
      if (children.eoin && children.iona) return 146;
      if (children.eoin) return 144;
      return 142;
    }
    if (value === 170) return (Number(player?.getAttribute(RECRUITED_ELDERS)) & 12) === 12 ? 164 : 160;
    if (value === 180) {
      const holes = Number(player?.getAttribute(CAMP_HOLES)) || 0;
      const placed = (holes & 127).toString(2).replace(/0/g, "").length;
      return 166 + placed * 2;
    }
    if (value === 190) {
      const late = Number(player?.getAttribute(LATE_CHAPTER)) || 0;
      if (late === 19) return player?.getAttribute(FRAGMENT_DEFEATED) === true ? 188 : 186;
      if (late >= 20) return player?.getAttribute(WAR_END_ARIANWYN_DONE) === true ? 192 : 190;
      if (player?.getAttribute(CAMP_DEFENSE_COMPLETE) === true) return 184;
      if ((Number(player?.getAttribute(CAMP_DEFENSE)) || 0) > 0) return 182;
      return 180;
    }
    return value;
  }
  function elenaEscapeReminder(steps) {
    const correctChemical = steps.find(step => step.id === "Ne_wSN");
    const handover = correctChemical.steps.find(step => step.type === "choice").options.find(option => option.text === "Yes.");
    return handover.steps.slice(-2);
  }
  function finishElenaPrisonLine(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 2 || ![PRISON_ELENA_BASE, NpcIdentifiers.ELENA_2, NpcIdentifiers.ELENA_4].includes(event.npcId)) return;
    if (event.text === "Okay, I'll be back soon." && Number(player.getAttribute(ELENA_ESCAPE_PROGRESS)) === 20) {
      event.after = () => {
        player.setAttribute(ELENA_ESCAPE_PROGRESS, 22);
        player.getPacketSender().sendVarbit(9016, nativeEarlyProgress(quest.getStage(player), player));
      };
    }
  }

  // These cache staircases are partly blocked by the castle collision map. Send
  // the click to the open side of the stair, then let the normal climb task play
  // with the landing paired to the opposite floor's stair.
  function routeCastleThroneStairs(event) {
    const object = event?.object;
    const tile = object?.getLocation?.();
    const x = tile?.getX?.();
    const y = tile?.getY?.();
    const z = event?.sourceLocation?.z;
    const up = event?.objectId === 15645 && x === 2571 && y === 3295 && z === 0;
    const down = event?.objectId === 15648 && x === 2571 && y === 3295 && z === 1;
    const prison = event.objectId === PRISON_ENTRY && x === 2569 && y === 3295 && z === 0;
    if (!up && !down && !prison) return;
    // There is no walkable interaction tile beside the colliding staircase.
    // Keep the click at the player's current tile; `ladders:climb` performs the
    // same paired-floor transition as the cache staircase action.
    event.destination = prison ? { x: 2571, y: 3293, z: 0 } : { ...event.sourceLocation };
  }

  function claimCastleThroneStairs(event) {
    const tile = event?.object?.getLocation?.();
    const x = tile?.getX?.();
    const y = tile?.getY?.();
    const z = event?.player?.getLocation?.()?.getZ?.();
    if (event.objectId === PRISON_ENTRY && x === 2569 && y === 3295 && z === 0) {
      if (enterPrison({ ...event, location: { x, y, z } })) event.handled = true;
      return;
    }
    if (event.objectId === PRISON_EXIT && x === 2564 && y === 9710 && z === 0) {
      api.emitCustomEvent("ladders:climbUp", { player: event.player, destination: new Location(2571, 3293, 0) });
      event.handled = true;
      return;
    }
    if (x !== 2571 || y !== 3295) return;
    if (event.objectId === 15645 && z === 0) {
      api.emitCustomEvent("ladders:climbUp", { player: event.player, destination: new Location(2575, 3293, 1) });
      event.handled = true;
    } else if (event.objectId === 15648 && z === 1) {
      api.emitCustomEvent("ladders:climbDown", { player: event.player, destination: new Location(2575, 3293, 0) });
      event.handled = true;
    }
  }

  function handleItemOnItem(event) {
    if (!event?.player || quest.getStage(event.player) < 20 || quest.isComplete(event.player)) return;
    const pair = [event.usedItemId, event.usedWithItemId];
    const inventory = event.player.getInventory();
    const hasPair = (first, second) => pair.includes(first) && pair.includes(second);
    if (hasPair(ItemIdentifiers.PESTLE_AND_MORTAR, ItemIdentifiers.CRYSTAL_5) && currentChapter(event.player) === 11) {
      event.handled = true;
      inventory.deleteNumber(ItemIdentifiers.CRYSTAL_5, 1);
      inventory.adds(ItemIdentifiers.CRYSTAL_DUST, 1);
      event.player.sendMessage("You grind the old crystal into crystal dust.");
      return;
    }
    if (hasPair(ItemIdentifiers.ELDER_CADANTINE, ItemIdentifiers.VIAL_OF_WATER) && currentChapter(event.player) === 11) {
      event.handled = true;
      inventory.deleteNumber(ItemIdentifiers.ELDER_CADANTINE, 1);
      inventory.deleteNumber(ItemIdentifiers.VIAL_OF_WATER, 1);
      inventory.adds(ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_, 1);
      event.player.sendMessage("You add the elder cadantine to the vial of water.");
      return;
    }
    if (hasPair(ItemIdentifiers.CRYSTAL_DUST, ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_) && currentChapter(event.player) === 11) {
      event.handled = true;
      inventory.deleteNumber(ItemIdentifiers.CRYSTAL_DUST, 1);
      inventory.deleteNumber(ItemIdentifiers.ELDER_CADANTINE_POTION_UNF_, 1);
      inventory.adds(ItemIdentifiers.INVERSION_POTION, 1);
      event.player.sendMessage("You mix the crystal dust into the unfinished potion, making an inversion potion.");
      return;
    }
    const isHelm = pair.includes(DISGUISE.RED_DYE) && pair.includes(DISGUISE.STEEL_HELM);
    const isBody = pair.includes(DISGUISE.TABARD) && pair.includes(DISGUISE.STEEL_BODY);
    if (!isHelm && !isBody) return;
    event.handled = true;
    const variant = isHelm
      ? "making-a-knightly-disguise-dying-the-steel-full-helm"
      : "making-a-knightly-disguise-using-tabard-on-steel-platebody";
    startTranscript(api, event.player, 0, PAGE, variant);
  }

  function handleItemOnNpc(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 11 || quest.isComplete(player)) return;
    const npcName = String(event.target?.getName?.() ?? event.target?.getCurrentDefinition?.(player)?.getName?.() ?? "");
    if (!/^Elderly Elf$/i.test(npcName) || ![ItemIdentifiers.HAMMER, ItemIdentifiers.RUNITE_BAR].includes(event.itemId)) return;
    event.handled = true;
    if(!hasItems(player,[ItemIdentifiers.HAMMER,ItemIdentifiers.RUNITE_BAR])){player.sendMessage("You need a hammer and a runite bar to repair the exoskeleton.");return;}
    startTranscript(api, player, event.npcId, PAGE, "preparing-to-enter-prifddinas-finding-lady-trahaearn-repairing-the-exoskeleton");
  }

  function handleCrystalSeedAction(event) {
    const player = event?.player;
    if (!player || event.itemId !== ItemIdentifiers.CRYSTAL_SEED_5 || String(event.option).toLowerCase()!=="rub" || currentChapter(player) !== 11 || quest.isComplete(player)) return;
    if(player.getInventory().getAmount(ItemIdentifiers.CRYSTAL_SEED_5)<1)return;
    event.handled = true;
    startTranscript(api, player, 0, PAGE, "preparing-to-enter-prifddinas-a-mysterious-figure");
  }

  function useIorwerthCampTeleport(event) {
    if (!event?.player || !IORWERTH_CAMP_TELEPORT_IDS.has(event.itemId) || String(event.option).toLowerCase() !== "teleport") return;
    event.handled = true;
    // Cache map location confirmed against the Wiki. The old coordinate landed
    // on the Cave object's blocked footprint and trapped the player.
    const destination = new Location(2194, 3258, 0);
    if (!api.core.TeleportHandler.checkReqs(event.player, destination)) return;
    event.player.getInventory().deleteNumber(event.itemId, 1);
    api.core.TeleportHandler.teleport(event.player, destination, api.core.TeleportType.NORMAL, false);
  }

  function placeFallsPillarItem(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 10 || quest.isComplete(player)) return false;
    const index = PILLAR_ITEMS.findIndex(([id,,alternatives]) => id === event.itemId || alternatives.filter(Number.isInteger).includes(event.itemId));
    if (index < 0) return false;
    const location = event.location ?? event.object?.getLocation?.();
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const z = location?.z ?? location?.getZ?.();
    const pillarIndex = FALLS_PILLAR_LOCATIONS.findIndex(([px, py, pz]) => px === x && py === y && pz === z);
    if (pillarIndex < 0) return false;
    const inventory = player.getInventory();
    if (inventory.getAmount(event.itemId) < 1) return false;
    event.handled=true;
    if (player.getAttribute(FALLS_BOOK_READ)!==true) {
      player.sendMessage("Read Ode to eternity before placing the offerings.");return true;
    }
    const order = String(player.getAttribute(FALLS_ORDER) ?? "").split(",").map(Number);
    if (order.length !== PILLAR_ITEMS.length || order.some((value) => !Number.isInteger(value))) {
      player.sendMessage("The riddle in Ode to Eternity is incomplete. Speak to Arianwyn for another copy.");
      return true;
    }
    const bit = 1 << pillarIndex;
    const placed = Number(player.getAttribute(FALLS_PILLARS)) || 0;
    if (placed & bit) {
      player.sendMessage("You have already placed that item on a pillar.");
      return true;
    }
    if (order[pillarIndex] !== index) {
      inventory.deleteNumber(event.itemId, 1);
      player.setAttribute(FALLS_PILLARS,0);randomizeFallsOrder(player);
      player.sendMessage("The pillar rejects the offering. Its numbered clues change; inspect the pillars again.");
      return true;
    }
    inventory.deleteNumber(event.itemId, 1);
    player.setAttribute(FALLS_PILLARS, placed | bit);
    player.sendMessage(`The ${PILLAR_ITEMS[index][1]} disappears into the numbered pillar.`);
    if ((placed | bit) === (1 << PILLAR_ITEMS.length) - 1) {
      player.getPacketSender().sendVarbit(9016,70);
      ensureFallsActors(player);
      player.sendMessage("The stone statue becomes Baxtorian. Speak to him beside the plinth.");
    }
    return true;
  }

  function searchFallsPillar(event) {
    const player = event?.player;
    if (!player || currentChapter(player) !== 10 || quest.isComplete(player)) return false;
    const location = event.location ?? event.object?.getLocation?.();
    const index = FALLS_PILLAR_LOCATIONS.findIndex(([x, y, z]) =>
      x === (location?.x ?? location?.getX?.()) && y === (location?.y ?? location?.getY?.()) && z === (location?.z ?? location?.getZ?.()));
    if (index < 0) return false;
    event.handled = true;
    const order = String(player.getAttribute(FALLS_ORDER) ?? "").split(",").map(Number);
    if (order.length !== PILLAR_ITEMS.length) {
      player.sendMessage("The markings are too faint to read without Ode to Eternity.");
      return true;
    }
    const clueIndices=[0,5,1,3,2,4];
    const clues=["I am the","I am not opposite the","I am next to the","I am not next to the","I am opposite the","I am not the"];
    player.sendMessage(`${clues[index]} ${["1st","2nd","3rd","4th","5th","6th"][order[clueIndices[index]]]}.`);
    return true;
  }

  function claimFallsPillarLocation(event) {
    const location = event?.location;
    if (FALLS_PILLAR_LOCATIONS.some(([x, y, z]) =>
      x === location?.x && y === location?.y && z === location?.z)) event.claimed = true;
  }

  function syncResistanceProgress(player) {
    const burned = new Set(String(player.getAttribute(INCITEMENTS) ?? "").split(","));
    for (const [key, varbit] of Object.entries(RESISTANCE_VARBITS)) {
      player.getPacketSender().sendVarbit(varbit, burned.has(key) ? 1 : 0);
    }
  }
  function syncResistanceLogin({ player }) {
    if (quest.isStarted(player)) syncResistanceProgress(player);
  }
  function lightWestArdougneSacks(event) {
    const player = event?.player;
    const loc = event?.location;
    if (!player || !loc || currentChapter(player) !== 4 || quest.isComplete(player)) return false;
    if (loc.x >= 2628 && loc.x <= 2637 && loc.y >= 3384 && loc.y <= 3388) return lightEastFarmSacks(event);
    const variant = loc.x >= 2524 && loc.x <= 2526 && loc.y >= 3285 && loc.y <= 3288
      ? "causing-an-insurrection-west-ardougne-setting-the-grain-sacks-inside-the-church-on-fire"
      : loc.x >= 2468 && loc.x <= 2470 && loc.y >= 3286 && loc.y <= 3288
        ? "causing-an-insurrection-west-ardougne-setting-the-grain-sacks-outside-the-general-store-on-fire"
        : loc.x >= 2516 && loc.x <= 2518 && loc.y >= 3314 && loc.y <= 3316
          ? "causing-an-insurrection-west-ardougne-setting-the-grain-sacks-in-the-central-civic-office-on-fire"
          : null;
    if (!variant) return false;
    event.handled = true;
    if (!wearingMourner(player)) {
      player.sendMessage("You should wear your mourner disguise before setting the sacks on fire.");
      return true;
    }
    return startTranscript(api, player, 0, PAGE, variant);
  }

  function lightEastFarmSacks(event) {
    const player = event?.player;
    const { x, y } = event?.location ?? {};
    if (!player || currentChapter(player) !== 4 || x < 2628 || x > 2637 || y < 3384 || y > 3388) return false;
    event.handled = true;
    if (!wearingDisguise(player)) {
      player.sendMessage("You should wear your Knight of Ardougne disguise before setting the sacks on fire.");
      return true;
    }
    addResistanceSupport(player, 4, "fire:east-farm");
    player.sendMessage("You set the grain sacks on fire, upsetting the farmers.");
    return true;
  }

  function lightEastDockBarrels(event) {
    const player = event?.player;
    const { x, y } = event?.location ?? {};
    if (!player || currentChapter(player) !== 4 || x < 2600 || x > 2700 || y < 3200 || y > 3400) return false;
    event.handled = true;
    if (!wearingDisguise(player)) {
      player.sendMessage("You should wear your Knight of Ardougne disguise before setting the fish barrels on fire.");
      return true;
    }
    addResistanceSupport(player, 4, "fire:east-docks");
    player.sendMessage("You set the fish barrels on fire, upsetting the dock workers.");
    return true;
  }
  function buildJournal(player) {
    if (quest.isComplete(player)) return ["Prifddinas has been restored.", "The war against the Iorwerth Clan is over."];
    const chapter = currentChapter(player);
    const names = [
      "Free Elena from the Ardougne prison.", "Disguise yourself as a Knight of Ardougne.",
      "Free Elena from the Ardougne prison.", "Meet the Ardougne resistance.",
      "Turn the people against King Lathas.", "Help the resistance overthrow the king.",
      "Fight the battle for East and West Ardougne.", "Confront Lord Iorwerth.",
      "Retreat to Lletya.", "Attend the first meeting.", "Visit Baxtorian Falls.",
      "Prepare to enter Prifddinas.", "Explore the Grand Library.",
      "Report back after the revelations.", "Recover the orb.",
      "Defend Lletya from the Iorwerth Clan.", "Help reunite the elven clans.",
      "Prepare at the dwarf camp.", "Seal the Underground Pass.",
      "Defeat the Fragment of Seren.", "Help rebuild Prifddinas.",
    ];
    const objective = names[Math.max(0, chapter)] ?? names[0];
    return chapter === 4 ? [`${objective} (${resistanceSupport(player)}/80 recruited)`] : [objective];
  }

  const ACTION_CHAPTER = {
    "jtPiC1": 2, "LeWWCS": 3,
    "Rc0W1H": 7, "UeAKgA": 11,
    "x04RMY": 11, "D1wXY6": 11, "EMxiFg": 11,
    "ycGZ1J": 12, "koxQh3": 13, "FoLVmk": 14,
    "XhOxpi": 15, "YAPX-R": 19, "FK0kOz": 19,
  };
  quest = registerQuest(api, {
    key: "song_of_the_elves",
    name: PAGE,
    varpId: 2305,
    varbitId: 9016,
    varbitValue: nativeEarlyProgress,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 4,
    otherRewards: [
      "40,000 XP in Agility, Construction, Farming, Herblore, Hunter, Mining, Smithing and Woodcutting",
      "Access to Prifddinas",
      "Ability to change your respawn point to Prifddinas",
    ],
    buildJournal,
    onReward(player) {
      for (const [skill] of REWARD_SKILLS) player.getSkillManager().addExperience(skill, 40000, false);
    },
  });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(fallsInventoryCondition);
  api.onNpcDialogueCondition(preparationCondition);
  api.onPlayerLogin(syncPreparationLogin);
  api.onPlayerLogin(syncLibraryLogin);
  api.onPlayerLogin(syncYsgawynReturnMeeting);
  api.onItemOnObject(useTrahaearnCrevice, {noted:false});
  api.onObjectInteraction("Blocked Crevice", {Inspect:useTrahaearnCrevice,Mine:useTrahaearnCrevice});
  api.onObjectInteraction("Crevice", {Enter:useTrahaearnCrevice});
  api.onNpcInteraction("Elderly Elf", {Investigate:inspectTrahaearn,"Fix-exoskeleton":fixTrahaearn});
  api.onCustomEvent("npc-dialogue:line", finishCampMeetingLine);
  api.onCustomEvent("npc-dialogue:line", finishEssylltChallengeLine);
  api.onCustomEvent("npc-dialogue:line", finishPreparationLine);
  api.onItemOnObject("Cadantine seed", "Farming patch", plantPreparationSeed, {noted:false});
  api.persistAttribute(PREPARATION_PROGRESS);
  api.persistAttribute(PREPARATION_ELDERS);
  api.persistAttribute(TRAHAEARN_CREVICE);
  api.persistAttribute(TRAHAEARN_REPAIRED);
  api.onObjectRoute(routeTrahaearnCrevice);
  api.onPlayerLogin(syncResistanceLogin);
  api.onPlayerLogin(resumeEarlyStory);
  api.onPlayerLogin(cleanupTransferredOrb);
  api.onPlayerLogin(restoreLegacyMeilyrClue);
  api.onPlayerLogin(({ player }) => {
    syncCrwysTree(player);
    sendIthellMeilyrVarbits(player);
    if (currentChapter(player) === 19 && player.getAttribute(FRAGMENT_DEFEATED) === true &&
      !player.getDialogueManager?.()?.isActive?.()) {
      startTranscript(api, player, NpcIdentifiers.LORD_IORWERTH, PAGE, "the-fragment-of-seren-the-fragment-defeated");
    } else if (currentChapter(player) === 20 && player.getAttribute(FRAGMENT_DEFEATED) === true &&
      !quest.isComplete(player)) {
      ensureWarEndActors(player);
      if (player.getAttribute(WAR_END_ARIANWYN_DONE) !== true && !player.getDialogueManager?.()?.isActive?.()) {
        player.moveTo(new Location(2241, 3266, 0));
        startTranscript(api, player, NpcIdentifiers.ARIANWYN_6, PAGE, "the-war-s-end-arianwyn-atones");
      }
    }
  });
  api.onPlayerLogout(onPlayerLogout);
  api.onNpcDialogueCondition((event) => {
    if (!event?.player) return null;
    const elenaResponse = elenaPreMeetingCondition(event);
    if (elenaResponse !== null) return elenaResponse;
    const answer = disguiseCondition(event);
    if (answer !== null) return answer;
    const incitement = recordIncitement(event);
    if (incitement !== null) return incitement;
    // Prose conditions are shared across every transcript. This fallback is only
    // meaningful on Song of the Elves pages; otherwise an unqualified quest
    // prerequisite check can suppress a different quest's dialogue branches.
    if (event.pages?.some((page) => page.page === PAGE)
      && event.text?.startsWith("If the player") && !requirementsMet(event.player)) return false;
    return null;
  });
  api.onCustomEvent("npc-dialogue:hook", onStart);
  api.persistAttribute(DISGUISE_BRIEFED);
  api.persistAttribute(ELENA_ESCAPE_PROGRESS);
  api.onCustomEvent("npc-dialogue:line", finishElenaPrisonLine);
  api.onCustomEvent("npc-dialogue:line", finishResistanceBriefing);
  api.onCustomEvent("npc-dialogue:line", finishArdougneBattleBriefing);
  api.onCustomEvent("npc-dialogue:line", finishHeadquartersWarning);
  api.onCustomEvent("npc-dialogue:line", finishDisguiseBriefing);
  api.onCustomEvent("npc-dialogue:line", finishWarEndArianwynLine);
  api.onCustomEvent("npc-dialogue:line", startOrbCaveAmbush);
  api.onCustomEvent("npc-dialogue:line", fillOrbCavePlayerName);
  api.onCustomEvent("npc-dialogue:line", finishEarlyStoryLine);
  api.onCustomEvent("npc-dialogue:line", handleLletyaConfrontationLine);
  api.onCustomEvent("world:object-examine", examineLletyaChild);
  api.onCustomEvent("world:object-examine", handleIthellSymbolExamine);
  api.onCustomEvent("world:object-examine", handleYsgawynTrackExamine);
  api.onCustomEvent("quest-song-of-the-elves:claim-arianwyn", claimArianwynAfterLibrary);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("player:emote", handleMeilyrSpin);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject("Explosive potion", "Hole", placeCampExplosive, { noted: false });
  api.onItemAction("Ode to eternity", { Read: readFallsOde });
  api.onItemAction("Spade", { Dig: handleMeilyrDig });
  api.onItemAction("Clue scroll", { Read: readMeilyrClue });
  api.onItemAction((event) => {
    handleCrystalSeedAction(event);
    useIorwerthCampTeleport(event);
  });
  api.onItemOnObject("Hand mirror", "Pillar of Light", useLibraryMirror, { noted: false });
  for (const color of Object.keys(LIBRARY_CRYSTAL_ITEMS)) {
    const name = color === "fractured" ? "Fractured crystal" : `${color[0].toUpperCase()}${color.slice(1)} crystal`;
    api.onItemOnObject(name, "Pillar of Light", useLibraryCrystal, { noted: false });
  }
  api.onObjectInteraction(handleLibraryObject);
  api.onObjectInteraction(touchIthellSymbol);
  api.onObjectInteraction(buildIthellStatue);
  api.onObjectInteraction("Table", { Search: searchLletyaChild });
  api.onObjectInteraction("Cooking Pots", { Search: searchLletyaChild });
  api.onObjectInteraction(enterOrbSupplyCave);
  api.onObjectInteraction(searchOrbChest);
  api.onObjectInteraction("Floating Book", { Climb: crossLibraryFloatingBooks });
  api.onObjectInteraction("Cave", { Ascend: enterTemplePassage });
  api.persistAttribute(CHEMICAL_CHOICE);
  api.persistAttribute(REVELATIONS_MEETING_STARTED);
  api.persistAttribute(CRWYS_CLUE_HEARD);
  api.persistAttribute(HEFIN_CLUE_HEARD);
  api.persistAttribute(YSGAWYN_TRACK_STEP);
  api.persistAttribute(YSGAWYN_RETURN_MEETING);
  api.persistAttribute(ELENA_PRE_MEETING_RESPONSE);
  api.persistAttribute(FALLS_PILLARS);
  api.persistAttribute(FALLS_ORDER);
  api.persistAttribute(INCITEMENTS);
  api.persistAttribute(RESISTANCE_MEMBERS);
  api.persistAttribute(RESISTANCE_BRIEFING);
  api.persistAttribute(WEST_BATTLE_KILLS);
  api.persistAttribute(HEADQUARTERS_WARNING_HEARD);
  api.persistAttribute(EAST_BATTLE_KILLS);
  api.persistAttribute(KING_SCENE_PROGRESS);
  api.persistAttribute(FIRST_MEETING_PROGRESS);
  api.persistAttribute(FALLS_INTRODUCTION);
  api.persistAttribute(FALLS_DEPARTURE);
  api.persistAttribute(FALLS_BOOK_READ);
  api.onObjectInteraction("Pillar", { Inspect: searchFallsPillar });
  api.onObjectInteraction("Crate", { Search: searchFallsKey });
  api.onCustomEvent("door:toggle", guardFallsDoors);
  api.onObjectInteraction("Log raft", { Board: boardFallsRaft });
  api.onObjectRoute(routeFallsRope);
  api.onObjectRoute(routeFallsDoors);
  api.onItemOnObject("Rope", "Rock", useFallsRope, {noted:false});
  api.onItemOnObject("Rope", "Dead Tree", useFallsRope, {noted:false});
  api.persistAttribute(LATE_CHAPTER);
  api.persistAttribute(WAR_END_ARIANWYN_DONE);
  api.persistAttribute(VALLEY_FIGURE);
  api.persistAttribute(LIBRARY_SEALS);
  api.persistAttribute(LIBRARY_PUZZLE);
  api.persistAttribute(LIBRARY_MIRRORS);
  api.persistAttribute(LIBRARY_CRYSTALS);
  api.persistAttribute(LIBRARY_PILLAR_STATE);
  api.persistAttribute(RECRUITED_ELDERS);
  api.persistAttribute(MEILYR_CLUE);
  api.persistAttribute(MEILYR_CLUE_ITEMS_MIGRATED);
  api.persistAttribute(ITHELL_SYMBOLS);
  api.persistAttribute(ITHELL_STATUE);
  api.persistAttribute(ITHELL_CLUE_STAGE);
  api.persistAttribute(ITHELL_RECRUITED);
  api.persistAttribute(CAMP_HOLES);
  api.persistAttribute(CAMP_EXPLOSIVES);
  api.persistAttribute(CAMP_DEFENSE);
  api.persistAttribute(CAMP_DEFENSE_COMPLETE);
  api.persistAttribute(CAMP_BATTLE);
  api.persistAttribute(CAMP_ARRIVAL_STARTED);
  api.persistAttribute(TEMPLE_CUTSCENE_STARTED);
  api.persistAttribute(FRAGMENT_DEFEATED);
  api.persistAttribute(LLETYA_CHILDREN);
  api.persistAttribute(LLETYA_TRAITOR_REVEALED);
  api.persistAttribute(LLETYA_ARIANWYN_CONFRONTED);
  api.onItemOnObject(placeFallsPillarItem, { noted: false });
  api.onItemOnObject("Tinderbox", "Sacks", lightWestArdougneSacks, { noted: false });
  api.onItemOnObject("Tinderbox", "Grain sacks", lightWestArdougneSacks, { noted: false });
  api.onItemOnObject("Tinderbox", "Barrel of fish", lightEastDockBarrels, { noted: false });
  api.onObjectInteraction("Pillar of Light", { Search: searchFallsPillar });
  api.onObjectInteraction("Cabinet", { Search: searchElenaCabinet });
  api.onObjectInteraction("Bed", { Search: searchRehnisonBed });
  api.onObjectInteraction("Trapdoor", { Open: enterResistanceBasement, "Climb-down": enterResistanceBasement });
  api.onObjectInteraction("Trapdoor", { Open: enterArdougneBattleBasement, "Climb-down": enterArdougneBattleBasement });
  api.onCustomEvent("ladders:climb", enterArdougneBattleBasement);
  api.onObjectInteraction("Staircase", { "Climb-down": enterPrison });
  api.onObjectRoute(routeCastleThroneStairs);
  api.onWalkRoute(routeToLadyHefin);
  api.onObjectRoute(routeYsgawynLeafTrap);
  api.onCustomEvent("ladders:climb", claimCastleThroneStairs);
  api.onCustomEvent("song-of-the-elves:claims-light-pillar", claimFallsPillarLocation);
  api.registerArea(new LletyaStoryArea([
    new Boundary(2320, 2390, 3150, 3210, 0), new Boundary(2320, 2390, 3150, 3210, 1),
  ]));
  api.registerArea(new FallsStoryArea([new Boundary(2598,2609,9904,9918,0)]));
  api.registerArea(new PreparationStoryArea([new Boundary(2330,2338,9570,9580,0)]));
  api.registerArea(new MeilyrPassArea([new Boundary(2298, 2320, 3202, 3222, 0)]));
  api.registerArea(new YsgawynClearingArea([new Boundary(2248, 2268, 3159, 3180, 0)]));
  api.registerArea(new HefinStoryArea([new Boundary(2270, 2308, 3087, 3117, 0)]));
  api.registerArea(new DwarvenCampAccessArea([new Boundary(2424, 2472, 6078, 6142, 0)]));
  api.registerArea(new FragmentThresholdArea([new Boundary(3282, 3307, 5906, 5930, 1)]));
  api.onNpcInteraction("Alrena", { "Talk-to": onTalk });
  api.onNpcInteraction("Memory of Seren", { "Talk-to": talkToLibraryMemory });
  api.onPlayerProcess(processYsgawynTrail);
  api.onNpcInteraction("Edmond", { "Talk-to": onTalk });
  api.onNpcInteraction("Elena", { "Talk-to": onTalk });
  api.onNpcInteraction("Knight of Ardougne", { "Talk-to": onTalk });
  for (const name of ["Eluned", "King Lathas", "King Thoros", "Councillor Halgrive", "Arianwyn", "Baxtorian", "Ysgawyn", "Mawrth", "Lord Ieuan Amlodd", "Lord Iorwerth", "General Hining", "Essyllt", "Lord Piquan Crwys", "Lady Carys Hefin", "Elf Hermit"]) {
    api.onNpcInteraction(name, { "Talk-to": onTalk });
  }
  api.onNpcInteraction(onCrwysTreeInteraction);
  api.onNpcsInteraction([...Object.keys(CITIZEN_SUPPORT), "Baker"], { "Talk-to": onTalk });
  api.onAnyNpcInteraction({ "Talk-to": onTalk });
  api.onNpcDeath(handleBattleDeath);
  api.onPlayerDeath(handleQuestPlayerDeath);
  api.onCombatHitRoll(forceFragmentSpecialHit);
  api.onNpcHitModify(handleFragmentHit);
};
