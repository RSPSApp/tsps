"use strict";
const { PlayerDeathTask } = require("../../src/main/typescript/elvarg/game/task/impl/PlayerDeath");

// OSRS Wiki: Webweaver bow / Webweaver bow (u). 1,000 activation ether plus 16,000
// usable charges; one ether per shot, including the whole Swarm special (30 August 2023).
// Uncharge asks on the destroy prompt first; Dismantle on the (u) asks, then splits it into
// Craw's bow (u) and the Fangs of Venenatis (Wiki: Fangs of Venenatis).
const { restricted, plainAmount, takePlain, PRESET_TEXT, ETHER_PROMPT, UNCHARGE_SOUND, askFirst } = require("./PoweredStaff");

const CHARGES_META = "webweaver-bow:charges";
// Set only when addEther takes the activation ether: a charged bow from a shop, spawn or
// older save has no paid reserve to refund or drop.
const DEPOSIT_META = "webweaver-bow:deposit";
// RevenantWeapons' mark for a weapon emptied without a paid deposit: Craw's bow (u), dismantled out
// of this bow, keeps it, so its Dismantle refuses ether that was never paid in. Never cleared.
const UNPAID_META = "revenant-weapon:unpaid";
const ACTIVATION_ETHER = 1000;
const MAX_CHARGES = 16000;
const BUSY_VARBIT = 12393; // cache gameval busy; the revenant-weapon amount prompt
let api;
let core;
const paidOn = new WeakMap();

const format = (amount) => amount.toLocaleString("en-US");
const isBow = (item) => [core.ItemIdentifiers.WEBWEAVER_BOW_U_, core.ItemIdentifiers.WEBWEAVER_BOW].includes(item?.getId());
const activated = (item) => item?.getId() === core.ItemIdentifiers.WEBWEAVER_BOW;
const weaponOf = (player) => player.getEquipment().get(core.Equipment.WEAPON_SLOT);
const depositOf = (item) => (item?.getMetaValue(DEPOSIT_META) === true ? ACTIVATION_ETHER : 0);
const chargesOf = (item) => Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue(CHARGES_META)) || 0)));

function setCharges(item, charges) {
  item.setMetaValue(CHARGES_META, charges > 0 ? charges : undefined);
}

function emptyBow(item) {
  if (depositOf(item) === 0) item.setMetaValue(UNPAID_META, true);
  setCharges(item, 0);
  item.setMetaValue(DEPOSIT_META, undefined);
  item.setId(core.ItemIdentifiers.WEBWEAVER_BOW_U_);
}

function chargeWithEther(event) {
  const { player, usedItem, usedWithItem } = event;
  const item = isBow(usedItem) ? usedItem : isBow(usedWithItem) ? usedWithItem : null;
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
    player.sendMessage("Your bow cannot hold any more ether.");
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
  if (!inventory.getItems().includes(item) || !isBow(item) || restricted(item)) return;
  const deposit = ACTIVATION_ETHER - depositOf(item);
  const ether = plainAmount(inventory, core.ItemIdentifiers.REVENANT_ETHER);
  const current = chargesOf(item);
  const added = Math.max(0, Math.min(Math.floor(Number(amount) || 0), ether - deposit, MAX_CHARGES - current));
  if (ether < deposit || (!deposit && added <= 0)) return;
  takePlain(inventory, core.ItemIdentifiers.REVENANT_ETHER, deposit + added);
  item.setId(core.ItemIdentifiers.WEBWEAVER_BOW);
  item.setMetaValue(DEPOSIT_META, true);
  setCharges(item, current + added);
  inventory.refreshItems();
  if (deposit) player.sendMessage(`You use ${format(ACTIVATION_ETHER)} ether to activate the weapon.`);
  if (added > 0) player.sendMessage(`You add ${deposit ? "a further " : ""}${format(added)} revenant ether to your weapon, giving it a total of ${format(current + added)} charges.`);
}

function check({ player, item }) {
  player.sendMessage(`Your bow has ${format(chargesOf(item))} charges left powering it.`);
  return true;
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
  const returned = depositOf(item) + chargesOf(item);
  const refund = new core.Item(core.ItemIdentifiers.REVENANT_ETHER, returned);
  if (returned > 0 && inventory.getAddableAmount(refund) < returned) {
    player.sendMessage("You don't have enough inventory space to uncharge your bow.");
    return;
  }
  if (returned > 0) inventory.addItem(refund);
  emptyBow(item);
  inventory.refreshItems();
  player.getPacketSender().sendSound(UNCHARGE_SOUND, 100, 0);
}

