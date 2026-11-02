"use strict";

/**
 * The huge-remains portals and the rubble to the large remains.
 *
 * rsprox captures (rev 241):
 * - A portal (gotr_agility_portal_top) opens at one of four tiles: east 3627,9503; south east
 *   3627,9493; south west 3603,9493; south 3615,9487, with "<col=ef1020>A portal to the huge
 *   guardian fragment mine has opened to the <direction>!</col>". It stays 44 ticks.
 * - Enter: on arrival `gotr_portal_bottom_visible` 1, the HUD closes and gotr_overlay opens in the
 *   atmosphere slot with script 5984 [44090, 15855475], sound 1098; two ticks later "You step
 *   through the portal and find yourself in another part of the temple." (spam), the move to
 *   3592,9503 and script 5985; a tick later the overlay closes and the HUD is back.
 * - The way back (gotr_agility_portal_bottom_parent, shown by that varbit) is the same with the
 *   varbit 0, to 3608,9500.
 * - Rubble: death_human_climbing_down (delay 10), a tick later a 4-tile exactmove over 90 cycles
 *   (3633 <-> 3637, y 9503, facing west) with sound 2454 x6 (delay 19), sound 2455 on landing.
 * Wiki: the rubble needs 56 Agility, unboostable. Tamara's line is from her transcript.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

const PORTALS = {
  [Game.PORTAL_DIRECTIONS.EAST]: { name: "east", x: 3627, y: 9503 },
  [Game.PORTAL_DIRECTIONS.SOUTH_EAST]: { name: "south east", x: 3627, y: 9493 },
  [Game.PORTAL_DIRECTIONS.SOUTH_WEST]: { name: "south west", x: 3603, y: 9493 },
  [Game.PORTAL_DIRECTIONS.SOUTH]: { name: "south", x: 3615, y: 9487 },
};
const MINE_TILE = { x: 3592, y: 9503 };
const RETURN_TILE = { x: 3608, y: 9500 };
const OVERLAY = { model: 44090, colour: 15855475 };
const PORTAL_SOUND = 1098;
const TAMARA = "gotr_tamara_parent";

const RUBBLE = { west: { x: 3633, y: 9503 }, east: { x: 3637, y: 9503 } };
const RUBBLE_AGILITY = 56;
const RUBBLE_SOUND = 2454;
const RUBBLE_LANDING_SOUND = 2455;

let open = null;

function portalLoc(direction) {
  const { GameObject } = Shared.core();
  const tile = PORTALS[direction];
  return new GameObject(Shared.loc("gotr_agility_portal_top"), Shared.location(tile), 10, 0, null);
}

function tamara() {
  const id = Shared.npc(TAMARA);
  for (const npc of Shared.core().World.getNpcs()) {
    if (npc && npc.getId?.() === id && Shared.inTemple(npc.getLocation())) return npc;
  }
  return null;
}

function portalOpened({ direction }) {
  const portal = PORTALS[direction];
  if (!portal) return;
  open = portalLoc(direction);
  Shared.core().ObjectManager.register(open, true);
  Game.message(`<col=ef1020>A portal to the huge guardian fragment mine has opened to the ${portal.name}!</col>`);
  tamara()?.forceChat(`I've opened a portal to the huge guardian fragment mine to the ${portal.name}!`);
}

function portalClosed() {
  if (!open) return;
  Shared.core().ObjectManager.deregister(open, true);
  open = null;
}

/** The colourful fade, unless the player turned it off at the barrier (Visual-effects). */
function overlay(player, on) {
  const sender = player.getPacketSender();
  if (Records.setting(player, "gotr_colourful_fade_disabled") === 1) return;
  if (on) {
    Game.closeHud(player);
    sender.sendSubInterface(Shared.OVERLAY_ATMOSPHERE_UID, Shared.iface(Shared.INTERFACE.OVERLAY), 1, {
      postScripts: [{ scriptId: Shared.SCRIPT.OVERLAY_PORTAL, args: [OVERLAY.model, OVERLAY.colour] }],
    });
  } else {
    sender.closeSubInterface(Shared.OVERLAY_ATMOSPHERE_UID);
    if (Game.isPlaying(player)) Game.openHud(player);
  }
}

function stepThrough(player, tile, visible) {
  player.getMovementQueue().reset();
  Shared.setVarbit(player, Shared.VARBIT.PORTAL_BOTTOM_VISIBLE, visible);
  Shared.animate(player, null);
  overlay(player, true);
  Shared.sound(player, PORTAL_SOUND);
  Shared.later(2, () => {
    if (!player.isRegistered()) return;
    Shared.spam(player, "You step through the portal and find yourself in another part of the temple.");
    player.moveTo(Shared.location(tile));
    if (Records.setting(player, "gotr_colourful_fade_disabled") !== 1) {
      player.getPacketSender().sendClientScript(Shared.SCRIPT.REMOVE_PORTAL);
    }
    Shared.later(1, () => player.isRegistered() && overlay(player, false));
  });
}

function enterPortal({ player, objectId }) {
  if (!Shared.isLoc(objectId, "gotr_agility_portal_top") || !Shared.inTemple(player.getLocation())) return false;
  if (!Game.isPlaying(player)) {
    player.sendMessage("There's no need to do that right now.");
    return true;
  }
  stepThrough(player, MINE_TILE, 1);
  return true;
}

function leaveMine({ player }) {
  if (!Shared.inTemple(player.getLocation())) return false;
  stepThrough(player, RETURN_TILE, 0);
  return true;
}

function climbRubble({ player, objectId }) {
  if (!Shared.isLoc(objectId, "gotr_agility_shortcut_top", "gotr_agility_shortcut_bottom")) return false;
  if (!Shared.inTemple(player.getLocation())) return false;
  if (player.getSkillManager().getMaxLevel(Shared.core().Skill.AGILITY) < RUBBLE_AGILITY) {
    Shared.statement(player, `You need an Agility level of ${RUBBLE_AGILITY} to climb this rubble.`);
    return true;
  }
  if (ObstacleRunner.isBusy(player)) return true;
  const fromWest = player.getLocation().getX() <= RUBBLE.west.x;
  const target = fromWest ? RUBBLE.east : RUBBLE.west;
  ObstacleRunner.run({ player }, [
    { anim: Shared.seq("death_human_climbing_down"), delay: 10 },
    { wait: 1 },
    { sound: RUBBLE_SOUND, loops: 6, delay: 19 },
    { move: [target.x, target.y], speed: [0, 90], dir: "west", ticks: 3 },
    { sound: RUBBLE_LANDING_SOUND },
  ]);
  return true;
}

/** A game's end or a restart takes the portal away; the mine's players walk back as they like. */
function reset() {
  portalClosed();
}

module.exports = {
  PORTALS,
  attach(api) {
    ObstacleRunner.init(api);
    api.onObjectInteraction("Portal", { Enter: enterPortal });
    api.onObjectClick(Shared.loc("gotr_agility_portal_bottom_parent"), 1, leaveMine);
    api.onObjectInteraction("Rubble", { Climb: climbRubble });
    Game.on("portal-open", portalOpened);
    Game.on("portal-close", portalClosed);
    Game.on("rifts-closed", reset);
  },
};
