"use strict";

/**
 * Gnome Ball, the minigame at the Tree Gnome Stronghold pitch
 * (https://oldschool.runescape.wiki/w/Gnome_Ball). The units live in ./gnomeball/: the
 * pitch, its sessions and the ball mechanics (Pitch.GnomeBall.js), the referee's
 * dialogue-driven hand-outs (Referee.GnomeBall.js) and the swing-through pitch gate
 * (Gate.GnomeBall.js).
 */
const Pitch = require("./gnomeball/Pitch.GnomeBall");
const Referee = require("./gnomeball/Referee.GnomeBall");
const Gate = require("./gnomeball/Gate.GnomeBall");

module.exports = {
  name: "GnomeBall",
  members: true,
  register(api) {
    Pitch.attach(api);
    Referee.attach(api);
    Gate(api);
  },
};
