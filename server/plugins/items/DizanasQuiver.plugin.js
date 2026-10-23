"use strict";

/**
 * Dizana's quiver: its extra ammunition slot, charges and death rules.
 *
 * Wiki ("Dizana's quiver"): a second ammunition slot for arrows or bolts only. The weapon fires
 * the ammo in the normal ammo slot if it can, otherwise the quiver's. "Fill" moves the worn ammo
 * into it; with none worn: "You have nothing in your worn quiver to fill your Dizana's Quiver
 * with."
 *
 * Cache (scripts 5023-5028 on the equipment tab's component 387:28): the slot shows varp 4142
 * (the item, -1 for none) and varp 4141 (the amount) while a quiver (param 1910) is worn or
 * carried. Empty, it offers Fill; filled, Quiver-Remove, Swap and Examine; the gameframe enables
 * those ops (encodeGameframeFlags). The ammo is the player's, kept in those varps, not on the
 * quiver item.
 *
 * Charging (Wiki: 1 sunfire splinter = 1 charge, up to 20,000): charged and blessed quivers add
 * +10 ranged accuracy and +1 ranged strength to arrows and bolts fired from either ammunition
 * slot. A charge is spent on a 1/3 roll; blessed quivers do not spend charges. Uncharging gives
 * the remaining splinters back. Blessing costs the remaining 150,000 splinters (charging counts
 * towards it) and makes the effect permanent. Ava's accumulator (72%) or assembler (80%) can be
 * applied without consuming the device and applies to every quiver on the account.
 */
const { Ammunition, RangedWeapon } = require("../../src/main/typescript/elvarg/game/content/combat/ranged/RangedData");
const { PluginManager } = require("../../src/main/typescript/elvarg/plugins/PluginManager");
const { TYPE_GRAPHIC, TYPE_RECTANGLE, TYPE_TEXT, createWidgetGroup } = require("../interface/widgetGroup");

const VARP = { AMOUNT: 4141, ITEM: 4142 };
const PARAM_QUIVER = 1910;
const SLOT_COMPONENT = { group: 387, child: 28 };
const OP = { REMOVE: 1, FILL_OR_SWAP: 2, EXAMINE: 10 };
const ATTRIBUTE = "dizanas-quiver";
const CHARGE_META = "dizanas-quiver:charges";
const BLESSING_META = "dizanas-quiver:blessing";
const AVA_ATTRIBUTE = "dizanas-quiver:ava-recovery";
const MAX_AMOUNT = 2147483647;
const MAX_CHARGES = 20000;
const BLESSING_COST = 150000;
const REPAIR_COST = 270000;
const WILDERNESS_RECLAIM = 9600;
/** Fired ammunition: 20% breaks, the rest lands where the target stood (CombatFactory). */
const BREAK_CHANCE = 20;
const RANGED_ATTACK = 4;
const RANGED_STRENGTH = 11;
const SUNFIRE_ATTACK = 10;
const SUNFIRE_STRENGTH = 1;
const COINS = 995;

const OPEN_GROUP_ID = 30010;
const OPEN_COMPONENT = { ROOT: 0, FRAME: 1, TITLE: 2, ITEM: 3, CONTENT: 4, CHARGES: 5 };
const OPEN_UID = (component) => (OPEN_GROUP_ID << 16) | component;
const MAIN_MODAL_UID = (161 << 16) | 16;

const AVA_RECOVERY = [
  ["AVAS_ACCUMULATOR", 72],
  ["AVAS_ACCUMULATOR_2", 72],
  ["ACCUMULATOR_MAX_CAPE", 72],
  ["ACCUMULATOR_MAX_CAPE_2", 72],
  ["RANGING_CAPE", 72],
  ["RANGING_CAPE_2", 72],
  ["RANGING_CAPE_T_", 72],
  ["RANGING_CAPE_T__2", 72],
  ["AVAS_ASSEMBLER", 80],
  ["AVAS_ASSEMBLER_2", 80],
  ["AVAS_ASSEMBLER_L_", 80],
  ["ASSEMBLER_MAX_CAPE", 80],
  ["ASSEMBLER_MAX_CAPE_2", 80],
  ["ASSEMBLER_MAX_CAPE_L_", 80],
  ["MASORI_ASSEMBLER_MAX_CAPE", 80],
  ["MASORI_ASSEMBLER_MAX_CAPE_2", 80],
  ["MASORI_ASSEMBLER_MAX_CAPE_L_", 80],
];

