/**
 * Tai Bwo Wannai Trio (members).
 *
 * Words come from the "Tai Bwo Wannai Trio" transcript page; this plugin
 * supplies the variant selector for Timfraku, Tiadeche, Tinsay, Tamayu and
 * Lubufu, the prose-condition answers, the start hook, the item-on-item /
 * item-on-NPC / item-on-object conversions (karambwan vessel, pastes, monkey
 * corpse, banana rum, jogre bones, karambwan paste on a spear), the fishing
 * spots by the Holy Lake and Brimhaven, the tribal statue and the bamboo
 * door, plus completion via Timfraku's reward and the post-quest training
 * claimed from the three sons.
 *
 * Stages (varp 320): 3 started, 4 all three sons home, 5 complete. Per-brother
 * progress is kept in persisted attributes (quest.tai_bwo_wannai_trio.*).
 *
 * Source: LostCityRS/Content scripts/quests/quest_tbwt at the pinned revision.
 * Gaps: the rock/bridge crossing and the Shaikahan cutscene/fight are not
 * simulated (Tamayu's hunt is resolved from the transcript's cutscene actions);
 * the shops and Tamayu's open_interface are left to the dialogue runtime; the
 * Cleanup-minigame checks answer "not participated"; the firemaking path for
 * burning jogre bones is folded into the Cooking requirement; damage from
 * explosions/falls is not applied.
 */
