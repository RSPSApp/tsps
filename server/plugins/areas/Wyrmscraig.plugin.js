/**
 * Wyrmscraig (https://oldschool.runescape.wiki/w/Wyrmscraig), from
 * plugins/areas/data/wyrmscraig.json: the cave under Ardeaglais. Fallen From Grace owns
 * its quest state and the cliff shortcut's mined state. The
 * shortcuts are Agility's (shortcuts/Wyrmscraig.Agility.js); the Mad Angel is the MadAngel plugin
 * (plugins/bosses). See docs/wyrmscraig.md.
 */
const Common = require("./wyrmscraig/Common.Wyrmscraig");

module.exports = {
  name: "Wyrmscraig",
  description: "The cave under Ardeaglais on Wyrmscraig, with its Fallen From Grace cliff state; its shortcuts and the Mad Angel are separate plugins.",
  members: true,
  register(api) {
    Common.init(api);
    require("./wyrmscraig/Cave.Wyrmscraig")(api);
  },
};
