const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { RegionManager } = require("../../src/main/typescript/elvarg/game/collision/RegionManager");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const SESSION_MODE = Object.freeze({
  INVENTORY: "inventory",
  GROUND: "ground",
  TEND: "tend",
});

const TINDERBOX_ID = ItemIds.TINDERBOX;
const FIRE_OBJECT_ID = ObjectIds.FIRE_5;
const CAMPFIRE_OBJECT_ID = ObjectIds.FORESTERS_CAMPFIRE;
const FIRE_OBJECT_TYPE = 10;
const FIRE_OBJECT_FACE = 0;

const LIGHT_FIRE_ANIMATION = new Animation(733);
const CAMPFIRE_ANIMATION = new Animation(896);

// Lighting rolls once per 4-tick attempt; tending a campfire adds a log every 9 ticks.
const LIGHT_ATTEMPT_INTERVAL_TICKS = 4;
const TEND_INTERVAL_TICKS = 9;
const MAX_ACTION_DISTANCE = 25;

// OSRS Wiki (Mod Ash): fires burn 60-119 seconds, independent of the log used.
const FIRE_MIN_LIFETIME_TICKS = 100;
const FIRE_MAX_LIFETIME_TICKS = 198;
// OSRS Wiki: a Forester's Campfire burns for at most 300 ticks (~180 seconds).
const CAMPFIRE_MAX_LIFETIME_TICKS = 300;
// OSRS Wiki: campfires must be at least 5 tiles apart.
const CAMPFIRE_MIN_SPACING_TILES = 5;

// OSRS Wiki making-fires table. Campfire columns are the Forester's Campfire burn table:
// the duration the campfire is set to when that log is first added, and how many ticks each
// further log adds. Jatoba, Camphor, Ironwood and Rosewood burn times are unpublished and are
// interpolated from the tiers around them.
const LIGHTABLE_LOGS = [
  { name: "logs", itemId: ItemIds.LOGS, requiredLevel: 1, xpReward: 40, campfireDurationTicks: 102, campfireBurnTicks: 3 },
  { name: "achey logs", itemId: ItemIds.ACHEY_TREE_LOGS, requiredLevel: 1, xpReward: 40, campfireDurationTicks: 102, campfireBurnTicks: 3 },
  { name: "oak logs", itemId: ItemIds.OAK_LOGS, requiredLevel: 15, xpReward: 60, campfireDurationTicks: 109, campfireBurnTicks: 10 },
  { name: "willow logs", itemId: ItemIds.WILLOW_LOGS, requiredLevel: 30, xpReward: 90, campfireDurationTicks: 116, campfireBurnTicks: 17 },
  { name: "teak logs", itemId: ItemIds.TEAK_LOGS, requiredLevel: 35, xpReward: 105, campfireDurationTicks: 118, campfireBurnTicks: 19 },
  { name: "jatoba logs", itemId: ItemIds.JATOBA_LOGS, requiredLevel: 40, xpReward: 120, campfireDurationTicks: 121, campfireBurnTicks: 21 },
  { name: "arctic pine logs", itemId: ItemIds.ARCTIC_PINE_LOGS, requiredLevel: 42, xpReward: 125, campfireDurationTicks: 121, campfireBurnTicks: 22 },
  { name: "maple logs", itemId: ItemIds.MAPLE_LOGS, requiredLevel: 45, xpReward: 135, campfireDurationTicks: 123, campfireBurnTicks: 24 },
  { name: "mahogany logs", itemId: ItemIds.MAHOGANY_LOGS, requiredLevel: 50, xpReward: 157.5, campfireDurationTicks: 125, campfireBurnTicks: 26 },
  { name: "yew logs", itemId: ItemIds.YEW_LOGS, requiredLevel: 60, xpReward: 202.5, campfireDurationTicks: 130, campfireBurnTicks: 31 },
  { name: "blisterwood logs", itemId: ItemIds.BLISTERWOOD_LOGS, requiredLevel: 62, xpReward: 96, campfireDurationTicks: 131, campfireBurnTicks: 32 },
  { name: "camphor logs", itemId: ItemIds.CAMPHOR_LOGS, requiredLevel: 66, xpReward: 180, campfireDurationTicks: 133, campfireBurnTicks: 34 },
  { name: "magic logs", itemId: ItemIds.MAGIC_LOGS, requiredLevel: 75, xpReward: 303.8, campfireDurationTicks: 137, campfireBurnTicks: 38 },
  { name: "ironwood logs", itemId: ItemIds.IRONWOOD_LOGS, requiredLevel: 80, xpReward: 220.5, campfireDurationTicks: 140, campfireBurnTicks: 40 },
  { name: "redwood logs", itemId: ItemIds.REDWOOD_LOGS, requiredLevel: 90, xpReward: 350, campfireDurationTicks: 144, campfireBurnTicks: 45 },
  { name: "rosewood logs", itemId: ItemIds.ROSEWOOD_LOGS, requiredLevel: 92, xpReward: 268, campfireDurationTicks: 146, campfireBurnTicks: 46 },
];

