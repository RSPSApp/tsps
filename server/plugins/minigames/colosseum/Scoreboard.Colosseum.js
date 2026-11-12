"use strict";

/**
 * The lobby's Colosseum scoreboard (50747: View, View-stats, View-glory), interface 867.
 *
 * rsprox 237/04109: View-stats opens 867 with the glory panel (4) hidden and the stats panel (5)
 * shown, the title "Colosseum Statistics", and the server filling every value: waves completed
 * (10), Sol Heredit kill count (12), deaths (14), best time (16, "-" with none), then the same
 * four for the world (18, 20, 22, 24) as "1,727,332"-style numbers and "13:55.20" times.
 * View-glory shows panel 4 instead: the Glory title (36, "Rookie"), personal best Glory (38),
 * the world's best Glory (44), and the six title perks in two lists (40, 41), each perk greyed
 * (<col=999999>) until its title is reached.
 *
 * Not recorded: what View (op1) shows (the recording clicked View-stats a tick later), so it
 * shows the stats; and how an unlocked perk is drawn, so it is written without the grey.
 * Best time is a whole run's wave time, as the run's speed tasks count it.
 */

const fs = require("node:fs");
const path = require("node:path");
const Shared = require("./Shared.Colosseum");
const Sol = require("./SolHeredit.Colosseum");

/** Interface colosseum_scoreboard and its components, by their cache names (rsprox 237/04109). */
const INTERFACE_NAME = "colosseum_scoreboard";
const PANEL = { GLORY: "glory_content", STATS: "stats_content" };
const STATS = {
  title: "title_text", waves: "pkc2_content", kills: "pkc_content", deaths: "pd_content", best: "pbt_content",
  worldWaves: "gkc2_content", worldKills: "gkc_content", worldDeaths: "gd_content", worldBest: "gbt_content",
};
const GLORY = {
  title: "glory_title_text", personal: "glory_number_text", world: "glory_number_text_global",
  perksFirst: "glory_rewards_unlock_1", perksSecond: "glory_rewards_unlock_2",
};
const TITLE = "Colosseum Statistics";
const LOCKED = "999999";
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;


/** The titles' perks as the board lists them (rsprox 237/04109), with the Glory each needs (Wiki). */
const PERKS = [
  [[2000, "Bank access at the Colosseum."], [5000, "Fortis respawn point."],
    [8000, "Improved price for stolen goods."], [12000, "Colosseum Ring of Dueling teleport."]],
  [[16000, "Fortis herb patch protection."], [20000, "Fortis Salute emote."]],
];

/** Sol Heredit's kills are SolHeredit.Colosseum.js's own count (it decides his greeting). */
const ATTR = {
  WAVES: "colosseum:waves-completed",
  DEATHS: "colosseum:deaths",
  BEST: "colosseum:best-ticks",
};

let FILE = path.join(process.cwd(), "data", "saves", "colosseum-scoreboard.json");
let world = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const cache = () => Shared.core().CacheDefinitions;
const uid = (component) => cache().getComponentId(`${INTERFACE_NAME}:${component}`);

function records() {
  if (world) return world;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  world = {
    waves: count(saved?.waves), kills: count(saved?.kills), deaths: count(saved?.deaths),
    bestTicks: count(saved?.bestTicks), bestGlory: count(saved?.bestGlory),
  };
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(records()));
  } catch (error) {
    console.warn(`[colosseum] scoreboard could not be saved: ${error.message}`);
  }
}

function bump(player, attribute) {
  player.setAttribute(attribute, count(player.getAttribute(attribute)) + 1);
}

/** A wave cleared, Sol Heredit's included. */
function waveCompleted(run) {
  bump(run.player, ATTR.WAVES);
  records().waves++;
  save();
}

/** Sol Heredit beaten (his module has counted the kill): the run's time against the bests. */
function solDefeated(run) {
  const player = run.player;
  const ticks = count(run.totalTicks);
  const best = count(player.getAttribute(ATTR.BEST));
  if (ticks && (!best || ticks < best)) player.setAttribute(ATTR.BEST, ticks);
  const totals = records();
  totals.kills++;
  if (ticks && (!totals.bestTicks || ticks < totals.bestTicks)) totals.bestTicks = ticks;
  save();
}

function died(run) {
  bump(run.player, ATTR.DEATHS);
  records().deaths++;
  save();
}

/** A run's Glory was kept: the world's best rises with it. */
function gloryKept(run) {
  const glory = count(Math.trunc(Number(run.glory) || 0));
  const totals = records();
  if (glory <= totals.bestGlory) return;
  totals.bestGlory = glory;
  save();
}

const number = (value) => count(value).toLocaleString("en-US");

/** m:ss.cc, as the board shows times; "-" with none (rsprox 237/04109). */
function formatTicks(ticks) {
  const centis = count(ticks) * 60;
  if (!centis) return "-";
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function perkList(perks, glory) {
  return perks.map(([required, text], index) => {
    const line = `- ${text}${index < perks.length - 1 ? "<br>" : ""}`;
    return glory >= required ? line : `<col=${LOCKED}>${line}</col>`;
  }).join("");
}

function statLines(player) {
  const totals = records();
  return new Map([
    [STATS.title, TITLE],
    [STATS.waves, number(player.getAttribute(ATTR.WAVES))],
    [STATS.kills, number(player.getAttribute(Sol.ATTR.KILLS))],
    [STATS.deaths, number(player.getAttribute(ATTR.DEATHS))],
    [STATS.best, formatTicks(player.getAttribute(ATTR.BEST))],
    [STATS.worldWaves, number(totals.waves)],
    [STATS.worldKills, number(totals.kills)],
    [STATS.worldDeaths, number(totals.deaths)],
    [STATS.worldBest, formatTicks(totals.bestTicks)],
  ]);
}

function gloryLines(player) {
  const glory = Shared.gloryOf(player);
  return new Map([
    [GLORY.title, Shared.rankOf(player)],
    [GLORY.personal, number(glory)],
    [GLORY.world, number(Math.max(records().bestGlory, glory))],
    [GLORY.perksFirst, perkList(PERKS[0], glory)],
    [GLORY.perksSecond, perkList(PERKS[1], glory)],
  ]);
}

function show(player, panel) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  sender.sendInterfaceDisplayState(uid(PANEL.GLORY), panel !== PANEL.GLORY);
  sender.sendInterfaceDisplayState(uid(PANEL.STATS), panel !== PANEL.STATS);
  const lines = panel === PANEL.GLORY ? gloryLines(player) : statLines(player);
  for (const [component, text] of lines) sender.sendString(text, uid(component));
}

function viewStats({ player }) {
  show(player, PANEL.STATS);
  return true;
}

function viewGlory({ player }) {
  show(player, PANEL.GLORY);
  return true;
}

module.exports = function registerColosseumScoreboard(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR.WAVES, 0);
  api.persistAttribute(ATTR.DEATHS, 0);
  api.persistAttribute(ATTR.BEST, 0);
  api.onObjectInteraction("Colosseum scoreboard", { View: viewStats, "View-stats": viewStats, "View-glory": viewGlory });
};

Object.assign(module.exports, {
  INTERFACE_NAME, PANEL, STATS, GLORY, ATTR, uid,
  waveCompleted, solDefeated, died, gloryKept, formatTicks, show, viewStats, viewGlory,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
});
