/**
 * Storage items: what the units share - the containers, the contents they hold and the
 * cross-plugin events (docs/storage-items.md).
 *
 * Like the rune pouch, a container's contents live on the player, not on the item: OSRS links
 * every copy a player owns to one store (Wiki: Fish barrel, Log basket, Tackle box), and the
 * contents survive banking the container. Each container family keeps an ordered list of
 * `[itemId, amount]` in its own attribute.
 */

/** `storage:room` `{ player, itemId, room }`: whether an open container would take one more. */
const ROOM_EVENT = "storage:room";
/** `storage:gather` `{ player, itemId, amount, stored }`: open containers take what fits; the gatherer adds the rest. */
const GATHER_EVENT = "storage:gather";
/** `storage:amount` `{ player, itemId, amount }`: adds what a carried container lets the player use. */
const AMOUNT_EVENT = "storage:amount";
/** `storage:take` `{ player, itemId, amount, taken }`: takes up to `amount` from carried containers. */
const TAKE_EVENT = "storage:take";

const DATA = require("../data/storage-items.json");

let api = null;
let core = null;
let ids = null;
/** Every container family, by key, registered by its unit. */
const FAMILIES = new Map();

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

// ------------------------------------------------------------------ item names

/** Every real (not noted, not placeholder) item id, by lowercase name; built once. */
function itemIdsByName() {
  if (ids) return ids;
  ids = new Map();
  const { CacheDefinitions } = core;
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
    const item = CacheDefinitions.getItem(id);
    if (item.noteTemplate >= 0 || item.placeholderTemplate >= 0 || !item.name || item.name === "null") continue;
    const key = item.name.toLowerCase();
    ids.set(key, [...(ids.get(key) ?? []), id]);
  }
  return ids;
}

/** Every id the cache gives these names. */
function idsOf(names) {
  return new Set(names.flatMap((name) => itemIdsByName().get(name.toLowerCase()) ?? []));
}

function itemName(id) {
  return core.CacheDefinitions.getItem(id)?.name ?? "";
}

function nameOf(item) {
  return item && item.getId?.() >= 0 ? itemName(item.getId()) : "";
}

function isStackable(id) {
  return core.ItemDefinition.forId(id).isStackable();
}

function isNoted(id) {
  return core.CacheDefinitions.getItem(id)?.noteTemplate >= 0;
}

// ------------------------------------------------------------------ families

/**
 * A container family: `key` (attribute and log name), `names` (every item that shares the
 * store, open variants included), `openNames` (the variants that fill themselves), `pairs`
 * (closed/open gamevals), `accepts(id)`,
 * `room(player, id, contents)` (how many more of `id` fit), `announced(player, id)` (its line for a
 * gather that asks with `announce`, room or not), `usable(id)` (whether consumers may
 * take `id` from it while it is carried) and `followsOnDeath` (contents go where the item goes on death).
 */
function register(family) {
  FAMILIES.set(family.key, { usable: () => false, followsOnDeath: false, openNames: [], worn: false, ...family });
  api.persistAttribute(attributeOf(family));
}

function attributeOf(family) {
  return `storage-items:${family.key}`;
}

function familyOf(item) {
  const name = nameOf(item);
  for (const family of FAMILIES.values()) if (family.names.includes(name)) return family;
  return null;
}

function isOpen(family, item) {
  return family.openNames.includes(nameOf(item));
}

/** The family's items the player carries: inventory, then (for wearable ones) the worn slot. */
function carried(player, family) {
  const items = player.getInventory().getValidItems().filter((item) => family.names.includes(nameOf(item)));
  if (family.worn) items.push(...player.getEquipment().getValidItems().filter((item) => family.names.includes(nameOf(item))));
  return items;
}

function hasOpen(player, family) {
  return carried(player, family).some((item) => isOpen(family, item));
}

/** Whether the player owns one anywhere: carried, worn or banked. */
function owns(player, family) {
  if (carried(player, family).length) return true;
  if (player.getEquipment().getValidItems().some((item) => family.names.includes(nameOf(item)))) return true;
  const { Bank } = core;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
    if (player.getBank(tab).getValidItems().some((item) => family.names.includes(nameOf(item)))) return true;
  }
  return false;
}

