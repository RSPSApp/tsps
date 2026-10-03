/**
 * The Dig Site (members).
 *
 * The words come from the "The Dig Site" transcript page; this plugin supplies
 * the variant selector for the examiners, the three students, the researcher,
 * Terry Balando, the curator, the panning guide, the workmen and Doug Deeping
 * (all indexed), the start hook, the prose-condition answers and the exam /
 * discovery stage progression.
 *
 * Stages (varp 131): 1 started, 2-4 passed the three exams, 7 carrying the
 * chemical compound, 8 carrying the ancient talisman, 9 complete.
 *
 * Gaps (no dump/index support): the three exams are multi-question quizzes in
 * OSRS; here talking to the student matching the current stage signs the
 * certificate. The digging/talisman/explosive minigames (winch, cup, powder,
 * tinderbox) are not simulated; Terry's progress and the temple discovery are
 * driven by the exam certificates and the chemical compound message steps.
 */
module.exports = function registerDigSiteQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const EXAMINER_NPC_IDS = new Set([
    NpcIdentifiers.EXAMINER,
    NpcIdentifiers.EXAMINER_2,
    NpcIdentifiers.EXAMINER_3,
  ]);
  const STUDENT_GREEN_NPC_ID = NpcIdentifiers.STUDENT;
  const STUDENT_PURPLE_NPC_ID = NpcIdentifiers.STUDENT_2;
  const STUDENT_ORANGE_NPC_ID = NpcIdentifiers.STUDENT_3;
  const RESEARCHER_NPC_ID = NpcIdentifiers.RESEARCHER;
  const TERRY_BALANDO_NPC_ID = NpcIdentifiers.TERRY_BALANDO;
  const CURATOR_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN;
  const PANNING_GUIDE_NPC_ID = NpcIdentifiers.PANNING_GUIDE;
  const WORKMAN_NPC_IDS = new Set([
    NpcIdentifiers.DIGSITE_WORKMAN,
    NpcIdentifiers.DIGSITE_WORKMAN_2,
    NpcIdentifiers.DIGSITE_WORKMAN_3,
  ]);
  const DOUG_DEEPING_NPC_ID = NpcIdentifiers.DOUG_DEEPING;

  const VARP_DIG_SITE = 131;
  const STAGE_STARTED = 1;
  const STAGE_EXAMS_DONE = 4;
  const STAGE_HAS_COMPOUND = 7;
  const STAGE_HAS_TALISMAN = 8;
  const STAGE_COMPLETE = 9;

  const LEVEL_1_CERTIFICATE_ITEM_ID = ItemIdentifiers.LEVEL_1_CERTIFICATE;
  const LEVEL_2_CERTIFICATE_ITEM_ID = ItemIdentifiers.LEVEL_2_CERTIFICATE;
  const LEVEL_3_CERTIFICATE_ITEM_ID = ItemIdentifiers.LEVEL_3_CERTIFICATE;
  const CHEMICAL_COMPOUND_ITEM_ID = ItemIdentifiers.CHEMICAL_COMPOUND;
  const ANCIENT_TALISMAN_ITEM_ID = ItemIdentifiers.ANCIENT_TALISMAN;
  const TROWEL_ITEM_ID = ItemIdentifiers.TROWEL;

  const START_HOOK = "quest:the-dig-site:start";
  /** Terry's "turning in the stone tablet" action ends the quest. */
  const COMPLETE_ACTION_ID = "NwSdYK";

  const CERTIFICATE_FOR_STAGE = new Map([
    [STAGE_STARTED, LEVEL_1_CERTIFICATE_ITEM_ID],
    [STAGE_STARTED + 1, LEVEL_2_CERTIFICATE_ITEM_ID],
    [STAGE_STARTED + 2, LEVEL_3_CERTIFICATE_ITEM_ID],
  ]);

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasAllCertificates = (player) =>
    held(player, LEVEL_1_CERTIFICATE_ITEM_ID) &&
    held(player, LEVEL_2_CERTIFICATE_ITEM_ID) &&
    held(player, LEVEL_3_CERTIFICATE_ITEM_ID);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I passed the Dig Site examinations.</str>",
        "<str>I uncovered an ancient altar beneath the Dig Site.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HAS_TALISMAN) {
      return [
        "Terry Balando has asked me to investigate the dig shafts.",
        "I should bring the <col=800000>ancient talisman</col> to the museum curator.",
      ];
    }
    if (stage >= STAGE_EXAMS_DONE) {
      return [
        "I passed the three examinations.",
        "I should speak to <col=800000>Terry Balando</col> at the Exam Centre.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The examiner wants proof that I studied the Dig Site.",
        "I should interview all <col=800000>three students</col>.",
      ];
    }
    return [
      "I can start this quest at the <col=800000>Dig Site Exam Centre</col>.",
      "It requires 10 Agility, 10 Herblore and 25 Thieving.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.MINING, 15300);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 2000);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (EXAMINER_NPC_IDS.has(npcId)) {
      if (stage === 0) return "starting-the-quest";
      if (stage < STAGE_EXAMS_DONE) return "the-first-exam-taking-the-exam";
      if (stage < STAGE_HAS_COMPOUND) return "the-second-exam";
      if (stage < STAGE_HAS_TALISMAN) return "the-third-exam";
      return "the-third-exam-talking-to-the-examiner-again";
    }
    // Each student signs one certificate; talking to the student matching the
    // current stage stands in for passing that exam.
    const certificate = CERTIFICATE_FOR_STAGE.get(stage);
    if (npcId === STUDENT_GREEN_NPC_ID || npcId === STUDENT_PURPLE_NPC_ID || npcId === STUDENT_ORANGE_NPC_ID) {
      const isRightStudent =
        (npcId === STUDENT_GREEN_NPC_ID && stage === STAGE_STARTED) ||
        (npcId === STUDENT_PURPLE_NPC_ID && stage === STAGE_STARTED + 1) ||
        (npcId === STUDENT_ORANGE_NPC_ID && stage === STAGE_STARTED + 2);
      if (isRightStudent && certificate !== undefined) {
        player.getInventory().adds(certificate, 1);
        player.sendMessage("The student signs your certificate.");
        quest.setStage(player, stage + 1);
      }
      if (stage === STAGE_STARTED) return "the-first-exam-the-student-in-the-green-top-asking-the-student-for-help";
      if (stage === STAGE_STARTED + 1) {
        return "the-first-exam-the-student-in-the-purple-skirt-asking-the-student-for-help";
      }
      if (stage === STAGE_STARTED + 2) {
        return "the-first-exam-the-student-in-the-orange-shirt-asking-the-student-for-help";
      }
      return "the-first-exam-the-student-in-the-green-top-talking-to-the-student-again";
    }
    if (npcId === RESEARCHER_NPC_ID) {
      if (stage < STAGE_EXAMS_DONE) {
        return "the-first-exam-talking-to-the-researcher-before-completing-the-first-exam";
      }
      if (stage < STAGE_HAS_COMPOUND) return "the-second-exam-talking-to-the-researcher";
      if (stage < STAGE_HAS_TALISMAN) return "the-third-exam-talking-to-the-researcher";
      return "making-a-discovery-talking-to-the-researcher";
    }
    if (npcId === TERRY_BALANDO_NPC_ID) {
      if (stage === STAGE_EXAMS_DONE) {
        if (hasAllCertificates(player)) {
          for (const itemId of [
            LEVEL_1_CERTIFICATE_ITEM_ID,
            LEVEL_2_CERTIFICATE_ITEM_ID,
            LEVEL_3_CERTIFICATE_ITEM_ID,
          ]) {
            player.getInventory().deleteNumber(itemId, 1);
          }
          player.getInventory().adds(CHEMICAL_COMPOUND_ITEM_ID, 1);
          player.sendMessage("Terry Balando hands you a chemical compound.");
          quest.setStage(player, STAGE_HAS_COMPOUND);
        }
        return "making-a-discovery-talking-to-terry-again";
      }
      if (stage === STAGE_HAS_COMPOUND) {
        if (held(player, CHEMICAL_COMPOUND_ITEM_ID)) {
          player.getInventory().deleteNumber(CHEMICAL_COMPOUND_ITEM_ID, 1);
          player.getInventory().adds(ANCIENT_TALISMAN_ITEM_ID, 1);
          player.sendMessage("You uncover a strange talisman.");
          quest.setStage(player, STAGE_HAS_TALISMAN);
        }
        return "making-a-discovery-talking-to-terry-again";
      }
      if (stage >= STAGE_HAS_TALISMAN) return "making-a-discovery-turning-in-the-stone-table";
      return "making-a-discovery-talking-to-terry-balando";
    }
    if (npcId === CURATOR_NPC_ID) {
      // The Golem reuses the museum curator; let it own him once started.
      if ((Number(player.getAttribute("quest.the_golem.stage")) || 0) >= 1) return null;
      return "starting-the-quest-getting-the-curator-s-approval";
    }
    if (npcId === PANNING_GUIDE_NPC_ID) {
      return "the-first-exam-the-student-in-the-orange-shirt-talking-to-the-panning-guide";
    }
    if (WORKMAN_NPC_IDS.has(npcId)) {
      return "making-a-discovery-talking-to-terry-again-giving-a-workman-the-invitation";
    }
    if (npcId === DOUG_DEEPING_NPC_ID) return "making-a-discovery-talking-to-doug-deeping";
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("does not have a trowel")) return !has(TROWEL_ITEM_ID);
    if (value.includes("has a trowel")) return has(TROWEL_ITEM_ID);
    if (value.includes("doesn't have the key")) return true;
    if (value.includes("already has the key")) return false;
    if (value.includes("still has the letter") || value.includes("still have the letter")) return true;
    if (value.includes("lost the letter")) return false;
    if (value.includes("shield of arrav hasn't been completed")) return true;
    if (value.includes("shield of arrav has been completed")) return false;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!EXAMINER_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Terry's discovery turn-in completes the quest. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== TERRY_BALANDO_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (!quest.isComplete(player)) quest.complete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "the_dig_site",
    name: "The Dig Site",
    varpId: VARP_DIG_SITE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.MINING.getIndex(), amount: 15300, label: "Mining" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 2000, label: "Herblore" },
    ],
    rewardItemId: ItemIdentifiers.ANCIENT_TALISMAN,
    rewardItemLabel: "Ancient talisman",
    otherRewards: ["Access to the Dig Site's deeper dig shafts"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
