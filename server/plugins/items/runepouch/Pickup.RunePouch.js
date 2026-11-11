/**
 * Settings > Gameplay > "Rune-picking behaviour" (setting 306, varbit `take_runes_toggle`; the
 * Magic combat tutor sets it too). While it is on, runes picked up from the ground or made by
 * Runecrafting go into the carried pouch when it already holds that rune and has room for all
 * of them (cache row text; Wiki: Rune pouch). Otherwise they go to the inventory as usual.
 */
const Pouch = require("./Common.RunePouch");
const { takeInto } = require("../TakeInto");

const TOGGLE_VARBIT = "take_runes_toggle";

let api;

function enabled(player) {
  return player?.getPacketSender?.().getVarbit?.(Pouch.varbit(TOGGLE_VARBIT)) === 1;
}

/** Room for `runeId` in the pouch slot already holding it; 0 with no pouch or no such slot. */
function matchingRoom(player, runeId) {
  if (!Pouch.findPouch(player)) return 0;
  const held = Pouch.slots(player).findIndex((entry) => entry?.id === runeId);
  return held >= 0 && held < Pouch.slotCount(player) ? Pouch.room(player, runeId) : 0;
}

function pickup(event) {
  const { player, groundItem } = event;
  const runeId = groundItem.getItem?.()?.getId?.();
  if (!Pouch.isRune(runeId) || !enabled(player)) return;
  takeInto(api, event, {
    room: () => matchingRoom(player, runeId),
    store: (amount) => Pouch.refill(player, runeId, amount),
  });
}

/** After the craft has added the runes to the inventory, they move on into the pouch. */
function crafted(event) {
  const { player, runeId } = event;
  if (!Pouch.isRune(runeId) || !enabled(player)) return;
  const amount = Number(event.runeAmount ?? (Number(event.rolls) || 0) * (Number(event.amountPerEssence) || 0));
  if (!(amount > 0) || matchingRoom(player, runeId) < amount || Pouch.plainInInventory(player, runeId) < amount) return;
  Pouch.takeFromInventory(player, runeId, amount);
  Pouch.refill(player, runeId, amount);
  player.getInventory().refreshItems();
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  api.onGroundItemPickup(pickup);
  api.onCustomEvent("runecrafting:success", crafted);
};

Object.assign(module.exports, { TOGGLE_VARBIT, matchingRoom });
