/** Blast Furnace smelting, conveyor and dispenser; shared machinery lives in blastfurnace/. */
const Furnace = require("./blastfurnace/Furnace.BlastFurnace");

module.exports = {
  name: "BlastFurnace",
  description: "Adds the Blast Furnace: smelting ore on the conveyor and collecting bars from the dispenser.",
  members: true,
  _test: Furnace._test,
  register(api) {
    Furnace(api);
  },
};
