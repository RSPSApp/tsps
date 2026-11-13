"use strict";

/**
 * The original revenant weapons (docs/revenant-weapons.md): Viggora's chainmace, the Ursine chainmace
 * and Craw's bow (https://oldschool.runescape.wiki/w/Viggora%27s_chainmace,
 * https://oldschool.runescape.wiki/w/Ursine_chainmace, https://oldschool.runescape.wiki/w/Craw%27s_bow).
 *
 * Wiki: each is activated with 1,000 revenant ether, which is not a charge, and then holds up to
 * 16,000 more, one an attack. Charged in the Wilderness it adds 50% accuracy and damage against NPCs;
 * outside the Wilderness an attack still spends the ether. The chainmaces work uncharged without the
 * passive, Craw's bow needs ether to fire at all. Uncharge returns every ether, the activation ether
 * included; Dismantle gives 7,500 ether for an uncharged one, and splits an uncharged Ursine chainmace
 * back into Viggora's chainmace and the Claws of Callisto. Both ask on the destroy prompt first. Dying in the Wilderness drops the
 * ether even when the weapon is protected. The Webweaver bow, its sibling, is WebweaverBow.plugin.js
 * and the accursed sceptre is AccursedSceptre.plugin.js, both built from rsprox captures. No capture
 * shows these four weapons, so their messages follow those two (the bow's "Your bow has N charges left
 * powering it.") with the weapon's own word.
 */
const { restricted, plainAmount, takePlain, PRESET_TEXT, ETHER_PROMPT, UNCHARGE_SOUND, askFirst, dismantleForEther } = require("./PoweredStaff");

const CHARGES_META = "revenant-weapon:charges";
// Set only when addEther takes the activation ether: a weapon from a shop, spawn or older save has no
// paid reserve to refund or drop.
const DEPOSIT_META = "revenant-weapon:deposit";
// Set when a weapon with no paid deposit is emptied: its ether was never paid in, so Dismantle refuses it. Never cleared.
const UNPAID_META = "revenant-weapon:unpaid";
const ACTIVATION_ETHER = 1000;
const MAX_CHARGES = 16000;
const DISMANTLE_ETHER = 7500;
const WILDERNESS_MULTIPLIER = 1.5;
const BUSY_VARBIT = 12393; // cache gameval busy; the revenant-weapon amount prompt
const MELEE = "melee";
const RANGED = "ranged";

let api;
let core;
/** item id -> its weapon: { name, label, style, charged, uncharged }. */
const weaponsById = new Map();
/** The cycle a worn weapon last paid its ether on: that attack keeps the passive it paid for. */
const paidOn = new WeakMap();

const format = (amount) => amount.toLocaleString("en-US");
const weaponOf = (player) => player.getEquipment().get(core.Equipment.WEAPON_SLOT);
const weaponFor = (item) => weaponsById.get(item?.getId?.());
const activated = (item) => weaponFor(item)?.charged === item.getId();
const depositOf = (item) => (item?.getMetaValue(DEPOSIT_META) === true ? ACTIVATION_ETHER : 0);
const chargesOf = (item) => Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue(CHARGES_META)) || 0)));
const setCharges = (item, charges) => item.setMetaValue(CHARGES_META, charges > 0 ? charges : undefined);

function defineWeapons() {
  const I = core.ItemIdentifiers;
  const definitions = [
    // dismantleText: the objectbox before an ether Dismantle, wrapped as live sends it (Ours: Viggora's wrap,
    // as Thammaron's sceptre's). parts: what Dismantle splits the weapon into instead.
    { name: "Viggora's chainmace", label: "chainmace", style: MELEE, charged: I.VIGGORAS_CHAINMACE, uncharged: I.VIGGORAS_CHAINMACE_U_,
      dismantleText: "Viggora's chainmace (u) will be dismantled for <col=ef1020>7500<br><col=ef1020>Revenant ether</col>." },
    { name: "Ursine chainmace", label: "chainmace", style: MELEE, charged: I.URSINE_CHAINMACE, uncharged: I.URSINE_CHAINMACE_U_,
      parts: [I.VIGGORAS_CHAINMACE_U_, I.CLAWS_OF_CALLISTO] },
    { name: "Craw's bow", label: "bow", style: RANGED, charged: I.CRAWS_BOW, uncharged: I.CRAWS_BOW_U_,
      dismantleText: "Craw's bow (u) will be dismantled for <col=ef1020>7500 Revenant<br><col=ef1020>ether</col>." },
  ];
  for (const weapon of definitions) {
    weaponsById.set(weapon.charged, weapon);
    weaponsById.set(weapon.uncharged, weapon);
  }
  return definitions;
}

