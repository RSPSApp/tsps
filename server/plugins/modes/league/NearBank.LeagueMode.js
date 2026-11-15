/**
 * Whether a league character stands in a bank (data/league-shattered.json `bank`): where Shattered
 * Relics' fragments change (Fragments, Wiki /Fragments) and quest packs auto-complete (Unlocks, the
 * league's launch news: "you can only auto-complete quests while in a Bank"), and, asked over
 * `league:near-bank` { player, distance?, chests? } -> { near } with a tighter distance, where Demonic
 * Pacts' item relics unlock (LeagueRelics' Unlock). `chests: false` leaves bank chests out, for an item the
 * Wiki says most bank chests don't serve (scaly blue dragonhide).
 */
const Common = require("./Common.LeagueMode");
const { data } = require("./Shattered.LeagueMode");

function config() {
  return data.bank;
}

/** A loc that banks: one with a Bank option (booths, counters, tables), or a bank chest you can use unless `chests` is false. */
function banksAt(object, chests = true) {
  const definition = object.getDefinition?.();
  const actions = definition?.getActions?.() ?? [];
  const { bankAction, bankChests } = config();
  const chest = bankChests.includes(definition?.getName?.());
  if (chest) return chests && actions.some(Boolean);
  return actions.includes(bankAction);
}

/** A loc that banks, or an NPC with a Bank option, within `distance` (`bank.distance` unless given) on the character's plane. */
function nearBank(player, distance = config().distance, chests = true) {
  const { bankAction } = config();
  const { MapObjects, RegionManager } = Common.core;
  const here = player.getLocation();
  const [x, y, z] = [here.getX(), here.getY(), here.getZ()];
  RegionManager.loadMapFiles(x, y);
  for (let dx = -distance; dx <= distance; dx++) {
    for (let dy = -distance; dy <= distance; dy++) {
      const objects = MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? [];
      if (objects.some((object) => banksAt(object, chests))) return true;
    }
  }
  const list = player.getLocalNpcs?.();
  const npcs = Array.isArray(list) ? list : list ? [...list.values()] : [];
  return npcs.some((npc) => (npc?.getDefinition?.()?.getActions?.() ?? []).includes(bankAction)
    && npc.getLocation().getZ() === z && here.getDistance(npc.getLocation()) <= distance);
}

/** `league:near-bank`: the answer for another plugin. */
function answerNearBank(query) {
  if (query?.player) query.near = nearBank(query.player, query.distance ?? config().distance, query.chests !== false);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:near-bank", answerNearBank);
};

Object.assign(module.exports, { nearBank, banksAt });
