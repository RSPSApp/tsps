/**
 * Observatory Quest (members).
 *
 * The words come from the "Observatory Quest" transcript page. The professor, his
 * assistant and the sleeping goblin guard are indexed, so this plugin supplies the
 * by-stage variant selector, the prose-condition answers, the start hook and the
 * "Quest complete!" actions from after-viewing-the-telescope. Stage machine (varp
 * 112) ported from xrsps: 1 planks, 2 bronze, 3 glass, 4 mould, 5 lens, 6 telescope,
 * 7 complete, 8 wine claimed.
 *
 * Ported interactions: searching the dungeon chest for the kitchen key and lens
 * mould, casting the lens (mould + molten glass) and looking through the telescope.
 * Gaps: the professor's constellation is chosen from the transcript rather than the
 * player's sign, so the random reward table (Strength/Defence/Hitpoints/Attack XP,
 * runes, tuna, etc.) is not granted; the goblin dungeon gates, the assistant's wine
 * hand-out and the telescope const-build are not wired.
 */
module.exports = function registerObservatoryQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Observatory Quest";

  const VARP_OBSERVATORY_QUEST = 112;

  const STAGE_PLANKS = 1;
  const STAGE_BRONZE = 2;
  const STAGE_GLASS = 3;
  const STAGE_MOULD = 4;
  const STAGE_LENS = 5;
  const STAGE_TELESCOPE = 6;
  const STAGE_COMPLETE = 7;
  const STAGE_CLAIMED_WINE = 8;

  const VIEWED_ATTRIBUTE = "quest.observatory_quest.viewed";

  const START_HOOK = "quest:observatory-quest:start";

  /** Every "Quest complete!" action across the after-viewing-the-telescope choices. */
  const COMPLETE_ACTION_IDS = new Set([
    "RZIxJd", "42iZjm", "az5TSU", "jFQCJj", "JTTGjU", "3JvMiY",
    "uJHYgt", "5ogiFw", "OX2wkW", "b-a96m", "AlVBZ2", "hHQ5V3",
  ]);

  const PROFESSOR_NPC_IDS = new Set([NpcIdentifiers.OBSERVATORY_PROFESSOR, NpcIdentifiers.OBSERVATORY_PROFESSOR_2]);
  const ASSISTANT_NPC_ID = NpcIdentifiers.OBSERVATORY_ASSISTANT;
  const SLEEPING_GUARD_NPC_ID = NpcIdentifiers.SLEEPING_GUARD;

  const PLANK = ItemIdentifiers.PLANK;
  const BRONZE_BAR = ItemIdentifiers.BRONZE_BAR;
  const MOLTEN_GLASS = ItemIdentifiers.MOLTEN_GLASS;
  const GOBLIN_KITCHEN_KEY = ItemIdentifiers.GOBLIN_KITCHEN_KEY;
  const LENS_MOULD = ItemIdentifiers.LENS_MOULD;
  const OBSERVATORY_LENS = ItemIdentifiers.OBSERVATORY_LENS;

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) return ["<str>I repaired the Observatory telescope.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    if (stage === 0) return ["I can start this quest by speaking to the", "<col=800000>Observatory professor</col> south-west of Ardougne."];
    if (stage === STAGE_PLANKS) return ["The professor needs <col=800000>three wooden planks</col> for a new tripod."];
    if (stage === STAGE_BRONZE) return ["The professor needs a <col=800000>bronze bar</col> for the telescope tube."];
    if (stage === STAGE_GLASS) return ["The professor needs <col=800000>molten glass</col> for a replacement lens."];
    if (stage === STAGE_MOULD) return ["The goblins hid the professor's <col=800000>lens mould</col> in the Observatory dungeon."];
    if (stage === STAGE_LENS) return ["I should use the <col=800000>lens mould</col> with <col=800000>molten glass</col>."];
    return ["The telescope is repaired. I should meet the professor", "at the Observatory and <col=800000>look through the telescope</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 2250);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (PROFESSOR_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page("Observatory professor", "standard-dialogue-after-observatory-quest");
      if (stage === STAGE_TELESCOPE) {
        return page(PAGE, player.getAttribute(VIEWED_ATTRIBUTE)
          ? "after-viewing-the-telescope"
          : "entering-the-observatory-talking-to-the-professor");
      }
      if (stage === STAGE_LENS) {
        return page(PAGE, has(player, OBSERVATORY_LENS)
          ? "returning-with-the-observatory-lens"
          : "returning-with-the-lens-mould-returning-without-the-observatory-lens");
      }
      if (stage === STAGE_MOULD) {
        return page(PAGE, has(player, LENS_MOULD)
          ? "returning-with-the-lens-mould"
          : "returning-with-molten-glass-returning-without-the-lens-mould");
      }
      if (stage === STAGE_GLASS) {
        return page(PAGE, has(player, MOLTEN_GLASS)
          ? "returning-with-molten-glass"
          : "returning-with-a-bronze-bar-returning-without-molten-glass");
      }
      if (stage === STAGE_BRONZE) {
        return page(PAGE, has(player, BRONZE_BAR)
          ? "returning-with-a-bronze-bar"
          : "returning-with-three-planks-returning-without-a-bronze-bar");
      }
      if (stage === STAGE_PLANKS) {
        const planks = player.getInventory().getAmount(PLANK);
        if (planks >= 3) return page(PAGE, "returning-with-three-planks");
        if (planks > 0) return page(PAGE, "starting-off-returning-without-enough-planks");
        return page(PAGE, "starting-off-returning-with-no-planks");
      }
      return page(PAGE, "starting-off");
    }

    if (npcId === ASSISTANT_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return page("Observatory assistant", "after-observatory-quest-subsequent-dialogue");
      if (stage === STAGE_TELESCOPE) return page(PAGE, "returning-with-the-observatory-lens-talking-to-the-assistant-before-going-up-to-the-observatory");
      if (stage === STAGE_LENS) {
        return page(PAGE, has(player, OBSERVATORY_LENS)
          ? "making-the-observatory-lens-talking-to-the-assistant-with-the-observatory-lens"
          : "returning-with-the-lens-mould-talking-to-the-assistant-without-the-observatory-lens");
      }
      if (stage === STAGE_MOULD) {
        return page(PAGE, has(player, GOBLIN_KITCHEN_KEY)
          ? "searching-for-the-lens-mould-speaking-to-the-observatory-assistant-with-the-goblin-kitchen-key"
          : "returning-with-molten-glass-talking-to-the-assistant-without-the-lens-mould");
      }
      if (stage === STAGE_GLASS) {
        return page(PAGE, has(player, MOLTEN_GLASS)
          ? "returning-with-a-bronze-bar-talking-to-the-assistant-with-molten-glass"
          : "returning-with-a-bronze-bar-talking-to-the-assistant-without-molten-glass");
      }
      if (stage === STAGE_BRONZE) {
        return page(PAGE, has(player, BRONZE_BAR)
          ? "returning-with-three-planks-talking-to-the-assistant-with-a-bronze-bar"
          : "returning-with-three-planks-talking-to-the-assistant-without-a-bronze-bar");
      }
      if (stage === STAGE_PLANKS) {
        const planks = player.getInventory().getAmount(PLANK);
        if (planks >= 3) return page(PAGE, "starting-off-talking-to-the-assistant-with-three-planks");
        if (planks > 0) return page(PAGE, "starting-off-talking-to-the-assistant-with-less-than-three-planks");
        return page(PAGE, "starting-off-talking-to-the-assistant-without-any-planks");
      }
      return page("Observatory assistant", "before-observatory-quest");
    }

    if (npcId === SLEEPING_GUARD_NPC_ID && stage === STAGE_MOULD && !has(player, LENS_MOULD)) {
      return page(PAGE, "prodding-the-goblin-guard");
    }

    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("inventory space for the reward")) return !player.getInventory().isFull();
    if (value.includes("does not have inventory space for the reward")) return player.getInventory().isFull();
    if (value.includes("did not see this sign")) return false;
    if (value.includes("did see")) return true;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!PROFESSOR_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_PLANKS) quest.setStage(player, STAGE_PLANKS);
  }

  /** The completion action in after-viewing-the-telescope. */
  function handleAction({ player, npcId, stepId }) {
    if (!PROFESSOR_NPC_IDS.has(npcId) || !COMPLETE_ACTION_IDS.has(stepId)) return;
    if (quest.getStage(player) < STAGE_TELESCOPE || quest.isComplete(player)) return;
    quest.complete(player);
  }

  /** Cast the lens from the mould and molten glass. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(LENS_MOULD) || !ids.includes(MOLTEN_GLASS)) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_LENS) return;
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 10) {
      player.sendMessage("You need level 10 Crafting to cast the lens.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(MOLTEN_GLASS, 1);
    player.getInventory().adds(OBSERVATORY_LENS, 1);
    player.sendMessage("You pour the glass into the mould and make an Observatory lens.");
    event.handled = true;
  }

  /** Dungeon chest: the kitchen key, then the stolen lens mould. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();

    if ((objectId === ObjectIdentifiers.CHEST_6 || objectId === ObjectIdentifiers.CHEST_7) && option.includes("search")) {
      if (quest.getStage(player) !== STAGE_MOULD) return;
      if (!has(player, GOBLIN_KITCHEN_KEY)) {
        player.getInventory().adds(GOBLIN_KITCHEN_KEY, 1);
        player.sendMessage("You find a kitchen key.");
      } else if (!has(player, LENS_MOULD)) {
        player.getInventory().adds(LENS_MOULD, 1);
        player.sendMessage("You find the stolen lens mould inside the chest.");
      }
      event.handled = true;
      return;
    }

    if (objectId === ObjectIdentifiers.TELESCOPE && option.includes("look")) {
      if (quest.getStage(player) !== STAGE_TELESCOPE) return;
      player.setAttribute(VIEWED_ATTRIBUTE, true);
      player.sendMessage("You look through the telescope and see a constellation.");
      event.handled = true;
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "observatory_quest",
    name: "Observatory Quest",
    varpId: VARP_OBSERVATORY_QUEST,
    startedValue: STAGE_PLANKS,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 2250, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.UNCUT_SAPPHIRE,
    rewardItemLabel: "An uncut sapphire",
    otherRewards: ["A random reward based on the observed constellation"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(VIEWED_ATTRIBUTE);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
};
