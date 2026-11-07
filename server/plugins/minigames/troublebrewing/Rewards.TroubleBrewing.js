"use strict";

// Wiki: pieces of eight have been account currency since 23 May 2024.
// rsprox 227/01849: round award -> brew_pieces; Honest Jimmy op3 opens brew_shop_data,
// then a blue tricorn purchase debits 500 from that same varp (520 -> 20).
const Common = require("./Common.TroubleBrewing");
const SHOP = "brew_shop_data";
const CURRENCY = "omnishop_currency_brew_pieces";
const BALANCE_VARP = "brew_pieces";
const LEGACY_SHOP_ID = 1448;
const MAX_WIRE_BALANCE = 0x7fffffff;

function balance(player) {
  const value = Number(player.getAttribute(Common.PIECES_ATTRIBUTE) ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sync({ player }) {
  // Retain larger legacy saved balances: only the client varp has a signed-int limit.
  player.getPacketSender().sendConfig(Common.core.CacheDefinitions.getVarpId(BALANCE_VARP),
    Math.min(MAX_WIRE_BALANCE, balance(player)));
}

function setBalance(player, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Invalid pieces of eight balance");
  player.setAttribute(Common.PIECES_ATTRIBUTE, value);
  sync({ player });
}

function currency(request) {
  if (request.shop !== SHOP || Common.core.CacheDefinitions.getDbRowName(request.currency) !== CURRENCY) return;
  request.balance = balance(request.player);
  request.set = (value) => setBalance(request.player, value);
}

function open({ player }) {
  sync({ player });
  Common.api.emitCustomEvent("omnishop:open", { player, shop: SHOP, handled: false });
}

// Dialogue open_shop steps and other callers of the existing generated definition
// must reach the same wallet and cache prices as the named Trade action.
function canShop(event) {
  if (event.shopId !== LEGACY_SHOP_ID) return;
  event.allow = false;
  open(event);
}

function restricted(item) {
  return item.isPresetItem() || item.getMetaValue(Common.core.Item.UNTRADEABLE_META) === true
    || item.getMetaValue(Common.core.Item.UNBANKABLE_META) === true;
}

function count({ player, item, itemId, slot }) {
  if (itemId !== Common.core.ItemIdentifiers.PIECES_OF_EIGHT) return false;
  const inventory = player.getInventory();
  // Native item actions validate the slot too; keep conversion tied to that exact stack.
  if (inventory.getItems()[slot] !== item || item.getId() !== itemId || item.getAmount() <= 0) return;
  if (restricted(item)) {
    player.sendMessage("Preset items cannot be used for this.");
    return;
  }
  const amount = item.getAmount();
  const total = balance(player) + amount;
  if (!Number.isSafeInteger(total)) {
    player.sendMessage("You cannot count any more pieces of eight.");
    return;
  }
  inventory.deleteAtSlot(slot, amount);
  setBalance(player, total);
  player.sendMessage(`You count ${amount.toLocaleString("en-US")} pieces of eight. You now have ${total.toLocaleString("en-US")}.`);
  Common.api.emitCustomEvent("persistence:save", { player, reason: "trouble-brewing:count" });
}

module.exports = function attachRewards(api) {
  api.onPlayerLogin(sync);
  api.onNpcInteraction("Honest Jimmy", { Trade: open });
  api.onCanShop(canShop);
  api.onCustomEvent("omnishop:currency", currency);
  api.onCustomEvent("trouble-brewing:completed", sync);
  api.onItemAction("Pieces of eight", { Count: count });
};
