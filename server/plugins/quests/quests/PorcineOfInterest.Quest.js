/**
 * A Porcine of Interest (members).
 *
 * The words come from the "A Porcine of Interest" transcript page (plus the
 * "Spria" / "Sarah" pages for the post-quest and pre-quest conversations).
 * This plugin supplies the variant selector for Sarah and Spria, the start
 * hook on the Draynor notice board, the crossroads investigation objects, the
 * cave and its cutscene, the quest sourhog spawn, the foot/bounty hand-in and
 * the completion rewards.
 *
 * Stages (varbit 10582 "porcine", varp 2748, bits 0-5; cache evidence:
 * `lookup-gameval.ts varbit porcine` -> "10582 porcine varp=2748 bits=0-5"):
 *   1 read the notice board, 2 Sarah explained the attack, 3 rope tied at the
 *   strange hole, 4 Pig Thing cutscene done (woke in Spria's house), 5 Spria
 *   gave the reinforced goggles, 6 quest sourhog killed, 7 foot cut,
 *   8 bounty collected from Sarah, 9 told Spria (complete).
 * Sibling bits used: 10583 footcut, 10584 inspected_cart, 10585 need_rope,
 * 10587 stop_warning, 10589 task_offered, 10590 task_accepted.
 *
 * The crossroads objects (cart, produce trail, broken trees, strange hole,
 * skeleton, pile of rope) are varbit locs in OSRS and absent from this cache's
 * map, so the plugin places them at their wiki tiles when a player first
 * reaches the area; the notice board (40307) and the cave rope/blockage
 * (40330/40331) are already in the map.
 *
 * The hole: per-player locs need a PrivateArea, which the open world has none
 * of, so 40308/40309 are not swapped. The world hole is registered once as the
 * tied "Climb-down" form (40309) and who may tie/enter is per player, via the
 * persisted "quest.porcine.rope-tied" attribute: Climb-down on 40308 (should it
 * ever be present, only when the attribute is set) and on 40309 both enter;
 * otherwise the hole runs the wiki investigate transcript (rope -> tie, no rope
 * -> "I'll need to tie something onto the edge").
 *
 * Gaps / approximations:
 *   - npc-spawns.json spawns Spria and Rosie with ids 10440/10441, which are
 *     name-null in this cache (no Talk-to). The plugin removes those two and
 *     spawns the real Spria 10432 / Rosie 10438 once; the canonical fix is an
 *     npc-spawns.json edit.
 *   - The Pig Thing is not spawned; its cutscene narration is shown as game
 *     messages with each speaker keeping their own chathead.
 *   - The 30 Slayer reward points go to the Slayer plugin through
 *     "slayer:grant-points". Sourhog tasks are not gated on quest completion.
 *   - Reinforced goggles are not folded into existing slayer helmets; the
 *     cleanup of the produce trail after the quest is not simulated.
 *   - The quest sourhog spawns at (3165,9677): the cache walls off the old
 *     (3163,9682) into an unreachable pocket, while (3165,9677) is inside the
 *     chamber's walkable component (live-walked from the (3156,9703) landing,
 *     all four neighbours walkable), so the kill and the corpse Cut-foot work.
 *
 * Source: https://oldschool.runescape.wiki/w/A_Porcine_of_Interest and
 * https://oldschool.runescape.wiki/w/Transcript:A_Porcine_of_Interest
 */
