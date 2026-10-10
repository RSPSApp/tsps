"use strict";

/**
 * Stealing artefacts, the Port Piscarilius thieving minigame: Captain Khaled's task, the six
 * houses' drawers, the patrolling guards and the hand-in. Each unit lives in
 * ./stealingartefacts/; add one line per unit.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Stealing_artefacts
 */

const Common = require("./stealingartefacts/Common.StealingArtefacts");
const Drawers = require("./stealingartefacts/Drawers.StealingArtefacts");
const Khaled = require("./stealingartefacts/Khaled.StealingArtefacts");
const Guards = require("./stealingartefacts/Guards.StealingArtefacts");
const Session = require("./stealingartefacts/Session.StealingArtefacts");

module.exports = {
  name: "StealingArtefacts",
  members: true,
  register(api) {
    Drawers(api);
    Khaled(api);
    Guards(api);
    Session(api);
  },
  /** For server/tests/stealing-artefacts.test.cjs. */
  _test: {
    ...Common._test,
    ...Drawers._test,
    ...Khaled._test,
    ...Guards._test,
    ...Session._test,
  },
};
