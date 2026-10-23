/**
 * Below Ice Mountain. Capture 1636 supplies quest variables, interaction order,
 * montage timing and messages; docs/below-ice-mountain.md records the evidence.
 * The five saved story stages remain compatible with existing characters; the
 * cache receives OSRS's separate main, recruitment, reward and emote varbits.
 */
module.exports = function registerBelowIceMountainQuest(api) {
  const {
    Animation,
    CountdownTask,
    CreationMenu,
    DialogueChainBuilder,
    NpcDialogue,
    StatementDialogue,
    TaskManager,
    TemplatedInstanceArea,
    ForceMovement,
    ForceMovementTask,
    GameObject,
    Graphic,
    HitDamage,
    HitMask,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, QUEST_POINTS_ATTRIBUTE } = require("../QuestRuntime");

  const PAGE = "Below Ice Mountain";
  const SCENES = require("../data/below-ice-mountain-scenes.json");
  const MAIN_VARBIT = 12063;
  const MARLEY_VARBIT = 12064;
  const CHECKAL_VARBIT = 12065;
  const BURNTOF_VARBIT = 12066;
  const REWARD_VARBIT = 12067;
  const FLEX_VARBIT = 12062;
  const WORKOUT_VARBIT = 12131;
  const RAMARNO_MOVED_VARBIT = 12068;
  const QUEST_POINTS_REQUIRED = 16;
  const MAIN_PROGRESS_ATTRIBUTE = "below-ice-mountain:progress";
  const CHECKAL_PROMPT_ATTRIBUTE = "below-ice-mountain:flex-requested";
  const REWARD_PENDING_ATTRIBUTE = "below-ice-mountain:reward-pending";
  const STORY_SCENE_ATTRIBUTE = "below-ice-mountain:scene";
  const TRAINING_ATTRIBUTE = "below-ice-mountain:training";
  const FADE_TARGET_UID = (161 << 16) | 1;
  const FADE_GROUP = 174;
  const FADE_SCRIPT = 948;

  // NPCs.
  const WILLOW_NPC_ID = NpcIdentifiers.WILLOW; // 10655
  const MARLEY_NPC_ID = NpcIdentifiers.MARLEY; // 10656
  const CHECKAL_NPC_ID = NpcIdentifiers.CHECKAL; // 10657
  const ATLAS_NPC_ID = NpcIdentifiers.ATLAS; // 10658
  const BURNTOF_NPC_ID = NpcIdentifiers.BURNTOF; // 10659
  const BURNTOF_2_NPC_ID = NpcIdentifiers.BURNTOF_2; // 10660
  const RAMARNO_NPC_ID = NpcIdentifiers.RAMARNO_2; // 10684, named Ramarno chathead
  const RAMARNO_RESOLVED_NPC_ID = NpcIdentifiers.RAMARNO_3; // 10685, the world spawn's resolved click id
  const RAMARNO_WORLD_NPC_ID = 10702; // world spawn in npc-spawns.json at (2951,5779)
  const RAMARNO_WORLD_NPC_IDS = new Set([RAMARNO_WORLD_NPC_ID, RAMARNO_RESOLVED_NPC_ID]);
  const RAMARNO_NPC_IDS = new Set([RAMARNO_NPC_ID, ...RAMARNO_WORLD_NPC_IDS]);
  const ANCIENT_GUARDIAN_NPC_ID = NpcIdentifiers.ANCIENT_GUARDIAN; // 10654
  const COOK_NPC_ID = NpcIdentifiers.COOK_2; // 2895, Cook (Blue Moon Inn)
  const CHARLIE_NPC_ID = NpcIdentifiers.CHARLIE_THE_TRAMP; // 5209
  const DIALOGUE_NPC_IDS = new Set([
    WILLOW_NPC_ID,
    MARLEY_NPC_ID,
    CHECKAL_NPC_ID,
    ATLAS_NPC_ID,
    BURNTOF_NPC_ID,
    BURNTOF_2_NPC_ID,
    ...RAMARNO_NPC_IDS,
    COOK_NPC_ID,
    CHARLIE_NPC_ID,
  ]);

  // Items.
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946 (all "Knife" variants share the name)
  const BREAD_ITEM_ID = ItemIdentifiers.BREAD; // 2309
  const COOKED_MEAT_ITEM_ID = ItemIdentifiers.COOKED_MEAT; // 2142
  const STEAK_SANDWICH_ITEM_ID = ItemIdentifiers.STEAK_SANDWICH; // 25631
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const BEER_ITEM_ID = ItemIdentifiers.BEER; // 1917
  const ASGARNIAN_ALE_ITEM_ID = ItemIdentifiers.ASGARNIAN_ALE; // 1905
  const DWARVEN_STOUT_ITEM_ID = ItemIdentifiers.DWARVEN_STOUT; // 1913
  const WIZARDS_MIND_BOMB_ITEM_ID = ItemIdentifiers.WIZARDS_MIND_BOMB; // 1907
  const ALCOHOL_ITEM_IDS = [
    BEER_ITEM_ID,
    ASGARNIAN_ALE_ITEM_ID,
    DWARVEN_STOUT_ITEM_ID,
    WIZARDS_MIND_BOMB_ITEM_ID,
  ];

  // Objects (cache names in brackets; "Enter"/"Exit"/"Investigate"/"Mine" ops from the
  // object definitions; placements dumped with output/scripts/dump-loc.ts).
  const RUINS_ENTRANCE_BASE_OBJECT_ID = 41357; // bim_entrance: cache morph driven by the main varbit
  const RUINS_ENTRANCE_OBJECT_ID = ObjectIdentifiers.RUINS_ENTRANCE; // 41439 [bim_door]
  const RUINS_EXIT_OBJECT_ID = ObjectIdentifiers.RUINS_EXIT; // 41446 [bim_exit]
  const WILLOWS_BAG_OBJECT_ID = ObjectIdentifiers.WILLOWS_BAG; // 41448
  const STRUCTURAL_PILLAR_OBJECT_ID = ObjectIdentifiers.STRUCTURAL_PILLAR; // 41458 [bim_boss_rock]
  const BROKEN_PILLAR_OBJECT_ID = ObjectIdentifiers.BROKEN_PILLAR_3; // 41459 [bim_boss_rock_mined]

  // Flex emote: Emotes.plugin.js row { sequence: 8917, loop: 12064 } and cache seq
  // gameval 12064 "emote_flex_loop".
  const FLEX_ANIMATION_ID = 8917;
  const EXPLOSION_OBJECT_ID = 20246; // Capture-only invisible explosion loc; no cache identifier name.
  const ROCK_FALL_GRAPHIC_ID = 60;

  // Stage values.
  const STAGE_STARTED = 1;
  const STAGE_RECRUITED = 2;
  const STAGE_GUARDIAN = 3;
  const STAGE_GUARDIAN_DEAD = 4;
  const STAGE_COMPLETE = 5;

  // Member sub-states.
  const MEMBER_NONE = 0;
  const MEMBER_IN_PROGRESS = 5;
  const MEMBER_RECRUITED = 40;

  // Persisted attributes.
  const CHECKAL_ATTRIBUTE = "quest.below_ice_mountain.checkal";
  const MARLEY_ATTRIBUTE = "quest.below_ice_mountain.marley";
  const BURNTOF_ATTRIBUTE = "quest.below_ice_mountain.burntof";
  const BURNTOF_ASKED_ATTRIBUTE = "quest.below_ice_mountain.burntof-asked";
  const ATLAS_SESSIONS_ATTRIBUTE = "quest.below_ice_mountain.atlas-sessions";
  const ATLAS_DECLINED_ATTRIBUTE = "quest.below_ice_mountain.atlas-declined";
  const FLEX_UNLOCKED_ATTRIBUTE = "quest.below_ice_mountain.flex-unlocked";
  const COOK_TALKED_ATTRIBUTE = "quest.below_ice_mountain.cook-talked";
  const SANDWICH_MADE_ATTRIBUTE = "quest.below_ice_mountain.sandwich-made";
  const MET_RAMARNO_ATTRIBUTE = "quest.below_ice_mountain.met-ramarno";
  const PILLARS_MINED_ATTRIBUTE = "quest.below_ice_mountain.pillars-mined";

  // Condition step ids on the "Below Ice Mountain" page.
  const CONDITION_STRENGTH_99 = "CdEohS";
  const CONDITION_STRENGTH_NOT_99 = "YEdgkU";
  const CONDITION_ATLAS_HAS_COINS = "-zuNtr";
  const CONDITION_ATLAS_NO_COINS = "Z_TXng";
  const CONDITION_NOT_LAST_RECRUIT = "p3MZVl";
  const CONDITION_LAST_RECRUIT = "RPjNZ9";
  const CONDITION_BURNTOF_NO_DRINK = "EX9T0U";
  const CONDITION_BURNTOF_HAS_DRINK = "L2PHG2";
  const CONDITION_BURNTOF_NO_DRINK_AGAIN = "CXxHKd";
  const CONDITION_BURNTOF_HAS_DRINK_AGAIN = "kZrigp";
  const CONDITION_BURNTOF_STOUT = "gHbQLF";
  const CONDITION_BURNTOF_ALE = "uzDIC-";
  const CONDITION_BURNTOF_BOMB = "OsDb1T";
  const CONDITION_BURNTOF_NOT_LAST = "h3U6R5";
  const CONDITION_BURNTOF_LAST = "_wuChA";
  const CONDITION_MARLEY_NOT_LAST = "Yky2FJ";
  const CONDITION_MARLEY_LAST = "mVCBES";

  // Action / message / branch step ids.
  const ACTION_TRAIN_START = "_RwWTk";
  const ACTION_FLEX_UNLOCK = "q4GQkU";
  const ACTION_TRAIN_END = "Ajwwje";
  const ACTION_ATLAS_PAY_PROMPT = "YGoPl5";
  const ACTION_ATLAS_PAY_PROMPT_2 = "isCXxq";
  const ACTION_ATLAS_REPLAY_TRAINING = "zwa0Ry";
  const ACTION_CHECKAL_FLEX = "pPaqOe";
  const ACTION_CHECKAL_FLEX_AGAIN = "7_PDqd";
  const ACTION_BURNTOF_DRINK = "vaTm6G";
  const ACTION_BURNTOF_DRINK_AGAIN = "EW_TIu";
  const ACTION_RPS_START = "Lv8k9i";
  const ACTION_RPS_ROUND_1 = "yRUinL";
  const ACTION_RPS_ROUND_2 = "jyevbC";
  const ACTION_RPS_ROUND_3 = "QWyd4M";
  const ACTION_RPS_CHEAT = "OMpRy5";
  const ACTION_RPS_TINA = "wuLdBo";
  const ACTION_RPS_END = "CU6FG0";
  const ACTION_MARLEY_HANDOVER = "jgz4nU";
  const ACTION_CUTSCENE_BEGIN = "fOQUgc";
  const ACTION_CUTSCENE_INSIDE = "1Pscfp";
  const ACTION_GUARDIAN_WAKES = "wWX1Ws";
  const ACTION_CUTSCENE_END = "6g-zlD";
  const ACTION_BAG_RUMMAGE = "zy3NHn";
  const ACTION_DOORS_OPEN = "D1Y7Rh";
  const ACTION_RAMARNO_DEPARTS = "i5wpmS";
  // Mid-scene markers whose branch should simply carry on.
  const BRANCH_CONTINUE_IDS = new Set(["W0vwlg", "KNloP7", "_siJEW"]);
  const DIALOGUE_STEP_IDS = new Set([
    ACTION_TRAIN_START,
    ACTION_FLEX_UNLOCK,
    ACTION_TRAIN_END,
    ACTION_ATLAS_PAY_PROMPT,
    ACTION_ATLAS_PAY_PROMPT_2,
    ACTION_ATLAS_REPLAY_TRAINING,
    ACTION_CHECKAL_FLEX,
    ACTION_CHECKAL_FLEX_AGAIN,
    ACTION_BURNTOF_DRINK,
    ACTION_BURNTOF_DRINK_AGAIN,
    ACTION_RPS_START,
    ACTION_RPS_ROUND_1,
    ACTION_RPS_ROUND_2,
    ACTION_RPS_ROUND_3,
    ACTION_RPS_CHEAT,
    ACTION_RPS_TINA,
    ACTION_RPS_END,
    ACTION_MARLEY_HANDOVER,
    ACTION_CUTSCENE_BEGIN,
    ACTION_CUTSCENE_INSIDE,
    ACTION_GUARDIAN_WAKES,
    ACTION_CUTSCENE_END,
    ACTION_BAG_RUMMAGE,
    ACTION_DOORS_OPEN,
    ACTION_RAMARNO_DEPARTS,
    "tVCp4g", "eFwiMS", "Gu5UTk", "SISipN", "mjLSh6", "bR-g2A", "JSFicf", "_xHt7N", "RDp8vn", "9cN7I_", "yEp2qP", "bxSVrN",
    ...BRANCH_CONTINUE_IDS,
  ]);

  // Tiles (npc-spawns.json coordinates and dump-loc.ts placements).
  const CHECKAL_TILE = { x: 3087, y: 3415 };
  const ENTRANCE_ARRIVAL_TILE = { x: 2996, y: 3494 };
  const RUINS_ARRIVAL_TILE = { x: 2951, y: 5770 };
  const PILLAR_TILES = [
    { x: 2947, y: 5771, face: 3 },
    { x: 2947, y: 5778, face: 3 },
    { x: 2958, y: 5771, face: 1 },
    { x: 2958, y: 5778, face: 1 },
  ];

  // Rock-paper-scissors: the transcript script has Burntof declare the player the
  // winner and the player "cheat" on the last round; the wiki fills the sign
  // placeholders per pick, so they are resolved from the stored pick.
  const BEATS = { Rock: "Paper", Paper: "Scissors", Scissors: "Rock" };
  const LOSES = { Rock: "Scissors", Paper: "Rock", Scissors: "Paper" };
  const RPS_SIGNS = new Set(Object.keys(BEATS));


  const guardians = new Map(); // player -> owner-only Ancient Guardian
  const rpsPicks = new WeakMap(); // player -> "Rock" | "Paper" | "Scissors"
  const arenas = new Map();
  const training = new Map();
  const mining = new WeakMap();
  const storyScenes = new Map();
  const offeredDrinks = new WeakMap();
  let quest;

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  function memberState(player, attribute) {
    const value = Number(player.getAttribute(attribute)) || 0;
    // Old saves used 1 for an errand and 2 for a recruit.
    if (value === 2) return MEMBER_RECRUITED;
    if (value === 1) {
      if (attribute === CHECKAL_ATTRIBUTE && attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE)) return 15;
      if (attribute === MARLEY_ATTRIBUTE && attrFlag(player, COOK_TALKED_ATTRIBUTE)) return 10;
      return MEMBER_IN_PROGRESS;
    }
    return value;
  }

  function setMemberState(player, attribute, value) {
    player.setAttribute(attribute, value);
    syncVariables(player);
  }

  function mainProgress(stage, player) {
    if (stage >= STAGE_COMPLETE) return 120;
    if (stage === STAGE_GUARDIAN_DEAD) return 40;
    if (stage === STAGE_GUARDIAN) return attrFlag(player, MAIN_PROGRESS_ATTRIBUTE) === 30 ? 30 : 35;
    if (stage === STAGE_RECRUITED) return attrFlag(player, MAIN_PROGRESS_ATTRIBUTE) === 25 ? 25 : 20;
    if (stage === STAGE_STARTED) {
      if ([CHECKAL_ATTRIBUTE, MARLEY_ATTRIBUTE, BURNTOF_ATTRIBUTE].some((key) => memberState(player, key) >= 40)) return 15;
      return attrFlag(player, MAIN_PROGRESS_ATTRIBUTE) || 10;
    }
    return 0;
  }

  function setMainProgress(player, value) {
    player.setAttribute(MAIN_PROGRESS_ATTRIBUTE, value);
    syncVariables(player);
  }

  function syncVariables(player) {
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(MAIN_VARBIT, mainProgress(stage, player));
    for (const [attribute, varbit] of [[MARLEY_ATTRIBUTE, MARLEY_VARBIT], [CHECKAL_ATTRIBUTE, CHECKAL_VARBIT], [BURNTOF_ATTRIBUTE, BURNTOF_VARBIT]]) {
      const value = stage >= STAGE_GUARDIAN ? mainProgress(stage, player) >= 35 ? 50 : 45 : memberState(player, attribute);
      sender.sendVarbit(varbit, value);
    }
    sender.sendVarbit(FLEX_VARBIT, attrFlag(player, FLEX_UNLOCKED_ATTRIBUTE) || attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE) > 0 ? 1 : 0);
    sender.sendVarbit(WORKOUT_VARBIT, Math.max(0, attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE) - 1));
    sender.sendVarbit(REWARD_VARBIT, stage >= STAGE_COMPLETE ? 1 : 0);
    sender.sendVarbit(RAMARNO_MOVED_VARBIT, attrFlag(player, MET_RAMARNO_ATTRIBUTE));
  }

  function attrFlag(player, attribute) {
    return Number(player.getAttribute(attribute)) || 0;
  }

  function setFlag(player, attribute, on = true) {
    player.setAttribute(attribute, on ? 1 : 0);
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function coins(player) {
    return player.getInventory().getAmount(COINS_ITEM_ID);
  }

  function hasAlcohol(player) {
    return ALCOHOL_ITEM_IDS.some((itemId) => held(player, itemId));
  }

  function takeAlcohol(player) {
    const preferred = offeredDrinks.get(player);
    offeredDrinks.delete(player);
    for (const itemId of preferred ? [preferred, ...ALCOHOL_ITEM_IDS.filter((id) => id !== preferred)] : ALCOHOL_ITEM_IDS) {
      if (held(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        return itemId;
      }
    }
    return false;
  }

  function strengthLevel(player) {
    return player.getSkillManager().getCurrentLevel(Skill.STRENGTH);
  }

  function allRecruited(player) {
    return memberState(player, CHECKAL_ATTRIBUTE) >= MEMBER_RECRUITED
      && memberState(player, MARLEY_ATTRIBUTE) >= MEMBER_RECRUITED
      && memberState(player, BURNTOF_ATTRIBUTE) >= MEMBER_RECRUITED;
  }

  /**
   * The last/not-last lines are resolved before the speaker's own state moves to
   * 40, so ask whether everyone *else* is already recruited.
   */
  function finalRecruit(player, npcId) {
    const current = npcId === CHECKAL_NPC_ID ? CHECKAL_ATTRIBUTE
      : npcId === MARLEY_NPC_ID ? MARLEY_ATTRIBUTE
      : npcId === BURNTOF_NPC_ID || npcId === BURNTOF_2_NPC_ID ? BURNTOF_ATTRIBUTE
      : null;
    if (!current) return false;
    return [CHECKAL_ATTRIBUTE, MARLEY_ATTRIBUTE, BURNTOF_ATTRIBUTE]
      .every((attribute) => attribute === current || memberState(player, attribute) >= MEMBER_RECRUITED);
  }

  function moveTo(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, 0));
  }

  function resetQuestState(player) {
    setMemberState(player, CHECKAL_ATTRIBUTE, MEMBER_NONE);
    setMemberState(player, MARLEY_ATTRIBUTE, MEMBER_NONE);
    setMemberState(player, BURNTOF_ATTRIBUTE, MEMBER_NONE);
    setFlag(player, BURNTOF_ASKED_ATTRIBUTE, false);
    setFlag(player, ATLAS_DECLINED_ATTRIBUTE, false);
    setFlag(player, COOK_TALKED_ATTRIBUTE, false);
    setFlag(player, SANDWICH_MADE_ATTRIBUTE, false);
    setFlag(player, MET_RAMARNO_ATTRIBUTE, false);
    player.setAttribute(ATLAS_SESSIONS_ATTRIBUTE, 0);
    player.setAttribute(PILLARS_MINED_ATTRIBUTE, 0);
  }

  /** Third recruit in: the story moves to the ruins entrance. */
  function checkAllRecruited(player) {
    syncVariables(player);
    if (quest.getStage(player) === STAGE_STARTED && allRecruited(player)) {
      quest.setStage(player, STAGE_RECRUITED);
    }
  }

  // ==========================================================================
  // Transcript variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (!DIALOGUE_NPC_IDS.has(npcId)) return null;
    if (npcId === WILLOW_NPC_ID) return selectWillowVariant(player);
    if (npcId === MARLEY_NPC_ID) return selectMarleyVariant(player);
    if (npcId === CHECKAL_NPC_ID) return selectCheckalVariant(player);
    if (npcId === ATLAS_NPC_ID) return selectAtlasVariant(player);
    if (npcId === BURNTOF_NPC_ID || npcId === BURNTOF_2_NPC_ID) return selectBurntofVariant(player);
    if (npcId === COOK_NPC_ID) return selectCookVariant(player);
    if (npcId === CHARLIE_NPC_ID) return selectCharlieVariant(player);
    if (RAMARNO_NPC_IDS.has(npcId)) return selectRamarnoVariant(player);
    return null;
  }

  function selectWillowVariant(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return "willow-the-archaeologist-talking-to-willow";
    if (stage === STAGE_STARTED) return mainProgress(stage, player) < 10
      ? "willow-the-archaeologist-talking-to-willow" : "willow-the-archaeologist-talking-to-willow-again";
    if (stage === STAGE_RECRUITED) return mainProgress(stage, player) === 25
      ? "the-ruins-of-camdozaal-talking-to-willow-talking-to-willow-again-if-the-player-chose-no"
      : "the-ruins-of-camdozaal-talking-to-willow";
    if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-willow";
    return null;
  }

  function selectMarleyVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-marley";
    const state = memberState(player, MARLEY_ATTRIBUTE);
    if (state === MEMBER_NONE) {
      return "marley-the-thief-talking-to-marley";
    }
    if (state < MEMBER_RECRUITED && held(player, STEAK_SANDWICH_ITEM_ID)) {
      return "marley-the-thief-returning-to-marley";
    }
    if (state === 35) return "marley-the-thief-returning-to-marley";
    if (state < MEMBER_RECRUITED) return "marley-the-thief-talking-to-marley-talking-to-marley-again";
    return "marley-the-thief-returning-to-marley-talking-to-marley-at-ice-mountain";
  }

  function selectCheckalVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-checkal";
    const state = memberState(player, CHECKAL_ATTRIBUTE);
    if (state === MEMBER_NONE) {
      return "checkal-the-strongman-talking-to-checkal";
    }
    if (state < MEMBER_RECRUITED) {
      if (state >= 20) return "checkal-the-strongman-talking-to-checkal-again-before-showing-muscles";
      if (state < 15 && !attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE)) return "checkal-the-strongman-talking-to-checkal-talking-to-checkal-again";
      return "checkal-the-strongman-talking-to-checkal-after-completing-atlas-training";
    }
    return "checkal-the-strongman-talking-to-checkal-again-before-showing-muscles-talking-to-checkal-at-ice-mountain";
  }

  function selectAtlasVariant(player) {
    const stage = quest.getStage(player);
    const sessions = attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE);
    if (stage >= STAGE_COMPLETE) {
      if (sessions === 0) return null;
      if (sessions === 1) return "after-the-completion-of-below-ice-mountain-first-workout";
      if (sessions === 2) return "after-the-completion-of-below-ice-mountain-second-workout";
      return "after-the-completion-of-below-ice-mountain-subsequent-workouts";
    }
    if (stage < STAGE_STARTED || memberState(player, CHECKAL_ATTRIBUTE) === MEMBER_NONE) return null;
    const checkal = memberState(player, CHECKAL_ATTRIBUTE);
    if (checkal < 15 && sessions === 0) {
      if (attrFlag(player, ATLAS_DECLINED_ATTRIBUTE)) {
        return "checkal-the-strongman-talking-to-atlas-again-if-the-player-said-no-to-training-session";
      }
      return "checkal-the-strongman-talking-to-atlas";
    }
    if (sessions <= 1) return "checkal-the-strongman-talking-to-atlas-again-after-first-training-session";
    if (sessions === 2) return "checkal-the-strongman-talking-to-atlas-again-after-second-training-session";
    return "checkal-the-strongman-subsequent-training-sessions";
  }

  function selectBurntofVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-burntof";
    const state = memberState(player, BURNTOF_ATTRIBUTE);
    if (state === MEMBER_NONE) {
      if (attrFlag(player, BURNTOF_ASKED_ATTRIBUTE)) {
        return "burntof-master-of-explosives-talking-to-burntof-again-before-he-gets-a-beer";
      }
      return "burntof-master-of-explosives-talking-to-burntof";
    }
    if (state < 10) return "burntof-master-of-explosives-talking-to-burntof-again-before-he-gets-a-beer";
    if (state < MEMBER_RECRUITED) return "burntof-master-of-explosives-rock-paper-scissors";
    return "burntof-master-of-explosives-talking-to-burntof-at-ice-mountain";
  }

  function selectCookVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
    if (memberState(player, MARLEY_ATTRIBUTE) < MEMBER_IN_PROGRESS || memberState(player, MARLEY_ATTRIBUTE) >= MEMBER_RECRUITED) return null;
    if (attrFlag(player, SANDWICH_MADE_ATTRIBUTE)) {
      return "marley-the-thief-making-the-steak-sandwich-talking-to-the-cook-after-managing-to-make-yourself-a-steak-sandwich";
    }
    if (attrFlag(player, COOK_TALKED_ATTRIBUTE)) {
      return "marley-the-thief-making-the-steak-sandwich-talking-to-the-cook-again";
    }
    return "marley-the-thief-making-the-steak-sandwich-talking-to-the-cook";
  }

  function selectCharlieVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
    return "marley-the-thief-talking-to-charlie-the-tramp";
  }

  function selectRamarnoVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_COMPLETE) return null;
    if (!attrFlag(player, MET_RAMARNO_ATTRIBUTE)) return "post-quest-dialogue-ramarno";
    return null; // Own "Ramarno" page: subsequent/forge dialogue.
  }

  /**
   * The world spawn 10702 resolves its clicks to 10685, so route both through the
   * quest variant selector before NpcDialogues takes them, and play through the
   * named 10684 chathead (10702 has no name for its speaker head). Before
   * completion and after meeting him (null) the generic "Ramarno" page plays,
   * exactly as it does for 10684.
   */
  function handleRamarnoTalk(event) {
    if (!RAMARNO_WORLD_NPC_IDS.has(event.npcId) || event.clickType !== 1) return;
    // Ramarno is also the Whisperer chapter's guide in Desert Treasure II.
    // Let that quest's named handler own the interaction while it is active;
    // otherwise this generic post-quest transcript consumes the click first.
    const dt2Stage = Number(event.player.getAttribute("quest.desert_treasure_ii.stage")) || 0;
    if (dt2Stage > 0 && dt2Stage < 12) return;
    const variant = selectRamarnoVariant(event.player);
    if (!variant) return;
    event.handled = true;
    startTranscript(api, event.player, RAMARNO_NPC_ID, PAGE, variant);
  }

  // ==========================================================================
  // Prose-condition answers
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (!DIALOGUE_NPC_IDS.has(npcId)) return null;
    switch (stepId) {
      case CONDITION_STRENGTH_99:
        return strengthLevel(player) >= 99;
      case CONDITION_STRENGTH_NOT_99:
        return strengthLevel(player) < 99;
      case CONDITION_ATLAS_HAS_COINS:
        return coins(player) >= 25000;
      case CONDITION_ATLAS_NO_COINS:
        return coins(player) < 25000;
      case CONDITION_NOT_LAST_RECRUIT:
      case CONDITION_BURNTOF_NOT_LAST:
      case CONDITION_MARLEY_NOT_LAST:
        return !finalRecruit(player, npcId);
      case CONDITION_LAST_RECRUIT:
      case CONDITION_BURNTOF_LAST:
      case CONDITION_MARLEY_LAST:
        return finalRecruit(player, npcId);
      case CONDITION_BURNTOF_NO_DRINK:
      case CONDITION_BURNTOF_NO_DRINK_AGAIN:
        return !hasAlcohol(player);
      case CONDITION_BURNTOF_HAS_DRINK:
      case CONDITION_BURNTOF_HAS_DRINK_AGAIN:
        return hasAlcohol(player);
      case CONDITION_BURNTOF_STOUT:
        return held(player, DWARVEN_STOUT_ITEM_ID);
      case CONDITION_BURNTOF_ALE:
        return held(player, ASGARNIAN_ALE_ITEM_ID);
      case CONDITION_BURNTOF_BOMB:
        return held(player, WIZARDS_MIND_BOMB_ITEM_ID);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Choice / line / action handling
  // ==========================================================================

  function normaliseOption(option) {
    return String(option ?? "").trim().toLowerCase().replace(/[.!]+$/, "");
  }

  function handleChoice({ player, npcId, option }) {
    const pick = normaliseOption(option);
    if (npcId === WILLOW_NPC_ID && pick === "yes" && quest.getStage(player) === 0) {
      if ((Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) < QUEST_POINTS_REQUIRED) return;
      resetQuestState(player);
      player.setAttribute(MAIN_PROGRESS_ATTRIBUTE, 5);
      quest.setStage(player, STAGE_STARTED);
      player.sendMessage("You've started a new quest: <col=081190>Below Ice Mountain</col>");
      return;
    }
    if (npcId === ATLAS_NPC_ID) {
      if (pick === "no" && memberState(player, CHECKAL_ATTRIBUTE) === MEMBER_IN_PROGRESS) {
        setFlag(player, ATLAS_DECLINED_ATTRIBUTE, true);
      }
      if (pick === "yes") setFlag(player, ATLAS_DECLINED_ATTRIBUTE, false);
      return;
    }
    if ((npcId === BURNTOF_NPC_ID || npcId === BURNTOF_2_NPC_ID)) {
      const sign = pick.charAt(0).toUpperCase() + pick.slice(1);
      if (RPS_SIGNS.has(sign)) rpsPicks.set(player, sign);
    }
  }

  function statement(player, text) {
    const chain = new DialogueChainBuilder();
    chain.add(new StatementDialogue(0, text));
    player.getDialogueManager().startDialogues(chain);
  }

  function handleWillowTalk(event) {
    const { player } = event;
    if (quest.getStage(player) === STAGE_RECRUITED && mainProgress(STAGE_RECRUITED, player) === 25) {
      event.handled = true;
      startTranscript(api, player, WILLOW_NPC_ID, PAGE, ENTRANCE_VARIANT, (steps) => [
        { type: "line", speaker: "Willow", text: "Are you finally ready to crack these ruins open?" }, steps.at(-1),
      ]);
      return true;
    }
    if (quest.getStage(player) !== 0 || (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= QUEST_POINTS_REQUIRED) return false;
    player.sendMessage("You need 16 Quest points to start Below Ice Mountain.");
    event.handled = true;
    return true;
  }

  function handleAtlasTalk(event) {
    const { player } = event;
    const variant = selectAtlasVariant(player);
    if (!variant) return false;
    event.handled = true;
    return startTranscript(api, player, ATLAS_NPC_ID, PAGE, variant);
  }

  function handleStageChanged({ player, key }) {
    if (key === "below_ice_mountain") syncVariables(player);
  }

  function handleFlex({ player, sequence }) {
    if (sequence !== FLEX_ANIMATION_ID && sequence !== 12064) return;
    if (!attrFlag(player, CHECKAL_PROMPT_ATTRIBUTE)) return;
    if (quest.getStage(player) !== STAGE_STARTED || memberState(player, CHECKAL_ATTRIBUTE) !== 20) return;
    const tile = player.getLocation();
    if (tile.getZ() !== 0 || Math.max(Math.abs(tile.getX() - CHECKAL_TILE.x), Math.abs(tile.getY() - CHECKAL_TILE.y)) > 3) return;
    setFlag(player, CHECKAL_PROMPT_ATTRIBUTE, false);
    TaskManager.submit(new CountdownTask(player, 3, () => {
      if (player.isRegistered?.() === false || memberState(player, CHECKAL_ATTRIBUTE) !== 20) return;
      startTranscript(api, player, CHECKAL_NPC_ID, PAGE,
        "checkal-the-strongman-talking-to-checkal-after-completing-atlas-training",
        (steps) => steps.slice(5));
    }));
  }

  function handleRewardClosed({ player, interfaceId }) {
    if (interfaceId !== 153 || !quest.isComplete(player) || !attrFlag(player, REWARD_PENDING_ATTRIBUTE) || attrFlag(player, MET_RAMARNO_ATTRIBUTE)) return;
    setFlag(player, REWARD_PENDING_ATTRIBUTE, false);
    startTranscript(api, player, RAMARNO_NPC_ID, PAGE, "post-quest-dialogue-ramarno");
    return true;
  }

  class TrainingScene extends TemplatedInstanceArea {
    constructor(player, name = "Barbarian Workout", sourcePlane = 0) {
      super(12, 13);
      this.owner = player;
      this.sceneName = name;
      this.sourcePlane = sourcePlane;
      this.originX = 3200;
      this.originY = 3384;
    }
    getName() { return this.sceneName; }
    sourceTile(x, y) { return this.tile(x - this.originX, y - this.originY, this.sourcePlane); }
    setSource(origin) {
      if (this.originX === origin[0] && this.originY === origin[1] && this.loaded) return;
      this.originX = origin[0]; this.originY = origin[1]; this.loaded = true;
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 13; y++) this.setChunk(this.sourcePlane, x, y, {
          sourceChunkX: this.originX / 8 + x, sourceChunkY: this.originY / 8 + y, sourcePlane: this.sourcePlane, rotation: 0,
        });
      }
    }
    canTeleport() { return false; }
    canAttack() { return false; }
    postLeave(actor, logout) {
      super.postLeave(actor, logout);
      if (actor === this.owner) {
        if (training.get(actor) === this) training.delete(actor);
        if (storyScenes.get(actor) === this) storyScenes.delete(actor);
        actor.getMovementQueue().setBlockMovement(false);
        actor.setUntargetable(false);
        actor.getPacketSender().closeSubInterface(FADE_TARGET_UID);
      }
    }
    destroy() {
      if (this.isDestroyed()) return;
      for (const actor of [...this.entities]) if (actor.isNpc?.()) api.removeNpc(actor);
      super.destroy();
    }
  }

  function sceneActor(player, scene, id, x, y, face) {
    const tile = scene.sourceTile(x, y);
    const actor = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: scene.sourcePlane ?? 0, face, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (actor) scene.add(actor);
    return actor;
  }

  function sceneCamera(player, scene, camera, look) {
    const sender = player.getPacketSender();
    if (camera) {
      const tile = scene.sourceTile(camera[0], camera[1]);
      sender.sendCameraMoveTo(tile.getX(), tile.getY(), camera[2], { rate: camera[3] ?? 232, rate2: camera[4] ?? 232 });
    }
    if (look) {
      const tile = scene.sourceTile(look[0], look[1]);
      sender.sendCameraLookAt(tile.getX(), tile.getY(), look[2], { rate: look[3] ?? 232, rate2: look[4] ?? 232 });
    }
  }

  function sceneFade(player, out, cycles = 50) {
    player.getPacketSender().sendSubInterface(FADE_TARGET_UID, FADE_GROUP, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, cycles] : [0, 0, 0, 255, cycles] }],
    });
  }

  function transitionFade(player, scene, fadeInTick, fadeOutTick = 0) {
    if (fadeOutTick) sceneLater(player, scene, fadeOutTick, () => sceneFade(player, true));
    else sceneFade(player, true);
    sceneLater(player, scene, fadeInTick, () => sceneFade(player, false));
  }

  function sceneTail(steps, stepId) {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].id === stepId) return steps.slice(i + 1);
      for (const option of steps[i].options ?? []) {
        const found = sceneTail(option.steps ?? [], stepId);
        if (found) return found;
      }
      if (steps[i].steps) {
        const found = sceneTail(steps[i].steps, stepId);
        if (found) return found;
      }
    }
    return null;
  }

  function pauseSceneAction(event, variant, ticks, beforeResume, prefix = []) {
    const { player, npcId, stepId } = event;
    const area = player.getPrivateArea();
    player.getDialogueManager().reset();
    StatementDialogue.send(player, "", false);
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false || player.getPrivateArea() !== area) return;
      beforeResume?.();
      startTranscript(api, player, npcId, PAGE, variant, (steps) => [...prefix, ...(sceneTail(steps, stepId) ?? [])]);
    }));
    event.handled = true;
  }

  function startRpsScene(event) {
    const { player } = event;
    const scene = new TrainingScene(player, "Rock, paper, scissors", 1);
    scene.setSource([2944, 3360]);
    storyScenes.set(player, scene);
    player.setAttribute(STORY_SCENE_ATTRIBUTE, 1);
    scene.enter(player);
    player.moveTo(scene.sourceTile(2956, 3369));
    player.getMovementQueue().setBlockMovement(true);
    player.setUntargetable(true);
    scene.burntof = sceneActor(player, scene, NpcIdentifiers.BURNTOF_3, 2956, 3370);
    sceneLater(player, scene, 4, () => sceneCamera(player, scene, [2961, 3369, 400], [2955, 3369, 180]));
    transitionFade(player, scene, 4); // 900 fade out, 904 fade in, 905 first line.
    pauseSceneAction(event, "burntof-master-of-explosives-rock-paper-scissors", 5);
  }

  function endStoryScene(player, tile) {
    const scene = storyScenes.get(player);
    if (!scene) return;
    storyScenes.delete(player);
    player.setAttribute(STORY_SCENE_ATTRIBUTE, 0);
    player.setNpcTransformationId?.(-1);
    player.setForceMovement(null);
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    player.getPacketSender().sendCameraReset();
    moveTo(player, tile);
    scene.destroy();
  }

  const ENTRANCE_VARIANT = "the-ruins-of-camdozaal-talking-to-willow";

  function sourceObject(player, scene, id, x, y, face = 0, type = 10) {
    const object = new GameObject(id, scene.sourceTile(x, y), type, face, scene);
    ObjectManager.register(object, true);
    return object;
  }

  function sceneLater(player, scene, ticks, action) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() !== false && player.getPrivateArea() === scene) action();
    }));
  }

  function sceneRun(player, scene, x, y, ticks) {
    const start = player.getLocation().clone(), end = scene.sourceTile(x, y);
    const dx = end.getX() - start.getX(), dy = end.getY() - start.getY();
    const direction = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 0 : 2;
    TaskManager.submit(new ForceMovementTask(player, ticks, new ForceMovement(start,
      new Location(dx, dy, 0), 0, ticks * 30, direction, 824)));
  }

  function startEntranceScene(event) {
    const { player } = event;
    const scene = new TrainingScene(player, "Opening Camdozaal");
    scene.setSource([2976, 3472]);
    storyScenes.set(player, scene);
    player.setAttribute(STORY_SCENE_ATTRIBUTE, 2);
    scene.enter(player);
    player.moveTo(scene.sourceTile(2995, 3495));
    player.getMovementQueue().setBlockMovement(true);
    player.setUntargetable(true);
    scene.crew = [sceneActor(player, scene, NpcIdentifiers.CHECKAL_2, 2994, 3494), sceneActor(player, scene, NpcIdentifiers.BURNTOF_3, 2996, 3492),
      sceneActor(player, scene, NpcIdentifiers.WILLOW_2, 2997, 3494), sceneActor(player, scene, NpcIdentifiers.MARLEY_2, 2996, 3496)];
    sceneLater(player, scene, 4, () => sceneCamera(player, scene, [2990, 3490, 600], [2997, 3494, 400]));
    transitionFade(player, scene, 4); // 1940 out, 1944 in, 1946 Willow.
    pauseSceneAction(event, ENTRANCE_VARIANT, 6);
  }

  function handleEntranceSceneAction(event) {
    const { player, stepId } = event;
    const scene = storyScenes.get(player);
    if (!scene) return false;
    event.handled = true;
    if (stepId === "tVCp4g") {
      sceneLater(player, scene, 8, () => sceneCamera(player, scene, [2989, 3501, 700], [2997, 3494, 350]));
      player.getPacketSender().sendSound(4980, 1, 0);
      sceneLater(player, scene, 6, () => sceneFade(player, true, 15)); // 1953 run, 1959 fade, 1961 line.
      pauseSceneAction(event, ENTRANCE_VARIANT, 8);
    } else if (stepId === "eFwiMS") {
      player.getPacketSender().sendSound(4977, 1, 0);
      sceneFade(player, false); // 1967, then Burntof speaks at 1970.
      pauseSceneAction(event, ENTRANCE_VARIANT, 3);
    } else if (stepId === "Gu5UTk") {
      sceneRun(player, scene, 2991, 3501, 4);
      player.getPacketSender().sendSound(4973, 1, 0);
      sceneLater(player, scene, 2, () => sceneCamera(player, scene, [2991, 3500, 800, 1, 1], [2997, 3494, 400]));
      sceneLater(player, scene, 6, () => {
        player.getPacketSender().sendCameraShake(0, 75);
        scene.explosion = sourceObject(player, scene, EXPLOSION_OBJECT_ID, 2998, 3493);
      });
      sceneLater(player, scene, 13, () => {
        if (scene.explosion) ObjectManager.deregister(scene.explosion, true);
      });
      transitionFade(player, scene, 16, 11); // 1977 run, 1988 out, 1993 in, 1995 line.
      sceneLater(player, scene, 16, () => {
        player.getPacketSender().sendCameraReset();
        sceneCamera(player, scene, [2990, 3490, 600], [2997, 3494, 400]);
      });
      pauseSceneAction(event, ENTRANCE_VARIANT, 18, () => {
        player.moveTo(scene.sourceTile(2996, 3496));
        sourceObject(player, scene, ObjectIdentifiers.RUINS_ENTRANCE_2, 2999, 3493, 1);
        scene.rubble = sourceObject(player, scene, ObjectIdentifiers.RUBBLE_52, 2998, 3493, 1);
      });
    } else if (stepId === "SISipN") {
      sceneLater(player, scene, 14, () => sceneFade(player, true, 15)); // 2002 work, 2016 fade, 2018 box.
      pauseSceneAction(event, ENTRANCE_VARIANT, 16);
    } else if (stepId === "mjLSh6") {
      event.steps = [{ type: "message", text: "Checkal sets to work clearing out the rubble...", id: "below-ice-mountain:statement" }];
    } else if (stepId === "bR-g2A") {
      sceneLater(player, scene, 1, () => sceneFade(player, false)); // Continue 2022, in 2023, line 2024.
      pauseSceneAction(event, ENTRANCE_VARIANT, 2, () => {
        if (scene.rubble) ObjectManager.deregister(scene.rubble, true);
      });
    } else if (stepId === "JSFicf") {
      for (const actor of scene.crew ?? []) api.removeNpc(actor);
      scene.setSource([2944, 5760]);
      player.setNpcTransformationId?.(NpcIdentifiers.MARLEY_2);
      player.moveTo(scene.sourceTile(2952, 5763));
      scene.tripwires = [sourceObject(player, scene, ObjectIdentifiers.TRIPWIRE_4, 2952, 5766), sourceObject(player, scene, ObjectIdentifiers.TRIPWIRE_4, 2953, 5766)];
      sceneLater(player, scene, 3, () => sceneCamera(player, scene, [2954, 5771, 500], [2952, 5764, 250]));
      transitionFade(player, scene, 3); // 2029 out, 2032 in, 2034 Marley.
      pauseSceneAction(event, ENTRANCE_VARIANT, 5);
    } else if (stepId === "_xHt7N") {
      player.performAnimation(new Animation(827));
      player.getPacketSender().sendSound(4981, 1, 0);
      pauseSceneAction(event, ENTRANCE_VARIANT, 1);
    } else if (stepId === "RDp8vn") {
      sceneRun(player, scene, 2952, 5767, 3);
      pauseSceneAction(event, ENTRANCE_VARIANT, 3);
    } else if (stepId === "9cN7I_") {
      const burntof = scene.crew?.[0];
      burntof?.getMovementQueue?.().addFirstStep(scene.sourceTile(2953, 5775));
      player.getPacketSender().sendSound(2400, 1, 0);
    } else if (stepId === "yEp2qP") {
      player.getPacketSender().sendCameraShake(0, 50);
      player.getPacketSender().sendSound(4988, 1, 0);
      for (const [x, y, delay] of [[2950, 5775, 50], [2950, 5772, 90], [2957, 5772, 160], [2956, 5776, 0], [2953, 5777, 180]]) {
        const graphic = new Graphic(ROCK_FALL_GRAPHIC_ID);
        graphic.delay = delay;
        player.getPacketSender().sendGraphic(graphic, scene.sourceTile(x, y));
      }
      sceneLater(player, scene, 4, () => player.getPacketSender().sendCameraShake(0, 20));
      sceneLater(player, scene, 9, () => player.getPacketSender().sendCameraShake(0, 5));
      pauseSceneAction(event, ENTRANCE_VARIANT, 8);
    } else if (stepId === "bxSVrN") {
      player.getPacketSender().sendCameraReset();
      sceneCamera(player, scene, [2946, 5768, 700], [2953, 5774, 100]);
    } else return false;
    return true;
  }

  function trainingAction(player, scene, event) {
    if (training.get(player) !== scene || player.isRegistered?.() === false) return;
    if (event.origin) {
      for (const actor of scene.getNpcs()) api.removeNpc(actor);
      scene.workoutActors.clear();
      scene.setSource(event.origin);
    }
    if (event.position) {
      player.setForceMovement(null);
      player.moveTo(scene.sourceTile(...event.position));
    }
    if (event.actor) {
      const cue = event.actor;
      let actor = scene.workoutActors.get(cue.key);
      if (cue.remove && actor) {
        api.removeNpc(actor);
        scene.workoutActors.delete(cue.key);
      } else {
        if (cue.id !== undefined) {
          if (actor) api.removeNpc(actor);
          actor = sceneActor(player, scene, cue.id, ...cue.position, cue.face);
          if (actor) scene.workoutActors.set(cue.key, actor);
        } else if (actor && cue.position) actor.moveTo(scene.sourceTile(...cue.position));
        if (actor && cue.walk) actor.getMovementQueue().addFirstStep(scene.sourceTile(...cue.walk));
        if (actor && cue.animation !== undefined) actor.performAnimation(new Animation(cue.animation));
        if (actor && cue.chat !== undefined) actor.forceChat(cue.chat);
        if (actor && cue.graphic) actor.performGraphic(new Graphic(cue.graphic[0], 0, cue.graphic[1]));
      }
    }
    if (event.cameraReset) player.getPacketSender().sendCameraReset();
    if (event.fade) player.getPacketSender().sendSubInterface(FADE_TARGET_UID, FADE_GROUP, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: event.fade }],
    });
    if (event.clearDialogue) {
      player.getDialogueManager().reset();
      StatementDialogue.send(player, "", false);
    }
    if (event.tileGraphic) {
      const cue = event.tileGraphic, graphic = new Graphic(cue.id);
      graphic.delay = cue.delay;
      player.getPacketSender().sendGraphic(graphic, scene.sourceTile(...cue.position));
    }
    if (event.projectile) {
      const cue = event.projectile;
      player.getPacketSender().sendProjectile(scene.sourceTile(...cue.source), scene.sourceTile(...cue.target),
        0, cue.end, cue.id, cue.startHeight, cue.endHeight, null, cue.start, cue.angle, cue.progress);
    }
    for (const [id, delay] of event.sounds ?? []) player.getPacketSender().sendSound(id, 1, delay);
    if (event.animation !== undefined) player.performAnimation(new Animation(event.animation));
    if (event.walk) {
      const [x, y, ticks] = event.walk;
      const tile = scene.sourceTile(x, y);
      const start = player.getLocation().clone();
      const dx = tile.getX() - start.getX(), dy = tile.getY() - start.getY();
      const direction = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 0 : 2;
      TaskManager.submit(new ForceMovementTask(player, ticks, new ForceMovement(
        start, new Location(dx, dy, 0), 0, ticks * 30, direction, 824
      )));
    }
    if (event.camera) {
      const [x, y, height, rate, rate2] = event.camera;
      const tile = scene.sourceTile(x, y);
      player.getPacketSender().sendCameraMoveTo(tile.getX(), tile.getY(), height, { rate, rate2 });
    }
    if (event.look) {
      const [x, y, height, rate, rate2] = event.look;
      const tile = scene.sourceTile(x, y);
      player.getPacketSender().sendCameraLookAt(tile.getX(), tile.getY(), height, { rate, rate2 });
    }
    if (event.line !== undefined) {
      const steps = require("../QuestRuntime").loadTranscripts(api)[PAGE].variants["checkal-the-strongman-talking-to-atlas"];
      const line = steps.at(-1).options[0].steps[event.line];
      const text = String(line.text).replaceAll("[strongman/strongwoman]", player.getAppearance?.().isMale?.() === false ? "strongwoman" : "strongman");
      const chain = new DialogueChainBuilder();
      chain.add(new NpcDialogue(0, ATLAS_NPC_ID, text));
      player.getDialogueManager().startDialogues(chain);
      player.getPacketSender().sendInterfaceFlagsRange((231 << 16) | 5, -1, -1, 0);
    }
  }

  function startTraining(player) {
    if (training.has(player)) return;
    const scene = new TrainingScene(player);
    scene.workoutActors = new Map();
    scene.setSource([3200, 3384]);
    training.set(player, scene);
    player.setAttribute(TRAINING_ATTRIBUTE, 1);
    scene.enter(player);
    player.moveTo(scene.sourceTile(3253, 3393));
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setUntargetable(true);
    player.getPacketSender().sendInterfaceRemoval();
    api.emitCustomEvent("music:unlock-track", { player, trackId: 689 });
    player.getPacketSender().sendSong(689);
    for (const event of SCENES.workout) {
      TaskManager.submit(new CountdownTask(player, Math.max(1, event.tick), () => trainingAction(player, scene, event)));
    }
    TaskManager.submit(new CountdownTask(player, 206, () => {
      if (training.get(player) !== scene || player.isRegistered?.() === false) return;
      if (memberState(player, CHECKAL_ATTRIBUTE) < 15) setMemberState(player, CHECKAL_ATTRIBUTE, 15);
      setFlag(player, FLEX_UNLOCKED_ATTRIBUTE, true);
      player.setAttribute(ATLAS_SESSIONS_ATTRIBUTE, Math.min(attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE) + 1, 65536));
      setFlag(player, ATLAS_DECLINED_ATTRIBUTE, false);
      syncVariables(player);
      startTranscript(api, player, ATLAS_NPC_ID, PAGE, "checkal-the-strongman-talking-to-atlas",
        (steps) => steps.at(-1).options[0].steps.slice(7));
    }));
  }

  function stopTraining(player, returnToHall) {
    const scene = training.get(player);
    if (!scene) return;
    training.delete(player);
    player.setAttribute(TRAINING_ATTRIBUTE, 0);
    player.setForceMovement(null);
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    player.getPacketSender().sendCameraReset();
    player.getPacketSender().closeSubInterface(FADE_TARGET_UID);
    for (const npc of scene.getNpcs()) api.removeNpc(npc);
    if (returnToHall) moveTo(player, { x: 3075, y: 3440 });
    scene.destroy();
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    const after = (action) => { event.after = action; };
    const scene = storyScenes.get(player) ?? arenas.get(player);
    if (scene) {
      if (text === "Right, let's see what hidden surprises you have in store for me.") after(() => {
        sceneCamera(player, scene, null, [2952, 5764, 250, 1, 1]);
        sceneCamera(player, scene, [2954, 5772, 500, 1, 1]);
      });
      if (text === "That would have been nasty.") after(() => sceneLater(player, scene, 1, () => {
        sceneCamera(player, scene, null, [2952, 5766, 250, 1, 1]);
        sceneCamera(player, scene, [2954, 5773, 500, 1, 1]);
      }));
      if (text === "You're impressed? There's nothing here but dust and fallen rocks.") event.before = () => {
        sceneLater(player, scene, 2, () => sceneCamera(player, scene, [2959, 5768, 800, 2, 2]));
      };
      if (text.startsWith("It's not about the money though, right?")) event.before = () => {
        sceneCamera(player, scene, [2952, 5763, 800, 2, 2], [2952, 5773, 70, 1, 1]);
      };
      if (text === "What was that noise?") event.before = () => {
        sceneCamera(player, scene, [2946, 5768, 700, 5, 5], [2953, 5774, 100, 5, 5]);
      };
      if (text === "What the!") after(() => sceneLater(player, scene, 1, () => {
        sceneCamera(player, scene, [2955, 5772, 450, 2, 2], [2952, 5778, 250, 5, 5]);
      }));
    }
    if (npcId === WILLOW_NPC_ID) {
      if (text === "What happened?" && quest.getStage(player) === STAGE_STARTED && mainProgress(STAGE_STARTED, player) < 7) after(() => setMainProgress(player, 7));
      if (text.startsWith("I have no idea where he is these days") && quest.getStage(player) === STAGE_STARTED) after(() => setMainProgress(player, 10));
      if (text.startsWith("Exactly. So who are you to judge?")) after(() => setMainProgress(player, 25));
    }
    if (npcId === CHECKAL_NPC_ID) {
      if (text.startsWith("If you can survive his rigorous")) after(() => setMemberState(player, CHECKAL_ATTRIBUTE, 5));
      if (text === "Thank you my friend, I will meet you there.") after(() => {
        setMemberState(player, CHECKAL_ATTRIBUTE, 40); checkAllRecruited(player);
      });
    }
    if (npcId === ATLAS_NPC_ID && text === "My work is done. Return to Checkal and show him your new-found muscles.") after(() => stopTraining(player, true));
    if (npcId === ATLAS_NPC_ID && text === "That's a lot of money!") after(() => setMemberState(player, CHECKAL_ATTRIBUTE, 10));
    if (text === "I can't believe they ran so quickly. I suppose I should take care of this thing.") after(() => {
      const area = arenas.get(player);
      if (!area || quest.getStage(player) !== STAGE_GUARDIAN) return;
      for (const actor of area.crew ?? []) api.removeNpc(actor);
      if (area.awakening) api.removeNpc(area.awakening);
      sceneLater(player, area, 2, () => player.getPacketSender().sendCameraReset());
      sceneLater(player, area, 5, () => {
        storyScenes.delete(player);
        player.setAttribute(STORY_SCENE_ATTRIBUTE, 0);
        player.setUntargetable(false);
        player.getMovementQueue().setBlockMovement(false);
        sceneFade(player, false);
        spawnGuardian(player)?.getCombat?.().attack(player);
      });
    });
    if (npcId === MARLEY_NPC_ID) {
      if (text.startsWith("Don't be like that!")) after(() => setMemberState(player, MARLEY_ATTRIBUTE, 5));
      if (text === "Excellent! I'll be on my way then.") after(() => {
        setMemberState(player, MARLEY_ATTRIBUTE, 40); checkAllRecruited(player);
      });
      if (memberState(player, MARLEY_ATTRIBUTE) === 35 && ["Hey Marley. I've managed to get your Steak sandwich.", "Ah, just in time for my afternoon snack. Pass it over."].includes(text)) event.skip = true;
    }
    if (npcId === COOK_NPC_ID && text.startsWith("Then, you take some bread.")) after(() => {
      setFlag(player, COOK_TALKED_ATTRIBUTE, true); setMemberState(player, MARLEY_ATTRIBUTE, 10);
    });
    if (npcId === BURNTOF_NPC_ID || npcId === BURNTOF_2_NPC_ID) {
      if (text === "Are you Burntof?") after(() => {
        setFlag(player, BURNTOF_ASKED_ATTRIBUTE, true); setMemberState(player, BURNTOF_ATTRIBUTE, 5);
      });
      if (text.includes("have the game upshtairs away from everyone.")) after(() => startTranscript(api, player, BURNTOF_NPC_ID, PAGE, "burntof-master-of-explosives-rock-paper-scissors"));
      if (text === "Hmmm... *hic*") after(() => setMemberState(player, BURNTOF_ATTRIBUTE, 15));
      if (text === "Are you okay Burntof? I clearly beat you. Check my hand again.") after(() => {
        setMemberState(player, BURNTOF_ATTRIBUTE, 40); checkAllRecruited(player);
      });
    }
    if (RAMARNO_NPC_IDS.has(npcId) && text === "Bless my beard..." && quest.getStage(player) === STAGE_GUARDIAN_DEAD) after(() => {
      const area = arenas.get(player);
      transitionFade(player, area, 8, 3); // Resume 2245, out 2248, reset 2250, complete/in 2253.
      sceneLater(player, area, 5, () => player.getPacketSender().sendCameraReset());
      TaskManager.submit(new CountdownTask(player, 8, () => {
        if (quest.getStage(player) !== STAGE_GUARDIAN_DEAD || player.getPrivateArea() !== area) return;
        moveTo(player, { x: 2950, y: 5769 });
        area?.destroy();
        player.getMovementQueue().setBlockMovement(false);
        player.setUntargetable(false);
        quest.complete(player);
      }));
    });
    if (RAMARNO_NPC_IDS.has(npcId) && text.startsWith("The player will automatically speak")) {
      event.skip = true;
      return;
    }
    if (npcId === ATLAS_NPC_ID && text.includes("[times done]")) {
      event.text = text.replace("[times done]", String(attrFlag(player, ATLAS_SESSIONS_ATTRIBUTE)));
    }
    // Burntof's RPS lines carry "[chosen sign]"-style blanks; fill them too.
    event.text = fillRpsSigns(player, event.text);
  }

  function fillRpsSigns(player, text) {
    const pick = rpsPicks.get(player) ?? "Rock";
    // The first/last rounds show the winning sign; the second shows the losing sign.
    const burntofs = BEATS[pick];
    return String(text)
      .replace(/\[winning sign\]/g, BEATS[pick].toLowerCase())
      .replace(/\[losing sign\]/g, LOSES[pick].toLowerCase())
      .replace(/\[chosen sign\]/g, pick.toLowerCase())
      .replace(/\[sign that gets beaten by Burntof's\]/g, LOSES[LOSES[pick]].toLowerCase())
      .replace(/\[sign that beats Burntof's\]/g, BEATS[burntofs].toLowerCase());
  }

  /** Fires for every quest step, scoped by the step ids on this quest's page. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === "below-ice-mountain:statement") {
      event.handled = true; event.box = { statement: true }; return;
    }
    if (stepId === "below-ice-mountain:coins-found") {
      event.handled = true; event.box = { items: [COINS_ITEM_ID] }; return;
    }
    if (stepId === "below-ice-mountain:sandwich") {
      event.handled = true; event.box = { items: [STEAK_SANDWICH_ITEM_ID] }; return;
    }
    if (typeof stepId !== "string" || !DIALOGUE_STEP_IDS.has(stepId)) return;
    if (stepId === ACTION_CHECKAL_FLEX || stepId === ACTION_CHECKAL_FLEX_AGAIN) {
      if (npcId !== CHECKAL_NPC_ID || memberState(player, CHECKAL_ATTRIBUTE) < 15) return;
      event.handled = true;
      event.end = true;
      setMemberState(player, CHECKAL_ATTRIBUTE, 20);
      setFlag(player, CHECKAL_PROMPT_ATTRIBUTE, true);
      statement(player, "Show your strength by <col=ef1020>flexing</col> your muscles.");
      return;
    }
    if (stepId === ACTION_TRAIN_START) {
      event.handled = true;
      startTraining(player);
      return;
    }
    if (stepId === ACTION_FLEX_UNLOCK) {
      event.handled = true;
      setFlag(player, FLEX_UNLOCKED_ATTRIBUTE, true);
      syncVariables(player);
      player.performAnimation(new Animation(FLEX_ANIMATION_ID));
      event.steps = [{ type: "message", text: "You have unlocked the <col=ef1020>flex</col> emote!", id: "below-ice-mountain:statement" }];
      return;
    }
    if (stepId === ACTION_TRAIN_END) {
      event.handled = true;
      return;
    }
    if (stepId === ACTION_ATLAS_PAY_PROMPT || stepId === ACTION_ATLAS_PAY_PROMPT_2) {
      event.handled = true; // The following Yes/No menu is the real prompt.
      return;
    }
    if (stepId === ACTION_ATLAS_REPLAY_TRAINING) {
      event.handled = true;
      if (!held(player, COINS_ITEM_ID, 25000)) return;
      player.getInventory().deleteNumber(COINS_ITEM_ID, 25000);
      startTraining(player);
      return;
    }
    if (stepId === ACTION_BURNTOF_DRINK || stepId === ACTION_BURNTOF_DRINK_AGAIN) {
      if (npcId !== BURNTOF_NPC_ID && npcId !== BURNTOF_2_NPC_ID) return;
      event.handled = true;
      const drink = takeAlcohol(player);
      if (!drink) { event.end = true; return; }
      setMemberState(player, BURNTOF_ATTRIBUTE, 10);
      startTranscript(api, player, BURNTOF_NPC_ID, PAGE, "burntof-master-of-explosives-talking-to-burntof", (steps) => {
        const tail = sceneTail(steps, ACTION_BURNTOF_DRINK);
        const remark = drink === DWARVEN_STOUT_ITEM_ID ? "Ah! A [lad/lass] of fhine taste *hic*. I love Dwarven shtout!"
          : drink === WIZARDS_MIND_BOMB_ITEM_ID ? "No messhing around with you! Only the strong stuff, I like it!" : "That'sh good shtuff.";
        return [{ type: "message", text: "You give Burntof the drink.", id: "below-ice-mountain:statement" }, { ...tail[0], text: remark }, ...tail.slice(1)];
      });
      return;
    }
    if (stepId === ACTION_RPS_START) {
      startRpsScene(event);
      return;
    }
    if (stepId === ACTION_RPS_TINA) {
      const scene = storyScenes.get(player);
      if (scene) {
        const tina = sceneActor(player, scene, NpcIdentifiers.TINA_2, 2956, 3373);
        tina?.getMovementQueue?.().addFirstStep(scene.sourceTile(2955, 3373));
        tina?.getMovementQueue?.().addSteps(scene.sourceTile(2955, 3371));
        tina?.getMovementQueue?.().addSteps(scene.sourceTile(2956, 3371));
      }
      pauseSceneAction(event, "burntof-master-of-explosives-rock-paper-scissors", 8);
      return;
    }
    if (stepId === ACTION_RPS_ROUND_1 || stepId === ACTION_RPS_ROUND_2 || stepId === ACTION_RPS_ROUND_3 || stepId === ACTION_RPS_CHEAT) {
      const scene = storyScenes.get(player);
      player.performAnimation(new Animation(8928));
      scene?.burntof?.performAnimation?.(new Animation(8921));
      const message = { type: "message", text: fillRpsSigns(player, event.text ?? ""), id: "below-ice-mountain:statement" };
      pauseSceneAction(event, "burntof-master-of-explosives-rock-paper-scissors", stepId === ACTION_RPS_CHEAT ? 2 : 5, null, [message]);
      return;
    }
    if (stepId === ACTION_RPS_END) {
      const scene = storyScenes.get(player);
      sceneLater(player, scene, 3, () => sceneFade(player, true));
      pauseSceneAction(event, "burntof-master-of-explosives-rock-paper-scissors", 8, () => {
        endStoryScene(player, { x: 2956, y: 3368 });
        sceneFade(player, false);
      }); // 976 departure, 979 out, 984 in and final line.
      return;
    }
    if (stepId === ACTION_MARLEY_HANDOVER) {
      if (npcId !== MARLEY_NPC_ID) return;
      event.handled = true;
      if (held(player, STEAK_SANDWICH_ITEM_ID)) {
        player.getInventory().deleteNumber(STEAK_SANDWICH_ITEM_ID, 1);
        setMemberState(player, MARLEY_ATTRIBUTE, 35);
        event.steps = [{ type: "message", text: "You give the steak sandwich to Marley.", id: "below-ice-mountain:sandwich" }];
      }
      return;
    }
    if (stepId === ACTION_CUTSCENE_BEGIN) {
      startEntranceScene(event);
      return;
    }
    if (handleEntranceSceneAction(event)) return;
    if (stepId === ACTION_CUTSCENE_INSIDE) {
      event.handled = true;
      const old = storyScenes.get(player);
      storyScenes.delete(player);
      player.setNpcTransformationId?.(-1);
      const arena = enterArena(player);
      storyScenes.set(player, arena);
      old?.destroy();
      player.moveTo(arena.sourceTile(2953, 5769));
      player.getMovementQueue().setBlockMovement(true);
      player.setUntargetable(true);
      arena.crew = [sceneActor(player, arena, NpcIdentifiers.BURNTOF_3, 2950, 5772), sceneActor(player, arena, NpcIdentifiers.CHECKAL_2, 2956, 5770),
        sceneActor(player, arena, NpcIdentifiers.MARLEY_2, 2952, 5772), sceneActor(player, arena, NpcIdentifiers.WILLOW_2, 2953, 5771)];
      sceneLater(player, arena, 3, () => sceneCamera(player, arena, [2952, 5761, 200], [2952, 5768, 50]));
      sceneLater(player, arena, 5, () => sceneCamera(player, arena, [2952, 5763, 800, 2, 2], [2952, 5771, 50, 1, 1]));
      if (quest.getStage(player) === STAGE_RECRUITED) quest.setStage(player, STAGE_GUARDIAN);
      setMainProgress(player, 30);
      api.emitCustomEvent("music:unlock-track", { player, trackId: 691 });
      player.getPacketSender().sendSong(691);
      transitionFade(player, arena, 5); // 2052 out, 2057 in, 2059 first line.
      pauseSceneAction(event, ENTRANCE_VARIANT, 7);
      return;
    }
    if (stepId === ACTION_GUARDIAN_WAKES) {
      event.handled = true;
      const area = arenas.get(player);
      if (area) {
        area.awakening = sceneActor(player, area, NpcIdentifiers.ANCIENT_GUARDIAN_2, 2952, 5778);
        area.awakening?.performAnimation?.(new Animation(8944));
        sceneCamera(player, area, [2948, 5771, 700, 1, 1], [2953, 5778, 100, 1, 1]);
        player.getPacketSender().sendCameraShake(0, 5);
        sceneLater(player, area, 2, () => {
          player.getPacketSender().sendCameraReset();
          sceneCamera(player, area, [2948, 5771, 700], [2952, 5778, 150, 2, 2]);
        });
        player.getPacketSender().sendSound(4972, 1, 0);
      }
      setMainProgress(player, 35);
      if (!area) spawnGuardian(player);
      pauseSceneAction(event, ENTRANCE_VARIANT, 5);
      return;
    }
    if (stepId === ACTION_CUTSCENE_END) {
      sceneFade(player, true, 15); // 2167 out, 2169 line; its Continue starts combat at +5.
      pauseSceneAction(event, ENTRANCE_VARIANT, 2);
      return;
    }
    if (stepId === ACTION_BAG_RUMMAGE) {
      event.handled = true;
      if (quest.getStage(player) === STAGE_GUARDIAN_DEAD) {
        setFlag(player, REWARD_PENDING_ATTRIBUTE, true);
        const area = arenas.get(player);
      if (area) {
        player.moveTo(area.sourceTile(2951, 5769));
        sceneCamera(player, area, [2955, 5772, 450, 2, 2], [2951, 5769, 300, 2, 2]);
      }
      player.performAnimation(new Animation(6840));
        event.steps = [{ type: "message", text: "You rummage through Willow's bag...", id: "below-ice-mountain:statement" }, { type: "message", text: "You find a pile of coins!", id: "below-ice-mountain:coins-found" }];
      }
      return;
    }
    if (stepId === ACTION_DOORS_OPEN) {
      event.handled = true;
      const area = arenas.get(player);
      if (area) {
        sourceObject(player, area, ObjectIdentifiers.BIG_DOOR_5, 2951, 5780);
        sourceObject(player, area, ObjectIdentifiers.BIG_DOOR_6, 2954, 5780);
        sceneActor(player, area, NpcIdentifiers.RAMARNO, 2952, 5778);
      }
      player.getPacketSender().sendCameraShake(0, 15);
      sceneLater(player, area, 3, () => {
        player.getPacketSender().sendCameraReset();
        sceneCamera(player, area, [2955, 5772, 450], [2951, 5769, 300]);
      });
      player.getPacketSender().sendSound(67, 1, 0);
      pauseSceneAction(event, "finishing-up", 3);
      return;
    }
    if (stepId === ACTION_RAMARNO_DEPARTS) {
      event.handled = true;
      sceneFade(player, true);
      event.steps = [{ type: "message", text: "Ramarno departs for his workshop.", id: "below-ice-mountain:statement" }];
      TaskManager.submit(new CountdownTask(player, 3, () => {
        if (player.isRegistered?.() === false) return;
        setFlag(player, MET_RAMARNO_ATTRIBUTE, true);
        syncVariables(player);
        sceneFade(player, false);
      })); // 2283 departure/out, 2286 workshop morph/in.
      return;
    }
    if (BRANCH_CONTINUE_IDS.has(stepId)) {
      // A wiki "unavailable" marker mid-scene (the entrance cutscene's, the bag's, the
      // cook's): let the branch carry on instead of closing.
      event.handled = true;
      return;
    }
  }

  // ==========================================================================
  // World: NPC/object spawns and the Guardian fight
  // ==========================================================================

  class GuardianArena extends TemplatedInstanceArea {
    constructor(owner) {
      super(3, 3);
      this.owner = owner;
      for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 3; y++) this.setChunk(0, x, y, {
          sourceChunkX: 368 + x, sourceChunkY: 720 + y, sourcePlane: 0, rotation: 0,
        });
      }
      this.mined = new Set();
    }
    getName() { return "Below Ice Mountain"; }
    sourceTile(x, y) { return this.tile(x - 2944, y - 5760, 0); }
    canAttack(attacker, target) {
      return (attacker === this.owner && target === guardians.get(this.owner))
        || (target === this.owner && attacker === guardians.get(this.owner));
    }
    postLeave(actor, logout) {
      super.postLeave(actor, logout);
      if (actor === this.owner) {
        const npc = guardians.get(actor);
        if (npc) api.removeNpc(npc);
        guardians.delete(actor);
        arenas.delete(actor);
        mining.delete(actor);
      }
    }
  }

  function enterArena(player) {
    let area = arenas.get(player);
    if (!area || area.isDestroyed()) {
      area = new GuardianArena(player);
      arenas.set(player, area);
    }
    area.enter(player);
    player.moveTo(area.sourceTile(RUINS_ARRIVAL_TILE.x, RUINS_ARRIVAL_TILE.y));
    if (!area.getObjects().some((object) => object.getId() === STRUCTURAL_PILLAR_OBJECT_ID)) {
      for (const tile of PILLAR_TILES) ObjectManager.register(new GameObject(
        STRUCTURAL_PILLAR_OBJECT_ID, area.sourceTile(tile.x, tile.y), 10, tile.face, area
      ), true);
    }
    return area;
  }

  function spawnGuardian(player) {
    const existing = guardians.get(player);
    if (existing && existing.isRegistered?.() !== false) return existing;
    const area = arenas.get(player) ?? enterArena(player);
    const tile = area.sourceTile(2952, 5778);
    const npc = api.spawnNpc({ id: ANCIENT_GUARDIAN_NPC_ID,
      x: tile.getX(), y: tile.getY(), z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    if (npc) {
      area.add(npc);
      guardians.set(player, npc);
    }
    return npc;
  }

  function defeatGuardian(player) {
    if (quest.getStage(player) !== STAGE_GUARDIAN) return;
    quest.setStage(player, STAGE_GUARDIAN_DEAD);
    guardians.delete(player);
    player.getCombat?.().reset();
    player.getMovementQueue().setBlockMovement(true);
    player.setUntargetable(true);
    const area = arenas.get(player);
    transitionFade(player, area, 7, 1); // 2197 death, 2198 out, 2204 in, 2206 first line.
    sceneLater(player, area, 6, () => player.getPacketSender().sendCameraReset());
    sceneLater(player, area, 7, () => sceneCamera(player, area, [2957, 5777, 450], [2952, 5773, 300]));
    TaskManager.submit(new CountdownTask(player, 9, () => {
      if (quest.getStage(player) === STAGE_GUARDIAN_DEAD && player.getPrivateArea() === area) {
        startTranscript(api, player, RAMARNO_NPC_ID, PAGE, "finishing-up");
      }
    }));
  }

  function handleNpcDeath(event) {
    if (event.npcId !== ANCIENT_GUARDIAN_NPC_ID) return;
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (!player || guardians.get(player) !== event.npc) return;
    defeatGuardian(player);
  }

  function handlePlayerLogout({ player }) {
    const npc = guardians.get(player);
    if (npc) {
      guardians.delete(player);
      api.removeNpc(npc);
    }
    const arena = arenas.get(player);
    arenas.delete(player);
    arena?.destroy();
    stopTraining(player, true);
    const scene = storyScenes.get(player);
    if (scene) endStoryScene(player, attrFlag(player, STORY_SCENE_ATTRIBUTE) === 1 ? { x: 2956, y: 3368 } : ENTRANCE_ARRIVAL_TILE);
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleEntrance(event) {
    if (event.objectId !== RUINS_ENTRANCE_OBJECT_ID && event.objectId !== RUINS_ENTRANCE_BASE_OBJECT_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUITED) {
      event.handled = true;
      player.sendMessage("The way is blocked.");
      return;
    }
    event.handled = true;
    if (stage === STAGE_RECRUITED) {
      startTranscript(api, player, WILLOW_NPC_ID, PAGE, "the-ruins-of-camdozaal-talking-to-willow");
      return;
    }
    if (stage >= STAGE_COMPLETE) {
      moveTo(player, { x: 2952, y: 5762 });
      return;
    }
    enterArena(player);
    if (stage === STAGE_GUARDIAN) {
      player.setAttribute(PILLARS_MINED_ATTRIBUTE, 0);
      spawnGuardian(player)?.getCombat?.().attack(player);
    }
  }

  function handleExit(event) {
    if (event.objectId !== RUINS_EXIT_OBJECT_ID) return;
    event.handled = true;
    moveTo(event.player, ENTRANCE_ARRIVAL_TILE);
  }

  function handleObjectInteraction(event) {
    if (event.clickType !== 1) return; // op 1: Enter / Exit / Mine; leave Examine alone
    if (event.objectId === RUINS_ENTRANCE_OBJECT_ID || event.objectId === RUINS_ENTRANCE_BASE_OBJECT_ID) return handleEntrance(event);
    if (event.objectId === RUINS_EXIT_OBJECT_ID) return handleExit(event);
    if (event.objectId === STRUCTURAL_PILLAR_OBJECT_ID) return handlePillarMine(event);
  }

  function handleWillowsBag(event) {
    if (event.objectId !== WILLOWS_BAG_OBJECT_ID || quest.getStage(event.player) !== STAGE_GUARDIAN_DEAD) {
      return;
    }
    event.handled = true;
    startTranscript(api, event.player, RAMARNO_NPC_ID, PAGE, "finishing-up");
  }

  function handlePillarMine(event) {
    if (event.objectId !== STRUCTURAL_PILLAR_OBJECT_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_GUARDIAN) return;
    event.handled = true;
    const area = arenas.get(player);
    if (!area || player.getPrivateArea() !== area) return;
    const location = event.object?.getLocation() ?? new Location(event.location.x, event.location.y, 0);
    const index = PILLAR_TILES.findIndex((tile) => area.sourceTile(tile.x, tile.y).equals(location));
    if (index < 0 || area.mined.has(index) || mining.has(player)) return;
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 10) {
      player.sendMessage("You need a Mining level of at least 10 to mine this rock.");
      return;
    }
    const request = { player, pickaxe: null };
    api.emitCustomEvent("mining:best-pickaxe", request);
    if (!request.pickaxe) {
      player.sendMessage("You don't have a pickaxe which you can use.");
      return;
    }
    player.performAnimation(request.pickaxe.animation);
    mining.set(player, index);
    // shortcut: 1636 takes the combat route; verify the eight-tick mining delay against a mining capture.
    TaskManager.submit(new CountdownTask(player, 8, () => {
      if (mining.get(player) !== index) return;
      mining.delete(player);
      if (player.getPrivateArea() !== area || quest.getStage(player) !== STAGE_GUARDIAN
        || !player.getLocation().isWithinDistance(location, 2)) return;
      area.mined.add(index);
      player.performAnimation(new Animation(-1));
      const pillar = area.getObjects().find((object) => object.getId() === STRUCTURAL_PILLAR_OBJECT_ID && object.getLocation().equals(location));
      if (pillar) ObjectManager.deregister(pillar, true);
      ObjectManager.register(new GameObject(BROKEN_PILLAR_OBJECT_ID, location, 10, PILLAR_TILES[index].face, area), true);
      player.getSkillManager().addExperiences(Skill.MINING, 10);
      const guardian = guardians.get(player);
      if (guardian) {
        const damage = Math.min(10, guardian.getHitpoints());
        guardian.setHitpoints(guardian.getHitpoints() - damage);
        guardian.addTickHit?.(new HitDamage(damage, HitMask.RED));
        if (guardian.getHitpoints() <= 0) {
          api.removeNpc(guardian);
          defeatGuardian(player);
        }
      }
    }));
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function knowsSandwich(player) {
    return quest.isComplete(player) || memberState(player, MARLEY_ATTRIBUTE) >= 10;
  }

  function makeSandwich(player, amount = 1) {
    const inventory = player.getInventory();
    if (!knowsSandwich(player) || !held(player, KNIFE_ITEM_ID) || !held(player, BREAD_ITEM_ID) || !held(player, COOKED_MEAT_ITEM_ID)) return;
    inventory.deleteNumber(BREAD_ITEM_ID, 1);
    inventory.deleteNumber(COOKED_MEAT_ITEM_ID, 1);
    inventory.adds(STEAK_SANDWICH_ITEM_ID, 1);
    setFlag(player, SANDWICH_MADE_ATTRIBUTE, true);
    player.performAnimation(new Animation(8938));
    player.sendMessage("You combine the cooked meat and bread to make a Steak sandwich!");
    if (amount > 1) TaskManager.submit(new CountdownTask(player, 3, () => {
      if (player.isRegistered?.() !== false) makeSandwich(player, amount - 1);
    }));
  }

  function handleKnifeSandwich(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!knowsSandwich(player)) return false;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(KNIFE_ITEM_ID) || !pair.has(BREAD_ITEM_ID) && !pair.has(COOKED_MEAT_ITEM_ID)) return false;
    if (!held(player, KNIFE_ITEM_ID)) return false;
    event.handled = true;
    if (pair.has(COOKED_MEAT_ITEM_ID)) {
      makeSandwich(player);
      return true;
    }
    if (!held(player, BREAD_ITEM_ID)) return true;
    // Bread used on the knife preserves its ordinary breadcrumbs action.
    if (usedItemId === BREAD_ITEM_ID) {
      player.getInventory().deleteNumber(BREAD_ITEM_ID, 1);
      player.getInventory().adds(ItemIdentifiers.BREADCRUMBS, 1);
      return true;
    }
    player.getPacketSender().sendCreationMenu(new CreationMenu("How many do you wish to make?",
      [ItemIdentifiers.BREADCRUMBS, STEAK_SANDWICH_ITEM_ID], {
        execute(itemId, amount) {
          if (itemId === STEAK_SANDWICH_ITEM_ID) return makeSandwich(player, Math.max(1, Math.min(amount, 28)));
          if (itemId !== ItemIdentifiers.BREADCRUMBS || !held(player, KNIFE_ITEM_ID)) return;
          const count = Math.max(0, Math.min(amount, player.getInventory().getAmount(BREAD_ITEM_ID)));
          player.getInventory().deleteNumber(BREAD_ITEM_ID, count);
          player.getInventory().adds(ItemIdentifiers.BREADCRUMBS, count);
        },
      }, { labels: ["Breadcrumbs", "Steak sandwich"], mode: 0, maxAmount: player.getInventory().getAmount(BREAD_ITEM_ID), lastAmount: 1 }));
    return true;
  }

  function handleItemOnCrew(event) {
    const { player, npcId, itemId } = event;
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if ((npcId === BURNTOF_NPC_ID || npcId === BURNTOF_2_NPC_ID) && ALCOHOL_ITEM_IDS.includes(itemId)
      && memberState(player, BURNTOF_ATTRIBUTE) < 10 && held(player, itemId)) {
      event.handled = true;
      offeredDrinks.set(player, itemId);
      handleAction({ player, npcId: BURNTOF_NPC_ID, stepId: ACTION_BURNTOF_DRINK });
    } else if (npcId === MARLEY_NPC_ID && itemId === STEAK_SANDWICH_ITEM_ID
      && memberState(player, MARLEY_ATTRIBUTE) >= MEMBER_IN_PROGRESS && memberState(player, MARLEY_ATTRIBUTE) < MEMBER_RECRUITED && held(player, itemId)) {
      event.handled = true;
      startTranscript(api, player, MARLEY_NPC_ID, PAGE, "marley-the-thief-returning-to-marley");
    }
  }

  function handleItemOnRamarno(event) {
    if (!RAMARNO_NPC_IDS.has(event.npcId)) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_COMPLETE || attrFlag(player, MET_RAMARNO_ATTRIBUTE)) return;
    event.handled = true;
    player.sendMessage("Ramarno still looks shocked. Perhaps you should talk to him first.");
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function memberLine(player, attribute, label) {
    return memberState(player, attribute) >= MEMBER_RECRUITED
      ? `<str>I recruited ${label}.</str>`
      : `I still need to convince <col=800000>${label}</col>.`;
  }

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Willow asked me to help her break into ancient ruins beneath</str>",
        "<str>Ice Mountain, and I recruited her old crew to do it.</str>",
        "<str>Inside we woke an Ancient Guardian, which I defeated.</str>",
        "<str>I met Ramarno, the last of the Imcando dwarves of Camdozaal.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by talking to <col=800000>Willow</col>",
        "on the path south of <col=800000>Ice Mountain</col>.",
      ];
    }
    const lines = [
      "<str>Willow asked me to help her break into ancient ruins beneath</str>",
      "<str>Ice Mountain, and to recruit her old excavation team.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      lines.push(memberLine(player, BURNTOF_ATTRIBUTE, "Burntof"));
      lines.push(memberLine(player, CHECKAL_ATTRIBUTE, "Checkal"));
      lines.push(memberLine(player, MARLEY_ATTRIBUTE, "Marley"));
      return lines;
    }
    lines.push("<str>All three of the crew have agreed to help Willow.</str>");
    if (stage === STAGE_RECRUITED) {
      lines.push("");
      lines.push("I should meet Willow at the ruins entrance on the west");
      lines.push("side of <col=800000>Ice Mountain</col>.");
      return lines;
    }
    lines.push("<str>Burntof blew the rocks open and we entered the ruins.</str>");
    if (stage === STAGE_GUARDIAN) {
      lines.push("");
      lines.push("An <col=800000>Ancient Guardian</col> woke up and the crew ran off.");
      lines.push("I should defeat it, or mine the four structural pillars.");
      return lines;
    }
    lines.push("<str>I defeated the Ancient Guardian.</str>");
    lines.push("");
    lines.push("I should search <col=800000>Willow's bag</col> for anything useful.");
    return lines;
  }

  function grantReward(player) {
    // registerQuest supplies the final coin; the bag holds the other 1,999. Coins
    // stack, so forceAdd merges into an existing stack or drops the overflow at the
    // reward tile instead of losing it to a full inventory.
    player.getInventory().forceAdd(player, new Item(COINS_ITEM_ID, 1999));
  }

  function syncBootstrap({ player }) { syncVariables(player); }

  function handleLogin({ player }) {
    syncVariables(player);
    if (attrFlag(player, STORY_SCENE_ATTRIBUTE) && quest.getStage(player) < STAGE_GUARDIAN) {
      moveTo(player, attrFlag(player, STORY_SCENE_ATTRIBUTE) === 1 ? { x: 2956, y: 3368 } : ENTRANCE_ARRIVAL_TILE);
      player.setAttribute(STORY_SCENE_ATTRIBUTE, 0);
    }
    if (attrFlag(player, TRAINING_ATTRIBUTE)) {
      player.setAttribute(TRAINING_ATTRIBUTE, 0);
      player.getMovementQueue().setBlockMovement(false);
      player.setUntargetable(false);
      moveTo(player, { x: 3075, y: 3440 });
    }
    if (quest.getStage(player) === STAGE_GUARDIAN || quest.getStage(player) === STAGE_GUARDIAN_DEAD) {
      enterArena(player);
      if (quest.getStage(player) === STAGE_GUARDIAN) spawnGuardian(player)?.getCombat?.().attack(player);
    }
    refreshQuestList(player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  quest = registerQuest(api, {
    key: "below_ice_mountain",
    name: "Below Ice Mountain",
    varpId: 2951,
    varbitId: MAIN_VARBIT,
    varbitValue: mainProgress,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    rewardItemId: COINS_ITEM_ID,
    rewardItemLabel: "2,000 Coins",
    scrollItemId: STEAK_SANDWICH_ITEM_ID,
    completionJingleId: 152,
    otherRewards: [
      "Access to the Ruins of Camdozaal",
      "Flex emote",
      "The ability to make a steak sandwich",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(CHECKAL_ATTRIBUTE, 0);
  api.persistAttribute(MARLEY_ATTRIBUTE, 0);
  api.persistAttribute(BURNTOF_ATTRIBUTE, 0);
  api.persistAttribute(BURNTOF_ASKED_ATTRIBUTE, 0);
  api.persistAttribute(ATLAS_SESSIONS_ATTRIBUTE, 0);
  api.persistAttribute(ATLAS_DECLINED_ATTRIBUTE, 0);
  api.persistAttribute(FLEX_UNLOCKED_ATTRIBUTE, 0);
  api.persistAttribute(COOK_TALKED_ATTRIBUTE, 0);
  api.persistAttribute(SANDWICH_MADE_ATTRIBUTE, 0);
  api.persistAttribute(MET_RAMARNO_ATTRIBUTE, 0);
  api.persistAttribute(PILLARS_MINED_ATTRIBUTE, 0);

  api.persistAttribute(MAIN_PROGRESS_ATTRIBUTE, 0);
  api.persistAttribute(CHECKAL_PROMPT_ATTRIBUTE, 0);
  api.persistAttribute(REWARD_PENDING_ATTRIBUTE, 0);
  api.persistAttribute(TRAINING_ATTRIBUTE, 0);
  api.persistAttribute(STORY_SCENE_ATTRIBUTE, 0);
  api.onNpcInteraction("Willow", { "Talk-to": handleWillowTalk });
  api.onNpcInteraction("Atlas", { "Talk-to": handleAtlasTalk });
  api.onCustomEvent("player:emote", handleFlex);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("player:bootstrap-complete", syncBootstrap);
  api.onCustomEvent("interface:closed", handleRewardClosed);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handlePlayerLogout);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(handleRamarnoTalk);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectInteraction("Willow's bag", { Investigate: handleWillowsBag });
  api.onItemOnItem("Knife", "Bread", handleKnifeSandwich);
  api.onItemOnItem("Knife", "Cooked meat", handleKnifeSandwich);
  api.onItemOnNpc(handleItemOnCrew);
  api.onItemOnNpc(handleItemOnRamarno);
};
