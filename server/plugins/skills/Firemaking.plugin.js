const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
let pluginApi;
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const SESSION_MODE = Object.freeze({
  INVENTORY: "inventory",
  GROUND: "ground",
  BONFIRE: "bonfire",
});

const TINDERBOX_ID = ItemIds.TINDERBOX;
const FIRE_OBJECT_ID = ObjectIds.FIRE_5;
const FIRE_OBJECT_TYPE = 10;
const FIRE_OBJECT_FACE = 0;

const LIGHT_FIRE_ANIMATION = new Animation(733);
const BONFIRE_ANIMATION = new Animation(896);

const FIREMAKING_ACTION_INTERVAL_TICKS = 4;
const ANIMATION_INTERVAL_TICKS = 4;
const MAX_ACTION_DISTANCE = 25;

const LIGHTABLE_LOGS = [
  { name: "logs", itemId: ItemIds.LOGS, requiredLevel: 1, xpReward: 40, cycles: 7, respawnTicks: 60 },
  { name: "achey logs", itemId: ItemIds.ACHEY_TREE_LOGS, requiredLevel: 1, xpReward: 40, cycles: 7, respawnTicks: 65 },
  { name: "oak logs", itemId: ItemIds.OAK_LOGS, requiredLevel: 15, xpReward: 60, cycles: 8, respawnTicks: 70 },
  { name: "willow logs", itemId: ItemIds.WILLOW_LOGS, requiredLevel: 30, xpReward: 90, cycles: 9, respawnTicks: 80 },
  { name: "teak logs", itemId: ItemIds.TEAK_LOGS, requiredLevel: 35, xpReward: 105, cycles: 9, respawnTicks: 80 },
  { name: "arctic pine logs", itemId: ItemIds.ARCTIC_PINE_LOGS, requiredLevel: 42, xpReward: 125, cycles: 10, respawnTicks: 80 },
  { name: "maple logs", itemId: ItemIds.MAPLE_LOGS, requiredLevel: 45, xpReward: 135, cycles: 10, respawnTicks: 85 },
  { name: "mahogany logs", itemId: ItemIds.MAHOGANY_LOGS, requiredLevel: 50, xpReward: 157, cycles: 11, respawnTicks: 85 },
  { name: "yew logs", itemId: ItemIds.YEW_LOGS, requiredLevel: 60, xpReward: 202, cycles: 13, respawnTicks: 90 },
  { name: "magic logs", itemId: ItemIds.MAGIC_LOGS, requiredLevel: 75, xpReward: 303, cycles: 15, respawnTicks: 100 },
  { name: "redwood logs", itemId: ItemIds.REDWOOD_LOGS, requiredLevel: 90, xpReward: 350, cycles: 18, respawnTicks: 120 },
];

const LIGHTABLE_LOGS_BY_ID = new Map(
  LIGHTABLE_LOGS.map((log) => [log.itemId, log])
);
let activeSessionsRef = null;

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getFiremakingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.FIREMAKING);
}

