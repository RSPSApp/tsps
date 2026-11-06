/**
 * Whether a league character stands in a bank (data/league-shattered.json `bank`): where Shattered
 * Relics' fragments change (Fragments, Wiki /Fragments) and quest packs auto-complete (Unlocks, the
 * league's launch news: "you can only auto-complete quests while in a Bank"), and, asked over
 * `league:near-bank` { player, distance? } -> { near } with a tighter distance, where Demonic
 * Pacts' item relics unlock (LeagueRelics' Unlock).
 */
const Common = require("./Common.LeagueMode");
const { data } = require("./Shattered.LeagueMode");

function config() {
  return data.bank;
}

/** A loc that banks: one with a Bank option (booths, counters, tables), or a bank chest you can use. */
function banksAt(object) {
  const definition = object.getDefinition?.();
  const actions = definition?.getActions?.() ?? [];
  const { bankAction, bankChests } = config();
  return actions.includes(bankAction) || (bankChests.includes(definition?.getName?.()) && actions.some(Boolean));
}

/** A loc that banks, or an NPC with a Bank option, within `distance` (`bank.distance` unless given) on the character's plane. */
function nearBank(player, distance = config().distance) {
  const { bankAction } = config();
  const { MapObjects, RegionManager } = Common.core;
  const here = player.getLocation();
  const [x, y, z] = [here.getX(), here.getY(), here.getZ()];
  RegionManager.loadMapFiles(x, y);
  for (let dx = -distance; dx <= distance; dx++) {
    for (let dy = -distance; dy <= distance; dy++) {
      const objects = MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? [];
      if (objects.some(banksAt)) return true;
    }
  }
  const list = player.getLocalNpcs?.();
  const npcs = Array.isArray(list) ? list : list ? [...list.values()] : [];
  return npcs.some((npc) => (npc?.getDefinition?.()?.getActions?.() ?? []).includes(bankAction)
    && npc.getLocation().getZ() === z && here.getDistance(npc.getLocation()) <= distance);
}

/** `league:near-bank`: the answer for another plugin. */
function answerNearBank(query) {
  if (query?.player) query.near = nearBank(query.player, query.distance ?? config().distance);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:near-bank", answerNearBank);
};

Object.assign(module.exports, { nearBank, banksAt });
