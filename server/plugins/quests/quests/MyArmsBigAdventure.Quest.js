/**
 * My Arm's Big Adventure (members).
 *
 * The words come from the "My Arm's Big Adventure" transcript page; this plugin
 * supplies the variant selection for Burntmeat, My Arm and Murcaily, the prose
 * conditions, the goutweedy-lump pot, the fertiliser patch prep, the Karamja
 * tubers, the tool hand-ins, the Baby/Giant Roc fight and the completion.
 *
 * Stages (varbit 2790 "myarm", varp 905 "myarm_quest"): the values are the
 * canonical OSRS ones (RuneLite QuestHelper's step map, which the cache's NPC
 * 743 transform confirms - it renders My Arm at 20/30/40/50/60/70 and hides in
 * between): 40 started, 60 fetch lump, 70 return lump, 80 roof talk (manual),
 * 90 read manual, 100 talk after reading, 110 treat patch, 120-140 talk after
 * treating, 150/160 Barnaby/boat, 170 My Arm at Tai Bwo Wannai, 180-200
 * Murcaily, 210 back at the roof, 220/230 prepare, 240 plant, 250 Baby Roc,
 * 260 Giant Roc, 270 spade, 280 harvested, 290/300 Burntmeat, 310 final talk,
 * 320 complete. Sibling varbits (same varp) are mirrored from persisted
 * attributes: 2791 dung count, 2792 supercompost count, 2793 ship chat, 2794
 * tubers given, 2795 rake joke, 2796 dwarf joke, 2797 first Giant Roc, 2798
 * plant cure, 2799 fake patch (6 raked, 7 compost, 8 tubers, 9 planted).
 *
 * Requirements (wiki): Eadgar's Ruse, Troll Stronghold (both implied by the
 * former) and Jungle Potion complete, 29 Farming (boostable), 10 Woodcutting,
 * and 60% Tai Bwo Wannai favour. The cleanup minigame is not implemented and
 * favour is not tracked elsewhere, so the quest grants 60% when it starts and
 * subtracts it at Murcaily (varbit 907 "favour_percentage"), matching the wiki.
 * The Feud is also required by the wiki but has no plugin, so it is not gated.
 *
 * Source: https://oldschool.runescape.wiki/w/My_Arm%27s_Big_Adventure and
 * /Quick_guide; rewards per the wiki: 1 Quest point, 10,000 Herblore XP,
 * 5,000 Farming XP, 315 Farming XP at the harvest, 29 burnt meat, the
 * disease-free Troll Stronghold herb patch and the rocks shortcut (the shortcut
 * already gates on quest key "my_arms_big_adventure").
 *
 * Gaps/approximations: no cutscene actors (Adventurer, Drunken Dwarf, unnamed
 * troll child, Qutiedoll, Jagbakoba, the broodoo victim) are spawned - their
 * lines play as typed transcript lines; the wiki's separate Captain Barnaby
 * step is folded into My Arm's post-treating variant, which already contains
 * the dock/ship scene, and the player is dropped at Brimhaven when it ends; the
 * Roc fight has no instance (owner-only spawns on the roof); the rake always
 * breaks once on the first hand-in (the real break is random); the quest patch
 * is permanently disease-free in the farming model regardless of quest state;
 * the post-quest My Arm repeats his final conversation (no post-quest variant
 * in the dump); "attempting to pick the goutweed" and the banknote hand-in are
 * covered only where the transcript provides a variant.
 */
