"use strict";

/**
 * The grave itself. As captured (rsprox recordings 426, 1084, 1085, 2508):
 * - a grave is an NPC `gravestone_<style>_<n>`, a multinpc that is the visible "Grave" (Check,
 *   Loot) only to a player whose gravestone_visible is n, so each live grave gets its own n;
 * - on the death's last tick gravestone_creation_death_coord, gravestone_duration 1500 and
 *   gravestone_visible are set, and a tick later "Some of your dropped items are being held in a
 *   gravestone, near where you died.";
 * - near the grave, every grave tick resets the hint arrow and points it at the grave again
 *   (current_hint_arrow 9 -> 0 -> 9);
 * - Check opens from 7 tiles away: the fee thresholds, the grave's inventory, gravestone_generic
 *   as an overlay in the floater, both item lists' events and gravestone_transmit_data(fee,
 *   Coffer);
 * - taking the last item sends "You successfully retrieved everything from your gravestone.",
 *   clears gravestone_duration and gravestone_visible and closes the interface, on that tick.
 */
const Common = require("./Common.Gravestones");
const Storage = require("./Storage.Gravestones");
const Fees = require("./Fees.Gravestones");
const RESOURCES = require("../data/gravestone-resources.json");

const DURATION = 1500;
const ACCESS_RANGE = 7;
const MAX_SLOT = 255;
const GRAVE_TILE_RADIUS = 3;
/** UNVERIFIED: live pointed the arrow 19 tiles from the grave, but not 24. */
const HINT_RANGE = 20;
const HINT_ARROW_NPC = 9;
/** Unstackables "cannot be stockpiled up to 56" (Wiki: Grave). */
const MAX_UNSTACKABLE = 28;

const MESSAGE = {
  created: "Some of your dropped items are being held in a gravestone, near where you died.",
  merged: "Some of your items have been added to your previous gravestone.",
  pruned: "Some items have been moved to Death's Office from your gravestone.",
  retrieved: "You successfully retrieved everything from your gravestone.",
  // UNVERIFIED: no capture took an item with too little space or before paying.
  noSpace: "You don't have enough inventory space.",
  payFirst: "You need to pay the fee before you can take that item.",
  cannotPay: "You don't have enough coins with you or in your bank to pay the fee.",
};

/** Per online player with a grave: its NPC and visibility slot. */
const spawned = new Map();
const slotsInUse = new Set();
let resourceIds = null;

// ---------------------------------------------------------------- the grave NPC

function npcName(style, slot) {
  return `gravestone_${style === Storage.STYLE.ANGEL ? "angel" : "default"}_${String(slot).padStart(3, "0")}`;
}

/** UNVERIFIED: how live picks the slot (247 and 125 in captures); a random free one here. */
function allocateSlot() {
  const free = [];
  for (let slot = 1; slot <= MAX_SLOT; slot++) if (!slotsInUse.has(slot)) free.push(slot);
  if (free.length === 0) return 1 + Math.floor(Math.random() * MAX_SLOT);
  return free[Math.floor(Math.random() * free.length)];
}

function spawn(player) {
  const held = Storage.grave(player);
  if (!held) return;
  despawn(player);
  const slot = allocateSlot();
  const id = Common.core().CacheDefinitions.getNpcId(npcName(Storage.style(player), slot));
  const npc = Common.api().spawnNpc({ id, x: held.x, y: held.y, z: held.z, wanderRadius: 0, owner: player, ownerOnly: true });
  if (!npc) return;
  slotsInUse.add(slot);
  spawned.set(player, { npc, slot });
  Common.setVarbit(player, "visible", slot);
  Common.setVarbit(player, "type", Storage.style(player));
}

function despawn(player) {
  const entry = spawned.get(player);
  if (!entry) return;
  spawned.delete(player);
  slotsInUse.delete(entry.slot);
  Common.api().removeNpc(entry.npc);
}

function npcOf(player) {
  return spawned.get(player)?.npc ?? null;
}

function owns(player, npc) {
  return npc != null && npcOf(player) === npc;
}

function graveLocation(held) {
  return new (Common.core().Location)(held.x, held.y, held.z);
}

/** Near the grave, the arrow is reset and pointed at it again (each grave tick, as live). */
function pointAt(player) {
  const held = Storage.grave(player);
  const npc = npcOf(player);
  if (!held || !npc || !player.getLocation().isWithinDistance(graveLocation(held), HINT_RANGE)) return;
  const sender = player.getPacketSender();
  Common.setVarbit(player, "hintArrow", 0);
  sender.clearHintArrow();
  Common.setVarbit(player, "hintArrow", HINT_ARROW_NPC);
  sender.sendEntityHint(npc);
}

