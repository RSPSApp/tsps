let pluginApi;
let PrayerHandler;
const { SkullType } = require("../../src/main/typescript/elvarg/game/model/SkullType");

// OpenRune cache names: component.wornitems:deathkeep and interface.deathkeep.
const OPEN_ITEMS_KEPT_ON_DEATH_BUTTON = (387 << 16) | 5;
const ITEMS_KEPT_ON_DEATH_INTERFACE_ID = 4;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const ITEMS_KEPT_VALUE_COMPONENT = (ITEMS_KEPT_ON_DEATH_INTERFACE_ID << 16) | 18;
const ITEMS_KEPT_SETTINGS_COMPONENT = (ITEMS_KEPT_ON_DEATH_INTERFACE_ID << 16) | 12;
const DEATH_ITEMS_INVENTORY_ID = 584;
const DEATH_ITEM_STATE_INVENTORY_ID = 468;
const DEATH_INVENTORY_CAPACITY = 50;
// Clientscript 974 uses these otherwise unrelated object IDs as item-state markers.
const KEPT_ITEM_STATE = 323;
const LOST_ITEM_STATE = 1991;
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
  if (settings.skullActive && player.getSkullType() === SkullType.RED_SKULL) {
    return 0;
  }
  return (settings.skullActive ? 0 : 3) + (settings.protectItemPrayer ? 1 : 0);
}

function getItemsToKeep(player, settings) {
  const items = [];
  for (const item of [
    ...player.getInventory().getItems(),
    ...player.getEquipment().getItems(),
  ]) {
    if (
      !item ||
      item.getId() <= 0 ||
      item.getAmount() <= 0 ||
      !item.isTradeable()
    ) {
      continue;
    }
    if (pluginApi.emitShouldKeepItemOnDeath(player, item) === false) {
      continue;
    }
    items.push(item);
  }

  items.sort((a, b) => b.getDefinition().getValue() - a.getDefinition().getValue());
  const amountToKeep = getAmountToKeep(player, settings);
  return items.slice(0, amountToKeep);
}

function getDeathItems(player, toKeep) {
  const kept = new Set(toKeep);
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
    const lostOnDeath = tradeable || item.isLostOnDeath();
    items.push({
      slot: items.length,
      itemId: item.getId(),
      quantity: item.getAmount(),
    });
    states.push({
      slot: states.length,
      itemId: lostOnDeath ? LOST_ITEM_STATE : KEPT_ITEM_STATE,
      quantity: 1,
    });

    if (tradeable) {
      const value = Math.max(0, Number(item.getDefinition().getValue()) || 0);
      risk = Math.min(
        Number.MAX_SAFE_INTEGER,
        risk + value * item.getAmount()
      );
    }
  }

  return { items, states, risk };
}

function open(player, settings = getSettings(player)) {
  const toKeep = getItemsToKeep(player, settings);
  const deathItems = getDeathItems(player, toKeep);
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

module.exports = {
  name: "ItemsKeptOnDeath",
  register(api) {
    pluginApi = api;
    PrayerHandler = api.getPrayerHandler();
    api.onInterfaceActionButton(OPEN_ITEMS_KEPT_ON_DEATH_BUTTON, ({ player }) => {
      if (player.busy?.()) {
        player.getPacketSender().sendInterfaceRemoval();
      }
      previewSettings.delete(player);
      open(player);
      return true;
    });

    api.onInterfaceActionButton(ITEMS_KEPT_SETTINGS_COMPONENT, ({ player, action }) => {
      if (player.getInterfaceId?.() !== ITEMS_KEPT_ON_DEATH_INTERFACE_ID) return false;
      const settings = getSettings(player);
      if (action === 0) settings.protectItemPrayer = !settings.protectItemPrayer;
      else if (action === 1) settings.skullActive = !settings.skullActive;
      else if (action === 2) settings.playerKill = !settings.playerKill;
      else if (action === 3) settings.wildernessLevel = settings.wildernessLevel === 0 ? 21 : 0;
      else return false;
      open(player, settings);
      return true;
    });
  },
};
