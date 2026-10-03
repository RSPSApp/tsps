/**
 * Goblin Diplomacy.
 *
 * Words come from data/definitions/npc-dialogues.json:
 *   generals, not started -> "Goblin Diplomacy" / "starting-off-talking-to-general-wartface-or-general-bentnoze"
 *   generals, orange due  -> "Goblin Diplomacy" / "showing-the-generals-different-goblin-armours-orange-painted-goblin-armour"
 *   generals, blue due    -> "Goblin Diplomacy" / "showing-the-generals-different-goblin-armours-blue-painted-goblin-armour"
 *   generals, brown due   -> "Goblin Diplomacy" / "showing-the-generals-different-goblin-armours-brown-painted-goblin-armour"
 *   generals, done        -> "Goblin Diplomacy" / "starting-off-talking-to-the-generals-again"
 *   grubfoot, by stage    -> "Goblin Diplomacy" / "starting-off-talking-to-grubfoot", the orange/blue
 *                            "...-talking-to-grubfoot" variants, or "Grubfoot" /
 *                            "standard-dialogue-after-goblin-diplomacy"
 *
 * The plugin supplies the variant selector, the condition answers, the start hook,
 * the item hand-ins and the simple item/object interactions (dyes, mail crates).
 */
module.exports = function registerGoblinDiplomacyQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const GENERAL_BENTNOZE_NPC_ID = NpcIdentifiers.GENERAL_BENTNOZE;
  const GENERAL_WARTFACE_NPC_ID = NpcIdentifiers.GENERAL_WARTFACE;
  const GRUBFOOT_NPC_IDS = [NpcIdentifiers.GRUBFOOT, NpcIdentifiers.GRUBFOOT_2, NpcIdentifiers.GRUBFOOT_3];

  const VARP_GOBLIN_DIPLOMACY = 2378;
  const STAGE_STARTED = 1;
  const STAGE_ORANGE_REJECTED = 3;
  const STAGE_BLUE_REJECTED = 4;
  const STAGE_BROWN_ACCEPTED = 5;
  const STAGE_COMPLETE = 6;

  const ORANGE_GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.ORANGE_GOBLIN_MAIL;
  const BLUE_GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.BLUE_GOBLIN_MAIL;
  const GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.GOBLIN_MAIL;
  const BLUE_DYE_ITEM_ID = ItemIdentifiers.BLUE_DYE;
  const ORANGE_DYE_ITEM_ID = ItemIdentifiers.ORANGE_DYE;
  const GOLD_BAR_ITEM_ID = ItemIdentifiers.GOLD_BAR;

  const GOBLIN_MAIL_CRATE_LOC_IDS = new Set([
    ObjectIdentifiers.CRATE_139,
    ObjectIdentifiers.CRATE_140,
    ObjectIdentifiers.CRATE_141,
  ]);

  const GENERAL_IDS = new Set([GENERAL_BENTNOZE_NPC_ID, GENERAL_WARTFACE_NPC_ID]);
  const QUEST_NPC_IDS = new Set([
    GENERAL_BENTNOZE_NPC_ID,
    GENERAL_WARTFACE_NPC_ID,
    ...GRUBFOOT_NPC_IDS,
  ]);

  /** "message" step that ends the brown hand-in cutscene. */
  const COMPLETE_MESSAGE_STEP_ID = "QqWnqy";

  /** Condition step ids of the orange/blue "showing the generals ... armour" transcripts. */
  const ORANGE_HAND_IN_STEP_ID = "mZ3adF";
  const BLUE_HAND_IN_STEP_ID = "bypXXZ";

  /** Custom-event slug carried by "Yes." on "Start the Goblin Diplomacy quest?". */
  const START_HOOK = "quest:goblin-diplomacy:start";

  const PAGE_GOBLIN_DIPLOMACY = "Goblin Diplomacy";
  const PAGE_GRUBFOOT = "Grubfoot";

  const VARIANT_START_GENERALS = "starting-off-talking-to-general-wartface-or-general-bentnoze";
  const VARIANT_ORANGE_GENERALS = "showing-the-generals-different-goblin-armours-orange-painted-goblin-armour";
  const VARIANT_BLUE_GENERALS = "showing-the-generals-different-goblin-armours-blue-painted-goblin-armour";
  const VARIANT_BROWN_GENERALS = "showing-the-generals-different-goblin-armours-brown-painted-goblin-armour";
  const VARIANT_DONE_GENERALS = "starting-off-talking-to-the-generals-again";
  const VARIANT_GRUBFOOT_STANDARD = "standard-dialogue-after-goblin-diplomacy";
  const VARIANT_BLUE_GRUBFOOT = "showing-the-generals-different-goblin-armours-blue-painted-goblin-armour-talking-to-grubfoot";
  const VARIANT_ORANGE_GRUBFOOT = "showing-the-generals-different-goblin-armours-orange-painted-goblin-armour-talking-to-grubfoot";
  const VARIANT_START_GRUBFOOT = "starting-off-talking-to-grubfoot";

  const CONDITION_NON_ORANGE = "non-orange";
  const CONDITION_NON_BLUE = "non-blue";
  const CONDITION_ORANGE_PAINTED = "orange-painted";
  const CONDITION_BLUE_PAINTED = "blue-painted";
  const CONDITION_ORANGE_DYE_ON_MAIL = "orange dye on the goblin mail";
  const CONDITION_BLUE_DYE_ON_MAIL = "blue dye on the goblin mail";
  const CONDITION_PAINTED_ARMOUR = "a painted goblin armour";
  const CONDITION_REGULAR_ARMOUR = "uses regular goblin armour";

  const page = (variant) => ({ page: PAGE_GOBLIN_DIPLOMACY, variant });

  let quest;

  function countMail(player) {
    const inventory = player.getInventory();
    return (
      inventory.getAmount(GOBLIN_MAIL_ITEM_ID) +
      inventory.getAmount(ORANGE_GOBLIN_MAIL_ITEM_ID) +
      inventory.getAmount(BLUE_GOBLIN_MAIL_ITEM_ID)
    );
  }

  function has(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped the Goblin Generals choose brown armour.</str>",
        "<str>The goblins have stopped arguing about colours.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BLUE_REJECTED) {
      return [
        "<str>The generals rejected orange and blue armour.</str>",
        "They now want to try the original <col=800000>brown goblin mail</col>.",
      ];
    }
    if (stage >= STAGE_ORANGE_REJECTED) {
      return [
        "<str>The generals rejected orange armour.</str>",
        "They now want a suit of <col=800000>blue goblin mail</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The Goblin Generals want a suit of",
        "<col=800000>orange goblin mail</col> to test on Grubfoot.",
        "Goblin mail can be found in crates around the village.",
        "<col=800000>Aggie</col> in Draynor Village knows about dyes.",
      ];
    }
    return [
      "I can start this quest by speaking to either",
      "<col=800000>Goblin General</col> in the hut at",
      "<col=800000>Goblin Village</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 200);
  }

  // Which transcript variant the clicked NPC plays, by quest stage.
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GENERAL_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) {
        return page(VARIANT_START_GENERALS);
      }
      if (stage === STAGE_STARTED) {
        return page(VARIANT_ORANGE_GENERALS);
      }
      if (stage === STAGE_ORANGE_REJECTED) {
        return page(VARIANT_BLUE_GENERALS);
      }
      if (stage === STAGE_BLUE_REJECTED) {
        return page(VARIANT_BROWN_GENERALS);
      }
      return page(VARIANT_DONE_GENERALS);
    }
    if (GRUBFOOT_NPC_IDS.includes(npcId)) {
      if (stage >= STAGE_BROWN_ACCEPTED) {
        return { page: PAGE_GRUBFOOT, variant: VARIANT_GRUBFOOT_STANDARD };
      }
      if (stage === STAGE_BLUE_REJECTED) {
        return page(VARIANT_BLUE_GRUBFOOT);
      }
      if (stage === STAGE_ORANGE_REJECTED) {
        return page(VARIANT_ORANGE_GRUBFOOT);
      }
      return page(VARIANT_START_GRUBFOOT);
    }
    return null;
  }

  // Answer the "showing the generals ... armour" prose conditions from carried mail.
  function answerCondition({ npcId, player, text }) {
    if (!GENERAL_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    const orange = has(player, ORANGE_GOBLIN_MAIL_ITEM_ID);
    const blue = has(player, BLUE_GOBLIN_MAIL_ITEM_ID);
    if (value.includes(CONDITION_NON_ORANGE)) return !orange;
    if (value.includes(CONDITION_NON_BLUE)) return !blue;
    if (value.includes(CONDITION_ORANGE_PAINTED)) return orange;
    if (value.includes(CONDITION_BLUE_PAINTED)) return blue;
    if (value.includes(CONDITION_ORANGE_DYE_ON_MAIL)) return false;
    if (value.includes(CONDITION_BLUE_DYE_ON_MAIL)) return false;
    if (value.includes(CONDITION_PAINTED_ARMOUR)) return orange || blue;
    if (value.includes(CONDITION_REGULAR_ARMOUR)) return has(player, GOBLIN_MAIL_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GENERAL_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  // The dump's hand-in branches advance the stage once their condition is chosen.
  function handleConditionStep({ player, npcId, stepId }) {
    if (!GENERAL_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stepId === ORANGE_HAND_IN_STEP_ID && stage === STAGE_STARTED && has(player, ORANGE_GOBLIN_MAIL_ITEM_ID)) {
      player.getInventory().deleteNumber(ORANGE_GOBLIN_MAIL_ITEM_ID, 1);
      quest.setStage(player, STAGE_ORANGE_REJECTED);
    } else if (stepId === BLUE_HAND_IN_STEP_ID && stage === STAGE_ORANGE_REJECTED && has(player, BLUE_GOBLIN_MAIL_ITEM_ID)) {
      player.getInventory().deleteNumber(BLUE_GOBLIN_MAIL_ITEM_ID, 1);
      quest.setStage(player, STAGE_BLUE_REJECTED);
    }
  }

  // Multi-NPC transcripts only voice the NPC you clicked; every other `line`
  // step (and slugless cutscene `action`) would otherwise abort the transcript
  // with "That conversation isn't available right now." Skipping them lets the
  // generals' shared transcript and the hand-in cutscenes keep playing.
  // ponytail: workaround for speaker-scoped lines; remove when the runtime
  // renders `speaker` steps itself.
  function handleDialogueAction(event) {
    if (!QUEST_NPC_IDS.has(event.npcId)) return;
    const step = event.step;
    if (!step) return;

    if (step.type === "line") {
      event.handled = true;
      event.end = false;
      return;
    }

    if (step.type === "message" && event.stepId === COMPLETE_MESSAGE_STEP_ID) {
      if (quest.getStage(event.player) >= STAGE_BLUE_REJECTED && has(event.player, GOBLIN_MAIL_ITEM_ID)) {
        event.player.getInventory().deleteNumber(GOBLIN_MAIL_ITEM_ID, 1);
        quest.complete(event.player);
      }
      event.handled = true;
      event.end = true;
      return;
    }

    // Prose stage directions ("A cutscene begins...") have no executable
    // contract; keep the branch going instead of ending the conversation.
    if (step.type === "action" && step.action === undefined) {
      event.handled = true;
      event.end = false;
    }
  }

  // Using a goblin mail on a general is the hand-in; wrong colours are refused.
  function handleItemOnNpc(event) {
    const npcId = event.target?.getId?.();
    if (!GENERAL_IDS.has(npcId)) return;
    const stage = quest.getStage(event.player);
    const itemId = event.itemId;
    if (itemId === ORANGE_GOBLIN_MAIL_ITEM_ID && stage === STAGE_STARTED) {
      event.player.getInventory().deleteNumber(itemId, 1);
      event.player.sendMessage("You hand over the orange goblin mail.");
      quest.setStage(event.player, STAGE_ORANGE_REJECTED);
    } else if (itemId === BLUE_GOBLIN_MAIL_ITEM_ID && stage === STAGE_ORANGE_REJECTED) {
      event.player.getInventory().deleteNumber(itemId, 1);
      event.player.sendMessage("You hand over the blue goblin mail.");
      quest.setStage(event.player, STAGE_BLUE_REJECTED);
    } else if (itemId === GOBLIN_MAIL_ITEM_ID && stage === STAGE_BLUE_REJECTED) {
      event.player.getInventory().deleteNumber(itemId, 1);
      quest.complete(event.player);
    } else if (
      itemId === ORANGE_GOBLIN_MAIL_ITEM_ID ||
      itemId === BLUE_GOBLIN_MAIL_ITEM_ID ||
      itemId === GOBLIN_MAIL_ITEM_ID
    ) {
      event.player.sendMessage("The generals don't want that colour right now.");
    } else {
      return;
    }
    event.handled = true;
  }

  // Dye an ordinary goblin mail orange or blue.
  function handleItemOnItem(event) {
    const used = event.usedItemId;
    const with_ = event.usedWithItemId;
    const pairsWith = (dyeId) =>
      (used === dyeId && with_ === GOBLIN_MAIL_ITEM_ID) ||
      (used === GOBLIN_MAIL_ITEM_ID && with_ === dyeId);
    let dyeId;
    let result;
    if (pairsWith(ORANGE_DYE_ITEM_ID)) {
      dyeId = ORANGE_DYE_ITEM_ID;
      result = ORANGE_GOBLIN_MAIL_ITEM_ID;
    } else if (pairsWith(BLUE_DYE_ITEM_ID)) {
      dyeId = BLUE_DYE_ITEM_ID;
      result = BLUE_GOBLIN_MAIL_ITEM_ID;
    } else {
      return;
    }
    const inventory = event.player.getInventory();
    inventory.deleteNumber(dyeId, 1);
    inventory.deleteNumber(GOBLIN_MAIL_ITEM_ID, 1);
    inventory.adds(result, 1);
    event.player.sendMessage("You dye the goblin mail.");
    event.handled = true;
  }

  // Search the village crates for spare goblin mail.
  function handleObjectInteraction(event) {
    if (!GOBLIN_MAIL_CRATE_LOC_IDS.has(event.objectId)) return;
    const action = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (action !== "search") return;
    event.handled = true;

    const stage = quest.getStage(event.player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) {
      event.player.sendMessage("The crate contains nothing useful.");
      return;
    }
    if (countMail(event.player) >= 3) {
      event.player.sendMessage("You already have enough goblin mail for the colour tests.");
      return;
    }
    if (event.player.getInventory().isFull()) {
      event.player.sendMessage("You need a free inventory slot.");
      return;
    }
    event.player.getInventory().adds(GOBLIN_MAIL_ITEM_ID, 1);
    event.player.sendMessage("You find a goblin mail in the crate.");
  }

  function refreshQuestsOnLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "goblin_diplomacy",
    name: "Goblin Diplomacy",
    varpId: VARP_GOBLIN_DIPLOMACY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 5,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 200, label: "Crafting" }],
    rewardItemId: GOLD_BAR_ITEM_ID,
    rewardItemLabel: "A Gold bar",
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(refreshQuestsOnLogin);
};
