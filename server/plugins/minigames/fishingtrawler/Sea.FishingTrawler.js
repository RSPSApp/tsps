"use strict";

/**
 * The trawler at sea and the wreck it can become (Wiki: Fishing Trawler):
 * - sailing out and back shows ship_journey for 21 ticks (captured); at sea trawler_start and
 *   trawler_overlay are up and trawler_status is 2;
 * - the crew sails on the trawler (an Area round the boat);
 * - each tick runs the voyage and sends every player's HUD and boat varbits;
 * - back in port, each player's share goes to the net (Rewards.FishingTrawler.js);
 * - sunk, the crew is in the sea by the barrels; climbing one swims them ashore north of Port
 *   Khazard for 2 damage, as does logging out at sea (the player comes back there);
 * - a player leaving the trawler (logging out, teleporting) is out of the trip; when nobody is
 *   left the trip is over.
 */

const Shared = require("./Shared.FishingTrawler");
const Rewards = require("./Rewards.FishingTrawler");
const { Voyage, clearHud } = require("./Voyage.FishingTrawler");

/**
 * toplevel_mainmodal_open (rev241 capture): ship_journey opens on its own brown (0x2a1e06) filling the
 * screen, and trawler_start with no background; we also clear it in port, as our other modals don't.
 */
const MAIN_MODAL_OPEN = 2524;
const SHIP_JOURNEY_BACKGROUND = [0x2a1e06, 0];
const NO_MODAL_BACKGROUND = [-1, -1];

const sea = { voyage: null, task: null, boatArea: null, wreckArea: null, overListeners: [] };

const atSea = () => Boolean(sea.voyage);

function openJourney(player) {
  player.getPacketSender().sendInterfaceScript(MAIN_MODAL_OPEN, SHIP_JOURNEY_BACKGROUND)
    .sendInterface(Shared.ids().interfaces.journey);
}

function onOver(listener) {
  sea.overListeners.push(listener);
}

function launch(players, random = Math.random) {
  if (sea.voyage || players.length === 0) return null;
  const voyage = new Voyage(players, random);
  sea.voyage = voyage;
  for (const player of players) {
    player.setAttribute(Shared.AT_SEA_ATTRIBUTE, true);
    openJourney(player);
  }
  Shared.later(Shared.DATA.timing.sailTicks, () => arrive(voyage));
  return voyage;
}

/** The crew comes aboard at sea: the start interface, the HUD, and the trip starts ticking. */
function arrive(voyage) {
  if (sea.voyage !== voyage) return;
  const ids = Shared.ids();
  for (const player of voyage.crewList()) {
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    player.moveTo(Shared.loc(Shared.DATA.boat.arrive));
    sender.sendInterfaceScript(MAIN_MODAL_OPEN, NO_MODAL_BACKGROUND).sendInterface(ids.interfaces.start);
    sender.sendSubInterface(Shared.OVERLAY_HUD_UID, ids.interfaces.overlay, 1);
    Shared.setVarbit(player, ids.varbits.status, Shared.DATA.values.status.atSea);
    voyage.sync(player);
  }
  sea.task = Shared.everyTick(tickSea);
}

function tickSea() {
  const voyage = sea.voyage;
  if (!voyage) {
    sea.task = null;
    return false;
  }
  voyage.tick();
  for (const player of voyage.crewList()) voyage.sync(player);
  if (voyage.crewList().length === 0) voyage.end("abandoned");
  if (voyage.ended) {
    finish(voyage);
    return false;
  }
  return true;
}

function finish(voyage) {
  sea.voyage = null;
  sea.task = null;
  const crew = voyage.crewList();
  try {
    endFor(voyage, crew);
  } finally {
    for (const listener of sea.overListeners) listener(voyage);
  }
}

/** Everyone off the trawler, whatever one player's ending does. */
function endFor(voyage, crew) {
  for (const player of crew) {
    player.getPacketSender().closeSubInterface?.(Shared.OVERLAY_HUD_UID);
    clearHud(player);
  }
  if (voyage.result === "returned") {
    for (const player of crew) {
      for (const line of voyage.summaryFor(player)) player.sendMessage(line);
      player.sendMessage(Shared.message("toShore"));
      openJourney(player);
    }
    Shared.later(Shared.DATA.timing.sailTicks, () => dock(voyage, crew));
  } else if (voyage.result === "sunk") {
    for (const player of crew) {
      player.sendMessage(Shared.message("sinking"));
      player.moveTo(Shared.loc(Shared.DATA.wreck.arrive));
      player.sendMessage(Shared.message("sunk"));
    }
  }
}

