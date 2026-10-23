"use strict";

// Sessions for the random events that teleport the player into their event area
// (Drill Demon, Freaky Forester, Gravedigger, Pinball, Evil Bob, Prison Pete, Evil twin,
// Maze, Mime, Pillory, Quiz Master, Surprise Exam, Beekeeper). The areas, NPCs and scenery
// ship in the world/cache data; a session only owns the player's stay, the dynamic pieces
// it spawns, the return tile and the teleport refusal inside the area.
const LUMBRIDGE = { x: 3222, y: 3218 };
const RETURN_LOCATION_ATTRIBUTE = "random-events:return-location";
const sessions = new Map();
// Areas that host players: registered as core Areas so leaving by any route (teleport,
// death, command) ends the session, exactly once.
const DESTINATIONS = [
  { kind: "beekeeper", minX: 1918, maxX: 1938, minY: 5032, maxY: 5056 },
  { kind: "drill", minX: 3152, maxX: 3176, minY: 4814, maxY: 4842 },
  { kind: "forester", minX: 2588, maxX: 2616, minY: 4760, maxY: 4790 },
  { kind: "gravedigger", minX: 1916, maxX: 1936, minY: 4990, maxY: 5010 },
  { kind: "pinball", minX: 1960, maxX: 1984, minY: 5034, maxY: 5054 },
  { kind: "evilbob", minX: 2500, maxX: 2548, minY: 4758, maxY: 4798 },
  { kind: "prison", minX: 2060, maxX: 2106, minY: 4444, maxY: 4484 },
  { kind: "eviltwin", minX: 1848, maxX: 1888, minY: 5116, maxY: 5148 },
  { kind: "maze", minX: 2884, maxX: 2940, minY: 4548, maxY: 4604 },
  { kind: "mime", minX: 2000, maxX: 2020, minY: 4746, maxY: 4766 },
  { kind: "quiz", minX: 1940, maxX: 1966, minY: 4756, maxY: 4782 },
  { kind: "exam", minX: 1876, maxX: 1896, minY: 5014, maxY: 5038 },
  { kind: "frogland", minX: 2450, maxX: 2478, minY: 4764, maxY: 4794 },
  // The pillory cages: Varrock, Seers' Village and Yanille.
  { kind: "pillory", minX: 3218, maxX: 3240, minY: 3400, maxY: 3416 },
  { kind: "pillory", minX: 2672, maxX: 2696, minY: 3480, maxY: 3498 },
  { kind: "pillory", minX: 2596, maxX: 2618, minY: 3096, maxY: 3114 },
];
let api;
let Hook;

function initialize(pluginApi, hooks) {
  shutdown();
  api = pluginApi;
  api.persistAttribute(RETURN_LOCATION_ATTRIBUTE, null);
  Hook = hooks;
}

function sessionOf(player) {
  return sessions.get(player);
}

/** Whether any teleport event is currently holding this player. */
function hasSession(player) {
  return sessions.has(player);
}

function destinationBounds(kind) {
  return DESTINATIONS.find(entry => entry.kind === kind);
}

/** Any random-event destination tile, for crash recovery on login. */
function insideAnyDestination(location) {
  return DESTINATIONS.some(bounds => location.getZ() === 0 &&
    location.getX() >= bounds.minX && location.getX() <= bounds.maxX &&
    location.getY() >= bounds.minY && location.getY() <= bounds.maxY);
}

