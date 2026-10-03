/**
 * Imp Catcher.
 *
 * The words come from the osrsreboxed transcript data (npc-dialogues.json):
 *   stage 0            -> "Imp Catcher" / "starting-out-talking-to-wizard-mizgog"
 *   stage 1, no beads  -> "Imp Catcher" / "finding-the-beads-speaking-to-wizard-mizgog-with-no-beads"
 *   stage 1, some      -> "Imp Catcher" / "finding-the-beads-speaking-to-wizard-mizgog-with-some-beads"
 *   stage 1, all four  -> "Imp Catcher" / "finishing-up-giving-the-beads-to-wizard-mizgog"
 *   complete           -> "Wizard Mizgog" / "after-imp-catcher"
 *
 * This plugin supplies only the branching: which variant to play, how to answer
 * the wiki's prose conditions, and the game actions (start, hand in the beads,
 * trade a spare set for another amulet). The beads themselves are on the imp
 * drop table (npc-drops.json "imp"), so no loot hook is needed.
 */
module.exports = function registerImpCatcherQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  // Wizard Mizgog spawns as transformed NPC 5005 (-> 7746/7747); handle all forms.
  // 5005 has no NpcIdentifiers member, so it stays a local constant.
  const MIZGOG_TRANSFORMED_NPC_ID = 5005; // no enum member
  const MIZGOG_NPC_IDS = new Set([
    MIZGOG_TRANSFORMED_NPC_ID,
    NpcIdentifiers.WIZARD_MIZGOG,
    NpcIdentifiers.WIZARD_MIZGOG_2,
  ]);

  const VARP_IMP_CATCHER = 160;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const REQUIRED_ITEMS = [
    { itemId: ItemIdentifiers.BLACK_BEAD, label: "1 Black bead" },
    { itemId: ItemIdentifiers.RED_BEAD, label: "1 Red bead" },
    { itemId: ItemIdentifiers.WHITE_BEAD, label: "1 White bead" },
    { itemId: ItemIdentifiers.YELLOW_BEAD, label: "1 Yellow bead" },
  ];

  /** Hand-in actions: "finishing up" and the start-with-all-beads branch. */
  const HAND_IN_ACTION_IDS = new Set(["k5b4d5", "_JySdu"]);

  /** Post-quest "I have them with me!" trade: another amulet for another bead set. */
  const SPARE_AMULET_MESSAGE_ID = "jxPdQz";

  /** "Yes." on "Start the Imp Catcher quest?" carries this slug. */
  const START_HOOK = "quest:imp-catcher:start";

  const PAGE_IMP_CATCHER = "Imp Catcher";
  const PAGE_WIZARD_MIZGOG = "Wizard Mizgog";
  const VARIANT_START = "starting-out-talking-to-wizard-mizgog";
  const VARIANT_NO_BEADS = "finding-the-beads-speaking-to-wizard-mizgog-with-no-beads";
  const VARIANT_SOME_BEADS = "finding-the-beads-speaking-to-wizard-mizgog-with-some-beads";
  const VARIANT_HAND_IN = "finishing-up-giving-the-beads-to-wizard-mizgog";
  const VARIANT_AFTER = "after-imp-catcher";

  // Prose condition substrings (negative checks first: the "does not have all
  // four beads" prose contains "has all four beads").
  const CONDITION_NOT_ALL_BEADS = "does not have all four beads";
  const CONDITION_ALREADY_ALL_BEADS = "already has all four beads";
  const CONDITION_WITHOUT_ALL_BEADS = "without all four beads";
  const CONDITION_ALL_BEADS = "has all four beads";

  let quest;

  const isMizgog = (npcId) => MIZGOG_NPC_IDS.has(npcId);

  function hasAllBeads(player) {
    return REQUIRED_ITEMS.every((requirement) => player.getInventory().getAmount(requirement.itemId) > 0);
  }

  function hasAnyBead(player) {
    return REQUIRED_ITEMS.some((requirement) => player.getInventory().getAmount(requirement.itemId) > 0);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I have spoken to Wizard Mizgog.</str>",
        "<str>I collected all four of his missing beads.</str>",
        "<str>He rewarded me with an Amulet of Accuracy.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "I have spoken to <col=800000>Wizard Mizgog</col>.",
        "",
        "I need to collect these items by killing imps:",
      ];
      for (const requirement of REQUIRED_ITEMS) {
        lines.push(
          player.getInventory().getAmount(requirement.itemId) > 0
            ? `<str>${requirement.label}</str>`
            : requirement.label,
        );
      }
      return lines;
    }
    return [
      "I can start this quest by talking to",
      "<col=800000>Wizard Mizgog</col> in the",
      "<col=800000>Wizards' Tower</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.MAGIC, 875);
  }

  // Which transcript variant Wizard Mizgog plays, by quest stage / carried beads.
  function selectVariant({ npcId, player }) {
    if (!isMizgog(npcId)) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: PAGE_WIZARD_MIZGOG, variant: VARIANT_AFTER };
    if (stage >= STAGE_STARTED) {
      if (hasAllBeads(player)) return { page: PAGE_IMP_CATCHER, variant: VARIANT_HAND_IN };
      return hasAnyBead(player)
        ? { page: PAGE_IMP_CATCHER, variant: VARIANT_SOME_BEADS }
        : { page: PAGE_IMP_CATCHER, variant: VARIANT_NO_BEADS };
    }
    return { page: PAGE_IMP_CATCHER, variant: VARIANT_START };
  }

  // Answer the transcript's prose conditions.
  function answerCondition({ npcId, player, text }) {
    if (!isMizgog(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes(CONDITION_NOT_ALL_BEADS)) return !hasAllBeads(player);
    if (value.includes(CONDITION_ALREADY_ALL_BEADS)) return hasAllBeads(player);
    if (value.includes(CONDITION_WITHOUT_ALL_BEADS)) return !hasAllBeads(player);
    if (value.includes(CONDITION_ALL_BEADS)) return hasAllBeads(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!isMizgog(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueAction(event) {
    if (!isMizgog(event.npcId)) return;
    // Turn in the four coloured beads.
    if (HAND_IN_ACTION_IDS.has(event.stepId)) {
      if (!hasAllBeads(event.player)) return;
      for (const requirement of REQUIRED_ITEMS) {
        event.player.getInventory().deleteNumber(requirement.itemId, 1);
      }
      event.player.sendMessage("You give four coloured beads to Wizard Mizgog.");
      quest.complete(event.player);
      event.handled = true;
      event.end = true;
      return;
    }
    // Post-quest: swap a spare set of beads for another amulet. Do not consume
    // the step so the transcript's own "Mizgog removes the beads..." line plays.
    if (event.stepId === SPARE_AMULET_MESSAGE_ID && hasAllBeads(event.player)) {
      for (const requirement of REQUIRED_ITEMS) {
        event.player.getInventory().deleteNumber(requirement.itemId, 1);
      }
      event.player.getInventory().adds(ItemIdentifiers.AMULET_OF_ACCURACY, 1);
    }
  }

  quest = registerQuest(api, {
    key: "imp_catcher",
    name: "Imp Catcher",
    varpId: VARP_IMP_CATCHER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.MAGIC.getIndex(), amount: 875, label: "Magic" }],
    rewardItemId: ItemIdentifiers.AMULET_OF_ACCURACY,
    rewardItemLabel: "An Amulet of Accuracy",
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
};