function getFiremakingMaxLevel(player) {
  return player.getSkillManager().getMaxLevel(Skill.FIREMAKING);
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

function stopFiremaking(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

function canLightFireAt(player, location) {
  if (!location) {
    return false;
  }
  if (ObjectManager.existsLocation(location)) {
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

function calculateCyclesRequired(player, log, mode) {
  return FIREMAKING_ACTION_INTERVAL_TICKS;
}

class FireExpireTask extends Task {
  constructor(delayTicks, fireObject, ownerPlayer) {
    super(Math.max(1, delayTicks));
    this.fireObject = fireObject;
    this.ownerPlayer = ownerPlayer;
  }

  execute() {
    // Always despawn the exact runtime fire instance we spawned for this task.
    // Relying on a map lookup here can miss in edge-cases and leave stale fires.
    ObjectManager.deregister(this.fireObject, true);

    if (
      this.ownerPlayer &&
      typeof this.ownerPlayer.getUsername === "function" &&
      typeof this.ownerPlayer.getPrivateArea === "function"
    ) {
      const ashesLocation = this.fireObject.getLocation().clone();
      const existingAshes = ItemOnGroundManager.getGroundItem(
        this.ownerPlayer.getUsername(),
        ItemIds.ASHES,
        ashesLocation
      );
      if (!existingAshes) {
        ItemOnGroundManager.registerLocation(
          this.ownerPlayer,
          new Item(ItemIds.ASHES, 1),
          ashesLocation
        );
      }
    }

    this.stop();
  }
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

function spawnFire(player, location, respawnTicks) {
  const fire = new GameObject(
    FIRE_OBJECT_ID,
    location.clone(),
    FIRE_OBJECT_TYPE,
    FIRE_OBJECT_FACE,
    player.getPrivateArea()
  );
  ObjectManager.register(fire, true);
  TaskManager.submit(new FireExpireTask(respawnTicks, fire, player));
  if (player.getLocation().equals(location)) {
    stepAwayFromFire(player);
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
  if (
    source.mode !== SESSION_MODE.BONFIRE &&
    requiresTinderbox(player) &&
    !inventory.contains(TINDERBOX_ID)
  ) {
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
    if (!canLightFireAt(player, sessionLocation)) {
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
      sessionLocation
    );
    if (!existingGroundLog) {
      return false;
    }
  } else if (source.mode === SESSION_MODE.BONFIRE) {
    sessionLocation = source.location?.clone?.();
    privateArea = source.privateArea ?? privateArea;
    if (!sessionLocation) {
      return false;
    }
    if (!inventory.contains(log.itemId)) {
      player.sendMessage("You've run out of logs.");
      return false;
    }
    const fire = MapObjects.get(FIRE_OBJECT_ID, sessionLocation, privateArea);
    if (!fire) {
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
    cyclesUntilSuccess: calculateCyclesRequired(player, log, source.mode),
    nextAnimationTick: 0,
  });

  if (source.mode === SESSION_MODE.BONFIRE) {
    player.sendMessage("You attempt to add the logs to the fire.");
    Sounds.sendSound(player, Sound.FIRE_LIGHT);
    player.performAnimation(BONFIRE_ANIMATION);
  } else {
    player.sendMessage("You attempt to light the logs..");
    // No explicit FIRE_LIGHT here: animation 733 has sound 2597 baked into
    // frames 8 and 10 in the cache, so sending it too made lighting a fire
    // play three overlapping "strike" sounds instead of one.
    player.performAnimation(LIGHT_FIRE_ANIMATION);
  }

  return true;
}

function completeInventoryOrGroundFire(player, state) {
  if (!canLightFireAt(player, state.location)) {
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
      state.location
    );
    if (!groundLog) {
      return false;
    }
    ItemOnGroundManager.deregister(groundLog);
  }

  spawnFire(player, state.location, state.log.respawnTicks);
  player.getSkillManager().addExperiences(Skill.FIREMAKING, state.log.xpReward);
  pluginApi.emitCustomEvent("firemaking:success", { player, skill: Skill.FIREMAKING });
  Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
  player.sendMessage("The logs catch fire and begin to burn.");
  return true;
}

function completeBonfire(player, state) {
  const fire = MapObjects.get(FIRE_OBJECT_ID, state.location, state.privateArea);
  if (!fire) {
    return false;
  }
  if (!player.getInventory().contains(state.log.itemId)) {
    player.sendMessage("You've run out of logs.");
    return false;
  }

  player.getInventory().deleteNumber(state.log.itemId, 1);
  player.getSkillManager().addExperiences(Skill.FIREMAKING, state.log.xpReward);
  pluginApi.emitCustomEvent("firemaking:success", { player, skill: Skill.FIREMAKING });
  Sounds.sendSound(player, Sound.FIRE_SUCCESSFUL);
  player.sendMessage("You add a log to the fire.");
  return true;
}

function processFiremakingTick(activeSessions, currentTick) {
  for (const [player, state] of activeSessions) {
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

    if (!player.getLocation().isWithinInteractionDistance(state.location)) {
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (getFiremakingLevel(player) < state.log.requiredLevel) {
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (
      state.mode !== SESSION_MODE.BONFIRE &&
      requiresTinderbox(player) &&
      !player.getInventory().contains(TINDERBOX_ID)
    ) {
      player.sendMessage("You need a tinderbox to light fires.");
      stopFiremaking(activeSessions, player);
      continue;
    }

    if (state.mode === SESSION_MODE.GROUND) {
      const groundLog = ItemOnGroundManager.getGroundItem(
        player.getUsername(),
        state.log.itemId,
        state.location
      );
      if (!groundLog) {
        stopFiremaking(activeSessions, player);
        continue;
      }
    }

    if (state.mode === SESSION_MODE.BONFIRE) {
      const fire = MapObjects.get(FIRE_OBJECT_ID, state.location, state.privateArea);
      if (!fire) {
        stopFiremaking(activeSessions, player);
        continue;
      }
    }

    if (currentTick >= state.nextAnimationTick) {
      player.performAnimation(
        state.mode === SESSION_MODE.BONFIRE
          ? BONFIRE_ANIMATION
          : LIGHT_FIRE_ANIMATION
      );
      state.nextAnimationTick = currentTick + ANIMATION_INTERVAL_TICKS;
    }

    state.cyclesUntilSuccess--;
    if (state.cyclesUntilSuccess > 0) {
      continue;
    }

    const completed =
      state.mode === SESSION_MODE.BONFIRE
        ? completeBonfire(player, state)
        : completeInventoryOrGroundFire(player, state);

    stopFiremaking(activeSessions, player);
    if (!completed) {
      continue;
    }
  }
}

class FiremakingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.currentTick = 0;
  }

  execute() {
    this.currentTick++;
    processFiremakingTick(this.activeSessions, this.currentTick);
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
      position
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
    position
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
  if (objectId !== FIRE_OBJECT_ID || !object) {
    return;
  }

  const log = LIGHTABLE_LOGS_BY_ID.get(itemId);
  if (!log) {
    return;
  }

  const started = startFiremakingAttempt(
    player,
    log,
    {
      mode: SESSION_MODE.BONFIRE,
      location: object.getLocation(),
      privateArea: object.getPrivateArea(),
    },
    activeSessions
  );
  if (started) {
    event.handled = true;
  }
}

function startBotInventoryFiremaking(player, preferredLogId = null) {
  if (!player || !activeSessionsRef) {
    return false;
  }
  const inventory = player.getInventory?.();
  if (!inventory) {
    return false;
  }

  let log = null;
  if (preferredLogId != null) {
    log = LIGHTABLE_LOGS_BY_ID.get(preferredLogId) ?? null;
    if (log && !inventory.contains(log.itemId)) {
      log = null;
    }
    if (log && !canPlayerBurnLog(player, log.itemId)) {
      log = null;
    }
  }
  if (!log) {
    for (let i = LIGHTABLE_LOGS.length - 1; i >= 0; i--) {
      const candidate = LIGHTABLE_LOGS[i];
      if (!canPlayerBurnLog(player, candidate.itemId)) {
        continue;
      }
      if (inventory.contains(candidate.itemId)) {
        log = candidate;
        break;
      }
    }
  }
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

let TaskManager;
let ObjectManager;
let ItemOnGroundManager;
let World;

// Answers the Firemaking experience for a log, e.g. for the infernal axe's auto-burn.
function answerLogXp(request) {
  const log = LIGHTABLE_LOGS_BY_ID.get(request.logId);
  if (log) {
    request.xp = log.xpReward;
  }
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
  register(api) {
    TaskManager = api.getTaskManager();
    ObjectManager = api.getObjectManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    World = api.getWorld();
    pluginApi = api;
    const activeSessions = new Map();
    activeSessionsRef = activeSessions;

    // If plugins are hot-reloaded in the same process, ensure no runtime fires linger.
    // Static map fires are not stored in World.getObjects(), so this only clears
    // previously spawned temporary firemaking objects.
    const staleFires = World.getObjects().filter(
      (object) => object?.getId?.() === FIRE_OBJECT_ID
    );
    for (const object of staleFires) {
      if (object?.getId?.() === FIRE_OBJECT_ID) {
        ObjectManager.deregister(object, true);
      }
    }
    if (staleFires.length > 0) {
      api.log("startup_cleanup", { removedStaleFires: staleFires.length });
    }

    TaskManager.submit(new FiremakingTask(activeSessions));
    api.onCustomEvent("firemaking:log-xp", answerLogXp);

    api.onPlayerDisconnect(({ player }) => {
      stopFiremaking(activeSessions, player, false);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopFiremaking(activeSessions, player, false);
    });

    api.onItemOnItem((event) => {
      handleItemOnItem(event, activeSessions);
    }, { noted: false });

    api.onItemOnGroundItem((event) => {
      handleItemOnGroundItem(event, activeSessions);
    }, { noted: false });

    api.onGroundItemSecondClick(
      LIGHTABLE_LOGS.map((log) => log.itemId),
      (event) => {
        handleGroundItemSecondClick(event, activeSessions);
      }
    );

    api.onItemOnObject((event) => {
      handleItemOnObject(event, activeSessions);
    }, { noted: false });

    api.log("registered", {
      lightableLogs: LIGHTABLE_LOGS.length,
      hooks: [
        "item_on_item",
        "item_on_ground_item",
        "ground_item_second_click",
        "item_on_object",
      ],
    });
  },
};
