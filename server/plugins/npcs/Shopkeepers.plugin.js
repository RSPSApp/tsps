const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const CLICK_FIELDS = ["firstClick", "secondClick", "thirdClick", "fourthClick"];

const ITEM_CURRENCY_ALIASES = {
  [ItemIdentifiers.AGILITY_ARENA_TICKET]: ["Agility arena ticket (discontinued)"],
  [ItemIdentifiers.ARCHAIC_EMBLEM_TIER_1_]: ["Archaic emblem"],
  [ItemIdentifiers.ECTO_TOKEN]: ["ecto-tokens"],
};

const ITEM_CURRENCIES = [
  ItemIdentifiers.ABYSSAL_PEARLS,
  ItemIdentifiers.AGILITY_ARENA_TICKET,
  ItemIdentifiers.ARCHAIC_EMBLEM_TIER_1_,
  ItemIdentifiers.ARCHERY_TICKET,
  ItemIdentifiers.BRIMHAVEN_VOUCHER,
  ItemIdentifiers.CASTLE_WARS_TICKET,
  ItemIdentifiers.ECTO_TOKEN,
  ItemIdentifiers.GOLDEN_NUGGET,
  ItemIdentifiers.HALLOWED_MARK,
  ItemIdentifiers.MARK_OF_GRACE,
  ItemIdentifiers.MERMAIDS_TEAR,
  ItemIdentifiers.MOLCH_PEARL,
  ItemIdentifiers.PIECES_OF_EIGHT,
  ItemIdentifiers.SPIRIT_FLAKES,
  ItemIdentifiers.STARDUST,
  ItemIdentifiers.TERMITES,
  ItemIdentifiers.TOKKUL,
  ItemIdentifiers.TRADING_STICKS,
  ItemIdentifiers.UNIDENTIFIED_MINERALS,
];

const POINT_CURRENCIES = [
  "Deadman Points",
  "event points",
  "Foundry Reputation",
  "Honour points",
  "League Points",
  "NMZ",
  "Speedrun Points",
  "Tithe",
  "Volcanic Mine points",
  "Zeal Tokens",
];

function registerPointCurrency(api, name, aliases = []) {
  const attribute = `shopCurrency:${name}`;
  api.persistAttribute(attribute);
  const amount = (player) => {
    const value = Number(player?.getAttribute?.(attribute));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };
  const handler = {
    name,
    amount,
    add: (player, value) => player?.setAttribute?.(attribute, amount(player) + Math.max(0, Math.floor(value))),
    remove: (player, value) => player?.setAttribute?.(attribute, Math.max(0, amount(player) - Math.floor(value))),
  };
  for (const key of [name, ...aliases]) {
    if (typeof key === "string" && key.trim()) {
      api.registerShopCurrency(key.trim().toUpperCase(), handler);
    }
  }
  return handler;
}

function shopkeepers() {
  const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "shops.json");
  const shops = JSON.parse(fs.readFileSync(file, "utf8"));
  const bindings = new Map();

  for (const shop of shops) {
    for (const trader of shop?.npcInteractions ?? []) {
      const slot = Number(trader?.optionSlot);
      if (!Number.isInteger(slot) || slot < 1 || slot > CLICK_FIELDS.length) continue;
      for (const npcId of trader?.npcIds ?? []) {
        if (!Number.isInteger(npcId) || npcId < 0) continue;
        const key = `${npcId}:${slot}`;
        const previous = bindings.get(key);
        bindings.set(key, previous === undefined ? shop.id : previous === shop.id ? previous : null);
      }
    }
  }
  return bindings;
}

module.exports = {
  name: "Shopkeepers",
  register(api) {
    for (const itemId of ITEM_CURRENCIES) {
      api.registerItemShopCurrency(itemId, {
        aliases: ITEM_CURRENCY_ALIASES[itemId],
      });
    }
    for (const name of POINT_CURRENCIES) {
      registerPointCurrency(api, name);
    }
    for (const [key, shopId] of shopkeepers()) {
      if (shopId === null) continue;
      const [npcId, slot] = key.split(":").map(Number);
      api.registerNpcInteraction(npcId, { [CLICK_FIELDS[slot - 1]]: { shopId } });
    }
  },
  registerPointCurrency,
  ITEM_CURRENCIES,
  ITEM_CURRENCY_ALIASES,
  POINT_CURRENCIES,
};
