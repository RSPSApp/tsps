/**
 * Ranging cape metal attraction (Wiki: Ranging cape, "Metal attraction").
 *
 * About every 3.5 minutes a worn Ranging cape (or max cape) attracts one steel item into the
 * player's inventory, or a mithril item once Vorkath's head has been used on the cape. The
 * player must have moved at least three tiles since the last attraction. "Commune" turns it
 * off (Options.SkillCapes' JUNK_OFF_ATTRIBUTE). The cape must stay worn: removing it resets
 * the timer.
 *
 * ponytail: a fixed 350-tick interval stands in for the live "approximately 3.5 minutes"; the
 * wiki gives no distribution.
 */
const Capes = require("./Common.SkillCapes");

let tables;

function resolve(rows) {
  return rows.map(([name, weight]) => ({ id: Capes.objId(name), weight }));
}

function tableFor(player) {
  return player.getAttribute(Capes.VORKATH_UPGRADE_ATTRIBUTE) === true ? tables.mithril : tables.steel;
}

function roll(table, random = Math.random) {
  let value = random() * 2000;
  for (const entry of table) {
    value -= entry.weight;
    if (value < 0) return entry.id;
  }
  return table[table.length - 1].id;
}

/** Per-player tick and last-attraction tile, so the timer survives equipment changes. */
const states = new WeakMap();

function stateFor(player) {
  let state = states.get(player);
  if (!state) {
    const location = player.getLocation();
    state = { ticks: 0, x: location.getX(), y: location.getY(), z: location.getZ() };
    states.set(player, state);
  }
  return state;
}

function reset(state, location) {
  state.ticks = 0;
  state.x = location.getX();
  state.y = location.getY();
  state.z = location.getZ();
}

function process({ player }) {
  if (!player) return;
  const state = stateFor(player);
  const location = player.getLocation();
  if (!Capes.hasPerk(player, "RANGED") || player.getAttribute(Capes.JUNK_OFF_ATTRIBUTE) === true) {
    reset(state, location);
    return;
  }
  state.ticks++;
  if (state.ticks < Capes.DATA.metalAttraction.intervalTicks) return;
  const moved = Math.max(Math.abs(location.getX() - state.x), Math.abs(location.getY() - state.y));
  if (moved < Capes.DATA.metalAttraction.moveTiles) return;
  if (player.getInventory().getFreeSlots() === 0) return;
  player.getInventory().adds(roll(tableFor(player)), 1);
  reset(state, location);
}

module.exports = function attachMetalAttraction(api) {
  tables = {
    steel: resolve(Capes.DATA.metalAttraction.steel),
    mithril: resolve(Capes.DATA.metalAttraction.mithril),
  };
  api.onPlayerProcess(process);
  api.onPlayerLogin(({ player }) => states.delete(player));
  api.onPlayerLogout(({ player }) => states.delete(player));
};

module.exports._test = { process, roll, tableFor, resolve };
