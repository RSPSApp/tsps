/** Forester campfire tending and the existing log-lighting loop. Evidence: docs/firemaking.md. */
let ChatType, Skill, Equipment, Animation, Task, Location, Item, GameObject, MapObjects, RegionManager, Sound, Sounds, ItemIds, ObjectIds;
const { pauseForLevelUp } = require("../SkillActions");

const SESSION_MODE = Object.freeze({
  INVENTORY: "inventory",
  GROUND: "ground",
  TEND: "tend",
});

let TINDERBOX_ID, FIRE_OBJECT_ID, CAMPFIRE_OBJECT_ID, LIGHT_FIRE_ANIMATION;
const FIRE_OBJECT_TYPE = 10;
const FIRE_OBJECT_FACE = 0;
const LIGHTABLE_LOGS = [];
const LIGHTABLE_LOGS_BY_ID = new Map();
const PYROMANCER_OUTFIT = [];
const CAMPFIRES_BY_FIRE = new Map();
let CreationMenu, Graphic, DialogueChainBuilder, StatementDialogue;
const TENDING_ANIMATIONS = new Map();
const CAMPFIRE_BURN_GRAPHIC = 2582; // forestry_campfire_burning_spotanim

// Lighting rolls once per 4-tick attempt, a tick before the fire would appear (rsprox captures,
// recording 1035): the first roll is 3 ticks after the click and a hit lights 1 tick later.
// Tending a campfire adds a log every 9 ticks.
const LIGHT_ATTEMPT_INTERVAL_TICKS = 4;
const FIRST_LIGHT_ROLL_TICKS = 3;
const FIRE_CATCH_DELAY_TICKS = 1;
const TEND_INTERVAL_TICKS = 9;
const MAX_ACTION_DISTANCE = 25;
// Ground logs are "Take" (op3) and "Light" (op4) in the cache.
const LIGHT_GROUND_OPTION = 4;

// OSRS Wiki (Mod Ash): fires burn 60-119 seconds, independent of the log used.
const FIRE_MIN_LIFETIME_TICKS = 100;
const FIRE_MAX_LIFETIME_TICKS = 198;
// OSRS Wiki: a Forester's Campfire burns for at most 300 ticks (~180 seconds).
const CAMPFIRE_MAX_LIFETIME_TICKS = 300;
// OSRS Wiki: campfires must be at least 5 tiles apart.
const CAMPFIRE_MIN_SPACING_TILES = 5;

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
let pluginApi;
let activeSessionsRef = null;
let sessionTick = 0;

// Runtime fires and campfires owned by this plugin, keyed by GameObject instance.
const activeFires = new Map();

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, text);
}

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
  pluginApi.emitCustomEvent("firemaking:success", { player, skill: Skill.FIREMAKING, itemId: log.itemId });
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

