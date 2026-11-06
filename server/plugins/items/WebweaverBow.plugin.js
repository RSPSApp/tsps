"use strict";

// OSRS Wiki: Webweaver bow / Webweaver bow (u). 1,000 activation ether plus 16,000
// usable charges; one ether per shot, including the whole Swarm special (30 August 2023).
const { restricted, plainAmount, takePlain, PRESET_TEXT } = require("./PoweredStaff");

const CHARGES_META = "webweaver-bow:charges";
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
const chargesOf = (item) => Math.max(0, Math.min(MAX_CHARGES, Math.floor(Number(item?.getMetaValue(CHARGES_META)) || 0)));

function setCharges(item, charges) {
  item.setMetaValue(CHARGES_META, charges > 0 ? charges : undefined);
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
  const deposit = activated(item) ? 0 : ACTIVATION_ETHER;
  const ether = plainAmount(player.getInventory(), core.ItemIdentifiers.REVENANT_ETHER);
  if (ether < deposit) {
    player.sendMessage(`You need ${format(ACTIVATION_ETHER)} revenant ether to activate the weapon.`);
    return;
  }
  const most = Math.min(ether - deposit, MAX_CHARGES - chargesOf(item));
  if (activated(item) && most <= 0) {
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
  const wasActivated = activated(item);
  const deposit = wasActivated ? 0 : ACTIVATION_ETHER;
  const ether = plainAmount(inventory, core.ItemIdentifiers.REVENANT_ETHER);
  const current = chargesOf(item);
  const added = Math.max(0, Math.min(Math.floor(Number(amount) || 0), ether - deposit, MAX_CHARGES - current));
  if (ether < deposit || (wasActivated && added <= 0)) return;
  takePlain(inventory, core.ItemIdentifiers.REVENANT_ETHER, deposit + added);
  item.setId(core.ItemIdentifiers.WEBWEAVER_BOW);
  setCharges(item, current + added);
  inventory.refreshItems();
  if (deposit) player.sendMessage(`You use ${format(ACTIVATION_ETHER)} ether to activate the weapon.`);
  if (added > 0) player.sendMessage(`You add ${wasActivated ? "" : "a further "}${format(added)} revenant ether to your weapon, giving it a total of ${format(current + added)} charges.`);
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
  const inventory = player.getInventory();
  const returned = ACTIVATION_ETHER + chargesOf(item);
  const refund = new core.Item(core.ItemIdentifiers.REVENANT_ETHER, returned);
  if (inventory.getAddableAmount(refund) < returned) {
    player.sendMessage("You don't have enough inventory space to uncharge your bow.");
    return true;
  }
  inventory.addItem(refund);
  setCharges(item, 0);
  item.setId(core.ItemIdentifiers.WEBWEAVER_BOW_U_);
  inventory.refreshItems();
  player.sendMessage(`You uncharge your bow, regaining ${format(returned)} revenant ether.`);
  return true;
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

function deathItemDrop(event) {
  const { player, killer, item, location } = event;
  if (!event.shouldDropItems || !killer || killer === player || !activated(item) || restricted(item)
      || !core.Wilderness.isInLocation(location)) return;
  const ether = new core.Item(core.ItemIdentifiers.REVENANT_ETHER, ACTIVATION_ETHER + chargesOf(item));
  // Wiki: in Wilderness PvP all ether is lost, even when the bow is protected.
  core.ItemOnGroundManager.registerLocation(killer, ether, location);
  setCharges(item, 0);
  paidOn.delete(item);
  item.setId(core.ItemIdentifiers.WEBWEAVER_BOW_U_);
  // Core already returns kept items; report the ether drop without dropping the bow as well.
  if (event.kept) event.handled = true;
}

module.exports = {
  name: "WebweaverBow",
  members: true,
  _test: { CHARGES_META, ACTIVATION_ETHER, MAX_CHARGES, chargesOf, addEther, chargeWithEther, uncharge, checkAmmo, decrementAmmo, boost, deathItemDrop },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onItemOnItem(chargeWithEther, { noted: false });
    pluginApi.onItemAction("Webweaver bow", { Check: check, Uncharge: uncharge });
    pluginApi.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
    pluginApi.registerRangedCombatModifier({ modifyMaxHit: boost, modifyAttackRoll: boost });
    pluginApi.onPlayerDeathItemDrop(deathItemDrop);
  },
};
