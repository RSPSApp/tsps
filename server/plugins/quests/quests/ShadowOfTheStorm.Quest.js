/**
 * Shadow of the Storm (members), as the user's revision 242 capture plays the whole quest
 * (ShadowOfTheStorm.bin; docs/quests/shadow-of-the-storm/README.md has the stages, varbits, scenes
 * and recorded differences, with ticks). Words are the Wiki's "Shadow of the Storm" transcript with
 * osrsreboxed-db's correction for what the capture adds; ids come from the cache.
 *
 *   0  not started          40 Denath explained      90 Denath sent back
 *   10 started (Reen)        50 Matthew told          100 Tanya killed
 *   20 told to infiltrate    60 golem told            110 Matthew: "here we go"
 *   30 in the group          70 book shown            120 Agrith-Naar summoned
 *                            80 the ritual called     124 killed / 130 complete (125 on the wire)
 *
 * The stage is varbit 1372 agrith_quest; its siblings hold the incantation (1373-1377, drawn per
 * player), the kiln (1378), the golem (1379), Dave (1380), Badden (1381) and Reen (1382), whose values
 * also choose the world's Uzer copies and their walking copies (cache transforms).
 *
 * The throne room is a private area at the source coordinates, one per visit (live: an instance);
 * each cutscene is a phase of it. Rsprox 3333 and 572, which the earlier plugin was built from, agree
 * where they recorded the same step.
 */
const CameraShake = require("../../interface/CameraShake.plugin");

