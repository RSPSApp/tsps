/**
 * Swan Song (members).
 *
 * The words come from the "Swan Song" transcript page (OSRS Wiki); this plugin
 * supplies the per-stage variant selector for Herman, the Wise Old Man, Franklin,
 * Arnold, Wizard Frumscone, Malignius Mortifer and the master crafters, the prose
 * condition answers, the item hand-ins, the colony wall repair, the fresh-monkfish
 * fishing, the battle spawns and the completion reward.
 *
 * Stages (varbit 2098 "swansong", varp 723 bits 0-8; scripts/lookup-gameval.ts).
 * The cache transforms NPCs by this varbit (2109 -> 2108 in Draynor for 0-29,
 * 4300 -> Wise Old Man for 30/40/50/55, 3365 -> Wise Old Man for 65+), so the
 * values follow those indices where the flow allows:
 *   0 not started; 5 Herman asked (fetch the Wise Old Man); 10 runes requested
 *   (5 blood, 10 lava, 10 mist); 30 back at the colony with the Wise Old Man
 *   waiting outside; 40 sea-troll battle; 55 entered the colony (find Herman);
 *   65 odd jobs (Franklin's walls / Arnold's monkfish); 80 both jobs done;
 *   90 army quest (Wizard Frumscone); 110 Malignius (7 bones / pot + lid);
 *   120 master crafter consulted; 130 bone seeds received (final battle);
 *   140 Sea Troll Queen; 150 queen dead; 190 complete.
 *
 * Source: OSRS Wiki "Swan Song", its quick guide and Transcript:Swan Song; ids
 * from scripts/lookup-gameval.ts, npc-dialogue-index.json and the cache
 * Npc/Item/Object identifier files.
 *
 * Gaps/approximations:
 * - The 100-QP requirement and the two quest prerequisites (One Small Favour,
 *   Garden of Tranquillity) are checked through the "does not meet the quest
 *   requirements" branch at Herman, and a 66-Magic boost is not required to
 *   start (the transcript gates nothing).
 * - Cutscenes (the Wise Old Man's flashbacks, the final battle) play as transcript
 *   dialogue only; there is no camera work and the emote/teleport stage directions
 *   just close the step.
 * - The colony map has no metal press (13592-13596) or broken wall (13583-13585)
 *   placements - OSRS instances that area - so they are registered at runtime on
 *   free tiles near the small furnace (press 2334,3674; firebox 2335,3674) and the
 *   west wall (x 2312-2314, y 3665-3673). The Colony gate (12723/12725) is not in
 *   the shared door plugin, so the quest opens it by stepping the player across
 *   it (the tunnel hole next to it is the shared Agility shortcut).
 * - The battles are real owner-only spawns (8x sea troll 4308, fishing trolls
 *   4309/4310/4311, queen 4315); the Wise Old Man's Saradomin Strikes and his rune
 *   hand-ins are not simulated, and the "out of runes" variant is unreachable.
 * - The Wise Old Man spawns are static, and both the tunnel NPC (4300) and the
 *   inside one (3365) exist once the transform varbit reaches their range; the
 *   lines where he teleports are transcript text only, so he can linger a stage.
 * - Fishing the quest spot is one fresh monkfish per click with no level roll or
 *   Fishing XP; cooking it always succeeds (no burn roll) and gives no Cooking XP.
 * - The nested "no hammer" jumps in Franklin's repair dialogue lost their target in
 *   the dump, so Franklin lends the hammer as soon as the sheets branch is chosen;
 *   Malignius takes every bone the player is carrying in one hand-in.
 * - The Sea Troll Queen is spawned outside the colony gate (2345,3645) during the
 *   final cutscene rather than in front of the player; talking to Herman again at
 *   that stage offers the wiki's replay/teleport-to-her choice.
 * - Arnold's bank/trade/collect refusals and the poll booth/deposit box lines are
 *   not wired; Malignius has no post-seed variant in the dump, so the standard
 *   page plays once the seeds are handed over.
 * - Placeholder amounts ([amount], [Amount], the Franklin wall/sheet alternatives)
 *   are filled from live counts.
 */
