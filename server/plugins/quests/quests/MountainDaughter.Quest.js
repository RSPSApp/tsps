/**
 * Mountain Daughter (members).
 *
 * The words come from the "Mountain Daughter" transcript page; this plugin
 * supplies the per-stage variant selectors for Hamal, Jokul, Ragnar, Svidi,
 * the camp dwellers and the Mountain Camp guards, the shared Brundt Talk-to
 * (The Fremennik Trials owns his default variant selector), the prose-condition
 * answers, the lake crossing (mud/tree/clump/flat stones), the diplomacy and
 * food chains, the Kendal's lair (owner-only boss spawn, corpse pickup and
 * burial) and the completion reward.
 *
 * Stages: varp 423 "mdaughter_var", varbit 260 "mdaughter_quest_var" bits 0-7
 * (scripts/lookup-gameval.ts; the sibling varbits 261-274 name the relations,
 * food, mud, burial and bear state). QuestHelper's stage map (0/10/20/30/40/50/
 * 60) fixes the milestone values; completion is 70 because the wiki's last
 * guided stage is 60 (Hamal's burial task), and the server needs a distinct
 * complete value. Stage map:
 *   0 not started, 10 Hamal allows a search, 20 Asleif's two tasks active,
 *   30 tasks done - find the creature that killed her, 40 the Kendal attacked,
 *   50 the Kendal dead, 60 Hamal asked for the burial, 70 complete (cairn built).
 * Sibling state lives in persisted "mountain-daughter:*" attributes because the
 * quest stage is a single varbit.
 *
 * Requirements (OSRS Wiki): 20 Agility (not required to start; 10 Agility to
 * enter the camp initially - not enforced here, as no transcript line exists
 * for a failed check), rope, pickaxe, axe, plank, a staff/pole and gloves.
 * Rewards: 2 Quest Points, 2,000 Prayer XP, 1,000 Attack XP, the Bearhead
 * (collected from the Kendal's corpse) and Mountain Camp access.
 *
 * Ids confirmed in the cache: objects 5842 Boulder (rope), 5847 Rockslide,
 * 5848 Tall tree, 5849 Clump of rocks, 5850/5851 Flat stones, 5856 Thorny
 * bushes, 5857 Cave entrance, 5858/5859 Cave exits, 5862 Burial mound, 5863
 * Burial cairn, 5883 Mud, 5895 Ancient Rock, 5897 Shining pool, 5902-5904 Dead
 * trees (blocking; the shared Woodcutting plugin already chops them); NPCs
 * 1371/1372 guards, 1373 Hamal, 1374 Ragnar, 1375 Svidi, 1376 Jokul,
 * 1377/1378 The Kendal (talk/fight), 1379-1383 camp dwellers, 9263/9266-9268
 * Brundt's transform ids; items 4484 safety guarantee, 4485 white pearl,
 * 4486 seed, 4487 half a rock, 4488 corpse of woman, 4489 necklace, 4490 mud,
 * 4492 muddy rock, 4494 pole, 4496 broken pole, 4502 bearhead.
 *
 * Gaps/approximations:
 * - The transcript dump has no prose branch for a Fremennik greeting at
 *   Brundt's first mountain-camp question (the hJKpGK branch is an unavailable
 *   marker); Fremennik players get the same lines as outlanders.
 * - The transcript's "another corpse" and "rock already split" flavour steps
 *   are unreachable (one corpse and one rock are issued, and re-taking after a
 *   drop would otherwise soft-lock); a dropped half a rock can be mined again.
 * - Crossing the lake teleports between shores/islands (no pathfinding over the
 *   pool), the rope boulder drops the player into the camp, both lair exits
 *   return to the surface cave mouth, and the dead trees open via the shared
 *   Woodcutting plugin rather than quest-specific stumps.
 * - Skill requirements are not enforced (no failed-check dialogue exists in the
 *   transcript).
 * - Journal lines are written here (the wiki publishes no journal text).
 */
