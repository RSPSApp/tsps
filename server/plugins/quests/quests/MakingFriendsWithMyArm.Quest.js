/**
 * Making Friends with My Arm (members).
 *
 * Transcript page: "Making Friends with My Arm" (35 named variants). Every word
 * played comes from that page; the optional post-quest hand-in to Burntmeat
 * replays "standard-dialogue-after-making-friends-with-my-arm-and-delivering-
 * fire-notes" from the "Burntmeat" page.
 *
 * Stages (varbit 6528 "my2arm_status", varp 1785 "my2arm_perm_1"; RuneLite's
 * quest dbrow - table 0 row 91 - stores started 2 / complete 200, and
 * QuestHelper's MakingFriendsWithMyArm step map pins the in-progress values):
 *    0    not started
 *    5    agreed to help Burntmeat (Wolfbone describes the sea route)
 *   10    My Arm asked to meet at Larry's boat
 *   20    My Arm arrived, frightening Larry
 *   25    Larry agreed to lend the boat
 *   30/35 sailed to Weiss / reached the coast
 *   40/41 searched the wreck (rope, pickaxe) / rope tied to the tree
 *   45    spoken to Boulder
 *   50    squeezed through the broken fence
 *   60    descended the hole into the cave
 *   65/70 crossed the water / stepping stone path made
 *   76    cave exit mined (the entrance loc transform turns clear at 76+)
 *   80    met Mother and heard the tribe out
 *   85    learned the Wise Old Man plan from My Arm outside
 *  110    asked the Wise Old Man for the favour
 *  120    he asked for a mahogany coffin and a reduced cadava potion
 *  122    coffin built
 *  127    potion received from the Apothecary
 *  132    coffin and potion ready together
 *  135    the Wise Old Man drank the potion and is in the coffin
 *  140    gave the coffin to My Arm (the "corpse" shown to Mother)
 *  145    thrown into the Weiss prison
 *  150    Odd Mushroom dies; Snowflake wants revenge
 *  155/160 Don't Know What attacks / is killed
 *  165/170 bucket filled / Fire of Domination doused
 *  175    Mother killed and Snowflake becomes leader (the wedding)
 *  178/180 the Wise Old Man leaves / Snowflake asks for goat dung
 *  185    goat dung picked up
 *  190    dung handed over; Weiss fire notes received
 *  195    Weiss fire notes read
 *  200    quest complete
 *
 * Source: OSRS Wiki quest page + transcript, QuestHelper's makingfriendswithmyarm
 * helper for the stage values, and the cache dump (scripts/lookup-gameval.ts) for
 * the loc/NPC ids.
 *
 * Gaps / approximations:
 *  - The instanced sneak through Weiss, the rockslide agility rolls, the swimming
 *    evade minigame and the boss AI are not simulated: object interactions move
 *    the player and advance the stage, and the "fails/succeeds to hide" prose
 *    conditions always answer that the player hid successfully.
 *  - Using the rope auto-climbs to the ledge; the cache's ropetrail multi only
 *    exposes its Climb option once varbit 6528 reaches a later value.
 *  - Coffin construction is triggered by using a plank/cloth on the coffin multi
 *    (33332); the client shows the wiki hotspot transform from varbit 6536.
 *  - Wolfbone speaks with Burntmeat's chathead (the transcript variant is flat and
 *    Wolfbone has no static spawn in this build).
 *  - Wolfbone's burnt-meat reward for the post-quest note hand-in is not given
 *    (the transcript does not show it) and the reward scroll uses the runtime's
 *    standard wording rather than the quest's "You have Made Friends with My Arm!".
 *  - The fight with Mother starts by dousing the Fire of Domination; the prison
 *    escort upstairs is a move rather than a walk.
 */
