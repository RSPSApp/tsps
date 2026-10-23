/**
 * Current Affairs (members).
 *
 * The words come from the "Current Affairs" transcript page (npc-dialogues.json,
 * osrsreboxed). NPCs: Arhein (3200), Harry (3213) and Councillor Catherine
 * (14952). Catherine is missing from npc-spawns.json, so she is owner-spawned at
 * her desk (2825,3454) on login; the collectable current duck (15153, the
 * "stopped, Collect" variant) is owner-spawned at its recorded stop tile.
 *
 * Stages (varbit 18282 "current_affairs", varp 4956 bits 0-6): the values follow
 * RuneLite Quest Helper's pinned stage map (0, 5, 10, 15, 20, 25, 30, 35, 40),
 * corroborated by the cache varbits: 5 started, 10 form cr-4p given/filled, 15
 * form handed in and Arhein told about the mayor, 20 mayor caught, 25 mayor
 * chained and audit started, 30 form 7r4-5h (audit passed), 35 signed form
 * handed in (by-law changed), 40 duck given, 45 complete. Collecting the duck
 * sets varbit 18602 (sailing_charting_current_duck_catherby_bay_complete) and
 * leaves the stage at 40, so Arhein selects "after charting the current" from
 * that flag, as Quest Helper's catherbyCharted requirement does. The eight form
 * answers ride in varbits 18290-18297 (varp 4957) and the dialogue flags in 18285-18289 (varp
 * 4956), as Quest Helper and the cache name them; the persisted
 * "current-affairs:*" attributes remain the save-relog source of truth.
 *
 * Rewards (OSRS Wiki): 1 Quest point, 1,400 Sailing XP, 1,000 Fishing XP,
 * 25 sawmill coupon (oak plank); the player keeps the current duck and the Mayor
 * of Catherby and unlocks sea charting/current. XP is granted in onReward.
 *
 * Gaps/approximations:
 * - Form cr-4p is filled through the transcript's chatbox questions and the
 *   answers are replayed from the persisted attribute; the quiz with Catherine
 *   resolves *after* the questions, which the transcript flatten cannot do
 *   (conditions are resolved before the menus are shown), so the audit is run
 *   with the page's own question texts and success/failure branches replayed
 *   through the NpcDialogues export QuestRuntime.startTranscript itself uses.
 *   On a wrong answer only the missed questions are re-asked, as the Wiki notes.
 * - Track-current requires being aboard the player's own boat and within 8 tiles
 *   of the release ripple; collecting requires the stopped duck plus the boat
 *   within 12 tiles of the stop. The duck is placed west of the Obelisk of Water
 *   (2841,3422), and Collecting it is the "charting" step.
 * - Arhein has no post-quest variant on the page. A completed player with the
 *   duck keeps the post-quest page; without it, Quest Helper lets Arhein
 *   replace the reward, so the recorded without-duck branch is reused.
 *   Catherine's and Harry's post-quest pages are used as-is.
 * - The mayor's Consult/Feed item options use the Mayor of Catherby item page.
 * - The charcoal is required to use Form cr-4p's "Fill-in" but is not consumed;
 *   the "You need some charcoal..." refusal is the one line not from the wiki.
 */
