/**
 * Recruitment Drive (members).
 *
 * The words come from the "Recruitment Drive" transcript page (npc-dialogues.json); this plugin
 * picks Sir Amik Varze's (4771, shared with Black Knights' Fortress) and Sir Tiffy Cashien's (4687)
 * conversations, answers their prose conditions and runs the training grounds: a run of five of
 * the seven rooms (recruitmentdrive/Course.RecruitmentDrive.js) and each room's puzzle
 * (recruitmentdrive/<Observer>.RecruitmentDrive.js). Behaviour is aligned with the user's
 * whole-quest rsprox capture (revision 242.1); docs/quests/recruitment-drive/README.md lists
 * the facts and where they come from.
 *
 * Stages (varbit 657 rd_main, varp 496):
 *   0 not started; 1 recommended by Sir Amik (rd_main 1, capture tick 69);
 *   2 taken to the training grounds at least once (rd_spoke_to_tiffy 692 = 1, tick 335);
 *   3 a save from before the grounds were rebuilt that had passed every test: Sir Tiffy finishes
 *     it (the grounds now end in his finishing conversation, tick 3593);
 *   4 complete (rd_main 2, tick 3600).
 * A run itself lives only in the session: logging out, dying or leaving the grounds ends it.
 *
 * Rewards per the capture's scroll (tick 3600) and the Wiki: 1 Quest point, 1,000.5 Prayer,
 * Herblore and Agility XP, 3,000 coins and an initiate sallet.
 */
