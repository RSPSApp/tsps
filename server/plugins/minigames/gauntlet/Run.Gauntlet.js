"use strict";

/**
 * Inside a run: lighting nodes, the exit platform, the teleport crystal, the Hunllef's barrier,
 * and what happens on death, teleporting and logging back in.
 */

const Shared = require("./GauntletShared");
const GauntletMap = require("./GauntletMap");
const Run = require("./GauntletRun");
const Monsters = require("./GauntletMonsters");

// Instances sit at tile 8192+ (TemplatedInstanceArea); a player saved there was in a run.
const INSTANCE_MIN_X = 8192;
const INSTANCE_MAX_X = 9599;

const EXIT_TEXT = "Are you sure you wish to exit the Gauntlet? All of your progress will be lost and you will start again upon re-entering.";

function runIn(player) {
  return Run.runInside(player);
}

// ------------------------------------------------------------------ nodes

/** A node lights the room past the side of its room it stands on. */
function lightNode(event) {
  const { player, object } = event;
  const run = runIn(player);
  if (!run) return false;
  const sceptre = Run.items()[run.mode].sceptre;
  if (!player.getEquipment().contains(sceptre) && !player.getInventory().contains(sceptre)) {
    Shared.statement(player, "You need something to light the nodes with.");
    return true;
  }
  const room = run.map.roomAt(object.getLocation());
  const side = room && nodeSide(run.map, room, object);
  const next = side && run.map.room(room.gridX + side.dx, room.gridY + side.dy);
  if (!next || next.lit) return true;
  run.lightRoom(next.gridX, next.gridY);
  player.sendMessage("You light the nodes in the corridor to help guide the way.");
  return true;
}

/** The side of the room nearest the node's middle. */
function nodeSide(map, room, object) {
  const definition = object.getDefinition();
  const turned = (object.getFace() & 1) === 1;
  const sizeX = (turned ? definition?.getSizeY() : definition?.getSizeX()) ?? 1;
  const sizeY = (turned ? definition?.getSizeX() : definition?.getSizeY()) ?? 1;
  const origin = map.roomTile(room, 0, 0);
  const x = object.getLocation().getX() - origin.getX() + (sizeX - 1) / 2;
  const y = object.getLocation().getY() - origin.getY() + (sizeY - 1) / 2;
  const last = GauntletMap.ROOM_TILES - 1;
  const distance = { north: last - y, east: last - x, south: y, west: x };
  return GauntletMap.SIDES.reduce((best, side) => (distance[side.name] < distance[best.name] ? side : best));
}

// ------------------------------------------------------------------ ways out

function exitPlatform(event) {
  const { player, objectId } = event;
  if (!Shared.OBJECT.EXIT_PLATFORMS.includes(objectId)) return false;
  const run = runIn(player);
  if (!run) return false;
  Shared.options(player, EXIT_TEXT, "Yes, let me out.", () => run.end("exit"), "No.", () => {});
  return true;
}

function quickExitPlatform(event) {
  const { player, objectId } = event;
  if (!Shared.OBJECT.EXIT_PLATFORMS.includes(objectId)) return false;
  const run = runIn(player);
  if (!run) return false;
  run.end("exit");
  return true;
}

/** The teleport crystal: once, back to the start room. */
function useTeleportCrystal(event) {
  const { player, itemId, slot } = event;
  const run = runIn(player);
  if (!run || Run.items()[run.mode].teleportCrystal !== itemId) return false;
  // Wiki: not in the start room, and not once the Hunllef fight has begun.
  if (run.stage !== "prep") {
    player.sendMessage("That won't help you now. At this point in the Gauntlet, you win or you die.");
    return true;
  }
  if (run.inStartRoom(player.getLocation())) {
    player.sendMessage("You're already at the start of the Gauntlet.");
    return true;
  }
  player.getInventory().deleteAtSlot(slot, 1);
  run.teleportToStart();
  return true;
}

// ------------------------------------------------------------------ the barrier

function pass(event) {
  return passBarrier(event, false);
}

function quickPass(event) {
  return passBarrier(event, true);
}

/** Before the fight: Pass (asks) and Quick-pass go through and start it. */
function passBarrier(event, quick) {
  const { player, object } = event;
  const run = runIn(player);
  if (!run) return false;
  if (run.stage !== "prep" || run.inArena(player.getLocation())) return true;
  const enter = () => {
    if (!run.startBossPhase()) return;
    walkThrough(player, object);
  };
  if (quick) enter();
  else Shared.options(player, "Start the boss fight now? There's no turning back.", "Yes, I'm ready.", enter, "No.", () => {});
  return true;
}

