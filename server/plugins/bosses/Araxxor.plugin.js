/**
 * Araxxor, in the Morytania spider lair (https://oldschool.runescape.wiki/w/Araxxor):
 * a solo instance with the nine eggs, melee/magic/ranged standards, an acid special every
 * seventh attack that follows the first egg's colour, the enrage at 25% with "Skree!"
 * cleaves, and a harvestable corpse. Drops roll from data/definitions/npc-drops.json's
 * araxxor table when the corpse is harvested or destroyed. Her Combat Achievements are decided
 * by the fight (CombatAchievements.Araxxor.js).
 */
const Area = require("./araxxor/Area.Araxxor");
const Combat = require("./araxxor/Combat.Araxxor");
const Specials = require("./araxxor/Specials.Araxxor");
const Minions = require("./araxxor/Minions.Araxxor");
const Corpse = require("./araxxor/Corpse.Araxxor");
const Hud = require("./araxxor/Hud.Araxxor");
const Commands = require("./araxxor/Commands.Araxxor");
const CombatAchievements = require("./araxxor/CombatAchievements.Araxxor");
const Scoreboard = require("./araxxor/Scoreboard.Araxxor");

module.exports = {
  name: "Araxxor",
  description: "Araxxor in the Morytania spider lair: a solo instance with eggs, acid specials, the 25% enrage, a harvestable corpse and Combat Achievements.",
  members: true,
  register(api) {
    Combat.attach(api);
    Specials.attach(api);
    Minions.attach(api);
    Corpse.attach(api);
    Area.attach(api);
    Hud.attach(api);
    CombatAchievements.attach(api);
    Scoreboard.attach(api);
    Commands(api);
  },
};
