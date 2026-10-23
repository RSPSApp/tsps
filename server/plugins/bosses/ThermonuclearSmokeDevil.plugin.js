"use strict";

/**
 * Thermonuclear smoke devil, the smoke devil boss south-west of Castle Wars
 * (Wiki: Thermonuclear smoke devil; docs/thermonuclear-smoke-devil.md): the multicombat
 * boss room with its crevice entrance, and the fight - a single typeless magical-ranged
 * style (max 8, speed 2, range 8) with the captured smoke projectile, enforced facemask
 * rule and 93 Slayer level. Drops, spawns and kill counting already exist in
 * data/definitions and plugins; this plugin only adds the missing behaviour.
 *
 * Slayer-task-only attacks and rented private instances are follow-ups, not implemented
 * here (as with the Kraken's task rule).
 */
const Common = require("./thermonuclear/Common.ThermonuclearSmokeDevil");
const Fight = require("./thermonuclear/Fight.ThermonuclearSmokeDevil");
const Typeless = require("./thermonuclear/Typeless.ThermonuclearSmokeDevil");
const Area = require("./thermonuclear/Area.ThermonuclearSmokeDevil");
const Entrance = require("./thermonuclear/Entrance.ThermonuclearSmokeDevil");

module.exports = {
  name: "ThermonuclearSmokeDevil",
  members: true,
  register(api) {
    Common.init(api);
    Fight.attach(api);
    Typeless.attach(api);
    Area.attach(api);
    Entrance.attach(api);
  },
};
