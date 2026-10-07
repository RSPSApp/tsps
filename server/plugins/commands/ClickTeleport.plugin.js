"use strict";

/**
 * Ctrl+Shift click to teleport: the OSRS client sends a walk click with its key byte set to 2
 * when Ctrl and Shift are both held, which Jagex's servers turn into a teleport for staff. Here
 * anyone who may use ::tele (ADMINISTRATOR and up, or world.json "commands:permissions") jumps
 * to the clicked tile on their own plane; for everyone else the click walks as a Ctrl-click.
 */

const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { PluginManager } = require("../../src/main/typescript/elvarg/plugins/PluginManager");

const CTRL_SHIFT_CLICK = 2;

/** "player:world-input": takes over a Ctrl+Shift walk click from a player allowed to ::tele. */
function clickTeleport(input) {
  const { player, packet } = input;
  if (packet?.type !== "move" || packet.modifierFlags !== CTRL_SHIFT_CLICK) return;
  if (!PluginManager.playerHasCommandRights(player, "tele")) return;
  player.moveTo(new Location(packet.worldX, packet.worldY, player.getLocation().getZ()));
  input.handled = true;
}

module.exports = {
  name: "ClickTeleport",
  register(api) {
    api.onCustomEvent("player:world-input", clickTeleport);
  },
};

module.exports._test = { clickTeleport };
