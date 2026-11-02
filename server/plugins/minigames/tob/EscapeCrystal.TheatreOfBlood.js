"use strict";

/**
 * The escape crystal (22517), in the Theatre of Blood. Wiki (Escape crystal):
 * - Teleport gets out of the raid and uses the crystal up. A worn crystal can't teleport out.
 * - Configure's first option allows using a crystal on party members; both must have one, and both
 *   are used up as the target is teleported out.
 * - Auto-afk arms it: on taking any hit (zeros too) after the configured inactivity (2-300 seconds),
 *   or right after logging in, it teleports the player out. It never fires while moving.
 * - Worn and configured for it, it acts as a ring of life.
 * - Logging out in the raid with one in the inventory uses it up, and the player comes back
 *   outside the raid (Raid.returnAfterLogout).
 * Cache: varbits teleport_crystal_afk_mode (14838), teleport_crystal_afk_delay (14849),
 * teleport_crystal_rol (14857). The client shows the armed state from them.
 * No capture opens Configure or fires the crystal: its menu's words and messages are ours.
 * Elsewhere (the Wiki's other activities) the crystal is left to those activities' own plugins.
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const CRYSTAL = Shared.ITEM.ESCAPE_CRYSTAL;
const VARBIT = { AFK_MODE: 14838, AFK_DELAY: 14849, RING_OF_LIFE: 14857 };
const ATTR = { AFK: "tob:crystal-afk", DELAY: "tob:crystal-delay", RING: "tob:crystal-ring", TEAMMATES: "tob:crystal-teammates" };
const DELAY = { MIN: 2, MAX: 300, DEFAULT: 30 };
const SECONDS_PER_TICK = 0.6;
/** Wiki: "just logged in" fires at once; how long that lasts is an estimate. */
const LOGIN_GRACE_TICKS = 10;
const RING_OF_LIFE_FRACTION = 0.1;

const delayOf = (player) => Number(player.getAttribute(ATTR.DELAY)) || DELAY.DEFAULT;

function sendState(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT.AFK_MODE, player.getAttribute(ATTR.AFK) ? 1 : 0);
  sender.sendVarbit(VARBIT.AFK_DELAY, delayOf(player));
  sender.sendVarbit(VARBIT.RING_OF_LIFE, player.getAttribute(ATTR.RING) ? 1 : 0);
}

function loggedIn({ player }) {
  player.__tobLoginCycle = Shared.cycle();
  sendState(player);
}

function wears(player) {
  const { Equipment } = Shared.core();
  return player.getEquipment().getItems()[Equipment.RING_SLOT]?.getId() === CRYSTAL;
}

function usesUp(player) {
  const { Equipment, Item } = Shared.core();
  if (player.getInventory().contains(CRYSTAL)) {
    player.getInventory().delete(CRYSTAL, 1);
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
  return raid && Shared.inTheatre(player.getLocation()) ? raid : null;
}

/** Out of the theatre; the jailed stay until the room ends. */
function escape(player, raid) {
  if (raid.member(player).jailed || !usesUp(player)) return false;
  raid.leave(player, "");
  return true;
}

function teleport(event) {
  const { player } = event;
  const raid = raidIn(player);
  if (!raid) return false;
  if (raid.member(player).jailed) return true;
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
  if (itemId !== CRYSTAL) return;
  event.handled = true;
  const raid = raidIn(player);
  if (!raid || Raid.raidOf(target) !== raid) {
    player.sendMessage("You can only use this on a member of your party in the Theatre of Blood.");
    return;
  }
  if (!player.getAttribute(ATTR.TEAMMATES)) {
    player.sendMessage("Your crystal isn't configured to be used on party members.");
    return;
  }
  if (!target.getInventory().contains(CRYSTAL) && !wears(target)) {
    player.sendMessage(`${Shared.displayName(target)} doesn't have an escape crystal.`);
    return;
  }
  if (!escape(target, raid)) return;
  usesUp(player);
  target.sendMessage(`${Shared.displayName(player)} used an escape crystal to teleport you to safety.`);
  player.sendMessage(`You teleport ${Shared.displayName(target)} to safety.`);
}

function afkFires(player) {
  if (!player.getAttribute(ATTR.AFK) || !player.getInventory().contains(CRYSTAL) && !wears(player)) return false;
  if (player.getMovementQueue().isMovings()) return false;
  const now = Shared.cycle();
  if (now - (player.__tobLoginCycle ?? -LOGIN_GRACE_TICKS - 1) <= LOGIN_GRACE_TICKS) return true;
  return (now - (player.lastInputCycle ?? 0)) * SECONDS_PER_TICK >= delayOf(player);
}

function ringFires(player, damage) {
  if (!player.getAttribute(ATTR.RING) || !wears(player)) return false;
  const { Skill } = Shared.core();
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  const after = player.getHitpoints() - damage;
  return after > 0 && after <= max * RING_OF_LIFE_FRACTION;
}

/**
 * Every damage as it's applied ("combat:damage-apply" { target, hit: HitDamage }): ordinary combat
 * hits and direct ones alike (the rooms' hazards, poison). Once a crystal fires, the rest of the
 * tick's hits don't use another.
 */
function damageApplied({ target, hit }) {
  if (!target?.isPlayer?.()) return;
  const player = target.getAsPlayer?.() ?? target;
  if (player.__tobEscapedCycle === Shared.cycle()) return;
  const raid = raidIn(player);
  if (!raid || raid.member(player).jailed || !raid.players.includes(player)) return;
  const damage = Math.max(0, hit?.getDamage?.() ?? 0);
  if ((afkFires(player) || ringFires(player, damage)) && escape(player, raid)) player.__tobEscapedCycle = Shared.cycle();
}

/** Wiki: a logout in the raid with a crystal uses it; the player returns outside. */
function usedOnLogin(player) {
  if (!player.getInventory().contains(CRYSTAL)) return false;
  player.getInventory().delete(CRYSTAL, 1);
  return true;
}

module.exports = function registerTheatreEscapeCrystal(api) {
  Shared.bind(api);
  for (const attribute of Object.values(ATTR)) api.persistAttribute(attribute);
  api.onPlayerLogin(loggedIn);
  api.onItemAction("Escape crystal", { Teleport: teleport, "Auto-afk": toggleAfk, Configure: configure });
  api.onItemOnPlayer(useOnPlayer);
  api.onCustomEvent("combat:damage-apply", damageApplied);
};

Object.assign(module.exports, { ATTR, teleport, toggleAfk, configure, useOnPlayer, damageApplied, afkFires, ringFires, usedOnLogin, wears, usesUp, delayOf });
