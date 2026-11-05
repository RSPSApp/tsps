/**
 * The Eyes of Glouphrie (members).
 *
 * The words come from the "The Eyes of Glouphrie" transcript page. This plugin supplies
 * the Brimstail and King Narnode Talk-to interception (their world spawns, 4913 and
 * 1423, are not in the dialogue index), Hazelmere's variant selector, the prose
 * condition answers, the room inspection and machine interactions, the crystal-disc
 * value puzzle, the evil-creature hunt and the completion reward.
 *
 * The stage numbers below are durable plugin stages. nativeProgress maps them to
 * the native cache phases; see docs/quests/native-quest-state-a.md.
 *
 * Stages (varp 844 "eyeglo_var1"; the stage itself is varbit 2497 "eyeglo_quest" bits
 * 0-5, so the varp's sabotage/panel/eye sibling bits are left alone): 1 started,
 * 2 sent to Hazelmere, 3 violet pentagon received, 4 machine sabotaged, 5 told to
 * inspect the damage, 6 damage inspected, 7 machine repaired, 8 repair reported and
 * discs received, 9 front panel unlocked, 10 machine activated, 11 all six spies
 * killed, 12 complete.
 *
 * Source: https://oldschool.runescape.wiki/w/The_Eyes_of_Glouphrie and
 * https://oldschool.runescape.wiki/w/Transcript:The_Eyes_of_Glouphrie.
 *
 * Requirements per the wiki: The Grand Tree, 5 Construction (not boostable) and
 * 46 Magic (not boostable, not needed to start). Grand Tree is checked through
 * quest:is-complete; Magic is the transcript's own mind-link condition.
 *
 * Gaps/approximations (the cache has no anti-illusion machine or exchanger interface):
 * - the lock and control-panel numbers are fixed (4; 16 with one slot, 30 with two,
 *   48 with three) instead of randomised, and are shown as system messages; discs are
 *   inserted by using them on the machine. A wrong set clunks back out unconsumed, a
 *   right set is absorbed.
 * - Oaknock's exchanger is worked by using a disc on it; it deterministically splits
 *   one disc into two of equal total value instead of offering random exchanges.
 * - Brimstail's "three random discs" are a fixed set (green square, blue triangle,
 *   yellow pentagon) so the fixed puzzle is always solvable; the real quest rolls them.
 * - the six spies are spawned per player (ownerOnly) when the machine activates, at
 *   fixed tiles; the cute-creature models, the Brimstail-kills-his-creature case and
 *   the entrance re-spawn are not simulated.
 * - cutscene stage directions (camera, maps, flashbacks) are chatbox text only.
 * - while this quest is in progress Hazelmere plays its variants; the shared Grand Tree
 *   dialogue resumes when it is not (Grand Tree registers after this quest).
 * - pre-sabotage machine clicks and the interface-less puzzle steps answer with short
 *   system messages where the wiki transcript has no matching line.
 * - Monkey Madness I is not registered on this server, so its "progressed far enough"
 *   condition always answers false.
 * - the singing bowl's crystal-saw conversion is implemented; crystal saw charges
 *   (varbit 2514) are not tracked, and extracting sap from the pine tree is not.
 */
