const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const {
  TRIDENT_CHARGE_META_KEY,
  TRIDENT_MAX_CHARGES,
} = require("../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");

// OSRS charges: 1 death rune + 1 chaos rune + 5 fire runes, plus the
// weapon-specific resource below, added all at once per charge.
const DEATH_RUNE_ID = ItemIdentifiers.DEATH_RUNE;
const CHAOS_RUNE_ID = ItemIdentifiers.CHAOS_RUNE;
const FIRE_RUNE_ID = ItemIdentifiers.FIRE_RUNE;
const FIRE_RUNES_PER_CHARGE = 5;
const COINS_ID = ItemIdentifiers.COINS;
const ZULRAH_SCALES_ID = 12934;

const RECIPES = [
  {
    unchargedId: ItemIdentifiers.UNCHARGED_TRIDENT,
    chargedId: ItemIdentifiers.TRIDENT_OF_THE_SEAS,
    primaryResourceId: COINS_ID,
    primaryPerCharge: 10,
    primaryName: "coins",
  },
  {
    unchargedId: ItemIdentifiers.UNCHARGED_TOXIC_TRIDENT,
    chargedId: ItemIdentifiers.TRIDENT_OF_THE_SWAMP,
    primaryResourceId: ZULRAH_SCALES_ID,
    primaryPerCharge: 1,
    primaryName: "Zulrah scales",
  },
];

function recipeForTridentId(itemId) {
  return RECIPES.find((r) => r.unchargedId === itemId || r.chargedId === itemId) ?? null;
}

function isTridentId(itemId) {
  return recipeForTridentId(itemId) !== null;
}

function getCharges(item) {
  return Math.max(0, Number(item.getMetaValue(TRIDENT_CHARGE_META_KEY)) || 0);
}

function setCharges(item, value) {
  const clamped = Math.max(0, Math.min(TRIDENT_MAX_CHARGES, Math.floor(value)));
  item.setMetaValue(TRIDENT_CHARGE_META_KEY, clamped);
  return clamped;
}

function getItemContainer(player, item, preferredSlot = -1) {
  const inventory = player.getInventory();
  if (preferredSlot >= 0 && inventory.getItems()[preferredSlot] === item) {
    return inventory;
  }
  if (inventory.getItems().includes(item)) {
    return inventory;
  }
  const equipment = player.getEquipment();
  if (equipment.getItems().includes(item)) {
    return equipment;
  }
  return null;
}

function refreshTridentState(player, item, recipe, slot = -1) {
  const targetId = getCharges(item) > 0 ? recipe.chargedId : recipe.unchargedId;
  if (item.getId() !== targetId) {
    item.setId(targetId);
  }
  const container = getItemContainer(player, item, slot);
  if (container) {
    container.refreshItems();
    if (container === player.getEquipment()) {
      player.getUpdateFlag()?.flag?.(Flag.APPEARANCE);
    }
  }
}

function chargeTrident(player, tridentItem, tridentSlot, recipe) {
  const current = getCharges(tridentItem);
  if (current >= TRIDENT_MAX_CHARGES) {
    player.sendMessage("Your trident cannot hold any more charges.");
    return;
  }

  const inventory = player.getInventory();
  const affordable = Math.min(
    inventory.getAmount(DEATH_RUNE_ID),
    inventory.getAmount(CHAOS_RUNE_ID),
    Math.floor(inventory.getAmount(FIRE_RUNE_ID) / FIRE_RUNES_PER_CHARGE),
    Math.floor(inventory.getAmount(recipe.primaryResourceId) / recipe.primaryPerCharge),
    TRIDENT_MAX_CHARGES - current
  );

  if (affordable <= 0) {
    player.sendMessage(
      `You need death runes, chaos runes, fire runes and ${recipe.primaryName} to charge this.`
    );
    return;
  }

  inventory.deleteNumber(DEATH_RUNE_ID, affordable);
  inventory.deleteNumber(CHAOS_RUNE_ID, affordable);
  inventory.deleteNumber(FIRE_RUNE_ID, affordable * FIRE_RUNES_PER_CHARGE);
  inventory.deleteNumber(recipe.primaryResourceId, affordable * recipe.primaryPerCharge);

  setCharges(tridentItem, current + affordable);
  refreshTridentState(player, tridentItem, recipe, tridentSlot);
  player.sendMessage(
    `You add ${affordable} charge${affordable === 1 ? "" : "s"} to your trident. It now has ${current + affordable} charges.`
  );
}

function sendChargeStatus(player, tridentItem) {
  player.sendMessage(`Your trident has ${getCharges(tridentItem)} charges left.`);
}

module.exports = {
  name: "Trident",
  members: true,
  register(api) {
    api.onItemOnItem((event) => {
      const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot, usedItem, usedWithItem } = event;
      const tridentOnLeft = isTridentId(usedItemId);
      const tridentOnRight = isTridentId(usedWithItemId);
      if (!tridentOnLeft && !tridentOnRight) {
        return;
      }

      const tridentSlot = tridentOnLeft ? usedItemSlot : usedWithItemSlot;
      const tridentItem = tridentOnLeft ? usedItem : usedWithItem;
      const otherItemId = tridentOnLeft ? usedWithItemId : usedItemId;

      const recipe = recipeForTridentId(tridentItem.getId());
      if (!recipe || otherItemId !== recipe.primaryResourceId) {
        return;
      }

      event.handled = true;
      chargeTrident(player, tridentItem, tridentSlot, recipe);
    });

    api.onItemAction((event) => {
      if (!isTridentId(event.itemId)) {
        return;
      }
      if (event.clickType === 3 || (event.clickType === 4 && event.interfaceId === Equipment.INVENTORY_INTERFACE_ID)) {
        event.handled = true;
        sendChargeStatus(event.player, event.item);
      }
    });
  },
};
