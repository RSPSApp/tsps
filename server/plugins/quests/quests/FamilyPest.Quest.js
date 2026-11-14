/**
 * Family Pest (members miniquest, 2016, cache revision 242 quest row 140, no quest points).
 *
 * Sources: the OSRS Wiki quest page and Transcript:Family Pest (raw wikitext, sha256 in
 * docs/quests/family-pest/README.md), the generated npc-dialogues export for the post-miniquest
 * conversations (the four NPCs' "standard dialogue after completing Family Pest" variants), the
 * revision 242 cache, and RSProx capture 1702 (revision 226): its menus show the quest option is
 * literally "Family Pest", next to "Gauntlets" (Avan, Caleb, Johnathon) or "Other" (Dimintheis).
 *
 * Cache facts: quest row 140 (`miniquest_familypest`), start NPC Dimintheis (4984), completion
 * value 3, requirement Family Crest; the stage is varbit `family_quest_progress` (5347) of varp
 * `family_quest_varp` (1418), with `family_quest_caleb` / `_avan` / `_johnathon` (5348-5350) set
 * when each brother has been spoken to. The values between "started" and "complete" are not
 * named by the cache: 1 = Dimintheis spoke (go and see his sons), 2 = all three sons spoken to
 * (return to Dimintheis), 3 = complete.
 *
 * The quest conversations are in plugins/quests/data/family-pest.json, transcribed from the
 * Wiki, and played through the shared transcript player. The "Other" / "Gauntlets" menu entries
 * play the existing standard conversations (the same branch the Family Crest plugin plays), so
 * those branches start where the standard conversation's own menu does.
 *
 * Registered before Family Crest on purpose: dialogue variant hooks run in registration order,
 * and Family Crest answers every Dimintheis and brother conversation once its quest is done.
 */
