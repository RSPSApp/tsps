"use strict";

const Common = require("./Common.MaggotKing");

/** Camping the King: twelve owner kills without leaving this lair session (Wiki15344273). */
function ownerKilled(session) {
  session.campingKills++;
  if (session.campingKills === 12) {
    Common.api().emitCustomEvent("combat-achievements:complete", {
      player: session.player,
      task: "Camping the King",
    });
  }
}

module.exports = { ownerKilled };