module.exports = function registerRecruitmentDriveQuest(api) {
  const { giveReward, openBook, refreshQuestList, registerQuest, startTranscript } = require("../QuestRuntime");
  const createCourse = require("../recruitmentdrive/Course.RecruitmentDrive");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  const { ItemIdentifiers, Location, NpcIdentifiers, Skill } = api.core;

  const PAGE = "Recruitment Drive";
  const VARBIT_RECRUITMENT_DRIVE = 657; // rd_main
  const BLACK_KNIGHTS_QUEST_KEY = "black_knights_fortress";
  const DRUIDIC_RITUAL_QUEST_KEY = "druidic_ritual";

  const STAGE_STARTED = 1;
  const STAGE_TESTING = 2;
  const STAGE_RETURN = 3;
  const STAGE_COMPLETE = 4;

  const SIR_AMIK_VARZE_NPC_ID = NpcIdentifiers.SIR_AMIK_VARZE_4; // 4771, White Knights' Castle
  const SIR_TIFFY_CASHIEN_NPC_ID = NpcIdentifiers.SIR_TIFFY_CASHIEN; // 4687, Falador Park

  const START_HOOK = "quest:recruitment-drive:start";
  const V_AMIK_START = "starting-out-talking-to-sir-amik-varze";
  const V_AMIK_AGAIN = "starting-out-talking-to-sir-amik-varze-talking-to-sir-amik-varze-again";
  const V_TIFFY_AFTER_START = "starting-out-talking-to-sir-tiffy-cashien-after-starting-the-quest";
  const V_TIFFY_FAIL = "the-tests-upon-failing-a-test";
  const V_TIFFY_RETRY = "the-tests-talking-to-sir-tiffy-cashien-after-attempting-the-tests-once";
  const V_TIFFY_FINISH = "finishing-up";
  const AMIK_REQUIREMENTS_ID = "zDFMYL";
  const TIFFY_NOT_READY_ID = "vAdG3I";
  const TIFFY_READY_ID = "JI9IMB";
  const QUEST_COMPLETE_ACTION_ID = "oqnyB5";
  const RESPAWN_MESSAGE_ID = "rMlr3k";

  let quest;

  const course = createCourse(api, {
    random: () => Math.random(),
    tiffyNpcId: SIR_TIFFY_CASHIEN_NPC_ID,
    tiffyStartVariant: V_TIFFY_AFTER_START,
    tiffyFailVariant: V_TIFFY_FAIL,
    travelConditionId: TIFFY_READY_ID,
    kuamDefeatVariant: "the-tests-sir-kuam-ferentse-defeating-sir-leye",
    passConditionIds: ["DBOLHO", "crzBa_", "d7FuHu"],
    tableTouchVariant: "the-tests-lady-table-touching-a-statue",
    tableFailConditionId: "Hsk37b",
    ObstacleRunner,
    onFinish: playFinish,
  });
  const ids = {
    SIR_SPISHYUS: NpcIdentifiers.SIR_SPISHYUS, LADY_TABLE: NpcIdentifiers.LADY_TABLE,
    SIR_KUAM_FERENTSE: NpcIdentifiers.SIR_KUAM_FERENTSE, SIR_LEYE: NpcIdentifiers.SIR_LEYE,
    SIR_TINLEY: NpcIdentifiers.SIR_TINLEY, SIR_REN_ITCHOOD: NpcIdentifiers.SIR_REN_ITCHOOD,
    MISS_CHEEVERS: NpcIdentifiers.MISS_CHEEVERS, MS_HYNN_TERPRETT: NpcIdentifiers.MS_HYNN_TERPRETT,
    STEEL_SHORTSWORD: ItemIdentifiers.STEEL_SHORTSWORD, STEEL_CLAWS: ItemIdentifiers.STEEL_CLAWS,
    STEEL_BATTLEAXE: ItemIdentifiers.STEEL_BATTLEAXE, STEEL_WARHAMMER: ItemIdentifiers.STEEL_WARHAMMER,
    ObstacleRunner, openBook,
  };
  const rooms = {
    spishyus: require("../recruitmentdrive/Spishyus.RecruitmentDrive")(api, course, ids),
    table: require("../recruitmentdrive/Table.RecruitmentDrive")(api, course, ids),
    kuam: require("../recruitmentdrive/Kuam.RecruitmentDrive")(api, course, ids),
    tinley: require("../recruitmentdrive/Tinley.RecruitmentDrive")(api, course, ids),
    ren: require("../recruitmentdrive/Ren.RecruitmentDrive")(api, course, ids),
    cheevers: require("../recruitmentdrive/Cheevers.RecruitmentDrive")(api, course, ids),
    hynn: require("../recruitmentdrive/Hynn.RecruitmentDrive")(api, course, ids),
  };

  /** Players whose "Yes, let's go!" found them ready: the next "Jolly good show!" takes them in. */
  const leaving = new WeakSet();
  /** Sir Tiffy's menu options already asked in this conversation ("Testing...?", "Organisation...?"). */
  const askedOptions = new WeakMap();

  function inventoryReady(player) {
    return player.getInventory().isEmpty() && player.getEquipment().getValidItems().length === 0;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    return questComplete(player, BLACK_KNIGHTS_QUEST_KEY) && questComplete(player, DRUIDIC_RITUAL_QUEST_KEY);
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    const stage = quest.getStage(player);
    if (npcId === SIR_AMIK_VARZE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return null;
      return { page: PAGE, variant: stage >= STAGE_STARTED ? V_AMIK_AGAIN : V_AMIK_START };
    }
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID) {
      if (course.run(player)) return null;
      askedOptions.set(player, new Set());
      if (stage === STAGE_STARTED) return { page: PAGE, variant: V_TIFFY_AFTER_START };
      if (stage === STAGE_TESTING) return { page: PAGE, variant: V_TIFFY_RETRY };
      if (stage === STAGE_RETURN) return { page: PAGE, variant: V_TIFFY_FINISH };
    }
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (!player) return null;
    if (npcId === SIR_AMIK_VARZE_NPC_ID && stepId === AMIK_REQUIREMENTS_ID) return !meetsRequirements(player);
    if (npcId !== SIR_TIFFY_CASHIEN_NPC_ID) return null;
    if (stepId === TIFFY_NOT_READY_ID) return !inventoryReady(player);
    if (stepId === TIFFY_READY_ID) return inventoryReady(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SIR_AMIK_VARZE_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  function handleCondition({ player, npcId, stepId }) {
    if (!player || npcId !== SIR_TIFFY_CASHIEN_NPC_ID || stepId !== TIFFY_READY_ID) return;
    const stage = quest.getStage(player);
    if (stage === STAGE_STARTED || stage === STAGE_TESTING) leaving.add(player);
  }

  /**
   * "Jolly good show! ..." is continued by the player; the three lines after it are live's timed
   * trip (Course), so the transcript stops there.
   */
  function handleLine(request) {
    const { player, npcId, step } = request;
    if (!player || npcId !== SIR_TIFFY_CASHIEN_NPC_ID || !leaving.has(player)) return;
    const steps = course.findCondition(course.variant(V_TIFFY_AFTER_START), TIFFY_READY_ID) ?? [];
    const [first, ...trip] = course.lines(steps).map((line) => line.text);
    if (step?.text === first) {
      request.before = () => {
        if (quest.getStage(player) < STAGE_TESTING) quest.setStage(player, STAGE_TESTING);
        player.getPacketSender().sendVarbit(course.SPOKE_TO_TIFFY_VARBIT, 1);
      };
      request.after = () => {
        leaving.delete(player);
        course.travel(player);
      };
    } else if (trip.includes(step?.text)) {
      request.skip = true;
    }
  }

  /** Live drops the options already asked from Sir Tiffy's menu when it comes back (ticks 290, 330). */
  function handleChoice({ player, npcId, option }) {
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID) askedOptions.get(player)?.add(String(option));
  }

  function handleMenu(notice) {
    if (notice.npcId !== SIR_TIFFY_CASHIEN_NPC_ID || notice.via !== "other") return;
    const asked = askedOptions.get(notice.player);
    if (!asked?.size) return;
    notice.options = (notice.options ?? []).filter((option) => !asked.has(String(option.text)));
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || npcId !== SIR_TIFFY_CASHIEN_NPC_ID || stepId !== QUEST_COMPLETE_ACTION_ID) return;
    event.handled = true;
    event.end = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_TESTING || quest.isComplete(player)) return;
    // Tick 3600: the respawn message shows before the completion's own.
    player.sendMessage(respawnMessage());
    quest.complete(player);
  }

  function respawnMessage() {
    return course.variant(V_TIFFY_FINISH).find((step) => step.id === RESPAWN_MESSAGE_ID)?.text;
  }

  /** The grounds' last room is passed: Sir Tiffy's finishing conversation (tick 3593). */
  function playFinish(player) {
    if (quest.getStage(player) < STAGE_TESTING) return;
    startTranscript(api, player, SIR_TIFFY_CASHIEN_NPC_ID, PAGE, V_TIFFY_FINISH);
  }

  function handleLogin({ player }) {
    if (quest.getStage(player) >= STAGE_TESTING) player.getPacketSender().sendVarbit(course.SPOKE_TO_TIFFY_VARBIT, 1);
    // Ours: a run never outlives the session; a player who logs in on the grounds is put by Sir
    // Tiffy, their room's items gone.
    if (course.inGrounds(player.getLocation())) {
      course.clearItems(player);
      const tile = course.FALADOR_RETURN;
      player.moveTo(new Location(tile.x, tile.y, tile.z));
    }
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    course.abandon(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Sir Amik Varze recommended me to the Temple Knights.</str>",
        "<str>I passed five of Sir Tiffy's tests in a row in the training</str>",
        "<str>grounds and joined the Temple Knights.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN) {
      return [
        "<str>I passed all five of Sir Tiffy's tests.</str>",
        "",
        "I should speak to <col=800000>Sir Tiffy Cashien</col> in",
        "<col=800000>Falador Park</col> to finish my recruitment.",
      ];
    }
    if (stage >= STAGE_TESTING) {
      return [
        "<str>Sir Amik Varze recommended me to the Temple Knights.</str>",
        "",
        "I must pass <col=800000>five tests in a row</col> in the Temple Knights'",
        "training grounds. <col=800000>Sir Tiffy Cashien</col> in <col=800000>Falador Park</col>",
        "will take me there when I have an <col=800000>empty inventory</col>",
        "and no equipment.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Sir Amik Varze recommended me to the Temple Knights.</str>",
        "",
        "I should speak to <col=800000>Sir Tiffy Cashien</col> in",
        "<col=800000>Falador Park</col> to be tested.",
        "",
        "I need an <col=800000>empty inventory</col> and no equipment.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Sir Amik Varze</col>",
      "on the upper floor of the <col=800000>White Knights' Castle</col>.",
      "",
      "I need to have completed <col=800000>Black Knights' Fortress</col>",
      "and <col=800000>Druidic Ritual</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1000.5);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 1000.5);
    player.getSkillManager().addExperiences(Skill.AGILITY, 1000.5);
    giveReward(player, ItemIdentifiers.COINS, 3000);
  }

  quest = registerQuest(api, {
    key: "recruitment_drive",
    name: "Recruitment Drive",
    varbitId: VARBIT_RECRUITMENT_DRIVE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // rd_main stays 1 until Sir Tiffy's welcome sets it to 2 (ticks 69, 3600).
    varbitValue: (stage) => (stage >= STAGE_COMPLETE ? 2 : stage >= STAGE_STARTED ? 1 : 0),
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 1000.5, label: "Prayer" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 1000.5, label: "Herblore" },
      { skillId: Skill.AGILITY.getIndex(), amount: 1000.5, label: "Agility" },
    ],
    rewardItemId: ItemIdentifiers.INITIATE_SALLET,
    rewardItemLabel: "An initiate sallet",
    otherRewards: ["Access to initiate armour from Sir Tiffy Cashien"],
    buildJournal,
    onReward: grantReward,
  });

  course.register();
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);

  // The latest registration, for tests (tests/recruitment-drive.test.cjs).
  module.exports.instance = { course, rooms, quest };
  return module.exports.instance;
};
