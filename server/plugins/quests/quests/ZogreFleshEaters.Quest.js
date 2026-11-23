/**
 * Zogre Flesh Eaters (members).
 *
 * The words come from the "Zogre Flesh Eaters" transcript page plus the indexed "Grish",
 * "Zavistic Rarve", "Sithik Ints", "Irwin Feaselbaum", "Uglug Nar", "Ogre guard (Jiggig)" and
 * "Bartender (Dragon Inn)" pages; this plugin supplies the variant selector for the quest NPCs,
 * the prose-condition answers, the start/complete actions and the item hand-outs. The places
 * play as the revision 242 capture does (rsprox ZogreFleshEaters.bin, a whole run of the quest;
 * docs/quests/zogre-flesh-eaters/README.md): Jiggig (the barricade, the stairs and the
 * north-west room's scene) in ../zogreflesheaters/Jiggig, the tomb (the skeleton, the coffin, the
 * stone doors, the stand and Slash Bash) in Tomb, how each message step shows in Boxes, the
 * journal in Journal and the native varbits in State.
 *
 * Stages (varbit 487): 0 unstarted, 2 investigate (started), 3 barricade crushed, 4 Sithik
 * (evidence turned in / potion received), 6 potion (tea poisoned), 8 permanent_spell (Sithik's
 * answer), 10 given_key, 12 killed_slash_bash, 14 complete; the cache's completion threshold is 14.
 * The coffin/evidence sub-progress (0..5, varbit 488) and the one-shot flags live in persisted
 * "quest.zogre_flesh_eaters.*" / "zogre-flesh-eaters:*" attributes, sent as their thzfe_* varbits.
 *
 * Historical implementation attribution: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/quest/member/ogre/ZogreFleshEaters.kt
 */
