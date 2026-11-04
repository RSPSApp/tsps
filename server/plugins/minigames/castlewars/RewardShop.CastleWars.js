"use strict";

/** The cache owns the ticket gear, plaudit crate, prices and refunds. Match awards and
 * opening a supply crate are separate content; this unit owns the saved wallet. */
const SHOP = "cw_shop_data";
const PLAUDITS_CURRENCY = "omnishop_currency_cw_plaudits";
const PLAUDITS_ATTRIBUTE = "castlewars:plaudits";
const PLAUDITS_VARP = "castlewars_plaudits";
const MAX_PLAUDITS = 0x7fffffff;
let api;

function bind(pluginApi) { api = pluginApi; }

function balance(player) {
  const value = player.getAttribute(PLAUDITS_ATTRIBUTE);
  return Number.isInteger(value) && value >= 0 && value <= MAX_PLAUDITS ? value : 0;
}

function setBalance(player, value) {
  const next = Number.isInteger(value) && value >= 0 && value <= MAX_PLAUDITS ? value : 0;
  player.setAttribute(PLAUDITS_ATTRIBUTE, next);
  player.getPacketSender().sendConfig(api.core.CacheDefinitions.getVarpId(PLAUDITS_VARP), next);
}

function sync({ player }) { setBalance(player, balance(player)); }

function open({ player }) {
  sync({ player });
  api.emitCustomEvent("omnishop:open", { player, shop: SHOP, handled: false });
}

function currency(request) {
  if (request.shop !== SHOP || api.core.CacheDefinitions.getDbRowName(request.currency) !== PLAUDITS_CURRENCY) return;
  request.balance = balance(request.player);
  request.set = (value) => setBalance(request.player, value);
}

/** TSPS customization (#2065): ordinary members games also earn one plaudit per ticket. */
function prepareReward(request) {
  if (!api.core.WorldDefinition.isMembersWorld()) return;
  const current = balance(request.player);
  request.allow = Number.isSafeInteger(request.amount) && request.amount > 0 && request.amount <= MAX_PLAUDITS - current;
  if (request.allow) request.commit = (delivered) => setBalance(request.player, current + delivered);
}

function canBuy(request) {
  if (request.shop !== SHOP || api.core.WorldDefinition.isMembersWorld()) return;
  if (!api.core.CacheDefinitions.getItem(request.itemId)?.isMembers) return;
  request.cancel = true;
  request.player.sendMessage("You need to be on a members' world to buy this item.");
}

module.exports = function attachRewardShop(pluginApi) {
  bind(pluginApi);
  pluginApi.persistAttribute(PLAUDITS_ATTRIBUTE, 0);
  pluginApi.onPlayerLogin(sync);
  pluginApi.onCustomEvent("omnishop:currency", currency);
  pluginApi.onCustomEvent("castlewars:reward-plaudits", prepareReward);
  pluginApi.onCustomEvent("omnishop:can-buy", canBuy);
};

module.exports.open = open;
