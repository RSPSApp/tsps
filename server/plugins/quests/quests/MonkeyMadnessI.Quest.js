/**
 * Monkey Madness I (members).
 *
 * The words come from the "Monkey Madness I" transcript page (plus the character
 * pages for the post-quest variants); this plugin supplies the variant selector
 * for every quest NPC, the prose-condition answers, the chapter 1 travel chain
 * (shipyard -> Daero -> hangar puzzle -> Crash Island), the Ape Atoll jail and
 * chapter 2 (Garkor/Zooknock, amulet of monkeyspeak, monkey talisman, greegree),
 * chapter 3 (disguise, Kruk, Awowogei, Ardougne Zoo) and chapter 4 (sigil, Jungle
 * Demon, reporting back to Narnode).
 *
 * Stages (varp 365, "mm_main"; the cache has no varbit on it, the quest-list CS2
 * 4024 reads the whole varp):
 *   1  started - Narnode handed over a Royal Seal
 *   2  spoke to G.L.O. Caranock at the shipyard
 *   3  returned to Narnode, received Narnode's orders
 *   4  orders delivered to Daero (hangar unlocked)
 *   5  reinitialisation complete (panel solved or Glough paid)
 *   6  landed on Crash Island
 *   7  on Ape Atoll - chapter 2 (jail, 10th squad, amulet/talisman work)
 *   8  greegree made - chapters 3 and 4 (disguise, Awowogei, sigil, demon)
 *   9  reported to King Narnode - quest complete
 *   10 post-quest Daero training claimed
 *
 * Stage evidence: cache dbTable 0 row 95 ("Monkey Madness I") column 19 stores 9,
 * the same column Cold War reads its completion 135 from, and CS2 1901/2664 test
 * `get_varp 365 >= 9`; CS2 9104 gates an Ape Atoll unlock on `>= 2`. The finer
 * boundaries (3-8) are this plugin's ordering. Related cache state: varp 372
 * "mm_gnomes" holds the bitfields mm_narnode/caranock/daero/waydar/lumdo/garkor/
 * zooknock/karam/lumo (varbits 121-129); the NPC spawn placeholders 2020 (Daero),
 * 2021 (Waydar) and 2022 (Lumdo) resolve through varbits 123/124/125, so those
 * three are kept in sync (mm_daero 1/5/6/7 and mm_lumdo 3 follow Quest Helper's
 * VarbitID.MM_* reads; the 1444->1445 and 1453->1454 transform flips sit at 4 and
 * 3 respectively). Post-quest Daero training is "365 9->10" per Quest Helper.
 *
 * Sources: OSRS Wiki "Monkey Madness I", its Quick guide and Transcript page;
 * the cache for every id, placement and varbit (dump:loc, varbit lookup, CS2
 * disassembly); Quest Helper's MonkeyMadnessI helper for the mm_gnomes thresholds,
 * the jail/valley/dungeon zones and the "several hours later" training values.
 * No other private-server source was used.
 *
 * Gaps / approximations (documented in the runthrough):
 *  - Waydar's sliding puzzle has no minigame: once Daero has briefed the player
 *    in the hangar (mm_daero 5), operating the Reinitialisation Panel completes
 *    it (or Glough takes 200,000 coins).
 *  - "Monkey form" is the Karamjan monkey greegree equipped in the weapon slot
 *    (item 4031), checked live; the transformation itself is the Greegrees item
 *    plugin's. Monkey NPCs are not made aggressive here.
 *  - Jail: no guard patrol or re-capture (the "getting sent back to jail"
 *    counters and the 100-times reward are answered false/never played). The
 *    knock-out zone west of Marim jails the player once; the cell door opens by
 *    picking its lock.
 *  - The Monkey's Aunt catching the player and the "item on the monkey child"
 *    variant are not simulated; the child's "enough time has passed" waits are a
 *    30 second timer instead of an aunt round trip.
 *  - Teleports use fixed tiles; the chapter 4 arena is the cache's jungle-demon
 *    room on plane 1, and only the Jungle Demon is spawned for the fight (no
 *    squad NPCs, no cutscenes).
 *  - The start requires The Grand Tree and Tree Gnome Village (the wiki's
 *    requirement list); the quest has no skill requirement, so none is
 *    enforced.
 *  - The wiki's "teleporting loses the monkey" rule is not enforced.
 *  - Daero (npc 2020) is an existing Grand Tree first-floor spawn; this plugin
 *    only re-sends its mm_daero transform varbit, it does not spawn a duplicate.
 *  - The quest owns four climbs (the temple trapdoor, the two underground
 *    ropes and the watchtower's top ladder). Each claim is scoped to the
 *    object's own placement in the cache and to the direction the clicked
 *    option names; the climb itself is handed to the Ladders plugin with an
 *    explicit destination, so it animates and walks the collision map.
 *  - The 10,000 coins and the three diamonds go through the engine's reward
 *    overflow path (the pattern Waterfall Quest uses), so a full bag drops
 *    them at the player's feet instead of losing them.
 *  - The throne object (4771) stays with this plugin; after Monkey Madness II
 *    it plays MM2's canonical "after-completing-monkey-madness-ii" page, since
 *    MM2 releases its own Awowogei when it completes.
 */