module.exports = function registerMountainDaughterQuest(api) {
  const {
    Equipment,
    GameObject,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  // ==========================================================================
  // Ids and tiles
  // ==========================================================================

  const VARP_MOUNTAIN_DAUGHTER = 423; // "mdaughter_var"
  const VARBIT_STAGE = 260; // mdaughter_quest_var, bits 0-7

  const STAGE_STARTED = 10;
  const STAGE_HELPING = 20;
  const STAGE_KENDAL = 30;
  const STAGE_FIGHT = 40;
  const STAGE_CORPSE = 50;
  const STAGE_BURIAL = 60;
  const STAGE_COMPLETE = 70;

  const PAGE = "Mountain Daughter";
  const FREMENNIK_TRIALS_KEY = "fremennik_trials";
  const THRONE_OF_MISCELLANIA_KEY = "throne_of_miscellania";
  /** Chathead placeholder for scenery transcripts; they only carry message/player lines. */
  const SCENERY_SPEAKER_NPC_ID = NpcIdentifiers.HAMAL_THE_CHIEFTAIN;

  const GUARD_ENTRANCE_NPC_ID = NpcIdentifiers.GUARD_21; // 1371, outside the rockslide
  const GUARD_CAMP_NPC_ID = NpcIdentifiers.GUARD_22; // 1372, inside the camp
  const HAMAL_NPC_ID = NpcIdentifiers.HAMAL_THE_CHIEFTAIN; // 1373
  const RAGNAR_NPC_ID = NpcIdentifiers.RAGNAR; // 1374
  const SVIDI_NPC_ID = NpcIdentifiers.SVIDI; // 1375
  const JOKUL_NPC_ID = NpcIdentifiers.JOKUL; // 1376
  const KENDAL_NPC_ID = NpcIdentifiers.THE_KENDAL; // 1377, talkable
  const KENDAL_FIGHTING_NPC_ID = NpcIdentifiers.THE_KENDAL_2; // 1378, attackable
  const CAMP_DWELLER_NPC_IDS = new Set([
    NpcIdentifiers.CAMP_DWELLER, // 1379
    NpcIdentifiers.CAMP_DWELLER_2, // 1380
    NpcIdentifiers.CAMP_DWELLER_3, // 1381
    NpcIdentifiers.CAMP_DWELLER_4, // 1382
    NpcIdentifiers.CAMP_DWELLER_5, // 1383
  ]);
  // Brundt is spawned as a transforming base id; the content id resolves to one
  // of these, so scope by the whole family.
  const BRUNDT_NPC_IDS = new Set([
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_2,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_3,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_4,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_5,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_6,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_7,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_8,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_9,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_10,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_11,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_12,
  ]);
  const BRUNDT_NPC_ID = NpcIdentifiers.BRUNDT_THE_CHIEFTAIN;

  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const MUD_ITEM_ID = ItemIdentifiers.MUD; // 4490
  const MUDDY_ROCK_ITEM_ID = ItemIdentifiers.MUDDY_ROCK; // 4492
  const HALF_A_ROCK_ITEM_ID = ItemIdentifiers.HALF_A_ROCK; // 4487
  const SAFETY_GUARANTEE_ITEM_ID = ItemIdentifiers.SAFETY_GUARANTEE; // 4484
  const WHITE_PEARL_ITEM_ID = ItemIdentifiers.WHITE_PEARL; // 4485
  const WHITE_PEARL_SEED_ITEM_ID = ItemIdentifiers.WHITE_PEARL_SEED; // 4486
  const CORPSE_ITEM_ID = ItemIdentifiers.CORPSE_OF_WOMAN; // 4488
  const NECKLACE_ITEM_ID = ItemIdentifiers.ASLEIFS_NECKLACE; // 4489
  const BEARHEAD_ITEM_ID = ItemIdentifiers.BEARHEAD; // 4502
  const BROKEN_POLE_ITEM_IDS = new Set([
    ItemIdentifiers.BROKEN_POLE, // 4496
    ItemIdentifiers.BROKEN_POLE_2, // 4497
  ]);

  const BOULDER_OBJECT_ID = ObjectIdentifiers.BOULDER_7; // 5842
  const ROCKSLIDE_OBJECT_ID = ObjectIdentifiers.ROCKSLIDE_2; // 5847
  const TALL_TREE_OBJECT_ID = ObjectIdentifiers.TALL_TREE; // 5848
  const CLUMP_OF_ROCKS_OBJECT_ID = ObjectIdentifiers.CLUMP_OF_ROCKS; // 5849
  const FLAT_STONE_OBJECT_ID = ObjectIdentifiers.FLAT_STONE; // 5850, crossing to the island
  const FLAT_STONE_RETURN_OBJECT_ID = ObjectIdentifiers.FLAT_STONE_2; // 5851, back to the north shore
  const THORNY_BUSHES_OBJECT_ID = ObjectIdentifiers.THORNY_BUSHES; // 5856
  const CAVE_ENTRANCE_OBJECT_ID = ObjectIdentifiers.CAVE_ENTRANCE_28; // 5857
  const CAVE_EXIT_OBJECT_IDS = new Set([
    ObjectIdentifiers.CAVE_EXIT_14, // 5858
    ObjectIdentifiers.CAVE_EXIT_15, // 5859
  ]);
  const BURIAL_MOUND_OBJECT_ID = ObjectIdentifiers.BURIAL_MOUND; // 5862
  const BURIAL_CAIRN_OBJECT_ID = ObjectIdentifiers.BURIAL_CAIRN; // 5863
  const MUD_OBJECT_ID = ObjectIdentifiers.MUD_2; // 5883, "Dig-up"
  const ANCIENT_ROCK_OBJECT_ID = ObjectIdentifiers.ANCIENT_ROCK; // 5895
  const SHINING_POOL_OBJECT_IDS = new Set([
    ObjectIdentifiers.SHINING_POOL, // 5855
    ObjectIdentifiers.SHINING_POOL_2, // 5897
  ]);

  /** Moving the rope boulder lands the player inside the camp. */
  const ROCKSLIDE_TILE = new Location(2760, 3658, 0);
  const CAMP_DROP_TILE = new Location(2764, 3667, 0);
  const CAMP_TILE = new Location(2761, 3661, 0);
  const OUTSIDE_TILE = new Location(2760, 3655, 0);
  const SHORE_TILE = new Location(2771, 3680, 0);
  const ISLAND_ONE_TILE = new Location(2773, 3684, 0);
  const ISLAND_TWO_TILE = new Location(2773, 3691, 0);
  const ISLAND_THREE_TILE = new Location(2778, 3692, 0);
  const BURIAL_TILE = new Location(2783, 3694, 0);
  const CORPSE_TILE = new Location(2784, 10078, 0);
  const KENDAL_TILE = new Location(2788, 10081, 0);
  const LAIR_ENTRY_TILE = new Location(2804, 10098, 0);
  const CAVE_MOUTH_TILE = new Location(2809, 3706, 0);
  const LAIR_ZONE = { minX: 2746, maxX: 2828, minY: 10047, maxY: 10118, levels: [0] };
  /** Island three (centre of the pool) bounds from QuestHelper's zone. */
  const ISLAND_ZONE = { minX: 2776, maxX: 2787, minY: 3688, maxY: 3698 };

  // ==========================================================================
  // Persisted sibling state
  // ==========================================================================

  const RELATIONS_ATTRIBUTE = "mountain-daughter:relations"; // 0/10/20/30/40/50/60
  const FOOD_ATTRIBUTE = "mountain-daughter:food"; // 0/10/20
  const MUD_ATTRIBUTE = "mountain-daughter:mud-on-tree";
  const CORPSE_ATTRIBUTE = "mountain-daughter:has-corpse";
  const NECKLACE_ATTRIBUTE = "mountain-daughter:has-necklace";
  const KENDAL_DEAD_ATTRIBUTE = "mountain-daughter:kendal-dead";
  const BURIAL_TASK_ATTRIBUTE = "mountain-daughter:burial-task";
  const BURIED_ATTRIBUTE = "mountain-daughter:buried";

  // ==========================================================================
  // Transient dialogue context (WeakMap so a logout sheds it)
  // ==========================================================================

  /** "ok" | "broken" | "bad": the item used on the clump of rocks. */
  const clumpUse = new WeakMap();
  /** "yes" | "no": whether a plank was used on the flat stones. */
  const plankUse = new WeakMap();
  /** True while the white pearl's Eat action plays the fruit transcript. */
  const pearlEaten = new WeakSet();

  // ==========================================================================
  // Per-player Kendal spawn and the shared burial scenery
  // ==========================================================================

  const kendalByPlayer = new Map();
  let burialMound = null;
  let burialCairn = null;

  let quest;

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  const state = (player, key) => Number(player.getAttribute(key)) || 0;
  const flag = (player, key) => player.getAttribute(key) === true || player.getAttribute(key) === 1;
  const setFlag = (player, key, value) => player.setAttribute(key, value === true);
  const relationsOf = (player) => state(player, RELATIONS_ATTRIBUTE);
  const foodOf = (player) => state(player, FOOD_ATTRIBUTE);
  const setRelations = (player, value) => player.setAttribute(RELATIONS_ATTRIBUTE, Math.max(relationsOf(player), value | 0));
  const setFood = (player, value) => player.setAttribute(FOOD_ATTRIBUTE, Math.max(foodOf(player), value | 0));

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const rockCount = (player) => player.getInventory().getAmount(MUDDY_ROCK_ITEM_ID);

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function give(player, itemId, amount = 1) {
    if (freeSlots(player) <= 0) {
      player.getInventory().full();
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function itemName(itemId) {
    return String(ItemDefinition.forId(itemId)?.getName?.() ?? "");
  }

  const isPlank = (itemId) => itemId === PLANK_ITEM_ID || /plank/i.test(itemName(itemId));
  const isPickaxe = (itemId) => /pickaxe/i.test(itemName(itemId));
  const isBrokenPole = (itemId) => BROKEN_POLE_ITEM_IDS.has(itemId) || /broken/i.test(itemName(itemId));

  function isPoleOrStaff(itemId) {
    const name = itemName(itemId);
    if (/dramen|broken|rat pole/i.test(name)) return false;
    return /staff|pole|battlestaff/i.test(name);
  }

  function wearingGloves(player) {
    const gloves = player.getEquipment().get(Equipment.HANDS_SLOT);
    const itemId = gloves?.getId?.();
    if (!Number.isInteger(itemId) || itemId < 0) return false;
    const name = itemName(itemId);
    if (/slayer|ranger|moonclan|lunar|mystic|vambrace|infinity/i.test(name)) return false;
    return /gloves|gauntlets/i.test(name);
  }

  function wearingBearhead(player) {
    return player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === BEARHEAD_ITEM_ID;
  }

  const hasCorpse = (player) => flag(player, CORPSE_ATTRIBUTE) || has(player, CORPSE_ITEM_ID);
  const carryingCorpse = (player) => has(player, CORPSE_ITEM_ID);
  const hasNecklace = (player) => has(player, NECKLACE_ITEM_ID);
  const kendalDead = (player) => flag(player, KENDAL_DEAD_ATTRIBUTE);

  function hasQuest(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function playVariant(player, npcId, variant) {
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function insideLair(location) {
    return location.getX() >= LAIR_ZONE.minX && location.getX() <= LAIR_ZONE.maxX &&
      location.getY() >= LAIR_ZONE.minY && location.getY() <= LAIR_ZONE.maxY;
  }

  function onIsland(player) {
    const location = player.getLocation();
    return location.getX() >= ISLAND_ZONE.minX && location.getX() <= ISLAND_ZONE.maxX &&
      location.getY() >= ISLAND_ZONE.minY && location.getY() <= ISLAND_ZONE.maxY;
  }

  // ==========================================================================
  // Variant selectors
  // ==========================================================================

  function hamalVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "talking-to-hamal-after-quest-completion";
    if (stage >= STAGE_BURIAL) return "fighting-the-kendal-talking-to-hamal-again";
    if (stage >= STAGE_CORPSE) {
      return flag(player, BURIAL_TASK_ATTRIBUTE)
        ? "fighting-the-kendal-talking-to-hamal-again"
        : "fighting-the-kendal-talking-to-hamal-about-the-kendal-for-the-first-time";
    }
    if (stage >= STAGE_KENDAL) return "finding-food-talking-to-hamal-before-fighting-the-kendal";
    if (stage >= STAGE_HELPING) {
      if (has(player, WHITE_PEARL_SEED_ITEM_ID)) return "finding-food-talking-to-hamal-after-obtaining-the-white-pearl";
      if (relationsOf(player) >= 40) {
        return foodOf(player) >= 10
          ? "finding-food-talking-to-hamal-before-obtaining-the-white-pearl"
          : "making-peace-returning-to-hamal";
      }
      return "making-peace-talking-to-hamal-before-removing-the-rock";
    }
    if (stage >= STAGE_STARTED) return "hamal-s-daughter-talking-to-hamal-again";
    return "hamal-s-daughter";
  }

  function jokulVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null; // own post-quest page
    if (stage < STAGE_HELPING) return "crisis-jokul";
    if (foodOf(player) >= 20) return "finding-food-talking-to-jokul-after-giving-hamal-the-white-pearl-seed";
    if (has(player, WHITE_PEARL_ITEM_ID) || has(player, WHITE_PEARL_SEED_ITEM_ID)) {
      return "finding-food-talking-to-jokul-after-obtaining-the-white-pearl";
    }
    if (foodOf(player) >= 10) return "finding-food-talking-to-jokkul-again";
    // The first briefing is what unlocks picking the fruit; the transcript has
    // no post-line hook, so record it when its variant is chosen.
    setFood(player, 10);
    return "finding-food-talking-to-jokul";
  }

  function ragnarVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null; // own post-quest page
    if (stage >= STAGE_BURIAL) {
      // The receipt flag stops Ragnar from handing over a second necklace.
      return flag(player, NECKLACE_ATTRIBUTE) ? null : "fighting-the-kendal-talking-to-ragnar-again";
    }
    if (stage >= STAGE_CORPSE) return "fighting-the-kendal-talking-to-ragnar-before-hamal";
    if (stage >= STAGE_HELPING) return "crisis-speaking-with-ragnar-again";
    if (stage >= STAGE_STARTED) return "crisis-ragnar";
    return null;
  }

  function svidiVariant(player) {
    const stage = quest.getStage(player);
    const relations = relationsOf(player);
    if (stage >= STAGE_COMPLETE || relations >= 60) {
      return { page: "Svidi", variant: "after-mountain-daughter" };
    }
    if (relations >= 50) return "making-peace-returning-to-svidi-with-the-safety-guarantee";
    if (relations >= 20) return "making-peace-talking-to-svidi-before-receiving-the-safety-guarantee";
    if (stage >= STAGE_HELPING) return "making-peace-svidi";
    return null;
  }

  function guardVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) {
      return "guard-at-entrance-to-mountain-camp-talking-to-guard-after-mountain-daughter-quest";
    }
    if (stage >= STAGE_STARTED) {
      return "guard-at-entrance-to-mountain-camp-talking-to-guard-during-mountain-daughter-quest";
    }
    return null;
  }

  function campDwellerVariant(player, stage) {
    if (stage >= STAGE_STARTED && stage < STAGE_COMPLETE) return "crisis-camp-dwellers";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === HAMAL_NPC_ID) return hamalVariant(player, stage);
    if (npcId === JOKUL_NPC_ID) return jokulVariant(player, stage);
    if (npcId === RAGNAR_NPC_ID) return ragnarVariant(player, stage);
    if (npcId === SVIDI_NPC_ID) return svidiVariant(player);
    if (npcId === KENDAL_NPC_ID) return "fighting-the-kendal-the-kendal-talking-to-him";
    if (npcId === GUARD_ENTRANCE_NPC_ID) return guardVariant(player, stage);
    if (npcId === GUARD_CAMP_NPC_ID) return "guard-in-the-mountain-camp";
    if (CAMP_DWELLER_NPC_IDS.has(npcId)) return campDwellerVariant(player, stage);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    switch (stepId) {
      // The Fremennik Trials state (Hamal, Ragnar, Brundt, the post-quest menu).
      case "r3V1Co":
      case "KMyoRo":
      case "Vlftst":
      case "_ItCLB":
      case "03ta-g":
      case "VH-IKj":
      case "EhwZoV":
      case "k7aov_":
        return hasQuest(player, FREMENNIK_TRIALS_KEY);
      case "Du9HrG":
      case "Eeyk_-":
      case "sONtGs":
      case "Zk_it4":
      case "AdDojf":
        return !hasQuest(player, FREMENNIK_TRIALS_KEY);
      // Brundt's first mountain-camp answer has no Fremennik text in the dump
      // (the branch is an unavailable marker), so Fremennik players read the
      // outlander explanation rather than the chat closing on them.
      case "hJKpGK":
        return false;
      case "QR9Kpc":
        return true;
      case "Cw8Ces":
      case "i5opnr":
      case "n8Be5z":
        return hasQuest(player, THRONE_OF_MISCELLANIA_KEY);
      // Lake crossing.
      case "oAZcif":
        return clumpUse.get(player) === "broken";
      case "rTERuu":
        return clumpUse.get(player) === "ok";
      case "gPOlgk":
        return clumpUse.get(player) === "bad";
      case "nE3LdB":
        return plankUse.get(player) === "yes";
      case "3DNRiT":
        return plankUse.get(player) === "no";
      // Diplomacy chain.
      case "9qwT9e":
        return relationsOf(player) < 30;
      case "ezCXox":
        return relationsOf(player) >= 30;
      case "3xTupz":
        return has(player, HALF_A_ROCK_ITEM_ID);
      case "YhPP6_":
        return false; // the rock can be re-mined if the half is dropped
      case "wfcq1J":
        return relationsOf(player) < 60;
      case "mpfkmm":
        return relationsOf(player) >= 60;
      // White pearl bush (also drives the Eat action).
      case "INNns-":
        return wearingGloves(player) && !has(player, WHITE_PEARL_ITEM_ID) && !has(player, WHITE_PEARL_SEED_ITEM_ID);
      case "d9_nMI":
        return !wearingGloves(player) && !has(player, WHITE_PEARL_ITEM_ID) && !has(player, WHITE_PEARL_SEED_ITEM_ID);
      case "2l5mjB":
        return has(player, WHITE_PEARL_ITEM_ID) && !pearlEaten.has(player);
      case "xT0m1k":
        return pearlEaten.has(player);
      case "Ip48ma":
        return false;
      case "tiuQGo":
        return has(player, WHITE_PEARL_SEED_ITEM_ID);
      case "r_F56j":
        return has(player, WHITE_PEARL_ITEM_ID);
      case "iPibuc":
        return has(player, WHITE_PEARL_SEED_ITEM_ID);
      // The Kendal.
      case "tR4h_w":
      case "awXg8J":
        return !carryingCorpse(player);
      case "UkbDoK":
      case "-EpuoR":
        return carryingCorpse(player);
      case "aXxa_d":
      case "mA_5of":
        return !kendalDead(player);
      case "qEnk22":
        return kendalDead(player) && !wearingBearhead(player);
      case "gisknQ":
        return kendalDead(player) && wearingBearhead(player);
      case "HTStMp":
        return kendalDead(player);
      // Burial.
      case "CBiFxn":
        return !hasNecklace(player);
      case "XI3-HI":
        return hasNecklace(player);
      case "Zr6BI1":
        return rockCount(player) < 5;
      case "2Yki-x":
        return rockCount(player) >= 5;
      // Post-quest Hamal "have you seen my helmet?" option.
      case "3OkZxS":
        return !has(player, BEARHEAD_ITEM_ID);
      case "8D8658":
        return true;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue choices
  // ==========================================================================

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId === HAMAL_NPC_ID) {
      if (option === "I will search for her!" && quest.getStage(player) === 0) {
        quest.setStage(player, STAGE_STARTED);
        return;
      }
      if (option === "Why do you hate them so much?" && quest.getStage(player) === STAGE_HELPING) {
        setRelations(player, 10);
        return;
      }
      if (option === "I will." && quest.getStage(player) === STAGE_CORPSE) {
        setFlag(player, BURIAL_TASK_ATTRIBUTE, true);
        quest.setStage(player, STAGE_BURIAL);
        return;
      }
    }
    if (npcId === SVIDI_NPC_ID && option === "Can't I persuade you to go in there somehow?") {
      setRelations(player, 20);
      return;
    }
    if (BRUNDT_NPC_IDS.has(npcId) && option === "Ask about the mountain camp." && relationsOf(player) === 20) {
      setRelations(player, 30);
      return;
    }
    if (option === "I'll get right on it." && quest.getStage(player) === STAGE_STARTED) {
      quest.setStage(player, STAGE_HELPING);
    }
  }

  // ==========================================================================
  // Transcript actions and messages
  // ==========================================================================

  function receiveSafetyGuarantee(player) {
    if (relationsOf(player) < 50) return;
    if (!has(player, SAFETY_GUARANTEE_ITEM_ID)) give(player, SAFETY_GUARANTEE_ITEM_ID);
  }

  function giveHalfRock(player) {
    if (!has(player, HALF_A_ROCK_ITEM_ID)) return;
    player.getInventory().deleteNumber(HALF_A_ROCK_ITEM_ID, 1);
    setRelations(player, 50);
    // The Fremennik Trials branch of the transcript loses its receive step in
    // the dump, so Fremennik players get the guarantee here instead.
    if (hasQuest(player, FREMENNIK_TRIALS_KEY) && !has(player, SAFETY_GUARANTEE_ITEM_ID)) {
      give(player, SAFETY_GUARANTEE_ITEM_ID);
    }
  }

  function giveSafetyGuarantee(player) {
    if (!has(player, SAFETY_GUARANTEE_ITEM_ID)) return;
    player.getInventory().deleteNumber(SAFETY_GUARANTEE_ITEM_ID, 1);
    setRelations(player, 60);
  }

  function givePearlSeed(player) {
    if (!has(player, WHITE_PEARL_SEED_ITEM_ID)) return;
    player.getInventory().deleteNumber(WHITE_PEARL_SEED_ITEM_ID, 1);
    setFood(player, 20);
  }

  function receiveNecklace(player) {
    if (hasNecklace(player)) return;
    setFlag(player, NECKLACE_ATTRIBUTE, true);
    if (!has(player, NECKLACE_ITEM_ID)) give(player, NECKLACE_ITEM_ID);
  }

  /** Mud on the tree, the tree climb and the pool transcripts' message hooks. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === undefined) return;
    switch (stepId) {
      case "iKqP0b":
        receiveSafetyGuarantee(player);
        event.handled = true;
        return;
      case "9VNcQJ":
        giveHalfRock(player);
        event.handled = true;
        return;
      case "9oxUoI":
        giveSafetyGuarantee(player);
        event.handled = true;
        return;
      case "_qEzld":
        givePearlSeed(player);
        event.handled = true;
        return;
      case "kxrT5o":
        receiveNecklace(player);
        event.handled = true;
        return;
      case "MHEmJQ":
      case "2mnEQp":
      case "_yZDMm":
        kendalAttacks(player);
        event.handled = true;
        return;
      case "OqX8RN":
        if (!has(player, BEARHEAD_ITEM_ID)) give(player, BEARHEAD_ITEM_ID);
        return;
      case "jq0n0d":
        if (!has(player, WHITE_PEARL_ITEM_ID) && !has(player, WHITE_PEARL_SEED_ITEM_ID)) {
          give(player, WHITE_PEARL_ITEM_ID);
        }
        return;
      case "GoRPl9":
        player.setHitpoints(Math.max(1, player.getHitpoints() - 4));
        return;
      case "ZCw-_2":
        pearlEaten.delete(player);
        if (has(player, WHITE_PEARL_ITEM_ID)) player.getInventory().deleteNumber(WHITE_PEARL_ITEM_ID, 1);
        if (!has(player, WHITE_PEARL_SEED_ITEM_ID)) give(player, WHITE_PEARL_SEED_ITEM_ID);
        return;
      case "TSkyF9":
        if (!has(player, HALF_A_ROCK_ITEM_ID)) {
          give(player, HALF_A_ROCK_ITEM_ID);
          setRelations(player, 40);
        }
        return;
      case "NoN3nI":
        player.moveTo(SHORE_TILE);
        return;
      case "n7WQai":
        if (!has(player, BEARHEAD_ITEM_ID)) give(player, BEARHEAD_ITEM_ID);
        return;
      case "JV0dSu":
        buryCorpse(player);
        return;
      case "q_5aqc":
        buildCairnNow(player);
        return;
      case "O22xXE":
        event.handled = true;
        player.sendMessage(
          `You don't have enough rocks to build a cairn. You need ${5 - rockCount(player)} more rock(s).`
        );
        return;
      case "rpqdYE":
        event.handled = true;
        if (quest.getStage(player) >= STAGE_BURIAL) quest.complete(player);
        return;
      // Dump gaps on the path: the first spirit explanation and Brundt's
      // missing Fremennik branch are wiki "unavailable" markers. Continue the
      // branch instead of closing the conversation with the fallback line.
      case "O65y2B":
      case "uFH9MS":
        event.handled = true;
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Hamal's burial
  // ==========================================================================

  function registerBurialMound() {
    if (burialMound || burialCairn) return;
    burialMound = new GameObject(BURIAL_MOUND_OBJECT_ID, BURIAL_TILE.clone(), 10, 0, null);
    api.getObjectManager().register(burialMound, true);
  }

  function registerBurialCairn() {
    if (burialCairn) return;
    if (burialMound) {
      api.getObjectManager().deregister(burialMound, true);
      burialMound = null;
    }
    burialCairn = new GameObject(BURIAL_CAIRN_OBJECT_ID, BURIAL_TILE.clone(), 10, 0, null);
    api.getObjectManager().register(burialCairn, true);
  }

  function buryCorpse(player) {
    if (!has(player, CORPSE_ITEM_ID)) return;
    player.getInventory().deleteNumber(CORPSE_ITEM_ID, 1);
    if (has(player, NECKLACE_ITEM_ID)) player.getInventory().deleteNumber(NECKLACE_ITEM_ID, 1);
    setFlag(player, CORPSE_ATTRIBUTE, false);
    // The necklace flag stays set so Ragnar does not offer a second one.
    setFlag(player, BURIED_ATTRIBUTE, true);
    registerBurialMound();
    player.moveTo(new Location(BURIAL_TILE.getX() - 1, BURIAL_TILE.getY(), 0));
  }

  function buildCairnNow(player) {
    player.getInventory().deleteNumber(MUDDY_ROCK_ITEM_ID, 5);
    registerBurialCairn();
  }

  function buryAsleif(event) {
    const { player, itemId } = event;
    if (itemId !== CORPSE_ITEM_ID) return false;
    event.handled = true;
    if (!flag(player, BURIAL_TASK_ATTRIBUTE)) {
      playVariant(player, KENDAL_NPC_ID, "fighting-the-kendal-the-kendal-trying-to-bury-the-corpse-before-talking-to-hamal");
      return;
    }
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-laying-asleif-to-rest-burying-the-corpse");
  }

  // ==========================================================================
  // The Kendal
  // ==========================================================================

  function removeOwnedKendal(player) {
    const npc = kendalByPlayer.get(player);
    kendalByPlayer.delete(player);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  function ensureKendal(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_KENDAL || quest.isComplete(player) || kendalDead(player)) return;
    const current = kendalByPlayer.get(player);
    if (current?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: KENDAL_NPC_ID,
      x: KENDAL_TILE.getX(),
      y: KENDAL_TILE.getY(),
      z: KENDAL_TILE.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    kendalByPlayer.set(player, npc);
  }

  function kendalAttacks(player) {
    const npc = kendalByPlayer.get(player);
    if (!npc || npc.getId() !== KENDAL_NPC_ID) return;
    const location = npc.getLocation();
    const fighting = api.spawnNpc({
      id: KENDAL_FIGHTING_NPC_ID,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!fighting) return;
    fighting.__skipDefaultRespawn = true;
    api.removeNpc(npc);
    kendalByPlayer.set(player, fighting);
    fighting.getCombat().attack(player);
    if (quest.getStage(player) < STAGE_FIGHT) quest.setStage(player, STAGE_FIGHT);
  }

  function ensureCorpse(player) {
    if (hasCorpse(player) || flag(player, BURIED_ATTRIBUTE) || quest.isComplete(player)) return;
    const manager = api.getItemOnGroundManager();
    if (!manager?.registerLocation || !manager?.getGroundItem) return;
    const privateArea = player.getPrivateArea?.() ?? null;
    if (manager.getGroundItem(player.getUsername(), CORPSE_ITEM_ID, CORPSE_TILE, privateArea)) return;
    manager.registerLocation(player, new Item(CORPSE_ITEM_ID, 1), CORPSE_TILE);
  }

  function handleNpcDeath(event) {
    const npc = event.npc;
    if (!npc || npc.getId() !== KENDAL_FIGHTING_NPC_ID) return;
    const killer = event.killer;
    if (!killer || kendalByPlayer.get(killer) !== npc) return;
    kendalByPlayer.delete(killer);
    setFlag(killer, KENDAL_DEAD_ATTRIBUTE, true);
    if (quest.getStage(killer) < STAGE_CORPSE) quest.setStage(killer, STAGE_CORPSE);
    if (!has(killer, BEARHEAD_ITEM_ID)) give(killer, BEARHEAD_ITEM_ID);
    playVariant(killer, KENDAL_NPC_ID, "fighting-the-kendal-the-kendal-killing-the-kendal");
  }

  function handleCanAttack(event) {
    const { attacker, target } = event;
    if (!attacker?.isPlayer?.() || !target) return;
    if (target.getId?.() !== KENDAL_NPC_ID) return;
    if (kendalDead(attacker)) return;
    event.allow = false;
    if (!attacker.getDialogueManager?.()?.isActive?.()) {
      playVariant(attacker, KENDAL_NPC_ID, "fighting-the-kendal-the-kendal-attacking-him-before-talking-to-him");
    }
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId !== CORPSE_ITEM_ID) return;
    if (!kendalDead(player)) {
      event.handled = true;
      playVariant(player, KENDAL_NPC_ID, "fighting-the-kendal-the-kendal-trying-to-pick-up-the-corpse-of-woman-before-killing-him");
      return;
    }
    if (hasCorpse(player)) {
      event.handled = true;
      playVariant(player, KENDAL_NPC_ID, "fighting-the-kendal-the-kendal-trying-to-pick-up-another-corpse");
      return;
    }
    if (freeSlots(player) <= 0) {
      event.handled = true;
      player.getInventory().full();
      return;
    }
    setFlag(player, CORPSE_ATTRIBUTE, true);
  }

  function handleLairEnter({ player }) {
    ensureKendal(player);
    ensureCorpse(player);
  }

  function handleLairExit({ player }) {
    removeOwnedKendal(player);
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function useRopeOnBoulder(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== BOULDER_OBJECT_ID || itemId !== ROPE_ITEM_ID) return;
    event.handled = true;
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "entering-the-camp");
    player.moveTo(CAMP_DROP_TILE);
  }

  function climbRockslide(event) {
    const { player, objectId } = event;
    if (objectId !== ROCKSLIDE_OBJECT_ID) return;
    event.handled = true;
    const stage = quest.getStage(player);
    const entering = player.getLocation().getY() < ROCKSLIDE_TILE.getY();
    if (stage >= STAGE_COMPLETE) {
      playVariant(player, GUARD_ENTRANCE_NPC_ID, "guard-at-entrance-to-mountain-camp-climbing-over-the-rockslide-entering-or-exiting-after-mountain-daughter-quest");
    } else if (stage >= STAGE_STARTED) {
      playVariant(
        player,
        GUARD_ENTRANCE_NPC_ID,
        entering
          ? "guard-at-entrance-to-mountain-camp-climbing-over-the-rockslide-entering-during-mountain-daughter-quest"
          : "guard-at-entrance-to-mountain-camp-climbing-over-the-rockslide-exiting-before-or-during-mountain-daughter-quest"
      );
    } else {
      playVariant(player, GUARD_ENTRANCE_NPC_ID, "guard-at-entrance-to-mountain-camp-climbing-over-the-rockslide-entering-before-mountain-daughter-quest");
      return;
    }
    player.moveTo(entering ? CAMP_TILE : OUTSIDE_TILE);
  }

  function digMud(event) {
    const { player, objectId } = event;
    if (objectId !== MUD_OBJECT_ID) return;
    event.handled = true;
    if (has(player, MUD_ITEM_ID)) return;
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-the-shining-pool-gathering-the-mud");
    give(player, MUD_ITEM_ID);
  }

  function climbTallTree(event) {
    const { player, objectId } = event;
    if (objectId !== TALL_TREE_OBJECT_ID) return;
    event.handled = true;
    if (!flag(player, MUD_ATTRIBUTE)) {
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-the-shining-pool-attempting-to-climbing-the-slippery-tree");
      return;
    }
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-climbing-the-tree");
    player.moveTo(ISLAND_ONE_TILE);
  }

  function useMudOnTree(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== TALL_TREE_OBJECT_ID || itemId !== MUD_ITEM_ID) return;
    event.handled = true;
    if (flag(player, MUD_ATTRIBUTE)) return;
    player.getInventory().deleteNumber(MUD_ITEM_ID, 1);
    setFlag(player, MUD_ATTRIBUTE, true);
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree");
  }

  function useItemOnClump(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== CLUMP_OF_ROCKS_OBJECT_ID) return;
    const use = isBrokenPole(itemId) ? "broken" : isPoleOrStaff(itemId) ? "ok" : "bad";
    event.handled = true;
    clumpUse.set(player, use);
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-jumping-across-the-clump-of-rocks");
    if (use === "ok") player.moveTo(ISLAND_TWO_TILE);
    if (use === "bad") player.moveTo(SHORE_TILE);
  }

  function jumpAcrossClump(event) {
    const { player, objectId } = event;
    if (objectId !== CLUMP_OF_ROCKS_OBJECT_ID) return;
    event.handled = true;
    const equipped = player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.();
    const use = isPoleOrStaff(equipped) || hasPoleOrStaff(player) ? "ok" : "bad";
    clumpUse.set(player, use);
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-jumping-across-the-clump-of-rocks");
    if (use === "ok") player.moveTo(ISLAND_TWO_TILE);
    else player.moveTo(SHORE_TILE);
  }

  function hasPoleOrStaff(player) {
    for (const item of player.getInventory().getItems()) {
      const itemId = item?.getId?.();
      if (Number.isInteger(itemId) && itemId >= 0 && isPoleOrStaff(itemId)) return true;
    }
    return false;
  }

  function jumpFlatStone(event) {
    const { player, objectId } = event;
    if (objectId !== FLAT_STONE_RETURN_OBJECT_ID) return;
    event.handled = true;
    player.moveTo(SHORE_TILE);
  }

  function usePlankOnFlatStone(event) {
    const { player, objectId, itemId } = event;
    if (!isPlank(itemId)) return;
    if (objectId === FLAT_STONE_OBJECT_ID) {
      event.handled = true;
      plankUse.set(player, "yes");
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-using-the-plank-on-the-flat-stones");
      player.moveTo(ISLAND_THREE_TILE);
      return;
    }
    if (objectId === FLAT_STONE_RETURN_OBJECT_ID) {
      event.handled = true;
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-returning-to-shore");
    }
  }

  function usePickaxeOnAncientRock(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== ANCIENT_ROCK_OBJECT_ID || !isPickaxe(itemId)) return;
    event.handled = true;
    if (relationsOf(player) < 30) return;
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "making-peace-removing-the-half-a-rock-from-the-ancient-rock");
  }

  function pickThornyBush(event) {
    const { player, objectId } = event;
    if (objectId !== THORNY_BUSHES_OBJECT_ID) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_HELPING || quest.isComplete(player)) return;
    if (foodOf(player) < 10) return;
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "finding-food-obtaining-the-white-pearl-seed");
  }

  function eatWhitePearl(event) {
    const { player, itemId } = event;
    if (itemId !== WHITE_PEARL_ITEM_ID) return false;
    if (!has(player, WHITE_PEARL_ITEM_ID)) return false;
    event.handled = true;
    pearlEaten.add(player);
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "finding-food-obtaining-the-white-pearl-seed");
  }

  function listenToShiningPool(event) {
    const { player, objectId } = event;
    if (!SHINING_POOL_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return;
    if (!onIsland(player)) {
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-the-shining-pool-listening-to-the-outer-shining-pools");
      return;
    }
    if (stage <= STAGE_STARTED) {
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-listening-to-the-center-shining-pool");
      return;
    }
    if (stage === STAGE_HELPING) {
      if (relationsOf(player) >= 60 && foodOf(player) >= 20) {
        quest.setStage(player, STAGE_KENDAL);
        playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-shining-pool");
        return;
      }
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-listening-to-the-center-shining-pool");
      return;
    }
    if (stage === STAGE_KENDAL || stage === STAGE_FIGHT) {
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-shining-pool");
      return;
    }
    if (stage === STAGE_CORPSE) {
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-talking-to-shining-pool-before-hamal");
      return;
    }
    if (stage === STAGE_BURIAL) {
      playVariant(
        player,
        SCENERY_SPEAKER_NPC_ID,
        flag(player, BURIED_ATTRIBUTE)
          ? "fighting-the-kendal-listening-to-the-shining-pool-before-building-the-cairn"
          : "fighting-the-kendal-listening-to-the-shining-pool-before-laying-asleif-to-rest"
      );
    }
  }

  function useRocksOnMound(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== BURIAL_MOUND_OBJECT_ID || itemId !== MUDDY_ROCK_ITEM_ID) return;
    event.handled = true;
    if (!flag(player, BURIED_ATTRIBUTE) || quest.getStage(player) < STAGE_BURIAL) return;
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-listening-to-the-shining-pool-before-building-the-cairn-building-the-cairn");
  }

  function enterCave(event) {
    const { player, objectId } = event;
    if (objectId !== CAVE_ENTRANCE_OBJECT_ID) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage < STAGE_KENDAL) {
      playVariant(player, SCENERY_SPEAKER_NPC_ID, "crisis-using-the-mud-on-the-tree-attempting-to-enter-the-cave");
      return;
    }
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-entering-the-cave");
    player.moveTo(LAIR_ENTRY_TILE);
    handleLairEnter({ player });
  }

  function exitCave(event) {
    const { player, objectId } = event;
    if (!CAVE_EXIT_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    playVariant(player, SCENERY_SPEAKER_NPC_ID, "fighting-the-kendal-the-kendal-leaving-the-cave");
    player.moveTo(CAVE_MOUTH_TILE);
    handleLairExit({ player });
  }

  function handleObjectInteraction(event) {
    const objectId = event.objectId;
    if (objectId === ROCKSLIDE_OBJECT_ID) return climbRockslide(event);
    if (objectId === TALL_TREE_OBJECT_ID) return climbTallTree(event);
    if (objectId === CLUMP_OF_ROCKS_OBJECT_ID) return jumpAcrossClump(event);
    if (objectId === FLAT_STONE_RETURN_OBJECT_ID) return jumpFlatStone(event);
    if (objectId === MUD_OBJECT_ID) return digMud(event);
    if (SHINING_POOL_OBJECT_IDS.has(objectId)) return listenToShiningPool(event);
    if (objectId === THORNY_BUSHES_OBJECT_ID) return pickThornyBush(event);
    if (objectId === CAVE_ENTRANCE_OBJECT_ID) return enterCave(event);
    if (CAVE_EXIT_OBJECT_IDS.has(objectId)) return exitCave(event);
  }

  function handleItemOnObject(event) {
    const objectId = event.objectId;
    if (objectId === BOULDER_OBJECT_ID) return useRopeOnBoulder(event);
    if (objectId === TALL_TREE_OBJECT_ID) return useMudOnTree(event);
    if (objectId === CLUMP_OF_ROCKS_OBJECT_ID) return useItemOnClump(event);
    if (objectId === FLAT_STONE_OBJECT_ID || objectId === FLAT_STONE_RETURN_OBJECT_ID) return usePlankOnFlatStone(event);
    if (objectId === ANCIENT_ROCK_OBJECT_ID) return usePickaxeOnAncientRock(event);
    if (objectId === BURIAL_MOUND_OBJECT_ID) return useRocksOnMound(event);
  }

  // ==========================================================================
  // Brundt (The Fremennik Trials owns his default variant selector)
  // ==========================================================================

  function talkToBrundt(event) {
    const { player, npcId } = event;
    if (!BRUNDT_NPC_IDS.has(npcId)) return false;
    if (quest.getStage(player) < STAGE_HELPING) return false;
    const relations = relationsOf(player);
    if (relations < 10 || relations >= 60) return false;
    event.handled = true;
    if (relations < 30) {
      playVariant(player, BRUNDT_NPC_ID, "making-peace-brundt-the-chieftain");
      return true;
    }
    if (relations < 40) {
      playVariant(player, BRUNDT_NPC_ID, "making-peace-talking-to-brundt-before-receiving-the-rock");
      return true;
    }
    if (relations < 50) {
      playVariant(player, BRUNDT_NPC_ID, "making-peace-talking-to-brundt-the-chieftain-after-obtaining-half-a-rock");
      return true;
    }
    playVariant(player, BRUNDT_NPC_ID, "making-peace-talking-to-brundt-before-receiving-the-rock");
    return true;
  }

  // ==========================================================================
  // Login / logout
  // ==========================================================================

  function handleLogin({ player }) {
    refreshQuestList(player);
    removeOwnedKendal(player);
    if (insideLair(player.getLocation())) handleLairEnter({ player });
    if (flag(player, BURIED_ATTRIBUTE)) registerBurialMound();
    if (quest.isComplete(player)) registerBurialCairn();
  }

  function handleLogout({ player }) {
    removeOwnedKendal(player);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I agreed to help Hamal the Chieftain find his missing daughter.</str>",
        "<str>Her spirit asked me to make peace with Rellekka and find new food.</str>",
        "<str>I killed the Kendal and buried Asleif with her necklace on the island.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BURIAL) {
      return [
        "<str>I agreed to help Hamal the Chieftain find his missing daughter.</str>",
        "<str>I convinced Hamal of Asleif's death and he asked for a burial.</str>",
        "",
        flag(player, BURIED_ATTRIBUTE)
          ? "I need to build a cairn on Asleif's burial mound with 5 muddy rocks."
          : "I need to bury Asleif on the island with one of her possessions.",
      ];
    }
    if (stage >= STAGE_CORPSE) {
      if (hasCorpse(player)) {
        return [
          "<str>I agreed to help Hamal the Chieftain find his missing daughter.</str>",
          "<str>I killed the Kendal and recovered Asleif's corpse.</str>",
          "",
          "I should take Asleif's corpse to <col=800000>Hamal</col>.",
        ];
      }
      return [
        "<str>I agreed to help Hamal the Chieftain find his missing daughter.</str>",
        "<str>The Kendal is dead. I should take Asleif's remains from his cave.</str>",
      ];
    }
    if (stage >= STAGE_KENDAL) {
      return [
        "<str>I agreed to help Hamal the Chieftain find his missing daughter.</str>",
        "<str>I made peace with Rellekka and found the White Pearl fruit.</str>",
        "",
        "Asleif's spirit says the creature that killed her dragged her north.",
        "I should enter the <col=800000>cave</col> by the pool.",
      ];
    }
    if (stage >= STAGE_HELPING) {
      const lines = [
        "<str>I agreed to help Hamal the Chieftain find his missing daughter.</str>",
        "<str>Asleif's spirit asked me to help her tribe survive.</str>",
        "",
      ];
      lines.push(
        relationsOf(player) >= 60
          ? "<str>I made peace between the camp and Rellekka.</str>"
          : "I need to make peace between the camp and <col=800000>Rellekka</col>."
      );
      lines.push(
        foodOf(player) >= 20
          ? "<str>I found the camp a new supply of food.</str>"
          : "I need to find a new food supply for the camp."
      );
      return lines;
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I agreed to help Hamal the Chieftain look for his daughter, Asleif.</str>",
        "",
        "I should search for clues by the <col=800000>shining pool</col> north-west",
        "of the Mountain Camp, and speak to her fiance <col=800000>Ragnar</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Hamal the Chieftain</col>",
      "in the <col=800000>Mountain Camp</col>, east of Rellekka.",
      "",
      "I will need a rope, pickaxe, axe, plank and gloves.",
    ];
  }

  // ==========================================================================
  // Rewards
  // ==========================================================================

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 1000);
    player.getSkillManager().addExperiences(Skill.PRAYER, 2000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(RELATIONS_ATTRIBUTE);
  api.persistAttribute(FOOD_ATTRIBUTE);
  api.persistAttribute(MUD_ATTRIBUTE);
  api.persistAttribute(CORPSE_ATTRIBUTE);
  api.persistAttribute(NECKLACE_ATTRIBUTE);
  api.persistAttribute(KENDAL_DEAD_ATTRIBUTE);
  api.persistAttribute(BURIAL_TASK_ATTRIBUTE);
  api.persistAttribute(BURIED_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "mountain_daughter",
    name: "Mountain Daughter",
    varpId: VARP_MOUNTAIN_DAUGHTER,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 2000, label: "Prayer" },
      { skillId: Skill.ATTACK.getIndex(), amount: 1000, label: "Attack" },
    ],
    scrollItemId: BEARHEAD_ITEM_ID,
    rewardItemLabel: "A Bearhead",
    otherRewards: ["The ability to pass into the Mountain Camp"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction("Brundt the Chieftain", { "Talk-to": talkToBrundt });
  api.onCanAttack(handleCanAttack);
  api.onNpcDeath(handleNpcDeath);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onItemAction("Corpse of woman", { Bury: buryAsleif });
  api.onItemAction("White pearl", { Eat: eatWhitePearl });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onZoneEnter(LAIR_ZONE, handleLairEnter);
  api.onZoneExit(LAIR_ZONE, handleLairExit);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