/** Back at Port Khazard: each player's share goes into the net. */
function dock(voyage, crew) {
  for (const player of crew) {
    if (player.isRegistered?.() === false) continue;
    player.getPacketSender().sendInterfaceRemoval().sendInterfaceScript(MAIN_MODAL_OPEN, NO_MODAL_BACKGROUND);
    player.setAttribute(Shared.AT_SEA_ATTRIBUTE, false);
    player.moveTo(Shared.loc(Shared.DATA.port));
    try {
      Rewards.award(player, voyage);
    } catch (error) {
      console.error("[FishingTrawler] reward failed", error);
    }
  }
}

/** Ashore north of Port Khazard, for the 2 damage of the swim. */
function swimAshore(player) {
  const { HitDamage, HitMask } = Shared.core();
  player.setAttribute(Shared.AT_SEA_ATTRIBUTE, false);
  player.moveTo(Shared.loc(Shared.DATA.shore));
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(2, HitMask.RED)]);
  player.sendMessage(Shared.message("swim"));
}

function climbBarrel({ player, objectId }) {
  if (!Shared.ids().locs.barrels.includes(objectId)) return false;
  swimAshore(player);
  return true;
}

function createBoatArea() {
  const { Area, Boundary } = Shared.core();
  const [minX, maxX, minY, maxY] = Shared.DATA.boat.bounds;
  class TrawlerAtSea extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, 0), new Boundary(minX, maxX, minY, maxY, 1)]);
    }

    getName() {
      return "Fishing Trawler";
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer?.()) return;
      sea.voyage?.leave(mobile);
      mobile.getPacketSender?.().closeSubInterface?.(Shared.OVERLAY_HUD_UID);
      clearHud(mobile);
      // A player logging out at sea comes back ashore (Wiki); one sunk stays at sea until ashore.
      if (logout) mobile.moveTo(Shared.loc(Shared.DATA.shore));
      if (logout || !Shared.inBounds(Shared.DATA.wreck.bounds, mobile.getLocation())) mobile.setAttribute(Shared.AT_SEA_ATTRIBUTE, false);
    }

    canAttack() {
      return false;
    }

    canTeleport() {
      return null;
    }
  }
  return new TrawlerAtSea();
}

function createWreckArea() {
  const { Area, Boundary } = Shared.core();
  const [minX, maxX, minY, maxY] = Shared.DATA.wreck.bounds;
  class TrawlerWreck extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
    }

    getName() {
      return "Fishing Trawler (wreck)";
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer?.()) return;
      if (logout) mobile.moveTo(Shared.loc(Shared.DATA.shore));
      mobile.setAttribute(Shared.AT_SEA_ATTRIBUTE, false);
    }
  }
  return new TrawlerWreck();
}

/** Saved at sea (a crash, an old save): back ashore north of Port Khazard. */
function recoverOnLogin({ player }) {
  if (player.getAttribute(Shared.AT_SEA_ATTRIBUTE) !== true) return;
  player.setAttribute(Shared.AT_SEA_ATTRIBUTE, false);
  const location = player.getLocation();
  if (Shared.inBounds(Shared.DATA.boat.bounds, location) || Shared.inBounds(Shared.DATA.wreck.bounds, location)) {
    player.moveTo(Shared.loc(Shared.DATA.shore));
  }
}

function attachSea(api) {
  Shared.bind(api);
  sea.boatArea = createBoatArea();
  sea.wreckArea = createWreckArea();
  api.registerArea(sea.boatArea);
  api.registerArea(sea.wreckArea);
  api.persistAttribute(Shared.AT_SEA_ATTRIBUTE, false);
  api.onObjectInteraction("Barrel", { "Climb-on": climbBarrel });
  api.onPlayerLogin(recoverOnLogin);
}

module.exports = { attachSea, sea, atSea, launch, arrive, dock, tickSea, finish, onOver, swimAshore, climbBarrel, recoverOnLogin };