module.exports = function registerPorcineOfInterestQuest(api) {
  const {
    Equipment,
    GameObject,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const SARAH_NPC_ID = NpcIdentifiers.SARAH; // 501, South Falador Farm
  const SPRIA_NPC_IDS = new Set([
    NpcIdentifiers.SPRIA, // 10432
    NpcIdentifiers.SPRIA_2, // 10433
    NpcIdentifiers.SPRIA_3, // 10434
  ]);
  const SPRIA_DIALOGUE_NPC_ID = NpcIdentifiers.SPRIA;
  /** Spawn-file id that is name-null in this cache; replaced by the real Spria. */
  const BROKEN_SPRIA_NPC_ID = 10440;
  const BROKEN_ROSIE_NPC_ID = 10441;
  const QUEST_SOURHOG_NPC_ID = NpcIdentifiers.SOURHOG_2; // 10436 (wiki monster id)
  const PIG_THING_NPC_ID = NpcIdentifiers.PIG_THING; // 10437, cutscene speaker

  const NOTICE_BOARD_OBJECT_ID = ObjectIdentifiers.NOTICE_BOARD_6; // 40307 (in the map)
  const STRANGE_HOLE_OBJECT_ID = ObjectIdentifiers.STRANGE_HOLE_2; // 40308
  const STRANGE_HOLE_ROPE_OBJECT_ID = ObjectIdentifiers.STRANGE_HOLE_3; // 40309
  const CABBAGE_OBJECT_ID = ObjectIdentifiers.CABBAGE_4; // 40310
  const POTATOES_OBJECT_ID = ObjectIdentifiers.POTATOES_2; // 40311
  const CARROT_OBJECT_ID = ObjectIdentifiers.CARROT; // 40312
  const BROKEN_TREE_OBJECT_ID = ObjectIdentifiers.BROKEN_DEAD_TREE; // 40313
  const DAMAGED_CART_OBJECT_ID = ObjectIdentifiers.DAMAGED_CART; // 40314
  const DEAD_SOURHOG_OBJECT_ID = ObjectIdentifiers.DEAD_SOURHOG; // 40316
  const SKELETON_OBJECT_ID = ObjectIdentifiers.SKELETON_92; // 40320
  const PILE_OF_ROPE_OBJECT_ID = ObjectIdentifiers.PILE_OF_ROPE_2; // 40324
  const CAVE_ROPE_OBJECT_ID = ObjectIdentifiers.ROPE_44; // 40330 (in the map)
  const BLOCKAGE_OBJECT_ID = ObjectIdentifiers.BLOCKAGE_7; // 40331 (in the map)

  const QUEST_OBJECT_IDS = new Set([
    NOTICE_BOARD_OBJECT_ID,
    STRANGE_HOLE_OBJECT_ID,
    STRANGE_HOLE_ROPE_OBJECT_ID,
    CABBAGE_OBJECT_ID,
    POTATOES_OBJECT_ID,
    CARROT_OBJECT_ID,
    BROKEN_TREE_OBJECT_ID,
    DAMAGED_CART_OBJECT_ID,
    DEAD_SOURHOG_OBJECT_ID,
    SKELETON_OBJECT_ID,
    PILE_OF_ROPE_OBJECT_ID,
    CAVE_ROPE_OBJECT_ID,
    BLOCKAGE_OBJECT_ID,
  ]);

  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const REINFORCED_GOGGLES_ITEM_ID = ItemIdentifiers.REINFORCED_GOGGLES; // 24942
  const SOURHOG_FOOT_ITEM_ID = ItemIdentifiers.SOURHOG_FOOT; // 24944
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const BRONZE_SCIMITAR_ITEM_ID = ItemIdentifiers.BRONZE_SCIMITAR; // 1321
  const KATANA_ITEM_ID = ItemIdentifiers.KATANA; // 12357
  const GNOME_GOGGLES_ITEM_IDS = new Set([
    ItemIdentifiers.GNOME_GOGGLES, // 9472
    ItemIdentifiers.GNOME_GOGGLES_3, // 18704
  ]);
  /** Wiki exclusions: these look like slash weapons but do not cut the foot. */
  const EXCLUDED_SLASH_NAMES = ["abyssal whip", "abyssal tentacle", "noxious halberd", "dragon claws"];

  const VARP_PORCINE = 2748;
  const VARBIT_PORCINE_STAGE = 10582;
  const VARBIT_FOOTCUT = 10583;
  const VARBIT_INSPECTED_CART = 10584;
  const VARBIT_NEED_ROPE = 10585;
  const VARBIT_STOP_WARNING = 10587;
  const VARBIT_TASK_OFFERED = 10589;
  const VARBIT_TASK_ACCEPTED = 10590;

  const STAGE_STARTED = 1;
  const STAGE_TALKED_SARAH = 2;
  const STAGE_FOUND_CAVE = 3;
  const STAGE_ATTACKED = 4;
  const STAGE_HAS_GOGGLES = 5;
  const STAGE_SOURHOG_DEAD = 6;
  const STAGE_HAS_FOOT = 7;
  const STAGE_BOUNTY_COLLECTED = 8;
  const STAGE_COMPLETE = 9;

  const PAGE = "A Porcine of Interest";
  const START_HOOK = "quest:a-porcine-of-interest:start";

  const BITS_ATTRIBUTE = "quest.a_porcine_of_interest.bits";
  const ROPE_TIED_ATTRIBUTE = "quest.porcine.rope-tied";
  const BIT_FOOTCUT = 1;
  const BIT_INSPECTED_CART = 2;
  const BIT_NEED_ROPE = 4;
  const BIT_STOP_WARNING = 8;
  const BIT_TASK_OFFERED = 16;
  const BIT_TASK_ACCEPTED = 32;
  const VARBIT_BY_BIT = new Map([
    [BIT_FOOTCUT, VARBIT_FOOTCUT],
    [BIT_INSPECTED_CART, VARBIT_INSPECTED_CART],
    [BIT_NEED_ROPE, VARBIT_NEED_ROPE],
    [BIT_STOP_WARNING, VARBIT_STOP_WARNING],
    [BIT_TASK_OFFERED, VARBIT_TASK_OFFERED],
    [BIT_TASK_ACCEPTED, VARBIT_TASK_ACCEPTED],
  ]);

  const SLAYER_POINTS_REWARD = 30;
  const SLAYER_XP_REWARD = 1000;

  /** Wiki tiles (oldschool.runescape.wiki scenery pages). */
  const DAMAGED_CART_TILE = { x: 3120, y: 3300 };
  const CABBAGE_TILES = [
    { x: 3124, y: 3302 },
    { x: 3126, y: 3308 },
    { x: 3130, y: 3314 },
  ];
  const CARROT_TILES = [
    { x: 3124, y: 3305 },
    { x: 3125, y: 3304 },
    { x: 3135, y: 3323 },
    { x: 3135, y: 3327 },
    { x: 3136, y: 3328 },
    { x: 3145, y: 3337 },
    { x: 3146, y: 3342 },
  ];
  const POTATOES_TILES = [
    { x: 3119, y: 3302 },
    { x: 3123, y: 3301 },
    { x: 3128, y: 3310 },
    { x: 3132, y: 3313 },
  ];
  const BROKEN_TREE_TILES = [
    { x: 3133, y: 3323 },
    { x: 3140, y: 3332 },
    { x: 3148, y: 3344 },
    { x: 3133, y: 3317 },
    { x: 3146, y: 3332 },
    { x: 3142, y: 3340 },
    { x: 3139, y: 3331 },
  ];
  const STRANGE_HOLE_TILE = { x: 3150, y: 3347 };
  const PILE_OF_ROPE_TILE = { x: 3159, y: 9713 };
  const SKELETON_TILE = { x: 3163, y: 9676 };
  const SCIMITAR_TILE = { x: 3162, y: 9677 };
  const CAVE_LANDING_TILE = { x: 3157, y: 9713 };
  const HOLE_RETURN_TILE = { x: 3149, y: 3347 };
  /**
   * The skeleton chamber tile the quest sourhog spawns on. (3163,9682) is walled
   * off from the climb-over landing; (3165,9677) is two tiles from the skeleton,
   * was walked to from (3156,9703) and all four neighbours are walkable, so the
   * fight and the corpse's Cut-foot are reachable.
   */
  const SOURHOG_SPAWN_TILE = { x: 3165, y: 9677 };
  const SPRIA_HOUSE_TILE = { x: 3092, y: 3266 };
  const SPRIA_SPAWN_TILE = { x: 3091, y: 3266 };
  const ROSIE_SPAWN_TILE = { x: 3035, y: 3296 };
  /** The blockage spans x3156-3157 at y9704 (loc dump). */
  const BLOCKAGE_Y = 9704;

  const SURFACE_ZONE = { minX: 3075, maxX: 3170, minY: 3235, maxY: 3360, levels: [0] };
  const CAVE_ZONE = { minX: 3130, maxX: 3200, minY: 9650, maxY: 9740, levels: [0] };

  let quest;
  let questObjectsInstalled = false;
  let brokenSpawnsFixed = false;
  let itemOnGroundManager = null;

  /** Transient branch context (never persisted). */
  const footAction = new WeakMap();
  const blockageDestination = new WeakMap();
  const bossByPlayer = new Map();
  const corpseByPlayer = new Map();

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    if (hasBit(player, bit)) return;
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
    const varbit = VARBIT_BY_BIT.get(bit);
    if (varbit !== undefined) player.getPacketSender().sendVarbit(varbit, 1);
  }

  function advanceStage(player, target) {
    if (quest.getStage(player) < target) quest.setStage(player, target);
  }

  function nameOf(itemId) {
    return String(ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase();
  }

  function wearingItem(player, itemIds) {
    const head = player.getEquipment().get(Equipment.HEAD_SLOT);
    return Boolean(head && itemIds.has(head.getId?.()));
  }

  function wearingGoggles(player) {
    const head = player.getEquipment().get(Equipment.HEAD_SLOT);
    return head?.getId?.() === REINFORCED_GOGGLES_ITEM_ID;
  }

  function isKnife(itemId) {
    const name = nameOf(itemId);
    return name === "knife" || name === "kitchen knife";
  }

  function isSlashWeapon(itemId) {
    const name = nameOf(itemId);
    if (EXCLUDED_SLASH_NAMES.some((excluded) => name.includes(excluded))) return false;
    const slashBonus = Number(ItemDefinition.forId(itemId)?.getBonuses?.()?.[1]) || 0;
    return slashBonus > 0;
  }

  function isSharp(itemId) {
    return isKnife(itemId) || isSlashWeapon(itemId);
  }

  function hasSharp(player) {
    const inventory = player.getInventory();
    if ((inventory.getItems() ?? []).some((item) => item && isSharp(item.getId?.()))) {
      return true;
    }
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return weapon ? isSharpWeaponId(weapon.getId?.()) : false;
  }

  function isSharpWeaponId(itemId) {
    return Number.isInteger(itemId) && itemId > 0 && isSlashWeapon(itemId);
  }

  function hasFoot(player) {
    return held(player, SOURHOG_FOOT_ITEM_ID);
  }

  function hasRope(player) {
    return held(player, ROPE_ITEM_ID);
  }

  function bankHasGoggles(player) {
    try {
      return Number(player.getBank?.()?.getAmount?.(REINFORCED_GOGGLES_ITEM_ID) ?? 0) > 0;
    } catch {
      return false;
    }
  }

  function hasSlayerTask(player) {
    const request = { player, line: null };
    api.emitCustomEvent("slayer:task-tip", request);
    return typeof request.line === "string" && request.line.length > 0;
  }

  function inCaveZone(player) {
    const location = player.getLocation();
    return location.getZ() === 0
      && location.getX() >= CAVE_ZONE.minX && location.getX() <= CAVE_ZONE.maxX
      && location.getY() >= CAVE_ZONE.minY && location.getY() <= CAVE_ZONE.maxY;
  }

  // ==========================================================================
  // Quest scenery (absent from the map, placed at the wiki tiles)
  // ==========================================================================

  function registerObject(objectId, x, y) {
    const object = new GameObject(objectId, new Location(x, y, 0), 10, 0, null);
    ObjectManager.register(object, true);
    return object;
  }

  function installQuestObjects() {
    if (questObjectsInstalled) return;
    questObjectsInstalled = true;
    registerObject(DAMAGED_CART_OBJECT_ID, DAMAGED_CART_TILE.x, DAMAGED_CART_TILE.y);
    for (const tile of CABBAGE_TILES) registerObject(CABBAGE_OBJECT_ID, tile.x, tile.y);
    for (const tile of CARROT_TILES) registerObject(CARROT_OBJECT_ID, tile.x, tile.y);
    for (const tile of POTATOES_TILES) registerObject(POTATOES_OBJECT_ID, tile.x, tile.y);
    for (const tile of BROKEN_TREE_TILES) registerObject(BROKEN_TREE_OBJECT_ID, tile.x, tile.y);
    registerObject(PILE_OF_ROPE_OBJECT_ID, PILE_OF_ROPE_TILE.x, PILE_OF_ROPE_TILE.y);
    registerObject(SKELETON_OBJECT_ID, SKELETON_TILE.x, SKELETON_TILE.y);
    // Per-player locs need a PrivateArea, and the open world has none (Doors only
    // passes one in instances). The hole is registered once in its tied
    // "Climb-down" form and never swapped; the per-player rope-tied attribute
    // decides who may tie/enter.
    registerObject(STRANGE_HOLE_ROPE_OBJECT_ID, STRANGE_HOLE_TILE.x, STRANGE_HOLE_TILE.y);
  }

  /** Tied state is per player (OSRS keeps it in a varbit loc; the open world cannot). */
  function isRopeTied(player) {
    return quest.getStage(player) >= STAGE_STARTED
      && player.getAttribute(ROPE_TIED_ATTRIBUTE) === true;
  }

  /** Tying the rope consumes it and marks this player's hole tied; no world swap. */
  function tieRope(player) {
    if (isRopeTied(player)) return;
    advanceStage(player, STAGE_FOUND_CAVE);
    if (held(player, ROPE_ITEM_ID)) player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
    player.setAttribute(ROPE_TIED_ATTRIBUTE, true);
  }

  /** The broken spawn-file ids (10440/10441) are name-null; put the real NPCs in. */
  function ensureBrokenSpawns() {
    if (brokenSpawnsFixed) return;
    brokenSpawnsFixed = true;
    const world = api.getWorld();
    const npcs = world?.getNpcs ? [...world.getNpcs()] : [];
    for (const npc of npcs) {
      const id = npc?.getId?.();
      if (id === BROKEN_SPRIA_NPC_ID || id === BROKEN_ROSIE_NPC_ID) api.removeNpc(npc);
    }
    const hasRealSpria = npcs.some((npc) => npc?.getId?.() === SPRIA_DIALOGUE_NPC_ID);
    if (!hasRealSpria) {
      api.spawnNpc({
        id: SPRIA_DIALOGUE_NPC_ID,
        x: SPRIA_SPAWN_TILE.x,
        y: SPRIA_SPAWN_TILE.y,
        z: 0,
        wanderRadius: 0,
      });
      api.spawnNpc({
        id: NpcIdentifiers.ROSIE_2,
        x: ROSIE_SPAWN_TILE.x,
        y: ROSIE_SPAWN_TILE.y,
        z: 0,
        wanderRadius: 0,
      });
    }
  }

  // ==========================================================================
  // Spawns
  // ==========================================================================

  /** The bronze scimitar near the skeleton (re-placed per player with the cave). */
  function ensureScimitar(player) {
    const tile = new Location(SCIMITAR_TILE.x, SCIMITAR_TILE.y, 0);
    if (player.getInventory().getAmount(BRONZE_SCIMITAR_ITEM_ID) > 0) return;
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    if (weapon?.getId?.() === BRONZE_SCIMITAR_ITEM_ID) return;
    if (itemOnGroundManager.getGroundItem(player.getUsername(), BRONZE_SCIMITAR_ITEM_ID, tile)) {
      return;
    }
    itemOnGroundManager.registerLocation(player, new Item(BRONZE_SCIMITAR_ITEM_ID, 1), tile);
  }

  function ensureSourhog(player) {
    if (quest.getStage(player) !== STAGE_HAS_GOGGLES) return;
    if (bossByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: QUEST_SOURHOG_NPC_ID,
      x: SOURHOG_SPAWN_TILE.x,
      y: SOURHOG_SPAWN_TILE.y,
      z: 0,
      wanderRadius: 4,
      owner: player,
      ownerOnly: true,
    });
    if (npc) bossByPlayer.set(player, npc);
  }

  function removeSourhog(player) {
    const npc = bossByPlayer.get(player);
    if (!npc) return;
    bossByPlayer.delete(player);
    api.removeNpc(npc);
  }

  function registerDeadSourhog(player, location) {
    const previous = corpseByPlayer.get(player);
    if (previous) {
      ObjectManager.deregister(previous, true);
      corpseByPlayer.delete(player);
    }
    const corpse = new GameObject(
      DEAD_SOURHOG_OBJECT_ID,
      new Location(location.x | 0, location.y | 0, location.z | 0),
      10,
      0,
      null
    );
    ObjectManager.register(corpse, true);
    corpseByPlayer.set(player, corpse);
  }

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    if (event.npcId !== QUEST_SOURHOG_NPC_ID) return;
    const owner = killer?.isPlayer?.() && bossByPlayer.get(killer) === npc ? killer : npc?.getOwner?.();
    if (!owner || !owner.isPlayer?.()) return;
    bossByPlayer.delete(owner);
    const location = event.location ?? npc?.getLocation?.();
    if (!location) return;
    registerDeadSourhog(owner, location);
    if (quest.getStage(owner) !== STAGE_HAS_GOGGLES) return;
    quest.setStage(owner, STAGE_SOURHOG_DEAD);
    const weapon = owner.getEquipment().get(Equipment.WEAPON_SLOT);
    if (weapon?.getId?.() === KATANA_ITEM_ID) {
      startTranscript(api, owner, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-killing-the-sourhog-with-a-katana");
    }
  }

  // ==========================================================================
  // Transcript selection and condition answers
  // ==========================================================================

  /** Which transcript variant Sarah or Spria plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === SARAH_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue";
      if (stage >= STAGE_BOUNTY_COLLECTED) {
        return "finishing-up-talking-to-sarah-before-telling-spria-about-the-bounty-completion";
      }
      if (stage >= STAGE_HAS_FOOT) return "collecting-the-bounty-talking-to-sarah";
      if (stage >= STAGE_FOUND_CAVE) return "inside-the-cave-talking-to-sarah-after-finding-the-cave";
      if (stage >= STAGE_TALKED_SARAH) return "starting-out-talking-to-sarah-subsequent-conversation";
      if (stage >= STAGE_STARTED) return "starting-out-talking-to-sarah-initial-conversation";
      return "standard-dialogue";
    }
    if (SPRIA_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-a-porcine-of-interest";
      if (stage >= STAGE_BOUNTY_COLLECTED) return "finishing-up-talking-to-spria";
      if (stage >= STAGE_SOURHOG_DEAD) return "collecting-the-bounty-talking-to-spria";
      if (stage >= STAGE_HAS_GOGGLES) {
        return "the-sourhog-talking-to-spria-after-acquiring-the-reinforced-goggles";
      }
      if (stage >= STAGE_ATTACKED) return "the-sourhog-talking-to-spria-initial-conversation";
      return "standard-dialogue-before-a-porcine-of-interest";
    }
    return null;
  }

  function answerFootCondition(player, stepId) {
    const action = footAction.get(player);
    switch (stepId) {
      case "lfiWkg":
        return !hasFoot(player) && action === "cut" && !hasSharp(player);
      case "heMQPV":
        return !hasFoot(player)
          && typeof action === "number"
          && !isSharp(action);
      case "zc6fD9":
        if (hasFoot(player)) return false;
        return action === "cut" ? hasSharp(player) : typeof action === "number" && isSharp(action);
      case "g2XJlL":
        return hasFoot(player);
      default:
        return null;
    }
  }

  function answerSarahCondition(player, stepId) {
    switch (stepId) {
      case "eqR84-":
        return !hasRope(player);
      case "k3vDUa":
        return hasRope(player);
      case "sQqAwg":
        return !hasFoot(player);
      case "bHsloM":
        return hasFoot(player);
      default:
        return answerFootCondition(player, stepId);
    }
  }

  function answerSpriaCondition(player, stepId) {
    switch (stepId) {
      case "gVaQ9T":
        return !wearingItem(player, GNOME_GOGGLES_ITEM_IDS);
      case "nanlAJ":
        return wearingItem(player, GNOME_GOGGLES_ITEM_IDS);
      case "fEocnZ":
        return player.getInventory().isFull();
      case "-iFZGD":
        return !player.getInventory().isFull();
      case "aX4lXB":
        return wearingGoggles(player);
      case "kQpEu6":
        return held(player, REINFORCED_GOGGLES_ITEM_ID);
      case "aIPCCD":
        return bankHasGoggles(player);
      case "EsWbC8":
        return !wearingGoggles(player)
          && !held(player, REINFORCED_GOGGLES_ITEM_ID)
          && !bankHasGoggles(player);
      case "cuEtvC":
        return false;
      case "RGQc9A":
        return !hasSlayerTask(player);
      case "B49An4":
        return hasSlayerTask(player);
      case "2LqhLT":
        return false;
      case "DhLGnl":
        return !hasSlayerTask(player);
      case "oIq-xQ":
        return hasSlayerTask(player);
      case "CEpjWS":
        return false;
      case "9dGri8":
        return false;
      case "6YLYvN":
        return true;
      default:
        return null;
    }
  }

  function answerCondition(event) {
    const { npcId, player, stepId } = event;
    if (npcId === SARAH_NPC_ID && stepId) return answerSarahCondition(player, stepId);
    if ((SPRIA_NPC_IDS.has(npcId) || npcId === PIG_THING_NPC_ID) && stepId) {
      return answerSpriaCondition(player, stepId);
    }
    return null;
  }

  /**
   * ::quest reset only clears the stage, so a fresh start (stage 0 -> 1) must drop
   * everything a previous run left behind: side bits, the tied rope and the boss.
   */
  function resetQuestProgress(player) {
    player.setAttribute(BITS_ATTRIBUTE, 0);
    for (const varbit of VARBIT_BY_BIT.values()) player.getPacketSender().sendVarbit(varbit, 0);
    player.setAttribute(ROPE_TIED_ATTRIBUTE, null);
    removeSourhog(player);
    const corpse = corpseByPlayer.get(player);
    if (corpse) {
      ObjectManager.deregister(corpse, true);
      corpseByPlayer.delete(player);
    }
  }

  function handleStartHook({ player, hook, quest: questName }) {
    if (hook !== START_HOOK || questName !== "A Porcine of Interest") return;
    if (quest.getStage(player) !== 0) return;
    resetQuestProgress(player);
    quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option }) {
    if (npcId !== SARAH_NPC_ID || option !== "Talk about the bounty.") return;
    if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_TALKED_SARAH);
  }

  /** Spria's "still hunting" line carries wiki [task monster]/[amount] blanks. */
  function handleDialogueLine(event) {
    if (!SPRIA_NPC_IDS.has(event.npcId)) return;
    const text = String(event.text ?? "");
    if (!text.includes("[task monster]") && !text.includes("[amount]")) return;
    if (!hasSlayerTask(event.player)) return;
    const line = claimSlayerTask(event.player, event.npcId, event.definition);
    if (line) event.text = line;
  }

  /** The chosen prose condition, for the rope tie and the task-offer state bits. */
  function handleConditionStep({ player, npcId, stepId }) {
    if (npcId === SARAH_NPC_ID && stepId === "eqR84-") {
      setBit(player, BIT_NEED_ROPE);
      return;
    }
    if (npcId === SARAH_NPC_ID && stepId === "k3vDUa") {
      tieRope(player);
      return;
    }
    if (stepId === "RGQc9A") setBit(player, BIT_TASK_OFFERED);
  }

  // ==========================================================================
  // Dialogue actions and messages
  // ==========================================================================

  function giveGoggles(player) {
    if (held(player, REINFORCED_GOGGLES_ITEM_ID)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need some free inventory space to take the goggles.");
      return;
    }
    player.getInventory().adds(REINFORCED_GOGGLES_ITEM_ID, 1);
  }

  function claimSlayerTask(player, npcId, definition) {
    const request = {
      player,
      master: "Spria",
      npcId,
      definitionId: definition?.getId?.() ?? npcId,
      npcName: "Spria",
      line: null,
    };
    api.emitCustomEvent("slayer:assignment", request);
    return typeof request.line === "string" && request.line.length > 0 ? request.line : null;
  }

  function collectBounty(player) {
    if (quest.getStage(player) !== STAGE_HAS_FOOT) return;
    if (held(player, SOURHOG_FOOT_ITEM_ID)) {
      player.getInventory().deleteNumber(SOURHOG_FOOT_ITEM_ID, 1);
    }
    player.getInventory().adds(COINS_ITEM_ID, 5000);
    quest.setStage(player, STAGE_BOUNTY_COLLECTED);
  }

  function takeFoot(player) {
    if (quest.getStage(player) !== STAGE_SOURHOG_DEAD || hasFoot(player)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need some free inventory space for the foot.");
      return;
    }
    player.getInventory().adds(SOURHOG_FOOT_ITEM_ID, 1);
    setBit(player, BIT_FOOTCUT);
    quest.setStage(player, STAGE_HAS_FOOT);
    const corpse = corpseByPlayer.get(player);
    if (corpse) {
      ObjectManager.deregister(corpse, true);
      corpseByPlayer.delete(player);
    }
  }

  function climbBlockage(player, destination) {
    player.moveTo(destination);
    ensureSourhog(player);
  }

  /** "The player climbs over the blockage." on the warning transcript's Yes. */
  function handleBlockageClimb(player, text) {
    const destination = blockageDestination.get(player);
    blockageDestination.delete(player);
    if (text) player.sendMessage(text);
    if (destination) climbBlockage(player, destination);
  }

  function handleMessageAction(player, stepId) {
    if (stepId === "JEd5bn") {
      setBit(player, BIT_INSPECTED_CART);
      return;
    }
    if (stepId === "fvC8GN") {
      collectBounty(player);
      return;
    }
    if (stepId === "Um0TAs") {
      takeFoot(player);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    if (npcId !== SARAH_NPC_ID && !SPRIA_NPC_IDS.has(npcId) && npcId !== PIG_THING_NPC_ID) return;
    if (kind === "message") {
      handleMessageAction(player, stepId);
      return;
    }
    switch (stepId) {
      case "eShaqt":
      case "GiFHeZ":
      case "2jP1lw":
      case "OnSUD-":
      case "32r40G":
      case "Rb2zDN":
      case "EaeUfj": {
        event.handled = true;
        if (stepId === "EaeUfj") {
          player.moveTo(new Location(SPRIA_HOUSE_TILE.x, SPRIA_HOUSE_TILE.y, 0));
          advanceStage(player, STAGE_ATTACKED);
        }
        if (event.text) player.sendMessage(event.text);
        return;
      }
      case "f8rW5G":
        event.handled = true;
        handleBlockageClimb(player, event.text);
        return;
      case "LFxcPW":
        event.handled = true;
        giveGoggles(player);
        advanceStage(player, STAGE_HAS_GOGGLES);
        return;
      case "nT99T5":
        event.handled = true;
        giveGoggles(player);
        return;
      case "w1i1Mg":
        event.handled = true;
        if (quest.getStage(player) >= STAGE_BOUNTY_COLLECTED && !quest.isComplete(player)) {
          quest.complete(player);
        }
        return;
      case "PGmPeJ": {
        event.handled = true;
        setBit(player, BIT_TASK_ACCEPTED);
        const line = claimSlayerTask(player, npcId, event.definition);
        if (line) event.steps = [{ npc: line }];
        return;
      }
      default:
        return;
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleNoticeBoard(player) {
    const variant = quest.getStage(player) >= STAGE_STARTED
      ? "starting-out-searching-the-notice-board-searching-the-notice-board-again"
      : "starting-out-searching-the-notice-board";
    startTranscript(api, player, SARAH_NPC_ID, PAGE, variant);
  }

  function investigateTrail(player, variant) {
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    startTranscript(api, player, SARAH_NPC_ID, PAGE, variant);
  }

  function startHoleTranscript(player) {
    startTranscript(api, player, SARAH_NPC_ID, PAGE, "investigating-the-crossroads-strange-hole");
  }

  function climbDownHole(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_ATTACKED) {
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "inside-the-cave-attempting-to-enter-the-sourhog-cave-after-being-attacked-by-the-sourhog");
      return;
    }
    if (stage >= STAGE_HAS_GOGGLES && stage < STAGE_BOUNTY_COLLECTED && !wearingGoggles(player)) {
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-attempting-to-enter-the-hole-without-reinforced-goggles-equipped");
      return;
    }
    if (stage === STAGE_HAS_FOOT) {
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-attempting-to-re-enter-the-sourhog-cave-with-a-sourhog-foot-in-the-player-s-inventory");
      return;
    }
    player.moveTo(new Location(CAVE_LANDING_TILE.x, CAVE_LANDING_TILE.y, 0));
  }

  function climbOut(player) {
    if (quest.getStage(player) === STAGE_SOURHOG_DEAD) {
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-attempting-to-climb-the-rope-after-killing-the-sourhog-but-before-severing-its-foot");
      return;
    }
    player.moveTo(new Location(HOLE_RETURN_TILE.x, HOLE_RETURN_TILE.y, 0));
  }

  function climbOverBlockage(player) {
    const location = player.getLocation();
    const north = location.getY() > BLOCKAGE_Y;
    const destination = new Location(
      Math.min(3157, Math.max(3156, location.getX())),
      north ? BLOCKAGE_Y - 1 : BLOCKAGE_Y + 1,
      0
    );
    if (quest.getStage(player) === STAGE_HAS_GOGGLES && !hasBit(player, BIT_STOP_WARNING)) {
      // Warned (once, goggles on): 10587 marks the warning as shown. The
      // pre-goggles crossing below never sets it.
      setBit(player, BIT_STOP_WARNING);
      blockageDestination.set(player, destination);
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-climbing-the-blockage");
      return;
    }
    climbBlockage(player, destination);
  }

  function startFootTranscript(player, action) {
    if (quest.getStage(player) < STAGE_SOURHOG_DEAD) return;
    footAction.set(player, action);
    startTranscript(api, player, SARAH_NPC_ID, PAGE, "the-sourhog-taking-the-sourhog-s-foot");
    footAction.delete(player);
  }

  /**
   * The skeleton cutscene via the NpcDialogues runtime so each speaker keeps their
   * chathead; the wiki's note-interface marker ("unavailable") would otherwise end
   * the conversation, so it is dropped.
   */
  function startSkeletonCutscene(player) {
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npcId: PIG_THING_NPC_ID,
      variant: "inside-the-cave-investigating-the-skeleton",
      select: (steps) => steps.filter((step) => step.type !== "unavailable"),
    });
  }

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    if (clickType !== 1 || !QUEST_OBJECT_IDS.has(objectId)) return;
    switch (objectId) {
      case NOTICE_BOARD_OBJECT_ID:
        event.handled = true;
        handleNoticeBoard(player);
        return;
      case DAMAGED_CART_OBJECT_ID:
        event.handled = true;
        investigateTrail(player, "investigating-the-crossroads-damaged-cart");
        return;
      case CABBAGE_OBJECT_ID:
        event.handled = true;
        investigateTrail(player, "investigating-the-crossroads-cabbages");
        return;
      case POTATOES_OBJECT_ID:
        event.handled = true;
        investigateTrail(player, "investigating-the-crossroads-potatoes");
        return;
      case CARROT_OBJECT_ID:
        event.handled = true;
        investigateTrail(player, "investigating-the-crossroads-carrots");
        return;
      case BROKEN_TREE_OBJECT_ID:
        event.handled = true;
        investigateTrail(player, "investigating-the-crossroads-broken-dead-tree");
        return;
      case STRANGE_HOLE_OBJECT_ID:
        // Registered as 40309, so this only fires if the untied loc is ever present.
        event.handled = true;
        if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
        if (clickType === 2 && isRopeTied(player)) {
          climbDownHole(player);
          return;
        }
        startHoleTranscript(player);
        return;
      case STRANGE_HOLE_ROPE_OBJECT_ID:
        event.handled = true;
        if (quest.getStage(player) < STAGE_STARTED) return;
        if (!isRopeTied(player) && !quest.isComplete(player)) {
          startHoleTranscript(player);
          return;
        }
        climbDownHole(player);
        return;
      case PILE_OF_ROPE_OBJECT_ID:
        event.handled = true;
        if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
        startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "inside-the-cave-investigating-pile-of-rope");
        return;
      case SKELETON_OBJECT_ID:
        event.handled = true;
        if (quest.getStage(player) !== STAGE_FOUND_CAVE) return;
        startSkeletonCutscene(player);
        return;
      case CAVE_ROPE_OBJECT_ID:
        event.handled = true;
        climbOut(player);
        return;
      case BLOCKAGE_OBJECT_ID:
        event.handled = true;
        climbOverBlockage(player);
        return;
      case DEAD_SOURHOG_OBJECT_ID:
        event.handled = true;
        startFootTranscript(player, "cut");
        return;
      default:
        return;
    }
  }

  /** Rope on either hole form, or any item on the dead sourhog. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (
      (objectId === STRANGE_HOLE_OBJECT_ID || objectId === STRANGE_HOLE_ROPE_OBJECT_ID)
      && itemId === ROPE_ITEM_ID
    ) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
      if (isRopeTied(player)) return;
      startHoleTranscript(player);
      return;
    }
    if (objectId !== DEAD_SOURHOG_OBJECT_ID) return;
    event.handled = true;
    startFootTranscript(player, itemId);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I read a bounty notice in Draynor Village and agreed to help</str>",
        "<str>Sarah with the monster that attacked her.</str>",
        "<str>I tracked the Sourhog to its lair, killed it wearing Spria's</str>",
        "<str>reinforced goggles and collected Sarah's bounty.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "<str>I read a bounty notice in Draynor Village offering a reward</str>",
        "<str>for dealing with a monster that attacked Sarah.</str>",
        "",
      ];
      if (stage < STAGE_TALKED_SARAH) {
        lines.push("I should speak to <col=800000>Sarah</col> at the <col=800000>South Falador Farm</col>.");
      } else if (stage < STAGE_FOUND_CAVE) {
        lines.push("I should investigate the <col=800000>damaged cart</col> north-east of");
        lines.push("<col=800000>Draynor Village</col> and follow the trail it left behind.");
      } else if (stage < STAGE_ATTACKED) {
        lines.push("I found a <col=800000>strange hole</col>; I should climb into the");
        lines.push("cave and search for the monster.");
      } else if (stage < STAGE_HAS_GOGGLES) {
        lines.push("I should speak to <col=800000>Spria</col> in her house in Draynor Village.");
      } else if (stage < STAGE_SOURHOG_DEAD) {
        lines.push("Wearing the <col=800000>reinforced goggles</col>, I should return to");
        lines.push("the cave and kill the <col=800000>Sourhog</col>.");
      } else if (stage < STAGE_HAS_FOOT) {
        lines.push("I should cut a foot from the dead <col=800000>Sourhog</col> as proof.");
      } else if (stage < STAGE_BOUNTY_COLLECTED) {
        lines.push("I should show the <col=800000>sourhog foot</col> to <col=800000>Sarah</col>.");
      } else {
        lines.push("I should tell <col=800000>Spria</col> that the monster has been dealt with.");
      }
      return lines;
    }
    return [
      "I can start this quest by checking the <col=800000>notice board</col>",
      "in <col=800000>Draynor Village</col>, behind the wine shop.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantRewards(player) {
    player.getSkillManager().addExperiences(Skill.SLAYER, SLAYER_XP_REWARD);
    api.emitCustomEvent("slayer:grant-points", { player, points: SLAYER_POINTS_REWARD });
  }

  // ==========================================================================
  // Login / zones
  // ==========================================================================

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureBrokenSpawns();
    installQuestObjects();
    if (inCaveZone(player)) {
      ensureScimitar(player);
      ensureSourhog(player);
    }
  }

  function handleZoneEnter({ player }) {
    ensureBrokenSpawns();
    installQuestObjects();
    if (inCaveZone(player)) {
      ensureScimitar(player);
      ensureSourhog(player);
    }
  }

  function handlePlayerGone({ player }) {
    if (player) removeSourhog(player);
  }

  quest = registerQuest(api, {
    key: "a_porcine_of_interest",
    name: "A Porcine of Interest",
    varpId: VARP_PORCINE,
    varbitId: VARBIT_PORCINE_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.SLAYER.getIndex(), amount: SLAYER_XP_REWARD, label: "Slayer" }],
    scrollItemId: COINS_ITEM_ID,
    rewardItemLabel: "5,000 Coins",
    otherRewards: [`${SLAYER_POINTS_REWARD} Slayer reward points`],
    buildJournal,
    onReward: grantRewards,
  });

  itemOnGroundManager = api.getItemOnGroundManager();
  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(ROPE_TIED_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(SURFACE_ZONE, handleZoneEnter);
  api.onZoneEnter(CAVE_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handlePlayerGone);
  api.onPlayerDeath(handlePlayerGone);
};
