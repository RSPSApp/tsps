/**
 * The Hand in the Sand (members).
 *
 * The words come from the "The Hand in the Sand" transcript page; this plugin
 * supplies the variant selector for Bert, the Guard Captain, Zavistic Rarve,
 * Sandy, Betty and Mazion, the prose-condition answers, the start hook, the
 * item hand-ins (sandy hand, beer, beer soaked hand, rotas, scroll, orb, head)
 * and the item-on-object/NPC actions (desk search, pickpocket, truth serum,
 * rose-tinted lens on the counter, orb activation), the Wizards' Guild bell and
 * the sandpit cutscene.
 *
 * Aligned with a whole revision 242 run (rsprox capture local 1002235; ticks in
 * docs/quests/hand-in-the-sand/README.md): stage values and the moment each is set,
 * the item and statement boxes, sounds, the question varbits 1528-1530, Sandy's
 * window varbit 1535 and the coffee mug's 1536, Zavistic's teleport to Betty and
 * the sandpit cutscene. The Wiki's words stay where the capture words a line
 * differently (the dump keeps them).
 *
 * Stages (varbit 1527 handsand_quest in varp 635 bits 0-8):
 * 10 investigate hand, 20 ask wizards, 30 Bert's hours, 40 visit Sandy, 50
 * confront Bert, 60 deliver scroll, 70 make serum, 80 distract Sandy, 90 drugged
 * coffee, 100 activate orb, 110 interrogate Sandy, 120 return orb, 130 gather
 * runes, 140 search Entrana, 150 return head, 160 complete.
 *
 * Shared: Zogre Flesh Eaters owns the same Wizards' Guild bell and Zavistic.
 * This quest claims the bell only on its Quest Helper bell steps and hands the
 * shared entry point over to Zogre while Zogre still needs it (the bell for
 * its evidence conversation, Zavistic for its evidence hand-in).
 * Gaps: Bert's post-quest daily 84-bucket sand delivery and the Wizards' Guild
 * shop unlock are not reproduced; the lens must be used on the counter without
 * the doorway/light check.
 */
