/**
 * Family Pest (members miniquest, cache quest row 140, no quest points).
 *
 * Built against a whole run of the miniquest on live, revision 242: the user's RSProx capture
 * `FamilyCrest + FamilyPest.bin` (local recording 1002252, ticks 3041-6221). The words are the
 * generated "Family Pest" transcript and the Dimintheis, Avan, Caleb and Johnathon NPC transcripts,
 * with the capture's wording laid over the Wiki in osrsreboxed-db's capture-sources.json.
 * docs/quests/family-pest/README.md lists the facts this plugin relies on.
 *
 * The stage is varbit `family_quest_progress` (5347) of varp `family_quest_varp` (1418);
 * `family_quest_caleb` / `_avan` / `_johnathon` (5348-5350) mark each son asked. As live sends them:
 *   1  continuing "Oh come on, surely there's something I can help out with!..." (3074), no message
 *   son flags: as the son's last line is continued, before the player's answer (Johnathon 3231,
 *      Avan 3348, Caleb 3511)
 *   2  continuing Dimintheis's "Slow down. I haven't told you what it is yet!" (3811)
 *   3  "Yes" on "Hand Dimintheis 500,000 coins?" (3837): the coins go on the pick; no message,
 *      jingle or scroll, only the miniquest count
 *
 * While the miniquest is under way Dimintheis offers "Family Pest" and "Other", his sons "Family
 * Pest" and "Gauntlets" (3204, 3340, 3502, 3795); "Other" and "Gauntlets" are Family Crest's
 * after-quest talks. Registered before Family Crest: dialogue variant hooks run in registration
 * order.
 */