module.exports = function registerShadowOfTheStormQuest(api) {
  const {
    Animation,
    CombatMethod,
    CombatType,
    CountdownTask,
    Flag,
    Graphic,
    GraphicHeight,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcDefinition,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    PendingHit,
    PrayerHandler,
    Projectile,
    RegionManager,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, startDialogue, openBook, questStartMessage } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Shadow of the Storm";
  const GOLEM_PAGE = "Clay golem";
  const START_HOOK = "quest:shadow-of-the-storm:start";

  // ============================================================================
  // Ids
  // ============================================================================

  const VARP_SHADOW_OF_THE_STORM = 602; // agrith_quest_varp
  const VARBIT_AGRITH_QUEST = 1372; // agrith_quest (stage)
  const VARBIT_INCANTATION_WORDS = [1373, 1374, 1375, 1376, 1377]; // agrith_incantation_1..5
  const VARBIT_AGRITH_KILN = 1378;
  const VARBIT_CONVINCED_GOLEM = 1379;
  const VARBIT_CONVINCED_DAVE = 1380;
  const VARBIT_BADDEN_UZER = 1381;
  const VARBIT_REEN_UZER = 1382;
  const VARBIT_GOLEM_CLAY = 348; // The Golem's golem_clay: 6277 shows at 0-4, the walker 6183 at 5

  // The recruited helpers' walking copies (cache: 914 at 1380 = 2, 915 at 1381 = 2, 916 at 1382 = 2,
  // 6183 at 348 = 5), spawned where the waiting copy stood and walked off (ours t1889, t1918, t1999, t2021).
  const DAVE_WALKING_NPC_ID = 914;
  const BADDEN_WALKING_NPC_ID = 915;
  const REEN_WALKING_NPC_ID = 916;
  const GOLEM_WALKING_NPC_ID = 6183;
  /** Where each walker heads, and how many ticks until it goes (ours: north for Dave, the stairs for the rest). */
  const WALKERS = new Map([
    ["dave", { id: DAVE_WALKING_NPC_ID, to: [2722, 4906, 0], ticks: 9 }],
    ["badden", { id: BADDEN_WALKING_NPC_ID, to: [3491, 3090, 0], ticks: 8 }],
    ["reen", { id: REEN_WALKING_NPC_ID, to: [3491, 3090, 0], ticks: 6 }],
    ["golem", { id: GOLEM_WALKING_NPC_ID, to: [3491, 3090, 0], ticks: 6 }],
  ]);

  // Legacy world spawns (npc-spawns.json) whose transforms resolve to the ids above.
  const REEN_ALKHARID_NPC_ID = 1984; // agrith_reen_alkharid -> 893
  const REEN_UZER_NPC_ID = 1985; // agrith_reen_uzer -> 893
  const BADDEN_UZER_NPC_ID = 1986; // agrith_badden_uzer -> 895
  const DAVE_AT_PORTAL_NPC_ID = 1987; // agrith_dave_at_portal -> 902
  const DAVE_IN_PASSAGE_NPC_ID = 913; // agrith_dave_in_passage -> 902
  /** The world's Uzer golem placeholder (varbit 348 -> 5134/5135/5136). */
  const GOLEM_PLACEHOLDER_NPC_ID = 6277;

  const REEN_NPC_IDS = new Set([
    NpcIdentifiers.FATHER_REEN, // 893
    NpcIdentifiers.FATHER_REEN_2, // 894
    REEN_ALKHARID_NPC_ID,
    REEN_UZER_NPC_ID,
  ]);
  const BADDEN_NPC_IDS = new Set([
    NpcIdentifiers.FATHER_BADDEN, // 895
    NpcIdentifiers.FATHER_BADDEN_2, // 896
    BADDEN_UZER_NPC_ID,
  ]);
  const DAVE_NPC_IDS = new Set([
    NpcIdentifiers.EVIL_DAVE, // 901
    NpcIdentifiers.EVIL_DAVE_2, // 902
    DAVE_AT_PORTAL_NPC_ID,
    DAVE_IN_PASSAGE_NPC_ID,
  ]);
  const DENATH_NPC_IDS = new Set([NpcIdentifiers.DENATH, NpcIdentifiers.DENATH_2]); // 897/898
  const ERIC_NPC_IDS = new Set([NpcIdentifiers.ERIC, NpcIdentifiers.ERIC_2]); // 899/900
  const MATTHEW_NPC_IDS = new Set([NpcIdentifiers.MATTHEW, NpcIdentifiers.MATTHEW_2]); // 903/904
  const JENNIFER_NPC_IDS = new Set([NpcIdentifiers.JENNIFER_2, NpcIdentifiers.JENNIFER_3]); // 905/906
  const TANYA_NPC_IDS = new Set([NpcIdentifiers.TANYA, NpcIdentifiers.TANYA_2]); // 907/908
  const PATRICK_NPC_IDS = new Set([NpcIdentifiers.PATRICK, NpcIdentifiers.PATRICK_2]); // 909/910
  const GOLEM_NPC_IDS = new Set([
    NpcIdentifiers.CLAY_GOLEM, // 917
    NpcIdentifiers.CLAY_GOLEM_2, // 918
    NpcIdentifiers.BROKEN_CLAY_GOLEM, // 5134
    NpcIdentifiers.DAMAGED_CLAY_GOLEM, // 5135
    NpcIdentifiers.CLAY_GOLEM_3, // 5136
    GOLEM_PLACEHOLDER_NPC_ID,
  ]);
  const OWN_NPC_IDS = new Set([
    ...REEN_NPC_IDS,
    ...BADDEN_NPC_IDS,
    ...DAVE_NPC_IDS,
    ...DENATH_NPC_IDS,
    ...ERIC_NPC_IDS,
    ...MATTHEW_NPC_IDS,
    ...JENNIFER_NPC_IDS,
    ...TANYA_NPC_IDS,
    ...PATRICK_NPC_IDS,
    ...GOLEM_NPC_IDS,
  ]);
  /**
   * The world's multi-NPCs and the form each shows while the quest talks through it. The transcript
   * runs as the shown form (its name is the speaker's); the head is the clicked multi-NPC (chatheadFor).
   */
  const LEGACY_NPC_CHAT_HEAD = new Map([
    [REEN_ALKHARID_NPC_ID, NpcIdentifiers.FATHER_REEN],
    [REEN_UZER_NPC_ID, NpcIdentifiers.FATHER_REEN],
    [BADDEN_UZER_NPC_ID, NpcIdentifiers.FATHER_BADDEN],
    [DAVE_AT_PORTAL_NPC_ID, NpcIdentifiers.EVIL_DAVE_2],
    [DAVE_IN_PASSAGE_NPC_ID, NpcIdentifiers.EVIL_DAVE_2],
  ]);
  /** The golem's world copy (6277) shows 5136 once repaired; its lines carry 6277 as the head (ours t339). */
  const GOLEM_CHAT_HEAD = new Map([[GOLEM_PLACEHOLDER_NPC_ID, NpcIdentifiers.CLAY_GOLEM_3]]);

  const SILVERLIGHT_ITEM_ID = ItemIdentifiers.SILVERLIGHT; // 2402
  const DYED_SILVERLIGHT_ITEM_ID = ItemIdentifiers.SILVERLIGHT_2; // 6745
  const DARKLIGHT_ITEM_ID = ItemIdentifiers.DARKLIGHT; // 6746
  /** Every form of the sword: having any of them means Reen has nothing to replace. */
  const SILVERLIGHT_FORMS = [SILVERLIGHT_ITEM_ID, DYED_SILVERLIGHT_ITEM_ID, DARKLIGHT_ITEM_ID];
  /**
   * Black mushroom ink's clothing recipes (Wiki, Black dye), each 2.5 Crafting XP. Ours t526-t543: the
   * desert robe and shirt first ask in an object box ("Cancel|Dye it") and then say it in another; a
   * cape says it as a game message. Every one gives the vial back, the product in the ink's slot and
   * the vial in the clothing's (t528, t537, t543). There is no sound. The name in a cape's message is
   * the cape's own colour ("red cape"); the robe and hat are ours, from the same pattern.
   */
  const DESERT_DYE_WARNING = (name) =>
    `If you dye the ${name} black it will no longer provide<br>protection from the desert sun.<br>You will not be able to remove the dye.`;
  const BLACK_DYEABLE_CLOTHING = new Map([
    [ItemIdentifiers.DESERT_SHIRT, { result: ItemIdentifiers.BLACK_DESERT_SHIRT, name: "desert shirt", desert: "shirt" }], // 1833 -> 6750
    [ItemIdentifiers.DESERT_ROBE, { result: ItemIdentifiers.BLACK_DESERT_ROBE, name: "desert robe", desert: "robe" }], // 1835 -> 6752
    ...[
      [ItemIdentifiers.GREEN_CAPE, "green"], [ItemIdentifiers.RED_CAPE, "red"], [ItemIdentifiers.BLUE_CAPE, "blue"],
      [ItemIdentifiers.ORANGE_CAPE, "orange"], [ItemIdentifiers.PINK_CAPE, "pink"], [ItemIdentifiers.PURPLE_CAPE, "purple"],
      [ItemIdentifiers.YELLOW_CAPE, "yellow"],
    ].map(([cape, colour]) => [cape, { result: ItemIdentifiers.BLACK_CAPE, name: `${colour} cape` }]),
    [ItemIdentifiers.BLUE_WIZARD_ROBE, { result: ItemIdentifiers.BLACK_ROBE, name: "robe" }],
    [ItemIdentifiers.BLUE_WIZARD_HAT, { result: ItemIdentifiers.WIZARD_HAT, name: "hat" }],
  ]);
  const DYE_CRAFTING_XP = 2.5;
  const OBJECTBOX_GROUP = 193;
  const DEMONIC_SIGIL_MOULD_ITEM_ID = ItemIdentifiers.DEMONIC_SIGIL_MOULD; // 6747
  const DEMONIC_SIGIL_ITEM_ID = ItemIdentifiers.DEMONIC_SIGIL; // 6748
  const DEMONIC_TOME_ITEM_ID = ItemIdentifiers.DEMONIC_TOME; // 6749
  const TOME_TITLE = "The Confession of Ellemar";
  /** All four spreads as the user's capture turns them (t1497-t1503); tomePages() writes in the player's incantation. */
  const TOME_PAGES = require("../data/shadow-of-the-storm-tome.json");
  const STRANGE_IMPLEMENT_ITEM_ID = ItemIdentifiers.STRANGE_IMPLEMENT; // 4619
  const BLACK_MUSHROOM_ITEM_ID = ItemIdentifiers.BLACK_MUSHROOM; // 4620
  const BLACK_DYE_ITEM_ID = ItemIdentifiers.BLACK_DYE; // 4622 "Black mushroom ink"

  const BLACK_MUSHROOM_OBJECT_ID = ObjectIdentifiers.BLACK_MUSHROOMS; // 6311
  // The four agrith kilns in Uzer: 10242 at 3467,3123, 10243 at 3478,3082, 10244 at
  // 3472,3092 and 10245 at 3500,3084. Each shows a "Look-in" child (10246-10248) only
  // at stage 60; otherwise their children are the optionless 6327-6330.
  const SURFACE_KILN_OBJECT_IDS = [10242, 10243, 10244, 10245]; // agrith_kiln_1..4
  /**
   * Josef hid the tome in a kiln picked when the golem tells you about it: varbit 1378
   * agrith_kiln holds 0-3 and the tome is in agrith_kiln_{value + 1} (capture 572: 0->2 and
   * the tome in agrith_kiln_3; capture 3333: left at 0 and the tome in agrith_kiln_1).
   */
  const KILN_COUNT = SURFACE_KILN_OBJECT_IDS.length;

  // ============================================================================
  // Stages and state
  // ============================================================================

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_INFILTRATE = 20;
  const STAGE_IN_GROUP = 30;
  const STAGE_DENATH_TOLD = 40;
  const STAGE_MATTHEW_TOLD = 50;
  const STAGE_GOLEM_TOLD = 60;
  const STAGE_BOOK_SHOWN = 70;
  const STAGE_RITUAL = 80;
  const STAGE_RITUAL_DONE = 90;
  const STAGE_PREPARE = 100;
  const STAGE_READY = 110;
  const STAGE_SUMMONED = 120;
  const STAGE_KILLED = 124;
  const STAGE_COMPLETE = 130;
  // Capture 3333 ends the native agrith_quest varbit at 125 (t26125); the
  // server's legacy internal completion stage is 130. The varbit is 7 bits
  // (1372, bits 0-6), so mirror completion as 125 while keeping stage 130.
  const VARBIT_QUEST_FINISHED = 125;

  const COMBAT_XP = 10000;
  const DEMON_HP_ON_REGEN = 12;

  const HELPERS_ATTRIBUTE = "quest.shadow_of_the_storm.helpers";
  const KILN_ATTRIBUTE = "quest.shadow_of_the_storm.kiln";
  const INCANTATION_ATTRIBUTE = "quest.shadow_of_the_storm.incantation";
  const REWARD_ATTRIBUTE = "quest.shadow_of_the_storm.reward";

  const BIT_DAVE = 1 << 0;
  const BIT_BADDEN = 1 << 1;
  const BIT_REEN = 1 << 2;
  const BIT_GOLEM = 1 << 3;
  const BIT_GOLEM_REPROGRAMMED = 1 << 4;
  const BIT_TANYA = 1 << 5;
  const BIT_MATTHEW = 1 << 6;
  const BIT_DENATH = 1 << 7;
  const BIT_DAVE_ARRIVED = 1 << 8;
  const BIT_BADDEN_ARRIVED = 1 << 9;
  const BIT_REEN_ARRIVED = 1 << 10;
  const BIT_GOLEM_ARRIVED = 1 << 11;
  const BIT_GOLEM_REFUSED = 1 << 12;
  /** The first climb out after the first ritual is stopped by falling rocks (rsprox 3333 t2232, 572 t1233, ours t1901). */
  const BIT_ROCKS_FELL = 1 << 13;
  const ALL_HELPERS_MASK = BIT_DAVE | BIT_BADDEN | BIT_REEN | BIT_GOLEM;
  const ALL_ARRIVED_MASK = BIT_DAVE_ARRIVED | BIT_BADDEN_ARRIVED | BIT_REEN_ARRIVED | BIT_GOLEM_ARRIVED;
  /**
   * Ticks from a helper's recruiting line to their varbit reaching 3 (ours: Dave t1889 -> t1904,
   * Badden t1918 -> t1950, Reen t1999 -> t2021, the golem t2021 -> t2041). One sample each.
   */
  const ARRIVAL_TICKS = new Map([[BIT_DAVE, 15], [BIT_BADDEN, 32], [BIT_REEN, 22], [BIT_GOLEM, 20]]);
  const ARRIVED_BIT = new Map([
    [BIT_DAVE, BIT_DAVE_ARRIVED], [BIT_BADDEN, BIT_BADDEN_ARRIVED], [BIT_REEN, BIT_REEN_ARRIVED], [BIT_GOLEM, BIT_GOLEM_ARRIVED],
  ]);

  /** Uzer underground (the room The Golem's temple lives in) and the plane-2 throne room. */
  const UNDERGROUND_ZONE = { minX: 2700, maxX: 2745, minY: 4875, maxY: 4925, levels: [0] };
  const THRONE_ZONE = { minX: 2706, maxX: 2738, minY: 4879, maxY: 4918, levels: [2] };
  const RITUAL_TILE = { x: 2720, y: 4903, z: 2 };
  const THRONE_ENTRY_TILE = { x: 2720, y: 4883, z: 2 };
  const DEMON_TILE = { x: 2719, y: 4899, z: 2 }; // capture t2458
  const PORTAL_ENTER_OBJECT_ID = 6310; // Golem_PORTAL, outside -> plane 2
  const PORTAL_EXIT_OBJECT_ID = 6282; // Golem_DEMON_PORTAL, plane 2 -> outside

  /**
   * Owner-only plane-2 throne room cast from capture 3333. The first ritual
   * uses Denath and the apprentices plus Evil Dave; after Tanya is killed the
   * second ritual uses the three priests, Dave and the reprogrammed golem.
   */
  const RITUAL_CENTER = { x: 2720, y: 4900, z: 2 };
  const RITUAL_CAST = [
    { key: "denath", id: NpcIdentifiers.DENATH, x: 2720, y: 4903 },
    { key: "eric", id: NpcIdentifiers.ERIC, x: 2722, y: 4898 },
    { key: "tanya", id: NpcIdentifiers.TANYA, x: 2718, y: 4898 },
    { key: "matthew", id: NpcIdentifiers.MATTHEW, x: 2722, y: 4902 },
    { key: "jennifer", id: NpcIdentifiers.JENNIFER_2, x: 2723, y: 4900 },
    { key: "patrick", id: NpcIdentifiers.PATRICK, x: 2717, y: 4900 },
    { key: "dave", id: NpcIdentifiers.EVIL_DAVE_2, x: 2720, y: 4897 },
  ];
  const SECOND_CAST = [
    { key: "reen", id: NpcIdentifiers.FATHER_REEN, x: 2722, y: 4898 },
    { key: "badden", id: NpcIdentifiers.FATHER_BADDEN, x: 2722, y: 4902 },
    { key: "dave", id: NpcIdentifiers.EVIL_DAVE_2, x: 2720, y: 4897 },
    { key: "matthew", id: NpcIdentifiers.MATTHEW, x: 2718, y: 4902 },
    { key: "jennifer", id: NpcIdentifiers.JENNIFER_2, x: 2717, y: 4900 },
    { key: "patrick", id: NpcIdentifiers.PATRICK, x: 2718, y: 4898 },
    { key: "golem", id: NpcIdentifiers.CLAY_GOLEM, x: 2723, y: 4900 }, // agrith_golem_throneroom (t2053)
  ];

  const CAST_SCATTER = {
    reen: [2721, 4891], badden: [2722, 4896], dave: [2713, 4894],
    jennifer: [2716, 4898], patrick: [2712, 4894], golem: [2726, 4896],
  };
  const CAST_SCATTER_TICKS = 10;
  const CAST_WANDER_RADIUS = 8;

  // Capture 3333: the instanced throne room is a copy of source plane 2 with these
  // standing torches, fire remains and campsite beds placed into it (t2017, t2362).
  const AGRITH_PORTAL_CLOSING_OBJECT_ID = 10251;
  const AGRITH_RITUAL_CIRCLE_OBJECT_ID = 10252;
  const SUMMON_STANDARD_OBJECT_ID = 10253;
  const THRONE_ROOM_DRESSING = [
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2725, y: 4883, face: 0 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2722, y: 4881, face: 0 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2728, y: 4894, face: 1 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2722, y: 4895, face: 1 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2718, y: 4895, face: 0 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2712, y: 4893, face: 0 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2716, y: 4883, face: 0 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2718, y: 4881, face: 0 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2729, y: 4905, face: 3 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2722, y: 4905, face: 3 },
    // The inner north-western standing torch; the Wiki's flinching spot.
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2718, y: 4905, face: 2 },
    // The outer torch blocks the static wall edge; keep it for the captured room.
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2712, y: 4905, face: 2 },
    { id: ObjectIdentifiers.FIRE_REMAINS, x: 2728, y: 4905, face: 0 },
    { id: ObjectIdentifiers.CAMPSITE_BED, x: 2728, y: 4903, face: 2 },
    { id: ObjectIdentifiers.CAMPSITE_BED, x: 2729, y: 4906, face: 1 },
    { id: ObjectIdentifiers.CAMPSITE_BED, x: 2730, y: 4907, face: 0 },
    { id: ObjectIdentifiers.CAMPSITE_BED, x: 2726, y: 4907, face: 3 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2723, y: 4913, face: 1 },
    { id: ObjectIdentifiers.STANDING_TORCH, x: 2717, y: 4913, face: 0 },
    { id: SUMMON_STANDARD_OBJECT_ID, x: 2723, y: 4912, face: 0, shape: 11 },
    { id: SUMMON_STANDARD_OBJECT_ID, x: 2717, y: 4912, face: 3, shape: 11 },
  ];

  // Sequence ids from the cache (data/definitions/sequence-names.json).
  const SEQ_SUMMON_START = 2879; // summon_summon_start
  const SEQ_SUMMON = 2880; // summon_summon
  const SEQ_GOLEM_SUMMON_START = 2884; // golem_summon_start
  const SEQ_GOLEM_SUMMON = 2885; // golem_summon_summon
  const SEQ_TANYA_DEFEND = 425; // human_unarmed_def
  const SEQ_TANYA_DEATH = 836; // human_death
  const SEQ_GHOST_ATTACK = 5532; // ghost_update_normal_attack
  const SEQ_AGRITH_SUMMONED = 4623; // qip_ds_delrith_summoned
  const SEQ_DENATH_LEAVE = 2888; // denath_leave
  const RUNAWAY_KEYS = ["dave", "eric", "tanya"];
  const SEQ_DEMON_CASTING = 69; // demon_casting
  const SEQ_DEMON_ATTACK_GREATER = 4679; // demon_update_attack_greater
  const GFX_RITUAL_SUMMON = 480;
  const GFX_AGRITH_SUMMON = 482;
  const GFX_BLOOD = 131;

  // Fire Blast (cache CombatSpells.FIRE_BLAST), with Agrith-Naar's Wiki max hit of 10.
  const FIRE_BLAST = { anim: SEQ_DEMON_CASTING, projectile: 130, startGraphic: 129, endGraphic: 131,
    start: 0, end: 20, startHeight: 43, endHeight: 31, maxHit: 10 };
  // Ours t2513: his Fire Blast landing on the player shows firebolt_impact (128); on Matthew, 131 (t2212).
  const GFX_FIREBLAST_ON_PLAYER = 128;
  // Ours t2235 (and 42 more): a miss splashes, failedspell_impact (85) and spellfail (227) as it lands, no hitsplat.
  const GFX_SPLASH = 85;
  const SPELL_FAIL_SOUND = 227;
  const FIREBLAST_HIT_SOUND = 156; // t2513, as it lands
  const FIREBLAST_CAST_SOUND = 155;
  const TELEGRAB = { projectile: 143, graphic: 409, arrivalDelay: 46, castSound: 3006, hitSound: 3007, moveSound: 1851 };
  const AGRITH_MAX_HIT = 10;
  const AGRITH_ATTACK_SPEED = 4;
  const AGRITH_ATTACK_DISTANCE = 32;

  const INCANTATION_WORDS = ["Caldar", "Nahudu", "Agrith-Naar", "Camerinthum", "Tarren"];
  const WORD_INDEX = new Map(INCANTATION_WORDS.map((word, index) => [word.toLowerCase(), index]));
  /**
   * The five varbits (1373-1377) hold the book's order, drawn per player (assignIncantation). Denath
   * says it backwards (ours t815), the first ritual is his order and the second the book's (Quest
   * Helper IncantationStep reverse true/false; ours t1714-t1736 and t2175-t2198).
   */
  const FIRST_RITUAL_VARIANT = "performing-the-ritual-getting-in-place";
  const SECOND_RITUAL_VARIANT = "summoning-agrith-naar-in-position";

  const SKILL_BY_OPTION = new Map([
    ["* Strength *", Skill.STRENGTH],
    ["* Attack *", Skill.ATTACK],
    ["* Defence *", Skill.DEFENCE],
    ["* Hitpoints *", Skill.HITPOINTS],
    ["* Magic *", Skill.MAGIC],
    ["* Ranged *", Skill.RANGED],
  ]);
  const SKILL_BY_INDEX = new Map(
    [...SKILL_BY_OPTION.values()].map((skill) => [skill.getIndex(), skill])
  );

  // Condition step ids on the "Shadow of the Storm" page.
  const COND_REEN_START = "svZZrt"; // still has Silverlight at the start
  const COND_REEN_AGAIN_START = "_Q8pfm"; // still has Silverlight, talking to Reen again
  const COND_BADDEN_SILVERLIGHT_PRESENT = "A17tY2"; // still has Silverlight for Badden
  const COND_BADDEN_SILVERLIGHT_LOST = "JkC4Vq"; // lost Silverlight before Badden
  // The capture's additions (osrsreboxed-db correction): Reen's Silverlight answers and his finds in Uzer
  // and the throne room, Denath's stage-80 talk.
  const COND_SILVERLIGHT_CARRIED = "sotsSC";
  const COND_SILVERLIGHT_BANKED = "sotsSB";
  const COND_REEN_UZER_LOST = "sotsUL";
  const COND_REEN_UZER_HAS = "sotsUH";
  const COND_REEN_ROOM_LOST = "sotsTL";
  const COND_REEN_ROOM_HAS = "sotsTH";
  const COND_DENATH_RITUAL = "sotsDR";
  const COND_DENATH_BEFORE = "sotsDB";
  const COND_REF_START = new Set([COND_REEN_START, COND_REEN_AGAIN_START, COND_BADDEN_SILVERLIGHT_PRESENT, COND_REEN_UZER_HAS, COND_REEN_ROOM_HAS]);
  const COND_REEN_LOST = new Set(["fllvV0", "X3Ql5k", COND_REEN_UZER_LOST, COND_REEN_ROOM_LOST]); // Reen can hand Silverlight back
  const COND_REF_LOST = new Set([...COND_REEN_LOST, COND_BADDEN_SILVERLIGHT_LOST]);
  const COND_NOT_ENOUGH_BLACK = "JikimW";
  const COND_BLACK_UNDYED = "4k0GUd";
  const COND_BLACK_DYED = "4Y24pa";
  const COND_THRONE_GEMS_REMOVED = "7wLvM8";
  const COND_THRONE_GEMS_PRESENT = "rioSQu";
  const COND_MOULD_FREE = "lfudoK";
  const COND_MOULD_NO_SPACE = "FCmkX6";
  const COND_MOULD_HELD = "k9kfs8";
  const COND_ERIC_WALKED_AWAY = "VYAAJ_";
  const COND_MATTHEW_NO_BOOK = "UiRe9o";
  const COND_MATTHEW_BOOK = "6Gz0Kx";
  const COND_MATTHEW_UNDYED = "Gf2Mqg";
  const COND_MATTHEW_DYED = "ayHNXA";
  const COND_RITUAL_WRONG = "U6mX5q";
  const COND_RITUAL_CORRECT = "q1RJ9d";
  const COND_PEOPLE_FOUR = "PEnb-0";
  const COND_PEOPLE_THREE = "t5gSPE";
  const COND_PEOPLE_TWO = "piK4Mv";
  const COND_PEOPLE_ONE = "NHy6EJ";
  const COND_BADDEN_NO_SIGIL = "3fuR91";
  const COND_BADDEN_SIGIL = "qv5YFB";
  const COND_REEN_NO_SIGIL = "9PtqFf";
  const COND_REEN_SIGIL = "Aw3U2E";
  const COND_GOLEM_NO_SIGIL = "gI6c58";
  const COND_GOLEM_SIGIL = "AWNaLn";
  const COND_SUMMON_NO_SIGIL = "no5_C7";
  const COND_SUMMON_NO_SWORD = "az5CGG";
  const COND_SUMMON_READY = "pblmt4";
  const COND_SUMMON_BACKWARDS = "bAuvv8";
  const COND_SUMMON_CORRECT = "P8GKUN";

  // Action/message step ids.
  const MSG_REEN_GIVES_SWORD = "Kh2EP0";
  const MSG_DYE_PICK_MUSHROOM = "E-w57a"; // to-uzer-dyeing-silverlight-black
  const MSG_DYE_SLICE = "iGN0Yu";
  const MSG_MATTHEW_READS = "N_4dSS";
  const MSG_ESCORT_THRONE = "SzrKim";
  const MSG_DAVE_RETURNS = "vzuhlL";
  const MSG_KILL_WIPE = "JChGC-";
  const MSG_KILL_POWER = "nTkAkp";
  const FINAL_BLOW_TEXT = "As you strike the final blow, Silverlight is drenched with<br>Agrith-Naar's foul-smelling ichor!";
  const MSG_TANYA_KILLED = "iWR7Wz";
  const ACTION_RITUAL_ASSEMBLES = "FK8qAZ";
  const ACTION_MATTHEW_KILLED = "X9FA-a";
  const ACTION_DEMON_ATTACKS = "YKZEof";
  const ACTION_GOLEM_REPROGRAMMED = "Aha_-j";
  const ACTION_QUEST_COMPLETE = "EDRKBv";

  // ============================================================================
  // State
  // ============================================================================

  let quest;
  let itemOnGroundManager;
  const Scenes = createQuestScenes(api, { onEnd: handleSceneEnd });

  /** player -> Map of wizard key -> spawned npc (owner-only throne room). */
  const wizardNpcs = new WeakMap();
  /** player -> their Agrith-Naar. */
  const demonNpcs = new WeakMap();
  /** player -> incantation words picked this run. */
  const ritualPicks = new WeakMap();
  const ritualViewDistances = new WeakMap();

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const ownsItem = (player, itemId) =>
    hasItem(player, itemId) ||
    (player.getEquipment().getItems() || []).some((item) => item && item.getId?.() === itemId);

  const bankedItem = (player, itemId) =>
    player.getBanks?.()?.some((bank) => bank && bank.getAmount(itemId) > 0) === true;

  /** Carried or worn, as the ritual needs it. */
  const hasSilverlight = (player) =>
    ownsItem(player, SILVERLIGHT_ITEM_ID) || ownsItem(player, DYED_SILVERLIGHT_ITEM_ID);
  /** Carried, worn or banked in any form, so Reen never hands out a second sword. */
  const ownsSilverlight = (player) =>
    SILVERLIGHT_FORMS.some((itemId) => ownsItem(player, itemId) || bankedItem(player, itemId));
  const hasDyedSilverlight = (player) => ownsItem(player, DYED_SILVERLIGHT_ITEM_ID);

  function silverlightEquipped(player) {
    return (player.getEquipment().getItems() || []).some(
      (item) =>
        item &&
        (item.getId?.() === DYED_SILVERLIGHT_ITEM_ID || item.getId?.() === SILVERLIGHT_ITEM_ID)
    );
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function helperBits(player) {
    return Number(player.getAttribute(HELPERS_ATTRIBUTE)) || 0;
  }

  function setHelperBits(player, bits) {
    player.setAttribute(HELPERS_ATTRIBUTE, bits);
  }

  /** The kiln (0-3) holding this player's tome. */
  function hiddenKiln(player) {
    return Number(player.getAttribute(KILN_ATTRIBUTE)) || 0;
  }

  function hideTome(player) {
    const kiln = Math.floor(Math.random() * KILN_COUNT);
    player.setAttribute(KILN_ATTRIBUTE, kiln);
    player.getPacketSender().sendVarbit(VARBIT_AGRITH_KILN, kiln);
  }

  function packedIncantation(player) {
    return Number(player.getAttribute(INCANTATION_ATTRIBUTE)) || 0;
  }

  function chosenSkill(player) {
    const index = Number(player.getAttribute(REWARD_ATTRIBUTE));
    return Number.isFinite(index) ? SKILL_BY_INDEX.get(index) : undefined;
  }

  function wordAt(player, index) {
    return (packedIncantation(player) >> (index * 3)) & 7;
  }

  function giveItem(player, itemId, message) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space for that.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    if (message) player.sendMessage(message);
    return true;
  }

  function inThroneRoom(player) {
    const at = player.getLocation();
    return THRONE_ZONE.levels.includes(at.getZ()) && at.getX() >= THRONE_ZONE.minX && at.getX() <= THRONE_ZONE.maxX
      && at.getY() >= THRONE_ZONE.minY && at.getY() <= THRONE_ZONE.maxY;
  }

  function chatboxOpen(player) {
    const prompt = api.core.MultiChatboxPrompt?.getPending?.(player) ?? null;
    return player.getDialogueManager?.()?.isActive?.() === true || prompt !== null;
  }

  /** Runs `fn` once the current dialogue has fully closed (a chat menu is a tick). */
  function afterDialogue(player, fn) {
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (chatboxOpen(player)) {
          afterDialogue(player, fn);
          return;
        }
        fn();
      })
    );
  }

  // ============================================================================
  // Varbits and spawns
  // ============================================================================

  /**
   * A helper's Uzer varbit, as the capture moves it: 1 while they wait in Uzer (Badden from the
   * start, t73; Reen from Dave's escort, t716; Dave from the first ritual, t1739), 2 from the
   * recruiting line while their walking copy (915/916/914) heads off, 3 once they have arrived in the
   * throne room (t1950, t2021, t1904). The cache shows each Uzer copy only at 1 and the walker only
   * at 2, so 3 is "gone", and stays so after the quest (t2875: only the golem is back in Uzer).
   */
  function helperState(player, recruitedBit, arrivedBit, waiting) {
    const bits = helperBits(player);
    if (bits & arrivedBit) return 3;
    if (bits & recruitedBit) return 2;
    return waiting ? 1 : 0;
  }

  /** Varbit 348 (The Golem's): 5 while the golem walks to the throne room, 6 there, 4 once it is back (t2021, t2041, t2760). */
  function golemClayValue(player) {
    const stage = quest.getStage(player);
    const bits = helperBits(player);
    if (!(bits & BIT_GOLEM)) return null;
    if (stage >= STAGE_KILLED) return 4; // repaired and back in Uzer, The Golem's own value
    return bits & BIT_GOLEM_ARRIVED ? 6 : 5;
  }

  /** Re-sends the sibling varbits the stage and helper bits imply. */
  function syncShadowVarbits(player) {
    const packet = player.getPacketSender();
    const stage = quest.getStage(player);
    const bits = helperBits(player);
    packet.sendVarbit(VARBIT_BADDEN_UZER, helperState(player, BIT_BADDEN, BIT_BADDEN_ARRIVED, stage >= STAGE_STARTED));
    packet.sendVarbit(VARBIT_REEN_UZER, helperState(player, BIT_REEN, BIT_REEN_ARRIVED, stage >= STAGE_IN_GROUP));
    packet.sendVarbit(VARBIT_CONVINCED_DAVE, helperState(player, BIT_DAVE, BIT_DAVE_ARRIVED, stage >= STAGE_RITUAL_DONE));
    packet.sendVarbit(
      VARBIT_CONVINCED_GOLEM,
      bits & BIT_GOLEM ? 3 : bits & BIT_GOLEM_REPROGRAMMED ? 2 : bits & BIT_GOLEM_REFUSED ? 1 : 0
    );
    const clay = golemClayValue(player);
    if (clay !== null) packet.sendVarbit(VARBIT_GOLEM_CLAY, clay);
    packet.sendVarbit(VARBIT_AGRITH_KILN, hiddenKiln(player));
    for (let index = 0; index < VARBIT_INCANTATION_WORDS.length; index++) {
      packet.sendVarbit(VARBIT_INCANTATION_WORDS[index], wordAt(player, index));
    }
  }

  function setStage(player, value) {
    quest.setStage(player, value);
    syncShadowVarbits(player);
    ensureWizardNpcs(player);
  }

  /**
   * Who is in the throne room, and where, as the capture shows each visit:
   * - stages 30-70: Denath and the five apprentices about the room (ours t717-t737 where they stood
   *   as Dave led the player in; they walk about it, t853-t1020). Evil Dave stays at the portal outside.
   * - stage 80: Dave too (t1646), everyone at their place in the circle (RITUAL_CAST, t1739's sounds).
   * - stages 90-100: Matthew, Jennifer and Patrick, with each helper once they have arrived (t2049-t2053).
   * - stage 110: the eight at their places (SECOND_CAST, t2201's sounds); 120 the fight, Matthew gone;
   *   after it the rest stay until the player leaves (t2853-t2855).
   */
  const ROOM_CAST = [
    { key: "denath", id: NpcIdentifiers.DENATH, x: 2720, y: 4912, wander: 2 },
    { key: "eric", id: NpcIdentifiers.ERIC, x: 2717, y: 4890, wander: 5 },
    { key: "tanya", id: NpcIdentifiers.TANYA, x: 2713, y: 4900, wander: 5 },
    { key: "matthew", id: NpcIdentifiers.MATTHEW, x: 2722, y: 4900, wander: 5 },
    { key: "jennifer", id: NpcIdentifiers.JENNIFER_2, x: 2723, y: 4898, wander: 5 },
    { key: "patrick", id: NpcIdentifiers.PATRICK, x: 2718, y: 4893, wander: 5 },
  ];
  const HELPER_ARRIVED = new Map([
    ["dave", BIT_DAVE_ARRIVED], ["badden", BIT_BADDEN_ARRIVED], ["reen", BIT_REEN_ARRIVED], ["golem", BIT_GOLEM_ARRIVED],
  ]);

  function castFor(player) {
    const stage = quest.getStage(player);
    const bits = helperBits(player);
    if (stage < STAGE_IN_GROUP) return { cast: [], place: false };
    if (stage < STAGE_RITUAL) return { cast: ROOM_CAST, place: false };
    if (stage === STAGE_RITUAL) return { cast: RITUAL_CAST, place: true };
    const arrived = (spawn) => !HELPER_ARRIVED.has(spawn.key) || (bits & HELPER_ARRIVED.get(spawn.key)) !== 0;
    if (stage < STAGE_READY) {
      // Straight after the first ritual Denath, Dave, Eric and Tanya go (RUNAWAY_KEYS, the closing scene).
      const gone = new Set(["denath", ...RUNAWAY_KEYS]);
      const stayed = RITUAL_CAST.filter((spawn) => !gone.has(spawn.key) && !(spawn.key === "denath" && (bits & BIT_DENATH)));
      const helpers = SECOND_CAST.filter((spawn) => HELPER_ARRIVED.has(spawn.key) && arrived(spawn));
      const denath = stage === STAGE_RITUAL_DONE && !(bits & BIT_DENATH) ? RITUAL_CAST.filter((spawn) => spawn.key === "denath") : [];
      return { cast: [...stayed, ...denath, ...helpers].map((spawn) => ({ ...spawn, wander: 5 })), place: false };
    }
    const killed = stage >= STAGE_KILLED || (stage >= STAGE_SUMMONED && (bits & BIT_MATTHEW) !== 0);
    return { cast: SECOND_CAST.filter((spawn) => arrived(spawn) && !(spawn.key === "matthew" && killed)), place: stage === STAGE_READY };
  }

  function ensureWizardNpcs(player) {
    const stage = quest.getStage(player);
    // After the kill whoever is in the room stays until the player leaves (ours t2820-t2855); a
    // later visit is the plain room (t2963), so nobody is spawned for it.
    if (stage >= STAGE_KILLED) {
      if (!inThroneRoom(player)) removeAllWizards(player);
      return;
    }
    if (stage < STAGE_IN_GROUP || !inThroneRoom(player)) {
      removeAllWizards(player);
      return;
    }
    const { cast, place } = castFor(player);
    const center = new Location(RITUAL_CENTER.x, RITUAL_CENTER.y, RITUAL_CENTER.z);
    let tracked = wizardNpcs.get(player);
    if (!tracked) {
      tracked = new Map();
      wizardNpcs.set(player, tracked);
    }
    const wanted = new Set(cast.map((spawn) => spawn.key));
    for (const [key, npc] of tracked) {
      if (wanted.has(key) || npc.__shadowLeaving === true) continue;
      api.removeNpc(npc);
      tracked.delete(key);
    }
    for (const spawn of cast) {
      const existing = tracked.get(spawn.key);
      if (existing && existing.isRegistered?.() !== false && existing.getPrivateArea?.()?.isDestroyed?.() !== true) {
        syncWizardArea(player, existing);
        if (place && existing.__shadowLeaving !== true && existing.__shadowScattered !== true) {
          // Ours t1642-t1646 and t2144: whoever is not at their place by the first word is put there.
          existing.getMovementCoordinator?.().setRadius?.(0);
          existing.moveTo?.(new Location(spawn.x, spawn.y, 2));
          existing.setPositionToFace?.(center);
        }
        continue;
      }
      if (existing) api.removeNpc(existing);
      const npc = api.spawnNpc({
        id: spawn.id,
        x: spawn.x,
        y: spawn.y,
        z: 2,
        wanderRadius: place ? 0 : spawn.wander ?? 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) {
        npc.__skipDefaultRespawn = true;
        tracked.set(spawn.key, npc);
        if (place) npc.setPositionToFace?.(center);
        syncWizardArea(player, npc);
      }
    }
  }

  /** Stage 80 (ours t1636-t1646): the wizards walk to their places in the circle and turn to its centre. */
  function assembleCircle(player, cast) {
    const center = new Location(RITUAL_CENTER.x, RITUAL_CENTER.y, RITUAL_CENTER.z);
    for (const spawn of cast) {
      const npc = wizardNpcs.get(player)?.get(spawn.key);
      if (!npc) continue;
      npc.getMovementCoordinator?.().setRadius?.(0);
      npc.getMovementQueue?.().reset?.();
      api.core.PathFinder?.calculateWalkRoute(npc, spawn.x, spawn.y);
      Scenes.later(player, 8, () => {
        if (npc.isRegistered?.() === false) return;
        if (npc.getLocation().getX() !== spawn.x || npc.getLocation().getY() !== spawn.y) npc.moveTo(new Location(spawn.x, spawn.y, 2));
        npc.setPositionToFace(center);
      });
    }
  }

  const THRONE_BOUNDS = [[2706, 2738, 4879, 4918, 2]];
  /** Teleports leave as anywhere else (ours t1292, t2975); the fight's NPCs keep their aggression. */
  const THRONE_RULES = { beforeEnd: releaseRitualCast, canTeleport: () => null, npcAggression: () => null };

  /**
   * The throne room as each visit builds it (live: a new instance per visit, t717, t1213, t1594, t2049):
   * one scene from the portal to the way out, dressed as captured, that each cutscene plays a phase of.
   * After the quest the room is the plain map (t2963).
   */
  function roomScene(player, phase = null) {
    let scene = Scenes.get(player);
    if (!scene?.__shadowRoom) {
      scene = Scenes.open(player, "shadow-throne", THRONE_BOUNDS, THRONE_RULES);
      scene.__shadowRoom = true;
      dressThroneRoom(scene);
      // After the first ritual the portal is the closing one until the summoning (ours t2049, 3333 t2362).
      const stage = quest.getStage(player);
      if (stage >= STAGE_RITUAL_DONE && stage < STAGE_SUMMONED) {
        scene.__shadowClosedPortal = phaseLoc(scene, { id: AGRITH_PORTAL_CLOSING_OBJECT_ID, x: 2719, y: 4883, face: 0 });
      }
    }
    if (phase) scene.phase = phase;
    return scene;
  }

  /** The captured destroyed-temple dressing: torches (including the NW safe spot), fire and beds. */
  function dressThroneRoom(scene) {
    if (!scene || scene.__shadowThroneDressed) return;
    scene.__shadowThroneDressed = true;
    for (const loc of THRONE_ROOM_DRESSING) {
      Scenes.loc(scene, { id: loc.id, x: loc.x, y: loc.y, z: RITUAL_CENTER.z,
        type: loc.shape ?? 10, face: loc.face });
    }
  }

  // ============================================================================
  // Evil Dave's escort (ours t716-t773)
  // ============================================================================

  const INVISWALL_SERVERSIDE_OBJECT_ID = 3550;
  const DENATH_CUTSCENE_JINGLE = 91; // "denath cutscene", 36 s
  const ESCORT_ENTRY = [2720, 4883, 2];
  /** t717: the corridor Dave walks the player up, walls on both sides (removed at t766). */
  const ESCORT_WALLS = [
    ...Array.from({ length: 17 }, (_, i) => ({ x: 2721, y: 4890 + i, face: 0 })),
    ...Array.from({ length: 17 }, (_, i) => ({ x: 2719, y: 4890 + i, face: 2 })),
  ];

  /** The steps after the step with `id`, at whatever depth it sits (the escort's lines follow its message). */
  function stepsAfter(steps, id) {
    for (let index = 0; index < (steps ?? []).length; index++) {
      const step = steps[index];
      if (step?.id === id) return steps.slice(index + 1);
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? stepsAfter(nested, id) : null;
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * t716 the message box with no continue as the screen fades out (15 cycles); t717 the throne room,
   * the cutscene state, the corridor walls and Dave on the player's tile, with the "denath cutscene"
   * jingle; t718 the camera at the door and the fade in. Dave walks up the corridor from t722 and
   * the player from t724 (one tile a tick) under a camera that follows them to Denath; his lines
   * play from t752. The scene ends as Denath asks "So you wish to join us?" (t773).
   */
  function startEscort(player) {
    if (quest.getStage(player) !== STAGE_INFILTRATE) return;
    setStage(player, STAGE_IN_GROUP);
    StatementDialogue.send(player, "Evil Dave escorts you into the demonic throne room.", false);
    Scenes.fade(player, true, 15);
    Scenes.later(player, 1, () => {
      Scenes.place(player, ESCORT_ENTRY);
      const scene = roomScene(player, "escort");
      beginCutscene(player);
      scene.__shadowWalls = ESCORT_WALLS.map(({ x, y, face }) =>
        Scenes.loc(scene, { id: INVISWALL_SERVERSIDE_OBJECT_ID, x, y, z: 2, type: 0, face }));
      ensureWizardNpcs(player);
      const dave = Scenes.actor(scene, NpcIdentifiers.EVIL_DAVE_2, ESCORT_ENTRY, null, { direction: 0 });
      scene.__escortDave = dave;
      player.getPacketSender().sendJingle(DENATH_CUTSCENE_JINGLE, 0);
      Scenes.later(scene, 1, () => {
        Scenes.camera(player, [2715, 4883, 375], [2720, 4884, 350]);
        Scenes.fade(player, false);
      });
      Scenes.later(scene, 5, () => { Scenes.walk(dave, [2720, 4908, 2]); Scenes.walk(dave, [2719, 4911, 2]); });
      Scenes.later(scene, 7, () => {
        walkHeld(player, scene, [2720, 4911]);
        Scenes.camera(player, [2715, 4883, 375], [2720, 4892, 375], Scenes.CAMERA_RATES, { rate: 1, rate2: 1 });
      });
      Scenes.later(scene, 12, () => {
        Scenes.camera(player, [2720, 4881, 300], [2720, 4884, 150]);
        Scenes.camera(player, [2720, 4891, 1000], [2720, 4911, 150], { rate: 1, rate2: 1 });
      });
      Scenes.later(scene, 23, () => Scenes.camera(player, [2712, 4902, 600], [2720, 4902, 150]));
      Scenes.later(scene, 29, () => {
        Scenes.camera(player, [2718, 4917, 325], [2720, 4912, 150]);
        Scenes.camera(player, [2718, 4917, 325], [2720, 4912, 150], { rate: 1, rate2: 1 });
      });
      Scenes.later(scene, 35, () => {
        if (dave) dave.setPositionToFace(wizardNpcs.get(player)?.get("denath")?.getLocation() ?? tileOf(scene, [2720, 4912, 2]));
        startTranscript(api, player, NpcIdentifiers.EVIL_DAVE_2, PAGE, "infiltrating-the-wizards",
          (steps) => stepsAfter(steps, MSG_ESCORT_THRONE) ?? [], dave);
        guardCutscene(player, scene, "escort", () => endEscort(player, scene));
      });
    });
  }

  /** The held player walks one tile a tick to `target` (ours t724-t751), whatever blocks a click. */
  function walkHeld(player, scene, [x, y]) {
    const step = () => {
      if (Scenes.get(player) !== scene) return;
      const at = player.getLocation();
      const dx = Math.sign(x - at.getX());
      const dy = Math.sign(y - at.getY());
      if (!dx && !dy) return;
      player.getMovementQueue().stepWhileHeld(dx, dy);
      Scenes.later(scene, 1, step);
    };
    step();
  }

  function tileOf(scene, tile) {
    return Scenes.tileFor(scene, tile);
  }

  const SEQ_SUMMON_POINT = 2891;
  const SEQ_EMOTE_ANGRY = 859;
  const SEQ_EMOTE_LAUGH = 861;
  /** The speakers' emotes as their lines show (ours t388 and t432, t397, t783). */
  const LINE_EMOTES = [
    { ids: BADDEN_NPC_IDS, line: /^As that foul construct over there proves/, seq: SEQ_SUMMON_POINT },
    { ids: BADDEN_NPC_IDS, line: /^The golem, yes! An abomination/, seq: SEQ_EMOTE_ANGRY },
    { ids: DENATH_NPC_IDS, line: /^You shall have every wish granted/, seq: SEQ_EMOTE_LAUGH, key: "denath" },
  ];

  function lineEmotes(event, text) {
    if (typeof event.step?.player === "string") return;
    const player = event.player;
    for (const emote of LINE_EMOTES) {
      if (!spokenBy(event, emote.ids) || !emote.line.test(text)) continue;
      lineBefore(event, () => {
        const npc = emote.key && !emote.ids.has(event.npc?.getRealId?.() ?? event.npcId)
          ? wizardNpcs.get(player)?.get(emote.key) : event.npc;
        npc?.performAnimation?.(new Animation(emote.seq));
      });
    }
    // T783: the escort's Dave goes as Denath laughs.
    const scene = Scenes.get(player);
    if (scene?.__escortDave && spokenBy(event, DENATH_NPC_IDS) && /^You shall have every wish granted/.test(text)) {
      lineBefore(event, () => {
        if (!scene.__escortDave) return;
        Scenes.removeActor(scene, scene.__escortDave);
        scene.__escortDave = null;
      });
    }
  }

  /** Lines of the escort's own: t754 the camera on Denath, t766 the walls go, t773 the scene ends. */
  function escortLine(event, text) {
    const scene = Scenes.get(event.player);
    if (scene?.phase !== "escort") return;
    const player = event.player;
    if (/^Indeed\? Well we are one wizard short/.test(text)) {
      lineBefore(event, () => {
        Scenes.camera(player, [2718, 4917, 325], [2720, 4912, 150]);
        Scenes.camera(player, [2718, 4909, 325], [2720, 4912, 150], { rate: 2, rate2: 2 });
      });
      lineAfter(event, () => removeEscortWalls(scene));
    } else if (/^So you wish to join us\?/.test(text)) {
      // The room stays as it is; the cutscene state, camera, minimap and tabs come back (t773).
      lineBefore(event, () => {
        if (Scenes.get(player) !== scene || scene.phase !== "escort") return;
        scene.phase = null;
        endCutscene(player);
      });
    }
  }

  function removeEscortWalls(scene) {
    for (const wall of scene.__shadowWalls ?? []) removeSceneLoc(scene, wall);
    scene.__shadowWalls = [];
  }

  /** The escort's talk gone before Denath's welcome (guardCutscene): the walls and Dave go, the scene ends. */
  function endEscort(player, scene) {
    if (scene.phase !== "escort") return;
    removeEscortWalls(scene);
    if (scene.__escortDave) {
      Scenes.removeActor(scene, scene.__escortDave);
      scene.__escortDave = null;
    }
    scene.phase = null;
    endCutscene(player);
  }

  /** A single phase-owned scene loc; its removal sends the client loc deletion. */
  function phaseLoc(scene, spec, ticks = null) {
    const object = Scenes.loc(scene, { z: RITUAL_CENTER.z, type: 10, ...spec });
    if (ticks !== null) {
      Scenes.later(scene, ticks, () => removeSceneLoc(scene, object));
    }
    return object;
  }

  function removeSceneLoc(scene, object) {
    if (!object) return;
    const index = scene.locs.indexOf(object);
    if (index < 0) return;
    scene.locs.splice(index, 1);
    api.core.ObjectManager.deregister(object, true);
    // These phase locs replace scenery temporarily. Replaying their removal after
    // the client restores the underlying cache loc would hide that original loc.
    const removed = api.core.World.getRemovedObjects();
    const marker = removed.indexOf(object);
    if (marker >= 0) removed.splice(marker, 1);
  }

  /** Each wizard's sigil-holding form, worn from the first word (ours t1684, t2147) until the ritual is over (t1753, t2226). */
  const SIGIL_FORM = new Map([
    [NpcIdentifiers.DENATH, NpcIdentifiers.DENATH_2], [NpcIdentifiers.ERIC, NpcIdentifiers.ERIC_2],
    [NpcIdentifiers.EVIL_DAVE_2, NpcIdentifiers.EVIL_DAVE], [NpcIdentifiers.MATTHEW, NpcIdentifiers.MATTHEW_2],
    [NpcIdentifiers.JENNIFER_2, NpcIdentifiers.JENNIFER_3], [NpcIdentifiers.TANYA, NpcIdentifiers.TANYA_2],
    [NpcIdentifiers.PATRICK, NpcIdentifiers.PATRICK_2], [NpcIdentifiers.FATHER_REEN, NpcIdentifiers.FATHER_REEN_2],
    [NpcIdentifiers.FATHER_BADDEN, NpcIdentifiers.FATHER_BADDEN_2], [NpcIdentifiers.CLAY_GOLEM, NpcIdentifiers.CLAY_GOLEM_2],
  ]);
  const AGRITH_SUMMON_SOUND = 1315;

  function holdSigils(player, holding) {
    for (const npc of wizardNpcs.get(player)?.values() ?? []) {
      if (npc?.isRegistered?.() === false) continue;
      const form = SIGIL_FORM.get(npc.getRealId?.() ?? npc.getId());
      if (form !== undefined) npc.setNpcTransformationId?.(holding ? form : -1);
    }
  }

  /**
   * A word: 2879 on everyone (2884 the golem), the sigils out on the first. The end of the chant:
   * 2880 on everyone (2885 the golem, two cycles late), and when it worked spotanim 480 and the
   * agrith_summon sound at each wizard's place (ours t1703 wrong, t1739 and t2201 right).
   */
  function animateRitualCast(player, completion, worked = true) {
    for (const [key, npc] of wizardNpcs.get(player) ?? []) {
      if (npc?.isRegistered?.() === false) continue;
      const golem = key === "golem";
      const sequence = golem ? (completion ? SEQ_GOLEM_SUMMON : SEQ_GOLEM_SUMMON_START) : (completion ? SEQ_SUMMON : SEQ_SUMMON_START);
      npc.performAnimation?.(new Animation(sequence, golem && completion ? 2 : 0));
      if (completion && worked) {
        npc.performGraphic?.(new Graphic(GFX_RITUAL_SUMMON));
        const at = npc.getLocation();
        player.getPacketSender().sendAreaSound(AGRITH_SUMMON_SOUND, at.getX(), at.getY(), at.getZ(), 1, 0, 5);
      }
    }
    // The player's own 2880 has no spotanim (t1739: eight sequences, seven spotanims).
    if (completion) player.performAnimation(new Animation(SEQ_SUMMON));
  }

  function syncWizardArea(player, npc) {
    if (npc.getOwner?.() !== player || npc.isOwnerOnly?.() !== true) return;
    const previous = npc.getPrivateArea?.() ?? null;
    const area = Scenes.get(player)?.area ?? null;
    if ((player.getPrivateArea?.() ?? null) !== area) return;
    if (previous === area) return;
    previous?.remove(npc);
    if (area) area.add(npc);
    else npc.setArea(null);
  }

  /** Keep the quest's temporary cast when the camera scene's private area is destroyed. */
  function releaseRitualCast(player, scene) {
    for (const npc of wizardNpcs.get(player)?.values() ?? []) {
      if (npc.getOwner?.() === player && npc.isOwnerOnly?.() === true && npc.getPrivateArea?.() === scene.area) {
        scene.area.remove(npc);
      }
    }
  }

  function restoreRitualView(player) {
    if (!ritualViewDistances.has(player)) return;
    player.setNpcViewDistance(ritualViewDistances.get(player));
    ritualViewDistances.delete(player);
  }

  function removeWizard(player, key) {
    const tracked = wizardNpcs.get(player);
    const npc = tracked?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    tracked.delete(key);
  }

  function removeAllWizards(player) {
    const tracked = wizardNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) api.removeNpc(npc);
    tracked.clear();
  }

  /** A scene that ended without a successor leaves no owner-only cast or demon behind. */
  function handleSceneEnd(player, scene) {
    if (!scene?.name?.startsWith("shadow-")) return;
    Scenes.later(player, 1, () => {
      if (player.isRegistered?.() === false) return;
      if (Scenes.get(player)) return;
      removeAllWizards(player);
      removeDemon(player);
    });
  }

  function removeDemon(player) {
    const npc = demonNpcs.get(player);
    if (!npc) return;
    demonNpcs.delete(player);
    if (npc.isRegistered?.() !== false) api.removeNpc(npc);
  }

  // ============================================================================
  // Black clothing (Evil Dave's gate)
  // ============================================================================

  /** Names the wiki says Dave does not accept even though they read "black". */
  const BLACK_ITEM_EXCEPTIONS = new Set([
    "black beret",
    "black boater",
    "black cavalier",
    "black defender",
    "black headband",
    "black knife",
    "black leprechaun hat",
    "black mask",
    "black satchel",
    "black spiky vambraces",
  ]);

  function isBlackClothing(name) {
    const value = String(name ?? "").toLowerCase();
    if (!value) return false;
    if (value === "darklight") return true;
    if (value === "priest gown" || value === "priest robe") return true;
    if (value.startsWith("ghostly ") || value.startsWith("shade robe")) return true;
    if (value.includes("mystic") && value.includes("(dark)")) return true;
    if (value.includes("graceful") && value.includes("hallowed")) return true;
    if (!value.startsWith("black ")) return false;
    if (value.startsWith("black naval") || value.startsWith("black elegant")) return false;
    if (value.startsWith("black mask")) return false;
    return !BLACK_ITEM_EXCEPTIONS.has(value);
  }

  function countBlackClothing(player) {
    let count = 0;
    for (const item of player.getEquipment().getItems() || []) {
      if (!item) continue;
      const id = item.getId?.();
      if (isBlackClothing(ItemDefinition.forId(id)?.getName?.())) count++;
    }
    return count;
  }

  // ============================================================================
  // Dialogue variant selection
  // ============================================================================

  /** The throne-room cast's talks by stage: before the summoning, in the ritual, in the fight, after it. */
  function roomVariant(stage, inside, ritual, fight, after) {
    if (stage >= STAGE_KILLED) return after;
    if (stage >= STAGE_SUMMONED) return fight;
    if (stage >= STAGE_READY) return ritual;
    return inside;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    const room = inThroneRoom(player);

    // The Uzer and Al Kharid copies (1984-1986, 913, 6277) and the throne room's own cast (893, 895,
    // 902, 917 ...) are different NPCs with their own talks (ours t1098 Reen in Uzer, t2087 in the room).
    if (npcId === REEN_ALKHARID_NPC_ID || (REEN_NPC_IDS.has(npcId) && !room && stage < STAGE_IN_GROUP)) {
      if (stage === STAGE_NOT_STARTED && !shadowPrereqsMet(player)) return null;
      if (stage >= STAGE_STARTED) return "starting-off-talking-to-father-reen-again";
      return "starting-off";
    }
    if (REEN_NPC_IDS.has(npcId)) {
      if (room && stage >= STAGE_RITUAL_DONE) {
        return roomVariant(stage, "performing-the-ritual-talking-to-father-reen-inside-the-throne-room",
          "summoning-agrith-naar-talking-to-everyone-in-the-ritual-father-reen",
          "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-father-reen",
          "after-killing-agrith-naar-father-reen");
      }
      if (stage >= STAGE_COMPLETE) return "after-killing-agrith-naar-father-reen";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-father-reen";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-father-reen-at-uzer";
      return null;
    }

    if (BADDEN_NPC_IDS.has(npcId)) {
      if (room && stage >= STAGE_RITUAL_DONE) {
        return roomVariant(stage, "performing-the-ritual-talking-to-father-badden-inside-the-throne-room",
          "summoning-agrith-naar-talking-to-everyone-in-the-ritual-father-badden",
          "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-father-badden",
          "after-killing-agrith-naar-father-badden");
      }
      if (stage >= STAGE_COMPLETE) return "after-killing-agrith-naar-father-badden";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-father-badden";
      if (stage >= STAGE_DENATH_TOLD) return "infiltrating-the-wizards-talking-to-father-badden";
      if (stage >= STAGE_IN_GROUP) {
        return stage >= STAGE_MATTHEW_TOLD
          ? "infiltrating-the-wizards-asking-around-about-last-night-father-badden"
          : "infiltrating-the-wizards-reporting-back-to-father-badden";
      }
      if (stage >= STAGE_INFILTRATE) return "to-uzer-talking-to-father-badden-again";
      if (stage >= STAGE_STARTED) return "to-uzer-talking-to-father-badden";
      return null;
    }

    if (DAVE_NPC_IDS.has(npcId)) {
      if (room && stage >= STAGE_RITUAL_DONE) {
        return roomVariant(stage, "performing-the-ritual-talking-to-evil-dave-inside-the-throne-room",
          "summoning-agrith-naar-talking-to-everyone-in-the-ritual-evil-dave",
          "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-evil-dave",
          "after-killing-agrith-naar-evil-dave");
      }
      if (stage >= STAGE_COMPLETE) return "after-killing-agrith-naar-evil-dave";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-evil-dave-2";
      // Ours t1671: at stage 80 in the room, his call to the circle.
      if (room && stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-evil-dave";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-evil-dave";
      if (stage >= STAGE_INFILTRATE) return "infiltrating-the-wizards";
      return "to-uzer-talking-to-evil-dave";
    }

    if (DENATH_NPC_IDS.has(npcId)) {
      // Ours t822 and t1644: one talk of his, its stage-80 part ("Get to your place") by condition.
      if (stage >= STAGE_IN_GROUP && stage <= STAGE_RITUAL) return "infiltrating-the-wizards-talking-to-the-dark-wizards-denath";
      return null;
    }

    if (MATTHEW_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_SUMMONED) return null; // killed by Agrith-Naar
      if (stage >= STAGE_READY) return "summoning-agrith-naar-talking-to-everyone-in-the-ritual-matthew";
      if (stage >= STAGE_PREPARE && peopleLeft(player) === 0) return "summoning-agrith-naar";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-matthew-again";
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-matthew";
      // Ours t1625: his readiness question; Denath calls the ritual nine ticks after it (scheduleRitualCall).
      if (stage >= STAGE_BOOK_SHOWN) return "infiltrating-the-wizards-talking-to-matthew-again-after-showing-him-the-book";
      if (stage >= STAGE_MATTHEW_TOLD) return "infiltrating-the-wizards-returning-to-matthew";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-matthew";
      return null;
    }

    if (JENNIFER_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_KILLED) return "after-killing-agrith-naar-jennifer";
      if (stage >= STAGE_SUMMONED) return "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-jennifer";
      if (stage >= STAGE_READY) return "summoning-agrith-naar-talking-to-everyone-in-the-ritual-jennifer";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-jennifer-2";
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-jennifer";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-jennifer";
      return null;
    }

    if (PATRICK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_KILLED) return "after-killing-agrith-naar-patrick";
      if (stage >= STAGE_SUMMONED) return "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-patrick";
      if (stage >= STAGE_READY) return "summoning-agrith-naar-talking-to-everyone-in-the-ritual-patrick";
      if (stage >= STAGE_RITUAL_DONE) return "performing-the-ritual-talking-to-patrick-2";
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-patrick";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-patrick";
      return null;
    }

    if (TANYA_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-tanya";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-tanya";
      return null;
    }

    if (ERIC_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_RITUAL) return "performing-the-ritual-talking-to-eric";
      if (stage >= STAGE_IN_GROUP) return "infiltrating-the-wizards-talking-to-the-dark-wizards-eric";
      return null;
    }

    if (GOLEM_NPC_IDS.has(npcId)) {
      // The throne-room golem (917) is not the Uzer one (6277).
      if (room && stage >= STAGE_RITUAL_DONE) {
        return roomVariant(stage, "performing-the-ritual-talking-to-the-golem-inside-the-throne-room",
          "summoning-agrith-naar-talking-to-everyone-in-the-ritual-clay-golem",
          "summoning-agrith-naar-talking-to-everyone-after-summoning-agrith-naar-clay-golem",
          "after-killing-agrith-naar-clay-golem");
      }
      if (stage >= STAGE_COMPLETE) {
        // Ours t2927: the Uzer golem, back after the quest.
        return { page: GOLEM_PAGE, variant: "standard-dialogue-after-completion-of-shadow-of-the-storm" };
      }
      if (stage >= STAGE_RITUAL_DONE) {
        return helperBits(player) & BIT_GOLEM_REPROGRAMMED
          ? "performing-the-ritual-talking-to-the-golem-after-reprogramming"
          : "performing-the-ritual-talking-to-the-clay-golem";
      }
      if (stage >= STAGE_GOLEM_TOLD) return "to-uzer-talking-to-the-clay-golem";
      if (stage >= STAGE_MATTHEW_TOLD) {
        return "infiltrating-the-wizards-asking-around-about-last-night-clay-golem";
      }
      // Ours t339 (stage 10) and t473 (stage 20): the Uzer golem's quest talk from the start.
      if (stage >= STAGE_STARTED) return "to-uzer-talking-to-the-clay-golem";
      return null;
    }

    return null;
  }

  // ============================================================================
  // Condition answers
  // ============================================================================

  /** Who has still to come back to the throne room (ours t2124: "We've got eight people now" once all four had arrived). */
  function peopleLeft(player) {
    return 4 - popcount(helperBits(player) & ALL_ARRIVED_MASK);
  }

  function popcount(value) {
    let count = 0;
    let bits = value;
    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
    return count;
  }

  function firstRitualCorrect(player) {
    const picks = ritualPicks.get(player);
    if (!Array.isArray(picks) || picks.length !== INCANTATION_WORDS.length) return false;
    // The first incantation is the reverse of Denath's order, as the demonic
    // tome gives it (Quest Helper IncantationStep(reverse = true)).
    const last = INCANTATION_WORDS.length - 1;
    return picks.every((word, index) => word === wordAt(player, last - index));
  }

  function secondRitualCorrect(player) {
    const picks = ritualPicks.get(player);
    if (!Array.isArray(picks) || picks.length !== INCANTATION_WORDS.length) return false;
    // The second incantation uses the tome/varbit order directly
    // (Quest Helper IncantationStep(reverse = false)).
    return picks.every((word, index) => word === wordAt(player, index));
  }

  function answerCondition({ player, npcId, stepId, text }) {
    if (!stepId) return null;

    if (COND_REF_START.has(stepId)) return ownsSilverlight(player);
    if (COND_REF_LOST.has(stepId)) return !ownsSilverlight(player);
    // Ours t80, t1122, t2100 (carried or worn) and t137 (banked): "Do you know where Silverlight is?"
    if (stepId === COND_SILVERLIGHT_CARRIED) return SILVERLIGHT_FORMS.some((itemId) => ownsItem(player, itemId));
    if (stepId === COND_SILVERLIGHT_BANKED) {
      return !SILVERLIGHT_FORMS.some((itemId) => ownsItem(player, itemId)) && SILVERLIGHT_FORMS.some((itemId) => bankedItem(player, itemId));
    }
    if (stepId === COND_DENATH_RITUAL) return quest.getStage(player) === STAGE_RITUAL;
    if (stepId === COND_DENATH_BEFORE) return quest.getStage(player) !== STAGE_RITUAL;

    if (stepId === COND_NOT_ENOUGH_BLACK) return countBlackClothing(player) < 3;
    if (stepId === COND_BLACK_UNDYED) {
      return countBlackClothing(player) >= 3 && !hasDyedSilverlight(player);
    }
    if (stepId === COND_BLACK_DYED) {
      return countBlackClothing(player) >= 3 && hasDyedSilverlight(player);
    }

    if (stepId === COND_THRONE_GEMS_REMOVED) return throneGemsRemoved(player);
    if (stepId === COND_THRONE_GEMS_PRESENT) return !throneGemsRemoved(player);

    if (stepId === COND_MOULD_FREE) {
      return !hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID) && !player.getInventory().isFull();
    }
    if (stepId === COND_MOULD_NO_SPACE) {
      return !hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID) && player.getInventory().isFull();
    }
    if (stepId === COND_MOULD_HELD) return hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID);

    if (stepId === COND_ERIC_WALKED_AWAY) return false;

    if (stepId === COND_MATTHEW_NO_BOOK) return !hasItem(player, DEMONIC_TOME_ITEM_ID);
    if (stepId === COND_MATTHEW_BOOK) return hasItem(player, DEMONIC_TOME_ITEM_ID);
    if (stepId === COND_MATTHEW_UNDYED) return !hasDyedSilverlight(player);
    if (stepId === COND_MATTHEW_DYED) return hasDyedSilverlight(player);

    const left = peopleLeft(player);
    if (stepId === COND_PEOPLE_FOUR) return left === 4;
    if (stepId === COND_PEOPLE_THREE) return left === 3;
    if (stepId === COND_PEOPLE_TWO) return left === 2;
    if (stepId === COND_PEOPLE_ONE) return left === 1;

    const bits = helperBits(player);
    if (stepId === COND_BADDEN_NO_SIGIL) return !(bits & BIT_BADDEN) && !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_BADDEN_SIGIL) return (bits & BIT_BADDEN) !== 0 || hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_REEN_NO_SIGIL) return !(bits & BIT_REEN) && !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_REEN_SIGIL) return (bits & BIT_REEN) !== 0 || hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_GOLEM_NO_SIGIL) return !(bits & BIT_GOLEM) && !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_GOLEM_SIGIL) return (bits & BIT_GOLEM) !== 0 || hasItem(player, DEMONIC_SIGIL_ITEM_ID);

    if (stepId === COND_SUMMON_NO_SIGIL) return !hasItem(player, DEMONIC_SIGIL_ITEM_ID);
    if (stepId === COND_SUMMON_NO_SWORD) {
      return hasItem(player, DEMONIC_SIGIL_ITEM_ID) && !hasSilverlight(player);
    }
    if (stepId === COND_SUMMON_READY) {
      return hasItem(player, DEMONIC_SIGIL_ITEM_ID) && hasSilverlight(player);
    }

    return null;
  }

  /** The Golem's throne gems flag (shared, persisted attribute of that quest). */
  function throneGemsRemoved(player) {
    return Boolean(player.getAttribute("quest.the_golem.throne_gems"));
  }

  // ============================================================================
  // Dialogue events
  // ============================================================================

  /** Ours t101-102 and t1560-1561: Reen's lines say he found it; the sword just arrives (no game message). */
  function restoreSilverlight(player, itemId = SILVERLIGHT_ITEM_ID) {
    if (ownsSilverlight(player)) return;
    if (player.getInventory().isFull()) return;
    player.getInventory().adds(itemId, 1);
  }

  /** Badden, Reen and the golem take a sigil from the player as their line is continued (ours t1918, t1999, t2021). */
  function recruitHelper(player, bit, key, npc) {
    const bits = helperBits(player);
    if (bits & bit) return;
    if (quest.getStage(player) < STAGE_RITUAL_DONE || quest.getStage(player) >= STAGE_SUMMONED) return;
    if (!hasItem(player, DEMONIC_SIGIL_ITEM_ID)) return;
    player.getInventory().deleteNumber(DEMONIC_SIGIL_ITEM_ID, 1);
    finishRecruit(player, bit, key, npc);
  }

  function recruitEvilDave(player, npc) {
    const bits = helperBits(player);
    if (bits & BIT_DAVE) return;
    if (player.getInventory().isFull()) {
      // As captured (rsprox 3333, ticks 2168 and 2184-2192): he says so after his offer, and keeps the sigil.
      afterDialogue(player, () => startDialogue(api, player, { npcId: NpcIdentifiers.EVIL_DAVE_2 }, [
        { npc: ["But you'll need to free some inventory space first!"] },
      ]));
      return;
    }
    // Ours t1889: the sigil arrives with no game message.
    player.getInventory().adds(DEMONIC_SIGIL_ITEM_ID, 1);
    finishRecruit(player, BIT_DAVE, "dave", npc);
  }

  /**
   * The helper's varbit goes to 2 and their walking copy heads off where the waiting one stood; it
   * reaches 3 once they have arrived (ARRIVAL_TICKS). The stage stays: Tanya's death made it 100 and
   * Matthew's "Okay, here we go" makes it 110 (ours t1845, t2135).
   */
  function finishRecruit(player, bit, key, npc) {
    setHelperBits(player, helperBits(player) | bit);
    syncShadowVarbits(player);
    walkOff(player, key, npc);
    Scenes.later(player, ARRIVAL_TICKS.get(bit), () => arrive(player, bit));
  }

  function arrive(player, bit) {
    const bits = helperBits(player);
    const arrived = ARRIVED_BIT.get(bit);
    if (!(bits & bit) || bits & arrived) return;
    setHelperBits(player, bits | arrived);
    syncShadowVarbits(player);
    ensureWizardNpcs(player);
  }

  /** A helper recruited and not yet arrived (a relog on the way) has arrived. */
  function settleArrivals(player) {
    let bits = helperBits(player);
    for (const [bit, arrived] of ARRIVED_BIT) if (bits & bit) bits |= arrived;
    setHelperBits(player, bits);
  }

  const walkers = new WeakMap();

  /** The walking copy, only the owner sees: from the talked-to NPC's tile to WALKERS' tile, then gone. */
  function walkOff(player, key, npc) {
    const walker = WALKERS.get(key);
    const from = npc?.getLocation?.() ?? player.getLocation();
    if (!walker) return;
    const copy = api.spawnNpc({ id: walker.id, x: from.getX(), y: from.getY(), z: from.getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (!copy) return;
    copy.__skipDefaultRespawn = true;
    let mine = walkers.get(player);
    if (!mine) walkers.set(player, mine = new Set());
    mine.add(copy);
    copy.getMovementQueue().addCheckpoint?.(new Location(...walker.to));
    Scenes.later(player, walker.ticks, () => {
      mine.delete(copy);
      if (copy.isRegistered?.() !== false) api.removeNpc(copy);
    });
  }

  function removeWalkers(player) {
    for (const copy of walkers.get(player) ?? []) if (copy.isRegistered?.() !== false) api.removeNpc(copy);
    walkers.delete(player);
  }

  /**
   * A quest drop only its owner sees, as the capture's (ownership self, never public). In the throne
   * room it belongs to the room's copy and goes with it (live: the instance's), so a sigil left there
   * is lost, as the Wiki warns; outside it is the world's.
   */
  function dropFor(player, itemId, [x, y, z]) {
    const tile = new Location(x, y, z);
    const area = z === 2 && inThroneRoom(player) ? player.getPrivateArea?.() ?? null : null;
    if (itemOnGroundManager.getGroundItem(player.getUsername(), itemId, tile, area)) return;
    itemOnGroundManager.registerLocation(player, new Item(itemId, 1), tile, area);
  }

  function inRitualCircle(player) {
    return player.getLocation().isWithinDistance(
      new Location(RITUAL_TILE.x, RITUAL_TILE.y, RITUAL_TILE.z), 8);
  }

  function shake(player, random) {
    CameraShake.send(player.getPacketSender(), "atmospheric", 1, random, 0, 0);
  }

  const RITUAL_CAMERA_LOOK = [2720, 4900, 150];
  /** The camera each word moves to (ours t1684-t1736 from 2726,4901; t2147-t2198 from 2720,4894 with a shake). */
  const FIRST_WORD_CAMERA = [[2726, 4903, 600], [2725, 4904, 650], [2724, 4905, 700], [2723, 4906, 750], [2722, 4907, 800]];
  const SECOND_WORD_CAMERA = [[2719, 4894, 600], [2718, 4895, 650], [2717, 4896, 700], [2716, 4897, 750], [2715, 4899, 800]];

  /** Stage 80 on its spot (ours t1680): the camera on the circle and the first of five word menus. */
  function startFirstIncantation(player) {
    if (quest.getStage(player) !== STAGE_RITUAL) return;
    if (!packedIncantation(player)) assignIncantation(player);
    widenRitualView(player);
    ritualPicks.delete(player);
    const scene = roomScene(player, "first-ritual");
    scene.__ritualWords = FIRST_WORD_CAMERA;
    ensureWizardNpcs(player);
    Scenes.camera(player, [2726, 4901, 550], RITUAL_CAMERA_LOOK);
    player.setPositionToFace(new Location(RITUAL_CENTER.x, RITUAL_CENTER.y, RITUAL_CENTER.z));
    playRitualMenus(player, NpcIdentifiers.DENATH, FIRST_RITUAL_VARIANT, () => resolveFirstIncantation(player));
  }

  /** Stage 110 on its spot (ours t2142-t2143). */
  function startSecondIncantation(player) {
    if (quest.getStage(player) !== STAGE_READY) return;
    widenRitualView(player);
    ritualPicks.delete(player);
    const scene = roomScene(player, "second-ritual");
    scene.__ritualWords = SECOND_WORD_CAMERA;
    ensureWizardNpcs(player);
    player.setPositionToFace(new Location(RITUAL_CENTER.x, RITUAL_CENTER.y, RITUAL_CENTER.z));
    Scenes.camera(player, [2720, 4894, 550], RITUAL_CAMERA_LOOK);
    playRitualMenus(player, NpcIdentifiers.MATTHEW, SECOND_RITUAL_VARIANT, () => resolveSecondIncantation(player));
  }

  /** Keep the whole chorus local and visible while it speaks. */
  function widenRitualView(player) {
    if (typeof player.getNpcViewDistance !== "function") return;
    if (!ritualViewDistances.has(player)) ritualViewDistances.set(player, player.getNpcViewDistance());
    const distance = Math.max(...RITUAL_CAST.map(({ x, y }) => Math.max(Math.abs(x - RITUAL_TILE.x), Math.abs(y - RITUAL_TILE.y)))) + 1;
    player.setNpcViewDistance(Math.max(player.getNpcViewDistance(), distance));
  }

  /** A word picked (handleChoice): its camera and the chorus's animation in the same tick (ours t1684), sigils out on the first. */
  function ritualWord(player, picks) {
    const scene = Scenes.get(player);
    const beats = scene?.__ritualWords;
    if (!beats || picks.length > beats.length) return;
    if (picks.length === 1) holdSigils(player, true);
    const [x, y, height] = beats[picks.length - 1];
    Scenes.camera(player, [x, y, height], RITUAL_CAMERA_LOOK, { rate: 1, rate2: 1 });
    if (scene.phase === "second-ritual") shake(player, picks.length);
    animateRitualCast(player, false);
  }

  /**
   * The incantation variants hold one 5-word menu followed by five "[Word N]"
   * echo pairs and the two outcome conditions. Conditions resolve when the
   * dialogue is built, i.e. before any word is picked, so expand the single menu
   * into the wiki's five selections, drop the outcomes, and evaluate afterwards.
   * The first ritual's "[player name] will lead us" comes after a wrong chant (ours t1708), not first.
   */
  function ritualMenuSteps(steps, outcomeIds) {
    const queue = withoutConditions(steps, outcomeIds);
    const choiceIndex = queue.findIndex((step) => step.type === "choice");
    if (choiceIndex === -1) return queue;
    const choice = queue[choiceIndex];
    const echoes = [];
    const after = [];
    for (const step of queue.slice(choiceIndex + 1)) {
      const text = typeof step.player === "string" ? step.player : step.type === "line" ? step.text : "";
      if (/\[Word \d/.test(String(text ?? "")) && echoes.length < 10) echoes.push(step);
      else after.push(step);
    }
    if (echoes.length < 10) return queue;
    const expanded = [];
    for (let pick = 0; pick < 5; pick++) {
      expanded.push({ ...choice, options: choice.options.map((option) => ({ ...option })) });
      expanded.push(echoes[pick * 2], echoes[pick * 2 + 1]);
    }
    return [...expanded, ...after];
  }

  function playRitualMenus(player, npcId, variant, onDone) {
    const outcomeIds = new Set([COND_RITUAL_WRONG, COND_RITUAL_CORRECT, COND_SUMMON_BACKWARDS, COND_SUMMON_CORRECT]);
    const scene = Scenes.get(player);
    if (!startTranscript(api, player, npcId, PAGE, variant, (steps) => ritualMenuSteps(steps, outcomeIds))) {
      return;
    }
    // The chat closes for a tick between a word's overhead echo and the next menu, so the chant is
    // over once five words are said and the chat has closed, or the chat has stayed shut (walked off).
    let shut = 0;
    const watch = () => {
      if (player.isRegistered?.() === false || Scenes.get(player) !== scene) return;
      if (chatboxOpen(player)) shut = 0;
      else shut++;
      const said = ritualPicks.get(player)?.length ?? 0;
      if (said >= INCANTATION_WORDS.length && shut > 0) { onDone(); return; }
      if (shut >= 3) { abandonChant(player); return; }
      Scenes.later(scene ?? player, 1, watch);
    };
    Scenes.later(scene ?? player, 1, watch);
  }

  /** A chant left part-way: the camera back and the sigils kept out, as after a wrong one (ours t1708). */
  function abandonChant(player) {
    restoreRitualView(player);
    ritualPicks.delete(player);
    player.performAnimation(new Animation(-1));
    player.getPacketSender().sendCameraReset();
  }

  function playOutcome(player, npcId, variant, conditionId, edit = (steps) => steps) {
    startTranscript(api, player, npcId, PAGE, variant, (steps) =>
      edit(conditionSteps(steps, conditionId).filter((step) => step.type !== "reference")), wizardNpcs.get(player)?.get(npcId === NpcIdentifiers.DENATH ? "denath" : "matthew") ?? null);
  }

  const BOOM_STEP_ID = "shadow-boom";
  const DENATH_LEAD_US = "[player name] will lead us in the incantation.";

  /**
   * Ours t1703 (wrong) and t1739 (right), three ticks after the last word's line: the chorus's 2880.
   * Wrong: t1706 Denath's "You fool!" overhead and in the chatbox (his sigil head), t1708 his "will lead
   * us" overhead and the camera back; the sigils stay out for the next try. Right: stage 90 and the
   * closing cutscene (startFirstRitualClosing).
   */
  function resolveFirstIncantation(player) {
    restoreRitualView(player);
    if (quest.getStage(player) !== STAGE_RITUAL) return;
    const correct = firstRitualCorrect(player);
    ritualPicks.delete(player);
    animateRitualCast(player, true, correct);
    if (correct) {
      setStage(player, STAGE_RITUAL_DONE);
      startFirstRitualClosing(player);
      return;
    }
    const scene = Scenes.get(player);
    Scenes.later(scene ?? player, 3, () => {
      wizardNpcs.get(player)?.get("denath")?.forceChat("You fool! Do it again, and get it right!");
      playOutcome(player, NpcIdentifiers.DENATH, FIRST_RITUAL_VARIANT, COND_RITUAL_WRONG);
    });
    Scenes.later(scene ?? player, 5, () => {
      player.performAnimation(new Animation(-1));
      wizardNpcs.get(player)?.get("denath")?.forceChat(DENATH_LEAD_US.replace("[player name]", player.getDisplayName()));
      player.getPacketSender().sendCameraReset();
    });
  }

  /**
   * Ours t1742-t1788, the closing cutscene. Its timed beats run from the chant's end; each line carries
   * its own camera (closingLine), so a slow reader sees each shot with its line.
   */
  function startFirstRitualClosing(player) {
    const scene = roomScene(player, "first-ritual-close");
    Scenes.later(scene, 3, () => {
      beginCutscene(player);
      player.sendMessage(""); // t1742: a blank game message as the cutscene starts
      const circle = phaseLoc(scene, { id: AGRITH_RITUAL_CIRCLE_OBJECT_ID, x: 2719, y: 4899, face: 0 });
      scene.__shadowCircle = circle;
      player.getPacketSender().sendSoundEffect(AGRITH_CIRCLE_SOUND, 1, 0);
      Scenes.camera(player, [2720, 4907, 500], RITUAL_CAMERA_LOOK, { rate: 2, rate2: 2 });
      playOutcome(player, NpcIdentifiers.DENATH, FIRST_RITUAL_VARIANT, COND_RITUAL_CORRECT, withBoom);
      guardCutscene(player, scene, "first-ritual-close", () => endClosing(player, scene));
    });
    const denath = wizardNpcs.get(player)?.get("denath");
    if (denath) denath.__shadowLeaving = true;
    Scenes.later(scene, 6, () => denath?.performGraphic?.(new Graphic(GFX_AGRITH_SUMMON)));
    Scenes.later(scene, 9, () => denath?.performAnimation?.(new Animation(SEQ_DENATH_LEAVE)));
    Scenes.later(scene, 12, () => {
      if (wizardNpcs.get(player)?.get("denath") === denath) {
        setHelperBits(player, helperBits(player) | BIT_DENATH);
        removeWizard(player, "denath");
      }
      removeSceneLoc(scene, scene.__shadowCircle);
      // t1751: Denath's sigil where he stood, for the player to take (the Wiki: or make another).
      dropFor(player, DEMONIC_SIGIL_ITEM_ID, [2720, 4900, 2]);
      player.getPacketSender().sendAreaSound(TELEPORT_REVERSE_SOUND, 2720, 4900, 2, 1, 0, 5);
    });
    Scenes.later(scene, 14, () => holdSigils(player, false));
  }

  /** The Wiki's "unavailable" step there is the BOOM box (ours t1771). */
  function withBoom(steps) {
    return steps.map((step) => (step.type === "unavailable"
      ? { type: "message", text: "<col=800000>BOOM!", id: BOOM_STEP_ID }
      : step));
  }

  const AGRITH_CIRCLE_SOUND = 1313;
  const TELEPORT_REVERSE_SOUND = 201;
  const EXPLOSION_SOUND = 1487;
  const PORTAL_CLOSE_SOUND = 1311;
  const SEQ_EMOTE_THINK = 857;

  /** The closing cutscene's lines and the shot each opens with (ours t1753-t1788). */
  const CLOSING_LINES = [
    { line: /^Oh my gods!/, camera: [[2718, 4900, 300], [2723, 4899, 150]], drift: [2720, 4900, 300] },
    { line: /^Where'd he go\?/, camera: [[2722, 4900, 500], [2717, 4901, 150]], drift: [2718, 4900, 900],
      run: (p) => wizardNpcs.get(p)?.get("patrick")?.performAnimation(new Animation(SEQ_EMOTE_THINK)) },
    { line: /^Of course! How could we be so stupid\?/, camera: [[2716, 4904, 300], [2719, 4902, 150]] },
    { line: /^What happened\?/, player: true, camera: [[2722, 4904, 300], [2718, 4902, 150]] },
    { line: /^What do you get when you perform a summoning ritual backwards\?/, camera: [[2720, 4907, 300], [2719, 4902, 150]] },
    { line: /^Denath was Agrith-Naar all along! We've just helped him/, camera: [[2722, 4896, 800], [2719, 4902, 150]], drift: [2722, 4894, 1200] },
    { line: /^What was that\?!/, camera: [[2723, 4899, 300], [2719, 4902, 150]], run: (p, scene) => {
      if (!scene.__shadowClosedPortal) scene.__shadowClosedPortal = phaseLoc(scene, { id: AGRITH_PORTAL_CLOSING_OBJECT_ID, x: 2719, y: 4883, face: 0 });
      shake(p, 1);
    } },
    { line: /^Look! The portal's closing!/, camera: [[2718, 4906, 500], [2720, 4883, 300]], drift: [2718, 4890, 500], driftRate: 10,
      run: (p) => p.getPacketSender().sendSoundEffect(PORTAL_CLOSE_SOUND, 1, 0) },
    { line: /^I'm getting out of here!/, camera: [[2722, 4887, 500], [2720, 4897, 150]], run: (p) => runAway(p) },
    { line: /^No, don't leave!/, camera: [[2718, 4905, 300], [2720, 4897, 150]] },
    { line: /^Who knows what Denath could do now\?/, camera: [[2717, 4903, 250], [2719, 4902, 150]], rate: 1 },
    { line: /^We've got to perform the ritual again so you can kill Agrith-Naar\. But we need/, camera: [[2720, 4897, 350], [2719, 4902, 150]], drift: [2720, 4887, 350] },
    { line: /^Quick, /, run: (p, scene) => endClosing(p, scene) },
  ];

  function closingLine(event, text) {
    const scene = Scenes.get(event.player);
    if (scene?.phase !== "first-ritual-close") return;
    const isPlayerLine = typeof event.step?.player === "string";
    const entry = CLOSING_LINES.find((candidate) => Boolean(candidate.player) === isPlayerLine && candidate.line.test(text));
    if (!entry) return;
    const player = event.player;
    lineBefore(event, () => {
      if (Scenes.get(player) !== scene) return;
      if (entry.camera) {
        const rates = entry.rate ? { rate: entry.rate, rate2: entry.rate } : Scenes.CAMERA_RATES;
        Scenes.camera(player, entry.camera[0], entry.camera[1], rates);
      }
      if (entry.drift) {
        const rate = entry.driftRate ?? 1;
        Scenes.camera(player, entry.drift, entry.camera[1], { rate, rate2: rate });
      }
      entry.run?.(player, scene);
    });
  }

  /** Ours t1776-t1788: Dave, Eric and Tanya head for the portal and are gone when the cutscene ends. */
  function runAway(player) {
    for (const key of RUNAWAY_KEYS) {
      const npc = wizardNpcs.get(player)?.get(key);
      if (!npc) continue;
      npc.__shadowLeaving = true;
      npc.setNpcTransformationId(-1);
      api.core.PathFinder?.calculateWalkRoute(npc, 2720, 4887);
    }
  }

  function endClosing(player, scene) {
    if (scene.phase !== "first-ritual-close") return;
    for (const key of RUNAWAY_KEYS) removeWizard(player, key);
    scene.phase = null;
    endCutscene(player);
  }

  /** Ours t2226: the cutscene ends, the sigils go away, everyone turns to him and he attacks. */
  function demonAttacks(player) {
    const scene = Scenes.get(player);
    if (scene?.phase !== "summoning") return;
    killMatthew(player);
    spawnAgrithNaar(player);
    scene.phase = "fight";
    holdSigils(player, false);
    endCutscene(player);
    const demon = demonNpcs.get(player);
    if (demon) {
      for (const npc of wizardNpcs.get(player)?.values() ?? []) npc.setPositionToFace(demon.getLocation());
      demon.getCombat?.().attack?.(player);
    }
    scatterCast(player);
  }

  /**
   * The cutscene state on, with the side tabs closed as live closes them (ours t716-t719,
   * t1741-t1743, t2200-t2202): nothing in the inventory can close the chat mid-scene.
   */
  function beginCutscene(player) {
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
  }

  /** And off, the tabs back (t772-t774, t1788-t1790, t2225-t2227) and the camera on the player. */
  function endCutscene(player) {
    Scenes.controls(player, false);
    Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraReset();
  }

  /**
   * Ours: a scene that ends on a line also ends if its talk is gone (the chat shut for three ticks:
   * a relogged client, an interface closed), the way its last line would end it.
   */
  function guardCutscene(player, scene, phase, finish) {
    let shut = 0;
    const watch = () => {
      if (player.isRegistered?.() === false || Scenes.get(player) !== scene || scene.phase !== phase) return;
      shut = Scenes.chatOpen(player) ? 0 : shut + 1;
      if (shut >= 3) { finish(); return; }
      Scenes.later(scene, 1, watch);
    };
    Scenes.later(scene, 1, watch);
  }

  /**
   * Ours t2166 (backwards: 2880, then t2169 Matthew's "No, we need to perform the ritual forwards"
   * overhead and in the chatbox, t2171 the camera back) and t2201 (right: stage 120 and the summoning).
   */
  function resolveSecondIncantation(player) {
    restoreRitualView(player);
    if (quest.getStage(player) !== STAGE_READY) return;
    const correct = secondRitualCorrect(player);
    ritualPicks.delete(player);
    animateRitualCast(player, true, correct);
    const scene = Scenes.get(player);
    if (!correct) {
      Scenes.later(scene ?? player, 3, () => {
        wizardNpcs.get(player)?.get("matthew")?.forceChat("No, we need to perform the ritual forwards, as it appears in the book!");
        playOutcome(player, NpcIdentifiers.MATTHEW, SECOND_RITUAL_VARIANT, COND_SUMMON_BACKWARDS);
      });
      Scenes.later(scene ?? player, 5, () => {
        player.performAnimation(new Animation(-1));
        player.getPacketSender().sendCameraReset();
      });
      return;
    }
    setStage(player, STAGE_SUMMONED);
    startSummoning(player);
  }

  /**
   * Ours t2201-t2226. t2201: the cutscene state, the magic circle and the open portal back (6282
   * over the closing one), the circle sound and camera; t2204 Agrith-Naar appears (482, 4623, his
   * sound, "Grip of the Talon" unlocked); t2210 the circle goes; his lines and Matthew's death carry
   * their shots (summonLine); t2226 the cutscene ends, the sigils go away and he casts Telekinetic Grab.
   */
  function startSummoning(player) {
    const scene = roomScene(player, "summoning");
    beginCutscene(player);
    player.sendMessage(""); // t2201: a blank game message as the cutscene starts
    const circle = phaseLoc(scene, { id: AGRITH_RITUAL_CIRCLE_OBJECT_ID, x: 2719, y: 4899, face: 0 });
    if (scene.__shadowClosedPortal) {
      removeSceneLoc(scene, scene.__shadowClosedPortal);
      scene.__shadowClosedPortal = null;
    }
    player.getPacketSender().sendSoundEffect(AGRITH_CIRCLE_SOUND, 1, 0);
    Scenes.camera(player, [2722, 4907, 500], [2720, 4900, 500]);
    Scenes.camera(player, [2719, 4907, 500], [2720, 4900, 500], { rate: 1, rate2: 1 });
    Scenes.later(scene, 3, () => {
      spawnAgrithNaar(player);
      playOutcome(player, NpcIdentifiers.MATTHEW, SECOND_RITUAL_VARIANT, COND_SUMMON_CORRECT);
      guardCutscene(player, scene, "summoning", () => demonAttacks(player));
    });
    Scenes.later(scene, 9, () => removeSceneLoc(scene, circle));
  }

  const SUMMON_LINES = [
    { line: /^He didn't summon you\./, player: true, camera: [[2718, 4897, 400], [2720, 4903, 150]] },
    { line: /^I did!/, player: true, camera: [[2719, 4900, 350], [2720, 4903, 150]], drift: [2719, 4900, 900],
      run: (p) => p.performAnimation(new Animation(SEQ_EMOTE_ANGRY)) },
    { line: /^Then prepare to die!/, camera: [[2719, 4909, 500], [2720, 4900, 150]], drift: [2719, 4905, 1000] },
  ];

  function summonLine(event, text) {
    const scene = Scenes.get(event.player);
    if (scene?.phase !== "summoning") return;
    const isPlayerLine = typeof event.step?.player === "string";
    const entry = SUMMON_LINES.find((candidate) => Boolean(candidate.player) === isPlayerLine && candidate.line.test(text));
    if (!entry) return;
    const player = event.player;
    lineBefore(event, () => {
      Scenes.camera(player, entry.camera[0], entry.camera[1]);
      if (entry.drift) Scenes.camera(player, entry.drift, entry.camera[1], { rate: 1, rate2: 1 });
      entry.run?.(player);
    });
  }

  function assignIncantation(player) {
    // Ours t815 (1,4,0,3,2) and rsprox 3333 (3,2,4,0,1): each player's order is their own (the Wiki:
    // "The chant differs from player to player"), a shuffle of the five words into varbits 1373-1377.
    const order = [0, 1, 2, 3, 4];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let packed = 0;
    for (let i = 0; i < order.length; i++) packed |= (order[i] & 7) << (i * 3);
    player.setAttribute(INCANTATION_ATTRIBUTE, packed);
    for (let i = 0; i < VARBIT_INCANTATION_WORDS.length; i++) {
      player.getPacketSender().sendVarbit(VARBIT_INCANTATION_WORDS[i], order[i]);
    }
  }

  /** A variant without the given condition wrappers (the ritual outcome tails). */
  function withoutConditions(steps, conditionIds) {
    return steps.filter((step) => !(step.type === "condition" && conditionIds.has(step.id)));
  }

  /** The body of one condition step, anywhere in the given steps. */
  function conditionSteps(steps, conditionId) {
    for (const step of steps ?? []) {
      if (step.type === "condition" && step.id === conditionId) return step.steps ?? [];
      if (Array.isArray(step.steps)) {
        const found = conditionSteps(step.steps, conditionId);
        if (found.length) return found;
      }
    }
    return [];
  }

  /**
   * Rsprox 3333 t2475-t2483: as he attacks, the cast walk off to these tiles. Rsprox 572 t1385-t1420
   * walks at the same moment, to other tiles, and both keep moving, so the wander after is ours.
   */
  function scatterCast(player) {
    const tracked = wizardNpcs.get(player);
    if (!tracked) return;
    for (const [key, [x, y]] of Object.entries(CAST_SCATTER)) {
      const npc = tracked.get(key);
      if (!npc) continue;
      npc.__shadowScattered = true;
      api.core.PathFinder?.calculateWalkRoute(npc, x, y);
      TaskManager.submit(new CountdownTask(player, CAST_SCATTER_TICKS, () => {
        npc.getMovementCoordinator?.().setRadius(CAST_WANDER_RADIUS);
      }));
    }
  }

  const AGRITH_APPEAR_SOUND = 1312;

  /** Ours t2204: on the circle, facing south, with 482, 4623 and his sound, and "Grip of the Talon". */
  function spawnAgrithNaar(player) {
    if (demonNpcs.has(player)) return;
    const scene = roomScene(player, Scenes.get(player)?.phase ?? "summoning");
    // A scene actor: in the player's private area, removed with the scene.
    const npc = Scenes.actor(scene, NpcIdentifiers.AGRITH_NAAR, [DEMON_TILE.x, DEMON_TILE.y, DEMON_TILE.z], null, { direction: 0 });
    if (!npc) return;
    demonNpcs.set(player, npc);
    // The Wiki: "he stays in the same position" (the north-western torch flinch). Ours t2229-t2758
    // has him shift a tile or two after the player; listed as a recorded difference.
    npc.getMovementQueue?.().setBlockMovement?.(true)?.reset?.();
    npc.performAnimation?.(new Animation(SEQ_AGRITH_SUMMONED));
    npc.performGraphic?.(new Graphic(GFX_AGRITH_SUMMON));
    player.getPacketSender().sendSoundEffect(AGRITH_APPEAR_SOUND, 1, 0);
    playTrack(player, MUSIC_GRIP_OF_THE_TALON);
  }

  function convertSilverlightToDarklight(player) {
    const equipment = player.getEquipment();
    const slot = (equipment.getItems() || []).findIndex(
      (item) =>
        item &&
        (item.getId?.() === DYED_SILVERLIGHT_ITEM_ID || item.getId?.() === SILVERLIGHT_ITEM_ID)
    );
    if (slot >= 0) {
      equipment.set(slot, new Item(DARKLIGHT_ITEM_ID, 1)).refreshItems();
      player.getUpdateFlag?.().flag?.(Flag.APPEARANCE);
      return;
    }
    const inventory = player.getInventory();
    if (inventory.getAmount(DYED_SILVERLIGHT_ITEM_ID) > 0) {
      inventory.deleteNumber(DYED_SILVERLIGHT_ITEM_ID, 1);
    } else if (inventory.getAmount(SILVERLIGHT_ITEM_ID) > 0) {
      inventory.deleteNumber(SILVERLIGHT_ITEM_ID, 1);
    }
    inventory.adds(DARKLIGHT_ITEM_ID, 1);
  }

  function completeQuest(player) {
    if (quest.isComplete(player)) return;
    const skill = chosenSkill(player);
    if (skill) {
      quest.xpRewards = [{ skillId: skill.getIndex(), amount: COMBAT_XP, label: skill.getName() }];
    }
    quest.complete(player);
    // complete() sets the stage itself, so re-send the sibling varbits. The room stays as it is,
    // its cast too, until the player leaves (ours t2786-t2855).
    syncShadowVarbits(player);
    removeDemon(player);
  }

  function handleConditionEvent(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    // The stage and helper changes happen on the lines the capture shows them with (LINE_TRIGGERS), not
    // when a condition is entered: a condition is entered before the menus under it are answered.
    if (COND_REEN_LOST.has(stepId)) {
      // Ours t2109: in the throne room he hands back the dyed sword; t1561 in Uzer he has "given it a good clean".
      restoreSilverlight(player, stepId === COND_REEN_ROOM_LOST ? DYED_SILVERLIGHT_ITEM_ID : SILVERLIGHT_ITEM_ID);
      return;
    }
    if (stepId === COND_MOULD_FREE) {
      // Ours t1263 and t1280: Jennifer's line hands it over, with no game message; dropped, she gives another.
      if (!hasItem(player, DEMONIC_SIGIL_MOULD_ITEM_ID) && !player.getInventory().isFull()) {
        player.getInventory().adds(DEMONIC_SIGIL_MOULD_ITEM_ID, 1);
      }
      return;
    }
  }

  /** Message steps the capture shows in the chatbox's message box (229), not as game messages. */
  const BOXED_MESSAGES = [
    /^A magic circle appears in the floor/, // t1742
    /^You open the golem's head and search through the dusty scrolls inside/, // t2006
    /^You find one that says/, // t2008
  ];

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (event.kind === "message" && BOXED_MESSAGES.some((pattern) => pattern.test(String(event.text ?? "")))) {
      event.box = { statement: true };
      if (/^You find one that says/.test(String(event.text ?? ""))) player.getPacketSender().sendSoundEffect(GOLEM_PROGRAM_SOUND, 1, 0);
      if (stepId !== ACTION_GOLEM_REPROGRAMMED) return;
    }
    if (!stepId) return;

    // Capture 572/3333: only the slice line shows, in an item box with the dyed sword.
    if (stepId === MSG_DYE_PICK_MUSHROOM) {
      event.handled = true;
      return;
    }
    // Rsprox 572 lines 28126-28200: the sword's lines in object boxes, the next in a statement.
    if (stepId === MSG_KILL_WIPE) {
      event.box = { items: [DARKLIGHT_ITEM_ID] };
      return;
    }
    if (stepId === MSG_KILL_POWER) {
      event.box = { statement: true };
      return;
    }
    // Ours t1613: Matthew's read, in an object box with the book.
    if (stepId === MSG_MATTHEW_READS) {
      event.box = { items: [DEMONIC_TOME_ITEM_ID] };
      return;
    }
    if (stepId === MSG_DYE_SLICE) {
      event.box = { items: [DYED_SILVERLIGHT_ITEM_ID] };
      return;
    }
    if (stepId === MSG_REEN_GIVES_SWORD) {
      restoreSilverlight(player);
      return; // leave the wiki message to play
    }
    if (stepId === MSG_ESCORT_THRONE) {
      // Ours t716: the message box over the fade-out, then the escort scene from t717.
      event.handled = true;
      event.end = true;
      startEscort(player);
      return;
    }
    if (stepId === MSG_DAVE_RETURNS) {
      // Ours t1889: no message; the sigil arrives and Dave walks off north.
      event.handled = true;
      recruitEvilDave(player, event.npc);
      return;
    }
    if (stepId === MSG_TANYA_KILLED) {
      // Ours t1845: a game message from the scene itself (beginPortalClosing), not a box.
      event.handled = true;
      if (tanyaKilled(player)) player.sendMessage("You see Tanya killed by ghosts!");
      return;
    }
    if (stepId === ACTION_RITUAL_ASSEMBLES) {
      // The player leads it with Chant on their sigil from their place (handleItemAction).
      event.handled = true;
      assembleRitual(player);
      return;
    }
    if (stepId === ACTION_MATTHEW_KILLED) {
      // Ours t2211: Agrith-Naar's Fire Blast at Matthew; t2212 it lands and he falls (matthewLine).
      event.handled = true;
      const demon = demonNpcs.get(player);
      const matthew = wizardNpcs.get(player)?.get("matthew");
      if (demon && matthew) {
        demon.performAnimation(new Animation(FIRE_BLAST.anim));
        const at = demon.getLocation();
        player.getPacketSender().sendAreaSound(FIREBLAST_CAST_SOUND, at.getX(), at.getY(), at.getZ(), 1, 0, 10);
        Projectile.createProjectile(demon, matthew, FIRE_BLAST.projectile, FIRE_BLAST.start, FIRE_BLAST.end,
          FIRE_BLAST.startHeight, FIRE_BLAST.endHeight).withAngle(16).withProgress(64).sendProjectile();
      }
      return;
    }
    if (stepId === ACTION_DEMON_ATTACKS) {
      event.handled = true;
      demonAttacks(player);
      return;
    }
    if (stepId === BOOM_STEP_ID) {
      // Ours t1771: the box, the explosion and a hard shake, the camera on the circle.
      event.box = { statement: true };
      player.getPacketSender().sendSoundEffect(EXPLOSION_SOUND, 1, 0);
      shake(player, 15);
      Scenes.camera(player, [2717, 4905, 300], [2719, 4900, 150]);
      return;
    }
    if (stepId === ACTION_GOLEM_REPROGRAMMED) {
      const bits = helperBits(player);
      if (!(bits & BIT_GOLEM_REPROGRAMMED)) setHelperBits(player, bits | BIT_GOLEM_REPROGRAMMED);
      syncShadowVarbits(player);
      return;
    }
    if (stepId === ACTION_QUEST_COMPLETE) {
      event.handled = true;
      event.end = true;
      completeQuest(player);
      return;
    }
  }

  function handleChoice({ player, npcId, option }) {
    if (!player) return;
    const text = String(option ?? "");

    const wordIndex = WORD_INDEX.get(text.toLowerCase());
    // The ritual menus are played as Denath's (first) and Matthew's (second).
    if (wordIndex !== undefined && (DENATH_NPC_IDS.has(npcId) || MATTHEW_NPC_IDS.has(npcId))) {
      let picks = ritualPicks.get(player);
      if (!Array.isArray(picks) || picks.length >= INCANTATION_WORDS.length) picks = [];
      picks.push(wordIndex);
      ritualPicks.set(player, picks);
      ritualWord(player, picks);
      return;
    }

    const skill = SKILL_BY_OPTION.get(text);
    if (skill && quest.getStage(player) === STAGE_KILLED) {
      player.setAttribute(REWARD_ATTRIBUTE, skill.getIndex());
      return;
    }

    // The words are drawn as the player asks, so Denath's next lines can say them; the stage moves
    // with his "You must memorize" line (LINE_TRIGGERS, ours t811 -> t815).
    // Denath's question, in his own talk or in Evil Dave's escort talk (ours t811).
    const fromDenath = DENATH_NPC_IDS.has(npcId) || DAVE_NPC_IDS.has(npcId);
    if (fromDenath && quest.getStage(player) >= STAGE_INFILTRATE && quest.getStage(player) <= STAGE_IN_GROUP
      && (text === "What do I have to do?" || text === "I forgot the incantation.")) {
      if (!packedIncantation(player)) assignIncantation(player);
    }
  }

  function lineBefore(event, run) {
    const previous = event.before;
    event.before = () => { previous?.(); run(); };
  }

  function lineAfter(event, run) {
    const previous = event.after;
    event.after = () => { previous?.(); run(); };
  }

  function stageFrom(player, from, to) {
    if (quest.getStage(player) === from) setStage(player, to);
  }

  /**
   * State the capture changes with a line: `before` runs as the line shows (the varbit is in the same
   * tick as the line), `after` as it is continued (the next tick). Ticks are the user's capture's.
   */
  const LINE_TRIGGERS = [
    { ids: REEN_NPC_IDS, line: /^You should go to Uzer and find Badden at once/, // t73
      before: (p) => startQuest(p) },
    { ids: BADDEN_NPC_IDS, line: /^I don't know\. You'll have to find some way to convince them/, // t468
      before: (p) => stageFrom(p, STAGE_STARTED, STAGE_INFILTRATE) },
    { ids: DENATH_NPC_IDS, line: /^You must memori[sz]e the incantation carefully/, // t815
      before: (p) => { if (!packedIncantation(p)) assignIncantation(p); stageFrom(p, STAGE_IN_GROUP, STAGE_DENATH_TOLD); } },
    { ids: DENATH_NPC_IDS, line: /^Ignoramus! Are you incapable/, // t830 (the incantation again, or first if he was left)
      before: (p) => { if (!packedIncantation(p)) assignIncantation(p); stageFrom(p, STAGE_IN_GROUP, STAGE_DENATH_TOLD); } },
    { ids: MATTHEW_NPC_IDS, line: /^Josef must have hidden the book somewhere/, // t940
      before: (p) => stageFrom(p, STAGE_DENATH_TOLD, STAGE_MATTHEW_TOLD) },
    { ids: GOLEM_NPC_IDS, line: /^He was carrying a large book/, // t1086
      before: (p) => { if (quest.getStage(p) === STAGE_MATTHEW_TOLD) { hideTome(p); setStage(p, STAGE_GOLEM_TOLD); } } },
    { ids: MATTHEW_NPC_IDS, player: true, line: /^Don't worry\. I'm here to kill the demon!/, // t1620
      before: (p) => stageFrom(p, STAGE_GOLEM_TOLD, STAGE_BOOK_SHOWN) },
    { ids: MATTHEW_NPC_IDS, line: /^Are you prepared for the ritual\?/, // t1625-1636
      after: (p) => scheduleRitualCall(p) },
    { ids: GOLEM_NPC_IDS, line: /^I cannot do that\. It is forbidden for a golem to enter the portal/, // t1932
      after: (p) => refuseGolem(p) },
    { ids: BADDEN_NPC_IDS, player: true, line: /^You'll need to hold this sigil for the ritual/, // t1918
      after: (p, event) => recruitHelper(p, BIT_BADDEN, "badden", event.npc) },
    { ids: REEN_NPC_IDS, player: true, line: /^Now take this demonic sigil, and hurry inside/, // t1999
      after: (p, event) => recruitHelper(p, BIT_REEN, "reen", event.npc) },
    { ids: GOLEM_NPC_IDS, player: true, line: /^Take this demonic sigil and go through the portal/, // t2021
      after: (p, event) => recruitHelper(p, BIT_GOLEM, "golem", event.npc) },
    { ids: MATTHEW_NPC_IDS, line: /^\*gulp\*/, // t2135
      after: (p) => readyForSummoning(p) },
  ];

  const speakerNames = new WeakMap();
  /**
   * Whether one of `ids` says this line: a player's line belongs to the NPC talked to, an NPC's line to
   * the speaker it names. Denath speaks inside Evil Dave's talk at the escort (ours t773-815), so the
   * NPC clicked is not always the one speaking.
   */
  function spokenBy(event, ids) {
    const speaker = event.step?.speaker;
    if (typeof event.step?.player === "string" || !speaker) return ids.has(event.npcId);
    let names = speakerNames.get(ids);
    if (!names) {
      names = new Set([...ids].map((id) => NpcDefinition.forId(id)?.getName?.()).filter(Boolean));
      speakerNames.set(ids, names);
    }
    return names.has(speaker);
  }

  function applyLineTriggers(event, text) {
    const player = event.player;
    const isPlayerLine = typeof event.step?.player === "string";
    for (const trigger of LINE_TRIGGERS) {
      if (!spokenBy(event, trigger.ids) || Boolean(trigger.player) !== isPlayerLine || !trigger.line.test(text)) continue;
      if (trigger.before) lineBefore(event, () => trigger.before(player, event));
      if (trigger.after) lineAfter(event, () => trigger.after(player, event));
    }
  }

  function refuseGolem(player) {
    const bits = helperBits(player);
    if (quest.getStage(player) < STAGE_RITUAL_DONE || bits & BIT_GOLEM_REFUSED) return;
    setHelperBits(player, bits | BIT_GOLEM_REFUSED);
    syncShadowVarbits(player);
  }

  /** Matthew's "Okay, here we go" (ours t2134 -> t2135): stage 110; the chant on the spot then summons. */
  function readyForSummoning(player) {
    if (quest.getStage(player) !== STAGE_PREPARE) return;
    if ((helperBits(player) & ALL_ARRIVED_MASK) !== ALL_ARRIVED_MASK) return;
    setStage(player, STAGE_READY);
  }

  const BADDEN_OPENER = "Reen sent me.";
  const BADDEN_TOPICS = ["Tell me more about Agrith-Naar.", "Tell me more about Denath.", "So what do you want me to do?"];
  const baddenTopic = new WeakMap();

  /**
   * npc-dialogue:menu for the quest's own talks. Live leaves out the option just asked when a menu comes
   * back (ours t785-811 Denath, t369-412 Badden, and every talk menu of the capture; only the ritual's
   * word menus stay whole). Badden's golem and portal answers end back at his topics, without the topic
   * that led there (t405, t451), where the transcript returns to his opening question.
   */
  function shapeMenu(notice) {
    if (!notice?.player || !OWN_NPC_IDS.has(notice.npcId)) return;
    const options = notice.options ?? [];
    if (BADDEN_NPC_IDS.has(notice.npcId)) {
      if (BADDEN_TOPICS.slice(0, 2).includes(notice.chosen)) baddenTopic.set(notice.player, notice.chosen);
      const reopened = options.some((o) => o.text === BADDEN_OPENER)
        && notice.history?.some((menu) => (menu.step?.options ?? []).some((o) => o.text === BADDEN_OPENER));
      const topics = reopened && notice.history.find((menu) =>
        BADDEN_TOPICS.every((text) => (menu.step?.options ?? []).some((o) => o.text === text)));
      if (topics) {
        const left = baddenTopic.get(notice.player);
        notice.options = topics.step.options.filter((o) => o.text !== left);
        return;
      }
    }
    // The ritual's word menus keep all five words (ours t1361-t1368, t1687-t1732).
    if (options.some((o) => INCANTATION_WORDS.includes(o.text))) return;
    if (!notice.chosen || options.length < 3) return;
    if (!options.some((o) => o.text === notice.chosen)) return;
    notice.options = options.filter((o) => o.text !== notice.chosen);
  }

  /** Fills the wiki placeholders and echoes the incantation words chosen. */
  function fillTranscriptText(event) {
    if (!event?.player || typeof event.text !== "string") return;
    if (!OWN_NPC_IDS.has(event.npcId)) return;
    const isPlayerLine = typeof event.step?.player === "string";
    if (!isPlayerLine) {
      const head = chatheadFor(event);
      if (head !== undefined) event.speakerId = head;
    }
    let text = event.text;
    if (text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(event.player.getDisplayName()));
    }
    // The Wiki's lines carry its author's words; Denath says this player's, the book's order backwards
    // (ours t815 and t830: "Agrith-Naar Camerinthum Caldar Tarren Nahudu" for varbits 1,4,0,3,2).
    if (spokenBy(event, DENATH_NPC_IDS) && INCANTATION_IN_LINE.test(text) && packedIncantation(event.player)) {
      text = text.replace(INCANTATION_IN_LINE, denathIncantation(event.player));
    }
    if (text.includes("[him/her]") || text.includes("[his/her]") || text.includes("[He/She]")) {
      const male = event.player.getAppearance?.().isMale?.() !== false;
      text = text
        .replace(/\[him\/her\]/g, male ? "him" : "her")
        .replace(/\[his\/her\]/g, male ? "his" : "her")
        .replace(/\[He\/She\]/g, male ? "He" : "She");
    }
    if (text.includes("[Word ")) {
      const picks = ritualPicks.get(event.player) ?? [];
      text = text.replace(/\[Word (\d)(!)?\]/g, (match, number, emphasis) => {
        const pick = picks[Number(number) - 1];
        return pick === undefined ? match : INCANTATION_WORDS[pick] + (emphasis ?? "");
      });
      // Rsprox 3333 t2067-t2089: the leader's own word goes overhead, with sequence 2879.
      if (typeof event.step?.player === "string") {
        event.player.forceChat(text);
        event.player.performAnimation(new Animation(SEQ_SUMMON_START));
      }
    }
    if (event.step?.speaker === "[Everyone]" && event.step.presentation === "overhead") {
      const stage = quest.getStage(event.player);
      if (stage === STAGE_RITUAL || stage === STAGE_READY) {
        const cast = stage === STAGE_RITUAL ? RITUAL_CAST : SECOND_CAST;
        const tracked = wizardNpcs.get(event.player);
        event.actors = cast.map(({ key }) => {
          const actor = tracked?.get(key);
          return actor?.getOwner?.() === event.player && actor.isOwnerOnly?.() === true ? actor : undefined;
        });
      }
    }
    // Ours t2134: the chatbox shows "*gulp*<br><br>Okay, here we go..." where the Wiki writes two spaces (the
    // engine's chat layout keeps one of the breaks: no empty line).
    if (spokenBy(event, MATTHEW_NPC_IDS) && /^\*gulp\* +/.test(text)) text = text.replace(/^\*gulp\* +/, "*gulp*<br><br>");
    if (spokenBy(event, DENATH_NPC_IDS) && /^Player, /.test(text)) text = text.replace(/^Player, /, `${event.player.getDisplayName()}, `);
    applyLineTriggers(event, text);
    lineEmotes(event, text);
    escortLine(event, text);
    closingLine(event, text);
    summonLine(event, text);
    roomLine(event, text);
    event.text = text;
  }

  const MUSIC_INCANTATION = 519;
  const MUSIC_GRIP_OF_THE_TALON = 520;
  const SEQ_DEATH_DELAY = 30;

  /** A quest's own track: unlocked (with its message) and played (ours t1636, t2204). */
  function playTrack(player, trackId) {
    api.emitCustomEvent("music:unlock-track", { player, trackId });
    player.getPacketSender().sendSong(trackId);
  }

  /** Tanya's laugh (ours t872-t884): each laugh overhead too, under a camera climbing away from her. */
  const TANYA_LAUGHS = [
    { line: /^Ha ha ha ha!$/, move: [-1, -5, 1000] },
    { line: /^Ah ha ha ha ha ha!!$/, move: [-2, -8, 1500] },
    { line: /^AAH HA HA HA HA HA HAAAAA!!!!$/, move: [-3, -11, 2000] },
  ];

  function roomLine(event, text) {
    const player = event.player;
    const isPlayerLine = typeof event.step?.player === "string";
    if (isPlayerLine) return;
    if (TANYA_NPC_IDS.has(event.npcId) && event.step?.speaker === "Tanya") {
      const laugh = TANYA_LAUGHS.find((entry) => entry.line.test(text));
      const tanya = event.npc ?? wizardNpcs.get(player)?.get("tanya");
      if (laugh && tanya) {
        lineBefore(event, () => {
          tanya.forceChat(text);
          const at = tanya.getLocation();
          const [dx, dy, height] = laugh.move;
          player.getPacketSender().sendCameraLookAt(at.getX(), at.getY(), 100, Scenes.CAMERA_RATES)
            .sendCameraMoveTo(at.getX() + dx, at.getY() + dy, height, Scenes.CAMERA_RATES);
        });
      }
      return;
    }
    if (TANYA_NPC_IDS.has(event.npcId) && /^Look, we've told you not to do that/.test(text)) {
      lineBefore(event, () => player.getPacketSender().sendCameraReset());
      return;
    }
    // Ours t1636: the call to begin, overhead and in the chatbox.
    if (spokenBy(event, DENATH_NPC_IDS) && /^It is time for the ritual to commence!/.test(text)) {
      lineBefore(event, () => wizardNpcs.get(player)?.get("denath")?.forceChat(text));
      return;
    }
    // Ours t2212: the Fire Blast lands, Matthew falls (2 cycles late) with his cry overhead, and is gone at t2215, his bones left.
    if (MATTHEW_NPC_IDS.has(event.npcId) && /^Aaaargh!$/.test(text) && quest.getStage(player) === STAGE_SUMMONED) {
      lineBefore(event, () => killMatthew(player));
    }
  }

  function killMatthew(player) {
    const matthew = wizardNpcs.get(player)?.get("matthew");
    if (!matthew || helperBits(player) & BIT_MATTHEW) return;
    matthew.performGraphic(new Graphic(GFX_BLOOD, 0, GraphicHeight.HIGH));
    matthew.performAnimation(new Animation(SEQ_TANYA_DEATH, SEQ_DEATH_DELAY));
    matthew.forceChat("Aaaargh!");
    setHelperBits(player, helperBits(player) | BIT_MATTHEW);
    const at = matthew.getLocation();
    Scenes.later(Scenes.get(player) ?? player, 3, () => {
      removeWizard(player, "matthew");
      dropFor(player, ItemIdentifiers.BONES, [at.getX(), at.getY(), at.getZ()]);
    });
  }

  /**
   * Ours t1625-t1636: Matthew's "Are you prepared" talk at stage 70, and nine ticks after it Denath
   * calls the ritual (Quest Helper: "Afterwards Denath should start the ritual. If he doesn't, leave
   * and re-enter the throne room and talk to Matthew again."). Stage 80, the track, his call; then
   * Dave comes in and everyone walks to their place (t1642-t1646).
   */
  function scheduleRitualCall(player) {
    if (quest.getStage(player) !== STAGE_BOOK_SHOWN || !inThroneRoom(player)) return;
    const scene = roomScene(player);
    Scenes.later(scene, 9, () => {
      if (quest.getStage(player) !== STAGE_BOOK_SHOWN || !inThroneRoom(player)) return;
      quest.setStage(player, STAGE_RITUAL);
      syncShadowVarbits(player);
      playTrack(player, MUSIC_INCANTATION);
      const denath = wizardNpcs.get(player)?.get("denath") ?? null;
      startTranscript(api, player, NpcIdentifiers.DENATH, PAGE, "performing-the-ritual", undefined, denath);
    });
  }

  /** FK8qAZ, "Denath and the disciples assemble around the center of the room" (ours t1642-t1646). */
  function assembleRitual(player) {
    const tracked = wizardNpcs.get(player);
    if (tracked && !tracked.get("dave")) {
      const dave = api.spawnNpc({ id: NpcIdentifiers.EVIL_DAVE_2, x: 2720, y: 4893, z: 2, wanderRadius: 0, owner: player, ownerOnly: true });
      if (dave) {
        dave.__skipDefaultRespawn = true;
        tracked.set("dave", dave);
        syncWizardArea(player, dave);
      }
    }
    assembleCircle(player, RITUAL_CAST);
  }

  const INCANTATION_WORD = "(?:Caldar|Nahudu|Agrith-\\s?Naar|Camerinthum|Tarren)";
  const INCANTATION_IN_LINE = new RegExp(`${INCANTATION_WORD}(?: ${INCANTATION_WORD}){4}`);

  /** Denath's order: the varbits' (the book's) backwards. */
  function denathIncantation(player) {
    const words = [];
    for (let index = INCANTATION_WORDS.length - 1; index >= 0; index--) words.push(INCANTATION_WORDS[wordAt(player, index)]);
    return words.join(" ");
  }

  /** The tome's incantation lines for this player (the capture's book, ours t1500). */
  function bookIncantationWords(player) {
    return Array.from({ length: INCANTATION_WORDS.length }, (_, index) => INCANTATION_WORDS[wordAt(player, index)]);
  }

  /**
   * The head live sends: the clicked NPC itself (ours: 1984 Reen in Al Kharid t53, 1985 Reen in Uzer
   * t1099, 1986 Badden t359, 1987 Dave at the portal t631, 913 Dave in the passage t1870), and in the
   * rituals the wizard's sigil form while they hold it (898 Denath t1706, 904 Matthew t2169, t2212).
   */
  function chatheadFor(event) {
    const clicked = event.npc?.getId?.() ?? event.npcId;
    const resolved = LEGACY_NPC_CHAT_HEAD.get(clicked) ?? GOLEM_CHAT_HEAD.get(clicked);
    const speaker = event.step?.speaker;
    if (resolved !== undefined && (!speaker || NpcDefinition.forId(resolved)?.getName?.() === speaker)) return clicked;
    // By name alone her line finds 305, the Shayzien store's Jennifer. Ours t1223 has 905.
    if (speaker === "Jennifer" && !JENNIFER_NPC_IDS.has(event.npcId)) return NpcIdentifiers.JENNIFER_2;
    for (const npc of wizardNpcs.get(event.player)?.values() ?? []) {
      const shown = npc.getNpcTransformationId?.() ?? -1;
      if (shown < 0) continue;
      if (NpcDefinition.forId(shown)?.getName?.() === speaker) return shown;
    }
    return undefined;
  }

  /** The Wiki: The Golem and Demon Slayer to start; 30 Crafting (boostable) "not required to start". */
  function shadowPrereqsMet(player) {
    return questComplete(player, "the_golem") && questComplete(player, "demon_slayer");
  }

  const PREREQUISITE_MESSAGE = "You need to have completed The Golem and Demon Slayer to start Shadow of the Storm.";

  function refuseShadowStart(player) {
    // The transcript has no prerequisite refusal branch, so use the generic
    // requirement message instead of inventing NPC speech.
    player.sendMessage(PREREQUISITE_MESSAGE);
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !REEN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!shadowPrereqsMet(player)) {
      player.sendMessage(PREREQUISITE_MESSAGE);
      return;
    }
    // A reset re-runs the start: drop the progress that lives outside the stage. The stage itself
    // moves with Reen's last line (LINE_TRIGGERS, ours t73).
    player.setAttribute(HELPERS_ATTRIBUTE, 0);
    player.setAttribute(KILN_ATTRIBUTE, 0);
    player.setAttribute(INCANTATION_ATTRIBUTE, 0);
    player.setAttribute(REWARD_ATTRIBUTE, 0);
  }

  /** Ours t73: stage 10 and the start message as Reen sends the player to Badden. */
  function startQuest(player) {
    if (quest.getStage(player) !== STAGE_NOT_STARTED || !shadowPrereqsMet(player)) return;
    setStage(player, STAGE_STARTED);
    player.sendMessage(questStartMessage(player, quest.name));
  }

  // ============================================================================
  // Interactions
  // ============================================================================

  function dyeSilverlight(player, reagentId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_RITUAL_DONE) {
      player.sendMessage("You have no reason to do that.");
      return;
    }
    if (!hasItem(player, SILVERLIGHT_ITEM_ID)) return;
    if (reagentId !== undefined && !hasItem(player, reagentId)) return;
    // Wiki: dyeing takes every Silverlight carried and leaves one dyed sword.
    player.getInventory().deleteNumber(SILVERLIGHT_ITEM_ID, player.getInventory().getAmount(SILVERLIGHT_ITEM_ID));
    if (reagentId !== undefined) player.getInventory().deleteNumber(reagentId, 1);
    player.getInventory().adds(DYED_SILVERLIGHT_ITEM_ID, 1);
    startTranscript(api, player, NpcIdentifiers.FATHER_REEN, PAGE, "to-uzer-dyeing-silverlight-black");
  }

  /** The captured book (ours t1497-t1503), with this player's incantation on its third spread. */
  function tomePages(player) {
    if (!packedIncantation(player)) assignIncantation(player);
    const words = bookIncantationWords(player);
    return TOME_PAGES.map((page) => Object.fromEntries(Object.entries(page).map(([component, line]) =>
      [component, line.replace(/\{word([1-5])\}/g, (match, n) => words[Number(n) - 1] ?? match)])));
  }

  /** The circle tile each ritual is led from (ours t1680 at 2718,4902 and t2142 at 2720,4903; Quest Helper's circleSpot). */
  const FIRST_RITUAL_SPOT = { x: 2718, y: 4902, z: 2 };
  const SECOND_RITUAL_SPOT = { x: 2720, y: 4903, z: 2 };

  function onSpot(player, spot) {
    const at = player.getLocation();
    return at.getX() === spot.x && at.getY() === spot.y && at.getZ() === spot.z && inThroneRoom(player);
  }

  /**
   * "Chant" on the demonic sigil leads the ritual from its spot in the circle (stage 80 and 110);
   * anywhere else it is five word menus and "Nothing interesting happens." (ours t1356-t1370; the
   * Wiki: "This has no effect and does not summon demons, even if the chant is in the correct order.").
   */
  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.itemId === DEMONIC_TOME_ITEM_ID && option === "read") {
      event.handled = true;
      openBook(event.player, TOME_TITLE, tomePages(event.player));
      return;
    }
    if (event.itemId !== DEMONIC_SIGIL_ITEM_ID || !option.includes("chant")) return;
    event.handled = true;
    const player = event.player;
    const stage = quest.getStage(player);
    if (stage === STAGE_RITUAL && onSpot(player, FIRST_RITUAL_SPOT)) startFirstIncantation(player);
    else if (stage === STAGE_READY && onSpot(player, SECOND_RITUAL_SPOT)) startSecondIncantation(player);
    else chantAlone(player, []);
  }

  /** Ours t1357-t1370: each word said overhead (no dots) with 2879, the chatbox echoing it, then the message box. */
  function chantAlone(player, picks) {
    const pairs = [];
    INCANTATION_WORDS.forEach((word, index) => pairs.push(word, () => {
      picks.push(index);
      const last = picks.length === INCANTATION_WORDS.length;
      player.forceChat(word);
      player.performAnimation(new Animation(SEQ_SUMMON_START));
      startDialogue(api, player, { npcId: -1 }, [
        { player: [`${word}${last ? "!" : "..."}`] },
        { exec: () => (last ? chantFizzles(player) : chantAlone(player, picks)) },
      ]);
    }));
    player.getDialogueManager().reset();
    api.sendMultiChatboxPrompt(player, "Select a word.", ...pairs);
  }

  function chantFizzles(player) {
    player.performAnimation(new Animation(-1));
    player.getPacketSender().sendCameraReset();
    messageBox(player, "Nothing interesting happens.");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId !== BLACK_MUSHROOM_OBJECT_ID || itemId !== SILVERLIGHT_ITEM_ID) return;
    event.handled = true;
    dyeSilverlight(player);
  }

  /** The copy in the slot the player used, else the first copy (a caller without slots). */
  function usedCopy(player, itemId, slots) {
    const items = player.getInventory().getItems?.();
    const slot = slots.find((index) => items?.[index]?.getId() === itemId);
    return slot !== undefined ? items[slot] : items?.find((item) => item?.getId() === itemId);
  }

  const dyeQuestions = new WeakMap();

  function dyeClothing(player, clothingId, slots = []) {
    const recipe = BLACK_DYEABLE_CLOTHING.get(clothingId);
    if (!hasItem(player, BLACK_DYE_ITEM_ID) || !hasItem(player, clothingId)) return;
    const dye = usedCopy(player, BLACK_DYE_ITEM_ID, slots);
    if (dye && (dye.isPresetItem?.() === true || dye.isUntradeable?.() === true || dye.isUnbankable?.() === true)) {
      player.sendMessage("Preset items cannot be used for this.");
      return;
    }
    if (!recipe.desert) {
      applyDye(player, clothingId, slots);
      return;
    }
    const box = new class extends api.core.ItemStatementDialogue {
      send(target) {
        super.send(target);
        target.getPacketSender().sendClientScript(2868, "Cancel|Dye it");
      }
    }(0, clothingId, DESERT_DYE_WARNING(recipe.desert));
    dyeQuestions.set(player, { box, clothingId, slots });
    player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(box));
  }

  /** The "Cancel|Dye it" buttons (objectbox:universe sub 0 and 1; ours t528 picks 1). */
  function answerDyeQuestion(event) {
    const { player, action } = event;
    const question = dyeQuestions.get(player);
    if (!question || player.getDialogueManager().getCurrent() !== question.box) return false;
    if (action !== 0 && action !== 1) return false;
    event.handled = true;
    dyeQuestions.delete(player);
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    if (action === 1) applyDye(player, question.clothingId, question.slots);
    return true;
  }

  /** A filterable ("spam") chat line, as live sends the cape's dye line and the portal's. */
  function spam(player, text) {
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);
  }

  function applyDye(player, clothingId, slots) {
    const { result, name, desert } = BLACK_DYEABLE_CLOTHING.get(clothingId);
    const inventory = player.getInventory();
    const dye = usedCopy(player, BLACK_DYE_ITEM_ID, slots);
    const clothing = usedCopy(player, clothingId, slots);
    if (!dye || !clothing) return;
    // The dyed clothing lands in the ink's slot and the vial in the clothing's (ours t528, t537,
    // t543). Each copy keeps its own meta (a preset robe stays preset once dyed), so the two copies
    // swap slots and are then converted in place.
    const items = inventory.getItems();
    const dyeSlot = items.indexOf(dye);
    const clothingSlot = items.indexOf(clothing);
    if (dyeSlot >= 0 && clothingSlot >= 0) {
      inventory.setItem(dyeSlot, clothing);
      inventory.setItem(clothingSlot, dye);
    }
    clothing.setId(result);
    dye.setId(ItemIdentifiers.VIAL);
    inventory.refreshItems?.();
    player.getSkillManager().addExperiences(Skill.CRAFTING, DYE_CRAFTING_XP);
    if (desert) itemBox(player, result, `You dye the ${name} black.`);
    else spam(player, `You dye the ${name} black.`); // t543: on the filterable channel
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];
    const clothingId = ids.find((id) => BLACK_DYEABLE_CLOTHING.has(id));
    if (clothingId !== undefined && ids.includes(BLACK_DYE_ITEM_ID)) {
      event.handled = true;
      dyeClothing(player, clothingId, [event.usedItemSlot, event.usedWithItemSlot]);
      return;
    }
    if (!ids.includes(SILVERLIGHT_ITEM_ID)) return;
    const reagentId = ids.includes(BLACK_MUSHROOM_ITEM_ID)
      ? BLACK_MUSHROOM_ITEM_ID
      : ids.includes(BLACK_DYE_ITEM_ID)
        ? BLACK_DYE_ITEM_ID
        : undefined;
    if (reagentId === undefined) return;
    event.handled = true;
    dyeSilverlight(player, reagentId);
  }

  /** Wiki (Demonic sigil mould): once Agrith-Naar is dead the mould makes no more. Silver crafting asks. */
  function refuseSigilAfterQuest(event) {
    if (event.itemId !== DEMONIC_SIGIL_ITEM_ID || event.action !== "craft") return;
    if (quest.getStage(event.player) < STAGE_KILLED) return;
    event.allow = false;
    event.player.sendMessage("There is no need to make another sigil now you have defeated Agrith-Naar.");
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!GOLEM_NPC_IDS.has(npcId)) return;
    if (event.itemId !== STRANGE_IMPLEMENT_ITEM_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RITUAL_DONE || stage >= STAGE_KILLED) return; // The Golem owns the implement otherwise
    // Ours t2005: after the golem has refused (Quest Helper's golemRejected gates this step).
    if (!(helperBits(player) & BIT_GOLEM_REFUSED)) return;
    // Reprogrammed already: the default "Nothing interesting happens.", as before the refusal (ours).
    if (helperBits(player) & BIT_GOLEM_REPROGRAMMED) return;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "performing-the-ritual-reprogramming-the-golem", undefined, event.target ?? null);
  }

  const SAND_STORM_INTERFACE = 296;
  const GOLEM_PROGRAM_SOUND = 1849;
  const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
  const SANDSTORM_SOUND = 1314;
  const ROOF_COLLAPSE_SOUND = 1384;
  const HUMAN_HIT_SOUND = 518;
  const GFX_ROOF_COLLAPSE = 271; // agilityarena_roofcollapse
  const STAIRS_UP_OBJECT_ID = 6372; // golem_insidestairs_base
  const STAIRS_DOWN_OBJECT_ID = 6373; // golem_insidestairs_top
  const UZER_ZONE = { minX: 3456, maxX: 3519, minY: 3072, maxY: 3135, levels: [0] };
  const sandstorms = new WeakMap();

  /** Stages 90-110: Agrith-Naar's storm over Uzer (cache: the sand storm NPCs 1988 and the rubble 10249 show then). */
  function stormRaging(player) {
    const stage = quest.getStage(player);
    return stage >= STAGE_RITUAL_DONE && stage < STAGE_SUMMONED;
  }

  /** Falling rocks: spotanim 271, a shake, the collapse sound and a hit of 1 (ours t1901-t1902, t2036-t2037; 3333 t2342). */
  function fallingRocks(player, message) {
    if (message) player.sendMessage("You are hit by falling rocks!");
    player.performGraphic(new Graphic(GFX_ROOF_COLLAPSE, 0, GraphicHeight.HIGH));
    shake(player, 10);
    player.getPacketSender().sendSoundEffect(ROOF_COLLAPSE_SOUND, 1, 0);
    Scenes.later(player, 1, () => {
      if (player.getHitpoints() <= 0) return;
      player.getCombat().getHitQueue().addPendingDamage([new api.core.HitDamage(1, api.core.HitMask.RED)]);
      player.getPacketSender().sendSoundEffect(HUMAN_HIT_SOUND, 1, 20);
    });
    Scenes.later(player, 2, () => player.getPacketSender().sendCameraReset());
  }

  /** Ours t1906 (3333 t2237, 572 t1239): coming up into the storm. The overlay closes going back down (t2027). */
  function enterStorm(player) {
    if (!stormRaging(player) || sandstorms.has(player)) return;
    player.sendMessage("You must fight your way against a sandstorm!");
    shake(player, 3);
    sandstorms.set(player, player.getPacketSender().mountSubInterface(OVERLAY_ATMOSPHERE_UID, SAND_STORM_INTERFACE, 1));
    player.getPacketSender().sendSoundEffect(SANDSTORM_SOUND, 1, 0);
  }

  function leaveStorm(player) {
    const mount = sandstorms.get(player);
    if (!mount) return;
    sandstorms.delete(player);
    player.getPacketSender().closeSubInterfaceMount?.(mount) ?? player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  }

  /** The stairs during the storm: the first climb out is stopped by rocks (all three recordings), a descent brings more down after a while. */
  function handleStairs(event) {
    const { player, objectId } = event;
    if (!stormRaging(player)) return false;
    if (objectId === STAIRS_UP_OBJECT_ID && !(helperBits(player) & BIT_ROCKS_FELL)) {
      event.handled = true;
      setHelperBits(player, helperBits(player) | BIT_ROCKS_FELL);
      fallingRocks(player, true);
      return true;
    }
    // Climbing up normally is LocTeleports' entry; the storm meets the player on arrival (stormArrival).
    if (objectId === STAIRS_DOWN_OBJECT_ID) {
      leaveStorm(player);
      // Ours: 10 ticks after arriving below (t2026 -> t2036); 572 3, 3333 18. The spread is ours, from those three.
      const delay = 3 + Math.floor(Math.random() * 16);
      Scenes.later(player, delay, () => {
        if (stormRaging(player) && inUnderground(player)) fallingRocks(player, false);
      });
    }
    return false;
  }

  function inUnderground(player) {
    const at = player.getLocation();
    return at.getZ() === 0 && at.getX() >= UNDERGROUND_ZONE.minX && at.getX() <= UNDERGROUND_ZONE.maxX
      && at.getY() >= UNDERGROUND_ZONE.minY && at.getY() <= UNDERGROUND_ZONE.maxY;
  }

  /**
   * The temple portal 6310 (via The Golem's door multiloc): before the player has joined, Dave stops
   * them (ours t640, his 902 head); during the quest it is a new throne room with no message (t717,
   * t1213, t1594, t2049); after it the plain room and "You step into the portal." (t2963).
   */
  function enterThroneRoom(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      spam(player, "You step into the portal."); // t2963: filterable
      player.moveTo(new Location(2720, 4884, 2));
      return;
    }
    player.moveTo(new Location(2720, 4884, 2));
    Scenes.later(player, 1, () => {
      if (!inThroneRoom(player)) return;
      roomScene(player);
      ensureWizardNpcs(player);
    });
  }

  function leaveThroneRoom(player) {
    spam(player, "You step into the portal."); // t2963: filterable
    Scenes.end(player);
    removeAllWizards(player);
    player.moveTo(new Location(2721, 4911, 0));
  }

  /** Ours t1905-t1906: the storm a tick after the stairs land the player in Uzer. */
  function stormArrival({ player, objectId }) {
    if (objectId !== STAIRS_UP_OBJECT_ID || !player) return;
    Scenes.later(player, 1, () => enterStorm(player));
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const stage = quest.getStage(player);
    if (objectId === PORTAL_ENTER_OBJECT_ID) {
      if (stage >= STAGE_IN_GROUP) {
        event.handled = true;
        enterThroneRoom(player);
        return;
      }
      if (stage >= STAGE_STARTED) {
        event.handled = true;
        startDialogue(api, player, { npcId: NpcIdentifiers.EVIL_DAVE_2 }, [{ npc: ["Hey! This is our portal! Keep out!"] }]);
        return;
      }
      return;
    }
    // Stage 90 (ours t1833-t1837): the closing portal takes the player out to Tanya's death.
    if (objectId === AGRITH_PORTAL_CLOSING_OBJECT_ID && inThroneRoom(player)) {
      event.handled = true;
      if (stage === STAGE_RITUAL_DONE && !(helperBits(player) & BIT_TANYA)) beginPortalClosing(player);
      else leaveThroneRoom(player);
      return;
    }
    // No upper bound: completion leaves the player on plane 2, so the exit must keep working.
    if (objectId === PORTAL_EXIT_OBJECT_ID && inThroneRoom(player) && stage >= STAGE_IN_GROUP) {
      event.handled = true;
      if (stage === STAGE_RITUAL_DONE && !(helperBits(player) & BIT_TANYA)) {
        beginPortalClosing(player);
        return;
      }
      leaveThroneRoom(player);
      return;
    }
    if (!SURFACE_KILN_OBJECT_IDS.includes(objectId)) return;
    // Only stage 60 shows Look-in (cache: each kiln's multiloc on 1372 is its "Look-in" form at 60 alone).
    if (stage !== STAGE_GOLEM_TOLD) return;
    event.handled = true;
    lookInKiln(player, objectId);
  }

  /**
   * Ours t1449-t1457 and t1484-t1491: the wrong kilns' message box; the right one's object box with
   * the tome as the player reaches in (881, human_pickpocket), and the tome. The Wiki's third line is
   * for the right kiln once the book has been found.
   */
  function lookInKiln(player, objectId) {
    if (objectId !== SURFACE_KILN_OBJECT_IDS[hiddenKiln(player)]) {
      messageBox(player, "You look in the kiln but you see only sand and fragments of ancient golems.");
      return;
    }
    if (hasItem(player, DEMONIC_TOME_ITEM_ID)) {
      messageBox(player, "You have already found the book.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.performAnimation(new Animation(SEQ_REACH_IN));
    player.getInventory().adds(DEMONIC_TOME_ITEM_ID, 1);
    itemBox(player, DEMONIC_TOME_ITEM_ID, "You find a book in the kiln.");
  }

  const SEQ_REACH_IN = 881;

  /** A message box the player continues (the chatbox's messagebox, 229). */
  function messageBox(player, text) {
    player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  function itemBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(
      new api.core.ItemStatementDialogue(0, itemId, text)));
  }

  function handleNpcInteraction(event) {
    const { player } = event;
    if (!player) return;
    const actions = event.definition?.getActions?.() ?? [];
    const action = String(actions[event.clickType - 1] ?? "").toLowerCase();
    const talk = action === "talk-to" || (action === "" && event.clickType === 1);
    if (!talk) return;

    if (REEN_NPC_IDS.has(event.npcId) && quest.getStage(player) === STAGE_NOT_STARTED) {
      event.handled = true;
      if (!shadowPrereqsMet(player)) {
        refuseShadowStart(player);
        return;
      }
      startTranscript(api, player, LEGACY_NPC_CHAT_HEAD.get(event.npcId) ?? event.npcId, PAGE, "starting-off", undefined, event.npc);
      return;
    }

    if (GOLEM_NPC_IDS.has(event.npcId)) {
      const selected = selectVariant({ npcId: event.npcId, player });
      if (!selected) return; // let The Golem's plugin run its own dialogue
      const page = typeof selected === "string" ? PAGE : selected.page ?? PAGE;
      const variant = typeof selected === "string" ? selected : selected.variant;
      event.handled = true;
      startTranscript(api, player, event.npcId, page, variant, undefined, event.npc);
      return;
    }

    const chatHead = LEGACY_NPC_CHAT_HEAD.get(event.npcId);
    if (chatHead === undefined) return;
    syncShadowVarbits(player);
    const variant = selectVariant({ npcId: event.npcId, player });
    if (!variant) return;
    event.handled = true;
    // The resolved id names the speaker for the transcript; the clicked one is the head (chatheadFor).
    startTranscript(api, player, chatHead, PAGE, typeof variant === "string" ? variant : variant.variant, undefined, event.npc);
  }

  /** Ours t1845-t1846: stage 100, and Tanya's sigil and bones where she fell (2722,4905). */
  function tanyaKilled(player) {
    const bits = helperBits(player);
    if (bits & BIT_TANYA) return false;
    setHelperBits(player, bits | BIT_TANYA);
    if (quest.getStage(player) < STAGE_PREPARE) setStage(player, STAGE_PREPARE);
    Scenes.later(player, 1, () => {
      // World-owned, not scene-owned: the scene's area goes and would take them with it.
      dropFor(player, DEMONIC_SIGIL_ITEM_ID, [2722, 4905, 0]);
      dropFor(player, ItemIdentifiers.BONES, [2722, 4905, 0]);
    });
    return true;
  }

  const GHOST_ATTACK_SOUND = 436;
  const GHOST_DEATH_SOUND = 438;

  /**
   * Ours t1833-t1851 (3333 t2139-t2150): the closing portal puts the player back at 2721,4911; Tanya
   * (919) and three ghosts (1989) under a fixed camera, her two blocks, her death, the ghosts' strike;
   * then "You see Tanya killed by ghosts!" as a game message, and the camera back at t1848. No
   * cutscene state: the player can walk off.
   */
  function beginPortalClosing(player) {
    if (quest.getStage(player) !== STAGE_RITUAL_DONE) return;
    if (helperBits(player) & BIT_TANYA) return;
    Scenes.end(player);
    removeAllWizards(player);
    player.moveTo(new Location(2721, 4911, 0));
    Scenes.later(player, 1, () => {
      const scene = Scenes.open(player, "shadow-tanya-death", [[2706, 2738, 4879, 4918, 0]], { canTeleport: () => null, npcAggression: () => null });
      const tanya = Scenes.actor(scene, 919, [2722, 4905, 0], [2722, 4904]);
      const ghosts = [[2721, 4904], [2722, 4904], [2723, 4904]].map(([x, y]) => Scenes.actor(scene, 1989, [x, y, 0], [2722, 4905]));
      tanya?.performAnimation?.(new Animation(SEQ_TANYA_DEFEND));
      Scenes.camera(player, [2721, 4897, 350], [2722, 4911, 25]);
      player.getPacketSender().sendSoundEffect(GHOST_ATTACK_SOUND, 1, 0);
      playTrack(player, MUSIC_INCANTATION);
      Scenes.later(scene, 2, () => tanya?.performAnimation?.(new Animation(SEQ_TANYA_DEFEND)));
      Scenes.later(scene, 4, () => tanya?.performAnimation?.(new Animation(SEQ_TANYA_DEATH)));
      Scenes.later(scene, 6, () => {
        for (const ghost of ghosts) ghost?.performAnimation?.(new Animation(SEQ_GHOST_ATTACK));
      });
      Scenes.later(scene, 7, () => {
        if (tanya) Scenes.removeActor(scene, tanya);
        for (const ghost of ghosts) if (ghost) Scenes.removeActor(scene, ghost);
        player.getPacketSender().sendSoundEffect(GHOST_DEATH_SOUND, 1, 0);
        if (tanyaKilled(player)) player.sendMessage("You see Tanya killed by ghosts!");
      });
      Scenes.later(scene, 10, () => {
        Scenes.end(player);
        itemOnGroundManager.onRegionChange(player);
      });
    });
  }

  /** Telekinetic Grab pulls the player to a walkable tile against the demon's footprint. */
  function teleportPlayerAdjacent(npc, player) {
    if (!player?.isPlayer?.()) return false;
    const at = npc.getLocation?.() ?? player.getLocation();
    const size = Math.max(1, npc.getSize?.() ?? 1);
    const playerTile = player.getLocation();
    const area = player.getPrivateArea?.() ?? null;
    // Never teleport across areas/planes or into scenery; a size-3 demon's ring
    // is its 3x3 footprint plus the surrounding tiles.
    if (at.getZ() !== playerTile.getZ() || (npc.getPrivateArea?.() ?? null) !== area) return false;
    const candidates = [];
    for (let dx = -1; dx <= size; dx++) {
      for (let dy = -1; dy <= size; dy++) {
        const inside = dx >= 0 && dx < size && dy >= 0 && dy < size;
        const corner = (dx === -1 || dx === size) && (dy === -1 || dy === size);
        if (inside || corner) continue;
        candidates.push(new Location(at.getX() + dx, at.getY() + dy, at.getZ()));
      }
    }
    candidates.sort((a, b) => a.getDistance(playerTile) - b.getDistance(playerTile));
    for (const tile of candidates) {
      if (RegionManager.blocked?.(tile, area) === true) continue;
      player.moveTo(tile);
      return true;
    }
    return false;
  }

  /**
   * Rsprox 572 t1385-t1388: telegrab_cast_and_fire plays at him and projectile 143 flies, 3 ticks at
   * that distance; telegrab_hit plays at the player, who then moves with spotanim 409 as golem_teleport
   * plays at him. This uses the projectile's own arrival, which is 3 there and scales with distance.
   */
  function castTelegrab(npc, player) {
    const from = npc.getLocation();
    player.getPacketSender().sendAreaSound(TELEGRAB.castSound, from.getX(), from.getY(), from.getZ(), 1, 0, 10);
    Projectile.createProjectile(
      npc, player, TELEGRAB.projectile, FIRE_BLAST.start, FIRE_BLAST.end,
      FIRE_BLAST.startHeight, FIRE_BLAST.endHeight
    ).withAngle(16).withProgress(64).sendProjectile();
    const ticks = Projectile.arrivalTicks(npc, player, TELEGRAB.arrivalDelay);
    const tile = player.getLocation();
    player.getPacketSender().sendAreaSound(TELEGRAB.hitSound, tile.getX(), tile.getY(), tile.getZ(), 1, ticks, 10);
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (npc.getHitpoints?.() <= 0 || player.getHitpoints() <= 0) return;
      // Ours: a player who has already walked into melee stays where they are. No capture shows it.
      if (api.core.CombatRange.canReach(npc, api.core.CombatFactory.MELEE_COMBAT, player)) return;
      if (!teleportPlayerAdjacent(npc, player)) return;
      player.performGraphic?.(new Graphic(TELEGRAB.graphic));
      const at = npc.getLocation();
      player.getPacketSender().sendAreaSound(TELEGRAB.moveSound, at.getX(), at.getY(), at.getZ(), 1, 0, 10);
    }));
  }

  /**
   * Agrith-Naar, per the Wiki: melee up close by default; Fire Blast out of range or
   * against Protect from Melee; and, out of range with Protect from Magic, a
   * Telekinetic Grab that pulls the player back into melee. The room is an instance
   * and he remains where he was summoned.
   */
  class AgrithNaarCombat extends CombatMethod {
    constructor() {
      super();
      this.style = CombatType.MELEE;
      this.telekinetic = false;
      this.landing = 0;
    }

    type() {
      return this.style;
    }

    attackSpeed() {
      return AGRITH_ATTACK_SPEED;
    }

    attackDistance() {
      return AGRITH_ATTACK_DISTANCE;
    }

    start(npc, target) {
      const inMelee = api.core.CombatRange.canReach(npc, api.core.CombatFactory.MELEE_COMBAT, target);
      const prayers = target.getPrayerActive?.() ?? [];
      const protectMelee = prayers[PrayerHandler.PROTECT_FROM_MELEE] === true;
      const protectMagic = prayers[PrayerHandler.PROTECT_FROM_MAGIC] === true;
      this.telekinetic = false;
      const cast = !inMelee || protectMelee;
      this.style = cast ? CombatType.MAGIC : CombatType.MELEE;
      if (!cast) {
        npc.performAnimation?.(new Animation(SEQ_DEMON_ATTACK_GREATER));
        return;
      }
      npc.performAnimation?.(new Animation(FIRE_BLAST.anim));
      if (!inMelee && protectMagic) {
        this.telekinetic = true;
        castTelegrab(npc, target);
        return;
      }
      npc.performGraphic?.(new Graphic(FIRE_BLAST.startGraphic, GraphicHeight.HIGH));
      const projectile = Projectile.createProjectile(
        npc, target, FIRE_BLAST.projectile, FIRE_BLAST.start, FIRE_BLAST.end,
        FIRE_BLAST.startHeight, FIRE_BLAST.endHeight
      ).withAngle(16).withProgress(64);
      // Ours t2235/t2513: launched at 51, landing at 46 + 10 a tile (56 next to him, 66 a tile further).
      this.landing = projectile.getTiming().endCycleOffset;
      projectile.sendProjectile();
      const at = npc.getLocation();
      target.getPacketSender?.().sendAreaSound(FIREBLAST_CAST_SOUND, at.getX(), at.getY(), at.getZ(), 1, 0, 10);
    }

    hits(npc, target) {
      if (this.telekinetic) return [];
      const delay = this.style === CombatType.MAGIC ? Projectile.ticksToLand(this.landing) : 0;
      const hit = new PendingHit(npc, target, this, delay);
      hit.setTotalDamage(Math.min(AGRITH_MAX_HIT, hit.getTotalDamage()));
      if (this.style === CombatType.MAGIC) {
        const sender = target.getPacketSender?.();
        if (hit.isAccurate()) {
          target.performGraphic?.(Graphic.delayed(GFX_FIREBLAST_ON_PLAYER, this.landing, GraphicHeight.HIGH));
          sender?.sendSoundEffect(FIREBLAST_HIT_SOUND, 1, this.landing);
        } else {
          hit.withoutHitsplat();
          target.performGraphic?.(Graphic.delayed(GFX_SPLASH, this.landing, GraphicHeight.HIGH));
          sender?.sendSoundEffect(SPELL_FAIL_SOUND, 1, this.landing);
        }
      }
      return [hit];
    }
  }

  function handleAgrithNaarBeforeDeath(event) {
    const npc = event.npc;
    if (!npc || npc.getId?.() !== NpcIdentifiers.AGRITH_NAAR) return;
    const killer = event.killer ?? npc.getCombat?.().getKiller?.(false);
    if (!killer || killer.isPlayer?.() !== true) return;
    if (demonNpcs.get(killer) !== npc) return;
    // The Wiki: Silverlight equipped and in melee distance as he loses his last hitpoints, whatever
    // lands it (a spell or poison included), or his health is restored to 12.
    const inMelee = api.core.CombatRange.canReach(npc, api.core.CombatFactory.MELEE_COMBAT, killer);
    if (silverlightEquipped(killer) && inMelee) return;
    npc.setHitpoints(DEMON_HP_ON_REGEN);
    // Ours t2709: the player had stepped away as the blow landed. No capture has the unarmed case;
    // it restores him without a message.
    if (!inMelee) killer.sendMessage("Silverlight's power can't affect Agrith-Naar from this far away.");
    event.preventDeath = true;
  }

  function handleAgrithNaarDeath(event) {
    const killer = event.killer;
    const npc = event.npc;
    if (!killer?.isPlayer?.() || !npc) return;
    if (demonNpcs.get(killer) !== npc) return;
    demonNpcs.delete(killer);
    convertSilverlightToDarklight(killer);
    setStage(killer, STAGE_KILLED);
    // Rsprox 572 tick 1419: this line is not in the transcript, and comes first.
    killer.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(
      new api.core.ItemStatementDialogue(0, DARKLIGHT_ITEM_ID, FINAL_BLOW_TEXT),
      new api.core.ActionDialogue(1, { execute: () => {
        startTranscript(api, killer, NpcIdentifiers.MATTHEW, PAGE, "summoning-agrith-naar-killing-agrith-naar");
      } }),
    ));
  }

  // ============================================================================
  // Session lifecycle
  // ============================================================================

  // The strange implement is The Golem's world spawn at 2713,4913 (ground-items.json), which comes
  // back after it is taken (ours t604 -> t611; the Wiki: "respawns a second later").

  function handleZoneEnter({ player }) {
    if (!player) return;
    if (inThroneRoom(player) && quest.getStage(player) >= STAGE_IN_GROUP && quest.getStage(player) < STAGE_COMPLETE) {
      roomScene(player);
    }
    ensureDemon(player);
    ensureWizardNpcs(player);
  }

  /** Rsprox 572 t1452: the player leaves by teleport, and the cast that stayed goes then. */
  function handleThroneZoneExit({ player }) {
    if (!player) return;
    removeAllWizards(player);
  }

  function handleUzerEnter({ player }) {
    if (player && stormRaging(player)) enterStorm(player);
  }

  function handleUzerExit({ player }) {
    if (player) leaveStorm(player);
  }

  /** Re-tracks, or respawns, the fight after a relog. */
  function ensureDemon(player) {
    if (demonNpcs.has(player) || quest.getStage(player) !== STAGE_SUMMONED || !inThroneRoom(player)) return;
    for (const npc of api.getWorld?.().getNpcs?.() ?? []) {
      if (npc?.getId?.() === NpcIdentifiers.AGRITH_NAAR && npc.getOwner?.() === player) {
        demonNpcs.set(player, npc);
        return;
      }
    }
    spawnAgrithNaar(player);
    const scene = Scenes.get(player);
    if (scene) scene.phase = "fight";
  }

  function handleLogin({ player }) {
    if (!player) return;
    refreshQuestList(player);
    // A helper on their way (or Denath on his) when the player left has arrived (gone).
    settleArrivals(player);
    if (quest.getStage(player) >= STAGE_RITUAL_DONE) setHelperBits(player, helperBits(player) | BIT_DENATH);
    syncShadowVarbits(player);
    handleZoneEnter({ player });
    if (quest.getStage(player) === STAGE_RITUAL_DONE && !(helperBits(player) & BIT_TANYA) && inThroneRoom(player)) {
      beginPortalClosing(player);
    }
  }

  /**
   * The Wiki: if the chat is cancelled after the kill, "un-equipping Darklight triggers the final
   * dialogue that completes the quest" (Quest Helper step 124, unequipDarklight).
   */
  function darklightRemoved({ player, equipped }) {
    if (!player || equipped || quest.getStage(player) !== STAGE_KILLED) return;
    if ((player.getEquipment().getItems() || []).some((item) => item?.getId?.() === DARKLIGHT_ITEM_ID)) return;
    if (chatboxOpen(player)) return;
    startTranscript(api, player, NpcIdentifiers.MATTHEW, PAGE, "summoning-agrith-naar-killing-agrith-naar");
  }

  function handleBootstrapComplete({ player }) {
    if (!player) return;
    syncShadowVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    restoreRitualView(player);
    sandstorms.delete(player);
    Scenes.end(player, true);
    removeAllWizards(player);
    removeWalkers(player);
    removeDemon(player);
  }

  // ============================================================================
  // Journal
  // ============================================================================

  function helperLine(done, doneText, pendingText) {
    return done ? `<str>${doneText}</str>` : pendingText;
  }

  const B = "<col=000080>";
  const R = "<col=800000>";
  /** The journal as the capture shows it (ticks below); the stages it never opened keep our own wording. */
  const JOINED_STRUCK = [
    "<str>I infiltrated a group of dark wizards that is planning to",
    "<str>summon the demon Agrith-Naar, so that I can slay the demon",
    "<str>when it appears.",
  ];
  const SIGIL_STRUCK = ["<str>I made a demonic sigil, which I will need in the summoning", "<str>ritual."];
  const RETURNED_STRUCK = [
    "<str>I joined a group of dark wizards in Uzer who were going to",
    "<str>summon the demon Agrith-Naar, so that I could kill the demon",
    "<str>when it was summoned. But the leader of the group, Denath,",
    "<str>turned out to be Agrith-Naar in human form, and the",
    "<str>summoning ritual actually returned him to his own dimension",
  ];

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      // Ours: no capture opens the journal after the quest.
      return [
        ...RETURNED_STRUCK,
        "<str>where he would be far more powerful! I assembled the",
        "<str>surviving wizards, Fr. Badden, Fr. Reen and the golem, and we",
        "<str>summoned Agrith-Naar, and I slew him with Silverlight.",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SUMMONED) {
      // t2543
      return [
        ...RETURNED_STRUCK,
        "<str>where he would be far more powerful! I assembled the",
        "<str>surviving wizards, Fr. Badden, Fr. Reen and the golem, and we",
        "<str>summoned Agrith-Naar.",
        `${B}Now I must slay ${R}Agrith-Naar${B} using ${R}Silverlight${B}!`,
      ];
    }
    if (stage >= STAGE_RITUAL_DONE) {
      // t1835 (stage 90); the helper lines after it are ours.
      const bits = helperBits(player);
      return [
        ...RETURNED_STRUCK,
        "<str>where he would be far more powerful!",
        `${B}Three of the ${R}wizards${B} ran away. I should convince them to come`,
        `${B}back so that we can perform the ritual again and I can kill`,
        `${B}${R}Agrith-Naar${B}.`,
        ...(stage >= STAGE_PREPARE ? [
          "",
          helperLine(bits & BIT_DAVE, "Evil Dave will return to the throne room.", `I must convince ${R}Evil Dave${B} to return.`),
          helperLine(bits & BIT_BADDEN, "Father Badden will help.", `${R}Father Badden${B} needs a ${R}demonic sigil${B}.`),
          helperLine(bits & BIT_REEN, "Father Reen will help.", `${R}Father Reen${B} needs a ${R}demonic sigil${B}.`),
          helperLine(bits & BIT_GOLEM, "The clay golem will help.", `The ${R}clay golem${B} needs a ${R}demonic sigil${B}.`),
        ] : []),
      ];
    }
    if (stage >= STAGE_BOOK_SHOWN) {
      // Ours: not opened at 70 or 80.
      return [...JOINED_STRUCK, ...SIGIL_STRUCK, "<str>I found Josef's book and showed it to Matthew.",
        `${B}I should be ready for the ritual to summon ${R}Agrith-Naar${B}.`];
    }
    if (stage >= STAGE_GOLEM_TOLD) {
      // t1428 (the sigil made) and t1530 (the book found).
      const sigil = hasItem(player, DEMONIC_SIGIL_ITEM_ID) ? SIGIL_STRUCK : [];
      if (hasItem(player, DEMONIC_TOME_ITEM_ID)) {
        return [...JOINED_STRUCK, ...sigil,
          `${B}I found a ${R}book${B} that another wizard hid in the ruins. I should`,
          `${B}show it to ${R}Matthew${B}.`];
      }
      return [...JOINED_STRUCK, ...sigil,
        `${R}Matthew${B} told me that another wizard stole a book from ${R}Denath${B}`,
        `${B}and tried to run away. The ${R}golem${B} told me it saw the wizard hide`,
        `${B}the book in one of the ${R}broken kilns${B}.`];
    }
    if (stage >= STAGE_MATTHEW_TOLD) {
      // Ours: the stage-60 lines without the golem's.
      const sigil = hasItem(player, DEMONIC_SIGIL_ITEM_ID) ? SIGIL_STRUCK : [];
      return [...JOINED_STRUCK, ...sigil,
        `${R}Matthew${B} told me that another wizard stole a book from ${R}Denath${B}`,
        `${B}and tried to run away. I should ask around about what happened.`];
    }
    if (stage >= STAGE_DENATH_TOLD) {
      // t849
      return [...JOINED_STRUCK,
        `${R}Denath${B} told me to make myself a ${R}demonic sigil${B} out of silver. I`,
        `${B}should speak to the wizards and find which one has the ${R}sigil`,
        `${R}mould${B}.`];
    }
    if (stage >= STAGE_IN_GROUP) {
      // Ours: not opened at 30.
      return [...JOINED_STRUCK, `${B}I should speak to ${R}Denath${B}.`];
    }
    if (stage >= STAGE_INFILTRATE) {
      // t513
      return [
        "<str>I talked to Fr. Reen in Al Kharid and Fr. Badden in Uzer and",
        "<str>agreed to help them slay the demon Agrith-Naar.",
        `${B}I need to infiltrate the group of dark wizards led by ${R}Denath${B},`,
        `${B}so that I can be in position to kill ${R}Agrith-Naar${B} when they`,
        `${B}summon him.`,
      ];
    }
    if (stage >= STAGE_STARTED) {
      // t95
      return [
        "<str>I talked to Fr. Reen in Al Kharid. He told me that a group of",
        "<str>dark wizards led by Denath is planning to summon a demon,",
        "<str>and he wants me to slay the demon once it is summoned.",
        `${B}Reen asked me to speak to his partner ${R}Badden${B} who is in ${R}Uzer${B}.`,
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Father Reen</col>",
      "south of the <col=800000>Al Kharid</col> bank.",
      "",
      "I must have completed <col=800000>The Golem</col> and <col=800000>Demon Slayer</col>,",
      "and I should be able to defeat a level 100 demon.",
    ];
  }

  function grantReward(player) {
    const skill = chosenSkill(player) ?? Skill.STRENGTH;
    player.getSkillManager().addExperiences(skill, COMBAT_XP);
  }

  // ============================================================================
  // Registration
  // ============================================================================

  itemOnGroundManager = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "shadow_of_the_storm",
    name: "Shadow of the Storm",
    varpId: VARP_SHADOW_OF_THE_STORM,
    varbitId: VARBIT_AGRITH_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    varbitValue(stage) {
      return stage >= STAGE_COMPLETE ? VARBIT_QUEST_FINISHED : stage | 0;
    },
    questPoints: 1,
    xpRewards: [],
    scrollItemId: DEMONIC_SIGIL_ITEM_ID, // ours t2782: the scroll's model is the sigil
    rewardItemLabel: "Darklight",
    buildJournal,
    onReward: grantReward,
  });


  api.persistAttribute(HELPERS_ATTRIBUTE);
  api.persistAttribute(KILN_ATTRIBUTE);
  api.persistAttribute(INCANTATION_ATTRIBUTE);
  api.persistAttribute(REWARD_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEvent);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptText);
  api.onCustomEvent("npc-dialogue:menu", shapeMenu);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
  api.onCustomEvent("equipment:changed", darklightRemoved);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onCanUseItem(refuseSigilAfterQuest);
  api.onItemOnItem(handleItemOnItem, { noted: false });
  api.onInterfaceActionButton(OBJECTBOX_GROUP << 16, answerDyeQuestion);
  api.onItemOnNpc(handleItemOnNpc);
  // Before LocTeleports, whose captured entry climbs these stairs.
  api.onBeforeObjectInteraction(handleStairs);
  api.onCustomEvent("loc-teleports:arrived", stormArrival);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onZoneEnter(UNDERGROUND_ZONE, handleZoneEnter);
  api.onZoneEnter(THRONE_ZONE, handleZoneEnter);
  api.onZoneExit(THRONE_ZONE, handleThroneZoneExit);
  api.onZoneEnter(UZER_ZONE, handleUzerEnter);
  api.onZoneExit(UZER_ZONE, handleUzerExit);
  api.registerNpcCombatMethodProvider([NpcIdentifiers.AGRITH_NAAR], AgrithNaarCombat, { singleton: false });
  api.onNpcBeforeDeath(handleAgrithNaarBeforeDeath);
  api.onNpcDeath(handleAgrithNaarDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
