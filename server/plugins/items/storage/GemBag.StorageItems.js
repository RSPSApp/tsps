/**
 * Gem bag (https://oldschool.runescape.wiki/w/Gem_bag; docs/storage-items.md): 60 of each uncut
 * sapphire, emerald, ruby, diamond and dragonstone. Open, it takes the gems a player picks up,
 * steals or gets while mining. Its contents are kept on death.
 */
const Storage = require("./Common.StorageItems");
const GemSack = require("./GemSack.StorageItems");

const NAMES = ["Gem bag", "Open gem bag"];
const PER_GEM = 60;
/** Wiki Transcript:Gem bag: a gem going straight into the open bag. */
const STRAIGHT_IN = "You put it straight into your open gem bag.";
const MESSAGE = {
  /** Ours (not captured). */
  EMPTY: "The gem bag is empty.",
  /** Wiki Transcript:Gem bag: Fill with no suitable gems. */
  NO_GEMS: "You have nothing suitable for storing in the bag.",
  /** Wiki Transcript:Gem bag: a cut gem used on the bag. */
  CUT: "Only uncut gems can be stored in the bag.",
  /** Wiki Transcript:Gem bag: the bag is full of that gem. */
  FULL: "Your bag is too full to hold all your gems.",
  /** Wiki Transcript:Gem bag. */
  OPENED: "You open your gem bag, ready to fill it.",
  /** Wiki Transcript:Gem bag. */
  CLOSED: "You close your gem bag.",
};

/** The cut gems of the five the bag takes. */
const CUT_GEMS = ["Sapphire", "Emerald", "Ruby", "Diamond", "Dragonstone"];

let gems = null;

function gemIds() {
  gems ??= [...Storage.idsOf(Storage.DATA.gems)];
  return gems;
}

const family = {
  key: "gem-bag",
  names: NAMES,
  pairs: [["gem_bag", "gem_bag_open"]],
  openNames: ["Open gem bag"],
  accepts: (id) => gemIds().includes(id),
  room: (_player, id, held) => PER_GEM - (held.find((entry) => entry.id === id)?.amount ?? 0),
  gathers: (player) => Storage.hasOpen(player, family),
  announced: (player, id) => player.sendMessage(foundLine(id)),
  gathered: (player) => player.sendMessage(STRAIGHT_IN),
  bankEmpty: emptyToBank,
};

/** Wiki Transcript:Gem bag: "You just found a/an [gem]!" */
function foundLine(id) {
  const gem = Storage.itemName(id).replace(/^Uncut /, "");
  const name = gem.charAt(0).toUpperCase() + gem.slice(1);
  return `You just found ${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}!`;
}

/** Wiki Transcript:Gem bag: storing gems has no line of its own, only a stage direction. */
function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NO_GEMS);
    return;
  }
  const moved = held.reduce((sum, id) => sum + Storage.fillFrom(player, family, id), 0);
  if (moved === 0) player.sendMessage(MESSAGE.FULL);
}

/** Wiki Transcript:Gem bag: every gem's count, on two lines. */
function check({ player }) {
  const { UNCUT_SAPPHIRE, UNCUT_EMERALD, UNCUT_RUBY, UNCUT_DIAMOND, UNCUT_DRAGONSTONE } = Storage.core.ItemIdentifiers;
  const count = (id) => Storage.amountOf(player, family, id);
  player.sendMessage(`Sapphires: ${count(UNCUT_SAPPHIRE)} / Emeralds: ${count(UNCUT_EMERALD)} / Rubies: ${count(UNCUT_RUBY)}`);
  player.sendMessage(`Diamonds: ${count(UNCUT_DIAMOND)} / Dragonstones: ${count(UNCUT_DRAGONSTONE)}`);
}

/** Wiki: Empty moves every gem to the inventory at once, sapphires first; with the bank open, into the bank. */
function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) return emptyToBank(player);
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  const ordered = gemIds().map((id) => ({ id, amount: Storage.amountOf(player, family, id) })).filter((entry) => entry.amount > 0);
  Storage.setContents(player, family, ordered);
  Storage.emptyToInventory(player, family);
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
  player.sendMessage(Storage.isOpen(family, item) ? MESSAGE.OPENED : MESSAGE.CLOSED);
}

