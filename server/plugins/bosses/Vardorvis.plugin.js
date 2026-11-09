/**
 * Vardorvis after Desert Treasure II (https://oldschool.runescape.wiki/w/Vardorvis), from
 * plugins/bosses/data/vardorvis.json, as captured at the Stranglewood's ritual site: the ritual site
 * (an instance of the player's own, awakened with an awakener's orb), the tendril barrier, his
 * slashes, swinging axes, head gaze, darting spikes and strangle, and the kill. Each part lives in
 * ./vardorvis/. The quest's own fight stays in the quest. See docs/vardorvis.md.
 */
const Common = require("./vardorvis/Common.Vardorvis");
const Site = require("./vardorvis/Site.Vardorvis");
const Fight = require("./vardorvis/Fight.Vardorvis");
const Head = require("./vardorvis/Head.Vardorvis");
const Strangle = require("./vardorvis/Strangle.Vardorvis");
const CombatAchievements = require("./vardorvis/CombatAchievements.Vardorvis");
const Scoreboard = require("./vardorvis/Scoreboard.Vardorvis");

module.exports = {
  name: "Vardorvis",
  description: "Vardorvis at the Stranglewood ritual site: a private instance, tendril barrier, slashes, axes, head gaze, spikes, strangle and the kill.",
  members: true,
  register(api) {
    Common.init(api);
    Site.attachSite(api);
    Fight.attachFight(api);
    Head.attachHead(api);
    Strangle.attachStrangle(api);
    CombatAchievements.attachCombatAchievements(api);
    Scoreboard.attachScoreboard(api);
    require("./vardorvis/Commands.Vardorvis")(api);
  },
};
