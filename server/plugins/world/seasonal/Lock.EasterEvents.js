"use strict";

// The locked egg box from Lowe's stepladder: the native combination lock (809) over the
// event's own four-dial dataset, combination_lock_dataset_alphabetic_easter26. That row's
// id was reused after the event, so the archived row is sent as a client DB row override
// under a virtual id. Wiki Egg box: the code is LOWE and the dials start randomised.
const { createCombinationLock } = require("../../quests/QuestPuzzleLocks");
const Scene = require("./Scene.EasterEvents");
const Hunt = require("./Hunt.EasterEvents");
const CODE = "LOWE";
// Outside the cache's 16-bit row ids and below the Leagues' virtual range (200000+).
const VIRTUAL_ROW = 0x20000 + Scene.source.lockRow.sourceId;
let lock = null;

function overrideRow() {
  const { tableId, columns } = Scene.source.lockRow;
  return { rowId: VIRTUAL_ROW, tableId, columns };
}
/** The dial index of each letter of the code, read from the live dial rows. */
function digits(api) {
  const cache = api.core.CacheDefinitions, row = Scene.source.lockRow;
  const values = row.columns[String(cache.getDbColumn(row.tableId, "values"))];
  return [...CODE].map((letter, dial) => {
    const dialRow = cache.getDbRow(values[dial]);
    const letters = dialRow.column(cache.getDbColumn(dialRow.tableId, "string_value"));
    const index = letters.indexOf(letter);
    if (index < 0) throw new Error("Egg box dial " + dial + " cannot show " + letter);
    return index;
  });
}
function leagueOf(api, player) {
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  return query.league;
}
/** A league character's client keeps one override set; join it rather than replace it. */
function contribute(event) {
  if (Hunt.isActive()) event.dbRows.push(overrideRow());
}
function sendRow(api, player) {
  if (leagueOf(api, player) !== null) api.emitCustomEvent("league:send-content", { player });
  else player.getPacketSender().sendContentData("server", [{ key: "dbRowOverrides", rows: [overrideRow()] }]);
}
function solved(api, player) { Hunt.lockSolved(api, player); }
function init(api) {
  lock = createCombinationLock(api, { digits: digits(api), datasetRow: VIRTUAL_ROW, onSolved: solved.bind(null, api), failureMessage: Hunt.wrongCode() });
  Hunt.setLock({ open: open.bind(null, api), cancelAll: cancelAll.bind(null, api) });
}
function open(api, player) {
  sendRow(api, player);
  lock.open(player);
}
function cancelAll(api) {
  for (const player of api.core.World.getPlayers()) if (player) lock?.cancel(player, { removeInterface: true });
}

module.exports = { CODE, VIRTUAL_ROW, init, contribute, digits, overrideRow };
