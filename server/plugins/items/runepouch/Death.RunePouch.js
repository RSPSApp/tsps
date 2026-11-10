/**
 * Rune pouch: what a death does with its runes (the storage items' death hook decides when;
 * docs/rune-pouch.md). Emptied, the runes leave the pouch's slots as plain runes.
 */
const Pouch = require("./Common.RunePouch");

const container = {
  holds: Pouch.isPouch,
  empty(player) {
    const runes = Pouch.slots(player).filter(Boolean);
    if (runes.length > 0) Pouch.setSlots(player, Array.from({ length: Pouch.SLOTS }, () => null));
    return runes;
  },
};

module.exports = function attach(api) {
  api.onCustomEvent("storage:death-containers", (query) => query.containers.push(container));
};
