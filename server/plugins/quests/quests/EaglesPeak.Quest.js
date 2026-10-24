/**
 * Eagles' Peak (members).
 *
 * The words come from the "Eagles' Peak" transcript page (plus the "Charlie",
 * "Asyff" and "Nickolaus" pages for the post-quest conversations). This plugin
 * supplies the variant selectors for Charlie, Asyff and Nickolaus, the prose
 * condition answers (Hunter level, coins, disguise checks, reset lever), the
 * camp-site book/metal feather flow, the rocky outcrop and cave entrance, the
 * three feather puzzles (winches, tracking kebbit, birdseed feeders), the stone
 * door, the giant eagle walk-past, the ferret tutorial and the Charlie hand-in.
 *
 * Stages (varbit 2780 "eaglepeak_quest", varp 934, bits 0-5; cache evidence:
 * `lookup-gameval.ts varbit eaglepeak` -> "2780 eaglepeak_quest varp=934 bits=0-5"):
 *   1 accepted the search for Nickolaus (Charlie),
 *   2 read the bird book / has the metal feather (camp-site),
 *   3 opened the rocky outcrop with the metal feather,
 *   4 met Nickolaus across the chasm (disguise requested),
 *   5 Asyff made the eagle disguise,
 *   6 gave Nickolaus his disguise (he leaves the nest),
 *   7 caught the ferret with Nickolaus at the camp,
 *   8 gave the ferret to Charlie (complete).
 * The OSRS side varbits in the same varp (3087-3113: unblocked eagles, winches,
 * net trap, tracking, metal birds/gates, eagle door) are tracked in persisted
 * "quest.eagles_peak.*" attributes instead; only the stage varbit is mirrored
 * for the client.
 *
 * Camp-site scenery and the bronze feather's pedestal are script-spawned in
 * OSRS and absent from this cache's map, so the plugin places them at their
 * wiki tiles: campfire 19884 at 2316,3502, books 19886 at 2319,3502, rocky
 * outcrop 19925 at 2328,3494 (swapped for cave entrance 19926 once opened) and
 * stone pedestal 19984 at 1974,4914. The gold pedestal 19950 is map-placed at
 * 1928,4907; the winches, four gold levers, birdseed holder, nine feeders, the
 * silver tracking rocks/pedestal/opening and the stone door are map objects.
 *
 * Gaps / approximations:
 *   - the metal birds and wing gates of the gold puzzle are varbit locs absent
 *     from this cache's map, so the golden pedestal unlocks after feeding six
 *     distinct feeders and operating all four levers (any order; the wiki's
 *     exact eleven-step sequence is not simulated);
 *   - the rocky outcrop/cave passage is one global state, not per-player: it
 *     stays open for everyone once opened and closes on a server restart;
 *   - the winches cannot be checked against the real net-trap geometry, so the
 *     "before the trap" state replays the wiki's "doesn't turn any further" line;
 *   - the golden pedestal sends a plain game message while the puzzle is unsolved;
 *   - the spawned quest kebbit has no combat definition in this cache, so the
 *     Threaten -> Taunt path is the reliable one; the death drop is wired anyway;
 *   - the eagle transport system (the eagles, rope lasso and the jungle/desert
 *     nest access) is plugins/world/EagleTransport.plugin.js;
 *   - extra eagle costumes (5 feathers, swamp tar, yellow dye, 25 gp) are
 *     described by Asyff's repeat dialogue but not sold;
 *   - the dungeon tunnel pairs are inferred (the real partners are not in this
 *     cache): gold 19894 <-> 19903, bronze 19906 <-> 19897, silver 19900 <-> 19909.
 *
 * Source: https://oldschool.runescape.wiki/w/Eagles%27_Peak and
 * https://oldschool.runescape.wiki/w/Transcript:Eagles%27_Peak
 */
