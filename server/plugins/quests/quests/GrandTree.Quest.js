/**
 * The Grand Tree (members).
 *
 * Words come from the "The Grand Tree" transcript page. The plugin supplies the
 * variant selector for King Narnode Shareen, Hazelmere, Glough, Charlie, the
 * shipyard crew, Anita, Captain Errdo and the cutscene actors, plus the
 * prose-condition answers, the start hook (stage + bark sample + translation
 * book), the stage machine driven by the transcript's actions/messages/lines,
 * the shipyard password check and the object interactions (cupboard, chest,
 * watchtower tree, twig pillars, trapdoor, cave roots and the black demon).
 *
 * Stages (varp 150): 10 started, 20 told Hazelmere, 30 relayed, 40 told Glough,
 * 50 found prisoner, 60 spoke prisoner, 70 found journal, 80 released, 90 lumber
 * order, 100 Charlie clue, 110 invasion plans, 120 twigs, 130 trapdoor, 140 demon
 * defeated, 150 searching Daconia, 160 complete. The varp runs 0..160 in tens.
 * The watchtower trapdoor (2444) is a multi-loc keyed on the same varp, so it
 * only gains its Climb-down option once stage 130 is set.
 */
module.exports = function registerGrandTreeQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
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
  /** Transcript action that hands over Hazelmere's scroll. */
  const HAZELMERE_SCROLL_ACTION_ID = "2lKQYT";
  /** Transcript action that hands over the shipyard foreman's lumber order. */
  const LUMBER_ORDER_ACTION_ID = "TXgXt3";
  /** Transcript action that hands over the four twigs. */
  const TWIGS_ACTION_ID = "QV47Iy";
  const TWIGS_REPLACEMENT_ACTION_ID = "xC2-c6";
  /** Transcript action that hands over Glough's key. */
  const ANITA_KEY_ACTION_ID = "XNT7yS";
  /** Transcript action that hands over a replacement bark sample. */
  const BARK_REPLACEMENT_ACTION_ID = "Sa6sOu";
  /** Transcript message: a replacement bark sample. */
  const BARK_REPLACEMENT_MESSAGE_ID = "g1AfH0";
  /** Transcript message: a replacement translation book. */
  const BOOK_REPLACEMENT_MESSAGE_ID = "4e6OhA";
  /** Transcript message: Hazelmere re-writes the scroll. */
  const SCROLL_REPLACEMENT_MESSAGE_ID = "r6XvDD";
  /** Transcript action: the guards escort the player into Charlie's cell. */
  const ARREST_ACTION_ID = "pkr5F6";
  /** Transcript action: the king releases the player from the cell. */
  const RELEASE_ACTION_ID = "GdAMEV";
  /** Transcript message: the glider flight to Karamja. */
  const GLIDER_FLIGHT_MESSAGE_ID = "ucBYLo";
  /** Transcript actions that end the shipyard password branch. */
  const PASSWORD_CORRECT_ACTION_ID = "CDM9ud";
  const PASSWORD_WRONG_ACTION_ID = "svX7Pp";
  /** Transcript actions that sneak the player back into the stronghold. */
  const FEMI_SNEAK_ACTION_ID = "6QWAFm";
  const FEMI_PAID_SNEAK_ACTION_ID = "Op5eXj";

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
  /** The stronghold pilot who flies the player to the Karamja crash site. */
  const STRONGHOLD_ERRDO_ID = 6091;
  const SHIPYARD_WORKER_ID = NpcIdentifiers.SHIPYARD_WORKER;
  /** The combat variant the wrong-password worker becomes (1430 has no combat). */
  const SHIPYARD_ATTACKER_ID = 5457;

  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const BARK_SAMPLE_ITEM_ID = ItemIdentifiers.BARK_SAMPLE;
  const TRANSLATION_BOOK_ITEM_ID = ItemIdentifiers.TRANSLATION_BOOK;
  const DACONIA_ROCK_ITEM_ID = ItemIdentifiers.DACONIA_ROCK;
  const GLOUGHS_JOURNAL_ITEM_ID = ItemIdentifiers.GLOUGHS_JOURNAL;
  const HAZELMERES_SCROLL_ITEM_ID = ItemIdentifiers.HAZELMERES_SCROLL;
  const LUMBER_ORDER_ITEM_ID = ItemIdentifiers.LUMBER_ORDER;
  const GLOUGHS_KEY_ITEM_ID = ItemIdentifiers.GLOUGHS_KEY;
  const INVASION_PLANS_ITEM_ID = ItemIdentifiers.INVASION_PLANS;
  const TWIG_ITEM_IDS = [
    ItemIdentifiers.TWIGS,
    ItemIdentifiers.TWIGS_2,
    ItemIdentifiers.TWIGS_3,
    ItemIdentifiers.TWIGS_4,
  ];

  // Glough's house, its watchtower and the cave under the stronghold.
  const GLOUGHS_CUPBOARD_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_14, // closed
    ObjectIdentifiers.CUPBOARD_15, // open; QH treats it as an alternate object
  ]);
  const GLOUGHS_CHEST_ID = ObjectIdentifiers.CLOSED_CHEST_9;
  const WATCHTOWER_TREE_ID = ObjectIdentifiers.TREE_13;
  /** Unnamed multi-loc: Open (2446) below stage 130, Climb-down (26243) at 130+. */
  const GLOUGHS_TRAPDOOR_ID = 2444;
  const ROOT_IDS = new Set([ObjectIdentifiers.ROOT, ObjectIdentifiers.ROOT_2]);
  /** West-to-east the pillars spell T-U-Z-O. */
  const PILLAR_TWIGS = new Map([
    [ObjectIdentifiers.PILLAR_2, ItemIdentifiers.TWIGS],
    [ObjectIdentifiers.PILLAR_3, ItemIdentifiers.TWIGS_2],
    [ObjectIdentifiers.PILLAR_4, ItemIdentifiers.TWIGS_3],
    [ObjectIdentifiers.PILLAR_5, ItemIdentifiers.TWIGS_4],
  ]);
  const ALL_PILLARS_PLACED = (1 << PILLAR_TWIGS.size) - 1;

  const WATCHTOWER_DESTINATION = { x: 2484, y: 3465, z: 2 };
  const CAVE_DESTINATION = { x: 2491, y: 9861, z: 0 };
  const CELL_DESTINATION = { x: 2464, y: 3495, z: 3 };
  /** The cell's door has no cached Open option, so release moves the player out. */
  const RELEASE_DESTINATION = { x: 2467, y: 3500, z: 3 };
  const SHIPYARD_CRASH_DESTINATION = { x: 2924, y: 3055, z: 0 };
  /** The far side of the shipyard gate the worker opens. */
  const SHIPYARD_INSIDE_DESTINATION = { x: 2947, y: 3042, z: 0 };
  /** Femi drops the player back inside the stronghold gate. */
  const STRONGHOLD_INSIDE_DESTINATION = { x: 2466, y: 3495, z: 0 };
  const FEMI_FARE = 1000;
  const BLACK_DEMON_ID = NpcIdentifiers.BLACK_DEMON_2; // 1432, the quest demon
  const DEMON_SPAWN = { x: 2488, y: 9866, z: 0 };

  const PILLARS_ATTRIBUTE = "grand-tree:pillars-placed";
  const PASSWORD_ATTRIBUTE = "grand-tree:shipyard-password";
  const ROOT_SEARCH_ATTRIBUTE = "grand-tree:roots-searched";
  const FEMI_HELPED_ATTRIBUTE = "grand-tree:femi-helped";
  const CORRECT_PASSWORD = "Ka.Lu.Min.";

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const missingTwigs = (player) => TWIG_ITEM_IDS.filter((itemId) => !has(player, itemId));
  const freeSlots = (player) => {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull() ? 0 : 28;
  };
  const grant = (player, itemId) => {
    if (!has(player, itemId)) player.getInventory().adds(itemId, 1);
  };
  const otherQuestStarted = (player, key) => {
    const query = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", query);
    return query.started === true;
  };
  const teleport = (player, tile) => player.moveTo(new Location(tile.x, tile.y, tile.z));
  const at = (tile) => new Location(tile.x, tile.y, tile.z);

  let quest;
  const demonEncounters = new Map();

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
      return ["Get Glough's key from Anita and open his chest."];
    }
    if (stage >= STAGE_LUMBER_ORDER) {
      return ["Take the lumber order to <col=800000>King Narnode</col>."];
    }
    if (stage >= STAGE_RELEASED) {
      return ["Investigate the Karamja shipyard and speak to its foreman."];
    }
    if (stage >= STAGE_FOUND_JOURNAL) {
      return ["Confront <col=800000>Glough</col> with what you found in his cupboard."];
    }
    if (stage >= STAGE_SPOKEN_PRISONER || stage >= STAGE_FOUND_PRISONER) {
      return ["Speak to Charlie, then search Glough's cupboard for evidence."];
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
    // Monkey Madness I owns King Narnode once the Grand Tree is complete (it
    // starts, re-issues the orders and finishes through him); returning null
    // lets its variant hook answer instead.
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_SEARCHING_DACONIA) {
      return has(player, DACONIA_ROCK_ITEM_ID)
        ? "saving-the-tree-daconia-delivered"
        : "saving-the-tree-the-end-of-the-tunnel-when-talking-to-king-narnode-again";
    }
    if (stage >= STAGE_DEMON_DEFEATED) return "saving-the-tree-the-end-of-the-tunnel";
    if (stage >= STAGE_TRAPDOOR) return "treachery-revealed-glough-s-pet-when-talking-to-king-narnode-without-finishing-the-fight";
    if (stage >= STAGE_GIVEN_TWIGS) return "treachery-revealed-glough-s-plans-when-speaking-to-king-narnode-again";
    if (stage >= STAGE_INVASION_PLANS) return "treachery-revealed-glough-s-plans-talking-to-king-narnode-shareen";
    if (stage >= STAGE_LUMBER_ORDER) return "treachery-revealed-when-speaking-to-king-narnode";
    if (stage >= STAGE_RELEASED) return "searching-glough-s-cupboard-imprisoned-when-speaking-to-king-narnode-again";
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
    if (stage >= STAGE_TRAPDOOR && stage < STAGE_DEMON_DEFEATED) {
      return "treachery-revealed-glough-s-pet-talking-to-glough-during-the-fight";
    }
    if (stage >= STAGE_RELEASED) return "treachery-revealed-when-speaking-to-glough";
    if (stage >= STAGE_FOUND_JOURNAL) return "searching-glough-s-cupboard-suspicions";
    return "human-sabotage-glough";
  }

  function charlieVariant(stage) {
    if (stage >= STAGE_INVASION_PLANS) return "treachery-revealed-glough-s-plans-talking-to-charlie";
    if (stage >= STAGE_LUMBER_ORDER) return "treachery-revealed-charlie";
    if (stage >= STAGE_RELEASED) return "searching-glough-s-cupboard-imprisoned-when-speaking-to-charlie-again";
    if (stage >= STAGE_FOUND_JOURNAL) return "searching-glough-s-cupboard-imprisoned";
    if (stage >= STAGE_SPOKEN_PRISONER) return "human-sabotage-interrogating-the-prisoner-when-talking-to-charlie-again";
    return "human-sabotage-interrogating-the-prisoner";
  }

  /**
   * Which transcript variant the clicked NPC plays. Shared NPCs are only owned
   * inside their Grand Tree stage window; outside it a later quest plugin gets
   * the turn, and the id index/name page supplies the ordinary dialogue.
   */
  function selectVariant({ npcId, npc, player }) {
    const stage = quest.getStage(player);
    if (NARNODE_IDS.has(npcId)) {
      const variant = narnodeVariant(player, stage);
      return variant ? page(variant) : null;
    }
    if (HAZELMERE_IDS.has(npcId)) {
      if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
      return page(stage >= STAGE_HAZELMERE ? "hazelmere-s-island-when-speaking-again-to-hazelmere" : "hazelmere-s-island");
    }
    if (GLOUGH_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        return otherQuestStarted(player, "monkey_madness_i") ? null : page("post-quest-glough");
      }
      if (stage < STAGE_RELAYED_MESSAGE) return null;
      return page(gloughVariant(stage));
    }
    if (CHARLIE_IDS.has(npcId)) {
      if (stage < STAGE_FOUND_PRISONER) return null;
      return page(charlieVariant(stage));
    }
    if (ANITA_IDS.has(npcId)) {
      if (stage < STAGE_CHARLIE_CLUE || stage >= STAGE_INVASION_PLANS) return null;
      return page(has(player, GLOUGHS_KEY_ITEM_ID)
        ? "treachery-revealed-anita-talking-to-anita-again"
        : "treachery-revealed-anita");
    }
    if (npcId === NpcIdentifiers.FOREMAN) {
      if (stage < STAGE_RELEASED || stage >= STAGE_INVASION_PLANS) return null;
      return page(stage >= STAGE_LUMBER_ORDER
        ? "treachery-revealed-the-shipyard-talking-to-foreman-after-obtaining-the-lumber-order"
        : "treachery-revealed-the-shipyard-foreman");
    }
    if (npcId === SHIPYARD_WORKER_ID) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return null;
      return page("treachery-revealed-the-shipyard-password");
    }
    if (npcId === NpcIdentifiers.FEMI) {
      if (stage === STAGE_NOT_STARTED) {
        return { page: "Femi", variant: "attemping-to-enter-the-tree-gnome-stronghold-for-the-first-time" };
      }
      if (stage < STAGE_RELEASED || stage >= STAGE_CHARLIE_CLUE) return null;
      if (stage >= STAGE_LUMBER_ORDER) {
        return page("treachery-revealed-sneaking-around-when-talking-to-femi-again");
      }
      return page(player.getAttribute(FEMI_HELPED_ATTRIBUTE) === true
        ? "treachery-revealed-sneaking-around-when-talking-to-femi-if-you-helped-her"
        : "treachery-revealed-sneaking-around-when-talking-to-femi-if-you-didn-t-help-her");
    }
    if (CAPTAIN_ERRDO_IDS.has(npcId)) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return null;
      const atStronghold = npc?.getLocation?.().getZ?.() === 3;
      if (atStronghold) {
        return page("searching-glough-s-cupboard-imprisoned-fleeing-the-grand-tree");
      }
      return page("treachery-revealed-arrival-talking-to-captain-errdo-again");
    }
    if (GNOME_GUARD_IDS.has(npcId)) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return null;
      return page("treachery-revealed-sneaking-around-gnome-guard");
    }
    if (JOGRE_IDS.has(npcId)) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return null;
      return page("treachery-revealed-arrival-upon-ending-the-conversation-with-errdo");
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text }) {
    if (![NARNODE_IDS, HAZELMERE_IDS, GLOUGH_IDS, CHARLIE_IDS, ANITA_IDS, CAPTAIN_ERRDO_IDS, GNOME_GUARD_IDS, JOGRE_IDS].some(ids => ids.has(npcId)) && ![NpcIdentifiers.FOREMAN, SHIPYARD_WORKER_ID, NpcIdentifiers.FEMI].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes("below level 50 combat")) {
      return (player.getSkillManager?.().getCombatLevel?.() ?? 0) < 50;
    }
    if (value.includes("lost the bark sample")) return !has(player, BARK_SAMPLE_ITEM_ID);
    if (value.includes("lost the translation book")) return !has(player, TRANSLATION_BOOK_ITEM_ID);
    // A partial set is recoverable too: the King tops up the missing twigs.
    if (value.includes("lost the twigs")) return missingTwigs(player).length > 0;
    if (value.includes("doesn't have enough inventory space")) {
      return missingTwigs(player).length > freeSlots(player);
    }
    if (value.includes("has enough inventory space")) {
      return missingTwigs(player).length <= freeSlots(player);
    }
    // The king's translation quiz has one right sequence; without tracking the
    // individual answers the "correct" branch is always the one to play.
    if (value.includes("chose the correct options")) return NARNODE_IDS.has(npcId) ? true : null;
    if (value.includes("chose the wrong options")) return NARNODE_IDS.has(npcId) ? false : null;
    // The shipyard password conditions are answered after the three picks, in
    // handleLine/handleAction: the dialogue runtime flattens the conditions when
    // the "Glough sent me." branch opens, before the picks exist.
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!NARNODE_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    if (player.getSkillManager().getMaxLevel(Skill.AGILITY) < 25) {
      player.sendMessage("You need 25 Agility to start The Grand Tree.");
      return;
    }
    quest.setStage(player, STAGE_STARTED);
    if (!has(player, BARK_SAMPLE_ITEM_ID)) player.getInventory().adds(BARK_SAMPLE_ITEM_ID, 1);
    if (!has(player, TRANSLATION_BOOK_ITEM_ID)) player.getInventory().adds(TRANSLATION_BOOK_ITEM_ID, 1);
  }

  function advance(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  /** Lines and choices that move the stage on, keyed by page text. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    // The queued password branch is always the "correct" one; swap its line for
    // the wiki's wrong-password line when the picks do not match.
    if (npcId === SHIPYARD_WORKER_ID && text.startsWith("Sorry to have kept you.")) {
      if (String(player.getAttribute(PASSWORD_ATTRIBUTE) ?? "") !== CORRECT_PASSWORD) {
        event.text = "You have no idea!";
      }
      return;
    }
    const stage = quest.getStage(player);
    // The King's closing line is typed on Charlie's cell transcript, so the
    // clicked NPC id is Charlie even though the speaker is Narnode.
    if (text.startsWith("I'm sorry again Traveller!")) {
      if (stage >= STAGE_FOUND_JOURNAL && stage < STAGE_RELEASED) advance(player, STAGE_RELEASED);
      return;
    }
    // Each line only advances the stage window its conversation belongs to, so a
    // shared NPC talked to before that leg cannot skip the route.
    if (NARNODE_IDS.has(npcId)) {
      if (text.startsWith("OK! I'll be back soon.")) {
        if (stage >= STAGE_HAZELMERE && stage < STAGE_RELAYED_MESSAGE) advance(player, STAGE_RELAYED_MESSAGE);
        return;
      }
      if (text.startsWith("Certainly. He's on the top level")) {
        if (stage >= STAGE_SPOKEN_GLOUGH && stage < STAGE_FOUND_PRISONER) advance(player, STAGE_FOUND_PRISONER);
        return;
      }
      if (text.startsWith("A reward will have to wait though")) {
        if (stage >= STAGE_DEMON_DEFEATED && stage < STAGE_SEARCHING_DACONIA) advance(player, STAGE_SEARCHING_DACONIA);
        return;
      }
      return;
    }
    if (GLOUGH_IDS.has(npcId) && text.startsWith("Your type can't be trusted!")) {
      if (stage >= STAGE_RELAYED_MESSAGE && stage < STAGE_SPOKEN_GLOUGH) advance(player, STAGE_SPOKEN_GLOUGH);
      return;
    }
    if (CHARLIE_IDS.has(npcId)) {
      if (text.startsWith("Good luck!")) {
        if (stage >= STAGE_FOUND_PRISONER && stage < STAGE_SPOKEN_PRISONER) advance(player, STAGE_SPOKEN_PRISONER);
        return;
      }
      if (text.startsWith("Okay, I'll see what I can find.")) {
        if (stage >= STAGE_LUMBER_ORDER && stage < STAGE_CHARLIE_CLUE) {
          if (has(player, LUMBER_ORDER_ITEM_ID)) {
            player.getInventory().deleteNumber(LUMBER_ORDER_ITEM_ID, 1);
          }
          advance(player, STAGE_CHARLIE_CLUE);
        }
        return;
      }
    }
  }

  function handleChoice({ player, npcId, option }) {
    if (!player || npcId !== SHIPYARD_WORKER_ID) return;
    const text = String(option ?? "");
    if (/^(Ka|Ko|Ke)\.$/.test(text)) {
      player.setAttribute(PASSWORD_ATTRIBUTE, text);
      return;
    }
    if (/^(Lo|Lu|Le)\.$/.test(text) || /^(Mon|Min|Men)\.$/.test(text)) {
      const picks = String(player.getAttribute(PASSWORD_ATTRIBUTE) ?? "");
      player.setAttribute(PASSWORD_ATTRIBUTE, picks + text);
    }
  }

  /** The transcript's item hand-ins and stage directions. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId) return;

    if (npcId === NpcIdentifiers.FEMI && stepId === "CWsctI") {
      player.setAttribute(FEMI_HELPED_ATTRIBUTE, true);
      return;
    }

    // `message` steps fire twice: once as an action, once with kind "message".
    if (event.kind === "message") {
      if (stepId === BARK_REPLACEMENT_MESSAGE_ID) {
        if (!has(player, BARK_SAMPLE_ITEM_ID)) player.getInventory().adds(BARK_SAMPLE_ITEM_ID, 1);
        return;
      }
      if (stepId === BOOK_REPLACEMENT_MESSAGE_ID) {
        if (!has(player, TRANSLATION_BOOK_ITEM_ID)) player.getInventory().adds(TRANSLATION_BOOK_ITEM_ID, 1);
        return;
      }
      if (stepId === SCROLL_REPLACEMENT_MESSAGE_ID && quest.getStage(player) >= STAGE_HAZELMERE) {
        grant(player, HAZELMERES_SCROLL_ITEM_ID);
        return;
      }
      if (stepId === GLIDER_FLIGHT_MESSAGE_ID) {
        if (player.getLocation().getZ() === 3) teleport(player, SHIPYARD_CRASH_DESTINATION);
        return;
      }
      return;
    }

    const stage = quest.getStage(player);
    if (stepId === COMPLETE_ACTION_ID) {
      if (!NARNODE_IDS.has(npcId) || quest.isComplete(player)) return;
      if (stage < STAGE_SEARCHING_DACONIA || !has(player, DACONIA_ROCK_ITEM_ID)) return;
      player.getInventory().deleteNumber(DACONIA_ROCK_ITEM_ID, 1);
      quest.complete(player);
      return;
    }
    if (stepId === HAZELMERE_SCROLL_ACTION_ID) {
      if (stage < STAGE_STARTED || stage >= STAGE_HAZELMERE) return;
      if (has(player, BARK_SAMPLE_ITEM_ID)) player.getInventory().deleteNumber(BARK_SAMPLE_ITEM_ID, 1);
      grant(player, HAZELMERES_SCROLL_ITEM_ID);
      advance(player, STAGE_HAZELMERE);
      return;
    }
    if (stepId === BARK_REPLACEMENT_ACTION_ID) {
      if (stage < STAGE_STARTED || stage >= STAGE_RELAYED_MESSAGE) return;
      grant(player, BARK_SAMPLE_ITEM_ID);
      return;
    }
    if (stepId === ANITA_KEY_ACTION_ID) {
      if (stage < STAGE_CHARLIE_CLUE || stage >= STAGE_INVASION_PLANS) return;
      grant(player, GLOUGHS_KEY_ITEM_ID);
      return;
    }
    if (stepId === LUMBER_ORDER_ACTION_ID) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return;
      if (!has(player, LUMBER_ORDER_ITEM_ID)) {
        if (freeSlots(player) < 1) {
          player.sendMessage("You don't have enough inventory space for the lumber order.");
          return;
        }
        player.getInventory().adds(LUMBER_ORDER_ITEM_ID, 1);
      }
      advance(player, STAGE_LUMBER_ORDER);
      return;
    }
    if (stepId === TWIGS_ACTION_ID || stepId === TWIGS_REPLACEMENT_ACTION_ID) {
      if (stage < STAGE_INVASION_PLANS || stage >= STAGE_TRAPDOOR) return;
      const missing = missingTwigs(player);
      if (missing.length > freeSlots(player)) {
        player.sendMessage("You need enough free inventory slots for the missing twigs.");
        return;
      }
      if (has(player, INVASION_PLANS_ITEM_ID)) {
        player.getInventory().deleteNumber(INVASION_PLANS_ITEM_ID, 1);
      }
      for (const twig of missing) {
        player.getInventory().adds(twig, 1);
      }
      advance(player, STAGE_GIVEN_TWIGS);
      return;
    }
    if (stepId === ARREST_ACTION_ID) {
      if (stage < STAGE_FOUND_JOURNAL || stage >= STAGE_RELEASED) return;
      teleport(player, CELL_DESTINATION);
      return;
    }
    if (stepId === RELEASE_ACTION_ID) {
      if (stage < STAGE_FOUND_JOURNAL || stage >= STAGE_RELEASED) return;
      teleport(player, RELEASE_DESTINATION);
      advance(player, STAGE_RELEASED);
      return;
    }
    if (stepId === FEMI_SNEAK_ACTION_ID || stepId === FEMI_PAID_SNEAK_ACTION_ID) {
      if (stage < STAGE_RELEASED || stage >= STAGE_CHARLIE_CLUE) return;
      if (stepId === FEMI_PAID_SNEAK_ACTION_ID
        && player.getInventory().getAmount(COINS_ITEM_ID) < FEMI_FARE) {
        player.sendMessage("You need 1000 coins for Femi.");
        return;
      }
      if (stepId === FEMI_PAID_SNEAK_ACTION_ID) {
        player.getInventory().deleteNumber(COINS_ITEM_ID, FEMI_FARE);
      }
      teleport(player, STRONGHOLD_INSIDE_DESTINATION);
      return;
    }
    if (stepId === PASSWORD_CORRECT_ACTION_ID || stepId === PASSWORD_WRONG_ACTION_ID) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return;
      const correct = String(player.getAttribute(PASSWORD_ATTRIBUTE) ?? "") === CORRECT_PASSWORD;
      if (stepId === PASSWORD_CORRECT_ACTION_ID && correct) {
        // The worker lets the player through the now-open gate.
        teleport(player, SHIPYARD_INSIDE_DESTINATION);
      } else if (event.npc) {
        // 1430 is a talk-only NPC; the angry worker is the combat variant.
        const where = event.npc.getLocation();
        const attacker = api.spawnNpc({
          id: SHIPYARD_ATTACKER_ID,
          x: where.getX(),
          y: where.getY(),
          z: where.getZ(),
          wanderRadius: 0,
          owner: player,
          ownerOnly: true,
        });
        attacker?.getCombat?.().attack?.(player);
      }
      player.setAttribute(PASSWORD_ATTRIBUTE, "");
    }
  }

  function searchCupboard(event) {
    if (!GLOUGHS_CUPBOARD_IDS.has(event.objectId)) return false;
    const player = event.player;
    if (has(player, GLOUGHS_JOURNAL_ITEM_ID) || quest.getStage(player) >= STAGE_FOUND_JOURNAL) {
      player.sendMessage("The cupboard is empty.");
      return true;
    }
    if (quest.getStage(player) < STAGE_SPOKEN_PRISONER) {
      player.sendMessage("You search the cupboard but find nothing.");
      return true;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space to pick up Glough's Journal.");
      return true;
    }
    player.getInventory().adds(GLOUGHS_JOURNAL_ITEM_ID, 1);
    player.sendMessage("You've found Glough's Journal!");
    quest.setStage(player, STAGE_FOUND_JOURNAL);
    return true;
  }

  function openChest(event) {
    if (event.objectId !== GLOUGHS_CHEST_ID) return false;
    const player = event.player;
    if (has(player, INVASION_PLANS_ITEM_ID)) {
      player.sendMessage("The chest is empty.");
      return true;
    }
    const stage = quest.getStage(player);
    // Once opened, the chest stays open: a lost invasion plans copy can be
    // recovered without another key.
    if (stage >= STAGE_INVASION_PLANS) {
      if (freeSlots(player) < 1) {
        player.sendMessage("You need more inventory space to pick up the invasion plans.");
        return true;
      }
      player.getInventory().adds(INVASION_PLANS_ITEM_ID, 1);
      player.sendMessage("You have found a scroll!");
      return true;
    }
    if (stage < STAGE_CHARLIE_CLUE || !has(player, GLOUGHS_KEY_ITEM_ID)) {
      player.sendMessage("The chest is locked. Glough's key should open it.");
      return true;
    }
    player.getInventory().deleteNumber(GLOUGHS_KEY_ITEM_ID, 1);
    player.getInventory().adds(INVASION_PLANS_ITEM_ID, 1);
    player.sendMessage("You have found a scroll!");
    quest.setStage(player, STAGE_INVASION_PLANS);
    return true;
  }

  function useKeyOnChest(event) {
    if (event.objectId !== GLOUGHS_CHEST_ID || event.itemId !== GLOUGHS_KEY_ITEM_ID) return;
    event.handled = true;
    openChest(event);
  }

  function climbWatchtower(event) {
    if (event.objectId !== WATCHTOWER_TREE_ID) return false;
    api.emitCustomEvent("ladders:climbUp", {
      player: event.player,
      destination: at(WATCHTOWER_DESTINATION),
    });
    return true;
  }

  function placeTwig(event) {
    const twig = PILLAR_TWIGS.get(event.objectId);
    if (!twig) return;
    const player = event.player;
    if (quest.getStage(player) < STAGE_GIVEN_TWIGS) return;
    event.handled = true;
    const index = [...PILLAR_TWIGS.keys()].indexOf(event.objectId);
    const placed = Number(player.getAttribute(PILLARS_ATTRIBUTE)) || 0;
    const bit = 1 << index;
    if (placed & bit) {
      player.sendMessage("There is already a twig on this pillar.");
      return;
    }
    if (event.itemId !== twig) {
      player.sendMessage("You cannot put that on the pillar.");
      return;
    }
    if (has(player, twig)) player.getInventory().deleteNumber(twig, 1);
    const next = placed | bit;
    player.setAttribute(PILLARS_ATTRIBUTE, next);
    player.sendMessage("You place the twig on the pillar.");
    if (next === ALL_PILLARS_PLACED) {
      player.sendMessage("With a grinding of machinery, a trapdoor snaps open!");
      quest.setStage(player, STAGE_TRAPDOOR);
    }
  }

  function ensureDemon(player) {
    const tracked = demonEncounters.get(player);
    if (tracked?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: BLACK_DEMON_ID,
      x: DEMON_SPAWN.x,
      y: DEMON_SPAWN.y,
      z: DEMON_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) demonEncounters.set(player, npc);
  }

  function climbDownTrapdoor(event) {
    if (event.objectId !== GLOUGHS_TRAPDOOR_ID) return false;
    if (quest.getStage(event.player) < STAGE_TRAPDOOR) return false;
    teleport(event.player, CAVE_DESTINATION);
    ensureDemon(event.player);
    return true;
  }

  function searchRoot(event) {
    if (!ROOT_IDS.has(event.objectId)) return false;
    const player = event.player;
    if (quest.getStage(player) < STAGE_SEARCHING_DACONIA || has(player, DACONIA_ROCK_ITEM_ID)) {
      player.sendMessage("You search the root but don't find anything.");
      return true;
    }
    const searched = (Number(player.getAttribute(ROOT_SEARCH_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(ROOT_SEARCH_ATTRIBUTE, searched);
    if (searched < 2) {
      player.sendMessage("You search the root but don't find anything.");
      return true;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space to pick up the Daconia rock.");
      return true;
    }
    player.getInventory().adds(DACONIA_ROCK_ITEM_ID, 1);
    player.sendMessage("You've found a Daconia rock!");
    return true;
  }

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (npcId === BLACK_DEMON_ID) {
      for (const [player, tracked] of demonEncounters) {
        if (tracked === npc) demonEncounters.delete(player);
      }
      if (killer && quest.getStage(killer) === STAGE_TRAPDOOR) {
        quest.setStage(killer, STAGE_DEMON_DEFEATED);
      }
      return;
    }
    // The foreman can be killed for the lumber order instead of quizzed.
    if (npcId === NpcIdentifiers.FOREMAN && killer) {
      const stage = quest.getStage(killer);
      if (stage >= STAGE_RELEASED && stage < STAGE_LUMBER_ORDER) {
        if (!has(killer, LUMBER_ORDER_ITEM_ID) && freeSlots(killer) < 1) {
          killer.sendMessage("You don't have enough inventory space for the lumber order.");
          return;
        }
        grant(killer, LUMBER_ORDER_ITEM_ID);
        quest.setStage(killer, STAGE_LUMBER_ORDER);
      }
    }
  }

  function handleLogout({ player }) {
    const npc = demonEncounters.get(player);
    if (npc) {
      api.removeNpc(npc);
      demonEncounters.delete(player);
    }
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
    scrollItemId: DACONIA_ROCK_ITEM_ID,
    rewardItemLabel: "Access to the Grand Tree mine",
    otherRewards: ["Gnome gliders", "Spirit Tree travel"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(PILLARS_ATTRIBUTE);
  api.persistAttribute(PASSWORD_ATTRIBUTE);
  api.persistAttribute(ROOT_SEARCH_ATTRIBUTE);
  api.persistAttribute(FEMI_HELPED_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onObjectInteraction("Cupboard", { Open: searchCupboard, Search: searchCupboard });
  api.onObjectInteraction("Closed chest", { Open: openChest });
  api.onItemOnObject(useKeyOnChest);
  api.onItemOnObject(placeTwig);
  api.onObjectInteraction("Tree", { "Climb-up": climbWatchtower });
  api.onObjectInteraction("Trapdoor", { "Climb-down": climbDownTrapdoor });
  api.onObjectInteraction("Root", { Search: searchRoot });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
