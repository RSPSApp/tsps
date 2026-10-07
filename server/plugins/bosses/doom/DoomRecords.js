"use strict";

/**
 * Personal and world records for the scoreboard: completions and best times per delve level
 * ("8+" for deep delves), deaths, the deepest delve and the best time from delve 1 to 8.
 *
 * Personal records are player attributes (persisted by Delve.*); the world's are kept in
 * data/saves/doom-scoreboard.json, as plugins have no world store (as for the Gauntlet's).
 */

const fs = require("fs");
const path = require("path");

const ATTR = {
  COMPLETIONS: "doom:completions",
  DEEPEST: "doom:deepest",
  BEST: "doom:best",
  BEST_RUN: "doom:best-run",
  DEATHS: "doom:deaths",
};

const file = path.join(process.cwd(), "data", "saves", "doom-scoreboard.json");
let world = null;
let persist = true;

function empty() {
  return { completions: {}, best: {}, deaths: 0, deepest: 0, bestRun: 0 };
}

function worldRecords() {
  if (world) return world;
  world = empty();
  try {
    Object.assign(world, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    // No file yet, or unreadable: start from zero.
  }
  return world;
}

function save() {
  if (!persist) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(worldRecords(), null, 2));
  } catch (error) {
    console.warn("[doom] could not save the scoreboard", error?.message ?? error);
  }
}

function levelKey(level) {
  return level > 8 ? "8+" : String(level);
}

function better(current, ticks) {
  return ticks > 0 && (!(current > 0) || ticks < current);
}

function count(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

/** A delve completed in `ticks`; `runTicks` is set when it finished a run from delve 1 to 8. */
function completed(player, level, ticks, runTicks = 0) {
  const key = levelKey(level);
  const completions = { ...(player.getAttribute(ATTR.COMPLETIONS) ?? {}) };
  count(completions, key);
  player.setAttribute(ATTR.COMPLETIONS, completions);
  const best = { ...(player.getAttribute(ATTR.BEST) ?? {}) };
  if (better(best[key], ticks)) best[key] = ticks;
  player.setAttribute(ATTR.BEST, best);
  if (level > (Number(player.getAttribute(ATTR.DEEPEST)) || 0)) player.setAttribute(ATTR.DEEPEST, level);
  if (better(Number(player.getAttribute(ATTR.BEST_RUN)), runTicks)) player.setAttribute(ATTR.BEST_RUN, runTicks);

  const records = worldRecords();
  count(records.completions, key);
  if (better(records.best[key], ticks)) records.best[key] = ticks;
  records.deepest = Math.max(records.deepest, level);
  if (better(records.bestRun, runTicks)) records.bestRun = runTicks;
  save();
}

function died(player) {
  player.setAttribute(ATTR.DEATHS, (Number(player.getAttribute(ATTR.DEATHS)) || 0) + 1);
  worldRecords().deaths++;
  save();
}

function personal(player) {
  return {
    completions: player.getAttribute(ATTR.COMPLETIONS) ?? {},
    best: player.getAttribute(ATTR.BEST) ?? {},
    deaths: Number(player.getAttribute(ATTR.DEATHS)) || 0,
    deepest: Number(player.getAttribute(ATTR.DEEPEST)) || 0,
    bestRun: Number(player.getAttribute(ATTR.BEST_RUN)) || 0,
  };
}

/** For tests: forget the world's records and keep them in memory only. */
function resetWorld() {
  world = empty();
  persist = false;
}

module.exports = { ATTR, completed, died, personal, worldRecords, levelKey, resetWorld };
