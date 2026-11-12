"use strict";

/**
 * Moving items between the two working copies a storage session holds: `storage` (CAPACITY slots,
 * { id, amount } or null) and `inventory` (the backpack's slots, Item clones or null). Nothing here
 * touches the real inventory or the saved storage; Save does (Access).
 *
 * As the bank: a noted item is stored unnoted, everything stacks in storage, and a withdrawal comes
 * out noted when the bank's note mode is on and the item has a note. Unlike the bank, a withdrawn
 * slot stays empty until "Shuffle items up" (the interface has that button for it).
 *
 * What may go in (ours, no capture): tradeable items only, as the storage is for sharing, and none
 * with per-item data (charges and the like), which a stored stack can't keep. On a free-to-play
 * world members' items can't be deposited or withdrawn (Wiki, Group Ironman Mode).
 */

const MAX_AMOUNT = 2147483647;
const MESSAGE = Object.freeze({
  NOT_STORABLE: "You can't put that in the group storage.",
  MEMBERS: "To use this item please login to a members' world.",
  FULL: "Your group storage is full.",
  INVENTORY_FULL: "You don't have enough inventory space.",
});

let core;

function init(pluginApi) {
  core = pluginApi.core;
}

const definition = (id) => core.ItemDefinition.forId(id);

function isMembersItem(id) {
  return id >= 0 && id < core.CacheDefinitions.getCounts().items && core.CacheDefinitions.getItem(id).isMembers === true;
}

/** Why the item can't be moved in or out of storage here, or null. */
function refusal(item, membersWorld) {
  const base = definition(item.getId()).unNote();
  if (!definition(base).isTradeable() || item.getMeta?.()) return MESSAGE.NOT_STORABLE;
  if (!membersWorld && isMembersItem(base)) return MESSAGE.MEMBERS;
  return null;
}

/** The noted id a withdrawal of `id` comes out as, when it has one (Bank.switchsItem's test). */
function notedOf(id) {
  const noteId = definition(id).getNoteId();
  const note = noteId >= 0 ? definition(noteId) : null;
  return note?.isNoted() === true && note.getName().toLowerCase() === definition(id).getName().toLowerCase() ? noteId : -1;
}

const stacks = (id) => definition(id).isStackable() || definition(id).isNoted();

/** Deposits up to `requested` of the item in inventory slot `slot`; { moved, message }. */
function deposit(work, slot, requested, membersWorld) {
  const item = work.inventory[slot];
  if (!item || requested <= 0) return { moved: 0, message: null };
  const message = refusal(item, membersWorld);
  if (message) return { moved: 0, message };
  const id = item.getId();
  const base = definition(id).unNote();
  let target = work.storage.findIndex((entry) => entry?.id === base);
  if (target < 0) target = work.storage.indexOf(null);
  if (target < 0) return { moved: 0, message: MESSAGE.FULL };
  const stored = work.storage[target]?.amount ?? 0;
  // The clicked slot first, then the same item's other slots (unstackables sit one to a slot).
  const slots = [slot, ...work.inventory.keys()].filter((index, at, all) => all.indexOf(index) === at
    && work.inventory[index]?.getId() === id && !work.inventory[index].getMeta?.());
  let left = Math.min(requested, MAX_AMOUNT - stored);
  let moved = 0;
  for (const index of slots) {
    if (left <= 0) break;
    const held = work.inventory[index];
    const count = Math.min(left, held.getAmount());
    if (count >= held.getAmount()) work.inventory[index] = null;
    else held.setAmount(held.getAmount() - count);
    left -= count;
    moved += count;
  }
  if (moved > 0) work.storage[target] = { id: base, amount: stored + moved };
  return { moved, message: moved > 0 ? null : MESSAGE.FULL };
}

/** Deposit inventory: every item that may go in; the first refusal is the one said. */
function depositAll(work, membersWorld) {
  let moved = 0;
  let message = null;
  for (let slot = 0; slot < work.inventory.length; slot++) {
    if (!work.inventory[slot]) continue;
    const result = deposit(work, slot, MAX_AMOUNT, membersWorld);
    moved += result.moved;
    message ??= result.message;
  }
  return { moved, message };
}

/** Withdraws up to `requested` from storage slot `slot`, noted when asked and possible. */
function withdraw(work, slot, requested, noted, membersWorld) {
  const entry = work.storage[slot];
  if (!entry || requested <= 0) return { moved: 0, message: null };
  if (!membersWorld && isMembersItem(entry.id)) return { moved: 0, message: MESSAGE.MEMBERS };
  const notedId = noted ? notedOf(entry.id) : -1;
  const id = notedId >= 0 ? notedId : entry.id;
  const wanted = Math.min(requested, entry.amount);
  let count = wanted;
  if (stacks(id)) {
    let index = work.inventory.findIndex((item) => item?.getId() === id && !item.getMeta?.());
    if (index < 0) index = work.inventory.indexOf(null);
    if (index < 0) return { moved: 0, message: MESSAGE.INVENTORY_FULL };
    const held = work.inventory[index]?.getAmount() ?? 0;
    count = Math.min(count, MAX_AMOUNT - held);
    if (count <= 0) return { moved: 0, message: MESSAGE.INVENTORY_FULL };
    work.inventory[index] = new core.Item(id, held + count);
  } else {
    const free = [...work.inventory.keys()].filter((index) => !work.inventory[index]);
    count = Math.min(count, free.length);
    if (count <= 0) return { moved: 0, message: MESSAGE.INVENTORY_FULL };
    for (const index of free.slice(0, count)) work.inventory[index] = new core.Item(id, 1);
  }
  entry.amount -= count;
  if (entry.amount <= 0) work.storage[slot] = null;
  return { moved: count, message: count < wanted ? MESSAGE.INVENTORY_FULL : null };
}

/** Shuffle items up: the stored items close up, in order. */
function compress(work) {
  const items = work.storage.filter(Boolean);
  work.storage.splice(0, work.storage.length, ...items, ...Array(work.storage.length - items.length).fill(null));
}

/** Drags a stored item from one slot to another: a swap, or with insert mode a move that shifts the rest. */
function moveStored(work, from, to, insert) {
  const { storage } = work;
  if (from === to || !storage[from]) return false;
  if (!insert || !storage[to]) {
    [storage[from], storage[to]] = [storage[to], storage[from]];
    return true;
  }
  const [item] = storage.splice(from, 1);
  storage.splice(to, 0, item);
  return true;
}

/** Drags an item in the side panel's inventory: always a swap, as the backpack. */
function moveHeld(work, from, to) {
  if (from === to || !work.inventory[from]) return false;
  [work.inventory[from], work.inventory[to]] = [work.inventory[to], work.inventory[from]];
  return true;
}

module.exports = { MAX_AMOUNT, MESSAGE, init, refusal, notedOf, deposit, depositAll, withdraw, compress, moveStored, moveHeld };