/** Starts a stay in `spec.kind`'s area, remembers the return tile and runs `spec.onStart`. */
function begin(active, spec) {
  const player = active.player;
  // Replacing an event mid-stay returns the player before starting the new one.
  if (sessions.has(player)) finish(sessions.get(player));
  const { Location } = api.core;
  const session = {
    player, kind: spec.kind, active, data: spec.data ?? {},
    returnLocation: player.getLocation().clone(),
    startedAt: Date.now(),
    expiresAt: spec.lifetimeMs ? Date.now() + spec.lifetimeMs : 0,
    tick: spec.tick ?? null,
    cleanup: [],
    finishing: false,
    teleportRefusal: spec.teleportRefusal ?? "You can't leave just like that!",
  };
  player.setAttribute(RETURN_LOCATION_ATTRIBUTE, {
    x: session.returnLocation.getX(), y: session.returnLocation.getY(), z: session.returnLocation.getZ(),
  });
  sessions.set(player, session);
  active.session = session;
  // The invitation lifecycle ends here: the follower NPC is removed without rewarding.
  Hook?.finish?.(active);
  player.moveTo(new Location(spec.arrive.x, spec.arrive.y, spec.arrive.z ?? 0));
  (spec.onStart ?? active.definition.enter)?.(session);
  return session;
}

/** Spawns an owner-scoped NPC that the session removes when it ends. */
function spawnNpc(session, definition) {
  const npc = api.spawnNpc({ ...definition, owner: session.player });
  if (npc) session.cleanup.push(() => api.removeNpc(npc));
  return npc;
}

/** Registers a registry/cache object that the session removes when it ends. */
function spawnObject(session, object) {
  api.core.ObjectManager.register(object, true);
  session.cleanup.push(() => api.core.ObjectManager.deregister(object, true));
  return object;
}

/** Adds a dynamic entity or timer to the session's teardown list. */
function onEnd(session, cleanup) {
  session.cleanup.push(cleanup);
}

/** Runs `action` after a few ticks, stopping when the session or server is gone. */
function later(session, ticks, action) {
  const TaskManager = api.getTaskManager?.();
  const Task = api.core.Task;
  if (!TaskManager || !Task) return;
  const task = new (class extends Task {
    constructor() { super(Math.max(1, ticks), session.player); }
    execute() {
      const index = session.cleanup.indexOf(cancel);
      if (index !== -1) session.cleanup.splice(index, 1);
      this.stop();
      if (sessions.get(session.player) === session && !session.finishing && session.player.isRegistered()) action();
    }
  })();
  const cancel = () => task.stop();
  onEnd(session, cancel);
  TaskManager.submit(task);
}

/** Swaps a registry/map object for another id at the same tile, as quests do. */
function replaceObject(object, newId) {
  const location = object.getLocation();
  const replacement = new api.core.GameObject(newId,
    new api.core.Location(location.getX(), location.getY(), location.getZ()),
    object.getType(), object.getFace(), object.getPrivateArea?.() ?? null);
  api.core.ObjectManager.deregister(object, true);
  api.core.ObjectManager.register(replacement, true);
  return replacement;
}

/** Items the player owns, counting inventory, equipment and bank like OSRS event checks. */
function owns(player, itemId) {
  if (player.getInventory().containsNumber(itemId)) return true;
  const equipment = player.getEquipment?.();
  if (equipment?.containsNumber?.(itemId)) return true;
  for (let tab = 0; tab < 10; tab++) {
    const bank = player.getBank?.(tab);
    if (bank?.containsNumber?.(itemId)) return true;
  }
  return false;
}

/** Gives rewards, dropping anything that no longer fits at the player's feet. */
function grant(session, rewards, message = null) {
  const player = session.player;
  if (!player.isRegistered()) return;
  const inventory = player.getInventory();
  const items = rewards.map(reward => new api.core.Item(
    typeof reward === "number" ? reward : reward.id,
    typeof reward === "number" ? 1 : reward.amount));
  const slots = items.filter(item => !item.getDefinition().isStackable() ||
    !inventory.containsNumber(item.getId())).length;
  if (inventory.getFreeSlots() >= slots) {
    for (const item of items) inventory.addItem(item);
  } else {
    dropAtFeet(session, items);
    player.sendMessage("Your inventory is too full, so your reward was placed on the floor.");
  }
  if (message) player.sendMessage(message);
}

function dropAtFeet(session, items) {
  const manager = api.getItemOnGroundManager?.();
  if (!manager) return;
  for (const item of items) {
    manager.registerLocation(session.player, item, session.player.getLocation().clone());
  }
}

