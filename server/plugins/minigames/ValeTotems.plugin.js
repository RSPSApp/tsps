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
  require("./valetotems/Items.ValeTotems"),
  require("./valetotems/Book.ValeTotems"),
  require("./valetotems/Shop.ValeTotems"),
  require("./valetotems/Ents.ValeTotems"),
  require("./valetotems/Icons.ValeTotems"),
  require("./valetotems/Commands.ValeTotems"),
];

module.exports = {
  name: "ValeTotems",
  description: "Adds the Vale Totems Fletching minigame in the Auburn Valley: building and decorating totems, ent offerings, loot and research points.",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
  },
};
