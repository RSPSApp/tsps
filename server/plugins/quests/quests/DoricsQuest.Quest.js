/**
 * Doric's Quest.
 *
 * Words come from npc-dialogues.json:
 *   stage 0     -> "Doric's Quest" / "starting-off"
 *   in progress -> "…-talking-to-doric-without-all-the-materials" or
 *                  "…-returning-with-all-the-materials" (by carried items)
 *   complete    -> "Doric" / "after-doric-s-quest"
 *
 * This plugin supplies the variant selector, the condition answers, the start
 * hook (stage + starter pickaxe) and the hand-in action.
 */
module.exports = function registerDoricsQuestQuest(api) {
  const { Skill, Animation, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VARP_DORICS_QUEST = 31;
  const STAGE_STARTED = 10;
  const STAGE_COMPLETE = 100;
  const DORICS_ANVIL_ID = 2031;
  const DORICS_WHETSTONE_ID = 10641;
  const HAND_IN_MESSAGES = new Set(["NpBbL9", "n6fQmN"]);

  const REQUIRED_ITEMS = [
    { itemId: ItemIdentifiers.CLAY, amount: 6, label: "6 Clay" },
    { itemId: ItemIdentifiers.COPPER_ORE, amount: 4, label: "4 Copper ore" },
    { itemId: ItemIdentifiers.IRON_ORE, amount: 2, label: "2 Iron ore" },
  ];

  /** Transcript step ids whose action means the player hands the materials over. */
  const HAND_IN_ACTION_IDS = new Set(["wEuzw0", "M4gVPX"]);

  let quest;

  function hasAllMaterials(player) {
    return REQUIRED_ITEMS.every(
      (requirement) => player.getInventory().getAmount(requirement.itemId) >= requirement.amount
    );
  }

  function hasExactMaterials(player) {
    return REQUIRED_ITEMS.every(
      (requirement) => player.getInventory().getAmount(requirement.itemId) === requirement.amount
    );
  }

  function reward(player) {
    player.getInventory().adds(ItemIdentifiers.COINS, 180);
    player.getSkillManager().addExperiences(Skill.MINING, 1300);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I have spoken to Doric.</str>",
        "<str>I have collected some clay, copper and</str>",
        "<str>iron ore, and Doric let me use his anvils.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "I have spoken to <col=800000>Doric</col>.",
        "",
        "To use his anvils, I need to bring him:",
      ];
      for (const requirement of REQUIRED_ITEMS) {
        const carried = player.getInventory().getAmount(requirement.itemId);
        lines.push(carried >= requirement.amount ? `<str>${requirement.label}</str>` : requirement.label);
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Doric</col> who is <col=800000>north of Falador</col>.",
      "",
      "There aren't any requirements for this quest,",
      "but level <col=800000>15 Mining</col> will help.",
    ];
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== NpcIdentifiers.DORIC) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: "Doric", variant: "after-doric-s-quest" };
    if (stage >= STAGE_STARTED) {
      return hasAllMaterials(player)
        ? { page: "Doric's Quest", variant: "starting-off-returning-with-all-the-materials" }
        : { page: "Doric's Quest", variant: "starting-off-talking-to-doric-without-all-of-the-materials" };
    }
    return { page: "Doric's Quest", variant: "starting-off" };
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== NpcIdentifiers.DORIC) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not already have all of the materials")) return !hasAllMaterials(player);
    if (value.includes("already has all of the materials")) return hasAllMaterials(player);
    if (value.includes("has the exact amounts")) return hasExactMaterials(player);
    if (value.includes("does not have 15 mining")) return player.getSkillManager().getCurrentLevel(Skill.MINING) < 15;
    return null;
  }

  function handleLine(event) {
    if (event.npcId !== NpcIdentifiers.DORIC || !String(event.text).startsWith("Clay is what I use more than anything")) return;
    event.before = () => {
      if (quest.getStage(event.player) >= STAGE_STARTED) return;
      // Do not commit the start when Doric's promised pickaxe cannot be handed over.
      if (event.player.getInventory().isFull()) {
        event.player.getInventory().full();
        return;
      }
      quest.setStage(event.player, STAGE_STARTED);
      event.player.sendMessage("You've started a new quest: <col=081190>Doric's Quest</col>");
      event.player.getInventory().adds(ItemIdentifiers.BRONZE_PICKAXE, 1);
    };
  }

  function handleMessage(event) {
    if (event.npcId !== NpcIdentifiers.DORIC) return;
    if (event.stepId === "UgCEfK") { event.box = { statement: true }; return; }
    if (!HAND_IN_MESSAGES.has(event.stepId)) return;
    if (!hasAllMaterials(event.player) || quest.isComplete(event.player)) { event.end = true; return; }
    event.box = { items: [ItemIdentifiers.COPPER_ORE] };
    event.player.performAnimation(new Animation(3071));
    const doric = event.npc ?? [...api.core.World.getNpcs()].find(npc => npc.getId() === NpcIdentifiers.DORIC && npc.getLocation().isWithinDistance(event.player.getLocation(), 8));
    doric?.performAnimation(new Animation(3072));
  }

  function warnBeforeStart(event) {
    if (event.npcId === NpcIdentifiers.DORIC && String(event.prompt).includes("Start Doric's Quest")
      && event.player.getSkillManager().getCurrentLevel(Skill.MINING) < 15) {
      event.warning = "Before starting this quest, be aware that one or more of your skill levels are lower than recommended.";
    }
  }

  function handleSmithy(event) {
    const objectId = event.objectId ?? event.object?.getId();
    // false: an object hook that returns anything else claims the click, and Smith on every
    // other anvil would never reach the Smithing plugin.
    if (objectId !== DORICS_ANVIL_ID && objectId !== DORICS_WHETSTONE_ID || quest.isComplete(event.player)) return false;
    event.handled = true;
    event.denied = true;
    startTranscript(api, event.player, NpcIdentifiers.DORIC, "Doric's Quest", objectId === DORICS_ANVIL_ID
      ? "starting-off-attempting-to-use-his-anvils-before-the-quest"
      : "starting-off-attempting-to-use-his-whetstone-before-the-quest");
    return true;
  }

  function handleHandIn(event) {
    if (event.npcId !== NpcIdentifiers.DORIC || !HAND_IN_ACTION_IDS.has(event.stepId)) return;
    event.handled = true;
    event.end = true;
    if (quest.getStage(event.player) < STAGE_STARTED || quest.isComplete(event.player) || !hasAllMaterials(event.player)) return;
    for (const requirement of REQUIRED_ITEMS) {
      event.player.getInventory().deleteNumber(requirement.itemId, requirement.amount);
    }
    quest.complete(event.player);
  }

  quest = registerQuest(api, {
    key: "dorics_quest",
    name: "Doric's Quest",
    varpId: VARP_DORICS_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 154,
    xpRewards: [{ skillId: Skill.MINING.getIndex(), amount: 1300, label: "Mining" }],
    scrollItemId: ItemIdentifiers.STEEL_PICKAXE,
    rewardItemLabel: "Use of Doric's anvils",
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleMessage);
  api.onCustomEvent("npc-dialogue:menu", warnBeforeStart);
  api.onCustomEvent("npc-dialogue:action", handleHandIn);
  api.onObjectInteraction("Anvil", { Smith: handleSmithy });
  api.onObjectInteraction("Doric's Whetstone", { Use: handleSmithy });
  api.onCustomEvent("smithing:anvil-access", handleSmithy);
};
