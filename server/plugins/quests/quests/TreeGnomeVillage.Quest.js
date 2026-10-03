/**
 * Tree Gnome Village (members).
 *
 * Words come from the "Tree Gnome Village" transcript page. The plugin supplies
 * the variant selector for King Bolren, Commander Montai, Elkoy, the trackers,
 * the Khazard warlord and the villagers, the prose-condition answers, the start
 * hook, the six-log hand-in and the orb hand-in that completes the quest.
 *
 * Stages (varp 111): 1 started, 2 told Montai, 3 given logs, 4 finding trackers,
 * 5 ballista fired, 6 first orb retrieved, 7 returned first orb, 8 warlord
 * defeated, 9 complete.
 *
 * Gaps: the ballista, crumbled wall, stronghold chest, maze travel and the
 * warlord's orb drop are object/NPC-death interactions the dump does not pin to
 * object ids; the transcript conversation drives the stages that are reachable.
 */
module.exports = function registerTreeGnomeVillageQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Tree Gnome Village";
  const VARP_TREE_GNOME_VILLAGE = 111;

  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_MONTAI = 2;
  const STAGE_GIVEN_LOGS = 3;
  const STAGE_FINDING_TRACKERS = 4;
  const STAGE_BALLISTA_FIRED = 5;
  const STAGE_RETRIEVED_ORB = 6;
  const STAGE_RETURNED_FIRST_ORB = 7;
  const STAGE_DEFEATED_WARLORD = 8;
  const STAGE_COMPLETE = 9;

  const START_HOOK = "quest:tree-gnome-village:start";
  /** Condition branch that hands Montai the six logs. */
  const LOGS_HAND_IN_STEP_ID = "cu5-py";
  /** Transcript action that ends the "return of the orb" branch. */
  const COMPLETE_ACTION_ID = "51Oq7J";

  const KING_BOLREN_NPC_ID = NpcIdentifiers.KING_BOLREN;
  const COMMANDER_MONTAI_NPC_ID = NpcIdentifiers.COMMANDER_MONTAI;
  const KHAZARD_WARLORD_NPC_IDS = new Set([NpcIdentifiers.KHAZARD_WARLORD_2, NpcIdentifiers.KHAZARD_WARLORD_3]);
  const ELKOY_NPC_IDS = new Set([NpcIdentifiers.ELKOY, NpcIdentifiers.ELKOY_2]);

  const TRACKER_VARIANTS = new Map([
    [
      NpcIdentifiers.TRACKER_GNOME_1,
      {
        battlefield: "battlefield-talking-to-tracker-gnome-1",
        coords: "battlefield-tracker-gnomes-tracker-gnome-1",
        fired: "using-the-ballista-talking-to-tracker-gnome-1-after-successfully-firing-the-ballista",
        orb: "into-the-stronghold-tracker-gnome-1-after-getting-the-orb",
        returned: "bringing-bolren-the-orb-tracker-gnome-1",
      },
    ],
    [
      NpcIdentifiers.TRACKER_GNOME_2,
      {
        battlefield: "battlefield-talking-to-tracker-gnome-2",
        coords: "battlefield-tracker-gnomes-tracker-gnome-2",
        fired: "using-the-ballista-talking-to-tracker-gnome-2-after-successfully-firing-the-ballista",
        orb: "into-the-stronghold-tracker-gnome-2-after-getting-the-orb",
        returned: "bringing-bolren-the-orb-tracker-gnome-2",
      },
    ],
    [
      NpcIdentifiers.TRACKER_GNOME_3,
      {
        battlefield: "battlefield-talking-to-tracker-gnome-3",
        coords: "battlefield-tracker-gnomes-tracker-gnome-3",
        fired: "using-the-ballista-talking-to-tracker-gnome-3-after-successfully-firing-the-ballista",
        orb: "into-the-stronghold-tracker-gnome-3-after-getting-the-orb",
        returned: "bringing-bolren-the-orb-tracker-gnome-3",
      },
    ],
  ]);

  const LOGS_ITEM_ID = ItemIdentifiers.LOGS;
  const ORB_OF_PROTECTION_ITEM_ID = ItemIdentifiers.ORB_OF_PROTECTION;
  const ORBS_OF_PROTECTION_ITEM_ID = ItemIdentifiers.ORBS_OF_PROTECTION;
  const GNOME_AMULET_ITEM_ID = ItemIdentifiers.GNOME_AMULET;
  const LOGS_REQUIRED = 6;

  const page = (variant) => ({ page: PAGE, variant });

  let quest;

  function logCount(player) {
    return player.getInventory().getAmount(LOGS_ITEM_ID);
  }

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I restored all three orbs of protection.</str>",
        "<str>The Spirit Tree keeps the gnomes safe once more.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB || stage >= STAGE_DEFEATED_WARLORD) {
      return ["I must defeat the <col=800000>Khazard warlord</col> and take back the remaining orbs."];
    }
    if (stage >= STAGE_RETRIEVED_ORB) {
      return ["I should return the first orb to <col=800000>King Bolren</col>."];
    }
    if (stage >= STAGE_BALLISTA_FIRED) {
      return ["The stronghold is breached. I need the orb from its chest."];
    }
    if (stage >= STAGE_FINDING_TRACKERS) {
      return ["I should find the three trackers, then fire the <col=800000>ballista</col>."];
    }
    if (stage >= STAGE_GIVEN_LOGS) {
      return ["I should speak to <col=800000>Commander Montai</col> about the attack."];
    }
    if (stage >= STAGE_SPOKEN_MONTAI) {
      return ["Montai needs <col=800000>six normal logs</col>."];
    }
    if (stage >= STAGE_STARTED) {
      return ["I should report to <col=800000>Commander Montai</col> on the battlefield."];
    }
    return [
      "I can start this quest by speaking to <col=800000>King Bolren</col>",
      "in the Tree Gnome Village maze.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 11450);
  }

  function bolrenVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "return-of-the-orb";
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return has(player, ORBS_OF_PROTECTION_ITEM_ID)
        ? "return-of-the-orb"
        : "the-khazard-warlord-talking-to-king-bolren-without-the-orbs-after-getting-them";
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
      return "into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it";
    }
    if (stage >= STAGE_RETRIEVED_ORB) return "bringing-bolren-the-orb";
    if (stage >= STAGE_GIVEN_LOGS) {
      return "tree-gnome-king-talking-to-king-bolren-again-after-agreeing-to-bring-logs-to-montai";
    }
    if (stage >= STAGE_STARTED) {
      return "tree-gnome-king-talking-to-king-bolren-again-before-agreeing-to-bring-logs-to-montai";
    }
    return "tree-gnome-king";
  }

  function montaiVariant(stage) {
    if (stage >= STAGE_RETRIEVED_ORB) return "into-the-stronghold-commander-montai-after-getting-the-orb";
    if (stage >= STAGE_BALLISTA_FIRED) return "using-the-ballista-commander-montai-after-shooting-the-ballista";
    if (stage >= STAGE_FINDING_TRACKERS) return "battlefield-commander-montai-while-getting-the-coordinates";
    if (stage >= STAGE_GIVEN_LOGS) return "battlefield-talking-to-commander-montai-afterwards";
    if (stage >= STAGE_SPOKEN_MONTAI) return "battlefield-commander-montai-again";
    if (stage >= STAGE_STARTED) return "battlefield-commander-montai";
    return "battlefield-commander-montai";
  }

  function trackerVariant(variants, stage) {
    if (stage >= STAGE_RETURNED_FIRST_ORB) return variants.returned;
    if (stage >= STAGE_RETRIEVED_ORB) return variants.orb;
    if (stage >= STAGE_BALLISTA_FIRED) return variants.fired;
    if (stage >= STAGE_FINDING_TRACKERS) return variants.coords;
    return variants.battlefield;
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === KING_BOLREN_NPC_ID) return page(bolrenVariant(player, stage));
    if (npcId === COMMANDER_MONTAI_NPC_ID) return page(montaiVariant(stage));
    if (KHAZARD_WARLORD_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_DEFEATED_WARLORD) {
        return page("the-khazard-warlord-talking-to-the-khazard-warlord-again-after-defeating-him");
      }
      if (stage >= STAGE_RETURNED_FIRST_ORB) return page("the-khazard-warlord");
      return page("battlefield-talking-to-the-khazard-warlord");
    }
    if (ELKOY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_DEFEATED_WARLORD) {
        return page("the-khazard-warlord-elkoy-after-defeating-the-warlord");
      }
      if (stage >= STAGE_RETURNED_FIRST_ORB) return page("into-the-stronghold-elkoy-after-getting-the-orb");
      if (stage >= STAGE_FINDING_TRACKERS) return page("battlefield-talking-to-elkoy-after-agreeing-to-help-montai");
      if (stage >= STAGE_STARTED) return page("tree-gnome-king-talking-to-elkoy-after-starting-the-quest-outside-the-maze");
      return page("tree-gnome-king");
    }
    const trackers = TRACKER_VARIANTS.get(npcId);
    if (trackers) return page(trackerVariant(trackers, stage));
    if (npcId === NpcIdentifiers.KHAZARD_COMMANDER) return page("into-the-stronghold");
    if (npcId === NpcIdentifiers.BOLKOY) return page("into-the-stronghold-bolkoy-after-getting-the-orb");
    if (npcId === NpcIdentifiers.REMSAI) return page("tree-gnome-king-talking-to-remsai");
    if (npcId === NpcIdentifiers.KALRON) return page("tree-gnome-king-talking-to-kalron");
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("doesn't have 6 logs") || value.includes("does not have 6 logs")) {
      return logCount(player) < LOGS_REQUIRED;
    }
    if (value.includes("has 6 logs")) return logCount(player) >= LOGS_REQUIRED;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KING_BOLREN_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  /** The chosen "has 6 logs" branch hands them over and advances the quest. */
  function handleConditionStep({ player, npcId, stepId }) {
    if (npcId !== COMMANDER_MONTAI_NPC_ID || stepId !== LOGS_HAND_IN_STEP_ID) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_GIVEN_LOGS) return;
    if (logCount(player) < LOGS_REQUIRED) return;
    player.getInventory().deleteNumber(LOGS_ITEM_ID, LOGS_REQUIRED);
    player.sendMessage("You give six loads of logs to Commander Montai.");
    quest.setStage(player, STAGE_GIVEN_LOGS);
  }

  /** The transcript's "Quest complete!" action finishes the quest. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== KING_BOLREN_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    for (const itemId of [ORB_OF_PROTECTION_ITEM_ID, ORBS_OF_PROTECTION_ITEM_ID]) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
    }
    quest.complete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "tree_gnome_village",
    name: "Tree Gnome Village",
    varpId: VARP_TREE_GNOME_VILLAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.ATTACK.getIndex(), amount: 11450, label: "Attack" }],
    rewardItemId: GNOME_AMULET_ITEM_ID,
    rewardItemLabel: "A gnome amulet",
    otherRewards: ["Use of the Spirit Tree network"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
