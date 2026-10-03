/**
 * Monk's Friend (members).
 *
 * Brother Omad (4244) and Brother Cedric (4245) are both indexed on the
 * "Monk's Friend" transcript page, so every talk and hand-over is driven by the
 * dump; this plugin answers its two prose conditions, selects the variant by
 * stage, runs the start hook and turns the shared hand-in actions/messages into
 * stage changes.
 *
 * Stages (varp 30): 10 started, 20 blanket returned, 30 looking for Cedric,
 * 40 finding water, 50 given water, 60 fixing cart, 70 cart fixed, 80 complete.
 *
 * Gaps (no dump support): the final Omad variant
 * ("...after-finding-and-helping-brother-cedric") has a wiki UNAVAILABLE marker
 * in the middle that stops playback before its dance cutscene, so stage 70 plays
 * the dump's "brother-cedric-dancing-cutscene" directly (it ends with "Quest
 * complete!"). The hidden ladder object is placed by the reference's region
 * handler; here the ladders just teleport when clicked.
 */
module.exports = function registerMonksFriendQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const PAGE = "Monk's Friend";

  const BROTHER_OMAD_NPC_ID = NpcIdentifiers.BROTHER_OMAD;
  const BROTHER_CEDRIC_NPC_ID = NpcIdentifiers.BROTHER_CEDRIC;

  const VARP_MONKS_FRIEND = 30;
  const STAGE_STARTED = 10;
  const STAGE_RETURNED_BLANKET = 20;
  const STAGE_LOOKING_FOR_CEDRIC = 30;
  const STAGE_FINDING_WATER = 40;
  const STAGE_GIVEN_WATER = 50;
  const STAGE_FIXING_CART = 60;
  const STAGE_FIXED_CART = 70;
  const STAGE_COMPLETE = 80;

  const CHILDS_BLANKET_ITEM_ID = ItemIdentifiers.CHILDS_BLANKET;
  const JUG_OF_WATER_ITEM_ID = ItemIdentifiers.JUG_OF_WATER;
  const LOGS_ITEM_ID = ItemIdentifiers.LOGS;
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK;
  const LAW_RUNE_ITEM_ID = ItemIdentifiers.LAW_RUNE;

  const HIDDEN_LADDER_LOC_ID = ObjectIdentifiers.LADDER_243;
  const CAVE_LADDER_LOC_ID = ObjectIdentifiers.LADDER_216;

  const START_HOOK = "quest:monk-s-friend:start";
  const COMPLETE_ACTION_ID = "QwqMu_";
  const BLANKET_MESSAGE_ID = "bT1LEg";
  const WATER_MESSAGE_ID = "w4kh6u";
  const LOGS_MESSAGE_ID = "nd6lda";
  const PLANK_MESSAGE_ID = "Gil6fA";

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasWood = (player) => hasItem(player, LOGS_ITEM_ID) || hasItem(player, PLANK_ITEM_ID);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const blanket = "<str>I recovered the child's blanket for Brother Omad.</str>";
    if (stage >= STAGE_COMPLETE) {
      return [
        blanket,
        "<str>I helped Brother Cedric repair his cart.</str>",
        "<str>I returned to the monastery for the party.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FIXED_CART) {
      return [blanket, "<str>I repaired Brother Cedric's cart.</str>", "I should return to <col=800000>Brother Omad</col>."];
    }
    if (stage >= STAGE_FIXING_CART) {
      return [blanket, "Brother Cedric needs some ordinary <col=800000>logs</col>", "to repair his broken cart."];
    }
    if (stage >= STAGE_GIVEN_WATER) {
      return [blanket, "<str>I sobered Brother Cedric up with water.</str>", "I should ask whether he needs more help."];
    }
    if (stage >= STAGE_FINDING_WATER) {
      return [blanket, "Brother Cedric is drunk. I need to bring him", "a <col=800000>jug of water</col>."];
    }
    if (stage >= STAGE_LOOKING_FOR_CEDRIC) {
      return [blanket, "I should find <col=800000>Brother Cedric</col> on the road", "south of the Ardougne zoo."];
    }
    if (stage >= STAGE_RETURNED_BLANKET) {
      return [blanket, "I should ask <col=800000>Brother Omad</col> about the party."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Brother Omad asked me to recover a child's blanket.",
        "The thieves' cave is hidden beneath a <col=800000>ring of stones</col>",
        "south-west of the Clock Tower.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Brother Omad</col> at the monastery south of",
      "<col=800000>Ardougne</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.WOODCUTTING, 2000);
    // The scroll/quest points grant one law rune; top up to the quest's eight.
    player.getInventory().adds(LAW_RUNE_ITEM_ID, 7);
  }

  function omadVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-for-20-minutes-talking-to-brother-omad";
    if (stage >= STAGE_FIXED_CART) return "brother-cedric-dancing-cutscene";
    if (stage >= STAGE_GIVEN_WATER) return "brother-cedric-talking-to-brother-omad-after-giving-brother-cedric-water";
    if (stage >= STAGE_FINDING_WATER) return "brother-cedric-talking-to-brother-omad-after-finding-brother-cedric";
    if (stage >= STAGE_LOOKING_FOR_CEDRIC) return "brother-cedric-talking-to-brother-omad-before-finding-brother-cedric";
    if (stage >= STAGE_RETURNED_BLANKET) return "brother-cedric-talking-to-brother-omad-again";
    if (stage >= STAGE_STARTED) {
      return hasItem(player, CHILDS_BLANKET_ITEM_ID)
        ? "child-s-blanket-talking-to-brother-omad-after-retrieving-the-blanket"
        : "getting-started-talking-to-brother-omad-before-retrieving-the-blanket";
    }
    return "getting-started-talking-to-brother-omad";
  }

  function cedricVariant(stage, player) {
    if (stage >= STAGE_FIXED_CART) return "brother-cedric-talking-to-brother-cedric-again-before-returning";
    if (stage >= STAGE_FIXING_CART) {
      return hasWood(player)
        ? "brother-cedric-talking-to-brother-cedric-while-holding-some-wood"
        : "brother-cedric-talking-to-brother-cedric-before-getting-some-wood";
    }
    if (stage >= STAGE_GIVEN_WATER) {
      return "brother-cedric-talking-to-brother-cedric-after-giving-him-water-before-accepting-to-help-with-the-cart";
    }
    if (stage >= STAGE_FINDING_WATER) {
      return hasItem(player, JUG_OF_WATER_ITEM_ID)
        ? "brother-cedric-talking-to-brother-cedric-with-water"
        : "brother-cedric-talking-to-brother-cedric-before-getting-water";
    }
    if (stage >= STAGE_LOOKING_FOR_CEDRIC) {
      // The dump has no action for this transition; the reference advances when
      // Cedric asks for water, so do it as the conversation begins.
      quest.setStage(player, STAGE_FINDING_WATER);
      return "brother-cedric-talking-to-brother-cedric";
    }
    return "brother-cedric-talking-to-brother-cedric-before-agreeing-to-find-him";
  }

  function selectVariant({ npcId, player }) {
    if (npcId === BROTHER_OMAD_NPC_ID) return omadVariant(quest.getStage(player), player);
    if (npcId === BROTHER_CEDRIC_NPC_ID) return cedricVariant(quest.getStage(player), player);
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("has logs")) return hasItem(player, LOGS_ITEM_ID);
    if (value.includes("has a plank")) return hasItem(player, PLANK_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== BROTHER_OMAD_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option }) {
    const value = String(option ?? "").toLowerCase();
    const stage = quest.getStage(player);
    if (npcId === BROTHER_OMAD_NPC_ID && stage >= STAGE_RETURNED_BLANKET && stage < STAGE_LOOKING_FOR_CEDRIC) {
      if (value.includes("where should i look")) quest.setStage(player, STAGE_LOOKING_FOR_CEDRIC);
      return;
    }
    if (npcId === BROTHER_CEDRIC_NPC_ID && stage >= STAGE_GIVEN_WATER && stage < STAGE_FIXING_CART) {
      if (value.includes("yes") && value.includes("happy to")) quest.setStage(player, STAGE_FIXING_CART);
    }
  }

  /** The transcript's hand-over messages consume the item and advance the stage. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    const stage = quest.getStage(player);
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && stage >= STAGE_FIXED_CART) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (npcId === BROTHER_OMAD_NPC_ID && stepId === BLANKET_MESSAGE_ID && hasItem(player, CHILDS_BLANKET_ITEM_ID)) {
      player.getInventory().deleteNumber(CHILDS_BLANKET_ITEM_ID, 1);
      player.sendMessage("You hand the monk the child's blanket.");
      if (stage < STAGE_RETURNED_BLANKET) quest.setStage(player, STAGE_RETURNED_BLANKET);
      event.handled = true;
      return;
    }
    if (npcId === BROTHER_CEDRIC_NPC_ID && stepId === WATER_MESSAGE_ID && hasItem(player, JUG_OF_WATER_ITEM_ID)) {
      player.getInventory().deleteNumber(JUG_OF_WATER_ITEM_ID, 1);
      player.sendMessage("You hand the monk a jug of water.");
      if (stage < STAGE_GIVEN_WATER) quest.setStage(player, STAGE_GIVEN_WATER);
      event.handled = true;
      return;
    }
    if (npcId === BROTHER_CEDRIC_NPC_ID && (stepId === LOGS_MESSAGE_ID || stepId === PLANK_MESSAGE_ID)) {
      const itemId = stepId === LOGS_MESSAGE_ID ? LOGS_ITEM_ID : PLANK_ITEM_ID;
      if (!hasItem(player, itemId)) {
        event.handled = true;
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      player.sendMessage("You help Cedric repair the cart.");
      if (stage < STAGE_FIXED_CART) quest.setStage(player, STAGE_FIXED_CART);
      event.handled = true;
    }
  }

  /** The ladders into and out of the thieves' cave. */
  function handleLadderInteraction(event) {
    const { objectId, player } = event;
    if (objectId === HIDDEN_LADDER_LOC_ID) {
      player.moveTo(new Location(2561, 9621, 0));
      event.handled = true;
    } else if (objectId === CAVE_LADDER_LOC_ID) {
      player.moveTo(new Location(2561, 3221, 0));
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "monks_friend",
    name: "Monk's Friend",
    varpId: VARP_MONKS_FRIEND,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.WOODCUTTING.getIndex(), amount: 2000, label: "Woodcutting" }],
    rewardItemId: LAW_RUNE_ITEM_ID,
    rewardItemLabel: "8 Law runes",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleLadderInteraction);
};