function clearHint(player) {
  if (Common.getVarbit(player, "hintArrow") !== HINT_ARROW_NPC) return;
  Common.setVarbit(player, "hintArrow", 0);
  player.getPacketSender().clearHintArrow();
}

/** The death tile, or a random free tile in the nearest ring that has one. */
function graveTile(location) {
  const { RegionManager, Location } = Common.core();
  const free = (x, y) => (RegionManager.getClipping(x, y, location.getZ(), null) & RegionManager.BLOCKED_MASK) === 0;
  const x = location.getX();
  const y = location.getY();
  if (free(x, y)) return { x, y, z: location.getZ() };
  // UNVERIFIED: the search; live put a grave from Brutus' gate tile (3262, 3294) at (3264, 3291).
  for (let radius = 1; radius <= GRAVE_TILE_RADIUS; radius++) {
    const ring = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === radius && free(x + dx, y + dy)) ring.push([x + dx, y + dy]);
      }
    }
    if (ring.length > 0) {
      const [gx, gy] = ring[Math.floor(Math.random() * ring.length)];
      return { x: gx, y: gy, z: location.getZ() };
    }
  }
  return { x, y, z: location.getZ() };
}

function packCoord({ x, y, z }) {
  return (z << 28) | (x << 14) | y;
}

/** Varbits and varps the client draws the grave and its HUD timer from. */
function sync(player) {
  const held = Storage.grave(player);
  const sender = player.getPacketSender();
  Common.setVarbit(player, "duration", held ? held.duration : 0);
  Common.setVarbit(player, "merged", held?.merged ? 1 : 0);
  Common.setVarbit(player, "type", Storage.style(player));
  sender.sendConfig(Common.VARP.creationCoord, held?.deathCoord ? packCoord(held.deathCoord) : 0);
}

// ---------------------------------------------------------------- the interface

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(Common.interfaceId());
}

function fee(player, held = Storage.grave(player)) {
  if (!held || held.feePaid) return 0;
  return Math.floor(Fees.graveFee(held.items, Common.ironmanMode(player) != null) * feeMultiplier(held.feeMultiplier));
}

function feeMultiplier(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1;
}

function sendFee(player, held) {
  player.getPacketSender().sendInterfaceScript(Common.TRANSMIT_DATA_SCRIPT, [fee(player, held), Storage.coffer(player)]);
}

/** The client divides the inventory into fee bands by slot; keep sent slots in fee order. */
function orderForFees(player, held) {
  const ordered = [...held.items].sort((a, b) => Fees.feeValue(b.id) - Fees.feeValue(a.id));
  if (ordered.some((entry, slot) => entry !== held.items[slot])) {
    held.items = ordered;
    Storage.setGrave(player, held);
  }
}

function open(player) {
  const held = Storage.grave(player);
  if (!held) return;
  orderForFees(player, held);
  const sender = player.getPacketSender();
  Fees.sendThresholds(player, held.items);
  Common.sendInventory(player, Common.GRAVE_INV, Common.GRAVE_SLOTS, held.items);
  sender.sendSubInterface(Common.FLOATER_UID, Common.interfaceId(), Common.OVERLAY);
  sender.sendInterfaceFlagsRange(Common.COMPONENT.freeItems, 0, Common.GRAVE_SLOTS - 1, Common.OP1 | Common.OP10);
  sender.sendInterfaceFlagsRange(Common.COMPONENT.payItems, 0, Common.GRAVE_SLOTS - 1, Common.OP1 | Common.OP10 | Common.DEPTH2);
  sendFee(player, held);
}

function close(player) {
  if (!isOpen(player)) return;
  player.getPacketSender().closeInterface(Common.interfaceId());
  player.getPacketSender().sendInterfaceScript(Common.TRANSMIT_DATA_SCRIPT, [-1, -1]);
}

function refresh(player, held) {
  if (!isOpen(player)) return;
  orderForFees(player, held);
  Fees.sendThresholds(player, held.items);
  Common.sendInventory(player, Common.GRAVE_INV, Common.GRAVE_SLOTS, held.items);
  sendFee(player, held);
}

/** Removes the grave: its NPC, the arrow, the timer and the interface. */
function remove(player) {
  close(player);
  despawn(player);
  clearHint(player);
  Storage.setGrave(player, null);
  Common.setVarbit(player, "visible", 0);
  sync(player);
}

// ---------------------------------------------------------------- taking items

/**
 * Puts `entry` in the inventory. With "Auto-equip & sort" on, an item goes back to the inventory
 * slot it held before the death when that slot is free.
 */
