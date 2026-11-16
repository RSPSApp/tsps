"use strict";

/**
 * Which deaths make a grave, and what goes in it (Wiki: Grave, Death):
 * - a PvM death puts every lost item in the grave, untradeables included; a PvP death drops
 *   them for the killer as before, and Ultimate Ironmen drop everything on the floor;
 * - with "Food/Potions can form supply piles on death" on (gravestone_supplypiles_disabled 0),
 *   lost food and potions are dropped where the player died instead: "Some supplies have been
 *   dropped where you died."; not in a private area (an instance: the Colosseum, Doom), which goes
 *   with its run, so there they go to the grave with the rest (Wiki: Fortis Colosseum, "All
 *   unprotected items are moved to the grave"; rsprox 238/04127, a Colosseum death holding an
 *   anglerfish, makes no pile and no message);
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

/** Content may nominate victim-owned exceptions to the usual PvP routing.
 * `gravestones:pvp-items` { player, killer, eligible, items }: eligible is only
 * this death's lost, originally worn untradeables; items receives exact references.
 * The grave owner rechecks against its own set, never accepting other PvP loot.
 */
function takePvpExceptions(event) {
  const { player, killer, location } = event;
  if (!killer || killer === player || player.isPlayerBot?.()) return;
  if (!Common.api().getPluginConfig(ENABLED_CONFIG, true) || Common.ironmanMode(player) === "ultimate") return;
  const worn = player.getEquipment().getItems();
  const eligible = new Set(event.untradeables.filter(item => !item.isTradeable() && worn.includes(item)));
  if (eligible.size === 0) return;
  const request = { player, killer, eligible: [...eligible], items: [] };
  Common.api().emitCustomEvent("gravestones:pvp-items", request);
  const selected = event.untradeables.filter(item => eligible.has(item) && request.items.includes(item) && !item.isTradeable());
  if (selected.length === 0) return;
  const taken = new Set(selected);
  for (let i = event.untradeables.length - 1; i >= 0; i--) {
    if (taken.has(event.untradeables[i])) event.untradeables.splice(i, 1);
  }
  Grave.store(player, location, selected.map(Common.record), event.layout, Common.core().Wilderness.isIn(player));
  Timer.track(player);
}

function takeDeathDrops(event) {
  const { player, killer, location } = event;
  if (!makesGrave(player, killer)) {
    takePvpExceptions(event);
    return;
  }
  const wilderness = Common.core().Wilderness.isIn(player);
  const piles = !wilderness && !player.getPrivateArea?.() && Common.getVarbit(player, "supplyPilesDisabled") !== 1;
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
