"use strict";

/**
 * Eyatlalli's scoreboard (Wiki, Eyatlalli: "Talk-to, Scoreboard" once Perilous Moons is done):
 * the reader's Lunar Chest count and deaths, then the world's chests opened and deaths. The
 * option is the post-quest Eyatlalli's (pmoon_eyatlalli_vis_postquest, op3), and it opens
 * interface perilous_moons_scoreboard, whose cache rows are Personal Chest Count, Personal Deaths,
 * Global Chest Count and Global Deaths under "Perilous Moons Statistics".
 *
 * The chest count is the Lunar Chest's own (Chest.MoonsOfPeril.js counts it on each Claim); a
 * death counts when it happens in a Moon's arena (Arena.MoonsOfPeril.js). No recording
 * reads this board, so the numbers are written as the other boss boards' recordings show them
 * ("84,327,725"; "0" with none).
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.MoonsOfPeril");

/** The Lunar Chest's own count, kept by Chest.MoonsOfPeril.js. */
const CHESTS_ATTRIBUTE = "moons-of-peril:chests";

/** Cache names: the interface and its components. */
const INTERFACE_NAME = "perilous_moons_scoreboard";
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const COMPONENT = { title: "title_text", chests: "pkc_content", deaths: "pd_content", worldChests: "gkc_content", worldDeaths: "gd_content" };
const TITLE = "Perilous Moons Statistics";
const DEATHS_ATTRIBUTE = "moons-of-peril:deaths";

let FILE = path.join(process.cwd(), "data", "saves", "moons-of-peril-scoreboard.json");
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
  world = { chests: count(saved?.chests), deaths: count(saved?.deaths) };
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(records()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.warn(`[moons-of-peril] scoreboard could not be saved: ${error.message}`);
  }
}

/** A Lunar Chest opened, from Chest.MoonsOfPeril.js once it has counted the player's own. */
function chestOpened() {
  records().chests++;
  save();
}

/** A death in a Moon's arena, from Arena.MoonsOfPeril.js. */
function died(player) {
  player.setAttribute(DEATHS_ATTRIBUTE, count(player.getAttribute(DEATHS_ATTRIBUTE)) + 1);
  records().deaths++;
  save();
}

const number = (value) => count(value).toLocaleString("en-US");

function lines(player) {
  const totals = records();
  return new Map([
    [COMPONENT.title, TITLE],
    [COMPONENT.chests, number(player.getAttribute(CHESTS_ATTRIBUTE))],
    [COMPONENT.deaths, number(player.getAttribute(DEATHS_ATTRIBUTE))],
    [COMPONENT.worldChests, number(totals.chests)],
    [COMPONENT.worldDeaths, number(totals.deaths)],
  ]);
}

/** Scoreboard on Eyatlalli: only the post-quest form has the option, so any click is hers. */
function read({ player }) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of lines(player)) sender.sendString(text, uid(component));
  return true;
}

function attachScoreboard(api) {
  api.persistAttribute(DEATHS_ATTRIBUTE, 0);
  api.onNpcInteraction("Eyatlalli", { Scoreboard: read });
}

module.exports = {
  attachScoreboard, chestOpened, died, read, lines,
  INTERFACE_NAME, COMPONENT, DEATHS_ATTRIBUTE, CHESTS_ATTRIBUTE,
  /** Tests: read and write the world records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
