/**
 * Coin pouches from pickpocketing (Wiki: Coin pouch): left-click opens the whole stack, right-click
 * opens one. Each kind holds the coins its target's pouch is listed with in pickpocketing.json.
 */
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { pouchCoins, POUCH_COINS } = require("./Pickpocket.Thieving");

function open(player, pouchId, count) {
  if (!POUCH_COINS.has(pouchId) || count <= 0) return;
  let coins = 0;
  for (let i = 0; i < count; i++) coins += pouchCoins(pouchId);
  player.getInventory().delete(pouchId, count);
  player.getInventory().adds(ItemIdentifiers.COINS, coins);
  player.sendMessage(count === 1 ? `You open the pouch and find ${coins} coins.` : `You open all of the pouches and find ${coins} coins.`);
}

function openAll(event) {
  open(event.player, event.itemId, event.player.getInventory().getAmount(event.itemId));
  event.handled = true;
}

function openOne(event) {
  open(event.player, event.itemId, 1);
  event.handled = true;
}

function register(api) {
  api.onItemAction("Coin pouch", { "Open-all": openAll, Open: openOne });
}

module.exports = { register, _test: { open } };