module.exports = function registerCurrentAffairsQuest(api) {
  const { Item, Skill, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const {
    registerQuest,
    refreshQuestList,
    startDialogue,
    startTranscript,
    loadTranscripts,
    getRegisteredQuests,
  } = require("../QuestRuntime");

  // NPCs (cache ids; NpcIdentifiers comments).
  const ARHEIN_NPC_ID = NpcIdentifiers.ARHEIN; // 3200
  const HARRY_NPC_ID = NpcIdentifiers.HARRY; // 3213
  const CATHERINE_NPC_ID = NpcIdentifiers.COUNCILLOR_CATHERINE; // 14952
  const MAYOR_NPC_ID = NpcIdentifiers.MAYOR_OF_CATHERBY; // 15050, chathead for Consult
  const DUCK_MOVING_NPC_ID = NpcIdentifiers.CURRENT_DUCK; // 15152, released/followed duck
  const DUCK_NPC_ID = NpcIdentifiers.CURRENT_DUCK_2; // 15153, the collectable stopped duck

  // Items (cache ids; ItemIdentifiers comments).
  const CHARCOAL_ITEM_ID = ItemIdentifiers.CHARCOAL; // 973
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const TINY_NET_ITEM_ID = ItemIdentifiers.TINY_NET; // 6674
  const FORM_CR_4P_ITEM_ID = ItemIdentifiers.FORM_CR_4P; // 31327
  const FORM_7R4_5H_ITEM_ID = ItemIdentifiers.FORM_7R4_5H; // 31328, unsigned
  const FORM_7R4_5H_SIGNED_ITEM_ID = ItemIdentifiers.FORM_7R4_5H_2; // 31329, signed
  const MAYORAL_FISHBOWL_ITEM_ID = ItemIdentifiers.MAYORAL_FISHBOWL; // 31330
  const MAYOR_ITEM_ID = ItemIdentifiers.MAYOR_OF_CATHERBY; // 31331
  const CURRENT_DUCK_ITEM_ID = ItemIdentifiers.CURRENT_DUCK; // 31805
  const FISH_FOOD_ITEM_ID = ItemIdentifiers.FISH_FOOD; // 272
  const SAWMILL_COUPON_ITEM_ID = ItemIdentifiers.SAWMILL_COUPON_OAK_PLANK_; // 32085

  // Objects (cache ids; ObjectIdentifiers comments).
  const CABINET_OBJECT_ID = ObjectIdentifiers.CABINET_60; // 58193, Councillor's office
  const AQUARIUM_OBJECT_ID = ObjectIdentifiers.AQUARIUM; // 10091, Harry's shop

  const VARP_CURRENT_AFFAIRS = 4956; // "current_affairs_main"
  const VARBIT_CURRENT_AFFAIRS_STAGE = 18282; // "current_affairs", varp 4956 bits 0-6
  const VARBIT_FORM_GIVEN = 18285;
  const VARBIT_KIT_PURCHASED = 18287;
  const VARBIT_AUDIT_START = 18288;
  const VARBIT_FORM2_GIVEN = 18289;
  const VARBIT_FORM_Q1 = 18290; // q1..q8 are two bits each through 18297
  const VARBIT_FORM_Q1_CORRECT = 18298;
  const VARBIT_CATHERBY_CHARTED = 18602; // sailing_charting_current_duck_catherby_bay_complete

  const STAGE_STARTED = 5;
  const STAGE_FORM_GIVEN = 10;
  const STAGE_FORM_HANDED_IN = 15;
  const STAGE_MAYOR_CAUGHT = 20;
  const STAGE_MAYOR_CHAINED = 25;
  const STAGE_FORM2_GIVEN = 30;
  const STAGE_SIGNED_HANDED_IN = 35;
  const STAGE_DUCK_GIVEN = 40;
  const STAGE_COMPLETE = 45; // capture 3467: 40 -> 45 on the Arhein completion action

  const PAGE = "Current Affairs";
  const START_HOOK = "quest:current-affairs:start";
  const AUDIT_RETRY_ACTION = "current-affairs:audit-retry";

  // Variants started directly (npc-dialogue:start / startTranscript).
  const CABINET_SEARCH_VARIANT = "red-tape-searching-the-cabinet";
  const FORM_FILL_VARIANT = "red-tape-filling-out-form-cr-4p";
  const CATCH_MAYOR_VARIANT = "long-live-the-mayor-catching-the-mayor";
  const MAYOR_DESTROYED_VARIANT = "long-live-the-mayor-catching-the-mayor-dropping-the-mayor-of-catherby";
  const FISHBOWL_DESTROYED_VARIANT =
    "long-live-the-mayor-talking-to-harry-after-buying-the-mayoral-election-kit-dropping-the-mayoral-fishbowl";
  const DUCK_DEPLOY_VARIANT = "going-with-the-flow-deploying-the-current-duck";
  const DUCK_COLLECT_VARIANT = "going-with-the-flow-retrieving-the-current-duck";
  const AUDIT_VARIANT = "long-live-the-mayor-talking-to-councillor-catherine-with-the-mayor";
  const AUDIT_CHAINED_CONDITION_ID = "sDvqog";
  const AUDIT_PASSED_CONDITION_ID = "8L9msJ";
  const AUDIT_FAILED_CONDITION_ID = "LacIZH";

  // Condition step ids on the "Current Affairs" page (research pack).
  const REQUIREMENTS_CONDITION_ID = "mNhEI-";
  const FORM_INCOMPLETE_CONDITION_ID = "fnk3vl";
  const FORM_COMPLETE_CONDITION_ID = "w0Q-_a";
  const HARRY_FULL_CONDITION_ID = "6wAio2";
  const HARRY_POOR_CONDITION_ID = "tovbj-";
  const HARRY_KIT_ROOM_CONDITION_ID = "5XSREm";
  const HARRY_KIT_NO_ROOM_CONDITION_ID = "k7BCZl";
  const MAYOR_UNCHAINED_CONDITION_ID = "4xe6Ud";
  const MAYOR_CHAINED_CONDITION_ID = "sDvqog";
  const AUDIT_NO_ROOM_CONDITION_ID = "pxUbOn";
  const FORM2_NO_ROOM_CONDITION_ID = "Em-SDp";
  const DUCK_NO_ROOM_CONDITION_ID = "eLtkRx";
  const DUCK_ROOM_CONDITION_ID = "_P702u";
  const MAYOR_LOST_CONDITION_ID = "S7lLc6";
  const FINAL_NO_ROOM_CONDITION_ID = "gZtDl3";

  // Action/message step ids whose side effects this plugin performs.
  const FORM_GIVEN_ACTION_ID = "Xu9bQv";
  const FORM_FINISHED_ACTION_ID = "0c6vLl";
  const FORM_TAKEN_ACTION_ID = "-1ABR0";
  const BUY_KIT_ACTION_ID = "z2S7Yd";
  const KIT_REPLACED_ACTION_ID = "YXGrto";
  const MAYOR_CHAINED_ACTION_ID = "N4WcCZ";
  const FORM2_GIVEN_ACTION_ID = "gAbCv_";
  const FORM2_RECLAIMED_ACTION_ID = "xPCZtP";
  const SIGNED_TAKEN_ACTION_ID = "Z8S0Nw";
  const DUCK_GIVEN_ACTION_ID = "P6m_pN";
  const DUCK_REPLACED_ACTION_ID = "VTzqPC";
  const NEW_MAYOR_ACTION_ID = "gfnjCi";
  const COMPLETE_ACTION_ID = "Qgq1vn";

  const KIT_PRICE = 50;
  const SAILING_LEVEL = 22;
  const FISHING_LEVEL = 10;
  const QUESTION_COUNT = 8;
  const MAYORS_BEFORE = 27; // Wiki trivia: replacements start after 27 mayors.

  // Councillor Catherine's desk (desk 58192 at 2824,3453, cabinet at 2827,3453).
  const CATHERINE_SPAWN = { x: 2825, y: 3454, z: 0 };
  // Capture 3467: release at (2837,3414), then the duck walks this route and
  // stops at (2802,3322) south-west of Entrana.
  const DUCK_RELEASE_LOCATION = { x: 2837, y: 3414, z: 0 };
  const DUCK_STOP_LOCATION = { x: 2802, y: 3322, z: 0 };
  const DUCK_COLLECT_RANGE = 12; // the boat deck's cross-world reach to the stopped duck
  const DUCK_ROUTE = [
    [2837, 3402], [2831, 3396], [2823, 3396], [2818, 3391], [2809, 3391],
    [2809, 3389], [2801, 3389], [2801, 3378], [2798, 3375], [2798, 3343],
    [2802, 3339], [2802, 3322],
  ];
  const VARBIT_BOARDED_BOAT = 19136; // sailing_boarded_boat

  const FORM_ANSWERS_ATTRIBUTE = "current-affairs:form-answers";
  const KIT_BOUGHT_ATTRIBUTE = "current-affairs:kit-bought";
  const MAYOR_CHAINED_ATTRIBUTE = "current-affairs:mayor-chained";
  const MAYORS_ASKED_ATTRIBUTE = "current-affairs:mayors-asked";
  const CURRENTS_CHARTED_ATTRIBUTE = "current-affairs:currents-charted";
  const STAGE_VERSION_ATTRIBUTE = "current-affairs:stage-v2";

  let quest;
  let transcriptPage = null;
  const fillStates = new WeakMap(); // player -> { index, answers }
  const audits = new WeakMap(); // player -> { answers, asked, remaining }
  const catherineByPlayer = new WeakMap(); // player -> owner-only NPC
  const deployedDuckByPlayer = new WeakMap(); // player -> owner-only NPC
  const duckJourneys = new WeakMap(); // player -> task key while the duck walks
  const stoppedDucks = new WeakSet(); // the deployed duck finished its route

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => player.getInventory().getFreeSlots();

  function page() {
    if (!transcriptPage) transcriptPage = loadTranscripts(api)?.[PAGE] ?? null;
    return transcriptPage;
  }

  function formAnswers(player) {
    const raw = player.getAttribute(FORM_ANSWERS_ATTRIBUTE);
    if (typeof raw !== "string" || raw.length !== QUESTION_COUNT) return null;
    const answers = raw.split("").map(Number);
    return answers.every((value) => Number.isInteger(value)) ? answers : null;
  }

  /** Mirrors the saved answers into the cache's form varbits (18290-18297, two bits each). */
  function sendFormAnswerVarbits(player, answers = formAnswers(player)) {
    for (let index = 0; index < QUESTION_COUNT; index++) {
      const value = answers ? (answers[index] + 1) : 0; // varbit 0 = unanswered
      player.getPacketSender().sendVarbit(VARBIT_FORM_Q1 + index, value);
    }
  }

  function isMayorChained(player) {
    return player.getAttribute(MAYOR_CHAINED_ATTRIBUTE) === true;
  }

  function mayorsAsked(player) {
    return Number(player.getAttribute(MAYORS_ASKED_ATTRIBUTE)) || 0;
  }

  function currentsCharted(player) {
    return player.getAttribute(CURRENTS_CHARTED_ATTRIBUTE) === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    const pandemonium = { player, key: "pandemonium", complete: false };
    api.emitCustomEvent("quest:is-complete", pandemonium);
    return (
      skills.getMaxLevel(Skill.SAILING) >= SAILING_LEVEL &&
      skills.getMaxLevel(Skill.FISHING) >= FISHING_LEVEL &&
      pandemonium.complete === true &&
      freeSlots(player) >= 2 // Quest Helper: the form and the election kit need two slots
    );
  }

  /** True while another quest owns Arhein: Merlin's Crystal's stage-3 crate
   *  ride, or One Small Favour's T.R.A.S.H. / weather-report hand-ins. */
  function otherQuestOwnsArhein(player) {
    const mc = getRegisteredQuests().find((entry) => entry.key === "merlins_crystal");
    if (mc && mc.isStarted(player) && !mc.isComplete(player)) {
      const stage = mc.getStage(player);
      if (stage >= 3 && stage < 4) return true;
    }
    const osf = getRegisteredQuests().find((entry) => entry.key === "one_small_favour");
    if (!osf || !osf.isStarted(player) || osf.isComplete(player)) return false;
    const stage = osf.getStage(player);
    return stage === 12 || stage === 13 || stage === 28 || stage === 29;
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function arheinVariant(player) {
    if (otherQuestOwnsArhein(player)) return null;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      // Quest Helper: a lost reward duck can be replaced by Arhein. Reuse the
      // recorded without-duck branch; with the duck held keep the post-quest page.
      return held(player, CURRENT_DUCK_ITEM_ID)
        ? "starting-off-talking-to-arhein-again"
        : "going-with-the-flow-talking-to-arhein-without-the-duck";
    }
    if (stage === 0) return "starting-off-talking-to-arhein";
    if (stage < STAGE_FORM_HANDED_IN) return "starting-off-talking-to-arhein-again";
    if (stage === STAGE_FORM_HANDED_IN) return "long-live-the-mayor-talking-to-arhein";
    if (stage < STAGE_MAYOR_CHAINED) {
      return held(player, MAYOR_ITEM_ID)
        ? "long-live-the-mayor-talking-to-arhein-with-the-mayor"
        : "long-live-the-mayor-talking-to-arhein-again";
    }
    if (stage <= STAGE_FORM2_GIVEN) {
      return held(player, MAYOR_ITEM_ID)
        ? "long-live-the-mayor-talking-to-arhein-with-the-mayor-again"
        : "long-live-the-mayor-talking-to-arhein-again";
    }
    if (stage === STAGE_SIGNED_HANDED_IN) return "going-with-the-flow-talking-to-arhein";
    if (stage === STAGE_DUCK_GIVEN) {
      if (currentsCharted(player)) return "going-with-the-flow-talking-to-arhein-after-charting-the-current";
      return held(player, CURRENT_DUCK_ITEM_ID)
        ? "going-with-the-flow-talking-to-arhein-again"
        : "going-with-the-flow-talking-to-arhein-without-the-duck";
    }
    return "going-with-the-flow-talking-to-arhein-after-charting-the-current";
  }

  function harryVariant(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return null; // falls back to Harry's own page
    // Quest Helper's stage 20 is "go and see Harry about a replacement".
    if (stage < STAGE_MAYOR_CAUGHT) return null;
    if (held(player, MAYOR_ITEM_ID)) return "long-live-the-mayor-catching-the-mayor-talking-to-harry-after-catching-the-mayor";
    if (held(player, MAYORAL_FISHBOWL_ITEM_ID)) {
      return "long-live-the-mayor-talking-to-harry-after-buying-the-mayoral-election-kit";
    }
    if (player.getAttribute(KIT_BOUGHT_ATTRIBUTE) === true) {
      return "long-live-the-mayor-talking-to-harry-after-buying-the-mayoral-election-kit-talking-to-harry-after-buying-and-losing-the-kit";
    }
    return "long-live-the-mayor-talking-to-harry";
  }

  function catherineVariant(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null; // standard Councillor Catherine dialogue
    if (stage === STAGE_STARTED) return "red-tape-talking-to-councillor-catherine";
    if (stage <= STAGE_FORM_GIVEN) {
      return held(player, FORM_CR_4P_ITEM_ID)
        ? "red-tape-talking-to-councillor-catherine-again"
        : "red-tape-talking-to-councillor-catherine";
    }
    if (stage === STAGE_FORM_HANDED_IN) {
      return "red-tape-talking-to-councillor-catherine-after-handing-in-form-cr-4p";
    }
    if (stage < STAGE_FORM2_GIVEN) {
      if (!held(player, MAYOR_ITEM_ID)) return "long-live-the-mayor-talking-to-councillor-catherine-without-the-mayor";
      return "long-live-the-mayor-talking-to-councillor-catherine-with-the-mayor";
    }
    if (stage === STAGE_FORM2_GIVEN) {
      if (held(player, FORM_7R4_5H_SIGNED_ITEM_ID)) {
        return "long-live-the-mayor-handing-in-the-signed-form-to-councillor-catherine";
      }
      if (held(player, FORM_7R4_5H_ITEM_ID)) {
        return "long-live-the-mayor-talking-to-councillor-catherine-after-giving-all-correct-answers";
      }
      return "long-live-the-mayor-reclaiming-the-form-after-losing-it";
    }
    return "long-live-the-mayor-talking-to-councillor-catherine-after-handing-in-the-signed-form";
  }

  function selectVariant({ npcId, player }) {
    if (npcId === ARHEIN_NPC_ID) return arheinVariant(player);
    if (npcId === HARRY_NPC_ID) return harryVariant(player);
    if (npcId === CATHERINE_NPC_ID) return catherineVariant(player);
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (npcId !== ARHEIN_NPC_ID && npcId !== HARRY_NPC_ID && npcId !== CATHERINE_NPC_ID) {
      return null;
    }
    switch (stepId) {
      case REQUIREMENTS_CONDITION_ID:
        return !meetsRequirements(player);
      case FORM_INCOMPLETE_CONDITION_ID:
        return !formAnswers(player);
      case FORM_COMPLETE_CONDITION_ID:
        return Boolean(formAnswers(player));
      case HARRY_FULL_CONDITION_ID:
        return freeSlots(player) < 2;
      case HARRY_POOR_CONDITION_ID:
        return !held(player, COINS_ITEM_ID, KIT_PRICE);
      case HARRY_KIT_ROOM_CONDITION_ID:
        return freeSlots(player) >= 2;
      case DUCK_ROOM_CONDITION_ID:
        return freeSlots(player) >= 1;
      case HARRY_KIT_NO_ROOM_CONDITION_ID:
        return freeSlots(player) < 2;
      case AUDIT_NO_ROOM_CONDITION_ID:
      case FORM2_NO_ROOM_CONDITION_ID:
      case DUCK_NO_ROOM_CONDITION_ID:
      case FINAL_NO_ROOM_CONDITION_ID:
        return freeSlots(player) < 1;
      case MAYOR_UNCHAINED_CONDITION_ID:
        return !isMayorChained(player);
      case MAYOR_CHAINED_CONDITION_ID:
        return isMayorChained(player);
      // The audit verdict is decided by the plugin after the questions; if the
      // transcript reaches these, take the "incorrect" path rather than pass.
      case AUDIT_PASSED_CONDITION_ID:
        return false;
      case AUDIT_FAILED_CONDITION_ID:
        return true;
      case MAYOR_LOST_CONDITION_ID:
        return !held(player, MAYOR_ITEM_ID);
      default:
        return null;
    }
  }

  // ==========================================================================
  // The quiz: form cr-4p and Catherine's audit
  // ==========================================================================

  function formQuestions() {
    const record = page();
    const variant = record?.variants?.[FORM_FILL_VARIANT];
    if (!Array.isArray(variant)) return [];
    return variant
      .filter((step) => step.type === "choice" && step.options?.length)
      .map((step) => ({
        title: step.prompt ?? "Select an Option",
        options: step.options.map((option) => String(option.text)),
      }));
  }

  let auditDataCache;
  function auditData() {
    if (auditDataCache !== undefined) return auditDataCache;
    const record = page();
    const variant = record?.variants?.[AUDIT_VARIANT];
    if (!Array.isArray(variant)) return (auditDataCache = null);
    const chained = variant.find(
      (step) => step.type === "condition" && step.id === AUDIT_CHAINED_CONDITION_ID
    );
    const steps = chained?.steps;
    const firstChoice = Array.isArray(steps)
      ? steps.findIndex((step) => step.type === "choice" && step.options?.length)
      : -1;
    if (firstChoice < 0) return (auditDataCache = null);
    const questions = [];
    for (let index = firstChoice; index < steps.length; index++) {
      const step = steps[index];
      if (step.type !== "choice" || !step.options?.length) continue;
      questions.push({
        line: steps[index - 1]?.type === "line" ? steps[index - 1].text : undefined,
        title: step.prompt ?? "Select an Option",
        options: step.options.map((option) => String(option.text)),
      });
    }
    auditDataCache = {
      branches: record.branches,
      // The line before the first menu is the first question; askQuestion plays it.
      intro: [...variant.slice(0, variant.indexOf(chained)), ...steps.slice(0, firstChoice - 1)],
      questions,
      passed:
        steps.find((step) => step.type === "condition" && step.id === AUDIT_PASSED_CONDITION_ID)
          ?.steps ?? [],
      failed:
        steps.find((step) => step.type === "condition" && step.id === AUDIT_FAILED_CONDITION_ID)
          ?.steps ?? [],
    };
    return auditDataCache;
  }

  /** Plays raw transcript steps (the audit intro/outcome) through the dialogue runtime. */
  function playTranscriptSteps(player, steps) {
    const { startDialogue: playDialogue } = require("../../npcs/NpcDialogues.plugin.js");
    const definition = api.core.NpcDefinition.forId(CATHERINE_NPC_ID);
    const event = { player, npcId: CATHERINE_NPC_ID, npc: null, definition };
    const context = {
      player,
      npc: null,
      npcId: CATHERINE_NPC_ID,
      definition,
      pages: [{ page: PAGE, variants: [AUDIT_VARIANT] }],
    };
    playDialogue(api, event, steps, auditData().branches, context);
  }

  /** Raw wiki lines/messages -> QuestRuntime's simple dialogue steps. */
  function toSpeechStep(step) {
    if (typeof step.player === "string") return { player: [step.player] };
    if (step.type === "line" && typeof step.text === "string") return { npc: [step.text] };
    if (step.type === "message" && typeof step.text === "string") {
      const text = step.text;
      return { exec: (player) => player.sendMessage(text) };
    }
    return null;
  }

  function askQuestion(player, question, onAnswer) {
    const options = question.options.map((text, index) => ({
      text,
      echo: false,
      next: [{ exec: () => onAnswer(index) }],
    }));
    const steps = [];
    if (question.line) steps.push({ npc: [question.line] });
    steps.push({ title: question.title, options });
    startDialogue(api, player, { npcId: CATHERINE_NPC_ID }, steps);
  }

  function askNextQuestion(player) {
    const audit = audits.get(player);
    if (!audit) return;
    if (audit.remaining.length === 0) {
      finishAudit(player);
      return;
    }
    const questionIndex = audit.remaining[0];
    const question = auditData().questions[questionIndex];
    if (!question) {
      audit.remaining.shift();
      askNextQuestion(player);
      return;
    }
    askQuestion(player, question, (optionIndex) => {
      audit.answers[questionIndex] = optionIndex;
      audit.asked.push(questionIndex);
      audit.remaining.shift();
      askNextQuestion(player);
    });
  }

  function startAudit(player) {
    const data = auditData();
    if (!data) return;
    fillStates.delete(player);
    player.getPacketSender().sendVarbit(VARBIT_AUDIT_START, 1);
    audits.set(player, {
      answers: [],
      asked: [],
      remaining: data.questions.map((_, index) => index),
    });
    const steps = data.intro.map(toSpeechStep).filter(Boolean);
    steps.push({ exec: () => askNextQuestion(player) });
    startDialogue(api, player, { npcId: CATHERINE_NPC_ID }, steps);
  }

  function finishAudit(player) {
    const audit = audits.get(player);
    if (!audit) return;
    audits.delete(player);
    const expected = formAnswers(player);
    const asked = [...new Set(audit.asked)];
    // A stage-jumped player (no stored answers) is passed rather than looped.
    const wrong = expected ? asked.filter((index) => audit.answers[index] !== expected[index]) : [];
    const packet = player.getPacketSender();
    for (const index of asked) packet.sendVarbit(VARBIT_FORM_Q1_CORRECT + index, wrong.includes(index) ? 0 : 1);
    if (wrong.length === 0) {
      if (quest.getStage(player) < STAGE_FORM2_GIVEN) quest.setStage(player, STAGE_FORM2_GIVEN);
      playTranscriptSteps(player, auditData().passed);
      // The form answers are only needed for the audit; the quiz is done with them.
      player.setAttribute(FORM_ANSWERS_ATTRIBUTE, "");
      sendFormAnswerVarbits(player, null);
      return;
    }
    audits.set(player, { answers: [], asked: [], remaining: wrong });
    playTranscriptSteps(player, [
      ...auditData().failed,
      { type: "action", action: AUDIT_RETRY_ACTION },
    ]);
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== ARHEIN_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice(event) {
    const state = fillStates.get(event.player);
    if (!state || event.npcId !== CATHERINE_NPC_ID) return;
    const question = formQuestions()[state.index];
    if (!question) return;
    const optionIndex = question.options.indexOf(String(event.option));
    if (optionIndex < 0) return;
    state.answers[state.index] = optionIndex;
    state.index++;
  }

  /** Fills the wiki's "[X]" in Arhein's "mayor [X]" line. */
  function handleDialogueLine(event) {
    if (event.npcId !== ARHEIN_NPC_ID || typeof event.text !== "string") return;
    // Quest Helper moves the stage from "hear about the mayor" to "find one" at
    // the end of Arhein's explanation, before the player leaves the conversation.
    if (
      event.text === "I'll help you replace the fish." &&
      quest.getStage(event.player) === STAGE_FORM_HANDED_IN
    ) {
      quest.setStage(event.player, STAGE_MAYOR_CAUGHT);
    }
    if (!event.text.includes("[X]")) return;
    event.text = event.text.replace("[X]", String(MAYORS_BEFORE + mayorsAsked(event.player)));
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (event.action === AUDIT_RETRY_ACTION) {
      if (npcId !== CATHERINE_NPC_ID || !audits.has(player)) return;
      event.handled = true;
      // Starting the retry synchronously would be wiped by the transcript
      // runtime's own close chain; close now and reopen next tick.
      event.end = true;
      const { CountdownTask, TaskManager } = api.core;
      TaskManager.submit(new CountdownTask(player, 1, () => askNextQuestion(player)));
      return;
    }
    if (npcId !== ARHEIN_NPC_ID && npcId !== HARRY_NPC_ID && npcId !== CATHERINE_NPC_ID) return;
    if (!stepId) return;

    // Form cr-4p given (first Catherine talk, or after destroying the form).
    if (stepId === FORM_GIVEN_ACTION_ID) {
      if (held(player, FORM_CR_4P_ITEM_ID)) return;
      player.getInventory().adds(FORM_CR_4P_ITEM_ID, 1);
      player.setAttribute(FORM_ANSWERS_ATTRIBUTE, "");
      sendFormAnswerVarbits(player, null);
      player.getPacketSender().sendVarbit(VARBIT_FORM_GIVEN, 1);
      const stage = quest.getStage(player);
      if (stage <= STAGE_FORM_GIVEN) {
        quest.setStage(player, STAGE_FORM_GIVEN);
      }
      return;
    }
    // "Mercifully, it looks like the form is finished." - save the answers.
    if (stepId === FORM_FINISHED_ACTION_ID) {
      const state = fillStates.get(player);
      fillStates.delete(player);
      if (!state || !held(player, FORM_CR_4P_ITEM_ID)) return;
      if (quest.getStage(player) >= STAGE_FORM_HANDED_IN) return;
      const complete = state.answers.filter((value) => Number.isInteger(value)).length;
      if (complete < QUESTION_COUNT) return;
      player.setAttribute(FORM_ANSWERS_ATTRIBUTE, state.answers.join(""));
      sendFormAnswerVarbits(player, state.answers);
      // Filling the form is a sub-step of stage 10; Quest Helper keys it on the
      // q1-q8 varbits rather than the stage, so the stage does not move here.
      return;
    }
    // "Councillor Catherine takes the completed form." The answers stay in the
    // persisted attribute: Catherine's audit still has to compare against them.
    if (stepId === FORM_TAKEN_ACTION_ID) {
      if (!held(player, FORM_CR_4P_ITEM_ID)) return;
      player.getInventory().deleteNumber(FORM_CR_4P_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_FORM_HANDED_IN) quest.setStage(player, STAGE_FORM_HANDED_IN);
      return;
    }
    // "You buy a mayoral election kit from Harry for 50 coins."
    if (stepId === BUY_KIT_ACTION_ID) {
      if (player.getAttribute(KIT_BOUGHT_ATTRIBUTE) === true) return;
      if (held(player, MAYORAL_FISHBOWL_ITEM_ID) || !held(player, COINS_ITEM_ID, KIT_PRICE)) return;
      player.getInventory().deleteNumber(COINS_ITEM_ID, KIT_PRICE);
      player.getInventory().adds(MAYORAL_FISHBOWL_ITEM_ID, 1);
      player.getInventory().adds(TINY_NET_ITEM_ID, 1);
      player.setAttribute(KIT_BOUGHT_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_KIT_PURCHASED, 1);
      return;
    }
    // "Harry gives you a tiny net and a mayoral fishbowl." (lost kit)
    if (stepId === KIT_REPLACED_ACTION_ID) {
      if (!held(player, MAYORAL_FISHBOWL_ITEM_ID)) player.getInventory().adds(MAYORAL_FISHBOWL_ITEM_ID, 1);
      if (!held(player, TINY_NET_ITEM_ID)) player.getInventory().adds(TINY_NET_ITEM_ID, 1);
      return;
    }
    // "Arhein places a small chain in the bowl."
    if (stepId === MAYOR_CHAINED_ACTION_ID) {
      player.setAttribute(MAYOR_CHAINED_ATTRIBUTE, true);
      if (quest.getStage(player) < STAGE_MAYOR_CHAINED) quest.setStage(player, STAGE_MAYOR_CHAINED);
      return;
    }
    // "Councillor Catherine hands you a form." (7r4-5h, audit passed)
    if (stepId === FORM2_GIVEN_ACTION_ID || stepId === FORM2_RECLAIMED_ACTION_ID) {
      if (
        freeSlots(player) >= 1 &&
        !held(player, FORM_7R4_5H_ITEM_ID) &&
        !held(player, FORM_7R4_5H_SIGNED_ITEM_ID)
      ) {
        player.getInventory().adds(FORM_7R4_5H_ITEM_ID, 1);
      }
      if (stepId === FORM2_GIVEN_ACTION_ID) {
        player.getPacketSender().sendVarbit(VARBIT_FORM2_GIVEN, 1);
        if (quest.getStage(player) < STAGE_FORM2_GIVEN) quest.setStage(player, STAGE_FORM2_GIVEN);
      }
      return;
    }
    // "Councillor Catherine takes the completed form and stamps it."
    if (stepId === SIGNED_TAKEN_ACTION_ID) {
      if (!held(player, FORM_7R4_5H_SIGNED_ITEM_ID)) return;
      player.getInventory().deleteNumber(FORM_7R4_5H_SIGNED_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_SIGNED_HANDED_IN) quest.setStage(player, STAGE_SIGNED_HANDED_IN);
      return;
    }
    // "Arhein hands you the duck."
    if (stepId === DUCK_GIVEN_ACTION_ID || stepId === DUCK_REPLACED_ACTION_ID) {
      if (!held(player, CURRENT_DUCK_ITEM_ID)) player.getInventory().adds(CURRENT_DUCK_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_DUCK_GIVEN) quest.setStage(player, STAGE_DUCK_GIVEN);
      return;
    }
    // "Arhein gives you a new mayor."
    if (stepId === NEW_MAYOR_ACTION_ID) {
      if (held(player, MAYOR_ITEM_ID)) return;
      player.getInventory().adds(MAYOR_ITEM_ID, 1);
      player.setAttribute(MAYORS_ASKED_ATTRIBUTE, mayorsAsked(player) + 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_DUCK_GIVEN && currentsCharted(player)) {
        quest.complete(player);
      }
    }
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function fillForm(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_FORM_GIVEN || quest.isComplete(player)) return;
    if (formAnswers(player)) return;
    if (!held(player, CHARCOAL_ITEM_ID)) {
      player.sendMessage("You need some charcoal to fill in the form.");
      return;
    }
    fillStates.set(player, { index: 0, answers: [] });
    startTranscript(api, player, CATHERINE_NPC_ID, PAGE, FORM_FILL_VARIANT);
  }

  /**
   * Destroying the mayor or the fishbowl routes through the drop policy (the
   * Destroy option is a drop option in core), and the shared DestroyItem
   * confirmation re-runs the policy on Yes - which is where this sees it.
   */
  function handleItemDropPolicy(event) {
    const { player, itemId } = event;
    if (itemId !== MAYOR_ITEM_ID && itemId !== MAYORAL_FISHBOWL_ITEM_ID) return;
    event.handled = true;
    event.dropToGround = false;
    player.getInventory().deleteAtSlot(event.slot, event.item.getAmount());
    if (itemId === MAYOR_ITEM_ID) {
      startTranscript(api, player, ARHEIN_NPC_ID, PAGE, MAYOR_DESTROYED_VARIANT);
    } else {
      startTranscript(api, player, HARRY_NPC_ID, PAGE, FISHBOWL_DESTROYED_VARIANT);
    }
  }

  function consultMayor(event) {
    event.handled = true;
    startTranscript(api, event.player, MAYOR_NPC_ID, "Mayor of Catherby", "consulting-the-mayor");
  }

  function feedMayor(event) {
    event.handled = true;
    const { player } = event;
    if (!held(player, FISH_FOOD_ITEM_ID)) return;
    player.getInventory().deleteNumber(FISH_FOOD_ITEM_ID, 1);
    startTranscript(api, player, MAYOR_NPC_ID, "Mayor of Catherby", "using-fish-food-on-the-mayor");
  }

  function handleSignForm(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const other = usedItemId === MAYOR_ITEM_ID
      ? usedWithItemId
      : usedWithItemId === MAYOR_ITEM_ID
        ? usedItemId
        : null;
    if (other === null || !held(player, MAYOR_ITEM_ID)) return false;
    if (other === FORM_7R4_5H_ITEM_ID) {
      if (!held(player, FORM_7R4_5H_ITEM_ID)) return false;
      event.handled = true;
      player.getInventory().deleteNumber(FORM_7R4_5H_ITEM_ID, 1);
      player.getInventory().adds(FORM_7R4_5H_SIGNED_ITEM_ID, 1);
      player.sendMessage("The mayor eagerly signs the form for you. You should return it to Councillor Catherine.");
      return;
    }
    if (other === FISH_FOOD_ITEM_ID) {
      if (!held(player, FISH_FOOD_ITEM_ID)) return false;
      event.handled = true;
      player.getInventory().deleteNumber(FISH_FOOD_ITEM_ID, 1);
      startTranscript(api, player, MAYOR_NPC_ID, "Mayor of Catherby", "using-fish-food-on-the-mayor");
      return;
    }
    return false;
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function searchCabinet(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_FORM_GIVEN || quest.isComplete(player)) return;
    if (held(player, CHARCOAL_ITEM_ID)) return;
    player.getInventory().adds(CHARCOAL_ITEM_ID, 1);
    startTranscript(api, player, CATHERINE_NPC_ID, PAGE, CABINET_SEARCH_VARIANT);
  }

  function catchMayor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_FORM_HANDED_IN || quest.isComplete(player)) return;
    if (!held(player, TINY_NET_ITEM_ID) || !held(player, MAYORAL_FISHBOWL_ITEM_ID)) return;
    if (held(player, MAYOR_ITEM_ID)) return;
    event.handled = true;
    player.getInventory().deleteNumber(MAYORAL_FISHBOWL_ITEM_ID, 1);
    player.getInventory().adds(MAYOR_ITEM_ID, 1);
    if (stage < STAGE_MAYOR_CAUGHT) quest.setStage(player, STAGE_MAYOR_CAUGHT);
    startTranscript(api, player, HARRY_NPC_ID, PAGE, CATCH_MAYOR_VARIANT);
  }

  function handleObjectInteraction(event) {
    if (event.objectId === CABINET_OBJECT_ID) {
      searchCabinet(event);
      return;
    }
    if (event.objectId === AQUARIUM_OBJECT_ID && event.clickType === 1) catchMayor(event);
  }

  /**
   * The aquariums are tanks in the floor; a Fish-in click sometimes failed the
   * walk-to-object reach check from a tile that item-on-object accepts
   * ("You can't reach that!"). From beside a tank, route the click to the
   * player's own tile so the handler runs, as Underground Pass' guide rope does.
   */
  function routeAquariumClick(event) {
    if (event.objectId !== AQUARIUM_OBJECT_ID || event.clickType !== 1) return;
    const playerLocation = event.player.getLocation();
    const objectLocation = event.object?.getLocation?.();
    if (!objectLocation) return;
    const distance = Math.max(
      Math.abs(playerLocation.getX() - objectLocation.getX()),
      Math.abs(playerLocation.getY() - objectLocation.getY())
    );
    if (distance > 2) return;
    event.destination = {
      x: playerLocation.getX(),
      y: playerLocation.getY(),
      z: playerLocation.getZ(),
    };
  }

  function handleTinyNetOnAquarium(event) {
    if (event.itemId !== TINY_NET_ITEM_ID || event.objectId !== AQUARIUM_OBJECT_ID) return false;
    catchMayor(event);
    return event.handled === true;
  }

  // ==========================================================================
  // The current duck
  // ==========================================================================

  /** True when the player is on their own boat (capture 3467: the duck climbs aboard). */
  function aboard(player) {
    const sender = player.getPacketSender?.();
    if (sender?.getVarbit?.(VARBIT_BOARDED_BOAT) === 1) return true;
    const state = player.getSailing?.();
    const boat = state?.boats?.find?.((entry) => entry.slot === state.activeBoatSlot);
    return boat?.location?.kind === "at_sea";
  }

  /** The boat's world tile at sea, or the player's tile when they are on foot. */
  function worldTile(player) {
    const state = player.getSailing?.();
    const boat = state?.boats?.find?.((entry) => entry.slot === state.activeBoatSlot);
    if (aboard(player) && boat?.location?.kind === "at_sea") {
      return { x: Math.floor(boat.location.fineX / 128), y: Math.floor(boat.location.fineY / 128) };
    }
    const location = player.getLocation();
    return { x: location.getX(), y: location.getY() };
  }

  function distanceFrom(tile, target) {
    return Math.max(Math.abs(tile.x - target.x), Math.abs(tile.y - target.y));
  }

  function duckPath() {
    const path = [];
    let { x, y } = DUCK_RELEASE_LOCATION;
    const push = (nextX, nextY) => {
      while (x !== nextX || y !== nextY) {
        x += Math.sign(nextX - x);
        y += Math.sign(nextY - y);
        path.push([x, y]);
      }
    };
    for (const [nextX, nextY] of DUCK_ROUTE) push(nextX, nextY);
    return path;
  }

  function startDuckJourney(player, duck) {
    const key = {};
    duckJourneys.set(player, key);
    const path = duckPath();
    let index = 0;
    const step = () => {
      if (duckJourneys.get(player) !== key || duck?.isRegistered?.() === false) return;
      if (index >= path.length) {
        duckJourneys.delete(player);
        duck.moveTo(new Location(DUCK_STOP_LOCATION.x, DUCK_STOP_LOCATION.y, DUCK_STOP_LOCATION.z));
        duck.setNpcTransformationId(DUCK_NPC_ID);
        stoppedDucks.add(duck);
        player.sendMessage("The current duck comes to a stop.");
        return;
      }
      const [x, y] = path[index++];
      duck.moveTo(new Location(x, y, DUCK_RELEASE_LOCATION.z));
      api.core.TaskManager.submit(new api.core.CountdownTask(key, 1, step));
    };
    step();
  }

  function trackCurrent(event) {
    const { player } = event;
    event.handled = true;
    if (quest.isComplete(player) || quest.getStage(player) < STAGE_DUCK_GIVEN) return;
    if (!aboard(player)) {
      player.sendMessage("You need to be on your boat to release the duck.");
      return;
    }
    if (distanceFrom(worldTile(player), DUCK_RELEASE_LOCATION) > 8) {
      player.sendMessage("The duck should be released by the island east of Catherby.");
      return;
    }
    const existing = deployedDuckByPlayer.get(player);
    if (existing?.isRegistered?.()) {
      player.sendMessage("The duck is already tracking the currents.");
      return;
    }
    const duck = api.spawnNpc({
      id: DUCK_MOVING_NPC_ID,
      x: DUCK_RELEASE_LOCATION.x,
      y: DUCK_RELEASE_LOCATION.y,
      z: DUCK_RELEASE_LOCATION.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (duck) {
      deployedDuckByPlayer.set(player, duck);
      startDuckJourney(player, duck);
    }
    startTranscript(api, player, ARHEIN_NPC_ID, PAGE, DUCK_DEPLOY_VARIANT);
  }

  /**
   * Widen only the owned, stopped duck's actual Collect click while aboard. Every
   * other NPC route keeps the normal range 1 (owner/LOS checks still run in core).
   */
  function widenDuckCollectRange(event) {
    if (event.npcId !== DUCK_NPC_ID || !event.npc) return;
    const { player } = event;
    if (deployedDuckByPlayer.get(player) !== event.npc) return;
    if (!stoppedDucks.has(event.npc)) return;
    if (!aboard(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_DUCK_GIVEN || quest.isComplete(player)) return;
    const actions = event.definition?.getActions?.() ?? event.definition?.getInteractions?.();
    if (String(actions?.[event.clickType - 1] ?? "").toLowerCase() !== "collect") return;
    event.range = DUCK_COLLECT_RANGE;
  }

  function collectDuck(event) {
    const { player } = event;
    const duck = deployedDuckByPlayer.get(player);
    if (!duck || event.npc !== duck) return false;
    if (!stoppedDucks.has(duck)) {
      event.handled = true;
      player.sendMessage("The duck is still tracking the currents.");
      return true;
    }
    event.handled = true;
    if (!aboard(player)) {
      player.sendMessage("The duck recognises your boat and climbs aboard. You need to be on your boat.");
      return true;
    }
    if (distanceFrom(worldTile(player), DUCK_STOP_LOCATION) > DUCK_COLLECT_RANGE) {
      player.sendMessage("You need to sail closer to the duck.");
      return true;
    }
    api.removeNpc(duck);
    deployedDuckByPlayer.delete(player);
    stoppedDucks.delete(duck);
    const journey = duckJourneys.get(player);
    if (journey) api.core.TaskManager.cancelTasks?.(journey);
    duckJourneys.delete(player);
    if (!held(player, CURRENT_DUCK_ITEM_ID)) player.getInventory().adds(CURRENT_DUCK_ITEM_ID, 1);
    player.setAttribute(CURRENTS_CHARTED_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_CATHERBY_CHARTED, 1);
    startTranscript(api, player, ARHEIN_NPC_ID, PAGE, DUCK_COLLECT_VARIANT);
    return true;
  }

  // ==========================================================================
  // Catherine's audit (Talk-to is taken over once the mayor is chained)
  // ==========================================================================

  function catherineTalkTo(event) {
    const { player } = event;
    if (event.npcId !== CATHERINE_NPC_ID) return false;
    if (quest.isComplete(player)) return false;
    if (quest.getStage(player) !== STAGE_MAYOR_CHAINED) return false;
    if (!isMayorChained(player) || !held(player, MAYOR_ITEM_ID)) return false;
    if (!auditData()) return false;
    startAudit(player);
  }

  // ==========================================================================
  // NPC spawns / session lifecycle
  // ==========================================================================

  function ensureCatherine(player) {
    const existing = catherineByPlayer.get(player);
    if (existing?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: CATHERINE_NPC_ID,
      x: CATHERINE_SPAWN.x,
      y: CATHERINE_SPAWN.y,
      z: CATHERINE_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) catherineByPlayer.set(player, npc);
  }

  /** One-time move from the old 1-11 ladder to the captured 5-45 ladder. */
  function migrateStage(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === true) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, true);
    const legacy = quest.getStage(player);
    if (legacy === 0) return;
    const mapped = new Map([[1, 5], [2, 10], [3, 10], [4, 15], [5, 20], [6, 25],
      [7, 30], [8, 35], [9, 40], [10, 40], [11, 45]]).get(legacy);
    if (mapped === undefined) return; // already a captured stage, leave it
    if (legacy >= 10) {
      player.setAttribute(CURRENTS_CHARTED_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_CATHERBY_CHARTED, 1);
    }
    quest.setStage(player, mapped); // setStage only: no second reward on legacy completion
  }

  function handleLogin({ player }) {
    migrateStage(player);
    refreshQuestList(player);
    sendFormAnswerVarbits(player);
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_FORM_GIVEN, quest.getStage(player) >= STAGE_FORM_GIVEN ? 1 : 0);
    packet.sendVarbit(VARBIT_KIT_PURCHASED, player.getAttribute(KIT_BOUGHT_ATTRIBUTE) === true ? 1 : 0);
    packet.sendVarbit(VARBIT_AUDIT_START, quest.getStage(player) >= STAGE_MAYOR_CHAINED ? 1 : 0);
    packet.sendVarbit(VARBIT_FORM2_GIVEN, quest.getStage(player) >= STAGE_FORM2_GIVEN ? 1 : 0);
    packet.sendVarbit(VARBIT_CATHERBY_CHARTED, currentsCharted(player) ? 1 : 0);
    ensureCatherine(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    const catherine = catherineByPlayer.get(player);
    if (catherine) api.removeNpc(catherine);
    catherineByPlayer.delete(player);
    const duck = deployedDuckByPlayer.get(player);
    if (duck) api.removeNpc(duck);
    const journey = duckJourneys.get(player);
    if (journey) api.core.TaskManager.cancelTasks?.(journey);
    duckJourneys.delete(player);
    if (duck) stoppedDucks.delete(duck);
    deployedDuckByPlayer.delete(player);
    fillStates.delete(player);
    audits.delete(player);
  }

  // ==========================================================================
  // Journal + rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Arhein explained that the Mayor of Catherby is, and</str>",
        "<str>always has been, a fish.</str>",
        "<str>I replaced the mayor before Councillor Catherine noticed</str>",
        "<str>and she finally changed the non-human workers by-law.</str>",
        "<str>I charted the Catherby currents with the duck and kept</str>",
        "<str>both the duck and the mayor.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_DUCK_GIVEN && currentsCharted(player)) {
      return [
        "<str>Arhein asked me to test whether his duck can track</str>",
        "<str>the Catherby currents.</str>",
        "",
        "I should return to <col=800000>Arhein</col> and tell him I've charted the currents.",
      ];
    }
    if (stage >= STAGE_DUCK_GIVEN) {
      return [
        "<str>Arhein gave me his duck and asked me to test it.</str>",
        "",
        "I should release the <col=800000>current duck</col> by the island east of",
        "<col=800000>Catherby</col> and collect it once it stops south-west of Entrana.",
      ];
    }
    if (stage >= STAGE_SIGNED_HANDED_IN) {
      return [
        "<str>The by-law has been changed!</str>",
        "",
        "I should tell <col=800000>Arhein</col> the good news.",
      ];
    }
    if (stage >= STAGE_FORM2_GIVEN) {
      return [
        "<str>Councillor Catherine reviewed my form.</str>",
        "",
        "I should get <col=800000>form 7r4-5h</col> signed by the <col=800000>mayor</col>",
        "and return it to Councillor Catherine.",
      ];
    }
    if (stage >= STAGE_MAYOR_CHAINED) {
      return [
        "<str>Arhein put a mayoral chain on the new mayor.</str>",
        "",
        "I should show the <col=800000>mayor</col> to <col=800000>Councillor Catherine</col>.",
      ];
    }
    if (stage >= STAGE_MAYOR_CAUGHT) {
      return [
        "<str>I caught a fish to be the new Mayor of Catherby.</str>",
        "",
        "I should show it to <col=800000>Arhein</col>.",
      ];
    }
    if (stage >= STAGE_FORM_HANDED_IN) {
      return [
        "<str>I gave Councillor Catherine my completed form.</str>",
        "<str>Only the Mayor of Catherby can approve a by-law change.</str>",
        "",
        "I should speak to <col=800000>Arhein</col> about finding the mayor.",
      ];
    }
    if (stage >= STAGE_FORM_GIVEN) {
      if (formAnswers(player)) {
        return [
          "<str>I filled in form cr-4p.</str>",
          "",
          "I should return the completed <col=800000>form</col> to Councillor Catherine.",
        ];
      }
      return [
        "<str>Councillor Catherine gave me form cr-4p to register as a sailor.</str>",
        "",
        "I should fill it in with <col=800000>charcoal</col> from the cabinet",
        "and return it to her.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Arhein wants to test whether a duck can track sea currents, but</str>",
        "<str>the Catherby Council by-law forbids non-human workers.</str>",
        "",
        "I should talk to <col=800000>Councillor Catherine</col> at the council",
        "office north-east of the docks.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Arhein</col> on the",
      "<col=800000>Catherby</col> docks.",
      "",
      "I need level 22 Sailing, level 10 Fishing and to have completed",
      "<col=800000>Pandemonium</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SAILING, 1400);
    skills.addExperiences(Skill.FISHING, 1000);
    // QuestRuntime adds the first coupon. The stack is stackable, so engine
    // overflow can merge into an existing stack or drop the extra 24 at the
    // reward tile instead of silently losing them.
    player.getInventory().forceAdd(player, new Item(SAWMILL_COUPON_ITEM_ID, 24));
  }

  api.persistAttribute(FORM_ANSWERS_ATTRIBUTE);
  api.persistAttribute(KIT_BOUGHT_ATTRIBUTE);
  api.persistAttribute(MAYOR_CHAINED_ATTRIBUTE);
  api.persistAttribute(MAYORS_ASKED_ATTRIBUTE);
  api.persistAttribute(CURRENTS_CHARTED_ATTRIBUTE, false);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "current_affairs",
    name: "Current Affairs",
    varpId: VARP_CURRENT_AFFAIRS,
    varbitId: VARBIT_CURRENT_AFFAIRS_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.SAILING.getIndex(), amount: 1400, label: "Sailing" },
      { skillId: Skill.FISHING.getIndex(), amount: 1000, label: "Fishing" },
    ],
    rewardItemId: SAWMILL_COUPON_ITEM_ID,
    rewardItemLabel: "25 Sawmill coupons (oak)",
    otherRewards: ["Access to sea charting currents", "The current duck", "The Mayor of Catherby"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onItemAction("Form cr-4p", { "Fill-in": fillForm });
  api.onItemAction("Mayor of Catherby", { Consult: consultMayor, Feed: feedMayor });
  api.onItemAction("Current duck", { "Track-current": trackCurrent });
  api.onItemDropPolicy(handleItemDropPolicy);
  api.onItemOnItem("Form 7r4-5h", "Mayor of Catherby", handleSignForm);
  api.onItemOnItem("Fish food", "Mayor of Catherby", handleSignForm);
  api.onItemOnObject("Tiny net", "Aquarium", handleTinyNetOnAquarium, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(routeAquariumClick);
  api.onNpcInteraction("Councillor Catherine", { "Talk-to": catherineTalkTo });
  api.onNpcRoute(widenDuckCollectRange);
  api.onNpcInteraction("Current duck", { Collect: collectDuck });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
