"use strict";

/**
 * Shared by the Demonic Pacts echo items (Wiki: Demonic Pacts League/Echo bosses and echo
 * equipment). Some of them were echo items in earlier leagues too, with other effects (the Devil's
 * element and the crystal blessing in Raging Echoes): the effects in these plugins are the Demonic
 * Pacts versions, so they apply to a Demonic Pacts character only.
 */

/** The Demonic Pacts league type (data/leagues.json, cache enum 2670). */
const DEMONIC_PACTS = 6;

/** Whether `player` is a Demonic Pacts league character (LeagueMode's `league:profile`). */
function inDemonicPacts(api, player) {
  if (!player?.isPlayer?.()) return false;
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  return Number(query.league) === DEMONIC_PACTS;
}

module.exports = { DEMONIC_PACTS, inDemonicPacts };
