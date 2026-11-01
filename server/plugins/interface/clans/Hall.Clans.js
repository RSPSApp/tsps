/**
 * The Clan Hall: the hub's portal into the cache's hall map, private to each clan, and the coffer.
 * No recording holds any of this, so the arrival tiles, prompts and refusals are ours; the objects
 * and their ops are the cache's and the rules the Wiki's (docs/clans.md).
 */

const Contents = require("./Contents.Clans");
const Core = require("./Core.Clans");
const Store = require("./Store.Clans");

const EXIT_PORTAL = 41617;
const HALL_BOUNDS = { minX: 1728, maxX: 1791, minY: 5440, maxY: 5503 };
const HALL_ARRIVAL = [1759, 5486, 0]; // below the exit portal at 1759,5488
const HUB_ARRIVAL = [3185, 3470, 0]; // beside the hub's portal at 3186,3471

const ENTER_HALL_SETTING = 23;
const MAX_HALL_PLAYERS = 2000; // Wiki: Clan Settings
const COFFER_DEPOSIT_SETTING = 19;
const COFFER_WITHDRAW_SETTING = 20;
const COFFER_VAR = 3; // %varclan_3, which clan_storage_main_drawcoins shows

const COFFER_GROUP = 696;
const COFFER_SIDE_GROUP = 697;
const MODAL_UID = (161 << 16) | 16;
const SIDE_MODAL_UID = (161 << 16) | 74;
const WITHDRAW_BUTTONS = { 7: 1, 8: 1000, 9: 1000000, 10: 10000000 };
const WITHDRAW_X = 11;
const WITHDRAW_ALL = 12;
const DEPOSIT_BUTTONS = { 5: 1, 6: 1000, 7: 1000000, 8: 10000000 };
const DEPOSIT_X = 9;
const DEPOSIT_ALL = 10;
const MAX_TRANSACTION = 50000000; // Wiki: Clan Hall
const MAX_COINS = 2147483647;

let core = null;
const halls = new Map();
const hallOfPlayer = new Map();

function init(apiCore) {
  core = apiCore;
}

function hallFor(clan) {
  let hall = halls.get(clan.key);
  if (!hall) {
    const { Boundary, Location, PrivateArea } = core;
    hall = new (class ClanHall extends PrivateArea {
      constructor() {
        super([new Boundary(HALL_BOUNDS.minX, HALL_BOUNDS.maxX, HALL_BOUNDS.minY, HALL_BOUNDS.maxY, 0)]);
      }
      canAttack() {
        return false;
      }
      postLeave(mobile, logout) {
        hallOfPlayer.delete(mobile);
        const visitors = this.getPlayers().filter((visitor) => visitor !== mobile);
        // Wiki: the chest's items are lost when the last non-guest leaves.
        if (!visitors.some((visitor) => Core.clanOf(visitor) === clan)) this.chest = [];
        if (visitors.length === 0) {
          Contents.clear(this);
          halls.delete(clan.key);
        }
        super.postLeave(mobile, logout);
        if (logout) mobile.moveTo(new Location(...HUB_ARRIVAL));
      }
    })();
    halls.set(clan.key, hall);
    Contents.furnish(hall);
  }
  return hall;
}

/** The hall a player stands in, and whose: Contents.Clans.js asks. */
function hallOf(player) {
  return hallOfPlayer.get(player) ?? null;
}

function enter(player, clan, rank) {
  if (rank < Core.permissionRank(clan, ENTER_HALL_SETTING)) {
    player.sendMessage("You are not a high enough rank to enter this clan's hall.");
    return;
  }
  const hall = hallFor(clan);
  if (clan.hall?.locked) {
    player.sendMessage("This clan's hall is locked.");
    return;
  }
  if (hall.getPlayers().length >= (clan.hall?.players ?? MAX_HALL_PLAYERS)) {
    player.sendMessage("This clan's hall is full.");
    return;
  }
  hall.enter(player);
  hallOfPlayer.set(player, { hall, clan });
  player.moveTo(new core.Location(...HALL_ARRIVAL));
}

function enterOwn({ player }) {
  const clan = Core.clanOf(player);
  if (!clan) {
    player.sendMessage("You are not in a clan.");
    return true;
  }
  enter(player, clan, Core.memberOf(clan, Core.accountOf(player)).rank);
  return true;
}

function enterGuest({ player }) {
  const clan = Core.guestClanOf(player);
  if (!clan) {
    player.sendMessage("You are not viewing a clan as a guest.");
    return true;
  }
  if (Core.isBanned(clan, player.getUsername())) {
    player.sendMessage("You are banned from this clan.");
    return true;
  }
  enter(player, clan, -1);
  return true;
}

function leave({ player, objectId }) {
  if (objectId !== EXIT_PORTAL) return false;
  player.moveTo(new core.Location(...HUB_ARRIVAL));
  return true;
}

