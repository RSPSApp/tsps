/**
 * Zogre Flesh Eaters (members).
 *
 * The words come from the "Zogre Flesh Eaters" transcript page plus the indexed
 * "Grish", "Zavistic Rarve", "Sithik Ints", "Irwin Feaselbaum", "Uglug Nar" and
 * "Bartender (Dragon Inn)" pages; this plugin supplies the variant selector for
 * the quest NPCs, the prose-condition answers, the start/complete actions, the
 * item hand-outs and the tomb gameplay (lectern, skeleton, coffin, plinth).
 *
 * Stages (varp 487): 0 unstarted, 2 investigate (started), 3 barricade smashed,
 * 4 sithik (evidence turned in / potion received), 6 potion (tea poisoned),
 * 8 permanent_spell (Sithik transformed), 10 given_key, 12 killed_slash_bash,
 * 14 complete. The coffin/evidence sub-progress (0..5) and the one-shot flags
 * live in persisted "quest.zogre_flesh_eaters.*" attributes.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/quest/member/ogre/ZogreFleshEaters.kt
 * (varp 487 and the map stages match void's zogre_flesh_eaters.varbits.toml).
 *
 * Gaps: the Jiggig cutscene camera and the blackened-area entry event are not
 * played; the barricade climb, cave stairs and tomb-door movement rely on the
 * generic object/teleport plugins (only the door key check and its transcript
 * are wired here); the cup of tea is a ground item, so pouring is wired through
 * item-on-ground-item (plus a raw 4838 object fallback); Relicym's balm mixing
 * and brutal-arrow fletching are not reproduced (only the reward unlocks);
 * Slash Bash is spawned owner-only with no disease/despawn simulation; the
 * "grows weary" flee/despawn message is not triggered; the black-prism 2,000
 * coin sale to Zavistic is not wired.
 */