const LIGHTABLE_LOGS_BY_ID = new Map(
  LIGHTABLE_LOGS.map((log) => [log.itemId, log])
);

// OSRS Wiki pyromancer outfit: hood 0.4%, garb 0.8%, robe 0.6%, boots 0.2%, full set 2.5%.
const PYROMANCER_OUTFIT = [
  { slot: Equipment.HEAD_SLOT, itemIds: [ItemIds.PYROMANCER_HOOD, ItemIds.PYROMANCER_HOOD_2], bonus: 0.004 },
  { slot: Equipment.BODY_SLOT, itemIds: [ItemIds.PYROMANCER_GARB, ItemIds.PYROMANCER_GARB_2], bonus: 0.008 },
  { slot: Equipment.LEG_SLOT, itemIds: [ItemIds.PYROMANCER_ROBE, ItemIds.PYROMANCER_ROBE_2], bonus: 0.006 },
  { slot: Equipment.FEET_SLOT, itemIds: [ItemIds.PYROMANCER_BOOTS, ItemIds.PYROMANCER_BOOTS_2], bonus: 0.002 },
];
const PYROMANCER_SET_BONUS = 0.005;

// OSRS Wiki campfire "Check" tiers, in ticks (0.6s each).
const CAMPFIRE_CHECK_TIERS = [
  { maxTicks: 58, message: "The embers glow softly." },
  { maxTicks: 118, message: "The flames flicker gently." },
  { maxTicks: 178, message: "The fire burns steadily." },
  { maxTicks: 238, message: "The fire burns brightly." },
  { maxTicks: Infinity, message: "The roaring fire crackles invitingly." },
];

let TaskManager;
let ObjectManager;
let ItemOnGroundManager;
let World;
let pluginApi;
let activeSessionsRef = null;
let sessionTick = 0;

// Runtime fires and campfires owned by this plugin, keyed by GameObject instance.
const activeFires = new Map();

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getFiremakingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.FIREMAKING);
}

function canPlayerBurnLog(player, itemId) {
  const log = LIGHTABLE_LOGS_BY_ID.get(itemId);
  if (!player || !log) {
    return false;
  }
  return getFiremakingLevel(player) >= log.requiredLevel;
}

function requiresTinderbox(player) {
  return !(player?.isPlayerBot?.() === true);
}

function isWearing(player, slot, itemIds) {
  const item = player.getEquipment?.()?.getItems?.()[slot];
  return !!item && itemIds.includes(item.getId());
}

function firemakingXpMultiplier(player) {
  const worn = PYROMANCER_OUTFIT.filter((piece) =>
    isWearing(player, piece.slot, piece.itemIds)
  );
  const bonus = worn.reduce((sum, piece) => sum + piece.bonus, 0);
  return 1 + bonus + (worn.length === PYROMANCER_OUTFIT.length ? PYROMANCER_SET_BONUS : 0);
}