function useOnBag(event) {
  const { player, usedItem, usedWithItem } = event;
  const bag = NAMES.includes(Storage.nameOf(usedItem)) ? usedItem : NAMES.includes(Storage.nameOf(usedWithItem)) ? usedWithItem : null;
  if (!bag) return;
  const other = bag === usedItem ? usedWithItem : usedItem;
  if (CUT_GEMS.includes(Storage.nameOf(other))) {
    event.handled = true;
    player.sendMessage(MESSAGE.CUT);
    return;
  }
  if (!family.accepts(other?.getId?.())) return;
  event.handled = true;
  fill({ player });
}

/** Wiki: a gem picked up while the bag is open goes straight in. */
const pickupItems = new WeakSet();
const pickupPlayers = new WeakSet();
function pickup(event) {
  if (event.handled) return;
  const { player, groundItem } = event;
  const item = groundItem.getItem();
  if (pickupItems.has(groundItem) || pickupPlayers.has(player)) { event.handled = true; return; }
  // Metadata and non-unit stacks use the ordinary pickup path, which preserves their identity.
  if (!family.accepts(item.getId()) || item.getMeta() != null || item.getAmount() !== 1) return;
  const sack = Storage.FAMILIES.get("gem-sack");
  const target = Storage.hasOpen(player, family) ? family : sack && Storage.hasOpen(player, sack) ? sack : null;
  if (!target || target.room(player, item.getId(), Storage.contents(player, target)) < 1) return;
  const manager = Storage.core.ItemOnGroundManager;
  const itemId = item.getId(), position = groundItem.getPosition().clone(), owner = groundItem.getOwner();
  const area = groundItem.getPrivateArea(), state = groundItem.getState();
  pickupItems.add(groundItem);
  pickupPlayers.add(player);
  event.handled = true;
  try {
    // This hook runs before Ironman; ask its guard before any storage or take policy.
    const permission = { player, groundItem, allow: true };
    Storage.api.emitCustomEvent("ground-item:can-store", permission);
    if (!permission.allow) return;
    const request = { player, groundItem, source: "pickup", itemId, amount: 1, discard: 0, allow: true, error: null };
    Storage.api.emitCustomEvent("ground-items:take", request);
    if (request.allow !== true || request.error != null || request.amount !== 1 || request.discard !== 0) return;
    if (!Storage.core.World.getItems().includes(groundItem) || !manager.canSee(player, groundItem)
      || groundItem.getItem() !== item || item.getId() !== itemId || item.getAmount() !== 1 || item.getMeta() != null
      || !groundItem.getPosition().equals(position) || groundItem.getOwner() !== owner
      || groundItem.getPrivateArea() !== area || groundItem.getState() !== state
      || !Storage.hasOpen(player, target) || target.room(player, itemId, Storage.contents(player, target)) < 1) return;
    if (Storage.store(player, target, itemId, 1) !== 1) return;
    manager.deregister(groundItem);
    Storage.api.emitCustomEvent("ground-items:taken", { player, groundItem, source: "pickup", itemId, amount: 1, discarded: 0 });
    // Mirror the server's ordinary ground pickup; live container audio is not established.
    Storage.core.Sounds.sendSound(player, Storage.core.Sound.PICK_UP_ITEM);
    player.getLastItemPickup().reset();
    player.sendMessage(target === family ? STRAIGHT_IN : GemSack.STRAIGHT_IN);
  } finally {
    pickupItems.delete(groundItem);
    pickupPlayers.delete(player);
  }
}

module.exports = (api) => {
  Storage.register(family);
  for (const name of NAMES) {
    api.onItemAction(name, { Fill: fill, Open: toggle, Close: toggle, Check: check, Empty: empty });
  }
  api.onItemOnItem(useOnBag);
  api.onGroundItemPickup(pickup);
};

Object.assign(module.exports, { NAMES, PER_GEM, STRAIGHT_IN, MESSAGE });
