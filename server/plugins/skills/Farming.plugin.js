/**
 * Farming: patches, growth, tools and storage, Tithe Farm, the Farming Guild and Hespori.
 * The parts live in ./farming/ (see Farming.md); Patches.Farming attaches every hook.
 */
module.exports = {
  name: "Farming",
  members: true,
  register(api) {
    require("./farming/Core.Farming").init(api);
    require("./farming/Patches.Farming").attach(api);
  },
};
