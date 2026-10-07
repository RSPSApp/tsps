/**
 * The cave under Ardeaglais, as captured: Enter on the cave outside, Exit on the cave inside.
 * The player crawls in (the long crawl and its sound) behind a fade and lands facing in.
 * Every other "Cave" falls through to its own plugin.
 */
const Common = require("./Common.Wyrmscraig");

function crawl(player, side, object) {
  const { Animation } = Common.core;
  const { anim, sound } = Common.data.cave;
  player.getMovementQueue().reset();
  player.setPositionToFace(object.getLocation());
  player.performAnimation(new Animation(anim));
  player.getPacketSender().sendSoundEffect(sound.id, sound.loops, sound.delay);
  Common.travel(player, side.to, side.face);
}

function enterCave({ player, object, objectId }) {
  const { entrance } = Common.data.cave;
  if (objectId !== entrance.id) return false;
  crawl(player, entrance, object);
  return true;
}

function exitCave({ player, object, objectId }) {
  const { exit } = Common.data.cave;
  if (objectId !== exit.id) return false;
  crawl(player, exit, object);
  return true;
}

module.exports = function attachCave(api) {
  api.onObjectInteraction("Cave", { Enter: enterCave, Exit: exitCave });
};
