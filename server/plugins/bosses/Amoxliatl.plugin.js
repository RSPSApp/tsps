/**
 * Amoxliatl (https://oldschool.runescape.wiki/w/Amoxliatl), from plugins/bosses/data/amoxliatl.json,
 * as captured beneath the Ruins of Tapoyauik: her door once The Heart of Darkness is done, a
 * chamber of the player's own, the fight, her unstable ice and the kill. Each lives in
 * ./amoxliatl/. See docs/amoxliatl.md.
 */
const Common = require("./amoxliatl/Common.Amoxliatl");
const Chamber = require("./amoxliatl/Chamber.Amoxliatl");
const Fight = require("./amoxliatl/Fight.Amoxliatl");
const UnstableIce = require("./amoxliatl/UnstableIce.Amoxliatl");
const CombatAchievements = require("./amoxliatl/CombatAchievements.Amoxliatl");
const Scoreboard = require("./amoxliatl/Scoreboard.Amoxliatl");

module.exports = {
  name: "Amoxliatl",
  description: "Amoxliatl beneath the Ruins of Tapoyauik: her door after The Heart of Darkness, a private chamber, the fight with unstable ice, and the kill.",
  members: true,
  register(api) {
    Common.init(api);
    Chamber.attachChamber(api);
    Fight.attachFight(api);
    UnstableIce.attachUnstableIce(api);
    require("./amoxliatl/Kills.Amoxliatl")(api);
    CombatAchievements.attachCombatAchievements(api);
    Scoreboard.attachScoreboard(api);
    require("./amoxliatl/Commands.Amoxliatl")(api);
  },
};
