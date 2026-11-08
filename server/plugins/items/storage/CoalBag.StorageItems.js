/**
 * Coal bag (https://oldschool.runescape.wiki/w/Coal_bag; docs/storage-items.md): 27 coal, 36 with
 * the Smithing cape's perk. Open, it takes coal as it is mined; smelting uses the inventory's coal
 * first, then the bag's. Only an empty bag can be destroyed.
 */
const Storage = require("./Common.StorageItems");

const NAMES = ["Coal bag", "Open coal bag"];
const CAPACITY = 27;
const CAPE_CAPACITY = 36;
/** Where the CoalBag plugin this replaced kept the bag's coal; moved into the store on login. */
const LEGACY_ATTRIBUTE = "coal-bag:coal";

const MESSAGE = {
  EMPTY: "The coal bag is empty.",
  NOW_EMPTY: "The coal bag is now empty.",
  /** Ours (not captured): Fill with no coal in the inventory. */
  NO_COAL: "You don't have any coal to put in the bag.",
  /** Ours (not captured). */
  CANT_DESTROY: "You need to empty the coal bag before you can destroy it.",
};

const family = {
  key: "coal-bag",
  names: NAMES,
  pairs: [["coal_bag", "coal_bag_open"]],
  openNames: ["Open coal bag"],
  usable: () => true,
  accepts: (id) => id === Storage.core.ItemIdentifiers.COAL,
  room: (player, _id, held) => capacity(player) - held.reduce((sum, entry) => sum + entry.amount, 0),
  gathers: (player) => Storage.hasOpen(player, family),
  bankEmpty: emptyToBank,
};

/** The Smithing cape's perk (the max cape's too), asked of the SkillCapes plugin. */
function capacity(player) {
  const request = { player, skill: "SMITHING", result: false };
  Storage.api.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true ? CAPE_CAPACITY : CAPACITY;
}

/** Client plugins parse these lines for the bag's count: "The coal bag contains 27 pieces of coal." */
function contains(amount) {
  return `The coal bag contains ${amount} ${amount === 1 ? "piece" : "pieces"} of coal.`;
}

function fill({ player }) {
  const coal = Storage.core.ItemIdentifiers.COAL;
  if (Storage.total(player, family) >= capacity(player)) {
    player.sendMessage(`The coal bag can hold only ${capacity(player)} pieces of coal.`);
    return;
  }
  if (!player.getInventory().contains(coal)) {
    player.sendMessage(MESSAGE.NO_COAL);
    return;
  }
  Storage.fillFrom(player, family, coal);
  player.sendMessage(contains(Storage.total(player, family)));
}

function check({ player }) {
  const held = Storage.total(player, family);
  player.sendMessage(held > 0 ? contains(held) : MESSAGE.EMPTY);
}

function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) return emptyToBank(player);
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  const { left } = Storage.emptyToInventory(player, family);
  player.sendMessage(left > 0 ? contains(left) : MESSAGE.NOW_EMPTY);
}

function emptyToBank(player) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  Storage.emptyToBank(player, family);
}

function toggle({ player, item }) {
  Storage.toggle(player, family, item);
}

function useOnBag(event) {
  const { player, usedItem, usedWithItem } = event;
  const bag = family.names.includes(Storage.nameOf(usedItem)) ? usedItem : family.names.includes(Storage.nameOf(usedWithItem)) ? usedWithItem : null;
  const other = bag === usedItem ? usedWithItem : usedItem;
  if (!bag || other?.getId?.() !== Storage.core.ItemIdentifiers.COAL) return;
  event.handled = true;
  fill({ player });
}

/** Destroy goes through the drop policy; a bag with coal in it stays. */
function destroyPolicy(event) {
  if (!family.names.includes(Storage.nameOf(event.item)) || Storage.total(event.player, family) === 0) return;
  event.player.sendMessage(MESSAGE.CANT_DESTROY);
  event.handled = true;
}

/** Coal saved by the old CoalBag plugin joins the bag's store, past its capacity if need be. */
function login({ player }) {
  const legacy = Number(player.getAttribute(LEGACY_ATTRIBUTE)) || 0;
  if (legacy <= 0) return;
  player.setAttribute(LEGACY_ATTRIBUTE, 0);
  const current = Storage.contents(player, family);
  const coal = Storage.core.ItemIdentifiers.COAL;
  const entry = current.find((held) => held.id === coal);
  if (entry) entry.amount += legacy;
  else current.push({ id: coal, amount: legacy });
  Storage.setContents(player, family, current);
}

module.exports = (api) => {
  Storage.register(family);
  api.persistAttribute(LEGACY_ATTRIBUTE, 0);
  api.onPlayerLogin(login);
  for (const name of NAMES) {
    api.onItemAction(name, { Fill: fill, Open: toggle, Close: toggle, Check: check, Empty: empty });
  }
  api.onItemOnItem(useOnBag);
  api.onItemDropPolicy(destroyPolicy);
  // The bank incinerator asks this instead of the drop policy: a bag still holding coal can't go, nor its coal.
  api.onCustomEvent("destroy-item:allowed", (request) => {
    if (!family.names.includes(Storage.nameOf(request.item)) || Storage.total(request.player, family) === 0) return;
    request.allowed = false;
    request.message = MESSAGE.CANT_DESTROY;
  });
};

Object.assign(module.exports, { NAMES, MESSAGE, capacity, contains });
