/**
 * Reagent pouch (https://oldschool.runescape.wiki/w/Reagent_pouch; docs/storage-items.md), the
 * Mastering Mixology reward: 26 of each Herblore secondary on the Wiki's "Storable items" list.
 * Open, it takes the secondaries a player picks up. Empty works only near a bank; in the bank
 * panel its op reads Fill while the inventory holds a secondary, Empty to bank otherwise.
 *
 * Lines and order from rsprox.net recordings 4218, 4220, 4226, 4227 (Leagues VI, rev 238; the
 * pouch has no league rule of its own):
 * - Fill (op2): "You search your inventory ..." then "You add the items to your pouch." (spam), or
 *   "You don't have enough space for the items." when nothing fits (4220 t1322), or the no-items
 *   line (4218 t280 / 4220 t22).
 * - a secondary used on it: with one in the inventory it goes in at once (4220 t297); with more,
 *   the "Add one or all of this type?" chatmenu (4220 t264, t566, t987), then "You add the <name>
 *   to your sack." Full of that kind: "You don't have enough space for the <name>." (4220 t592).
 *   Anything else, noted secondaries and uncut gems included: the spoil line (4220 t38, t222).
 * - Empty (op4): the rummage line (spam) and the contents into the inventory as far as they fit
 *   (4220 t977: 25 of 26); "You have no space to put any items!" (t2603), the empty line
 *   (4218 t310), "This isn't a suitable place to empty your pouch." away from a bank (t2687).
 * - Check (op6): "You look in your Reagent pouch and see:" and one "N x <name>" line per kind, in
 *   the order they went in (4220 t1044); the empty line when it holds nothing.
 * - Open/Close (op3): the open and close lines, the item swapping in place (4218 t163, t167).
 * - bank panel op9 (4227 t28, t36, t41): Fill's lines, or "You empty your Reagent pouch into the
 *   bank.", or the empty line.
 * - a pickup with it open (4220 t4079): "You put the <name> into your Reagent pouch." (spam).
 */
const Storage = require("./Common.StorageItems");

const NAMES = ["Reagent pouch", "Open reagent pouch"];
const PER_KIND = 26;
const MESSAGE = {
  EMPTY: "The Reagent pouch is empty.",
  NO_ITEMS: "You have no items in your inventory that can be stored in the pouch.",
  SEARCH: "You search your inventory for items appropriate to put in the pouch...",
  ADDED: "You add the items to your pouch.",
  NO_ROOM: "You don't have enough space for the items.",
  SPOIL: "You can't possibly put that in there. It would spoil your pouch.",
  CHOICE: "Add one or all of this type?",
  RUMMAGE: "You rummage around to see if you can extract any items from your Reagent pouch.",
  NO_SPACE: "You have no space to put any items!",
  NOT_HERE: "This isn't a suitable place to empty your pouch.",
  CHECK: "You look in your Reagent pouch and see:",
  OPENED: "You open your Reagent pouch, ready to fill it.",
  CLOSED: "You close your Reagent pouch.",
  TO_BANK: "You empty your Reagent pouch into the bank.",
};

/** Wiki, Reagent pouch: "Storable items" (stackable and noted copies never go in). */
const STORABLE = [
  "Eye of newt", "Unicorn horn dust", "Limpwurt root", "Red spiders' eggs", "Chocolate dust",
  "White berries", "Toad's legs", "Goat horn dust", "Snape grass", "Mort myre fungus",
  "Dragon scale dust", "Yew roots", "Wine of Zamorak", "Potato cactus", "Magic roots",
  "Crushed nest", "Crushed superior dragon bones", "Ashes", "Gorak claw powder", "Jangerberries",
  "Kebbit teeth dust", "Lily of the Sands", "Nail beast nails", "Poison ivy berries", "Silver dust",
  "Aldarium", "Cactus spine", "Caviar", "Roe", "Demonic tallow", "Squid paste", "Haddock eye",
];

let storable = null;

function storableIds() {
  storable ??= new Set([...Storage.idsOf(STORABLE)].filter((id) => !Storage.isStackable(id)));
  return storable;
}

const addedLine = (id) => `You add the ${Storage.itemName(id)} to your sack.`;
const fullLine = (id) => `You don't have enough space for the ${Storage.itemName(id)}.`;
const pickedLine = (id) => `You put the ${Storage.itemName(id)} into your Reagent pouch.`;

