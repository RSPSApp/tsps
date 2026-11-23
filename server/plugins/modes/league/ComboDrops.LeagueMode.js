/**
 * Combo boss drops (Wiki: Raging Echoes League and Demonic Pacts League, "Combo boss drops"): a
 * part that needs other regions to become a usable item drops as the finished item instead (the
 * eternal crystal as eternal boots, a vestige as its ring). data/league-combo-drops.json lists the
 * parts, by cache gameval, with the leagues that do it and, where a part also drops elsewhere, the
 * NPCs it is replaced from. The rollers' loot passes through "npc-drops:roll" { player, npc?,
 * npcId?, drops } (NPC kills and the bosses that roll through NpcDrops, Doom of Mokhaiotl) or
 * "drops:rolled" { player, source, drops } (the raids' uniques, the Colosseum's waves, the key
 * chests, a Frozen Cache) before it is kept, and a league character's parts are replaced there in
 * place. A drop is { itemId | id, amount, noted? }; a finished item is one, unnoted, whatever the
 * part's stack.
 */
const Common = require("./Common.LeagueMode");
const DATA = require("../data/league-combo-drops.json");

let core = null;
let swaps = null;

/** Part id to its swaps: [{ finished, leagues, npcs }], from the cache's gamevals. */
function table() {
  if (swaps) return swaps;
  swaps = new Map();
  for (const { part, finished, leagues, npcs } of DATA.items) {
    const from = core.CacheDefinitions.getObjId(part);
    const to = core.CacheDefinitions.getObjId(finished);
    if (!(Number.isInteger(from) && from >= 0 && Number.isInteger(to) && to >= 0)) continue;
    const list = swaps.get(from) ?? [];
    list.push({ finished: to, leagues: new Set(leagues.map(Number)), npcs: npcs ? new Set(npcs.map((name) => name.toLowerCase())) : null });
    swaps.set(from, list);
  }
  return swaps;
}

/** The name of the NPC whose kill this is, lower-cased, or null when the roll names none. */
function npcName(event) {
  const name = (event.npc?.getCurrentDefinition?.() ?? event.npc?.getDefinition?.())?.getName?.()
    ?? (Number.isInteger(event.npcId) ? core.CacheDefinitions.getNpc?.(event.npcId)?.name : null);
  return name ? String(name).toLowerCase() : null;
}

/** "npc-drops:roll" / "drops:rolled": a league character's parts become their finished items. */
function finishDrops(event) {
  if (!Array.isArray(event?.drops)) return;
  const league = Common.leagueOf(event.player);
  if (league === null) return;
  const all = table();
  let npc;
  for (const drop of event.drops) {
    const key = Number.isInteger(drop?.itemId) ? "itemId" : Number.isInteger(drop?.id) ? "id" : null;
    const candidates = key ? all.get(drop[key]) : null;
    if (!candidates) continue;
    if (npc === undefined) npc = npcName(event);
    const swap = candidates.find((entry) => entry.leagues.has(league) && (!entry.npcs || (npc !== null && entry.npcs.has(npc))));
    if (!swap) continue;
    drop[key] = swap.finished;
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
