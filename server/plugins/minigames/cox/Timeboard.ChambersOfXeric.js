"use strict";

/**
 * The Challenge Timeboard: the five fastest Challenge Mode completions on this world, with the
 * team leader, and the fastest time for every team size.
 *
 * Wiki (Score board (Chambers of Xeric)): a "Score board" (32544, Read, "See challenge mode
 * scores here.") stands on Mount Quidamortem by the raid's entrance, at (1224, 3565) and
 * (1243, 3563). It shows Challenge Mode scores; the Wiki lists its best times by team size as
 * Solo, 2..10, 11-15, 16-23 and 24+.
 * rsprox 3389: at completion the game sends
 * "<col=ef20ff>Your team has made it onto this world's Challenge Timeboard!</col>" as a
 * friendschatnotification, after the target-time message and before "Congratulations...".
 * Not in the cache and not in a capture: the board's interface. The cache has no interface
 * named for it, and no recording reads the board, so its layout here is guessed: a message
 * box listing this world's five times and the best of each team size. The records themselves
 * (saves in data/saves/cox-timeboard.json), the five-entry cut and the message follow the
 * Wiki and 3389.
 */

const fs = require("fs");
const path = require("path");
const Shared = require("./Shared.ChambersOfXeric");

/** Cache: the score board on Mount Quidamortem (Read). */
const LOC = 32544;
const TOP = 5;
const TITLE = "Challenge Mode Timeboard";
const MADE_IT = "<col=ef20ff>Your team has made it onto this world's Challenge Timeboard!</col>";

let FILE = path.join(process.cwd(), "data", "saves", "cox-timeboard.json");
let board = null;

/** The team-size brackets the Wiki's table has. */
function bracket(size) {
  if (size <= 1) return "Solo";
  if (size <= 10) return String(size);
  if (size <= 15) return "11-15";
  if (size <= 23) return "16-23";
  return "24+";
}

function empty() {
  return { world: [], global: {} };
}

function records() {
  if (board) return board;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  const entries = Array.isArray(saved?.world)
    ? saved.world.filter((entry) => Number.isFinite(entry?.ticks) && entry.ticks > 0)
    : [];
  entries.sort((a, b) => a.ticks - b.ticks);
  board = {
    world: entries.slice(0, TOP).map((entry) => ({ ticks: entry.ticks, leader: String(entry.leader ?? ""), size: Number(entry.size) || 1 })),
    global: typeof saved?.global === "object" && saved.global ? { ...saved.global } : {},
  };
  return board;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(records()));
  } catch (error) {
    console.warn(`[cox] timeboard could not be saved: ${error.message}`);
  }
}

/** Whether `ticks` is faster than the world's fifth time (or there are fewer than five). */
function qualifies(entries, ticks) {
  if (!(ticks > 0)) return false;
  if (entries.length < TOP) return true;
  return ticks < entries[TOP - 1].ticks;
}

/** Puts an entry on the world's board if it is fast enough, and keeps the best of its bracket. */
function insert(entries, entry) {
  const taken = qualifies(entries, entry.ticks);
  if (taken) {
    entries.push(entry);
    entries.sort((a, b) => a.ticks - b.ticks);
    entries.length = Math.min(entries.length, TOP);
  }
  return taken;
}

/**
 * A Challenge Mode completion: onto this world's board when it is one of the five fastest,
 * always the bracket's best, and the live message to the team when it made the board.
 * Returns whether it made the board.
 */
function record(raid) {
  if (!raid?.challenge) return false;
  const data = records();
  const entry = { ticks: raid.duration, leader: raid.party?.leader ?? "", size: raid.scale ?? 1 };
  const key = bracket(entry.size);
  if (!(data.global[key] > 0) || entry.ticks < data.global[key]) data.global[key] = entry.ticks;
  const madeIt = insert(data.world, entry);
  save();
  if (madeIt) {
    for (const player of raid.players ?? []) Shared.raidNotice(player, MADE_IT);
  }
  return madeIt;
}

/** m:ss.cc, as the Wiki's table prints times. */
function formatTicks(ticks) {
  const centis = Math.max(0, Number(ticks) || 0) * 60;
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  const pad = (value) => String(value).padStart(2, "0");
  return `${minutes}:${pad(seconds)}.${pad(centis % 100)}`;
}

/**
 * Cache 229: the message box's text widget is 80px tall at 15px a line, in a 96px clip with no
 * scroll, so a page holds four lines. Each section starts its own page.
 */
const PAGE_LINES = 4;

function paginate(lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += PAGE_LINES) pages.push(lines.slice(i, i + PAGE_LINES).join("<br>"));
  return pages;
}

/** The board's pages: this world's five, then the best of every team size (a guessed layout). */
function pages() {
  const data = records();
  const world = [`${TITLE} - this world:`];
  if (data.world.length === 0) world.push("No Challenge Mode raids have been completed yet.");
  data.world.forEach((entry, index) => {
    world.push(`${index + 1}. ${entry.leader || "Unknown"} - ${bracket(entry.size)} - ${formatTicks(entry.ticks)}`);
  });
  const best = (key) => `${key}: ${data.global[key] > 0 ? formatTicks(data.global[key]) : "-"}`;
  const sizes = ["Solo", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11-15", "16-23", "24+"];
  const team = ["Best by team size:"];
  for (let i = 0; i < sizes.length; i += 2) {
    team.push(sizes.slice(i, i + 2).map(best).join("     "));
  }
  return [...paginate(world), ...paginate(team)];
}

/** The whole board as one string (tests). */
function text() {
  return pages().join("<br>");
}

function readBoard(event) {
  if (event.objectId !== LOC || event.option !== "Read") return false;
  Shared.statement(event.player, pages());
  return true;
}

/** Tests: a board of their own, and a fresh read. */
function setFile(file) {
  FILE = file;
  board = null;
}

function reset() {
  board = null;
}

module.exports = function registerCoxTimeboard(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [LOC], readBoard);
};

Object.assign(module.exports, { LOC, TOP, TITLE, MADE_IT, PAGE_LINES, bracket, qualifies, insert, record, pages, text, formatTicks, readBoard, setFile, reset });
