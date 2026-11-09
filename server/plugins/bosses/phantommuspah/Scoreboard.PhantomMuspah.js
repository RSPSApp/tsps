"use strict";

/**
 * The scoreboard by the Muspah's crevice in the Ghorrock Dungeon (muspah_scoreboard_multi, which
 * the client shows as muspah_scoreboard "Scoreboard": Read once varbit sotn reaches 90, Secrets of
 * the North complete), interface muspah_scoreboard.
 *
 * Wiki (Scoreboard (Phantom Muspah)): it shows the reader's kill count, deaths and fastest kill,
 * then the world's. The cache labels the rows Personal Killcount / Deaths / Best Time and Global
 * Killcount / Deaths / Best Time, titled "Phantom Muspah Statistics". The personal kill count and
 * best time are the ones the kill messages tell (Loot.PhantomMuspah.js); a death counts when it
 * is in the lair (Lair.PhantomMuspah.js). Numbers and times are written as the Araxxor board's
 * recording shows them ("151,908,082", "2:12.60"); with no time the row keeps the cache's own
 * default text, "-".
 *
 * The cache places the board as a straight wall decoration (shape 4, rotation 0) on the cave
 * rock's west face at 2914,10317; its own tile is rock, so the shared wall-decoration reach
 * (its own tile) has nowhere to stand. It is read from the open
 * floor in front of it, the tile west of it, so the route goes there.
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.PhantomMuspah");

/** Cache names: the locs, the interface and its components. */
const SCOREBOARD_LOCS = ["muspah_scoreboard_multi", "muspah_scoreboard"];
const INTERFACE_NAME = "muspah_scoreboard";
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const COMPONENT = {
  title: "title_text", kills: "pkc_content", deaths: "pd_content", best: "pbt_content",
  worldKills: "gkc_content", worldDeaths: "gd_content", worldBest: "gbt_content",
};
const TITLE = "Phantom Muspah Statistics";
const DEATHS_ATTRIBUTE = "phantom-muspah:deaths";

let FILE = path.join(process.cwd(), "data", "saves", "phantom-muspah-scoreboard.json");
let world = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const cache = () => Common.core.CacheDefinitions;
const uid = (component) => cache().getComponentId(`${INTERFACE_NAME}:${component}`);

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
    console.warn(`[phantom-muspah] scoreboard could not be saved: ${error.message}`);
  }
}

/** A kill in `ticks`, from Loot.PhantomMuspah.js once it has counted the player's own. */
function won(ticks) {
  const totals = records();
  totals.kills++;
  const time = count(ticks);
  if (time && (!totals.bestTicks || time < totals.bestTicks)) totals.bestTicks = time;
  save();
}

/** A death in the lair, from Lair.PhantomMuspah.js. */
function died(player) {
  player.setAttribute(DEATHS_ATTRIBUTE, Common.count(player, DEATHS_ATTRIBUTE) + 1);
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
    [COMPONENT.kills, number(player.getAttribute(Common.KILLS_ATTRIBUTE))],
    [COMPONENT.deaths, number(player.getAttribute(DEATHS_ATTRIBUTE))],
    [COMPONENT.best, formatTicks(player.getAttribute(Common.BEST_TICKS_ATTRIBUTE))],
    [COMPONENT.worldKills, number(totals.kills)],
    [COMPONENT.worldDeaths, number(totals.deaths)],
    [COMPONENT.worldBest, formatTicks(totals.bestTicks)],
  ]);
}

/** "Scoreboard" is many bosses' name: only these locs are ours. */
function read(event) {
  if (!SCOREBOARD_LOCS.some((name) => cache().getLocId(name) === event.objectId)) return false;
  const player = event.player;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of lines(player)) sender.sendString(text, uid(component));
  return true;
}

/** Across the wall edge the decoration hangs on, by its rotation (0 west, 1 north, 2 east, 3 south). */
const FRONT = [[-1, 0], [0, 1], [1, 0], [0, -1]];

function routeToFront(event) {
  if (!SCOREBOARD_LOCS.some((name) => cache().getLocId(name) === event.objectId)) return;
  const { object } = event;
  const [dx, dy] = FRONT[object.getFace() & 3];
  const at = object.getLocation();
  event.destination = { x: at.getX() + dx, y: at.getY() + dy, z: at.getZ() };
}

function attachScoreboard(api) {
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.onObjectRoute(routeToFront);
  api.onObjectInteraction("Scoreboard", { Read: read });
}

module.exports = {
  attachScoreboard, won, died, read, routeToFront, lines, formatTicks,
  SCOREBOARD_LOCS, INTERFACE_NAME, COMPONENT, DEATHS_ATTRIBUTE,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
