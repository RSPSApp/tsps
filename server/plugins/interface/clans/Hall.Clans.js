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
/**
 * The last coffer transfer this player's save includes. clans.json and the player's save commit
 * separately, so each transfer is journalled in the clan under the player's next number, and the
 * number moves in the same snapshot as the inventory. At login a journalled number above the saved
 * one means the player's save never got the transfer, so the coffer gives it back. Entries are per
 * character: a league character has its own save and its own number under the same name.
 */
const COFFER_SEQUENCE_ATTRIBUTE = "clans:coffer-sequence";

let api = null;
let core = null;
const halls = new Map();
const hallOfPlayer = new Map();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.persistAttribute(COFFER_SEQUENCE_ATTRIBUTE, 0);
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
        Contents.closeChest(mobile);
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
  if (clan.hall?.locked) {
    player.sendMessage("This clan's hall is locked.");
    return;
  }
  if ((halls.get(clan.key)?.getPlayers().length ?? 0) >= (clan.hall?.players ?? MAX_HALL_PLAYERS)) {
    player.sendMessage("This clan's hall is full.");
    return;
  }
  // Made only now: a refused visitor would leave its staff standing with nobody to take them away.
  const hall = hallFor(clan);
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

/** The hall the player stands in, whichever clan is their own. */
function hallClan(player) {
  return hallOf(player)?.clan ?? null;
}

/** Sends a player out of this clan's hall, if they're in it. */
function sendOut(player, clan) {
  if (hallClan(player) === clan) player.moveTo(new core.Location(...HUB_ARRIVAL));
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
  for (const member of clan.members) {
    const online = Core.onlinePlayer(member.account);
    if (online) Core.sendVarClan(online, COFFER_VAR, coins(clan));
  }
}

function characterOf(player) {
  return { account: Core.accountOf(player), profile: player.getProfile?.() ?? "main" };
}

function isCharacter(entry, { account, profile }) {
  return entry.account === account && entry.profile === profile;
}

/**
 * Writes the coffer and its journal entry before anything of the player's changes, so a failed
 * write moves nothing. The caller moves the coins straight after, with no chance of a save between.
 */
function commitTransfer(player, clan, delta) {
  const { coffer, cofferJournal } = clan;
  const sequence = (player.getAttribute(COFFER_SEQUENCE_ATTRIBUTE) ?? 0) + 1;
  clan.coffer = coins(clan) + delta;
  clan.cofferJournal = [...(cofferJournal ?? []), { ...characterOf(player), sequence, delta }];
  try {
    Store.save();
  } catch (error) {
    clan.coffer = coffer;
    clan.cofferJournal = cofferJournal;
    console.error("[clans] Couldn't save a coffer transfer", error);
    player.sendMessage("The coffer can't be used right now. Please try again.");
    return false;
  }
  player.setAttribute(COFFER_SEQUENCE_ATTRIBUTE, sequence);
  return true;
}

/** Not long to wait: the sooner the save has it, the less a crash could undo. */
function finishTransfer(player, clan) {
  api.emitCustomEvent("persistence:save", { player, reason: "clan-coffer" });
  sendCofferToAll(clan);
}

function plainCoinSlot(inventory) {
  return inventory.getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.COINS && item.isTradeable() && item.getMeta() == null);
}

/** The coffer as if this transfer never happened. If others have since spent a deposit, it's made up from the depositor's coins. */
function undoTransfer(player, clan, delta) {
  const inventory = player.getInventory();
  const undone = coins(clan) - delta;
  clan.coffer = Math.max(0, Math.min(MAX_COINS, undone));
  if (undone > MAX_COINS) inventory.forceAdd(player, new core.Item(core.ItemIdentifiers.COINS, undone - MAX_COINS));
  const slot = plainCoinSlot(inventory);
  if (undone < 0 && slot >= 0) {
    const taken = Math.min(-undone, inventory.getItems()[slot].getAmount());
    inventory.deletedItem(new core.Item(core.ItemIdentifiers.COINS, taken), slot, true);
  }
}

/**
 * A load can return a save still waiting for the writer, so an entry it covers isn't safe to forget
 * yet: a crash now would leave the older row with nothing to reconcile it. flush() resolves once the
 * writer has committed everything sent so far, which includes that save.
 */
