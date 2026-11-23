/**
 * Combo boss drops (Wiki: Demonic Pacts League, "Combo boss drops"): a part that needs other
 * regions to become a usable item drops as the finished item instead (the eternal crystal as
 * eternal boots, a vestige as its ring). data/league-combo-drops.json lists the parts, by cache
 * gameval, and the leagues that do it. The rollers' loot passes through "npc-drops:roll"
 * { player, drops } (NPC kills and the bosses that roll through NpcDrops, Doom of Mokhaiotl)
 * or "drops:rolled" { player, source, drops } (the raids' uniques, the Colosseum's waves, the
 * key chests) before it is kept, and a league character's parts are replaced there in place.
 * A drop is { itemId | id, amount, noted? }; a finished item is one, unnoted, whatever the part's stack.
 */
const Common = require("./Common.LeagueMode");
const DATA = require("../data/league-combo-drops.json");

let core = null;
let finishedByPart = null;
const LEAGUES = new Set(DATA.leagues.map(Number));

/** Part id to finished id, from the cache's gamevals. */
function table() {
  if (finishedByPart) return finishedByPart;
  finishedByPart = new Map();
  for (const { part, finished } of DATA.items) {
    const from = core.CacheDefinitions.getObjId(part);
    const to = core.CacheDefinitions.getObjId(finished);
    if (Number.isInteger(from) && from >= 0 && Number.isInteger(to) && to >= 0) finishedByPart.set(from, to);
  }
  return finishedByPart;
}

/** Whether `player`'s league drops finished items. */
function applies(player) {
  const type = Common.leagueOf(player);
  return type !== null && LEAGUES.has(type);
}

/** "npc-drops:roll" / "drops:rolled": a league character's parts become their finished items. */
function finishDrops(event) {
  if (!Array.isArray(event?.drops) || !applies(event.player)) return;
  const finished = table();
  for (const drop of event.drops) {
    const key = Number.isInteger(drop?.itemId) ? "itemId" : Number.isInteger(drop?.id) ? "id" : null;
    if (!key || !finished.has(drop[key])) continue;
    drop[key] = finished.get(drop[key]);
    drop.amount = 1;
    if (drop.noted) drop.noted = false;
  }
}

module.exports = function attach(api) {
  core = api.core;
  api.onCustomEvent("npc-drops:roll", finishDrops);
  api.onCustomEvent("drops:rolled", finishDrops);
};

module.exports.finishDrops = finishDrops;
