"use strict";

/**
 * The Ancient tablet before Amoxliatl's door in the Ruins of Tapoyauik (amoxliatl_scoreboard, which
 * the client shows as amoxliatl_scoreboard_op "Ancient tablet": Read once The Heart of Darkness,
 * varbit vmq3, is complete), interface amoxliatl_scoreboard.
 *
 * Wiki (Ancient tablet (Amoxliatl)): it shows the reader's kill count, deaths and fastest kill,
 * then the world's. The cache labels the rows Personal Killcount / Deaths / Best Time and Global
 * Killcount / Deaths / Best Time, titled "Amoxliatl Statistics". The personal kill count and best
 * time are the ones the kill messages tell (Kills.Amoxliatl.js); a death counts when it happens in
 * her chamber, outside the quest's fight (which isn't a kill either). Numbers and times are
 * written as the Araxxor board's recording shows them ("151,908,082", "2:12.60"); with no time
 * yet the row keeps the cache's own default text, "-".
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.Amoxliatl");
const Chamber = require("./Chamber.Amoxliatl");

/** Cache names: the locs, the interface and its components. */
const SCOREBOARD_LOCS = ["amoxliatl_scoreboard", "amoxliatl_scoreboard_op"];
const INTERFACE_NAME = "amoxliatl_scoreboard";
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const COMPONENT = {
  title: "title_text", kills: "pkc_content", deaths: "pd_content", best: "pbt_content",
  worldKills: "gkc_content", worldDeaths: "gd_content", worldBest: "gbt_content",
};
const TITLE = "Amoxliatl Statistics";
const DEATHS_ATTRIBUTE = "amoxliatl:deaths";

let FILE = path.join(process.cwd(), "data", "saves", "amoxliatl-scoreboard.json");
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
    console.warn(`[amoxliatl] scoreboard could not be saved: ${error.message}`);
  }
}

/** A kill in `ticks`, from Kills.Amoxliatl.js once it has counted the player's own. */
function won(ticks) {
  const totals = records();
  totals.kills++;
  const time = count(ticks);
  if (time && (!totals.bestTicks || time < totals.bestTicks)) totals.bestTicks = time;
  save();
}

const own = (player, key) => count(player.getAttribute(key));

/** A death in her chamber. */
function died(player) {
  player.setAttribute(DEATHS_ATTRIBUTE, own(player, DEATHS_ATTRIBUTE) + 1);
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

/** "Ancient tablet" is also the Tombs of Amascut's (Scabaras): only these locs are ours. */
function read(event) {
  if (!SCOREBOARD_LOCS.some((name) => cache().getLocId(name) === event.objectId)) return false;
  const player = event.player;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of lines(player)) sender.sendString(text, uid(component));
  return true;
}

/**
 * Only a death in her chamber itself, and not in the quest's fight, counts. This hears every
 * death (onPlayerDefeated): onPlayerDeath stops at the first plugin that handles the respawn,
 * as Death's Office does for a first grave.
 */
function diedInChamber({ victim: player }) {
  const session = Chamber.sessionOf(player);
  if (!session || session.quest || player.getPrivateArea() !== session.area) return;
  died(player);
}

function attachScoreboard(api) {
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.onPlayerDefeated(diedInChamber);
  api.onObjectInteraction("Ancient tablet", { Read: read });
}

module.exports = {
  attachScoreboard, won, died, read, diedInChamber, lines, formatTicks,
  SCOREBOARD_LOCS, INTERFACE_NAME, COMPONENT, DEATHS_ATTRIBUTE,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
