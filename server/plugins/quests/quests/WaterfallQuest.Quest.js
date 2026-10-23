/**
 * Waterfall Quest (members).
 *
 * Route and ids cross-checked against RuneLite Quest Helper
 * (Zoinkwiz/quest-helper @ 06da90f, WaterfallQuest.java) and the OSRS Wiki,
 * with the transcript words from the "Waterfall Quest" page. The cache supplies
 * the object/item ids; the varp is 65 "waterfall_quest".
 *
 * Stages (varp 65):
 *   0 not started, 1 started (Almera), 2 finished talking to Hudon, 3 read the
 *   Book on Baxtorian, 4 used the pebble and entered Glarial's tomb, 5 entered
 *   the waterfall dungeon, 6 unlocked the Baxtorian door, 8 placed Glarial's
 *   amulet on the statue (floor raised), 10 complete. The captured varp moves
 *   1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 8 -> 10 (WaterfallQuest.bin).
 *
 * The whole mandatory route is modelled: the log raft to Hudon, swimming or the
 * roped rock/dead tree/barrel back downstream, the Hadley bookcase and reading
 * the book, the Tree Gnome Village key/gate/Golrie, Glarial's tombstone and its
 * restricted-items rule, the tomb chest and coffin, the waterfall ledge door
 * (amulet equipped), the dungeon crate key and locked doors, the six pillars,
 * the statue, and Glarial's urn on the Chalice of Eternity.
 *
 * The decoded WaterfallQuest.bin capture confirms the varp transitions above,
 * the exact landings (tomb -2555,9844; waterfall dungeon -2575,9861; the raised
 * statue floor teleports to -2603,9914), the kept dungeon key, the empty urn,
 * the reward items/XP and completion jingle 154. Remaining evidence gap: the
 * captured route only shows one flood failure and does not prove every alternate
 * branch (e.g. a second failed statue use), which use the transcript text.
 *
 * Travel beats use the captured fade overlay 174/script 948 and messagebox 229
 * through QuestScenes (audit-4 finding 6). The capture has no camera tracks, so
 * this file deliberately adds no camera moves or shakes.
 */
