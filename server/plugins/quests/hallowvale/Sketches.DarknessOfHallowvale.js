/**
 * Darkness of Hallowvale: Sketches unit (stages 180-250), as the live capture plays it (rsprox,
 * revision 242; ticks are the capture's).
 *
 * - Vertida (world NPC 3773, multinpc 8220) from SENT_BACK on: the Safalaan briefing, 190 and
 *   safalaan_visible (2592 = 1) on "He's very distinctive..." (t5999), and "Okay, lead the way.": the
 *   fade, the held messagebox and the landing upstairs at 3596,3203,1 (t6005-6017).
 * - The route to Safalaan: the rocky surface 18056 (its messagebox, t6107), the barricade 18054
 *   opening for a step through (inviswall 38848 + 18055 for two ticks, t6115-6117), the wall ladders
 *   17999/18000/18001/18002 (t6083-6160) and the Drakan wall shortcut 39173 (t6175-6191).
 * - Safalaan (world multinpc 6159 on the wall at 2592 = 1, 6160 at the hideout at 2592 = 2) for
 *   SAFALAAN_DESCRIBED..<SARIUS_TALKED: 195 on "Ah, Veliaf!" (t6221), the charcoal and papyrus box
 *   (objectbox_double 11, t6405), and the charcoal, three papyrus and 200 on "Good luck..." (t6409).
 * - Charcoal on papyrus on the three marked tiles, facing the castle: "You start sketching...",
 *   human_mapping 909 and m3_writing 1723 a tick on, the sketch in the papyrus' own slot three ticks
 *   after the use (north t6490-6493: 210 and 2592 = 2).
 * - The western scene (t6529-6608): an instance with Vanstrom, Ranis, Vanescula and the tray
 *   juvinate, the tithe eating, the two vampyre transformations and the three take-offs; 220 and
 *   sketch 2 as it fades out (t6601).
 * - The southern ambush (t6652-6790): Vanstrom's walk and "Prepare to die!" (230 past it, t6677), his
 *   five attacks eight ticks apart, the knockout, Sarius' scene (240 and sarius_visible 2593 = 1,
 *   t6739), Sarius (6161) waking the player with no Talk-to (t6745), 250 on "And now be away..."
 *   (t6776) and 2593 = 0 as she goes (t6783). The third sketch is made after that, at 250 (t6789).
 * - Veliaf (world NPC 8277) for SENT_BACK..<SEALED_MESSAGE, the sketch Look-at interfaces 455/456/457
 *   (t6871-6881), sketches lost and made again, and Old Man Ral's papyrus top-up.
 *
 * Words are the "Darkness of Hallowvale" transcript page's; Safalaan's hand-in (2575) is the Lab unit's.
 */
const { createQuestScenes } = require("../QuestScenes");
const { giveReward, loadTranscripts } = require("../QuestRuntime");
const ROUTE = require("../quests/data/darkness-of-hallowvale-route.json");

