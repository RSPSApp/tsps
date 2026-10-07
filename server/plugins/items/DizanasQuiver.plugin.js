"use strict";

/**
 * Dizana's quiver: its extra ammunition slot.
 *
 * Wiki ("Dizana's quiver"): a second ammunition slot, for arrows or bolts only. The weapon fires
 * the ammo in the normal ammo slot if it can, otherwise the quiver's, so two ammo types (or ammo
 * and a god blessing) can be worn at once. "Fill" moves the worn ammo into it; with none worn:
 * "You have nothing in your worn quiver to fill your Dizana's Quiver with."
 *
 * Cache (scripts 5023-5028 on the equipment tab's component 387:28): the slot shows varp 4142
 * (the item, -1 for none) and varp 4141 (the amount) while a quiver (param 1910) is worn or
 * carried. Empty, it offers Fill; filled, Quiver-Remove, Swap and Examine; the gameframe enables
 * those ops (encodeGameframeFlags). The ammo is the player's, kept in those varps, not on the
 * quiver item.
 *
 * Ours: Fill refuses ammo of another type than the quiver holds, and anything but arrows and
 * bolts; Swap exchanges the worn ammo and the quiver's when both are arrows or bolts (or one
 * side is empty). Fired quiver ammo breaks or drops as worn ammo does. Not done: charging
 * (Dizana's Sunfire), Ava's upgrade, blessing, the quiver's Open interface and the Wilderness
 * death rules.
 */

const { Ammunition, RangedWeapon } = require("../../src/main/typescript/elvarg/game/content/combat/ranged/RangedData");
const { PluginManager } = require("../../src/main/typescript/elvarg/plugins/PluginManager");

const VARP = { AMOUNT: 4141, ITEM: 4142 };
const PARAM_QUIVER = 1910;
const SLOT_COMPONENT = { group: 387, child: 28 };
const OP = { REMOVE: 1, FILL_OR_SWAP: 2, EXAMINE: 10 };
const ATTRIBUTE = "dizanas-quiver";
const MAX_AMOUNT = 2147483647;
/** Fired ammunition: 20% breaks, the rest lands where the target stood (CombatFactory). */
const BREAK_CHANCE = 20;
const RANGED_ATTACK = 4;
const RANGED_STRENGTH = 11;

let pluginApi = null;

function core() {
  return pluginApi.core;
}

// ------------------------------------------------------------------ the stored ammo

/** { id, amount } of the quiver's ammo, or null. */
function stored(player) {
  const value = player.getAttribute(ATTRIBUTE);
  return value && Number(value.id) > 0 && Number(value.amount) > 0 ? { id: Number(value.id), amount: Number(value.amount) } : null;
}

function store(player, ammo) {
  player.setAttribute(ATTRIBUTE, ammo && ammo.amount > 0 ? { id: ammo.id, amount: ammo.amount } : null);
  sendSlot(player);
  pluginApi.getBonusManager().update(player);
}

/** The equipment tab draws the slot from these; an empty quiver is -1, not item 0. */
function sendSlot(player) {
  const ammo = stored(player);
  player.getPacketSender()
    .sendConfig(VARP.AMOUNT, ammo ? ammo.amount : 0)
    .sendConfig(VARP.ITEM, ammo ? ammo.id : -1);
}

// ------------------------------------------------------------------ what counts

function isQuiver(itemId) {
  if (!(itemId > 0)) return false;
  return Number(core().CacheDefinitions.getItem(itemId)?.params?.get?.(PARAM_QUIVER) ?? 0) > 0;
}

function wornQuiver(player) {
  return isQuiver(player.getEquipment().getItems()[core().Equipment.CAPE_SLOT]?.getId?.() ?? -1);
}

/**
 * Arrows and bolts only: no javelins, atlatl darts or blessings (Wiki). Only what can be worn
 * in the ammo slot reaches here; whether a weapon can fire it is the weapon's business.
 */
function isArrowOrBolt(itemId) {
  const name = core().ItemDefinition.forId(itemId)?.getName?.() ?? "";
  if (/javelin|dart/i.test(name)) return false;
  return /\barrows?\b|\bbolts?\b|bolt rack/i.test(name);
}

/**
 * The quiver's ammo when the weapon fires it: a quiver is worn, the weapon draws from an ammo
 * slot, the worn ammo doesn't fit it and the quiver's does (Wiki: the ammo slot first).
 */
function firedAmmunition(player) {
  const ammo = stored(player);
  if (!ammo || !wornQuiver(player)) return null;
  const { Equipment } = core();
  const weaponId = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const weapon = RangedWeapon.getFor(player);
  if (!weapon || RangedWeapon.getSelfAmmo(weaponId)) return null;
  const fits = (itemId) => {
    const data = Ammunition.getForItem(itemId);
    return data != null && weapon.getAmmunitionData().includes(data);
  };
  const worn = player.getEquipment().getItems()[Equipment.AMMUNITION_SLOT];
  if (worn && worn.getId() > 0 && worn.getAmount() > 0 && fits(worn.getId())) return null;
  return fits(ammo.id) ? Ammunition.getForItem(ammo.id) : null;
}

// ------------------------------------------------------------------ the slot's options

function wornAmmo(player) {
  const item = player.getEquipment().getItems()[core().Equipment.AMMUNITION_SLOT];
  return item && item.getId() > 0 && item.getAmount() > 0 ? item : null;
}

function setWornAmmo(player, ammo) {
  const { Equipment, Item } = core();
  player.getEquipment().set(Equipment.AMMUNITION_SLOT, ammo ? new Item(ammo.id, ammo.amount) : new Item(-1));
  player.getEquipment().refreshItems();
}