function forgetOnceDurable(clan, character, saved) {
  core.GameConstants.PLAYER_PERSISTENCE.flush()
    .then(() => {
      if (Store.byName(clan.name) !== clan) return;
      clan.cofferJournal = (clan.cofferJournal ?? []).filter((entry) => !isCharacter(entry, character) || entry.sequence > saved);
      Store.save();
    })
    .catch((error) => console.error("[clans] Keeping coffer journal entries: the player save isn't durable yet", error));
}

/** At login: anything journalled that the save doesn't hold is undone, and the rest is let go once it's durable. */
function recoverCoffer(player) {
  const character = characterOf(player);
  const saved = player.getAttribute(COFFER_SEQUENCE_ATTRIBUTE) ?? 0;
  for (const clan of Store.all()) {
    const journal = clan.cofferJournal ?? [];
    const mine = journal.filter((entry) => isCharacter(entry, character));
    const lost = mine.filter((entry) => entry.sequence > saved);
    if (lost.length > 0) {
      clan.cofferJournal = journal.filter((entry) => !lost.includes(entry));
      for (const { delta } of lost.reverse()) undoTransfer(player, clan, delta);
      Store.save();
      sendCofferToAll(clan);
      player.sendMessage("The server restarted before your coffer transfer was saved, so it was undone.");
    }
    if (mine.length > lost.length) forgetOnceDurable(clan, character, saved);
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
  // Not a preset's coins: the coffer would hand them back as ordinary ones.
  const slot = plainCoinSlot(inventory);
  const carried = slot < 0 ? 0 : inventory.getItems()[slot].getAmount();
  const moved = Math.min(amount, carried, MAX_COINS - coins(clan), MAX_TRANSACTION);
  if (moved <= 0) {
    player.sendMessage(carried <= 0 ? "You have no coins to deposit." : "The coffer can't hold any more.");
    return;
  }
  if (!commitTransfer(player, clan, moved)) return;
  inventory.deletedItem(new core.Item(core.ItemIdentifiers.COINS, moved), slot, true);
  finishTransfer(player, clan);
}

function withdraw(player, clan, amount) {
  if (!canUse(player, clan, COFFER_WITHDRAW_SETTING)) {
    player.sendMessage("You are not a high enough rank to withdraw from the coffer.");
    return;
  }
  if (Core.ironmanMode(player) !== "none") {
    player.sendMessage("Ironmen can't withdraw from the coffer.");
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
  if (!commitTransfer(player, clan, -moved)) return;
  inventory.adds(core.ItemIdentifiers.COINS, moved);
  finishTransfer(player, clan);
  // Wiki: a withdrawal notifies the members.
  const notice = `${player.getUsername()} has withdrawn ${moved.toLocaleString("en-GB")} coins from the coffer.`;
  for (const member of clan.members) Core.onlinePlayer(member.account)?.sendMessage(notice);
}

function cofferOpen(player, clan, groupId) {
  return hallClan(player) === clan && player.getPacketSender().isSubInterfaceOpen(groupId);
}

/** The answer can come after the screen has gone, so it's checked again then. */
function askAmount(player, clan, groupId, title, onAmount) {
  player.setEnteredAmountAction({
    execute(amount) {
      if (cofferOpen(player, clan, groupId)) onAmount(amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

function useCoffer({ player }) {
  const clan = hallClan(player);
  if (!clan || !Core.memberOf(clan, Core.accountOf(player))) {
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
  else if (childId === DEPOSIT_X) askAmount(player, clan, COFFER_SIDE_GROUP, "Enter an amount to deposit in the coffer:", (amount) => deposit(player, clan, amount));
}

function clickCoffer(event) {
  if (event.groupId !== COFFER_GROUP && event.groupId !== COFFER_SIDE_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const clan = hallClan(player);
  if (!clan || !cofferOpen(player, clan, event.groupId)) return;
  if (event.groupId === COFFER_SIDE_GROUP) clickCofferSide(player, clan, childId);
  else if (WITHDRAW_BUTTONS[childId]) withdraw(player, clan, WITHDRAW_BUTTONS[childId]);
  else if (childId === WITHDRAW_ALL) withdraw(player, clan, coins(clan));
  else if (childId === WITHDRAW_X) askAmount(player, clan, COFFER_GROUP, "Enter an amount to withdraw:", (amount) => withdraw(player, clan, amount));
}

function reset() {
  halls.clear();
  hallOfPlayer.clear();
}

module.exports = { clickCoffer, enterGuest, enterOwn, hallOf, init, leave, recoverCoffer, reset, sendOut, useCoffer };
