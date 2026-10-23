/**
 * Darkness of Hallowvale (members).
 *
 * The words come from the "Darkness of Hallowvale" transcript page; this plugin
 * supplies the talk handlers and stage-direction handling for Veliaf, Vertida,
 * Safalaan, Old Man Ral, King Roald, Drezel, Hiylik Myna, the Meiyerditch
 * citizens/children and the vyrewatch, the boat/chute repairs, the Meiyerditch
 * wall entry, the hideout latch, the Castle Drakan sketches, the
 * fireplace/portrait/laboratory chain and the completion reward.
 *
 * Stages (varbit 2573 "myq3_main_quest" in varp 869 "myreque_3_main_var", bits
 * 0-8). The durable ladder is the Quest Helper step map for varp 869, except
 * where the client and the server disagree on what a stage means; those are
 * mapped in varbitValue() below.
 * 0 not started, 10 Veliaf briefed (repair boat/chute), 20 boat fixed,
 * 30 chute fixed, 40 boat pushed, 50 docked in Meiyerditch, 52 vyrewatch met,
 * 54 through the wall floorboards, 60 learned about Old Man Ral, 65 Ral told
 * the route, 70 hideout latch unhooked, 80 entered the hideout, 90 message
 * from Vertida, 100 message handed to Veliaf, 110 Drezel briefed,
 * 120 werewolves seen at the bush, 130 Drezel handed over runes,
 * 140 King Roald spoken to, 160 accepted Roald's teleport,
 * 180 Veliaf sent you back to the Sanguinesti order in Meiyerditch
 * (170 is the legacy alias of that point),
 * 190 reached Safalaan (charcoal and papyrus), 200 northern sketch,
 * 210 western sketch, 220 southern ambush, 240 Sarius Guile, 250 all three sketches,
 * 260 sketches given to Safalaan, 280 laboratory unlocked,
 * 290 Haemalchemy volume 1 taken, 300 sealed message received, 310 complete.
 *
 * Sub-states the cache reads live in one persisted attribute
 * "quest.darkness_of_hallowvale.bits" and are mirrored to the cache's own
 * varbits so the multi-locs transform: 2585 myq3_boat_broken,
 * 2586 myq3_chute_broken, 2587 myq3_sea_boat_visible,
 * 2589 myq3_wall_floorboards_down, 2590 myq3_hideout_trapdoor,
 * 2594 myq3_tapestry_state, 2595 myq3_statue_key_painting_state,
 * 2596 myq3_statue_state, 2584 myq3_runecase_searched,
 * 2598 myq3_agil_laddertop_wall, 2575 myq3_sketches_given.
 *
 * Source: OSRS Wiki "Darkness of Hallowvale", its Quick guide and
 * Transcript:Darkness of Hallowvale; the cache for every id, varbit, transform
 * table and placement; the Quest Helper plugin for the varp 869 step ladder.
 *
 * Gaps / approximations:
 * - The Meiyerditch rooftop maze is approximated. The route objects that are
 *   placed (pots/door key, wall ladders, locked shortcut door, rocky surface,
 *   barricade, ladder repair) are wired where the cache places them, but the
 *   rooftop jumps, crawl walls, tightropes and push-walls are not simulated;
 *   the barricade opens straight onto the Drakan walls. The old diary/bed beat
 *   is skipped: this cache revision has no bed transcript object and no old
 *   diary item.
 * - The vyrewatch do not patrol or notice the player; the "being noticed"
 *   encounter plays on Talk-to during the contact phase. The tithe costs 6
 *   hitpoints, fighting only damages and ends the chat (no mine punishment),
 *   and the distraction succeeds deterministically at 40+ Thieving.
 * - The Meiyerditch mine punishment ("Send me to the mines!") is not
 *   implemented; its transcripts are marked unavailable in the dump. Daeyalt
 *   ore and the mine cart exist but are not part of the verifier route.
 * - The fireplace only has Look-at on the cache object; the knife/sickle
 *   interactions are item-on-object. The inner laboratory door is a state
 *   check rather than a real door swap, and the laboratory stairs teleport.
 * - Sketches need the player near the marked approach (north 3556,3379, west
 *   3522,3357, south 3572,3331); a short guidance line is sent when using
 *   charcoal on papyrus away from all three (the wiki page has no line for
 *   that case).
 * - Start requirements are enforced at Veliaf and the start hook: In Aid of the
 *   Myreque plus Construction 5, Mining 20, Thieving 22, Agility 26,
 *   Crafting 32, Magic 33 and Strength 40, from cache DB row 22 column 23.
 * - Durable saves use internal stage 310 for completion; the varbit writer maps
 *   that to the cache DB completion floor 320 on varbit 2573. The client ladder
 *   also differs at three points, and the varbit writer maps them: 160 (Roald's
 *   teleport accepted) is the client's 170 ("return to Veliaf"), 170 (Veliaf has
 *   sent the player back) is the client's 180 ("return to Meiyerditch") and 300
 *   (the sealed message is in hand) is the client's 310 ("bring the message to
 *   Veliaf to finish").
 * - The post-quest shortcut doors and the tome's three 2,000 XP charges are
 *   not simulated; the tome is handed over as the 3-charge item.
 */
