/**
 * Rune pouch: what a death does with its runes (the storage items' death hook decides when;
 * docs/rune-pouch.md). Emptied, the runes leave the pouch's slots as plain runes. A PvP death
 * destroys an unkept pouch: it is neither dropped nor given back (Wiki: Items Kept on Death).
 */
const Pouch = require("./Common.RunePouch");

const container = {
  holds: Pouch.isPouch,
  varbit: "emptyondeath_runepouch",
  empty(player) {
    const runes = Pouch.slots(player).filter(Boolean);
    if (runes.length > 0) Pouch.setSlots(player, Array.from({ length: Pouch.SLOTS }, () => null));
    return runes;
  },
};

function deathContainers(query) {
  query.containers.push(container);
}

function lostOnPvpDeath(event) {
  const { player, killer, item } = event;
  if (event.kept || event.shouldDropItems === false || !killer || killer === player) return;
  if (Pouch.isPouch(item)) event.handled = true;
}

module.exports = function attach(api) {
  api.onCustomEvent("storage:death-containers", deathContainers);
  api.onPlayerDeathItemDrop(lostOnPvpDeath);
};