module.exports = function registerWaterfallQuest(api) {
  const {
    ActionDialogue, DialogueChainBuilder, Equipment, Item, ItemDefinition, ItemIdentifiers,
    ItemStatementDialogue, Location, NpcIdentifiers, Skill, StatementDialogue,
  } = api.core;
  const { openBook, registerQuest } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  const ALMERA_NPC_ID = NpcIdentifiers.ALMERA;
  const HUDON_NPC_ID = NpcIdentifiers.HUDON;
  const HADLEY_NPC_ID = NpcIdentifiers.HADLEY;
  const GERALD_NPC_ID = NpcIdentifiers.GERALD;
  const GOLRIE_NPC_ID = NpcIdentifiers.GOLRIE_2;
  const GOLRIE_IDS = new Set([NpcIdentifiers.GOLRIE, GOLRIE_NPC_ID]);

  const VARP_WATERFALL_QUEST = 65;
  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_HUDON = 2;
  const STAGE_READ_BOOK = 3;
  const STAGE_ENTERED_TOMB = 4;
  const STAGE_ENTERED_DUNGEON = 5;
  const STAGE_OPENED_BAXTORIAN_DOOR = 6;
  const STAGE_PLACED_AMULET = 8;
  const STAGE_COMPLETE = 10;

  const BOOK_ON_BAXTORIAN_ITEM_ID = ItemIdentifiers.BOOK_ON_BAXTORIAN;
  const GOLRIE_KEY_ITEM_ID = ItemIdentifiers.KEY_17;
  const BAXTORIAN_KEY_ITEM_ID = ItemIdentifiers.KEY_18;
  const GLARIALS_PEBBLE_ITEM_ID = ItemIdentifiers.GLARIALS_PEBBLE;
  const GLARIALS_AMULET_ITEM_ID = ItemIdentifiers.GLARIALS_AMULET;
  const GLARIALS_URN_ITEM_ID = ItemIdentifiers.GLARIALS_URN;
  const GLARIALS_URN_EMPTY_ITEM_ID = ItemIdentifiers.GLARIALS_URN_EMPTY_;
  const AIR_RUNE_ITEM_ID = ItemIdentifiers.AIR_RUNE;
  const WATER_RUNE_ITEM_ID = ItemIdentifiers.WATER_RUNE;
  const EARTH_RUNE_ITEM_ID = ItemIdentifiers.EARTH_RUNE;
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE;
  const DIAMOND_ITEM_ID = ItemIdentifiers.DIAMOND;
  const GOLD_BAR_ITEM_ID = ItemIdentifiers.GOLD_BAR;
  const MITHRIL_SEEDS_ITEM_ID = ItemIdentifiers.MITHRIL_SEEDS;

  // Cache gamevals (lodestone names in parentheses).
  const LOG_RAFT_ID = 1987; // lograft_waterfall_quest
  const BOOKCASE_ID = 1989; // bookcase_waterfall_quest
  const GOLRIE_CRATE_ID = 1990; // golrie_crate_waterfall_quest
  const GOLRIE_GATE_ID = 1991; // golrie_gate_waterfall_quest
  const GLARIALS_TOMBSTONE_ID = 1992; // glarials_tombstone_waterfall_quest
  const GLARIALS_TOMB_ID = 1993; // glarials_tomb_waterfall_quest
  const GLARIALS_CHEST_ID = 1994; // glarials_chest_closed_waterfall_quest
  const CROSSING_ROCK_ID = 1996; // crossing_rock_waterfall_quest
  const CROSSING_ROCK_ROPED_ID = 1997; // crossing_rock_roped_waterfall_quest
  const CROSSING_ROCK_IDS = new Set([CROSSING_ROCK_ID, CROSSING_ROCK_ROPED_ID]);
  const CROSSING_ROPE_ID = 1998; // crossing_rope_waterfall_quest
  const WATERFALL_SWIM_POINT_ID = 10283; // waterfall_swim_point (River "Swim")
  const BAXTORIAN_CRATE_ID = 1999; // baxtorian_crate_waterfall_quest
  const BAXTORIAN_DOOR_ID = 2002; // baxtorian_door_2_waterfall_quest
  const PILLAR_ID = 2005; // stonepillar_small_waterfall_quest
  const STATUE_ID = 2006; // statue_queen_waterfall_quest
  const WATERFALL_DOOR_ID = 2010; // waterfall_ledge_door
  const CHALICE_ID = 2014; // baxtorian_chalice_waterfall_quest
  const DEAD_TREE_ID = 2020; // overhanging_tree1_waterfall_quest
  const BARREL_ID = 2022; // barrel_waterfall_quest

  // Quest Helper's live conversation flags.
  const GERALD_CHAT_VARBIT = 9108; // waterfall_gerald_chat
  const HADLEY_CHAT_VARBIT = 9109; // waterfall_hadley_chat
  const GOLRIE_CHAT_VARBIT = 9110; // waterfall_golrie_chat

  // Arrival points from the cache map placements.
  const HUDON_ISLAND = new Location(2512, 3481, 0);
  const ROCK_ROUTE_TILE = new Location(2512, 3476, 0);
  const SWIM_ROUTE_TILE = new Location(2511, 3477, 0);
  // Captured/Song of the Elves route: the tree is used from this diagonal tile,
  // not 2512,3466 (the rock blocks the straight approach).
  const DEAD_TREE_ROUTE_TILE = new Location(2513, 3466, 0);
  const CROSSING_ROPE_TILES = [3469, 3470, 3471, 3472, 3473, 3474, 3475];
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
  const CROSSING_PATH_SOUTH = [
    [2512, 3476], [2512, 3475], [2512, 3474], [2512, 3473], [2512, 3472],
    [2512, 3471], [2512, 3470], [2512, 3469], [2513, 3468], [2513, 3467], [2513, 3466],
  ];
  const CROSSING_PATH_NORTH = [
    [2513, 3467], [2513, 3468], [2512, 3469], [2512, 3470], [2512, 3471],
    [2512, 3472], [2512, 3473], [2512, 3474], [2512, 3475], [2512, 3476],
  ];
  const WATERFALL_LEDGE = new Location(2511, 3463, 0);
  const DOWNSTREAM_SHORE = new Location(2527, 3413, 0);
  const TOMB_LANDING = new Location(2555, 9844, 0);
  const WATERFALL_DUNGEON_LANDING = new Location(2575, 9861, 0);

  // Six pillars, each needing one air, water and earth rune.
  const RUNE_TYPES = [AIR_RUNE_ITEM_ID, WATER_RUNE_ITEM_ID, EARTH_RUNE_ITEM_ID];
  const PILLARS = 6;
  const ALL_PILLARS_MASK = (1 << (PILLARS * RUNE_TYPES.length)) - 1;
  const PILLAR_PLACEMENTS = [
    { minX: 2562, maxX: 2569, minY: 9910 },
    { minX: 2600, maxX: 2607, minY: 9909 },
    { minX: 2536, maxX: 2543, minY: 9909 },
  ];

  // Rewards (OSRS Wiki/Quest Helper).
  const ATTACK_XP = 13750;
  const STRENGTH_XP = 13750;

  /** Book on Baxtorian spread, transcribed from WaterfallQuest.bin. */
  const BOOK_PAGES = [{
    ...Object.fromEntries([
      "<u>The Missing Relics</u>",
      "",
      "Many artefacts of elven",
      "history were lost after the",
      "Fourth Age, following the",
      "departure of the elves from",
      "these lands. The greatest loss",
      "to our collections of elf",
      "history were the hidden",
      "treasures of Baxtorian.",
      "",
      "Some believe these treasures",
      "are still unclaimed, but it is",
      "more commonly believed that",
      "dwarf miners recovered them",
    ].map((line, index) => [44 + index, line])),
    ...Object.fromEntries([
      "early in the Fifth Age.",
      "",
      "Another great loss was",
      "Glarial's pebble, a key which",
      "allowed her family to visit her",
      "tomb. The pebble was taken",
      "by a gnome family over a",
      "century ago. It is hoped that",
      "descendants of that gnome",
      "may still have the pebble",
      "hidden in their cave under",
      "the Tree Gnome Village.",
      "", "", "",
    ].map((line, index) => [60 + index, line])),
  }];

  const PILLARS_ATTRIBUTE = "waterfall-quest:pillars";
  const BAXTORIAN_DOOR_ATTRIBUTE = "waterfall-quest:baxtorian-door";
  const GOLRIE_GATE_ATTRIBUTE = "waterfall-quest:golrie-gate";
  const TOMBSTONE_OPEN_ATTRIBUTE = "waterfall-quest:tombstone-open";
  const ROPE_ON_TREE_ATTRIBUTE = "waterfall-quest:rope-on-tree";
  const GOT_PEBBLE_ATTRIBUTE = "waterfall-quest:got-pebble";
  const GERALD_MET_ATTRIBUTE = "waterfall-quest:gerald-met";
  const HADLEY_MET_ATTRIBUTE = "waterfall-quest:hadley-met";
  const VERSION_ATTRIBUTE = "waterfall-quest:version";
  const VERSION = 1;
  const START_HOOK = "quest:waterfall-quest:start";

  const TOMB_RESTRICTED_SLOTS = new Set([0, 1, 3, 4, 5, 7, 9, 10, 13]);

  let quest;

  const hasItem = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasBook = (player) => hasItem(player, BOOK_ON_BAXTORIAN_ITEM_ID);
  const hasPebble = (player) => hasItem(player, GLARIALS_PEBBLE_ITEM_ID);
  const hasAmulet = (player) => hasItem(player, GLARIALS_AMULET_ITEM_ID);
  const hasUrn = (player) => hasItem(player, GLARIALS_URN_ITEM_ID);
  const wearingAmulet = (player) => {
    const item = player.getEquipment?.().get?.(Equipment.AMULET_SLOT);
    return item?.getId?.() === GLARIALS_AMULET_ITEM_ID;
  };
  const stageOf = (player) => quest.getStage(player);
  const flag = (player, key) => Number(player.getAttribute(key)) || 0;
  const setFlag = (player, key, value = 1) => player.setAttribute(key, value | 0);

  function isDisallowedTombItem(item) {
    const id = item?.getId?.();
    if (!id || id <= 0) return false;
    const definition = ItemDefinition.forId(id);
    if (!definition) return false;
    const slot = definition.getEquipmentType?.().getSlot?.();
    if (TOMB_RESTRICTED_SLOTS.has(slot)) return true;
    const name = String(definition.getName?.() ?? "").toLowerCase();
    return name.endsWith(" rune") || name.endsWith(" runes") || name.endsWith("logs");
  }

  /** Inventory and worn equipment share the same cache-backed restriction. */
  function hasDisallowedTombItem(player) {
    for (const item of player.getInventory().getItems()) {
      if (isDisallowedTombItem(item)) return true;
    }
    for (const item of player.getEquipment?.().getItems?.() ?? []) {
      if (isDisallowedTombItem(item)) return true;
    }
    return false;
  }

  function pillarMask(player) {
    return Number(player.getAttribute(PILLARS_ATTRIBUTE)) | 0;
  }

  function pillarIndex(location) {
    if (!location) return -1;
    for (const room of PILLAR_PLACEMENTS) {
      if (location.y < room.minY || location.y > room.minY + 4) continue;
      if (location.x !== room.minX && location.x !== room.maxX) continue;
      const column = location.x === room.maxX ? 3 : 0;
      return column + Math.floor((location.y - room.minY) / 2);
    }
    return -1;
  }

  function runeBit(location, runeId) {
    const index = pillarIndex(location);
    const rune = RUNE_TYPES.indexOf(runeId);
    if (index < 0 || rune < 0) return -1;
    return 1 << (index * RUNE_TYPES.length + rune);
  }

  function allRunesPlaced(player) {
    return (pillarMask(player) & ALL_PILLARS_MASK) === ALL_PILLARS_MASK;
  }

  /**
   * Old saves used 4 for "has the pebble" and 5 for "has both relics"; the capture
   * shows 4 is tomb entry and 5 is dungeon entry. Old 8 had already consumed both
   * relics on the statue.
   */
  function migrate(player) {
    if (Number(player.getAttribute(VERSION_ATTRIBUTE)) === VERSION) return;
    player.setAttribute(VERSION_ATTRIBUTE, VERSION);
    const stage = stageOf(player);
    if (stage === STAGE_ENTERED_TOMB) {
      setFlag(player, GOT_PEBBLE_ATTRIBUTE);
      quest.setStage(player, STAGE_READ_BOOK);
    } else if (stage === STAGE_ENTERED_DUNGEON) {
      // Old stage 5 meant the player already had both relics; open the dungeon
      // route by leaving them at the book-read stage with both items held.
      quest.setStage(player, STAGE_READ_BOOK);
    } else if (stage === STAGE_PLACED_AMULET && !hasUrn(player)) {
      // The old plugin consumed the amulet and urn at the statue; reopen the tomb
      // so the player can fetch a replacement pair instead of being stranded.
      setFlag(player, TOMBSTONE_OPEN_ATTRIBUTE);
      quest.setStage(player, STAGE_READ_BOOK);
    }
  }

  function sendWaterfallVarbits(eventOrPlayer) {
    const player = eventOrPlayer?.player ?? eventOrPlayer;
    migrate(player);
    const stage = stageOf(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(GERALD_CHAT_VARBIT, flag(player, GERALD_MET_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(HADLEY_CHAT_VARBIT, flag(player, HADLEY_MET_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(GOLRIE_CHAT_VARBIT, flag(player, GOT_PEBBLE_ATTRIBUTE) ? 1 : 0);
  }

  // Journal text transcribed from WaterfallQuest.bin. Completed sections are
  // struck through, the current section is blue, as the client shows them.
  const JOURNAL = {
    almeraStart: [
      "I spoke to Almera in her home next to Baxtorian Falls. She",
      "asked me to check on her son, Hudon, who has been searching",
      "for treasure near Baxtorian Falls. I can use the raft behind",
      "Almera's house to get down the river.",
    ],
    almeraDone: [
      "I spoke to Almera in her home next to Baxtorian Falls. She",
      "asked me to check on her son, Hudon, who has been searching",
      "for treasure near Baxtorian Falls.",
    ],
    hudonDone: [
      "I found Hudon down the river from Almera's house. He was",
      "convinced that there was some treasure hidden nearby.",
    ],
    bookDone: [
      "I found a book in the nearby tourist office. The book detailed",
      "the sad story of Baxtorian and Glarial, two elves that once",
      "ruled the area around Baxtorian Falls. According to the book,",
      "Baxtorian and Glarial were the only ones able to enter the",
      "waterfall but Baxtorian sealed himself inside after Glarial's",
      "apparent death. The book also mentioned that Glarial herself",
      "is buried near the waterfall, and that the key to her tomb,",
      "Glarial's Pebble, was taken by gnomes and hidden beneath",
      "Tree Gnome Village.",
    ],
    pebbleDone: [
      "I recovered Glarial's Pebble from beneath Tree Gnome Village",
      "and used it to enter her tomb.",
    ],
    amuletDone: [
      "I found Glarial's Amulet within her tomb and used it to enter",
      "Baxtorian Falls.",
    ],
    chaliceFloat: [
      "I found a Chalice within Baxtorian Falls which looks like it",
      "contains Baxtorian's Treasure. However, it is floating out of",
      "reach. I'll need to work out how to get to it.",
    ],
    chaliceRaised: [
      "I found a Chalice within Baxtorian Falls which looks like it",
      "contains Baxtorian's Treasure. The Chalice was floating out of",
      "reach but I worked out how to raise the floor to get to it. Now I",
      "just need to retrieve the treasure from it.",
    ],
    treasure: [
      "I found a Chalice within Baxtorian Falls which contained",
      "Baxtorian's Treasure. The Chalice was floating out of reach",
      "but I worked out how to raise the floor to get to it. I then",
      "managed to obtain the treasure by swapping it for Glarial's",
      "Ashes.",
    ],
  };
  const currentSection = (lines) => lines.map((line) => `<col=000080>${line}`);
  const completedSection = (lines) => lines.map((line) => `<str>${line}`);

  function buildJournal(player) {
    const stage = stageOf(player);
    const lines = [];
    if (stage >= STAGE_COMPLETE) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...completedSection(JOURNAL.hudonDone),
        ...completedSection(JOURNAL.bookDone), ...completedSection(JOURNAL.pebbleDone),
        ...completedSection(JOURNAL.amuletDone), ...completedSection(JOURNAL.treasure), "", "<col=ff0000>QUEST COMPLETE!</col>");
      return lines;
    }
    if (stage >= STAGE_PLACED_AMULET) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...completedSection(JOURNAL.hudonDone),
        ...completedSection(JOURNAL.bookDone), ...completedSection(JOURNAL.pebbleDone),
        ...completedSection(JOURNAL.amuletDone), ...currentSection(JOURNAL.chaliceRaised));
      return lines;
    }
    if (stage >= STAGE_OPENED_BAXTORIAN_DOOR) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...completedSection(JOURNAL.hudonDone),
        ...completedSection(JOURNAL.bookDone), ...completedSection(JOURNAL.pebbleDone),
        ...completedSection(JOURNAL.amuletDone), ...currentSection(JOURNAL.chaliceFloat));
      return lines;
    }
    if (stage >= STAGE_ENTERED_DUNGEON) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...completedSection(JOURNAL.hudonDone),
        ...completedSection(JOURNAL.bookDone), ...completedSection(JOURNAL.pebbleDone),
        ...currentSection(JOURNAL.amuletDone));
      return lines;
    }
    if (stage >= STAGE_ENTERED_TOMB) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...completedSection(JOURNAL.hudonDone),
        ...completedSection(JOURNAL.bookDone), ...currentSection(JOURNAL.pebbleDone));
      return lines;
    }
    if (stage >= STAGE_READ_BOOK) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...completedSection(JOURNAL.hudonDone),
        ...currentSection(JOURNAL.bookDone));
      return lines;
    }
    if (stage >= STAGE_SPOKEN_HUDON) {
      lines.push(...completedSection(JOURNAL.almeraDone), ...currentSection(JOURNAL.hudonDone));
      return lines;
    }
    if (stage >= STAGE_STARTED) return currentSection(JOURNAL.almeraStart);
    return ["I can start this quest by speaking to", "<col=800000>Almera</col> beside Baxtorian Falls."];
  }

  /** Reward extras use the engine's drop-at-reward-tile overflow, never a pending bag. */
  function giveReward(inventory, player, itemId, amount) {
    if (ItemDefinition.forId(itemId)?.isStackable?.()) {
      inventory.forceAdd(player, new Item(itemId, amount));
      return;
    }
    for (let i = 0; i < amount; i++) inventory.forceAdd(player, new Item(itemId, 1));
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, ATTACK_XP);
    player.getSkillManager().addExperiences(Skill.STRENGTH, STRENGTH_XP);
    const inventory = player.getInventory();
    giveReward(inventory, player, DIAMOND_ITEM_ID, 2);
    giveReward(inventory, player, GOLD_BAR_ITEM_ID, 2);
    giveReward(inventory, player, MITHRIL_SEEDS_ITEM_ID, 40);
  }

  function floodDownstream(player, lines) {
    const last = lines[lines.length - 1];
    for (const line of lines.slice(0, -1)) player.sendMessage(line);
    travel(player, last, last, DOWNSTREAM_SHORE);
  }

  function showItemMessage(player, itemId, text) {
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text))
    );
  }

  /** A captured messagebox (229) whose continue runs `onContinue`. */
  function showStatement(player, text, onContinue) {
    const chain = new DialogueChainBuilder();
    chain.add(new StatementDialogue(0, text));
    chain.add(new ActionDialogue(1, { execute: () => {
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      onContinue?.();
    } }));
    player.getDialogueManager().startDialogues(chain);
  }

  /**
   * Captured travel beat: fade out (overlay 174/script 948), a first messagebox
   * with no continue, then the teleport, fade in and the same/last messagebox
   * with a continue. No camera moves are invented.
   */
  function travel(player, first, second, destination, onArrive) {
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.fade(player, true);
    StatementDialogue.send(player, first, false);
    Scenes.later(player, 2, () => {
      player.moveTo(destination);
      Scenes.fade(player, false);
      showStatement(player, second, () => {
        player.getMovementQueue().setBlockMovement(false);
        Scenes.closeFade(player);
        onArrive?.();
      });
    });
  }

  const crossingRopes = new WeakMap();
  const crossingMoves = new WeakMap();

  /** Restore any existing ignore-clipping state; never leave free water walking. */
  function finishCrossingMove(player) {
    const state = crossingMoves.get(player);
    if (!state) return;
    crossingMoves.delete(player);
    if (state.previous) player.setFlag(IGNORE_CLIPPING_FLAG, true);
    else player.removeFlag(IGNORE_CLIPPING_FLAG);
  }

  /**
   * Queues the remaining capture path from the player's exact tile. The item-use
   * walkToTile callback resets the movement queue after the handler returns, so
   * the first poll re-queues the leg if that reset erased it; a normal walk or
   * logout already cleared this state, so it is never re-added after cancelling.
   */
  function queueCrossingPath(player, path) {
    const here = player.getLocation();
    let start = path.findIndex(([x, y]) => x === here.getX() && y === here.getY());
    if (start < 0) start = 0;
    const queue = player.getMovementQueue();
    for (let i = start; i < path.length; i++) {
      queue.addSteps(new Location(path[i][0], path[i][1], here.getZ()));
    }
  }

  /** Ends the scoped flag as soon as the queued crossing has no steps left. */
  function pollCrossingMove(player, token, ticks) {
    const state = crossingMoves.get(player);
    if (state?.token !== token) return;
    const queue = player.getMovementQueue();
    const here = player.getLocation();
    const [endX, endY] = state.path[state.path.length - 1];
    const arrived = here.getX() === endX && here.getY() === endY;
    if (queue.points?.length === 0 && !arrived && ticks > 0) {
      queueCrossingPath(player, state.path);
    }
    if (queue.points?.length === 0 || ticks <= 0) {
      finishCrossingMove(player);
      return;
    }
    Scenes.later(player, 1, () => pollCrossingMove(player, token, ticks - 1));
  }

  /** Cache 241 floors block the crossing; this flag is scoped to these steps only. */
  function walkCrossing(player, path) {
    finishCrossingMove(player);
    const previous = player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true;
    const token = {};
    crossingMoves.set(player, { previous, token, path });
    player.setFlag(IGNORE_CLIPPING_FLAG, true);
    queueCrossingPath(player, path);
    // Clear on true path completion, with a bounded fallback and interaction cleanup.
    pollCrossingMove(player, token, path.length + 6);
  }

  /** Any ordinary walk request cancels the scoped crossing movement. */
  function cancelCrossingWalk(event) {
    finishCrossingMove(event.player);
  }

  /** Remove this player's owned crossing scenery; the global map rock 1996 stays. */
  function clearCrossingRope(player) {
    finishCrossingMove(player);
    const state = crossingRopes.get(player);
    if (!state) return;
    crossingRopes.delete(player);
    const { ObjectManager } = api.core;
    ObjectManager.deregister(state.ropedRock, true);
    for (const rope of state.ropes) ObjectManager.deregister(rope, true);
  }

  /**
   * The capture swaps the rock for 1997 and adds seven 1998 rope pieces. These
   * are personal objects owned by the player (the canonical
   * `new GameObject(...).setOwner(player)` pattern), so one player's crossing
   * cannot overwrite another's. All three cache locs are type 10, rotation 2 and
   * clipType 0: registration is for client visibility/owned click identity, not
   * for collision. The global 1996 map anchor is never deregistered.
   */
  function showCrossingRope(player) {
    if (crossingRopes.has(player)) return;
    const { GameObject, ObjectManager, Location } = api.core;
    const rockLocation = new Location(2512, 3468, 0);
    const ropedRock = new GameObject(CROSSING_ROCK_ROPED_ID, rockLocation, 10, 2, null).setOwner(player);
    ObjectManager.register(ropedRock, true);
    const ropes = CROSSING_ROPE_TILES.map((y) =>
      new GameObject(CROSSING_ROPE_ID, new Location(2512, y, 0), 10, 2, null).setOwner(player));
    for (const rope of ropes) ObjectManager.register(rope, true);
    crossingRopes.set(player, { ropedRock, ropes });
    Scenes.later(player, 40, () => clearCrossingRope(player));
  }

  // --------------------------------------------------------------------------
  // Dialogue
  // --------------------------------------------------------------------------

  function almeraVariant(stage) {
    if (stage >= STAGE_ENTERED_TOMB) return "obtaining-the-pebble-talking-to-almera-after-visiting-glarial-s-tomb";
    if (stage >= STAGE_READ_BOOK) return "starting-out-talking-to-almera-after-reading-the-book";
    if (stage >= STAGE_SPOKEN_HUDON) return "starting-out-talking-to-almera-after-talking-to-hudon";
    if (stage >= STAGE_STARTED) return "starting-out-talking-to-almera-talking-to-almera-again";
    return "starting-out-talking-to-almera";
  }

  function hudonVariant(stage) {
    if (stage >= STAGE_COMPLETE) {
      return { page: "Hudon", variant: "standard-dialogue-after-the-completion-of-waterfall-quest" };
    }
    if (stage >= STAGE_ENTERED_DUNGEON) return "accessing-the-waterfall-dungeon-talking-to-hudon-after-discovering-the-chalice";
    if (stage >= STAGE_ENTERED_TOMB) return "obtaining-the-pebble-talking-to-hudon-after-visiting-glarial-s-tomb";
    if (stage >= STAGE_READ_BOOK) return "starting-out-talking-to-hudon-after-reading-the-book";
    if (stage >= STAGE_SPOKEN_HUDON) return "starting-out-talking-to-hudon-again";
    if (stage >= STAGE_STARTED) return "starting-out-using-the-raft";
    return null;
  }

  function geraldVariant(player, stage) {
    if (stage < STAGE_SPOKEN_HUDON) return null;
    if (!flag(player, GERALD_MET_ATTRIBUTE)) return "starting-out-getting-washed-down-the-waterfall-after-talking-to-hudon";
    return "starting-out-talking-to-gerald-again-before-learning-about-the-treasure";
  }

  function golrieVariant(stage, player) {
    if (stage < STAGE_READ_BOOK) return null;
    if (flag(player, GOT_PEBBLE_ATTRIBUTE)) return "obtaining-the-pebble-talking-to-golrie-talking-to-golrie-again-without-the-pebble";
    return "obtaining-the-pebble-talking-to-golrie";
  }

  function selectVariant({ npcId, player }) {
    const stage = stageOf(player);
    if (npcId === ALMERA_NPC_ID) return almeraVariant(stage);
    if (npcId === HUDON_NPC_ID) return hudonVariant(stage);
    if (npcId === HADLEY_NPC_ID) return "starting-out-talking-to-hadley";
    if (npcId === GERALD_NPC_ID) return geraldVariant(player, stage);
    if (GOLRIE_IDS.has(npcId)) return golrieVariant(stage, player);
    return null;
  }

  function answerCondition({ player, npcId, text }) {
    const knownNpc = [ALMERA_NPC_ID, HUDON_NPC_ID, HADLEY_NPC_ID, GERALD_NPC_ID].includes(npcId)
      || GOLRIE_IDS.has(npcId);
    if (!knownNpc) return null;
    const value = String(text ?? "").toLowerCase();
    if (value.includes("combat level lower than 25")) {
      const skills = player.getSkillManager();
      const combat = typeof skills.getCombatLevel === "function" ? skills.getCombatLevel() : 999;
      return combat < 25;
    }
    if (value.includes("doesn't have the book") || value.includes("does not have the book")) return !hasBook(player);
    if (value.includes("already has the book") || value.includes("has the book")) return hasBook(player);
    if (value.includes("no inventory space")) return player.getInventory().isFull();
    if (value.includes("doesn't have the key") || value.includes("does not have the key")) {
      return !hasItem(player, GOLRIE_KEY_ITEM_ID);
    }
    if (value.includes("has the key")) return hasItem(player, GOLRIE_KEY_ITEM_ID);
    if (value.includes("does not have glarial's amulet")) return !hasAmulet(player);
    if (value.includes("already has glarial's amulet")) return hasAmulet(player);
    if (value.includes("does not have glarial's urn")) return !hasUrn(player);
    if (value.includes("already has glarial's urn")) return hasUrn(player);
    if (value.includes("wearing glarial's amulet")) return wearingAmulet(player);
    if (value.includes("not wearing glarial's amulet")) return !wearingAmulet(player);
    if (value.includes("no disallowed items")) return !hasDisallowedTombItem(player);
    if (value.includes("disallowed items")) return hasDisallowedTombItem(player);
    if (value.includes("not yet placed all the runes")) return !allRunesPlaced(player);
    if (value.includes("placed all the runes")) return allRunesPlaced(player);
    return null;
  }

  function widenHudonTalkRange(request) {
    if (request.clickType === 0) return;
    finishCrossingMove(request.player);
    if (request.npcId === HUDON_NPC_ID && stageOf(request.player) === STAGE_STARTED) request.range = 4;
  }

  /** A logout during a scripted travel must not leave the player movement-locked. */
  function handleLogout({ player }) {
    Scenes.cancel(player);
    clearCrossingRope(player);
    player.getMovementQueue().setBlockMovement(false);
    Scenes.closeFade(player);
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== ALMERA_NPC_ID || hook !== START_HOOK) return;
    if (stageOf(player) < STAGE_STARTED) {
      quest.setStage(player, STAGE_STARTED);
      player.sendMessage("You've started a new quest: <col=081190>Waterfall Quest</col>");
    }
  }

  function handleLine(request) {
    const { player, npcId } = request;
    const text = String(request.text ?? "");
    if (npcId === HUDON_NPC_ID && text.includes("I'm fine alone")) {
      request.after = () => {
        if (stageOf(player) === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_HUDON);
      };
      return;
    }
    if (npcId === GERALD_NPC_ID) {
      setFlag(player, GERALD_MET_ATTRIBUTE);
      return;
    }
    if (npcId === HADLEY_NPC_ID) {
      if (!flag(player, HADLEY_MET_ATTRIBUTE)) {
        setFlag(player, HADLEY_MET_ATTRIBUTE);
        sendWaterfallVarbits(player);
      }
    }
  }

  /** Message steps in the Waterfall transcript that carry item/state changes. */
  function handleAction(event) {
    const { player } = event;
    const stage = stageOf(player);
    switch (event.stepId) {
      case "2-d8NO": // Golrie's junk pile: first pebble
      case "rXLNXI": { // Golrie again: reclaim
        if (stage >= STAGE_READ_BOOK && !hasPebble(player)) {
          if (!player.getInventory().isFull()) {
            player.getInventory().adds(GLARIALS_PEBBLE_ITEM_ID, 1);
            event.box = { items: [GLARIALS_PEBBLE_ITEM_ID] };
            setFlag(player, GOT_PEBBLE_ATTRIBUTE);
            sendWaterfallVarbits(player);
          }
        }
        break;
      }
      case "2HNViG": // You give Golrie the key.
        if (hasItem(player, GOLRIE_KEY_ITEM_ID)) {
          player.getInventory().deleteNumber(GOLRIE_KEY_ITEM_ID, 1);
          event.box = { items: [GOLRIE_KEY_ITEM_ID] };
        }
        break;
      case "LNQqz6": // Pebble found but no room.
        break;
      default:
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Items and world interactions
  // --------------------------------------------------------------------------

  function readBook({ player, itemId }) {
    if (itemId !== BOOK_ON_BAXTORIAN_ITEM_ID) return;
    if (stageOf(player) < STAGE_SPOKEN_HUDON) {
      player.sendMessage("The book is difficult to read right now.");
      return;
    }
    if (stageOf(player) < STAGE_READ_BOOK) quest.setStage(player, STAGE_READ_BOOK);
    openBook(player, "Book on Baxtorian", BOOK_PAGES);
  }

  function boardRaft({ player }) {
    if (stageOf(player) < STAGE_STARTED) {
      player.sendMessage("You're not sure if the raft is safe to use. Best to leave it alone.");
      return;
    }
    const firstTrip = stageOf(player) === STAGE_STARTED;
    travel(player, "You board the small raft and push off down stream...", "...you crash into a small island.", HUDON_ISLAND, firstTrip
      ? () => api.emitCustomEvent("npc-dialogue:start", {
          player,
          npcId: HUDON_NPC_ID,
          variant: "starting-out-using-the-raft",
        })
      : undefined);
  }

  function swimFromRock({ player }) {
    travel(player, "You swim out into the water...", "...but the current is too strong, washing you downstream.", DOWNSTREAM_SHORE);
  }

  function climbDeadTree({ player }) {
    if (hasItem(player, ROPE_ITEM_ID) || flag(player, ROPE_ON_TREE_ATTRIBUTE)) {
      player.moveTo(WATERFALL_LEDGE);
      showStatement(player, "You tie the rope to the tree and climb down to the ledge below.");
      return;
    }
    floodDownstream(player, [
      "You try to use the tree to climb down...",
      "...but you slip and fall into the water.",
    ]);
  }

  function getInBarrel({ player }) {
    const message = "You climb into the barrel and push off the edge. You are carried down the river.";
    travel(player, message, message, DOWNSTREAM_SHORE);
  }

  function searchGolrieCrate({ player }) {
    if (stageOf(player) < STAGE_READ_BOOK) {
      player.sendMessage("You search the crate but find nothing of interest.");
      return;
    }
    if (hasItem(player, GOLRIE_KEY_ITEM_ID)) {
      player.sendMessage("You search the crate but find nothing of interest.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space to take the key.");
      return;
    }
    player.getInventory().adds(GOLRIE_KEY_ITEM_ID, 1);
    showItemMessage(player, GOLRIE_KEY_ITEM_ID, "You find a key in the crate.");
  }

  function insideGolrieCell(player) {
    const location = player.getLocation();
    return location.getX() >= 2502 && location.getX() <= 2523
      && location.getY() >= 9576 && location.getY() <= 9593;
  }

  function openGolrieGate({ player }) {
    const unlocked = flag(player, GOLRIE_GATE_ATTRIBUTE) || hasItem(player, GOLRIE_KEY_ITEM_ID);
    const inside = insideGolrieCell(player);
    if (!unlocked) {
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npcId: GOLRIE_NPC_ID,
        variant: "obtaining-the-pebble-opening-door-to-golrie-from-the-outside",
      });
      return;
    }
    if (hasItem(player, GOLRIE_KEY_ITEM_ID)) setFlag(player, GOLRIE_GATE_ATTRIBUTE);
    player.sendMessage(hasItem(player, GOLRIE_KEY_ITEM_ID) ? "You use the key to unlock the gate." : "You open the gate and walk through.");
    player.moveTo(inside ? new Location(2515, 9572, 0) : new Location(2515, 9577, 0));
  }

  function usePebbleOnTombstone(event) {
    if (event.objectId !== GLARIALS_TOMBSTONE_ID || event.itemId !== GLARIALS_PEBBLE_ITEM_ID) return false;
    const { player } = event;
    if (hasDisallowedTombItem(player)) {
      player.sendMessage("You place the pebble in the gravestone's small indent but nothing happens.");
      return true;
    }
    if (hasPebble(player)) player.getInventory().deleteNumber(GLARIALS_PEBBLE_ITEM_ID, 1);
    setFlag(player, TOMBSTONE_OPEN_ATTRIBUTE);
    setFlag(player, GOT_PEBBLE_ATTRIBUTE);
    if (stageOf(player) < STAGE_ENTERED_TOMB) quest.setStage(player, STAGE_ENTERED_TOMB);
    const message = "You place the pebble in the gravestone's small indent. The stone slab slides back revealing a ladder. You climb down it.";
    travel(player, message, message, TOMB_LANDING);
    return true;
  }

  function enterTombstone({ player }) {
    if (!flag(player, TOMBSTONE_OPEN_ATTRIBUTE)) return;
    // The open slab does not bypass the tomb's item restriction on re-entry.
    if (hasDisallowedTombItem(player)) {
      player.sendMessage("The tomb refuses you while you carry restricted items.");
      return;
    }
    player.sendMessage("You climb down the open tombstone.");
    player.moveTo(TOMB_LANDING);
  }

  function searchGlarialChest({ player }) {
    if (hasAmulet(player)) {
      player.sendMessage("You search the chest but find nothing.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return;
    }
    player.getInventory().adds(GLARIALS_AMULET_ITEM_ID, 1);
    showItemMessage(player, GLARIALS_AMULET_ITEM_ID, "You find a small amulet in the chest.");
  }

  function searchGlarialTomb({ player }) {
    if (hasUrn(player)) {
      player.sendMessage("You search the tomb but find nothing.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return;
    }
    player.getInventory().adds(GLARIALS_URN_ITEM_ID, 1);
    showItemMessage(player, GLARIALS_URN_ITEM_ID, "You find an urn full of ashes in the tomb.");
  }

  function searchBookcase({ player }) {
    if (stageOf(player) < STAGE_SPOKEN_HUDON) {
      player.sendMessage("You search the books but find nothing of interest.");
      return;
    }
    if (hasBook(player)) {
      player.sendMessage("You search the bookcase but find nothing of interest.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return;
    }
    player.getInventory().adds(BOOK_ON_BAXTORIAN_ITEM_ID, 1);
    showItemMessage(player, BOOK_ON_BAXTORIAN_ITEM_ID, "You find a book named 'Book on Baxtorian' on the bookcase.");
  }

  function searchBaxtorianCrate({ player }) {
    if (hasItem(player, BAXTORIAN_KEY_ITEM_ID)) {
      player.sendMessage("You search the crate but find nothing of interest.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space to take the key.");
      return;
    }
    player.getInventory().adds(BAXTORIAN_KEY_ITEM_ID, 1);
    showItemMessage(player, BAXTORIAN_KEY_ITEM_ID, "You find a key in the crate.");
  }

  function openWaterfallDoor({ player }) {
    if (stageOf(player) >= STAGE_COMPLETE || wearingAmulet(player)) {
      player.moveTo(WATERFALL_DUNGEON_LANDING);
      if (stageOf(player) < STAGE_ENTERED_DUNGEON) quest.setStage(player, STAGE_ENTERED_DUNGEON);
      Scenes.fade(player, false);
      showStatement(player, "You enter the waterfall.", () => Scenes.closeFade(player));
      return;
    }
    floodDownstream(player, [
      "You try to open the door, but the ledge is suddenly flooded with water...",
      "...you are pushed over the waterfall and into the river.",
      "Ouch!",
    ]);
  }

  /**
   * Doors.plugin.js handles "Door" before this quest's generic interaction hook.
   * Its `door:toggle` event is the only place that can still gate the key and
   * advance stage 6 once the shared open-loc pairing makes the door swing.
   */
  function handleBaxtorianDoorToggle(request) {
    if (request.objectId !== BAXTORIAN_DOOR_ID) return;
    const { player } = request;
    if (stageOf(player) < STAGE_ENTERED_DUNGEON) return;
    const unlocked = flag(player, BAXTORIAN_DOOR_ATTRIBUTE);
    if (!unlocked && !hasItem(player, BAXTORIAN_KEY_ITEM_ID)) {
      player.sendMessage("The door is locked.");
      request.handled = true;
      return;
    }
    if (!unlocked) {
      setFlag(player, BAXTORIAN_DOOR_ATTRIBUTE);
      player.sendMessage("You use the key to unlock the door.");
    }
    if (stageOf(player) < STAGE_OPENED_BAXTORIAN_DOOR) quest.setStage(player, STAGE_OPENED_BAXTORIAN_DOOR);
  }

  function openBaxtorianDoor({ player }) {
    if (flag(player, BAXTORIAN_DOOR_ATTRIBUTE)) {
      if (stageOf(player) < STAGE_OPENED_BAXTORIAN_DOOR) quest.setStage(player, STAGE_OPENED_BAXTORIAN_DOOR);
      return false;
    }
    if (!hasItem(player, BAXTORIAN_KEY_ITEM_ID)) {
      player.sendMessage("The door is locked.");
      return true;
    }
    setFlag(player, BAXTORIAN_DOOR_ATTRIBUTE);
    if (stageOf(player) < STAGE_OPENED_BAXTORIAN_DOOR) quest.setStage(player, STAGE_OPENED_BAXTORIAN_DOOR);
    player.sendMessage("You use the key to unlock the door.");
    return false;
  }

  function useRopeOnRock(event) {
    if (!CROSSING_ROCK_IDS.has(event.objectId) || event.itemId !== ROPE_ITEM_ID) return false;
    const { player } = event;
    showCrossingRope(player);
    // Rope-on-rock from the north bank; from the island the same click returns.
    walkCrossing(player, player.getLocation().getY() <= 3475 ? CROSSING_PATH_NORTH : CROSSING_PATH_SOUTH);
    return true;
  }

  function useRopeOnTree(event) {
    if (event.objectId !== DEAD_TREE_ID || event.itemId !== ROPE_ITEM_ID) return false;
    setFlag(event.player, ROPE_ON_TREE_ATTRIBUTE);
    event.player.moveTo(WATERFALL_LEDGE);
    showStatement(event.player, "You tie the rope to the tree and climb down to the ledge below.");
    return true;
  }

  function useRuneOnPillar(event) {
    if (event.objectId !== PILLAR_ID || !RUNE_TYPES.includes(event.itemId)) return false;
    const { player, location } = event;
    const bit = runeBit(location, event.itemId);
    if (bit < 0) return false;
    if (pillarMask(player) & bit) {
      player.sendMessage("You've already put that type of rune on this pillar.");
      return true;
    }
    if (!hasItem(player, event.itemId)) return true;
    player.getInventory().deleteNumber(event.itemId, 1);
    player.setAttribute(PILLARS_ATTRIBUTE, pillarMask(player) | bit);
    player.sendMessage("You place the rune on the pillar. It disappears in a puff of smoke.");
    return true;
  }

  /**
   * The captured statue use (2565,9915) teleports the player to the raised
   * chalice room at (2603,9914,0).
   */
  function statueRoom() {
    return { landing: new Location(2603, 9914, 0) };
  }

  function useAmuletOnStatue(event) {
    if (event.objectId !== STATUE_ID || event.itemId !== GLARIALS_AMULET_ITEM_ID) return false;
    const { player } = event;
    if (stageOf(player) >= STAGE_COMPLETE) {
      player.sendMessage("Glarial's statue is already at rest.");
      return true;
    }
    if (stageOf(player) < STAGE_ENTERED_DUNGEON) return false;
    if (!allRunesPlaced(player)) {
      floodDownstream(player, [
        "You go to place the amulet around the neck of the statue. However, water floods into the room as you do...",
        "...you are washed out of the cave and down the river.",
      ]);
      return true;
    }
    player.getInventory().deleteNumber(GLARIALS_AMULET_ITEM_ID, 1);
    if (stageOf(player) < STAGE_PLACED_AMULET) quest.setStage(player, STAGE_PLACED_AMULET);
    const message = "You place the amulet around the neck of the statue. You hear a loud rumble from beneath as the floor rises.";
    travel(player, message, message, statueRoom().landing);
    return true;
  }

  function completeAfterMessage(player, text) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder();
    chain.add(new StatementDialogue(0, text));
    chain.add(new ActionDialogue(1, { execute: () => {
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      quest.complete(player);
    } }));
    player.getDialogueManager().startDialogues(chain);
  }

  function useUrnOnChalice(event) {
    if (event.objectId !== CHALICE_ID || event.itemId !== GLARIALS_URN_ITEM_ID) return false;
    const { player } = event;
    if (stageOf(player) >= STAGE_COMPLETE) {
      player.sendMessage("The chalice only contains some old ashes.");
      return true;
    }
    if (stageOf(player) < STAGE_PLACED_AMULET) return false;
    player.getInventory().deleteNumber(GLARIALS_URN_ITEM_ID, 1);
    if (!player.getInventory().isFull()) player.getInventory().adds(GLARIALS_URN_EMPTY_ITEM_ID, 1);
    completeAfterMessage(player, "You carefully pour the ashes into the chalice and remove Baxtorian's treasure...");
    return true;
  }

  function takeFromChalice({ player }) {
    if (stageOf(player) >= STAGE_COMPLETE) {
      player.sendMessage("The chalice only contains some old ashes.");
      return;
    }
    floodDownstream(player, [
      "You go to take the treasure from the chalice. However, water floods into the room as you do...",
      "...you are washed out of the cave and down the river.",
    ]);
  }

  /** The rock/rope and swim point are used from the north bank, not their own tile. */
  function routeWaterfallCrossing(event) {
    if (CROSSING_ROCK_IDS.has(event.objectId)) {
      const south = event.sourceLocation.y <= 3475;
      event.destination = south
        ? { x: DEAD_TREE_ROUTE_TILE.getX(), y: DEAD_TREE_ROUTE_TILE.getY(), z: event.sourceLocation.z }
        : { x: ROCK_ROUTE_TILE.getX(), y: ROCK_ROUTE_TILE.getY(), z: event.sourceLocation.z };
    } else if (event.objectId === WATERFALL_SWIM_POINT_ID) {
      event.destination = { x: SWIM_ROUTE_TILE.getX(), y: SWIM_ROUTE_TILE.getY(), z: event.sourceLocation.z };
    } else if (event.objectId === DEAD_TREE_ID) {
      event.destination = { x: DEAD_TREE_ROUTE_TILE.getX(), y: DEAD_TREE_ROUTE_TILE.getY(), z: event.sourceLocation.z };
    }
  }

  function handleObjectInteraction(event) {
    finishCrossingMove(event.player);
    switch (event.objectId) {
      case LOG_RAFT_ID:
        boardRaft(event);
        break;
      case BOOKCASE_ID:
        searchBookcase(event);
        break;
      case GOLRIE_CRATE_ID:
        searchGolrieCrate(event);
        break;
      case GOLRIE_GATE_ID:
        openGolrieGate(event);
        break;
      case GLARIALS_TOMBSTONE_ID:
        enterTombstone(event);
        break;
      case GLARIALS_TOMB_ID:
        searchGlarialTomb(event);
        break;
      case GLARIALS_CHEST_ID:
        searchGlarialChest(event);
        break;
      case CROSSING_ROCK_ID:
        swimFromRock(event);
        break;
      case WATERFALL_SWIM_POINT_ID:
        swimFromRock(event);
        break;
      case BAXTORIAN_CRATE_ID:
        searchBaxtorianCrate(event);
        break;
      case BAXTORIAN_DOOR_ID:
        event.handled = openBaxtorianDoor(event);
        return;
      case WATERFALL_DOOR_ID:
        openWaterfallDoor(event);
        break;
      case DEAD_TREE_ID:
        climbDeadTree(event);
        break;
      case BARREL_ID:
        getInBarrel(event);
        break;
      case CHALICE_ID:
        takeFromChalice(event);
        break;
      default:
        return;
    }
    event.handled = true;
  }

  function handleItemOnObject(event) {
    finishCrossingMove(event.player);
    const handled = usePebbleOnTombstone(event)
      || useRopeOnRock(event)
      || useRopeOnTree(event)
      || useRuneOnPillar(event)
      || useAmuletOnStatue(event)
      || useUrnOnChalice(event);
    if (handled) event.handled = true;
    return handled;
  }

  api.persistAttribute(PILLARS_ATTRIBUTE, 0);
  api.persistAttribute(BAXTORIAN_DOOR_ATTRIBUTE, 0);
  api.persistAttribute(GOLRIE_GATE_ATTRIBUTE, 0);
  api.persistAttribute(TOMBSTONE_OPEN_ATTRIBUTE, 0);
  api.persistAttribute(VERSION_ATTRIBUTE, 0);
  api.persistAttribute(ROPE_ON_TREE_ATTRIBUTE, 0);
  api.persistAttribute(GOT_PEBBLE_ATTRIBUTE, 0);
  api.persistAttribute(GERALD_MET_ATTRIBUTE, 0);
  api.persistAttribute(HADLEY_MET_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "waterfall_quest",
    name: "Waterfall Quest",
    varpId: VARP_WATERFALL_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 154,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: ATTACK_XP, label: "Attack" },
      { skillId: Skill.STRENGTH.getIndex(), amount: STRENGTH_XP, label: "Strength" },
    ],
    scrollItemId: GLARIALS_URN_ITEM_ID,
    otherRewards: ["2 Diamonds", "2 Gold bars", "40 Mithril seeds", "Access to the Waterfall Dungeon"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("door:toggle", handleBaxtorianDoorToggle);
  api.onNpcRoute(widenHudonTalkRange);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(({ player }) => clearCrossingRope(player));
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction("Book on Baxtorian", { Read: readBook });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectRoute(routeWaterfallCrossing);
  api.onWalkRoute(cancelCrossingWalk);
  api.onPlayerLogin(sendWaterfallVarbits);
};
