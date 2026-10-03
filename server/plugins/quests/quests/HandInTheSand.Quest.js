/**
 * The Hand in the Sand (members).
 *
 * The words come from the "The Hand in the Sand" transcript page; this plugin
 * supplies the variant selector for Bert, the Guard Captain, Zavistic Rarve,
 * Sandy, Betty and Mazion, the prose-condition answers, the start hook, the
 * item hand-ins (sandy hand, beer, beer soaked hand, rotas, scroll, orb, head)
 * and the item-on-object/NPC actions (desk search, pickpocket, truth serum,
 * rose-tinted lens on the counter, orb activation).
 *
 * Stages (varp 1527, the reference varbit; Void hand_in_the_sand.varbits.toml):
 * 10 investigate hand, 20 ask wizards, 30 Bert's hours, 40 visit Sandy, 50
 * confront Bert, 60 deliver scroll, 70 make serum, 80 distract Sandy, 90 drugged
 * coffee, 100 activate orb, 110 interrogate Sandy, 120 return orb, 130 gather
 * runes, 140 search Entrana, 150 return head, 160 complete.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/quest/member/hand_in_the_sand/HandInTheSand.kt
 * Gaps: the sandpit cutscene/camera/sand animation, Bert's post-quest daily
 * 84-bucket sand delivery and the Wizards' Guild shop unlock are not reproduced;
 * Bert's requirement check (17 Thieving/49 Crafting) only closes the transcript
 * branch at its wiki "unavailable" marker; pickpocket and distraction always
 * succeed; the lens must be used on the counter without the doorway/light check.
 */
