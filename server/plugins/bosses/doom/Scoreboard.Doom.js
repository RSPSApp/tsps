"use strict";

/**
 * The lobby's scoreboard (57288: Read, General-stats, Delve-stats), interface 920.
 *
 * Cache: two panels, both plain text the server fills (no script writes them):
 * - Delve stats (component 5): "Personal" completions and times per level (total at 44, then
 *   level 1 at 46/47, every 3 components to "Level 8+" at 70/71), "Global" the same from 14/15.
 * - General stats (component 3, hidden at first): personal deepest delve 72, deaths 74, best time
 *   (1 - 8) 76; global deepest 78, deaths 80, best time 82; deep delves personal 84, global 86.
 * Guess: Read shows the delve stats.
 */

const Shared = require("./DoomShared");
const Records = require("./DoomRecords");
const { onObject } = require("./Lobby.Doom");

const INTERFACE = 920;
const PANEL = { GENERAL: 3, DELVES: 5 };
const LEVELS = ["1", "2", "3", "4", "5", "6", "7", "8", "8+"];
const PERSONAL = { total: 44, first: 46 };
const GLOBAL = { first: 14 };
const GENERAL = { deepest: 72, deaths: 74, bestRun: 76, worldDeepest: 78, worldDeaths: 80, worldBestRun: 82, deepDelves: 84, worldDeepDelves: 86 };
const uid = (component) => (INTERFACE << 16) | component;

/** m:ss.cc, as the game shows times. */
function formatTicks(ticks) {
  if (!(ticks > 0)) return "-";
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function number(value) {
  return value > 0 ? value.toLocaleString("en-US") : "-";
}

function lines(player) {
  const mine = Records.personal(player);
  const world = Records.worldRecords();
  const strings = new Map();
  const total = Object.values(mine.completions).reduce((sum, value) => sum + value, 0);
  strings.set(PERSONAL.total, number(total));
  LEVELS.forEach((key, index) => {
    strings.set(PERSONAL.first + index * 3, number(mine.completions[key] ?? 0));
    strings.set(PERSONAL.first + index * 3 + 1, formatTicks(mine.best[key]));
    strings.set(GLOBAL.first + index * 3, number(world.completions[key] ?? 0));
    strings.set(GLOBAL.first + index * 3 + 1, formatTicks(world.best[key]));
  });
  strings.set(GENERAL.deepest, number(mine.deepest));
  strings.set(GENERAL.deaths, mine.deaths.toLocaleString("en-US"));
  strings.set(GENERAL.bestRun, formatTicks(mine.bestRun));
  strings.set(GENERAL.worldDeepest, number(world.deepest));
  strings.set(GENERAL.worldDeaths, world.deaths.toLocaleString("en-US"));
  strings.set(GENERAL.worldBestRun, formatTicks(world.bestRun));
  strings.set(GENERAL.deepDelves, (mine.completions["8+"] ?? 0).toLocaleString("en-US"));
  strings.set(GENERAL.worldDeepDelves, (world.completions["8+"] ?? 0).toLocaleString("en-US"));
  return strings;
}

function show(player, panel) {
  const sender = player.getPacketSender();
  sender.sendInterface(INTERFACE);
  for (const [component, text] of lines(player)) sender.sendString(text, uid(component));
  sender.sendInterfaceDisplayState(uid(PANEL.GENERAL), panel !== PANEL.GENERAL);
  sender.sendInterfaceDisplayState(uid(PANEL.DELVES), panel !== PANEL.DELVES);
}

function read(event) {
  show(event.player, event.option === "General-stats" ? PANEL.GENERAL : PANEL.DELVES);
  return true;
}

module.exports = function registerDoomScoreboard(api) {
  Shared.bind(api);
  onObject(api, Shared.OBJECT.SCOREBOARD, read);
};

Object.assign(module.exports, { INTERFACE, PANEL, lines, show, read, formatTicks });
