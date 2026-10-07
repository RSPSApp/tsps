/**
 * Wyrmscraig (https://oldschool.runescape.wiki/w/Wyrmscraig), from
 * data/definitions/wyrmscraig.json, as captured: Fallen From Grace's finished state for every
 * player (open access) and the cave under Ardeaglais. Each lives in ./wyrmscraig/. The
 * shortcuts are Agility's (shortcuts/Wyrmscraig.js); the Mad Angel is the MadAngel plugin
 * (plugins/bosses). See docs/wyrmscraig.md.
 */
const Common = require("./wyrmscraig/Common.Wyrmscraig");

module.exports = {
  name: "Wyrmscraig",
  members: true,
  register(api) {
    Common.init(api);
    require("./wyrmscraig/OpenAccess.Wyrmscraig")(api);
    require("./wyrmscraig/Cave.Wyrmscraig")(api);
  },
};
