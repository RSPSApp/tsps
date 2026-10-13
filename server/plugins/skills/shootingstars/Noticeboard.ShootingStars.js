"use strict";

/**
 * The Shooting Star Noticeboard at the Observatory (Wiki): Read lists the last five stars that
 * landed on the world, oldest first, with who found each, and how many the reader has found.
 * The interface is the cache's star_noticeboard (47); the text follows the Wiki's screenshot
 * ("8 hour 41 minutes ago", "Stars Personally Found: 2"). Not captured.
 *
 * The world's list is kept in data/saves/shooting-stars.json, as plugins have no world store.
 */

const fs = require("fs");
const path = require("path");
const Common = require("./Common.ShootingStars");

const { DATA } = Common;
const board = DATA.noticeboard;
const file = path.join(process.cwd(), "data", "saves", "shooting-stars.json");

let records = null;
let persist = true;

function load() {
  if (records) return records;
  records = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(saved?.stars)) records = saved.stars.slice(-board.size);
  } catch {
    // No file yet, or unreadable: an empty board.
  }
  return records;
}

function save() {
  if (!persist) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ stars: load() }, null, 2));
  } catch (error) {
    console.warn("[shooting-stars] could not save the noticeboard", error?.message ?? error);
  }
}

/** A star landed: it goes on the board, undiscovered. */
function landed({ star }) {
  const list = load();
  list.push({ landedAt: star.landedAt, finder: null });
  while (list.length > board.size) list.shift();
  save();
}

/** Its finder goes beside it, and they have found one more star. */
function discovered(player, star) {
  const entry = load().find((record) => record.landedAt === star.landedAt);
  if (entry) {
    entry.finder = player.getUsername();
    save();
  }
  const found = Number(player.getAttribute(Common.STARS_FOUND_ATTRIBUTE)) || 0;
  player.setAttribute(Common.STARS_FOUND_ATTRIBUTE, found + 1);
}

function ago(landedAt, now) {
  const minutes = Math.max(0, Math.floor((now - landedAt) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} hour ${minutes % 60} minutes ago` : `${minutes} minutes ago`;
}

function lines(player, now = Date.now()) {
  const list = load();
  return {
    times: board.landingTimes.map((_, row) => (list[row] ? ago(list[row].landedAt, now) : "")),
    finders: board.finders.map((_, row) => (list[row] ? list[row].finder ?? "" : "")),
    personal: `Stars Personally Found: ${Number(player.getAttribute(Common.STARS_FOUND_ATTRIBUTE)) || 0}`,
  };
}

function read({ player }) {
  const sender = player.getPacketSender();
  const { times, finders, personal } = lines(player);
  sender.sendInterface(board.interface);
  board.landingTimes.forEach((component, row) => sender.sendString(times[row], (board.interface << 16) | component));
  board.finders.forEach((component, row) => sender.sendString(finders[row], (board.interface << 16) | component));
  sender.sendString(personal, (board.interface << 16) | board.personalCount);
}

module.exports = function attachNoticeboard(api) {
  api.onObjectInteraction("Shooting Star Noticeboard", { Read: read });
  api.onCustomEvent("shooting-stars:landed", landed);
};

Object.assign(module.exports, {
  landed,
  discovered,
  lines,
  ago,
  read,
  /** Tests: start from an empty board and never touch the save file. */
  resetForTests() {
    records = [];
    persist = false;
  },
});