/** In the fight the barrier offers Escape: leaving the Hunllef ends the run. */
function escapeBarrier(event) {
  const run = runIn(event.player);
  if (!run) return false;
  if (run.stage === "boss") run.end("escape");
  return true;
}

/** Two tiles across the barrier, the way it faces. */
function walkThrough(player, object) {
  const location = player.getLocation();
  const across = (object.getFace() & 1) === 1;
  const dx = across ? (object.getLocation().getX() < location.getX() ? -2 : 2) : 0;
  const dy = across ? 0 : (object.getLocation().getY() < location.getY() ? -2 : 2);
  player.getMovementQueue().reset();
  player.moveTo(location.transform(dx, dy));
}

// ------------------------------------------------------------------ death, teleports, login

function keepNothingOnDeath(event) {
  // The run takes everything itself; nothing drops in the maze.
  if (runIn(event.player)) event.shouldDrop = false;
}

function dieInRun(event) {
  const run = runIn(event.player);
  if (!run) return;
  event.handled = true;
  run.end("death");
}

// ------------------------------------------------------------------ monsters

/** A run's monsters drop by the run's rules (GauntletMonsters) instead of the general tables. */
function gauntletDrops(event) {
  const run = event.npc?.__gauntletRun;
  if (!run) return;
  // The Hunllef and its tornadoes drop nothing: the reward is the chest in the lobby.
  const drops = run.stage === "ended" ? null : Monsters.rollDrops(run, event.player, event.npcId);
  event.drops.length = 0;
  if (drops) event.drops.push(...drops);
}

/** The Hunllef and its tornadoes are scripted (GauntletHunllef): no default combat of their own. */
function scriptedDontAttack(event) {
  if (event.attacker?.__gauntletScripted) event.allow = false;
}

/** The player's hits on the Hunllef go through its protection prayer. */
function hitHunllef(event) {
  event.npc?.__gauntletHunllef?.onHit(event.hit);
}

/** Killing the Hunllef completes the run. */
function hunllefDied(event) {
  const fight = event.npc?.__gauntletHunllef;
  if (!fight || fight.run.stage !== "boss") return;
  fight.stop();
  Shared.later(fight.run, 2, () => fight.run.end("completed"));
}

/** The start room is safe: nothing attacks into it (Near-Reality keeps monsters out too). */
function safeStartRoom(event) {
  const run = event.attacker?.__gauntletRun;
  if (!run || !event.target?.isPlayer?.()) return;
  if (run.inStartRoom(event.target.getLocation())) event.allow = false;
}

/** Bryn: teleports are blocked inside. */
function blockTeleports(event) {
  if (!runIn(event.player)) return;
  event.allow = false;
  event.player.sendMessage("You can't teleport out of the Gauntlet.");
}

/** A player saved inside a maze (the server stopped mid-run) comes back to the lobby, empty-handed. */
function recoverOnLogin({ player }) {
  Run.sendCompletionVarp(player);
  const x = player.getLocation().getX();
  const wasInside = player.getAttribute(Run.ATTR_RUN) || (x >= INSTANCE_MIN_X && x <= INSTANCE_MAX_X && !player.getArea?.());
  if (!wasInside || Run.runOf(player)) return;
  player.setAttribute(Run.ATTR_RUN, null);
  Shared.clearItems(player);
  player.moveTo(Shared.loc(Shared.LOBBY));
  player.sendMessage("Your Gauntlet run is no longer available. You have been returned to the lobby.");
}

module.exports = function registerGauntletRun(api) {
  Shared.bind(api);
  api.persistAttribute(Run.ATTR_RUN);
  api.persistAttribute(Run.ATTR_STATS);
  api.onObjectInteraction("Node", { Light: lightNode });
  api.onObjectInteraction(Shared.OBJECT.TELEPORT_PLATFORM, { Exit: exitPlatform, "Quick-exit": quickExitPlatform });
  api.onObjectInteraction(Shared.OBJECT.BARRIER, {
    Pass: pass,
    "Quick-pass": quickPass,
    Escape: escapeBarrier,
  });
  api.onItemAction("Teleport crystal", { Activate: useTeleportCrystal });
  api.onItemAction("Corrupted teleport crystal", { Activate: useTeleportCrystal });
  api.onShouldDropItemsOnDeath(keepNothingOnDeath);
  api.onPlayerDeath(dieInRun);
  api.onCanTeleport(blockTeleports);
  api.onCustomEvent("npc-drops:roll", gauntletDrops);
  api.onCanAttack(safeStartRoom);
  api.onCanAttack(scriptedDontAttack);
  api.onNpcHitModify(hitHunllef);
  api.onNpcDeath(hunllefDied);
  api.onPlayerLogin(recoverOnLogin);
};