function giveBack(player, held, entry, sort) {
  const inventory = player.getInventory();
  const item = Common.toItem(entry);
  const def = Common.definition(entry.id);
  const stacked = def.isStackable() && inventory.getAmount(entry.id) > 0;
  const layout = held.layout?.inventory ?? [];
  const slot = sort && !stacked && (entry.amount === 1 || def.isStackable())
    ? layout.findIndex((id, index) => id === entry.id && inventory.isSlotFree(index))
    : -1;
  if (slot >= 0) {
    inventory.setItem(slot, item);
    layout[slot] = -1;
  } else {
    inventory.add(item, false);
  }
}

/**
 * Worn items (kept ones too) go back on: "auto-equip any items that were equipped when you died".
 * Each worn slot is tried once per take, so a failed requirement isn't repeated.
 */
function reequip(player, held, tried) {
  const worn = held.layout?.equipment ?? [];
  const inventory = player.getInventory();
  const equipment = player.getEquipment();
  const { EquipPacketListener } = Common.core();
  const inventoryInterface = inventory.constructor.INTERFACE_ID;
  for (let slot = 0; slot < worn.length; slot++) {
    const id = worn[slot];
    if (id == null || id < 0 || tried.has(slot) || !equipment.isSlotFree(slot)) continue;
    const from = inventory.getItems().findIndex((item) => item && item.getId() === id);
    if (from < 0) continue;
    tried.add(slot);
    EquipPacketListener.equip(player, id, from, inventoryInterface);
    if (!equipment.isSlotFree(slot)) worn[slot] = -1;
  }
}

/**
 * Moves the grave's `slots` into the inventory, equippable items first. Returns whether the grave
 * is now empty (and gone).
 */
function take(player, slots) {
  const held = Storage.grave(player);
  if (!held) return true;
  const sort = Common.getVarbit(player, "autoEquip") === 1;
  const tried = new Set();
  if (sort) reequip(player, held, tried);
  const order = [...new Set(slots)].filter((slot) => held.items[slot])
    .sort((a, b) => Number(isEquipable(held.items[b].id)) - Number(isEquipable(held.items[a].id)));
  const taken = new Set();
  let noSpace = false;
  for (const slot of order) {
    const entry = held.items[slot];
    if (!Common.fits(player, entry)) {
      noSpace = true;
      continue;
    }
    giveBack(player, held, entry, sort);
    taken.add(slot);
  }
  held.items = held.items.filter((_, slot) => !taken.has(slot));
  if (sort) reequip(player, held, tried);
  player.getInventory().refreshItems();
  if (noSpace) player.sendMessage(MESSAGE.noSpace);
  if (held.items.length === 0) {
    player.sendMessage(MESSAGE.retrieved);
    remove(player);
    return true;
  }
  Storage.setGrave(player, held);
  refresh(player, held);
  return false;
}

function isEquipable(id) {
  return (Common.definition(id).getEquipmentType?.()?.getSlot?.() ?? -1) >= 0;
}

function paySlots(held) {
  return held.items.map((entry, slot) => (Fees.isPaid(entry.id) ? slot : -1)).filter((slot) => slot >= 0);
}

function freeSlots(held) {
  return held.items.map((entry, slot) => (Fees.isPaid(entry.id) ? -1 : slot)).filter((slot) => slot >= 0);
}

function takeSlot(player, slot) {
  const held = Storage.grave(player);
  const entry = held?.items[slot];
  if (!entry) return;
  if (Fees.isPaid(entry.id) && fee(player, held) > 0) {
    player.sendMessage(MESSAGE.payFirst);
    return;
  }
  take(player, [slot]);
}

function takeFree(player) {
  const held = Storage.grave(player);
  if (held) take(player, freeSlots(held));
}

/** The pay button: pays the fee, or once it's paid (or there's none) takes the paid items. */
function payOrTake(player) {
  const held = Storage.grave(player);
  if (!held) return;
  const owed = fee(player, held);
  if (owed <= 0) {
    take(player, paySlots(held));
    return;
  }
  const source = Fees.pay(player, owed);
  if (!source) {
    player.sendMessage(MESSAGE.cannotPay);
    return;
  }
  player.sendMessage(Fees.paymentMessage(source, owed));
  held.feePaid = true;
  Storage.setGrave(player, held);
  refresh(player, held);
}

/** Loot: what Take-free would take. UNVERIFIED that it takes nothing from the paid section. */
function loot(player) {
  const held = Storage.grave(player);
  if (!held) return;
  Fees.sendThresholds(player, held.items);
  take(player, freeSlots(held));
}

