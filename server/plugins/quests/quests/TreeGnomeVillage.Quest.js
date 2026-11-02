/**
 * Tree Gnome Village (members).
 *
 * Words come from the "Tree Gnome Village" transcript page. The plugin supplies
 * the variant selector for King Bolren, Commander Montai, Elkoy, the trackers,
 * the Khazard warlord and the villagers, the prose-condition answers, the start
 * hook, the six-log hand-in, the ballista/chest/wall interactions and the orb
 * hand-in that completes the quest.
 *
 * Stages (varp 111): 1 started, 2 told Montai, 3 given logs, 4 finding trackers,
 * 5 ballista fired, 6 first orb retrieved, 7 returned first orb, 8 warlord
 * defeated, 9 complete.
 *
 * Varbits 598-602 share varp 279: orbs handed in, the three trackers, and the
 * random x coordinate the trackers' riddle and the ballista read.
 */
module.exports = function registerTreeGnomeVillageQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, Location, Task, TaskManager } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

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
  const VARBIT_BOLREN_GOT_ORBS = 598;
  const VARBIT_GNOMETRACKER_H = 599;
  const VARBIT_GNOMETRACKER_Y = 600;
  const VARBIT_GNOMETRACKER_X = 601;
  const VARBIT_BALLISTA = 602;

  const TRACKER_STATE_ATTRIBUTE = "tree-gnome-village:trackers";
  const BALLISTA_COORDINATE_ATTRIBUTE = "tree-gnome-village:ballista-coordinate";

  const BALLISTA_OBJECT_ID = 2181;
  const CRUMBLED_WALL_OBJECT_ID = 2185;
  const CLOSED_CHEST_OBJECT_ID = 2183;
  const OPEN_CHEST_OBJECT_ID = 2182;
  const KHAZARD_WARLORD_SPAWN_ID = 4971;
  const VARBIT_WARLORD_FIGHTING = 3460; // khazard_warlord_fighting
  const WARLORD_COMBAT_ID = NpcIdentifiers.KHAZARD_WARLORD_3;
  const ELKOY_OUTSIDE_MAZE_ID = 6265;
  const ELKOY_INSIDE_MAZE_ID = 6266;
  const VILLAGE_ENTRANCE = new Location(2504, 3191, 0);
  // QH maze path ends south of Loose railing2186; Elkoy does not bypass it.
  const INNER_MAZE_EXIT = new Location(2515, 3159, 0);
  const WALL_SOUTH_LANDING = new Location(2509, 3252, 0);
  const WALL_NORTH_LANDING = new Location(2509, 3254, 0);

  const START_HOOK = "quest:tree-gnome-village:start";
  /** Condition branch that hands Montai the six logs. */
  const LOGS_HAND_IN_STEP_ID = "cu5-py";
  /** Transcript action that ends the "return of the orb" branch. */
  const COMPLETE_ACTION_ID = "51Oq7J";
  const POST_QUEST_AMULET_CONDITION_IDS = new Set(["jhUV9W", "khpxfY", "a0UQ7j"]);
  const POST_QUEST_AMULET_MESSAGE_ID = "SoVY4z";
  const POST_QUEST_AMULET_RECEIVE_IDS = new Set(["LUAm8Y", "wWnJYI"]);
  const TRACKER_H_MESSAGE_ID = "eBZQ_A";
  const TRACKER_Y_MESSAGE_ID = "8H1UCb";
  const CHEST_ORB_MESSAGE_ID = "PatYnA";
  const BALLISTA_SUCCESS_CONDITION_ID = "1G3SE7";
  const BALLISTA_MISS_CONDITION_ID = "wwt4fB";
  const TRACKER_X_CONDITION_IDS = new Set(["FBaYjB", "cLo8NW", "RDXbKP", "TPAWlA"]);

  const KING_BOLREN_NPC_ID = NpcIdentifiers.KING_BOLREN;
  const COMMANDER_MONTAI_NPC_ID = NpcIdentifiers.COMMANDER_MONTAI;
  const KHAZARD_WARLORD_NPC_IDS = new Set([
    KHAZARD_WARLORD_SPAWN_ID,
    NpcIdentifiers.KHAZARD_WARLORD_2,
    NpcIdentifiers.KHAZARD_WARLORD_3,
  ]);
  const ELKOY_NPC_IDS = new Set([
    NpcIdentifiers.ELKOY, NpcIdentifiers.ELKOY_2, ELKOY_OUTSIDE_MAZE_ID, ELKOY_INSIDE_MAZE_ID,
  ]);

  const TRACKER_VARIANTS = new Map([
    [
      NpcIdentifiers.TRACKER_GNOME_1,
      {
        postQuestPage: "Tracker gnome 1",
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
        postQuestPage: "Tracker gnome 2",
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
        postQuestPage: "Tracker gnome 3",
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
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return ["I should return the <col=800000>orbs of protection</col> to King Bolren."];
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
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

  const ballistaChoices = new WeakMap();
  const warlordsByPlayer = new Map();

  function trackerMask(player) {
    return Number(player.getAttribute(TRACKER_STATE_ATTRIBUTE)) || 0;
  }

  function allTrackersFound(player) {
    return (trackerMask(player) & 0b111) === 0b111;
  }

  function ballistaCoordinate(player) {
    const value = Number(player.getAttribute(BALLISTA_COORDINATE_ATTRIBUTE));
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
  }

  function isInsideVillage(player) {
    const location = player.getLocation?.();
    return !!location && location.z === 0
      && location.x >= 2514 && location.x <= 2542
      && location.y >= 3158 && location.y <= 3175;
  }

  function giveItem(player, itemId) {
    const inventory = player.getInventory();
    if (inventory.getAmount(itemId) > 0) return;
    if (inventory.isFull()) {
      const groundItems = api.getItemOnGroundManager();
      const location = player.getLocation();
      if (!groundItems.getGroundItem(player.getUsername(), itemId, location, player.getPrivateArea())) {
        groundItems.registerLocation(player, new api.core.Item(itemId, 1), location.clone());
      }
      return;
    }
    inventory.adds(itemId, 1);
  }

  function beginTrackerSearch(player) {
    player.setAttribute(TRACKER_STATE_ATTRIBUTE, 0);
    player.setAttribute(BALLISTA_COORDINATE_ATTRIBUTE, Math.floor(Math.random() * 4));
    quest.setStage(player, STAGE_FINDING_TRACKERS);
  }

  function bolrenVariant(player, stage) {
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return has(player, ORBS_OF_PROTECTION_ITEM_ID)
        ? "return-of-the-orb"
        : "the-khazard-warlord-talking-to-king-bolren-without-the-orbs-after-getting-them";
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
      return "into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it";
    }
    if (stage >= STAGE_RETRIEVED_ORB) {
      return has(player, ORB_OF_PROTECTION_ITEM_ID)
        ? "bringing-bolren-the-orb"
        : "into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it";
    }
    if (stage >= STAGE_SPOKEN_MONTAI) {
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
    return null;
  }

  function trackerVariant(variants, stage) {
    if (stage >= STAGE_RETURNED_FIRST_ORB) return variants.returned;
    if (stage >= STAGE_RETRIEVED_ORB) return variants.orb;
    if (stage >= STAGE_BALLISTA_FIRED) return variants.fired;
    if (stage >= STAGE_FINDING_TRACKERS) return variants.coords;
    return variants.battlefield;
  }

  function elkoyVariant(stage, inside) {
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return inside
        ? "the-khazard-warlord-elkoy-after-defeating-the-warlord-inside-the-maze"
        : "the-khazard-warlord-elkoy-after-defeating-the-warlord";
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
      return inside
        ? "bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-inside-the-maze"
        : "bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-outside-the-maze";
    }
    if (stage >= STAGE_RETRIEVED_ORB) {
      return inside
        ? "into-the-stronghold-elkoy-after-getting-the-orb-inside-the-maze"
        : "into-the-stronghold-elkoy-after-getting-the-orb";
    }
    if (stage >= STAGE_FINDING_TRACKERS) return "battlefield-talking-to-elkoy-after-agreeing-to-help-montai";
    if (stage >= STAGE_STARTED) {
      return inside
        ? "tree-gnome-king-talking-to-elkoy-after-starting-the-quest-inside-the-maze"
        : "tree-gnome-king-talking-to-elkoy-after-starting-the-quest-outside-the-maze";
    }
    return null;
  }

  /**
   * Which transcript variant the clicked NPC plays. Indexed NPCs fall through to
   * their own page once this quest is done; Elkoy and the warlord's map-spawn ids
   * are not in npc-dialogue-index, so their canonical page is selected here.
   */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    const inside = isInsideVillage(player);
    if (ELKOY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        return {
          page: "Elkoy",
          variant: inside
            ? "after-the-completion-of-tree-gnome-village-while-inside-the-village"
            : "after-the-completion-of-tree-gnome-village-while-at-the-maze-entrance",
        };
      }
      if (stage < STAGE_STARTED) {
        return {
          page: "Elkoy",
          variant: inside
            ? "before-starting-tree-gnome-village-while-at-the-village"
            : "before-starting-tree-gnome-village-while-outside-the-maze",
        };
      }
      const variant = elkoyVariant(stage, inside);
      return variant ? page(variant) : null;
    }
    if (stage >= STAGE_COMPLETE) {
      if (npcId === COMMANDER_MONTAI_NPC_ID) {
        return { page: "Commander Montai", variant: "after-returning-the-orb-of-protection-to-king-bolren" };
      }
      const trackers = TRACKER_VARIANTS.get(npcId);
      if (trackers) {
        return { page: trackers.postQuestPage, variant: "after-returning-the-orb-of-protection-to-king-bolren" };
      }
      if (KHAZARD_WARLORD_NPC_IDS.has(npcId)) {
        return { page: "Khazard warlord", variant: "after-killing-him-in-tree-gnome-village" };
      }
      return null;
    }
    if (npcId === KING_BOLREN_NPC_ID) return page(bolrenVariant(player, stage));
    if (npcId === COMMANDER_MONTAI_NPC_ID) {
      const variant = montaiVariant(stage);
      return variant ? page(variant) : null;
    }
    if (KHAZARD_WARLORD_NPC_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) {
        return npcId === KHAZARD_WARLORD_SPAWN_ID
          ? { page: "Khazard warlord", variant: "dialogue-before-taking-the-orb-of-protection" }
          : null;
      }
      if (stage >= STAGE_DEFEATED_WARLORD) {
        return page("the-khazard-warlord-talking-to-the-khazard-warlord-again-after-defeating-him");
      }
      if (stage >= STAGE_RETURNED_FIRST_ORB) return page("the-khazard-warlord");
      return page("battlefield-talking-to-the-khazard-warlord");
    }
    const trackers = TRACKER_VARIANTS.get(npcId);
    if (trackers) return stage >= STAGE_STARTED ? page(trackerVariant(trackers, stage)) : null;
    if (stage < STAGE_STARTED) return null;
    if (npcId === NpcIdentifiers.KHAZARD_COMMANDER
      && stage >= STAGE_BALLISTA_FIRED && stage <= STAGE_RETRIEVED_ORB) return page("into-the-stronghold");
    if (npcId === NpcIdentifiers.BOLKOY) return page("into-the-stronghold-bolkoy-after-getting-the-orb");
    if (npcId === NpcIdentifiers.REMSAI) return page("tree-gnome-king-talking-to-remsai");
    if (npcId === NpcIdentifiers.KALRON) return page("tree-gnome-king-talking-to-kalron");
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text, stepId }) {
    if (npcId === KING_BOLREN_NPC_ID && quest.getStage(player) >= STAGE_COMPLETE &&
      POST_QUEST_AMULET_CONDITION_IDS.has(stepId)) {
      return !has(player, GNOME_AMULET_ITEM_ID);
    }
    if (npcId === COMMANDER_MONTAI_NPC_ID) {
      const value = String(text).toLowerCase();
      if (value.includes("doesn't have 6 logs") || value.includes("does not have 6 logs")) {
        return logCount(player) < LOGS_REQUIRED;
      }
      if (value.includes("has 6 logs")) return logCount(player) >= LOGS_REQUIRED;
    }
    if (TRACKER_X_CONDITION_IDS.has(stepId)) {
      const match = /coordinate is (one|two|three|four)/i.exec(String(text));
      if (!match) return null;
      const coordinate = { one: 0, two: 1, three: 2, four: 3 }[match[1].toLowerCase()];
      return ballistaCoordinate(player) === coordinate;
    }
    if (stepId === BALLISTA_SUCCESS_CONDITION_ID || stepId === BALLISTA_MISS_CONDITION_ID) {
      const chosen = ballistaChoices.get(player);
      if (chosen === undefined) return null;
      const correct = chosen === ballistaCoordinate(player) + 1;
      return stepId === BALLISTA_SUCCESS_CONDITION_ID ? correct : !correct;
    }
    return null;
  }

  function markTracker(player, bit) {
    const mask = trackerMask(player);
    if (mask & (1 << bit)) return;
    player.setAttribute(TRACKER_STATE_ATTRIBUTE, mask | (1 << bit));
    sendProgressVarbits(player);
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KING_BOLREN_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    if (isInsideVillage(player)) player.moveTo(VILLAGE_ENTRANCE.clone());
  }

  /** Montai's offer and the first-orb hand-in; tracker acceptance starts the riddle. */
  function handleChoice({ player, npcId, option }) {
    const stage = quest.getStage(player);
    if (npcId === COMMANDER_MONTAI_NPC_ID) {
      if (option === "Ok, I'll gather some wood." && stage === STAGE_STARTED) {
        quest.setStage(player, STAGE_SPOKEN_MONTAI);
        return;
      }
      if (option === "I'll try my best." && stage === STAGE_GIVEN_LOGS) {
        beginTrackerSearch(player);
        return;
      }
    }
    if (npcId === KING_BOLREN_NPC_ID && option === "I will find the warlord and bring back the orbs."
      && stage === STAGE_RETRIEVED_ORB && has(player, ORB_OF_PROTECTION_ITEM_ID)) {
      player.getInventory().deleteNumber(ORB_OF_PROTECTION_ITEM_ID, 1);
      quest.setStage(player, STAGE_RETURNED_FIRST_ORB);
      return;
    }
    if (ELKOY_NPC_IDS.has(npcId)) {
      if (option === "Can you show me out of the village?") {
        player.moveTo(VILLAGE_ENTRANCE.clone());
      } else if (option === "Yes please.") {
        player.moveTo((isInsideVillage(player) ? VILLAGE_ENTRANCE : INNER_MAZE_EXIT).clone());
      }
      return;
    }
    if (/^000[1-4]$/.test(String(option ?? "")) && stage === STAGE_FINDING_TRACKERS) {
      ballistaChoices.set(player, Number(option));
    }
  }

  /** The chosen "has 6 logs" branch hands them over and advances the quest. */
  function handleConditionStep({ player, npcId, stepId }) {
    const stage = quest.getStage(player);
    if (npcId === COMMANDER_MONTAI_NPC_ID && stepId === LOGS_HAND_IN_STEP_ID) {
      if (stage !== STAGE_SPOKEN_MONTAI) return;
      if (logCount(player) < LOGS_REQUIRED) return;
      player.getInventory().deleteNumber(LOGS_ITEM_ID, LOGS_REQUIRED);
      player.sendMessage("You give six loads of logs to Commander Montai.");
      quest.setStage(player, STAGE_GIVEN_LOGS);
      return;
    }
    if (TRACKER_X_CONDITION_IDS.has(stepId)) {
      markTracker(player, 2);
      return;
    }
    if (stepId === BALLISTA_SUCCESS_CONDITION_ID && stage === STAGE_FINDING_TRACKERS) {
      quest.setStage(player, STAGE_BALLISTA_FIRED);
    }
  }

  /** Transcript message actions that carry item/state changes. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId === KING_BOLREN_NPC_ID && quest.getStage(player) >= STAGE_COMPLETE &&
      (stepId === POST_QUEST_AMULET_MESSAGE_ID || POST_QUEST_AMULET_RECEIVE_IDS.has(stepId))) {
      giveItem(player, GNOME_AMULET_ITEM_ID);
      return;
    }
    if (stepId === TRACKER_H_MESSAGE_ID) {
      if (quest.getStage(player) === STAGE_FINDING_TRACKERS) markTracker(player, 0);
      return;
    }
    if (stepId === TRACKER_Y_MESSAGE_ID) {
      if (quest.getStage(player) === STAGE_FINDING_TRACKERS) markTracker(player, 1);
      return;
    }
    if (stepId === CHEST_ORB_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_BALLISTA_FIRED || stage >= STAGE_RETURNED_FIRST_ORB) return;
      giveItem(player, ORB_OF_PROTECTION_ITEM_ID);
      if (stage === STAGE_BALLISTA_FIRED) quest.setStage(player, STAGE_RETRIEVED_ORB);
      return;
    }
    if (npcId !== KING_BOLREN_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player) || quest.getStage(player) < STAGE_DEFEATED_WARLORD) return;
    if (!has(player, ORBS_OF_PROTECTION_ITEM_ID)) return;
    player.getInventory().deleteNumber(ORBS_OF_PROTECTION_ITEM_ID, player.getInventory().getAmount(ORBS_OF_PROTECTION_ITEM_ID));
    quest.complete(player);
  }

  function fireBallista(player) {
    const stage = quest.getStage(player);
    ballistaChoices.delete(player);
    if (stage < STAGE_FINDING_TRACKERS) {
      startTranscript(api, player, COMMANDER_MONTAI_NPC_ID, PAGE, "battlefield-attempting-to-fire-the-ballista-before-the-repairs");
      return;
    }
    if (stage >= STAGE_BALLISTA_FIRED) {
      startTranscript(api, player, COMMANDER_MONTAI_NPC_ID, PAGE, "using-the-ballista-using-the-ballista-again");
      return;
    }
    if (!allTrackersFound(player)) {
      player.sendMessage("You need the coordinates from all three tracker gnomes first.");
      return;
    }
    startTranscript(api, player, COMMANDER_MONTAI_NPC_ID, PAGE, "using-the-ballista");
  }

  function openChest(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BALLISTA_FIRED) {
      player.sendMessage("The door is locked from the inside.");
      return;
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB || has(player, ORB_OF_PROTECTION_ITEM_ID)) {
      player.sendMessage("The chest is empty.");
      return;
    }
    startTranscript(api, player, NpcIdentifiers.KHAZARD_COMMANDER, PAGE, "into-the-stronghold-upon-opening-the-chest-containing-the-orb-of-protection");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const option = String(event.option ?? "").toLowerCase();
    if (objectId === BALLISTA_OBJECT_ID && option === "fire") {
      fireBallista(player);
      event.handled = true;
      return;
    }
    if ((objectId === CLOSED_CHEST_OBJECT_ID || objectId === OPEN_CHEST_OBJECT_ID)
      && (option === "open" || option === "search")) {
      openChest(player);
      event.handled = true;
      return;
    }
    if (objectId === CRUMBLED_WALL_OBJECT_ID && option === "climb-over") {
      const location = player.getLocation();
      player.moveTo((location.y < WALL_NORTH_LANDING.y ? WALL_NORTH_LANDING : WALL_SOUTH_LANDING).clone());
      event.handled = true;
    }
  }

  function syncWarlord(player) {
    const npc = warlordsByPlayer.get(player);
    player.getPacketSender().sendVarbit(VARBIT_WARLORD_FIGHTING, npc?.isRegistered() ? 1 : 0);
  }

  function handleWarlordBootstrap({ player }) {
    syncWarlord(player);
  }

  /** The transcript's directional chorus labels name the actual village cohorts. */
  function bindCeremonyChorus(request) {
    const { player, step } = request;
    if (request.npcId !== KING_BOLREN_NPC_ID || step?.presentation !== "overhead"
      || !["[Northern Local Gnomes]", "[Southern Local Gnomes]"].includes(step.speaker)
      || quest.getStage(player) !== STAGE_DEFEATED_WARLORD || !has(player, ORBS_OF_PROTECTION_ITEM_ID)) return;
    const locals = [...(player.getLocalNpcs?.() ?? [])];
    const bolren = locals.find(npc => npc.getContentId(player) === KING_BOLREN_NPC_ID);
    const centre = bolren?.getSpawnPosition();
    const north = step.speaker === "[Northern Local Gnomes]";
    request.actors = centre ? locals.filter(npc => {
      if (npc.getContentId(player) !== NpcIdentifiers.LOCAL_GNOME_2) return false;
      const home = npc.getSpawnPosition();
      return home.getZ() === centre.getZ() && (north ? home.getY() > centre.getY() : home.getY() < centre.getY());
    }) : [];
  }

  function clearWarlord(player) {
    const npc = warlordsByPlayer.get(player);
    if (npc) {
      npc.getCombat().reset();
      api.removeNpc(npc);
      warlordsByPlayer.delete(player);
    }
    syncWarlord(player);
  }

  /**
   * The quest's warlord fights from where he was talking and gives up past his combat follow
   * distance (his definition's), as no NPC chases forever. He was spawned with no wander radius,
   * which the movement coordinator never leashes, so he followed players across the map.
   */
  class WarlordLeashTask extends Task {
    constructor(player, fighter) {
      super(1, fighter, false);
      this.player = player;
      this.fighter = fighter;
      this.home = fighter.getLocation().clone();
    }

    execute() {
      const { player, fighter } = this;
      if (warlordsByPlayer.get(player) !== fighter || !fighter.isRegistered()) {
        this.stop();
        return;
      }
      const leash = fighter.getCurrentDefinition().getCombatFollowDistance();
      if (fighter.getLocation().getDistance(this.home) > leash || player.getLocation().getDistance(this.home) > leash * 2) {
        this.stop();
        clearWarlord(player);
      }
    }
  }

  function handleWarlordThreat(request) {
    const { player, npc, npcId, text } = request;
    if (!KHAZARD_WARLORD_NPC_IDS.has(npcId) || !npc?.getLocation
      || (npc.getOwner?.() && npc.getOwner() !== player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_RETURNED_FIRST_ORB || stage > STAGE_DEFEATED_WARLORD) return;
    if (text !== "Ha, you really think you stand a chance? I'll crush you."
      && text !== "Fool, warriors blessed by Khazard don't die. You can't kill that which is already dead. However I can kill you!") return;
    const previous = request.after;
    request.after = () => {
      previous?.();
      const existing = warlordsByPlayer.get(player);
      if (existing?.isRegistered()) return;
      if (player.isRegistered?.() === false || quest.getStage(player) !== stage || !npc.isRegistered()) return;
      const at = npc.getLocation();
      const fighter = api.spawnNpc({ id: WARLORD_COMBAT_ID, x: at.getX(), y: at.getY(), z: at.getZ(),
        owner: player, ownerOnly: true, wanderRadius: 0 });
      if (!fighter) return;
      warlordsByPlayer.set(player, fighter);
      syncWarlord(player);
      TaskManager.submit(new WarlordLeashTask(player, fighter));
      fighter.getCombat().attack(player);
    };
  }

  function handleWarlordLogout({ player }) {
    clearWarlord(player);
  }

  function handleNpcDeath({ npc, npcId, killer, damagers }) {
    if (!KHAZARD_WARLORD_NPC_IDS.has(npcId)) return;
    const player = killer?.isPlayer?.() ? killer : (damagers ?? []).find((entry) => entry?.isPlayer?.());
    if (!player || !npc || npc !== warlordsByPlayer.get(player)) return;
    warlordsByPlayer.delete(player);
    syncWarlord(player);
    const stage = quest.getStage(player);
    if (stage < STAGE_RETURNED_FIRST_ORB || stage > STAGE_DEFEATED_WARLORD) return;
    if (stage === STAGE_RETURNED_FIRST_ORB) quest.setStage(player, STAGE_DEFEATED_WARLORD);
    giveItem(player, ORBS_OF_PROTECTION_ITEM_ID);
  }

  /**
   * Varbits 598-602 share varp 279: orbs handed in, the three tracker flags and
   * the random ballista x coordinate. Sends stay per-varbit, never the parent.
   */
  function sendProgressVarbits(player) {
    const stage = quest.getStage(player);
    const mask = trackerMask(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_BOLREN_GOT_ORBS, stage >= STAGE_COMPLETE ? 2 : stage >= STAGE_RETURNED_FIRST_ORB ? 1 : 0);
    sender.sendVarbit(VARBIT_GNOMETRACKER_H, mask & 1 ? 1 : 0);
    sender.sendVarbit(VARBIT_GNOMETRACKER_Y, mask & 2 ? 1 : 0);
    sender.sendVarbit(VARBIT_GNOMETRACKER_X, mask & 4 ? 1 : 0);
    sender.sendVarbit(VARBIT_BALLISTA, ballistaCoordinate(player));
  }

  function handleStageChanged({ player, key }) {
    if (key === "tree_gnome_village") sendProgressVarbits(player);
  }

  function handleLogin({ player }) {
    syncWarlord(player);
    refreshQuestList(player);
    sendProgressVarbits(player);
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

  api.persistAttribute(TRACKER_STATE_ATTRIBUTE, 0);
  api.persistAttribute(BALLISTA_COORDINATE_ATTRIBUTE, -1);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("npc-dialogue:line", handleWarlordThreat);
  api.onCustomEvent("npc-dialogue:line", bindCeremonyChorus);
  api.onCustomEvent("player:bootstrap-complete", handleWarlordBootstrap);
  api.onPlayerLogout(handleWarlordLogout);
  api.onPlayerDeath(handleWarlordLogout);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
};