// OSRS Wiki success chance: 65/256 at level 1 rising linearly to 513/256 at 99, capped at
// 256/256 (certain) from level 43. Per-level values match the Wiki's chart.
function lightingSuccessChance(level) {
  const effectiveLevel = Math.max(1, Math.min(99, level));
  const successes = Math.min(256, Math.round(65 + ((effectiveLevel - 1) * 448) / 98));
  return successes / 256;
}

function rollFireLifetimeTicks() {
  return randomIntInclusive(FIRE_MIN_LIFETIME_TICKS, FIRE_MAX_LIFETIME_TICKS);
}

function createCampfireTicks(log) {
  return Math.min(CAMPFIRE_MAX_LIFETIME_TICKS, log.campfireDurationTicks);
}

function extendCampfireTicks(remainingTicks, log) {
  return Math.min(CAMPFIRE_MAX_LIFETIME_TICKS, remainingTicks + log.campfireBurnTicks);
}

function campfireCheckMessage(remainingTicks) {
  for (const tier of CAMPFIRE_CHECK_TIERS) {
    if (remainingTicks <= tier.maxTicks) {
      return tier.message;
    }
  }
  return CAMPFIRE_CHECK_TIERS[CAMPFIRE_CHECK_TIERS.length - 1].message;
}

function grantFiremakingLogXp(player, log) {
  const xp = log.xpReward * firemakingXpMultiplier(player);
  player.getSkillManager().addExperiences(Skill.FIREMAKING, xp);
  pluginApi.emitCustomEvent("firemaking:success", { player, skill: Skill.FIREMAKING });
}

function dropAshes(player, location) {
  if (
    !player ||
    typeof player.getUsername !== "function" ||
    typeof player.getPrivateArea !== "function"
  ) {
    return;
  }
  const existingAshes = ItemOnGroundManager.getGroundItem(
    player.getUsername(),
    ItemIds.ASHES,
    location,
    player.getPrivateArea()
  );
  if (!existingAshes) {
    ItemOnGroundManager.registerLocation(player, new Item(ItemIds.ASHES, 1), location);
  }
}

