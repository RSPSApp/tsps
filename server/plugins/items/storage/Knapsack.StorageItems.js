/**
 * The Knapsack (https://oldschool.runescape.wiki/w/Knapsack; docs/storage-items.md): Barbarian
 * Gathering's container (Demonic Pacts League). It holds up to 3 different kinds of gathered item,
 * 140 in all: logs, raw and cooked fish, metallic ore, coal and clay, metal bars and pure essence
 * (`storage-items.json`). Its contents are kept on the player, as every container's here are.
 * - Open (barbarian_knapsack), what its owner gathers goes in while it has room, and a full inventory
 *   keeps gathering. Closed (barbarian_knapsack_closed), nothing goes in by itself. Both items are
 *   named "Knapsack", so open and closed are told apart by id. Its gathering is heard from the
 *   relics plugin, after Hotfoot's processing (`gathering`), so Hotfoot's cooked fish and bars go
 *   in as they are (Wiki).
 * - Fill puts in what it takes from the inventory, and an item used on it does the same. Check lists
 *   what it holds in the chatbox, as the Forager's pouch, Leagues VI's other multi-kind relic
 *   container, does (rsprox 237): a header, then "N x Item" per kind.
 * - Dispose deletes what it holds, anywhere: it asks which kind (Wiki, Relics: "dispose option will
 *   ask what to destroy").
 * - Items only come out at a bank (Wiki): the bank's "Empty containers" button, and the bank panel's
 *   Empty (its param 595), bank them.
 * Lines are ours: no recording shows the Knapsack (rsprox.net's database has neither item).
 */
const Storage = require("./Common.StorageItems");

const NAME = "Knapsack";
const OPEN = "barbarian_knapsack";
const CLOSED = "barbarian_knapsack_closed";
const CAPACITY = 140;
const KINDS = 3;
/** Ours, all of them: no recording shows the Knapsack. Check follows the Forager's pouch's recorded pattern. */
const MESSAGE = {
  FULL: "Your knapsack is full.",
  KINDS: "Your knapsack can only hold three different kinds of item.",
  NOTHING: "You have nothing your knapsack can hold.",
  CHECKED_EMPTY: "Your knapsack is empty.",
  CONTAINS: "You look in your knapsack and see:",
  CANNOT: "Your knapsack can't hold that.",
  DISPOSE_TITLE: "Dispose of what?",
  DISPOSED: "You dispose of the {item} in your knapsack.",
  EMPTIED_TO_BANK: "You empty your knapsack into the bank.",
  EMPTIED_SOME_TO_BANK: "You empty some of your knapsack's contents into the bank.",
  BANK_NO_ROOM: "Your bank cannot hold the remaining contents of your knapsack.",
};

let accepted = null;
/** What a gather will arrive as, when something changes it first (Hotfoot: `gathering`'s `product`). */
let productOf = null;

function acceptedIds() {
  if (!accepted) {
    const { DATA } = Storage;
    accepted = Storage.idsOf([
      ...DATA.logs.filter((name) => /logs$/i.test(name)),
      ...DATA.fish,
      ...DATA.knapsackCookedFish,
      ...DATA.knapsackOres,
      ...DATA.knapsackBars,
      ...DATA.knapsackOther,
    ]);
  }
  return accepted;
}

/** How many more of `id` fit: none for a fourth kind; otherwise up to 140 in all. */
function room(_player, id, held) {
  if (!held.some((entry) => entry.id === id) && held.length >= KINDS) return 0;
  return CAPACITY - held.reduce((sum, entry) => sum + entry.amount, 0);
}

const family = {
  key: "knapsack",
  names: [NAME],
  pairs: [[CLOSED, OPEN]],
  accepts: (id) => acceptedIds().has(id),
  room,
  // Its gathering is its own (`gathering`), after Hotfoot's processing, not the containers' turn.
  gathers: () => false,
  bankEmpty: emptyToBank,
};

/** Whether the player carries an open Knapsack (both items are named "Knapsack": by id). */
function carriesOpen(player) {
  const open = Storage.core.CacheDefinitions.getObjId(OPEN);
  return player.getInventory().getValidItems().some((item) => item.getId() === open);
}

/** The line for an item it won't take now: full, a fourth kind, or not a kind it holds. */
function refusal(player, id) {
  if (!family.accepts(id)) return MESSAGE.CANNOT;
  return Storage.total(player, family) >= CAPACITY ? MESSAGE.FULL : MESSAGE.KINDS;
}

function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NOTHING);
    return;
  }
  let moved = 0;
  for (const id of held) moved += Storage.fillFrom(player, family, id);
  player.getInventory().refreshItems();
  if (moved === 0) player.sendMessage(refusal(player, held[0]));
}