// ------------------------------------------------------------------ charging

function chargeWithEther(event) {
  const { player, usedItem, usedWithItem } = event;
  const item = weaponFor(usedItem) ? usedItem : weaponFor(usedWithItem) ? usedWithItem : null;
  const other = item === usedItem ? usedWithItem : usedItem;
  if (!item || other?.getId() !== core.ItemIdentifiers.REVENANT_ETHER) return;
  event.handled = true;
  if (restricted(item) || restricted(other)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  const deposit = ACTIVATION_ETHER - depositOf(item);
  const ether = plainAmount(player.getInventory(), core.ItemIdentifiers.REVENANT_ETHER);
  if (ether < deposit) {
    player.sendMessage(`You need ${format(ACTIVATION_ETHER)} revenant ether to activate the weapon.`);
    return;
  }
  const most = Math.min(ether - deposit, MAX_CHARGES - chargesOf(item));
  if (!deposit && most <= 0) {
    player.sendMessage(`Your ${weaponFor(item).label} cannot hold any more ether.`);
    return;
  }
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setEnteredAmountAction({ acceptsZero: true, execute(amount) {
    sender.sendVarbit(BUSY_VARBIT, 0);
    addEther(player, item, amount);
  } });
  sender.sendEnterAmountPrompt(`How many ether would you like to add? (0 - ${format(most)})`);
}

function addEther(player, item, amount) {
  const inventory = player.getInventory();
  const weapon = weaponFor(item);
  if (!inventory.getItems().includes(item) || !weapon || restricted(item)) return;
  const deposit = ACTIVATION_ETHER - depositOf(item);
  const ether = plainAmount(inventory, core.ItemIdentifiers.REVENANT_ETHER);
  const current = chargesOf(item);
  const added = Math.max(0, Math.min(Math.floor(Number(amount) || 0), ether - deposit, MAX_CHARGES - current));
  if (ether < deposit || (!deposit && added <= 0)) return;
  takePlain(inventory, core.ItemIdentifiers.REVENANT_ETHER, deposit + added);
  item.setId(weapon.charged);
  item.setMetaValue(DEPOSIT_META, true);
  setCharges(item, current + added);
  inventory.refreshItems();
  if (deposit) player.sendMessage(`You use ${format(ACTIVATION_ETHER)} ether to activate the weapon.`);
  if (added > 0) player.sendMessage(`You add ${deposit ? "a further " : ""}${format(added)} revenant ether to your weapon, giving it a total of ${format(current + added)} charges.`);
}

function check({ player, item }) {
  player.sendMessage(`Your ${weaponFor(item).label} has ${format(chargesOf(item))} charges left powering it.`);
  return true;
}

function emptyWeapon(item) {
  const paid = depositOf(item) > 0;
  setCharges(item, 0);
  item.setMetaValue(DEPOSIT_META, undefined);
  if (!paid) item.setMetaValue(UNPAID_META, true);
  item.setId(weaponFor(item).uncharged);
}

function uncharge({ player, item }) {
  if (!activated(item) || !player.getInventory().getItems().includes(item)) return false;
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  askFirst(api, player, item, ETHER_PROMPT.UNCHARGE_QUESTION, ETHER_PROMPT.UNCHARGE_NOTE, unchargeNow);
  return true;
}

function unchargeNow(player, item) {
  if (!activated(item) || restricted(item)) return;
  const inventory = player.getInventory();
  const label = weaponFor(item).label;
  const returned = depositOf(item) + chargesOf(item);
  const refund = new core.Item(core.ItemIdentifiers.REVENANT_ETHER, returned);
  if (returned > 0 && inventory.getAddableAmount(refund) < returned) {
    player.sendMessage(`You don't have enough inventory space to uncharge your ${label}.`);
    return;
  }
  if (returned > 0) inventory.addItem(refund);
  emptyWeapon(item);
  inventory.refreshItems();
  player.getPacketSender().sendSound(UNCHARGE_SOUND, 100, 0);
}

/** Wiki: dismantling an uncharged weapon yields 7,500 revenant ether; the Ursine chainmace gives its parts back. */
function dismantle({ player, item }) {
  const inventory = player.getInventory();
  if (activated(item) || !weaponFor(item) || !inventory.getItems().includes(item)) return false;
  const weapon = weaponFor(item);
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (weapon.parts) {
    askFirst(api, player, item, ETHER_PROMPT.DISMANTLE_QUESTION, ETHER_PROMPT.COMPONENTS_NOTE, splitNow);
    return true;
  }
  if (item.getMetaValue(UNPAID_META) === true) {
    player.sendMessage(`Your ${weapon.label} was never activated with ether, so it cannot be dismantled.`);
    return true;
  }
  dismantleForEther(api, player, item, weapon.dismantleText, dismantleNow);
  return true;
}

function splitNow(player, item) {
  const [base, part] = weaponFor(item)?.parts ?? [];
  if (base === undefined || item.getId() !== weaponFor(item).uncharged) return;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  item.setId(base);
  inventory.addItem(new core.Item(part, 1));
  inventory.refreshItems();
}

function dismantleNow(player, item) {
  const inventory = player.getInventory();
  if (activated(item) || !weaponFor(item) || item.getMetaValue(UNPAID_META) === true) return;
  const label = weaponFor(item).label;
  // The weapon's own slot is freed for the ether, so only a full stack of it can be refused.
  const slot = inventory.getItems().indexOf(item);
  // A copy to put back: the delete empties the slot's own Item (id -1), so restoring `item` restored nothing.
  const kept = item.clone();
  inventory.deleteAtSlot(slot, 1, false);
  const ether = new core.Item(core.ItemIdentifiers.REVENANT_ETHER, DISMANTLE_ETHER);
  if (inventory.getAddableAmount(ether) < DISMANTLE_ETHER) {
    inventory.setItem(slot, kept);
    player.sendMessage(`You don't have enough inventory space to dismantle your ${label}.`);
    return;
  }
  inventory.addItem(ether);
  inventory.refreshItems();
}

// ------------------------------------------------------------------ combat

/** Wiki: an attack spends one ether, whether it hits or misses and wherever it is made. */
function payCharge(player, item) {
  const consume = { player, itemId: item.getId(), skip: false };
  api.emitCustomEvent("combat:consume-charge", consume);
  if (!consume.skip) setCharges(item, chargesOf(item) - 1);
  // The charge is paid before the hit rolls: the last ether still boosts the attack it paid for.
  paidOn.set(item, core.World.getProcessCycle());
}

/** A melee swing pays before it rolls (combat:attack-started); a shot pays through the ammo handler. */
function attackStarted({ attacker, method }) {
  if (!attacker?.isPlayer?.() || method?.type?.() !== core.CombatType.MELEE) return;
  const item = weaponOf(attacker.getAsPlayer());
  if (weaponFor(item)?.style !== MELEE || !activated(item) || chargesOf(item) <= 0) return;
  payCharge(attacker.getAsPlayer(), item);
}

function checkAmmo(player, _amount, silent = false) {
  const item = weaponOf(player);
  if (weaponFor(item)?.style !== RANGED) return null;
  if (activated(item) && chargesOf(item) > 0) return true;
  if (!silent) player.sendMessage(`There is not enough revenant ether left powering your ${weaponFor(item).label}.`);
  return false;
}

function decrementAmmo(player) {
  const item = weaponOf(player);
  if (weaponFor(item)?.style !== RANGED) return false;
  if (chargesOf(item) > 0) payCharge(player, item);
  return true;
}

/** Wiki: +50% accuracy and damage against NPCs in the Wilderness, while the weapon holds ether. */
function passiveApplies(attacker, target, style) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return false;
  const item = weaponOf(attacker.getAsPlayer());
  return weaponFor(item)?.style === style && activated(item)
    && (chargesOf(item) > 0 || paidOn.get(item) === core.World.getProcessCycle())
    && core.Wilderness.isInLocation(target.getLocation());
}

