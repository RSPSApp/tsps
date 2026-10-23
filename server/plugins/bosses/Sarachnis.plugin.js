/**
 * Sarachnis, mother of the temple spiders, in the Forthos Dungeon burial tomb
 * (Wiki: Sarachnis; docs/sarachnis.md): the multi-combat lair with its boss HUD,
 * the webs and thick-web entrance with rented private instances, and the fight -
 * melee/ranged standards, the web every fourth attack with its sprint, the 5/10
 * heal on successful hits, and the spawns at 66% and 33% health.
 */
const Common = require("./sarachnis/Common.Sarachnis");
const Fight = require("./sarachnis/Fight.Sarachnis");
const Lair = require("./sarachnis/Lair.Sarachnis");
const Entrance = require("./sarachnis/Entrance.Sarachnis");

module.exports = {
  name: "Sarachnis",
  members: true,
  register(api) {
    Common.init(api);
    Fight.attach(api);
    Lair.attach(api);
    Entrance.attach(api);
  },
};