// ------------------------------------------------------------------ contents

/** The family's contents, `[{ id, amount }]` in the order they went in. */
function contents(player, family) {
  const saved = player.getAttribute(attributeOf(family));
  if (!Array.isArray(saved)) return [];
  return saved
    .map(([id, amount]) => ({ id: Number(id), amount: Number(amount) }))
    .filter(({ id, amount }) => Number.isInteger(id) && id >= 0 && Number.isInteger(amount) && amount > 0);
}

function setContents(player, family, next) {
  const saved = next.filter((entry) => entry.amount > 0).map(({ id, amount }) => [id, amount]);
  player.setAttribute(attributeOf(family), saved.length ? saved : null);
  family.changed?.(player, contents(player, family));
}

function total(player, family) {
  return contents(player, family).reduce((sum, entry) => sum + entry.amount, 0);
}

function amountOf(player, family, id) {
  return contents(player, family).find((entry) => entry.id === id)?.amount ?? 0;
}

/** Adds up to `amount` of `id`; returns how many went in. */
function store(player, family, id, amount) {
  if (!family.accepts(id)) return 0;
  const current = contents(player, family);
  const moved = Math.min(Math.floor(amount), family.room(player, id, current));
  if (!(moved > 0)) return 0;
  const entry = current.find((held) => held.id === id);
  if (entry) entry.amount += moved;
  else current.push({ id, amount: moved });
  setContents(player, family, current);
  return moved;
}

/** Removes up to `amount` of `id`; returns how many came out. */
function take(player, family, id, amount) {
  const current = contents(player, family);
  const entry = current.find((held) => held.id === id);
  const taken = Math.min(Math.floor(amount), entry?.amount ?? 0);
  if (!(taken > 0)) return 0;
  entry.amount -= taken;
  setContents(player, family, current);
  return taken;
}

/** Moves every stack of `id` that fits from the inventory into the family; returns the amount. */
function fillFrom(player, family, id) {
  const inventory = player.getInventory();
  const moved = store(player, family, id, inventory.getAmount(id));
  if (moved > 0) inventory.deleteNumber(id, moved);
  return moved;
}

/**
 * Swaps a container for its open or closed copy in place. `pairs` is `[[closed, open], ...]` by
 * cache gameval: names don't do, since an unused "Coal bag" (764) comes before the real one.
 */
function toggle(player, family, item) {
  const { CacheDefinitions } = core;
  const pair = family.pairs.map((names) => names.map((name) => CacheDefinitions.getObjId(name)))
    .find((ids) => ids.includes(item.getId()));
  if (!pair) return;
  const other = pair[0] === item.getId() ? pair[1] : pair[0];
  if (other === null || other === undefined) return;
  item.setId(other);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

/** Every distinct item id in the inventory, in slot order. */
function inventoryIds(player) {
  return [...new Set(player.getInventory().getValidItems().map((item) => item.getId()))];
}

/** How many of `id` the inventory has room for. */
function inventoryRoom(player, id) {
  return player.getInventory().getAddableAmount(new core.Item(id, Number.MAX_SAFE_INTEGER));
}

/**
 * Moves the contents into the inventory, first in first out, as far as there is room; returns
 * `{ moved, left }` in items.
 */
function emptyToInventory(player, family) {
  const inventory = player.getInventory();
  let moved = 0;
  for (const entry of contents(player, family)) {
    const amount = Math.min(entry.amount, inventoryRoom(player, entry.id));
    if (amount <= 0) continue;
    take(player, family, entry.id, amount);
    inventory.add(new core.Item(entry.id, amount), false);
    moved += amount;
  }
  inventory.refreshItems();
  return { moved, left: total(player, family) };
}

/** Moves the contents into the bank; returns the amount moved. */
function emptyToBank(player, family) {
  const { Bank } = core;
  let moved = 0;
  for (const entry of contents(player, family)) {
    const tab = player.getBank(Bank.getTabForItem(player, entry.id));
    const item = new core.Item(entry.id, entry.amount);
    const accepted = tab.getAddableAmount(item);
    if (accepted <= 0) continue;
    const taken = take(player, family, entry.id, accepted);
    if (taken <= 0) continue;
    tab.add(item.setAmount(taken), false);
    moved += taken;
  }
  refreshBank(player);
  return moved;
}

/** Redraws the open bank after items moved in or out of it. */
function refreshBank(player) {
  const { Bank } = core;
  if (!Bank.isOpen(player)) return;
  if (player.isSearchingBank()) player.getBank(Bank.BANK_SEARCH_TAB_INDEX).refreshItems();
  else player.getBank(player.getCurrentBankTab()).refreshItems();
  player.getInventory().refreshItems();
}

/** "N x Name" for each stack, the way the Check boxes list them. */
function describe(entries) {
  return entries.map(({ id, amount }) => `${amount} x ${itemName(id)}`);
}

/** A message box with the given lines. */
function showBox(player, lines) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, lines.join("<br>"))));
}