module.exports = function registerEaglesPeakQuest(api) {
  const {
    Equipment,
    GameObject,
    HitDamage,
    HitMask,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const CHARLIE_NPC_ID = NpcIdentifiers.CHARLIE_2; // 1495
  const ASYFF_NPC_ID = NpcIdentifiers.ASYFF; // 2887
  const NICKOLAUS_CHASM_NPC_ID = NpcIdentifiers.NICKOLAUS_2; // 1484, Shout-to
  const NICKOLAUS_NEST_NPC_ID = NpcIdentifiers.NICKOLAUS_3; // 1485, Talk-to
  const GIANT_EAGLE_NPC_ID = NpcIdentifiers.EAGLE; // 1490, Walk-past
  const QUEST_KEBBIT_NPC_ID = NpcIdentifiers.KEBBIT; // 1494, Attack/Threaten

  const BIRD_BOOK_ITEM_ID = ItemIdentifiers.BIRD_BOOK; // 10173
  const METAL_FEATHER_ITEM_ID = ItemIdentifiers.METAL_FEATHER; // 10174
  const EAGLE_FEATHER_ITEM_ID = ItemIdentifiers.EAGLE_FEATHER; // 10167
  const EAGLE_CAPE_ITEM_ID = ItemIdentifiers.EAGLE_CAPE; // 10171
  const FAKE_BEAK_ITEM_ID = ItemIdentifiers.FAKE_BEAK; // 10172
  const BRONZE_FEATHER_ITEM_ID = ItemIdentifiers.BRONZE_FEATHER; // 10177
  const SILVER_FEATHER_ITEM_ID = ItemIdentifiers.SILVER_FEATHER; // 10176
  const GOLDEN_FEATHER_ITEM_ID = ItemIdentifiers.GOLDEN_FEATHER_2; // 10175
  const ODD_BIRD_SEED_ITEM_ID = ItemIdentifiers.ODD_BIRD_SEED; // 10178
  const FERRET_ITEM_ID = ItemIdentifiers.FERRET; // 10092
  const BOX_TRAP_ITEM_ID = ItemIdentifiers.BOX_TRAP; // 10008
  const SWAMP_TAR_ITEM_ID = ItemIdentifiers.SWAMP_TAR; // 1939
  const YELLOW_DYE_ITEM_ID = ItemIdentifiers.YELLOW_DYE; // 1765
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995

  const CAMPFIRE_OBJECT_ID = ObjectIdentifiers.CAMPFIRE_2; // 19884, Inspect
  const BOOKS_OBJECT_ID = ObjectIdentifiers.BOOKS_2; // 19886, Inspect
  const ROCKY_OUTCROP_OBJECT_ID = ObjectIdentifiers.ROCKY_OUTCROP_2; // 19925, Inspect
  const CAVE_ENTRANCE_OBJECT_ID = ObjectIdentifiers.CAVE_ENTRANCE_55; // 19926, Enter
  const DUNGEON_EXIT_OBJECT_ID = ObjectIdentifiers.CAVE_ENTRANCE_53; // 19891, Exit
  const GIANT_FEATHERS_OBJECT_ID = ObjectIdentifiers.GIANT_FEATHERS; // 19922, Take
  const BIRDSEED_HOLDER_OBJECT_ID = ObjectIdentifiers.BIRDSEED_HOLDER; // 19919, Take-from
  const RESET_LEVER_OBJECT_ID = ObjectIdentifiers.RESET_LEVER; // 19945, Pull
  const GOLD_PEDESTAL_OBJECT_ID = ObjectIdentifiers.STONE_PEDESTAL_2; // 19950, Take-from
  const BRONZE_PEDESTAL_OBJECT_ID = ObjectIdentifiers.STONE_PEDESTAL_5; // 19984, Take-from
  const SILVER_PEDESTAL_OBJECT_ID = ObjectIdentifiers.STONE_PEDESTAL_3; // 19473, Inspect
  const KEBBIT_OPENING_OBJECT_ID = ObjectIdentifiers.OPENING; // 19456, Inspect
  const SILVER_ROCK_FIRST_OBJECT_ID = ObjectIdentifiers.ROCKS_26; // 19458
  const SILVER_ROCK_SECOND_OBJECT_ID = ObjectIdentifiers.ROCKS_29; // 19461
  const SILVER_ROCK_WRONG_OBJECT_ID = ObjectIdentifiers.ROCKS_30; // 19464

  const WINCH_OBJECT_IDS = new Set([
    ObjectIdentifiers.WINCH_9, // 19976
    ObjectIdentifiers.WINCH_10, // 19977
    ObjectIdentifiers.WINCH_11, // 19978
    ObjectIdentifiers.WINCH_12, // 19979
  ]);
  const FEEDER_INDEX_BY_OBJECT = new Map([
    [ObjectIdentifiers.BIRD_FEEDER_3, 0], // 19936
    [ObjectIdentifiers.BIRD_FEEDER_4, 1], // 19937
    [ObjectIdentifiers.BIRD_FEEDER_5, 2], // 19938
    [ObjectIdentifiers.BIRD_FEEDER_6, 3], // 19939
    [ObjectIdentifiers.BIRD_FEEDER_7, 4], // 19940
    [ObjectIdentifiers.BIRD_FEEDER_8, 5], // 19941
    [ObjectIdentifiers.BIRD_FEEDER_9, 6], // 19942
    [ObjectIdentifiers.BIRD_FEEDER_10, 7], // 19943
    [ObjectIdentifiers.BIRD_FEEDER_11, 8], // 19944
  ]);
  const FEEDER_OBJECT_IDS = new Set(FEEDER_INDEX_BY_OBJECT.keys());
  // Nameless gold-puzzle levers, map-placed at 1925-1978 / 4891-4915 (Pull-down|Push-up).
  const GOLD_LEVER_OBJECT_IDS = new Set([19946, 19947, 19948, 19949]);
  const GOLD_LEVER_BITS = new Map([
    [19946, 1 << 0],
    [19947, 1 << 1],
    [19948, 1 << 2],
    [19949, 1 << 3],
  ]);
  const GOLD_ALL_LEVERS = 0b1111;
  // Nameless map-placed stone door leaves (cache loc dump: 19843/2003,4947 and
  // 19991/2003,4948, option Open); the named children 19914-19918 can surface once
  // the door's varbits resolve.
  const STONE_DOOR_OBJECT_IDS = new Set([
    19843,
    19991,
    ObjectIdentifiers.STONE_DOOR_3, // 19914
    ObjectIdentifiers.STONE_DOOR_4, // 19915
    ObjectIdentifiers.STONE_DOOR_5, // 19916
    ObjectIdentifiers.STONE_DOOR_6, // 19917
    ObjectIdentifiers.STONE_DOOR_7, // 19918
  ]);

  const TUNNEL_LINKS = new Map([
    [ObjectIdentifiers.TUNNEL_31, { x: 1988, y: 4972, z: 3 }], // gold out to the nest
    [ObjectIdentifiers.TUNNEL_34, { x: 1958, y: 4908, z: 2 }], // gold back to the corridor
    [ObjectIdentifiers.TUNNEL_35, { x: 2021, y: 4982, z: 3 }], // bronze out to the nest
    [ObjectIdentifiers.TUNNEL_32, { x: 1974, y: 4911, z: 2 }], // bronze back to the winches
    [ObjectIdentifiers.TUNNEL_33, { x: 1988, y: 4949, z: 3 }], // silver out to the nest
    [ObjectIdentifiers.TUNNEL_36, { x: 1947, y: 4871, z: 2 }], // silver back to the pedestal
  ]);

  const WINCH_BIT_BY_OBJECT = new Map([
    [ObjectIdentifiers.WINCH_9, 1 << 3],
    [ObjectIdentifiers.WINCH_10, 1 << 4],
    [ObjectIdentifiers.WINCH_11, 1 << 5],
    [ObjectIdentifiers.WINCH_12, 1 << 6],
  ]);
  const WINCH_ALL_BITS = (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6);
  const DOOR_FEATHER_BIT_BY_ITEM = new Map([
    [BRONZE_FEATHER_ITEM_ID, 1 << 13],
    [SILVER_FEATHER_ITEM_ID, 1 << 14],
    [GOLDEN_FEATHER_ITEM_ID, 1 << 15],
  ]);
  const DOOR_ALL_FEATHERS = (1 << 13) | (1 << 14) | (1 << 15);

  const BITS_ATTRIBUTE = "quest.eagles_peak.bits";
  const GOLD_FED_ATTRIBUTE = "quest.eagles_peak.gold-fed";
  const GOLD_LEVERS_ATTRIBUTE = "quest.eagles_peak.gold-levers";
  const BIT_BOOK_TAKEN = 1 << 0;
  const BIT_BOOK_READ = 1 << 1;
  const BIT_TRAP_SPRUNG = 1 << 2;
  const BIT_TRAIL_1 = 1 << 7;
  const BIT_TRAIL_2 = 1 << 8;
  const BIT_KEBBIT_DEALT = 1 << 9;
  const BIT_KEBBIT_OUT = 1 << 10;
  const BIT_ASYFF_ASKED = 1 << 11;
  const BIT_OUTFIT_SHOUTED = 1 << 12;
  const BIT_SILVER_PEDESTAL = 1 << 16;

  const VARP_EAGLES_PEAK = 934;
  const VARBIT_EAGLES_PEAK_STAGE = 2780;

  const STAGE_STARTED = 1;
  const STAGE_METAL_FEATHER = 2;
  const STAGE_ENTERED = 3;
  const STAGE_MET_NICKOLAUS = 4;
  const STAGE_DISGUISE = 5;
  const STAGE_RESCUED = 6;
  const STAGE_HAS_FERRET = 7;
  const STAGE_COMPLETE = 8;

  const HUNTER_REQUIREMENT = 27;
  const COSTUME_FEATHER_COST = 10;
  const COSTUME_COIN_COST = 50;
  const GOLD_FEEDERS_NEEDED = 6;
  const EAGLE_DAMAGE = 10;

  const PAGE = "Eagles' Peak";
  /** Chathead anchor for the page's message-only variants (no NPC lines). */
  const PAGE_SPEAKER_NPC_ID = NICKOLAUS_CHASM_NPC_ID;

  const CAMPFIRE_TILE = { x: 2316, y: 3502, z: 0 };
  const BOOKS_TILE = { x: 2319, y: 3502, z: 0 };
  const OUTCROP_TILE = { x: 2328, y: 3494, z: 0 };
  const SURFACE_LANDING_TILE = { x: 2328, y: 3496, z: 0 };
  const CAMP_NICKOLAUS_TILE = { x: 2318, y: 3503, z: 0 };
  const DUNGEON_LANDING_TILE = { x: 1994, y: 4984, z: 3 };
  const NEST_TILE = { x: 2016, y: 4947, z: 3 };
  const EAGLE_TILE = { x: 2006, y: 4951, z: 3 };
  const KEBBIT_TILE = { x: 1971, y: 4885, z: 2 };
  const BRONZE_PEDESTAL_TILE = { x: 1974, y: 4914, z: 2 };

  const CAMP_ZONE = { minX: 2280, maxX: 2410, minY: 3430, maxY: 3620, levels: [0] };
  const DUNGEON_ZONE = { minX: 1870, maxX: 2070, minY: 4840, maxY: 5020, levels: [2, 3] };

  let quest;
  let campObjectsInstalled = false;
  let outcropObject = null;
  let cavePassageOpen = false;
  let itemOnGroundManager = null;

  const eagleByPlayer = new Map();
  const shoutNickolausByPlayer = new Map();
  const nestNickolausByPlayer = new Map();
  const campNickolausByPlayer = new Map();
  const kebbitByPlayer = new Map();

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function hasAllBits(player, mask) {
    return (bits(player) & mask) === mask;
  }

  function hunterLevel(player) {
    return Number(player.getSkillManager().getMaxLevel(Skill.HUNTER)) || 0;
  }

  function hasCoins(player) {
    return held(player, COINS_ITEM_ID, COSTUME_COIN_COST);
  }

  function hasCostumeMaterials(player) {
    return (
      held(player, EAGLE_FEATHER_ITEM_ID, COSTUME_FEATHER_COST) &&
      held(player, SWAMP_TAR_ITEM_ID) &&
      held(player, YELLOW_DYE_ITEM_ID)
    );
  }

  function wearingEagleDisguise(player) {
    const cape = player.getEquipment().get(Equipment.CAPE_SLOT);
    const head = player.getEquipment().get(Equipment.HEAD_SLOT);
    return (
      cape?.getId?.() === EAGLE_CAPE_ITEM_ID && head?.getId?.() === FAKE_BEAK_ITEM_ID
    );
  }

  function hasSpareDisguise(player) {
    return held(player, EAGLE_CAPE_ITEM_ID) && held(player, FAKE_BEAK_ITEM_ID);
  }

  function inDungeon(player) {
    return Number(player.getLocation().getY()) > 4000;
  }

  function grantItem(player, itemId, amount = 1) {
    if (!held(player, itemId) && player.getInventory().isFull()) {
      player.sendMessage("You don't have enough free inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function playVariant(player, variant) {
    startTranscript(api, player, PAGE_SPEAKER_NPC_ID, PAGE, variant);
  }

  function damage(player, amount) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);
  }

  /** The stone door leaves are 1 tile wide on x=2003; cross them at the player's y. */
  const STONE_DOOR_X = 2003;
  const STONE_DOOR_WEST_LANDING = 2002;
  const STONE_DOOR_EAST_LANDING = 2004;

  /** Dispatch on the player-resolved loc (varbit transforms) when the cache has one. */
  function resolvedObjectId(event) {
    if (event.definition?.id != null) return event.definition.id;
    if (event.object) {
      const definition = ObjectDefinition.forPlayer(event.object.getId(), event.player);
      if (definition) return definition.id;
    }
    return event.objectId;
  }

  // ==========================================================================
  // Spawns and quest scenery
  // ==========================================================================

  function registerObject(objectId, tile) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, tile.z), 10, 0, null);
    ObjectManager.register(object, true);
    return object;
  }

  /** Camp-site scenery and the rocky outcrop, absent from this cache's map. */
  function installCampObjects() {
    if (campObjectsInstalled) return;
    campObjectsInstalled = true;
    registerObject(CAMPFIRE_OBJECT_ID, CAMPFIRE_TILE);
    registerObject(BOOKS_OBJECT_ID, BOOKS_TILE);
    registerObject(BRONZE_PEDESTAL_OBJECT_ID, BRONZE_PEDESTAL_TILE);
    outcropObject = registerObject(ROCKY_OUTCROP_OBJECT_ID, OUTCROP_TILE);
  }

  function openCavePassage() {
    if (cavePassageOpen) return;
    cavePassageOpen = true;
    if (outcropObject) {
      ObjectManager.deregister(outcropObject, true);
      outcropObject = null;
    }
    registerObject(CAVE_ENTRANCE_OBJECT_ID, OUTCROP_TILE);
  }

  function spawnOwnedNpc(map, player, id, tile) {
    const npc = api.spawnNpc({
      id,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) map.set(player, npc);
    return npc;
  }

  function removeOwnedNpc(map, player) {
    const npc = map.get(player);
    if (!npc) return;
    map.delete(player);
    api.removeNpc(npc);
  }

  function ensureEagle(player) {
    if (!eagleByPlayer.has(player)) spawnOwnedNpc(eagleByPlayer, player, GIANT_EAGLE_NPC_ID, EAGLE_TILE);
  }

  function ensureShoutNickolaus(player) {
    if (!shoutNickolausByPlayer.has(player)) {
      spawnOwnedNpc(shoutNickolausByPlayer, player, NICKOLAUS_CHASM_NPC_ID, NEST_TILE);
    }
  }

  function ensureNestNickolaus(player) {
    if (!nestNickolausByPlayer.has(player)) {
      spawnOwnedNpc(nestNickolausByPlayer, player, NICKOLAUS_NEST_NPC_ID, NEST_TILE);
    }
  }

  function ensureCampNickolaus(player) {
    if (quest.getStage(player) < STAGE_RESCUED) return;
    if (!campNickolausByPlayer.has(player)) {
      spawnOwnedNpc(campNickolausByPlayer, player, NICKOLAUS_NEST_NPC_ID, CAMP_NICKOLAUS_TILE);
    }
  }

  function ensureKebbit(player) {
    if (!kebbitByPlayer.has(player)) {
      spawnOwnedNpc(kebbitByPlayer, player, QUEST_KEBBIT_NPC_ID, KEBBIT_TILE);
    }
  }

  /** Keep the per-player dungeon NPCs in step with the stage and the door. */
  function ensureDungeonSpawns(player) {
    if (!inDungeon(player)) return;
    ensureEagle(player);
    const stage = quest.getStage(player);
    const doorOpen = doorUnlocked(player);
    if (stage >= STAGE_ENTERED && stage < STAGE_RESCUED) {
      if (doorOpen) {
        removeOwnedNpc(shoutNickolausByPlayer, player);
        ensureNestNickolaus(player);
      } else {
        removeOwnedNpc(nestNickolausByPlayer, player);
        ensureShoutNickolaus(player);
      }
    } else {
      removeOwnedNpc(shoutNickolausByPlayer, player);
      removeOwnedNpc(nestNickolausByPlayer, player);
    }
    if (hasBit(player, BIT_KEBBIT_OUT) && !hasBit(player, BIT_KEBBIT_DEALT) && !held(player, SILVER_FEATHER_ITEM_ID)) {
      ensureKebbit(player);
    } else {
      removeOwnedNpc(kebbitByPlayer, player);
    }
  }

  function clearOwnedNpcs(player) {
    removeOwnedNpc(eagleByPlayer, player);
    removeOwnedNpc(shoutNickolausByPlayer, player);
    removeOwnedNpc(nestNickolausByPlayer, player);
    removeOwnedNpc(campNickolausByPlayer, player);
    removeOwnedNpc(kebbitByPlayer, player);
  }

  // ==========================================================================
  // Variant selection and condition answers
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === CHARLIE_NPC_ID) {
      if (quest.isComplete(player)) return "standard-dialogue-after-completing-eagles-peak";
      if (stage >= STAGE_HAS_FERRET) return "finishing-up";
      if (stage >= STAGE_STARTED) return "starting-out-talking-to-charlie-again";
      return "starting-out-before-starting-eagle-s-peak";
    }
    if (npcId === ASYFF_NPC_ID) {
      if (stage < STAGE_MET_NICKOLAUS || quest.isComplete(player)) return null;
      if (stage >= STAGE_DISGUISE) return "getting-a-bird-costume-asking-for-another-costume";
      if (!hasBit(player, BIT_ASYFF_ASKED)) return "getting-a-bird-costume";
      if (hasCostumeMaterials(player)) return "getting-a-bird-costume-returning-to-asyff-with-the-materials";
      return "getting-a-bird-costume-returning-to-asyff-without-the-materials";
    }
    if (npcId === NICKOLAUS_NEST_NPC_ID) {
      if (inDungeon(player)) {
        if (stage >= STAGE_RESCUED) return "saving-nickolaus-talking-to-nickolaus-again";
        if (stage >= STAGE_DISGUISE) return "saving-nickolaus-with-eagle-outfit";
        return null;
      }
      if (quest.isComplete(player)) return "after-eagles-peak";
      if (stage >= STAGE_HAS_FERRET) return "after-eagles-peak";
      if (stage >= STAGE_RESCUED) return "saving-nickolaus-talking-to-nickolaus-by-the-camp";
      return null;
    }
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (npcId === CHARLIE_NPC_ID) {
      if (stepId === "EI4KEb") return hunterLevel(player) < HUNTER_REQUIREMENT;
      if (stepId === "lf198B") return hunterLevel(player) >= HUNTER_REQUIREMENT;
      return null;
    }
    if (npcId === ASYFF_NPC_ID) {
      if (stepId === "guIJ1-") return !hasCoins(player) || !hasCostumeMaterials(player);
      if (stepId === "G6Owrt") return hasCoins(player) && hasCostumeMaterials(player);
      return null;
    }
    if (npcId === NICKOLAUS_CHASM_NPC_ID) {
      if (stepId === "-t7KBZ") return hasSpareDisguise(player);
      if (stepId === "SnpQQ4") return !hasSpareDisguise(player);
    }
    if (npcId === NICKOLAUS_NEST_NPC_ID) {
      if (stepId === "s8BAWs") return wearingEagleDisguise(player);
      if (stepId === "7lpXS1") return hasSpareDisguise(player);
      if (stepId === "6htIhv") return !hasSpareDisguise(player);
    }
    // Message-only variants play with the page speaker; scope them by step id.
    if (stepId === "Fm5was") return hunterLevel(player) < HUNTER_REQUIREMENT;
    if (stepId === "INx7WC") return hunterLevel(player) >= HUNTER_REQUIREMENT;
    if (stepId === "gWbslG") return !hasGoldPuzzleState(player);
    if (stepId === "wpwc4i") return hasGoldPuzzleState(player);
    return null;
  }

  function handleDialogueLine(event) {
    if (event.npcId !== NICKOLAUS_CHASM_NPC_ID) return;
    if (event.text === "I'm afraid not yet.'''") event.text = "I'm afraid not yet.";
  }

  /** Wiki option text carries double spaces; compare on a collapsed form. */
  function optionText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function handleDialogueChoice({ npcId, player, option }) {
    const choice = optionText(option);
    if (npcId === CHARLIE_NPC_ID && choice === "Sure. Any idea where I should start looking?") {
      if (quest.getStage(player) === 0 && hunterLevel(player) >= HUNTER_REQUIREMENT) {
        quest.setStage(player, STAGE_STARTED);
      }
      return;
    }
    if (npcId === NICKOLAUS_CHASM_NPC_ID && choice === "Could I help at all?") {
      if (quest.getStage(player) === STAGE_ENTERED) quest.setStage(player, STAGE_MET_NICKOLAUS);
      return;
    }
    if (npcId === ASYFF_NPC_ID && choice === "Well, specifically I'm after a couple of bird costumes.") {
      setBit(player, BIT_ASYFF_ASKED);
    }
  }

  function handleDialogueCondition({ player, stepId }) {
    if (stepId === "G6Owrt") {
      handInCostumeMaterials(player);
      return;
    }
    if (stepId === "7lpXS1") {
      handOverDisguise(player);
      return;
    }
    if (stepId === "wpwc4i") {
      player.setAttribute(GOLD_FED_ATTRIBUTE, 0);
      player.setAttribute(GOLD_LEVERS_ATTRIBUTE, 0);
    }
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === "9dUo1i" || stepId === "GS8QEB") {
      event.handled = true;
      setBit(player, BIT_BOOK_READ);
      if (quest.getStage(player) < STAGE_METAL_FEATHER) quest.setStage(player, STAGE_METAL_FEATHER);
      if (!held(player, METAL_FEATHER_ITEM_ID)) grantItem(player, METAL_FEATHER_ITEM_ID);
      return;
    }
    if (stepId === "aBNXro") {
      event.handled = true;
      player.sendMessage("A giant Kebbit jumps out of the cave.");
      setBit(player, BIT_KEBBIT_OUT);
      ensureKebbit(player);
      return;
    }
    if (stepId === "PuOM27") {
      event.handled = true;
      player.sendMessage("The Kebbit goes into the opening while dropping the Silver feather.");
      setBit(player, BIT_KEBBIT_DEALT);
      removeOwnedNpc(kebbitByPlayer, player);
      if (!held(player, SILVER_FEATHER_ITEM_ID)) grantItem(player, SILVER_FEATHER_ITEM_ID);
      return;
    }
    if (stepId === "HkXWU8") {
      event.handled = true;
      player.sendMessage("Cutscene starts.");
      return;
    }
    if (stepId === "OjrdFa") {
      event.handled = true;
      player.sendMessage("A ferret goes into the box trap.");
      return;
    }
    if (stepId === "w-9QTz") {
      event.handled = true;
      player.sendMessage("Cutscene ends.");
      if (quest.getStage(player) === STAGE_RESCUED) {
        if (!held(player, FERRET_ITEM_ID)) grantItem(player, FERRET_ITEM_ID);
        if (!held(player, BOX_TRAP_ITEM_ID)) grantItem(player, BOX_TRAP_ITEM_ID);
        quest.setStage(player, STAGE_HAS_FERRET);
      }
      return;
    }
    if (stepId === "YUPVwJ") {
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) >= STAGE_HAS_FERRET && held(player, FERRET_ITEM_ID)) {
        player.getInventory().deleteNumber(FERRET_ITEM_ID, 1);
        quest.complete(player);
      }
    }
  }

  function handInCostumeMaterials(player) {
    if (!hasCoins(player) || !hasCostumeMaterials(player)) return;
    player.getInventory().deleteNumber(EAGLE_FEATHER_ITEM_ID, COSTUME_FEATHER_COST);
    player.getInventory().deleteNumber(SWAMP_TAR_ITEM_ID, 1);
    player.getInventory().deleteNumber(YELLOW_DYE_ITEM_ID, 1);
    player.getInventory().deleteNumber(COINS_ITEM_ID, COSTUME_COIN_COST);
    player.getInventory().adds(EAGLE_CAPE_ITEM_ID, 2);
    player.getInventory().adds(FAKE_BEAK_ITEM_ID, 2);
    if (quest.getStage(player) < STAGE_DISGUISE) quest.setStage(player, STAGE_DISGUISE);
  }

  function handOverDisguise(player) {
    if (!hasSpareDisguise(player)) return;
    player.getInventory().deleteNumber(EAGLE_CAPE_ITEM_ID, 1);
    player.getInventory().deleteNumber(FAKE_BEAK_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_RESCUED) quest.setStage(player, STAGE_RESCUED);
    removeOwnedNpc(nestNickolausByPlayer, player);
    removeOwnedNpc(shoutNickolausByPlayer, player);
    ensureCampNickolaus(player);
  }

  // ==========================================================================
  // Item actions and item-on-object
  // ==========================================================================

  function handleItemAction(event) {
    if (event.itemId !== BIRD_BOOK_ITEM_ID) return;
    if (event.option !== undefined ? event.option !== "Read" : event.clickType !== 1) return;
    event.handled = true;
    if (hasBit(event.player, BIT_BOOK_READ)) return;
    playVariant(event.player, "nickolaus-s-camp-opening-the-bird-book");
  }

  /** The stone door's map ids encode varbit states; everything else is a fixed id. */
  function questObjectId(event) {
    return STONE_DOOR_OBJECT_IDS.has(event.objectId) ? resolvedObjectId(event) : event.objectId;
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const objectId = questObjectId(event);
    if (itemId === METAL_FEATHER_ITEM_ID) {
      if (objectId === ROCKY_OUTCROP_OBJECT_ID) {
        event.handled = true;
        if (cavePassageOpen) {
          playVariant(player, "nickolaus-s-camp-using-the-metal-feather-on-the-cave-entrance");
          return;
        }
        playVariant(player, "nickolaus-s-camp-using-the-metal-feather-on-the-rocky-outcrop");
        openCavePassage();
        if (quest.getStage(player) < STAGE_ENTERED) quest.setStage(player, STAGE_ENTERED);
        return;
      }
      if (objectId === CAVE_ENTRANCE_OBJECT_ID) {
        event.handled = true;
        playVariant(player, "nickolaus-s-camp-using-the-metal-feather-on-the-cave-entrance");
        return;
      }
      if (isStoneDoor(objectId, event.location)) {
        event.handled = true;
        playVariant(player, "bringing-over-the-outfit-to-nickolaus-interacting-with-the-stone-door-using-the-metal-feather-on-the-door");
        return;
      }
      return;
    }
    if (itemId === EAGLE_FEATHER_ITEM_ID && isStoneDoor(objectId, event.location)) {
      event.handled = true;
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-interacting-with-the-stone-door-using-an-eagle-feather-on-the-door");
      return;
    }
    if (DOOR_FEATHER_BIT_BY_ITEM.has(itemId) && isStoneDoor(objectId, event.location)) {
      event.handled = true;
      insertDoorFeather(player, itemId);
      return;
    }
    if (itemId === ODD_BIRD_SEED_ITEM_ID && FEEDER_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      feedFeeder(player, objectId);
    }
  }

  // ==========================================================================
  // Camp-site interactions
  // ==========================================================================

  function inspectBooks(player) {
    if (quest.getStage(player) === 0) {
      playVariant(player, "nickolaus-s-camp-interacting-with-the-books-again");
      return;
    }
    if (held(player, BIRD_BOOK_ITEM_ID) || held(player, METAL_FEATHER_ITEM_ID)) {
      playVariant(player, "nickolaus-s-camp-interacting-with-the-books-again");
      return;
    }
    if (hasBit(player, BIT_BOOK_READ) && !quest.isComplete(player)) {
      playVariant(player, "nickolaus-s-camp-reclaiming-a-lost-feather");
      grantItem(player, METAL_FEATHER_ITEM_ID);
      return;
    }
    playVariant(player, "nickolaus-s-camp-picking-up-the-bird-book");
    setBit(player, BIT_BOOK_TAKEN);
    grantItem(player, BIRD_BOOK_ITEM_ID);
  }

  function enterDungeon(player) {
    if (quest.getStage(player) < STAGE_STARTED) return;
    player.moveTo(new Location(DUNGEON_LANDING_TILE.x, DUNGEON_LANDING_TILE.y, DUNGEON_LANDING_TILE.z));
    if (inDungeon(player)) ensureDungeonSpawns(player);
  }

  // ==========================================================================
  // Feather puzzles
  // ==========================================================================

  function takeGiantFeather(player) {
    if (!grantItem(player, EAGLE_FEATHER_ITEM_ID)) return;
    const stage = quest.getStage(player);
    if (stage === STAGE_ENTERED) {
      startTranscript(api, player, NICKOLAUS_CHASM_NPC_ID, PAGE, "nickolaus-s-camp-approaching-nickolaus-across-the-chasm");
      return;
    }
    if (stage === STAGE_DISGUISE && !hasBit(player, BIT_OUTFIT_SHOUTED)) {
      setBit(player, BIT_OUTFIT_SHOUTED);
      const variant = wearingEagleDisguise(player)
        ? "bringing-over-the-outfit-to-nickolaus-talking-to-nickolaus-while-wearing-the-eagle-outfit"
        : "bringing-over-the-outfit-to-nickolaus-talking-to-nickolaus-while-not-wearing-the-eagle-outfit";
      startTranscript(api, player, NICKOLAUS_CHASM_NPC_ID, PAGE, variant);
    }
  }

  function allWinchesWound(player) {
    return hasAllBits(player, WINCH_ALL_BITS);
  }

  function operateWinch(player, objectId) {
    const bit = WINCH_BIT_BY_OBJECT.get(objectId);
    if (!bit) return;
    if (!hasBit(player, BIT_TRAP_SPRUNG) || hasBit(player, bit)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-bronze-feather-winding-a-winch-again");
      return;
    }
    setBit(player, bit);
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-bronze-feather-winding-a-winch");
  }

  function takeBronzeFeather(player) {
    if (held(player, BRONZE_FEATHER_ITEM_ID)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-bronze-feather-attempting-to-take-a-second-bronze-feather");
      return;
    }
    if (!hasBit(player, BIT_TRAP_SPRUNG)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-bronze-feather-when-interacting-with-the-pedestal");
      setBit(player, BIT_TRAP_SPRUNG);
      return;
    }
    if (!allWinchesWound(player)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-bronze-feather-when-interacting-with-the-pedestal");
      return;
    }
    grantItem(player, BRONZE_FEATHER_ITEM_ID);
  }

  function inspectSilverPedestal(player) {
    if (!hasBit(player, BIT_SILVER_PEDESTAL)) {
      setBit(player, BIT_SILVER_PEDESTAL);
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-when-inspecting-the-stone-pedestal");
      return;
    }
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-inspecting-the-stone-pedestal-again");
  }

  function inspectTrailRock(player, which) {
    if (which === "first") {
      if (hasBit(player, BIT_TRAIL_1)) {
        playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-inspecting-a-correct-rock-again");
        return;
      }
      setBit(player, BIT_TRAIL_1);
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-when-inspecting-the-first-rock");
      return;
    }
    if (!hasBit(player, BIT_TRAIL_1)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-inspecting-an-incorrect-rock");
      return;
    }
    if (hasBit(player, BIT_TRAIL_2)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-inspecting-a-correct-rock-again");
      return;
    }
    setBit(player, BIT_TRAIL_2);
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-when-inspecting-the-second-rock");
  }

  function inspectKebbitOpening(player) {
    if (held(player, SILVER_FEATHER_ITEM_ID)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-inspecting-the-tunnel-after-getting-the-silver-feather");
      return;
    }
    if (!hasBit(player, BIT_TRAIL_2) || hasBit(player, BIT_KEBBIT_OUT)) return;
    if (hasBit(player, BIT_KEBBIT_DEALT)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-reclaiming-the-silver-feather-if-it-has-been-lost");
      grantItem(player, SILVER_FEATHER_ITEM_ID);
      return;
    }
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-when-inspecting-the-opening");
  }

  function goldFedMask(player) {
    return Number(player.getAttribute(GOLD_FED_ATTRIBUTE)) || 0;
  }

  function goldLeversMask(player) {
    return Number(player.getAttribute(GOLD_LEVERS_ATTRIBUTE)) || 0;
  }

  function hasGoldPuzzleState(player) {
    return goldFedMask(player) !== 0 || goldLeversMask(player) !== 0;
  }

  function goldPuzzleSolved(player) {
    const fed = goldFedMask(player);
    const fedCount = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((index) => (fed & (1 << index)) !== 0).length;
    return fedCount >= GOLD_FEEDERS_NEEDED && (goldLeversMask(player) & GOLD_ALL_LEVERS) === GOLD_ALL_LEVERS;
  }

  function takeBirdSeed(player) {
    if (!grantItem(player, ODD_BIRD_SEED_ITEM_ID)) return;
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-gold-feather-taking-from-the-birdseed-holder");
  }

  function feedFeeder(player, objectId) {
    const index = FEEDER_INDEX_BY_OBJECT.get(objectId);
    if (index === undefined) return;
    const mask = goldFedMask(player);
    if ((mask & (1 << index)) !== 0) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-gold-feather-putting-feed-in-a-feeder-that-a-stone-eagle-is-already-at");
      return;
    }
    if (!held(player, ODD_BIRD_SEED_ITEM_ID)) return;
    player.getInventory().deleteNumber(ODD_BIRD_SEED_ITEM_ID, 1);
    player.setAttribute(GOLD_FED_ATTRIBUTE, mask | (1 << index));
  }

  function operateGoldLever(player, objectId) {
    const bit = GOLD_LEVER_BITS.get(objectId);
    if (!bit) return;
    player.setAttribute(GOLD_LEVERS_ATTRIBUTE, goldLeversMask(player) | bit);
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-gold-feather-pulling-an-eagle-lever");
  }

  function takeGoldenFeather(player) {
    if (held(player, GOLDEN_FEATHER_ITEM_ID)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-gold-feather-attempting-to-take-a-second-golden-feather");
      return;
    }
    if (!goldPuzzleSolved(player)) {
      player.sendMessage("The pedestal is still out of reach.");
      return;
    }
    grantItem(player, GOLDEN_FEATHER_ITEM_ID);
  }

  // ==========================================================================
  // Stone door
  // ==========================================================================

  function doorUnlocked(player) {
    return hasAllBits(player, DOOR_ALL_FEATHERS) || quest.isComplete(player);
  }

  function insertDoorFeather(player, itemId) {
    const bit = DOOR_FEATHER_BIT_BY_ITEM.get(itemId);
    if (!bit) return;
    if (hasBit(player, bit)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-interacting-with-the-stone-door-using-a-feather-on-the-door-after-it-is-unlocked");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    setBit(player, bit);
    if (doorUnlocked(player)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-interacting-with-the-stone-door-when-using-the-last-remaining-feather-on-the-door");
      if (quest.getStage(player) >= STAGE_MET_NICKOLAUS) {
        removeOwnedNpc(shoutNickolausByPlayer, player);
        ensureNestNickolaus(player);
      }
      return;
    }
    playVariant(player, "bringing-over-the-outfit-to-nickolaus-interacting-with-the-stone-door-when-using-any-of-the-metal-feathers-on-the-door");
  }

  function isStoneDoor(objectId, location) {
    if (STONE_DOOR_OBJECT_IDS.has(objectId)) return true;
    if (!location) return false;
    return location.x === STONE_DOOR_X && (location.y === 4947 || location.y === 4948) && location.z === 3;
  }

  function openStoneDoor(player) {
    if (!doorUnlocked(player)) {
      playVariant(player, "bringing-over-the-outfit-to-nickolaus-interacting-with-the-stone-door");
      return;
    }
    const current = player.getLocation();
    const destination = new Location(
      current.getX() <= STONE_DOOR_WEST_LANDING ? STONE_DOOR_EAST_LANDING : STONE_DOOR_WEST_LANDING,
      current.getY(),
      current.getZ()
    );
    player.moveTo(destination);
  }

  // ==========================================================================
  // NPC interactions
  // ==========================================================================

  function shoutToNickolaus(event) {
    if (event.npcId !== NICKOLAUS_CHASM_NPC_ID) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage === STAGE_ENTERED) {
      startTranscript(api, player, NICKOLAUS_CHASM_NPC_ID, PAGE, "nickolaus-s-camp-approaching-nickolaus-across-the-chasm");
      return true;
    }
    if (stage === STAGE_MET_NICKOLAUS) {
      startTranscript(api, player, NICKOLAUS_CHASM_NPC_ID, PAGE, "nickolaus-s-camp-visiting-nickolaus-after-agreeing-to-help-him");
      return true;
    }
    if (stage === STAGE_DISGUISE) {
      const variant = wearingEagleDisguise(player)
        ? "bringing-over-the-outfit-to-nickolaus-talking-to-nickolaus-while-wearing-the-eagle-outfit"
        : "bringing-over-the-outfit-to-nickolaus-talking-to-nickolaus-while-not-wearing-the-eagle-outfit";
      startTranscript(api, player, NICKOLAUS_CHASM_NPC_ID, PAGE, variant);
      return true;
    }
    startTranscript(api, player, NICKOLAUS_CHASM_NPC_ID, PAGE, "nickolaus-s-camp-shouting-at-nickolaus");
    return true;
  }

  function walkPastEagle(event) {
    if (event.npcId !== GIANT_EAGLE_NPC_ID) return false;
    event.handled = true;
    const { player } = event;
    if (wearingEagleDisguise(player)) {
      playVariant(player, "saving-nickolaus-passing-the-eagle");
      return true;
    }
    damage(player, EAGLE_DAMAGE);
    return true;
  }

  function threatenKebbit(event) {
    if (event.npcId !== QUEST_KEBBIT_NPC_ID) return false;
    const { player } = event;
    if (kebbitByPlayer.get(player) !== event.npc) return false;
    event.handled = true;
    // 1494 has no transcript index; play the page's variant through its speaker id.
    startTranscript(api, player, PAGE_SPEAKER_NPC_ID, PAGE, "bringing-over-the-outfit-to-nickolaus-silver-feather-threatening-the-kebbit");
    return true;
  }

  function handleNpcDeath(event) {
    if (event.npcId !== QUEST_KEBBIT_NPC_ID) return;
    const { npc, killer } = event;
    const player = killer?.isPlayer?.() && kebbitByPlayer.get(killer) === npc ? killer : npc?.getOwner?.();
    if (!player?.isPlayer?.()) return;
    if (kebbitByPlayer.get(player) !== npc) return;
    kebbitByPlayer.delete(player);
    setBit(player, BIT_KEBBIT_DEALT);
    const location = event.location ?? npc?.getLocation?.();
    if (!location) return;
    itemOnGroundManager.registerLocation(
      player,
      new Item(SILVER_FEATHER_ITEM_ID, 1),
      new Location(location.x, location.y, location.z)
    );
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObjectInteraction(event) {
    const objectId = questObjectId(event);
    const { player } = event;
    if (TUNNEL_LINKS.has(objectId)) {
      event.handled = true;
      playVariant(player, "nickolaus-s-camp-entering-any-tunnel-in-the-cave");
      const destination = TUNNEL_LINKS.get(objectId);
      player.moveTo(new Location(destination.x, destination.y, destination.z));
      return;
    }
    if (isStoneDoor(objectId, event.location)) {
      event.handled = true;
      openStoneDoor(player);
      return;
    }
    if (WINCH_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      operateWinch(player, objectId);
      return;
    }
    if (GOLD_LEVER_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      operateGoldLever(player, objectId);
      return;
    }
    switch (objectId) {
      case CAMPFIRE_OBJECT_ID:
        event.handled = true;
        playVariant(player, "nickolaus-s-camp-interacting-with-the-campfire");
        return;
      case BOOKS_OBJECT_ID:
        event.handled = true;
        inspectBooks(player);
        return;
      case ROCKY_OUTCROP_OBJECT_ID:
        event.handled = true;
        playVariant(player, "nickolaus-s-camp-interacting-with-the-rocky-outcrop");
        return;
      case CAVE_ENTRANCE_OBJECT_ID:
        event.handled = true;
        enterDungeon(player);
        return;
      case DUNGEON_EXIT_OBJECT_ID:
        event.handled = true;
        player.moveTo(new Location(SURFACE_LANDING_TILE.x, SURFACE_LANDING_TILE.y, SURFACE_LANDING_TILE.z));
        return;
      case GIANT_FEATHERS_OBJECT_ID:
        event.handled = true;
        takeGiantFeather(player);
        return;
      case BRONZE_PEDESTAL_OBJECT_ID:
        event.handled = true;
        takeBronzeFeather(player);
        return;
      case GOLD_PEDESTAL_OBJECT_ID:
        event.handled = true;
        takeGoldenFeather(player);
        return;
      case BIRDSEED_HOLDER_OBJECT_ID:
        event.handled = true;
        takeBirdSeed(player);
        return;
      case RESET_LEVER_OBJECT_ID:
        event.handled = true;
        playVariant(player, "bringing-over-the-outfit-to-nickolaus-gold-feather-using-the-reset-lever");
        return;
      case SILVER_PEDESTAL_OBJECT_ID:
        event.handled = true;
        inspectSilverPedestal(player);
        return;
      case SILVER_ROCK_FIRST_OBJECT_ID:
        event.handled = true;
        inspectTrailRock(player, "first");
        return;
      case SILVER_ROCK_SECOND_OBJECT_ID:
        event.handled = true;
        inspectTrailRock(player, "second");
        return;
      case SILVER_ROCK_WRONG_OBJECT_ID:
        event.handled = true;
        playVariant(player, "bringing-over-the-outfit-to-nickolaus-silver-feather-inspecting-an-incorrect-rock");
        return;
      case KEBBIT_OPENING_OBJECT_ID:
        event.handled = true;
        inspectKebbitOpening(player);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Charlie at the Ardougne Zoo asked me to find the missing</str>",
        "<str>hunter Nickolaus near Eagles' Peak.</str>",
        "<str>I found him trapped in a giant eagle's nest and helped him</str>",
        "<str>escape with an eagle disguise from the Varrock fancy dress shop.</str>",
        "<str>Nickolaus taught me to catch a ferret, which I took to Charlie.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HAS_FERRET) {
      return [
        "<str>Nickolaus taught me how to capture a ferret.</str>",
        "",
        "I should take the <col=800000>ferret</col> to <col=800000>Charlie</col> at the",
        "<col=800000>Ardougne Zoo</col>.",
      ];
    }
    if (stage >= STAGE_RESCUED) {
      return [
        "<str>I gave Nickolaus his eagle disguise so he could escape the nest.</str>",
        "",
        "I should meet <col=800000>Nickolaus</col> at the <col=800000>camp-site</col> north",
        "of Eagles' Peak so he can teach me to catch a ferret.",
      ];
    }
    if (stage >= STAGE_DISGUISE) {
      return [
        "<str>Nickolaus is trapped in a giant eagle's nest.</str>",
        "<str>The fancy dress shop owner made me two eagle disguises.</str>",
        "",
        "I should take a disguise to <col=800000>Nickolaus</col> in the cave.",
      ];
    }
    if (stage >= STAGE_MET_NICKOLAUS) {
      return [
        "<str>I found Nickolaus trapped in a giant eagle's nest.</str>",
        "",
        "Nickolaus needs an eagle <col=800000>disguise</col>; the fancy dress",
        "shop owner in <col=800000>Varrock</col> can make one from 10 giant",
        "eagle feathers, swamp tar and yellow dye.",
        "",
        "The three feathers on the <col=800000>stone door</col> are still missing.",
      ];
    }
    if (stage >= STAGE_ENTERED) {
      return [
        "<str>I found Nickolaus' abandoned camp and a metal feather in a book.</str>",
        "<str>The metal feather opened a passage into the mountain.</str>",
        "",
        "I should explore the cave and look for <col=800000>Nickolaus</col>.",
      ];
    }
    if (stage >= STAGE_METAL_FEATHER) {
      return [
        "<str>I found an abandoned camp-site and a metal feather inside a book.</str>",
        "",
        "Maybe the <col=800000>metal feather</col> fits the strange part of the",
        "cliff face found by climbing the rocks north of the camp-site.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Charlie at the <col=800000>Ardougne Zoo</col> asked me to find the",
        "hunter <col=800000>Nickolaus</col>, last seen west of the",
        "<col=800000>Gnome Stronghold</col> at <col=800000>Eagles' Peak</col>.",
        "",
        "I should look for his camp-site on the north side of the mountain.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Charlie</col> at the",
      "<col=800000>East Ardougne Zoo</col>.",
      "",
      "I need level 27 Hunter.",
    ];
  }

  function grantRewards(player) {
    player.getSkillManager().addExperiences(Skill.HUNTER, 2500);
  }

  // ==========================================================================
  // Login / zones
  // ==========================================================================

  function handleLogin({ player }) {
    refreshQuestList(player);
    installCampObjects();
    if (inDungeon(player)) ensureDungeonSpawns(player);
    ensureCampNickolaus(player);
  }

  function handleZoneEnter({ player }) {
    installCampObjects();
    if (inDungeon(player)) ensureDungeonSpawns(player);
    ensureCampNickolaus(player);
  }

  function handlePlayerGone({ player }) {
    if (player) clearOwnedNpcs(player);
  }

  quest = registerQuest(api, {
    key: "eagles_peak",
    name: "Eagles' Peak",
    varpId: VARP_EAGLES_PEAK,
    varbitId: VARBIT_EAGLES_PEAK_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.HUNTER.getIndex(), amount: 2500, label: "Hunter" }],
    otherRewards: [
      "Ability to use box traps",
      "Access to the eagle transport system",
      "A box trap",
    ],
    buildJournal,
    onReward: grantRewards,
  });

  itemOnGroundManager = api.getItemOnGroundManager();
  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(GOLD_FED_ATTRIBUTE);
  api.persistAttribute(GOLD_LEVERS_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemAction(handleItemAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onNpcInteraction("Nickolaus", { "Shout-to": shoutToNickolaus });
  api.onNpcInteraction("Eagle", { "Walk-past": walkPastEagle });
  api.onNpcInteraction("Kebbit", { Threaten: threatenKebbit });
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(CAMP_ZONE, handleZoneEnter);
  api.onZoneEnter(DUNGEON_ZONE, handleZoneEnter);
  api.onServerStartup(installCampObjects);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handlePlayerGone);
  api.onPlayerDeath(handlePlayerGone);
};
