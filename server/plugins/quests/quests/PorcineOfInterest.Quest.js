/** A Porcine of Interest. Capture 1693 and remaining limits: docs/p2p-skilling-parity.md. */
module.exports = function registerPorcineOfInterestQuest(api) {
  const {
    CombatMethod,
    CombatType,
    PendingHit,
    Projectile,
    Misc,
    Animation,
    Boundary,
    PrivateArea,
    Task,
    TaskManager,
    Graphic,
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
  const QUEST_SOURHOG_NPC_ID = NpcIdentifiers.SOURHOG_2; // 10436 (wiki monster id)
  const PIG_THING_NPC_ID = NpcIdentifiers.PIG_THING; // 10437, cutscene speaker

  const SOURHOG_ATTACK = { melee: 8769, spit: 8770, projectile: 1817, impact: 1818, meleeSound: 2314, spitSound: 2313, impactSound: 3308 };

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
  const DEAD_SOURHOG_MULTILOC_ID = 40349; // porcine_dead_sourhog_multi2, footcut varbit morph
  const QUEST_MULTILOC_IDS = new Map([[ObjectIdentifiers.DEAD_SOURHOG_2, DEAD_SOURHOG_OBJECT_ID], [ObjectIdentifiers.DEAD_SOURHOG_3, DEAD_SOURHOG_OBJECT_ID], [ObjectIdentifiers.DEAD_SOURHOG_4, DEAD_SOURHOG_OBJECT_ID], [40341, STRANGE_HOLE_OBJECT_ID], [40342, CABBAGE_OBJECT_ID], [40343, POTATOES_OBJECT_ID], [40344, CARROT_OBJECT_ID], [40345, BROKEN_TREE_OBJECT_ID], [40346, DAMAGED_CART_OBJECT_ID], [40348, DEAD_SOURHOG_OBJECT_ID], [40349, DEAD_SOURHOG_OBJECT_ID], [40350, SKELETON_OBJECT_ID], [40352, PILE_OF_ROPE_OBJECT_ID]]);

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

  const CORPSE_ATTRIBUTE = "a-porcine-of-interest:corpse";
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

  const SCIMITAR_TILE = { x: 3163, y: 9675 };
  const CAVE_LANDING_TILE = { x: 3158, y: 9713 };
  const HOLE_RETURN_TILE = { x: 3149, y: 3347 };
  const SOURHOG_SPAWN_TILE = { x: 3162, y: 9699 };
  const SPRIA_HOUSE_TILE = { x: 3095, y: 3267 };
  /** The blockage spans x3156-3157 at y9704 (loc dump). */
  const BLOCKAGE_Y = 9704;

  const SURFACE_ZONE = { minX: 3075, maxX: 3170, minY: 3235, maxY: 3360, levels: [0] };
  const CAVE_ZONE = { minX: 3130, maxX: 3200, minY: 9650, maxY: 9740, levels: [0] };

  let quest;
  let itemOnGroundManager = null;

  /** Transient branch context (never persisted). */
  const footAction = new WeakMap();
  const blockageDestination = new WeakMap();
  const bossByPlayer = new Map();
  const corpseByPlayer = new Map();
  const caves = new WeakMap();
  const notes = new WeakSet();
  const SKELETON_VARIANT = "inside-the-cave-investigating-the-skeleton";
  const NOTE_GROUP = 222;
  const NOTE_LINES = ["", "", "This is what I get for exploring uncharted caves.", "Looks like I'm trapped down here - My entry", "rope slipped off and now there's nowhere to go", "but deeper. I think I'd be safer just waiting and", "praying for rescue. If anyone finds this, get out", "while you can.", "", "", ""];

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

  /** The side bits live in varp 2748 beside the stage varbit; login must resend them. */
  function syncBits(player) {
    for (const [bit, varbit] of VARBIT_BY_BIT) {
      player.getPacketSender().sendVarbit(varbit, hasBit(player, bit) ? 1 : 0);
    }
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
      return (player.getBanks?.() ?? [player.getBank?.()]).some(bank => Number(bank?.getAmount?.(REINFORCED_GOGGLES_ITEM_ID) ?? 0) > 0);
    } catch {
      return false;
    }
  }

  function hasSlayerTask(player) {
    const request = { player, line: null };
    api.emitCustomEvent("slayer:task-tip", request);
    return typeof request.line === "string" && request.line.length > 0;
  }

  function hasSlayerUnlock(player, name) {
    const request = { player, name, unlocked: false };
    api.emitCustomEvent("slayer:has-unlock", request);
    return request.unlocked === true;
  }

  function inCaveZone(player) {
    const location = player.getLocation();
    return location.getZ() === 0
      && location.getX() >= CAVE_ZONE.minX && location.getX() <= CAVE_ZONE.maxX
      && location.getY() >= CAVE_ZONE.minY && location.getY() <= CAVE_ZONE.maxY;
  }

  // Captured cave scenes and recovery.
  function liveStage(stage) { return [0, 5, 10, 15, 20, 25, 30, 30, 35, 40][stage] ?? 0; }

  function later(key, ticks, callback) {
    class PorcineTask extends Task {
      constructor() { super(ticks, key, false); }
      execute() { this.stop(); callback(); }
    }
    TaskManager.submit(new PorcineTask());
  }

  function controls(player, active) {
    player.getMovementQueue().setBlockMovement(active);
    player.setUntargetable(active);
    player.getPacketSender().sendVarbit(6719, active ? 2 : 0).sendVarbit(12393, active ? 1 : 0);
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface((161 << 16) | 1, 174, 1)
      .sendString("", (174 << 16) | 4).sendClientScript(948, [0, out ? 255 : 0, 0, out ? 0 : 255, 50]);
  }

  class SourhogCave extends PrivateArea {
    constructor(player) { super([new Boundary(CAVE_ZONE.minX, CAVE_ZONE.maxX, CAVE_ZONE.minY, CAVE_ZONE.maxY, 0)]); this.owner = player; this.scene = false; }
    canTeleport() { return this.scene ? false : null; }
    canAttack() { return this.scene ? false : null; }
    postLeave(mobile, logout) {
      if (mobile === this.owner) {
        caves.delete(mobile); notes.delete(mobile); TaskManager.cancelTasks(this);
        removeSourhog(mobile); corpseByPlayer.delete(mobile);
        controls(mobile, false); mobile.getPacketSender().sendCameraReset();
        mobile.performAnimation(new Animation(-1));
      }
      super.postLeave(mobile, logout);
    }
  }

  function enterCave(player) {
    let cave = caves.get(player);
    if (!cave || cave.isDestroyed()) { cave = new SourhogCave(player); caves.set(player, cave); cave.enter(player); }
    return cave;
  }

  function actor(player, id, x, y) {
    const npc = api.spawnNpc({ id, x, y, z: 0, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (npc) enterCave(player).add(npc);
    return npc;
  }

  function camera(player, move, look) {
    const sender = player.getPacketSender();
    if (move) sender.sendCameraMoveTo(...move.slice(0, 3), { rate: move[3], rate2: move[4] });
    if (look) sender.sendCameraLookAt(...look.slice(0, 3), { rate: look[3], rate2: look[4] });
  }

  function continueSkeleton(player, after) {
    startTranscript(api, player, PIG_THING_NPC_ID, PAGE, SKELETON_VARIANT,
      steps => steps.slice(steps.findIndex(step => step.id === after) + 1));
  }

  function showSkeletonNote(player) {
    player.getDialogueManager().reset(); notes.add(player);
    const sender = player.getPacketSender().sendInterface(NOTE_GROUP);
    const chatbox = sender.getChatboxGroupId();
    if (chatbox >= 0) sender.closeInterface(chatbox);
    NOTE_LINES.forEach((line, index) => sender.sendString(line, (NOTE_GROUP << 16) | (index + 1)));
  }

  function noteClosed({ player, interfaceId }) {
    if (interfaceId !== NOTE_GROUP || !notes.has(player)) return;
    notes.delete(player); const cave = enterCave(player); cave.scene = true; controls(player, true);
    player.moveTo(new Location(3165, 9676, 0));
    camera(player, [3168, 9672, 500, 10, 10], [3165, 9676, 50, 232, 232]);
    later(cave, 1, () => continueSkeleton(player, "K_pMcL"));
  }

  function pigAppears(player) {
    const cave = enterCave(player); player.getDialogueManager().reset();
    cave.pig = actor(player, PIG_THING_NPC_ID, 3171, 9676);
    cave.pig?.setPositionToFace?.(new Location(3165, 9676, 0));
    later(cave, 1, () => { camera(player, [3162, 9676, 200, 232, 232]); camera(player, [3162, 9676, 400, 1, 2]); });
    later(cave, 2, () => cave.pig?.getMovementQueue().addSteps(new Location(3167, 9676, 0)));
    later(cave, 6, () => camera(player, null, [3167, 9676, 100, 1, 1]));
    later(cave, 13, () => { player.performAnimation(new Animation(857)); continueSkeleton(player, "eShaqt"); });
  }

  function pigAttack(player) {
    const cave = enterCave(player); player.getDialogueManager().reset();
    camera(player, [3166, 9681, 500, 10, 10], [3166, 9676, 100, 10, 10]);
    later(cave, 1, () => {
      cave.pig?.performAnimation(new Animation(8770, 20));
      player.performAnimation(new Animation(4177, 66)); player.performGraphic(new Graphic(1818, 86, 20));
      player.getPacketSender().sendProjectile(new Location(3167, 9676, 0), new Location(3165, 9676, 0), 0, 86, 1817, 43, 45, player, 77, 16, 64, cave.pig);
      player.getPacketSender().sendSoundEffect(2313, 1, 77).sendSoundEffect(3308, 1, 86);
    });
    later(cave, 5, () => player.performAnimation(new Animation(836)));
    later(cave, 7, () => fade(player, true));
    later(cave, 15, () => player.getPacketSender().sendString("Some time passes...", (229 << 16) | 1));
    later(cave, 20, () => { if (cave.pig) api.removeNpc(cave.pig); player.moveTo(new Location(3163, 9699, 0)); player.performAnimation(new Animation(-1)); });
    later(cave, 21, () => { camera(player, [3162, 9698, 300, 232, 232], [3163, 9699, 0, 232, 232]); fade(player, false); camera(player, [3162, 9698, 700, 1, 1]); });
    later(cave, 29, () => fade(player, true));
    later(cave, 31, () => { cave.pig = actor(player, PIG_THING_NPC_ID, 3169, 9702); camera(player, [3158, 9705, 800, 232, 232], [3166, 9700, 50, 232, 232]); fade(player, false); });
    later(cave, 36, () => cave.pig?.getMovementQueue().addSteps(new Location(3164, 9701, 0)));
    later(cave, 45, () => player.getPacketSender().sendSoundEffect(694, 1, 0));
    for (const [tick, x, y] of [[47,3165,9700],[48,3165,9699],[49,3165,9698],[50,3165,9697],[51,3165,9696],[52,3165,9695],[54,3166,9694],[55,3167,9693],[56,3168,9692],[57,3169,9691],[58,3170,9690],[59,3171,9689],[60,3172,9689]]) {
      later(cave, tick, () => cave.pig?.getMovementQueue().addSteps(new Location(x, y, 0)));
    }
    later(cave, 53, () => { camera(player, [3167, 9693, 375, 232, 232], [3163, 9699, 200, 232, 232]); camera(player, [3167, 9693, 900, 5, 10], [3163, 9699, 1, 5, 1]); });
    later(cave, 56, () => continueSkeleton(player, "OnSUD-"));
  }

  function spriaArrives(player) {
    const cave = enterCave(player); player.getDialogueManager().reset();
    later(cave, 2, () => { cave.spria = actor(player, NpcIdentifiers.SPRIA_2, 3158, 9710); cave.spria?.getMovementQueue().addSteps(new Location(3157, 9705, 0)); });
    later(cave, 3, () => camera(player, [3159, 9714, 600, 232, 232], [3157, 9705, 50, 232, 232]));
    later(cave, 8, () => { cave.spria?.moveTo(new Location(3157, 9703, 0)); cave.spria?.performAnimation(new Animation(840, 30)); camera(player, [3156, 9694, 800, 232, 232], [3158, 9701, 50, 232, 232]); player.getPacketSender().sendSoundEffect(2453, 1, 40); });
    later(cave, 12, () => cave.spria?.getMovementQueue().addSteps(new Location(3158, 9701, 0)));
    later(cave, 16, () => continueSkeleton(player, "32r40G"));
  }

  function spriaApproaches(player) {
    const cave = enterCave(player); player.getDialogueManager().reset();
    later(cave, 1, () => camera(player, null, [3162, 9699, 50, 2, 1]));
    later(cave, 2, () => cave.spria?.getMovementQueue().addSteps(new Location(3162, 9699, 0)));
    later(cave, 6, () => continueSkeleton(player, "Rb2zDN"));
  }

  function wakeInHouse(player) {
    const cave = caves.get(player); player.getDialogueManager().reset();
    later(cave, 1, () => { cave?.spria?.performAnimation(new Animation(827)); fade(player, true); });
    later(cave, 4, () => {
      advanceStage(player, STAGE_ATTACKED); if (cave) cave.leave(player, false);
      player.moveTo(new Location(SPRIA_HOUSE_TILE.x, SPRIA_HOUSE_TILE.y, 0)); fade(player, false);
      later(player, 2, () => player.getPacketSender().closeSubInterface((161 << 16) | 1));
      continueSkeleton(player, "EaeUfj");
    });
  }

  function restoreCorpse(player) {
    if (![STAGE_SOURHOG_DEAD, STAGE_HAS_FOOT].includes(quest.getStage(player)) || corpseByPlayer.has(player)) return;
    const at = player.getAttribute(CORPSE_ATTRIBUTE) ?? [SOURHOG_SPAWN_TILE.x, SOURHOG_SPAWN_TILE.y, 0];
    registerDeadSourhog(player, { x: at[0], y: at[1], z: at[2] });
  }

  function isRopeTied(player) { return quest.getStage(player) >= STAGE_FOUND_CAVE; }
  function tieRope(player) {
    if (isRopeTied(player) || !held(player, ROPE_ITEM_ID)) return;
    player.getInventory().deleteNumber(ROPE_ITEM_ID, 1); player.performAnimation(new Animation(832));
    advanceStage(player, STAGE_FOUND_CAVE); player.setAttribute(ROPE_TIED_ATTRIBUTE, true);
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
    if (itemOnGroundManager.getGroundItem(player.getUsername(), BRONZE_SCIMITAR_ITEM_ID, tile, player.getPrivateArea())) {
      return;
    }
    itemOnGroundManager.registerLocation(player, new Item(BRONZE_SCIMITAR_ITEM_ID, 1), tile, player.getPrivateArea());
  }

  class QuestSourhogCombat extends CombatMethod {
    constructor() { super(); this.spit = true; this.flight = 58; }
    type() { return this.spit ? CombatType.RANGED : CombatType.MELEE; }
    attackSpeed() { return 5; }
    attackDistance() { return 7; }
    start(npc, target) {
      const distance = npc.calculateDistance(target);
      // shortcut: four captured attacks do not establish the random style weight; replace it when a longer protected fight is available.
      this.spit = distance > 1 || Misc.randomInclusive(0, 1) === 0;
      npc.performAnimation(new Animation(this.spit ? SOURHOG_ATTACK.spit : SOURHOG_ATTACK.melee));
      const at = npc.getLocation();
      if (!this.spit) {
        target.getPacketSender().sendAreaSound(SOURHOG_ATTACK.meleeSound, at.getX(), at.getY(), at.getZ(), 1, 0, 15);
        return;
      }
      // shortcut: the capture has 58-cycle adjacent and 86-cycle four-tile flights; intermediate distances use the same linear travel rate until captured.
      this.flight = Math.max(58, 46 + distance * 10);
      Projectile.createProjectile(npc, target, SOURHOG_ATTACK.projectile, 57, this.flight, 43, 45)
        .withAngle(16).withProgress(128).sendProjectile();
      target.getPacketSender().sendAreaSound(SOURHOG_ATTACK.spitSound, at.getX(), at.getY(), at.getZ(), 1, 57, 15);
    }
    hits(npc, target) {
      const hit = new PendingHit(npc, target, this, this.spit ? Math.max(1, Math.floor(this.flight / 30)) : 0);
      if (this.spit && hit.isAccurate()) {
        target.performGraphic(new Graphic(SOURHOG_ATTACK.impact, this.flight, 20));
        const at = target.getLocation();
        target.getPacketSender().sendAreaSound(SOURHOG_ATTACK.impactSound, at.getX(), at.getY(), at.getZ(), 1, this.flight, 15);
      }
      return [hit];
    }
  }

  function ensureSourhog(player) {
    if (quest.getStage(player) !== STAGE_HAS_GOGGLES) return;
    if (bossByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: QUEST_SOURHOG_NPC_ID,
      x: SOURHOG_SPAWN_TILE.x,
      y: SOURHOG_SPAWN_TILE.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) { enterCave(player).add(npc); bossByPlayer.set(player, npc); }
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
      DEAD_SOURHOG_MULTILOC_ID,
      new Location((location.x ?? location.getX?.()) | 0, (location.y ?? location.getY?.()) | 0, (location.z ?? location.getZ?.()) | 0),
      10,
      1,
      enterCave(player)
    );
    player.setAttribute(CORPSE_ATTRIBUTE, [corpse.getLocation().getX(), corpse.getLocation().getY(), 0]);
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
        return hasSlayerUnlock(player, "Malevolent Masquerade");
      case "RGQc9A":
        return !hasSlayerTask(player);
      case "B49An4":
        return hasSlayerTask(player);
      // The remaining Spria conditions belong to the Slayer plugin's own
      // standard dialogue (assignment, combat-level checking, ineligible task).
      // Returning null lets that owner answer instead of preempting it here.
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
    player.setAttribute(CORPSE_ATTRIBUTE, null);
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
    if (!SPRIA_NPC_IDS.has(event.npcId) && event.npcId !== PIG_THING_NPC_ID) return;
    if (caves.get(event.player)?.scene && event.step?.speaker === "Spria") event.speakerId = NpcIdentifiers.SPRIA_2;
    const text = String(event.text ?? "");
    if (text.startsWith("Sure, I have another going spare.") && event.player.getInventory().isFull()) {
      event.text = "You'll need to free up some inventory space before I can give you another pair.";
      return;
    }
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
    if (held(player, REINFORCED_GOGGLES_ITEM_ID)) return true;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need some free inventory space to take the goggles.");
      return false;
    }
    player.getInventory().adds(REINFORCED_GOGGLES_ITEM_ID, 1);
    return true;
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
    if (quest.getStage(player) !== STAGE_HAS_FOOT || !held(player, SOURHOG_FOOT_ITEM_ID)) return;
    if (held(player, SOURHOG_FOOT_ITEM_ID)) {
      player.getInventory().deleteNumber(SOURHOG_FOOT_ITEM_ID, 1);
    }
    player.getInventory().adds(COINS_ITEM_ID, 5000);
    quest.setStage(player, STAGE_BOUNTY_COLLECTED);
  }

  function takeFoot(player) {
    if (quest.getStage(player) < STAGE_SOURHOG_DEAD || quest.getStage(player) >= STAGE_BOUNTY_COLLECTED || hasFoot(player)) return false;
    if (player.getInventory().isFull()) return false;
    player.getInventory().adds(SOURHOG_FOOT_ITEM_ID, 1);
    setBit(player, BIT_FOOTCUT);
    quest.setStage(player, STAGE_HAS_FOOT);
    return true;
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
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    if (npcId !== SARAH_NPC_ID && !SPRIA_NPC_IDS.has(npcId) && npcId !== PIG_THING_NPC_ID) return;
    if (kind === "message") {
      if (stepId === "Um0TAs") {
        // The generated success line/box must not render when the foot was refused.
        if (takeFoot(player)) {
          event.box = { items: [SOURHOG_FOOT_ITEM_ID] };
        } else {
          event.text = "You need some free inventory space for the foot.";
          event.box = { statement: true };
        }
        return;
      }
      event.box = { statement: true };
      handleMessageAction(player, stepId);
      return;
    }
    switch (stepId) {
      case "K_pMcL": event.handled = true; showSkeletonNote(player); return;
      case "eShaqt": event.handled = true; pigAppears(player); return;
      case "GiFHeZ": event.handled = true; pigAttack(player); return;
      case "32r40G": event.handled = true; spriaArrives(player); return;
      case "Rb2zDN": event.handled = true; spriaApproaches(player); return;
      case "EaeUfj": event.handled = true; wakeInHouse(player); return;
      case "f8rW5G":
        event.handled = true;
        handleBlockageClimb(player, event.text);
        return;
      case "LFxcPW":
        event.handled = true;
        giveGoggles(player);
        if (held(player, REINFORCED_GOGGLES_ITEM_ID)) advanceStage(player, STAGE_HAS_GOGGLES);
        return;
      case "nT99T5":
        event.handled = true;
        if (!giveGoggles(player)) event.end = true;
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
    if (stage === STAGE_HAS_FOOT && hasFoot(player)) {
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-attempting-to-re-enter-the-sourhog-cave-with-a-sourhog-foot-in-the-player-s-inventory");
      return;
    }
    if (stage < STAGE_COMPLETE) enterCave(player);
    player.moveTo(new Location(CAVE_LANDING_TILE.x, CAVE_LANDING_TILE.y, 0));
    ensureScimitar(player); ensureSourhog(player);
    restoreCorpse(player);
  }

  function climbOut(player) {
    if (quest.getStage(player) === STAGE_SOURHOG_DEAD) {
      startTranscript(api, player, SPRIA_DIALOGUE_NPC_ID, PAGE, "the-sourhog-attempting-to-climb-the-rope-after-killing-the-sourhog-but-before-severing-its-foot");
      return;
    }
    caves.get(player)?.leave(player, false);
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
    if (quest.getStage(player) < STAGE_SOURHOG_DEAD || quest.getStage(player) >= STAGE_BOUNTY_COLLECTED) return;
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
    enterCave(player);
    startTranscript(api, player, PIG_THING_NPC_ID, PAGE, SKELETON_VARIANT);
  }

  function handleObjectInteraction(event) {
    const { player, clickType } = event;
    let objectId = QUEST_MULTILOC_IDS.get(event.objectId) ?? event.objectId;
    if (objectId === STRANGE_HOLE_OBJECT_ID && isRopeTied(player)) objectId = STRANGE_HOLE_ROPE_OBJECT_ID;
    if ((clickType !== 1 && !(clickType === 2 && objectId === STRANGE_HOLE_OBJECT_ID)) || !QUEST_OBJECT_IDS.has(objectId)) return;
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
    const { player, itemId } = event;
    const objectId = QUEST_MULTILOC_IDS.get(event.objectId) ?? event.objectId;
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
    syncBits(player);
    if (inCaveZone(player) && quest.getStage(player) >= STAGE_FOUND_CAVE && !quest.isComplete(player)) {
      enterCave(player); ensureScimitar(player); ensureSourhog(player); restoreCorpse(player);
    }
  }

  function handleBootstrapComplete({ player }) {
    syncBits(player);
  }

  function handleZoneEnter({ player }) {
    if (inCaveZone(player) && quest.getStage(player) >= STAGE_FOUND_CAVE && !quest.isComplete(player)) {
      enterCave(player); ensureScimitar(player); ensureSourhog(player); restoreCorpse(player);
    }
  }

  function keepGogglesEquipped(event) {
    if (event.item.getId() !== REINFORCED_GOGGLES_ITEM_ID || quest.getStage(event.player) !== STAGE_HAS_GOGGLES || !inCaveZone(event.player)) return;
    event.allow = false;
    event.player.sendMessage("You should leave your eye protection on while you're down here with that Sourhog.");
  }

  function handlePlayerGone({ player }) {
    if (player) { const cave = caves.get(player); if (cave) cave.leave(player, true); else removeSourhog(player); }
  }

  quest = registerQuest(api, {
    key: "a_porcine_of_interest",
    name: "A Porcine of Interest",
    varpId: VARP_PORCINE,
    varbitId: VARBIT_PORCINE_STAGE,
    varpValue: liveStage,
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
  api.persistAttribute(CORPSE_ATTRIBUTE, null);
  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(ROPE_TIED_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("interface:closed", noteClosed);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.registerNpcCombatMethodProvider([QUEST_SOURHOG_NPC_ID], QuestSourhogCombat, { singleton: false });
  api.onNpcDeath(handleNpcDeath);
  api.onCanUnequip(keepGogglesEquipped);
  api.onZoneEnter(SURFACE_ZONE, handleZoneEnter);
  api.onZoneEnter(CAVE_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
  api.onPlayerLogout(handlePlayerGone);
  api.onPlayerDeath(handlePlayerGone);
};