module.exports = function registerZogreFleshEatersQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Zogre Flesh Eaters";

  const VARP_ZOGRE_FLESH_EATERS = 487;
  const STAGE_STARTED = 2;
  const STAGE_BARRICADE = 3;
  const STAGE_SITHIK = 4;
  const STAGE_POTION = 6;
  const STAGE_PERMANENT_SPELL = 8;
  const STAGE_GIVEN_KEY = 10;
  const STAGE_KILLED_SLASH_BASH = 12;
  const STAGE_COMPLETE = 14;

  const GRISH_NPC_ID = NpcIdentifiers.GRISH;
  const UGLUG_NAR_NPC_ID = NpcIdentifiers.UGLUG_NAR;
  const OGRE_GUARD_NPC_IDS = new Set([NpcIdentifiers.OGRE_GUARD, NpcIdentifiers.OGRE_GUARD_2]);
  const ZOMBIE_NPC_ID = NpcIdentifiers.ZOMBIE_44;
  const ZAVISTIC_RARVE_NPC_ID = NpcIdentifiers.ZAVISTIC_RARVE;
  const SLASH_BASH_NPC_ID = NpcIdentifiers.SLASH_BASH;
  const SITHIK_NPC_ID = NpcIdentifiers.SITHIK_INTS;
  const SITHIK_NPC_IDS = new Set([NpcIdentifiers.SITHIK_INTS, NpcIdentifiers.SITHIK_INTS_2]);
  const IRWIN_FEASELBAUM_NPC_ID = NpcIdentifiers.IRWIN_FEASELBAUM;
  const DRAGON_INN_BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER_9; // Dragon Inn (Yanille)
  const JOHANHUS_ULSBRECHT_NPC_IDS = new Set([
    NpcIdentifiers.JOHANHUS_ULSBRECHT,
    NpcIdentifiers.JOHANHUS_ULSBRECHT_2,
  ]);
  const IRWIN_PAGE = "Irwin Feaselbaum";

  const OGRE_COFFIN_IDS = new Set([
    ObjectIdentifiers.OGRE_COFFIN,
    ObjectIdentifiers.OGRE_COFFIN_2,
    6843, // ponytail: unnamed coffin base, no ObjectIdentifiers entry
  ]);
  const OGRE_TOMB_DOOR_IDS = new Set([
    ObjectIdentifiers.OGRE_STONE_DOOR,
    ObjectIdentifiers.OGRE_STONE_DOOR_2,
  ]);
  const SITHIK_BED_IDS = new Set([
    ObjectIdentifiers.SITHIK_INTS,
    ObjectIdentifiers.SITHIK_INTS_2,
    6887, // ponytail: unnamed bed entity, no ObjectIdentifiers entry
  ]);
  const BROKEN_LECTERN_ID = ObjectIdentifiers.BROKEN_LECTURN;
  const OUTDOOR_BELL_ID = ObjectIdentifiers.BELL_2;
  const SITHIKS_DRAWERS_ID = ObjectIdentifiers.DRAWERS_11;
  const SITHIKS_CUPBOARD_ID = ObjectIdentifiers.CUPBOARD_30;
  const SITHIKS_WARDROBE_ID = ObjectIdentifiers.WARDROBE_7;
  const OGRE_SKELETON_ID = ObjectIdentifiers.SKELETON_8;
  const OGRE_STAND_ID = ObjectIdentifiers.STAND;
  const CUP_OF_TEA_OBJECT_ID = 4838; // ponytail: no ObjectIdentifiers entry, ground object fallback

  const TORN_PAGE = ItemIdentifiers.TORN_PAGE;
  const BLACK_PRISM = ItemIdentifiers.BLACK_PRISM;
  const RUINED_BACKPACK = ItemIdentifiers.RUINED_BACKPACK;
  const DRAGON_INN_TANKARD = ItemIdentifiers.DRAGON_INN_TANKARD;
  const SITHIK_PORTRAIT = ItemIdentifiers.SITHIK_PORTRAIT; // good
  const SITHIK_PORTRAIT_BAD = ItemIdentifiers.SITHIK_PORTRAIT_2; // bad sketch
  const SIGNED_PORTRAIT = ItemIdentifiers.SIGNED_PORTRAIT;
  const BOOK_OF_PORTRAITURE = ItemIdentifiers.BOOK_OF_PORTRAITURE;
  const OGRE_ARTEFACT = ItemIdentifiers.OGRE_ARTEFACT;
  const NECROMANCY_BOOK = ItemIdentifiers.NECROMANCY_BOOK;
  const BOOK_OF_H_A_M = ItemIdentifiers.BOOK_OF_H_A_M;
  const STRANGE_POTION = ItemIdentifiers.STRANGE_POTION;
  const OGRE_GATE_KEY = ItemIdentifiers.OGRE_GATE_KEY;
  const CUP_OF_TEA = ItemIdentifiers.CUP_OF_TEA_8;
  const SAMPLE_BOTTLE = ItemIdentifiers.SAMPLE_BOTTLE;
  const PAPYRUS = ItemIdentifiers.PAPYRUS;
  const CHARCOAL = ItemIdentifiers.CHARCOAL;
  const KNIFE = ItemIdentifiers.KNIFE;
  const ROTTEN_FOOD = ItemIdentifiers.ROTTEN_FOOD;
  const ZOGRE_BONES = ItemIdentifiers.ZOGRE_BONES;
  const OURG_BONES = ItemIdentifiers.OURG_BONES;
  const COOKED_CHOMPY = ItemIdentifiers.COOKED_CHOMPY;
  const SUPER_RESTORE_3 = ItemIdentifiers.SUPER_RESTORE_3_;
  const COINS = ItemIdentifiers.COINS;

  const BALM_ITEM_IDS = [
    ItemIdentifiers.RELICYMS_BALM_4_,
    ItemIdentifiers.RELICYMS_BALM_3_,
    ItemIdentifiers.RELICYMS_BALM_2_,
    ItemIdentifiers.RELICYMS_BALM_1_,
  ];

  const SEARCH_ATTRIBUTE = "quest.zogre_flesh_eaters.search";
  const DECLINED_ATTRIBUTE = "quest.zogre_flesh_eaters.declined";
  const ASKED_LOOK_ATTRIBUTE = "quest.zogre_flesh_eaters.asked_look";
  const ASKED_REMOVE_ATTRIBUTE = "quest.zogre_flesh_eaters.asked_remove";
  const MAKE_BRUTAL_ATTRIBUTE = "quest.zogre_flesh_eaters.make_brutal";
  const MAKE_CURE_ATTRIBUTE = "quest.zogre_flesh_eaters.make_cure";
  const TANKARD_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.tankard_shown";
  const NECRO_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.necro_shown";
  const HAM_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.ham_shown";
  const PORTRAIT_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.portrait_shown";
  const INNKEEPER_SIGNED_ATTRIBUTE = "quest.zogre_flesh_eaters.innkeeper_signed";
  const SOLD_BALM_ATTRIBUTE = "quest.zogre_flesh_eaters.sold_balm";
  const SKELETON_ATTRIBUTE = "quest.zogre_flesh_eaters.skeleton";
  const TRANSFORMED_ATTRIBUTE = "quest.zogre_flesh_eaters.transformed";
  const POTION_USED_ATTRIBUTE = "quest.zogre_flesh_eaters.potion_used";
  const DOOR_LEAVING_ATTRIBUTE = "quest.zogre_flesh_eaters.door_leaving";

  const PERSISTED_ATTRIBUTES = [
    SEARCH_ATTRIBUTE,
    DECLINED_ATTRIBUTE,
    ASKED_LOOK_ATTRIBUTE,
    ASKED_REMOVE_ATTRIBUTE,
    MAKE_BRUTAL_ATTRIBUTE,
    MAKE_CURE_ATTRIBUTE,
    TANKARD_SHOWN_ATTRIBUTE,
    NECRO_SHOWN_ATTRIBUTE,
    HAM_SHOWN_ATTRIBUTE,
    PORTRAIT_SHOWN_ATTRIBUTE,
    INNKEEPER_SIGNED_ATTRIBUTE,
    SOLD_BALM_ATTRIBUTE,
    SKELETON_ATTRIBUTE,
    TRANSFORMED_ATTRIBUTE,
    POTION_USED_ATTRIBUTE,
  ];

  let quest;
  let liftRoll = null;
  let paintRoll = null;
  const slashBashByPlayer = new Map();
  const zombieByPlayer = new Map();

  const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const flag = (player, key) => player.getAttribute(key) === true;
  const setFlag = (player, key, value = true) => player.setAttribute(key, value);
  const progress = (player) => Number(player.getAttribute(SEARCH_ATTRIBUTE)) || 0;

  function setProgress(player, value) {
    if (value > progress(player)) player.setAttribute(SEARCH_ATTRIBUTE, value);
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function takeAll(player, itemId) {
    const amount = player.getInventory().getAmount(itemId);
    if (amount > 0) take(player, itemId, amount);
  }

  function otherQuestStage(player, key) {
    return Number(player.getAttribute(`quest.${key}.stage`)) || 0;
  }

  /** Jungle Potion (12) and Big Chompy Bird Hunting (65) plus the journal skills. */
  function requirementsMet(player) {
    const skills = player.getSkillManager();
    if (skills.getCurrentLevel(Skill.RANGED) < 30) return false;
    if (skills.getCurrentLevel(Skill.FLETCHING) < 30) return false;
    if (skills.getCurrentLevel(Skill.SMITHING) < 4) return false;
    if (skills.getCurrentLevel(Skill.HERBLORE) < 8) return false;
    return otherQuestStage(player, "jungle_potion") >= 12
      && otherQuestStage(player, "big_chompy_bird_hunting") >= 65;
  }

  function allEvidence(player) {
    return (
      flag(player, TANKARD_SHOWN_ATTRIBUTE) &&
      flag(player, NECRO_SHOWN_ATTRIBUTE) &&
      flag(player, HAM_SHOWN_ATTRIBUTE) &&
      flag(player, PORTRAIT_SHOWN_ATTRIBUTE)
    );
  }

  function consumeBalm(player) {
    for (const itemId of BALM_ITEM_IDS) {
      if (has(player, itemId)) {
        take(player, itemId);
        return;
      }
    }
  }

  // ==========================================================================
  // Dialogue variant selection
  // ==========================================================================

  function grishVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return { page: "Grish", variant: "standard-dialogue-after-zogre-flesh-eaters" };
    }
    if (stage >= STAGE_KILLED_SLASH_BASH) {
      return "defeating-the-zogres-talking-to-grish-after-killing-slash-bash";
    }
    if (stage >= STAGE_GIVEN_KEY) {
      if (!has(player, OGRE_GATE_KEY)) {
        give(player, OGRE_GATE_KEY);
        player.sendMessage("Grish gives you another ogre gate key.");
        return "defeating-the-zogres-talking-to-grish-talking-to-grish-after-losing-the-ogre-gate-key";
      }
      return "defeating-the-zogres-talking-to-grish-after-getting-the-ogre-gate-key";
    }
    if (stage >= STAGE_PERMANENT_SPELL) return "defeating-the-zogres-talking-to-grish";
    if (stage >= STAGE_STARTED) return "getting-started-talking-to-grish-after-starting-the-quest";
    if (flag(player, DECLINED_ATTRIBUTE)) {
      return "getting-started-talking-to-grish-after-declining-to-start-the-quest";
    }
    return "getting-started-talking-to-grish";
  }

  function zavisticVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_POTION) {
      return "investigating-b-vahn-talking-to-zavistic-rarve-after-giving-sithik-the-potion";
    }
    if (stage >= STAGE_SITHIK) {
      return "investigating-b-vahn-talking-to-zavistic-rarve-after-getting-the-potion";
    }
    if (progress(player) >= 5) {
      return "investigating-b-vahn-talking-to-zavistic-rarve-after-gathering-evidence";
    }
    if (progress(player) >= 4) {
      return "investigating-b-vahn-talking-to-zavistic-rarve-inside-the-guild";
    }
    return null;
  }

  function sithikVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (!flag(player, TRANSFORMED_ATTRIBUTE) && stage === STAGE_POTION && flag(player, POTION_USED_ATTRIBUTE)) {
      setFlag(player, TRANSFORMED_ATTRIBUTE);
    }
    if (flag(player, TRANSFORMED_ATTRIBUTE)) {
      return stage >= STAGE_PERMANENT_SPELL
        ? "investigating-b-vahn-talking-to-ogre-sithik-again"
        : "investigating-b-vahn-talking-to-sithik-ints-in-ogre-form";
    }
    if (stage >= STAGE_SITHIK) {
      return "investigating-b-vahn-talking-to-sithik-ints-after-convincing-zavistic-rarve";
    }
    if (progress(player) >= 4) return "investigating-b-vahn-talking-to-sithik-ints";
    return "investigating-b-vahn-talking-to-sithik-ints-before-talking-to-zavistic-rarve";
  }

  function selectVariant({ npcId, player }) {
    if (npcId === GRISH_NPC_ID) return grishVariant(player);
    if (OGRE_GUARD_NPC_IDS.has(npcId)) {
      return quest.getStage(player) === STAGE_STARTED ? "getting-started-talking-to-the-ogre-guard" : null;
    }
    if (npcId === ZOMBIE_NPC_ID) {
      return quest.getStage(player) >= STAGE_STARTED ? "entering-jiggig-talking-to-the-zombie" : null;
    }
    if (npcId === UGLUG_NAR_NPC_ID) {
      return quest.getStage(player) >= STAGE_STARTED
        ? "defeating-the-zogres-talking-to-uglug-nar-before-using-relicym-s-balm-on-him"
        : null;
    }
    if (npcId === ZAVISTIC_RARVE_NPC_ID) return zavisticVariant(player);
    if (SITHIK_NPC_IDS.has(npcId)) return sithikVariant(player);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function conditionByStepId(player, stepId) {
    switch (stepId) {
      case "toG5S7":
        return !requirementsMet(player);
      case "GT4F6A":
      case "Ob27cX":
        return freeSlots(player) < 3;
      case "czaQnN":
      case "Ljpqrr":
      case "twNelb":
        return freeSlots(player) < 1;
      case "rckqX2":
        liftRoll = Math.random() < 0.5;
        return liftRoll;
      case "ddiH2D":
        return !liftRoll;
      case "9k8sn2":
        paintRoll = Math.random() < 0.5;
        return paintRoll;
      case "66ZRpQ":
        return !paintRoll;
      case "tLq07i":
        return has(player, BLACK_PRISM) && !has(player, TORN_PAGE);
      case "68lhGh":
        return has(player, TORN_PAGE) && !has(player, BLACK_PRISM);
      case "Hssvbr":
        return has(player, BLACK_PRISM) && has(player, TORN_PAGE);
      case "MtHBKX":
      case "6aBsZ9":
      case "Wkh1-k":
        return has(player, DRAGON_INN_TANKARD);
      case "t-PJT_":
        return otherQuestStage(player, "hand_in_the_sand") > 0;
      case "-LI826":
        return otherQuestStage(player, "hand_in_the_sand") <= 0;
      case "lv5Jxg":
        return !flag(player, ASKED_LOOK_ATTRIBUTE);
      case "LZ6MaG":
        return flag(player, ASKED_LOOK_ATTRIBUTE);
      case "t38Fjy":
        return has(player, PAPYRUS) && !has(player, CHARCOAL);
      case "6c9Ccd":
        return has(player, CHARCOAL) && !has(player, PAPYRUS);
      case "9Yhl46":
        return !has(player, PAPYRUS) && !has(player, CHARCOAL);
      case "eckvkY":
        return !has(player, CHARCOAL);
      case "dNfjE1":
        return has(player, CHARCOAL);
      case "ToSRHJ":
        return has(player, NECROMANCY_BOOK);
      case "r_ML9k":
        return flag(player, NECRO_SHOWN_ATTRIBUTE);
      case "BB0Rho":
        return has(player, BOOK_OF_H_A_M);
      case "zgnhIQ":
        return flag(player, HAM_SHOWN_ATTRIBUTE);
      case "AF2zp6":
        return flag(player, TANKARD_SHOWN_ATTRIBUTE);
      case "u1Dkcd":
        return has(player, SIGNED_PORTRAIT);
      case "1h6l2m":
        return flag(player, PORTRAIT_SHOWN_ATTRIBUTE);
      case "uE6dyG":
        return !allEvidence(player);
      case "oBTnmc":
        return allEvidence(player);
      case "Rkj_LO":
        return !has(player, STRANGE_POTION) && !flag(player, POTION_USED_ATTRIBUTE);
      case "QodAi6":
        return !flag(player, ASKED_REMOVE_ATTRIBUTE);
      case "84F4T8":
        return flag(player, ASKED_REMOVE_ATTRIBUTE);
      case "eBjGsE":
        return !flag(player, MAKE_BRUTAL_ATTRIBUTE);
      case "eKMr46":
        return flag(player, MAKE_BRUTAL_ATTRIBUTE);
      case "kNxjeI":
        return !flag(player, MAKE_CURE_ATTRIBUTE);
      case "jmK4Z0":
        return flag(player, MAKE_CURE_ATTRIBUTE) && flag(player, TRANSFORMED_ATTRIBUTE);
      case "LBwCwE":
        return flag(player, MAKE_CURE_ATTRIBUTE) && !flag(player, TRANSFORMED_ATTRIBUTE);
      case "VNrY6X":
        return has(player, OGRE_GATE_KEY) && !flag(player, DOOR_LEAVING_ATTRIBUTE);
      case "ugvauV":
        return !has(player, OGRE_GATE_KEY) && !flag(player, DOOR_LEAVING_ATTRIBUTE);
      case "_u1zNb":
        return flag(player, DOOR_LEAVING_ATTRIBUTE);
      case "qO0PC_":
        return has(player, OGRE_ARTEFACT);
      case "1KSrVG":
        return !has(player, OGRE_ARTEFACT);
      default:
        return null;
    }
  }

  function answerCondition({ player, text, stepId }) {
    const byId = conditionByStepId(player, stepId);
    if (byId !== null) return byId;
    const value = String(text).toLowerCase();
    if (value.includes("doesn't have the requirements to start the quest")) return !requirementsMet(player);
    if (value.includes("does not have 3 inventory spaces")) return freeSlots(player) < 3;
    if (value.includes("does not have enough inventory space")) return freeSlots(player) < 1;
    if (value.includes("fails at painting")) {
      paintRoll = Math.random() < 0.5;
      return paintRoll;
    }
    if (value.includes("succeeds at painting")) return !paintRoll;
    if (value.includes("if the player fails")) {
      liftRoll = Math.random() < 0.5;
      return liftRoll;
    }
    if (value.includes("if the player succeeds")) return !liftRoll;
    if (value.includes("black prism but not the torn page")) return has(player, BLACK_PRISM) && !has(player, TORN_PAGE);
    if (value.includes("torn page but not the black prism")) return has(player, TORN_PAGE) && !has(player, BLACK_PRISM);
    if (value.includes("black prism and torn page")) return has(player, BLACK_PRISM) && has(player, TORN_PAGE);
    if (value.includes("shown zavistic the dragon inn tankard")) return flag(player, TANKARD_SHOWN_ATTRIBUTE);
    if (value.includes("dragon inn tankard")) return has(player, DRAGON_INN_TANKARD);
    if (value.includes("not started the hand in the sand")) return otherQuestStage(player, "hand_in_the_sand") <= 0;
    if (value.includes("started the hand in the sand")) return otherQuestStage(player, "hand_in_the_sand") > 0;
    if (value.includes("if the player has no inventory space")) return freeSlots(player) < 1;
    if (value.includes("papyrus but not charcoal")) return has(player, PAPYRUS) && !has(player, CHARCOAL);
    if (value.includes("charcoal but not papyrus")) return has(player, CHARCOAL) && !has(player, PAPYRUS);
    if (value.includes("has neither")) return !has(player, PAPYRUS) && !has(player, CHARCOAL);
    if (value.includes("doesn't have charcoal")) return !has(player, CHARCOAL);
    if (value.includes("has charcoal")) return has(player, CHARCOAL);
    if (value.includes("shown zavistic the necromancy book")) return flag(player, NECRO_SHOWN_ATTRIBUTE);
    if (value.includes("has the necromancy book")) return has(player, NECROMANCY_BOOK);
    if (value.includes("shown zavistic the book of 'h.a.m'")) return flag(player, HAM_SHOWN_ATTRIBUTE);
    if (value.includes("book of 'h.a.m'")) return has(player, BOOK_OF_H_A_M);
    if (value.includes("shown zavistic the signed portrait")) return flag(player, PORTRAIT_SHOWN_ATTRIBUTE);
    if (value.includes("has the signed portrait")) return has(player, SIGNED_PORTRAIT);
    if (value.includes("not yet shown all 4 pieces of evidence")) return !allEvidence(player);
    if (value.includes("shown all 4 pieces of evidence")) return allEvidence(player);
    if (value.includes("lost the potion")) return !has(player, STRANGE_POTION) && !flag(player, POTION_USED_ATTRIBUTE);
    if (value.includes("does not have the ogre gate key")) return !has(player, OGRE_GATE_KEY);
    if (value.includes("has the ogre gate key")) return has(player, OGRE_GATE_KEY);
    if (value.includes("if the player is leaving")) return flag(player, DOOR_LEAVING_ATTRIBUTE);
    if (value.includes("still has the artefact")) return has(player, OGRE_ARTEFACT);
    if (value.includes("lost the ogre artefact")) return !has(player, OGRE_ARTEFACT);
    if (value.includes("asking him again as an ogre")) return flag(player, MAKE_CURE_ATTRIBUTE) && flag(player, TRANSFORMED_ATTRIBUTE);
    if (value.includes("asking him again as a human")) return flag(player, MAKE_CURE_ATTRIBUTE) && !flag(player, TRANSFORMED_ATTRIBUTE);
    if (value.includes("if asking for the first time") || value.includes("asking for the first time")) return false;
    if (value.includes("if asking him again") || value.includes("asking him again")) return true;
    return null;
  }

  // ==========================================================================
  // Hook / choice / condition / action handling
  // ==========================================================================

  function handleChoice({ player, npcId, option }) {
    if (npcId !== GRISH_NPC_ID || quest.getStage(player) >= STAGE_STARTED) return;
    const text = String(option ?? "").toLowerCase();
    if (text.includes("too dangerous") || text.includes("sorry, i have to go")) {
      setFlag(player, DECLINED_ATTRIBUTE);
    } else if (text.includes("yes, i want to help")) {
      setFlag(player, DECLINED_ATTRIBUTE, false);
    }
  }

  function handleCondition({ player, npcId, stepId }) {
    if (!player || !stepId) return;
    switch (stepId) {
      case "ddiH2D":
        setProgress(player, 3);
        return;
      case "lv5Jxg":
        setFlag(player, ASKED_LOOK_ATTRIBUTE);
        return;
      case "QodAi6":
      case "84F4T8":
        setFlag(player, ASKED_REMOVE_ATTRIBUTE);
        break;
      case "eBjGsE":
      case "eKMr46":
        setFlag(player, MAKE_BRUTAL_ATTRIBUTE);
        break;
      case "kNxjeI":
      case "jmK4Z0":
      case "LBwCwE":
        setFlag(player, MAKE_CURE_ATTRIBUTE);
        break;
      default:
        return;
    }
    if (flag(player, TRANSFORMED_ATTRIBUTE) && quest.getStage(player) < STAGE_PERMANENT_SPELL) {
      quest.setStage(player, STAGE_PERMANENT_SPELL);
    }
  }

  function handleMessageStep(player, stepId) {
    switch (stepId) {
      case "CEI1zE":
      case "WX1Eih":
      case "thEwXi":
        setProgress(player, 4);
        return;
      case "tFIOsZ":
        setFlag(player, NECRO_SHOWN_ATTRIBUTE);
        return;
      case "QZF9jm":
        setFlag(player, HAM_SHOWN_ATTRIBUTE);
        return;
      case "m5Yh81":
      case "OG1g5U":
      case "ukw5TP":
        setFlag(player, TANKARD_SHOWN_ATTRIBUTE);
        return;
      case "5liwsa":
        setFlag(player, PORTRAIT_SHOWN_ATTRIBUTE);
        return;
      case "VDahRD":
        if (!has(player, STRANGE_POTION)) give(player, STRANGE_POTION);
        takeAll(player, DRAGON_INN_TANKARD);
        takeAll(player, NECROMANCY_BOOK);
        takeAll(player, BOOK_OF_H_A_M);
        takeAll(player, SIGNED_PORTRAIT);
        if (quest.getStage(player) < STAGE_SITHIK) quest.setStage(player, STAGE_SITHIK);
        return;
      case "ZOOxFx":
        setProgress(player, 5);
        return;
      case "rOCE25":
        if (has(player, SITHIK_PORTRAIT)) {
          take(player, SITHIK_PORTRAIT);
          give(player, SIGNED_PORTRAIT);
        }
        setFlag(player, INNKEEPER_SIGNED_ATTRIBUTE);
        return;
      case "JNza8B":
        if (!has(player, SITHIK_PORTRAIT) && !has(player, SITHIK_PORTRAIT_BAD) && !has(player, SIGNED_PORTRAIT)) {
          give(player, SITHIK_PORTRAIT_BAD);
        }
        return;
      case "YBgMW7":
        if (!has(player, SITHIK_PORTRAIT) && !has(player, SITHIK_PORTRAIT_BAD) && !has(player, SIGNED_PORTRAIT)) {
          give(player, SITHIK_PORTRAIT);
        }
        return;
      case "lKO3pR":
        if (has(player, PAPYRUS)) take(player, PAPYRUS);
        return;
      case "3b2CAk":
        if (!has(player, PAPYRUS)) give(player, PAPYRUS);
        return;
      case "-7JGGv":
        if (!has(player, CHARCOAL)) give(player, CHARCOAL);
        return;
      case "yHgbza":
        if (!has(player, PAPYRUS)) give(player, PAPYRUS);
        if (!has(player, CHARCOAL)) give(player, CHARCOAL);
        return;
      case "-5TCGA":
        if (!has(player, BOOK_OF_PORTRAITURE)) give(player, BOOK_OF_PORTRAITURE);
        return;
      case "UZ09e5":
        if (!has(player, BOOK_OF_H_A_M)) give(player, BOOK_OF_H_A_M);
        return;
      case "3joCI-":
        if (!has(player, NECROMANCY_BOOK)) give(player, NECROMANCY_BOOK);
        return;
      case "VIcEvT":
        if (!has(player, TORN_PAGE)) give(player, TORN_PAGE);
        return;
      case "6ce-Aa":
      case "j2cFmu":
        if (!has(player, DRAGON_INN_TANKARD)) give(player, DRAGON_INN_TANKARD);
        return;
      case "f6No5O":
      case "DdQesI":
        if (!has(player, KNIFE)) give(player, KNIFE);
        if (!has(player, ROTTEN_FOOD)) give(player, ROTTEN_FOOD);
        return;
      case "pGrhyb":
        if (!has(player, BLACK_PRISM)) give(player, BLACK_PRISM);
        return;
      case "Yzp9st":
        if (!has(player, OGRE_ARTEFACT)) give(player, OGRE_ARTEFACT);
        return;
      case "JRpLrN":
        if (!flag(player, SOLD_BALM_ATTRIBUTE)) {
          consumeBalm(player);
          give(player, COINS, 650);
          setFlag(player, SOLD_BALM_ATTRIBUTE);
        }
        return;
      default:
        return;
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (event.kind === "message") {
      handleMessageStep(player, stepId);
      return;
    }
    switch (stepId) {
      case "6kbf4F":
      case "66IFHw":
        setFlag(player, DECLINED_ATTRIBUTE, false);
        if (quest.getStage(player) < STAGE_STARTED) {
          quest.setStage(player, STAGE_STARTED);
          give(player, COOKED_CHOMPY, 3);
          give(player, SUPER_RESTORE_3, 2);
        }
        event.handled = true;
        return;
      case "izwjnR":
        if (quest.getStage(player) < STAGE_BARRICADE) quest.setStage(player, STAGE_BARRICADE);
        event.handled = true;
        return;
      case "YrmIgh":
        if (!has(player, OGRE_GATE_KEY)) give(player, OGRE_GATE_KEY);
        if (quest.getStage(player) < STAGE_GIVEN_KEY) quest.setStage(player, STAGE_GIVEN_KEY);
        event.handled = true;
        return;
      case "yn-UXu":
        if (quest.getStage(player) >= STAGE_KILLED_SLASH_BASH && has(player, OGRE_ARTEFACT)) {
          take(player, OGRE_ARTEFACT);
          quest.complete(player);
          event.handled = true;
          event.end = true;
        }
        return;
      case "IOrqNS":
        if (!has(player, STRANGE_POTION)) give(player, STRANGE_POTION);
        event.handled = true;
        return;
      case "1NqRbI":
        spawnSlashBash(player);
        event.handled = true;
        return;
      case "VHXgZ8":
        spawnBrentleZombie(player);
        event.handled = true;
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemAction(event) {
    const { player, itemId } = event;
    const option = String(event.option ?? "").toLowerCase();
    let variant = null;
    if (option === "read") {
      if (itemId === TORN_PAGE) variant = "entering-jiggig-read-torn-page";
      else if (itemId === NECROMANCY_BOOK) variant = "investigating-b-vahn-read-necromancy-book";
      else if (itemId === BOOK_OF_PORTRAITURE) variant = "investigating-b-vahn-read-the-book-of-portraiture";
      else if (itemId === BOOK_OF_H_A_M) variant = "investigating-b-vahn-read-book-of-h-a-m";
    } else if (option === "look-at") {
      if (itemId === BLACK_PRISM) variant = "entering-jiggig-look-at-black-prism";
      else if (itemId === DRAGON_INN_TANKARD) variant = "entering-jiggig-look-at-dragon-inn-tankard";
      else if (itemId === SIGNED_PORTRAIT) variant = "investigating-b-vahn-look-at-signed-portrait";
    }
    if (!variant) return;
    startTranscript(api, player, GRISH_NPC_ID, PAGE, variant);
    event.handled = true;
  }

  function itemOnNpcVariant(npcId, itemId, player) {
    if (npcId === ZAVISTIC_RARVE_NPC_ID) {
      if (quest.getStage(player) < STAGE_STARTED) return null;
      if (itemId === BLACK_PRISM) {
        return "investigating-b-vahn-use-the-black-prism-on-zavistic-rarve-after-he-has-already-it";
      }
      if (itemId === TORN_PAGE) return "investigating-b-vahn-use-the-torn-page-on-zavistic-rarve";
      if (itemId === SITHIK_PORTRAIT_BAD) return "investigating-b-vahn-using-the-bad-portrait-on-zavistic-rarve";
      if (itemId === SITHIK_PORTRAIT) return "investigating-b-vahn-using-the-good-portrait-on-zavistic-rarve";
      if ([SIGNED_PORTRAIT, NECROMANCY_BOOK, BOOK_OF_H_A_M, DRAGON_INN_TANKARD].includes(itemId)) {
        return "investigating-b-vahn-talking-to-zavistic-rarve-after-gathering-evidence";
      }
      return null;
    }
    if (SITHIK_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) < STAGE_STARTED) return null;
      if (itemId === PAPYRUS) return "investigating-b-vahn-use-papyrus-on-sithik-ints";
      if (itemId === BLACK_PRISM) return "investigating-b-vahn-use-black-prism-on-sithik-ints";
      if (itemId === TORN_PAGE) return "investigating-b-vahn-use-torn-page-on-sithik-ints";
      if (itemId === DRAGON_INN_TANKARD) return "investigating-b-vahn-use-dragon-inn-tankard-on-sithik-ints";
      if (itemId === BOOK_OF_H_A_M) return "investigating-b-vahn-using-the-book-of-h-a-m-on-sithik-ints";
      if (itemId === NECROMANCY_BOOK) return "investigating-b-vahn-use-necromancy-book-on-sithik-ints";
      if (itemId === BOOK_OF_PORTRAITURE) return "investigating-b-vahn-use-book-of-portraiture-on-sithik-ints";
      if (itemId === SITHIK_PORTRAIT_BAD) return "investigating-b-vahn-using-the-bad-portrait-on-sithik-ints";
      if (itemId === SITHIK_PORTRAIT) return "investigating-b-vahn-using-the-good-portrait-on-sithik-ints";
      if (itemId === SIGNED_PORTRAIT) return "investigating-b-vahn-using-the-signed-portrait-on-sithik-ints";
      if (itemId === STRANGE_POTION) return "investigating-b-vahn-using-strange-potion-on-sithik-ints";
      return null;
    }
    if (npcId === DRAGON_INN_BARTENDER_NPC_ID) {
      if (itemId === DRAGON_INN_TANKARD) {
        return flag(player, TANKARD_SHOWN_ATTRIBUTE)
          ? "investigating-b-vahn-using-the-dragon-inn-tankard-on-the-dragon-inn-bartender-using-the-dragon-inn-tankard-on-the-dragon-inn-bartender-again"
          : "investigating-b-vahn-using-the-dragon-inn-tankard-on-the-dragon-inn-bartender";
      }
      if (itemId === TORN_PAGE) return "investigating-b-vahn-using-the-torn-page-on-the-dragon-inn-bartender";
      if (itemId === BLACK_PRISM) return "investigating-b-vahn-using-the-black-prism-on-the-dragon-inn-bartender";
      if (itemId === SITHIK_PORTRAIT_BAD) {
        return "investigating-b-vahn-using-the-bad-portrait-on-the-dragon-inn-bartender";
      }
      if (itemId === SITHIK_PORTRAIT) return "investigating-b-vahn-using-the-good-portrait-on-the-dragon-inn-bartender";
      return null;
    }
    if (npcId === IRWIN_FEASELBAUM_NPC_ID) {
      if (itemId === TORN_PAGE) return { page: IRWIN_PAGE, variant: "using-the-torn-page-on-him" };
      if (itemId === NECROMANCY_BOOK) return { page: IRWIN_PAGE, variant: "using-the-necromancy-book-on-him" };
      return null;
    }
    if (JOHANHUS_ULSBRECHT_NPC_IDS.has(npcId)) {
      if (itemId === BOOK_OF_H_A_M) {
        return "investigating-b-vahn-using-the-book-of-h-a-m-on-johanhus-ulsbrecht";
      }
      return null;
    }
    if (npcId === UGLUG_NAR_NPC_ID) {
      if (!BALM_ITEM_IDS.includes(itemId)) return null;
      return flag(player, SOLD_BALM_ATTRIBUTE)
        ? { page: "Uglug Nar", variant: "after-zogre-flesh-eaters" }
        : "defeating-the-zogres-use-relicym-s-balm-on-uglug-nar";
    }
    if (npcId === GRISH_NPC_ID && itemId === OGRE_ARTEFACT) {
      return quest.getStage(player) >= STAGE_KILLED_SLASH_BASH
        ? "defeating-the-zogres-talking-to-grish-after-killing-slash-bash"
        : null;
    }
    return null;
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId === undefined || npcId === null) return;
    const choice = itemOnNpcVariant(npcId, event.itemId, event.player);
    if (!choice) return;
    const page = typeof choice === "string" ? PAGE : choice.page;
    const variant = typeof choice === "string" ? choice : choice.variant;
    event.handled = true;
    startTranscript(api, event.player, npcId, page, variant);
  }

  function pourPotion(player) {
    if (quest.getStage(player) < STAGE_SITHIK || !has(player, STRANGE_POTION)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (flag(player, POTION_USED_ATTRIBUTE)) {
      player.sendMessage("You have already poured the potion into the tea.");
      return;
    }
    take(player, STRANGE_POTION);
    if (!has(player, SAMPLE_BOTTLE)) give(player, SAMPLE_BOTTLE);
    setFlag(player, POTION_USED_ATTRIBUTE);
    if (quest.getStage(player) < STAGE_POTION) quest.setStage(player, STAGE_POTION);
    startTranscript(api, player, SITHIK_NPC_ID, PAGE, "investigating-b-vahn-using-strange-potion-on-cup-of-tea");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (OGRE_COFFIN_IDS.has(objectId) && itemId === KNIFE) {
      event.handled = true;
      if (progress(player) !== 1) {
        player.sendMessage("Nothing interesting happens.");
        return;
      }
      setProgress(player, 2);
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-use-knife-on-ogre-coffin");
      return;
    }
    if (SITHIK_BED_IDS.has(objectId) && itemId === PAPYRUS) {
      event.handled = true;
      startTranscript(api, player, SITHIK_NPC_ID, PAGE, "investigating-b-vahn-use-papyrus-on-sithik-ints");
      return;
    }
    if (objectId === CUP_OF_TEA_OBJECT_ID && itemId === STRANGE_POTION) {
      event.handled = true;
      pourPotion(player);
    }
  }

  function handleItemOnGroundItem(event) {
    if (event.inventoryItemId !== STRANGE_POTION || event.groundItemId !== CUP_OF_TEA) return;
    event.handled = true;
    pourPotion(event.player);
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function objectOp(event) {
    return String((event.definition?.getActions?.() ?? [])[event.clickType - 1] ?? "").toLowerCase();
  }

  function searchDrawersOrCupboard(event, searchVariant) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) >= STAGE_SITHIK) {
      startTranscript(api, player, SITHIK_NPC_ID, PAGE, "investigating-b-vahn-searching-the-drawers-wardrobe-or-cupboard-after-convincing-zavistic-rarve");
      return;
    }
    startTranscript(api, player, SITHIK_NPC_ID, PAGE, searchVariant);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    const op = objectOp(event);

    if (objectId === BROKEN_LECTERN_ID) {
      if (op !== "search") return;
      event.handled = true;
      if (progress(player) >= 4 || quest.getStage(player) >= STAGE_SITHIK) {
        player.sendMessage("You search the lectern, but find nothing.");
        return;
      }
      if (has(player, TORN_PAGE)) {
        player.sendMessage("You find nothing here this time.");
        return;
      }
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-search-broken-lecturn");
      return;
    }

    if (objectId === OGRE_SKELETON_ID) {
      if (op !== "search") return;
      event.handled = true;
      const state = Number(player.getAttribute(SKELETON_ATTRIBUTE)) || 0;
      if (state >= 2) {
        if (
          quest.getStage(player) >= STAGE_SITHIK ||
          has(player, RUINED_BACKPACK) ||
          has(player, DRAGON_INN_TANKARD)
        ) {
          player.sendMessage("You find nothing on the corpse.");
          return;
        }
        give(player, RUINED_BACKPACK);
        player.sendMessage("You find a backpack on the corpse.");
        return;
      }
      if (zombieByPlayer.has(player)) {
        player.sendMessage("You're in mortal danger, you don't have time to search!");
        return;
      }
      player.setAttribute(SKELETON_ATTRIBUTE, 1);
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-search-skeleton");
      return;
    }

    if (OGRE_COFFIN_IDS.has(objectId)) {
      if (op !== "search") return;
      event.handled = true;
      const state = progress(player);
      if (state >= 3) {
        if (has(player, BLACK_PRISM)) {
          player.sendMessage("You find nothing inside this time.");
          return;
        }
        startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-search-the-ogre-coffin-after-it-is-opened");
        return;
      }
      if (state === 2) {
        startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-search-ogre-coffin-after-unlocking-it");
        return;
      }
      setProgress(player, 1);
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-search-ogre-coffin");
      return;
    }

    if (objectId === SITHIKS_DRAWERS_ID && op === "search") {
      searchDrawersOrCupboard(event, "investigating-b-vahn-search-drawers");
      return;
    }
    if (objectId === SITHIKS_CUPBOARD_ID && op === "search") {
      searchDrawersOrCupboard(event, "investigating-b-vahn-search-cupboard");
      return;
    }
    if (objectId === SITHIKS_WARDROBE_ID && op === "search") {
      searchDrawersOrCupboard(event, "investigating-b-vahn-search-wardrobe");
      return;
    }

    if (objectId === OUTDOOR_BELL_ID) {
      if (op !== "ring") return;
      event.handled = true;
      startTranscript(api, player, ZAVISTIC_RARVE_NPC_ID, PAGE, "investigating-b-vahn-ringing-the-bell-outside-the-wizards-guild");
      return;
    }

    if (OGRE_TOMB_DOOR_IDS.has(objectId)) {
      if (op !== "open") return;
      event.handled = true;
      player.setAttribute(DOOR_LEAVING_ATTRIBUTE, player.getLocation().getY() < event.location.y);
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "defeating-the-zogres-open-ogre-stone-door");
      player.setAttribute(DOOR_LEAVING_ATTRIBUTE, false);
      return;
    }

    if (objectId === OGRE_STAND_ID) {
      if (op !== "search") return;
      event.handled = true;
      if (slashBashByPlayer.has(player)) {
        player.sendMessage("You're in mortal danger, you don't have time to search!");
        return;
      }
      const stage = quest.getStage(player);
      if (stage >= STAGE_KILLED_SLASH_BASH) {
        if (!has(player, OGRE_ARTEFACT)) {
          startTranscript(api, player, GRISH_NPC_ID, PAGE, "defeating-the-zogres-search-stand-search-the-stand-again");
        } else {
          player.sendMessage("You find nothing in particular.");
        }
        return;
      }
      if (stage >= STAGE_GIVEN_KEY) {
        startTranscript(api, player, GRISH_NPC_ID, PAGE, "defeating-the-zogres-search-stand");
        return;
      }
      player.sendMessage("You find nothing in particular.");
      return;
    }

    if (SITHIK_BED_IDS.has(objectId)) {
      if (op !== "talk-to") return;
      event.handled = true;
      const variant = sithikVariant(player);
      if (variant) {
        startTranscript(api, player, SITHIK_NPC_ID, PAGE, variant);
      } else if (quest.getStage(player) >= STAGE_COMPLETE) {
        startTranscript(api, player, SITHIK_NPC_ID, "Sithik Ints", "standard-dialogue-after-completion-of-zogre-flesh-eaters");
      } else {
        startTranscript(api, player, SITHIK_NPC_ID, "Sithik Ints", "standard-dialogue-before-starting-zogre-flesh-eaters");
      }
    }
  }

  // ==========================================================================
  // Spawns and deaths
  // ==========================================================================

  function spawnSlashBash(player) {
    if (slashBashByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: SLASH_BASH_NPC_ID,
      x: 2477,
      y: 9444,
      z: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) slashBashByPlayer.set(player, npc);
  }

  function spawnBrentleZombie(player) {
    if (zombieByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: ZOMBIE_NPC_ID,
      x: 2442,
      y: 9458,
      z: 2,
      owner: player,
      ownerOnly: true,
    });
    if (npc) zombieByPlayer.set(player, npc);
  }

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player) return;
    if (event.npcId === SLASH_BASH_NPC_ID) {
      slashBashByPlayer.delete(player);
      if (quest.getStage(player) < STAGE_KILLED_SLASH_BASH) {
        quest.setStage(player, STAGE_KILLED_SLASH_BASH);
      }
      if (!has(player, OGRE_ARTEFACT)) give(player, OGRE_ARTEFACT);
      return;
    }
    if (event.npcId === ZOMBIE_NPC_ID) {
      zombieByPlayer.delete(player);
      player.setAttribute(SKELETON_ATTRIBUTE, 2);
    }
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Grish asked me to find out why the Zogres had appeared at</str>",
        "<str>Jiggig. I found that the wizard Sithik Ints was responsible,</str>",
        "<str>but the necromantic spell could not be removed.</str>",
        "<str>I recovered the ogre artefacts so Grish can move the</str>",
        "<str>ceremonial grounds.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_KILLED_SLASH_BASH) {
      return has(player, OGRE_ARTEFACT)
        ? ["<str>I defeated Slash Bash.</str>", "I have the <col=800000>ogre artefact</col>; I should take it to Grish."]
        : ["<str>I defeated Slash Bash.</str>", "I lost the artefact; searching the <col=800000>stand</col> may find another."];
    }
    if (stage >= STAGE_GIVEN_KEY) {
      return [
        "<str>Sithik admitted the spell is permanent.</str>",
        "Grish gave me the <col=800000>ogre gate key</col>.",
        "I should search the tomb for the <col=800000>ogre artefacts</col>.",
      ];
    }
    if (stage >= STAGE_PERMANENT_SPELL) {
      return [
        "<str>Sithik told me the curse cannot be removed.</str>",
        "I should tell <col=800000>Grish</col> what I have learned.",
      ];
    }
    if (stage >= STAGE_POTION) {
      return [
        "<str>I poured Zavistic's potion into Sithik's tea.</str>",
        "I should check on <col=800000>Sithik</col> and see what happened.",
      ];
    }
    if (stage >= STAGE_SITHIK) {
      return has(player, STRANGE_POTION)
        ? ["<str>Zavistic gave me a strange potion for Sithik.</str>", "I should pour it into <col=800000>Sithik's cup of tea</col>."]
        : ["<str>Zavistic gave me a strange potion, but I lost it.</str>", "I should ask <col=800000>Zavistic Rarve</col> for another."];
    }
    if (stage >= STAGE_BARRICADE) {
      const lines = [
        "<str>An ogre guard smashed the barricade for me.</str>",
        "I should explore the tomb under Jiggig:",
      ];
      const search = progress(player);
      if (search >= 4) lines.push("I have shown the <col=800000>prism</col> and the <col=800000>torn page</col> to the wizards.");
      else if (search >= 3) lines.push("I recovered a <col=800000>black prism</col> and a <col=800000>torn page</col> from the tomb.");
      else if (search >= 1) lines.push("I have searched the coffin; the lock looks like it could be forced.");
      else lines.push("Search the <col=800000>lectern</col> and the <col=800000>skeleton</col> for clues.");
      return lines;
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Grish asked me to learn why the <col=800000>Zogres</col> have",
        "appeared at <col=800000>Jiggig</col> and to deal with them.",
        "I need to get past the <col=800000>ogre guard</col>.",
      ];
    }
    const lines = [
      "I can start this quest by speaking to <col=800000>Grish</col>",
      "at <col=800000>Jiggig</col>, south of Castle Wars.",
      "",
      "To start this quest I must complete:",
    ];
    lines.push(otherQuestStage(player, "jungle_potion") >= 12 ? "<str>Jungle Potion</str>" : "Jungle Potion");
    lines.push(
      otherQuestStage(player, "big_chompy_bird_hunting") >= 65
        ? "<str>Big Chompy Bird Hunting</str>"
        : "Big Chompy Bird Hunting"
    );
    lines.push("", "It would help if I had 30 Ranged, 30 Fletching, 4 Smithing and 8 Herblore.");
    return lines;
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  for (const attribute of PERSISTED_ATTRIBUTES) api.persistAttribute(attribute);

  function grantReward(player) {
    give(player, OURG_BONES, 2);
    give(player, ZOGRE_BONES, 2);
  }

  function handleLogin({ player }) {
    slashBashByPlayer.delete(player);
    zombieByPlayer.delete(player);
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "zogre_flesh_eaters",
    name: "Zogre Flesh Eaters",
    varpId: VARP_ZOGRE_FLESH_EATERS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.FLETCHING.getIndex(), amount: 2000, label: "Fletching" },
      { skillId: Skill.RANGED.getIndex(), amount: 2000, label: "Ranged" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 2000, label: "Herblore" },
    ],
    rewardItemId: OURG_BONES,
    rewardItemLabel: "3 Ourg bones and 2 Zogre bones",
    otherRewards: [
      "Ability to make Relicym's balm",
      "Ability to fletch comp ogre bows and brutal arrows",
      "Uglug Nar's shop",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction(handleItemAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnGroundItem(handleItemOnGroundItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