/** Chatbox lines, as the Forager's pouch's Check (rsprox 237): the header, then each kind or the empty line. */
function check({ player }) {
  const held = Storage.contents(player, family);
  player.sendMessage(MESSAGE.CONTAINS);
  if (!held.length) {
    player.sendMessage(MESSAGE.CHECKED_EMPTY);
    return;
  }
  for (const line of Storage.describe(held)) player.sendMessage(line);
}

function toggle({ player, item }) {
  Storage.toggle(player, family, item);
}

/** Dispose: asks which kind it holds to delete (Wiki, Relics). */
function dispose({ player }) {
  const held = Storage.contents(player, family);
  if (!held.length) {
    player.sendMessage(MESSAGE.CHECKED_EMPTY);
    return;
  }
  const { DialogueChainBuilder, OptionDialogue } = Storage.core;
  const names = held.map(({ id }) => Storage.itemName(id));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
    executeOption(option) {
      player.getPacketSender().sendInterfaceRemoval();
      const entry = held[Number(option) - 1];
      if (!entry) return;
      Storage.take(player, family, entry.id, Storage.amountOf(player, family, entry.id));
      player.sendMessage(MESSAGE.DISPOSED.replace("{item}", Storage.itemName(entry.id)));
    },
  }, ...names, "Nothing.").setTitle(MESSAGE.DISPOSE_TITLE)));
}

function emptyToBank(player) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.CHECKED_EMPTY);
    return;
  }
  const moved = Storage.emptyToBank(player, family);
  const left = Storage.total(player, family);
  player.sendMessage(left === 0 ? MESSAGE.EMPTIED_TO_BANK : moved > 0 ? MESSAGE.EMPTIED_SOME_TO_BANK : MESSAGE.BANK_NO_ROOM);
}

/** The bank's "Empty containers" button: a carried Knapsack's contents go into the bank. */
function emptyContainers({ player }) {
  if (!Storage.core.Bank.isOpen(player) || !Storage.carried(player, family).length) return;
  if (Storage.total(player, family) > 0) emptyToBank(player);
}

/** An item used on the Knapsack (or it on an item): that item goes in, as much as fits. */
function useOn(event) {
  const { player, usedItem, usedWithItem } = event;
  const bag = Storage.nameOf(usedItem) === NAME ? usedItem : Storage.nameOf(usedWithItem) === NAME ? usedWithItem : null;
  const other = bag === usedItem ? usedWithItem : usedItem;
  if (!bag || !other || Storage.nameOf(other) === NAME) return;
  event.handled = true;
  const id = other.getId();
  const moved = family.accepts(id) ? Storage.fillFrom(player, family, id) : 0;
  player.getInventory().refreshItems();
  if (moved === 0) player.sendMessage(refusal(player, id));
}

/** Whether StorageItems runs (the relics plugin attaches the gathering either way). */
const running = () => Boolean(Storage.core) && Storage.FAMILIES.has(family.key);

/** `storage:gather`: an open Knapsack takes what its owner gathers, as far as it fits. */
function gather(event) {
  if (!running()) return;
  const left = event.amount - event.stored;
  if (left <= 0 || !family.accepts(event.itemId) || !carriesOpen(event.player)) return;
  event.stored += Storage.store(event.player, family, event.itemId, left);
}

/**
 * `storage:room`: a full inventory keeps gathering while an open Knapsack has room. Asked about the
 * raw item, it answers for what it will be handed: with Hotfoot's boots on, the cooked fish or bar,
 * which may be a kind it has no room for even when the raw one is held.
 */
function answerRoom(event) {
  if (!running() || event.room || !carriesOpen(event.player)) return;
  const id = productOf?.(event.player, event.skill, event.itemId) ?? event.itemId;
  if (!family.accepts(id)) return;
  if (room(event.player, id, Storage.contents(event.player, family)) > 0) event.room = true;
}

module.exports = (api) => {
  Storage.register(family);
  api.onItemAction(NAME, { Fill: fill, Check: check, Open: toggle, Close: toggle, Dispose: dispose });
  api.onItemOnItem(useOn);
  api.onCustomEvent("bank:empty-containers", emptyContainers);
};

/**
 * The Knapsack's gathering, attached by the relics plugin after Hotfoot's processing and before its
 * delivery, so Hotfoot's cooked fish and bars go in as they are (Wiki: Knapsack). `product(player,
 * skill, itemId)` says what a gather will arrive as (Hotfoot's), for the room it answers.
 */
module.exports.gathering = (api, { product = null } = {}) => {
  productOf = product;
  api.onCustomEvent(Storage.GATHER_EVENT, gather);
  api.onCustomEvent(Storage.ROOM_EVENT, answerRoom);
};

Object.assign(module.exports, { family, CAPACITY, KINDS, MESSAGE, gather, answerRoom, fill, check, dispose, emptyContainers, useOn });
