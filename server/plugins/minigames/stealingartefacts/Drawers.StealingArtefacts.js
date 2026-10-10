"use strict";

/**
 * The assigned house's drawers (loc ids 27771-27776, first click "Pick-lock"). A task for
 * another house, an artefact already carried, a Thieving level under 49 or a full pack leaves
 * the drawer shut; otherwise it gives 750 XP and one of the five artefacts at 1/5.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Drawers_(stealing_artefacts)
 */

const Common = require("./Common.StealingArtefacts");

function pickLock({ player, objectId }) {
  const task = Common.taskOf(player);
  const house = task ? Common.houseByName(task.house) : null;
  if (!house || house.drawer !== objectId || Common.carriedArtefactId(player)) {
    player.sendMessage(Common.MESSAGES.wrongDrawer);
    return;
  }
  if (Common.thievingLevel(player) < Common.THIEVING_LEVEL) {
    player.sendMessage(Common.MESSAGES.level);
    return;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage(Common.MESSAGES.noSpace);
    return;
  }
  player.sendMessage(Common.MESSAGES.stole);
  player.getSkillManager().addExperiences(Common.getCore().Skill.THIEVING, Common.STEAL_XP);
  Common.giveArtefact(player, Common.rollArtefact());
}

module.exports = function registerDrawers(api) {
  Common.bind(api);
  api.onObjectClick(Common.DRAWER_IDS, 1, pickLock);
};

module.exports._test = { pickLock };
