"use strict";

/** ::entvisit: an ent visits every totem site now, instead of in up to 80 ticks. */
const State = require("./State.ValeTotems");
const Ents = require("./Ents.ValeTotems");

function entVisit({ player }) {
  State.join(player);
  Ents.visitAll(player);
  player.sendMessage("The ents visit every totem site.");
  return true;
}

function attach(api) {
  api.registerCommand("entvisit", entVisit, api.core.PlayerRights.OWNER, "Vale Totems: an ent visits every totem site now");
}

module.exports = { attach };
