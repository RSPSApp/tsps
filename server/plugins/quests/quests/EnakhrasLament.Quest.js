/**
 * Enakhra's Lament (members).
 *
 * The words come from the "Enakhra's Lament" transcript page; this plugin supplies
 * Lazim's variant selector, the wiki prose-condition answers, the sandstone
 * hand-ins, the statue/sigil/limb world wiring, the four element puzzles, the
 * boneguards and the wall.
 *
 * Stages (varbit 1560 "enakh_quest", varp 641 bits 0-6; evidence:
 * `lookup-gameval.ts varbit enakh_quest` -> "1560 enakh_quest varp=641 bits=0-6",
 * siblings enakh_camulet_charge 1574 / enakh_pedestal_multivar 1575):
 *   0 not started, 1 accepted, 2 base block received, 3 base made, 4 base placed,
 *   5 body block received, 6 body made, 7 body placed, 8 statue chiselled (head
 *   choice), 9 head made, 10 in the temple (fell through), 11 Lazim briefed
 *   (limbs/head available), 12 all four limbs taken, 13 four outer doors opened,
 *   14 inner sigil door opened (middle floor), 15 camel head in the pedestal,
 *   16 four globes lit (barrier passable), 17 first boneguard freed,
 *   18 second boneguard agreed to the wall, 19 wall finished, 20 complete.
 * Per-branch progress lives in persisted quest.* attributes (sandstone kg, head
 * choice/made, limb/door/globe/brazier bits, wall stones, camulet unlimited).
 *
 * World wiring:
 *   - The surface statue (10952), fallen statue (10970), wall (11026/11027) and
 *     secret entrances (11045-11048) are cache multilocs driven by per-player
 *     varbits. Other temple scenery the cache leaves absent is registered here.
 *   - Middle floor (plane 1): Pedestal 10988 (3104,9312), six Brazier 11017
 *     (3114-3118 x 9306/9309), the Furnace grate NPC 3574 (3116,9323), Crust of
 *     ice NPC 3573 (3092,9308) becoming Fountain 11007, Rubble 34663 (3108,9295),
 *     the wall multilocs (3100/3105,9291) and the four secret-entrance sand
 *     piles (10950).
 *   - NPCs: Lazim 3580 surface (3191,2926, shared) and temple (3131,9320),
 *     Boneguard 3570 (3104,9307,2) and 3577 (3105,9297,1), Enakhra 3575
 *     (3104,9286,1), Akthanakos 3578 (3105,9297,1) and the two puzzle NPCs;
 *     every temple NPC is owner-scoped, Pentyn 3568 already spawns.
 *
 * Source: https://oldschool.runescape.wiki/w/Enakhra%27s_Lament and
 * https://oldschool.runescape.wiki/w/Transcript:Enakhra%27s_Lament
 * Rewards per the OSRS Wiki: 2 Quest points, 7,000 Crafting/Mining/Firemaking/
 * Magic XP and the Camulet.
 *
 * Gaps / approximations:
 *   - The pedestal and doors are still shared objects; the statue, wall and
 *     entrances now follow each player's cache varbits. NPCs are owner-scoped,
 *     so freeing a boneguard or melting the ice no longer vanishes for others.
 *   - The transcript dump has no refusal lines for locked doors or an unsolved
 *     barrier; short system messages are used. It also marks the Lazim/Zamorak/
 *     Icthlarin granite-chisel results and the "after choosing a head" variant as
 *     missing, so those carvings are silent item swaps and the head menu repeats.
 *   - The cache door names pin each limb to its door (11066 right arm, 11068
 *     left leg, 11064 left arm, 11070 right leg); the transcript names the four
 *     cutscenes by compass direction. Lazim's lost-limb conditions only re-grant
 *     a limb when it is missing from the inventory.
 *   - The four secret entrances are unnamed cache multilocs (11045-11048) with
 *     boulder varbits (N/E/S/W, 1598-1601). The cache does not link tunnel ends;
 *     each pairing follows the room and surface coordinates and the ladder tile.
 *   - The temple Lazim stays in the starting room instead of following the
 *     player; the boneguard's five big bones drop is skipped; the magic barrier
 *     is gated only by its Pass-through handler, not by collision.
 */
