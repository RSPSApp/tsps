"use strict";

/**
 * Pyramid Plunder, the Jalsavrah thieving minigame in Sophanem: the outer panels and the
 * Guardian mummy, eight timed rooms of urns, a Grand Gold Chest and a sarcophagus behind a
 * speartrap and four tomb doors, the Pharaoh's sceptre, and Simon Templeton buying the
 * artefacts, and the Mural that keeps the reader's chests. Each unit lives in ./pyramidplunder/; add one line per unit.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Pyramid_Plunder
 */

const Common = require("./pyramidplunder/Common.PyramidPlunder");
const Entrance = require("./pyramidplunder/Entrance.PyramidPlunder");
const Containers = require("./pyramidplunder/Containers.PyramidPlunder");
const Passages = require("./pyramidplunder/Passages.PyramidPlunder");
const Session = require("./pyramidplunder/Session.PyramidPlunder");
const Simon = require("./pyramidplunder/Simon.PyramidPlunder");
const Mural = require("./pyramidplunder/Mural.PyramidPlunder");

module.exports = {
  name: "PyramidPlunder",
  description: "Adds Pyramid Plunder in Sophanem: eight timed rooms of urns and chests, the Pharaoh's sceptre and Simon Templeton buying artefacts.",
  members: true,
  register(api) {
    Entrance(api);
    Containers(api);
    Passages(api);
    Session(api);
    Simon(api);
    Mural(api);
  },
  /** For server/tests/pyramid-plunder.test.cjs. */
  _test: {
    Common,
    Entrance: Entrance._test,
    Containers: Containers._test,
    Passages: Passages._test,
    Session: Session._test,
    Simon: Simon._test,
    Mural: Mural._test,
  },
};