module.exports = function registerFamilyPestQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questNamed } = require("../QuestRuntime");

  const PAGE = "Family Pest";
  const STAGE_VARBIT = 5347; // family_quest_progress
  const FLAG_VARBITS = { caleb: 5348, avan: 5349, johnathon: 5350 };
  const STAGE_STARTED = 1;
  const STAGE_ALL_TALKED = 2;
  const STAGE_COMPLETE = 3;

  const PAYMENT = 500000;
  const TALKED_ATTRIBUTE = "family-pest:talked";
  const CREST_VARIANT = "standard-dialogue-after-completing-family-crest";
  const POST_VARIANT = "standard-dialogue-after-completing-family-pest";

  const START_LINE = /^Okay okay\. Fine then\. Whilst I don't have anything for you/;
  const ASK_LINE = /^I need 500,000 coins\. Can you help me out with that\?/;
  const PAYMENT_PROMPT = "Hand Dimintheis 500,000 coins?";
  const QUANTITY_PROMPT = "How many would you like to take?";
  /** skillmulti_setup's first argument for the gauntlets' quantity menu (ticks 3853, 6028, 6129). */
  const QUANTITY_MENU_MODE = 23;
  /** The coin stack the hand-over box shows (objectbox obj coins_10000, tick 3837). */
  const COINS_BOX_ITEM = api.core.CacheDefinitions.getObjId("coins_10000");

  // Dimintheis and his sons, as Family Crest identifies them: the sons are multi-NPCs (Avan 4983, Caleb
  // 4986, Johnathon 4988) shown as their stage's form.
  const NPCS = {
    dimintheis: { page: "Dimintheis", ids: new Set([NpcIdentifiers.DIMINTHEIS, NpcIdentifiers.DIMINTHEIS_2]) },
    avan: { page: "Avan", ids: new Set([api.core.CacheDefinitions.getNpcId("avan"), NpcIdentifiers.MAN, NpcIdentifiers.AVAN, NpcIdentifiers.AVAN_2]) },
    caleb: { page: "Caleb", ids: new Set([api.core.CacheDefinitions.getNpcId("caleb_fitzharmon"), NpcIdentifiers.CALEB, NpcIdentifiers.CALEB_2]) },
    johnathon: { page: "Johnathon", ids: new Set([api.core.CacheDefinitions.getNpcId("johnathon_fitzharmon"), NpcIdentifiers.JOHNATHON, NpcIdentifiers.JOHNATHON_2]) },
  };
  const BROTHERS = ["avan", "caleb", "johnathon"];
  const GAUNTLETS = {
    avan: ItemIdentifiers.GOLDSMITH_GAUNTLETS,
    caleb: ItemIdentifiers.COOKING_GAUNTLETS,
    johnathon: ItemIdentifiers.CHAOS_GAUNTLETS,
    dimintheis: ItemIdentifiers.STEEL_GAUNTLETS,
  };
  const ORDINALS = ["first", "second", "last"];

  let quest;

  const whoIs = (npcId) => Object.keys(NPCS).find((key) => NPCS[key].ids.has(npcId)) ?? null;
  const stageOf = (player) => quest.getStage(player);
  const crestComplete = (player) => questNamed("Family Crest")?.isComplete(player) === true;

  const talked = (player) => {
    const value = player.getAttribute(TALKED_ATTRIBUTE);
    return value && typeof value === "object" ? value : {};
  };
  const talkedCount = (player) => BROTHERS.filter((name) => talked(player)[name] === true).length;
  const allTalked = (player) => talkedCount(player) === BROTHERS.length;

  function sendFlags(player) {
    const sender = player.getPacketSender();
    for (const [name, varbit] of Object.entries(FLAG_VARBITS)) sender.sendVarbit(varbit, talked(player)[name] === true ? 1 : 0);
  }

  function markTalked(player, name) {
    if (talked(player)[name] === true) return;
    player.setAttribute(TALKED_ATTRIBUTE, { ...talked(player), [name]: true });
    sendFlags(player);
  }

  const owns = (player, itemId) => player.getInventory().getAmount(itemId) > 0
    || player.getEquipment().getAmount?.(itemId) > 0
    || player.getBanks().some((bank) => (bank?.getAmount(itemId) ?? 0) > 0);

  // --- conversations --------------------------------------------------------------------------

  const transcripts = () => require("../QuestRuntime").loadTranscripts(api);
  const variantSteps = (pageName, variant) => transcripts()?.[pageName]?.variants?.[variant] ?? [];
  const optionSteps = (steps, text) => steps.find((step) => step?.type === "choice" && step.options?.some((option) => option.text === text))
    ?.options.find((option) => option.text === text)?.steps ?? [];

  /** Family Crest's after-quest talk the "Other" (Dimintheis) or "Gauntlets" (his sons) entry leads to. */
  function otherSteps(key, player) {
    if (key === "dimintheis") return optionSteps(variantSteps("Dimintheis", CREST_VARIANT), "Other");
    const name = NPCS[key].page;
    // Plain steel gauntlets get the free first imbue (Johnathon 3237, Avan 3353), any other pair the paid change (Caleb 3516).
    if (player.getInventory().getAmount(ItemIdentifiers.STEEL_GAUNTLETS) > 0) {
      return variantSteps("Family Crest", `post-quest-dialogue-talking-to-${name.toLowerCase()}-after-the-quest`);
    }
    return optionSteps(variantSteps(name, CREST_VARIANT), "Gauntlets");
  }

  /** The page's own steps with its second menu entry ("Other" / "Gauntlets", quest=No on the Wiki) filled in. */
  function withOther(key, player, fill = (steps) => steps) {
    return (raw) => raw.map((step, index) => index !== 0 || step.type !== "choice" ? step : {
      ...step,
      options: step.options.map((option, n) => n === 0 ? { ...option, steps: fill(option.steps ?? []) } : { ...option, steps: otherSteps(key, player) }),
    });
  }

  /**
   * The second ask plays as the first: "Yes" / "Refuse" do what they did then (the Wiki's {{tact|above}}), and the
   * coins check before the menu is the first ask's (the Wiki writes it there only).
   */
  function paymentAnswers(steps) {
    const first = variantSteps(PAGE, "returning-to-dimintheis-talking-to-dimintheis")[0]?.options?.[0]?.steps ?? [];
    const answers = first.find((step) => step.type === "choice" && step.prompt === PAYMENT_PROMPT)?.options ?? [];
    const check = first.find((step) => Array.isArray(step.steps) && step.steps.some((nested) => nested.type === "condition"));
    return steps.map((step) => {
      if (step.type === "choice" && step.prompt === PAYMENT_PROMPT) {
        return { ...step, options: step.options.map((option) => ({ ...option, steps: answers.find((answer) => answer.text === option.text)?.steps ?? option.steps })) };
      }
      if (check && !step.steps && step.text === check.text) return { ...step, steps: check.steps };
      return step;
    });
  }

  function questVariant(key, player) {
    if (key === "dimintheis") {
      if (stageOf(player) >= STAGE_ALL_TALKED) return "returning-to-dimintheis-talking-to-dimintheis-again-before-handing-out-the-money";
      return allTalked(player) ? "returning-to-dimintheis-talking-to-dimintheis" : "starting-out-talking-to-dimintheis-again";
    }
    return talked(player)[key] === true ? `${key}-talking-to-${key}-again` : `${key}-talking-to-${key}`;
  }

  const DEFENDER_DIMINTHEIS_STAGE = 48; // Defender of Varrock: "speak to Dimintheis" onwards
  function defenderNeedsDimintheis(player) {
    const defender = questNamed?.("Defender of Varrock");
    if (!defender) return false;
    return defender.getStage(player) >= DEFENDER_DIMINTHEIS_STAGE && !defender.isComplete(player);
  }

  function talkTo(event) {
    const { player, npcId } = event;
    const key = whoIs(npcId);
    if (!key || quest.isComplete(player) || stageOf(player) < STAGE_STARTED) return;
    if (event.definition?.getActions?.()?.[event.clickType - 1] !== "Talk-to") return;
    // Defender of Varrock's own Dimintheis conversations (and its cutscene) come first: they end that quest.
    if (key === "dimintheis" && defenderNeedsDimintheis(player)) return;
    const variant = questVariant(key, player);
    const select = withOther(key, player, variant.endsWith("before-handing-out-the-money") ? paymentAnswers : undefined);
    if (startTranscript(api, player, npcId, PAGE, variant, select, event.npc ?? null)) event.handled = true;
  }

  /** Once the miniquest is done, the NPC's own post-miniquest conversation. */
  function selectVariant({ npcId, player }) {
    const key = whoIs(npcId);
    if (!key || !quest.isComplete(player)) return null;
    return { page: NPCS[key].page, variant: POST_VARIANT };
  }

  // --- dialogue hooks -------------------------------------------------------------------------

  /**
   * Which son a player asks first, second or last decides the box after his talk (Johnathon first, 3232: "fades
   * slightly"; Avan second, 3349: "fades even more"; Caleb last, 3511-3512). After the miniquest a son hands out his
   * pairs straight away to a player without a pair of his (Johnathon 6028, Caleb 6129) and offers a menu to one who
   * has them (Avan 6212, the player holding goldsmith gauntlets): the cache keeps no flag for "talked to after the
   * miniquest", so this server reads the Wiki's "first time" / "already talked" as having a pair or not.
   */
  function answerCondition({ npcId, player, text }) {
    const key = whoIs(npcId);
    if (!key) return null;
    const value = String(text).toLowerCase();
    if (key === "dimintheis") {
      if (value === "if the player does not have enough coins:") return player.getInventory().getAmount(ItemIdentifiers.COINS) < PAYMENT;
      if (value === "if the player has completed defender of varrock:") return questNamed("Defender of Varrock")?.isComplete(player) === true;
      return null;
    }
    const others = BROTHERS.filter((name) => name !== key && talked(player)[name] === true).length;
    const ordinal = value.match(/^if \w+ is the (first|second|last) brother the player talks to:$/)?.[1];
    if (ordinal) return ORDINALS.indexOf(ordinal) === others;
    if (value.startsWith("if this is the first time the player has talked to")) return !owns(player, GAUNTLETS[key]);
    if (value.startsWith("if the player has already talked to") && value.includes("after completing family pest")) return owns(player, GAUNTLETS[key]);
    return null;
  }

  /** A son is marked asked as his first/second/last-brother answer is chosen (the flag varbit with it). */
  function handleCondition({ player, npcId, text }) {
    const key = whoIs(npcId);
    if (!key || key === "dimintheis" || stageOf(player) !== STAGE_STARTED) return;
    if (!/^if \w+ is the (first|second|last) brother the player talks to:$/i.test(String(text))) return;
    markTalked(player, key);
  }

  function handleLine(event) {
    const { player, npcId } = event;
    if (whoIs(npcId) !== "dimintheis" || typeof event.step?.player === "string") return;
    const text = String(event.text ?? "");
    const previous = event.before;
    if (START_LINE.test(text) && stageOf(player) === 0) {
      event.before = () => {
        previous?.();
        if (stageOf(player) === 0 && crestComplete(player)) quest.setStage(player, STAGE_STARTED);
      };
    } else if (ASK_LINE.test(text) && stageOf(player) === STAGE_STARTED) {
      event.before = () => {
        previous?.();
        if (stageOf(player) === STAGE_STARTED && allTalked(player)) quest.setStage(player, STAGE_ALL_TALKED);
      };
    }
  }

  /** "Yes" hands the coins over on the pick, and that completes the miniquest (3837). */
  function handleChoice(event) {
    const { player, npcId, option, prompt } = event;
    if (whoIs(npcId) !== "dimintheis" || prompt !== PAYMENT_PROMPT || option !== "Yes") return;
    const inventory = player.getInventory();
    if (stageOf(player) !== STAGE_ALL_TALKED) return;
    // Ours: the coins gone while the menu stood open; nothing is handed over.
    if (inventory.getAmount(ItemIdentifiers.COINS) < PAYMENT) {
      event.end = true;
      return;
    }
    inventory.deleteNumber(ItemIdentifiers.COINS, PAYMENT);
    quest.complete(player, { scroll: false, announce: false });
    refreshQuestList(player);
  }

  /**
   * "How many would you like to take?": the skillmulti menu (mode 23, as many as the backpack has room for,
   * 1 preselected; 3853, 6028, 6129). The pairs come with the pick, then the box and the rest of the talk.
   */
  function askQuantity(event, key) {
    const { player } = event;
    const itemId = GAUNTLETS[key];
    // Ours: no recording asks with a full backpack; the talk ends there.
    if ((player.getInventory().getFreeSlots?.() ?? 0) <= 0) {
      event.handled = true;
      event.end = true;
      return;
    }
    event.wait = (resume) => {
      const free = player.getInventory().getFreeSlots?.() ?? 0;
      player.getPacketSender().sendCreationMenu(new api.core.CreationMenu(QUANTITY_PROMPT, [itemId], {
        execute: (_chosen, amount) => {
          if (!quest.isComplete(player)) return;
          const count = Math.min(player.getInventory().getFreeSlots?.() ?? 0, Math.max(0, Math.trunc(Number(amount)) || 0));
          if (!count) return;
          player.getInventory().forceAdd(player, new api.core.Item(itemId, count));
          resume();
        },
      }, { mode: QUANTITY_MENU_MODE, maxAmount: free, lastAmount: 1 }));
    };
  }

  function handleAction(event) {
    const key = whoIs(event.npcId);
    if (!key) return;
    if (event.step?.type === "input" && event.text === QUANTITY_PROMPT && quest.isComplete(event.player)) {
      askQuantity(event, key);
      return;
    }
    if (event.kind !== "message") return;
    const text = String(event.text ?? "");
    if (/hands you some .* gauntlets\.$/.test(text)) {
      event.box = { items: [GAUNTLETS[key]] };
      event.handled = true;
      return;
    }
    if (text.startsWith("You hand over 500,000 coins")) {
      event.box = { items: [COINS_BOX_ITEM ?? ItemIdentifiers.COINS] };
      return;
    }
    if ((event.playing?.page ?? event.pages?.[0]?.page) === PAGE) event.box = { statement: true };
  }

  // --- journal --------------------------------------------------------------------------------

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>Dimintheis's sons had nothing for me, so he asked for 500,000 coins.</str>", "<str>I paid him.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_ALL_TALKED || stage >= STAGE_STARTED && allTalked(player)) {
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

  api.onBeforeNpcInteraction(talkTo);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
