"use strict";

/**
 * Using the escape crystal: its Teleport option, and Auto-afk or the ring of life firing on a hit.
 * Every activation that saves the player says "Your escape crystal saves you and is destroyed in
 * the process." (live, as recorded by the user) and uses one crystal up.
 *
 * Where it works (Wiki: Escape crystal), and who moves the player:
 * - the Theatre of Blood and the Tombs of Amascut: their own units (they answer
 *   `escape-crystal:claimed` { player, claimed } for a player in their raid, and this unit leaves
 *   their crystals alone);
 * - every other activity the Wiki lists answers `escape-crystal:escape`
 *   { player, cause: "teleport" | "afk" | "ring", damage, handled, escaped } with its own way out
 *   (the Chambers of Xeric, the Inferno, TzHaar-Ket-Rak's Challenges, Pest Control, Barbarian
 *   Assault): it sets `handled` for a player inside, moves them out and sets `escaped`, and this
 *   unit uses the crystal up. Not the Gauntlet: it is entered empty-handed, so this crystal is never
 *   inside (its own crystals are other items);
 * - outside any of them: the Wilderness up to level 30, and anywhere a teleport is allowed where a
 *   game mode says so (`escape-crystal:anywhere` { player, allowed }: a Hardcore World). It takes
 *   the player to their respawn point (`player:respawn` { player, escape: true }, else the world's
 *   spawn).
 * After a save, `escape-crystal:escaped` { player, cause } (a Hardcore World cures poison, venom
 * and burn on it).
 * UNVERIFIED: the refusal elsewhere, "You can't use the crystal here." (ours), and that the
 * crystal moves the player without an animation of its own outside the raids.
 * Known gaps from live (docs/hardcore-worlds.md, "The Escape crystal"): idle time comes from
 * `lastInputCycle`, which no mouse or camera movement resets (live counts both), and a timer that
 * runs out mid-walk waits for the next hit instead of firing as the player stops.
 */
const Common = require("./Common.EscapeCrystal");

const SAVED = "Your escape crystal saves you and is destroyed in the process.";
const NOT_HERE = "You can't use the crystal here.";
const TAKE_OFF = "You need to take the crystal off to teleport with it.";

const escapedCycles = new WeakMap();

function claimedByRaid(player) {
  const query = { player, claimed: false };
  Common.api().emitCustomEvent("escape-crystal:claimed", query);
  return query.claimed === true;
}

function worksAnywhere(player) {
  const query = { player, allowed: false };
  Common.api().emitCustomEvent("escape-crystal:anywhere", query);
  return query.allowed === true;
}

function inShallowWilderness(player) {
  const { Wilderness } = Common.core();
  const location = player.getLocation();
  if (!Wilderness.isInLocation(location)) return false;
  return Wilderness.levelAt(location.getX(), location.getY()) <= Common.WILDERNESS_LIMIT;
}

/** Where the crystal works outside an activity of its own. */
function worksHere(player) {
  return inShallowWilderness(player) || worksAnywhere(player);
}

function saved(player, cause) {
  player.sendMessage(SAVED);
  escapedCycles.set(player, Common.cycle());
  Common.api().emitCustomEvent("escape-crystal:escaped", { player, cause });
}

/** To the player's respawn point, as a death would put them, then the crystal's gone. */
function toRespawnPoint(player, cause) {
  const { TeleportHandler, GameConstants } = Common.core();
  const destination = GameConstants.DEFAULT_LOCATION.clone();
  if (!TeleportHandler.checkReqs(player, destination, Common.WILDERNESS_LIMIT)) return false;
  if (!Common.useUp(player)) return false;
  player.getMovementQueue().reset();
  const respawn = { player, killer: null, escape: true, handled: false };
  Common.api().emitCustomEvent("player:respawn", respawn);
  if (!respawn.handled) player.moveTo(destination);
  saved(player, cause);
  return true;
}

/**
 * The crystal activates for `cause`: an activity takes the player out its own way, or (where it
 * works) the crystal takes them to their respawn point. Returns whether it saved them.
 */
function activate(player, cause, damage = 0) {
  if (!Common.carries(player)) return false;
  const request = { player, cause, damage, handled: false, escaped: false };
  Common.api().emitCustomEvent("escape-crystal:escape", request);
  if (request.handled) {
    if (request.escaped !== true) return false;
    Common.useUp(player);
    saved(player, cause);
    return true;
  }
  if (!worksHere(player)) {
    if (cause === "teleport") player.sendMessage(NOT_HERE);
    return false;
  }
  return toRespawnPoint(player, cause);
}

function teleport(event) {
  const { player } = event;
  if (claimedByRaid(player)) return false;
  if (Common.wears(player)) {
    player.sendMessage(TAKE_OFF);
    return true;
  }
  activate(player, "teleport");
  return true;
}

/**
 * Every damage as it's applied ("combat:damage-apply" { target, hit }): Auto-afk and the ring of
 * life fire here, outside the two raids' own units. Not on a hit that kills (that death is the
 * activity's or the player's), and once a tick.
 */
function damageApplied({ target, hit }) {
  if (!target?.isPlayer?.()) return;
  const player = target.getAsPlayer?.() ?? target;
  if (escapedCycles.get(player) === Common.cycle() || !Common.carries(player)) return;
  if (claimedByRaid(player)) return;
  const damage = Math.max(0, hit?.getDamage?.() ?? 0);
  if (damage >= player.getHitpoints()) return;
  const settings = Common.settingsOf(player);
  const cause = Common.afkFires(player, settings) ? "afk" : Common.ringFires(player, damage, settings) ? "ring" : null;
  if (!cause) return;
  if (activate(player, cause, damage)) hit?.setDamage?.(0);
}

function loggedIn({ player }) {
  Common.loggedIn(player);
}

module.exports = function attach(api) {
  api.onPlayerLogin(loggedIn);
  api.onItemAction("Escape crystal", { Teleport: teleport });
  api.onCustomEvent("combat:damage-apply", damageApplied);
};

Object.assign(module.exports, { SAVED, NOT_HERE, activate, teleport, damageApplied, worksHere, toRespawnPoint });
