module.exports = {
  name: "LumbridgeGuide",
  description: "Picks the Lumbridge Guide's dialogue depending on whether the player has lost their Amulet of the Eye.",
  register(api) {
    require("./lumbridgeguide/Dialogue.LumbridgeGuide")(api);
  },
};
