/**
 * The Abyssal Sire (https://oldschool.runescape.wiki/w/Abyssal_Sire), from
 * plugins/bosses/data/abyssal-sire.json, as captured in the Abyssal Nexus: its four chambers, the
 * fight with its lungs, tentacles, minions and miasma, the kill, the Font of Consumption, the
 * Overseer and the rest of the Nexus. Each lives in ./abyssalsire/. See docs/abyssal-sire.md.
 */
const Common = require("./abyssalsire/Common.AbyssalSire");
const Lair = require("./abyssalsire/Lair.AbyssalSire");
const Lungs = require("./abyssalsire/Lungs.AbyssalSire");
const Minions = require("./abyssalsire/Minions.AbyssalSire");
const Font = require("./abyssalsire/Font.AbyssalSire");
const Overseer = require("./abyssalsire/Overseer.AbyssalSire");
const Nexus = require("./abyssalsire/Nexus.AbyssalSire");
const CombatAchievements = require("./abyssalsire/CombatAchievements.AbyssalSire");

module.exports = {
  name: "AbyssalSire",
  description: "The Abyssal Sire in the Abyssal Nexus: its chambers, lungs, tentacles and miasma fight, the kill, the Font of Consumption and the Overseer.",
  members: true,
  register(api) {
    Common.init(api);
    Lair.attach(api);
    Lungs.attachLungs(api);
    Minions.attachMinions(api);
    require("./abyssalsire/Kills.AbyssalSire")(api);
    CombatAchievements.attachCombatAchievements(api);
    Font.attachFont(api);
    Overseer.attachOverseer(api);
    Nexus.attachNexus(api);
    require("./abyssalsire/Commands.AbyssalSire")(api);
  },
};