// Applied after equipment bonuses, so a Salve amulet (i) still multiplies the passive.
const rangedBoost = (attacker, target, value) => (passiveApplies(attacker, target, RANGED) ? Math.floor(value * WILDERNESS_MULTIPLIER) : value);

function imbuedSlayerActive(player) {
  const query = { player, style: RANGED, active: false };
  api.emitCustomEvent("slayer:imbued-active", query);
  return query.active === true;
}

/** Wiki DPS 701b2dac: ranged damage is33/20 with imbued Slayer, accuracy still multiplies. */
function rangedDamageBoost(attacker, target, value) {
  if (!passiveApplies(attacker, target, RANGED) || imbuedSlayerActive(attacker.getAsPlayer())) return value;
  return Math.floor(value * WILDERNESS_MULTIPLIER);
}

function addToSlayerBonus(payload) {
  if (passiveApplies(payload?.player, core.hitTargetOf(payload?.player), RANGED)) {
    payload.numerator += 10;
  }
}

const meleeBoost = (attacker, value) => (passiveApplies(attacker, core.hitTargetOf(attacker), MELEE) ? Math.floor(value * WILDERNESS_MULTIPLIER) : value);

// ------------------------------------------------------------------ death

function deathItemDrop(event) {
  const { player, killer, item, location } = event;
  if (!event.shouldDropItems || !killer || killer === player || !weaponFor(item) || !activated(item) || restricted(item)
      || !core.Wilderness.isInLocation(location)) return;
  const lost = depositOf(item) + chargesOf(item);
  // Wiki: in the Wilderness all ether is lost, even when the weapon is protected.
  if (lost > 0) core.ItemOnGroundManager.registerLocation(killer, new core.Item(core.ItemIdentifiers.REVENANT_ETHER, lost), location);
  emptyWeapon(item);
  paidOn.delete(item);
  // Core already returns kept items; report the ether drop without dropping the weapon as well.
  if (event.kept) event.handled = true;
}

