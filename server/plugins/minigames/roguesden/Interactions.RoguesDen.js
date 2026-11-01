"use strict";

/**
 * Object interactions inside the Den: the pub trapdoor, the maze doorway, the one-way
 * passageways and grills, contortion bars, ledges, the 80-Thieving shortcut, trap searches and
 * the wall safes. Everything is keyed on the cache's ids and placements from Common.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");

function location(x, y, z) {
  return new (Common.core().Location)(x, y, z);
}

function valid(x, y, z) {
  return x > 0 && y > 0 && Common.walkable(x, y, z);
}

/** The tile on the far side of a one-tile obstacle, up to `limit` tiles away. */
function across(object, player, limit = 4) {
  const at = object.getLocation();
  const here = player.getLocation();
  let dx = Math.sign(at.getX() - here.getX());
  let dy = Math.sign(at.getY() - here.getY());
  if (dx === 0 && dy === 0) {
    const [fx, fy] = Common.FACING[object.getFace() & 3];
    dx = fx;
    dy = fy;
  }
  for (let step = 1; step <= limit; step++) {
    const x = at.getX() + dx * step;
    const y = at.getY() + dy * step;
    if (valid(x, y, at.getZ())) return location(x, y, at.getZ());
  }
  // Diagonal approaches (some ledges and corners): try the two axes on their own.
  for (const [ax, ay] of [[dx, 0], [0, dy]]) {
    if (ax === 0 && ay === 0) continue;
    for (let step = 1; step <= limit; step++) {
      const x = at.getX() + ax * step;
      const y = at.getY() + ay * step;
      if (valid(x, y, at.getZ())) return location(x, y, at.getZ());
    }
  }
  return null;
}

function moveThrough(player, to, ticks = 1, onArrive = null) {
  const run = Run.runOf(player);
  const { TaskManager, Task } = Common.core();
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement?.(true);
  if (run) run.ignoreTrapUntil = (run.ticks ?? 0) + ticks + 1;
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), player, false); }
    execute() {
      this.stop();
      if (!player.isRegistered?.()) return;
      player.moveTo(to);
      player.getMovementQueue().setBlockMovement?.(false);
      if (run) {
        run.prev = to.clone();
        run.moves = [];
      }
      onArrive?.();
    }
    stop() {
      player.getMovementQueue().setBlockMovement?.(false);
      super.stop();
    }
  })());
}

function skillFail(player, skill) {
  player.sendMessage(Common.message(skill === "AGILITY" ? "noAgility" : "noThieving"));
}

function drain(run, player, skill, amount) {
  if (!run) {
    // Outside a run the obstacles still drain, as live; restore happens on the next login.
    const current = Common.level(player, skill);
    if (current - amount < 0) {
      skillFail(player, skill);
      return false;
    }
    Common.setLevel(player, skill, current - amount);
    return true;
  }
  if (!run.drain(skill, amount)) {
    skillFail(player, skill);
    return false;
  }
  return true;
}

function contortionBars(event) {
  const { player, object } = event;
  const run = Run.runOf(player);
  if (!drain(run, player, "AGILITY", Common.DATA.drains.contortionBars)) return true;
  const to = across(object, player, 3);
  if (!to) return true;
  player.forceChat?.("You squeeze through the contortion bars.");
  moveThrough(player, to, 2);
  event.handled = true;
  return true;
}

function furthestLedgeTile(group, player, object) {
  const here = player.getLocation();
  if (group.horizontal) {
    const y = object.getLocation().getY();
    const west = here.getX() <= group.minX;
    const x = west ? group.maxX + 1 : group.minX - 1;
    if (valid(x, y, group.z)) return location(x, y, group.z);
    return null;
  }
  const x = object.getLocation().getX();
  const north = here.getY() <= group.minY;
  const y = north ? group.maxY + 1 : group.minY - 1;
  if (valid(x, y, group.z)) return location(x, y, group.z);
  return null;
}

function ledge(event) {
  const { player, object } = event;
  const entry = Common.ledges.get(Common.keyOf(object.getLocation()));
  if (!entry?.group) return false;
  const run = Run.runOf(player);
  if (!drain(run, player, "AGILITY", entry.group.drain)) {
    event.handled = true;
    return true;
  }
  const to = furthestLedgeTile(entry.group, player, object);
  if (!to) return false;
  player.getMovementQueue().reset();
  moveThrough(player, to, entry.group.length >= 7 ? 3 : 2);
  event.handled = true;
  return true;
}

function passageway(event) {
  const { player, object } = event;
  const to = across(object, player, 4);
  if (!to) return false;
  moveThrough(player, to, 1);
  event.handled = true;
  return true;
}

const correctGrills = new Set(Common.DATA.grillRoom.correct.map(([x, y]) => `${x},${y}`));