module.exports = function registerTaiBwoWannaiTrioQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Tai Bwo Wannai Trio";

  const VARP_TAI_BWO_WANNAI_TRIO = 320; // OSRS TBWT_MAIN
  const STAGE_STARTED = 3;
  const STAGE_BROTHERS_DONE = 4;
  const STAGE_COMPLETE = 5;

  const TIMFRAKU_ID = NpcIdentifiers.TIMFRAKU;
  const TIADECHE_IDS = new Set([NpcIdentifiers.TIADECHE, NpcIdentifiers.TIADECHE_2]);
  const TINSAY_IDS = new Set([NpcIdentifiers.TINSAY, NpcIdentifiers.TINSAY_2]);
  const TAMAYU_IDS = new Set([
    NpcIdentifiers.TAMAYU,
    NpcIdentifiers.TAMAYU_2,
    NpcIdentifiers.TAMAYU_3,
    NpcIdentifiers.TAMAYU_4,
  ]);
  const LUBUFU_ID = NpcIdentifiers.LUBUFU;

  const KARAMBWANJI_SPOT_IDS = new Set([NpcIdentifiers.FISHING_SPOT_58]); // 4710, Holy Lake
  const KARAMBWAN_SPOT_IDS = new Set([
    NpcIdentifiers.FISHING_SPOT_60,
    NpcIdentifiers.FISHING_SPOT_61,
    NpcIdentifiers.FISHING_SPOT_62,
  ]); // 4712, 4713, 4714

  const STATUE_IDS = new Set([
    ObjectIdentifiers.TRIBAL_STATUE,
    ObjectIdentifiers.TRIBAL_STATUE_2,
    ObjectIdentifiers.TRIBAL_STATUE_3,
  ]);
  const BAMBOO_DOOR_ID = ObjectIdentifiers.BAMBOO_DOOR; // 779

  const START_HOOK = "quest:tai-bwo-wannai-trio:start";
  const JUNGLE_POTION_STAGE = "quest.jungle_potion.stage";
  const JUNGLE_POTION_COMPLETE = 12;

  // Cooked karambwanji is Null in the generated identifiers; cache id 3151.
  const COOKED_KARAMBWANJI = 3151;
  const COOKING_OBJECT_NAMES = new Set(["Fire", "Range", "Cooking range", "Stove", "Fireplace", "Furnace"]);

  const ITEM = ItemIdentifiers;
  const AGILITY_POTION_DOSES = new Map([
    [ITEM.AGILITY_POTION_4_, 4],
    [ITEM.AGILITY_POTION_3_, 3],
    [ITEM.AGILITY_POTION_2_, 2],
    [ITEM.AGILITY_POTION_1_, 1],
  ]);

  const KP_BY_BASE = new Map();
  const ACCEPTABLE_SPEARS = new Set();
  const POISONED_SPEARS = new Set();
  const KP_SPEARS = new Set();
  for (const [ids, kp] of [
    [[1237, 1251, 5704, 5718], ITEM.BRONZE_SPEAR_KP_],
    [[1239, 1253, 5706, 5720], ITEM.IRON_SPEAR_KP_],
    [[1241, 1255, 5708, 5722], ITEM.STEEL_SPEAR_KP_],
    [[1243, 1257, 5710, 5724], ITEM.MITHRIL_SPEAR_KP_],
    [[1245, 1259, 5712, 5726], ITEM.ADAMANT_SPEAR_KP_],
    [[1247, 1261, 5714, 5728], ITEM.RUNE_SPEAR_KP_],
    [[1249, 1263, 5716, 5730], ITEM.DRAGON_SPEAR_KP_],
    [[4580, 4582, 5734, 5736], ITEM.BLACK_SPEAR_KP_],
  ]) {
    KP_SPEARS.add(kp);
    for (const id of ids) {
      KP_BY_BASE.set(id, kp);
      if (kp === ITEM.BRONZE_SPEAR_KP_) continue;
      ACCEPTABLE_SPEARS.add(id);
    }
  }
  for (const id of [1253, 1255, 1257, 1259, 1261, 1263, 5706, 5708, 5710, 5712, 5714, 5716, 5720, 5722, 5724, 5726, 5728, 5730]) {
    POISONED_SPEARS.add(id);
  }
  for (const id of [ITEM.IRON_SPEAR_KP_, ITEM.STEEL_SPEAR_KP_, ITEM.MITHRIL_SPEAR_KP_, ITEM.ADAMANT_SPEAR_KP_, ITEM.RUNE_SPEAR_KP_, ITEM.DRAGON_SPEAR_KP_, ITEM.BLACK_SPEAR_KP_]) {
    ACCEPTABLE_SPEARS.add(id);
  }

  const TIADECHE_KEY = "quest.tai_bwo_wannai_trio.tiadeche";
  const TINSAY_KEY = "quest.tai_bwo_wannai_trio.tinsay";
  const TAMAYU_KEY = "quest.tai_bwo_wannai_trio.tamayu";
  const LUBUFU_KEY = "quest.tai_bwo_wannai_trio.lubufu";
  const AGILITY_KEY = "quest.tai_bwo_wannai_trio.agility";
  const SPEAR_KEY = "quest.tai_bwo_wannai_trio.spear";
  const TITLE_KEY = "quest.tai_bwo_wannai_trio.title";
  const KARAMBWAN_KEY = "quest.tai_bwo_wannai_trio.karambwan";
  const LUBUFU_COUNT_KEY = "quest.tai_bwo_wannai_trio.lubufu-count";

  const TIADECHE_WAITING = 2;
  const TIADECHE_MANUAL = 4;
  const TIADECHE_HAS_MANUAL = 5;
  const TIADECHE_DONE = 6;
  const TIADECHE_CLAIMED = 7;

  const TINSAY_BANANA = 2;
  const TINSAY_SANDWICH = 4;
  const TINSAY_BONES = 6;
  const TINSAY_DONE = 7;
  const TINSAY_CLAIMED = 8;

  const TAMAYU_WATCHED = 3;
  const TAMAYU_DONE = 4;
  const TAMAYU_CLAIMED = 5;

  const LUBUFU_FETCH = 5;
  const LUBUFU_GIVEN = 25;
  const LUBUFU_APPRENTICE = 31;

  // Transcript action/message ids handled below.
  const COMPLETE_MESSAGE_ID = "SUa3hN";
  const TIADECHE_VESSEL_MESSAGE_ID = "ZUMuMt";
  const TIADECHE_VESSEL_RETURN_ID = "DSvWDo";
  const TIADECHE_KARAMBWANJI_MESSAGE_ID = "ggBY_Z";
  const TIADECHE_LOADED_VESSEL_MESSAGE_ID = "Tbc1Ao";
  const TIADECHE_FIRST_CATCH_ID = "1kqTlj";
  const TIADECHE_ANOTHER_CATCH_ID = "qZLfX8";
  const TIADECHE_RETURN_ID = "ANSmTx";
  const TIADECHE_RETURN_ALT_ID = "fXp887";
  const TIADECHE_MANUAL_MESSAGE_ID = "IaGlW4";

  const TINSAY_PAUSE_MESSAGE_ID = "y3Vbh-";
  const TINSAY_VESSEL_HANDOVER_IDS = new Set(["e9Ifrf", "bOGzJV"]);
  const TINSAY_MANUAL_ID = "421qSm";
  const TINSAY_BANANA_ID = "IXEFig";
  const TINSAY_SANDWICH_ID = "pLz59h";
  const TINSAY_PERFECT_BONES_ID = "oYUlzJ";
  const TINSAY_COOKED_PASTE_BONES_ID = "1hgXFH"; // 3132
  const TINSAY_RAW_PASTE_BONES_ID = "wOLrxV"; // 3131
  const TINSAY_BURNT_RAW_PASTE_ID = "OMlNu0"; // 3128
  const TINSAY_BURNT_COOKED_PASTE_ID = "coR50A"; // 3129
  const TINSAY_MARINATED_UNBURNT_ID = "R2IY0e"; // 3133

  const TAMAYU_POTION_MESSAGES = new Map([
    ["DHN2LM", 1],
    ["GVkJzh", 2],
    ["QceuSt", 3],
    ["-pLuPZ", 4],
  ]);
  const TAMAYU_SPEAR_MESSAGE_ID = "uM0CUJ";
  const TAMAYU_WATCH_CUTSCENE_ID = "cMkbX1";
  const TAMAYU_KILL_CUTSCENE_ID = "qnTEqZ";
  const TAMAYU_SKIN_ACTION_ID = "c_cWgA";
  const TAMAYU_ATTACK_XP_ID = "EuOV9w";
  const TAMAYU_SPEAR_REWARD_ID = "DdMC-c";

  const LUBUFU_ALL_KARAMBWANJI_ID = "eRXQyV";
  const LUBUFU_PARTIAL_IDS = new Set(["AiuAjU", "JFyxPu"]);
  const LUBUFU_VESSEL_REWARD_ID = "SwVHKY";
  const LUBUFU_VESSEL_RECOVER_ID = "Pl7-5H";

  const TIADECHE_FISHING_XP_ID = "C5UYJa";
  const TINSAY_COOKING_XP_ID = "7ImFQ8";

  let quest;
  /** Item the player just used on an NPC; drives used-item prose conditions. */
  const lastUsedItem = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const state = (player, key) => Number(player.getAttribute(key)) || 0;
  const setState = (player, key, value) => player.setAttribute(key, value | 0);
  const agilityLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.AGILITY);
  const cookingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.COOKING);
  const fishingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.FISHING);

  function addXp(player, skill, amount) {
    player.getSkillManager().addExperiences(skill, amount);
  }

  function updateBrothers(player) {
    if (quest.isComplete(player)) return;
    const done =
      state(player, TIADECHE_KEY) >= TIADECHE_DONE &&
      state(player, TINSAY_KEY) >= TINSAY_DONE &&
      state(player, TAMAYU_KEY) >= TAMAYU_DONE;
    if (done && quest.getStage(player) < STAGE_BROTHERS_DONE) {
      quest.setStage(player, STAGE_BROTHERS_DONE);
    }
  }

  function swap(player, from, to) {
    player.getInventory().deleteNumber(from, 1);
    player.getInventory().adds(to, 1);
  }

  function brotherLine(player, key, done, name) {
    return state(player, key) >= done
      ? `<str>${name} has agreed to return to the village.</str>`
      : `<col=800000>${name}</col> still needs my help.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to",
        "<col=800000>Timfraku</col> in <col=800000>Tai Bwo Wannai</col>.",
        "",
        "I must have completed <col=800000>Jungle Potion</col>.",
        "I will need 30 Cooking, 15 Agility and 5 Fishing.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Trufitus communed with the gods and Tai Bwo Wannai was safe.</str>",
        "<str>I helped Timfraku's three sons return to the village.</str>",
        "",
        "<str>I can now catch and cook Karambwan, pray at the tribal statue</str>",
        "<str>and trade at the brothers' stalls.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    const lines = [
      "Timfraku asked me to find his three sons and return them to the village.",
      "",
      brotherLine(player, TAMAYU_KEY, TAMAYU_DONE, "Tamayu"),
      brotherLine(player, TINSAY_KEY, TINSAY_DONE, "Tinsay"),
      brotherLine(player, TIADECHE_KEY, TIADECHE_DONE, "Tiadeche"),
    ];
    if (state(player, LUBUFU_KEY) >= LUBUFU_FETCH) {
      lines.push(
        state(player, LUBUFU_KEY) >= LUBUFU_APPRENTICE
          ? "<str>Lubufu trained me to catch Karambwan.</str>"
          : "Lubufu will teach me to catch Karambwan once I bring him 20 Karambwanji."
      );
    }
    if (stage >= STAGE_BROTHERS_DONE) {
      lines.push("", "I have convinced all three sons. I must speak with <col=800000>Timfraku</col>.");
    }
    return lines;
  }

  function grantReward(_player) {
    // The 2,000 coins are handed over by Timfraku on completion; registerQuest
    // adds one coin from rewardItemId, so top it up by 1,999 here.
    _player.getInventory().adds(ItemIdentifiers.COINS, 1999);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    const owned =
      npcId === TIMFRAKU_ID ||
      TIADECHE_IDS.has(npcId) ||
      TINSAY_IDS.has(npcId) ||
      TAMAYU_IDS.has(npcId) ||
      npcId === LUBUFU_ID;
    if (!owned) return null;
    lastUsedItem.delete(player);

    if (npcId === TIMFRAKU_ID) {
      if (stage >= STAGE_COMPLETE) return "after-tai-bwo-wannai-trio";
      if (stage >= STAGE_BROTHERS_DONE) {
        return "making-the-burnt-marinated-jogre-bones-talking-to-timfraku-after-getting-all-three-sons-home";
      }
      if (stage >= STAGE_STARTED) return "starting-off-talking-to-timfraku-after-starting-the-quest";
      return "starting-off-talking-to-timfraku";
    }

    if (TIADECHE_IDS.has(npcId)) {
      const progress = state(player, TIADECHE_KEY);
      if (stage >= STAGE_COMPLETE && progress >= TIADECHE_DONE) {
        return progress >= TIADECHE_CLAIMED
          ? "post-quest-dialogue-with-the-brothers-subsequent-dialogue-with-tiadeche"
          : "post-quest-dialogue-with-the-brothers-talking-to-tiadeche";
      }
      if (progress >= TIADECHE_MANUAL) return "talking-to-tiadeche-subsequent-dialogue-with-tiadeche";
      if (stage >= STAGE_STARTED && progress < TIADECHE_WAITING) {
        setState(player, TIADECHE_KEY, TIADECHE_WAITING);
      }
      return "talking-to-tiadeche";
    }

    if (TINSAY_IDS.has(npcId)) {
      const progress = state(player, TINSAY_KEY);
      if (stage >= STAGE_COMPLETE && progress >= TINSAY_DONE) {
        return progress >= TINSAY_CLAIMED
          ? "post-quest-dialogue-with-the-brothers-subsequent-dialogue-with-tinsay"
          : "post-quest-dialogue-with-the-brothers-talking-to-tinsay";
      }
      if (progress >= TINSAY_BONES) {
        return held(player, ITEM.MARINATED_J_BONES)
          ? "making-the-burnt-marinated-jogre-bones-giving-tinsay-the-perfect-jogre-bones"
          : "reaching-tinsay-talking-to-tinsay-again-with-his-third-request";
      }
      if (progress >= TINSAY_SANDWICH) return "reaching-tinsay-talking-to-tinsay-again-with-his-second-request";
      if (progress >= TINSAY_BANANA) return "reaching-tinsay-talking-to-tinsay-again";
      if (stage >= STAGE_STARTED) return "reaching-tinsay-talking-to-tinsay";
      return null;
    }

    if (TAMAYU_IDS.has(npcId)) {
      const progress = state(player, TAMAYU_KEY);
      if (stage >= STAGE_COMPLETE && progress >= TAMAYU_DONE) {
        return progress >= TAMAYU_CLAIMED
          ? "post-quest-dialogue-with-the-brothers-subsequent-dialogue-with-tamayu"
          : "post-quest-dialogue-with-the-brothers-talking-to-tamayu";
      }
      if (stage < STAGE_STARTED) return null;
      if (progress < TIADECHE_WAITING) {
        setState(player, TAMAYU_KEY, TIADECHE_WAITING);
        return "talking-to-tamayu";
      }
      if (progress === TIADECHE_WAITING) return "talking-to-tamayu-talking-to-tamayu-again";
      if (progress === TAMAYU_WATCHED) return "talking-to-tamayu-subsequent-dialogue-with-tamayu";
      return "talking-to-tamayu-talking-to-tamayu-after-his-triumph-against-the-shaikahan";
    }

    if (npcId === LUBUFU_ID) {
      const progress = state(player, LUBUFU_KEY);
      if (stage >= STAGE_COMPLETE || progress >= LUBUFU_APPRENTICE) {
        return "talking-to-lubufu-subsequent-dialogue-with-lubufu";
      }
      if (progress >= LUBUFU_GIVEN) return "talking-to-lubufu-talking-to-lubufu-after-delivering-raw-karambwanji";
      if (progress >= LUBUFU_FETCH) return "talking-to-lubufu-delivering-raw-karambwanji-to-lubufu";
      return progress <= 0 ? "talking-to-lubufu" : "talking-to-lubufu-talking-to-lubufu-again";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const used = lastUsedItem.get(player) ?? -1;
    const has = (itemId, amount = 1) => held(player, itemId, amount);

    // Titles chosen when first meeting Timfraku.
    if (value.includes("says they are a roving adventurer")) return state(player, TITLE_KEY) === 0;
    if (value.includes("says they are a travelling explorer")) return state(player, TITLE_KEY) === 1;
    if (value.includes("says they are a wandering wayfarer")) return state(player, TITLE_KEY) === 2;
    if (value.includes('says they are a "nobody"')) return state(player, TITLE_KEY) === 3;

    // Tai Bwo Wannai Cleanup is not tracked here.
    if (value.includes("not been doing the tai bwo wannai cleanup")) return true;
    if (value.includes("completed at least one task")) return false;

    // Tiadeche.
    if (value.includes("raw, cooked, or poisoned karambwan on tiadeche")) {
      return used === ITEM.RAW_KARAMBWAN || used === ITEM.COOKED_KARAMBWAN || used === ITEM.POISON_KARAMBWAN;
    }
    if (value.includes("gives tiadeche an empty karambwan vessel")) return used === ITEM.KARAMBWAN_VESSEL;
    if (value.includes("gives tiadeche a raw karambwanji")) return used === ITEM.RAW_KARAMBWANJI;
    if (value.includes("karambwan vessel with a raw karambwanji inside")) return used === ITEM.KARAMBWAN_VESSEL_3;
    if (value.includes("has not received (another?) karambwan")) return state(player, KARAMBWAN_KEY) < 1;
    if (value.includes("does not have the crafting manual")) return !has(ITEM.CRAFTING_MANUAL);
    if (value.includes("has the crafting manual")) return has(ITEM.CRAFTING_MANUAL);
    if (value.includes("has done so")) return state(player, TIADECHE_KEY) >= TIADECHE_HAS_MANUAL;
    if (value.includes("has not done so")) return state(player, TIADECHE_KEY) < TIADECHE_HAS_MANUAL;

    // Tamayu.
    if (value.includes("stuffed monkey or monkey corpse on tamayu")) {
      return (used === ITEM.MONKEY_CORPSE || used === ITEM.STUFFED_MONKEY) && state(player, TAMAYU_KEY) < TAMAYU_DONE;
    }
    if (value.includes("uses the monkey corpse on tamayu")) {
      return used === ITEM.MONKEY_CORPSE && state(player, TAMAYU_KEY) >= TAMAYU_DONE;
    }
    const spearFlags = state(player, SPEAR_KEY);
    const watched = state(player, TAMAYU_KEY) >= TAMAYU_WATCHED;
    if (value.includes("partially full agility potion on tamayu before handing the better spear")) {
      return AGILITY_POTION_DOSES.has(used) && !(spearFlags & 1) && watched;
    }
    if (value.includes("partially full agility potion on tamayu after handing the better spear")) {
      return AGILITY_POTION_DOSES.has(used) && Boolean(spearFlags & 1) && watched;
    }
    if (value.includes("agility potion does not have four doses")) {
      return AGILITY_POTION_DOSES.has(used) && AGILITY_POTION_DOSES.get(used) < 4;
    }
    if (value.includes("agility potion has one dose")) return AGILITY_POTION_DOSES.get(used) === 1;
    if (value.includes("agility potion has two doses")) return AGILITY_POTION_DOSES.get(used) === 2;
    if (value.includes("agility potion has three doses")) return AGILITY_POTION_DOSES.get(used) === 3;
    if (value.includes("agility potion has four doses")) return AGILITY_POTION_DOSES.get(used) === 4;
    if (value.includes("iron or better spear on tamayu")) return ACCEPTABLE_SPEARS.has(used) && watched;
    if (value.includes("next hunt with the iron spear")) return ACCEPTABLE_SPEARS.has(used) && watched;
    if (value.includes("asks to take them to his next battle")) return AGILITY_POTION_DOSES.has(used) && watched;
    const agileEnough = state(player, AGILITY_KEY) >= 4;
    if (value.includes("better spear and a four-dose agility potion and wants to join the hunt again")) {
      return Boolean(spearFlags & 1) && !Boolean(spearFlags & 2) && !Boolean(spearFlags & 4) && agileEnough;
    }
    if (value.includes("brings a poisoned spear to tamayu")) {
      return Boolean(spearFlags & 2) && !Boolean(spearFlags & 4) && agileEnough;
    }
    if (value.includes("brings a poisoned karambwan spear")) {
      return Boolean(spearFlags & 4) && agileEnough;
    }

    // Lubufu's Karambwanji delivery.
    if (value.includes("has all 20 raw karambwanji")) return has(ITEM.RAW_KARAMBWANJI, 20);
    if (value.includes("has some raw karambwanji")) return has(ITEM.RAW_KARAMBWANJI);
    if (value.includes("does not have 20 karambwanji")) return !has(ITEM.RAW_KARAMBWANJI);
    if (value.includes("has the rest of the karambwanji")) return false;

    // Reaching Tinsay.
    if (value.includes("climb the rocks from the sides")) return true;
    if (value.includes("falls on the rocks")) return false;
    if (value.includes("keeps their balance on the bridge")) return agilityLevel(player) >= 15;
    if (value.includes("loses their balance on the bridge")) return agilityLevel(player) < 15;

    // Tinsay.
    if (value.includes("baited karambwan vessel on tinsay")) {
      return used === ITEM.KARAMBWAN_VESSEL_3 && state(player, TINSAY_KEY) < TINSAY_DONE;
    }
    if (value.includes("only has regular karamjan rum or no rum")) {
      return !has(ITEM.KARAMJAN_RUM_2) && !has(ITEM.KARAMJAN_RUM_3);
    }
    if (value.includes("karamjan rum with a whole banana inside")) return has(ITEM.KARAMJAN_RUM_3);
    if (value.includes("karamjan rum with slices of banana inside")) return has(ITEM.KARAMJAN_RUM_2);
    if (value.includes("doesn't have the rum")) return !has(ITEM.KARAMJAN_RUM_2) && !has(ITEM.KARAMJAN_RUM_3);
    if (value.includes("puts the whole banana inside the karamjan rum")) return false;
    if (value.includes("has the seaweed sandwich")) return has(ITEM.SEAWEED_SANDWICH);
    if (value.includes("gives the stuffed monkey to tinsay")) return has(ITEM.STUFFED_MONKEY);
    if (value.includes("does not have the monkey skin sandwich")) {
      return !has(ITEM.SEAWEED_SANDWICH) && !has(ITEM.STUFFED_MONKEY);
    }
    if (value.includes("stuffs the seaweed into the monkey corpse")) return false;
    if (value.includes("uses a knife on the monkey corpse")) return false;
    if (value.includes("gives him regular jogre bones")) return has(ITEM.JOGRE_BONES);
    if (value.includes("uncooked jogre bones smothered with cooked karambwanji")) return has(ITEM.PASTY_JOGRE_BONES_4);
    if (value.includes("uncooked jogre bones smothered with raw karambwanji")) return has(ITEM.PASTY_JOGRE_BONES_3);
    if (value.includes("gives him burnt jogre bones with raw karambwanji paste")) return has(ITEM.PASTY_JOGRE_BONES);
    if (value.includes("gives him burnt jogre bones with cooked karambwanji paste")) return has(ITEM.PASTY_JOGRE_BONES_2);
    if (value.includes("gives him burnt jogre bones")) return has(ITEM.BURNT_JOGRE_BONES);
    if (value.includes("cooked and marinated jogre bones but was not burnt first")) return has(ITEM.MARINATED_J_BONES_2);
    if (value.includes("gives him cooked and marinated jogre bones as requested")) return has(ITEM.MARINATED_J_BONES);

    // Bones / paste preparation (only reached from the item-on-object paths).
    if (value.includes("uses poisoned or regular karambwan paste on the bones")) return false;
    if (value.includes("cook the jogre bones on a fire without level 30 cooking")) return cookingLevel(player) < 30;
    if (value.includes("uses the jogre bones on a range")) return true;
    if (value.includes("grinds the cooked karambwanji")) return used === COOKED_KARAMBWANJI;
    if (value.includes("smothers the ground cooked karambwanji")) return used === ITEM.KARAMBWANJI_PASTE_2;
    if (value.includes("cook the smothered jogre bones with cooked karambwanji")) return used === ITEM.PASTY_JOGRE_BONES_2;
    if (value.includes("grinds the raw karambwanji")) return used === ITEM.RAW_KARAMBWANJI;
    if (value.includes("uses the raw karambwanji on the jogre bones")) return used === ITEM.KARAMBWANJI_PASTE;
    if (value.includes("cooks the raw karakbwanji paste-smothered")) return used === ITEM.PASTY_JOGRE_BONES;

    // Tinsay's vessel / crafting manual.
    if (value.includes("uses an empty karambwan vessel on tinsay")) return used === ITEM.KARAMBWAN_VESSEL;
    if (value.includes("vessel is empty")) return used === ITEM.KARAMBWAN_VESSEL;
    if (value.includes("vessel is filled with karambwanji")) return used === ITEM.KARAMBWAN_VESSEL_3;
    return null;
  }

  /** "Yes." on the start confirmation carries the quest slug. */
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== TIMFRAKU_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) > 0) return;
    if ((Number(player.getAttribute(JUNGLE_POTION_STAGE)) || 0) < JUNGLE_POTION_COMPLETE) return;
    quest.setStage(player, STAGE_STARTED);
  }

  /** Remember which "I am a ..." title the player picked. */
  function handleChoice({ player, npcId, option }) {
    if (npcId !== TIMFRAKU_ID) return;
    const value = String(option).toLowerCase();
    if (value.includes("roving adventurer")) setState(player, TITLE_KEY, 0);
    else if (value.includes("travelling explorer")) setState(player, TITLE_KEY, 1);
    else if (value.includes("wandering wayfarer")) setState(player, TITLE_KEY, 2);
    else if (value.includes("nobody")) setState(player, TITLE_KEY, 3);
  }

  /** Condition branches that consume a used item before a message can run. */
  function handleCondition(event) {
    if (event.stepId !== "eCCdOQ" || !event.player) return;
    const { player } = event;
    const itemId = lastUsedItem.get(player);
    const doses = AGILITY_POTION_DOSES.get(itemId) ?? 0;
    if (!doses) return;
    player.getInventory().deleteNumber(itemId, 1);
    setState(player, AGILITY_KEY, Math.min(4, state(player, AGILITY_KEY) + doses));
  }

  function handInLubufuKarambwanji(event) {
    const { player, stepId } = event;
    if (stepId === LUBUFU_ALL_KARAMBWANJI_ID) {
      player.getInventory().deleteNumber(ITEM.RAW_KARAMBWANJI, 20);
      setState(player, LUBUFU_KEY, LUBUFU_GIVEN);
      setState(player, LUBUFU_COUNT_KEY, 20);
      player.sendMessage("You hand Lubufu 20 raw Karambwanji.");
      event.handled = true;
      return true;
    }
    if (LUBUFU_PARTIAL_IDS.has(stepId)) {
      const given = state(player, LUBUFU_COUNT_KEY);
      const amount = Math.min(held(player, ITEM.RAW_KARAMBWANJI) ? player.getInventory().getAmount(ITEM.RAW_KARAMBWANJI) : 0, 20 - given);
      if (amount <= 0) return false;
      player.getInventory().deleteNumber(ITEM.RAW_KARAMBWANJI, amount);
      const total = given + amount;
      setState(player, LUBUFU_COUNT_KEY, total);
      setState(player, LUBUFU_KEY, total >= 20 ? LUBUFU_GIVEN : LUBUFU_FETCH + total);
      player.sendMessage(`You hand Lubufu ${amount} raw Karambwanji.`);
      event.handled = true;
      return true;
    }
    return false;
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    if (handInLubufuKarambwanji(event)) return;

    if (stepId === TIADECHE_VESSEL_MESSAGE_ID) {
      player.getInventory().deleteNumber(ITEM.KARAMBWAN_VESSEL, 1);
      return;
    }
    if (stepId === TIADECHE_VESSEL_RETURN_ID) {
      player.getInventory().adds(ITEM.KARAMBWAN_VESSEL, 1);
      return;
    }
    if (stepId === TIADECHE_KARAMBWANJI_MESSAGE_ID) {
      player.getInventory().deleteNumber(ITEM.RAW_KARAMBWANJI, 1);
      return;
    }
    if (stepId === TIADECHE_LOADED_VESSEL_MESSAGE_ID) {
      player.getInventory().deleteNumber(ITEM.KARAMBWAN_VESSEL_3, 1);
      if (state(player, TIADECHE_KEY) < TIADECHE_MANUAL) setState(player, TIADECHE_KEY, TIADECHE_MANUAL);
      return;
    }
    if (stepId === TIADECHE_FIRST_CATCH_ID || stepId === TIADECHE_ANOTHER_CATCH_ID) {
      player.getInventory().adds(ITEM.RAW_KARAMBWAN, 1);
      setState(player, KARAMBWAN_KEY, 1);
      return;
    }
    if (stepId === TIADECHE_RETURN_ID || stepId === TIADECHE_RETURN_ALT_ID) {
      if (state(player, TIADECHE_KEY) < TIADECHE_MANUAL) setState(player, TIADECHE_KEY, TIADECHE_MANUAL);
      return;
    }
    if (stepId === TIADECHE_MANUAL_MESSAGE_ID) {
      player.getInventory().deleteNumber(ITEM.CRAFTING_MANUAL, 1);
      setState(player, TIADECHE_KEY, TIADECHE_DONE);
      updateBrothers(player);
      return;
    }

    if (stepId === TINSAY_PAUSE_MESSAGE_ID) {
      if (state(player, TINSAY_KEY) < TINSAY_BANANA) setState(player, TINSAY_KEY, TINSAY_BANANA);
      return;
    }
    if (TINSAY_VESSEL_HANDOVER_IDS.has(stepId)) {
      player.getInventory().deleteNumber(ITEM.KARAMBWAN_VESSEL, 1);
      player.getInventory().deleteNumber(ITEM.KARAMBWAN_VESSEL_3, 1);
      return;
    }
    if (stepId === TINSAY_MANUAL_ID) {
      player.getInventory().adds(ITEM.CRAFTING_MANUAL, 1);
      if (state(player, TIADECHE_KEY) >= TIADECHE_MANUAL) setState(player, TIADECHE_KEY, TIADECHE_HAS_MANUAL);
      return;
    }
    if (stepId === TINSAY_BANANA_ID) {
      player.getInventory().deleteNumber(ITEM.KARAMJAN_RUM_2, 1);
      setState(player, TINSAY_KEY, TINSAY_SANDWICH);
      return;
    }
    if (stepId === TINSAY_SANDWICH_ID) {
      player.getInventory().deleteNumber(ITEM.SEAWEED_SANDWICH, 1);
      setState(player, TINSAY_KEY, TINSAY_BONES);
      return;
    }
    if (stepId === TINSAY_PERFECT_BONES_ID) {
      player.getInventory().deleteNumber(ITEM.MARINATED_J_BONES, 1);
      setState(player, TINSAY_KEY, TINSAY_DONE);
      updateBrothers(player);
      return;
    }
    if (stepId === TINSAY_COOKED_PASTE_BONES_ID) {
      player.getInventory().deleteNumber(ITEM.PASTY_JOGRE_BONES_4, 1);
      return;
    }
    if (stepId === TINSAY_RAW_PASTE_BONES_ID) {
      player.getInventory().deleteNumber(ITEM.PASTY_JOGRE_BONES_3, 1);
      return;
    }
    if (stepId === TINSAY_BURNT_RAW_PASTE_ID) {
      player.getInventory().deleteNumber(ITEM.PASTY_JOGRE_BONES, 1);
      return;
    }
    if (stepId === TINSAY_BURNT_COOKED_PASTE_ID) {
      player.getInventory().deleteNumber(ITEM.PASTY_JOGRE_BONES_2, 1);
      return;
    }
    if (stepId === TINSAY_MARINATED_UNBURNT_ID) {
      player.getInventory().deleteNumber(ITEM.MARINATED_J_BONES_2, 1);
      return;
    }

    const potionDoses = TAMAYU_POTION_MESSAGES.get(stepId);
    if (potionDoses !== undefined) {
      const itemId = lastUsedItem.get(player);
      if (AGILITY_POTION_DOSES.has(itemId)) player.getInventory().deleteNumber(itemId, 1);
      setState(player, AGILITY_KEY, Math.min(4, state(player, AGILITY_KEY) + potionDoses));
      return;
    }
    if (stepId === TAMAYU_SPEAR_MESSAGE_ID) {
      const itemId = lastUsedItem.get(player);
      if (itemId === undefined) return;
      player.getInventory().deleteNumber(itemId, 1);
      let flags = 0;
      if (ACCEPTABLE_SPEARS.has(itemId)) flags |= 1;
      if (POISONED_SPEARS.has(itemId) || KP_SPEARS.has(itemId)) flags |= 2;
      if (KP_SPEARS.has(itemId)) flags |= 4;
      setState(player, SPEAR_KEY, flags);
      return;
    }
    if (stepId === TAMAYU_WATCH_CUTSCENE_ID) {
      if (state(player, TAMAYU_KEY) < TAMAYU_WATCHED) setState(player, TAMAYU_KEY, TAMAYU_WATCHED);
      return;
    }
    if (stepId === TAMAYU_KILL_CUTSCENE_ID) {
      if (state(player, TAMAYU_KEY) < TAMAYU_DONE) setState(player, TAMAYU_KEY, TAMAYU_DONE);
      updateBrothers(player);
      return;
    }
    if (stepId === TAMAYU_SKIN_ACTION_ID) {
      const itemId = lastUsedItem.get(player);
      if (itemId === ITEM.MONKEY_CORPSE) {
        player.getInventory().deleteNumber(itemId, 1);
      } else if (itemId === ITEM.STUFFED_MONKEY) {
        player.getInventory().deleteNumber(itemId, 1);
        player.getInventory().adds(ITEM.SEAWEED, 1);
      } else {
        return;
      }
      player.getInventory().adds(ITEM.MONKEY_SKIN, 1);
      player.getInventory().adds(ITEM.MONKEY_BONES_5, 1);
      lastUsedItem.delete(player);
      return;
    }
    if (stepId === TAMAYU_ATTACK_XP_ID) {
      addXp(player, Skill.ATTACK, 2500);
      addXp(player, Skill.STRENGTH, 2500);
      return;
    }
    if (stepId === TAMAYU_SPEAR_REWARD_ID) {
      player.getInventory().adds(ITEM.RUNE_SPEAR_KP_, 1);
      setState(player, TAMAYU_KEY, TAMAYU_CLAIMED);
      return;
    }

    if (stepId === LUBUFU_VESSEL_REWARD_ID) {
      addXp(player, Skill.FISHING, 1500);
      player.getInventory().adds(ITEM.KARAMBWAN_VESSEL, 1);
      setState(player, LUBUFU_KEY, LUBUFU_APPRENTICE);
      return;
    }
    if (stepId === LUBUFU_VESSEL_RECOVER_ID) {
      player.getInventory().adds(ITEM.KARAMBWAN_VESSEL, 1);
      return;
    }

    if (stepId === TIADECHE_FISHING_XP_ID) {
      addXp(player, Skill.FISHING, 5000);
      setState(player, TIADECHE_KEY, TIADECHE_CLAIMED);
      return;
    }
    if (stepId === TINSAY_COOKING_XP_ID) {
      addXp(player, Skill.COOKING, 5000);
      setState(player, TINSAY_KEY, TINSAY_CLAIMED);
      return;
    }

    if (stepId === COMPLETE_MESSAGE_ID) {
      if (quest.getStage(player) >= STAGE_BROTHERS_DONE && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const ids = new Set([event.usedItemId, event.usedWithItemId]);
    const has = (itemId) => ids.has(itemId);
    let handled = true;

    if (has(ITEM.RAW_KARAMBWANJI) && has(ITEM.KARAMBWAN_VESSEL)) {
      swap(player, ITEM.RAW_KARAMBWANJI, ITEM.KARAMBWAN_VESSEL_3);
      player.getInventory().deleteNumber(ITEM.KARAMBWAN_VESSEL, 1);
      player.sendMessage("You load the Karambwan vessel with the raw Karambwanji.");
    } else if (has(ITEM.RAW_KARAMBWANJI) && has(ITEM.PESTLE_AND_MORTAR)) {
      swap(player, ITEM.RAW_KARAMBWANJI, ITEM.KARAMBWANJI_PASTE);
      player.sendMessage("You grind the raw Karambwanji to form a sticky paste.");
    } else if (has(COOKED_KARAMBWANJI) && has(ITEM.PESTLE_AND_MORTAR)) {
      swap(player, COOKED_KARAMBWANJI, ITEM.KARAMBWANJI_PASTE_2);
      player.sendMessage("You grind the cooked Karambwanji to form a sticky paste.");
    } else if (has(ITEM.RAW_KARAMBWAN) && has(ITEM.PESTLE_AND_MORTAR)) {
      swap(player, ITEM.RAW_KARAMBWAN, ITEM.KARAMBWAN_PASTE);
      player.sendMessage("You grind the karambwan to form a sticky paste.");
    } else if (has(ITEM.POISON_KARAMBWAN) && has(ITEM.PESTLE_AND_MORTAR)) {
      swap(player, ITEM.POISON_KARAMBWAN, ITEM.KARAMBWAN_PASTE_2);
      player.sendMessage("You grind the karambwan to form a sticky paste.");
    } else if (has(ITEM.COOKED_KARAMBWAN) && has(ITEM.PESTLE_AND_MORTAR)) {
      swap(player, ITEM.COOKED_KARAMBWAN, ITEM.KARAMBWAN_PASTE_3);
      player.sendMessage("You grind the karambwan to form a sticky paste.");
    } else if (has(ITEM.KARAMBWANJI_PASTE) && has(ITEM.JOGRE_BONES)) {
      swap(player, ITEM.JOGRE_BONES, ITEM.PASTY_JOGRE_BONES_3);
      player.getInventory().deleteNumber(ITEM.KARAMBWANJI_PASTE, 1);
      player.sendMessage("You smother the raw Karambwanji paste over the Jogre bones.");
    } else if (has(ITEM.KARAMBWANJI_PASTE) && has(ITEM.BURNT_JOGRE_BONES)) {
      swap(player, ITEM.BURNT_JOGRE_BONES, ITEM.PASTY_JOGRE_BONES);
      player.getInventory().deleteNumber(ITEM.KARAMBWANJI_PASTE, 1);
      player.sendMessage("You smother the raw Karambwanji paste over the burnt Jogre bones.");
    } else if (has(ITEM.KARAMBWANJI_PASTE_2) && has(ITEM.JOGRE_BONES)) {
      swap(player, ITEM.JOGRE_BONES, ITEM.PASTY_JOGRE_BONES_4);
      player.getInventory().deleteNumber(ITEM.KARAMBWANJI_PASTE_2, 1);
      player.sendMessage("You smother the cooked Karambwanji paste over the Jogre bones.");
    } else if (has(ITEM.KARAMBWANJI_PASTE_2) && has(ITEM.BURNT_JOGRE_BONES)) {
      swap(player, ITEM.BURNT_JOGRE_BONES, ITEM.PASTY_JOGRE_BONES_2);
      player.getInventory().deleteNumber(ITEM.KARAMBWANJI_PASTE_2, 1);
      player.sendMessage("You smother the cooked Karambwanji paste over the burnt Jogre bones.");
    } else if (has(ITEM.SEAWEED) && has(ITEM.MONKEY_CORPSE)) {
      swap(player, ITEM.MONKEY_CORPSE, ITEM.STUFFED_MONKEY);
      player.getInventory().deleteNumber(ITEM.SEAWEED, 1);
      player.sendMessage("You stuff the seaweed into the monkey corpse, creating a stuffed monkey.");
    } else if (has(ITEM.SEAWEED) && has(ITEM.MONKEY_SKIN)) {
      swap(player, ITEM.MONKEY_SKIN, ITEM.SEAWEED_SANDWICH);
      player.getInventory().deleteNumber(ITEM.SEAWEED, 1);
      player.sendMessage("You sandwich the seaweed into the monkey skin.");
    } else if (has(ITEM.MONKEY_CORPSE) && has(ITEM.KNIFE)) {
      player.sendMessage("You don't know how to skin a monkey ... yet.");
    } else if (has(ITEM.BANANA) && has(ITEM.KNIFE)) {
      swap(player, ITEM.BANANA, ITEM.SLICED_BANANA);
      player.sendMessage("You deftly chop the bananas into slices.");
    } else if (has(ITEM.BANANA) && has(ITEM.KARAMJAN_RUM)) {
      swap(player, ITEM.BANANA, ITEM.KARAMJAN_RUM_3);
      player.getInventory().deleteNumber(ITEM.KARAMJAN_RUM, 1);
      player.sendMessage("You stuff the banana into the neck of the bottle. You begin to wonder why.");
    } else if (has(ITEM.SLICED_BANANA) && has(ITEM.KARAMJAN_RUM)) {
      swap(player, ITEM.SLICED_BANANA, ITEM.KARAMJAN_RUM_2);
      player.getInventory().deleteNumber(ITEM.KARAMJAN_RUM, 1);
      player.sendMessage("You add the banana slices to the Karamjan rum.");
    } else {
      const spear = [...ids].find((id) => KP_BY_BASE.has(id));
      if (spear !== undefined && (has(ITEM.KARAMBWAN_PASTE) || has(ITEM.KARAMBWAN_PASTE_2) || has(ITEM.KARAMBWAN_PASTE_3))) {
        swap(player, spear, KP_BY_BASE.get(spear));
        player.sendMessage("You smear the karambwan paste over the spear.");
      } else if (spear !== undefined && (has(ITEM.RAW_KARAMBWAN) || has(ITEM.COOKED_KARAMBWAN) || has(ITEM.POISON_KARAMBWAN))) {
        player.sendMessage("This blasted Karambwan just falls off the spear! My life is becoming such a grind...");
      } else {
        handled = false;
      }
    }
    if (handled) event.handled = true;
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    const { player } = event;
    const itemId = event.itemId;
    const stage = quest.getStage(player);

    if (KARAMBWAN_SPOT_IDS.has(npcId) && itemId === ITEM.KARAMBWAN_VESSEL_3) {
      catchKarambwan(player);
      event.handled = true;
      return;
    }

    if (npcId === LUBUFU_ID && itemId === ITEM.RAW_KARAMBWANJI) {
      const progress = state(player, LUBUFU_KEY);
      if (progress < LUBUFU_FETCH || progress >= LUBUFU_GIVEN) return;
      lastUsedItem.set(player, itemId);
      startTranscript(api, player, npcId, PAGE, "talking-to-lubufu-delivering-raw-karambwanji-to-lubufu");
      event.handled = true;
      return;
    }

    if (TIADECHE_IDS.has(npcId)) {
      const progress = state(player, TIADECHE_KEY);
      if (stage < STAGE_STARTED || progress !== TIADECHE_WAITING) return;
      if (
        itemId !== ITEM.KARAMBWAN_VESSEL &&
        itemId !== ITEM.KARAMBWAN_VESSEL_3 &&
        itemId !== ITEM.RAW_KARAMBWANJI &&
        itemId !== ITEM.RAW_KARAMBWAN &&
        itemId !== ITEM.COOKED_KARAMBWAN &&
        itemId !== ITEM.POISON_KARAMBWAN
      ) {
        return;
      }
      lastUsedItem.set(player, itemId);
      startTranscript(api, player, npcId, PAGE, "talking-to-tiadeche-talking-to-tiadeche-again");
      event.handled = true;
      return;
    }

    if (TINSAY_IDS.has(npcId)) {
      const progress = state(player, TINSAY_KEY);
      if (itemId === ITEM.KARAMBWAN_VESSEL || itemId === ITEM.KARAMBWAN_VESSEL_3) {
        if (progress >= TINSAY_DONE) {
          if (state(player, TIADECHE_KEY) < TIADECHE_MANUAL) return;
          lastUsedItem.set(player, itemId);
          startTranscript(api, player, npcId, PAGE, "making-the-burnt-marinated-jogre-bones-subsequent-dialogue-with-tinsay");
          event.handled = true;
        } else {
          player.sendMessage("You first help me, then I'll help you.");
          event.handled = true;
        }
        return;
      }
      if (progress === TINSAY_BANANA && (itemId === ITEM.KARAMJAN_RUM_2 || itemId === ITEM.KARAMJAN_RUM_3)) {
        lastUsedItem.set(player, itemId);
        startTranscript(api, player, npcId, PAGE, "reaching-tinsay-talking-to-tinsay-again");
        event.handled = true;
        return;
      }
      if (progress === TINSAY_SANDWICH && (itemId === ITEM.SEAWEED_SANDWICH || itemId === ITEM.STUFFED_MONKEY)) {
        lastUsedItem.set(player, itemId);
        startTranscript(api, player, npcId, PAGE, "reaching-tinsay-talking-to-tinsay-again-with-his-second-request");
        event.handled = true;
        return;
      }
      if (progress === TINSAY_BONES) {
        const bone = [
          ITEM.JOGRE_BONES,
          ITEM.BURNT_JOGRE_BONES,
          ITEM.PASTY_JOGRE_BONES,
          ITEM.PASTY_JOGRE_BONES_2,
          ITEM.PASTY_JOGRE_BONES_3,
          ITEM.PASTY_JOGRE_BONES_4,
          ITEM.MARINATED_J_BONES_2,
          ITEM.MARINATED_J_BONES,
        ].includes(itemId);
        if (!bone) return;
        lastUsedItem.set(player, itemId);
        startTranscript(
          api,
          player,
          npcId,
          PAGE,
          itemId === ITEM.MARINATED_J_BONES
            ? "making-the-burnt-marinated-jogre-bones-giving-tinsay-the-perfect-jogre-bones"
            : "reaching-tinsay-talking-to-tinsay-again-with-his-third-request"
        );
        event.handled = true;
      }
      return;
    }

    if (TAMAYU_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return;
      const progress = state(player, TAMAYU_KEY);
      if (itemId === ITEM.MONKEY_CORPSE || itemId === ITEM.STUFFED_MONKEY) {
        lastUsedItem.set(player, itemId);
        startTranscript(
          api,
          player,
          npcId,
          PAGE,
          progress >= TAMAYU_DONE
            ? "talking-to-tamayu-talking-to-tamayu-after-his-triumph-against-the-shaikahan"
            : "talking-to-tamayu-using-several-items-on-tamayu"
        );
        event.handled = true;
        return;
      }
      if (
        progress >= TAMAYU_WATCHED &&
        (AGILITY_POTION_DOSES.has(itemId) || ACCEPTABLE_SPEARS.has(itemId) || POISONED_SPEARS.has(itemId) || KP_SPEARS.has(itemId))
      ) {
        lastUsedItem.set(player, itemId);
        startTranscript(api, player, npcId, PAGE, "talking-to-tamayu-using-several-items-on-tamayu");
        event.handled = true;
      }
    }
  }

  function handleItemOnObject(event) {
    const objectName = event.object?.getDefinition?.()?.getName?.() ?? "";
    if (!COOKING_OBJECT_NAMES.has(objectName)) return;
    const { player } = event;
    const itemId = event.itemId;
    if (itemId === ITEM.JOGRE_BONES) {
      event.handled = true;
      if (cookingLevel(player) < 30) {
        player.sendMessage("You need a Cooking level of 30 to burn Jogre bones.");
        return;
      }
      player.getInventory().deleteNumber(ITEM.JOGRE_BONES, 1);
      player.getInventory().adds(ITEM.BURNT_JOGRE_BONES, 1);
      addXp(player, Skill.COOKING, 250);
      player.sendMessage("You burn the Jogre bones.");
      return;
    }
    if (itemId === ITEM.PASTY_JOGRE_BONES) {
      event.handled = true;
      if (cookingLevel(player) < 30) {
        player.sendMessage("You heat the bones, but they don't look any different.");
        return;
      }
      player.getInventory().deleteNumber(ITEM.PASTY_JOGRE_BONES, 1);
      player.getInventory().adds(ITEM.MARINATED_J_BONES, 1);
      player.sendMessage("You marinate the burnt bones perfectly.");
      return;
    }
    if (itemId === ITEM.PASTY_JOGRE_BONES_2) {
      event.handled = true;
      player.getInventory().deleteNumber(ITEM.PASTY_JOGRE_BONES_2, 1);
      player.getInventory().adds(ITEM.ASHES, 1);
      player.sendMessage("The cooked karambwanji paste catches fire and explodes.");
      return;
    }
    if (
      itemId === ITEM.PASTY_JOGRE_BONES_3 ||
      itemId === ITEM.PASTY_JOGRE_BONES_4 ||
      itemId === ITEM.MARINATED_J_BONES_2
    ) {
      event.handled = true;
      player.sendMessage("You heat the bones, but they don't look any different.");
    }
  }

  /** The tribal statue is prayable once Tinsay has repaired it; the huts stay shut. */
  function handleObjectInteraction(event) {
    const { player } = event;
    if (STATUE_IDS.has(event.objectId)) {
      event.handled = true;
      if (state(player, TINSAY_KEY) < TINSAY_DONE) {
        player.sendMessage("You do not have permission to pray here.");
        return;
      }
      const skills = player.getSkillManager();
      skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
      player.sendMessage("You pray at the tribal statue and your prayer is restored.");
      return;
    }
    if (event.objectId === BAMBOO_DOOR_ID && quest.getStage(player) < STAGE_COMPLETE) {
      event.handled = true;
      player.sendMessage("You do not have permission to enter here");
    }
  }

  function catchKarambwan(player) {
    if (fishingLevel(player) < 65) {
      player.sendMessage("You need a Fishing level of 65 to catch Karambwan.");
      return;
    }
    player.getInventory().deleteNumber(ITEM.KARAMBWAN_VESSEL_3, 1);
    player.getInventory().adds(ITEM.KARAMBWAN_VESSEL, 1);
    player.getInventory().adds(ITEM.RAW_KARAMBWAN, 1);
    addXp(player, Skill.FISHING, 50);
    player.sendMessage("You catch a raw Karambwan.");
  }

  /** Holy Lake Karambwanji (net) and the Karambwan shoals (baited vessel). */
  function handleNpcInteraction(event) {
    const { player, npcId, clickType } = event;
    const action = String(event.definition?.getActions?.()?.[clickType - 1] ?? "").toLowerCase();
    if (KARAMBWANJI_SPOT_IDS.has(npcId)) {
      if (action && !action.includes("net")) return;
      event.handled = true;
      if (!held(player, ITEM.SMALL_FISHING_NET)) {
        player.sendMessage("You need a small fishing net to catch Karambwanji.");
        return;
      }
      if (fishingLevel(player) < 5) {
        player.sendMessage("You need a Fishing level of 5 to catch Karambwanji.");
        return;
      }
      player.getInventory().adds(ITEM.RAW_KARAMBWANJI, 1);
      addXp(player, Skill.FISHING, 5);
      player.sendMessage("You catch a raw Karambwanji.");
      return;
    }
    if (KARAMBWAN_SPOT_IDS.has(npcId) && held(player, ITEM.KARAMBWAN_VESSEL_3)) {
      event.handled = true;
      catchKarambwan(player);
    }
  }

  function handleLogout({ player }) {
    if (player) lastUsedItem.delete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(TIADECHE_KEY);
  api.persistAttribute(TINSAY_KEY);
  api.persistAttribute(TAMAYU_KEY);
  api.persistAttribute(LUBUFU_KEY);
  api.persistAttribute(AGILITY_KEY);
  api.persistAttribute(SPEAR_KEY);
  api.persistAttribute(TITLE_KEY);
  api.persistAttribute(KARAMBWAN_KEY);
  api.persistAttribute(LUBUFU_COUNT_KEY);

  quest = registerQuest(api, {
    key: "tai_bwo_wannai_trio",
    name: "Tai Bwo Wannai Trio",
    varpId: VARP_TAI_BWO_WANNAI_TRIO,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [],
    rewardItemId: ItemIdentifiers.COINS,
    rewardItemLabel: "2,000 Coins",
    otherRewards: [
      "Access to Tamayu's Spear Stall",
      "Access to Tiadeche's Karambwan Stall",
      "Ability to pray at the tribal statue",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