module.exports = {
  name: "RevenantWeapons",
  description: "Adds Viggora's chainmace, the Ursine chainmace and Craw's bow: revenant ether charging, Wilderness damage bonus, uncharging and dismantling.",
  members: true,
  _test: { CHARGES_META, DEPOSIT_META, UNPAID_META, ACTIVATION_ETHER, MAX_CHARGES, DISMANTLE_ETHER, chargesOf, addEther, chargeWithEther, uncharge, dismantle, attackStarted, checkAmmo, decrementAmmo, rangedBoost, rangedDamageBoost, addToSlayerBonus, meleeBoost, deathItemDrop },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    defineWeapons();
    pluginApi.onItemOnItem(chargeWithEther, { noted: false });
    pluginApi.onCustomEvent("combat:attack-started", attackStarted);
    pluginApi.onCustomEvent("slayer:imbued-ranged-bonus", addToSlayerBonus);
    pluginApi.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
    pluginApi.registerRangedCombatModifier({ modifyMaxHit: rangedDamageBoost, modifyAttackRoll: rangedBoost });
    pluginApi.registerMeleeHitModifier(meleeBoost);
    pluginApi.registerMeleeAttackAccuracyModifier(meleeBoost);
    pluginApi.onPlayerDeathItemDrop(deathItemDrop);
    for (const name of ["Viggora's chainmace", "Ursine chainmace", "Craw's bow"]) {
      pluginApi.onItemAction(name, { Check: check, Uncharge: uncharge });
      pluginApi.onItemAction(`${name} (u)`, { Dismantle: dismantle });
    }
  },
};