module.exports = function registerZogreFleshEatersQuest(api) {
  const { Skill, Item, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const { VARBITS, STAGES, ATTRIBUTES } = require("../zogreflesheaters/State.ZogreFleshEaters");
  const { createWizardsGuildBell } = require("../WizardsGuildBell");
  const bell = createWizardsGuildBell(api);

  const PAGE = "Zogre Flesh Eaters";

  const VARBIT_ZOGRE_FLESH_EATERS = VARBITS.QUEST;
  const STAGE_STARTED = STAGES.STARTED;
  const STAGE_BARRICADE = STAGES.BARRICADE;
  const STAGE_SITHIK = STAGES.SITHIK;
  const STAGE_POTION = STAGES.POTION;
  const STAGE_PERMANENT_SPELL = STAGES.PERMANENT_SPELL;
  const STAGE_GIVEN_KEY = STAGES.GIVEN_KEY;
  const STAGE_KILLED_SLASH_BASH = STAGES.KILLED_SLASH_BASH;
  const STAGE_COMPLETE = STAGES.COMPLETE;

  const GRISH_NPC_ID = NpcIdentifiers.GRISH;
  const UGLUG_NAR_NPC_ID = NpcIdentifiers.UGLUG_NAR;
  /** The barricade guard; 865 is the coffin guard, with his own page (capture ticks 59-79). */
  const BARRICADE_GUARD_NPC_ID = NpcIdentifiers.OGRE_GUARD;
  const COFFIN_GUARD_NPC_ID = NpcIdentifiers.OGRE_GUARD_2;
  const OGRE_GUARD_PAGE = "Ogre guard (Jiggig)";
  const ZOMBIE_NPC_ID = NpcIdentifiers.ZOMBIE_44;
  const ZAVISTIC_RARVE_NPC_ID = NpcIdentifiers.ZAVISTIC_RARVE;
  const SITHIK_NPC_ID = NpcIdentifiers.SITHIK_INTS;
  /** zogre_sithik_ogre: his chathead once the potion has worked. */
  const SITHIK_OGRE_NPC_ID = NpcIdentifiers.SITHIK_INTS_2;
  const SITHIK_NPC_IDS = new Set([NpcIdentifiers.SITHIK_INTS, NpcIdentifiers.SITHIK_INTS_2]);
  const IRWIN_FEASELBAUM_NPC_ID = NpcIdentifiers.IRWIN_FEASELBAUM;
  const DRAGON_INN_BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER_9; // Dragon Inn (Yanille)
  const JOHANHUS_ULSBRECHT_NPC_IDS = new Set([
    NpcIdentifiers.JOHANHUS_ULSBRECHT,
    NpcIdentifiers.JOHANHUS_ULSBRECHT_2,
  ]);
  const IRWIN_PAGE = "Irwin Feaselbaum";

  const SITHIK_BED_IDS = new Set([
    ObjectIdentifiers.SITHIK_INTS,
    ObjectIdentifiers.SITHIK_INTS_2,
    6887, // zogre_sithik_bed_entity: the multiloc on 495, no ObjectIdentifiers entry
  ]);
  const BROKEN_LECTERN_ID = ObjectIdentifiers.BROKEN_LECTERN;
  const OUTDOOR_BELL_ID = ObjectIdentifiers.BELL_2;
  const SITHIKS_DRAWERS_ID = ObjectIdentifiers.DRAWERS_11;
  const SITHIKS_CUPBOARD_ID = ObjectIdentifiers.CUPBOARD_30;
  const SITHIKS_WARDROBE_ID = ObjectIdentifiers.WARDROBE_7;
  const CUP_OF_TEA_OBJECT_ID = 4838; // zogre_cup_of_tea_sithix: no ObjectIdentifiers entry, ground object fallback
  /** Sithik's ladder down (laddertop2 at 2597,3107,1): going down it after the tea transforms him (tick 1558). */
  const SITHIK_LADDER = { id: ObjectIdentifiers.LADDER_193, x: 2597, y: 3107, z: 1 };

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
  const COOKED_CHOMPY = ItemIdentifiers.COOKED_CHOMPY;
  const SUPER_RESTORE_3 = ItemIdentifiers.SUPER_RESTORE_3_;
  const COINS = ItemIdentifiers.COINS;
  /** The prism's price (capture tick 1760). */
  const PRISM_PRICE = 2000;
  const POUR_SEQ = 832;
  const POUR_SOUND = 1955;
  const LECTERN_SEARCH_SEQ = 827;

  /** Uglug Nar's coins by the dose of the balm (the Wiki: 1000, 650, 300 or 100; 650 for a 3-dose, tick 3196). */
  const BALM_PRICES = new Map([
    [ItemIdentifiers.RELICYMS_BALM_4_, 1000],
    [ItemIdentifiers.RELICYMS_BALM_3_, 650],
    [ItemIdentifiers.RELICYMS_BALM_2_, 300],
    [ItemIdentifiers.RELICYMS_BALM_1_, 100],
  ]);
  const BALM_ITEM_IDS = [...BALM_PRICES.keys()];
  /** Ours: the lid's chance; the capture lifts it on the sixth try (ticks 591-662), the Wiki says "a couple of tries". */
  const LIFT_CHANCE = 0.5;

  const SEARCH_ATTRIBUTE = "quest.zogre_flesh_eaters.search";
  const DECLINED_ATTRIBUTE = "quest.zogre_flesh_eaters.declined";
  const ASKED_LOOK_ATTRIBUTE = "quest.zogre_flesh_eaters.asked_look";
  const ASKED_REMOVE_ATTRIBUTE = "quest.zogre_flesh_eaters.asked_remove";
  const MAKE_BRUTAL_ATTRIBUTE = "quest.zogre_flesh_eaters.make_brutal";
  const MAKE_CURE_ATTRIBUTE = "quest.zogre_flesh_eaters.make_cure";
  const TANKARD_SHOWN_ATTRIBUTE = "zogre-flesh-eaters:zavistic-tankard-shown";
  const NECRO_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.necro_shown";
  const HAM_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.ham_shown";
  const PORTRAIT_SHOWN_ATTRIBUTE = "quest.zogre_flesh_eaters.portrait_shown";
  const INNKEEPER_SIGNED_ATTRIBUTE = "quest.zogre_flesh_eaters.innkeeper_signed";
  const INNKEEPER_MUG_ATTRIBUTE = "zogre-flesh-eaters:innkeeper-mug-shown";
  const INNKEEPER_PORTRAIT_ATTRIBUTE = "zogre-flesh-eaters:innkeeper-portrait-shown";
  const MAKE_BOW_ATTRIBUTE = "zogre-flesh-eaters:make-composite-bow";
  /** The Herblore and Fletching recipes the quest teaches (skills/data/herblore.json, fletching.json). */
  const HERBLORE_BALM_UNLOCK = "relicyms_balm";
  const FLETCHING_TAUGHT = Object.freeze({ brutal_arrows: MAKE_BRUTAL_ATTRIBUTE, comp_ogre_bow: MAKE_BOW_ATTRIBUTE });
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

  const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const flag = (player, key) => player.getAttribute(key) === true;
  function setFlag(player, key, value = true) {
    player.setAttribute(key, value);
    syncAuxiliaryState(player);
  }
  const progress = (player) => Number(player.getAttribute(SEARCH_ATTRIBUTE)) || 0;

  function setProgress(player, value) {
    if (value > progress(player)) player.setAttribute(SEARCH_ATTRIBUTE, value);
    syncAuxiliaryState(player);
  }

  /** The thzfe_* flags kept as attributes. 498 (thzfe_makecuredisease) is not sent: the capture asks
   * Sithik about the disease and tells Grish of the cure without it changing (ticks 1604, 2263). */
  const AUXILIARY_FLAGS = [
    [VARBITS.INNKEEPER_MUG, INNKEEPER_MUG_ATTRIBUTE], [VARBITS.INNKEEPER_PORTRAIT, INNKEEPER_PORTRAIT_ATTRIBUTE],
    [VARBITS.SHOWN_NECRO_BOOK, NECRO_SHOWN_ATTRIBUTE], [VARBITS.SHOWN_HAM_BOOK, HAM_SHOWN_ATTRIBUTE],
    [VARBITS.SHOWN_TANKARD, TANKARD_SHOWN_ATTRIBUTE], [VARBITS.SHOWN_PORTRAIT, PORTRAIT_SHOWN_ATTRIBUTE],
    [VARBITS.MAKE_BRUTAL_ARROW, MAKE_BRUTAL_ATTRIBUTE], [VARBITS.MAKE_COMP_OGRE_BOW, MAKE_BOW_ATTRIBUTE],
    [VARBITS.SOLD_BALM, SOLD_BALM_ATTRIBUTE], [VARBITS.PRISM_SOLD, ATTRIBUTES.PRISM_SOLD],
    [VARBITS.CUT_SCENE, ATTRIBUTES.CUT_SCENE],
  ];

  const prismSearchValue = (player) => (flag(player, ASKED_LOOK_ATTRIBUTE) ? 5 : progress(player));

  /** 495: Sithik an ogre once the tea has worked, a man again from Grish's key on (tick 2328). */
  function transformedValue(player) {
    if (!flag(player, TRANSFORMED_ATTRIBUTE)) return 0;
    return quest.getStage(player) >= STAGE_GIVEN_KEY ? 2 : 1;
  }

  /**
   * Who speaks Sithik's lines: his ogre chathead (884) while 495 is 1, the man (883) otherwise
   * (capture ticks 1567-1611 for the ogre; 1057-1544 before the tea).
   */
  function sithikSpeakerId(player) {
    return transformedValue(player) === 1 ? SITHIK_OGRE_NPC_ID : SITHIK_NPC_ID;
  }

  /**
   * "herblore:unlocked" { unlock: "relicyms_balm" }: Relicym's balm once Sithik has told the player
   * how to cure the disease (Wiki, Relicym's balm: "Partial completion of Zogre Flesh Eaters ... to
   * the point where Sithik Ints tells the player how to cure the Zogre disease"), and after the quest.
   */
  function answerHerbloreUnlock(request) {
    if (request?.unlock !== HERBLORE_BALM_UNLOCK || !request.player) return;
    request.allowed = flag(request.player, MAKE_CURE_ATTRIBUTE) || quest.getStage(request.player) >= STAGE_COMPLETE;
  }

  /**
   * "fletching:taught" { name }: brutal arrows once Sithik has explained them (Wiki, Brutal arrows:
   * "Sithik Ints teaches you how to make them"; 499 at capture tick 1600) and the composite ogre bow
   * once Grish has (500 at capture tick 2246); either after the quest.
   */
  function answerFletchingTaught(request) {
    const attribute = FLETCHING_TAUGHT[request?.name];
    if (!attribute || !request.player) return;
    request.taught = flag(request.player, attribute) || quest.getStage(request.player) >= STAGE_COMPLETE;
  }

  function syncAuxiliaryState(player) {
    const sender = player.getPacketSender();
    for (const [id, attribute] of AUXILIARY_FLAGS) sender.sendVarbit(id, flag(player, attribute) ? 1 : 0);
    sender.sendVarbit(VARBITS.PRISM_SEARCH, prismSearchValue(player));
    sender.sendVarbit(VARBITS.BRENTLE_SKELETON, Number(player.getAttribute(SKELETON_ATTRIBUTE)) || 0);
    sender.sendVarbit(VARBITS.SITHIK_TRANSFORMED, transformedValue(player));
    if (quest) sender.sendVarbit(VARBITS.BLOCKING_BARRICADE, jiggig.barricadeValue(player));
  }

  function handleBootstrapComplete({ player }) {
    syncAuxiliaryState(player);
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
    const request = { player, key, stage: undefined };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage ?? player.getAttribute(`quest.${key}.stage`)) || 0;
  }

  /** Whether another quest is complete, by its own completion value (QuestRuntime's quest:is-complete). */
  function questComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * The Wiki's requirements: Big Chompy Bird Hunting and Jungle Potion, 4 Smithing and 8 Herblore
   * (boostable) and 30 Ranged (not boostable). Fletching is not one: the Wiki asks 30 Fletching only
   * to make the comp ogre bow (issue 4410).
   */
  function requirementsMet(player) {
    const skills = player.getSkillManager();
    const boostable = (skill, level) => Math.max(skills.getCurrentLevel(skill), skills.getMaxLevel(skill)) >= level;
    if (skills.getMaxLevel(Skill.RANGED) < 30) return false;
    if (!boostable(Skill.SMITHING, 4) || !boostable(Skill.HERBLORE, 8)) return false;
    return questComplete(player, "jungle_potion") && questComplete(player, "big_chompy_bird_hunting");
  }

  function allEvidence(player) {
    return (
      flag(player, TANKARD_SHOWN_ATTRIBUTE) &&
      flag(player, NECRO_SHOWN_ATTRIBUTE) &&
      flag(player, HAM_SHOWN_ATTRIBUTE) &&
      flag(player, PORTRAIT_SHOWN_ATTRIBUTE)
    );
  }

  function artefactOwned(player) {
    if (has(player, OGRE_ARTEFACT)) return true;
    if (typeof player.getBanks === "function" && api.core.Bank.owns(player, OGRE_ARTEFACT)) return true;
    const username = player.getUsername();
    return api.core.World.getItems().some((ground) =>
      ground.getItem().getId() === OGRE_ARTEFACT && ground.getOwner?.() === username);
  }

  /** The balm last used on Uglug Nar: his boxes show it and he buys that one (ticks 765, 3190-3196). */
  const balmUsed = new WeakMap();

  /** The transcript's text of a message step, so a scripted scene shows the Wiki's own words. */
  function messageText(variant, stepId) {
    let found = null;
    const walk = (node) => {
      if (found || !node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.id === stepId && typeof node.text === "string") {
        found = node.text;
        return;
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(loadTranscripts(api)?.[PAGE]?.variants?.[variant]);
    return found;
  }

  const items = { BLACK_PRISM, OGRE_GATE_KEY, OGRE_ARTEFACT, STRANGE_POTION, TORN_PAGE };
  const ctx = {
    quest: () => quest,
    sync: syncAuxiliaryState,
    startTranscript: (player, npcId, variant, options) =>
      startTranscript(api, player, npcId, PAGE, variant, undefined, null, options),
    messageText, has, flag, progress, setProgress, freeSlots, prismSearchValue, questComplete, items,
    GRISH_NPC_ID, SKELETON_ATTRIBUTE, INNKEEPER_MUG_ATTRIBUTE, LIFT_CHANCE,
    skeletonSearched,
  };
  const boxes = require("../zogreflesheaters/Boxes.ZogreFleshEaters")(api);
  const jiggig = require("../zogreflesheaters/Jiggig.ZogreFleshEaters")(api, ctx);
  const tomb = require("../zogreflesheaters/Tomb.ZogreFleshEaters")(api, ctx);
  const journal = require("../zogreflesheaters/Journal.ZogreFleshEaters")(ctx);
  require("../zogreflesheaters/SlashBash.ZogreFleshEaters")(api);

  /** The corpse once the zombie is dead (tick 495); Ours: a backpack again if both it and the tankard are gone. */
  function skeletonSearched(player) {
    if (quest.getStage(player) >= STAGE_SITHIK || has(player, RUINED_BACKPACK) || has(player, DRAGON_INN_TANKARD)) {
      player.sendMessage("You find nothing on the corpse.");
      return;
    }
    give(player, RUINED_BACKPACK);
    player.sendMessage("You find a backpack on the corpse.");
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
    if (progress(player) >= 4) {
      return "investigating-b-vahn-talking-to-zavistic-rarve-after-gathering-evidence";
    }
    return null;
  }

  function sithikVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
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
    if (npcId === BARRICADE_GUARD_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_BARRICADE) return { page: OGRE_GUARD_PAGE, variant: "standard-dialogue-barricade-guard" };
      return stage === STAGE_STARTED ? "getting-started-talking-to-the-ogre-guard" : null;
    }
    if (npcId === COFFIN_GUARD_NPC_ID) return { page: OGRE_GUARD_PAGE, variant: "standard-dialogue-level-76-ogre-guard" };
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
      // Sithik's "How do I get rid of the undead ogres?" (first time, again) and "How do I get rid of the disease?"
      // (first time, again as an ogre, again as a human): their ids in the regenerated npc-dialogues.json.
      case "uKFksI":
        return !flag(player, MAKE_BRUTAL_ATTRIBUTE);
      case "7KzANk":
        return flag(player, MAKE_BRUTAL_ATTRIBUTE);
      case "ZT09es":
        return !flag(player, MAKE_CURE_ATTRIBUTE);
      case "at84Cb":
        return flag(player, MAKE_CURE_ATTRIBUTE) && flag(player, TRANSFORMED_ATTRIBUTE);
      case "9HAA4w":
        return flag(player, MAKE_CURE_ATTRIBUTE) && !flag(player, TRANSFORMED_ATTRIBUTE);
      case "VNrY6X":
        return has(player, OGRE_GATE_KEY) && !flag(player, DOOR_LEAVING_ATTRIBUTE);
      case "ugvauV":
        return !has(player, OGRE_GATE_KEY) && !flag(player, DOOR_LEAVING_ATTRIBUTE);
      case "_u1zNb":
        return flag(player, DOOR_LEAVING_ATTRIBUTE);
      // Uglug Nar's refusal before the cure is known (capture ticks 765-771, at stage 3; post-quest
      // he buys, tick 3194). Ours: the cure counts as known from Sithik's answer (stage 8) on.
      case "2cRVYa":
        return quest.getStage(player) < STAGE_PERMANENT_SPELL;
      // The stand hands over another artefact only while none is held, banked or left on the floor:
      // Slash Bash drops it (capture tick 2650), so it can still lie there unclaimed.
      case "qO0PC_":
        return artefactOwned(player);
      case "1KSrVG":
        return !artefactOwned(player);
      default:
        return null;
    }
  }

  function answerCondition({ player, npcId, text, stepId }) {
    if (!SITHIK_NPC_IDS.has(npcId) && ![BARRICADE_GUARD_NPC_ID, GRISH_NPC_ID, ZOMBIE_NPC_ID, UGLUG_NAR_NPC_ID, ZAVISTIC_RARVE_NPC_ID].includes(npcId)) return null;
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
    if (value.includes("has the ogre artefact")) return has(player, OGRE_ARTEFACT);
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
      case "uKFksI":
      case "7KzANk":
        setFlag(player, MAKE_BRUTAL_ATTRIBUTE);
        break;
      case "ZT09es":
      case "at84Cb":
      case "9HAA4w":
        setFlag(player, MAKE_CURE_ATTRIBUTE);
        break;
      default:
        return;
    }
    if (flag(player, TRANSFORMED_ATTRIBUTE) && quest.getStage(player) < STAGE_PERMANENT_SPELL) {
      quest.setStage(player, STAGE_PERMANENT_SPELL);
    }
  }

  function handleMessageStep(player, stepId, event) {
    switch (stepId) {
      // Only showing both clues sends the player to Sithik (Wiki Transcript:Zogre_Flesh_Eaters); the prism alone
      // (CEI1zE) or the page alone (WX1Eih) ends with "...going back to search a bit more" and sets nothing.
      case "thEwXi":
        setProgress(player, 4);
        return;
      case "EHO98y":
        if (event?.box) event.box.pauseTicks = 1;
        return;
      case "tFIOsZ":
        setFlag(player, NECRO_SHOWN_ATTRIBUTE);
        return;
      case "QZF9jm":
        setFlag(player, HAM_SHOWN_ATTRIBUTE);
        return;
      case "m5Yh81":
      case "piuCKA":
      case "jrf_wW":
        setFlag(player, TANKARD_SHOWN_ATTRIBUTE);
        return;
      case "OG1g5U":
      case "ukw5TP":
        setFlag(player, INNKEEPER_MUG_ATTRIBUTE);
        return;
      case "FoOT6Z":
        setFlag(player, INNKEEPER_PORTRAIT_ATTRIBUTE);
        return;
      case "aItbm4":
        setFlag(player, MAKE_BOW_ATTRIBUTE);
        return;
      case "5liwsa":
        setFlag(player, PORTRAIT_SHOWN_ATTRIBUTE);
        return;
      case "luhaXl":
        setFlag(player, DECLINED_ATTRIBUTE, false);
        if (quest.getStage(player) < STAGE_STARTED) {
          quest.setStage(player, STAGE_STARTED);
          // Transcript:Zogre_Flesh_Eaters: "Goes to ground with full inventory".
          player.getInventory().forceAdd(player, new Item(COOKED_CHOMPY, 3));
          player.getInventory().forceAdd(player, new Item(SUPER_RESTORE_3, 2));
        }
        return;
      case "uZirGH":
        if (!has(player, OGRE_GATE_KEY)) give(player, OGRE_GATE_KEY);
        if (quest.getStage(player) < STAGE_GIVEN_KEY) quest.setStage(player, STAGE_GIVEN_KEY);
        return;
      case "_QKSlE":
        if (!has(player, STRANGE_POTION)) give(player, STRANGE_POTION);
        return;
      case "VDahRD":
        // Take the evidence first, then give the potion: the handed-in items free slots, so a full bag still takes the potion
        // (give before take refused it with "You couldn't hold all those items."; same take-then-give order as 625-626).
        takeAll(player, DRAGON_INN_TANKARD);
        takeAll(player, NECROMANCY_BOOK);
        takeAll(player, BOOK_OF_H_A_M);
        takeAll(player, SIGNED_PORTRAIT);
        if (!has(player, STRANGE_POTION)) give(player, STRANGE_POTION);
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
        // The sketch: the wiki fail/succeed conditions sit directly after this message,
        // so the runtime swallows them with the earlier condition run; do the roll here.
        if (has(player, PAPYRUS)) take(player, PAPYRUS);
        if (!has(player, SITHIK_PORTRAIT) && !has(player, SITHIK_PORTRAIT_BAD) && !has(player, SIGNED_PORTRAIT)) {
          if (Math.random() < 0.5) give(player, SITHIK_PORTRAIT);
          else give(player, SITHIK_PORTRAIT_BAD);
        }
        player.sendMessage("You get a portrait of Sithik.");
        return;
      case "3b2CAk":
      case "-7JGGv":
      case "yHgbza":
        // The drawers/wardrobe hold papyrus and charcoal; top up whichever is missing.
        if (!has(player, PAPYRUS)) give(player, PAPYRUS);
        if (!has(player, CHARCOAL)) give(player, CHARCOAL);
        return;
      case "-5TCGA":
        if (!has(player, BOOK_OF_PORTRAITURE)) give(player, BOOK_OF_PORTRAITURE);
        player.setAttribute(ATTRIBUTES.PORTRAITURE_FOUND, true);
        return;
      case "UZ09e5":
        if (!has(player, BOOK_OF_H_A_M)) give(player, BOOK_OF_H_A_M);
        player.setAttribute(ATTRIBUTES.HAM_FOUND, true);
        return;
      case "3joCI-":
        if (!has(player, NECROMANCY_BOOK)) give(player, NECROMANCY_BOOK);
        player.setAttribute(ATTRIBUTES.NECRO_FOUND, true);
        return;
      case "VIcEvT":
        if (event?.box) event.box.delayTicks = 2;
        if (!has(player, TORN_PAGE)) give(player, TORN_PAGE);
        player.setAttribute(ATTRIBUTES.PAGE_FOUND, true);
        return;
      // The coffin's first search counts once its second box shows (capture tick 547).
      case "2jEw3h":
        setProgress(player, 1);
        return;
      // The prism sold to Zavistic (tick 1760).
      case "AsiW7f":
        if (has(player, BLACK_PRISM) && !flag(player, ATTRIBUTES.PRISM_SOLD)) {
          take(player, BLACK_PRISM);
          give(player, COINS, PRISM_PRICE);
          setFlag(player, ATTRIBUTES.PRISM_SOLD);
        }
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
          const balm = balmUsed.get(player) ?? BALM_ITEM_IDS.find((itemId) => has(player, itemId));
          if (balm === undefined || !has(player, balm)) return;
          take(player, balm);
          give(player, COINS, BALM_PRICES.get(balm));
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
      if (jiggig.roomMessage(event)) return;
      boxes.applyBox(event, balmUsed.get(player));
      handleMessageStep(player, stepId, event);
      return;
    }
    switch (stepId) {
      case jiggig.CRUSH_STEP_ID:
        jiggig.crush(event);
        return;
      case "yn-UXu":
        // The artefact and the key go as Grish takes the artefacts (tick 2812).
        if (quest.getStage(player) >= STAGE_KILLED_SLASH_BASH && has(player, OGRE_ARTEFACT)) {
          take(player, OGRE_ARTEFACT);
          takeAll(player, OGRE_GATE_KEY);
          quest.complete(player);
          event.handled = true;
          event.end = true;
        }
        return;
      case "1NqRbI":
        tomb.spawnSlashBash(player);
        event.handled = true;
        return;
      case "fBKMF2":
        // "A cutscene begins.": the scene's camera starts with its box (Jiggig.roomMessage).
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
    } else if (option === "open" && itemId === RUINED_BACKPACK) {
      take(player, RUINED_BACKPACK);
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-open-ruined-backpack");
      event.handled = true;
      return;
    }
    if (!variant) return;
    startTranscript(api, player, GRISH_NPC_ID, PAGE, variant);
    event.handled = true;
  }

  function itemOnNpcVariant(npcId, itemId, player) {
    if (npcId === ZAVISTIC_RARVE_NPC_ID) {
      if (quest.getStage(player) < STAGE_STARTED) return null;
      if (itemId === BLACK_PRISM) {
        // Once Sithik has had the potion Zavistic buys the prism (capture ticks 1750-1760).
        return quest.getStage(player) >= STAGE_POTION && !flag(player, ATTRIBUTES.PRISM_SOLD)
          ? "investigating-b-vahn-use-the-black-prism-on-zavistic-rarve-after-giving-sithik-the-potion"
          : "investigating-b-vahn-use-the-black-prism-on-zavistic-rarve-after-he-has-already-it";
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
      balmUsed.set(player, itemId);
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
    const select =
      npcId === ZAVISTIC_RARVE_NPC_ID && variant === EVIDENCE_HAND_IN_VARIANT
        ? zavisticEvidenceSelect(event.player)
        : undefined;
    event.handled = true;
    startTranscript(api, event.player, npcId, page, variant, select);
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
    // human_pickuptable and drip_poison as the potion goes in (capture tick 1537).
    player.performAnimation(new api.core.Animation(POUR_SEQ));
    player.getPacketSender().sendSound(POUR_SOUND, 1, 0);
    setFlag(player, POTION_USED_ATTRIBUTE);
    if (quest.getStage(player) < STAGE_POTION) quest.setStage(player, STAGE_POTION);
    startTranscript(api, player, SITHIK_NPC_ID, PAGE, "investigating-b-vahn-using-strange-potion-on-cup-of-tea");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId === tomb.NORTH_WEST_COFFIN_ID && itemId === KNIFE) {
      event.handled = true;
      tomb.knifeOnCoffin(player);
      return;
    }
    if (SITHIK_BED_IDS.has(objectId) && itemId === PAPYRUS) {
      event.handled = true;
      startTranscript(api, player, sithikSpeakerId(player), PAGE, "investigating-b-vahn-use-papyrus-on-sithik-ints");
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

  /**
   * The Wiki: "Go down the ladder and back up to Sithik, and you will find that he has turned into
   * an ogre." The capture sets 495 the tick after the player is down (ticks 1557-1558).
   */
  function climbDownFromSithik(request) {
    const { player, objectId } = request;
    const location = request.object?.getLocation?.();
    if (objectId !== SITHIK_LADDER.id || !player || !location) return;
    if (location.getX() !== SITHIK_LADDER.x || location.getY() !== SITHIK_LADDER.y || location.getZ() !== SITHIK_LADDER.z) return;
    if (!flag(player, POTION_USED_ATTRIBUTE) || flag(player, TRANSFORMED_ATTRIBUTE)) return;
    const { CountdownTask, TaskManager } = api.core;
    let ticks = 0;
    const wait = () => {
      if (!player.isRegistered?.()) return;
      if (player.getLocation().getZ() !== SITHIK_LADDER.z) {
        TaskManager.submit(new CountdownTask(player, 1, () => setFlag(player, TRANSFORMED_ATTRIBUTE)));
        return;
      }
      if (++ticks < 10) TaskManager.submit(new CountdownTask(player, 1, wait));
    };
    TaskManager.submit(new CountdownTask(player, 1, wait));
  }

  // ==========================================================================
  // Zavistic's evidence hand-in
  //
  // The wiki transcript checks each held item with a sibling condition, but the
  // dialogue runtime plays only the first true condition of such a run. Rewrite
  // the "I have some items" option before it plays: keep each item's branch
  // (separated so they all run) and inline whichever ending fits the inventory.
  // ==========================================================================

  const EVIDENCE_HAND_IN_VARIANT = "investigating-b-vahn-talking-to-zavistic-rarve-after-gathering-evidence";

  function holdsAllEvidence(player) {
    return (
      has(player, NECROMANCY_BOOK) &&
      has(player, BOOK_OF_H_A_M) &&
      has(player, DRAGON_INN_TANKARD) &&
      has(player, SIGNED_PORTRAIT)
    );
  }

  function zavisticEvidenceSelect(player) {
    const all = holdsAllEvidence(player);
    const rewrite = (steps) =>
      steps.map((step) => {
        if (!step || typeof step !== "object") return step;
        const copy = { ...step };
        if (Array.isArray(copy.options)) {
          copy.options = copy.options.map((option) =>
            option.id === "wsqayT"
              ? { ...option, steps: rewriteEvidenceOption(option.steps || [], all) }
              : { ...option, steps: rewrite(option.steps || []) }
          );
        } else if (Array.isArray(copy.steps)) {
          copy.steps = rewrite(copy.steps);
        }
        return copy;
      });
    return rewrite;
  }

  function rewriteEvidenceOption(steps, all) {
    const out = [];
    for (const step of steps) {
      if (!step || typeof step !== "object") {
        out.push(step);
        continue;
      }
      if (step.id === "uE6dyG") {
        if (!all) out.push(...(step.steps || []));
        continue;
      }
      if (step.id === "oBTnmc") {
        if (all) out.push(...(step.steps || []));
        continue;
      }
      if (step.type === "condition" && out.length > 0 && out[out.length - 1]?.type === "condition") {
        out.push({ type: "action", id: "zogre:evidence-separator" });
      }
      out.push(step);
    }
    return out;
  }

  const INSIDE_THE_GUILD_VARIANT = "investigating-b-vahn-talking-to-zavistic-rarve-inside-the-guild";
  const BELL_VARIANT = "investigating-b-vahn-ringing-the-bell-outside-the-wizards-guild";
  const CONTINUES_BELL_TEXT = "Continues above from \"There's some undead ogre activity";

  /**
   * The inside-the-guild transcript ends its two quest branches with "Continues above from 'There's some undead ogre activity...'"
   * actions. That body is the bell transcript from its first condition step on (the prism, page and tankard branches), so each such
   * action is replaced by it, recursively, from the same npc-dialogues.json the transcripts are read from. The tail is located by its
   * first condition step, not by a fixed index. Returns null when that tail is missing or empty.
   */
  function bellTail(api) {
    const bell = loadTranscripts(api)?.[PAGE]?.variants?.[BELL_VARIANT];
    if (!Array.isArray(bell)) return null;
    const start = bell.findIndex((step) => step?.type === "condition");
    const tail = start < 0 ? [] : bell.slice(start);
    return tail.length > 0 ? tail : null;
  }

  function spliceBellTail(tail) {
    const splice = (steps) => {
      const out = [];
      for (const step of steps) {
        if (step && typeof step === "object" && step.type === "action" && String(step.text ?? "").startsWith(CONTINUES_BELL_TEXT)) {
          out.push(...tail);
          continue;
        }
        if (!step || typeof step !== "object") {
          out.push(step);
          continue;
        }
        const copy = { ...step };
        if (Array.isArray(copy.options)) copy.options = copy.options.map((option) => ({ ...option, steps: splice(option.steps || []) }));
        if (Array.isArray(copy.steps)) copy.steps = splice(copy.steps);
        out.push(copy);
      }
      return out;
    };
    return splice;
  }

  /** Talk-to Zavistic override: play the rewritten evidence hand-in before the potion. */
  function talkToZavistic(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_SITHIK) return false;
    if (progress(player) < 4) {
      // Investigating with the evidence not yet shown: the retail guild conversation, not the Hand-in-the-Sand line.
      // No bell tail means the splice would leave dangling actions, so the unmodified behaviour is kept instead.
      const tail = bellTail(api);
      if (!tail) return false;
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: event.npc,
        npcId: event.npcId,
        variant: INSIDE_THE_GUILD_VARIANT,
        select: spliceBellTail(tail),
      });
      return true;
    }
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npc: event.npc,
      npcId: event.npcId,
      variant: EVIDENCE_HAND_IN_VARIANT,
      select: zavisticEvidenceSelect(player),
    });
    return true;
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
      startTranscript(api, player, sithikSpeakerId(player), PAGE, "investigating-b-vahn-searching-the-drawers-wardrobe-or-cupboard-after-convincing-zavistic-rarve");
      return;
    }
    startTranscript(api, player, sithikSpeakerId(player), PAGE, searchVariant);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    const op = objectOp(event);

    if (jiggig.useStairs(event)) return;
    if (tomb.objectInteraction(event, op)) return;

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
      // human_pickupfloor with "You search the broken down lectern.", the page's box two ticks on (ticks 521-523).
      player.performAnimation(new api.core.Animation(LECTERN_SEARCH_SEQ));
      startTranscript(api, player, GRISH_NPC_ID, PAGE, "entering-jiggig-search-broken-lecturn");
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
      // The bell swings and Zavistic comes out to it before he speaks (WizardsGuildBell).
      bell.ring(player, event.object, (zavistic) =>
        startTranscript(api, player, ZAVISTIC_RARVE_NPC_ID, PAGE, "investigating-b-vahn-ringing-the-bell-outside-the-wizards-guild", undefined, zavistic));
      return;
    }

    if (SITHIK_BED_IDS.has(objectId)) {
      if (op !== "talk-to") return;
      event.handled = true;
      const variant = sithikVariant(player);
      if (variant) {
        startTranscript(api, player, sithikSpeakerId(player), PAGE, variant);
      } else if (quest.getStage(player) >= STAGE_COMPLETE) {
        startTranscript(api, player, sithikSpeakerId(player), "Sithik Ints", "standard-dialogue-after-completion-of-zogre-flesh-eaters");
      } else {
        startTranscript(api, player, sithikSpeakerId(player), "Sithik Ints", "standard-dialogue-before-starting-zogre-flesh-eaters");
      }
    }
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  for (const attribute of PERSISTED_ATTRIBUTES) api.persistAttribute(attribute);
  for (const attribute of Object.values(ATTRIBUTES)) api.persistAttribute(attribute, false);

  function handleLogin({ player }) {
    tomb.forget(player);
    syncAuxiliaryState(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    tomb.forget(player);
    jiggig.endRoomScene(player);
  }

  function handleStageChanged({ player, key }) {
    if (key === "zogre_flesh_eaters") syncAuxiliaryState(player);
  }

  quest = registerQuest(api, {
    key: "zogre_flesh_eaters",
    name: "Zogre Flesh Eaters",
    varbitId: VARBIT_ZOGRE_FLESH_EATERS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    // The scroll's lines and model as the capture shows them (tick 2815); Slash Bash's own drop
    // table leaves the 3 ourg and 2 zogre bones the Wiki lists, so the quest gives no items itself.
    xpRewards: [
      { skillId: Skill.RANGED.getIndex(), amount: 2000, label: "Ranged" },
      { skillId: Skill.FLETCHING.getIndex(), amount: 2000, label: "Fletching" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 2000, label: "Herblore" },
    ],
    scrollItemId: OGRE_ARTEFACT,
    otherRewards: ["Ability to make Relicym's Balm", "Ability to make Brutal Arrows"],
    buildJournal: journal.buildJournal,
    onReward: grantReward,
  });

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.RANGED, 2000);
    skills.addExperiences(Skill.FLETCHING, 2000);
    skills.addExperiences(Skill.HERBLORE, 2000);
  }

  jiggig.register();
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Zavistic Rarve", { "Talk-to": talkToZavistic });
  api.onNpcDialogueCondition(answerCondition);
  api.persistAttribute(TANKARD_SHOWN_ATTRIBUTE, false);
  api.persistAttribute(INNKEEPER_MUG_ATTRIBUTE, false);
  api.persistAttribute(INNKEEPER_PORTRAIT_ATTRIBUTE, false);
  api.persistAttribute(MAKE_BOW_ATTRIBUTE, false);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("ladders:climb", climbDownFromSithik);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("herblore:unlocked", answerHerbloreUnlock);
  api.onCustomEvent("fletching:taught", answerFletchingTaught);
  api.onItemAction(handleItemAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnGroundItem(handleItemOnGroundItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(tomb.handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
