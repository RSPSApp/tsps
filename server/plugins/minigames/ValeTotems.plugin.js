"use strict";

/**
 * Vale Totems (docs/vale-totems.md): the Fletching minigame in the Auburn Valley. Totems are
 * built, carved and decorated at eight sites, ents leave offerings at them every 80 ticks, and
 * the offerings are rummaged for loot and research points. Each player's state is the client's
 * ent_totems varps. Units in ./valetotems/.
 */
const UNITS = [
  require("./valetotems/Shared.ValeTotems"),
  require("./valetotems/State.ValeTotems"),
  require("./valetotems/Totems.ValeTotems"),
  require("./valetotems/Offerings.ValeTotems"),
  require("./valetotems/Ents.ValeTotems"),
  require("./valetotems/Commands.ValeTotems"),
];

module.exports = {
  name: "ValeTotems",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
  },
};
