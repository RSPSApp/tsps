"use strict";

/**
 * The theatre's books. Wiki (Theatre of Blood, Rewards; each book's page): each boss leaves its book
 * on the ground when it's beaten, and the grand bookshelves in the vault hold all six.
 * Estimates: the book lands where the player stands, only for someone without it, and a bookshelf
 * hands out the first one the player is missing. The books' text isn't transcribed here, so
 * reading one says so.
 */

const Shared = require("./Shared.TheatreOfBlood");

const ROOM_BOOKS = {
  MAIDEN: "SERAFINAS_DIARY",
  BLOAT: "THE_BUTCHER",
  NYLOCAS: "ARACHNIDS_OF_VAMPYRIUM",
  SOTETSEG: "THE_SHADOW_REALM",
  XARPUS: "THE_WILD_HUNT",
  VERZIK: "VERZIK_VITUR_PATIENT_RECORD",
};
const READABLE = ["Serafina's diary", "The Butcher", "Arachnids of Vampyrium", "The Shadow Realm", "The Wild Hunt", "Verzik Vitur - Patient Record"];

function bookId(name) {
  return Shared.core().ItemIdentifiers[name];
}

function owns(player, id) {
  const { Bank } = Shared.core();
  if (player.getInventory().contains(id) || player.getEquipment().contains?.(id)) return true;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return true;
  return false;
}

function roomWon({ room, player }) {
  const name = ROOM_BOOKS[room.key];
  if (!name || owns(player, bookId(name))) return;
  const { Item, ItemOnGroundManager } = Shared.core();
  ItemOnGroundManager.registerLocation(player, new Item(bookId(name), 1), player.getLocation().clone());
}

function searchShelf({ player }) {
  const { Item } = Shared.core();
  const missing = Object.values(ROOM_BOOKS).map(bookId).find((id) => !owns(player, id));
  if (missing === undefined) {
    player.sendMessage("You find nothing of interest that you don't already have.");
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  player.getInventory().add(new Item(missing, 1), true);
  player.sendMessage("You find a book amongst the ancient scripts.");
  return true;
}

function readBook({ player }) {
  player.sendMessage("The writing is too faded to make out.");
}

module.exports = function registerTheatreBooks(api) {
  Shared.bind(api);
  api.onCustomEvent("tob:room-won", roomWon);
  Shared.onObject(api, "Grand bookshelf", searchShelf);
  for (const name of READABLE) api.onItemAction(name, { Read: readBook });
};

Object.assign(module.exports, { ROOM_BOOKS, roomWon, searchShelf, owns });
