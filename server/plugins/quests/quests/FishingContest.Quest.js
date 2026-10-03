/**
 * Fishing Contest (members).
 *
 * Words come from the "Fishing Contest" transcript page:
 *   Austri/Vestri (not indexed)  -> starting-out-speaking-to-vestri-or-austri-to-start-the-quest
 *                                   ...-before-winning / ...-retrieving-another-fishing-pass-from-vestri-or-austri
 *                                   returning-to-vestri-or-austri
 *   Bonzo   -> the-contest-... variants by stage
 *   Morris  -> entering-the-competition-talking-to-morris
 *   others  -> speaking-to-the-other-contestants-* / speaking-to-grandpa-jack
 *
 * Austri and Vestri are not in npc-dialogue-index.json, so their start/hand-in
 * transcripts are replayed from an interaction (as Priest in Peril does for the
 * monks). The plugin supplies the variant selector, the condition answers, the
 * start hook (stage + pass), the win hand-in and the completion action.
 *
 * Gaps: the competition fishing spots, garlic-in-pipe, red-vine worms, gates,
 * tunnels and Morris' gate check are object/item interactions the object runtime
 * cannot address here without reliable object ids.
 */
module.exports = function registerFishingContestQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Fishing Contest";
  const VARP_FISHING_CONTEST = 11;

  const STAGE_STARTED = 1;
  const STAGE_COMPETING = 2;
  const STAGE_GARLIC = 3;
  const STAGE_WON = 4;
  const STAGE_COMPLETE = 5;
  const FISHING_LEVEL = 10;

  const START_HOOK = "quest:fishing-contest:start";
  /** Transcript action that ends the "returning to Vestri or Austri" branch. */
  const COMPLETE_ACTION_ID = "VGuVO2";
  /** Bonzo's "you are given the trophy" message after catching the winning carp. */
  const TROPHY_MESSAGE_ID = "jUkdtL";

  const DwarfHandlerIds = new Set([NpcIdentifiers.AUSTRI, NpcIdentifiers.VESTRI]);
  const BONZO_NPC_ID = NpcIdentifiers.BONZO;
  const MORRIS_NPC_ID = NpcIdentifiers.MORRIS;

  const FISHING_PASS_ITEM_ID = ItemIdentifiers.FISHING_PASS;
  const FISHING_TROPHY_ITEM_ID = ItemIdentifiers.FISHING_TROPHY;
  const GIANT_CARP_ITEM_ID = ItemIdentifiers.GIANT_CARP;
  const SARDINE_ITEM_ID = ItemIdentifiers.SARDINE;

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const fishingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.FISHING);

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I won the Hemenster Fishing Contest.</str>",
        "<str>The dwarves let me use their tunnel.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_WON) {
      return [
        "I won the contest and should take the <col=800000>trophy</col>",
        "back to Austri or Vestri at White Wolf Mountain.",
      ];
    }
    if (stage >= STAGE_GARLIC) {
      return [
        "The sinister stranger moved away from the pipes.",
        "I should use <col=800000>red vine worms</col> at the pipe fishing spot.",
      ];
    }
    if (stage >= STAGE_COMPETING) {
      return [
        "I am competing at Hemenster.",
        "The sinister stranger still holds the spot by the pipes.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The dwarves gave me a <col=800000>Fishing pass</col>.",
        "I must win the contest at <col=800000>Hemenster</col>.",
      ];
    }
    return [
      "Speak to <col=800000>Austri or Vestri</col> beside the",
      "White Wolf Mountain tunnel.",
      "",
      "<col=ff0000>Requires level 10 Fishing.</col>",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.FISHING, 2437.5);
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === BONZO_NPC_ID) {
      if (stage < STAGE_STARTED) return page("the-contest-fishing-before-entering-the-competition");
      if (stage >= STAGE_WON) return page("the-contest-talking-to-bonzo-after-winning");
      return page("the-contest-speaking-to-bonzo-after-catching-a-fish");
    }
    if (npcId === MORRIS_NPC_ID) return page("entering-the-competition-talking-to-morris");
    if (npcId === NpcIdentifiers.SINISTER_STRANGER) {
      return page("speaking-to-the-other-contestants-sinister-stranger");
    }
    if (npcId === NpcIdentifiers.BIG_DAVE) {
      return page("speaking-to-the-other-contestants-big-dave");
    }
    if (npcId === NpcIdentifiers.JOSHUA) {
      return page("speaking-to-the-other-contestants-joshua");
    }
    if (npcId === NpcIdentifiers.GRANDPA_JACK) return page("speaking-to-grandpa-jack");
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("quest speedrunning world")) return false;
    if (value.includes("does not meet the requirements to begin fishing contest")) {
      return fishingLevel(player) < FISHING_LEVEL;
    }
    if (value.includes("garlic was placed in the pipes")) return stage >= STAGE_GARLIC;
    if (value.includes("regular fish")) return has(player, SARDINE_ITEM_ID);
    if (value.includes("giant carp")) return has(player, GIANT_CARP_ITEM_ID);
    if (value.includes("fishing trophy has been lost")) return !has(player, FISHING_TROPHY_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DwarfHandlerIds.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    if (!has(player, FISHING_PASS_ITEM_ID)) {
      player.getInventory().adds(FISHING_PASS_ITEM_ID, 1);
      player.sendMessage("You got the Fishing Contest Pass!");
    }
  }

  /** Bonzo's winning message hands over the trophy; the dwarves finish it. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId === BONZO_NPC_ID && stepId === TROPHY_MESSAGE_ID) {
      if (quest.getStage(player) >= STAGE_WON) return;
      if (!has(player, FISHING_TROPHY_ITEM_ID)) player.getInventory().adds(FISHING_TROPHY_ITEM_ID, 1);
      quest.setStage(player, STAGE_WON);
      return;
    }
    if (DwarfHandlerIds.has(npcId) && stepId === COMPLETE_ACTION_ID) {
      if (quest.isComplete(player)) return;
      if (has(player, FISHING_TROPHY_ITEM_ID)) player.getInventory().deleteNumber(FISHING_TROPHY_ITEM_ID, 1);
      quest.complete(player);
    }
  }

  /** Austri/Vestri are not indexed, so replay their transcript by stage. */
  function handleDwarfInteraction(event) {
    if (!DwarfHandlerIds.has(event.npcId)) return;
    const { player } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage >= STAGE_WON && has(player, FISHING_TROPHY_ITEM_ID)) {
      startTranscript(api, player, event.npcId, PAGE, "returning-to-vestri-or-austri");
      return;
    }
    if (stage >= STAGE_STARTED && !has(player, FISHING_PASS_ITEM_ID)) {
      startTranscript(api, player, event.npcId, PAGE, "starting-out-retrieving-another-fishing-pass-from-vestri-or-austri");
      return;
    }
    if (stage >= STAGE_STARTED) {
      startTranscript(api, player, event.npcId, PAGE, "starting-out-speaking-to-vestri-or-austri-before-winning");
      return;
    }
    startTranscript(api, player, event.npcId, PAGE, "starting-out-speaking-to-vestri-or-austri-to-start-the-quest");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "fishing_contest",
    name: "Fishing Contest",
    varpId: VARP_FISHING_CONTEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.FISHING.getIndex(), amount: 2437.5, label: "Fishing" }],
    rewardItemId: FISHING_TROPHY_ITEM_ID,
    rewardItemLabel: "A fishing trophy",
    otherRewards: ["Access to the White Wolf Mountain tunnel"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleDwarfInteraction);
  api.onPlayerLogin(handleLogin);
};