function dismantle({ player, item }) {
  if (item?.getId() !== core.ItemIdentifiers.WEBWEAVER_BOW_U_ || !player.getInventory().getItems().includes(item)) return false;
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  askFirst(api, player, item, ETHER_PROMPT.DISMANTLE_QUESTION, ETHER_PROMPT.COMPONENTS_NOTE, dismantleNow);
  return true;
}

function dismantleNow(player, item) {
  if (item.getId() !== core.ItemIdentifiers.WEBWEAVER_BOW_U_) return;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  item.setId(core.ItemIdentifiers.CRAWS_BOW_U_);
  inventory.addItem(new core.Item(core.ItemIdentifiers.FANGS_OF_VENENATIS, 1));
  inventory.refreshItems();
}

function checkAmmo(player, _amount, silent = false) {
  const item = weaponOf(player);
  if (!isBow(item)) return null;
  if (activated(item) && chargesOf(item) > 0) return true;
  if (!silent) player.sendMessage("There is not enough revenant ether left powering your bow.");
  return false;
}

function decrementAmmo(player) {
  const item = weaponOf(player);
  if (!isBow(item)) return false;
  if (chargesOf(item) <= 0) return true;
  const consume = { player, itemId: item.getId(), skip: false };
  api.emitCustomEvent("combat:consume-charge", consume);
  if (!consume.skip) setCharges(item, chargesOf(item) - 1);
  // start() pays before hits() rolls: the last charge still boosts the attack it paid for.
  paidOn.set(item, core.World.getProcessCycle());
  return true;
}

function passiveApplies(attacker, target) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return false;
  const item = weaponOf(attacker.getAsPlayer());
  return activated(item) && (chargesOf(item) > 0 || paidOn.get(item) === core.World.getProcessCycle())
    && core.Wilderness.isInLocation(target.getLocation());
}

function boost(attacker, target, value) {
  // Applied after equipment bonuses, so Salve (i)/(ei) still multiplies the passive.
  return passiveApplies(attacker, target) ? Math.floor(value * 1.5) : value;
}

/** Wiki DPS 701b2dac: with an imbued Slayer helmet on task, damage adds 10/20 to its 23/20 instead. */
function damageBoost(attacker, target, value) {
  if (!passiveApplies(attacker, target)) return value;
  const query = { player: attacker.getAsPlayer(), style: "ranged", active: false };
  api.emitCustomEvent("slayer:imbued-active", query);
  return query.active === true ? value : Math.floor(value * 1.5);
}

/** "slayer:imbued-ranged-bonus": { player, numerator } -> +10/20 against the hit's own victim (core.hitTargetOf). */
function addToSlayerBonus(payload) {
  if (passiveApplies(payload?.player, core.hitTargetOf(payload?.player))) payload.numerator += 10;
}

function deathItemDrop(event) {
  const { player, killer, item, location } = event;
  if (!event.shouldDropItems || !killer || killer === player || !activated(item) || restricted(item)
      || !core.Wilderness.isInLocation(location)) return;
  const lost = depositOf(item) + chargesOf(item);
  // Wiki: in Wilderness PvP all ether is lost, even when the bow is protected.
  if (lost > 0) core.ItemOnGroundManager.registerLocation(PlayerDeathTask.lootOwner(player, killer), new core.Item(core.ItemIdentifiers.REVENANT_ETHER, lost), location);
  emptyBow(item);
  paidOn.delete(item);
  // Core already returns kept items; report the ether drop without dropping the bow as well.
  if (event.kept) event.handled = true;
}

module.exports = {
  name: "WebweaverBow",
  description: "Adds the webweaver bow: activation and charging with revenant ether, Uncharge and Dismantle, and its damage bonus including an imbued Slayer helmet on task.",
  members: true,
  _test: { CHARGES_META, DEPOSIT_META, ACTIVATION_ETHER, MAX_CHARGES, chargesOf, addEther, chargeWithEther, uncharge, dismantle, checkAmmo, decrementAmmo, boost, damageBoost, addToSlayerBonus, deathItemDrop },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onItemOnItem(chargeWithEther, { noted: false });
    pluginApi.onItemAction("Webweaver bow", { Check: check, Uncharge: uncharge });
    pluginApi.onItemAction("Webweaver bow (u)", { Dismantle: dismantle });
    pluginApi.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
    pluginApi.onCustomEvent("slayer:imbued-ranged-bonus", addToSlayerBonus);
    pluginApi.registerRangedCombatModifier({ modifyMaxHit: damageBoost, modifyAttackRoll: boost });
    pluginApi.onPlayerDeathItemDrop(deathItemDrop);
  },
};
