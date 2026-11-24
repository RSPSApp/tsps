/**
 * The Royal Titans: Branda the Fire Queen and Eldric the Ice King in the Asgarnian Ice
 * Dungeon (https://oldschool.runescape.wiki/w/Royal_Titans). A 1-2 player instance behind
 * the entrance tunnel: melee stomps with a shared 5x3 telegraph, elemental rows and
 * elementals while mobile, the teleport onto the arena at 35% with the arena-wide
 * Elemental Blast, and one corpse claim (Loot / Sacrifice / Take pages) per player per
 * kill with contribution-scaled drops. Combat Achievements are decided by the fight
 * (CombatAchievements.RoyalTitans.js). Full behaviour in docs/royal-titans.md.
 */
const Shared = require("./royaltitans/Shared.RoyalTitans");
const Area = require("./royaltitans/Area.RoyalTitans");
const Combat = require("./royaltitans/Combat.RoyalTitans");
const Specials = require("./royaltitans/Specials.RoyalTitans");
const Minions = require("./royaltitans/Minions.RoyalTitans");
const Corpse = require("./royaltitans/Corpse.RoyalTitans");
const Hud = require("./royaltitans/Hud.RoyalTitans");
const Commands = require("./royaltitans/Commands.RoyalTitans");
const CombatAchievements = require("./royaltitans/CombatAchievements.RoyalTitans");


function describeEncounters({ npcIds }) {
  for (const id of [Shared.BRANDA_ID, Shared.ELDRIC_ID, Shared.FIRE_MINION_ID, Shared.ICE_MINION_ID]) npcIds.add(id);
}

module.exports = {
  name: "RoyalTitans",
  description: "Branda and Eldric in the Asgarnian Ice Dungeon: a 1-2 player instance with stomps, elemental rows, Elemental Blast and per-player corpse claims.",
  members: true,
  register(api) {
    api.onCustomEvent("bestiary:encounters", describeEncounters);
    Shared.init(api);
    Combat.attach(api);
    Specials.attach(api);
    Minions.attach(api);
    Corpse.attach(api);
    Area.attach(api);
    Hud.attach(api);
    CombatAchievements.attach(api);
    Commands(api);
  },
};
