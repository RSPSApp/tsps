"use strict";

/**
 * Elder Nama's scoreboard (Wiki: Shellbane_gryphon "acts as a scoreboard for the boss,
 * displaying the player's statistics for the fight as well as global statistics"; Elder_Nama:
 * Talk-to, Statistics). The cache interface gryphon_boss is titled "Shellbane Gryphon
 * Statistics" and labels its rows Personal Killcount / Deaths / Best Time and Global Killcount /
 * Deaths / Best Time. It writes the way the DT2 boards do (Scoreboard.Vardorvis.js,
 * docs/leviathan-normal-evidence.md): the kill count is the saved one the kill message counts,
 * the counts this server only keeps from now on read "N (recorded)", with no invented history,
 * and a missing time "No recorded best". Times are m:ss.cc, as the Wiki's global best ("0:09.00").
 * A kill's time runs from the gryphon appearing on its nest to its death (the Wiki gives no
 * start point). A death counts when it happens in the cave while the gryphon is up.
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.ShellbaneGryphon");

const INTERFACE_NAME = "gryphon_boss";
/** toplevel_mainmodal_open (-1, -1), run before the board as the other boss boards do. */
const SCRIPT_MAINMODAL_OPEN = 2524;
const COMPONENT = {
  kills: "pkc_content", deaths: "pd_content", best: "pbt_content",
  worldKills: "gkc_content", worldDeaths: "gd_content", worldBest: "gbt_content",
};
const DEATHS_ATTRIBUTE = "shellbane-gryphon:deaths";
const BEST_TICKS_ATTRIBUTE = "shellbane-gryphon:best-ticks";

let FILE = path.join(process.cwd(), "data", "saves", "shellbane-gryphon-scoreboard.json");
let world = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const uid = (component) => Common.core.CacheDefinitions.getComponentId(`${INTERFACE_NAME}:${component}`);

function records() {
  if (world) return world;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  world = { kills: count(saved?.kills), deaths: count(saved?.deaths), bestTicks: count(saved?.bestTicks) };
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(records()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.warn(`[ShellbaneGryphon] scoreboard could not be saved: ${error.message}`);
  }
}

/** A kill in `ticks`, from Kills.ShellbaneGryphon.js once it has counted the player's own. */
function won(player, ticks) {
  const time = count(ticks);
  const own = count(player.getAttribute(BEST_TICKS_ATTRIBUTE));
  if (time && (!own || time < own)) player.setAttribute(BEST_TICKS_ATTRIBUTE, time);
  const totals = records();
  totals.kills++;
  if (time && (!totals.bestTicks || time < totals.bestTicks)) totals.bestTicks = time;
  save();
}

/** A death in the cave while the gryphon is up. */
function died(player) {
  player.setAttribute(DEATHS_ATTRIBUTE, count(player.getAttribute(DEATHS_ATTRIBUTE)) + 1);
  records().deaths++;
  save();
}

const number = (value) => count(value).toLocaleString("en-US");
const recorded = (value) => `${number(value)} (recorded)`;

/** m:ss.cc; "No recorded best" with none, as the other boss boards. */
function formatTicks(ticks) {
  const centis = count(ticks) * 60;
  if (!centis) return "No recorded best";
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function lines(player) {
  const totals = records();
  return new Map([
    [COMPONENT.kills, number(player.getAttribute(Common.KILLS_ATTRIBUTE))],
    [COMPONENT.deaths, recorded(player.getAttribute(DEATHS_ATTRIBUTE))],
    [COMPONENT.best, formatTicks(player.getAttribute(BEST_TICKS_ATTRIBUTE))],
    [COMPONENT.worldKills, recorded(totals.kills)],
    [COMPONENT.worldDeaths, recorded(totals.deaths)],
    [COMPONENT.worldBest, formatTicks(totals.bestTicks)],
  ]);
}

/** Opens the board for `player`. */
function show(player) {
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(Common.core.CacheDefinitions.getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of lines(player)) sender.sendString(text, uid(component));
}

function attachScoreboard(api) {
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.persistAttribute(BEST_TICKS_ATTRIBUTE, 0);
}

module.exports = {
  attachScoreboard, won, died, show, lines, formatTicks, INTERFACE_NAME, COMPONENT,
  DEATHS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