module.exports = function registerEnakhrasLamentQuest(api) {
  const {
    GameObject,
    ItemIdentifiers,
    Location,
    CombatSpells,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    PrayerHandler,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Enakhra's Lament";

  const LAZIM_NPC_ID = NpcIdentifiers.LAZIM; // 3580
  const PENTYN_NPC_ID = NpcIdentifiers.PENTYN; // 3568
  const BONEGUARD_NPC_ID = NpcIdentifiers.BONEGUARD; // 3570 (top floor)
  const BONEGUARD2_NPC_ID = NpcIdentifiers.BONEGUARD_2; // 3577 (wall room)
  const ENAKHRA_NPC_ID = NpcIdentifiers.ENAKHRA; // 3575
  const AKTHANAKOS_NPC_ID = NpcIdentifiers.AKTHANAKOS; // 3578
  const CRUST_OF_ICE_NPC_ID = NpcIdentifiers.CRUST_OF_ICE; // 3573
  const FURNACE_GRATE_NPC_ID = NpcIdentifiers.FURNACE_GRATE; // 3574
  const CRUMBLE_UNDEAD_SPELL_ID = CombatSpells.CRUMBLE_UNDEAD.spellId();
  const pendingSpellTargets = new WeakMap();
  const WIND_BOLT_OR_HIGHER_SPELL_IDS = new Set([
    CombatSpells.WIND_BOLT.spellId(), CombatSpells.WIND_BLAST.spellId(),
    CombatSpells.WIND_WAVE.spellId(), CombatSpells.WIND_SURGE.spellId(),
  ]);
  const FIRE_BOLT_OR_HIGHER_SPELL_IDS = new Set([
    CombatSpells.FIRE_BOLT.spellId(), CombatSpells.FIRE_BLAST.spellId(),
    CombatSpells.FIRE_WAVE.spellId(), CombatSpells.FIRE_SURGE.spellId(),
  ]);
  const OWNED_NPC_IDS = new Set([
    LAZIM_NPC_ID,
    PENTYN_NPC_ID,
    BONEGUARD_NPC_ID,
    BONEGUARD2_NPC_ID,
    ENAKHRA_NPC_ID,
    AKTHANAKOS_NPC_ID,
    CRUST_OF_ICE_NPC_ID,
    FURNACE_GRATE_NPC_ID,
  ]);

  const VARP_ENAKH = 641;
  const VARBIT_ENAKH_QUEST = 1560; // "enakh_quest", varp 641 bits 0-6
  // Cache quest DB row 40 column 19: native QUEST_STATUS_GET (script 4029)
  // reports finished when varbit 1560 >= 70. Internal stages stay 0-20; the
  // wire values are the native milestones Quest Helper keys its loadSteps on
  // (0/10/20/30/40/50/60/70), not the raw internal stage numbers.
  const COMPLETE_VARBIT_VALUE = 70;
  const VARBIT_VALUE_STATUE = 10;
  const VARBIT_VALUE_GROUND_FLOOR = 20;
  const VARBIT_VALUE_PUZZLES = 30;
  const VARBIT_VALUE_TOP_FLOOR = 40;
  const VARBIT_VALUE_BONEGUARD2 = 50;
  const VARBIT_VALUE_WALL = 60;

  // Auxiliary native varbits the Quest Helper overlay reads.
  const VARBIT_STATUE_MULTIVAR = 1593;
  const VARBIT_STATUE_BODY_BLURB = 1562;
  const VARBIT_STATUE_HEAD_BLURB = 1563;
  const VARBIT_LAZIM_REALLYAMAGE = 1566;
  const VARBIT_BLOOD_ROOM = 1576;
  const VARBIT_ICE_ROOM = 1577;
  const VARBIT_SMOKE_ROOM = 1578;
  const VARBIT_SHADOW_ROOM = 1579;
  const VARBIT_BRAZIER_IDS = [1581, 1582, 1583, 1584, 1585, 1586]; // logs, oak, willow, maple, candle, coal
  const VARBIT_FALLEN_STATUE_MULTIVAR = 1587;
  const VARBIT_LEFT_ARM_TAKEN = 1589;
  const VARBIT_RIGHT_ARM_TAKEN = 1590;
  const VARBIT_LEFT_LEG_TAKEN = 1591;
  const VARBIT_RIGHT_LEG_TAKEN = 1592;
  const VARBIT_LARGEWALL_MULTIVAR = 1602;
  const VARBIT_LEFT_ARMLOCK = 1607;
  const VARBIT_RIGHT_ARMLOCK = 1608;
  const VARBIT_LEFT_LEGLOCK = 1609;
  const VARBIT_RIGHT_LEGLOCK = 1610;
  const VARBIT_Z_DOOR = 1611;
  const VARBIT_M_DOOR = 1612;
  const VARBIT_R_DOOR = 1613;
  const VARBIT_K_DOOR = 1614;
  const VARBIT_SEEN_PEDESTAL = 1618;
  const VARBIT_LARGEWALL_NEEDS_TRIMMING = 1620;
  // The four secret entrances (the cache's boulder varbits).
  const VARBIT_BOULDER_IDS = { n: 1598, e: 1599, s: 1600, w: 1601 };

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_BASE_BLOCK = 2;
  const STAGE_BASE_MADE = 3;
  const STAGE_BASE_PLACED = 4;
  const STAGE_BODY_BLOCK = 5;
  const STAGE_BODY_MADE = 6;
  const STAGE_BODY_PLACED = 7;
  const STAGE_STATUE_CHISELLED = 8;
  const STAGE_HEAD_MADE = 9;
  const STAGE_IN_TEMPLE = 10;
  const STAGE_TEMPLE_BRIEFED = 11;
  const STAGE_LIMBS_TAKEN = 12;
  const STAGE_DOORS_OPEN = 13;
  const STAGE_INNER_OPEN = 14;
  const STAGE_PEDESTAL_DONE = 15;
  const STAGE_ELEMENTS_DONE = 16;
  const STAGE_BONEGUARD1 = 17;
  const STAGE_WALL_AGREED = 18;
  const STAGE_WALL_BUILT = 19;
  const STAGE_COMPLETE = 20;

  // Persisted per-player state.
  const ATTR_BITS = "quest.enakhras_lament.bits";
  const ATTR_BASE_KG = "quest.enakhras_lament.base-kg";
  const ATTR_BODY_KG = "quest.enakhras_lament.body-kg";
  const ATTR_HEAD_CHOICE = "quest.enakhras_lament.head-choice";
  const ATTR_HEAD_MADE = "quest.enakhras_lament.head-made";
  const ATTR_WALL_TAKEN = "quest.enakhras_lament.wall-taken";
  const ATTR_POST_QUEST = "quest.enakhras_lament.post-quest";
  const ATTR_CAMULET_UNLIMITED = "quest.enakhras_lament.camulet-unlimited";
  const ATTR_ENTRANCES = "quest.enakhras_lament.entrances";

  const BIT_LEFT_ARM = 1 << 0;
  const BIT_RIGHT_ARM = 1 << 1;
  const BIT_LEFT_LEG = 1 << 2;
  const BIT_RIGHT_LEG = 1 << 3;
  const BIT_HEAD_TOLD = 1 << 4;
  const BIT_DECLINED = 1 << 5;
  const BIT_TRIED_HEAD = 1 << 6;
  const BIT_MOULD = 1 << 7;
  // One bit per door object, so a save made before the direction fix keeps the
  // doors it had already opened (the object ids, not the compass names, are keyed).
  const BIT_DOOR_RIGHT_LEG = 1 << 8; // 11070 south-east
  const BIT_DOOR_LEFT_ARM = 1 << 9; // 11064 south-west
  const BIT_DOOR_LEFT_LEG = 1 << 10; // 11068 north-west
  const BIT_DOOR_RIGHT_ARM = 1 << 11; // 11066 north
  const BIT_HEAD_PLACED = 1 << 12;
  const BIT_SMOKE = 1 << 13;
  const BIT_SHADOW = 1 << 14;
  const BIT_BLOOD = 1 << 15;
  const BIT_ICE = 1 << 16;
  const BIT_WALL_PLACED = 1 << 17;
  const BIT_BONEGUARD_MET = 1 << 18;
  const BIT_BRAZIER_MAPLE = 1 << 19;
  const BIT_BRAZIER_CANDLE = 1 << 20;
  const BIT_BRAZIER_COAL = 1 << 21;
  const BIT_BRAZIER_LOGS = 1 << 22;
  const BIT_BRAZIER_OAK = 1 << 23;
  const BIT_BRAZIER_WILLOW = 1 << 24;
  const BIT_Z_DOOR = 1 << 25;
  const BIT_M_DOOR = 1 << 26;
  const BIT_R_DOOR = 1 << 27;
  const BIT_K_DOOR = 1 << 28;
  const BIT_LIMB_DOOR_BITS = BIT_DOOR_RIGHT_ARM | BIT_DOOR_LEFT_ARM | BIT_DOOR_LEFT_LEG | BIT_DOOR_RIGHT_LEG;
  const BIT_BRAZIERS = BIT_BRAZIER_MAPLE | BIT_BRAZIER_CANDLE | BIT_BRAZIER_COAL
    | BIT_BRAZIER_LOGS | BIT_BRAZIER_OAK | BIT_BRAZIER_WILLOW;
  const BIT_GLOBES = BIT_SMOKE | BIT_SHADOW | BIT_BLOOD | BIT_ICE;
  const ALL_LIMB_BITS = BIT_LEFT_ARM | BIT_RIGHT_ARM | BIT_LEFT_LEG | BIT_RIGHT_LEG;

  // Items.
  const CHISEL = ItemIdentifiers.CHISEL; // 1755
  const PICKAXE_NAMES = /pickaxe/i;
  const SANDSTONE_1KG = ItemIdentifiers.SANDSTONE_1KG_; // 6971
  const SANDSTONE_2KG = ItemIdentifiers.SANDSTONE_2KG_; // 6973
  const SANDSTONE_5KG = ItemIdentifiers.SANDSTONE_5KG_; // 6975
  const SANDSTONE_10KG = ItemIdentifiers.SANDSTONE_10KG_; // 6977
  const SANDSTONE_20KG = ItemIdentifiers.SANDSTONE_20KG_; // 6985
  const SANDSTONE_32KG = ItemIdentifiers.SANDSTONE_32KG_; // 6986
  const SANDSTONE_BODY = ItemIdentifiers.SANDSTONE_BODY; // 6987
  const SANDSTONE_BASE = ItemIdentifiers.SANDSTONE_BASE; // 6988
  const HEAD_LAZIM = ItemIdentifiers.STONE_HEAD; // 6989
  const HEAD_ZAMORAK = ItemIdentifiers.STONE_HEAD_2; // 6990
  const HEAD_ICTHLARIN = ItemIdentifiers.STONE_HEAD_3; // 6991
  const HEAD_CAMEL = ItemIdentifiers.STONE_HEAD_4; // 6992
  const HEAD_CAVITY = ItemIdentifiers.STONE_HEAD_5; // 7002
  const Z_SIGIL = ItemIdentifiers.Z_SIGIL; // 6993
  const M_SIGIL = ItemIdentifiers.M_SIGIL; // 6994
  const R_SIGIL = ItemIdentifiers.R_SIGIL; // 6995
  const K_SIGIL = ItemIdentifiers.K_SIGIL; // 6996
  const LEFT_ARM = ItemIdentifiers.STONE_LEFT_ARM; // 6997
  const RIGHT_ARM = ItemIdentifiers.STONE_RIGHT_ARM; // 6998
  const LEFT_LEG = ItemIdentifiers.STONE_LEFT_LEG; // 6999
  const RIGHT_LEG = ItemIdentifiers.STONE_RIGHT_LEG; // 7000
  const CAMEL_MOULD = ItemIdentifiers.CAMEL_MOULD_P_; // 7001
  const CAMEL_MASK = ItemIdentifiers.CAMEL_MASK; // 7003
  const GRANITE_5KG = ItemIdentifiers.GRANITE_5KG_; // 6983
  const SOFT_CLAY = ItemIdentifiers.SOFT_CLAY; // 1761
  const COAL = ItemIdentifiers.COAL; // 453
  const LIT_CANDLE = ItemIdentifiers.LIT_CANDLE; // 33
  const LOGS = ItemIdentifiers.LOGS; // 1511
  const OAK_LOGS = ItemIdentifiers.OAK_LOGS; // 1521
  const WILLOW_LOGS = ItemIdentifiers.WILLOW_LOGS; // 1519
  const MAPLE_LOGS = ItemIdentifiers.MAPLE_LOGS; // 1517
  const BREAD = ItemIdentifiers.BREAD; // 2309
  const CAMULET = ItemIdentifiers.CAMULET; // 6707
  const COINS = ItemIdentifiers.COINS; // 995
  const SANDSTONE_KG_BY_ITEM = new Map([
    [SANDSTONE_1KG, 1],
    [SANDSTONE_2KG, 2],
    [SANDSTONE_5KG, 5],
    [SANDSTONE_10KG, 10],
  ]);
  const ORIGINAL_HEAD_IDS = new Set([HEAD_LAZIM, HEAD_ZAMORAK, HEAD_ICTHLARIN, HEAD_CAMEL]);
  const HEAD_ITEM_BY_CHOICE = new Map([
    [1, HEAD_LAZIM],
    [2, HEAD_ZAMORAK],
    [3, HEAD_ICTHLARIN],
    [4, HEAD_CAMEL],
  ]);
  const ALL_LIMBS = new Set([LEFT_ARM, RIGHT_ARM, LEFT_LEG, RIGHT_LEG]);
  const PIZZA_IDS = new Set([2289, 2293, 2297, 2301]);
  const CAKE_IDS = new Set([1891, 1897]);
  const POTATO_TOPPING_IDS = new Set([6703, 6705, 7054, 7056, 7058, 7060]);
  /**
   * The food Pentyn eats, by the cache's item names: the wiki lists "bread, any
   * kind of pie, cake or chocolate cake, any kind of pizza, or a baked potato
   * with topping", and partial and burnt versions do not work. The pie types are
   * the eight the Quest Helper route accepts.
   */
  const FOOD_NAME_PATTERNS = [
    ["bread", /^bread$/i],
    ["pie", /^(apple|redberry|meat|garden|fish|admiral|wild|summer) pie$/i],
    ["pizza", /^(plain|meat|anchovy|pineapple|banana) pizza$/i],
    ["cake", /^(chocolate )?cake$/i],
  ];
  const SANDSTONE_SPLITS = new Map([
    [SANDSTONE_10KG, [[SANDSTONE_5KG, 2]]],
    [SANDSTONE_5KG, [[SANDSTONE_2KG, 2], [SANDSTONE_1KG, 1]]],
    [SANDSTONE_2KG, [[SANDSTONE_1KG, 2]]],
  ]);

  // Objects.
  const FLAT_GROUND = ObjectIdentifiers.FLAT_GROUND; // 10954
  const SURFACE_STATUE_MULTILOC_ID = 10952; // Cache loc; transforms on varbit 1593.
  const HEADLESS_STATUE_1 = ObjectIdentifiers.HEADLESS_STATUE; // 10955
  const HEADLESS_STATUE_2 = ObjectIdentifiers.HEADLESS_STATUE_2; // 10956
  const HEADLESS_STATUE_3 = ObjectIdentifiers.HEADLESS_STATUE_3; // 10957
  const HOLE = ObjectIdentifiers.HOLE_13; // 10953
  const FALLEN_STATUE_MULTILOC_ID = 10970; // Cache loc; transforms on varbit 1587.
  const STATUE_OBJECT_IDS = new Set([SURFACE_STATUE_MULTILOC_ID, FLAT_GROUND, HEADLESS_STATUE_1, HEADLESS_STATUE_2, HEADLESS_STATUE_3, HOLE]);
  const FALLEN_STATUE_IDS = new Set([
    FALLEN_STATUE_MULTILOC_ID,
    ObjectIdentifiers.FALLEN_STATUE,
    ObjectIdentifiers.FALLEN_STATUE_2,
    ObjectIdentifiers.FALLEN_STATUE_3,
    ObjectIdentifiers.FALLEN_STATUE_4,
    ObjectIdentifiers.FALLEN_STATUE_5,
    ObjectIdentifiers.FALLEN_STATUE_6,
    ObjectIdentifiers.FALLEN_STATUE_7,
    ObjectIdentifiers.FALLEN_STATUE_8,
    ObjectIdentifiers.FALLEN_STATUE_9,
    ObjectIdentifiers.FALLEN_STATUE_10,
    ObjectIdentifiers.FALLEN_STATUE_11,
    ObjectIdentifiers.FALLEN_STATUE_12,
    ObjectIdentifiers.FALLEN_STATUE_13,
    ObjectIdentifiers.FALLEN_STATUE_14,
    ObjectIdentifiers.FALLEN_STATUE_15,
    ObjectIdentifiers.FALLEN_STATUE_16,
  ]);
  const PEDESTAL = ObjectIdentifiers.PEDESTAL; // 10988
  const PEDESTAL_HEAD = ObjectIdentifiers.PEDESTAL_2; // 10989
  const PEDESTAL_TILE = { x: 3104, y: 9312, z: 1 };
  const MAGIC_BARRIER = ObjectIdentifiers.MAGIC_BARRIER; // 11005
  const FOUNTAIN = ObjectIdentifiers.FOUNTAIN_12; // 11007
  const FOUNTAIN_TILE = { x: 3091, y: 9307, z: 1 };
  const RUBBLE = ObjectIdentifiers.RUBBLE_13; // 34663
  const RUBBLE_TILE = { x: 3108, y: 9295, z: 1 };
  const BRAZIER = ObjectIdentifiers.BRAZIER; // 11017
  const WALL_MULTILOC_IDS = new Set([11026, 11027]); // Cache locs at 3100/3105, transform on varbit 1602.
  const SECRET_ENTRANCE = ObjectIdentifiers.SECRET_ENTRANCE; // 11050
  const BOULDER_NORTH_MULTILOC_ID = 11045; // Cache loc; transform on varbit 1598.
  const BOULDER_EAST_MULTILOC_ID = 11046; // Cache loc; transform on varbit 1599.
  const BOULDER_SOUTH_MULTILOC_ID = 11047; // Cache loc; transform on varbit 1600.
  const BOULDER_WEST_MULTILOC_ID = 11048; // Cache loc; transform on varbit 1601.
  const WALL_IDS = new Set([
    ...WALL_MULTILOC_IDS,
    ObjectIdentifiers.WALL_29,
    ObjectIdentifiers.WALL_30,
    ObjectIdentifiers.WALL_31,
    ObjectIdentifiers.WALL_32,
    ObjectIdentifiers.WALL_33,
    ObjectIdentifiers.WALL_34,
    ObjectIdentifiers.WALL_35,
    ObjectIdentifiers.WALL_36,
    ObjectIdentifiers.WALL_37,
    ObjectIdentifiers.WALL_38,
    ObjectIdentifiers.WALL_39,
    ObjectIdentifiers.WALL_40,
  ]);
  const SECRET_ENTRANCE_IDS = new Set([
    SECRET_ENTRANCE,
    ObjectIdentifiers.BOULDER_12, // 11049 transformed from cache entrances.
    BOULDER_NORTH_MULTILOC_ID,
    BOULDER_EAST_MULTILOC_ID,
    BOULDER_SOUTH_MULTILOC_ID,
    BOULDER_WEST_MULTILOC_ID,
  ]);

  // The six braziers by tile; the transcript names them NW/N/NE/SW/S/SE.
  const BRAZIERS_BY_TILE = new Map([
    ["3114,9309", { fuel: MAPLE_LOGS, conditionId: "o_UM9j", investigateId: "5LF4Lz", bit: BIT_BRAZIER_MAPLE }],
    ["3116,9309", { fuel: LIT_CANDLE, conditionId: "CM5ebk", investigateId: "XQVYCv", bit: BIT_BRAZIER_CANDLE }],
    ["3118,9309", { fuel: COAL, conditionId: "r4o5Si", investigateId: "btoeYZ", bit: BIT_BRAZIER_COAL }],
    ["3114,9306", { fuel: LOGS, conditionId: "pSGPuU", investigateId: "YbEi3j", bit: BIT_BRAZIER_LOGS }],
    ["3116,9306", { fuel: OAK_LOGS, conditionId: "J2Kv9a", investigateId: "OZeRP4", bit: BIT_BRAZIER_OAK }],
    ["3118,9306", { fuel: WILLOW_LOGS, conditionId: "I6aDlY", investigateId: "oCE3SS", bit: BIT_BRAZIER_WILLOW }],
  ]);
  const BRAZIER_CONDITION_IDS = new Set([...BRAZIERS_BY_TILE.values()].map((entry) => entry.conditionId));
  const BRAZIER_INVESTIGATE_IDS = new Set([...BRAZIERS_BY_TILE.values()].map((entry) => entry.investigateId));

  // Cache names pin each door's limb and the exact item it consumes:
  // 11066 right arm (north), 11068 left leg (north-west), 11064 left arm
  // (south-west), 11070 right leg (south-east).
  const LIMB_DOORS = new Map([
    [ObjectIdentifiers.DOOR_263, { variant: "bottom-floor-of-enakhra-s-temple-open-door-to-the-north", item: RIGHT_ARM, bit: BIT_DOOR_RIGHT_ARM }], // 11066
    [ObjectIdentifiers.DOOR_265, { variant: "bottom-floor-of-enakhra-s-temple-open-door-to-the-north-west", item: LEFT_LEG, bit: BIT_DOOR_LEFT_LEG }], // 11068
    [ObjectIdentifiers.DOOR_261, { variant: "bottom-floor-of-enakhra-s-temple-open-door-to-the-south-west", item: LEFT_ARM, bit: BIT_DOOR_LEFT_ARM }], // 11064
    [ObjectIdentifiers.DOOR_267, { variant: "bottom-floor-of-enakhra-s-temple-open-door-to-the-south-east", item: RIGHT_LEG, bit: BIT_DOOR_RIGHT_LEG }], // 11070
  ]);
  // Cache names: 11051 Z, 11053 M, 11055 R, 11057 K. Each door consumes its
  // own sigil, not whichever sigil the player happens to be carrying.
  const INNER_DOORS = new Map([
    [ObjectIdentifiers.DOOR_253, { openId: ObjectIdentifiers.DOOR_254, sigil: Z_SIGIL, bit: BIT_Z_DOOR }], // 11051 -> 11052
    [ObjectIdentifiers.DOOR_255, { openId: ObjectIdentifiers.DOOR_256, sigil: M_SIGIL, bit: BIT_M_DOOR }], // 11053 -> 11054
    [ObjectIdentifiers.DOOR_257, { openId: ObjectIdentifiers.DOOR_258, sigil: R_SIGIL, bit: BIT_R_DOOR }], // 11055 -> 11056
    [ObjectIdentifiers.DOOR_259, { openId: ObjectIdentifiers.DOOR_260, sigil: K_SIGIL, bit: BIT_K_DOOR }], // 11057 -> 11058
  ]);
  const SIGIL_PEDESTALS = new Map([
    [ObjectIdentifiers.PEDESTAL_20, M_SIGIL], // 11061 enakh_pedestal_sigil_m
    [ObjectIdentifiers.PEDESTAL_19, Z_SIGIL], // 11060 enakh_pedestal_sigil_z
    [ObjectIdentifiers.PEDESTAL_21, R_SIGIL], // 11062 enakh_pedestal_sigil_r
    [ObjectIdentifiers.PEDESTAL_22, K_SIGIL], // 11063 enakh_pedestal_sigil_k
  ]);

  const LAZIM_SURFACE_TILE = { x: 3191, y: 2926, z: 0 };
  const LAZIM_TEMPLE_TILE = { x: 3131, y: 9320, z: 0 };
  const TEMPLE_ARRIVAL_TILE = { x: 3130, y: 9327, z: 0 };
  const BONEGUARD1_TILE = { x: 3104, y: 9307, z: 2 };
  const BONEGUARD2_TILE = { x: 3105, y: 9297, z: 1 };
  const ENAKHRA_TILE = { x: 3104, y: 9286, z: 1 };
  const CRUST_TILE = { x: 3092, y: 9308, z: 1 };
  const FURNACE_GRATE_TILE = { x: 3116, y: 9323, z: 1 };
  /**
   * The four secret entrances. The cache places four unnamed hole objects
   * (11045-11048) at the surface ends of the four tunnels. The room-to-hole
   * pairing below follows north/east/south/west map geometry and the matching
   * ladder positions; the cache itself does not name these locs:
   *   n: sand pile 3087,9333 (north room) -> hole 11045 at 3148,2937
   *   e: sand pile 3124,9329 (centre)     -> hole 11046 at 3194,2925
   *   s: sand pile 3120,9289 (south room) -> hole 11047 at 3189,2888
   *   w: sand pile 3081,9306 (west room)  -> hole 11048 at 3146,2908
   * The room's ladder (11041/11042) sits next to its sand pile.
   */
  const SECRET_ENTRANCES = [
    { key: "n", holeId: BOULDER_NORTH_MULTILOC_ID, surface: { x: 3148, y: 2937, z: 0 }, pile: "3087,9333", ladder: "3087,9336" },
    { key: "e", holeId: BOULDER_EAST_MULTILOC_ID, surface: { x: 3194, y: 2925, z: 0 }, pile: "3124,9329", ladder: "3127,9329" },
    { key: "s", holeId: BOULDER_SOUTH_MULTILOC_ID, surface: { x: 3189, y: 2888, z: 0 }, pile: "3120,9289", ladder: "3121,9286" },
    { key: "w", holeId: BOULDER_WEST_MULTILOC_ID, surface: { x: 3146, y: 2908, z: 0 }, pile: "3081,9306", ladder: "3079,9306" },
  ];
  const ENTRANCE_BITS = { n: 1, e: 2, s: 4, w: 8 };
  const SAND_PILE_EXITS = new Map(SECRET_ENTRANCES.map((entrance) => [entrance.pile, entrance]));

  let quest;
  let worldInstalled = false;
  /** Owner-scoped temple NPCs, one set per player. */
  const playerNpcs = new WeakMap();
  /** Transient food/brazier context per player, never persisted. */
  const pentynFood = new WeakMap();
  const brazierContext = new WeakMap();

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function bits(player) {
    return Number(player.getAttribute(ATTR_BITS)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(ATTR_BITS, bits(player) | bit);
    sendAuxVarbits(player);
  }

  function clearBit(player, bit) {
    player.setAttribute(ATTR_BITS, bits(player) & ~bit);
    sendAuxVarbits(player);
  }

  function has(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function give(player, itemId, amount = 1) {
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function take(player, itemId, amount = 1) {
    player.getInventory().deleteNumber(itemId, amount);
  }

  function attrNumber(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value : 0;
  }

  function setAttrNumber(player, key, value) {
    player.setAttribute(key, value | 0);
    sendAuxVarbits(player);
  }

  /**
   * Mirror the plugin's private stage/bits onto the native auxiliary varbits
   * Quest Helper reads (ENAKH_STATUE_MULTIVAR, the room/brazier/limb/door/wall
   * multivars). Without these the overlay only sees varbit 1560 and its
   * requirement conditions never turn true.
   */
  function sendAuxVarbits(player) {
    const sender = player.getPacketSender?.();
    if (!sender?.sendVarbit) return;
    const stage = quest.getStage(player);
    const bitfield = bits(player);
    const statueMultivar = hasBit(player, BIT_HEAD_PLACED) || stage >= STAGE_IN_TEMPLE ? 28
      : stage >= STAGE_STATUE_CHISELLED ? 3
      : stage >= STAGE_BODY_PLACED ? 2
      : stage >= STAGE_BASE_PLACED ? 1 : 0;
    const brazierBits = [
      BIT_BRAZIER_LOGS,
      BIT_BRAZIER_OAK,
      BIT_BRAZIER_WILLOW,
      BIT_BRAZIER_MAPLE,
      BIT_BRAZIER_CANDLE,
      BIT_BRAZIER_COAL,
    ];
    const values = [
      [VARBIT_STATUE_MULTIVAR, statueMultivar],
      [VARBIT_STATUE_BODY_BLURB, stage >= STAGE_BODY_BLOCK ? 1 : 0],
      [VARBIT_STATUE_HEAD_BLURB, stage >= STAGE_STATUE_CHISELLED ? 1 : 0],
      [VARBIT_LAZIM_REALLYAMAGE, stage >= STAGE_TEMPLE_BRIEFED ? 1 : 0],
      [VARBIT_BLOOD_ROOM, hasBit(player, BIT_BLOOD) ? 1 : 0],
      [VARBIT_ICE_ROOM, hasBit(player, BIT_ICE) ? 1 : 0],
      [VARBIT_SMOKE_ROOM, hasBit(player, BIT_SMOKE) ? 1 : 0],
      [VARBIT_SHADOW_ROOM, hasBit(player, BIT_SHADOW) ? 1 : 0],
      ...brazierBits.map((bit, index) => [VARBIT_BRAZIER_IDS[index], (bitfield & bit) !== 0 ? 1 : 0]),
      // The cache multivar is 3 + the four taken-limb flags packed into bits 2-5.
      [VARBIT_FALLEN_STATUE_MULTIVAR, 3 | (((bitfield & ALL_LIMB_BITS) >>> 0) << 2)],
      [VARBIT_LEFT_ARM_TAKEN, (bitfield & BIT_LEFT_ARM) !== 0 ? 1 : 0],
      [VARBIT_RIGHT_ARM_TAKEN, (bitfield & BIT_RIGHT_ARM) !== 0 ? 1 : 0],
      [VARBIT_LEFT_LEG_TAKEN, (bitfield & BIT_LEFT_LEG) !== 0 ? 1 : 0],
      [VARBIT_RIGHT_LEG_TAKEN, (bitfield & BIT_RIGHT_LEG) !== 0 ? 1 : 0],
      [VARBIT_LARGEWALL_MULTIVAR, attrNumber(player, ATTR_WALL_TAKEN) >= 3 ? 4 : attrNumber(player, ATTR_WALL_TAKEN)],
      [VARBIT_LEFT_ARMLOCK, (bitfield & BIT_DOOR_LEFT_ARM) !== 0 ? 1 : 0],
      [VARBIT_RIGHT_ARMLOCK, (bitfield & BIT_DOOR_RIGHT_ARM) !== 0 ? 1 : 0],
      [VARBIT_LEFT_LEGLOCK, (bitfield & BIT_DOOR_LEFT_LEG) !== 0 ? 1 : 0],
      [VARBIT_RIGHT_LEGLOCK, (bitfield & BIT_DOOR_RIGHT_LEG) !== 0 ? 1 : 0],
      [VARBIT_Z_DOOR, (bitfield & BIT_Z_DOOR) !== 0 ? 1 : 0],
      [VARBIT_M_DOOR, (bitfield & BIT_M_DOOR) !== 0 ? 1 : 0],
      [VARBIT_R_DOOR, (bitfield & BIT_R_DOOR) !== 0 ? 1 : 0],
      [VARBIT_K_DOOR, (bitfield & BIT_K_DOOR) !== 0 ? 1 : 0],
      [VARBIT_SEEN_PEDESTAL, stage >= STAGE_PEDESTAL_DONE ? 1 : 0],
      [VARBIT_LARGEWALL_NEEDS_TRIMMING, (bitfield & BIT_WALL_PLACED) !== 0 ? 1 : 0],
      ...Object.entries(VARBIT_BOULDER_IDS).map(([key, id]) => [id, entrances(player) & ENTRANCE_BITS[key] ? 1 : 0]),
    ];
    for (const [id, value] of values) sender.sendVarbit(id, value | 0);
  }

  /** The secret entrances this player has unlocked (one bit per compass). */
  function entrances(player) {
    return attrNumber(player, ATTR_ENTRANCES);
  }

  function unlockEntrance(player, entrance) {
    const bit = ENTRANCE_BITS[entrance.key];
    if (!bit || (entrances(player) & bit) !== 0) return;
    player.setAttribute(ATTR_ENTRANCES, entrances(player) | bit);
    sendAuxVarbits(player);
  }

  function sendAuxOnStageChanged({ player }) {
    if (!player) return;
    sendAuxVarbits(player);
    ensureTempleNpcs(player);
  }

  function sendAuxOnBootstrap({ player }) {
    if (player) sendAuxVarbits(player);
  }

  function advanceTo(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  function hasAnySandstone(player) {
    for (const id of SANDSTONE_KG_BY_ITEM.keys()) if (has(player, id)) return true;
    return false;
  }

  /** Banked is not lost: the transcript distinguishes "in the bank" from "lost". */
  function bankHas(player, itemId) {
    const banks = player.getBanks?.();
    if (Array.isArray(banks)) return banks.some((bank) => bank?.contains?.(itemId) === true);
    if (typeof player.getBank === "function") {
      for (let tab = 0; tab < 10; tab++) {
        if (player.getBank(tab)?.contains?.(itemId) === true) return true;
      }
    }
    return false;
  }

  function bankHasAny(player, itemIds) {
    for (const itemId of itemIds) if (bankHas(player, itemId)) return true;
    return false;
  }

  function hasAnyLimb(player) {
    for (const id of ALL_LIMBS) if (has(player, id)) return true;
    return false;
  }

  /** A limb already cut from the statue but no longer carried can be handed back by Lazim. */
  function hasLostLimb(player) {
    for (const [itemId, bit] of [
      [LEFT_ARM, BIT_LEFT_ARM],
      [RIGHT_ARM, BIT_RIGHT_ARM],
      [LEFT_LEG, BIT_LEFT_LEG],
      [RIGHT_LEG, BIT_RIGHT_LEG],
    ]) {
      if (hasBit(player, bit) && !has(player, itemId) && !bankHas(player, itemId)) return true;
    }
    return false;
  }

  function hasOriginalHead(player) {
    for (const id of ORIGINAL_HEAD_IDS) if (has(player, id)) return true;
    return false;
  }

  function headChoice(player) {
    return attrNumber(player, ATTR_HEAD_CHOICE);
  }

  function headMade(player) {
    return attrNumber(player, ATTR_HEAD_MADE);
  }

  function protectFromMelee(player) {
    return player.getPrayerActive?.()?.[PrayerHandler.PROTECT_FROM_MELEE] === true;
  }

  function giantDwarfComplete(player) {
    const request = { player, key: "giant_dwarf", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function variantSteps(variant) {
    const data = loadTranscripts(api);
    const steps = data?.[PAGE]?.variants?.[variant];
    return Array.isArray(steps) ? steps : null;
  }

  function tileKey(location) {
    if (!location) return "";
    const x = location.x ?? location.getX?.();
    const y = location.y ?? location.getY?.();
    return `${x},${y}`;
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Lazim build his statue and fell into Enakhra's Temple.</str>",
        "<str>I freed Akthanakos from Enakhra's magic and they left to fight.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BONEGUARD1) {
      return [
        "Lazim's statue fell into <col=800000>Enakhra's Temple</col>.",
        "I freed one boneguard; the other wants me to finish the wall.",
        `Wall loads trimmed: ${Math.min(3, attrNumber(player, ATTR_WALL_TAKEN))}/3.`,
      ];
    }
    if (stage >= STAGE_ELEMENTS_DONE) {
      return [
        "Lazim's statue fell into <col=800000>Enakhra's Temple</col>.",
        "The globes on the pedestal are lit; the magic barrier is open.",
        "I should go through the barrier and up the ladder.",
      ];
    }
    if (stage >= STAGE_PEDESTAL_DONE) {
      return [
        "Lazim's statue fell into <col=800000>Enakhra's Temple</col>.",
        "I placed the new granite head in the pedestal.",
        "I must solve the four rooms' puzzles so the barrier opens.",
      ];
    }
    if (stage >= STAGE_INNER_OPEN) {
      return [
        "Lazim's statue fell into <col=800000>Enakhra's Temple</col>.",
        "I opened the sigil door and reached the middle floor.",
        "I should ask Lazim about the pedestal.",
      ];
    }
    if (stage >= STAGE_DOORS_OPEN) {
      return [
        "Lazim's statue fell into <col=800000>Enakhra's Temple</col>.",
        "I opened the four outer doors and have the sigils.",
        "I should open the inner door in the centre room.",
      ];
    }
    if (stage >= STAGE_TEMPLE_BRIEFED) {
      return [
        "Lazim's statue fell into <col=800000>Enakhra's Temple</col>.",
        "Lazim wants me to use the statue's limbs to open the doors.",
        "I should chisel the fallen statue and search its rooms.",
      ];
    }
    if (stage >= STAGE_IN_TEMPLE) {
      return [
        "<str>I built Lazim's statue in the desert and fell through the ground.</str>",
        "I should talk to <col=800000>Lazim</col> in the temple.",
      ];
    }
    if (stage >= STAGE_HEAD_MADE) {
      return [
        "I agreed to help <col=800000>Lazim</col> build a statue near the quarry.",
        "I have carved the head; I should attach it to the statue.",
      ];
    }
    if (stage >= STAGE_STATUE_CHISELLED) {
      return [
        "I agreed to help <col=800000>Lazim</col> build a statue near the quarry.",
        "Lazim wants a granite head for the statue.",
      ];
    }
    if (stage >= STAGE_BODY_PLACED) {
      return [
        "I agreed to help <col=800000>Lazim</col> build a statue near the quarry.",
        "I should chisel the statue a bit more.",
      ];
    }
    if (stage >= STAGE_BASE_PLACED) {
      return [
        "I agreed to help <col=800000>Lazim</col> build a statue near the quarry.",
        `I have given Lazim ${attrNumber(player, ATTR_BODY_KG)}/20 kg of sandstone for the body.`,
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I agreed to help <col=800000>Lazim</col> build a statue near the quarry.",
        `I have given Lazim ${attrNumber(player, ATTR_BASE_KG)}/32 kg of sandstone for the base.`,
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Lazim</col>",
      "at the quarry in the Kharidian Desert.",
    ];
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function lazimVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return attrNumber(player, ATTR_POST_QUEST) > 0
        ? "post-quest-talking-to-lazim-again-after-the-quest"
        : "post-quest-talking-to-lazim-after-the-quest";
    }
    if (stage >= STAGE_IN_TEMPLE) {
      if (stage >= STAGE_WALL_AGREED) return "middle-floor-of-enakhra-s-temple-talking-to-lazim-after-before-building-the-wall";
      if (stage >= STAGE_ELEMENTS_DONE) return "middle-floor-of-enakhra-s-temple-talking-to-lazim-after-unlocking-the-gate";
      if (stage >= STAGE_PEDESTAL_DONE) return "middle-floor-of-enakhra-s-temple-talking-to-lazim-on-the-middle-floor";
      if (stage >= STAGE_INNER_OPEN) {
        return hasBit(player, BIT_TRIED_HEAD)
          ? "middle-floor-of-enakhra-s-temple-talking-to-lazim-after-trying-to-use-the-statue-s-head-on-the-pedestal"
          : "middle-floor-of-enakhra-s-temple-talking-to-lazim-after-going-upstairs";
      }
      if (stage >= STAGE_DOORS_OPEN) return "bottom-floor-of-enakhra-s-temple-talking-to-lazim-after-losing-the-stone-limbs";
      if (stage >= STAGE_TEMPLE_BRIEFED) {
        // The lost-limb variant is the only one with the four return conditions.
        if (hasLostLimb(player)) return "bottom-floor-of-enakhra-s-temple-talking-to-lazim-after-losing-the-stone-limbs";
        if (hasAnyLimb(player)) return "bottom-floor-of-enakhra-s-temple-talking-to-lazim-while-holding-the-stone-limbs";
        return "bottom-floor-of-enakhra-s-temple-talking-to-lazim-after-getting-the-stone-head-once";
      }
      // Variant selection can be interrupted before the briefing is seen. The
      // milestone is committed after its final line instead.
      return "bottom-floor-of-enakhra-s-temple-talking-to-lazim-inside-the-temple";
    }
    if (has(player, SANDSTONE_32KG)) return "starting-out-talking-to-lazim-after-getting-the-sandstone-32kg";
    if (has(player, SANDSTONE_BASE)) return "starting-out-talking-to-lazim-with-the-sandstone-base";
    if (has(player, SANDSTONE_BODY)) return "starting-out-talking-to-lazim-while-holding-the-sandstone-body";
    if (has(player, SANDSTONE_20KG)) return "starting-out-talking-to-lazim-while-holding-the-sandstone-20kg";
    if (stage >= STAGE_STATUE_CHISELLED) {
      if (hasOriginalHead(player) || has(player, HEAD_CAVITY)) return "starting-out-talking-to-lazim-after-creating-a-head";
      return "starting-out-talking-to-lazim-after-chiseling-the-statue";
    }
    if (stage >= STAGE_BODY_PLACED) return "starting-out-talking-to-lazim-after-using-the-body-on-the-statue";
    if (stage === STAGE_BODY_MADE) return "starting-out-talking-to-lazim-while-holding-the-sandstone-body";
    if (stage === STAGE_BODY_BLOCK) return "starting-out-talking-to-lazim-while-holding-the-sandstone-20kg";
    if (stage >= STAGE_BASE_PLACED) {
      if (hasAnySandstone(player)) return "starting-out-talking-to-lazim-while-holding-sandstone-for-the-body";
      return "starting-out-talking-to-lazim-after-placing-the-sandstone-base";
    }
    if (stage === STAGE_BASE_MADE) return "starting-out-talking-to-lazim-with-the-sandstone-base";
    if (stage === STAGE_BASE_BLOCK) return "starting-out-talking-to-lazim-after-getting-the-sandstone-32kg";
    if (stage === STAGE_STARTED) {
      if (hasAnySandstone(player)) return "starting-out-talking-to-lazim-while-holding-sandstone-for-the-base";
      return "starting-out-talking-to-lazim-again-before-accepting-the-quest";
    }
    if (stage >= STAGE_STARTED && hasAnySandstone(player)) {
      return "starting-out-talking-to-lazim-while-holding-sandstone-for-the-base";
    }
    return hasBit(player, BIT_DECLINED)
      ? "starting-out-talking-to-lazim-again-before-accepting-the-quest"
      : "starting-out-talking-to-lazim";
  }

  function selectVariant({ npcId, player }) {
    if (!OWNED_NPC_IDS.has(npcId)) return null;
    if (npcId === LAZIM_NPC_ID) return lazimVariant(player);
    if (npcId === PENTYN_NPC_ID) {
      return quest.getStage(player) >= STAGE_COMPLETE
        ? "standard-dialogue-after-completion-of-the-quest"
        : "middle-floor-of-enakhra-s-temple-talking-to-pentyn";
    }
    // After the cutscene Akthanakos and Enakhra are gone; no branch of theirs
    // may play again, so the final reward dialogue cannot be replayed.
    if (quest.getStage(player) >= STAGE_COMPLETE) return null;
    if (npcId === BONEGUARD_NPC_ID) return "middle-floor-of-enakhra-s-temple-talking-to-the-first-boneguard";
    if (npcId === BONEGUARD2_NPC_ID) {
      return quest.getStage(player) >= STAGE_WALL_BUILT
        ? "middle-floor-of-enakhra-s-temple-talking-to-the-boneguard-after-finishing-the-wall"
        : "middle-floor-of-enakhra-s-temple-talk-to-the-second-boneguard";
    }
    if (npcId === AKTHANAKOS_NPC_ID) return "middle-floor-of-enakhra-s-temple-talking-to-akthanakos-before-finishing-the-cutscene";
    if (npcId === ENAKHRA_NPC_ID) {
      return quest.getStage(player) >= STAGE_WALL_AGREED
        ? "middle-floor-of-enakhra-s-temple-talking-to-enakhra-after-the-second-boneguard"
        : "middle-floor-of-enakhra-s-temple-talking-to-enakhra-before-the-second-boneguard";
    }
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { npcId, player, stepId, text } = event;
    if (!OWNED_NPC_IDS.has(npcId)) return null;
    const value = String(text ?? "");
    // The reward's "no room" guard is asked of the boneguard and of Akthanakos.
    if (stepId === "yaY72t" || stepId === "tP9pxd") return player.getInventory().getFreeSlots() <= 0;

    if (npcId === LAZIM_NPC_ID) {
      // Sandstone hand-ins: menu option guards carry the option id.
      if (stepId === "u5ihBN" || stepId === "teyOME") return has(player, SANDSTONE_10KG);
      if (stepId === "0uv69v" || stepId === "kAy4qp") return has(player, SANDSTONE_5KG);
      if (stepId === "D9Ee_i" || stepId === "0K-Gyp") return has(player, SANDSTONE_2KG);
      if (stepId === "6LjurH" || stepId === "pQQspU") return has(player, SANDSTONE_1KG);
      if (stepId === "N_f_YA") return attrNumber(player, ATTR_BASE_KG) === 0;
      if (stepId === "P9kkT7") return attrNumber(player, ATTR_BASE_KG) > 0;
      if (stepId === "JCbk8g") return attrNumber(player, ATTR_BASE_KG) < 32;
      if (stepId === "r7_kHr") return attrNumber(player, ATTR_BASE_KG) >= 32;
      if (stepId === "CJoyax") return attrNumber(player, ATTR_BODY_KG) === 0;
      if (stepId === "Fg_7n6") return attrNumber(player, ATTR_BODY_KG) > 0;
      if (stepId === "OuWhWe") return attrNumber(player, ATTR_BODY_KG) < 20;
      if (stepId === "PkYWDq") return attrNumber(player, ATTR_BODY_KG) >= 20;
      // Fallen statue limb option guards.
      if (stepId === "M6XzRN") return !has(player, LEFT_ARM) && !hasBit(player, BIT_LEFT_ARM);
      if (stepId === "arsdof") return !has(player, RIGHT_ARM) && !hasBit(player, BIT_RIGHT_ARM);
      if (stepId === "61YBoM") return !has(player, LEFT_LEG) && !hasBit(player, BIT_LEFT_LEG);
      if (stepId === "osLsmW") return !has(player, RIGHT_LEG) && !hasBit(player, BIT_RIGHT_LEG);
      // Head menus: what the player said they would carve vs what they carved.
      if (stepId === "6IDCcx") return giantDwarfComplete(player);
      if (stepId === "KYhF8k" || stepId === "jkM8AT") return headChoice(player) === 1;
      if (stepId === "pggC4K" || stepId === "_TJLa8") return headChoice(player) !== 1;
      if (stepId === "LzHrQ-" || stepId === "GT2oyz") return headChoice(player) === 2;
      if (stepId === "-HBeT_" || stepId === "WCddst") return headChoice(player) !== 2;
      if (stepId === "-td9Ge" || stepId === "-FLSdZ") return headChoice(player) === 3;
      if (stepId === "29YIki" || stepId === "TrsTIB") return headChoice(player) !== 3;
      if (stepId === "FG2oTI" || stepId === "WhFQwT") return headChoice(player) === 4;
      if (stepId === "uY2sZo" || stepId === "JhuK2G") return headChoice(player) !== 4;
      const madePick = { Oxb3xp: 1, "9uAFYa": 2, BT5NXM: 3, QU2D8a: 4 }[stepId];
      if (madePick !== undefined) {
        if (headMade(player) !== madePick) return false;
        setBit(player, BIT_HEAD_TOLD);
        return true;
      }
      // Where is the statue's head.
      if (stepId === "jsyT6r" || stepId === "yiasHG") {
        return !hasOriginalHead(player) && !bankHasAny(player, ORIGINAL_HEAD_IDS)
          && !has(player, HEAD_CAVITY) && !bankHas(player, HEAD_CAVITY) && hasBit(player, BIT_TRIED_HEAD);
      }
      if (stepId === "GO2zrU" || stepId === "Nt6C09") return hasOriginalHead(player);
      if (stepId === "iNbY4_") {
        return !hasOriginalHead(player) && !bankHasAny(player, ORIGINAL_HEAD_IDS)
          && !hasBit(player, BIT_TRIED_HEAD);
      }
      // Lost limbs (bottom floor).
      if (stepId === "JtVWqW") return recoverLimb(player, RIGHT_ARM, BIT_RIGHT_ARM);
      if (stepId === "Ucblpq") return recoverLimb(player, LEFT_ARM, BIT_LEFT_ARM);
      if (stepId === "RF36nt") return recoverLimb(player, LEFT_LEG, BIT_LEFT_LEG);
      if (stepId === "5cAG8a") return recoverLimb(player, RIGHT_LEG, BIT_RIGHT_LEG);
      // Braziers (played from item-on-object with a transient context).
      if (BRAZIER_CONDITION_IDS.has(stepId)) return brazierContext.get(player)?.conditionId === stepId;
      if (BRAZIER_INVESTIGATE_IDS.has(stepId)) return brazierContext.get(player)?.investigateId === stepId;
      // Post-quest camulet flows.
      if (stepId === "Y-IaPG") return !has(player, CAMULET) && !bankHas(player, CAMULET);
      if (stepId === "KtrrxI") return player.getInventory().getFreeSlots() <= 0;
      if (stepId === "aOgB3U") return player.getInventory().getFreeSlots() > 0;
      if (stepId === "X4KEXi") return attrNumber(player, ATTR_CAMULET_UNLIMITED) > 0;
      if (stepId === "VvEJ5Q") return !has(player, CAMULET) && bankHas(player, CAMULET);
      if (stepId === "DSFW44") return has(player, CAMULET);
      if (stepId === "YxdsZN") return !has(player, COINS, 1000000);
      if (value.startsWith("If the player has sandstone")) return hasAnySandstone(player);
      return null;
    }

    if (npcId === PENTYN_NPC_ID) {
      const food = pentynFood.get(player);
      const key = food?.key ?? "other";
      // The transcript has no pie branch of its own; a pie is the food the
      // bread branch describes, so it plays that one.
      if (stepId === "aGRJAj") return key === "bread" || key === "pie";
      if (stepId === "52e0HN") return key === "pizza";
      if (stepId === "qZ7QjF") return key === "cake";
      if (stepId === "NdPCmi") return key === "potato";
      if (stepId === "P9T1j0") return key === "potato-topping";
      if (stepId === "M80poM") return key === "cabbage";
      if (stepId === "FgG8o6") return key === "vegetable";
      if (stepId === "a66xwN") return key === "meat";
      if (stepId === "xDeJht") return key === "half-eaten";
      if (stepId === "NuanCj") return key === "gnome";
      if (stepId === "xED9Ci") return key === "other";
      if (stepId === "3nXpnK") return key === "inedible";
      if (stepId === "5KtWbx") return food?.accepted === false;
      if (stepId === "_9qyGz") return food?.accepted === true;
      return null;
    }

    if (npcId === BONEGUARD2_NPC_ID) {
      if (stepId === "GtbjJ2") return !protectFromMelee(player);
      if (stepId === "EgNB8X") return protectFromMelee(player);
      return null;
    }

    return null;
  }

  /** Answer a lost-limb condition and hand the limb back when it applies. */
  function recoverLimb(player, limbId, bit) {
    if (has(player, limbId) || bankHas(player, limbId)) return false;
    if (!hasBit(player, bit)) return false;
    if (player.getInventory().getFreeSlots() > 0) player.getInventory().adds(limbId, 1);
    return true;
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  /**
   * The body hand-in transcript buries the block-size menu inside a 5-option wiki
   * "random" flavour step, so most talks dead-end on a flavour line with no menu.
   * Take the Talk-to over and turn that random into the choice it hides.
   */
  function takeOverBodyHandIn(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_BASE_PLACED || !hasAnySandstone(player)) return false;
    const request = {
      player,
      npc: event.npc,
      npcId: LAZIM_NPC_ID,
      variant: "starting-out-talking-to-lazim-while-holding-sandstone-for-the-body",
      select: bodyHandInSteps,
      handled: false,
    };
    api.emitCustomEvent("npc-dialogue:start", request);
    return request.handled;
  }

  /**
   * A dropped block leaves the quest stuck, and the transcript has Lazim hand
   * the block over again: "Here you are, adventurer. Now, use a chisel to craft
   * it into a base for the statue." (the r7_kHr branch) and "That should be
   * enough to use for the statue's body." (the PkYWDq branch). Those branches
   * are the recovery, so they are the ones that play.
   */
  function takeOverDroppedBlock(event) {
    const { player } = event;
    const recovery = droppedBlockRecovery(player);
    if (!recovery) return false;
    if (!give(player, recovery.item, 1)) return false;
    const request = {
      player,
      npc: event.npc,
      npcId: LAZIM_NPC_ID,
      variant: recovery.variant,
      select: (steps) => {
        const found = [];
        const walk = (list) => {
          for (const step of list ?? []) {
            if (!step) continue;
            if (step.id === recovery.conditionId) {
              found.push(step);
              return;
            }
            for (const option of step.options ?? []) walk(option.steps);
            walk(step.steps);
          }
        };
        walk(steps);
        return found;
      },
      handled: false,
    };
    api.emitCustomEvent("npc-dialogue:start", request);
    return request.handled;
  }

  /** The block the player still needs but no longer carries, if any. */
  function droppedBlockRecovery(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BASE_PLACED
      && attrNumber(player, ATTR_BASE_KG) >= 32
      && !has(player, SANDSTONE_32KG) && !bankHas(player, SANDSTONE_32KG)
      && !has(player, SANDSTONE_BASE)) {
      return {
        item: SANDSTONE_32KG,
        variant: "starting-out-talking-to-lazim-while-holding-sandstone-for-the-base",
        conditionId: "r7_kHr",
      };
    }
    if (stage < STAGE_BODY_PLACED
      && attrNumber(player, ATTR_BODY_KG) >= 20
      && !has(player, SANDSTONE_20KG) && !bankHas(player, SANDSTONE_20KG)
      && !has(player, SANDSTONE_BODY)) {
      return {
        item: SANDSTONE_20KG,
        variant: "starting-out-talking-to-lazim-while-holding-sandstone-for-the-body",
        conditionId: "PkYWDq",
      };
    }
    return null;
  }

  /** Lazim's talk: hand a dropped block back, or take over the body hand-in. */
  function talkToLazim(event) {
    return takeOverDroppedBlock(event) || takeOverBodyHandIn(event);
  }

  /** Replace the body hand-in variant's 5-option flavour random with its Yes/No menu. */
  function bodyHandInSteps(steps) {
    return (steps ?? []).map((step) => {
      if (step.type === "random" && (step.options ?? []).some((option) => option.text === "Yes, I have more stone.")) {
        return {
          ...step,
          type: "choice",
          options: (step.options ?? []).filter((option) => !/^Dialogue \d+$/i.test(String(option.text ?? "").trim())),
        };
      }
      if (Array.isArray(step.options)) {
        return { ...step, options: step.options.map((option) => ({ ...option, steps: bodyHandInSteps(option.steps) })) };
      }
      if (Array.isArray(step.steps)) return { ...step, steps: bodyHandInSteps(step.steps) };
      return step;
    });
  }

  function handleDialogueLine(request) {
    if (request?.npcId !== LAZIM_NPC_ID || typeof request.text !== "string") return;
    if (quest.getStage(request.player) === STAGE_IN_TEMPLE &&
        request.text === "Be thankful they're the statue's limbs and not yours, adventurer.") {
      request.after = () => {
        if (quest.getStage(request.player) === STAGE_IN_TEMPLE) {
          quest.setStage(request.player, STAGE_TEMPLE_BRIEFED);
        }
      };
    }
    if (quest.getStage(request.player) >= STAGE_COMPLETE && attrNumber(request.player, ATTR_POST_QUEST) === 0 &&
        [
          "What did you expect from a Zamorakian mage?",
          "I'm a mage of Zamorak, after all. What else do you expect?",
        ].includes(request.text)) {
      request.after = () => setAttrNumber(request.player, ATTR_POST_QUEST, 1);
    }
    // "I need [X] kg more" wants what is still missing; the "carrying" flavour wants what was handed in.
    if (request.text.includes("[1-32]")) {
      const base = attrNumber(request.player, ATTR_BASE_KG);
      request.text = request.text.replace("[1-32]", String(/more/i.test(request.text) ? Math.max(0, 32 - base) : base));
    }
    if (request.text.includes("[1-20]")) {
      const body = attrNumber(request.player, ATTR_BODY_KG);
      request.text = request.text.replace("[1-20]", String(/more/i.test(request.text) ? Math.max(0, 20 - body) : body));
    }
  }

  function handleChoice(event) {
    const { player, stepId, option } = event;
    if (event.npcId === LAZIM_NPC_ID) {
      handleLazimChoice(player, stepId, String(option ?? ""));
      return;
    }
    if (event.npcId === BONEGUARD2_NPC_ID) {
      const text = String(option ?? "");
      if (text === "Okay, I'll start building." || text === "Of course, I'll help you out.") {
        if (quest.getStage(player) >= STAGE_BONEGUARD1) advanceTo(player, STAGE_WALL_AGREED);
      }
    }
  }

  function handleLazimChoice(player, stepId, option) {
    if (stepId === "u5ihBN" || stepId === "0uv69v" || stepId === "D9Ee_i" || stepId === "6LjurH") {
      handInSandstone(player, itemForBaseChoice(stepId), true);
      return;
    }
    if (stepId === "teyOME" || stepId === "kAy4qp" || stepId === "0K-Gyp" || stepId === "pQQspU") {
      handInSandstone(player, itemForBodyChoice(stepId), false);
      return;
    }
    if (stepId === "M6XzRN") return takeLimb(player, LEFT_ARM, BIT_LEFT_ARM);
    if (stepId === "arsdof") return takeLimb(player, RIGHT_ARM, BIT_RIGHT_ARM);
    if (stepId === "61YBoM") return takeLimb(player, LEFT_LEG, BIT_LEFT_LEG);
    if (stepId === "osLsmW") return takeLimb(player, RIGHT_LEG, BIT_RIGHT_LEG);

    if (option === "Of course!" || option === "Okay, I'll get on with it.") {
      clearBit(player, BIT_DECLINED);
      if (quest.getStage(player) === STAGE_NOT_STARTED) quest.setStage(player, STAGE_STARTED);
      return;
    }
    if (option === "I don't know, that sounds like a lot of work.") {
      setBit(player, BIT_DECLINED);
      return;
    }
    const headPicks = new Map([
      ["I think it should have your head.", 1],
      ["The head of Lazim, the sculptor", 1],
      ["I'll use Zamorak's head for the statue.", 2],
      ["The head of the god Zamorak", 2],
      ["I'll use Icthlarin's head for the statue.", 3],
      ["The head of the god Icthlarin", 3],
      ["I think it should have a camel's head.", 4],
      ["The head of a camel", 4],
    ]);
    const pick = headPicks.get(option);
    if (pick !== undefined) {
      setAttrNumber(player, ATTR_HEAD_CHOICE, pick);
      if (option.startsWith("The head of ")) {
        // Carving from the granite reminder menu: consume the block and make it.
        if (!has(player, GRANITE_5KG)) return;
        take(player, GRANITE_5KG, 1);
        if (give(player, HEAD_ITEM_BY_CHOICE.get(pick), 1)) {
          setAttrNumber(player, ATTR_HEAD_MADE, pick);
          advanceTo(player, STAGE_HEAD_MADE);
        }
      }
      return;
    }
    if (option === "Do you know where the statue's head is?" && quest.getStage(player) >= STAGE_TEMPLE_BRIEFED) {
      if (!hasOriginalHead(player) && !bankHasAny(player, ORIGINAL_HEAD_IDS)
        && !has(player, HEAD_CAVITY) && !bankHas(player, HEAD_CAVITY)) {
        const item = HEAD_ITEM_BY_CHOICE.get(headMade(player));
        if (item !== undefined && give(player, item, 1)) {
          player.sendMessage("Lazim hands you the statue's head.");
        }
      }
      return;
    }
    if (option === "Okay, here's one million coins.") {
      if (has(player, COINS, 1000000)) {
        take(player, COINS, 1000000);
        setAttrNumber(player, ATTR_CAMULET_UNLIMITED, 1);
        player.sendMessage("Lazim mutters a spell over the Camulet.");
      }
    }
  }

  function itemForBaseChoice(stepId) {
    return {
      u5ihBN: SANDSTONE_10KG,
      "0uv69v": SANDSTONE_5KG,
      D9Ee_i: SANDSTONE_2KG,
      "6LjurH": SANDSTONE_1KG,
    }[stepId];
  }

  function itemForBodyChoice(stepId) {
    return {
      teyOME: SANDSTONE_10KG,
      kAy4qp: SANDSTONE_5KG,
      "0K-Gyp": SANDSTONE_2KG,
      pQQspU: SANDSTONE_1KG,
    }[stepId];
  }

  /** Take one offered sandstone block and advance the base/body hand-in. */
  function handInSandstone(player, itemId, base) {
    if (quest.getStage(player) < STAGE_STARTED) return;
    if (!itemId || !has(player, itemId)) return;
    const key = base ? ATTR_BASE_KG : ATTR_BODY_KG;
    const target = base ? 32 : 20;
    if (attrNumber(player, key) >= target) return;
    if (has(player, base ? SANDSTONE_BASE : SANDSTONE_BODY)) return;
    take(player, itemId, 1);
    const total = attrNumber(player, key) + SANDSTONE_KG_BY_ITEM.get(itemId);
    setAttrNumber(player, key, total);
    if (total >= target) {
      const block = base ? SANDSTONE_32KG : SANDSTONE_20KG;
      if (give(player, block, 1)) {
        quest.setStage(player, base ? STAGE_BASE_BLOCK : STAGE_BODY_BLOCK);
      }
    }
  }

  function takeLimb(player, limbId, bit) {
    if (quest.getStage(player) < STAGE_TEMPLE_BRIEFED) return;
    if (hasBit(player, bit) || has(player, limbId)) return;
    if (!give(player, limbId, 1)) return;
    setBit(player, bit);
    if ((bits(player) & ALL_LIMB_BITS) === ALL_LIMB_BITS) advanceTo(player, STAGE_LIMBS_TAKEN);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    if (stepId === "ARRUvf") {
      event.handled = true;
      setBit(player, BIT_HEAD_PLACED);
      advanceTo(player, STAGE_IN_TEMPLE);
      ensureTempleNpcs(player);
      player.moveTo(new Location(TEMPLE_ARRIVAL_TILE.x, TEMPLE_ARRIVAL_TILE.y, TEMPLE_ARRIVAL_TILE.z));
      return;
    }
    if (stepId === "HPMCYO") {
      event.handled = true;
      const steps = variantSteps("starting-out-talking-to-lazim-after-creating-a-head");
      if (steps) event.steps = steps;
      return;
    }
    if (stepId === "AdRB_B" && event.npcId === BONEGUARD_NPC_ID) {
      if (!hasBit(player, BIT_BONEGUARD_MET)) {
        setBit(player, BIT_BONEGUARD_MET);
        return;
      }
      player.sendMessage("You need to cast Crumble Undead on the boneguard.");
      return;
    }
    if (stepId === "tAjTwX") {
      transformBoneguard(player);
      return;
    }
    if (stepId === "qyIeWP" || stepId === "Nbd15u") {
      event.handled = true;
      const steps = variantSteps("middle-floor-of-enakhra-s-temple-enakhra-cutscene");
      if (steps) event.steps = steps;
      return;
    }
    if (stepId === "qFz3o_") {
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) >= STAGE_WALL_BUILT && !quest.isComplete(player)) {
        quest.complete(player);
        // The cutscene ends with Akthanakos and Enakhra leaving for the North.
        removeQuestNpc(player, AKTHANAKOS_NPC_ID);
        removeQuestNpc(player, ENAKHRA_NPC_ID);
      }
      return;
    }
    if (stepId === "BNC2HB") {
      // Message step: hand the Camulet back but let the words through.
      if (!has(player, CAMULET) && player.getInventory().getFreeSlots() > 0) {
        player.getInventory().adds(CAMULET, 1);
      }
    }
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player } = event;
    const a = event.usedItemId;
    const b = event.usedWithItemId;
    const withChisel = a === CHISEL ? b : b === CHISEL ? a : undefined;
    if (withChisel === undefined) return;
    if (withChisel === SANDSTONE_32KG) {
      event.handled = true;
      if (!has(player, SANDSTONE_32KG)) return;
      take(player, SANDSTONE_32KG, 1);
      if (give(player, SANDSTONE_BASE, 1)) {
        advanceTo(player, STAGE_BASE_MADE);
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "starting-out-using-chisel-on-the-sandstone-32kg");
      }
      return;
    }
    if (withChisel === SANDSTONE_20KG) {
      event.handled = true;
      if (!has(player, SANDSTONE_20KG)) return;
      take(player, SANDSTONE_20KG, 1);
      if (give(player, SANDSTONE_BODY, 1)) {
        advanceTo(player, STAGE_BODY_MADE);
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "starting-out-using-chisel-on-the-sandstone-20kg");
      }
      return;
    }
    const split = SANDSTONE_SPLITS.get(withChisel);
    if (split) {
      event.handled = true;
      if (!has(player, withChisel)) return;
      const outputSlots = split.reduce((total, [, amount]) => total + amount, 0);
      const additionalSlots = outputSlots - 1; // Chiseling frees the source block's slot.
      if (player.getInventory().getFreeSlots() < additionalSlots) {
        player.sendMessage("You don't have enough inventory space.");
        return;
      }
      take(player, withChisel, 1);
      for (const [piece, amount] of split) player.getInventory().adds(piece, amount);
      return;
    }
    if (withChisel === GRANITE_5KG) {
      event.handled = true;
      if (!has(player, GRANITE_5KG)) return;
      if (has(player, CAMEL_MOULD)) {
        // Middle-floor pedestal mould: chisel the granite to match the recess.
        take(player, GRANITE_5KG, 1);
        take(player, CAMEL_MOULD, 1);
        if (give(player, HEAD_CAVITY, 1)) {
          startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-chisel-on-granite-5kg-while-holding-the-mould");
        }
        return;
      }
      if (quest.getStage(player) < STAGE_STATUE_CHISELLED) return;
      // Which head to carve (the option branches are dump gaps; the pick sets it).
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "starting-out-using-chisel-on-the-granite-5kg", stripOptionSteps);
    }
  }

  /** Blank every choice option's body (the dump has no text for those branches). */
  function stripOptionSteps(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.map((step) => {
      const copy = { ...step };
      if (Array.isArray(copy.options)) {
        copy.options = copy.options.map((option) => ({ ...option, steps: [] }));
      }
      if (Array.isArray(copy.steps)) copy.steps = stripOptionSteps(copy.steps);
      return copy;
    });
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (objectId === FLAT_GROUND && itemId === SANDSTONE_BASE) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_BASE_MADE || !has(player, SANDSTONE_BASE)) return;
      take(player, SANDSTONE_BASE, 1);
      advanceTo(player, STAGE_BASE_PLACED);
      return;
    }
    if ((objectId === HEADLESS_STATUE_1 || objectId === HEADLESS_STATUE_2) && itemId === SANDSTONE_BODY) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_BODY_MADE || !has(player, SANDSTONE_BODY)) return;
      take(player, SANDSTONE_BODY, 1);
      advanceTo(player, STAGE_BODY_PLACED);
      return;
    }
    if (isStatueObject(objectId) && isChiselItem(itemId)) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_BODY_PLACED) return;
      advanceTo(player, STAGE_STATUE_CHISELLED);
      return;
    }
    if (isStatueObject(objectId) && ORIGINAL_HEAD_IDS.has(itemId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_HEAD_MADE || !has(player, itemId)) return;
      if (headMade(player) !== headChoice(player) || !hasBit(player, BIT_HEAD_TOLD)) {
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "starting-out-using-the-head-on-the-statue-before-talking-to-lazim");
        return;
      }
      take(player, itemId, 1);
      setBit(player, BIT_HEAD_PLACED);
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "starting-out-using-the-head-on-the-statue-after-confirming-it-with-lazim");
      return;
    }
    if (FALLEN_STATUE_IDS.has(objectId) && isChiselItem(itemId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_TEMPLE_BRIEFED) return;
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "bottom-floor-of-enakhra-s-temple-using-chisel-on-the-fallen-statue", stripOptionSteps);
      return;
    }
    if (objectId === PEDESTAL || objectId === PEDESTAL_HEAD) {
      handlePedestalItem(event);
      return;
    }
    if (WALL_IDS.has(objectId)) {
      handleWallItem(event);
      return;
    }
    const brazier = BRAZIERS_BY_TILE.get(tileKey(event.location));
    if (brazier) {
      event.handled = true;
      if (brazier.fuel !== itemId || !has(player, itemId)) return;
      take(player, itemId, 1);
      lightBrazier(player, brazier);
    }
  }

  function isStatueObject(objectId) {
    return objectId === HEADLESS_STATUE_1 || objectId === HEADLESS_STATUE_2 || objectId === HEADLESS_STATUE_3;
  }

  function isChiselItem(itemId) {
    if (itemId === CHISEL) return true;
    const definition = api.core.CacheDefinitions?.getItem?.(itemId);
    return PICKAXE_NAMES.test(String(definition?.name ?? ""));
  }

  function handlePedestalItem(event) {
    const { player, itemId } = event;
    if (itemId === SOFT_CLAY) {
      event.handled = true;
      if (!has(player, SOFT_CLAY)) return;
      if (quest.getStage(player) >= STAGE_COMPLETE && hasBit(player, BIT_MOULD)) {
        take(player, SOFT_CLAY, 1);
        give(player, CAMEL_MASK, 1);
        return;
      }
      if (quest.getStage(player) < STAGE_INNER_OPEN) return;
      take(player, SOFT_CLAY, 1);
      if (!give(player, CAMEL_MOULD, 1)) return;
      setBit(player, BIT_MOULD);
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-soft-clay-on-the-pedestal");
      return;
    }
    if (itemId === HEAD_CAVITY) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_INNER_OPEN || !has(player, HEAD_CAVITY)) return;
      take(player, HEAD_CAVITY, 1);
      swapPedestal(true);
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-the-stone-head-cavity-on-the-pedestal");
      advanceTo(player, STAGE_PEDESTAL_DONE);
      checkGlobes(player);
      return;
    }
    if (ORIGINAL_HEAD_IDS.has(itemId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_INNER_OPEN) return;
      setBit(player, BIT_TRIED_HEAD);
    }
  }

  function handleWallItem(event) {
    const { player, itemId } = event;
    if (itemId === SANDSTONE_5KG) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_WALL_AGREED || !has(player, SANDSTONE_5KG)) return;
      if (hasBit(player, BIT_WALL_PLACED)) return;
      take(player, SANDSTONE_5KG, 1);
      setBit(player, BIT_WALL_PLACED);
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-sandstone-on-the-wall");
      return;
    }
    if (isChiselItem(itemId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_WALL_AGREED || !hasBit(player, BIT_WALL_PLACED)) return;
      clearBit(player, BIT_WALL_PLACED);
      const placed = attrNumber(player, ATTR_WALL_TAKEN) + 1;
      setAttrNumber(player, ATTR_WALL_TAKEN, placed);
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-chisel-on-the-wall");
      if (placed >= 3) {
        advanceTo(player, STAGE_WALL_BUILT);
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-finishing-the-wall");
      }
    }
  }

  function handleItemOnNpc(event) {
    if (event.npcId !== PENTYN_NPC_ID) return;
    const { player, itemId } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_INNER_OPEN || hasBit(player, BIT_BLOOD)) return;
    const category = foodCategory(itemId);
    const accepted = category === "bread" || category === "pie" || category === "pizza"
      || category === "cake" || category === "potato-topping";
    pentynFood.set(player, { key: category, accepted });
    if (accepted) {
      take(player, itemId, 1);
      setBit(player, BIT_BLOOD);
      checkGlobes(player);
    }
    startTranscript(api, player, PENTYN_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-food-on-pentyn");
  }

  function foodCategory(itemId) {
    const name = String(api.core.CacheDefinitions?.getItem?.(itemId)?.name ?? "");
    for (const [category, pattern] of FOOD_NAME_PATTERNS) {
      if (pattern.test(name)) return category;
    }
    if (itemId === BREAD) return "bread";
    if (PIZZA_IDS.has(itemId)) return "pizza";
    if (CAKE_IDS.has(itemId)) return "cake";
    if (itemId === ItemIdentifiers.BAKED_POTATO) return "potato";
    if (POTATO_TOPPING_IDS.has(itemId)) return "potato-topping";
    if (itemId === ItemIdentifiers.CABBAGE) return "cabbage";
    if ([1942, 1957, 1982].includes(itemId)) return "vegetable";
    if ([2140, 2142, 315, 325, 333, 379, 329, 361].includes(itemId)) return "meat";
    if ([1865, 1877, 2112, 2114, 2116, 2118, 2120].includes(itemId)) return "gnome";
    if ([2291, 2295, 2299, 2303, 1893, 1895, 1899, 1901].includes(itemId)) return "half-eaten";
    return "other";
  }

  // ==========================================================================
  // Spells, objects and doors
  // ==========================================================================

  function handleSpellOnNpc(event) {
    const { player, npcId, spellId } = event;
    if (!player) return;
    let action = null;
    if (npcId === BONEGUARD_NPC_ID && spellId === CRUMBLE_UNDEAD_SPELL_ID) action = "boneguard";
    if (npcId === FURNACE_GRATE_NPC_ID && WIND_BOLT_OR_HIGHER_SPELL_IDS.has(spellId)) action = "furnace";
    if (npcId === CRUST_OF_ICE_NPC_ID && FIRE_BOLT_OR_HIGHER_SPELL_IDS.has(spellId)) action = "ice";
    if (!action || quest.getStage(player) < STAGE_INNER_OPEN) return;
    if ((action === "boneguard" && !hasBit(player, BIT_BONEGUARD_MET)) ||
        (action === "furnace" && hasBit(player, BIT_SMOKE)) ||
        (action === "ice" && hasBit(player, BIT_ICE))) return;
    let pending = pendingSpellTargets.get(player);
    if (!pending) {
      pending = new Set();
      pendingSpellTargets.set(player, pending);
    }
    const npc = event.npc;
    if (!npc || pending.has(npc)) return;
    if (!event.consumeRunes()) return;
    event.handled = true;
    pending.add(npc);
    const combat = player.getCombat();
    const previousSpell = combat.getCastSpell();
    combat.setCastSpell(event.spell);
    let accurate;
    try {
      accurate = api.core.AccuracyFormulasDpsCalc.rollAccuracy(
        player,
        npc,
        api.core.CombatType.MAGIC,
      );
    } finally {
      combat.setCastSpell(previousSpell);
    }
    const delay = api.core.MagicCombatMethod.hitDelay(player, npc, event.spell);
    api.core.TaskManager.submit(new api.core.CountdownTask(npc, delay, () => {
      pending.delete(npc);
      if (!player.isRegistered() || !npc.isRegistered() || npc.getOwner() !== player ||
          quest.getStage(player) < STAGE_INNER_OPEN ||
          (action === "boneguard" && (!hasBit(player, BIT_BONEGUARD_MET) || npc.getId() !== BONEGUARD_NPC_ID)) ||
          (action === "furnace" && hasBit(player, BIT_SMOKE)) ||
          (action === "ice" && (hasBit(player, BIT_ICE) || npc.getId() !== CRUST_OF_ICE_NPC_ID))) return;
      if (!accurate) {
        npc.performGraphic(api.core.MagicCombatMethod.SPLASH_GRAPHIC);
        api.core.Sounds.sendSound(player, api.core.Sound.SPELL_FAIL_SPLASH);
        return;
      }
      const endGraphic = event.spell.endGraphic();
      if (endGraphic) npc.performGraphic(endGraphic);
      const impactSound = event.spell.impactSound();
      if (impactSound) api.core.Sounds.sendSound(npc, impactSound);
      if (action === "boneguard") {
        removeQuestNpc(player, BONEGUARD_NPC_ID);
        advanceTo(player, STAGE_BONEGUARD1);
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-casting-crumble-undead-on-the-boneguard");
      } else if (action === "furnace") {
        setBit(player, BIT_SMOKE);
        checkGlobes(player);
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-casting-wind-bolt-blast-wave-or-surge-on-furnace-grate");
      } else {
        setBit(player, BIT_ICE);
        removeQuestNpc(player, CRUST_OF_ICE_NPC_ID);
        ensureObject(FOUNTAIN, FOUNTAIN_TILE);
        checkGlobes(player);
        startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-cast-fire-bolt-blast-wave-or-surge-on-crust-of-ice");
      }
    }));
  }

  function lightBrazier(player, brazier) {
    brazierContext.set(player, brazier);
    setBit(player, brazier.bit);
    if ((bits(player) & BIT_BRAZIERS) === BIT_BRAZIERS) {
      setBit(player, BIT_SHADOW);
      checkGlobes(player);
    }
    startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-using-items-on-braziers");
  }

  function checkGlobes(player) {
    if (quest.getStage(player) < STAGE_PEDESTAL_DONE) return;
    if ((bits(player) & BIT_GLOBES) !== BIT_GLOBES) return;
    advanceTo(player, STAGE_ELEMENTS_DONE);
  }

  function takeSigil(event) {
    const sigil = SIGIL_PEDESTALS.get(event.objectId);
    if (sigil === undefined) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_IN_TEMPLE || has(player, sigil)) return;
    if (!give(player, sigil, 1)) return;
    startTranscript(api, player, LAZIM_NPC_ID, PAGE, "bottom-floor-of-enakhra-s-temple-take-sigil-from-pedestal");
  }

  function takeRubble(event) {
    if (event.objectId !== RUBBLE) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_WALL_AGREED) return;
    if (attrNumber(player, ATTR_WALL_TAKEN) >= 3 && !has(player, SANDSTONE_5KG)) return;
    give(player, SANDSTONE_5KG, 1);
  }

  function investigateBrazier(event) {
    const brazier = BRAZIERS_BY_TILE.get(tileKey(event.location));
    if (!brazier) return;
    event.handled = true;
    const { player } = event;
    if (player.getSkillManager().getMaxLevel(Skill.FIREMAKING) < 45) return;
    brazierContext.set(player, brazier);
    startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-investigating-braziers");
  }

  function passBarrier(event) {
    if (event.objectId !== MAGIC_BARRIER) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_ELEMENTS_DONE) {
      player.sendMessage("The barrier repels you.");
      return;
    }
    startTranscript(api, player, LAZIM_NPC_ID, PAGE, "middle-floor-of-enakhra-s-temple-pass-through-magic-barrier");
  }

  /** Climb a temple sand pile: it unlocks that tunnel's surface entrance. */
  function climbSandPile(event) {
    const entrance = SAND_PILE_EXITS.get(tileKey(event.location));
    if (!entrance) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_IN_TEMPLE) return;
    unlockEntrance(player, entrance);
    player.moveTo(new Location(entrance.surface.x, entrance.surface.y, entrance.surface.z));
  }

  /** Climb down a secret entrance back into the tunnel it belongs to. */
  function enterTemple(event) {
    if (!SECRET_ENTRANCE_IDS.has(event.objectId)) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_IN_TEMPLE) return;
    const surface = tileKey(event.location);
    const entrance = SECRET_ENTRANCES.find((entry) => tileKey(entry.surface) === surface);
    if (!entrance) return;
    if ((entrances(player) & ENTRANCE_BITS[entrance.key]) === 0) return;
    const [x, y] = entrance.pile.split(",").map(Number);
    player.moveTo(new Location(x, y, 1));
  }

  /**
   * The four temple ladders (11041 up, 11042 down, 11043/11044 stone) sit next
   * to their room's sand pile; using one unlocks that room's surface entrance.
   */
  function handleLadderClimb(event) {
    const { player, object } = event;
    if (!player || !object) return;
    if (quest.getStage(player) < STAGE_IN_TEMPLE) return;
    const tile = tileKey(object.getLocation?.());
    const entrance = SECRET_ENTRANCES.find((entry) => entry.ladder === tile);
    if (!entrance) return;
    unlockEntrance(player, entrance);
  }

  function handleDoorToggle(request) {
    const { player, objectId, object } = request;
    if (!player || !object) return;
    const limbDoor = LIMB_DOORS.get(objectId);
    if (limbDoor) {
      request.handled = true;
      if (quest.getStage(player) < STAGE_IN_TEMPLE || hasBit(player, limbDoor.bit)) return;
      if (!has(player, limbDoor.item)) {
        player.sendMessage("The door has an odd-shaped lock. It looks like it needs a large stone limb.");
        return;
      }
      take(player, limbDoor.item, 1);
      setBit(player, limbDoor.bit);
      openObject(object, objectId + 1);
      if ((bits(player) & BIT_LIMB_DOOR_BITS) === BIT_LIMB_DOOR_BITS) advanceTo(player, STAGE_DOORS_OPEN);
      startTranscript(api, player, LAZIM_NPC_ID, PAGE, limbDoor.variant);
      return;
    }
    const innerDoor = INNER_DOORS.get(objectId);
    if (innerDoor === undefined) return;
    request.handled = true;
    if (quest.getStage(player) < STAGE_DOORS_OPEN || hasBit(player, innerDoor.bit)) return;
    if (!has(player, innerDoor.sigil)) {
      player.sendMessage("The door has no handle or keyhole. It looks like it needs a sigil.");
      return;
    }
    take(player, innerDoor.sigil, 1);
    setBit(player, innerDoor.bit);
    openObject(object, innerDoor.openId);
    advanceTo(player, STAGE_INNER_OPEN);
    startTranscript(api, player, LAZIM_NPC_ID, PAGE, "bottom-floor-of-enakhra-s-temple-placing-sigil-in-the-door");
  }

  // ==========================================================================
  // World state
  // ==========================================================================

  function ensureObject(id, tile, type = 10, face = 0) {
    const location = new Location(tile.x, tile.y, tile.z ?? 0);
    for (const object of ObjectManager.objectsAt(location)) {
      if (object.getId() === id) return;
    }
    ObjectManager.register(new GameObject(id, location, type, face, null), true);
  }

  function clearObjectsAt(tile, ids) {
    const location = new Location(tile.x, tile.y, tile.z ?? 0);
    for (const object of [...ObjectManager.objectsAt(location)]) {
      if (ids.has(object.getId())) ObjectManager.deregister(object, true);
    }
  }

  function swapPedestal(headPlaced) {
    clearObjectsAt(PEDESTAL_TILE, new Set([PEDESTAL, PEDESTAL_HEAD]));
    ensureObject(headPlaced ? PEDESTAL_HEAD : PEDESTAL, PEDESTAL_TILE);
  }

  function openObject(object, openId) {
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(openId, object.getLocation().clone(), object.getType(), object.getFace(), null),
      true
    );
  }

  function npcNear(id, tile, owner) {
    const world = api.getWorld();
    if (!world?.getNpcs) return null;
    for (const npc of world.getNpcs()) {
      if (npc?.getId?.() !== id) continue;
      const npcOwner = npc.getOwner?.();
      if (owner && npcOwner && npcOwner !== owner) continue;
      const location = npc.getLocation?.();
      if (!location) continue;
      if (
        Math.abs(location.getX() - tile.x) <= 2 &&
        Math.abs(location.getY() - tile.y) <= 2 &&
        location.getZ() === (tile.z ?? 0)
      ) {
        return npc;
      }
    }
    return null;
  }

  /**
   * The temple's NPCs are owner-scoped: core hides an owner-only NPC from
   * everybody else, so freeing a boneguard or melting the ice for one player
   * no longer takes the puzzle away from the others.
   */
  function ensureQuestNpc(player, id, tile, wanderRadius = 0) {
    const map = playerNpcs.get(player) ?? new Map();
    playerNpcs.set(player, map);
    const existing = map.get(id);
    if (existing && !existing.isRemoved?.()) return existing;
    const npc = api.spawnNpc({
      id, x: tile.x, y: tile.y, z: tile.z ?? 0, wanderRadius, owner: player, ownerOnly: true,
    });
    map.set(id, npc);
    return npc;
  }

  function removeQuestNpc(player, id) {
    const map = playerNpcs.get(player);
    const npc = map?.get(id);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(id);
  }

  /** The NPCs this player's temple holds right now. */
  function ensureTempleNpcs(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_IN_TEMPLE) return;
    if (stage >= STAGE_COMPLETE) return;
    ensureQuestNpc(player, LAZIM_NPC_ID, LAZIM_TEMPLE_TILE);
    ensureQuestNpc(player, ENAKHRA_NPC_ID, ENAKHRA_TILE);
    if (stage < STAGE_BONEGUARD1) ensureQuestNpc(player, BONEGUARD_NPC_ID, BONEGUARD1_TILE);
    if (stage < STAGE_WALL_BUILT) ensureQuestNpc(player, BONEGUARD2_NPC_ID, BONEGUARD2_TILE);
    if (stage >= STAGE_INNER_OPEN) {
      if (!hasBit(player, BIT_ICE)) ensureQuestNpc(player, CRUST_OF_ICE_NPC_ID, CRUST_TILE);
      if (!hasBit(player, BIT_SMOKE)) ensureQuestNpc(player, FURNACE_GRATE_NPC_ID, FURNACE_GRATE_TILE);
    }
  }

  function installWorld() {
    if (worldInstalled) return;
    worldInstalled = true;
    ensureObject(PEDESTAL, PEDESTAL_TILE);
    for (const key of BRAZIERS_BY_TILE.keys()) {
      const [x, y] = key.split(",").map(Number);
      ensureObject(BRAZIER, { x, y, z: 1 });
    }
    ensureObject(RUBBLE, RUBBLE_TILE);
    // The surface Lazim is shared; every other temple NPC is owner-scoped.
    if (!npcNear(LAZIM_NPC_ID, LAZIM_SURFACE_TILE)) {
      api.spawnNpc({ id: LAZIM_NPC_ID, x: LAZIM_SURFACE_TILE.x, y: LAZIM_SURFACE_TILE.y, z: 0 });
    }
  }

  function transformBoneguard(player) {
    removeQuestNpc(player, BONEGUARD2_NPC_ID);
    ensureQuestNpc(player, AKTHANAKOS_NPC_ID, BONEGUARD2_TILE);
  }

  function handleLogin({ player }) {
    installWorld();
    ensureTempleNpcs(player);
    sendAuxVarbits(player);
    refreshQuestList(player);
  }

  function cleanupPlayerTemple({ player }) {
    pendingSpellTargets.delete(player);
    const npcs = playerNpcs.get(player);
    if (!npcs) return;
    for (const npc of npcs.values()) api.removeNpc(npc);
    npcs.clear();
    playerNpcs.delete(player);
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 7000);
    player.getSkillManager().addExperiences(Skill.MINING, 7000);
    player.getSkillManager().addExperiences(Skill.FIREMAKING, 7000);
    player.getSkillManager().addExperiences(Skill.MAGIC, 7000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  /** Internal stage -> native milestone Quest Helper expects in varbit 1560. */
  function questVarbitValue(stage) {
    if (stage >= STAGE_COMPLETE) return COMPLETE_VARBIT_VALUE;
    if (stage >= STAGE_WALL_AGREED) return VARBIT_VALUE_WALL;
    if (stage >= STAGE_BONEGUARD1) return VARBIT_VALUE_BONEGUARD2;
    if (stage >= STAGE_ELEMENTS_DONE) return VARBIT_VALUE_TOP_FLOOR;
    if (stage >= STAGE_PEDESTAL_DONE) return VARBIT_VALUE_PUZZLES;
    if (stage >= STAGE_IN_TEMPLE) return VARBIT_VALUE_GROUND_FLOOR;
    if (stage >= STAGE_STARTED) return VARBIT_VALUE_STATUE;
    return 0;
  }

  quest = registerQuest(api, {
    key: "enakhras_lament",
    name: "Enakhra's Lament",
    varpId: VARP_ENAKH,
    varbitId: VARBIT_ENAKH_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    varbitValue: questVarbitValue,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 7000, label: "Crafting" },
      { skillId: Skill.MINING.getIndex(), amount: 7000, label: "Mining" },
      { skillId: Skill.FIREMAKING.getIndex(), amount: 7000, label: "Firemaking" },
      { skillId: Skill.MAGIC.getIndex(), amount: 7000, label: "Magic" },
    ],
    rewardItemId: CAMULET,
    rewardItemLabel: "1 Camulet",
    otherRewards: ["A camel mask can be made at the temple pedestal"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(ATTR_BITS);
  api.persistAttribute(ATTR_BASE_KG);
  api.persistAttribute(ATTR_BODY_KG);
  api.persistAttribute(ATTR_HEAD_CHOICE);
  api.persistAttribute(ATTR_HEAD_MADE);
  api.persistAttribute(ATTR_WALL_TAKEN);
  api.persistAttribute(ATTR_POST_QUEST, 0);
  api.persistAttribute(ATTR_CAMULET_UNLIMITED);
  api.persistAttribute(ATTR_ENTRANCES, 0);

  api.onServerStartup(installWorld);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(cleanupPlayerTemple);
  api.onCustomEvent("quest:stage-changed", sendAuxOnStageChanged);
  api.onCustomEvent("player:bootstrap-complete", sendAuxOnBootstrap);
  api.onCustomEvent("ladders:climb", handleLadderClimb);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(handleItemOnNpc);
  api.onSpellOnNpc(handleSpellOnNpc);
  api.onNpcInteraction("Lazim", { "Talk-to": talkToLazim });
  api.onObjectInteraction("Pedestal", { "Take-sigil": takeSigil });
  api.onObjectInteraction("Rubble", { "Take-rock": takeRubble });
  api.onObjectInteraction("Brazier", { Investigate: investigateBrazier });
  api.onObjectInteraction("Magic barrier", { "Pass-through": passBarrier });
  api.onObjectInteraction("Sand pile", { Climb: climbSandPile });
  api.onObjectInteraction("Secret entrance", { "Climb-down": enterTemple });
};
