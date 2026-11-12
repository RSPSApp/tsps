/**
 * Settings > Gameplay > "Rune-picking behaviour" (setting 306, varbit `take_runes_toggle`; the
 * Magic combat tutor sets it too). While it is on, runes picked up from the ground or made by
 * Runecrafting go into the carried pouch when it already holds that rune and has room for all
 * of them (cache row text; Wiki: Rune pouch). Otherwise they go to the inventory as usual.
 *
 * Runes from pickpocketing and Hallowed Sepulchre coffins go into the pouch the same way whatever
 * the setting; those from looting Sailing creatures only while it is on (Wiki: Rune pouch,
 * changes of 25 February and 6 May 2026). Their sources ask through `rune-pouch:gather`.
 */
const Pouch = require("./Common.RunePouch");
const { takeInto } = require("../TakeInto");

const TOGGLE_VARBIT = "take_runes_toggle";
const GATHER_EVENT = "rune-pouch:gather";

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

/**
 * `rune-pouch:gather` `{ player, itemId, amount, stored, runePicking? }`: the whole amount goes
 * into the pouch slot already holding that rune when it has room for all of it, and `stored`
 * says how many did; the source adds the rest to the inventory. `runePicking` limits it to while
 * the Rune-picking setting is on. Ours: a stack that doesn't fit whole stays in the inventory,
 * as with picking up.
 */
function gather(request) {
  const { player, itemId } = request;
  const amount = Math.floor(Number(request.amount));
  if (!(amount > 0) || !Pouch.isRune(itemId) || (request.runePicking && !enabled(player))) return;
  if (matchingRoom(player, itemId) < amount) return;
  request.stored = Pouch.refill(player, itemId, amount);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  api.onGroundItemPickup(pickup);
  api.onCustomEvent("runecrafting:success", crafted);
  api.onCustomEvent(GATHER_EVENT, gather);
};

Object.assign(module.exports, { TOGGLE_VARBIT, GATHER_EVENT, matchingRoom, gather });
