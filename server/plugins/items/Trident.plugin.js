// OSRS Wiki: https://oldschool.runescape.wiki/w/Trident_of_the_seas
// and https://oldschool.runescape.wiki/w/Trident_of_the_Swamp
const TRIDENT_CHARGE_META_KEY = "trident-charges";
const TRIDENT_MAX_CHARGES = 2500;
let core = null;
let ItemIdentifiers = null;
let DEATH_RUNE_ID = 0;
let CHAOS_RUNE_ID = 0;
let FIRE_RUNE_ID = 0;
const FIRE_RUNES_PER_CHARGE = 5;
let COINS_ID = 0;
let ZULRAH_SCALES_ID = 0;
let RECIPES = [];

function initialize(api) {
  core = api.core;
  ItemIdentifiers = core.ItemIdentifiers;
  DEATH_RUNE_ID = ItemIdentifiers.DEATH_RUNE;
  CHAOS_RUNE_ID = ItemIdentifiers.CHAOS_RUNE;
  FIRE_RUNE_ID = ItemIdentifiers.FIRE_RUNE;
  COINS_ID = ItemIdentifiers.COINS;
  ZULRAH_SCALES_ID = ItemIdentifiers.ZULRAHS_SCALES;
  RECIPES = [
    {
      unchargedId: ItemIdentifiers.UNCHARGED_TRIDENT,
      chargedId: ItemIdentifiers.TRIDENT_OF_THE_SEAS,
      primaryResourceId: COINS_ID,
      primaryPerCharge: 10,
      primaryName: "coins",
      refundResources: [
        [DEATH_RUNE_ID, 1],
        [CHAOS_RUNE_ID, 1],
        [FIRE_RUNE_ID, FIRE_RUNES_PER_CHARGE],
      ],
    },
    {
      unchargedId: ItemIdentifiers.UNCHARGED_TOXIC_TRIDENT,
      chargedId: ItemIdentifiers.TRIDENT_OF_THE_SWAMP,
      primaryResourceId: ZULRAH_SCALES_ID,
      primaryPerCharge: 1,
      primaryName: "Zulrah scales",
      refundResources: [
        [DEATH_RUNE_ID, 1],
        [CHAOS_RUNE_ID, 1],
        [FIRE_RUNE_ID, FIRE_RUNES_PER_CHARGE],
        [ZULRAH_SCALES_ID, 1],
      ],
    },
  ];
}

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
  return true;
}

function sendChargeStatus({ player, item: tridentItem }) {
  player.sendMessage(`Your trident has ${getCharges(tridentItem)} charges left.`);
  return true;
}

function chargeOption({ player, item, slot }) {
  const recipe = recipeForTridentId(item?.getId?.());
  if (!recipe) return false;
  return chargeTrident(player, item, slot, recipe) !== false;
}

function chargeWithResources(event) {
  const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot, usedItem, usedWithItem } = event;
  const tridentOnLeft = isTridentId(usedItemId);
  const tridentOnRight = isTridentId(usedWithItemId);
  if (!tridentOnLeft && !tridentOnRight) return;

  const tridentItem = tridentOnLeft ? usedItem : usedWithItem;
  const tridentSlot = tridentOnLeft ? usedItemSlot : usedWithItemSlot;
  const otherItemId = tridentOnLeft ? usedWithItemId : usedItemId;
  const recipe = recipeForTridentId(tridentItem.getId());
  if (!recipe || ![DEATH_RUNE_ID, CHAOS_RUNE_ID, FIRE_RUNE_ID, recipe.primaryResourceId].includes(otherItemId)) {
    return;
  }

  event.handled = true;
  chargeTrident(player, tridentItem, tridentSlot, recipe);
}

function unchargeTrident({ player, item }) {
  const recipe = recipeForTridentId(item?.getId?.());
  if (!recipe || item.getId() !== recipe.chargedId) return false;
  const current = getCharges(item);
  if (current <= 0) {
    player.sendMessage("Your trident has no charges to remove.");
    return true;
  }

  const inventory = player.getInventory();
  const neededSlots = recipe.refundResources.reduce(
    (slots, [resourceId]) => slots + (inventory.contains(resourceId) ? 0 : 1),
    0
  );
  if (inventory.getFreeSlots() < neededSlots) {
    player.sendMessage("Your inventory is too full to uncharge your trident.");
    return true;
  }

  for (const [resourceId, amountPerCharge] of recipe.refundResources) {
    inventory.addItem(new core.Item(resourceId, current * amountPerCharge));
  }
  setCharges(item, 0);
  refreshTridentState(player, item, recipe);
  player.sendMessage(
    recipe.primaryResourceId === ZULRAH_SCALES_ID
      ? "You uncharge your trident and regain its runes and Zulrah scales."
      : "You uncharge your trident and regain its runes. The coins are not refunded."
  );
  return true;
}

module.exports = {
  name: "Trident",
  members: true,
  _test: {
    get RECIPES() { return RECIPES; },
    get TRIDENT_CHARGE_META_KEY() { return TRIDENT_CHARGE_META_KEY; },
    get TRIDENT_MAX_CHARGES() { return TRIDENT_MAX_CHARGES; },
    recipeForTridentId,
    getCharges,
    setCharges,
    chargeTrident,
    chargeWithResources,
    unchargeTrident,
  },
  register(api) {
    initialize(api);
    api.onItemOnItem(chargeWithResources, { noted: false });
    api.onItemAction("Trident of the Seas", {
      Check: sendChargeStatus,
      Charge: chargeOption,
      Uncharge: unchargeTrident,
    });
    api.onItemAction("Uncharged trident", { Charge: chargeOption });
    api.onItemAction("Trident of the Swamp", {
      Check: sendChargeStatus,
      Charge: chargeOption,
      Uncharge: unchargeTrident,
    });
    api.onItemAction("Uncharged toxic trident", { Charge: chargeOption });
  },
};
