/** Weapon poison and reusable cleaning cloth: https://oldschool.runescape.wiki/w/Weapon_poison. */
const families = require('./data/weapon-poison.json').families;
let core;
const byClean = new Map();
const byPoisoned = new Map();

function initialize(apiCore) {
  core = apiCore;
  byClean.clear();
  byPoisoned.clear();
  for (const { items } of families) {
    byClean.set(items[0], items);
    for (const id of items.slice(1)) byPoisoned.set(id, items[0]);
  }
}

function useCoating(event) {
  const I = core.ItemIdentifiers;
  const potions = [I.WEAPON_POISON, I.WEAPON_POISON_PLUS_, I.WEAPON_POISON_PLUS_PLUS_];
  const left = potions.includes(event.usedItemId) || event.usedItemId === I.CLEANING_CLOTH;
  const reagent = left ? event.usedItem : event.usedWithItem;
  const weapon = left ? event.usedWithItem : event.usedItem;
  const reagentSlot = left ? event.usedItemSlot : event.usedWithItemSlot;
  const weaponSlot = left ? event.usedWithItemSlot : event.usedItemSlot;
  const clean = reagent?.getId() === I.CLEANING_CLOTH;
  const tier = potions.indexOf(reagent?.getId());
  const result = clean ? byPoisoned.get(weapon?.getId()) : byClean.get(weapon?.getId())?.[tier + 1];
  if ((!clean && tier < 0) || result === undefined) return;
  const inventory = event.player.getInventory();
  if (inventory.getItems()[reagentSlot] !== reagent || inventory.getItems()[weaponSlot] !== weapon ||
    reagentSlot === weaponSlot || reagent.getAmount() !== 1 || !Number.isInteger(weapon.getAmount()) || weapon.getAmount() < 1) return;
  const stackable = weapon.getDefinition().isStackable();
  if (!stackable && weapon.getAmount() !== 1) return;
  event.handled = true;
  if (!clean && (reagent.isPresetItem() || reagent.isUntradeable() || reagent.isUnbankable())) {
    event.player.sendMessage('You cannot use restricted poison to coat equipment.');
    return;
  }
  const amount = clean ? weapon.getAmount() : Math.min(weapon.getAmount(), stackable ? 5 : 1);
  const output = new core.Item(result, amount, weapon.getMeta());
  const matching = stackable && inventory.getItems().some(item => item.getId() === result &&
    JSON.stringify(item.getMeta()) === JSON.stringify(output.getMeta()));
  if ((amount < weapon.getAmount() || matching) && inventory.getAddableAmount(output) < amount) {
    event.player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  if (amount === weapon.getAmount() && !matching) weapon.setId(result);
  else {
    inventory.deleteAtSlot(weaponSlot, amount, false);
    inventory.add(output, false);
  }
  // The emptied vial occupies the original potion slot; a cleaning cloth is reusable.
  if (!clean) reagent.setId(I.VIAL);
  inventory.refreshItems();
  event.player.sendMessage(clean ? 'You wipe the poison off your weapon.' : 'You apply poison to your weapon.');
}

module.exports = {
  name: 'WeaponPoison',
  members: true,
  register(api) {
    api.onServerStartup(initialize.bind(null, api.core));
    api.onItemOnItem(useCoating, { noted: false });
  },
};