// ---------------------------------------------------------------- the coffer

function coins(clan) {
  return clan.coffer ?? 0;
}

function hallClan(player) {
  return Core.clanOf(player);
}

function canUse(player, clan, setting) {
  const own = Core.memberOf(clan, Core.accountOf(player));
  return !!own && own.rank >= Core.permissionRank(clan, setting);
}

function openCoffer(player, clan) {
  Core.sendVarClan(player, COFFER_VAR, coins(clan));
  player.getPacketSender().sendSubInterface(MODAL_UID, COFFER_GROUP, 0).sendSubInterface(SIDE_MODAL_UID, COFFER_SIDE_GROUP, 3);
}

function sendCofferToAll(clan) {
  Store.save();
  for (const member of clan.members) {
    const online = Core.onlinePlayer(member.account);
    if (online) Core.sendVarClan(online, COFFER_VAR, coins(clan));
  }
}

function deposit(player, clan, amount) {
  if (!canUse(player, clan, COFFER_DEPOSIT_SETTING)) {
    player.sendMessage("You are not a high enough rank to deposit into the coffer.");
    return;
  }
  if (Core.ironmanMode(player) !== "none") {
    player.sendMessage("Ironmen can't deposit into the coffer.");
    return;
  }
  const inventory = player.getInventory();
  const carried = inventory.getAmount(core.ItemIdentifiers.COINS);
  const moved = Math.min(amount, carried, MAX_COINS - coins(clan), MAX_TRANSACTION);
  if (moved <= 0) {
    player.sendMessage(carried <= 0 ? "You have no coins to deposit." : "The coffer can't hold any more.");
    return;
  }
  inventory.delete(core.ItemIdentifiers.COINS, moved);
  clan.coffer = coins(clan) + moved;
  sendCofferToAll(clan);
}

function withdraw(player, clan, amount) {
  if (!canUse(player, clan, COFFER_WITHDRAW_SETTING)) {
    player.sendMessage("You are not a high enough rank to withdraw from the coffer.");
    return;
  }
  const inventory = player.getInventory();
  const room = MAX_COINS - inventory.getAmount(core.ItemIdentifiers.COINS);
  const moved = Math.min(amount, coins(clan), room, MAX_TRANSACTION);
  if (moved <= 0) {
    player.sendMessage(coins(clan) <= 0 ? "The coffer is empty." : "You can't carry any more coins.");
    return;
  }
  if (inventory.getAmount(core.ItemIdentifiers.COINS) === 0 && inventory.getFreeSlots() < 1) {
    player.sendMessage("You need more inventory space for that.");
    return;
  }
  clan.coffer = coins(clan) - moved;
  inventory.adds(core.ItemIdentifiers.COINS, moved);
  sendCofferToAll(clan);
  // Wiki: a withdrawal notifies the members.
  const notice = `${player.getUsername()} has withdrawn ${moved.toLocaleString("en-GB")} coins from the coffer.`;
  for (const member of clan.members) Core.onlinePlayer(member.account)?.sendMessage(notice);
}

function askAmount(player, title, onAmount) {
  player.setEnteredAmountAction({ execute: onAmount });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

function useCoffer({ player }) {
  const clan = hallClan(player);
  if (!clan) {
    player.sendMessage("Only members of the clan can use its coffer.");
    return true;
  }
  openCoffer(player, clan);
  return true;
}

function clickCofferSide(player, clan, childId) {
  const carried = player.getInventory().getAmount(core.ItemIdentifiers.COINS);
  if (DEPOSIT_BUTTONS[childId]) deposit(player, clan, DEPOSIT_BUTTONS[childId]);
  else if (childId === DEPOSIT_ALL) deposit(player, clan, carried);
  else if (childId === DEPOSIT_X) askAmount(player, "Enter an amount to deposit in the coffer:", (amount) => deposit(player, clan, amount));
}

function clickCoffer(event) {
  if (event.groupId !== COFFER_GROUP && event.groupId !== COFFER_SIDE_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const clan = hallClan(player);
  if (!clan) return;
  if (event.groupId === COFFER_SIDE_GROUP) clickCofferSide(player, clan, childId);
  else if (WITHDRAW_BUTTONS[childId]) withdraw(player, clan, WITHDRAW_BUTTONS[childId]);
  else if (childId === WITHDRAW_ALL) withdraw(player, clan, coins(clan));
  else if (childId === WITHDRAW_X) askAmount(player, "Enter an amount to withdraw:", (amount) => withdraw(player, clan, amount));
}

function reset() {
  halls.clear();
  hallOfPlayer.clear();
}

module.exports = { clickCoffer, enterGuest, enterOwn, hallOf, init, leave, reset, useCoffer };
