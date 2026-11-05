"use strict";

/**
 * The shared Dig click for every spade (Spade, Large spade, Eastfloor spade), from the cache's
 * Dig inventory option. Live captures (rsprox 1858, 3275, 1098) show a plain dig playing
 * human_dig with synth 1470 while the player keeps walking: a partial animation stall, not a
 * movement stop (Wiki: Animation stall). The true tile keeps moving and the client catches the
 * character up when the sequence ends.
 *
 * The handler deliberately returns false so the event stays open: content with its own dig
 * (treasure trails, Barrows, quest digs, sailing schematics) still runs on the same click and
 * plays its own sequence. Only the spade's option reaches here, so no other item is affected.
 */

const DIG_SOUND = 1470;
const HUMAN_DIG = 830;
const SPADES = ["Spade", "Large spade", "Eastfloor spade"];

let core;

function dig(event) {
  const { player } = event;
  const sequence = core.CacheDefinitions.getSeqId("human_dig") ?? HUMAN_DIG;
  player.performAnimation(new core.Animation(sequence));
  core.Sounds.sendSound(player, new core.Sound(DIG_SOUND, 1, 0, 0));
  return false;
}

module.exports = {
  name: "Spade",
  register(api) {
    core = api.core;
    for (const name of SPADES) api.onItemAction(name, { Dig: dig });
  },
};
