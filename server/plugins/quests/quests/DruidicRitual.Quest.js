/**
 * Druidic Ritual (members).
 *
 * The words come from the "Druidic Ritual" transcript page and drive both NPCs:
 *   Kaqemeex (5045): starting-the-quest -> ...-again -> finishing-up (complete)
 *   Sanfew   (5044): talking-to-sanfew -> gathering-the-ingredients
 *
 * This plugin supplies the variant selector, the prose-condition answers, the
 * start hook, the Cauldron of Thunder meat-dipping and the completion action.
 * Sanfew's "gathering-the-ingredients" transcript has no hand-in action, so the
 * selector consumes the four enchanted meats and advances the stage when the
 * player asks him about them (the same side-effecting style as the Drezel
 * selector in PriestInPeril).
 *
 * Gaps: Kaqemeex has no post-quest transcript variant; the selector returns null
 * and the id index falls back to the page default. The raw meats are assumed to
 * be obtainable elsewhere (they are ordinary food items, not spawned by this
 * plugin).
 */
module.exports = function registerDruidicRitualQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const KAQEMEEX_NPC_ID = NpcIdentifiers.KAQEMEEX; // 5045
  const SANFEW_NPC_ID = NpcIdentifiers.SANFEW; // 5044

  const VARP_DRUIDIC_RITUAL = 80;
  const STAGE_STARTED = 1;
  const STAGE_GATHERING_MEATS = 2;
  const STAGE_RETURN_TO_KAQEMEEX = 3;
  const STAGE_COMPLETE = 4;

  const CAULDRON_OF_THUNDER_LOC_ID = ObjectIdentifiers.CAULDRON_OF_THUNDER; // 2142

  const RAW_TO_ENCHANTED = new Map([
    [ItemIdentifiers.RAW_BEEF, ItemIdentifiers.ENCHANTED_BEEF],
    [ItemIdentifiers.RAW_RAT_MEAT, ItemIdentifiers.ENCHANTED_RAT],
    [ItemIdentifiers.RAW_BEAR_MEAT, ItemIdentifiers.ENCHANTED_BEAR],
    [ItemIdentifiers.RAW_CHICKEN, ItemIdentifiers.ENCHANTED_CHICKEN],
  ]);
  const ENCHANTED_MEAT_IDS = [
    ItemIdentifiers.ENCHANTED_BEEF,
    ItemIdentifiers.ENCHANTED_RAT,
    ItemIdentifiers.ENCHANTED_BEAR,
    ItemIdentifiers.ENCHANTED_CHICKEN,
  ];

  const START_HOOK = "quest:druidic-ritual:start";
  const COMPLETE_ACTION_ID = "0QWHJ-";
  /** Sanfew's "player has all four meats" condition; hand them over when chosen. */
  const HAND_IN_CONDITION_ID = "zWTpyU";

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAllMeats = (player) => ENCHANTED_MEAT_IDS.every((itemId) => held(player, itemId));

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped the druids purify their stone circle.</str>",
        "<str>Kaqemeex taught me the Herblore skill.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN_TO_KAQEMEEX) {
      return [
        "<str>I took the enchanted meats to Sanfew.</str>",
        "I should return to <col=800000>Kaqemeex</col> at the",
        "stone circle in <col=800000>Taverley</col>.",
      ];
    }
    if (stage >= STAGE_GATHERING_MEATS) {
      const labels = ["Enchanted beef", "Enchanted rat meat", "Enchanted bear meat", "Enchanted chicken"];
      const lines = [
        "Sanfew needs four raw meats dipped in the",
        "<col=800000>Cauldron of Thunder</col> beneath Taverley:",
        "",
      ];
      ENCHANTED_MEAT_IDS.forEach((itemId, index) => {
        lines.push(held(player, itemId) ? `<str>${labels[index]}</str>` : labels[index]);
      });
      return lines;
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Kaqemeex asked me to help purify the druids'",
        "stone circle. I should speak to <col=800000>Sanfew</col>",
        "upstairs in the Taverley herb shop.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Kaqemeex</col> at the stone circle north of",
      "<col=800000>Taverley</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HERBLORE, 250);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === KAQEMEEX_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return null; // no post-quest transcript (GAP)
      if (stage >= STAGE_RETURN_TO_KAQEMEEX) return "finishing-up";
      if (stage >= STAGE_STARTED) return "starting-the-quest-talking-to-kaqemeex-again";
      return "starting-the-quest";
    }
    if (npcId === SANFEW_NPC_ID) {
      if (stage === STAGE_STARTED) {
        quest.setStage(player, STAGE_GATHERING_MEATS);
        return "talking-to-sanfew";
      }
      if (stage === STAGE_GATHERING_MEATS) {
        return "gathering-the-ingredients";
      }
      return null;
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("doesn't have all four meats")) return !hasAllMeats(player);
    if (value.includes("does have all four meats")) return hasAllMeats(player);
    if (value.includes("raw chicken")) return held(player, ItemIdentifiers.RAW_CHICKEN);
    if (value.includes("raw beef")) return held(player, ItemIdentifiers.RAW_BEEF);
    if (value.includes("raw rat meat")) return held(player, ItemIdentifiers.RAW_RAT_MEAT);
    if (value.includes("raw bear meat")) return held(player, ItemIdentifiers.RAW_BEAR_MEAT);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KAQEMEEX_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (npcId !== KAQEMEEX_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) >= STAGE_RETURN_TO_KAQEMEEX && !quest.isComplete(player)) {
      quest.complete(player);
    }
  }

  /** Sanfew accepts the four enchanted meats once the positive branch is chosen. */
  function handleCondition({ player, npcId, stepId }) {
    if (npcId !== SANFEW_NPC_ID || stepId !== HAND_IN_CONDITION_ID) return;
    if (!hasAllMeats(player)) return;
    for (const itemId of ENCHANTED_MEAT_IDS) player.getInventory().deleteNumber(itemId, 1);
    quest.setStage(player, STAGE_RETURN_TO_KAQEMEEX);
  }

  /** Dipping a raw meat in the Cauldron of Thunder enchants it. */
  function handleItemOnCauldron(event) {
    if (event.objectId !== CAULDRON_OF_THUNDER_LOC_ID) return;
    const enchanted = RAW_TO_ENCHANTED.get(event.itemId);
    if (enchanted === undefined) return;
    if (quest.getStage(event.player) !== STAGE_GATHERING_MEATS) {
      event.player.sendMessage("You have no reason to dip that in the cauldron.");
      event.handled = true;
      return;
    }
    event.player.getInventory().deleteNumber(event.itemId, 1);
    event.player.getInventory().adds(enchanted, 1);
    event.player.sendMessage("You dip the raw meat into the Cauldron of Thunder.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "druidic_ritual",
    name: "Druidic Ritual",
    varpId: VARP_DRUIDIC_RITUAL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    xpRewards: [{ skillId: Skill.HERBLORE.getIndex(), amount: 250, label: "Herblore" }],
    otherRewards: ["Access to the Herblore skill"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onItemOnObject(handleItemOnCauldron, { noted: false });
  api.onPlayerLogin(handleLogin);
};
