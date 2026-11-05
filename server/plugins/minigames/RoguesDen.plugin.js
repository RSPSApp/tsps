/**
 * Rogues' Den (https://oldschool.runescape.wiki/w/Rogues%27_Den): the Burthorpe maze's doorway
 * and lobby, its floor/wall traps and agility obstacles, the eight wall safes, the lobby safes,
 * the equipment crate/kit rewards, and the run's stat/experience bookkeeping. The real cache
 * object placements are indexed by ./roguesden/Common.RoguesDen; each part is its own unit.
 */
const Common = require("./roguesden/Common.RoguesDen");

module.exports = {
  name: "RoguesDen",
  members: true,
  register(api) {
    Common.init(api);
    api.registerArea(require("./roguesden/Area.RoguesDen").createArea());
    require("./roguesden/Run.RoguesDen").attach(api);
    require("./roguesden/Lobby.RoguesDen").attach(api);
    require("./roguesden/Interactions.RoguesDen").attach(api);
    require("./roguesden/Rewards.RoguesDen").attach(api);
  },
};
