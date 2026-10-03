/**
 * The Grand Tree (members).
 *
 * Words come from the "The Grand Tree" transcript page. The plugin supplies the
 * variant selector for King Narnode Shareen, Hazelmere, Glough, Charlie, the
 * shipyard crew, Anita and the cutscene actors, plus the prose-condition answers,
 * the start hook (stage + bark sample + translation book) and the Daconia hand-in
 * that completes the quest.
 *
 * Stages (varp 150): 10 started, 20 told Hazelmere, 30 relayed, 40 told Glough,
 * 50 found prisoner, 60 spoke prisoner, 70 found journal, 80 released, 90 lumber
 * order, 100 Charlie clue, 110 invasion plans, 120 twigs, 130 trapdoor, 140 demon
 * defeated, 150 searching Daconia, 160 complete. The varp runs 0..160 in tens.
 *
 * Gaps: the stronghold glider, shipyard gate/password, Glough's cupboards and
 * chest, the four pillars/trapdoor and the black demon are object/NPC-death
 * interactions the dump does not pin to object ids; the transcript conversation
 * drives the stages that are reachable. The start cutscene is split across two
 * variants, so the foundations variant is played directly at stage 0.
 */
module.exports = function registerGrandTreeQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "The Grand Tree";
  const VARP_GRAND_TREE = 150;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_HAZELMERE = 20;
  const STAGE_RELAYED_MESSAGE = 30;
  const STAGE_SPOKEN_GLOUGH = 40;
  const STAGE_FOUND_PRISONER = 50;
  const STAGE_SPOKEN_PRISONER = 60;
  const STAGE_FOUND_JOURNAL = 70;
  const STAGE_RELEASED = 80;
  const STAGE_LUMBER_ORDER = 90;
  const STAGE_CHARLIE_CLUE = 100;
  const STAGE_INVASION_PLANS = 110;
  const STAGE_GIVEN_TWIGS = 120;
  const STAGE_TRAPDOOR = 130;
  const STAGE_DEMON_DEFEATED = 140;
  const STAGE_SEARCHING_DACONIA = 150;
  const STAGE_COMPLETE = 160;

  const START_HOOK = "quest:the-grand-tree:start";
  /** Transcript action that ends the "Daconia delivered" branch. */
  const COMPLETE_ACTION_ID = "PJWrB9";

  const NARNODE_IDS = new Set([NpcIdentifiers.KING_NARNODE_SHAREEN, NpcIdentifiers.KING_NARNODE_SHAREEN_2]);
  const HAZELMERE_IDS = new Set([NpcIdentifiers.HAZELMERE, 4647]);
  const GLOUGH_IDS = new Set([
    NpcIdentifiers.GLOUGH,
    NpcIdentifiers.GLOUGH_2,
    NpcIdentifiers.GLOUGH_3,
    NpcIdentifiers.GLOUGH_7,
  ]);
  const CHARLIE_IDS = new Set([NpcIdentifiers.CHARLIE]);
  const ANITA_IDS = new Set([NpcIdentifiers.ANITA, NpcIdentifiers.ANITA_2]);
  const GNOME_GUARD_IDS = new Set([NpcIdentifiers.GNOME_GUARD_2, NpcIdentifiers.GNOME_GUARD_3]);
  const JOGRE_IDS = new Set([NpcIdentifiers.JOGRE, NpcIdentifiers.JOGRE_2]);
  const CAPTAIN_ERRDO_IDS = new Set([6088, 6091, 10467, 10468, 10469, 10470, 10471, 10472, 10473]);

  const BARK_SAMPLE_ITEM_ID = ItemIdentifiers.BARK_SAMPLE;
  const TRANSLATION_BOOK_ITEM_ID = ItemIdentifiers.TRANSLATION_BOOK;
  const DACONIA_ROCK_ITEM_ID = ItemIdentifiers.DACONIA_ROCK;
  const TWIG_ITEM_IDS = [
    ItemIdentifiers.TWIGS,
    ItemIdentifiers.TWIGS_2,
    ItemIdentifiers.TWIGS_3,
    ItemIdentifiers.TWIGS_4,
  ];

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasTwigs = (player) => TWIG_ITEM_IDS.some((itemId) => has(player, itemId));

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I exposed Glough and saved the Grand Tree.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_SEARCHING_DACONIA) {
      return ["Search the Grand Tree's roots for the final <col=800000>Daconia rock</col>."];
    }
    if (stage >= STAGE_DEMON_DEFEATED) {
      return ["Tell <col=800000>King Narnode</col> about Glough and the demon."];
    }
    if (stage >= STAGE_TRAPDOOR) {
      return ["Enter Glough's trapdoor and defeat his black demon."];
    }
    if (stage >= STAGE_GIVEN_TWIGS) {
      return ["Place the four twigs on Glough's pillars in the order T-U-Z-O."];
    }
    if (stage >= STAGE_INVASION_PLANS) {
      return ["Take Glough's invasion plans to <col=800000>King Narnode</col>."];
    }
    if (stage >= STAGE_CHARLIE_CLUE) {
      return ["Get Glough's key from Anita and search his cupboard."];
    }
    if (stage >= STAGE_LUMBER_ORDER) {
      return ["Show the lumber order to <col=800000>Charlie</col> in the Grand Tree prison."];
    }
    if (stage >= STAGE_RELEASED) {
      return ["Investigate the Karamja shipyard and speak to its foreman."];
    }
    if (stage >= STAGE_FOUND_JOURNAL) {
      return ["Give Glough's journal to King Narnode."];
    }
    if (stage >= STAGE_SPOKEN_PRISONER || stage >= STAGE_FOUND_PRISONER) {
      return ["Speak to Charlie, then search Glough's chest for evidence."];
    }
    if (stage >= STAGE_SPOKEN_GLOUGH) {
      return ["Return to King Narnode and ask about Glough's suspect."];
    }
    if (stage >= STAGE_RELAYED_MESSAGE) {
      return ["Speak to <col=800000>Glough</col> south-east of the Grand Tree."];
    }
    if (stage >= STAGE_HAZELMERE) {
      return ["Translate Hazelmere's warning for King Narnode."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Take the bark sample to <col=800000>Hazelmere</col> east of Yanille."];
    }
    return ["Speak to <col=800000>King Narnode Shareen</col> with level 25 Agility."];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.ATTACK, 18400);
    skills.addExperiences(Skill.AGILITY, 7900);
    skills.addExperiences(Skill.MAGIC, 2150);
  }

  function narnodeVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "saving-the-tree-the-end-of-the-tunnel-when-talking-to-king-narnode-again";
    if (stage >= STAGE_SEARCHING_DACONIA) {
      return has(player, DACONIA_ROCK_ITEM_ID)
        ? "saving-the-tree-daconia-delivered"
        : "saving-the-tree-the-end-of-the-tunnel-when-talking-to-king-narnode-again";
    }
    if (stage >= STAGE_GIVEN_TWIGS) return "treachery-revealed-glough-s-pet-when-talking-to-king-narnode-without-finishing-the-fight";
    if (stage >= STAGE_INVASION_PLANS) return "treachery-revealed-glough-s-plans-talking-to-king-narnode-shareen";
    if (stage >= STAGE_RELEASED) return "searching-glough-s-cupboard-imprisoned";
    if (stage >= STAGE_FOUND_JOURNAL) return "human-sabotage-reporting-back-to-king-narnode-when-talking-to-king-narnode-again";
    if (stage >= STAGE_SPOKEN_PRISONER) return "human-sabotage-reporting-back-to-king-narnode";
    if (stage >= STAGE_FOUND_PRISONER) {
      return "human-sabotage-reporting-to-the-king-when-talking-to-king-narnode-shareen-again";
    }
    if (stage >= STAGE_SPOKEN_GLOUGH) return "human-sabotage-reporting-to-the-king";
    if (stage >= STAGE_RELAYED_MESSAGE) return "a-deadly-plot-when-speaking-to-king-narnode-shareen-again";
    if (stage >= STAGE_HAZELMERE) return "a-deadly-plot-bring-back-the-news";
    if (stage >= STAGE_STARTED) return "the-dying-tree-when-speaking-to-king-narnode-shareen-again";
    return "the-dying-tree-foundations-cutscene";
  }

  function gloughVariant(stage) {
    if (stage >= STAGE_COMPLETE) return "post-quest-glough";
    if (stage >= STAGE_FOUND_JOURNAL) return "treachery-revealed-when-speaking-to-glough";
    if (stage >= STAGE_SPOKEN_GLOUGH) return "searching-glough-s-cupboard-suspicions";
    return "human-sabotage-glough";
  }

  function charlieVariant(stage) {
    if (stage >= STAGE_INVASION_PLANS) return "treachery-revealed-glough-s-plans-talking-to-charlie";
    if (stage >= STAGE_CHARLIE_CLUE) return "treachery-revealed-charlie";
    if (stage >= STAGE_RELEASED) return "searching-glough-s-cupboard-imprisoned-when-speaking-to-charlie-again";
    if (stage >= STAGE_FOUND_PRISONER) return "human-sabotage-interrogating-the-prisoner-when-talking-to-charlie-again";
    return "human-sabotage-interrogating-the-prisoner";
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (NARNODE_IDS.has(npcId)) return page(narnodeVariant(player, stage));
    if (HAZELMERE_IDS.has(npcId)) {
      return page(stage >= STAGE_HAZELMERE ? "hazelmere-s-island-when-speaking-again-to-hazelmere" : "hazelmere-s-island");
    }
    if (GLOUGH_IDS.has(npcId)) return page(gloughVariant(stage));
    if (CHARLIE_IDS.has(npcId)) return page(charlieVariant(stage));
    if (ANITA_IDS.has(npcId)) {
      return page(stage >= STAGE_CHARLIE_CLUE ? "treachery-revealed-anita" : "treachery-revealed-anita");
    }
    if (npcId === NpcIdentifiers.FOREMAN) return page("treachery-revealed-the-shipyard-foreman");
    if (npcId === NpcIdentifiers.SHIPYARD_WORKER) return page("treachery-revealed-the-shipyard-password");
    if (npcId === NpcIdentifiers.FEMI) {
      return page("treachery-revealed-sneaking-around-when-talking-to-femi-if-you-helped-her");
    }
    if (GNOME_GUARD_IDS.has(npcId)) return page("treachery-revealed-sneaking-around-gnome-guard");
    if (JOGRE_IDS.has(npcId)) return page("treachery-revealed-arrival-upon-ending-the-conversation-with-errdo");
    if (CAPTAIN_ERRDO_IDS.has(npcId)) return page("treachery-revealed-arrival-talking-to-captain-errdo-again");
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("below level 50 combat")) return false;
    if (value.includes("lost the bark sample")) return !has(player, BARK_SAMPLE_ITEM_ID);
    if (value.includes("lost the translation book")) return !has(player, TRANSLATION_BOOK_ITEM_ID);
    if (value.includes("lost the twigs")) return !hasTwigs(player);
    if (value.includes("doesn't have enough inventory space")) return player.getInventory().isFull();
    if (value.includes("has enough inventory space")) return !player.getInventory().isFull();
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!NARNODE_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    if (!has(player, BARK_SAMPLE_ITEM_ID)) player.getInventory().adds(BARK_SAMPLE_ITEM_ID, 1);
    if (!has(player, TRANSLATION_BOOK_ITEM_ID)) player.getInventory().adds(TRANSLATION_BOOK_ITEM_ID, 1);
  }

  /** The transcript's "Quest complete!" action consumes the Daconia rock. */
  function handleAction({ player, npcId, stepId }) {
    if (!NARNODE_IDS.has(npcId) || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    if (has(player, DACONIA_ROCK_ITEM_ID)) player.getInventory().deleteNumber(DACONIA_ROCK_ITEM_ID, 1);
    quest.complete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "grand_tree",
    name: "The Grand Tree",
    varpId: VARP_GRAND_TREE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 5,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: 18400, label: "Attack" },
      { skillId: Skill.AGILITY.getIndex(), amount: 7900, label: "Agility" },
      { skillId: Skill.MAGIC.getIndex(), amount: 2150, label: "Magic" },
    ],
    rewardItemId: DACONIA_ROCK_ITEM_ID,
    rewardItemLabel: "Access to the Grand Tree mine",
    otherRewards: ["Gnome gliders", "Spirit Tree travel"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
