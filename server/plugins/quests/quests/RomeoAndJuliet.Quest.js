/**
 * Romeo & Juliet.
 *
 * Words come from data/definitions/npc-dialogues.json. The quest's "Romeo &
 * Juliet" page mixes every NPC, so the branch is selected by the clicked cache
 * id plus the quest stage:
 *
 *   Romeo 5037:
 *     stage 0      -> "starting-out-talking-to-romeo"          (start hook)
 *     stage 10, 30 -> "starting-out-talking-to-romeo-again"
 *     stage 20     -> "delivering-the-message-talking-to-romeo" (hand in message)
 *     stage 40     -> "finding-father-lawrence-talking-to-romeo-after-father-lawrence"
 *     stage 50     -> "making-the-cadava-potion-talking-to-romeo"
 *     stage 60     -> "rescuing-juliet-talking-to-romeo"        (complete)
 *     complete     -> "Romeo" / "standard"
 *
 *   Juliet 5035:
 *     stage 0      -> "Juliet" / "standard-dialogue-before-romeo-juliet"
 *     stage 10     -> "finding-juliet-talking-to-juliet"        (gives message)
 *     stage 20     -> "finding-juliet-talking-to-juliet-again"  (copy / loss)
 *     stage 30     -> "delivering-the-message-talking-to-juliet"
 *     stage 40     -> "finding-father-lawrence-talking-to-juliet-after-father-lawrence"
 *     stage 50     -> "delivering-the-potion-talking-to-juliet" (hand in potion)
 *     stage 60+    -> "Juliet" / "standard-dialogue-after-romeo-juliet"
 *
 *   Father Lawrence 5038:
 *     stage 0      -> "Father Lawrence" / "standard-dialogue"    (offer)
 *     stage 10/20/30 -> "finding-father-lawrence-talking-to-father-lawrence"
 *                       (advances to stage 40 only from stage 30)
 *     stage 40     -> "finding-father-lawrence-talking-to-father-lawrence-again"
 *     stage 50     -> "making-the-cadava-potion-talking-to-father-lawrence"
 *     stage 60+    -> "Father Lawrence" / "standard-dialogue"    (post-quest)
 *
 *   Apothecary 5036:
 *     stage < 40   -> "Apothecary" / "standard-dialogue"
 *     stage 40     -> "making-the-cadava-potion-talking-to-the-apothecary"
 *     stage 50+    -> "making-the-cadava-potion-talking-to-the-apothecary-again"
 *
 * This plugin supplies the variant selector, the prose-condition answers, the
 * start hook, the item hand-ins and picking Cadava berries from the bushes.
 *
 * Gaps (see summary): no dump variant for Romeo/Juliet at some stages; Juliet
 * id 6268 has no transcript index so it always plays the generic "Juliet" page;
 * the potion look-at/drink item actions are not in the quest transcript.
 */
