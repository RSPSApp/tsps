/**
 * Warning screens and the Doomsayer who looks after them (Wiki: Doomsayer).
 * Content shows a screen with the "warning-screen:show" custom event; see
 * warningscreens/Screens.WarningScreens.js.
 */
module.exports = {
  name: "WarningScreens",
  description: "Warning screens before dangerous areas, counted per player and toggled off after enough showings, and the Lumbridge Doomsayer who turns them back on.",
  register(api) {
    require("./warningscreens/Screens.WarningScreens")(api);
    require("./warningscreens/Doomsayer.WarningScreens")(api);
  },
};
