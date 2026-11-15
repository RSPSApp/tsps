"use strict";

/**
 * The scoreboard by TzHaar-Ket-Rak (jad_challenge_scoreboard, "Scoreboard": Read), interface
 * jad_challenge_scoreboard: one scrolling text the client's jad_challenge_setup script lays out.
 *
 * rsprox 227/00216 (and 00234, 00223; 00190 has the click only, the board never opened): Read runs toplevel_mainmodal_open [-1, -1], opens
 * the interface on the main modal and runs jad_challenge_setup with a single string, a block per
 * challenge separated by "<br><br><br>":
 *   "TzHaar-Ket-Rak's First Challenge<br><br>Personal Completions: 3<br>Global Completions: -<br><br>
 *    Personal Best Time: 0:34.20<br>Global Best Time: -<br><br>Personal Deaths: 0<br>Global Deaths: -"
 * for the First to Sixth, then "TzHaar-Ket-Rak's Infinite Challenge" with Personal/Global Best
 * Kills and Deaths. Those recordings are a Leagues world: every Global line is "-" and a
 * League-Only Challenge block follows. The Wiki (Scoreboard (TzHaar-Ket-Rak)) gives the main
 * game's world numbers ("560,052" completions, "0:06.00" best time), so the world's lines are
 * kept here and the League-Only block is left out.
 *
 * A completion and its time are the ones the completion lines tell (Rewards.TzHaarKetRak.js);
 * a death counts when the player dies in a challenge after the Jads arrive and before the last
 * one falls (a death during the fade in, before they arrive, is not a challenge death). The Infinite
 * Challenge's block counts its deaths (it ends in one) and its most Jads killed in a run.
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.TzHaarKetRak");

/** Cache names: the loc and the interface. */
const SCOREBOARD_LOC = "jad_challenge_scoreboard";
const INTERFACE_NAME = "jad_challenge_scoreboard";
/** Clientscripts the recording runs: toplevel_mainmodal_open and jad_challenge_setup. */
const SCRIPT = { MAINMODAL_OPEN: 2524, SETUP: 4023 };
/** Per challenge (1-6): the player's deaths in it. */
const DEATHS_ATTRIBUTE = "tzhaar-ket-rak:deaths";

let FILE = path.join(process.cwd(), "data", "saves", "tzhaar-ket-rak-scoreboard.json");
let world = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const cache = () => Common.core.CacheDefinitions;

function perChallenge(saved, last = Common.SIX) {
  const out = {};
  for (let challenge = 1; challenge <= last; challenge++) out[challenge] = count(saved?.[challenge]);
  return out;
}

function records() {
  if (world) return world;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  world = {
    completions: perChallenge(saved?.completions),
    bestTicks: perChallenge(saved?.bestTicks),
    deaths: perChallenge(saved?.deaths, Common.INFINITE),
    infiniteBestKills: count(saved?.infiniteBestKills),
  };
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(records()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.warn(`[tzhaar-ket-rak] scoreboard could not be saved: ${error.message}`);
  }
}

const validChallenge = (number) => Number.isInteger(number) && number >= 1 && number <= Common.SIX;

/** Challenge `number` completed in `ticks`, from Rewards.TzHaarKetRak.js's lastJadDown. */
function completed(number, ticks) {
  if (!validChallenge(number)) return;
  const totals = records();
  totals.completions[number]++;
  const time = count(ticks);
  if (time && (!totals.bestTicks[number] || time < totals.bestTicks[number])) totals.bestTicks[number] = time;
  save();
}

/** An Infinite Challenge run ended with `kills` Jads killed: the world's best if more. */
function infiniteRun(kills) {
  const totals = records();
  if (count(kills) <= totals.infiniteBestKills) return;
  totals.infiniteBestKills = count(kills);
  save();
}

function deathsOf(player) {
  const deaths = player.getAttribute(DEATHS_ATTRIBUTE);
  return deaths && typeof deaths === "object" ? { ...deaths } : {};
}

/** The player died in challenge `number` (the Infinite Challenge too) before its last Jad fell. */
function died(player, number) {
  if (!validChallenge(number) && number !== Common.INFINITE) return;
  const deaths = deathsOf(player);
  deaths[number] = count(deaths[number]) + 1;
  player.setAttribute(DEATHS_ATTRIBUTE, deaths);
  records().deaths[number]++;
  save();
}

const number = (value) => count(value).toLocaleString("en-US");

/** m:ss.cc, as the board shows times ("0:34.20"); "-" with none. */
function formatTicks(ticks) {
  const centis = count(ticks) * 60;
  if (!centis) return "-";
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

/** The string jad_challenge_setup lays out, as the recording sends it. */
function text(player) {
  const totals = records();
  const times = player.getAttribute(Common.BEST_TIMES_ATTRIBUTE);
  const best = times && typeof times === "object" ? times : {};
  const deaths = deathsOf(player);
  const blocks = [];
  for (let challenge = 1; challenge <= Common.SIX; challenge++) {
    blocks.push([
      `TzHaar-Ket-Rak's ${Common.data.ordinals[challenge - 1]} Challenge`,
      `Personal Completions: ${number(Common.completions(player, challenge))}<br>Global Completions: ${number(totals.completions[challenge])}`,
      `Personal Best Time: ${formatTicks(best[challenge])}<br>Global Best Time: ${formatTicks(totals.bestTicks[challenge])}`,
      `Personal Deaths: ${number(deaths[challenge])}<br>Global Deaths: ${number(totals.deaths[challenge])}`,
    ].join("<br><br>"));
  }
  blocks.push([
    "TzHaar-Ket-Rak's Infinite Challenge",
    `Personal Best Kills: ${number(player.getAttribute(Common.INFINITE_BEST_ATTRIBUTE))}<br>Global Best Kills: ${number(totals.infiniteBestKills)}`,
    `Personal Deaths: ${number(deaths[Common.INFINITE])}<br>Global Deaths: ${number(totals.deaths[Common.INFINITE])}`,
  ].join("<br><br>"));
  return blocks.join("<br><br><br>");
}

/** "Scoreboard" is many bosses' name: only this loc is ours. */
function read(event) {
  if (event.objectId !== cache().getLocId(SCOREBOARD_LOC)) return false;
  const player = event.player;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT.MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  sender.sendInterfaceScript(SCRIPT.SETUP, [text(player)]);
  return true;
}

function attach(api) {
  api.persistAttribute(DEATHS_ATTRIBUTE, {});
  api.onObjectInteraction("Scoreboard", { Read: read });
}

module.exports = {
  attach, completed, died, infiniteRun, read, text, formatTicks,
  SCOREBOARD_LOC, INTERFACE_NAME, SCRIPT, DEATHS_ATTRIBUTE,
  /** The world's records, as the board reads them. */
  worldRecords: () => records(),
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