function stopFiremaking(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

function createFireState(object, ownerPlayer) {
  return {
    object,
    location: object.getLocation(),
    privateArea: object.getPrivateArea(),
    ownerPlayer,
    remainingTicks: rollFireLifetimeTicks(),
    campfire: false,
    baseObject: null,
  };
}

function createCampfireObject(location, privateArea) {
  return new GameObject(
    CAMPFIRE_OBJECT_ID,
    location.clone(),
    FIRE_OBJECT_TYPE,
    FIRE_OBJECT_FACE,
    privateArea
  );
}

function findNearbyCampfire(location, privateArea, ignoredObject) {
  for (const state of activeFires.values()) {
    if (!state.campfire || state.object === ignoredObject || state.privateArea !== privateArea) {
      continue;
    }
    const other = state.location;
    if (other.getZ() !== location.getZ()) {
      continue;
    }
    const dx = Math.abs(other.getX() - location.getX());
    const dy = Math.abs(other.getY() - location.getY());
    if (Math.max(dx, dy) <= CAMPFIRE_MIN_SPACING_TILES) {
      return state;
    }
  }
  return null;
}

/**
 * A floor decoration (shape 22) only blocks a fire tile when its clip type says
 * so. Tutorial Island's grass tufts are shape 22 and walkable, so they don't
 * stop a fire; everything else (scenery, an existing fire) still does.
 */
function blocksFireTile(object) {
  if (!object) {
    return false;
  }
  if (object.getType?.() === 22) {
    return object.getDefinition?.()?.isClippedDecoration?.() === true;
  }
  return true;
}

function hasObjectAtLocation(location, privateArea) {
  if (privateArea) {
    const instanced = privateArea.getObjects?.() ?? [];
    if (instanced.some((object) => object.getLocation().equals(location) && blocksFireTile(object))) {
      return true;
    }
  }
  RegionManager.loadMapFiles(location.getX(), location.getY());
  const hash = MapObjects.getHash(location.getX(), location.getY(), location.getZ());
  const objects = MapObjects.mapObjects.get(hash) ?? [];
  return objects.some((object) => object.getLocation().equals(location) && blocksFireTile(object));
}

function isFireTileBlocked(location, privateArea) {
  // The tile's runtime objects only (ObjectManager indexes them), not every one in the world.
  const worldBlocked = ObjectManager.objectsAt(location).some(blocksFireTile);
  return worldBlocked || hasObjectAtLocation(location, privateArea);
}

function canLightFireAt(player, location, privateArea) {
  if (!location) {
    return false;
  }
  if (isFireTileBlocked(location, privateArea ?? player.getPrivateArea())) {
    const handled = pluginApi.emitFiremakingBlocked({
      player,
      location: {
        x: location.getX(),
        y: location.getY(),
        z: location.getZ(),
      },
      reason: "tile_blocked",
      handled: false,
    });
    if (!handled) {
      player.sendMessage("You cannot light a fire here. Try moving around a bit.");
    }
    return false;
  }
  return true;
}

function stepAwayFromFire(player) {
  const queue = player.getMovementQueue();
  if (!queue) {
    return;
  }

  if (queue.canWalk(-1, 0)) {
    queue.walkStep(-1, 0);
    return;
  }
  if (queue.canWalk(1, 0)) {
    queue.walkStep(1, 0);
    return;
  }
  if (queue.canWalk(0, -1)) {
    queue.walkStep(0, -1);
    return;
  }
  if (queue.canWalk(0, 1)) {
    queue.walkStep(0, 1);
  }
}

function spawnFire(player, location) {
  const fire = new GameObject(
    FIRE_OBJECT_ID,
    location.clone(),
    FIRE_OBJECT_TYPE,
    FIRE_OBJECT_FACE,
    player.getPrivateArea()
  );
  ObjectManager.register(fire, true);
  activeFires.set(fire, createFireState(fire, player));
  if (player.getLocation().equals(location)) {
    stepAwayFromFire(player);
  }
  return fire;
}

function processFires() {
  for (const [object, state] of activeFires) {
    state.remainingTicks--;
    if (state.remainingTicks > 0) {
      continue;
    }
    activeFires.delete(object);
    // Instanced (private area) objects stay in the area's entity list after deregister, so
    // MapObjects.exists keeps reporting them; sessions check this flag instead.
    state.expired = true;
    ObjectManager.deregister(object, true);
    if (state.baseObject) {
      ObjectManager.register(state.baseObject, true);
      continue;
    }
    dropAshes(state.ownerPlayer, state.location);
  }
}

function startFiremakingAttempt(player, log, source, activeSessions) {
  if (!player || !log || !source) {
    return false;
  }

  if (player.getForceMovement() != null) {
    return false;
  }

  if (getFiremakingLevel(player) < log.requiredLevel) {
    player.sendMessage(
      `You need a Firemaking level of at least ${log.requiredLevel} to light those logs.`
    );
    return false;
  }

  const inventory = player.getInventory();
  if (requiresTinderbox(player) && !inventory.contains(TINDERBOX_ID)) {
    player.sendMessage("You need a tinderbox to light fires.");
    return false;
  }

  let sessionLocation;
  let privateArea = player.getPrivateArea();

  if (source.mode === SESSION_MODE.INVENTORY) {
    sessionLocation = player.getLocation().clone();
    if (!inventory.contains(log.itemId)) {
      player.sendMessage("You've run out of logs.");
      return false;
    }
    if (!canLightFireAt(player, sessionLocation, privateArea)) {
      return false;
    }
  } else if (source.mode === SESSION_MODE.GROUND) {
    sessionLocation = source.location?.clone?.();
    privateArea = source.privateArea ?? privateArea;
    if (!sessionLocation) {
      return false;
    }
    const existingGroundLog = ItemOnGroundManager.getGroundItem(
      player.getUsername(),
      log.itemId,
      sessionLocation,
      privateArea
    );
    if (!existingGroundLog) {
      return false;
    }
  } else {
    return false;
  }

  player.getSkillManager()?.stopSkillable?.();
  stopFiremaking(activeSessions, player, false);

  activeSessions.set(player, {
    mode: source.mode,
    log,
    location: sessionLocation,
    privateArea,
    nextActionTick: sessionTick + LIGHT_ATTEMPT_INTERVAL_TICKS,
  });

  player.sendMessage("You attempt to light the logs..");
  // No explicit FIRE_LIGHT here: animation 733 has sound 2597 baked into
  // frames 8 and 10 in the cache, so sending it too made lighting a fire
  // play three overlapping "strike" sounds instead of one.
  player.performAnimation(LIGHT_FIRE_ANIMATION);
  return true;
}

function startTendFire(player, log, object, activeSessions) {
  if (!player || !log || !object) {
    return false;
  }

  if (player.getForceMovement() != null) {
    return false;
  }

  if (getFiremakingLevel(player) < log.requiredLevel) {
    player.sendMessage(
      `You need a Firemaking level of at least ${log.requiredLevel} to light those logs.`
    );
    return false;
  }

  if (!player.getInventory().contains(log.itemId)) {
    player.sendMessage("You've run out of logs.");
    return false;
  }

  if (!player.getLocation().isWithinInteractionDistance(object.getLocation())) {
    return false;
  }

  player.getSkillManager()?.stopSkillable?.();
  stopFiremaking(activeSessions, player, false);

  activeSessions.set(player, {
    mode: SESSION_MODE.TEND,
    log,
    object,
    fireState: activeFires.get(object) ?? null,
    location: object.getLocation().clone(),
    privateArea: object.getPrivateArea(),
    nextActionTick: sessionTick + TEND_INTERVAL_TICKS,
  });

  player.sendMessage("You attempt to add the logs to the fire.");
  player.performAnimation(CAMPFIRE_ANIMATION);
  Sounds.sendSound(player, Sound.FIRE_LIGHT);
  return true;
}

function completeInventoryOrGroundFire(player, state) {
  if (!canLightFireAt(player, state.location, state.privateArea)) {
    return false;
  }

  if (state.mode === SESSION_MODE.INVENTORY) {
    if (!player.getInventory().contains(state.log.itemId)) {
      player.sendMessage("You've run out of logs.");
      return false;
    }
    player.getInventory().deleteNumber(state.log.itemId, 1);
  } else {
    const groundLog = ItemOnGroundManager.getGroundItem(
      player.getUsername(),
      state.log.itemId,
      state.location,
      state.privateArea
    );
    if (!groundLog) {
      return false;
    }
    ItemOnGroundManager.deregister(groundLog);
  }

  spawnFire(player, state.location);
  grantFiremakingLogXp(player, state.log);
  Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
  player.sendMessage("The logs catch fire and begin to burn.");
  return true;
}

function convertFireToCampfire(fireObject, state) {
  const campfire = createCampfireObject(state.location, state.privateArea);
  ObjectManager.deregister(fireObject, true);
  ObjectManager.register(campfire, true);
  activeFires.delete(fireObject);
  state.object = campfire;
  state.campfire = true;
  activeFires.set(campfire, state);
  return state;
}

function extendCampfire(player, session, log) {
  let state = session.fireState;
  if (state && state.object === session.object) {
    if (!state.campfire) {
      state = convertFireToCampfire(session.object, state);
      session.fireState = state;
      session.object = state.object;
      state.remainingTicks = Math.max(state.remainingTicks, createCampfireTicks(log));
      return;
    }
    state.remainingTicks = extendCampfireTicks(state.remainingTicks, log);
    return;
  }

  // A permanent fire is not tracked yet: replace it with a player-fed campfire that is
  // restored to its original fire once the campfire burns out.
  const baseObject = session.object;
  ObjectManager.deregister(baseObject, true);
  const campfire = createCampfireObject(baseObject.getLocation(), baseObject.getPrivateArea());
  ObjectManager.register(campfire, true);
  state = createFireState(campfire, null);
  state.campfire = true;
  state.baseObject = baseObject;
  state.remainingTicks = createCampfireTicks(log);
  activeFires.set(campfire, state);
  session.fireState = state;
  session.object = campfire;
}

function tendFire(player, session, activeSessions) {
  const log = session.log;
  const object = session.object;
  if (!object || session.fireState?.expired || !MapObjects.exists(object)) {
    stopFiremaking(activeSessions, player);
    return;
  }
  if (!player.getInventory().contains(log.itemId)) {
    stopFiremaking(activeSessions, player);
    return;
  }
  if (!player.getLocation().isWithinInteractionDistance(object.getLocation())) {
    stopFiremaking(activeSessions, player);
    return;
  }

  const converting = !session.fireState || !session.fireState.campfire;
  if (converting && findNearbyCampfire(object.getLocation(), object.getPrivateArea(), object)) {
    player.sendMessage(
      "There's a Forester's Campfire nearby, help tend to that one or move further away."
    );
    stopFiremaking(activeSessions, player);
    return;
  }

  player.getInventory().deleteNumber(log.itemId, 1);
  player.performAnimation(CAMPFIRE_ANIMATION);
  Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
  grantFiremakingLogXp(player, log);
  player.sendMessage("You add a log to the fire.");
  extendCampfire(player, session, log);
}

function processFiremakingTick(activeSessions, currentTick) {
  for (const [player, session] of activeSessions) {
    if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
      activeSessions.delete(player);
      continue;
    }

    if (player.getForceMovement() != null) {
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (player.getMovementQueue()?.size?.() > 0) {
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (!player.getLocation().isWithinInteractionDistance(session.location)) {
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (getFiremakingLevel(player) < session.log.requiredLevel) {
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (session.mode === SESSION_MODE.TEND) {
      if (currentTick < session.nextActionTick) {
        continue;
      }
      session.nextActionTick = currentTick + TEND_INTERVAL_TICKS;
      tendFire(player, session, activeSessions);
      continue;
    }

    if (requiresTinderbox(player) && !player.getInventory().contains(TINDERBOX_ID)) {
      player.sendMessage("You need a tinderbox to light fires.");
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (session.mode === SESSION_MODE.GROUND) {
      const groundLog = ItemOnGroundManager.getGroundItem(
        player.getUsername(),
        session.log.itemId,
        session.location,
        session.privateArea
      );
      if (!groundLog) {
        stopFiremaking(activeSessions, player);
        continue;
      }
    }

    if (currentTick < session.nextActionTick) {
      continue;
    }

    player.performAnimation(LIGHT_FIRE_ANIMATION);
    if (Math.random() >= lightingSuccessChance(getFiremakingLevel(player))) {
      session.nextActionTick = currentTick + LIGHT_ATTEMPT_INTERVAL_TICKS;
      continue;
    }

    completeInventoryOrGroundFire(player, session);
    stopFiremaking(activeSessions, player);
  }
}

class FiremakingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
  }

  execute() {
    sessionTick++;
    processFiremakingTick(this.activeSessions, sessionTick);
    processFires();
  }
}

function handleItemOnItem(event, activeSessions) {
  const { player, usedItemId, usedWithItemId } = event;
  // Mirror legacy item-on-item behavior: every item-combine attempt clears
  // the client's selected-item state and interrupts active skilling.
  // If we only do this for firemaking combos, the client can remain stuck
  // in "Use item ->" mode and subsequent item selection appears broken.
  player.getPacketSender().sendInterfaceRemoval();
  player.getSkillManager()?.stopSkillable?.();

  let logId = -1;
  if (usedItemId === TINDERBOX_ID) {
    logId = usedWithItemId;
  } else if (usedWithItemId === TINDERBOX_ID) {
    logId = usedItemId;
  }

  if (logId <= 0) {
    return;
  }

  const log = LIGHTABLE_LOGS_BY_ID.get(logId);
  if (!log) {
    return;
  }

  const started = startFiremakingAttempt(
    player,
    log,
    { mode: SESSION_MODE.INVENTORY },
    activeSessions
  );
  if (started) {
    event.handled = true;
  }
}

function handleItemOnGroundItem(event, activeSessions) {
  const { player, inventoryItemId, groundItemId, location } = event;
  if (inventoryItemId !== TINDERBOX_ID) {
    return;
  }

  const log = LIGHTABLE_LOGS_BY_ID.get(groundItemId);
  if (!log) {
    return;
  }

  if (
    Math.abs(player.getLocation().getX() - location.x) > MAX_ACTION_DISTANCE ||
    Math.abs(player.getLocation().getY() - location.y) > MAX_ACTION_DISTANCE
  ) {
    player.getMovementQueue().reset();
    return;
  }

  const position = new Location(location.x, location.y, location.z);
  player.getMovementQueue().walkToGroundItem(position, () => {
    const groundItem = ItemOnGroundManager.getGroundItem(
      player.getUsername(),
      groundItemId,
      position,
      player.getPrivateArea()
    );
    if (!groundItem) {
      return;
    }

    player.setPositionToFace(position);
    startFiremakingAttempt(
      player,
      log,
      {
        mode: SESSION_MODE.GROUND,
        location: position,
        privateArea: player.getPrivateArea(),
      },
      activeSessions
    );
    event.handled = true;
  });
}

function handleGroundItemSecondClick(event, activeSessions) {
  const { player, groundItemId, location } = event;
  const log = LIGHTABLE_LOGS_BY_ID.get(groundItemId);
  if (!log) {
    return;
  }

  const position = new Location(location.x, location.y, location.z);
  const groundItem = ItemOnGroundManager.getGroundItem(
    player.getUsername(),
    groundItemId,
    position,
    player.getPrivateArea()
  );
  if (!groundItem) {
    return;
  }

  player.setPositionToFace(position);
  const started = startFiremakingAttempt(
    player,
    log,
    {
      mode: SESSION_MODE.GROUND,
      location: position,
      privateArea: player.getPrivateArea(),
    },
    activeSessions
  );
  if (started) {
    event.handled = true;
  }
}

function handleItemOnObject(event, activeSessions) {
  const { player, object, objectId, itemId } = event;
  if (!object || (objectId !== FIRE_OBJECT_ID && objectId !== CAMPFIRE_OBJECT_ID)) {
    return;
  }

  const log = LIGHTABLE_LOGS_BY_ID.get(itemId);
  if (!log) {
    return;
  }

  const started = startTendFire(player, log, object, activeSessions);
  if (started) {
    event.handled = true;
  }
}

function handleCheckCampfire(event) {
  const state = activeFires.get(event.object);
  if (!state) {
    return;
  }
  event.player.sendMessage(campfireCheckMessage(state.remainingTicks));
  event.handled = true;
}

function findBestBurnableLog(player, preferredLogId = null) {
  const inventory = player.getInventory?.();
  if (!inventory) {
    return null;
  }

  if (preferredLogId != null) {
    const preferred = LIGHTABLE_LOGS_BY_ID.get(preferredLogId);
    if (
      preferred &&
      inventory.contains(preferred.itemId) &&
      canPlayerBurnLog(player, preferred.itemId)
    ) {
      return preferred;
    }
  }

  for (let i = LIGHTABLE_LOGS.length - 1; i >= 0; i--) {
    const candidate = LIGHTABLE_LOGS[i];
    if (canPlayerBurnLog(player, candidate.itemId) && inventory.contains(candidate.itemId)) {
      return candidate;
    }
  }
  return null;
}

function handleTendToCampfire(event, activeSessions) {
  const log = findBestBurnableLog(event.player);
  if (!log) {
    event.player.sendMessage("You have no logs to add.");
    event.handled = true;
    return;
  }

  const started = startTendFire(event.player, log, event.object, activeSessions);
  if (started) {
    event.handled = true;
  }
}

function startBotInventoryFiremaking(player, preferredLogId = null) {
  if (!player || !activeSessionsRef) {
    return false;
  }
  const log = findBestBurnableLog(player, preferredLogId);
  if (!log) {
    return false;
  }

  return startFiremakingAttempt(
    player,
    log,
    { mode: SESSION_MODE.INVENTORY },
    activeSessionsRef
  );
}

// Answers the Firemaking experience for a log, e.g. for the infernal axe's auto-burn.
function answerLogXp(request) {
  const log = LIGHTABLE_LOGS_BY_ID.get(request.logId);
  if (log) {
    request.xp = log.xpReward;
  }
}

function cleanupStaleFires(api) {
  const runtimeFireIds = new Set([FIRE_OBJECT_ID, CAMPFIRE_OBJECT_ID]);
  const staleFires = World.getObjects().filter((object) =>
    runtimeFireIds.has(object?.getId?.())
  );
  for (const object of staleFires) {
    ObjectManager.deregister(object, true);
  }
  if (staleFires.length > 0) {
    api.log("startup_cleanup", { removedStaleFires: staleFires.length });
  }
}

function handlePlayerDisconnect({ player }) {
  stopFiremaking(activeSessionsRef, player, false);
}

function handlePlayerLevelUp({ player, skill }) {
  if (skill === Skill.FIREMAKING) {
    stopFiremaking(activeSessionsRef, player, false);
  }
}

function onItemOnItemEvent(event) {
  handleItemOnItem(event, activeSessionsRef);
}

function onItemOnGroundItemEvent(event) {
  handleItemOnGroundItem(event, activeSessionsRef);
}

function onGroundItemSecondClickEvent(event) {
  handleGroundItemSecondClick(event, activeSessionsRef);
}

function onItemOnObjectEvent(event) {
  handleItemOnObject(event, activeSessionsRef);
}

function onCheckCampfireEvent(event) {
  handleCheckCampfire(event);
}

function onTendToCampfireEvent(event) {
  handleTendToCampfire(event, activeSessionsRef);
}

module.exports = {
  name: "Firemaking",
  startBotInventoryFiremaking,
  canPlayerBurnLog,
  isFiremakingActive(player) {
    return !!(activeSessionsRef && player && activeSessionsRef.has(player));
  },
  isWoodcuttingLog(itemId) {
    return LIGHTABLE_LOGS_BY_ID.has(itemId);
  },
  // Exposed for tests and other plugins.
  LIGHTABLE_LOGS,
  LIGHTABLE_LOGS_BY_ID,
  lightingSuccessChance,
  firemakingXpMultiplier,
  rollFireLifetimeTicks,
  createCampfireTicks,
  extendCampfireTicks,
  campfireCheckMessage,
  FIRE_MIN_LIFETIME_TICKS,
  FIRE_MAX_LIFETIME_TICKS,
  CAMPFIRE_MAX_LIFETIME_TICKS,
  CAMPFIRE_MIN_SPACING_TILES,
  isFireTileBlocked,
  blocksFireTile,
  register(api) {
    TaskManager = api.getTaskManager();
    ObjectManager = api.getObjectManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    World = api.getWorld();
    pluginApi = api;
    const activeSessions = new Map();
    activeSessionsRef = activeSessions;
    activeFires.clear();
    cleanupStaleFires(api);
    TaskManager.submit(new FiremakingTask(activeSessions));
    api.onCustomEvent("firemaking:log-xp", answerLogXp);
    api.onPlayerDisconnect(handlePlayerDisconnect);
    api.onPlayerLevelUp(handlePlayerLevelUp);
    api.onItemOnItem(onItemOnItemEvent, { noted: false });
    api.onItemOnGroundItem(onItemOnGroundItemEvent, { noted: false });
    api.onGroundItemSecondClick(
      LIGHTABLE_LOGS.map((log) => log.itemId),
      onGroundItemSecondClickEvent
    );
    api.onItemOnObject(onItemOnObjectEvent, { noted: false });
    api.onObjectInteraction("Forester's Campfire", {
      "Tend-to": onTendToCampfireEvent,
      Check: onCheckCampfireEvent,
    });
    api.log("registered", {
      lightableLogs: LIGHTABLE_LOGS.length,
      hooks: [
        "item_on_item",
        "item_on_ground_item",
        "ground_item_second_click",
        "item_on_object",
        "object_tend_to",
        "object_check",
      ],
    });
  },
};