module.exports = function registerMakingFriendsWithMyArmQuest(api) {
  const {
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { refreshQuestList, registerQuest, startTranscript } = require("../QuestRuntime");

  // ==========================================================================
  // Ids
  // ==========================================================================

  const PAGE = "Making Friends with My Arm";

  // varp 1785 "my2arm_perm_1", varbit 6528 "my2arm_status" (bits 0-7).
  const VARP_MY2ARM = 1785;
  const VARBIT_MY2ARM_STATUS = 6528;
  // varp 1319 bits 18-19 "my2arm_client_coffin": 1 hotspot, 2 built, 3 occupied.
  const VARBIT_MY2ARM_CLIENT_COFFIN = 6536;

  const MY_ARM_NPC_IDS = new Set([
    742, // myarm_fixed, the transform target of every quest My Arm spawn
    NpcIdentifiers.MY_ARM, // 8411 myarm_prison (also My Arm's Big Adventure's spawn id)
    8412, // myarm_multi_teacher (roof)
    8413, // myarm_multi_larry
    8414, // myarm_multi_cliffbottom
    8415, // myarm_multi_throneroom
    8416, // myarm_multi_outside
    8417, // myarm_multi_postquest
  ]);
  const MY_ARM_PRISON_NPC_ID = NpcIdentifiers.MY_ARM; // 8411
  const MY_ARM_VOICE_NPC_ID = NpcIdentifiers.MY_ARM; // 8411, chathead for played variants
  const BURNTMEAT_NPC_ID = NpcIdentifiers.BURNTMEAT; // 4157
  const LARRY_RELLEKKA_NPC_ID = NpcIdentifiers.LARRY_2; // 828, Rellekka boat
  const LARRY_NPC_IDS = new Set([
    NpcIdentifiers.LARRY, // 827
    LARRY_RELLEKKA_NPC_ID,
    NpcIdentifiers.LARRY_3, // 829
  ]);
  const BOULDER_NPC_ID = NpcIdentifiers.BOULDER_6; // 8442
  const MOTHER_NPC_IDS = new Set([
    NpcIdentifiers.MOTHER, // 8425
    NpcIdentifiers.MOTHER_2, // 8426 (enthroned)
    8427, // my2arm_mother_multi_standing
  ]);
  const MOTHER_BATTLE_MELEE_NPC_ID = NpcIdentifiers.MOTHER_3; // 8428
  const SNOWFLAKE_NPC_ID = NpcIdentifiers.SNOWFLAKE; // 8431
  const SNOWFLAKE_NPC_IDS = new Set([
    SNOWFLAKE_NPC_ID,
    8432, // my2arm_snowflake_outside
    8433, // my2arm_snowflake_postquest
  ]);
  const ODD_MUSHROOM_NPC_ID = NpcIdentifiers.ODD_MUSHROOM; // 8434
  const ODD_MUSHROOM_DYING_NPC_ID = NpcIdentifiers.ODD_MUSHROOM_2; // 8435
  const ODD_MUSHROOM_NPC_IDS = new Set([
    ODD_MUSHROOM_NPC_ID,
    ODD_MUSHROOM_DYING_NPC_ID,
    8436, // my2arm_mushroom_throneroom
    8437, // my2arm_mushroom_outside
  ]);
  const DKW_BATTLE_NPC_ID = NpcIdentifiers.DONT_KNOW_WHAT_2; // 8439
  const WISE_OLD_MAN_SPAWN_NPC_ID = NpcIdentifiers.WISE_OLD_MAN; // 2108
  const WISE_OLD_MAN_NPC_IDS = new Set([
    NpcIdentifiers.WISE_OLD_MAN, // 2108
    2109, // Draynor Village spawn (cache name "null"; Transforms to 2108)
    NpcIdentifiers.WISE_OLD_MAN_2, // 2110
    NpcIdentifiers.WISE_OLD_MAN_3, // 2111
    NpcIdentifiers.WISE_OLD_MAN_4, // 2112
    NpcIdentifiers.WISE_OLD_MAN_5, // 2113
    NpcIdentifiers.WISE_OLD_MAN_7, // 4306
    NpcIdentifiers.WISE_OLD_MAN_8, // 4307
    NpcIdentifiers.WISE_OLD_MAN_9, // 8052
    NpcIdentifiers.WISE_OLD_MAN_10, // 8154
    NpcIdentifiers.WISE_OLD_MAN_11, // 8162
    NpcIdentifiers.WISE_OLD_MAN_12, // 8170
    NpcIdentifiers.WISE_OLD_MAN_13, // 8407
    NpcIdentifiers.WISE_OLD_MAN_14, // 8409
  ]);
  const APOTHECARY_NPC_ID = NpcIdentifiers.APOTHECARY; // 5036
  const SQUIRREL_NPC_ID = NpcIdentifiers.SQUIRREL_9; // 8464

  const CAVE_ENTRANCE_BLOCKED_OBJECT_ID = ObjectIdentifiers.CAVE_ENTRANCE_63; // 33193
  const CAVE_ENTRANCE_CLEAR_OBJECT_ID = ObjectIdentifiers.CAVE_ENTRANCE_64; // 33194
  const CAVE_ENTRANCE_MULTI_OBJECT_ID = 33329; // my2arm_cliffbottom_caveentrance (placed)
  const WRECKED_BOAT_OBJECT_ID = ObjectIdentifiers.WRECKED_BOAT; // 33195
  const ROCKSLIDE_OBJECT_IDS = new Set([
    ObjectIdentifiers.ROCKSLIDE_50, // 33184
    ObjectIdentifiers.ROCKSLIDE_51, // 33185
    ObjectIdentifiers.ROCKSLIDE_52, // 33191
  ]);
  const ROPETRAIL_MULTI_OBJECT_ID = 33328; // my2arm_cliff_shortcut_3_ropetrail_multi
  const ROPE_TREE_MULTI_OBJECT_ID = 33327; // my2arm_cliff_shortcut_3 (Tree before stage 45)
  const ROPE_TREE_OBJECT_ID = ObjectIdentifiers.TREE_127; // 33186
  const ROPED_TREE_OBJECT_ID = ObjectIdentifiers.ROPED_TREE; // 33187
  const LEDGE_OBJECT_ID = ObjectIdentifiers.LEDGE_17; // 33190
  const FALLEN_TREE_OBJECT_ID = ObjectIdentifiers.FALLEN_TREE_5; // 33192
  const FENCE_OBJECT_ID = ObjectIdentifiers.FENCE_5; // 33219
  const BROKEN_FENCE_OBJECT_ID = ObjectIdentifiers.BROKEN_FENCE_4; // 46817
  const HOLE_OBJECT_ID = ObjectIdentifiers.HOLE_56; // 33227
  const NARROW_GAP_OBJECT_ID = ObjectIdentifiers.NARROW_GAP; // 33237
  const WATERS_EDGE_OBJECT_IDS = new Set([
    ObjectIdentifiers.WATERS_EDGE, // 33238
    ObjectIdentifiers.WATERS_EDGE_2, // 33239
  ]);
  const WATERLINE_HINT_OBJECT_ID = 33331; // my2arm_cave_waterline_forhint
  const CAVE_EXIT_BLOCKED_OBJECT_ID = ObjectIdentifiers.CAVE_EXIT_26; // 33247
  const STEPS_OBJECT_ID = ObjectIdentifiers.STEPS_7; // 33261, prison -> throne room
  const SMELLY_HOLE_OBJECT_ID = ObjectIdentifiers.SMELLY_HOLE; // 33262, prison escape
  const PILE_OF_BUCKETS_OBJECT_ID = ObjectIdentifiers.PILE_OF_BUCKETS; // 33309
  const BARREL_OF_WATER_OBJECT_ID = ObjectIdentifiers.BARREL_OF_WATER; // 33308
  const COFFIN_MULTI_OBJECT_ID = 33332; // my2arm_coffin_multi
  const COFFIN_HOTSPOT_OBJECT_ID = ObjectIdentifiers.COFFIN_HOTSPOT; // 33263
  const OCCUPIED_COFFIN_OBJECT_ID = ObjectIdentifiers.COL_FF9040_OLD_MANS_COFFIN_COL; // 33265
  const GOAT_POO_OBJECT_ID = ObjectIdentifiers.GOAT_POO; // 33214 (my2arm_goatdung)
  const FIRE_OF_DOMINATION_OBJECT_ID = 33333; // my2arm_fire_throne_room (placed)

  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET; // 1925
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER; // 1929
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const SAW_ITEM_ID = ItemIdentifiers.SAW; // 8794
  const MAHOGANY_PLANK_ITEM_ID = ItemIdentifiers.MAHOGANY_PLANK; // 8782
  const BOLT_OF_CLOTH_ITEM_ID = ItemIdentifiers.BOLT_OF_CLOTH; // 8790
  const CADAVA_BERRIES_ITEM_ID = ItemIdentifiers.CADAVA_BERRIES; // 753
  const OLD_MANS_COFFIN_ITEM_ID = ItemIdentifiers.OLD_MANS_COFFIN; // 22588
  const REDUCED_CADAVA_POTION_ITEM_ID = ItemIdentifiers.REDUCED_CADAVA_POTION; // 22589
  const GOAT_DUNG_ITEM_ID = ItemIdentifiers.GOAT_DUNG; // 22590
  const WEISS_FIRE_NOTES_ITEM_ID = ItemIdentifiers.WEISS_FIRE_NOTES; // 22591
  const PICKAXE_ITEM_IDS = new Set([
    ItemIdentifiers.BRONZE_PICKAXE,
    ItemIdentifiers.IRON_PICKAXE,
    ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.MITHRIL_PICKAXE,
    ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
  ]);
  const COFFIN_PLANK_COUNT = 5;
  const COFFIN_CONSTRUCTION_XP = 715;
  const FIREMAKING_REQUIREMENT = 66;

  // Landmarks (QuestHelper zone corners; the loc placements confirm them).
  const WEISS_ARRIVAL_LOCATION = new Location(2851, 3965, 0);
  const CLIFF2_LOCATION = new Location(2855, 3964, 0);
  const CLIFF3_LOCATION = new Location(2856, 3962, 0);
  const CLIFF4_LOCATION = new Location(2858, 3961, 0);
  const CLIFF5_LOCATION = new Location(2858, 3958, 0);
  const ABOVE_WEISS_LOCATION = new Location(2858, 3952, 0);
  const SNEAK_LOCATION = new Location(2887, 3935, 0);
  const CAVE_LOCATION = new Location(2705, 5795, 0);
  const WATER_WEST_LOCATION = new Location(2714, 5781, 0);
  const WATER_EAST_LOCATION = new Location(2733, 5781, 0);
  const WEISS_TOWN_LOCATION = new Location(2870, 3936, 0);
  const THRONE_ROOM_LOCATION = new Location(2868, 3933, 0);
  const PRISON_LOCATION = new Location(2852, 10333, 0);
  const PRISON_ODD_MUSHROOM_LOCATION = new Location(2852, 10332, 0);
  const PRISON_SNOWFLAKE_LOCATION = new Location(2851, 10335, 0);
  const PRISON_MY_ARM_LOCATION = new Location(2849, 10333, 0);
  const PRISON_WOM_LOCATION = new Location(2855, 10333, 0);
  const DKW_LOCATION = new Location(2852, 10330, 0);
  const MOTHER_BATTLE_LOCATION = new Location(2873, 3932, 0);

  const PRISON_ZONE = { minX: 2830, maxX: 2858, minY: 10320, maxY: 10355, levels: [0] };

  // Transcript prose condition step ids.
  const CONDITION_HID_FAILED = "dkWznb";
  const CONDITION_HID_OK = "yx4eNy";
  const CONDITION_MOTHER_OFFER_IDS = new Set(["jwPI3l", "TI4JoW", "lWZF__", "s-4tE-"]);
  const CONDITION_NO_CADAVA = "6saERH";
  const CONDITION_HAS_CADAVA = "k5V3WL";
  const CONDITION_NO_DUNG = "PPCT01";
  const CONDITION_HAS_DUNG = "weuXow";

  // Transcript action/message step ids.
  const ACTION_WOLFBONE_ROUTE = "NRWlS-";
  const ACTION_MY_ARM_ARRIVES = new Set(["ab1e9r", "kK1f5V"]);
  const ACTION_REACH_COAST = "fuVT-O";
  const ACTION_SNOWFLAKE_LEAVES = "ghM57Z";
  const ACTION_HAND_BERRIES = "maJPZY";
  const ACTION_APOTHECARY_BREWS = new Set(["C_sOnO", "z20Cm6"]);
  const ACTION_APOTHECARY_BREW_DUPLICATE = "z20Cm6";
  const ACTION_HAND_POTION = "0l5dDl";
  const ACTION_WOM_DRINKS = "s0mVHr";
  const ACTION_MOTHER_IMPRISONS = "4VR7SQ";
  const ACTION_PRISON_BREAK = "iOToZL";
  const ACTION_ANCIENT_DANCE = "zT2GfK";
  const ACTION_RECEIVE_NOTES = "pKPCCq";
  const ACTION_QUEST_COMPLETE = "d0d9eU";

  // Stages.
  const STAGE_STARTED = 5;
  const STAGE_MY_ARM = 10;
  const STAGE_LARRY = 20;
  const STAGE_LARRY_AGAIN = 25;
  const STAGE_SAILED = 30;
  const STAGE_ARRIVED = 35;
  const STAGE_WRECK = 40;
  const STAGE_ROPED = 41;
  const STAGE_BOULDER = 45;
  const STAGE_SNEAK = 50;
  const STAGE_CAVE = 60;
  const STAGE_WATER = 65;
  const STAGE_STONES = 70;
  const STAGE_MINED = 76;
  const STAGE_MOTHER = 80;
  const STAGE_PLAN = 85;
  const STAGE_WOM_ASKED = 110;
  const STAGE_WOM_TASKS = 120;
  const STAGE_COFFIN_BUILT = 122;
  const STAGE_POTION = 127;
  const STAGE_WOM_READY = 132;
  const STAGE_COFFIN = 135;
  const STAGE_IMPRESS = 140;
  const STAGE_PRISON = 145;
  const STAGE_ODD_DIED = 150;
  const STAGE_DKW = 155;
  const STAGE_DKW_DEAD = 160;
  const STAGE_FIRE = 165;
  const STAGE_FIRE_OUT = 170;
  const STAGE_MOTHER_DEAD = 175;
  const STAGE_WOM_AFTER = 178;
  const STAGE_SNOWFLAKE_AFTER = 180;
  const STAGE_DUNG = 185;
  const STAGE_NOTES = 190;
  const STAGE_NOTES_READ = 195;
  const STAGE_COMPLETE = 200;

  // Persisted sub-state.
  const COFFIN_BUILT_ATTRIBUTE = "making-friends-with-my-arm:coffin-built";
  const POTION_OBTAINED_ATTRIBUTE = "making-friends-with-my-arm:potion-obtained";
  const ROPE_TIED_ATTRIBUTE = "making-friends-with-my-arm:rope-tied";
  const PLAN_SEEN_ATTRIBUTE = "making-friends-with-my-arm:plan-seen";
  const CLIMB_WARNED_ATTRIBUTE = "making-friends-with-my-arm:climb-warned";
  const WATER_CROSSINGS_ATTRIBUTE = "making-friends-with-my-arm:water-crossings";

  // The four "what can My Arm offer Mother" answers chosen in one sitting.
  const motherOffers = new WeakMap();
  const trackedNpcs = new Map();

  let quest;

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => {
    if (!held(player, itemId, amount)) player.getInventory().adds(itemId, amount);
  };

  function hasPickaxe(player) {
    for (const itemId of PICKAXE_ITEM_IDS) if (held(player, itemId)) return true;
    return false;
  }

  function isQuestComplete(player, key) {
    if (!key) return false;
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    if (player.getSkillManager().getCurrentLevel(Skill.FIREMAKING) < FIREMAKING_REQUIREMENT) return false;
    return (
      isQuestComplete(player, "my_arms_big_adventure") &&
      isQuestComplete(player, "cold_war") &&
      isQuestComplete(player, "romeo_and_juliet")
    );
  }

  function advanceTo(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
    syncCoffinVarbit(player);
    syncPrisonNpcs(player);
  }

  function play(player, variant, npcId = MY_ARM_VOICE_NPC_ID) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  function coffinBuilt(player) {
    return player.getAttribute(COFFIN_BUILT_ATTRIBUTE) === true;
  }

  function setCoffinBuilt(player, value) {
    player.setAttribute(COFFIN_BUILT_ATTRIBUTE, value === true);
  }

  function potionObtained(player) {
    return player.getAttribute(POTION_OBTAINED_ATTRIBUTE) === true;
  }

  function setPotionObtained(player, value) {
    player.setAttribute(POTION_OBTAINED_ATTRIBUTE, value === true);
  }

  function ropeTied(player) {
    return player.getAttribute(ROPE_TIED_ATTRIBUTE) === true;
  }

  function setRopeTied(player, value) {
    player.setAttribute(ROPE_TIED_ATTRIBUTE, value === true);
  }

  function planSeen(player) {
    return player.getAttribute(PLAN_SEEN_ATTRIBUTE) === true;
  }

  function setPlanSeen(player, value) {
    player.setAttribute(PLAN_SEEN_ATTRIBUTE, value === true);
  }

  function climbWarned(player) {
    return player.getAttribute(CLIMB_WARNED_ATTRIBUTE) === true;
  }

  function setClimbWarned(player, value) {
    player.setAttribute(CLIMB_WARNED_ATTRIBUTE, value === true);
  }

  function waterCrossings(player) {
    return Number(player.getAttribute(WATER_CROSSINGS_ATTRIBUTE)) || 0;
  }

  function setWaterCrossings(player, value) {
    player.setAttribute(WATER_CROSSINGS_ATTRIBUTE, value | 0);
  }

  function resetRunState(player) {
    setCoffinBuilt(player, false);
    setPotionObtained(player, false);
    setRopeTied(player, false);
    setPlanSeen(player, false);
    setClimbWarned(player, false);
    setWaterCrossings(player, 0);
    motherOffers.delete(player);
    clearTracked(player);
    syncCoffinVarbit(player);
  }

  function startQuest(player) {
    if (quest.getStage(player) >= STAGE_STARTED) return;
    resetRunState(player);
    advanceTo(player, STAGE_STARTED);
  }

  /** varbit 6536 drives the Draynor coffin multi's hotspot/built/occupied states. */
  function syncCoffinVarbit(player) {
    const stage = quest.getStage(player);
    let value = 0;
    if (held(player, OLD_MANS_COFFIN_ITEM_ID) || stage >= STAGE_PRISON) value = 0;
    else if (stage >= STAGE_COFFIN) value = 3;
    else if (coffinBuilt(player)) value = 2;
    else if (stage >= STAGE_WOM_TASKS) value = 1;
    player.getPacketSender().sendVarbit(VARBIT_MY2ARM_CLIENT_COFFIN, value);
  }

  // ==========================================================================
  // Per-player quest spawns (prison cast, the two bosses)
  // ==========================================================================

  function ensureTracked(player, key, definition) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    const existing = tracked.get(key);
    if (existing && existing.isRegistered?.() !== false) return existing;
    tracked.delete(key);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) tracked.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const tracked = trackedNpcs.get(player);
    const npc = tracked?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    tracked.delete(key);
  }

  function clearTracked(player) {
    const tracked = trackedNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  function syncPrisonNpcs(player) {
    if (!player || typeof player.isPlayerBot === "function" && player.isPlayerBot()) return;
    const stage = quest.getStage(player);
    const inPrison = stage >= STAGE_PRISON && stage < STAGE_MOTHER_DEAD;
    if (inPrison) {
      ensureTracked(player, "mfwma:my-arm", { id: MY_ARM_PRISON_NPC_ID, ...PRISON_MY_ARM_LOCATION, wanderRadius: 0 });
      ensureTracked(player, "mfwma:snowflake", { id: SNOWFLAKE_NPC_ID, ...PRISON_SNOWFLAKE_LOCATION, wanderRadius: 0 });
      ensureTracked(player, "mfwma:wom", { id: WISE_OLD_MAN_SPAWN_NPC_ID, ...PRISON_WOM_LOCATION, wanderRadius: 0 });
      if (stage < STAGE_ODD_DIED) {
        ensureTracked(player, "mfwma:odd-mushroom", { id: ODD_MUSHROOM_DYING_NPC_ID, ...PRISON_ODD_MUSHROOM_LOCATION, wanderRadius: 0 });
      } else {
        removeTracked(player, "mfwma:odd-mushroom");
      }
    } else {
      removeTracked(player, "mfwma:my-arm");
      removeTracked(player, "mfwma:snowflake");
      removeTracked(player, "mfwma:wom");
      removeTracked(player, "mfwma:odd-mushroom");
    }
    if (stage >= STAGE_DKW && stage < STAGE_DKW_DEAD) {
      ensureTracked(player, "mfwma:dont-know-what", { id: DKW_BATTLE_NPC_ID, ...DKW_LOCATION, wanderRadius: 0 });
    } else {
      removeTracked(player, "mfwma:dont-know-what");
    }
    if (stage >= STAGE_FIRE_OUT && stage < STAGE_MOTHER_DEAD) {
      ensureTracked(player, "mfwma:mother", { id: MOTHER_BATTLE_MELEE_NPC_ID, ...MOTHER_BATTLE_LOCATION, wanderRadius: 0 });
    } else {
      removeTracked(player, "mfwma:mother");
    }
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  /** My Arm's shared "the Wise Old Man plan" scene: the first telling, then the recap. */
  function planVariant(player) {
    if (!planSeen(player)) {
      setPlanSeen(player, true);
      return "the-wise-dead-man-talking-to-my-arm-snowflake-or-odd-mushroom";
    }
    return "the-wise-dead-man-talking-to-my-arm-snowflake-or-odd-mushroom-talking-to-any-of-them-again";
  }

  function myArmVariant(player, stage) {
    if (stage < STAGE_MY_ARM) {
      advanceTo(player, STAGE_MY_ARM);
      return "starting-out-talking-to-my-arm";
    }
    if (stage < STAGE_LARRY) return "starting-out-talking-to-my-arm-talking-to-my-arm-again";
    if (stage < STAGE_PLAN) return "troll-diplomacy-talking-to-my-arm";
    if (stage < STAGE_WOM_TASKS) return planVariant(player);
    if (stage < STAGE_PRISON) {
      if (!held(player, OLD_MANS_COFFIN_ITEM_ID)) return planVariant(player);
      advanceTo(player, STAGE_IMPRESS);
      return "the-wise-dead-man-impressing-mother";
    }
    if (stage < STAGE_MOTHER_DEAD) return "matricide-talking-to-my-arm-snowflake-or-odd-mushroom";
    if (stage < STAGE_WOM_AFTER) {
      advanceTo(player, STAGE_WOM_AFTER);
      return "a-new-leader";
    }
    if (stage < STAGE_SNOWFLAKE_AFTER) {
      advanceTo(player, STAGE_SNOWFLAKE_AFTER);
      return "a-new-leader-wedding-ceremony";
    }
    if (stage < STAGE_NOTES_READ) {
      return "a-new-leader-talking-to-snowflake-before-reading-odd-mushroom-s-notes";
    }
    return "a-new-leader-talking-to-snowflake-after-reading-odd-mushroom-s-notes";
  }

  // ==========================================================================
  // NPC Talk-to handlers
  // ==========================================================================

  function talkToBurntmeat(event) {
    const { player, npcId } = event;
    if (npcId !== BURNTMEAT_NPC_ID) return;
    const stage = quest.getStage(player);
    if (stage === 0) {
      if (!meetsRequirements(player)) return; // My Arm's Big Adventure/Eadgar still own him
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, "starting-out-talking-to-burntmeat");
      return;
    }
    if (quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player)) {
      event.handled = true;
      startTranscript(api, player, npcId, "Burntmeat", "standard-dialogue");
      return;
    }
    if (quest.isComplete(player) && held(player, WEISS_FIRE_NOTES_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(WEISS_FIRE_NOTES_ITEM_ID, 1);
      startTranscript(api, player, npcId, "Burntmeat", "standard-dialogue-after-making-friends-with-my-arm-and-delivering-fire-notes");
    }
  }

  function talkToMyArm(event) {
    const { player, npcId } = event;
    if (!MY_ARM_NPC_IDS.has(npcId)) return false;
    // Secrets of the North stages 12-14 own My Arm for its Weiss information scene.
    const sotnStage = Number(player.getAttribute("quest.secrets_of_the_north.stage")) || 0;
    if (sotnStage >= 12 && sotnStage <= 14) return false;
    const stage = quest.getStage(player);
    if (npcId === MY_ARM_PRISON_NPC_ID) {
      // 8411 is My Arm's Big Adventure's spawn id too: only own it in the prison cell.
      if (stage < STAGE_PRISON || stage >= STAGE_SNOWFLAKE_AFTER) return false;
      if (player.getLocation().getY() < 10000) return false;
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, myArmVariant(player, stage));
      return true;
    }
    if (stage < STAGE_STARTED || quest.isComplete(player)) return false;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, myArmVariant(player, stage));
    return true;
  }

  function talkToLarry(event) {
    const { player, npcId } = event;
    if (!LARRY_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_MY_ARM || quest.isComplete(player)) return;
    if (npcId !== LARRY_RELLEKKA_NPC_ID) return;
    let variant;
    if (stage < STAGE_LARRY) {
      variant = "starting-out-talking-to-larry";
    } else if (stage < STAGE_LARRY_AGAIN) {
      advanceTo(player, STAGE_LARRY_AGAIN);
      variant = "starting-out-talking-to-larry-after-my-arm-arrives";
    } else if (stage >= STAGE_COFFIN) {
      variant = "troll-diplomacy-sailing-to-weiss"; // ferry the coffin back to Weiss
    } else if (stage < STAGE_ARRIVED) {
      advanceTo(player, STAGE_SAILED);
      variant = "troll-diplomacy-sailing-to-weiss";
    } else {
      variant = "starting-out-talking-to-larry-after-my-arm-arrives";
    }
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function talkToBoulder(event) {
    const { player, npcId } = event;
    if (npcId !== BOULDER_NPC_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_ARRIVED || stage >= STAGE_BOULDER) return;
    event.handled = true;
    advanceTo(player, STAGE_BOULDER);
    startTranscript(api, player, npcId, PAGE, "troll-diplomacy-talking-to-boulder");
  }

  function talkToMother(event) {
    const { player, npcId } = event;
    if (!MOTHER_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    let variant;
    if (stage >= STAGE_PRISON) {
      variant = "matricide-mother-knows-best";
    } else if (stage >= STAGE_MOTHER) {
      variant = "troll-diplomacy-talking-business-with-mother";
    } else if (stage >= STAGE_MINED) {
      variant = "troll-diplomacy-meeting-with-mother";
    } else {
      return;
    }
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function talkToSnowflake(event) {
    const { player, npcId } = event;
    if (!SNOWFLAKE_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return false;
    let variant;
    if (stage >= STAGE_NOTES_READ) {
      variant = "a-new-leader-talking-to-snowflake-after-reading-odd-mushroom-s-notes";
    } else if (stage >= STAGE_NOTES) {
      variant = "a-new-leader-talking-to-snowflake-before-reading-odd-mushroom-s-notes";
    } else if (stage >= STAGE_DUNG) {
      variant = "a-new-leader-talking-to-snowflake-again";
    } else if (stage >= STAGE_SNOWFLAKE_AFTER) {
      advanceTo(player, STAGE_DUNG);
      variant = "a-new-leader-wedding-ceremony";
    } else if (stage >= STAGE_MOTHER_DEAD) {
      advanceTo(player, STAGE_SNOWFLAKE_AFTER);
      variant = "a-new-leader";
    } else if (stage >= STAGE_DKW) {
      return; // Don't Know What, then Mother
    } else if (stage >= STAGE_ODD_DIED) {
      variant = "matricide-grand-escape";
    } else if (stage >= STAGE_PRISON) {
      advanceTo(player, STAGE_ODD_DIED);
      variant = "matricide-talking-to-my-arm-snowflake-or-odd-mushroom";
    } else if (stage >= STAGE_PLAN) {
      variant = planVariant(player);
    } else if (stage >= STAGE_MINED) {
      variant = "troll-diplomacy-meeting-with-mother";
    } else {
      return;
    }
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function talkToOddMushroom(event) {
    const { player, npcId } = event;
    if (!ODD_MUSHROOM_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    let variant;
    if (stage >= STAGE_PRISON && stage < STAGE_ODD_DIED) {
      advanceTo(player, STAGE_ODD_DIED);
      variant = "matricide-talking-to-my-arm-snowflake-or-odd-mushroom";
    } else if (stage >= STAGE_PLAN && stage < STAGE_PRISON) {
      variant = planVariant(player);
    } else if (stage >= STAGE_MINED && stage < STAGE_PLAN) {
      variant = "troll-diplomacy-meeting-with-mother";
    } else {
      return;
    }
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function talkToWiseOldMan(event) {
    const { player, npcId } = event;
    if (!WISE_OLD_MAN_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    const location = player.getLocation();
    let variant;
    if (stage >= STAGE_PRISON && stage < STAGE_ODD_DIED) {
      if (location.getY() < 10000) return false;
      variant = "matricide-talking-to-the-wise-old-man";
    } else if (stage >= STAGE_MOTHER_DEAD && stage < STAGE_SNOWFLAKE_AFTER) {
      if (location.getY() < 3900 || location.getY() > 3960) return false;
      advanceTo(player, STAGE_SNOWFLAKE_AFTER);
      variant = "a-new-leader";
    } else if (stage >= STAGE_PLAN && stage < STAGE_WOM_ASKED) {
      if (!isInDraynor(location)) return false;
      advanceTo(player, STAGE_WOM_ASKED);
      variant = "the-wise-dead-man-talking-to-the-wise-old-man";
    } else if (stage >= STAGE_WOM_ASKED && stage < STAGE_COFFIN) {
      if (!isInDraynor(location)) return false;
      variant = coffinBuilt(player) && potionObtained(player)
        ? "the-wise-dead-man-talking-to-the-wise-old-man-after-all-is-prepared"
        : "the-wise-dead-man-talking-to-the-wise-old-man-talking-to-the-wise-old-man-again";
    } else {
      return false;
    }
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant);
    return true;
  }

  function isInDraynor(location) {
    return location.getX() >= 3060 && location.getX() <= 3120 && location.getY() >= 3220 && location.getY() <= 3280;
  }

  function talkToApothecary(event) {
    const { player, npcId } = event;
    if (npcId !== APOTHECARY_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_WOM_ASKED || stage >= STAGE_COFFIN || potionObtained(player)) return false;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "the-wise-dead-man-talking-to-the-apothecary");
  }

  // ==========================================================================
  // Transcript conditions, choices and stage directions
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!player) return null;
    switch (stepId) {
      case CONDITION_HID_FAILED:
        return false;
      case CONDITION_HID_OK:
        return true;
      case CONDITION_NO_CADAVA:
        return !held(player, CADAVA_BERRIES_ITEM_ID);
      case CONDITION_HAS_CADAVA:
        return held(player, CADAVA_BERRIES_ITEM_ID);
      case CONDITION_NO_DUNG:
        return !held(player, GOAT_DUNG_ITEM_ID);
      case CONDITION_HAS_DUNG:
        return held(player, GOAT_DUNG_ITEM_ID);
      default:
        break;
    }
    if (CONDITION_MOTHER_OFFER_IDS.has(stepId)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_PLAN && stage < STAGE_WOM_ASKED) return true;
      if (stage !== STAGE_MOTHER) return false;
      if ((motherOffers.get(player)?.size ?? 0) < 4) return false;
      advanceTo(player, STAGE_PLAN);
      return true;
    }
    return null;
  }

  function handleTranscriptChoice(event) {
    const { player, npcId, option } = event;
    if (!player || !option) return;
    if (MOTHER_NPC_IDS.has(npcId) && quest.getStage(player) === STAGE_MOTHER) {
      const offers = motherOffers.get(player) ?? new Set();
      motherOffers.set(player, offers);
      offers.add(option);
      return;
    }
    if (option === "You owe me a favour after the Fishing Colony quest.") {
      const stage = quest.getStage(player);
      if (stage >= STAGE_PLAN && stage < STAGE_WOM_TASKS) {
        advanceTo(player, STAGE_WOM_TASKS);
        syncCoffinVarbit(player);
      }
      return;
    }
    if (option === "Yes, I'll take your quest." && npcId === BURNTMEAT_NPC_ID) {
      startQuest(player);
    }
  }

  function handleTranscriptAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === ACTION_WOLFBONE_ROUTE) {
      startQuest(player);
      return;
    }
    if (ACTION_MY_ARM_ARRIVES.has(stepId)) {
      advanceTo(player, STAGE_LARRY);
      return;
    }
    if (stepId === ACTION_REACH_COAST) {
      arriveAtWeiss(player);
      return;
    }
    if (stepId === ACTION_SNOWFLAKE_LEAVES) {
      motherOffers.delete(player);
      advanceTo(player, STAGE_MOTHER);
      return;
    }
    if (stepId === ACTION_HAND_BERRIES) {
      player.getInventory().deleteNumber(CADAVA_BERRIES_ITEM_ID, 1);
      return;
    }
    if (ACTION_APOTHECARY_BREWS.has(stepId)) {
      if (stepId === ACTION_APOTHECARY_BREW_DUPLICATE) event.handled = true;
      if (!potionObtained(player)) {
        setPotionObtained(player, true);
        give(player, REDUCED_CADAVA_POTION_ITEM_ID);
        advanceTo(player, coffinBuilt(player) ? STAGE_WOM_READY : STAGE_POTION);
      }
      return;
    }
    if (stepId === ACTION_HAND_POTION) {
      player.getInventory().deleteNumber(REDUCED_CADAVA_POTION_ITEM_ID, 1);
      return;
    }
    if (stepId === ACTION_WOM_DRINKS) {
      advanceTo(player, STAGE_COFFIN);
      syncCoffinVarbit(player);
      return;
    }
    if (stepId === ACTION_MOTHER_IMPRISONS) {
      imprison(player);
      return;
    }
    if (stepId === ACTION_PRISON_BREAK) {
      advanceTo(player, STAGE_DKW);
      player.sendMessage("Don't Know What charges at you!");
      return;
    }
    if (stepId === ACTION_ANCIENT_DANCE) {
      advanceTo(player, STAGE_SNOWFLAKE_AFTER);
      return;
    }
    if (stepId === ACTION_RECEIVE_NOTES) {
      give(player, WEISS_FIRE_NOTES_ITEM_ID);
      advanceTo(player, STAGE_NOTES);
      return;
    }
    if (stepId === ACTION_QUEST_COMPLETE) {
      if (!quest.isComplete(player)) quest.complete(player);
      syncPrisonNpcs(player);
    }
  }

  // ==========================================================================
  // Environment interactions
  // ==========================================================================

  function arriveAtWeiss(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ARRIVED) {
      advanceTo(player, STAGE_ARRIVED);
      player.moveTo(WEISS_ARRIVAL_LOCATION);
      return;
    }
    if (stage >= STAGE_COFFIN && stage < STAGE_COMPLETE) {
      player.moveTo(WEISS_TOWN_LOCATION);
    }
  }

  function searchWreck(player) {
    const found = [];
    if (!held(player, ROPE_ITEM_ID)) {
      player.getInventory().adds(ROPE_ITEM_ID, 1);
      found.push("a rope");
    }
    if (!hasPickaxe(player)) {
      player.getInventory().adds(ItemIdentifiers.BRONZE_PICKAXE, 1);
      found.push("a bronze pickaxe");
    }
    if (!held(player, HAMMER_ITEM_ID)) {
      player.getInventory().adds(HAMMER_ITEM_ID, 1);
      found.push("a hammer");
    }
    player.sendMessage(found.length
      ? `You salvage ${found.join(", ")} from the wrecked boat.`
      : "There is nothing else useful in the wrecked boat.");
    if (quest.getStage(player) < STAGE_WRECK) advanceTo(player, STAGE_WRECK);
  }

  function climbRockslide(player, objectId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ARRIVED) return;
    if (objectId === ObjectIdentifiers.ROCKSLIDE_52) {
      player.moveTo(CLIFF5_LOCATION);
      return;
    }
    if (!ropeTied(player) && !climbWarned(player)) {
      setClimbWarned(player, true);
      play(player, "troll-diplomacy-talking-to-my-arm-attempting-to-climb-rockslide");
    }
    player.moveTo(CLIFF2_LOCATION);
  }

  function tieRope(player) {
    if (ropeTied(player)) return;
    if (quest.getStage(player) < STAGE_ARRIVED) return;
    if (!held(player, ROPE_ITEM_ID)) {
      player.sendMessage("You need a rope for this.");
      return;
    }
    player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
    setRopeTied(player, true);
    advanceTo(player, STAGE_ROPED);
    player.moveTo(CLIFF3_LOCATION);
    player.sendMessage("You tie the rope to the tree and climb down to the ledge.");
  }

  function crossFence(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BOULDER) {
      play(player, "troll-diplomacy-crossing-the-fence-before-talking-to-boulder", BOULDER_NPC_ID);
      return;
    }
    if (stage < STAGE_CAVE) advanceTo(player, STAGE_SNEAK);
    player.moveTo(SNEAK_LOCATION);
    player.sendMessage("You slip through the gap in the fence and creep along the edge of Weiss.");
  }

  function descendHole(player) {
    if (quest.getStage(player) < STAGE_SNEAK) return;
    advanceTo(player, STAGE_CAVE);
    player.moveTo(CAVE_LOCATION);
    startTranscript(api, player, SQUIRREL_NPC_ID, PAGE, "troll-diplomacy-home-invasion-descending-hole-after-evading-all-the-trolls");
  }

  function crossWater(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CAVE) return;
    const crossings = waterCrossings(player);
    if (crossings === 0) {
      setWaterCrossings(player, 1);
      advanceTo(player, STAGE_WATER);
      player.moveTo(WATER_WEST_LOCATION);
      play(player, "troll-diplomacy-home-invasion-upon-walking-close-enough-to-the-cave-exit");
      return;
    }
    if (crossings === 1) {
      setWaterCrossings(player, 2);
      advanceTo(player, STAGE_STONES);
      player.moveTo(WATER_EAST_LOCATION);
      play(player, "troll-diplomacy-home-invasion-upon-creating-a-long-enough-stepping-stone-path");
      return;
    }
    player.moveTo(player.getLocation().getX() > WATER_WEST_LOCATION.getX() + 10 ? WATER_WEST_LOCATION : WATER_EAST_LOCATION);
  }

  function mineCaveEntrance(player) {
    if (quest.getStage(player) >= STAGE_MINED) {
      player.sendMessage("The cave entrance is already clear.");
      return;
    }
    play(player, "troll-diplomacy-talking-to-my-arm-attempting-to-mine-cave-entrance");
  }

  function mineCaveExit(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_WATER) {
      mineCaveEntrance(player);
      return;
    }
    if (stage < STAGE_STONES) {
      player.sendMessage("My Arm cannot cross the water yet - the trolls above need to throw more rocks.");
      return;
    }
    if (!hasPickaxe(player)) {
      player.sendMessage("You need a pickaxe to clear the rubble.");
      return;
    }
    advanceTo(player, STAGE_MINED);
    player.moveTo(WEISS_TOWN_LOCATION);
    play(player, "troll-diplomacy-home-invasion-upon-clearing-the-obstruction");
    player.sendMessage("You clear the rubble and My Arm strides in. The trolls take you to Mother.");
  }

  function passFallenTree(player) {
    player.moveTo(ABOVE_WEISS_LOCATION);
    if (!climbWarned(player)) {
      setClimbWarned(player, true);
      play(player, "troll-diplomacy-upon-climbing-up-all-the-rocks");
    }
  }

  function takeBucket(player) {
    if (held(player, BUCKET_ITEM_ID) || held(player, BUCKET_OF_WATER_ITEM_ID)) {
      player.sendMessage("You already have a bucket.");
      return;
    }
    player.getInventory().adds(BUCKET_ITEM_ID, 1);
    player.sendMessage("You take a bucket from the pile.");
  }

  function fillBucket(player) {
    if (!held(player, BUCKET_ITEM_ID)) {
      player.sendMessage("You need an empty bucket first.");
      return;
    }
    player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
    player.getInventory().adds(BUCKET_OF_WATER_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_FIRE) advanceTo(player, STAGE_FIRE);
    player.sendMessage("You fill the bucket with water.");
  }

  function douseFire(player) {
    if (!held(player, BUCKET_OF_WATER_ITEM_ID)) return;
    player.getInventory().deleteNumber(BUCKET_OF_WATER_ITEM_ID, 1);
    player.getInventory().adds(BUCKET_ITEM_ID, 1);
    advanceTo(player, STAGE_FIRE_OUT);
    player.sendMessage("You douse the Fire of Domination.");
  }

  function tryBuildCoffin(player) {
    if (quest.getStage(player) < STAGE_WOM_TASKS || quest.getStage(player) >= STAGE_COFFIN) return;
    if (coffinBuilt(player)) {
      player.sendMessage("The coffin is already built.");
      return;
    }
    if (!held(player, HAMMER_ITEM_ID) || !held(player, SAW_ITEM_ID)) {
      player.sendMessage("You need a hammer and a saw to build the coffin.");
      return;
    }
    if (!held(player, MAHOGANY_PLANK_ITEM_ID, COFFIN_PLANK_COUNT) || !held(player, BOLT_OF_CLOTH_ITEM_ID)) {
      player.sendMessage("You need five mahogany planks and a bolt of cloth to build the coffin.");
      return;
    }
    player.getInventory().deleteNumber(MAHOGANY_PLANK_ITEM_ID, COFFIN_PLANK_COUNT);
    player.getInventory().deleteNumber(BOLT_OF_CLOTH_ITEM_ID, 1);
    player.getSkillManager().addExperiences(Skill.CONSTRUCTION, COFFIN_CONSTRUCTION_XP);
    setCoffinBuilt(player, true);
    advanceTo(player, potionObtained(player) ? STAGE_WOM_READY : STAGE_COFFIN_BUILT);
    syncCoffinVarbit(player);
    player.sendMessage("You build the mahogany coffin.");
  }

  function takeCoffin(player) {
    if (held(player, OLD_MANS_COFFIN_ITEM_ID)) {
      player.sendMessage("You already have the coffin.");
      return;
    }
    if (coffinBuilt(player)) setCoffinBuilt(player, false);
    player.getInventory().adds(OLD_MANS_COFFIN_ITEM_ID, 1);
    player.getPacketSender().sendVarbit(VARBIT_MY2ARM_CLIENT_COFFIN, 0);
    player.sendMessage("You pick up the Old Man's coffin.");
  }

  function pickGoatDung(player) {
    if (quest.getStage(player) < STAGE_SNOWFLAKE_AFTER) return;
    if (!held(player, BUCKET_ITEM_ID)) {
      startTranscript(api, player, SNOWFLAKE_NPC_ID, PAGE, "a-new-leader-attempting-to-pick-up-goat-dung-without-a-bucket");
      return;
    }
    if (held(player, GOAT_DUNG_ITEM_ID)) {
      player.sendMessage("You already have some goat dung.");
      return;
    }
    player.getInventory().adds(GOAT_DUNG_ITEM_ID, 1);
    advanceTo(player, STAGE_DUNG);
    player.sendMessage("You scoop some goat dung into your bucket.");
  }

  function imprison(player) {
    if (quest.getStage(player) >= STAGE_MOTHER_DEAD) return;
    advanceTo(player, STAGE_PRISON);
    player.getInventory().deleteNumber(OLD_MANS_COFFIN_ITEM_ID, 1);
    player.getPacketSender().sendVarbit(VARBIT_MY2ARM_CLIENT_COFFIN, 0);
    player.moveTo(PRISON_LOCATION);
    syncPrisonNpcs(player);
    player.sendMessage("Mother batters the group and throws you into the cells below Weiss.");
  }

  function escapePrison(player) {
    player.moveTo(WEISS_ARRIVAL_LOCATION);
    player.sendMessage("You squeeze out of the smelly hole by the coast.");
  }

  function climbToThroneRoom(player) {
    player.moveTo(THRONE_ROOM_LOCATION);
    player.sendMessage("You climb the steps into Mother's throne room.");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (objectId === WRECKED_BOAT_OBJECT_ID) {
      event.handled = true;
      searchWreck(player);
      return;
    }
    if (ROCKSLIDE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      climbRockslide(player, objectId);
      return;
    }
    if (objectId === LEDGE_OBJECT_ID) {
      event.handled = true;
      if (ropeTied(player)) player.moveTo(CLIFF4_LOCATION);
      else player.sendMessage("You can't reach the ledge from here.");
      return;
    }
    if (objectId === FALLEN_TREE_OBJECT_ID) {
      event.handled = true;
      passFallenTree(player);
      return;
    }
    if (objectId === CAVE_ENTRANCE_BLOCKED_OBJECT_ID || objectId === CAVE_ENTRANCE_CLEAR_OBJECT_ID || objectId === CAVE_ENTRANCE_MULTI_OBJECT_ID) {
      event.handled = true;
      mineCaveEntrance(player);
      return;
    }
    if (objectId === FENCE_OBJECT_ID || objectId === BROKEN_FENCE_OBJECT_ID) {
      event.handled = true;
      crossFence(player);
      return;
    }
    if (objectId === HOLE_OBJECT_ID) {
      event.handled = true;
      descendHole(player);
      return;
    }
    if (objectId === NARROW_GAP_OBJECT_ID) {
      event.handled = true;
      player.moveTo(CAVE_LOCATION);
      return;
    }
    if (WATERS_EDGE_OBJECT_IDS.has(objectId) || objectId === WATERLINE_HINT_OBJECT_ID) {
      event.handled = true;
      crossWater(player);
      return;
    }
    if (objectId === CAVE_EXIT_BLOCKED_OBJECT_ID) {
      event.handled = true;
      mineCaveExit(player);
      return;
    }
    if (objectId === PILE_OF_BUCKETS_OBJECT_ID) {
      event.handled = true;
      takeBucket(player);
      return;
    }
    if (objectId === COFFIN_MULTI_OBJECT_ID || objectId === COFFIN_HOTSPOT_OBJECT_ID) {
      event.handled = true;
      // The placed multi is one object: Build before the Old Man is in it, Take after.
      if (quest.getStage(player) >= STAGE_COFFIN && !held(player, OLD_MANS_COFFIN_ITEM_ID)) takeCoffin(player);
      else tryBuildCoffin(player);
      return;
    }
    if (objectId === OCCUPIED_COFFIN_OBJECT_ID) {
      event.handled = true;
      takeCoffin(player);
      return;
    }
    if (objectId === GOAT_POO_OBJECT_ID) {
      event.handled = true;
      pickGoatDung(player);
      return;
    }
    if (objectId === STEPS_OBJECT_ID) {
      event.handled = true;
      climbToThroneRoom(player);
      return;
    }
    if (objectId === SMELLY_HOLE_OBJECT_ID) {
      event.handled = true;
      escapePrison(player);
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (itemId === ROPE_ITEM_ID && (objectId === ROPETRAIL_MULTI_OBJECT_ID || objectId === ROPE_TREE_MULTI_OBJECT_ID || objectId === ROPE_TREE_OBJECT_ID || objectId === ROPED_TREE_OBJECT_ID)) {
      event.handled = true;
      tieRope(player);
      return;
    }
    if ((objectId === COFFIN_MULTI_OBJECT_ID || objectId === COFFIN_HOTSPOT_OBJECT_ID) &&
      [MAHOGANY_PLANK_ITEM_ID, BOLT_OF_CLOTH_ITEM_ID, HAMMER_ITEM_ID, SAW_ITEM_ID].includes(itemId)) {
      event.handled = true;
      tryBuildCoffin(player);
      return;
    }
    if (itemId === BUCKET_ITEM_ID && objectId === BARREL_OF_WATER_OBJECT_ID) {
      event.handled = true;
      fillBucket(player);
      return;
    }
    if (itemId === BUCKET_OF_WATER_ITEM_ID && objectId === FIRE_OF_DOMINATION_OBJECT_ID) {
      event.handled = true;
      douseFire(player);
      return;
    }
    if (itemId === BUCKET_ITEM_ID && objectId === GOAT_POO_OBJECT_ID) {
      event.handled = true;
      pickGoatDung(player);
    }
  }

  function readNotes(event) {
    const { player } = event;
    if (!player || quest.getStage(player) < STAGE_NOTES) return;
    event.handled = true;
    advanceTo(player, STAGE_NOTES_READ);
    player.sendMessage("You read Odd Mushroom's notes on the salts and fires of Weiss.");
  }

  function handleNpcDeath(event) {
    const { npcId, killer } = event;
    const player = killer;
    if (!player) return;
    if (npcId === DKW_BATTLE_NPC_ID) {
      advanceTo(player, STAGE_DKW_DEAD);
      player.moveTo(THRONE_ROOM_LOCATION);
      player.sendMessage("Don't Know What collapses. You climb the steps to the throne room.");
      return;
    }
    if (npcId === MOTHER_BATTLE_MELEE_NPC_ID) {
      advanceTo(player, STAGE_MOTHER_DEAD);
      player.sendMessage("Mother falls. Snowflake calls the trolls of Weiss to her.");
    }
  }

  function handleLogin({ player }) {
    syncPrisonNpcs(player);
    syncCoffinVarbit(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    clearTracked(player);
  }

  function handleZoneEnter({ player }) {
    syncPrisonNpcs(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped My Arm travel to Weiss and win Snowflake's hand.</str>",
        "<str>The Wise Old Man and I helped overthrow Mother, and Snowflake</str>",
        "<str>became leader of Weiss. I fetched goat dung for the new herb</str>",
        "<str>patches and read Odd Mushroom's fire notes.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_NOTES) {
      return [
        "<str>Snowflake and My Arm rule Weiss together, and I fetched the goat dung</str>",
        "<str>for the new herb patches. Snowflake gave me Odd Mushroom's notes.</str>",
        "",
        "I should read the <col=800000>Weiss fire notes</col> and speak to <col=800000>Snowflake</col>.",
      ];
    }
    if (stage >= STAGE_DUNG) {
      return [
        "<str>Mother is dead and Snowflake is leader of Weiss; she and My Arm are married.</str>",
        "",
        "I should fetch some <col=800000>goat dung</col> for Snowflake from the goat pen outside.",
      ];
    }
    if (stage >= STAGE_MOTHER_DEAD) {
      return [
        "<str>Mother is dead and Snowflake is leader of Weiss.</str>",
        "",
        "I should speak to <col=800000>My Arm</col> in Weiss.",
      ];
    }
    if (stage >= STAGE_DKW) {
      return [
        "<str>We are imprisoned under Weiss. Odd Mushroom is dead and Snowflake wants revenge.</str>",
        "",
        "I must kill <col=800000>Don't Know What</col>, douse the <col=800000>Fire of Domination</col>",
        "and then kill <col=800000>Mother</col>.",
      ];
    }
    if (stage >= STAGE_PRISON) {
      return [
        "<str>Mother saw through the Wise Old Man's disguise and threw us in the cells.</str>",
        "",
        "I should talk to <col=800000>Odd Mushroom</col>.",
      ];
    }
    if (stage >= STAGE_IMPRESS) {
      return [
        "<str>The Wise Old Man is disguised as a corpse in his coffin.</str>",
        "",
        "I should give the <col=800000>coffin</col> to <col=800000>My Arm</col> in Weiss.",
      ];
    }
    if (stage >= STAGE_COFFIN) {
      return [
        "<str>The Wise Old Man has drunk the reduced cadava potion and is in his coffin.</str>",
        "",
        "I should pick up the <col=800000>coffin</col> and take it to <col=800000>My Arm</col> in Weiss.",
      ];
    }
    if (stage >= STAGE_WOM_TASKS) {
      const lines = [
        "<str>The Wise Old Man agreed to pretend to be dead for My Arm.</str>",
        "",
      ];
      lines.push(coffinBuilt(player)
        ? "<str>I built the mahogany coffin.</str>"
        : "I should build a <col=800000>mahogany coffin</col> in the Wise Old Man's house.");
      lines.push(potionObtained(player)
        ? "<str>I got the reduced cadava potion from the Apothecary.</str>"
        : "I should get a <col=800000>reduced cadava potion</col> from the Apothecary in Varrock.");
      if (coffinBuilt(player) && potionObtained(player)) {
        lines.push("", "I should talk to the <col=800000>Wise Old Man</col>.");
      }
      return lines;
    }
    if (stage >= STAGE_PLAN) {
      return [
        "<str>My Arm wants to impress Mother by pretending to kill his old enemy.</str>",
        "",
        "I should ask the <col=800000>Wise Old Man</col> in Draynor Village for help.",
      ];
    }
    if (stage >= STAGE_MOTHER) {
      return [
        "<str>Mother dismissed My Arm's offer. Odd Mushroom knows a way to impress him.</str>",
        "",
        "I should talk to <col=800000>My Arm</col> outside Mother's hall.",
      ];
    }
    if (stage >= STAGE_MINED) {
      return [
        "<str>My Arm is inside the cave under Weiss.</str>",
        "",
        "I should talk to <col=800000>Mother</col> in the town.",
      ];
    }
    if (stage >= STAGE_CAVE) {
      const lines = ["<str>I am sneaking through the cave under Weiss.</str>", ""];
      if (stage < STAGE_STONES) {
        lines.push("I should swim across the water and make a stepping stone path for My Arm.");
      } else {
        lines.push("I should mine the <col=800000>cave exit</col> to let My Arm in.");
      }
      return lines;
    }
    if (stage >= STAGE_BOULDER) {
      return [
        "<str>Boulder refused me entry to Weiss.</str>",
        "",
        "I should sneak in through the <col=800000>broken fence</col> east of Boulder.",
      ];
    }
    if (stage >= STAGE_ARRIVED) {
      return [
        "<str>I arrived on the coast north of Weiss with My Arm.</str>",
        "",
        "I should find a way up the cliff and talk to <col=800000>Boulder</col>.",
      ];
    }
    if (stage >= STAGE_MY_ARM) {
      return [
        "<str>Burntmeat is sending My Arm to Weiss as an ambassador.</str>",
        "",
        "I should meet <col=800000>My Arm</col> at <col=800000>Larry's boat</col> near Rellekka.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I agreed to help Burntmeat send My Arm to Weiss.</str>",
        "",
        "I should talk to <col=800000>My Arm</col> on the roof of the Troll Stronghold.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Burntmeat</col> in the",
      "<col=800000>Troll Stronghold</col> kitchen.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CONSTRUCTION, 10000);
    skills.addExperiences(Skill.FIREMAKING, 40000);
    skills.addExperiences(Skill.MINING, 50000);
    skills.addExperiences(Skill.AGILITY, 50000);
  }

  api.persistAttribute(COFFIN_BUILT_ATTRIBUTE);
  api.persistAttribute(POTION_OBTAINED_ATTRIBUTE);
  api.persistAttribute(ROPE_TIED_ATTRIBUTE);
  api.persistAttribute(PLAN_SEEN_ATTRIBUTE);
  api.persistAttribute(CLIMB_WARNED_ATTRIBUTE);
  api.persistAttribute(WATER_CROSSINGS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "making_friends_with_my_arm",
    name: "Making Friends with My Arm",
    varpId: VARP_MY2ARM,
    varbitId: VARBIT_MY2ARM_STATUS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 10000, label: "Construction" },
      { skillId: Skill.FIREMAKING.getIndex(), amount: 40000, label: "Firemaking" },
      { skillId: Skill.MINING.getIndex(), amount: 50000, label: "Mining" },
      { skillId: Skill.AGILITY.getIndex(), amount: 50000, label: "Agility" },
    ],
    otherRewards: [
      "Access to the Salt Mines",
      "Ability to build fire pits",
      "A disease-free herb patch in Weiss",
      "Ability to tune a house portal to Troll Stronghold",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleTranscriptAction);
  api.onCustomEvent("npc-dialogue:choice", handleTranscriptChoice);
  api.onNpcInteraction("Burntmeat", { "Talk-to": talkToBurntmeat });
  api.onNpcInteraction("My Arm", { "Talk-to": talkToMyArm });
  api.onNpcInteraction("Larry", { "Talk-to": talkToLarry });
  api.onNpcInteraction("Boulder", { "Talk-to": talkToBoulder });
  api.onNpcInteraction("Mother", { "Talk-to": talkToMother });
  api.onNpcInteraction("Snowflake", { "Talk-to": talkToSnowflake });
  api.onNpcInteraction("Odd Mushroom", { "Talk-to": talkToOddMushroom });
  api.onNpcInteraction("Wise Old Man", { "Talk-to": talkToWiseOldMan });
  api.onNpcInteraction("Apothecary", { "Talk-to": talkToApothecary });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction("Weiss fire notes", { Read: readNotes });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onZoneEnter(PRISON_ZONE, handleZoneEnter);
};
