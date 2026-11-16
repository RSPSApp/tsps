"use strict";

// Wiki Alchemist's amulet: 15%, 10 charges/chemistry, 5,000 cap, 50 on purchase,
// noted refunds floor(charges/10), no stop-on-empty setting. The Wiki does not
// specify charge ownership; per-item metadata follows charged equipment here.
// No capture covers this amulet's messages or prompts; wording below is uncaptured.
const CHARGES_META_KEY = "alchemists-amulet:charges";
const MAX_CHARGES = 5000;
const CHARGES_PER_AMULET = 10;
const EXTRA_DOSE_CHANCE = 0.15;
let api;
let core;
let extraDose;
let chargedId;
let unchargedId;
let chemistryId;

function isAmulet(item) {
  return item && (item.getId() === chargedId || item.getId() === unchargedId);
}

function charges(item) {
  if (item?.getId() !== chargedId) return 0;
  const value = Number(item.getMetaValue(CHARGES_META_KEY));
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(value))) : 0;
}

function setCharges(item, count) {
  item.setId(count > 0 ? chargedId : unchargedId);
  item.setMetaValue(CHARGES_META_KEY, count > 0 ? count : undefined);
}

function restricted(item) {
  return item.isPresetItem() || item.isUntradeable() || item.isUnbankable();
}

function locate(player, item) {
  for (const container of [player.getInventory(), player.getEquipment()]) {
    const slot = container.getItems().indexOf(item);
    if (slot >= 0 && isAmulet(item) && item.getAmount() > 0) return { container, slot, item, id: item.getId(), meta: JSON.stringify(item.getMeta()) };
  }
  return null;
}

