"use strict";

/**
 * The Death's Domain entrances near the respawn points, and the office's exit portal. As
 * captured (rsprox recordings 4266 and 1106): Enter kneels into the portal (human_pickupfloor,
 * delay 20) as it opens; the exit portal opens it without the kneel, and puts the player outside
 * the entrance they came in by (Civitas illa Fortis: 1653, 3135). `deaths-office:exit`
 * { player, destination } lets a game mode answer with another tile before the portal opens.
 */
const Common = require("./Common.DeathsOffice");
const Instance = require("./Instance.DeathsOffice");

const ENTRANCE_ATTRIBUTE = "deaths-office:entrance";
const KNEEL = 827;
const KNEEL_DELAY = 20;
const ENTRANCE_NAMES = ["Death's Domain", "Death's domain"];

/** Each entrance loc id -> its row in data/deaths-office.json. */
const entrances = new Map();
/** A unit that can keep the player in the office (the first-death tutorial): true keeps them. */
let exitGuard = () => false;
/** Where the exit portal leads instead of the entrance (the respawn point after the tutorial). */
let exitOverride = () => null;
let greet = () => {};

function loadEntrances() {
  entrances.clear();
  const { CacheDefinitions } = Common.core();
  for (const row of Common.DATA.entrances) {
    const id = CacheDefinitions.getLocId(row.loc);
    if (id != null) entrances.set(id, row);
  }
}

function exitOf(player) {
  const loc = player.getAttribute(ENTRANCE_ATTRIBUTE);
  const row = [...entrances.values()].find((entry) => entry.loc === loc) ?? Common.DATA.entrances[0];
  return Common.location(row.exit);
}

/** The portal's destination, once any game mode has had its say. */
function destinationOf(player) {
  const query = { player, destination: exitOverride(player) ?? exitOf(player) };
  Common.api().emitCustomEvent("deaths-office:exit", query);
  return query.destination;
}

function enterOffice(event) {
  const row = entrances.get(event.objectId);
  if (!row) return false;
  const { player } = event;
  player.setAttribute(ENTRANCE_ATTRIBUTE, row.loc);
  player.performAnimation(new (Common.core().Animation)(KNEEL, KNEEL_DELAY));
  Instance.throughPortal(player, () => {
    Instance.enter(player, Common.DATA.arrival);
    Instance.approachDesk(player, () => greet(player, { arrived: true }));
  });
  return true;
}

function useExitPortal({ player }) {
  if (!Instance.inOffice(player)) return false;
  if (exitGuard(player)) return true;
  const destination = destinationOf(player);
  Instance.throughPortal(player, () => {
    Instance.leave(player, destination);
    player.setAttribute(ENTRANCE_ATTRIBUTE, null);
  });
  return true;
}

function setExitGuard(guard) {
  exitGuard = guard;
}

function setExitOverride(override) {
  exitOverride = override;
}

function onGreet(handler) {
  greet = handler;
}

function attach(api) {
  Common.bind(api);
  loadEntrances();
  api.persistAttribute(ENTRANCE_ATTRIBUTE);
  for (const name of ENTRANCE_NAMES) api.onObjectInteraction(name, { Enter: enterOffice });
  api.onObjectFirstClick(Common.ID.exitPortal, useExitPortal);
}

module.exports = { attach, setExitGuard, setExitOverride, onGreet };
