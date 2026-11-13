"use strict";

// A clue step dug with a spade: the same human_dig and dig sound as the spade's own Dig, on the
// same tick. The clue hooks claim the click before the spade's handler runs, so they play it here.
const HUMAN_DIG = 830;
const DIG_SOUND = 1470;

function playDig(core, player) {
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig") ?? HUMAN_DIG));
  core.Sounds.sendSound(player, new core.Sound(DIG_SOUND, 1, 0, 0));
}

module.exports = { playDig, HUMAN_DIG, DIG_SOUND };