function current(snapshot) {
  const { container, slot, item, id, meta } = snapshot;
  return container.getItems()[slot] === item && item.getId() === id && item.getAmount() === 1 && JSON.stringify(item.getMeta()) === meta;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function check({ player, item }) {
  if (!isAmulet(item)) return;
  player.sendMessage(`Your alchemist's amulet has ${charges(item).toLocaleString("en-US")} charges remaining.`);
  return true;
}

function chargeCount(player) {
  return player.getInventory().getItems().reduce((total, item) => total + (item.getId() === chemistryId && !restricted(item) ? item.getAmount() : 0), 0);
}

function addCharges(player, snapshot, wanted) {
  if (!current(snapshot)) return;
  const count = Math.min(Math.max(0, Math.floor(Number(wanted)) || 0), chargeCount(player), Math.floor((MAX_CHARGES - charges(snapshot.item)) / CHARGES_PER_AMULET));
  if (count <= 0) return;
  const inventory = player.getInventory();
  const planned = inventory.getCopiedItems();
  let remaining = count;
  for (let slot = 0; slot < planned.length && remaining > 0; slot++) {
    const item = planned[slot];
    if (item.getId() !== chemistryId || restricted(item)) continue;
    const taken = Math.min(remaining, item.getAmount());
    remaining -= taken;
    if (taken === item.getAmount()) planned[slot] = new core.Item(-1, 0);
    else item.setAmount(item.getAmount() - taken);
  }
  const total = charges(snapshot.item) + count * CHARGES_PER_AMULET;
  if (snapshot.container === inventory) setCharges(planned[snapshot.slot], total);
  inventory.setItems(planned);
  if (snapshot.container !== inventory) setCharges(snapshot.item, total);
  refresh(player);
  player.sendMessage(`You add ${count.toLocaleString("en-US")} amulet${count === 1 ? "" : "s"} of chemistry. Your alchemist's amulet now has ${total.toLocaleString("en-US")} charges.`);
}

function charge({ player, item }) {
  if (!isAmulet(item)) return;
  const snapshot = locate(player, item);
  if (!snapshot) return true;
  if (restricted(item)) {
    player.sendMessage("Preset items cannot be used for this.");
    return true;
  }
  if (MAX_CHARGES - charges(item) < CHARGES_PER_AMULET) {
    player.sendMessage("Your alchemist's amulet cannot hold any more amulets of chemistry.");
    return true;
  }
  if (chargeCount(player) === 0) {
    player.sendMessage("You need an amulet of chemistry to charge your alchemist's amulet.");
    return true;
  }
  player.setEnteredAmountAction({ acceptsZero: true, execute: count => addCharges(player, snapshot, count) });
  player.getPacketSender().sendEnterAmountPrompt("How many amulets of chemistry would you like to use?");
  return true;
}

function useChemistry(event) {
  const { usedItem, usedWithItem, player } = event;
  const amulet = isAmulet(usedItem) ? usedItem : isAmulet(usedWithItem) ? usedWithItem : null;
  const ingredient = amulet === usedItem ? usedWithItem : usedItem;
  if (!amulet || ingredient?.getId() !== chemistryId) return;
  event.handled = true;
  charge({ player, item: amulet });
}

function returnCharges(player, snapshot) {
  player.getPacketSender().sendInterfaceRemoval();
  if (!current(snapshot)) return;
  const inventory = player.getInventory();
  const preview = new core.Inventory(player).setItems(inventory.getCopiedItems());
  const count = Math.floor(charges(snapshot.item) / CHARGES_PER_AMULET);
  const noteId = core.ItemDefinition.forId(chemistryId).getNoteId();
  const returned = new core.Item(noteId, count);
  if (count > 0 && preview.getAddableAmount(returned) < count) {
    player.sendMessage("You don't have enough inventory space to uncharge your alchemist's amulet.");
    return;
  }
  if (count > 0) preview.add(returned, false);
  if (snapshot.container === inventory) setCharges(preview.getItems()[snapshot.slot], 0);
  inventory.setItems(preview.getCopiedItems());
  if (snapshot.container !== inventory) setCharges(snapshot.item, 0);
  refresh(player);
  player.sendMessage("You uncharge your alchemist's amulet.");
}

function uncharge({ player, item }) {
  if (!isAmulet(item)) return;
  const snapshot = locate(player, item);
  if (!snapshot) return true;
  if (restricted(item)) {
    player.sendMessage("Preset items cannot be used for this.");
    return true;
  }
  api.sendMultiChatboxPrompt(player, "Uncharge your alchemist's amulet? Any remaining partial charges will be lost.",
    "Uncharge the amulet.", who => returnCharges(who, snapshot),
    "Cancel.", who => who.getPacketSender().sendInterfaceRemoval());
  return true;
}

function onMix(mix) {
  const item = mix.player.getEquipment().get(core.Equipment.AMULET_SLOT);
  if (charges(item) <= 0) return;
  const productId = extraDose(mix.productId);
  if (productId == null || Math.random() >= EXTRA_DOSE_CHANCE) return;
  mix.productId = productId;
  mix.extraDose = true;
  mix.alchemistExtraDose = { ...locate(mix.player, item), productId };
}

function onMade({ player, itemId, mix }) {
  const snapshot = mix?.alchemistExtraDose;
  if (!snapshot) return;
  // League effects may supply the same product themselves and cancel the amulet's dose.
  // Consume the pending token even on cancellation so it cannot be spent a second time.
  delete mix.alchemistExtraDose;
  const suppliedDose = mix.extraDose === true;
  mix.extraDose = false;
  if (!suppliedDose || itemId !== snapshot.productId || mix.productId !== snapshot.productId || !current(snapshot)) return;
  const left = charges(snapshot.item) - 1;
  setCharges(snapshot.item, left);
  player.sendMessage(`Your alchemist's amulet helps you create an extra dose.${left === 0 ? " It has run out of charges." : ""}`);
  if (left === 0) refresh(player);
}

function purchase(event) {
  if (event.shop !== "mixology_rewards" || event.stock !== "mixology_stock_amulet") return;
  const item = new core.Item(chargedId, 1, { [CHARGES_META_KEY]: 50 });
  event.player.getInventory().add(item, false);
  event.player.getInventory().refreshItems();
  event.handled = true;
  api.emitCustomEvent("collection-log:obtain", { player: event.player, itemId: chargedId, amount: 1 });
}

function pvpGraveItems(request) {
  const worn = request.player.getEquipment().get(core.Equipment.AMULET_SLOT);
  if (!isAmulet(worn) || !request.eligible.includes(worn)) return;
  setCharges(worn, 0);
  request.items.push(worn);
}

function initialize(pluginApi, doseHelper) {
  api = pluginApi;
  core = api.core;
  extraDose = doseHelper;
  chargedId = core.CacheDefinitions.getObjId("amulet_of_chemistry_imbued_charged");
  unchargedId = core.CacheDefinitions.getObjId("amulet_of_chemistry_imbued_uncharged");
  chemistryId = core.ItemIdentifiers.AMULET_OF_CHEMISTRY;
}

module.exports = function attach(pluginApi) {
  pluginApi.onItemAction("Alchemist's amulet", { Check: check, Charge: charge, Uncharge: uncharge });
  pluginApi.onItemOnItem(useChemistry, { noted: false });
  pluginApi.onCustomEvent("herblore:mix", onMix);
  pluginApi.onCustomEvent("herblore:made", onMade);
  pluginApi.onCustomEvent("omnishop:purchase", purchase);
  pluginApi.onCustomEvent("gravestones:pvp-items", pvpGraveItems);
};
module.exports.initialize = initialize;
module.exports._test = { charges, CHARGES_META_KEY };