function grill(event) {
  const { player, object } = event;
  const at = object.getLocation();
  if (Common.inGrillRoom(at) && !correctGrills.has(`${at.getX()},${at.getY()}`)) {
    const [x, y, z] = Common.DATA.grillRoom.start;
    moveThrough(player, location(x, y, z), 1);
    player.sendMessage(Common.message("wrongGrill"));
    event.handled = true;
    return true;
  }
  const to = across(object, player, 3);
  if (!to) return false;
  moveThrough(player, to, 1);
  event.handled = true;
  return true;
}

function shortcutDoor(event) {
  const { player, object } = event;
  if (Common.maxLevel(player, "THIEVING") < 80) {
    player.sendMessage(Common.message("shortcutLevel"));
    event.handled = true;
    return true;
  }
  if (!drain(Run.runOf(player), player, "THIEVING", Common.DATA.drains.shortcutDoor)) {
    event.handled = true;
    return true;
  }
  const to = across(object, player, 3);
  if (to) moveThrough(player, to, 1);
  player.sendMessage("You pick the lock.");
  event.handled = true;
  return true;
}

function searchTrap(event) {
  const { player, object } = event;
  if (String(event.option).toLowerCase() !== "search") return false;
  const floor = Common.floorTraps.get(Common.keyOf(object.getLocation()));
  // Wall traps are indexed by the tile they face, so the click's own loc resolves to the record.
  const trap = floor ?? Common.wallTrapFor(object);
  if (!trap) return false;
  const run = Run.runOf(player);
  if (trap.disarmedBy === player) {
    player.sendMessage(Common.message("disarmTrap"));
    event.handled = true;
    return true;
  }
  if (!drain(run, player, "THIEVING", Common.DATA.drains.trap)) {
    event.handled = true;
    return true;
  }
  trap.disarmedBy = player;
  player.sendMessage(Common.message("searchTrap"));
  player.sendMessage(Common.message("disarmTrap"));
  event.handled = true;
  return true;
}

function trapdoor(event) {
  const { player } = event;
  const [x, y, z] = Common.DATA.lobby.entryTile;
  player.moveTo(location(x, y, z));
  event.handled = true;
  return true;
}

function pubExit(event) {
  const { player } = event;
  const [x, y, z] = Common.DATA.lobby.pubTile;
  player.moveTo(location(x, y, z));
  event.handled = true;
  return true;
}

function viewingLadder(event) {
  const run = Run.runOf(event.player);
  if (!run) return false;
  Run.left(event.player, false);
  event.handled = true;
  return true;
}

function mazeDoor(event) {
  if (String(event.option).toLowerCase() !== "open") return false;
  // The maze doors are one-way barriers; carrying the player across keeps the cache's swing
  // from deciding which side they end on.
  const to = across(event.object, event.player, 3);
  if (!to) return false;
  moveThrough(event.player, to, 1);
  event.handled = true;
  return true;
}

function gearDoor(event) {
  return require("./Puzzles.RoguesDen").gearDoor(event);
}

function mosaicDoor(event) {
  return require("./Puzzles.RoguesDen").mosaicDoor(event);
}

function chest(event) {
  return require("./Puzzles.RoguesDen").chest(event);
}

function mazeSafe(event) {
  return require("./Safes.RoguesDen").crackMaze(event);
}

function lobbySafe(event) {
  return require("./Safes.RoguesDen").crackLobby(event);
}

function mazeDoorway(event) {
  return require("./Lobby.RoguesDen").enterMaze(event);
}

/** All ids this unit intercepts before the generic door/ladder handlers. */
function attach(api) {
  const ids = Common.ids;
  api.onBeforeObjectInteraction((event) => {
    const id = event.objectId;
    if (id === ids.trapdoor) return trapdoor(event);
    if (id === ids.mazeDoorway) return mazeDoorway(event);
    if (id === ids.pubPassageway || id === ids.pubDoor) return pubExit(event);
    if (id === ids.viewingLadder) return viewingLadder(event);
    if (id === ids.contortionBars) return contortionBars(event);
    if (id === ids.ledgeWall || id === ids.ledgeBridge) return ledge(event);
    if (id === ids.passagewayA || id === ids.passagewayB) return passageway(event);
    if (id === ids.grill) return grill(event);
    if (id === ids.shortcutDoor) return shortcutDoor(event);
    if (id === ids.mazeDoor) return mazeDoor(event);
    if (id === ids.gearDoor) return gearDoor(event);
    if (id === ids.mosaicDoor) return mosaicDoor(event);
    if (id === ids.chest) return chest(event);
    if (id === ids.mazeSafe) return mazeSafe(event);
    if (id === ids.lobbySafe) return lobbySafe(event);
    if (id === ids.wallSpikes || id === ids.wallGas || id === ids.wallCrusher
      || id === ids.floorSpikes || id === ids.floorSpring || id === ids.floorExplosive) {
      return searchTrap(event);
    }
    return false;
  });
}

module.exports = {
  attach, moveThrough, across, searchTrap,
  contortionBars, ledge, passageway, grill,
};
