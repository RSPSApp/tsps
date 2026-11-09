"use strict";

/**
 * The Ancient Tablet by the way into the Stranglewood ritual site (vardorvis_scoreboard, which the
 * client shows by varbit dt2_scoreboards: vardorvis_scoreboard_vis "Ancient Tablet": Read at 1,
 * vardorvis_scoreboard_vis_awakened with Read (Awakened) too at 2), interface vardorvis_scoreboard.
 *
 * Wiki (Ancient Tablet (Vardorvis)): it shows the reader's kill count, deaths and fastest kill,
 * then the world's, for the normal fight and, by Read (Awakened), the awakened one. The cache
 * labels the rows Personal Killcount / Deaths / Best Time and Global Killcount / Deaths / Best
 * Time, titled "Vardorvis Statistics". The personal kill counts and best times are the kill
 * messages' own (Fight.Vardorvis.js); a death counts when it happens in the ritual site
 * (Site.Vardorvis.js), while his fight is still on. Like the other DT2 boards it reads only after
 * Desert Treasure II, and it writes their way (docs/leviathan-normal-evidence.md): the counts this
 * server keeps from now on read "N (recorded)", with no invented history, and a missing time
 * "No recorded best". Times are m:ss.cc, as the Araxxor board's recording shows them ("2:12.60").
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.Vardorvis");

/** Cache names: the map loc, its two visible forms, the interface and its components. */
const SCOREBOARD_LOC = "vardorvis_scoreboard";
const VISIBLE_LOCS = ["vardorvis_scoreboard_vis", "vardorvis_scoreboard_vis_awakened"];
const INTERFACE_NAME = "vardorvis_scoreboard";
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const COMPONENT = {
  title: "title_text", kills: "pkc_content", deaths: "pd_content", best: "pbt_content",
  worldKills: "gkc_content", worldDeaths: "gd_content", worldBest: "gbt_content",
};
const TITLE = { normal: "Vardorvis Statistics", awakened: "Vardorvis (Awakened) Statistics" };
const DEATHS_ATTRIBUTE = "vardorvis:deaths";
const AWAKENED_DEATHS_ATTRIBUTE = "vardorvis:awakened-deaths";
const PERSONAL = {
  normal: { kills: Common.KILLS_ATTRIBUTE, deaths: DEATHS_ATTRIBUTE, best: Common.BEST_TICKS_ATTRIBUTE },
  awakened: { kills: Common.AWAKENED_KILLS_ATTRIBUTE, deaths: AWAKENED_DEATHS_ATTRIBUTE, best: Common.AWAKENED_BEST_TICKS_ATTRIBUTE },
};
const MODES = ["normal", "awakened"];

let FILE = path.join(process.cwd(), "data", "saves", "vardorvis-scoreboard.json");
let world = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const cache = () => Common.core.CacheDefinitions;
const uid = (component) => cache().getComponentId(`${INTERFACE_NAME}:${component}`);
const modeOf = (awakened) => (awakened ? "awakened" : "normal");

function records() {
  if (world) return world;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  world = {};
  for (const mode of MODES) {
    const entry = saved?.[mode];
    world[mode] = { kills: count(entry?.kills), deaths: count(entry?.deaths), bestTicks: count(entry?.bestTicks) };
  }
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(records()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.warn(`[vardorvis] scoreboard could not be saved: ${error.message}`);
  }
}

/** A kill in `ticks`, from Fight.Vardorvis.js once it has counted the player's own. */
function won(ticks, awakened) {
  const totals = records()[modeOf(awakened)];
  totals.kills++;
  const time = count(ticks);
  if (time && (!totals.bestTicks || time < totals.bestTicks)) totals.bestTicks = time;
  save();
}

/** A death in the ritual site, from Site.Vardorvis.js. */
function died(player, awakened) {
  const mode = modeOf(awakened);
  const key = PERSONAL[mode].deaths;
  player.setAttribute(key, Common.count(player, key) + 1);
  records()[mode].deaths++;
  save();
}

const number = (value) => count(value).toLocaleString("en-US");

const recorded = (value) => `${number(value)} (recorded)`;

/** m:ss.cc, as the board shows times; "No recorded best" with none, as the other DT2 boards. */
function formatTicks(ticks) {
  const centis = count(ticks) * 60;
  if (!centis) return "No recorded best";
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function lines(player, mode) {
  const totals = records()[mode];
  const own = PERSONAL[mode];
  return new Map([
    [COMPONENT.title, TITLE[mode]],
    [COMPONENT.kills, number(player.getAttribute(own.kills))],
    [COMPONENT.deaths, recorded(player.getAttribute(own.deaths))],
    [COMPONENT.best, formatTicks(player.getAttribute(own.best))],
    [COMPONENT.worldKills, recorded(totals.kills)],
    [COMPONENT.worldDeaths, recorded(totals.deaths)],
    [COMPONENT.worldBest, formatTicks(totals.bestTicks)],
  ]);
}

const ours = (objectId) => [SCOREBOARD_LOC, ...VISIBLE_LOCS].some((name) => cache().getLocId(name) === objectId);

function questComplete(player) {
  const request = { player, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function show(event, mode) {
  if (!ours(event.objectId) || !questComplete(event.player)) return false;
  const sender = event.player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of lines(event.player, mode)) sender.sendString(text, uid(component));
  return true;
}

/** "Ancient Tablet": Read. */
function read(event) {
  return show(event, "normal");
}

/** "Ancient Tablet": Read (Awakened). */
function readAwakened(event) {
  return show(event, "awakened");
}

/**
 * As the other DT2 boards do (Site.Leviathan.js): a click whose definition kept the map loc's
 * null name still reads, restricted to this map loc and its first option.
 */
function readParent(event) {
  if (event.objectId !== cache().getLocId(SCOREBOARD_LOC) || event.clickType !== 1) return;
  if (read(event)) event.handled = true;
}

function attachScoreboard(api) {
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.persistAttribute(AWAKENED_DEATHS_ATTRIBUTE, 0);
  api.onBeforeObjectInteraction(readParent);
  api.onObjectInteraction("Ancient Tablet", { Read: read, "Read (Awakened)": readAwakened });
}

module.exports = {
  attachScoreboard, won, died, read, readAwakened, lines, formatTicks,
  SCOREBOARD_LOC, VISIBLE_LOCS, INTERFACE_NAME, COMPONENT, DEATHS_ATTRIBUTE, AWAKENED_DEATHS_ATTRIBUTE,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
