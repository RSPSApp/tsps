// Sailing crewmates (docs/sailing.md, Crewmates): recruiting them through their transcripts,
// the Crew Registrar's crew management, the crew aboard the player's boat, their jobs at the
// helm, the salvaging hooks, cannons and repairs, banking cargo and carrying courier crates. The units are in ./crew/.
const common = require("./crew/Common.Crew");

module.exports = {
  name: "SailingCrew",
  description: "Sailing crewmates: recruiting them, the Crew Registrar, jobs at the helm, salvaging, cannons, repairs, banking cargo and courier crates.",
  members: true,
  register(api) {
    common.init(api);
    require("./crew/Recruit.Crew")(api);
    require("./crew/Registrar.Crew")(api);
    require("./crew/Deck.Crew")(api);
    require("./crew/Assign.Crew")(api);
    require("./crew/Helm.Crew")(api);
    require("./crew/Salvage.Crew")(api);
    require("./crew/Cannon.Crew")(api);
    require("./crew/BankCargo.Crew")(api);
    require("./crew/Courier.Crew")(api);
    require("./crew/Dev.Crew")(api);
  },
};
