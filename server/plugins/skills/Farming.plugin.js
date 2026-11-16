/**
 * Farming: patches, growth, tools and storage, Tithe Farm, the Farming Guild and Hespori.
 * The parts live in ./farming/ (see Farming.md); Patches.Farming attaches every hook.
 */
module.exports = {
  name: "Farming",
  description: "Farming: patches, crop growth, tools and storage, Tithe Farm, the Farming Guild and Hespori.",
  config: {
    "Farming:growthMultiplier": {
      type: "number", label: "Crop growth speed", default: 1, min: 0, exclusiveMin: true,
      help: "Makes crops and seedlings grow this many times faster. 1 is the normal speed. Weeds, compost bins and Tithe Farm keep theirs. Crops already planted keep the growth they have done and continue at the new speed.",
    },
  },
  members: true,
  register(api) {
    require("./farming/Core.Farming").init(api);
    require("./farming/Patches.Farming").attach(api);
  },
};
