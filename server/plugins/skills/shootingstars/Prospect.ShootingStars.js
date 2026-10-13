"use strict";

/**
 * Prospect on a crashed star (captures): synth sound 2661 and a message box, "This is a size-7
 * star. A Mining level of at least 70 is required to mine this layer. It has been mined 50% of
 * the way to the next layer." On a size-1 star the last words are "...of the way to the core."
 */

const Common = require("./Common.ShootingStars");
const Star = require("./Star.ShootingStars");

const { DATA, world } = Common;

function prospectText(star) {
  const goal = star.size <= 1 ? "the core" : "the next layer";
  return `This is a size-${star.size} star. A Mining level of at least ${star.size * 10} is required to mine this layer. `
    + `It has been mined ${star.percent}% of the way to ${goal}.`;
}

function prospect(event) {
  const { player } = event;
  const star = world.star;
  if (!Star.isLanded(star) || event.location?.x !== star.x || event.location?.y !== star.y) return false;
  event.handled = true;
  player.setPositionToFace(Common.starCentre(star));
  player.getPacketSender().sendSound(DATA.sounds.prospect, 1, 0);
  Common.mesbox(player, prospectText(star));
}

module.exports = function attachProspect(api) {
  api.onObjectInteraction("Crashed Star", { Prospect: prospect });
};

Object.assign(module.exports, { prospect, prospectText });
