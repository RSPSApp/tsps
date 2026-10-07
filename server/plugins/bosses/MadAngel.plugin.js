/**
 * The Mad Angel (https://oldschool.runescape.wiki/w/Mad_Angel), from
 * data/definitions/mad-angel.json, as captured in Ardeaglais on Wyrmscraig: the cathedral's
 * doors and broken pew, a cathedral of the player's own, the fight and the kill. Each lives in
 * ./madangel/. Fallen From Grace isn't on this server: the post-quest angel is open to all (the
 * Wyrmscraig plugin). See docs/wyrmscraig.md.
 */
const Common = require("./madangel/Common.MadAngel");
const Instance = require("./madangel/Instance.MadAngel");
const Fight = require("./madangel/Fight.MadAngel");

module.exports = {
  name: "MadAngel",
  members: true,
  register(api) {
    Common.init(api);
    Instance.attachInstance(api);
    require("./madangel/Cathedral.MadAngel")(api);
    Fight.attachFight(api);
    require("./madangel/Kills.MadAngel")(api);
    require("./madangel/Commands.MadAngel")(api);
  },
};