/** Sends the player home. A blocked return tile falls back to Lumbridge, as OSRS does. */
function returnToStart(session) {
  const { player, returnLocation } = session;
  if (!player.isRegistered()) return;
  const region = api.getRegionManager();
  const area = player.getPrivateArea?.() ?? null;
  if (region.blocked(returnLocation, area)) {
    player.moveTo(new api.core.Location(LUMBRIDGE.x, LUMBRIDGE.y, 0));
    player.sendMessage("You were returned to Lumbridge.");
    return;
  }
  player.moveTo(returnLocation);
}

function runCleanup(session) {
  for (const cleanup of session.cleanup.splice(0)) {
    try { cleanup(); }
    catch (error) { console.error("[RandomEvents] session cleanup failed", error); }
  }
}

/**
 * Ends the session. `back` moves the player to their original tile first (not for events
 * that end by death or log out), then `reward` is granted there, so anything that no
 * longer fits is dropped beside the player and not left behind in the event area.
 */
function finish(session, { reward = null, message = null, back = true } = {}) {
  if (!session || session.finishing) return false;
  session.finishing = true;
  sessions.delete(session.player);
  session.player.setAttribute(RETURN_LOCATION_ATTRIBUTE, null);
  if (session.interfaceId && session.player.getInterfaceId?.() === session.interfaceId) {
    session.player.getPacketSender().sendInterfaceRemoval();
  }
  runCleanup(session);
  if (back) returnToStart(session);
  if (reward?.length) grant(session, reward, message);
  else if (message) session.player.sendMessage(message);
  return true;
}

/** The player left the area by their own route: end the session without a reward. */
function departed(player, logout) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  player.setAttribute(RETURN_LOCATION_ATTRIBUTE, null);
  runCleanup(session);
  // Logging out inside the event must not save the player standing in the event area.
  if (logout) player.setLocation(session.returnLocation);
}

function process(player) {
  const session = sessions.get(player);
  if (session?.tick) session.tick(session);
}

/** Clears a stale session after a crash-relog: nobody may stand in an event area unbidden. */
function recover(player) {
  const location = player.getLocation();
  if (sessions.has(player)) return;
  const saved = player.getAttribute(RETURN_LOCATION_ATTRIBUTE);
  const validReturn = saved && Number.isInteger(saved.x) && saved.x >= 0 && saved.x <= 16_383 &&
    Number.isInteger(saved.y) && saved.y >= 0 && saved.y <= 16_383 &&
    Number.isInteger(saved.z) && saved.z >= 0 && saved.z <= 3;
  player.setAttribute(RETURN_LOCATION_ATTRIBUTE, null);
  if (!insideAnyDestination(location)) return;
  if (validReturn) {
    const returnLocation = new api.core.Location(saved.x, saved.y, saved.z);
    if (!insideAnyDestination(returnLocation)) {
      returnToStart({ player, returnLocation });
      return;
    }
  }
  player.moveTo(new api.core.Location(LUMBRIDGE.x, LUMBRIDGE.y, 0));
}

function shutdown() {
  for (const session of [...sessions.values()]) finish(session);
}

/** The core Areas that hold players: leaving one by any route ends its session. */
function createAreas() {
  const { Area, Boundary } = api.core;
  return DESTINATIONS.map(bounds => {
    class RandomEventArea extends Area {
      constructor() {
        super([new Boundary(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 0)]);
      }
      canTeleport(player) {
        const session = sessions.get(player);
        if (!session) return null;
        player.sendMessage(session.teleportRefusal);
        return false;
      }
      postLeave(mobile, logout) {
        if (sessions.has(mobile)) departed(mobile, logout);
      }
    }
    return new RandomEventArea();
  });
}

module.exports = {
  initialize, sessionOf, hasSession, begin, spawnNpc, spawnObject, onEnd, replaceObject, later,
  owns, grant, finish, departed, process, recover, shutdown, createAreas, returnToStart,
};
