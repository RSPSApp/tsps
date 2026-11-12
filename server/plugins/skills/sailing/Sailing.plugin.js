"use strict";

module.exports = {
  name: "Sailing",
  description: "Sailing boats, travel, shipyards, crews, port tasks, sea charting and combat.",
  members: true,
  register(api) {
    require("./DropWarning.Sailing").register(api);
    require("./Anchor.Sailing").register(api);
    require("./BarracudaTrials.Sailing").register(api);
    require("./BoatSelection.Sailing").register(api);
    require("./BoatTeleport.Sailing").register(api);
    require("./CargoHold.Sailing").register(api);
    require("./Charting.Sailing").register(api);
    require("./Crew.Sailing").register(api);
    require("./CrystalExtractor.Sailing").register(api);
    require("./Gangplank.Sailing").register(api);
    require("./Helm.Sailing").register(api);
    require("./Kegs.Sailing").register(api);
    require("./PortTasks.Sailing").register(api);
    require("./Panel.Sailing").register(api);
    require("./Commands.Sailing").register(api);
    require("./Salvaging.Sailing").register(api);
    require("./Schematics.Sailing").register(api);
    require("./SeaCombat.Sailing").register(api);
    require("./Shipwright.Sailing").register(api);
    require("./ShipwrightRepairs.Sailing").register(api);
    require("./ShipwrightsWorkbench.Sailing").register(api);
    require("./Shipyard.Sailing").register(api);
    require("./ShipyardFacilities.Sailing").register(api);
    require("./StaticShipHooks.Sailing").register(api);
    require("./SummonBoat.Sailing").register(api);
    require("./TeleportWarning.Sailing").register(api);
  },
};