module.exports = function registerHandInTheSandQuest(api) {
  const { Animation, Graphic, Location, Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const { createWizardsGuildBell } = require("../WizardsGuildBell");

  const PAGE = "The Hand in the Sand";

  const ZAVISTIC_NPC_ID = NpcIdentifiers.ZAVISTIC_RARVE;
  const GUARD_CAPTAIN_NPC_ID = NpcIdentifiers.GUARD_CAPTAIN;
  const SANDY_NPC_IDS = new Set([NpcIdentifiers.SANDY, NpcIdentifiers.SANDY_2]);
  const MAZION_NPC_ID = NpcIdentifiers.MAZION;
  const BERT_NPC_IDS = new Set([NpcIdentifiers.BERT, NpcIdentifiers.BERT_2]);
  const BETTY_NPC_ID = NpcIdentifiers.BETTY;
  const BERT_SANDPIT_NPC_ID = 5382; // handsand_bert, the multinpc the capture's cutscene places

  const VARBIT_HAND_IN_THE_SAND = 1527; // handsand_quest: varp 635 bits 0-8
  /** handsand_question1-3: 1 from the start, 0 once that question has been asked (t7273, t8307, t8318, t8337). */
  const VARBIT_QUESTIONS = [1528, 1529, 1530];
  const VARBIT_TELEPORTED = 1531; // handsand_tele: varp 635 bit 12
  const VARBIT_SERUM = 1532; // handsand_serum: varp 635 bits 13-15
  /** handsand_sandy_multi: Sandy at his desk (0), looking out of the window (1, t8266), gone after the quest (2, t9032). */
  const VARBIT_SANDY = 1535;
  /** handsand_coffee_multi: Sandy's mug (0) or the bare table once he is arrested (1, t9032). */
  const VARBIT_COFFEE = 1536;
  const VARBIT_COUNTER = 1537; // handsand_counter_multi: varp 636 bits 9-10
  const SANDY_AT_DESK = 0;
  const SANDY_AT_WINDOW = 1;
  const SANDY_GONE = 2;
  const WGS_SEED_COUNTER_FROM = 250; // Fellowship.WhileGuthixSleeps owns 1537 here.
  const WGS_SEED_COUNTER_UNTIL = 280;
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

  // Zogre Flesh Eaters also owns the same outdoor bell. Claim it only for the
  // steps where The Hand in the Sand's Quest Helper route rings it (20, 60, 70,
  // 120, 130, 150); stage 110 is the Sandy interrogation, so the bell is not
  // part of that step. Outside that window, leave the bell to Zogre's handler.
  const BELL_STAGES = new Set([
    STAGE_ASK_WIZARDS,
    STAGE_DELIVER_SCROLL,
    STAGE_MAKE_SERUM,
    STAGE_RETURN_ORB,
    STAGE_GATHER_RUNES,
    STAGE_RETURN_HEAD,
  ]);

  // Zogre Flesh Eaters shares the Wizards' Guild bell and Zavistic Rarve with
  // this quest. Zogre's evidence conversation is only reachable through the
  // bell and its evidence hand-in only through Zavistic, so Hand hands over the
  // shared entry point that Zogre still needs (Zogre's handlers are registered
  // after Hand's, so an unhandled event falls through to them).
  const ZOGRE_KEY = "zogre_flesh_eaters";
  const ZOGRE_STAGE_ATTRIBUTE = "quest.zogre_flesh_eaters.stage";
  const ZOGRE_SEARCH_ATTRIBUTE = "quest.zogre_flesh_eaters.search";
  const ZOGRE_STARTED_STAGE = 2;
  const ZOGRE_EVIDENCE_STAGE = 4;
  const ZOGRE_EVIDENCE_PROGRESS = 4;
  /** Zavistic's Zogre option, which only a player who has started Zogre Flesh Eaters is offered (t7925, t7989). */
  const ZOGRE_OPTION = "I'm here about the sicks...err Zogres";
  const SANDY_PROBLEM_OPTION = "I have a rather sandy problem that I'd like to palm off on you.";

  const START_HOOK = "quest:the-hand-in-the-sand:start";

  const SANDY_HAND = ItemIdentifiers.SANDY_HAND;
  const BEER_SOAKED_HAND = ItemIdentifiers.BEER_SOAKED_HAND;
  const BERTS_ROTA = ItemIdentifiers.BERTS_ROTA;
  const SANDYS_ROTA = ItemIdentifiers.SANDYS_ROTA;
  const MAGIC_SCROLL = ItemIdentifiers.A_MAGIC_SCROLL;
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
  const OUTDOOR_BELL = ObjectIdentifiers.BELL_2; // 6847, Wizards' Guild bell (shared with Zogre Flesh Eaters)

  const SERUM_UNSTARTED = 0;
  const SERUM_BOTTLE = 1;
  const SERUM_JUICE = 2;
  const SERUM_DYE = 3;
  const SERUM_LENS = 4;
  const SERUM_MADE = 5;
  const SERUM_FINISHED = 6;

  /** The capture's sounds (synth ids). */
  const SOUND = {
    VIAL_SHATTER: 1587, // handsand_vialshatter, the lens on the counter (t8118)
    DROP_HAND: 1588, // handsand_drop_hand, the hand in the Captain's beer (t7332)
    GULP: 1589, // handsand_gulp, the Captain's gulp of beer (t7316)
    ORB: 1590, // handsand_orb, rubbing the orb (t8280)
    SANDSWIRL: 1591, // handsand_sandswirl, the sandpit filling (t8616)
    SERUM: 1592, // handsand_serum, the serum in Sandy's coffee (t8276)
    DRIP_LIQUID: 2392, // drip_liquid, the dye on the lens (t8078)
    PUT_DOWN: 2739, // put_down, Betty's vial on her counter (t8104)
    TELEPORT: 200, // teleport_all, Zavistic sending the player to Betty (t8035)
  };
  const PICKPOCKET_ANIM = 881; // human_pickpocket, every attempt on Sandy (t7675-7683)
  /**
   * Zavistic's teleport (t8033-8037): human_shrink with teleport_casting two ticks after the continue, there two later.
   * A countdown started from the continue runs in that tick's task pass, so each count is one more than the gap.
   */
  const TELEPORT_ANIM = 3041;
  const TELEPORT_GFX = 111;
  const TELEPORT_GFX_HEIGHT = 92;
  const TELEPORT_CAST_TICKS = 3;
  const TELEPORT_LAND_TICKS = 5;
  const BETTYS_SHOP = [3014, 3259, 0];

  // npc-dialogue:action / message step ids from the transcript.
  const HAND_GIVEN_MESSAGE = "0PC9qk";
  const BEER_GIVEN_MESSAGE = "cuuImx";
  const HAND_DELIVERED_MESSAGE = "xmk0Dj";
  const HAND_WAVED_MESSAGE = "2uHFMU";
  const HAND_HANDED_OVER_MESSAGE = "r5kpiT";
  const BERT_LOST_HAND_ACTION = "VVhA4L";
  const CAPTAIN_RECLAIM_ACTION = "ZSl2q4";
  const PICKPOCKET_RUMMAGE_MESSAGE = "miiMuf";
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
  const JUICE_MESSAGE = "wXRNb8";
  const LENS_MADE_MESSAGE = "qPeefO";
  const ORB_ACTIVATED_MESSAGE = "s5YSQy";
  const ORB_FULL_MESSAGE = "OU4xhJ";
  const ORB_HANDED_MESSAGE = "qH5Grc";
  const CUTSCENE_START_ACTION = "m0RGEw";
  const CUTSCENE_FIRST_BOX = "ythkfh";
  const CUTSCENE_SECOND_BOX = "LYif21";
  const CUTSCENE_END_ACTION = "Fpv9k6"; // cutscene end; spends the 5 earth runes and the bucket of sand
  const MAZION_HEAD_MESSAGES = new Set(["cP49nl", "znrG1s"]);
  const SHOW_HEAD_MESSAGE = "98WmUL";
  const COMPLETE_ACTION_ID = "q_UjQ0";
  const LOST_ROTA_CONDITION_ID = "SAfkA5";
  const LOST_ORB_RETURN_CONDITION_ID = "4j2GjS";

  /**
   * How each of the page's boxes shows: the Wiki's tbox with a picture is an item box with that item, one without it
   * a statement box, as the capture sends them (objectbox 193 / messagebox 229). Steps not listed stay chat messages
   * (the Wiki's {{Mes}}).
   */
  const ITEM_BOXES = new Map([
    [HAND_GIVEN_MESSAGE, SANDY_HAND],
    [BEER_GIVEN_MESSAGE, BEER],
    [HAND_DELIVERED_MESSAGE, BEER_SOAKED_HAND],
    [HAND_WAVED_MESSAGE, BEER_SOAKED_HAND],
    [HAND_HANDED_OVER_MESSAGE, BEER_SOAKED_HAND],
    [SCROLL_EXCHANGE_MESSAGE, MAGICAL_ORB],
    [LENS_MADE_MESSAGE, ROSE_TINTED_LENS],
    [BETTY_VIAL_MESSAGE, VIAL],
    [LENS_COUNTER_MESSAGE, TRUTH_SERUM],
    [SERUM_SAND_MESSAGE, SAND],
    [NEW_SERUM_MESSAGE, TRUTH_SERUM],
    [ORB_ACTIVATED_MESSAGE, MAGICAL_ORB],
    [ORB_FULL_MESSAGE, MAGICAL_ORB_ACTIVE],
    ["cP49nl", WIZARDS_HEAD],
    ["znrG1s", WIZARDS_HEAD],
    [SHOW_HEAD_MESSAGE, WIZARDS_HEAD],
  ]);
  const STATEMENT_BOXES = new Set([
    "HHCuF1", // Maybe you should have the hand with you...
    "CkawR8", // Sand seems very keen to get you out of the office...
    "Rq6Z7E", "te5RH8", // I'd better make room in my inventory first!
    "SarqV0", PICKPOCKET_RUMMAGE_MESSAGE, "som7PD", // the pickpocket
    DESK_ROTA_MESSAGE, "GzkKaP", "wV3HcB", // the desk and the rota
    "DXb6tV", // Perhaps you should let Betty do that...
    "vx3z33", "yrfYrF", POUR_SERUM_MESSAGE, // the coffee mug
    "poy78n", "Xfq4oa", // Sandy without the orb / before every question
    ORB_HANDED_MESSAGE,
    CUTSCENE_FIRST_BOX, CUTSCENE_SECOND_BOX,
  ]);
  /** Sounds a box plays as it opens. */
  const BOX_SOUNDS = new Map([
    [HAND_DELIVERED_MESSAGE, SOUND.DROP_HAND],
    [LENS_MADE_MESSAGE, SOUND.DRIP_LIQUID],
    [BETTY_VIAL_MESSAGE, SOUND.PUT_DOWN],
    [LENS_COUNTER_MESSAGE, SOUND.VIAL_SHATTER],
    [POUR_SERUM_MESSAGE, SOUND.SERUM],
    [ORB_ACTIVATED_MESSAGE, SOUND.ORB],
  ]);

  /**
   * The sandpit cutscene (t8593-8638): the screen fades from the "Watch and learn..." continue, the player stands in a
   * copy of the sandpit three ticks later with Bert and the camera on the pit, the first box at 12; seven ticks after
   * it is continued the sand swirls and Bert cries; the second box two ticks on; eight ticks after that continue it fades
   * back to the bell, and three later the runes and bucket are spent and Zavistic speaks.
   */
  const SANDPIT = Object.freeze({ sourceChunk: [316, 386], size: 4 });
  const SANDPIT_BOUNDS = [[2528, 2559, 3088, 3119, 0]];
  // Each count starts on a continue, whose countdown runs in that tick's task pass: one more than the capture's gap.
  const CUTSCENE = Object.freeze({
    ENTER_TICKS: 4,
    BERT_TICKS: 6,
    FADE_IN_TICKS: 10,
    FIRST_BOX_TICKS: 13,
    SAND_AFTER_FIRST_BOX: 8,
    FADE_OUT_AFTER_SECOND_BOX: 9,
    RETURN_AFTER_SECOND_BOX: 11,
    LINE_AFTER_SECOND_BOX: 14,
  });
  const CUTSCENE_AT = [2536, 3109, 0];
  const CUTSCENE_BERT = [2546, 3099, 0];
  const CUTSCENE_CAMERA = { move: [2536, 3109, 850], look: [2544, 3102, 25], rates: { rate: 100, rate2: 100 } };
  const SANDPIT_LOC = [2542, 3103, 0];
  const SAND_MAGIC_ANIM = 3037; // handsand_sand_magic
  const BERT_CRYING_ANIM = 2702; // prisoner_ready_crying
  const CUTSCENE_JINGLE = 114; // "handsand cutscene"
  const BELL_RETURN = [2598, 3086, 0];
  const ZAVISTIC_AFTER_CUTSCENE = [2597, 3086, 0];
  const SCENE_EXIT_ATTRIBUTE = "hand-in-the-sand:scene-exit";
  const COMPLETION_JINGLE = 152; // "quest complete 1" (t9032)

  /**
   * Ours: neither the Wiki nor the capture gives a rate for a pickpocket on Sandy (the Wiki: "may take multiple
   * attempts"; the capture: two misses in four) or for the distraction (the Wiki: "no guaranteed one").
   */
  const PICKPOCKET_SUCCESS_CHANCE = 0.5;
  const DISTRACTION_SUCCESS_CHANCE = 0.5;

  const SERUM_ATTRIBUTE = "quest.hand_in_the_sand.serum";
  const COUNTER_ATTRIBUTE = "quest.hand_in_the_sand.counter";
  const TELEPORTED_ATTRIBUTE = "hand-in-the-sand:teleported-to-betty";
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
  const bell = createWizardsGuildBell(api);
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE, onEnd: sceneEnded });
  /** The players whose Zavistic conversation came from the bell, for the page's bell and guild conditions. */
  const atTheBell = new WeakSet();
  /** This attempt's pickpocket and distraction rolls, answered by both of the page's outcome conditions. */
  const pickpocketRolls = new WeakMap();
  const distractionRolls = new WeakMap();
  /** The sandpit scene each player is in, with its Bert. */
  const cutscenes = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function sound(player, id) {
    player.getPacketSender().sendSound(id, 1, 0);
  }

  function serumLevel(player) {
    return Number(player.getAttribute(SERUM_ATTRIBUTE)) || SERUM_UNSTARTED;
  }

  function setSerum(player, value) {
    player.setAttribute(SERUM_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_SERUM, value);
  }

  function syncCounter(player) {
    // WGS's fellowship owns this same counter while enriching its seed.
    const request = { player, key: "while_guthix_sleeps", stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    const stage = request.stage ?? Number(player.getAttribute("quest.while_guthix_sleeps.stage") ?? 0);
    if (stage >= WGS_SEED_COUNTER_FROM && stage < WGS_SEED_COUNTER_UNTIL) return;
    player.getPacketSender().sendVarbit(VARBIT_COUNTER, player.getAttribute(COUNTER_ATTRIBUTE) === true ? 1 : 0);
  }

  function setCounter(player, placed) {
    player.setAttribute(COUNTER_ATTRIBUTE, placed);
    syncCounter(player);
  }

  /** Sandy and his mug follow the stage: at the window while the serum goes in, gone with the mug once he is arrested. */
  function sandyState(stage) {
    if (stage >= STAGE_COMPLETE) return SANDY_GONE;
    return stage === STAGE_DRUG_COFFEE ? SANDY_AT_WINDOW : SANDY_AT_DESK;
  }

  function syncSandy(player, stage = quest.getStage(player)) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_SANDY, sandyState(stage));
    sender.sendVarbit(VARBIT_COFFEE, stage >= STAGE_COMPLETE ? 1 : 0);
  }

  function syncQuestions(player) {
    const sender = player.getPacketSender();
    QUESTION_ATTRIBUTES.forEach((attribute, index) => {
      sender.sendVarbit(VARBIT_QUESTIONS[index], player.getAttribute(attribute) === true ? 1 : 0);
    });
  }

  function syncAuxiliaries({ player }) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_SERUM, serumLevel(player));
    sender.sendVarbit(VARBIT_TELEPORTED, Number(player.getAttribute(TELEPORTED_ATTRIBUTE)) === 1 ? 1 : 0);
    syncCounter(player);
    syncQuestions(player);
    syncSandy(player);
  }

  function allQuestionsAsked(player) {
    return QUESTION_ATTRIBUTES.every((attribute) => player.getAttribute(attribute) === false);
  }

  /** `open`: the question is still to ask (true from the start, false once asked), with its varbit. */
  function setQuestion(player, index, open) {
    player.setAttribute(QUESTION_ATTRIBUTES[index], open);
    player.getPacketSender().sendVarbit(VARBIT_QUESTIONS[index], open ? 1 : 0);
  }

  /** Zogre's own quest state, read the way Zogre reads this quest's stage. */
  function zogreQuestState(player) {
    const stage = Number(player.getAttribute(ZOGRE_STAGE_ATTRIBUTE)) || 0;
    return {
      progress: Number(player.getAttribute(ZOGRE_SEARCH_ATTRIBUTE)) || 0,
      started: stage >= ZOGRE_STARTED_STAGE && stage < ZOGRE_EVIDENCE_STAGE,
    };
  }

  function zogre(player, question) {
    const request = { player, key: ZOGRE_KEY };
    api.emitCustomEvent(question, request);
    return request;
  }

  const zogreStarted = (player) => zogre(player, "quest:is-started").started === true;
  const zogreComplete = (player) => zogre(player, "quest:is-complete").complete === true;

  /** Zogre still has to show its evidence to Zavistic: only the bell does that. */
  function zogreNeedsTheBell(player) {
    const state = zogreQuestState(player);
    return state.started && state.progress < ZOGRE_EVIDENCE_PROGRESS;
  }

  /** Zogre has the evidence and still owes Zavistic the hand-in: only the guild talk does that. */
  function zogreNeedsZavistic(player) {
    const state = zogreQuestState(player);
    return state.started && state.progress >= ZOGRE_EVIDENCE_PROGRESS;
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

  /** This quest's Zavistic transcript for the player's stage. */
  function handZavisticVariant(player) {
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

  /** Zavistic inside the guild; Zogre keeps the wizard while it owes him the evidence. */
  function zavisticVariant(player) {
    if (zogreNeedsZavistic(player)) return null;
    const variant = handZavisticVariant(player);
    if (variant) atTheBell.delete(player);
    return variant;
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

  /**
   * "hand-in-the-sand:betty-page" { player, variant }: the Hand in the Sand page Betty speaks now, or null. Another quest
   * that also has Betty pages (Ethically Acquired Antiquities loads first) yields to it while this one applies.
   */
  function answerBettyPage(request) {
    if (request?.player) request.variant = bettyVariant(request.player);
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

  /** Answers the page's prose conditions, scoped to the NPCs that speak it. */
  function answerCondition({ npcId, player, text }) {
    if (
      !BERT_NPC_IDS.has(npcId) &&
      npcId !== GUARD_CAPTAIN_NPC_ID &&
      !SANDY_NPC_IDS.has(npcId) &&
      npcId !== ZAVISTIC_NPC_ID &&
      npcId !== BETTY_NPC_ID &&
      npcId !== MAZION_NPC_ID
    ) {
      return null;
    }
    const value = String(text).toLowerCase().replace(/[‘’]/g, "'");
    const has = (itemId) => held(player, itemId);
    if (value.includes("inventory space")) return freeSlots(player) < 1;
    if (value.includes("speaking to zavistic rarve via the bell")) return atTheBell.has(player);
    if (value.includes("speaking to zavistic rarve inside the guild")) return !atTheBell.has(player);
    if (value.includes("has not completed zogre flesh eaters")) return !zogreComplete(player);
    if (value.includes("completed zogre flesh eaters")) return zogreComplete(player);
    if (value.includes("does not have the beer soaked hand")) return !has(BEER_SOAKED_HAND);
    if (value.includes("has the beer soaked hand")) return has(BEER_SOAKED_HAND);
    if (value.includes("lost the sandy hand")) return !has(BEER_SOAKED_HAND);
    if (value.includes("lost the rota")) return !has(BERTS_ROTA);
    if (value.includes("does not have sandy's rota")) return !has(SANDYS_ROTA);
    if (value.includes("already has sandy's rota")) return has(SANDYS_ROTA);
    if (value.includes("pickpocket attempt fails")) return !pickpocketSucceeds(player);
    if (value.includes("pickpocket attempt succeeds")) return pickpocketSucceeds(player);
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
    if (value.includes("distracting sandy succeeds")) return distractionSucceeds(player);
    if (value.includes("distracting sandy fails")) return !distractionSucceeds(player);
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

  /** One roll per pickpocket attempt, read by both of the page's outcome conditions. */
  function pickpocketSucceeds(player) {
    if (!pickpocketRolls.has(player)) pickpocketRolls.set(player, Math.random() < PICKPOCKET_SUCCESS_CHANCE);
    return pickpocketRolls.get(player);
  }

  /** One roll per tall tale, read by both of its outcome conditions. */
  function distractionSucceeds(player) {
    if (!distractionRolls.has(player)) distractionRolls.set(player, Math.random() < DISTRACTION_SUCCESS_CHANCE);
    return distractionRolls.get(player);
  }

  // ==========================================================================
  // Dialogue hooks / actions
  // ==========================================================================

  /** 17 Thieving and 49 Crafting, checked on Bert's "Yes."; the stage itself comes with the hand. */
  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getCurrentLevel(Skill.THIEVING) >= 17 &&
      skills.getCurrentLevel(Skill.CRAFTING) >= 49
    );
  }

  function handleStartHook(hook) {
    const { player, npcId } = hook;
    if (!BERT_NPC_IDS.has(npcId) || hook.hook !== START_HOOK) return;
    if (meetsRequirements(player)) return;
    // Ours: the capture met the requirements; no source words a refusal.
    player.sendMessage("You do not meet all of the requirements to start The Hand in the Sand quest.");
    player.getPacketSender().sendInterfaceRemoval();
    hook.end = true;
  }

  /** The box a message step shows as, with the sound it opens with. */
  function presentBox(event) {
    const { player, stepId } = event;
    const item = ITEM_BOXES.get(stepId);
    if (item !== undefined) event.box = { ...(event.box ?? {}), items: [item] };
    else if (STATEMENT_BOXES.has(stepId)) event.box = { ...(event.box ?? {}), statement: true };
    const id = BOX_SOUNDS.get(stepId);
    if (id !== undefined) sound(player, id);
  }

  /** Message steps: each one's box, and the hand-ins, stages and items that come with it. */
  function handleMessage(event) {
    const { player, stepId } = event;
    presentBox(event);
    if (stepId === HAND_GIVEN_MESSAGE) {
      // t7273: the stage, the three question varbits and the hand on the continue of Bert's "Nae".
      if (quest.getStage(player) < STAGE_INVESTIGATE_HAND) {
        quest.setStage(player, STAGE_INVESTIGATE_HAND);
        for (let index = 0; index < QUESTION_ATTRIBUTES.length; index++) setQuestion(player, index, true);
      }
      if (!held(player, SANDY_HAND) && !held(player, BEER_SOAKED_HAND)) {
        player.getInventory().adds(SANDY_HAND, 1);
      }
      return;
    }
    if (stepId === BEER_GIVEN_MESSAGE) {
      // t7316: the beer goes, and he gulps, once the box is continued.
      event.after = () => {
        if (held(player, BEER)) player.getInventory().deleteNumber(BEER, 1);
        sound(player, SOUND.GULP);
      };
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
    if (stepId === PICKPOCKET_RUMMAGE_MESSAGE) {
      // t7681, t7683: every success hands over sand with the rummaging box, one more each time.
      pickpocketRolls.delete(player);
      if (quest.getStage(player) >= STAGE_INVESTIGATE_HAND) player.getInventory().adds(SAND, 1);
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
        event.box = undefined;
        return;
      }
      player.getInventory().deleteNumber(MAGIC_SCROLL, 1);
      if (!held(player, MAGICAL_ORB)) player.getInventory().adds(MAGICAL_ORB, 1);
      if (quest.getStage(player) < STAGE_MAKE_SERUM) quest.setStage(player, STAGE_MAKE_SERUM);
      return;
    }
    if (stepId === BETTY_VIAL_MESSAGE) {
      setCounter(player, true);
      return;
    }
    if (stepId === LENS_COUNTER_MESSAGE) {
      if (held(player, ROSE_TINTED_LENS) && serumLevel(player) === SERUM_LENS) {
        player.getInventory().deleteNumber(ROSE_TINTED_LENS, 1);
        if (!held(player, TRUTH_SERUM)) player.getInventory().adds(TRUTH_SERUM, 1);
        setSerum(player, SERUM_MADE);
        setCounter(player, false);
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
      // t8276: the stage, Sandy back at his desk and the serum gone as the box opens.
      if (held(player, TRUTH_SERUM)) player.getInventory().deleteNumber(TRUTH_SERUM, 1);
      if (quest.getStage(player) < STAGE_ACTIVATE_ORB) {
        quest.setStage(player, STAGE_ACTIVATE_ORB);
      }
      syncSandy(player);
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
    if (stepId === CUTSCENE_FIRST_BOX) {
      // t8605 the box, t8609 continued, t8616 the sand swirls (the overhead line's own before).
      event.box = { ...event.box, delayTicks: CUTSCENE.FIRST_BOX_TICKS, pauseTicks: CUTSCENE.SAND_AFTER_FIRST_BOX };
      return;
    }
    if (stepId === CUTSCENE_SECOND_BOX) {
      // t8618 the box; continued at t8625, faded at 8633, back at the bell at 8635, Zavistic at 8638.
      event.box = { ...event.box, pauseTicks: CUTSCENE.LINE_AFTER_SECOND_BOX };
      event.after = () => leaveSandpit(player);
      return;
    }
    if (MAZION_HEAD_MESSAGES.has(stepId)) {
      if (!held(player, WIZARDS_HEAD)) player.getInventory().adds(WIZARDS_HEAD, 1);
      if (quest.getStage(player) < STAGE_RETURN_HEAD) {
        quest.setStage(player, STAGE_RETURN_HEAD);
      }
    }
  }

  /** Message and action steps that hand items over, consume them or advance the quest. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    // `message` steps fire twice: once as an action, once with kind "message".
    if (event.kind === "message") {
      handleMessage(event);
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
      event.handled = true;
      teleportToBetty(player);
      return;
    }

    if (stepId === CUTSCENE_START_ACTION) {
      enterSandpit(player);
      return;
    }

    // The sandpit enchantment spends the runes and the bucket once, here: the
    // sandpit-filling message before it must not take a second set.
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
      // t9032: Sandy and his mug go, the head goes, then the completion.
      if (!quest.isComplete(player)) {
        player.getPacketSender().sendVarbit(VARBIT_SANDY, SANDY_GONE).sendVarbit(VARBIT_COFFEE, 1);
        quest.complete(player);
        if (held(player, WIZARDS_HEAD)) player.getInventory().deleteNumber(WIZARDS_HEAD, 1);
      }
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
    if (SANDY_NPC_IDS.has(npcId) && quest.getStage(player) === STAGE_DISTRACT_SANDY) {
      // A fresh roll for each tall tale.
      distractionRolls.delete(player);
    }
  }

  /**
   * Zavistic's Zogre option is offered only to a player who has started Zogre Flesh Eaters; without it live asks no
   * question and goes on with this quest (t7925-7932, t7989-7999, t8539-8549, t8578-8584, t9004-9015). Sandy's
   * interrogation offers only the questions still to ask (t8300, t8310, t8331).
   */
  function handleMenu(notice) {
    const { player, npcId } = notice;
    if (!player || !Array.isArray(notice.options)) return;
    const texts = notice.options.map((option) => option?.text);
    if (npcId === ZAVISTIC_NPC_ID && texts.includes(ZOGRE_OPTION) && !zogreStarted(player)) {
      const sandy = notice.options.find((option) => option?.text === SANDY_PROBLEM_OPTION);
      if (sandy) notice.select = sandy;
      return;
    }
    if (SANDY_NPC_IDS.has(npcId) && quest.getStage(player) === STAGE_INTERROGATE_SANDY) {
      notice.options = notice.options.filter((option) => {
        const index = QUESTION_OPTIONS.get(option?.text);
        return index === undefined || player.getAttribute(QUESTION_ATTRIBUTES[index]) !== false;
      });
    }
  }

  /** Blanks, one-off hand-overs and timed effects that live in transcript speech lines. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!player) return;
    if (npcId === BETTY_NPC_ID && text === "I have one here!") {
      // t8059-8060: the vial for the bottle on the continue of "I have one here!".
      if (quest.getStage(player) === STAGE_MAKE_SERUM && serumLevel(player) === SERUM_UNSTARTED) {
        event.after = () => {
          if (serumLevel(player) !== SERUM_UNSTARTED) return;
          if (held(player, VIAL)) player.getInventory().deleteNumber(VIAL, 1);
          setSerum(player, SERUM_BOTTLE);
          if (!held(player, BOTTLED_WATER)) player.getInventory().adds(BOTTLED_WATER, 1);
        };
      }
      return;
    }
    if (BERT_NPC_IDS.has(npcId) && String(text).startsWith("I be hopin' tha search")) {
      if (quest.getStage(player) !== STAGE_DELIVER_SCROLL) return;
      if (held(player, MAGIC_SCROLL) || held(player, MAGICAL_ORB) || held(player, MAGICAL_ORB_ACTIVE)) {
        return;
      }
      if (freeSlots(player) > 0) player.getInventory().adds(MAGIC_SCROLL, 1);
      return;
    }
    if (SANDY_NPC_IDS.has(npcId) && quest.getStage(player) === STAGE_INTERROGATE_SANDY) {
      // t8307, t8318, t8337: a question's varbit clears on the continue of the player asking it.
      const index = QUESTION_OPTIONS.get(String(text));
      if (index !== undefined && event.step?.player !== undefined) event.after = () => setQuestion(player, index, false);
      return;
    }
    if (SANDY_NPC_IDS.has(npcId) && text === "Wow! I must see this!" && quest.getStage(player) === STAGE_DISTRACT_SANDY) {
      // t8266: on its continue Sandy turns to the window (1535) with the stage and the hint.
      event.after = () => {
        distractionRolls.delete(player);
        if (quest.getStage(player) !== STAGE_DISTRACT_SANDY) return;
        quest.setStage(player, STAGE_DRUG_COFFEE);
        syncSandy(player);
        player.sendMessage("Sandy turns to look out of the window, now is your chance!");
      };
      return;
    }
    if (text === "My sand! My lovely sand!") {
      const scene = cutscenes.get(player);
      if (!scene) return;
      // t8616-8617: the pit swirls with its sound as Bert cries, and he says it.
      event.actors = scene.bert ? [scene.bert] : undefined;
      event.before = () => {
        const sender = player.getPacketSender();
        const pit = Scenes.tileFor(player, SANDPIT_LOC);
        sender.sendObjectAnimation(
          { getLocation: () => pit, getId: () => ObjectIdentifiers.SANDPIT ?? -1, getType: () => 10, getFace: () => 0 },
          new Animation(SAND_MAGIC_ANIM)
        );
        sound(player, SOUND.SANDSWIRL);
        scene.bert?.performAnimation(new Animation(BERT_CRYING_ANIM));
      };
    }
  }

  // ==========================================================================
  // Zavistic's teleport and the sandpit cutscene
  // ==========================================================================

  /** t8033-8037: the vial and 1531 on the continue, the cast two ticks on, Betty's shop two after that. */
  function teleportToBetty(player) {
    if (held(player, VIAL)) player.getInventory().deleteNumber(VIAL, 1);
    player.setAttribute(TELEPORTED_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(VARBIT_TELEPORTED, 1);
    player.getPacketSender().sendInterfaceRemoval();
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, TELEPORT_CAST_TICKS, () => {
      player.performAnimation(new Animation(TELEPORT_ANIM));
      player.performGraphic(new Graphic(TELEPORT_GFX, TELEPORT_GFX_HEIGHT));
      sound(player, SOUND.TELEPORT);
    });
    Scenes.later(player, TELEPORT_LAND_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(new Location(...BETTYS_SHOP));
    });
  }

  /** t8593-8602: the fade, the copy of the sandpit with Bert and the camera, then the fade back in. */
  function enterSandpit(player) {
    if (cutscenes.has(player)) return;
    const state = { scene: null, bert: null };
    cutscenes.set(player, state);
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    Scenes.fade(player, true);
    Scenes.later(player, CUTSCENE.ENTER_TICKS, () => {
      if (cutscenes.get(player) !== state) return;
      state.scene = Scenes.open(player, "sandpit", SANDPIT_BOUNDS, {}, { instance: SANDPIT, at: CUTSCENE_AT, exit: BELL_RETURN });
      Scenes.controls(player, true, true);
      player.getPacketSender().sendJingle(CUTSCENE_JINGLE, 0);
      Scenes.later(state.scene, CUTSCENE.BERT_TICKS - CUTSCENE.ENTER_TICKS, () => {
        state.bert = Scenes.actor(state.scene, BERT_SANDPIT_NPC_ID, CUTSCENE_BERT, null, { direction: api.core.Direction.SOUTH.id });
        Scenes.camera(player, CUTSCENE_CAMERA.move, CUTSCENE_CAMERA.look, CUTSCENE_CAMERA.rates);
      });
      Scenes.later(state.scene, CUTSCENE.FADE_IN_TICKS - CUTSCENE.ENTER_TICKS, () => Scenes.fade(player, false));
    });
  }

  /** From the second box's continue (t8625): the fade at 8633, back at the bell with Zavistic beside it at 8635. */
  function leaveSandpit(player) {
    const state = cutscenes.get(player);
    if (!state) return;
    Scenes.later(player, CUTSCENE.FADE_OUT_AFTER_SECOND_BOX, () => Scenes.fade(player, true));
    Scenes.later(player, CUTSCENE.RETURN_AFTER_SECOND_BOX, () => {
      if (cutscenes.get(player) !== state) return;
      Scenes.end(player, false);
      Scenes.place(player, BELL_RETURN);
      bell.summon(player, ZAVISTIC_AFTER_CUTSCENE, api.core.Direction.SOUTH_WEST.id);
      Scenes.restoreTabs(player);
      Scenes.fade(player, false);
    });
  }

  function sceneEnded(player, scene, logout) {
    const state = cutscenes.get(player);
    if (!state || (state.scene && state.scene !== scene)) return;
    cutscenes.delete(player);
    if (logout) Scenes.restoreTabs(player);
  }

  function handleLogout({ player }) {
    const state = cutscenes.get(player);
    if (state && !state.scene) cutscenes.delete(player);
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

  /** t7675-7683: the pickpocket animation every attempt; a miss or the sand, by the page. */
  function pickpocketSandy(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_INVESTIGATE_HAND) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    pickpocketRolls.delete(player);
    player.performAnimation(new Animation(PICKPOCKET_ANIM));
    startTranscript(api, player, event.npcId, PAGE, "getting-sandy-s-rota-pickpocketing-sandy");
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const targetId = event.npcId ?? event.target?.getId?.();
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
      atTheBell.delete(player);
      startTranscript(api, player, ZAVISTIC_NPC_ID, PAGE, "talking-to-zavistic-rarve");
    }
  }

  /** One message of the page's "Making the rose-tinted lens" section. */
  function lensStep(player, stepId) {
    startTranscript(api, player, BETTY_NPC_ID, PAGE, "talking-to-betty-making-the-rose-tinted-lens",
      (steps) => steps.filter((step) => step?.id === stepId));
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
      lensStep(player, JUICE_MESSAGE);
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
      lensStep(player, LENS_MADE_MESSAGE);
      return;
    }
    if (pair(SAND, TRUTH_SERUM)) {
      event.handled = true;
      startTranscript(api, player, BETTY_NPC_ID, PAGE, "talking-to-betty-trying-to-put-the-sand-in-the-truth-serum-yourself");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    // The map places the mug's and the counter's multilocs (10806, 10812) and a click names those.
    const objectId = api.core.ObjectDefinition.forPlayer(event.objectId, player)?.id ?? event.objectId;
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

  function handleGuildBell(event) {
    const { player, objectId } = event;
    if (!player || objectId !== OUTDOOR_BELL) return;
    const option = String(
      event.option ?? event.definition?.getActions?.()?.[event.clickType - 1] ?? ""
    ).toLowerCase();
    if (option && option !== "ring") return;
    if (!BELL_STAGES.has(quest.getStage(player))) return;
    // Zogre's evidence conversation is only reachable through this bell.
    if (zogreNeedsTheBell(player)) return;
    const variant = handZavisticVariant(player);
    if (!variant) return;
    event.handled = true;
    bell.ring(player, event.object, (zavistic) => {
      const now = handZavisticVariant(player);
      if (!now) return;
      atTheBell.add(player);
      startTranscript(api, player, ZAVISTIC_NPC_ID, PAGE, now, undefined, zavistic);
    });
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (objectId === OUTDOOR_BELL) {
      handleGuildBell(event);
      return;
    }
    if (objectId !== SANDYS_DESK) return;
    event.handled = true;
    searchSandyDesk(player);
  }

  function handleLogin({ player }) {
    syncAuxiliaries({ player });
    refreshQuestList(player);
  }

  /** A stage set from outside (::quest) brings Sandy and his mug along. */
  function handleStageChanged({ player, key, stage }) {
    if (key === "hand_in_the_sand" && player) syncSandy(player, stage);
  }

  api.persistAttribute(SERUM_ATTRIBUTE);
  api.persistAttribute(COUNTER_ATTRIBUTE);
  api.persistAttribute(TELEPORTED_ATTRIBUTE, 0);
  for (const attribute of QUESTION_ATTRIBUTES) api.persistAttribute(attribute);

  quest = registerQuest(api, {
    key: "hand_in_the_sand",
    name: "The Hand in the Sand",
    varbitId: VARBIT_HAND_IN_THE_SAND,
    startedValue: STAGE_INVESTIGATE_HAND,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 9000, label: "Crafting" },
      { skillId: Skill.THIEVING.getIndex(), amount: 1000, label: "Thieving" },
    ],
    scrollItemId: ItemIdentifiers.SANDY_HAND,
    // t9032: the scroll's lines after the experience, as live words them.
    otherRewards: [
      "Wizards' Guild Rune",
      "Store Access",
      "A secret reward from Bert",
    ],
    completionJingleId: COMPLETION_JINGLE,
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("hand-in-the-sand:betty-page", answerBettyPage);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onNpcInteraction("Sandy", { Pickpocket: pickpocketSandy });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", syncAuxiliaries);
};
