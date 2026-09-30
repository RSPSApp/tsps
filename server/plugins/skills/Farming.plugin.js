/**
 * Farming.
 *
 * Patch mechanics ported from Void (GregHib/void, BSD-3-Clause): rake, plant,
 * water, compost, disease/cure, growth cycles, harvest/check-health, compost bins
 * and plant pots. Patch varbit values come from the rev 237 cache via RuneLite's
 * PatchImplementation (BSD-2-Clause); crop values are the classic OSRS tables.
 *
 * Sub-modules live in ./farming/. `register` only wires them together.
 */
module.exports = {
    name: "Farming",
    register(api) {
        api.persistAttribute("farming.patches");
        api.persistAttribute("farming.saplings");

        const patches = require("./farming/farmingPatches");
        const crops = require("./farming/farmingCrops")(api.core);
        const state = require("./farming/farmingState")(api.core);
        require("./farming/farmingGrowth")(api, patches, crops, state);
        require("./farming/farmingInteractions")(api, patches, crops, state);
    },
};