module.exports = function registerMonkeyMadnessIQuest(api) {
  const {
    Equipment,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  // ==========================================================================
  // Ids and constants
  // ==========================================================================

  const PAGE = "Monkey Madness I";

  const VARP_MM_MAIN = 365; // "mm_main"
  const VARBIT_MM_NARNODE = 121; // varp 372 bits 0-4
  const VARBIT_MM_CARANOCK = 122; // varp 372 bits 5-6
  const VARBIT_MM_DAERO = 123; // varp 372 bits 7-10
  const VARBIT_MM_WAYDAR = 124; // varp 372 bits 11-12
  const VARBIT_MM_LUMDO = 125; // varp 372 bits 13-15
  const VARBIT_MM_GARKOR = 126; // varp 372 bits 16-18
  const VARBIT_MM_ZOOKNOCK = 127; // varp 372 bits 19-21

  const STAGE_STARTED = 1;
  const STAGE_SHIPYARD = 2;
  const STAGE_ORDERS = 3;
  const STAGE_DAERO = 4;
  const STAGE_REINITIALISED = 5;
  const STAGE_CRASH_ISLAND = 6;
  const STAGE_ATOLL = 7;
  const STAGE_CHAPTERS = 8;
  const STAGE_COMPLETE = 9;
  const STAGE_TRAINING = 10;

  const NARNODE_IDS = new Set([
    NpcIdentifiers.KING_NARNODE_SHAREEN, // 8019
    NpcIdentifiers.KING_NARNODE_SHAREEN_2, // 8020
  ]);
  const FOREMAN_IDS = new Set([NpcIdentifiers.FOREMAN]); // 1429
  const SHIPYARD_WORKER_IDS = new Set([
    NpcIdentifiers.SHIPYARD_WORKER, // 1430
    NpcIdentifiers.SHIPYARD_WORKER_2, // 3904
    NpcIdentifiers.SHIPYARD_WORKER_3, // 3905
    NpcIdentifiers.SHIPYARD_WORKER_4, // 5457
    NpcIdentifiers.SHIPYARD_WORKER_5, // 5729
  ]);
  const CARANOCK_IDS = new Set([NpcIdentifiers.G_L_O_CARANOCK]); // 1460
  const DAERO_IDS = new Set([
    NpcIdentifiers.DAERO, // 1444, one option
    NpcIdentifiers.DAERO_2, // 1445, with Travel
  ]);
  const WAYDAR_IDS = new Set([
    NpcIdentifiers.WAYDAR, // 1446, with Travel
    NpcIdentifiers.WAYDAR_2, // 6675, before the first flight
  ]);
  const LUMDO_IDS = new Set([
    NpcIdentifiers.LUMDO_2, // 1453, no Travel
    NpcIdentifiers.LUMDO_3, // 1454, with Travel
  ]);
  const GARKOR_IDS = new Set([
    NpcIdentifiers.GARKOR, // 1434
    NpcIdentifiers.GARKOR_2, // 7111
    NpcIdentifiers.GARKOR_3, // 7158
    NpcIdentifiers.GARKOR_4, // 7159
  ]);
  const LUMO_IDS = new Set([
    NpcIdentifiers.LUMO, // 1435
    NpcIdentifiers.LUMO_2, // 7112
    NpcIdentifiers.LUMO_3, // 7160
    NpcIdentifiers.LUMO_4, // 7161
  ]);
  const ZOOKNOCK_IDS = new Set([
    NpcIdentifiers.ZOOKNOCK, // 1442
    NpcIdentifiers.ZOOKNOCK_2, // 7113
    NpcIdentifiers.ZOOKNOCK_3, // 7170
    NpcIdentifiers.ZOOKNOCK_4, // 7171
  ]);
  const KARAM_IDS = new Set([
    NpcIdentifiers.KARAM, // 1439
    NpcIdentifiers.KARAM_2, // 7172
    NpcIdentifiers.KARAM_3, // 7173
    NpcIdentifiers.KARAM_4, // 7174
  ]);
  const KRUK_IDS = new Set([
    NpcIdentifiers.KRUK, // 5257
    NpcIdentifiers.KRUK_2, // 6804
    NpcIdentifiers.KRUK_4, // 7099
  ]);
  const ELDER_GUARD_IDS = new Set([
    NpcIdentifiers.ELDER_GUARD, // 5277
    NpcIdentifiers.ELDER_GUARD_2, // 5278
  ]);
  const MONKEY_CHILD_IDS = new Set([NpcIdentifiers.MONKEY_CHILD]); // 5268
  const MONKEY_MINDER_IDS = new Set([NpcIdentifiers.MONKEY_MINDER]); // 5235
  const ZOO_MONKEY_IDS = new Set([
    NpcIdentifiers.MONKEY_7, // 5279
    NpcIdentifiers.MONKEY_8, // 5280
  ]);
  const WAYMOTTIN_IDS = new Set([
    NpcIdentifiers.WAYMOTTIN, // 1441
    NpcIdentifiers.WAYMOTTIN_2, // 7168
    NpcIdentifiers.WAYMOTTIN_3, // 7169
  ]);
  const GLOUGH_IDS = new Set([
    NpcIdentifiers.GLOUGH, // 1425
    NpcIdentifiers.GLOUGH_2, // 2061
    NpcIdentifiers.GLOUGH_3, // 7100
    NpcIdentifiers.GLOUGH_7, // 7115
  ]);
  const BONZARA_IDS = new Set([NpcIdentifiers.BONZARA]); // 5284
  // The MM1 Awowogei is an object (4771) whose Talk-to is driven by this plugin;
  // 5264 is the matching "Awowogei" NPC definition, used as the chathead.
  const AWOWOGEI_OBJECT_ID = ObjectIdentifiers.AWOWOGEI; // 4771
  const AWOWOGEI_CHATHEAD_ID = NpcIdentifiers.AWOWOGEI_3; // 5264
  // Monkey Madness II spawns its own Awowogei (6812) and releases it when the
  // quest completes; the throne object stays here, so the chathead for MM2's
  // canonical post-quest page is the same npc.
  const AWOWOGEI_MM2_CHATHEAD_ID = NpcIdentifiers.AWOWOGEI_4; // 6812
  const AWOWOGEI_PAGE = "Awowogei";

  // The wiki's requirement list: The Grand Tree and Tree Gnome Village must be
  // finished before Narnode asks for help. The quest has no skill requirement.
  const PREREQUISITE_QUESTS = ["grand_tree", "tree_gnome_village"];

  // Transcript chatheads passed to startTranscript for object/item-driven pages.
  const CRATE_CHATHEAD_ID = NpcIdentifiers.DAERO; // 1444, never speaks in those pages
  const DUNGEON_CHATHEAD_ID = NpcIdentifiers.ZOOKNOCK; // 1442
  const GARKOR_CHATHEAD_ID = NpcIdentifiers.GARKOR; // 1434

  // Every npc id whose transcript events this quest answers.
  const DIALOGUE_NPC_IDS = new Set([
    ...NARNODE_IDS, ...FOREMAN_IDS, ...SHIPYARD_WORKER_IDS, ...CARANOCK_IDS,
    ...DAERO_IDS, ...WAYDAR_IDS, ...LUMDO_IDS, ...GARKOR_IDS, ...LUMO_IDS,
    ...ZOOKNOCK_IDS, ...KARAM_IDS, ...KRUK_IDS, ...ELDER_GUARD_IDS,
    ...MONKEY_CHILD_IDS, ...MONKEY_MINDER_IDS, ...ZOO_MONKEY_IDS,
    ...WAYMOTTIN_IDS, ...GLOUGH_IDS, ...BONZARA_IDS,
    CRATE_CHATHEAD_ID, DUNGEON_CHATHEAD_ID, AWOWOGEI_CHATHEAD_ID,
  ]);

  const GNOME_ROYAL_SEAL_ITEM = ItemIdentifiers.GNOME_ROYAL_SEAL; // 4004
  const NARNODES_ORDERS_ITEM = ItemIdentifiers.NARNODES_ORDERS; // 4005
  const SPARE_CONTROLS_ITEM = ItemIdentifiers.SPARE_CONTROLS; // 4002
  const MAMULET_MOULD_ITEM = ItemIdentifiers.MAMULET_MOULD; // 4020
  const MONKEY_DENTURES_ITEM = ItemIdentifiers.MONKEY_DENTURES; // 4006
  const ENCHANTED_BAR_ITEM = ItemIdentifiers.ENCHANTED_BAR; // 4007
  const MSPEAK_AMULET_ITEM = ItemIdentifiers.MSPEAK_AMULET; // 4021, strung
  const MSPEAK_AMULET_UNSTRUNG_ITEM = ItemIdentifiers.MSPEAK_AMULET_2; // 4022
  const MONKEY_TALISMAN_ITEM = ItemIdentifiers.MONKEY_TALISMAN; // 4023
  const KARAMJAN_GREEGREE_ITEM = ItemIdentifiers.KARAMJAN_MONKEY_GREEGREE; // 4031
  const SQUAD_SIGIL_ITEM = ItemIdentifiers._10TH_SQUAD_SIGIL; // 4035
  const MONKEY_ITEM = ItemIdentifiers.MONKEY; // 4033, the zoo monkey in the backpack
  const MONKEY_CORPSE_ITEM = ItemIdentifiers.MONKEY_CORPSE; // 3166
  const MONKEY_BONES_ITEMS = new Set([
    ItemIdentifiers.MONKEY_BONES, // 3183
    ItemIdentifiers.MONKEY_BONES_6, // 3184
  ]);
  const BANANA_ITEM = ItemIdentifiers.BANANA; // 1963
  const GOLD_BAR_ITEM = ItemIdentifiers.GOLD_BAR; // 2357
  const BALL_OF_WOOL_ITEM = ItemIdentifiers.BALL_OF_WOOL; // 1759
  const COINS_ITEM = ItemIdentifiers.COINS; // 995
  const DIAMOND_ITEM = ItemIdentifiers.DIAMOND; // 1601
  const GLOUGH_PRICE = 200000;

  const SHIPYARD_GATE_IDS = new Set([
    ObjectIdentifiers.GATE_55, // 2438
    ObjectIdentifiers.GATE_56, // 2439
  ]);
  const SPARE_CONTROLS_CRATE_ID = ObjectIdentifiers.CRATE_56; // 4746
  const HOLE_CRATE_ID = ObjectIdentifiers.CRATE_42; // 4714
  const DENTURES_CRATE_ID = ObjectIdentifiers.CRATE_43; // 4715
  const BANANA_CRATE_IDS = new Set([
    ObjectIdentifiers.CRATE_50, // 4722
    ObjectIdentifiers.CRATE_51, // 4723
  ]);
  const MOULD_CRATE_ID = ObjectIdentifiers.CRATE_52; // 4724
  const BANANA_TREE_IDS = new Set([
    ObjectIdentifiers.BANANA_TREE_7, // 4749
    ObjectIdentifiers.BANANA_TREE_8, // 4750
    ObjectIdentifiers.BANANA_TREE_9, // 4751
    ObjectIdentifiers.BANANA_TREE_10, // 4752
    ObjectIdentifiers.BANANA_TREE_11, // 4753
    ObjectIdentifiers.BANANA_TREE_12, // 4754
  ]);
  const WALL_OF_FLAME_IDS = new Set([
    ObjectIdentifiers.WALL_OF_FLAME, // 4765
    ObjectIdentifiers.WALL_OF_FLAME_2, // 4766
  ]);
  const BAMBOO_GATE_IDS = new Set([
    ObjectIdentifiers.BAMBOO_GATE, // 4787
    ObjectIdentifiers.BAMBOO_GATE_2, // 4788
  ]);
  const JAIL_DOOR_IDS = new Set([
    ObjectIdentifiers.JAIL_DOOR, // 4799
    ObjectIdentifiers.JAIL_DOOR_2, // 4800
  ]);
  const REINITIALISATION_PANEL_ID = ObjectIdentifiers.REINITIALISATION_PANEL; // 4871
  const TEMPLE_TRAPDOOR_IDS = new Set([
    ObjectIdentifiers.TRAPDOOR_20, // 4879
    ObjectIdentifiers.TRAPDOOR_21, // 4880
  ]);
  const TEMPLE_ROPE_ID = ObjectIdentifiers.CLIMBING_ROPE_7; // 4881
  const MOULD_ROOM_ROPE_ID = ObjectIdentifiers.CLIMBING_ROPE_8; // 4889, at 2764,9165
  // The east watchtower top ladder at 2729,2766 plane 2; ClimbLinks stops at the
  // decorative plane-1 ladder, whose adjacent landing tiles are all blocked.
  const WATCHTOWER_TOP_EAST_ID = ObjectIdentifiers.BAMBOO_LADDER_7; // 4776

  // Where those four objects stand in the cache, so a claim only fires for the
  // object the player actually clicked and only from the plane it stands on.
  const TEMPLE_TRAPDOOR_TILE = new Location(2807, 2785, 0);
  const TEMPLE_ROPE_TILE = new Location(2808, 9201, 0);
  const MOULD_ROOM_ROPE_TILE = new Location(2764, 9165, 0);
  const WATCHTOWER_TOP_TILE = new Location(2729, 2766, 2);

  const JUNGLE_DEMON_NPC_ID = NpcIdentifiers.JUNGLE_DEMON; // 1443

  // Tiles (Quest Helper walkthrough; each checked walkable in the cache collision map).
  const HANGAR_LANDING = new Location(2394, 9889, 0);
  const STRONGHOLD_LANDING = new Location(2395, 3500, 0);
  const CRASH_ISLAND_LANDING = new Location(2892, 2725, 0);
  const ATOLL_LANDING = new Location(2803, 2707, 0);
  const JAIL_CELL = new Location(2772, 2795, 0);
  const JAIL_EXIT = new Location(2779, 2802, 0);
  const THRONE_ROOM = new Location(2800, 2762, 0);
  const MOULD_ROOM_LANDING = new Location(2765, 9165, 0);
  const DENTURE_HOUSE_LANDING = new Location(2770, 2767, 0);
  const TEMPLE_DUNGEON_LANDING = new Location(2808, 9200, 0);
  const TEMPLE_SURFACE_LANDING = new Location(2807, 2784, 0);
  const ATOLL_SURFACE_LANDING = new Location(2805, 2786, 0);
  const ARENA_PLAYER = new Location(2713, 9174, 1);
  const ARENA_DEMON = new Location(2713, 9168, 1);
  const ZOO_PEN = new Location(2602, 3280, 0);
  const ZOO_OUTSIDE = new Location(2596, 3276, 0);
  const WATCHTOWER_KRUK_LANDING = new Location(2730, 2766, 0);

  const ZOO_IDS = { minX: 2594, maxX: 2612, minY: 3272, maxY: 3286 };
  const WEST_VALLEY_ZONE = { minX: 2687, maxX: 2737, minY: 2738, maxY: 2766, levels: [0] };
  const HANGAR_ZONES = [
    { minX: 2380, maxX: 2406, minY: 9869, maxY: 9913, levels: [0] },
    { minX: 2635, maxX: 2662, minY: 4492, maxY: 4533, levels: [0] },
  ];

  const CHILD_WAIT_MS = 30000; // "enough time has passed" approximation
  const BANANAS_FOR_CHILD = 5;

  // The cache's option spellings for each climb direction. A bare "Climb" is
  // the ropes' only option and only leads up, so it counts as climbing up.
  const CLIMB_UP_OPTIONS = new Set([
    "climb-up", "climb up", "climb", "walk-up", "ascend", "top-floor",
  ]);
  const CLIMB_DOWN_OPTIONS = new Set([
    "climb-down", "climb down", "walk-down", "descend", "bottom-floor",
  ]);

  // ==========================================================================
  // Persisted attributes
  // ==========================================================================

  const DECLINED_ATTRIBUTE = "quest.monkey_madness_i.declined";
  const FOREMAN_MET_ATTRIBUTE = "quest.monkey_madness_i.foreman-met";
  const DAERO_STATE_ATTRIBUTE = "quest.monkey_madness_i.mm-daero";
  const WAYDAR_STATE_ATTRIBUTE = "quest.monkey_madness_i.mm-waydar";
  const LUMDO_STATE_ATTRIBUTE = "quest.monkey_madness_i.mm-lumdo";
  const HANGAR_INTRO_ATTRIBUTE = "quest.monkey_madness_i.hangar-intro";
  const POST_PUZZLE_TALK_ATTRIBUTE = "quest.monkey_madness_i.post-puzzle-talk";
  const WAYDAR_CRASH_TALK_ATTRIBUTE = "quest.monkey_madness_i.waydar-crash";
  const LUMDO_TALKS_ATTRIBUTE = "quest.monkey_madness_i.lumdo-talks";
  const JAIL_STATE_ATTRIBUTE = "quest.monkey_madness_i.jail"; // 0 never, 1 jailed, 2 escaped
  const GARKOR_MET_ATTRIBUTE = "quest.monkey_madness_i.garkor-met";
  const GARKOR_ASKED_ATTRIBUTE = "quest.monkey_madness_i.garkor-asked";
  const GARKOR_DISGUISED_ATTRIBUTE = "quest.monkey_madness_i.garkor-disguised";
  const CHAPTER4_SEEN_ATTRIBUTE = "quest.monkey_madness_i.chapter4-seen";
  const SIGIL_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.sigil-given";
  const SIGIL_USED_ATTRIBUTE = "quest.monkey_madness_i.sigil-used";
  const DEMON_KILLED_ATTRIBUTE = "quest.monkey_madness_i.demon-killed";
  const ZOOKNOCK_MET_ATTRIBUTE = "quest.monkey_madness_i.zooknock-met";
  const NARNODE_HELPER_ATTRIBUTE = "monkey-madness-i:narnode-progress";
  const CARANOCK_HELPER_ATTRIBUTE = "monkey-madness-i:caranock-progress";
  const GARKOR_HELPER_ATTRIBUTE = "monkey-madness-i:garkor-progress";
  const ZOOKNOCK_HELPER_ATTRIBUTE = "monkey-madness-i:zooknock-progress";
  const MOULD_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.mould-given";
  const DENTURES_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.dentures-given";
  const BAR_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.bar-given";
  const TALISMAN_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.talisman-given";
  const REMAINS_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.remains-given";
  const CHILD_TALKS_ATTRIBUTE = "quest.monkey_madness_i.child-talks";
  const CHILD_UNCLE_ATTRIBUTE = "quest.monkey_madness_i.child-uncle";
  const CHILD_WANTED_ATTRIBUTE = "quest.monkey_madness_i.child-wanted";
  const CHILD_BANANAS_AT_ATTRIBUTE = "quest.monkey_madness_i.child-bananas-at";
  const CHILD_TOY_GIVEN_ATTRIBUTE = "quest.monkey_madness_i.child-toy";
  const CHILD_TOY_LOST_AT_ATTRIBUTE = "quest.monkey_madness_i.child-toy-lost-at";
  const LUMO_TALKS_ATTRIBUTE = "quest.monkey_madness_i.lumo-talks";
  const MONKEY_CAPTURED_ATTRIBUTE = "quest.monkey_madness_i.monkey-captured";
  const AWOWOGEI_MET_ATTRIBUTE = "quest.monkey_madness_i.awowogei-met";
  const MONKEY_DELIVERED_ATTRIBUTE = "quest.monkey_madness_i.monkey-delivered";
  const TRAINING_CLAIMED_ATTRIBUTE = "quest.monkey_madness_i.training-claimed";

  const PERSISTED_ATTRIBUTES = [
    DECLINED_ATTRIBUTE, FOREMAN_MET_ATTRIBUTE, DAERO_STATE_ATTRIBUTE,
    WAYDAR_STATE_ATTRIBUTE, LUMDO_STATE_ATTRIBUTE, HANGAR_INTRO_ATTRIBUTE,
    POST_PUZZLE_TALK_ATTRIBUTE, WAYDAR_CRASH_TALK_ATTRIBUTE, LUMDO_TALKS_ATTRIBUTE,
    JAIL_STATE_ATTRIBUTE, GARKOR_MET_ATTRIBUTE, GARKOR_ASKED_ATTRIBUTE,
    GARKOR_DISGUISED_ATTRIBUTE, CHAPTER4_SEEN_ATTRIBUTE, SIGIL_GIVEN_ATTRIBUTE,
    SIGIL_USED_ATTRIBUTE, DEMON_KILLED_ATTRIBUTE, ZOOKNOCK_MET_ATTRIBUTE,
    MOULD_GIVEN_ATTRIBUTE, DENTURES_GIVEN_ATTRIBUTE, BAR_GIVEN_ATTRIBUTE,
    TALISMAN_GIVEN_ATTRIBUTE, REMAINS_GIVEN_ATTRIBUTE,
    CHILD_TALKS_ATTRIBUTE, CHILD_UNCLE_ATTRIBUTE, CHILD_WANTED_ATTRIBUTE,
    CHILD_BANANAS_AT_ATTRIBUTE, CHILD_TOY_GIVEN_ATTRIBUTE, CHILD_TOY_LOST_AT_ATTRIBUTE,
    LUMO_TALKS_ATTRIBUTE, MONKEY_CAPTURED_ATTRIBUTE, AWOWOGEI_MET_ATTRIBUTE,
    MONKEY_DELIVERED_ATTRIBUTE, TRAINING_CLAIMED_ATTRIBUTE,
  ];

  const demons = new Map();

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) !== value) quest.setStage(player, value);
  }

  /** Asks QuestRuntime whether another registered quest has completed. */
  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function otherQuestStage(player, key) {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number.isFinite(request.stage) ? request.stage | 0 : 0;
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function addItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function attribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function flag(player, key) {
    return player.getAttribute(key) === true;
  }

  function optionOf(event) {
    const actions = event.definition?.getActions?.() ?? [];
    return actions[event.clickType - 1] ?? null;
  }

  function monkeyForm(player) {
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === KARAMJAN_GREEGREE_ITEM;
  }

  function wearingSpeakAmulet(player) {
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === MSPEAK_AMULET_ITEM;
  }

  function hasSpeakAmulet(player) {
    return hasItem(player, MSPEAK_AMULET_ITEM) || wearingSpeakAmulet(player);
  }

  function inZone(location, zone) {
    if (!location) return false;
    const z = location.getZ?.() ?? location.z ?? 0;
    if (zone.levels && !zone.levels.includes(z)) return false;
    return location.getX() >= zone.minX && location.getX() <= zone.maxX
      && location.getY() >= zone.minY && location.getY() <= zone.maxY;
  }

  function inHangar(player) {
    return HANGAR_ZONES.some((zone) => inZone(player.getLocation(), zone));
  }

  function onCrashIsland(player) {
    return player.getLocation().getX() >= 2850;
  }

  function daeroState(player) {
    return attribute(player, DAERO_STATE_ATTRIBUTE);
  }

  function setDaeroState(player, value) {
    player.setAttribute(DAERO_STATE_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_MM_DAERO, value | 0);
  }

  function waydarState(player) {
    return attribute(player, WAYDAR_STATE_ATTRIBUTE);
  }

  function setWaydarState(player, value) {
    player.setAttribute(WAYDAR_STATE_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_MM_WAYDAR, value | 0);
  }

  function lumdoState(player) {
    return attribute(player, LUMDO_STATE_ATTRIBUTE);
  }

  function setLumdoState(player, value) {
    player.setAttribute(LUMDO_STATE_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_MM_LUMDO, value | 0);
  }

  function setHelperProgress(player, attributeKey, varbitId, value) {
    player.setAttribute(attributeKey, value);
    player.getPacketSender().sendVarbit(varbitId, value);
  }

  /** Re-sends the mm_gnomes varbits the spawn placeholders resolve through. */
  function syncGnomeVarps(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_MM_NARNODE, attribute(player, NARNODE_HELPER_ATTRIBUTE));
    sender.sendVarbit(VARBIT_MM_CARANOCK, attribute(player, CARANOCK_HELPER_ATTRIBUTE));
    sender.sendVarbit(VARBIT_MM_DAERO, daeroState(player));
    sender.sendVarbit(VARBIT_MM_WAYDAR, waydarState(player));
    sender.sendVarbit(VARBIT_MM_LUMDO, lumdoState(player));
    sender.sendVarbit(VARBIT_MM_GARKOR, attribute(player, GARKOR_HELPER_ATTRIBUTE));
    sender.sendVarbit(VARBIT_MM_ZOOKNOCK, attribute(player, ZOOKNOCK_HELPER_ATTRIBUTE));
  }

  function addSeal(player) {
    // The transcript's AT80aC message step already says Narnode hands it over.
    if (!hasItem(player, GNOME_ROYAL_SEAL_ITEM)) addItem(player, GNOME_ROYAL_SEAL_ITEM);
  }

  // ==========================================================================
  // Variant selectors
  // ==========================================================================

  function selectNarnodeVariant({ npcId, player }) {
    if (!NARNODE_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    // Monkey Madness II also owns Narnode after The Grand Tree. Yield so its
    // later selector can choose the active quest's canonical transcript.
    if (stage >= STAGE_COMPLETE && otherQuestStage(player, "grand_tree") >= 160) return null;
    if (stage >= STAGE_COMPLETE) return { page: "King Narnode Shareen", variant: "after-monkey-madness-i" };
    if (stage >= STAGE_CHAPTERS) {
      return flag(player, DEMON_KILLED_ATTRIBUTE)
        ? "chapter-4-returning-to-king-narnode"
        : "chapter-1-talking-to-king-narnode-after-starting-the-quest";
    }
    if (stage >= STAGE_STARTED && !hasItem(player, GNOME_ROYAL_SEAL_ITEM)) {
      // No dedicated "lost the seal" dialogue exists in the dump; the start page's
      // "Yes." branch re-issues the seal through its AT80aC message step.
      return "chapter-1-talking-to-king-narnode-shareen";
    }
    if (stage === 0) {
      return flag(player, DECLINED_ATTRIBUTE)
        ? "chapter-1-talking-to-king-narnode-again-after-previously-declining-to-help"
        : "chapter-1-talking-to-king-narnode-shareen";
    }
    if (stage === STAGE_SHIPYARD) {
      return "chapter-1-returning-to-king-narnode";
    }
    if (stage >= STAGE_DAERO) return "chapter-1-talking-to-king-narnode-after-starting-the-quest";
    return "chapter-1-talking-to-king-narnode-after-starting-the-quest";
  }

  function selectForemanVariant({ npcId }) {
    if (!FOREMAN_IDS.has(npcId)) return null;
    return "chapter-1-talking-to-the-foreman";
  }

  function selectShipyardWorkerVariant({ npcId, player }) {
    if (!SHIPYARD_WORKER_IDS.has(npcId)) return null;
    if (stageOf(player) === 0) return null; // gate-guard-during-the-grand-tree
    return { page: PAGE, variant: "chapter-1-trying-to-enter-the-ship-yard" };
  }

  function selectCaranockVariant({ npcId, player }) {
    if (!CARANOCK_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return { page: "G.L.O. Caranock", variant: "after-monkey-madness-i" };
    if (stage === STAGE_STARTED) {
      return "chapter-1-talking-to-g-l-o-caranock";
    }
    if (stage >= STAGE_SHIPYARD) return "chapter-1-talking-to-caranock-again";
    return null;
  }

  function selectDaeroVariant({ npcId, player }) {
    if (!DAERO_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-daero";
    const state = daeroState(player);
    if (stage >= STAGE_REINITIALISED && inHangar(player)) {
      if (!flag(player, POST_PUZZLE_TALK_ATTRIBUTE)) {
        return "chapter-1-the-underground-hangar-speaking-to-daero-in-the-underground-hangar-after-the-puzzle-is-complete";
      }
      return "chapter-1-speaking-to-waydar-after-solving-the-puzzle-talking-to-daero-again";
    }
    if (stage >= STAGE_REINITIALISED) {
      return "chapter-1-the-underground-hangar-talking-to-daero-outside-of-the-bunker";
    }
    if (stage >= STAGE_DAERO) {
      if (inHangar(player)) {
        if (!flag(player, HANGAR_INTRO_ATTRIBUTE)) {
          player.setAttribute(HANGAR_INTRO_ATTRIBUTE, true);
          if (state < 5) setDaeroState(player, 5);
          return "chapter-1-the-underground-hangar-speaking-to-daero-in-the-underground-hangar";
        }
        return "chapter-1-the-underground-hangar-talking-to-daero-in-the-hangar-before-completing-the-puzzle";
      }
      return "chapter-1-the-underground-hangar-talking-to-daero-outside-of-the-bunker";
    }
    if (stage === STAGE_ORDERS) return "chapter-1-speaking-to-daero";
    return null;
  }

  function selectWaydarVariant({ npcId, player }) {
    if (!WAYDAR_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return { page: "Waydar", variant: "after-monkey-madness-i" };
    if (stage >= STAGE_REINITIALISED) {
      if (onCrashIsland(player)) {
        if (!flag(player, WAYDAR_CRASH_TALK_ATTRIBUTE)) {
          player.setAttribute(WAYDAR_CRASH_TALK_ATTRIBUTE, true);
          return "chapter-1-landing-on-crash-island-speaking-to-waydar-on-crash-island";
        }
        return "chapter-1-landing-on-crash-island-returning-to-waydar-on-crash-island";
      }
      if (inHangar(player)) {
        return flag(player, POST_PUZZLE_TALK_ATTRIBUTE)
          ? "chapter-1-speaking-to-waydar-after-solving-the-puzzle-travelling-with-waydar"
          : "chapter-1-speaking-to-waydar-after-solving-the-puzzle";
      }
      return null;
    }
    if (stage >= STAGE_DAERO) {
      if (inHangar(player)) {
        return flag(player, HANGAR_INTRO_ATTRIBUTE)
          ? "chapter-1-the-underground-hangar-talking-to-waydar-before-completing-the-puzzle"
          : "chapter-1-the-underground-hangar-talking-to-waydar-before-daero";
      }
      return null;
    }
    return null;
  }

  function selectLumdoVariant({ npcId, player }) {
    if (!LUMDO_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return null; // on-ape-atoll / on-crash-island
    if (stage >= STAGE_ATOLL) {
      return onCrashIsland(player)
        ? "chapter-2-talking-to-lumbo-on-crash-island"
        : "chapter-2-talking-to-lumbo-on-ape-atoll";
    }
    if (stage >= STAGE_CRASH_ISLAND) {
      const talks = attribute(player, LUMDO_TALKS_ATTRIBUTE);
      if (lumdoState(player) < 3) {
        player.setAttribute(LUMDO_TALKS_ATTRIBUTE, talks + 1);
        return talks === 0
          ? "chapter-1-landing-on-crash-island-speaking-to-lumdo"
          : "chapter-1-landing-on-crash-island-talking-to-lumbo-again";
      }
      return "chapter-2-talking-to-lumbo-on-crash-island";
    }
    return null;
  }

  function selectGarkorVariant({ npcId, player }) {
    if (!GARKOR_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return { page: "Garkor", variant: "standard-dialogue-after-monkey-madness-i" };
    if (stage < STAGE_ATOLL) return null;
    if (flag(player, DEMON_KILLED_ATTRIBUTE)) return "chapter-4-talking-to-garkor-after-killing-the-jungle-demon";
    if (stage >= STAGE_CHAPTERS) {
      if (flag(player, SIGIL_GIVEN_ATTRIBUTE)) return "chapter-4-talking-to-garkor-again";
      if (flag(player, CHAPTER4_SEEN_ATTRIBUTE)) return "chapter-4";
      if (flag(player, MONKEY_DELIVERED_ATTRIBUTE)) {
        return "chapter-3-returning-to-garkor";
      }
      if (flag(player, GARKOR_DISGUISED_ATTRIBUTE)) {
        return "chapter-3-talking-to-garkor-again-after-showing-him-a-karamjam-monkey-disguise";
      }
      if (!flag(player, GARKOR_ASKED_ATTRIBUTE)) return "chapter-2-talking-to-garkor-again";
      if (monkeyForm(player)) {
        return "chapter-3-talking-to-garkor-while-disguised";
      }
      return "chapter-3-talking-to-garkor-while-not-disguised";
    }
    if (!flag(player, GARKOR_MET_ATTRIBUTE)) {
      return "chapter-2-talking-to-garkor";
    }
    if (!flag(player, GARKOR_ASKED_ATTRIBUTE)) return "chapter-2-talking-to-garkor-again";
    if (monkeyForm(player)) {
      return "chapter-3-talking-to-garkor-while-disguised";
    }
    return "chapter-2-talking-to-garkor-again";
  }

  function selectLumoVariant({ npcId, player }) {
    if (!LUMO_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-lumo";
    if (stage < STAGE_ATOLL) return null;
    const talks = attribute(player, LUMO_TALKS_ATTRIBUTE);
    player.setAttribute(LUMO_TALKS_ATTRIBUTE, talks + 1);
    return talks === 0 ? "chapter-2-talking-to-lumo" : "chapter-2-talking-to-lumo-again";
  }

  function selectZooknockVariant({ npcId, player }) {
    if (!ZOOKNOCK_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_CHAPTERS) {
      if (flag(player, DEMON_KILLED_ATTRIBUTE)) return "chapter-4-talking-to-zooknock";
      return "chapter-3-talking-to-zooknock";
    }
    if (stage < STAGE_ATOLL) return null;
    if (!flag(player, ZOOKNOCK_MET_ATTRIBUTE)) {
      return "chapter-2-talking-to-zooknock";
    }
    if (!flag(player, GARKOR_ASKED_ATTRIBUTE)) {
      return "chapter-2-talking-to-zooknock-talking-to-zooknock-again-while-having-not-yet-talked-to-garkor";
    }
    return "chapter-2-talking-to-zooknock-talking-to-zooknock-again-after-talking-to-garkor";
  }

  function selectKaramVariant({ npcId, player }) {
    if (!KARAM_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-karam";
    if (stage >= STAGE_ATOLL) return "chapter-2-talking-to-karam";
    return null;
  }

  function selectKrukVariant({ npcId, player }) {
    if (!KRUK_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (flag(player, SIGIL_GIVEN_ATTRIBUTE)) return "chapter-3-talking-to-kruk-2";
    if (stage >= STAGE_CHAPTERS && monkeyForm(player)) {
      setStage(player, STAGE_CHAPTERS);
      return "chapter-3-talking-to-kruk";
    }
    return "chapter-3-talking-to-kruk-early";
  }

  function selectElderGuardVariant({ npcId, player }) {
    if (!ELDER_GUARD_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_CHAPTERS && monkeyForm(player)) {
      if (flag(player, AWOWOGEI_MET_ATTRIBUTE) && !flag(player, MONKEY_DELIVERED_ATTRIBUTE)) {
        // Spoken before: the guard lets the monkey envoy back in (wiki).
        player.moveTo(THRONE_ROOM);
      }
      return "chapter-3-talking-to-an-elder-guard";
    }
    return "chapter-3-talking-to-an-elder-guard-early";
  }

  function childBananasTakenAt(player) {
    return attribute(player, CHILD_BANANAS_AT_ATTRIBUTE);
  }

  function childToyLostAt(player) {
    return attribute(player, CHILD_TOY_LOST_AT_ATTRIBUTE);
  }

  function selectMonkeyChildVariant({ npcId, player }) {
    if (!MONKEY_CHILD_IDS.has(npcId)) return null;
    if (stageOf(player) < STAGE_ATOLL) return null;
    if (!hasSpeakAmulet(player)) return "chapter-2-monkey-talisman-talking-to-the-monkey-child-without-a-m-speak-amulet";
    if (!flag(player, CHILD_UNCLE_ATTRIBUTE)) {
      const talks = attribute(player, CHILD_TALKS_ATTRIBUTE);
      player.setAttribute(CHILD_TALKS_ATTRIBUTE, talks + 1);
      return talks === 0
        ? "chapter-2-monkey-talisman-talking-to-the-monkey-child"
        : "chapter-2-monkey-talisman-talking-to-the-monkey-child-again";
    }
    if (!flag(player, CHILD_WANTED_ATTRIBUTE)) {
      return "chapter-2-monkey-talisman-talking-to-the-monkey-child-again-after-selecting-the-uncle-option";
    }
    const bananasAt = childBananasTakenAt(player);
    if (bananasAt === 0) {
      const bananas = player.getInventory().getAmount(BANANA_ITEM);
      if (bananas >= BANANAS_FOR_CHILD) return "chapter-2-monkey-talisman-talking-to-the-monkey-child-with-at-least-five-bananas";
      if (bananas > 0) return "chapter-2-monkey-talisman-talking-to-the-monkey-child-with-less-than-five-bananas";
      return "chapter-2-monkey-talisman-talking-to-the-monkey-child-without-any-bananas";
    }
    if (!flag(player, CHILD_TOY_GIVEN_ATTRIBUTE)) {
      return Date.now() - bananasAt < CHILD_WAIT_MS
        ? "chapter-2-monkey-talisman-talking-to-the-monkey-child-before-he-receives-the-toy"
        : "chapter-2-monkey-talisman-talking-to-the-monkey-child-after-he-receives-the-toy";
    }
    const lostAt = childToyLostAt(player);
    if (lostAt > 0 && Date.now() - lostAt < CHILD_WAIT_MS) {
      return "chapter-2-monkey-talisman-trying-to-talk-to-the-child-while-they-are-crying";
    }
    if (lostAt > 0) {
      return "chapter-2-monkey-talisman-if-enough-time-has-passed-or-the-player-has-logged-in-and-out-after-taking-the-toy";
    }
    return "chapter-2-monkey-talisman-if-the-player-has-previously-taken-a-toy-from-the-monkey-child";
  }

  function selectZooMonkeyVariant({ npcId, player }) {
    if (!ZOO_MONKEY_IDS.has(npcId)) return null;
    if (stageOf(player) < STAGE_CHAPTERS) return null;
    if (!flag(player, MONKEY_CAPTURED_ATTRIBUTE)) return null;
    if (!inZone(player.getLocation(), ZOO_IDS)) return null;
    if (hasItem(player, MONKEY_ITEM)) return null;
    // The last "Ook!" of the page is the monkey hopping into the backpack; the
    // selection itself records the capture (a virtual player never clicks it).
    player.setAttribute(MONKEY_CAPTURED_ATTRIBUTE, true);
    addItem(player, MONKEY_ITEM);
    return "chapter-3-talking-to-a-monkey-in-the-cage";
  }

  function selectWaymottinVariant({ npcId, player }) {
    if (!WAYMOTTIN_IDS.has(npcId)) return null;
    if (stageOf(player) < STAGE_CHAPTERS) return null;
    if (flag(player, SIGIL_GIVEN_ATTRIBUTE) && !hasItem(player, SQUAD_SIGIL_ITEM)) {
      return "chapter-4-talking-to-waymottin-without-a-sigil";
    }
    return null;
  }

  function selectGloughVariant({ npcId, player }) {
    if (!GLOUGH_IDS.has(npcId)) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-glough";
    if (stage === STAGE_DAERO && inHangar(player)) return "chapter-1-the-underground-hangar-talking-to-glough";
    return null;
  }

  function selectBonzaraVariant({ npcId }) {
    if (!BONZARA_IDS.has(npcId)) return null;
    return "chapter-4-talking-to-bonzara";
  }

  /** One selector so register() stays one line per hook. */
  function selectVariant(event) {
    return (
      selectNarnodeVariant(event)
      ?? selectForemanVariant(event)
      ?? selectShipyardWorkerVariant(event)
      ?? selectCaranockVariant(event)
      ?? selectDaeroVariant(event)
      ?? selectWaydarVariant(event)
      ?? selectLumdoVariant(event)
      ?? selectGarkorVariant(event)
      ?? selectLumoVariant(event)
      ?? selectZooknockVariant(event)
      ?? selectKaramVariant(event)
      ?? selectKrukVariant(event)
      ?? selectElderGuardVariant(event)
      ?? selectMonkeyChildVariant(event)
      ?? selectZooMonkeyVariant(event)
      ?? selectWaymottinVariant(event)
      ?? selectGloughVariant(event)
      ?? selectBonzaraVariant(event)
      ?? null
    );
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!DIALOGUE_NPC_IDS.has(event.npcId)) return null;
    switch (stepId) {
      case "--UmOz": // shipyard worker: no royal seal
      case "1_PS2g": // Lumdo: otherwise (no seal)
        return !hasItem(player, GNOME_ROYAL_SEAL_ITEM);
      case "hzCMP2": // shipyard worker: has the royal seal
      case "hVcRIB": // Lumdo: still has the royal seal
        return hasItem(player, GNOME_ROYAL_SEAL_ITEM);
      case "zRu1bI": { // foreman, first time (set on first resolution)
        if (flag(player, FOREMAN_MET_ATTRIBUTE)) return false;
        player.setAttribute(FOREMAN_MET_ATTRIBUTE, true);
        return true;
      }
      case "URAAQm": // Narnode: still has the orders
        return hasItem(player, NARNODES_ORDERS_ITEM);
      case "xEU-at": // Narnode: lost the orders
        return !hasItem(player, NARNODES_ORDERS_ITEM);
      case "o78CFE": // Daero: no orders
        return !hasItem(player, NARNODES_ORDERS_ITEM);
      case "ZHBiez": // Daero: has the orders
        return hasItem(player, NARNODES_ORDERS_ITEM);
      case "g8q_br": // Glough: under 200,000 coins
        return !hasItem(player, COINS_ITEM, GLOUGH_PRICE);
      case "LE1sym": // Glough: at least 200,000 coins
        return hasItem(player, COINS_ITEM, GLOUGH_PRICE);
      case "_hsne3": // Lumo: first time talking again
        return attribute(player, LUMO_TALKS_ATTRIBUTE) <= 1;
      case "OJ0Xrw": // Lumo: subsequent times
        return attribute(player, LUMO_TALKS_ATTRIBUTE) > 1;
      case "rpSCo_": // jailed 10/15/20/50/100 times
      case "2JIjG3":
      case "KVGnoh":
      case "k9jVap":
      case "YoHOAf":
        return false;
      case "rcHC7i": // Zooknock: before talking to Garkor
        return !flag(player, GARKOR_ASKED_ATTRIBUTE);
      case "1hF4h6": // Zooknock: after talking to Garkor
        return flag(player, GARKOR_ASKED_ATTRIBUTE);
      case "aH18LQ": // Zooknock: has all monkeyspeak amulet items
        return flag(player, MOULD_GIVEN_ATTRIBUTE)
          && flag(player, DENTURES_GIVEN_ATTRIBUTE)
          && flag(player, BAR_GIVEN_ATTRIBUTE);
      case "KQRiu4": // Garkor: not transformed into a Karamjan monkey
      case "tcp8pc": // Kruk: transformed into the wrong monkey
        return !monkeyForm(player);
      case "CdRyEO": // Garkor: transformed into a Karamjan monkey
      case "XCc1uo": // Kruk: transformed into a Karamjan monkey
      case "0Uwg_-": // Awowogei: as a Karamjan monkey
        return monkeyForm(player);
      case "VcMNHp": // sigil: first time
        return !flag(player, SIGIL_USED_ATTRIBUTE);
      case "pgN5Sw": // sigil: subsequent times
        return flag(player, SIGIL_USED_ATTRIBUTE);
      case "Agjjnw": // the player is male
        return player.getAppearance?.().isMale?.() !== false;
      case "DTbh6y": // the player is female
        return player.getAppearance?.().isMale?.() === false;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript action handler
  // ==========================================================================

  // Message steps keep `handled` false so the transcript's own message still shows
  // (setting it suppresses the default sendMessage); action steps set it so the
  // runtime continues in one place.
  function handleAction(event) {
    const { player, stepId } = event;
    if (!DIALOGUE_NPC_IDS.has(event.npcId)) return;
    switch (stepId) {
      case "AT80aC": // Narnode hands over a copy of the Royal Seal
        // The start was refused (a prerequisite quest is unfinished), so no seal.
        if (stageOf(player) < STAGE_STARTED) {
          event.handled = true;
          return;
        }
        addSeal(player);
        return;
      case "1b-5vN": // Narnode hands over the handwritten orders
      case "g-Kuxc":
        if (!hasItem(player, NARNODES_ORDERS_ITEM)) addItem(player, NARNODES_ORDERS_ITEM);
        if (stepId === "1b-5vN" && stageOf(player) === STAGE_SHIPYARD) {
          setStage(player, STAGE_ORDERS);
          setHelperProgress(player, NARNODE_HELPER_ATTRIBUTE, VARBIT_MM_NARNODE, 7);
        }
        return;
      case "S_fRY7": // orders handed to Daero
        player.getInventory().deleteNumber(NARNODES_ORDERS_ITEM, 1);
        setStage(player, STAGE_DAERO);
        if (daeroState(player) < 1) setDaeroState(player, 1);
        return;
      case "XnjEtK": // blindfolded, transported to the hangar
      case "OnuJ6p":
      case "JSK0NB":
      case "ggX5ck":
        event.handled = true;
        if (stageOf(player) < STAGE_DAERO) setStage(player, STAGE_DAERO);
        if (daeroState(player) < 1) setDaeroState(player, 1);
        player.moveTo(HANGAR_LANDING);
        return;
      case "wkgbIS": // receive the spare controller
        event.handled = true;
        if (!hasItem(player, SPARE_CONTROLS_ITEM)) addItem(player, SPARE_CONTROLS_ITEM);
        return;
      case "q7BmfR": // final puzzle piece slides home (message)
        if (stageOf(player) < STAGE_REINITIALISED) setStage(player, STAGE_REINITIALISED);
        if (daeroState(player) < 6) setDaeroState(player, 6);
        if (waydarState(player) < 1) setWaydarState(player, 1);
        return;
      case "G7pVRU": // the gliders unfold (action)
        event.handled = true;
        if (stageOf(player) < STAGE_REINITIALISED) setStage(player, STAGE_REINITIALISED);
        if (daeroState(player) < 6) setDaeroState(player, 6);
        if (waydarState(player) < 1) setWaydarState(player, 1);
        return;
      case "7EU-SF": // "Meanwhile, far away in Karamja..." (chapter 2 cutscene)
        event.handled = true;
        if (stageOf(player) < STAGE_ATOLL) setStage(player, STAGE_ATOLL);
        if (lumdoState(player) < 3) setLumdoState(player, 3);
        return;
      case "aogNZK": // Waydar flies the player back to the stronghold
        event.handled = true;
        player.moveTo(STRONGHOLD_LANDING);
        return;
      case "D5FkX-": // lowering into the crate hole (message)
        return;
      case "bJv66b": // landing in the cavern (message)
        player.moveTo(MOULD_ROOM_LANDING);
        return;
      case "zVVEXd": // receive the M'amulet mould (action)
        event.handled = true;
        if (!hasItem(player, MAMULET_MOULD_ITEM)) addItem(player, MAMULET_MOULD_ITEM);
        return;
      case "7s1ZAu": // receive the monkey dentures (action)
        event.handled = true;
        if (!hasItem(player, MONKEY_DENTURES_ITEM)) addItem(player, MONKEY_DENTURES_ITEM);
        return;
      case "1f0YD3": // hand Zooknock the mould (message)
        if (hasItem(player, MAMULET_MOULD_ITEM) && !flag(player, MOULD_GIVEN_ATTRIBUTE)) {
          player.getInventory().deleteNumber(MAMULET_MOULD_ITEM, 1);
          player.setAttribute(MOULD_GIVEN_ATTRIBUTE, true);
        }
        return;
      case "2VHtUj": // hand Zooknock the dentures (message)
        if (hasItem(player, MONKEY_DENTURES_ITEM) && !flag(player, DENTURES_GIVEN_ATTRIBUTE)) {
          player.getInventory().deleteNumber(MONKEY_DENTURES_ITEM, 1);
          player.setAttribute(DENTURES_GIVEN_ATTRIBUTE, true);
        }
        return;
      case "FYkajk": // hand Zooknock the gold bar (message)
        // Only consumed once Zooknock holds the other two parts; used early the
        // bar stays with the player so the aH18LQ branch can still be reached.
        if (flag(player, MOULD_GIVEN_ATTRIBUTE) && flag(player, DENTURES_GIVEN_ATTRIBUTE)) {
          player.getInventory().deleteNumber(GOLD_BAR_ITEM, 1);
          player.setAttribute(BAR_GIVEN_ATTRIBUTE, true);
        }
        return;
      case "URF9yW": // Zooknock returns the enchanted bar and the mould (message)
        if (!flag(player, BAR_GIVEN_ATTRIBUTE)
          || !flag(player, MOULD_GIVEN_ATTRIBUTE)
          || !flag(player, DENTURES_GIVEN_ATTRIBUTE)) {
          event.handled = true;
          return;
        }
        if (!hasItem(player, ENCHANTED_BAR_ITEM)) addItem(player, ENCHANTED_BAR_ITEM);
        if (!hasItem(player, MAMULET_MOULD_ITEM)) addItem(player, MAMULET_MOULD_ITEM);
        player.setAttribute(MOULD_GIVEN_ATTRIBUTE, false);
        player.setAttribute(DENTURES_GIVEN_ATTRIBUTE, false);
        player.setAttribute(BAR_GIVEN_ATTRIBUTE, false);
        return;
      case "QOZti5": // the child takes the bananas (message)
        player.getInventory().deleteNumber(BANANA_ITEM, BANANAS_FOR_CHILD);
        player.setAttribute(CHILD_BANANAS_AT_ATTRIBUTE, Date.now());
        return;
      case "795Rk5": // the child gives you a talisman (message)
        if (!flag(player, CHILD_TOY_GIVEN_ATTRIBUTE)) {
          player.setAttribute(CHILD_TOY_GIVEN_ATTRIBUTE, true);
          addItem(player, MONKEY_TALISMAN_ITEM);
        }
        return;
      case "jZpa3c": // the child begins to cry (message)
        player.setAttribute(CHILD_TOY_LOST_AT_ATTRIBUTE, Date.now());
        return;
      case "VHxVxt": // a replacement talisman after crying (action)
        event.handled = true;
        player.setAttribute(CHILD_TOY_LOST_AT_ATTRIBUTE, 0);
        player.setAttribute(CHILD_TOY_GIVEN_ATTRIBUTE, true);
        addItem(player, MONKEY_TALISMAN_ITEM);
        return;
      case "RiFs2s": // hand Zooknock the monkey talisman (message)
        if (hasItem(player, MONKEY_TALISMAN_ITEM) && !flag(player, TALISMAN_GIVEN_ATTRIBUTE)) {
          player.getInventory().deleteNumber(MONKEY_TALISMAN_ITEM, 1);
          player.setAttribute(TALISMAN_GIVEN_ATTRIBUTE, true);
        }
        return;
      case "uDWMj-": // hand Zooknock the monkey remains (message)
        deleteMonkeyRemains(player);
        player.setAttribute(REMAINS_GIVEN_ATTRIBUTE, true);
        return;
      case "-wRWky": // the talisman comes back glowing: the greegree (message)
        if (!hasItem(player, KARAMJAN_GREEGREE_ITEM)) addItem(player, KARAMJAN_GREEGREE_ITEM);
        player.setAttribute(TALISMAN_GIVEN_ATTRIBUTE, false);
        player.setAttribute(REMAINS_GIVEN_ATTRIBUTE, false);
        return;
      case "hOYpYN": // "Meanwhile, somewhere far below the Ape Atoll..."
        event.handled = true;
        if (stageOf(player) < STAGE_CHAPTERS) setStage(player, STAGE_CHAPTERS);
        return;
      case "AhUbiz": // Kruk takes the envoy to Awowogei's throne room
        event.handled = true;
        player.moveTo(THRONE_ROOM);
        return;
      case "1ZViOR": // Garkor hands over the squad sigil (message)
        player.setAttribute(SIGIL_GIVEN_ATTRIBUTE, true);
        setHelperProgress(player, GARKOR_HELPER_ATTRIBUTE, VARBIT_MM_GARKOR, 6);
        if (!hasItem(player, SQUAD_SIGIL_ITEM)) addItem(player, SQUAD_SIGIL_ITEM);
        return;
      case "5DPD9f": // a replica sigil from Waymottin (message)
        if (!hasItem(player, SQUAD_SIGIL_ITEM)) addItem(player, SQUAD_SIGIL_ITEM);
        return;
      case "vEetSW": // the sigil shakes: off to the final battle (message)
        player.setAttribute(SIGIL_USED_ATTRIBUTE, true);
        spawnDemon(player);
        player.moveTo(ARENA_PLAYER);
        return;
      case "NP0anE": // "Somewhere far below the Ape Atoll..." (chapter 4 cutscene)
        event.handled = true;
        player.setAttribute(CHAPTER4_SEEN_ATTRIBUTE, true);
        return;
      case "owLeUo": // Bonzara teleports the player to the surface
        event.handled = true;
        player.moveTo(ATOLL_SURFACE_LANDING);
        return;
      case "44E_SM": // Zooknock teleports the player out of the plantation
        event.handled = true;
        player.moveTo(ATOLL_SURFACE_LANDING);
        return;
      case "iKXnuQ": // "Congratulations! Quest complete!"
        event.handled = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "KpGxV1": // Daero training: strength and stamina
      case "2R3K5Y": // Daero training: attack and defence
        event.handled = true;
        grantTraining(player, stepId);
        return;
      default:
        return;
    }
  }

  function deleteMonkeyRemains(player) {
    for (const itemId of MONKEY_BONES_ITEMS) {
      if (hasItem(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        return true;
      }
    }
    if (hasItem(player, MONKEY_CORPSE_ITEM)) {
      player.getInventory().deleteNumber(MONKEY_CORPSE_ITEM, 1);
      return true;
    }
    return false;
  }

  /** Owner-only Jungle Demon for the player's final battle. */
  function spawnDemon(player) {
    const existing = demons.get(player);
    if (existing && existing.isRegistered?.() !== false) api.removeNpc(existing);
    const npc = api.spawnNpc({
      id: JUNGLE_DEMON_NPC_ID,
      x: ARENA_DEMON.x,
      y: ARENA_DEMON.y,
      z: ARENA_DEMON.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) demons.set(player, npc);
  }

  function grantTraining(player, stepId) {
    if (stageOf(player) < STAGE_COMPLETE) return;
    if (flag(player, TRAINING_CLAIMED_ATTRIBUTE)) {
      player.sendMessage("Daero has already trained you.");
      return;
    }
    player.setAttribute(TRAINING_CLAIMED_ATTRIBUTE, true);
    const skills = player.getSkillManager();
    if (stepId === "KpGxV1") {
      skills.addExperiences(Skill.STRENGTH, 35000);
      skills.addExperiences(Skill.HITPOINTS, 35000);
      skills.addExperiences(Skill.ATTACK, 20000);
      skills.addExperiences(Skill.DEFENCE, 20000);
    } else {
      skills.addExperiences(Skill.ATTACK, 35000);
      skills.addExperiences(Skill.DEFENCE, 35000);
      skills.addExperiences(Skill.STRENGTH, 20000);
      skills.addExperiences(Skill.HITPOINTS, 20000);
    }
    player.sendMessage("Several hours later...");
    setStage(player, STAGE_TRAINING);
  }

  // ==========================================================================
  // Choice / line handlers
  // ==========================================================================

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!DIALOGUE_NPC_IDS.has(npcId) && npcId !== AWOWOGEI_CHATHEAD_ID) return;
    if (NARNODE_IDS.has(npcId) && option === "No.") {
      player.setAttribute(DECLINED_ATTRIBUTE, true);
      return;
    }
    if (GLOUGH_IDS.has(npcId) && option === "Ok then. You win again, Glough.") {
      if (!hasItem(player, COINS_ITEM, GLOUGH_PRICE)) return;
      player.getInventory().deleteNumber(COINS_ITEM, GLOUGH_PRICE);
      if (stageOf(player) < STAGE_REINITIALISED) setStage(player, STAGE_REINITIALISED);
      if (daeroState(player) < 6) setDaeroState(player, 6);
      if (waydarState(player) < 1) setWaydarState(player, 1);
      player.sendMessage("Glough takes your coins and remotely reinitialises the hangar.");
      return;
    }
    if (MONKEY_CHILD_IDS.has(npcId)) {
      if (option === "Well I'll be a monkey's uncle!") {
        player.setAttribute(CHILD_UNCLE_ATTRIBUTE, true);
        return;
      }
      if (option === "How many bananas did Aunty want?") {
        player.setAttribute(CHILD_WANTED_ATTRIBUTE, true);
        return;
      }
      if (option === "I've lost that toy you gave me...") {
        player.setAttribute(CHILD_TOY_LOST_AT_ATTRIBUTE, Date.now());
        return;
      }
    }
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!DIALOGUE_NPC_IDS.has(npcId)) return;
    if (CARANOCK_IDS.has(npcId) && stageOf(player) === STAGE_STARTED
      && text === "I shall personally see to the decommission. You should report to the King immediately.") {
      setStage(player, STAGE_SHIPYARD);
      setHelperProgress(player, CARANOCK_HELPER_ATTRIBUTE, VARBIT_MM_CARANOCK, 3);
      return;
    }
    if (GARKOR_IDS.has(npcId) && stageOf(player) >= STAGE_ATOLL
      && !flag(player, GARKOR_MET_ATTRIBUTE)
      && text === "Just go and find my squad mage, human.") {
      player.setAttribute(GARKOR_MET_ATTRIBUTE, true);
      player.setAttribute(GARKOR_ASKED_ATTRIBUTE, true);
      setHelperProgress(player, GARKOR_HELPER_ATTRIBUTE, VARBIT_MM_GARKOR, 2);
      return;
    }
    if (GARKOR_IDS.has(npcId) && flag(player, GARKOR_ASKED_ATTRIBUTE)
      && !flag(player, GARKOR_DISGUISED_ATTRIBUTE)
      && monkeyForm(player)
      && text === "I need you now to seek audience with Awowogei. Claim you are an envoy from the monkeys of Karamja and are seeking an alliance.") {
      player.setAttribute(GARKOR_DISGUISED_ATTRIBUTE, true);
      setHelperProgress(player, GARKOR_HELPER_ATTRIBUTE, VARBIT_MM_GARKOR, 3);
      return;
    }
    if (ZOOKNOCK_IDS.has(npcId) && !flag(player, ZOOKNOCK_MET_ATTRIBUTE)
      && text === "I am Zooknock, the 10th squad mage. These are Bunkwicket and Waymottin, two of our finest sappers. I assume you will want to know how we got here?") {
      player.setAttribute(ZOOKNOCK_MET_ATTRIBUTE, true);
      return;
    }
    if (ZOOKNOCK_IDS.has(npcId) && flag(player, GARKOR_ASKED_ATTRIBUTE)
      && text === "I have the necessary magic to perform the shapeshifting spell, but we needed a human to transform.") {
      setHelperProgress(player, ZOOKNOCK_HELPER_ATTRIBUTE, VARBIT_MM_ZOOKNOCK, 5);
      return;
    }
    if (DAERO_IDS.has(npcId) && stageOf(player) >= STAGE_REINITIALISED
      && !flag(player, POST_PUZZLE_TALK_ATTRIBUTE)
      && text === "Well done, adventurer. You have managed to break Glough's code. Now the process of reinitialisation is complete, you can truly begin your journey into the unknown.") {
      player.setAttribute(POST_PUZZLE_TALK_ATTRIBUTE, true);
      setDaeroState(player, 7);
      return;
    }
    // Waydar's "Yes, let's go." flies the player to Crash Island from the hangar,
    // and Waydar on Crash Island offers the return to the stronghold.
    if (WAYDAR_IDS.has(npcId) && text === "Yes, let's go.") {
      if (inHangar(player)) {
        if (stageOf(player) < STAGE_CRASH_ISLAND) setStage(player, STAGE_CRASH_ISLAND);
        player.moveTo(CRASH_ISLAND_LANDING);
      } else if (onCrashIsland(player)) {
        player.moveTo(STRONGHOLD_LANDING);
      }
      return;
    }
    // Lumdo's "As you wish." rows the boat to whichever island the player is not on.
    if (LUMDO_IDS.has(npcId) && text === "As you wish.") {
      if (onCrashIsland(player)) {
        if (stageOf(player) < STAGE_ATOLL) setStage(player, STAGE_ATOLL);
        player.moveTo(ATOLL_LANDING);
      } else {
        player.moveTo(CRASH_ISLAND_LANDING);
      }
      return;
    }
  }

  function handleHook({ player, npcId, hook }) {
    if (hook !== "quest:monkey-madness-i:start") return;
    if (!NARNODE_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0) return;
    // The wiki's requirement list: Narnode only asks a player who has finished
    // The Grand Tree and Tree Gnome Village.
    if (!PREREQUISITE_QUESTS.every((key) => questComplete(player, key))) {
      player.sendMessage("You need to have completed The Grand Tree and Tree Gnome Village before Narnode can ask for your help.");
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function isMonkeyRemains(itemId) {
    return MONKEY_BONES_ITEMS.has(itemId) || itemId === MONKEY_CORPSE_ITEM;
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!ZOOKNOCK_IDS.has(npcId)) return;
    if (!flag(player, GARKOR_ASKED_ATTRIBUTE)) {
      event.handled = true;
      player.sendMessage("Zooknock is busy working on his tunnel.");
      return;
    }
    if (itemId === MAMULET_MOULD_ITEM) {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, "chapter-2-monkey-amulet-using-the-monkey-amulet-mould-on-zooknock");
      return;
    }
    if (itemId === MONKEY_DENTURES_ITEM) {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, "chapter-2-monkey-amulet-using-the-monkey-dentures-on-zooknock");
      return;
    }
    if (itemId === GOLD_BAR_ITEM) {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, "chapter-2-monkey-amulet-using-the-gold-bar-on-zooknock");
      return;
    }
    if (itemId === MONKEY_TALISMAN_ITEM) {
      event.handled = true;
      if (flag(player, REMAINS_GIVEN_ATTRIBUTE)) {
        // The after-both page has no hand-over message: the talisman used here
        // is the one Zooknock returns as the greegree, so consume it now.
        player.getInventory().deleteNumber(MONKEY_TALISMAN_ITEM, 1);
        startTranscript(api, player, npcId, PAGE, "chapter-2-creating-the-monkey-gree-gree-after-using-both-items-on-zooknock");
        return;
      }
      startTranscript(api, player, npcId, PAGE, "chapter-2-creating-the-monkey-gree-gree-using-the-monkey-talisman-on-zooknock-first");
      return;
    }
    if (isMonkeyRemains(itemId)) {
      event.handled = true;
      if (flag(player, TALISMAN_GIVEN_ATTRIBUTE)) {
        // The after-both page has no "hand Zooknock the remains" message, so
        // the remains just handed over have to be deleted here.
        deleteMonkeyRemains(player);
        startTranscript(api, player, npcId, PAGE, "chapter-2-creating-the-monkey-gree-gree-after-using-both-items-on-zooknock");
        return;
      }
      startTranscript(api, player, npcId, PAGE, "chapter-2-creating-the-monkey-gree-gree-using-the-monkey-remains-on-zooknock-first");
      return;
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== ENCHANTED_BAR_ITEM || !WALL_OF_FLAME_IDS.has(objectId)) return;
    event.handled = true;
    if (!hasItem(player, ENCHANTED_BAR_ITEM)) return;
    player.getInventory().deleteNumber(ENCHANTED_BAR_ITEM, 1);
    addItem(player, MSPEAK_AMULET_UNSTRUNG_ITEM);
    player.sendMessage("You hold the enchanted bar to the wall of flame. It softens and takes the shape of the mould.");
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const isWool = usedItemId === BALL_OF_WOOL_ITEM && usedWithItemId === MSPEAK_AMULET_UNSTRUNG_ITEM;
    const isWoolReversed = usedWithItemId === BALL_OF_WOOL_ITEM && usedItemId === MSPEAK_AMULET_UNSTRUNG_ITEM;
    if (!isWool && !isWoolReversed) return;
    event.handled = true;
    if (!hasItem(player, BALL_OF_WOOL_ITEM) || !hasItem(player, MSPEAK_AMULET_UNSTRUNG_ITEM)) return;
    player.getInventory().deleteNumber(BALL_OF_WOOL_ITEM, 1);
    player.getInventory().deleteNumber(MSPEAK_AMULET_UNSTRUNG_ITEM, 1);
    addItem(player, MSPEAK_AMULET_ITEM);
    startTranscript(api, player, AWOWOGEI_CHATHEAD_ID, PAGE, "chapter-2-monkey-amulet-stringing-the-monkeyspeak-amulet");
  }

  /**
   * Core equips the sigil on a "Wear" before any item-action event fires, so the
   * prompt is driven from the equip gate instead: block the equip, play the
   * shake/teleport transcript (its "Yes." path spawns the demon and moves the
   * player). After the demon is dead the sigil no longer teleports, so the wear
   * goes through. Left-click/first-action wear still arrives via handleItemAction.
   */
  function handleCanEquip(event) {
    const { player, item } = event;
    if (item?.getId?.() !== SQUAD_SIGIL_ITEM) return;
    if (flag(player, DEMON_KILLED_ATTRIBUTE)) return;
    event.allow = false;
    if (stageOf(player) < STAGE_CHAPTERS) {
      player.sendMessage("You are not ready to use the sigil.");
      return;
    }
    startTranscript(api, player, GARKOR_CHATHEAD_ID, PAGE, "chapter-4-equipping-the-sigil");
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === SQUAD_SIGIL_ITEM && option === "Wear") {
      // The wiki: the sigil stays in the inventory but summons the squad.
      event.handled = true;
      if (stageOf(player) < STAGE_CHAPTERS) {
        player.sendMessage("You are not ready to use the sigil.");
        return;
      }
      startTranscript(api, player, GARKOR_CHATHEAD_ID, PAGE, "chapter-4-equipping-the-sigil");
      return;
    }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function stepThrough(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination = Math.abs(dx) >= Math.abs(dy)
      ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
      : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function handleObjectInteraction(event) {
    const { player } = event;
    const objectId = event.objectId;
    const option = optionOf(event);

    if (objectId === AWOWOGEI_OBJECT_ID && option === "Talk-to") {
      if (questComplete(player, "monkey_madness_ii")) {
        // Monkey Madness II owns the post-completion conversation and releases
        // its own Awowogei when it completes; the throne object stays with this
        // plugin, so it plays MM2's canonical page.
        event.handled = true;
        startTranscript(api, player, AWOWOGEI_MM2_CHATHEAD_ID, AWOWOGEI_PAGE, "after-completing-monkey-madness-ii");
        return;
      }
      event.handled = true;
      talkAwowogei(player);
      return;
    }
    if (JAIL_DOOR_IDS.has(objectId) && option === "Pick-lock") {
      event.handled = true;
      if (attribute(player, JAIL_STATE_ATTRIBUTE) === 1) {
        player.setAttribute(JAIL_STATE_ATTRIBUTE, 2);
        player.moveTo(JAIL_EXIT);
        player.sendMessage("You pick the lock and slip out of the cell.");
      } else {
        player.sendMessage("You can't reach the lock from here.");
      }
      return;
    }
    if (objectId === REINITIALISATION_PANEL_ID && option === "Operate") {
      event.handled = true;
      if (stageOf(player) < STAGE_DAERO) return;
      if (daeroState(player) < 5) {
        startTranscript(api, player, CRATE_CHATHEAD_ID, PAGE, "chapter-1-the-underground-hangar-interacting-with-the-panel-before-being-tasked-with-aligning-it");
        return;
      }
      if (stageOf(player) >= STAGE_REINITIALISED) {
        player.sendMessage("The reinitialisation has already been completed.");
        return;
      }
      startTranscript(api, player, CRATE_CHATHEAD_ID, PAGE, "chapter-1-the-underground-hangar-upon-solving-the-puzzle");
      return;
    }
    if (objectId === SPARE_CONTROLS_CRATE_ID && option === "Search") {
      event.handled = true;
      startTranscript(api, player, CRATE_CHATHEAD_ID, PAGE, "chapter-1-the-underground-hangar-searching-the-crate-of-spare-controls");
      return;
    }
    if (objectId === DENTURES_CRATE_ID && option === "Search") {
      event.handled = true;
      startTranscript(api, player, DUNGEON_CHATHEAD_ID, PAGE, "chapter-2-monkey-amulet-searching-the-denture-crate");
      return;
    }
    if (objectId === HOLE_CRATE_ID && option === "Search") {
      event.handled = true;
      startTranscript(api, player, DUNGEON_CHATHEAD_ID, PAGE, "chapter-2-monkey-amulet-searching-the-crate-leading-to-the-area-with-the-mould");
      return;
    }
    if (objectId === MOULD_CRATE_ID && option === "Search") {
      event.handled = true;
      startTranscript(api, player, DUNGEON_CHATHEAD_ID, PAGE, "chapter-2-monkey-amulet-searching-the-mould-crate");
      return;
    }
    if (BANANA_CRATE_IDS.has(objectId) && option === "Search") {
      event.handled = true;
      addItem(player, BANANA_ITEM);
      player.sendMessage("You take a banana from the crate.");
      return;
    }
    if (BANANA_TREE_IDS.has(objectId) && option === "Search") {
      event.handled = true;
      addItem(player, BANANA_ITEM);
      player.sendMessage("You pick a banana.");
      return;
    }
    if (SHIPYARD_GATE_IDS.has(objectId) && option === "Open") {
      event.handled = true;
      enterShipyard(player, event.location);
      return;
    }
    if (BAMBOO_GATE_IDS.has(objectId) && option === "Open") {
      event.handled = true;
      stepThrough(player, event.location);
      return;
    }
    if (TEMPLE_TRAPDOOR_IDS.has(objectId) && (option === "Open" || option === "Climb-down")) {
      event.handled = true;
      // The trapdoor stands on the temple surface (2807,2785); opening it or
      // climbing down it drops the player into the dungeon below.
      climbTo({ player, object: event.object }, "ladders:climbDown", TEMPLE_DUNGEON_LANDING);
      return;
    }
    if (objectId === TEMPLE_ROPE_ID && option === "Climb") {
      event.handled = true;
      // The rope in the temple dungeon only leads up to the surface.
      climbTo({ player, object: event.object }, "ladders:climbUp", TEMPLE_SURFACE_LANDING);
      return;
    }
  }

  /**
   * Ladders asks who owns a climb before guessing. These four objects have no
   * ladder at their far end (a trapdoor over a ledge, a rope to the surface, a
   * ladder whose plane below is solid), so the quest owns the click. The claim
   * is scoped to the object's own placement and to the direction the clicked
   * option names, and the climb itself is handed to the Ladders plugin with an
   * explicit destination, so it animates and walks the collision map.
   */
  function claimQuestClimb(request) {
    const { player, object } = request;
    const location = object?.getLocation?.();
    if (!player || !location) return;
    const direction = climbDirection(request);
    if (!direction) return;
    if (TEMPLE_TRAPDOOR_IDS.has(request.objectId) && atTile(location, TEMPLE_TRAPDOOR_TILE)) {
      if (direction !== "down") return;
      request.handled = true;
      climbTo(request, "ladders:climbDown", TEMPLE_DUNGEON_LANDING);
      return;
    }
    if (request.objectId === TEMPLE_ROPE_ID && atTile(location, TEMPLE_ROPE_TILE)) {
      if (direction !== "up") return;
      request.handled = true;
      climbTo(request, "ladders:climbUp", TEMPLE_SURFACE_LANDING);
      return;
    }
    if (request.objectId === MOULD_ROOM_ROPE_ID && atTile(location, MOULD_ROOM_ROPE_TILE)) {
      if (direction !== "up") return;
      request.handled = true;
      climbTo(request, "ladders:climbUp", DENTURE_HOUSE_LANDING);
      return;
    }
    if (request.objectId === WATCHTOWER_TOP_EAST_ID && atTile(location, WATCHTOWER_TOP_TILE)) {
      if (direction !== "down") return;
      request.handled = true;
      climbTo(request, "ladders:climbDown", WATCHTOWER_KRUK_LANDING);
    }
  }

  /** True when the clicked object stands on exactly this tile. */
  function atTile(location, tile) {
    return location.getX() === tile.getX()
      && location.getY() === tile.getY()
      && location.getZ() === tile.getZ();
  }

  /** The direction the clicked option names, read from the object's own options. */
  function climbDirection(request) {
    const actions = api.core.CacheDefinitions.getObject(request.objectId)?.actions ?? [];
    const option = String(actions[request.clickType - 1] ?? "").toLowerCase();
    if (CLIMB_DOWN_OPTIONS.has(option)) return "down";
    if (CLIMB_UP_OPTIONS.has(option)) return "up";
    return null;
  }

  /** Hands the climb to the Ladders plugin with the quest's destination. */
  function climbTo(request, event, destination) {
    api.emitCustomEvent(event, {
      player: request.player,
      object: request.object,
      destination,
    });
  }

  /** The Awowogei object's Talk-to, from the wiki page's chapter 3 variants. */
  function talkAwowogei(player) {
    if (stageOf(player) < STAGE_CHAPTERS) return;
    if (!flag(player, AWOWOGEI_MET_ATTRIBUTE)) {
      player.setAttribute(AWOWOGEI_MET_ATTRIBUTE, true);
      startTranscript(api, player, AWOWOGEI_CHATHEAD_ID, PAGE, "chapter-3-talking-to-awowogei");
      return;
    }
    if (flag(player, MONKEY_DELIVERED_ATTRIBUTE)) {
      startTranscript(api, player, AWOWOGEI_CHATHEAD_ID, PAGE, "chapter-3-talking-to-awowogei-again");
      return;
    }
    if (hasItem(player, MONKEY_ITEM)) {
      player.setAttribute(MONKEY_DELIVERED_ATTRIBUTE, true);
      player.getInventory().deleteNumber(MONKEY_ITEM, 1);
      startTranscript(api, player, AWOWOGEI_CHATHEAD_ID, PAGE, "chapter-3-bringing-awowogei-a-monkey");
      return;
    }
    startTranscript(api, player, AWOWOGEI_CHATHEAD_ID, PAGE, "chapter-3-talking-to-awowogei-again-before-freeing-a-monkey");
  }

  // ==========================================================================
  // NPC interactions this quest owns (capture, re-issued orders)
  // ==========================================================================

  /** Drops the top-level `end` that splits Narnode's lost-orders conditions. */
  function dropTopLevelEnd(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.filter((step) => step?.type !== "end");
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    const option = optionOf(event);
    if (option === "Travel"
      && (DAERO_IDS.has(npcId) || WAYDAR_IDS.has(npcId) || LUMDO_IDS.has(npcId))) {
      event.handled = true;
      // Daero's Travel is only the "how do I leave" quip; Waydar and Lumdo
      // reuse their talk transcripts, whose "Yes, let's go." / "As you wish."
      // lines do the moving.
      const choice = DAERO_IDS.has(npcId)
        ? "chapter-1-the-underground-hangar-selecting-travel-at-daero-when-in-the-hangar"
        : selectVariant({ player, npcId, npc: event.npc });
      const variant = typeof choice === "string" ? choice : choice?.variant;
      if (variant) {
        api.emitCustomEvent("npc-dialogue:start", { player, npc: event.npc, npcId, variant, handled: false });
      }
      return true;
    }
    if (option !== "Talk-to") return false;

    if (NARNODE_IDS.has(npcId) && stageOf(player) === STAGE_ORDERS) {
      // The dump splits "still have the orders" / "lost the orders" with an END
      // between them; drop it so the lost-orders branch is reachable.
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, "chapter-1-talking-to-king-narnode-again", dropTopLevelEnd);
      return true;
    }

    if (MONKEY_MINDER_IDS.has(npcId)) {
      if (monkeyForm(player) && stageOf(player) >= STAGE_CHAPTERS
        && !flag(player, MONKEY_CAPTURED_ATTRIBUTE) && inZone(player.getLocation(), ZOO_IDS)) {
        event.handled = true;
        player.setAttribute(MONKEY_CAPTURED_ATTRIBUTE, true);
        startTranscript(api, player, npcId, PAGE, "chapter-3-getting-captured-by-the-monkey-minder");
        player.moveTo(ZOO_PEN);
        return true;
      }
      if (!monkeyForm(player) && flag(player, MONKEY_CAPTURED_ATTRIBUTE)
        && inZone(player.getLocation(), ZOO_IDS)) {
        event.handled = true;
        player.setAttribute(MONKEY_CAPTURED_ATTRIBUTE, false);
        startTranscript(api, player, npcId, PAGE, "chapter-3-escaping-the-cage");
        player.moveTo(ZOO_OUTSIDE);
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // Doors, zones, death, login
  // ==========================================================================

  /** The shipyard gate guard: with the seal the gate opens, without it the worker refuses. */
  function enterShipyard(player, location) {
    startTranscript(api, player, NpcIdentifiers.SHIPYARD_WORKER, PAGE, "chapter-1-trying-to-enter-the-ship-yard");
    if (!hasItem(player, GNOME_ROYAL_SEAL_ITEM)) return false;
    if (location) stepThrough(player, location);
    return true;
  }

  function handleDoorToggle(request) {
    const { player, objectId, location } = request;
    if (!SHIPYARD_GATE_IDS.has(objectId)) return;
    // The shared Doors plugin may or may not pair these gate leaves; this plugin
    // owns the conversation and the passage either way.
    enterShipyard(player, location);
    request.handled = true;
  }

  function handleJailZone({ player }) {
    if (stageOf(player) < STAGE_ATOLL) return;
    if (monkeyForm(player)) return;
    if (attribute(player, JAIL_STATE_ATTRIBUTE) !== 0) return;
    player.setAttribute(JAIL_STATE_ATTRIBUTE, 1);
    startTranscript(api, player, NpcIdentifiers.LUMO_3, PAGE, "chapter-2-approaching-the-bamboo-gate");
    player.moveTo(JAIL_CELL);
  }

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    if (!killer || npc?.getId?.() !== JUNGLE_DEMON_NPC_ID) return;
    const owner = npc.getOwner?.();
    if (owner && owner !== killer) return;
    killer.setAttribute(DEMON_KILLED_ATTRIBUTE, true);
    killer.sendMessage("You have defeated the Jungle Demon!");
  }

  function handleLogin({ player }) {
    syncGnomeVarps(player);
  }

  function handleBootstrap({ player }) {
    syncGnomeVarps(player);
  }

  // ==========================================================================
  // Rewards
  // ==========================================================================

  /**
   * Reward extras use the engine's drop-at-reward-tile overflow, never a
   * pending bag: a full inventory drops them at the player's feet instead of
   * swallowing them (the same pattern Waterfall Quest uses).
   */
  function giveReward(player, itemId, amount) {
    const inventory = player.getInventory();
    if (ItemDefinition.forId(itemId)?.isStackable?.()) {
      inventory.forceAdd(player, new Item(itemId, amount));
      return;
    }
    for (let i = 0; i < amount; i++) inventory.forceAdd(player, new Item(itemId, 1));
  }

  function grantReward(player) {
    // registerQuest adds the rewardItemId coin; top the stack up to 10,000 and
    // add the three diamonds the transcript mentions.
    giveReward(player, COINS_ITEM, 9999);
    giveReward(player, DIAMOND_ITEM, 3);
  }

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      const lines = [
        "<str>King Narnode Shareen sent me to find the missing 10th squad of the Royal Guard.</str>",
        "<str>I tracked them to Ape Atoll, where Zooknock's magic let me pass as a Karamjan monkey.</str>",
        "<str>I won King Awowogei's trust and joined the 10th squad to defeat the Jungle Demon.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
      if (stage >= STAGE_TRAINING) {
        lines.push("", "<str>I completed the Royal Guard training programme with Daero.</str>");
      } else {
        lines.push("", "I can train with <col=800000>Daero</col> in the Grand Tree as a member of the 10th squad.");
      }
      return lines;
    }
    if (stage >= STAGE_CHAPTERS) {
      const lines = [
        "<str>I was disguised as a monkey and met the 10th squad on Ape Atoll.</str>",
      ];
      if (flag(player, MONKEY_DELIVERED_ATTRIBUTE)) {
        lines.push("<str>I rescued a monkey from Ardougne Zoo and won Awowogei's trust.</str>");
      } else {
        lines.push("I must win <col=800000>King Awowogei's</col> trust by bringing him a monkey from Ardougne Zoo.");
      }
      if (flag(player, DEMON_KILLED_ATTRIBUTE)) {
        lines.push("<str>We defeated the Jungle Demon in the underground banana plantation.</str>", "");
        lines.push("I should report back to <col=800000>King Narnode</col> in the Grand Tree.");
      } else if (flag(player, SIGIL_GIVEN_ATTRIBUTE)) {
        lines.push("I have the 10th squad sigil: wearing it will summon me to the final battle.");
      } else {
        lines.push("I should speak to <col=800000>Sergeant Garkor</col> outside the Marim temple.");
      }
      return lines;
    }
    if (stage >= STAGE_ATOLL) {
      const lines = [
        "<str>I landed on Ape Atoll and was thrown into the monkeys' jail.</str>",
      ];
      if (hasItem(player, KARAMJAN_GREEGREE_ITEM)) {
        lines.push("<str>Zooknock turned my monkey talisman into a greegree.</str>");
      } else if (hasItem(player, MONKEY_TALISMAN_ITEM)) {
        lines.push("I have the monkey talisman; <col=800000>Zooknock</col> can make it into a greegree.");
      } else if (hasItem(player, MSPEAK_AMULET_UNSTRUNG_ITEM) || hasItem(player, ENCHANTED_BAR_ITEM)) {
        lines.push("I should take the enchanted bar to the <col=800000>wall of flame</col> in the temple dungeon.");
      } else if (hasSpeakAmulet(player)) {
        lines.push("I can now understand the monkeys. I need a monkey talisman from the monkey child.");
      } else {
        lines.push("I must gather a gold bar, monkey dentures and an m'amulet mould for <col=800000>Zooknock</col>.");
      }
      if (attribute(player, JAIL_STATE_ATTRIBUTE) === 1) {
        lines.push("", "I am locked in a cell; the door lock can be picked.");
      }
      return lines;
    }
    if (stage >= STAGE_CRASH_ISLAND) {
      return [
        "<str>Daero sent me to the underground military glider hangar.</str>",
        "<str>I broke Glough's reinitialisation code and flew south with Waydar.</str>",
        "",
        "We crashed-landed on <col=800000>Crash Island</col>. I must reach the island to the west.",
      ];
    }
    if (stage >= STAGE_REINITIALISED) {
      return [
        "<str>Daero sent me to the underground military glider hangar.</str>",
        "<str>Glough's reinitialisation code has been entered.</str>",
        "",
        "I should speak to <col=800000>Waydar</col> to fly south.",
      ];
    }
    if (stage >= STAGE_DAERO) {
      return [
        "<str>I investigated the shipyard and reported back to King Narnode.</str>",
        "<str>I delivered the King's orders to Daero at the Grand Tree.</str>",
        "",
        "In the <col=800000>underground hangar</col> I must help complete the",
        "<col=800000>reinitialisation</col> (the control panel, or Glough for 200,000 coins).",
      ];
    }
    if (stage >= STAGE_ORDERS) {
      return [
        "<str>I investigated Glough's old shipyard for the 10th squad.</str>",
        "",
        "King Narnode gave me <col=800000>his orders</col> to deliver to",
        "<col=800000>Daero</col>, the new Head Tree Guardian on the Grand Tree.",
      ];
    }
    if (stage >= STAGE_SHIPYARD) {
      return [
        "<str>King Narnode asked me to find the missing 10th squad.</str>",
        "<str>I questioned G.L.O. Caranock at the Karamja shipyard.</str>",
        "",
        "I should report back to <col=800000>King Narnode</col> in the Grand Tree.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>King Narnode asked me to find the missing 10th squad of the Royal Guard.</str>",
        "",
        "I should take the <col=800000>Gnome royal seal</col> to Glough's old",
        "shipyard on the eastern coast of <col=800000>Karamja</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>King Narnode Shareen</col>",
      "in the <col=800000>Grand Tree</col>.",
      "",
      "I need to have completed <col=800000>The Grand Tree</col> and",
      "<col=800000>Tree Gnome Village</col>.",
    ];
  }

  // ==========================================================================
  // Wiring
  // ==========================================================================

  for (const attributeKey of PERSISTED_ATTRIBUTES) api.persistAttribute(attributeKey);
  api.persistAttribute(NARNODE_HELPER_ATTRIBUTE, 0);
  api.persistAttribute(CARANOCK_HELPER_ATTRIBUTE, 0);
  api.persistAttribute(GARKOR_HELPER_ATTRIBUTE, 0);
  api.persistAttribute(ZOOKNOCK_HELPER_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "monkey_madness_i",
    name: "Monkey Madness I",
    varpId: VARP_MM_MAIN,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [],
    rewardItemId: COINS_ITEM,
    rewardItemLabel: "10,000 Coins",
    otherRewards: [
      "3 Diamonds",
      "The ability to buy and wield the Dragon scimitar",
      "Full access to Ape Atoll",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("ladders:climb", claimQuestClimb);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onCanEquip(handleCanEquip);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(WEST_VALLEY_ZONE, handleJailZone);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
