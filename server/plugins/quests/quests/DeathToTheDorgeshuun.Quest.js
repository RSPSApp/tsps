/**
 * Death to the Dorgeshuun (members).
 *
 * The words come from the "Death to the Dorgeshuun" transcript page; this plugin
 * supplies the variant choices for Mistag, Zanik, the Lumbridge tour NPCs, the
 * H.A.M. hideout guards, Johanhus, Sigmund, Jimmy the Chisel, Juna and the mill
 * Dwarf, the prose-condition answers (the tour stops, the Tears of Guthix, the
 * crate), the store-room guard sniping, the hidden trapdoor, the water mill
 * cellar fight, the completion reward and the journal.
 *
 * Stages (varbit 2258 "dttd_main", varp 794 bits 0-10; dumped with
 * `lookup-gameval varbit dttd`): 0 not started, 1 Mistag asked for two sets of
 * H.A.M. robes, 2 Zanik has her disguise and the Lumbridge tour runs, 3 the
 * mark story told (go to the H.A.M. hideout), 4 infiltrating the hideout, 5 the
 * hidden trapdoor found (clear the store room), 6 listened at the door and
 * caught, 7 told by Jimmy the Chisel what happened, 8 carrying Zanik's body to
 * Juna, 9 collecting twenty tears, 10 Zanik revived (go to the water mill), 11
 * in the mill cellar with Sigmund, 12 Sigmund defeated, 13 machine smashed
 * (escape through the tunnel), 14 complete. Jagex's raw stage numbers are not
 * published on the wiki, so the numbering follows the Quick guide's order.
 *
 * Side progress lives in persisted attributes: the tour stops and other flags
 * in "quest.death_to_the_dorgeshuun.bits", the store-room guard count in
 * "quest.death_to_the_dorgeshuun.guards" (0-5).
 *
 * Source: OSRS Wiki "Death to the Dorgeshuun", its Quick guide and Transcript
 * page, plus the cache (object/NPC transforms, varbits, placements) for ids.
 *
 * Gaps / approximations:
 *  - Zanik does not truly follow: the plugin moves her to the player's side at
 *    every scripted interaction, zone entry and login (the static cellar Zanik
 *    4507 is the varp-794 transform that appears at stage 1).
 *  - The optional tour stops (the tutors, Fred, Millie, Father Urhney, the
 *    candle seller, Gee/Donie, the border guard) are not implemented; only the
 *    five stops the transcript gates on (Duke, a common man/woman, Father
 *    Aereck, goblins, the shopkeeper) plus Cook, Hans, Bob, the Guide, Mistag
 *    and Kazgar.
 *  - The Tears of Guthix collection minigame is skipped: Juna's dialogue hands
 *    the sequence straight to the twenty-tears cutscene.
 *  - The water mill tunnel, both quest trapdoors and the working drilling
 *    machine are runtime objects registered by this plugin, because the cache
 *    maps place only the broken machine. Smashing deregisters the working model
 *    and reveals the static broken one.
 *  - The store-room guard sequence is one talk-to snipe per guard instead of
 *    the full patrol/line-of-sight puzzle; the agility crack and lock doors keep
 *    their 23 Agility / Thieving checks.
 *  - No Sigmund prayer switching; the cellar Sigmund is the level-50 cache NPC
 *    (991) and dies to ordinary combat. The three henchmen are optional.
 *  - Followers/pets are always allowed, so the transcript's pet condition
 *    answers false; there is no light-source requirement in the caves, and the
 *    end-of-quest torch is only granted when the player carries no light.
 */
