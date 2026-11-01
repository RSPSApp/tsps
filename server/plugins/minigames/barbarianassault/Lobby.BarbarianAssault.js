"use strict";

const data = require("./Data.BarbarianAssault");
const Match = require("./Match.BarbarianAssault");

const START_TASK_KEY = "barbarian-assault:start";
const queue = [];
let api = null;
let core = null;
let startTask = null;
let levelPromptHandler = null;

function setLevelPromptHandler(handler) {
  levelPromptHandler = handler;
}

function roleCount(role) {
  return queue.filter((entry) => entry.role === role).length;
}

function inQueue(player) {
  return queue.some((entry) => entry.player === player);
}

function entryFor(player) {
  return queue.find((entry) => entry.player === player) ?? null;
}

function canAdd(role) {
  if (roleCount(role) >= data.ROLE_CAPACITY) return false;
  const after = queue.length + 1;
  const counts = Object.fromEntries(data.ROLES.map((key) => [key, roleCount(key) + (key === role ? 1 : 0)]));
  const missing = data.ROLES.filter((key) => counts[key] === 0).length;
  const left = data.TEAM_SIZE - after;
  return left >= missing;
}

function availableRoles() {
  return data.ROLES.filter((role) => canAdd(role));
}

function removeFromQueue(player) {
  const index = queue.findIndex((entry) => entry.player === player);
  if (index === -1) return false;
  queue.splice(index, 1);
  if (queue.length < data.TEAM_SIZE) cancelCountdown();
  return true;
}

function cancelCountdown() {
  if (startTask?.isRunning?.()) startTask.stop();
  core?.TaskManager?.cancelTasks?.(START_TASK_KEY);
  startTask = null;
}

function startCountdown() {
  if (startTask || queue.length < data.TEAM_SIZE) return;
  if (Match.activeMatches.size > 0) return;
  if (!data.ROLES.every((role) => roleCount(role) > 0)) return;
  startTask = new core.CountdownTask(START_TASK_KEY, Math.ceil(data.START_COUNTDOWN_SECONDS / 0.6), launch);
  core.TaskManager.submit(startTask);
  for (const entry of queue) {
    entry.player.sendMessage(`Your team is ready. The game starts in ${data.START_COUNTDOWN_SECONDS} seconds.`);
  }
}

function launch() {
  startTask = null;
  if (Match.activeMatches.size > 0) return;
  if (queue.length < data.TEAM_SIZE || !data.ROLES.every((role) => roleCount(role) > 0)) return;
  const team = queue.splice(0, data.TEAM_SIZE).map((entry) => [entry.player, entry.role]);
  try {
    return Match.createMatch(api, team, (finished) => {
      // The match owns the return-to-surface message; the lobby only forgets it.
    });
  } catch (error) {
    for (const [player] of team) player.sendMessage("The game could not start. Speak to Commander Connad to try again.");
    return null;
  }
}

function join(player, role) {
  if (Match.matchFor(player)) {
    player.sendMessage("You are already in a game of Barbarian Assault.");
    return false;
  }
  if (Match.activeMatches.size > 0) {
    player.sendMessage("The Barbarian Assault arena is busy. Wait for the current game to finish.");
    return false;
  }
  if (inQueue(player)) {
    player.sendMessage("You are already on a team.");
    return false;
  }
  if (!data.ROLE_LABEL[role]) return false;
  if (!canAdd(role)) {
    player.sendMessage(roleCount(role) >= data.ROLE_CAPACITY
      ? `There is no room for another ${data.ROLE_LABEL[role]}.`
      : "That role would leave the team unable to fill every role.");
    return false;
  }
  queue.push({ player, role });
  player.sendMessage(`You join the team as ${data.ROLE_LABEL[role]} (${queue.length}/${data.TEAM_SIZE}).`);
  if (queue.length === data.TEAM_SIZE) startCountdown();
  return true;
}

function leave(player) {
  if (!removeFromQueue(player)) {
    player.sendMessage("You are not on a team.");
    return false;
  }
  player.sendMessage("You leave the team.");
  return true;
}

function status(player) {
  const entry = entryFor(player);
  if (!entry) {
    player.sendMessage(`You are not on a team. ${data.TEAM_SIZE - queue.length} slot${data.TEAM_SIZE - queue.length === 1 ? "" : "s"} remain.`);
    return;
  }
  const counts = data.ROLES.map((role) => `${data.ROLE_LABEL[role]} ${roleCount(role)}`).join(", ");
  player.sendMessage(`Your role: ${data.ROLE_LABEL[entry.role]}. Team: ${queue.length}/${data.TEAM_SIZE} (${counts}).`);
}

function rolePrompt(player) {
  if (inQueue(player)) {
    api.sendMultiChatboxPrompt(
      player,
      "Commander Connad: you are already on a team.",
      "Leave team", () => leave(player),
      "Level up a role", () => levelPromptHandler?.(player),
      "Team status", () => status(player),
    );
    return;
  }
  const options = [];
  for (const role of data.ROLES) {
    const full = !canAdd(role);
    options.push(`${data.ROLE_LABEL[role]} (${roleCount(role)}/${data.ROLE_CAPACITY})${full ? " - unavailable" : ""}`, () => {
      if (full) {
        player.sendMessage(`The ${data.ROLE_LABEL[role]} role is not available.`);
        rolePrompt(player);
        return;
      }
      join(player, role);
    });
  }
  options.push("Level up a role", () => levelPromptHandler?.(player));
  api.sendMultiChatboxPrompt(player, "Commander Connad: choose your role.", ...options);
}

function talkToCommander({ player }) {
  if (Match.matchFor(player)) {
    player.sendMessage("Finish the wave before choosing a new role, soldier.");
    return;
  }
  rolePrompt(player);
}

function climbDown({ player }) {
  if (Match.matchFor(player)) {
    player.sendMessage("You are already in the arena.");
    return;
  }
  if (!inQueue(player)) {
    player.sendMessage("Speak to Commander Connad to choose a role before you climb down.");
    rolePrompt(player);
    return;
  }
  if (queue.length >= data.TEAM_SIZE) {
    startCountdown();
    return;
  }
  status(player);
  rolePrompt(player);
}

function logout({ player }) {
  removeFromQueue(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onPlayerLogout?.(logout);
  pluginApi.onPlayerDisconnect?.(logout);
}

module.exports = {
  attach, rolePrompt, join, leave, status, climbDown, talkToCommander,
  setLevelPromptHandler,
  queue, roleCount, inQueue, canAdd, startCountdown, cancelCountdown,
};
