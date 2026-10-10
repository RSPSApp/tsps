"use strict";

/**
 * Puro-Puro itself: per-tick wheat pushes for players inside, cancelled when they leave,
 * and a logout inside moved to the entry field so the saved position is outside.
 * No temporary NPCs or objects are spawned by this plugin, so there is nothing else to
 * clean up on leave. Out of scope, left to a later pass: the 35 2-minute spawn points +
 * 51 fixed respawns network, and the imp defenders (npc 5738) freeing jarred implings.
 */
const Entry = require("./Entry.ImpetuousImpulses");
const Wheat = require("./Wheat.ImpetuousImpulses");

/** Approximate Puro-Puro boundary; the Hunter plugin's catch rectangle is slightly wider. */
const BOUNDS = [2563, 2620, 4291, 4348];
const PLANE = 0;

let core;

function init(api) {
  core = api.core;
}

function registerArea(api) {
  init(api);
  class PuroPuro extends core.Area {
    process(mobile) {
      if (mobile.isPlayer()) Wheat.process(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer()) return;
      Wheat.cancel(mobile.getAsPlayer());
      if (logout) Entry.leaveAtField(mobile.getAsPlayer());
    }
  }
  api.registerArea(new PuroPuro([new core.Boundary(BOUNDS[0], BOUNDS[1], BOUNDS[2], BOUNDS[3], PLANE)]));
}

module.exports = registerArea;
Object.assign(module.exports, { init, BOUNDS, PLANE, _test: { BOUNDS, PLANE } });
