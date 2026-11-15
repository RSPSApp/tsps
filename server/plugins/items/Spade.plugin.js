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
 *
 * When none of them claims the click, the fallback answers "Nothing interesting happens." on the
 * same tick as the sequence (rsprox.net captures, obj spade op2: 12 of 19 recordings, e.g. 1698
 * tick 6941, 1067 tick 209, 3931 tick 4075).
 *
 * The Large spade has a Dig option but can't dig (Wiki: Large spade): no sequence or sound, only
 * its refusal line, and no content dig claims it.
 */

const DIG_SOUND = 1470;
const HUMAN_DIG = 830;
const SPADES = ["Spade", "Eastfloor spade"];
const NOTHING_FOUND = "Nothing interesting happens.";
const LARGE_SPADE_REFUSAL = "Due to its sheer size, you just cannot angle it right to dig with it.";

let core;

function dig(event) {
  const { player } = event;
  const sequence = core.CacheDefinitions.getSeqId("human_dig") ?? HUMAN_DIG;
  player.performAnimation(new core.Animation(sequence));
  core.Sounds.sendSound(player, new core.Sound(DIG_SOUND, 1, 0, 0));
  return false;
}

function digFoundNothing({ player }) {
  player.sendMessage(NOTHING_FOUND);
}

function largeSpadeDig({ player }) {
  player.sendMessage(LARGE_SPADE_REFUSAL);
}

module.exports = {
  name: "Spade",
  description: "Plays the digging animation and sound for the Dig option on spades (the Large spade only says it cannot dig), leaves the click open for treasure trails and quest digs, and says nothing was found when none of them claims it.",
  register(api) {
    core = api.core;
    for (const name of SPADES) api.onItemAction(name, { Dig: dig });
    for (const name of SPADES) api.onItemAction(name, { Dig: digFoundNothing }, { fallback: true });
    api.onItemAction("Large spade", { Dig: largeSpadeDig }, { fallback: true });
  },
};
