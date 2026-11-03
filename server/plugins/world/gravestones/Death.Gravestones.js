"use strict";

/**
 * Which deaths make a grave, and what goes in it (Wiki: Grave, Death):
 * - a PvM death puts every lost item in the grave, untradeables included; a PvP death drops
 *   them for the killer as before, and Ultimate Ironmen drop everything on the floor;
 * - with "Food/Potions can form supply piles on death" on (gravestone_supplypiles_disabled 0),
 *   lost food and potions are dropped where the player died instead: "Some supplies have been
 *   dropped where you died.";
 * - in the Wilderness "food, potions, and phoenix necklaces cannot be sent to a grave or dropped,
 *   and are instead deleted", and an existing grave moves to the new death.
 * World config `Gravestones:enabled` (default true) turns graves off: lost items fall to the
 * floor as they did before.
 */
const Common = require("./Common.Gravestones");
const Grave = require("./Grave.Gravestones");
const Timer = require("./Timer.Gravestones");

const ENABLED_CONFIG = "Gravestones:enabled";
const PHOENIX_NECKLACE = "Phoenix necklace";
const SUPPLY_PILE_MESSAGE = "Some supplies have been dropped where you died.";

function isPhoenixNecklace(item) {
  return item.getDefinition().getName() === PHOENIX_NECKLACE;
}

function makesGrave(player, killer) {
  if (killer && killer !== player) return false;
  if (player.isPlayerBot?.()) return false;
  if (!Common.api().getPluginConfig(ENABLED_CONFIG, true)) return false;
  return Common.ironmanMode(player) !== "ultimate";
}

function queryMakesGrave(query) {
  query.makesGrave = !query.playerKill && makesGrave(query.player, null);
}

function takeDeathDrops(event) {
  const { player, killer, location } = event;
  if (!makesGrave(player, killer)) return;
  const wilderness = Common.core().Wilderness.isIn(player);
  const piles = !wilderness && Common.getVarbit(player, "supplyPilesDisabled") !== 1;
  const lost = [...event.items, ...event.untradeables];
  const toGrave = [];
  const toFloor = [];
  for (const item of lost) {
    const supply = Common.isSupply(item.getId());
    if (wilderness && (supply || isPhoenixNecklace(item))) continue;
    if (piles && supply) toFloor.push(item);
    else toGrave.push(item);
  }
  event.items.length = 0;
  event.untradeables.length = 0;
  event.items.push(...toFloor);
  if (toFloor.length > 0) player.sendMessage(SUPPLY_PILE_MESSAGE);
  Grave.store(player, location, toGrave.map(Common.record), event.layout, wilderness);
  Timer.track(player);
}

function attach(api) {
  Common.bind(api);
  api.onPlayerDeathDrops(takeDeathDrops);
  api.onCustomEvent("gravestones:makes-grave", queryMakesGrave);
}

module.exports = { attach, makesGrave };