module.exports = function registerEyesOfGlouphrieQuest(api) {
  const {
    GameObject,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Eyes of Glouphrie";
  const START_HOOK = "quest:the-eyes-of-glouphrie:start";

  const VARP_EYEGLO = 844; // "eyeglo_var1"
  const VARBIT_EYEGLO_QUEST = 2497; // varp 844 bits 0-5, "eyeglo_quest"
  const VARBIT_BOWL_SEEN = 2515; // varp 845 bit 24, "eyeglo_bowl_seen"
  const VARBIT_MACHINE_SEEN = 2516; // varp 845 bit 25, "eyeglo_machine_seen"

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_SENT_TO_HAZELMERE = 2;
  const STAGE_MET_HAZELMERE = 3;
  const STAGE_SABOTAGED = 4;
  const STAGE_TOLD_TO_INSPECT = 5;
  const STAGE_INSPECTED = 6;
  const STAGE_REPAIRED = 7;
  const STAGE_REPAIR_REPORTED = 8;
  const STAGE_PANEL_UNLOCKED = 9;
  const STAGE_OPERATIONAL = 10;
  const STAGE_SPIES_DEFEATED = 11;
  const STAGE_COMPLETE = 12;

  const CONSTRUCTION_REQUIREMENT = 5;
  const MAGIC_REQUIREMENT = 46;

  // The generated identifiers name variants of Brimstail, not the id npc-spawns.json uses.
  const BRIMSTAIL_SPAWN_NPC_ID = 4913; // npc-spawns "Brimstail"

  const BRIMSTAIL_NPC_IDS = new Set([
    BRIMSTAIL_SPAWN_NPC_ID,
    NpcIdentifiers.BRIMSTAIL_2, // 4914
    NpcIdentifiers.BRIMSTAIL, // 11430
    NpcIdentifiers.BRIMSTAIL_3, // 11431
  ]);
  const HAZELMERE_NPC_IDS = new Set([NpcIdentifiers.HAZELMERE, NpcIdentifiers.HAZELMERE_2]);

  const MUD_RUNE_ITEM_ID = ItemIdentifiers.MUD_RUNE; // 4698
  const GROUND_MUD_RUNES_ITEM_ID = ItemIdentifiers.GROUND_MUD_RUNES; // 9594
  const MAGIC_GLUE_ITEM_ID = ItemIdentifiers.MAGIC_GLUE; // 9592
  const BUCKET_OF_SAP_ITEM_ID = ItemIdentifiers.BUCKET_OF_SAP; // 4687
  const PESTLE_AND_MORTAR_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const OAK_LOGS_ITEM_ID = ItemIdentifiers.OAK_LOGS; // 1521
  const MAPLE_LOGS_ITEM_ID = ItemIdentifiers.MAPLE_LOGS; // 1517
  const SAW_ITEM_ID = ItemIdentifiers.SAW; // 8794
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const CRYSTAL_SAW_ITEM_ID = ItemIdentifiers.CRYSTAL_SAW; // 9625
  const CRYSTAL_SAW_SEED_ITEM_ID = ItemIdentifiers.CRYSTAL_SAW_SEED; // 9626

  const RED_SQUARE_ITEM_ID = ItemIdentifiers.RED_SQUARE; // 9599
  const YELLOW_TRIANGLE_ITEM_ID = ItemIdentifiers.YELLOW_TRIANGLE; // 9606
  const YELLOW_PENTAGON_ITEM_ID = ItemIdentifiers.YELLOW_PENTAGON; // 9608
  const GREEN_SQUARE_ITEM_ID = ItemIdentifiers.GREEN_SQUARE; // 9611
  const BLUE_TRIANGLE_ITEM_ID = ItemIdentifiers.BLUE_TRIANGLE; // 9614
  const VIOLET_PENTAGON_ITEM_ID = ItemIdentifiers.VIOLET_PENTAGON; // 9624

  const MACHINE_BROKEN_OBJECT_ID = ObjectIdentifiers.OAKNOCKS_MACHINE_4; // 17246, Repair
  const MACHINE_LOCKED_OBJECT_ID = ObjectIdentifiers.OAKNOCKS_MACHINE_5; // 17247, Unlock
  const MACHINE_FIXED_OBJECT_ID = ObjectIdentifiers.OAKNOCKS_MACHINE_3; // 17245, Operate
  const EXCHANGER_OBJECT_ID = ObjectIdentifiers.OAKNOCKS_EXCHANGER; // 17248, Use
  const MACHINE_PANEL_OBJECT_ID = ObjectIdentifiers.MACHINE_PANEL; // 17272, Inspect
  const SINGING_BOWL_OBJECT_ID = ObjectIdentifiers.SINGING_BOWL; // 17239, Inspect / Sing-crystal

  /** Machine and exchanger tiles: the cave map carries only the platform and pipe. */
  const MACHINE_BROKEN_TILE = { x: 2390, y: 9824 };
  const MACHINE_LOCKED_TILE = { x: 2390, y: 9825 };
  const MACHINE_FIXED_TILE = { x: 2391, y: 9825 };
  const EXCHANGER_TILE = { x: 2391, y: 9824 };
  const CAVE_BOX = { minX: 2370, maxX: 2410, minY: 9800, maxY: 9840 };

  // ==========================================================================
  // Crystal disc values: colour (red 1 .. violet 7) x shape (circle 1,
  // triangle 3, square 4, pentagon 5). Each row is circle/triangle/square/pentagon.
  // ==========================================================================
  const COLOUR_DISCS = [
    [ItemIdentifiers.RED_CIRCLE, ItemIdentifiers.RED_TRIANGLE, ItemIdentifiers.RED_SQUARE, ItemIdentifiers.RED_PENTAGON],
    [ItemIdentifiers.ORANGE_CIRCLE, ItemIdentifiers.ORANGE_TRIANGLE, ItemIdentifiers.ORANGE_SQUARE, ItemIdentifiers.ORANGE_PENTAGON],
    [ItemIdentifiers.YELLOW_CIRCLE, ItemIdentifiers.YELLOW_TRIANGLE, ItemIdentifiers.YELLOW_SQUARE, ItemIdentifiers.YELLOW_PENTAGON],
    [ItemIdentifiers.GREEN_CIRCLE, ItemIdentifiers.GREEN_TRIANGLE, ItemIdentifiers.GREEN_SQUARE, ItemIdentifiers.GREEN_PENTAGON],
    [ItemIdentifiers.BLUE_CIRCLE, ItemIdentifiers.BLUE_TRIANGLE, ItemIdentifiers.BLUE_SQUARE, ItemIdentifiers.BLUE_PENTAGON],
    [ItemIdentifiers.INDIGO_CIRCLE, ItemIdentifiers.INDIGO_TRIANGLE, ItemIdentifiers.INDIGO_SQUARE, ItemIdentifiers.INDIGO_PENTAGON],
    [ItemIdentifiers.VIOLET_CIRCLE, ItemIdentifiers.VIOLET_TRIANGLE, ItemIdentifiers.VIOLET_SQUARE, ItemIdentifiers.VIOLET_PENTAGON],
  ];
  const SHAPE_VALUES = [1, 3, 4, 5];
  const DISC_VALUE_BY_ITEM = new Map();
  COLOUR_DISCS.forEach((items, colourIndex) => {
    items.forEach((itemId, shapeIndex) => {
      DISC_VALUE_BY_ITEM.set(itemId, (colourIndex + 1) * SHAPE_VALUES[shapeIndex]);
    });
  });
  /** One canonical item per value, for the exchanger's splits. */
  const ITEM_BY_VALUE = new Map();
  for (const [itemId, value] of DISC_VALUE_BY_ITEM) {
    if (!ITEM_BY_VALUE.has(value)) ITEM_BY_VALUE.set(value, itemId);
  }
  const VALUES_DESCENDING = [...ITEM_BY_VALUE.keys()].sort((a, b) => b - a);

  const UNLOCK_VALUE = 4; // red square
  const OPERATE_SLOTS = [1, 2, 3];
  const OPERATE_VALUES = [16, 30, 48]; // green square; blue triangle + yellow pentagon; red square + yellow triangle + violet pentagon

  /** Only one evil-creature kill per slot needs tracking. */
  const SPY_SPAWNS = [
    { id: NpcIdentifiers.EVIL_CREATURE, x: 2406, y: 9817, z: 0 }, // by Brimstail
    { id: NpcIdentifiers.EVIL_CREATURE_2, x: 2465, y: 3496, z: 0 }, // by King Narnode
    { id: NpcIdentifiers.EVIL_CREATURE_3, x: 2466, y: 3497, z: 3 }, // top of the Grand Tree
    { id: NpcIdentifiers.EVIL_CREATURE_4, x: 2413, y: 3528, z: 0 }, // tortoise pen
    { id: NpcIdentifiers.EVIL_CREATURE_5, x: 2459, y: 3446, z: 0 }, // Stronghold spirit tree
    { id: NpcIdentifiers.EVIL_CREATURE_6, x: 2461, y: 3386, z: 0 }, // Stronghold entrance
  ];

  const BITS_ATTRIBUTE = "quest.the_eyes_of_glouphrie.bits";
  const BIT_BOWL_SEEN = 1 << 0;
  const BIT_PANEL_SEEN = 1 << 1;
  const BIT_FIXED_DISCS = 1 << 2;
  const BIT_EXTRA_DISCS = 1 << 3;
  const BIT_SPOKE_NARNODE = 1 << 4;
  const BIT_SPOKE_AFTER_ACTIVATION = 1 << 5;
  const SPY_BITS = SPY_SPAWNS.map((_, index) => 1 << (6 + index));

  // Transcript variant keys used directly by game actions.
  const TRANSCRIPT_INSPECT_BROKEN = "the-anti-illusion-machine-inspecting-the-broken-machine";
  const TRANSCRIPT_INSPECT_BROKEN_AGAIN = "the-anti-illusion-machine-inspecting-the-broken-machine-again";
  const TRANSCRIPT_MAKE_GLUE = "the-anti-illusion-machine-making-magic-glue";
  const TRANSCRIPT_REPAIRING = "the-anti-illusion-machine-repairing-the-machine";
  const TRANSCRIPT_PANEL = "the-anti-illusion-machine-inspecting-the-machine-panel";
  const TRANSCRIPT_NOT_OPERATIONAL = "the-anti-illusion-machine-using-the-machine-attempting-to-activate-the-machine-without-the-correct-discs";
  const TRANSCRIPT_ALREADY_WORKING = "the-anti-illusion-machine-attempting-to-operate-the-machine-after-it-activates";
  const TRANSCRIPT_WRONG_UNLOCK = "the-anti-illusion-machine-using-the-machine-attempting-to-unlock-the-machine-without-the-correct-disc";
  const TRANSCRIPT_UNLOCKED_PANEL = "the-anti-illusion-machine-using-the-machine-unlocking-the-machine-s-front-panel";
  const TRANSCRIPT_EXCHANGE_ACCEPTED = "the-anti-illusion-machine-using-the-machine-accepting-an-exchange";
  const TRANSCRIPT_EXCHANGER_NO_DISC = "the-anti-illusion-machine-using-the-machine-attempting-to-accept-an-exchange-without-a-disc-in-the-exchanger";
  const TRANSCRIPT_ACTIVATION = "the-anti-illusion-machine-unlocking-the-machine";
  const TRANSCRIPT_ALL_SPIES_DEAD = "assassination-killing-all-evil-creatures";

  /**
   * Wiki export markers that would end the branch; the conversation continues after
   * them (the Hazelmere magic-level conditions sit behind one).
   */
  const CONTINUE_MARKER_STEP_IDS = new Set(["nEEScV", "B-nJgN", "Lhdq1_", "ggcPD6"]);

  let quest;
  let objectsInstalled = false;
  const spiesByPlayer = new Map();
  const puzzleProgress = new WeakMap();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const isBrimstail = (npcId) => BRIMSTAIL_NPC_IDS.has(npcId);
  const isHazelmere = (npcId) => HAZELMERE_NPC_IDS.has(npcId);

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function killCount(player) {
    let count = 0;
    for (const bit of SPY_BITS) if (hasBit(player, bit)) count++;
    return count;
  }

  function normalise(text) {
    return String(text ?? "")
      .toLowerCase()
      .replace(/['\u2019]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function grandTreeComplete(player) {
    const request = { player, key: "grand_tree", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsStartRequirements(player) {
    const skills = player.getSkillManager();
    return (
      grandTreeComplete(player) &&
      skills.getMaxLevel(Skill.CONSTRUCTION) >= CONSTRUCTION_REQUIREMENT &&
      skills.getMaxLevel(Skill.MAGIC) >= MAGIC_REQUIREMENT
    );
  }

  function notifyStartRequirements(player) {
    const skills = player.getSkillManager();
    if (skills.getMaxLevel(Skill.CONSTRUCTION) < CONSTRUCTION_REQUIREMENT) {
      player.sendMessage(
        `You need a Construction level of at least ${CONSTRUCTION_REQUIREMENT} to start this quest.`
      );
    }
    if (skills.getMaxLevel(Skill.MAGIC) < MAGIC_REQUIREMENT) {
      player.sendMessage(`You need a Magic level of at least ${MAGIC_REQUIREMENT} to start this quest.`);
    }
  }

  function hasRepairItems(player) {
    return (
      held(player, OAK_LOGS_ITEM_ID) &&
      held(player, MAPLE_LOGS_ITEM_ID) &&
      held(player, MAGIC_GLUE_ITEM_ID) &&
      held(player, SAW_ITEM_ID) &&
      held(player, HAMMER_ITEM_ID)
    );
  }

  function playVariant(player, npcId, variant) {
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function grantItem(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    if (inventory.getAmount(itemId) > 0) return true;
    if (inventory.getFreeSlots() < amount) {
      player.sendMessage("You need more inventory space.");
      return false;
    }
    inventory.adds(itemId, amount);
    return true;
  }

  function ensureFixedDiscs(player) {
    if (hasBit(player, BIT_FIXED_DISCS)) return;
    if (player.getInventory().getFreeSlots() < 2) {
      player.sendMessage("You need two free inventory slots.");
      return;
    }
    setBit(player, BIT_FIXED_DISCS);
    player.getInventory().adds(RED_SQUARE_ITEM_ID, 1);
    player.getInventory().adds(YELLOW_TRIANGLE_ITEM_ID, 1);
  }

  function ensureExtraDiscs(player) {
    if (hasBit(player, BIT_EXTRA_DISCS)) return;
    if (player.getInventory().getFreeSlots() < 3) {
      player.sendMessage("You need three free inventory slots.");
      return;
    }
    setBit(player, BIT_EXTRA_DISCS);
    player.getInventory().adds(GREEN_SQUARE_ITEM_ID, 1);
    player.getInventory().adds(BLUE_TRIANGLE_ITEM_ID, 1);
    player.getInventory().adds(YELLOW_PENTAGON_ITEM_ID, 1);
  }

  /** Splits a disc value into two valid disc values, largest first. */
  function splitDisc(value) {
    for (const high of VALUES_DESCENDING) {
      if (high >= value) continue;
      const low = value - high;
      if (ITEM_BY_VALUE.has(low)) return [ITEM_BY_VALUE.get(high), ITEM_BY_VALUE.get(low)];
    }
    return null;
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Brimstail asked me to help him understand Oaknock's</str>",
        "<str>anti-illusion machine. I repaired and restarted it,</str>",
        "<str>exposing Arposandran spies hidden in the Stronghold.</str>",
        "",
        "<str>King Narnode rewarded me with a crystal saw seed.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SPIES_DEFEATED) {
      return ["I have killed all six spies. I should tell <col=800000>King Narnode</col>."];
    }
    if (stage >= STAGE_OPERATIONAL) {
      return [
        "The machine revealed six evil creatures spying on the Stronghold.",
        `I have killed ${killCount(player)} of them so far.`,
        "",
        "Speak to <col=800000>Brimstail</col> if the spying creatures trouble me.",
      ];
    }
    if (stage >= STAGE_PANEL_UNLOCKED) {
      return ["The machine's front panel is unlocked; I must match its numbers with crystal discs."];
    }
    if (stage >= STAGE_REPAIR_REPORTED) {
      return ["Brimstail gave me crystal discs. I must unlock the machine's front panel."];
    }
    if (stage >= STAGE_REPAIRED) {
      return ["I repaired Oaknock's machine, but it is locked. Talk to <col=800000>Brimstail</col>."];
    }
    if (stage >= STAGE_INSPECTED) {
      return [
        "The machine needs maple and oak logs and magic glue,",
        "with a saw and a hammer, to be repaired.",
      ];
    }
    if (stage >= STAGE_TOLD_TO_INSPECT) {
      return ["Brimstail asked me to look at the damage to the machine."];
    }
    if (stage >= STAGE_SABOTAGED) {
      return ["The machine has been sabotaged! Talk to <col=800000>Brimstail</col>."];
    }
    if (stage >= STAGE_MET_HAZELMERE) {
      return ["I have Hazelmere's violet pentagon. I should return to <col=800000>Brimstail</col>."];
    }
    if (stage >= STAGE_SENT_TO_HAZELMERE) {
      return ["Brimstail wants me to visit <col=800000>Hazelmere</col>, east of Yanille."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Brimstail asked me to look carefully around the next room and report back."];
    }
    return [
      "I can start this quest by speaking to <col=800000>Brimstail</col>",
      "in his cave in the <col=800000>Tree Gnome Stronghold</col>.",
      "",
      "Requirements: The Grand Tree, 5 Construction, 46 Magic.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MAGIC, 12000);
    skills.addExperiences(Skill.WOODCUTTING, 2500);
    skills.addExperiences(Skill.RUNECRAFTING, 6000);
    skills.addExperiences(Skill.CONSTRUCTION, 250);
  }

  // ==========================================================================
  // Dialogue: variant selection
  // ==========================================================================

  /** Hazelmere is indexed, so his Eyes variants are selected here. */
  function selectHazelmereVariant({ npcId, player }) {
    if (!isHazelmere(npcId)) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return grandTreeComplete(player)
        ? { page: "Hazelmere", variant: "standard-dialogue-after-the-eyes-of-glouphrie" }
        : null;
    }
    if (stage >= STAGE_MET_HAZELMERE) {
      return { page: PAGE, variant: "discussion-with-hazelmere-talking-to-hazelmere-again-before-going-back-to-brimstail" };
    }
    if (stage >= STAGE_SENT_TO_HAZELMERE) {
      return { page: PAGE, variant: "discussion-with-hazelmere-speaking-with-hazelmere" };
    }
    return null;
  }

  function brimstailVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_SPIES_DEFEATED) {
      return "assassination-talking-to-brimstail-after-killing-all-evil-creatures";
    }
    if (stage >= STAGE_OPERATIONAL) {
      if (hasBit(player, SPY_BITS[0])) {
        return "assassination-talking-to-brimstail-after-killing-his-evil-creature";
      }
      return hasBit(player, BIT_SPOKE_AFTER_ACTIVATION)
        ? "assassination-talking-to-brimstail-again"
        : "assassination-talking-to-brimstail-after-activating-the-machine";
    }
    if (stage >= STAGE_PANEL_UNLOCKED) {
      return "the-anti-illusion-machine-talking-to-brimstail-after-unlocking-the-machine-s-front-panel";
    }
    if (stage >= STAGE_REPAIR_REPORTED) {
      return "the-anti-illusion-machine-talking-to-brimstail-again-before-unlocking-the-machine";
    }
    if (stage >= STAGE_REPAIRED) {
      return "the-anti-illusion-machine-after-repairing-the-machine";
    }
    if (stage >= STAGE_INSPECTED) {
      return "the-anti-illusion-machine-talking-to-brimstail-again-after-inspecting-the-machine";
    }
    if (stage >= STAGE_TOLD_TO_INSPECT) {
      return "the-anti-illusion-machine-talking-to-brimstail-again-without-inspecting-the-machine";
    }
    if (stage >= STAGE_SABOTAGED) {
      return "the-anti-illusion-machine-speaking-to-brimstail-after-the-sabotage";
    }
    if (stage >= STAGE_MET_HAZELMERE) {
      return "the-anti-illusion-machine-returning-to-brimstail";
    }
    if (stage >= STAGE_SENT_TO_HAZELMERE) {
      return "investigating-the-next-room-talking-to-brimstail-again-before-going-to-hazelmere";
    }
    if (stage >= STAGE_STARTED) {
      return hasBit(player, BIT_BOWL_SEEN) && hasBit(player, BIT_PANEL_SEEN)
        ? "investigating-the-next-room-after-looking-at-the-room"
        : "investigating-the-next-room-talking-to-brimstail-again-before-looking-at-the-room";
    }
    return "getting-started";
  }

  /** The world Brimstail (4913) is not in the dialogue index, so Talk-to is owned here. */
  function talkToBrimstail(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return false; // standard post-quest page handles the crystal seed
    if (stage === STAGE_NOT_STARTED && !meetsStartRequirements(player)) return false;
    playVariant(player, event.npcId, brimstailVariant(player));
    return true;
  }

  /** The world King Narnode (1423) is not in the dialogue index either. */
  function talkToNarnode(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_OPERATIONAL || stage >= STAGE_COMPLETE) return false;
    let variant;
    if (stage >= STAGE_SPIES_DEFEATED) {
      variant = "assassination-talking-to-narnode-again-2";
    } else if (hasBit(player, BIT_SPOKE_NARNODE)) {
      variant = "assassination-talking-to-narnode-again";
    } else {
      variant = "assassination-talking-to-narnode";
      setBit(player, BIT_SPOKE_NARNODE);
    }
    playVariant(player, event.npcId, variant);
    return true;
  }

  // ==========================================================================
  // Dialogue: conditions, choices, hooks and actions
  // ==========================================================================

  function answerBrimstailCondition(player, text, stepId) {
    switch (stepId) {
      case "OhN7qs": // doesn't have glue
        return !held(player, MAGIC_GLUE_ITEM_ID);
      case "tYl51e": // doesn't have oak logs
        return !held(player, OAK_LOGS_ITEM_ID);
      case "d9P2K-": // doesn't have maple logs
        return !held(player, MAPLE_LOGS_ITEM_ID);
      case "Ip4VzN": // doesn't have a saw
        return !held(player, SAW_ITEM_ID);
      case "2DnRda": // doesn't have a hammer
        return !held(player, HAMMER_ITEM_ID);
      case "Rb59-2": // doesn't have a bucket of sap
        return !held(player, BUCKET_OF_SAP_ITEM_ID);
      case "HXYWYK": // has a bucket of sap
        return held(player, BUCKET_OF_SAP_ITEM_ID);
      case "r8Ly0u": // has not received the three extra discs
        return !hasBit(player, BIT_EXTRA_DISCS);
      case "cHfg5Y": // progressed far enough into Monkey Madness I
        return false;
      case "b8Zhn0": // hasn't progressed far enough into Monkey Madness I
        return true;
      default:
        break;
    }
    const value = String(text ?? "").toLowerCase();
    if (value.includes("before the eyes of glouphrie")) {
      return quest.getStage(player) === STAGE_NOT_STARTED && meetsStartRequirements(player);
    }
    if (value.includes("after the eyes of glouphrie")) {
      return quest.isComplete(player);
    }
    if (value.includes("does not have a crystal saw or crystal seed")) {
      return !held(player, CRYSTAL_SAW_ITEM_ID) && !held(player, CRYSTAL_SAW_SEED_ITEM_ID);
    }
    if (value.includes("has a crystal saw or crystal seed")) {
      return held(player, CRYSTAL_SAW_ITEM_ID) || held(player, CRYSTAL_SAW_SEED_ITEM_ID);
    }
    if (value.includes("crystal seed or uses it on brimstail")) {
      return held(player, CRYSTAL_SAW_SEED_ITEM_ID);
    }
    return null;
  }

  function answerHazelmereCondition(player, text, stepId) {
    const magic = player.getSkillManager().getMaxLevel(Skill.MAGIC);
    if (stepId === "IhqB-U") return magic < MAGIC_REQUIREMENT;
    if (stepId === "qErm7A") return magic >= MAGIC_REQUIREMENT;
    const value = String(text ?? "").toLowerCase();
    if (value.includes("crystal saw seed")) return held(player, CRYSTAL_SAW_SEED_ITEM_ID);
    if (value.includes("crystal saw")) return held(player, CRYSTAL_SAW_ITEM_ID);
    return null;
  }

  function answerCondition({ npcId, player, text, stepId }) {
    if (isBrimstail(npcId)) return answerBrimstailCondition(player, text, stepId);
    if (isHazelmere(npcId)) return answerHazelmereCondition(player, text, stepId);
    return null;
  }

  function handleChoice({ player, npcId, option }) {
    if (!isBrimstail(npcId)) return;
    const choice = normalise(option);
    const stage = quest.getStage(player);
    if (choice === "ive had a look in the other room now") {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_SENT_TO_HAZELMERE);
      return;
    }
    if (choice === "ive visited hazelmere he told me all sorts of interesting things") {
      if (stage === STAGE_MET_HAZELMERE) quest.setStage(player, STAGE_SABOTAGED);
      return;
    }
    if (choice === "the machine is broken i suspect sabotage") {
      if (stage === STAGE_SABOTAGED) quest.setStage(player, STAGE_TOLD_TO_INSPECT);
      return;
    }
    if (choice === "i think ive fixed the machine now") {
      if (stage === STAGE_REPAIRED) {
        quest.setStage(player, STAGE_REPAIR_REPORTED);
        ensureFixedDiscs(player);
      }
      return;
    }
    if (choice === "phew ive got that machine working now what do i need to do now") {
      setBit(player, BIT_SPOKE_AFTER_ACTIVATION);
      player.getPacketSender().sendVarbit(VARBIT_EYEGLO_QUEST, nativeProgress(stage, player));
    }
  }

  function handleHook(event) {
    if (event.hook !== START_HOOK || !isBrimstail(event.npcId)) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!meetsStartRequirements(player)) {
      notifyStartRequirements(player);
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (CONTINUE_MARKER_STEP_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    if (stepId === "23cJOm") { // Hazelmere gives the violet pentagon
      event.handled = true;
      if (grantItem(player, VIOLET_PENTAGON_ITEM_ID, 1) && quest.getStage(player) === STAGE_SENT_TO_HAZELMERE) {
        quest.setStage(player, STAGE_MET_HAZELMERE);
      }
      return;
    }
    if (stepId === "9SVXs_") { // Brimstail gives the red square and yellow triangle
      event.handled = true;
      ensureFixedDiscs(player);
      return;
    }
    if (stepId === "zghUpW") { // Brimstail gives three random discs
      event.handled = true;
      ensureExtraDiscs(player);
      return;
    }
    if (stepId === "GVEki3") { // post-quest Brimstail hands back the crystal seed
      event.handled = true;
      grantItem(player, CRYSTAL_SAW_SEED_ITEM_ID, 1);
      return;
    }
    if (stepId === "eSgfmS") { // final "Congratulations" message from King Narnode
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) >= STAGE_SPIES_DEFEATED && !quest.isComplete(player)) {
        quest.complete(player);
      }
    }
  }

  /** Fill the wiki's "[player name]" blank in Brimstail's and Hazelmere's lines. */
  function handleDialogueLine(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!isBrimstail(request.npcId) && !isHazelmere(request.npcId)) return;
    if (!request.text.includes("[player name]")) return;
    request.text = request.text.replace(/\[player name\]/gi, String(request.player.getDisplayName()));
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function registerQuestObject(objectId, tile) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, 0), 10, 0, null);
    ObjectManager.register(object, true);
  }

  function ensureQuestObjects() {
    if (objectsInstalled) return;
    objectsInstalled = true;
    registerQuestObject(MACHINE_BROKEN_OBJECT_ID, MACHINE_BROKEN_TILE);
    registerQuestObject(MACHINE_LOCKED_OBJECT_ID, MACHINE_LOCKED_TILE);
    registerQuestObject(MACHINE_FIXED_OBJECT_ID, MACHINE_FIXED_TILE);
    registerQuestObject(EXCHANGER_OBJECT_ID, EXCHANGER_TILE);
  }

  function inCave(location) {
    return (
      location &&
      location.x >= CAVE_BOX.minX &&
      location.x <= CAVE_BOX.maxX &&
      location.y >= CAVE_BOX.minY &&
      location.y <= CAVE_BOX.maxY
    );
  }

  function repairMachine(event) {
    const { player, objectId } = event;
    if (objectId !== MACHINE_BROKEN_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_SABOTAGED) {
      player.sendMessage("The machine doesn't look like it needs repairing.");
      return;
    }
    if (stage >= STAGE_REPAIRED) {
      player.sendMessage("Oaknock's machine looks like it has already been repaired.");
      return;
    }
    if (player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < CONSTRUCTION_REQUIREMENT) {
      player.sendMessage(`You need a Construction level of ${CONSTRUCTION_REQUIREMENT} to repair this machine.`);
      return;
    }
    if (!hasRepairItems(player)) {
      const firstInspection = stage < STAGE_INSPECTED;
      if (firstInspection) quest.setStage(player, STAGE_INSPECTED);
      playVariant(
        player,
        BRIMSTAIL_SPAWN_NPC_ID,
        firstInspection ? TRANSCRIPT_INSPECT_BROKEN : TRANSCRIPT_INSPECT_BROKEN_AGAIN
      );
      return;
    }
    player.getInventory().deleteNumber(OAK_LOGS_ITEM_ID, 1);
    player.getInventory().deleteNumber(MAPLE_LOGS_ITEM_ID, 1);
    player.getInventory().deleteNumber(MAGIC_GLUE_ITEM_ID, 1);
    quest.setStage(player, STAGE_REPAIRED);
    playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_REPAIRING);
  }

  function unlockMachine(event) {
    const { player, objectId } = event;
    if (objectId !== MACHINE_LOCKED_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_REPAIRED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    if (stage >= STAGE_PANEL_UNLOCKED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_ALREADY_WORKING);
      return;
    }
    // Substitute for the machine interface: show the value the lock asks for.
    player.sendMessage(`The machine's lock shows the number ${UNLOCK_VALUE}.`);
  }

  function operateMachine(event) {
    const { player, objectId } = event;
    if (objectId !== MACHINE_FIXED_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_PANEL_UNLOCKED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    if (stage >= STAGE_OPERATIONAL) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_ALREADY_WORKING);
      return;
    }
    // Substitute for the control panel interface.
    const progress = puzzleProgress.get(player) ?? { index: 0, discs: [] };
    player.sendMessage(
      `The control panel shows the number ${OPERATE_VALUES[progress.index]}` +
        ` with ${OPERATE_SLOTS[progress.index]} slot(s) to fill.`
    );
  }

  function useExchanger(event) {
    const { player, objectId } = event;
    if (objectId !== EXCHANGER_OBJECT_ID) return false;
    playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_EXCHANGER_NO_DISC);
  }

  function inspectBowl(event) {
    const { player, objectId } = event;
    if (objectId !== SINGING_BOWL_OBJECT_ID) return false;
    setBit(player, BIT_BOWL_SEEN);
    player.getPacketSender().sendVarbit(VARBIT_BOWL_SEEN, 1);
    player.sendMessage("You look into the singing bowl. A faint crystal hum fills the air.");
  }

  function singCrystal(event) {
    const { player, objectId } = event;
    if (objectId !== SINGING_BOWL_OBJECT_ID) return false;
    if (held(player, CRYSTAL_SAW_ITEM_ID)) {
      player.sendMessage("The bowl hums back at the crystal saw.");
      return;
    }
    if (!held(player, CRYSTAL_SAW_SEED_ITEM_ID)) {
      player.sendMessage("You have nothing to sing into the bowl.");
      return;
    }
    player.getInventory().deleteNumber(CRYSTAL_SAW_SEED_ITEM_ID, 1);
    player.getInventory().adds(CRYSTAL_SAW_ITEM_ID, 1);
    player.sendMessage("You sing to the crystal seed and it forms into a crystal saw.");
    api.emitCustomEvent("crystal-saw:made", { player });
  }

  function inspectPanel(event) {
    const { player, objectId, location } = event;
    if (objectId !== MACHINE_PANEL_OBJECT_ID || !inCave(location)) return false;
    setBit(player, BIT_PANEL_SEEN);
    player.getPacketSender().sendVarbit(VARBIT_MACHINE_SEEN, 1);
    playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_PANEL);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function tryUnlock(player, itemId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_REPAIRED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    if (stage >= STAGE_PANEL_UNLOCKED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_ALREADY_WORKING);
      return;
    }
    if (DISC_VALUE_BY_ITEM.get(itemId) !== UNLOCK_VALUE) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_WRONG_UNLOCK);
      return;
    }
    quest.setStage(player, STAGE_PANEL_UNLOCKED);
    playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_UNLOCKED_PANEL);
  }

  function insertDisc(player, itemId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_PANEL_UNLOCKED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    if (stage >= STAGE_OPERATIONAL) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_ALREADY_WORKING);
      return;
    }
    const progress = puzzleProgress.get(player) ?? { index: 0, discs: [] };
    progress.discs.push(itemId);
    if (progress.discs.length < OPERATE_SLOTS[progress.index]) {
      puzzleProgress.set(player, progress);
      player.sendMessage("You insert the disc into the machine.");
      return;
    }
    const total = progress.discs.reduce((sum, id) => sum + DISC_VALUE_BY_ITEM.get(id), 0);
    if (total !== OPERATE_VALUES[progress.index]) {
      progress.discs = [];
      puzzleProgress.set(player, progress);
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    for (const id of progress.discs) player.getInventory().deleteNumber(id, 1);
    progress.index += 1;
    progress.discs = [];
    if (progress.index >= OPERATE_SLOTS.length) {
      puzzleProgress.delete(player);
      activateMachine(player);
      return;
    }
    puzzleProgress.set(player, progress);
    player.sendMessage(`The discs are accepted. The next number is ${OPERATE_VALUES[progress.index]}.`);
  }

  function activateMachine(player) {
    if (quest.getStage(player) < STAGE_PANEL_UNLOCKED) return;
    quest.setStage(player, STAGE_OPERATIONAL);
    ensureSpies(player);
    playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_ACTIVATION);
  }

  function exchangeDisc(player, itemId) {
    if (quest.getStage(player) < STAGE_REPAIRED) {
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    const parts = splitDisc(DISC_VALUE_BY_ITEM.get(itemId));
    if (!parts) {
      player.sendMessage("The exchanger can't break that disc down any further.");
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory slot for the exchange.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(parts[0], 1);
    player.getInventory().adds(parts[1], 1);
    playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_EXCHANGE_ACCEPTED);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!DISC_VALUE_BY_ITEM.has(itemId)) return;
    if (objectId === MACHINE_LOCKED_OBJECT_ID) {
      event.handled = true;
      tryUnlock(player, itemId);
      return;
    }
    if (objectId === MACHINE_FIXED_OBJECT_ID) {
      event.handled = true;
      insertDisc(player, itemId);
      return;
    }
    if (objectId === MACHINE_BROKEN_OBJECT_ID) {
      event.handled = true;
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_NOT_OPERATIONAL);
      return;
    }
    if (objectId === EXCHANGER_OBJECT_ID) {
      event.handled = true;
      exchangeDisc(player, itemId);
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (ids.has(MUD_RUNE_ITEM_ID) && ids.has(PESTLE_AND_MORTAR_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(MUD_RUNE_ITEM_ID, 1);
      player.getInventory().adds(GROUND_MUD_RUNES_ITEM_ID, 1);
      return;
    }
    if (ids.has(GROUND_MUD_RUNES_ITEM_ID) && ids.has(BUCKET_OF_SAP_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(GROUND_MUD_RUNES_ITEM_ID, 1);
      player.getInventory().deleteNumber(BUCKET_OF_SAP_ITEM_ID, 1);
      player.getInventory().adds(MAGIC_GLUE_ITEM_ID, 1);
      playVariant(player, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_MAKE_GLUE);
    }
  }

  // ==========================================================================
  // Spies
  // ==========================================================================

  function ensureSpies(player) {
    let entries = spiesByPlayer.get(player);
    if (!entries) {
      entries = [];
      spiesByPlayer.set(player, entries);
    }
    SPY_SPAWNS.forEach((spot, index) => {
      if (hasBit(player, SPY_BITS[index])) return;
      if (entries.some((entry) => entry.index === index)) return;
      const npc = api.spawnNpc({
        id: spot.id,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) entries.push({ index, npc });
    });
  }

  function despawnSpies(player) {
    const entries = spiesByPlayer.get(player);
    if (!entries) return;
    spiesByPlayer.delete(player);
    for (const entry of entries) api.removeNpc(entry.npc);
  }

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    let owner = null;
    if (killer?.isPlayer?.() && spiesByPlayer.get(killer)?.some((entry) => entry.npc === npc)) {
      owner = killer;
    } else if (npc?.getOwner?.()?.isPlayer?.()) {
      owner = npc.getOwner();
    }
    if (!owner) return;
    const entries = spiesByPlayer.get(owner);
    if (!entries) return;
    const position = entries.findIndex((entry) => entry.npc === npc);
    if (position === -1) return;
    const [{ index }] = entries.splice(position, 1);
    const bit = SPY_BITS[index];
    if (hasBit(owner, bit)) return;
    setBit(owner, bit);
    const count = killCount(owner);
    if (count >= SPY_SPAWNS.length) {
      if (quest.getStage(owner) >= STAGE_OPERATIONAL && !quest.isComplete(owner)) {
        quest.setStage(owner, STAGE_SPIES_DEFEATED);
        playVariant(owner, BRIMSTAIL_SPAWN_NPC_ID, TRANSCRIPT_ALL_SPIES_DEAD);
      }
      return;
    }
    owner.sendMessage(`I've killed ${count} spying creatures so far, maybe there are more to find...`);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  function handleLogin({ player }) {
    ensureQuestObjects();
    refreshQuestList(player);
    player.getPacketSender().sendVarbit(VARBIT_BOWL_SEEN, hasBit(player, BIT_BOWL_SEEN) ? 1 : 0);
    player.getPacketSender().sendVarbit(VARBIT_MACHINE_SEEN, hasBit(player, BIT_PANEL_SEEN) ? 1 : 0);
    if (quest.getStage(player) >= STAGE_OPERATIONAL && !quest.isComplete(player)) {
      ensureSpies(player);
    }
  }

  function handleLogout({ player }) {
    despawnSpies(player);
  }

  // QH 06da90's eyeglo_quest phases; cache DB completes at 60.
  // Activation (36) and Brimstail's follow-up (40) share one durable stage plus its saved flag.
  function nativeProgress(stage, player) {
    stage |= 0;
    if (stage === STAGE_OPERATIONAL && hasBit(player, BIT_SPOKE_AFTER_ACTIVATION)) return 40;
    const phases = [0, 1, 5, 15, 20, 20, 20, 25, 27, 35, 36, 50, 60];
    return phases[Math.max(0, Math.min(stage, STAGE_COMPLETE))];
  }

  quest = registerQuest(api, {
    key: "the_eyes_of_glouphrie",
    name: "The Eyes of Glouphrie",
    varpId: VARP_EYEGLO,
    varbitId: VARBIT_EYEGLO_QUEST,
    varbitValue: nativeProgress,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.MAGIC.getIndex(), amount: 12000, label: "Magic" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 2500, label: "Woodcutting" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 6000, label: "Runecraft" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 250, label: "Construction" },
    ],
    rewardItemId: CRYSTAL_SAW_SEED_ITEM_ID,
    rewardItemLabel: "Crystal saw seed",
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(BITS_ATTRIBUTE);

  api.onNpcInteraction("Brimstail", { "Talk-to": talkToBrimstail });
  api.onNpcInteraction("King Narnode Shareen", { "Talk-to": talkToNarnode });
  api.onNpcDialogueVariant(selectHazelmereVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction("Oaknock's Machine", {
    Repair: repairMachine,
    Unlock: unlockMachine,
    Operate: operateMachine,
  });
  api.onObjectInteraction("Oaknock's exchanger", { Use: useExchanger });
  api.onObjectInteraction("Singing bowl", { Inspect: inspectBowl, "Sing-crystal": singCrystal });
  api.onObjectInteraction("Machine panel", { Inspect: inspectPanel });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onNpcDeath(handleNpcDeath);
  api.onServerStartup(ensureQuestObjects);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