// ------------------------------------------------------------------ events

/** `storage:room`: an open container of any family with room answers yes. */
function answerRoom(event) {
  if (event.room) return;
  for (const family of FAMILIES.values()) {
    if (!family.gathers?.(event.player, event) || !family.accepts(event.itemId)) continue;
    if (family.room(event.player, event.itemId, contents(event.player, family)) > 0) {
      event.room = true;
      return;
    }
  }
}

/** `storage:gather`: open containers take what they can, in registration order. */
function answerGather(event) {
  for (const family of FAMILIES.values()) {
    const left = event.amount - event.stored;
    if (left <= 0) return;
    if (!family.gathers?.(event.player, event) || !family.accepts(event.itemId)) continue;
    if (event.announce) family.announced?.(event.player, event.itemId);
    const stored = store(event.player, family, event.itemId, left);
    if (stored > 0) {
      event.stored += stored;
      family.gathered?.(event.player, event.itemId, stored);
    }
  }
}

function usableFamilies(player, id) {
  return [...FAMILIES.values()].filter((family) => family.usable(id) && family.accepts(id) && carried(player, family).length);
}

/** `storage:amount`: what carried containers add to the inventory's count. */
function answerAmount(event) {
  for (const family of usableFamilies(event.player, event.itemId)) event.amount += amountOf(event.player, family, event.itemId);
}

/** `storage:take`: carried containers give up what the inventory was short of. */
function answerTake(event) {
  for (const family of usableFamilies(event.player, event.itemId)) {
    const left = event.amount - event.taken;
    if (left <= 0) return;
    event.taken += take(event.player, family, event.itemId, left);
  }
}

/** A container gone for good (Destroy) takes its contents along unless another copy is still owned. */
function destroyed({ player, itemId }) {
  const family = familyOf(new core.Item(itemId, 1));
  if (family && !owns(player, family)) setContents(player, family, []);
}

/** Read-only contents of the requested container, including gear not usable in place. */
function answerContents(event) {
  const family = familyOf(event.item);
  if (!family) return;
  event.contents.push(...contents(event.player, family).map(({ id, amount }) => ({ id, amount })));
  event.handled = true;
}

module.exports = {
  ROOM_EVENT,
  GATHER_EVENT,
  AMOUNT_EVENT,
  TAKE_EVENT,
  DATA,
  FAMILIES,
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  idsOf,
  itemName,
  nameOf,
  isStackable,
  isNoted,
  register,
  attributeOf,
  familyOf,
  isOpen,
  carried,
  hasOpen,
  owns,
  contents,
  setContents,
  total,
  amountOf,
  store,
  take,
  fillFrom,
  toggle,
  inventoryIds,
  inventoryRoom,
  emptyToInventory,
  emptyToBank,
  refreshBank,
  describe,
  showBox,
  answerContents,
  answerRoom,
  answerGather,
  answerAmount,
  answerTake,
  destroyed,
};
