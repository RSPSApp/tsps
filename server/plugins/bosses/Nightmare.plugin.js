/**
 * The Nightmare (https://oldschool.runescape.wiki/w/The_Nightmare) and Phosani's Nightmare
 * (https://oldschool.runescape.wiki/w/Phosani%27s_Nightmare), from plugins/bosses/data/nightmare.json,
 * as captured in the Sisterhood Sanctuary: the dreams (instances), the fight's phases, shields,
 * totems and sleepwalkers, her attacks and specials, the loot, and Shura's and Sister Senga's
 * keeping of what a death leaves behind. Each part lives in ./nightmare/. See docs/nightmare.md.
 */
const Common = require("./nightmare/Common.Nightmare");
const Dream = require("./nightmare/Dream.Nightmare");
const Fight = require("./nightmare/Fight.Nightmare");
const Husks = require("./nightmare/Husks.Nightmare");
const Parasites = require("./nightmare/Parasites.Nightmare");
const Sleepwalkers = require("./nightmare/Sleepwalkers.Nightmare");
const Sanctuary = require("./nightmare/Sanctuary.Nightmare");
const Retrieval = require("./nightmare/Retrieval.Nightmare");
const Specials = require("./nightmare/Specials.Nightmare");
const Scoreboard = require("./nightmare/Scoreboard.Nightmare");

module.exports = {
  name: "Nightmare",
  description: "The Nightmare and Phosani's Nightmare in the Sisterhood Sanctuary: dreams, phases, totems, sleepwalkers, loot and Shura's and Senga's item keeping.",
  members: true,
  register(api) {
    Common.init(api);
    Dream.attachDream(api);
    Fight.attachFight(api);
    Husks.attachHusks(api);
    Parasites.attachParasites(api);
    Sleepwalkers.attachSleepwalkers(api);
    Specials.attachSpecials(api);
    Sanctuary.attachSanctuary(api);
    Retrieval.attachRetrieval(api);
    Scoreboard.attachScoreboard(api);
    require("./nightmare/CombatAchievements.Nightmare")(api);
    api.onCustomEvent("ironman:shared-kill-keeps", require("./nightmare/Loot.Nightmare").ironmanKeeps);
    require("./nightmare/Commands.Nightmare")(api);
  },
};
