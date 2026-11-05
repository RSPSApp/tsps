"use strict";

const data = require("./Data.BarbarianAssault");
const Points = require("./Points.BarbarianAssault");
const Lobby = require("./Lobby.BarbarianAssault");

const SHOP_ID = 1427;
const SHOP_NAME = "Barbarian Assault Reward Shop";
const SHOP_STOCK_AMOUNT = 100;
const QUEEN_ITEMS = new Map(data.SHOP_STOCK.filter((entry) => entry.queen).map((entry) => [entry.id, entry]));
/** The one reward not bought with honour points (Wiki: Granite body). */
const GRANITE_BODY_ID = 10564;
const GRANITE_BODY_COST = 95000;

let api = null;

/**
 * The generated shops.json row only carries the Commander Connad binding; the
 * intentional minigame stock and prices are contributed as a plugin source, so
 * reimporting the canonical data cannot erase them.
 */
function shopSource() {
  return [{
    id: SHOP_ID,
    name: SHOP_NAME,
    currency: "HONOUR POINTS",
    originalStock: data.SHOP_STOCK.map(({ id, price }) => ({
      id,
      amount: SHOP_STOCK_AMOUNT,
      restockTicks: 1,
      price,
    })),
  }];
}

function pointsLine(player) {
  return data.ROLES
    .map((role) => `${data.ROLE_LABEL[role]} ${Points.points(player, role).toLocaleString()} (level ${Points.level(player, role)})`)
    .join(", ");
}

function checkPoints({ player }) {
  player.sendMessage(`Honour Points: ${pointsLine(player)}. Queen kills: ${Points.queenKills(player)}.`);
}

function levelPrompt(player) {
  const options = [];
  for (const role of data.ROLES) {
    const cost = Points.upgradeCost(player, role);
    const label = cost == null
      ? `${data.ROLE_LABEL[role]} level 5`
      : `${data.ROLE_LABEL[role]} level ${Points.level(player, role)} -> ${Points.level(player, role) + 1} (${cost})`;
    options.push(label, () => {
      if (Points.upgradeRole(player, role)) checkPoints({ player });
    });
  }
  options.push("Back", () => commanderTalk({ player }));
  api.sendMultiChatboxPrompt(player, `Commander Connad: ${pointsLine(player)}. Which role will you upgrade?`, ...options);
}

/** Wiki: Commander Connad sells the granite body for 95,000 coins, once the Queen is defeated. */
function buyGraniteBody({ player }) {
  if (!Points.queenKilled(player)) {
    player.sendMessage("You need to defeat the Penance Queen before buying a granite body.");
    return;
  }
  const inventory = player.getInventory();
  if (inventory.contains(GRANITE_BODY_ID)) {
    player.sendMessage("You already have a granite body.");
    return;
  }
  const coins = api.core.ItemIdentifiers.COINS;
  if (inventory.getAmount(coins) < GRANITE_BODY_COST) {
    player.sendMessage(`You need ${GRANITE_BODY_COST.toLocaleString("en-US")} coins for a granite body.`);
    return;
  }
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You need a free inventory slot for the granite body.");
    return;
  }
  inventory.delete(coins, GRANITE_BODY_COST);
  inventory.adds(GRANITE_BODY_ID, 1);
  api.emitCustomEvent?.("barbarian-assault:granite-body-bought", { player });
  player.sendMessage("Commander Connad sells you a granite body.");
}

function commanderTalk({ player }) {
  if (Lobby.inQueue(player)) {
    Lobby.status(player);
  }
  api.sendMultiChatboxPrompt(
    player,
    "Commander Connad: what do you need, soldier?",
    "Choose a role", () => Lobby.rolePrompt(player),
    "Level up a role", () => levelPrompt(player),
    "Check Honour Points", () => {
      checkPoints({ player });
      commanderTalk({ player });
    },
    "Buy a granite body (95,000 coins)", () => buyGraniteBody({ player }),
    "High gamble", () => Points.highGamblePrompt(player),
    "Cancel", () => {},
  );
}

/** Queen-kill gate for the armour pieces the Wiki marks with a Queen requirement. */
function buyLimit(event) {
  if (!event || event.shopId !== SHOP_ID) return;
  const entry = QUEEN_ITEMS.get(event.itemId);
  if (!entry) return;
  if (Points.queenKilled(event.player)) return;
  event.limit = 0;
  event.message = `You need to defeat the Penance Queen before buying the ${event.itemId === 10551 ? "Fighter torso" : "Penance armour"}.`;
}

function purchase(event) {
  if (!event || event.shopId !== SHOP_ID) return;
  if (event.player && !event.player.isPlayerBot?.()) {
    event.player.sendMessage(`Honour Points: ${pointsLine(event.player)}.`);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  pluginApi.registerDefinitionSource?.("shops", { name: "barbarian-assault", load: shopSource });
  Lobby.setLevelPromptHandler((player) => levelPrompt(player));
  pluginApi.onCustomEvent?.("shop:buy-limit", buyLimit);
  pluginApi.onCustomEvent?.("shop:purchase", purchase);
}

module.exports = {
  SHOP_ID, GRANITE_BODY_ID, GRANITE_BODY_COST,
  commanderTalk, levelPrompt, checkPoints, buyLimit, purchase, buyGraniteBody, attach, shopSource,
};