const family = {
  key: "reagent-pouch",
  names: NAMES,
  pairs: [["mm_secondary_pouch", "mm_secondary_pouch_open"]],
  openNames: ["Open reagent pouch"],
  accepts: (id) => storableIds().has(id),
  room: (_player, id, held) => PER_KIND - (held.find((entry) => entry.id === id)?.amount ?? 0),
  gathers: (player) => Storage.hasOpen(player, family),
  gathered: (player, id) => player.sendMessage(pickedLine(id)),
  bankEmpty: bankUse,
  bankFills: (player) => Storage.inventoryIds(player).some(family.accepts),
};

function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NO_ITEMS);
    return;
  }
  player.sendMessage(MESSAGE.SEARCH);
  const moved = held.reduce((sum, id) => sum + Storage.fillFrom(player, family, id), 0);
  player.sendMessage(moved > 0 ? MESSAGE.ADDED : MESSAGE.NO_ROOM);
}

function check({ player }) {
  const held = Storage.contents(player, family);
  if (!held.length) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  player.sendMessage(MESSAGE.CHECK);
  for (const line of Storage.describe(held)) player.sendMessage(line);
}

/**
 * The shared bank check (LeagueMode's `league:near-bank`, as the meat and fur pouches and the
 * chugging barrel ask it): booths, bankers and bank chests (Wiki: the pouch works at bank chests
 * and other non-standard banks since 27 August 2025).
 */
function nearBank(player) {
  const query = { player, near: false };
  Storage.api.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

/** Ours: the empty line comes before the bank check (4218 t310 doesn't show where the player stood). */
function empty({ player }) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  if (!nearBank(player)) {
    player.sendMessage(MESSAGE.NOT_HERE);
    return;
  }
  if (Storage.contents(player, family).every(({ id }) => Storage.inventoryRoom(player, id) <= 0)) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return;
  }
  player.sendMessage(MESSAGE.RUMMAGE);
  Storage.emptyToInventory(player, family);
}

/** The bank panel's op: Fill while the inventory holds a secondary, otherwise everything into the bank. */
function bankUse(player) {
  if (family.bankFills(player)) {
    fill({ player });
    Storage.refreshBank(player);
    return;
  }
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  // Ours: a bank with no room for any of it moves nothing, so nothing is said (as the hunter pouches).
  if (Storage.emptyToBank(player, family) <= 0) return;
  player.sendMessage(MESSAGE.TO_BANK);
}

function toggle({ player, item }) {
  Storage.toggle(player, family, item);
  player.sendMessage(Storage.isOpen(family, item) ? MESSAGE.OPENED : MESSAGE.CLOSED);
}

/** Moves `amount` of `id` from the inventory into the pouch, as far as it fits, with its line. */
function addKind(player, id, amount) {
  const inventory = player.getInventory();
  const moved = Storage.store(player, family, id, Math.min(amount, inventory.getAmount(id)));
  if (moved <= 0) {
    player.sendMessage(fullLine(id));
    return;
  }
  inventory.deleteNumber(id, moved);
  player.sendMessage(addedLine(id));
}

function useOnPouch(event) {
  const { player, usedItem, usedWithItem } = event;
  const pouch = NAMES.includes(Storage.nameOf(usedItem)) ? usedItem : NAMES.includes(Storage.nameOf(usedWithItem)) ? usedWithItem : null;
  if (!pouch) return;
  const other = pouch === usedItem ? usedWithItem : usedItem;
  if (NAMES.includes(Storage.nameOf(other))) return;
  event.handled = true;
  const id = other?.getId?.();
  if (!family.accepts(id)) {
    player.sendMessage(MESSAGE.SPOIL);
    return;
  }
  if (family.room(player, id, Storage.contents(player, family)) <= 0) {
    player.sendMessage(fullLine(id));
    return;
  }
  if (player.getInventory().getAmount(id) <= 1) {
    addKind(player, id, 1);
    return;
  }
  const { DialogueChainBuilder, OptionDialogue } = Storage.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      const choice = Number(option);
      if (choice === 1) addKind(player, id, 1);
      else if (choice === 2) addKind(player, id, Number.MAX_SAFE_INTEGER);
    },
  }, "One.", "All of this type.").setTitle(MESSAGE.CHOICE)));
}

/** Wiki: secondaries a player gets while the pouch is open go in, if there is room. */
function pickup(event) {
  Storage.pickupInto(event, (player, itemId) => (family.accepts(itemId) && Storage.hasOpen(player, family)
    ? { family, message: pickedLine } : null));
}

module.exports = (api) => {
  Storage.register(family);
  for (const name of NAMES) {
    api.onItemAction(name, { Fill: fill, Open: toggle, Close: toggle, Check: check, Empty: empty });
  }
  api.onItemOnItem(useOnPouch);
  api.onGroundItemPickup(pickup);
};

Object.assign(module.exports, { NAMES, PER_KIND, STORABLE, MESSAGE, storableIds, nearBank });