const QUIVER_NAMES = [
  "Dizana's quiver (uncharged)",
  "Dizana's quiver (l) (uncharged)",
  "Dizana's quiver",
  "Dizana's quiver (l)",
  "Blessed Dizana's quiver",
  "Blessed Dizana's quiver (l)",
];

let pluginApi = null;

function core() {
  return pluginApi.core;
}

function itemIdentifiers() {
  return core().ItemIdentifiers;
}

function stageOf(itemId) {
  const I = itemIdentifiers();
  if (itemId === I.DIZANAS_QUIVER_UNCHARGED_ || itemId === I.DIZANAS_QUIVER_L_UNCHARGED_) return "uncharged";
  if (itemId === I.DIZANAS_QUIVER || itemId === I.DIZANAS_QUIVER_L_) return "charged";
  if (itemId === I.BLESSED_DIZANAS_QUIVER || itemId === I.BLESSED_DIZANAS_QUIVER_L_) return "blessed";
  return null;
}

function isLocked(itemId) {
  const I = itemIdentifiers();
  return itemId === I.DIZANAS_QUIVER_L_UNCHARGED_ || itemId === I.DIZANAS_QUIVER_L_ || itemId === I.BLESSED_DIZANAS_QUIVER_L_;
}

function idFor(stage, locked = false) {
  const I = itemIdentifiers();
  if (stage === "uncharged") return locked ? I.DIZANAS_QUIVER_L_UNCHARGED_ : I.DIZANAS_QUIVER_UNCHARGED_;
  if (stage === "charged") return locked ? I.DIZANAS_QUIVER_L_ : I.DIZANAS_QUIVER;
  return locked ? I.BLESSED_DIZANAS_QUIVER_L_ : I.BLESSED_DIZANAS_QUIVER;
}

