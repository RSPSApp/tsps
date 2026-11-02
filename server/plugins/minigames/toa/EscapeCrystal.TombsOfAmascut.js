"use strict";

/**
 * The escape crystal (22517, tob_teleport), in the Tombs of Amascut. Wiki (Escape crystal):
 * - Teleport gets out of the raid and uses the crystal up. A worn crystal can't teleport out.
 * - Configure's first option allows using a crystal on party members; both must have one, and both
 *   are used up as the target is teleported out ("Using the escape crystal on another player in
 *   the raid no longer consumes two crystals" is about the user's own: one each).
 * - Auto-afk arms it: on taking any hit (zeros too) after the configured inactivity (2-300 seconds),
 *   or right after logging in, it teleports the player out. It never fires while moving.
 * - Worn and configured for it, it acts as a ring of life.
 * - Logging out in the raid with one in the inventory uses it up, and the player comes back
 *   outside the raid (Raid.onLogout).
 * Cache: varbits teleport_crystal_afk_mode (14838), teleport_crystal_afk_delay (14849),
 * teleport_crystal_rol (14857). The client shows the armed state from them.
 * No capture opens Configure or fires the crystal: its menu's words and messages are the Theatre's.
 * Elsewhere the crystal is left to those activities' own plugins: every handler returns false
 * outside the tombs.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const VARBIT = { AFK_MODE: 14838, AFK_DELAY: 14849, RING_OF_LIFE: 14857 };
const ATTR = { AFK: "escape-crystal:afk", DELAY: "escape-crystal:delay", RING: "escape-crystal:ring", TEAMMATES: "escape-crystal:teammates" };
const DELAY = { MIN: 2, MAX: 300, DEFAULT: 30 };
const SECONDS_PER_TICK = 0.6;
/** Wiki: "just logged in" fires at once; how long that lasts is an estimate. */
const LOGIN_GRACE_TICKS = 10;
const RING_OF_LIFE_FRACTION = 0.1;

const crystalId = () => Shared.escapeCrystalId();
const delayOf = (player) => Number(player.getAttribute(ATTR.DELAY)) || DELAY.DEFAULT;

function sendState(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT.AFK_MODE, player.getAttribute(ATTR.AFK) ? 1 : 0);
  sender.sendVarbit(VARBIT.AFK_DELAY, delayOf(player));
  sender.sendVarbit(VARBIT.RING_OF_LIFE, player.getAttribute(ATTR.RING) ? 1 : 0);
}

function loggedIn({ player }) {
  player.__toaLoginCycle = Shared.cycle();
  sendState(player);
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
  raid.leave(player, { teleport: true });
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

function toggleAfk({ player }) {
  const armed = !player.getAttribute(ATTR.AFK);
  player.setAttribute(ATTR.AFK, armed);
  sendState(player);
  player.sendMessage(armed ? `Your crystal is now active. It will teleport you after ${delayOf(player)} seconds of inactivity.` : "Your crystal is no longer active.");
  return true;
}

function configure({ player }) {
  const teammates = !!player.getAttribute(ATTR.TEAMMATES);
  const ring = !!player.getAttribute(ATTR.RING);
  Shared.options(player, "Configure your escape crystal.",
    `${teammates ? "Disable" : "Enable"} use on party members.`, () => {
      player.setAttribute(ATTR.TEAMMATES, !teammates);
      player.sendMessage(teammates ? "Your crystal can no longer be used on party members." : "Your crystal can now be used on party members.");
    },
    `Set the inactivity timer. (Currently ${delayOf(player)} seconds)`, () => {
      player.setEnteredAmountAction({
        execute: (value) => {
          player.setAttribute(ATTR.DELAY, Math.max(DELAY.MIN, Math.min(DELAY.MAX, value | 0)));
          sendState(player);
          player.sendMessage(`Your crystal's inactivity timer is now ${delayOf(player)} seconds.`);
        },
      });
      player.getPacketSender().sendEnterAmountPrompt(`Seconds of inactivity (${DELAY.MIN}-${DELAY.MAX}):`);
    },
    `${ring ? "Disable" : "Enable"} acting as a ring of life when worn.`, () => {
      player.setAttribute(ATTR.RING, !ring);
      sendState(player);
      player.sendMessage(ring ? "Your crystal will no longer act as a ring of life." : "Your crystal will now act as a ring of life when worn.");
    },
    "Cancel.", () => {});
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
  if (!player.getAttribute(ATTR.TEAMMATES)) {
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

function afkFires(player) {
  if (!player.getAttribute(ATTR.AFK) || (!player.getInventory().contains(crystalId()) && !wears(player))) return false;
  if (player.getMovementQueue().hasNext?.() || player.getMovementQueue().isMoving?.()) return false;
  const now = Shared.cycle();
  if (now - (player.__toaLoginCycle ?? -LOGIN_GRACE_TICKS - 1) <= LOGIN_GRACE_TICKS) return true;
  return (now - (player.lastInputCycle ?? 0)) * SECONDS_PER_TICK >= delayOf(player);
}

function ringFires(player, hit) {
  if (!player.getAttribute(ATTR.RING) || !wears(player)) return false;
  const { Skill } = Shared.core();
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  const after = player.getHitpoints() - (hit?.getTotalDamage?.() ?? 0);
  return after > 0 && after <= max * RING_OF_LIFE_FRACTION;
}

function hitTaken({ player, hit }) {
  const raid = raidIn(player);
  if (!raid || raid.member(player).ghost || !raid.players.includes(player)) return;
  if (afkFires(player) || ringFires(player, hit)) escape(player, raid);
}

module.exports = function registerTombsEscapeCrystal(api) {
  Shared.bind(api);
  for (const attribute of Object.values(ATTR)) api.persistAttribute(attribute);
  api.onPlayerLogin(loggedIn);
  api.onItemAction("Escape crystal", { Teleport: teleport, "Auto-afk": toggleAfk, Configure: configure });
  api.onItemOnPlayer(useOnPlayer);
  api.onPlayerHitModify(hitTaken);
};

Object.assign(module.exports, { ATTR, teleport, toggleAfk, configure, useOnPlayer, hitTaken, afkFires, ringFires, wears, usesUp, delayOf });