module.exports = function attachSketches(context) {
  const { api, state, common, requirements, STAGE, VARBIT, PAGE } = context;
  const {
    ItemIdentifiers: I, NpcIdentifiers: N, Location, GameObject, Item, Animation, HitDamage, HitMask, CombatType,
    PrayerHandler, AccuracyFormulasDpsCalc, StatementDialogue, MovementQueue,
  } = api.core;

  // ---------------------------------------------------------------------------
  // Ids (cache gamevals)
  // ---------------------------------------------------------------------------

  const ITEM = Object.freeze({
    CHARCOAL: I.CHARCOAL, // 973
    PAPYRUS: I.PAPYRUS, // 970
    SKETCH_1: 9646, // myq3_castle_sketch_1 (northern approach)
    SKETCH_2: 9647, // myq3_castle_sketch_2 (western approach)
    SKETCH_3: 9648, // myq3_castle_sketch_3 (southern approach)
  });
  const SKETCHES = [ITEM.SKETCH_1, ITEM.SKETCH_2, ITEM.SKETCH_3];
  /** Look-at opens each sketch's own main modal (t6871-6881). */
  const SKETCH_INTERFACE = new Map([
    [ITEM.SKETCH_1, 455], // myq3_castle_sketch_north
    [ITEM.SKETCH_2, 457], // myq3_castle_sketch_west
    [ITEM.SKETCH_3, 456], // myq3_castle_sketch_south
  ]);

  const NPC = Object.freeze({
    SAFALAAN: N.SAFALAAN_HALLOW, // 3775 (world 6159 on the wall, 6160 at the hideout)
    SAFALAAN_WALL: 6159, // myreque_pt3_multi_safalaan_castle (2592 = 1 -> 3775); live's chathead (t6208)
    VANSTROM_HUMAN: N.VANSTROM_KLAUSE, // 3733 myq3_vanstrom_klause_human
    VANSTROM_GROUNDED: N.VANSTROM_KLAUSE_2, // 3734 myq3_vanstrom_klause_grounded_vampire_state
    VANSTROM_ATTACK: N.VANSTROM_KLAUSE_3, // 3735 myq3_vanstrom_klause_vampyre_attack
    VANSTROM_CUTSCENE: N.VANSTROM_KLAUSE_4, // 3736 myq3_vanstrom_klause_vampyre_cutscene
    VANSTROM_FLYING: N.VANSTROM_KLAUSE_5, // 3737 myq3_vanstrom_klause_flying
    VANSTROM_TAKEOFF: N.VANSTROM_KLAUSE_6, // 3738 myq3_vanstrom_klause_takeoff
    VANESCULA: 3740, // myq3_vanescula_drakan
    VANESCULA_GROUNDED: 3741, // myq3_vanescula_drakan_grounded_vampire_state
    VANESCULA_FLYING: 3742, // myq3_vanescula_drakan_flying
    VANESCULA_TAKEOFF: 3743, // myq3_vanescula_drakan_takeoff
    RANIS: 3744, // myq3_ranis_drakan
    RANIS_GROUNDED: 3745, // myq3_ranis_drakan_grounded_vampire_state
    RANIS_FLYING: 3746, // myq3_ranis_drakan_flying
    RANIS_TAKEOFF: 3747, // myq3_ranis_drakan_takeoff
    TRAY_JUVINATE: 3700, // sang_myq3_male_juvinate_pouch_tray (t6537)
    SARIUS: N.SARIUS_GUILE, // 3776 myq3_sarius_guile
    SARIUS_CUTSCENE: N.SARIUS_GUILE_2, // 3778 myq3_sarius_guile_cutscene
    SARIUS_CASTLE: 6161, // myq3_multi_sarius_castle (2593 = 1 -> 3776), t6741
  });
  const VANSTROM_IDS = new Set([NPC.VANSTROM_ATTACK, NPC.VANSTROM_CUTSCENE]);

  const LOC = Object.freeze({
    ROCKY_SURFACE: 18056, // myq3_secret_rock_barricade_unlock
    BARRICADE: 18054, // myq3_ghetto_baricade_wall_secretpass
    BARRICADE_INACTIVE: 18055, // myq3_ghetto_baricade_wall_secretpass_inactive
    INVISWALL: 38848, // inviswall
    LADDER_DOWN: 17999, // myq3_ladder_down
    LADDER_UP: 18000, // myq3_ladder_up
    LADDER_DOWN_2: 18001, // myq3_ladder_down_2
    LADDER_UP_2: 18002, // myq3_ladder_up_2
    WALL_UP: 39173, // darkm_outer_wall_3h_meyerditch_wall_shortcut_bottom
    WALL_DOWN: 39172, // its top
  });
  const WALL_LADDERS = new Set([LOC.LADDER_DOWN, LOC.LADDER_UP, LOC.LADDER_DOWN_2, LOC.LADDER_UP_2]);

  const ANIM = Object.freeze({
    PICKUP_FLOOR: 827, // human_pickupfloor: down a ladder (t6099)
    REACH_LADDER: 828, // human_reachforladder: up a ladder or the wall (t6127, t6190)
    MAPPING: 909, // human_mapping (t6491)
    TITHE_EATING: 4725, // myq3_blood_tithe_pouch_eating (t6557)
    TRANSFORM_1: 4733, // myq3_human_to_vampire_transform_pt1 (t6573)
    TRANSFORM_2: 4734, // myq3_human_to_vampire_transform_pt2 (t6576)
    KICK: 4715, // myq3_vanstrom_klause_kick (t6679)
    PUNCHES: 4716, // myq3_vanstrom_klause_punches (t6687)
    SPECIAL_PUNCH: 4717, // myq3_vanstrom_klause_special_punch (t6711)
    KNOCKED_OUT: 4718, // myq3_vanstrom_klause_special_punch_player_knockout (t6711, delay 40; t6717)
    REGAINING: 4719, // myq3_vanstrom_klause_player_regaining_conciousness (t6744)
    RESET: -1,
  });
  const GFX_TRANSFORM = 785; // myq3_head_vampyre_transform, delay 100 (t6573)
  const SOUND = Object.freeze({
    WRITING: 1723, // m3_writing (t6491)
    EAT: 2393, SUCK: 886, HIT: 884, // t6557
    TRANSFORM: 2994, // vampire_transform, delay 12 (t6573)
    FLIES_AWAY: 2993, // vampire_flies_away (t6588)
    VANSTROM_LAUGHS: 1192, // t6668
    KICK: 888, // vyrewatch_vampire_attack (t6679)
    PUNCH: 879, // vampire_attack (t6687)
    HUMAN_HIT: 518, // human_hit_1, delay 20 (t6687)
    BLOCK: 2964, // granite_shield_2, delay 20 (t6679)
    SPECIAL_BLOCK: 2967, // granite_shield_5, delay 20 (t6711)
    STUNNED: 2727, // delay 40 (t6711)
    DOOR_OPEN: 62, // the barricade (t6115)
  });
  /** The tithe meal's sounds and their delays (t6557). */
  const MEAL_SOUNDS = Object.freeze([
    [SOUND.EAT, 0], [SOUND.SUCK, 55], [SOUND.EAT, 75], [SOUND.HIT, 75], [SOUND.SUCK, 85], [SOUND.EAT, 100],
    [SOUND.SUCK, 150], [SOUND.EAT, 175], [SOUND.EAT, 180], [SOUND.SUCK, 200], [SOUND.EAT, 250], [SOUND.HIT, 300],
    [SOUND.SUCK, 310],
  ]);
  const MUSIC = Object.freeze({ WEST: 677, SOUTH: 504 }); // domain of the vampyres (t6534), fangs for the memory (t6657)
  const AREASOUNDS_OVERRIDE_VARP = 5588; // 1 in the scenes (t6534)
  const AREASOUNDS_OPTION_VARP = 5589; // 56 in the scenes (t6534)
  const CAM_FORCEANGLE_SCRIPT = 143; // cam_forceangle(150, 512) (t6659, t6677)
  const SCENE_CAMERA_RATES = Object.freeze({ rate: 100, rate2: 100 }); // t6537, t6660, t6718

  // The cache's combat info for 3735 (level 169, max hit 16, speed 8). The Wiki: melee only.
  const VANSTROM_MAX_HIT = 16;
  const VANSTROM_ATTACKS = Object.freeze([
    { anim: ANIM.KICK, sound: SOUND.KICK }, // t6679
    { anim: ANIM.PUNCHES, sound: SOUND.PUNCH }, // t6687
    { anim: ANIM.PUNCHES, sound: SOUND.PUNCH }, // t6695
    { anim: ANIM.KICK, sound: SOUND.KICK }, // t6703
    { anim: ANIM.SPECIAL_PUNCH, sound: SOUND.PUNCH, knockout: true }, // t6711
  ]);

  // ---------------------------------------------------------------------------
  // Places (capture tiles)
  // ---------------------------------------------------------------------------

  /** The marked tiles, and the tile ten away the player is turned to face (t6490, t6529, t6652). */
  const SPOT = Object.freeze({
    NORTH: { tile: [3556, 3379, 0], faces: [3556, 3369] },
    WEST: { tile: [3522, 3357, 0], faces: [3532, 3357] },
    SOUTH: { tile: [3572, 3331, 0], faces: [3572, 3341] },
  });
  const LEAD_LANDING = Object.freeze([3596, 3203, 1]); // upstairs west of Trader Sven (t6008)
  const BARRICADE_TILES = Object.freeze({ wall: [3589, 3215, 0], south: [3589, 3214, 0], rotation: 3 }); // t6115
  const WALL_TOP = Object.freeze([3595, 3312, 0]); // t6191
  const WALL_FOOT = Object.freeze([3595, 3310, 1]); // Ours: the shortcut's other end, as the route table has it

  const WEST_SCENE = Object.freeze({
    name: "darkness-of-hallowvale-west-sketch",
    // rebuild_region_v2 1676/1863: 13 x 13 zones from 3488,3304 unturned (t6535).
    sourceChunk: [436, 413],
    bounds: [[3488, 3591, 3304, 3407, 0]],
    camera: [[3530, 3351, 560], [3536, 3361, 20]], // t6537
    tray: { at: [3533, 3358, 0], faces: [3534, 3358] }, // east
    ranis: { at: [3534, 3358, 0], faces: [3533, 3358] }, // west
    vanescula: { at: [3534, 3359, 0], faces: [3533, 3358] }, // south-west
    vanstrom: { at: [3534, 3357, 0], faces: [3533, 3358] }, // north-west
  });
  /** Each flyer's tiles, one a tick from its first move (t6593-6602). */
  const FLIGHT = Object.freeze({
    vanescula: Array.from({ length: 10 }, (_, i) => [3533 - i, 3360 + i, 0]),
    ranis: Array.from({ length: 7 }, (_, i) => [3533 - i, 3357 - i, 0]),
    vanstrom: [[3533, 3356, 0], [3532, 3355, 0], [3532, 3354, 0], [3532, 3353, 0]],
  });

  const SOUTH_SCENE = Object.freeze({
    name: "darkness-of-hallowvale-south-ambush",
    knockout: "darkness-of-hallowvale-knockout",
    // rebuild_region_v2 1418/1908 and 1706/1908: 13 x 13 zones from 3520,3296 unturned (t6658, t6716).
    sourceChunk: [440, 412],
    bounds: [[3520, 3623, 3296, 3399, 0]],
    vanstromSpawn: [3583, 3331, 0], // t6660, facing west
    vanstromStand: [3575, 3331, 0], // t6668
    vanstromAttack: [3573, 3331, 0], // t6678
    camera: [[3583, 3331, 560], [3573, 3331, 20]], // t6660
    knockoutCamera: [[3565, 3331, 560], [3573, 3331, 20]], // t6718
    knockoutVanstrom: [3573, 3331, 0], // t6718
    sariusSpawn: [3582, 3331, 0], // t6718
    sariusStand: [3576, 3331, 0], // t6724
    playerLies: [3582, 3331], // t6717
    sarius: [3576, 3331, 0], // 6161 on the real map (t6741), facing west
  });

  // ---------------------------------------------------------------------------
  // Timing (ticks)
  // ---------------------------------------------------------------------------

  const SKETCH_TICKS = Object.freeze({ START: 1, MADE: 3 }); // t6490 -> t6491 -> t6493
  const LEAD_TICKS = Object.freeze({ HOLD: 4, MINIMAP: 1, LAND: 3 }); // t6005 -> t6006 -> t6008 -> t6009
  const LADDER_TICKS = 1; // the climb anim, the teleport a tick later (t6099 -> t6100)
  const ROCKS_TICKS = 1; // arriving -> the messagebox (t6106 -> t6107)
  const BARRICADE_TICKS = Object.freeze({ OPEN: 1, CLOSE: 2 }); // arriving t6114 -> t6115 open -> t6117 shut
  // From the use on the west tile (t6529).
  const WEST_TICKS = Object.freeze({ FADE_OUT: 3, CUTSCENE: 5, OPEN: 6, FACE: 7, CAST: 8, LINE: 10 });
  // The vampyres turning (from the continue, t6573 / t6582).
  const TURN_TICKS = Object.freeze({ RANIS: 2, VANESCULA_DONE: 3, RANIS_DONE: 5, LINE: 7, VANSTROM_DONE: 3 });
  // The take-off (from the last line's continue, t6587).
  const TAKEOFF_TICKS = Object.freeze({
    VANESCULA: 1, RANIS: 4, VANESCULA_FLIES: 6, VANSTROM: 7, RANIS_FLIES: 9, VANSTROM_AIRBORNE: 10, VANSTROM_FLIES: 12,
    MADE: 14, END: 16, FADE_IN: 19,
  });
  // From the use on the south tile (t6652).
  const SOUTH_TICKS = Object.freeze({ FADE_OUT: 3, CUTSCENE: 5, OPEN: 6, ANGLE: 7, VANSTROM: 8, FADE_IN: 9, LINE: 16 });
  // From "Prepare to die!"'s continue (t6677).
  const FIGHT_TICKS = Object.freeze({ FIRST: 2, EVERY: 8, FADE_OUT: 36, CUTSCENE: 38, OPEN: 39, LIE: 40, CAST: 41, FADE_IN: 42, LINE: 45 });
  // From Vanstrom's last line's continue (t6739).
  const WAKE_TICKS = Object.freeze({ BACK: 2, FADE_IN: 5, LINE: 6 });
  // From Sarius' last line's continue (t6780).
  const LEAVE_TICKS = Object.freeze({ GONE: 3, FADE_IN: 4 });

  // ---------------------------------------------------------------------------
  // Transcript variants and steps ("Darkness of Hallowvale")
  // ---------------------------------------------------------------------------

  const V = Object.freeze({
    VELIAF_SENT_BACK: "misthalin-diplomacy-talking-to-veliaf-again-after-being-sent-to-inform-the-sanguinesti-myreque",
    VELIAF_AFTER_SAFALAAN: "close-encounters-with-vyre-kind-talking-to-veliaf-hurtz-after-talking-to-safalaan-hallow",
    VERTIDA_BRIEFING: "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-being-sent-to-inform-the-sanguinesti-myreque",
    VERTIDA_AGAIN: "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-again-after-being-sent-to-meet-safalaan",
    VERTIDA_AFTER_SAFALAAN: "close-encounters-with-vyre-kind-talking-to-vertida-sefalatis-after-talking-to-safalaan-hallow",
    BARRICADE_STUCK: "close-encounters-with-vyre-kind-starting-the-route-to-the-walls-of-castle-drakan-attempting-to-open-the-barricade-with-vertida-s-advise",
    ROCKS: "close-encounters-with-vyre-kind-starting-the-route-to-the-walls-of-castle-drakan-searching-the-rocky-surface-with-vertida-s-advise",
    SAFALAAN: "close-encounters-with-vyre-kind-talking-to-safalaan-hallow",
    SAFALAAN_AGAIN: "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-again",
    SAFALAAN_ONE_SKETCH: "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-after-completing-at-least-one-sketch",
    SAFALAAN_SAVED: "close-encounters-with-vyre-kind-talking-to-safalaan-hallow-after-being-saved-by-sarius-guile",
    SAFALAAN_SKETCH_EARLY: "close-encounters-with-vyre-kind-using-the-castle-sketch-1-or-2-on-safalaan-before-sketching-the-third",
    RAL: "close-encounters-with-vyre-kind-talking-to-old-man-ral-after-talking-to-safalaan-hallow",
    NORTH: "close-encounters-with-vyre-kind-sketching-the-north-side",
    NORTH_AGAIN: "close-encounters-with-vyre-kind-attempting-to-sketch-the-north-side-again",
    WEST: "close-encounters-with-vyre-kind-sketching-the-west-side",
    WEST_FIRST: "close-encounters-with-vyre-kind-attempting-to-sketch-the-west-side-first",
    WEST_AGAIN: "close-encounters-with-vyre-kind-attempting-to-sketch-the-west-side-again",
    SOUTH: "close-encounters-with-vyre-kind-sketching-the-south-side",
    SOUTH_FIRST: "close-encounters-with-vyre-kind-attempting-to-sketch-the-south-side-first",
    SOUTH_SECOND: "close-encounters-with-vyre-kind-attempting-to-sketch-the-south-side-second",
    SOUTH_SAVED: "close-encounters-with-vyre-kind-sketching-the-south-side-after-being-saved-by-sarius-guile",
    SOUTH_AGAIN: "close-encounters-with-vyre-kind-attempting-to-sketch-the-south-side-again",
  });
  const OWN_VARIANTS = new Set(Object.values(V));

  const STEP = Object.freeze({
    LEAD_MESSAGE: "mn0688", // "Vertida leads you through the ghetto."
    LEAD: "lTNaN8",
    MAKE_OWN_WAY: "1zYlRN", // the "again" variant's "I'll make my own way." (unavailable in the dump)
    ROCKS_MOVE: "_bUtsy",
    BARRICADE_STUCK: "0VbUe7",
    SUPPLIES_BOX: "aChHI6",
    SUPPLIES_CHARCOAL: "H84BAo",
    SUPPLIES_PAPYRUS: "q1EHcV",
    RAL_SHORT: "5Ts7kd",
    RAL_ENOUGH: "zcyKoD",
    RAL_GIVES: "UUhUYv",
    NORTH_START: "Ifabgn", NORTH_MADE: "58OQpM", NORTH_LOSE: "40UwLv", NORTH_RECEIVE: "stfs9v",
    WEST_START: "r6uUzK", WEST_SCENE: "H08YVz", WEST_MEAL: "3Ha3WJ", WEST_TURN: "-QYxyg", WEST_VANSTROM_TURNS: "Wu_bUf",
    WEST_FLY: "qHbvMS", WEST_MADE: "VwrJWg", WEST_LOSE: "5hTQYh", WEST_RECEIVE: "9HmeKD",
    SOUTH_START: "T3YqyD", SOUTH_APPEARS: "L482aT", SOUTH_FIGHT: "LZKiDZ", SOUTH_SARIUS: "3Ya76G",
    SOUTH_VANSTROM_DEPARTS: "aCPM8x", SOUTH_SARIUS_DEPARTS: "p6b9Lc",
    SAVED_START: "aEgg2b", SAVED_MADE: "RKJ9BA", SAVED_LOSE: "yFIZpi", SAVED_RECEIVE: "IxTC2L",
  });
  /** Prose markers whose work is done elsewhere in this unit: the engine just carries on. */
  const NO_OPS = new Set([
    STEP.SUPPLIES_CHARCOAL, STEP.SUPPLIES_PAPYRUS, STEP.NORTH_LOSE, STEP.WEST_LOSE, STEP.SAVED_LOSE, STEP.WEST_SCENE,
    STEP.WEST_MEAL, STEP.SOUTH_APPEARS, STEP.SOUTH_SARIUS,
  ]);

  // Lines the stages hang on (the dump's own words, matched by their start).
  const LINE = Object.freeze({
    DISTINCTIVE: "He's very distinctive.", // 190 + 2592 = 1 as it shows (t5999)
    AH_VELIAF: "Ah, Veliaf! Myreque prevail!", // 195 as it shows (t6221)
    GOOD_LUCK: "Good luck, my friend.", // 200 + the items as it shows (t6409)
    BLOOD_TITHES: "Why, with these blood tithes", // the meal, on the previous continue (t6557)
    PREPARE_TO_DIE: "Ha! So we meet again", // vanstrom_laughs as it shows (t6668)
    NO_ORDERS: "I take no orders from food sacks", // Vanstrom turns to Sarius (t6732)
    AWAKEN: "Awaken!", // Sarius' wake-up talk starts here (t6745)
    BE_AWAY: "And now be away", // 250 as it shows (t6776)
  });
  const MAKE_OWN_WAY = "I'll make my own way.";

  /** Live's chat heads' expressions for this unit's lines (capture t4619-6776), by the line's start. */
  const EXPRESSIONS = Object.freeze([
    ["Well met, friend.", 588], ["What do I need to do now?", 588], ["We must inform the Sanguinesti", 591],
    ["Hello there.", 588], ["Myreque prevail! What can I do", 567], ["I have a message from Veliaf.", 590],
    ["That's not all though.", 590], ["This is disastrous!", 617], ["Where is Safalaan", 554],
    ["He's out on a mission", 589], ["There is a barricade", 591], ["Okay, great, that's helpful.", 589],
    ["He's very distinctive.", 590], ["Anyway, I need to head", 590], ["Okay, lead the way.", 588],
    ["You must be Safalaan.", 589], ["Vertida, eh?", 588], ["He's asked me to come", 589], ["Ah, Veliaf!", 590],
    ["I went to see King Roald", 590], ["Guthixian edicts?", 590], ["I'm afraid that's not all.", 590],
    ["This is terrible!", 574], ["I must return to the base", 589], ["Can I help in some way?", 588],
    ["Yes, you certainly can", 590], ["I can certainly try!", 589], ["Indeed there are.", 589],
    ["I've checked the vyrewatch", 591], ["One of the others has already marked", 591], ["Good luck, my friend.", 589],
    ["So yes, Lady Vanescula", 590], ["Good, good!", 567], ["If I remember, madam", 568], ["Ha, ha, ha.", 567],
    ["Perhaps a light refreshment", 555], ["Why, with these blood tithes", 567], ["Visciously efficient", 606],
    ["Mmm, delicious!", 568], ["But we really have to get on.", 588], ["The same is true for me", 588],
    ["Ha! So we meet again", 614], ["Sorry for the interruption", 590], ["I take no orders", 590],
    ["Awaken!", 588], ["Huh? What happened?", 588], ["Your life may be forfeit", 590], ["As a gesture", 590],
    ["The message you will find", 590], ["And now be away", 589],
  ]);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: "darkness-of-hallowvale:sketch-scene-exit" });
  /** player -> the sketch under way ({ slot, spot }) between the use and its result. */
  const sketching = new WeakMap();
  /** player -> the western scene's cast. */
  const westCasts = new WeakMap();
  /** player -> the ambush ({ vanstrom, sarius, attacks }). */
  const ambushes = new WeakMap();
  /** player -> the Sarius 6161 spawned for the wake-up talk. */
  const sariuses = new WeakMap();
  /** Ours: live sent no varbit for the searched rocks; the unlock lasts the session. */
  const rocksSearched = new WeakSet();
  /** Players between a ladder, wall or barricade click and its move. */
  const climbing = new WeakSet();
  /** Scenes ended on purpose to open the next one (the ambush -> the knockout). */
  const handingOver = new WeakSet();

  const stage = (player) => state.stage(player);
  const within = (player, low, high) => state.within(player, low, high);
  const tile = ([x, y, z = 0]) => new Location(x, y, z);
  const startsWith = (event, prefix) => String(event.step?.text ?? event.step?.player ?? event.text ?? "").startsWith(prefix);
  const sketchesGiven = (player) => state.get(player, VARBIT.SKETCHES_GIVEN) === 1;

  function variantOf(event) {
    const entry = Array.isArray(event?.pages) ? event.pages.find((candidate) => candidate?.page === PAGE) : null;
    const variant = entry?.variants?.[0] ?? null;
    return OWN_VARIANTS.has(variant) ? variant : null;
  }

  function transcript(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  /** The steps from the one with `id` (or the line starting `prefix`) on. */
  const from = (match) => (steps) => {
    const index = steps.findIndex((step) => step?.id === match || String(step?.text ?? "").startsWith(match));
    return index >= 0 ? steps.slice(index) : [];
  };
  /** Only the step with `id`. */
  const only = (id) => (steps) => steps.filter((step) => step?.id === id);
  /** The steps from `start` up to and including `end`. */
  const between = (start, end) => (steps) => {
    const a = steps.findIndex((step) => String(step?.text ?? "").startsWith(start));
    const b = steps.findIndex((step) => step?.id === end);
    return a >= 0 && b >= a ? steps.slice(a, b + 1) : [];
  };

  const sameTile = (player, [x, y, z = 0]) => {
    const at = player.getLocation();
    return at.getX() === x && at.getY() === y && at.getZ() === z;
  };

  function formOf(npc) {
    const transformed = npc?.getNpcTransformationId?.() ?? -1;
    return transformed !== -1 ? transformed : npc?.getId?.();
  }

  function transform(npc, id) {
    if (npc?.isRegistered?.()) npc.setNpcTransformationId(id);
  }

  function animate(mobile, id, delay = 0) {
    if (mobile?.isRegistered?.() !== false) mobile.performAnimation(delay ? new Animation(id, delay) : new Animation(id));
  }

  function areaSounds(player, on) {
    const sender = player.getPacketSender();
    sender.sendConfig(AREASOUNDS_OPTION_VARP, on ? 56 : 0);
    sender.sendConfig(AREASOUNDS_OVERRIDE_VARP, on ? 1 : 0);
  }

  const forceAngle = (player) => player.getPacketSender().sendClientScript(CAM_FORCEANGLE_SCRIPT, 150, 512);
  /** The empty messagebox live holds between a scene's beats (it does not touch the dialogue chain). */
  const blankBox = (player) => StatementDialogue.send(player, "", false);

  function closeChat(player) {
    player.getDialogueManager().reset?.();
    player.getPacketSender().sendInterfaceRemoval();
  }

  // ---------------------------------------------------------------------------
  // Veliaf (SENT_BACK..<SEALED_MESSAGE)
  // ---------------------------------------------------------------------------

  function talkVeliaf(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.SENT_BACK, STAGE.SEALED_MESSAGE - 1)) return false;
    if (requirements.tasteNeedsVeliafRod(player)) return false;
    // Ours: the post-Safalaan words from the supplies (200) on; before, the capture's re-talk (t4619).
    const variant = stage(player) >= STAGE.SKETCHING ? V.VELIAF_AFTER_SAFALAAN : V.VELIAF_SENT_BACK;
    return common.play(player, npcId, variant, undefined, PAGE, npc);
  }

  // ---------------------------------------------------------------------------
  // Vertida (SENT_BACK..<COMPLETE)
  // ---------------------------------------------------------------------------

  function vertidaVariant(player) {
    const now = stage(player);
    if (now < STAGE.SAFALAAN_DESCRIBED) return V.VERTIDA_BRIEFING;
    // Ours: the "again" briefing (with the lead) until Safalaan hands over the supplies, then his pointer to Safalaan.
    if (now < STAGE.SKETCHING) return V.VERTIDA_AGAIN;
    return V.VERTIDA_AFTER_SAFALAAN;
  }

  function talkVertida(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.SENT_BACK, STAGE.COMPLETE - 1)) return false;
    return common.play(player, npcId, vertidaVariant(player), undefined, PAGE, npc);
  }

  /** "He's very distinctive...": 190 and Safalaan on the wall (2592 = 1) as the line shows (t5999). */
  function safalaanDescribed(player) {
    if (state.advance(player, STAGE.SAFALAAN_DESCRIBED)) state.set(player, VARBIT.SAFALAAN_VISIBLE, 1);
  }

  /** "Vertida leads you through the ghetto.": fade, held box, the landing upstairs (t6005-6017). */
  function leadMessage(event) {
    const { player } = event;
    if (!within(player, STAGE.SENT_BACK, STAGE.SKETCHING - 1)) return;
    event.handled = true;
    event.box = { statement: true, holdTicks: LEAD_TICKS.HOLD };
    Scenes.fade(player, true);
    common.later(player, LEAD_TICKS.MINIMAP, (p) => Scenes.controls(p, true));
    common.later(player, LEAD_TICKS.LAND, (p) => p.moveTo(tile(LEAD_LANDING)));
    common.later(player, LEAD_TICKS.HOLD, (p) => {
      Scenes.fade(p, false);
      Scenes.controls(p, false);
    });
  }

  /** The "again" briefing's "I'll make my own way." is a dump gap: it plays the first briefing's own branch. */
  function makeOwnWay(event) {
    const choice = transcript(V.VERTIDA_BRIEFING).find((step) => step?.type === "choice");
    const option = choice?.options?.find((entry) => entry?.text === MAKE_OWN_WAY);
    if (!option?.steps?.length) return;
    event.handled = true;
    event.steps = option.steps;
  }

  // ---------------------------------------------------------------------------
  // The route to Safalaan (t6083-6191)
  // ---------------------------------------------------------------------------

  function searchRocks(event) {
    if (event.objectId !== LOC.ROCKY_SURFACE) return false;
    const { player } = event;
    if (stage(player) < STAGE.SENT_BACK) return false;
    if (event.location) player.setPositionToFace(tile([event.location.x, event.location.y, event.location.z ?? 0]));
    common.later(player, ROCKS_TICKS, (p) => common.play(p, NPC.SAFALAAN, V.ROCKS));
    return true;
  }

  function rocksMoved(event) {
    event.handled = true;
    event.box = { statement: true }; // messagebox 229 with its continue (t6107)
    rocksSearched.add(event.player);
  }

  /** The barricade opens for one step through: inviswall on it and the inactive loc south for two ticks (t6115). */
  function openBarricade(event) {
    if (event.objectId !== LOC.BARRICADE) return false;
    const { player } = event;
    if (stage(player) < STAGE.SENT_BACK) return false;
    const [wx, wy, wz] = BARRICADE_TILES.wall;
    const northSide = player.getLocation().getY() >= wy;
    // Ours: from the north side the barricade always opens; from the south it needs the rocks.
    if (!northSide && !rocksSearched.has(player)) {
      common.play(player, NPC.SAFALAAN, V.BARRICADE_STUCK);
      return true;
    }
    if (climbing.has(player)) return true;
    climbing.add(player);
    common.later(player, BARRICADE_TICKS.OPEN, (p) => {
      const sender = p.getPacketSender();
      const wall = new GameObject(LOC.INVISWALL, tile(BARRICADE_TILES.wall), 0, BARRICADE_TILES.rotation, null);
      const inactive = new GameObject(LOC.BARRICADE_INACTIVE, tile(BARRICADE_TILES.south), 0, 0, null);
      sender.sendObject(wall).sendObject(inactive);
      common.sound(p, SOUND.DOOR_OPEN);
      stepThrough(p, northSide ? tile(BARRICADE_TILES.south) : tile([wx, wy, wz]));
      common.later(p, BARRICADE_TICKS.CLOSE, (q) => {
        climbing.delete(q);
        q.getPacketSender().sendObject(new GameObject(LOC.BARRICADE, tile(BARRICADE_TILES.wall), 0, BARRICADE_TILES.rotation, null));
        q.getPacketSender().sendObjectRemoval(inactive);
      });
    });
    return true;
  }

  function stepThrough(player, destination) {
    const flag = MovementQueue?.IGNORE_CLIPPING_FLAG ?? "movement:ignore-clipping";
    const had = player.hasFlag?.(flag) === true;
    player.setFlag?.(flag, true);
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(destination);
    common.later(player, 1, (p) => { if (!had) p.removeFlag?.(flag); });
  }

  /**
   * The wall's ladders, claimed from the generic Ladders plugin ("ladders:climb"): the route table's far
   * end, the climb anim on arriving and the move a tick on (t6099-6100, t6127-6128, t6148-6149, t6159-6160).
   */
  function climbWallLadder(request) {
    const { player, objectId } = request;
    if (request.handled || !player || !WALL_LADDERS.has(objectId)) return;
    const destination = ladderDestination(player, objectId);
    if (!destination) return;
    const down = objectId === LOC.LADDER_DOWN || objectId === LOC.LADDER_DOWN_2;
    request.handled = climb(player, down ? ANIM.PICKUP_FLOOR : ANIM.REACH_LADDER, destination);
  }

  function ladderDestination(player, objectId) {
    const at = player.getLocation();
    let best = null;
    let bestDistance = Infinity;
    for (const entry of ROUTE) {
      if (entry.id !== objectId || entry.from[2] !== at.getZ()) continue;
      const distance = Math.max(Math.abs(entry.from[0] - at.getX()), Math.abs(entry.from[1] - at.getY()));
      if (distance < bestDistance) {
        best = entry.to;
        bestDistance = distance;
      }
    }
    return bestDistance <= 2 ? best : null;
  }

  /** The Drakan wall shortcut: up to 3595,3312,0 (t6190-6191); ours down the same way back. */
  function climbWall(event) {
    const { player, objectId } = event;
    if (objectId === LOC.WALL_UP) return climb(player, ANIM.REACH_LADDER, WALL_TOP);
    if (objectId === LOC.WALL_DOWN) return climb(player, ANIM.PICKUP_FLOOR, WALL_FOOT);
    return false;
  }

  function climb(player, animation, destination) {
    if (climbing.has(player)) return true;
    climbing.add(player);
    player.getMovementQueue().reset();
    common.anim(player, animation);
    common.later(player, LADDER_TICKS, (p) => {
      climbing.delete(p);
      p.moveTo(tile(destination));
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Safalaan (SAFALAAN_DESCRIBED..<SARIUS_TALKED)
  // ---------------------------------------------------------------------------

  function safalaanVariant(player) {
    const now = stage(player);
    if (now < STAGE.SKETCHING) return V.SAFALAAN;
    if (now < STAGE.NORTH_SKETCHED) return V.SAFALAAN_AGAIN;
    if (now < STAGE.SARIUS_SAVED) return V.SAFALAAN_ONE_SKETCH;
    return V.SAFALAAN_SAVED;
  }

  function talkSafalaan(event) {
    const { player, npcId, npc } = event;
    if (!within(player, STAGE.SAFALAAN_DESCRIBED, STAGE.SARIUS_TALKED - 1)) return false;
    return common.play(player, npcId, safalaanVariant(player), undefined, PAGE, npc);
  }

  /** "Good luck, my friend...": the charcoal, three papyrus and 200 as the line shows (t6409). */
  function suppliesGiven(player) {
    if (!state.advance(player, STAGE.SKETCHING)) return;
    giveReward(player, ITEM.CHARCOAL, 1);
    for (let i = 0; i < 3; i++) giveReward(player, ITEM.PAPYRUS, 1);
  }

  /** Castle sketch 1 or 2 on Safalaan before the third is made. */
  function useSketchOnSafalaan(event) {
    const { player, itemId, definition, npcId } = event;
    if (itemId !== ITEM.SKETCH_1 && itemId !== ITEM.SKETCH_2) return;
    if ((definition?.getName?.() ?? "") !== "Safalaan Hallow") return;
    if (!within(player, STAGE.SAFALAAN_DESCRIBED, STAGE.SARIUS_TALKED - 1)) return;
    event.handled = true;
    common.play(player, npcId, V.SAFALAAN_SKETCH_EARLY, undefined, PAGE, event.target);
  }

  // ---------------------------------------------------------------------------
  // Old Man Ral's papyrus (his post-Safalaan talk)
  // ---------------------------------------------------------------------------

  const papyrusAndSketches = (player) =>
    player.getInventory().getAmount(ITEM.PAPYRUS) + SKETCHES.filter((id) => common.held(player, id)).length;

  /** "1-3 papyrus, depending on held items": up to three papyrus and sketches together. */
  function ralGivesPapyrus(event) {
    const { player } = event;
    event.handled = true;
    const short = Math.max(0, 3 - papyrusAndSketches(player));
    for (let i = 0; i < short; i++) giveReward(player, ITEM.PAPYRUS, 1);
  }

  // ---------------------------------------------------------------------------
  // Sketching
  // ---------------------------------------------------------------------------

  function canSketch(player) {
    return within(player, STAGE.SKETCHING, STAGE.COMPLETE - 1) && !sketchesGiven(player);
  }

  /** Charcoal on papyrus: on a marked tile it sketches; elsewhere it is left to "Nothing interesting happens." */
  function useCharcoalOnPapyrus(event) {
    const { player } = event;
    if (!canSketch(player)) return false;
    const spot = [SPOT.NORTH, SPOT.WEST, SPOT.SOUTH].find((candidate) => sameTile(player, candidate.tile));
    if (!spot) return false;
    if (sketching.has(player) || Scenes.get(player) || ambushes.get(player)?.waking) return true;
    const slot = event.usedItemId === ITEM.PAPYRUS ? event.usedItemSlot : event.usedWithItemSlot;
    if (spot === SPOT.NORTH) sketchNorth(player, slot);
    else if (spot === SPOT.WEST) sketchWest(player, slot);
    else sketchSouth(player, slot);
    return true;
  }

  function sketchNorth(player, slot) {
    if (common.held(player, ITEM.SKETCH_1)) return common.play(player, NPC.SAFALAAN, V.NORTH_AGAIN);
    // A lost sketch 1 is made again the same way (no stage change).
    timedSketch(player, slot, SPOT.NORTH, V.NORTH, STEP.NORTH_START, STEP.NORTH_MADE);
  }

  function sketchWest(player, slot) {
    if (common.held(player, ITEM.SKETCH_2)) return common.play(player, NPC.SAFALAAN, V.WEST_AGAIN);
    if (stage(player) < STAGE.NORTH_SKETCHED) return common.play(player, NPC.SAFALAAN, V.WEST_FIRST);
    // Ours: a lost sketch 2 is made again without the scene.
    if (stage(player) >= STAGE.WEST_SKETCHED) return timedSketch(player, slot, SPOT.WEST, V.WEST, STEP.WEST_START, STEP.WEST_MADE);
    startSketching(player, slot, SPOT.WEST, V.WEST, STEP.WEST_START);
    westScene(player);
  }

  function sketchSouth(player, slot) {
    if (common.held(player, ITEM.SKETCH_3)) return common.play(player, NPC.SAFALAAN, V.SOUTH_AGAIN);
    const now = stage(player);
    if (now < STAGE.NORTH_SKETCHED) return common.play(player, NPC.SAFALAAN, V.SOUTH_FIRST);
    if (now < STAGE.WEST_SKETCHED) return common.play(player, NPC.SAFALAAN, V.SOUTH_SECOND);
    if (now >= STAGE.SARIUS_TALKED) return timedSketch(player, slot, SPOT.SOUTH, V.SOUTH_SAVED, STEP.SAVED_START, STEP.SAVED_MADE);
    // Ours: at 240 (the wake-up talk cut short) Sarius comes back to finish it.
    if (now >= STAGE.SARIUS_SAVED) return sariusWakes(player);
    // 220, or 230 after an ambush cut short (a death, a logout): the ambush from its start.
    startSketching(player, slot, SPOT.SOUTH, V.SOUTH, STEP.SOUTH_START);
    southAmbush(player);
  }

  /** The use's own tick: turned to the castle; a tick on, the start message, the anim and the pen (t6490-6491). */
  function startSketching(player, slot, spot, variant, startStep) {
    sketching.set(player, { slot, spot });
    player.getMovementQueue().reset();
    player.setPositionToFace(tile([spot.faces[0], spot.faces[1], spot.tile[2]]));
    common.later(player, SKETCH_TICKS.START, (p) => {
      common.play(p, NPC.SAFALAAN, variant, only(startStep));
      common.anim(p, ANIM.MAPPING);
      common.sound(p, SOUND.WRITING);
    });
  }

  /** A sketch with no scene: the result three ticks after the use (t6493). */
  function timedSketch(player, slot, spot, variant, startStep, madeStep) {
    startSketching(player, slot, spot, variant, startStep);
    common.later(player, SKETCH_TICKS.MADE, (p) => {
      if (!sketching.has(p)) return;
      common.play(p, NPC.SAFALAAN, variant, from(madeStep));
    });
  }

  /** The papyrus used becomes the sketch in its own slot (t6493 slot 17, t6601 slot 15, t6789 slot 16). */
  function makeSketch(player, sketchId) {
    const pending = sketching.get(player);
    sketching.delete(player);
    if (common.held(player, sketchId)) return false;
    const inventory = player.getInventory();
    const slot = pending?.slot;
    const item = Number.isInteger(slot) ? inventory.getItems()[slot] : null;
    if (item && item.getId() === ITEM.PAPYRUS) {
      inventory.set(slot, new Item(sketchId, 1));
      inventory.refreshItems();
      return true;
    }
    return common.replaceInSlot(player, ITEM.PAPYRUS, sketchId);
  }

  function northReceived(event) {
    const { player } = event;
    event.handled = true;
    if (!makeSketch(player, ITEM.SKETCH_1)) return;
    if (state.advance(player, STAGE.NORTH_SKETCHED)) state.set(player, VARBIT.SAFALAAN_VISIBLE, 2);
  }

  function westReceived(event) {
    event.handled = true;
    if (makeSketch(event.player, ITEM.SKETCH_2)) state.advance(event.player, STAGE.WEST_SKETCHED);
  }

  function southReceived(event) {
    event.handled = true;
    makeSketch(event.player, ITEM.SKETCH_3);
  }

  // ---------------------------------------------------------------------------
  // The western scene (t6529-6608)
  // ---------------------------------------------------------------------------

  function westScene(player) {
    common.later(player, WEST_TICKS.FADE_OUT, (p) => {
      if (!sketching.has(p)) return;
      Scenes.hold(p);
      Scenes.fade(p, true);
    });
    common.later(player, WEST_TICKS.CUTSCENE, (p) => {
      if (!sketching.has(p)) return;
      Scenes.controls(p, true, true);
      Scenes.hideTabs(p);
      areaSounds(p, true);
      common.anim(p, ANIM.RESET);
    });
    common.later(player, WEST_TICKS.OPEN, (p) => {
      if (sketching.has(p)) openWestScene(p);
    });
  }

  function openWestScene(player) {
    const scene = Scenes.open(player, WEST_SCENE.name, WEST_SCENE.bounds, { musicTrack: MUSIC.WEST }, {
      instance: { sourceChunk: WEST_SCENE.sourceChunk }, at: SPOT.WEST.tile, exit: SPOT.WEST.tile,
    });
    Scenes.later(scene, WEST_TICKS.FACE - WEST_TICKS.OPEN, () => Scenes.face(player, SPOT.WEST.faces));
    Scenes.later(scene, WEST_TICKS.CAST - WEST_TICKS.OPEN, () => {
      const cast = {
        tray: Scenes.actor(scene, NPC.TRAY_JUVINATE, WEST_SCENE.tray.at, WEST_SCENE.tray.faces),
        ranis: Scenes.actor(scene, NPC.RANIS, WEST_SCENE.ranis.at, WEST_SCENE.ranis.faces),
        vanescula: Scenes.actor(scene, NPC.VANESCULA, WEST_SCENE.vanescula.at, WEST_SCENE.vanescula.faces),
        vanstrom: Scenes.actor(scene, NPC.VANSTROM_HUMAN, WEST_SCENE.vanstrom.at, WEST_SCENE.vanstrom.faces),
      };
      westCasts.set(player, cast);
      Scenes.camera(player, ...WEST_SCENE.camera, SCENE_CAMERA_RATES);
      Scenes.fade(player, false);
    });
    Scenes.later(scene, WEST_TICKS.LINE - WEST_TICKS.OPEN, () => {
      common.play(player, NPC.VANSTROM_HUMAN, V.WEST, between("So yes, Lady Vanescula", STEP.WEST_FLY));
    });
  }

  /** The actor who speaks a west-scene line. */
  function westSpeaker(cast, speaker) {
    if (speaker === "Vanstrom Klause") return cast.vanstrom;
    if (speaker === "Vanescula Drakan") return cast.vanescula;
    if (speaker === "Ranis Drakan") return cast.ranis;
    return null;
  }

  function westLine(event) {
    const { player, step } = event;
    const cast = westCasts.get(player);
    if (!cast) return;
    const actor = westSpeaker(cast, step.speaker);
    // The head is the speaker's form at the time (3741, 3734 for the last two lines; t6580, t6585).
    if (actor) {
      event.speakerId = formOf(actor);
      event.before = chainBefore(event.before, () => player.setPositionToFace(actor.getLocation()));
    }
    if (startsWith(event, LINE.BLOOD_TITHES)) event.before = chainBefore(event.before, () => meal(player, cast));
  }

  function chainBefore(previous, next) {
    return () => {
      previous?.();
      next();
    };
  }

  /** "Perhaps a light refreshment"'s continue: the three eat from the tray (t6557). */
  function meal(player, cast) {
    animate(cast.ranis, ANIM.TITHE_EATING, 25);
    animate(cast.vanescula, ANIM.TITHE_EATING, 15);
    animate(cast.vanstrom, ANIM.TITHE_EATING);
    for (const [id, delay] of MEAL_SOUNDS) common.sound(player, id, delay);
  }

  function turnVampyre(player, npc) {
    if (!npc?.isRegistered?.()) return;
    common.gfx(npc, GFX_TRANSFORM, 0, 100);
    animate(npc, ANIM.TRANSFORM_1, 12);
    common.sound(player, SOUND.TRANSFORM, 12);
  }

  function finishTurn(npc, id) {
    animate(npc, ANIM.TRANSFORM_2);
    transform(npc, id);
  }

  /** "Mmm, delicious!"'s continue: Vanescula then Ranis turn (t6573-6578), her next line at t6580. */
  function vanesculaAndRanisTurn(event) {
    const { player } = event;
    const cast = westCasts.get(player);
    const scene = Scenes.get(player);
    if (!cast || !scene) return;
    event.handled = true;
    event.wait = (resume) => {
      blankBox(player);
      turnVampyre(player, cast.vanescula);
      Scenes.later(scene, TURN_TICKS.RANIS, () => turnVampyre(player, cast.ranis));
      Scenes.later(scene, TURN_TICKS.VANESCULA_DONE, () => finishTurn(cast.vanescula, NPC.VANESCULA_GROUNDED));
      Scenes.later(scene, TURN_TICKS.RANIS_DONE, () => finishTurn(cast.ranis, NPC.RANIS_GROUNDED));
      Scenes.later(scene, TURN_TICKS.LINE, resume);
    };
  }

  /** "But we really have to get on."'s continue: Vanstrom turns (t6582-6585). */
  function vanstromTurns(event) {
    const { player } = event;
    const cast = westCasts.get(player);
    const scene = Scenes.get(player);
    if (!cast || !scene) return;
    event.handled = true;
    event.wait = (resume) => {
      blankBox(player);
      turnVampyre(player, cast.vanstrom);
      Scenes.later(scene, TURN_TICKS.VANSTROM_DONE, () => {
        finishTurn(cast.vanstrom, NPC.VANSTROM_GROUNDED);
        resume();
      });
    };
  }

  /** The last line's continue: the three take off and fly away; the sketch as it fades (t6588-6608). */
  function vampyresFly(event) {
    const { player } = event;
    const cast = westCasts.get(player);
    const scene = Scenes.get(player);
    if (!cast || !scene) return;
    event.handled = true;
    event.end = true;
    const takeOff = (npc, takeoffId) => {
      animate(npc, ANIM.RESET);
      transform(npc, takeoffId);
      common.sound(player, SOUND.FLIES_AWAY);
    };
    const t = TAKEOFF_TICKS;
    Scenes.later(scene, 1, () => Scenes.hold(player));
    Scenes.later(scene, t.VANESCULA, () => takeOff(cast.vanescula, NPC.VANESCULA_TAKEOFF));
    Scenes.later(scene, t.RANIS, () => {
      takeOff(cast.ranis, NPC.RANIS_TAKEOFF);
      transform(cast.vanescula, NPC.VANESCULA_FLYING);
    });
    Scenes.later(scene, t.VANSTROM, () => {
      transform(cast.ranis, NPC.RANIS_FLYING);
      takeOff(cast.vanstrom, NPC.VANSTROM_TAKEOFF);
    });
    Scenes.later(scene, t.VANSTROM_AIRBORNE, () => {
      transform(cast.vanstrom, NPC.VANSTROM_FLYING);
      common.sound(player, SOUND.FLIES_AWAY);
    });
    fly(scene, cast.vanescula, FLIGHT.vanescula, t.VANESCULA_FLIES);
    fly(scene, cast.ranis, FLIGHT.ranis, t.RANIS_FLIES);
    fly(scene, cast.vanstrom, FLIGHT.vanstrom, t.VANSTROM_FLIES);
    Scenes.later(scene, t.MADE, () => {
      common.play(player, NPC.SAFALAAN, V.WEST, from(STEP.WEST_MADE));
      Scenes.hold(player);
      Scenes.fade(player, true);
    });
    Scenes.later(scene, t.END, () => {
      closeChat(player);
      Scenes.end(player, false);
      player.setPositionToFace(tile([SPOT.WEST.faces[0], SPOT.WEST.faces[1], 0]));
      common.later(player, t.FADE_IN - t.END, (p) => Scenes.fade(p, false));
    });
  }

  /** A flyer moves one tile a tick by teleport (t6593-6602). */
  function fly(scene, npc, path, startTick) {
    path.forEach((step, index) => Scenes.later(scene, startTick + index, () => {
      if (npc?.isRegistered?.()) npc.moveTo(Scenes.tileFor(scene, step));
    }));
  }

  // ---------------------------------------------------------------------------
  // The southern ambush (t6652-6741)
  // ---------------------------------------------------------------------------

  function southAmbush(player) {
    const t = SOUTH_TICKS;
    common.later(player, t.FADE_OUT, (p) => {
      if (!sketching.has(p)) return;
      Scenes.hold(p);
      Scenes.fade(p, true);
    });
    common.later(player, t.CUTSCENE, (p) => {
      if (!sketching.has(p)) return;
      Scenes.controls(p, true, true);
      Scenes.hideTabs(p);
      areaSounds(p, true);
      common.anim(p, ANIM.RESET);
    });
    common.later(player, t.OPEN, (p) => {
      if (!sketching.has(p)) return;
      sketching.delete(p); // the papyrus stays: sketch 3 is made after Sarius (t6789)
      openAmbush(p);
    });
  }

  function openAmbush(player) {
    const t = SOUTH_TICKS;
    const scene = Scenes.open(player, SOUTH_SCENE.name, SOUTH_SCENE.bounds, {
      musicTrack: MUSIC.SOUTH, canTeleport: () => false, canAttack: vanstromCanAttack,
    }, { instance: { sourceChunk: SOUTH_SCENE.sourceChunk }, at: SPOT.SOUTH.tile, exit: SPOT.SOUTH.tile });
    const ambush = { scene, vanstrom: null, sarius: null, attacks: 0 };
    ambushes.set(player, ambush);
    Scenes.later(scene, t.ANGLE - t.OPEN, () => forceAngle(player));
    Scenes.later(scene, t.VANSTROM - t.OPEN, () => {
      ambush.vanstrom = Scenes.actor(scene, NPC.VANSTROM_CUTSCENE, SOUTH_SCENE.vanstromSpawn, SPOT.SOUTH.tile);
      Scenes.camera(player, ...SOUTH_SCENE.camera, SCENE_CAMERA_RATES);
    });
    Scenes.later(scene, t.FADE_IN - t.OPEN, () => {
      Scenes.fade(player, false);
      Scenes.walk(ambush.vanstrom, SOUTH_SCENE.vanstromStand);
    });
    Scenes.later(scene, t.FADE_IN - t.OPEN + 2, () => {
      if (ambush.vanstrom) player.setPositionToFace(ambush.vanstrom.getLocation());
    });
    Scenes.later(scene, t.LINE - t.OPEN, () => common.play(player, NPC.VANSTROM_ATTACK, V.SOUTH, from(LINE.PREPARE_TO_DIE)));
  }

  /** Vanstrom's own combat never runs: his five attacks are the scene's (the Wiki: melee, then the knockout). */
  function vanstromCanAttack(attacker) {
    return attacker?.isNpc?.() && VANSTROM_IDS.has(formOf(attacker)) ? false : null;
  }

  /** The Wiki: "You cannot damage him in any way". */
  function vanstromHit({ npc, hit }) {
    if (!VANSTROM_IDS.has(formOf(npc))) return;
    const owner = npc.getOwner?.();
    if (owner && ambushes.get(owner)?.vanstrom === npc) hit.setTotalDamage(0);
  }

  /** "Prepare to die!"'s continue: 230, control back in the copy, Vanstrom's attack form and five attacks (t6677-6711). */
  function vanstromFights(event) {
    const { player } = event;
    const ambush = ambushes.get(player);
    if (!ambush || Scenes.get(player)?.name !== SOUTH_SCENE.name) return;
    event.handled = true;
    event.wait = (resume) => {
      state.advance(player, STAGE.VANSTROM_ATTACKS);
      const { scene } = ambush;
      Scenes.controls(player, false);
      areaSounds(player, false);
      forceAngle(player);
      Scenes.restoreTabs(player);
      Scenes.closeFade(player);
      common.cameraReset(player);
      transform(ambush.vanstrom, NPC.VANSTROM_ATTACK);
      Scenes.walk(ambush.vanstrom, SOUTH_SCENE.vanstromAttack);
      VANSTROM_ATTACKS.forEach((attack, index) => {
        Scenes.later(scene, FIGHT_TICKS.FIRST + index * FIGHT_TICKS.EVERY, () => vanstromAttacks(player, ambush, attack));
      });
      Scenes.later(scene, FIGHT_TICKS.FADE_OUT, () => {
        blankBox(player);
        Scenes.fade(player, true);
      });
      Scenes.later(scene, FIGHT_TICKS.CUTSCENE, () => {
        Scenes.controls(player, true, true);
        Scenes.hideTabs(player);
        areaSounds(player, true);
        common.anim(player, ANIM.RESET);
      });
      // The knockout plays in a fresh copy (t6716); opening it ends this one.
      Scenes.later(scene, FIGHT_TICKS.OPEN, () => openKnockout(player, ambush, resume));
    };
  }

  /**
   * One attack: the Wiki's rules (Protect from Melee stops all damage; it can kill), live's anims and
   * sounds. The capture's rolls were 0, 10, 8, 15, 0 (two blocks) against a shield.
   */
  function vanstromAttacks(player, ambush, attack) {
    const vanstrom = ambush.vanstrom;
    if (!vanstrom?.isRegistered?.() || player.getHitpoints?.() <= 0) return;
    ambush.attacks++;
    vanstrom.setPositionToFace(player.getLocation());
    animate(vanstrom, attack.anim);
    common.sound(player, attack.sound);
    const prayed = PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MELEE);
    const accurate = !prayed && AccuracyFormulasDpsCalc.rollAccuracy(vanstrom, player, CombatType.MELEE);
    const damage = accurate ? Math.floor(Math.random() * (VANSTROM_MAX_HIT + 1)) : 0;
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
    if (attack.knockout) {
      animate(player, ANIM.KNOCKED_OUT, 40);
      common.sound(player, SOUND.STUNNED, 40);
      common.sound(player, damage > 0 ? SOUND.HUMAN_HIT : SOUND.SPECIAL_BLOCK, 20);
      return;
    }
    const block = player.getBlockAnim?.() ?? -1;
    if (block >= 0) animate(player, block);
    common.sound(player, damage > 0 ? SOUND.HUMAN_HIT : SOUND.BLOCK, 20);
  }

  /** The knockout copy: the player lying, Vanstrom and Sarius walking in; her line (t6716-6722). */
  function openKnockout(player, ambush, resume) {
    if (player.getHitpoints?.() <= 0) return;
    handingOver.add(player);
    const scene = Scenes.open(player, SOUTH_SCENE.knockout, SOUTH_SCENE.bounds, { musicTrack: MUSIC.SOUTH }, {
      instance: { sourceChunk: SOUTH_SCENE.sourceChunk }, at: SPOT.SOUTH.tile, exit: SPOT.SOUTH.tile,
    });
    handingOver.delete(player);
    // Ending the fight's copy gave control back; the knockout is a cutscene again (t6715).
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    ambush.scene = scene;
    ambush.vanstrom = null;
    ambushes.set(player, ambush);
    const t = FIGHT_TICKS;
    Scenes.later(scene, t.LIE - t.OPEN, () => {
      common.anim(player, ANIM.KNOCKED_OUT);
      Scenes.face(player, SOUTH_SCENE.playerLies);
    });
    Scenes.later(scene, t.CAST - t.OPEN, () => {
      ambush.vanstrom = Scenes.actor(scene, NPC.VANSTROM_CUTSCENE, SOUTH_SCENE.knockoutVanstrom, SPOT.SOUTH.tile);
      ambush.sarius = Scenes.actor(scene, NPC.SARIUS_CUTSCENE, SOUTH_SCENE.sariusSpawn, SOUTH_SCENE.knockoutVanstrom);
      Scenes.camera(player, ...SOUTH_SCENE.knockoutCamera, SCENE_CAMERA_RATES);
    });
    Scenes.later(scene, t.FADE_IN - t.OPEN, () => {
      Scenes.fade(player, false);
      Scenes.walk(ambush.sarius, SOUTH_SCENE.sariusStand);
    });
    Scenes.later(scene, t.LINE - t.OPEN, resume);
  }

  /** Vanstrom's last line's continue: 240 and 2593 = 1, back on the map with Sarius 6161 (t6739-6745). */
  function vanstromDeparts(event) {
    const { player } = event;
    const ambush = ambushes.get(player);
    if (!ambush || Scenes.get(player)?.name !== SOUTH_SCENE.knockout) return;
    event.handled = true;
    event.wait = (resume) => {
      ambush.waking = true;
      if (state.advance(player, STAGE.SARIUS_SAVED)) state.set(player, VARBIT.SARIUS_VISIBLE, 1);
      blankBox(player);
      Scenes.fade(player, true);
      Scenes.later(player, WAKE_TICKS.BACK, () => {
        Scenes.end(player, false);
        player.moveTo(tile(SPOT.SOUTH.tile));
        common.anim(player, ANIM.RESET);
        spawnSarius(player);
      });
      Scenes.later(player, WAKE_TICKS.FADE_IN, () => {
        common.anim(player, ANIM.REGAINING);
        Scenes.fade(player, false);
      });
      Scenes.later(player, WAKE_TICKS.LINE, () => {
        ambush.waking = false;
        resume();
      });
    };
  }

  function spawnSarius(player) {
    removeSarius(player);
    const [x, y, z] = SOUTH_SCENE.sarius;
    const npc = api.spawnNpc({ id: NPC.SARIUS_CASTLE, x, y, z, owner: player, ownerOnly: true, wanderRadius: 1 });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.setPositionToFace(tile([x - 1, y, z]));
    sariuses.set(player, npc);
    return npc;
  }

  function removeSarius(player) {
    const npc = sariuses.get(player);
    sariuses.delete(player);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  /** At 240 (the talk cut short): Sarius on the wall again, and her wake-up talk. */
  function sariusWakes(player) {
    ambushes.delete(player);
    const npc = spawnSarius(player);
    common.play(player, NPC.SARIUS_CASTLE, V.SOUTH, from(LINE.AWAKEN), PAGE, npc);
  }

  function talkSarius(event) {
    const { player, npc, npcId } = event;
    if (!within(player, STAGE.SARIUS_SAVED, STAGE.SARIUS_TALKED - 1) || sariuses.get(player) !== npc) return false;
    return common.play(player, npcId, V.SOUTH, from(LINE.AWAKEN), PAGE, npc);
  }

  /** Sarius' last line's continue: the chat closes, the fade, and she is gone with 2593 = 0 (t6780-6784). */
  function sariusDeparts(event) {
    const { player } = event;
    if (stage(player) < STAGE.SARIUS_TALKED) return;
    event.handled = true;
    event.end = true;
    ambushes.delete(player);
    Scenes.fade(player, true);
    common.later(player, LEAVE_TICKS.GONE, (p) => {
      state.set(p, VARBIT.SARIUS_VISIBLE, 0);
      removeSarius(p);
    });
    common.later(player, LEAVE_TICKS.FADE_IN, (p) => Scenes.fade(p, false));
  }

  function southLine(event) {
    const { player } = event;
    const speaker = event.step?.speaker;
    if (startsWith(event, LINE.PREPARE_TO_DIE)) {
      event.speakerId = NPC.VANSTROM_ATTACK; // live's head (t6668)
      event.before = () => common.sound(player, SOUND.VANSTROM_LAUGHS);
      return;
    }
    if (startsWith(event, LINE.NO_ORDERS)) {
      event.speakerId = NPC.VANSTROM_ATTACK; // t6732
      const ambush = ambushes.get(player);
      event.before = () => {
        if (ambush?.vanstrom && ambush?.sarius) ambush.vanstrom.setPositionToFace(ambush.sarius.getLocation());
      };
      return;
    }
    if (speaker !== "Sarius Guile") return;
    // The knockout line has the scene Sarius' head 3776 (t6722); the wake-up talk the world multinpc 6161 (t6745).
    event.speakerId = sariuses.has(player) ? NPC.SARIUS_CASTLE : NPC.SARIUS;
    if (startsWith(event, LINE.BE_AWAY)) event.before = () => state.advance(player, STAGE.SARIUS_TALKED);
  }

  // ---------------------------------------------------------------------------
  // Scene ends, logout
  // ---------------------------------------------------------------------------

  function sceneEnded(player, scene, logout) {
    if (scene.name === WEST_SCENE.name) {
      westCasts.delete(player);
      sketching.delete(player);
      areaSounds(player, false);
      if (!logout) Scenes.restoreTabs(player);
      return;
    }
    if (scene.name !== SOUTH_SCENE.name && scene.name !== SOUTH_SCENE.knockout) return;
    if (handingOver.has(player)) return;
    areaSounds(player, false);
    if (!logout) Scenes.restoreTabs(player);
    // Ours: an ambush cut short (a death, a logout, a walk out of it) leaves the stage; the next sketch plays it again.
    if (stage(player) < STAGE.SARIUS_SAVED) {
      ambushes.delete(player);
      if (!logout) closeChat(player);
    }
  }

  function handleLogout({ player }) {
    if (!player) return;
    Scenes.cancel(player);
    sketching.delete(player);
    westCasts.delete(player);
    ambushes.delete(player);
    climbing.delete(player);
    rocksSearched.delete(player);
    removeSarius(player);
  }

  // ---------------------------------------------------------------------------
  // Item actions
  // ---------------------------------------------------------------------------

  function lookAtSketch(event) {
    const group = SKETCH_INTERFACE.get(event.itemId);
    if (!group) return false;
    event.player.getPacketSender().sendInterface(group);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Dialogue events
  // ---------------------------------------------------------------------------

  function handleLine(event) {
    const { player, step } = event;
    if (!player || !step) return;
    const variant = variantOf(event);
    if (!variant) return;
    const words = String(step.text ?? step.player ?? event.text ?? "");
    const expression = EXPRESSIONS.find(([prefix]) => words.startsWith(prefix));
    if (expression) event.expression = expression[1];
    // Live's head is the world NPC's own id (Safalaan 6159, Vertida 3773, Veliaf 8277; t6208, t5976, t4619).
    if (step.speaker && event.npc && step.speaker === event.definition?.getName?.()) event.speakerId = event.npc.getId();
    switch (variant) {
      case V.VERTIDA_BRIEFING:
      case V.VERTIDA_AGAIN:
        if (startsWith(event, LINE.DISTINCTIVE)) event.before = () => safalaanDescribed(player);
        return;
      case V.SAFALAAN:
        if (startsWith(event, LINE.AH_VELIAF)) event.before = () => state.advance(player, STAGE.SAFALAAN_MET);
        else if (startsWith(event, LINE.GOOD_LUCK)) event.before = () => suppliesGiven(player);
        return;
      case V.WEST:
        westLine(event);
        return;
      case V.SOUTH:
        southLine(event);
        return;
      default:
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    const variant = variantOf(event);
    if (!variant) return;
    if (NO_OPS.has(stepId)) {
      event.handled = true;
      return;
    }
    switch (stepId) {
      case STEP.LEAD_MESSAGE: return leadMessage(event);
      case STEP.LEAD:
        // The landing came with the message's hold.
        event.handled = true;
        event.end = true;
        return;
      case STEP.MAKE_OWN_WAY: return makeOwnWay(event);
      case STEP.ROCKS_MOVE: return rocksMoved(event);
      case STEP.BARRICADE_STUCK:
        event.box = { statement: true };
        return;
      case STEP.SUPPLIES_BOX:
        // objectbox_double 11, charcoal and papyrus at zoom 400; the items come with the last line (t6405).
        if (variant === V.SAFALAAN) event.box = { items: [ITEM.CHARCOAL, ITEM.PAPYRUS] };
        return;
      case STEP.RAL_GIVES: return ralGivesPapyrus(event);
      case STEP.NORTH_RECEIVE: return northReceived(event);
      case STEP.WEST_RECEIVE: return westReceived(event);
      case STEP.SAVED_RECEIVE: return southReceived(event);
      case STEP.WEST_TURN: return vanesculaAndRanisTurn(event);
      case STEP.WEST_VANSTROM_TURNS: return vanstromTurns(event);
      case STEP.WEST_FLY: return vampyresFly(event);
      case STEP.SOUTH_FIGHT: return vanstromFights(event);
      case STEP.SOUTH_VANSTROM_DEPARTS: return vanstromDeparts(event);
      case STEP.SOUTH_SARIUS_DEPARTS: return sariusDeparts(event);
      default:
    }
  }

  function answerCondition({ player, stepId }) {
    if (!player) return null;
    if (stepId === STEP.RAL_SHORT) return papyrusAndSketches(player) < 3;
    if (stepId === STEP.RAL_ENOUGH) return papyrusAndSketches(player) >= 3;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Vertida Sefalatis", { "Talk-to": talkVertida });
  api.onNpcInteraction("Safalaan Hallow", { "Talk-to": talkSafalaan });
  api.onNpcInteraction("Sarius Guile", { "Talk-to": talkSarius });
  api.onItemOnNpc(useSketchOnSafalaan);
  api.onItemOnItem("Charcoal", "Papyrus", useCharcoalOnPapyrus);
  api.onItemAction("Castle sketch 1", { "Look-at": lookAtSketch });
  api.onItemAction("Castle sketch 2", { "Look-at": lookAtSketch });
  api.onItemAction("Castle sketch 3", { "Look-at": lookAtSketch });
  api.onObjectInteraction("Rocky surface", { Search: searchRocks });
  api.onObjectInteraction("Barricade", { Open: openBarricade });
  api.onCustomEvent("ladders:climb", climbWallLadder);
  api.onObjectInteraction("Wall", { "Climb-up": climbWall, "Climb-down": climbWall });
  api.onNpcHitModify(vanstromHit);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogout(handleLogout);
};
