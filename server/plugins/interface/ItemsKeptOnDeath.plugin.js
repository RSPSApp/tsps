let PrayerHandler;
let core;
let pluginApi;

// OpenRune cache names: component.wornitems:deathkeep and interface.deathkeep.
const OPEN_ITEMS_KEPT_ON_DEATH_BUTTON = (387 << 16) | 5;
const ITEMS_KEPT_ON_DEATH_INTERFACE_ID = 4;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const ITEMS_KEPT_VALUE_COMPONENT = (ITEMS_KEPT_ON_DEATH_INTERFACE_ID << 16) | 18;
const ITEMS_KEPT_SETTINGS_COMPONENT = (ITEMS_KEPT_ON_DEATH_INTERFACE_ID << 16) | 12;
const DEATH_ITEMS_INVENTORY_ID = 584;
const DEATH_ITEM_STATE_INVENTORY_ID = 468;
const DEATH_INVENTORY_CAPACITY = 50;
// Clientscript 974 uses these otherwise unrelated object IDs as item-state markers: kept;
// to the gravestone, with the item's grave fee plus one as the count; lost to the killer, or
// dropped where the player dies; and deleted (any other marker).
const KEPT_ITEM_STATE = 323;
const GRAVE_ITEM_STATE = 367;
const LOST_ITEM_STATE = 1991;
const DELETED_ITEM_STATE = 368;
// Wiki: Items Kept on Death: the looting bag "disappears completely"; its contents drop.
const LOOTING_BAG = "Looting bag";
// Priced at face value in the guide risk value.
const CURRENCY = new Set(["Coins", "Platinum token"]);
const previewSettings = new WeakMap();

function getSettings(player) {
  let settings = previewSettings.get(player);
  if (!settings) {
    settings = {
      skullActive: player.getSkullTimer() > 0,
      protectItemPrayer: PrayerHandler.isActivated(player, PrayerHandler.PROTECT_ITEM),
      playerKill: false,
      wildernessLevel: 0,
    };
    previewSettings.set(player, settings);
  }
  return settings;
}

function getAmountToKeep(player, settings) {
  if (settings.skullActive && player.getSkullType() === core.SkullType.RED_SKULL) {
    return 0;
  }
  return (settings.skullActive ? 0 : 3) + (settings.protectItemPrayer ? 1 : 0);
}

/**
 * The death's own choice (PlayerDeathTask.getKeptItems), for the count the toggles give. An
 * ornamented item the death protects beyond the count is listed with the other items, marked
 * kept; the PvP and Wilderness toggles show a death that does not protect it.
 */
function getKeptItems(player, settings) {
  const cosmetics = !settings.playerKill && settings.wildernessLevel === 0
    && core.PlayerDeathTask.protectsCosmetics(player, null);
  return core.PlayerDeathTask.getKeptItems(player, getAmountToKeep(player, settings), cosmetics);
}

/** One item's grave fee: the client multiplies the marker's count by the stack size. */
function graveFee(player, item) {
  const query = { player, items: [{ id: item.getId(), amount: 1 }], fee: 0 };
  pluginApi.emitCustomEvent("gravestones:fee", query);
  return Math.max(0, Number(query.fee) || 0);
}

/** Destroyed on every unsafe death (NeverKeptOnDeath answers `items:never-kept-on-death`). */
function neverKept(item) {
  const query = { item, neverKept: false };
  pluginApi.emitCustomEvent("items:never-kept-on-death", query);
  return query.neverKept === true;
}

function itemState(player, item, lostOnDeath, makesGrave) {
  if (item.getDefinition().getName() === LOOTING_BAG || neverKept(item)) return { itemId: DELETED_ITEM_STATE, quantity: 1 };
  if (!lostOnDeath) return { itemId: KEPT_ITEM_STATE, quantity: 1 };
  if (makesGrave) return { itemId: GRAVE_ITEM_STATE, quantity: 1 + graveFee(player, item) };
  return { itemId: LOST_ITEM_STATE, quantity: 1 };
}

/**
 * What one lost item adds to the guide risk value: coins and platinum tokens at their face value,
 * any other item at the price a death ranks it by (Grand Exchange price, else its alchemy value),
 * untradeables included. Ours: the Wiki gives no formula for untradeables.
 */
function riskValue(item) {
  const definition = item.getDefinition();
  const value = CURRENCY.has(definition.getName())
    ? definition.getValue()
    : core.PlayerDeathTask.keepValue(item);
  return Math.max(0, Number(value) || 0);
}

/**
 * Perdu's repair cost (or the mangled fee) for an unprotected item the previewed death breaks, or
 * null: only a PvP death in the Wilderness breaks them (BrokenItems, `broken-items:death-cost`).
 * Wiki, Items Kept on Death (Interface), "Guide risk value": "Repair costs if the item becomes
 * broken and must be repaired via Perdu". It counts whether the broken item stays with the player
 * or is lost.
 */
