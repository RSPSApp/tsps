/**
 * The Hueycoatl: the serpent coiled through the Darkfrost in Varlamore
 * (https://oldschool.runescape.wiki/w/The_Hueycoatl). A public fight for up to 20 beyond the
 * chain, or a private one from the meeting flag: five body segments to beat, the head with its
 * Rain Fire and glowing symbols, the seer's pillars and braziers, the shield at half health with
 * the tail's slams, and the final phase. Full behaviour in docs/hueycoatl.md.
 */
const Shared = require("./hueycoatl/Shared.Hueycoatl");
const Session = require("./hueycoatl/Session.Hueycoatl");
const Area = require("./hueycoatl/Area.Hueycoatl");
const Fight = require("./hueycoatl/Fight.Hueycoatl");
const Attacks = require("./hueycoatl/Attacks.Hueycoatl");
const Pillars = require("./hueycoatl/Pillars.Hueycoatl");
const Seer = require("./hueycoatl/Seer.Hueycoatl");
const Kills = require("./hueycoatl/Kills.Hueycoatl");
const Hud = require("./hueycoatl/Hud.Hueycoatl");
const Lobby = require("./hueycoatl/Lobby.Hueycoatl");
const CombatAchievements = require("./hueycoatl/CombatAchievements.Hueycoatl");
const Commands = require("./hueycoatl/Commands.Hueycoatl");

module.exports = {
  name: "Hueycoatl",
  description: "The Hueycoatl in the Darkfrost, Varlamore: a public or private fight with five body segments, Rain Fire, pillars, the half-health shield and a final phase.",
  members: true,
  register(api) {
    Shared.init(api);
    Session.init(api);
    Attacks.attach(api);
    Pillars.attach(api);
    Seer.attach(api);
    Kills.attach(api);
    Hud.attach(api);
    CombatAchievements.attach(api);
    Fight.attach(api);
    Area.attach(api);
    Lobby.attach(api);
    Commands(api);
  },
};
