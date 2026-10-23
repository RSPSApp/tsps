/**
 * Hazeel Cult (members).
 *
 * The words come from the "Hazeel Cult" transcript page. This plugin supplies the
 * variant selector for Ceril, Clivet, Alomone, Butler Jones, the mansion guard,
 * Henryeta and the cultists; the start hook; the side choice; the prose-condition
 * answers; the poison-on-range, evidence cupboard and Alomone death; the sewer
 * valves / raft; the Hazeel-side crate key, secret wall, hidden ladder and scroll
 * chest; and the two completion actions.
 *
 * Stages (varp 223): 2 started, 3 spoke to Clivet, 4 chose a side, 5 poisoned the
 * food, 6 finished the side task, 7 returned the armour / found the scroll,
 * 9 complete (the cache DB row's completion threshold). The chosen side is kept
 * in a player attribute (0 Carnillean, 1 Hazeel); the wiki's 225 varp is not read
 * by this runtime.
 */
module.exports = function registerHazeelCultQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, CountdownTask, TaskManager } = api.core;
  const { registerQuest, refreshQuestList, QUEST_POINTS_ATTRIBUTE } = require("../QuestRuntime");

  const CERIL_IDS = new Set([NpcIdentifiers.CERIL_CARNILLEAN]);
  const CLIVET_IDS = new Set([NpcIdentifiers.CLIVET, NpcIdentifiers.CLIVET_2]);
  const ALOMONE_IDS = new Set([
    NpcIdentifiers.ALOMONE,
    NpcIdentifiers.ALOMONE_2,
    NpcIdentifiers.ALOMONE_3,
  ]);
  const JONES_IDS = new Set([NpcIdentifiers.BUTLER_JONES]);
  const GUARD_IDS = new Set([
    NpcIdentifiers.GUARD_180,
    NpcIdentifiers.GUARD_181,
    NpcIdentifiers.GUARD_182,
  ]);
  // 1202 is the id the world spawn actually uses; 12101 is the post-quest variant.
  const HENRYETA_IDS = new Set([NpcIdentifiers.HENRYETA_CARNILLEAN, NpcIdentifiers.HENRYETA_CARNILLEAN_2]);
  const CULTIST_IDS = new Set([
    NpcIdentifiers.HAZEEL_CULTIST,
    NpcIdentifiers.HAZEEL_CULTIST_2,
    NpcIdentifiers.HAZEEL_CULTIST_3,
    NpcIdentifiers.HAZEEL_CULTIST_4,
    NpcIdentifiers.HAZEEL_CULTIST_5,
  ]);

  const POISON_RANGE_ID = ObjectIdentifiers.RANGE;
  const EVIDENCE_CUPBOARD_IDS = [ObjectIdentifiers.CUPBOARD_22, ObjectIdentifiers.CUPBOARD_23];
  const VALVE_IDS = [
    ObjectIdentifiers.SEWER_VALVE,
    ObjectIdentifiers.SEWER_VALVE_2,
    ObjectIdentifiers.SEWER_VALVE_3,
    ObjectIdentifiers.SEWER_VALVE_4,
    ObjectIdentifiers.SEWER_VALVE_5,
  ];
  const RAFT_ID = ObjectIdentifiers.RAFT;
  const CAVE_ENTRANCE_ID = ObjectIdentifiers.CAVE_ENTRANCE_14; // 2852
  const SEWER_STAIRS_ID = ObjectIdentifiers.STAIRS_14; // 2853
  const MANSION_BASEMENT_LADDER_ID = ObjectIdentifiers.LADDER_428; // 46717
  const BASEMENT_LADDER_ID = ObjectIdentifiers.LADDER_427; // 46716
  const HIDEOUT_CHEST_ID = ObjectIdentifiers.CHEST_178; // 46713
  const MANSION_STAIRS_UP_ID = ObjectIdentifiers.STAIRCASE_203; // 46704
  const MANSION_STAIRS_DOWN_ID = ObjectIdentifiers.STAIRCASE_204; // 46705
  const CRATE_ID = ObjectIdentifiers.CRATE_21; // 2858
  // These four ids have no ObjectIdentifier constants in this cache dump. The
  // transform parents are what the map actually places; 46902 resolves to the
  // Knock-at wall 46707 and 46903 resolves to the Search chest 46710.
  const SECRET_WALL_IDS = new Set([46707, 46902]);
  const SCROLL_CHEST_IDS = new Set([46710, 46712, 46903]);
  const HIDDEN_LADDER_UP_ID = 16683;
  const HIDDEN_LADDER_DOWN_ID = 16679;
  const HIDDEN_LADDER_TILE = { x: 2573, y: 3271, z: 1 };
  const HIDDEN_ROOM_TILE = { x: 2572, y: 3271, z: 1 };
  const HIDDEN_ROOM_EXIT_TILE = { x: 2571, y: 3270, z: 1 };
  const HIDDEN_LADDER_TOP_TILE = { x: 2573, y: 3271, z: 2 };
  const HIDEOUT_TILE = { x: 2606, y: 9692, z: 0 };
  const HIDEOUT_RAFT_TILE = { x: 2606, y: 9693, z: 0 };
  const RAFT_RETURN_TILE = { x: 2568, y: 9681, z: 0 };
  // Capture 1694 tick [6564]: cave 2852 lands beside the raft at (2570,9682),
  // not the disconnected Clock Tower landing (2584,9633).
  const SEWER_LANDING = { x: 2570, y: 9682, z: 0 };
  const SEWER_STAIRS_SURFACE = { x: 2570, y: 3283, z: 0 };
  const MANSION_BASEMENT = { x: 2544, y: 9695, z: 0 };
  const MANSION_FROM_BASEMENT = { x: 2570, y: 3268, z: 0 };

  // Both staircase objects sit in collision, so neither is reached by a plain
  // click. The up route walks to the walkable tile south of the ground-floor base
  // (2568,3271) and climbs to the first-floor landing east of the top (2570,3268),
  // from which the corridor through door 1540 reaches the cupboard at (2573,3267).
  // Climbing down mirrors it.
  const STAIRS_UP_FROM = { x: 2568, y: 3271, z: 0 };
  const STAIRS_UP_TO = { x: 2570, y: 3268, z: 1 };
  const STAIRS_DOWN_FROM = { x: 2570, y: 3268, z: 1 };
  const STAIRS_DOWN_TO = { x: 2568, y: 3271, z: 0 };

  // The world's npc-spawns.json still points the mansion/cave tiles at ids that
  // the cache now resolves to nameless or wrong NPCs; these correct-id spawns
  // are owner-only, so they replace those for the questing player.
  const CERIL_TILE = { x: 2565, y: 3271, z: 0 };
  const JONES_TILE = { x: 2569, y: 3272, z: 0 };
  const CLIVET_TILE = { x: 2566, y: 9683, z: 0 };
  const ALOMONE_TILE = { x: 2609, y: 9670, z: 0 };
  const MANSION_ZONE = { minX: 2555, maxX: 2585, minY: 3258, maxY: 3285, levels: [0, 1] };
  const SEWER_ZONE = { minX: 2540, maxX: 2630, minY: 9615, maxY: 9725, levels: [0] };
  const npcsByPlayer = new Map();

  // The fake "reward" shown when the armour is handed in: same scroll, no point.
  const PARTIAL_SCROLL_MESSAGE_ID = "o-fWjz";
  const PARTIAL_SCROLL_REWARD = 5;
  const COMPLETED_GROUP = 153;
  const COMPLETED_TITLE_CHILD = 3;
  const COMPLETED_NAME_CHILD = 4;
  const COMPLETED_REWARD_ITEM_CHILD = 5;
  const COMPLETED_POINTS_CHILD = 6;
  const COMPLETED_FIRST_LINE_CHILD = 8;
  const COMPLETED_LINE_COUNT = 8;
  const COMPLETED_CLOSE_CHILD = 16;

  const VARP_HAZEEL_CULT = 223;
  const SIDE_CARNILLEAN = 0;
  const SIDE_HAZEEL = 1;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_SPOKEN_TO_CLIVET = 3;
  const STAGE_CHOSEN_SIDE = 4;
  const STAGE_POISONED_FOOD = 5;
  const STAGE_FINISHED_SIDE_TASK = 6;
  const STAGE_RETURNED_ARMOUR = 7;
  const STAGE_COMPLETE = 9;

  const SIDE_ATTR = "quest.hazeel_cult.side";
  const VALVES_ATTR = "quest.hazeel_cult.valves";

  const POISON = ItemIdentifiers.POISON;
  const ARMOUR = ItemIdentifiers.CARNILLEAN_ARMOUR;
  const HAZEEL_SCROLL = ItemIdentifiers.HAZEEL_SCROLL;
  const CHEST_KEY = ItemIdentifiers.CHEST_KEY_3;
  const HAZEEL_MARK = ItemIdentifiers.HAZEELS_MARK;
  const COINS = ItemIdentifiers.COINS;

  // Transcript message ids whose canonical effect is handing the player an item.
  const MESSAGE_ITEMS = new Map([
    ["dWE8Mb", POISON], ["PNetGb", POISON], ["wpWRaW", POISON],
    ["6FjnaM", HAZEEL_MARK], ["OreiUm", HAZEEL_MARK], ["DHANak", HAZEEL_MARK], ["H1owA_", HAZEEL_MARK],
    ["k4IIqS", CHEST_KEY],
    ["4avyol", HAZEEL_SCROLL],
  ]);

  const START_HOOK = "quest:hazeel-cult:start";
  const CARNILLEAN_COMPLETE_ACTION = "LtuQhV";
  const HAZEEL_COMPLETE_ACTION = "O8EM1e";

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const side = (player) => attr(player, SIDE_ATTR);
  function answerPublicSideQuery(request) {
    if (request?.player) request.side = side(request.player);
  }
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const actionOf = (event) =>
    String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I uncovered the plot surrounding the Carnillean family.</str>",
        side(player) === SIDE_HAZEEL
          ? "<str>I helped the cult resurrect Lord Hazeel.</str>"
          : "<str>I stopped the cult and exposed Butler Jones.</str>",
        "<col=ff0000>Quest complete!",
      ];
    }
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to",
        "<col=800000>Ceril Carnillean<col=000080> south-west of Ardougne.",
      ];
    }
    const lines = ["<str>Ceril asked me to recover his stolen family armour.</str>"];
    if (stage < STAGE_SPOKEN_TO_CLIVET) {
      lines.push("I should investigate the cave near the Clock Tower.");
      return lines;
    }
    lines.push("<str>Clivet told me the cult's version of the mansion's history.</str>");
    if (stage < STAGE_CHOSEN_SIDE) {
      lines.push("I must decide whether to help the Carnilleans or the cult.");
      return lines;
    }
    if (side(player) === SIDE_HAZEEL) {
      if (stage < STAGE_POISONED_FOOD) lines.push("I must pour Clivet's poison into the mansion's range.");
      else if (stage < STAGE_FINISHED_SIDE_TASK) lines.push("I should return to Clivet, then meet Alomone in the hideout.");
      else if (stage < STAGE_RETURNED_ARMOUR) lines.push("I must find the Hazeel scroll hidden inside the mansion.");
      else lines.push("I should take the Hazeel scroll to Alomone.");
    } else if (stage < STAGE_FINISHED_SIDE_TASK) {
      lines.push("I must defeat Alomone and recover the Carnillean armour.");
    } else if (stage < STAGE_RETURNED_ARMOUR) {
      lines.push("I should return the Carnillean armour to Ceril.");
    } else {
      lines.push("Jones escaped Ceril's suspicion. I need evidence from the upstairs cupboard.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1500);
    give(player, COINS, 2000);
  }

  function cerilVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED) return "starting-off";
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Ceril Carnillean", variant: "after-hazeel-cult-sided-with-hazeel" };
      }
      if (stage >= STAGE_RETURNED_ARMOUR) return "the-scroll-talking-to-ceril";
      if (stage >= STAGE_POISONED_FOOD) return "joining-the-hazeel-side-talking-to-ceril-after-the-poisoning";
      return "joining-the-hazeel-side-talking-to-ceril";
    }
    if (stage >= STAGE_COMPLETE) return "after-quest-completion-talking-to-ceril";
    if (stage === STAGE_FINISHED_SIDE_TASK && has(player, ARMOUR)) {
      take(player, ARMOUR);
      give(player, COINS, 5);
      quest.setStage(player, STAGE_RETURNED_ARMOUR);
      return "joining-the-carnillean-side-returning-the-armour";
    }
    if (stage >= STAGE_FINISHED_SIDE_TASK) {
      return "joining-the-carnillean-side-returning-the-armour-talking-to-cecil";
    }
    return "starting-off-talking-to-ceril-again";
  }

  function clivetVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_SPOKEN_TO_CLIVET);
      return "confronting-the-hazeel-cult";
    }
    if (stage === STAGE_SPOKEN_TO_CLIVET) {
      return "confronting-the-hazeel-cult-talking-to-clivet-again-before-joining";
    }
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Clivet", variant: "after-hazeel-cult-sided-with-hazeel" };
      }
      if (stage >= STAGE_RETURNED_ARMOUR) return "the-scroll-talking-to-clivet-again";
      if (stage >= STAGE_POISONED_FOOD) return "the-scroll-talking-to-clivet";
      return "joining-the-hazeel-side-talking-to-clivet-again";
    }
    return "joining-the-carnillean-side-talking-to-clivet";
  }

  function alomoneVariant(player) {
    const stage = quest.getStage(player);
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_RETURNED_ARMOUR) return "the-scroll-talking-to-alomone-after-obtaining-the-scroll";
      if (stage >= STAGE_FINISHED_SIDE_TASK) return "the-scroll-talking-to-alomone-again";
      if (stage >= STAGE_CHOSEN_SIDE) {
        quest.setStage(player, STAGE_FINISHED_SIDE_TASK);
        return "the-scroll-talking-to-alomone";
      }
      return null;
    }
    if (stage >= STAGE_FINISHED_SIDE_TASK) return "joining-the-carnillean-side-if-alomone-is-alive";
    if (stage >= STAGE_CHOSEN_SIDE) return "joining-the-carnillean-side-talking-to-alomone";
    return null;
  }

  function jonesVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage === STAGE_STARTED) return "starting-off-talking-to-butler-jones";
    if (side(player) === SIDE_HAZEEL) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_RETURNED_ARMOUR) {
        return has(player, HAZEEL_SCROLL)
          ? "the-scroll-talking-to-jones-after-obtaining-the-scroll"
          : "the-scroll-talking-to-butler-jones";
      }
      if (stage >= STAGE_POISONED_FOOD) return "joining-the-hazeel-side-talking-to-butler-jones-after-the-poisoning";
      return "joining-the-hazeel-side-talking-to-butler-jones";
    }
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_FINISHED_SIDE_TASK) {
      return "joining-the-carnillean-side-returning-the-armour-talking-to-butler-jones";
    }
    return "joining-the-carnillean-side-talking-to-butler-jones";
  }

  function selectVariant({ npcId, player }) {
    if (CERIL_IDS.has(npcId)) return cerilVariant(player);
    if (CLIVET_IDS.has(npcId)) return clivetVariant(player);
    if (ALOMONE_IDS.has(npcId)) return alomoneVariant(player);
    if (JONES_IDS.has(npcId)) return jonesVariant(player);
    const stage = quest.getStage(player);
    if (GUARD_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return "starting-off-talking-to-the-guard";
      if (stage >= STAGE_COMPLETE) {
        return side(player) === SIDE_HAZEEL
          ? { page: "Guard (Carnillean)", variant: "after-hazeel-cult-sided-with-hazeel" }
          : "after-quest-completion-talking-to-guard";
      }
      if (side(player) === SIDE_HAZEEL) return "joining-the-hazeel-side-talking-to-the-guard";
      return "starting-off-talking-to-the-guard";
    }
    if (HENRYETA_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return "starting-off-talking-to-henryeta";
      if (stage >= STAGE_COMPLETE) {
        return side(player) === SIDE_HAZEEL
          ? { page: "Henryeta Carnillean", variant: "after-hazeel-cult-sided-with-hazeel" }
          : "after-quest-completion-talking-to-henryeta";
      }
      if (side(player) === SIDE_HAZEEL) return "joining-the-hazeel-side-talking-to-henryeta";
      return "joining-the-carnillean-side-returning-the-armour-talking-to-henryeta";
    }
    if (CULTIST_IDS.has(npcId)) {
      if (stage < STAGE_CHOSEN_SIDE) return null;
      return side(player) === SIDE_HAZEEL
        ? "the-scroll-talking-to-a-hazeel-cultist"
        : "joining-the-carnillean-side-talking-to-hazeel-cultist";
    }
    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (![CERIL_IDS, CLIVET_IDS, ALOMONE_IDS, JONES_IDS, GUARD_IDS, HENRYETA_IDS, CULTIST_IDS].some(ids => ids.has(npcId))) return null;
    const value = String(text).toLowerCase();
    const full = player.getInventory().isFull?.() === true;
    if (value.includes("below level 10 combat")) {
      return (player.getSkillManager?.().getCombatLevel?.() ?? 0) < 10;
    }
    if (value.includes("full inventory")) return full;
    if (value.includes("inventory space") || value.includes("enough space") || value.includes("enough room")) return !full;
    if (value.includes("does not have the scroll") || value.includes("without the scroll")) return !has(player, HAZEEL_SCROLL);
    if (value.includes("has the scroll")) return has(player, HAZEEL_SCROLL);
    if (value.includes("does not have the amulet") || value.includes("lost that amulet") || value.includes("does not have hazeel's mark")) {
      return !has(player, HAZEEL_MARK);
    }
    if (value.includes("has poison")) return has(player, POISON);
    if (value.includes("no poison")) return !has(player, POISON);
    return null;
  }

  /** The Hazeel-side choice carries no hook; set the side from the words. */
  function handleChoice({ player, npcId, option }) {
    if (!CLIVET_IDS.has(npcId)) return;
    if (quest.getStage(player) > STAGE_CHOSEN_SIDE) return;
    const text = String(option ?? "").toLowerCase();
    if (text.includes("i'll help you") || text.includes("i will help") || text.includes("i'll help the cult")) {
      setAttr(player, SIDE_ATTR, SIDE_HAZEEL);
      quest.setStage(player, STAGE_CHOSEN_SIDE);
    } else if (text.includes("won't help you") || text.includes("i will stop you") || text.includes("i won't help")) {
      setAttr(player, SIDE_ATTR, SIDE_CARNILLEAN);
      quest.setStage(player, STAGE_CHOSEN_SIDE);
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!CERIL_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      setAttr(player, SIDE_ATTR, SIDE_CARNILLEAN);
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleAction({ player, npcId, stepId, kind }) {
    if (kind === "message" && MESSAGE_ITEMS.has(stepId)) {
      const itemId = MESSAGE_ITEMS.get(stepId);
      if (!has(player, itemId) && player.getInventory().isFull?.() !== true) {
        give(player, itemId);
        if (itemId === HAZEEL_SCROLL && side(player) === SIDE_HAZEEL
          && !quest.isComplete(player) && quest.getStage(player) < STAGE_RETURNED_ARMOUR) {
          quest.setStage(player, STAGE_RETURNED_ARMOUR);
        }
      }
      return;
    }
    if (stepId === "w_5wEv") {
      if (side(player) === SIDE_HAZEEL && quest.getStage(player) >= STAGE_FINISHED_SIDE_TASK) {
        player.moveTo(new Location(HIDDEN_ROOM_TILE.x, HIDDEN_ROOM_TILE.y, HIDDEN_ROOM_TILE.z));
        player.sendMessage("You push against the wall and slip into the hidden room.");
      }
      return;
    }
    if (quest.isComplete(player)) return;
    if (stepId === PARTIAL_SCROLL_MESSAGE_ID && kind === "message" && CERIL_IDS.has(npcId)) {
      showPartialCompletionScroll(player);
      return;
    }
    if (stepId === CARNILLEAN_COMPLETE_ACTION && CERIL_IDS.has(npcId) && side(player) === SIDE_CARNILLEAN) {
      completeQuest(player);
      return;
    }
    if (stepId === HAZEEL_COMPLETE_ACTION && ALOMONE_IDS.has(npcId)
      && side(player) === SIDE_HAZEEL && has(player, HAZEEL_SCROLL)) {
      take(player, HAZEEL_SCROLL);
      completeQuest(player);
    }
  }

  /** Pouring the poison into the mansion range advances the Hazeel side. */
  function handlePoisonRange(event) {
    if (event.objectId !== POISON_RANGE_ID || event.itemId !== POISON) return;
    const { player } = event;
    if (side(player) !== SIDE_HAZEEL || quest.getStage(player) !== STAGE_CHOSEN_SIDE) {
      player.sendMessage("You decide not to put poison in the food.");
      event.handled = true;
      return;
    }
    take(player, POISON);
    quest.setStage(player, STAGE_POISONED_FOOD);
    player.sendMessage("You pour the poison into the bubbling food.");
    event.handled = true;
  }

  /** Searching the cupboard after returning the armour exposes Jones. */
  function handleEvidenceCupboard(event) {
    if (!EVIDENCE_CUPBOARD_IDS.includes(event.objectId)) return;
    const { player } = event;
    event.handled = true;
    if (side(player) === SIDE_HAZEEL || quest.getStage(player) !== STAGE_RETURNED_ARMOUR) {
      player.sendMessage("You search the cupboard but find nothing of interest.");
      return;
    }
    const { startTranscript } = require("../QuestRuntime");
    startTranscript(api, player, NpcIdentifiers.CERIL_CARNILLEAN, "Hazeel Cult",
      "joining-the-carnillean-side-accusing-the-butler");
  }

  /** Crate in the mansion kitchen: the Hazeel-side chest key. */
  function handleCrate(event) {
    if (event.objectId !== CRATE_ID) return;
    if (!actionOf(event).includes("search")) return;
    event.handled = true;
    const { player } = event;
    if (side(player) !== SIDE_HAZEEL || quest.getStage(player) < STAGE_FINISHED_SIDE_TASK
      || quest.isComplete(player) || has(player, CHEST_KEY)) {
      player.sendMessage("You search the crate but find nothing of interest.");
      return;
    }
    if (player.getInventory().isFull?.() === true) {
      player.sendMessage("You search the crate and find an old key hidden at the bottom, but you don't have enough room to take it.");
      return;
    }
    give(player, CHEST_KEY);
    player.sendMessage("You search the crate and find an old key hidden at the bottom.");
  }

  /** Hidden wall on the first floor; knocking opens the ladder room. */
  function handleSecretWall(event) {
    if (!SECRET_WALL_IDS.has(event.objectId)) return;
    if (!actionOf(event).includes("knock")) return;
    const { player } = event;
    event.handled = true;
    if (side(player) !== SIDE_HAZEEL || quest.getStage(player) < STAGE_FINISHED_SIDE_TASK
      || quest.isComplete(player)) {
      player.sendMessage("You knock on the wall but hear nothing unusual.");
      return;
    }
    const location = player.getLocation();
    const inHiddenRoom = location.getZ() === 1
      && Math.abs(location.getX() - HIDDEN_ROOM_TILE.x) <= 1
      && Math.abs(location.getY() - HIDDEN_ROOM_TILE.y) <= 1;
    if (inHiddenRoom) {
      player.moveTo(new Location(HIDDEN_ROOM_EXIT_TILE.x, HIDDEN_ROOM_EXIT_TILE.y, HIDDEN_ROOM_EXIT_TILE.z));
      player.sendMessage("You push the wall aside and step back into the corridor.");
      return;
    }
    const { startTranscript } = require("../QuestRuntime");
    startTranscript(api, player, NpcIdentifiers.CERIL_CARNILLEAN, "Hazeel Cult",
      "the-scroll-using-the-knock-at-wall");
  }

  /** Chest in the hidden room: the Hazeel scroll, opened with the crate key. */
  function handleScrollChest(event) {
    if (!SCROLL_CHEST_IDS.has(event.objectId)) return;
    if (event.itemId !== undefined && event.itemId !== CHEST_KEY) return;
    const option = actionOf(event);
    if (event.itemId === undefined && !option.includes("search") && !option.includes("open")) return;
    event.handled = true;
    const { player } = event;
    if (side(player) !== SIDE_HAZEEL || quest.getStage(player) < STAGE_FINISHED_SIDE_TASK
      || quest.isComplete(player)) {
      player.sendMessage("You search the chest but find nothing.");
      return;
    }
    if (has(player, HAZEEL_SCROLL)) {
      player.sendMessage("You already have the scroll from this chest.");
      return;
    }
    if (!has(player, CHEST_KEY)) {
      player.sendMessage("The chest is locked. It looks like it needs a key.");
      return;
    }
    if (player.getInventory().isFull?.() === true) {
      player.sendMessage("You unlock the chest and find a scroll inside, but you don't have enough room to take it.");
      return;
    }
    give(player, HAZEEL_SCROLL);
    quest.setStage(player, STAGE_RETURNED_ARMOUR);
    player.sendMessage("You unlock the chest and find a scroll inside.");
  }

  /** Defeating Alomone on the Carnillean side recovers the family armour. */
  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    const { npcId } = event;
    if (!player || !ALOMONE_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (side(player) !== SIDE_CARNILLEAN || stage < STAGE_CHOSEN_SIDE || stage >= STAGE_FINISHED_SIDE_TASK) return;
    quest.setStage(player, STAGE_FINISHED_SIDE_TASK);
    player.sendMessage("Alomone falls. The Carnillean armour is now unguarded.");
  }

  /**
   * When Alomone's last line lands he turns into the attackable variant. There is
   * no transcript action to hang this off, so watch the line itself.
   */
  function handleAlomoneLine(request) {
    const { npc, npcId, text } = request;
    if (npcId !== NpcIdentifiers.ALOMONE || !npc?.setNpcTransformationId) return;
    if (!String(text ?? "").toLowerCase().includes("live long enough")) return;
    npc.setNpcTransformationId(NpcIdentifiers.ALOMONE_2);
  }

  /** Cave entrance, sewer stairs and the mansion basement ladder travel. */
  function handleTravel(event) {
    const option = actionOf(event);
    const { player } = event;
    const objectPoint = event.object?.getLocation?.() ?? event.location;
    const objectTile = objectPoint
      ? (typeof objectPoint.getX === "function"
        ? { x: objectPoint.getX(), y: objectPoint.getY(), z: objectPoint.getZ() }
        : objectPoint)
      : null;
    const atHiddenLadder = objectTile
      && objectTile.x === HIDDEN_LADDER_TILE.x
      && objectTile.y === HIDDEN_LADDER_TILE.y;
    const atHiddenLadderBottom = atHiddenLadder && (objectTile.z ?? 0) === HIDDEN_LADDER_TILE.z;
    const atHiddenLadderTop = atHiddenLadder && (objectTile.z ?? 0) === HIDDEN_LADDER_TOP_TILE.z;
    const hazeelHiddenRoom = side(player) === SIDE_HAZEEL
      && quest.getStage(player) >= STAGE_FINISHED_SIDE_TASK;
    if (event.objectId === CAVE_ENTRANCE_ID && option.includes("enter")) {
      player.moveTo(new Location(SEWER_LANDING.x, SEWER_LANDING.y, SEWER_LANDING.z));
      player.sendMessage("You climb down into the Ardougne sewers.");
    } else if (event.objectId === SEWER_STAIRS_ID && option.includes("climb-up")) {
      player.moveTo(new Location(SEWER_STAIRS_SURFACE.x, SEWER_STAIRS_SURFACE.y, SEWER_STAIRS_SURFACE.z));
      player.sendMessage("You climb up the stairs to the surface.");
    } else if (event.objectId === MANSION_BASEMENT_LADDER_ID && option.includes("climb-down")) {
      player.moveTo(new Location(MANSION_BASEMENT.x, MANSION_BASEMENT.y, MANSION_BASEMENT.z));
      player.sendMessage("You climb down into the mansion basement.");
    } else if (event.objectId === BASEMENT_LADDER_ID && option.includes("climb-up")) {
      player.moveTo(new Location(MANSION_FROM_BASEMENT.x, MANSION_FROM_BASEMENT.y, MANSION_FROM_BASEMENT.z));
      player.sendMessage("You climb up into the mansion.");
    } else if (event.objectId === MANSION_STAIRS_UP_ID && option.includes("climb-up")) {
      player.moveTo(new Location(STAIRS_UP_TO.x, STAIRS_UP_TO.y, STAIRS_UP_TO.z));
      player.sendMessage("You climb the stairs to the first floor.");
    } else if (event.objectId === MANSION_STAIRS_DOWN_ID && option.includes("climb-down")) {
      player.moveTo(new Location(STAIRS_DOWN_TO.x, STAIRS_DOWN_TO.y, STAIRS_DOWN_TO.z));
      player.sendMessage("You climb down the stairs.");
    } else if (event.objectId === HIDDEN_LADDER_UP_ID && option.includes("climb-up")
      && atHiddenLadderBottom && hazeelHiddenRoom) {
      player.moveTo(new Location(HIDDEN_LADDER_TOP_TILE.x, HIDDEN_LADDER_TOP_TILE.y, HIDDEN_LADDER_TOP_TILE.z));
      player.sendMessage("You climb up into the hidden room.");
    } else if (event.objectId === HIDDEN_LADDER_DOWN_ID && option.includes("climb-down")
      && atHiddenLadderTop && hazeelHiddenRoom) {
      player.moveTo(new Location(HIDDEN_LADDER_TILE.x, HIDDEN_LADDER_TILE.y, HIDDEN_LADDER_TILE.z));
      player.sendMessage("You climb down the ladder.");
    } else {
      return;
    }
    event.handled = true;
  }

  /**
   * The staircase tiles are blocked from every side (accessMask 27/30), so a plain
   * object click cannot route to them. Route to a walkable neighbour first; the
   * interaction then fires there and the ladders:climb claim below moves the player.
   */
  function routeMansionStairs(event) {
    const location = event.player.getLocation();
    if (event.objectId === MANSION_STAIRS_UP_ID && location.getZ() === 0) {
      event.destination = { ...STAIRS_UP_FROM };
    } else if (event.objectId === MANSION_STAIRS_DOWN_ID && location.getZ() === 1) {
      event.destination = { ...STAIRS_DOWN_FROM };
    }
  }

  /** Claims the mansion staircase click before Ladders' generic fallback guesses a landing. */
  function claimMansionStairs(request) {
    const location = request.player.getLocation();
    if (request.objectId === MANSION_STAIRS_UP_ID && location.getZ() === 0) {
      request.player.moveTo(new Location(STAIRS_UP_TO.x, STAIRS_UP_TO.y, STAIRS_UP_TO.z));
      request.handled = true;
    } else if (request.objectId === MANSION_STAIRS_DOWN_ID && location.getZ() === 1) {
      request.player.moveTo(new Location(STAIRS_DOWN_TO.x, STAIRS_DOWN_TO.y, STAIRS_DOWN_TO.z));
      request.handled = true;
    }
  }

  /**
   * The basement ladder is also a blocked-click loc. Capture 1694 tick [6698]
   * shows a plain Climb-down from (2569,3271) through (2570,3268) to the
   * basement; Ladders would otherwise guess a surface landing and preempt
   * handleTravel. Claim only the two mansion tiles.
   */
  function claimMansionBasementLadder(request) {
    if (request.handled) return;
    const { player, objectId, object } = request;
    const location = object?.getLocation?.();
    if (!player || !location) return;
    if (objectId === MANSION_BASEMENT_LADDER_ID
      && location.getX() === 2570 && location.getY() === 3267 && location.getZ() === 0) {
      player.moveTo(new Location(MANSION_BASEMENT.x, MANSION_BASEMENT.y, MANSION_BASEMENT.z));
      request.handled = true;
    } else if (objectId === BASEMENT_LADDER_ID
      && location.getX() === 2544 && location.getY() === 9694 && location.getZ() === 0) {
      player.moveTo(new Location(MANSION_FROM_BASEMENT.x, MANSION_FROM_BASEMENT.y, MANSION_FROM_BASEMENT.z));
      request.handled = true;
    }
  }

  /** Looting the hideout chest after Alomone's death recovers the family armour. */
  function handleHideoutChest(event) {
    if (event.objectId !== HIDEOUT_CHEST_ID) return;
    const option = actionOf(event);
    if (!option.includes("search") && !option.includes("open")) return;
    event.handled = true;
    const { player } = event;
    if (
      side(player) !== SIDE_CARNILLEAN ||
      quest.getStage(player) < STAGE_FINISHED_SIDE_TASK ||
      quest.isComplete(player) ||
      has(player, ARMOUR)
    ) {
      player.sendMessage("You search the chest but find nothing.");
      return;
    }
    if (player.getInventory().isFull?.() === true) {
      player.sendMessage("You search the chest and find some armour, but you don't have enough room to take it.");
      return;
    }
    give(player, ARMOUR);
    player.sendMessage("Inside the chest you find the Carnillean family armour.");
  }

  function handleValve(event) {
    const index = VALVE_IDS.indexOf(event.objectId);
    if (index === -1) return;
    const { player } = event;
    const value = attr(player, VALVES_ATTR) ^ (1 << index);
    setAttr(player, VALVES_ATTR, value);
    player.sendMessage("Beneath your feet you hear the sudden sound of rushing water.");
    event.handled = true;
  }

  function handleRaft(event) {
    if (event.objectId !== RAFT_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_CHOSEN_SIDE) {
      player.sendMessage("Clivet stops you from using the raft.");
      event.handled = true;
      return;
    }
    const value = attr(player, VALVES_ATTR);
    let correct = 0;
    while (correct < 5 && (value & (1 << correct)) !== 0) correct++;
    if (correct < 5) {
      player.sendMessage("The current is flowing against the raft. It will not move.");
      event.handled = true;
      return;
    }
    const location = player.getLocation();
    const atHideout =
      Math.max(
        Math.abs(location.getX() - HIDEOUT_RAFT_TILE.x),
        Math.abs(location.getY() - HIDEOUT_RAFT_TILE.y)
      ) <= 2;
    const destination = atHideout ? RAFT_RETURN_TILE : HIDEOUT_TILE;
    player.moveTo(new Location(destination.x, destination.y, destination.z));
    player.sendMessage("The raft carries you past the islands to the end of the sewer passage.");
    event.handled = true;
  }

  /**
   * Spawns one owner-only NPC per key for the player, if that key is not already tracked.
   * The world's own stale-id spawns stay put; these are what the player interacts with.
   */
  function spawnTracked(player, key, id, tile) {
    const entry = npcsByPlayer.get(player) ?? {};
    if (!entry[key]) {
      const npc = api.spawnNpc({ ...tile, id, owner: player, ownerOnly: true, wanderRadius: 0 });
      if (npc) entry[key] = npc;
    }
    npcsByPlayer.set(player, entry);
  }

  /** Correct-id quest NPCs for this player. Alomone is gone once killed/completed. */
  function ensureQuestNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    spawnTracked(player, "ceril", NpcIdentifiers.CERIL_CARNILLEAN, CERIL_TILE);
    spawnTracked(player, "clivet", NpcIdentifiers.CLIVET, CLIVET_TILE);
    if (quest.isComplete(player)) return;
    spawnTracked(player, "jones", NpcIdentifiers.BUTLER_JONES, JONES_TILE);
    const alomoneDead =
      side(player) === SIDE_CARNILLEAN && quest.getStage(player) >= STAGE_FINISHED_SIDE_TASK;
    if (!alomoneDead) spawnTracked(player, "alomone", NpcIdentifiers.ALOMONE, ALOMONE_TILE);
  }

  function clearNpcs(player) {
    const entry = npcsByPlayer.get(player);
    if (!entry) return;
    for (const npc of Object.values(entry)) api.removeNpc(npc);
    npcsByPlayer.delete(player);
  }

  /** Completion drops the quest-state spawns (Jones, Alomone); Ceril and Clivet persist. */
  function completeQuest(player) {
    if (!quest.complete(player)) return;
    clearNpcs(player);
    ensureQuestNpcs(player);
  }

  /** Fills the wiki transcript's "[player name]" blank in Ceril's start. */
  function fillPlayerName(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!CERIL_IDS.has(request.npcId)) return;
    if (!request.text.includes("[player name]")) return;
    request.text = request.text.replace(/\[player name\]/gi, request.player.getUsername());
  }

  /** The armour hand-in's fake reward scroll (5 coins, no quest point), per the wiki. */
  function openPartialCompletionScroll(player) {
    const packet = player.getPacketSender();
    const updater = player.getFrameUpdater?.();
    const setText = (uid, text) => {
      updater?.clear?.(uid);
      packet.sendString(String(text ?? ""), uid);
    };
    packet.sendInterfaceRemoval();
    packet.sendInterface(COMPLETED_GROUP);
    packet.sendInterfaceFlagsRange((COMPLETED_GROUP << 16) | COMPLETED_CLOSE_CHILD, -1, -1, 1 << 1);
    setText((COMPLETED_GROUP << 16) | COMPLETED_TITLE_CHILD, "Congratulations!");
    setText((COMPLETED_GROUP << 16) | COMPLETED_NAME_CHILD, "You have... kind of... completed Hazeel Cult!");
    packet.sendItemOnInterfaces((COMPLETED_GROUP << 16) | COMPLETED_REWARD_ITEM_CHILD, COINS, PARTIAL_SCROLL_REWARD);
    const points = Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0;
    setText((COMPLETED_GROUP << 16) | COMPLETED_POINTS_CHILD, `Total Quest Points: ${points}`);
    const lines = ["You are awarded:", `${PARTIAL_SCROLL_REWARD} Coins`];
    for (let i = 0; i < COMPLETED_LINE_COUNT; i++) {
      setText((COMPLETED_GROUP << 16) | (COMPLETED_FIRST_LINE_CHILD + i), lines[i] ?? "");
    }
  }

  /** The hand-in dialogue closes right after its last message, so open the scroll a tick later. */
  function showPartialCompletionScroll(player) {
    if (player.isRegistered?.() === false) return;
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (player.getDialogueManager?.()?.isActive?.() === true) {
          showPartialCompletionScroll(player);
          return;
        }
        openPartialCompletionScroll(player);
      })
    );
  }

  function handleLogin({ player }) {
    ensureQuestNpcs(player);
    refreshQuestList(player);
  }

  function handleZoneEnter({ player }) {
    ensureQuestNpcs(player);
  }

  function handleLogout({ player }) {
    if (player) clearNpcs(player);
  }

  quest = registerQuest(api, {
    key: "hazeel_cult",
    name: "Hazeel Cult",
    varpId: VARP_HAZEEL_CULT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1500, label: "Thieving" }],
    scrollItemId: COINS,
    rewardItemLabel: "2,000 coins",
    otherRewards: ["A permanent choice between the Carnillean family and the Cult of Hazeel"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(SIDE_ATTR);
  api.persistAttribute(VALVES_ATTR);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleAlomoneLine);
  api.onCustomEvent("npc-dialogue:line", fillPlayerName);
  api.onCustomEvent("hazeel-cult:get-side", answerPublicSideQuery);
  api.onCustomEvent("ladders:climb", claimMansionStairs);
  api.onCustomEvent("ladders:climb", claimMansionBasementLadder);
  api.onItemOnObject(handlePoisonRange, { noted: false });
  api.onItemOnObject(handleScrollChest, { noted: false });
  api.onObjectRoute(routeMansionStairs);
  api.onObjectInteraction(handleEvidenceCupboard);
  api.onObjectInteraction(handleCrate);
  api.onObjectInteraction(handleSecretWall);
  api.onObjectInteraction(handleScrollChest);
  api.onObjectInteraction(handleValve);
  api.onObjectInteraction(handleRaft);
  api.onObjectInteraction(handleTravel);
  api.onObjectInteraction(handleHideoutChest);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(MANSION_ZONE, handleZoneEnter);
  api.onZoneEnter(SEWER_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
};