function breakCost(item, settings) {
  if (!settings.playerKill || settings.wildernessLevel <= 0) return null;
  const query = { item, wildernessLevel: settings.wildernessLevel, cost: null };
  pluginApi.emitCustomEvent("broken-items:death-cost", query);
  return query.cost == null ? null : Math.max(0, Number(query.cost) || 0);
}

function getDeathItems(player, toKeep, settings, cosmetic = []) {
  const kept = new Set(toKeep);
  const protectedItems = new Set(cosmetic);
  const grave = { player, playerKill: settings.playerKill, makesGrave: false };
  pluginApi.emitCustomEvent("gravestones:makes-grave", grave);
  const items = [];
  const states = [];
  let risk = 0;

  for (const item of [
    ...player.getInventory().getItems(),
    ...player.getEquipment().getItems(),
  ]) {
    if (!item || item.getId() <= 0 || item.getAmount() <= 0 || kept.has(item)) {
      continue;
    }

    const tradeable = item.isTradeable();
    const lostOnDeath = !protectedItems.has(item) && (tradeable || item.isLostOnDeath() || grave.makesGrave);
    items.push({
      slot: items.length,
      itemId: item.getId(),
      quantity: item.getAmount(),
    });
    const state = itemState(player, item, lostOnDeath, grave.makesGrave);
    states.push({ slot: states.length, ...state });

    const broken = breakCost(item, settings);
    if (broken != null) {
      risk = Math.min(Number.MAX_SAFE_INTEGER, risk + broken * item.getAmount());
    } else if (state.itemId !== KEPT_ITEM_STATE) {
      risk = Math.min(Number.MAX_SAFE_INTEGER, risk + riskValue(item) * item.getAmount());
    }
  }

  return { items, states, risk };
}

function open(player, settings = getSettings(player)) {
  const { ranked, always, cosmetic } = getKeptItems(player, settings);
  const toKeep = [...ranked, ...always];
  const deathItems = getDeathItems(player, toKeep, settings, cosmetic);
  const keptItemIds = toKeep.map((item) => item.getId());
  while (keptItemIds.length < 4) keptItemIds.push(-1);
  player.setInterfaceId(ITEMS_KEPT_ON_DEATH_INTERFACE_ID);
  player
    .getPacketSender()
    .sendSubInterface(MAIN_MODAL_TARGET_UID, ITEMS_KEPT_ON_DEATH_INTERFACE_ID, 0)
    .sendInterfaceScript(
      972,
      [
        settings.skullActive ? 1 : 0,
        settings.protectItemPrayer ? 1 : 0,
        settings.wildernessLevel,
        settings.playerKill ? 1 : 0,
        "",
        toKeep.length,
        ...keptItemIds,
      ],
      undefined,
      undefined,
      {
        [DEATH_ITEMS_INVENTORY_ID]: {
          capacity: DEATH_INVENTORY_CAPACITY,
          slots: deathItems.items,
        },
        [DEATH_ITEM_STATE_INVENTORY_ID]: {
          capacity: DEATH_INVENTORY_CAPACITY,
          slots: deathItems.states,
        },
      },
    )
    .sendInterfaceFlagsRange(ITEMS_KEPT_SETTINGS_COMPONENT, 0, 3, 1)
    .sendString(
      `Guide risk value:<br><col=ffffff>${deathItems.risk.toLocaleString()}</col>`,
      ITEMS_KEPT_VALUE_COMPONENT,
    );
}

function openFromWornItems({ player }) {
  if (player.busy?.()) {
    player.getPacketSender().sendInterfaceRemoval();
  }
  previewSettings.delete(player);
  open(player);
  return true;
}

function toggleSetting({ player, action }) {
  if (player.getInterfaceId?.() !== ITEMS_KEPT_ON_DEATH_INTERFACE_ID) return false;
  const settings = getSettings(player);
  if (action === 0) settings.protectItemPrayer = !settings.protectItemPrayer;
  else if (action === 1) settings.skullActive = !settings.skullActive;
  else if (action === 2) settings.playerKill = !settings.playerKill;
  else if (action === 3) settings.wildernessLevel = settings.wildernessLevel === 0 ? 21 : 0;
  else return false;
  open(player, settings);
  return true;
}

module.exports = {
  name: "ItemsKeptOnDeath",
  description: "Items Kept on Death screen showing what you would keep or lose, with skull, Protect Item, PvP and Wilderness level toggles.",
  register(api) {
    core = api.core;
    pluginApi = api;
    PrayerHandler = api.getPrayerHandler();
    api.onInterfaceActionButton(OPEN_ITEMS_KEPT_ON_DEATH_BUTTON, openFromWornItems);
    api.onInterfaceActionButton(ITEMS_KEPT_SETTINGS_COMPONENT, toggleSetting);
  },
};