module.exports = function registerSwanSongQuest(api) {
  const {
    Animation,
    GameObject,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const {
    registerQuest,
    refreshQuestList,
    loadTranscripts,
    startTranscript,
    QUEST_POINTS_ATTRIBUTE,
  } = require("../QuestRuntime");

  const PAGE = "Swan Song";

  const VARP_SWAN_SONG = 723; // "swansong"
  const VARBIT_SWAN_SONG = 2098; // "swansong", varp 723 bits 0-8
  const REQUIRED_QUEST_POINTS = 100;

  const STAGE_STARTED = 5;
  const STAGE_RUNES_WANTED = 10;
  const STAGE_COLONY = 30;
  const STAGE_BATTLE = 40;
  const STAGE_INSIDE = 55;
  const STAGE_JOBS = 65;
  const STAGE_JOBS_DONE = 80;
  const STAGE_ARMY = 90;
  const STAGE_MALIGNIUS = 110;
  const STAGE_CRAFTER = 120;
  const STAGE_SEEDS = 130;
  const STAGE_QUEEN = 140;
  const STAGE_QUEEN_DEAD = 150;
  const STAGE_COMPLETE = 190;

  const HERMAN_NPC_ID = NpcIdentifiers.HERMAN_CARANOS; // 4291
  const FRANKLIN_NPC_ID = NpcIdentifiers.FRANKLIN_CARANOS; // 4292
  const ARNOLD_NPC_ID = NpcIdentifiers.ARNOLD_LYDSPOR; // 4293
  const RAMARA_NPC_ID = NpcIdentifiers.RAMARA_DU_CROISSANT; // 4296
  const MALIGNIUS_NPC_ID = NpcIdentifiers.MALIGNIUS_MORTIFER; // 1783
  const FRUMSCONE_NPC_ID = NpcIdentifiers.WIZARD_FRUMSCONE; // 3246
  const HELPFUL_MASTER_CRAFTER_ID = NpcIdentifiers.MASTER_CRAFTER_2; // 5811, southernmost (door side)
  const MASTER_CRAFTER_IDS = new Set([
    NpcIdentifiers.MASTER_CRAFTER, // 5810
    NpcIdentifiers.MASTER_CRAFTER_2, // 5811
    NpcIdentifiers.MASTER_CRAFTER_3, // 5812
  ]);
  const WISE_OLD_MAN_CHATHEAD = NpcIdentifiers.WISE_OLD_MAN_4; // 2112, the colony transform
  const WISE_OLD_MAN_IDS = new Set([
    NpcIdentifiers.WISE_OLD_MAN, // 2108
    NpcIdentifiers.WISE_OLD_MAN_2, // 2110
    NpcIdentifiers.WISE_OLD_MAN_3, // 2111
    NpcIdentifiers.WISE_OLD_MAN_4, // 2112
    NpcIdentifiers.WISE_OLD_MAN_5, // 2113
  ]);
  const FISHING_SPOT_NPC_ID = NpcIdentifiers.FISHING_SPOT_55; // 4316
  const SEA_TROLL_BATTLE_NPC_ID = NpcIdentifiers.SEA_TROLL; // 4308, level 79
  const SEA_TROLL_65_NPC_ID = NpcIdentifiers.SEA_TROLL_2; // 4309
  const SEA_TROLL_87_NPC_ID = NpcIdentifiers.SEA_TROLL_3; // 4310
  const SEA_TROLL_101_NPC_ID = NpcIdentifiers.SEA_TROLL_4; // 4311
  const SEA_TROLL_QUEEN_NPC_ID = NpcIdentifiers.SEA_TROLL_QUEEN; // 4315

  const MIST_RUNE_ITEM_ID = ItemIdentifiers.MIST_RUNE; // 4695
  const LAVA_RUNE_ITEM_ID = ItemIdentifiers.LAVA_RUNE; // 4699
  const BLOOD_RUNE_ITEM_ID = ItemIdentifiers.BLOOD_RUNE; // 565
  const BONES_ITEM_ID = ItemIdentifiers.BONES; // 526
  const IRON_BAR_ITEM_ID = ItemIdentifiers.IRON_BAR; // 2351
  const IRON_SHEET_ITEM_ID = ItemIdentifiers.IRON_SHEET; // 7941
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const LOGS_ITEM_ID = ItemIdentifiers.LOGS; // 1511
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const FRESH_MONKFISH_ITEM_ID = ItemIdentifiers.FRESH_MONKFISH; // 7942, raw
  const COOKED_MONKFISH_ITEM_ID = ItemIdentifiers.FRESH_MONKFISH_2; // 7943, cooked
  const RAW_MONKFISH_ITEM_ID = ItemIdentifiers.RAW_MONKFISH; // 7944, wrong fish
  const MONKFISH_ITEM_ID = ItemIdentifiers.MONKFISH; // 7946, wrong fish
  const SMALL_FISHING_NET_ITEM_ID = ItemIdentifiers.SMALL_FISHING_NET; // 303
  const BROWN_APRON_ITEM_ID = ItemIdentifiers.BROWN_APRON; // 1757
  const POT_ITEM_ID = ItemIdentifiers.POT; // 1931
  const POT_LID_ITEM_ID = ItemIdentifiers.POT_LID; // 4440
  const AIRTIGHT_POT_ITEM_ID = ItemIdentifiers.AIRTIGHT_POT; // 4436
  const BONE_SEEDS_ITEM_ID = ItemIdentifiers.BONE_SEEDS; // 7950
  const HERMANS_BOOK_ITEM_ID = ItemIdentifiers.HERMANS_BOOK; // 7951
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995

  const COLONY_GATE_IDS = new Set([
    ObjectIdentifiers.COLONY_GATE, // 12723
    ObjectIdentifiers.COLONY_GATE_2, // 12725
  ]);
  const HERMANS_DESK_OBJECT_ID = ObjectIdentifiers.HERMANS_DESK; // 13607
  const COLONY_RANGE_OBJECT_ID = ObjectIdentifiers.RANGE_7; // 12611
  const METAL_PRESS_OBJECT_ID = ObjectIdentifiers.METAL_PRESS; // 13592
  const FIREBOX_OBJECT_ID = ObjectIdentifiers.FIREBOX; // 13594
  const BROKEN_WALL_OBJECT_ID = ObjectIdentifiers.BROKEN_WALL_3; // 13583

  const ONE_SMALL_FAVOUR_KEY = "one_small_favour";
  const GARDEN_OF_TRANQUILLITY_KEY = "garden_of_tranquillity";
  const LEGENDS_QUEST_KEY = "legends_quest";

  const FRANKLIN_MET_ATTRIBUTE = "quest.swan_song.franklin-met";
  const FIREBOX_LOADED_ATTRIBUTE = "quest.swan_song.firebox-loaded";
  const FIREBOX_LIT_ATTRIBUTE = "quest.swan_song.firebox-lit";
  const SHEETS_MADE_ATTRIBUTE = "quest.swan_song.sheets-made";
  const WALL_BITS_ATTRIBUTE = "quest.swan_song.wall-bits";
  const ARNOLD_MET_ATTRIBUTE = "quest.swan_song.arnold-met";
  const MONKFISH_GIVEN_ATTRIBUTE = "quest.swan_song.monkfish-given";
  const CATCH_COUNT_ATTRIBUTE = "quest.swan_song.catch-count";
  const MALIGNIUS_MET_ATTRIBUTE = "quest.swan_song.malignius-met";
  const BONES_GIVEN_ATTRIBUTE = "quest.swan_song.bones-given";
  const CRAFTER_ASKED_ATTRIBUTE = "quest.swan_song.crafter-asked";
  const CRAFTER_TOLD_ATTRIBUTE = "quest.swan_song.crafter-told";
  const FRUMSCONE_DECLINED_ATTRIBUTE = "quest.swan_song.frumscone-declined";
  const ENTERED_COLONY_ATTRIBUTE = "quest.swan_song.entered-colony";
  const TROLLS_LEFT_ATTRIBUTE = "quest.swan_song.trolls-left";

  // Player tiles are free of map scenery (checked against the cache collision map).
  const PRESS_TILE = { x: 2334, y: 3674, z: 0 };
  const FIREBOX_TILE = { x: 2335, y: 3674, z: 0 };
  const WALL_TILES = [
    { x: 2312, y: 3665, z: 0 },
    { x: 2314, y: 3667, z: 0 },
    { x: 2313, y: 3669, z: 0 },
    { x: 2314, y: 3671, z: 0 },
    { x: 2312, y: 3673, z: 0 },
  ];
  // Outside the colony gate, north of the tunnel hole where the Wise Old Man waits.
  const BATTLE_TILES = [
    { x: 2335, y: 3648, z: 0 },
    { x: 2329, y: 3650, z: 0 },
    { x: 2324, y: 3653, z: 0 },
    { x: 2331, y: 3655, z: 0 },
    { x: 2338, y: 3655, z: 0 },
    { x: 2343, y: 3657, z: 0 },
    // These two replace 2349,3653 and 2352,3648, which had no walkable path
    // from the landing outside the gate and soft-locked the battle.
    { x: 2346, y: 3658, z: 0 },
    { x: 2340, y: 3660, z: 0 },
  ];
  const SEA_TROLL_QUEEN_TILE = { x: 2345, y: 3645, z: 0 };
  const COLONY_LANDING_TILE = { x: 2345, y: 3664, z: 0 };
  const GATE_TILE_SOUTH = { x: 2345, y: 3663, z: 0 }; // inside the colony
  const GATE_TILE_NORTH = { x: 2343, y: 3661, z: 0 }; // outside, by the tunnel hole
  const FISHING_ANIMATION_ID = 621; // human_fishing_net

  const COLONY_ZONE = { minX: 2311, maxX: 2360, minY: 3663, maxY: 3700, levels: [0] };

  const MALIGNIUS_BONES_VARIANT = "talking-to-malignius-mortifer-giving-bones-to-malignius";
  const FINAL_CUTSCENE_VARIANT = "the-final-battle-final-battle-cutscene";

  /** Sea-troll spawns per player, cleared on logout. */
  const BATTLE_TROLLS = new Map();
  const FISHING_TROLLS = new Map();
  const QUEENS = new Map();
  let objectsInstalled = false;

  let quest;

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function flag(player, attribute) {
    return Number(player.getAttribute(attribute)) || 0;
  }

  function setFlag(player, attribute, value = 1) {
    player.setAttribute(attribute, value);
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Wiki: 66 Magic, 62 Cooking, 62 Fishing, 45 Smithing, 42 Firemaking and 40 Crafting. */
  const REQUIRED_SKILLS = [
    { skill: Skill.MAGIC, level: 66, label: "Magic" },
    { skill: Skill.COOKING, level: 62, label: "Cooking" },
    { skill: Skill.FISHING, level: 62, label: "Fishing" },
    { skill: Skill.SMITHING, level: 45, label: "Smithing" },
    { skill: Skill.FIREMAKING, level: 42, label: "Firemaking" },
    { skill: Skill.CRAFTING, level: 40, label: "Crafting" },
  ];

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  function meetsRequirements(player) {
    return (
      (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= REQUIRED_QUEST_POINTS &&
      isQuestComplete(player, ONE_SMALL_FAVOUR_KEY) &&
      isQuestComplete(player, GARDEN_OF_TRANQUILLITY_KEY) &&
      missingSkillRequirements(player).length === 0
    );
  }

  function hasRunes(player) {
    return (
      held(player, BLOOD_RUNE_ITEM_ID, 5) &&
      held(player, LAVA_RUNE_ITEM_ID, 10) &&
      held(player, MIST_RUNE_ITEM_ID, 10)
    );
  }

  function consumeRunes(player) {
    if (!hasRunes(player)) return false;
    const inventory = player.getInventory();
    inventory.deleteNumber(BLOOD_RUNE_ITEM_ID, 5);
    inventory.deleteNumber(LAVA_RUNE_ITEM_ID, 10);
    inventory.deleteNumber(MIST_RUNE_ITEM_ID, 10);
    return true;
  }

  function franklinDone(player) {
    return wallsRepaired(player) >= WALL_TILES.length;
  }

  function arnoldDone(player) {
    return flag(player, MONKFISH_GIVEN_ATTRIBUTE) >= 5;
  }

  function wallsRepaired(player) {
    let bits = flag(player, WALL_BITS_ATTRIBUTE);
    let count = 0;
    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
    return count;
  }

  function wallIndexAt(location) {
    if (!location) return -1;
    return WALL_TILES.findIndex((tile) => tile.x === location.x && tile.y === location.y);
  }

  function sheetCount(player) {
    return player.getInventory().getAmount(IRON_SHEET_ITEM_ID);
  }

  function freshMonkfishCount(player) {
    return player.getInventory().getAmount(FRESH_MONKFISH_ITEM_ID);
  }

  function cookedMonkfishCount(player) {
    return player.getInventory().getAmount(COOKED_MONKFISH_ITEM_ID);
  }

  function hasWrongFish(player) {
    return held(player, RAW_MONKFISH_ITEM_ID) || held(player, MONKFISH_ITEM_ID);
  }

  /**
   * Bones the "giving-bones" dialogue's action (MpGLgS) will take. The wiki
   * conditions are pre-resolved when the transcript is flattened, before the
   * action runs, so they must count the hand-in to pick the right branch.
   */
  function pendingBoneHandIn(player) {
    return Math.min(
      player.getInventory().getAmount(BONES_ITEM_ID),
      Math.max(0, 7 - flag(player, BONES_GIVEN_ATTRIBUTE))
    );
  }

  function hasPotAndLid(player) {
    return (
      held(player, AIRTIGHT_POT_ITEM_ID) ||
      (held(player, POT_ITEM_ID) && held(player, POT_LID_ITEM_ID))
    );
  }

  function wearingSaradomin(player) {
    const equipment = player.getEquipment();
    for (let slot = 0; slot <= 13; slot++) {
      const item = equipment.get(slot);
      const itemId = item?.getId?.();
      if (!itemId) continue;
      const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
      if (name.includes("saradomin") && !name.includes("cape")) return true;
    }
    return false;
  }

  function variantSteps(variant) {
    const record = loadTranscripts(api)?.[PAGE];
    const steps = record?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  function play(player, npcId, variant) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  function bothJobsDone(player) {
    if (quest.getStage(player) !== STAGE_JOBS) return;
    if (franklinDone(player) && arnoldDone(player)) quest.setStage(player, STAGE_JOBS_DONE);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === HERMAN_NPC_ID) {
      switch (stage) {
        case 0:
          return "starting-out";
        case STAGE_STARTED:
        case STAGE_RUNES_WANTED:
        case STAGE_COLONY:
        case STAGE_BATTLE:
          return "starting-out-talking-to-herman-again";
        case STAGE_INSIDE:
          return "inside-the-colony-talking-to-herman";
        case STAGE_JOBS:
          return "inside-the-colony-talking-to-herman-again";
        case STAGE_JOBS_DONE:
          return "back-to-herman-talking-to-the-herman";
        case STAGE_ARMY:
          return "back-to-herman-talking-to-the-herman-again";
        case STAGE_MALIGNIUS:
        case STAGE_CRAFTER:
          return "talking-to-wizard-frumscone-talking-to-herman-again-before-talking-to-malignius";
        case STAGE_SEEDS:
          return "the-final-battle";
        case STAGE_QUEEN:
          return "the-final-battle-entering-the-colony-without-defeating-the-queen";
        case STAGE_QUEEN_DEAD:
          return "finishing-up-talking-to-herman-one-last-time";
        default:
          return null;
      }
    }

    if (WISE_OLD_MAN_IDS.has(npcId)) {
      if (stage === STAGE_STARTED) return { page: PAGE, variant: "talking-to-the-wise-old-man" };
      if (stage === STAGE_RUNES_WANTED) {
        return {
          page: PAGE,
          variant: "talking-to-the-wise-old-man-talking-to-the-wise-old-man-again-if-the-player-didn-t-bring-the-runes-before",
        };
      }
      if (stage === STAGE_COLONY) return { page: PAGE, variant: "returning-to-the-colony" };
      if (stage === STAGE_BATTLE) {
        return {
          page: PAGE,
          variant: flag(player, TROLLS_LEFT_ATTRIBUTE) > 0
            ? "outside-the-colony-attempting-to-talk-to-him-during-the-battle"
            : "outside-the-colony-speaking-to-the-wise-old-man-after-defeating-the-sea-trolls",
        };
      }
      if (stage === STAGE_INSIDE) {
        return { page: PAGE, variant: "returning-to-the-colony-talking-to-the-wise-old-man-again" };
      }
      if (stage >= STAGE_JOBS && stage < STAGE_COMPLETE) {
        return { page: PAGE, variant: "back-to-herman-talking-to-the-wise-old-man" };
      }
      return null;
    }

    if (npcId === FRANKLIN_NPC_ID) {
      if (stage >= STAGE_ARMY && stage < STAGE_COMPLETE) return "back-to-herman-talking-to-franklin-again";
      if (stage !== STAGE_JOBS && stage !== STAGE_JOBS_DONE) return null;
      if (!flag(player, FRANKLIN_MET_ATTRIBUTE)) return "helping-franklin";
      if (franklinDone(player)) {
        return "helping-franklin-talking-to-franklin-after-fixing-the-wall";
      }
      if (!flag(player, FIREBOX_LIT_ATTRIBUTE)) {
        return "helping-franklin-talking-to-franklin-before-lighting-the-firebox";
      }
      return "helping-franklin-talking-to-franklin-after-lighting-the-firebox-and-before-fixing-the-wall";
    }

    if (npcId === ARNOLD_NPC_ID) {
      if (stage >= STAGE_ARMY && stage < STAGE_COMPLETE) return "back-to-herman-talking-to-arnold-again";
      if (stage !== STAGE_JOBS && stage !== STAGE_JOBS_DONE) return null;
      if (!flag(player, ARNOLD_MET_ATTRIBUTE)) return "helping-arnold";
      if (arnoldDone(player)) {
        return franklinDone(player)
          ? "helping-arnold-talking-to-arnold-after-helping-franklin"
          : "helping-arnold-talking-to-arnold-before-helping-franklin";
      }
      if (freshMonkfishCount(player) > 0 || cookedMonkfishCount(player) > 0) {
        return "helping-arnold-talking-to-arnold-after-fishing";
      }
      return "helping-arnold-talking-to-arnold-again";
    }

    if (npcId === RAMARA_NPC_ID) {
      return stage >= STAGE_SEEDS && stage < STAGE_COMPLETE
        ? "finishing-up-talking-to-ramara-du-croissant"
        : null;
    }

    if (npcId === FRUMSCONE_NPC_ID) {
      if (stage === STAGE_ARMY) {
        return flag(player, FRUMSCONE_DECLINED_ATTRIBUTE)
          ? "talking-to-wizard-frumscone-talking-to-frumscone-after-declining-originally"
          : "talking-to-wizard-frumscone";
      }
      if (stage === STAGE_MALIGNIUS && flag(player, BONES_GIVEN_ATTRIBUTE) < 7) {
        return "talking-to-wizard-frumscone-talking-to-frumscone-again";
      }
      return null;
    }

    if (npcId === MALIGNIUS_NPC_ID) {
      if (stage < STAGE_MALIGNIUS || stage >= STAGE_SEEDS) return null;
      if (flag(player, BONES_GIVEN_ATTRIBUTE) >= 7) {
        return {
          page: PAGE,
          variant: flag(player, CRAFTER_TOLD_ATTRIBUTE)
            ? "back-to-malignius-mortifer"
            : "talking-to-malignius-mortifer-talking-to-malignius-again-before-speaking-to-master-crafter",
        };
      }
      if (flag(player, MALIGNIUS_MET_ATTRIBUTE)) {
        return {
          page: PAGE,
          variant: held(player, BONES_ITEM_ID)
            ? "talking-to-malignius-mortifer-giving-bones-to-malignius"
            : "talking-to-malignius-mortifer-talking-to-malignius-again-if-bones-haven-t-been-given-yet",
        };
      }
      return { page: PAGE, variant: "talking-to-malignius-mortifer" };
    }

    if (MASTER_CRAFTER_IDS.has(npcId)) {
      if (stage !== STAGE_MALIGNIUS || flag(player, BONES_GIVEN_ATTRIBUTE) < 7) return null;
      if (flag(player, CRAFTER_TOLD_ATTRIBUTE)) return null;
      if (npcId !== HELPFUL_MASTER_CRAFTER_ID) {
        return "talking-to-a-master-crafter-talking-to-any-other-master-crafter-including-the-one-with-a-skillcape";
      }
      return flag(player, CRAFTER_ASKED_ATTRIBUTE)
        ? "talking-to-a-master-crafter-talking-to-the-master-crafter-near-the-door-again"
        : "talking-to-a-master-crafter-talking-to-the-non-descript-master-crafter-closest-to-the-door";
    }

    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    switch (stepId) {
      case "5oNrjZ": // If the player does not meet the quest requirements:
        return npcId === HERMAN_NPC_ID ? !meetsRequirements(player) : null;
      case "i58RVR": // If the player has not completed Legends' Quest:
        return npcId === HERMAN_NPC_ID ? !isQuestComplete(player, LEGENDS_QUEST_KEY) : null;
      case "Nh4IiY": // If the player has completed Legends' Quest:
        return npcId === HERMAN_NPC_ID ? isQuestComplete(player, LEGENDS_QUEST_KEY) : null;
      case "FVui5_": // Has spoken to the Wise Old Man before (Garden of Tranquillity is a prerequisite):
        return npcId === HERMAN_NPC_ID ? true : null;
      case "2UtCWp": // Does not know he robbed the bank:
        return npcId === HERMAN_NPC_ID ? false : null;
      case "qGO-sR": // Knows he robbed the bank:
        return npcId === HERMAN_NPC_ID ? true : null;
      case "t-IZuF": // Bypasses the spoken-to condition (impossible with the prerequisite):
        return npcId === HERMAN_NPC_ID ? false : null;
      case "X9X27D": // If player already has them with them:
      case "AfEkRD": // If the player is carrying all the runes:
        return hasRunes(player);
      case "HPERL1": // If the player does not have the required runes:
      case "dLGcYH": // If the player does not have all of the required runes:
        return !hasRunes(player);
      case "G5F32F": // If the player hasn't helped either of them:
        return !franklinDone(player) && !arnoldDone(player);
      case "5w0HRa": // If the player has started helping either of them:
        return franklinDone(player) || arnoldDone(player);
      case "9eQGwY": // If the player is not carrying a tinderbox:
        return !held(player, TINDERBOX_ITEM_ID);
      case "5C-ylb": // If the player has a tinderbox:
        return held(player, TINDERBOX_ITEM_ID);
      case "3mJNZe": // With no sheets in inventory and no repaired walls:
        return wallsRepaired(player) === 0 && sheetCount(player) === 0;
      case "On3BEQ": // If the player doesn't have a hammer:
        return !held(player, HAMMER_ITEM_ID);
      case "3mtt9Q": // The nested "no hammer" jumps lost their target in the dump; skipped,
      case "xkBhJa": // the hammer is lent when the outer branch is chosen instead.
        return false;
      case "v4BY3N": // After making some sheets or repairing some walls:
        return (
          wallsRepaired(player) > 0 ||
          sheetCount(player) > 0 ||
          flag(player, SHEETS_MADE_ATTRIBUTE) > 0
        );
      case "9KFPTE": // With the correct amount of sheets:
        return wallsRepaired(player) < WALL_TILES.length && sheetCount(player) >= WALL_TILES.length - wallsRepaired(player);
      case "ZkXjEJ": // If the player does not have a net:
        return !held(player, SMALL_FISHING_NET_ITEM_ID);
      case "lQlQDc": // With no fish:
        return freshMonkfishCount(player) === 0 && cookedMonkfishCount(player) === 0;
      case "1ZCW1F": // With the wrong type of fish:
        return hasWrongFish(player);
      case "BzJxEc": // On the first Fresh monkfish:
        return flag(player, CATCH_COUNT_ATTRIBUTE) === 1;
      case "5blqR_": // On the third Fresh monkfish:
        return flag(player, CATCH_COUNT_ATTRIBUTE) === 3;
      case "ELjkDo": // On the fourth Fresh monkfish:
        return flag(player, CATCH_COUNT_ATTRIBUTE) === 4;
      case "bahNbb": // Before cooking monkfish:
        return cookedMonkfishCount(player) === 0 && freshMonkfishCount(player) > 0;
      case "H3mchg": // With some cooked monkfish:
        return (
          cookedMonkfishCount(player) > 0 &&
          flag(player, MONKFISH_GIVEN_ATTRIBUTE) + cookedMonkfishCount(player) < 5
        );
      case "QvhCb6": // After giving Arnold all 5 cooked monkfish:
        return (
          flag(player, MONKFISH_GIVEN_ATTRIBUTE) >= 5 ||
          (cookedMonkfishCount(player) > 0 &&
            flag(player, MONKFISH_GIVEN_ATTRIBUTE) + cookedMonkfishCount(player) >= 5)
        );
      case "d9xaQv": // Before helping Franklin:
        return !franklinDone(player);
      case "Of3V37": // After helping Franklin:
        return franklinDone(player);
      case "zzi72z": // If the player is wearing equipment aligned with Saradomin:
      case "DATAJE":
        return npcId === MALIGNIUS_NPC_ID ? wearingSaradomin(player) : null;
      case "XaV7zM": // With no bones in inventory:
        return !held(player, BONES_ITEM_ID);
      case "S5TuMT": // If the player already has the bones:
        return held(player, BONES_ITEM_ID);
      case "g6IK0L": // If Malignius still needs bones:
        return flag(player, BONES_GIVEN_ATTRIBUTE) + pendingBoneHandIn(player) < 7;
      case "s6AEM7": // After giving all seven bones:
        return flag(player, BONES_GIVEN_ATTRIBUTE) + pendingBoneHandIn(player) >= 7;
      case "rk1uo7": // If the player has a brown apron:
        return held(player, BROWN_APRON_ITEM_ID);
      case "7M59Tm": // If the player does not have a brown apron:
        return !held(player, BROWN_APRON_ITEM_ID);
      case "fef4yN": // If the player doesn't have a pot and pot lid:
        return !hasPotAndLid(player);
      case "-ie56h": // If the player has a pot and pot lid:
        return hasPotAndLid(player);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId === FRUMSCONE_NPC_ID) {
      if (option === "Enough of this - I'm off.") {
        setFlag(player, FRUMSCONE_DECLINED_ATTRIBUTE);
        return;
      }
      if (option === "I'll see what the necromancer needs me to do.") {
        if (quest.getStage(player) === STAGE_ARMY) quest.setStage(player, STAGE_MALIGNIUS);
      }
    }
  }

  /** Fills the wiki's "[amount]" style blanks from live counts. */
  function fillPlaceholders(event, player, npcId) {
    let text = event.text;
    if (typeof text !== "string") return;
    if (npcId === FRANKLIN_NPC_ID) {
      if (text.includes("[the broken sections/")) {
        const remaining = WALL_TILES.length - wallsRepaired(player);
        const label =
          remaining >= WALL_TILES.length
            ? "the broken sections"
            : remaining === 1
              ? "the last piece of wall"
              : `${remaining} more bits of wall`;
        text = text.replace(
          "[the broken sections/[Amount] more bits of wall/the last piece of wall]",
          label
        );
      }
      if (text.includes("[[Amount] more/another]")) {
        const missing = Math.max(1, WALL_TILES.length - wallsRepaired(player) - sheetCount(player));
        const label = missing === 1 ? "another iron sheet" : `${missing} more iron sheets`;
        text = text
          .replace("[[Amount] more/another] iron [sheets/sheet]", label)
          .replace("[[Amount] more/another]", missing === 1 ? "another" : `${missing} more`);
      }
    } else if (npcId === ARNOLD_NPC_ID && text.includes("[amount]")) {
      const remaining = Math.max(
        0,
        5 - flag(player, MONKFISH_GIVEN_ATTRIBUTE) - cookedMonkfishCount(player)
      );
      text = text.replace("[amount]", String(remaining));
    } else if (npcId === MALIGNIUS_NPC_ID && /\[Amount\]/i.test(text)) {
      text = text.replace(/\[Amount\]/i, String(Math.max(0, 7 - flag(player, BONES_GIVEN_ATTRIBUTE))));
    }
    event.text = text;
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    fillPlaceholders(event, player, npcId);
    const stage = quest.getStage(player);

    if (npcId === HERMAN_NPC_ID) {
      if (stage === 0 && text === "Yes, that's right. And do watch out for the sea trolls!") {
        if (!meetsRequirements(player)) {
          notifySkillRequirements(player);
          return;
        }
        quest.setStage(player, STAGE_STARTED);
        return;
      }
      if (stage === STAGE_INSIDE && text === "Yes, yes... now please excuse us.") {
        quest.setStage(player, STAGE_JOBS);
        return;
      }
      if (stage === STAGE_JOBS_DONE && text === "Yes, please hurry!") {
        quest.setStage(player, STAGE_ARMY);
        return;
      }
      return;
    }

    if (npcId === FRANKLIN_NPC_ID) {
      if (text.startsWith("Anyway,")) setFlag(player, FRANKLIN_MET_ATTRIBUTE);
      return;
    }

    if (npcId === ARNOLD_NPC_ID) {
      if (text.includes("You go catch 5 fresh monkfish")) setFlag(player, ARNOLD_MET_ATTRIBUTE);
      return;
    }

    if (npcId === MALIGNIUS_NPC_ID) {
      if (text.startsWith("Firstly, I need 7 bones")) setFlag(player, MALIGNIUS_MET_ATTRIBUTE);
      return;
    }

    if (MASTER_CRAFTER_IDS.has(npcId)) {
      if (text === "Yeah?" || text.startsWith("Hello, and welcome to the Crafting Guild")) {
        setFlag(player, CRAFTER_ASKED_ATTRIBUTE);
      }
      if (
        npcId === HELPFUL_MASTER_CRAFTER_ID &&
        text === "Yeah, yeah. You need to chill out more, dude."
      ) {
        setFlag(player, CRAFTER_TOLD_ATTRIBUTE);
        if (stage === STAGE_MALIGNIUS) quest.setStage(player, STAGE_CRAFTER);
      }
      return;
    }

    if (!WISE_OLD_MAN_IDS.has(npcId)) return;
    if (stage === STAGE_STARTED && text === "Right, 5 Blood runes, 10 Lava runes and 10 Mist runes.") {
      quest.setStage(player, STAGE_RUNES_WANTED);
      return;
    }
    if (stage === STAGE_COLONY && text === "Excellent. I think this little tunnel will lead us there...") {
      startColonyBattle(player);
    }
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    // The "no hammer" jumps nested under these branches lost their target in the
    // transcript dump, so Franklin lends his hammer as soon as the branch is taken.
    if ((stepId === "v4BY3N" || stepId === "9KFPTE") && !held(player, HAMMER_ITEM_ID)) {
      player.getInventory().adds(HAMMER_ITEM_ID, 1);
    }
    if (stepId === "H3mchg" || stepId === "QvhCb6") {
      handInMonkfish(player);
      return;
    }
    if (stepId === "BzJxEc") {
      spawnFishingTroll(player, SEA_TROLL_65_NPC_ID);
      return;
    }
    if (stepId === "5blqR_") {
      spawnFishingTroll(player, SEA_TROLL_87_NPC_ID);
      return;
    }
    if (stepId === "ELjkDo") {
      spawnFishingTroll(player, SEA_TROLL_101_NPC_ID);
      return;
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;

    switch (stepId) {
      // Flashback and battle stage directions: transcript text only.
      case "u5jAzl":
      case "hNciWY":
      case "L5g_xg":
      case "rXW_xf":
      case "HgNl4Z":
      case "W04stv":
      case "SKN5gZ":
      case "bFjvLe":
      case "7_fNz5":
      case "DtMdnH":
      case "U_qTlY":
      case "NOSOn4":
      case "gluoD6":
      case "k5z-2w":
      case "zcv-s8":
      case "JTr54B":
      case "L-Xlyw":
      case "evQhgd":
      case "nhBFeR":
        event.handled = true;
        return;

      case "wRvY4K": // The Wise Old Man teleports away (runes handed over, first meeting).
      case "jATJSI": // The Wise Old Man teleports away (runes handed over, repeat visit).
        if (!WISE_OLD_MAN_IDS.has(npcId)) return;
        event.handled = true;
        if (consumeRunes(player)) quest.setStage(player, STAGE_COLONY);
        return;

      case "Wa5fJu": // Receive Herman's book.
        event.handled = true;
        if (!held(player, HERMANS_BOOK_ITEM_ID)) {
          player.getInventory().adds(HERMANS_BOOK_ITEM_ID, 1);
        }
        return;

      case "0s9YAn": // Receive Tinderbox.
        if (npcId !== FRANKLIN_NPC_ID) return;
        event.handled = true;
        setFlag(player, FRANKLIN_MET_ATTRIBUTE);
        if (!held(player, TINDERBOX_ITEM_ID)) player.getInventory().adds(TINDERBOX_ITEM_ID, 1);
        return;

      case "OH9j54": // Receive Hammer.
        if (npcId !== FRANKLIN_NPC_ID) return;
        event.handled = true;
        if (!held(player, HAMMER_ITEM_ID)) player.getInventory().adds(HAMMER_ITEM_ID, 1);
        return;

      case "49LcQc": // Receive Small fishing net.
        if (npcId !== ARNOLD_NPC_ID) return;
        event.handled = true;
        setFlag(player, ARNOLD_MET_ATTRIBUTE);
        if (!held(player, SMALL_FISHING_NET_ITEM_ID)) {
          player.getInventory().adds(SMALL_FISHING_NET_ITEM_ID, 1);
        }
        return;

      case "MpGLgS": // Give Bones: Malignius takes every bone the player is carrying.
        if (npcId !== MALIGNIUS_NPC_ID) return;
        event.handled = true;
        setFlag(player, MALIGNIUS_MET_ATTRIBUTE);
        {
          const carried = player.getInventory().getAmount(BONES_ITEM_ID);
          const wanted = Math.max(0, 7 - flag(player, BONES_GIVEN_ATTRIBUTE));
          const taken = Math.min(carried, wanted);
          if (taken > 0) {
            player.getInventory().deleteNumber(BONES_ITEM_ID, taken);
            setFlag(player, BONES_GIVEN_ATTRIBUTE, flag(player, BONES_GIVEN_ATTRIBUTE) + taken);
          }
        }
        return;

      case "KIxcN0": // Receive Brown apron.
        if (npcId !== MALIGNIUS_NPC_ID) return;
        event.handled = true;
        if (!held(player, BROWN_APRON_ITEM_ID)) player.getInventory().adds(BROWN_APRON_ITEM_ID, 1);
        return;

      case "v_BJCt": // Receive Bone seeds.
        if (npcId !== MALIGNIUS_NPC_ID) return;
        event.handled = true;
        giveBoneSeeds(player);
        return;

      case "wy4re3": // Teleported to the Fishing Colony.
        if (npcId !== MALIGNIUS_NPC_ID) return;
        event.handled = true;
        player.moveTo(
          new Location(COLONY_LANDING_TILE.x, COLONY_LANDING_TILE.y, COLONY_LANDING_TILE.z)
        );
        return;

      case "WrdUdz": // Give Bone seeds.
        event.handled = true;
        if (held(player, BONE_SEEDS_ITEM_ID)) player.getInventory().deleteNumber(BONE_SEEDS_ITEM_ID, 1);
        return;

      case "3yw1h6": // Cutscene begins: the queen fight is spliced in as this branch's steps.
        if (npcId !== HERMAN_NPC_ID) return;
        event.handled = true;
        startQueenFight(player);
        event.steps = variantSteps(FINAL_CUTSCENE_VARIANT);
        return;

      case "JFCRQM": // The player is transported in front of the queen.
        event.handled = true;
        ensureQueen(player);
        moveToQueen(player);
        return;

      case "RV_XI6": // Congratulations! Quest complete!
        if (npcId !== HERMAN_NPC_ID) return;
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;

      case "u8lbvG": // "Continues below": the bone hand-in dialogue.
        event.handled = true;
        event.steps = variantSteps(MALIGNIUS_BONES_VARIANT);
        return;

      default:
        return;
    }
  }

  // ==========================================================================
  // Item hand-ins and colony jobs
  // ==========================================================================

  function handInMonkfish(player) {
    const inventory = player.getInventory();
    const given = flag(player, MONKFISH_GIVEN_ATTRIBUTE);
    const hand = Math.min(cookedMonkfishCount(player), Math.max(0, 5 - given));
    if (hand > 0) inventory.deleteNumber(COOKED_MONKFISH_ITEM_ID, hand);
    setFlag(player, MONKFISH_GIVEN_ATTRIBUTE, Math.min(5, given + hand));
    bothJobsDone(player);
  }

  function giveBoneSeeds(player) {
    const inventory = player.getInventory();
    if (held(player, AIRTIGHT_POT_ITEM_ID)) {
      inventory.deleteNumber(AIRTIGHT_POT_ITEM_ID, 1);
    } else if (hasPotAndLid(player)) {
      inventory.deleteNumber(POT_ITEM_ID, 1);
      inventory.deleteNumber(POT_LID_ITEM_ID, 1);
    } else {
      return;
    }
    inventory.adds(BONE_SEEDS_ITEM_ID, 1);
    if (quest.getStage(player) === STAGE_CRAFTER || quest.getStage(player) === STAGE_MALIGNIUS) {
      quest.setStage(player, STAGE_SEEDS);
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (npcId !== FRANKLIN_NPC_ID || itemId !== IRON_SHEET_ITEM_ID) return;
    event.handled = true;
    play(player, FRANKLIN_NPC_ID, "helping-franklin-using-iron-sheet-on-franklin");
  }

  /** Logs/tinderbox/iron bars on the press; iron sheets on the broken walls; cooking. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    const stage = quest.getStage(player);

    if (objectId === FIREBOX_OBJECT_ID) {
      if (stage < STAGE_JOBS || stage >= STAGE_COMPLETE) return;
      event.handled = true;
      if (itemId === LOGS_ITEM_ID) {
        if (flag(player, FIREBOX_LOADED_ATTRIBUTE)) return;
        if (!held(player, LOGS_ITEM_ID)) return;
        player.getInventory().deleteNumber(LOGS_ITEM_ID, 1);
        setFlag(player, FIREBOX_LOADED_ATTRIBUTE);
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-the-logs-on-the-firebox");
        return;
      }
      if (itemId === TINDERBOX_ITEM_ID) {
        if (flag(player, FIREBOX_LIT_ATTRIBUTE)) {
          play(player, FRANKLIN_NPC_ID, "helping-franklin-using-the-tinderbox-on-the-firebox-again");
          return;
        }
        if (!flag(player, FIREBOX_LOADED_ATTRIBUTE)) {
          player.sendMessage("There is nothing in the firebox to light.");
          return;
        }
        setFlag(player, FIREBOX_LIT_ATTRIBUTE);
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-the-tinderbox-on-the-firebox");
        return;
      }
      if (itemId === IRON_BAR_ITEM_ID) {
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-the-iron-bars-on-the-firebox");
        return;
      }
      play(player, FRANKLIN_NPC_ID, "helping-franklin-using-any-other-item-on-the-metal-press-or-firebox");
      return;
    }

    if (objectId === METAL_PRESS_OBJECT_ID) {
      if (stage < STAGE_JOBS || stage >= STAGE_COMPLETE) return;
      event.handled = true;
      if (itemId === IRON_SHEET_ITEM_ID) {
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-an-iron-sheet-on-the-metal-press");
        return;
      }
      if (itemId === LOGS_ITEM_ID || itemId === TINDERBOX_ITEM_ID) {
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-the-tinderbox-or-logs-on-the-metal-press");
        return;
      }
      if (itemId === IRON_BAR_ITEM_ID) {
        if (!flag(player, FIREBOX_LIT_ATTRIBUTE)) {
          play(player, FRANKLIN_NPC_ID, "helping-franklin-attempting-to-flatten-iron-bars-before-lighting-the-firebox");
          return;
        }
        player.getInventory().deleteNumber(IRON_BAR_ITEM_ID, 1);
        player.getInventory().adds(IRON_SHEET_ITEM_ID, 1);
        setFlag(player, SHEETS_MADE_ATTRIBUTE, flag(player, SHEETS_MADE_ATTRIBUTE) + 1);
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-an-iron-bar-on-the-metal-press");
        return;
      }
      play(player, FRANKLIN_NPC_ID, "helping-franklin-using-any-other-item-on-the-metal-press-or-firebox");
      return;
    }

    if (objectId === BROKEN_WALL_OBJECT_ID) {
      const index = wallIndexAt(event.location);
      if (index < 0) return;
      event.handled = true;
      const repaired = (flag(player, WALL_BITS_ATTRIBUTE) & (1 << index)) !== 0;
      if (itemId === IRON_SHEET_ITEM_ID) {
        if (repaired) {
          play(player, FRANKLIN_NPC_ID, "helping-franklin-using-iron-sheet-on-an-already-repaired-wall");
          return;
        }
        if (stage < STAGE_JOBS || stage >= STAGE_COMPLETE) return;
        if (!held(player, IRON_SHEET_ITEM_ID)) return;
        player.getInventory().deleteNumber(IRON_SHEET_ITEM_ID, 1);
        setFlag(player, WALL_BITS_ATTRIBUTE, flag(player, WALL_BITS_ATTRIBUTE) | (1 << index));
        play(player, FRANKLIN_NPC_ID, "helping-franklin-using-iron-sheet-on-the-broken-wall");
        bothJobsDone(player);
        return;
      }
      if (itemId === HAMMER_ITEM_ID) {
        play(
          player,
          FRANKLIN_NPC_ID,
          repaired
            ? "helping-franklin-using-hammer-on-an-already-repaired-wall"
            : "helping-franklin-using-hammer-on-the-broken-wall"
        );
        return;
      }
      play(player, FRANKLIN_NPC_ID, "helping-franklin-using-any-other-item-on-the-broken-wall");
      return;
    }

    if (objectId === COLONY_RANGE_OBJECT_ID && itemId === FRESH_MONKFISH_ITEM_ID) {
      if (stage < STAGE_JOBS || stage >= STAGE_JOBS_DONE) return;
      event.handled = true;
      if (!held(player, FRESH_MONKFISH_ITEM_ID)) return;
      player.getInventory().deleteNumber(FRESH_MONKFISH_ITEM_ID, 1);
      player.getInventory().adds(COOKED_MONKFISH_ITEM_ID, 1);
      player.sendMessage("You cook the fresh monkfish.");
    }
  }

  /** Net on the quest's fishing spot: fresh monkfish one per click, trolls at 1/3/4. */
  function handleFishingSpot(event) {
    const { player, npcId, clickType, definition } = event;
    if (npcId !== FISHING_SPOT_NPC_ID) return false;
    if (definition?.getActions?.()[clickType - 1] !== "Net") return false;
    if (quest.getStage(player) !== STAGE_JOBS || !flag(player, ARNOLD_MET_ATTRIBUTE)) return false;
    if (!held(player, SMALL_FISHING_NET_ITEM_ID)) {
      event.handled = true;
      player.sendMessage("You don't have the right tool to fish there.");
      return true;
    }
    event.handled = true;
    catchFreshMonkfish(player);
    return true;
  }

  function catchFreshMonkfish(player) {
    if (player.getInventory().getFreeSlots() === 0) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().adds(FRESH_MONKFISH_ITEM_ID, 1);
    player.performAnimation(new Animation(FISHING_ANIMATION_ID));
    player.sendMessage("You catch a fresh monkfish.");
    setFlag(player, CATCH_COUNT_ATTRIBUTE, flag(player, CATCH_COUNT_ATTRIBUTE) + 1);
    play(player, WISE_OLD_MAN_CHATHEAD, "helping-arnold-while-fishing");
  }

  function spawnFishingTroll(player, npcId) {
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: npcId,
      x: location.getX() + 1,
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 2,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) return;
    const tracked = FISHING_TROLLS.get(player) ?? [];
    tracked.push(npc);
    FISHING_TROLLS.set(player, tracked);
  }

  // ==========================================================================
  // Objects, doors and the desk
  // ==========================================================================

  function registerObject(objectId, tile) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, tile.z), 10, 0, null);
    ObjectManager.register(object, true);
  }

  function installObjects() {
    if (objectsInstalled) return;
    objectsInstalled = true;
    registerObject(METAL_PRESS_OBJECT_ID, PRESS_TILE);
    registerObject(FIREBOX_OBJECT_ID, FIREBOX_TILE);
    for (const tile of WALL_TILES) registerObject(BROKEN_WALL_OBJECT_ID, tile);
  }

  function handleObjectInteraction(event) {
    const { player, objectId, clickType, definition, location } = event;

    if (COLONY_GATE_IDS.has(objectId)) {
      if (definition?.getActions?.()[clickType - 1] !== "Open") return;
      event.handled = true;
      const fromInside = player.getLocation().getY() > location.y;
      const target = fromInside ? GATE_TILE_NORTH : GATE_TILE_SOUTH;
      player.moveTo(new Location(target.x, target.y, target.z));
      return;
    }

    if (objectId === HERMANS_DESK_OBJECT_ID) {
      if (definition?.getActions?.()[clickType - 1] !== "Search") return;
      event.handled = true;
      if (quest.getStage(player) < STAGE_INSIDE || quest.getStage(player) >= STAGE_COMPLETE) return;
      if (held(player, HERMANS_BOOK_ITEM_ID)) {
        player.sendMessage("There is nothing else of interest on the desk.");
        return;
      }
      play(player, WISE_OLD_MAN_CHATHEAD, "inside-the-colony-searching-herman-s-desk");
    }
  }

  // ==========================================================================
  // Battles
  // ==========================================================================

  function startColonyBattle(player) {
    if (quest.getStage(player) !== STAGE_COLONY) return;
    quest.setStage(player, STAGE_BATTLE);
    setFlag(player, TROLLS_LEFT_ATTRIBUTE, BATTLE_TILES.length);
    spawnBattleTrolls(player, BATTLE_TILES.length);
  }

  function spawnBattleTrolls(player, count) {
    const spawns = [];
    for (let index = 0; index < Math.min(count, BATTLE_TILES.length); index++) {
      const tile = BATTLE_TILES[index];
      const npc = api.spawnNpc({
        id: SEA_TROLL_BATTLE_NPC_ID,
        x: tile.x,
        y: tile.y,
        z: tile.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) spawns.push(npc);
    }
    BATTLE_TROLLS.set(player, spawns);
  }

  function ensureBattleTrolls(player) {
    const left = flag(player, TROLLS_LEFT_ATTRIBUTE);
    if (left <= 0 || BATTLE_TROLLS.has(player)) return;
    spawnBattleTrolls(player, left);
  }

  function startQueenFight(player) {
    quest.setStage(player, STAGE_QUEEN);
    ensureQueen(player);
  }

  function ensureQueen(player) {
    if (QUEENS.has(player)) return;
    const npc = api.spawnNpc({
      id: SEA_TROLL_QUEEN_NPC_ID,
      x: SEA_TROLL_QUEEN_TILE.x,
      y: SEA_TROLL_QUEEN_TILE.y,
      z: SEA_TROLL_QUEEN_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) QUEENS.set(player, npc);
  }

  function moveToQueen(player) {
    const queen = QUEENS.get(player);
    const location = queen?.getLocation?.();
    const x = location?.getX?.() ?? SEA_TROLL_QUEEN_TILE.x;
    const y = location?.getY?.() ?? SEA_TROLL_QUEEN_TILE.y;
    const fromX = player.getLocation().getX();
    player.moveTo(new Location(x + (fromX <= x ? 3 : -3), y, 0));
  }

  function handleNpcDeath(event) {
    const killer = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;

    if (event.npcId === SEA_TROLL_BATTLE_NPC_ID && quest.getStage(killer) === STAGE_BATTLE) {
      const spawns = BATTLE_TROLLS.get(killer) ?? [];
      const index = spawns.indexOf(event.npc);
      if (index !== -1) spawns.splice(index, 1);
      const left = Math.max(0, flag(killer, TROLLS_LEFT_ATTRIBUTE) - 1);
      setFlag(killer, TROLLS_LEFT_ATTRIBUTE, left);
      if (left === 0) {
        for (const npc of spawns) api.removeNpc(npc);
        BATTLE_TROLLS.delete(killer);
      }
      return;
    }

    if (event.npcId === SEA_TROLL_QUEEN_NPC_ID && quest.getStage(killer) === STAGE_QUEEN) {
      QUEENS.delete(killer);
      quest.setStage(killer, STAGE_QUEEN_DEAD);
      play(killer, WISE_OLD_MAN_CHATHEAD, "finishing-up-after-killing-the-sea-troll-queen");
      return;
    }

    const fishing = FISHING_TROLLS.get(killer);
    if (fishing) {
      const index = fishing.indexOf(event.npc);
      if (index !== -1) fishing.splice(index, 1);
    }
  }

  // ==========================================================================
  // Zones, login and logout
  // ==========================================================================

  function handleZoneEnter({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    if (quest.getStage(player) !== STAGE_BATTLE) return;
    if (flag(player, TROLLS_LEFT_ATTRIBUTE) > 0) return;
    if (flag(player, ENTERED_COLONY_ATTRIBUTE)) return;
    setFlag(player, ENTERED_COLONY_ATTRIBUTE);
    quest.setStage(player, STAGE_INSIDE);
    play(player, WISE_OLD_MAN_CHATHEAD, "inside-the-colony-after-entering-the-colony");
  }

  function removeTracked(player) {
    for (const npc of BATTLE_TROLLS.get(player) ?? []) api.removeNpc(npc);
    BATTLE_TROLLS.delete(player);
    for (const npc of FISHING_TROLLS.get(player) ?? []) api.removeNpc(npc);
    FISHING_TROLLS.delete(player);
    const queen = QUEENS.get(player);
    if (queen) api.removeNpc(queen);
    QUEENS.delete(player);
  }

  function handleLogin({ player }) {
    installObjects();
    refreshQuestList(player);
    if (player?.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if (stage === STAGE_BATTLE) ensureBattleTrolls(player);
    if (stage === STAGE_QUEEN) ensureQueen(player);
  }

  function handleLogout({ player }) {
    removeTracked(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Herman Caranos asked me to bring the Wise Old Man to the</str>",
        "<str>Piscatoris Fishing Colony to save it from sea trolls.</str>",
        "<str>I fought the trolls, helped repair the Colony, raised an army</str>",
        "<str>of skeleton magi with Malignius Mortifer, and slew the</str>",
        "<str>Sea Troll Queen.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by talking to <col=800000>Herman Caranos</col>",
        "at the <col=800000>Piscatoris Fishing Colony</col>.",
        "",
        "I need to have completed <col=800000>One Small Favour</col> and",
        "<col=800000>Garden of Tranquillity</col>.",
      ];
    }
    if (stage === STAGE_STARTED) {
      return [
        "Herman Caranos asked me to fetch the <col=800000>Wise Old Man</col>",
        "from Draynor Village to save the Colony from sea trolls.",
      ];
    }
    if (stage === STAGE_RUNES_WANTED) {
      return [
        "The <col=800000>Wise Old Man</col> will help, but he needs",
        "<col=800000>5 blood runes</col>, <col=800000>10 lava runes</col> and",
        "<col=800000>10 mist runes</col> first.",
      ];
    }
    if (stage === STAGE_COLONY) {
      return [
        "The <col=800000>Wise Old Man</col> is waiting outside the Colony.",
        "",
        "I should talk to him and get ready to fight the sea trolls.",
      ];
    }
    if (stage === STAGE_BATTLE) {
      const left = flag(player, TROLLS_LEFT_ATTRIBUTE);
      return left > 0
        ? [`I am fighting the sea trolls outside the Colony. ${left} are still alive.`]
        : ["The sea trolls are dead. I should talk to the", "<col=800000>Wise Old Man</col> and enter the Colony."];
    }
    if (stage === STAGE_INSIDE) {
      return [
        "I entered the Colony. The <col=800000>Wise Old Man</col> asked me",
        "to find <col=800000>Herman Caranos</col> in his office in the",
        "eastern building.",
      ];
    }
    if (stage === STAGE_JOBS) {
      const lines = [
        "Herman asked me to make myself useful around the Colony.",
        "",
      ];
      lines.push(
        franklinDone(player)
          ? "<str>I repaired the Colony's western wall with iron sheets.</str>"
          : `I should help <col=800000>Franklin</col> repair the western wall (${wallsRepaired(player)}/5 sections).`
      );
      lines.push(
        arnoldDone(player)
          ? "<str>I gave Arnold the five cooked fresh monkfish.</str>"
          : `I should bring <col=800000>Arnold</col> five cooked fresh monkfish (${flag(player, MONKFISH_GIVEN_ATTRIBUTE)}/5).`
      );
      return lines;
    }
    if (stage === STAGE_JOBS_DONE) {
      return [
        "I helped both <col=800000>Franklin</col> and <col=800000>Arnold</col>.",
        "",
        "I should report back to <col=800000>Herman Caranos</col>.",
      ];
    }
    if (stage === STAGE_ARMY) {
      return [
        "The Wise Old Man needs an army to wipe out the trolls.",
        "",
        "I should ask <col=800000>Wizard Frumscone</col> in the basement of",
        "the Wizards' Guild in Yanille for help.",
      ];
    }
    if (stage === STAGE_MALIGNIUS) {
      return [
        "Wizard Frumscone sent me to the necromancer",
        "<col=800000>Malignius Mortifer</col>, south of Falador.",
        "",
        `He needs 7 normal bones (${flag(player, BONES_GIVEN_ATTRIBUTE)}/7) and I`,
        "must ask the <col=800000>master crafters</col> in the Crafting Guild",
        "how to carry his bone seeds.",
      ];
    }
    if (stage === STAGE_CRAFTER) {
      return [
        "The master crafter said the bone seeds must be carried in a",
        "<col=800000>pot with a pot lid</col>.",
        "",
        "I should take an airtight pot back to <col=800000>Malignius Mortifer</col>.",
      ];
    }
    if (stage === STAGE_SEEDS) {
      return [
        "Malignius Mortifer gave me the <col=800000>bone seeds</col> and",
        "teleported me back to the Colony.",
        "",
        "I should talk to <col=800000>Herman Caranos</col> and open the pot.",
      ];
    }
    if (stage === STAGE_QUEEN) {
      return [
        "The skeleton magi defeated the trolls, but the",
        "<col=800000>Sea Troll Queen</col> struck down the Wise Old Man.",
        "",
        "I must defeat her myself.",
      ];
    }
    if (stage === STAGE_QUEEN_DEAD) {
      return [
        "I defeated the <col=800000>Sea Troll Queen</col>!",
        "",
        "I should talk to <col=800000>Herman Caranos</col> for my reward.",
      ];
    }
    return [];
  }

  function grantReward(player) {
    // registerQuest adds one coin from rewardItemId; top the stack up to 25,000.
    player.getInventory().adds(COINS_ITEM_ID, 24999);
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MAGIC, 15000);
    skills.addExperiences(Skill.PRAYER, 10000);
    skills.addExperiences(Skill.FISHING, 50000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(FRANKLIN_MET_ATTRIBUTE);
  api.persistAttribute(FIREBOX_LOADED_ATTRIBUTE);
  api.persistAttribute(FIREBOX_LIT_ATTRIBUTE);
  api.persistAttribute(SHEETS_MADE_ATTRIBUTE);
  api.persistAttribute(WALL_BITS_ATTRIBUTE);
  api.persistAttribute(ARNOLD_MET_ATTRIBUTE);
  api.persistAttribute(MONKFISH_GIVEN_ATTRIBUTE);
  api.persistAttribute(CATCH_COUNT_ATTRIBUTE);
  api.persistAttribute(MALIGNIUS_MET_ATTRIBUTE);
  api.persistAttribute(BONES_GIVEN_ATTRIBUTE);
  api.persistAttribute(CRAFTER_ASKED_ATTRIBUTE);
  api.persistAttribute(CRAFTER_TOLD_ATTRIBUTE);
  api.persistAttribute(FRUMSCONE_DECLINED_ATTRIBUTE);
  api.persistAttribute(ENTERED_COLONY_ATTRIBUTE);
  api.persistAttribute(TROLLS_LEFT_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "swan_song",
    name: "Swan Song",
    varpId: VARP_SWAN_SONG,
    varbitId: VARBIT_SWAN_SONG,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // Keep persisted gameplay stages; publish the cache quest state, including its final reward phase.
    varpValue: stage => stage >= STAGE_COMPLETE ? 200 : stage,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.MAGIC.getIndex(), amount: 15000, label: "Magic" },
      { skillId: Skill.PRAYER.getIndex(), amount: 10000, label: "Prayer" },
      { skillId: Skill.FISHING.getIndex(), amount: 50000, label: "Fishing" },
    ],
    rewardItemId: COINS_ITEM_ID,
    rewardItemLabel: "25,000 Coins",
    otherRewards: [
      "Access to the Piscatoris Fishing Colony",
      "Ability to fish monkfish",
      "Free passage on Kathy Corkat's boat",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onNpcInteraction("Fishing spot", { Net: handleFishingSpot });
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onZoneEnter(COLONY_ZONE, handleZoneEnter);
  api.onServerStartup(installObjects);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