module.exports = function registerFamilyPestQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questNamed } = require("../QuestRuntime");
  const DATA = require("../data/family-pest.json");

  const STAGE_VARBIT = 5347; // family_quest_progress
  const FLAG_VARBITS = { caleb: 5348, avan: 5349, johnathon: 5350 };
  const STAGE_STARTED = 1;
  const STAGE_ALL_TALKED = 2;
  const STAGE_COMPLETE = 3;

  const PAYMENT = 500000;
  const TALKED_ATTRIBUTE = "family-pest:talked";
  const RETURN_SEEN_ATTRIBUTE = "family-pest:return-seen";
  const RECEIVED_ATTRIBUTE = "family-pest:gauntlets-received";
  const START_MESSAGE = "You've started a new quest: <col=081190>Family Pest</col>";
  const START_STEP_ID = "jjabGL"; // "You smell the sweet smell of the great rewards that may soon come."
  const CARRIER_VARIANT = "standard-dialogue-after-completing-family-crest";
  const POST_VARIANT = "standard-dialogue-after-completing-family-pest";

  // Dimintheis and his sons, as Family Crest identifies them (Avan is the cache's "Man" 385 too).
  const NPCS = {
    dimintheis: { page: "Dimintheis", ids: new Set([NpcIdentifiers.DIMINTHEIS, NpcIdentifiers.DIMINTHEIS_2]) },
    avan: { page: "Avan", ids: new Set([NpcIdentifiers.MAN, NpcIdentifiers.AVAN, NpcIdentifiers.AVAN_2]) },
    caleb: { page: "Caleb", ids: new Set([NpcIdentifiers.CALEB, NpcIdentifiers.CALEB_2]) },
    johnathon: { page: "Johnathon", ids: new Set([NpcIdentifiers.JOHNATHON, NpcIdentifiers.JOHNATHON_2]) },
  };
  const BROTHERS = ["avan", "caleb", "johnathon"];
  const GAUNTLETS = {
    avan: ItemIdentifiers.GOLDSMITH_GAUNTLETS,
    caleb: ItemIdentifiers.COOKING_GAUNTLETS,
    johnathon: ItemIdentifiers.CHAOS_GAUNTLETS,
    dimintheis: ItemIdentifiers.STEEL_GAUNTLETS,
  };
  // The generated post-miniquest steps: the first visit's hand-out and each repeat visit's quantity prompt.
  const FIRST_GAUNTLETS_STEP = { gqV59f: "avan", Jsoiaj: "caleb", eNdtqa: "johnathon" };
  const QUANTITY_STEP = { _HKMDY: "dimintheis", LC9cAS: "avan", jTJ19x: "caleb", IHabIj: "johnathon" };
  const GAUNTLET_NAMES = { dimintheis: "steel", avan: "goldsmith", caleb: "cooking", johnathon: "chaos" };
  const HAND_OUT_TEXT = {
    dimintheis: "Dimintheis hands you some steel gauntlets.",
    avan: "Avan hands you some goldsmith gauntlets.",
    caleb: "Caleb hands you some cooking gauntlets.",
    johnathon: "Johnathon hands you some chaos gauntlets.",
  };

  let quest;

  const whoIs = (npcId) => Object.keys(NPCS).find((key) => NPCS[key].ids.has(npcId)) ?? null;
  const stageOf = (player) => quest.getStage(player);

  const objectAttribute = (player, key) => {
    const value = player.getAttribute(key);
    return value && typeof value === "object" ? value : {};
  };
  const talked = (player) => objectAttribute(player, TALKED_ATTRIBUTE);
  const allTalked = (player) => BROTHERS.every((name) => talked(player)[name] === true);
  const isLastBrother = (player, name) => BROTHERS.filter((other) => other !== name).every((other) => talked(player)[other] === true);

  function sendFlags(player) {
    const sender = player.getPacketSender();
    for (const [name, varbit] of Object.entries(FLAG_VARBITS)) sender.sendVarbit(varbit, talked(player)[name] === true ? 1 : 0);
  }

  function markTalked(player, name) {
    if (talked(player)[name] === true) return;
    player.setAttribute(TALKED_ATTRIBUTE, { ...talked(player), [name]: true });
    sendFlags(player);
    if (stageOf(player) === STAGE_STARTED && allTalked(player)) quest.setStage(player, STAGE_ALL_TALKED);
  }

  // --- conversations --------------------------------------------------------------------------

  /** The generated "standard dialogue" of an NPC, as the carrier the transcript player needs. */
  const carrier = (key) => [NPCS[key].page, CARRIER_VARIANT];

  /** Steps of the standard conversation that the "Other" (Dimintheis) or "Gauntlets" (his sons) menu entry leads to. */
  function standardBranch(raw, key) {
    const wanted = key === "dimintheis" ? "Other" : "Can you change my gauntlets for me?";
    const menu = raw.find((step) => step?.type === "choice" && step.options?.some((option) => option.text === wanted));
    return menu?.options.find((option) => option.text === wanted)?.steps ?? [];
  }

  /** The quest menu: "Family Pest" and the NPC's own entry, with the conversation the stage and history call for. */
  function questMenu(key, player) {
    const seen = talked(player)[key] === true;
    if (key === "dimintheis") {
      const returning = allTalked(player);
      const steps = !returning ? DATA["dimintheis-again"]
        : player.getAttribute(RETURN_SEEN_ATTRIBUTE) === true ? DATA["dimintheis-return-again"] : DATA["dimintheis-return"];
      return { steps, label: "Other" };
    }
    return { steps: DATA[seen ? `${key}-again` : key], label: "Gauntlets" };
  }

  function startQuestConversation(player, npcId, key) {
    const { steps, label } = questMenu(key, player);
    const [page, variant] = carrier(key);
    return startTranscript(api, player, npcId, page, variant, (raw) => [{
      type: "choice",
      options: [
        { text: "Family Pest", steps },
        { text: label, steps: standardBranch(raw, key) },
      ],
    }]);
  }

  function talkTo(event) {
    const { player, npcId } = event;
    const key = whoIs(npcId);
    if (!key || quest.isComplete(player) || stageOf(player) < STAGE_STARTED) return;
    if (event.definition?.getActions?.()?.[event.clickType - 1] !== "Talk-to") return;
    if (startQuestConversation(player, npcId, key)) event.handled = true;
  }

  /** Once the miniquest is done, the generated post-miniquest conversation is the NPC's own. */
  function selectVariant({ npcId, player }) {
    const key = whoIs(npcId);
    if (!key || !quest.isComplete(player)) return null;
    return { page: NPCS[key].page, variant: POST_VARIANT };
  }

  // --- dialogue hooks -------------------------------------------------------------------------

  function answerCondition({ npcId, player, text }) {
    const key = whoIs(npcId);
    if (!key) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have enough coins")) return player.getInventory().getAmount(ItemIdentifiers.COINS) < PAYMENT;
    if (value.includes("is not the last brother")) return !isLastBrother(player, key);
    if (value.includes("is the last brother")) return isLastBrother(player, key);
    if (value.includes("first time the player has talked to")) return objectAttribute(player, RECEIVED_ATTRIBUTE)[key] !== true;
    if (value.includes("already talked to") && value.includes("after completing family pest")) return objectAttribute(player, RECEIVED_ATTRIBUTE)[key] === true;
    return null;
  }

  function give(player, itemId, amount) {
    if (amount > 0) player.getInventory().forceAdd(player, new api.core.Item(itemId, amount));
  }

  function receivedFirst(player, key) {
    player.setAttribute(RECEIVED_ATTRIBUTE, { ...objectAttribute(player, RECEIVED_ATTRIBUTE), [key]: true });
  }

  /** A repeat visit's "How many would you like to take?": the prompt, then that many pairs. */
  function askQuantity(player, key) {
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to take?");
    player.setEnteredAmountAction({
      execute: (answer) => {
        const amount = Math.max(0, Math.trunc(Number(answer)));
        if (!amount || !quest.isComplete(player)) return;
        give(player, GAUNTLETS[key], amount);
        player.sendMessage(HAND_OUT_TEXT[key]);
      },
    });
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    const key = whoIs(npcId);
    if (!key) return;
    if (stepId === START_STEP_ID && key === "dimintheis") {
      if (stageOf(player) === 0 && questNamed?.("Family Crest")?.isComplete?.(player) !== false) {
        quest.setStage(player, STAGE_STARTED);
        player.sendMessage(START_MESSAGE);
      }
      return;
    }
    if (event.step?.type === "input" && QUANTITY_STEP[stepId] === key && quest.isComplete(player)) {
      // The engine closes the chatbox when it ends this branch, which would take the prompt with it: ask a tick later.
      api.core.TaskManager.submit(new api.core.CountdownTask(player, 1, () => askQuantity(player, key)));
      event.handled = true;
      event.end = true;
      return;
    }
    if (event.kind !== "message") return;
    if (FIRST_GAUNTLETS_STEP[stepId] === key && quest.isComplete(player)) {
      give(player, GAUNTLETS[key], 1);
      receivedFirst(player, key);
      event.box = { items: [GAUNTLETS[key]] };
      return;
    }
    if (typeof stepId !== "string" || !stepId.startsWith("fp:")) return;
    const id = stepId.slice(3);
    event.box = { statement: true };
    if (id === "pay") {
      event.box = { items: [ItemIdentifiers.COINS] };
      event.after = () => {
        const inventory = player.getInventory();
        if (stageOf(player) !== STAGE_ALL_TALKED || inventory.getAmount(ItemIdentifiers.COINS) < PAYMENT) return;
        inventory.deleteNumber(ItemIdentifiers.COINS, PAYMENT);
        quest.complete(player);
      };
    } else if (id.endsWith("-fade") || id.endsWith("-faded")) {
      markTalked(player, id.split("-")[0]);
    } else if (id === "distant") {
      player.setAttribute(RETURN_SEEN_ATTRIBUTE, true);
    }
  }

  // --- journal --------------------------------------------------------------------------------

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>Dimintheis's sons had nothing for me, so he asked for 500,000 coins.</str>", "<str>I paid him.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_ALL_TALKED) {
      return ["<str>I spoke to Avan, Caleb and Johnathon, and none of them need anything.</str>", "", "I should tell <col=800000>Dimintheis</col>."];
    }
    if (stage >= STAGE_STARTED) {
      const left = BROTHERS.filter((name) => talked(player)[name] !== true).map((name) => `<col=800000>${name[0].toUpperCase()}${name.slice(1)}</col>`);
      return ["Dimintheis suggested I ask his sons if they need help.", "", `I still need to speak to ${left.join(", ")}.`];
    }
    return ["I can start this quest by speaking to <col=800000>Dimintheis</col> in south-east", "<col=800000>Varrock</col>.", "", "I need to have completed <col=800000>Family Crest</col>."];
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendFlags(player); // after the list: it resends the stage, which must not undo the flags
  }

  quest = registerQuest(api, {
    key: "family_pest",
    name: "Family Pest",
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    otherRewards: ["Unlimited steel, goldsmith, cooking and chaos gauntlets from Dimintheis and his sons"],
    buildJournal,
  });

  api.persistAttribute(TALKED_ATTRIBUTE, {});
  api.persistAttribute(RETURN_SEEN_ATTRIBUTE, false);
  api.persistAttribute(RECEIVED_ATTRIBUTE, {});

  api.onBeforeNpcInteraction(talkTo);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
