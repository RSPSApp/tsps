/**
 * Keeping a league character out of locked areas (Wiki: magical barriers at the borders, every
 * transport needs its destination unlocked, respawns only in unlocked areas), at the map-square
 * granularity of the region map:
 * - a map-square change into a locked square (a step, a teleport, a ladder, a boat, a dialogue)
 *   goes back to where it started when that is open, else to the league home; a respawn goes to
 *   the league home;
 * - a teleport whose destination is known (`onCanTeleport`) is refused;
 * - a respawn another plugin sent into a locked square, or the world's spawn when locked, goes to
 *   the league home;
 * - Death's Office's exit portal, when it would lead to a locked square, leads to the league home.
 *   The Wiki's respawn rule applied to the portal (ours: no capture shows a locked exit). Left to
 *   the map-square rule, the player would go back into a copy that is ending as they leave it.
 * The league home is the world's spawn, or the first default area's hub when that is locked (so
 * always open, which ends the correction). A main character is never asked.
 */
const Common = require("./Common.LeagueAreaUnlocks");
const Regions = require("./Regions.LeagueAreaUnlocks");

/** Players between their death and their respawn's landing (onPlayerDeath to the next tick). */
const respawning = new WeakSet();
/** Players being moved by this unit: the move's own map-square event is not a new crossing. */
const correcting = new WeakSet();

function home(type, player) {
  const { WorldDefinition, Location } = Common.core;
  const spawn = WorldDefinition.WORLD_SPAWN;
  if (Regions.isOpen(type, player, spawn.getX(), spawn.getY())) return new Location(spawn.getX(), spawn.getY(), spawn.getZ());
  const hub = Common.area(Common.league(type).defaults[0]).teleport;
  return new Location(hub.x, hub.y, hub.z);
}

function sendBack(player, destination) {
  correcting.add(player);
  try {
    player.getMovementQueue().reset();
    player.moveTo(destination);
  } finally {
    correcting.delete(player);
  }
  player.sendMessage(Common.message("locked"));
}

function mapSquareChanged({ player, previous, location }) {
  if (correcting.has(player)) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  if (Regions.isOpenAt(type, player, location)) {
    respawning.delete(player);
    return;
  }
  if (respawning.has(player)) {
    respawning.delete(player);
    sendBack(player, home(type, player));
    return;
  }
  if (previous && Regions.isOpenAt(type, player, previous)) {
    sendBack(player, previous.clone());
    return;
  }
  sendBack(player, home(type, player));
}

function canTeleport(event) {
  const { player, destination } = event;
  if (!destination) return;
  const type = Common.leagueOf(player);
  if (type === null || Regions.isOpenAt(type, player, destination)) return;
  player.sendMessage(Common.message("locked"));
  event.allow = false;
}

/**
 * The respawn is on its way: a landing in a locked square goes home instead, whatever plugin moves
 * them (the death's own handlers and `player:respawn` run this tick; the flag is gone by the next).
 */
function died({ player }) {
  if (Common.leagueOf(player) === null) return;
  respawning.add(player);
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      this.stop();
      respawning.delete(player);
    }
  })());
}

/** After the respawn handlers registered before this one: a locked landing, or a locked default spawn, goes home. */
function respawn(event) {
  const { player } = event;
  const type = Common.leagueOf(player);
  if (type === null) return;
  if (event.handled) {
    if (!Regions.isOpenAt(type, player, player.getLocation())) player.moveTo(home(type, player));
  } else if (!Regions.isOpenAt(type, player, Common.core.GameConstants.DEFAULT_LOCATION)) {
    player.moveTo(home(type, player));
    event.handled = true;
  }
}

/** Asked by Death's Office before its exit portal opens. */
function officeExit(query) {
  const { player, destination } = query;
  const type = Common.leagueOf(player);
  if (type === null || Regions.isOpenAt(type, player, destination)) return;
  query.destination = home(type, player);
}

module.exports = function attach(api) {
  api.onPlayerMapSquareChange(mapSquareChanged);
  api.onCanTeleport(canTeleport);
  api.onPlayerDeath(died);
  api.onCustomEvent("player:respawn", respawn);
  api.onCustomEvent("deaths-office:exit", officeExit);
};

Object.assign(module.exports, { home });
