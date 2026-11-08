/**
 * Cerberus (https://oldschool.runescape.wiki/w/Cerberus), from plugins/bosses/data/cerberus.json:
 * the lair's winches, arenas and exits, her fight with its triple attack, souls and lava, and the
 * kill. Each lives in ./cerberus/.
 */
const Common = require("./cerberus/Common.Cerberus");
const Lair = require("./cerberus/Lair.Cerberus");
const Combat = require("./cerberus/Combat.Cerberus");
const Kills = require("./cerberus/Kills.Cerberus");

module.exports = {
  name: "Cerberus",
  description: "Cerberus in her lair: the winches, arenas and exits, the triple attack with souls and lava, and the kill.",
  members: true,
  register(api) {
    Common.init(api);
    Lair.attach(api);
    Combat.attach(api);
    Kills.attach(api);
  },
};
