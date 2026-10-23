/**
 * Item on item: every recipe in data/fletching.json starts here (Shared.Fletching.js has the
 * pairs, menus and timing). Celastrus bark's own Fletch option opens the knife menu too.
 */
const Shared = require("./Shared.Fletching");

let knifeId = null;
let barkId = null;

function itemOnItem(event) {
  if (Shared.handlePair(event.player, event.usedItemId, event.usedWithItemId)) event.handled = true;
}

function fletchBark({ player }) {
  Shared.handlePair(player, knifeId, barkId);
}

function stop({ player }) {
  Shared.stopFletching(player);
}

function init() {
  knifeId = Shared.itemId("KNIFE");
  barkId = Shared.itemId("CELASTRUS_BARK");
}

function attach(api) {
  api.onItemOnItem(itemOnItem, { noted: false });
  api.onItemAction("Celastrus bark", { Fletch: fletchBark });
  api.onPlayerDisconnect(stop);
  api.onCustomEvent("level-up:popup-opened", stop);
};

module.exports = { init, attach };
