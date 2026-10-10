"use strict";

/**
 * Puro-Puro's way in and out. The Zanaris crop circle (object 24991 at 2427,4446) already
 * teleports to 2591,4319 through plugins/world's loc-teleport data, so this unit only gates
 * the click first: Hunter 17, non-boostable, refusing without letting the captured teleport
 * play. It also remembers the field the player entered from, which the exit portal (object
 * 25014) and a logout inside Puro-Puro return them to.
 *
 * The gate hook registers before LocTeleports (plugin paths sort minigames/ before world/),
 * so returning false hands the click on to its generic handler.
 */
const ENTRY_ATTRIBUTE = "impetuous-impulses:entry-field";
const DEFAULT_FIELD = [2427, 4446, 0];
const HUNTER_LEVEL = 17;

let core;

function init(api) {
  core = api.core;
}

function fieldOf(player) {
  const stored = player.getAttribute(ENTRY_ATTRIBUTE);
  if (Array.isArray(stored) && stored.length === 3 && stored.every((value) => Number.isInteger(value))) return stored;
  return DEFAULT_FIELD;
}

function enterCropCircle({ player, object }) {
  if (player.getSkillManager().getMaxLevel(core.Skill.HUNTER) < HUNTER_LEVEL) {
    player.sendMessage(`You need a Hunter level of ${HUNTER_LEVEL} to enter Puro-Puro.`);
    return true;
  }
  const at = object.getLocation();
  player.setAttribute(ENTRY_ATTRIBUTE, [at.getX(), at.getY(), at.getZ()]);
  return false; // Not handled: LocTeleports plays its captured entry teleport.
}

function moveToField(player) {
  const [x, y, z] = fieldOf(player);
  player.moveTo(new core.Location(x, y, z));
}

/** Logout: no packets, the position that gets saved is what matters. */
function leaveAtField(player) {
  const [x, y, z] = fieldOf(player);
  player.setLocation(new core.Location(x, y, z));
}

function exit({ player }) {
  moveToField(player);
}

function investigate({ player }) {
  player.sendMessage("You investigate the portal. It seems to lead back to the crop circle you entered through.");
}

/** The portal's Exit and Investigate share this; the option text decides which one it is. */
function portalOption(event) {
  const option = event.definition?.getInteractions()?.[event.clickType - 1];
  if (option === "Exit") {
    exit(event);
    return true;
  }
  if (option === "Investigate") {
    investigate(event);
    return true;
  }
  return false;
}

function registerEntry(api) {
  init(api);
  // By id: other crop circles share the name, and "Portal" is everywhere.
  const O = core.ObjectIdentifiers;
  api.onObjectClick([O.CENTRE_OF_CROP_CIRCLE_2], 1, enterCropCircle);
  api.onObjectClick([O.PORTAL_64], 1, portalOption);
  api.onObjectClick([O.PORTAL_64], 2, portalOption);
}

module.exports = registerEntry;
Object.assign(module.exports, {
  init,
  enterCropCircle,
  fieldOf,
  moveToField,
  leaveAtField,
  portalOption,
  ENTRY_ATTRIBUTE,
  DEFAULT_FIELD,
  _test: { init, enterCropCircle, fieldOf, moveToField, leaveAtField, portalOption },
});
