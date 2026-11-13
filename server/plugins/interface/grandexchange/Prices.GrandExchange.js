/**
 * The Grand Exchange pricing experts' Prices option: ge_pricelist (237), a list of guide prices.
 * Wiki: https://oldschool.runescape.wiki/w/Grand_Exchange#Pricing_experts
 *
 * Each expert's list is a cache inventory whose stack counts are the items' guide prices; script
 * 799 (ge_pricelist) draws it under the list's title. The lists are in data/ge-price-lists.json.
 */
const LISTS = require("../data/ge-price-lists.json");

const PRICELIST = 237;
const MAIN_MODAL = (161 << 16) | 16;
// ge_pricelist:list takes Examine (op 10) on each entry.
const LIST = (PRICELIST << 16) | 2;
const LIST_EVENTS = 1 << 10;
const EXAMINE_OP = 10;
// ge_pricelist:displaymode switches the list between its two layouts.
const DISPLAY_MODE = (PRICELIST << 16) | 4;
const DISPLAY_MODE_VARBIT = 4440; // ge_pricelist_mode
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_PRICELIST = 799;
// The list open per player: its NPC's entry in LISTS.
const open = new WeakMap();
let api;
let price;

function openPrices(event) {
  const { player } = event;
  const list = LISTS[event.definition?.getName?.() ?? event.npc?.getDefinition?.()?.getName?.()];
  if (!list) return false;
  player.getMovementQueue().reset();
  player.getPacketSender().sendInterfaceRemoval();
  player.setInterfaceId(PRICELIST);
  open.set(player, list);
  player.getPacketSender()
    .sendInventory(list.inventory, list.items.length, list.items.map((id) => ({ id, amount: price(id) })))
    .sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1])
    .sendSubInterface(MAIN_MODAL, PRICELIST, 0)
    .sendInterfaceScript(SCRIPT_PRICELIST, [list.inventory, list.title])
    .sendInterfaceFlagsRange(LIST, 0, list.items.length - 1, LIST_EVENTS);
  return true;
}

function openList(player) {
  return player.getInterfaceId() === PRICELIST ? open.get(player) : undefined;
}

function examine({ player, slot, action, opId }) {
  const list = openList(player);
  const id = list?.items[slot];
  if ((opId ?? action) !== EXAMINE_OP || !Number.isInteger(id)) return false;
  api.core.examineItem(player, id, 1);
  return true;
}

function toggleDisplay({ player }) {
  if (!openList(player)) return false;
  const sender = player.getPacketSender();
  sender.sendVarbit(DISPLAY_MODE_VARBIT, sender.getVarbit(DISPLAY_MODE_VARBIT) ? 0 : 1);
  return true;
}

module.exports = function attach(pluginApi, guidePrice) {
  api = pluginApi;
  price = guidePrice;
  api.onNpcsInteraction(Object.keys(LISTS), { Prices: openPrices });
  api.onInterfaceActionButton(LIST, examine);
  api.onInterfaceActionButton(DISPLAY_MODE, toggleDisplay);
};
module.exports.LISTS = LISTS;
