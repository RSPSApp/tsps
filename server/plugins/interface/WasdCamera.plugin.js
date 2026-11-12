"use strict";

/**
 * The web client's WASD camera (All Settings > Controls > WASD Camera): while a player has it on,
 * W, A, S and D turn the camera like the arrow keys, and Enter opens chat. The client offers the
 * toggle only on worlds that send this at login, so turning the plugin off removes it for everyone.
 * Each player's choice stays in their browser, off until they turn it on.
 */
const CHANNEL = "wasd-camera";

let core = null;

function init(api) {
  core = api.core;
}

function offerWasdCamera({ player }) {
  player.getSession().sendClientPacket(core.encodePluginMessage(CHANNEL, { available: true }));
}

module.exports = {
  name: "WasdCamera",
  description: "Lets web client players turn on WASD camera in All Settings > Controls: W, A, S and D turn the camera like the arrow keys, and Enter opens chat. Off for each player until they turn it on; turn the plugin off to remove the option.",
  register(api) {
    init(api);
    api.onPlayerLogin(offerWasdCamera);
  },
};
