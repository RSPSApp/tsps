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

/** Copies the administrator's base levels and experience onto an active bot. */
function copyStatsToBot({ player, parts }) {
  const { api, runtime } = services;
  const name = parts.slice(1).join(" ").replace(/_/g, " ").toLowerCase();
  const entry = [...runtime.entriesByUsername.values()].find(({ player: bot }) =>
    bot.getUsername().toLowerCase() === name || bot.getDisplayName().toLowerCase() === name);
  if (!entry || !runtime.playerBotUsernames.has(entry.player.getUsername())) {
    player.sendMessage("Usage: ::botstatsme <bot name>. Choose an active bot.");
    return true;
  }
  const bot = entry.player;
  for (const item of bot.getEquipment().getItems()) {
    if (!item || item.getId() <= 0) continue;
    const definition = item.getDefinition();
    if (!api.core.EquipmentRequirements.meets(player, definition)) {
      player.sendMessage(`Have ${bot.getDisplayName()} unequip ${definition.getName()} before copying your stats.`);
      return true;
    }
  }
  const from = player.getSkillManager();
  const to = bot.getSkillManager();
  for (const skill of api.core.Skill.values()) {
    const level = from.getMaxLevel(skill);
    to.setMaxLevels(skill, level, false)
      .setCurrentLevel(skill, level, false)
      .setExperiences(skill, from.getExperience(skill), false);
  }
  api.core.BonusManager.update(bot);
  api.core.WeaponInterfaceManager.assign(bot);
  bot.getPacketSender().sendSkillsSnapshot();
  bot.getUpdateFlag().flag(api.core.Flag.APPEARANCE);
  player.sendMessage(`Copied your stats to ${bot.getDisplayName()}.`);
  return true;
}

function returnToMain({ player }) {
  if (!services.api.core.releasePlayerControl(player)) {
    player.sendMessage("You are already on your own character.");
  }
  return true;
}

/**
 * A controlled bot leaving gives the admin their own character back. The parked owner leaving (kicked, banned) ends the
 * control: the bot is released and the admin's connection closes, never re-attached to the removed owner.
 */
function releaseRemovedPlayer({ player }) {
  for (const [bot, owner] of [...controls]) {
    if (player === owner) services.api.core.endPlayerControl(bot);
    else if (player === bot) services.api.core.releasePlayerControl(bot);
  }
}

function registerBotControlCommands(options) {
  services = options;
  const { api } = options;
  api.registerCommand("botcontrol", controlBot, api.core.PlayerRights.ADMINISTRATOR, "Manually control an active bot");
  api.registerCommand("botstatsme", copyStatsToBot, api.core.PlayerRights.ADMINISTRATOR, "Copy your stats onto a bot");
  // A controlled bot keeps its own rank; returning only restores this connection's owner.
  api.registerCommand("botback", returnToMain, api.core.PlayerRights.NONE, "Return to your own character");
  api.onPlayerLogout(releaseRemovedPlayer);
  api.onPlayerDisconnect(releaseRemovedPlayer);
}

module.exports = { registerBotControlCommands };
