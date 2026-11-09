"use strict";

/**
 * The scoreboard outside Araxxor's lair (54270, a scroll until varp total_araxxor_kills is set,
 * then "Scoreboard": Read), interface 591.
 *
 * rsprox 237/01075, 237/01076 and 224/01453: Read opens 591 with the title "Araxxor Statistics"
 * (6), the personal kill count (9), deaths (11) and best time (13), then the world's kill count
 * (15), deaths (17) and best time (19), as "151,908,082"-style numbers and "2:12.60" times.
 * The personal kill count and best time are the ones the kill messages tell (Corpse.Araxxor.js);
 * a death counts when it happens inside the lair.
 */

const fs = require("node:fs");
const path = require("node:path");
const Shared = require("./Shared.Araxxor");
const Area = require("./Area.Araxxor");

/** Cache names: the loc, interface araxxor_scoreboard and its components (rsprox 237/01076). */
const SCOREBOARD_LOC = "araxxor_scoreboard_multi";
const INTERFACE_NAME = "araxxor_scoreboard";
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const COMPONENT = {
  title: "title_text", kills: "pkc_content", deaths: "pd_content", best: "pbt_content",
  worldKills: "gkc_content", worldDeaths: "gd_content", worldBest: "gbt_content",
};
const TITLE = "Araxxor Statistics";
const DEATHS_ATTRIBUTE = "araxxor:deaths";

let FILE = path.join(process.cwd(), "data", "saves", "araxxor-scoreboard.json");
let world = null;
let cache = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const uid = (component) => cache.getComponentId(`${INTERFACE_NAME}:${component}`);

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
    fs.writeFileSync(FILE, JSON.stringify(records()));
  } catch (error) {
    console.warn(`[araxxor] scoreboard could not be saved: ${error.message}`);
  }
}

/** A kill in `ticks`, from Corpse.Araxxor.js's recordKill. */
function won(ticks) {
  const totals = records();
  totals.kills++;
  const time = count(ticks);
  if (time && (!totals.bestTicks || time < totals.bestTicks)) totals.bestTicks = time;
  save();
}

function diedInLair({ player }) {
  if (!Area.insideLair(player?.getLocation?.())) return;
  player.setAttribute(DEATHS_ATTRIBUTE, count(player.getAttribute(DEATHS_ATTRIBUTE)) + 1);
  records().deaths++;
  save();
}

const number = (value) => count(value).toLocaleString("en-US");

/** m:ss.cc, as the board shows times; "-" with none. */
function formatTicks(ticks) {
  const centis = count(ticks) * 60;
  if (!centis) return "-";
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function lines(player) {
  const totals = records();
  return new Map([
    [COMPONENT.title, TITLE],
    [COMPONENT.kills, number(player.getAttribute(Shared.ATTR_KILLS))],
    [COMPONENT.deaths, number(player.getAttribute(DEATHS_ATTRIBUTE))],
    [COMPONENT.best, formatTicks(player.getAttribute(Shared.ATTR_BEST_TICKS))],
    [COMPONENT.worldKills, number(totals.kills)],
    [COMPONENT.worldDeaths, number(totals.deaths)],
    [COMPONENT.worldBest, formatTicks(totals.bestTicks)],
  ]);
}

/** "Scoreboard" is also Duke's, Leviathan's and the Whisperer's: only this loc is ours. */
function read(event) {
  if (event.objectId !== cache.getLocId(SCOREBOARD_LOC)) return false;
  const player = event.player;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache.getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of lines(player)) sender.sendString(text, uid(component));
  return true;
}

function attach(api) {
  cache = api.core.CacheDefinitions;
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.onPlayerDeath(diedInLair);
  api.onObjectInteraction("Scoreboard", { Read: read });
}

module.exports = {
  attach, won, diedInLair, read, lines, formatTicks,
  SCOREBOARD_LOC, INTERFACE_NAME, COMPONENT, DEATHS_ATTRIBUTE, uid,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
