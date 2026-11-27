"use strict";

/**
 * Reinforced goggles in the Slayer Equipment shop. Wiki, Reinforced goggles: "additional pairs
 * can be purchased after the quest from any Slayer Master for 100 coins", and the item's change
 * note adds "Player can no longer purchase reinforced goggles without meeting any requirements".
 *
 * The shop has one shared stock list, so the row cannot simply go into shops.json: a player who
 * has not finished A Porcine of Interest must not see it. A qualified player is served a copy of
 * the same shop with the row appended, which is how the skillcape sellers add their own stock
 * (Sellers.SkillCapes.js).
 */
const fs = require("fs");
const path = require("path");

const QUEST = "a_porcine_of_interest";
/** "Slayer Equipment (shop)": the one stock list every Slayer master opens. */
const BASE_SHOP_ID = 1324;
/** Past the data's own ids (max 1499) and the skillcape copies (1600 onwards). */
const COPY_SHOP_ID = 1700;
/** Wiki, Reinforced goggles: 50 in stock, 0.6 s restock, sold at 100 coins. */
const GOGGLES_STOCK = { id: 24942, amount: 50, restockTicks: 1 };

let api = null;
let core = null;

function completed(player) {
  const request = { player, key: QUEST, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** The Slayer Equipment shop with the goggles row, under its own id. */
function shopCopies() {
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "shops.json");
  const shops = JSON.parse(fs.readFileSync(file, "utf8"));
  const base = shops.find((shop) => shop.id === BASE_SHOP_ID);
  if (!base) return [];
  return [{
    ...base,
    id: COPY_SHOP_ID,
    npcInteractions: [],
    originalStock: [...(base.originalStock ?? []), GOGGLES_STOCK],
  }];
}

/** A master's own shop opens the copy for a player who finished the quest. */
function serveGogglesShop(event) {
  if (event.shopId !== BASE_SHOP_ID || !event.player || !completed(event.player)) return;
  if (core.ShopManager.open(event.player, COPY_SHOP_ID, true)) event.allow = false;
}

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function attach(pluginApi) {
  init(pluginApi);
  api.registerDefinitionSource("shops", { name: "slayer-goggles", load: shopCopies });
  api.onCanShop(serveGogglesShop);
}

module.exports = { init, attach, _test: { completed, shopCopies, serveGogglesShop, BASE_SHOP_ID, COPY_SHOP_ID, GOGGLES_STOCK } };