module.exports = function registerHandInTheSandQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "The Hand in the Sand";

  const ZAVISTIC_NPC_ID = NpcIdentifiers.ZAVISTIC_RARVE;
  const GUARD_CAPTAIN_NPC_ID = NpcIdentifiers.GUARD_CAPTAIN;
  const SANDY_NPC_IDS = new Set([NpcIdentifiers.SANDY, NpcIdentifiers.SANDY_2]);
  const MAZION_NPC_ID = NpcIdentifiers.MAZION;
  const BERT_NPC_IDS = new Set([NpcIdentifiers.BERT, NpcIdentifiers.BERT_2]);
  const BETTY_NPC_ID = NpcIdentifiers.BETTY;

  const VARP_HAND_IN_THE_SAND = 1527; // reference quest varbit, unused as a varp in the repo
  const STAGE_INVESTIGATE_HAND = 10;
  const STAGE_ASK_WIZARDS = 20;
  const STAGE_BERT_HOURS = 30;
  const STAGE_VISIT_SANDY = 40;
  const STAGE_CONFRONT_BERT = 50;
  const STAGE_DELIVER_SCROLL = 60;
  const STAGE_MAKE_SERUM = 70;
  const STAGE_DISTRACT_SANDY = 80;
  const STAGE_DRUG_COFFEE = 90;
  const STAGE_ACTIVATE_ORB = 100;
  const STAGE_INTERROGATE_SANDY = 110;
  const STAGE_RETURN_ORB = 120;
  const STAGE_GATHER_RUNES = 130;
  const STAGE_SEARCH_ENTRANA = 140;
  const STAGE_RETURN_HEAD = 150;
  const STAGE_COMPLETE = 160;

  const START_HOOK = "quest:hand-in-the-sand:start";

  const SANDY_HAND = ItemIdentifiers.SANDY_HAND;
  const BEER_SOAKED_HAND = ItemIdentifiers.BEER_SOAKED_HAND;
  const BERTS_ROTA = ItemIdentifiers.BERTS_ROTA;
  const SANDYS_ROTA = ItemIdentifiers.SANDYS_ROTA;
  const MAGIC_SCROLL = ItemIdentifiers.A_MAGIC_SCROLL_2;
  const MAGICAL_ORB = ItemIdentifiers.MAGICAL_ORB;
  const MAGICAL_ORB_ACTIVE = ItemIdentifiers.MAGICAL_ORB_A_;
  const TRUTH_SERUM = ItemIdentifiers.TRUTH_SERUM;
  const BOTTLED_WATER = ItemIdentifiers.BOTTLED_WATER;
  const REDBERRY_JUICE = ItemIdentifiers.REDBERRY_JUICE;
  const PINK_DYE = ItemIdentifiers.PINK_DYE;
  const ROSE_TINTED_LENS = ItemIdentifiers.ROSE_TINTED_LENS;
  const WIZARDS_HEAD = ItemIdentifiers.WIZARDS_HEAD;
  const SAND = ItemIdentifiers.SAND;
  const BEER = ItemIdentifiers.BEER;
  const VIAL = ItemIdentifiers.VIAL;
  const REDBERRIES = ItemIdentifiers.REDBERRIES;
  const WHITE_BERRIES = ItemIdentifiers.WHITE_BERRIES;
  const LANTERN_LENS = ItemIdentifiers.LANTERN_LENS;
  const EARTH_RUNE = ItemIdentifiers.EARTH_RUNE;
  const BUCKET_OF_SAND = ItemIdentifiers.BUCKET_OF_SAND;

  const SANDYS_DESK = ObjectIdentifiers.SANDYS_DESK; // 10805
  const SANDYS_COFFEE_MUG = ObjectIdentifiers.SANDYS_COFFEE_MUG; // 10807
  const BETTYS_COUNTER = ObjectIdentifiers.COUNTER_15; // 10813, Betty's counter

  const SERUM_UNSTARTED = 0;
  const SERUM_BOTTLE = 1;
  const SERUM_JUICE = 2;
  const SERUM_DYE = 3;
  const SERUM_LENS = 4;
  const SERUM_MADE = 5;
  const SERUM_FINISHED = 6;

  // npc-dialogue:action / message step ids from the transcript.
  const INTRO_REQUIREMENTS_ID = "Jw8a7L"; // wiki "unavailable" marker before Bert's accept choice
  const HAND_GIVEN_MESSAGE = "qRJX_b";
  const BEER_GIVEN_MESSAGE = "cuuImx";
  const HAND_DELIVERED_MESSAGE = "xmk0Dj";
  const HAND_HANDED_OVER_MESSAGE = "6h4uAt";
  const BERT_LOST_HAND_ACTION = "VVhA4L";
  const CAPTAIN_RECLAIM_ACTION = "ZSl2q4";
  const PICKPOCKET_SAND_MESSAGE = "som7PD";
  const DESK_ROTA_MESSAGE = "BqwMgQ";
  const BERT_ROTA_ACTION = "PCAoQQ";
  const SCROLL_ACTION = "de44Zn";
  const SCROLL_EXCHANGE_MESSAGE = "FaLLxx";
  const BETTY_TELEPORT_ACTION = "AkVFLg";
  const BETTY_VIAL_MESSAGE = "sB80ti";
  const LENS_COUNTER_MESSAGE = "qbH1_c";
  const SERUM_SAND_MESSAGE = "UUCsu7";
  const NEW_SERUM_MESSAGE = "zSmspN";
  const POUR_SERUM_MESSAGE = "WGVaaL";
  const ORB_ACTIVATED_MESSAGE = "s5YSQy";
  const ORB_FULL_MESSAGE = "OU4xhJ";
  const ORB_HANDED_MESSAGE = "qH5Grc";
  const SANDPIT_FILLED_MESSAGE = "LYif21";
  const CUTSCENE_END_ACTION = "Fpv9k6";
  const MAZION_HEAD_MESSAGES = new Set(["cP49nl", "znrG1s"]);
  const SHOW_HEAD_MESSAGE = "98WmUL";
  const COMPLETE_ACTION_ID = "q_UjQ0";
  const LOST_ROTA_CONDITION_ID = "SAfkA5";
  const LOST_ORB_RETURN_CONDITION_ID = "4j2GjS";
  const DISTRACTION_SUCCESS_IDS = new Set(["PnEgz7", "6Km3cy", "mPtYUe"]);

  const SERUM_ATTRIBUTE = "quest.hand_in_the_sand.serum";
  const COUNTER_ATTRIBUTE = "quest.hand_in_the_sand.counter";
  const QUESTION_ATTRIBUTES = [
    "quest.hand_in_the_sand.question1",
    "quest.hand_in_the_sand.question2",
    "quest.hand_in_the_sand.question3",
  ];
  const QUESTION_OPTIONS = new Map([
    ["Why is Bert's rota different from the original?", 0],
    ["Why doesn't Bert remember the change in his hours?", 1],
    ["What happened to the wizard?", 2],
  ]);

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function serumLevel(player) {
    return Number(player.getAttribute(SERUM_ATTRIBUTE)) || SERUM_UNSTARTED;
  }

  function setSerum(player, value) {
    player.setAttribute(SERUM_ATTRIBUTE, value);
  }

  function allQuestionsAsked(player) {
    return QUESTION_ATTRIBUTES.every((attribute) => player.getAttribute(attribute) === false);
  }

  function setQuestion(player, index, asked) {
    player.setAttribute(QUESTION_ATTRIBUTES[index], asked);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Bert the sandpit worker in Yanille asked me to</str>",
        "<str>investigate the hand he found in the sand.</str>",
        "<str>I tracked down Clarence's murderer, the sand</str>",
        "<str>merchant Sandy, and had the sandpit refilled.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    const lines = [];
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Bert</col> in",
        "<col=800000>Yanille</col>, in the house near the <col=800000>Sandpit</col>.",
        "",
        "Before I begin I will need to:",
        "Have level 17 <col=800000>Thieving</col>.",
        "Have level 49 <col=800000>Crafting</col>.",
      ];
    }
    lines.push("<str>Bert the sandpit worker in Yanille asked me to</str>");
    lines.push("<str>investigate the hand he found in the sand.</str>");
    if (stage >= STAGE_INVESTIGATE_HAND && stage < STAGE_ASK_WIZARDS) {
      lines.push("I should show the hand to the <col=800000>Guard Captain</col>");
      lines.push("in the <col=800000>Dragon Inn</col> south of the sandpit, with a beer.");
    }
    if (stage >= STAGE_ASK_WIZARDS) {
      lines.push("<str>I have spoken to the Guard Captain.</str>");
    }
    if (stage >= STAGE_ASK_WIZARDS && stage < STAGE_BERT_HOURS) {
      lines.push("I need to see if the <col=800000>Wizards</col> in the guild in");
      lines.push("<col=800000>Yanille</col> know anything about the hand.");
    }
    if (stage >= STAGE_BERT_HOURS) {
      lines.push("<str>I have shown the hand to the Wizards in Yanille.</str>");
    }
    if (stage >= STAGE_BERT_HOURS && stage < STAGE_VISIT_SANDY) {
      lines.push("Find out why <col=800000>Bert's</col> hours have changed.");
    }
    if (stage >= STAGE_VISIT_SANDY) {
      lines.push("<str>I have Bert's copy of the rota.</str>");
    }
    if (stage >= STAGE_VISIT_SANDY && stage < STAGE_CONFRONT_BERT) {
      lines.push("I should ask <col=800000>Sandy</col> at the Sand Corp offices");
      lines.push("in <col=800000>Brimhaven</col> about Bert's rota.");
    }
    if (stage >= STAGE_CONFRONT_BERT) {
      lines.push("<str>I have Sandy's copy of the rota.</str>");
    }
    if (stage >= STAGE_CONFRONT_BERT && stage < STAGE_DELIVER_SCROLL) {
      lines.push("Show <col=800000>Bert</col> the changes in his hours.");
    }
    if (stage >= STAGE_DELIVER_SCROLL && stage < STAGE_MAKE_SERUM) {
      lines.push("Ring the bell at the <col=800000>Wizard Guild</col> in Yanille and");
      lines.push("give the scroll to <col=800000>Zavistic Rarve</col>.");
    }
    if (stage >= STAGE_MAKE_SERUM) {
      lines.push("<str>I have taken the scroll to Zavistic Rarve.</str>");
    }
    if (stage >= STAGE_MAKE_SERUM && stage < STAGE_DISTRACT_SANDY) {
      const serum = serumLevel(player);
      lines.push("<col=800000>Betty</col> in <col=800000>Port Sarim</col> is helping me make a");
      lines.push("<col=800000>Truth Serum</col> to use on Sandy:");
      lines.push(serum >= SERUM_DYE ? "<str>I have made the pink dye.</str>" : "I need to make some redberry juice and pink dye.");
      lines.push(serum >= SERUM_LENS ? "<str>I have made the rose tinted lens.</str>" : "I need to make a rose tinted lens.");
      lines.push(serum >= SERUM_MADE ? "<str>I have the truth serum.</str>" : "I need to focus the lens on Betty's counter.");
      lines.push(serum >= SERUM_FINISHED ? "<str>I have added the sand to the serum.</str>" : "I need something personal from Sandy to finish it.");
    }
    if (stage >= STAGE_DISTRACT_SANDY && stage < STAGE_DRUG_COFFEE) {
      lines.push("Find a way to make <col=800000>Sandy</col> drink the <col=800000>Truth Serum</col>.");
    }
    if (stage >= STAGE_DRUG_COFFEE) {
      lines.push("<str>I have distracted Sandy successfully.</str>");
    }
    if (stage >= STAGE_DRUG_COFFEE && stage < STAGE_ACTIVATE_ORB) {
      lines.push("I should pour the serum into <col=800000>Sandy's coffee</col>.");
    }
    if (stage >= STAGE_ACTIVATE_ORB) {
      lines.push("<str>I have drugged Sandy's coffee.</str>");
    }
    if (stage >= STAGE_ACTIVATE_ORB && stage < STAGE_INTERROGATE_SANDY) {
      lines.push("I must activate the <col=800000>magical scrying orb</col> and then");
      lines.push("question Sandy about the hand.");
    }
    if (stage >= STAGE_INTERROGATE_SANDY) {
      lines.push("<str>I have activated the magical scrying orb.</str>");
    }
    if (stage >= STAGE_INTERROGATE_SANDY && stage < STAGE_RETURN_ORB) {
      lines.push("Ask <col=800000>Sandy</col> about the <col=800000>Hand in the Sand</col>.");
    }
    if (stage >= STAGE_RETURN_ORB) {
      lines.push("<str>I have interrogated Sandy.</str>");
    }
    if (stage >= STAGE_RETURN_ORB && stage < STAGE_GATHER_RUNES) {
      lines.push("Return the information to <col=800000>Zavistic Rarve</col> in the");
      lines.push("<col=800000>Yanille</col> wizard guild.");
    }
    if (stage >= STAGE_GATHER_RUNES) {
      lines.push("<str>I have returned the information from the orb.</str>");
    }
    if (stage >= STAGE_GATHER_RUNES && stage < STAGE_SEARCH_ENTRANA) {
      lines.push("Bring <col=800000>Zavistic</col> 5 <col=800000>earth runes</col> and a");
      lines.push("<col=800000>bucket of sand</col>.");
    }
    if (stage >= STAGE_SEARCH_ENTRANA) {
      lines.push("<str>The sandpit has been enchanted.</str>");
    }
    if (stage >= STAGE_SEARCH_ENTRANA && stage < STAGE_RETURN_HEAD) {
      lines.push("Visit the <col=800000>Entrana sandpit</col> and return any other");
      lines.push("wizard parts.");
    }
    if (stage >= STAGE_RETURN_HEAD) {
      lines.push("<str>I have retrieved the head of a wizard.</str>");
    }
    if (stage >= STAGE_RETURN_HEAD && stage < STAGE_COMPLETE) {
      lines.push("Return the <col=800000>wizard's head</col> to <col=800000>Zavistic Rarve</col>.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 9000);
    player.getSkillManager().addExperiences(Skill.THIEVING, 1000);
  }

  // ==========================================================================
  // Dialogue variant selection
  // ==========================================================================

  function bertVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_DELIVER_SCROLL) return "returning-to-bert-with-his-original-rota-talking-afterwards";
    if (stage >= STAGE_CONFRONT_BERT) return "returning-to-bert-with-his-original-rota";
    if (stage >= STAGE_VISIT_SANDY) return "getting-bert-s-rota-talking-to-bert-afterwards";
    if (stage >= STAGE_BERT_HOURS) return "getting-bert-s-rota";
    if (stage >= STAGE_ASK_WIZARDS) return "talking-to-guard-captain-talking-to-bert-afterwards";
    if (stage >= STAGE_INVESTIGATE_HAND) {
      return held(player, SANDY_HAND)
        ? "talking-to-bert-talking-to-bert-again"
        : "talking-to-guard-captain-talking-to-bert-afterwards";
    }
    return "talking-to-bert";
  }

  function guardCaptainVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_BERT_HOURS) return "talking-to-zavistic-rarve-talking-to-guard-captain-afterwards";
    if (stage >= STAGE_ASK_WIZARDS) {
      return held(player, BEER_SOAKED_HAND)
        ? "talking-to-zavistic-rarve-talking-to-guard-captain-afterwards"
        : "talking-to-guard-captain-reclaiming-the-beer-soaked-hand-from-the-captain";
    }
    if (stage >= STAGE_INVESTIGATE_HAND) {
      return held(player, BEER) && held(player, SANDY_HAND)
        ? "talking-to-guard-captain-talking-again-with-a-beer"
        : "talking-to-guard-captain";
    }
    return null;
  }

  function sandyVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage === STAGE_VISIT_SANDY) {
      return held(player, SANDYS_ROTA)
        ? "getting-sandy-s-rota-talking-to-sandy-with-sandy-s-rota-in-the-inventory"
        : "getting-sandy-s-rota-talking-to-sandy";
    }
    if (stage === STAGE_CONFRONT_BERT) {
      return held(player, SANDYS_ROTA)
        ? "getting-sandy-s-rota-talking-to-sandy-with-sandy-s-rota-in-the-inventory"
        : null;
    }
    if (stage === STAGE_DISTRACT_SANDY) return "the-truth-serum-distracting-sandy";
    if (stage >= STAGE_INTERROGATE_SANDY && stage < STAGE_RETURN_ORB) {
      return "the-truth-serum-talking-to-sandy-afterwards";
    }
    if (stage >= STAGE_MAKE_SERUM) return "the-truth-serum-talking-to-sandy-again";
    return null;
  }

  function zavisticVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_RETURN_HEAD) {
      return held(player, WIZARDS_HEAD)
        ? "checking-the-entrana-sandpit-if-the-player-has-checked-the-entrana-sandpit"
        : "checking-the-entrana-sandpit-if-the-player-has-not-checked-the-entrana-sandpit";
    }
    if (stage >= STAGE_SEARCH_ENTRANA) {
      return "checking-the-entrana-sandpit-if-the-player-has-not-checked-the-entrana-sandpit";
    }
    if (stage >= STAGE_GATHER_RUNES) {
      return "returning-back-to-zavistic-with-the-magical-orb-talking-to-zavistic-rarve-again";
    }
    if (stage >= STAGE_RETURN_ORB) return "returning-back-to-zavistic-with-the-magical-orb";
    if (stage >= STAGE_INTERROGATE_SANDY) {
      return "returning-back-to-zavistic-talking-to-zavistic-again";
    }
    if (stage >= STAGE_DISTRACT_SANDY) return "talking-to-betty-talking-to-zavistic-rarve-again";
    if (stage >= STAGE_MAKE_SERUM) return "returning-back-to-zavistic-talking-to-zavistic-again";
    if (stage >= STAGE_DELIVER_SCROLL) return "returning-back-to-zavistic";
    if (stage >= STAGE_BERT_HOURS) return "talking-to-zavistic-rarve-talking-to-zavistic-afterwards";
    if (stage >= STAGE_ASK_WIZARDS) return "talking-to-zavistic-rarve";
    return null;
  }

  function bettyVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_ACTIVATE_ORB) return "the-truth-serum-returning-to-betty";
    if (stage >= STAGE_DISTRACT_SANDY) return "talking-to-betty-talking-to-betty-again";
    if (stage >= STAGE_MAKE_SERUM) {
      const serum = serumLevel(player);
      if (serum >= SERUM_FINISHED) return "talking-to-betty-talking-to-betty-again";
      if (serum >= SERUM_MADE) return "talking-to-betty-talking-to-betty-afterwards";
      if (serum >= SERUM_LENS) {
        return held(player, ROSE_TINTED_LENS)
          ? "talking-to-betty-talking-to-betty-with-the-lens"
          : "talking-to-betty-talking-to-betty-without-the-rose-tinted-lens";
      }
      if (serum >= SERUM_BOTTLE) {
        return "talking-to-betty-talking-to-betty-without-the-rose-tinted-lens";
      }
      return "talking-to-betty";
    }
    return null;
  }

  function mazionVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_RETURN_HEAD) {
      return held(player, WIZARDS_HEAD)
        ? "checking-the-entrana-sandpit-talking-to-mazion-talking-to-mazion-with-the-head"
        : "checking-the-entrana-sandpit-talking-to-mazion-reclaiming-the-wizard-s-head";
    }
    if (stage === STAGE_SEARCH_ENTRANA) return "checking-the-entrana-sandpit-talking-to-mazion";
    return null;
  }

  function selectVariant({ npcId, player }) {
    if (BERT_NPC_IDS.has(npcId)) return bertVariant(player);
    if (npcId === GUARD_CAPTAIN_NPC_ID) return guardCaptainVariant(player);
    if (SANDY_NPC_IDS.has(npcId)) return sandyVariant(player);
    if (npcId === ZAVISTIC_NPC_ID) return zavisticVariant(player);
    if (npcId === BETTY_NPC_ID) return bettyVariant(player);
    if (npcId === MAZION_NPC_ID) return mazionVariant(player);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  /** Answers the page's prose conditions. Deliberately not guarded by npcId. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase().replace(/[\u2018\u2019]/g, "'");
    const has = (itemId) => held(player, itemId);
    if (value.includes("inventory space")) return freeSlots(player) < 1;
    if (value.includes("speaking to zavistic rarve via the bell")) return false;
    if (value.includes("completed zogre flesh eaters")) return false;
    if (value.includes("speaking to zavistic rarve inside the guild")) return true;
    if (value.includes("does not have the beer soaked hand")) return !has(BEER_SOAKED_HAND);
    if (value.includes("has the beer soaked hand")) return has(BEER_SOAKED_HAND);
    if (value.includes("lost the sandy hand")) return !has(BEER_SOAKED_HAND);
    if (value.includes("lost the rota")) return !has(BERTS_ROTA);
    if (value.includes("does not have sandy's rota")) return !has(SANDYS_ROTA);
    if (value.includes("already has sandy's rota")) return has(SANDYS_ROTA);
    if (value.includes("pickpocket attempt fails")) return false;
    if (value.includes("pickpocket attempt succeeds")) return true;
    if (value.includes("has lost the magical orb")) {
      return !has(MAGICAL_ORB) && !has(MAGICAL_ORB_ACTIVE);
    }
    if (value.includes("does not have a vial with them")) return !has(VIAL);
    if (value.includes("has a vial with them")) return has(VIAL);
    if (value.includes("doesn't have an empty vial")) return !has(VIAL);
    if (value.includes("doesn't have the sand")) return !has(SAND);
    if (value.includes("lost the truth serum")) return !has(TRUTH_SERUM);
    if (value.includes("truth serum isn't complete")) return serumLevel(player) < SERUM_FINISHED;
    if (value.includes("sandy has not been distracted")) {
      return quest.getStage(player) < STAGE_DRUG_COFFEE;
    }
    if (value.includes("sandy has been distracted")) {
      return quest.getStage(player) >= STAGE_DRUG_COFFEE;
    }
    if (value.includes("distracting sandy succeeds")) return true;
    if (value.includes("distracting sandy fails")) return false;
    if (value.includes("magical orb is not activated")) return !has(MAGICAL_ORB_ACTIVE);
    if (value.includes("magical orb is activated")) return has(MAGICAL_ORB_ACTIVE);
    if (value.includes("all the available questions have not been asked")) {
      return !allQuestionsAsked(player);
    }
    if (value.includes("not all questions have been asked")) return !allQuestionsAsked(player);
    if (value.includes("all questions have been asked")) return allQuestionsAsked(player);
    if (value.includes("orb is lost or isn't in the player's inventory")) {
      return !has(MAGICAL_ORB_ACTIVE);
    }
    if (value.includes("with the orb in hand")) return has(MAGICAL_ORB_ACTIVE);
    if (value.includes("doesn't have the required items")) {
      return (
        player.getInventory().getAmount(EARTH_RUNE) < 5 ||
        !has(BUCKET_OF_SAND)
      );
    }
    return null;
  }

  // ==========================================================================
  // Dialogue hooks / actions
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (!BERT_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_INVESTIGATE_HAND) {
      quest.setStage(player, STAGE_INVESTIGATE_HAND);
    }
  }

  /** 17 Thieving and 49 Crafting, checked at Bert's intro requirements marker. */
  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getCurrentLevel(Skill.THIEVING) >= 17 &&
      skills.getCurrentLevel(Skill.CRAFTING) >= 49
    );
  }

  /** Message and action steps that hand items over, consume them or advance the quest. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    // `message` steps fire twice: once as an action, once with kind "message".
    if (event.kind === "message") {
      if (stepId === HAND_GIVEN_MESSAGE) {
        if (quest.getStage(player) < STAGE_INVESTIGATE_HAND) {
          quest.setStage(player, STAGE_INVESTIGATE_HAND);
          for (let index = 0; index < QUESTION_ATTRIBUTES.length; index++) {
            setQuestion(player, index, true);
          }
        }
        if (!held(player, SANDY_HAND) && !held(player, BEER_SOAKED_HAND)) {
          player.getInventory().adds(SANDY_HAND, 1);
        }
        return;
      }
      if (stepId === BEER_GIVEN_MESSAGE) {
        if (held(player, BEER)) player.getInventory().deleteNumber(BEER, 1);
        return;
      }
      if (stepId === HAND_DELIVERED_MESSAGE) {
        if (quest.getStage(player) < STAGE_ASK_WIZARDS) {
          if (held(player, SANDY_HAND)) player.getInventory().deleteNumber(SANDY_HAND, 1);
          if (!held(player, BEER_SOAKED_HAND)) player.getInventory().adds(BEER_SOAKED_HAND, 1);
          quest.setStage(player, STAGE_ASK_WIZARDS);
        }
        return;
      }
      if (stepId === HAND_HANDED_OVER_MESSAGE) {
        if (quest.getStage(player) < STAGE_BERT_HOURS) {
          if (held(player, BEER_SOAKED_HAND)) {
            player.getInventory().deleteNumber(BEER_SOAKED_HAND, 1);
          }
          quest.setStage(player, STAGE_BERT_HOURS);
        }
        return;
      }
      if (stepId === PICKPOCKET_SAND_MESSAGE) {
        if (quest.getStage(player) >= STAGE_INVESTIGATE_HAND && !held(player, SAND)) {
          player.getInventory().adds(SAND, 1);
        }
        return;
      }
      if (stepId === DESK_ROTA_MESSAGE) {
        if (!held(player, SANDYS_ROTA)) player.getInventory().adds(SANDYS_ROTA, 1);
        if (quest.getStage(player) < STAGE_CONFRONT_BERT) {
          quest.setStage(player, STAGE_CONFRONT_BERT);
        }
        return;
      }
      if (stepId === SCROLL_EXCHANGE_MESSAGE) {
        // Bert hands out a replacement scroll, so only exchange when carrying one.
        if (!held(player, MAGIC_SCROLL)) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(MAGIC_SCROLL, 1);
        if (!held(player, MAGICAL_ORB)) player.getInventory().adds(MAGICAL_ORB, 1);
        if (quest.getStage(player) < STAGE_MAKE_SERUM) quest.setStage(player, STAGE_MAKE_SERUM);
        return;
      }
      if (stepId === BETTY_VIAL_MESSAGE) {
        player.setAttribute(COUNTER_ATTRIBUTE, true);
        return;
      }
      if (stepId === LENS_COUNTER_MESSAGE) {
        if (held(player, ROSE_TINTED_LENS) && serumLevel(player) === SERUM_LENS) {
          player.getInventory().deleteNumber(ROSE_TINTED_LENS, 1);
          if (!held(player, TRUTH_SERUM)) player.getInventory().adds(TRUTH_SERUM, 1);
          setSerum(player, SERUM_MADE);
          player.setAttribute(COUNTER_ATTRIBUTE, false);
        }
        return;
      }
      if (stepId === SERUM_SAND_MESSAGE) {
        if (held(player, SAND)) player.getInventory().deleteNumber(SAND, 1);
        setSerum(player, SERUM_FINISHED);
        if (quest.getStage(player) < STAGE_DISTRACT_SANDY) {
          quest.setStage(player, STAGE_DISTRACT_SANDY);
        }
        return;
      }
      if (stepId === NEW_SERUM_MESSAGE) {
        if (!held(player, TRUTH_SERUM)) player.getInventory().adds(TRUTH_SERUM, 1);
        return;
      }
      if (stepId === POUR_SERUM_MESSAGE) {
        if (held(player, TRUTH_SERUM)) player.getInventory().deleteNumber(TRUTH_SERUM, 1);
        if (quest.getStage(player) < STAGE_ACTIVATE_ORB) {
          quest.setStage(player, STAGE_ACTIVATE_ORB);
        }
        return;
      }
      if (stepId === ORB_ACTIVATED_MESSAGE) {
        if (held(player, MAGICAL_ORB)) player.getInventory().deleteNumber(MAGICAL_ORB, 1);
        if (!held(player, MAGICAL_ORB_ACTIVE)) {
          player.getInventory().adds(MAGICAL_ORB_ACTIVE, 1);
        }
        if (quest.getStage(player) < STAGE_INTERROGATE_SANDY) {
          quest.setStage(player, STAGE_INTERROGATE_SANDY);
        }
        return;
      }
      if (stepId === ORB_FULL_MESSAGE) {
        if (quest.getStage(player) < STAGE_RETURN_ORB) quest.setStage(player, STAGE_RETURN_ORB);
        return;
      }
      if (stepId === ORB_HANDED_MESSAGE) {
        if (held(player, MAGICAL_ORB_ACTIVE)) {
          player.getInventory().deleteNumber(MAGICAL_ORB_ACTIVE, 1);
        }
        if (quest.getStage(player) < STAGE_GATHER_RUNES) {
          quest.setStage(player, STAGE_GATHER_RUNES);
        }
        return;
      }
      if (stepId === SANDPIT_FILLED_MESSAGE) {
        player.getInventory().deleteNumber(EARTH_RUNE, 5);
        player.getInventory().deleteNumber(BUCKET_OF_SAND, 1);
        if (quest.getStage(player) < STAGE_SEARCH_ENTRANA) {
          quest.setStage(player, STAGE_SEARCH_ENTRANA);
        }
        return;
      }
      if (MAZION_HEAD_MESSAGES.has(stepId)) {
        if (!held(player, WIZARDS_HEAD)) player.getInventory().adds(WIZARDS_HEAD, 1);
        if (quest.getStage(player) < STAGE_RETURN_HEAD) {
          quest.setStage(player, STAGE_RETURN_HEAD);
        }
        return;
      }
      if (stepId === SHOW_HEAD_MESSAGE) {
        if (held(player, WIZARDS_HEAD)) player.getInventory().deleteNumber(WIZARDS_HEAD, 1);
        return;
      }
      return;
    }

    if (stepId === INTRO_REQUIREMENTS_ID) {
      if (meetsRequirements(player)) {
        // Let the accept choice after the wiki marker still play.
        event.handled = true;
        return;
      }
      player.sendMessage("You do not meet all of the requirements to start The Hand in the Sand quest.");
      return;
    }

    if (event.action === "receive") {
      if (stepId === BERT_LOST_HAND_ACTION) {
        if (quest.getStage(player) >= STAGE_ASK_WIZARDS) {
          if (!held(player, BEER_SOAKED_HAND)) player.getInventory().adds(BEER_SOAKED_HAND, 1);
        } else if (!held(player, SANDY_HAND)) {
          player.getInventory().adds(SANDY_HAND, 1);
        }
        return;
      }
      if (stepId === CAPTAIN_RECLAIM_ACTION) {
        if (!held(player, BEER_SOAKED_HAND)) player.getInventory().adds(BEER_SOAKED_HAND, 1);
        return;
      }
      if (stepId === BERT_ROTA_ACTION) {
        if (!held(player, BERTS_ROTA)) player.getInventory().adds(BERTS_ROTA, 1);
        if (quest.getStage(player) < STAGE_VISIT_SANDY) quest.setStage(player, STAGE_VISIT_SANDY);
        return;
      }
      if (stepId === SCROLL_ACTION) {
        if (held(player, BERTS_ROTA)) player.getInventory().deleteNumber(BERTS_ROTA, 1);
        if (held(player, SANDYS_ROTA)) player.getInventory().deleteNumber(SANDYS_ROTA, 1);
        if (!held(player, MAGIC_SCROLL)) player.getInventory().adds(MAGIC_SCROLL, 1);
        if (quest.getStage(player) < STAGE_DELIVER_SCROLL) {
          quest.setStage(player, STAGE_DELIVER_SCROLL);
        }
        return;
      }
    }

    if (event.action === "teleport" && stepId === BETTY_TELEPORT_ACTION) {
      if (held(player, VIAL)) player.getInventory().deleteNumber(VIAL, 1);
      player.moveTo(new api.core.Location(3014, 3259, 0));
      event.handled = true;
      return;
    }

    if (stepId === CUTSCENE_END_ACTION) {
      player.getInventory().deleteNumber(EARTH_RUNE, 5);
      player.getInventory().deleteNumber(BUCKET_OF_SAND, 1);
      if (quest.getStage(player) < STAGE_SEARCH_ENTRANA) {
        quest.setStage(player, STAGE_SEARCH_ENTRANA);
      }
      event.handled = true;
      return;
    }

    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player)) quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  /** Conditions whose chosen branch carries a side effect. */
  function handleCondition(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === LOST_ROTA_CONDITION_ID) {
      if (
        quest.getStage(player) === STAGE_VISIT_SANDY &&
        !held(player, BERTS_ROTA) &&
        freeSlots(player) > 0
      ) {
        player.getInventory().adds(BERTS_ROTA, 1);
      }
      return;
    }
    if (stepId === LOST_ORB_RETURN_CONDITION_ID) {
      if (quest.getStage(player) === STAGE_RETURN_ORB) quest.setStage(player, STAGE_GATHER_RUNES);
      return;
    }
    if (DISTRACTION_SUCCESS_IDS.has(stepId)) {
      if (quest.getStage(player) === STAGE_DISTRACT_SANDY) {
        quest.setStage(player, STAGE_DRUG_COFFEE);
      }
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || !option) return;
    const text = String(option);
    if (npcId === ZAVISTIC_NPC_ID && text === "I've lost my magical scrying orb!") {
      if (freeSlots(player) < 1) return;
      const stage = quest.getStage(player);
      const orb = stage >= STAGE_INTERROGATE_SANDY ? MAGICAL_ORB_ACTIVE : MAGICAL_ORB;
      if (!held(player, orb)) player.getInventory().adds(orb, 1);
      return;
    }
    if (SANDY_NPC_IDS.has(npcId) && quest.getStage(player) === STAGE_INTERROGATE_SANDY) {
      const index = QUESTION_OPTIONS.get(text);
      if (index !== undefined) setQuestion(player, index, false);
    }
  }

  /** Blanks and one-off hand-overs that live in transcript speech lines. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!player) return;
    if (npcId === BETTY_NPC_ID && text === "I have one here!") {
      if (quest.getStage(player) === STAGE_MAKE_SERUM && serumLevel(player) === SERUM_UNSTARTED) {
        if (held(player, VIAL)) player.getInventory().deleteNumber(VIAL, 1);
        setSerum(player, SERUM_BOTTLE);
        if (!held(player, BOTTLED_WATER)) player.getInventory().adds(BOTTLED_WATER, 1);
      }
      return;
    }
    if (BERT_NPC_IDS.has(npcId) && String(text).startsWith("I be hopin' tha search")) {
      if (quest.getStage(player) !== STAGE_DELIVER_SCROLL) return;
      if (held(player, MAGIC_SCROLL) || held(player, MAGICAL_ORB) || held(player, MAGICAL_ORB_ACTIVE)) {
        return;
      }
      if (freeSlots(player) > 0) player.getInventory().adds(MAGIC_SCROLL, 1);
    }
  }

  // ==========================================================================
  // World interactions
  // ==========================================================================

  function searchSandyDesk(player) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_VISIT_SANDY && stage !== STAGE_CONFRONT_BERT) {
      player.sendMessage("You find nothing of interest.");
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.SANDY,
      PAGE,
      "getting-sandy-s-rota-searching-sandy-s-desk"
    );
  }

  function pickpocketSandy(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_INVESTIGATE_HAND) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    startTranscript(api, player, event.npcId, PAGE, "getting-sandy-s-rota-pickpocketing-sandy");
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const targetId = event.target?.getId?.();
    if (targetId === GUARD_CAPTAIN_NPC_ID && itemId === BEER) {
      if (
        quest.getStage(player) === STAGE_INVESTIGATE_HAND &&
        held(player, SANDY_HAND)
      ) {
        event.handled = true;
        startTranscript(
          api,
          player,
          GUARD_CAPTAIN_NPC_ID,
          PAGE,
          "talking-to-guard-captain-talking-again-with-a-beer"
        );
      }
      return;
    }
    if (
      targetId === ZAVISTIC_NPC_ID &&
      (itemId === BEER_SOAKED_HAND || itemId === SANDY_HAND) &&
      quest.getStage(player) === STAGE_ASK_WIZARDS
    ) {
      event.handled = true;
      startTranscript(api, player, ZAVISTIC_NPC_ID, PAGE, "talking-to-zavistic-rarve");
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const first = event.usedItemId;
    const second = event.usedWithItemId;
    const pair = (a, b) => (first === a && second === b) || (first === b && second === a);
    if (pair(BOTTLED_WATER, REDBERRIES)) {
      event.handled = true;
      player.getInventory().deleteNumber(BOTTLED_WATER, 1);
      player.getInventory().deleteNumber(REDBERRIES, 1);
      player.getInventory().adds(REDBERRY_JUICE, 1);
      setSerum(player, SERUM_JUICE);
      player.sendMessage("Now you just need to add the white berries to make the pink dye.");
      return;
    }
    if (pair(REDBERRY_JUICE, WHITE_BERRIES)) {
      event.handled = true;
      player.getInventory().deleteNumber(REDBERRY_JUICE, 1);
      player.getInventory().deleteNumber(WHITE_BERRIES, 1);
      player.getInventory().adds(PINK_DYE, 1);
      setSerum(player, SERUM_DYE);
      return;
    }
    if (pair(PINK_DYE, LANTERN_LENS)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_MAKE_SERUM) {
        player.sendMessage("Nothing interesting happens.");
        return;
      }
      player.getInventory().deleteNumber(PINK_DYE, 1);
      player.getInventory().deleteNumber(LANTERN_LENS, 1);
      player.getInventory().adds(ROSE_TINTED_LENS, 1);
      setSerum(player, SERUM_LENS);
      player.sendMessage("You have successfully made the rose tinted lens!");
      return;
    }
    if (pair(SAND, TRUTH_SERUM)) {
      event.handled = true;
      player.sendMessage("Perhaps you should let Betty do that, it looks tricky.");
    }
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (objectId === SANDYS_DESK) {
      event.handled = true;
      searchSandyDesk(player);
      return;
    }
    if (objectId === SANDYS_COFFEE_MUG && itemId === TRUTH_SERUM) {
      event.handled = true;
      startTranscript(
        api,
        player,
        NpcIdentifiers.SANDY,
        PAGE,
        "the-truth-serum-attempting-to-pour-the-truth-serum-inside-sandy-s-coffee-mug"
      );
      return;
    }
    if (objectId === BETTYS_COUNTER && itemId === ROSE_TINTED_LENS) {
      event.handled = true;
      if (
        quest.getStage(player) !== STAGE_MAKE_SERUM ||
        serumLevel(player) !== SERUM_LENS ||
        !held(player, ROSE_TINTED_LENS) ||
        player.getAttribute(COUNTER_ATTRIBUTE) !== true
      ) {
        return;
      }
      startTranscript(
        api,
        player,
        BETTY_NPC_ID,
        PAGE,
        "talking-to-betty-using-the-lens-on-the-counter"
      );
    }
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player || itemId !== MAGICAL_ORB) return;
    if (String(option).toLowerCase() !== "activate") return;
    if (quest.getStage(player) !== STAGE_ACTIVATE_ORB) return;
    event.handled = true;
    startTranscript(
      api,
      player,
      ZAVISTIC_NPC_ID,
      PAGE,
      "the-truth-serum-activating-the-magical-orb"
    );
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || objectId !== SANDYS_DESK) return;
    event.handled = true;
    searchSandyDesk(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(SERUM_ATTRIBUTE);
  api.persistAttribute(COUNTER_ATTRIBUTE);
  for (const attribute of QUESTION_ATTRIBUTES) api.persistAttribute(attribute);

  quest = registerQuest(api, {
    key: "hand_in_the_sand",
    name: "The Hand in the Sand",
    varpId: VARP_HAND_IN_THE_SAND,
    startedValue: STAGE_INVESTIGATE_HAND,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 9000, label: "Crafting" },
      { skillId: Skill.THIEVING.getIndex(), amount: 1000, label: "Thieving" },
    ],
    scrollItemId: ItemIdentifiers.SANDY_HAND,
    otherRewards: [
      "Access to the Wizards' Guild Rune Store",
      "A secret reward from Bert",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onNpcInteraction("Sandy", { Pickpocket: pickpocketSandy });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
};