module.exports = function registerDeathToTheDorgeshuunQuest(api) {
  const {
    CountdownTask,
    Equipment,
    GameObject,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Death to the Dorgeshuun";
  const ZANIK_PAGE = "Zanik";

  const VARP_DTTD = 794; // "dttd"
  const VARBIT_DTTD_MAIN = 2258; // dttd_main, bits 0-10
  const VARBIT_DTTD_ZANIK_IN_CELLAR = 2264; // dttd_zanik_in_cellar, varp 794 bit 16

  const STAGE_STARTED = 1;
  const STAGE_TOURING = 2;
  const STAGE_TOUR_DONE = 3;
  const STAGE_INFILTRATING = 4;
  const STAGE_TRAPDOOR = 5;
  const STAGE_CAUGHT = 6;
  const STAGE_JAILED = 7;
  const STAGE_BODY = 8;
  const STAGE_TEARS = 9;
  const STAGE_REVIVED = 10;
  const STAGE_MILL = 11;
  const STAGE_SIGMUND_DEFEATED = 12;
  const STAGE_MACHINE_SMASHED = 13;
  const STAGE_COMPLETE = 14;

  const BITS_ATTRIBUTE = "quest.death_to_the_dorgeshuun.bits";
  const GUARDS_ATTRIBUTE = "quest.death_to_the_dorgeshuun.guards";
  const BIT_DUKE = 1 << 0;
  const BIT_COMMON = 1 << 1;
  const BIT_AERECK = 1 << 2;
  const BIT_GOBLIN = 1 << 3;
  const BIT_SHOP = 1 << 4;
  const BIT_TALKED_GUARD = 1 << 5;
  const BIT_TALKED_JOHANHUS = 1 << 6;
  const BIT_TRAPDOOR = 1 << 7;
  const BIT_LISTENED = 1 << 8;
  const BIT_ESCAPED = 1 << 9;
  const BIT_BODY_TAKEN = 1 << 10;
  const BIT_TEARS_READY = 1 << 11;
  const BIT_CRATE = 1 << 12;
  const BIT_MET_ZANIK = 1 << 13;
  const BIT_HEARD_DEACON = 1 << 14;

  const TOUR_BITS =
    BIT_DUKE | BIT_COMMON | BIT_AERECK | BIT_GOBLIN | BIT_SHOP;

  const HAM_ITEMS = [
    [ItemIdentifiers.HAM_SHIRT, ItemIdentifiers.HAM_SHIRT_2],
    [ItemIdentifiers.HAM_ROBE, ItemIdentifiers.HAM_ROBE_2],
    [ItemIdentifiers.HAM_HOOD, ItemIdentifiers.HAM_HOOD_2],
    [ItemIdentifiers.HAM_CLOAK, ItemIdentifiers.HAM_CLOAK_2],
    [ItemIdentifiers.HAM_LOGO, ItemIdentifiers.HAM_LOGO_2],
    [ItemIdentifiers.HAM_GLOVES, ItemIdentifiers.HAM_GLOVES_2],
    [ItemIdentifiers.HAM_BOOTS, ItemIdentifiers.HAM_BOOTS_2],
  ];
  const HAM_WORN = [
    [Equipment.HEAD_SLOT, ItemIdentifiers.HAM_HOOD, ItemIdentifiers.HAM_HOOD_2],
    [Equipment.BODY_SLOT, ItemIdentifiers.HAM_SHIRT, ItemIdentifiers.HAM_SHIRT_2],
    [Equipment.LEG_SLOT, ItemIdentifiers.HAM_ROBE, ItemIdentifiers.HAM_ROBE_2],
    [Equipment.HANDS_SLOT, ItemIdentifiers.HAM_GLOVES, ItemIdentifiers.HAM_GLOVES_2],
    [Equipment.FEET_SLOT, ItemIdentifiers.HAM_BOOTS, ItemIdentifiers.HAM_BOOTS_2],
    [Equipment.CAPE_SLOT, ItemIdentifiers.HAM_CLOAK, ItemIdentifiers.HAM_CLOAK_2],
    [Equipment.AMULET_SLOT, ItemIdentifiers.HAM_LOGO, ItemIdentifiers.HAM_LOGO_2],
  ];

  const ZANIK_BODY_ITEM_ID = ItemIdentifiers.ZANIK; // 8870
  const CRATE_WITH_ZANIK_ITEM_ID = ItemIdentifiers.CRATE_WITH_ZANIK; // 8871
  const LIT_TORCH_ITEM_ID = ItemIdentifiers.LIT_TORCH; // 594
  const LIGHT_SOURCE_ITEM_IDS = [
    ItemIdentifiers.LIT_TORCH,
    ItemIdentifiers.TORCH,
    ItemIdentifiers.UNLIT_TORCH,
    ItemIdentifiers.UNLIT_TORCH_2,
    ItemIdentifiers.LIT_CANDLE,
    ItemIdentifiers.CANDLE,
    ItemIdentifiers.LIT_BLACK_CANDLE,
    ItemIdentifiers.BLACK_CANDLE,
    ItemIdentifiers.OIL_LAMP,
    ItemIdentifiers.EMPTY_OIL_LAMP,
    ItemIdentifiers.CANDLE_LANTERN,
    ItemIdentifiers.CANDLE_LANTERN_2,
    ItemIdentifiers.OIL_LANTERN,
    ItemIdentifiers.OIL_LANTERN_2,
    ItemIdentifiers.BULLSEYE_LANTERN,
    ItemIdentifiers.SAPPHIRE_LANTERN,
    ItemIdentifiers.EMERALD_LANTERN,
  ];

  const MISTAG_IDS = new Set([
    NpcIdentifiers.MISTAG, // 5328
    NpcIdentifiers.MISTAG_2, // 7297
    NpcIdentifiers.MISTAG_3, // 7298
    NpcIdentifiers.MISTAG_4, // 7299
  ]);
  const KAZGAR_IDS = new Set([NpcIdentifiers.KAZGAR, NpcIdentifiers.KAZGAR_2]);
  const HIDEOUT_GUARD_IDS = new Set([
    NpcIdentifiers.H_A_M_GUARD, // 2536
    NpcIdentifiers.H_A_M_GUARD_2, // 2537
    NpcIdentifiers.H_A_M_GUARD_3, // 2538
  ]);
  const STORE_GUARD_IDS = new Set([
    NpcIdentifiers.GUARD_71, // 4522
    NpcIdentifiers.GUARD_72, // 4523
    NpcIdentifiers.GUARD_73, // 4524
    NpcIdentifiers.GUARD_74, // 4525
    NpcIdentifiers.GUARD_75, // 4526
  ]);
  const SIGMUND_HIDEOUT_IDS = new Set([
    NpcIdentifiers.SIGMUND_13, // 5322
    NpcIdentifiers.SIGMUND_14, // 5323
  ]);
  const SIGMUND_FIGHT_IDS = new Set([
    NpcIdentifiers.SIGMUND_2, // 991
    NpcIdentifiers.SIGMUND_3, // 992
    NpcIdentifiers.SIGMUND_4, // 993
    NpcIdentifiers.SIGMUND_5, // 994
  ]);
  const JOHANHUS_IDS = new Set([
    NpcIdentifiers.JOHANHUS_ULSBRECHT, // 2535
    NpcIdentifiers.JOHANHUS_ULSBRECHT_2, // 4330
  ]);

  const START_HOOK = "quest:death-to-the-dorgeshuun:start";
  const TOUR_MARK_CONDITION_ID = "1Ciw7b";
  const ROBES_TAKEN_ACTION_ID = "ottYm8";
  const CRATE_PICKUP_ACTION_ID = "__zVMg";
  const BODY_TAKEN_ACTION_ID = "8TfJKO";
  const BODY_LAID_ACTION_ID = "wton67";
  const TEARS_COLLECTED_ACTION_ID = "4x-Og3";
  const QUEST_COMPLETE_ACTION_ID = "WqL2SU";
  const TORCH_GIVEN_ACTION_ID = "TrYWPj";

  const KEYS = {
    FOLLOWER: "dfr_eE",
    DUKE: "acrUHA",
    COMMON: "of4ilR",
    AERECK: "W1gmIl",
    GOBLIN: "Lvkxg7",
    SHOP: "wLb5wd",
    TOUR_DONE: "1Ciw7b",
    NOT_DONE: "du988I",
    DONE_OUTSIDE: "ZTNSpz",
    TEARS_NOT_DONE: "2qbFvH",
    TEARS_DONE: "_0-r_3",
    TEARS_NOT_DONE_2: "zuY-vV",
    TEARS_DONE_2: "RzA7Mr",
    WEAPON: "tHzN8W",
    HANDS_FREE: "QpmtZU",
    WEAPON_2: "t7lhoo",
    IN_HAM: "IsXND5",
    NO_LIGHT: "tDGde4",
    TIMING_WRONG: "elRzUY",
  };

  const GUARD_SNIPE_VARIANTS = [
    "ham-seek-getting-spotted-by-the-first-guard",
    "ham-seek-dealing-with-the-second-third-guard",
    "ham-seek-three-down-two-more-to-go",
    "ham-seek-luring-the-fourth-guard-towards-you",
    "ham-seek-deciding-the-plan-for-the-final-guard",
  ];

  const HAM_ZONE = { minX: 3100, maxX: 3192, minY: 9595, maxY: 9665 };
  // The H.A.M. base's hidden trapdoor sits at 3166,9622 (cache loc 15766); the
  // stage and the "stand next to the rubble" step are on the same tile.
  const RUBBLE_ZONE = { minX: 3162, maxX: 3170, minY: 9618, maxY: 9626 };
  const STORE_ZONE = { minX: 2555, maxX: 2595, minY: 5175, maxY: 5230 };
  const MILL_ZONE = { minX: 3195, maxX: 3255, minY: 3260, maxY: 3315 };
  const CELLAR_ZONE = { minX: 3202, maxX: 3230, minY: 9610, maxY: 9630 };
  const LUMBRIDGE_ZONE = { minX: 3190, maxX: 3270, minY: 3185, maxY: 3265 };

  const HIDDEN_TRAPDOOR_TILE = { x: 3166, y: 9622 };
  const STORE_ROOM_TILE = { x: 2566, y: 5186 };
  const MILL_TRAPDOOR_TILE = { x: 3230, y: 3286 };
  const MILL_CELLAR_TILE = { x: 3217, y: 9692 };
  const JAIL_TILE = { x: 3184, y: 9612 };
  const SURFACE_TILE = { x: 3160, y: 3246 };
  const CORPSE_TILE = { x: 3161, y: 3246 };
  const MINE_TILE = { x: 3319, y: 9616 };
  const JUNA_LOC_NAME = "<col=ffff00>Juna</col>";

  const EMPTY_CRATE_TILES = new Set(["3227,3279", "3228,3279", "3229,3279"]);

  let quest;
  let machineObject = null;
  let worldObjectsReady = false;
  let corpseSpawned = false;
  const zanikByPlayer = new Map();
  const cellarNpcsByPlayer = new Map();
  const tourGoblinByPlayer = new Map();

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function guardsKilled(player) {
    return Number(player.getAttribute(GUARDS_ATTRIBUTE)) || 0;
  }

  function setGuardsKilled(player, value) {
    player.setAttribute(GUARDS_ATTRIBUTE, value | 0);
  }

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function giveItem(player, itemId, amount = 1) {
    if (freeSlots(player) < 1) {
      player.getInventory().full();
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function pieceAmount(player, pair) {
    const inventory = player.getInventory();
    return inventory.getAmount(pair[0]) + inventory.getAmount(pair[1]);
  }

  function hasTwoRobeSets(player) {
    return HAM_ITEMS.every((pair) => pieceAmount(player, pair) >= 2);
  }

  function takeOneRobeSet(player) {
    const inventory = player.getInventory();
    for (const pair of HAM_ITEMS) {
      if (inventory.getAmount(pair[0]) >= 1) inventory.deleteNumber(pair[0], 1);
      else inventory.deleteNumber(pair[1], 1);
    }
  }

  function equippedId(player, slot) {
    const id = player.getEquipment().get(slot)?.getId?.();
    return id && id > 0 ? id : undefined;
  }

  function wearingHam(player) {
    return HAM_WORN.every(([slot, a, b]) => {
      const id = equippedId(player, slot);
      return id === a || id === b;
    });
  }

  function handsFree(player) {
    return (
      equippedId(player, Equipment.WEAPON_SLOT) === undefined &&
      equippedId(player, Equipment.SHIELD_SLOT) === undefined
    );
  }

  function hasLightSource(player) {
    return LIGHT_SOURCE_ITEM_IDS.some((itemId) => held(player, itemId));
  }

  function inZone(player, zone) {
    const location = player.getLocation();
    return (
      location.getX() >= zone.minX &&
      location.getX() <= zone.maxX &&
      location.getY() >= zone.minY &&
      location.getY() <= zone.maxY
    );
  }

  function hasQuest(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function tearsOfGuthixDone(player) {
    return hasQuest(player, "tears_of_guthix");
  }

  function tourStopsDone(player) {
    return (bits(player) & TOUR_BITS) === TOUR_BITS;
  }

  function advance(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  function playVariant(player, npcId, variant, select) {
    const request = { player, npcId, variant, select, handled: false };
    api.emitCustomEvent("npc-dialogue:start", request);
    if (!request.handled) startTranscript(api, player, npcId, PAGE, variant, select);
  }

  function resolvedObjectId(event) {
    return event.definition?.id ?? event.objectId;
  }

  function tileKey(location) {
    return location ? `${location.x},${location.y}` : "";
  }

  function chatboxOpen(player) {
    const prompt = api.core.MultiChatboxPrompt?.getPending?.(player) ?? null;
    return player.getDialogueManager?.()?.isActive?.() === true || prompt !== null;
  }

  /** Runs `action` once the player's current chatbox closes (a wiki double-feature). */
  function playAfterChat(player, action, attemptsLeft = 24) {
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (chatboxOpen(player) && attemptsLeft > 0) {
          playAfterChat(player, action, attemptsLeft - 1);
          return;
        }
        action();
      })
    );
  }

  // ==========================================================================
  // Zanik (owner-only spawn moved to the player's side) and quest spawns
  // ==========================================================================

  function despawnZanik(player) {
    const npc = zanikByPlayer.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    zanikByPlayer.delete(player);
  }

  function placeZanik(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_TOURING) return;
    const location = player.getLocation();
    const target = new Location(location.getX() + 1, location.getY(), location.getZ());
    const npc = zanikByPlayer.get(player);
    if (npc) {
      npc.moveTo(target);
      return;
    }
    const spawned = api.spawnNpc({
      id: NpcIdentifiers.ZANIK,
      x: target.getX(),
      y: target.getY(),
      z: target.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (spawned) zanikByPlayer.set(player, spawned);
  }

  function despawnTourGoblin(player) {
    const npc = tourGoblinByPlayer.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    tourGoblinByPlayer.delete(player);
  }

  /**
   * The Lumbridge goblins only have an Attack action in the cache and the
   * talkable quest goblin (11338) is unspawned, so stage 2 keeps an owner-only
   * one at the player's side for the tour stop's Talk-to.
   */
  function placeTourGoblin(player) {
    const npc = tourGoblinByPlayer.get(player);
    if (quest.getStage(player) !== STAGE_TOURING || hasBit(player, BIT_GOBLIN)) {
      if (npc) despawnTourGoblin(player);
      return;
    }
    if (!inZone(player, LUMBRIDGE_ZONE)) return;
    const location = player.getLocation();
    const target = new Location(location.getX() + 2, location.getY(), location.getZ());
    if (npc) {
      npc.moveTo(target);
      return;
    }
    const spawned = api.spawnNpc({
      id: NpcIdentifiers.GOBLIN_104,
      x: target.getX(),
      y: target.getY(),
      z: target.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (spawned) tourGoblinByPlayer.set(player, spawned);
  }

  function despawnCellar(player) {
    const npcs = cellarNpcsByPlayer.get(player);
    if (!npcs) return;
    for (const npc of npcs) api.removeNpc(npc);
    cellarNpcsByPlayer.delete(player);
    zanikByPlayer.delete(player);
  }

  function spawnCellar(player) {
    if (cellarNpcsByPlayer.has(player)) return;
    const npcs = [];
    const spawn = (id, x, y) =>
      api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    const zanik = spawn(NpcIdentifiers.ZANIK, 3218, 9702);
    if (zanik) {
      npcs.push(zanik);
      zanikByPlayer.set(player, zanik);
    }
    const sigmund = spawn(NpcIdentifiers.SIGMUND_2, 3219, 9700);
    if (sigmund) npcs.push(sigmund);
    for (const [x, y] of [
      [3215, 9702],
      [3223, 9700],
      [3211, 9702],
    ]) {
      const guard = spawn(NpcIdentifiers.GUARD, x, y);
      if (guard) npcs.push(guard);
    }
    cellarNpcsByPlayer.set(player, npcs);
  }

  function registerObject(objectId, tile, rotation = 0) {
    ObjectManager.register(
      new GameObject(objectId, new Location(tile.x, tile.y, 0), 10, rotation, null),
      true
    );
    return true;
  }

  /** The cache maps place only the broken machine, so the quest objects are runtime. */
  function ensureWorldObjects() {
    if (worldObjectsReady) return;
    worldObjectsReady = true;
    registerObject(ObjectIdentifiers.HIDDEN_TRAPDOOR, HIDDEN_TRAPDOOR_TILE);
    registerObject(ObjectIdentifiers.TRAPDOOR_65, MILL_TRAPDOOR_TILE);
    registerObject(ObjectIdentifiers.TUNNEL_17, { x: 3217, y: 9706 });
    machineObject = new GameObject(
      ObjectIdentifiers.DRILLING_MACHINE,
      new Location(3213, 9695, 0),
      10,
      0,
      null
    );
    ObjectManager.register(machineObject, true);
  }

  function ensureCorpse() {
    if (corpseSpawned) return;
    corpseSpawned = true;
    registerObject(ObjectIdentifiers.ZANIK_2, CORPSE_TILE);
  }

  // ==========================================================================
  // Dialogue: NPC handlers
  // ==========================================================================

  function talkMistag(event) {
    const { player, npcId } = event;
    if (!MISTAG_IDS.has(npcId) && npcId !== NpcIdentifiers.MISTAG) return false;
    const stage = quest.getStage(player);
    if (stage === 0) {
      // Quest Helper lists only The Lost Tribe (plus 23 Agility/Thieving) as
      // requirements; The Giant Dwarf is not needed to start this quest.
      if (!hasQuest(player, "the_lost_tribe")) return false;
    } else if (stage !== STAGE_STARTED) {
      return false;
    }
    playVariant(player, npcId, "out-of-the-dark-talking-to-mistag");
    return true;
  }

  function talkKazgar(event) {
    const { player, npcId } = event;
    if (!KAZGAR_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_TOURING || stage === STAGE_TOUR_DONE) {
      playVariant(player, npcId, "a-tour-of-lumbridge-kazgar");
      return true;
    }
    if (stage >= STAGE_REVIVED && stage < STAGE_COMPLETE) {
      playVariant(player, npcId, "showdown-with-sigmund-talking-to-kazgar");
      return true;
    }
    return false;
  }

  function tourStop(event, variant, bit, repeatVariant) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_TOURING) return false;
    placeZanik(player);
    if (bit) {
      const already = hasBit(player, bit);
      setBit(player, bit);
      playVariant(player, event.npcId, already && repeatVariant ? repeatVariant : variant);
      return true;
    }
    playVariant(player, event.npcId, variant);
    return true;
  }

  function talkDuke(event) {
    return tourStop(
      event,
      "a-tour-of-lumbridge-duke-horacio",
      BIT_DUKE,
      "a-tour-of-lumbridge-duke-horacio-talking-to-duke-huracio-a-second-time"
    );
  }

  function talkCommoner(event) {
    return tourStop(
      event,
      "a-tour-of-lumbridge-talking-to-a-man-or-woman-around-lumbridge",
      BIT_COMMON,
      "a-tour-of-lumbridge-talking-to-a-man-or-woman-around-lumbridge-talking-to-a-man-or-woman-again"
    );
  }

  function talkFatherAereck(event) {
    return tourStop(event, "a-tour-of-lumbridge-father-aereck", BIT_AERECK);
  }

  function talkShopKeeper(event) {
    const { player, npcId } = event;
    if (npcId !== NpcIdentifiers.SHOP_KEEPER) return false;
    return tourStop(event, "a-tour-of-lumbridge-shop-keeper-assistant", BIT_SHOP);
  }

  function talkGoblin(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_TOURING || hasBit(player, BIT_GOBLIN)) return false;
    placeZanik(player);
    setBit(player, BIT_GOBLIN);
    despawnTourGoblin(player);
    playVariant(player, event.npcId, "a-tour-of-lumbridge-walking-near-the-goblins-in-the-forest");
    return true;
  }

  function talkCook(event) {
    const { player, npcId } = event;
    if (npcId !== NpcIdentifiers.COOK_7) return false;
    return tourStop(event, "a-tour-of-lumbridge-cook", 0);
  }

  function talkHans(event) {
    return tourStop(event, "a-tour-of-lumbridge-hans", 0);
  }

  function talkBob(event) {
    const { player, npcId } = event;
    if (npcId !== NpcIdentifiers.BOB_15) return false;
    return tourStop(event, "a-tour-of-lumbridge-bob", 0);
  }

  function talkLumbridgeGuide(event) {
    return tourStop(event, "a-tour-of-lumbridge-lumbridge-guide", 0);
  }

  function talkZanik(event) {
    const { player, npcId } = event;
    // 2318 is this quest's spawned Zanik; 4506 is its static Lumbridge-cellar
    // Zanik (the 4507 map spawn) but also Land of the Goblins' fairy-ring Zanik,
    // so only claim 4506 in the cellar and let other quests' Zaniks through.
    if (
      npcId !== NpcIdentifiers.ZANIK &&
      (npcId !== NpcIdentifiers.ZANIK_6 || !inZone(player, CELLAR_ZONE))
    ) {
      return false;
    }
    const stage = quest.getStage(player);
    if (stage <= 0) return false;
    if (stage === STAGE_STARTED) {
      if (!hasBit(player, BIT_MET_ZANIK)) {
        setBit(player, BIT_MET_ZANIK);
        playVariant(player, npcId, "out-of-the-dark-talking-to-zanik");
      } else {
        playVariant(
          player,
          npcId,
          hasTwoRobeSets(player)
            ? "out-of-the-dark-talking-to-zanik-with-two-sets-of-ham-robes"
            : "out-of-the-dark-talking-to-zanik-without-two-sets-of-ham-robes"
        );
      }
      return true;
    }
    if (stage === STAGE_TOURING) {
      placeZanik(player);
      playVariant(player, npcId, "a-tour-of-lumbridge-talking-to-zanik");
      return true;
    }
    if (stage === STAGE_TOUR_DONE) {
      placeZanik(player);
      if (!wearingHam(player)) {
        playVariant(player, npcId, "ham-infiltrators-talking-to-zanik-without-the-ham-disguise");
      } else if (inZone(player, CELLAR_ZONE)) {
        playVariant(
          player,
          npcId,
          "ham-infiltrators-talking-to-zanik-while-in-disguise-talking-to-zanik-in-the-lumbridge-cellar"
        );
      } else {
        playVariant(player, npcId, "ham-infiltrators-talking-to-zanik-while-in-disguise");
      }
      return true;
    }
    if (stage === STAGE_INFILTRATING) {
      placeZanik(player);
      if (!wearingHam(player)) {
        playVariant(player, npcId, "ham-infiltrators-talking-to-zanik-without-the-ham-disguise");
      } else if (!hasBit(player, BIT_TALKED_GUARD) || !hasBit(player, BIT_TALKED_JOHANHUS)) {
        playVariant(player, npcId, "ham-infiltrators-talking-to-zanik-without-talking-to-all-the-hams");
      } else {
        playVariant(player, npcId, "ham-infiltrators-after-talking-to-hams");
      }
      return true;
    }
    if (stage === STAGE_TRAPDOOR) {
      placeZanik(player);
      playVariant(
        player,
        npcId,
        guardsKilled(player) >= 5
          ? "ham-seek-before-listening-at-the-door"
          : "ham-seek-talking-to-zanik-inside-the-trapdoor"
      );
      return true;
    }
    if (stage >= STAGE_JAILED && stage <= STAGE_TEARS) return false;
    if (stage === STAGE_CAUGHT) {
      playVariant(player, npcId, "ham-seek-talking-to-zanik-inside-the-trapdoor");
      return true;
    }
    if (stage === STAGE_REVIVED) {
      playVariant(player, npcId, "showdown-with-sigmund-talking-to-zanik");
      return true;
    }
    if (stage === STAGE_MILL) {
      playVariant(
        player,
        npcId,
        inZone(player, { minX: 3200, maxX: 3250, minY: 9678, maxY: 9715 })
          ? "showdown-with-sigmund-talking-to-zanik-during-the-fight"
          : "showdown-with-sigmund-talking-to-zanik-at-the-mill"
      );
      return true;
    }
    if (stage === STAGE_SIGMUND_DEFEATED) {
      playVariant(player, npcId, "showdown-with-sigmund-talking-to-zanik-before-destroying-the-machine");
      return true;
    }
    if (stage === STAGE_MACHINE_SMASHED) {
      playVariant(player, npcId, "showdown-with-sigmund-talking-to-zanik-after-destroying-the-machine");
      return true;
    }
    startTranscript(api, player, npcId, ZANIK_PAGE, "standard-dialogue");
    return true;
  }

  function talkHamGuard(event) {
    const { player, npcId } = event;
    if (!HIDEOUT_GUARD_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_INFILTRATING && !hasBit(player, BIT_TALKED_GUARD)) {
      placeZanik(player);
      setBit(player, BIT_TALKED_GUARD);
      playVariant(player, npcId, "ham-infiltrators-talking-to-ham-guard-near-the-door");
      return true;
    }
    if (stage === STAGE_JAILED) {
      playVariant(player, npcId, "the-power-of-the-tears-talking-to-a-ham-guard");
      return true;
    }
    return false;
  }

  function talkStoreGuard(event) {
    const { player, npcId, npc } = event;
    if (!STORE_GUARD_IDS.has(npcId) || quest.getStage(player) !== STAGE_TRAPDOOR) return false;
    placeZanik(player);
    const killed = guardsKilled(player);
    playVariant(
      player,
      npcId,
      GUARD_SNIPE_VARIANTS[Math.min(killed, GUARD_SNIPE_VARIANTS.length - 1)]
    );
    if (npc) api.removeNpc(npc);
    setGuardsKilled(player, killed + 1);
    player.sendMessage("Zanik shoots the guard from behind.");
    if (killed + 1 >= 5) {
      player.sendMessage("That's the last of them! Now to listen to what's happening in the meeting room.");
    }
    return true;
  }

  function talkJohanhus(event) {
    const { player, npcId } = event;
    if (!JOHANHUS_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_INFILTRATING) {
      placeZanik(player);
      setBit(player, BIT_TALKED_JOHANHUS);
      playVariant(player, npcId, "ham-infiltrators-talking-to-johanhus-ulsbrecht");
      return true;
    }
    if (stage >= STAGE_BODY && stage < STAGE_REVIVED) {
      playVariant(player, npcId, "the-power-of-the-tears-talking-to-johanhus-ulsbrecht");
      return true;
    }
    return false;
  }

  function talkSigmund(event) {
    const { player, npcId } = event;
    if (!SIGMUND_HIDEOUT_IDS.has(npcId) || quest.getStage(player) !== STAGE_INFILTRATING) return false;
    placeZanik(player);
    playVariant(player, npcId, "ham-infiltrators-talking-to-sigmund");
    return true;
  }

  function talkMillDwarf(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_REVIVED || stage >= STAGE_COMPLETE || !inZone(player, MILL_ZONE)) return false;
    playVariant(
      player,
      event.npcId,
      wearingHam(player)
        ? "showdown-with-sigmund-talking-to-dwarf-while-in-disguise"
        : "showdown-with-sigmund-talking-to-the-dwarf-at-the-mill-without-a-disguise"
    );
    return true;
  }

  function talkJimmy(event) {
    const { player, npcId } = event;
    if (npcId !== NpcIdentifiers.JIMMY_THE_CHISEL || quest.getStage(player) !== STAGE_JAILED) {
      return false;
    }
    playVariant(player, npcId, "the-power-of-the-tears-talking-to-jimmy-the-chisel");
    playAfterChat(player, () => {
      if (hasBit(player, BIT_ESCAPED)) return;
      setBit(player, BIT_ESCAPED);
      ensureCorpse();
      player.moveTo(new Location(SURFACE_TILE.x, SURFACE_TILE.y, 0));
      player.sendMessage("You pick the lock and slip out of the hideout.");
    });
    return true;
  }

  function talkJuna(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage === STAGE_BODY && held(player, ZANIK_BODY_ITEM_ID)) {
      playVariant(player, NpcIdentifiers.JUNA, "the-power-of-the-tears-talking-to-juna-about-zanik-s-fate");
      return true;
    }
    if (stage === STAGE_TEARS) {
      if (hasBit(player, BIT_TEARS_READY)) {
        playVariant(player, NpcIdentifiers.JUNA, "the-power-of-the-tears-upon-collecting-twenty-tears");
      } else {
        setBit(player, BIT_TEARS_READY);
        playVariant(player, NpcIdentifiers.JUNA, "the-power-of-the-tears-talking-to-juna-before-collecting-the-tears");
      }
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Dialogue conditions, hooks and actions
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId, pages } = event;
    if (Array.isArray(pages) && !pages.some((entry) => entry?.page === PAGE)) return null;
    const stage = quest.getStage(player);
    switch (stepId) {
      case KEYS.FOLLOWER:
        return false;
      case KEYS.DUKE:
        return stage === STAGE_TOURING && !hasBit(player, BIT_DUKE);
      case KEYS.COMMON:
        return stage === STAGE_TOURING && !hasBit(player, BIT_COMMON);
      case KEYS.AERECK:
        return stage === STAGE_TOURING && !hasBit(player, BIT_AERECK);
      case KEYS.GOBLIN:
        return stage === STAGE_TOURING && !hasBit(player, BIT_GOBLIN);
      case KEYS.SHOP:
        return stage === STAGE_TOURING && !hasBit(player, BIT_SHOP);
      case KEYS.TOUR_DONE:
        return stage === STAGE_TOURING && tourStopsDone(player);
      case KEYS.NOT_DONE:
        return !tourStopsDone(player);
      case KEYS.DONE_OUTSIDE:
        return tourStopsDone(player) && !inZone(player, LUMBRIDGE_ZONE);
      case KEYS.TEARS_NOT_DONE:
      case KEYS.TEARS_NOT_DONE_2:
        return !tearsOfGuthixDone(player);
      case KEYS.TEARS_DONE:
      case KEYS.TEARS_DONE_2:
        return tearsOfGuthixDone(player);
      case KEYS.WEAPON:
      case KEYS.WEAPON_2:
        return !handsFree(player);
      case KEYS.HANDS_FREE:
        return handsFree(player);
      case KEYS.IN_HAM:
        return wearingHam(player);
      case KEYS.NO_LIGHT:
        return !hasLightSource(player);
      case KEYS.TIMING_WRONG:
        return false;
      default:
        return null;
    }
  }

  function handleDialogueHook(event) {
    const { player, hook } = event;
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
    syncCellarVarbit(player);
  }

  function handleDialogueCondition(event) {
    const { player, stepId } = event;
    if (stepId !== TOUR_MARK_CONDITION_ID) return;
    if (quest.getStage(player) === STAGE_TOURING) quest.setStage(player, STAGE_TOUR_DONE);
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === ROBES_TAKEN_ACTION_ID) {
      if (quest.getStage(player) < STAGE_TOURING && hasTwoRobeSets(player)) {
        takeOneRobeSet(player);
        advance(player, STAGE_TOURING);
        placeZanik(player);
      }
      return;
    }
    if (stepId === CRATE_PICKUP_ACTION_ID) {
      event.handled = true;
      if (hasBit(player, BIT_CRATE)) return;
      if (!wearingHam(player) || !handsFree(player)) {
        player.sendMessage("You need to wear your H.A.M. disguise with both hands free to carry the crate.");
        return;
      }
      if (!giveItem(player, CRATE_WITH_ZANIK_ITEM_ID)) return;
      setBit(player, BIT_CRATE);
      despawnZanik(player);
      return;
    }
    if (stepId === BODY_TAKEN_ACTION_ID) {
      if (!hasBit(player, BIT_BODY_TAKEN) && giveItem(player, ZANIK_BODY_ITEM_ID)) {
        setBit(player, BIT_BODY_TAKEN);
        advance(player, STAGE_BODY);
      }
      return;
    }
    if (stepId === BODY_LAID_ACTION_ID) {
      if (held(player, ZANIK_BODY_ITEM_ID)) {
        player.getInventory().deleteNumber(ZANIK_BODY_ITEM_ID, 1);
      }
      advance(player, STAGE_TEARS);
      return;
    }
    if (stepId === TEARS_COLLECTED_ACTION_ID) {
      advance(player, STAGE_REVIVED);
      placeZanik(player);
      return;
    }
    if (stepId === TORCH_GIVEN_ACTION_ID) {
      if (!hasLightSource(player)) giveItem(player, LIT_TORCH_ITEM_ID);
      return;
    }
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      event.handled = true;
      if (quest.getStage(player) >= STAGE_MACHINE_SMASHED && !quest.isComplete(player)) {
        quest.complete(player);
      }
    }
  }

  // ==========================================================================
  // Objects, doors and ground
  // ==========================================================================

  function useHiddenTrapdoor(player) {
    if (quest.getStage(player) !== STAGE_TRAPDOOR || !hasBit(player, BIT_TRAPDOOR)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 23) {
      playVariant(player, NpcIdentifiers.ZANIK, "ham-infiltrators-trying-to-pick-the-lock-without-23-thieving");
      return;
    }
    player.moveTo(new Location(STORE_ROOM_TILE.x, STORE_ROOM_TILE.y, 0));
    placeZanik(player);
    player.sendMessage("You pick the lock and climb down.");
  }

  function useMillTrapdoor(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_REVIVED || stage >= STAGE_COMPLETE) {
      player.sendMessage("The trapdoor is locked.");
      return;
    }
    if (hasBit(player, BIT_CRATE) && held(player, CRATE_WITH_ZANIK_ITEM_ID)) {
      enterCellar(player);
      return;
    }
    if (stage >= STAGE_MILL) {
      player.moveTo(new Location(MILL_CELLAR_TILE.x, MILL_CELLAR_TILE.y, 0));
      spawnCellar(player);
      return;
    }
    if (!wearingHam(player)) {
      playVariant(player, NpcIdentifiers.DWARF_16, "showdown-with-sigmund-trying-to-enter-the-trapdoor-without-a-disguise");
      return;
    }
    if (hasBit(player, BIT_CRATE) || zanikByPlayer.has(player) || inZone(player, CELLAR_ZONE)) {
      playVariant(player, NpcIdentifiers.DWARF_16, "showdown-with-sigmund-trying-to-enter-the-trapdoor-while-zanik-is-following-you");
      return;
    }
    playVariant(
      player,
      NpcIdentifiers.DWARF_16,
      "showdown-with-sigmund-trying-to-enter-the-trapdoor-while-disguised-without-zanik"
    );
  }

  function enterCellar(player) {
    if (held(player, CRATE_WITH_ZANIK_ITEM_ID)) {
      player.getInventory().deleteNumber(CRATE_WITH_ZANIK_ITEM_ID, 1);
    }
    player.setAttribute(BITS_ATTRIBUTE, bits(player) & ~BIT_CRATE);
    player.moveTo(new Location(MILL_CELLAR_TILE.x, MILL_CELLAR_TILE.y, 0));
    despawnZanik(player);
    spawnCellar(player);
    advance(player, STAGE_MILL);
    player.sendMessage("You set the crate down and Zanik climbs out.");
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        playVariant(player, NpcIdentifiers.SIGMUND_2, "showdown-with-sigmund-confronting-sigmund");
      })
    );
  }

  function searchCrate(event) {
    const { player, location } = event;
    if (quest.getStage(player) !== STAGE_REVIVED || !inZone(player, MILL_ZONE)) return;
    event.handled = true;
    if (hasBit(player, BIT_CRATE)) {
      player.sendMessage("You are already carrying Zanik in a crate.");
      return;
    }
    if (!wearingHam(player)) {
      player.sendMessage("You should put on your H.A.M. disguise first.");
      return;
    }
    const empty = EMPTY_CRATE_TILES.has(tileKey(location));
    const zanikHere = zanikByPlayer.has(player);
    if (empty && zanikHere) {
      playVariant(player, NpcIdentifiers.ZANIK, "showdown-with-sigmund-searching-an-empty-crate");
      return;
    }
    if (empty) {
      playVariant(player, NpcIdentifiers.ZANIK, "showdown-with-sigmund-searching-an-empty-crate-without-zanik-with-you");
      return;
    }
    playVariant(
      player,
      NpcIdentifiers.ZANIK,
      zanikHere
        ? "showdown-with-sigmund-searching-the-crates-with-parts"
        : "showdown-with-sigmund-searching-the-crates-with-parts-without-zanik-with-you"
    );
  }

  function smashMachine(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_MILL) {
      playVariant(player, NpcIdentifiers.ZANIK, "showdown-with-sigmund-trying-to-smash-the-machine-while-sigmund-is-undefeated");
      return;
    }
    if (stage !== STAGE_SIGMUND_DEFEATED) return;
    if (machineObject) {
      ObjectManager.deregister(machineObject, true);
      machineObject = null;
    }
    advance(player, STAGE_MACHINE_SMASHED);
    playVariant(player, NpcIdentifiers.ZANIK, "showdown-with-sigmund-smashing-the-machine");
  }

  function enterTunnel(player) {
    if (quest.getStage(player) < STAGE_MACHINE_SMASHED) {
      playVariant(player, NpcIdentifiers.ZANIK, "showdown-with-sigmund-trying-to-unlock-the-tunnel-before-destroying-the-machine");
      return;
    }
    player.moveTo(new Location(MINE_TILE.x, MINE_TILE.y, 0));
    placeZanik(player);
    playVariant(player, NpcIdentifiers.ZANIK, "showdown-with-sigmund-leaving-through-the-tunnel");
  }

  function inspectCorpse(player) {
    if (quest.getStage(player) !== STAGE_JAILED || hasBit(player, BIT_BODY_TAKEN)) {
      player.sendMessage("Zanik's body lies here.");
      return;
    }
    playVariant(player, NpcIdentifiers.ZANIK, "the-power-of-the-tears-inspecting-zanik");
  }

  function stepThrough(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
        : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function squeezeCrack(event) {
    const { player, location } = event;
    if (quest.getStage(player) !== STAGE_TRAPDOOR) return;
    if (player.getSkillManager().getCurrentLevel(Skill.AGILITY) < 23) {
      playVariant(player, NpcIdentifiers.ZANIK, "ham-seek-trying-to-squeeze-through-a-crack-without-23-agility");
      return;
    }
    stepThrough(player, location);
  }

  function handleObjectInteraction(event) {
    const objectId = resolvedObjectId(event);
    // The quest doors only offer "Listen-at" (15757/15758); they never emit
    // door:toggle, so claim them from the object hook as well.
    if (
      objectId === ObjectIdentifiers.LARGE_DOOR_51 ||
      objectId === ObjectIdentifiers.LARGE_DOOR_52
    ) {
      claimLargeDoor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.HIDDEN_TRAPDOOR) {
      event.handled = true;
      useHiddenTrapdoor(event.player);
      return;
    }
    if (objectId === ObjectIdentifiers.TRAPDOOR_65) {
      event.handled = true;
      useMillTrapdoor(event.player);
      return;
    }
    if (objectId === ObjectIdentifiers.CRATE_125) {
      searchCrate(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DRILLING_MACHINE) {
      event.handled = true;
      smashMachine(event.player);
      return;
    }
    if (objectId === ObjectIdentifiers.TUNNEL_17) {
      event.handled = true;
      enterTunnel(event.player);
      return;
    }
    if (objectId === ObjectIdentifiers.ZANIK_2) {
      event.handled = true;
      inspectCorpse(event.player);
      return;
    }
    if (objectId === ObjectIdentifiers.CRACK_8) {
      if (quest.getStage(event.player) !== STAGE_TRAPDOOR) return;
      event.handled = true;
      squeezeCrack(event);
    }
  }

  function claimLargeDoor(request) {
    if (!request || request.handled) return;
    const objectId = request.objectId;
    if (
      objectId !== ObjectIdentifiers.LARGE_DOOR_47 &&
      objectId !== ObjectIdentifiers.LARGE_DOOR_49 &&
      objectId !== ObjectIdentifiers.LARGE_DOOR_51 &&
      objectId !== ObjectIdentifiers.LARGE_DOOR_52
    ) {
      return;
    }
    const { player } = request;
    if (
      quest.getStage(player) !== STAGE_TRAPDOOR ||
      guardsKilled(player) < 5 ||
      hasBit(player, BIT_LISTENED)
    ) {
      return;
    }
    request.handled = true;
    setBit(player, BIT_LISTENED);
    advance(player, STAGE_CAUGHT);
    playVariant(player, NpcIdentifiers.ZANIK, "ham-seek-listening-at-the-door");
    playAfterChat(player, () => {
      if (quest.getStage(player) !== STAGE_CAUGHT) return;
      player.moveTo(new Location(JAIL_TILE.x, JAIL_TILE.y, 0));
      advance(player, STAGE_JAILED);
      playVariant(player, NpcIdentifiers.ZANIK, "ham-seek-getting-caught-by-the-guards");
      playAfterChat(player, () => despawnZanik(player));
    });
  }

  function handleNpcDeath(event) {
    const player = event.killer ?? event.damagers?.[0];
    if (!player) return;
    if (STORE_GUARD_IDS.has(event.npcId) && quest.getStage(player) === STAGE_TRAPDOOR) {
      const killed = guardsKilled(player) + 1;
      setGuardsKilled(player, killed);
      if (killed >= 5) {
        player.sendMessage("That's the last of them! Now to listen to what's happening in the meeting room.");
      }
      return;
    }
    if (SIGMUND_FIGHT_IDS.has(event.npcId) && quest.getStage(player) === STAGE_MILL) {
      advance(player, STAGE_SIGMUND_DEFEATED);
      playVariant(player, NpcIdentifiers.SIGMUND_2, "showdown-with-sigmund-defeating-sigmund");
    }
  }

  function handleItemAction(event) {
    if (event.itemId !== ZANIK_BODY_ITEM_ID || !/drop/i.test(event.option ?? "")) return;
    event.handled = true;
    playVariant(event.player, NpcIdentifiers.ZANIK, "the-power-of-the-tears-attempting-to-drop-zanik-s-body");
  }

  // ==========================================================================
  // Zones and session lifecycle
  // ==========================================================================

  function handleHamZoneEnter({ player }) {
    if (quest.getStage(player) === STAGE_TOUR_DONE) advance(player, STAGE_INFILTRATING);
  }

  function handleRubbleZoneEnter({ player }) {
    if (quest.getStage(player) !== STAGE_INFILTRATING) return;
    if (!hasBit(player, BIT_TALKED_GUARD) || !hasBit(player, BIT_TALKED_JOHANHUS)) return;
    if (hasBit(player, BIT_TRAPDOOR)) return;
    placeZanik(player);
    if (!hasBit(player, BIT_HEARD_DEACON)) {
      // Quest Helper stops at the stage to hear the H.A.M. deacon first.
      setBit(player, BIT_HEARD_DEACON);
      playVariant(player, NpcIdentifiers.ZANIK, "ham-infiltrators-walking-near-the-ham-deacon");
      playAfterChat(player, () => {
        if (quest.getStage(player) !== STAGE_INFILTRATING || hasBit(player, BIT_TRAPDOOR)) return;
        setBit(player, BIT_TRAPDOOR);
        advance(player, STAGE_TRAPDOOR);
        playVariant(player, NpcIdentifiers.ZANIK, "ham-infiltrators-walking-near-the-rubble");
      });
      return;
    }
    setBit(player, BIT_TRAPDOOR);
    advance(player, STAGE_TRAPDOOR);
    playVariant(player, NpcIdentifiers.ZANIK, "ham-infiltrators-walking-near-the-rubble");
  }

  function handleStoreZoneEnter({ player }) {
    if (quest.getStage(player) === STAGE_TRAPDOOR) placeZanik(player);
  }

  function handleMillZoneEnter({ player }) {
    if (quest.getStage(player) >= STAGE_REVIVED) placeZanik(player);
  }

  function handleLumbridgeZoneEnter({ player }) {
    placeTourGoblin(player);
  }

  /** Cache NPC 4507 (the cellar Zanik parent) only resolves once this bit is set. */
  function syncCellarVarbit(player) {
    player
      .getPacketSender()
      .sendVarbit(VARBIT_DTTD_ZANIK_IN_CELLAR, quest.getStage(player) >= STAGE_STARTED ? 1 : 0);
  }

  function handleBootstrap({ player }) {
    syncCellarVarbit(player);
  }

  function handleQuestStageChanged({ player, key }) {
    if (key !== quest.key) return;
    syncCellarVarbit(player);
    placeTourGoblin(player);
  }

  function handleLogin({ player }) {
    ensureWorldObjects();
    const stage = quest.getStage(player);
    syncCellarVarbit(player);
    if (stage >= STAGE_TOURING && !(stage >= STAGE_JAILED && stage <= STAGE_TEARS)) {
      placeZanik(player);
    }
    placeTourGoblin(player);
    if (stage === STAGE_MILL && inZone(player, { minX: 3200, maxX: 3250, minY: 9678, maxY: 9715 })) {
      spawnCellar(player);
    }
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    despawnCellar(player);
    despawnZanik(player);
    despawnTourGoblin(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Zanik, the first Dorgeshuun on the surface, tour</str>",
        "<str>Lumbridge and infiltrate the H.A.M. hideout.</str>",
        "<str>Sigmund killed Zanik; Juna revived her with the Tears of</str>",
        "<str>Guthix, and together we smashed the drilling machine.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_MACHINE_SMASHED) {
      return [
        "The drilling machine is smashed!",
        "",
        "I should follow the <col=800000>tunnel south</col> back to the",
        "Dorgeshuun mine with <col=800000>Zanik</col>.",
      ];
    }
    if (stage >= STAGE_SIGMUND_DEFEATED) {
      return [
        "Sigmund escaped with a ring of life.",
        "",
        "I should smash the <col=800000>drilling machine</col> before",
        "anyone else can use it.",
      ];
    }
    if (stage === STAGE_MILL) {
      return [
        "Zanik and I descended into the water mill cellar.",
        "",
        "I must defeat <col=800000>Sigmund</col> and smash the",
        "<col=800000>drilling machine</col> he plans to flood the city with.",
      ];
    }
    if (stage === STAGE_REVIVED) {
      return [
        "Juna revived Zanik with the Tears of Guthix. The H.A.M. are",
        "assembling a drilling machine at the Lumbridge water mill!",
        "",
        "I should head to the <col=800000>water mill</col> with",
        "<col=800000>Zanik</col> and stop them.",
      ];
    }
    if (stage === STAGE_TEARS) {
      return [
        "Zanik is dead, but her mark is glowing. I laid her body",
        "before <col=800000>Juna</col> in the Chasm of Tears.",
        "",
        "I must collect twenty tears to revive her.",
      ];
    }
    if (stage === STAGE_BODY) {
      return [
        "Zanik was killed by Sigmund's men outside the H.A.M. hideout.",
        "",
        "I am carrying her body to <col=800000>Juna</col> in the",
        "<col=800000>Chasm of Tears</col>.",
      ];
    }
    if (stage === STAGE_JAILED) {
      return [
        "I listened at the H.A.M. meeting room door and was captured.",
        "",
        "<col=800000>Jimmy the Chisel</col> says Sigmund took Zanik",
        "outside. I must escape and find her.",
      ];
    }
    if (stage === STAGE_CAUGHT) {
      return ["The guards caught me listening at the meeting room door."];
    }
    if (stage === STAGE_TRAPDOOR) {
      if (guardsKilled(player) < 5) {
        return [
          "Zanik spotted a <col=800000>trapdoor hidden by dirt</col> in",
          "the H.A.M. hideout.",
          "",
          "We slipped into the store room; the guards must be dealt",
          "with before we can listen at the meeting room.",
        ];
      }
      return [
        "The store room guards are dealt with.",
        "",
        "I should listen at the <col=800000>double doors</col> of the",
        "H.A.M. meeting room.",
      ];
    }
    if (stage === STAGE_INFILTRATING) {
      return [
        "Zanik and I entered the <col=800000>H.A.M. hideout</col> in",
        "disguise.",
        "",
        "We should talk to the guards and <col=800000>Johanhus</col>",
        "to learn what the H.A.M. are planning.",
      ];
    }
    if (stage === STAGE_TOUR_DONE) {
      return [
        "Zanik told me the story of her mark.",
        "",
        "We should go to the <col=800000>H.A.M. hideout</col> west of",
        "Lumbridge to find out what they are planning.",
      ];
    }
    if (stage === STAGE_TOURING) {
      const lines = [
        "I am showing <col=800000>Zanik</col> around Lumbridge before",
        "we infiltrate the H.A.M. hideout.",
        "",
      ];
      const stops = [
        [BIT_DUKE, "<col=800000>Duke Horacio</col>"],
        [BIT_COMMON, "a <col=800000>man or woman</col>"],
        [BIT_AERECK, "<col=800000>Father Aereck</col>"],
        [BIT_GOBLIN, "a <col=800000>goblin</col>"],
        [BIT_SHOP, "the <col=800000>shop</col>"],
      ];
      for (const [bit, label] of stops) {
        if (!hasBit(player, bit)) lines.push(`I should introduce Zanik to ${label}.`);
      }
      return lines;
    }
    if (stage === STAGE_STARTED) {
      return [
        "<str>Mistag asked me to guide a Dorgeshuun agent to the</str>",
        "<str>surface.</str>",
        "",
        "I need <col=800000>two full sets of H.A.M. robes</col> - shirt,",
        "robe, hood, cloak, gloves, boots and badge.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Mistag</col> in",
      "the <col=800000>Dorgesh-Kaan mine</col> beneath Lumbridge.",
      "",
      "Requirements: <col=800000>The Lost Tribe</col> and",
      "<col=800000>The Giant Dwarf</col>, 23 Agility, 23 Thieving.",
      "I will need a light source and two sets of H.A.M. robes.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 2000);
    player.getSkillManager().addExperiences(Skill.RANGED, 2000);
  }

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(GUARDS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "death_to_the_dorgeshuun",
    name: "Death to the Dorgeshuun",
    varpId: VARP_DTTD,
    varbitId: VARBIT_DTTD_MAIN,
    // The saved stage is this plugin's line-by-line route; Quest Helper's
    // loadSteps keys are the real dttd_main wire values. Keep durable saves on
    // the internal stages but transmit the canonical varbit value.
    varbitValue(stage) {
      const WIRE_STAGE = [0, 1, 3, 4, 4, 5, 5, 6, 6, 7, 8, 10, 11, 12, 13];
      return WIRE_STAGE[stage] ?? stage;
    },
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.THIEVING.getIndex(), amount: 2000, label: "Thieving" },
      { skillId: Skill.RANGED.getIndex(), amount: 2000, label: "Ranged" },
    ],
    otherRewards: [
      "Access to Dorgesh-Kaan and the H.A.M. store room",
      "The bone crossbow and bone dagger special attacks",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Mistag", { "Talk-to": talkMistag });
  api.onNpcInteraction("Kazgar", { "Talk-to": talkKazgar });
  api.onNpcInteraction("Zanik", { "Talk-to": talkZanik });
  api.onNpcInteraction("Duke Horacio", { "Talk-to": talkDuke });
  api.onNpcInteraction("Cook", { "Talk-to": talkCook });
  api.onNpcInteraction("Hans", { "Talk-to": talkHans });
  api.onNpcInteraction("Bob", { "Talk-to": talkBob });
  api.onNpcInteraction("Father Aereck", { "Talk-to": talkFatherAereck });
  api.onNpcInteraction("Lumbridge Guide", { "Talk-to": talkLumbridgeGuide });
  api.onNpcInteraction("Shop keeper", { "Talk-to": talkShopKeeper });
  api.onNpcInteraction("Man", { "Talk-to": talkCommoner });
  api.onNpcInteraction("Woman", { "Talk-to": talkCommoner });
  api.onNpcInteraction("Goblin", { "Talk-to": talkGoblin });
  api.onNpcInteraction("H.A.M. Guard", { "Talk-to": talkHamGuard });
  api.onNpcInteraction("Guard", { "Talk-to": talkStoreGuard });
  api.onNpcInteraction("Johanhus Ulsbrecht", { "Talk-to": talkJohanhus });
  api.onNpcInteraction("Sigmund", { "Talk-to": talkSigmund });
  api.onNpcInteraction("Dwarf", { "Talk-to": talkMillDwarf });
  api.onNpcInteraction("Jimmy the Chisel", { "Talk-to": talkJimmy });
  api.onNpcInteraction("Juna", { "Talk-to": talkJuna });
  api.onObjectInteraction(JUNA_LOC_NAME, { "Talk-to": talkJuna });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:stage-changed", handleQuestStageChanged);
  api.onCustomEvent("door:toggle", claimLargeDoor);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(ZANIK_BODY_ITEM_ID, { Drop: handleItemAction });
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(HAM_ZONE, handleHamZoneEnter);
  api.onZoneEnter(RUBBLE_ZONE, handleRubbleZoneEnter);
  api.onZoneEnter(STORE_ZONE, handleStoreZoneEnter);
  api.onZoneEnter(MILL_ZONE, handleMillZoneEnter);
  api.onZoneEnter(LUMBRIDGE_ZONE, handleLumbridgeZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
