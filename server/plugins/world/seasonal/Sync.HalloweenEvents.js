"use strict";

const Progress = require("./Progress.HalloweenEvents");
const Scene = require("./Scene.HalloweenEvents");

/** Sends the player's hw25 varbits; all zero while the event is not running. */
function refresh(api, { player }) {
  if (!player?.isRegistered()) return;
  const active = Scene.active(), values = Progress.varbits(Progress.read(player)), sender = player.getPacketSender();
  for (const [symbol, value] of Object.entries(values)) {
    const id = api.core.CacheDefinitions.getVarbitId(symbol);
    if (id !== null) sender.sendVarbit(id, active ? value : 0);
  }
}

function all(api) { for (const player of api.core.World.getPlayers()) if (player?.isRegistered()) refresh(api, { player }); }

module.exports = { refresh, all };
