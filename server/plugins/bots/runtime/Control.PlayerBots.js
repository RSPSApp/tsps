"use strict";

const controls = new Map();
let services;

function controlBot({ player, parts }) {
  const { api, runtime, resetMovementState } = services;
  const name = parts.slice(1).join(" ").replace(/_/g, " ").toLowerCase();
  const entry = [...runtime.entriesByUsername.values()].find(({ player: bot }) =>
    bot.getUsername().toLowerCase() === name || bot.getDisplayName().toLowerCase() === name);
  if (!entry || !runtime.playerBotUsernames.has(entry.player.getUsername()) || entry.manuallyControlled) {
    player.sendMessage("Usage: ::botcontrol <bot name>. Choose an active, uncontrolled bot.");
    return true;
  }
  const bot = entry.player;
  const released = () => {
    controls.delete(bot);
    entry.manuallyControlled = false;
    if (!entry.behaviorPaused) resetMovementState(bot);
  };
  entry.manuallyControlled = true;
  if (!api.core.controlPlayer(player, bot, released)) {
    released();
    player.sendMessage("Unable to take control: finish any active interaction first, and use a headless bot.");
    return true;
  }
  controls.set(bot, player);
  resetMovementState(bot);
  bot.sendMessage(`Controlling ${bot.getDisplayName()}. Use ::botback to return to ${player.getUsername()}.`);
  return true;
}

function returnToMain({ player }) {
  if (!services.api.core.releasePlayerControl(player)) {
    player.sendMessage("You are already on your own character.");
  }
  return true;
}

function releaseRemovedPlayer({ player }) {
  for (const [bot, owner] of controls) {
    if (player === bot || player === owner) services.api.core.releasePlayerControl(bot);
  }
}

function registerBotControlCommands(options) {
  services = options;
  const { api } = options;
  api.registerCommand("botcontrol", controlBot, api.core.PlayerRights.ADMINISTRATOR, "Manually control an active bot");
  // A controlled bot keeps its own rank; returning only restores this connection's owner.
  api.registerCommand("botback", returnToMain, api.core.PlayerRights.NONE, "Return to your own character");
  api.onPlayerLogout(releaseRemovedPlayer);
  api.onPlayerDisconnect(releaseRemovedPlayer);
}

module.exports = { registerBotControlCommands };
