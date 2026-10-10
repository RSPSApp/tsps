"use strict";

/**
 * The shooting range targets: one "Fire-at" consumes a provided bronze arrow, rolls the core's
 * ranged attack roll against the ring buckets and shows the shot caption. A bow that fires
 * bronze arrows must be wielded (Wiki: Target (Ranging Guild)).
 */

const Session = require("./Session.ArcheryCompetition");

const TARGET_NAME = "Target";
const SHOOT_ANIMATION = 426;
const ARROW_PROJECTILE = 10;
const PROJECTILE_DELAY = 40;
const PROJECTILE_START_HEIGHT = 43;
const PROJECTILE_END_HEIGHT = 31;

let api;
let core;
let targetObjectId;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  targetObjectId = core.ObjectIdentifiers.TARGET_2;
}

function fireAt({ player, objectId, object }) {
  if (objectId !== targetObjectId) return;
  const session = Session.sessionOf(player);
  if (!session || session.finished) {
    player.sendMessage(session ? "You've used all your arrows. Talk to the Competition Judge."
      : "You need to enter the competition before you can use the targets.");
    return;
  }
  if (!Session.bowEquipped(player)) {
    player.sendMessage("You need a bow that can fire bronze arrows.");
    return;
  }
  const shot = Session.takeShot(player);
  if (!shot) {
    player.sendMessage("You have no arrows left.");
    return;
  }
  player.performAnimation(new core.Animation(SHOOT_ANIMATION));
  core.Projectile.createProjectile(player, object, ARROW_PROJECTILE, PROJECTILE_DELAY,
    core.Projectile.arrivalCycles(player, object), PROJECTILE_START_HEIGHT, PROJECTILE_END_HEIGHT).sendProjectile();
  player.sendMessage(shot.caption);
}

module.exports = function registerTargets(pluginApi) {
  init(pluginApi);
  api.onObjectInteraction(TARGET_NAME, { "Fire-at": fireAt });
};

Object.assign(module.exports, { _test: { init, fireAt } });
