"use strict";

/**
 * The lobby scoreboard (interface 639): your completions, deaths and best time for the Gauntlet
 * and the Corrupted Gauntlet, beside the world's (Wiki: "It shows the reader's completions,
 * deaths, and best times ... Players can also use the scoreboard to view global stats").
 *
 * The world's totals are kept in data/saves/gauntlet-scoreboard.json (plugins have no world
 * store); each panel is a title and six label/value lines, components 5-17 and 18-30.
 */

const fs = require("fs");
const path = require("path");
const Shared = require("./GauntletShared");

const INTERFACE = 639;
const PANELS = { regular: { title: "The Gauntlet", first: 5 }, corrupted: { title: "The Corrupted Gauntlet", first: 18 } };
const MODES = ["regular", "corrupted"];

let file = path.join(process.cwd(), "data", "saves", "gauntlet-scoreboard.json");
let global = null;

function emptyTotals() {
  return { regular: { completions: 0, deaths: 0, bestTicks: -1 }, corrupted: { completions: 0, deaths: 0, bestTicks: -1 } };
}

function totals() {
  if (global) return global;
  global = emptyTotals();
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const mode of MODES) global[mode] = { ...global[mode], ...(saved?.[mode] ?? {}) };
  } catch {
    // No file yet, or unreadable: start from zero.
  }
  return global;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(totals(), null, 2));
  } catch (error) {
    console.warn("[gauntlet] could not save the scoreboard", error?.message ?? error);
  }
}

/** Counts a run's end in the world's totals. */
function recordGlobal(mode, kind, ticks) {
  const entry = totals()[mode];
  if (kind === "completion") {
    entry.completions++;
    if (ticks > 0 && (entry.bestTicks < 0 || ticks < entry.bestTicks)) entry.bestTicks = ticks;
  } else if (kind === "death") {
    entry.deaths++;
  }
  save();
}

/** m:ss.cc, as the game shows times. */
function formatTicks(ticks) {
  if (!(ticks > 0)) return "-";
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  const rest = centis % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(rest).padStart(2, "0")}`;
}

function readScoreboard(player, stats) {
  const sender = player.getPacketSender();
  sender.sendInterface(INTERFACE);
  for (const mode of MODES) {
    const { title, first } = PANELS[mode];
    const world = totals()[mode];
    const lines = [
      title,
      "Your Completions:", (stats.completions[mode] ?? 0).toLocaleString(),
      "Global Completions:", world.completions.toLocaleString(),
      "Your Deaths:", (stats.deaths[mode] ?? 0).toLocaleString(),
      "Global Deaths:", world.deaths.toLocaleString(),
      "Your Best Time:", formatTicks(stats.bestTicks?.[mode] ?? -1),
      "Global Best Time:", formatTicks(world.bestTicks),
    ];
    lines.forEach((text, i) => sender.sendString(String(text), (INTERFACE << 16) | (first + i)));
  }
}

/** Tests point the store elsewhere. */
function useFile(next) {
  file = next;
  global = null;
}

module.exports = { INTERFACE, recordGlobal, readScoreboard, formatTicks, totals, useFile };
