"use strict";

/**
 * The escape crystal (22517, tob_teleport), in the Tombs of Amascut. Wiki (Escape crystal):
 * - Teleport gets out of the raid and uses the crystal up. A worn crystal can't teleport out.
 * - Configure's first option allows using a crystal on party members; both must have one, and both
 *   are used up as the target is teleported out ("Using the escape crystal on another player in
 *   the raid no longer consumes two crystals" is about the user's own: one each).
 * - Auto-afk arms it: on taking any hit (zeros too) after the configured inactivity (2-300 seconds),
 *   or right after logging in, it teleports the player out. It never fires while moving. Ours: not
 *   on a hit that kills (that's a safe raid death), and nothing lands during the teleport.
 * - Worn and configured for it, it acts as a ring of life.
 * - Logging out in the raid with one in the inventory uses it up, and the player comes back
 *   outside the raid (Raid.onLogout).
 * Cache: varbits teleport_crystal_afk_mode (14838), teleport_crystal_afk_delay (14849),
 * teleport_crystal_rol (14857). The client shows the armed state from them.
 * No capture opens Configure or fires the crystal: its menu's words and messages are the Theatre's.
 * Configure and Auto-afk set the crystal up wherever it is, and the Theatre of Blood's unit already
 * answers them for every crystal: its settings are read from there (`escape-crystal:settings`), so
 * one configuration serves both raids. Teleport, use on a teammate, firing and logging out are
 * this unit's inside the tombs; elsewhere every handler here returns false.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const DEFAULT_DELAY = 30;
const SECONDS_PER_TICK = 0.6;
/** Wiki: "just logged in" fires at once; how long that lasts is an estimate. */
const LOGIN_GRACE_TICKS = 10;
const RING_OF_LIFE_FRACTION = 0.1;

const crystalId = () => Shared.escapeCrystalId();

/** Auto-afk, its delay, ring of life and use on teammates, as Configure left them. */
function settingsOf(player) {
  const request = { player, afk: false, delay: DEFAULT_DELAY, ring: false, teammates: false };
  Shared.api().emitCustomEvent("escape-crystal:settings", request);
  return request;
}

function loggedIn({ player }) {
  player.__toaLoginCycle = Shared.cycle();
}

function wears(player) {
  const { Equipment } = Shared.core();
  return player.getEquipment().getItems()[Equipment.RING_SLOT]?.getId() === crystalId();
}

function usesUp(player) {
  const { Equipment, Item } = Shared.core();
  if (player.getInventory().contains(crystalId())) {
    player.getInventory().delete(crystalId(), 1);
    return true;
  }
  if (!wears(player)) return false;
  const equipment = player.getEquipment();
  const worn = equipment.getItems()[Equipment.RING_SLOT];
  if (worn.getAmount() > 1) worn.setAmount(worn.getAmount() - 1);
  else equipment.setItem(Equipment.RING_SLOT, new Item(-1, 0));
  equipment.refreshItems();
  return true;
}

function raidIn(player) {
  const raid = Raid.raidOf(player);
  return raid && Shared.inTombs(player.getLocation()) ? raid : null;
}

/** Out of the tombs to the lobby; ghosts wait for the room to end. */
function escape(player, raid) {
  if (raid.member(player).ghost || !usesUp(player)) return false;
  player.__toaEscaping = true;
  raid.leave(player, { teleport: true, arrived: () => { player.__toaEscaping = false; } });
  return true;
}

/**
 * Between the crystal firing and the move out (the fade), the player is no longer in the raid, so a
 * death there would be an ordinary, dangerous one: nothing lands until they're out of the tombs.
 * No capture shows a hit during the crystal's teleport. Returns whether this hit was stopped.
 */
function shielded(player, hit) {
  if (!player.__toaEscaping) return false;
  if (!Shared.inTombs(player.getLocation())) {
    player.__toaEscaping = false;
    return false;
  }
  hit?.setDamage?.(0);
  return true;
}

function teleport(event) {
  const { player } = event;
  const raid = raidIn(player);
  if (!raid) return false;
  if (raid.member(player).ghost) return true;
  if (wears(player)) {
    player.sendMessage("You need to take the crystal off to teleport with it.");
    return true;
  }
  escape(player, raid);
  return true;
}

/** A crystal on a party member: needs their crystal too, and uses up both. */
function useOnPlayer(event) {
  const { player, target, itemId } = event;
  if (itemId !== crystalId()) return;
  const raid = raidIn(player);
  if (!raid) return;
  event.handled = true;
  if (Raid.raidOf(target) !== raid) {
    player.sendMessage("You can only use this on a member of your party in the Tombs of Amascut.");
    return;
  }
  if (!settingsOf(player).teammates) {
    player.sendMessage("Your crystal isn't configured to be used on party members.");
    return;
  }
  if (!target.getInventory().contains(crystalId()) && !wears(target)) {
    player.sendMessage(`${Shared.displayName(target)} doesn't have an escape crystal.`);
    return;
  }
  if (!escape(target, raid)) return;
  usesUp(player);
  target.sendMessage(`${Shared.displayName(player)} used an escape crystal to teleport you to safety.`);
  player.sendMessage(`You teleport ${Shared.displayName(target)} to safety.`);
}

function afkFires(player, settings = settingsOf(player)) {
  if (!settings.afk || (!player.getInventory().contains(crystalId()) && !wears(player))) return false;
  if (player.getMovementQueue().isMovings()) return false;
  const now = Shared.cycle();
  if (now - (player.__toaLoginCycle ?? -LOGIN_GRACE_TICKS - 1) <= LOGIN_GRACE_TICKS) return true;
  return (now - (player.lastInputCycle ?? 0)) * SECONDS_PER_TICK >= settings.delay;
}

function ringFires(player, damage, settings = settingsOf(player)) {
  if (!settings.ring || !wears(player)) return false;
  const { Skill } = Shared.core();
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  const after = player.getHitpoints() - damage;
  return after > 0 && after <= max * RING_OF_LIFE_FRACTION;
}

/**
 * Every damage as it's applied ("combat:damage-apply" { target, hit: HitDamage }): ordinary hits
 * and the rooms' direct ones alike (Zebak's blood barrage, the Wardens' orbs go through
 * Shared.damage, which never reaches the hit-modify hook). Once a crystal fires, the rest of the
 * tick's hits don't use another.
 */
function damageApplied({ target, hit }) {
  if (!target?.isPlayer?.()) return;
  const player = target.getAsPlayer?.() ?? target;
  if (shielded(player, hit) || player.__toaEscapedCycle === Shared.cycle()) return;
  const raid = raidIn(player);
  if (!raid || raid.member(player).ghost || !raid.players.includes(player)) return;
  const damage = Math.max(0, hit?.getDamage?.() ?? 0);
  // A killing hit is a raid death, safe as any other: firing first would take the player out of
  // the raid's protection before this hit lands (the crystal used, the items lost).
  if (damage >= player.getHitpoints()) return;
  const settings = settingsOf(player);
  if ((afkFires(player, settings) || ringFires(player, damage, settings)) && escape(player, raid)) player.__toaEscapedCycle = Shared.cycle();
}

module.exports = function registerTombsEscapeCrystal(api) {
  Shared.bind(api);
  api.onPlayerLogin(loggedIn);
  api.onItemAction("Escape crystal", { Teleport: teleport });
  api.onItemOnPlayer(useOnPlayer);
  api.onCustomEvent("combat:damage-apply", damageApplied);
};

Object.assign(module.exports, { teleport, useOnPlayer, damageApplied, shielded, settingsOf, afkFires, ringFires, wears, usesUp });
