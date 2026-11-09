/**
 * Construction: player-owned houses, rooms, furniture and the house's facilities.
 * The parts live in ./construction/; House.Construction attaches every hook.
 */
module.exports = {
  name: "Construction",
  description: "Construction: player-owned houses, rooms, furniture and the house's facilities.",
  members: true,
  register(api) {
    require("./construction/Core.Construction").init(api);
    require("./construction/House.Construction").attach(api);
  },
};
