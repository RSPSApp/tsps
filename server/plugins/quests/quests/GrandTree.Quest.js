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
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const { boxFor, showBox } = require("../grandtree/Boxes.GrandTree");
const createQuiz = require("../grandtree/Quiz.GrandTree");

module.exports = function registerGrandTreeQuest(api) {
  const {
    Skill, Location, Item, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
    ItemOnGround, ItemOnGroundManager, GroundItemState,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage } = require("../QuestRuntime");

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

  const FOUNDATIONS_VARIANT = "the-dying-tree-foundations-cutscene";
  const FOUNDATIONS_ENTER_ACTION_ID = "WguHnH";
  const FOUNDATIONS_RETURN_ACTION_IDS = new Set(["4N-LXD", "Ad8Cjj"]);
  /** Transcript action that ends the "Daconia delivered" branch. */
  const COMPLETE_ACTION_ID = "PJWrB9";
  /** Transcript message (the King's "hands you" box) that starts the quest. */
  const START_HANDOVER_MESSAGE_ID = "0x50uy";
  /** Transcript messages: Hazelmere takes the sample, and hands over his scroll. */
  const HAZELMERE_EXAMINES_MESSAGE_ID = "X3yf3S";
  const HAZELMERE_SCROLL_MESSAGE_ID = "TBoehl";
  /** The foreman's hand-over stage direction, played as its box, and the transcript's item marker after it. */
  const LUMBER_ORDER_BOX_ACTION_ID = "CY_Xvt";
  const LUMBER_ORDER_MESSAGE_ID = "CY_Xvt";
  const LUMBER_ORDER_ACTION_ID = "TXgXt3";
  const FOREMAN_OFFICE_ACTION_ID = "eQHe7h";
  const FOREMAN_QUIZ = "treachery-revealed-the-shipyard-foreman";
  /** Transcript messages (the King's box) that hand over the four twigs, first time and again. */
  const TWIGS_MESSAGE_IDS = new Set(["ytGGY4", "UHEs00"]);
  /** Transcript message (Anita's box) that hands over Glough's key. */
  const ANITA_KEY_MESSAGE_ID = "TRhLER";
  /** Transcript action that hands over a replacement bark sample. */
  const BARK_REPLACEMENT_ACTION_ID = "Sa6sOu";
  /** Transcript message: a replacement bark sample. */
  const BARK_REPLACEMENT_MESSAGE_ID = "g1AfH0";
  /** Transcript message: a replacement translation book. */
  const BOOK_REPLACEMENT_MESSAGE_ID = "4e6OhA";
  /** Transcript message: Hazelmere re-writes the scroll. */
  const SCROLL_REPLACEMENT_MESSAGE_ID = "r6XvDD";
  /** Transcript actions: a guard answers Glough's call, then escorts the player into Charlie's cell. */
  const GUARD_APPEARS_ACTION_ID = "8wsOyT";
  const ARREST_ACTION_ID = "pkr5F6";
  const PRISON_VARIANT = "searching-glough-s-cupboard-imprisoned";
  const CRASH_VARIANT = "treachery-revealed-arrival-landing-crashing-the-glider";
  const GUARD_SCENE_PAUSES = new Map([
    ["Never! Not Glough! He's a good gnome at heart!", 1],
    ["Guard!", 9],
    ["Go and check out that passage!", 5],
  ]);
  const PRISON_KING_ACTION_ID = "cAaPZv";
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
  /**
   * The lines varp 150 moves on with (capture ticks): [speakers, line, from stage, to stage]. The lumber order
   * stays with Charlie's clue (the capture's player still banks it after the quest).
   */
  const STAGE_LINES = [
    [NARNODE_IDS, "First I must warn the tree guardians.", STAGE_HAZELMERE, STAGE_RELAYED_MESSAGE], // t10819
    [GLOUGH_IDS, "Your type can't be trusted!", STAGE_RELAYED_MESSAGE, STAGE_SPOKEN_GLOUGH], // t10906
    [NARNODE_IDS, "Certainly. He's on the top level", STAGE_SPOKEN_GLOUGH, STAGE_FOUND_PRISONER], // t11000
    [CHARLIE_IDS, "I don't know what he's up to.", STAGE_FOUND_PRISONER, STAGE_SPOKEN_PRISONER], // t11056
    [NARNODE_IDS, "I'm afraid Glough has placed guards", STAGE_FOUND_JOURNAL, STAGE_RELEASED], // t11205
    [CHARLIE_IDS, "Hmm... you could be in luck!", STAGE_LUMBER_ORDER, STAGE_CHARLIE_CLUE], // t11723
    [NARNODE_IDS, "A reward will have to wait though", STAGE_DEMON_DEFEATED, STAGE_SEARCHING_DACONIA], // t12553
  ];
  const ANITA_IDS = new Set([NpcIdentifiers.ANITA, NpcIdentifiers.ANITA_2]);
  const GNOME_GUARD_IDS = new Set([NpcIdentifiers.GNOME_GUARD_2, NpcIdentifiers.GNOME_GUARD_3]);
  const JOGRE_IDS = new Set([NpcIdentifiers.JOGRE, NpcIdentifiers.JOGRE_2]);
  const CAPTAIN_ERRDO_IDS = new Set([6088, 6091, 10467, 10468, 10469, 10470, 10471, 10472, 10473]);
  /** The stronghold pilot who flies the player to the Karamja crash site. */
  const STRONGHOLD_ERRDO_ID = 6091;
  /** Errdo as he shows at the Karamja crash site (pilot_grand_tree_base). */
  const KARAMJA_ERRDO_ID = 10467;
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
  const TWIG_HANDOUT_ORDER = [ItemIdentifiers.TWIGS_4, ItemIdentifiers.TWIGS_3, ItemIdentifiers.TWIGS, ItemIdentifiers.TWIGS_2];

  // Glough's house, its watchtower and the cave under the stronghold.
  const GLOUGHS_CHEST_ID = ObjectIdentifiers.CLOSED_CHEST_9;
  const WATCHTOWER_TREE_ID = ObjectIdentifiers.TREE_13;
  /**
   * The trapdoor's map object (2444) and the loc its varp-150 transform resolves to at stage 130
   * (26243, Climb-down). A click can name either one; both must start the same handler.
   */
  const GLOUGHS_TRAPDOOR_IDS = new Set([2444, ObjectIdentifiers.TRAPDOOR_90]);
  /** The same multi-loc is reused elsewhere; only Glough's tower trapdoor owns this handler. */
  const GLOUGHS_TRAPDOOR_TILE = { x: 2487, y: 3464, z: 2 };
  const ROOT_IDS = new Set([ObjectIdentifiers.ROOT, ObjectIdentifiers.ROOT_2]);
  /** West-to-east the pillars spell T-U-Z-O. */
  const PILLAR_TWIGS = new Map([
    [ObjectIdentifiers.PILLAR_2, ItemIdentifiers.TWIGS],
    [ObjectIdentifiers.PILLAR_3, ItemIdentifiers.TWIGS_2],
    [ObjectIdentifiers.PILLAR_4, ItemIdentifiers.TWIGS_3],
    [ObjectIdentifiers.PILLAR_5, ItemIdentifiers.TWIGS_4],
  ]);
  const ALL_PILLARS_PLACED = (1 << PILLAR_TWIGS.size) - 1;
  const FIRST_PILLAR_TILE = { x: 2485, y: 3467, z: 2 };

  /** Climbing the watchtower tree lands beside the twig pillars (capture t12169). */
  const WATCHTOWER_DESTINATION = { x: 2486, y: 3465, z: 2 };
  /** The cave's entrance ladder is at 2492, 9864. Land on the open tile directly south. */
  const CAVE_DESTINATION = { x: 2492, y: 9863, z: 0 };
  const BROKEN_CAVE_LADDER_ID = ObjectIdentifiers.LADDER_206;
  // Walkable tile just east of the surface trapdoor (2446).
  const FOUNDATIONS_LANDING = { x: 2463, y: 9896, z: 0 };
  const CELL_DESTINATION = { x: 2464, y: 3496, z: 3 };
  const SHIPYARD_GATES = new Map([[3041, ObjectIdentifiers.GATE_55], [3042, ObjectIdentifiers.GATE_56]]);
  const SHIPYARD_GATE_X = 2945;
  const SHIPYARD_OFFICE = { x: 2954, y: 3025, z: 0 };
  /** Where a player who logs in inside the office finds the foreman (his seat in the capture). */
  const OFFICE_FOREMAN = { x: 2954, y: 3025, z: 0 };
  const FEMI_FARE = 1000;
  const BLACK_DEMON_ID = NpcIdentifiers.BLACK_DEMON_2; // 1432, the quest demon

  const PILLARS_ATTRIBUTE = "grand-tree:pillars-placed";
  const PASSWORD_ATTRIBUTE = "grand-tree:shipyard-password";
  const DACONIA_ROOT_ATTRIBUTE = "grand-tree:daconia-root";
  const FEMI_HELPED_ATTRIBUTE = "grand-tree:femi-helped";
  const FEMI_REFUSED_ATTRIBUTE = "grand-tree:femi-refused";
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
  const quiz = createQuiz();
  const demonEncounter = require("../grandtree/Demon.GrandTree")(api, { onDefeated: demonDefeated });
  const officeForemen = new Map();
  const scenes = require("../grandtree/Scenes.GrandTree")(api, {
    onPrisonKing: kingInCell,
    onLanded: crashLanding,
    onOffice: officeForemanAt,
  });
  const pillarDisplays = new WeakMap();

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
    return ["I can start this quest by talking to <col=800000>King Narnode Shareen</col> in the <col=800000>Grand Tree</col>."];
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
    return player.getLocation().isWithinDistance(at(FOUNDATIONS_LANDING), 3) ? FOUNDATIONS_VARIANT : "the-dying-tree";
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
    if (stage >= STAGE_FOUND_JOURNAL) return PRISON_VARIANT;
    if (stage >= STAGE_SPOKEN_PRISONER) return "human-sabotage-interrogating-the-prisoner-when-talking-to-charlie-again";
    return "human-sabotage-interrogating-the-prisoner";
  }

  /**
   * Captain Errdo's "Glider" at the top of the tree while Glough's prisoner is escaping: the quest
   * isn't complete, so the glider plugin would refuse, but this is the flight out. It plays the
   * same escape as Talk-to.
   */
  function fleeOnGlider(request) {
    const { player, npc } = request;
    if (request.handled || !CAPTAIN_ERRDO_IDS.has(npc?.getId?.())) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER || npc.getLocation().getZ() !== 3) return;
    request.handled = startTranscript(api, player, npc.getId(), PAGE,
      "searching-glough-s-cupboard-imprisoned-fleeing-the-grand-tree", null, npc);
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
        : FOREMAN_QUIZ);
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
      // The Femi who brought the player in with her cart; the one at the gate sneaks them in (capture
      // t11576, after the lumber order).
      if (scenes.isCartFemi(player, npc)) {
        return page("treachery-revealed-sneaking-around-when-talking-to-femi-again");
      }
      // Wiki (The Grand Tree, "Karamja investigation"): free "if you never entered the stronghold through the
      // gate before, or if you chose to help her move boxes the first time"; 1,000 coins if you chose not to.
      const helped = player.getAttribute(FEMI_HELPED_ATTRIBUTE) === true || player.getAttribute(FEMI_REFUSED_ATTRIBUTE) !== true;
      return page(helped
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

  function ensureOfficeForeman(player, tile = OFFICE_FOREMAN) {
    if (officeForemen.get(player)?.isRegistered()) return officeForemen.get(player);
    const npc = api.spawnNpc({
      id: NpcIdentifiers.FOREMAN, ...tile, wanderRadius: 0, owner: player, ownerOnly: true,
    });
    if (npc) officeForemen.set(player, npc);
    return npc ?? null;
  }

  /** The office foreman appears where the capture has him as the fade lifts (2954,3031), then walks to his seat. */
  function officeForemanAt(player, [x, y, z]) {
    return ensureOfficeForeman(player, { x, y, z });
  }

  /** Glough's guard has put the player in the cell; the King comes straight away (capture t11167-11174). */
  function kingInCell(player, king) {
    if (quest.getStage(player) !== STAGE_FOUND_JOURNAL || !king) return;
    startTranscript(api, player, NpcIdentifiers.KING_NARNODE_SHAREEN, PAGE, PRISON_VARIANT,
      (steps) => steps.slice(steps.findIndex((step) => step.id === PRISON_KING_ACTION_ID) + 1), king);
  }

  /** The glider has crashed on Karamja: Errdo speaks first (capture t11256). */
  function crashLanding(player, pilot) {
    if (quest.getStage(player) !== STAGE_RELEASED) return;
    // The pilot is a multi-NPC (6091, nameless); his chat head and name are the form the player sees.
    const pilotId = pilot?.getContentId?.(player) ?? KARAMJA_ERRDO_ID;
    startTranscript(api, player, pilotId, PAGE, CRASH_VARIANT, null, pilot);
  }

  function inCell(player) {
    const here = player.getLocation();
    return here.getZ() === CELL_DESTINATION.z && here.getX() <= CELL_DESTINATION.x
      && Math.abs(here.getY() - CELL_DESTINATION.y) <= 1;
  }

  function removeOfficeForeman(player) {
    const npc = officeForemen.get(player);
    if (!npc) return;
    officeForemen.delete(player);
    api.removeNpc(npc);
  }

  /** Glough's arrest is under way (the guard's climb, the escort): a click on him starts nothing. */
  function holdDuringArrest({ player }) {
    return scenes.arresting(player);
  }

  function resumeOfficeQuiz({ player, npc, npcId }) {
    if (npc !== officeForemen.get(player) || quest.getStage(player) !== STAGE_RELEASED) return false;
    return startTranscript(api, player, npcId, PAGE, FOREMAN_QUIZ, (steps) => {
      const entry = steps.findIndex((step) => step.id === FOREMAN_OFFICE_ACTION_ID);
      return entry < 0 ? [] : steps.slice(entry + 1);
    }, npc);
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
    // The King's translation quiz: its option conditions and closing branch follow the picks.
    if (NARNODE_IDS.has(npcId)) {
      const quizAnswer = quiz.answer(player, text);
      if (quizAnswer !== null) return quizAnswer;
    }
    // The shipyard password conditions are answered after the three picks, in
    // handleLine/handleAction: the dialogue runtime flattens the conditions when
    // the "Glough sent me." branch opens, before the picks exist.
    return null;
  }

  /**
   * The quest starts, and the bark sample and translation book are handed over, with the King's "hands you"
   * box rather than on "Yes.": rsprox capture local 1002189 tick 10338 sends varp 150 0 -> 10, the started-quest
   * message and both items with that box.
   */
  function startQuest(player) {
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage(questStartMessage(player, quest.name));
    grant(player, BARK_SAMPLE_ITEM_ID);
    grant(player, TRANSLATION_BOOK_ITEM_ID);
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
    if (event.npc && event.npc === scenes.prisonKing(player) && text === "I'm sorry again Traveller!") {
      event.after = () => scenes.removePrisonKing(player);
    }
    // Each line only advances the stage window its conversation belongs to, so a shared NPC talked to before
    // that leg cannot skip the route. The stage moves as the line shows (`before`), as varp 150 does in rsprox
    // capture local 1002189 (ticks in the docs), not when the conversation is queued.
    const advanceTo = STAGE_LINES.find(([ids, line]) => ids.has(npcId) && text.startsWith(line));
    if (advanceTo) {
      const [, , from, to] = advanceTo;
      if (stage >= from && stage < to) event.before = () => {
        const now = quest.getStage(player);
        if (now >= from && now < to) advance(player, to);
      };
      return;
    }
    if (NARNODE_IDS.has(npcId)) {
      // The trapdoor scenes say these themselves, on their captured ticks (Scenes.GrandTree.js).
      if ((text === "Down here." || text === "Up here.") && event.step?.presentation === "overhead") {
        event.skip = true;
        return;
      }
      // The guard comes and goes between the King's lines: the chat closes for these ticks (capture
      // t12499-12522, from each continue to the next line).
      const pause = GUARD_SCENE_PAUSES.get(text);
      if (pause && stage === STAGE_DEMON_DEFEATED) event.pauseTicks = pause;
    }
  }

  function handleChoice({ player, npcId, option }) {
    if (player && NARNODE_IDS.has(npcId)) quiz.choose(player, option);
    // Femi's first-entry boxes (her own page): turning her down is what costs 1,000 coins later.
    if (player && npcId === NpcIdentifiers.FEMI && option === "Sorry, I'm a bit busy."
      && quest.getStage(player) === STAGE_NOT_STARTED && player.getAttribute(FEMI_HELPED_ATTRIBUTE) !== true) {
      player.setAttribute(FEMI_REFUSED_ATTRIBUTE, true);
    }
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

  function findNearbyNpc(player, npcId) {
    return api.getWorld().getNpcsNear(player.getLocation(), 5, player.getPrivateArea()).find(npc => npc.getContentId(player) === npcId);
  }

  function openDoor(player, objectId, location) {
    const object = api.core.MapObjects.get(objectId, location, player.getPrivateArea());
    const request = { player, object, handled: false };
    if (object) api.emitCustomEvent("door:open", request);
    return request.handled;
  }

  function askShipyardPassword(event) {
    const { player, objectId, option } = event;
    const where = player.getLocation();
    const { x, y, z } = event.location;
    if (option.toLowerCase() !== "open" || x !== SHIPYARD_GATE_X || z !== 0 || where.getX() >= SHIPYARD_GATE_X
      || SHIPYARD_GATES.get(y) !== objectId || quest.getStage(player) !== STAGE_RELEASED) return;
    const worker = findNearbyNpc(player, SHIPYARD_WORKER_ID);
    event.handled = startTranscript(api, player, SHIPYARD_WORKER_ID, PAGE, "treachery-revealed-the-shipyard-password", null, worker);
  }

  function crossShipyardGate(event) {
    const { player } = event;
    const here = player.getLocation();
    if (here.getX() >= SHIPYARD_GATE_X || here.getZ() !== 0) return;
    const y = here.getY() >= 3042 ? 3042 : 3041;
    const gate = new Location(SHIPYARD_GATE_X, y, 0);
    if (!here.isWithinDistance(gate, 3)) return;
    event.handled = event.end = true;
    ObstacleRunner.run({ player }, [{ walk: [[SHIPYARD_GATE_X - 1, y]] }], {
      onFinish(completed) {
        if (completed) openDoor(player, SHIPYARD_GATES.get(y), gate);
      },
    });
  }

  /** The foreman's lumber order, with his box (capture t11514: the order and varp 150 80 -> 90 on that tick). */
  function giveLumberOrder(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return;
    if (!has(player, LUMBER_ORDER_ITEM_ID)) {
      if (freeSlots(player) < 1) {
        player.sendMessage("You don't have enough inventory space for the lumber order.");
        return;
      }
      player.getInventory().adds(LUMBER_ORDER_ITEM_ID, 1);
    }
    advance(player, STAGE_LUMBER_ORDER);
  }

  /**
   * The King's twigs, with his box: capture t12117 takes the invasion plans, gives the four twigs and moves varp
   * 150 110 -> 120 on that tick. A lost twig is topped up from the same line later.
   */
  function giveTwigs(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_INVASION_PLANS || stage >= STAGE_TRAPDOOR) return;
    const missing = missingTwigs(player);
    if (missing.length > freeSlots(player) + (has(player, INVASION_PLANS_ITEM_ID) ? 1 : 0)) {
      player.sendMessage("You need enough free inventory slots for the missing twigs.");
      return;
    }
    if (has(player, INVASION_PLANS_ITEM_ID)) player.getInventory().deleteNumber(INVASION_PLANS_ITEM_ID, 1);
    // Live fills the slots O, Z, T, U (capture t12117).
    for (const twig of TWIG_HANDOUT_ORDER) if (missing.includes(twig)) player.getInventory().adds(twig, 1);
    advance(player, STAGE_GIVEN_TWIGS);
  }

  /** The transcript's item hand-ins and stage directions. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId) return;

    if (npcId === NpcIdentifiers.FEMI && stepId === "CWsctI") {
      player.setAttribute(FEMI_HELPED_ATTRIBUTE, true);
      return;
    }

    if (event.kind === "message") {
      const box = boxFor(event.text);
      if (box) event.box = box;
      if (stepId === START_HANDOVER_MESSAGE_ID) {
        if (NARNODE_IDS.has(npcId)) startQuest(player);
        return;
      }
      if (stepId === HAZELMERE_EXAMINES_MESSAGE_ID) {
        // Capture t10574: the sample leaves the inventory and the stage moves on with this box.
        if (quest.getStage(player) >= STAGE_STARTED && quest.getStage(player) < STAGE_HAZELMERE) {
          if (has(player, BARK_SAMPLE_ITEM_ID)) player.getInventory().deleteNumber(BARK_SAMPLE_ITEM_ID, 1);
          advance(player, STAGE_HAZELMERE);
        }
        return;
      }
      if (stepId === HAZELMERE_SCROLL_MESSAGE_ID) {
        if (quest.getStage(player) >= STAGE_HAZELMERE) grant(player, HAZELMERES_SCROLL_ITEM_ID);
        return;
      }
      if (stepId === LUMBER_ORDER_MESSAGE_ID) {
        giveLumberOrder(player);
        return;
      }
      if (stepId === ANITA_KEY_MESSAGE_ID) {
        const stage = quest.getStage(player);
        if (stage >= STAGE_CHARLIE_CLUE && stage < STAGE_INVASION_PLANS) grant(player, GLOUGHS_KEY_ITEM_ID);
        return;
      }
      if (TWIGS_MESSAGE_IDS.has(stepId)) {
        giveTwigs(player);
        return;
      }
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
        if (player.getLocation().getZ() === 3 && CAPTAIN_ERRDO_IDS.has(npcId)) scenes.flyToKaramja(event);
        return;
      }
      return;
    }

    const stage = quest.getStage(player);
    if (NARNODE_IDS.has(npcId)) {
      if (stepId === FOUNDATIONS_ENTER_ACTION_ID && stage === STAGE_NOT_STARTED) {
        scenes.foundationsDown(event, event.npc, npcId);
        return;
      }
      if (FOUNDATIONS_RETURN_ACTION_IDS.has(stepId) && player.getLocation().isWithinDistance(at(FOUNDATIONS_LANDING), 3)) {
        scenes.foundationsUp(event, npcId);
        return;
      }
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (!NARNODE_IDS.has(npcId) || quest.isComplete(player)) return;
      if (stage < STAGE_SEARCHING_DACONIA || !has(player, DACONIA_ROCK_ITEM_ID)) return;
      player.getInventory().deleteNumber(DACONIA_ROCK_ITEM_ID, 1);
      quest.complete(player);
      return;
    }
    if (stepId === BARK_REPLACEMENT_ACTION_ID) {
      if (stage < STAGE_STARTED || stage >= STAGE_RELAYED_MESSAGE) return;
      grant(player, BARK_SAMPLE_ITEM_ID);
      return;
    }
    if (npcId === NpcIdentifiers.FOREMAN && stage === STAGE_RELEASED) {
      if (stepId === FOREMAN_OFFICE_ACTION_ID) {
        scenes.followForeman(event);
        return;
      }
      if (event.text === "The player is attacked by the Foreman.") {
        officeForemen.get(player)?.getCombat().attack(player);
        return;
      }
    }
    if (stepId === LUMBER_ORDER_BOX_ACTION_ID && NpcIdentifiers.FOREMAN === npcId) {
      // The transcript has the hand-over as a stage direction; live shows it as an object box (capture t11514).
      event.handled = true;
      event.steps = [{ type: "message", text: event.text, id: LUMBER_ORDER_MESSAGE_ID }];
      return;
    }
    if (stepId === LUMBER_ORDER_ACTION_ID) {
      removeOfficeForeman(player);
      return;
    }
    if (stepId === GUARD_APPEARS_ACTION_ID) {
      if (stage === STAGE_FOUND_JOURNAL && GLOUGH_IDS.has(npcId)) scenes.guardAppears(event);
      return;
    }
    if (stepId === ARREST_ACTION_ID) {
      if (stage === STAGE_FOUND_JOURNAL) scenes.escort(event);
      return;
    }
    if (stepId === PRISON_KING_ACTION_ID || stepId === RELEASE_ACTION_ID) {
      if (stage !== STAGE_FOUND_JOURNAL || !inCell(player)) return;
      if (stepId === PRISON_KING_ACTION_ID) scenes.kingAppears(event);
      else scenes.release(event);
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
      scenes.femiCart(event);
      return;
    }
    if (stepId === PASSWORD_CORRECT_ACTION_ID || stepId === PASSWORD_WRONG_ACTION_ID) {
      if (stage < STAGE_RELEASED || stage >= STAGE_LUMBER_ORDER) return;
      const correct = String(player.getAttribute(PASSWORD_ATTRIBUTE) ?? "") === CORRECT_PASSWORD;
      if (stepId === PASSWORD_CORRECT_ACTION_ID && correct) {
        crossShipyardGate(event);
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

  /** Animations and sounds the capture shows for the house's furniture, the pillars and the roots (ticks in the docs). */
  const OPEN_CUPBOARD_ANIMATION = 538;
  const OPEN_CHEST_ANIMATION = 536;
  const PLACE_ON_TABLE_ANIMATION = 832;
  const SEARCH_FLOOR_ANIMATION = 827;
  const CUPBOARD_OPEN_SOUND = 57; // cupboard_close: live plays it as the cupboard opens
  const CHEST_OPEN_SOUND = 58; // cupboard_open
  const PUT_DOWN_SOUND = 2739;
  const MACHINERY_SOUND = 1586;
  const TRAPDOOR_OPEN_SOUND = 91;
  /** Glough's chest shows open for these ticks, then closes again (capture t11989-11993). */
  const CHEST_OPEN_TICKS = 4;
  const GLOUGHS_CUPBOARD_CLOSED_ID = ObjectIdentifiers.CUPBOARD_14;
  const GLOUGHS_CUPBOARD_OPEN_ID = ObjectIdentifiers.CUPBOARD_15;
  const GLOUGHS_CHEST_OPEN_ID = GLOUGHS_CHEST_ID + 1; // 2437, the chest's nameless open form

  const sound = (player, id) => player.getPacketSender().sendSoundEffect(id, 1, 0);
  const animate = (player, id) => player.performAnimation(new api.core.Animation(id));
  const after = (player, ticks, callback) => {
    const task = new api.core.Task(ticks, player, false);
    task.execute = () => {
      task.stop();
      callback();
    };
    api.core.TaskManager.submit(task);
  };
  /** A loc put back after `ticks` for everyone, even if the player who opened it logs out. */
  const worldAfter = (ticks, callback) => api.core.TaskManager.submit(new api.core.CountdownTask({}, ticks, callback));

  /** The loc of `id` standing where `object` stood, if it still does. */
  function standing(id, object) {
    return api.core.MapObjects.get(id, object.getLocation(), object.getPrivateArea?.() ?? null) ?? null;
  }

  function replaceObject(object, id) {
    const location = object.getLocation();
    const replacement = new api.core.GameObject(id, new Location(location.getX(), location.getY(), location.getZ()),
      object.getType(), object.getFace(), object.getPrivateArea() ?? null);
    api.core.ObjectManager.deregister(object, true);
    api.core.ObjectManager.register(replacement, true);
    return replacement;
  }

  /** Open: the cupboard swings open a tick after the reach (capture t11116-11117); Search then looks inside. */
  function openCupboard(event) {
    if (event.objectId !== GLOUGHS_CUPBOARD_CLOSED_ID || !event.object) return false;
    const { player, object } = event;
    animate(player, OPEN_CUPBOARD_ANIMATION);
    sound(player, CUPBOARD_OPEN_SOUND);
    after(player, 1, () => {
      const current = standing(GLOUGHS_CUPBOARD_CLOSED_ID, object);
      if (current) replaceObject(current, GLOUGHS_CUPBOARD_OPEN_ID);
    });
    return true;
  }

  /** Ours: no capture closes it; it shuts without a sound. */
  function closeCupboard(event) {
    if (event.objectId !== GLOUGHS_CUPBOARD_OPEN_ID || !event.object) return false;
    replaceObject(event.object, GLOUGHS_CUPBOARD_CLOSED_ID);
    return true;
  }

  function searchCupboard(event) {
    if (event.objectId !== GLOUGHS_CUPBOARD_OPEN_ID) return false;
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
    // Capture t11119: the journal, varp 150 60 -> 70 and its object box on the click's tick.
    player.getInventory().adds(GLOUGHS_JOURNAL_ITEM_ID, 1);
    quest.setStage(player, STAGE_FOUND_JOURNAL);
    showBox(api, player, "You've found Glough's Journal!");
    return true;
  }

  /**
   * Glough's key opens the chest; the key stays in the inventory (the capture's player still banks it after the
   * quest). Capture t11988-11989: the reach and the chest's sound, then a tick later the open chest, the plans,
   * varp 150 100 -> 110 and the object box; the chest closes again 4 ticks later.
   */
  function openChest(event) {
    if (event.objectId !== GLOUGHS_CHEST_ID) return false;
    const player = event.player;
    if (has(player, INVASION_PLANS_ITEM_ID)) {
      player.sendMessage("The chest is empty.");
      return true;
    }
    const stage = quest.getStage(player);
    const recovering = stage >= STAGE_INVASION_PLANS;
    if (!recovering && (stage < STAGE_CHARLIE_CLUE || !has(player, GLOUGHS_KEY_ITEM_ID))) {
      player.sendMessage("The chest is locked. Glough's key should open it.");
      return true;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space to pick up the invasion plans.");
      return true;
    }
    animate(player, OPEN_CHEST_ANIMATION);
    sound(player, CHEST_OPEN_SOUND);
    after(player, 1, () => {
      if (has(player, INVASION_PLANS_ITEM_ID)) return;
      player.getInventory().adds(INVASION_PLANS_ITEM_ID, 1);
      advance(player, STAGE_INVASION_PLANS);
      const closed = event.object && standing(GLOUGHS_CHEST_ID, event.object);
      if (closed) {
        const opened = replaceObject(closed, GLOUGHS_CHEST_OPEN_ID);
        worldAfter(CHEST_OPEN_TICKS, () => {
          const still = standing(GLOUGHS_CHEST_OPEN_ID, opened);
          if (still) replaceObject(still, GLOUGHS_CHEST_ID);
        });
      }
      showBox(api, player, "You have found a scroll!");
    });
    return true;
  }

  function useKeyOnChest(event) {
    if (event.objectId !== GLOUGHS_CHEST_ID || event.itemId !== GLOUGHS_KEY_ITEM_ID) return;
    event.handled = true;
    openChest(event);
  }

  // Wiki (The Grand Tree): the watchtower tree "requires 25 Agility to climb", boostable (the current level counts).
  const WATCHTOWER_AGILITY = 25;

  function climbWatchtower(event) {
    if (event.objectId !== WATCHTOWER_TREE_ID) return false;
    if (event.player.getSkillManager().getCurrentLevel(Skill.AGILITY) < WATCHTOWER_AGILITY) {
      event.player.sendMessage(`You need an Agility level of ${WATCHTOWER_AGILITY} to climb this tree.`);
      return true;
    }
    api.emitCustomEvent("ladders:climbUp", {
      player: event.player,
      destination: at(WATCHTOWER_DESTINATION),
    });
    return true;
  }

  function clearPillarDisplays(player) {
    for (const display of pillarDisplays.get(player)?.values() ?? []) ItemOnGroundManager.deregister(display);
    pillarDisplays.delete(player);
  }

  function syncPillarDisplays({ player }) {
    const placed = Number(player.getAttribute(PILLARS_ATTRIBUTE)) || 0;
    const here = player.getLocation();
    if (!placed || quest.getStage(player) < STAGE_GIVEN_TWIGS || here.getZ() !== FIRST_PILLAR_TILE.z ||
      player.getPrivateArea() ||
      (here.getX() >> 6) !== (FIRST_PILLAR_TILE.x >> 6) ||
      (here.getY() >> 6) !== (FIRST_PILLAR_TILE.y >> 6)) {
      clearPillarDisplays(player);
      return;
    }
    const displays = pillarDisplays.get(player) ?? new Map();
    pillarDisplays.set(player, displays);
    [...PILLAR_TWIGS.values()].forEach((twig, index) => {
      if (!(placed & (1 << index)) || displays.has(twig)) return;
      // The pillar supports ground items, so the client puts the letter on its top.
      const tile = new Location(FIRST_PILLAR_TILE.x + index, FIRST_PILLAR_TILE.y, FIRST_PILLAR_TILE.z);
      const display = new ItemOnGround(
        GroundItemState.SEEN_BY_PLAYER, player.getUsername(), tile, new Item(twig, 1), false, -1, null, true,
        { id: twig, telegrabDenial: "The twig is fixed to the pillar." },
      ).setEnabledOps(0);
      displays.set(twig, display);
      ItemOnGroundManager.register(display);
    });
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
    if (!has(player, twig)) return;
    // Capture t12177-12203: each twig goes on its pillar with the reach and a put-down sound, no chat line. The
    // fourth also grinds the machinery, and a tick later the trapdoor snaps open in a message box.
    player.getInventory().deleteNumber(twig, 1);
    const next = placed | bit;
    player.setAttribute(PILLARS_ATTRIBUTE, next);
    syncPillarDisplays(event);
    animate(player, PLACE_ON_TABLE_ANIMATION);
    sound(player, PUT_DOWN_SOUND);
    if (next === ALL_PILLARS_PLACED) {
      sound(player, MACHINERY_SOUND);
      // Live sends varp 150 with the box a tick later; it is set on this tick so a logout in between cannot
      // save all four pillars filled at stage 120 (no twig could then go on again).
      quest.setStage(player, STAGE_TRAPDOOR);
      after(player, 1, () => {
        sound(player, TRAPDOOR_OPEN_SOUND);
        showBox(api, player, "With a grinding of machinery, a trapdoor snaps open!");
      });
    }
  }

  function blockBrokenCaveLadder(event) {
    const { x, y, z } = event.location;
    if (event.objectId !== BROKEN_CAVE_LADDER_ID || x !== 2492 || y !== 9864 || z !== 0 || event.option !== "climb-up") return;
    event.handled = true;
    event.player.sendMessage("The ladder is broken. You can't climb it.");
  }

  function climbDownTrapdoor(event) {
    if (!GLOUGHS_TRAPDOOR_IDS.has(event.objectId)) return false;
    const at = event.object?.getLocation?.();
    if (at && (at.getX() !== GLOUGHS_TRAPDOOR_TILE.x || at.getY() !== GLOUGHS_TRAPDOOR_TILE.y
      || at.getZ() !== GLOUGHS_TRAPDOOR_TILE.z)) return false;
    if (quest.getStage(event.player) < STAGE_TRAPDOOR) return false;
    event.handled = true;
    if (quest.getStage(event.player) === STAGE_TRAPDOOR) demonEncounter.start(event.player);
    else teleport(event.player, CAVE_DESTINATION);
    return true;
  }

  /** The roots in the cave under the Grand Tree, where the last Daconia rock can be. */
  const ROOT_AREA = { west: 2436, east: 2500, south: 9856, north: 9910, z: 0 };

  function cavernRoots() {
    const roots = [];
    for (let x = ROOT_AREA.west; x <= ROOT_AREA.east; x++) {
      for (let y = ROOT_AREA.south; y <= ROOT_AREA.north; y++) {
        for (const object of api.core.MapObjects.getObjectsAt(new Location(x, y, ROOT_AREA.z), null) ?? []) {
          if (ROOT_IDS.has(object.getId())) roots.push(`${x},${y}`);
        }
      }
    }
    return roots;
  }

  /**
   * Wiki (The Grand Tree, "The adamant king"): the rock "may be in any of the roots", and a lost rock "will spawn
   * in the root where you first found it". So each player's root is drawn once, from the cave's roots, and kept.
   */
  function daconiaRoot(player) {
    const kept = player.getAttribute(DACONIA_ROOT_ATTRIBUTE);
    if (typeof kept === "string" && kept) return kept;
    const roots = cavernRoots();
    if (!roots.length) return null;
    const root = roots[Math.floor(Math.random() * roots.length)];
    player.setAttribute(DACONIA_ROOT_ATTRIBUTE, root);
    return root;
  }

  /**
   * Capture t12583-12803: the player reaches down as they arrive and the answer comes a tick later; the rock's
   * object box shows first and the rock is only in the inventory once it is continued (Wiki: "Click continue once
   * you find it or it won't appear in your inventory").
   */
  function searchRoot(event) {
    if (!ROOT_IDS.has(event.objectId)) return false;
    const player = event.player;
    const { x, y } = event.location;
    animate(player, SEARCH_FLOOR_ANIMATION);
    after(player, 1, () => {
      const searching = quest.getStage(player) === STAGE_SEARCHING_DACONIA && !has(player, DACONIA_ROCK_ITEM_ID);
      if (!searching || daconiaRoot(player) !== `${x},${y}`) {
        player.sendMessage("You search the root but don't find anything.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("You need more inventory space to pick up the Daconia rock.");
        return;
      }
      showBox(api, player, "You've found a Daconia rock!", () => grant(player, DACONIA_ROCK_ITEM_ID));
    });
    return true;
  }

  function demonDefeated(player) {
    if (quest.getStage(player) === STAGE_TRAPDOOR) quest.setStage(player, STAGE_DEMON_DEFEATED);
  }

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (npcId === BLACK_DEMON_ID) {
      if (killer && quest.getStage(killer) === STAGE_TRAPDOOR) demonEncounter.defeat(killer, npc);
      return;
    }
    // The foreman can be killed for the lumber order instead of quizzed.
    if (npcId === NpcIdentifiers.FOREMAN && killer) {
      if (officeForemen.get(killer) === npc) officeForemen.delete(killer);
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
    demonEncounter.cancel(player);
    scenes.logout(player);
    clearPillarDisplays(player);
    removeOfficeForeman(player);
  }

  function handleLogin({ player }) {
    syncPillarDisplays({ player });
    refreshQuestList(player);
    if (quest.getStage(player) === STAGE_TRAPDOOR) demonEncounter.resume(player);
    if (quest.getStage(player) === STAGE_RELEASED && player.getLocation().isWithinDistance(at(SHIPYARD_OFFICE), 3)) {
      ensureOfficeForeman(player);
    }
  }

  quest = registerQuest(api, {
    combatNpcIds: () => [BLACK_DEMON_ID],
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
    // The scroll's lines as live writes them (capture local 1002189 t12894): no mine or spirit tree line.
    otherRewards: ["Gnome Glider Access"],
    buildJournal,
    onReward: grantReward,
  });

  ObstacleRunner.init(api);
  api.persistAttribute(PILLARS_ATTRIBUTE);
  api.persistAttribute(PASSWORD_ATTRIBUTE);
  api.persistAttribute(DACONIA_ROOT_ATTRIBUTE);
  api.persistAttribute(FEMI_HELPED_ATTRIBUTE, false);
  api.persistAttribute(FEMI_REFUSED_ATTRIBUTE, false);

  api.onNpcInteraction("Foreman", { "Talk-to": resumeOfficeQuiz });
  api.onNpcInteraction("Glough", { "Talk-to": holdDuringArrest });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", demonEncounter.handleLine);
  api.onCustomEvent("npc-dialogue:action", demonEncounter.handleAction);
  api.onCustomEvent("gnome-gliders:glider", fleeOnGlider);
  api.onObjectInteraction("Cupboard", { Open: openCupboard, Search: searchCupboard, Close: closeCupboard });
  api.onObjectInteraction("Closed chest", { Open: openChest });
  api.onItemOnObject(useKeyOnChest);
  api.onItemOnObject(placeTwig);
  api.onObjectInteraction("Tree", { "Climb-up": climbWatchtower });
  // Before the generic Ladders handler: a client may name the transformed 26243 loc, which
  // Ladders would otherwise climb into the cave without Glough's scene.
  api.onBeforeObjectInteraction(climbDownTrapdoor);
  api.onObjectInteraction("Trapdoor", { "Climb-down": climbDownTrapdoor });
  api.onBeforeObjectInteraction(blockBrokenCaveLadder);
  api.onBeforeObjectInteraction(askShipyardPassword);
  api.onObjectInteraction("Root", { Search: searchRoot });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerMapSquareChange(syncPillarDisplays);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