function brokenIdFor(itemId) {
  const I = itemIdentifiers();
  if (itemId === I.BLESSED_DIZANAS_QUIVER_L_) return I.BLESSED_DIZANAS_QUIVER_L_BROKEN_;
  if (itemId === I.BLESSED_DIZANAS_QUIVER) return I.BLESSED_DIZANAS_QUIVER_BROKEN_;
  if (itemId === I.DIZANAS_QUIVER_L_) return I.DIZANAS_QUIVER_L_BROKEN_;
  return I.DIZANAS_QUIVER_BROKEN_;
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

function wornQuiverItem(player) {
  const item = player.getEquipment().getItems()[core().Equipment.CAPE_SLOT];
  return item && stageOf(item.getId()) ? item : null;
}

function wornQuiver(player) {
  return wornQuiverItem(player) != null;
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

/** The arrow/bolt the current shot would fire, from the ammo slot first (Wiki). */
function activeAmmoId(player) {
  const fired = firedAmmunition(player);
  if (fired) return stored(player)?.id ?? -1;
  const weaponId = player.getEquipment().getItems()[core().Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const weapon = RangedWeapon.getFor(player);
  if (!weapon || RangedWeapon.getSelfAmmo(weaponId)) return -1;
  const worn = wornAmmo(player);
  return worn && isArrowOrBolt(worn.getId()) ? worn.getId() : -1;
}

// ------------------------------------------------------------------ charges

function itemCharges(item) {
  if (!item) return 0;
  if (stageOf(item.getId()) === "blessed") return MAX_CHARGES;
  const saved = Number(item.getMetaValue?.(CHARGE_META));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function setItemCharges(item, charges) {
  item.setMetaValue(CHARGE_META, Math.max(0, Math.min(MAX_CHARGES, Math.floor(charges))));
}

function blessingProgress(item) {
  const saved = Number(item?.getMetaValue?.(BLESSING_META));
  return Number.isFinite(saved) ? Math.max(0, Math.min(BLESSING_COST, Math.floor(saved))) : 0;
}

function chargeWithSplinters(event) {
  const quiverItem = [event.usedItem, event.usedWithItem].find((item) => stageOf(item?.getId?.()));
  const other = quiverItem === event.usedItem ? event.usedWithItem : event.usedItem;
  if (!quiverItem || Number(other?.getId?.()) !== itemIdentifiers().SUNFIRE_SPLINTERS) return false;
  const { player } = event;
  const stage = stageOf(quiverItem.getId());
  if (stage === "blessed") {
    player.sendMessage("Dizana's quiver is already fully charged.");
    event.handled = true;
    return true;
  }
  const left = MAX_CHARGES - itemCharges(quiverItem);
  if (left <= 0) {
    player.sendMessage("Dizana's quiver is already fully charged.");
    event.handled = true;
    return true;
  }
  const used = Math.min(left, other.getAmount());
  player.getInventory().deleteNumber(itemIdentifiers().SUNFIRE_SPLINTERS, used);
  setItemCharges(quiverItem, itemCharges(quiverItem) + used);
  quiverItem.setId(idFor("charged", isLocked(quiverItem.getId())));
  quiverItem.setMetaValue(BLESSING_META, Math.min(BLESSING_COST, blessingProgress(quiverItem) + used));
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage(`You use ${used} Sunfire splinter${used === 1 ? "" : "s"} to charge Dizana's quiver. It now has ${itemCharges(quiverItem)} charges.`);
  event.handled = true;
  return true;
}

function uncharge({ player, item }) {
  if (stageOf(item?.getId?.()) !== "charged") return false;
  const amount = itemCharges(item);
  const inventory = player.getInventory();
  if (amount > 0 && !inventory.contains(itemIdentifiers().SUNFIRE_SPLINTERS) && inventory.getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return true;
  }
  if (amount > 0) inventory.adds(itemIdentifiers().SUNFIRE_SPLINTERS, amount);
  item.setId(idFor("uncharged", isLocked(item.getId())));
  setItemCharges(item, 0);
  item.setMetaValue(BLESSING_META, undefined);
  inventory.refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage(`You fully uncharge Dizana's Quiver, regaining ${amount} sunfire splinter${amount === 1 ? "" : "s"} in the process.`);
  return true;
}

function blessAtShrine(event) {
  const { player, item } = event;
  if (!stageOf(item?.getId?.())) return false;
  if (stageOf(item.getId()) === "blessed") {
    player.sendMessage("Dizana's quiver is already blessed.");
    event.handled = true;
    return true;
  }
  const cost = Math.max(0, BLESSING_COST - blessingProgress(item));
  if (player.getInventory().getAmount(itemIdentifiers().SUNFIRE_SPLINTERS) < cost) {
    player.sendMessage(`You need ${cost.toLocaleString("en-US")} sunfire splinters to bless Dizana's quiver.`);
    event.handled = true;
    return true;
  }
  player.getInventory().deleteNumber(itemIdentifiers().SUNFIRE_SPLINTERS, cost);
  const wasCharged = stageOf(item.getId()) === "charged";
  item.setId(idFor("blessed", isLocked(item.getId())));
  item.setMetaValue(BLESSING_META, BLESSING_COST);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage(`You bless Dizana's quiver${wasCharged ? "" : " (uncharged)"}, allowing it to not need charges.`);
  event.handled = true;
  return true;
}

function upgradeWithAva(event) {
  const { player } = event;
  const quiverItem = [event.usedItem, event.usedWithItem].find((item) => stageOf(item?.getId?.()));
  const other = quiverItem === event.usedItem ? event.usedWithItem : event.usedItem;
  if (!quiverItem || !other) return false;
  const tier = AVA_RECOVERY.find(([name]) => itemIdentifiers()[name] === other.getId())?.[1];
  if (!tier) return false;
  const current = Number(player.getAttribute(AVA_ATTRIBUTE)) || 0;
  player.setAttribute(AVA_ATTRIBUTE, Math.max(current, tier));
  player.getInventory().refreshItems();
  player.sendMessage("You apply Ava's ammunition-saving effect to Dizana's quiver.");
  event.handled = true;
  return true;
}

function itemOnItem(event) {
  if (chargeWithSplinters(event) || upgradeWithAva(event)) {
    event.handled = true;
  }
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

// ------------------------------------------------------------------ Open

function buildOpenInterface() {
  const { widgets, add } = createWidgetGroup(OPEN_GROUP_ID);
  const root = add(OPEN_COMPONENT.ROOT, -1, {
    rawWidth: 300, rawHeight: 170, width: 300, height: 170,
    xPositionMode: 1, yPositionMode: 1,
  });
  add(OPEN_COMPONENT.FRAME, root, { widthMode: 1, heightMode: 1, width: 300, height: 170, type: TYPE_RECTANGLE, filled: true, color: 0x211b16, opacity: 32 });
  add(OPEN_COMPONENT.TITLE, root, {
    type: TYPE_TEXT, rawX: 12, rawY: 10, rawWidth: 276, rawHeight: 22, width: 276, height: 22,
    text: "Dizana's quiver", fontId: 496, textColor: 0xffd27f, textShadowed: true, xTextAlignment: 1, yTextAlignment: 1,
  });
  add(OPEN_COMPONENT.ITEM, root, {
    type: TYPE_GRAPHIC, rawX: 12, rawY: 42, rawWidth: 64, rawHeight: 64, width: 64, height: 64,
    itemId: -1, itemQuantity: 0, itemQuantityMode: 2,
  });
  add(OPEN_COMPONENT.CONTENT, root, {
    type: TYPE_TEXT, rawX: 88, rawY: 42, rawWidth: 200, rawHeight: 40, width: 200, height: 40,
    text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true,
  });
  add(OPEN_COMPONENT.CHARGES, root, {
    type: TYPE_TEXT, rawX: 12, rawY: 116, rawWidth: 276, rawHeight: 40, width: 276, height: 40,
    text: "", fontId: 494, textColor: 0xe8ded0, textShadowed: true,
  });
  return { groupId: OPEN_GROUP_ID, widgets };
}

function renderOpen(player) {
  const ammo = stored(player);
  const quiver = wornQuiverItem(player) ?? [player.getInventory().getItems?.() ?? [], player.getEquipment().getItems?.() ?? []]
    .flat().find((item) => stageOf(item?.getId?.()));
  const stage = quiver ? stageOf(quiver.getId()) : "uncharged";
  const charges = quiver ? itemCharges(quiver) : 0;
  const blessing = quiver ? blessingProgress(quiver) : 0;
  const sender = player.getPacketSender();
  sender.sendString(ammo ? `${name(ammo.id)} x ${ammo.amount.toLocaleString("en-US")}` : "Your quiver is empty.", OPEN_UID(OPEN_COMPONENT.CONTENT));
  sender.sendString(
    stage === "blessed"
      ? "Dizana's Sunfire is permanent."
      : `Dizana's Sunfire: ${charges.toLocaleString("en-US")} charges (${Math.floor(blessing * 100 / BLESSING_COST)}% blessed).`,
    OPEN_UID(OPEN_COMPONENT.CHARGES),
  );
  sender.sendItemOnInterface(OPEN_UID(OPEN_COMPONENT.ITEM), ammo ? ammo.id : -1, 0, ammo ? ammo.amount : 0);
}

function openQuiver({ player }) {
  if (!player || typeof player.getPacketSender !== "function") return false;
  player.setInterfaceId?.(OPEN_GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, OPEN_GROUP_ID, 0);
  renderOpen(player);
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

function hasSunfire(player) {
  const quiver = wornQuiverItem(player);
  if (!quiver) return false;
  const stage = stageOf(quiver.getId());
  return stage === "blessed" || (stage === "charged" && itemCharges(quiver) > 0);
}

/** Quiver ammo counts as worn ammo, and a charged quiver adds Dizana's Sunfire to arrows/bolts. */
function quiverBonuses({ player, bonuses }) {
  if (hasSunfire(player) && activeAmmoId(player) > 0) {
    bonuses[RANGED_ATTACK] += SUNFIRE_ATTACK;
    bonuses[RANGED_STRENGTH] += SUNFIRE_STRENGTH;
  }
  const fired = firedAmmunition(player);
  if (!fired) return;
  const ammoBonuses = core().ItemDefinition.forId(stored(player).id)?.getBonuses?.() ?? [];
  bonuses[RANGED_ATTACK] += Number(ammoBonuses[RANGED_ATTACK] ?? 0);
  bonuses[RANGED_STRENGTH] += Number(ammoBonuses[RANGED_STRENGTH] ?? 0);
}

/** 1/3 of shots spend a charge; blessed quivers never do (Wiki). */
function spendCharge({ attacker, hit }) {
  if (!attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer?.() ?? attacker;
  if (!hasSunfire(player)) return;
  const quiver = wornQuiverItem(player);
  if (!quiver || stageOf(quiver.getId()) !== "charged") return;
  if (hit?.getCombatType?.() !== core().CombatType.RANGED) return;
  if (activeAmmoId(player) <= 0) return;
  if (core().Misc.getRandom(2) !== 0) return;
  const left = itemCharges(quiver) - 1;
  if (left > 0) {
    setItemCharges(quiver, left);
    return;
  }
  quiver.setId(idFor("uncharged", isLocked(quiver.getId())));
  setItemCharges(quiver, 0);
  player.getEquipment().refreshItems();
  player.sendMessage("Your Dizana's quiver has run out of charges.");
}

function avaRecovery(player) {
  if (!wornQuiver(player)) return null;
  const tier = Number(player.getAttribute?.(AVA_ATTRIBUTE)) || 0;
  return tier > 0 ? tier : null;
}

// ------------------------------------------------------------------ death

function wildernessLevel(player) {
  const location = player.getLocation?.();
  if (!location) return 0;
  return Number(core().Wilderness.levelAt(location.getX(), location.getY())) || 0;
}

function shouldKeepQuiver({ player, item }) {
  if (!stageOf(item?.getId?.())) return null;
  const level = wildernessLevel(player);
  if (level <= 0) return null;
  if (level <= 20 || isLocked(item.getId())) return true;
  return null;
}

function dropCoins(event, amount) {
  if (!event.location) return;
  const { Item, ItemOnGroundManager } = core();
  ItemOnGroundManager.registerLocation(event.killer ?? event.player, new Item(COINS, amount), event.location);
}

function clearQuiverState(player, item) {
  const stage = stageOf(item.getId());
  if (stage === "charged") item.setId(idFor("uncharged", isLocked(item.getId())));
  setItemCharges(item, 0);
  item.setMetaValue(BLESSING_META, undefined);
  store(player, null);
}

function deathItemDrop(event) {
  const { player, item } = event;
  if (!stageOf(item?.getId?.())) return;
  const level = wildernessLevel(player);
  if (level <= 0) return;
  const ammo = stored(player);
  const byPlayer = event.killer && event.killer !== player && event.killer.isPlayer?.() === true;
  const locked = isLocked(item.getId());
  if (level <= 20) {
    item.setId(brokenIdFor(item.getId()));
    if (byPlayer) dropCoins(event, REPAIR_COST);
  } else if (!locked) {
    item.setId(-1);
    event.handled = true;
    if (byPlayer) dropCoins(event, WILDERNESS_RECLAIM);
  }
  // Above 20 a locked quiver is kept, but its ammo is lost rather than dropped (Wiki).
  if (ammo && event.location && (level <= 20 || !locked)) {
    const { Item, ItemOnGroundManager } = core();
    ItemOnGroundManager.registerLocation(event.killer ?? player, new Item(ammo.id, ammo.amount), event.location);
  }
  clearQuiverState(player, item);
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
    api.persistAttribute(AVA_ATTRIBUTE, 0);
    api.onPlayerLogin(login);
    api.onInterfaceActionClick(slotClicked);
    api.onItemOnItem(itemOnItem, { noted: false });
    api.onCombatHitResolved(spendCharge);
    api.onShouldKeepItemOnDeath(shouldKeepQuiver);
    api.onPlayerDeathItemDrop(deathItemDrop);
    api.registerCustomInterface(buildOpenInterface());
    for (const quiver of QUIVER_NAMES) {
      api.onItemAction(quiver, { Open: openQuiver, Empty: emptyQuiver, Uncharge: uncharge });
      api.onItemOnObject(quiver, "Shrine of Ralos", blessAtShrine, { noted: false });
    }
    api.registerRangedAmmoResolver({ resolve: resolveAmmo });
    api.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
    api.registerRangedAmmoRecovery({ recovery: avaRecovery });
    api.registerBonusProvider({ apply: quiverBonuses });
  },
  ATTRIBUTE,
  CHARGE_META,
  AVA_ATTRIBUTE,
  VARP,
  stored,
  firedAmmunition,
  slotClicked,
  _test: { stageOf, idFor, itemCharges, blessingProgress, chargeWithSplinters, uncharge, blessAtShrine, upgradeWithAva, avaRecovery, hasSunfire, quiverBonuses, spendCharge, shouldKeepQuiver, deathItemDrop, openQuiver, renderOpen, activeAmmoId, brokenIdFor },
};
