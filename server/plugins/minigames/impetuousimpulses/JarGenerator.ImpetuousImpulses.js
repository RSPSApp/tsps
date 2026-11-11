"use strict";

// Wiki Jar generator, revision 15367163. Each instance stores its remaining percentage.
const CHARGES_META = "impetuous-impulses:jar-generator-charges";
const FULL_CHARGE = 100;
let core;

function init(api) { core = api.core; }
function charges(item) {
  const saved = item.getMetaValue(CHARGES_META);
  return saved == null ? FULL_CHARGE : Math.max(0, Math.min(FULL_CHARGE, Math.trunc(Number(saved)) || 0));
}
function restricted(item) {
  return item.isPresetItem?.() === true || item.getMetaValue?.(core.Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(core.Item.UNBANKABLE_META) === true;
}
function held(player, item, slot) {
  return item?.getId() === core.ItemIdentifiers.JAR_GENERATOR && item.getAmount() > 0
    && player.getInventory().getItems()[slot] === item;
}
function generate(event, id, cost) {
  const { player, item, slot } = event;
  if (!held(player, item, slot)) return;
  if (restricted(item)) { player.sendMessage("Preset items cannot be used for this."); return; }
  const left = charges(item);
  if (left < cost) { player.sendMessage("The jar generator does not have enough charge for that jar."); return; }
  const inventory = player.getInventory();
  if (left === cost) {
    // Its final output replaces the exhausted generator, including in a full inventory.
    item.setId(id);
    item.setMetaValue(CHARGES_META, undefined);
  } else {
    if (inventory.getFreeSlots() < 1) { inventory.full(); return; }
    inventory.adds(id, 1);
    item.setMetaValue(CHARGES_META, left - cost);
  }
  inventory.refreshItems();
}
function impling(event) { generate(event, core.ItemIdentifiers.IMPLING_JAR, 3); }
function butterfly(event) { generate(event, core.ItemIdentifiers.BUTTERFLY_JAR, 1); }
function check({ player, item, slot }) {
  if (held(player, item, slot)) player.sendMessage(`Your jar generator has ${charges(item)}% charge remaining.`);
}
function owned(player) {
  const containers = [player.getInventory(), player.getEquipment(),
    ...player.getBanks().filter((bank, tab) => bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX)];
  for (const container of containers) {
    const item = container.getItems().find((item) => item?.getId() === core.ItemIdentifiers.JAR_GENERATOR && item.getAmount() > 0);
    if (item) return { container, item };
  }
  return null;
}
function neverKept(event) {
  if (event.item.getId() === core.ItemIdentifiers.JAR_GENERATOR) event.keep = false;
}
function lostOnDeath(event) {
  if (event.item.getId() === core.ItemIdentifiers.JAR_GENERATOR && !event.kept && event.shouldDropItems !== false) event.handled = true;
}
function register(api) {
  init(api);
  api.onItemAction("Jar generator", { "Impling-jar": impling, "Butterfly-jar": butterfly, Check: check });
  api.onShouldKeepItemOnDeath(neverKept);
  api.onPlayerDeathItemDrop(lostOnDeath);
}
module.exports = register;
Object.assign(module.exports, { init, charges, owned, restricted, CHARGES_META, FULL_CHARGE });
