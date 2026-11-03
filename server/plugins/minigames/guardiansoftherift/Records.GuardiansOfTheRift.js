"use strict";

/**
 * What a player keeps between games: the rifts closed (varp total_gotr_kills), the elemental and
 * catalytic energy banked for the Rewards Guardian ("Total elemental energy" in the end-of-game
 * messages), the times they've searched the rift, and the permanent gotr_perm_0 settings
 * (talisman toggles, the colourful fade, the needle and Cordelia's contact). Abyssal pearls are
 * the inventory item; the helpers here count, give and take them.
 *
 * Varps aren't saved here, so each one is an attribute re-sent at login.
 */

const Shared = require("./Shared.GuardiansOfTheRift");

const RIFTS_CLOSED_ATTRIBUTE = "guardians-of-the-rift:rifts-closed";
const ELEMENTAL_POINTS_ATTRIBUTE = "guardians-of-the-rift:elemental-points";
const CATALYTIC_POINTS_ATTRIBUTE = "guardians-of-the-rift:catalytic-points";
const SEARCHES_ATTRIBUTE = "guardians-of-the-rift:searches";
/** The old saved pearl balance, read once to give the pearls back as items. */
const PEARLS_ATTRIBUTE = "shop-currency:Abyssal pearls";
/** Permanent varbits by gameval name. */
const SETTINGS_ATTRIBUTE = "guardians-of-the-rift:settings";

function number(player, key) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));
}

function riftsClosed(player) {
  return number(player, RIFTS_CLOSED_ATTRIBUTE);
}

function addRiftClosed(player) {
  const closed = riftsClosed(player) + 1;
  player.setAttribute(RIFTS_CLOSED_ATTRIBUTE, closed);
  Shared.setVarp(player, Shared.VARP.RIFTS_CLOSED, closed);
  return closed;
}

function points(player) {
  return { elemental: number(player, ELEMENTAL_POINTS_ATTRIBUTE), catalytic: number(player, CATALYTIC_POINTS_ATTRIBUTE) };
}

function setPoints(player, elemental, catalytic) {
  player.setAttribute(ELEMENTAL_POINTS_ATTRIBUTE, Math.max(0, elemental));
  player.setAttribute(CATALYTIC_POINTS_ATTRIBUTE, Math.max(0, catalytic));
}

/** Players already checked for a saved pearl balance this session. */
const balanceChecked = new WeakSet();

/**
 * Gives up to `amount` of an item, the inventory first and then the bank, and returns how many
 * each one took. A full bank refuses what it can't hold without saying so, so it is counted.
 */
function giveOrBank(player, itemId, amount) {
  const { Item, Bank } = Shared.core();
  const inventory = player.getInventory();
  const held = inventory.getAmount(itemId);
  const fits = Math.min(amount, inventory.getAddableAmount(new Item(itemId, amount)));
  if (fits > 0) {
    inventory.adds(itemId, fits);
    inventory.refreshItems();
  }
  const given = { inventory: inventory.getAmount(itemId) - held, bank: 0 };
  if (amount > given.inventory) {
    const bank = player.getBank(Bank.getTabForItem(player, itemId));
    const banked = bank.getAmount(itemId);
    bank.add(new Item(itemId, amount - given.inventory), false);
    given.bank = bank.getAmount(itemId) - banked;
  }
  return given;
}

/**
 * For a while pearls were a saved balance rather than the item (issue 1986 reverted it: they are
 * the abyssal_pearl item, as on live). A balance left from then comes back as pearls. Whatever
 * doesn't fit stays saved and is tried again at the next login.
 */
function restoreSavedPearls(player) {
  if (!player || balanceChecked.has(player)) return 0;
  balanceChecked.add(player);
  const saved = number(player, PEARLS_ATTRIBUTE);
  if (saved <= 0) return 0;
  const given = giveOrBank(player, Shared.obj(Shared.ITEM.PEARL), saved);
  const returned = given.inventory + given.bank;
  const waiting = saved - returned;
  if (returned > 0) {
    player.setAttribute(PEARLS_ATTRIBUTE, waiting);
    const place = given.bank === 0 ? "inventory" : given.inventory === 0 ? "bank" : "inventory and bank";
    player.sendMessage?.(`Your ${Shared.formatNumber(returned)} abyssal pearls have been returned to your ${place}.`);
    Shared.api().emitCustomEvent("persistence:save", { player, reason: "guardians-of-the-rift-pearl-restore" });
  }
  if (waiting > 0) {
    player.sendMessage?.(`${Shared.formatNumber(waiting)} abyssal pearls are waiting for you: make room in your inventory or bank and log in again.`);
  }
  return returned;
}

/** Abyssal pearls: the item in the inventory (Wiki: Felix and Cordelia take them from it). */
function pearls(player) {
  return Shared.count(player, Shared.ITEM.PEARL);
}

function addPearls(player, amount) {
  const value = Math.max(0, Math.trunc(Number(amount) || 0));
  if (value > 0) giveOrBank(player, Shared.obj(Shared.ITEM.PEARL), value);
  return pearls(player);
}

/** Takes `amount` pearls if the whole price is there; a refused purchase changes nothing. */
function spendPearls(player, amount) {
  const price = Math.max(0, Math.trunc(Number(amount) || 0));
  if (price <= 0) return true;
  if (pearls(player) < price) return false;
  player.getInventory().delete(Shared.obj(Shared.ITEM.PEARL), price);
  player.getInventory().refreshItems();
  return true;
}

function searches(player) {
  return number(player, SEARCHES_ATTRIBUTE);
}

function addSearches(player, count) {
  player.setAttribute(SEARCHES_ATTRIBUTE, searches(player) + count);
}

function settings(player) {
  const value = player.getAttribute(SETTINGS_ATTRIBUTE);
  return value && typeof value === "object" ? value : {};
}

function setting(player, varbit) {
  return Number(settings(player)[varbit]) || 0;
}

function setSetting(player, varbit, value) {
  const next = { ...settings(player) };
  if (value) next[varbit] = value;
  else delete next[varbit];
  player.setAttribute(SETTINGS_ATTRIBUTE, next);
  Shared.setVarbit(player, varbit, value);
}

function login({ player }) {
  restoreSavedPearls(player);
  Shared.setVarp(player, Shared.VARP.RIFTS_CLOSED, riftsClosed(player));
  for (const [varbit, value] of Object.entries(settings(player))) Shared.setVarbit(player, varbit, Number(value) || 0);
}

module.exports = {
  RIFTS_CLOSED_ATTRIBUTE, ELEMENTAL_POINTS_ATTRIBUTE, CATALYTIC_POINTS_ATTRIBUTE, SEARCHES_ATTRIBUTE,
  SETTINGS_ATTRIBUTE, PEARLS_ATTRIBUTE,
  riftsClosed, addRiftClosed, points, setPoints, pearls, addPearls, spendPearls,
  restoreSavedPearls, login,
  searches, addSearches, setting, setSetting,
  attach(api) {
    api.persistAttribute(RIFTS_CLOSED_ATTRIBUTE, 0);
    api.persistAttribute(ELEMENTAL_POINTS_ATTRIBUTE, 0);
    api.persistAttribute(CATALYTIC_POINTS_ATTRIBUTE, 0);
    api.persistAttribute(SEARCHES_ATTRIBUTE, 0);
    api.persistAttribute(PEARLS_ATTRIBUTE, 0);
    api.persistAttribute(SETTINGS_ATTRIBUTE, {});
    api.onPlayerLogin(login);
  },
};
