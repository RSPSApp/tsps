/**
 * The Grotesque Guardians (https://oldschool.runescape.wiki/w/Grotesque_Guardians), from
 * plugins/bosses/data/grotesque-guardians.json: the Slayer Tower roof with its key, bell and
 * exit, the four-phase fight with Dusk and Dawn, and the kill. Each lives in
 * ./grotesqueguardians/. Their finishing blow is the Slayer finishers' (data/slayer-finishers.json).
 */
const Common = require("./grotesqueguardians/Common.GrotesqueGuardians");
const Roof = require("./grotesqueguardians/Roof.GrotesqueGuardians");
const Combat = require("./grotesqueguardians/Combat.GrotesqueGuardians");
const Kills = require("./grotesqueguardians/Kills.GrotesqueGuardians");

module.exports = {
  name: "GrotesqueGuardians",
  description: "Dusk and Dawn on the Slayer Tower roof: the key, bell and exit, the four-phase fight and the kill.",
  members: true,
  register(api) {
    Common.init(api);
    Roof.attach(api);
    Combat.attach(api);
    Kills.attach(api);
  },
};
