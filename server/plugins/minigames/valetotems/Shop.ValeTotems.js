"use strict";

/**
 * Ranulph's Vale Research Exchange: the cache omnishop (DB row ent_totems_shop, its ironman
 * version ent_totems_shop_ironman), paid for in Vale Research Points (varp
 * ent_totems_research_points). The Omnishop plugin runs the interface; this unit opens it and
 * answers its currency and descriptions.
 *
 * RSProx 20261109T224258-5ab63b4 (rev 242), ticks 766-787: Trade (op3 of Ranulph's completed
 * form, ent_totems_intro_ranulph_2op) opens the shop directly with omnishop_main_init [5458].
 * The info panel shows each item's examine ("A spool for holding many bow strings. ...", "A
 * crafty looking knife.", "Makes you feel at one with nature.", "A branch from an ent."); with
 * too few points: "You don't have enough Vale Research Points.". The dialogue's "open_shop"
 * step (npc-dialogues.json) opens the same shop.
 *
 * Ours: the ironman row for every ironman mode (no ironman capture).
 */
const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");

const SHOP = "ent_totems_shop";
const IRONMAN_SHOP = "ent_totems_shop_ironman";
const CURRENCY = "omnishop_currency_ent_totems_research_points";
const SHOP_NAME = "Vale Research Exchange";
const RANULPH = "Ranulph";

const isShop = (name) => name === SHOP || name === IRONMAN_SHOP;

function ironman(player) {
  const query = { player, mode: "none" };
  Shared.api().emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

function trade({ player }) {
  Shared.api().emitCustomEvent("omnishop:open", { player, shop: ironman(player) ? IRONMAN_SHOP : SHOP, handled: false });
  return true;
}

/** The transcript's "open_shop" step; the shop is the cache omnishop, not a ShopDefinition. */
function openFromDialogue(event) {
  if (event.action !== "open_shop" || event.target !== SHOP_NAME) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  const at = player.getLocation().clone();
  // The transcript closes its chatbox after this handler; open on the next tick, unless the
  // player has moved on.
  Shared.later(1, () => {
    if (player.isRegistered() && player.getLocation().equals(at) && player.getInterfaceId() === -1
        && !player.getDialogueManager().getCurrent()) trade({ player });
  });
}

function currency(request) {
  if (!isShop(request.shop) || Shared.core().CacheDefinitions.getDbRowName(request.currency) !== CURRENCY) return;
  const { player } = request;
  request.balance = State.researchPoints(player);
  request.set = (value) => State.setResearchPoints(player, value);
}

function describe(request) {
  if (!isShop(request.shop)) return;
  const cache = Shared.core().CacheDefinitions;
  const row = cache.getDbRow(cache.getDbRowId(request.stock));
  const item = row?.int(cache.getDbColumn(row.tableId, "omnishop_stock_obj"), -1) ?? -1;
  request.description = Shared.core().ItemDefinition.forId(item)?.getExamine?.() ?? request.description;
}

function attach(api) {
  api.onNpcInteraction(RANULPH, { Trade: trade });
  api.onCustomEvent("npc-dialogue:action", openFromDialogue);
  api.onCustomEvent("omnishop:currency", currency);
  api.onCustomEvent("omnishop:describe", describe);
}

module.exports = { attach, SHOP, IRONMAN_SHOP };
