"use strict";

/**
 * The Alliance records (tfa_stats, 979): a player's attempts, completions, deaths, wipes,
 * failures and best times, overall and per boss. The Record Keeper's "View Stats?" and the
 * lobby's Alliance records open it.
 *
 * Captured: opening 979 asks for each category's rows with a script trigger on 979:34
 * ([category dbrow]), answered with script 10125 per row (category, stat, party size or -1,
 * current or blank, 0, personal, global, global today, world today) and 10124. The rows each
 * category lists and which are split by party size are as captured. Only the personal column is
 * kept here: there are no world-wide records, so the others stay blank.
 */

const Shared = require("./Shared.FracturedArchive");

const ATTR = "fractured-archive:records";
/** -2147483648 leaves a cell blank. */
const BLANK = -2147483648;
const STATS_SCRIPT = 10125;
const STATS_DONE_SCRIPT = 10124;
const STATS_OPEN_SCRIPT = 10102;

/** The categories (dbrows tfa_stats_category_*), keyed by what the raid calls them. */
const CATEGORIES = {
  overall: "tfa_stats_category_overall",
  GUARDIAN: "tfa_stats_category_guardian",
  BORK: "tfa_stats_category_bork",
  DAGONHAI: "tfa_stats_category_dagonhai",
  EZEKIEL: "tfa_stats_category_ezekiel",
  MOIA: "tfa_stats_category_moia",
  OCELLUS: "tfa_stats_category_ocellus",
  DREADNOTH: "tfa_stats_category_jelly",
  XARTH: "tfa_stats_category_xarth",
};
const ROWS = {
  attempts: "tfa_stats_row_attempts",
  completions: "tfa_stats_row_completions",
  practice: "tfa_stats_row_completions_practice",
  deaths: "tfa_stats_row_deaths",
  wipes: "tfa_stats_row_wipes",
  failures: "tfa_stats_row_failures",
  time: "tfa_stats_row_time",
};
/** As captured: overall lists wipes and failures; the bosses list practice completions. */
const OVERALL_ROWS = ["attempts", "completions", "deaths", "wipes", "failures", "time"];
const BOSS_ROWS = ["attempts", "completions", "practice", "deaths", "time"];

function recordsOf(player) {
  const records = player.getAttribute(ATTR);
  return records && typeof records === "object" ? records : {};
}

function entry(records, category) {
  return (records[category] ??= { attempts: 0, completions: 0, practice: 0, deaths: 0, wipes: 0, failures: 0, time: {} });
}

/** Adds one to a counter: record(player, "GUARDIAN", "deaths"). */
function record(player, category, field) {
  const records = recordsOf(player);
  entry(records, category)[field] += 1;
  player.setAttribute(ATTR, records);
}

/** A completion time for a party size, kept when it's the best. */
function recordTime(player, category, size, ticks) {
  const records = recordsOf(player);
  const times = entry(records, category).time;
  if (!(times[size] > 0) || ticks < times[size]) times[size] = ticks;
  player.setAttribute(ATTR, records);
}

function open(player) {
  const sender = player.getPacketSender();
  sender.sendInterface(Shared.core().CacheDefinitions.getInterfaceId("tfa_stats"));
  sender.sendClientScript(STATS_OPEN_SCRIPT, 0);
}

/** The client building a category's table asks for its rows. */
function sendCategory(player, categoryRow) {
  const { CacheDefinitions } = Shared.core();
  const key = Object.keys(CATEGORIES).find((name) => CacheDefinitions.getDbRowId(CATEGORIES[name]) === categoryRow);
  if (!key) return;
  const stats = entry(recordsOf(player), key);
  const sender = player.getPacketSender();
  for (const row of key === "overall" ? OVERALL_ROWS : BOSS_ROWS) {
    const rowId = CacheDefinitions.getDbRowId(ROWS[row]);
    if (row === "time") {
      for (let size = 1; size <= Shared.MAX_PARTY_SIZE; size++) {
        sender.sendClientScript(STATS_SCRIPT, categoryRow, rowId, size, BLANK, 0, stats.time[size] ?? 0, BLANK, BLANK, BLANK);
      }
      continue;
    }
    sender.sendClientScript(STATS_SCRIPT, categoryRow, rowId, -1, BLANK, 0, stats[row] ?? 0, BLANK, BLANK, BLANK);
  }
  sender.sendClientScript(STATS_DONE_SCRIPT);
}

function tableTrigger(event) {
  if (!event.scriptTrigger || event.buttonId !== Shared.core().CacheDefinitions.getComponentId("tfa_stats:all_stats_tables")) return;
  event.handled = true;
  const [category] = Shared.triggerInts(event.argsData);
  sendCategory(event.player, category);
}

function readRecords({ player }) {
  open(player);
  return true;
}

/** "fractured-archive:record" { player, category, field }: the raid counting something. */
function onRecord({ player, category, field }) {
  if (player && category && field) record(player, category, field);
}

/** "fractured-archive:record-time" { player, category, size, ticks }: a completion time. */
function onRecordTime({ player, category, size, ticks }) {
  if (player && category && size > 0 && ticks > 0) recordTime(player, category, Math.min(size, Shared.MAX_PARTY_SIZE), ticks);
}

/** The Record Keeper's "View Stats?" - "Yes.": once the conversation has closed itself. */
function keeperChoice({ player, stepId }) {
  if (stepId === "tfa-record-keeper-view-stats") Shared.later(player, 1, () => open(player));
}

module.exports = function registerRecords(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR);
  api.onObjectInteraction("Alliance records", { Read: readRecords });
  api.onInterfaceActionClick(tableTrigger);
  api.onCustomEvent("npc-dialogue:choice", keeperChoice);
  api.onCustomEvent("fractured-archive:record", onRecord);
  api.onCustomEvent("fractured-archive:record-time", onRecordTime);
};

Object.assign(module.exports, { ATTR, CATEGORIES, record, recordTime, recordsOf, open, sendCategory });
