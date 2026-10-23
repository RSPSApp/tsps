"use strict";

/**
 * The Mimic, the elite-clue casket boss (see docs/mimic.md for behaviour and sources).
 *
 * Behaviour comes from https://oldschool.runescape.wiki/w/The_Mimic (and the
 * Strange casket transcript for the dialogue). Near-Reality is a behaviour oracle
 * only (leaked dump, no license, no code ported): values taken from it alone are
 * marked NR-only where they are used, and the PR lists them.
 * Combat stats, drops and spawns already exist in data/definitions; this plugin adds
 * the private fight: entry, challenge, attack script, minions, stomp and exit.
 * Deaths respawn as whirlpools via the engine (it clears the transformation first).
 *
 * Estimates (no capture yet): DISTURB/wake ranges, throw-adjacent timings, the exact
 * candy flight arc, and the challenge transform having no animation. Mimic-casket
 * acquisition (elite/master casket opening) needs the clue system and is a follow-up;
 * anyone holding item 23184 can enter for now. The 90k strange-casket death
 * retrieval and the boss timer are follow-ups (arena graves go outside instead).
 */

const Shared = require("./mimic/Shared.Mimic");
const Lair = require("./mimic/Lair.Mimic");
const Challenge = require("./mimic/Challenge.Mimic");
const Fight = require("./mimic/Fight.Mimic");
const Minions = require("./mimic/Minions.Mimic");
const Commands = require("./mimic/Commands.Mimic");
const Dialogue = require("./mimic/Dialogue.Mimic");
const Reward = require("./mimic/Reward.Mimic");

module.exports = {
  name: "Mimic",
  members: true,
  register(api) {
    Shared.bind(api);
    Lair.attach(api);
    Challenge.attach(api);
    Fight.attach(api);
    Minions.attach(api);
    Commands.attach(api);
    Dialogue.attach(api);
    Reward.attach(api);
  },
};