function createCampfireObject(location, privateArea, fireId) {
  return new GameObject(
    CAMPFIRES_BY_FIRE.get(fireId) ?? CAMPFIRE_OBJECT_ID,
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
  // "firemaking:can-light" { player, location, allowed, message }: a place where fires can't be lit.
  const request = { player, location, allowed: true, message: null };
  pluginApi.emitCustomEvent("firemaking:can-light", request);
  if (!request.allowed) {
    if (request.message) player.sendMessage(request.message);
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
      player.sendMessage("You can't light a fire here.");
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
  // Live turns the player back to the fire as they step off it (face_angle 1536 after a step west).
  player.setPositionToFace(location);
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
    if (state.baseObject) ObjectManager.register(state.baseObject, true);
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

  // A log from the inventory goes on the ground at once and is lit there (rsprox captures,
  // recording 1035: the log leaves the inventory and appears underfoot on the click tick).
  const fromInventory = source.mode === SESSION_MODE.INVENTORY;
  if (fromInventory) {
    inventory.deleteNumber(log.itemId, 1);
    ItemOnGroundManager.registerLocation(player, new Item(log.itemId, 1), sessionLocation, privateArea);
  }

  activeSessions.set(player, {
    mode: SESSION_MODE.GROUND,
    fromInventory,
    log,
    location: sessionLocation,
    privateArea,
    nextActionTick: sessionTick + FIRST_LIGHT_ROLL_TICKS,
    catchTick: null,
  });

  spam(player, "You attempt to light the logs.");
  // No explicit FIRE_LIGHT here: animation 733 has sound 2597 baked into
  // frames 8 and 10 in the cache, so sending it too made lighting a fire
  // play three overlapping "strike" sounds instead of one.
  player.performAnimation(LIGHT_FIRE_ANIMATION);
  return true;
}

function startTendFire(player, log, object, activeSessions, amount = Infinity) {
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

  if (!object.isWithinInteractionDistance(player.getLocation())) {
    return false;
  }

  player.getSkillManager()?.stopSkillable?.();
  stopFiremaking(activeSessions, player, false);

  activeSessions.set(player, {
    mode: SESSION_MODE.TEND,
    remaining: amount,
    log,
    object,
    fireState: activeFires.get(object) ?? null,
    location: object.getLocation().clone(),
    privateArea: object.getPrivateArea(),
    nextActionTick: sessionTick + TEND_INTERVAL_TICKS,
  });

  player.performAnimation(TENDING_ANIMATIONS.get(log.itemId));
  return true;
}

function completeInventoryOrGroundFire(player, state) {
  if (!canLightFireAt(player, state.location, state.privateArea)) {
    return false;
  }

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

  let logs = 1;
  if (state.fromInventory) {
    // Content may burn several logs in the one action ("firemaking:logs-per-action", a league relic's
    // nine): the one on the ground and the rest from the inventory.
    const burn = { player, logId: state.log.itemId, amount: 1 };
    pluginApi.emitCustomEvent("firemaking:logs-per-action", burn);
    const extra = burn.amount > 1 ? Math.min((burn.amount | 0) - 1, player.getInventory().getAmount(state.log.itemId)) : 0;
    if (extra > 0) player.getInventory().deleteNumber(state.log.itemId, extra);
    logs += extra;
  }

  spawnFire(player, state.location);
  for (let burnt = 0; burnt < logs; burnt++) grantFiremakingLogXp(player, state.log);
  Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
  spam(player, "The fire catches and the logs begin to burn.");
  return true;
}

function convertFireToCampfire(fireObject, state) {
  const campfire = createCampfireObject(state.location, state.privateArea, fireObject.getId());
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
  if (state) state.ownerPlayer = player;
  if (state && state.object === session.object) {
    if (!state.campfire) {
      state = convertFireToCampfire(session.object, state);
      session.fireState = state;
      session.object = state.object;
      state.remainingTicks = createCampfireTicks(log);
      return;
    }
    state.remainingTicks = extendCampfireTicks(state.remainingTicks, log);
    return;
  }

  // A permanent fire is not tracked yet: replace it with a player-fed campfire that is
  // restored to its original fire once the campfire burns out.
  const baseObject = session.object;
  ObjectManager.deregister(baseObject, true);
  const campfire = createCampfireObject(baseObject.getLocation(), baseObject.getPrivateArea(), baseObject.getId());
  ObjectManager.register(campfire, true);
  state = createFireState(campfire, player);
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
  if (!object.isWithinInteractionDistance(player.getLocation())) {
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
  player.performAnimation(TENDING_ANIMATIONS.get(log.itemId));
  Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
  player.getPacketSender().sendGlobalGraphic(new Graphic(CAMPFIRE_BURN_GRAPHIC), object.getLocation());
  grantFiremakingLogXp(player, log);
  extendCampfire(player, session, log);
  if (--session.remaining <= 0 || !player.getInventory().contains(log.itemId)) {
    stopFiremaking(activeSessions, player);
  }
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
    if (session.levelUpPaused) continue;

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

    if (session.catchTick != null) {
      if (currentTick < session.catchTick) continue;
      completeInventoryOrGroundFire(player, session);
      stopFiremaking(activeSessions, player, false);
      continue;
    }

    if (currentTick < session.nextActionTick) {
      continue;
    }

    // Content may make the roll succeed ("firemaking:light-roll", a league relic that never fails to light).
    const light = { player, success: Math.random() < lightingSuccessChance(getFiremakingLevel(player)) };
    pluginApi.emitCustomEvent("firemaking:light-roll", light);
    if (!light.success) {
      player.performAnimation(LIGHT_FIRE_ANIMATION);
      session.nextActionTick = currentTick + LIGHT_ATTEMPT_INTERVAL_TICKS;
      continue;
    }

    // A hit stops the animation; the fire catches on the next tick.
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    session.catchTick = currentTick + FIRE_CATCH_DELAY_TICKS;
  }
}

function createFiremakingTask(activeSessions) {
  class FiremakingTask extends Task {
    constructor(activeSessions) {
      super(1);
      this.activeSessions = activeSessions;
    }

    execute() {
      sessionTick++;
      processFires();
      processFiremakingTick(this.activeSessions, sessionTick);
    }
  }

  return new FiremakingTask(activeSessions);
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

function handleGroundItemLight(event, activeSessions) {
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
  if (!object || (!CAMPFIRES_BY_FIRE.has(objectId) && ![...CAMPFIRES_BY_FIRE.values()].includes(objectId))) {
    return false;
  }

  const log = LIGHTABLE_LOGS_BY_ID.get(itemId);
  if (!log) {
    return;
  }

  stopFiremaking(activeSessions, player);
  event.handled = true;
  selectTendingLog(player, object, activeSessions);
}

function handleCheckCampfire(event) {
  const state = activeFires.get(event.object);
  if (!state) {
    return;
  }
  stopFiremaking(activeSessionsRef, event.player);
  event.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, campfireCheckMessage(state.remainingTicks))
  ));
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

/** With one log type, tend directly; with several, let the player choose the type and quantity. */
function selectTendingLog(player, object, activeSessions) {
  const inventory = player.getInventory();
  const logs = LIGHTABLE_LOGS.filter(log => inventory.contains(log.itemId));
  if (!logs.length) {
    player.sendMessage("You have no logs to add.");
    return;
  }
  if (logs.length === 1) {
    startTendFire(player, logs[0], object, activeSessions);
    return;
  }
  player.getPacketSender().sendCreationMenu(new CreationMenu(
    "What would you like to burn?",
    logs.map(log => log.itemId),
    { execute(itemId, amount) {
      const log = logs.find(log => log.itemId === itemId);
      if (log) startTendFire(player, log, object, activeSessions, amount);
    } },
    { mode: 27, maxAmount: Math.max(...logs.map(log => inventory.getAmount(log.itemId))) }
  ));
}

function handleTendToCampfire(event, activeSessions) {
  stopFiremaking(activeSessions, event.player);
  selectTendingLog(event.player, event.object, activeSessions);
  event.handled = true;
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

function handlePlayerDisconnect({ player }) {
  stopFiremaking(activeSessionsRef, player, false);
}

/** A level-up pop-up pauses lighting, whichever skill it is for. */
function handlePlayerLevelUp(event) {
  pauseForLevelUp(event, activeSessionsRef, (player) => stopFiremaking(activeSessionsRef, player, false));
}

function onItemOnItemEvent(event) {
  handleItemOnItem(event, activeSessionsRef);
}

function onItemOnGroundItemEvent(event) {
  handleItemOnGroundItem(event, activeSessionsRef);
}

function onGroundItemLightEvent(event) {
  handleGroundItemLight(event, activeSessionsRef);
}

function onItemOnObjectEvent(event) {
  return handleItemOnObject(event, activeSessionsRef);
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
  attach,
};

function attach(api) {
  ({ ChatType, Skill, Equipment, Animation, Task, Location, Item, GameObject, MapObjects, RegionManager,
     Sound, Sounds, CreationMenu, Graphic, DialogueChainBuilder, StatementDialogue, ItemIdentifiers: ItemIds, ObjectIdentifiers: ObjectIds } = api.core);
  TINDERBOX_ID = ItemIds.TINDERBOX;
  FIRE_OBJECT_ID = ObjectIds.FIRE_23; // cache gameval fire: ordinary player-made and permanent fires
  CAMPFIRE_OBJECT_ID = ObjectIds.FORESTERS_CAMPFIRE;
  LIGHT_FIRE_ANIMATION = new Animation(733);
  TENDING_ANIMATIONS.clear();
  // Cache forestry_campfire_burning_* sequences; willow is also observed in recording 1723.
  for (const [itemId, seq] of [
    [ItemIds.KINDLING_2, 10561], [ItemIds.ACHEY_TREE_LOGS, 10562],
    [ItemIds.ARCTIC_PINE_LOGS, 10563], [ItemIds.BLISTERWOOD_LOGS, 10564],
    [ItemIds.LOGS, 10565], [ItemIds.MAGIC_LOGS, 10566],
    [ItemIds.MAHOGANY_LOGS, 10567], [ItemIds.MAPLE_LOGS, 10568],
    [ItemIds.OAK_LOGS, 10569], [ItemIds.REDWOOD_LOGS, 10570],
    [ItemIds.TEAK_LOGS, 10571], [ItemIds.WILLOW_LOGS, 10572],
    [ItemIds.YEW_LOGS, 10573], [ItemIds.JATOBA_LOGS, 13666],
    [ItemIds.CAMPHOR_LOGS, 13667], [ItemIds.IRONWOOD_LOGS, 13668], [ItemIds.ROSEWOOD_LOGS, 13669],
  ]) TENDING_ANIMATIONS.set(itemId, new Animation(seq));
  LIGHTABLE_LOGS.splice(0, LIGHTABLE_LOGS.length,
    // Wiki: Chambers of Xeric kindling, lit for 48 XP; the fire's length follows normal logs.
    { name: "kindling", itemId: ItemIds.KINDLING_2, requiredLevel: 1, xpReward: 48, campfireDurationTicks: 102, campfireBurnTicks: 3 },
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
  );
  // OSRS Wiki pyromancer outfit: hood 0.4%, garb 0.8%, robe 0.6%, boots 0.2%, full set 2.5%.
  PYROMANCER_OUTFIT.splice(0, PYROMANCER_OUTFIT.length,
    { slot: Equipment.HEAD_SLOT, itemIds: [ItemIds.PYROMANCER_HOOD, ItemIds.PYROMANCER_HOOD_2], bonus: 0.004 },
    { slot: Equipment.BODY_SLOT, itemIds: [ItemIds.PYROMANCER_GARB, ItemIds.PYROMANCER_GARB_2], bonus: 0.008 },
    { slot: Equipment.LEG_SLOT, itemIds: [ItemIds.PYROMANCER_ROBE, ItemIds.PYROMANCER_ROBE_2], bonus: 0.006 },
    { slot: Equipment.FEET_SLOT, itemIds: [ItemIds.PYROMANCER_BOOTS, ItemIds.PYROMANCER_BOOTS_2], bonus: 0.002 },
  );

  LIGHTABLE_LOGS_BY_ID.clear();
  for (const log of LIGHTABLE_LOGS) LIGHTABLE_LOGS_BY_ID.set(log.itemId, log);
  CAMPFIRES_BY_FIRE.clear();
  for (const [fire, campfire] of [
    [ObjectIds.FIRE_23, ObjectIds.FORESTERS_CAMPFIRE],
    [ObjectIds.FIRE_24, ObjectIds.FORESTERS_CAMPFIRE_2],
    [ObjectIds.FIRE_25, ObjectIds.FORESTERS_CAMPFIRE_3],
    [ObjectIds.FIRE_26, ObjectIds.FORESTERS_CAMPFIRE_4],
    [ObjectIds.FIRE_16, ObjectIds.FORESTERS_CAMPFIRE_5],
    [ObjectIds.FIRE_17, ObjectIds.FORESTERS_CAMPFIRE_6],
  ]) CAMPFIRES_BY_FIRE.set(fire, campfire);
  TaskManager = api.getTaskManager();
  ObjectManager = api.getObjectManager();
  ItemOnGroundManager = api.getItemOnGroundManager();
  pluginApi = api;
  activeSessionsRef = new Map();
  for (const [object, state] of activeFires) {
    ObjectManager.deregister(object, true);
    if (state.baseObject) ObjectManager.register(state.baseObject, true);
  }
  activeFires.clear();
  sessionTick = 0;
  TaskManager.submit(createFiremakingTask(activeSessionsRef));
  api.onCustomEvent("firemaking:log-xp", answerLogXp);
  api.onPlayerDisconnect(handlePlayerDisconnect);
  api.onCustomEvent("level-up:popup-opened", handlePlayerLevelUp);
  api.onItemOnItem(onItemOnItemEvent, { noted: false });
  api.onItemOnGroundItem(onItemOnGroundItemEvent, { noted: false });
  api.onGroundItemClick(
    LIGHTABLE_LOGS.map((log) => log.itemId),
    LIGHT_GROUND_OPTION,
    onGroundItemLightEvent
  );
  for (const log of LIGHTABLE_LOGS) {
    const name = api.core.CacheDefinitions.getItem(log.itemId).name;
    api.onItemOnObject(name, "Fire", onItemOnObjectEvent, { noted: false });
    api.onItemOnObject(name, "Forester's Campfire", onItemOnObjectEvent, { noted: false });
  }
  api.onObjectInteraction("Forester's Campfire", {
    "Tend-to": onTendToCampfireEvent,
    Check: onCheckCampfireEvent,
  });
}