// ---------------------------------------------------------------- storing a death

function isResource(id) {
  if (!resourceIds) resourceIds = new Set(RESOURCES.names.map((name) => name.toLowerCase()));
  return resourceIds.has(Common.definition(id).getName().toLowerCase());
}

/**
 * Before a death adds to an existing grave, it sends its resources and any unstackable past 28 to
 * Death's Office, and drops its food and potions beneath it, so a grave can't stockpile them
 * (Wiki: Grave).
 */
function prune(player, held) {
  const { ItemOnGroundManager } = Common.core();
  const toOffice = [];
  const kept = [];
  for (const entry of held.items) {
    if (Common.isSupply(entry.id)) {
      ItemOnGroundManager.registerLocation(player, Common.toItem(entry), graveLocation(held), null);
    } else if (isResource(entry.id)) {
      toOffice.push(entry);
    } else if (!Common.definition(entry.id).isStackable() && entry.amount > MAX_UNSTACKABLE) {
      kept.push({ ...entry, amount: MAX_UNSTACKABLE });
      toOffice.push({ ...entry, amount: entry.amount - MAX_UNSTACKABLE });
    } else {
      kept.push(entry);
    }
  }
  held.items = kept;
  if (toOffice.length > 0) {
    Storage.sendToOffice(player, toOffice);
    player.sendMessage(MESSAGE.pruned);
  }
}

/** Where an instance wants its deaths' graves, or the respawn point for one that doesn't say. */
function graveSpot(player, location) {
  const request = { player, location, tile: null, feeMultiplier: 1 };
  Common.api().emitCustomEvent("gravestones:grave-location", request);
  if (!request.tile && player.getPrivateArea?.()) {
    const respawn = Common.core().GameConstants.DEFAULT_LOCATION;
    request.tile = { x: respawn.getX(), y: respawn.getY(), z: respawn.getZ() };
  }
  return { tile: request.tile, feeMultiplier: feeMultiplier(request.feeMultiplier) };
}

/**
 * Takes a death's lost `records` into the player's grave. With nothing new to hold, a death still
 * prunes an existing grave, and a grave left empty by that goes. `relocate` moves an existing
 * grave to this death (a Wilderness PvM death).
 */
function store(player, location, records, layout, relocate) {
  let held = Storage.grave(player);
  const existing = held != null;
  if (!existing && records.length === 0) return;
  close(player);
  if (existing) {
    prune(player, held);
    if (records.length === 0) {
      if (held.items.length === 0) remove(player);
      else Storage.setGrave(player, held);
      return;
    }
  }
  const { tile: spot, feeMultiplier: multiplier } = graveSpot(player, location);
  const deathCoord = spot ?? { x: location.getX(), y: location.getY(), z: location.getZ() };
  const { held: items, overflow } = Common.stack(existing ? held.items : [], records, Common.GRAVE_SLOTS, Fees.feeValue);
  // UNVERIFIED: what doesn't fit goes to Death's Office.
  Storage.sendToOffice(player, overflow);
  held = existing ? held : { items: [], merged: false };
  // Keep the greater multiplier when merging, so normal-fee contents cannot
  // acquire a discount by being added to (or followed by) a discounted death.
  held.feeMultiplier = existing ? Math.max(feeMultiplier(held.feeMultiplier), multiplier) : multiplier;
  held.items = items;
  held.layout = layout;
  held.duration = DURATION;
  held.feePaid = false;
  if (!existing || relocate) {
    Object.assign(held, graveTile(new (Common.core().Location)(deathCoord.x, deathCoord.y, deathCoord.z)));
    held.deathCoord = deathCoord;
  }
  if (existing) {
    held.merged = true;
  } else if (!Storage.metDeath(player)) {
    // The first death that loses items brings the player to Death, if the office answers; the
    // timer shows 1501 and holds until they leave it.
    const first = { player, accepted: false };
    Common.api().emitCustomEvent("gravestones:first-grave", first);
    if (first.accepted) {
      Storage.setTutorial(player, true);
      held.duration = DURATION + 1;
    }
  }
  Storage.setGrave(player, held);
  if (!existing || relocate) spawn(player);
  sync(player);
  const message = existing ? MESSAGE.merged : MESSAGE.created;
  Common.later(player, 1, () => player.sendMessage(message));
}

module.exports = {
  DURATION, ACCESS_RANGE, spawn, despawn, npcOf, owns, pointAt, clearHint, sync, isOpen, fee, open, close,
  remove, takeSlot, takeFree, payOrTake, loot, store,
};
