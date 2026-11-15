/**
 * The structs, enums and DB rows a league's screens need that the cache does not carry (another
 * league's relic catalog and task list, Leagues I-III's rank thresholds), sent to the client as one
 * structOverrides / enumOverrides / dbRowOverrides payload (GamemodeContentStore replaces the whole
 * set on every payload, so the units never send their own). Units answer
 *
 *   "league:content-rows" { player, league, base, structs: [{ structId, params }], enums: [{ enumId, valueType, defaultValue, entries }], dbRows: [{ rowId, tableId, columns: { "<column>": [values] } }] }
 *
 * by pushing their rows; the payload goes out at a league login and whenever a unit asks for it
 * again with "league:send-content" { player } (before an interface opens, in case the client
 * reloaded). The event names are the ones the areas plugin (#1352) uses for the same job.
 * Rows for one struct from several units are merged, since the client keeps one params map a
 * struct. Virtual ids start at `base` on the query (data.content.virtualIdBase + league type x
 * 1000); each unit adds its own offsets.
 *
 * The same payload for the world's league is public at /api/league-content ({ league, datasets },
 * league null on a plain world). The official client can't take content data, so the RuneLite
 * gateway reads it there and serves the rows in its cache over JS5. The units' rows depend only
 * on the league, never on the player.
 */
const Common = require("./Common.LeagueMode");

/** The first virtual struct / enum id of a league's own rows; units add their own offsets. */
function virtualIdBase(type) {
  return Common.data.content.virtualIdBase + Number(type) * 1000;
}

function rows(player, type) {
  const query = { player, league: type, base: virtualIdBase(type), structs: [], enums: [], dbRows: [] };
  Common.api.emitCustomEvent("league:content-rows", query);
  return query;
}

/** One row a struct: a later unit's params join an earlier one's instead of replacing them on the client. */
function mergeStructs(rows) {
  const byId = new Map();
  for (const row of rows) byId.set(row.structId, Object.assign(byId.get(row.structId) ?? {}, row.params));
  return [...byId.entries()].map(([structId, params]) => ({ structId, params }));
}

/** The content data datasets of a league's rows. */
function datasets(player, type) {
  const { structs, enums, dbRows } = rows(player, type);
  return [
    { key: "structOverrides", rows: mergeStructs(structs) },
    { key: "enumOverrides", rows: enums },
    { key: "dbRowOverrides", rows: dbRows },
  ];
}

/** Sent even when empty: the client keeps the last payload's overrides until the next replaces them. */
function send(player, type) {
  player.getPacketSender().sendContentData("server", datasets(player, type));
}

/** GET /api/league-content: the world's league and its payload, as a league login sends it. */
function worldContent() {
  const type = Common.worldLeague();
  return { league: type, datasets: type === null ? [] : datasets(null, type) };
}

function login({ player, league }) {
  send(player, league);
}

function refresh(request) {
  const type = request?.player ? Common.leagueOf(request.player) : null;
  if (type !== null) send(request.player, type);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:send-content", refresh);
  api.registerContentEndpoint("league-content", worldContent);
};

module.exports.send = send;
module.exports.worldContent = worldContent;
module.exports.rows = rows;
module.exports.virtualIdBase = virtualIdBase;
