/**
 * Priest in Peril (members).
 *
 * The words come from the "Priest in Peril" transcript page; this plugin supplies
 * the variant selector for King Roald and Drezel (both indexed), the prose-
 * condition answers, the start hook, the essence hand-in and the monk/guardian
 * interactions. Drezel's Talk-to is transcript-driven so every branch plays.
 *
 * Stages (varp 302): 10 started, 20 guardian killed, 30 told King Roald,
 * 40 met Drezel, 50 vampyre sealed, 60 complete.
 *
 * Gaps (no dump/index support): the golden key/blessed-water objects (cell door,
 * well, coffin) are not implemented; the Drezel conversation drives those stages,
 * and the monks hand over the key. The guardian's magic condition is answered true.
 */
module.exports = function registerPriestInPerilQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Priest in Peril";

  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD,
    NpcIdentifiers.KING_ROALD_3,
    NpcIdentifiers.KING_ROALD_5,
    NpcIdentifiers.KING_ROALD_6,
    NpcIdentifiers.KING_ROALD_7,
  ]);
  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL;
  const TEMPLE_GUARDIAN_NPC_ID = NpcIdentifiers.TEMPLE_GUARDIAN;
  const MONKS_OF_ZAMORAK_NPC_IDS = new Set([
    NpcIdentifiers.MONK_OF_ZAMORAK,
    NpcIdentifiers.MONK_OF_ZAMORAK_2,
    NpcIdentifiers.MONK_OF_ZAMORAK_3,
    NpcIdentifiers.MONK_OF_ZAMORAK_4,
    NpcIdentifiers.MONK_OF_ZAMORAK_5,
    NpcIdentifiers.MONK_OF_ZAMORAK_6,
  ]);

  const VARP_PRIEST_IN_PERIL = 302;
  const STAGE_STARTED = 10;
  const STAGE_GUARDIAN_KILLED = 20;
  const STAGE_TOLD_KING_ROALD = 30;
  const STAGE_MET_DREZEL = 40;
  const STAGE_VAMPYRE_SEALED = 50;
  const STAGE_COMPLETE = 60;

  const GOLDEN_KEY_ITEM_ID = ItemIdentifiers.GOLDEN_KEY;
  const BLESSED_WATER_ITEM_ID = ItemIdentifiers.BLESSED_WATER;
  const RUNE_ESSENCE_ITEM_ID = ItemIdentifiers.RUNE_ESSENCE;
  const PURE_ESSENCE_ITEM_ID = ItemIdentifiers.PURE_ESSENCE;
  const ESSENCE_REQUIRED = 50;

  const START_HOOK = "quest:priest-in-peril:start";
  /** Transcript action that ends the "giving the last of the essence" branch. */
  const COMPLETE_ACTION_ID = "5wj46V";

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function essenceCount(player) {
    return (
      player.getInventory().getAmount(RUNE_ESSENCE_ITEM_ID) +
      player.getInventory().getAmount(PURE_ESSENCE_ITEM_ID)
    );
  }

  function takeEssence(player) {
    let remaining = ESSENCE_REQUIRED;
    for (const itemId of [RUNE_ESSENCE_ITEM_ID, PURE_ESSENCE_ITEM_ID]) {
      while (remaining > 0 && player.getInventory().getAmount(itemId) > 0) {
        player.getInventory().deleteNumber(itemId, 1);
        remaining--;
      }
    }
    return remaining === 0;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I restored the River Salve barrier.</str>",
        "<str>Drezel can safely guard the temple again.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      return [
        "<str>I freed Drezel and sealed the vampyre's coffin.</str>",
        "Drezel needs <col=800000>50 rune or pure essence</col>",
        "to restore the River Salve barrier.",
      ];
    }
    if (stage >= STAGE_MET_DREZEL) {
      return [
        "<str>I found Drezel imprisoned beneath the temple.</str>",
        "I should seal the vampyre's coffin and warn",
        "<col=800000>King Roald</col>.",
      ];
    }
    if (stage >= STAGE_TOLD_KING_ROALD) {
      return [
        "King Roald explained that the creature guarded Misthalin.",
        "I must return to the temple and rescue <col=800000>Drezel</col>.",
      ];
    }
    if (stage >= STAGE_GUARDIAN_KILLED) {
      return [
        "<str>I killed the creature at the temple.</str>",
        "I should report back to <col=800000>King Roald</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "King Roald sent me to check on <col=800000>Drezel</col>.",
        "I should investigate the temple east of Varrock.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>King Roald</col> in Varrock Palace.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1406);
  }

  function kingRoaldVariant(stage, player) {
    // Shield of Arrav also finishes at King Roald; defer to its handler once the
    // player has joined a gang (otherwise its certificate branch is unreachable).
    const shieldStage = Number(player.getAttribute("quest.shield_of_arrav.stage")) || 0;
    if (shieldStage >= 4) return null;
    if (stage >= STAGE_COMPLETE) {
      return { page: "King Roald", variant: "standard-dialogue-after-priest-in-peril" };
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      return "after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-king-roald-again";
    }
    if (stage >= STAGE_MET_DREZEL) return "saving-drezel-and-the-world-updating-king-roald";
    if (stage >= STAGE_TOLD_KING_ROALD) return "you-killed-a-dog-talking-to-him-again";
    if (stage >= STAGE_GUARDIAN_KILLED) {
      return "you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog";
    }
    if (stage >= STAGE_STARTED) return "starting-the-quest-talking-to-king-roald-again";
    return "starting-the-quest";
  }

  /**
   * Drezel drives the middle of the quest. Meeting him advances to "met"; the
   * golden key earns the blessed water; fifty essence finishes the barrier.
   */
  function drezelVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) {
      return "after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-drezel-again";
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      return essenceCount(player) >= ESSENCE_REQUIRED
        ? "giving-drezel-the-last-of-the-essence"
        : "repairing-the-barrier-talking-to-drezel-again";
    }
    if (stage >= STAGE_MET_DREZEL) {
      return "talking-to-drezel-with-the-iron-key";
    }
    if (stage >= STAGE_TOLD_KING_ROALD) {
      if (held(player, GOLDEN_KEY_ITEM_ID)) {
        if (!held(player, BLESSED_WATER_ITEM_ID)) {
          player.getInventory().adds(BLESSED_WATER_ITEM_ID, 1);
          player.sendMessage("Drezel blesses some water for you.");
        }
        quest.setStage(player, STAGE_VAMPYRE_SEALED);
        return "saving-drezel-and-the-world-talking-to-drezel-with-the-golden-key";
      }
      return "saving-drezel-and-the-world-talking-to-drezel-again";
    }
    quest.setStage(player, STAGE_MET_DREZEL);
    return "saving-drezel-and-the-world-meeting-drezel";
  }

  /** Which transcript variant the speaker plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (KING_ROALD_NPC_IDS.has(npcId)) return kingRoaldVariant(stage, player);
    if (npcId === DREZEL_NPC_ID) return drezelVariant(stage, player);
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("attempts to use magic spells on the guardian")) return true;
    if (value.includes("has murky water")) return false;
    if (value.includes("doesn't have murky water")) return true;
    if (value.includes("first time blessing water")) return stage < STAGE_VAMPYRE_SEALED;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!KING_ROALD_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The transcript's "Quest complete!" action consumes the essence and finishes. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== DREZEL_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) >= STAGE_VAMPYRE_SEALED && !quest.isComplete(player)) {
      takeEssence(player);
      quest.complete(player);
    }
  }

  /** Killing the temple guardian advances the quest. */
  function handleGuardianDeath({ player, npcId }) {
    if (npcId !== TEMPLE_GUARDIAN_NPC_ID) return;
    if (quest.getStage(player) < STAGE_GUARDIAN_KILLED) {
      quest.setStage(player, STAGE_GUARDIAN_KILLED);
    }
  }

  /** The Zamorakian monks are not indexed, so replay their line and hand over the key. */
  function handleMonkInteraction(event) {
    if (!MONKS_OF_ZAMORAK_NPC_IDS.has(event.npcId)) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_GUARDIAN_KILLED) return;
    event.handled = true;
    if (!held(player, GOLDEN_KEY_ITEM_ID)) {
      player.getInventory().adds(GOLDEN_KEY_ITEM_ID, 1);
      player.sendMessage("The monk hands you a golden key.");
    }
    startTranscript(
      api, player, event.npcId, PAGE, "you-killed-a-dog-letting-the-monks-know-you-did-the-deed"
    );
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "priest_in_peril",
    name: "Priest in Peril",
    varpId: VARP_PRIEST_IN_PERIL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 1406, label: "Prayer" }],
    rewardItemId: ItemIdentifiers.WOLFBANE,
    rewardItemLabel: "Wolfbane dagger",
    otherRewards: ["Access to Morytania"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleGuardianDeath);
  api.onNpcInteraction(handleMonkInteraction);
  api.onPlayerLogin(handleLogin);
};