module.exports = function registerDarknessOfHallowvaleQuest(api) {
  const {
    HitDamage,
    HitMask,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Darkness of Hallowvale";
  const START_HOOK = "quest:darkness-of-hallowvale:start";

  // ---------------------------------------------------------------------------
  // Stage ladder (varbit 2573 "myq3_main_quest", varp 869 "myreque_3_main_var")
  // ---------------------------------------------------------------------------

  const STAGE_UNSTARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_BOAT_FIXED = 20;
  const STAGE_CHUTE_FIXED = 30;
  const STAGE_BOAT_PUSHED = 40;
  const STAGE_IN_MEIYERDITCH = 50;
  const STAGE_VYREWATCH_MET = 52;
  const STAGE_FLOORBOARDS = 54;
  const STAGE_RAL_KNOWN = 60;
  const STAGE_ROUTE_KNOWN = 65;
  const STAGE_HIDEOUT_OPEN = 70;
  const STAGE_IN_HIDEOUT = 80;
  const STAGE_MESSAGE_FROM_VERTIDA = 90;
  const STAGE_VELIAF_HAS_MESSAGE = 100;
  const STAGE_DREZEL_BRIEFED = 110;
  const STAGE_WEREWOLVES = 120;
  const STAGE_DREZEL_RUNES = 130;
  const STAGE_KING_ROALD = 140;
  const STAGE_KING_ROALD_TELEPORT = 160;
  const STAGE_VELIAF_SENT = 170;
  const STAGE_RETURNED = 180;
  const STAGE_SAFALAAN = 190;
  const STAGE_SKETCH_NORTH = 200;
  const STAGE_SKETCH_WEST = 210;
  const STAGE_SKETCH_SOUTH = 220;
  const STAGE_SARIUS = 240;
  const STAGE_SKETCHES_DONE = 250;
  const STAGE_SKETCHES_GIVEN = 260;
  const STAGE_LAB_OPEN = 280;
  const STAGE_BOOK_FOUND = 290;
  const STAGE_SEALED_MESSAGE = 300;
  const STAGE_COMPLETE = 310;
  // Cache DB row 22 column 19 completes at 320 on varbit 2573; 310 stays the durable alias.
  const STAGE_WIRE_COMPLETE = 320;
  // Client ladder values on varbit 2573 that differ from the durable stages.
  const STAGE_WIRE_RETURN_TO_VELIAF = 170; // "Return to Veliaf" (after Roald's teleport)
  const STAGE_WIRE_BACK_TO_MEIYERDITCH = 180; // "Return to the Meiyerditch Myreque base"
  const STAGE_WIRE_SEALED_MESSAGE = 310; // "Bring the sealed message to Veliaf to finish"

  // Cache varbits of varp 870 "myreque3_multivar" that drive the multi-locs.
  const VARBIT_BOAT_BROKEN = 2585;
  const VARBIT_CHUTE_BROKEN = 2586;
  const VARBIT_SEA_BOAT_VISIBLE = 2587;
  const VARBIT_WALL_FLOORBOARDS_DOWN = 2589;
  const VARBIT_HIDEOUT_TRAPDOOR = 2590;
  const VARBIT_WEREWOLF_BUSH = 2591;
  const VARBIT_SHORTCUT_DOOR_UNLOCKED = 2578; // myq3_agil_ghetto_locked_door
  const VARBIT_TAPESTRY_STATE = 2594;
  const VARBIT_PORTRAIT_STATE = 2595;
  const VARBIT_STATUE_STATE = 2596;
  const VARBIT_RUNECASE_SEARCHED = 2584;
  const VARBIT_LADDER_TOP_WALL = 2598;
  const VARBIT_SKETCHES_GIVEN = 2575; // myq3_sketches_given, varp 869 bit 10

  // ---------------------------------------------------------------------------
  // NPCs (cache ids; indexed transcript ids first)
  // ---------------------------------------------------------------------------

  const VELIAF_NPC_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879, // Veliaf Hurtz (cache id, no identifier)
    15885, // Veliaf Hurtz (cache id, no identifier)
    NpcIdentifiers.VELIAF_HURTZ_3, // 9489
    NpcIdentifiers.VELIAF_HURTZ_4, // 9521
    NpcIdentifiers.VELIAF_HURTZ_5, // 9522
    NpcIdentifiers.VELIAF_HURTZ_6, // 9523
    NpcIdentifiers.VELIAF_HURTZ_7, // 9524
    NpcIdentifiers.VELIAF_HURTZ_8, // 9525
    NpcIdentifiers.VELIAF_HURTZ_9, // 9526
    NpcIdentifiers.VELIAF_HURTZ_10, // 9527
    NpcIdentifiers.VELIAF_HURTZ_11, // 9528
    NpcIdentifiers.VELIAF_HURTZ_12, // 9529
    NpcIdentifiers.VELIAF_HURTZ_13, // 9621
  ]);
  const VERTIDA_NPC_IDS = new Set([
    NpcIdentifiers.VERTIDA_SEFALATIS, // 8220
    NpcIdentifiers.VERTIDA_SEFALATIS_2, // 8221
    NpcIdentifiers.VERTIDA_SEFALATIS_3, // 8222
    NpcIdentifiers.VERTIDA_SEFALATIS_4, // 8223
  ]);
  const SAFALAAN_NPC_IDS = new Set([
    NpcIdentifiers.SAFALAAN_HALLOW, // 3775
    NpcIdentifiers.SAFALAAN_HALLOW_2, // 8216
    NpcIdentifiers.SAFALAAN_HALLOW_3, // 8217
    NpcIdentifiers.SAFALAAN_HALLOW_4, // 8218
    NpcIdentifiers.SAFALAAN_HALLOW_5, // 8219
    NpcIdentifiers.SAFALAAN_HALLOW_6, // 9537
    NpcIdentifiers.SAFALAAN_HALLOW_7, // 9538
    NpcIdentifiers.SAFALAAN_HALLOW_8, // 9539
    NpcIdentifiers.SAFALAAN_HALLOW_9, // 9540
    NpcIdentifiers.SAFALAAN_HALLOW_10, // 9541
    NpcIdentifiers.SAFALAAN_HALLOW_11, // 9542
    15893, // Safalaan Hallow (cache id, no identifier)
    15894, // Safalaan Hallow (cache id, no identifier)
    15895, // Safalaan Hallow (cache id, no identifier)
    15896, // Safalaan Hallow (cache id, no identifier)
    15897, // Safalaan Hallow (cache id, no identifier)
    15898, // Safalaan Hallow (cache id, no identifier)
  ]);
  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL; // 9636 (the indexed quest copy)
  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD, // 1399
    NpcIdentifiers.KING_ROALD_2, // 4163
    NpcIdentifiers.KING_ROALD_3, // 5215
    NpcIdentifiers.KING_ROALD_5, // 8042
    8043, // King Roald (cache id, no identifier)
    11019, // King Roald (cache id, no identifier)
    12620, // King Roald (cache id, no identifier)
    12621, // King Roald (cache id, no identifier)
  ]);
  const HIYLIK_MYNA_NPC_ID = NpcIdentifiers.HIYLIK_MYNA; // 1579
  const OLD_MAN_RAL_NPC_ID = NpcIdentifiers.OLD_MAN_RAL; // 3772
  const OLD_MAN_RAL_NPC_IDS = new Set([
    OLD_MAN_RAL_NPC_ID,
    NpcIdentifiers.OLD_MAN_RAL_2, // 15774
    NpcIdentifiers.OLD_MAN_RAL_3, // 15775
  ]);

  /** Cache id ranges: every Meiyerditch vyrewatch that speaks this page. */
  function idRange(start, end) {
    const ids = [];
    for (let id = start; id <= end; id++) ids.push(id);
    return ids;
  }
  const VYREWATCH_NPC_IDS = new Set([
    ...idRange(3709, 3732), // Vyrewatch
    ...idRange(3748, 3763), // Vyrewatch
    ...idRange(8252, 8259), // Vyrewatch
    ...idRange(8300, 8307), // Vyrewatch
    ...idRange(9735, 9742), // Vyrewatch
  ]);

  // Quest-only spawn copies (owner-only) and their canonical tiles.
  const VELIAF_SPAWN_ID = NpcIdentifiers.VELIAF_HURTZ; // 989, indexed
  const VERTIDA_SPAWN_ID = NpcIdentifiers.VERTIDA_SEFALATIS; // 8220, indexed
  const SAFALAAN_WALL_SPAWN_ID = NpcIdentifiers.SAFALAAN_HALLOW_2; // 8216, indexed
  const SAFALAAN_BASE_SPAWN_ID = NpcIdentifiers.SAFALAAN_HALLOW_2; // 8216 (8217 has no Talk-to option)
  const DREZEL_SPAWN_ID = NpcIdentifiers.DREZEL; // 9636, indexed
  const SARIUS_SPAWN_ID = NpcIdentifiers.SARIUS_GUILE; // 3776, indexed Talk-to

  const VELIAF_BASEMENT_TILE = { x: 3494, y: 9628, z: 0 };
  const VERTIDA_HIDEOUT_TILE = { x: 3627, y: 9644, z: 0 };
  const SAFALAAN_WALL_TILE = { x: 3585, y: 3331, z: 0 };
  const SAFALAAN_BASE_TILE = { x: 3632, y: 9644, z: 0 };
  const SARIUS_WALL_TILE = { x: 3572, y: 3331, z: 0 };
  const DREZEL_TEMPLE_TILE = { x: 3439, y: 9896, z: 0 };

  const MEIYERDITCH_ARRIVAL = { x: 3588, y: 3173, z: 1 };
  const MEIYERDITCH_INSIDE = { x: 3593, y: 3173, z: 0 };
  const BURGH_DOCKS = { x: 3523, y: 3169, z: 0 };
  const HIDEOUT_LANDING = { x: 3626, y: 9620, z: 0 };
  const HIDEOUT_SURFACE = { x: 3639, y: 3251, z: 0 };
  const LAB_LANDING = { x: 3630, y: 9694, z: 0 };
  const LAB_SURFACE = { x: 3643, y: 3305, z: 0 };
  const DRAKAN_WALLS = { x: 3595, y: 3310, z: 1 };
  const DRAKAN_WALLS_TOP = { x: 3595, y: 3311, z: 0 };
  const TRADER_SVEN_HOUSE = { x: 3597, y: 3203, z: 0 };

  // Castle approach sketching spots (sickle markers on the walls).
  const SKETCH_NORTH_SPOT = { x: 3556, y: 3379 };
  const SKETCH_WEST_SPOT = { x: 3522, y: 3357 };
  const SKETCH_SOUTH_SPOT = { x: 3572, y: 3331 };

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const CHARCOAL_ITEM_ID = ItemIdentifiers.CHARCOAL; // 973
  const PAPYRUS_ITEM_ID = ItemIdentifiers.PAPYRUS; // 970
  const SILVER_SICKLE_ITEM_ID = ItemIdentifiers.SILVER_SICKLE; // 2961
  const SILVER_SICKLE_BLESSED_ITEM_ID = ItemIdentifiers.SILVER_SICKLE_B_; // 2963
  const LAW_RUNE_ITEM_ID = ItemIdentifiers.LAW_RUNE; // 563
  const AIR_RUNE_ITEM_ID = ItemIdentifiers.AIR_RUNE; // 556
  const FIRE_RUNE_ITEM_ID = ItemIdentifiers.FIRE_RUNE; // 554
  const WATER_RUNE_ITEM_ID = ItemIdentifiers.WATER_RUNE; // 555
  const MIND_RUNE_ITEM_ID = ItemIdentifiers.MIND_RUNE; // 558
  const NAIL_ITEM_IDS = [
    ItemIdentifiers.BRONZE_NAILS, // 4819
    ItemIdentifiers.IRON_NAILS, // 4820
    ItemIdentifiers.STEEL_NAILS, // 1539
    ItemIdentifiers.BLACK_NAILS, // 4821
    ItemIdentifiers.MITHRIL_NAILS, // 4822
    ItemIdentifiers.ADAMANTITE_NAILS, // 4823
    ItemIdentifiers.RUNE_NAILS, // 4824
  ];

  // Darkness of Hallowvale quest items (cache ids, no generated identifiers).
  const DOOR_KEY_ITEM_ID = 9654; // "Door key"
  const LADDER_TOP_ITEM_ID = 9655; // "Ladder top"
  const SKETCH_1_ITEM_ID = 9646; // "Castle sketch 1" (northern approach)
  const SKETCH_2_ITEM_ID = 9647; // "Castle sketch 2" (western approach)
  const SKETCH_3_ITEM_ID = 9648; // "Castle sketch 3" (southern approach)
  const FIREPLACE_MESSAGE_ITEM_ID = 9649; // "Message" (Sarius's, behind the tile)
  const ORNATE_KEY_ITEM_ID = 9651; // "Large ornate key"
  const HAEMALCHEMY_ITEM_ID = 9652; // "Haemalchemy volume 1"
  const SEALED_MESSAGE_ITEM_ID = 9653; // "Sealed message"
  const VERTIDA_MESSAGE_ITEM_ID = 9633; // "Message" (Vertida -> Veliaf)
  const TOME_ITEM_ID = 9656; // "Tome of Experience (3)"
  const TOME_ITEM_IDS = [9656, 9657, 9658]; // (3)/(2)/(1) charges

  // ---------------------------------------------------------------------------
  // Objects (cache ids, no generated identifiers; names are the cache's own)
  // ---------------------------------------------------------------------------

  const BURGH_BOAT_MULTI_ID = 12944; // "null" -> 17953 Boat Inspect / 17954 Boat Push (varbit 2585)
  const BURGH_BOAT_WATER_MULTI_ID = 12945; // "null" -> 17955 Boat Board (varbit 2587)
  const BURGH_CHUTE_MULTI_ID = 12947; // "null" -> 17956 Boat Chute Inspect (varbit 2586)
  const BOAT_BROKEN_OBJECT_ID = 17953; // "Boat" Inspect
  const BOAT_FIXED_OBJECT_ID = 17954; // "Boat" Push
  const MEIYERDITCH_ARRIVAL_BOAT_ID = 17955; // "Boat" Board at 3604,3160

  const WALL_FLOORBOARDS_MULTI_ID = 18122; // "null" -> 18033 Floor Search / 18034 Climb-down
  const WEREWOLF_BUSH_OBJECT_ID = 18121; // "null" multi -> 17988 Bush / 17989 Bush Search (varbit 2591)
  const WEREWOLF_BUSH_SEARCH_ID = 17989; // "Bush" Search
  const ROCKY_SURFACE_OBJECT_ID = 18056; // "Rocky surface" Search
  const BARRICADE_OBJECT_ID = 18054; // "Barricade" Open
  const DRAKAN_WALL_SHORTCUT_UP_OBJECT_ID = 39173; // "Wall" Climb-up at 3595,3310,1
  const DRAKAN_WALL_SHORTCUT_DOWN_OBJECT_ID = 39172; // "Wall" Climb-down at 3595,3311,0
  const POTS_OBJECT_ID = 18065; // "Pots" Search
  const SHORTCUT_DOOR_OBJECT_ID = 18091; // "Door" Open (needs the door key)
  const HIDEOUT_WALL_OBJECT_ID = 17980; // "Wall" Push
  const HIDEOUT_SYMBOL_MULTI_ID = 18146; // "null" -> 18144 Press (varbit 2590)
  const HIDEOUT_RUG_MULTI_ID = 18120; // "null" -> 17984 Lumpy rug / 17985 Trapdoor
  const HIDEOUT_RUG_OBJECT_ID = 17984; // "Lumpy rug" Open
  const HIDEOUT_LADDER_UP_ID = 17986; // "Ladder" Climb-up at 3626,9617
  const LADDER_TOP_WALL_MULTI_ID = 18115; // "null" -> 18066/18067 Wall Search (varbit 2598)
  const LADDER_TOP_WALL_OBJECT_ID = 18066; // "Wall" Search (has the top)
  const FLOOR_LADDER_MULTI_ID = 18116; // "null" -> 18068 Broken ladder / 18069 Ladder
  const FIXED_LADDER_OBJECT_ID = 18069; // "Ladder" Climb-down

  const FIREPLACE_OBJECT_ID = 18039; // "Fireplace" Look-at
  const PORTRAIT_MULTI_ID = 18126; // "null" -> 18042/18043/18044 Portrait (varbit 2595)
  const TAPESTRY_MULTI_ID = 18125; // "null" -> 18040 Tapestry / 18041 Slashed (varbit 2594)
  const TAPESTRY_SLASHED_OBJECT_ID = 18041; // "Slashed tapestry" Walk-through
  const STATUE_MULTI_ID = 18127; // "null" -> 18045/18046 Vampyre statue (varbit 2596)
  const LAB_DOOR_OBJECT_ID = 18047; // "Door" Open
  const LAB_STAIRS_DOWN_ID = 18049; // "Staircase" Climb-down
  const LAB_STAIRS_UP_ID = 18050; // "Staircase" Climb-up
  const RUNE_CASE_OBJECT_ID = 18052; // "Broken rune case" Search

  // ---------------------------------------------------------------------------
  // Transcript condition / action / choice step ids
  // ---------------------------------------------------------------------------

  const CONDITION_REQUIRED_ITEMS = new Set(["_usOY0", "RdMtCs"]);
  const CONDITION_MISSING_ITEMS = new Set(["yogQve", "tLHWhM"]);
  const CONDITION_DISTRACTION_SUCCESS = "31eYvP";
  const CONDITION_DISTRACTION_FAIL = "0T6MNv";
  const CONDITION_TOME_LOST = "1VQDP4";
  const CONDITION_RAL_PAPYRUS_SHORT = "5Ts7kd";
  const CONDITION_CONTINUING_FROM_IN_AID = "5iTY3c";
  const CONDITION_COMING_BACK_TO_VELIAF = "Ao7Gq6";

  const ACTION_KICK_FLOORBOARDS = "lOyj8b";
  const ACTION_PUSH_BOAT = "TZQ0Xt";
  const ACTION_BOARD_BOAT = "3tBjzy";
  const ACTION_PAY_TITHE = "2J_8qM";
  const ACTION_FIGHT_VYREWATCH = "9R6EAA";
  const ACTION_DODGE_VYREWATCH = "GhU7Fg";
  const ACTION_PUSH_HIDEOUT_WALL = "gzcVPB";
  const ACTION_RECEIVE_DOOR_KEY = "YpqCg3";
  const ACTION_UNLOCK_SHORTCUT_DOOR = "K30GgU";
  const ACTION_RECEIVE_LADDER_TOP = "6j1G8t";
  const ACTION_FIX_LADDER = "cjSvUe";
  const ACTION_OPEN_TRAPDOOR = "zW_lRH";
  const ACTION_SEARCH_BUSH = "oTtrXk";
  const ACTION_WEREWOLF_KNOCKOUT = "x6Upep";
  const ACTION_WEREWOLF_WAKE = "T1AXPq";
  const ACTION_RECEIVE_VERTIDA_MESSAGE = new Set([
    "2nbZ9m", "ZsS1Zs", "V3ECPh", "5sp21e", "QVrbhO", "JmwM4H",
  ]);
  const ACTION_HAND_MESSAGE_VELIAF = "ctOdo7";
  const ACTION_DREZEL_RUNES = "CvqNxO";
  const ACTION_ROALD_TELEPORT = "K65B9f";
  const ACTION_ROALD_CAST = "BuUg-I";
  const ACTION_ROALD_ARRIVE = "JESHYF";
  const ACTION_VERTIDA_LEADS = "lTNaN8";
  const ACTION_ROCKS_MOVE = "_bUtsy";
  const ACTION_SAFALAAN_CHARCOAL = "H84BAo";
  const ACTION_SAFALAAN_PAPYRUS = "q1EHcV";
  const ACTION_SKETCH_NORTH_LOSE = "40UwLv";
  const ACTION_RECEIVE_SKETCH_1 = "stfs9v";
  const ACTION_SKETCH_WEST_LOSE = "5hTQYh";
  const ACTION_RECEIVE_SKETCH_2 = "9HmeKD";
  const ACTION_SKETCH_SOUTH_START = "T3YqyD";
  const ACTION_SARIUS_SCENE_END = "aCPM8x";
  const ACTION_SKETCH_SOUTH_LOSE = "yFIZpi";
  const ACTION_RECEIVE_SKETCH_3 = "IxTC2L";
  const ACTION_GIVE_SKETCHES = "3RdQ7u";
  const ACTION_GIVE_HAEMALCHEMY = "3QAxxe";
  const ACTION_RECEIVE_SEALED_MESSAGE = "lzpy1g";
  const ACTION_SAFALAAN_NEW_SEALED = "nvMPrA";
  const ACTION_RUNECASE_RUNES = "xVr0GB";
  const ACTION_TOME_GIVEN = "DnjVLC";
  const ACTION_COMPLETE = "xIJysR";
  const ACTION_FIREPLACE_KNIFE = "_PqnRK";
  const ACTION_FIREPLACE_MESSAGE = "au23P0";
  const ACTION_PORTRAIT_KNIFE = "1UyE4K";
  const ACTION_PORTRAIT_KEY = "JSi5fj";
  const ACTION_PORTRAIT_TAKE_KEY = "TjjajY";
  const ACTION_TAPESTRY_SLASH = "X-aSfS";
  const ACTION_STATUE_PLACE_KEY = "w7RMRv";
  const ACTION_STATUE_LOSE_KEY = "0cXlqe";
  const ACTION_DOOR_SHOCK = "6bSK4j";
  const ACTION_DOOR_SHOCK_DAMAGE = "nC7UJf";
  const ACTION_SAFALAAN_SHOW_MESSAGE = "fKY8Zv";
  const ACTION_RAL_PAPYRUS = "UUhUYv";

  const CHOICE_CITIZEN_WHISPER = "(whisper) Do you know about the Myreque?";
  const CHOICE_CITIZEN_INSIST = "(whisper) I really need to meet the Myreque.";
  const CHOICE_CITIZEN_RAL = "Can you introduce me to Old Man Ral?";
  const CHOICE_CITIZEN_RAL_HELP = "How can Old Man Ral help me?";
  const CHOICE_RAL_SAGE = "Old Man Ral, the sage of Sanguinesti.";
  const CHOICE_DREZEL_DONE = "Okay, will do.";
  const CHOICE_ROALD_MORYTANIA = "Talk to the king about Morytania.";

  // ---------------------------------------------------------------------------
  // Persisted sub-state
  // ---------------------------------------------------------------------------

  const BITS_ATTRIBUTE = "quest.darkness_of_hallowvale.bits";
  const BIT_BOAT_FIXED = 1 << 0;
  const BIT_CHUTE_FIXED = 1 << 1;
  const BIT_BOAT_PUSHED = 1 << 2;
  const BIT_FLOORBOARDS = 1 << 3;
  const BIT_TAPESTRY = 1 << 4;
  const BIT_RUNECASE = 1 << 5;
  const BIT_LATCH = 1 << 6;
  const BIT_ROCKS = 1 << 7;
  const BIT_SAFALAAN_MESSAGE_SHOWN = 1 << 8;
  const BIT_DOOR_UNLOCKED = 1 << 9;
  const BIT_STATUE = 1 << 10;
  const BIT_SAFALAAN_SUPPLIES = 1 << 11;
  const BIT_LADDER_TOP = 1 << 12;
  const BIT_LADDER_FIXED = 1 << 13;
  const BIT_SARIUS_TALKED = 1 << 23; // The stage-240 Sarius Talk-to was completed
  const TRAPDOOR_SHIFT = 14; // 2 bits: 0 hidden, 1 rug, 2 trapdoor
  const PORTRAIT_SHIFT = 16; // 2 bits: 0 intact, 1 slashed+key, 2 slashed empty
  const ENCOUNTER_SHIFT = 18; // 2 bits: 0 none, 1 tithed, 2 fought, 3 dodged
  const CITIZEN_PHASE_SHIFT = 20; // 2 bits: 0, 1 whispered, 2 insisted, 3 Ral known

  /** Host NPC for object/item-driven transcripts (messages carry no speaker). */
  const PROP_ID = NpcIdentifiers.MEIYERDITCH_CITIZEN; // 3780

  let quest;
  const spawnedByPlayer = new Map();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
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

  function field(player, shift) {
    return (bits(player) >> shift) & 0b11;
  }

  function setField(player, shift, value) {
    const mask = 0b11 << shift;
    player.setAttribute(BITS_ATTRIBUTE, (bits(player) & ~mask) | ((value & 0b11) << shift));
  }

  function nailsHeld(player) {
    return NAIL_ITEM_IDS.reduce((sum, itemId) => sum + player.getInventory().getAmount(itemId), 0);
  }

  function consumeNails(player, amount) {
    let remaining = amount;
    for (const itemId of NAIL_ITEM_IDS) {
      if (remaining <= 0) return;
      const available = player.getInventory().getAmount(itemId);
      const take = Math.min(available, remaining);
      if (take > 0) {
        player.getInventory().deleteNumber(itemId, take);
        remaining -= take;
      }
    }
  }

  function hasRepairTools(player) {
    return held(player, HAMMER_ITEM_ID) && held(player, PLANK_ITEM_ID) && nailsHeld(player) >= 4;
  }

  function sketchCount(player) {
    let count = 0;
    if (held(player, SKETCH_1_ITEM_ID)) count++;
    if (held(player, SKETCH_2_ITEM_ID)) count++;
    if (held(player, SKETCH_3_ITEM_ID)) count++;
    return count;
  }

  const hasAllSketches = (player) =>
    held(player, SKETCH_1_ITEM_ID) && held(player, SKETCH_2_ITEM_ID) && held(player, SKETCH_3_ITEM_ID);

  function near(player, spot, radius = 8) {
    const location = player.getLocation();
    return (
      Math.max(Math.abs(location.getX() - spot.x), Math.abs(location.getY() - spot.y)) <= radius
    );
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  /** Roughly Meiyerditch, so the shared "Child"/"Vyrewatch" names stay scoped. */
  function inMeiyerditch(player) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    return x >= 3560 && x <= 3690 && y >= 3150 && y <= 3405;
  }

  /** In Aid of the Myreque must be complete before this quest can start. */
  function inAidComplete(player) {
    const request = { player, key: "in_aid_of_the_myreque", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  // Cache DB row 22 column 23: Strength 40, Magic 33, Crafting 32, Agility 26,
  // Thieving 22, Mining 20, Construction 5.
  const REQUIRED_SKILLS = [
    { skill: Skill.CONSTRUCTION, level: 5, label: "Construction" },
    { skill: Skill.MINING, level: 20, label: "Mining" },
    { skill: Skill.THIEVING, level: 22, label: "Thieving" },
    { skill: Skill.AGILITY, level: 26, label: "Agility" },
    { skill: Skill.CRAFTING, level: 32, label: "Crafting" },
    { skill: Skill.MAGIC, level: 33, label: "Magic" },
    { skill: Skill.STRENGTH, level: 40, label: "Strength" },
  ];

  // A Taste of Hope owns Veliaf's canonical rod hand-out while its own stage is
  // in this window. Darkness yields rather than starting its own conversation.
  function tasteNeedsVeliafRod(player) {
    const request = { player, needsRod: false };
    api.emitCustomEvent("taste-of-hope:needs-veliaf-rod", request);
    return request.needsRod === true;
  }

  function meetsRequirements(player) {
    if (!inAidComplete(player)) return false;
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.every((entry) => skills.getMaxLevel(entry.skill) >= entry.level);
  }

  function requirementsMessage(player) {
    if (!inAidComplete(player)) {
      player.sendMessage("You must have completed In Aid of the Myreque to start this quest.");
    }
    const skills = player.getSkillManager();
    for (const entry of REQUIRED_SKILLS) {
      if (skills.getMaxLevel(entry.skill) < entry.level) {
        player.sendMessage(`You need ${entry.level} ${entry.label} to start this quest.`);
      }
    }
  }

  function advance(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    applyStageSpawns(player);
    syncVisuals(player);
  }

  /**
   * A standalone transcript replay has no page context, so a leading wiki
   * navigation jump can only resolve to "end"; skip it and play the real body.
   */
  function withoutLeadingJumps(steps) {
    if (!Array.isArray(steps)) return steps;
    let start = 0;
    while (start < steps.length && steps[start]?.type === "jump") start++;
    return start > 0 ? steps.slice(start) : steps;
  }

  function sariusWakeIndex(steps) {
    if (!Array.isArray(steps)) return -1;
    return steps.findIndex(
      (step) => step?.type === "line" && step.speaker === "Sarius Guile" && /^Awaken!/.test(step.text ?? "")
    );
  }

  /** The first south-sketch scene ends as Vanstrom departs; Sarius wakes the player separately. */
  function beforeSariusWake(steps) {
    const start = sariusWakeIndex(steps);
    return start > 0 ? steps.slice(0, start) : steps;
  }

  /** The stage-240 Talk-to plays the same imported Sarius dialogue, not a copied scene. */
  function fromSariusWake(steps) {
    const start = sariusWakeIndex(steps);
    return start >= 0 ? steps.slice(start) : steps;
  }

  function play(player, npcId, variant, select = withoutLeadingJumps) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  /** Opens the laboratory once both the tapestry and the statue are done. */
  function maybeOpenLab(player) {
    if (hasBit(player, BIT_TAPESTRY) && hasBit(player, BIT_STATUE)) {
      advance(player, STAGE_LAB_OPEN);
    }
  }

  function damage(player, amount) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);
  }

  // ---------------------------------------------------------------------------
  // Quest spawns (owner-only actors the world does not place)
  // ---------------------------------------------------------------------------

  function spawnKey(player, key, npcId, tile) {
    if (!player || player.isPlayerBot?.() === true) return;
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

  /** Keeps exactly the quest NPCs the current stage needs present. */
  function applyStageSpawns(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    // In Aid of the Myreque already leaves its owner-only Veliaf 5048 at this
    // tile once complete. Reuse it; only spawn a fallback for a save without it.
    if (stage >= STAGE_STARTED && !inAidComplete(player)) {
      spawnKey(player, "veliaf", VELIAF_SPAWN_ID, VELIAF_BASEMENT_TILE);
    } else {
      despawnKey(player, "veliaf");
    }
    if (stage >= STAGE_IN_HIDEOUT) {
      spawnKey(player, "vertida", VERTIDA_SPAWN_ID, VERTIDA_HIDEOUT_TILE);
    } else {
      despawnKey(player, "vertida");
    }
    if (stage >= STAGE_SARIUS && stage < STAGE_SKETCHES_DONE) {
      spawnKey(player, "sarius", SARIUS_SPAWN_ID, SARIUS_WALL_TILE);
    } else {
      despawnKey(player, "sarius");
    }
    if (stage >= STAGE_SAFALAAN && stage < STAGE_SKETCHES_DONE) {
      spawnKey(player, "safalaan_wall", SAFALAAN_WALL_SPAWN_ID, SAFALAAN_WALL_TILE);
      despawnKey(player, "safalaan_base");
    } else if (stage >= STAGE_SKETCHES_DONE) {
      despawnKey(player, "safalaan_wall");
      spawnKey(player, "safalaan_base", SAFALAAN_BASE_SPAWN_ID, SAFALAAN_BASE_TILE);
    } else {
      despawnKey(player, "safalaan_wall");
      despawnKey(player, "safalaan_base");
    }
    if (stage >= STAGE_VELIAF_HAS_MESSAGE && stage < STAGE_RETURNED) {
      spawnKey(player, "drezel", DREZEL_SPAWN_ID, DREZEL_TEMPLE_TILE);
    } else {
      despawnKey(player, "drezel");
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-loc state -> cache varbits
  // ---------------------------------------------------------------------------

  function syncVisuals(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_BOAT_BROKEN, hasBit(player, BIT_BOAT_FIXED) ? 1 : 0);
    sender.sendVarbit(VARBIT_CHUTE_BROKEN, hasBit(player, BIT_CHUTE_FIXED) ? 1 : 0);
    sender.sendVarbit(VARBIT_SEA_BOAT_VISIBLE, hasBit(player, BIT_BOAT_PUSHED) ? 1 : 0);
    sender.sendVarbit(VARBIT_SHORTCUT_DOOR_UNLOCKED, hasBit(player, BIT_DOOR_UNLOCKED) ? 1 : 0);
    sender.sendVarbit(VARBIT_WALL_FLOORBOARDS_DOWN, hasBit(player, BIT_FLOORBOARDS) ? 1 : 0);
    sender.sendVarbit(VARBIT_HIDEOUT_TRAPDOOR, field(player, TRAPDOOR_SHIFT));
    sender.sendVarbit(
      VARBIT_WEREWOLF_BUSH,
      quest.getStage(player) >= STAGE_DREZEL_BRIEFED && quest.getStage(player) < STAGE_DREZEL_RUNES ? 1 : 0
    );
    sender.sendVarbit(VARBIT_TAPESTRY_STATE, hasBit(player, BIT_TAPESTRY) ? 1 : 0);
    sender.sendVarbit(VARBIT_PORTRAIT_STATE, field(player, PORTRAIT_SHIFT));
    sender.sendVarbit(VARBIT_STATUE_STATE, hasBit(player, BIT_STATUE) ? 1 : 0);
    sender.sendVarbit(VARBIT_RUNECASE_SEARCHED, hasBit(player, BIT_RUNECASE) ? 1 : 0);
    sender.sendVarbit(
      VARBIT_LADDER_TOP_WALL,
      hasBit(player, BIT_LADDER_FIXED) ? 2 : hasBit(player, BIT_LADDER_TOP) ? 1 : 0
    );
    sender.sendVarbit(
      VARBIT_SKETCHES_GIVEN,
      quest.getStage(player) >= STAGE_SKETCHES_GIVEN ? 1 : 0
    );
  }

  // ---------------------------------------------------------------------------
  // Journal
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Veliaf asked me to make contact with the Sanguinesti Myreque.</str>",
        "<str>I reached the Meiyerditch hideout and delivered Vertida's message.</str>",
        "<str>I survived the werewolf ambush and King Roald's refusal to help.</str>",
        "<str>I sketched the three sides of Castle Drakan and found the laboratory.</str>",
        "<str>I took the sealed message back to Veliaf in Burgh de Rott.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SEALED_MESSAGE) {
      return [
        "Safalaan gave me a <col=800000>sealed message</col> for Veliaf.",
        "",
        "I should take it to <col=800000>Veliaf Hurtz</col> in the basement of the",
        "pub in <col=800000>Burgh de Rott</col> to finish the quest.",
      ];
    }
    if (stage >= STAGE_BOOK_FOUND) {
      return [
        "I took <col=800000>Haemalchemy volume 1</col> from the laboratory.",
        "",
        "I should show the book to <col=800000>Safalaan</col> in the hideout.",
      ];
    }
    if (stage >= STAGE_LAB_OPEN) {
      return [
        "The laboratory is open. Sarius's riddle was 'behind tiles where",
        "smoke is carried away from the depiction of statuesque evil'.",
        "",
        "I should search the laboratory for anything useful.",
      ];
    }
    if (stage >= STAGE_SKETCHES_GIVEN) {
      return [
        "I gave the castle sketches to Safalaan.",
        "",
        held(player, FIREPLACE_MESSAGE_ITEM_ID)
          ? "<str>I found Sarius Guile's message behind the fireplace tile.</str>"
          : "Sarius's message is hidden 'behind tiles where smoke is carried",
        held(player, FIREPLACE_MESSAGE_ITEM_ID) ? "" : "away from the depiction of statuesque evil'.",
        "",
        held(player, HAEMALCHEMY_ITEM_ID)
          ? "I should show the <col=800000>Haemalchemy book</col> to Safalaan."
          : "I should investigate the fireplace and portrait near the hideout.",
      ];
    }
    if (stage >= STAGE_SKETCHES_DONE) {
      return [
        "<str>I have all three sketches of Castle Drakan.</str>",
        held(player, FIREPLACE_MESSAGE_ITEM_ID)
          ? "<str>I found Sarius Guile's message behind the fireplace tile.</str>"
          : "Sarius's message is hidden 'behind tiles where smoke is carried",
        held(player, FIREPLACE_MESSAGE_ITEM_ID) ? "" : "away from the depiction of statuesque evil'.",
        "",
        "I should take the sketches to <col=800000>Safalaan</col>.",
      ];
    }
    if (stage >= STAGE_SARIUS) {
      return [
        "Sarius Guile saved me from Vanstrom and told me the message is",
        "hidden 'behind tiles where smoke is carried away from the depiction of",
        "statuesque evil'.",
        "",
        "I should speak to Sarius if I have not already, then finish the",
        "southern sketch and take all three to <col=800000>Safalaan</col>.",
      ];
    }
    if (stage >= STAGE_SKETCH_SOUTH) {
      return [
        "I was ambushed by Vanstrom while sketching the southern approach.",
        "Sarius Guile saved me and hinted at a hidden laboratory.",
        "",
        "I need to finish the southern sketch and take all three to",
        "<col=800000>Safalaan</col>.",
      ];
    }
    if (stage >= STAGE_SKETCH_WEST) {
      return [
        "I am sketching the three sides of Castle Drakan.",
        "<str>The northern approach is sketched.</str>",
        `<col=800000>Western approach</col>: ${
          held(player, SKETCH_2_ITEM_ID) ? "done" : "not sketched yet"
        }.`,
        "<col=800000>Southern approach</col>: not sketched yet.",
      ];
    }
    if (stage >= STAGE_SKETCH_NORTH) {
      return [
        "I am taking over Safalaan's mission to sketch Castle Drakan from",
        "the north, then the west, then the south.",
        "<col=800000>Northern approach</col>: not sketched yet.",
      ];
    }
    if (stage >= STAGE_SAFALAAN) {
      return [
        "I returned to Meiyerditch and Vertida led me to <col=800000>Safalaan</col>,",
        "who is scouting <col=800000>Castle Drakan</col>.",
        "",
        "I should speak to him on the walls.",
      ];
    }
    if (stage >= STAGE_RETURNED) {
      return [
        "Veliaf asked me to warn the Sanguinesti Myreque about the events",
        "at Paterdomus.",
        "",
        "I should find <col=800000>Vertida</col> in the Meiyerditch hideout.",
      ];
    }
    if (stage >= STAGE_VELIAF_SENT) {
      return [
        "I found werewolves crossing the Salve and King Roald would not help.",
        "",
        "Veliaf wants me to take the news to the Sanguinesti Myreque and",
        "get back to <col=800000>Meiyerditch</col>.",
      ];
    }
    if (stage >= STAGE_KING_ROALD_TELEPORT) {
      return [
        "King Roald refused to send troops because of the Guthixian edicts.",
        "",
        "I should report back to <col=800000>Veliaf Hurtz</col> in Burgh de Rott.",
      ];
    }
    if (stage >= STAGE_KING_ROALD) {
      return [
        "Drezel gave me runes and asked me to speak to <col=800000>King Roald</col>.",
        "",
        "I should ask the king about Morytania in Varrock Castle.",
      ];
    }
    if (stage >= STAGE_DREZEL_RUNES) {
      return [
        "Drezel gave me some runes for a Varrock teleport.",
        "",
        "I should speak to <col=800000>King Roald</col> in Varrock Castle.",
      ];
    }
    if (stage >= STAGE_WEREWOLVES) {
      return [
        "I was knocked out while searching the bush outside Paterdomus.",
        "I saw shadowy werewolves crossing the River Salve.",
        "",
        "I should tell <col=800000>Drezel</col> what I saw.",
      ];
    }
    if (stage >= STAGE_DREZEL_BRIEFED) {
      return [
        "Drezel says strange noises have been heard outside Paterdomus.",
        "",
        "I should search the <col=800000>bush</col> outside the temple, near the",
        "stairs towards Varrock.",
      ];
    }
    if (stage >= STAGE_VELIAF_HAS_MESSAGE) {
      return [
        "Veliaf says Drezel has reported strange goings-on at Paterdomus.",
        "",
        "I should speak to <col=800000>Drezel</col> under the temple.",
      ];
    }
    if (stage >= STAGE_MESSAGE_FROM_VERTIDA) {
      return [
        "Vertida gave me a <col=800000>message</col> as proof that the Sanguinesti",
        "Myreque still exists.",
        "",
        "I should take it to <col=800000>Veliaf Hurtz</col> in Burgh de Rott.",
      ];
    }
    if (stage >= STAGE_IN_HIDEOUT) {
      return [
        "I made it into the Sanguinesti Myreque hideout.",
        "",
        "I should speak to <col=800000>Vertida</col> in the northern room.",
      ];
    }
    if (stage >= STAGE_ROUTE_KNOWN) {
      return [
        "Old Man Ral told me to follow the <col=800000>sickle symbols</col> to reach",
        "the Myreque hideout.",
        "",
        "The wall guarding the entrance has a latch that a knife can unhook.",
      ];
    }
    if (stage >= STAGE_RAL_KNOWN) {
      return [
        "A citizen told me to speak to <col=800000>Old Man Ral</col>.",
        "",
        "They said to tell him a friend recommended him - the 'sage of",
        "Sanguinesti'.",
      ];
    }
    if (stage >= STAGE_FLOORBOARDS) {
      return [
        "I reached Meiyerditch and dealt with the vyrewatch.",
        "",
        "I should make contact with a <col=800000>citizen</col> and ask, quietly,",
        "about the Myreque.",
      ];
    }
    if (stage >= STAGE_IN_MEIYERDITCH) {
      return [
        "I docked the boat at a climbable portion of the wall.",
        "",
        "I should get over the wall and be careful of the vyrewatch.",
      ];
    }
    if (stage >= STAGE_BOAT_PUSHED) {
      return [
        "The boat and chute are repaired and the boat is in the water.",
        "",
        "I should <col=800000>board the boat</col> to cross to the Sanguinesti region.",
      ];
    }
    if (stage >= STAGE_CHUTE_FIXED) {
      return [
        "The boat is repaired.",
        "",
        "I should push the boat down the chute into the water.",
      ];
    }
    if (stage >= STAGE_BOAT_FIXED) {
      return [
        "The boat is repaired.",
        "",
        "I should repair the <col=800000>boat chute</col> with a plank and nails.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Veliaf wants me to scout a route into the Sanguinesti region and",
        "make contact with the Myreque there.",
        "",
        "I should repair the <col=800000>boat</col> at the Burgh de Rott docks with",
        "2 planks, 8 nails and a hammer.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Veliaf Hurtz</col> in the",
      "basement of the pub in <col=800000>Burgh de Rott</col>.",
      "",
      "I need to have completed <col=800000>In Aid of the Myreque</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 7000);
    skills.addExperiences(Skill.THIEVING, 6000);
    skills.addExperiences(Skill.CONSTRUCTION, 2000);
    applyStageSpawns(player);
  }

  // ---------------------------------------------------------------------------
  // Dialogue: variant selection
  // ---------------------------------------------------------------------------

  function veliafVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-veliaf-hurtz-after-finishing-the-quest";
    if (stage >= STAGE_SEALED_MESSAGE) {
      return held(player, SEALED_MESSAGE_ITEM_ID)
        ? "in-search-of-statuesque-evil-talking-to-veliaf-hurtz-with-the-message-from-safalaan-hallow"
        : "in-search-of-statuesque-evil-talking-to-veliaf-hurtz-without-the-message-from-safalaan-hallow";
    }
    if (stage >= STAGE_SKETCH_NORTH) {
      return "close-encounters-with-vyre-kind-talking-to-veliaf-hurtz-after-talking-to-safalaan-hallow";
    }
    if (stage >= STAGE_VELIAF_SENT) {
      return "misthalin-diplomacy-talking-to-veliaf-again-after-being-sent-to-inform-the-sanguinesti-myreque";
    }
    if (stage >= STAGE_KING_ROALD_TELEPORT) {
      return "misthalin-diplomacy-talking-to-veliaf-hurtz-after-talking-to-king-roald";
    }
    if (stage >= STAGE_KING_ROALD) {
      return "misthalin-diplomacy-talking-to-veliaf-hurtz-after-encountering-the-werewolves";
    }
    if (stage >= STAGE_VELIAF_HAS_MESSAGE) {
      return "misthalin-diplomacy-talking-to-veliaf-hurtz-after-handing-in-the-message";
    }
    if (stage >= STAGE_MESSAGE_FROM_VERTIDA) {
      return held(player, VERTIDA_MESSAGE_ITEM_ID)
        ? "sanguinesti-diplomacy-talking-to-veliaf-hurtz-with-the-message-from-vertida-sefalatis"
        : "sanguinesti-diplomacy-talking-to-veliaf-hurtz-without-the-message-from-vertida-sefalatis";
    }
    if (stage >= STAGE_IN_MEIYERDITCH) {
      return "contact-with-the-sanguinesti-region-talking-to-veliaf-after-meeting-a-vyrewatch";
    }
    if (stage >= STAGE_STARTED) {
      return "starting-the-quest-talking-to-veliaf-after-starting-the-quest";
    }
    return "starting-the-quest-talking-to-veliaf-hurtz";
  }

  function talkVeliaf(event) {
    const { player, npcId } = event;
    if (!VELIAF_NPC_IDS.has(npcId)) return false;
    if (tasteNeedsVeliafRod(player)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_UNSTARTED) {
      // Leave the shared Veliaf to In Search of/In Aid of the Myreque until
      // their prerequisite is finished.
      if (!inAidComplete(player)) return false;
      if (!meetsRequirements(player)) {
        event.handled = true;
        requirementsMessage(player);
        return true;
      }
      event.handled = true;
      play(player, npcId, "starting-the-quest-talking-to-veliaf-hurtz");
      return true;
    }
    event.handled = true;
    const variant = veliafVariant(stage, player);
    if (stage >= STAGE_KING_ROALD_TELEPORT && stage < STAGE_RETURNED) {
      // Roald's answer has been delivered: Veliaf sends the player back to Meiyerditch.
      advance(player, STAGE_RETURNED);
    }
    play(player, npcId, variant);
    return true;
  }

  function talkVertida(event) {
    const { player, npcId } = event;
    if (!VERTIDA_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_HIDEOUT || stage >= STAGE_COMPLETE) return false;
    event.handled = true;
    let variant;
    if (stage < STAGE_MESSAGE_FROM_VERTIDA) {
      variant = "sanguinesti-diplomacy-talking-to-vertida-sefalatis";
    } else if (stage < STAGE_VELIAF_HAS_MESSAGE) {
      variant = held(player, VERTIDA_MESSAGE_ITEM_ID)
        ? "sanguinesti-diplomacy-talking-to-vertida-sefalatis-again"
        : "sanguinesti-diplomacy-talking-to-vertida-again-after-losing-the-message";
    } else if (stage < STAGE_RETURNED) {
      // 140-179 is the post-King-Roald window; the canonical page points at Safalaan.
      variant =
        stage >= STAGE_KING_ROALD
          ? "misthalin-diplomacy-talking-to-vertida-sefalatis-after-talking-to-king-roald"
          : "sanguinesti-diplomacy-talking-to-vertida-sefalatis-again";
    } else if (stage < STAGE_SKETCH_NORTH) {
      // Back in the hideout: the canonical briefing; "Okay, lead the way." reaches Safalaan.
      variant =
        "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-being-sent-to-inform-the-sanguinesti-myreque";
    } else if (stage < STAGE_SKETCHES_GIVEN) {
      variant = "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-again-after-being-sent-to-meet-safalaan";
    } else {
      variant = "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-talking-to-safalaan-hallow";
    }
    play(player, npcId, variant);
    return true;
  }

  function safalaanVariant(stage, player) {
    if (stage >= STAGE_SEALED_MESSAGE) {
      return held(player, SEALED_MESSAGE_ITEM_ID)
        ? "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-receiving-the-sealed-message"
        : "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-losing-the-sealed-message";
    }
    if (stage >= STAGE_LAB_OPEN) {
      if (held(player, HAEMALCHEMY_ITEM_ID)) {
        return "in-search-of-statuesque-evil-talking-to-safalaan-hallow-with-the-haemalchemy-book";
      }
      return "in-search-of-statuesque-evil-talking-to-safalaan-hallow-after-finding-the-laboratory";
    }
    if (stage >= STAGE_SKETCHES_GIVEN) {
      if (held(player, FIREPLACE_MESSAGE_ITEM_ID) && !hasBit(player, BIT_SAFALAAN_MESSAGE_SHOWN)) {
        return "in-search-of-statuesque-evil-talking-to-safalaan-hallow-with-the-message";
      }
      return "in-search-of-statuesque-evil-talking-to-safalaan-hallow-again-after-showing-him-the-message";
    }
    if (hasAllSketches(player)) {
      return "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-with-all-three-sketches";
    }
    if (stage >= STAGE_SKETCH_WEST) {
      return "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-after-completing-at-least-one-sketch";
    }
    if (stage >= STAGE_SKETCH_NORTH) {
      return hasBit(player, BIT_SAFALAAN_SUPPLIES)
        ? "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-again"
        : "close-encounters-with-vyre-kind-talking-to-safalaan-hallow";
    }
    return "close-encounters-with-vyre-kind-talking-to-safalaan-hallow";
  }

  function talkSafalaan(event) {
    const { player, npcId } = event;
    if (!SAFALAAN_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_SAFALAAN || stage >= STAGE_COMPLETE) return false;
    event.handled = true;
    play(player, npcId, safalaanVariant(stage, player));
    return true;
  }

  function talkRal(event) {
    const { player, npcId } = event;
    if (!OLD_MAN_RAL_NPC_IDS.has(npcId)) return false;
    // 3772 carries no name in this cache revision, so this is registered by id
    // (not the "Old Man Ral" name hook) and claims only his Talk-to.
    if (event.definition?.getActions?.()?.[event.clickType - 1] !== "Talk-to") return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_MEIYERDITCH || stage >= STAGE_COMPLETE) return false;
    if (stage >= STAGE_ROUTE_KNOWN && stage < STAGE_SKETCH_NORTH) {
      // The transcript has no post-route Ral conversation before the sketches;
      // leave him to the generic Old Man Ral page.
      return false;
    }
    event.handled = true;
    const variant =
      stage >= STAGE_SKETCH_NORTH
        ? "close-encounters-with-vyre-kind-talking-to-old-man-ral-after-talking-to-safalaan-hallow"
        : "contact-with-the-sanguinesti-region-talking-to-old-man-ral";
    play(player, npcId, variant);
    return true;
  }

  function talkDrezel(event) {
    const { player, npcId } = event;
    if (npcId !== DREZEL_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_VELIAF_HAS_MESSAGE || stage >= STAGE_RETURNED) return false;
    event.handled = true;
    let variant;
    if (stage < STAGE_DREZEL_BRIEFED) {
      variant = "misthalin-diplomacy-talking-to-drezel";
    } else if (stage < STAGE_WEREWOLVES) {
      variant = "misthalin-diplomacy-talking-to-drezel-again";
    } else if (stage < STAGE_DREZEL_RUNES) {
      variant = "misthalin-diplomacy-talking-to-drezel-after-encountering-the-werewolves";
    } else {
      variant = "misthalin-diplomacy-talking-to-drezel-after-talking-to-king-roald";
    }
    play(player, npcId, variant);
    return true;
  }

  function talkKingRoald(event) {
    const { player, npcId } = event;
    if (!KING_ROALD_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DREZEL_RUNES || stage >= STAGE_VELIAF_SENT) return false;
    event.handled = true;
    let variant;
    if (stage < STAGE_KING_ROALD) {
      variant = "misthalin-diplomacy-talking-to-king-roald";
    } else if (stage < STAGE_KING_ROALD_TELEPORT) {
      variant = "misthalin-diplomacy-talking-to-king-roald-after-encountering-the-werewolves";
    } else {
      variant = "misthalin-diplomacy-talking-to-king-roald-again";
    }
    play(player, npcId, variant);
    return true;
  }

  function talkHiylikMyna(event) {
    const { player, npcId } = event;
    if (npcId !== HIYLIK_MYNA_NPC_ID) return false;
    if (!questActive(player)) return false;
    event.handled = true;
    play(player, npcId, "misthalin-diplomacy-talking-to-hiylik-myna");
    return true;
  }

  function talkSarius(event) {
    const { player, npcId } = event;
    if (npcId !== SARIUS_SPAWN_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_SARIUS || stage >= STAGE_SKETCHES_DONE) return false;
    event.handled = true;
    setBit(player, BIT_SARIUS_TALKED);
    play(
      player,
      npcId,
      "close-encounters-with-vyre-kind-sketching-the-south-side",
      fromSariusWake
    );
    if (hasAllSketches(player)) advance(player, STAGE_SKETCHES_DONE);
    return true;
  }

  function talkCitizen(event) {
    const { player } = event;
    if (event.definition?.getName?.() !== "Meiyerditch citizen") return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_MEIYERDITCH || stage >= STAGE_COMPLETE) return false;
    event.handled = true;
    const phase = field(player, CITIZEN_PHASE_SHIFT);
    let variant = "contact-with-the-sanguinesti-region-talking-to-a-meiyerditch-citizen";
    if (stage < STAGE_RAL_KNOWN) {
      if (phase >= 2) {
        variant = "contact-with-the-sanguinesti-region-talking-to-a-meiyerditch-citizen-after-insisting-to-meet-the-myreque";
      } else if (phase === 1) {
        variant = "contact-with-the-sanguinesti-region-talking-to-a-meiyerditch-citizen-after-quietly-asking-about-the-myreque";
      }
    }
    play(player, event.npcId, variant);
    return true;
  }

  function talkChild(event) {
    const { player } = event;
    if (event.definition?.getName?.() !== "Child") return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_MEIYERDITCH || stage >= STAGE_COMPLETE || !inMeiyerditch(player)) {
      return false;
    }
    event.handled = true;
    play(player, event.npcId, "contact-with-the-sanguinesti-region-talking-to-a-child");
    return true;
  }

  function talkVyrewatch(event) {
    const { player } = event;
    if (event.definition?.getName?.() !== "Vyrewatch") return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_MEIYERDITCH || stage >= STAGE_COMPLETE || !inMeiyerditch(player)) {
      return false;
    }
    event.handled = true;
    const encounter = field(player, ENCOUNTER_SHIFT);
    let variant;
    if (stage < STAGE_RAL_KNOWN && encounter === 0) {
      variant = "contact-with-the-sanguinesti-region-being-noticed-by-a-vyrewatch";
    } else if (encounter === 1) {
      variant = "contact-with-the-sanguinesti-region-talking-to-a-vyrewatch-immediately-after-paying-a-blood-tithe-to-them";
    } else if (encounter === 2) {
      variant = "contact-with-the-sanguinesti-region-talking-to-a-vyrewatch-that-was-challenged-in-combat";
    } else {
      variant = "contact-with-the-sanguinesti-region-talking-to-a-vyrewatch";
    }
    play(player, event.npcId, variant);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Dialogue: prose conditions
  // ---------------------------------------------------------------------------

  /** Answers the inventory/state conditions the wiki prose guards. */
  function answerCondition({ player, npcId, stepId }) {
    if (stepId === CONDITION_CONTINUING_FROM_IN_AID || stepId === CONDITION_COMING_BACK_TO_VELIAF) {
      if (!player || !VELIAF_NPC_IDS.has(npcId)) return null;
      return stepId === CONDITION_CONTINUING_FROM_IN_AID && inAidComplete(player);
    }
    if (CONDITION_REQUIRED_ITEMS.has(stepId)) {
      if (npcId !== PROP_ID) return null;
      return hasRepairTools(player);
    }
    if (CONDITION_MISSING_ITEMS.has(stepId)) {
      if (npcId !== PROP_ID) return null;
      return !hasRepairTools(player);
    }
    if (stepId === CONDITION_DISTRACTION_SUCCESS) {
      if (!VYREWATCH_NPC_IDS.has(npcId)) return null;
      return player.getSkillManager().getMaxLevel(Skill.THIEVING) >= 40;
    }
    if (stepId === CONDITION_DISTRACTION_FAIL) {
      if (!VYREWATCH_NPC_IDS.has(npcId)) return null;
      return player.getSkillManager().getMaxLevel(Skill.THIEVING) < 40;
    }
    if (stepId === CONDITION_TOME_LOST) {
      if (!VELIAF_NPC_IDS.has(npcId)) return null;
      return !TOME_ITEM_IDS.some((itemId) => held(player, itemId));
    }
    if (stepId === CONDITION_RAL_PAPYRUS_SHORT) {
      if (!OLD_MAN_RAL_NPC_IDS.has(npcId)) return null;
      const heldPapyrus = player.getInventory().getAmount(PAPYRUS_ITEM_ID);
      return heldPapyrus + sketchCount(player) < 3;
    }
    return null;
  }

  function handleChosenCondition(event) {
    const { player, stepId, npcId } = event;
    if (stepId === "_usOY0") {
      if (npcId !== PROP_ID) return;
      player.getInventory().deleteNumber(PLANK_ITEM_ID, 1);
      consumeNails(player, 4);
      setBit(player, BIT_BOAT_FIXED);
      syncVisuals(player);
      advance(player, STAGE_BOAT_FIXED);
      return;
    }
    if (stepId === "RdMtCs") {
      if (npcId !== PROP_ID) return;
      player.getInventory().deleteNumber(PLANK_ITEM_ID, 1);
      consumeNails(player, 4);
      setBit(player, BIT_CHUTE_FIXED);
      syncVisuals(player);
      advance(player, STAGE_CHUTE_FIXED);
      return;
    }
    if (stepId === CONDITION_DISTRACTION_SUCCESS) {
      if (!VYREWATCH_NPC_IDS.has(npcId)) return;
      setField(player, ENCOUNTER_SHIFT, 3);
      advance(player, STAGE_VYREWATCH_MET);
    }
  }

  // ---------------------------------------------------------------------------
  // Dialogue: stage directions (actions and message steps)
  //
  // Message steps (kind "message") must keep handled false so the runtime still
  // prints them; type-action steps are handled and get their text as messages
  // only where the direction is player-facing.
  // ---------------------------------------------------------------------------

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (ACTION_RECEIVE_VERTIDA_MESSAGE.has(stepId)) {
      event.handled = true;
      if (!held(player, VERTIDA_MESSAGE_ITEM_ID)) {
        if (!give(player, VERTIDA_MESSAGE_ITEM_ID, 1) || !held(player, VERTIDA_MESSAGE_ITEM_ID)) return;
      }
      advance(player, STAGE_MESSAGE_FROM_VERTIDA);
      return;
    }
    switch (stepId) {
      // -- boat repairs ------------------------------------------------------
      case ACTION_KICK_FLOORBOARDS:
        event.handled = true;
        if (!hasBit(player, BIT_FLOORBOARDS)) {
          setBit(player, BIT_FLOORBOARDS);
          syncVisuals(player);
          advance(player, STAGE_FLOORBOARDS);
        }
        return;
      case ACTION_PUSH_BOAT:
        event.handled = true;
        if (!hasBit(player, BIT_BOAT_PUSHED)) {
          setBit(player, BIT_BOAT_PUSHED);
          syncVisuals(player);
          advance(player, STAGE_BOAT_PUSHED);
        }
        return;
      case ACTION_BOARD_BOAT:
        event.handled = true;
        // The Burgh boat is the return route once Veliaf sends you back in.
        teleport(player, MEIYERDITCH_ARRIVAL);
        advance(player, STAGE_IN_MEIYERDITCH);
        return;
      // -- vyrewatch ---------------------------------------------------------
      case ACTION_PAY_TITHE:
        event.handled = true;
        setField(player, ENCOUNTER_SHIFT, 1);
        damage(player, 6);
        advance(player, STAGE_VYREWATCH_MET);
        return;
      case ACTION_FIGHT_VYREWATCH:
        event.handled = true;
        setField(player, ENCOUNTER_SHIFT, 2);
        damage(player, 6);
        advance(player, STAGE_VYREWATCH_MET);
        return;
      case ACTION_DODGE_VYREWATCH:
        setField(player, ENCOUNTER_SHIFT, 3);
        advance(player, STAGE_VYREWATCH_MET);
        return;
      // -- hideout -----------------------------------------------------------
      case ACTION_PUSH_HIDEOUT_WALL:
        return;
      // The three "you use your knife/sickle" messages unhook the latch.
      case "_CuGrg":
      case "fSvLLe":
      case "auHzRI":
        setBit(player, BIT_LATCH);
        advance(player, STAGE_HIDEOUT_OPEN);
        return;
      case ACTION_RECEIVE_DOOR_KEY:
        event.handled = true;
        if (!held(player, DOOR_KEY_ITEM_ID)) give(player, DOOR_KEY_ITEM_ID, 1);
        return;
      case ACTION_UNLOCK_SHORTCUT_DOOR:
        if (!hasBit(player, BIT_DOOR_UNLOCKED)) {
          player.getInventory().deleteNumber(DOOR_KEY_ITEM_ID, 1);
          setBit(player, BIT_DOOR_UNLOCKED);
          syncVisuals(player);
        }
        return;
      case ACTION_RECEIVE_LADDER_TOP:
        event.handled = true;
        if (!held(player, LADDER_TOP_ITEM_ID) && !give(player, LADDER_TOP_ITEM_ID, 1)) return;
        setBit(player, BIT_LADDER_TOP);
        syncVisuals(player);
        return;
      case ACTION_FIX_LADDER:
        player.getInventory().deleteNumber(LADDER_TOP_ITEM_ID, 1);
        setBit(player, BIT_LADDER_FIXED);
        syncVisuals(player);
        return;
      case ACTION_OPEN_TRAPDOOR:
        return;
      // -- Misthalin ---------------------------------------------------------
      case ACTION_SEARCH_BUSH:
        advance(player, STAGE_WEREWOLVES);
        return;
      case ACTION_WEREWOLF_KNOCKOUT:
        event.handled = true;
        advance(player, STAGE_WEREWOLVES);
        return;
      case ACTION_WEREWOLF_WAKE:
        event.handled = true;
        advance(player, STAGE_WEREWOLVES);
        return;
      case ACTION_DREZEL_RUNES:
        event.handled = true;
        {
          if (quest.getStage(player) >= STAGE_DREZEL_RUNES) return;
          const runes = [
            [AIR_RUNE_ITEM_ID, 3],
            [FIRE_RUNE_ITEM_ID, 1],
            [LAW_RUNE_ITEM_ID, 1],
          ];
          const inventory = player.getInventory();
          const neededSlots = runes.filter(([itemId]) => inventory.getAmount(itemId) === 0).length;
          if (freeSlots(player) < neededSlots) {
            player.sendMessage("You don't have enough inventory space.");
            return;
          }
          for (const [itemId, amount] of runes) inventory.adds(itemId, amount);
          advance(player, STAGE_DREZEL_RUNES);
        }
        return;
      case ACTION_ROALD_TELEPORT:
        teleport(player, DREZEL_TEMPLE_TILE);
        advance(player, STAGE_KING_ROALD_TELEPORT);
        return;
      case ACTION_ROALD_CAST:
        event.handled = true;
        return;
      case ACTION_ROALD_ARRIVE:
        event.handled = true;
        teleport(player, DREZEL_TEMPLE_TILE);
        advance(player, STAGE_KING_ROALD_TELEPORT);
        return;
      // -- Vertida -----------------------------------------------------------
      case ACTION_HAND_MESSAGE_VELIAF:
        player.getInventory().deleteNumber(VERTIDA_MESSAGE_ITEM_ID, 1);
        advance(player, STAGE_VELIAF_HAS_MESSAGE);
        return;
      case ACTION_VERTIDA_LEADS:
        event.handled = true;
        teleport(player, TRADER_SVEN_HOUSE);
        advance(player, STAGE_SAFALAAN);
        return;
      // -- Castle Drakan -----------------------------------------------------
      case ACTION_ROCKS_MOVE:
        setBit(player, BIT_ROCKS);
        return;
      case ACTION_SAFALAAN_CHARCOAL:
        event.handled = true;
        if (!hasBit(player, BIT_SAFALAAN_SUPPLIES)) {
          if (!give(player, CHARCOAL_ITEM_ID, 1)) return;
          setBit(player, BIT_SAFALAAN_SUPPLIES);
          advance(player, STAGE_SKETCH_NORTH);
        }
        return;
      case ACTION_SAFALAAN_PAPYRUS:
        event.handled = true;
        if (hasBit(player, BIT_SAFALAAN_SUPPLIES)) give(player, PAPYRUS_ITEM_ID, 3);
        return;
      case ACTION_RECEIVE_SKETCH_1:
        event.handled = true;
        if (!held(player, SKETCH_1_ITEM_ID) && !give(player, SKETCH_1_ITEM_ID, 1)) return;
        advance(player, STAGE_SKETCH_WEST);
        return;
      case ACTION_RECEIVE_SKETCH_2:
        event.handled = true;
        if (!held(player, SKETCH_2_ITEM_ID) && !give(player, SKETCH_2_ITEM_ID, 1)) return;
        advance(player, STAGE_SKETCH_SOUTH);
        return;
      case ACTION_SKETCH_SOUTH_START:
        advance(player, STAGE_SKETCH_SOUTH);
        return;
      case ACTION_SARIUS_SCENE_END:
        event.handled = true;
        advance(player, STAGE_SARIUS);
        applyStageSpawns(player);
        return;
      case ACTION_RECEIVE_SKETCH_3:
        event.handled = true;
        if (!held(player, SKETCH_3_ITEM_ID) && !give(player, SKETCH_3_ITEM_ID, 1)) return;
        if (hasBit(player, BIT_SARIUS_TALKED) || quest.getStage(player) >= STAGE_SKETCHES_DONE) {
          advance(player, STAGE_SKETCHES_DONE);
        }
        return;
      case ACTION_SKETCH_NORTH_LOSE:
      case ACTION_SKETCH_WEST_LOSE:
      case ACTION_SKETCH_SOUTH_LOSE:
        event.handled = true;
        if (held(player, PAPYRUS_ITEM_ID)) player.getInventory().deleteNumber(PAPYRUS_ITEM_ID, 1);
        return;
      case ACTION_GIVE_SKETCHES:
        event.handled = true;
        if (!hasAllSketches(player)) return;
        player.getInventory().deleteNumber(SKETCH_1_ITEM_ID, 1);
        player.getInventory().deleteNumber(SKETCH_2_ITEM_ID, 1);
        player.getInventory().deleteNumber(SKETCH_3_ITEM_ID, 1);
        advance(player, STAGE_SKETCHES_GIVEN);
        return;
      // -- laboratory --------------------------------------------------------
      case ACTION_FIREPLACE_KNIFE:
        if (!held(player, FIREPLACE_MESSAGE_ITEM_ID)) give(player, FIREPLACE_MESSAGE_ITEM_ID, 1);
        return;
      case ACTION_FIREPLACE_MESSAGE:
        event.handled = true;
        if (!held(player, FIREPLACE_MESSAGE_ITEM_ID)) give(player, FIREPLACE_MESSAGE_ITEM_ID, 1);
        return;
      case ACTION_PORTRAIT_KNIFE:
        if (field(player, PORTRAIT_SHIFT) === 0) setField(player, PORTRAIT_SHIFT, 1);
        return;
      case ACTION_PORTRAIT_KEY:
        event.handled = true;
        if (!held(player, ORNATE_KEY_ITEM_ID) && !give(player, ORNATE_KEY_ITEM_ID, 1)) return;
        setField(player, PORTRAIT_SHIFT, 2);
        syncVisuals(player);
        return;
      case ACTION_PORTRAIT_TAKE_KEY:
        if (!held(player, ORNATE_KEY_ITEM_ID) && !give(player, ORNATE_KEY_ITEM_ID, 1)) return;
        setField(player, PORTRAIT_SHIFT, 2);
        syncVisuals(player);
        return;
      case ACTION_TAPESTRY_SLASH:
        setBit(player, BIT_TAPESTRY);
        syncVisuals(player);
        maybeOpenLab(player);
        return;
      case ACTION_STATUE_PLACE_KEY:
        player.getInventory().deleteNumber(ORNATE_KEY_ITEM_ID, 1);
        setBit(player, BIT_STATUE);
        syncVisuals(player);
        maybeOpenLab(player);
        return;
      case ACTION_STATUE_LOSE_KEY:
        event.handled = true;
        player.getInventory().deleteNumber(ORNATE_KEY_ITEM_ID, 1);
        return;
      case ACTION_DOOR_SHOCK:
        return;
      case ACTION_DOOR_SHOCK_DAMAGE:
        event.handled = true;
        damage(player, 10);
        return;
      case ACTION_GIVE_HAEMALCHEMY:
        event.handled = true;
        player.getInventory().deleteNumber(HAEMALCHEMY_ITEM_ID, 1);
        return;
      case ACTION_RECEIVE_SEALED_MESSAGE:
        event.handled = true;
        if (!held(player, SEALED_MESSAGE_ITEM_ID)) give(player, SEALED_MESSAGE_ITEM_ID, 1);
        advance(player, STAGE_SEALED_MESSAGE);
        return;
      case ACTION_SAFALAAN_NEW_SEALED:
        if (!held(player, SEALED_MESSAGE_ITEM_ID)) give(player, SEALED_MESSAGE_ITEM_ID, 1);
        advance(player, STAGE_SEALED_MESSAGE);
        return;
      case ACTION_RUNECASE_RUNES:
        event.handled = true;
        if (!hasBit(player, BIT_RUNECASE)) {
          const runeStacks = [
            [LAW_RUNE_ITEM_ID, 1],
            [FIRE_RUNE_ITEM_ID, 3],
            [AIR_RUNE_ITEM_ID, 3],
            [WATER_RUNE_ITEM_ID, 1],
            [MIND_RUNE_ITEM_ID, 1],
          ];
          const missingStacks = runeStacks.filter(([itemId]) => !held(player, itemId)).length;
          if (freeSlots(player) < missingStacks) {
            player.sendMessage("You don't have enough inventory space.");
            return;
          }
          setBit(player, BIT_RUNECASE);
          syncVisuals(player);
          // The free-slot count above is exact; add directly so existing rune
          // stacks receive the runes even with no empty slots.
          for (const [itemId, amount] of runeStacks) player.getInventory().adds(itemId, amount);
        }
        return;
      case ACTION_SAFALAAN_SHOW_MESSAGE:
        setBit(player, BIT_SAFALAAN_MESSAGE_SHOWN);
        return;
      // -- rewards -----------------------------------------------------------
      case ACTION_RAL_PAPYRUS:
        event.handled = true;
        {
          const missing = Math.max(
            0,
            3 - sketchCount(player) - player.getInventory().getAmount(PAPYRUS_ITEM_ID)
          );
          give(player, PAPYRUS_ITEM_ID, missing);
        }
        return;
      case ACTION_TOME_GIVEN:
        event.handled = true;
        if (!TOME_ITEM_IDS.some((itemId) => held(player, itemId))) give(player, TOME_ITEM_ID, 1);
        return;
      case ACTION_COMPLETE:
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) {
          player.getInventory().deleteNumber(SEALED_MESSAGE_ITEM_ID, 1);
          quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Dialogue: options
  // ---------------------------------------------------------------------------

  function handleDialogueChoice({ player, option, npcId }) {
    if (!player || !option) return;
    if (option === CHOICE_CITIZEN_WHISPER) {
      if (field(player, CITIZEN_PHASE_SHIFT) < 1) setField(player, CITIZEN_PHASE_SHIFT, 1);
      return;
    }
    if (option === CHOICE_CITIZEN_INSIST) {
      if (field(player, CITIZEN_PHASE_SHIFT) < 2) setField(player, CITIZEN_PHASE_SHIFT, 2);
      return;
    }
    if (option === CHOICE_CITIZEN_RAL || option === CHOICE_CITIZEN_RAL_HELP) {
      if (field(player, CITIZEN_PHASE_SHIFT) < 3) setField(player, CITIZEN_PHASE_SHIFT, 3);
      advance(player, STAGE_RAL_KNOWN);
      return;
    }
    if (option === CHOICE_RAL_SAGE) {
      if (!OLD_MAN_RAL_NPC_IDS.has(npcId)) return;
      advance(player, STAGE_ROUTE_KNOWN);
      return;
    }
    if (option === CHOICE_DREZEL_DONE) {
      if (npcId !== DREZEL_NPC_ID) return;
      if (quest.getStage(player) < STAGE_DREZEL_BRIEFED) advance(player, STAGE_DREZEL_BRIEFED);
      return;
    }
    if (option === CHOICE_ROALD_MORYTANIA) {
      if (!KING_ROALD_NPC_IDS.has(npcId)) return;
      if (quest.getStage(player) < STAGE_KING_ROALD) advance(player, STAGE_KING_ROALD);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // NPC / object / item hooks
  // ---------------------------------------------------------------------------

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !VELIAF_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_UNSTARTED) return;
    if (!meetsRequirements(player)) {
      requirementsMessage(player);
      return;
    }
    advance(player, STAGE_STARTED);
  }

  function handleLogin({ player }) {
    applyStageSpawns(player);
    syncVisuals(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    despawnAll(player);
  }

  function handleObjectInteraction(event) {
    const { player, objectId, definition } = event;
    if (!player) return;
    const definitionId = definition?.id ?? objectId;
    if (objectId === BURGH_BOAT_MULTI_ID || objectId === BURGH_BOAT_WATER_MULTI_ID) {
      event.handled = true;
      if (objectId === BURGH_BOAT_WATER_MULTI_ID) {
        if (quest.getStage(player) >= STAGE_BOAT_PUSHED && questActive(player)) {
          play(player, PROP_ID, "contact-with-the-sanguinesti-region-boarding-the-boat");
        }
        return true;
      }
      const stage = quest.getStage(player);
      if (definitionId === BOAT_BROKEN_OBJECT_ID) {
        if (stage < STAGE_STARTED) {
          play(player, PROP_ID, "boat-repairs-inspecting-the-boat-before-starting-the-quest");
        } else {
          play(player, PROP_ID, "boat-repairs-inspecting-the-boat-after-starting-the-quest");
        }
        return true;
      }
      if (definitionId === BOAT_FIXED_OBJECT_ID) {
        if (!hasBit(player, BIT_CHUTE_FIXED)) {
          play(player, PROP_ID, "boat-repairs-pushing-the-fixed-boat-before-fixing-the-chute");
        } else {
          play(player, PROP_ID, "boat-repairs-pushing-the-boat-after-fixing-the-chute");
        }
        return true;
      }
      return true;
    }
    if (objectId === BURGH_CHUTE_MULTI_ID) {
      event.handled = true;
      if (!hasBit(player, BIT_BOAT_FIXED)) {
        play(player, PROP_ID, "boat-repairs-inspecting-the-boat-chute");
      } else if (!hasBit(player, BIT_CHUTE_FIXED)) {
        play(player, PROP_ID, "boat-repairs-inspecting-the-boat-chute-after-fixing-the-boat");
      }
      return true;
    }
    if (objectId === MEIYERDITCH_ARRIVAL_BOAT_ID) {
      event.handled = true;
      if (questActive(player)) teleport(player, BURGH_DOCKS);
      return true;
    }
    if (objectId === WALL_FLOORBOARDS_MULTI_ID) {
      event.handled = true;
      if (!hasBit(player, BIT_FLOORBOARDS)) {
        play(player, PROP_ID, "contact-with-the-sanguinesti-region-entering-the-wall");
      } else {
        teleport(player, MEIYERDITCH_INSIDE);
      }
      return true;
    }
    if (objectId === WEREWOLF_BUSH_OBJECT_ID || objectId === WEREWOLF_BUSH_SEARCH_ID) {
      if (quest.getStage(player) < STAGE_DREZEL_BRIEFED || quest.getStage(player) >= STAGE_DREZEL_RUNES) {
        return false;
      }
      event.handled = true;
      play(player, PROP_ID, "misthalin-diplomacy-searching-the-bush-outside-paterdomus-temple");
      return true;
    }
    if (objectId === ROCKY_SURFACE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_RETURNED) return false;
      event.handled = true;
      play(
        player,
        PROP_ID,
        "close-encounters-with-vyre-kind-starting-the-route-to-the-walls-of-castle-drakan-searching-the-rocky-surface-with-vertida-s-advise"
      );
      return true;
    }
    if (objectId === BARRICADE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_RETURNED || !hasBit(player, BIT_ROCKS)) return false;
      event.handled = true;
      teleport(player, DRAKAN_WALLS);
      return true;
    }
    if (
      objectId === DRAKAN_WALL_SHORTCUT_UP_OBJECT_ID ||
      objectId === DRAKAN_WALL_SHORTCUT_DOWN_OBJECT_ID
    ) {
      if (quest.getStage(player) < STAGE_RETURNED || quest.getStage(player) >= STAGE_COMPLETE) {
        return false;
      }
      event.handled = true;
      teleport(
        player,
        objectId === DRAKAN_WALL_SHORTCUT_UP_OBJECT_ID ? DRAKAN_WALLS_TOP : DRAKAN_WALLS
      );
      return true;
    }
    if (objectId === POTS_OBJECT_ID) {
      if (!questActive(player)) return false;
      event.handled = true;
      play(
        player,
        PROP_ID,
        "keys-to-the-myreque-opening-the-locked-door-in-the-house-north-of-old-man-ral-searching-the-pots"
      );
      return true;
    }
    if (objectId === SHORTCUT_DOOR_OBJECT_ID) {
      if (!questActive(player)) return false;
      event.handled = true;
      if (hasBit(player, BIT_DOOR_UNLOCKED)) {
        stepThroughDoor(player, event.location);
      } else if (held(player, DOOR_KEY_ITEM_ID)) {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-opening-the-locked-door-in-the-house-north-of-old-man-ral-unlocking-the-door"
        );
      } else {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-attempting-to-open-the-door-with-a-shortcut-key-symbol-on-it"
        );
      }
      return true;
    }
    if (objectId === HIDEOUT_WALL_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_ROUTE_KNOWN) return false;
      event.handled = true;
      if (hasBit(player, BIT_LATCH)) {
        teleport(player, HIDEOUT_SURFACE);
      } else {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-attempting-to-push-the-wall-guarding-the-hideout"
        );
      }
      return true;
    }
    if (objectId === HIDEOUT_SYMBOL_MULTI_ID) {
      if (quest.getStage(player) < STAGE_HIDEOUT_OPEN) return false;
      event.handled = true;
      setField(player, TRAPDOOR_SHIFT, 1);
      syncVisuals(player);
      return true;
    }
    if (objectId === HIDEOUT_RUG_MULTI_ID) {
      event.handled = true;
      if (definitionId === HIDEOUT_RUG_OBJECT_ID) {
        setField(player, TRAPDOOR_SHIFT, 2);
        syncVisuals(player);
      } else if (field(player, TRAPDOOR_SHIFT) === 2) {
        teleport(player, HIDEOUT_LANDING);
        advance(player, STAGE_IN_HIDEOUT);
      }
      return true;
    }
    if (objectId === LADDER_TOP_WALL_MULTI_ID) {
      event.handled = true;
      if (definitionId === LADDER_TOP_WALL_OBJECT_ID && !hasBit(player, BIT_LADDER_TOP)) {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-repairing-the-ladder-in-the-house-north-west-of-ver-sinhaza-searching-the-wall-with-a-ladder-on-it-upstairs"
        );
      }
      return true;
    }
    if (objectId === FLOOR_LADDER_MULTI_ID) {
      event.handled = true;
      if (definitionId === FIXED_LADDER_OBJECT_ID) {
        teleport(player, { x: 3629, y: 3239, z: 0 });
      } else if (held(player, LADDER_TOP_ITEM_ID)) {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-repairing-the-ladder-in-the-house-north-west-of-ver-sinhaza-searching-the-broken-ladder-while-holding-a-ladder-top"
        );
      } else {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-repairing-the-ladder-in-the-house-north-west-of-ver-sinhaza-searching-the-broken-ladder"
        );
      }
      return true;
    }
    if (objectId === FIREPLACE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return false;
      event.handled = true;
      play(
        player,
        PROP_ID,
        held(player, FIREPLACE_MESSAGE_ITEM_ID)
          ? "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-looking-at-the-fireplace-while-having-the-message"
          : "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-looking-at-the-fireplace-across-from-the-portrait"
      );
      return true;
    }
    if (objectId === PORTRAIT_MULTI_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return false;
      event.handled = true;
      const state = field(player, PORTRAIT_SHIFT);
      if (state !== 0 && !held(player, ORNATE_KEY_ITEM_ID)) {
        play(
          player,
          PROP_ID,
          "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-inspecting-the-slashed-portrait-without-having-the-key"
        );
      } else if (state === 0) {
        play(
          player,
          PROP_ID,
          "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-inspecting-the-portrait"
        );
      } else {
        play(
          player,
          PROP_ID,
          "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-inspecting-the-slashed-portrait-while-having-the-key"
        );
      }
      return true;
    }
    if (objectId === TAPESTRY_MULTI_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return false;
      event.handled = true;
      if (definitionId === TAPESTRY_SLASHED_OBJECT_ID && hasBit(player, BIT_TAPESTRY)) {
        teleport(player, { x: 3638, y: 3302, z: 0 });
      }
      return true;
    }
    if (objectId === STATUE_MULTI_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return false;
      event.handled = true;
      play(
        player,
        PROP_ID,
        hasBit(player, BIT_STATUE)
          ? "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-inspecting-the-vampyre-statue-after-placing-the-key"
          : "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-inspecting-the-vampyre-statue"
      );
      return true;
    }
    if (objectId === LAB_DOOR_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return false;
      event.handled = true;
      if (hasBit(player, BIT_STATUE)) {
        teleport(player, { x: 3641, y: 3306, z: 0 });
      } else {
        play(
          player,
          PROP_ID,
          "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-attempting-to-open-the-inner-door"
        );
      }
      return true;
    }
    if (objectId === LAB_STAIRS_DOWN_ID) {
      if (!hasBit(player, BIT_STATUE)) return false;
      event.handled = true;
      teleport(player, LAB_LANDING);
      return true;
    }
    if (objectId === LAB_STAIRS_UP_ID) {
      if (!hasBit(player, BIT_STATUE)) return false;
      event.handled = true;
      teleport(player, LAB_SURFACE);
      return true;
    }
    if (objectId === RUNE_CASE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_LAB_OPEN) return false;
      event.handled = true;
      play(
        player,
        PROP_ID,
        hasBit(player, BIT_RUNECASE)
          ? "in-search-of-statuesque-evil-searching-the-broken-rune-case-again"
          : "in-search-of-statuesque-evil-searching-the-broken-rune-case"
      );
      return true;
    }
    if (objectId === HIDEOUT_LADDER_UP_ID) {
      if (quest.getStage(player) < STAGE_IN_HIDEOUT) return false;
      event.handled = true;
      teleport(player, HIDEOUT_SURFACE);
      return true;
    }
  }

  /** Mirrors the player through a door tile (the door itself has no server swap). */
  function stepThroughDoor(player, location) {
    if (!location) return;
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
        : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === BURGH_BOAT_MULTI_ID && itemId === PLANK_ITEM_ID) {
      if (quest.getStage(player) < STAGE_STARTED || hasBit(player, BIT_BOAT_FIXED)) return;
      event.handled = true;
      play(player, PROP_ID, "boat-repairs-inspecting-the-boat-after-starting-the-quest");
      return;
    }
    if (objectId === BURGH_CHUTE_MULTI_ID && itemId === PLANK_ITEM_ID) {
      if (!hasBit(player, BIT_BOAT_FIXED) || hasBit(player, BIT_CHUTE_FIXED)) return;
      event.handled = true;
      play(player, PROP_ID, "boat-repairs-inspecting-the-boat-chute-after-fixing-the-boat");
      return;
    }
    const isKnife = itemId === KNIFE_ITEM_ID;
    const isSickle = itemId === SILVER_SICKLE_ITEM_ID || itemId === SILVER_SICKLE_BLESSED_ITEM_ID;

    if (objectId === HIDEOUT_WALL_OBJECT_ID && (isKnife || isSickle)) {
      if (quest.getStage(player) < STAGE_ROUTE_KNOWN) return;
      event.handled = true;
      const variant = isKnife
        ? "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-using-a-knife-on-the-wall"
        : itemId === SILVER_SICKLE_BLESSED_ITEM_ID
          ? "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-using-a-silver-sickle-b-on-the-wall"
          : "keys-to-the-myreque-gaining-access-to-the-sanguinesti-myreque-hideout-using-a-silver-sickle-on-the-wall";
      play(player, PROP_ID, variant);
      return;
    }
    if (objectId === SHORTCUT_DOOR_OBJECT_ID && itemId === DOOR_KEY_ITEM_ID) {
      if (!questActive(player) || hasBit(player, BIT_DOOR_UNLOCKED)) return;
      event.handled = true;
      play(
        player,
        PROP_ID,
        "keys-to-the-myreque-opening-the-locked-door-in-the-house-north-of-old-man-ral-unlocking-the-door"
      );
      return;
    }
    if (objectId === FIREPLACE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return;
      if (isKnife) {
        event.handled = true;
        play(
          player,
          PROP_ID,
          held(player, FIREPLACE_MESSAGE_ITEM_ID)
            ? "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-knife-on-the-fireplace-while-having-the-message"
            : "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-knife-on-the-fireplace"
        );
      } else if (isSickle) {
        event.handled = true;
        play(
          player,
          PROP_ID,
          held(player, FIREPLACE_MESSAGE_ITEM_ID)
            ? "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-silver-sickle-or-silver-sickle-b-on-the-fireplace-while-having-the-message"
            : "in-search-of-statuesque-evil-obtaining-the-message-left-by-sarius-guile-using-a-silver-sickle-or-silver-sickle-b-on-the-fireplace"
        );
      }
      return;
    }
    if (objectId === PORTRAIT_MULTI_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return;
      if (isKnife) {
        event.handled = true;
        play(
          player,
          PROP_ID,
          field(player, PORTRAIT_SHIFT) === 0
            ? "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-using-a-knife-on-the-portrait"
            : "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-using-a-knife-or-sickle-on-the-portrait-after-slashing-it"
        );
      } else if (isSickle) {
        event.handled = true;
        play(
          player,
          PROP_ID,
          "in-search-of-statuesque-evil-obtaining-the-key-left-by-mauritys-guile-using-a-silver-sickle-or-silver-sickle-b-on-the-portrait"
        );
      }
      return;
    }
    if (objectId === TAPESTRY_MULTI_ID && (isKnife || isSickle)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_SKETCHES_GIVEN || !hasBit(player, BIT_SAFALAAN_MESSAGE_SHOWN)) {
        play(
          player,
          PROP_ID,
          "keys-to-the-myreque-attempting-to-slash-the-tapestry-guarding-the-entrance-to-the-laboratory"
        );
        return;
      }
      if (!hasBit(player, BIT_TAPESTRY)) {
        play(
          player,
          PROP_ID,
          "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-slashing-the-tapestry"
        );
      }
      return;
    }
    if (objectId === STATUE_MULTI_ID && itemId === ORNATE_KEY_ITEM_ID) {
      if (quest.getStage(player) < STAGE_SKETCHES_DONE) return;
      event.handled = true;
      play(
        player,
        PROP_ID,
        hasBit(player, BIT_STATUE)
          ? "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-inspecting-the-vampyre-statue-after-placing-the-key"
          : "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-using-the-large-ornate-key-on-the-vampyre-statue"
      );
      return;
    }
    if (objectId === LAB_DOOR_OBJECT_ID && itemId === ORNATE_KEY_ITEM_ID) {
      event.handled = true;
      play(
        player,
        PROP_ID,
        "in-search-of-statuesque-evil-gaining-access-to-the-meiyerditch-laboratories-using-the-large-ornate-key-on-the-inner-door"
      );
      return;
    }
  }

  /** Charcoal on papyrus at the three marked approach spots. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!(pair.has(CHARCOAL_ITEM_ID) && pair.has(PAPYRUS_ITEM_ID))) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_SKETCH_NORTH || stage >= STAGE_SKETCHES_GIVEN) return;
    event.handled = true;
    if (near(player, SKETCH_NORTH_SPOT)) {
      if (held(player, SKETCH_1_ITEM_ID)) {
        play(
          player,
          PROP_ID,
          "close-encounters-with-vyre-kind-attempting-to-sketch-the-north-side-again"
        );
      } else if (!hasBit(player, BIT_SAFALAAN_SUPPLIES)) {
        play(player, PROP_ID, "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-again");
      } else {
        play(player, PROP_ID, "close-encounters-with-vyre-kind-sketching-the-north-side");
      }
      return;
    }
    if (near(player, SKETCH_WEST_SPOT)) {
      if (held(player, SKETCH_2_ITEM_ID)) {
        play(
          player,
          PROP_ID,
          "close-encounters-with-vyre-kind-attempting-to-sketch-the-west-side-again"
        );
      } else if (!held(player, SKETCH_1_ITEM_ID)) {
        play(player, PROP_ID, "close-encounters-with-vyre-kind-attempting-to-sketch-the-west-side-first");
      } else {
        play(player, PROP_ID, "close-encounters-with-vyre-kind-sketching-the-west-side");
      }
      return;
    }
    if (near(player, SKETCH_SOUTH_SPOT)) {
      if (held(player, SKETCH_3_ITEM_ID)) {
        play(
          player,
          PROP_ID,
          "close-encounters-with-vyre-kind-attempting-to-sketch-the-south-side-again"
        );
      } else if (!held(player, SKETCH_2_ITEM_ID)) {
        play(player, PROP_ID, "close-encounters-with-vyre-kind-attempting-to-sketch-the-south-side-second");
      } else if (stage < STAGE_SKETCH_SOUTH) {
        play(
          player,
          PROP_ID,
          "close-encounters-with-vyre-kind-sketching-the-south-side",
          beforeSariusWake
        );
      } else {
        play(
          player,
          PROP_ID,
          "close-encounters-with-vyre-kind-sketching-the-south-side-after-being-saved-by-sarius-guile"
        );
      }
      return;
    }
    player.sendMessage("You should stand on one of the marked spots to sketch the castle.");
  }

  function findHaemalchemyBook(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_LAB_OPEN && stage < STAGE_BOOK_FOUND) {
      advance(player, STAGE_BOOK_FOUND);
    }
  }

  function handleItemDestroyed(event) {
    const { player, itemId } = event;
    if (!player || itemId !== LADDER_TOP_ITEM_ID || hasBit(player, BIT_LADDER_FIXED)) return;
    if (!hasBit(player, BIT_LADDER_TOP)) return;
    player.setAttribute(BITS_ATTRIBUTE, bits(player) & ~BIT_LADDER_TOP);
    syncVisuals(player);
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId !== HAEMALCHEMY_ITEM_ID || !player) return;
    findHaemalchemyBook(player);
  }

  /** Telekinetic Grab awards the book directly, before the pickup hook can fire. */
  function handleTelekineticGrab(event) {
    const { player, itemId } = event;
    if (itemId !== HAEMALCHEMY_ITEM_ID || !player) return;
    findHaemalchemyBook(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.persistAttribute(BITS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "darkness_of_hallowvale",
    name: "Darkness of Hallowvale",
    varpId: 869, // myreque_3_main_var
    varbitId: 2573, // myq3_main_quest (bits 0-8)
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    varbitValue(stage) {
      if (stage >= STAGE_COMPLETE) return STAGE_WIRE_COMPLETE;
      // Roald's teleport has happened: the client asks for Veliaf, not for Roald.
      if (stage === STAGE_KING_ROALD_TELEPORT) return STAGE_WIRE_RETURN_TO_VELIAF;
      // Veliaf has sent the player back to the Sanguinesti order.
      if (stage === STAGE_VELIAF_SENT) return STAGE_WIRE_BACK_TO_MEIYERDITCH;
      // The sealed message is in hand: the client asks for Veliaf to finish.
      if (stage === STAGE_SEALED_MESSAGE) return STAGE_WIRE_SEALED_MESSAGE;
      return stage | 0;
    },
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 7000, label: "Agility" },
      { skillId: Skill.THIEVING.getIndex(), amount: 6000, label: "Thieving" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 2000, label: "Construction" },
    ],
    rewardItemId: TOME_ITEM_ID,
    rewardItemLabel: "Tome of Experience",
    otherRewards: ["Access to the Meiyerditch shortcut doors", "Membership of the Myreque"],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleChosenCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Vertida Sefalatis", { "Talk-to": talkVertida });
  api.onNpcInteraction("Safalaan Hallow", { "Talk-to": talkSafalaan });
  api.onNpcInteraction(talkRal);
  api.onNpcInteraction("Drezel", { "Talk-to": talkDrezel });
  api.onNpcInteraction("King Roald", { "Talk-to": talkKingRoald });
  api.onNpcInteraction("Hiylik Myna", { "Talk-to": talkHiylikMyna });
  api.onNpcInteraction("Meiyerditch citizen", { "Talk-to": talkCitizen });
  api.onNpcInteraction("Child", { "Talk-to": talkChild });
  api.onNpcInteraction("Vyrewatch", { "Talk-to": talkVyrewatch });
  api.onNpcInteraction(talkSarius);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onCustomEvent("destroy-item:destroyed", handleItemDestroyed);
  api.onCustomEvent("magic:telekinetic-grab", handleTelekineticGrab);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
