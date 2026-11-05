/**
 * NPC ferries (Wiki: Transportation#Boats) with no other home: the Monks of Entrana, the Void
 * Knight squires, Veos's ship to Great Kourend (Veos, Cabin Boy Herbert, Captain Magoro), the
 * Rellekka boats (Jarvald, the Sailor, Lokar Searunner, Mord and Maria Gunnars, Torfinn), Captain
 * Bentley's galleon, the Fossil Island barge's Quick-Travel, Jeb's rowing boat and Achilka's River
 * Varla riverboat (Kastori, Tal Teklan, Gloomthorn Trail; rsprox 1098, 1104, 1149, Leagues). Each route's
 * travel style, timings, landing and lines are in plugins/world/data/ferries.json, as rsprox
 * recordings play them; ./ferries/ holds the units:
 *
 * - Voyages.Ferries.js: the five travel styles and landing on logout or shutdown;
 * - Routes.Ferries.js: what starts each route, the Entrana search and `ferries:travel`.
 *
 * Quest plugins keep their own crossings and hand ordinary ones over with `ferries:travel`.
 * At Port Sarim, Veos (1063) is in npc-spawns.json; Cabin Boy Herbert (11126, shown from
 * A Kingdom Divided's stage 12) has no spawn on this branch, added by fix/herbert-sarim-spawn.
 */
const Common = require("./ferries/Common.Ferries");
const Voyages = require("./ferries/Voyages.Ferries");
const Routes = require("./ferries/Routes.Ferries");

module.exports = {
  name: "Ferries",
  members: true,
  _test: { Common, Voyages, Routes },
  register(api) {
    Common.init(api);
    api.onPlayerLogout(Voyages.landNow);
    api.onServerShutdown(Voyages.landEveryone);
    Routes.attach(api);
  },
};