module.exports = function registerMyArmsBigAdventureQuest(api) {
  const {
    CacheDefinitions,
    CountdownTask,
    Equipment,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    TaskManager,
    TeleportHandler,
    TeleportType,
  } = api.core;
  const { refreshQuestList, registerQuest, startTranscript } = require("../QuestRuntime");

  // ==========================================================================
  // Ids
  // ==========================================================================

  /** All My Arm cache variants: the kitchen NPC transforms into 741/742/750/751/752, quest spawns use 8411. */
  const MY_ARM_NPC_IDS = new Set([
    NpcIdentifiers.MY_ARM_2, // 741
    NpcIdentifiers.MY_ARM_3, // 742 (the kitchen transform target)
    NpcIdentifiers.MY_ARM_4, // 750
    NpcIdentifiers.MY_ARM_5, // 751
    NpcIdentifiers.MY_ARM_6, // 752
    NpcIdentifiers.MY_ARM, // 8411
  ]);
  const MY_ARM_SPAWN_ID = NpcIdentifiers.MY_ARM; // 8411, has Talk-to
  const BURNTMEAT_NPC_ID = NpcIdentifiers.BURNTMEAT; // 4157
  const MURCAILY_NPC_IDS = new Set([
    NpcIdentifiers.MURCAILY, // 755
    NpcIdentifiers.MURCAILY_2, // 6430
    NpcIdentifiers.MURCAILY_3, // 6431
  ]);
  const MURCAILY_SPAWN_ID = NpcIdentifiers.MURCAILY_2; // 6430, has Talk-to
  const BABY_ROC_NPC_ID = NpcIdentifiers.BABY_ROC; // 762
  const GIANT_ROC_NPC_ID = NpcIdentifiers.GIANT_ROC; // 763
  const OWN_NPC_IDS = new Set([
    ...MY_ARM_NPC_IDS,
    BURNTMEAT_NPC_ID,
    ...MURCAILY_NPC_IDS,
  ]);

  const COOKING_POT_OBJECT_ID = ObjectIdentifiers.COOKING_POT; // 3662, Death Plateau
  // The Troll Stronghold roof herb patch (cache name "null"; farming-data id 18816,
  // varbit 4771). No generated identifier exists for it.
  const ROOF_PATCH_OBJECT_ID = 18816;

  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET; // 1925
  const GOUTWEEDY_LUMP_ITEM_ID = ItemIdentifiers.GOUTWEEDY_LUMP; // 9901
  const FARMING_MANUAL_ITEM_ID = ItemIdentifiers.FARMING_MANUAL; // 9903
  const GOUT_TUBER_ITEM_ID = ItemIdentifiers.GOUT_TUBER; // 6311
  const HARDY_GOUT_TUBER_ITEM_ID = ItemIdentifiers.HARDY_GOUT_TUBER; // 4001
  const HARDY_GOUT_TUBERS_ITEM_ID = ItemIdentifiers.HARDY_GOUT_TUBERS; // 9902
  const UGTHANKI_DUNG_ITEM_ID = ItemIdentifiers.UGTHANKI_DUNG; // 4601
  const SUPERCOMPOST_ITEM_ID = ItemIdentifiers.SUPERCOMPOST; // 6034
  const ULTRACOMPOST_ITEM_ID = ItemIdentifiers.ULTRACOMPOST; // 21483
  const COMPOST_ITEM_ID = ItemIdentifiers.COMPOST; // 6032
  const RAKE_ITEM_ID = ItemIdentifiers.RAKE; // 5341
  const RAKE_HEAD_ITEM_ID = ItemIdentifiers.RAKE_HEAD; // 5348
  const RAKE_HANDLE_ITEM_ID = ItemIdentifiers.RAKE_HANDLE; // 5347
  const SEED_DIBBER_ITEM_ID = ItemIdentifiers.SEED_DIBBER; // 5343
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE; // 952
  const PLANT_CURE_ITEM_ID = ItemIdentifiers.PLANT_CURE; // 6036
  const CAMULET_ITEM_ID = ItemIdentifiers.CAMULET; // 6707
  const BURNT_MEAT_ITEM_ID = ItemIdentifiers.BURNT_MEAT; // 2146
  const CLIMBING_BOOTS_ITEM_ID = ItemIdentifiers.CLIMBING_BOOTS; // 3105

  // Quest varbits in varp 905 (myarm_quest) and the Tai Bwo Wannai favour varbit.
  const VARBIT_DUNG = 2791;
  const VARBIT_SUPERCOMPOST = 2792;
  const VARBIT_SHIPCHAT = 2793;
  const VARBIT_TUBERS = 2794;
  const VARBIT_RAKEJOKE = 2795;
  const VARBIT_DWARFJOKE = 2796;
  const VARBIT_FIRST_GIANT_ROC = 2797;
  const VARBIT_BARNABYSWAP = 2798;
  const VARBIT_FAKEPATCH = 2799;
  const VARBIT_TAI_BWO_FAVOUR = 907; // favour_percentage (varp 535 bits 2-11)

  // Canonical stage values (see header).
  const STAGE_STARTED = 40;
  const STAGE_FETCH_LUMP = 60;
  const STAGE_LUMP_OBTAINED = 70;
  const STAGE_LUMP_GIVEN = 80;
  const STAGE_MANUAL = 90;
  const STAGE_MANUAL_READ = 100;
  const STAGE_PATCH = 110;
  const STAGE_PATCH_TREATED = 120;
  const STAGE_KARAMJA = 170;
  const STAGE_MY_ARM_TAI = 180;
  const STAGE_TUBERS = 210;
  const STAGE_TOOLS = 240;
  const STAGE_PLANTED = 250;
  const STAGE_GIANT_ROC = 260;
  const STAGE_SPADE = 270;
  const STAGE_HARVESTED = 280;
  const STAGE_REWARDED = 310;
  const STAGE_COMPLETE = 320;

  // Fake-patch values (varbit 2799) as QuestHelper reads them.
  const PATCH_RAKED = 6;
  const PATCH_COMPOST = 7;
  const PATCH_TUBERS = 8;
  const PATCH_PLANTED = 9;

  const DUNG_REQUIRED = 3;
  const SUPERCOMPOST_REQUIRED = 7;
  const FAVOUR_REQUIRED = 60;
  const BURNT_MEAT_REWARD = 29;
  const HARVEST_FARMING_XP = 315; // wiki: 45 x 7 while My Arm harvests
  const HERBLORE_REWARD_XP = 10000;
  const FARMING_REWARD_XP = 5000;
  const FARMING_REQUIREMENT = 29;
  const WOODCUTTING_REQUIREMENT = 10;

  const TOOL_RAKE = 1 << 0;
  const TOOL_DIBBER = 1 << 1;
  const TOOL_SPADE = 1 << 2;

  const PAGE = "My Arm's Big Adventure";
  const START_HOOK = "quest:my-arm-s-big-adventure:start";
  const TRIP_END_LINE = "Oh, he's gone. I hope he knows the way to Tai Bwo Wannai Village.";
  const BABY_ALIVE_LINE = "You're worried about that?";
  const GIANT_ALIVE_LINE = "Dat birdie behind you.";
  const RAKE_REATTACH_MESSAGE = "You reattach the rake head to the handle.";
  const MANUAL_READ_MESSAGE =
    "The farming manual says to mix three buckets of camel dung and seven buckets of supercompost into the soil.";
  const RAKE_BREAK_MESSAGE = "My Arm breaks the rake! The head lands on the ground.";
  const RAKE_DONE_MESSAGE = "My Arm rakes the weeds from the patch.";
  const COMPOST_ADDED_MESSAGE = "My Arm mixes the supercompost into the soil.";

  // Attribute keys (persisted; mirror the sibling varbits on login).
  const DUNG_ATTRIBUTE = "my-arms-big-adventure:dung";
  const COMPOST_ATTRIBUTE = "my-arms-big-adventure:supercompost";
  const MANUAL_READ_ATTRIBUTE = "my-arms-big-adventure:manual-read";
  const TUBERS_ATTRIBUTE = "my-arms-big-adventure:tubers-given";
  const RAKE_JOKE_ATTRIBUTE = "my-arms-big-adventure:rake-joke";
  const DWARF_JOKE_ATTRIBUTE = "my-arms-big-adventure:dwarf-joke";
  const FIRST_GIANT_ROC_ATTRIBUTE = "my-arms-big-adventure:first-giant-roc";
  const PLANT_CURE_ATTRIBUTE = "my-arms-big-adventure:plant-cure";
  const FAKEPATCH_ATTRIBUTE = "my-arms-big-adventure:fake-patch";
  const FAVOUR_ATTRIBUTE = "my-arms-big-adventure:tai-bwo-favour";
  const BABY_ROC_DEAD_ATTRIBUTE = "my-arms-big-adventure:baby-roc-dead";
  const GIANT_ROC_DEAD_ATTRIBUTE = "my-arms-big-adventure:giant-roc-dead";
  const TOOLS_ATTRIBUTE = "my-arms-big-adventure:tools-given";

  // Player-owned house location ids (native POH_HOUSE_LOCATION enum 252 order), as in
  // In Aid of the Myreque; unset falls back to the OSRS default, Rimmington.
  const POH_HOUSE_ATTRIBUTE = "construction:house";
  const POH_LOCATION_NAMES = new Map([
    [1, "Rimmington"],
    [2, "Taverley"],
    [3, "Pollnivneach"],
    [8, "Hosidius"],
    [4, "Rellekka"],
    [13, "Aldarin"],
    [5, "Brimhaven"],
    [6, "Yanille"],
    [9, "Prifddinas"],
  ]);

  const MY_ARM_ROOF_TILE = { x: 2834, y: 3695, z: 0 };
  const MY_ARM_TAI_TILE = { x: 2781, y: 3123, z: 0 };
  const MURCAILY_TILE = { x: 2815, y: 3083, z: 0 };
  const BABY_ROC_TILE = { x: 2834, y: 3692, z: 0 };
  const GIANT_ROC_TILE = { x: 2828, y: 3690, z: 0 };
  const RAKE_HEAD_TILE = new Location(2837, 3694, 0);
  const BRIMHAVEN_DOCK = new Location(2768, 3227, 0);
  // Re-entering either area re-syncs the owner-only NPCs (My Arm, Murcaily, the Rocs).
  const ROOF_ZONE = { minX: 2822, maxX: 2838, minY: 3665, maxY: 3701, levels: [0] };
  const VILLAGE_ZONE = { minX: 2755, maxX: 2825, minY: 3045, maxY: 3145, levels: [0] };

  /** Which transcript variant each stage hands Murcaily (My Arm and Burntmeat are owned by name hooks). */
  function selectVariant({ npcId, player }) {
    if (MURCAILY_NPC_IDS.has(npcId)) return selectMurcailyVariant(player);
    // The Talk-to hooks own these NPCs; answering here too keeps the selector
    // complete for the id-indexed ids (and the shared transcript resolver).
    if (MY_ARM_NPC_IDS.has(npcId)) return selectMyArmVariant(player);
    return null;
  }

  /**
   * Burntmeat is shared with Eadgar's Ruse, whose variant selector has already
   * answered by the time the id-index runs. Talk-to is owned here instead, and
   * only once Eadgar's Ruse is complete (or this quest has started) so the
   * Eadgar's Ruse conversations are never stolen.
   */
  function talkToBurntmeat(event) {
    const { player, npcId } = event;
    if (quest.getStage(player) < STAGE_STARTED && !isQuestComplete(player, "eadgars_ruse")) return false;
    if (!startTranscript(api, player, npcId, PAGE, selectBurntmeatVariant(player))) return false;
    return undefined;
  }

  function selectBurntmeatVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_REWARDED) return "the-rocs-talking-to-burntmeat-again";
    if (stage >= STAGE_HARVESTED) return "the-rocs-talking-to-burntmeat";
    if (stage >= STAGE_LUMP_GIVEN) return "starting-off-talking-to-burntmeat-after-my-arm-eats-the-goutweedy-lump";
    if (stage >= STAGE_LUMP_OBTAINED) return "starting-off-talking-to-burntmeat-after-obtaining-the-goutweedy-lump";
    if (stage >= STAGE_FETCH_LUMP) return "starting-off-talking-to-burntmeat-after-talking-to-my-arm";
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-burntmeat-after-agreeing-to-help-my-arm";
    return meetsRequirements(player)
      ? "starting-off-talking-to-burntmeat"
      : "starting-off-talking-to-burntmeat-without-meeting-the-requirements";
  }

  function selectMurcailyVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_MY_ARM_TAI && stage < STAGE_TUBERS) {
      return "karamja-talking-to-murcaily-after-talking-to-my-arm";
    }
    if (stage >= STAGE_KARAMJA && stage < STAGE_MY_ARM_TAI) {
      return "karamja-talking-to-murcaily-before-talking-to-my-arm";
    }
    return null;
  }

  /**
   * My Arm's Talk-to is owned by this plugin (he is not indexed under the kitchen
   * spawn id and is spawned by the quest on the roof), so the choice carries the
   * `select` narrowing the wiki tail replays need.
   */
  function selectMyArmVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_REWARDED) {
      return { variant: "the-rocs-talking-to-my-arm-after-talking-to-burntmeat" };
    }
    if (stage >= STAGE_HARVESTED) {
      return { variant: "the-rocs-talking-to-my-arm-again-before-talking-to-burntmeat" };
    }
    if (stage >= STAGE_SPADE) {
      return { variant: "the-rocs-talking-to-my-arm-after-defeating-the-giant-roc" };
    }
    if (stage >= STAGE_GIANT_ROC) {
      if (!giantRocDead(player)) {
        return { variant: "the-rocs-after-killing-the-baby-roc", select: fromLine(GIANT_ALIVE_LINE) };
      }
      advanceTo(player, STAGE_SPADE);
      return { variant: "the-rocs-talking-to-my-arm-after-defeating-the-giant-roc" };
    }
    if (stage >= STAGE_PLANTED) {
      if (!babyRocDead(player)) {
        return { variant: "the-rocs-after-my-arm-plants-the-gout-tubers", select: fromLine(BABY_ALIVE_LINE) };
      }
      return { variant: "the-rocs-after-killing-the-baby-roc" };
    }
    if (stage >= STAGE_TOOLS) {
      return {
        variant: fakePatch(player) < PATCH_RAKED
          ? "the-rocs-giving-my-arm-farming-items-talking-to-my-arm-before-weeding"
          : "the-rocs-giving-my-arm-farming-items-talking-to-my-arm-after-weeding",
      };
    }
    if (stage >= STAGE_TUBERS) {
      advanceTo(player, STAGE_TOOLS);
      return { variant: "the-rocs-talking-to-my-arm-at-the-patch" };
    }
    if (stage >= STAGE_MY_ARM_TAI) return { variant: "karamja-talking-to-my-arm-again" };
    if (stage >= STAGE_KARAMJA) {
      advanceTo(player, STAGE_MY_ARM_TAI);
      return { variant: "karamja-talking-to-my-arm-outside-tai-bwo-wannai" };
    }
    if (stage >= STAGE_PATCH_TREATED) return { variant: "fertiliser-talking-to-my-arm-after-treating-the-patch" };
    if (stage >= STAGE_PATCH) {
      maybeFinishPatch(player);
      if (quest.getStage(player) >= STAGE_PATCH_TREATED) {
        return { variant: "fertiliser-talking-to-my-arm-after-treating-the-patch" };
      }
      return { variant: "fertiliser-talking-to-my-arm-after-being-told-to-fetch-camel-dung" };
    }
    if (stage >= STAGE_MANUAL_READ) {
      advanceTo(player, STAGE_PATCH);
      return { variant: "fertiliser-talking-to-my-arm-again-after-reading-the-manual" };
    }
    if (stage >= STAGE_MANUAL) {
      if (!manualRead(player) && !held(player, FARMING_MANUAL_ITEM_ID)) {
        return { variant: "fertiliser-talking-to-my-arm-on-the-roof" };
      }
      return { variant: "fertiliser-talking-to-my-arm-again-before-reading-the-manual" };
    }
    if (stage >= STAGE_LUMP_GIVEN) return { variant: "fertiliser-talking-to-my-arm-on-the-roof" };
    if (stage >= STAGE_LUMP_OBTAINED) {
      if (!held(player, GOUTWEEDY_LUMP_ITEM_ID)) {
        return { variant: "starting-off-talking-to-my-arm-again" };
      }
      return { variant: "starting-off-giving-the-goutweedy-lump-to-my-arm" };
    }
    if (stage >= STAGE_FETCH_LUMP) return { variant: "starting-off-talking-to-my-arm-again" };
    advanceTo(player, STAGE_FETCH_LUMP);
    return { variant: "starting-off-talking-to-my-arm" };
  }

  /** Talk-to on the quest's My Arm spawns (name hook; the kitchen one transforms to an indexed id). */
  function talkToMyArm(event) {
    const { player, npcId } = event;
    // Secrets of the North stages 12-14 own My Arm for its Weiss information scene.
    const sotnStage = Number(player.getAttribute("quest.secrets_of_the_north.stage")) || 0;
    if (sotnStage >= 12 && sotnStage <= 14) return false;
    const choice = selectMyArmVariant(player);
    if (!choice) return false;
    if (!startTranscript(api, player, npcId, PAGE, choice.variant, choice.select)) return false;
    return undefined;
  }

  // ==========================================================================
  // Prose conditions (answered by transcript step id)
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    const answer = CONDITION_ANSWERS[stepId];
    return answer ? answer(player) : null;
  }

  let CONDITION_ANSWERS = null;

  /**
   * True while Murcaily's tuber handout is still in flight. The wiki transcript's
   * closing condition is flattened when the menu option is picked, before the
   * mid-branch handout runs, so it must be answered from the pending state.
   */
  function pendingTuberHandout(player) {
    return (
      quest.getStage(player) >= STAGE_MY_ARM_TAI &&
      quest.getStage(player) < STAGE_TUBERS &&
      hasFavour(player) &&
      !player.getInventory().isFull()
    );
  }

  function buildConditionAnswers() {
    CONDITION_ANSWERS = {
      // Swan Song branches (Swan Song has no plugin here).
      Q37xrs: (player) => isQuestComplete(player, "swan_song"),
      AL_PFX: (player) => !isQuestComplete(player, "swan_song"),
      // The "recently spoke to another player" variant needs a world-wide last
      // speaker; play the shorter line instead.
      FoNSwH: () => false,
      "-PeE7u": () => true,
      JB9zXr: (player) => held(player, GOUT_TUBER_ITEM_ID),
      oekBXW: (player) => !held(player, GOUT_TUBER_ITEM_ID),
      fB3WWn: (player) => hasClimbingBoots(player),
      "1GAdwU": (player) => !hasClimbingBoots(player),
      ANCKhM: (player) => held(player, UGTHANKI_DUNG_ITEM_ID),
      fk8s4V: (player) => !held(player, UGTHANKI_DUNG_ITEM_ID),
      KomZNs: (player) => held(player, UGTHANKI_DUNG_ITEM_ID, DUNG_REQUIRED),
      _VQMNV: (player) => !held(player, UGTHANKI_DUNG_ITEM_ID, DUNG_REQUIRED),
      laSW5e: (player) => wearingCamulet(player),
      RXVLvI: (player) => held(player, CAMULET_ITEM_ID),
      h7L84a: (player) => bankAmount(player, CAMULET_ITEM_ID) > 0,
      // Enakhra's Lament has no plugin here.
      YRODF9: () => false,
      "9oDldz": () => true,
      EDPQwk: (player) => held(player, GOUT_TUBER_ITEM_ID),
      PKAkr_: () => false,
      LrjXbd: () => true,
      LCzCSs: (player) => hasFavour(player),
      U9iWZr: (player) => player.getInventory().isFull(),
      "2jcnpj": (player) => !player.getInventory().isFull(),
      JwEK4I: (player) => held(player, HARDY_GOUT_TUBERS_ITEM_ID) || pendingTuberHandout(player),
      BFSVSd: (player) => !held(player, HARDY_GOUT_TUBERS_ITEM_ID) && !pendingTuberHandout(player),
      qkzWXp: (player) => !hasFavour(player),
      Y3aAX6: (player) => !hasFavour(player),
      RdAYao: (player) => hasFavour(player),
      H27GWA: (player) => !tubersGiven(player),
      W6tJ1M: (player) => tubersGiven(player),
      NgJQxH: (player) => isQuestComplete(player, "gertrudes_cat"),
      ohqhVv: () => false,
    };
  }

  // ==========================================================================
  // Dialogue hooks and stage directions
  // ==========================================================================

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (npcId !== BURNTMEAT_NPC_ID || hook !== START_HOOK) return;
    if (!meetsRequirements(player)) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      // A fresh start clears a previous run's state (e.g. after ::quest reset).
      resetRunState(player);
      advanceTo(player, STAGE_STARTED);
      if (!hasFavour(player)) setFavour(player, FAVOUR_REQUIRED);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !OWN_NPC_IDS.has(npcId)) return;
    switch (stepId) {
      case "FokcJz": // receive the goutweedy lump
        event.handled = true;
        give(player, GOUTWEEDY_LUMP_ITEM_ID);
        advanceTo(player, STAGE_LUMP_OBTAINED);
        return;
      case "Y2Vnf-": // give My Arm the goutweedy lump
        event.handled = true;
        player.getInventory().deleteNumber(GOUTWEEDY_LUMP_ITEM_ID, 1);
        advanceTo(player, STAGE_LUMP_GIVEN);
        return;
      case "jAIKOr": // receive the farming manual
        event.handled = true;
        if (!manualRead(player)) give(player, FARMING_MANUAL_ITEM_ID);
        advanceTo(player, STAGE_MANUAL);
        return;
      case "acPab2": // Murcaily gives one hardy gout tuber (leave the message showing)
        give(player, HARDY_GOUT_TUBER_ITEM_ID);
        return;
      case "zFrk_S": // Murcaily gives lots more (leave the message showing)
        give(player, HARDY_GOUT_TUBERS_ITEM_ID);
        if (hasFavour(player)) setFavour(player, Math.max(0, favour(player) - FAVOUR_REQUIRED));
        advanceTo(player, STAGE_TUBERS);
        return;
      case "PU8zhD": // Baby Roc appears
        event.handled = true;
        advanceTo(player, STAGE_PLANTED);
        return;
      case "fPseN2": // Giant Roc appears and attacks
        event.handled = true;
        setFirstGiantRoc(player, true);
        advanceTo(player, STAGE_GIANT_ROC);
        return;
      case "Ame-i9": // the Drunken Dwarf cutscene ends
        setDwarfJoke(player, true);
        return;
      case "TyG1h-": // the harvest grants 45 x 7 Farming XP (leave the message showing)
        player.getSkillManager().addExperiences(Skill.FARMING, HARVEST_FARMING_XP);
        return;
      case "9QjWHh": // "receive a full inventory of burnt meat"
        give(player, BURNT_MEAT_ITEM_ID, BURNT_MEAT_REWARD);
        advanceTo(player, STAGE_REWARDED);
        return;
      case "Q3LdZt":
        event.handled = true;
        if (!quest.isComplete(player)) quest.complete(player);
        syncNpcs(player);
        return;
      default:
        return;
    }
  }

  /** The boat trip ends on the last player line; move the player to Brimhaven then. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || !MY_ARM_NPC_IDS.has(npcId) || text !== TRIP_END_LINE) return;
    if (quest.getStage(player) >= STAGE_KARAMJA) return;
    advanceTo(player, STAGE_KARAMJA);
    const pending = player;
    TaskManager.submit(new CountdownTask(player, 2, () => {
      if (pending.isRegistered?.() === false) return;
      TeleportHandler.teleport(pending, BRIMHAVEN_DOCK, TeleportType.NORMAL, false);
    }));
  }

  /** Fills the page's "[player name]"/"[location of player-owned house]" blanks (ForsakenTower/Myreque pattern). */
  function fillTranscriptBlanks(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!OWN_NPC_IDS.has(request.npcId)) return;
    let text = request.text;
    if (/\[player name\]|<player name>/i.test(text)) {
      const name = String(request.player.getUsername());
      text = text.replace(/\[player name\]/gi, name).replace(/<player name>/gi, name);
    }
    if (text.includes("[location of player-owned house]")) {
      text = text.replace(/\[location of player-owned house\]/gi, playerHouseLocation(request.player));
    }
    request.text = text;
  }

  function playerHouseLocation(player) {
    const save = player.getAttribute?.(POH_HOUSE_ATTRIBUTE);
    const id = save && typeof save === "object" ? Number(save.location) : NaN;
    return POH_LOCATION_NAMES.get(id) ?? "Rimmington";
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  /** Bucket on the Death Plateau cooking pot. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (!player) return;
    if (itemId === BUCKET_ITEM_ID && objectId === COOKING_POT_OBJECT_ID) {
      event.handled = true;
      const stage = quest.getStage(player);
      if (stage >= STAGE_FETCH_LUMP && stage < STAGE_LUMP_OBTAINED) {
        startTranscript(api, player, MY_ARM_SPAWN_ID, PAGE, "starting-off-obtaining-the-goutweedy-lump");
      } else if (stage >= STAGE_STARTED) {
        startTranscript(api, player, MY_ARM_SPAWN_ID, PAGE, "starting-off-attempting-to-scoop-from-the-pot-again");
      }
      return;
    }
    if (!isRoofPatch(objectId, location)) return;
    const stage = quest.getStage(player);
    if (stage !== STAGE_PATCH) return;
    event.handled = true;
    if (itemId === UGTHANKI_DUNG_ITEM_ID) {
      addDung(player);
      return;
    }
    if (itemId === SUPERCOMPOST_ITEM_ID) {
      addSupercompost(player);
      return;
    }
    if (itemId === COMPOST_ITEM_ID || itemId === ULTRACOMPOST_ITEM_ID) {
      play(player, "fertiliser-preparing-the-patch-using-normal-compost-or-ultracompost-on-the-patch");
      return;
    }
    play(player, "fertiliser-preparing-the-patch-using-an-irrelevant-item-on-the-patch");
  }

  function addDung(player) {
    if (!held(player, SPADE_ITEM_ID)) {
      play(player, "fertiliser-preparing-the-patch-using-ugthanki-dung-on-the-patch-without-a-spade");
      return;
    }
    maybeFinishPatch(player);
    if (dungCount(player) >= DUNG_REQUIRED) {
      play(player, "fertiliser-preparing-the-patch-adding-more-ugthanki-dung-than-needed");
      return;
    }
    player.getInventory().deleteNumber(UGTHANKI_DUNG_ITEM_ID, 1);
    setDungCount(player, dungCount(player) + 1);
    if (dungCount(player) >= DUNG_REQUIRED) {
      play(player, "fertiliser-preparing-the-patch-adding-the-last-ugthanki-dung-to-the-patch");
    }
    maybeFinishPatch(player);
  }

  function addSupercompost(player) {
    if (!held(player, SPADE_ITEM_ID)) {
      play(player, "fertiliser-preparing-the-patch-using-supercompost-on-the-patch-without-a-spade");
      return;
    }
    maybeFinishPatch(player);
    if (compostCount(player) >= SUPERCOMPOST_REQUIRED) {
      play(player, "fertiliser-preparing-the-patch-adding-more-supercompost-than-needed");
      return;
    }
    player.getInventory().deleteNumber(SUPERCOMPOST_ITEM_ID, 1);
    setCompostCount(player, compostCount(player) + 1);
    if (compostCount(player) >= SUPERCOMPOST_REQUIRED) {
      play(player, "fertiliser-preparing-the-patch-adding-the-last-supercompost-to-the-patch");
    }
    maybeFinishPatch(player);
  }

  /** Repairs the broken rake. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(RAKE_HEAD_ITEM_ID) || !pair.has(RAKE_HANDLE_ITEM_ID)) return;
    event.handled = true;
    player.getInventory().deleteNumber(RAKE_HEAD_ITEM_ID, 1);
    player.getInventory().deleteNumber(RAKE_HANDLE_ITEM_ID, 1);
    give(player, RAKE_ITEM_ID);
    player.sendMessage(RAKE_REATTACH_MESSAGE);
  }

  /** Items used on My Arm: the planting sequence, the spade hand-in and the jokes. */
  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!player || !MY_ARM_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    event.handled = true;
    if (itemId === GOUTWEEDY_LUMP_ITEM_ID && stage === STAGE_LUMP_OBTAINED) {
      play(player, "starting-off-giving-the-goutweedy-lump-to-my-arm");
      return;
    }
    if (stage < STAGE_TOOLS) return;
    if (itemId === RAKE_ITEM_ID) {
      giveRake(player);
      return;
    }
    if (itemId === SUPERCOMPOST_ITEM_ID || itemId === ULTRACOMPOST_ITEM_ID) {
      giveCompost(player, itemId);
      return;
    }
    if (itemId === HARDY_GOUT_TUBERS_ITEM_ID || itemId === HARDY_GOUT_TUBER_ITEM_ID) {
      giveTubers(player, itemId);
      return;
    }
    if (itemId === SEED_DIBBER_ITEM_ID) {
      giveDibber(player);
      return;
    }
    if (itemId === PLANT_CURE_ITEM_ID) {
      givePlantCure(player);
      return;
    }
    if (itemId === SPADE_ITEM_ID) {
      giveSpade(player);
      return;
    }
    if (isNoted(itemId)) {
      play(player, "the-rocs-giving-my-arm-farming-items-giving-banknotes");
      return;
    }
    if (stage >= STAGE_GIANT_ROC) {
      play(player, "the-rocs-giving-my-arm-an-item-other-than-a-spade");
      return;
    }
    play(player, "the-rocs-giving-my-arm-farming-items-giving-an-irrelevant-item");
  }

  function giveRake(player) {
    if (fakePatch(player) >= PATCH_RAKED) {
      play(player, "the-rocs-giving-my-arm-farming-items-giving-rake-or-spade-after-weeding");
      return;
    }
    if (!rakeJoke(player)) {
      setRakeJoke(player, true);
      player.getInventory().deleteNumber(RAKE_ITEM_ID, 1);
      give(player, RAKE_HANDLE_ITEM_ID);
      api.getItemOnGroundManager().registerLocation(player, new Item(RAKE_HEAD_ITEM_ID, 1), RAKE_HEAD_TILE);
      player.sendMessage(RAKE_BREAK_MESSAGE);
      return;
    }
    player.getInventory().deleteNumber(RAKE_ITEM_ID, 1);
    addTool(player, TOOL_RAKE);
    setFakePatch(player, PATCH_RAKED);
    player.sendMessage(RAKE_DONE_MESSAGE);
  }

  function giveCompost(player, itemId) {
    if (fakePatch(player) >= PATCH_COMPOST) {
      play(player, "the-rocs-giving-my-arm-farming-items-giving-compost-after-the-patch-is-already-treated");
      return;
    }
    if (fakePatch(player) < PATCH_RAKED) {
      play(player, "the-rocs-giving-my-arm-farming-items-giving-an-irrelevant-item");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    setFakePatch(player, PATCH_COMPOST);
    player.sendMessage(COMPOST_ADDED_MESSAGE);
  }

  function giveTubers(player, itemId) {
    if (!tubersGiven(player)) {
      if (fakePatch(player) < PATCH_RAKED) {
        play(player, "the-rocs-giving-my-arm-farming-items-giving-an-irrelevant-item");
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      setTubersGiven(player, true);
      setFakePatch(player, Math.max(fakePatch(player), PATCH_TUBERS));
    }
    play(player, "the-rocs-giving-my-arm-farming-items-giving-hardy-gout-tubers");
  }

  function giveDibber(player) {
    if (!tubersGiven(player)) {
      play(player, "the-rocs-giving-my-arm-farming-items-giving-seed-dibber-before-tubers");
      return;
    }
    if (fakePatch(player) >= PATCH_PLANTED) {
      play(player, "the-rocs-giving-my-arm-farming-items-giving-rake-or-spade-after-weeding");
      return;
    }
    player.getInventory().deleteNumber(SEED_DIBBER_ITEM_ID, 1);
    addTool(player, TOOL_DIBBER);
    setFakePatch(player, PATCH_PLANTED);
    play(player, "the-rocs-after-my-arm-plants-the-gout-tubers");
  }

  function givePlantCure(player) {
    if (fakePatch(player) < PATCH_RAKED) {
      play(player, "the-rocs-giving-my-arm-farming-items-plant-cure-before-weeding");
      return;
    }
    player.getInventory().deleteNumber(PLANT_CURE_ITEM_ID, 1);
    setPlantCureGiven(player, true);
  }

  function giveSpade(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_SPADE && stage < STAGE_HARVESTED) {
      player.getInventory().deleteNumber(SPADE_ITEM_ID, 1);
      addTool(player, TOOL_SPADE);
      advanceTo(player, STAGE_HARVESTED);
      play(player, "the-rocs-giving-my-arm-a-spade");
      return;
    }
    play(player, "the-rocs-giving-my-arm-farming-items-giving-rake-or-spade-after-weeding");
  }

  /** Reading the manual unlocks the fertiliser step. */
  function readManual(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_MANUAL) return;
    setManualRead(player, true);
    advanceTo(player, STAGE_MANUAL_READ);
    player.sendMessage(MANUAL_READ_MESSAGE);
  }

  // ==========================================================================
  // Combat, spawns and login
  // ==========================================================================

  function handleNpcDeath(event) {
    const killer = event.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;
    if (event.npcId === BABY_ROC_NPC_ID && quest.getStage(killer) === STAGE_PLANTED) {
      setBabyRocDead(killer, true);
      removeTracked(killer, "baby-roc");
      syncNpcs(killer);
      return;
    }
    if (event.npcId === GIANT_ROC_NPC_ID && quest.getStage(killer) === STAGE_GIANT_ROC) {
      setGiantRocDead(killer, true);
      removeTracked(killer, "giant-roc");
      syncNpcs(killer);
    }
  }

  const trackedNpcs = new Map();

  function ensureTracked(player, key, definition) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    const existing = tracked.get(key);
    // Dead owner-only spawns stay dead; drop the stale reference so the stage can respawn one.
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

  function clearNpcs(player) {
    const tracked = trackedNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  /** Keeps the owner-only quest NPCs (My Arm, Murcaily, the Rocs) in step with the stage. */
  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    const onRoof = (stage >= STAGE_LUMP_GIVEN && stage < STAGE_KARAMJA) || stage >= STAGE_TUBERS;
    const atVillage = stage >= STAGE_KARAMJA && stage < STAGE_TUBERS;
    if (onRoof) ensureTracked(player, "my-arm-roof", { id: MY_ARM_SPAWN_ID, ...MY_ARM_ROOF_TILE, wanderRadius: 0 });
    else removeTracked(player, "my-arm-roof");
    if (atVillage) ensureTracked(player, "my-arm-tai", { id: MY_ARM_SPAWN_ID, ...MY_ARM_TAI_TILE, wanderRadius: 0 });
    else removeTracked(player, "my-arm-tai");
    if (atVillage) ensureTracked(player, "murcaily", { id: MURCAILY_SPAWN_ID, ...MURCAILY_TILE, wanderRadius: 0 });
    else removeTracked(player, "murcaily");
    if (stage === STAGE_PLANTED && !babyRocDead(player)) {
      ensureTracked(player, "baby-roc", { id: BABY_ROC_NPC_ID, ...BABY_ROC_TILE, wanderRadius: 0 });
    } else removeTracked(player, "baby-roc");
    if (stage === STAGE_GIANT_ROC && !giantRocDead(player)) {
      ensureTracked(player, "giant-roc", { id: GIANT_ROC_NPC_ID, ...GIANT_ROC_TILE, wanderRadius: 0 });
    } else removeTracked(player, "giant-roc");
  }

  function handleZoneEnter({ player }) {
    syncNpcs(player);
  }

  function handleLogin({ player }) {
    syncNpcs(player);
    syncVarbits(player);
    refreshQuestList(player);
    // A rake head lost to a logout before pickup is re-placed on the roof.
    if (
      quest.getStage(player) === STAGE_TOOLS &&
      rakeJoke(player) &&
      fakePatch(player) < PATCH_RAKED &&
      !held(player, RAKE_ITEM_ID) &&
      !held(player, RAKE_HEAD_ITEM_ID)
    ) {
      api.getItemOnGroundManager().registerLocation(player, new Item(RAKE_HEAD_ITEM_ID, 1), RAKE_HEAD_TILE);
    }
  }

  function handleLogout({ player }) {
    clearNpcs(player);
  }

  // ==========================================================================
  // State helpers
  // ==========================================================================

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => {
    if (!held(player, itemId)) player.getInventory().adds(itemId, amount);
  };

  function advanceTo(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
    syncNpcs(player);
  }

  function play(player, variant) {
    startTranscript(api, player, MY_ARM_SPAWN_ID, PAGE, variant);
  }

  /** Narrows a variant to the tail that starts at a known line. */
  function fromLine(text) {
    return (steps) => {
      const index = Array.isArray(steps)
        ? steps.findIndex((step) => step.text === text || step.npc === text || step.player === text)
        : -1;
      return index === -1 ? steps : steps.slice(index);
    };
  }

  function isRoofPatch(objectId, location) {
    if (objectId === ROOF_PATCH_OBJECT_ID) return true;
    return Boolean(
      location &&
        location.z === 0 &&
        location.x >= 2826 &&
        location.x <= 2827 &&
        location.y >= 3694 &&
        location.y <= 3695
    );
  }

  function isNoted(itemId) {
    return (CacheDefinitions.getItem(itemId)?.noteTemplate ?? -1) >= 0;
  }

  function wearingCamulet(player) {
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === CAMULET_ITEM_ID;
  }

  function hasClimbingBoots(player) {
    return held(player, CLIMBING_BOOTS_ITEM_ID) || player.getEquipment().contains(CLIMBING_BOOTS_ITEM_ID);
  }

  function bankAmount(player, itemId) {
    try {
      const bank = player.getBank?.();
      return Number(bank?.getAmount?.(itemId) ?? 0);
    } catch {
      return 0;
    }
  }

  function isQuestComplete(player, key) {
    if (!key) return false;
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Wiki requirements; The Feud has no plugin and is not gated. */
  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    if (skills.getCurrentLevel(Skill.FARMING) < FARMING_REQUIREMENT) return false;
    if (skills.getMaxLevel(Skill.WOODCUTTING) < WOODCUTTING_REQUIREMENT) return false;
    return (
      isQuestComplete(player, "eadgars_ruse") &&
      isQuestComplete(player, "troll_stronghold") &&
      isQuestComplete(player, "jungle_potion")
    );
  }

  // Persisted sub-state, mirrored to the sibling varbits.

  function dungCount(player) {
    return Number(player.getAttribute(DUNG_ATTRIBUTE)) || 0;
  }
  function setDungCount(player, value) {
    player.setAttribute(DUNG_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_DUNG, value);
  }

  function compostCount(player) {
    return Number(player.getAttribute(COMPOST_ATTRIBUTE)) || 0;
  }
  function setCompostCount(player, value) {
    player.setAttribute(COMPOST_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_SUPERCOMPOST, value);
  }

  function manualRead(player) {
    return player.getAttribute(MANUAL_READ_ATTRIBUTE) === true;
  }
  function setManualRead(player, value) {
    player.setAttribute(MANUAL_READ_ATTRIBUTE, value);
  }

  function tubersGiven(player) {
    return player.getAttribute(TUBERS_ATTRIBUTE) === true;
  }
  function setTubersGiven(player, value) {
    player.setAttribute(TUBERS_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_TUBERS, value ? 1 : 0);
  }

  function rakeJoke(player) {
    return player.getAttribute(RAKE_JOKE_ATTRIBUTE) === true;
  }
  function setRakeJoke(player, value) {
    player.setAttribute(RAKE_JOKE_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_RAKEJOKE, value ? 1 : 0);
  }

  function dwarfJoke(player) {
    return player.getAttribute(DWARF_JOKE_ATTRIBUTE) === true;
  }
  function setDwarfJoke(player, value) {
    player.setAttribute(DWARF_JOKE_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_DWARFJOKE, value ? 1 : 0);
  }

  function firstGiantRoc(player) {
    return player.getAttribute(FIRST_GIANT_ROC_ATTRIBUTE) === true;
  }
  function setFirstGiantRoc(player, value) {
    player.setAttribute(FIRST_GIANT_ROC_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_FIRST_GIANT_ROC, value ? 1 : 0);
  }

  function plantCureGiven(player) {
    return player.getAttribute(PLANT_CURE_ATTRIBUTE) === true;
  }
  function setPlantCureGiven(player, value) {
    player.setAttribute(PLANT_CURE_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_BARNABYSWAP, value ? 1 : 0);
  }

  function fakePatch(player) {
    return Number(player.getAttribute(FAKEPATCH_ATTRIBUTE)) || 0;
  }
  function setFakePatch(player, value) {
    player.setAttribute(FAKEPATCH_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_FAKEPATCH, value);
  }

  function favour(player) {
    return Number(player.getAttribute(FAVOUR_ATTRIBUTE)) || 0;
  }
  function setFavour(player, value) {
    player.setAttribute(FAVOUR_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_TAI_BWO_FAVOUR, value);
  }
  function hasFavour(player) {
    return favour(player) >= FAVOUR_REQUIRED;
  }

  function babyRocDead(player) {
    return player.getAttribute(BABY_ROC_DEAD_ATTRIBUTE) === true;
  }
  function setBabyRocDead(player, value) {
    player.setAttribute(BABY_ROC_DEAD_ATTRIBUTE, value);
  }

  function giantRocDead(player) {
    return player.getAttribute(GIANT_ROC_DEAD_ATTRIBUTE) === true;
  }
  function setGiantRocDead(player, value) {
    player.setAttribute(GIANT_ROC_DEAD_ATTRIBUTE, value);
  }

  function addTool(player, tool) {
    player.setAttribute(TOOLS_ATTRIBUTE, (Number(player.getAttribute(TOOLS_ATTRIBUTE)) || 0) | tool);
  }

  function maybeFinishPatch(player) {
    if (dungCount(player) >= DUNG_REQUIRED && compostCount(player) >= SUPERCOMPOST_REQUIRED) {
      advanceTo(player, STAGE_PATCH_TREATED);
    }
  }

  /** Clears the quest's sub-state so a reset quest can be run again. */
  function resetRunState(player) {
    setDungCount(player, 0);
    setCompostCount(player, 0);
    setManualRead(player, false);
    setTubersGiven(player, false);
    setRakeJoke(player, false);
    setDwarfJoke(player, false);
    setFirstGiantRoc(player, false);
    setPlantCureGiven(player, false);
    setFakePatch(player, 0);
    setBabyRocDead(player, false);
    setGiantRocDead(player, false);
    player.setAttribute(TOOLS_ATTRIBUTE, 0);
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_DUNG, dungCount(player));
    sender.sendVarbit(VARBIT_SUPERCOMPOST, compostCount(player));
    sender.sendVarbit(VARBIT_TUBERS, tubersGiven(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_RAKEJOKE, rakeJoke(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_DWARFJOKE, dwarfJoke(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_FIRST_GIANT_ROC, firstGiantRoc(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_BARNABYSWAP, plantCureGiven(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_FAKEPATCH, fakePatch(player));
    sender.sendVarbit(VARBIT_TAI_BWO_FAVOUR, favour(player));
    sender.sendVarbit(VARBIT_SHIPCHAT, 0);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped My Arm grow goutweed on the roof of the Troll</str>",
        "<str>Stronghold, defeating the Baby and Giant Rocs that came for it.</str>",
        "<str>I now have access to the disease-free herb patch there.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Burntmeat</col> in",
        "the <col=800000>Troll Stronghold</col> kitchen.",
        "",
        "I need <col=800000>Eadgar's Ruse</col>, <col=800000>Jungle Potion</col>,",
        "29 <col=800000>Farming</col>, 10 <col=800000>Woodcutting</col> and 60%",
        "Tai Bwo Wannai favour.",
      ];
    }
    if (stage >= STAGE_REWARDED) {
      return [
        "Burntmeat gave me his 'special' reward, a pile of burnt meat.",
        "",
        "I should speak to <col=800000>My Arm</col> on the roof for his",
        "better reward.",
      ];
    }
    if (stage >= STAGE_HARVESTED) {
      return [
        "The goutweed is harvested. My Arm sent me to speak to",
        "<col=800000>Burntmeat</col> in the kitchen for my reward.",
      ];
    }
    if (stage >= STAGE_SPADE) {
      return [
        "The Giant Roc is dead. I should give <col=800000>My Arm</col> a",
        "spade so he can harvest the goutweed.",
      ];
    }
    if (stage >= STAGE_GIANT_ROC) {
      return [
        "A <col=800000>Giant Roc</col> attacked the goutweed.",
        "I should kill it and speak to <col=800000>My Arm</col>.",
      ];
    }
    if (stage >= STAGE_PLANTED) {
      return [
        "A <col=800000>Baby Roc</col> swooped down to eat the goutweed.",
        "I should kill it and speak to <col=800000>My Arm</col>.",
      ];
    }
    if (stage >= STAGE_TOOLS) {
      if (fakePatch(player) >= PATCH_PLANTED) {
        return [
          "My Arm is planting the hardy gout tubers in his patch.",
          "I should wait for the goutweed to grow.",
        ];
      }
      if (!rakeJoke(player) || fakePatch(player) < PATCH_RAKED) {
        return [
          "I should give <col=800000>My Arm</col> a <col=800000>rake</col>",
          "so he can clear his farming patch. His rake may break.",
        ];
      }
      const lines = [
        "The patch is raked. I should give <col=800000>My Arm</col> the",
        "hardy gout tubers and a seed dibber, plus supercompost if I have it.",
      ];
      if (tubersGiven(player)) lines.push("<str>I gave My Arm the hardy gout tubers.</str>");
      return lines;
    }
    if (stage >= STAGE_TUBERS) {
      return [
        "Murcaily gave me the hardy gout tubers.",
        "I should meet <col=800000>My Arm</col> by his patch on the roof of",
        "the <col=800000>Troll Stronghold</col>, ready for a fight.",
      ];
    }
    if (stage >= STAGE_MY_ARM_TAI) {
      return [
        "I should ask <col=800000>Murcaily</col> in <col=800000>Tai Bwo",
        "Wannai</col> for a hardy gout tuber.",
      ];
    }
    if (stage >= STAGE_KARAMJA) {
      return [
        "I arrived on Karamja. I should find <col=800000>My Arm</col>",
        "east of the general store in <col=800000>Tai Bwo Wannai</col>.",
      ];
    }
    if (stage >= STAGE_PATCH_TREATED) {
      return [
        "The soil patch is treated. I should speak to <col=800000>My Arm</col>",
        "about getting goutweed tubers from <col=800000>Tai Bwo Wannai</col>.",
      ];
    }
    if (stage >= STAGE_PATCH) {
      return [
        "I should add <col=800000>3 buckets of ugthanki dung</col> and",
        "<col=800000>7 buckets of supercompost</col> to My Arm's patch with a spade.",
      ];
    }
    if (stage >= STAGE_MANUAL_READ) {
      return [
        "I have read the farming manual.",
        "I should speak to <col=800000>My Arm</col> about preparing the patch.",
      ];
    }
    if (stage >= STAGE_MANUAL) {
      return [
        "My Arm gave me a <col=800000>farming manual</col>. I should read it.",
      ];
    }
    if (stage >= STAGE_LUMP_GIVEN) {
      return [
        "My Arm ate the goutweedy lump. I should meet him on the roof of",
        "the <col=800000>Troll Stronghold</col>.",
      ];
    }
    if (stage >= STAGE_LUMP_OBTAINED) {
      return [
        "I have the <col=800000>goutweedy lump</col>.",
        "I should give it to <col=800000>My Arm</col> in the Troll Stronghold.",
      ];
    }
    if (stage >= STAGE_FETCH_LUMP) {
      return [
        "My Arm wants the <col=800000>goutweedy lump</col> from the cooking",
        "pot on <col=800000>Death Plateau</col>.",
      ];
    }
    return [
      "I spoke to <col=800000>Burntmeat</col>, who wants me to help his",
      "assistant <col=800000>My Arm</col> learn to farm goutweed.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.HERBLORE, HERBLORE_REWARD_XP);
    skills.addExperiences(Skill.FARMING, FARMING_REWARD_XP);
    // My Arm returns the tools he borrowed near the end of the quest.
    const tools = Number(player.getAttribute(TOOLS_ATTRIBUTE)) || 0;
    if (tools & TOOL_RAKE) give(player, RAKE_ITEM_ID);
    if (tools & TOOL_DIBBER) give(player, SEED_DIBBER_ITEM_ID);
    if (tools & TOOL_SPADE) give(player, SPADE_ITEM_ID);
    player.setAttribute(TOOLS_ATTRIBUTE, 0);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  buildConditionAnswers();

  api.persistAttribute(DUNG_ATTRIBUTE);
  api.persistAttribute(COMPOST_ATTRIBUTE);
  api.persistAttribute(MANUAL_READ_ATTRIBUTE);
  api.persistAttribute(TUBERS_ATTRIBUTE);
  api.persistAttribute(RAKE_JOKE_ATTRIBUTE);
  api.persistAttribute(DWARF_JOKE_ATTRIBUTE);
  api.persistAttribute(FIRST_GIANT_ROC_ATTRIBUTE);
  api.persistAttribute(PLANT_CURE_ATTRIBUTE);
  api.persistAttribute(FAKEPATCH_ATTRIBUTE);
  api.persistAttribute(FAVOUR_ATTRIBUTE);
  api.persistAttribute(BABY_ROC_DEAD_ATTRIBUTE);
  api.persistAttribute(GIANT_ROC_DEAD_ATTRIBUTE);
  api.persistAttribute(TOOLS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "my_arms_big_adventure",
    name: "My Arm's Big Adventure",
    varpId: 905, // myarm_quest
    varbitId: 2790, // myarm
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.HERBLORE.getIndex(), amount: HERBLORE_REWARD_XP, label: "Herblore" },
      { skillId: Skill.FARMING.getIndex(), amount: FARMING_REWARD_XP, label: "Farming" },
    ],
    scrollItemId: BURNT_MEAT_ITEM_ID,
    rewardItemLabel: `${BURNT_MEAT_REWARD} Burnt meat`,
    otherRewards: [
      "Access to a disease-free herb patch on top of the Troll Stronghold",
      "Ability to use the Troll Stronghold rocks shortcut",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("My Arm", { "Talk-to": talkToMyArm });
  api.onNpcInteraction("Burntmeat", { "Talk-to": talkToBurntmeat });
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptBlanks);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction("Farming manual", { Read: readManual });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onZoneEnter(ROOF_ZONE, handleZoneEnter);
  api.onZoneEnter(VILLAGE_ZONE, handleZoneEnter);
};