module.exports = function registerRomeoAndJulietQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const ROMEO_NPC_ID = NpcIdentifiers.ROMEO;
  /** Alternate Juliet cache id; no generated NpcIdentifiers member (see summary). */
  const JULIET_ALT_NPC_ID = 6268;
  const JULIET_NPC_IDS = new Set([JULIET_ALT_NPC_ID, NpcIdentifiers.JULIET]);
  const FATHER_LAWRENCE_NPC_ID = NpcIdentifiers.FATHER_LAWRENCE;
  const APOTHECARY_NPC_ID = NpcIdentifiers.APOTHECARY;

  const QUEST_NPC_IDS = new Set([
    ROMEO_NPC_ID,
    FATHER_LAWRENCE_NPC_ID,
    APOTHECARY_NPC_ID,
    ...JULIET_NPC_IDS,
  ]);

  const VARP_ROMEO_AND_JULIET = 144;
  const STAGE_SPOKEN_TO_ROMEO = 10;
  const STAGE_SPOKEN_TO_JULIET = 20;
  const STAGE_PASSED_MESSAGE = 30;
  const STAGE_SPOKEN_TO_FATHER_LAWRENCE = 40;
  const STAGE_SPOKEN_TO_APOTHECARY = 50;
  const STAGE_JULIET_IN_CRYPT = 60;
  const STAGE_COMPLETE = 100;

  const CADAVA_BERRIES_ITEM_ID = ItemIdentifiers.CADAVA_BERRIES;
  const JULIETS_MESSAGE_ITEM_ID = ItemIdentifiers.MESSAGE;
  const CADAVA_POTION_ITEM_ID = ItemIdentifiers.CADAVA_POTION;

  const CADAVA_BUSH_LOC_IDS = new Set([
    ObjectIdentifiers.CADAVA_BUSH,
    ObjectIdentifiers.CADAVA_BUSH_2,
    ObjectIdentifiers.CADAVA_BUSH_3,
  ]);

  /** Message step ids from the "Romeo & Juliet" transcript. */
  const JULIET_GIVES_MESSAGE = "2xqCe8";
  const JULIET_GIVES_ANOTHER_MESSAGE = "KmL5hw";
  const ROMEO_TAKES_MESSAGE = "azqQuD";
  const APOTHECARY_TAKES_BERRIES = "3oxHI6";
  const APOTHECARY_GIVES_POTION = "eeTqTE";
  const APOTHECARY_TAKES_BERRIES_AGAIN = "Be9l32";
  const APOTHECARY_GIVES_POTION_AGAIN = "Cw477j";
  const JULIET_TAKES_POTION = "9YlDKS";
  const ROMEO_QUEST_COMPLETE = "PO2Wli";

  /** Final player line of the Father Lawrence sermon, which ends the audience. */
  const FATHER_SERMON_LAST_LINE = "strong overtones of death";

  const RJ = (variant) => ({ page: "Romeo & Juliet", variant });
  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  let quest;

  function romeoVariant(stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Romeo" };
    if (stage >= STAGE_JULIET_IN_CRYPT) return RJ("rescuing-juliet-talking-to-romeo");
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) return RJ("making-the-cadava-potion-talking-to-romeo");
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("finding-father-lawrence-talking-to-romeo-after-father-lawrence");
    }
    if (stage === STAGE_SPOKEN_TO_JULIET) return RJ("delivering-the-message-talking-to-romeo");
    if (stage >= STAGE_SPOKEN_TO_ROMEO) return RJ("starting-out-talking-to-romeo-again");
    return RJ("starting-out-talking-to-romeo");
  }

  function julietVariant(stage) {
    if (stage >= STAGE_JULIET_IN_CRYPT) {
      return { page: "Juliet", variant: "standard-dialogue-after-romeo-juliet" };
    }
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) return RJ("delivering-the-potion-talking-to-juliet");
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("finding-father-lawrence-talking-to-juliet-after-father-lawrence");
    }
    if (stage >= STAGE_PASSED_MESSAGE) return RJ("delivering-the-message-talking-to-juliet");
    if (stage >= STAGE_SPOKEN_TO_JULIET) return RJ("finding-juliet-talking-to-juliet-again");
    if (stage >= STAGE_SPOKEN_TO_ROMEO) return RJ("finding-juliet-talking-to-juliet");
    return { page: "Juliet", variant: "standard-dialogue-before-romeo-juliet" };
  }

  function fatherVariant(stage) {
    if (stage >= STAGE_JULIET_IN_CRYPT) {
      return { page: "Father Lawrence", variant: "standard-dialogue" };
    }
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) {
      return RJ("making-the-cadava-potion-talking-to-father-lawrence");
    }
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("finding-father-lawrence-talking-to-father-lawrence-again");
    }
    if (stage >= STAGE_SPOKEN_TO_ROMEO) {
      return RJ("finding-father-lawrence-talking-to-father-lawrence");
    }
    return { page: "Father Lawrence", variant: "standard-dialogue" };
  }

  function apothecaryVariant(stage) {
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) {
      return RJ("making-the-cadava-potion-talking-to-the-apothecary-again");
    }
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("making-the-cadava-potion-talking-to-the-apothecary");
    }
    return { page: "Apothecary", variant: "standard-dialogue" };
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const romeoLines = [
      "<str>I agreed to find Juliet for Romeo and tell her how</str>",
      "<str>he feels.</str>",
    ];
    const julietLines = [
      "<str>I found Juliet west of Varrock. She gave me a</str>",
      "<str>message to take back to Romeo.</str>",
    ];
    const fatherLines = [
      "<str>Father Lawrence suggested a potion that would make</str>",
      "<str>Juliet appear dead so Romeo could rescue her.</str>",
    ];

    if (stage >= STAGE_COMPLETE) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "<str>I delivered the Cadava potion and told Romeo the plan.</str>",
        "<str>He did not understand it, but rewarded me anyway.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_JULIET_IN_CRYPT) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "<str>I delivered the Cadava potion to Juliet.</str>",
        "I must tell <col=800000>Romeo</col> what has happened.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) {
      const carriedPotion = held(player, CADAVA_POTION_ITEM_ID);
      const carriedBerries = held(player, CADAVA_BERRIES_ITEM_ID);
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "<str>The Apothecary agreed to make a Cadava potion.</str>",
        carriedPotion
          ? "I should take the <col=800000>Cadava potion</col> to <col=800000>Juliet</col>."
          : carriedBerries
            ? "I should take these <col=800000>Cadava berries</col> to the <col=800000>Apothecary</col>."
            : "I need to find some <col=800000>Cadava berries</col>.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "I need to find the <col=800000>Apothecary</col> and ask him",
        "to make a <col=800000>Cadava potion</col>.",
      ];
    }
    if (stage >= STAGE_PASSED_MESSAGE) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "<str>I delivered Juliet's message to Romeo.</str>",
        "I should find <col=800000>Father Lawrence</col> and ask for help.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_JULIET) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        held(player, JULIETS_MESSAGE_ITEM_ID)
          ? "I should take <col=800000>Juliet's message</col> to <col=800000>Romeo</col>."
          : "I should ask <col=800000>Juliet</col> for another copy of her message.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_ROMEO) {
      return [
        ...romeoLines,
        "",
        "I should speak to <col=800000>Juliet</col>, west of <col=800000>Varrock</col>.",
      ];
    }
    return [
      "I can start this quest by talking to",
      "<col=800000>Romeo</col> in <col=800000>Varrock Square</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === ROMEO_NPC_ID) return romeoVariant(stage);
    if (JULIET_NPC_IDS.has(npcId)) return julietVariant(stage);
    if (npcId === FATHER_LAWRENCE_NPC_ID) return fatherVariant(stage);
    if (npcId === APOTHECARY_NPC_ID) return apothecaryVariant(stage);
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);

    if (npcId === ROMEO_NPC_ID) {
      if (value.includes("nearby romeo")) return true;
      if (value.includes("has not started romeo & juliet")) return stage < STAGE_SPOKEN_TO_ROMEO;
      if (value.includes("has completed romeo & juliet")) return stage >= STAGE_COMPLETE;
      if (value.includes("does not have juliet's message")) return !held(player, JULIETS_MESSAGE_ITEM_ID);
      if (value.includes("has juliet's message")) return held(player, JULIETS_MESSAGE_ITEM_ID);
      if (value.includes("not carrying a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("is carrying a cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      return null;
    }

    if (JULIET_NPC_IDS.has(npcId)) {
      if (value.includes("still has the message")) return held(player, JULIETS_MESSAGE_ITEM_ID);
      if (value.includes("lost the message")) return !held(player, JULIETS_MESSAGE_ITEM_ID);
      if (value.includes("doesn't have a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("has a cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      return null;
    }

    if (npcId === FATHER_LAWRENCE_NPC_ID) {
      if (value.includes("has not made a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("not carrying a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("is carrying a cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("has not started romeo & juliet")) return stage < STAGE_SPOKEN_TO_ROMEO;
      if (value.includes("has started romeo & juliet and talked to juliet")) {
        // Pre-potion only: once Juliet has the potion the post-quest branch wins.
        return stage >= STAGE_SPOKEN_TO_JULIET && stage < STAGE_JULIET_IN_CRYPT;
      }
      if (value.includes("has given a cadava potion to juliet")) return stage >= STAGE_JULIET_IN_CRYPT;
      return null;
    }

    if (npcId === APOTHECARY_NPC_ID) {
      if (value.includes("has not started romeo & juliet")) return stage < STAGE_SPOKEN_TO_ROMEO;
      if (value.includes("has completed romeo & juliet")) return stage >= STAGE_COMPLETE;
      if (value.includes("does not have cadava berries")) return !held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("has cadava berries")) return held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("without any cadava berries")) return !held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("with some cadava berries")) return held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("with the cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("after giving juliet the cadava potion")) {
        return stage >= STAGE_JULIET_IN_CRYPT;
      }
      if (value.includes("combat path voucher and hasn't received all possible rewards")) return false;
      if (value.includes("isn't carrying a combat path voucher")) return true;
      return null;
    }

    return null;
  }

  // "Yes." on "Start the Romeo & Juliet quest?" carries this slug.
  function handleStartHook({ player, npcId, hook }) {
    if (!QUEST_NPC_IDS.has(npcId) || hook !== "quest:romeo-juliet:start") return;
    if (quest.getStage(player) >= STAGE_SPOKEN_TO_ROMEO) return;
    quest.setStage(player, STAGE_SPOKEN_TO_ROMEO);
  }

  // Father Lawrence's sermon ends with a player line and carries no action id;
  // advance to the Apothecary step only when the player reached him properly.
  function handleSermonLine({ player, npcId, text }) {
    if (npcId !== FATHER_LAWRENCE_NPC_ID) return;
    if (quest.getStage(player) !== STAGE_PASSED_MESSAGE) return;
    if (String(text).includes(FATHER_SERMON_LAST_LINE)) {
      quest.setStage(player, STAGE_SPOKEN_TO_FATHER_LAWRENCE);
    }
  }

  function handleDialogueAction(event) {
    if (!QUEST_NPC_IDS.has(event.npcId)) return;
    const { player, stepId } = event;

    // Multi-NPC transcripts voice only the clicked NPC; a `line` from anyone
    // else has no speaker binding and would abort the branch. Skip it.
    if (event.step?.type === "line") {
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === JULIET_GIVES_MESSAGE || stepId === JULIET_GIVES_ANOTHER_MESSAGE) {
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory space before Juliet can give you the message.");
      } else {
        player.getInventory().adds(JULIETS_MESSAGE_ITEM_ID, 1);
        if (event.text) player.sendMessage(String(event.text));
        if (quest.getStage(player) < STAGE_SPOKEN_TO_JULIET) {
          quest.setStage(player, STAGE_SPOKEN_TO_JULIET);
        }
      }
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === ROMEO_TAKES_MESSAGE) {
      if (!held(player, JULIETS_MESSAGE_ITEM_ID)) return;
      player.getInventory().deleteNumber(JULIETS_MESSAGE_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_PASSED_MESSAGE) {
        quest.setStage(player, STAGE_PASSED_MESSAGE);
      }
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === APOTHECARY_TAKES_BERRIES || stepId === APOTHECARY_TAKES_BERRIES_AGAIN) {
      if (!held(player, CADAVA_BERRIES_ITEM_ID)) return;
      player.getInventory().deleteNumber(CADAVA_BERRIES_ITEM_ID, 1);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === APOTHECARY_GIVES_POTION || stepId === APOTHECARY_GIVES_POTION_AGAIN) {
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory space for the Cadava potion.");
      } else {
        player.getInventory().adds(CADAVA_POTION_ITEM_ID, 1);
        if (event.text) player.sendMessage(String(event.text));
        if (quest.getStage(player) < STAGE_SPOKEN_TO_APOTHECARY) {
          quest.setStage(player, STAGE_SPOKEN_TO_APOTHECARY);
        }
      }
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === JULIET_TAKES_POTION) {
      if (!held(player, CADAVA_POTION_ITEM_ID)) return;
      player.getInventory().deleteNumber(CADAVA_POTION_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_JULIET_IN_CRYPT) {
        quest.setStage(player, STAGE_JULIET_IN_CRYPT);
      }
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === ROMEO_QUEST_COMPLETE) {
      if (quest.getStage(player) >= STAGE_JULIET_IN_CRYPT && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
    }
  }

  // Pick Cadava berries from the bushes (reference locs 23625-23627).
  function pickCadavaBerries(event) {
    if (!CADAVA_BUSH_LOC_IDS.has(event.objectId)) return;
    const action = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (action !== "pick-from") return;
    event.handled = true;
    if (event.player.getInventory().isFull()) {
      event.player.sendMessage("You do not have room for any Cadava berries.");
      return;
    }
    event.player.getInventory().adds(CADAVA_BERRIES_ITEM_ID, 1);
    event.player.sendMessage("You pick some Cadava berries.");
  }

  quest = registerQuest(api, {
    key: "romeo_and_juliet",
    name: "Romeo & Juliet",
    varpId: VARP_ROMEO_AND_JULIET,
    startedValue: STAGE_SPOKEN_TO_ROMEO,
    completionValue: STAGE_COMPLETE,
    questPoints: 5,
    xpRewards: [],
    scrollItemId: CADAVA_POTION_ITEM_ID,
    rewardItemLabel: "Cadava potion",
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleSermonLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onObjectInteraction(pickCadavaBerries);
};
