/**
 * Capes that become another item while worn, as live OSRS swaps them (rsprox captures: wearing
 * `skillcape_max` puts `skillcape_max_worn` in the cape slot, and removing it gives the inventory
 * cape back). The worn ids carry the equipment-tab options; the Agility cape does the same.
 */
const Capes = require("./Common.SkillCapes");

const WORN_BY_ITEM = new Map();
const ITEM_BY_WORN = new Map();

function buildPairs() {
  WORN_BY_ITEM.clear();
  ITEM_BY_WORN.clear();
  const pairs = [[Capes.MAX.cape, Capes.MAX.worn]];
  for (const cape of Capes.CAPES) {
    if (cape.worn !== null) pairs.push([cape.cape, cape.worn]);
    if (cape.trimmedWorn !== null) pairs.push([cape.trimmed, cape.trimmedWorn]);
  }
  for (const [item, worn] of pairs) {
    WORN_BY_ITEM.set(item, worn);
    ITEM_BY_WORN.set(worn, item);
  }
}

/** Swaps ids in place; true when anything changed. */
function swapIn(items, map) {
  let changed = false;
  for (const item of items) {
    const id = item?.getId?.() ?? -1;
    if (map.has(id)) {
      item.setId(map.get(id));
      changed = true;
    }
  }
  return changed;
}

function normalise({ player }) {
  if (!player) return;
  const { Equipment } = Capes.core;
  const cape = player.getEquipment().getItems()[Equipment.CAPE_SLOT];
  if (cape && WORN_BY_ITEM.has(cape.getId())) {
    cape.setId(WORN_BY_ITEM.get(cape.getId()));
    player.getEquipment().refreshItems();
  }
  if (swapIn(player.getInventory().getItems(), ITEM_BY_WORN)) player.getInventory().refreshItems();
}

/**
 * A worn id never reaches the bank: "Deposit worn items" (and a worn slot's Bank op) banks the
 * cape as its inventory item, as live does, so it fills the cape's placeholder or joins its tab
 * instead of landing as a separate "new" cape. Runs before the bank picks the tab and copies it.
 */
function bankAsItem({ item }) {
  const id = item?.getId?.() ?? -1;
  if (ITEM_BY_WORN.has(id)) item.setId(ITEM_BY_WORN.get(id));
}

function normaliseOnLogin({ player }) {
  normalise({ player });
  for (const bank of player.getBanks()) {
    if (bank) swapIn(bank.getItems(), ITEM_BY_WORN);
  }
}

module.exports = function attachWornVariants(api) {
  buildPairs();
  api.onCustomEvent("equipment:changed", normalise);
  api.onPlayerLogin(normaliseOnLogin);
  api.onCanBankItem(bankAsItem);
};

module.exports._test = { WORN_BY_ITEM, ITEM_BY_WORN, normalise, bankAsItem };
