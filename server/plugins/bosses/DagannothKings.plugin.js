"use strict";

/**
 * The Dagannoth Kings of Waterbirth Island Dungeon (Wiki: Dagannoth Kings;
 * docs/dagannoth-kings.md): the public lair and the Slayer-task lair with the
 * Kings' ladder entrance, and the fights - Prime's AoE magic, Supreme's
 * multi-target ranged, Rex's melee and the spinolyps with their poison, prayer
 * drain and diving. Drops, spawns, kill counting and Combat Achievements already
 * exist in data/definitions and plugins; this plugin only adds the missing behaviour.
 *
 * Follow-ups: rented private instances, Supreme's facing-based multi-target cone,
 * spinolyp engine-hit-rate parity (its magic rolls magic accuracy; live rolls ranged
 * accuracy), and the Slayer-lair crack Peek.
 */
const Common = require("./dagannothkings/Common.DagannothKings");
const FightPrime = require("./dagannothkings/Fight.Prime.DagannothKings");
const FightSupreme = require("./dagannothkings/Fight.Supreme.DagannothKings");
const FightRex = require("./dagannothkings/Fight.Rex.DagannothKings");
const FightSpinolyp = require("./dagannothkings/Fight.Spinolyp.DagannothKings");
const Dive = require("./dagannothkings/Dive.Spinolyp.DagannothKings");
const Area = require("./dagannothkings/Area.DagannothKings");
const Entrance = require("./dagannothkings/Entrance.DagannothKings");
const Hud = require("./dagannothkings/Hud.DagannothKings");

module.exports = {
  name: "DagannothKings",
  members: true,
  register(api) {
    Common.init(api);
    FightPrime.attach(api);
    FightSupreme.attach(api);
    FightRex.attach(api);
    FightSpinolyp.attach(api);
    Dive.attach(api);
    Area.attach(api);
    Entrance.attach(api);
    Hud.attach(api);
  },
};
