"use strict";

/**
 * The Ranging Guild itself while a round can be running: walking out, teleporting or logging
 * out mid-round clears the round with no tickets and takes back the judge's arrows, which is
 * the Wiki-undocumented leave behaviour.
 */

const Session = require("./Session.ArcheryCompetition");

/** The guild's ground floor (doorman 2658,3439; target corner 2682,3428). */
const BOUNDS = { minX: 2653, maxX: 2687, minY: 3412, maxY: 3443 };
const PLANE = 0;

module.exports = function registerArea(pluginApi) {
  const { core } = pluginApi;
  // "Enter the Ranging Guild" is credited by the guild door (RangingGuild.plugin): this rectangle runs past the
  // diagonal fence, so arriving at its north-west corner (a combat bracelet's 2655,3443) isn't entering the guild.
  class RangingGuildRange extends core.Area {
    postLeave(mobile) {
      if (!mobile.isPlayer()) return;
      Session.endRound(mobile.getAsPlayer());
    }
  }
  pluginApi.registerArea(new RangingGuildRange([
    new core.Boundary(BOUNDS.minX, BOUNDS.maxX, BOUNDS.minY, BOUNDS.maxY, PLANE),
  ]));
};

Object.assign(module.exports, { BOUNDS, PLANE });
