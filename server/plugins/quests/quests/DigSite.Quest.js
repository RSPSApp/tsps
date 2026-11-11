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
 * The letter (stage 1): the examiner hands over an unstamped letter, the curator stamps it
 * (the sealed letter) and the examiner takes it back before the first exam. Whether the
 * curator stamped one and whether the examiner has it are kept in two attributes.
 *
 * Gaps (no dump/index support): the three exams are multi-question quizzes in
 * OSRS; here talking to the student matching the current stage signs the
 * certificate. The digging/talisman/explosive minigames (winch, cup, powder,
 * tinderbox) are not simulated; Terry's progress and the temple discovery are
 * driven by the exam certificates and the chemical compound message steps.
 */
module.exports = function registerDigSiteQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

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

  /** NPCs whose transcripts this plugin owns; dialogue conditions from anyone else are not ours. */
  const DIALOGUE_NPC_IDS = new Set([
    ...EXAMINER_NPC_IDS,
    STUDENT_GREEN_NPC_ID,
    STUDENT_PURPLE_NPC_ID,
    STUDENT_ORANGE_NPC_ID,
    RESEARCHER_NPC_ID,
    TERRY_BALANDO_NPC_ID,
    CURATOR_NPC_ID,
    PANNING_GUIDE_NPC_ID,
    ...WORKMAN_NPC_IDS,
    DOUG_DEEPING_NPC_ID,
  ]);

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
  const UNSTAMPED_LETTER_ITEM_ID = ItemIdentifiers.UNSTAMPED_LETTER; // 682
  const STAMPED_LETTER_ITEM_ID = ItemIdentifiers.SEALED_LETTER; // 683, the stamped letter
  const STAMPED_ATTRIBUTE = "quest.the_dig_site.letter_stamped";
  const DELIVERED_ATTRIBUTE = "quest.the_dig_site.letter_delivered";
  const PAGE = "The Dig Site";

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
  const delivered = (player) => player.getAttribute(DELIVERED_ATTRIBUTE) === true;
  const stamped = (player) => player.getAttribute(STAMPED_ATTRIBUTE) === true;
  const holdsLetter = (player) => held(player, UNSTAMPED_LETTER_ITEM_ID) || held(player, STAMPED_LETTER_ITEM_ID);
  /** Still waiting on the letter: started, and the examiner hasn't taken a stamped one. */
  const awaitingLetter = (player) => quest.getStage(player) === STAGE_STARTED && !delivered(player);

  function giveLetter(player, itemId) {
    if (player.getInventory().getFreeSlots() < 1) {
      // No capture of a full inventory here: the wording is ours. Asking again re-issues it.
      player.sendMessage("You don't have enough inventory space for the letter.");
      return;
    }
    player.getInventory().adds(itemId, 1);
  }

  /** The curator stamps the letter the player carries. */
  function stampLetter(player) {
    if (held(player, UNSTAMPED_LETTER_ITEM_ID)) {
      player.getInventory().deleteNumber(UNSTAMPED_LETTER_ITEM_ID, 1);
      player.getInventory().adds(STAMPED_LETTER_ITEM_ID, 1);
    }
    player.setAttribute(STAMPED_ATTRIBUTE, true);
  }

  /** The examiner takes the stamped letter and the first exam begins. */
  function deliverLetter(player) {
    player.getInventory().deleteNumber(STAMPED_LETTER_ITEM_ID, 1);
    player.setAttribute(DELIVERED_ATTRIBUTE, true);
  }

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
    if (awaitingLetter(player)) {
      return stamped(player)
        ? ["The curator stamped my letter of recommendation.", "I should take it back to the <col=800000>Examiner</col>."]
        : ["The examiner gave me a letter of recommendation.", "I should get it stamped by the <col=800000>Curator</col> of Varrock's museum."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The examiner wants proof that I studied the Dig Site.",
        "I should interview all <col=800000>three students</col>.",
      ];
    }
    return ["I can start this quest by talking to an <col=800000>Examiner</col> in the <col=800000>Exam Centre</col> south of the <col=800000>Digsite</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.MINING, 15300);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 2000);
  }

  function isQuestStarted(player, key) {
    const request = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (EXAMINER_NPC_IDS.has(npcId)) {
      if (stage === 0) return "starting-the-quest";
      if (awaitingLetter(player)) {
        if (!held(player, STAMPED_LETTER_ITEM_ID)) return "starting-the-quest-talking-to-an-examiner-again";
        deliverLetter(player);
        return "the-first-exam-taking-the-exam";
      }
      if (stage === STAGE_STARTED) return "the-first-exam-taking-the-exam-repeating-the-exam";
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
      // The first exam only begins once the examiner has the stamped letter.
      if (isRightStudent && certificate !== undefined && !awaitingLetter(player)) {
        if (player.getInventory().getFreeSlots() < 1) {
          // The exam isn't passed yet, so it waits. No capture of this: the wording is ours.
          player.sendMessage("You don't have enough inventory space for the certificate.");
        } else {
          player.getInventory().adds(certificate, 1);
          player.sendMessage("The student signs your certificate.");
          quest.setStage(player, stage + 1);
        }
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
        // The Wiki has no certificate check here, so a lost one can't stop him. Any held still go.
        const certificates = [
          LEVEL_1_CERTIFICATE_ITEM_ID,
          LEVEL_2_CERTIFICATE_ITEM_ID,
          LEVEL_3_CERTIFICATE_ITEM_ID,
        ].filter((itemId) => held(player, itemId));
        if (player.getInventory().getFreeSlots() + certificates.length < 1) {
          // No capture of this: the wording is ours.
          player.sendMessage("You don't have enough inventory space for the compound.");
        } else {
          for (const itemId of certificates) player.getInventory().deleteNumber(itemId, 1);
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
      // The Golem reuses the museum curator only while its museum step is active.
      if (isQuestStarted(player, "the_golem") && !isQuestComplete(player, "the_golem")) return null;
      // Only while the letter is still owed; otherwise the curator's own dialogue.
      if (!awaitingLetter(player)) return null;
      if (!stamped(player) && held(player, UNSTAMPED_LETTER_ITEM_ID)) {
        stampLetter(player);
        return "starting-the-quest-getting-the-curator-s-approval";
      }
      return stamped(player) ? "starting-the-quest-getting-the-curator-s-approval-talking-the-curator-again" : null;
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

  /** Answer the page's prose conditions for this plugin's own NPCs. */
  function answerCondition({ player, npcId, text }) {
    if (!DIALOGUE_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("does not have a trowel")) return !has(TROWEL_ITEM_ID);
    if (value.includes("has a trowel")) return has(TROWEL_ITEM_ID);
    if (value.includes("doesn't have the key")) return true;
    if (value.includes("already has the key")) return false;
    if (npcId === CURATOR_NPC_ID) {
      // Talking to the curator again: re-stamp a lost letter, or stamp another one.
      if (value.includes("another unstamped letter")) {
        if (!held(player, UNSTAMPED_LETTER_ITEM_ID)) return false;
        stampLetter(player);
        return true;
      }
      if (value.includes("still has the letter") || value.includes("still have the letter")) {
        return held(player, STAMPED_LETTER_ITEM_ID);
      }
      if (value.includes("lost the letter")) {
        if (holdsLetter(player)) return false;
        giveLetter(player, STAMPED_LETTER_ITEM_ID);
        return true;
      }
    } else if (EXAMINER_NPC_IDS.has(npcId)) {
      if (value.includes("still has the letter") || value.includes("still have the letter")) return holdsLetter(player);
      if (value.includes("lost the letter")) {
        if (holdsLetter(player)) return false;
        giveLetter(player, UNSTAMPED_LETTER_ITEM_ID);
        return true;
      }
    }
    if (value.includes("shield of arrav hasn't been completed")) return !isQuestComplete(player, "shield_of_arrav");
    if (value.includes("shield of arrav has been completed")) return isQuestComplete(player, "shield_of_arrav");
    return null;
  }

  /** Wiki: 25 Thieving, 10 Herblore and 10 Agility. */
  const REQUIRED_SKILLS = [
    { skill: Skill.THIEVING, level: 25, label: "Thieving" },
    { skill: Skill.HERBLORE, level: 10, label: "Herblore" },
    { skill: Skill.AGILITY, level: 10, label: "Agility" },
  ];

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function meetsSkillRequirements(player) {
    return missingSkillRequirements(player).length === 0;
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!EXAMINER_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      if (!meetsSkillRequirements(player)) {
        notifySkillRequirements(player);
        return;
      }
      quest.setStage(player, STAGE_STARTED);
      player.setAttribute(STAMPED_ATTRIBUTE, false);
      player.setAttribute(DELIVERED_ATTRIBUTE, false);
      // "You can if you get this letter stamped by the Curator of Varrock's museum."
      giveLetter(player, UNSTAMPED_LETTER_ITEM_ID);
    }
  }

  /** The letters used on the examiner and the curator. */
  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const targetId = event.npcId ?? event.target?.getId?.();
    if (!player || (itemId !== UNSTAMPED_LETTER_ITEM_ID && itemId !== STAMPED_LETTER_ITEM_ID)) return;
    if (EXAMINER_NPC_IDS.has(targetId)) {
      event.handled = true;
      if (itemId === UNSTAMPED_LETTER_ITEM_ID) {
        startTranscript(api, player, targetId, PAGE, "starting-the-quest-using-an-unstamped-letter-on-the-examiner");
      } else if (awaitingLetter(player)) {
        deliverLetter(player);
        startTranscript(api, player, targetId, PAGE, "the-first-exam-taking-the-exam");
      } else {
        startTranscript(api, player, targetId, PAGE, "the-first-exam-taking-the-exam-using-another-stamped-letter-on-the-examiner");
      }
    } else if (targetId === CURATOR_NPC_ID) {
      event.handled = true;
      if (itemId === STAMPED_LETTER_ITEM_ID) {
        startTranscript(api, player, targetId, PAGE, "starting-the-quest-getting-the-curator-s-approval-using-the-stamped-letter-on-the-curator");
      } else if (awaitingLetter(player)) {
        const first = !stamped(player);
        stampLetter(player);
        startTranscript(api, player, targetId, PAGE, first
          ? "starting-the-quest-getting-the-curator-s-approval"
          : "starting-the-quest-getting-the-curator-s-approval-talking-the-curator-again");
      } else {
        event.handled = false;
      }
    }
  }

  /** Terry's discovery turn-in completes the quest. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== TERRY_BALANDO_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (!quest.isComplete(player)) quest.complete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(STAMPED_ATTRIBUTE, false);
  api.persistAttribute(DELIVERED_ATTRIBUTE, false);
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
  api.onItemOnNpc(handleItemOnNpc);
  api.onPlayerLogin(handleLogin);
};