function name(itemId) {
  return core().ItemDefinition.forId(itemId)?.getName?.() ?? "ammunition";
}

function fill(player) {
  const worn = wornAmmo(player);
  if (!worn) {
    player.sendMessage("You have nothing in your worn quiver to fill your Dizana's Quiver with.");
    return;
  }
  if (!isArrowOrBolt(worn.getId())) {
    player.sendMessage("Dizana's quiver can only hold arrows or bolts.");
    return;
  }
  const ammo = stored(player);
  if (ammo && ammo.id !== worn.getId()) {
    player.sendMessage(`Your quiver already holds ${name(ammo.id)}.`);
    return;
  }
  const total = Math.min(MAX_AMOUNT, (ammo?.amount ?? 0) + worn.getAmount());
  const left = (ammo?.amount ?? 0) + worn.getAmount() - total;
  setWornAmmo(player, left > 0 ? { id: worn.getId(), amount: left } : null);
  store(player, { id: worn.getId(), amount: total });
}

function swap(player) {
  const ammo = stored(player);
  const worn = wornAmmo(player);
  if (worn && !isArrowOrBolt(worn.getId())) {
    player.sendMessage("Dizana's quiver can only hold arrows or bolts.");
    return;
  }
  setWornAmmo(player, ammo);
  store(player, worn ? { id: worn.getId(), amount: worn.getAmount() } : null);
}

function remove(player) {
  const ammo = stored(player);
  if (!ammo) return;
  const inventory = player.getInventory();
  if (!inventory.contains(ammo.id) && inventory.getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  const room = MAX_AMOUNT - inventory.getAmount(ammo.id);
  const moved = Math.min(room, ammo.amount);
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  inventory.adds(ammo.id, moved);
  inventory.refreshItems();
  store(player, { id: ammo.id, amount: ammo.amount - moved });
}

function examine(player) {
  const ammo = stored(player);
  if (ammo) player.sendMessage(core().ItemDefinition.forId(ammo.id)?.getExamine?.() || name(ammo.id));
}

function slotClicked(event) {
  if (event.groupId !== SLOT_COMPONENT.group || event.childId !== SLOT_COMPONENT.child) return;
  const op = Number(event.opId ?? event.action);
  event.handled = true;
  if (op === OP.REMOVE) remove(event.player);
  else if (op === OP.FILL_OR_SWAP) (stored(event.player) ? swap : fill)(event.player);
  else if (op === OP.EXAMINE) examine(event.player);
}

/** The quiver item's "Empty": its ammo to the inventory. */
function emptyQuiver({ player }) {
  if (!stored(player)) {
    player.sendMessage("Your quiver is empty.");
    return true;
  }
  remove(player);
  return true;
}

// ------------------------------------------------------------------ combat

function resolveAmmo(player) {
  return firedAmmunition(player);
}

function checkAmmo(player, amountRequired, silent) {
  if (!firedAmmunition(player)) return null;
  if (stored(player).amount >= amountRequired) return true;
  if (!silent) player.sendMessage("You don't have the required amount of ammunition to fire that.");
  return false;
}

/** Fired quiver ammo breaks, drops where the target stood, or is recovered, as worn ammo does. */
function decrementAmmo(player, pos, amount, delayTicks = 0) {
  if (!firedAmmunition(player)) return false;
  const { Item, ItemOnGroundManager, Misc, Task, TaskManager } = core();
  const ammoId = stored(player).id;
  const dropChance = 80 - PluginManager.rangedAmmoRecovery(player);
  let used = 0;
  let dropped = 0;
  for (let shot = 0; shot < amount; shot++) {
    const roll = Misc.getRandom(99);
    if (roll < BREAK_CHANCE) used++;
    else if (roll < BREAK_CHANCE + dropChance) dropped++;
  }
  const apply = () => {
    const ammo = stored(player);
    // Swapped or emptied mid-flight: leave the new contents alone.
    if (!ammo || ammo.id !== ammoId) return;
    if (dropped > 0 && pos) ItemOnGroundManager.registerLocation(player, new Item(ammoId, dropped), pos);
    const left = ammo.amount - used - dropped;
    store(player, { id: ammoId, amount: left });
    if (left <= 0) player.sendMessage("You have run out of ammunition!");
  };
  if (delayTicks > 0) {
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(delayTicks);
      }
      execute() {
        this.stop();
        apply();
      }
    })());
  } else {
    apply();
  }
  return true;
}

/** Quiver ammo being fired counts as the ammo: its ranged attack and strength. */
function quiverBonuses({ player, bonuses }) {
  const fired = firedAmmunition(player);
  if (!fired) return;
  const ammoBonuses = core().ItemDefinition.forId(stored(player).id)?.getBonuses?.() ?? [];
  bonuses[RANGED_ATTACK] += Number(ammoBonuses[RANGED_ATTACK] ?? 0);
  bonuses[RANGED_STRENGTH] += Number(ammoBonuses[RANGED_STRENGTH] ?? 0);
}

function login({ player }) {
  sendSlot(player);
}

module.exports = {
  name: "DizanasQuiver",
  members: true,
  register(api) {
    pluginApi = api;
    api.persistAttribute(ATTRIBUTE);
    api.onPlayerLogin(login);
    api.onInterfaceActionClick(slotClicked);
    for (const quiver of ["Dizana's quiver", "Dizana's quiver (uncharged)", "Blessed Dizana's quiver"]) {
      api.onItemAction(quiver, { Empty: emptyQuiver });
    }
    api.registerRangedAmmoResolver({ resolve: resolveAmmo });
    api.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
    api.registerBonusProvider({ apply: quiverBonuses });
  },
  ATTRIBUTE,
  VARP,
  stored,
  firedAmmunition,
  slotClicked,
};
